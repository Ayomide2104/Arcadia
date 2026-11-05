const SiteSetting = require('../models/SiteSetting');

const DEFAULTS = {
  announcement: { active: false, text: '', tone: 'info', link: '', id: '' },
  signupsOpen: true,
};
const TTL_MS = 15 * 1000;
let cache = { at: 0, values: null };

async function getSettings() {
  if (cache.values && Date.now() - cache.at < TTL_MS) return cache.values;
  const rows = await SiteSetting.find({}).lean();
  const values = { ...DEFAULTS };
  for (const row of rows) if (row.key in DEFAULTS) values[row.key] = row.value;
  cache = { at: Date.now(), values };
  return values;
}

async function setSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error('Unknown setting.');
  await SiteSetting.updateOne({ key }, { $set: { value, updatedAt: new Date() } }, { upsert: true });
  cache = { at: 0, values: null };
}

module.exports = { getSettings, setSetting, DEFAULTS };
