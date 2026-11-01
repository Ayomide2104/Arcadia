const mongoose = require('mongoose');

// "This post was handed to this player's feed." Stops a refresh from serving the
// same posts again, even when the player did not scroll far enough to see them.
// Records expire on their own after 36 hours.
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  servedAt: { type: Date, default: Date.now }
}, { versionKey: false });

schema.index({ user: 1, post: 1 }, { unique: true });
schema.index({ servedAt: 1 }, { expireAfterSeconds: 60 * 60 * 36 });

module.exports = mongoose.model('FeedServed', schema);
