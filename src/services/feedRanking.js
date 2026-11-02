'use strict';
/*
 * Arcadia feed ranking: pure functions only (no database), so they are easy to test.
 *
 * A post is scored from: freshness, how well it matches what the player cares
 * about (learned interests), friendship, popularity momentum, and a small
 * "new post" boost. Posts are then grouped by WHY they are shown (friends,
 * communities, interests, popular, discover) and mixed by quota so every page
 * feels balanced instead of being one long sorted list.
 */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// What each action teaches the profile.
const SIGNAL_WEIGHTS = {
  view: 0.3, like: 3, comment: 4, repost: 5, join: 4,
  hidePost: -1.5, hideLess: -5, muteAuthor: -6
};

// Starting interests (from onboarding) so brand-new players still get a personal feed.
const BASE_GAME = 4;
const BASE_GENRE = 3;
const HALF_LIFE_DAYS = 21;
const MAX_KEYS = 60;

// How many of every 100 slots each source gets.
const QUOTAS = {
  'for-you': { friends: 18, communities: 12, interests: 40, popular: 20, discover: 10 },
  interests: { interests: 70, communities: 20, discover: 10 },
  friends: { friends: 100 },
  game: { friends: 20, interests: 30, popular: 30, discover: 20 },
  guest: { popular: 75, discover: 25 }
};

const SAFE_KEY = /^[A-Za-z0-9_-]{1,80}$/;
const GROUPS = ['games', 'genres', 'authors', 'communities'];

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const decay = (days) => Math.pow(0.5, Math.max(0, days) / HALF_LIFE_DAYS);

/* ----------------------------- profile ----------------------------- */

// Learned weights, brought up to date, plus the interests picked at sign-up.
function mergeProfile(user, learned, now = Date.now()) {
  const factor = learned?.asOf ? decay((now - new Date(learned.asOf).getTime()) / DAY) : 1;
  const out = { games: {}, genres: {}, authors: {}, communities: {} };
  for (const slug of user?.favoriteGames || []) out.games[slug] = (out.games[slug] || 0) + BASE_GAME;
  for (const id of user?.genres || []) out.genres[id] = (out.genres[id] || 0) + BASE_GENRE;
  for (const group of GROUPS) {
    for (const [key, value] of Object.entries(learned?.[group] || {})) {
      if (typeof value === 'number' && Number.isFinite(value)) out[group][key] = (out[group][key] || 0) + value * factor;
    }
  }
  return out;
}

// Add new lessons to the stored weights (after fading the old ones) and keep it small.
function applyDeltas(stored, deltas, now = Date.now()) {
  const factor = stored?.asOf ? decay((now - new Date(stored.asOf).getTime()) / DAY) : 1;
  const next = { asOf: new Date(now) };
  for (const group of GROUPS) {
    const merged = {};
    for (const [key, value] of Object.entries(stored?.[group] || {})) {
      if (typeof value === 'number' && Number.isFinite(value) && SAFE_KEY.test(key)) merged[key] = value * factor;
    }
    for (const [key, value] of Object.entries(deltas?.[group] || {})) {
      if (typeof value === 'number' && Number.isFinite(value) && SAFE_KEY.test(key)) merged[key] = (merged[key] || 0) + value;
    }
    next[group] = Object.fromEntries(
      Object.entries(merged)
        .filter(([, value]) => Math.abs(value) >= 0.05)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, MAX_KEYS)
        .map(([key, value]) => [key, Math.round(value * 1000) / 1000])
    );
  }
  return next;
}

function prepareProfile(raw) {
  const prepared = {};
  for (const group of GROUPS) {
    const map = new Map();
    let max = 0;
    for (const [key, value] of Object.entries(raw?.[group] || {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      map.set(key, value);
      if (value > max) max = value;
    }
    prepared[group] = { map, max };
  }
  return prepared;
}

function affinity(group, key) {
  if (!group || key == null) return 0;
  const value = group.map.get(String(key));
  if (!value) return 0;
  // Likes are measured against the player's strongest interest; dislikes against
  // that or a fixed floor, so "show me less" works even before any likes exist.
  if (value > 0) return group.max > 0 ? Math.min(1, value / group.max) : 0;
  return Math.max(-1, value / Math.max(group.max, 4));
}

function topKeys(group, count, minimum = 0) {
  return [...group.map.entries()].filter(([, value]) => value > minimum).sort((a, b) => b[1] - a[1]).slice(0, count).map(([key]) => key);
}

/* ----------------------------- scoring ----------------------------- */

const engagementOf = (post) => (post.likeCount || 0) + 2 * (post.commentCount || 0) + 3 * (post.repostCount || 0);

/**
 * ctx: { now, profile (prepared), friendSet:Set, memberSlugs:Set, genresBySlug:Map,
 *        namesBySlug:Map, seed:string }
 * Returns { score, source, reason, parts }.
 */
function scorePost(post, ctx) {
  const hours = Math.max(0, (ctx.now - new Date(post.createdAt).getTime()) / HOUR);
  const destinations = post.destinations || [];
  const gameSlugs = destinations.filter((d) => d.type === 'game' && d.target).map((d) => d.target);
  const communitySlugs = destinations.filter((d) => d.type === 'community' && d.target).map((d) => d.target);
  const authorId = String(post.author?._id || post.author);

  let gameAff = 0; let bestGame = null;
  for (const slug of gameSlugs) {
    const value = affinity(ctx.profile.games, slug);
    if (bestGame === null || value > gameAff) { gameAff = value; bestGame = slug; }
  }
  let genreAff = 0; let bestGenre = null;
  for (const slug of gameSlugs) {
    for (const genre of ctx.genresBySlug?.get(slug) || []) {
      const value = affinity(ctx.profile.genres, genre);
      if (bestGenre === null || value > genreAff) { genreAff = value; bestGenre = genre; }
    }
  }
  const authorAff = affinity(ctx.profile.authors, authorId);
  const memberSlug = communitySlugs.find((slug) => ctx.memberSlugs?.has(slug)) || null;
  let communityAff = memberSlug ? 0.6 + 0.4 * Math.max(0, affinity(ctx.profile.communities, memberSlug)) : 0;
  if (!memberSlug) for (const slug of communitySlugs) communityAff = Math.max(communityAff, 0.5 * affinity(ctx.profile.communities, slug));

  const isFriend = ctx.friendSet?.has(authorId) || false;
  const freshness = 3 * Math.exp(-hours / 36);
  const interest = 3.2 * gameAff + 1.4 * genreAff + 1.8 * authorAff + 1.6 * communityAff;
  const friend = isFriend ? 1.6 : 0;

  const engagement = engagementOf(post);
  const velocity = engagement / Math.pow(hours + 2, 0.75);
  const popularity = Math.min(3, Math.log1p(velocity * 3));
  // Brand-new posts get a short test run so new voices are not buried.
  const newBoost = hours < 2 && engagement < 5 ? 0.8 * (1 - hours / 2) : 0;
  const visual = (post.media || []).length ? 0.15 : 0;
  // Stable per player and per session, so the feed is lively but does not flicker between pages.
  const jitter = ((hash32(`${ctx.seed}:${post._id}`) % 1000) / 1000 - 0.5) * 0.5;

  const score = freshness + interest + friend + 0.8 * popularity + newBoost + visual + jitter;

  let source = 'discover';
  let reason = { type: 'discover', label: 'Something new for you' };
  if (isFriend) { source = 'friends'; reason = { type: 'friend', label: 'From your friend' }; }
  else if (memberSlug) { source = 'communities'; reason = { type: 'community', label: `From c/${memberSlug}` }; }
  else if (gameAff >= 0.25 || genreAff >= 0.5 || authorAff >= 0.5) {
    source = 'interests';
    if (gameAff >= 0.25 && bestGame) reason = { type: 'game', label: `Because you like ${ctx.namesBySlug?.get(bestGame) || bestGame}` };
    else if (authorAff >= 0.5) reason = { type: 'author', label: 'You often engage with this player' };
    else reason = { type: 'genre', label: `Because you like ${String(bestGenre).replace(/-/g, ' ')} games` };
  } else if (popularity >= 1) { source = 'popular'; reason = { type: 'popular', label: 'Popular right now' }; }

  return { score, source, reason, parts: { freshness, interest, friend, popularity, newBoost } };
}

/* ------------------------------ mixing ------------------------------ */

/**
 * buckets: { source: [{ post, score, ... }] }, each sorted best first.
 * Picks `limit` entries following the quotas (smooth weighted round-robin),
 * never lets one author take more than two spots in a row (or more than
 * `maxPerAuthor` on a page unless there is nothing else), and falls back to the
 * best remaining post when a source runs dry.
 */
function mixPage(buckets, quotas, limit, { maxPerAuthor = 2 } = {}) {
  const pools = {};
  for (const [name, list] of Object.entries(buckets)) pools[name] = [...list];
  const credit = {};
  const picked = [];
  const perAuthor = new Map();
  const authorOf = (entry) => String(entry.post.author?._id || entry.post.author);

  const tryTake = (name, relaxed) => {
    const pool = pools[name];
    if (!pool?.length) return null;
    const lastTwo = picked.slice(-2).map(authorOf);
    for (let i = 0; i < pool.length; i += 1) {
      const author = authorOf(pool[i]);
      const run = lastTwo.length === 2 && lastTwo[0] === author && lastTwo[1] === author;
      const crowded = (perAuthor.get(author) || 0) >= maxPerAuthor;
      if (run) continue;
      if (crowded && !relaxed) continue;
      return pool.splice(i, 1)[0];
    }
    return null;
  };

  const names = Object.keys(quotas).filter((name) => quotas[name] > 0);
  while (picked.length < limit) {
    let entry = null;
    for (const relaxed of [false, true]) {
      const live = names.filter((name) => pools[name]?.length);
      if (live.length) {
        const total = live.reduce((sum, name) => sum + quotas[name], 0);
        for (const name of live) credit[name] = (credit[name] || 0) + quotas[name];
        // Walk sources from most to least owed until one yields a usable post.
        const order = [...live].sort((a, b) => (credit[b] - credit[a]) || (quotas[b] - quotas[a]));
        for (const name of order) {
          entry = tryTake(name, relaxed);
          if (entry) { credit[name] -= total; break; }
        }
        if (!entry) for (const name of live) credit[name] -= quotas[name]; // undo this round's credit
      }
      if (entry) break;
    }
    if (!entry) {
      // Sources with no quota (or exhausted quota sources): best remaining post overall.
      let bestName = null; let best = null;
      for (const [name, list] of Object.entries(pools)) {
        if (list.length && (!best || list[0].score > best.score)) { best = list[0]; bestName = name; }
      }
      if (!bestName) break;
      entry = tryTake(bestName, true);
      if (!entry) break;
    }
    picked.push(entry);
    perAuthor.set(authorOf(entry), (perAuthor.get(authorOf(entry)) || 0) + 1);
  }
  return picked;
}

/* ------------------------------ cursor ------------------------------ */

function encodeCursor(data) { return Buffer.from(JSON.stringify(data)).toString('base64url'); }

function decodeCursor(text) {
  if (!text) return { n: 0, ex: [], b: null };
  if (typeof text !== 'string' || text.length > 6000) throw Object.assign(new Error('Invalid pagination cursor.'), { status: 400 });
  try {
    const data = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    const n = Number.isInteger(data?.n) && data.n >= 0 && data.n < 10000 ? data.n : null;
    const ex = Array.isArray(data?.ex) ? data.ex.filter((id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)).slice(0, 150) : [];
    const b = typeof data?.b === 'string' && /^[a-f\d]{24}$/i.test(data.b) ? data.b : null;
    if (n === null) throw new Error('bad');
    return { n, ex, b };
  } catch {
    throw Object.assign(new Error('Invalid pagination cursor.'), { status: 400 });
  }
}

module.exports = {
  HOUR, DAY, SIGNAL_WEIGHTS, QUOTAS, SAFE_KEY, GROUPS,
  hash32, decay, mergeProfile, applyDeltas, prepareProfile, affinity, topKeys,
  engagementOf, scorePost, mixPage, encodeCursor, decodeCursor
};
