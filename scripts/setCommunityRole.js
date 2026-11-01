// Appoint staff for a community (useful for official communities, which have no owner).
//   node scripts/setCommunityRole.js <community-slug> <username> <owner|moderator|member>
// Example: node scripts/setCommunityRole.js arcadia mkstudios owner
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/db');
const Community = require('../src/models/Community');
const Membership = require('../src/models/Membership');
const User = require('../src/models/User');

async function main() {
  const [slug, username, role] = process.argv.slice(2);
  if (!slug || !username || !['owner', 'moderator', 'member'].includes(role)) {
    console.error('Usage: node scripts/setCommunityRole.js <community-slug> <username> <owner|moderator|member>');
    process.exitCode = 1;
    return;
  }
  try {
    await connectDatabase();
    const community = await Community.findOne({ slug: slug.toLowerCase() });
    if (!community) throw new Error(`No community with slug "${slug}".`);
    const user = await User.findOne({ username: username.toLowerCase() }).select('_id username');
    if (!user) throw new Error(`No user named "${username}".`);
    const existing = await Membership.findOne({ community: community._id, user: user._id });
    if (existing) { existing.role = role; await existing.save(); }
    else {
      await Membership.create({ community: community._id, user: user._id, role });
      await Community.updateOne({ _id: community._id }, { $inc: { memberCount: 1 } });
    }
    if (role === 'owner') await Community.updateOne({ _id: community._id }, { $set: { ownerUser: user._id } });
    console.info(`${user.username} is now ${role} of ${community.slug}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
main();
