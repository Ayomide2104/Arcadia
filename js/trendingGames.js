/* "Trending games" panel on the feed sidebar: the most popular games right now,
   ranked by how many players, posts and communities pick them (GET /games/popular). */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const FLAME = 'M12 3c.6 3.2-1.2 4.6-2.6 6.2C8 10.8 7 12.3 7 14.2A5 5 0 0 0 12 19a5 5 0 0 0 5-4.8c0-1.6-.7-2.9-1.7-4-.3 1.2-.9 2-1.8 2.4.5-2.6-.2-5.7-1.5-9.6z';

function flame() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'tg-flame');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', FLAME);
  svg.append(path);
  return svg;
}

export function createTrendingGames({ api, gameInfo, openGame, openGames }) {
  const host = document.querySelector('#trending-games');
  if (!host) return { refresh() {} };

  let loadedAt = 0;
  let loading = false;

  function head() {
    const title = el('h2', '', 'Trending games');
    const wrap = el('div', 'mini-panel__head');
    wrap.append(title);
    return wrap;
  }

  function empty(message) {
    const box = el('div', 'tg-empty');
    box.append(el('p', '', message));
    const more = el('button', 'tg-link', 'Explore games');
    more.type = 'button';
    more.addEventListener('click', () => openGames());
    box.append(more);
    return box;
  }

  function row(game) {
    const info = gameInfo(game.name);
    const known = Boolean(info.cover || info.banner);
    const cover = info.cover ? `/assets/arcadia/games/${info.cover}` : `/assets/arcadia/games/${game.slug}.jpg`;
    const title = known ? info.title : game.name;

    const item = el('button', 'tg-row');
    item.type = 'button';
    const picks = game.picks || 0;
    item.title = picks ? `${title} · ${picks} ${picks === 1 ? 'pick' : 'picks'}` : title;
    item.setAttribute('aria-label', `Open ${title}`);

    const tile = el('span', 'tg-tile', title[0]?.toUpperCase() || '?');
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => { tile.textContent = ''; tile.append(img); }, { once: true });
    img.src = cover;

    item.append(tile, el('span', 'tg-name', title));
    item.addEventListener('click', () => openGame(game.slug));
    return item;
  }

  async function refresh() {
    if (loading) return;
    if (Date.now() - loadedAt < 60000 && host.children.length) return;
    loading = true;
    try {
      const data = await api('/games/popular?limit=6');
      const items = (data.items || []).filter((game) => game.picks > 0 || (data.items || []).length <= 5);
      host.replaceChildren(head());
      if (!items.length) { host.append(empty('Popular games will show up here as players pick them.')); return; }
      const list = el('div', 'tg-list');
      items.forEach((game) => list.append(row(game)));
      host.append(list);
      loadedAt = Date.now();
    } catch {
      host.replaceChildren(head(), empty('Could not load trending games right now.'));
    } finally {
      loading = false;
    }
  }

  host.replaceChildren(head());
  const skeleton = el('div', 'tg-list');
  for (let i = 0; i < 4; i += 1) skeleton.append(el('div', 'tg-row tg-row--skeleton'));
  host.append(skeleton);

  return { refresh };
}
