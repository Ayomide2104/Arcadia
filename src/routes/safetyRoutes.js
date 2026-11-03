const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Block = require('../models/Block');
const Report = require('../models/Report');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Lfg = require('../models/Lfg');
const Friendship = require('../models/Friendship');
const FriendRequest = require('../models/FriendRequest');
const Follow = require('../models/Follow');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);

const blockLimit = rateLimit({ name: 'safety-block', max: 60, windowMs: 60 * 60 * 1000 });
const reportLimit = rateLimit({ name: 'safety-report', max: 20, windowMs: 60 * 60 * 1000 });
const readLimit = rateLimit({ name: 'safety-read', max: 200, windowMs: 15 * 60 * 1000 });

const REASONS = ['spam', 'harassment', 'hate', 'sexual', 'scam', 'underage', 'other'];
const validId = (value) => mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === String(value);
const fail = (res, status, error) => res.status(status).json({ success: false, error });

async function userByName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9_.-]{2,40}$/i.test(name)) return null;
  return User.findOne({ username: name.toLowerCase() }).select('_id username displayName avatar').lean();
}

// GET /api/safety/blocks
router.get('/blocks', readLimit, async (req, res, next) => {
  try {
    const rows = await Block.find({ blocker: req.user._id }).sort({ createdAt: -1 }).limit(200).populate('blocked', 'username displayName avatar').lean();
    const items = rows.filter((row) => row.blocked).map((row) => ({
      _id: String(row.blocked._id), username: row.blocked.username, displayName: row.blocked.displayName || '', avatar: row.blocked.avatar || null, blockedAt: row.createdAt,
    }));
    res.json({ success: true, data: { items } });
  } catch (error) { next(error); }
});

// POST /api/safety/blocks/:username
router.post('/blocks/:username', blockLimit, async (req, res, next) => {
  try {
    const person = await userByName(req.params.username);
    if (!person) return fail(res, 404, 'Player not found.');
    if (String(person._id) === String(req.user._id)) return fail(res, 400, 'You can’t block yourself.');

    await Block.updateOne({ blocker: req.user._id, blocked: person._id }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });

    // Blocking ends the friendship and any pending requests, in both directions.
    const [a, b] = [req.user._id, person._id];
    await Promise.all([
      Friendship.deleteMany({ $or: [{ user1: a, user2: b }, { user1: b, user2: a }] }),
      FriendRequest.deleteMany({ $or: [{ sender: a, recipient: b }, { sender: b, recipient: a }] }),
      Follow.deleteMany({ $or: [{ follower: a, following: b }, { follower: b, following: a }] }),
    ]);
    res.status(201).json({ success: true, data: { blocked: true, username: person.username } });
  } catch (error) { next(error); }
});

// DELETE /api/safety/blocks/:username
router.delete('/blocks/:username', blockLimit, async (req, res, next) => {
  try {
    const person = await userByName(req.params.username);
    if (!person) return fail(res, 404, 'Player not found.');
    await Block.deleteOne({ blocker: req.user._id, blocked: person._id });
    res.json({ success: true, data: { blocked: false, username: person.username } });
  } catch (error) { next(error); }
});

// GET /api/safety/blocks/status/:username  -> { blockedByMe }
router.get('/blocks/status/:username', readLimit, async (req, res, next) => {
  try {
    const person = await userByName(req.params.username);
    if (!person) return fail(res, 404, 'Player not found.');
    const mine = await Block.exists({ blocker: req.user._id, blocked: person._id });
    res.json({ success: true, data: { blockedByMe: Boolean(mine) } });
  } catch (error) { next(error); }
});

// POST /api/safety/reports  { type, target, reason, details }
router.post('/reports', reportLimit, async (req, res, next) => {
  try {
    const { type, reason } = req.body || {};
    const details = String(req.body?.details ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
    if (!['post', 'comment', 'user', 'lfg'].includes(type)) return fail(res, 400, 'Choose what you are reporting.');
    if (!REASONS.includes(reason)) return fail(res, 400, 'Choose a reason.');

    let targetId = req.body?.target;
    let subject = null;
    if (type === 'user') {
      const person = await userByName(String(targetId || ''));
      if (!person) return fail(res, 404, 'Player not found.');
      targetId = person._id; subject = person._id;
    } else {
      if (!validId(targetId)) return fail(res, 400, 'That item can’t be reported.');
      const model = { post: Post, comment: Comment, lfg: Lfg }[type];
      const found = await model.findById(targetId).select('author').lean();
      if (!found) return fail(res, 404, 'That item no longer exists.');
      subject = found.author || null;
    }
    if (subject && String(subject) === String(req.user._id)) return fail(res, 400, 'You can’t report yourself.');

    try {
      await Report.create({ reporter: req.user._id, targetType: type, target: targetId, subject, reason, details });
    } catch (error) {
      if (error && error.code === 11000) return res.json({ success: true, data: { duplicate: true } });
      throw error;
    }
    res.status(201).json({ success: true, data: { reported: true } });
  } catch (error) { next(error); }
});

module.exports = router;
