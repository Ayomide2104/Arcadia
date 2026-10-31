const crypto = require('node:crypto');
const Session = require('../models/Session');
const User = require('../models/User');
const { recordActivity } = require('../services/activity');

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.mk_session;
    if (!token || typeof token !== 'string') return res.status(401).json({ success: false, error: 'Sign in to continue' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await Session.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).lean();
    if (!session) return res.status(401).json({ success: false, error: 'Your session has expired. Sign in again.' });
    const user = await User.findById(session.user).select('username displayName bio avatar banner genres favoriteGames createdAt onboardingComplete').lean();
    if (!user) return res.status(401).json({ success: false, error: 'Your session has expired. Sign in again.' });
    req.user = user;
    req.sessionId = session._id;
    recordActivity(user._id);
    next();
  } catch (error) { next(error); }
}

async function optionalAuth(req, res, next) {
  try {
    const token = req.cookies?.mk_session;
    if (token && typeof token === 'string') {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const session = await Session.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).lean();
      if (session) {
        req.user = await User.findById(session.user).select('username displayName bio avatar banner genres favoriteGames createdAt onboardingComplete').lean();
        if (req.user) recordActivity(req.user._id);
      }
    }
    next();
  } catch (error) { next(error); }
}

module.exports = { requireAuth, optionalAuth };
