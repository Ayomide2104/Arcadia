/* Arcadia share sheet.
   - "Send to a friend": pick friends (with their online dot) and DM them the post.
   - Quick targets: Copy link, WhatsApp, Telegram, X, Facebook, Email, and the phone's own share menu.
   Usage: const share = createShare({ api, getUser, toast }); share.open({ url, title, text, author }); */
import { setAvatar } from './avatar.js';
import { presence } from './presence.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Static, trusted SVG markup only (never built from user text).
const icon = (paths, className = 'sh-icon') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.innerHTML = paths;
  return svg;
};

const PATHS = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  whatsapp: '<path d="M4 20l1.2-4A8 8 0 1 1 8 18.8L4 20z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.2-1.2-1.8-1-.8.6c-.7-.3-1.4-1-1.7-1.7l.6-.8-1-1.8L9 9.5z"/>',
  telegram: '<path d="M21 4 3 11l5.5 2L10 19l3-3.5 4.5 3.3L21 4z"/><path d="m8.5 13 8-5.5"/>',
  x: '<path d="M5 4l14 16M19 4 5 20"/>',
  facebook: '<path d="M14 21v-8h2.8l.5-3.2H14V7.8c0-.9.4-1.6 1.7-1.6h1.7V3.4C17 3.3 16.1 3.2 15.2 3.2 12.8 3.2 11 4.6 11 7.3v2.5H8.2V13H11v8h3z"/>',
};

const TARGETS = [
  { id: 'whatsapp', label: 'WhatsApp', color: '#25d366', href: (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t ? `${t} ` : ''}${u}`)}` },
  { id: 'telegram', label: 'Telegram', color: '#2aabee', href: (u, t) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t || '')}` },
  { id: 'x', label: 'X', color: '#14171f', href: (u, t) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t || '')}` },
  { id: 'facebook', label: 'Facebook', color: '#1877f2', href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
  { id: 'mail', label: 'Email', color: '#6b7280', href: (u, t) => `mailto:?subject=${encodeURIComponent(t || 'Check this out on Arcadia')}&body=${encodeURIComponent(u)}` },
];

/** The link a post is shared by. Opens the post's discussion for whoever clicks it. */
export function postLink(postId) {
  return `${location.origin}${location.pathname}#post/${postId}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function createShare({ api, getUser, toast }) {
  let dialog = null;
  let parts = null;
  let current = null;
  let selected = new Set();
  let generation = 0;

  function build() {
    dialog = el('dialog', 'share-dialog');
    dialog.setAttribute('aria-label', 'Share');
    const sheet = el('div', 'share-sheet');

    const grip = el('div', 'share-grip');
    grip.append(el('span'));

    const head = el('div', 'share-head');
    head.append(el('h2', '', 'Share'));
    const close = el('button', 'share-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.append(icon(PATHS.close));
    close.addEventListener('click', () => dialog.close());
    head.append(close);

    const preview = el('div', 'share-preview');

    // Friends
    const friends = el('section', 'share-section');
    friends.append(el('h3', 'share-label', 'Send to a friend'));
    const friendRow = el('div', 'share-friends');
    friends.append(friendRow);
    const note = el('input', 'share-note');
    note.type = 'text';
    note.maxLength = 300;
    note.placeholder = 'Add a message (optional)';
    note.setAttribute('aria-label', 'Add a message');
    note.hidden = true;
    const send = el('button', 'share-send');
    send.type = 'button';
    send.hidden = true;
    const sendRow = el('div', 'share-send-row');
    sendRow.append(note, send);
    friends.append(sendRow);

    // Apps
    const apps = el('section', 'share-section');
    apps.append(el('h3', 'share-label', 'Share to'));
    const appRow = el('div', 'share-apps');
    apps.append(appRow);

    // Link
    const linkBox = el('div', 'share-link');
    const linkText = el('span', 'share-link-text');
    const copy = el('button', 'share-copy');
    copy.type = 'button';
    linkBox.append(linkText, copy);

    sheet.append(grip, head, preview, friends, apps, linkBox);
    dialog.append(sheet);
    document.body.append(dialog);

    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { generation += 1; });

    copy.addEventListener('click', async () => {
      const ok = await copyText(current.url);
      setCopied(copy, ok);
      toast(ok ? 'Link copied.' : 'Could not copy the link.');
    });

    send.addEventListener('click', () => void sendToFriends());
    note.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void sendToFriends(); } });

    parts = { preview, friends, friendRow, note, send, appRow, linkText, copy };
  }

  function setCopied(button, ok) {
    button.replaceChildren(icon(ok ? PATHS.check : PATHS.link), document.createTextNode(ok ? 'Copied' : 'Copy'));
    button.classList.toggle('is-done', ok);
    if (ok) window.setTimeout(() => setCopied(button, null), 1800);
    if (ok === null) button.classList.remove('is-done');
  }

  function appTile({ label, color, paths, onClick, href }) {
    const node = el(href ? 'a' : 'button', 'share-app');
    if (href) { node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    else node.type = 'button';
    const disc = el('span', 'share-app-icon');
    disc.style.setProperty('--sh-color', color);
    disc.append(icon(paths));
    node.append(disc, el('span', 'share-app-label', label));
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function renderApps() {
    const { appRow } = parts;
    appRow.replaceChildren();
    const { url, title } = current;
    const shareText = title || '';

    appRow.append(appTile({
      label: 'Copy link', color: '#5a3fd6', paths: PATHS.link,
      onClick: async () => { const ok = await copyText(url); toast(ok ? 'Link copied.' : 'Could not copy the link.'); if (ok) dialog.close(); },
    }));
    for (const target of TARGETS) {
      appRow.append(appTile({ label: target.label, color: target.color, paths: PATHS[target.id], href: target.href(url, shareText) }));
    }
    if (typeof navigator.share === 'function') {
      appRow.append(appTile({
        label: 'More', color: '#8b90a0', paths: PATHS.more,
        onClick: async () => {
          try { await navigator.share({ title: title || 'Arcadia', text: shareText, url }); dialog.close(); }
          catch { /* the person closed the system sheet */ }
        },
      }));
    }
  }

  function updateSend() {
    const { send, note } = parts;
    const count = selected.size;
    send.hidden = count === 0;
    note.hidden = count === 0;
    send.textContent = count === 1 ? 'Send' : `Send to ${count}`;
  }

  function friendChip(person) {
    const name = person.displayName || person.username;
    const chip = el('button', 'share-friend');
    chip.type = 'button';
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute('aria-label', `Send to ${name}`);
    const avatar = el('span', 'share-friend-avatar', name[0].toUpperCase());
    setAvatar(avatar, person.avatar, name[0].toUpperCase());
    presence.mark(avatar, person.username);
    const tick = el('span', 'share-friend-tick');
    tick.append(icon(PATHS.check));
    avatar.append(tick);
    chip.append(avatar, el('span', 'share-friend-name', name.split(/\s+/)[0]));
    chip.addEventListener('click', () => {
      const on = !selected.has(person.username);
      if (on) selected.add(person.username); else selected.delete(person.username);
      chip.setAttribute('aria-pressed', String(on));
      updateSend();
    });
    return chip;
  }

  async function renderFriends() {
    const { friends, friendRow } = parts;
    const mine = generation;
    friendRow.replaceChildren();
    if (!getUser()) { friends.hidden = true; return; }
    friends.hidden = false;
    const loading = el('p', 'share-hint', 'Loading friends…');
    friendRow.append(loading);
    try {
      const data = await api('/friends/list');
      if (mine !== generation) return;
      const items = data.items || [];
      friendRow.replaceChildren();
      if (!items.length) {
        friendRow.append(el('p', 'share-hint', 'Add friends to send posts straight to their chat.'));
        return;
      }
      for (const person of items) friendRow.append(friendChip(person));
    } catch {
      if (mine !== generation) return;
      friendRow.replaceChildren(el('p', 'share-hint', 'Could not load your friends.'));
    }
  }

  async function sendToFriends() {
    const { send, note } = parts;
    if (!selected.size || send.disabled) return;
    const names = [...selected];
    const message = note.value.trim();
    const content = [message, current.url].filter(Boolean).join('\n');
    send.disabled = true;
    send.textContent = 'Sending…';
    const results = await Promise.allSettled(names.map((username) => api(`/messages/${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ content }) })));
    const sent = results.filter((result) => result.status === 'fulfilled').length;
    send.disabled = false;
    if (sent === names.length) {
      toast(sent === 1 ? `Sent to @${names[0]}.` : `Sent to ${sent} friends.`);
      dialog.close();
    } else {
      toast(sent ? `Sent to ${sent} of ${names.length}. Try the rest again.` : 'Could not send. Try again.');
      updateSend();
    }
  }

  function open({ url, title = '', text = '', author = '' }) {
    if (!dialog) build();
    current = { url, title: title || text };
    selected = new Set();
    generation += 1;

    const { preview, linkText, copy, note } = parts;
    preview.replaceChildren();
    const snippet = (title || text || '').trim();
    if (author) preview.append(el('strong', 'share-preview-author', author));
    if (snippet) preview.append(el('p', 'share-preview-text', snippet.length > 140 ? `${snippet.slice(0, 137)}…` : snippet));
    preview.hidden = !author && !snippet;

    linkText.textContent = url.replace(/^https?:\/\//, '');
    setCopied(copy, null);
    note.value = '';
    updateSend();
    renderApps();
    void renderFriends();

    if (!dialog.open) dialog.showModal();
  }

  return { open };
}
