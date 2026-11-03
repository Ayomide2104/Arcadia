/* Report and block: one small module used by posts, comments, profiles and invites. */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const REASONS = [
  ['spam', 'Spam or fake account'],
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate or abusive content'],
  ['sexual', 'Sexual or inappropriate content'],
  ['scam', 'Scam or trying to steal info'],
  ['underage', 'Someone who seems underage and at risk'],
  ['other', 'Something else'],
];

const TYPE_LABEL = { post: 'post', comment: 'comment', user: 'player', lfg: 'invite' };

export function createSafety({ api, toast, getUser, onNeedSignIn, setAvatar, onBlocked }) {
  function sheet(build) {
    const overlay = el('div', 'sf-overlay');
    const box = el('form', 'sf-sheet');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const close = () => { overlay.remove(); document.body.classList.remove('sf-open'); };
    build(box, close);
    overlay.append(box);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
    box.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    document.body.append(overlay); document.body.classList.add('sf-open');
    (box.querySelector('input, button') || box).focus?.();
  }

  /** Report a post, comment, player or invite. */
  function report({ type, target, label = '' }) {
    if (!getUser()) { onNeedSignIn(); return; }
    sheet((box, close) => {
      box.setAttribute('aria-label', `Report ${TYPE_LABEL[type]}`);
      box.append(el('h2', '', `Report this ${TYPE_LABEL[type]}`));
      if (label) box.append(el('p', 'sf-sub', label));
      box.append(el('p', 'sf-sub', 'Reports are private. We review them, and the person won’t know it was you.'));
      const group = el('div', 'sf-reasons'); group.setAttribute('role', 'radiogroup');
      let chosen = '';
      for (const [value, text] of REASONS) {
        const row = el('label', 'sf-reason');
        const input = el('input'); input.type = 'radio'; input.name = 'reason'; input.value = value;
        input.addEventListener('change', () => { chosen = value; send.disabled = false; });
        row.append(input, el('span', '', text));
        group.append(row);
      }
      const details = el('textarea', 'sf-input'); details.rows = 3; details.maxLength = 500; details.placeholder = 'Anything else we should know? (optional)';
      const error = el('p', 'sf-error'); error.hidden = true;
      const row = el('div', 'sf-actions');
      const cancel = el('button', 'sf-btn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', close);
      const send = el('button', 'sf-btn sf-btn--solid', 'Send report'); send.type = 'submit'; send.disabled = true;
      row.append(cancel, send);
      box.append(group, details, error, row);
      box.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!chosen) return;
        send.disabled = true;
        try {
          await api('/safety/reports', { method: 'POST', body: JSON.stringify({ type, target, reason: chosen, details: details.value.trim() }) });
          close(); toast('Thanks. We’ll take a look.');
        } catch (failure) { error.textContent = failure.message || 'Could not send your report.'; error.hidden = false; send.disabled = false; }
      });
    });
  }

  /** Block a player after a clear confirmation. */
  function block(user) {
    if (!getUser()) { onNeedSignIn(); return; }
    if (!user?.username) return;
    const name = user.displayName || user.username;
    sheet((box, close) => {
      box.setAttribute('aria-label', `Block ${name}`);
      box.append(el('h2', '', `Block ${name}?`));
      const list = el('ul', 'sf-list');
      for (const line of [
        'You won’t see each other’s posts, comments or invites.',
        'You can’t message each other or send friend requests.',
        'If you’re friends, you’ll be removed from each other’s lists.',
        'They aren’t told you blocked them. You can unblock any time in Settings.',
      ]) list.append(el('li', '', line));
      const error = el('p', 'sf-error'); error.hidden = true;
      const row = el('div', 'sf-actions');
      const cancel = el('button', 'sf-btn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', close);
      const go = el('button', 'sf-btn sf-btn--danger', `Block @${user.username}`); go.type = 'submit';
      row.append(cancel, go);
      box.append(list, error, row);
      box.addEventListener('submit', async (event) => {
        event.preventDefault(); go.disabled = true;
        try {
          await api(`/safety/blocks/${encodeURIComponent(user.username)}`, { method: 'POST' });
          close(); toast(`Blocked @${user.username}.`); onBlocked?.(user);
        } catch (failure) { error.textContent = failure.message || 'Could not block this player.'; error.hidden = false; go.disabled = false; }
      });
    });
  }

  async function unblock(username) {
    await api(`/safety/blocks/${encodeURIComponent(username)}`, { method: 'DELETE' });
  }

  /** Settings card body: the people you blocked, with Unblock. */
  async function renderBlockedList(host) {
    host.replaceChildren(el('p', 'st-desc', 'Loading…'));
    try {
      const data = await api('/safety/blocks');
      host.replaceChildren();
      if (!data.items.length) { host.append(el('p', 'st-desc', 'You haven’t blocked anyone.')); return; }
      for (const person of data.items) {
        const row = el('div', 'st-muted-row sf-row');
        const avatar = el('span', 'avatar sf-avatar', (person.displayName || person.username)[0].toUpperCase());
        setAvatar?.(avatar, person.avatar, avatar.textContent);
        const text = el('span', 'sf-who'); text.append(el('strong', '', person.displayName || person.username), el('span', '', `@${person.username}`));
        const undo = el('button', 'button', 'Unblock'); undo.type = 'button';
        undo.addEventListener('click', async () => {
          undo.disabled = true;
          try { await unblock(person.username); row.remove(); toast(`Unblocked @${person.username}.`); }
          catch (failure) { toast(failure.message); undo.disabled = false; }
        });
        row.append(avatar, text, undo);
        host.append(row);
      }
    } catch { host.replaceChildren(el('p', 'st-desc', 'Could not load your blocked players.')); }
  }

  return { report, block, unblock, renderBlockedList };
}
