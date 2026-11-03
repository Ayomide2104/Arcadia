/* Feed extras: the "why you are seeing this" tag, the ... menu (not interested,
   show less, mute) with undo, and the "you're all caught up" divider. */
import { attachMenu } from './popover.js';

export function createFeedExtras({ api, toast, getUser, onReport, onBlock }) {
  function divider() {
    const node = document.createElement('div');
    node.className = 'feed-divider';
    node.setAttribute('role', 'separator');
    const title = document.createElement('strong');
    title.textContent = 'You’re all caught up ✨';
    const note = document.createElement('span');
    note.textContent = 'That’s everything new for now. Here are some posts you may have missed.';
    node.append(title, note);
    return node;
  }

  function collapse(article, post, mode) {
    const bar = document.createElement('div');
    bar.className = 'post-card feed-hidden glass-panel';
    const text = document.createElement('span');
    text.textContent = mode === 'author'
      ? `Muted @${post.author?.username || 'this player'}. Their posts won’t show in your feed.`
      : mode === 'less'
        ? 'Got it. You’ll see less like this.'
        : 'Post hidden.';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'feed-hidden__undo';
    undo.textContent = 'Undo';
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      try {
        await api(`/posts/hidden/post/${post._id}`, { method: 'DELETE' });
        if (mode === 'author' && post.author?._id) await api(`/posts/hidden/author/${post.author._id}`, { method: 'DELETE' });
        bar.replaceWith(article);
      } catch (error) {
        toast(error.message || 'Could not undo that.');
        undo.disabled = false;
      }
    });
    bar.append(text, undo);
    article.replaceWith(bar);
  }

  function decorate(article, post) {
    const header = article.querySelector('.post-card__head, .cm-post-head');
    const reason = post.feed?.reason;
    const context = article.querySelector('.pc-context');
    // Only reasons that tell the player something. "Something new" and "seen before" are noise.
    if (reason?.label && context && !['discover', 'again'].includes(reason.type)) {
      const tag = document.createElement('span');
      tag.className = `feed-reason feed-reason--${reason.type}`;
      tag.textContent = reason.label;
      context.append(tag);
      context.hidden = false;
    }

    const me = getUser();
    if (!me || !header || !post.author) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-more';
    button.setAttribute('aria-label', 'More options');
    button.setAttribute('aria-haspopup', 'menu');
    button.textContent = '⋯';

    const menu = document.createElement('div');
    menu.className = 'feed-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    const mine = post.author.username === me.username;
    const entries = [['post', 'Not interested in this post']];
    if (!mine) entries.push(['less', 'Show me less like this'], ['author', `Mute @${post.author.username}`]);

    if (!mine && onReport) entries.push(['report', 'Report post']);
    if (!mine && onBlock) entries.push(['block', `Block @${post.author.username}`]);

    for (const [mode, label] of entries) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      item.addEventListener('click', async () => {
        popover.hide();
        if (mode === 'report') { onReport(post); return; }
        if (mode === 'block') { onBlock(post.author); return; }
        try {
          await api(`/posts/${post._id}/hide`, { method: 'POST', body: JSON.stringify({ mode }) });
          collapse(article, post, mode);
        } catch (error) {
          toast(error.message || 'Could not do that.');
        }
      });
      menu.append(item);
    }

    const popover = attachMenu(button, menu);

    header.style.position = 'relative';
    header.append(button);
  }

  return { decorate, divider };
}
