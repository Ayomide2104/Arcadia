const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['friend_request', 'friend_accept', 'like', 'repost', 'comment', 'reply', 'lfg_request', 'lfg_accept', 'lfg_decline'],
    required: true
  },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  lfg: { type: mongoose.Schema.Types.ObjectId, ref: 'Lfg', default: null },
  // Makes the same event idempotent: a retried request cannot notify twice.
  key: { type: String, required: true, maxlength: 120 },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

notificationSchema.index({ recipient: 1, _id: -1 });
notificationSchema.index({ recipient: 1, key: 1 }, { unique: true });
notificationSchema.index({ recipient: 1, readAt: 1 });
// Notifications disappear after 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model('Notification', notificationSchema);
