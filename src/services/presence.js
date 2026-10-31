const User = require('../models/User');
const { getFriendIds } = require('./friends');
const { recordActivity } = require('./activity');

/*
 * Online presence, kept in memory (Arcadia runs as one server).
 * A person is online while they have at least one connected socket, so many
 * tabs and devices are handled correctly. When the last socket closes we wait
 * a few seconds before announcing "offline", so refreshing the page does not
 * make friends see a flicker.
 */
const GRACE_MS = 10_000;

const connections = new Map(); // userId -> Set of socket ids
const usernames = new Map(); // userId -> username
const announced = new Set(); // userIds friends currently see as online
const offlineTimers = new Map(); // userId -> timeout

/** How many different people are connected right now (for admin analytics). */
function onlineCount() {
  return connections.size;
}

function isOnline(userId) {
  return connections.has(String(userId));
}

async function allowsStatus(userId) {
  const user = await User.findById(userId).select('privacy').lean();
  return Boolean(user) && user.privacy?.showOnlineStatus !== false;
}

async function announce(io, userId, online, lastActiveAt = null) {
  try {
    const username = usernames.get(String(userId));
    if (!io || !username) return;
    const friendIds = await getFriendIds(userId);
    if (!friendIds.length) return;
    const rooms = friendIds.map((id) => `user:${id}`);
    io.to(rooms).emit('presence:update', { username, online, lastActiveAt });
  } catch (error) {
    console.warn('Could not announce presence:', error.message);
  }
}

async function connected(io, socket) {
  const userId = socket.data.user.id;
  usernames.set(userId, socket.data.user.username);
  recordActivity(userId);

  clearTimeout(offlineTimers.get(userId));
  offlineTimers.delete(userId);

  const sockets = connections.get(userId) || new Set();
  sockets.add(socket.id);
  connections.set(userId, sockets);

  if (announced.has(userId)) return; // friends already see them as online

  try {
    if (await allowsStatus(userId)) {
      announced.add(userId);
      await announce(io, userId, true);
    }
  } catch (error) {
    console.warn('Could not check presence visibility:', error.message);
  }
}

function disconnected(io, socket) {
  const userId = socket.data.user.id;
  const sockets = connections.get(userId);
  if (!sockets) return;

  sockets.delete(socket.id);
  if (sockets.size > 0) return; // still connected on another tab or device

  clearTimeout(offlineTimers.get(userId));
  offlineTimers.set(userId, setTimeout(async () => {
    offlineTimers.delete(userId);
    if ((connections.get(userId)?.size || 0) > 0) return;
    connections.delete(userId);

    const lastActiveAt = new Date();
    try {
      await User.updateOne({ _id: userId }, { $set: { lastActiveAt } });
    } catch (error) {
      console.warn('Could not save last active time:', error.message);
    }

    if (announced.delete(userId)) await announce(io, userId, false, lastActiveAt);
    usernames.delete(userId);
  }, GRACE_MS));
}

/** Called after someone changes the "show when I'm active" setting. */
async function refreshVisibility(io, userId) {
  const id = String(userId);
  if (!isOnline(id)) return;
  try {
    const visible = await allowsStatus(id);
    if (visible && !announced.has(id)) {
      announced.add(id);
      await announce(io, id, true);
    } else if (!visible && announced.has(id)) {
      announced.delete(id);
      await announce(io, id, false, null);
    }
  } catch (error) {
    console.warn('Could not refresh presence visibility:', error.message);
  }
}

module.exports = { connected, disconnected, refreshVisibility, isOnline, onlineCount, GRACE_MS };
