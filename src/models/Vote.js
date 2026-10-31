const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  value: { type: Number, enum: [1, -1], required: true }
}, { timestamps: true, versionKey: false });
schema.index({ post: 1, user: 1 }, { unique: true });
schema.index({ user: 1, post: 1 });
module.exports = mongoose.model('Vote', schema);
