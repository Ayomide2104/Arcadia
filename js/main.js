import { createMessaging } from './messaging.js';
import { setAvatar, isPhotoAvatar, prepareAvatarFile } from './avatar.js';
import { createOnboarding } from './onboarding.js';
import { createGames } from './games.js';
import { createCommunities } from './communities.js';
import { createSeenTracker } from './seen.js';
import { createFeedExtras } from './feedExtras.js';
import { createComposer } from './composer.js';
import { openLightbox } from './lightbox.js';
import { createCircleStrip } from './circle.js';
import { presence } from './presence.js';
import { createTrendingGames } from './trendingGames.js';
import { createShare, postLink } from './share.js';
import { createNotifications } from './notifications.js';
import { createSearch } from './search.js';
import { createLfg } from './lfg.js';
import { createDrawer } from './drawer.js';
import { initFonts, renderFontPicker } from './fonts.js';
import { createLoader, hideSplash, initSplash } from './loading.js';
import { showSiteBanner } from './siteBanner.js';
import { createSafety } from './safety.js';
import { createSocial } from './social.js';
import { initViewport } from './viewport.js';
import { initDock, updateDockPill } from './dock.js';
import { initSwipeBack } from './swipeBack.js';
import { animateList, springValue, reduced } from './motionKit.js';
import { initPullRefresh } from './pullRefresh.js';

const loader = createLoader();
initSplash();
import { attachMenu } from './popover.js';
import { createThread } from './commentThread.js';

let notifications = null;

// Records which posts a player has actually looked at, so the feed never repeats them.
const seenTracker = createSeenTracker({ api: (path, options) => api(path, options), isSignedIn: () => Boolean(currentUser) });
const composer = createComposer({
  api: (path, options) => api(path, options),
  toast: (message) => toast(message),
  getUser: () => currentUser,
  openAuth: (reason) => openAuth(reason),
  setAvatar: (node, avatar, initial) => setAvatar(node, avatar, initial),
  onPosted: (post) => showNewPost(post),
});
const circle = createCircleStrip({
  api: (path, options) => api(path, options),
  setAvatar: (node, avatar, initial) => setAvatar(node, avatar, initial),
  onOpen: (post) => openPostPage(post),
});
const safety = createSafety({
  api: (path, options) => api(path, options),
  toast: (message) => toast(message),
  getUser: () => currentUser,
  onNeedSignIn: () => { openAuth(); toast('Sign in to do that.'); },
  setAvatar: (node, avatar, initial) => setAvatar(node, avatar, initial),
  onBlocked: () => { selectView('feed'); try { loadFeed(true); } catch { /* feed reloads on next visit */ } },
});

const social = createSocial({
  api: (path, options) => api(path, options),
  toast: (message) => toast(message),
  getUser: () => currentUser,
  onNeedSignIn: () => { openAuth(); toast('Sign in to follow players.'); },
  setAvatar: (node, avatar, initial) => setAvatar(node, avatar, initial),
  openProfile: (username) => { selectView('profile'); void renderProfile(username); },
  goPoints: (username) => { social.setPointsTarget(username); selectView('points'); },
  mountPoints: document.querySelector('#view-points'),
});

const feedExtras = createFeedExtras({
  api: (path, options) => api(path, options),
  toast: (message) => toast(message),
  getUser: () => currentUser,
  onReport: (post) => safety.report({ type: 'post', target: post._id, label: `Post by @${post.author?.username || 'player'}` }),
  onBlock: (user) => safety.block(user),
});
presence.configure({
  api: (path, options) => api(path, options),
  getUser: () => currentUser,
  setAvatar: (node, avatar, initial) => setAvatar(node, avatar, initial),
  onOpenFriends: () => selectView('friends'),
  onNeedSignIn: () => openAuth(),
});
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dialog = $('#auth-dialog');
const authForm = $('#auth-form');
let authMode = 'login';
let currentUser = null;
let returnTo = null;
let csrfToken = null;
let messaging = null;
presence.mountPanel($('#online-panel'));

function syncMessagingSession() {
  if (!messaging) {
    messaging = createMessaging({
      api,
      getCurrentUser: () => currentUser,
      toast,
      onPresence: (payload) => presence.handle(payload)
    });
  }

  if (currentUser) {
  messaging.init();
  messaging.connect();
} else {
  messaging.disconnect();
}
}

function applyTheme(theme, persist = true) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = selected;
  // The phone's status bar / notch area takes the app's own background colour, so they blend.
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = selected === 'dark' ? '#080A12' : '#F4F5F8';
    window.requestAnimationFrame(() => {
      const bg = document.body ? getComputedStyle(document.body).backgroundColor : '';
      const parts = bg.match(/\d+(\.\d+)?/g);
      if (parts && parts.length >= 3 && !(parts[3] !== undefined && Number(parts[3]) === 0)) {
        themeColor.content = `#${parts.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}`;
      }
    });
  }
  if (persist) {
    try { localStorage.setItem('mkstudios-theme', selected); } catch { /* Theme still applies for this page view. */ }
  }
}

try { applyTheme(localStorage.getItem('mkstudios-theme') || 'light', false); }
catch { applyTheme('light', false); }

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  $('.toast-region').append(node);
  window.setTimeout(() => node.remove(), 3500);
}

function openAuth(action = null) {
  returnTo = action;
  $('#auth-error').textContent = '';
  if (!dialog.open) dialog.showModal();
}

let profilePromise = Promise.resolve();
let navDepth = 0;
let pagePost = null;
let pageCard = null;
let pageThread = null;

function selectView(view, { fromHistory = false, extra = {} } = {}) {
  const previousView = document.body.dataset.view || 'feed';
  if (!fromHistory && view !== previousView) pushNav(view, extra);
  document.body.dataset.view = view;
  if (view !== 'groups') document.body.classList.remove('cc-full');
  $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== view; });
  // The page you arrive on slides in (from the right going forward, from the left going back).
  if (view !== previousView && !reduced()) {
    const skip = window.arcadiaSkipEnter; window.arcadiaSkipEnter = false;
    const arriving = document.querySelector(`[data-panel="${view}"]`);
    if (arriving && !skip) {
      arriving.classList.remove('view-enter-fwd', 'view-enter-back');
      void arriving.offsetWidth;
      arriving.classList.add(fromHistory ? 'view-enter-back' : 'view-enter-fwd');
      arriving.addEventListener('animationend', () => arriving.classList.remove('view-enter-fwd', 'view-enter-back'), { once: true });
    }
  }
  $$('[data-view]').forEach((button) => {
    const active = button.dataset.view === view || (view === 'groups' && button.dataset.view === 'games' && button.closest('.mobile-dock'));
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  updateDockPill();
  $$('.games-switch button').forEach((button) => { const active = button.dataset.viewLink === view; button.classList.toggle('is-current', active); button.setAttribute('aria-selected', String(active)); });
  document.querySelector('.workspace:not([hidden])')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (view === 'games') loadGames();
  if (view === 'groups') loadCommunities();
  if (view === 'updates') loadUpdates();
  if (view === 'lfg') void lfgPage.show();
  if (view === 'points') void social.renderPoints();
  if (view === 'profile') profilePromise = renderProfile();
  if (view === 'friends') void renderFriends();
  if (view === 'inbox') messaging?.openInbox();
}

$$('[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
$$('[data-action="open-inbox"]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!currentUser) {
      openAuth();
      toast('Sign in to view your messages.');
      return;
    }

    selectView('inbox');
  });
});
$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.viewLink)));

const searchToggle = $('#mobile-search-toggle');
searchToggle.addEventListener('click', () => {
  const expanded = searchToggle.getAttribute('aria-expanded') === 'true';
  searchToggle.setAttribute('aria-expanded', String(!expanded)); searchToggle.setAttribute('aria-label', expanded ? 'Open search' : 'Close search');
  $('.topbar').classList.toggle('search-open', !expanded);
  if (!expanded) $('#global-search').focus();
});
$('#global-search').addEventListener('keydown', (event) => { if (event.key === 'Escape') { $('.topbar').classList.remove('search-open'); searchToggle.setAttribute('aria-expanded', 'false'); searchToggle.focus(); } });

initDock();

$$('.feed-tab').forEach((tab, index) => {
  tab.addEventListener('click', () => {
    if (['friends', 'following', 'groups'].includes(tab.dataset.filter) && !currentUser) { openAuth(); return; }
    $$('.feed-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-selected', active);
      item.setAttribute('aria-selected', String(active));
    });
    const tabs = tab.parentElement;
    $('.tab-indicator', tabs).style.transform = `translateX(${tab.offsetLeft - tabs.offsetLeft}px)`;
    loadFeed(tab.dataset.filter);
  });
});

$$('[data-action="signin"], #auth-avatar').forEach((button) => button.addEventListener('click', () => {
  if (button.id === 'auth-avatar' && currentUser) { selectView('profile'); return; }
  if (button.hasAttribute('data-action') && currentUser) {
    const panel = button.closest('[data-panel]');
    const destination = panel?.dataset.panel || 'games';
    selectView(destination);
    return;
  }
  openAuth();
}));
$('#auth-open').addEventListener('click', async () => {
  if (!currentUser) return openAuth();
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* The local session is still cleared. */ }
  currentUser = null;
  csrfToken = null;
  syncMessagingSession();
  gamesPage.reset();
  communitiesPage.reset();
  updateSignedInUI();
  toast('You’re signed out.');
});
$$('[data-action="compose"]').forEach((button) => button.addEventListener('click', () => {
  if (!currentUser) return openAuth('compose');
  const label = button.textContent.trim();
  composer.open({ photo: label === 'Photo', pickDestination: label === 'Add game' });
}));

$$('.dialog-close, #auth-close').forEach((button) =>
  button.addEventListener('click', () => dialog.close())
);
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
$$('[data-auth-mode]').forEach((button) =>
  button.addEventListener('click', () =>
    setAuthMode(button.dataset.authMode)
  )
);

function setAuthMode(mode) {
  authMode = mode;
  $$('[data-auth-mode]').forEach((button) => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle('is-current', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#auth-title').textContent = mode === 'login' ? 'Get in the game.' : 'Join your people.';
  $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-password').placeholder = mode === 'login' ? 'Your password' : 'At least 10 characters';
  let confirm = $('#auth-confirm');
  if (mode === 'register' && !confirm) {
    const label = document.createElement('label'); label.htmlFor = 'auth-confirm'; label.textContent = 'Confirm password';
    confirm = document.createElement('input'); confirm.id = 'auth-confirm'; confirm.type = 'password'; confirm.autocomplete = 'new-password'; confirm.placeholder = 'Type it again'; confirm.required = true;
    $('#auth-error').before(label, confirm);
  }
  if (confirm) {
    confirm.previousElementSibling.hidden = mode !== 'register';
    confirm.hidden = mode !== 'register';
    confirm.required = mode === 'register';
  }
  $('#auth-error').textContent = '';
}

async function api(path, options = {}) {
  const done = loader.begin(path, options);
  try { return await apiCore(path, options); } finally { done(); }
}

async function apiCore(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();

  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const isFormData =
    typeof FormData !== 'undefined' &&
    options.body instanceof FormData;

  const headers = {
    // Let the browser set the multipart boundary for FormData.
    ...(
      options.body && !isFormData
        ? { 'Content-Type': 'application/json' }
        : {}
    ),

    ...(mutating && csrfToken
      ? { 'X-CSRF-Token': csrfToken }
      : {}),

    ...options.headers,
  };

  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body.error || 'Something went wrong. Please try again.'
    );
  }

  return body.data ?? body;
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = $('button[type="submit"]', authForm);
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  if (authMode === 'register' && password !== $('#auth-confirm').value) {
    $('#auth-error').textContent = 'Those passwords do not match.';
    return;
  }
  $('#auth-error').textContent = '';
  submit.disabled = true;
  submit.textContent = authMode === 'login' ? 'Signing in…' : 'Creating account…';
  try {
    const result = await api(`/auth/${authMode}`, { method: 'POST', body: JSON.stringify({ username, password }) });
    currentUser = result.user;
    csrfToken = result.csrfToken;
    syncMessagingSession();
    updateSignedInUI();
    dialog.close();
    authForm.reset();
    toast(`Welcome${currentUser.displayName ? `, ${currentUser.displayName}` : ''}.`);
    await loadFeed();
    if (authMode === 'register' && !currentUser.onboardingComplete) startOnboarding();
    if (returnTo === 'compose') composePost();
    else if (returnTo?.id || returnTo?.slug) {
      const pending = returnTo;
      if (pending.type === 'like' || pending.type === 'repost') {
        try { await api(`/posts/${pending.id}/${pending.type}`, { method: 'POST' }); toast(pending.type === 'like' ? 'Post liked.' : 'Post reposted.'); await loadFeed(); }
        catch (error) { toast(error.message); }
      } else if (pending.type === 'comment') {
        try { const detail = await api(`/posts/${pending.id}`); openPostPage(detail.post); }
        catch (error) { toast(error.message); }
      }
      else if (pending.type === 'game-interest') {
        try { await api(`/games/${pending.slug}/interest`, { method:'PUT',body:JSON.stringify({ interested:true }) }); currentUser.favoriteGames=[...new Set([...(currentUser.favoriteGames||[]),pending.slug])]; toast('Game added to your interests.'); loadGames(); }
        catch(error) { toast(error.message); }
      } else if (pending.type === 'join-community') {
        try { await api(`/communities/${pending.slug}/join`,{method:'POST'}); toast('You joined the community.'); loadCommunities(); }
        catch(error) { toast(error.message); }
      }
    }
    returnTo = null;
  } catch (error) {
    $('#auth-error').textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Continue';
  }
});

function updateSignedInUI() {
  $('#auth-open').setAttribute('aria-label', currentUser ? 'Sign out' : 'Sign in');
  $('#auth-open').title = currentUser ? 'Sign out' : 'Sign in';
  setAvatar($('#auth-avatar'), currentUser?.avatar, currentUser?.displayName?.[0]?.toUpperCase() || currentUser?.username?.[0]?.toUpperCase() || '?');
  $('#auth-avatar').setAttribute('aria-label', currentUser ? `Signed in as ${currentUser.username}` : 'Sign in to your profile');
  if ($('#comments-form')) { $('#comments-form').hidden = !currentUser; $('#comments-signin').hidden = Boolean(currentUser); }
  setAvatar($('.avatar--composer'), currentUser?.avatar, currentUser?.username?.[0]?.toUpperCase() || '?');
  if (currentUser) notifications?.refresh(); else notifications?.reset();
  presence.sync();
  $$('[data-action="signin"]').forEach((button) => {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
    if (currentUser) {
      const destination = button.closest('[data-panel]')?.dataset.panel || 'games';
      const labels = { games: 'Browse games', updates: 'View updates', groups: 'Explore groups', friends: 'Find players', profile: 'View profile' };
      button.textContent = labels[destination] || 'Explore games';
      button.removeAttribute('aria-disabled');
    }
    else { button.textContent = button.dataset.originalLabel; button.removeAttribute('aria-disabled'); }
  });
  if (currentUser) {
    $('#feed-state').hidden = true;
    $$('.sidebar, .welcome-card').forEach((el) => el.hidden = false);
  } else {
    $('#feed-state').hidden = false;
  }
  if (!$('#view-updates').hidden) loadUpdates();
}

async function restoreSession() {
  try {
    const result = await api('/auth/me');
    currentUser = result.user;
    csrfToken = result.csrfToken;
    syncMessagingSession();
    updateSignedInUI();
    if (currentUser && !currentUser.onboardingComplete) startOnboarding();
  } catch {
    // A guest can read public posts; an expired cookie simply leaves the guest view.
  }
  try { await loadFeed(); } finally { hideSplash(); }
}


let feedCursor = null;
let activeFeed = 'for-you';
let feedLoading = false;
let feedObserver = null;
let feedGeneration = 0;
let feedAnim = null;

async function loadFeed(filter = activeFeed, cursor = null) {
  if (feedLoading) return;
  if (cursor && !feedCursor) return;

  const state = $('#feed-state');
  const list = $('#post-list');

  activeFeed = filter;

  const isInitialLoad = !cursor;
  if (!feedAnim) feedAnim = animateList(list);
  if (isInitialLoad) feedAnim?.disable();

  if (isInitialLoad) {
    void circle.show(filter);
    feedGeneration++;
    feedCursor = null;

    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
    }

    state.hidden = false;
    state.innerHTML = '<img class="feed-empty-art" src="/assets/arcadia/empty-states/empty-posts.svg" alt=""/><h2>Finding your people…</h2><p>Loading the latest conversations.</p>';
    list.replaceChildren();
    window.setTimeout(() => feedAnim?.enable(), 600);
  }

  const generation = feedGeneration;

  let sentinel = $('#feed-load-more');

  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'feed-load-more';
    sentinel.setAttribute('aria-live', 'polite');
    sentinel.className = 'feed-loading-sentinel';
    sentinel.innerHTML = '<span class="feed-loading-sentinel__text">Loading more posts…</span>';
    list.after(sentinel);
  }

  sentinel.hidden = true;

  feedLoading = true;

  try {
    const result = await api(
      `${filter === 'groups' ? '/communities/feed?' : `/posts?feed=${encodeURIComponent(filter)}&`}limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    );

    if (generation !== feedGeneration) return;

    const items = result.items || [];

    for (const item of items) {
      if (item.feed?.divider) list.append(feedExtras.divider());
      const node = renderFeedItem(item);
      if (filter !== 'groups') {
        feedExtras.decorate(node, item);
        seenTracker.observe(node);
      }
      list.append(node);
    }

    feedCursor = result.nextCursor || null;

    if (!items.length && !cursor && filter === 'groups') {
      state.innerHTML = '<img class="feed-empty-art" src="/assets/arcadia/empty-states/empty-posts.svg" alt=""/><h2>No community posts yet</h2><p>Join a few communities and their posts will show up here.</p><button class="button button--primary" type="button" id="feed-find-communities">Find communities</button>';
      $('#feed-find-communities')?.addEventListener('click', () => selectView('groups'));
      return;
    }

    if (!items.length && !cursor && filter === 'following') {
      const none = result.unavailable === 'no-following';
      state.innerHTML = `<img class="feed-empty-art" src="/assets/arcadia/empty-states/empty-friends.svg" alt=""/><h2>${none ? 'Follow people to fill this feed' : 'Nothing new from people you follow'}</h2><p>${none ? 'Follow players you enjoy and their posts show up here, and a bit more often in For you too.' : 'Check back soon, or find more players to follow.'}</p>`;
      const action = document.createElement('button');
      action.className = 'button button--primary';
      action.type = 'button';
      action.textContent = none ? 'Find players' : 'Write a post';
      action.addEventListener('click', () => (none ? selectView('lfg') : composePost()));
      state.append(action);
      return;
    }

    if (!items.length && !cursor && filter === 'friends') {
      const noFriends = result.unavailable === 'no-friends';
      state.innerHTML = `<img class="feed-empty-art" src="/assets/arcadia/empty-states/empty-friends.svg" alt=""/><h2>${noFriends ? 'Add friends to fill this feed' : 'Your friends are quiet'}</h2><p>${noFriends ? 'Posts from your friends show up here once you connect.' : 'Nothing from your friends yet. Be the first to start the conversation.'}</p>`;
      const action = document.createElement('button');
      action.className = 'button button--primary';
      action.type = 'button';
      action.textContent = noFriends ? 'Find friends' : 'Write a post';
      action.addEventListener('click', () => (noFriends ? selectView('friends') : composePost()));
      state.append(action);
      return;
    }

    if (!items.length && !cursor && result.unavailable) {
      state.innerHTML = '<img class="feed-empty-art" src="/assets/arcadia/empty-states/empty-posts.svg" alt=""/><h2>Add friends to fill this feed</h2><p>Posts from your friends show up here once you connect.</p>';
      return;
    }

    if (!items.length && !cursor) {
      state.innerHTML = '<img class="feed-empty-art" src="/assets/arcadia/empty-states/empty-posts.svg" alt=""/><h2>Your circle starts here</h2><p>There are no public posts yet. Start a conversation when you’re ready.</p>';

      if (currentUser) {
        const button = document.createElement('button');
        button.className = 'button button--primary';
        button.type = 'button';
        button.textContent = 'Write a post';
        button.addEventListener('click', composePost);
        state.append(button);
      } else {
        const button = document.createElement('button');
        button.className = 'button button--primary';
        button.type = 'button';
        button.textContent = 'Join the circle';
        button.addEventListener('click', () => openAuth());
        state.append(button);
      }
    } else {
      state.hidden = list.children.length > 0;
    }

    if (feedCursor) {
      sentinel.hidden = false;
      sentinel.innerHTML = '<span class="feed-loading-sentinel__text">Scroll for more</span>';

      if (!feedObserver) {
        feedObserver = new IntersectionObserver((entries) => {
          if (
            entries.some((entry) => entry.isIntersecting) &&
            !feedLoading &&
            feedCursor
          ) {
            const nextCursor = feedCursor;
            loadFeed(activeFeed, nextCursor);
          }
        }, {
          root: null,
          rootMargin: '500px 0px',
          threshold: 0
        });

        feedObserver.observe(sentinel);
      }
    } else {
      sentinel.hidden = true;
      sentinel.innerHTML = '<span class="feed-loading-sentinel__text">You’re all caught up ✨</span>';

      if (feedObserver) {
        feedObserver.disconnect();
        feedObserver = null;
      }
    }
  } catch {
    if (generation !== feedGeneration) return;

    if (cursor) {
      sentinel.hidden = false;
      sentinel.innerHTML = '<button class="button button--primary" type="button">Couldn’t load more. Try again</button>';

      sentinel.querySelector('button').addEventListener('click', () => {
        if (!feedLoading && feedCursor) {
          loadFeed(activeFeed, feedCursor);
        }
      });
    } else {
      state.hidden = false;
      state.innerHTML = '<img class="feed-empty-art" src="/assets/arcadia/empty-states/empty-posts.svg" alt=""/><h2>Couldn’t load the feed</h2><p>Check your connection and try again.</p>';

      const retry = document.createElement('button');
      retry.className = 'button button--primary';
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => loadFeed(filter));
      state.append(retry);
    }
  } finally {
    if (generation === feedGeneration) {
      feedLoading = false;
    }
  }
}

function iconSvg(name) {
  const paths = {
    heart: '<path d="M20.8 8.7c0 4.3-8.8 10-8.8 10s-8.8-5.7-8.8-10A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.5Z"/>',
    comment: '<path d="M20.5 11.7a8.2 8.2 0 0 1-8.5 7.8 9 9 0 0 1-3.4-.7L4 20l1.2-4a7.2 7.2 0 0 1-2.2-5.1A8.1 8.1 0 0 1 11.5 3h.5a8.2 8.2 0 0 1 8.5 8.2v.5Z"/>',
    repost: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    share: '<path d="M21 12 14 5v4C8 9.6 4.5 13.2 4 19.5c2.8-3.4 5.8-5 10-5V19l7-7z"/>'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.innerHTML = paths[name];
  return svg;
}

function relativeAge(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (Number.isNaN(seconds)) return '';
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
}

function prettySlug(slug) {
  return String(slug).split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

// Plain text with links, @mentions and #tags picked out. Built from DOM nodes, never HTML.
function richText(text, onMention) {
  const fragment = document.createDocumentFragment();
  const pattern = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(@[a-z0-9_]{3,24})|(#[\p{L}\p{N}_]{2,30})/giu;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) fragment.append(text.slice(last, match.index));
    if (match[1]) {
      const link = document.createElement('a');
      link.href = match[1];
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      link.className = 'pc-link';
      link.textContent = match[1].replace(/^https?:\/\/(www\.)?/i, '').slice(0, 48) + (match[1].length > 58 ? '…' : '');
      fragment.append(link);
    } else if (match[2]) {
      const mention = document.createElement('button');
      mention.type = 'button';
      mention.className = 'pc-mention';
      mention.textContent = match[2];
      mention.addEventListener('click', () => onMention?.(match[2].slice(1).toLowerCase()));
      fragment.append(mention);
    } else {
      const tag = document.createElement('span');
      tag.className = 'pc-tag';
      tag.textContent = match[3];
      fragment.append(tag);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) fragment.append(text.slice(last));
  return fragment;
}

// A post shared to a community is drawn like a subreddit post (votes, c/name header, title).
function isCommunityPost(post) {
  return post?.type !== 'repost' && (post?.destinations || []).some((destination) => destination.type === 'community' && destination.target);
}

function renderFeedItem(post) {
  if (!isCommunityPost(post)) return renderPost(post);
  const node = communitiesPage.feedCard(post);
  node.id = `post-${post._id}`;
  node.dataset.postId = post._id;
  return node;
}

function renderPost(post, { embedded = false } = {}) {
  const article = document.createElement('article');
  article.className = embedded ? 'post-card pc pc--embedded' : 'post-card glass-panel pc';
  if (!embedded) article.id = `post-${post._id}`;
  article.dataset.postId = post._id;

  // Post header: avatar, name · handle · time, and one quiet line for where it was shared.
  const authorName = post.author?.displayName || post.author?.username || 'Player';
  const openAuthor = () => { selectView('profile'); void renderProfile(post.author?.username); };

  const header = document.createElement('header');
  header.className = 'post-card__head pc-head';

  const avatar = document.createElement('button');
  avatar.type = 'button';
  avatar.className = 'avatar post-avatar pc-avatar';
  avatar.setAttribute('aria-label', `Open ${authorName}’s profile`);
  avatar.textContent = authorName[0].toUpperCase();
  setAvatar(avatar, post.author?.avatar, avatar.textContent);
  avatar.addEventListener('click', openAuthor);

  const meta = document.createElement('div');
  meta.className = 'post-meta pc-who';

  const line = document.createElement('div');
  line.className = 'pc-line';

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'pc-name';
  name.textContent = authorName;
  name.addEventListener('click', openAuthor);

  const handle = document.createElement('span');
  handle.className = 'pc-handle';
  handle.textContent = `@${post.author?.username || 'player'}`;

  const postDate = new Date(post.createdAt);
  const time = document.createElement('time');
  time.className = 'pc-time';
  time.dateTime = Number.isNaN(postDate.getTime()) ? '' : postDate.toISOString();
  time.textContent = relativeAge(postDate);
  time.title = postDate.toLocaleString();

  const dot = document.createElement('span');
  dot.className = 'pc-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.textContent = '·';

  line.append(name, handle, dot, time);

  // Where it was shared: one small chip per game or community.
  const context = document.createElement('div');
  context.className = 'pc-context';
  const places = (post.destinations || []).filter((d) => (d.type === 'game' || d.type === 'community') && d.target);
  places.slice(0, 2).forEach((destination) => {
    const chip = document.createElement('span');
    chip.className = `pc-chip pc-chip--${destination.type}`;
    chip.textContent = post.labels?.[`${destination.type}:${destination.target}`] || prettySlug(destination.target);
    context.append(chip);
  });
  if (places.length > 2) {
    const more = document.createElement('span');
    more.className = 'pc-chip pc-chip--more';
    more.textContent = `+${places.length - 2}`;
    context.append(more);
  }
  if (!context.children.length) context.hidden = true;

  meta.append(line, context);
  header.append(avatar, meta);

  // Post text: links, @mentions and #tags are picked out; long posts fold up.
  let body = null;

  if (typeof post.body === 'string' && post.body.trim()) {
    body = document.createElement('div');
    body.className = 'pc-text';
    const paragraph = document.createElement('p');
    paragraph.className = 'post-card__body pc-body';
    paragraph.append(richText(post.body.trim(), (username) => { selectView('profile'); void renderProfile(username); }));
    body.append(paragraph);

    const long = post.body.length > 320 || post.body.split('\n').length > 6;
    if (long) {
      paragraph.classList.add('is-clamped');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pc-more-text';
      toggle.textContent = 'Show more';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const open = paragraph.classList.toggle('is-clamped') === false;
        toggle.textContent = open ? 'Show less' : 'Show more';
        toggle.setAttribute('aria-expanded', String(open));
      });
      body.append(toggle);
    }
  }

  // Photos: a tidy grid; tap one to open the viewer.
  let mediaGallery = null;

  const images = Array.isArray(post.media)
    ? post.media.filter((item) => item && item.type === 'image' && typeof item.url === 'string' && /^https:\/\//i.test(item.url))
    : [];

  if (images.length) {
    mediaGallery = document.createElement('div');
    mediaGallery.className = 'post-media pc-media';
    mediaGallery.dataset.count = String(Math.min(images.length, 4));

    const first = images[0];
    if (images.length === 1 && Number.isFinite(first.width) && first.width > 0 && Number.isFinite(first.height) && first.height > 0) {
      mediaGallery.style.setProperty('--ar', String(Math.min(2, Math.max(0.8, first.width / first.height))));
    }

    const viewable = images.map((image, i) => ({
      url: image.url,
      alt: post.body?.trim() ? `Photo ${i + 1} from ${authorName}: ${post.body.trim().slice(0, 100)}` : `Photo ${i + 1} from ${authorName}`,
    }));

    images.slice(0, 4).forEach((image, index) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'pc-photo';
      tile.setAttribute('aria-label', `View photo ${index + 1} of ${images.length}`);

      const img = document.createElement('img');
      img.src = image.url;
      img.alt = viewable[index].alt;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => { tile.classList.add('is-broken'); img.alt = 'Photo unavailable'; }, { once: true });
      tile.append(img);

      if (index === 3 && images.length > 4) {
        const rest = document.createElement('span');
        rest.className = 'pc-photo-more';
        rest.textContent = `+${images.length - 4}`;
        tile.append(rest);
      }

      tile.addEventListener('click', () => openLightbox(viewable, index));
      mediaGallery.append(tile);
    });
  }

  // Engagement summary
  const summary = document.createElement('div');
  summary.className = 'comments-summary';

  const heartSummary = document.createElement('span');
  heartSummary.className = 'summary-heart';
  heartSummary.append(iconSvg('heart'));

  const likeSummary = document.createElement('span');
  likeSummary.textContent = String(post.likeCount || 0);

  const divider = document.createElement('span');
  divider.textContent = '·';
  divider.setAttribute('aria-hidden', 'true');

  const commentSummary = document.createElement('button');
  commentSummary.type = 'button';

  commentSummary.textContent =
    `${post.commentCount || 0} ` +
    `${post.commentCount === 1 ? 'comment' : 'comments'}`;

  commentSummary.setAttribute(
    'aria-label',
    `View ${post.commentCount || 0} comments`
  );

  summary.append(
    heartSummary,
    likeSummary,
    divider,
    commentSummary
  );

  // Post action buttons
  const actions = document.createElement('div');
  actions.className = 'post-actions';

  const makeButton = (name, label, count = null) => {
    const button = document.createElement('button');

    button.type = 'button';
    button.dataset.actionName = name;
    button.setAttribute('aria-label', label);
    button.append(iconSvg(name));

    if (count !== null) {
      const number = document.createElement('span');

      number.className = 'action-count';
      number.textContent = String(count);

      button.append(number);
    }

    const text = document.createElement('span');

    text.className = 'action-label';
    text.textContent = label;

    button.append(text);

    return button;
  };

  const likeButton = makeButton(
    'heart',
    'Like',
    post.likeCount || 0
  );

  likeButton.setAttribute(
    'aria-pressed',
    String(post.liked === true)
  );

  const commentButton = makeButton(
    'comment',
    'Comments',
    post.commentCount || 0
  );

  const repostButton = makeButton(
    'repost',
    'Repost',
    post.repostCount || 0
  );

  repostButton.setAttribute(
    'aria-pressed',
    String(post.reposted === true)
  );

  const shareButton = makeButton('share', 'Share');

  const updateCount = (button, value) => {
    const counter = $('.action-count', button);

    if (counter) {
      counter.textContent = String(value);
    }
  };

  const updateComments = (value) => {
    post.commentCount = value;

    updateCount(commentButton, value);

    commentSummary.textContent =
      `${value} ${value === 1 ? 'comment' : 'comments'}`;

    commentSummary.setAttribute(
      'aria-label',
      `View ${value} comments`
    );
  };

  const updateLikes = (value) => {
    post.likeCount = value;

    updateCount(likeButton, value);
    likeSummary.textContent = String(value);
  };

  const showComments = () => {
    if (embedded) {
      // Already looking at this post: jump to the comment box instead.
      const input = $('.pp-input') || $('#comments-input');
      if (input) input.focus();
      else $('.pp-comments, #comments-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    openPost(post, document.activeElement);
  };

  commentButton.addEventListener('click', showComments);
  commentSummary.addEventListener('click', showComments);

  // Like
  likeButton.addEventListener('click', async () => {
    if (!currentUser) {
      return openAuth({
        type: 'like',
        id: post._id,
      });
    }

    const was =
      likeButton.getAttribute('aria-pressed') === 'true';

    const previous = Number(post.likeCount || 0);

    const next = Math.max(
      0,
      previous + (was ? -1 : 1)
    );

    likeButton.setAttribute(
      'aria-pressed',
      String(!was)
    );

    updateLikes(next);

    likeButton.classList.toggle('is-pop', !was);

    window.setTimeout(() => {
      likeButton.classList.remove('is-pop');
    }, 320);

    likeButton.disabled = true;

    try {
      const result = await api(
        `/posts/${post._id}/like`,
        {
          method: was ? 'DELETE' : 'POST',
        }
      );

      likeButton.setAttribute(
        'aria-pressed',
        String(result.liked)
      );

      updateLikes(result.likeCount);
    } catch (error) {
      likeButton.setAttribute(
        'aria-pressed',
        String(was)
      );

      updateLikes(previous);
      toast(error.message);
    } finally {
      likeButton.disabled = false;
    }
  });

  // Repost
  repostButton.addEventListener('click', async () => {
    if (!currentUser) {
      return openAuth({
        type: 'repost',
        id: post._id,
      });
    }

    const was =
      repostButton.getAttribute('aria-pressed') === 'true';

    const previous = Number(post.repostCount || 0);

    updateCount(
      repostButton,
      Math.max(0, previous + (was ? -1 : 1))
    );

    repostButton.setAttribute(
      'aria-pressed',
      String(!was)
    );

    repostButton.disabled = true;

    try {
      const result = await api(
        `/posts/${post._id}/repost`,
        {
          method: was ? 'DELETE' : 'POST',
        }
      );

      post.repostCount = result.repostCount;

      updateCount(repostButton, result.repostCount);

      repostButton.setAttribute(
        'aria-pressed',
        String(result.reposted)
      );

      toast(
        result.reposted
          ? 'Reposted to your circle.'
          : 'Repost removed.'
      );
    } catch (error) {
      repostButton.setAttribute(
        'aria-pressed',
        String(was)
      );

      post.repostCount = previous;
      updateCount(repostButton, previous);

      toast(error.message);
    } finally {
      repostButton.disabled = false;
    }
  });

  // Share
  shareButton.addEventListener('click', () => {
    share.open({
      url: postLink(post._id),
      text: post.body || '',
      author: post.author?.username ? `${authorName} (@${post.author.username})` : authorName,
    });
  });

  actions.className = 'post-actions pc-actions';
  shareButton.classList.add('pc-share');
  actions.append(
    likeButton,
    commentButton,
    repostButton,
    shareButton
  );

  // Assemble the post in reading order.
  article.append(header);

  if (body) {
    article.append(body);
  }

  if (mediaGallery) {
    article.append(mediaGallery);
  }

  article.append(actions);

  article._updateComments = updateComments;

  if (!embedded) {
    // Tapping the post itself (text, empty space) opens the full post page.
    article.classList.add('is-openable');
    article.addEventListener('click', (event) => {
      if (event.target.closest('a, button, input, textarea, select, label, video, .pc-media, .feed-menu, .fm-pop')) return;
      if (String(window.getSelection?.() || '').length) return;
      openPostPage(post);
    });
  }
  return article;
}

const commentsDialog = $('#comments-dialog');
let activeCommentsPost = null;
let commentsReturnFocus = null;
let commentsHashPushed = false;
let commentsLoadGeneration = 0;
let commentsTouchStart = null;


function commentTime(item) {
  const time = document.createElement('time');
  const date = new Date(
    item.createdAt || item.updatedAt || Date.now()
  );

  time.dateTime = date.toISOString();

  const updateRelativeTime = () => {
    const seconds = Math.max(
      0,
      Math.floor((Date.now() - date.getTime()) / 1000)
    );

    let label;

    if (seconds < 60) {
      label = 'Just now';
    } else if (seconds < 3600) {
      label = `${Math.floor(seconds / 60)}m`;
    } else if (seconds < 86400) {
      label = `${Math.floor(seconds / 3600)}h`;
    } else if (seconds < 604800) {
      label = `${Math.floor(seconds / 86400)}d`;
    } else if (seconds < 2592000) {
      label = `${Math.floor(seconds / 604800)}w`;
    } else if (seconds < 31536000) {
      label = `${Math.floor(seconds / 2592000)}mo`;
    } else {
      label = `${Math.floor(seconds / 31536000)}y`;
    }

    time.textContent = label;
    time.title = date.toLocaleString();
    time.setAttribute(
      'aria-label',
      `Posted ${date.toLocaleString()}`
    );
  };

  updateRelativeTime();

  return time;
}


function discussionAvatar(author) {
  const avatar = document.createElement('span');
  avatar.className = 'discussion-avatar';
  avatar.textContent = (author?.displayName || author?.username || '?')[0].toUpperCase();
  setAvatar(avatar, author?.avatar, avatar.textContent);
  return avatar;
}

let activeThread = null;
let activeEmbeddedPost = null;

// One more comment on the open post: keep every visible counter in step.
function bumpCommentCount(delta = 1) {
  if (!activeCommentsPost) return;
  activeCommentsPost.commentCount = Math.max(0, (activeCommentsPost.commentCount || 0) + delta);
  const count = activeCommentsPost.commentCount;
  document.querySelector(`#post-${activeCommentsPost._id}`)?._updateComments?.(count);
  activeEmbeddedPost?._updateComments?.(count);
}

function setCommentSkeletons() {
  const list = $('#comments-list'); list.replaceChildren();
  for (let i = 0; i < 4; i++) { const skeleton = document.createElement('div'); skeleton.className = 'comment-skeleton'; skeleton.setAttribute('aria-hidden', 'true'); list.append(skeleton); }
}

function setCommentsError(error, retry) {
  const host = $('#comments-error'); host.hidden = false; host.replaceChildren(document.createTextNode(error.message || 'Could not load comments.'));
  const button = document.createElement('button'); button.className = 'button'; button.type = 'button'; button.textContent = 'Retry'; button.addEventListener('click', retry); host.append(button);
}

// One configuration for every comment list (the comment sheet and the post page), so they always behave the same.
function commentThreadConfig(getPost, bump) {
  const me = () => currentUser?.username;
  return {
    canReply: () => Boolean(currentUser),
    onNeedSignIn: () => openAuth({ type: 'comment', id: getPost()?._id }),
    avatar: discussionAvatar,
    isOp: (comment) => Boolean(comment.author?.username) && comment.author.username === getPost()?.author?.username,
    opLabel: isCommunityPost(getPost()) ? 'OP' : 'Author',
    voteMode: isCommunityPost(getPost()) ? 'vote' : 'like',
    canVote: (comment) => Boolean(currentUser) && Boolean(comment.author?.username) && comment.author.username !== me(),
    onVote: async (comment, value) => api(`/posts/${getPost()._id}/comments/${comment._id}/vote`, { method: 'PUT', body: JSON.stringify({ value }) }),
    canManage: (comment) => {
      if (!currentUser || !comment.author?.username) return null;
      if (comment.author.username === me()) return { edit: true, delete: true };
      return getPost()?.author?.username === me() ? { delete: true } : null;
    },
    onEdit: async (comment, body) => (await api(`/posts/${getPost()._id}/comments/${comment._id}`, { method: 'PATCH', body: JSON.stringify({ body }) })).comment,
    onDelete: async (comment) => {
      const result = await api(`/posts/${getPost()._id}/comments/${comment._id}`, { method: 'DELETE' });
      bump(-1);
      return result;
    },
    canReport: (comment) => Boolean(currentUser) && Boolean(comment.author?.username) && comment.author.username !== me(),
    onReport: (comment) => safety.report({ type: 'comment', target: comment._id, label: `Comment by @${comment.author?.username || 'player'}` }),
    name: (author) => author?.displayName || author?.username || 'Player',
    time: (date) => commentTime({ createdAt: date }),
    submit: async (parent, body) => {
      const post = getPost();
      if (!post) throw new Error('This post is no longer open.');
      const result = await api(`/posts/${post._id}/comments`, { method: 'POST', body: JSON.stringify({ body, parent: parent._id }) });
      bump(1);
      return { ...result.comment, author: result.comment.author?.username ? result.comment.author : currentUser };
    },
  };
}

function renderDiscussion(items) {
  activeThread = createThread({ host: $('#comments-list'), comments: items, ...commentThreadConfig(() => activeCommentsPost, bumpCommentCount) });
}

async function loadDiscussion(post, generation = commentsLoadGeneration) {
  $('#comments-error').hidden = true; setCommentSkeletons();
  try {
    const data = await api(`/posts/${post._id}/comments?limit=50`);
    if (generation !== commentsLoadGeneration || !commentsDialog.open) return;
    renderDiscussion(data.items || []);
  } catch (error) {
    if (generation !== commentsLoadGeneration) return;
    $('#comments-list').replaceChildren(); setCommentsError(error, () => loadDiscussion(post, generation));
  }
}

// One way to open any post: community posts get their own page, everything else opens the post sheet.
function openPost(post, trigger = document.activeElement, options = {}) {
  if (!post?._id) return;
  if (isCommunityPost(post)) {
    const target = (post.destinations || []).find((destination) => destination.type === 'community' && destination.target);
    if (commentsDialog.open) closeCommentsNow({ clearHash: false });
    if (/^#post\//i.test(location.hash)) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    selectView('groups');
    communitiesPage.openPostPage(target.target, String(post._id));
    return;
  }
  openComments(post, trigger, options);
}

function openComments(post, trigger = document.activeElement, options = {}) {
  if (!post?._id) return;
  const id = String(post._id);
  if (commentsDialog.open && String(activeCommentsPost?._id) === id) return;
  activeCommentsPost = post; commentsReturnFocus = trigger instanceof HTMLElement ? trigger : null; commentsLoadGeneration++;
  const author = post.author?.displayName || post.author?.username || 'Player';
  $('.comments-title-desktop').textContent = `${author}’s post`;
  // The sheet shows a short preview; the full post (photos, actions) lives on the post page.
  const postHost = $('#comments-post'); postHost.replaceChildren();
  activeEmbeddedPost = null;
  const preview = document.createElement('div'); preview.className = 'cp-preview';
  const previewHead = document.createElement('div'); previewHead.className = 'cp-head';
  const previewAvatar = discussionAvatar(post.author); previewAvatar.classList.add('cp-avatar');
  const previewName = document.createElement('strong'); previewName.textContent = author;
  const viewPost = document.createElement('button'); viewPost.type = 'button'; viewPost.className = 'cp-view'; viewPost.textContent = 'View post';
  viewPost.addEventListener('click', () => { closeCommentsNow(); openPostPage(post); });
  previewHead.append(previewAvatar, previewName, viewPost);
  const previewText = document.createElement('p'); previewText.className = 'cp-text';
  previewText.textContent = post.title ? `${post.title}${post.body ? ' · ' + post.body : ''}` : (post.body || ((post.media || []).length ? 'Photo post' : ''));
  preview.append(previewHead, previewText);
  postHost.append(preview);
  $('#comments-form').hidden = !currentUser; $('#comments-signin').hidden = Boolean(currentUser);
  $('#comments-error').hidden = true;
  if (options.updateHash !== false && location.hash !== `#comments/${id}`) {
    history.pushState({ ...(history.state || {}), arcadiaComments: id }, '', `#comments/${id}`); commentsHashPushed = true;
  } else commentsHashPushed = false;
  if (!commentsDialog.open) commentsDialog.showModal();
  document.body.classList.add('comments-open');
  loadDiscussion(post);
  // On phones, don't pop the keyboard open until the person taps the box.
  if (currentUser && !window.matchMedia('(pointer: coarse)').matches) window.setTimeout(() => $('#comments-input').focus(), 40);
}

function closeCommentsNow({ clearHash = true } = {}) {
  if (!commentsDialog.open) return;
  commentsDialog.close(); document.body.classList.remove('comments-open'); activeCommentsPost = null; activeThread = null; activeEmbeddedPost = null; commentsLoadGeneration++;
  if (clearHash && /^#comments\/[a-f\d]{24}$/i.test(location.hash)) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  const target = commentsReturnFocus; commentsReturnFocus = null;
  if (target?.isConnected) window.setTimeout(() => target.focus(), 0);
}

function requestCommentsClose() {
  if (commentsHashPushed && /^#comments\/[a-f\d]{24}$/i.test(location.hash)) { commentsHashPushed = false; history.back(); return; }
  closeCommentsNow();
}

// The comment sheet lives at #comments/ID; the full post page at #post/ID.
async function syncCommentsRoute() {
  const match = location.hash.match(/^#comments\/([a-f\d]{24})$/i);
  if (!match) { if (commentsDialog.open) closeCommentsNow({ clearHash: false }); return false; }
  if (commentsDialog.open && String(activeCommentsPost?._id) === match[1]) return true;
  try { const result = await api(`/posts/${match[1]}`); openPost(result.post, null, { updateHash: false }); }
  catch { history.replaceState(history.state, '', `${location.pathname}${location.search}`); toast('That post is unavailable.'); }
  return true;
}

$('#comments-close').addEventListener('click', requestCommentsClose);
$('#comments-signin').addEventListener('click', () => openAuth({ type: 'comment', id: activeCommentsPost?._id }));
commentsDialog.addEventListener('click', (event) => { if (event.target === commentsDialog) requestCommentsClose(); });
commentsDialog.addEventListener('cancel', (event) => { event.preventDefault(); requestCommentsClose(); });
commentsDialog.addEventListener('close', () => { document.body.classList.remove('comments-open'); });
$('#comments-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!activeCommentsPost) return;
  const commentsForm = event.currentTarget;
  const input = $('#comments-input'); const send = $('button[type="submit"]', commentsForm); const body = input.value.trim(); if (!body) return;
  send.disabled = true;
  try {
    const result = await api(`/posts/${activeCommentsPost._id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    bumpCommentCount();
    const saved = { ...result.comment, author: result.comment.author?.username ? result.comment.author : currentUser };
    if (activeThread) { activeThread.addRoot(saved); $('#comments-scroll').scrollTop = $('#comments-scroll').scrollHeight; }
    input.value = ''; $('#comments-error').hidden = true;
  }
  catch (error) { setCommentsError(error, () => commentsForm.requestSubmit()); }
  finally { send.disabled = false; }
});
// Drag the comment sheet down by its handle or title: it follows your finger and springs closed or back.
{
  const dialogNode = $('#comments-dialog');
  const handle = $('.comments-drag-handle');
  const grabZones = [handle, handle.nextElementSibling].filter(Boolean);
  let startY = null; let startT = 0; let dragY = 0;
  const move = (y) => { dialogNode.style.transform = y ? `translateY(${y}px)` : ''; };
  grabZones.forEach((zone) => {
    zone.addEventListener('touchstart', (event) => { if (event.target.closest('button')) return; startY = event.touches[0].clientY; startT = Date.now(); dragY = 0; dialogNode.style.transition = 'none'; }, { passive: true });
    zone.addEventListener('touchmove', (event) => {
      if (startY === null) return;
      dragY = Math.max(0, event.touches[0].clientY - startY);
      move(dragY * 0.96);
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    const release = async () => {
      if (startY === null) return;
      const velocity = dragY / Math.max(1, Date.now() - startT);
      startY = null;
      dialogNode.style.transition = '';
      if (dragY > 110 || (dragY > 40 && velocity > 0.6)) {
        await springValue(dragY, dialogNode.offsetHeight, move, { velocity: velocity * 1000 });
        requestCommentsClose();
        window.setTimeout(() => move(0), 60);
      } else {
        await springValue(dragY, 0, move);
        move(0);
      }
    };
    zone.addEventListener('touchend', release, { passive: true });
    zone.addEventListener('touchcancel', release, { passive: true });
  });
}
initViewport();
initFonts();

// Pull down to refresh the page you're on (content only; never jumps to Home).
let shownProfile = null;
async function refreshCurrentView() {
  const view = document.body.dataset.view || 'feed';
  if (view === 'feed') await loadFeed(activeFeed);
  else if (view === 'games') await loadGames();
  else if (view === 'groups') await loadCommunities();
  else if (view === 'updates') await loadUpdates();
  else if (view === 'lfg') await lfgPage.show();
  else if (view === 'points') await social.renderPoints();
  else if (view === 'profile') await renderProfile(shownProfile || undefined);
  else if (view === 'friends') await renderFriends();
  else if (view === 'inbox') await messaging?.openInbox();
  if (currentUser) notifications.refresh();
}
initPullRefresh({ onRefresh: refreshCurrentView });
initSwipeBack({
  isHome: () => (document.body.dataset.view || 'feed') === 'feed' && navDepth === 0,
  canGoBack: () => navDepth > 0 || (document.body.dataset.view || 'feed') !== 'feed',
  goBack: () => goBack(),
  openMenu: () => menuDrawer.open(),
});

/* ------------------------------ page history ------------------------------
   Every move to another page adds a history entry, so the phone's Back button and the edge-swipe
   both return to the page you came from (with your scroll position). */
try {
  const state = history.state || {};
  navDepth = Number(state.depth) || 0;
  history.replaceState({ ...state, arcadiaView: state.arcadiaView || 'feed', depth: navDepth }, '');
} catch { /* history unavailable */ }

function pushNav(view, extra = {}) {
  try {
    history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, '');
    navDepth += 1;
    const url = view === 'post' && extra.postId ? `#post/${extra.postId}` : `${location.pathname}${location.search}`;
    history.pushState({ arcadiaView: view, depth: navDepth, ...extra }, '', url);
  } catch { /* history unavailable */ }
}

function leaveToHome() {
  // Opened straight onto an inner page (like a shared link): back means Home.
  navDepth = 0;
  try { history.replaceState({ arcadiaView: 'feed', depth: 0 }, '', `${location.pathname}${location.search}`); } catch { /* ignore */ }
  selectView('feed', { fromHistory: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function goBack() {
  if (commentsDialog.open) { requestCommentsClose(); return; }
  const view = document.body.dataset.view || 'feed';
  if (navDepth > 0) history.back();
  else if (view !== 'feed') leaveToHome();
}

window.addEventListener('popstate', async (event) => {
  if (await syncCommentsRoute()) return; // the comment sheet opened or closed
  const state = event.state || { arcadiaView: 'feed', depth: 0 };
  navDepth = Number(state.depth) || 0;
  const target = state.arcadiaView || 'feed';
  if (target === 'post' && state.postId) {
    if (document.body.dataset.view !== 'post' || String(pagePost?._id) !== String(state.postId)) {
      try { const result = await api(`/posts/${state.postId}`); showPostPage(result.post, { fromHistory: true }); }
      catch { leaveToHome(); }
    } else selectView('post', { fromHistory: true });
    return;
  }
  selectView(target, { fromHistory: true });
  if (target === 'profile' && state.profile) void renderProfile(state.profile);
  window.requestAnimationFrame(() => window.scrollTo({ top: Number(state.scrollY) || 0, behavior: 'instant' }));
});
window.addEventListener('hashchange', () => { void syncCommentsRoute(); });

/* ------------------------------- post page ------------------------------- */
function bumpPageComments(delta = 1) {
  if (!pagePost) return;
  pagePost.commentCount = Math.max(0, (pagePost.commentCount || 0) + delta);
  pageCard?._updateComments?.(pagePost.commentCount);
  document.querySelector(`#post-${pagePost._id}`)?._updateComments?.(pagePost.commentCount);
  const heading = $('#view-post .pp-count'); if (heading) heading.textContent = pagePost.commentCount === 1 ? '1 comment' : `${pagePost.commentCount} comments`;
}

function showPostPage(post, { fromHistory = false } = {}) {
  if (!post?._id) return;
  if (isCommunityPost(post)) { openPost(post, null); return; }
  pagePost = post;
  if (commentsDialog.open) closeCommentsNow({ clearHash: false });
  selectView('post', { fromHistory, extra: { postId: String(post._id) } });
  const host = $('#view-post'); host.replaceChildren();
  const page = uiEl('div', 'pp-page'); host.append(page);

  const bar = uiEl('div', 'pp-bar');
  const back = uiEl('button', 'pp-back'); back.type = 'button'; back.innerHTML = BACK_ICON; back.setAttribute('aria-label', 'Back');
  back.addEventListener('click', goBack);
  bar.append(back, uiEl('h1', 'pp-title', 'Post'));
  page.append(bar);

  pageCard = renderPost(post, { embedded: true });
  pageCard.classList.add('pp-card');
  page.append(pageCard);

  const count = pagePost.commentCount || 0;
  const heading = uiEl('h2', 'pp-count', count === 1 ? '1 comment' : `${count} comments`);
  const list = uiEl('div', 'pp-comments', '');
  page.append(heading, list);

  // Comment box pinned to the bottom, like a social post.
  const composer = uiEl('form', 'pp-composer');
  if (currentUser) {
    const input = uiEl('input', 'pp-input'); input.type = 'text'; input.maxLength = 1000; input.placeholder = 'Write a comment…'; input.setAttribute('aria-label', 'Write a comment'); input.autocomplete = 'off';
    const send = uiEl('button', 'pp-send', 'Send'); send.type = 'submit';
    composer.append(input, send);
    composer.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = input.value.trim(); if (!body) return;
      send.disabled = true;
      try {
        const result = await api(`/posts/${post._id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
        bumpPageComments(1);
        input.value = '';
        pageThread?.addRoot({ ...result.comment, author: result.comment.author?.username ? result.comment.author : currentUser });
      } catch (error) { toast(error.message || 'Could not post your comment.'); }
      finally { send.disabled = false; }
    });
  } else {
    const prompt = uiEl('button', 'pp-signin', 'Sign in to comment'); prompt.type = 'button';
    prompt.addEventListener('click', () => openAuth({ type: 'comment', id: post._id }));
    composer.append(prompt);
  }
  page.append(composer);

  const skeleton = uiEl('div', 'sk-stack');
  for (let i = 0; i < 3; i += 1) { const row = uiEl('div', 'sk-row'); row.append(uiEl('div', 'sk-line sk-line--short'), uiEl('div', 'sk-line'), uiEl('div', 'sk-line sk-line--mid')); skeleton.append(row); }
  list.append(skeleton);
  api(`/posts/${post._id}/comments?limit=50`).then((data) => {
    if (pagePost !== post) return;
    pageThread = createThread({ host: list, comments: data.items || [], ...commentThreadConfig(() => pagePost, bumpPageComments) });
  }).catch((error) => { list.replaceChildren(uiEl('p', 'pp-loading', error.message || 'Could not load comments.')); });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openPostPage(post) {
  if (!post?._id) return;
  showPostPage(post);
}

// Used for shared links and notifications: fetch, then show.
async function openPostPageById(id) {
  try { const result = await api(`/posts/${id}`); showPostPage(result.post); }
  catch { toast('That post is unavailable.'); }
}

// A shared link (#post/ID) opens the post page.
if (/^#post\/[a-f\d]{24}$/i.test(location.hash)) {
  const sharedId = location.hash.slice(6);
  window.setTimeout(() => { void api(`/posts/${sharedId}`).then((result) => { navDepth = 0; showPostPage(result.post, { fromHistory: true }); history.replaceState({ arcadiaView: 'post', depth: 0, postId: sharedId }, '', `#post/${sharedId}`); }).catch(() => { history.replaceState({ arcadiaView: 'feed', depth: 0 }, '', location.pathname); toast('That post is unavailable.'); }); }, 0);
}
if (/^#comments\/[a-f\d]{24}$/i.test(location.hash)) window.setTimeout(syncCommentsRoute, 0);

function createOwnerTools(slug){const form=document.createElement('form');form.className='community-owner-tools glass-panel';const title=document.createElement('h3');title.textContent='Manage moderators';const username=document.createElement('input');username.placeholder='Member username';username.pattern='[A-Za-z0-9_]{3,24}';username.required=true;username.setAttribute('aria-label','Member username');const role=document.createElement('select');role.setAttribute('aria-label','Member role');for(const value of ['moderator','member']){const option=document.createElement('option');option.value=value;option.textContent=value==='moderator'?'Make moderator':'Make member';role.append(option);}const submit=document.createElement('button');submit.className='button';submit.type='submit';submit.textContent='Update role';form.append(title,username,role,submit);form.addEventListener('submit',async(event)=>{event.preventDefault();submit.disabled=true;try{await api(`/communities/${slug}/members/${encodeURIComponent(username.value)}/role`,{method:'PATCH',body:JSON.stringify({role:role.value})});toast('Member role updated.');}catch(error){toast(error.message);}finally{submit.disabled=false;}});return form;}

/* The Games and Communities pages live in js/games.js and js/communities.js. */
const gamesPage = createGames({
  api,
  getUser: () => currentUser,
  toast,
  openAuth,
  gameInfo: getArcadiaGame,
  gameTheme: arcGameTheme,
  gameFont: getArcadiaGameFont,
  detailPage: arcDetailPage,
  navigate: (view) => selectView(view),
  openCommunity: (slug) => communitiesPage.open(slug),
  createCommunity: (prefill) => communitiesPage.openCreate(prefill),
  findCommunities: (slug) => communitiesPage.openExplore({ game: slug })
});

const share = createShare({
  api: (path, options) => api(path, options),
  getUser: () => currentUser,
  toast: (message) => toast(message),
});

const communitiesPage = createCommunities({
  share,
  onReport: (target) => safety.report(target),
  api,
  getUser: () => currentUser,
  toast,
  openAuth,
  gameInfo: getArcadiaGame,
  navigate: (view) => selectView(view),
  openGame: (slug) => gamesPage.openGame(slug)
});

const trendingGames = createTrendingGames({
  api,
  gameInfo: getArcadiaGame,
  openGame: (slug) => { selectView('games'); gamesPage.openGame(slug); },
  openGames: () => selectView('games'),
});
trendingGames.refresh();

// Top-bar search: players, games and communities.
createSearch({
  api,
  setAvatar: (node, avatar, initial) => setAvatar(node, avatar, initial),
  gameInfo: getArcadiaGame,
  onPlayer: (username) => { selectView('profile'); void renderProfile(username); },
  onGame: (slug) => { selectView('games'); gamesPage.openGame(slug); },
  onCommunity: (slug) => communitiesPage.open(slug),
  onClose: () => {
    $('.topbar').classList.remove('search-open');
    searchToggle.setAttribute('aria-expanded', 'false');
    searchToggle.setAttribute('aria-label', 'Open search');
  },
});

function loadGames() { void gamesPage.show(); }
function loadCommunities() { void communitiesPage.show(); }
function openCommunity(slug) { communitiesPage.open(slug); }

async function loadUpdates() {
  const host=$('#view-updates .section-placeholder');
  if (!host) return;
  host.className='updates-view';host.replaceChildren();
  const heading=document.createElement('div');heading.className='updates-heading';
  const label=document.createElement('span');label.textContent='PLAYER DISCUSSIONS · NOT OFFICIAL ANNOUNCEMENTS';heading.append(label);host.append(heading);
  if (!currentUser) {
    const note=document.createElement('p');note.className='catalog-message';note.textContent='Sign in to follow games and see their community updates.';host.append(note);return;
  }
  const slugs=(currentUser.favoriteGames||[]).slice(0,20);
  if (!slugs.length) {
    const note=document.createElement('p');note.className='catalog-message';note.textContent='Follow a game to see player posts and update discussions here.';
    const explore=document.createElement('button');explore.className='button button--primary';explore.type='button';explore.textContent='Explore games';explore.addEventListener('click',()=>selectView('games'));host.append(note,explore);return;
  }
  const toolbar=document.createElement('div');toolbar.className='updates-toolbar';const filter=document.createElement('select');filter.setAttribute('aria-label','Filter game updates');const all=document.createElement('option');all.value='all';all.textContent='All followed games';filter.append(all);const list=document.createElement('div');list.className='updates-posts';list.textContent='Loading game conversations…';host.append(toolbar,list);
  try {
    const [pages,catalog]=await Promise.all([Promise.all(slugs.map((slug)=>api(`/posts?game=${encodeURIComponent(slug)}&limit=10`).catch(()=>({items:[]})))),api('/games?limit=100').catch(()=>({items:[]}))]);
    const gameNames=new Map(catalog.items.map((game)=>[game.slug,game.name]));for(const slug of slugs){const option=document.createElement('option');option.value=slug;option.textContent=gameNames.get(slug)||slug;filter.append(option);}toolbar.append(filter);
    const postsByGame=new Map();for(let index=0;index<slugs.length;index++)for(const post of pages[index].items||[]){if(![...postsByGame.values()].some((items)=>items.some((entry)=>entry._id===post._id))){const selected=post.destinations?.find((destination)=>destination.type==='game'&&slugs.includes(destination.target))?.target||slugs[index];if(!postsByGame.has(selected))postsByGame.set(selected,[]);postsByGame.get(selected).push(post);}}
    const renderGroups=()=>{list.replaceChildren();const chosen=filter.value;const groups=chosen==='all'?slugs.filter((slug)=>postsByGame.has(slug)):[chosen].filter((slug)=>postsByGame.has(slug));if(!groups.length){const note=document.createElement('p');note.className='catalog-message';note.textContent='No player conversations yet for this game.';list.append(note);return;}for(const slug of groups){const section=document.createElement('section');section.className='updates-game-group';const title=document.createElement('h2');title.textContent=gameNames.get(slug)||slug;section.append(title);for(const post of postsByGame.get(slug))section.append(renderPost(post));list.append(section);}};
    filter.addEventListener('change',renderGroups);renderGroups();
  } catch(error) { list.replaceChildren();const note=document.createElement('p');note.className='catalog-message';note.textContent=error.message;list.append(note); }
}

const onboarding = createOnboarding({
  api,
  getUser: () => currentUser,
  setUser: (user) => { currentUser = user; },
  onFinish: () => { updateSignedInUI(); selectView('feed'); toast('You’re all set.'); },
});

const lfgPage = createLfg({
  mount: $('#lfg-root'),
  api: (path, options) => api(path, options),
  getUser: () => currentUser,
  toast,
  onNeedSignIn: () => { openAuth(); toast('Sign in to find players.'); },
  setAvatar: (node, avatar, initial) => setAvatar(node, avatar, initial),
  onOpenProfile: (username) => { if (!username) return; selectView('profile'); void renderProfile(username); },
  onMessage: (user) => { if (user) messaging?.openChat(user); },
  onReport: (post) => safety.report({ type: 'lfg', target: post._id, label: `${post.mode} invite by @${post.author?.username || 'player'}` }),
});

notifications = createNotifications({
  api: (path, options) => api(path, options),
  getUser: () => currentUser,
  button: $('#notifications-button'),
  onNeedSignIn: () => openAuth(),
  onOpenPost: async (postId) => {
    try { const detail = await api(`/posts/${postId}`); openPostPage(detail.post); }
    catch { toast('That post is no longer available.'); }
  },
  onOpenProfile: (username) => { if (!username) return; selectView('profile'); void renderProfile(username); },
  onOpenFriends: () => selectView('friends'),
  onOpenLfg: (item) => { selectView('lfg'); if (item?.type === 'lfg_request') void lfgPage.openFor('', 'mine'); },
});
if (currentUser) notifications.refresh();

// Left menu drawer (three-bar button): every section in one place.
const menuDrawer = createDrawer({
  toggle: $('#menu-toggle'),
  getUser: () => currentUser,
  getView: () => document.body.dataset.view || 'feed',
  actions: {
    go: (view) => selectView(view),
    openInvites: () => { selectView('lfg'); void lfgPage.openFor('', 'mine'); },
    openPoints: () => { social.setPointsTarget(currentUser?.username); selectView('points'); },
    openNotifications: () => $('#notifications-button').click(),
    openSettings: async () => { selectView('profile'); await profilePromise; renderSettings($('#view-profile')); },
    compose: () => composer.open({}),
    signIn: () => openAuth(),
    signOut: () => $('#auth-open').click(),
    isDark: () => document.documentElement.dataset.theme === 'dark',
    toggleTheme: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
    setAvatar: (node, avatar, initial) => setAvatar(node, avatar, initial),
  },
});


function startOnboarding() {
  onboarding.start();
}

/* Arcadia profile, edit-profile sheet and settings.
   Profile page, edit sheet and settings. */

const BACK_ICON = '<svg class="back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

function uiEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}


const PF_COVERS = ['nebula', 'sunset', 'ocean', 'pitch', 'dusk'];

function pfHash(value) {
  let total = 0;

  for (const ch of String(value)) {
    total = (total * 31 + ch.charCodeAt(0)) >>> 0;
  }

  return total;
}

function pfCover(seed) {
  return `/assets/arcadia/covers/cover-${PF_COVERS[pfHash(seed) % PF_COVERS.length]}.svg`;
}

function pfGameName(game) {
  return typeof game === 'string'
    ? game
    : (game?.name || game?.title || game?.slug || String(game));
}


// ========================================
// ARCADIA GAME CATALOGUE
// ========================================

const ARCADIA_GAME_CATALOG = {
  'fc mobile': {
    title: 'EA SPORTS FC Mobile',
    banner: 'fc-mobile-banner.jpg',
    cover: 'fc-mobile.jpg',
    genre: 'Football · Sports',
    developer: 'EA SPORTS',
    platforms: 'iOS · Android',
    description: 'Build your ultimate football squad, collect legendary players and compete in fast-paced football matches. Take your club through competitive events, seasonal campaigns and head-to-head battles.'
  },

  'pubg mobile': {
    title: 'PUBG MOBILE',
    banner: 'pubg-mobile-banner.jpg',
    cover: 'pubg-mobile.jpg',
    genre: 'Battle Royale · Shooter',
    developer: 'Level Infinite',
    platforms: 'iOS · Android',
    description: 'Drop into a massive battleground, scavenge for equipment and fight to survive. PUBG MOBILE combines tactical decisions, squad coordination and intense last-player-standing competition.'
  },

  'call of duty mobile': {
    title: 'Call of Duty: Mobile',
    banner: 'call-of-duty-mobile-banner.jpg',
    cover: 'call-of-duty-mobile.jpg',
    genre: 'FPS · Action',
    developer: 'Activision',
    platforms: 'iOS · Android',
    description: 'Experience fast-paced multiplayer combat, iconic maps and intense battle royale matches. Build your loadout, master different weapons and compete across a variety of game modes.'
  },

  'call of duty': {
    title: 'Call of Duty: Mobile',
    banner: 'call-of-duty-mobile-banner.jpg',
    cover: 'call-of-duty-mobile.jpg',
    genre: 'FPS · Action',
    developer: 'Activision',
    platforms: 'iOS · Android',
    description: 'Experience fast-paced multiplayer combat, iconic maps and intense battle royale matches. Build your loadout, master different weapons and compete across a variety of game modes.'
  },

  'free fire': {
    title: 'Garena Free Fire',
    banner: 'free-fire-banner.jpg',
    cover: 'free-fire.jpg',
    genre: 'Battle Royale · Shooter',
    developer: 'Garena',
    platforms: 'iOS · Android',
    description: 'Enter quick, action-packed survival matches where positioning, precision and smart decisions matter. Choose your character, build your strategy and fight to become the last survivor.'
  },

  'efootball': {
    title: 'eFootball',
    banner: 'efootball-banner.jpg',
    cover: 'efootball.jpg',
    genre: 'Football · Sports',
    developer: 'Konami',
    platforms: 'iOS · Android · PC · Console',
    description: 'Experience digital football with real clubs, players and competitive match modes. Build your dream team, develop your tactics and take your football ambitions onto the pitch.'
  },

  'roblox': {
    title: 'Roblox',
    banner: 'roblox-banner.jpg',
    cover: 'roblox.jpg',
    genre: 'Sandbox · Social',
    developer: 'Roblox Corporation',
    platforms: 'iOS · Android · PC · Console',
    description: 'Explore a vast universe of player-created experiences. From adventure and role-playing to simulations and competitive games, Roblox is a platform for discovering and creating worlds.'
  },

  'minecraft': {
    title: 'Minecraft',
    banner: 'minecraft-banner.jpg',
    cover: 'minecraft.jpg',
    genre: 'Sandbox · Survival',
    developer: 'Mojang Studios',
    platforms: 'Mobile · PC · Console',
    description: 'Shape entire worlds one block at a time. Gather resources, build extraordinary structures, explore dangerous environments and create your own adventures in an open-ended sandbox.'
  },

  'fortnite': {
    title: 'Fortnite',
    banner: 'fortnite-banner.jpg',
    cover: 'fortnite.jpg',
    genre: 'Battle Royale · Action',
    developer: 'Epic Games',
    platforms: 'PC · Console · Supported mobile devices',
    description: 'Jump into a constantly evolving universe of competitive battles, creative experiences and live events. Build, explore and compete in a world that keeps changing.'
  },

  
  'among us': {
    title: 'Among Us',
    banner: 'among-us-banner.jpg',
    cover: 'among-us.jpg',
    genre: 'Social Deduction · Multiplayer',
    developer: 'Innersloth',
    platforms: 'iOS · Android · PC · Console',
    description: 'Work together aboard a spaceship, complete tasks and uncover the impostors hiding among the crew. Deception, teamwork and suspicion make every round unpredictable.'
  },

  'apex legends': {
    title: 'Apex Legends',
    banner: 'apex-legends-banner.jpg',
    cover: 'apex-legends.jpg',
    genre: 'Battle Royale · FPS',
    developer: 'Respawn Entertainment',
    platforms: 'PC · Console',
    description: 'Enter a futuristic battle royale where unique Legends bring their own abilities to the battlefield. Coordinate with your squad, master your weapons and fight for champion status.'
  },

  'asphalt legends unite': {
    title: 'Asphalt Legends Unite',
    banner: 'asphalt-legends-unite-banner.jpg',
    cover: 'asphalt-legends-unite.jpg',
    genre: 'Racing · Arcade',
    developer: 'Gameloft',
    platforms: 'Mobile · PC · Console',
    description: 'Race exotic supercars across spectacular locations, perform gravity-defying stunts and compete against players in high-speed arcade racing.'
  },

  'dota 2': {
    title: 'Dota 2',
    banner: 'dota-2-banner.jpg',
    cover: 'dota-2.jpg',
    genre: 'MOBA · Strategy',
    developer: 'Valve',
    platforms: 'PC',
    description: 'Choose from a vast roster of heroes and battle in a competitive multiplayer arena. Strategy, teamwork, timing and mastery shape every match.'
  },

  'elden ring': {
    title: 'Elden Ring',
    banner: 'elden-ring-banner.jpg',
    cover: 'elden-ring.jpg',
    genre: 'Action RPG · Open World',
    developer: 'FromSoftware',
    platforms: 'PC · PlayStation · Xbox',
    description: 'Explore the vast Lands Between, face formidable enemies and uncover a mysterious world filled with secrets, ancient powers and challenging combat.'
  },

  'ea sports fc': {
    title: 'EA SPORTS FC',
    banner: 'ea-sports-fc-banner.jpg',
    cover: 'ea-sports-fc.jpg',
    genre: 'Football · Sports',
    developer: 'EA SPORTS',
    platforms: 'PC · PlayStation · Xbox · Nintendo Switch',
    description: 'Experience club football with authentic teams, players and competitions. Build your squad, develop your tactics and compete across multiple football modes.'
  },

  'forza horizon 5': {
    title: 'Forza Horizon 5',
    banner: 'forza-horizon-5-banner.jpg',
    cover: 'forza-horizon-5.jpg',
    genre: 'Racing · Open World',
    developer: 'Playground Games',
    platforms: 'PC · Xbox · PlayStation',
    description: 'Explore a vibrant open-world version of Mexico, collect incredible cars and take on races, challenges and automotive adventures.'
  },

  'genshin impact': {
    title: 'Genshin Impact',
    banner: 'genshin-impact-banner.jpg',
    cover: 'genshin-impact.jpg',
    genre: 'Action RPG · Adventure',
    developer: 'HoYoverse',
    platforms: 'Mobile · PC · PlayStation',
    description: 'Journey through the fantasy world of Teyvat, discover elemental powers, meet memorable characters and uncover the mysteries of a sprawling adventure.'
  },

  'grand theft auto v': {
    title: 'Grand Theft Auto V',
    banner: 'gta-v-banner.jpg',
    cover: 'gta-v.jpg',
    genre: 'Action · Open World',
    developer: 'Rockstar Games',
    platforms: 'PC · PlayStation · Xbox',
    description: 'Explore Los Santos through interconnected stories of crime, ambition and survival. Experience an expansive open world and the ever-evolving GTA Online universe.'
  },

  'gta v': {
    title: 'Grand Theft Auto V',
    banner: 'gta-v-banner.jpg',
    cover: 'gta-v.jpg',
    genre: 'Action · Open World',
    developer: 'Rockstar Games',
    platforms: 'PC · PlayStation · Xbox',
    description: 'Explore Los Santos through interconnected stories of crime, ambition and survival. Experience an expansive open world and the ever-evolving GTA Online universe.'
  },

  'league of legends': {
    title: 'League of Legends',
    banner: 'league-of-legends-banner.jpg',
    cover: 'league-of-legends.jpg',
    genre: 'MOBA · Strategy',
    developer: 'Riot Games',
    platforms: 'PC',
    description: 'Choose a champion, build your strategy and compete in tactical five-versus-five battles. Team coordination and smart decisions determine victory.'
  },

  'overwatch 2': {
    title: 'Overwatch 2',
    banner: 'overwatch-2-banner.jpg',
    cover: 'overwatch-2.jpg',
    genre: 'Hero Shooter · Action',
    developer: 'Blizzard Entertainment',
    platforms: 'PC · Console',
    description: 'Join a team-based hero shooter featuring distinctive characters, powerful abilities and objective-driven battles across a variety of maps.'
  },

  'rainbow six siege': {
    title: 'Rainbow Six Siege',
    banner: 'rainbow-six-siege-banner.jpg',
    cover: 'rainbow-six-siege.jpg',
    genre: 'Tactical FPS · Shooter',
    developer: 'Ubisoft',
    platforms: 'PC · PlayStation · Xbox',
    description: 'Experience tactical team-based combat where preparation, destruction and precise coordination can decide the outcome of every round.'
  },

  'rocket league': {
    title: 'Rocket League',
    banner: 'rocket-league-banner.jpg',
    cover: 'rocket-league.jpg',
    genre: 'Sports · Racing',
    developer: 'Psyonix',
    platforms: 'PC · PlayStation · Xbox · Nintendo Switch',
    description: 'Drive rocket-powered cars, perform aerial manoeuvres and score spectacular goals in a competitive blend of football and vehicular action.'
  },

  'stardew valley': {
    title: 'Stardew Valley',
    banner: 'stardew-valley-banner.jpg',
    cover: 'stardew-valley.jpg',
    genre: 'Simulation · Farming RPG',
    developer: 'ConcernedApe',
    platforms: 'Mobile · PC · Console',
    description: 'Build a peaceful life in the countryside. Grow crops, raise animals, explore caves, build relationships and restore your grandfather’s farm.'
  },

  'tekken 8': {
    title: 'TEKKEN 8',
    banner: 'tekken-8-banner.jpg',
    cover: 'tekken-8.jpg',
    genre: 'Fighting · Action',
    developer: 'Bandai Namco Studios',
    platforms: 'PC · PlayStation · Xbox',
    description: 'Enter the next chapter of the legendary fighting series. Master powerful fighters, learn complex combos and compete in intense one-on-one battles.'
  },

  'the sims 4': {
    title: 'The Sims 4',
    banner: 'the-sims-4-banner.jpg',
    cover: 'the-sims-4.jpg',
    genre: 'Life Simulation',
    developer: 'Maxis',
    platforms: 'PC · PlayStation · Xbox',
    description: 'Create characters, design homes and guide lives through an open-ended simulation full of relationships, careers, creativity and unexpected stories.'
  },

  'valorant': {
    title: 'VALORANT',
    banner: 'valorant-banner.jpg',
    cover: 'valorant.jpg',
    genre: 'Tactical FPS · Hero Shooter',
    developer: 'Riot Games',
    platforms: 'PC · Console',
    description: 'Combine precise gunplay with distinctive agent abilities in competitive five-versus-five tactical matches. Strategy, teamwork and aim are essential.'
  }

};


const ARCADIA_GAME_FONTS = {
  'pubg mobile': '"Arial Narrow", sans-serif',
  'call of duty mobile': '"Impact", sans-serif',
  'free fire': '"Arial Black", sans-serif',
  'minecraft': '"Minecraftia", monospace',
  'fortnite': '"Burbank Big Condensed", "Arial Narrow", sans-serif',
  'valorant': '"DIN Next LT Pro", "Arial Narrow", sans-serif',
  'gta v': '"Pricedown", "Arial Black", sans-serif',
  'grand theft auto v': '"Pricedown", "Arial Black", sans-serif',
  'league of legends': '"Beaufort for LOL", Georgia, serif'
};


const ARCADIA_GAME_THEMES = {
  'fc mobile': {
    accent: '#00D879',
    secondary: '#A6FFCB',
    background: '#07150F',
    surface: '#10251A',
    text: '#F4FFF8'
  },

  'pubg mobile': {
    accent: '#F5A623',
    secondary: '#FFD58A',
    background: '#17130D',
    surface: '#292116',
    text: '#FFF9EF'
  },

  'call of duty mobile': {
    accent: '#D6B66A',
    secondary: '#F0D99C',
    background: '#14150F',
    surface: '#25271C',
    text: '#F8F8EE'
  },

  'free fire': {
    accent: '#FF6B35',
    secondary: '#FFB36B',
    background: '#190D0A',
    surface: '#2D1710',
    text: '#FFF5EF'
  },

  'efootball': {
    accent: '#00A9E8',
    secondary: '#79DCFF',
    background: '#07121D',
    surface: '#102538',
    text: '#F0FAFF'
  },

  'minecraft': {
    accent: '#78B94A',
    secondary: '#A9D879',
    background: '#101A10',
    surface: '#1B2A19',
    text: '#F5FFF0'
  },

  'valorant': {
    accent: '#FF4655',
    secondary: '#FF8992',
    background: '#16090C',
    surface: '#291116',
    text: '#FFF5F5'
  },

  'fortnite': {
    accent: '#9B7BFF',
    secondary: '#64D9FF',
    background: '#100E20',
    surface: '#211B3C',
    text: '#F7F4FF'
  },

  'roblox': {
    accent: '#FFFFFF',
    secondary: '#B8B8B8',
    background: '#111111',
    surface: '#242424',
    text: '#FFFFFF'
  },

  'among us': {
    accent: '#FF5656',
    secondary: '#FF9B9B',
    background: '#160D13',
    surface: '#291820',
    text: '#FFF5F7'
  },

  'apex legends': {
    accent: '#E84B3C',
    secondary: '#FF9B8E',
    background: '#1A0E0D',
    surface: '#301A18',
    text: '#FFF5F3'
  },

  'genshin impact': {
    accent: '#73C9D8',
    secondary: '#B6E8ED',
    background: '#0D1820',
    surface: '#1B303B',
    text: '#F1FBFF'
  },

  'gta v': {
    accent: '#8BC34A',
    secondary: '#D2E69B',
    background: '#10150D',
    surface: '#20291A',
    text: '#F7FBEF'
  },

  'league of legends': {
    accent: '#C8A45D',
    secondary: '#EBD49B',
    background: '#10151D',
    surface: '#1D2A39',
    text: '#F8F5ED'
  },

  'rocket league': {
    accent: '#36A9FF',
    secondary: '#9BD8FF',
    background: '#081321',
    surface: '#12263B',
    text: '#F2F9FF'
  }
};


function getArcadiaGameFont(gameTitle) {
  const key = String(gameTitle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  return ARCADIA_GAME_FONTS[key] || '"Segoe UI", sans-serif';
}



// ========================================
// GAME LOOKUP
// ========================================


function getArcadiaGame(gameName) {
  const originalName = pfGameName(gameName);

  const key = String(originalName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  const aliases = {
    'ea sports fc mobile': 'fc mobile',
    'fifa mobile': 'fc mobile',
    'pubg': 'pubg mobile',
    'cod mobile': 'call of duty mobile',
    'call of duty': 'call of duty mobile',
    'garena free fire': 'free fire',
    'grand theft auto v': 'gta v',
    'gta 5': 'gta v',
    'asphalt': 'asphalt legends unite',
    'rainbow six': 'rainbow six siege',
    'lol': 'league of legends'
  };

  const resolvedKey = aliases[key] || key;

  // Games an admin added later have no built-in artwork: ask the server for what was uploaded
  // (it answers with the image, or 404 and the usual coloured tile shows).
  const artSlug = resolvedKey.replace(/\s+/g, '-');

  return ARCADIA_GAME_CATALOG[resolvedKey] || {
    title: originalName,
    banner: artSlug ? `../../../api/games/art/${artSlug}/banner` : '',
    cover: artSlug ? `../../../api/games/art/${artSlug}/cover` : '',
    genre: 'Video game',
    developer: 'Not listed',
    platforms: 'Not listed',
    description: 'Discover this game and learn more about what makes it worth playing.'
  };
}


function pfTile(name) {
  const initials = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?';
  const tile = uiEl('span', 'pf-tile', initials);
  tile.style.backgroundImage = `url(/assets/arcadia/game-tiles/tile-${(pfHash(name) % 6) + 1}.svg)`;
  tile.setAttribute('aria-hidden', 'true');
  return tile;
}


function pfAboutGameCover(name) {
  const aliases = {
    'among us': 'among-us',
    'asphalt legends unite': 'asphalt-legends-unite',
    'call of duty': 'call-of-duty-mobile',
    'call of duty mobile': 'call-of-duty-mobile',
    'call of duty: mobile': 'call-of-duty-mobile',
    'dota 2': 'dota-2',
    'ea sports fc': 'ea-sports-fc',
    'efootball': 'efootball',
    'elden ring': 'elden-ring',
    'fc mobile': 'fc-mobile',
    'free fire': 'free-fire',
    'genshin impact': 'genshin-impact',
    'gta v': 'gta-v',
    'grand theft auto v': 'gta-v',
    'league of legends': 'league-of-legends',
    'minecraft': 'minecraft',
    'pubg mobile': 'pubg-mobile',
    'rainbow six siege': 'rainbow-six-siege',
    'roblox': 'roblox',
    'rocket league': 'rocket-league',
    'stardew valley': 'stardew-valley',
    'tekken 8': 'tekken-8',
    'the sims 4': 'the-sims-4',
    'valorant': 'valorant',
    'fortnite': 'fortnite',
    'forza horizon 5': 'forza-horizon-5'
  };

  const slugAliases = {
    'fc-mobile': 'fc-mobile',
    'ea-sports-fc': 'ea-sports-fc',
    'call-of-duty': 'call-of-duty-mobile',
    'call-of-duty-mobile': 'call-of-duty-mobile',
    'apex-legends': 'apex-legends',
    'overwatch-2': 'overwatch-2',
    'asphalt-legends-unite': 'asphalt-legends-unite',
    'dota-2': 'dota-2',
    'elden-ring': 'elden-ring',
    'free-fire': 'free-fire',
    'genshin-impact': 'genshin-impact',
    'gta-v': 'gta-v',
    'league-of-legends': 'league-of-legends',
    'pubg-mobile': 'pubg-mobile',
    'rainbow-six-siege': 'rainbow-six-siege',
    'rocket-league': 'rocket-league',
    'stardew-valley': 'stardew-valley',
    'tekken-8': 'tekken-8',
    'the-sims-4': 'the-sims-4',
    'forza-horizon-5': 'forza-horizon-5',
    'among-us': 'among-us',
    'efootball': 'efootball',
    'fortnite': 'fortnite',
    'minecraft': 'minecraft',
    'roblox': 'roblox',
    'valorant': 'valorant'
  };

  const key = String(name).trim().toLowerCase();
  const slug = aliases[key] || slugAliases[key];

  const cover = document.createElement('img');
  cover.className = 'pf-about-game-cover';
  cover.alt = '';
  cover.loading = 'lazy';
  cover.decoding = 'async';

  if (slug) {
    cover.src = `/assets/arcadia/games/${slug}.jpg`;

    cover.addEventListener('error', () => {
      console.error(
        'Arcadia game cover failed to load:',
        cover.src,
        'Game:',
        name
      );
    });
  } else {
    console.warn('Arcadia game has no artwork mapping:', name);
    cover.hidden = true;
  }

  return cover;
}

function pfDaysText(createdAt) {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (!Number.isFinite(days)) return '';
  const safe = Math.max(0, days);
  return safe < 30 ? `${safe} days` : safe < 365 ? `${Math.floor(safe / 30)} months` : `${(safe / 365).toFixed(1)} years`;
}
function pfEmpty(art, title, copy, actionLabel, action) {
  const box = uiEl('div', 'pf-empty');
  const img = document.createElement('img'); img.src = `/assets/arcadia/empty-states/${art}.svg`; img.alt = ''; img.width = 160; img.height = 120;
  box.append(img, uiEl('h3', 'pf-empty-title', title), uiEl('p', 'pf-empty-copy', copy));
  if (actionLabel) { const button = uiEl('button', 'button button--primary', actionLabel); button.type = 'button'; button.addEventListener('click', action); box.append(button); }
  return box;
}

/* Friend buttons for other people's profiles.
   (profile friend actions) */

function pfConfirm(title, message, confirmLabel) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'sheet'; dialog.setAttribute('aria-labelledby', 'pf-confirm-title');
    const form = document.createElement('form'); form.method = 'dialog';
    const head = uiEl('div', 'sheet-head'); const heading = uiEl('h2', '', title); heading.id = 'pf-confirm-title'; head.append(heading);
    const body = uiEl('div', 'sheet-body'); body.append(uiEl('p', '', message));
    const foot = uiEl('div', 'sheet-foot');
    const cancel = uiEl('button', 'button', 'Cancel'); cancel.type = 'button';
    const confirm = uiEl('button', 'button button--danger', confirmLabel); confirm.type = 'submit'; foot.append(cancel, confirm);
    form.append(head, body, foot); dialog.append(form);
    let answer = false;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', () => { answer = true; });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(answer); });
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}

function pfMoreMenu(user) {
  const wrap = uiEl('div', 'pf-more');
  const button = uiEl('button', 'button pf-icon-btn', ''); button.type = 'button';
  button.setAttribute('aria-label', 'More options');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  const menu = uiEl('div', 'pf-more-menu'); menu.setAttribute('role', 'menu');
  const item = (label, danger, run) => {
    const entry = uiEl('button', `pf-more-item${danger ? ' is-danger' : ''}`, label); entry.type = 'button'; entry.setAttribute('role', 'menuitem');
    entry.addEventListener('click', () => { popover.hide(); run(); });
    return entry;
  };
  menu.append(item('Report', false, () => safety.report({ type: 'user', target: user.username, label: `@${user.username}` })), item(`Block @${user.username}`, true, () => safety.block(user)));
  const popover = attachMenu(button, menu);
  wrap.append(button);
  return wrap;
}

async function pfFriendActions(actions, user) {
  const make = (label, className, handler) => {
    const button = uiEl('button', className, label); button.type = 'button';
    button.addEventListener('click', () => handler(button)); return button;
  };
  const render = async () => {
    actions.replaceChildren();
    if (!currentUser) { actions.append(make('Add friend', 'button', () => openAuth())); return; }
    let info;
    try { info = await api(`/friends/status/${encodeURIComponent(user.username)}`); } catch { return; }
    if (info.status === 'self') return;
    const run = async (button, work, message) => {
      button.disabled = true;
      try { await work(); if (message) toast(message); await render(); }
      catch (e) { toast(e.message); button.disabled = false; }
    };
    const name = encodeURIComponent(user.username);
    if (info.status === 'none') {
      actions.append(make('Add friend', 'button', (b) => run(b, () => api(`/friends/${name}`, { method: 'POST' }), 'Friend request sent.')));
    } else if (info.status === 'sent') {
      actions.append(uiEl('span', 'pf-chip', 'Request sent'),
        make('Cancel request', 'button', (b) => run(b, () => api(`/friends/${info.requestId}`, { method: 'DELETE' }), 'Request cancelled.')));
    } else if (info.status === 'received') {
      actions.append(
        make('Accept', 'button button--primary', (b) => run(b, () => api(`/friends/${info.requestId}`, { method: 'PATCH', body: JSON.stringify({ action: 'accept' }) }), `You and ${user.displayName || user.username} are now friends.`)),
        make('Decline', 'button', (b) => run(b, () => api(`/friends/${info.requestId}`, { method: 'PATCH', body: JSON.stringify({ action: 'reject' }) }), 'Request declined.')));
    } 
else if (info.status === 'friends') {
  const chat = make('', 'button pf-icon-btn', () => {
    selectView('inbox');
    messaging?.openChat(user);
  });
  chat.setAttribute('aria-label', `Message ${user.displayName || user.username}`);
  chat.title = 'Message';
  chat.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.8-3.1A7.5 7.5 0 1 1 20 11.5Z"/></svg>';
  actions.append(chat);

  actions.append(make('Friends', 'button', async (b) => {
    const ok = await pfConfirm(
      'Remove friend?',
      `${user.displayName || user.username} will be removed from your friends. You can send a new request later.`,
      'Remove'
    );

    if (ok) {
      await run(
        b,
        () => api(`/friends/remove/${name}`, { method: 'DELETE' }),
        'Friend removed.'
      );
    }
  }));
}

  };
  await render();
}

/* Friends page: Friends list, Requests and Find players.
   Uses helpers: uiEl, pfEmpty, pfConfirm, api, toast, currentUser, openAuth, selectView, renderProfile. */

function fdAvatar(person) {
  const name = person.displayName || person.username;
  const node = uiEl('span', 'fd-avatar', name[0].toUpperCase()); setAvatar(node, person.avatar, name[0].toUpperCase());
  node.setAttribute('aria-hidden', 'true');
  presence.mark(node, person.username);
  return node;
}

function fdRow(person, fill) {
  const row = uiEl('div', 'fd-item');
  const main = uiEl('button', 'fd-main'); main.type = 'button';
  main.setAttribute('aria-label', `Open ${person.displayName || person.username}'s profile`);
  const handleLine = uiEl('span', 'fd-handle', `@${person.username}`);
  presence.bindLabel(handleLine, person.username, `@${person.username}`, `@${person.username} · `);
  main.append(uiEl('span', 'fd-name', person.displayName || person.username), handleLine);
  if (person.bio) main.append(uiEl('span', 'fd-bio', person.bio));
  main.addEventListener('click', () => { selectView('profile'); void renderProfile(person.username); });
  const actions = uiEl('div', 'fd-actions');
  row.append(fdAvatar(person), main, actions);
  fill?.(actions);
  return row;
}

async function renderFriends() {
  const host = $('#view-friends'); if (!host) return;
  host.replaceChildren(); host.append(uiEl('h1', 'sr-only', 'Friends'));
  const page = uiEl('div', 'pf-page'); host.append(page);
  const card = uiEl('section', 'pf-card'); page.append(card);
  if (!currentUser) {
    card.append(pfEmpty('empty-friends', 'Your squad is waiting', 'Sign in to add friends, share game nights and keep the conversation going.', 'Sign in', () => openAuth()));
    return;
  }
  card.append(uiEl('h2', 'fd-title', 'Friends'), uiEl('p', 'fd-sub', 'Find players, answer requests and keep your squad close.'));
  const tabsBar = uiEl('div', 'pf-tabs'); tabsBar.setAttribute('role', 'tablist'); tabsBar.setAttribute('aria-label', 'Friends sections');
  const body = uiEl('div', 'fd-body'); card.append(tabsBar, body);
  const state = { tab: 'friends', friends: [], incoming: [], outgoing: [] };
  let searchToken = 0; let resultsBox = null; let searchInput = null;

  const load = async () => {
    const [friends, incoming, outgoing] = await Promise.all([api('/friends/list'), api('/friends/incoming'), api('/friends/outgoing')]);
    state.friends = friends.items || []; state.incoming = incoming.items || []; state.outgoing = outgoing.items || [];
  };
  const act = (label, className, work, message) => {
    const button = uiEl('button', className, label); button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await work(); if (message) toast(message); await refresh(); } catch (e) { toast(e.message); button.disabled = false; }
    });
    return button;
  };
  const drawTabs = () => {
    tabsBar.replaceChildren();
    for (const [key, label] of [['friends', 'Friends'], ['requests', 'Requests'], ['find', 'Find players']]) {
      const tab = uiEl('button', 'pf-tab', label); tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.tab === key));
      if (key === 'requests' && state.incoming.length) tab.append(uiEl('span', 'fd-badge', String(state.incoming.length)));
      tab.addEventListener('click', () => { state.tab = key; draw(); });
      tabsBar.append(tab);
    }
  };
  const resultActions = (item) => (actions) => {
    const name = encodeURIComponent(item.username);
    if (item.status === 'none') {
      if (item.canRequest) actions.append(act('Add friend', 'button button--primary', () => api(`/friends/${name}`, { method: 'POST' }), 'Friend request sent.'));
      else actions.append(uiEl('span', 'pf-chip', 'Not accepting requests'));
    } else if (item.status === 'sent') {
      actions.append(uiEl('span', 'pf-chip', 'Request sent'), act('Cancel', 'button', () => api(`/friends/${item.requestId}`, { method: 'DELETE' }), 'Request cancelled.'));
    } else if (item.status === 'received') {
      actions.append(
        act('Accept', 'button button--primary', () => api(`/friends/${item.requestId}`, { method: 'PATCH', body: JSON.stringify({ action: 'accept' }) }), 'Friend added.'),
        act('Decline', 'button', () => api(`/friends/${item.requestId}`, { method: 'PATCH', body: JSON.stringify({ action: 'reject' }) }), 'Request declined.'));
    } else if (item.status === 'friends') actions.append(uiEl('span', 'pf-chip', 'Friends'));
  };
  const runSearch = async () => {
    if (!resultsBox) return;
    const q = searchInput.value.trim(); const token = ++searchToken;
    if (q.length < 2) { resultsBox.replaceChildren(uiEl('p', 'fd-hint', 'Type at least 2 characters of a username.')); return; }
    try {
      const data = await api(`/friends/search?q=${encodeURIComponent(q)}`);
      if (token !== searchToken) return;
      resultsBox.replaceChildren();
      if (!data.items.length) { resultsBox.append(pfEmpty('empty-friends', 'No players found', `Nobody matches "${q}". Check the spelling of the username.`)); return; }
      const list = uiEl('div', 'fd-list'); for (const item of data.items) list.append(fdRow(item, resultActions(item))); resultsBox.append(list);
    } catch (e) { if (token === searchToken) resultsBox.replaceChildren(uiEl('p', 'fd-hint', e.message)); }
  };
  const draw = () => {
    drawTabs(); body.replaceChildren(); resultsBox = null; searchInput = null;
    if (state.tab === 'friends') {
      if (!state.friends.length) { body.append(pfEmpty('empty-friends', 'No friends yet', 'Search for a username to send your first request.', 'Find players', () => { state.tab = 'find'; draw(); })); return; }
      const list = uiEl('div', 'fd-list');
      for (const friend of state.friends) list.append(fdRow(friend, (actions) => {
        

if (messaging) {
  const message = uiEl('button', 'button button--primary', 'Message');
  message.type = 'button';
  message.addEventListener('click', () => {
    selectView('inbox');
    messaging?.openChat(friend);
  });
  actions.append(message);
}

        actions.append(act('Remove', 'button', async () => {
          if (!(await pfConfirm('Remove friend?', `${friend.displayName} will be removed from your friends. You can send a new request later.`, 'Remove'))) throw new Error('Cancelled.');
          await api(`/friends/remove/${encodeURIComponent(friend.username)}`, { method: 'DELETE' });
        }, 'Friend removed.'));
      }));
      body.append(list);
    } else if (state.tab === 'requests') {
      if (!state.incoming.length && !state.outgoing.length) { body.append(pfEmpty('empty-notifications', 'No pending requests', 'New friend requests will show up here.')); return; }
      if (state.incoming.length) {
        body.append(uiEl('h3', 'fd-subhead', `Received (${state.incoming.length})`));
        const list = uiEl('div', 'fd-list');
        for (const item of state.incoming) list.append(fdRow(item.user, (actions) => actions.append(
          act('Accept', 'button button--primary', () => api(`/friends/${item.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'accept' }) }), 'Friend added.'),
          act('Decline', 'button', () => api(`/friends/${item.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'reject' }) }), 'Request declined.'))));
        body.append(list);
      }
      if (state.outgoing.length) {
        body.append(uiEl('h3', 'fd-subhead', `Sent (${state.outgoing.length})`));
        const list = uiEl('div', 'fd-list');
        for (const item of state.outgoing) list.append(fdRow(item.user, (actions) => actions.append(act('Cancel', 'button', () => api(`/friends/${item.id}`, { method: 'DELETE' }), 'Request cancelled.'))));
        body.append(list);
      }
    } else {
      const form = uiEl('div', 'fd-search'); searchInput = document.createElement('input');
      searchInput.type = 'search'; searchInput.placeholder = 'Search by username'; searchInput.autocomplete = 'off'; searchInput.maxLength = 24; searchInput.setAttribute('aria-label', 'Search players by username');
      let timer; searchInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 300); });
      form.append(searchInput); resultsBox = uiEl('div', 'fd-results'); body.append(form, resultsBox); void runSearch(); searchInput.focus();
    }
  };
  async function refresh() { await load(); if (state.tab === 'find') { drawTabs(); await runSearch(); } else draw(); }

  body.append(uiEl('p', 'pf-loading', 'Loading…'));
  try {
    await load();
    if (!state.friends.length) state.tab = state.incoming.length ? 'requests' : 'find';
    draw();
  } catch (e) { body.replaceChildren(pfEmpty('empty-posts', 'Friends unavailable', e.message || 'Could not load your friends.')); }
}

async function renderProfile(username = currentUser?.username, initialTab = 'posts') {
  shownProfile = username;
  const host = $('#view-profile'); if (!host) return;
  host.replaceChildren();
  host.append(uiEl('h1', 'sr-only', username ? 'Player profile' : 'Profile'));
  const page = uiEl('div', 'pf-page'); host.append(page);
  const card = uiEl('section', 'pf-card'); page.append(card);
  if (!username) {
    card.append(pfEmpty('empty-friends', 'Make it yours', 'Sign in to set up your profile, pick your games and join the circle.', 'Sign in', () => openAuth()));
    return;
  }
  card.append(uiEl('p', 'pf-loading', 'Loading profile…'));
  try {
    const data = await api(`/auth/profiles/${encodeURIComponent(username)}`);
    const user = data.user;
     const profileUsername = user.username;
    card.replaceChildren();
    const display = user.displayName || user.username;
    const isSelf = currentUser?.username === user.username;
    const games = (user.favoriteGames || []).map(pfGameName);

    const cover = uiEl('div', 'pf-cover'); cover.style.backgroundImage = `url(${pfCover(user.username)})`;
    if (isSelf) { const editCover = uiEl('button', 'pf-cover-edit', user.banner ? 'Change cover' : 'Add cover'); editCover.type = 'button'; editCover.addEventListener('click', () => openEditProfile(user)); cover.append(editCover); }
    const bannerGame = games[0];

if (user.banner && /^https:\/\//i.test(user.banner)) {
  cover.style.backgroundImage = `url("${user.banner}")`;
  cover.classList.add('has-banner');
} else if (bannerGame) {
  const gameInfo = getArcadiaGame(bannerGame);

  if (gameInfo.banner) {
    const probe = new Image();

    probe.onload = () => {
      cover.style.backgroundImage = `url("${probe.src}")`;
    };

    probe.src = `/assets/arcadia/games/${gameInfo.banner}`;
  }
}
    const head = uiEl('div', 'pf-head');
    const avatar = uiEl('div', 'pf-avatar', display[0].toUpperCase()); setAvatar(avatar, user.avatar || 'gradient-violet', display[0].toUpperCase()); avatar.setAttribute('aria-hidden', 'true');
    const ident = uiEl('div', 'pf-id'); ident.append(uiEl('h2', 'pf-name', display), uiEl('p', 'pf-handle', `@${user.username}`));
    const actions = uiEl('div', 'pf-actions');
    let followSlot = null;
    if (isSelf) {
      const edit = uiEl('button', 'button button--primary', 'Edit profile'); edit.type = 'button'; edit.addEventListener('click', () => openEditProfile(user));
      const settings = uiEl('button', 'button', 'Settings'); settings.type = 'button'; settings.addEventListener('click', () => renderSettings(host));
      actions.append(edit, settings);
      const chat = uiEl('button', 'button', 'Chat');
      chat.type = 'button';
      chat.addEventListener('click', () => selectView('inbox'));
      actions.append(chat);
    } else {
      // Follow is the main action; friends, chat and the ⋯ menu sit beside it.
      followSlot = uiEl('div', 'pf-slot');
      const friendSlot = uiEl('div', 'pf-slot');
      void pfFriendActions(friendSlot, user);
      actions.append(followSlot, friendSlot, pfMoreMenu(user));
    }
    head.append(avatar, ident, actions);

    const bio = uiEl('p', 'pf-bio', user.bio || (isSelf ? 'Add a short bio so people know who you are.' : 'No bio yet.'));
    if (!user.bio) bio.classList.add('is-empty');
    const chips = uiEl('div', 'pf-chips');
    const joined = new Date(user.createdAt);
    if (!Number.isNaN(joined.getTime())) chips.append(uiEl('span', 'pf-chip', `Joined ${joined.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`));
    if (games.length) chips.append(uiEl('span', 'pf-chip', `${games.length} favorite ${games.length === 1 ? 'game' : 'games'}`));

    const tabs = uiEl('div', 'pf-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Profile sections');
    const panels = uiEl('div', 'pf-panels');
    const defs = [['posts', 'Posts'], ['reposts', 'Reposts'], ['communities', 'Communities'], ['about', 'About']];
    let repostsLoaded = false;
    const tabButtons = []; const panelNodes = {};
    const select = (key) => {
      for (const button of tabButtons) { const on = button.dataset.key === key; button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1; }
      for (const [name, panel] of Object.entries(panelNodes)) panel.hidden = name !== key;
      if (key === 'reposts' && !repostsLoaded) { repostsLoaded = true; void loadProfileReposts(user.username, repostList, display, isSelf); }
    };
    defs.forEach(([key, label]) => {
      const tab = uiEl('button', 'pf-tab', label); tab.type = 'button'; tab.id = `pf-tab-${key}`; tab.dataset.key = key;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `pf-panel-${key}`);
      tab.addEventListener('click', () => select(key));
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const next = tabButtons[(tabButtons.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length];
        select(next.dataset.key); next.focus();
      });
      tabButtons.push(tab); tabs.append(tab);
      const panel = uiEl('div', 'pf-panel'); panel.id = `pf-panel-${key}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
      panelNodes[key] = panel; panels.append(panel);
    });

    const list = uiEl('div', 'post-list pf-posts'); panelNodes.posts.append(list);
    const repostList = uiEl('div', 'post-list pf-posts'); panelNodes.reposts.append(repostList);
    
    const about = uiEl('div', 'pf-ab');

    // Bio + basic facts
    const bioSection = uiEl('section', 'pf-ab-section');
    const bioHead = uiEl('div', 'pf-ab-head');
    bioHead.append(uiEl('h3', 'pf-ab-title', 'About'));
    bioSection.append(bioHead);
    bioSection.append(uiEl(
      'p',
      `pf-ab-bio${user.bio ? '' : ' is-empty'}`,
      user.bio || (isSelf ? 'You haven’t written a bio yet.' : `${display} hasn’t written a bio yet.`)
    ));
    if (isSelf && !user.bio) {
      const addBio = uiEl('button', 'pf-ab-link', 'Add a bio');
      addBio.type = 'button';
      addBio.addEventListener('click', () => openEditProfile(user));
      bioSection.append(addBio);
    }

    const facts = uiEl('dl', 'pf-ab-facts');
    const addFact = (label, value) => {
      const row = uiEl('div', 'pf-ab-fact');
      row.append(uiEl('dt', '', label), uiEl('dd', '', value));
      facts.append(row);
    };
    addFact('Username', `@${user.username}`);
    const memberSince = new Date(user.createdAt);
    if (!Number.isNaN(memberSince.getTime())) {
      addFact('Member since', memberSince.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    }
    if (games.length) addFact('Favourite games', String(games.length));
    bioSection.append(facts);
    about.append(bioSection);

    // Favourite games: a plain row of covers, each opens the game page
    if (games.length) {
      const gamesSection = uiEl('section', 'pf-ab-section');
      const gamesHead = uiEl('div', 'pf-ab-head');
      gamesHead.append(uiEl('h3', 'pf-ab-title', 'Favourite games'));
      const seeAll = uiEl('button', 'pf-ab-link', games.length > 6 ? `See all ${games.length}` : 'Open collection');
      seeAll.type = 'button';
      seeAll.addEventListener('click', () => { void openGameLibrary(games, profileUsername); });
      gamesHead.append(seeAll);
      gamesSection.append(gamesHead);

      const row = uiEl('div', 'pf-ab-games');
      for (const name of games.slice(0, 6)) {
        const info = getArcadiaGame(name);
        const item = uiEl('button', 'pf-ab-game');
        item.type = 'button';
        const cover = uiEl('img', 'pf-ab-game-cover');
        cover.src = arcGameCoverSrc(info);
        cover.alt = '';
        cover.loading = 'lazy';
        cover.decoding = 'async';
        item.append(cover, uiEl('span', 'pf-ab-game-name', info.title));
        item.addEventListener('click', () => { openGameDetails(info, games, profileUsername); });
        row.append(item);
      }
      gamesSection.append(row);
      about.append(gamesSection);
    }

    panelNodes.about.append(about);
    void communitiesPage.renderProfileSection(panelNodes.communities, profileUsername, isSelf);

    const statsRow = uiEl('div', 'pf-stats');
    void social.renderProfileSocial(user, { followSlot, statsHost: statsRow, isSelf });
    card.append(cover, head, bio, statsRow, chips, tabs, panels);
    select(initialTab);
    void loadProfilePosts(user.username, list);
  } catch (e) {
    card.replaceChildren(pfEmpty('empty-posts', 'Profile unavailable', e.message || 'Could not load this profile.'));
  }
}

function arcGameCoverSrc(info) {
  return info.cover ? `/assets/arcadia/games/${info.cover}` : pfCover(info.title);
}

function arcGameTheme(info) {
  const themeKey = String(info.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const themeAliases = { 'ea sports fc mobile': 'fc mobile', 'grand theft auto v': 'gta v' };
  return ARCADIA_GAME_THEMES[themeAliases[themeKey] || themeKey] || {
    accent: '#A78BFA',
    background: '#1D1B26'
  };
}

/*
  Reusable detail page (styles: .gd in css/arcadia-clean.css).
  Order: back, hero, title, kicker, description, facts.
  Use it for any "one item" page, for example a community or an update:

    host.replaceChildren(arcDetailPage({
      title, kicker, description,
      facts: [['Members', '1.2k'], ['Created', 'May 2025']],
      banner, poster, accent, heroColor,
      backLabel: 'Back to communities',
      onBack: () => { ... }
    }));
*/
function arcDetailPage({
  title,
  kicker = '',
  description = '',
  facts = [],
  banner = '',
  poster = '',
  accent = '',
  heroColor = '',
  titleFont = '',
  backLabel = 'Back',
  actions = [],
  extra = null,
  onBack
}) {
  const page = uiEl('article', 'gd');
  if (accent) page.style.setProperty('--gd-accent', accent);
  if (heroColor) page.style.setProperty('--gd-hero', heroColor);
  if (titleFont) page.style.setProperty('--gd-title-font', titleFont);

  const back = uiEl('button', 'gd-back');
  back.type = 'button';
  back.innerHTML = BACK_ICON; back.append(uiEl('span', '', backLabel));
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });

  const card = uiEl('div', 'gd-card');

  const hero = uiEl('div', 'gd-hero');
  hero.setAttribute('aria-hidden', 'true');
  const showPoster = () => {
    if (!poster || hero.querySelector('.gd-poster')) return;
    const img = uiEl('img', 'gd-poster');
    img.src = poster;
    img.alt = '';
    hero.append(img);
  };
  if (banner) {
    const probe = new Image();
    probe.onload = () => { hero.style.backgroundImage = `url("${banner}")`; };
    probe.onerror = showPoster;
    probe.src = banner;
  } else {
    showPoster();
  }

  const body = uiEl('div', 'gd-body');
  body.append(uiEl('h1', 'gd-title', title));
  if (kicker) body.append(uiEl('p', 'gd-kicker', kicker));
  if (description) body.append(uiEl('p', 'gd-desc', description));

  // Optional buttons (for example "Add to my games") sit under the write-up.
  if (actions.length) {
    const row = uiEl('div', 'gd-actions');
    row.append(...actions);
    body.append(row);
  }

  const shownFacts = facts.filter(([, value]) => value);
  if (shownFacts.length) {
    const list = uiEl('dl', 'gd-facts');
    for (const [label, value] of shownFacts) {
      const item = uiEl('div', 'gd-fact');
      item.append(uiEl('dt', '', label), uiEl('dd', '', value));
      list.append(item);
    }
    body.append(list);
  }

  // Optional extra section (for example the communities for a game).
  if (extra) {
    const wrap = uiEl('div', 'gd-extra');
    wrap.append(extra);
    body.append(wrap);
  }

  card.append(hero, body);
  page.append(back, card);
  return page;
}

async function openGameLibrary(games = [], username = currentUser?.username) {
  const host = $('#view-profile');
  if (!host) return;

  const page = uiEl('section', 'gc');

  const top = uiEl('div', 'gc-top');
  const back = uiEl('button', 'gc-back');
  back.innerHTML = BACK_ICON;
  back.type = 'button';
  back.setAttribute('aria-label', 'Back to profile');
  back.title = 'Back to profile';
  back.addEventListener('click', () => { void renderProfile(username, 'about'); });

  const heading = uiEl('div', 'gc-heading');
  heading.append(
    uiEl('h1', 'gc-title', 'Game collection'),
    uiEl('p', 'gc-count', `${games.length} ${games.length === 1 ? 'game' : 'games'}`)
  );
  top.append(back, heading);

  const grid = uiEl('div', 'gc-grid');
  if (games.length === 0) {
    grid.append(uiEl('div', 'gc-empty', 'No favourite games added yet.'));
  }

  for (const game of games) {
    const info = getArcadiaGame(game);
    const item = uiEl('button', 'gc-item');
    item.type = 'button';

    const image = uiEl('img', 'gc-cover');
    image.src = arcGameCoverSrc(info);
    image.alt = '';
    image.loading = 'lazy';

    const meta = uiEl('span', 'gc-meta');
    meta.append(uiEl('span', 'gc-name', info.title), uiEl('span', 'gc-genre', info.genre));

    item.append(image, meta);
    item.addEventListener('click', () => { openGameDetails(info, games, username); });
    grid.append(item);
  }

  page.append(top, grid);
  host.replaceChildren(page);
  window.scrollTo({ top: 0 });
}

function openGameDetails(info, games = [], username = currentUser?.username) {
  const host = $('#view-profile');
  if (!host) return;

  const theme = arcGameTheme(info);

  host.replaceChildren(arcDetailPage({
    title: info.title,
    kicker: info.genre,
    description: info.description,
    facts: [
      ['Developer', info.developer],
      ['Platforms', info.platforms]
    ],
    banner: info.banner ? `/assets/arcadia/games/${info.banner}` : '',
    poster: info.cover ? `/assets/arcadia/games/${info.cover}` : '',
    accent: theme.accent,
    heroColor: theme.background,
    titleFont: getArcadiaGameFont(info.title),
    backLabel: 'Back to collection',
    onBack: () => { void openGameLibrary(games, username); }
  }));
  window.scrollTo({ top: 0 });
}

// The Reposts tab: public posts this player reposted, newest repost first.
async function loadProfileReposts(username, host, display, isSelf, cursor = null) {
  host.querySelector('.pf-more')?.remove();
  try {
    const data = await api(`/auth/profiles/${encodeURIComponent(username)}/reposts?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!cursor && !data.items.length && !data.nextCursor) {
      host.append(pfEmpty('empty-posts', 'No reposts yet', isSelf ? 'Tap the repost button on a post you like and it will show up here.' : `${display} hasn’t reposted anything yet.`));
      return;
    }
    for (const item of data.items) {
      const node = renderPost(item);
      const label = uiEl('p', 'repost-label', `↻ ${isSelf ? 'You' : display} reposted`);
      const when = new Date(item.repostedAt);
      if (!Number.isNaN(when.getTime())) label.append(` · ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
      node.prepend(label);
      host.append(node);
    }
    if (data.nextCursor) {
      const more = uiEl('button', 'button pf-more', 'Show more'); more.type = 'button';
      more.addEventListener('click', () => { more.disabled = true; void loadProfileReposts(username, host, display, isSelf, data.nextCursor); });
      host.append(more);
    }
  } catch (error) {
    host.append(pfEmpty('empty-posts', 'Reposts unavailable', error.message || 'Could not load reposts.'));
  }
}

async function loadProfilePosts(username,host,cursor=null){try{const data=await api(`/auth/profiles/${encodeURIComponent(username)}/posts?limit=10${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);host.append(...data.items.map(renderPost));if(!data.items.length&&!cursor){const note=document.createElement('p');note.className='catalog-message';note.textContent='No public posts yet.';host.append(note);}if(data.nextCursor){let more=$('.profile-load-more',host);if(!more){more=document.createElement('button');more.className='button profile-load-more';more.type='button';more.textContent='Load more posts';host.append(more);}more.onclick=()=>{more.disabled=true;more.remove();void loadProfilePosts(username,host,data.nextCursor);};}}catch(error){const note=document.createElement('p');note.textContent=error.message;host.append(note);}}

function openEditProfile(user) {
  const dialog = document.createElement('dialog'); dialog.className = 'sheet'; dialog.setAttribute('aria-labelledby', 'edit-profile-title');
  const form = document.createElement('form'); form.noValidate = false;
  const head = uiEl('div', 'sheet-head'); head.append(uiEl('h2', '', 'Edit profile')); head.firstChild.id = 'edit-profile-title';
  const close = uiEl('button', 'icon-button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.addEventListener('click', () => dialog.close()); head.append(close);

  const body = uiEl('div', 'sheet-body');
  const nameField = uiEl('div', 'field'); const nameLabel = uiEl('label', '', 'Display name'); nameLabel.htmlFor = 'edit-display-name';
  const name = document.createElement('input'); name.id = 'edit-display-name'; name.maxLength = 40; name.value = user.displayName || ''; name.placeholder = user.username; name.autocomplete = 'nickname';
  const nameCount = uiEl('div', 'field-count'); nameField.append(nameLabel, name, nameCount);
  const bioField = uiEl('div', 'field'); const bioLabel = uiEl('label', '', 'Bio'); bioLabel.htmlFor = 'edit-bio';
  const bio = document.createElement('textarea'); bio.id = 'edit-bio'; bio.maxLength = 280; bio.value = user.bio || ''; bio.placeholder = 'What do you play, and who do you play with?';
  const bioCount = uiEl('div', 'field-count'); bioField.append(bioLabel, bio, bioCount);
  const count = () => { nameCount.textContent = `${name.value.length} / 40`; bioCount.textContent = `${bio.value.length} / 280`; };
  name.addEventListener('input', count); bio.addEventListener('input', count); count();

  const gamesRow = uiEl('div', 'st-row'); gamesRow.style.borderTop = '0'; gamesRow.style.padding = '0';
  const gamesText = uiEl('div', 'st-text'); gamesText.append(uiEl('div', 'st-label', 'Favorite games'), uiEl('p', 'st-desc', (user.favoriteGames || []).map(pfGameName).join(', ') || 'Not picked yet'));
  const change = uiEl('button', 'button', 'Change'); change.type = 'button'; change.addEventListener('click', (event) => { dialog.close(); startOnboarding(event); });
  gamesRow.append(gamesText, change);

  // Profile photo: upload, replace or remove. Saved straight away.
  const photoField = uiEl('div', 'field avatar-edit');
  const initial = (user.displayName || user.username || '?')[0].toUpperCase();
  const photoPreview = uiEl('div', 'pf-avatar avatar-edit__preview', initial);
  setAvatar(photoPreview, user.avatar || 'gradient-violet', initial);
  photoPreview.setAttribute('aria-hidden', 'true');
  const photoText = uiEl('div', 'avatar-edit__text');
  const photoButtons = uiEl('div', 'avatar-edit__buttons');
  const photoFile = document.createElement('input'); photoFile.type = 'file'; photoFile.accept = 'image/jpeg,image/png,image/webp,image/gif'; photoFile.hidden = true;
  const choosePhoto = uiEl('button', 'button', isPhotoAvatar(user.avatar) ? 'Change photo' : 'Upload photo'); choosePhoto.type = 'button';
  const removePhoto = uiEl('button', 'button', 'Remove photo'); removePhoto.type = 'button'; removePhoto.hidden = !isPhotoAvatar(user.avatar);
  const photoStatus = uiEl('p', 'avatar-edit__status', 'JPEG, PNG, WebP or GIF. We crop it to a square.'); photoStatus.setAttribute('role', 'status');
  photoButtons.append(choosePhoto, removePhoto);
  photoText.append(uiEl('label', 'st-label', 'Profile photo'), photoButtons, photoStatus);
  photoField.append(photoPreview, photoText, photoFile);
  let photoChanged = false;
  const setPhotoState = (avatarValue) => {
    currentUser = { ...currentUser, avatar: avatarValue };
    setAvatar(photoPreview, avatarValue || 'gradient-violet', initial);
    choosePhoto.textContent = isPhotoAvatar(avatarValue) ? 'Change photo' : 'Upload photo';
    removePhoto.hidden = !isPhotoAvatar(avatarValue);
    updateSignedInUI();
    photoChanged = true;
  };
  const photoMessage = (text, isError = false) => { photoStatus.textContent = text; photoStatus.classList.toggle('is-error', isError); };
  choosePhoto.addEventListener('click', () => photoFile.click());
  photoFile.addEventListener('change', async () => {
    const file = photoFile.files?.[0];
    photoFile.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { photoMessage('Choose a JPEG, PNG, WebP or GIF image.', true); return; }
    choosePhoto.disabled = removePhoto.disabled = true;
    photoMessage('Uploading…');
    try {
      const prepared = await prepareAvatarFile(file);
      const formData = new FormData(); formData.append('photo', prepared);
      const result = await api('/auth/avatar', { method: 'POST', body: formData });
      setPhotoState(result.user.avatar);
      photoMessage('Photo updated.');
    } catch (e) { photoMessage(e.message || 'Could not upload that photo.', true); }
    finally { choosePhoto.disabled = removePhoto.disabled = false; }
  });
  removePhoto.addEventListener('click', async () => {
    choosePhoto.disabled = removePhoto.disabled = true;
    photoMessage('Removing…');
    try {
      const result = await api('/auth/profile', { method: 'PATCH', body: JSON.stringify({ avatar: 'gradient-violet' }) });
      setPhotoState(result.user.avatar || 'gradient-violet');
      photoMessage('Photo removed.');
    } catch (e) { photoMessage(e.message || 'Could not remove the photo.', true); }
    finally { choosePhoto.disabled = removePhoto.disabled = false; }
  });
  // Cover banner: upload, replace or remove. Saved straight away, like the photo.
  const bannerField = uiEl('div', 'field banner-edit');
  const bannerPreview = uiEl('div', 'banner-edit__preview'); bannerPreview.setAttribute('aria-hidden', 'true');
  const paintBanner = (url) => { bannerPreview.style.backgroundImage = `url("${url && /^https:\/\//i.test(url) ? url : pfCover(user.username)}")`; bannerPreview.classList.toggle('has-banner', Boolean(url)); };
  paintBanner(user.banner);
  const bannerButtons = uiEl('div', 'avatar-edit__buttons');
  const bannerFile = document.createElement('input'); bannerFile.type = 'file'; bannerFile.accept = 'image/jpeg,image/png,image/webp,image/gif'; bannerFile.hidden = true;
  const chooseBanner = uiEl('button', 'button', user.banner ? 'Change cover' : 'Upload cover'); chooseBanner.type = 'button';
  const removeBanner = uiEl('button', 'button', 'Remove cover'); removeBanner.type = 'button'; removeBanner.hidden = !user.banner;
  const bannerStatus = uiEl('p', 'avatar-edit__status', 'Wide images work best. We crop it to fit.'); bannerStatus.setAttribute('role', 'status');
  bannerButtons.append(chooseBanner, removeBanner);
  bannerField.append(uiEl('label', 'st-label', 'Cover banner'), bannerPreview, bannerButtons, bannerStatus, bannerFile);
  const setBannerState = (url) => {
    currentUser = { ...currentUser, banner: url || null }; user.banner = url || null;
    paintBanner(url); chooseBanner.textContent = url ? 'Change cover' : 'Upload cover'; removeBanner.hidden = !url; photoChanged = true;
  };
  const bannerMessage = (text, isError = false) => { bannerStatus.textContent = text; bannerStatus.classList.toggle('is-error', isError); };
  chooseBanner.addEventListener('click', () => bannerFile.click());
  bannerFile.addEventListener('change', async () => {
    const file = bannerFile.files?.[0]; bannerFile.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { bannerMessage('Choose a JPEG, PNG, WebP or GIF image.', true); return; }
    chooseBanner.disabled = removeBanner.disabled = true; bannerMessage('Uploading…');
    try {
      const prepared = await prepareBannerFile(file);
      const formData = new FormData(); formData.append('photo', prepared);
      const result = await api('/auth/banner', { method: 'POST', body: formData });
      setBannerState(result.user.banner); bannerMessage('Cover updated.');
    } catch (e) { bannerMessage(e.message || 'Could not upload that cover.', true); }
    finally { chooseBanner.disabled = removeBanner.disabled = false; }
  });
  removeBanner.addEventListener('click', async () => {
    chooseBanner.disabled = removeBanner.disabled = true; bannerMessage('Removing…');
    try { await api('/auth/profile', { method: 'PATCH', body: JSON.stringify({ banner: null }) }); setBannerState(null); bannerMessage('Cover removed.'); }
    catch (e) { bannerMessage(e.message || 'Could not remove the cover.', true); }
    finally { chooseBanner.disabled = removeBanner.disabled = false; }
  });
  body.append(bannerField, photoField, nameField, bioField, gamesRow);

  const foot = uiEl('div', 'sheet-foot');
  const cancel = uiEl('button', 'button', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const save = uiEl('button', 'button button--primary', 'Save profile'); save.type = 'submit'; foot.append(cancel, save);
  form.append(head, body, foot); dialog.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      await api('/auth/profile', { method: 'PATCH', body: JSON.stringify({ displayName: name.value.trim(), bio: bio.value.trim() }) });
      dialog.close(); await renderProfile(); toast('Profile saved.');
    } catch (e) { toast(e.message); save.disabled = false; }
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (photoChanged) void renderProfile(); });
  document.body.append(dialog); dialog.showModal(); name.focus();
}

// Crop to the banner shape (8:3) in the browser so uploads stay small and look right.
async function prepareBannerFile(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('That image could not be read. Try another one.'); }
  const width = Math.min(1600, bitmap.width);
  const height = Math.round(width * 3 / 8);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ratio = 8 / 3;
  let sw = bitmap.width; let sh = Math.round(sw / ratio);
  if (sh > bitmap.height) { sh = bitmap.height; sw = Math.round(sh * ratio); }
  const sx = Math.round((bitmap.width - sw) / 2); const sy = Math.round((bitmap.height - sh) / 2);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height); bitmap.close?.();
  const toBlob = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
  let type = 'image/webp'; let quality = 0.86; let blob = await toBlob(type, quality);
  if (!blob || blob.type !== 'image/webp') { type = 'image/jpeg'; blob = await toBlob(type, quality); }
  while (blob && blob.size > 700 * 1024 && quality > 0.5) { quality -= 0.08; blob = await toBlob(type, quality); }
  if (!blob || blob.size > 4 * 1024 * 1024) throw new Error('That image is too large to use as a cover.');
  return new File([blob], `banner.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type });
}

function stCard(title) { const card = uiEl('section', 'st-card'); if (title) card.append(uiEl('h2', '', title)); return card; }
function stRow(label, description, control) {
  const row = uiEl('div', 'st-row'); const text = uiEl('div', 'st-text');
  text.append(uiEl('div', 'st-label', label)); if (description) text.append(uiEl('p', 'st-desc', description));
  row.append(text); if (control) row.append(control); return row;
}
function stSwitch(name, checked, label) {
  const wrap = uiEl('label', 'switch'); const input = document.createElement('input');
  input.type = 'checkbox'; input.name = name; input.checked = checked; input.setAttribute('role', 'switch'); input.setAttribute('aria-label', label);
  wrap.append(input); return wrap;
}
function stSelect(name, options, value, label) {
  const select = uiEl('select', 'st-select'); select.name = name; select.setAttribute('aria-label', label);
  for (const [optionValue, optionLabel] of options) { const option = document.createElement('option'); option.value = optionValue; option.textContent = optionLabel; select.append(option); }
  select.value = value; return select;
}

async function renderSettings(host) {
  if (!currentUser) { void renderProfile(); return; }
  host.replaceChildren();
  const page = uiEl('div', 'pf-page st-page'); host.append(page);
  const top = uiEl('div', 'st-top');
  const back = uiEl('button', 'st-back'); back.type = 'button';
  back.innerHTML = BACK_ICON; back.append('Profile');
  back.addEventListener('click', () => renderProfile());
  top.append(back, uiEl('h1', 'st-heading', 'Settings')); page.append(top);

  const account = stCard('Account');
  const signout = uiEl('button', 'button', 'Sign out'); signout.type = 'button'; signout.addEventListener('click', () => $('#auth-open').click());
  account.append(stRow('Username', `@${currentUser.username}`), stRow('Display name', currentUser.displayName || 'Not set'), stRow('Session', 'Sign out of Arcadia on this device.', signout));
  page.append(account);

  const appearance = stCard('Appearance');
  const seg = uiEl('div', 'st-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Color theme');
  for (const [value, label] of [['light', 'Light'], ['dark', 'Dark']]) {
    const button = uiEl('button', '', label); button.type = 'button'; button.dataset.mode = value;
    button.setAttribute('aria-pressed', String((document.documentElement.dataset.theme || 'light') === value));
    button.addEventListener('click', () => {
      applyTheme(value);
      for (const other of seg.children) other.setAttribute('aria-pressed', String(other.dataset.mode === value));
      toast(`${value === 'dark' ? 'Dark' : 'Light'} mode enabled.`);
    });
    seg.append(button);
  }
  const interests = uiEl('button', 'button', 'Update'); interests.type = 'button'; interests.addEventListener('click', startOnboarding);
  appearance.append(stRow('Theme', 'Choose the look that feels right on your screen.', seg), stRow('Gaming interests', 'Pick the games and genres that shape your feed.', interests));
  page.append(appearance);

  const muted = stCard('Muted players');
  const mutedList = uiEl('div', 'st-muted');
  muted.append(uiEl('p', 'st-desc', 'Posts from muted players stay out of your feed. Mute someone from the ⋯ menu on any post.'), mutedList);
  page.append(muted);
  const blockedCard = stCard('Blocked players');
  const blockedList = uiEl('div', 'st-muted');
  blockedCard.append(uiEl('p', 'st-desc', 'Blocked players can’t see your posts, message you or send friend requests, and you won’t see theirs. They aren’t told.'), blockedList);
  page.append(blockedCard);
  const fontCard = stCard('Fonts');
  const fontHost = uiEl('div', 'fp-host');
  fontCard.append(fontHost);
  page.append(fontCard);
  renderFontPicker(fontHost, { user: currentUser, toast: (message) => toast(message) });
  void safety.renderBlockedList(blockedList);
  void (async () => {
    try {
      const data = await api('/posts/hidden/authors');
      if (!data.items.length) { mutedList.append(uiEl('p', 'st-desc', 'You haven’t muted anyone.')); return; }
      for (const person of data.items) {
        const row = uiEl('div', 'st-row');
        row.append(uiEl('div', 'st-label', `${person.displayName || person.username} (@${person.username})`));
        const unmute = uiEl('button', 'button', 'Unmute'); unmute.type = 'button';
        unmute.addEventListener('click', async () => {
          unmute.disabled = true;
          try { await api(`/posts/hidden/author/${person._id}`, { method: 'DELETE' }); row.remove(); toast(`Unmuted @${person.username}.`); }
          catch (error) { toast(error.message); unmute.disabled = false; }
        });
        row.append(unmute); mutedList.append(row);
      }
    } catch { mutedList.append(uiEl('p', 'st-desc', 'Could not load your muted players.')); }
  })();

  const loaded = await api('/auth/settings').catch(() => ({ settings: { notificationPreferences: {}, privacy: {} } }));
  const prefs = loaded.settings?.notificationPreferences || {}; const privacy = loaded.settings?.privacy || {};
  const form = document.createElement('form');
  const notifications = stCard('Notifications');
  notifications.append(
    stRow('Comments and replies', 'When someone responds to your posts.', stSwitch('comments', prefs.comments !== false, 'Comments and replies')),
    stRow('Reactions and reposts', 'When someone likes or reposts what you share.', stSwitch('reactions', prefs.reactions !== false, 'Reactions and reposts')),
    stRow('Community activity', 'News from the groups you have joined.', stSwitch('communities', prefs.communities !== false, 'Community activity'))
  );
  const privacyCard = stCard('Privacy');
  privacyCard.append(
    stRow('Profile visibility', 'Who can see your profile and posts.', stSelect('profileVisibility', [['public', 'Public'], ['private', 'Private']], privacy.profileVisibility || 'public', 'Profile visibility')),
    stRow('Friend requests', 'Who can send you friend requests.', stSelect('friendRequests', [['everyone', 'Everyone'], ['nobody', 'Nobody']], privacy.friendRequests || 'everyone', 'Friend requests')),
    stRow('Followers and following', 'Who can open your followers and following lists. Your counts stay visible.', stSelect('followLists', [['everyone', 'Everyone'], ['nobody', 'Only me']], privacy.followLists || 'everyone', 'Followers and following'))
  );
  const saveBar = uiEl('div', 'st-save'); const savePrefs = uiEl('button', 'button button--primary', 'Save preferences'); savePrefs.type = 'submit'; saveBar.append(savePrefs);
  form.append(notifications, privacyCard, saveBar);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const values = new FormData(form); savePrefs.disabled = true;
    try {
      await api('/auth/settings', { method: 'PATCH', body: JSON.stringify({ notificationPreferences: { comments: values.has('comments'), reactions: values.has('reactions'), communities: values.has('communities') }, privacy: { profileVisibility: values.get('profileVisibility'), friendRequests: values.get('friendRequests'), followLists: values.get('followLists') || 'everyone' } }) });
      toast('Settings saved.');
    } catch (e) { toast(e.message); } finally { savePrefs.disabled = false; }
  });
  page.append(form);

    const security = stCard('Password');

  const passwordToggle = uiEl('button', 'button', 'Change Password');
  passwordToggle.type = 'button';
  passwordToggle.setAttribute('aria-expanded', 'false');

  const passwordForm = document.createElement('form');
  passwordForm.hidden = true;

  const fields = uiEl('div', 'st-fields');

  const makeField = (id, labelText, name, autocomplete, extra = {}) => {
    const field = uiEl('div', 'field');
    const label = uiEl('label', '', labelText);
    label.htmlFor = id;

    const input = document.createElement('input');
    input.id = id;
    input.name = name;
    input.type = 'password';
    input.autocomplete = autocomplete;
    input.required = true;
    Object.assign(input, extra);

    field.append(label, input);
    return field;
  };

  fields.append(
    makeField('pw-current', 'Current password', 'currentPassword', 'current-password'),
    makeField('pw-new', 'New password', 'newPassword', 'new-password', {
      minLength: 10,
      maxLength: 128,
      placeholder: 'At least 10 characters'
    })
  );

  const actions = uiEl('div', 'st-actions');

  const change = uiEl('button', 'button button--primary', 'Update Password');
  change.type = 'submit';

  const cancel = uiEl('button', 'button', 'Cancel');
  cancel.type = 'button';

  actions.append(change, cancel);
  fields.append(actions);
  passwordForm.append(fields);

  passwordToggle.addEventListener('click', () => {
    passwordForm.hidden = false;
    passwordToggle.hidden = true;
    passwordToggle.setAttribute('aria-expanded', 'true');
    passwordForm.querySelector('#pw-current').focus();
  });

  cancel.addEventListener('click', () => {
    passwordForm.reset();
    passwordForm.hidden = true;
    passwordToggle.hidden = false;
    passwordToggle.setAttribute('aria-expanded', 'false');
    passwordToggle.focus();
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!passwordForm.reportValidity()) return;

    const values = Object.fromEntries(new FormData(passwordForm));

    if (values.currentPassword === values.newPassword) {
      toast('Your new password must be different from your current password.');
      return;
    }

    change.disabled = true;
    cancel.disabled = true;

    try {
      await api('/auth/password', {
        method: 'POST',
        body: JSON.stringify(values)
      });

      passwordForm.reset();
      passwordForm.hidden = true;
      passwordToggle.hidden = false;
      passwordToggle.setAttribute('aria-expanded', 'false');

      toast('Password changed. Other sessions were signed out.');
      passwordToggle.focus();
    } catch (e) {
      toast(e.message);
    } finally {
      change.disabled = false;
      cancel.disabled = false;
    }
  });

  security.append(passwordToggle, passwordForm);
  page.append(security);
}

// A post you just published goes straight to the top of your feed, no reload needed.
function showNewPost(post) {
  if (!post) { void loadFeed(); return; }
  const list = $('#post-list');
  if (!list || activeFeed === 'groups' || $('#view-feed')?.hidden) return;
  const node = renderFeedItem(post);
  node.classList.add('is-new');
  list.prepend(node);
  const state = $('#feed-state');
  if (state) state.hidden = true;
  node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function composePost() { composer.open(); }

$$('[data-action="compose"]').forEach((button) => button.setAttribute('aria-label', 'Write a post'));
restoreSession();
void showSiteBanner({ api: (path, options) => api(path, options) });
