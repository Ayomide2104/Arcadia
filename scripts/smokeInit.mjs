/*
 * Start-up smoke test: loads js/main.js against a fake page and fails on
 * ReferenceError / "before initialization" mistakes (using something before it is
 * defined), which crash the whole app on load.
 *
 *   npm run smoke
 */
const quiet = () => {};

function makeStub() {
  const target = function stub() {};
  const own = {};
  const proxy = new Proxy(target, {
    get(_t, prop) {
      if (prop in own) return own[prop];
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;
      if (prop === Symbol.iterator) return function* iterate() {};
      if (prop === 'length') return 0;
      if (prop === 'querySelectorAll' || prop === 'getElementsByClassName' || prop === 'getElementsByTagName') return () => [];
      if (prop === 'dataset') return (own.dataset = {});
      if (prop === 'classList') return (own.classList = { add: quiet, remove: quiet, toggle: quiet, contains: () => false });
      if (prop === 'style') return (own.style = { setProperty: quiet, removeProperty: quiet });
      if (prop === 'children' || prop === 'childNodes') return [];
      if (prop === 'open' || prop === 'hidden' || prop === 'checked' || prop === 'disabled') return false;
      if (prop === 'value' || prop === 'textContent' || prop === 'innerHTML' || prop === 'id' || prop === 'className') return '';
      return proxy;
    },
    set(_t, prop, value) { own[prop] = value; return true; },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

const page = makeStub();
const memory = new Map();
const g = globalThis;
class FakeElement {}
Object.assign(g, {
  window: g,
  document: new Proxy(makeStub(), {
    get(t, prop) {
      if (prop === 'addEventListener' || prop === 'removeEventListener') return quiet;
      if (prop === 'readyState') return 'complete';
      if (prop === 'visibilityState') return 'visible';
      if (prop === 'cookie') return '';
      if (prop === 'createElementNS' || prop === 'createElement' || prop === 'createTextNode' || prop === 'createDocumentFragment') return () => makeStub();
      if (prop === 'documentElement' || prop === 'body') return page;
      return t[prop];
    },
  }),
  localStorage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) },
  sessionStorage: { getItem: () => null, setItem: quiet, removeItem: quiet },
  matchMedia: () => ({ matches: false, addEventListener: quiet, removeEventListener: quiet, addListener: quiet }),
  addEventListener: quiet,
  removeEventListener: quiet,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: quiet,
  requestIdleCallback: () => 0,
  fetch: () => Promise.reject(new Error('offline (smoke test)')),
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  Element: FakeElement, HTMLElement: FakeElement, HTMLInputElement: FakeElement, HTMLTextAreaElement: FakeElement, Node: FakeElement,
  CSS: { escape: (v) => String(v), supports: () => false },
  Image: class {},
  FormData: class { append() {} },
  matchMediaQuery: quiet,
  scrollTo: quiet,
  getComputedStyle: () => ({ getPropertyValue: () => '', display: 'block', position: 'fixed' }),
  history: { replaceState: quiet, pushState: quiet, state: null },
  innerWidth: 390, innerHeight: 800, scrollY: 0,
  visualViewport: null,
});
Object.defineProperty(g, 'location', { value: { hash: '', pathname: '/', search: '', origin: 'http://localhost', href: 'http://localhost/', host: 'localhost', hostname: 'localhost', protocol: 'http:' }, configurable: true });
Object.defineProperty(g, 'navigator', { value: { userAgent: 'smoke', maxTouchPoints: 0, onLine: true, clipboard: {}, serviceWorker: undefined }, configurable: true });

process.on('unhandledRejection', quiet);
const timers = setTimeout(() => {}, 0);
clearTimeout(timers);

const problems = [];
const original = console.error;
try {
  await import('../js/main.js');
} catch (error) {
  problems.push(error);
}
await new Promise((resolve) => setTimeout(resolve, 300));

const fatal = problems.find((error) => error instanceof ReferenceError || /before initialization|is not defined/.test(String(error?.message)));
if (fatal) {
  console.error(`\nSMOKE TEST FAILED: ${fatal.name}: ${fatal.message}\n${String(fatal.stack).split('\n').slice(1, 4).join('\n')}\n`);
  process.exit(1);
}
if (problems.length) {
  console.warn(`Smoke test: loaded, with a non-fatal note from the fake page: ${problems[0].message}`);
}
console.log('Smoke test passed: js/main.js starts without start-up order errors.');
original;
process.exit(0);
