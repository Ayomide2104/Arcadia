const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('node:path');
const healthRoutes = require('./routes/healthRoutes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const crypto = require('node:crypto');
const Session = require('./models/Session');

const app = express();
app.set('trust proxy', 1);
const isProduction = process.env.NODE_ENV === 'production';
const isRender = process.env.RENDER === 'true';
const isDeployed = isProduction || isRender;
const configuredOrigins = process.env.CLIENT_URL || (isDeployed ? '' : 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174');
const allowedOrigins = configuredOrigins
  .split(',').map((origin) => origin.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Allow uploaded photos (Cloudinary) and local previews to display.
        'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
      },
    },
  })
);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    // A same-origin production frontend does not need CORS headers. With no
    // CLIENT_URL configured, leave browser CORS enforcement to the browser.
    if (isDeployed && !process.env.CLIENT_URL) return callback(null, false);
    return callback(Object.assign(new Error('Origin is not allowed by CORS'), { status: 403 }));
  }
}));
app.use(express.json({ limit: '100kb' }));
function containsUnsafeKey(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 20) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.')) return true;
    if (containsUnsafeKey(nested, depth + 1)) return true;
  }
  return false;
}
app.use((req, res, next) => {
  if (containsUnsafeKey(req.body) || containsUnsafeKey(req.query)) return res.status(400).json({ success: false, error: 'Request contains an invalid field.' });
  next();
});
app.use((req, res, next) => {
  const raw = req.headers.cookie;
  req.cookies = Object.create(null);
  if (typeof raw === 'string') {
    for (const part of raw.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      const name = part.slice(0, separator).trim();
      if (name === 'mk_session') req.cookies.mk_session = part.slice(separator + 1).trim();
    }
  }
  next();
});
app.use(async (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ success: false, error: 'A same-origin request is required.' });
  const scheme = req.secure ? 'https' : 'http';
  const sameOrigin = isDeployed && !process.env.CLIENT_URL && origin === `${scheme}://${req.get('host')}`;
  if (!allowedOrigins.includes(origin) && !sameOrigin) return res.status(403).json({ success: false, error: 'Request origin is not allowed.' });
  // The admin area has its own sign-in cookie and its own CSRF token.
  if (req.path.startsWith('/api/admin/')) return next();
  if (!req.cookies?.mk_session) return next();
  try {
    const tokenHash = crypto.createHash('sha256').update(req.cookies.mk_session).digest('hex');
    const session = await Session.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).select('+csrfToken').lean();
    const supplied = req.get('x-csrf-token');
    if (!session || typeof supplied !== 'string' || supplied.length > 128) return res.status(403).json({ success: false, error: 'Refresh your session and try again.' });
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(session.csrfToken || '');
    if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) return res.status(403).json({ success: false, error: 'Refresh your session and try again.' });
    next();
  } catch (error) { next(error); }
});
app.use((req, res, next) => {
  if (!isDeployed) console.info(`${req.method} ${req.path}`);
  next();
});
// The admin pages are never indexed or cached.
app.use('/admin', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/health', healthRoutes);
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/posts', require('./routes/postRoutes'));
app.use('/api/games', require('./routes/gameRoutes'));
app.use('/api/search', require('./routes/searchRoutes'));
app.use('/api/lfg', require('./routes/lfgRoutes'));
app.use('/api/safety', require('./routes/safetyRoutes'));
app.use('/api/communities', require('./routes/communityRoutes'));
app.use('/api/friends', require('./routes/friendRequestRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/presence', require('./routes/presenceRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
// Keep API misses on the JSON 404 path before static files are considered.
app.use('/api', notFound);
if (isDeployed) {
  app.use(express.static(path.join(__dirname, '..', 'dist'), { fallthrough: true }));
}
// This is a single-page site with anchor navigation, so no HTML route fallback
// is needed. Unknown paths retain the existing JSON 404 response.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
