const mongoose = require('mongoose');

// One tiny record per (day, user): "this person used Arcadia on this day".
// Powers the daily / weekly / monthly active-user charts. Records expire after
// 400 days so the collection stays small.
const dailyActiveSchema = new mongoose.Schema({
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

dailyActiveSchema.index({ day: 1, user: 1 }, { unique: true });
dailyActiveSchema.index({ user: 1 });
dailyActiveSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 });

module.exports = mongoose.model('DailyActive', dailyActiveSchema);
