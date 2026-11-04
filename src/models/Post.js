const mongoose = require('mongoose');
const destinationSchema = new mongoose.Schema({
  type: { type: String, enum: ['general', 'game', 'community'], required: true },
  target: { type: String, maxlength: 80, default: null }
}, { _id: false });
const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Community posts can have a title and a flair, like a subreddit post.
  title: { type: String, trim: true, maxlength: 120, default: '' },
  flair: { type: String, trim: true, maxlength: 24, default: '' },
  body: {
  type: String,
  trim: true,
  maxlength: 500,
  validate: {
    validator(value) {
      return Boolean(value) || Boolean(this.title) || (Array.isArray(this.media) && this.media.length > 0);
    },
    message: 'A post must contain text or an image.',
  },
},
  destinations: { type: [destinationSchema], required: true, validate: (list) => list.length > 0 },
  type: { type: String, enum: ['original', 'repost'], default: 'original' },
  repostOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  removedAt: { type: Date, default: null },
  editedAt: { type: Date, default: null },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  media: { type: [mongoose.Schema.Types.Mixed], default: [] },
  likeCount: { type: Number, default: 0, min: 0 },
  commentCount: { type: Number, default: 0, min: 0 },
  repostCount: { type: Number, default: 0, min: 0 },
  // Community voting (up minus down) and moderator pinning.
  score: { type: Number, default: 0 },
  pinnedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });
postSchema.index({ 'destinations.type': 1, createdAt: -1, _id: -1 });
postSchema.index({ author: 1, createdAt: -1, _id: -1 });
postSchema.index({ 'destinations.target': 1, score: -1, _id: -1 });
postSchema.index({ createdAt: -1, likeCount: -1, commentCount: -1 });
postSchema.index({ repostOf: 1 });
module.exports = mongoose.model('Post', postSchema);
