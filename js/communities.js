/*
  Arcadia Communities.
    - Explore: ranked, searchable list in the style of a subreddit directory,
      with suggestions based on the games and genres you picked.
    - Community page: banner, posts with votes (Hot / New / Top), sidebar with
      about, rules, moderators and related games.
    - Post page: the post with threaded comments.
    - Chat: channels, live messages, replies, reactions and squad calls.
    - Create a community around games and/or genres.
    - A "Communities" section for profiles.
*/
import { io } from 'socket.io-client';
import { setAvatar } from './avatar.js';

const GENRES = [
  { id: 'sports', label: 'Sports & football' },
  { id: 'fps', label: 'FPS & tactical' },
  { id: 'rpg', label: 'RPG' },
  { id: 'battle-royale', label: 'Battle royale' },
  { id: 'racing', label: 'Racing' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'fighting', label: 'Fighting' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'party', label: 'Casual & party' }
];
const GENRE_LABEL = Object.fromEntries(GENRES.map((genre) => [genre.id, genre.label]));
const REACTIONS = ['👍', '🔥', '😂', '🎮', '😮', '❤️'];
const ROLE_LABEL = { owner: 'Owner', moderator: 'Mod', member: 'Member' };

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const formatCount = (value = 0) => {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
};

const plural = (count, one, many = `${one}s`) => `${formatCount(count)} ${count === 1 ? one : many}`;

function timeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

const initials = (name) => String(name).split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase();

const ARROW_UP = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createCommunities({ api, getUser, toast, openAuth, gameInfo, navigate, openGame }) {
  const state = {
    route: { name: 'explore' },
    joined: null, // Map slug -> role, null until loaded
    joinedFor: '',
    catalogue: null, // games from /games
    exploreTab: 'discover',
    gameFilter: '',
    genre: 'all',
    sort: 'popular',
    term: ''
  };
  let root = null;
  let chat = null; // live chat session, see Part C
  let renderToken = 0;

  /* ---------- Small shared helpers ---------- */

  function mount() {
    const view = document.querySelector('#view-groups');
    if (!view) return null;
    if (!root || !root.isConnected) {
      root = el('div', 'cm');
      view.append(root);
    }
    return root;
  }

  function gameName(slug) {
    const info = gameInfo(slug);
    return info.cover || info.banner ? info.title : slug.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  }

  function focusSlugs(community) {
    return [...new Set([...(community.games || []), community.game].filter(Boolean))];
  }

  function communityIcon(community, size = 'md') {
    const node = el('span', `cm-icon cm-icon--${size}`);
    node.style.setProperty('--cm-accent', community.accent || '#68d6bd');
    const first = focusSlugs(community)[0];
    const info = first ? gameInfo(first) : null;
    if (info?.cover) {
      const image = el('img', 'cm-icon-img');
      image.src = `/assets/arcadia/games/${info.cover}`;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.remove(); node.textContent = initials(community.name); });
      node.append(image);
    } else {
      node.textContent = initials(community.name);
    }
    return node;
  }

  function personAvatar(person, className = 'cm-avatar') {
    const node = el('span', className);
    const name = person?.displayName || person?.username || '?';
    setAvatar(node, person?.avatar, name.slice(0, 1).toUpperCase());
    return node;
  }

  function tagList(community, limit = 3) {
    const wrap = el('span', 'cm-tags');
    const tags = [
      ...focusSlugs(community).map((slug) => gameName(slug)),
      ...(community.genres || []).map((id) => GENRE_LABEL[id] || id)
    ].slice(0, limit);
    for (const tag of tags) wrap.append(el('span', 'cm-tag', tag));
    return wrap;
  }

  async function loadJoined(force = false) {
    const me = getUser();
    const who = me ? String(me._id || me.id || me.username) : '';
    if (!me) { state.joined = new Map(); state.joinedFor = ''; return state.joined; }
    if (state.joined && !force && state.joinedFor === who) return state.joined;
    try {
      const data = await api('/communities/mine');
      state.joined = new Map((data.items || []).map((item) => [item.slug, item.role]));
      state.joinedFor = who;
    } catch {
      state.joined = state.joined || new Map();
    }
    return state.joined;
  }

  const roleIn = (slug) => state.joined?.get(slug) || null;

  const officialBadge = () => { const badge = el('span', 'cm-official', 'Official'); badge.title = 'Run by Arcadia'; return badge; };

  function titleWithBadge(className, community) {
    const node = el('span', className);
    node.append(document.createTextNode(community.name));
    if (community.official) node.append(officialBadge());
    return node;
  }

  /* ---------- Join / leave button ---------- */

  function joinButton(community, { onChange, className = 'cm-btn cm-btn--solid' } = {}) {
    const button = el('button', className);
    button.type = 'button';
    const paint = () => {
      const role = roleIn(community.slug);
      button.classList.toggle('is-joined', Boolean(role));
      if (role === 'owner') { button.textContent = 'Owner'; button.disabled = true; button.title = 'Owners cannot leave without transferring ownership.'; return; }
      button.disabled = false;
      button.removeAttribute('title');
      button.textContent = role ? 'Joined' : 'Join';
      button.setAttribute('aria-pressed', String(Boolean(role)));
    };
    paint();
    button.addEventListener('mouseenter', () => { if (roleIn(community.slug) && roleIn(community.slug) !== 'owner') button.textContent = 'Leave'; });
    button.addEventListener('mouseleave', paint);
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!getUser()) { openAuth({ type: 'join-community', slug: community.slug }); return; }
      const role = roleIn(community.slug);
      button.disabled = true;
      try {
        if (role) {
          const data = await api(`/communities/${community.slug}/join`, { method: 'DELETE' });
          state.joined.delete(community.slug);
          community.memberCount = data.memberCount;
          toast(`You left ${community.name}.`);
        } else {
          const data = await api(`/communities/${community.slug}/join`, { method: 'POST' });
          state.joined.set(community.slug, 'member');
          community.memberCount = data.memberCount;
          toast(`You joined ${community.name}.`);
        }
        if (onChange) onChange();
      } catch (error) {
        toast(error.message || 'Could not update your membership.');
      } finally {
        paint();
      }
    });
    return button;
  }

  /* ---------- Explore ---------- */

  function communityRow(community, rank) {
    const row = el('article', 'cm-row');
    row.style.setProperty('--cm-accent', community.accent || '#68d6bd');
    const open = el('button', 'cm-row-open');
    open.type = 'button';
    open.setAttribute('aria-label', `Open ${community.name}`);
    if (rank) open.append(el('span', 'cm-rank', String(rank)));
    open.append(communityIcon(community));
    const text = el('span', 'cm-row-text');
    const name = titleWithBadge('cm-row-name', community);
    const meta = el('span', 'cm-row-meta', `c/${community.slug} · ${plural(community.memberCount || 0, 'member')}`);
    text.append(name, meta);
    if (community.description) text.append(el('span', 'cm-row-desc', community.description));
    text.append(tagList(community));
    open.append(text);
    open.addEventListener('click', () => open_(community.slug));
    const actions = el('div', 'cm-row-actions');
    actions.append(joinButton(community, { className: 'cm-btn cm-btn--ghost', onChange: () => { meta.textContent = `c/${community.slug} · ${plural(community.memberCount || 0, 'member')}`; } }));
    row.append(open, actions);
    return row;
  }

  function suggestedCard(community) {
    const card = el('article', 'cm-suggest');
    card.style.setProperty('--cm-accent', community.accent || '#68d6bd');
    const open = el('button', 'cm-suggest-open');
    open.type = 'button';
    open.append(communityIcon(community, 'lg'), titleWithBadge('cm-suggest-name', community), el('span', 'cm-suggest-meta', plural(community.memberCount || 0, 'member')));
    const reasons = [...(community.match?.games || []).map(gameName), ...(community.match?.genres || []).map((id) => GENRE_LABEL[id] || id)];
    if (reasons.length) open.append(el('span', 'cm-suggest-why', `Because you picked ${reasons.slice(0, 2).join(' & ')}`));
    else if (community.official) open.append(el('span', 'cm-suggest-why', community.slug === 'arcadia' ? 'News, feedback and updates' : 'Run by Arcadia'));
    open.addEventListener('click', () => open_(community.slug));
    card.append(open, joinButton(community, { className: 'cm-btn cm-btn--ghost cm-btn--block' }));
    return card;
  }

  async function renderExplore(token) {
    const host = mount();
    if (!host) return;
    teardownChat();
    host.replaceChildren();
    host.classList.remove('is-community');

    const head = el('header', 'cm-head');
    const titles = el('div', 'cm-titles');
    titles.append(el('h1', 'cm-title', 'Communities'), el('p', 'cm-sub', 'Find your people by what you play.'));
    const create = el('button', 'cm-btn cm-btn--solid', '+ Create community');
    create.type = 'button';
    create.addEventListener('click', () => openCreate());
    head.append(titles, create);

    const tools = el('div', 'cm-tools');
    const tabs = el('div', 'cm-tabs');
    tabs.setAttribute('role', 'tablist');
    const tabDefs = [['discover', 'Discover'], ['joined', 'Joined']];
    const tabButtons = tabDefs.map(([id, label]) => {
      const tab = el('button', 'cm-tab', label);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => { state.exploreTab = id; paintTabs(); void renderList(); });
      tabs.append(tab);
      return tab;
    });
    function paintTabs() {
      tabButtons.forEach((tab, index) => {
        const active = tabDefs[index][0] === state.exploreTab;
        tab.classList.toggle('is-selected', active);
        tab.setAttribute('aria-selected', String(active));
      });
    }
    const search = el('input', 'cm-search');
    search.type = 'search';
    search.placeholder = 'Search communities';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', 'Search communities');
    search.value = state.term;
    tools.append(tabs, search);

    const body = el('div', 'cm-explore-body');
    host.append(head, tools, body);
    paintTabs();

    let timer = null;
    search.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { state.term = search.value.trim(); if (state.exploreTab === 'discover') void renderList(); }, 200);
    });

    async function renderList() {
      const mine = ++renderToken;
      body.replaceChildren(el('p', 'cm-empty', 'Loading communities…'));
      await loadJoined();
      if (mine !== renderToken) return;

      if (state.exploreTab === 'joined') {
        if (!getUser()) {
          body.replaceChildren(emptyState('Sign in to see your communities', 'Join communities and they will show up here.', 'Sign in', () => openAuth()));
          return;
        }
        try {
          const data = await api('/communities/mine');
          if (mine !== renderToken) return;
          const items = data.items || [];
          body.replaceChildren();
          if (!items.length) { body.append(emptyState('No communities yet', 'Join a few from Discover, or start your own.', 'Browse communities', () => { state.exploreTab = 'discover'; paintTabs(); void renderList(); })); return; }
          const list = el('div', 'cm-list');
          for (const item of items) list.append(communityRow(item, 0));
          body.append(list);
        } catch (error) { body.replaceChildren(el('p', 'cm-empty', error.message)); }
        return;
      }

      try {
        const params = new URLSearchParams({ limit: '30', sort: state.sort });
        if (state.term) params.set('q', state.term);
        if (state.genre !== 'all') params.set('genre', state.genre);
        if (state.gameFilter) params.set('game', state.gameFilter);
        const plain = !state.term && state.genre === 'all' && !state.gameFilter;
        const [list, suggested, official] = await Promise.all([
          api(`/communities?${params}`),
          getUser() && plain ? api('/communities/suggested').catch(() => null) : Promise.resolve(null),
          plain ? api('/communities?official=1&sort=popular&limit=40').catch(() => null) : Promise.resolve(null)
        ]);
        if (mine !== renderToken) return;
        body.replaceChildren();

        if (state.gameFilter) {
          const note = el('div', 'cm-gamefilter');
          note.append(el('span', '', `Communities for ${gameName(state.gameFilter)}`));
          const clear = el('button', 'cm-btn cm-btn--ghost', 'Show all');
          clear.type = 'button';
          clear.addEventListener('click', () => { state.gameFilter = ''; void renderList(); });
          note.append(clear);
          body.append(note);
        }

        const officialItems = (official?.items || []).slice().sort((a, b) => (b.slug === 'arcadia') - (a.slug === 'arcadia'));
        if (officialItems.length) {
          const section = el('section', 'cm-section');
          const head = el('div', 'cm-section-head');
          head.append(el('h2', 'cm-section-title', 'Official communities'), el('span', 'cm-section-note', 'Run by Arcadia'));
          const strip = el('div', 'cm-strip');
          for (const item of officialItems) strip.append(suggestedCard(item));
          section.append(head, strip);
          body.append(section);
        }

        const picks = (suggested?.items || []).filter((item) => !item.official).slice(0, 8);
        if (suggested && !suggested.fallback && picks.length) {
          const section = el('section', 'cm-section');
          section.append(el('h2', 'cm-section-title', 'Suggested for you'));
          const strip = el('div', 'cm-strip');
          for (const item of picks) strip.append(suggestedCard(item));
          section.append(strip);
          body.append(section);
        }

        const chips = el('div', 'cm-chips');
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-label', 'Filter by genre');
        for (const entry of [{ id: 'all', label: 'All' }, ...GENRES]) {
          const chip = el('button', 'cm-chip', entry.label);
          chip.type = 'button';
          chip.classList.toggle('is-selected', state.genre === entry.id);
          chip.setAttribute('aria-pressed', String(state.genre === entry.id));
          chip.addEventListener('click', () => { state.genre = entry.id; void renderList(); });
          chips.append(chip);
        }
        const sort = el('select', 'cm-select');
        sort.setAttribute('aria-label', 'Sort communities');
        for (const [value, label] of [['popular', 'Most members'], ['new', 'Newest']]) {
          const option = el('option', '', label);
          option.value = value;
          sort.append(option);
        }
        sort.value = state.sort;
        sort.addEventListener('change', () => { state.sort = sort.value; void renderList(); });
        const filterBar = el('div', 'cm-filterbar');
        filterBar.append(chips, sort);

        const section = el('section', 'cm-section');
        section.append(el('h2', 'cm-section-title', state.term || state.gameFilter ? 'Results' : 'Popular communities'), filterBar);
        const rows = el('div', 'cm-list');
        const items = list.items || [];
        if (!items.length) {
          rows.append(state.gameFilter
            ? emptyState('No communities for this game yet', 'Be the first to start one.', 'Start a community', () => openCreate({ games: [state.gameFilter] }))
            : el('p', 'cm-empty', 'No communities match. Try another search, or create one.'));
        }
        items.forEach((item, index) => rows.append(communityRow(item, state.sort === 'popular' && !state.term ? index + 1 : 0)));
        section.append(rows);
        body.append(section);
      } catch (error) {
        body.replaceChildren(el('p', 'cm-empty', error.message || 'Could not load communities.'));
      }
    }
    await renderList();
  }

  function emptyState(title, text, label, action) {
    const box = el('div', 'cm-empty-card');
    box.append(el('h3', '', title), el('p', '', text));
    if (label) {
      const button = el('button', 'cm-btn cm-btn--solid', label);
      button.type = 'button';
      button.addEventListener('click', action);
      box.append(button);
    }
    return box;
  }

  /* ---------- Create a community ---------- */

  async function ensureCatalogue() {
    if (state.catalogue) return state.catalogue;
    try { state.catalogue = (await api('/games?sort=popular&limit=50')).items || []; }
    catch { state.catalogue = []; }
    return state.catalogue;
  }

  async function openCreate(prefill = {}) {
    if (!getUser()) { openAuth({ type: 'create-community' }); return; }
    document.querySelector('#community-create-dialog')?.remove();
    const dialog = el('dialog', 'cm-dialog');
    dialog.id = 'community-create-dialog';
    dialog.setAttribute('aria-labelledby', 'cm-create-title');
    document.body.append(dialog);

    const draft = {
      step: 1,
      games: [...(prefill.games || [])],
      genres: [...(prefill.genres || [])],
      name: '',
      description: '',
      rules: 'Keep it friendly.\nNo spam or harassment.\nStay on topic.',
      busy: false
    };
    const catalogue = await ensureCatalogue();

    const shell = el('div', 'cm-dialog-shell');
    const top = el('header', 'cm-dialog-head');
    const heading = el('h2', 'cm-dialog-title');
    heading.id = 'cm-create-title';
    const close = el('button', 'cm-dialog-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => { dialog.close(); dialog.remove(); });
    top.append(heading, close);
    const body = el('div', 'cm-dialog-body');
    const foot = el('footer', 'cm-dialog-foot');
    const note = el('p', 'cm-dialog-note');
    note.setAttribute('role', 'status');
    shell.append(top, body, foot);
    dialog.append(shell);
    dialog.addEventListener('cancel', () => dialog.remove());

    const accentFor = () => {
      const first = catalogue.find((game) => game.slug === draft.games[0]);
      return first?.accent || '#68d6bd';
    };

    function stepOne() {
      heading.textContent = 'What is your community about?';
      body.replaceChildren();
      body.append(el('p', 'cm-dialog-lead', 'Every community focuses on a genre or on specific games. Pick at least one. You can choose up to 5 games and 3 genres.'));

      body.append(el('h3', 'cm-dialog-label', 'Games'));
      const search = el('input', 'cm-search cm-search--dialog');
      search.type = 'search';
      search.placeholder = 'Search games';
      search.setAttribute('aria-label', 'Search games');
      const grid = el('div', 'cm-pick-games');
      body.append(search, grid);

      const drawGames = () => {
        grid.replaceChildren();
        const term = search.value.trim().toLowerCase();
        const list = catalogue.filter((game) => !term || game.name.toLowerCase().includes(term));
        if (!list.length) grid.append(el('p', 'cm-empty cm-empty--small', catalogue.length ? 'No games match.' : 'Games could not be loaded. You can still pick a genre.'));
        for (const game of list) {
          const info = gameInfo(game.name);
          const tile = el('button', 'cm-pick-game');
          tile.type = 'button';
          const on = draft.games.includes(game.slug);
          tile.classList.toggle('is-selected', on);
          tile.setAttribute('aria-pressed', String(on));
          const art = el('span', 'cm-pick-art');
          if (info.cover) {
            const image = el('img');
            image.src = `/assets/arcadia/games/${info.cover}`;
            image.alt = '';
            image.loading = 'lazy';
            image.addEventListener('error', () => { image.remove(); art.textContent = initials(game.name); });
            art.append(image);
          } else art.textContent = initials(game.name);
          art.append(el('span', 'cm-pick-check', '✓'));
          tile.append(art, el('span', 'cm-pick-name', info.cover ? info.title : game.name));
          tile.addEventListener('click', () => {
            const has = draft.games.includes(game.slug);
            if (!has && draft.games.length >= 5) { note.textContent = 'You can pick up to 5 games.'; return; }
            draft.games = has ? draft.games.filter((slug) => slug !== game.slug) : [...draft.games, game.slug];
            note.textContent = '';
            tile.classList.toggle('is-selected', !has);
            tile.setAttribute('aria-pressed', String(!has));
            footer();
          });
          grid.append(tile);
        }
      };
      let timer = null;
      search.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(drawGames, 120); });
      drawGames();

      body.append(el('h3', 'cm-dialog-label', 'Genres'));
      const chips = el('div', 'cm-chips cm-chips--wrap');
      for (const genre of GENRES) {
        const chip = el('button', 'cm-chip', genre.label);
        chip.type = 'button';
        const on = draft.genres.includes(genre.id);
        chip.classList.toggle('is-selected', on);
        chip.setAttribute('aria-pressed', String(on));
        chip.addEventListener('click', () => {
          const has = draft.genres.includes(genre.id);
          if (!has && draft.genres.length >= 3) { note.textContent = 'You can pick up to 3 genres.'; return; }
          draft.genres = has ? draft.genres.filter((id) => id !== genre.id) : [...draft.genres, genre.id];
          note.textContent = '';
          chip.classList.toggle('is-selected', !has);
          chip.setAttribute('aria-pressed', String(!has));
          footer();
        });
        chips.append(chip);
      }
      body.append(chips);
    }

    function stepTwo() {
      heading.textContent = 'Make it yours';
      body.replaceChildren();
      if (!draft.name) {
        const first = draft.games[0] ? gameName(draft.games[0]) : (GENRE_LABEL[draft.genres[0]] || '').split(' &')[0];
        draft.name = first ? `${first} Hub` : '';
      }

      const preview = el('div', 'cm-preview');
      const paintPreview = () => {
        preview.replaceChildren();
        preview.style.setProperty('--cm-accent', accentFor());
        const fake = { name: draft.name || 'Your community', accent: accentFor(), games: draft.games, genres: draft.genres };
        const text = el('span', 'cm-row-text');
        text.append(el('span', 'cm-row-name', fake.name), el('span', 'cm-row-meta', 'c/your-community · 1 member'), tagList(fake, 5));
        preview.append(communityIcon(fake, 'lg'), text);
      };

      const nameField = el('label', 'cm-field');
      nameField.append(el('span', 'cm-field-label', 'Name'));
      const name = el('input', 'cm-input');
      name.maxLength = 40;
      name.value = draft.name;
      name.placeholder = 'e.g. Midnight FC Squad';
      name.addEventListener('input', () => { draft.name = name.value; paintPreview(); footer(); });
      nameField.append(name);

      const descField = el('label', 'cm-field');
      descField.append(el('span', 'cm-field-label', 'Description'));
      const desc = el('textarea', 'cm-input cm-input--area');
      desc.rows = 3;
      desc.maxLength = 300;
      desc.value = draft.description;
      desc.placeholder = 'What is this community for?';
      desc.addEventListener('input', () => { draft.description = desc.value; });
      descField.append(desc);

      const rulesField = el('label', 'cm-field');
      rulesField.append(el('span', 'cm-field-label', 'Rules (one per line, up to 8)'));
      const rules = el('textarea', 'cm-input cm-input--area');
      rules.rows = 4;
      rules.value = draft.rules;
      rules.addEventListener('input', () => { draft.rules = rules.value; });
      rulesField.append(rules);

      body.append(preview, nameField, descField, rulesField);
      paintPreview();
    }

    function footer() {
      foot.replaceChildren();
      const left = el('div', 'cm-dialog-left');
      if (draft.step === 2) {
        const back = el('button', 'cm-btn cm-btn--ghost', 'Back');
        back.type = 'button';
        back.addEventListener('click', () => go(1));
        left.append(back);
      } else {
        left.append(el('span', 'cm-dialog-count', `${draft.games.length} ${draft.games.length === 1 ? 'game' : 'games'} · ${draft.genres.length} ${draft.genres.length === 1 ? 'genre' : 'genres'}`));
      }
      const next = el('button', 'cm-btn cm-btn--solid', draft.step === 1 ? 'Continue' : 'Create community');
      next.type = 'button';
      next.disabled = draft.busy || (draft.step === 1 ? !(draft.games.length || draft.genres.length) : draft.name.trim().length < 3);
      next.addEventListener('click', () => { if (draft.step === 1) go(2); else void submit(); });
      foot.append(left, note, next);
    }

    function go(step) {
      draft.step = step;
      note.textContent = '';
      if (step === 1) stepOne(); else stepTwo();
      footer();
      body.scrollTo({ top: 0 });
    }

    async function submit() {
      draft.busy = true;
      footer();
      try {
        const data = await api('/communities', {
          method: 'POST',
          body: JSON.stringify({
            name: draft.name.trim(),
            description: draft.description.trim(),
            games: draft.games,
            genres: draft.genres,
            rules: draft.rules.split('\n').map((line) => line.trim()).filter(Boolean)
          })
        });
        await loadJoined(true);
        dialog.close();
        dialog.remove();
        toast(`${data.community.name} is live.`);
        open_(data.community.slug);
      } catch (error) {
        note.textContent = error.message || 'Could not create the community.';
        draft.busy = false;
        footer();
      }
    }

    go(1);
    dialog.showModal();
  }

  /* ---------- Routing ---------- */

  function open_(slug, options = {}) {
    state.route = { name: 'community', slug, tab: options.tab || 'posts', sort: 'hot' };
    navigate('groups');
  }

  function openPost(slug, id) {
    state.route = { name: 'post', slug, id };
    void render();
    window.scrollTo({ top: 0 });
  }

  function goExplore() {
    state.route = { name: 'explore' };
    void render();
    window.scrollTo({ top: 0 });
  }

  async function render() {
    const host = mount();
    if (!host) return;
    renderToken += 1;
    host.classList.remove('is-chat');
    if (state.route.name === 'community') await renderCommunity();
    else if (state.route.name === 'post') await renderPostPage();
    else await renderExplore();
  }

  async function show() {
    await loadJoined();
    await render();
  }

  function errorBlock(message, label = 'Back to communities') {
    const box = emptyState('We could not open that', message || 'Something went wrong.', label, goExplore);
    return box;
  }

  /* ---------- Votes ---------- */

  function voteRail(post, community) {
    const rail = el('div', 'cm-vote');
    const up = el('button', 'cm-vote-btn cm-vote-btn--up');
    const down = el('button', 'cm-vote-btn cm-vote-btn--down');
    up.type = down.type = 'button';
    up.innerHTML = ARROW_UP;
    down.innerHTML = ARROW_DOWN;
    up.setAttribute('aria-label', 'Upvote');
    down.setAttribute('aria-label', 'Downvote');
    const score = el('span', 'cm-vote-score');
    rail.append(up, score, down);

    const paint = () => {
      const mineVote = post.myVote || 0;
      score.textContent = formatCount(post.score || 0);
      rail.classList.toggle('is-up', mineVote === 1);
      rail.classList.toggle('is-down', mineVote === -1);
      up.setAttribute('aria-pressed', String(mineVote === 1));
      down.setAttribute('aria-pressed', String(mineVote === -1));
    };
    paint();

    async function cast(value) {
      if (!getUser()) { openAuth({ type: 'community', slug: community.slug }); return; }
      const before = { score: post.score || 0, vote: post.myVote || 0 };
      const next = before.vote === value ? 0 : value;
      post.score = before.score + (next - before.vote);
      post.myVote = next;
      paint();
      try {
        const result = await api(`/communities/${community.slug}/posts/${post._id}/vote`, { method: 'PUT', body: JSON.stringify({ value: next }) });
        post.score = result.score;
        post.myVote = result.myVote;
      } catch (error) {
        post.score = before.score;
        post.myVote = before.vote;
        toast(error.message || 'Could not save your vote.');
      }
      paint();
    }
    up.addEventListener('click', () => void cast(1));
    down.addEventListener('click', () => void cast(-1));
    return rail;
  }

  /* ---------- Post card ---------- */

  function authorLine(post) {
    const name = post.author?.username || 'player';
    return `Posted by u/${name} · ${timeAgo(post.createdAt)}`;
  }

  function postCard(post, community, role, { detail = false, onRemoved, onPinChanged } = {}) {
    const card = el('article', `cm-post${post.pinnedAt ? ' is-pinned' : ''}${detail ? ' is-detail' : ''}`);
    card.append(voteRail(post, community));

    const main = el('div', 'cm-post-main');
    const meta = el('div', 'cm-post-meta');
    if (post.pinnedAt) meta.append(el('span', 'cm-pinned', 'Pinned'));
    if (post.flair) meta.append(el('span', 'cm-flair', post.flair));
    meta.append(el('span', 'cm-post-by', authorLine(post)));
    main.append(meta);

    if (post.title) {
      const title = detail ? el('h2', 'cm-post-title') : el('h3', 'cm-post-title');
      if (detail) title.textContent = post.title;
      else {
        const link = el('button', 'cm-post-link', post.title);
        link.type = 'button';
        link.addEventListener('click', () => openPost(community.slug, post._id));
        title.append(link);
      }
      main.append(title);
    }
    if (post.body) {
      const body = el('p', 'cm-post-body', post.body);
      if (!detail && !post.title) {
        // Older posts have no title: the text itself opens the post.
        body.classList.add('is-link');
        body.tabIndex = 0;
        body.addEventListener('click', () => openPost(community.slug, post._id));
        body.addEventListener('keydown', (event) => { if (event.key === 'Enter') openPost(community.slug, post._id); });
      }
      main.append(body);
    }

    const foot = el('div', 'cm-post-foot');
    const comments = el('button', 'cm-post-action', `💬 ${plural(post.commentCount || 0, 'comment')}`);
    comments.type = 'button';
    if (!detail) comments.addEventListener('click', () => openPost(community.slug, post._id));
    else comments.disabled = true;
    foot.append(comments);

    if (['owner', 'moderator'].includes(role)) {
      const pin = el('button', 'cm-post-action', post.pinnedAt ? 'Unpin' : 'Pin');
      pin.type = 'button';
      pin.addEventListener('click', async () => {
        pin.disabled = true;
        try {
          await api(`/communities/${community.slug}/posts/${post._id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !post.pinnedAt }) });
          toast(post.pinnedAt ? 'Post unpinned.' : 'Post pinned.');
          if (onPinChanged) onPinChanged();
        } catch (error) { toast(error.message); pin.disabled = false; }
      });
      const remove = el('button', 'cm-post-action cm-post-action--danger', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await api(`/communities/${community.slug}/posts/${post._id}`, { method: 'DELETE' });
          toast('Post removed from this community.');
          if (onRemoved) onRemoved(post); else card.remove();
        } catch (error) { toast(error.message); remove.disabled = false; }
      });
      foot.append(pin, remove);
    }
    main.append(foot);
    card.append(main);
    return card;
  }

  /* ---------- Post composer ---------- */

  function composer(community, role, onPosted) {
    const wrap = el('section', 'cm-compose');
    const user = getUser();
    if (!user) {
      const bar = el('button', 'cm-compose-bar', 'Sign in to join the conversation');
      bar.type = 'button';
      bar.addEventListener('click', () => openAuth({ type: 'community', slug: community.slug }));
      wrap.append(bar);
      return wrap;
    }
    if (!role) {
      wrap.append(el('p', 'cm-compose-note', `Join c/${community.slug} to start posting.`));
      return wrap;
    }

    const bar = el('button', 'cm-compose-bar');
    bar.type = 'button';
    bar.append(personAvatar(user), el('span', 'cm-compose-fake', 'Create a post'));
    const form = el('form', 'cm-compose-form');
    form.hidden = true;

    const title = el('input', 'cm-input');
    title.placeholder = 'Title';
    title.maxLength = 120;
    title.setAttribute('aria-label', 'Post title');
    const body = el('textarea', 'cm-input cm-input--area');
    body.placeholder = 'Text (optional)';
    body.rows = 4;
    body.maxLength = 500;
    body.setAttribute('aria-label', 'Post text');
    const row = el('div', 'cm-compose-row');
    const flair = el('select', 'cm-select');
    flair.setAttribute('aria-label', 'Flair');
    const none = el('option', '', 'No flair');
    none.value = '';
    flair.append(none);
    for (const name of community.flairs || []) { const option = el('option', '', name); option.value = name; flair.append(option); }
    const counter = el('span', 'cm-compose-count', '0 / 500');
    body.addEventListener('input', () => { counter.textContent = `${body.value.length} / 500`; });
    const cancel = el('button', 'cm-btn cm-btn--ghost', 'Cancel');
    cancel.type = 'button';
    const submit = el('button', 'cm-btn cm-btn--solid', 'Post');
    submit.type = 'submit';
    row.append(flair, counter, cancel, submit);
    form.append(title, body, row);

    bar.addEventListener('click', () => { bar.hidden = true; form.hidden = false; title.focus(); });
    cancel.addEventListener('click', () => { form.hidden = true; bar.hidden = false; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!title.value.trim() && !body.value.trim()) { toast('Add a title or some text first.'); return; }
      submit.disabled = true;
      try {
        const data = await api(`/communities/${community.slug}/posts`, { method: 'POST', body: JSON.stringify({ title: title.value.trim(), body: body.value.trim(), flair: flair.value }) });
        title.value = body.value = '';
        counter.textContent = '0 / 500';
        form.hidden = true;
        bar.hidden = false;
        toast('Posted.');
        onPosted({ ...data.post, score: 0, myVote: 0, commentCount: 0 });
      } catch (error) { toast(error.message || 'Could not post.'); }
      finally { submit.disabled = false; }
    });
    wrap.append(bar, form);
    return wrap;
  }

  /* ---------- Sidebar ---------- */

  function sideCard(title) {
    const card = el('section', 'cm-card');
    if (title) card.append(el('h2', 'cm-card-title', title));
    return card;
  }

  function sidebar(community, role, moderators, { onChat, onManage } = {}) {
    const stack = el('aside', 'cm-side');

    const about = sideCard(`About c/${community.slug}`);
    if (community.description) about.append(el('p', 'cm-card-text', community.description));
    const stats = el('div', 'cm-stats');
    const stat = (value, label) => { const box = el('div', 'cm-stat'); box.append(el('strong', '', value), el('span', '', label)); return box; };
    stats.append(stat(formatCount(community.memberCount || 0), 'members'), stat(formatCount(community.postCount || 0), 'posts'));
    about.append(stats);
    if (community.createdAt) about.append(el('p', 'cm-card-meta', `Created ${new Date(community.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`));
    if (role && onChat) {
      const chatButton = el('button', 'cm-btn cm-btn--solid cm-btn--block', 'Open community chat');
      chatButton.type = 'button';
      chatButton.addEventListener('click', onChat);
      about.append(chatButton);
    }
    stack.append(about);

    const rules = sideCard('Rules');
    const list = el('ol', 'cm-rules');
    for (const rule of community.rules || []) {
      const item = el('li', 'cm-rule');
      item.append(el('span', '', rule));
      list.append(item);
    }
    if (!list.children.length) list.append(el('li', 'cm-rule', 'No rules yet.'));
    rules.append(list);
    stack.append(rules);

    const focus = focusSlugs(community);
    if (focus.length || (community.genres || []).length) {
      const topics = sideCard('Focus');
      const chips = el('div', 'cm-chips cm-chips--wrap');
      for (const slug of focus) {
        const chip = el('button', 'cm-chip cm-chip--game', gameName(slug));
        chip.type = 'button';
        chip.addEventListener('click', () => { if (openGame) openGame(slug); });
        chips.append(chip);
      }
      for (const id of community.genres || []) chips.append(el('span', 'cm-chip cm-chip--static', GENRE_LABEL[id] || id));
      topics.append(chips);
      stack.append(topics);
    }

    if (moderators?.length) {
      const staff = sideCard('Moderators');
      const people = el('ul', 'cm-people');
      for (const person of moderators) {
        const item = el('li', 'cm-person');
        item.append(personAvatar(person), el('span', 'cm-person-name', `u/${person.username}`), el('span', 'cm-person-role', ROLE_LABEL[person.role] || ''));
        people.append(item);
      }
      staff.append(people);
      stack.append(staff);
    }

    if (role === 'owner' && onManage) {
      const manage = el('button', 'cm-btn cm-btn--ghost cm-btn--block', 'Manage community');
      manage.type = 'button';
      manage.addEventListener('click', onManage);
      stack.append(manage);
    }
    return stack;
  }

  /* ---------- Community page ---------- */

  async function renderCommunity() {
    const host = mount();
    const { slug } = state.route;
    const mine = renderToken;
    teardownChat();
    host.classList.add('is-community');
    host.replaceChildren(el('p', 'cm-empty', 'Loading community…'));
    await loadJoined();

    let data;
    try { data = await api(`/communities/${encodeURIComponent(slug)}`); }
    catch (error) { if (mine === renderToken) host.replaceChildren(errorBlock(error.message)); return; }
    if (mine !== renderToken) return;

    const community = data.community;
    const role = data.role || null;
    if (getUser()) { if (role) state.joined.set(slug, role); else state.joined.delete(slug); }
    const wide = window.matchMedia('(min-width: 900px)').matches;
    let tab = state.route.tab || 'posts';
    if (tab === 'about' && wide) tab = 'posts';
    if (tab === 'chat' && !role) tab = 'posts';
    state.route.tab = tab;
    host.classList.toggle('is-chat', tab === 'chat');

    host.replaceChildren();
    const back = el('button', 'cm-back', '← All communities');
    back.type = 'button';
    back.addEventListener('click', goExplore);

    const banner = el('div', 'cm-banner');
    banner.style.setProperty('--cm-accent', community.accent || '#68d6bd');
    const bannerGame = focusSlugs(community).map((item) => gameInfo(item)).find((info) => info.banner);
    if (bannerGame) {
      const probe = new Image();
      probe.onload = () => { banner.style.backgroundImage = `url("${probe.src}")`; };
      probe.src = `/assets/arcadia/games/${bannerGame.banner}`;
    }

    const bar = el('header', 'cm-idbar');
    bar.append(communityIcon(community, 'xl'));
    const idText = el('div', 'cm-idtext');
    const idName = el('h1', 'cm-idname');
    idName.append(document.createTextNode(community.name));
    if (community.official) idName.append(officialBadge());
    idText.append(idName, el('p', 'cm-idmeta', `c/${community.slug} · ${plural(community.memberCount || 0, 'member')}`), tagList(community, 4));
    const actions = el('div', 'cm-idactions');
    actions.append(joinButton(community, { onChange: () => void renderCommunity() }));
    bar.append(idText, actions);

    const tabs = el('div', 'cm-tabs cm-tabs--page');
    tabs.setAttribute('role', 'tablist');
    const defs = [['posts', 'Posts'], ['chat', 'Chat'], ['about', 'About']];
    for (const [id, label] of defs) {
      if (id === 'about' && wide) continue;
      const button = el('button', 'cm-tab', label);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      const locked = id === 'chat' && !role;
      button.classList.toggle('is-selected', tab === id);
      button.setAttribute('aria-selected', String(tab === id));
      if (locked) { button.title = 'Join to use the chat'; button.classList.add('is-locked'); }
      button.addEventListener('click', () => {
        if (locked) { toast(getUser() ? 'Join this community to use its chat.' : 'Sign in and join to use the chat.'); return; }
        state.route.tab = id;
        void renderCommunity();
      });
      tabs.append(button);
    }

    const content = el('div', `cm-content cm-content--${tab}`);
    host.append(back, banner, bar, tabs, content);

    const side = sidebar(community, role, data.moderators, {
      onChat: () => { state.route.tab = 'chat'; void renderCommunity(); },
      onManage: () => openManage(community, data.moderators)
    });

    if (tab === 'chat') {
      mountChat(content, community, role);
    } else if (tab === 'about') {
      content.append(side);
    } else {
      const main = el('div', 'cm-main');
      content.append(main, side);
      await renderPosts(main, community, role);
    }
  }

  async function renderPosts(main, community, role) {
    const view = { items: [], sort: state.route.sort || 'hot', nextCursor: null, nextPage: null, loading: false };
    const list = el('div', 'cm-posts');
    const more = el('button', 'cm-btn cm-btn--ghost cm-more', 'Load more');
    more.type = 'button';
    more.hidden = true;

    const sorts = el('div', 'cm-sortbar');
    sorts.setAttribute('role', 'tablist');
    const sortButtons = [['hot', 'Hot'], ['new', 'New'], ['top', 'Top']].map(([id, label]) => {
      const button = el('button', 'cm-sort', label);
      button.type = 'button';
      button.addEventListener('click', () => { view.sort = id; state.route.sort = id; void load(true); });
      sorts.append(button);
      return [id, button];
    });

    main.append(composer(community, role, (post) => { view.items.unshift(post); drawPosts(); }), sorts, list, more);

    function drawPosts() {
      for (const [id, button] of sortButtons) {
        button.classList.toggle('is-selected', id === view.sort);
        button.setAttribute('aria-selected', String(id === view.sort));
      }
      list.replaceChildren();
      if (!view.items.length) {
        list.append(emptyState('Nothing here yet', role ? 'Be the first to post in this community.' : 'Join the community and start the conversation.'));
      }
      for (const post of view.items) {
        list.append(postCard(post, community, role, {
          onRemoved: (removed) => { view.items = view.items.filter((item) => item._id !== removed._id); drawPosts(); },
          onPinChanged: () => void load(true)
        }));
      }
      more.hidden = !(view.nextCursor || view.nextPage !== null);
    }

    async function load(reset) {
      if (view.loading) return;
      view.loading = true;
      more.disabled = true;
      if (reset) { view.items = []; view.nextCursor = null; view.nextPage = null; list.replaceChildren(el('p', 'cm-empty', 'Loading posts…')); more.hidden = true; for (const [id, button] of sortButtons) button.classList.toggle('is-selected', id === view.sort); }
      try {
        const params = new URLSearchParams({ sort: view.sort, limit: '15' });
        if (!reset && view.sort === 'new' && view.nextCursor) params.set('cursor', view.nextCursor);
        if (!reset && view.sort !== 'new' && view.nextPage !== null) params.set('page', String(view.nextPage));
        const data = await api(`/communities/${community.slug}/posts?${params}`);
        view.items = reset ? data.items : [...view.items, ...data.items];
        view.nextCursor = data.nextCursor;
        view.nextPage = data.nextPage ?? null;
        drawPosts();
      } catch (error) {
        list.replaceChildren(el('p', 'cm-empty', error.message || 'Could not load posts.'));
      } finally { view.loading = false; more.disabled = false; }
    }
    more.addEventListener('click', () => void load(false));
    await load(true);
  }

  /* ---------- Post page with comments ---------- */

  async function renderPostPage() {
    const host = mount();
    const { slug, id } = state.route;
    const mine = renderToken;
    teardownChat();
    host.classList.add('is-community');
    host.replaceChildren(el('p', 'cm-empty', 'Loading post…'));
    await loadJoined();

    let page;
    let details;
    try {
      [page, details] = await Promise.all([api(`/communities/${encodeURIComponent(slug)}/posts/${id}`), api(`/communities/${encodeURIComponent(slug)}`)]);
    } catch (error) {
      if (mine === renderToken) host.replaceChildren(errorBlock(error.message, `Back to c/${slug}`));
      return;
    }
    if (mine !== renderToken) return;

    const community = details.community;
    const role = details.role || page.role || null;
    const post = page.post;
    let comments = page.comments || [];

    host.replaceChildren();
    const back = el('button', 'cm-back', `← Back to c/${community.slug}`);
    back.type = 'button';
    back.addEventListener('click', () => open_(community.slug));
    const content = el('div', 'cm-content cm-content--posts');
    const main = el('div', 'cm-main');
    host.append(back, content);
    content.append(main, sidebar(community, role, details.moderators, { onChat: () => open_(community.slug, { tab: 'chat' }) }));

    main.append(postCard(post, community, role, { detail: true, onRemoved: () => open_(community.slug), onPinChanged: () => void renderPostPage() }));

    const section = el('section', 'cm-comments');
    const heading = el('h2', 'cm-comments-title');
    const thread = el('div', 'cm-thread');

    const form = el('form', 'cm-comment-form');
    if (getUser()) {
      const input = el('textarea', 'cm-input cm-input--area');
      input.rows = 3;
      input.maxLength = 1000;
      input.placeholder = 'Add a comment';
      input.setAttribute('aria-label', 'Add a comment');
      const send = el('button', 'cm-btn cm-btn--solid', 'Comment');
      send.type = 'submit';
      form.append(input, send);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!input.value.trim()) return;
        send.disabled = true;
        try {
          const data = await api(`/posts/${post._id}/comments`, { method: 'POST', body: JSON.stringify({ body: input.value.trim() }) });
          comments = [...comments, data.comment];
          post.commentCount = (post.commentCount || 0) + 1;
          input.value = '';
          drawThread();
        } catch (error) { toast(error.message || 'Could not add your comment.'); }
        finally { send.disabled = false; }
      });
    } else {
      const prompt = el('button', 'cm-compose-bar', 'Sign in to comment');
      prompt.type = 'button';
      prompt.addEventListener('click', () => openAuth({ type: 'community', slug: community.slug }));
      form.append(prompt);
    }

    function commentNode(comment, parentId) {
      const node = el('article', `cm-comment${parentId ? ' is-reply' : ''}`);
      node.append(personAvatar(comment.author));
      const body = el('div', 'cm-comment-body');
      const head = el('div', 'cm-comment-head');
      head.append(el('strong', '', `u/${comment.author?.username || 'player'}`), el('span', '', timeAgo(comment.createdAt)));
      body.append(head, el('p', 'cm-comment-text', comment.body));
      if (getUser()) {
        const reply = el('button', 'cm-post-action', 'Reply');
        reply.type = 'button';
        reply.addEventListener('click', () => {
          if (body.querySelector('.cm-reply-form')) return;
          const replyForm = el('form', 'cm-reply-form');
          const input = el('input', 'cm-input');
          input.maxLength = 1000;
          input.required = true;
          input.placeholder = `Reply to u/${comment.author?.username || 'player'}`;
          input.setAttribute('aria-label', 'Reply');
          const send = el('button', 'cm-btn cm-btn--solid', 'Reply');
          send.type = 'submit';
          replyForm.append(input, send);
          replyForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            send.disabled = true;
            try {
              const data = await api(`/posts/${post._id}/comments`, { method: 'POST', body: JSON.stringify({ body: input.value.trim(), parent: parentId || comment._id }) });
              comments = [...comments, data.comment];
              post.commentCount = (post.commentCount || 0) + 1;
              drawThread();
            } catch (error) { toast(error.message || 'Could not add your reply.'); send.disabled = false; }
          });
          body.append(replyForm);
          input.focus();
        });
        body.append(reply);
      }
      node.append(body);
      return node;
    }

    function drawThread() {
      heading.textContent = plural(comments.length, 'comment');
      thread.replaceChildren();
      const tops = comments.filter((comment) => !comment.parent);
      if (!tops.length) thread.append(el('p', 'cm-empty cm-empty--small', 'No comments yet. Start the conversation.'));
      for (const top of tops) {
        const group = el('div', 'cm-thread-group');
        group.append(commentNode(top, null));
        const replies = comments.filter((comment) => String(comment.parent) === String(top._id));
        if (replies.length) {
          const nested = el('div', 'cm-replies');
          for (const reply of replies) nested.append(commentNode(reply, top._id));
          group.append(nested);
        }
        thread.append(group);
      }
    }
    drawThread();
    section.append(heading, form, thread);
    main.append(section);
  }

  /* ---------- Owner tools ---------- */

  function openManage(community, moderators) {
    document.querySelector('#community-manage-dialog')?.remove();
    const dialog = el('dialog', 'cm-dialog');
    dialog.id = 'community-manage-dialog';
    dialog.setAttribute('aria-labelledby', 'cm-manage-title');
    const shell = el('div', 'cm-dialog-shell');
    const head = el('header', 'cm-dialog-head');
    const title = el('h2', 'cm-dialog-title', `Manage ${community.name}`);
    title.id = 'cm-manage-title';
    const close = el('button', 'cm-dialog-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => { dialog.close(); dialog.remove(); });
    head.append(title, close);

    const body = el('div', 'cm-dialog-body');
    const field = (label, control) => { const wrap = el('label', 'cm-field'); wrap.append(el('span', 'cm-field-label', label), control); return wrap; };
    const desc = el('textarea', 'cm-input cm-input--area');
    desc.rows = 3; desc.maxLength = 300; desc.value = community.description || '';
    const rules = el('textarea', 'cm-input cm-input--area');
    rules.rows = 5; rules.value = (community.rules || []).join('\n');
    const flairs = el('input', 'cm-input');
    flairs.value = (community.flairs || []).join(', ');
    flairs.placeholder = 'Discussion, Clip, Question';
    body.append(field('Description', desc), field('Rules (one per line, up to 8)', rules), field('Post flairs (comma separated, up to 8)', flairs));

    const modBox = el('div', 'cm-field');
    modBox.append(el('span', 'cm-field-label', 'Moderators'));
    const modRow = el('div', 'cm-compose-row');
    const username = el('input', 'cm-input');
    username.placeholder = 'Member username';
    username.setAttribute('aria-label', 'Member username');
    const roleSelect = el('select', 'cm-select');
    for (const [value, label] of [['moderator', 'Make moderator'], ['member', 'Make member']]) { const option = el('option', '', label); option.value = value; roleSelect.append(option); }
    const apply = el('button', 'cm-btn cm-btn--ghost', 'Update role');
    apply.type = 'button';
    apply.addEventListener('click', async () => {
      const name = username.value.trim();
      if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) { toast('Enter a member username.'); return; }
      apply.disabled = true;
      try {
        await api(`/communities/${community.slug}/members/${encodeURIComponent(name)}/role`, { method: 'PATCH', body: JSON.stringify({ role: roleSelect.value }) });
        toast('Member role updated.');
        username.value = '';
      } catch (error) { toast(error.message); }
      finally { apply.disabled = false; }
    });
    modRow.append(username, roleSelect, apply);
    modBox.append(modRow);
    if (moderators?.length) modBox.append(el('p', 'cm-card-meta', `Current: ${moderators.map((person) => `u/${person.username}`).join(', ')}`));
    body.append(modBox);

    const foot = el('footer', 'cm-dialog-foot');
    const note = el('p', 'cm-dialog-note');
    note.setAttribute('role', 'status');
    const save = el('button', 'cm-btn cm-btn--solid', 'Save changes');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await api(`/communities/${community.slug}`, {
          method: 'PATCH',
          body: JSON.stringify({
            description: desc.value.trim(),
            rules: rules.value.split('\n').map((line) => line.trim()).filter(Boolean),
            flairs: flairs.value.split(',').map((item) => item.trim()).filter(Boolean)
          })
        });
        dialog.close();
        dialog.remove();
        toast('Community updated.');
        void renderCommunity();
      } catch (error) { note.textContent = error.message || 'Could not save.'; save.disabled = false; }
    });
    foot.append(el('span'), note, save);
    shell.append(head, body, foot);
    dialog.append(shell);
    dialog.addEventListener('cancel', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  /* ---------- Group chat ---------- */

  function teardownChat() {
    if (chat) { chat.destroy(); chat = null; }
  }

  function mountChat(container, community, role) {
    teardownChat();
    chat = createChatSession(container, community, role);
    void chat.start();
  }

  function dayLabel(date) {
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  }

  function mentionNodes(text, me) {
    const fragment = document.createDocumentFragment();
    for (const part of text.split(/(@[a-z0-9_]{3,24})/gi)) {
      if (/^@[a-z0-9_]{3,24}$/i.test(part)) {
        const chip = el('span', `cc-mention${me && part.slice(1).toLowerCase() === me.toLowerCase() ? ' is-me' : ''}`, part);
        fragment.append(chip);
      } else if (part) fragment.append(document.createTextNode(part));
    }
    return fragment;
  }

  function createChatSession(container, community, role) {
    const slug = community.slug;
    const user = getUser();
    const staff = ['owner', 'moderator'].includes(role);
    const s = {
      channels: [], channel: null, messages: [], hasMore: false, replyTo: null,
      typing: new Map(), online: 0, unread: new Set(), socket: null, destroyed: false, lastTypingSent: 0, loading: false
    };

    const shell = el('div', 'cc');
    const rail = el('nav', 'cc-rail');
    rail.setAttribute('aria-label', 'Channels');
    const pane = el('section', 'cc-pane');
    shell.append(rail, pane);
    container.append(shell);

    const head = el('header', 'cc-head');
    const headText = el('div', 'cc-head-text');
    const headName = el('h2', 'cc-head-name');
    const headTopic = el('p', 'cc-head-topic');
    headText.append(headName, headTopic);
    const presence = el('span', 'cc-presence');
    head.append(headText, presence);

    const scroller = el('div', 'cc-scroll');
    scroller.setAttribute('role', 'log');
    scroller.setAttribute('aria-live', 'polite');
    scroller.setAttribute('aria-label', 'Channel messages');
    const typingLine = el('div', 'cc-typing');
    typingLine.setAttribute('aria-live', 'polite');

    const composerForm = el('form', 'cc-composer');
    const replyBar = el('div', 'cc-replybar');
    replyBar.hidden = true;
    const squadForm = el('div', 'cc-squadform');
    squadForm.hidden = true;
    const row = el('div', 'cc-composer-row');
    const squadToggle = el('button', 'cc-icon-btn', '🎮');
    squadToggle.type = 'button';
    squadToggle.title = 'Start a squad call';
    squadToggle.setAttribute('aria-label', 'Start a squad call');
    const input = el('textarea', 'cc-input');
    input.rows = 1;
    input.maxLength = 1000;
    input.placeholder = 'Message';
    input.setAttribute('aria-label', 'Message');
    const send = el('button', 'cc-send', '↑');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Send message');
    send.disabled = true;
    row.append(squadToggle, input, send);
    composerForm.append(replyBar, squadForm, row);
    pane.append(head, scroller, typingLine, composerForm);

    /* --- channels --- */
    function drawRail() {
      rail.replaceChildren();
      const top = el('div', 'cc-rail-head');
      top.append(el('span', 'cc-rail-title', 'Channels'));
      if (staff) {
        const add = el('button', 'cc-icon-btn cc-icon-btn--small', '+');
        add.type = 'button';
        add.title = 'Add a channel';
        add.setAttribute('aria-label', 'Add a channel');
        add.addEventListener('click', () => {
          if (rail.querySelector('.cc-newchannel')) return;
          const form = el('form', 'cc-newchannel');
          const name = el('input', 'cm-input');
          name.placeholder = 'channel-name';
          name.maxLength = 20;
          name.setAttribute('aria-label', 'Channel name');
          form.append(name);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
              const data = await api(`/communities/${slug}/channels`, { method: 'POST', body: JSON.stringify({ name: name.value }) });
              await loadChannels();
              selectChannel(data.channel.slug);
            } catch (error) { toast(error.message); }
          });
          list.before(form);
          name.focus();
        });
        top.append(add);
      }
      rail.append(top);
      const list = el('div', 'cc-channels');
      for (const channel of s.channels) {
        const item = el('div', 'cc-channel-wrap');
        const button = el('button', 'cc-channel');
        button.type = 'button';
        button.classList.toggle('is-selected', s.channel?.slug === channel.slug);
        button.classList.toggle('has-unread', s.unread.has(channel.slug));
        button.append(el('span', 'cc-hash', channel.kind === 'squad' ? '🎮' : '#'), el('span', 'cc-channel-name', channel.name));
        button.addEventListener('click', () => selectChannel(channel.slug));
        item.append(button);
        if (role === 'owner' && !['general', 'squad-finder'].includes(channel.slug)) {
          const del = el('button', 'cc-channel-del', '×');
          del.type = 'button';
          del.setAttribute('aria-label', `Remove ${channel.name}`);
          del.addEventListener('click', async () => {
            if (!window.confirm(`Remove #${channel.name} and its messages?`)) return;
            try {
              await api(`/communities/${slug}/channels/${channel.slug}`, { method: 'DELETE' });
              await loadChannels();
              if (s.channel?.slug === channel.slug) selectChannel(s.channels[0]?.slug);
            } catch (error) { toast(error.message); }
          });
          item.append(del);
        }
        list.append(item);
      }
      rail.append(list);
    }

    async function loadChannels() {
      const data = await api(`/communities/${slug}/channels`);
      s.channels = data.channels || [];
      drawRail();
    }

    function drawHead() {
      headName.textContent = s.channel ? `${s.channel.kind === 'squad' ? '🎮' : '#'} ${s.channel.name}` : 'Chat';
      headTopic.textContent = s.channel?.topic || '';
      presence.textContent = s.online ? `● ${s.online} online` : '';
      presence.hidden = !s.online;
      squadToggle.hidden = s.channel?.kind !== 'squad';
      if (squadToggle.hidden) squadForm.hidden = true;
      input.placeholder = s.channel ? `Message #${s.channel.name}` : 'Message';
    }

    async function selectChannel(channelSlug) {
      const next = s.channels.find((channel) => channel.slug === channelSlug) || s.channels[0];
      if (!next) return;
      s.channel = next;
      state.route.channel = next.slug;
      s.unread.delete(next.slug);
      s.replyTo = null;
      s.typing.forEach((timer) => window.clearTimeout(timer));
      s.typing.clear();
      paintTyping();
      drawRail();
      drawHead();
      paintReply();
      s.messages = [];
      s.hasMore = false;
      scroller.replaceChildren(el('p', 'cm-empty', 'Loading messages…'));
      await loadMessages(false);
    }

    /* --- messages --- */
    async function loadMessages(older) {
      if (s.loading || !s.channel) return;
      s.loading = true;
      const channelSlug = s.channel.slug;
      try {
        const params = new URLSearchParams({ limit: '40' });
        if (older && s.messages[0]) params.set('before', s.messages[0].id);
        const data = await api(`/communities/${slug}/channels/${channelSlug}/messages?${params}`);
        if (s.destroyed || s.channel?.slug !== channelSlug) return;
        s.messages = older ? [...data.items, ...s.messages] : data.items;
        s.hasMore = data.hasMore;
        const before = scroller.scrollHeight;
        drawMessages(older ? 'keep' : 'bottom', before);
      } catch (error) {
        scroller.replaceChildren(el('p', 'cm-empty', error.message || 'Could not load messages.'));
      } finally { s.loading = false; }
    }

    function nearBottom() {
      return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
    }

    function drawMessages(mode = 'auto', previousHeight = 0) {
      const stick = mode === 'bottom' || (mode === 'auto' && nearBottom());
      scroller.replaceChildren();
      if (s.hasMore) {
        const earlier = el('button', 'cm-btn cm-btn--ghost cc-earlier', 'Load earlier messages');
        earlier.type = 'button';
        earlier.addEventListener('click', () => void loadMessages(true));
        scroller.append(earlier);
      }
      if (!s.messages.length) {
        scroller.append(el('div', 'cc-welcome', s.channel?.kind === 'squad'
          ? 'No squad calls yet. Tap 🎮 to ask for players.'
          : `This is the start of #${s.channel?.name || 'chat'}. Say hello.`));
      }
      let previous = null;
      for (const message of s.messages) {
        const created = new Date(message.createdAt);
        if (!previous || new Date(previous.createdAt).toDateString() !== created.toDateString()) {
          const divider = el('div', 'cc-day');
          divider.append(el('span', '', dayLabel(created)));
          scroller.append(divider);
          previous = null;
        }
        const grouped = Boolean(previous && previous.author?.username === message.author?.username && message.kind === 'text' && previous.kind === 'text' && created - new Date(previous.createdAt) < 5 * 60 * 1000 && !message.replyTo);
        scroller.append(messageNode(message, grouped));
        previous = message;
      }
      if (stick) scroller.scrollTop = scroller.scrollHeight;
      else if (mode === 'keep') scroller.scrollTop = scroller.scrollHeight - previousHeight;
    }

    function upsert(message) {
      if (message.channel !== s.channel?.slug) return;
      const index = s.messages.findIndex((item) => item.id === message.id);
      if (index >= 0) s.messages[index] = message; else s.messages.push(message);
      drawMessages('auto');
    }

    function reactionBar(message) {
      const bar = el('div', 'cc-reactions');
      for (const reaction of message.reactions || []) {
        const mineReaction = Boolean(user && reaction.users.includes(user.username));
        const chip = el('button', `cc-reaction${mineReaction ? ' is-mine' : ''}`);
        chip.type = 'button';
        chip.title = reaction.users.slice(0, 8).join(', ');
        chip.append(el('span', '', reaction.emoji), el('span', 'cc-reaction-count', String(reaction.users.length)));
        chip.addEventListener('click', () => void react(message, reaction.emoji));
        bar.append(chip);
      }
      return bar;
    }

    async function react(message, emoji) {
      try { await api(`/communities/${slug}/channels/${message.channel}/messages/${message.id}/reactions`, { method: 'PUT', body: JSON.stringify({ emoji }) }); }
      catch (error) { toast(error.message); }
    }

    function squadCard(message) {
      const squad = message.squad;
      const capacity = squad.slots + 1;
      const full = squad.joined.length >= capacity;
      const inIt = Boolean(user && squad.joined.some((person) => person.username === user.username));
      const host = squad.joined[0];
      const isHost = Boolean(user && host?.username === user.username);
      const info = gameInfo(squad.game);
      const card = el('div', `cc-squad${full ? ' is-full' : ''}`);
      const top = el('div', 'cc-squad-top');
      if (info.cover) {
        const image = el('img', 'cc-squad-cover');
        image.src = `/assets/arcadia/games/${info.cover}`;
        image.alt = '';
        image.addEventListener('error', () => image.remove());
        top.append(image);
      }
      const text = el('div', 'cc-squad-text');
      text.append(el('span', 'cc-squad-kicker', full ? 'Squad full' : `Squad call · needs ${capacity - squad.joined.length} more`), el('strong', 'cc-squad-game', info.cover ? info.title : squad.game));
      const meta = [squad.when].filter(Boolean).join(' · ');
      if (meta) text.append(el('span', 'cc-squad-when', `🕒 ${meta}`));
      top.append(text);
      card.append(top);
      if (squad.note) card.append(el('p', 'cc-squad-note', squad.note));
      const people = el('div', 'cc-squad-people');
      for (const person of squad.joined) {
        const chip = el('span', 'cc-squad-person');
        chip.append(personAvatar(person, 'cm-avatar cm-avatar--sm'), el('span', '', person.username === host?.username ? `${person.displayName || person.username} (host)` : (person.displayName || person.username)));
        people.append(chip);
      }
      for (let slot = squad.joined.length; slot < capacity; slot += 1) people.append(el('span', 'cc-squad-open', 'Open'));
      card.append(people);
      if (!isHost) {
        const button = el('button', `cm-btn ${inIt ? 'cm-btn--ghost' : 'cm-btn--solid'}`, inIt ? 'Leave squad' : (full ? 'Full' : "I'm in"));
        button.type = 'button';
        button.disabled = !inIt && full;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { await api(`/communities/${slug}/channels/${message.channel}/messages/${message.id}/squad`, { method: 'POST', body: JSON.stringify({ join: !inIt }) }); }
          catch (error) { toast(error.message); button.disabled = false; }
        });
        card.append(button);
      }
      return card;
    }

    function messageNode(message, grouped) {
      const mineMessage = Boolean(user && message.author?.username === user.username);
      const node = el('article', `cc-msg${grouped ? ' is-grouped' : ''}${mineMessage ? ' is-mine' : ''}`);
      node.dataset.id = message.id;
      node.append(grouped ? el('span', 'cc-avatar-gap') : personAvatar(message.author, 'cm-avatar cc-avatar'));
      const main = el('div', 'cc-msg-main');
      if (!grouped) {
        const header = el('div', 'cc-msg-head');
        header.append(el('strong', 'cc-msg-name', message.author?.displayName || message.author?.username || 'Player'), el('time', 'cc-msg-time', new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
        main.append(header);
      }
      if (message.replyTo) {
        const reply = el('div', 'cc-replyref');
        reply.append(el('strong', '', `↪ ${message.replyTo.author}`), el('span', '', message.replyTo.snippet));
        main.append(reply);
      }
      if (message.kind === 'squad' && message.squad) main.append(squadCard(message));
      else main.append(el('p', 'cc-msg-text'));
      if (message.kind !== 'squad') main.querySelector('.cc-msg-text').append(mentionNodes(message.body, user?.username));
      if (message.reactions?.length) main.append(reactionBar(message));
      node.append(main);

      const tools = el('div', 'cc-tools');
      const addReaction = el('button', 'cc-tool', '☺');
      addReaction.type = 'button';
      addReaction.title = 'Add reaction';
      addReaction.setAttribute('aria-label', 'Add reaction');
      addReaction.addEventListener('click', (event) => {
        event.stopPropagation();
        scroller.querySelectorAll('.cc-pop').forEach((pop) => pop.remove());
        const pop = el('div', 'cc-pop');
        for (const emoji of REACTIONS) {
          const choice = el('button', 'cc-pop-btn', emoji);
          choice.type = 'button';
          choice.addEventListener('click', () => { pop.remove(); void react(message, emoji); });
          pop.append(choice);
        }
        tools.append(pop);
        const close = () => { pop.remove(); document.removeEventListener('click', close); };
        window.setTimeout(() => document.addEventListener('click', close), 0);
      });
      const reply = el('button', 'cc-tool', '↩');
      reply.type = 'button';
      reply.title = 'Reply';
      reply.setAttribute('aria-label', 'Reply');
      reply.addEventListener('click', () => { s.replyTo = message; paintReply(); input.focus(); });
      tools.append(addReaction, reply);
      if (mineMessage || staff) {
        const del = el('button', 'cc-tool cc-tool--danger', '🗑');
        del.type = 'button';
        del.title = 'Delete message';
        del.setAttribute('aria-label', 'Delete message');
        del.addEventListener('click', async () => {
          try { await api(`/communities/${slug}/channels/${message.channel}/messages/${message.id}`, { method: 'DELETE' }); }
          catch (error) { toast(error.message); }
        });
        tools.append(del);
      }
      node.append(tools);
      return node;
    }

    /* --- composer --- */
    function paintReply() {
      replyBar.replaceChildren();
      replyBar.hidden = !s.replyTo;
      if (!s.replyTo) return;
      const label = el('span', 'cc-replybar-text');
      label.append(el('strong', '', `Replying to ${s.replyTo.author?.displayName || s.replyTo.author?.username || 'message'}`), el('span', '', s.replyTo.kind === 'squad' ? 'Squad call' : s.replyTo.body.slice(0, 80)));
      const cancel = el('button', 'cc-icon-btn cc-icon-btn--small', '×');
      cancel.type = 'button';
      cancel.setAttribute('aria-label', 'Cancel reply');
      cancel.addEventListener('click', () => { s.replyTo = null; paintReply(); });
      replyBar.append(label, cancel);
    }

    function buildSquadForm() {
      squadForm.replaceChildren();
      const games = [...new Set([...(community.games || []), community.game].filter(Boolean))];
      const datalist = el('datalist');
      datalist.id = `cc-games-${slug}`;
      for (const game of games) { const option = el('option'); option.value = gameName(game); datalist.append(option); }
      const game = el('input', 'cm-input');
      game.placeholder = 'Game';
      game.maxLength = 60;
      game.setAttribute('list', datalist.id);
      game.setAttribute('aria-label', 'Game');
      if (games[0]) game.value = gameName(games[0]);
      const slots = el('select', 'cm-select');
      slots.setAttribute('aria-label', 'Players needed');
      for (let count = 1; count <= 9; count += 1) { const option = el('option', '', `Need ${count} more`); option.value = String(count); slots.append(option); }
      slots.value = '3';
      const when = el('input', 'cm-input');
      when.placeholder = 'When? e.g. Tonight 9pm';
      when.maxLength = 40;
      when.setAttribute('aria-label', 'When');
      const note = el('input', 'cm-input');
      note.placeholder = 'Anything else? (rank, mic, mode)';
      note.maxLength = 140;
      note.setAttribute('aria-label', 'Note');
      const actions = el('div', 'cc-squadform-actions');
      const cancel = el('button', 'cm-btn cm-btn--ghost', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => { squadForm.hidden = true; });
      const post = el('button', 'cm-btn cm-btn--solid', 'Post squad call');
      post.type = 'button';
      post.addEventListener('click', async () => {
        if (!game.value.trim()) { toast('Say which game you want to play.'); return; }
        post.disabled = true;
        try {
          const data = await api(`/communities/${slug}/channels/${s.channel.slug}/messages`, {
            method: 'POST',
            body: JSON.stringify({ squad: { game: game.value.trim(), slots: Number(slots.value), when: when.value.trim(), note: note.value.trim() } })
          });
          upsert(data.message);
          squadForm.hidden = true;
          when.value = note.value = '';
        } catch (error) { toast(error.message); }
        finally { post.disabled = false; }
      });
      actions.append(cancel, post);
      squadForm.append(el('strong', 'cc-squadform-title', 'Start a squad call'), datalist, game, slots, when, note, actions);
    }
    squadToggle.addEventListener('click', () => {
      if (squadForm.hidden) buildSquadForm();
      squadForm.hidden = !squadForm.hidden;
    });

    async function submitMessage(event) {
      event.preventDefault();
      const body = input.value.trim();
      if (!body || !s.channel) return;
      send.disabled = true;
      try {
        const data = await api(`/communities/${slug}/channels/${s.channel.slug}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body, replyTo: s.replyTo?.id || undefined })
        });
        input.value = '';
        input.style.height = 'auto';
        s.replyTo = null;
        paintReply();
        upsert(data.message);
        scroller.scrollTop = scroller.scrollHeight;
      } catch (error) { toast(error.message || 'Message could not be sent.'); }
      finally { send.disabled = !input.value.trim(); input.focus(); }
    }
    composerForm.addEventListener('submit', submitMessage);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composerForm.requestSubmit(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
      send.disabled = !input.value.trim();
      const now = Date.now();
      if (s.socket?.connected && s.channel && now - s.lastTypingSent > 2000) {
        s.lastTypingSent = now;
        s.socket.emit('community:typing', { slug, channel: s.channel.slug });
      }
    });

    function paintTyping() {
      const names = [...s.typing.keys()];
      typingLine.textContent = !names.length ? '' : names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : 'Several people are typing…';
    }

    /* --- realtime --- */
    function connect() {
      const socket = io({ path: '/socket.io/', transports: ['websocket', 'polling'], withCredentials: true, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000 });
      s.socket = socket;
      socket.on('connect', () => socket.emit('community:subscribe', { slug }));
      socket.on('community:presence', (payload) => {
        if (payload.slug !== slug) return;
        s.online = payload.online;
        drawHead();
      });
      socket.on('community:message', (payload) => {
        if (payload.slug !== slug) return;
        if (payload.channel !== s.channel?.slug) {
          s.unread.add(payload.channel);
          drawRail();
          return;
        }
        upsert(payload.message);
        const who = payload.message.author?.displayName || payload.message.author?.username;
        if (who && s.typing.has(who)) { window.clearTimeout(s.typing.get(who)); s.typing.delete(who); paintTyping(); }
      });
      socket.on('community:message:update', (payload) => { if (payload.slug === slug) upsert(payload.message); });
      socket.on('community:message:delete', (payload) => {
        if (payload.slug !== slug || payload.channel !== s.channel?.slug) return;
        s.messages = s.messages.filter((message) => message.id !== payload.id);
        drawMessages('auto');
      });
      socket.on('community:channels', (payload) => { if (payload.slug === slug) void loadChannels().then(() => { if (!s.channels.some((channel) => channel.slug === s.channel?.slug)) void selectChannel(s.channels[0]?.slug); }); });
      socket.on('community:typing', (payload) => {
        if (payload.slug !== slug || payload.channel !== s.channel?.slug || payload.username === user?.username) return;
        window.clearTimeout(s.typing.get(payload.username));
        s.typing.set(payload.username, window.setTimeout(() => { s.typing.delete(payload.username); paintTyping(); }, 3500));
        paintTyping();
      });
    }

    return {
      async start() {
        try {
          await loadChannels();
          if (s.destroyed) return;
          connect();
          await selectChannel(state.route.channel);
        } catch (error) {
          shell.replaceChildren(errorBlock(error.message || 'The chat could not be opened.', 'Back to posts'));
          shell.querySelector('button')?.addEventListener('click', () => { state.route.tab = 'posts'; void renderCommunity(); });
        }
      },
      destroy() {
        s.destroyed = true;
        s.typing.forEach((timer) => window.clearTimeout(timer));
        if (s.socket) {
          s.socket.emit('community:unsubscribe', { slug });
          s.socket.disconnect();
          s.socket = null;
        }
      }
    };
  }

  /* ---------- Profile section ---------- */

  async function renderProfileSection(host, username, isSelf) {
    host.replaceChildren(el('p', 'cm-empty cm-empty--small', 'Loading communities…'));
    let items = [];
    try { items = (await api(`/communities/of/${encodeURIComponent(username)}`)).items || []; }
    catch (error) { host.replaceChildren(el('p', 'cm-empty cm-empty--small', error.message || 'Could not load communities.')); return; }

    host.replaceChildren();
    const wrap = el('div', 'cm-profile');
    if (isSelf) {
      const bar = el('div', 'cm-profile-bar');
      const browse = el('button', 'cm-btn cm-btn--ghost', 'Browse communities');
      browse.type = 'button';
      browse.addEventListener('click', () => { state.route = { name: 'explore' }; navigate('groups'); });
      const create = el('button', 'cm-btn cm-btn--solid', '+ Create');
      create.type = 'button';
      create.addEventListener('click', () => openCreate());
      bar.append(browse, create);
      wrap.append(bar);
    }
    if (!items.length) {
      wrap.append(emptyState(
        isSelf ? 'You have not joined any communities' : 'No communities yet',
        isSelf ? 'Join communities for the games you play, or start your own.' : 'This player has not joined any public communities.'
      ));
    } else {
      const list = el('div', 'cm-mini-list');
      for (const item of items) {
        const row = el('button', 'cm-mini');
        row.type = 'button';
        row.style.setProperty('--cm-accent', item.accent || '#68d6bd');
        const text = el('span', 'cm-mini-text');
        text.append(el('span', 'cm-mini-name', item.name), el('span', 'cm-mini-meta', `c/${item.slug} · ${plural(item.memberCount || 0, 'member')}`));
        row.append(communityIcon(item), text, el('span', `cm-role cm-role--${item.role}`, ROLE_LABEL[item.role] || 'Member'));
        row.addEventListener('click', () => open_(item.slug));
        list.append(row);
      }
      wrap.append(list);
    }
    host.append(wrap);
  }

  function reset() {
    teardownChat();
    state.joined = null;
    state.route = { name: 'explore' };
    state.gameFilter = '';
    if (root) root.replaceChildren();
  }

  // Opens the explore page, optionally filtered to one game.
  function openExplore({ game = '' } = {}) {
    state.route = { name: 'explore' };
    state.gameFilter = game;
    state.term = '';
    state.genre = 'all';
    state.exploreTab = 'discover';
    navigate('groups');
  }

  return { show, open: open_, openCreate, openExplore, renderProfileSection, reset };
}
