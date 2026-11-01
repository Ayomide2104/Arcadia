const express = require('express');
const mongoose = require('mongoose');
const Game = require('../models/Game');
const User = require('../models/User');
const Post = require('../models/Post');
const Community = require('../models/Community');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const router = express.Router();
const catalogLimit = rateLimit({ name: 'game-search', max: 120, windowMs: 15 * 60 * 1000 });

/*
  Popularity ("picks") counts how often people choose a game, everywhere:
    - players who have it in their favourite games
    - posts tagged with the game
    - communities built around the game
  The total is cached for a minute so the Games page stays cheap.
*/
const PICKS_TTL_MS = 60 * 1000;
let picksCache = { at: 0, map: new Map() };

async function getPicks() {
  if (Date.now() - picksCache.at < PICKS_TTL_MS) return picksCache.map;
  const [favourites, tagged, communities] = await Promise.all([
    User.aggregate([
      { $match: { 'favoriteGames.0': { $exists: true } } },
      { $unwind: '$favoriteGames' },
      { $group: { _id: '$favoriteGames', n: { $sum: 1 } } }
    ]),
    Post.aggregate([
      { $match: { removedAt: null, 'destinations.type': 'game' } },
      { $unwind: '$destinations' },
      { $match: { 'destinations.type': 'game' } },
      { $group: { _id: '$destinations.target', n: { $sum: 1 } } }
    ]),
    Community.aggregate([
      { $match: { active: true } },
      { $project: { focus: { $setUnion: [{ $ifNull: ['$games', []] }, { $cond: [{ $ifNull: ['$game', false] }, ['$game'], []] }] } } },
      { $unwind: '$focus' },
      { $group: { _id: '$focus', n: { $sum: 1 } } }
    ])
  ]);
  const map = new Map();
  for (const list of [favourites, tagged, communities]) {
    for (const row of list) map.set(row._id, (map.get(row._id) || 0) + row.n);
  }
  picksCache = { at: Date.now(), map };
  return map;
}

function withPicks(items, picks) {
  return items.map((item) => ({ ...item, picks: picks.get(item.slug) || 0 }));
}

function byPicks(a, b) {
  return (b.picks - a.picks) || a.name.localeCompare(b.name);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', catalogLimit, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
    const query = { active: true };
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const term = escapeRegex(req.query.q.trim().slice(0, 40));
      query.$or = [{ name: { $regex: `^${term}`, $options: 'i' } }, { aliases: { $regex: `^${term}`, $options: 'i' } }];
    }
    if (typeof req.query.genre === 'string' && /^[a-z-]{2,32}$/.test(req.query.genre)) query.genres = req.query.genre;

    // Most picked first. Games are few, so sorting in memory is fine.
    if (req.query.sort === 'popular') {
      const picks = await getPicks();
      const all = withPicks(await Game.find(query).select('-__v').lean(), picks).sort(byPicks);
      return res.json({ success: true, data: { items: all.slice(0, limit), nextCursor: null } });
    }

    if (req.query.cursor) {
      if (!mongoose.Types.ObjectId.isValid(req.query.cursor)) return res.status(400).json({ success: false, error: 'Invalid pagination cursor.' });
      query._id = { $gt: req.query.cursor };
    }
    const items = await Game.find(query).sort({ _id: 1 }).limit(limit).select('-__v').lean();
    const picks = await getPicks();
    res.json({ success: true, data: { items: withPicks(items, picks), nextCursor: items.length === limit ? String(items.at(-1)._id) : null } });
  } catch (error) { next(error); }
});

router.get('/popular', catalogLimit, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 8, 1), 20);
    const picks = await getPicks();
    const all = withPicks(await Game.find({ active: true }).select('-__v').lean(), picks).sort(byPicks);
    res.json({ success: true, data: { items: all.slice(0, limit) } });
  } catch (error) { next(error); }
});

router.get('/:slug', catalogLimit, async (req, res, next) => {
  try {
    if (!/^[a-z0-9-]{2,60}$/.test(req.params.slug)) return res.status(400).json({ success: false, error: 'Invalid game.' });
    const game = await Game.findOne({ slug: req.params.slug, active: true }).select('-__v').lean();
    if (!game) return res.status(404).json({ success: false, error: 'Game not found.' });
    const picks = await getPicks();
    const communities = await Community.find({
      active: true, visibility: 'public', $or: [{ games: game.slug }, { game: game.slug }]
    }).select('slug name accent memberCount description official').sort({ official: -1, memberCount: -1, _id: 1 }).limit(4).lean();
    res.json({ success: true, data: { game: { ...game, picks: picks.get(game.slug) || 0 }, communities } });
  } catch (error) { next(error); }
});

router.put('/:slug/interest', requireAuth, async (req, res, next) => {
  try {
    if (!/^[a-z0-9-]{2,60}$/.test(req.params.slug)) return res.status(400).json({ success: false, error: 'Invalid game.' });
    const game = await Game.findOne({ slug: req.params.slug, active: true }).select('slug name').lean();
    if (!game) return res.status(404).json({ success: false, error: 'Game not found.' });
    const interested = req.body?.interested;
    if (typeof interested !== 'boolean') return res.status(400).json({ success: false, error: 'Interest must be true or false.' });
    await User.updateOne({ _id: req.user._id }, interested ? { $addToSet: { favoriteGames: game.slug } } : { $pull: { favoriteGames: game.slug } });
    picksCache.at = 0;
    res.json({ success: true, data: { game, interested } });
  } catch (error) { next(error); }
});

module.exports = router;
