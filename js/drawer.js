/* Left menu drawer (three-bar button, top left).
   One place for every section of Arcadia, so the top bar stays clean and
   Communities, Find players and the rest are one tap away on mobile. */

const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z"/>',
  games: '<path d="M7 8h10a4 4 0 0 1 3.8 5.2l-1 3.2a2.3 2.3 0 0 1-3.8 1l-2-2H10l-2 2a2.3 2.3 0 0 1-3.8-1l-1-3.2A4 4 0 0 1 7 8Z"/><path d="M8 11v4m-2-2h4"/>',
  communities: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0m1-4a4.5 4.5 0 0 1 5 4"/>',
  players: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M22 11h-6"/>',
  updates: '<path d="M4 5h13v13a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5"/>',
  friends: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 0 0-8m4 17v-1.5a4 4 0 0 0-3-3.9"/>',
  chat: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.8-3.1A7.5 7.5 0 1 1 20 11.5Z"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  invites: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="m4 8 8 5 8-5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('dr-icon');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * actions: { go(view), openInvites(), openNotifications(), openSettings(), compose(), signIn(), signOut(), toggleTheme(), isDark(), setAvatar(node, url, initial) }
 */
export function createDrawer({ toggle, getUser, actions, getView }) {
  let overlay = null;
  let drawer = null;
  let lastFocus = null;

  const SECTIONS = [
    { title: 'Explore', items: [
      { id: 'feed', label: 'Home', icon: 'home', run: () => actions.go('feed') },
      { id: 'groups', label: 'Communities', icon: 'communities', run: () => actions.go('groups') },
      { id: 'games', label: 'Games', icon: 'games', run: () => actions.go('games') },
      { id: 'lfg', label: 'Find players', icon: 'players', run: () => actions.go('lfg') },
      { id: 'updates', label: 'Game updates', icon: 'updates', run: () => actions.go('updates') },
    ] },
    { title: 'You', needsUser: true, items: [
      { id: 'friends', label: 'Friends', icon: 'friends', run: () => actions.go('friends') },
      { id: 'inbox', label: 'Messages', icon: 'chat', run: () => actions.go('inbox') },
      { id: 'notifications', label: 'Notifications', icon: 'bell', run: () => actions.openNotifications() },
      { id: 'invites', label: 'My invites', icon: 'invites', run: () => actions.openInvites() },
      { id: 'profile', label: 'Profile', icon: 'profile', run: () => actions.go('profile') },
      { id: 'settings', label: 'Settings', icon: 'settings', run: () => actions.openSettings() },
    ] },
  ];

  function close(restoreFocus = true) {
    if (!drawer) return;
    drawer.classList.remove('is-open');
    overlay.classList.remove('is-open');
    document.documentElement.classList.remove('dr-lock');
    toggle.setAttribute('aria-expanded', 'false');
    const old = [overlay, drawer];
    overlay = drawer = null;
    window.setTimeout(() => old.forEach((node) => node.remove()), 220);
    document.removeEventListener('keydown', onKey);
    if (restoreFocus) (lastFocus || toggle).focus?.({ preventScroll: true });
  }

  function choose(run) {
    close(false);
    run();
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab' || !drawer) return;
    const focusable = [...drawer.querySelectorAll('button:not([disabled]), a[href]')];
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function row(item, current) {
    const button = el('button', `dr-item${item.id === current ? ' is-current' : ''}`);
    button.type = 'button';
    if (item.id === current) button.setAttribute('aria-current', 'page');
    button.append(icon(item.icon), el('span', 'dr-label', item.label));
    button.addEventListener('click', () => choose(item.run));
    return button;
  }

  function open() {
    if (drawer) { close(); return; }
    lastFocus = document.activeElement;
    const user = getUser();
    const current = getView?.() || 'feed';

    overlay = el('div', 'dr-overlay');
    overlay.addEventListener('click', () => close());
    drawer = el('aside', 'dr-panel');
    drawer.id = 'app-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Menu');

    const head = el('div', 'dr-head');
    const closeButton = el('button', 'dr-close'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close menu');
    closeButton.append(icon('close'));
    closeButton.addEventListener('click', () => close());

    const me = el('button', 'dr-me'); me.type = 'button';
    const avatar = el('span', 'avatar dr-avatar', user ? (user.displayName || user.username || '?')[0].toUpperCase() : '?');
    if (user) actions.setAvatar?.(avatar, user.avatar, avatar.textContent);
    const who = el('span', 'dr-who');
    if (user) who.append(el('strong', '', user.displayName || user.username), el('span', '', `@${user.username}`));
    else who.append(el('strong', '', 'Welcome to Arcadia'), el('span', '', 'Sign in to join in'));
    me.append(avatar, who);
    me.addEventListener('click', () => choose(user ? () => actions.go('profile') : actions.signIn));
    head.append(me, closeButton);

    const body = el('nav', 'dr-body'); body.setAttribute('aria-label', 'Sections');
    if (user) {
      const post = el('button', 'dr-compose', 'New post'); post.type = 'button';
      post.prepend(icon('plus'));
      post.addEventListener('click', () => choose(actions.compose));
      body.append(post);
    }
    for (const section of SECTIONS) {
      if (section.needsUser && !user) continue;
      const group = el('div', 'dr-group');
      group.append(el('p', 'dr-title', section.title));
      for (const item of section.items) group.append(row(item, current));
      body.append(group);
    }

    const foot = el('div', 'dr-foot');
    const theme = el('button', 'dr-item dr-theme'); theme.type = 'button';
    const dark = actions.isDark();
    theme.setAttribute('role', 'switch'); theme.setAttribute('aria-checked', String(dark));
    const track = el('span', 'dr-switch'); track.append(el('span', 'dr-knob'));
    theme.append(icon('moon'), el('span', 'dr-label', 'Dark mode'), track);
    theme.addEventListener('click', () => {
      actions.toggleTheme();
      const now = actions.isDark();
      theme.setAttribute('aria-checked', String(now));
    });
    foot.append(theme);
    const auth = el('button', 'dr-item'); auth.type = 'button';
    auth.append(icon(user ? 'out' : 'profile'), el('span', 'dr-label', user ? 'Sign out' : 'Sign in'));
    auth.addEventListener('click', () => choose(user ? actions.signOut : actions.signIn));
    foot.append(auth);

    drawer.append(head, body, foot);
    document.body.append(overlay, drawer);
    document.documentElement.classList.add('dr-lock');
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      overlay.classList.add('is-open'); drawer.classList.add('is-open');
      (drawer.querySelector('.dr-item.is-current') || drawer.querySelector('.dr-item, .dr-me'))?.focus({ preventScroll: true });
    });
  }

  toggle.addEventListener('click', open);
  return { open, close };
}
