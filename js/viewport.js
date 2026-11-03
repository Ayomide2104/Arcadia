/* Screen behaviour that has to be right on every phone:
   1) Lock the page behind any open dialog/sheet/drawer, so only the sheet scrolls.
   2) Track the on-screen keyboard (CSS variables --visual-vh and --keyboard-inset)
      so sheets and the comment box stay above the keyboard instead of being pushed around. */

const LOCK = 'dialog[open], .lfg-overlay, .sf-overlay, .so-overlay, .dr-panel';

export function initViewport() {
  const root = document.documentElement;
  let locked = false;
  let savedY = 0;

  function updateLock() {
    const need = document.querySelector(LOCK) !== null;
    if (need === locked) return;
    locked = need;
    if (need) {
      savedY = window.scrollY;
      document.body.style.top = `-${savedY}px`;
      root.classList.add('is-locked');
    } else {
      root.classList.remove('is-locked');
      document.body.style.top = '';
      window.scrollTo({ top: savedY, left: 0, behavior: 'instant' });
    }
  }
  new MutationObserver(updateLock).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  updateLock();

  const vv = window.visualViewport;
  function syncKeyboard() {
    const height = vv ? vv.height : window.innerHeight;
    const inset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty('--visual-vh', `${Math.round(height)}px`);
    root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
    root.classList.toggle('kb-open', inset > 120 || (vv && window.innerHeight - vv.height > 120));
  }
  if (vv) { vv.addEventListener('resize', syncKeyboard); vv.addEventListener('scroll', syncKeyboard); }
  window.addEventListener('orientationchange', () => window.setTimeout(syncKeyboard, 250));
  syncKeyboard();

  // When a field inside a sheet is focused, keep it in view above the keyboard.
  document.addEventListener('focusin', (event) => {
    const field = event.target;
    if (!(field instanceof HTMLElement) || !field.matches('input, textarea, select')) return;
    if (!field.closest('dialog, .lfg-sheet, .sf-sheet, .so-sheet')) return;
    window.setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280);
  });
}
