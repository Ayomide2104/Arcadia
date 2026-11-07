/* Swipe from the left edge to go back, with no button on screen.
   - On an inner page: the page slides away with your finger and you return to the page you came from.
   - On Home: the same swipe opens the menu drawer instead (there is nowhere further back to go).
   Only starts from the very edge of the screen, so it never fights sideways scrolling in content. */

const EDGE = 24; // px from the left edge where a swipe may begin
const COMMIT = 84; // px dragged before it counts
const SKIP = 'input, textarea, select, .circle-track, [data-no-swipe], .arc-chat-overlay, .lb';

export function initSwipeBack({ canGoBack, goBack, openMenu, isHome }) {
  if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;

  let startX = 0;
  let startY = 0;
  let startT = 0;
  let tracking = false;
  let engaged = false;
  let panel = null;
  let dx = 0;

  const activePanel = () => document.querySelector('[data-panel]:not([hidden])');

  document.addEventListener('touchstart', (event) => {
    tracking = false; engaged = false;
    if (event.touches.length !== 1) return;
    const root = document.documentElement;
    if (root.classList.contains('is-locked') || document.querySelector('dialog[open], .dr-panel')) return;
    const touch = event.touches[0];
    if (touch.clientX > EDGE) return;
    if (event.target instanceof Element && event.target.closest(SKIP)) return;
    startX = touch.clientX; startY = touch.clientY; startT = Date.now(); dx = 0;
    tracking = true;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!tracking) return;
    const touch = event.touches[0];
    const moveX = touch.clientX - startX;
    const moveY = touch.clientY - startY;
    if (!engaged) {
      if (Math.abs(moveY) > 14 && Math.abs(moveY) > Math.abs(moveX)) { tracking = false; return; } // it's a scroll
      if (moveX > 10 && moveX > Math.abs(moveY) * 1.3) {
        engaged = true;
        if (!isHome() && canGoBack()) {
          panel = activePanel();
          if (panel) { panel.style.transition = 'none'; panel.style.willChange = 'transform'; panel.classList.add('swipe-dragging'); }
        }
      } else return;
    }
    dx = Math.max(0, moveX);
    if (event.cancelable) event.preventDefault();
    if (panel) panel.style.transform = `translateX(${dx * 0.92}px)`;
  }, { passive: false });

  function resetPanel(animate) {
    if (!panel) return;
    const node = panel;
    panel = null;
    node.style.transition = animate ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : 'none';
    node.style.transform = '';
    window.setTimeout(() => { node.style.transition = ''; node.style.willChange = ''; node.classList.remove('swipe-dragging'); }, 260);
  }

  function end() {
    if (!tracking || !engaged) { tracking = false; return; }
    tracking = false;
    const velocity = dx / Math.max(1, Date.now() - startT);
    const commit = dx > COMMIT || (dx > 40 && velocity > 0.45);
    if (!commit) { resetPanel(true); return; }
    if (isHome()) { resetPanel(false); openMenu(); return; }
    if (!panel) { goBack(); return; }
    const node = panel;
    node.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
    node.style.transform = `translateX(${window.innerWidth}px)`;
    node.style.opacity = '.6';
    window.setTimeout(() => {
      goBack();
      panel = node;
      node.style.opacity = '';
      resetPanel(false);
    }, 190);
  }
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', () => { tracking = false; resetPanel(true); }, { passive: true });
}
