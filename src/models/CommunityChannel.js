const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  community: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true },
  slug: { type: String, required: true, lowercase: true, trim: true, match: /^[a-z0-9-]{2,24}$/ },
  name: { type: String, required: true, trim: true, maxlength: 24 },
  topic: { type: String, trim: true, maxlength: 120, default: '' },
  // "squad" channels get the squad-call (looking for group) composer.
  kind: { type: String, enum: ['text', 'squad'], default: 'text' },
  position: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true, versionKey: false });
schema.index({ community: 1, slug: 1 }, { unique: true });
schema.index({ community: 1, position: 1 });
module.exports = mongoose.model('CommunityChannel', schema);
