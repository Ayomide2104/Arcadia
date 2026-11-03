const mongoose = require('mongoose');

// A player's report about a post, comment, person or LFG invite. Reviewed from the admin panel.
const reportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, enum: ['post', 'comment', 'user', 'lfg'], required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  // The person the report is about, so reports can be grouped per player.
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reason: { type: String, enum: ['spam', 'harassment', 'hate', 'sexual', 'scam', 'underage', 'other'], required: true },
  details: { type: String, trim: true, maxlength: 500, default: '' },
  status: { type: String, enum: ['open', 'actioned', 'dismissed'], default: 'open' },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

reportSchema.index({ reporter: 1, targetType: 1, target: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ subject: 1, status: 1 });

module.exports = mongoose.model('Report', reportSchema);
