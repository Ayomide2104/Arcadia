/* Following, followers and Arcadian points on profiles.

   - A Follow button and a stats row (Following, Followers, Arcadian points).
   - Followers/Following lists open in a sheet (only if the player allows it).
   - A page of its own for Arcadian points: total, level, breakdown, top posts and the rules. */

import { layerHost, swallowEscape } from './layers.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const BACK = '<svg class="back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const BOLT = '<svg class="so-bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>';

const fmt = (value) => {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};
const compact = (value) => {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return fmt(n);
};

export function createSocial({ api, toast, getUser, onNeedSignIn, setAvatar, openProfile, goPoints, mountPoints }) {
  let pointsTarget = null;

  function avatarFor(person, extra = '') {
    const name = person.displayName || person.username || '?';
    const node = el('span', `avatar so-avatar ${extra}`.trim(), name[0].toUpperCase());
    setAvatar?.(node, person.avatar, name[0].toUpperCase());
    return node;
  }

  /* ---------- Follow button ---------- */
  function followButton(person, { onChange, size = '' } = {}) {
    const button = el('button', `so-follow ${size}`.trim());
    button.type = 'button';
    let state = { following: Boolean(person.youFollow), followsYou: Boolean(person.followsYou) };

    const paint = () => {
      button.classList.toggle('is-following', state.following);
      button.textContent = state.following ? 'Following' : state.followsYou ? 'Follow back' : 'Follow';
      button.setAttribute('aria-pressed', String(state.following));
      button.setAttribute('aria-label', `${state.following ? 'Unfollow' : 'Follow'} ${person.displayName || person.username}`);
    };
    paint();
    button.addEventListener('mouseenter', () => { if (state.following) button.textContent = 'Unfollow'; });
    button.addEventListener('mouseleave', paint);
    button.addEventListener('click', async () => {
      if (!getUser()) { onNeedSignIn(); return; }
      const wasFollowing = state.following;
      button.disabled = true;
      try {
        const name = encodeURIComponent(person.username);
        const result = await api(`/follows/${name}`, { method: wasFollowing ? 'DELETE' : 'POST' });
        state = { ...state, following: !wasFollowing };
        paint();
        toast(wasFollowing ? `Unfollowed @${person.username}.` : `You’re following @${person.username}. You’ll see more of their posts.`);
        onChange?.(state, result);
      } catch (error) { toast(error.message || 'Could not do that.'); }
      finally { button.disabled = false; }
    });
    return button;
  }

  /* ---------- Profile: follow button + stats ---------- */
  async function renderProfileSocial(user, { followSlot, statsHost, isSelf }) {
    statsHost.replaceChildren();
    const stat = (value, label, onClick, extraClass = '') => {
      const button = el('button', `so-stat ${extraClass}`.trim());
      button.type = 'button';
      const number = el('strong', 'so-stat-num', value);
      button.append(number, el('span', 'so-stat-label', label));
      button.addEventListener('click', onClick);
      return { button, number };
    };

    let status = { followerCount: 0, followingCount: 0, listsVisible: true, following: false, followsYou: false };
    let points = null;
    const [statusResult, pointsResult] = await Promise.allSettled([
      api(`/follows/status/${encodeURIComponent(user.username)}`),
      api(`/points/${encodeURIComponent(user.username)}`),
    ]);
    if (statusResult.status === 'fulfilled') status = statusResult.value;
    if (pointsResult.status === 'fulfilled') points = pointsResult.value;

    const open = (kind) => () => {
      if (!status.listsVisible && !isSelf) { toast(`${user.displayName || user.username} keeps their ${kind} private.`); return; }
      openList(user, kind);
    };
    const following = stat(compact(status.followingCount), 'Following', open('following'));
    const followers = stat(compact(status.followerCount), status.followerCount === 1 ? 'Follower' : 'Followers', open('followers'));
    statsHost.append(following.button, followers.button);
    if (points) {
      const pts = stat(compact(points.total), 'Arcadian points', () => goPoints(user.username), 'so-stat--points');
      pts.button.prepend(Object.assign(el('span', 'so-bolt-wrap'), { innerHTML: BOLT }));
      pts.button.setAttribute('aria-label', `${fmt(points.total)} Arcadian points. Open the points page.`);
      statsHost.append(pts.button);
    }

    if (followSlot && !isSelf) {
      followSlot.replaceChildren(followButton({ ...user, youFollow: status.following, followsYou: status.followsYou }, {
        onChange: (state, result) => {
          status.followerCount = typeof result?.followerCount === 'number' ? result.followerCount : status.followerCount + (state.following ? 1 : -1);
          followers.number.textContent = compact(status.followerCount);
        },
      }));
    }
  }

  /* ---------- Followers / Following sheet ---------- */
  function openList(user, kind) {
    const overlay = el('div', 'so-overlay');
    const sheet = el('section', 'so-sheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', kind === 'followers' ? 'Followers' : 'Following');
    const close = () => { overlay.remove(); document.body.classList.remove('so-open'); };

    const head = el('div', 'so-sheet-head');
    const titleBox = el('div');
    titleBox.append(el('h2', '', kind === 'followers' ? 'Followers' : 'Following'), el('p', '', `@${user.username}`));
    const x = el('button', 'so-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', close);
    head.append(titleBox, x);

    const list = el('div', 'so-list');
    const more = el('button', 'so-more', 'Load more'); more.type = 'button'; more.hidden = true;
    sheet.append(head, list, more);
    overlay.append(sheet);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
    sheet.addEventListener('keydown', (event) => { if (swallowEscape(event)) close(); });
    layerHost().append(overlay); document.body.classList.add('so-open');
    x.focus();

    let cursor = null;
    async function load(reset) {
      if (reset) list.replaceChildren(el('p', 'so-note', 'Loading…'));
      more.disabled = true;
      try {
        const data = await api(`/follows/${encodeURIComponent(user.username)}/${kind}?limit=30${cursor ? `&cursor=${cursor}` : ''}`);
        if (reset) list.replaceChildren();
        if (reset && !data.items.length) {
          list.append(el('p', 'so-note', kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'));
        }
        for (const person of data.items) list.append(row(person));
        cursor = data.nextCursor;
        more.hidden = !cursor;
      } catch (error) {
        list.replaceChildren(el('p', 'so-note', error.message || 'Could not load this list.'));
        more.hidden = true;
      } finally { more.disabled = false; }
    }
    function row(person) {
      const item = el('div', 'so-row');
      const who = el('button', 'so-who'); who.type = 'button';
      const text = el('span', 'so-who-text');
      text.append(el('strong', '', person.displayName || person.username), el('span', '', `@${person.username}`));
      who.append(avatarFor(person), text);
      who.addEventListener('click', () => { close(); openProfile(person.username); });
      item.append(who);
      if (!person.isMe) item.append(followButton(person, { size: 'is-small' }));
      return item;
    }
    more.addEventListener('click', () => void load(false));
    void load(true);
  }

  /* ---------- Arcadian points page ---------- */
  function bar(progress) {
    const track = el('div', 'so-bar'); track.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'so-bar-fill'); fill.style.width = `${Math.round(progress * 100)}%`;
    track.append(fill);
    return track;
  }

  function breakdownRow(label, hint, entry, signed) {
    const row = el('div', 'so-brow');
    const left = el('div', 'so-brow-text');
    left.append(el('strong', '', label), el('span', '', hint));
    const pts = entry.points;
    const value = el('span', `so-brow-pts${pts < 0 ? ' is-negative' : ''}`, `${pts > 0 && signed ? '+' : ''}${fmt(pts)}`);
    const count = el('span', 'so-brow-count', `${fmt(entry.count)} ×`);
    row.append(left, count, value);
    return row;
  }

  async function renderPoints() {
    const host = mountPoints;
    host.replaceChildren();
    const username = pointsTarget || getUser()?.username;
    const page = el('div', 'so-page');
    host.append(page);

    const back = el('button', 'so-back'); back.type = 'button'; back.innerHTML = BACK; back.append(el('span', '', 'Profile'));
    back.addEventListener('click', () => openProfile(username));
    page.append(back);
    if (!username) { page.append(el('p', 'so-note', 'Sign in to see Arcadian points.')); return; }

    page.append(el('p', 'so-note', 'Loading…'));
    let data;
    try { data = await api(`/points/${encodeURIComponent(username)}`); }
    catch (error) { page.replaceChildren(back, el('p', 'so-note', error.message || 'Could not load points.')); return; }
    page.replaceChildren(back);

    const owner = data.isMe ? 'Your' : `${data.displayName || data.username}’s`;
    const heading = el('div', 'so-heading');
    heading.append(el('p', 'eyebrow', 'REPUTATION'), el('h1', '', `${owner} Arcadian points`), el('p', 'subheading', 'Earned when people like, comment on, share and repost what you post to the feed.'));
    page.append(heading);

    const hero = el('section', 'so-hero');
    const big = el('div', 'so-big');
    big.innerHTML = BOLT;
    big.append(el('strong', '', fmt(data.total)));
    const meta = el('div', 'so-hero-meta');
    meta.append(el('span', 'so-tier', data.tier.name), el('span', 'so-week', `${data.week >= 0 ? '+' : ''}${fmt(data.week)} this week`));
    const top = el('div', 'so-hero-top'); top.append(big, meta);
    hero.append(top, bar(data.tier.progress));
    hero.append(el('p', 'so-hero-note', data.tier.next ? `${fmt(data.tier.next.remaining)} more to reach ${data.tier.next.name}` : 'You’ve reached the highest level.'));
    page.append(hero);

    const b = data.breakdown;
    const card = el('section', 'so-card');
    card.append(el('h2', '', 'Where your points come from'));
    card.append(
      breakdownRow('Likes', '1 point each', b.likes, true),
      breakdownRow('Comments', '3 points each', b.comments, true),
      breakdownRow('Comment likes', 'A quarter point each', b.commentLikes || { count: 0, points: 0 }, true),
      breakdownRow('Shares', '2 points each', b.shares, true),
      breakdownRow('Reposts', 'Half a point each', b.reposts, true),
      breakdownRow('Community downvotes', 'Minus 1 each', b.downvotes, false),
    );
    page.append(card);

    const topCard = el('section', 'so-card');
    topCard.append(el('h2', '', 'Top posts'));
    if (!data.topPosts.length) topCard.append(el('p', 'so-note', 'Posts that earn points will show up here.'));
    for (const post of data.topPosts) {
      const item = el('div', 'so-top');
      item.append(el('p', '', post.text), el('strong', '', `+${fmt(post.points)}`));
      topCard.append(item);
    }
    page.append(topCard);

    const rules = el('section', 'so-card');
    rules.append(el('h2', '', 'How it works'));
    const list = el('ul', 'so-rules');
    for (const line of [
      'Likes, comments, shares and reposts on posts you share to the feed earn points. Likes on your comments under feed posts earn a quarter point.',
      'Upvotes and comments on community posts don’t add points, but community downvotes take 1 point away each.',
      'Your own likes, comments, shares and reposts never count.',
      'A person’s first 2 comments on a post count, so spamming a thread doesn’t help.',
      'Points update within about a minute and never drop below zero.',
    ]) list.append(el('li', '', line));
    rules.append(list);
    const tiers = el('div', 'so-tiers');
    for (const tier of data.tiers) {
      const chip = el('span', `so-tier-chip${tier.key === data.tier.key ? ' is-current' : ''}`, `${tier.name} · ${fmt(tier.min)}+`);
      tiers.append(chip);
    }
    rules.append(el('h3', '', 'Levels'), tiers);
    page.append(rules);
  }

  return {
    renderProfileSocial,
    followButton,
    openList,
    renderPoints,
    showPoints(username) { pointsTarget = username || getUser()?.username || null; goPoints(pointsTarget, true); },
    setPointsTarget(username) { pointsTarget = username; },
  };
}
