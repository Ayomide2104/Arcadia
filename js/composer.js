/* Arcadia composer: one place to write a post.
   - Destination picker with search (public feed, a game, one of your communities)
   - Up to 4 photos: choose, drag and drop, or paste. Photos are resized in the
     browser and the resized copy is what gets uploaded.
   - Keeps your draft if you close it by accident. Ctrl/Cmd + Enter posts. */

const MAX_PHOTOS = 4;
const MAX_LENGTH = 500;
const TARGET_BYTES = 900 * 1024; // what we aim for after resizing
const HARD_LIMIT = 4.5 * 1024 * 1024; // the server accepts 5 MB per photo
const RING = 2 * Math.PI * 9;

const ICONS = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  photo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="10" r="1.7"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3z"/></svg>',
  game: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a4 4 0 0 1 3.9 4.9l-.8 3.5a2.3 2.3 0 0 1-4 1L14.6 16H9.4l-1.5 1.4a2.3 2.3 0 0 1-4-1l-.8-3.5A4 4 0 0 1 7 8z"/><path d="M8 10.5v3M6.5 12h3M15.5 11h.01M17.5 13h.01"/></svg>',
  group: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.3a3.2 3.2 0 0 1 0 5.8M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/></svg>',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const holder = document.createElement('span');
  holder.className = 'cmp-icon';
  holder.innerHTML = ICONS[name]; // fixed strings above, never user content
  return holder;
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Resize in the browser: longest side 1600px, WebP (JPEG as a fallback), small file. */
export async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Choose a JPEG, PNG, WebP or GIF image.');
  // Animated GIFs would lose their animation on a canvas, so they go up as they are.
  if (file.type === 'image/gif') {
    if (file.size > HARD_LIMIT) throw new Error('That GIF is over 4.5 MB. Try a shorter one.');
    return file;
  }
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('That image could not be read. Try another one.'); }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const toBlob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  let type = 'image/webp';
  let quality = 0.88;
  let blob = await toBlob(type, quality);
  if (!blob || blob.type !== 'image/webp') { type = 'image/jpeg'; blob = await toBlob(type, quality); }
  while (blob && blob.size > TARGET_BYTES && quality > 0.5) { quality -= 0.08; blob = await toBlob(type, quality); }
  if (!blob || blob.size > HARD_LIMIT) throw new Error('That photo is too large to upload.');
  const ext = type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `photo.${ext}`, { type });
}

export function createComposer({ api, toast, getUser, openAuth, setAvatar, onPosted }) {
  let dialog = null;
  let ui = null;
  const state = {
    text: '',
    photos: [], // { id, file, url }
    destination: { type: 'general', target: null, label: 'Public feed' },
    posting: false,
    catalog: null, // { games: [], groups: [] }
    catalogLoading: false,
  };
  let nextId = 1;

  /* ------------------------------ build ------------------------------ */

  function build() {
    dialog = el('dialog', 'cmp');
    dialog.setAttribute('aria-labelledby', 'cmp-title');
    const form = el('form', 'cmp-form');
    form.noValidate = true;

    const head = el('header', 'cmp-head');
    const title = el('h2', 'cmp-title', 'Create post');
    title.id = 'cmp-title';
    const close = el('button', 'cmp-x');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.append(icon('close'));
    head.append(title, close);

    const who = el('div', 'cmp-who');
    const avatar = el('span', 'avatar cmp-avatar', '?');
    const whoText = el('div', 'cmp-who-text');
    const name = el('strong', 'cmp-name', 'You');
    const destButton = el('button', 'cmp-dest');
    destButton.type = 'button';
    destButton.setAttribute('aria-haspopup', 'listbox');
    destButton.setAttribute('aria-expanded', 'false');
    const destIcon = el('span', 'cmp-dest-icon');
    const destLabel = el('span', 'cmp-dest-label', 'Public feed');
    destButton.append(destIcon, destLabel, icon('chevron'));
    whoText.append(name, destButton);
    who.append(avatar, whoText);

    const panel = el('div', 'cmp-panel');
    panel.hidden = true;
    const searchRow = el('label', 'cmp-search');
    const searchInput = el('input', 'cmp-search-input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search games and communities';
    searchInput.autocomplete = 'off';
    searchInput.setAttribute('aria-label', 'Search destinations');
    searchRow.append(icon('search'), searchInput);
    const list = el('div', 'cmp-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Where to post');
    panel.append(searchRow, list);

    const field = el('div', 'cmp-field');
    const textLabel = el('label', 'sr-only', 'Post text');
    textLabel.htmlFor = 'cmp-text';
    const text = el('textarea', 'cmp-text');
    text.id = 'cmp-text';
    text.rows = 3;
    text.maxLength = MAX_LENGTH;
    text.placeholder = 'Share the highlight, the hard carry, or the late-night plan…';
    field.append(textLabel, text);

    const photos = el('div', 'cmp-photos');
    photos.hidden = true;

    const drop = el('div', 'cmp-drop');
    drop.append(icon('photo'), el('strong', '', 'Drop photos to add them'), el('span', '', `Up to ${MAX_PHOTOS} per post`));
    drop.hidden = true;

    const foot = el('footer', 'cmp-foot');
    const tools = el('div', 'cmp-tools');
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/jpeg,image/png,image/webp,image/gif';
    file.multiple = true;
    file.hidden = true;
    const photoButton = el('button', 'cmp-tool');
    photoButton.type = 'button';
    photoButton.setAttribute('aria-label', 'Add photos');
    const photoCount = el('span', 'cmp-tool-count');
    photoButton.append(icon('photo'), el('span', 'cmp-tool-label', 'Photo'), photoCount);
    const clear = el('button', 'cmp-clear', 'Clear');
    clear.type = 'button';
    clear.hidden = true;
    tools.append(photoButton, clear, file);

    const meta = el('div', 'cmp-meta');
    const left = el('span', 'cmp-left');
    left.setAttribute('aria-live', 'polite');
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 24 24');
    ring.setAttribute('class', 'cmp-ring');
    ring.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('class', 'cmp-ring-track');
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bar.setAttribute('class', 'cmp-ring-bar');
    for (const c of [track, bar]) { c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '9'); }
    bar.style.strokeDasharray = String(RING);
    bar.style.strokeDashoffset = String(RING);
    ring.append(track, bar);
    const submit = el('button', 'cmp-submit');
    submit.type = 'submit';
    const submitLabel = el('span', 'cmp-submit-label', 'Post');
    submit.append(el('span', 'cmp-spinner'), submitLabel);
    meta.append(left, ring, submit);
    foot.append(tools, meta);

    const error = el('p', 'cmp-error');
    error.setAttribute('role', 'alert');

    form.append(head, who, panel, field, photos, foot, error, drop);
    dialog.append(form);
    document.body.append(dialog);

    ui = { form, close, avatar, name, destButton, destIcon, destLabel, panel, searchInput, list, text, photos, drop, file, photoButton, photoCount, clear, left, bar, submit, submitLabel, error };
    wire();
  }

  /* ------------------------------ behaviour ------------------------------ */

  function wire() {
    ui.close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('cancel', (event) => {
      if (!ui.panel.hidden) { event.preventDefault(); closePanel(); }
    });
    dialog.addEventListener('close', () => { closePanel(); ui.drop.hidden = true; });

    ui.text.addEventListener('input', () => { state.text = ui.text.value; autosize(); refresh(); });
    ui.text.addEventListener('paste', (event) => {
      const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
      if (!images.length) return;
      event.preventDefault();
      void addFiles(images);
    });
    ui.form.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); ui.form.requestSubmit(); }
    });

    ui.photoButton.addEventListener('click', () => ui.file.click());
    ui.file.addEventListener('change', () => { const files = [...ui.file.files]; ui.file.value = ''; void addFiles(files); });
    ui.clear.addEventListener('click', () => { reset(); refresh(); ui.text.focus(); });

    let depth = 0;
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
    dialog.addEventListener('dragenter', (event) => { if (!hasFiles(event)) return; event.preventDefault(); depth += 1; ui.drop.hidden = false; });
    dialog.addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
    dialog.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) ui.drop.hidden = true; });
    dialog.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); depth = 0; ui.drop.hidden = true;
      void addFiles([...event.dataTransfer.files].filter((file) => file.type.startsWith('image/')));
    });

    ui.destButton.addEventListener('click', () => (ui.panel.hidden ? openPanel() : closePanel()));
    ui.searchInput.addEventListener('input', renderDestinations);
    dialog.addEventListener('click', (event) => {
      if (!ui.panel.hidden && !ui.panel.contains(event.target) && !ui.destButton.contains(event.target)) closePanel();
    });

    ui.form.addEventListener('submit', (event) => { event.preventDefault(); void submit(); });
  }

  function autosize() {
    ui.text.style.height = 'auto';
    ui.text.style.height = `${Math.min(Math.max(ui.text.scrollHeight, 96), 280)}px`;
  }

  function setError(message = '') { ui.error.textContent = message; ui.error.classList.toggle('is-visible', Boolean(message)); }

  function canPost() {
    return !state.posting && (state.text.trim().length > 0 || state.photos.length > 0) && state.text.length <= MAX_LENGTH;
  }

  function refresh() {
    const length = state.text.length;
    const remaining = MAX_LENGTH - length;
    ui.bar.style.strokeDashoffset = String(RING * (1 - Math.min(1, length / MAX_LENGTH)));
    ui.bar.parentElement.classList.toggle('is-warn', length >= MAX_LENGTH * 0.9 && length < MAX_LENGTH);
    ui.bar.parentElement.classList.toggle('is-full', length >= MAX_LENGTH);
    ui.left.textContent = length >= MAX_LENGTH * 0.85 ? String(remaining) : '';
    ui.left.classList.toggle('is-over', remaining <= 0);
    ui.submit.disabled = !canPost();
    ui.submit.classList.toggle('is-busy', state.posting);
    ui.submitLabel.textContent = state.posting ? 'Posting…' : 'Post';
    ui.clear.hidden = state.posting || (!state.text && !state.photos.length);
    ui.photoCount.textContent = state.photos.length ? `${state.photos.length}/${MAX_PHOTOS}` : '';
    ui.photoButton.disabled = state.posting || state.photos.length >= MAX_PHOTOS;
    ui.text.disabled = state.posting;
    ui.form.classList.toggle('is-posting', state.posting);
  }

  /* ------------------------------ photos ------------------------------ */

  async function addFiles(files) {
    if (!files.length || state.posting) return;
    setError();
    const room = MAX_PHOTOS - state.photos.length;
    if (room <= 0) { setError(`You can add up to ${MAX_PHOTOS} photos.`); return; }
    if (files.length > room) setError(`Only ${room} more ${room === 1 ? 'photo fits' : 'photos fit'}. The rest were skipped.`);
    for (const original of files.slice(0, room)) {
      const entry = { id: nextId++, file: null, url: '', busy: true, name: original.name };
      state.photos.push(entry);
      renderPhotos();
      try {
        entry.file = await prepareImage(original);
        entry.url = URL.createObjectURL(entry.file);
      } catch (error) {
        state.photos = state.photos.filter((photo) => photo !== entry);
        setError(error.message || 'That photo could not be added.');
      }
      entry.busy = false;
      renderPhotos();
      refresh();
    }
  }

  function removePhoto(entry) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    state.photos = state.photos.filter((photo) => photo !== entry);
    setError();
    renderPhotos();
    refresh();
  }

  function renderPhotos() {
    ui.photos.replaceChildren();
    ui.photos.hidden = !state.photos.length;
    ui.photos.dataset.count = String(state.photos.length);
    for (const entry of state.photos) {
      const tile = el('figure', `cmp-photo${entry.busy ? ' is-busy' : ''}`);
      if (entry.url) {
        const img = el('img');
        img.src = entry.url;
        img.alt = `Photo ${state.photos.indexOf(entry) + 1} of your post`;
        tile.append(img);
        tile.append(el('figcaption', 'cmp-photo-size', formatSize(entry.file.size)));
      } else {
        tile.append(el('span', 'cmp-photo-wait'));
      }
      const remove = el('button', 'cmp-photo-x');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove photo ${state.photos.indexOf(entry) + 1}`);
      remove.append(icon('close'));
      remove.addEventListener('click', () => removePhoto(entry));
      tile.append(remove);
      ui.photos.append(tile);
    }
  }

  /* ------------------------------ destination ------------------------------ */

  function setDestination(destination) {
    state.destination = destination;
    ui.destLabel.textContent = destination.label;
    ui.destIcon.replaceChildren(icon(destination.type === 'game' ? 'game' : destination.type === 'community' ? 'group' : 'globe'));
  }

  async function loadCatalog() {
    if (state.catalog || state.catalogLoading) return;
    state.catalogLoading = true;
    const [games, mine] = await Promise.allSettled([api('/games?limit=100'), api('/communities/mine')]);
    state.catalog = {
      games: games.status === 'fulfilled' ? (games.value.items || []) : [],
      groups: mine.status === 'fulfilled' ? (mine.value.items || []) : [],
    };
    state.catalogLoading = false;
    if (!ui.panel.hidden) renderDestinations();
  }

  function openPanel() {
    ui.panel.hidden = false;
    ui.destButton.setAttribute('aria-expanded', 'true');
    ui.searchInput.value = '';
    renderDestinations();
    void loadCatalog();
    ui.searchInput.focus();
  }

  function closePanel() {
    if (!ui) return;
    ui.panel.hidden = true;
    ui.destButton.setAttribute('aria-expanded', 'false');
  }

  function renderDestinations() {
    const query = ui.searchInput.value.trim().toLowerCase();
    ui.list.replaceChildren();
    const add = (heading, rows) => {
      if (!rows.length) return;
      ui.list.append(el('p', 'cmp-group', heading));
      for (const row of rows) {
        const option = el('button', 'cmp-option');
        option.type = 'button';
        option.setAttribute('role', 'option');
        const selected = state.destination.type === row.type && (state.destination.target || null) === (row.target || null);
        option.setAttribute('aria-selected', String(selected));
        option.append(icon(row.type === 'game' ? 'game' : row.type === 'community' ? 'group' : 'globe'));
        const text = el('span', 'cmp-option-text');
        text.append(el('strong', '', row.label));
        if (row.hint) text.append(el('small', '', row.hint));
        option.append(text);
        if (selected) option.append(icon('check'));
        option.addEventListener('click', () => { setDestination({ type: row.type, target: row.target || null, label: row.label }); closePanel(); ui.text.focus(); });
        ui.list.append(option);
      }
    };
    const matches = (label) => !query || label.toLowerCase().includes(query);
    const everywhere = [{ type: 'general', target: null, label: 'Public feed', hint: 'Everyone on Arcadia can see this' }].filter((row) => matches(row.label));
    add('Everywhere', everywhere);
    if (!state.catalog) {
      ui.list.append(el('p', 'cmp-note', 'Loading your games and communities…'));
      return;
    }
    add('Your communities', state.catalog.groups.filter((g) => matches(g.name)).map((g) => ({ type: 'community', target: g.slug, label: g.name, hint: `c/${g.slug}` })));
    add('Games', state.catalog.games.filter((g) => matches(g.name)).slice(0, 40).map((g) => ({ type: 'game', target: g.slug, label: g.name })));
    if (!ui.list.children.length) ui.list.append(el('p', 'cmp-note', 'Nothing matches that search.'));
  }

  /* ------------------------------ submit ------------------------------ */

  async function submit() {
    if (!canPost()) return;
    const user = getUser();
    if (!user) { dialog.close(); openAuth?.('compose'); return; }
    state.posting = true;
    setError();
    refresh();
    try {
      const body = state.text.trim();
      const form = new FormData();
      form.append('body', body);
      const { type, target } = state.destination;
      form.append('destinations', JSON.stringify([target ? { type, target } : { type }]));
      for (const photo of state.photos) form.append('photos', photo.file, photo.file.name);
      const data = await api('/posts', { method: 'POST', body: form });
      const post = data.post;
      if (post) {
        const key = `${type}:${target}`;
        post.labels = target ? { [key]: state.destination.label } : {};
        post.author = post.author?.username ? post.author : user;
      }
      reset();
      state.posting = false;
      refresh();
      dialog.close();
      toast('Your post is live.');
      onPosted?.(post, { ...state.destination });
    } catch (error) {
      state.posting = false;
      setError(error.message || 'Could not publish your post. Please try again.');
      refresh();
    }
  }

  function reset() {
    for (const photo of state.photos) if (photo.url) URL.revokeObjectURL(photo.url);
    state.photos = [];
    state.text = '';
    if (ui) { ui.text.value = ''; autosize(); renderPhotos(); setError(); }
  }

  /* ------------------------------ public ------------------------------ */

  function open(options = {}) {
    const user = getUser();
    if (!user) { openAuth?.('compose'); return; }
    if (!dialog) build();
    const initial = (user.displayName || user.username || '?')[0].toUpperCase();
    ui.avatar.textContent = initial;
    setAvatar?.(ui.avatar, user.avatar, initial);
    ui.name.textContent = user.displayName || user.username;
    setDestination(options.destination || state.destination);
    ui.text.value = state.text;
    renderPhotos();
    setError();
    refresh();
    void loadCatalog();
    dialog.showModal();
    autosize();
    if (options.photo && state.photos.length < MAX_PHOTOS) ui.file.click();
    else if (options.pickDestination) openPanel();
    else ui.text.focus();
  }

  return { open, close: () => dialog?.close() };
}
