/* Arcadia Admin: Communities (official communities and moderation).
   Receives the admin helpers from admin.js; built with DOM APIs only. */

const GENRES = [
  ['sports', 'Sports'], ['fps', 'FPS'], ['rpg', 'RPG'], ['battle-royale', 'Battle royale'], ['racing', 'Racing'],
  ['strategy', 'Strategy'], ['fighting', 'Fighting'], ['simulation', 'Simulation'], ['adventure', 'Adventure'], ['party', 'Party']
];

export function pageCommunities(main, { h, api, guard, modal, toast, number, dateText, renderLogin }) {
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search communities by name', 'aria-label': 'Search communities', autocomplete: 'off' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter' });
  const list = h('div', { class: 'list' });
  const more = h('button', { class: 'btn', type: 'button', hidden: true }, 'Load more');
  let filter = 'all';
  let term = '';
  let page = 0;
  let token = 0;
  let gamesCache = null;

  const FILTERS = [['all', 'All'], ['official', 'Official'], ['community', 'Member-made'], ['archived', 'Archived']];
  function drawSeg() {
    seg.replaceChildren(...FILTERS.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(id === filter), onClick: () => { filter = id; drawSeg(); load(true); } }, label)));
  }

  async function load(reset) {
    const mine = ++token;
    if (reset) { page = 0; list.replaceChildren(h('p', { class: 'empty' }, 'Loading…')); }
    const data = await guard(api(`/communities?limit=20&filter=${filter}&page=${reset ? 0 : page}${term ? `&q=${encodeURIComponent(term)}` : ''}`), list);
    if (!data || mine !== token) return;
    if (reset) list.replaceChildren();
    if (reset && !data.items.length) list.append(h('p', { class: 'empty' }, term ? `No communities match “${term}”.` : 'No communities here yet.'));
    for (const community of data.items) list.append(row(community));
    page = data.nextPage ?? 0;
    more.hidden = data.nextPage === null;
  }

  function badges(community) {
    return [
      community.official ? h('span', { class: 'chip chip--official' }, 'Official') : null,
      community.active ? null : h('span', { class: 'chip chip--down' }, 'Archived')
    ];
  }

  function row(community) {
    const staff = community.staff.length ? community.staff.slice(0, 3).map((person) => `@${person.username} (${person.role})`).join(', ') : 'no staff yet';
    const node = h('div', { class: 'row' },
      h('div', { class: 'row__avatar cadmin__icon', style: `background:${community.accent}`, 'aria-hidden': 'true' }, community.name[0].toUpperCase()),
      h('div', { class: 'row__main' },
        h('div', { class: 'row__name' }, community.name, ' ', ...badges(community)),
        h('div', { class: 'row__meta' }, `c/${community.slug} · ${number(community.memberCount)} members · ${number(community.postCount)} posts · ${staff}`)),
      h('button', { class: 'btn btn--small', type: 'button', onClick: () => manage(community, node) }, 'Manage…'));
    return node;
  }

  async function games() {
    if (gamesCache) return gamesCache;
    try { gamesCache = (await api('/communities/games')).items; } catch { gamesCache = []; }
    return gamesCache;
  }

  /* ------------------------- shared form pieces ------------------------- */

  function formFields(initial, catalogue) {
    const name = h('input', { type: 'text', maxlength: '40', value: initial.name || '', 'aria-label': 'Name' });
    const description = h('textarea', { rows: '3', maxlength: '300', 'aria-label': 'Description' }, initial.description || '');
    const accent = h('input', { type: 'color', value: initial.accent || '#68d6bd', 'aria-label': 'Accent colour', class: 'cadmin__color' });
    const rules = h('textarea', { rows: '4', 'aria-label': 'Rules' }, (initial.rules || ['Keep it friendly.', 'No spam or harassment.']).join('\n'));
    const flairs = h('input', { type: 'text', value: (initial.flairs || ['Discussion', 'Clip', 'Question', 'Guide']).join(', '), 'aria-label': 'Flairs' });

    const pickedGames = new Set(initial.games || []);
    const pickedGenres = new Set(initial.genres || []);
    const checks = (items, picked, max) => h('div', { class: 'cadmin__checks' }, items.map(([value, label]) => {
      const box = h('input', { type: 'checkbox', checked: picked.has(value) });
      box.addEventListener('change', () => {
        if (box.checked && picked.size >= max) { box.checked = false; toast(`Pick up to ${max}.`); return; }
        if (box.checked) picked.add(value); else picked.delete(value);
      });
      return h('label', { class: 'cadmin__check' }, box, label);
    }));

    const node = [
      h('label', { class: 'field' }, 'Name', name),
      h('label', { class: 'field' }, 'Description', description),
      h('label', { class: 'field' }, 'Accent colour', accent),
      h('label', { class: 'field' }, 'Rules (one per line, up to 8)', rules),
      h('label', { class: 'field' }, 'Post flairs (comma separated, up to 8)', flairs),
      h('div', { class: 'field' }, 'Games (up to 5)', checks(catalogue.map((game) => [game.slug, game.name]), pickedGames, 5)),
      h('div', { class: 'field' }, 'Genres (up to 3)', checks(GENRES, pickedGenres, 3))
    ];
    const read = () => ({
      name: name.value.trim(),
      description: description.value.trim(),
      accent: accent.value,
      rules: rules.value.split('\n').map((line) => line.trim()).filter(Boolean),
      flairs: flairs.value.split(',').map((item) => item.trim()).filter(Boolean),
      games: [...pickedGames],
      genres: [...pickedGenres]
    });
    return { node, read };
  }

  /* ------------------------------ create ------------------------------ */

  async function create() {
    const catalogue = await games();
    modal((close) => {
      const fields = formFields({}, catalogue);
      const error = h('p', { class: 'error', role: 'alert' });
      const go = h('button', { class: 'btn btn--primary', type: 'button' }, 'Create official community');
      go.addEventListener('click', async () => {
        go.disabled = true; error.textContent = '';
        try {
          await api('/communities', { method: 'POST', body: fields.read() });
          close();
          toast('Official community created.');
          load(true);
        } catch (e) { if (e.status === 401) { renderLogin('Your session ended. Sign in again.'); return; } error.textContent = e.message; go.disabled = false; }
      });
      return [
        h('div', { class: 'cadmin' },
          h('h2', {}, 'New official community'),
          h('p', {}, 'Official communities are run by Arcadia and shown to new players. They start without an owner: appoint staff after creating it.'),
          ...fields.node, error,
          h('div', { class: 'modal__actions' }, h('button', { class: 'btn', type: 'button', onClick: close }, 'Cancel'), go))
      ];
    });
  }

  /* ------------------------------ manage ------------------------------ */

  async function manage(initial, rowNode) {
    const catalogue = await games();
    let community = initial;

    modal((close) => {
      const fields = formFields(community, catalogue);
      const message = h('p', { class: 'error', role: 'alert' });
      const holder = h('div', { class: 'cadmin' });

      const refreshRow = () => { const fresh = row(community); rowNode.replaceWith(fresh); rowNode = fresh; };
      const apply = (updated) => { community = updated; refreshRow(); draw(); };

      async function run(promise, okText) {
        message.textContent = '';
        try { const result = await promise; if (okText) toast(okText); return result; }
        catch (e) { if (e.status === 401) { renderLogin('Your session ended. Sign in again.'); return null; } message.textContent = e.message; return null; }
      }

      function staffSection() {
        const box = h('section', { class: 'cadmin__section' }, h('h3', {}, 'Staff'),
          h('p', { class: 'cadmin__hint' }, 'Owners and moderators can edit this community and moderate its posts and chat. The person must already have an Arcadia account.'));
        const people = h('div', { class: 'cadmin__people' });
        const drawPeople = (staff) => {
          people.replaceChildren(...(staff.length ? staff : []).map((person) => h('div', { class: 'cadmin__person' },
            h('span', {}, `@${person.username}`, h('small', {}, ` ${person.role}`)),
            h('button', { class: 'btn btn--small', type: 'button', onClick: async () => { const r = await run(api(`/communities/${community.id}/staff`, { method: 'PUT', body: { username: person.username, role: 'remove' } }), 'Removed.'); if (r) { community.staff = r.staff; drawPeople(r.staff); refreshRow(); } } }, 'Remove'))));
          if (!staff.length) people.append(h('p', { class: 'cadmin__hint' }, 'No staff yet.'));
        };
        drawPeople(community.staff);
        const username = h('input', { type: 'text', placeholder: 'username', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Username' });
        const role = h('select', { 'aria-label': 'Role' }, h('option', { value: 'moderator' }, 'Moderator'), h('option', { value: 'owner' }, 'Owner'));
        const add = h('button', { class: 'btn btn--small', type: 'button' }, 'Appoint');
        add.addEventListener('click', async () => {
          const r = await run(api(`/communities/${community.id}/staff`, { method: 'PUT', body: { username: username.value, role: role.value } }), 'Staff updated.');
          if (r) { community.staff = r.staff; username.value = ''; drawPeople(r.staff); refreshRow(); }
        });
        box.append(people, h('div', { class: 'cadmin__inline' }, username, role, add));
        return box;
      }

      function postsSection() {
        const box = h('section', { class: 'cadmin__section' }, h('h3', {}, 'Recent posts'));
        const postList = h('div', { class: 'cadmin__posts' });
        const loadMore = h('button', { class: 'btn btn--small', type: 'button', hidden: true }, 'Load more');
        let cursor = null;
        async function loadPosts(reset) {
          if (reset) { cursor = null; postList.replaceChildren(h('p', { class: 'cadmin__hint' }, 'Loading…')); }
          const data = await run(api(`/communities/${community.id}/posts${!reset && cursor ? `?cursor=${cursor}` : ''}`));
          if (!data) return;
          if (reset) postList.replaceChildren();
          if (reset && !data.items.length) postList.append(h('p', { class: 'cadmin__hint' }, 'No posts yet.'));
          for (const post of data.items) {
            const item = h('div', { class: 'cadmin__post' },
              h('div', { class: 'cadmin__post-text' }, h('strong', {}, post.title || '(no title)'), post.body ? h('span', {}, ` ${post.body.slice(0, 90)}`) : null,
                h('small', {}, `@${post.author} · ${dateText(post.createdAt)} · ${number(post.score)} points · ${number(post.comments)} comments${post.pinned ? ' · pinned' : ''}`)),
              h('button', { class: 'btn btn--small btn--danger', type: 'button', onClick: async () => {
                if (!window.confirm('Delete this post and its comments for good?')) return;
                const r = await run(api(`/communities/${community.id}/posts/${post.id}`, { method: 'DELETE' }), 'Post deleted.');
                if (r) { item.remove(); community.postCount = Math.max(0, community.postCount - 1); refreshRow(); }
              } }, 'Delete'));
            postList.append(item);
          }
          cursor = data.nextCursor;
          loadMore.hidden = !cursor;
        }
        loadMore.addEventListener('click', () => loadPosts(false));
        box.append(postList, loadMore);
        loadPosts(true);
        return box;
      }

      function draw() {
        const save = h('button', { class: 'btn btn--primary', type: 'button' }, 'Save details');
        save.addEventListener('click', async () => {
          save.disabled = true;
          const r = await run(api(`/communities/${community.id}`, { method: 'PATCH', body: fields.read() }), 'Saved.');
          save.disabled = false;
          if (r) { community = { ...community, ...r.community }; refreshRow(); }
        });

        const officialButton = h('button', { class: 'btn', type: 'button' }, community.official ? 'Remove official status' : 'Make official');
        officialButton.addEventListener('click', async () => {
          const r = await run(api(`/communities/${community.id}/official`, { method: 'PATCH', body: { official: !community.official } }), community.official ? 'No longer official.' : 'Now official.');
          if (r) apply(r.community);
        });
        const archiveButton = h('button', { class: `btn ${community.active ? 'btn--danger' : ''}`, type: 'button' }, community.active ? 'Archive' : 'Restore');
        archiveButton.addEventListener('click', async () => {
          if (community.active && !window.confirm(`Archive ${community.name}? It disappears from Communities. Its posts are kept and you can restore it.`)) return;
          const r = await run(api(`/communities/${community.id}/active`, { method: 'PATCH', body: { active: !community.active } }), community.active ? 'Archived.' : 'Restored.');
          if (r) { apply(r.community); if (!r.community.active && filter !== 'archived') { rowNode.remove(); close(); } }
        });

        holder.replaceChildren(
          h('h2', {}, community.name, ' ', ...badges(community)),
          h('p', { class: 'cadmin__hint' }, `c/${community.slug} · ${number(community.memberCount)} members · ${number(community.postCount)} posts`),
          h('section', { class: 'cadmin__section' }, h('h3', {}, 'Details'), ...fields.node, h('div', { class: 'cadmin__inline' }, save)),
          staffSection(),
          postsSection(),
          h('section', { class: 'cadmin__section' }, h('h3', {}, 'Status'), h('div', { class: 'cadmin__inline' }, officialButton, archiveButton)),
          message,
          h('div', { class: 'modal__actions' }, h('button', { class: 'btn', type: 'button', onClick: close }, 'Close')));
      }
      draw();
      return [holder];
    });
  }

  /* ------------------------------ layout ------------------------------ */

  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { term = search.value.trim(); load(true); }, 250); });
  more.addEventListener('click', () => load(false));
  drawSeg();
  main.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Communities'), h('button', { class: 'btn btn--primary', type: 'button', onClick: create }, '+ New official community')),
    h('div', { class: 'toolbar' }, search, seg),
    list,
    h('div', { class: 'toolbar', style: 'margin-top:14px' }, more));
  load(true);
}
