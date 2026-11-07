import { layerHost, swallowEscape } from './layers.js';

/* A small, consistent "are you sure?" sheet. Returns a promise: true if confirmed. */

export function confirmSheet({ title, message = '', confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sf-overlay';
    const box = document.createElement('div');
    box.className = 'sf-sheet';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    const heading = document.createElement('h2');
    heading.textContent = title;
    box.append(heading);
    if (message) {
      const text = document.createElement('p');
      text.className = 'sf-sub';
      text.textContent = message;
      box.append(text);
    }
    const row = document.createElement('div');
    row.className = 'sf-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'sf-btn'; cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = `sf-btn ${danger ? 'sf-btn--danger' : 'sf-btn--solid'}`; ok.textContent = confirmLabel;
    row.append(cancel, ok);
    box.append(row);
    overlay.append(box);

    const finish = (value) => { overlay.remove(); document.body.classList.remove('sf-open'); resolve(value); };
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) finish(false); });
    box.addEventListener('keydown', (event) => { if (swallowEscape(event)) finish(false); });
    layerHost().append(overlay);
    document.body.classList.add('sf-open');
    cancel.focus();
  });
}
