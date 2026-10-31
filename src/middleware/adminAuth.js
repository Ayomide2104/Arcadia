const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

/*
 * Admin sign-in is completely separate from normal Arcadia accounts.
 *   ADMIN_USERNAME       the admin's login name
 *   ADMIN_PASSWORD_HASH  a bcrypt hash (make one with: npm run admin:hash)
 * The password itself is never stored anywhere. If these are not set, the
 * admin area is switched off and every /api/admin request answers "Not found".
 */
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'mk_admin';
const sessions = new Map(); // sha256(sessionId) -> { csrf, expires }

function config() {
  const username = process.env.ADMIN_USERNAME;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  return username && hash && /^\$2[aby]\$/.test(hash) ? { username, hash } : null;
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
const sameText = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function readCookie(req) {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === COOKIE) return part.slice(index + 1).trim();
  }
  return null;
}

function sweep() {
  const now = Date.now();
  for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
}

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

/** Hide the admin area completely when it is not configured. */
function adminEnabled(req, res, next) {
  noStore(res);
  if (!config()) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    const settings = config();
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200 || username.length > 100) {
      return res.status(400).json({ success: false, error: 'Enter your admin username and password.' });
    }

    // Always run the password check so a wrong username takes the same time as a wrong password.
    const passwordOk = await bcrypt.compare(password, settings.hash);
    const usernameOk = sameText(username.trim(), settings.username);
    if (!passwordOk || !usernameOk) {
      return res.status(401).json({ success: false, error: 'Wrong username or password.' });
    }

    sweep();
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    sessions.set(digest(sessionId).toString('hex'), { csrf, expires: Date.now() + SESSION_MS });

    res.cookie(COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER),
      path: '/api/admin',
      maxAge: SESSION_MS
    });
    return res.json({ success: true, data: { csrfToken: csrf } });
  } catch (error) {
    return next(error);
  }
}

function logout(req, res) {
  const id = readCookie(req);
  if (id) sessions.delete(digest(id).toString('hex'));
  res.clearCookie(COOKIE, { path: '/api/admin' });
  return res.json({ success: true, data: { signedOut: true } });
}

/** Require a valid admin session. Changing requests also need the admin CSRF header. */
function requireAdmin(req, res, next) {
  const id = readCookie(req);
  const session = id ? sessions.get(digest(id).toString('hex')) : null;
  if (!session || session.expires <= Date.now()) {
    return res.status(401).json({ success: false, error: 'Sign in to the admin area.' });
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const supplied = req.get('x-admin-csrf');
    if (typeof supplied !== 'string' || supplied.length > 128 || !sameText(supplied, session.csrf)) {
      return res.status(403).json({ success: false, error: 'Refresh the page and try again.' });
    }
  }

  req.admin = { csrf: session.csrf };
  return next();
}

module.exports = { adminEnabled, login, logout, requireAdmin };
