/* Menus that never get cut off.
   The menu is moved to the page level and placed with fixed coordinates next to
   its button, so post cards, photos and scrolling areas can't clip or cover it.
   It flips upward near the bottom of the screen and closes on outside tap,
   scroll, resize and Escape. */

import { layerHost } from './layers.js';

let current = null;

export function closeMenus() {
  if (current) current.hide();
}

export function attachMenu(button, menu, { onOpen } = {}) {
  menu.hidden = true;
  menu.classList.add('fm-pop');
  let isOpen = false;
  let openedAt = 0;
  let anchorTop = 0;
  let anchorLeft = 0;

  function place() {
    const rect = button.getBoundingClientRect();
    const vv = window.visualViewport;
    const width = window.innerWidth;
    const height = vv ? vv.height : window.innerHeight;
    menu.style.visibility = 'hidden';
    menu.hidden = false;
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const left = Math.min(Math.max(8, rect.right - menuWidth), Math.max(8, width - menuWidth - 8));
    let top = rect.bottom + 6;
    if (top + menuHeight > height - 8) top = Math.max(8, rect.top - menuHeight - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(160, height - 16)}px`;
    menu.style.visibility = '';
  }

  const onPointer = (event) => { if (!menu.contains(event.target) && !button.contains(event.target)) hide(); };
  const onKey = (event) => { if (event.key === 'Escape') { hide(); button.focus?.({ preventScroll: true }); } };
  // Phones fire scroll/resize events for harmless reasons (address bar, keyboard, momentum).
  // Only close when the button itself has really moved away.
  const onMove = (event) => {
    if (Date.now() - openedAt < 400) return;
    if (event && event.target instanceof Node && menu.contains(event.target)) return;
    if (!button.isConnected) { hide(); return; }
    const rect = button.getBoundingClientRect();
    if (Math.abs(rect.top - anchorTop) > 28 || Math.abs(rect.left - anchorLeft) > 28) hide();
  };

  function show(focusFirst = false) {
    if (current && current !== api) current.hide();
    onOpen?.();
    layerHost().append(menu);
    place();
    { const rect = button.getBoundingClientRect(); anchorTop = rect.top; anchorLeft = rect.left; }
    isOpen = true;
    openedAt = Date.now();
    current = api;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    if (focusFirst) menu.querySelector('button')?.focus({ preventScroll: true });
  }

  function hide() {
    if (!isOpen) return;
    isOpen = false;
    if (current === api) current = null;
    menu.hidden = true;
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onMove, true);
    window.removeEventListener('resize', onMove);
  }

  const api = { show, hide, toggle: (focusFirst = false) => (isOpen ? hide() : show(focusFirst)), isOpen: () => isOpen };
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  // Keyboard users (detail 0) get focus moved into the menu; touch and mouse users don't.
  button.addEventListener('click', (event) => { event.stopPropagation(); api.toggle(event.detail === 0); });
  return api;
}
