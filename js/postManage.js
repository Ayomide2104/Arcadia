/* Edit and delete your own posts (feed posts and community posts). */
import { confirmSheet } from './confirm.js';
import { layerHost, swallowEscape } from './layers.js';

export function createPostManager({ api, toast }) {
  /** Opens an edit sheet. Resolves with { body, title, editedAt } when saved, or null. */
  function edit(post) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'sf-overlay';
      const box = document.createElement('form');
      box.className = 'sf-sheet';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Edit post');

      const heading = document.createElement('h2');
      heading.textContent = 'Edit post';
      box.append(heading);

      let titleInput = null;
      if (typeof post.title === 'string' && post.title !== '' || post.destinations?.some((item) => item.type === 'community')) {
        titleInput = document.createElement('input');
        titleInput.className = 'sf-input';
        titleInput.maxLength = 120;
        titleInput.value = post.title || '';
        titleInput.placeholder = 'Title';
        titleInput.setAttribute('aria-label', 'Title');
        box.append(titleInput);
      }

      const area = document.createElement('textarea');
      area.className = 'sf-input';
      area.rows = 6;
      area.maxLength = 500;
      area.value = post.body || '';
      area.placeholder = 'Write something…';
      area.setAttribute('aria-label', 'Post text');
      const count = document.createElement('p');
      count.className = 'sf-sub';
      const paintCount = () => { count.textContent = `${area.value.length}/500`; };
      area.addEventListener('input', paintCount);
      paintCount();
      const error = document.createElement('p');
      error.className = 'sf-error'; error.hidden = true; error.setAttribute('role', 'alert');

      const row = document.createElement('div');
      row.className = 'sf-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'sf-btn'; cancel.textContent = 'Cancel';
      const save = document.createElement('button');
      save.type = 'submit'; save.className = 'sf-btn sf-btn--solid'; save.textContent = 'Save';
      row.append(cancel, save);
      box.append(area, count, error, row);
      overlay.append(box);

      const finish = (value) => { overlay.remove(); document.body.classList.remove('sf-open'); resolve(value); };
      cancel.addEventListener('click', () => finish(null));
      overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) finish(null); });
      box.addEventListener('keydown', (event) => { if (swallowEscape(event)) finish(null); });
      box.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true; error.hidden = true;
        try {
          const payload = { body: area.value };
          if (titleInput) payload.title = titleInput.value;
          const result = await api(`/posts/${post._id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          toast('Post updated');
          finish(result.post);
        } catch (failure) { error.textContent = failure.message || 'Could not save your changes.'; error.hidden = false; save.disabled = false; }
      });
      layerHost().append(overlay);
      document.body.classList.add('sf-open');
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
  }

  /** Asks first, then deletes. Resolves true when the post is gone. */
  async function remove(post) {
    const ok = await confirmSheet({ title: 'Delete this post?', message: 'It will disappear from the feed, and its likes and comments go with it. This can’t be undone.', confirmLabel: 'Delete post' });
    if (!ok) return false;
    try {
      await api(`/posts/${post._id}`, { method: 'DELETE' });
      toast('Post deleted');
      return true;
    } catch (failure) { toast(failure.message || 'Could not delete this post.'); return false; }
  }

  return { edit, remove };
}

/** Update a drawn post card after it was edited. */
export function paintEdited(article, saved) {
  const bodyNode = article.querySelector('.pc-body, .cm-post-body');
  if (bodyNode) bodyNode.textContent = saved.body;
  const titleNode = article.querySelector('.cm-post-title, .cm-post-link');
  if (titleNode && saved.title) titleNode.textContent = saved.title;
  const header = article.querySelector('.post-card__head, .cm-post-head');
  if (header && !header.querySelector('.edited-tag')) {
    const tag = document.createElement('span');
    tag.className = 'edited-tag';
    tag.textContent = 'Edited';
    const more = header.querySelector('.feed-more');
    if (more) more.before(tag); else header.append(tag);
  }
}
