const express = require('express');
const mongoose = require('mongoose');
const Community = require('../models/Community');
const Membership = require('../models/Membership');
const CommunityChannel = require('../models/CommunityChannel');
const CommunityMessage = require('../models/CommunityMessage');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();
const sendLimit = rateLimit({ name: 'community-chat-send', max: 40, windowMs: 60 * 1000 });
const reactLimit = rateLimit({ name: 'community-chat-react', max: 120, windowMs: 60 * 1000 });

const EMOJIS = ['👍', '🔥', '😂', '🎮', '😮', '❤️'];
const MAX_CHANNELS = 8;
const DEFAULT_CHANNELS = [
  { slug: 'general', name: 'general', topic: 'Talk about anything.', kind: 'text' },
  { slug: 'squad-finder', name: 'squad-finder', topic: 'Find people to play with right now.', kind: 'squad' },
  { slug: 'clips', name: 'clips', topic: 'Share your best plays.', kind: 'text' },
  { slug: 'off-topic', name: 'off-topic', topic: 'Everything that is not a game.', kind: 'text' }
];
const POPULATE = [
  { path: 'author', select: 'username displayName avatar' },
  { path: 'reactions.users', select: 'username' },
  { path: 'squad.joined', select: 'username displayName avatar' },
  { path: 'replyTo', select: 'body kind author deletedAt', populate: { path: 'author', select: 'username displayName' } }
];

const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const roomOf = (communityId) => `community:${communityId}`;

function emit(req, communityId, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(roomOf(communityId)).emit(event, payload);
}

function person(user) {
  return user ? { username: user.username, displayName: user.displayName || '', avatar: user.avatar || null } : null;
}

// One shape for REST responses and socket broadcasts. Reactions carry
// usernames so every client can work out its own "mine" state.
function serialize(message, channelSlug) {
  const squad = message.squad && message.kind === 'squad'
    ? {
      game: message.squad.game || '',
      slots: message.squad.slots,
      when: message.squad.when || '',
      note: message.squad.note || '',
      joined: (message.squad.joined || []).map(person).filter(Boolean)
    }
    : null;
  const reply = message.replyTo
    ? {
      id: String(message.replyTo._id),
      author: message.replyTo.author?.displayName || message.replyTo.author?.username || 'Someone',
      snippet: message.replyTo.deletedAt ? 'Message deleted' : (message.replyTo.body || (message.replyTo.kind === 'squad' ? 'Squad call' : '')).slice(0, 90)
    }
    : null;
  return {
    id: String(message._id),
    channel: channelSlug,
    kind: message.kind,
    body: message.body || '',
    author: person(message.author),
    replyTo: reply,
    reactions: (message.reactions || []).filter((entry) => entry.users?.length).map((entry) => ({ emoji: entry.emoji, users: entry.users.map((user) => user.username) })),
    squad,
    createdAt: message.createdAt
  };
}

async function ensureChannels(community) {
  if (await CommunityChannel.countDocuments({ community: community._id }) > 0) return;
  try {
    await CommunityChannel.insertMany(DEFAULT_CHANNELS.map((channel, position) => ({ ...channel, position, community: community._id, createdBy: community.ownerUser || null })), { ordered: false });
  } catch (error) {
    if (error.code !== 11000 && !error.writeErrors) throw error;
  }
}

// Chat is for members. Sends the error response itself and returns null.
async function chatAccess(req, res) {
  const community = await Community.findOne({ slug: req.params.slug, active: true }).select('_id slug ownerUser games game').lean();
  if (!community) { res.status(404).json({ success: false, error: 'Community not found.' }); return null; }
  const membership = await Membership.findOne({ community: community._id, user: req.user._id }).select('role').lean();
  if (!membership) { res.status(403).json({ success: false, error: 'Join this community to use its chat.' }); return null; }
  return { community, role: membership.role };
}

async function findChannel(req, res, community) {
  const channel = await CommunityChannel.findOne({ community: community._id, slug: req.params.channel }).lean();
  if (!channel) { res.status(404).json({ success: false, error: 'Channel not found.' }); return null; }
  return channel;
}

async function loadMessage(id, channelSlug) {
  const message = await CommunityMessage.findById(id).populate(POPULATE).lean();
  return message ? serialize(message, channelSlug) : null;
}

router.get('/:slug/channels', requireAuth, async (req, res, next) => {
  try {
    const access = await chatAccess(req, res); if (!access) return;
    await ensureChannels(access.community);
    const channels = await CommunityChannel.find({ community: access.community._id }).sort({ position: 1, _id: 1 }).select('slug name topic kind').lean();
    res.json({ success: true, data: { channels, role: access.role } });
  } catch (error) { next(error); }
});

router.post('/:slug/channels', requireAuth, async (req, res, next) => {
  try {
    const access = await chatAccess(req, res); if (!access) return;
    if (!['owner', 'moderator'].includes(access.role)) return res.status(403).json({ success: false, error: 'Only moderators can add channels.' });
    await ensureChannels(access.community);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) : '';
    if (name.length < 2) return res.status(400).json({ success: false, error: 'Give the channel a name of at least 2 letters.' });
    const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 120) : '';
    const count = await CommunityChannel.countDocuments({ community: access.community._id });
    if (count >= MAX_CHANNELS) return res.status(409).json({ success: false, error: `A community can have up to ${MAX_CHANNELS} channels.` });
    try {
      const channel = await CommunityChannel.create({ community: access.community._id, slug: name, name, topic, kind: 'text', position: count, createdBy: req.user._id });
      emit(req, access.community._id, 'community:channels', { slug: req.params.slug });
      res.status(201).json({ success: true, data: { channel: { slug: channel.slug, name: channel.name, topic: channel.topic, kind: channel.kind } } });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ success: false, error: 'A channel with that name already exists.' });
      throw error;
    }
  } catch (error) { next(error); }
});

router.delete('/:slug/channels/:channel', requireAuth, async (req, res, next) => {
  try {
    const access = await chatAccess(req, res); if (!access) return;
    if (access.role !== 'owner') return res.status(403).json({ success: false, error: 'Only the owner can remove channels.' });
    if (['general', 'squad-finder'].includes(req.params.channel)) return res.status(409).json({ success: false, error: 'This channel cannot be removed.' });
    const channel = await findChannel(req, res, access.community); if (!channel) return;
    await CommunityMessage.deleteMany({ channel: channel._id });
    await CommunityChannel.deleteOne({ _id: channel._id });
    emit(req, access.community._id, 'community:channels', { slug: req.params.slug });
    res.json({ success: true, data: { removed: true } });
  } catch (error) { next(error); }
});

router.get('/:slug/channels/:channel/messages', requireAuth, async (req, res, next) => {
  try {
    const access = await chatAccess(req, res); if (!access) return;
    const channel = await findChannel(req, res, access.community); if (!channel) return;
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 60);
    const query = { channel: channel._id, deletedAt: null };
    if (req.query.before) {
      if (!validId(req.query.before)) return res.status(400).json({ success: false, error: 'Invalid cursor.' });
      query._id = { $lt: req.query.before };
    }
    const found = await CommunityMessage.find(query).sort({ _id: -1 }).limit(limit).populate(POPULATE).lean();
    const items = found.reverse().map((message) => serialize(message, channel.slug));
    res.json({ success: true, data: { items, hasMore: found.length === limit } });
  } catch (error) { next(error); }
});

router.post('/:slug/channels/:channel/messages', requireAuth, sendLimit, async (req, res, next) => {
  try {
    const access = await chatAccess(req, res); if (!access) return;
    const channel = await findChannel(req, res, access.community); if (!channel) return;
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const wantsSquad = req.body?.squad && typeof req.body.squad === 'object';
    const doc = { community: access.community._id, channel: channel._id, author: req.user._id, kind: 'text', body };

    if (wantsSquad) {
      if (channel.kind !== 'squad') return res.status(400).json({ success: false, error: 'Squad calls belong in the squad-finder channel.' });
      const slots = Number.parseInt(req.body.squad.slots, 10);
      if (!Number.isInteger(slots) || slots < 1 || slots > 9) return res.status(400).json({ success: false, error: 'Choose how many players you need (1 to 9).' });
      const game = typeof req.body.squad.game === 'string' ? req.body.squad.game.trim().slice(0, 60) : '';
      const when = typeof req.body.squad.when === 'string' ? req.body.squad.when.trim().slice(0, 40) : '';
      const note = typeof req.body.squad.note === 'string' ? req.body.squad.note.trim().slice(0, 140) : '';
      if (!game) return res.status(400).json({ success: false, error: 'Say which game you want to play.' });
      doc.kind = 'squad';
      doc.body = '';
      doc.squad = { game, slots, when, note, joined: [req.user._id] };
    } else if (!body || body.length > 1000) {
      return res.status(400).json({ success: false, error: 'Write a message of up to 1,000 characters.' });
    }

    if (req.body?.replyTo != null) {
      if (!validId(req.body.replyTo)) return res.status(400).json({ success: false, error: 'Invalid reply target.' });
      const target = await CommunityMessage.findOne({ _id: req.body.replyTo, channel: channel._id, deletedAt: null }).select('_id').lean();
      if (!target) return res.status(400).json({ success: false, error: 'That message is no longer there.' });
      doc.replyTo = target._id;
    }

    const created = await CommunityMessage.create(doc);
    const message = await loadMessage(created._id, channel.slug);
    emit(req, access.community._id, 'community:message', { slug: req.params.slug, channel: channel.slug, message });
    res.status(201).json({ success: true, data: { message } });
  } catch (error) { next(error); }
});

router.delete('/:slug/channels/:channel/messages/:id', requireAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid message.' });
    const access = await chatAccess(req, res); if (!access) return;
    const channel = await findChannel(req, res, access.community); if (!channel) return;
    const message = await CommunityMessage.findOne({ _id: req.params.id, channel: channel._id, deletedAt: null }).select('author').lean();
    if (!message) return res.status(404).json({ success: false, error: 'Message not found.' });
    const isAuthor = String(message.author) === String(req.user._id);
    if (!isAuthor && !['owner', 'moderator'].includes(access.role)) return res.status(403).json({ success: false, error: 'You can only delete your own messages.' });
    await CommunityMessage.updateOne({ _id: message._id }, { $set: { deletedAt: new Date(), body: '' } });
    emit(req, access.community._id, 'community:message:delete', { slug: req.params.slug, channel: channel.slug, id: String(message._id) });
    res.json({ success: true, data: { removed: true } });
  } catch (error) { next(error); }
});

router.put('/:slug/channels/:channel/messages/:id/reactions', requireAuth, reactLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.id) || !EMOJIS.includes(req.body?.emoji)) return res.status(400).json({ success: false, error: 'Choose a valid reaction.' });
    const access = await chatAccess(req, res); if (!access) return;
    const channel = await findChannel(req, res, access.community); if (!channel) return;
    const message = await CommunityMessage.findOne({ _id: req.params.id, channel: channel._id, deletedAt: null });
    if (!message) return res.status(404).json({ success: false, error: 'Message not found.' });
    const emoji = req.body.emoji;
    let entry = message.reactions.find((item) => item.emoji === emoji);
    if (entry && entry.users.some((id) => String(id) === String(req.user._id))) {
      entry.users = entry.users.filter((id) => String(id) !== String(req.user._id));
      if (!entry.users.length) message.reactions = message.reactions.filter((item) => item.emoji !== emoji);
    } else {
      if (!entry) {
        if (message.reactions.length >= EMOJIS.length) return res.status(409).json({ success: false, error: 'This message has all the reactions it can hold.' });
        message.reactions.push({ emoji, users: [] });
        entry = message.reactions[message.reactions.length - 1];
      }
      entry.users.push(req.user._id);
    }
    await message.save();
    const updated = await loadMessage(message._id, channel.slug);
    emit(req, access.community._id, 'community:message:update', { slug: req.params.slug, channel: channel.slug, message: updated });
    res.json({ success: true, data: { message: updated } });
  } catch (error) { next(error); }
});

// Join or leave a squad call. The caller counts toward the group size.
router.post('/:slug/channels/:channel/messages/:id/squad', requireAuth, reactLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.id) || typeof req.body?.join !== 'boolean') return res.status(400).json({ success: false, error: 'Choose join or leave.' });
    const access = await chatAccess(req, res); if (!access) return;
    const channel = await findChannel(req, res, access.community); if (!channel) return;
    const message = await CommunityMessage.findOne({ _id: req.params.id, channel: channel._id, kind: 'squad', deletedAt: null });
    if (!message || !message.squad) return res.status(404).json({ success: false, error: 'Squad call not found.' });
    const me = String(req.user._id);
    const joined = message.squad.joined.map(String);
    const isHost = String(message.author) === me;
    if (req.body.join) {
      if (joined.includes(me)) return res.status(409).json({ success: false, error: 'You are already in this squad.' });
      if (joined.length >= message.squad.slots + 1) return res.status(409).json({ success: false, error: 'This squad is full.' });
      message.squad.joined.push(req.user._id);
    } else {
      if (isHost) return res.status(409).json({ success: false, error: 'Delete the call to cancel it.' });
      message.squad.joined = message.squad.joined.filter((id) => String(id) !== me);
    }
    await message.save();
    const updated = await loadMessage(message._id, channel.slug);
    emit(req, access.community._id, 'community:message:update', { slug: req.params.slug, channel: channel.slug, message: updated });
    res.json({ success: true, data: { message: updated } });
  } catch (error) { next(error); }
});

module.exports = router;
