/* Arcadia Admin: separate control room (users, content, analytics, system).
   Plain JavaScript. Everything shown is built with DOM APIs (no innerHTML). */

const app = document.querySelector('#app');
let csrf = null;
let pollTimer = null;

/* ---------------------------- helpers ---------------------------- */

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function svg(tag, attrs, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['x-admin-csrf'] = csrf;
  const response = await fetch(`/api/admin${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  let payload = null;
  try { payload = await response.json(); } catch { /* not JSON */ }
  if (!response.ok || !payload?.success) {
    const error = new Error(payload?.error || 'Something went wrong.');
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

function toast(text) {
  document.querySelector('.toast')?.remove();
  const node = h('div', { class: 'toast', role: 'status', text });
  document.body.append(node);
  setTimeout(() => node.remove(), 4500);
}

const number = (value) => Number(value || 0).toLocaleString();
const dateText = (value) => (value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

function ago(value) {
  if (!value) return 'never seen';
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function avatar(person) {
  const letter = (person?.displayName || person?.username || '?')[0].toUpperCase();
  const node = h('div', { class: 'row__avatar', 'aria-hidden': 'true' }, letter);
  if (typeof person?.avatar === 'string' && person.avatar.startsWith('https://')) {
    const img = h('img', { alt: '', src: person.avatar, referrerpolicy: 'no-referrer' });
    img.addEventListener('load', () => { node.textContent = ''; node.append(img); }, { once: true });
  }
  return node;
}

/* ----------------------------- charts ----------------------------- */

function niceMax(value) {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / power) * power;
}

function chart({ type, labels, values, color = '#5a3fd6', title }) {
  const W = 600, H = 230, left = 38, right = 10, top = 12, bottom = 26;
  const max = niceMax(Math.max(...values, 1));
  const x = (index) => left + (labels.length === 1 ? 0 : (index / (labels.length - 1)) * (W - left - right));
  const y = (value) => top + (1 - value / max) * (H - top - bottom);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });

  for (const step of [0, 0.5, 1]) {
    const level = max * step;
    root.append(svg('line', { class: 'grid', x1: left, x2: W - right, y1: y(level), y2: y(level) }));
    const label = svg('text', { x: left - 6, y: y(level) + 4, 'text-anchor': 'end' });
    label.textContent = number(Math.round(level));
    root.append(label);
  }

  const ticks = [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
  for (const index of new Set(ticks)) {
    const label = svg('text', { x: x(index), y: H - 6, 'text-anchor': index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle' });
    label.textContent = labels[index].slice(5);
    root.append(label);
  }

  if (type === 'bar') {
    const slot = (W - left - right) / labels.length;
    values.forEach((value, index) => {
      const barHeight = Math.max(value ? 2 : 0, (value / max) * (H - top - bottom));
      const bar = svg('rect', { x: left + index * slot + slot * 0.15, y: H - bottom - barHeight, width: Math.max(2, slot * 0.7), height: barHeight, rx: 2, fill: color });
      bar.append(svg('title', {}, document.createTextNode(`${labels[index]}: ${number(value)}`)));
      root.append(bar);
    });
  } else {
    const points = values.map((value, index) => `${x(index)},${y(value)}`);
    root.append(svg('polygon', { points: `${x(0)},${y(0)} ${points.join(' ')} ${x(values.length - 1)},${y(0)}`, fill: color, 'fill-opacity': '0.12' }));
    root.append(svg('polyline', { points: points.join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    values.forEach((value, index) => {
      const dot = svg('circle', { cx: x(index), cy: y(value), r: values.length > 31 ? 2 : 3.5, fill: color });
      dot.append(svg('title', {}, document.createTextNode(`${labels[index]}: ${number(value)}`)));
      root.append(dot);
    });
  }
  return h('div', { class: 'chart' }, root);
}

/* ----------------------------- modal ------------------------------ */

function modal(build) {
  const dialog = h('dialog', { class: 'modal' });
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.append(h('div', { class: 'modal__body' }, build(close)));
  dialog.addEventListener('cancel', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

/* ----------------------------- login ------------------------------ */

function renderLogin(message = '') {
  clearInterval(pollTimer);
  const error = h('p', { class: 'error', role: 'alert' }, message);
  const username = h('input', { id: 'u', name: 'username', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: 'false' });
  const password = h('input', { id: 'p', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn btn--primary btn--wide', type: 'submit' }, 'Sign in');
  const form = h('form', { onSubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    try {
      const data = await api('/login', { method: 'POST', body: { username: username.value, password: password.value } });
      csrf = data.csrfToken;
      password.value = '';
      renderShell('overview');
    } catch (e) {
      error.textContent = e.message;
    } finally { submit.disabled = false; }
  } },
  h('label', { class: 'field', for: 'u' }, 'Admin username', username),
  h('label', { class: 'field', for: 'p' }, 'Password', password),
  error, submit);

  app.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'login__card' },
    h('div', { class: 'login__brand' }, h('img', { src: '/assets/arcadia/brand/logo-mark.svg', alt: '' }), 'Arcadia Admin'),
    h('h1', {}, 'Sign in'), h('p', {}, 'This area is for site administrators only.'), form)));
  username.focus();
}

function renderDisabled() {
  app.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'login__card' },
    h('h1', {}, 'Admin is not set up yet'),
    h('p', {}, 'Run npm.cmd run admin:hash on your computer, add ADMIN_USERNAME and ADMIN_PASSWORD_HASH to your .env file (and to Render’s Environment settings), then restart the server.'))));
}

/* ------------------------------ shell ----------------------------- */

const PAGES = [
  ['overview', 'Overview', '📊'],
  ['users', 'Users', '👥'],
  ['content', 'Content', '📝'],
  ['system', 'System', '🛠️'],
];

function renderShell(page) {
  clearInterval(pollTimer);
  const nav = PAGES.map(([id, label, icon]) => h('button', { class: 'nav', 'aria-current': id === page ? 'page' : null, onClick: () => renderShell(id) }, h('span', { 'aria-hidden': 'true' }, icon), label));
  const main = h('main', { class: 'main' });
  const side = h('nav', { class: 'side', 'aria-label': 'Admin sections' },
    h('div', { class: 'side__brand' }, h('img', { src: '/assets/arcadia/brand/logo-mark.svg', alt: '' }), h('div', {}, 'Arcadia', h('small', {}, 'Admin'))),
    ...nav,
    h('div', { class: 'side__foot' }, h('button', { class: 'nav', onClick: async () => { try { await api('/logout', { method: 'POST' }); } catch { /* already signed out */ } csrf = null; renderLogin(); } }, h('span', { 'aria-hidden': 'true' }, '🚪'), 'Sign out')));
  app.replaceChildren(h('div', { class: 'shell' }, side, main));
  ({ overview: pageOverview, users: pageUsers, content: pageContent, system: pageSystem })[page](main);
}

async function guard(promise, container) {
  try { return await promise; } catch (error) {
    if (error.status === 401) { renderLogin('Your session ended. Sign in again.'); return null; }
    container.append(h('p', { class: 'error', role: 'alert' }, error.message));
    return null;
  }
}

/* ---------------------------- overview ---------------------------- */

async function pageOverview(main) {
  let days = 30;
  const holder = h('div', {});
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time range' });
  const draw = async () => {
    seg.replaceChildren(...[7, 30, 90].map((n) => h('button', { type: 'button', 'aria-pressed': String(n === days), onClick: () => { days = n; draw(); } }, `${n} days`)));
    holder.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
    const data = await guard(api(`/analytics?days=${days}`), holder);
    if (!data) return;
    const k = data.kpis;
    const chipFor = (value) => value === null ? h('span', { class: 'chip chip--flat' }, 'new') : h('span', { class: `chip${value < 0 ? ' chip--down' : value === 0 ? ' chip--flat' : ''}` }, `${value > 0 ? '+' : ''}${value}%`);
    const kpi = (label, value, note, extra) => h('div', { class: 'kpi' }, h('div', { class: 'kpi__label' }, label), h('div', { class: 'kpi__value' }, value), h('div', { class: 'kpi__note' }, extra || '', extra ? ' ' : '', note));
    const online = h('div', { class: 'kpi__value', id: 'online-value' }, number(k.onlineNow));
    holder.replaceChildren(
      h('div', { class: 'kpis' },
        kpi('Total users', number(k.totalUsers), `${number(k.newToday)} joined today`),
        kpi('New in 7 days', number(k.new7), 'vs the 7 days before', chipFor(k.growth7)),
        kpi('New in 30 days', number(k.new30), 'vs the 30 days before', chipFor(k.growth30)),
        h('div', { class: 'kpi' }, h('div', { class: 'kpi__label' }, h('span', { class: 'live' }), 'Online now'), online, h('div', { class: 'kpi__note' }, 'connected right now')),
        kpi('Active today', number(k.dau), `${number(k.dauYesterday)} yesterday`),
        kpi('Active this week', number(k.wau), 'unique users, 7 days'),
        kpi('Active this month', number(k.mau), 'unique users, 30 days'),
        kpi('Stickiness', k.stickiness === null ? '—' : `${k.stickiness}%`, 'daily ÷ monthly active')),
      h('div', { class: 'charts' },
        h('section', { class: 'card' }, h('h2', {}, 'New registrations'), h('p', { class: 'sub' }, `People who created an account, per day (UTC), last ${days} days`), chart({ type: 'bar', labels: data.labels, values: data.registrations, title: 'New registrations per day' })),
        h('section', { class: 'card' }, h('h2', {}, 'Total users'), h('p', { class: 'sub' }, 'Growth of the whole community'), chart({ type: 'line', labels: data.labels, values: data.cumulativeUsers, color: '#1d7fd1', title: 'Total users over time' })),
        h('section', { class: 'card' }, h('h2', {}, 'Daily active users'), h('p', { class: 'sub' }, 'Unique people who used Arcadia each day'), chart({ type: 'line', labels: data.labels, values: data.dailyActive, color: '#1f9d46', title: 'Daily active users' })),
        h('section', { class: 'card' }, h('h2', {}, 'Posts per day'), h('p', { class: 'sub' }, 'New posts, including reposts'), chart({ type: 'bar', labels: data.labels, values: data.postsPerDay, color: '#e0852b', title: 'Posts per day' }))),
      data.activeDataSince ? h('p', { class: 'note' }, `Active-user charts start on ${data.activeDataSince}, the first day activity was recorded. Earlier days show 0. Registrations and posts use your full history.`) : h('p', { class: 'note' }, 'Active-user tracking has just started. Numbers will fill in as people use the site.'),
      h('p', { class: 'note' }, `Totals: ${number(data.totals.posts)} posts · ${number(data.totals.comments)} comments · ${number(data.totals.communities)} communities · ${number(data.totals.friendships)} friendships · ${number(data.totals.messages)} messages`));
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try { const live = await api('/online'); const node = document.querySelector('#online-value'); if (node) node.textContent = number(live.onlineNow); } catch { /* ignore */ }
    }, 30000);
  };
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Overview'), seg), holder);
  draw();
}

/* ------------------------------ users ----------------------------- */

function pageUsers(main) {
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search by username or name', 'aria-label': 'Search users', autocomplete: 'off' });
  const list = h('div', { class: 'list' });
  const more = h('button', { class: 'btn', type: 'button', hidden: true }, 'Load more');
  let cursor = null;
  let term = '';
  let token = 0;

  async function load(reset) {
    const mine = ++token;
    if (reset) { cursor = null; list.replaceChildren(h('p', { class: 'empty' }, 'Loading…')); }
    const data = await guard(api(`/users?limit=20${term ? `&q=${encodeURIComponent(term)}` : ''}${!reset && cursor ? `&cursor=${cursor}` : ''}`), list);
    if (!data || mine !== token) return;
    if (reset) list.replaceChildren();
    if (reset && !data.items.length) list.append(h('p', { class: 'empty' }, term ? `No users match “${term}”.` : 'No users yet.'));
    for (const user of data.items) list.append(userRow(user));
    cursor = data.nextCursor;
    more.hidden = !cursor;
  }

  function userRow(user) {
    const row = h('div', { class: 'row' }, avatar(user),
      h('div', { class: 'row__main' }, h('div', { class: 'row__name' }, user.displayName || user.username), h('div', { class: 'row__meta' }, `@${user.username} · joined ${dateText(user.createdAt)} · active ${ago(user.lastActiveAt)} · ${number(user.posts)} posts${user.onboardingComplete ? '' : ' · setup unfinished'}`)),
      h('button', { class: 'btn btn--small btn--danger', type: 'button', onClick: () => confirmDelete(user, row) }, 'Delete…'));
    return row;
  }

  async function confirmDelete(user, row) {
    let impact;
    try { impact = (await api(`/users/${user.id}/impact`)).impact; } catch (e) { if (e.status === 401) return renderLogin('Your session ended. Sign in again.'); toast(e.message); return; }
    modal((close) => {
      const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': `Type ${user.username} to confirm` });
      const error = h('p', { class: 'error', role: 'alert' });
      const go = h('button', { class: 'btn btn--danger', type: 'button', disabled: true }, 'Delete everything');
      input.addEventListener('input', () => { go.disabled = input.value.trim().toLowerCase() !== user.username; });
      go.addEventListener('click', async () => {
        go.disabled = true; go.textContent = 'Deleting…'; error.textContent = '';
        try {
          const result = await api(`/users/${user.id}`, { method: 'DELETE', body: { confirm: input.value } });
          close(); row.remove();
          toast(`Deleted @${user.username} and ${number(result.summary.ownPosts)} posts, ${number(result.summary.comments)} comments, ${number(result.summary.messages)} messages.`);
        } catch (e) { error.textContent = e.message; go.textContent = 'Delete everything'; go.disabled = false; }
      });
      return [
        h('h2', {}, `Delete @${user.username}?`),
        h('p', {}, 'This permanently removes the account and everything of theirs. It cannot be undone. Passwords are never visible here.'),
        h('ul', {}, h('li', {}, `${number(impact.posts)} posts (with their comments, likes and images)`), h('li', {}, `${number(impact.comments)} comments and ${number(impact.reactions)} likes they gave`), h('li', {}, `${number(impact.friends)} friendships and all friend requests`), h('li', {}, `${number(impact.messages)} private messages (the other person loses that conversation)`), h('li', {}, `${number(impact.communities)} community memberships${impact.ownedCommunities ? `, ${number(impact.ownedCommunities)} owned (handed to another member)` : ''}`), h('li', {}, 'their photo, banner and notifications')),
        h('label', { class: 'field' }, `Type ${user.username} to confirm`, input), error,
        h('div', { class: 'modal__actions' }, h('button', { class: 'btn', type: 'button', onClick: close }, 'Cancel'), go),
      ];
    });
  }

  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { term = search.value.trim(); load(true); }, 250); });
  more.addEventListener('click', () => load(false));
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Users')), h('div', { class: 'toolbar' }, search), list, h('div', { class: 'toolbar', style: 'margin-top:14px' }, more));
  load(true);
}

/* ----------------------------- content ---------------------------- */

function pageContent(main) {
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search posts or an author’s username', 'aria-label': 'Search posts', autocomplete: 'off' });
  const list = h('div', { class: 'list' });
  const more = h('button', { class: 'btn', type: 'button', hidden: true }, 'Load more');
  let cursor = null, term = '', token = 0;

  async function load(reset) {
    const mine = ++token;
    if (reset) { cursor = null; list.replaceChildren(h('p', { class: 'empty' }, 'Loading…')); }
    const data = await guard(api(`/posts?limit=20${term ? `&q=${encodeURIComponent(term)}` : ''}${!reset && cursor ? `&cursor=${cursor}` : ''}`), list);
    if (!data || mine !== token) return;
    if (reset) list.replaceChildren();
    if (reset && !data.items.length) list.append(h('p', { class: 'empty' }, 'No posts found.'));
    for (const post of data.items) list.append(postCard(post));
    cursor = data.nextCursor;
    more.hidden = !cursor;
  }

  function postCard(post) {
    const card = h('article', { class: 'post' },
      h('div', { class: 'post__head' }, avatar(post.author), h('div', { class: 'row__main' }, h('div', { class: 'row__name' }, post.author?.displayName || post.author?.username || 'Unknown'), h('div', { class: 'row__meta' }, `@${post.author?.username || 'unknown'} · ${new Date(post.createdAt).toLocaleString()}${post.type === 'repost' ? ' · repost' : ''}`)),
        h('button', { class: 'btn btn--small btn--danger', type: 'button', onClick: () => confirmPost(post, card) }, 'Delete…')),
      post.body ? h('p', { class: 'post__body' }, post.body) : null,
      post.images.length ? h('div', { class: 'post__images' }, post.images.map((src) => h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))) : null,
      h('div', { class: 'post__stats' }, `${number(post.likes)} likes · ${number(post.comments)} comments · ${number(post.reposts)} reposts`));
    return card;
  }

  function confirmPost(post, card) {
    modal((close) => {
      const error = h('p', { class: 'error', role: 'alert' });
      const go = h('button', { class: 'btn btn--danger', type: 'button' }, 'Delete post');
      go.addEventListener('click', async () => {
        go.disabled = true; go.textContent = 'Deleting…';
        try { await api(`/posts/${post.id}`, { method: 'DELETE' }); close(); card.remove(); toast('Post deleted.'); }
        catch (e) { error.textContent = e.message; go.disabled = false; go.textContent = 'Delete post'; }
      });
      return [h('h2', {}, 'Delete this post?'), h('p', {}, 'The post, its comments, likes, reposts and images are removed for good.'), error, h('div', { class: 'modal__actions' }, h('button', { class: 'btn', type: 'button', onClick: close }, 'Cancel'), go)];
    });
  }

  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { term = search.value.trim(); load(true); }, 250); });
  more.addEventListener('click', () => load(false));
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Content')), h('div', { class: 'toolbar' }, search), list, h('div', { class: 'toolbar', style: 'margin-top:14px' }, more));
  load(true);
}

/* ------------------------------ system ---------------------------- */

async function pageSystem(main) {
  const holder = h('div', {});
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'System')), holder);
  holder.append(h('p', { class: 'empty' }, 'Loading…'));
  const [system, audit] = await Promise.all([guard(api('/system'), holder), guard(api('/audit'), holder)]);
  if (!system || !audit) return;
  const hours = Math.floor(system.uptimeSeconds / 3600);
  const status = (label, ok, text) => h('div', { class: 'kpi' }, h('div', { class: 'kpi__label' }, label), h('div', { class: 'kpi__value' }, h('span', { class: `chip${ok ? '' : ' chip--down'}` }, text)));
  holder.replaceChildren(
    h('div', { class: 'status' },
      status('Database', system.database === 'connected', system.database),
      status('Image uploads', system.imageUploads, system.imageUploads ? 'configured' : 'not set up'),
      h('div', { class: 'kpi' }, h('div', { class: 'kpi__label' }, 'Online now'), h('div', { class: 'kpi__value' }, number(system.onlineNow))),
      h('div', { class: 'kpi' }, h('div', { class: 'kpi__label' }, 'Server running'), h('div', { class: 'kpi__value' }, hours >= 1 ? `${hours}h` : `${Math.floor(system.uptimeSeconds / 60)}m`), h('div', { class: 'kpi__note' }, `${system.environment} · Node ${system.node} · ${system.memoryMb} MB`))),
    h('section', { class: 'card' }, h('h2', {}, 'Admin activity'), h('p', { class: 'sub' }, 'Everything deleted from here is recorded.'),
      audit.items.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Action'), h('th', {}, 'Target'), h('th', {}, 'Removed'))),
        h('tbody', {}, audit.items.map((item) => h('tr', {}, h('td', {}, new Date(item.at).toLocaleString()), h('td', {}, item.action.replace('_', ' ')), h('td', {}, item.targetLabel), h('td', {}, Object.entries(item.summary || {}).filter(([, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${v} ${k}`).join(', ') || '—')))))) : h('p', { class: 'empty' }, 'Nothing yet.')));
}

/* ------------------------------ start ----------------------------- */

(async () => {
  try {
    const me = await api('/me');
    csrf = me.csrfToken;
    renderShell('overview');
  } catch (error) {
    if (error.status === 404) renderDisabled();
    else renderLogin();
  }
})();
