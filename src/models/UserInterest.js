const mongoose = require('mongoose');

// What a player actually cares about, learned from what they do.
// Each map is key -> weight (games and genres by slug, authors by user id,
// communities by slug). Weights fade with time: `asOf` is the moment the
// stored numbers were last brought up to date.
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  games: { type: mongoose.Schema.Types.Mixed, default: {} },
  genres: { type: mongoose.Schema.Types.Mixed, default: {} },
  authors: { type: mongoose.Schema.Types.Mixed, default: {} },
  communities: { type: mongoose.Schema.Types.Mixed, default: {} },
  asOf: { type: Date, default: Date.now }
}, { versionKey: false, minimize: false, timestamps: true });

module.exports = mongoose.model('UserInterest', schema);
