/* Bottom bar: an iOS-style sliding highlight that glides between buttons (passing under the + button),
   and hiding on scroll down / showing on scroll up without flicker. */

const dockEl = () => document.querySelector('.mobile-dock');

export function updateDockPill() {
  const dock = dockEl();
  const pill = dock?.querySelector('.dock-pill');
  if (!dock || !pill) return;
  const active = dock.querySelector('.nav-item.is-active');
  if (!active || dock.offsetParent === null && getComputedStyle(dock).position !== 'fixed') { pill.classList.remove('is-on'); return; }
  const d = dock.getBoundingClientRect();
  const a = active.getBoundingClientRect();
  if (!a.width) { pill.classList.remove('is-on'); return; }
  pill.style.width = `${a.width}px`;
  pill.style.height = `${a.height}px`;
  pill.style.transform = `translate(${a.left - d.left - dock.clientLeft}px, ${a.top - d.top - dock.clientTop}px)`;
  pill.classList.add('is-on');
}

export function initDock() {
  const dock = dockEl();
  if (!dock) return;

  // Highlight position: on start, on resize and once fonts/layout settle.
  window.requestAnimationFrame(updateDockPill);
  window.addEventListener('resize', updateDockPill);
  window.addEventListener('orientationchange', () => window.setTimeout(updateDockPill, 250));
  if (document.fonts?.ready) document.fonts.ready.then(updateDockPill).catch(() => {});
  if (typeof ResizeObserver === 'function') new ResizeObserver(updateDockPill).observe(dock);

  // Hide on scroll down, show on scroll up. A little hysteresis keeps it from flickering.
  let last = window.scrollY;
  let dir = 0;
  let dirStart = last;
  let hidden = false;
  let ticking = false;

  function set(value) {
    if (hidden === value) return;
    hidden = value;
    dock.classList.toggle('is-hidden', value);
  }

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      if (window.innerWidth >= 900 || document.documentElement.classList.contains('is-locked')) { set(false); return; }
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const y = Math.min(Math.max(0, window.scrollY), max); // ignore rubber-band overscroll
      const delta = y - last;
      last = y;
      if (y <= 80 || y >= max - 6) { set(false); dir = 0; dirStart = y; return; }
      if (delta === 0) return;
      if (Math.sign(delta) !== dir) { dir = Math.sign(delta); dirStart = y - delta; }
      const travelled = y - dirStart;
      if (dir > 0 && travelled > 28) set(true);
      else if (dir < 0 && travelled < -10) set(false);
    });
  }, { passive: true });
}
