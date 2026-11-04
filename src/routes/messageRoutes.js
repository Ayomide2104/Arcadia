const express = require('express');
const mongoose = require('mongoose');

const Message = require('../models/Message');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();

const sendMessageLimit = rateLimit({
  name: 'private-message-send',
  max: 60,
  windowMs: 60 * 1000
});

router.use(requireAuth);

function validUsername(username) {
  return typeof username === 'string' &&
    /^[a-z0-9_]{3,24}$/i.test(username);
}

function pairIds(a, b) {
  return [String(a), String(b)].sort();
}

async function findFriend(username, currentUserId) {
  if (!validUsername(username)) {
    return { error: 'Enter a valid username.', status: 400 };
  }

  const friend = await User.findOne({
    username: username.toLowerCase()
  }).select('_id username displayName avatar').lean();

  if (!friend) {
    return { error: 'User not found.', status: 404 };
  }

  if (String(friend._id) === String(currentUserId)) {
    return { error: 'You cannot message yourself.', status: 400 };
  }

  const [user1, user2] = pairIds(currentUserId, friend._id);

  const friendship = await Friendship.exists({ user1, user2 });

  if (!friendship) {
    return {
      error: 'You can only message people who are your friends.',
      status: 403
    };
  }

  return { friend };
}

function serializeMessage(message, currentUserId, replyMap = null) {
  const deleted = Boolean(message.deletedAt);
  const out = {
    id: String(message._id),
    sender: String(message.sender),
    recipient: String(message.recipient),
    content: deleted ? '' : message.content,
    createdAt: message.createdAt,
    readAt: message.readAt,
    isMine: String(message.sender) === String(currentUserId),
    deleted,
    replyTo: null
  };

  if (!deleted && message.replyTo && replyMap) {
    const original = replyMap.get(String(message.replyTo));
    if (original) {
      const gone = Boolean(original.deletedAt);
      out.replyTo = {
        id: String(original._id),
        isMine: String(original.sender) === String(currentUserId),
        deleted: gone,
        content: gone ? '' : String(original.content).slice(0, 140)
      };
    }
  }

  return out;
}

// Looks up the messages that a batch of messages are replying to.
async function loadReplies(messages) {
  const ids = [...new Set(messages.map((message) => message.replyTo).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const originals = await Message.find({ _id: { $in: ids } })
    .select('sender content deletedAt')
    .lean();
  return new Map(originals.map((item) => [String(item._id), item]));
}

// Return recent conversations and their unread counts.
router.get('/conversations', async (req, res, next) => {
  try {
    const userId = req.user._id;

    const messages = await Message.find({
      deletedFor: { $ne: userId },
      $or: [
        { sender: userId },
        { recipient: userId }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const conversations = new Map();

    for (const message of messages) {
      const otherId = String(
        String(message.sender) === String(userId)
          ? message.recipient
          : message.sender
      );

      let conversation = conversations.get(otherId);

      if (!conversation) {
        conversation = {
          userId: otherId,
          lastMessage: serializeMessage(message, userId),
          unreadCount: 0
        };

        conversations.set(otherId, conversation);
      }

      if (
        String(message.recipient) === String(userId) &&
        !message.readAt
      ) {
        conversation.unreadCount += 1;
      }
    }

    const ids = [...conversations.keys()];

    const users = await User.find({
      _id: { $in: ids }
    }).select('username displayName avatar').lean();

    const usersById = new Map(
      users.map((user) => [String(user._id), user])
    );

    const items = [...conversations.values()]
      .map((conversation) => {
        const user = usersById.get(conversation.userId);

        if (!user) return null;

        return {
          user: {
            username: user.username,
            displayName: user.displayName || user.username,
            avatar: user.avatar || null
          },
          lastMessage: conversation.lastMessage,
          unreadCount: conversation.unreadCount
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(b.lastMessage.createdAt) -
          new Date(a.lastMessage.createdAt)
      );

    res.json({
      success: true,
      data: { items }
    });
  } catch (error) {
    next(error);
  }
});

// Total unread messages across all conversations.
router.get('/unread/count', async (req, res, next) => {
  try {
    const count = await Message.countDocuments({
      recipient: req.user._id,
      readAt: null,
      deletedFor: { $ne: req.user._id },
      deletedAt: null
    });

    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    next(error);
  }
});


// Retrieve conversation history. Older messages can be loaded with ?before=ISO_DATE.
router.get('/:username', async (req, res, next) => {
  try {
    const result = await findFriend(req.params.username, req.user._id);

    if (result.error) {
      return res.status(result.status).json({
        success: false,
        error: result.error
      });
    }

    const friendId = result.friend._id;
    const filter = {
      deletedFor: { $ne: req.user._id },
      $or: [
        { sender: req.user._id, recipient: friendId },
        { sender: friendId, recipient: req.user._id }
      ]
    };

    if (req.query.before !== undefined) {
      const before = new Date(req.query.before);

      if (Number.isNaN(before.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid message history cursor.'
        });
      }

      filter.createdAt = { $lt: before };
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const replyMap = await loadReplies(messages);

    res.json({
      success: true,
      data: {
        friend: {
          username: result.friend.username,
          displayName:
            result.friend.displayName || result.friend.username,
          avatar: result.friend.avatar || null
        },
        items: messages
          .reverse()
          .map((message) => serializeMessage(message, req.user._id, replyMap)),
        hasMore: messages.length === 50
      }
    });
  } catch (error) {
    next(error);
  }
});

// Send a message to an existing friend.
router.post('/:username', sendMessageLimit, async (req, res, next) => {
  try {
    const result = await findFriend(req.params.username, req.user._id);

    if (result.error) {
      return res.status(result.status).json({
        success: false,
        error: result.error
      });
    }

    const content =
      typeof req.body?.content === 'string'
        ? req.body.content.trim()
        : '';

    if (!content || content.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Messages must contain between 1 and 2000 characters.'
      });
    }

    // A reply must point at a message from this same chat.
    let replyTo = null;
    if (req.body?.replyTo) {
      if (!mongoose.Types.ObjectId.isValid(req.body.replyTo)) {
        return res.status(400).json({ success: false, error: 'That message can’t be replied to.' });
      }
      const original = await Message.findOne({
        _id: req.body.replyTo,
        deletedAt: null,
        deletedFor: { $ne: req.user._id },
        $or: [
          { sender: req.user._id, recipient: result.friend._id },
          { sender: result.friend._id, recipient: req.user._id }
        ]
      }).select('_id').lean();
      if (!original) {
        return res.status(400).json({ success: false, error: 'That message can’t be replied to.' });
      }
      replyTo = original._id;
    }

    const message = await Message.create({
      sender: req.user._id,
      recipient: result.friend._id,
      content,
      replyTo
    });

    const item = serializeMessage(message.toObject(), req.user._id, await loadReplies([message]));

    // Socket.IO is attached to the Express app in a later step.
    // Persisting messages works even before real-time delivery is enabled.
    const io = req.app.get('io');

    if (io) {
      // Usernames travel with the event so clients can place it without a lookup.
      const live = { ...item, senderUsername: req.user.username, recipientUsername: result.friend.username };
      io.to(`user:${String(result.friend._id)}`).emit('message:new', live);
      io.to(`user:${String(req.user._id)}`).emit('message:new', live);
    }

    res.status(201).json({
      success: true,
      data: { message: item }
    });
  } catch (error) {
    next(error);
  }
});

// Delete one message. ?scope=me hides it for you; ?scope=everyone (your own messages) removes it for both.
router.delete('/:username/:messageId', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) {
      return res.status(400).json({ success: false, error: 'Invalid message.' });
    }
    const result = await findFriend(req.params.username, req.user._id);
    if (result.error) {
      return res.status(result.status).json({ success: false, error: result.error });
    }
    const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
    const message = await Message.findOne({
      _id: req.params.messageId,
      $or: [
        { sender: req.user._id, recipient: result.friend._id },
        { sender: result.friend._id, recipient: req.user._id }
      ]
    });
    if (!message) {
      return res.status(404).json({ success: false, error: 'Message not found.' });
    }

    if (scope === 'everyone') {
      if (String(message.sender) !== String(req.user._id)) {
        return res.status(403).json({ success: false, error: 'You can only delete your own messages for everyone.' });
      }
      await Message.updateOne({ _id: message._id }, { $set: { deletedAt: new Date(), content: '[deleted]' } });
      const io = req.app.get('io');
      if (io) {
        const payload = { id: String(message._id), senderUsername: req.user.username, recipientUsername: result.friend.username };
        io.to(`user:${String(result.friend._id)}`).emit('message:deleted', payload);
        io.to(`user:${String(req.user._id)}`).emit('message:deleted', payload);
      }
    } else {
      await Message.updateOne({ _id: message._id }, { $addToSet: { deletedFor: req.user._id } });
    }
    return res.json({ success: true, data: { id: String(message._id), scope } });
  } catch (error) {
    return next(error);
  }
});

// Delete a whole chat for you (the other person keeps theirs).
router.delete('/:username', async (req, res, next) => {
  try {
    const result = await findFriend(req.params.username, req.user._id);
    if (result.error) {
      return res.status(result.status).json({ success: false, error: result.error });
    }
    await Message.updateMany(
      {
        $or: [
          { sender: req.user._id, recipient: result.friend._id },
          { sender: result.friend._id, recipient: req.user._id }
        ]
      },
      { $addToSet: { deletedFor: req.user._id } }
    );
    return res.json({ success: true, data: { cleared: true } });
  } catch (error) {
    return next(error);
  }
});

// Mark received messages from a friend as read.
router.patch('/:username/read', async (req, res, next) => {
  try {
    const result = await findFriend(req.params.username, req.user._id);

    if (result.error) {
      return res.status(result.status).json({
        success: false,
        error: result.error
      });
    }

    const readAt = new Date();

    const update = await Message.updateMany(
      {
        sender: result.friend._id,
        recipient: req.user._id,
        readAt: null
      },
      { $set: { readAt } }
    );

    const io = req.app.get('io');

    if (io && update.modifiedCount > 0) {
      io.to(`user:${String(result.friend._id)}`).emit(
        'message:read',
        {
          username: req.user.username,
          readAt
        }
      );
    }

    res.json({
      success: true,
      data: {
        markedRead: update.modifiedCount,
        readAt
      }
    });
  } catch (error) {
    next(error);
  }
});


module.exports = router;