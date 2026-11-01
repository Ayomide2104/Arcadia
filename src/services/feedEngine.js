const {
  DAY, QUOTAS, mergeProfile, prepareProfile, topKeys, scorePost, mixPage,
  hash32, encodeCursor, decodeCursor
} = require('./feedRanking');

const PUBLIC = { destinations: { $elemMatch: { type: 'general' } } };
const PUBLIC_OR_GAME = { destinations: { $elemMatch: { type: { $in: ['general', 'game'] } } } };
const POOL = 60;
const RECENTLY_SERVED_MS = 2 * 60 * 60 * 1000;

/**
 * Builds one page of a player's feed.
 *
 *  1. Gather a bounded pool of candidates from each source (friends, communities,
 *     interests, popular, discover) using indexed queries.
 *  2. Leave out everything the player has already seen or been served, plus
 *     hidden posts and muted authors, so nothing repeats.
 *  3. Score the rest against the player's learned interests, group by why it is
 *     shown, and mix by quota with variety rules.
 *  4. Only when the player has run out of unseen posts, bring back older ones
 *     (least recently seen first) and mark where the "caught up" line goes.
 */
function createFeedEngine(models) {
  const { Post, SeenPost, FeedServed, FeedHide, UserInterest, Membership, Community, Game, getFriendIds } = models;

  async function loadState(user) {
    const empty = { friendIds: [], learned: null, hiddenPosts: new Set(), mutedAuthors: [], memberSlugs: [], seenAt: new Map(), servedAt: new Map() };
    if (!user) return empty;
    const [friendIds, learned, hides, memberships, seenRows, servedRows] = await Promise.all([
      getFriendIds(user._id),
      UserInterest.findOne({ user: user._id }).lean(),
      FeedHide.find({ user: user._id }).select('kind target').lean(),
      Membership.find({ user: user._id }).select('community').lean(),
      SeenPost.find({ user: user._id }).sort({ seenAt: -1 }).limit(4000).select('post seenAt').lean(),
      FeedServed.find({ user: user._id }).sort({ servedAt: -1 }).limit(3000).select('post servedAt').lean()
    ]);
    const communities = memberships.length
      ? await Community.find({ _id: { $in: memberships.map((row) => row.community) }, active: true }).select('slug').lean()
      : [];
    return {
      friendIds: friendIds.map(String),
      learned,
      hiddenPosts: new Set(hides.filter((row) => row.kind === 'post').map((row) => String(row.target))),
      mutedAuthors: hides.filter((row) => row.kind === 'author').map((row) => String(row.target)),
      memberSlugs: communities.map((row) => row.slug),
      seenAt: new Map(seenRows.map((row) => [String(row.post), new Date(row.seenAt).getTime()])),
      servedAt: new Map(servedRows.map((row) => [String(row.post), new Date(row.servedAt).getTime()]))
    };
  }

  // One round of candidate queries. `excluded` is the list of post ids to leave out.
  async function fetchPool({ feed, game, user, state, interestGames, topAuthors, excluded, now }) {
    const clauses = [{ removedAt: null }];
    if (excluded.length) clauses.push({ _id: { $nin: excluded } });
    if (state.mutedAuthors.length) clauses.push({ author: { $nin: state.mutedAuthors } });
    const find = (extra, sort = { createdAt: -1, _id: -1 }, limit = POOL) =>
      Post.find({ $and: [...clauses, extra] }).sort(sort).limit(limit).lean();

    const jobs = [];
    const weekAgo = new Date(now - 7 * DAY);
    if (game) {
      jobs.push(find({ destinations: { $elemMatch: { type: 'game', target: game } } }, undefined, 120));
      jobs.push(find({ destinations: { $elemMatch: { type: 'game', target: game } }, createdAt: { $gte: weekAgo } }, { likeCount: -1, commentCount: -1, _id: -1 }, 40));
    } else if (!user) {
      jobs.push(find({ ...PUBLIC, createdAt: { $gte: weekAgo } }, { likeCount: -1, commentCount: -1, repostCount: -1, _id: -1 }, 80));
      jobs.push(find(PUBLIC, undefined, 80));
    } else if (feed === 'friends') {
      if (state.friendIds.length) jobs.push(find({ author: { $in: state.friendIds }, ...PUBLIC_OR_GAME }, undefined, 120));
    } else {
      if (state.friendIds.length) jobs.push(find({ author: { $in: state.friendIds }, ...PUBLIC_OR_GAME }));
      if (state.memberSlugs.length) jobs.push(find({ destinations: { $elemMatch: { type: 'community', target: { $in: state.memberSlugs } } } }));
      if (interestGames.length) jobs.push(find({ destinations: { $elemMatch: { type: 'game', target: { $in: interestGames } } } }, undefined, 80));
      if (topAuthors.length) jobs.push(find({ author: { $in: topAuthors }, ...PUBLIC_OR_GAME }, undefined, 40));
      if (feed === 'for-you') {
        jobs.push(find({ ...PUBLIC, createdAt: { $gte: weekAgo } }, { likeCount: -1, commentCount: -1, repostCount: -1, _id: -1 }, 80));
        jobs.push(find({ ...PUBLIC, createdAt: { $gte: new Date(now - 14 * DAY) } }, undefined, 120));
      } else {
        jobs.push(find({ ...PUBLIC, createdAt: { $gte: new Date(now - 14 * DAY) } }, undefined, 60));
      }
    }
    const results = await Promise.all(jobs);
    const pool = new Map();
    for (const list of results) for (const post of list) pool.set(String(post._id), post);
    return [...pool.values()];
  }

  async function rank({ posts, user, state, profile, feed, game, seed, now }) {
    const slugs = new Set();
    for (const post of posts) for (const d of post.destinations || []) if (d.type === 'game' && d.target) slugs.add(d.target);
    const games = slugs.size ? await Game.find({ slug: { $in: [...slugs] } }).select('slug name genres').lean() : [];
    const ctx = {
      now, profile, seed,
      friendSet: new Set(state.friendIds),
      memberSlugs: new Set(state.memberSlugs),
      genresBySlug: new Map(games.map((row) => [row.slug, row.genres || []])),
      namesBySlug: new Map(games.map((row) => [row.slug, row.name]))
    };
    const buckets = { friends: [], communities: [], interests: [], popular: [], discover: [] };
    for (const post of posts) {
      const scored = scorePost(post, ctx);
      buckets[scored.source].push({ post, score: scored.score, source: scored.source, reason: scored.reason });
    }
    for (const list of Object.values(buckets)) list.sort((a, b) => (b.score - a.score) || String(b.post._id).localeCompare(String(a.post._id)));
    return buckets;
  }

  async function buildFeedPage({ user = null, feed = 'for-you', game = null, limit = 20, cursor = null }) {
    const now = Date.now();
    const { n, ex } = decodeCursor(cursor);
    const state = await loadState(user);
    const rawProfile = mergeProfile(user || {}, state.learned, now);
    const profile = prepareProfile(rawProfile);

    const interestGames = [...topKeys(profile.games, 8)];
    const topGenres = topKeys(profile.genres, 3);
    if (topGenres.length && Game && user && !game) {
      const related = await Game.find({ genres: { $in: topGenres }, active: true }).select('slug').limit(30).lean();
      for (const row of related) if (!interestGames.includes(row.slug)) interestGames.push(row.slug);
    }
    const topAuthors = topKeys(profile.authors, 10, 0.5);
    const quotas = !user ? QUOTAS.guest : game ? QUOTAS.game : (QUOTAS[feed] || QUOTAS['for-you']);
    const seed = `${user ? user._id : 'guest'}:${Math.floor(now / (30 * 60 * 1000))}`;

    // 1) Unseen posts only.
    const unseenExcluded = new Set([...state.hiddenPosts, ...state.seenAt.keys(), ...state.servedAt.keys(), ...ex]);
    const fresh = await fetchPool({ feed, game, user, state, interestGames, topAuthors, excluded: [...unseenExcluded], now });
    let buckets = await rank({ posts: fresh, user, state, profile, feed, game, seed, now });
    let picked = mixPage(buckets, quotas, limit);

    // 2) Out of unseen posts: bring back older ones, least recently seen first.
    let recycled = 0;
    if (user && picked.length < limit) {
      const chosen = new Set(picked.map((entry) => String(entry.post._id)));
      const recent = [...state.servedAt].filter(([, at]) => now - at < RECENTLY_SERVED_MS).map(([id]) => id);
      const skip = new Set([...state.hiddenPosts, ...ex, ...recent, ...chosen]);
      const again = await fetchPool({ feed, game, user, state, interestGames, topAuthors, excluded: [...skip], now });
      buckets = await rank({ posts: again, user, state, profile, feed, game, seed, now });
      for (const list of Object.values(buckets)) {
        for (const entry of list) {
          const id = String(entry.post._id);
          const last = Math.max(state.seenAt.get(id) || 0, state.servedAt.get(id) || 0);
          if (last) entry.score += Math.min(1, (now - last) / DAY * 0.15); // longer ago = comes back sooner
          entry.again = Boolean(last);
        }
        list.sort((a, b) => (b.score - a.score) || String(b.post._id).localeCompare(String(a.post._id)));
      }
      const extra = mixPage(buckets, quotas, limit - picked.length);
      // Truly unseen leftovers first, then the ones the player has met before.
      extra.sort((a, b) => Number(a.again) - Number(b.again));
      for (const entry of extra) { if (entry.again) recycled += 1; picked.push(entry); }
    }

    // Authors for the page, flags for the client.
    const posts = picked.map((entry) => entry.post);
    if (posts.length) await Post.populate(posts, { path: 'author', select: 'username displayName avatar' });
    let dividerPlaced = false;
    const items = picked.map((entry) => {
      const item = entry.post;
      const info = { source: entry.source, reason: entry.reason };
      if (entry.again) {
        info.recycled = true;
        info.reason = { type: 'again', label: 'You may have missed this' };
        if (!dividerPlaced) { info.divider = true; dividerPlaced = true; }
      }
      item.feed = info;
      return item;
    });

    if (user && items.length) {
      await FeedServed.bulkWrite(items.map((item) => ({
        updateOne: { filter: { user: user._id, post: item._id }, update: { $set: { servedAt: new Date(now) }, $setOnInsert: { user: user._id, post: item._id } }, upsert: true }
      })), { ordered: false }).catch(() => {});
    }

    const exNext = [...ex, ...items.map((item) => String(item._id))].slice(-150);
    const full = items.length >= limit;
    return {
      items,
      caughtUp: recycled > 0,
      nextCursor: full ? encodeCursor({ n: n + 1, ex: exNext }) : null
    };
  }

  return { buildFeedPage, hash32 };
}

module.exports = { createFeedEngine };
