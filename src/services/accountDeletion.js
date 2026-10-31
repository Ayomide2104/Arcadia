const User = require('../models/User');
const Session = require('../models/Session');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Reaction = require('../models/Reaction');
const Repost = require('../models/Repost');
const Membership = require('../models/Membership');
const Community = require('../models/Community');
const Message = require('../models/Message');
const Friendship = require('../models/Friendship');
const FriendRequest = require('../models/FriendRequest');
const Notification = require('../models/Notification');
const SeenPost = require('../models/SeenPost');
const DailyActive = require('../models/DailyActive');
const cloudinary = require('../config/cloudinary');
const { removeOwnedImage } = require('./media');

const countsByKey = (ids) => {
  const counts = new Map();
  for (const id of ids) counts.set(String(id), (counts.get(String(id)) || 0) + 1);
  return counts;
};

async function adjust(Model, field, counts) {
  const ops = [...counts.entries()].map(([id, n]) => ({
    updateOne: { filter: { _id: id, [field]: { $gte: n } }, update: { $inc: { [field]: -n } } }
  }));
  if (ops.length) await Model.bulkWrite(ops, { ordered: false });
}

async function destroyMedia(posts) {
  const publicIds = [];
  for (const post of posts) {
    for (const item of post.media || []) {
      if (item && typeof item.publicId === 'string' && item.publicId.startsWith('arcadia/')) publicIds.push(item.publicId);
    }
  }
  if (!publicIds.length) return 0;
  try {
    cloudinary.ensureCloudinaryConfigured();
  } catch {
    return 0; // nothing to remove if image storage is not configured
  }
  let removed = 0;
  for (let i = 0; i < publicIds.length; i += 5) {
    const batch = publicIds.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map((id) => cloudinary.uploader.destroy(id)));
    removed += results.filter((r) => r.status === 'fulfilled').length;
  }
  return removed;
}

/**
 * Remove posts and everything attached to them: comments, likes, reposts,
 * notifications, seen records and uploaded images. Also removes the repost
 * copies other people made of them.
 */
async function removePosts(postIds) {
  const summary = { posts: 0, comments: 0, reactions: 0, reposts: 0, images: 0 };
  if (!postIds.length) return summary;

  const direct = await Post.find({ _id: { $in: postIds } }).select('_id author type repostOf media').lean();
  const copies = await Post.find({ repostOf: { $in: postIds }, _id: { $nin: postIds } }).select('_id author type repostOf media').lean();
  const all = [...direct, ...copies];
  const ids = all.map((post) => post._id);
  if (!ids.length) return summary;

  // A removed repost copy should reduce the original post's repost count
  // (unless the original is being removed too).
  const removing = new Set(ids.map(String));
  const repostBack = all.filter((post) => post.type === 'repost' && post.repostOf && !removing.has(String(post.repostOf)));
  await adjust(Post, 'repostCount', countsByKey(repostBack.map((post) => post.repostOf)));
  for (const post of repostBack) await Repost.deleteMany({ user: post.author, post: post.repostOf });

  summary.comments = (await Comment.deleteMany({ post: { $in: ids } })).deletedCount || 0;
  summary.reactions = (await Reaction.deleteMany({ post: { $in: ids } })).deletedCount || 0;
  summary.reposts = (await Repost.deleteMany({ post: { $in: ids } })).deletedCount || 0;
  await Notification.deleteMany({ post: { $in: ids } });
  await SeenPost.deleteMany({ post: { $in: ids } });
  summary.images = await destroyMedia(all);
  summary.posts = (await Post.deleteMany({ _id: { $in: ids } })).deletedCount || 0;
  return summary;
}

/** Everything a deletion would remove: shown to the admin before they confirm. */
async function describeUserImpact(userId) {
  const [posts, comments, reactions, friends, messages, memberships, owned] = await Promise.all([
    Post.countDocuments({ author: userId }),
    Comment.countDocuments({ author: userId }),
    Reaction.countDocuments({ user: userId }),
    Friendship.countDocuments({ $or: [{ user1: userId }, { user2: userId }] }),
    Message.countDocuments({ $or: [{ sender: userId }, { recipient: userId }] }),
    Membership.countDocuments({ user: userId }),
    Community.countDocuments({ ownerUser: userId })
  ]);
  return { posts, comments, reactions, friends, messages, communities: memberships, ownedCommunities: owned };
}

/**
 * Delete a user and everything of theirs. The user record itself is removed
 * last, so if something fails halfway the admin can simply run it again.
 */
async function deleteUserAndData(userId, { io = null } = {}) {
  const user = await User.findById(userId).select('username avatar banner').lean();
  if (!user) {
    const error = new Error('That user no longer exists.');
    error.status = 404;
    throw error;
  }

  const summary = {};

  // 1. Sign them out everywhere and close their live connections.
  await Session.deleteMany({ user: userId });
  if (io) {
    try { io.in(`user:${userId}`).disconnectSockets(true); } catch { /* not connected */ }
  }

  // 2. Their posts, with comments, likes, reposts and images attached to them.
  const own = await Post.find({ author: userId }).select('_id').lean();
  const removed = await removePosts(own.map((post) => post._id));
  summary.ownPosts = removed.posts;
  summary.commentsOnOwnPosts = removed.comments;
  summary.likesOnOwnPosts = removed.reactions;
  summary.images = removed.images;

  // 3. Their likes and reposts on other people's posts: undo the counters.
  const reactions = await Reaction.find({ user: userId }).select('post').lean();
  await adjust(Post, 'likeCount', countsByKey(reactions.map((r) => r.post)));
  summary.likesGiven = (await Reaction.deleteMany({ user: userId })).deletedCount || 0;

  const reposts = await Repost.find({ user: userId }).select('post').lean();
  await adjust(Post, 'repostCount', countsByKey(reposts.map((r) => r.post)));
  await Repost.deleteMany({ user: userId });

  // 4. Their comments, plus replies under them, with comment counts corrected.
  let commentIds = (await Comment.find({ author: userId }).select('_id').lean()).map((c) => c._id);
  const doomed = new Set(commentIds.map(String));
  for (let depth = 0; depth < 5 && commentIds.length; depth += 1) {
    const replies = await Comment.find({ parent: { $in: commentIds }, _id: { $nin: [...doomed] } }).select('_id').lean();
    commentIds = replies.map((c) => c._id);
    commentIds.forEach((id) => doomed.add(String(id)));
  }
  const doomedIds = [...doomed];
  if (doomedIds.length) {
    const rows = await Comment.find({ _id: { $in: doomedIds } }).select('post').lean();
    await adjust(Post, 'commentCount', countsByKey(rows.map((c) => c.post)));
    await Notification.deleteMany({ comment: { $in: doomedIds } });
  }
  summary.comments = (await Comment.deleteMany({ _id: { $in: doomedIds } })).deletedCount || 0;

  // 5. Friendships and friend requests.
  summary.friendships = (await Friendship.deleteMany({ $or: [{ user1: userId }, { user2: userId }] })).deletedCount || 0;
  await FriendRequest.deleteMany({ $or: [{ sender: userId }, { recipient: userId }] });

  // 6. Private messages, in both directions.
  summary.messages = (await Message.deleteMany({ $or: [{ sender: userId }, { recipient: userId }] })).deletedCount || 0;

  // 7. Communities: hand over ownership, or retire the community if nobody is left.
  const owned = await Community.find({ ownerUser: userId }).select('_id').lean();
  summary.communitiesTransferred = 0;
  summary.communitiesRetired = 0;
  for (const community of owned) {
    const next = await Membership.findOne({ community: community._id, user: { $ne: userId } }).sort({ createdAt: 1 }).select('user').lean();
    if (next) {
      await Community.updateOne({ _id: community._id }, { $set: { ownerUser: next.user } });
      await Membership.updateOne({ community: community._id, user: next.user }, { $set: { role: 'owner' } });
      summary.communitiesTransferred += 1;
    } else {
      await Community.updateOne({ _id: community._id }, { $set: { ownerUser: null, active: false } });
      summary.communitiesRetired += 1;
    }
  }
  const memberships = await Membership.find({ user: userId }).select('community').lean();
  await adjust(Community, 'memberCount', countsByKey(memberships.map((m) => m.community)));
  await Membership.deleteMany({ user: userId });

  // 8. Notifications, seen records and activity history.
  await Notification.deleteMany({ $or: [{ recipient: userId }, { actor: userId }] });
  await SeenPost.deleteMany({ user: userId });
  await DailyActive.deleteMany({ user: userId });

  // 9. Their profile photo and banner.
  await removeOwnedImage(user.avatar, 'arcadia/avatars', userId);
  await removeOwnedImage(user.banner, 'arcadia/banners', userId);

  // 10. Finally, the account itself.
  await User.deleteOne({ _id: userId });

  return { username: user.username, ...summary };
}

module.exports = { removePosts, describeUserImpact, deleteUserAndData };
