const Follow = require('../models/Follow');

async function getFollowingIds(userId, limit = 2000) {
  if (!userId) return [];
  const rows = await Follow.find({ follower: userId }).sort({ _id: -1 }).limit(limit).select('following').lean();
  return rows.map((row) => String(row.following));
}

async function followCounts(userId) {
  const [followers, following] = await Promise.all([
    Follow.countDocuments({ following: userId }),
    Follow.countDocuments({ follower: userId }),
  ]);
  return { followers, following };
}

module.exports = { getFollowingIds, followCounts };
