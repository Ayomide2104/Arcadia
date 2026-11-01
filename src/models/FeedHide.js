const mongoose = require('mongoose');

// A player's "not interested" choices: single posts they hid, and authors they muted.
// Hidden posts clean themselves up after 90 days; muted authors stay until unmuted.
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['post', 'author'], required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  expireAt: { type: Date, default: null }
}, { versionKey: false, timestamps: { createdAt: true, updatedAt: false } });

schema.index({ user: 1, kind: 1, target: 1 }, { unique: true });
schema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('FeedHide', schema);
