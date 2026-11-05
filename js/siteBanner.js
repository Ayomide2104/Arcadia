/* Announcement banner controlled from the admin panel (Site controls). */

export async function showSiteBanner({ api }) {
  let info;
  try { info = await api('/site'); } catch { return; }
  const note = info?.announcement;
  if (!note?.text) return;
  try { if (localStorage.getItem('arcadia.dismissedAnnouncement') === note.id) return; } catch { /* ignore */ }

  const bar = document.createElement('div');
  bar.className = `site-banner site-banner--${['info', 'success', 'warning'].includes(note.tone) ? note.tone : 'info'}`;
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'site-banner__text';
  text.textContent = note.text;
  bar.append(text);
  if (note.link && /^https:\/\//i.test(note.link)) {
    const link = document.createElement('a');
    link.href = note.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.className = 'site-banner__link'; link.textContent = 'Learn more';
    bar.append(link);
  }
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'site-banner__close'; close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss announcement');
  close.addEventListener('click', () => {
    try { localStorage.setItem('arcadia.dismissedAnnouncement', note.id); } catch { /* ignore */ }
    bar.remove();
  });
  bar.append(close);
  const top = document.querySelector('.topbar');
  if (top) top.after(bar); else document.body.prepend(bar);
}
