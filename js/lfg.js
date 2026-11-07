/* Looking For Gamers (LFG): find players, post an invite, ask to join.
   Each game asks for the join details it really uses (Riot ID, room code, invite code...),
   and those details are only shown to people the host accepts. */

import { layerHost } from './layers.js';

import { animateList } from './motionKit.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeLeft(date) {
  const ms = new Date(date).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m left` : 'Closes tomorrow';
}

export function createLfg({ mount, api, getUser, toast, onNeedSignIn, setAvatar, onOpenProfile, onMessage, onReport }) {
  let options = null;
  let tab = 'open';
  let filters = { game: '', platform: '', skill: '' };
  let loadId = 0;

  const gameName = (slug) => options?.games.find((game) => game.slug === slug)?.name || slug;
  const configFor = (slug) => options?.configs[slug] || options?.configs._default;

  async function ensureOptions() {
    if (options) return options;
    options = await api('/lfg/options');
    return options;
  }

  function avatarFor(author, size = '') {
    const name = author?.displayName || author?.username || '?';
    const node = el('span', `avatar lfg-avatar ${size}`.trim(), name[0].toUpperCase());
    setAvatar?.(node, author?.avatar, name[0].toUpperCase());
    return node;
  }

  function chip(text, className = '') { return el('span', `lfg-chip ${className}`.trim(), text); }

  /* ---------- Shell ---------- */
  function shell() {
    mount.replaceChildren();
    const head = el('div', 'lfg-head');
    const titleBox = el('div');
    titleBox.append(el('p', 'eyebrow', 'FIND YOUR SQUAD'));
    const h1 = el('h1', '', 'Find players');
    h1.append(el('span', 'heading-period', '.'));
    titleBox.append(h1, el('p', 'subheading', 'Post an invite for a game, or ask to join one.'));
    const post = el('button', 'lfg-primary', 'Post an invite');
    post.type = 'button';
    post.addEventListener('click', openComposer);
    head.append(titleBox, post);

    const tabs = el('div', 'lfg-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [key, label] of [['open', 'Open invites'], ['mine', 'My invites']]) {
      const button = el('button', `lfg-tab${tab === key ? ' is-active' : ''}`, label);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab === key));
      button.addEventListener('click', () => { tab = key; void render(); });
      tabs.append(button);
    }
    const body = el('div', 'lfg-body');
    mount.append(head, tabs, body);
    return body;
  }

  /* ---------- Open invites ---------- */
  function filterBar(onChange) {
    const bar = el('div', 'lfg-filters');
    const make = (label, key, items) => {
      const wrap = el('label', 'lfg-filter');
      wrap.append(el('span', 'sr-only', label));
      const select = el('select', 'lfg-select');
      select.append(new Option(label === 'Game' ? 'All games' : label === 'Platform' ? 'Any platform' : 'Any level', ''));
      for (const [value, text] of items) select.append(new Option(text, value));
      select.value = filters[key];
      select.addEventListener('change', () => { filters[key] = select.value; onChange(); });
      wrap.append(select);
      return wrap;
    };
    bar.append(
      make('Game', 'game', options.games.map((game) => [game.slug, game.name])),
      make('Platform', 'platform', ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Mobile'].map((p) => [p, p])),
      make('Level', 'skill', options.skills.filter((skill) => skill.key !== 'any').map((skill) => [skill.key, skill.label])),
    );
    return bar;
  }

  async function renderOpen(body) {
    const list = el('div', 'lfg-list');
    animateList(list);
    body.append(filterBar(() => void loadOpen(list)), list);
    await loadOpen(list);
  }

  async function loadOpen(list) {
    const mine = ++loadId;
    list.replaceChildren(el('p', 'lfg-note', 'Looking for invites…'));
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    try {
      const data = await api(`/lfg?${params.toString()}`);
      if (mine !== loadId) return;
      list.replaceChildren();
      if (!data.items.length) {
        const empty = el('div', 'lfg-empty');
        empty.append(el('strong', '', 'No open invites right now'), el('span', '', 'Be the first. Post an invite and players can ask to join.'));
        list.append(empty);
        return;
      }
      for (const post of data.items) list.append(card(post, () => loadOpen(list)));
    } catch (error) {
      if (mine !== loadId) return;
      list.replaceChildren(el('p', 'lfg-note', error.message || 'Could not load invites.'));
    }
  }

  /* ---------- Card ---------- */
  function revealBox(post) {
    const box = el('div', 'lfg-reveal');
    const method = configFor(post.game)?.methods.find((item) => item.key === post.joinMethod);
    // The list view leaves the secret out; fetch it for accepted players on demand.
    if (post.joinMethod !== 'dm' && post.joinValue === undefined) {
      box.append(el('span', 'lfg-reveal-label', `You’re in. The host’s ${(method?.label || 'join details').toLowerCase()} is ready.`));
      const show = el('button', 'lfg-small', 'Show join details');
      show.type = 'button';
      show.addEventListener('click', async () => {
        show.disabled = true;
        try {
          const data = await api(`/lfg/${post._id}`);
          box.replaceWith(revealBox({ ...post, joinValue: data.post.joinValue ?? '' }));
        } catch (error) { toast(error.message || 'Could not load the details.'); show.disabled = false; }
      });
      box.append(show);
      return box;
    }
    if (post.joinMethod === 'dm' || !post.joinValue) {
      box.append(el('span', 'lfg-reveal-label', 'How to join'), el('span', 'lfg-reveal-value', 'Message the host on Arcadia'));
      const message = el('button', 'lfg-small', `Message ${post.author?.displayName || post.author?.username || 'host'}`);
      message.type = 'button';
      message.addEventListener('click', () => onMessage?.(post.author));
      box.append(message);
      return box;
    }
    box.append(el('span', 'lfg-reveal-label', method?.label || 'Join details'));
    if (method?.kind === 'link') {
      const anchor = el('a', 'lfg-reveal-value', post.joinValue);
      anchor.href = post.joinValue; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      box.append(anchor);
    } else {
      box.append(el('span', 'lfg-reveal-value', post.joinValue));
    }
    const copy = el('button', 'lfg-small', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(post.joinValue); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Press and hold to copy'; }
      window.setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
    });
    box.append(copy);
    return box;
  }

  function card(post, refresh) {
    const article = el('article', 'lfg-card');
    const top = el('div', 'lfg-card-top');
    const who = el('button', 'lfg-who');
    who.type = 'button';
    who.append(avatarFor(post.author));
    const names = el('span', 'lfg-who-text');
    names.append(el('strong', '', post.author?.displayName || post.author?.username || 'Player'), el('span', '', `@${post.author?.username || ''} · ${timeLeft(post.expiresAt)}`));
    who.append(names);
    who.addEventListener('click', () => onOpenProfile?.(post.author?.username));
    top.append(who, chip(`${post.spotsLeft} ${post.spotsLeft === 1 ? 'spot' : 'spots'} left`, 'is-spots'));

    const title = el('h3', 'lfg-game', gameName(post.game));
    const chips = el('div', 'lfg-chips');
    chips.append(chip(post.platform), chip(post.mode));
    const level = options.skills.find((skill) => skill.key === post.skill);
    if (post.skill !== 'any' && level) chips.append(chip(level.label));
    chips.append(chip(`Join via ${post.joinMethodLabel}`, 'is-method'));

    article.append(top, title, chips);
    if (post.note) article.append(el('p', 'lfg-card-note', post.note));

    const foot = el('div', 'lfg-card-foot');
    if (post.isMine) {
      foot.append(el('span', 'lfg-muted', post.pendingCount ? `${post.pendingCount} waiting for your answer` : 'This is your invite'));
    } else if (post.myRequest?.status === 'accepted') {
      article.append(revealBox(post));
    } else if (post.myRequest?.status === 'pending') {
      foot.append(el('span', 'lfg-muted', 'Request sent. Waiting for the host.'));
      const withdraw = el('button', 'lfg-ghost', 'Withdraw');
      withdraw.type = 'button';
      withdraw.addEventListener('click', async () => {
        withdraw.disabled = true;
        try { await api(`/lfg/${post._id}/requests`, { method: 'DELETE' }); refresh(); } catch (error) { toast(error.message); withdraw.disabled = false; }
      });
      foot.append(withdraw);
    } else if (post.myRequest?.status === 'declined') {
      foot.append(el('span', 'lfg-muted', 'The host couldn’t fit you in this time.'));
    } else {
      const ask = el('button', 'lfg-primary lfg-primary--small', 'Ask to join');
      ask.type = 'button';
      ask.addEventListener('click', () => {
        if (!getUser()) { onNeedSignIn(); return; }
        askForm(article, post, foot, refresh);
      });
      foot.append(ask);
    }
    if (!post.isMine && onReport) {
      const flag = el('button', 'lfg-ghost lfg-flag', 'Report');
      flag.type = 'button';
      flag.addEventListener('click', () => onReport(post));
      foot.append(flag);
    }
    if (foot.childNodes.length) article.append(foot);
    return article;
  }

  function askForm(article, post, foot, refresh) {
    if (article.querySelector('.lfg-ask')) return;
    const form = el('form', 'lfg-ask');
    const input = el('input', 'lfg-input');
    input.maxLength = 140; input.placeholder = 'Say hi (optional): rank, role, when you can play';
    input.setAttribute('aria-label', 'Message to the host');
    const row = el('div', 'lfg-row');
    const cancel = el('button', 'lfg-ghost', 'Cancel'); cancel.type = 'button';
    const send = el('button', 'lfg-primary lfg-primary--small', 'Send request'); send.type = 'submit';
    row.append(cancel, send);
    const error = el('p', 'lfg-error'); error.hidden = true;
    form.append(input, error, row);
    foot.replaceChildren(form);
    input.focus();
    cancel.addEventListener('click', () => refresh());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      send.disabled = true;
      try {
        await api(`/lfg/${post._id}/requests`, { method: 'POST', body: JSON.stringify({ message: input.value.trim() }) });
        toast('Request sent');
        refresh();
      } catch (failure) { error.textContent = failure.message; error.hidden = false; send.disabled = false; }
    });
  }

  /* ---------- My invites ---------- */
  async function renderMine(body) {
    if (!getUser()) {
      const empty = el('div', 'lfg-empty');
      empty.append(el('strong', '', 'Sign in to see your invites'));
      const button = el('button', 'lfg-primary lfg-primary--small', 'Sign in'); button.type = 'button';
      button.addEventListener('click', onNeedSignIn);
      empty.append(button);
      body.append(empty);
      return;
    }
    body.append(el('p', 'lfg-note', 'Loading…'));
    try {
      const data = await api('/lfg/mine');
      body.replaceChildren();
      body.append(el('h2', 'lfg-section', 'Invites you posted'));
      if (!data.posts.length) body.append(el('p', 'lfg-note', 'You haven’t posted an invite yet.'));
      for (const post of data.posts) body.append(myPostCard(post));
      body.append(el('h2', 'lfg-section', 'Invites you asked to join'));
      if (!data.joined.length) body.append(el('p', 'lfg-note', 'Requests you send show up here.'));
      for (const post of data.joined) body.append(card(post, () => void render()));
    } catch (error) { body.replaceChildren(el('p', 'lfg-note', error.message || 'Could not load your invites.')); }
  }

  function myPostCard(post) {
    const article = card(post, () => void render());
    article.classList.add('is-mine');
    const status = post.status === 'open' ? 'Open' : post.status === 'full' ? 'Full' : post.status === 'expired' ? 'Expired' : 'Closed';
    article.querySelector('.lfg-card-top .lfg-chip')?.after(chip(status, `is-status is-${post.status}`));

    if (post.joinMethod !== 'dm') {
      const own = el('div', 'lfg-reveal');
      own.append(el('span', 'lfg-reveal-label', `Your ${post.joinMethodLabel.toLowerCase()} (only accepted players see it)`), el('span', 'lfg-reveal-value', post.joinValue || ''));
      article.append(own);
    }

    const actions = el('div', 'lfg-row lfg-row--wrap');
    const requests = el('button', 'lfg-small', post.pendingCount ? `Requests (${post.pendingCount})` : 'Requests');
    requests.type = 'button';
    const panel = el('div', 'lfg-requests'); panel.hidden = true;
    requests.addEventListener('click', async () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await loadRequests(post, panel);
    });
    actions.append(requests);
    if (post.status === 'open' || post.status === 'full') {
      const close = el('button', 'lfg-small', 'Close invite'); close.type = 'button';
      close.addEventListener('click', async () => {
        try { await api(`/lfg/${post._id}/close`, { method: 'POST' }); toast('Invite closed'); void render(); } catch (error) { toast(error.message); }
      });
      actions.append(close);
    }
    const del = el('button', 'lfg-small lfg-danger', 'Delete'); del.type = 'button';
    del.addEventListener('click', async () => {
      if (!window.confirm('Delete this invite? Players who asked to join will lose it.')) return;
      try { await api(`/lfg/${post._id}`, { method: 'DELETE' }); toast('Invite deleted'); void render(); } catch (error) { toast(error.message); }
    });
    actions.append(del);
    article.append(actions, panel);
    return article;
  }

  async function loadRequests(post, panel) {
    panel.replaceChildren(el('p', 'lfg-note', 'Loading requests…'));
    try {
      const data = await api(`/lfg/${post._id}/requests`);
      panel.replaceChildren();
      if (!data.items.length) { panel.append(el('p', 'lfg-note', 'No requests yet.')); return; }
      for (const item of data.items) {
        const row = el('div', 'lfg-request');
        const who = el('button', 'lfg-who'); who.type = 'button';
        who.append(avatarFor(item.user));
        const text = el('span', 'lfg-who-text');
        text.append(el('strong', '', item.user.displayName || item.user.username), el('span', '', item.message || `@${item.user.username}`));
        who.append(text);
        who.addEventListener('click', () => onOpenProfile?.(item.user.username));
        row.append(who);
        if (item.status === 'pending') {
          const accept = el('button', 'lfg-small lfg-accept', 'Accept'); accept.type = 'button';
          const decline = el('button', 'lfg-small', 'Decline'); decline.type = 'button';
          const decide = async (verb) => {
            accept.disabled = decline.disabled = true;
            try { await api(`/lfg/${post._id}/requests/${item.user._id}/${verb}`, { method: 'POST' }); void render(); }
            catch (error) { toast(error.message); accept.disabled = decline.disabled = false; }
          };
          accept.addEventListener('click', () => decide('accept'));
          decline.addEventListener('click', () => decide('decline'));
          row.append(accept, decline);
        } else {
          row.append(chip(item.status === 'accepted' ? 'Accepted' : 'Declined', `is-status is-${item.status}`));
        }
        panel.append(row);
      }
    } catch (error) { panel.replaceChildren(el('p', 'lfg-note', error.message)); }
  }

  /* ---------- Composer ---------- */
  function openComposer() {
    if (!getUser()) { onNeedSignIn(); return; }
    const overlay = el('div', 'lfg-overlay');
    const sheet = el('form', 'lfg-sheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Post an invite');
    const close = () => { overlay.remove(); document.body.classList.remove('lfg-open'); };

    const head = el('div', 'lfg-sheet-head');
    head.append(el('h2', '', 'Post an invite'));
    const x = el('button', 'lfg-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', close);
    head.append(x);

    const field = (label, control, help) => {
      const wrap = el('label', 'lfg-field');
      wrap.append(el('span', 'lfg-label', label), control);
      if (help) wrap.append(el('small', 'lfg-help', help));
      return wrap;
    };
    const select = (items, value) => {
      const node = el('select', 'lfg-select lfg-select--full');
      for (const [val, text] of items) node.append(new Option(text, val));
      if (value !== undefined) node.value = value;
      return node;
    };

    const game = select(options.games.map((item) => [item.slug, item.name]), filters.game || options.games[0]?.slug);
    const platform = select([]); const mode = select([]);
    const skill = select(options.skills.map((item) => [item.key, item.label]), 'any');
    const slots = el('input', 'lfg-input'); slots.type = 'number'; slots.min = '1'; slots.max = '9'; slots.value = '2'; slots.inputMode = 'numeric';
    const hours = select(options.durations.map((item) => [String(item.hours), item.label]), '3');
    const methodBox = el('div', 'lfg-methods'); methodBox.setAttribute('role', 'radiogroup'); methodBox.setAttribute('aria-label', 'How should players join you?');
    const joinValue = el('input', 'lfg-input'); joinValue.autocomplete = 'off'; joinValue.spellcheck = false;
    const joinField = field('', joinValue, ' ');
    const note = el('textarea', 'lfg-input lfg-textarea'); note.rows = 2; note.maxLength = 200; note.placeholder = 'What are you playing? Rank, goal, when you’re on. No links.';
    const error = el('p', 'lfg-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const submit = el('button', 'lfg-primary', 'Post invite'); submit.type = 'submit';

    let methodKey = 'dm';
    function paintMethods() {
      const config = configFor(game.value);
      methodBox.replaceChildren();
      if (!config.methods.some((item) => item.key === methodKey)) methodKey = config.methods[0].key;
      for (const method of config.methods) {
        const button = el('button', `lfg-method${method.key === methodKey ? ' is-active' : ''}`, method.label);
        button.type = 'button'; button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', String(method.key === methodKey));
        button.addEventListener('click', () => { methodKey = method.key; paintMethods(); });
        methodBox.append(button);
      }
      const method = config.methods.find((item) => item.key === methodKey);
      joinField.hidden = method.kind === 'dm';
      joinField.querySelector('.lfg-label').textContent = method.label;
      joinValue.placeholder = method.placeholder || '';
      joinValue.maxLength = method.max || 60;
      joinValue.type = method.kind === 'link' ? 'url' : 'text';
      const help = joinField.querySelector('.lfg-help');
      help.textContent = [method.help, 'Only players you accept will see this.'].filter(Boolean).join(' ');
      if (method.kind === 'dm') joinValue.value = '';
    }
    function paintGame() {
      const config = configFor(game.value);
      platform.replaceChildren(...config.platforms.map((item) => new Option(item, item)));
      mode.replaceChildren(...config.modes.map((item) => new Option(item, item)));
      paintMethods();
    }
    game.addEventListener('change', () => { joinValue.value = ''; paintGame(); });
    paintGame();

    const row2 = el('div', 'lfg-grid2');
    row2.append(field('Platform', platform), field('Mode', mode));
    const row3 = el('div', 'lfg-grid3');
    row3.append(field('Level', skill), field('Open spots', slots), field('Stays open', hours));
    const methodField = el('div', 'lfg-field'); methodField.append(el('span', 'lfg-label', 'How should players join you?'), methodBox);
    sheet.append(head, field('Game', game), row2, row3, methodField, joinField, field('Note (optional)', note), error, submit);
    overlay.append(sheet);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
    sheet.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    layerHost().append(overlay); document.body.classList.add('lfg-open');
    game.focus();

    sheet.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true; error.hidden = true;
      try {
        await api('/lfg', { method: 'POST', body: JSON.stringify({
          game: game.value, platform: platform.value, mode: mode.value, skill: skill.value,
          slots: Number(slots.value), hours: Number(hours.value), joinMethod: methodKey, joinValue: joinValue.value, note: note.value,
        }) });
        close(); toast('Invite posted'); tab = 'mine'; void render();
      } catch (failure) { error.textContent = failure.message || 'Could not post your invite.'; error.hidden = false; submit.disabled = false; }
    });
  }

  /* ---------- Entry ---------- */
  async function render() {
    const body = shell();
    try { await ensureOptions(); } catch (error) { body.append(el('p', 'lfg-note', error.message || 'Could not load.')); return; }
    if (tab === 'mine') await renderMine(body); else await renderOpen(body);
  }

  return { show: () => render(), openFor: (slug, which = 'open') => { filters.game = slug || ''; tab = which; return render(); } };
}
