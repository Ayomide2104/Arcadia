const mongoose = require('mongoose');

// Someone shared a post (copied its link or used the share sheet). One per person per post.
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

schema.index({ user: 1, post: 1 }, { unique: true });
schema.index({ post: 1, createdAt: -1 });

module.exports = mongoose.model('PostShare', schema);
