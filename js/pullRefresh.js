/* Pull down to refresh the page you're on (feed, communities, profile...).
   It only reloads that page's content; it never takes you home. Works from the
   very top of a page, ignores sheets, chats and sideways carousels. */

const SKIP = 'dialog, .dr-panel, .arc-chat-overlay, .lfg-sheet, .sf-sheet, .so-sheet, .circle-track, input, textarea, select, [data-no-ptr]';
const THRESHOLD = 64;
const MAX_PULL = 110;

export function initPullRefresh({ onRefresh }) {
  if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;

  const indicator = document.createElement('div');
  indicator.className = 'ptr';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v12m0 0-5-5m5 5 5-5"/></svg>';
  document.body.append(indicator);
  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  document.body.append(live);

  let startY = 0;
  let startX = 0;
  let pull = 0;
  let tracking = false;
  let busy = false;

  const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

  function paint(distance, ready) {
    indicator.style.setProperty('--ptr-y', `${distance}px`);
    indicator.style.setProperty('--ptr-turn', `${ready ? 180 : Math.min(180, (distance / THRESHOLD) * 180)}deg`);
    indicator.classList.toggle('is-ready', ready);
    indicator.classList.toggle('is-visible', distance > 4);
  }

  document.addEventListener('touchstart', (event) => {
    if (busy || event.touches.length !== 1) return;
    if (document.documentElement.classList.contains('is-locked')) return;
    if (event.target instanceof Element && event.target.closest(SKIP)) return;
    if (!atTop()) return;
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
    pull = 0;
    tracking = true;
    indicator.classList.remove('is-animating');
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!tracking || busy) return;
    const touch = event.touches[0];
    const dy = touch.clientY - startY;
    const dx = touch.clientX - startX;
    if (!atTop() || dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
      if (pull > 0) { pull = 0; paint(0, false); }
      if (dy <= 0) tracking = false;
      return;
    }
    // Small finger movements are taps, not pulls: leave them alone so buttons still click.
    if (dy < 14) return;
    pull = Math.min(MAX_PULL, (dy - 14) * 0.5);
    if (event.cancelable) event.preventDefault();
    paint(pull, pull >= THRESHOLD);
  }, { passive: false });

  async function end() {
    if (!tracking) return;
    tracking = false;
    indicator.classList.add('is-animating');
    if (pull >= THRESHOLD && !busy) {
      busy = true;
      indicator.classList.add('is-loading');
      paint(THRESHOLD, true);
      live.textContent = 'Refreshing';
      const started = Date.now();
      try { await onRefresh(); } catch { /* the page shows its own error */ }
      const wait = Math.max(0, 600 - (Date.now() - started));
      await new Promise((resolve) => window.setTimeout(resolve, wait));
      live.textContent = 'Refreshed';
      indicator.classList.remove('is-loading');
      busy = false;
    }
    pull = 0;
    paint(0, false);
  }
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}
