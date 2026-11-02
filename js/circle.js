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

  const scrollBy = (dir) => track.scrollBy({ left: dir * Math.max(240, track.clientWidth * 0.8), behavior: 'smooth' });
  left.addEventListener('click', () => scrollBy(-1));
  right.addEventListener('click', () => scrollBy(1));

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
      track.replaceChildren(...items.map(card));
      loadedAt = Date.now();
    } catch {
      if (mine === generation) section.hidden = true;
    }
  }

  function hide() { generation += 1; section.hidden = true; }

  return { show, hide };
}
