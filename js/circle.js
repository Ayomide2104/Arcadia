/* "Trending in your circle": a row of posts your friends and communities are reacting to. */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(paths, className) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  if (className) node.setAttribute('class', className);
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    node.append(p);
  }
  return node;
}

const FLAME = ['M12 3c.6 3.2-1.2 4.6-2.6 6.2C8 10.8 7 12.3 7 14.2A5 5 0 0 0 12 19a5 5 0 0 0 5-4.8c0-1.6-.7-2.9-1.7-4-.3 1.2-.9 2-1.8 2.4.5-2.6-.2-5.7-1.5-9.6z'];
const PEOPLE = ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19a5.5 5.5 0 0 1 11 0M16 6.3a3 3 0 0 1 0 5.4M17.5 14.2A5.5 5.5 0 0 1 20.5 19'];
const HEART = ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'];
const CHAT = ['M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'];

function age(value) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function createCircleStrip({ api, setAvatar, onOpen, onProfile }) {
  const anchor = document.querySelector('#feed-state');
  if (!anchor) return { show() {}, hide() {} };

  const section = el('section', 'circle');
  section.hidden = true;
  section.setAttribute('aria-label', 'Trending in your circle');
  const head = el('div', 'circle-head');
  const title = el('h2', 'circle-title');
  title.append(svg(FLAME, 'circle-flame'), document.createTextNode('Trending in your circle'));
  const arrows = el('div', 'circle-arrows');
  const left = el('button', 'circle-arrow'); left.type = 'button'; left.setAttribute('aria-label', 'Scroll left'); left.append(svg(['m15 5-7 7 7 7']));
  const right = el('button', 'circle-arrow'); right.type = 'button'; right.setAttribute('aria-label', 'Scroll right'); right.append(svg(['m9 5 7 7-7 7']));
  arrows.append(left, right);
  head.append(title, arrows);
  const track = el('div', 'circle-track');
  track.tabIndex = 0;
  section.append(head, track);
  anchor.before(section);

  /* Moving carousel: the row drifts left on its own, pauses on hover/touch/focus,
     loops forever, and the arrows (or swiping) still work. */
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let paused = false;
  let resumeTimer = null;
  let raf = 0;
  let lastTime = 0;
  let offset = 0; // fractional scroll position
  const SPEED = 28; // pixels per second

  const loopWidth = () => (track.scrollWidth - (Number.parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0)) / 2;

  function tick(time) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(64, time - (lastTime || time));
    lastTime = time;
    if (paused || section.hidden || document.hidden || !track.dataset.looping) return;
    const half = loopWidth();
    if (half <= track.clientWidth) return; // nothing to scroll
    // If the person scrolled by hand, continue from there.
    if (Math.abs(track.scrollLeft - offset) > 2) offset = track.scrollLeft;
    offset += (SPEED * dt) / 1000;
    if (offset >= half) offset -= half;
    track.scrollLeft = offset;
  }

  function pause() { paused = true; window.clearTimeout(resumeTimer); }
  function resume(delay = 1800) {
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => { offset = track.scrollLeft; paused = false; }, delay);
  }

  function startMotion() {
    cancelAnimationFrame(raf);
    lastTime = 0;
    offset = track.scrollLeft;
    if (reduceMotion?.matches) return;
    raf = requestAnimationFrame(tick);
  }

  track.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') pause(); });
  track.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') resume(300); });
  track.addEventListener('pointerdown', pause);
  track.addEventListener('pointerup', () => resume());
  track.addEventListener('pointercancel', () => resume());
  track.addEventListener('touchstart', pause, { passive: true });
  track.addEventListener('touchend', () => resume(), { passive: true });
  track.addEventListener('focusin', pause);
  track.addEventListener('focusout', () => resume(600));
  track.addEventListener('wheel', () => { pause(); resume(); }, { passive: true });

  const scrollBy = (dir) => {
    pause();
    const step = Math.max(240, track.clientWidth * 0.8);
    const half = loopWidth();
    let target = track.scrollLeft + dir * step;
    if (track.dataset.looping && half > 0) {
      if (target < 0) { track.scrollLeft += half; target += half; }
      else if (target > half + step) { track.scrollLeft -= half; target -= half; }
    }
    track.scrollTo({ left: target, behavior: 'smooth' });
    resume(2600);
  };
  left.addEventListener('click', () => scrollBy(-1));
  right.addEventListener('click', () => scrollBy(1));
  // Wrap seamlessly when the person drags past either end of the loop.
  track.addEventListener('scroll', () => {
    if (!track.dataset.looping) return;
    const half = loopWidth();
    if (half <= 0) return;
    if (track.scrollLeft >= half) { track.scrollLeft -= half; offset = track.scrollLeft; }
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { lastTime = 0; });

  let generation = 0;
  let loadedAt = 0;

  function skeleton() {
    track.replaceChildren();
    for (let i = 0; i < 3; i += 1) track.append(el('div', 'circle-card circle-card--skeleton'));
  }

  function card(post) {
    const node = el('article', 'circle-card');
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    const authorName = post.author?.displayName || post.author?.username || 'Player';
    node.setAttribute('aria-label', `${authorName}: ${post.circle?.line || 'Trending post'}. Open post.`);

    const top = el('div', 'circle-top');
    const avatar = el('span', 'avatar circle-avatar', authorName[0].toUpperCase());
    setAvatar?.(avatar, post.author?.avatar, authorName[0].toUpperCase());
    const who = el('div', 'circle-who');
    who.append(el('strong', '', authorName), el('span', '', `@${post.author?.username || 'player'} · ${age(post.createdAt)}`));
    top.append(avatar, who);

    const image = (post.media || []).find((m) => m?.type === 'image' && /^https:\/\//i.test(m.url || ''));
    const body = el('div', 'circle-body');
    const text = (post.body || '').trim();
    body.append(el('p', 'circle-text', text || (image ? 'Shared a photo' : '')));
    if (image) {
      const thumb = el('img', 'circle-thumb');
      thumb.src = image.url; thumb.alt = ''; thumb.loading = 'lazy'; thumb.decoding = 'async';
      body.append(thumb);
      body.classList.add('has-thumb');
    }

    const reason = el('p', `circle-reason circle-reason--${post.circle?.kind || 'popular'}`);
    reason.append(svg(post.circle?.kind === 'popular' ? FLAME : PEOPLE), document.createTextNode(post.circle?.line || 'Popular right now'));

    const foot = el('div', 'circle-foot');
    const likes = el('span', '', String(post.likeCount || 0)); likes.prepend(svg(HEART));
    const comments = el('span', '', String(post.commentCount || 0)); comments.prepend(svg(CHAT));
    foot.append(likes, comments);

    node.append(top, body, reason, foot);
    const open = () => onOpen?.(post, node);
    node.addEventListener('click', open);
    node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    return node;
  }

  async function show(filter) {
    if (filter !== 'for-you') { hide(); return; }
    const mine = ++generation;
    section.hidden = false;
    if (Date.now() - loadedAt > 60000 || !track.children.length) skeleton();
    try {
      const data = await api('/posts/trending?limit=8');
      if (mine !== generation) return;
      const items = data.items || [];
      if (!items.length) { section.hidden = true; return; }
      const cards = items.map(card);
      track.replaceChildren(...cards);
      track.scrollLeft = 0;
      delete track.dataset.looping;
      // Enough cards to fill the row? Add a second copy so the loop has no gap.
      window.requestAnimationFrame(() => {
        if (mine !== generation) return;
        if (track.scrollWidth > track.clientWidth + 40 && cards.length > 2) {
          const copies = items.map((post) => { const clone = card(post); clone.setAttribute('aria-hidden', 'true'); clone.tabIndex = -1; return clone; });
          track.append(...copies);
          track.dataset.looping = 'true';
        }
        startMotion();
      });
      loadedAt = Date.now();
    } catch {
      if (mine === generation) section.hidden = true;
    }
  }

  function hide() { generation += 1; section.hidden = true; cancelAnimationFrame(raf); }

  return { show, hide };
}
