const express = require('express');
const rateLimit = require('../middleware/rateLimit');
const { getSettings } = require('../services/siteSettings');

const router = express.Router();
const limit = rateLimit({ name: 'site-info', max: 300, windowMs: 15 * 60 * 1000 });

// GET /api/site  (public: the announcement banner and whether sign-ups are open)
router.get('/', limit, async (req, res, next) => {
  try {
    const settings = await getSettings();
    const announcement = settings.announcement && settings.announcement.active && settings.announcement.text ? settings.announcement : null;
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ success: true, data: { announcement, signupsOpen: settings.signupsOpen !== false } });
  } catch (error) { next(error); }
});

module.exports = router;
