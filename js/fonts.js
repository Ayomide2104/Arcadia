/* Fonts: the catalogue, applying a choice, and the picker shown in Settings.

   - "Site font": the readable font used for text everywhere.
   - "Display font": headings, the logo and big numbers only (decorative fonts live here,
     so a fun font can never make the app hard to read).
   Free fonts are open to everyone. Store fonts show a lock until they are unlocked with
   Arcadian points (the store comes with the points redesign). */

const SYSTEM = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// price is a placeholder tier for the store: tuned later in the points redesign.
export const FONTS = [
  // Site fonts, free
  { id: 'plus-jakarta-sans', label: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans'", kind: 'body', tier: 'free', note: 'Arcadia default' },
  { id: 'dm-sans', label: 'DM Sans', family: "'DM Sans'", kind: 'body', tier: 'free', note: 'Clean and calm' },
  { id: 'manrope', label: 'Manrope', family: "'Manrope'", kind: 'body', tier: 'free', note: 'Modern and sharp' },
  { id: 'outfit', label: 'Outfit', family: "'Outfit'", kind: 'body', tier: 'free', note: 'Round and friendly' },
  { id: 'satoshi', label: 'Satoshi', family: "'Satoshi'", kind: 'body', tier: 'free', note: 'Smooth, app-like' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk'", kind: 'body', tier: 'free', note: 'Techy, gamer feel' },
  { id: 'system', label: 'Device default', family: SYSTEM.split(',')[0], kind: 'body', tier: 'free', note: 'Fastest to load' },
  // Site fonts, store
  { id: 'bricolage-grotesque', label: 'Bricolage Grotesque', family: "'Bricolage Grotesque'", kind: 'body', tier: 'store', price: 300, note: 'Characterful' },
  { id: 'redaction-50', label: 'Redaction 50', family: "'Redaction 50'", kind: 'body', tier: 'store', price: 400, note: 'Editorial serif' },
  // Display fonts (headings only), store
  { id: 'bricolage-display', label: 'Bricolage Grotesque', family: "'Bricolage Grotesque'", kind: 'display', tier: 'store', price: 300, note: 'Bold headlines' },
  { id: 'redaction-70', label: 'Redaction 70', family: "'Redaction 70'", kind: 'display', tier: 'store', price: 400, note: 'Distressed serif' },
  { id: 'passero-one', label: 'Passero One', family: "'Passero One'", kind: 'display', tier: 'store', price: 400, note: 'Chunky and playful' },
  { id: 'momo-signature', label: 'Momo Signature', family: "'Momo Signature'", kind: 'display', tier: 'store', price: 500, note: 'Handwritten signature' },
  { id: 'silkscreen', label: 'Silkscreen', family: "'Silkscreen'", kind: 'display', tier: 'store', price: 500, note: 'Pixel arcade' },
  { id: 'coral-pixels', label: 'Coral Pixels', family: "'Coral Pixels'", kind: 'display', tier: 'store', price: 500, note: 'Soft pixel' },
  { id: 'rubik-glitch', label: 'Rubik Glitch', family: "'Rubik Glitch'", kind: 'display', tier: 'store', price: 700, note: 'Glitched' },
  { id: 'rubik-puddles', label: 'Rubik Puddles', family: "'Rubik Puddles'", kind: 'display', tier: 'store', price: 700, note: 'Melting' },
  { id: 'kablammo', label: 'Kablammo', family: "'Kablammo'", kind: 'display', tier: 'store', price: 900, note: 'Explosive, animated' },
  { id: 'nabla', label: 'Nabla', family: "'Nabla'", kind: 'display', tier: 'store', price: 900, note: 'Colourful 3D' },
  { id: 'honk', label: 'Honk', family: "'Honk'", kind: 'display', tier: 'store', price: 900, note: 'Wild and colourful' },
];

const DEFAULT_BODY = 'plus-jakarta-sans';
const DEFAULT_DISPLAY = 'default'; // same as the site font
const KEY = 'arcadia.fonts';

const byId = (id) => FONTS.find((font) => font.id === id);

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function write(value) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** Fonts a person may use: all free fonts, plus store fonts they unlocked.
 *  While the store is being built, `localStorage.arcadiaUnlockAllFonts = '1'` previews everything. */
export function ownsFont(font, user) {
  if (font.tier === 'free') return true;
  try { if (localStorage.getItem('arcadiaUnlockAllFonts') === '1') return true; } catch { /* ignore */ }
  return Array.isArray(user?.unlockedFonts) && user.unlockedFonts.includes(font.id);
}

export function applyFonts(choice, user) {
  const saved = choice || read();
  const root = document.documentElement;
  let body = byId(saved.body);
  if (!body || body.kind !== 'body' || !ownsFont(body, user)) body = byId(DEFAULT_BODY);
  const bodyStack = body.id === 'system' ? SYSTEM : `${body.family}, ${SYSTEM}`;
  root.style.setProperty('--font-body', bodyStack);

  let display = byId(saved.display);
  if (!display || display.kind !== 'display' || !ownsFont(display, user)) display = null;
  root.style.setProperty('--font-display', display ? `${display.family}, ${bodyStack}` : 'var(--font-body)');
}

export function initFonts(user) {
  applyFonts(null, user);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Fills `host` (a Settings card) with the two pickers. */
export function renderFontPicker(host, { user, toast }) {
  host.replaceChildren();
  const saved = read();
  const state = { body: byId(saved.body)?.kind === 'body' ? saved.body : DEFAULT_BODY, display: byId(saved.display)?.kind === 'display' ? saved.display : DEFAULT_DISPLAY };

  function pick(kind, font) {
    if (font && !ownsFont(font, user)) { toast(`${font.label} is a store font. Unlock it with Arcadian points once the store opens.`); return; }
    state[kind] = font ? font.id : DEFAULT_DISPLAY;
    write({ body: state.body, display: state.display });
    applyFonts(state, user);
    paint();
  }

  function section(kind, title, note, list, allowNone) {
    const wrap = el('div', 'fp-section');
    wrap.append(el('h3', '', title), el('p', 'fp-note', note));
    const grid = el('div', 'fp-grid');
    if (allowNone) {
      const none = el('button', `fp-option${state.display === DEFAULT_DISPLAY ? ' is-selected' : ''}`);
      none.type = 'button';
      none.setAttribute('aria-pressed', String(state.display === DEFAULT_DISPLAY));
      const sample = el('span', 'fp-sample', 'Aa Arcadia');
      sample.style.fontFamily = 'var(--font-body)';
      none.append(sample, el('span', 'fp-name', 'Same as site font'), el('span', 'fp-meta', 'Default'));
      none.addEventListener('click', () => pick('display', null));
      grid.append(none);
    }
    for (const font of list) {
      const owned = ownsFont(font, user);
      const selected = state[kind] === font.id;
      const option = el('button', `fp-option${selected ? ' is-selected' : ''}${owned ? '' : ' is-locked'}`);
      option.type = 'button';
      option.setAttribute('aria-pressed', String(selected));
      const sample = el('span', 'fp-sample', kind === 'display' ? 'Arcadia 1,250' : 'Aa Arcadia');
      sample.style.fontFamily = font.id === 'system' ? SYSTEM : `${font.family}, ${SYSTEM}`;
      const meta = el('span', 'fp-meta');
      meta.append(el('span', '', font.note || ''));
      if (font.tier === 'store' && !owned) meta.append(el('span', 'fp-badge fp-badge--store', `🔒 ${font.price} pts`));
      else if (font.tier === 'store') meta.append(el('span', 'fp-badge', 'Unlocked'));
      option.append(sample, el('span', 'fp-name', font.label), meta);
      option.addEventListener('click', () => pick(kind, font));
      grid.append(option);
    }
    wrap.append(grid);
    return wrap;
  }

  function paint() {
    host.replaceChildren(
      section('body', 'Site font', 'Used for all text across Arcadia. Free fonts are open to everyone.', FONTS.filter((font) => font.kind === 'body'), false),
      section('display', 'Display font', 'Headings, the logo and big numbers. Decorative fonts live here so the app always stays easy to read.', FONTS.filter((font) => font.kind === 'display'), true)
    );
    const reset = el('button', 'fp-reset', 'Reset to Arcadia default');
    reset.type = 'button';
    reset.addEventListener('click', () => { state.body = DEFAULT_BODY; state.display = DEFAULT_DISPLAY; write({ body: state.body, display: state.display }); applyFonts(state, user); paint(); toast('Fonts reset.'); });
    host.append(reset);
  }
  paint();
}
