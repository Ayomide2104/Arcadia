import { setAvatar } from './avatar.js';
import { io } from 'socket.io-client';

/*
  Arcadia messaging.
  Layout: a chat list on the left, the open conversation on the right
  (one pane at a time on phones). Same public API as before:
  init, connect, disconnect, openChat, openInbox, refreshConversations.
*/
export function createMessaging({ api, getCurrentUser, toast }) {
  let socket = null;
  let activeUsername = null;
  let activeFriend = null;
  let conversations = [];
  let initialized = false;
  let loading = false;
  let searchTerm = '';
  let lastRendered = null; // { mine, time, day } of the last message drawn

  const GROUP_WINDOW_MS = 5 * 60 * 1000;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const button = (label, className, action) => {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };

  const icon = (paths, size = 20) => `
    <svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true">
      ${paths}
    </svg>`;

  const ICON_BACK = icon('<path d="M15 18 9 12l6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', 22);
  const ICON_SEND = icon('<path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>', 20);
  const ICON_SEARCH = icon('<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.9"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>', 18);
  const ICON_CHAT = icon('<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.8-3.1A7.5 7.5 0 1 1 20 11.5Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>', 30);

  /* ---------- Structure ---------- */

  const overlay = element('div', 'arc-chat-overlay');
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');

  const windowNode = element('section', 'arc-chat-window');
  windowNode.setAttribute('role', 'dialog');
  windowNode.setAttribute('aria-modal', 'true');
  windowNode.setAttribute('aria-label', 'Messages');

  // Left column: title, search, conversation list
  const sidebar = element('aside', 'arc-chat-sidebar');
  const sidebarHead = element('header', 'arc-chat-sidebar-head');
  const heading = element('h2', 'arc-chat-heading', 'Chats');
  const closeButton = button('×', 'arc-chat-close', closeChat);
  closeButton.setAttribute('aria-label', 'Close messages');
  sidebarHead.append(heading, closeButton);

  const searchWrap = element('label', 'arc-chat-search');
  const searchIcon = element('span', 'arc-chat-search-icon');
  searchIcon.innerHTML = ICON_SEARCH;
  const searchInput = element('input', 'arc-chat-search-input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search chats';
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('aria-label', 'Search chats');
  searchWrap.append(searchIcon, searchInput);

  const conversationList = element('div', 'arc-chat-conversations');
  sidebar.append(sidebarHead, searchWrap, conversationList);

  // Right column: open conversation
  const panel = element('section', 'arc-chat-panel');

  const chatHeading = element('header', 'arc-chat-person');
  const backButton = button('', 'arc-chat-back', closeChat);
  backButton.innerHTML = ICON_BACK;
  backButton.setAttribute('aria-label', 'Back to chats');
  backButton.title = 'Back to chats';
  const chatAvatar = element('div', 'arc-chat-avatar', '?');
  const chatName = element('div', 'arc-chat-person-name', 'Choose a friend');
  const chatStatus = element('div', 'arc-chat-person-status', '');
  const personText = element('div', 'arc-chat-person-text');
  personText.append(chatName, chatStatus);
  chatHeading.append(backButton, chatAvatar, personText);

  const messages = element('div', 'arc-chat-messages');
  messages.setAttribute('role', 'log');
  messages.setAttribute('aria-live', 'polite');
  messages.setAttribute('aria-label', 'Conversation messages');

  const loadingState = element('div', 'arc-chat-loading', 'Loading conversation…');
  loadingState.hidden = true;

  const composer = element('form', 'arc-chat-composer');
  const input = element('textarea', 'arc-chat-input');
  input.name = 'content';
  input.rows = 1;
  input.maxLength = 2000;
  input.placeholder = 'Message';
  input.setAttribute('aria-label', 'Message');
  input.required = true;

  const sendButton = element('button', 'arc-chat-send');
  sendButton.type = 'submit';
  sendButton.innerHTML = ICON_SEND;
  sendButton.setAttribute('aria-label', 'Send message');
  sendButton.title = 'Send message';
  sendButton.disabled = true;

  const inputWrapper = element('div', 'arc-chat-input-wrapper');
  inputWrapper.append(input, sendButton);
  composer.append(inputWrapper);

  panel.append(chatHeading, messages, loadingState, composer);
  panel.hidden = true;

  // Shown on wide screens when no chat is open
  const emptyState = element('div', 'arc-chat-empty');
  const emptyIcon = element('div', 'arc-chat-empty-icon');
  emptyIcon.innerHTML = ICON_CHAT;
  emptyState.append(
    emptyIcon,
    element('h3', '', 'Your messages'),
    element('p', '', 'Pick a chat from the list to read and reply.')
  );

  windowNode.append(sidebar, panel, emptyState);
  overlay.append(windowNode);
  const inboxHost = document.querySelector('#inbox-app');
  (inboxHost || document.body).append(overlay);

  /* ---------- Helpers ---------- */

  function getUserIdentifier(user = getCurrentUser()) {
    return String(user?._id || user?.id || '');
  }

  function normalizeMessage(message) {
    const sender = message.sender?._id || message.sender?.id || message.sender;
    const senderId = String(sender || '');
    const currentId = getUserIdentifier();

    return {
      ...message,
      id: String(message.id || message._id || ''),
      isMine: Boolean(currentId && senderId === currentId)
    };
  }

  function validDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatClock(value) {
    const date = validDate(value);
    return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatDayLabel(date) {
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days > 1 && days < 7) return date.toLocaleDateString([], { weekday: 'long' });
    return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }

  // Short stamp for the chat list: time today, weekday this week, otherwise date
  function formatListStamp(value) {
    const date = validDate(value);
    if (!date) return '';
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
    if (days === 0) return formatClock(value);
    if (days === 1) return 'Yesterday';
    if (days > 1 && days < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function receiptText(read) {
    return read ? '✓✓' : '✓';
  }

  function scrollToLatest() {
    messages.scrollTop = messages.scrollHeight;
  }

  function setChatting(on) {
    windowNode.classList.toggle('is-chatting', Boolean(on));
  }

  function syncSendState() {
    sendButton.disabled = loading || !activeUsername || !input.value.trim();
  }

  /* ---------- Messages ---------- */

  function renderMessage(message) {
    const item = normalizeMessage(message);

    if (item.id && messages.querySelector(`[data-message-id="${CSS.escape(item.id)}"]`)) {
      return;
    }

    const created = validDate(item.createdAt);
    const key = created ? dayKey(created) : '';

    // Day divider when the date changes
    if (created && (!lastRendered || lastRendered.day !== key)) {
      const divider = element('div', 'arc-chat-day');
      divider.append(element('span', '', formatDayLabel(created)));
      messages.append(divider);
      lastRendered = null;
    }

    const grouped = Boolean(
      lastRendered
      && lastRendered.mine === item.isMine
      && created
      && created.getTime() - lastRendered.time < GROUP_WINDOW_MS
    );

    if (grouped && lastRendered.row) lastRendered.row.classList.add('has-next');

    const row = element(
      'div',
      `arc-chat-message-row ${item.isMine ? 'is-mine' : 'is-theirs'}${grouped ? ' is-grouped' : ''}`
    );
    if (item.id) row.dataset.messageId = item.id;

    const bubble = element('div', 'arc-chat-bubble');
    const text = element('p', 'arc-chat-message-text', item.content || '');
    const meta = element('span', 'arc-chat-message-meta');
    const time = element('time', 'arc-chat-time', formatClock(item.createdAt));
    if (created) time.dateTime = created.toISOString();
    meta.append(time);

    if (item.isMine) {
      const receipt = element(
        'span',
        `arc-chat-receipt ${item.readAt ? 'is-read' : ''}`,
        receiptText(Boolean(item.readAt))
      );
      receipt.setAttribute('aria-label', item.readAt ? 'Message read' : 'Message sent');
      meta.append(receipt);
    }

    bubble.append(text, meta);
    row.append(bubble);
    messages.append(row);

    lastRendered = {
      mine: item.isMine,
      time: created ? created.getTime() : 0,
      day: key,
      row
    };
  }

  function renderMessages(items = []) {
    messages.replaceChildren();
    lastRendered = null;

    if (!items.length) {
      messages.append(element('p', 'arc-chat-first', 'No messages yet. Say hi 👋'));
    }

    for (const item of items) renderMessage(item);
    scrollToLatest();
  }

  /* ---------- Conversation list ---------- */

  function conversationMatches(conversation) {
    if (!searchTerm) return true;
    const person = conversation.user || {};
    const haystack = [person.displayName, person.username, conversation.lastMessage?.content]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(searchTerm);
  }

  function renderConversations() {
    conversationList.replaceChildren();

    if (!conversations.length) {
      conversationList.append(
        element('p', 'arc-chat-list-empty', 'No chats yet. Open a friend’s profile to say hello.')
      );
      return;
    }

    const visible = conversations.filter(conversationMatches);

    if (!visible.length) {
      conversationList.append(element('p', 'arc-chat-list-empty', 'No chats match your search.'));
      return;
    }

    for (const conversation of visible) {
      const person = conversation.user;
      if (!person?.username) continue;

      const unread = conversation.unreadCount > 0;
      const row = button(
        '',
        `arc-chat-conversation${person.username === activeUsername ? ' is-active' : ''}${unread ? ' is-unread' : ''}`,
        () => void openChat(person)
      );

      const avatar = element(
        'span',
        'arc-chat-list-avatar',
        (person.displayName || person.username).slice(0, 1).toUpperCase()
      );
      setAvatar(avatar, person.avatar, avatar.textContent);

      const details = element('span', 'arc-chat-list-details');

      const top = element('span', 'arc-chat-list-top');
      top.append(
        element('span', 'arc-chat-list-name', person.displayName || person.username),
        element('span', 'arc-chat-list-time', formatListStamp(conversation.lastMessage?.createdAt))
      );

      const bottom = element('span', 'arc-chat-list-bottom');
      const last = conversation.lastMessage;
      const mineLast = last ? normalizeMessage(last).isMine : false;
      const previewText = last?.content
        ? `${mineLast ? 'You: ' : ''}${last.content}`
        : 'Start a conversation';
      bottom.append(element('span', 'arc-chat-list-preview', previewText));

      if (unread) {
        const badge = element('span', 'arc-chat-unread', String(conversation.unreadCount));
        badge.setAttribute('aria-label', `${conversation.unreadCount} unread`);
        bottom.append(badge);
      }

      details.append(top, bottom);
      row.append(avatar, details);
      conversationList.append(row);
    }
  }

  async function refreshConversations() {
    if (!getCurrentUser()) return;

    try {
      const result = await api('/messages/conversations');
      conversations = result.items || [];
      renderConversations();
    } catch (error) {
      toast(error.message || 'Could not load conversations.');
    }
  }

  async function markConversationRead(username) {
    if (!username || username !== activeUsername) return;

    try {
      await api(`/messages/${encodeURIComponent(username)}/read`, { method: 'PATCH' });

      const conversation = conversations.find((item) => item.user?.username === username);
      if (conversation) conversation.unreadCount = 0;

      renderConversations();
    } catch {
      // The next conversation refresh can retry.
    }
  }

  /* ---------- Open / close ---------- */

  function showMessagePanel(friend) {
    activeFriend = friend;
    activeUsername = friend.username;

    chatName.textContent = friend.displayName || friend.username;
    chatStatus.textContent = `@${friend.username}`;
    chatAvatar.textContent = (friend.displayName || friend.username).slice(0, 1).toUpperCase();
    setAvatar(chatAvatar, friend.avatar, chatAvatar.textContent);

    panel.hidden = false;
    emptyState.hidden = true;
    setChatting(true);

    renderConversations();
  }

  async function openChat(friend) {
    if (!getCurrentUser()) {
      toast('Sign in to message your friends.');
      return;
    }

    if (!friend?.username) {
      toast('We could not identify this friend.');
      return;
    }

    showMessagePanel(friend);
    messages.replaceChildren();
    lastRendered = null;
    loadingState.hidden = false;
    input.disabled = true;
    sendButton.disabled = true;

    try {
      const result = await api(`/messages/${encodeURIComponent(friend.username)}`);

      // Ignore a late response if the user opened another conversation.
      if (activeUsername !== friend.username) return;

      activeFriend = result.friend || friend;

      chatName.textContent = activeFriend.displayName || activeFriend.username;
      chatStatus.textContent = `@${activeFriend.username}`;
      chatAvatar.textContent = (activeFriend.displayName || activeFriend.username).slice(0, 1).toUpperCase();
      setAvatar(chatAvatar, activeFriend.avatar, chatAvatar.textContent);

      renderMessages(result.items || []);
      await markConversationRead(friend.username);
      input.focus();
    } catch (error) {
      if (activeUsername === friend.username) {
        messages.replaceChildren(
          element('p', 'arc-chat-error', error.message || 'Could not open this conversation.')
        );
      }
    } finally {
      loadingState.hidden = true;

      if (activeUsername === friend.username) {
        input.disabled = false;
        syncSendState();
      }
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    const content = input.value.trim();
    if (!content || !activeUsername || loading) return;

    loading = true;
    sendButton.disabled = true;

    try {
      const username = activeUsername;

      const result = await api(`/messages/${encodeURIComponent(username)}`, {
        method: 'POST',
        body: JSON.stringify({ content })
      });

      if (activeUsername !== username) return;

      // Drop the "say hi" placeholder once a real message arrives
      messages.querySelector('.arc-chat-first')?.remove();

      if (result.message) renderMessage(result.message);

      input.value = '';
      input.style.height = 'auto';
      scrollToLatest();

      await refreshConversations();
    } catch (error) {
      toast(error.message || 'Message could not be sent.');
    } finally {
      loading = false;
      syncSendState();
      input.focus();
    }
  }

  function handleIncomingMessage(rawMessage) {
    const message = normalizeMessage(rawMessage);
    const currentUserId = getUserIdentifier();

    if (!message.id || !message.content || !currentUserId) return;

    const sender = String(rawMessage.sender?._id || rawMessage.sender?.id || rawMessage.sender || '');
    const recipient = String(rawMessage.recipient?._id || rawMessage.recipient?.id || rawMessage.recipient || '');

    // Ignore events that do not involve the signed-in user.
    if (sender !== currentUserId && recipient !== currentUserId) {
      void refreshConversations();
      return;
    }

    // Identify the other participant by database ID.
    const otherUserId = sender === currentUserId ? recipient : sender;

    // The conversation list contains usernames, so resolve the ID
    // through the loaded conversation data when possible.
    const conversation = conversations.find((item) => {
      const last = item.lastMessage;
      return String(last?.sender || '') === otherUserId
        || String(last?.recipient || '') === otherUserId;
    });

    const otherUsername = conversation?.user?.username
      || (activeFriend?._id && String(activeFriend._id) === otherUserId
        ? activeFriend.username
        : activeFriend?.id && String(activeFriend.id) === otherUserId
          ? activeFriend.username
          : '');

    if (!otherUsername) {
      void refreshConversations();
      return;
    }

    if (activeUsername === otherUsername && !overlay.hidden) {
      messages.querySelector('.arc-chat-first')?.remove();
      renderMessage(message);

      if (!message.isMine) {
        void markConversationRead(otherUsername);
      }

      scrollToLatest();
    }

    void refreshConversations();
  }

  function handleReadReceipt(payload = {}) {
    if (!payload.username || payload.username !== activeUsername) return;

    const outgoing = messages.querySelectorAll('.arc-chat-message-row.is-mine');

    for (const row of outgoing) {
      const receipt = row.querySelector('.arc-chat-receipt');

      if (receipt) {
        receipt.textContent = receiptText(true);
        receipt.classList.add('is-read');
        receipt.setAttribute('aria-label', 'Message read');
      }
    }
  }

  function connect() {
    if (!getCurrentUser() || socket?.connected) return;

    if (!socket) {
      socket = io({
        path: '/socket.io/',
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000
      });

      socket.on('connect', () => {
        void refreshConversations();
      });

      socket.on('message:new', handleIncomingMessage);
      socket.on('message:read', handleReadReceipt);

      socket.on('connect_error', (error) => {
        console.error('[Messaging] Socket connection failed:', error.message);
        console.error('[Messaging] Connection details:', error);
      });
    }
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }

    activeUsername = null;
    activeFriend = null;
    conversations = [];
    closeChat();
  }

  // Leaves the open conversation and returns to the chat list
  function closeChat() {
    activeUsername = null;
    activeFriend = null;

    panel.hidden = true;
    emptyState.hidden = false;
    setChatting(false);
    renderConversations();
  }

  function openInbox() {
    if (!getCurrentUser()) {
      toast('Sign in to view your chats.');
      return;
    }

    connect();

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');

    activeUsername = null;
    activeFriend = null;

    panel.hidden = true;
    emptyState.hidden = false;
    setChatting(false);

    void refreshConversations();
  }

  /* ---------- Events ---------- */

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeChat();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden && activeUsername) closeChat();
  });

  composer.addEventListener('submit', sendMessage);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    syncSendState();
  });

  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    renderConversations();
  });

  function init() {
    if (initialized) return;
    initialized = true;
    connect();
  }

  return {
    init,
    connect,
    disconnect,
    openChat,
    openInbox,
    refreshConversations
  };
}
