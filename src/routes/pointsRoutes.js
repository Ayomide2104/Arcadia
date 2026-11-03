const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const PostShare = require('../models/PostShare');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { getPoints } = require('../services/arcadianPoints');
const { isBlockedBetween } = require('../services/blocks');

const router = express.Router();
const readLimit = rateLimit({ name: 'points-read', max: 240, windowMs: 15 * 60 * 1000 });
const shareLimit = rateLimit({ name: 'points-share', max: 120, windowMs: 60 * 60 * 1000 });
const fail = (res, status, error) => res.status(status).json({ success: false, error });

// POST /api/points/shares/:postId  (a person shared this post; counts once, never for your own posts)
router.post('/shares/:postId', requireAuth, shareLimit, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.postId)) return fail(res, 400, 'Invalid post.');
    const post = await Post.findOne({ _id: req.params.postId, removedAt: null }).select('author').lean();
    if (!post) return fail(res, 404, 'Post not found.');
    if (String(post.author) === String(req.user._id)) return res.json({ success: true, data: { counted: false } });
    if (await isBlockedBetween(req.user._id, post.author)) return res.json({ success: true, data: { counted: false } });
    const result = await PostShare.updateOne({ user: req.user._id, post: post._id }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    res.json({ success: true, data: { counted: Boolean(result.upsertedCount) } });
  } catch (error) { next(error); }
});

// GET /api/points/:username
router.get('/:username', readLimit, optionalAuth, async (req, res, next) => {
  try {
    const name = req.params.username;
    if (!/^[a-z0-9_.-]{2,40}$/i.test(name)) return fail(res, 404, 'Player not found.');
    const user = await User.findOne({ username: name.toLowerCase() }).select('_id username displayName privacy').lean();
    if (!user) return fail(res, 404, 'Player not found.');
    const self = req.user && String(req.user._id) === String(user._id);
    if (!self && req.user && await isBlockedBetween(req.user._id, user._id)) return fail(res, 404, 'Player not found.');
    if (!self && user.privacy?.profileVisibility === 'private') return fail(res, 403, 'This profile is private.');
    const points = await getPoints(user._id);
    res.json({ success: true, data: { username: user.username, displayName: user.displayName || '', isMe: Boolean(self), ...points } });
  } catch (error) { next(error); }
});

module.exports = router;
