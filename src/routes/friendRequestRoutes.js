const express = require('express');
const mongoose = require('mongoose');
const FriendRequest = require('../models/FriendRequest');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { notify } = require('../services/notifications');

const { isBlockedBetween } = require('../services/blocks');
const router = express.Router();

const sendRequestLimit = rateLimit({
  name: 'friend-request-send',
  max: 30,
  windowMs: 15 * 60 * 1000
});

router.use(requireAuth);

function validUsername(username) {
  return typeof username === 'string' && /^[a-z0-9_]{3,24}$/i.test(username);
}

// Friendships store one record per pair, with the two user ids sorted.
function pairIds(a, b) {
  return [String(a), String(b)].sort();
}

function serializeRequest(request) {
  const otherUser = request.sender || request.recipient;

  return {
    id: String(request._id),
    status: request.status,
    createdAt: request.createdAt,
    user: otherUser && typeof otherUser === 'object' ? {
      username: otherUser.username,
      displayName: otherUser.displayName || otherUser.username,
      avatar: otherUser.avatar || null,
      bio: otherUser.bio || ''
    } : null
  };
}

// View incoming friend requests.
router.get('/incoming', async (req, res, next) => {
  try {
    const requests = await FriendRequest.find({
      recipient: req.user._id,
      status: 'pending'
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('sender', 'username displayName avatar bio')
      .lean();

    res.json({
      success: true,
      data: { items: requests.map(serializeRequest) }
    });
  } catch (error) {
    next(error);
  }
});

// View outgoing friend requests.
router.get('/outgoing', async (req, res, next) => {
  try {
    const requests = await FriendRequest.find({
      sender: req.user._id,
      status: 'pending'
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('recipient', 'username displayName avatar bio')
      .lean();

    res.json({
      success: true,
      data: {
        items: requests.map((request) => ({
          ...serializeRequest({
            ...request,
            sender: request.recipient,
            recipient: null
          })
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

// Send a friend request to another user.
router.post('/:username', sendRequestLimit, async (req, res, next) => {
  try {
    if (!validUsername(req.params.username)) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid username.'
      });
    }

    const recipient = await User.findOne({
      username: req.params.username.toLowerCase()
    }).select('_id username privacy').lean();

    if (!recipient) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    if (String(recipient._id) === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        error: 'You cannot send a friend request to yourself.'
      });
    }

    if (await isBlockedBetween(req.user._id, recipient._id)) {
      return res.status(403).json({ success: false, error: 'You can’t send a friend request to this player.' });
    }

    if (recipient.privacy?.friendRequests === 'nobody') {
      return res.status(403).json({
        success: false,
        error: 'This user is not accepting friend requests.'
      });
    }

    // CHANGED: the Friendship record is the source of truth for "already friends".
    const [user1, user2] = pairIds(req.user._id, recipient._id);
    if (await Friendship.exists({ user1, user2 })) {
      return res.status(409).json({
        success: false,
        error: 'You are already friends.'
      });
    }

    const existing = await FriendRequest.findOne({
      $or: [
        { sender: req.user._id, recipient: recipient._id },
        { sender: recipient._id, recipient: req.user._id }
      ]
    }).lean();

    if (existing?.status === 'pending') {
      if (String(existing.sender) === String(req.user._id)) {
        return res.status(409).json({
          success: false,
          error: 'You have already sent a friend request.'
        });
      }

      return res.status(409).json({
        success: false,
        error: 'This user has already sent you a friend request.'
      });
    }

    let request;

    // CHANGED: a rejected, or stale accepted, request is reused and set back to pending.
    if (existing) {
      request = await FriendRequest.findByIdAndUpdate(
        existing._id,
        {
          $set: {
            sender: req.user._id,
            recipient: recipient._id,
            status: 'pending'
          }
        },
        { new: true, runValidators: true }
      ).lean();
    } else {
      request = await FriendRequest.create({
        sender: req.user._id,
        recipient: recipient._id
      });
      request = request.toObject();
    }

    await notify({
      recipient: recipient._id,
      actor: req.user._id,
      type: 'friend_request',
      key: `friend_request:${request._id}:${Date.now()}`
    });

    res.status(201).json({
      success: true,
      data: {
        sent: true,
        request: {
          id: String(request._id),
          status: request.status,
          createdAt: request.createdAt
        }
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'A friend request already exists between these users.'
      });
    }

    next(error);
  }
});


/**
 * Accept or reject an incoming friend request.
 * Create the friendship before marking the request as accepted.
 */
router.patch('/:requestId', async (req, res, next) => {
  let session;

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid friend request.'
      });
    }

    const { action } = req.body || {};

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Choose accept or reject.'
      });
    }

    const request = await FriendRequest.findOne({
      _id: req.params.requestId,
      recipient: req.user._id,
      status: 'pending'
    }).lean();

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Pending friend request not found.'
      });
    }

    if (action === 'reject') {
      const rejected = await FriendRequest.findOneAndUpdate(
        {
          _id: request._id,
          recipient: req.user._id,
          status: 'pending'
        },
        { $set: { status: 'rejected' } },
        { new: true, runValidators: true }
      ).lean();

      if (!rejected) {
        return res.status(409).json({
          success: false,
          error: 'This request has already been handled.'
        });
      }

      return res.json({
        success: true,
        data: { updated: true, status: 'rejected' }
      });
    }

    // Sort user IDs to match the Friendship model's canonical ordering.
    const [user1, user2] = pairIds(request.sender, request.recipient);

    // Preferred path: an atomic transaction (needs a replica-set MongoDB, which Atlas is).
    try {
      session = await mongoose.startSession();

      await session.withTransaction(async () => {
        const currentRequest = await FriendRequest.findOne({
          _id: request._id,
          recipient: req.user._id,
          status: 'pending'
        }).session(session);

        if (!currentRequest) {
          const error = new Error('This request has already been handled.');
          error.status = 409;
          throw error;
        }

        await Friendship.updateOne(
          { user1, user2 },
          { $setOnInsert: { user1, user2 } },
          { upsert: true, session }
        );

        currentRequest.status = 'accepted';
        await currentRequest.save({ session });
      });
    } catch (error) {
      // CHANGED: only if this database cannot run transactions, use a safe two-step instead.
      // The friendship upsert is idempotent, so a retry after a partial failure is harmless.
      const noTransactions = /replica set|transaction numbers|mongos/i.test(String(error.message));
      if (!noTransactions) throw error;
      console.warn('Friend accept: transactions unavailable, using the two-step fallback.');

      await Friendship.updateOne(
        { user1, user2 },
        { $setOnInsert: { user1, user2 } },
        { upsert: true }
      );
      const accepted = await FriendRequest.findOneAndUpdate(
        { _id: request._id, recipient: req.user._id, status: 'pending' },
        { $set: { status: 'accepted' } },
        { new: true }
      ).lean();
      if (!accepted) {
        const conflict = new Error('This request has already been handled.');
        conflict.status = 409;
        throw conflict;
      }
    }

    await notify({
      recipient: request.sender,
      actor: req.user._id,
      type: 'friend_accept',
      key: `friend_accept:${request._id}`
    });

    return res.json({
      success: true,
      data: { updated: true, status: 'accepted' }
    });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({
        success: false,
        error: error.message
      });
    }

    next(error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});


// Cancel an outgoing pending request.
router.delete('/:requestId', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid friend request.'
      });
    }

    const result = await FriendRequest.deleteOne({
      _id: req.params.requestId,
      sender: req.user._id,
      status: 'pending'
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        success: false,
        error: 'Pending outgoing request not found.'
      });
    }

    res.json({
      success: true,
      data: { cancelled: true }
    });
  } catch (error) {
    next(error);
  }
});

// NEW: remove a friend (end the friendship). Either person can do this.
router.delete('/remove/:username', async (req, res, next) => {
  try {
    if (!validUsername(req.params.username)) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid username.'
      });
    }

    const other = await User.findOne({
      username: req.params.username.toLowerCase()
    }).select('_id').lean();

    if (!other) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    if (String(other._id) === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        error: 'You cannot remove yourself.'
      });
    }

    const [user1, user2] = pairIds(req.user._id, other._id);
    const friendship = await Friendship.deleteOne({ user1, user2 });
    // Clear the old accepted request too, so the two can become friends again later.
    const requests = await FriendRequest.deleteMany({
      status: 'accepted',
      $or: [
        { sender: req.user._id, recipient: other._id },
        { sender: other._id, recipient: req.user._id }
      ]
    });

    if (!friendship.deletedCount && !requests.deletedCount) {
      return res.status(404).json({
        success: false,
        error: 'You are not friends with this user.'
      });
    }

    res.json({
      success: true,
      data: { removed: true }
    });
  } catch (error) {
    next(error);
  }
});

// Get the authenticated user's friends list.
router.get('/list', async (req, res, next) => {
  try {
    const friendships = await Friendship.find({
      $or: [
        { user1: req.user._id },
        { user2: req.user._id }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('user1', 'username displayName avatar bio')
      .populate('user2', 'username displayName avatar bio')
      .lean();

    const items = friendships
      .map((friendship) => {
        const isUser1 = String(friendship.user1?._id) === String(req.user._id);
        const friend = isUser1 ? friendship.user2 : friendship.user1;

        if (!friend) return null;

        return {
          username: friend.username,
          displayName: friend.displayName || friend.username,
          avatar: friend.avatar || null,
          bio: friend.bio || '',
          friendsSince: friendship.createdAt
        };
      })
      .filter(Boolean);

    return res.json({
      success: true,
      data: { items }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/status/:username', async (req, res, next) => {
  try {
    if (!validUsername(req.params.username)) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid username.'
      });
    }

    const otherUser = await User.findOne({
      username: req.params.username.toLowerCase()
    }).select('_id username').lean();

    if (!otherUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    if (String(otherUser._id) === String(req.user._id)) {
      return res.json({
        success: true,
        data: { status: 'self', requestId: null }
      });
    }

    // CHANGED: check the Friendship record first.
    const [user1, user2] = pairIds(req.user._id, otherUser._id);
    if (await Friendship.exists({ user1, user2 })) {
      return res.json({
        success: true,
        data: { status: 'friends', requestId: null }
      });
    }

    const request = await FriendRequest.findOne({
      status: 'pending',
      $or: [
        { sender: req.user._id, recipient: otherUser._id },
        { sender: otherUser._id, recipient: req.user._id }
      ]
    }).select('_id sender recipient status').lean();

    if (!request) {
      return res.json({
        success: true,
        data: { status: 'none', requestId: null }
      });
    }

    res.json({
      success: true,
      data: {
        status: String(request.sender) === String(req.user._id) ? 'sent' : 'received',
        requestId: String(request._id)
      }
    });
  } catch (error) {
    next(error);
  }
});

// NEW: search players by username (for the Find players tab).
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,24}$/.test(q)) {
      return res.status(400).json({
        success: false,
        error: 'Type at least 2 letters or numbers.'
      });
    }

    // q is limited to letters, numbers and underscores above, so it is safe inside a regex.
    const users = await User.find({
      username: { $regex: `^${q}`, $options: 'i' },
      _id: { $ne: req.user._id }
    })
      .select('username displayName avatar bio privacy')
      .sort({ username: 1 })
      .limit(12)
      .lean();

    const ids = users.map((user) => user._id);
    const me = req.user._id;
    const [friendships, requests] = await Promise.all([
      Friendship.find({
        $or: [
          { user1: me, user2: { $in: ids } },
          { user2: me, user1: { $in: ids } }
        ]
      }).select('user1 user2').lean(),
      FriendRequest.find({
        status: 'pending',
        $or: [
          { sender: me, recipient: { $in: ids } },
          { recipient: me, sender: { $in: ids } }
        ]
      }).select('_id sender recipient').lean()
    ]);

    const friendIds = new Set(friendships.map((f) => (String(f.user1) === String(me) ? String(f.user2) : String(f.user1))));
    const sent = new Map();
    const received = new Map();
    for (const request of requests) {
      if (String(request.sender) === String(me)) sent.set(String(request.recipient), String(request._id));
      else received.set(String(request.sender), String(request._id));
    }

    res.json({
      success: true,
      data: {
        items: users.map((user) => {
          const id = String(user._id);
          const status = friendIds.has(id) ? 'friends' : sent.has(id) ? 'sent' : received.has(id) ? 'received' : 'none';
          return {
            username: user.username,
            displayName: user.displayName || user.username,
            avatar: user.avatar || null,
            bio: user.privacy?.profileVisibility === 'private' ? '' : (user.bio || ''),
            status,
            requestId: sent.get(id) || received.get(id) || null,
            canRequest: user.privacy?.friendRequests !== 'nobody'
          };
        })
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;