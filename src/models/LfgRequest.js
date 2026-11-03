const mongoose = require('mongoose');

// One person asking to join one LFG post.
const lfgRequestSchema = new mongoose.Schema({
  lfg: { type: mongoose.Schema.Types.ObjectId, ref: 'Lfg', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, trim: true, maxlength: 140, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

lfgRequestSchema.index({ lfg: 1, user: 1 }, { unique: true });
lfgRequestSchema.index({ user: 1, createdAt: -1 });
lfgRequestSchema.index({ lfg: 1, status: 1, createdAt: 1 });
// Requests are only useful while the post is; drop them after 3 days.
lfgRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 3 });

module.exports = mongoose.model('LfgRequest', lfgRequestSchema);
