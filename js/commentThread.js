/* Reddit-style comment threads, shared by the post sheet and community post pages.

   - Replies can be made to any comment and nest under it.
   - A thin line runs down the left of each thread; click it (or the −/+ button) to collapse.
   - Reply boxes open inline, under the comment being answered.

   The caller supplies how to draw avatars/names/times and how to save a reply, so the
   same code works for both places.                                                      */

import { confirmSheet } from './confirm.js';

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.600-7.500 10.200-7.500 10.200Z"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 11l6-6 6 6"/></svg>';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const idOf = (value) => String(value?._id || value || '');

export function createThread({
  host,
  comments = [],
  canReply = () => true,
  onNeedSignIn = () => {},
  submit, // async (parentComment, body) => savedComment (with author)
  avatar, // (author) => element
  name, // (author) => string
  time, // (isoDate) => string | Node
  emptyText = 'No comments yet. Start the conversation.',
  onCountChange = () => {},
  canReport = () => false,
  onReport = () => {},
  canManage = () => null, // (comment) => { edit, delete } for your own comments
  onEdit = null, // async (comment, body) => { body, editedAt }
  onDelete = null, // async (comment) => { hasReplies }
  isOp = () => false, // is this comment by the person who wrote the post?
  opLabel = 'OP',
  voteMode = null, // 'like' (feed comments) or 'vote' (community comments)
  canVote = () => false,
  onVote = null, // async (comment, value) => { score, likeCount, myVote }
}) {
  let total = 0;

  function makeNode(comment) {
    return { comment, kids: [] };
  }

  function descendants(threadEl) {
    return threadEl.querySelectorAll(':scope > .rt-body > .rt-children .rt-thread').length;
  }

  function build(node, depth) {
    const { comment } = node;
    total += 1;

    const thread = el('div', 'rt-thread');
    thread.dataset.depth = String(depth);
    thread.dataset.commentId = idOf(comment._id);

    const gutter = el('div', 'rt-gutter');
    const face = avatar(comment.author);
    face.classList.add('rt-avatar');
    const rail = el('button', 'rt-rail');
    rail.type = 'button';
    rail.setAttribute('aria-label', 'Collapse thread');
    rail.append(el('span', 'rt-rail-line'));
    gutter.append(face, rail);

    const body = el('div', 'rt-body');
    const meta = el('div', 'rt-meta');
    const when = time(comment.createdAt);
    const isDeleted = Boolean(comment.deleted);
    const nameNode = el('strong', 'rt-name', isDeleted ? '[deleted]' : name(comment.author));
    meta.append(nameNode);
    if (!isDeleted && isOp(comment)) {
      const op = el('span', 'rt-op', opLabel);
      op.title = 'Wrote this post';
      meta.append(op);
    }
    meta.append(el('span', 'rt-dot', '·'));
    if (typeof when === 'string') meta.append(el('span', 'rt-time', when));
    else if (when) { when.classList.add('rt-time'); meta.append(when); }
    const edited = el('span', 'rt-edited', comment.editedAt ? '(edited)' : '');
    edited.hidden = !comment.editedAt;
    meta.append(edited);
    const hidden = el('span', 'rt-hidden');
    const toggle = el('button', 'rt-toggle', '−');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Collapse comment');
    toggle.setAttribute('aria-expanded', 'true');
    meta.append(hidden, toggle);

    const text = el('p', 'rt-text', comment.body);
    const actions = el('div', 'rt-actions');
    const reply = el('button', 'rt-action', 'Reply');
    reply.type = 'button';
    actions.append(reply);
    if (canReport(comment)) {
      const flag = el('button', 'rt-action', 'Report');
      flag.type = 'button';
      flag.addEventListener('click', () => onReport(comment));
      actions.append(flag);
    }
    const slot = el('div', 'rt-reply-slot');
    if (!isDeleted && voteMode && onVote) {
      const interactive = canVote(comment);
      let mine = Number(comment.myVote) || 0;
      let score = voteMode === 'like' ? Number(comment.likeCount) || 0 : Number(comment.score) || 0;
      const box = el('div', `rt-votes rt-votes--${voteMode}`);
      const up = el('button', 'rt-vote rt-vote--up'); up.type = 'button';
      up.innerHTML = voteMode === 'like' ? HEART : ARROW;
      const num = el('span', 'rt-vote-num');
      const down = voteMode === 'vote' ? el('button', 'rt-vote rt-vote--down') : null;
      if (down) { down.type = 'button'; down.innerHTML = ARROW; }
      const paint = () => {
        num.textContent = voteMode === 'vote' ? String(score) : (score > 0 ? String(score) : '');
        up.classList.toggle('is-on', mine === 1);
        up.setAttribute('aria-pressed', String(mine === 1));
        up.setAttribute('aria-label', voteMode === 'like' ? (mine === 1 ? 'Unlike comment' : 'Like comment') : 'Upvote comment');
        if (down) { down.classList.toggle('is-on', mine === -1); down.setAttribute('aria-pressed', String(mine === -1)); down.setAttribute('aria-label', 'Downvote comment'); }
        box.hidden = !interactive && !score;
      };
      async function cast(target) {
        if (!canReply()) { onNeedSignIn(); return; }
        if (!interactive) return;
        const next = mine === target ? 0 : target;
        const before = { mine, score };
        if (voteMode === 'like') score += (next === 1 ? 1 : 0) - (mine === 1 ? 1 : 0);
        else score += next - mine;
        mine = next; paint();
        try {
          const saved = await onVote(comment, next);
          if (saved) { score = voteMode === 'like' ? saved.likeCount : saved.score; mine = saved.myVote; comment.myVote = mine; paint(); }
        } catch { mine = before.mine; score = before.score; paint(); }
      }
      up.addEventListener('click', () => cast(1));
      if (down) down.addEventListener('click', () => cast(-1));
      if (!interactive) { up.disabled = true; if (down) down.disabled = true; }
      box.append(up, num);
      if (down) box.append(down);
      paint();
      actions.prepend(box);
    }
    const perms = (!isDeleted && canManage(comment)) || {};
    if (isDeleted) { text.classList.add('is-deleted'); actions.hidden = true; face.textContent = '?'; face.style.backgroundImage = 'none'; }

    if (perms.edit && onEdit) {
      const editButton = el('button', 'rt-action', 'Edit');
      editButton.type = 'button';
      editButton.addEventListener('click', () => {
        if (body.querySelector('.rt-edit-form')) return;
        const form = el('form', 'rt-form rt-edit-form');
        const area = el('textarea', 'rt-input');
        area.rows = 3; area.maxLength = 1000; area.value = comment.body; area.required = true;
        area.setAttribute('aria-label', 'Edit your comment');
        const error = el('p', 'rt-error'); error.hidden = true; error.setAttribute('role', 'alert');
        const row = el('div', 'rt-form-row');
        const cancel = el('button', 'rt-btn rt-btn--ghost', 'Cancel'); cancel.type = 'button';
        const save = el('button', 'rt-btn rt-btn--solid', 'Save'); save.type = 'submit';
        row.append(cancel, save);
        form.append(area, error, row);
        text.hidden = true; actions.hidden = true;
        text.after(form);
        area.focus(); area.setSelectionRange(area.value.length, area.value.length);
        const close = () => { form.remove(); text.hidden = false; actions.hidden = false; };
        cancel.addEventListener('click', close);
        area.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const value = area.value.trim();
          if (!value) return;
          if (value === comment.body) { close(); return; }
          save.disabled = true; error.hidden = true;
          try {
            const saved = await onEdit(comment, value);
            comment.body = saved.body ?? value;
            comment.editedAt = saved.editedAt || new Date().toISOString();
            text.textContent = comment.body;
            edited.textContent = '(edited)'; edited.hidden = false;
            close();
          } catch (failure) { error.textContent = failure?.message || 'Could not save your change.'; error.hidden = false; save.disabled = false; }
        });
      });
      actions.append(editButton);
    }
    if (perms.delete && onDelete) {
      const deleteButton = el('button', 'rt-action rt-action--danger', 'Delete');
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Delete this comment?', message: 'This can’t be undone. Replies under it will stay.', confirmLabel: 'Delete' });
        if (!ok) return;
        deleteButton.disabled = true;
        try {
          const result = await onDelete(comment);
          if (result?.hasReplies || descendants(thread) > 0) {
            nameNode.textContent = '[deleted]';
            thread.querySelector(':scope > .rt-body > .rt-meta .rt-op')?.remove();
            text.textContent = '[deleted]'; text.classList.add('is-deleted'); text.hidden = false;
            actions.hidden = true; edited.hidden = true;
            face.textContent = '?'; face.style.backgroundImage = 'none';
            body.querySelector('.rt-edit-form')?.remove();
          } else {
            thread.remove();
          }
          total = Math.max(0, total - 1);
          onCountChange(total);
        } catch (failure) { deleteButton.disabled = false; window.alert(failure?.message || 'Could not delete the comment.'); }
      });
      actions.append(deleteButton);
    }
    const kids = el('div', 'rt-children');

    body.append(meta, text, actions, slot, kids);
    thread.append(gutter, body);

    function setCollapsed(value) {
      thread.classList.toggle('is-collapsed', value);
      toggle.textContent = value ? '+' : '−';
      toggle.setAttribute('aria-expanded', String(!value));
      toggle.setAttribute('aria-label', value ? 'Expand comment' : 'Collapse comment');
      const count = descendants(thread);
      hidden.textContent = value && count ? `${count} ${count === 1 ? 'reply' : 'replies'} hidden` : '';
    }
    toggle.addEventListener('click', () => setCollapsed(!thread.classList.contains('is-collapsed')));
    rail.addEventListener('click', () => setCollapsed(true));

    function openReply() {
      if (!canReply()) { onNeedSignIn(); return; }
      const existing = slot.querySelector('textarea');
      if (existing) { existing.focus(); return; }
      const form = el('form', 'rt-form');
      const area = el('textarea', 'rt-input');
      area.rows = 2;
      area.maxLength = 1000;
      area.required = true;
      area.placeholder = `Reply to ${name(comment.author)}`;
      area.setAttribute('aria-label', `Reply to ${name(comment.author)}`);
      const error = el('p', 'rt-error');
      error.hidden = true;
      error.setAttribute('role', 'alert');
      const row = el('div', 'rt-form-row');
      const cancel = el('button', 'rt-btn rt-btn--ghost', 'Cancel');
      cancel.type = 'button';
      const send = el('button', 'rt-btn rt-btn--solid', 'Reply');
      send.type = 'submit';
      row.append(cancel, send);
      form.append(area, error, row);
      slot.append(form);
      area.focus();
      cancel.addEventListener('click', () => form.remove());
      area.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') form.remove();
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = area.value.trim();
        if (!value) return;
        send.disabled = true;
        error.hidden = true;
        try {
          const saved = await submit(comment, value);
          form.remove();
          if (thread.classList.contains('is-collapsed')) setCollapsed(false);
          place(saved);
        } catch (failure) {
          error.textContent = failure?.message || 'Could not post your reply.';
          error.hidden = false;
          send.disabled = false;
        }
      });
    }
    reply.addEventListener('click', openReply);

    for (const child of node.kids) kids.append(build(child, depth + 1));
    return thread;
  }

  // Put a freshly saved comment where it belongs (the server may attach it to an ancestor at the depth limit).
  function place(saved) {
    const parentId = idOf(saved.parent);
    const parentThread = parentId ? host.querySelector(`.rt-thread[data-comment-id="${parentId}"]`) : null;
    const empty = host.querySelector(':scope > .rt-empty');
    if (empty) empty.remove();
    const fresh = build(makeNode(saved), parentThread ? Number(parentThread.dataset.depth) + 1 : 0);
    fresh.classList.add('is-new');
    if (parentThread) parentThread.querySelector(':scope > .rt-body > .rt-children').append(fresh);
    else host.append(fresh);
    onCountChange(total);
    fresh.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Draw the starting set.
  host.replaceChildren();
  host.classList.add('rt-root');
  const nodes = new Map(comments.map((comment) => [idOf(comment._id), makeNode(comment)]));
  const roots = [];
  for (const node of nodes.values()) {
    const parentId = idOf(node.comment.parent);
    const parent = parentId ? nodes.get(parentId) : null;
    if (parent && parent !== node) parent.kids.push(node);
    else roots.push(node);
  }
  if (!roots.length) host.append(el('p', 'rt-empty', emptyText));
  for (const root of roots) host.append(build(root, 0));
  onCountChange(total);

  return {
    /** Add a top-level comment (from the main "Add a comment" box). */
    addRoot: (saved) => place({ ...saved, parent: null }),
    count: () => total,
  };
}
