const mongoose = require('mongoose');

// "blocker" has blocked "blocked". Blocks hide each person from the other.
const blockSchema = new mongoose.Schema({
  blocker: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blocked: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
blockSchema.index({ blocked: 1 });

module.exports = mongoose.model('Block', blockSchema);
