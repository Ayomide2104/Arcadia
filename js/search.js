/* Global search (top bar): players, games and communities.
   Talks to GET /api/search?q=..., shows grouped results under the input,
   supports arrow keys / Enter / Escape and works on mobile and desktop. */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const GROUPS = [
  { key: 'players', label: 'Players' },
  { key: 'games', label: 'Games' },
  { key: 'communities', label: 'Communities' },
];

export function createSearch({ api, setAvatar, gameInfo, onPlayer, onGame, onCommunity, onClose }) {
  const input = document.querySelector('#global-search');
  const panel = document.querySelector('#search-panel');
  if (!input || !panel) return { close() {} };

  let timer = null;
  let requestId = 0;
  let items = []; // flat list of { node, run }
  let active = -1;
  let lastQuery = '';

  function close() {
    panel.hidden = true;
    panel.replaceChildren();
    items = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function open() {
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function setActive(index) {
    items.forEach((item, i) => {
      item.node.classList.toggle('is-active', i === index);
      item.node.setAttribute('aria-selected', String(i === index));
    });
    active = index;
    if (index >= 0) {
      items[index].node.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', items[index].node.id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function choose(run) {
    close();
    input.value = '';
    input.blur();
    onClose?.();
    run();
  }

  function addItem(list, node, run) {
    node.id = `search-opt-${items.length}`;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', 'false');
    node.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus so click still lands
    node.addEventListener('click', () => choose(run));
    items.push({ node, run });
    list.append(node);
  }

  function playerRow(player) {
    const name = player.displayName || player.username;
    const row = el('button', 'sr-item');
    row.type = 'button';
    const avatar = el('span', 'avatar sr-avatar', name[0].toUpperCase());
    setAvatar?.(avatar, player.avatar, name[0].toUpperCase());
    const text = el('span', 'sr-text');
    text.append(el('strong', '', name), el('span', '', `@${player.username}`));
    row.append(avatar, text);
    return row;
  }

  function gameRow(game) {
    const info = gameInfo?.(game.name) || {};
    const row = el('button', 'sr-item');
    row.type = 'button';
    const tile = el('span', 'sr-tile', game.name[0].toUpperCase());
    const cover = info.cover ? `/assets/arcadia/games/${info.cover}` : `/assets/arcadia/games/${game.slug}.jpg`;
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('load', () => { tile.textContent = ''; tile.append(img); }, { once: true });
    img.src = cover;
    const text = el('span', 'sr-text');
    text.append(el('strong', '', game.name), el('span', '', (game.genres || []).join(' · ') || 'Game'));
    row.append(tile, text);
    return row;
  }

  function communityRow(community) {
    const row = el('button', 'sr-item');
    row.type = 'button';
    const badge = el('span', 'sr-badge', community.name[0].toUpperCase());
    if (/^#[0-9a-f]{6}$/i.test(community.accent || '')) badge.style.background = community.accent;
    const text = el('span', 'sr-text');
    const members = community.memberCount || 0;
    text.append(el('strong', '', community.name), el('span', '', `c/${community.slug} · ${members} ${members === 1 ? 'member' : 'members'}`));
    row.append(badge, text);
    return row;
  }

  function render(data, query) {
    panel.replaceChildren();
    items = [];
    active = -1;
    const total = GROUPS.reduce((sum, group) => sum + (data[group.key]?.length || 0), 0);
    open();
    if (!total) {
      const empty = el('div', 'sr-empty');
      empty.append(el('strong', '', 'No results'), el('span', '', `Nothing matched “${query}”. Try a username, game or community name.`));
      panel.append(empty);
      return;
    }
    const listbox = el('div', 'sr-list');
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', 'Search results');
    for (const group of GROUPS) {
      const rows = data[group.key] || [];
      if (!rows.length) continue;
      listbox.append(el('div', 'sr-heading', group.label));
      for (const entry of rows) {
        if (group.key === 'players') addItem(listbox, playerRow(entry), () => onPlayer(entry.username));
        else if (group.key === 'games') addItem(listbox, gameRow(entry), () => onGame(entry.slug));
        else addItem(listbox, communityRow(entry), () => onCommunity(entry.slug));
      }
    }
    panel.append(listbox);
    setActive(0);
  }

  function renderStatus(message) {
    panel.replaceChildren(el('div', 'sr-empty', message));
    items = [];
    active = -1;
    open();
  }

  async function run(query) {
    const mine = ++requestId;
    renderStatus('Searching…');
    try {
      const data = await api(`/search?q=${encodeURIComponent(query)}`);
      if (mine !== requestId) return;
      render(data, query);
    } catch (error) {
      if (mine !== requestId) return;
      renderStatus(error.message || 'Search is unavailable right now.');
    }
  }

  function schedule() {
    window.clearTimeout(timer);
    const query = input.value.trim();
    lastQuery = query;
    if (query.length < 2) {
      requestId += 1;
      if (query.length === 0) close();
      else renderStatus('Keep typing to search players, games and communities.');
      return;
    }
    timer = window.setTimeout(() => void run(query), 220);
  }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'search-panel');
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', schedule);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && panel.childElementCount) open(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); setActive((active + 1) % items.length); }
    else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); setActive((active - 1 + items.length) % items.length); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      const query = input.value.trim();
      if (items.length && query === lastQuery) choose(items[Math.max(active, 0)].run);
      else if (query.length >= 2) { window.clearTimeout(timer); void run(query); }
    } else if (event.key === 'Escape') {
      close();
    }
  });
  // The search field is a "search" input; the browser's own clear (x) fires this.
  input.addEventListener('search', schedule);

  document.addEventListener('pointerdown', (event) => {
    if (panel.hidden) return;
    if (event.target.closest('.topbar-search') || event.target.closest('#mobile-search-toggle')) return;
    close();
  });

  return { close };
}
