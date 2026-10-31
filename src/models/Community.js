const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, maxlength: 80 },
  // `game` is kept for older code (first focus game). `games` and `genres`
  // describe what the community is about; at least one of them is required
  // when a user creates a community.
  game: { type: String, default: null },
  games: { type: [String], default: [] },
  genres: { type: [String], default: [] },
  ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  description: { type: String, maxlength: 300, default: '' },
  rules: { type: [String], default: [] },
  flairs: { type: [String], default: [] },
  accent: { type: String, default: '#68d6bd', match: /^#[0-9a-fA-F]{6}$/ },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  memberCount: { type: Number, default: 0, min: 0 },
  postCount: { type: Number, default: 0, min: 0 },
  // Official communities are run by Arcadia (no owner) and shown to new players first.
  official: { type: Boolean, default: false },
  active: { type: Boolean, default: true }
}, { timestamps: true, versionKey: false });
schema.index({ game: 1, active: 1, name: 1 });
schema.index({ games: 1, active: 1 });
schema.index({ genres: 1, active: 1 });
schema.index({ active: 1, visibility: 1, memberCount: -1 });
module.exports = mongoose.model('Community', schema);
