const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const validId = (id) => mongoose.Types.ObjectId.isValid(id);

router.use(requireAuth);

function serialize(item) {
  const post = item.post && typeof item.post === 'object' ? item.post : null;
  return {
    id: String(item._id),
    type: item.type,
    read: Boolean(item.readAt),
    createdAt: item.createdAt,
    actor: item.actor
      ? {
          username: item.actor.username,
          displayName: item.actor.displayName || '',
          avatar: item.actor.avatar || null
        }
      : null,
    postId: post ? String(post._id) : item.post ? String(item.post) : null,
    lfgId: item.lfg && item.lfg._id ? String(item.lfg._id) : null,
    lfgGame: item.lfg && item.lfg.game ? item.lfg.game : null,
    snippet: post && post.body ? String(post.body).slice(0, 90) : ''
  };
}

// GET /api/notifications?cursor=<id>&limit=20
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 30);
    const query = { recipient: req.user._id };

    if (req.query.cursor) {
      if (!validId(req.query.cursor)) {
        return res.status(400).json({ success: false, error: 'Invalid pagination cursor.' });
      }
      query._id = { $lt: req.query.cursor };
    }

    const rows = await Notification.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate('actor', 'username displayName avatar')
      .populate('post', 'body removedAt')
      .populate('lfg', 'game')
      .lean();

    const page = rows.slice(0, limit);
    const items = page
      .filter((row) => row.actor && !(row.post && row.post.removedAt))
      .map(serialize);

    const unread = await Notification.countDocuments({ recipient: req.user._id, readAt: null });

    return res.json({
      success: true,
      data: {
        items,
        unread,
        nextCursor: rows.length > limit ? String(page[page.length - 1]._id) : null
      }
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res, next) => {
  try {
    const unread = await Notification.countDocuments({ recipient: req.user._id, readAt: null });
    return res.json({ success: true, data: { unread } });
  } catch (error) {
    return next(error);
  }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    return res.json({ success: true, data: { unread: 0 } });
  } catch (error) {
    return next(error);
  }
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid notification.' });
    }
    await Notification.updateOne(
      { _id: req.params.id, recipient: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    const unread = await Notification.countDocuments({ recipient: req.user._id, readAt: null });
    return res.json({ success: true, data: { unread } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
