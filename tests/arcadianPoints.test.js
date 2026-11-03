const test = require('node:test');
const assert = require('node:assert/strict');
const { pointsOf, tierFor, WEIGHTS, TIERS } = require('../src/services/pointsMath');

test('weights follow the Arcadian points rules', () => {
  assert.equal(WEIGHTS.like, 1);
  assert.equal(WEIGHTS.comment, 3);
  assert.equal(WEIGHTS.share, 2);
  assert.equal(WEIGHTS.repost, 0.5);
  assert.equal(WEIGHTS.downvote, -1);
});

test('points add up across every kind of activity', () => {
  assert.equal(pointsOf({ likes: 10, comments: 4, shares: 2, reposts: 3, downvotes: 2 }), 10 + 12 + 4 + 1.5 - 2);
  assert.equal(pointsOf({ likes: 0, comments: 0, shares: 0, reposts: 0, downvotes: 0 }), 0);
  assert.equal(pointsOf({ likes: 0, comments: 0, shares: 0, reposts: 0, downvotes: 3 }), -3);
});

test('a repost is worth half a point', () => {
  assert.equal(pointsOf({ likes: 0, comments: 0, shares: 0, reposts: 1, downvotes: 0 }), 0.5);
});

test('tiers rise with points and report progress', () => {
  assert.equal(tierFor(0).name, 'Rookie');
  assert.equal(tierFor(25).name, 'Challenger');
  assert.equal(tierFor(149).name, 'Challenger');
  assert.equal(tierFor(150).name, 'Veteran');
  assert.equal(tierFor(2500).next, null);
  const mid = tierFor(87.5);
  assert.equal(mid.next.name, 'Veteran');
  assert.ok(mid.progress > 0.45 && mid.progress < 0.55);
  assert.equal(TIERS[0].min, 0);
});
