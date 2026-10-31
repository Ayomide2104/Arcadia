const mongoose = require('mongoose');
const Community = require('./models/Community');
const Membership = require('./models/Membership');

const roomOf = (communityId) => `community:${communityId}`;

// How many different members have this community's chat open right now.
async function broadcastPresence(io, communityId, slug) {
  const sockets = await io.in(roomOf(communityId)).fetchSockets();
  const online = new Set(sockets.map((socket) => socket.data.user.id)).size;
  io.to(roomOf(communityId)).emit('community:presence', { slug, online });
}

// Adds the community chat events to a signed-in socket (see socket.js).
function attachCommunitySocket(io, socket) {
  const rooms = new Map(); // slug -> community id

  socket.on('community:subscribe', async (payload, ack) => {
    try {
      const slug = payload?.slug;
      if (typeof slug !== 'string' || !/^[a-z0-9-]{2,60}$/.test(slug)) throw new Error('bad slug');
      const community = await Community.findOne({ slug, active: true }).select('_id').lean();
      if (!community) throw new Error('missing');
      const member = await Membership.exists({ community: community._id, user: new mongoose.Types.ObjectId(socket.data.user.id) });
      if (!member) throw new Error('not a member');
      socket.join(roomOf(community._id));
      rooms.set(slug, String(community._id));
      await broadcastPresence(io, community._id, slug);
      if (typeof ack === 'function') ack({ ok: true });
    } catch {
      if (typeof ack === 'function') ack({ ok: false });
    }
  });

  socket.on('community:unsubscribe', async (payload) => {
    const slug = payload?.slug;
    const id = rooms.get(slug);
    if (!id) return;
    socket.leave(roomOf(id));
    rooms.delete(slug);
    await broadcastPresence(io, id, slug).catch(() => {});
  });

  socket.on('community:typing', (payload) => {
    const slug = payload?.slug;
    const id = rooms.get(slug);
    if (!id || typeof payload.channel !== 'string' || payload.channel.length > 24) return;
    socket.to(roomOf(id)).emit('community:typing', { slug, channel: payload.channel, username: socket.data.user.username });
  });

  socket.on('disconnecting', () => {
    const joined = [...rooms.entries()];
    setImmediate(() => {
      for (const [slug, id] of joined) broadcastPresence(io, id, slug).catch(() => {});
    });
  });
}

module.exports = { attachCommunitySocket };
