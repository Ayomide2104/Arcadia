/*
  Arcadia Games page.
    1. A carousel of banners for the most picked games. The write-up shows
       on hover (desktop) or when you tap a banner (phones).
    2. "Popular right now": compact cards, each with a plus underneath.
    3. "All games": everything else.
  Clicking a game opens the shared detail page (arcDetailPage).
  "Popular" comes from GET /games?sort=popular (picks counted everywhere).
*/

const GENRE_LABELS = {
  sports: 'Sports', fps: 'FPS', rpg: 'RPG', 'battle-royale': 'Battle royale', racing: 'Racing',
  strategy: 'Strategy', fighting: 'Fighting', simulation: 'Simulation', adventure: 'Adventure',
  party: 'Party', casual: 'Casual', action: 'Action', arcade: 'Arcade', shooter: 'Shooter',
  football: 'Football', 'tactical-shooter': 'Tactical', 'action-rpg': 'Action RPG'
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const formatCount = (value) => {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
};

const monogram = (name) => name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase();

export function createGames({ api, getUser, toast, openAuth, gameInfo, gameTheme, gameFont, detailPage, openCommunity, createCommunity, findCommunities, navigate }) {
  const state = {
    games: [],
    loadedAt: 0,
    genre: 'all',
    term: '',
    detail: null,
    pendingOpen: null,
    scrollY: 0
  };
  let root = null;
  let autoTimer = null;

  /* ---------- Helpers ---------- */

  const mine = () => new Set(getUser()?.favoriteGames || []);

  function describe(game) {
    const info = gameInfo(game.name);
    const known = Boolean(info.cover || info.banner);
    return {
      info,
      title: known ? info.title : game.name,
      genre: known ? info.genre : (game.genres || []).map((id) => GENRE_LABELS[id] || id).slice(0, 2).join(' · '),
      cover: info.cover ? `/assets/arcadia/games/${info.cover}` : `/assets/arcadia/games/${game.slug}.jpg`,
      banner: info.banner ? `/assets/arcadia/games/${info.banner}` : ''
    };
  }

  function mountRoot() {
    const view = document.querySelector('#view-games');
    if (!view) return null;
    if (!root || !root.isConnected) {
      root = el('div', 'gp');
      view.append(root);
    }
    return root;
  }

  async function ensureGames(force = false) {
    if (!force && state.games.length && Date.now() - state.loadedAt < 30000) return;
    const data = await api('/games?sort=popular&limit=100');
    state.games = data.items || [];
    state.loadedAt = Date.now();
  }

  function stopAuto() {
    window.clearInterval(autoTimer);
    autoTimer = null;
  }

  /* ---------- Add / remove from my games ---------- */

  async function toggleMine(game, button, onChange) {
    const user = getUser();
    if (!user) { openAuth({ type: 'game-interest', slug: game.slug }); return; }
    const has = (user.favoriteGames || []).includes(game.slug);
    button.disabled = true;
    try {
      await api(`/games/${game.slug}/interest`, { method: 'PUT', body: JSON.stringify({ interested: !has }) });
      user.favoriteGames = has
        ? (user.favoriteGames || []).filter((slug) => slug !== game.slug)
        : [...new Set([...(user.favoriteGames || []), game.slug])];
      game.picks = Math.max(0, (game.picks || 0) + (has ? -1 : 1));
      toast(has ? `${describe(game).title} removed from your games.` : `${describe(game).title} added to your games.`);
      if (onChange) onChange(!has);
    } catch (error) {
      toast(error.message || 'Could not update your games.');
    } finally {
      button.disabled = false;
    }
  }

  function plusButton(game, className = 'gp-plus') {
    const button = el('button', className);
    button.type = 'button';
    const paint = () => {
      const has = mine().has(game.slug);
      const { title } = describe(game);
      button.classList.toggle('is-added', has);
      button.setAttribute('aria-pressed', String(has));
      button.setAttribute('aria-label', has ? `Remove ${title} from my games` : `Add ${title} to my games`);
      const long = className.includes('gp-btn--solid') && className.includes('gp-plus-inline');
      button.replaceChildren(el('span', 'gp-plus-icon', has ? '✓' : '+'), el('span', 'gp-plus-text', has ? (long ? 'In my games' : 'Added') : (long ? 'Add to my games' : 'Add')));
    };
    paint();
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void toggleMine(game, button, () => {
        // Keep every button for this game in step (hero, cards, details).
        document.querySelectorAll(`[data-game-plus="${game.slug}"]`).forEach((node) => node.dispatchEvent(new CustomEvent('gp:paint')));
      });
    });
    button.dataset.gamePlus = game.slug;
    button.addEventListener('gp:paint', paint);
    return button;
  }

  /* ---------- Banner carousel ---------- */

  function pickSlides() {
    const withBanner = state.games.filter((game) => describe(game).banner);
    const slides = withBanner.slice(0, 5);
    if (slides.length < 3) {
      for (const game of state.games) {
        if (slides.length >= 5) break;
        if (!slides.includes(game)) slides.push(game);
      }
    }
    return slides;
  }

  function slide(game, index, total) {
    const { info, title, genre, banner, cover } = describe(game);
    const theme = gameTheme(info);
    const canHover = window.matchMedia('(hover: hover)').matches;

    const node = el('article', 'gp-slide');
    node.tabIndex = 0;
    node.setAttribute('role', 'group');
    node.setAttribute('aria-roledescription', 'slide');
    node.setAttribute('aria-label', `${index + 1} of ${total}: ${title}`);
    node.style.setProperty('--gp-accent', theme.accent);
    node.style.backgroundColor = theme.background;
    if (banner) {
      const probe = new Image();
      probe.onload = () => { node.style.backgroundImage = `url("${banner}")`; };
      probe.onerror = () => node.classList.add('is-posterless');
      probe.src = banner;
    } else {
      const poster = el('img', 'gp-slide-poster');
      poster.src = cover;
      poster.alt = '';
      poster.addEventListener('error', () => poster.remove());
      node.append(poster);
    }

    const rank = el('span', 'gp-rank', index === 0 ? '#1 most picked' : `#${index + 1} popular`);
    const caption = el('div', 'gp-slide-caption');
    caption.append(el('h3', 'gp-slide-title', title));
    const metaParts = [genre];
    if (game.picks > 0) metaParts.push(`${formatCount(game.picks)} picks`);
    caption.append(el('p', 'gp-slide-meta', metaParts.filter(Boolean).join(' · ')));

    // Write-up: hover on desktop, tap on phones.
    const more = el('div', 'gp-slide-more');
    more.append(el('h3', 'gp-slide-title', title), el('p', 'gp-slide-meta', metaParts.filter(Boolean).join(' · ')), el('p', 'gp-slide-desc', info.description));
    const actions = el('div', 'gp-slide-actions');
    const open = el('button', 'gp-btn gp-btn--solid', 'Open game');
    open.type = 'button';
    open.addEventListener('click', (event) => { event.stopPropagation(); void openGame(game); });
    actions.append(open, plusButton(game, 'gp-btn gp-btn--ghost gp-plus-inline'));
    more.append(actions);

    node.append(rank, caption, more);
    node.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      if (canHover) { void openGame(game); return; }
      const wasOpen = node.classList.contains('is-open');
      node.parentElement.querySelectorAll('.gp-slide.is-open').forEach((other) => other.classList.remove('is-open'));
      node.classList.toggle('is-open', !wasOpen);
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target === node) void openGame(game);
    });
    return node;
  }

  function carousel() {
    const slides = pickSlides();
    if (!slides.length) return null;

    const section = el('section', 'gp-hero');
    section.setAttribute('role', 'region');
    section.setAttribute('aria-roledescription', 'carousel');
    section.setAttribute('aria-label', 'Most picked games');

    const track = el('div', 'gp-track');
    slides.forEach((game, index) => track.append(slide(game, index, slides.length)));

    const prev = el('button', 'gp-arrow gp-arrow--prev', '‹');
    const next = el('button', 'gp-arrow gp-arrow--next', '›');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous banner');
    next.setAttribute('aria-label', 'Next banner');

    const dots = el('div', 'gp-dots');
    const dotNodes = slides.map((_, index) => {
      const dot = el('button', 'gp-dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Go to banner ${index + 1}`);
      dot.addEventListener('click', () => goTo(index));
      dots.append(dot);
      return dot;
    });

    const slideStep = () => {
      const first = track.firstElementChild;
      return first ? first.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0) : track.clientWidth;
    };
    const current = () => Math.min(slides.length - 1, Math.max(0, Math.round(track.scrollLeft / slideStep())));
    function goTo(index) {
      const target = (index + slides.length) % slides.length;
      track.scrollTo({ left: target * slideStep(), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    function paintDots() {
      const index = current();
      dotNodes.forEach((dot, position) => dot.classList.toggle('is-current', position === index));
    }
    track.addEventListener('scroll', () => window.requestAnimationFrame(paintDots), { passive: true });
    prev.addEventListener('click', () => { stopAuto(); goTo(current() - 1); });
    next.addEventListener('click', () => { stopAuto(); goTo(current() + 1); });
    section.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') { stopAuto(); goTo(current() + 1); }
      if (event.key === 'ArrowLeft') { stopAuto(); goTo(current() - 1); }
    });
    for (const type of ['pointerdown', 'focusin', 'mouseenter', 'touchstart']) section.addEventListener(type, stopAuto, { passive: true });

    section.append(track, prev, next, dots);
    paintDots();

    // Gentle auto-advance until the person interacts with it.
    stopAuto();
    if (slides.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      autoTimer = window.setInterval(() => {
        if (!section.isConnected || section.offsetParent === null) { stopAuto(); return; }
        goTo(current() + 1);
      }, 6500);
    }
    return section;
  }

  /* ---------- Compact cards ---------- */

  function card(game, rank) {
    const { title, genre, cover } = describe(game);
    const wrap = el('article', 'gp-card');

    const open = el('button', 'gp-card-open');
    open.type = 'button';
    open.setAttribute('aria-label', `Open ${title}`);
    const art = el('span', 'gp-card-art');
    const image = el('img', 'gp-card-img');
    image.src = cover;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => { image.remove(); art.classList.add('is-missing'); art.append(el('span', 'gp-card-mono', monogram(title))); });
    art.append(image);
    if (rank) art.append(el('span', 'gp-card-rank', `#${rank}`));
    const meta = el('span', 'gp-card-meta');
    meta.append(el('span', 'gp-card-name', title));
    const sub = [genre.split('·')[0].trim()];
    if (game.picks > 0) sub.push(`${formatCount(game.picks)} picks`);
    meta.append(el('span', 'gp-card-sub', sub.filter(Boolean).join(' · ')));
    open.append(art, meta);
    open.addEventListener('click', () => { void openGame(game); });

    wrap.append(open, plusButton(game));
    return wrap;
  }

  function cardGrid(games, rankOffset) {
    const grid = el('div', 'gp-grid');
    games.forEach((game, index) => grid.append(card(game, rankOffset ? index + 1 : 0)));
    return grid;
  }

  function section(title, note, content) {
    const wrap = el('section', 'gp-section');
    const head = el('div', 'gp-section-head');
    head.append(el('h2', 'gp-section-title', title));
    if (note) head.append(el('span', 'gp-section-note', note));
    wrap.append(head, content);
    return wrap;
  }

  /* ---------- List page ---------- */

  function filtered() {
    const term = state.term.trim().toLowerCase();
    return state.games.filter((game) => {
      if (state.genre !== 'all' && !(game.genres || []).includes(state.genre)) return false;
      if (!term) return true;
      return game.name.toLowerCase().includes(term) || (game.aliases || []).some((alias) => alias.toLowerCase().includes(term));
    });
  }

  function renderList() {
    const host = mountRoot();
    if (!host) return;
    stopAuto();
    host.replaceChildren();

    const head = el('header', 'gp-head');
    const titles = el('div', 'gp-titles');
    titles.append(el('h1', 'gp-title', 'Games'), el('p', 'gp-sub', 'See what everyone is playing, and add your own.'));
    const search = el('input', 'gp-search');
    search.type = 'search';
    search.placeholder = 'Search games';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', 'Search games');
    search.value = state.term;
    head.append(titles, search);

    const chips = el('div', 'gp-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Filter by genre');
    const counts = new Map();
    for (const game of state.games) for (const id of game.genres || []) counts.set(id, (counts.get(id) || 0) + 1);
    const ids = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 9);
    for (const id of ['all', ...ids]) {
      const chip = el('button', 'gp-chip', id === 'all' ? 'All' : (GENRE_LABELS[id] || id));
      chip.type = 'button';
      chip.classList.toggle('is-selected', state.genre === id);
      chip.setAttribute('aria-pressed', String(state.genre === id));
      chip.addEventListener('click', () => { state.genre = id; renderBody(); paintChips(); });
      chips.append(chip);
    }
    function paintChips() {
      [...chips.children].forEach((chip, index) => {
        const id = ['all', ...ids][index];
        chip.classList.toggle('is-selected', state.genre === id);
        chip.setAttribute('aria-pressed', String(state.genre === id));
      });
    }

    const body = el('div', 'gp-body');
    host.append(head, chips, body);

    function renderBody() {
      stopAuto();
      body.replaceChildren();
      if (!state.games.length) {
        body.append(el('p', 'gp-empty', 'No games are available yet. Check back soon.'));
        return;
      }
      const list = filtered();
      const searching = Boolean(state.term.trim()) || state.genre !== 'all';

      if (searching) {
        if (!list.length) { body.append(el('p', 'gp-empty', 'No games match. Try another search or genre.')); return; }
        body.append(section('Results', `${list.length} ${list.length === 1 ? 'game' : 'games'}`, cardGrid(list, 0)));
        return;
      }

      const hero = carousel();
      if (hero) body.append(hero);

      const popular = state.games.slice(0, 10);
      const anyPicks = popular.some((game) => game.picks > 0);
      body.append(section(anyPicks ? 'Popular right now' : 'Featured games', anyPicks ? 'Most picked by players' : '', cardGrid(popular, true)));

      const rest = state.games.slice(10).sort((a, b) => a.name.localeCompare(b.name));
      if (rest.length) body.append(section('All games', `${rest.length} more`, cardGrid(rest, 0)));
    }

    let timer = null;
    search.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { state.term = search.value; renderBody(); }, 150);
    });
    renderBody();
  }

  /* ---------- Detail page ---------- */

  async function openGame(game) {
    const host = mountRoot();
    if (!host) return;
    stopAuto();
    state.scrollY = window.scrollY;
    state.detail = game.slug;
    const { info, title, genre, cover, banner } = describe(game);
    const theme = gameTheme(info);

    let detail = { game, communities: [] };
    try { detail = await api(`/games/${encodeURIComponent(game.slug)}`); } catch { /* fall back to what we have */ }
    const picks = detail.game?.picks ?? game.picks ?? 0;

    const find = el('button', 'gp-btn gp-btn--ghost', 'Find communities');
    find.type = 'button';
    find.addEventListener('click', () => findCommunities(game.slug));
    const actions = [plusButton(game, 'gp-btn gp-btn--solid gp-plus-inline'), find];

    const extra = el('section', 'gp-communities');
    extra.append(el('h2', 'gp-section-title', `Communities for ${title}`));
    const list = el('div', 'gp-community-list');
    if (detail.communities?.length) {
      for (const community of detail.communities) {
        const row = el('button', 'gp-community');
        row.type = 'button';
        row.style.setProperty('--gp-accent', community.accent || theme.accent);
        row.append(
          el('span', 'gp-community-icon', monogram(community.name)),
          el('span', 'gp-community-text', community.official ? `${community.name} · Official` : community.name),
          el('span', 'gp-community-count', `${community.memberCount || 0} members`)
        );
        row.addEventListener('click', () => openCommunity(community.slug));
        list.append(row);
      }
    } else {
      list.append(el('p', 'gp-empty gp-empty--small', 'No community for this game yet.'));
    }
    const make = el('button', 'gp-btn gp-btn--ghost', 'Start a community for this game');
    make.type = 'button';
    make.addEventListener('click', () => createCommunity({ games: [game.slug] }));
    extra.append(list, make);

    host.replaceChildren(detailPage({
      title,
      kicker: genre,
      description: info.description,
      facts: [
        ['Developer', info.developer],
        ['Platforms', info.platforms],
        ['Picked by players', picks > 0 ? `${formatCount(picks)} picks` : 'Be the first to pick it']
      ],
      banner,
      poster: cover,
      accent: theme.accent,
      heroColor: theme.background,
      titleFont: gameFont(title),
      backLabel: 'Back to games',
      actions,
      extra,
      onBack: () => { state.detail = null; renderList(); window.scrollTo({ top: state.scrollY }); }
    }));
    window.scrollTo({ top: 0 });
  }

  /* ---------- Public API ---------- */

  async function show() {
    const host = mountRoot();
    if (!host) return;
    state.detail = null;
    if (!state.games.length) host.replaceChildren(el('p', 'gp-empty', 'Loading games…'));
    try {
      await ensureGames();
      const wanted = state.pendingOpen ? state.games.find((item) => item.slug === state.pendingOpen) : null;
      state.pendingOpen = null;
      if (wanted) await openGame(wanted);
      else renderList();
    } catch (error) {
      host.replaceChildren(el('p', 'gp-empty', error.message || 'Could not load games.'));
    }
  }

  // Opens a game page from anywhere (for example a community's focus chips).
  function openBySlug(slug) {
    state.pendingOpen = slug;
    navigate('games');
  }

  function reset() {
    state.detail = null;
    state.games = [];
    stopAuto();
  }

  return { show, openGame: openBySlug, reset };
}
