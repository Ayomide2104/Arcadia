/* Arcadia notifications: bell badge + panel (popover on desktop, full screen
   on phones). Items are built with DOM APIs only. */
import { setAvatar } from './avatar.js';

const COPY = {
  friend_request: 'sent you a friend request',
  friend_accept: 'accepted your friend request',
  lfg_request: 'asked to join your invite',
  lfg_accept: 'accepted you into their invite',
  lfg_decline: 'couldn’t fit you into their invite',
  like: 'liked your post',
  repost: 'reposted your post',
  comment: 'commented on your post',
  reply: 'replied to your comment',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeAgo(value) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString();
}

export function createNotifications({ api, getUser, button, onNeedSignIn, onOpenPost, onOpenProfile, onOpenFriends, onOpenLfg }) {
  if (!button) return { refresh() {}, reset() {} };

  const state = { items: [], unread: 0, cursor: null, open: false, loading: false, timer: null };

  const badge = el('span', 'nt-badge');
  badge.hidden = true;
  button.classList.add('nt-bell');
  button.append(badge);

  const panel = el('section', 'nt-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notifications');
  panel.hidden = true;
  const head = el('header', 'nt-head');
  head.append(el('h2', '', 'Notifications'));
  const markAll = el('button', 'nt-link', 'Mark all as read');
  markAll.type = 'button';
  const close = el('button', 'nt-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close notifications');
  head.append(markAll, close);
  const list = el('div', 'nt-list');
  const more = el('button', 'nt-more', 'Show older');
  more.type = 'button';
  more.hidden = true;
  panel.append(head, list, more);
  document.body.append(panel);

  function setBadge() {
    const count = state.unread;
    badge.hidden = count < 1;
    badge.textContent = count > 99 ? '99+' : String(count);
    button.setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications');
    markAll.hidden = count < 1;
  }

  function render() {
    list.replaceChildren();
    if (!state.items.length) {
      const empty = el('div', 'nt-empty');
      empty.append(el('strong', '', state.loading ? 'Loading…' : 'You’re all caught up'));
      if (!state.loading) empty.append(el('p', '', 'Friend requests, likes, comments and replies will show up here.'));
      list.append(empty);
    }
    for (const item of state.items) {
      const row = el('button', `nt-item${item.read ? '' : ' is-unread'}`);
      row.type = 'button';
      const name = item.actor?.displayName || item.actor?.username || 'Someone';
      const avatar = el('span', 'nt-avatar');
      setAvatar(avatar, item.actor?.avatar, name[0].toUpperCase());
      const body = el('span', 'nt-body');
      const line = el('span', 'nt-line');
      line.append(el('strong', '', name), ` ${COPY[item.type] || 'sent you an update'}`);
      body.append(line);
      if (item.snippet) body.append(el('span', 'nt-snippet', item.snippet));
      const meta = el('span', 'nt-meta', timeAgo(item.createdAt));
      row.append(avatar, body, meta);
      row.addEventListener('click', () => openItem(item));
      list.append(row);
    }
    more.hidden = !state.cursor;
    setBadge();
  }

  async function load(reset = true) {
    if (!getUser() || state.loading) return;
    state.loading = true;
    if (reset) { state.items = []; state.cursor = null; render(); }
    try {
      const data = await api(`/notifications?limit=20${!reset && state.cursor ? `&cursor=${encodeURIComponent(state.cursor)}` : ''}`);
      state.items = reset ? data.items : [...state.items, ...data.items];
      state.cursor = data.nextCursor || null;
      state.unread = data.unread ?? state.unread;
    } catch {
      // keep the panel usable even if the request failed
    } finally {
      state.loading = false;
      render();
    }
  }

  async function refreshCount() {
    if (!getUser()) { state.unread = 0; setBadge(); return; }
    try {
      const data = await api('/notifications/unread-count');
      state.unread = data.unread || 0;
      setBadge();
    } catch {
      // ignore: the badge simply stays as it was
    }
  }

  async function openItem(item) {
    closePanel();
    if (!item.read) {
      item.read = true;
      state.unread = Math.max(0, state.unread - 1);
      setBadge();
      api(`/notifications/${item.id}/read`, { method: 'POST' }).catch(() => {});
    }
    if (item.type === 'friend_request') onOpenFriends();
    else if (item.type === 'friend_accept') onOpenProfile(item.actor?.username);
    else if (String(item.type).startsWith('lfg_')) onOpenLfg?.(item);
    else if (item.postId) onOpenPost(item.postId);
  }

  function place() {
    if (window.matchMedia('(max-width: 700px)').matches) return;
    const rect = button.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.bottom + 10)}px`;
    panel.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right - 8))}px`;
  }

  function openPanel() {
    if (!getUser()) { onNeedSignIn(); return; }
    state.open = true;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    document.documentElement.classList.add('nt-lock');
    load(true);
    close.focus({ preventScroll: true });
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('nt-lock');
  }

  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', (event) => { event.stopPropagation(); state.open ? closePanel() : openPanel(); });
  close.addEventListener('click', () => { closePanel(); button.focus(); });
  more.addEventListener('click', () => load(false));
  markAll.addEventListener('click', async () => {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      state.items.forEach((item) => { item.read = true; });
      state.unread = 0;
      render();
    } catch { /* leave as is */ }
  });
  document.addEventListener('click', (event) => {
    if (state.open && !panel.contains(event.target) && !button.contains(event.target)) closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) { closePanel(); button.focus(); }
  });
  window.addEventListener('resize', () => { if (state.open) place(); });
  window.addEventListener('focus', refreshCount);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCount(); });
  state.timer = setInterval(() => { if (document.visibilityState === 'visible') refreshCount(); }, 45000);

  return {
    refresh: refreshCount,
    reset() { state.items = []; state.unread = 0; state.cursor = null; closePanel(); setBadge(); },
  };
}
