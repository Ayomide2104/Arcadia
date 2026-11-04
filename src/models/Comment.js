const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  body: { type: String, required: true, trim: true, maxlength: 1000 },
  editedAt: { type: Date, default: null },
  // Deleted comments stay as "[deleted]" so replies under them keep their place.
  deletedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });
schema.index({ post: 1, createdAt: 1, _id: 1 });
module.exports = mongoose.model('Comment', schema);
