/* Arcadia full-page onboarding: interests -> games -> communities -> profile.
   Uses the same API calls as before (PATCH /auth/profile) and the
   database-driven catalogue (GET /games). No profile photo here:
   photos belong in Edit profile. */

const GAME_IMG = (slug) => `/assets/arcadia/games/${slug}.jpg`;

const GENRES = [
  { id: 'sports', label: 'Sports & football', blurb: 'Football, basketball and every match worth bragging about.', games: ['fc-mobile', 'efootball', 'ea-sports-fc'] },
  { id: 'fps', label: 'FPS & tactical shooters', blurb: 'Fast aim, tight teamwork and clutch rounds.', games: ['call-of-duty-mobile', 'valorant', 'rainbow-six-siege'] },
  { id: 'rpg', label: 'RPG & action RPG', blurb: 'Deep worlds, big builds and stories that last.', games: ['genshin-impact', 'elden-ring', 'league-of-legends'] },
  { id: 'battle-royale', label: 'Battle royale', blurb: 'Drop in, loot up and be the last squad standing.', games: ['pubg-mobile', 'free-fire', 'fortnite'] },
  { id: 'racing', label: 'Racing', blurb: 'Tune it, drift it and take the podium.', games: ['asphalt-legends-unite', 'forza-horizon-5', 'rocket-league'] },
  { id: 'strategy', label: 'Strategy', blurb: 'Outthink, outplay and win the late game.', games: ['dota-2', 'league-of-legends'] },
  { id: 'fighting', label: 'Fighting', blurb: 'One-on-one duels, combos and rivalries.', games: ['tekken-8'] },
  { id: 'simulation', label: 'Simulation', blurb: 'Build, manage and live a different life.', games: ['minecraft', 'the-sims-4', 'stardew-valley'] },
  { id: 'adventure', label: 'Adventure', blurb: 'Explore open worlds and go where the map ends.', games: ['gta-v', 'roblox', 'minecraft'] },
  { id: 'party', label: 'Casual & party', blurb: 'Easy games to play with friends, any time.', games: ['among-us', 'roblox', 'minecraft'] },
];

const STEPS = ['Interests', 'Games', 'Communities', 'Profile'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cover(slug, className) {
  const img = el('img', className);
  img.src = GAME_IMG(slug);
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => img.classList.add('is-missing'));
  return img;
}

export function createOnboarding({ api, getUser, setUser, onFinish }) {
  function start() {
    const user = getUser();
    if (!user) return;

    let page = document.querySelector('#onboarding-dialog');
    if (page) page.remove();
    page = el('dialog', 'ob-page');
    page.id = 'onboarding-dialog';
    page.setAttribute('aria-labelledby', 'ob-title');
    page.addEventListener('cancel', (event) => event.preventDefault());
    document.body.append(page);

    const state = {
      step: 1,
      genres: [...(user.genres || [])],
      games: [...(user.favoriteGames || [])],
      displayName: user.displayName || '',
      bio: user.bio || '',
      catalogue: null,
      joined: new Set(),
      busy: false,
    };

    const header = el('header', 'ob-header');
    const brand = el('div', 'ob-brand');
    const logo = el('img');
    logo.src = '/assets/arcadia/brand/logo-mark.svg';
    logo.alt = '';
    brand.append(logo, el('span', '', 'Arcadia'));
    const progress = el('ol', 'ob-progress');
    progress.setAttribute('aria-label', 'Setup progress');
    header.append(brand, progress);

    const main = el('main', 'ob-main');
    const footer = el('footer', 'ob-footer');
    const shell = el('div', 'ob-shell');
    shell.append(header, main, footer);
    page.append(shell);

    function renderProgress() {
      progress.replaceChildren();
      STEPS.forEach((name, index) => {
        const item = el('li', 'ob-progress__item');
        if (index + 1 === state.step) { item.classList.add('is-current'); item.setAttribute('aria-current', 'step'); }
        if (index + 1 < state.step) item.classList.add('is-done');
        item.append(el('span', 'ob-progress__dot', String(index + 1)), el('span', 'ob-progress__label', name));
        progress.append(item);
      });
    }

    /* ---------- Step 1: interests ---------- */
    function renderInterests() {
      main.replaceChildren();
      main.append(el('h1', '', 'What do you play?'), el('p', 'ob-sub', 'Pick the types of games you enjoy. We use this to shape your feed.'));
      const grid = el('div', 'ob-genres');
      for (const genre of GENRES) {
        const card = el('button', 'ob-genre');
        card.type = 'button';
        const selected = state.genres.includes(genre.id);
        card.classList.toggle('is-selected', selected);
        card.setAttribute('aria-pressed', String(selected));

        const deck = el('div', 'ob-deck');
        deck.setAttribute('aria-hidden', 'true');
        genre.games.forEach((slug, index) => {
          const mid = (genre.games.length - 1) / 2;
          const piece = cover(slug, 'ob-deck__card');
          piece.style.setProperty('--i', String(index - mid));
          deck.append(piece);
        });
        const check = el('span', 'ob-check', '✓');
        check.setAttribute('aria-hidden', 'true');
        const body = el('div', 'ob-genre__body');
        body.append(el('h3', '', genre.label), el('p', '', genre.blurb));
        card.append(check, deck, body);

        card.addEventListener('click', () => {
          const on = !state.genres.includes(genre.id);
          state.genres = on ? [...state.genres, genre.id] : state.genres.filter((id) => id !== genre.id);
          card.classList.toggle('is-selected', on);
          card.setAttribute('aria-pressed', String(on));
          renderFooter();
        });
        grid.append(card);
      }
      main.append(grid);
    }

    /* ---------- Step 2: games ---------- */
    async function loadCatalogue() {
      if (state.catalogue) return state.catalogue;
      const data = await api('/games?limit=50');
      state.catalogue = data.items || [];
      return state.catalogue;
    }

    function renderGames() {
      main.replaceChildren();
      main.append(el('h1', '', 'Choose your games'), el('p', 'ob-sub', 'Tap the games you play. The first one you pick becomes your profile banner. You can pick up to 20 and change them later.'));

      const search = el('input', 'ob-search');
      search.type = 'search';
      search.placeholder = 'Search for a game';
      search.setAttribute('aria-label', 'Search for a game');
      search.autocomplete = 'off';
      const results = el('div', 'ob-games-wrap');
      results.append(el('p', 'ob-empty', 'Loading games…'));
      main.append(search, results);

      const buttons = new Map();

      function gameCard(game) {
        const card = el('button', 'ob-game');
        card.type = 'button';
        const selected = state.games.includes(game.slug);
        card.classList.toggle('is-selected', selected);
        card.setAttribute('aria-pressed', String(selected));
        card.dataset.slug = game.slug;

        // A small deck: this game on top, two games from the same category behind it.
        const entry = GENRES.find((genre) => genre.games.includes(game.slug))
          || GENRES.find((genre) => (game.genres || []).includes(genre.id));
        const related = entry ? entry.games.filter((slug) => slug !== game.slug).slice(0, 2) : [];
        const deck = el('div', 'ob-deck ob-deck--game');
        deck.setAttribute('aria-hidden', 'true');
        related.forEach((slug, index) => {
          const piece = cover(slug, 'ob-deck__card ob-deck__card--back');
          piece.style.setProperty('--i', String(index === 0 ? -1 : 1));
          deck.append(piece);
        });
        const main = cover(game.slug, 'ob-deck__card ob-deck__card--main');
        main.style.setProperty('--i', '0');
        deck.append(main);

        const check = el('span', 'ob-check', '✓');
        check.setAttribute('aria-hidden', 'true');
        const labels = (game.genres || [])
          .map((id) => GENRES.find((genre) => genre.id === id)?.label)
          .filter(Boolean)
          .slice(0, 2);
        const body = el('div', 'ob-game__body');
        body.append(el('h3', '', game.name));
        if (labels.length) body.append(el('p', '', labels.join(' · ')));
        card.append(check, deck, body);

        card.addEventListener('click', () => {
          const on = !state.games.includes(game.slug);
          if (on && state.games.length >= 20) { footerNote('You can pick up to 20 games.'); return; }
          state.games = on ? [...state.games, game.slug] : state.games.filter((slug) => slug !== game.slug);
          for (const node of buttons.get(game.slug) || []) {
            node.classList.toggle('is-selected', on);
            node.setAttribute('aria-pressed', String(on));
          }
          footerNote('');
          renderFooter();
        });
        if (!buttons.has(game.slug)) buttons.set(game.slug, []);
        buttons.get(game.slug).push(card);
        return card;
      }

      function section(title, games) {
        const wrap = el('section', 'ob-section');
        wrap.append(el('h2', '', title));
        const grid = el('div', 'ob-games');
        for (const game of games) grid.append(gameCard(game));
        wrap.append(grid);
        return wrap;
      }

      function draw() {
        buttons.clear();
        results.replaceChildren();
        const all = state.catalogue || [];
        const term = search.value.trim().toLowerCase();
        if (!all.length) {
          results.append(el('p', 'ob-empty', 'No games are available yet. You can skip this step and add games later.'));
          return;
        }
        if (term) {
          const hits = all.filter((game) => game.name.toLowerCase().includes(term) || (game.aliases || []).some((alias) => alias.toLowerCase().includes(term)));
          if (!hits.length) { results.append(el('p', 'ob-empty', `No games match “${search.value.trim()}”.`)); return; }
          results.append(section(`Results for “${search.value.trim()}”`, hits));
          return;
        }
        const matches = all.filter((game) => (game.genres || []).some((id) => state.genres.includes(id)));
        const rest = all.filter((game) => !matches.includes(game));
        if (matches.length) results.append(section('Suggested for you', matches));
        if (rest.length) results.append(section(matches.length ? 'More popular games' : 'Popular games', rest));
      }

      let timer = null;
      search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 120); });

      loadCatalogue().then(draw).catch((error) => {
        results.replaceChildren(el('p', 'ob-empty', error.message || 'Could not load games.'));
      });
    }

    /* ---------- Step 3: communities ---------- */
    const initialsOf = (name) => String(name).split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase();

    function communityCard(community) {
      const card = el('article', 'ob-comm');
      card.style.setProperty('--ob-tint', community.accent || '#68d6bd');
      const icon = el('span', 'ob-comm__icon');
      const focus = (community.games && community.games[0]) || community.game;
      if (focus) {
        const image = cover(focus, 'ob-comm__img');
        image.addEventListener('error', () => { image.remove(); icon.textContent = initialsOf(community.name); });
        icon.append(image);
      } else icon.textContent = initialsOf(community.name);

      const text = el('div', 'ob-comm__text');
      const heading = el('h3', '', community.name);
      if (community.official) heading.append(el('span', 'ob-official', 'Official'));
      text.append(heading, el('p', 'ob-comm__meta', `${community.memberCount || 0} ${community.memberCount === 1 ? 'member' : 'members'}`));
      const why = [...(community.match?.games || []).map((slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')), ...(community.match?.genres || []).map((id) => GENRES.find((g) => g.id === id)?.label).filter(Boolean)];
      if (why.length) text.append(el('p', 'ob-comm__why', `Because you picked ${why.slice(0, 2).join(' & ')}`));
      else if (community.description) text.append(el('p', 'ob-comm__why', community.description));

      const button = el('button', 'ob-btn ob-comm__join');
      button.type = 'button';
      const paint = () => {
        const on = state.joined.has(community.slug);
        button.textContent = on ? 'Joined' : 'Join';
        button.classList.toggle('is-joined', on);
        button.setAttribute('aria-pressed', String(on));
        button.setAttribute('aria-label', `${on ? 'Leave' : 'Join'} ${community.name}`);
      };
      paint();
      button.addEventListener('click', async () => {
        const on = state.joined.has(community.slug);
        button.disabled = true;
        try {
          await api(`/communities/${community.slug}/join`, { method: on ? 'DELETE' : 'POST' });
          if (on) state.joined.delete(community.slug); else state.joined.add(community.slug);
          footerNote('');
          paint();
          renderFooter();
        } catch (error) {
          footerNote(error.message || 'Could not update that community.');
        } finally { button.disabled = false; }
      });
      card.append(icon, text, button);
      return card;
    }

    function renderCommunities() {
      main.replaceChildren();
      main.append(el('h1', '', 'Find your people'), el('p', 'ob-sub', 'Join communities for the games and genres you picked. Say hello, find a squad, and leave any time.'));
      const list = el('div', 'ob-comms');
      list.append(el('p', 'ob-empty', 'Finding communities…'));
      main.append(list);
      api('/communities/suggested').then((data) => {
        list.replaceChildren();
        const items = data.items || [];
        if (!items.length) {
          list.append(el('p', 'ob-empty', 'There are no communities to suggest yet. You can create your own from the Communities page.'));
          return;
        }
        if (data.fallback) main.insertBefore(el('p', 'ob-note-line', 'We could not match your picks yet, so here are some popular communities.'), list);
        for (const community of items) list.append(communityCard(community));
      }).catch((error) => {
        list.replaceChildren(el('p', 'ob-empty', error.message || 'Could not load communities. You can skip this step.'));
      });
    }

    /* ---------- Step 4: profile ---------- */
    function renderProfile() {
      main.replaceChildren();
      main.append(el('h1', '', 'Your player card'), el('p', 'ob-sub', 'Tell people who you are. You can add a profile photo any time from Edit profile.'));
      const form = el('div', 'ob-form');
      const nameLabel = el('label', '', 'Display name');
      nameLabel.htmlFor = 'ob-name';
      const name = el('input');
      name.id = 'ob-name';
      name.maxLength = 40;
      name.autocomplete = 'nickname';
      name.placeholder = 'What should people call you?';
      name.value = state.displayName;
      name.addEventListener('input', () => { state.displayName = name.value; });
      const bioLabel = el('label', '', 'Short bio (optional)');
      bioLabel.htmlFor = 'ob-bio';
      const bio = el('textarea');
      bio.id = 'ob-bio';
      bio.maxLength = 280;
      bio.rows = 4;
      bio.placeholder = 'What do you play, and when?';
      bio.value = state.bio;
      bio.addEventListener('input', () => { state.bio = bio.value; });
      form.append(nameLabel, name, bioLabel, bio);
      main.append(form);
    }

    /* ---------- Footer / navigation ---------- */
    const note = el('p', 'ob-note');
    note.setAttribute('role', 'status');
    function footerNote(text) { note.textContent = text || ''; }

    function renderFooter() {
      footer.replaceChildren();
      const left = el('div', 'ob-footer__left');
      if (state.step > 1) {
        const back = el('button', 'ob-btn ob-btn--ghost', 'Back');
        back.type = 'button';
        back.addEventListener('click', () => go(state.step - 1));
        left.append(back);
      }
      const count = state.step === 1 ? state.genres.length : state.step === 2 ? state.games.length : state.step === 3 ? state.joined.size : 0;
      if (state.step < 4) left.append(el('span', 'ob-count', state.step === 3 ? (count ? `${count} joined` : 'Nothing joined yet') : (count ? `${count} selected` : 'Nothing selected yet')));

      const right = el('div', 'ob-footer__right');
      const skip = el('button', 'ob-btn ob-btn--ghost', state.step === 4 ? 'Skip' : 'Skip for now');
      skip.type = 'button';
      skip.addEventListener('click', () => (state.step === 4 ? finish(true) : go(state.step + 1)));
      const next = el('button', 'ob-btn ob-btn--primary', state.step === 4 ? 'Finish' : 'Continue');
      next.type = 'button';
      next.disabled = state.busy || (state.step < 3 && count === 0);
      next.addEventListener('click', () => advance());
      right.append(skip, next);
      footer.append(left, note, right);
    }

    function go(step) {
      state.step = step;
      footerNote('');
      renderProgress();
      if (step === 1) renderInterests();
      else if (step === 2) renderGames();
      else if (step === 3) renderCommunities();
      else renderProfile();
      renderFooter();
      page.scrollTo({ top: 0 });
    }

    async function save(body) {
      state.busy = true;
      renderFooter();
      try {
        const data = await api('/auth/profile', { method: 'PATCH', body: JSON.stringify(body) });
        setUser(data.user);
        return true;
      } catch (error) {
        footerNote(error.message || 'Something went wrong. Please try again.');
        return false;
      } finally {
        state.busy = false;
        renderFooter();
      }
    }

    async function advance() {
      if (state.step === 1) { if (await save({ genres: state.genres })) go(2); }
      else if (state.step === 2) { if (await save({ favoriteGames: state.games })) go(3); }
      else if (state.step === 3) go(4);
      else finish(false);
    }

    async function finish(skipped) {
      const body = { onboardingComplete: true };
      if (!skipped) { body.displayName = state.displayName.trim(); body.bio = state.bio.trim(); }
      if (await save(body)) {
        page.close();
        page.remove();
        onFinish();
      }
    }

    go(1);
    page.showModal();
  }

  return { start };
}
