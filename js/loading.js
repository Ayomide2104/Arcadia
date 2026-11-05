/* Loading feedback.
   - hideSplash(): fades out the Arcadia launch screen once the app is ready.
   - createLoader(): watches network requests. If something is in flight for a while
     it shows a thin progress bar (after 250ms) and a small branded card (after 1s).
     Quiet background checks (chat sync, notifications, presence) never trigger it. */

const QUIET = ['/messages', '/notifications', '/presence', '/points/shares', '/auth/me', '/posts/seen', '/feed/'];
const BAR_DELAY = 250;
const CARD_DELAY = 1000;
const SPLASH_MIN = 550;
const SPLASH_MAX = 9000;

let splashHidden = false;

export function initSplash() {
  const splash = document.querySelector('#splash');
  if (!splash) return;
  window.setTimeout(() => splash.classList.add('is-slow'), 2500);
  window.setTimeout(hideSplash, SPLASH_MAX); // never trap someone on the launch screen
}

export function hideSplash() {
  if (splashHidden) return;
  const splash = document.querySelector('#splash');
  if (!splash) { splashHidden = true; return; }
  const elapsed = typeof performance !== 'undefined' ? performance.now() : SPLASH_MIN;
  const wait = Math.max(0, SPLASH_MIN - elapsed);
  window.setTimeout(() => {
    if (splashHidden) return;
    splashHidden = true;
    splash.classList.add('is-leaving');
    window.setTimeout(() => splash.remove(), 450);
  }, wait);
}

export function createLoader() {
  let active = 0;
  let barTimer = null;
  let cardTimer = null;
  let bar = null;
  let card = null;

  function ensure() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'pl-bar';
    bar.setAttribute('aria-hidden', 'true');
    card = document.createElement('div');
    card.className = 'pl-card';
    card.setAttribute('role', 'status');
    const mark = document.createElement('span');
    mark.className = 'pl-mark';
    const img = document.createElement('img');
    img.src = '/assets/arcadia/brand/logo-mark.svg';
    img.alt = '';
    mark.append(img);
    const text = document.createElement('span');
    text.textContent = 'Still loading…';
    card.append(mark, text);
    document.body.append(bar, card);
  }

  function show() {
    if (!active) return;
    ensure();
  }

  function begin(path = '', options = {}) {
    if (options.quiet || QUIET.some((prefix) => String(path).startsWith(prefix))) return () => {};
    active += 1;
    if (active === 1) {
      barTimer = window.setTimeout(() => { show(); bar?.classList.add('is-on'); }, BAR_DELAY);
      cardTimer = window.setTimeout(() => { show(); card?.classList.add('is-on'); }, CARD_DELAY);
    }
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      active = Math.max(0, active - 1);
      if (active === 0) {
        window.clearTimeout(barTimer);
        window.clearTimeout(cardTimer);
        bar?.classList.remove('is-on');
        card?.classList.remove('is-on');
      }
    };
  }

  return { begin };
}
