const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/services/feedRanking');
const { createFeedEngine } = require('../src/services/feedEngine');
const { fakeModel } = require('./helpers/fakeFeedModels');

const NOW = Date.parse('2026-11-01T12:00:00Z');
const hex = (n) => n.toString(16).padStart(24, '0');
const hoursAgo = (h) => new Date(NOW - h * 3600000);

function post(n, extra = {}) {
  return { _id: hex(n), author: hex(1000 + (extra.a ?? n)), createdAt: hoursAgo(extra.h ?? 1), destinations: extra.d || [{ type: 'general', target: null }], likeCount: extra.likes || 0, commentCount: 0, repostCount: 0, media: [], removedAt: null };
}

function ctxFor(profileRaw, extra = {}) {
  return { now: NOW, seed: 's', profile: R.prepareProfile(profileRaw), friendSet: new Set(), memberSlugs: new Set(), genresBySlug: new Map([['efootball', ['sports']]]), namesBySlug: new Map([['efootball', 'eFootball']]), ...extra };
}

test('a post about a favourite game outranks an unrelated one', () => {
  const ctx = ctxFor({ games: { efootball: 4 }, genres: {}, authors: {}, communities: {} });
  const match = R.scorePost(post(1, { d: [{ type: 'game', target: 'efootball' }] }), ctx);
  const other = R.scorePost(post(2), ctx);
  assert.ok(match.score > other.score + 2);
  assert.equal(match.source, 'interests');
  assert.match(match.reason.label, /eFootball/);
});

test('friends, community and popular posts get their own source and reason', () => {
  const friendId = hex(1007);
  const ctx = ctxFor({ games: {}, genres: {}, authors: {}, communities: {} }, { friendSet: new Set([friendId]), memberSlugs: new Set(['arcadia']) });
  assert.equal(R.scorePost({ ...post(3), author: friendId }, ctx).source, 'friends');
  assert.equal(R.scorePost(post(4, { d: [{ type: 'community', target: 'arcadia' }] }), ctx).source, 'communities');
  const hot = R.scorePost(post(5, { likes: 80, h: 3 }), ctx);
  assert.equal(hot.source, 'popular');
  assert.ok(hot.score > R.scorePost(post(6, { h: 3 }), ctx).score);
});

test('negative signals push a game down', () => {
  const profile = R.mergeProfile({ favoriteGames: ['a'] }, R.applyDeltas(null, { games: { a: -9 } }, NOW), NOW);
  assert.ok(profile.games.a < 0);
  const ctx = ctxFor(profile);
  const hidden = R.scorePost(post(7, { d: [{ type: 'game', target: 'a' }] }), ctx);
  const plain = R.scorePost(post(8), ctx);
  assert.ok(hidden.score < plain.score);
});

test('learned weights fade and stay small', () => {
  const first = R.applyDeltas(null, { games: { halo: 10 } }, NOW);
  const later = R.applyDeltas(first, { games: { fifa: 1 } }, NOW + 21 * R.DAY);
  assert.ok(Math.abs(later.games.halo - 5) < 0.01);
  const many = {}; for (let i = 0; i < 200; i += 1) many[`g${i}`] = i + 1;
  assert.ok(Object.keys(R.applyDeltas(null, { games: many }, NOW).games).length <= 60);
  assert.equal(Object.keys(R.applyDeltas(null, { games: { 'bad.key': 3, $x: 3 } }, NOW).games).length, 0);
});

test('mixing follows quotas and never gives one author three in a row', () => {
  const entries = (source, count, startAuthor) => Array.from({ length: count }, (_, i) => ({ post: { _id: hex(Math.random() * 1e9 | 0), author: hex(startAuthor + (i % 3 === 0 ? 0 : i)) }, score: 10 - i, source }));
  const buckets = { friends: entries('friends', 10, 1), interests: entries('interests', 20, 100), popular: entries('popular', 10, 300), discover: entries('discover', 10, 500), communities: [] };
  const page = R.mixPage(buckets, R.QUOTAS['for-you'], 20);
  assert.equal(page.length, 20);
  const counts = page.reduce((acc, entry) => ({ ...acc, [entry.source]: (acc[entry.source] || 0) + 1 }), {});
  assert.ok(counts.interests >= 7 && counts.interests <= 11, JSON.stringify(counts));
  assert.ok(counts.popular >= 2 && counts.popular <= 6, JSON.stringify(counts));
  for (let i = 2; i < page.length; i += 1) {
    const a = [page[i - 2], page[i - 1], page[i]].map((entry) => entry.post.author);
    assert.ok(!(a[0] === a[1] && a[1] === a[2]), 'three in a row');
  }
});

test('mixing falls back to other sources when one is empty', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ post: { _id: hex(i + 1), author: hex(i + 50) }, score: 12 - i, source: 'discover' }));
  assert.equal(R.mixPage({ discover: list }, R.QUOTAS['for-you'], 10).length, 10);
});

test('cursor round trip and rejection of junk', () => {
  const token = R.encodeCursor({ n: 3, ex: [hex(1), 'nope'] });
  assert.deepEqual(R.decodeCursor(token), { n: 3, ex: [hex(1)] });
  assert.deepEqual(R.decodeCursor(null), { n: 0, ex: [] });
  assert.throws(() => R.decodeCursor('###'), /Invalid/);
});

function engineWith({ posts, user, seen = [], hides = [], friends = [], learned = null, members = [] }) {
  const models = {
    Post: fakeModel(posts), SeenPost: fakeModel(seen), FeedServed: fakeModel([]), FeedHide: fakeModel(hides),
    UserInterest: { findOne: () => ({ lean: async () => learned }) },
    Membership: fakeModel(members.map((slug) => ({ user: user?._id, community: `c-${slug}` }))),
    Community: fakeModel(members.map((slug) => ({ _id: `c-${slug}`, slug, active: true }))),
    Game: fakeModel([{ slug: 'efootball', name: 'eFootball', genres: ['sports'], active: true }, { slug: 'valorant', name: 'Valorant', genres: ['fps'], active: true }]),
    getFriendIds: async () => friends
  };
  return { engine: createFeedEngine(models), models };
}

test('signed-in feed never repeats a post across pages or refreshes until the pool is empty', async () => {
  const user = { _id: hex(1), favoriteGames: ['efootball'], genres: ['sports'] };
  const posts = Array.from({ length: 45 }, (_, i) => post(i + 10, { h: i + 1, d: i % 3 === 0 ? [{ type: 'game', target: 'efootball' }, { type: 'general', target: null }] : [{ type: 'general', target: null }] }));
  const { engine } = engineWith({ posts, user });
  const seenIds = new Set();
  let cursor = null; let pages = 0; let recycledSeen = false;
  for (;;) {
    const page = await engine.buildFeedPage({ user, feed: 'for-you', limit: 20, cursor });
    pages += 1;
    for (const item of page.items) {
      if (page.caughtUp && item.feed.recycled) { recycledSeen = true; continue; }
      assert.ok(!seenIds.has(String(item._id)), `repeat ${item._id} on page ${pages}`);
      seenIds.add(String(item._id));
    }
    cursor = page.nextCursor;
    if (!cursor || pages > 6) break;
  }
  assert.equal(seenIds.size, 45, 'every unseen post is delivered exactly once');
  assert.ok(recycledSeen || pages >= 2);
});

test('after everything is served, a refresh brings older posts back with a divider', async () => {
  const user = { _id: hex(1), favoriteGames: [], genres: [] };
  const posts = Array.from({ length: 8 }, (_, i) => post(i + 10, { h: i + 1 }));
  const { engine, models } = engineWith({ posts, user });
  const first = await engine.buildFeedPage({ user, feed: 'for-you', limit: 20 });
  assert.equal(first.items.length, 8);
  assert.equal(first.caughtUp, false);
  // Pretend the player read them all a day ago.
  for (const row of models.FeedServed.rows) row.servedAt = new Date(Date.now() - 24 * 3600000);
  const again = await engine.buildFeedPage({ user, feed: 'for-you', limit: 20 });
  assert.equal(again.caughtUp, true);
  assert.equal(again.items.filter((item) => item.feed.divider).length, 1);
  assert.equal(again.items[0].feed.divider, true);
  assert.equal(again.items[0].feed.recycled, true);
});

test('hidden posts and muted authors never show up, even when recycling', async () => {
  const user = { _id: hex(1) };
  const posts = [post(10, { a: 7 }), post(11, { a: 7 }), post(12, { a: 8 }), post(13, { a: 9 })];
  const hides = [{ user: hex(1), kind: 'author', target: hex(1007) }, { user: hex(1), kind: 'post', target: hex(13) }];
  const { engine } = engineWith({ posts, user, hides });
  const page = await engine.buildFeedPage({ user, feed: 'for-you', limit: 20 });
  assert.deepEqual(page.items.map((item) => String(item._id)), [hex(12)]);
  const again = await engine.buildFeedPage({ user, feed: 'for-you', limit: 20 });
  assert.ok(!again.items.some((item) => [hex(10), hex(11), hex(13)].includes(String(item._id))));
});

test('guests get popular public posts and cursors stop repeats', async () => {
  const posts = Array.from({ length: 30 }, (_, i) => post(i + 10, { h: i + 1, likes: i % 5 === 0 ? 40 : 0 }));
  const { engine } = engineWith({ posts, user: null });
  const one = await engine.buildFeedPage({ user: null, limit: 20 });
  const two = await engine.buildFeedPage({ user: null, limit: 20, cursor: one.nextCursor });
  const ids = [...one.items, ...two.items].map((item) => String(item._id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 30);
});

test('friends feed only shows friends and interests feed leans on interests', async () => {
  const user = { _id: hex(1), favoriteGames: ['valorant'], genres: [] };
  const posts = [post(10, { a: 5 }), post(11, { a: 6 }), post(12, { a: 6, d: [{ type: 'game', target: 'valorant' }] }), post(13, { a: 9 })];
  const f = engineWith({ posts, user, friends: [hex(1005)] });
  const friends = await f.engine.buildFeedPage({ user, feed: 'friends', limit: 20 });
  assert.deepEqual(friends.items.map((item) => String(item._id)), [hex(10)]);
  const i = engineWith({ posts, user });
  const interests = await i.engine.buildFeedPage({ user, feed: 'interests', limit: 20 });
  assert.equal(String(interests.items[0]._id), hex(12));
});
