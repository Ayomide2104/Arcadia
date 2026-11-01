const UserInterest = require('../models/UserInterest');
const Game = require('../models/Game');
const { SIGNAL_WEIGHTS, applyDeltas } = require('./feedRanking');

/*
 * Turns what a player does (view, like, comment, repost, hide, join) into small
 * lessons for their interest profile. Recording is best effort: it never
 * throws and never slows down or breaks the action that triggered it.
 */

async function deltasForPosts(posts, weight, userId) {
  const deltas = { games: {}, genres: {}, authors: {}, communities: {} };
  const gameSlugs = new Set();
  for (const post of posts) {
    for (const destination of post.destinations || []) {
      if (!destination?.target) continue;
      if (destination.type === 'game') {
        gameSlugs.add(destination.target);
        deltas.games[destination.target] = (deltas.games[destination.target] || 0) + weight;
      } else if (destination.type === 'community') {
        deltas.communities[destination.target] = (deltas.communities[destination.target] || 0) + weight;
      }
    }
    const author = String(post.author?._id || post.author || '');
    if (author && author !== String(userId)) deltas.authors[author] = (deltas.authors[author] || 0) + weight * 0.8;
  }
  if (gameSlugs.size) {
    const games = await Game.find({ slug: { $in: [...gameSlugs] } }).select('slug genres').lean();
    for (const game of games) {
      const count = posts.filter((post) => (post.destinations || []).some((d) => d.type === 'game' && d.target === game.slug)).length;
      for (const genre of game.genres || []) deltas.genres[genre] = (deltas.genres[genre] || 0) + weight * 0.6 * count;
    }
  }
  return deltas;
}

async function applySignals(userId, deltas) {
  const stored = await UserInterest.findOne({ user: userId }).lean();
  const next = applyDeltas(stored, deltas, Date.now());
  await UserInterest.updateOne(
    { user: userId },
    { $set: { games: next.games, genres: next.genres, authors: next.authors, communities: next.communities, asOf: next.asOf } },
    { upsert: true }
  );
}

/** kind: view | like | comment | repost | hidePost | hideLess | muteAuthor */
async function recordSignal(userId, post, kind) {
  try {
    const weight = SIGNAL_WEIGHTS[kind];
    if (!userId || !post || !weight) return;
    await applySignals(userId, await deltasForPosts([post], weight, userId));
  } catch { /* learning is best effort */ }
}

/** Posts that were on screen for a moment: a weak positive signal, learned in one write. */
async function recordViews(userId, posts) {
  try {
    if (!userId || !posts?.length) return;
    await applySignals(userId, await deltasForPosts(posts, SIGNAL_WEIGHTS.view, userId));
  } catch { /* best effort */ }
}

async function recordCommunityJoin(userId, slug) {
  try {
    if (!userId || !slug) return;
    await applySignals(userId, { communities: { [slug]: SIGNAL_WEIGHTS.join } });
  } catch { /* best effort */ }
}

module.exports = { recordSignal, recordViews, recordCommunityJoin, applySignals, deltasForPosts };
