const express = require('express');
const mongoose = require('mongoose');
const Lfg = require('../models/Lfg');
const LfgRequest = require('../models/LfgRequest');
const Game = require('../models/Game');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { notify } = require('../services/notifications');
const { SKILLS, DURATIONS, allConfigs, gameConfig, validateJoin } = require('../config/lfgGames');

const { blockedEitherWay, isBlockedBetween } = require('../services/blocks');
const router = express.Router();

const readLimit = rateLimit({ name: 'lfg-read', max: 300, windowMs: 15 * 60 * 1000 });
const createLimit = rateLimit({ name: 'lfg-create', max: 8, windowMs: 60 * 60 * 1000 });
const requestLimit = rateLimit({ name: 'lfg-request', max: 30, windowMs: 60 * 60 * 1000 });
const actionLimit = rateLimit({ name: 'lfg-action', max: 120, windowMs: 15 * 60 * 1000 });

const MAX_ACTIVE_PER_USER = 3;
const MAX_PENDING_PER_POST = 25;
const AUTHOR_FIELDS = 'username displayName avatar';

const validId = (value) => mongoose.Types.ObjectId.isValid(value);
const idOf = (value) => String(value?._id || value);
const fail = (res, status, error) => res.status(status).json({ success: false, error });
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function methodLabel(post) {
  const method = gameConfig(post.game).methods.find((item) => item.key === post.joinMethod);
  return method ? method.label : 'Message me on Arcadia';
}

/**
 * Public shape of a post. The join value is only included for the host and for
 * people the host accepted; everyone else just sees which method will be used.
 */
function serialize(post, viewerId, myRequest, revealValue) {
  const mine = viewerId && idOf(post.author) === String(viewerId);
  const out = {
    _id: String(post._id),
    author: post.author && post.author.username
      ? { _id: String(post.author._id), username: post.author.username, displayName: post.author.displayName || '', avatar: post.author.avatar || null }
      : null,
    game: post.game,
    platform: post.platform,
    mode: post.mode,
    skill: post.skill,
    note: post.note || '',
    slots: post.slots,
    filled: post.filled,
    spotsLeft: Math.max(post.slots - post.filled, 0),
    status: new Date(post.expiresAt) <= new Date() && post.status === 'open' ? 'expired' : post.status,
    joinMethod: post.joinMethod,
    joinMethodLabel: methodLabel(post),
    expiresAt: post.expiresAt,
    createdAt: post.createdAt,
    isMine: Boolean(mine),
    myRequest: myRequest || null,
  };
  if (mine) out.pendingCount = post.pendingCount || 0;
  if ((mine || (myRequest && myRequest.status === 'accepted')) && revealValue !== false) out.joinValue = post.joinValue || '';
  return out;
}

// GET /api/lfg/options  (the per-game join methods, platforms and modes)
router.get('/options', readLimit, async (req, res, next) => {
  try {
    const games = await Game.find({ active: true }).select('slug name').sort({ name: 1 }).lean();
    res.json({ success: true, data: { configs: allConfigs(), games: games.map((game) => ({ slug: game.slug, name: game.name })), skills: SKILLS, durations: DURATIONS } });
  } catch (error) { next(error); }
});

// GET /api/lfg?game=&platform=&mode=&skill=&cursor=&limit=
router.get('/', readLimit, optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 40);
    const hidden = await blockedEitherWay(req.user?._id);
    const query = { status: 'open', expiresAt: { $gt: new Date() } };
    if (hidden.length) query.author = { $nin: hidden };
    if (typeof req.query.game === 'string' && /^[a-z0-9-]{1,80}$/.test(req.query.game)) query.game = req.query.game;
    if (typeof req.query.platform === 'string' && req.query.platform) query.platform = clean(req.query.platform, 30);
    if (typeof req.query.mode === 'string' && req.query.mode) query.mode = clean(req.query.mode, 60);
    if (SKILLS.some((item) => item.key === req.query.skill) && req.query.skill !== 'any') query.skill = req.query.skill;
    if (req.query.cursor) {
      if (!validId(req.query.cursor)) return fail(res, 400, 'Invalid pagination cursor.');
      query._id = { $lt: req.query.cursor };
    }

    const rows = await Lfg.find(query).sort({ _id: -1 }).limit(limit + 1).populate('author', AUTHOR_FIELDS).lean();
    const page = rows.slice(0, limit);

    let mine = new Map();
    if (req.user && page.length) {
      const requests = await LfgRequest.find({ user: req.user._id, lfg: { $in: page.map((row) => row._id) } }).select('lfg status').lean();
      mine = new Map(requests.map((item) => [String(item.lfg), { status: item.status }]));
    }
    const items = page.filter((row) => row.author).map((row) => serialize(row, req.user?._id, mine.get(String(row._id)), false));
    return res.json({ success: true, data: { items, nextCursor: rows.length > limit ? String(page[page.length - 1]._id) : null } });
  } catch (error) { return next(error); }
});

// GET /api/lfg/mine  (my posts, and the posts I asked to join)
router.get('/mine', requireAuth, readLimit, async (req, res, next) => {
  try {
    const now = new Date();
    const posts = await Lfg.find({ author: req.user._id, expiresAt: { $gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } })
      .select('+joinValue').sort({ _id: -1 }).limit(20).populate('author', AUTHOR_FIELDS).lean();
    const requests = await LfgRequest.find({ user: req.user._id }).sort({ _id: -1 }).limit(30).lean();
    const targets = await Lfg.find({ _id: { $in: requests.map((item) => item.lfg) } })
      .select('+joinValue').populate('author', AUTHOR_FIELDS).lean();
    const byId = new Map(targets.map((item) => [String(item._id), item]));
    const joined = requests
      .map((request) => {
        const post = byId.get(String(request.lfg));
        return post && post.author ? serialize(post, req.user._id, { status: request.status, message: request.message }) : null;
      })
      .filter(Boolean);
    return res.json({ success: true, data: { posts: posts.map((post) => serialize(post, req.user._id)), joined } });
  } catch (error) { return next(error); }
});

// POST /api/lfg
router.post('/', requireAuth, createLimit, async (req, res, next) => {
  try {
    const body = req.body || {};
    const slug = clean(body.game, 80).toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return fail(res, 400, 'Pick a game.');
    const game = await Game.findOne({ slug, active: true }).select('slug').lean();
    if (!game) return fail(res, 400, 'That game isn’t available.');
    const config = gameConfig(slug);

    const platform = clean(body.platform, 30);
    if (!config.platforms.includes(platform)) return fail(res, 400, 'Pick a platform for this game.');
    const mode = clean(body.mode, 60);
    if (!config.modes.includes(mode)) return fail(res, 400, 'Pick a game mode.');
    const skill = SKILLS.some((item) => item.key === body.skill) ? body.skill : 'any';
    const slots = Number.parseInt(body.slots, 10);
    if (!Number.isInteger(slots) || slots < 1 || slots > 9) return fail(res, 400, 'Choose between 1 and 9 open spots.');
    const hours = Number.parseInt(body.hours, 10);
    if (!DURATIONS.some((item) => item.hours === hours)) return fail(res, 400, 'Choose how long the invitation stays open.');

    const join = validateJoin(slug, clean(body.joinMethod, 40), body.joinValue);
    if (!join.ok) return fail(res, 400, join.error);

    const active = await Lfg.countDocuments({ author: req.user._id, status: { $in: ['open', 'full'] }, expiresAt: { $gt: new Date() } });
    if (active >= MAX_ACTIVE_PER_USER) return fail(res, 400, `You can have ${MAX_ACTIVE_PER_USER} active invitations at once. Close one to post another.`);

    const note = clean(body.note, 200);
    if (/https?:\/\/|www\./i.test(note)) return fail(res, 400, 'Links aren’t allowed in the note.');

    const post = await Lfg.create({
      author: req.user._id, game: slug, platform, mode, skill, note, slots,
      joinMethod: join.method.key, joinValue: join.value,
      expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
    });
    const fresh = await Lfg.findById(post._id).select('+joinValue').populate('author', AUTHOR_FIELDS).lean();
    return res.status(201).json({ success: true, data: { post: serialize(fresh, req.user._id) } });
  } catch (error) { return next(error); }
});

async function loadPost(req, res, { withValue = false } = {}) {
  if (!validId(req.params.id)) { fail(res, 404, 'That invitation is no longer available.'); return null; }
  const query = Lfg.findById(req.params.id);
  if (withValue) query.select('+joinValue');
  const post = await query.populate('author', AUTHOR_FIELDS).lean();
  if (!post || !post.author) { fail(res, 404, 'That invitation is no longer available.'); return null; }
  return post;
}

// GET /api/lfg/:id
router.get('/:id', readLimit, optionalAuth, async (req, res, next) => {
  try {
    const post = await loadPost(req, res, { withValue: true });
    if (!post) return undefined;
    const request = req.user ? await LfgRequest.findOne({ lfg: post._id, user: req.user._id }).select('status message').lean() : null;
    return res.json({ success: true, data: { post: serialize(post, req.user?._id, request ? { status: request.status, message: request.message } : null) } });
  } catch (error) { return next(error); }
});

// POST /api/lfg/:id/requests  { message }
router.post('/:id/requests', requireAuth, requestLimit, async (req, res, next) => {
  try {
    const post = await loadPost(req, res);
    if (!post) return undefined;
    if (idOf(post.author) === String(req.user._id)) return fail(res, 400, 'This is your own invitation.');
    if (post.status !== 'open' || new Date(post.expiresAt) <= new Date()) return fail(res, 400, 'This invitation is closed.');
    if (await isBlockedBetween(req.user._id, post.author._id)) return fail(res, 403, 'You can’t join this invitation.');
    if (post.filled >= post.slots) return fail(res, 400, 'This group is already full.');
    if ((post.pendingCount || 0) >= MAX_PENDING_PER_POST) return fail(res, 400, 'This invitation has a lot of requests already. Try another one.');

    const message = clean(req.body?.message, 140);
    if (/https?:\/\/|www\./i.test(message)) return fail(res, 400, 'Links aren’t allowed in the message.');

    try {
      await LfgRequest.create({ lfg: post._id, user: req.user._id, message });
    } catch (error) {
      if (error && error.code === 11000) return fail(res, 409, 'You already asked to join this one.');
      throw error;
    }
    await Lfg.updateOne({ _id: post._id }, { $inc: { pendingCount: 1 } });
    await notify({ recipient: post.author._id, actor: req.user._id, type: 'lfg_request', lfg: post._id, key: `lfg_request:${post._id}:${req.user._id}` });
    return res.status(201).json({ success: true, data: { request: { status: 'pending', message } } });
  } catch (error) { return next(error); }
});

// DELETE /api/lfg/:id/requests  (withdraw my request)
router.delete('/:id/requests', requireAuth, actionLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return fail(res, 404, 'That invitation is no longer available.');
    const request = await LfgRequest.findOneAndDelete({ lfg: req.params.id, user: req.user._id }).lean();
    if (request && request.status === 'pending') await Lfg.updateOne({ _id: req.params.id, pendingCount: { $gt: 0 } }, { $inc: { pendingCount: -1 } });
    if (request && request.status === 'accepted') await Lfg.updateOne({ _id: req.params.id, filled: { $gt: 0 } }, { $inc: { filled: -1 }, $set: { status: 'open' } });
    return res.json({ success: true, data: { ok: true } });
  } catch (error) { return next(error); }
});

// GET /api/lfg/:id/requests  (host only)
router.get('/:id/requests', requireAuth, readLimit, async (req, res, next) => {
  try {
    const post = await loadPost(req, res);
    if (!post) return undefined;
    if (idOf(post.author) !== String(req.user._id)) return fail(res, 403, 'Only the host can see requests.');
    const rows = await LfgRequest.find({ lfg: post._id }).sort({ createdAt: 1 }).limit(60).populate('user', AUTHOR_FIELDS).lean();
    const items = rows.filter((row) => row.user).map((row) => ({
      user: { _id: String(row.user._id), username: row.user.username, displayName: row.user.displayName || '', avatar: row.user.avatar || null },
      message: row.message || '', status: row.status, createdAt: row.createdAt,
    }));
    return res.json({ success: true, data: { items } });
  } catch (error) { return next(error); }
});

// POST /api/lfg/:id/requests/:userId/accept | decline  (host only)
async function decide(req, res, next, decision) {
  try {
    const post = await loadPost(req, res);
    if (!post) return undefined;
    if (idOf(post.author) !== String(req.user._id)) return fail(res, 403, 'Only the host can do that.');
    if (!validId(req.params.userId)) return fail(res, 404, 'That request no longer exists.');
    if (post.status === 'closed' || new Date(post.expiresAt) <= new Date()) return fail(res, 400, 'This invitation is closed.');

    const request = await LfgRequest.findOne({ lfg: post._id, user: req.params.userId, status: 'pending' });
    if (!request) return fail(res, 404, 'That request no longer exists.');

    if (decision === 'accepted') {
      // Atomic: only claim a spot if one is really left, so two quick accepts can't overfill.
      const claimed = await Lfg.findOneAndUpdate(
        { _id: post._id, status: 'open', $expr: { $lt: ['$filled', '$slots'] } },
        { $inc: { filled: 1, pendingCount: -1 } },
        { new: true }
      ).lean();
      if (!claimed) return fail(res, 400, 'There are no spots left.');
      if (claimed.filled >= claimed.slots) await Lfg.updateOne({ _id: post._id }, { $set: { status: 'full' } });
    } else {
      await Lfg.updateOne({ _id: post._id, pendingCount: { $gt: 0 } }, { $inc: { pendingCount: -1 } });
    }
    request.status = decision;
    await request.save();

    await notify({
      recipient: request.user, actor: req.user._id, lfg: post._id,
      type: decision === 'accepted' ? 'lfg_accept' : 'lfg_decline',
      key: `lfg_${decision}:${post._id}:${request.user}`,
    });
    return res.json({ success: true, data: { status: decision } });
  } catch (error) { return next(error); }
}
router.post('/:id/requests/:userId/accept', requireAuth, actionLimit, (req, res, next) => decide(req, res, next, 'accepted'));
router.post('/:id/requests/:userId/decline', requireAuth, actionLimit, (req, res, next) => decide(req, res, next, 'declined'));

// POST /api/lfg/:id/close
router.post('/:id/close', requireAuth, actionLimit, async (req, res, next) => {
  try {
    const post = await loadPost(req, res);
    if (!post) return undefined;
    if (idOf(post.author) !== String(req.user._id)) return fail(res, 403, 'Only the host can close this.');
    await Lfg.updateOne({ _id: post._id }, { $set: { status: 'closed' } });
    return res.json({ success: true, data: { ok: true } });
  } catch (error) { return next(error); }
});

// DELETE /api/lfg/:id
router.delete('/:id', requireAuth, actionLimit, async (req, res, next) => {
  try {
    const post = await loadPost(req, res);
    if (!post) return undefined;
    if (idOf(post.author) !== String(req.user._id)) return fail(res, 403, 'Only the host can delete this.');
    await LfgRequest.deleteMany({ lfg: post._id });
    await Lfg.deleteOne({ _id: post._id });
    return res.json({ success: true, data: { ok: true } });
  } catch (error) { return next(error); }
});

module.exports = router;
