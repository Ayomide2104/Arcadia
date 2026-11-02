const express = require('express');
const mongoose = require('mongoose');
const Community = require('../models/Community');
const Membership = require('../models/Membership');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Vote = require('../models/Vote');
const Game = require('../models/Game');
const User = require('../models/User');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { recordCommunityJoin } = require('../services/interests');
const router = express.Router();
const discoveryLimit = rateLimit({ name: 'community-search', max: 120, windowMs: 15 * 60 * 1000 });
const communityPostLimit = rateLimit({ name: 'community-post', max: 20, windowMs: 15 * 60 * 1000 });
const communityCreateLimit = rateLimit({ name: 'community-create', max: 5, windowMs: 60 * 60 * 1000 });
const voteLimit = rateLimit({ name: 'community-vote', max: 120, windowMs: 5 * 60 * 1000 });

const GENRE_IDS = ['sports', 'fps', 'rpg', 'battle-royale', 'racing', 'strategy', 'fighting', 'simulation', 'adventure', 'party'];
const GENRE_ACCENTS = {
  sports: '#53dcaa', fps: '#ff8193', rpg: '#8ca7f2', 'battle-royale': '#e8ad6a', racing: '#65d6c1',
  strategy: '#e37b73', fighting: '#f17f80', simulation: '#79c76a', adventure: '#e09a78', party: '#e989a6'
};
const MAX_OWNED_COMMUNITIES = 10;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function csv(value, pattern, max) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').map((item) => item.trim()).filter((item) => pattern.test(item)))].slice(0, max);
}

function focusGames(community) {
  return [...new Set([...(community.games || []), community.game].filter(Boolean))];
}

function publicCommunity(community) {
  const { ownerUser, ...rest } = community;
  return rest;
}

async function roleOf(communityId, userId) {
  if (!userId) return null;
  return (await Membership.findOne({ community: communityId, user: userId }).select('role').lean())?.role || null;
}

/* ---------- Discovery ---------- */

router.get('/', discoveryLimit, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 50);
    const clauses = [{ active: true, visibility: 'public' }];
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const term = escapeRegex(req.query.q.trim().slice(0, 40));
      clauses.push({ $or: [{ name: { $regex: term, $options: 'i' } }, { slug: { $regex: term, $options: 'i' } }] });
    }
    if (typeof req.query.game === 'string' && /^[a-z0-9-]{2,60}$/.test(req.query.game)) {
      clauses.push({ $or: [{ game: req.query.game }, { games: req.query.game }] });
    }
    if (typeof req.query.genre === 'string' && /^[a-z-]{2,32}$/.test(req.query.genre)) clauses.push({ genres: req.query.genre });
    if (req.query.official === '1') clauses.push({ official: true });
    const games = csv(req.query.games, /^[a-z0-9-]{2,60}$/, 20);
    const genres = csv(req.query.genres, /^[a-z-]{2,32}$/, 10);
    if (games.length || genres.length) {
      clauses.push({ $or: [{ game: { $in: games } }, { games: { $in: games } }, { genres: { $in: genres } }] });
    }
    const query = clauses.length === 1 ? clauses[0] : { $and: clauses };

    const sort = ['popular', 'new'].includes(req.query.sort) ? req.query.sort : null;
    if (sort) {
      const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
      const items = await Community.find(query).select('-ownerUser')
        .sort(sort === 'popular' ? { memberCount: -1, _id: 1 } : { _id: -1 })
        .skip(offset).limit(limit).lean();
      return res.json({ success: true, data: { items, nextCursor: null, nextOffset: items.length === limit ? offset + limit : null } });
    }

    if (req.query.cursor) {
      if (!mongoose.Types.ObjectId.isValid(req.query.cursor)) return res.status(400).json({ success: false, error: 'Invalid pagination cursor.' });
      query._id = { $gt: req.query.cursor };
    }
    const items = await Community.find(query).select('-ownerUser').sort({ _id: 1 }).limit(limit).lean();
    res.json({ success: true, data: { items, nextCursor: items.length === limit ? String(items.at(-1)._id) : null } });
  } catch (error) { next(error); }
});

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const memberships = await Membership.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).populate({ path: 'community', select: '-ownerUser' }).lean();
    res.json({ success: true, data: { items: memberships.filter((entry) => entry.community && entry.community.active !== false).map((entry) => ({ ...entry.community, role: entry.role })) } });
  } catch (error) { next(error); }
});

// Posts from every community the signed-in user has joined (feed "Communities" tab).
router.get('/feed', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 30);
    const memberships = await Membership.find({ user: req.user._id }).select('community').lean();
    const communities = await Community.find({ _id: { $in: memberships.map((entry) => entry.community) }, active: true }).select('slug name accent').lean();
    const slugs = communities.map((community) => community.slug);
    if (!slugs.length) return res.json({ success: true, data: { items: [], nextCursor: null } });
    const query = { removedAt: null, destinations: { $elemMatch: { type: 'community', target: { $in: slugs } } } };
    if (req.query.cursor) {
      if (!mongoose.Types.ObjectId.isValid(req.query.cursor)) return res.status(400).json({ success: false, error: 'Invalid pagination cursor.' });
      query._id = { $lt: req.query.cursor };
    }
    const posts = await Post.find(query).sort({ _id: -1 }).limit(limit).populate('author', 'username displayName avatar').lean();
    // Each post knows which community it belongs to, so the feed can show "c/name" like a subreddit post.
    const bySlug = new Map(communities.map((community) => [community.slug, community]));
    const withCommunity = posts.map((post) => {
      const target = (post.destinations || []).find((destination) => destination.type === 'community' && bySlug.has(destination.target));
      const community = target ? bySlug.get(target.target) : null;
      return { ...post, community: community ? { slug: community.slug, name: community.name, accent: community.accent } : null };
    });
    const items = await attachVotes(withCommunity, req.user);
    res.json({ success: true, data: { items, nextCursor: posts.length === limit ? String(posts.at(-1)._id) : null } });
  } catch (error) { next(error); }
});

// Communities that match the games and genres the signed-in user picked.
router.get('/suggested', requireAuth, async (req, res, next) => {
  try {
    const myGames = req.user.favoriteGames || [];
    const myGenres = req.user.genres || [];
    const joined = (await Membership.find({ user: req.user._id }).select('community').lean()).map((entry) => entry.community);
    const base = { active: true, visibility: 'public', _id: { $nin: joined } };
    let fallback = false;
    let items = [];

    if (myGames.length || myGenres.length) {
      const found = await Community.find({ ...base, $or: [{ game: { $in: myGames } }, { games: { $in: myGames } }, { genres: { $in: myGenres } }] })
        .select('-ownerUser').limit(60).lean();
      items = found.map((community) => {
        const matchedGames = focusGames(community).filter((slug) => myGames.includes(slug));
        const matchedGenres = (community.genres || []).filter((id) => myGenres.includes(id));
        return { ...community, match: { games: matchedGames, genres: matchedGenres }, _score: matchedGames.length * 3 + matchedGenres.length + (community.official ? 2 : 0) };
      }).sort((a, b) => (b._score - a._score) || (b.memberCount - a.memberCount)).slice(0, 12)
        .map(({ _score, ...rest }) => rest);
    }

    if (!items.length) {
      fallback = true;
      items = await Community.find(base).select('-ownerUser').sort({ official: -1, memberCount: -1, _id: 1 }).limit(8).lean();
    }

    // Everyone is offered the official Arcadia community first.
    if (!items.some((item) => item.slug === 'arcadia')) {
      const arcadia = await Community.findOne({ ...base, slug: 'arcadia' }).select('-ownerUser').lean();
      if (arcadia) items.unshift({ ...arcadia, match: { games: [], genres: [] } });
    } else {
      items.sort((a, b) => (b.slug === 'arcadia') - (a.slug === 'arcadia'));
    }
    res.json({ success: true, data: { items, fallback } });
  } catch (error) { next(error); }
});

// Public list of the communities a player belongs to (for profiles).
router.get('/of/:username', optionalAuth, async (req, res, next) => {
  try {
    if (!/^[a-z0-9_]{3,24}$/i.test(req.params.username)) return res.status(400).json({ success: false, error: 'Invalid username.' });
    const target = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id').lean();
    if (!target) return res.status(404).json({ success: false, error: 'Player not found.' });
    const isSelf = Boolean(req.user && String(req.user._id) === String(target._id));
    const memberships = await Membership.find({ user: target._id }).sort({ createdAt: -1 }).limit(50).populate({ path: 'community', select: '-ownerUser' }).lean();
    const items = memberships
      .filter((entry) => entry.community && entry.community.active !== false && (isSelf || entry.community.visibility === 'public'))
      .map((entry) => ({ ...entry.community, role: entry.role }));
    res.json({ success: true, data: { items } });
  } catch (error) { next(error); }
});

/* ---------- Create ---------- */

router.post('/', requireAuth, communityCreateLimit, async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9 _'-]{2,39}$/.test(name)) {
      return res.status(400).json({ success: false, error: 'Give your community a name of 3 to 40 letters, numbers or spaces.' });
    }
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > 300) return res.status(400).json({ success: false, error: 'The description can be up to 300 characters.' });

    const games = [...new Set(Array.isArray(body.games) ? body.games.filter((slug) => typeof slug === 'string' && /^[a-z0-9-]{2,60}$/.test(slug)) : [])];
    const genres = [...new Set(Array.isArray(body.genres) ? body.genres.filter((id) => GENRE_IDS.includes(id)) : [])];
    if (games.length > 5) return res.status(400).json({ success: false, error: 'Pick up to 5 games.' });
    if (genres.length > 3) return res.status(400).json({ success: false, error: 'Pick up to 3 genres.' });
    if (!games.length && !genres.length) {
      return res.status(400).json({ success: false, error: 'A community needs a focus. Pick at least one game or genre.' });
    }
    const found = games.length ? await Game.find({ slug: { $in: games }, active: true }).select('slug accent').lean() : [];
    if (found.length !== games.length) return res.status(400).json({ success: false, error: 'One of the games you picked is not available.' });

    const rules = (Array.isArray(body.rules) ? body.rules : []).filter((rule) => typeof rule === 'string').map((rule) => rule.trim()).filter(Boolean);
    if (rules.length > 8 || rules.some((rule) => rule.length > 120)) {
      return res.status(400).json({ success: false, error: 'Use up to 8 rules of 120 characters each.' });
    }

    const owned = await Membership.countDocuments({ user: req.user._id, role: 'owner' });
    if (owned >= MAX_OWNED_COMMUNITIES) return res.status(409).json({ success: false, error: `You can own up to ${MAX_OWNED_COMMUNITIES} communities.` });

    const firstGame = found.find((game) => game.slug === games[0]);
    const accent = /^#[0-9a-fA-F]{6}$/.test(body.accent || '') ? body.accent : (firstGame?.accent || GENRE_ACCENTS[genres[0]] || '#68d6bd');

    const baseSlug = slugify(name);
    if (baseSlug.length < 2) return res.status(400).json({ success: false, error: 'Choose a name with letters or numbers in it.' });

    let community = null;
    for (let attempt = 0; attempt < 6 && !community; attempt += 1) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug.slice(0, 36)}-${attempt + 1}`;
      try {
        community = await Community.create({
          slug, name, description, games, genres, game: games[0] || null,
          rules: rules.length ? rules : ['Keep it friendly.', 'No spam or harassment.'],
          flairs: ['Discussion', 'Clip', 'Question', 'Guide'],
          accent, visibility: 'public', ownerUser: req.user._id, memberCount: 1
        });
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    if (!community) return res.status(409).json({ success: false, error: 'That name is taken. Try a different one.' });

    await Membership.create({ community: community._id, user: req.user._id, role: 'owner' });
    res.status(201).json({ success: true, data: { community: { ...publicCommunity(community.toObject()), role: 'owner' } } });
  } catch (error) { next(error); }
});

/* ---------- Join / leave / roles (unchanged behaviour) ---------- */

router.post('/:slug/join', requireAuth, async (req, res, next) => {
  try {
    const community = await Community.findOne({ slug: req.params.slug, active: true, visibility: 'public' });
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    // Joining never grants ownership. Ownerless communities (official ones and
    // the seeded lounges) are run by Arcadia; use scripts/setCommunityRole.js to appoint staff.
    const role = 'member';
    let result;
    try { result = await Membership.updateOne({ community: community._id, user: req.user._id }, { $setOnInsert: { community: community._id, user: req.user._id, role } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; result = { upsertedCount: 0 }; }
    if (result.upsertedCount) { await Community.updateOne({ _id: community._id }, { $inc: { memberCount: 1 } }); void recordCommunityJoin(req.user._id, community.slug); }
    const count = await Membership.countDocuments({ community: community._id });
    res.json({ success: true, data: { joined: true, memberCount: count } });
  } catch (error) { next(error); }
});

router.delete('/:slug/join', requireAuth, async (req, res, next) => {
  try {
    const community = await Community.findOne({ slug: req.params.slug, active: true });
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    const membership = await Membership.findOne({ community: community._id, user: req.user._id });
    if (membership?.role === 'owner') return res.status(409).json({ success: false, error: 'Community owners cannot leave without transferring ownership.' });
    if (membership) {
      const removed = await Membership.deleteOne({ _id: membership._id });
      if (removed.deletedCount) await Community.updateOne({ _id: community._id, memberCount: { $gt: 0 } }, { $inc: { memberCount: -1 } });
      // Stop live chat updates for a community the player just left.
      try { req.app.get('io')?.in(`user:${req.user._id}`).socketsLeave(`community:${community._id}`); } catch { /* not connected */ }
    }
    res.json({ success: true, data: { joined: false, memberCount: await Membership.countDocuments({ community: community._id }) } });
  } catch (error) { next(error); }
});

router.patch('/:slug/members/:username/role', requireAuth, async (req, res, next) => {
  try {
    if (!/^[a-z0-9_]{3,24}$/i.test(req.params.username) || !['member', 'moderator'].includes(req.body?.role)) return res.status(400).json({ success: false, error: 'Choose a valid member and role.' });
    const community = await Community.findOne({ slug: req.params.slug, active: true }).select('_id').lean(); if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    const actor = await Membership.findOne({ community: community._id, user: req.user._id }).select('role').lean(); if (actor?.role !== 'owner') return res.status(403).json({ success: false, error: 'Only the owner can manage moderators.' });
    const targetUser = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id').lean(); if (!targetUser) return res.status(404).json({ success: false, error: 'Member not found.' });
    const target = await Membership.findOne({ community: community._id, user: targetUser._id }); if (!target) return res.status(404).json({ success: false, error: 'Member not found.' }); if (target.role === 'owner') return res.status(409).json({ success: false, error: 'The community owner role cannot be changed here.' });
    target.role = req.body.role; await target.save(); res.json({ success: true, data: { username: req.params.username.toLowerCase(), role: target.role } });
  } catch (error) { next(error); }
});

/* ---------- Community page ---------- */

router.get('/:slug', optionalAuth, async (req, res, next) => {
  try {
    const community = await Community.findOne({ slug: req.params.slug, active: true }).lean();
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    const role = await roleOf(community._id, req.user?._id);
    if (community.visibility === 'private' && !role) return res.status(403).json({ success: false, error: 'This community is private.' });
    const staff = await Membership.find({ community: community._id, role: { $in: ['owner', 'moderator'] } })
      .sort({ role: 1, createdAt: 1 }).limit(12).populate('user', 'username displayName avatar').lean();
    res.json({
      success: true,
      data: {
        community: publicCommunity(community),
        role,
        moderators: staff.filter((entry) => entry.user).map((entry) => ({ ...entry.user, role: entry.role }))
      }
    });
  } catch (error) { next(error); }
});

router.patch('/:slug', requireAuth, async (req, res, next) => {
  try {
    const community = await Community.findOne({ slug: req.params.slug, active: true });
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    if (await roleOf(community._id, req.user._id) !== 'owner') return res.status(403).json({ success: false, error: 'Only the owner can edit this community.' });
    const body = req.body || {};
    if (typeof body.description === 'string') {
      if (body.description.trim().length > 300) return res.status(400).json({ success: false, error: 'The description can be up to 300 characters.' });
      community.description = body.description.trim();
    }
    if (Array.isArray(body.rules)) {
      const rules = body.rules.filter((rule) => typeof rule === 'string').map((rule) => rule.trim()).filter(Boolean);
      if (rules.length > 8 || rules.some((rule) => rule.length > 120)) return res.status(400).json({ success: false, error: 'Use up to 8 rules of 120 characters each.' });
      community.rules = rules;
    }
    if (Array.isArray(body.flairs)) {
      const flairs = [...new Set(body.flairs.filter((flair) => typeof flair === 'string').map((flair) => flair.trim()).filter(Boolean))];
      if (flairs.length > 8 || flairs.some((flair) => flair.length > 24)) return res.status(400).json({ success: false, error: 'Use up to 8 flairs of 24 characters each.' });
      community.flairs = flairs;
    }
    await community.save();
    res.json({ success: true, data: { community: publicCommunity(community.toObject()) } });
  } catch (error) { next(error); }
});

/* ---------- Posts: sorting, voting, pinning ---------- */

const POST_AUTHOR = 'username displayName avatar';

async function attachVotes(items, user) {
  if (!user || !items.length) return items.map((item) => ({ ...item, myVote: 0 }));
  const votes = await Vote.find({ user: user._id, post: { $in: items.map((item) => item._id) } }).select('post value').lean();
  const byPost = new Map(votes.map((vote) => [String(vote.post), vote.value]));
  return items.map((item) => ({ ...item, myVote: byPost.get(String(item._id)) || 0 }));
}

router.get('/:slug/posts', optionalAuth, async (req, res, next) => {
  try {
    const community = await Community.findOne({ slug: req.params.slug, active: true }).select('_id visibility').lean();
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    let role = null;
    if (req.user) role = (await Membership.findOne({ community: community._id, user: req.user._id }).select('role').lean())?.role || null;
    if (community.visibility === 'private') {
      if (!req.user) return res.status(401).json({ success: false, error: 'Sign in to view this community.' });
      if (!role) return res.status(403).json({ success: false, error: 'Join this community to view its posts.' });
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 30);
    const sort = ['hot', 'top', 'new'].includes(req.query.sort) ? req.query.sort : 'new';
    const page = Math.max(Number.parseInt(req.query.page, 10) || 0, 0);
    const base = { destinations: { $elemMatch: { type: 'community', target: req.params.slug } }, removedAt: null };
    const communityDetails = await Community.findById(community._id).select('name slug rules flairs accent game games genres memberCount postCount description createdAt').lean();

    let items;
    let nextCursor = null;
    let nextPage = null;
    if (sort === 'new') {
      const query = { ...base, pinnedAt: null };
      if (req.query.cursor) {
        if (!mongoose.Types.ObjectId.isValid(req.query.cursor)) return res.status(400).json({ success: false, error: 'Invalid pagination cursor.' });
        query._id = { $lt: req.query.cursor };
      }
      items = await Post.find(query).sort({ _id: -1 }).limit(limit).populate('author', POST_AUTHOR).lean();
      nextCursor = items.length === limit ? String(items.at(-1)._id) : null;
    } else if (sort === 'top') {
      items = await Post.find({ ...base, pinnedAt: null }).sort({ score: -1, _id: -1 }).skip(page * limit).limit(limit).populate('author', POST_AUTHOR).lean();
      nextPage = items.length === limit ? page + 1 : null;
    } else {
      // Hot: vote score weighed against age, like a subreddit front page.
      const raw = await Post.aggregate([
        { $match: { ...base, pinnedAt: null } },
        { $addFields: { _s: { $ifNull: ['$score', 0] } } },
        { $addFields: { _hot: { $add: [
          { $multiply: [{ $cond: [{ $gt: ['$_s', 0] }, 1, { $cond: [{ $lt: ['$_s', 0] }, -1, 0] }] }, { $log10: { $max: [{ $abs: '$_s' }, 1] } }] },
          { $divide: [{ $subtract: [{ $toLong: '$createdAt' }, 1700000000000] }, 45000000] }
        ] } } },
        { $sort: { _hot: -1, _id: -1 } },
        { $skip: page * limit },
        { $limit: limit },
        { $project: { _s: 0, _hot: 0 } }
      ]);
      items = await Post.populate(raw, { path: 'author', select: POST_AUTHOR });
      nextPage = items.length === limit ? page + 1 : null;
    }

    // Pinned posts lead the first page of every sort.
    const isFirstPage = sort === 'new' ? !req.query.cursor : page === 0;
    if (isFirstPage) {
      const pinned = await Post.find({ ...base, pinnedAt: { $ne: null } }).sort({ pinnedAt: -1 }).limit(2).populate('author', POST_AUTHOR).lean();
      items = [...pinned, ...items];
    }
    items = await attachVotes(items, req.user);
    res.json({ success: true, data: { community: communityDetails, role, items, nextCursor, nextPage } });
  } catch (error) { next(error); }
});

router.get('/:slug/posts/:postId', optionalAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.postId)) return res.status(400).json({ success: false, error: 'Invalid post.' });
    const community = await Community.findOne({ slug: req.params.slug, active: true }).select('_id visibility').lean();
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    const role = await roleOf(community._id, req.user?._id);
    if (community.visibility === 'private' && !role) return res.status(403).json({ success: false, error: 'Join this community to view its posts.' });
    const post = await Post.findOne({ _id: req.params.postId, removedAt: null, destinations: { $elemMatch: { type: 'community', target: req.params.slug } } }).populate('author', POST_AUTHOR).lean();
    if (!post) return res.status(404).json({ success: false, error: 'Post not found.' });
    const comments = await Comment.find({ post: post._id }).sort({ _id: 1 }).limit(200).populate('author', POST_AUTHOR).lean();
    const [withVote] = await attachVotes([post], req.user);
    res.json({ success: true, data: { post: withVote, comments, role } });
  } catch (error) { next(error); }
});

router.put('/:slug/posts/:postId/vote', requireAuth, voteLimit, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.postId)) return res.status(400).json({ success: false, error: 'Invalid post.' });
    const value = req.body?.value;
    if (![1, -1, 0].includes(value)) return res.status(400).json({ success: false, error: 'Vote must be 1, -1 or 0.' });
    const community = await Community.findOne({ slug: req.params.slug, active: true }).select('_id visibility').lean();
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    if (community.visibility === 'private' && !(await roleOf(community._id, req.user._id))) return res.status(403).json({ success: false, error: 'Join this community to vote.' });
    const post = await Post.findOne({ _id: req.params.postId, removedAt: null, destinations: { $elemMatch: { type: 'community', target: req.params.slug } } }).select('_id').lean();
    if (!post) return res.status(404).json({ success: false, error: 'Post not found.' });

    const existing = await Vote.findOne({ post: post._id, user: req.user._id });
    const before = existing?.value || 0;
    if (value === 0) { if (existing) await Vote.deleteOne({ _id: existing._id }); }
    else if (existing) { existing.value = value; await existing.save(); }
    else {
      try { await Vote.create({ post: post._id, user: req.user._id, value }); }
      catch (error) { if (error.code !== 11000) throw error; }
    }
    const delta = value - before;
    const updated = delta
      ? await Post.findOneAndUpdate({ _id: post._id }, { $inc: { score: delta } }, { new: true }).select('score').lean()
      : await Post.findById(post._id).select('score').lean();
    res.json({ success: true, data: { score: updated?.score || 0, myVote: value } });
  } catch (error) { next(error); }
});

router.patch('/:slug/posts/:postId', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.postId) || typeof req.body?.pinned !== 'boolean') return res.status(400).json({ success: false, error: 'Choose pin or unpin.' });
    const community = await Community.findOne({ slug: req.params.slug, active: true }).select('_id').lean();
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    const role = await roleOf(community._id, req.user._id);
    if (!['owner', 'moderator'].includes(role)) return res.status(403).json({ success: false, error: 'Only moderators can pin posts.' });
    const filter = { _id: req.params.postId, removedAt: null, destinations: { $elemMatch: { type: 'community', target: req.params.slug } } };
    const post = await Post.findOne(filter).select('_id').lean();
    if (!post) return res.status(404).json({ success: false, error: 'Post not found.' });
    if (req.body.pinned) {
      const pinned = await Post.find({ destinations: filter.destinations, removedAt: null, pinnedAt: { $ne: null }, _id: { $ne: post._id } }).sort({ pinnedAt: 1 }).select('_id').lean();
      if (pinned.length >= 2) await Post.updateOne({ _id: pinned[0]._id }, { $set: { pinnedAt: null } });
    }
    await Post.updateOne({ _id: post._id }, { $set: { pinnedAt: req.body.pinned ? new Date() : null } });
    res.json({ success: true, data: { pinned: req.body.pinned } });
  } catch (error) { next(error); }
});

router.delete('/:slug/posts/:postId', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.postId)) return res.status(400).json({ success: false, error: 'Invalid post.' });
    const community = await Community.findOne({ slug: req.params.slug, active: true }).select('_id').lean();
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    const membership = await Membership.findOne({ community: community._id, user: req.user._id }).select('role').lean();
    const post = await Post.findOne({ _id: req.params.postId, removedAt: null, destinations: { $elemMatch: { type: 'community', target: req.params.slug } } }).select('destinations author').lean();
    if (!post) return res.status(404).json({ success: false, error: 'Community post not found.' });
    // Moderators can remove any post; authors can remove their own.
    const isAuthor = String(post.author) === String(req.user._id);
    const isStaff = Boolean(membership && ['owner', 'moderator'].includes(membership.role));
    if (!isAuthor && !isStaff) return res.status(403).json({ success: false, error: 'Only community moderators can remove posts.' });
    const otherDestinations = post.destinations.filter((destination) => destination.type !== 'community' || destination.target !== req.params.slug);
    if (otherDestinations.length) await Post.updateOne({ _id: post._id, removedAt: null }, { $pull: { destinations: { type: 'community', target: req.params.slug } } });
    else await Post.updateOne({ _id: post._id, removedAt: null }, { $set: { removedAt: new Date(), removedBy: req.user._id } });
    await Community.updateOne({ _id: community._id, postCount: { $gt: 0 } }, { $inc: { postCount: -1 } });
    res.json({ success: true, data: { removed: true } });
  } catch (error) { next(error); }
});

router.post('/:slug/posts', requireAuth, communityPostLimit, async (req, res, next) => {
  try {
    const community = await Community.findOne({ slug: req.params.slug, active: true }).select('_id slug visibility flairs').lean();
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    const member = await Membership.exists({ community: community._id, user: req.user._id });
    if (!member) return res.status(403).json({ success: false, error: 'Join this community before posting.' });
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const flair = typeof req.body?.flair === 'string' ? req.body.flair.trim() : '';
    if (body.length > 500) return res.status(400).json({ success: false, error: 'Post text can be up to 500 characters.' });
    if (title.length > 120) return res.status(400).json({ success: false, error: 'The title can be up to 120 characters.' });
    if (!body && !title) return res.status(400).json({ success: false, error: 'Add a title or some text to your post.' });
    if (flair && !(community.flairs || []).includes(flair)) return res.status(400).json({ success: false, error: 'Choose one of this community’s flairs.' });
    const post = await Post.create({ author: req.user._id, title, flair, body, destinations: [{ type: 'community', target: community.slug }] });
    await Community.updateOne({ _id: community._id }, { $inc: { postCount: 1 } });
    await post.populate('author', POST_AUTHOR);
    res.status(201).json({ success: true, data: { post } });
  } catch (error) { next(error); }
});

// Group chat: channels, messages, reactions and squad calls.
router.use('/', require('./communityChatRoutes'));

module.exports = router;
