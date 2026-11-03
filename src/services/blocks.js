const Block = require('../models/Block');

// Everyone this person should not see or hear from: people they blocked AND people who blocked them.
async function blockedEitherWay(userId) {
  if (!userId) return [];
  const rows = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select('blocker blocked').lean();
  const ids = new Set();
  for (const row of rows) {
    ids.add(String(row.blocker));
    ids.add(String(row.blocked));
  }
  ids.delete(String(userId));
  return [...ids];
}

async function isBlockedBetween(a, b) {
  if (!a || !b) return false;
  const found = await Block.exists({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] });
  return Boolean(found);
}

module.exports = { blockedEitherWay, isBlockedBetween };
