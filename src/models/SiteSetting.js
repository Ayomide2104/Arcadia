const mongoose = require('mongoose');

// Site-wide switches an admin can change without redeploying (announcement banner, sign-ups open/closed).
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, maxlength: 40 },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

module.exports = mongoose.model('SiteSetting', schema);
