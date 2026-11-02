/* A simple full-screen photo viewer: arrows, swipe, Esc, and a counter. */
let dialog = null;
let ui = null;
let images = [];
let index = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(path) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  node.append(p);
  return node;
}

function build() {
  dialog = el('dialog', 'lb');
  dialog.setAttribute('aria-label', 'Photo viewer');
  const stage = el('div', 'lb-stage');
  const img = el('img', 'lb-image');
  const close = el('button', 'lb-btn lb-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close photo viewer'); close.append(svg('M6 6l12 12M18 6 6 18'));
  const prev = el('button', 'lb-btn lb-prev'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous photo'); prev.append(svg('m15 5-7 7 7 7'));
  const next = el('button', 'lb-btn lb-next'); next.type = 'button'; next.setAttribute('aria-label', 'Next photo'); next.append(svg('m9 5 7 7-7 7'));
  const counter = el('span', 'lb-counter');
  const open = el('a', 'lb-open', 'Open original'); open.target = '_blank'; open.rel = 'noopener noreferrer';
  stage.append(img);
  dialog.append(stage, close, prev, next, counter, open);
  document.body.append(dialog);
  ui = { img, prev, next, counter, open };

  close.addEventListener('click', () => dialog.close());
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  dialog.addEventListener('click', (event) => { if (event.target === dialog || event.target === stage) dialog.close(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') go(-1);
    if (event.key === 'ArrowRight') go(1);
  });
  let startX = null;
  stage.addEventListener('touchstart', (event) => { startX = event.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (event) => {
    if (startX === null) return;
    const dx = event.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
}

function go(step) {
  if (images.length < 2) return;
  index = (index + step + images.length) % images.length;
  show();
}

function show() {
  const item = images[index];
  ui.img.src = item.url;
  ui.img.alt = item.alt || 'Post photo';
  ui.open.href = item.url;
  ui.counter.textContent = images.length > 1 ? `${index + 1} / ${images.length}` : '';
  ui.prev.hidden = ui.next.hidden = images.length < 2;
}

export function openLightbox(list, start = 0) {
  if (!list?.length) return;
  if (!dialog) build();
  images = list;
  index = Math.min(Math.max(0, start), list.length - 1);
  show();
  dialog.showModal();
}
