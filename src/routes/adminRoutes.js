const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('../middleware/rateLimit');
const { adminEnabled, login, logout, requireAdmin } = require('../middleware/adminAuth');
const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Community = require('../models/Community');
const Message = require('../models/Message');
const Friendship = require('../models/Friendship');
const DailyActive = require('../models/DailyActive');
const AdminAction = require('../models/AdminAction');
const cloudinary = require('../config/cloudinary');
const presence = require('../services/presence');
const { today } = require('../services/activity');
const { describeUserImpact, deleteUserAndData, removePosts } = require('../services/accountDeletion');

const router = express.Router();
const DAY = 24 * 60 * 60 * 1000;
const validId = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.use(adminEnabled);
router.post('/login', rateLimit({ name: 'admin-login', max: 6, windowMs: 15 * 60 * 1000 }), login);
router.post('/logout', logout);

router.use(requireAdmin);
router.use(rateLimit({ name: 'admin-api', max: 1200, windowMs: 15 * 60 * 1000 }));

router.get('/me', (req, res) => {
  res.json({ success: true, data: { admin: true, csrfToken: req.admin.csrf } });
});

/* ---------------------------- analytics ---------------------------- */

function dayList(days) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1));
  return Array.from({ length: days }, (_, index) => new Date(start + index * DAY).toISOString().slice(0, 10));
}

const growth = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null);

async function uniqueActive(sinceDay) {
  const rows = await DailyActive.aggregate([
    { $match: { day: { $gte: sinceDay } } },
    { $group: { _id: '$user' } },
    { $count: 'n' }
  ]);
  return rows[0]?.n || 0;
}

async function totals() {
  const [users, posts, comments, communities, messages, friendships] = await Promise.all([
    User.countDocuments({}),
    Post.countDocuments({ removedAt: null }),
    Comment.countDocuments({}),
    Community.countDocuments({ active: true }),
    Message.countDocuments({}),
    Friendship.countDocuments({})
  ]);
  return { users, posts, comments, communities, messages, friendships };
}

router.get('/analytics', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 7), 90);
    const labels = dayList(days);
    const start = new Date(`${labels[0]}T00:00:00.000Z`);
    const now = Date.now();
    const todayDay = today();
    const day7 = dayList(7)[0];
    const day30 = dayList(30)[0];

    const [registrationRows, postRows, activeRows, usersBefore, newToday, new7, prev7, new30, prev30,
      dau, dauYesterday, wau, mau, firstActive, sums] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, n: { $sum: 1 } } }
      ]),
      Post.aggregate([
        { $match: { createdAt: { $gte: start }, removedAt: null } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, n: { $sum: 1 } } }
      ]),
      DailyActive.aggregate([
        { $match: { day: { $gte: labels[0] } } },
        { $group: { _id: '$day', n: { $sum: 1 } } }
      ]),
      User.countDocuments({ createdAt: { $lt: start } }),
      User.countDocuments({ createdAt: { $gte: new Date(now - DAY) } }),
      User.countDocuments({ createdAt: { $gte: new Date(now - 7 * DAY) } }),
      User.countDocuments({ createdAt: { $gte: new Date(now - 14 * DAY), $lt: new Date(now - 7 * DAY) } }),
      User.countDocuments({ createdAt: { $gte: new Date(now - 30 * DAY) } }),
      User.countDocuments({ createdAt: { $gte: new Date(now - 60 * DAY), $lt: new Date(now - 30 * DAY) } }),
      DailyActive.countDocuments({ day: todayDay }),
      DailyActive.countDocuments({ day: new Date(now - DAY).toISOString().slice(0, 10) }),
      uniqueActive(day7),
      uniqueActive(day30),
      DailyActive.findOne({}).sort({ day: 1 }).select('day').lean(),
      totals()
    ]);

    const byDay = (rows) => new Map(rows.map((row) => [row._id, row.n]));
    const regMap = byDay(registrationRows);
    const postMap = byDay(postRows);
    const activeMap = byDay(activeRows);

    let running = usersBefore;
    const registrations = labels.map((day) => regMap.get(day) || 0);
    const cumulative = registrations.map((n) => (running += n));

    res.json({
      success: true,
      data: {
        days,
        labels,
        registrations,
        cumulativeUsers: cumulative,
        dailyActive: labels.map((day) => activeMap.get(day) || 0),
        postsPerDay: labels.map((day) => postMap.get(day) || 0),
        activeDataSince: firstActive?.day || null,
        kpis: {
          totalUsers: sums.users,
          newToday,
          new7,
          new30,
          growth7: growth(new7, prev7),
          growth30: growth(new30, prev30),
          onlineNow: presence.onlineCount(),
          dau,
          dauYesterday,
          wau,
          mau,
          stickiness: mau > 0 ? Math.round((dau / mau) * 1000) / 10 : null
        },
        totals: sums
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/online', (req, res) => {
  res.json({ success: true, data: { onlineNow: presence.onlineCount() } });
});

/* ------------------------------ users ------------------------------ */

router.use('/communities', require('./adminCommunityRoutes'));

router.get('/users', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
    const filter = {};

    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ username: pattern }, { displayName: pattern }];
    }
    if (req.query.cursor) {
      if (!validId(req.query.cursor)) return res.status(400).json({ success: false, error: 'Invalid cursor.' });
      filter._id = { $lt: req.query.cursor };
    }

    // Only these fields are ever read: never passwords, never email.
    const rows = await User.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .select('username displayName avatar createdAt lastActiveAt onboardingComplete')
      .lean();

    const page = rows.slice(0, limit);
    const counts = page.length
      ? await Post.aggregate([{ $match: { author: { $in: page.map((u) => u._id) } } }, { $group: { _id: '$author', n: { $sum: 1 } } }])
      : [];
    const postCounts = new Map(counts.map((row) => [String(row._id), row.n]));

    res.json({
      success: true,
      data: {
        items: page.map((user) => ({
          id: String(user._id),
          username: user.username,
          displayName: user.displayName || '',
          avatar: user.avatar || null,
          createdAt: user.createdAt,
          lastActiveAt: user.lastActiveAt || null,
          onboardingComplete: Boolean(user.onboardingComplete),
          posts: postCounts.get(String(user._id)) || 0
        })),
        nextCursor: rows.length > limit ? String(page[page.length - 1]._id) : null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id/impact', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid user.' });
    const user = await User.findById(req.params.id).select('username displayName').lean();
    if (!user) return res.status(404).json({ success: false, error: 'That user no longer exists.' });
    res.json({ success: true, data: { username: user.username, displayName: user.displayName || '', impact: await describeUserImpact(user._id) } });
  } catch (error) {
    next(error);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid user.' });
    const user = await User.findById(req.params.id).select('username').lean();
    if (!user) return res.status(404).json({ success: false, error: 'That user no longer exists.' });

    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim().toLowerCase() : '';
    if (confirm !== user.username) {
      return res.status(400).json({ success: false, error: 'Type the username exactly to confirm.' });
    }

    const summary = await deleteUserAndData(user._id, { io: req.app.get('io') });
    await AdminAction.create({ action: 'delete_user', targetType: 'user', targetId: String(user._id), targetLabel: user.username, summary });
    res.json({ success: true, data: { deleted: true, summary } });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------ content ----------------------------- */

router.get('/posts', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
    const filter = { removedAt: null };

    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      const authors = await User.find({ username: pattern }).select('_id').limit(50).lean();
      filter.$or = [{ body: pattern }, { author: { $in: authors.map((u) => u._id) } }];
    }
    if (req.query.cursor) {
      if (!validId(req.query.cursor)) return res.status(400).json({ success: false, error: 'Invalid cursor.' });
      filter._id = { $lt: req.query.cursor };
    }

    const rows = await Post.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate('author', 'username displayName avatar')
      .select('author body type media createdAt likeCount commentCount repostCount')
      .lean();

    const page = rows.slice(0, limit);
    res.json({
      success: true,
      data: {
        items: page.map((post) => ({
          id: String(post._id),
          body: post.body || '',
          type: post.type,
          createdAt: post.createdAt,
          author: post.author ? { username: post.author.username, displayName: post.author.displayName || '', avatar: post.author.avatar || null } : null,
          images: (post.media || []).filter((m) => m && m.type === 'image' && typeof m.url === 'string').map((m) => m.url),
          likes: post.likeCount || 0,
          comments: post.commentCount || 0,
          reposts: post.repostCount || 0
        })),
        nextCursor: rows.length > limit ? String(page[page.length - 1]._id) : null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/posts/:id', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid post.' });
    const post = await Post.findById(req.params.id).select('author body').populate('author', 'username').lean();
    if (!post) return res.status(404).json({ success: false, error: 'That post no longer exists.' });

    const summary = await removePosts([post._id]);
    await AdminAction.create({
      action: 'delete_post',
      targetType: 'post',
      targetId: String(post._id),
      targetLabel: `${post.author?.username || 'unknown'}: ${(post.body || '').slice(0, 40)}`,
      summary
    });
    res.json({ success: true, data: { deleted: true, summary } });
  } catch (error) {
    next(error);
  }
});

/* ------------------------- system and audit ------------------------- */

router.get('/system', async (req, res, next) => {
  try {
    let imageUploads = true;
    try { cloudinary.ensureCloudinaryConfigured(); } catch { imageUploads = false; }

    res.json({
      success: true,
      data: {
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        environment: process.env.NODE_ENV || 'development',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        imageUploads,
        onlineNow: presence.onlineCount(),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        totals: await totals()
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/audit', async (req, res, next) => {
  try {
    const rows = await AdminAction.find({}).sort({ at: -1 }).limit(50).lean();
    res.json({
      success: true,
      data: {
        items: rows.map((row) => ({ id: String(row._id), action: row.action, targetType: row.targetType, targetLabel: row.targetLabel, summary: row.summary, at: row.at }))
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
