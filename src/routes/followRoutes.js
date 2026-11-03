const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Follow = require('../models/Follow');
const Friendship = require('../models/Friendship');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { notify } = require('../services/notifications');
const { followCounts } = require('../services/follows');
const { isBlockedBetween, blockedEitherWay } = require('../services/blocks');

const router = express.Router();
const readLimit = rateLimit({ name: 'follow-read', max: 300, windowMs: 15 * 60 * 1000 });
const writeLimit = rateLimit({ name: 'follow-write', max: 80, windowMs: 60 * 60 * 1000 });

const fail = (res, status, error) => res.status(status).json({ success: false, error });
const FIELDS = '_id username displayName avatar privacy';

async function byName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9_.-]{2,40}$/i.test(name)) return null;
  return User.findOne({ username: name.toLowerCase() }).select(FIELDS).lean();
}

const listsVisible = (target, viewerId) =>
  Boolean(viewerId && String(viewerId) === String(target._id)) || (target.privacy?.followLists || 'everyone') !== 'nobody';

// GET /api/follows/status/:username
router.get('/status/:username', readLimit, optionalAuth, async (req, res, next) => {
  try {
    const target = await byName(req.params.username);
    if (!target) return fail(res, 404, 'Player not found.');
    const counts = await followCounts(target._id);
    let following = false; let followsYou = false;
    if (req.user && String(req.user._id) !== String(target._id)) {
      const [a, b] = await Promise.all([
        Follow.exists({ follower: req.user._id, following: target._id }),
        Follow.exists({ follower: target._id, following: req.user._id }),
      ]);
      following = Boolean(a); followsYou = Boolean(b);
    }
    res.json({ success: true, data: { following, followsYou, followerCount: counts.followers, followingCount: counts.following, listsVisible: listsVisible(target, req.user?._id) } });
  } catch (error) { next(error); }
});

// POST /api/follows/:username
router.post('/:username', requireAuth, writeLimit, async (req, res, next) => {
  try {
    const target = await byName(req.params.username);
    if (!target) return fail(res, 404, 'Player not found.');
    if (String(target._id) === String(req.user._id)) return fail(res, 400, 'You can’t follow yourself.');
    if (await isBlockedBetween(req.user._id, target._id)) return fail(res, 403, 'You can’t follow this player.');
    if (target.privacy?.profileVisibility === 'private') {
      const [a, b] = [req.user._id, target._id];
      const friends = await Friendship.exists({ $or: [{ user1: a, user2: b }, { user1: b, user2: a }] });
      if (!friends) return fail(res, 403, 'This profile is private. Send a friend request instead.');
    }
    const result = await Follow.updateOne({ follower: req.user._id, following: target._id }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    if (result.upsertedCount) {
      await notify({ recipient: target._id, actor: req.user._id, type: 'follow', key: `follow:${req.user._id}:${target._id}` });
    }
    const counts = await followCounts(target._id);
    res.status(201).json({ success: true, data: { following: true, followerCount: counts.followers } });
  } catch (error) { next(error); }
});

// DELETE /api/follows/:username
router.delete('/:username', requireAuth, writeLimit, async (req, res, next) => {
  try {
    const target = await byName(req.params.username);
    if (!target) return fail(res, 404, 'Player not found.');
    await Follow.deleteOne({ follower: req.user._id, following: target._id });
    const counts = await followCounts(target._id);
    res.json({ success: true, data: { following: false, followerCount: counts.followers } });
  } catch (error) { next(error); }
});

async function list(req, res, next, direction) {
  try {
    const target = await byName(req.params.username);
    if (!target) return fail(res, 404, 'Player not found.');
    if (!listsVisible(target, req.user?._id)) {
      return fail(res, 403, `${target.displayName || target.username} keeps their followers and following private.`);
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 50);
    const query = direction === 'followers' ? { following: target._id } : { follower: target._id };
    if (req.query.cursor) {
      if (!mongoose.Types.ObjectId.isValid(req.query.cursor)) return fail(res, 400, 'Invalid cursor.');
      query._id = { $lt: req.query.cursor };
    }
    const hidden = await blockedEitherWay(req.user?._id);
    const field = direction === 'followers' ? 'follower' : 'following';
    const rows = await Follow.find(query).sort({ _id: -1 }).limit(limit + 1).populate(field, 'username displayName avatar').lean();
    const page = rows.slice(0, limit);
    const people = page.map((row) => row[field]).filter((person) => person && !hidden.includes(String(person._id)));

    let mine = new Set();
    if (req.user && people.length) {
      const follows = await Follow.find({ follower: req.user._id, following: { $in: people.map((p) => p._id) } }).select('following').lean();
      mine = new Set(follows.map((row) => String(row.following)));
    }
    const items = people.map((person) => ({
      _id: String(person._id), username: person.username, displayName: person.displayName || '', avatar: person.avatar || null,
      youFollow: mine.has(String(person._id)), isMe: Boolean(req.user && String(req.user._id) === String(person._id)),
    }));
    res.json({ success: true, data: { items, nextCursor: rows.length > limit ? String(page.at(-1)._id) : null } });
  } catch (error) { next(error); }
}
router.get('/:username/followers', readLimit, optionalAuth, (req, res, next) => list(req, res, next, 'followers'));
router.get('/:username/following', readLimit, optionalAuth, (req, res, next) => list(req, res, next, 'following'));

module.exports = router;
