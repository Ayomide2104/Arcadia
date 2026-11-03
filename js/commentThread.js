/* Reddit-style comment threads, shared by the post sheet and community post pages.

   - Replies can be made to any comment and nest under it.
   - A thin line runs down the left of each thread; click it (or the −/+ button) to collapse.
   - Reply boxes open inline, under the comment being answered.

   The caller supplies how to draw avatars/names/times and how to save a reply, so the
   same code works for both places.                                                      */

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
    meta.append(el('strong', 'rt-name', name(comment.author)), el('span', 'rt-dot', '·'));
    if (typeof when === 'string') meta.append(el('span', 'rt-time', when));
    else if (when) { when.classList.add('rt-time'); meta.append(when); }
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
