/* Reddit-style comment threads, shared by the comment sheet, the post page and community posts.

   - Replies nest under the comment they answer, with a thin line down the left that collapses the thread.
   - The indent is small and stops after a few levels, so deep threads stay readable on a phone.
   - Likes (feed comments) or up/down votes (community comments), edit, delete, report and reply boxes.

   The caller says how to draw avatars/names/times and how to save things, so the same code
   works everywhere. */

import { confirmSheet } from './confirm.js';
import { animateList, pop } from './motionKit.js';

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z"/></svg>';
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
  canManage = () => null, // (comment) => { edit, delete }
  onEdit = null, // async (comment, body) => { body, editedAt }
  onDelete = null, // async (comment) => { hasReplies }
  isOp = () => false,
  opLabel = 'OP',
  voteMode = null, // 'like' | 'vote'
  canVote = () => false,
  onVote = null, // async (comment, value) => { score, likeCount, myVote }
}) {
  let total = 0;

  const makeNode = (comment) => ({ comment, kids: [] });
  const repliesUnder = (thread) => thread.querySelectorAll(':scope > .rt-children .rt-thread').length;

  function build(node, depth) {
    const { comment } = node;
    total += 1;
    const isDeleted = Boolean(comment.deleted);

    const thread = el('div', 'rt-thread');
    thread.dataset.depth = String(depth);
    thread.dataset.commentId = idOf(comment._id);

    /* ---- header line: avatar, name, badges, time, collapse ---- */
    const head = el('div', 'rt-head');
    const face = avatar(comment.author);
    face.classList.add('rt-avatar');
    const nameNode = el('strong', 'rt-name', isDeleted ? '[deleted]' : name(comment.author));
    head.append(face, nameNode);
    if (!isDeleted && isOp(comment)) {
      const op = el('span', 'rt-op', opLabel);
      op.title = 'Wrote this post';
      head.append(op);
    }
    head.append(el('span', 'rt-dot', '·'));
    const when = time(comment.createdAt);
    if (typeof when === 'string') head.append(el('span', 'rt-time', when));
    else if (when) { when.classList.add('rt-time'); head.append(when); }
    const edited = el('span', 'rt-edited', comment.editedAt ? '(edited)' : '');
    edited.hidden = !comment.editedAt;
    const hidden = el('span', 'rt-hidden');
    const toggle = el('button', 'rt-toggle', '−');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Collapse comment');
    head.append(edited, hidden, toggle);

    /* ---- body ---- */
    const main = el('div', 'rt-main');
    const text = el('p', 'rt-text', comment.body);
    if (isDeleted) text.classList.add('is-deleted');
    const actions = el('div', 'rt-actions');
    const slot = el('div', 'rt-reply-slot');
    main.append(text, actions, slot);

    /* ---- replies, with the collapse line ---- */
    const kids = el('div', 'rt-children');
    const rail = el('button', 'rt-rail');
    rail.type = 'button';
    rail.setAttribute('aria-label', 'Collapse thread');
    kids.append(rail);

    thread.append(head, main, kids);

    function setCollapsed(value) {
      thread.classList.toggle('is-collapsed', value);
      toggle.textContent = value ? '+' : '−';
      toggle.setAttribute('aria-expanded', String(!value));
      toggle.setAttribute('aria-label', value ? 'Expand comment' : 'Collapse comment');
      const count = repliesUnder(thread);
      hidden.textContent = value && count ? `${count} ${count === 1 ? 'reply' : 'replies'} hidden` : '';
    }
    toggle.addEventListener('click', () => setCollapsed(!thread.classList.contains('is-collapsed')));
    rail.addEventListener('click', () => setCollapsed(true));

    /* ---- actions ---- */
    function markDeleted() {
      nameNode.textContent = '[deleted]';
      head.querySelector('.rt-op')?.remove();
      text.textContent = '[deleted]';
      text.classList.add('is-deleted');
      text.hidden = false;
      actions.replaceChildren();
      actions.hidden = true;
      edited.hidden = true;
      main.querySelector('.rt-edit-form')?.remove();
      face.textContent = '?';
      face.style.backgroundImage = 'none';
    }

    if (isDeleted) {
      actions.hidden = true;
      face.textContent = '?';
      face.style.backgroundImage = 'none';
    } else {
      if (voteMode && onVote) {
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
        const cast = async (target) => {
          if (!canReply()) { onNeedSignIn(); return; }
          if (!interactive) return;
          const next = mine === target ? 0 : target;
          const before = { mine, score };
          if (voteMode === 'like') score += (next === 1 ? 1 : 0) - (mine === 1 ? 1 : 0);
          else score += next - mine;
          mine = next; paint();
          if (next !== 0) pop(up);
          try {
            const saved = await onVote(comment, next);
            if (saved) { score = voteMode === 'like' ? saved.likeCount : saved.score; mine = saved.myVote; comment.myVote = mine; paint(); }
          } catch { mine = before.mine; score = before.score; paint(); }
        };
        up.addEventListener('click', () => cast(1));
        if (down) down.addEventListener('click', () => cast(-1));
        if (!interactive) { up.disabled = true; if (down) down.disabled = true; }
        box.append(up, num);
        if (down) box.append(down);
        paint();
        actions.append(box);
      }

      const reply = el('button', 'rt-action', 'Reply');
      reply.type = 'button';
      actions.append(reply);

      const perms = canManage(comment) || {};
      if (perms.edit && onEdit) {
        const editButton = el('button', 'rt-action', 'Edit');
        editButton.type = 'button';
        editButton.addEventListener('click', () => startEdit());
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
            if (result?.hasReplies || repliesUnder(thread) > 0) markDeleted();
            else thread.remove();
            total = Math.max(0, total - 1);
            onCountChange(total);
          } catch (failure) {
            deleteButton.disabled = false;
            window.alert(failure?.message || 'Could not delete the comment.');
          }
        });
        actions.append(deleteButton);
      }
      if (canReport(comment)) {
        const flag = el('button', 'rt-action', 'Report');
        flag.type = 'button';
        flag.addEventListener('click', () => onReport(comment));
        actions.append(flag);
      }

      reply.addEventListener('click', openReply);
    }

    function startEdit() {
      if (main.querySelector('.rt-edit-form')) return;
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
      area.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
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
    }

    function openReply() {
      if (!canReply()) { onNeedSignIn(); return; }
      const existing = slot.querySelector('textarea');
      if (existing) { existing.focus(); return; }
      const form = el('form', 'rt-form');
      const area = el('textarea', 'rt-input');
      area.rows = 2; area.maxLength = 1000; area.required = true;
      area.placeholder = `Reply to ${name(comment.author)}`;
      area.setAttribute('aria-label', `Reply to ${name(comment.author)}`);
      const error = el('p', 'rt-error'); error.hidden = true; error.setAttribute('role', 'alert');
      const row = el('div', 'rt-form-row');
      const cancel = el('button', 'rt-btn rt-btn--ghost', 'Cancel'); cancel.type = 'button';
      const send = el('button', 'rt-btn rt-btn--solid', 'Reply'); send.type = 'submit';
      row.append(cancel, send);
      form.append(area, error, row);
      slot.append(form);
      area.focus();
      cancel.addEventListener('click', () => form.remove());
      area.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.stopPropagation(); form.remove(); }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = area.value.trim();
        if (!value) return;
        send.disabled = true; error.hidden = true;
        try {
          const saved = await submit(comment, value);
          form.remove();
          if (thread.classList.contains('is-collapsed')) setCollapsed(false);
          place(saved);
        } catch (failure) {
          error.textContent = failure?.message || 'Could not post your reply.';
          error.hidden = false; send.disabled = false;
        }
      });
    }

    for (const child of node.kids) kids.append(build(child, depth + 1));
    animateList(kids);
    return thread;
  }

  // Put a freshly saved comment where it belongs (the server may attach it to an ancestor at the depth limit).
  function place(saved) {
    const parentId = idOf(saved.parent);
    const parentThread = parentId ? host.querySelector(`.rt-thread[data-comment-id="${parentId}"]`) : null;
    host.querySelector(':scope > .rt-empty')?.remove();
    const fresh = build(makeNode(saved), parentThread ? Number(parentThread.dataset.depth) + 1 : 0);
    fresh.classList.add('is-new');
    if (parentThread) parentThread.querySelector(':scope > .rt-children').append(fresh);
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
  animateList(host);

  return {
    /** Add a top-level comment (from the main comment box). */
    addRoot: (saved) => place({ ...saved, parent: null }),
    count: () => total,
  };
}
