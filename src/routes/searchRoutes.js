const express = require('express');
const User = require('../models/User');
const Game = require('../models/Game');
const Community = require('../models/Community');
const { optionalAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const { blockedEitherWay } = require('../services/blocks');
const router = express.Router();
const searchLimit = rateLimit({ name: 'global-search', max: 240, windowMs: 15 * 60 * 1000 });

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/search?q=term  ->  { players, games, communities }
// Works for guests too. Private profiles and private communities are never returned.
router.get('/', searchLimit, optionalAuth, async (req, res, next) => {
  try {
    const raw = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
    if (raw.length < 2) return res.json({ success: true, data: { query: raw, players: [], games: [], communities: [] } });
    const term = escapeRegex(raw);
    const starts = { $regex: `^${term}`, $options: 'i' };
    const contains = { $regex: term, $options: 'i' };

    const hidden = await blockedEitherWay(req.user?._id);
    const [players, games, communities] = await Promise.all([
      User.find({
        $or: [{ username: starts }, { displayName: contains }],
        'privacy.profileVisibility': { $ne: 'private' },
        _id: { $nin: hidden }
      })
        .select('username displayName avatar bio')
        .sort({ username: 1 })
        .limit(6)
        .lean(),
      Game.find({ active: true, $or: [{ name: contains }, { aliases: starts }, { slug: starts }] })
        .select('slug name genres')
        .sort({ name: 1 })
        .limit(5)
        .lean(),
      Community.find({ active: true, visibility: 'public', $or: [{ name: contains }, { slug: starts }] })
        .select('slug name accent memberCount game games')
        .sort({ memberCount: -1, _id: 1 })
        .limit(5)
        .lean()
    ]);

    res.json({
      success: true,
      data: {
        query: raw,
        players: players.map((user) => ({
          username: user.username,
          displayName: user.displayName || '',
          avatar: user.avatar || null,
          bio: (user.bio || '').slice(0, 80)
        })),
        games: games.map((game) => ({ slug: game.slug, name: game.name, genres: (game.genres || []).slice(0, 2) })),
        communities: communities.map((community) => ({
          slug: community.slug,
          name: community.name,
          accent: community.accent || '',
          memberCount: community.memberCount || 0,
          game: community.game || (community.games || [])[0] || ''
        }))
      }
    });
  } catch (error) { next(error); }
});

module.exports = router;
