/* Pure rules for Arcadian points (no database), so they are easy to test. */

const WEIGHTS = { like: 1, comment: 3, share: 2, repost: 0.5, downvote: -1, commentLike: 0.25 };
const COMMENT_CAP_PER_PERSON = 2;

const TIERS = [
  { key: 'rookie', name: 'Rookie', min: 0 },
  { key: 'challenger', name: 'Challenger', min: 25 },
  { key: 'veteran', name: 'Veteran', min: 150 },
  { key: 'elite', name: 'Elite', min: 600 },
  { key: 'legend', name: 'Legend', min: 2500 },
];

function tierFor(points) {
  let index = 0;
  TIERS.forEach((tier, i) => { if (points >= tier.min) index = i; });
  const current = TIERS[index];
  const next = TIERS[index + 1] || null;
  return {
    key: current.key,
    name: current.name,
    next: next ? { name: next.name, at: next.min, remaining: Math.max(0, Math.ceil(next.min - points)) } : null,
    progress: next ? Math.min(1, (points - current.min) / (next.min - current.min)) : 1,
  };
}

const pointsOf = (counts) => (
  counts.likes * WEIGHTS.like + counts.comments * WEIGHTS.comment + counts.shares * WEIGHTS.share +
  counts.reposts * WEIGHTS.repost + counts.downvotes * WEIGHTS.downvote + (counts.commentLikes || 0) * WEIGHTS.commentLike
);

module.exports = { WEIGHTS, COMMENT_CAP_PER_PERSON, TIERS, tierFor, pointsOf };
