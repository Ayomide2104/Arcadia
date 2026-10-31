const mongoose = require('mongoose');

// A permanent record of what the admin did (no passwords, no private content).
const adminActionSchema = new mongoose.Schema({
  action: { type: String, required: true, maxlength: 40 },
  targetType: { type: String, maxlength: 20, default: '' },
  targetId: { type: String, maxlength: 40, default: '' },
  targetLabel: { type: String, maxlength: 80, default: '' },
  summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  at: { type: Date, default: Date.now }
}, { versionKey: false });

adminActionSchema.index({ at: -1 });

module.exports = mongoose.model('AdminAction', adminActionSchema);
