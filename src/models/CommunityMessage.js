const mongoose = require('mongoose');
const reactionSchema = new mongoose.Schema({
  emoji: { type: String, required: true, maxlength: 8 },
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { _id: false });
const squadSchema = new mongoose.Schema({
  game: { type: String, trim: true, maxlength: 60, default: '' },
  slots: { type: Number, min: 1, max: 9, default: 1 },
  when: { type: String, trim: true, maxlength: 40, default: '' },
  note: { type: String, trim: true, maxlength: 140, default: '' },
  joined: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { _id: false });
const schema = new mongoose.Schema({
  community: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true },
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityChannel', required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['text', 'squad'], default: 'text' },
  body: { type: String, trim: true, maxlength: 1000, default: '' },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityMessage', default: null },
  reactions: { type: [reactionSchema], default: [] },
  squad: { type: squadSchema, default: undefined },
  deletedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });
schema.index({ channel: 1, _id: -1 });
module.exports = mongoose.model('CommunityMessage', schema);
