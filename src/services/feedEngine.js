const {
  DAY, QUOTAS, mergeProfile, prepareProfile, topKeys, scorePost, mixPage,
  hash32, encodeCursor, decodeCursor
} = require('./feedRanking');

const PUBLIC = { destinations: { $elemMatch: { type: 'general' } } };
const PUBLIC_OR_GAME = { destinations: { $elemMatch: { type: { $in: ['general', 'game'] } } } };
const POOL = 60;
const RECENTLY_SERVED_MS = 2 * 60 * 60 * 1000;
// A post that was handed out but never looked at becomes eligible again after this.
const SERVED_HOLD_MS = 15 * 60 * 1000;
const CIRCLE_WINDOW_MS = 4 * DAY;

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
const { blockedEitherWay } = require('./blocks');
const { getFollowingIds } = require('./follows');

function createFeedEngine(models) {
  const { Post, SeenPost, FeedServed, FeedHide, UserInterest, Membership, Community, Game, getFriendIds, Reaction, Repost, Comment, User } = models;

  async function loadState(user) {
    const empty = { friendIds: [], followingIds: [], learned: null, hiddenPosts: new Set(), mutedAuthors: [], memberSlugs: [], seenAt: new Map(), servedAt: new Map() };
    if (!user) return empty;
    // One round trip instead of several in a row.
    const [blocked, followingRaw, friendIds, learned, hides, memberships, seenRows, servedRows] = await Promise.all([
      blockedEitherWay(user._id),
      getFollowingIds(user._id),
      getFriendIds(user._id),
      UserInterest.findOne({ user: user._id }).lean(),
      FeedHide.find({ user: user._id }).select('kind target').lean(),
      Membership.find({ user: user._id }).select('community').lean(),
      SeenPost.find({ user: user._id }).sort({ seenAt: -1 }).limit(1500).select('post seenAt').lean(),
      FeedServed.find({ user: user._id }).sort({ servedAt: -1 }).limit(1000).select('post servedAt').lean()
    ]);
    const communities = memberships.length
      ? await Community.find({ _id: { $in: memberships.map((row) => row.community) }, active: true }).select('slug').lean()
      : [];
    return {
      friendIds: friendIds.map(String),
      followingIds: followingRaw.filter((id) => !blocked.includes(id)),
      learned,
      hiddenPosts: new Set(hides.filter((row) => row.kind === 'post').map((row) => String(row.target))),
      mutedAuthors: [...new Set([...hides.filter((row) => row.kind === 'author').map((row) => String(row.target)), ...blocked])],
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
      if (state.followingIds.length) jobs.push(find({ author: { $in: state.followingIds }, ...PUBLIC_OR_GAME }, undefined, 100));
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
      followSet: new Set(state.followingIds),
      memberSlugs: new Set(state.memberSlugs),
      genresBySlug: new Map(games.map((row) => [row.slug, row.genres || []])),
      namesBySlug: new Map(games.map((row) => [row.slug, row.name]))
    };
    const buckets = { friends: [], following: [], communities: [], interests: [], popular: [], discover: [] };
    for (const post of posts) {
      const scored = scorePost(post, ctx);
      buckets[scored.source].push({ post, score: scored.score, source: scored.source, reason: scored.reason });
    }
    for (const list of Object.values(buckets)) list.sort((a, b) => (b.score - a.score) || String(b.post._id).localeCompare(String(a.post._id)));
    return buckets;
  }

  // Human names for the games and communities a post was shared to.
  async function attachLabels(posts) {
    const games = new Set(); const groups = new Set();
    for (const post of posts) {
      for (const d of post.destinations || []) {
        if (d.type === 'game' && d.target) games.add(d.target);
        if (d.type === 'community' && d.target) groups.add(d.target);
      }
    }
    const [gameRows, groupRows] = await Promise.all([
      games.size ? Game.find({ slug: { $in: [...games] } }).select('slug name').lean() : [],
      groups.size ? Community.find({ slug: { $in: [...groups] } }).select('slug name').lean() : []
    ]);
    const labels = {};
    for (const row of gameRows) labels[`game:${row.slug}`] = row.name;
    for (const row of groupRows) labels[`community:${row.slug}`] = row.name;
    for (const post of posts) post.labels = labels;
  }

  async function friendsTimeline({ user, state, limit, n, b, now, authors = state.friendIds, source = 'friends', reason = { type: 'friend', label: 'From your friend' } }) {
    const clauses = [{ removedAt: null }, { author: { $in: authors } }, PUBLIC_OR_GAME];
    if (state.mutedAuthors.length) clauses.push({ author: { $nin: state.mutedAuthors } });
    const hidden = [...state.hiddenPosts];
    if (hidden.length) clauses.push({ _id: { $nin: hidden } });
    if (b) clauses.push({ _id: { $lt: b } });
    const posts = authors.length
      ? await Post.find({ $and: clauses }).sort({ _id: -1 }).limit(limit).lean()
      : [];
    if (posts.length) await Post.populate(posts, { path: 'author', select: 'username displayName avatar' });
    await attachLabels(posts);
    for (const post of posts) post.feed = { source, reason };
    if (posts.length) {
      await FeedServed.bulkWrite(posts.map((item) => ({
        updateOne: { filter: { user: user._id, post: item._id }, update: { $set: { servedAt: new Date(now) }, $setOnInsert: { user: user._id, post: item._id } }, upsert: true }
      })), { ordered: false }).catch(() => {});
    }
    return {
      items: posts,
      caughtUp: false,
      nextCursor: posts.length >= limit ? encodeCursor({ n: n + 1, ex: [], b: String(posts.at(-1)._id) }) : null
    };
  }

  /**
   * "Trending in your circle": what your friends and communities are reacting to
   * right now. Friends' likes, reposts and comments count most, then posts by
   * friends, then posts in your communities, then plain momentum.
   */
  async function trendingInCircle({ user = null, limit = 6 }) {
    const now = Date.now();
    const since = new Date(now - CIRCLE_WINDOW_MS);
    const state = await loadState(user);
    const friendSet = new Set(state.friendIds);
    const mine = user ? String(user._id) : null;

    const [likes, reposts, comments] = state.friendIds.length
      ? await Promise.all([
          Reaction.find({ user: { $in: state.friendIds }, createdAt: { $gte: since } }).select('user post').lean(),
          Repost.find({ user: { $in: state.friendIds }, createdAt: { $gte: since } }).select('user post').lean(),
          Comment.find({ author: { $in: state.friendIds }, createdAt: { $gte: since } }).select('author post').lean()
        ])
      : [[], [], []];

    const activity = new Map(); // postId -> { likes:Set, reposts:Set, comments:Set }
    const touch = (postId, kind, who) => {
      const id = String(postId);
      if (!activity.has(id)) activity.set(id, { likes: new Set(), reposts: new Set(), comments: new Set() });
      activity.get(id)[kind].add(String(who));
    };
    for (const row of likes) touch(row.post, 'likes', row.user);
    for (const row of reposts) touch(row.post, 'reposts', row.user);
    for (const row of comments) touch(row.post, 'comments', row.author);

    const visible = { removedAt: null, destinations: { $elemMatch: { type: { $in: ['general', 'game'] } } } };
    const clauses = [{ removedAt: null }];
    if (state.mutedAuthors.length) clauses.push({ author: { $nin: state.mutedAuthors } });
    if (state.hiddenPosts.size) clauses.push({ _id: { $nin: [...state.hiddenPosts] } });
    const find = (extra, sort = { createdAt: -1, _id: -1 }, cap = 60) =>
      Post.find({ $and: [...clauses, extra] }).sort(sort).limit(cap).lean();

    const jobs = [
      find({ ...PUBLIC_OR_GAME, createdAt: { $gte: since } }, { likeCount: -1, commentCount: -1, repostCount: -1, _id: -1 }, 60)
    ];
    if (activity.size) jobs.push(find({ _id: { $in: [...activity.keys()] }, ...PUBLIC_OR_GAME }, undefined, 80));
    if (state.friendIds.length) jobs.push(find({ author: { $in: state.friendIds }, ...PUBLIC_OR_GAME, createdAt: { $gte: since } }, undefined, 40));
    if (state.memberSlugs.length) jobs.push(find({ destinations: { $elemMatch: { type: 'community', target: { $in: state.memberSlugs } } }, createdAt: { $gte: since } }, undefined, 40));

    const pool = new Map();
    for (const list of await Promise.all(jobs)) for (const post of list) pool.set(String(post._id), post);

    const scored = [];
    for (const post of pool.values()) {
      const id = String(post._id);
      const author = String(post.author);
      if (mine && author === mine) continue;
      const act = activity.get(id);
      const hours = Math.max(0, (now - new Date(post.createdAt).getTime()) / 3600000);
      const inCommunity = (post.destinations || []).some((d) => d.type === 'community' && state.memberSlugs.includes(d.target));
      const friendEngagement = act ? 3 * act.reposts.size + 2 * act.likes.size + 2.5 * act.comments.size : 0;
      const engagement = (post.likeCount || 0) + 2 * (post.commentCount || 0) + 3 * (post.repostCount || 0);
      const momentum = Math.min(3, Math.log1p((engagement / Math.pow(hours + 2, 0.75)) * 3));
      const circle = friendEngagement > 0 || friendSet.has(author) || inCommunity;
      const score = friendEngagement + (friendSet.has(author) ? 2 : 0) + (inCommunity ? 1 : 0) + momentum + 1.5 * Math.exp(-hours / 36) + (circle ? 0.5 : 0);
      if (score < 1.2) continue;
      scored.push({ post, score, act, circle, author, inCommunity });
    }
    scored.sort((a, b) => (b.score - a.score) || String(b.post._id).localeCompare(String(a.post._id)));

    // Circle posts first, then fill with general momentum; one post per author.
    const seenAuthors = new Set(); const top = [];
    for (const entry of [...scored.filter((e) => e.circle), ...scored.filter((e) => !e.circle)]) {
      if (seenAuthors.has(entry.author)) continue;
      seenAuthors.add(entry.author); top.push(entry);
      if (top.length >= limit) break;
    }

    const items = top.map((entry) => entry.post);
    if (items.length) await Post.populate(items, { path: 'author', select: 'username displayName avatar' });
    await attachLabels(items);

    const whoIds = new Set();
    for (const entry of top) for (const kind of ['reposts', 'likes', 'comments']) for (const who of entry.act?.[kind] || []) whoIds.add(who);
    const people = whoIds.size && User ? await User.find({ _id: { $in: [...whoIds] } }).select('username displayName').lean() : [];
    const nameOf = new Map(people.map((row) => [String(row._id), row.displayName || row.username]));

    top.forEach((entry, index) => {
      const post = items[index];
      const act = entry.act;
      let line = 'Popular right now';
      let kind = 'popular';
      if (act && (act.reposts.size || act.likes.size || act.comments.size)) {
        const verb = act.reposts.size ? 'reposted' : act.comments.size ? 'commented on' : 'liked';
        const group = act.reposts.size ? act.reposts : act.comments.size ? act.comments : act.likes;
        const names = [...group].map((id) => nameOf.get(id)).filter(Boolean);
        const total = new Set([...act.reposts, ...act.likes, ...act.comments]).size;
        const first = names[0] || 'A friend';
        line = total > 1 ? `${first} and ${total - 1} ${total - 1 === 1 ? 'friend' : 'friends'} ${verb} this` : `${first} ${verb} this`;
        kind = 'friends';
      } else if (friendSet.has(entry.author)) { line = 'From your friend'; kind = 'friend'; }
      else if (entry.inCommunity) { line = 'Hot in your communities'; kind = 'community'; }
      post.circle = { kind, line, friends: entry.act ? new Set([...entry.act.reposts, ...entry.act.likes, ...entry.act.comments]).size : 0 };
    });

    return { items };
  }

  async function buildFeedPage({ user = null, feed = 'for-you', game = null, limit = 20, cursor = null }) {
    const now = Date.now();
    const { n, ex, b } = decodeCursor(cursor);
    const state = await loadState(user);

    // Friends: a plain timeline, newest first. It never goes empty just because
    // you have already scrolled past a post.
    if (user && feed === 'friends' && !game) return friendsTimeline({ user, state, limit, n, b, now });
    if (user && feed === 'following' && !game) {
      return friendsTimeline({ user, state, limit, n, b, now, authors: state.followingIds, source: 'following', reason: { type: 'following', label: 'From someone you follow' } });
    }

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
    const heldBack = [...state.servedAt].filter(([, at]) => now - at < SERVED_HOLD_MS).map(([id]) => id);
    const unseenExcluded = new Set([...state.hiddenPosts, ...state.seenAt.keys(), ...heldBack, ...ex]);
    const fresh = await fetchPool({ feed, game, user, state, interestGames, topAuthors, excluded: [...unseenExcluded], now });
    let buckets = await rank({ posts: fresh, user, state, profile, feed, game, seed, now });
    let picked = mixPage(buckets, quotas, limit);

    // 2) Out of unseen posts: bring back older ones, least recently seen first.
    let recycled = 0;
    if (user && picked.length < limit) {
      const chosen = new Set(picked.map((entry) => String(entry.post._id)));
      // On a fresh load nothing is held back, so a refresh never leaves the feed empty.
      // While scrolling further, posts handed out a moment ago are skipped to avoid loops.
      const recent = n > 0 ? [...state.servedAt].filter(([, at]) => now - at < RECENTLY_SERVED_MS).map(([id]) => id) : [];
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
    await attachLabels(posts);
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

  return { buildFeedPage, trendingInCircle, hash32 };
}

module.exports = { createFeedEngine };
