const mongoose = require('mongoose');

// "follower" follows "following". One-way, no approval needed (friends are the two-way connection).
const followSchema = new mongoose.Schema({
  follower: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  following: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

followSchema.index({ follower: 1, following: 1 }, { unique: true });
followSchema.index({ following: 1, _id: -1 });
followSchema.index({ follower: 1, _id: -1 });

module.exports = mongoose.model('Follow', followSchema);
