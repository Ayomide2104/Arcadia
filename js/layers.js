/* Where to attach sheets, menus and confirmations.
   A modal <dialog> (like the comment sheet) makes everything outside it unclickable, so anything
   opened from inside it must live inside it. Otherwise it goes on the page itself. */

export function layerHost() {
  const dialogs = document.querySelectorAll('dialog[open]');
  return dialogs.length ? dialogs[dialogs.length - 1] : document.body;
}

/** Escape should close the topmost thing only (not the sheet behind it). */
export function swallowEscape(event) {
  if (event.key !== 'Escape') return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
