const mongoose = require('mongoose');

// A "looking for gamers" invitation. It expires on its own (see expiresAt).
const lfgSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  game: { type: String, required: true, lowercase: true, trim: true, maxlength: 80 },
  platform: { type: String, required: true, maxlength: 30 },
  mode: { type: String, required: true, trim: true, maxlength: 60 },
  skill: { type: String, enum: ['any', 'beginner', 'casual', 'competitive'], default: 'any' },
  note: { type: String, trim: true, maxlength: 200, default: '' },
  slots: { type: Number, required: true, min: 1, max: 9 },
  filled: { type: Number, default: 0, min: 0 },
  // How players join: a key from src/config/lfgGames.js plus the value (hidden until the host accepts).
  joinMethod: { type: String, required: true, maxlength: 40 },
  joinValue: { type: String, default: '', maxlength: 220, select: false },
  status: { type: String, enum: ['open', 'full', 'closed'], default: 'open' },
  expiresAt: { type: Date, required: true },
  pendingCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true, versionKey: false });

lfgSchema.index({ status: 1, expiresAt: 1, createdAt: -1 });
lfgSchema.index({ game: 1, status: 1, expiresAt: 1, createdAt: -1 });
// Remove the record a day after it has expired.
lfgSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = mongoose.model('Lfg', lfgSchema);
