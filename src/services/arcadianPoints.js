/*
 * Arcadian points: a player's reputation for the posts they share on the feed.
 *
 *   like on your post        +1
 *   comment on your post     +3   (a person's first 2 comments per post count)
 *   share of your post       +2
 *   repost of your post      +0.5
 *   downvote on a community post of yours   -1
 *
 * Community upvotes and community comments don't add points. Your own
 * actions on your own posts never count. Points are worked out from the
 * real records (nothing to drift out of sync) and cached for a minute.
 */
const Post = require('../models/Post');
const Reaction = require('../models/Reaction');
const Comment = require('../models/Comment');
const Repost = require('../models/Repost');
const Vote = require('../models/Vote');
const PostShare = require('../models/PostShare');
const CommentVote = require('../models/CommentVote');

const { WEIGHTS, COMMENT_CAP_PER_PERSON, TIERS, tierFor, pointsOf } = require('./pointsMath');
const MAX_POSTS = 3000;
const TTL_MS = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const cache = new Map();

async function tally(userId, since) {
  const posts = await Post.find({ author: userId, removedAt: null, type: 'original' })
    .sort({ _id: -1 }).limit(MAX_POSTS).select('_id destinations').lean();
  const feedIds = [];
  const communityIds = [];
  for (const post of posts) {
    if ((post.destinations || []).some((item) => item.type === 'community')) communityIds.push(post._id);
    else feedIds.push(post._id);
  }
  const time = since ? { createdAt: { $gte: since } } : {};
  const notMe = { $ne: userId };

  const [likes, comments, shares, reposts, downs] = await Promise.all([
    feedIds.length ? Reaction.aggregate([{ $match: { post: { $in: feedIds }, user: notMe, ...time } }, { $group: { _id: '$post', n: { $sum: 1 } } }]) : [],
    feedIds.length ? Comment.aggregate([{ $match: { post: { $in: feedIds }, author: notMe, deletedAt: null, ...time } }, { $group: { _id: { post: '$post', author: '$author' }, n: { $sum: 1 } } }]) : [],
    feedIds.length ? PostShare.aggregate([{ $match: { post: { $in: feedIds }, user: notMe, ...time } }, { $group: { _id: '$post', n: { $sum: 1 } } }]) : [],
    feedIds.length ? Repost.aggregate([{ $match: { post: { $in: feedIds }, user: notMe, ...time } }, { $group: { _id: '$post', n: { $sum: 1 } } }]) : [],
    communityIds.length ? Vote.aggregate([{ $match: { post: { $in: communityIds }, user: notMe, value: -1, ...time } }, { $group: { _id: '$post', n: { $sum: 1 } } }]) : [],
  ]);

  // Likes on the player's own comments under feed posts (community comments don't earn points).
  const myComments = await Comment.find({ author: userId, deletedAt: null }).sort({ _id: -1 }).limit(MAX_POSTS).select('_id post').lean();
  let commentLikes = 0;
  if (myComments.length) {
    const postIds = [...new Set(myComments.map((row) => String(row.post)))];
    const parents = await Post.find({ _id: { $in: postIds } }).select('destinations').lean();
    const communityPosts = new Set(parents.filter((row) => (row.destinations || []).some((item) => item.type === 'community')).map((row) => String(row._id)));
    const eligible = myComments.filter((row) => !communityPosts.has(String(row.post))).map((row) => row._id);
    if (eligible.length) {
      const [row] = await CommentVote.aggregate([{ $match: { comment: { $in: eligible }, value: 1, user: notMe, ...time } }, { $group: { _id: null, n: { $sum: 1 } } }]);
      commentLikes = row ? row.n : 0;
    }
  }

  const perPost = new Map();
  const slot = (id) => {
    const key = String(id);
    if (!perPost.has(key)) perPost.set(key, { likes: 0, comments: 0, shares: 0, reposts: 0, downvotes: 0 });
    return perPost.get(key);
  };
  for (const row of likes) slot(row._id).likes += row.n;
  for (const row of comments) slot(row._id.post).comments += Math.min(row.n, COMMENT_CAP_PER_PERSON);
  for (const row of shares) slot(row._id).shares += row.n;
  for (const row of reposts) slot(row._id).reposts += row.n;
  for (const row of downs) slot(row._id).downvotes += row.n;

  const counts = { likes: 0, comments: 0, shares: 0, reposts: 0, downvotes: 0, commentLikes };
  for (const entry of perPost.values()) for (const key of ['likes', 'comments', 'shares', 'reposts', 'downvotes']) counts[key] += entry[key];
  return { counts, perPost };
}

async function getPoints(userId) {
  const key = String(userId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const [all, week] = await Promise.all([tally(userId, null), tally(userId, new Date(Date.now() - 7 * DAY))]);
  const raw = pointsOf(all.counts);
  const total = Math.max(0, raw);
  const weekRaw = pointsOf(week.counts);

  // Top posts by points earned.
  const ranked = [...all.perPost.entries()]
    .map(([id, counts]) => ({ id, counts, points: pointsOf(counts) }))
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);
  const rows = ranked.length ? await Post.find({ _id: { $in: ranked.map((row) => row.id) } }).select('body title media createdAt').lean() : [];
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const topPosts = ranked.map((row) => {
    const post = byId.get(row.id);
    return {
      _id: row.id,
      points: row.points,
      text: post ? String(post.title || post.body || ((post.media || []).length ? 'Photo post' : '')).slice(0, 120) : '',
      createdAt: post?.createdAt || null,
      counts: row.counts,
    };
  }).filter((row) => row.text);

  const value = {
    total,
    week: weekRaw,
    breakdown: {
      likes: { count: all.counts.likes, points: all.counts.likes * WEIGHTS.like },
      comments: { count: all.counts.comments, points: all.counts.comments * WEIGHTS.comment },
      shares: { count: all.counts.shares, points: all.counts.shares * WEIGHTS.share },
      reposts: { count: all.counts.reposts, points: all.counts.reposts * WEIGHTS.repost },
      commentLikes: { count: all.counts.commentLikes, points: all.counts.commentLikes * WEIGHTS.commentLike },
      downvotes: { count: all.counts.downvotes, points: all.counts.downvotes * WEIGHTS.downvote },
    },
    weights: WEIGHTS,
    tier: tierFor(total),
    tiers: TIERS,
    topPosts,
  };
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

module.exports = { getPoints, tierFor, WEIGHTS, TIERS, COMMENT_CAP_PER_PERSON, pointsOf };
