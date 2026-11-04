const mongoose = require('mongoose');

// A like (+1) on a feed comment, or an upvote (+1) / downvote (-1) on a community comment.
const schema = new mongoose.Schema({
  comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  value: { type: Number, enum: [-1, 1], required: true },
}, { timestamps: true, versionKey: false });

schema.index({ comment: 1, user: 1 }, { unique: true });
schema.index({ user: 1, comment: 1 });
schema.index({ post: 1 });

module.exports = mongoose.model('CommentVote', schema);
