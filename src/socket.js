const crypto = require('node:crypto');
const { Server } = require('socket.io');
const Session = require('./models/Session');
const User = require('./models/User');
const presence = require('./services/presence');
const { isDevOrigin } = require('./config/origins');

function getAllowedOrigins() {
  const isDeployed =
    process.env.NODE_ENV === 'production' ||
    process.env.RENDER === 'true';

  const configuredOrigins =
    process.env.CLIENT_URL ||
    (isDeployed
      ? ''
      : 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174');

  return configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getSessionToken(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    if (name !== 'mk_session') continue;

    const token = part.slice(separator + 1).trim();
    return token && token.length <= 512 ? token : null;
  }

  return null;
}

function attachSocketServer(httpServer, app) {
  const isDeployed =
    process.env.NODE_ENV === 'production' ||
    process.env.RENDER === 'true';

  const allowedOrigins = getAllowedOrigins();

  const io = new Server(httpServer, {
    cors: {
      credentials: true,
      origin(origin, callback) {
        if (!origin) {
          return callback(new Error('An allowed browser origin is required.'));
        }

        if (allowedOrigins.includes(origin) || (!isDeployed && isDevOrigin(origin))) {
          return callback(null, true);
        }

        if (isDeployed && !process.env.CLIENT_URL) {
          return callback(null, true);
        }

        return callback(new Error('Origin is not allowed.'));
      }
    },
    allowRequest(request, callback) {
      const origin = request.headers.origin;

      if (typeof origin !== 'string') {
        return callback('An allowed browser origin is required.', false);
      }

      const sameOriginProduction =
        isDeployed &&
        !process.env.CLIENT_URL &&
        origin === `https://${request.headers.host}`;

      const allowed =
        allowedOrigins.includes(origin) || sameOriginProduction || (!isDeployed && isDevOrigin(origin));

      callback(allowed ? null : 'Origin is not allowed.', allowed);
    }
  });

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      const sameOriginProduction =
        isDeployed &&
        !process.env.CLIENT_URL &&
        origin === `https://${socket.handshake.headers.host}`;

      if (
        typeof origin !== 'string' ||
        (!allowedOrigins.includes(origin) && !sameOriginProduction && !(!isDeployed && isDevOrigin(origin)))
      ) {
        return next(new Error('Origin is not allowed.'));
      }

      const token = getSessionToken(socket.handshake.headers.cookie);

      if (!token) {
        return next(new Error('Authentication required.'));
      }

      const tokenHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      const session = await Session.findOne({
        tokenHash,
        expiresAt: { $gt: new Date() }
      }).select('user expiresAt').lean();

      if (!session) {
        return next(new Error('Your session has expired. Please sign in again.'));
      }

      const user = await User.findById(session.user)
        .select('_id username')
        .lean();

      if (!user) {
        return next(new Error('Authentication required.'));
      }

      socket.data.user = {
        id: String(user._id),
        username: user.username
      };

      next();
    } catch {
      next(new Error('Unable to authenticate your connection.'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;

    // Clients cannot choose another user's private room.
    socket.join(`user:${userId}`);

    // Community group chat: subscribe, typing and presence.
    require('./communitySocket').attachCommunitySocket(io, socket);

    // Friends' online status: online while at least one socket is connected.
    void presence.connected(io, socket).catch((error) => {
      console.warn('Could not register presence:', error.message);
    });

    socket.on('disconnect', () => {
      // Socket.IO automatically removes the socket from its rooms.
      presence.disconnected(io, socket);
    });
  });

  app.set('io', io);

  return io;
}

module.exports = { attachSocketServer };