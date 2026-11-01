// Admin control of communities, mounted at /api/admin/communities.
// Sits behind the admin sign-in in adminRoutes.js (separate from normal accounts).
const express = require('express');
const Community = require('../models/Community');
const Membership = require('../models/Membership');
const Game = require('../models/Game');
const User = require('../models/User');
const Post = require('../models/Post');
const AdminAction = require('../models/AdminAction');
const { removePosts } = require('../services/accountDeletion');

const router = express.Router();
const GENRE_IDS = ['sports', 'fps', 'rpg', 'battle-royale', 'racing', 'strategy', 'fighting', 'simulation', 'adventure', 'party'];
const validId = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _'-]{2,39}$/;

function slugify(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function record(action, community, summary = {}) {
  await AdminAction.create({ action, targetType: 'community', targetId: String(community._id), targetLabel: String(community.name || community.slug).slice(0, 80), summary });
}

async function staffFor(communityIds) {
  if (!communityIds.length) return new Map();
  const rows = await Membership.find({ community: { $in: communityIds }, role: { $in: ['owner', 'moderator'] } })
    .sort({ role: 1, createdAt: 1 }).populate('user', 'username displayName').lean();
  const byCommunity = new Map();
  for (const row of rows) {
    if (!row.user) continue;
    const key = String(row.community);
    if (!byCommunity.has(key)) byCommunity.set(key, []);
    byCommunity.get(key).push({ username: row.user.username, displayName: row.user.displayName || '', role: row.role });
  }
  return byCommunity;
}

function summarize(community, staff) {
  return {
    id: String(community._id),
    slug: community.slug,
    name: community.name,
    description: community.description || '',
    official: Boolean(community.official),
    active: community.active !== false,
    memberCount: community.memberCount || 0,
    postCount: community.postCount || 0,
    games: community.games || [],
    genres: community.genres || [],
    accent: community.accent || '#68d6bd',
    rules: community.rules || [],
    flairs: community.flairs || [],
    createdAt: community.createdAt,
    staff: staff || []
  };
}

// Validates the editable fields. Returns { error } or { value }.
async function readFields(body, { requireName }) {
  const value = {};
  if (requireName || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!NAME_PATTERN.test(name)) return { error: 'Use a name of 3 to 40 letters, numbers or spaces.' };
    value.name = name;
  }
  if (body.description !== undefined) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > 300) return { error: 'The description can be up to 300 characters.' };
    value.description = description;
  }
  if (body.accent !== undefined) {
    if (typeof body.accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.accent)) return { error: 'Choose a valid colour.' };
    value.accent = body.accent;
  }
  if (body.rules !== undefined) {
    const rules = (Array.isArray(body.rules) ? body.rules : []).filter((rule) => typeof rule === 'string').map((rule) => rule.trim()).filter(Boolean);
    if (rules.length > 8 || rules.some((rule) => rule.length > 120)) return { error: 'Use up to 8 rules of 120 characters each.' };
    value.rules = rules;
  }
  if (body.flairs !== undefined) {
    const flairs = [...new Set((Array.isArray(body.flairs) ? body.flairs : []).filter((flair) => typeof flair === 'string').map((flair) => flair.trim()).filter(Boolean))];
    if (flairs.length > 8 || flairs.some((flair) => flair.length > 24)) return { error: 'Use up to 8 flairs of 24 characters each.' };
    value.flairs = flairs;
  }
  if (body.genres !== undefined) {
    const genres = [...new Set((Array.isArray(body.genres) ? body.genres : []).filter((id) => GENRE_IDS.includes(id)))];
    if (genres.length > 3) return { error: 'Pick up to 3 genres.' };
    value.genres = genres;
  }
  if (body.games !== undefined) {
    const games = [...new Set((Array.isArray(body.games) ? body.games : []).filter((slug) => typeof slug === 'string' && /^[a-z0-9-]{2,60}$/.test(slug)))];
    if (games.length > 5) return { error: 'Pick up to 5 games.' };
    if (games.length) {
      const found = await Game.countDocuments({ slug: { $in: games }, active: true });
      if (found !== games.length) return { error: 'One of the games you picked is not available.' };
    }
    value.games = games;
    value.game = games[0] || null;
  }
  return { value };
}

// Games to choose from when creating or editing a community.
router.get('/games', async (req, res, next) => {
  try {
    const items = await Game.find({ active: true }).sort({ name: 1 }).select('slug name').lean();
    res.json({ success: true, data: { items } });
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
    const page = Math.max(Number.parseInt(req.query.page, 10) || 0, 0);
    const filter = {};
    const mode = ['official', 'community', 'archived'].includes(req.query.filter) ? req.query.filter : 'all';
    if (mode === 'official') { filter.official = true; filter.active = true; }
    else if (mode === 'community') { filter.official = { $ne: true }; filter.active = true; }
    else if (mode === 'archived') filter.active = false;
    else filter.active = true;
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const pattern = new RegExp(escapeRegex(req.query.q.trim().slice(0, 40)), 'i');
      filter.$or = [{ name: pattern }, { slug: pattern }];
    }
    const rows = await Community.find(filter).sort({ official: -1, memberCount: -1, _id: -1 }).skip(page * limit).limit(limit + 1).lean();
    const shown = rows.slice(0, limit);
    const staff = await staffFor(shown.map((row) => row._id));
    res.json({ success: true, data: { items: shown.map((row) => summarize(row, staff.get(String(row._id)))), nextPage: rows.length > limit ? page + 1 : null } });
  } catch (error) { next(error); }
});

// Create an official community (no single owner; appoint staff afterwards).
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const parsed = await readFields({ ...body, rules: body.rules ?? ['Keep it friendly.', 'No spam or harassment.'], flairs: body.flairs ?? ['Discussion', 'Clip', 'Question', 'Guide'] }, { requireName: true });
    if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
    const baseSlug = slugify(parsed.value.name);
    if (baseSlug.length < 2) return res.status(400).json({ success: false, error: 'Choose a name with letters or numbers in it.' });

    let community = null;
    for (let attempt = 0; attempt < 6 && !community; attempt += 1) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug.slice(0, 36)}-${attempt + 1}`;
      try {
        community = await Community.create({ games: [], genres: [], accent: '#68d6bd', ...parsed.value, slug, official: true, visibility: 'public', ownerUser: null, memberCount: 0 });
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    if (!community) return res.status(409).json({ success: false, error: 'That name is taken. Try a different one.' });
    await record('create_community', community, { official: 1 });
    res.status(201).json({ success: true, data: { community: summarize(community.toObject(), []) } });
  } catch (error) { next(error); }
});

async function loadCommunity(req, res) {
  if (!validId(req.params.id)) { res.status(400).json({ success: false, error: 'Invalid community.' }); return null; }
  const community = await Community.findById(req.params.id);
  if (!community) { res.status(404).json({ success: false, error: 'That community no longer exists.' }); return null; }
  return community;
}

router.patch('/:id', async (req, res, next) => {
  try {
    const community = await loadCommunity(req, res); if (!community) return;
    const parsed = await readFields(req.body || {}, { requireName: false });
    if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
    Object.assign(community, parsed.value);
    await community.save();
    await record('edit_community', community);
    const staff = await staffFor([community._id]);
    res.json({ success: true, data: { community: summarize(community.toObject(), staff.get(String(community._id))) } });
  } catch (error) { next(error); }
});

router.patch('/:id/official', async (req, res, next) => {
  try {
    if (typeof req.body?.official !== 'boolean') return res.status(400).json({ success: false, error: 'Choose official or not official.' });
    const community = await loadCommunity(req, res); if (!community) return;
    if (!req.body.official && community.slug === 'arcadia') return res.status(409).json({ success: false, error: 'The Arcadia community must stay official.' });
    community.official = req.body.official;
    await community.save();
    await record(req.body.official ? 'make_official' : 'remove_official', community);
    const staff = await staffFor([community._id]);
    res.json({ success: true, data: { community: summarize(community.toObject(), staff.get(String(community._id))) } });
  } catch (error) { next(error); }
});

// Archive hides a community from lists and keeps its posts. Restore brings it back.
router.patch('/:id/active', async (req, res, next) => {
  try {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ success: false, error: 'Choose archive or restore.' });
    const community = await loadCommunity(req, res); if (!community) return;
    if (!req.body.active && community.slug === 'arcadia') return res.status(409).json({ success: false, error: 'The Arcadia community cannot be archived.' });
    community.active = req.body.active;
    await community.save();
    await record(req.body.active ? 'restore_community' : 'archive_community', community);
    const staff = await staffFor([community._id]);
    res.json({ success: true, data: { community: summarize(community.toObject(), staff.get(String(community._id))) } });
  } catch (error) { next(error); }
});

// Appoint or remove staff by username: role is owner, moderator, member or remove.
router.put('/:id/staff', async (req, res, next) => {
  try {
    const community = await loadCommunity(req, res); if (!community) return;
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase().replace(/^@/, '') : '';
    const role = req.body?.role;
    if (!/^[a-z0-9_]{3,24}$/.test(username) || !['owner', 'moderator', 'member', 'remove'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Enter a username and choose a role.' });
    }
    const user = await User.findOne({ username }).select('_id username').lean();
    if (!user) return res.status(404).json({ success: false, error: `No player named @${username}.` });

    const existing = await Membership.findOne({ community: community._id, user: user._id });
    if (role === 'remove') {
      if (existing) {
        await Membership.deleteOne({ _id: existing._id });
        await Community.updateOne({ _id: community._id, memberCount: { $gt: 0 } }, { $inc: { memberCount: -1 } });
        try { req.app.get('io')?.in(`user:${user._id}`).socketsLeave(`community:${community._id}`); } catch { /* not connected */ }
        if (String(community.ownerUser || '') === String(user._id)) await Community.updateOne({ _id: community._id }, { $set: { ownerUser: null } });
      }
    } else if (existing) {
      existing.role = role;
      await existing.save();
    } else {
      await Membership.create({ community: community._id, user: user._id, role });
      await Community.updateOne({ _id: community._id }, { $inc: { memberCount: 1 } });
    }
    if (role === 'owner' && !community.ownerUser) await Community.updateOne({ _id: community._id }, { $set: { ownerUser: user._id } });
    await record('set_staff', community, { username, role });
    const staff = await staffFor([community._id]);
    res.json({ success: true, data: { staff: staff.get(String(community._id)) || [] } });
  } catch (error) { next(error); }
});

router.get('/:id/posts', async (req, res, next) => {
  try {
    const community = await loadCommunity(req, res); if (!community) return;
    const filter = { removedAt: null, destinations: { $elemMatch: { type: 'community', target: community.slug } } };
    if (req.query.cursor) {
      if (!validId(req.query.cursor)) return res.status(400).json({ success: false, error: 'Invalid cursor.' });
      filter._id = { $lt: req.query.cursor };
    }
    const rows = await Post.find(filter).sort({ _id: -1 }).limit(11).populate('author', 'username displayName').select('author title body createdAt score commentCount pinnedAt').lean();
    const page = rows.slice(0, 10);
    res.json({
      success: true,
      data: {
        items: page.map((post) => ({ id: String(post._id), title: post.title || '', body: post.body || '', author: post.author?.username || 'unknown', createdAt: post.createdAt, score: post.score || 0, comments: post.commentCount || 0, pinned: Boolean(post.pinnedAt) })),
        nextCursor: rows.length > 10 ? String(page[page.length - 1]._id) : null
      }
    });
  } catch (error) { next(error); }
});

router.delete('/:id/posts/:postId', async (req, res, next) => {
  try {
    const community = await loadCommunity(req, res); if (!community) return;
    if (!validId(req.params.postId)) return res.status(400).json({ success: false, error: 'Invalid post.' });
    const post = await Post.findOne({ _id: req.params.postId, removedAt: null, destinations: { $elemMatch: { type: 'community', target: community.slug } } }).select('author title body').populate('author', 'username').lean();
    if (!post) return res.status(404).json({ success: false, error: 'That post no longer exists.' });
    // removePosts also corrects the community's post counter.
    const summary = await removePosts([post._id]);
    await AdminAction.create({ action: 'delete_post', targetType: 'post', targetId: String(post._id), targetLabel: `${post.author?.username || 'unknown'}: ${(post.title || post.body || '').slice(0, 40)}`, summary });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) { next(error); }
});

module.exports = router;
