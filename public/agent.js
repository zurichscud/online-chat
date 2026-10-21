'use strict';

(function () {
  var TOKEN_KEY = 'shiguang_agent_token';
  var SOUND_KEY = 'shiguang_agent_sound';

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    body: document.body,
    loginView: $('loginView'),
    consoleView: $('consoleView'),
    loginForm: $('loginForm'),
    passwordInput: $('passwordInput'),
    togglePassword: $('togglePassword'),
    loginError: $('loginError'),
    loginBtn: $('loginBtn'),
    connectionPill: $('connectionPill'),
    agentAvatar: $('agentAvatar'),
    agentName: $('agentName'),
    soundToggle: $('soundToggle'),
    logoutBtn: $('logoutBtn'),
    searchInput: $('searchInput'),
    filterTabs: document.querySelectorAll('.filter-tab'),
    countAll: $('countAll'),
    countUnread: $('countUnread'),
    convList: $('convList'),
    listEmpty: $('listEmpty'),
    listEmptyTitle: $('listEmptyTitle'),
    listEmptyText: $('listEmptyText'),
    footerOnline: $('footerOnline'),
    emptyState: $('emptyState'),
    chatLayout: $('chatLayout'),
    chatView: $('chatView'),
    chatBody: $('chatBody'),
    chatThread: $('chatThread'),
    visitorTyping: $('visitorTyping'),
    visitorAvatar: $('visitorAvatar'),
    visitorName: $('visitorName'),
    visitorOnlineLabel: $('visitorOnlineLabel'),
    visitorPage: $('visitorPage'),
    visitorSince: $('visitorSince'),
    infoToggle: $('infoToggle'),
    backBtn: $('backBtn'),
    contextRail: $('contextRail'),
    closeRail: $('closeRail'),
    railAvatar: $('railAvatar'),
    railName: $('railName'),
    railOnline: $('railOnline'),
    railVisitorId: $('railVisitorId'),
    railPage: $('railPage'),
    railFirst: $('railFirst'),
    railMessages: $('railMessages'),
    railDevice: $('railDevice'),
    railId: $('railId'),
    composerForm: $('composerForm'),
    messageInput: $('messageInput'),
    sendBtn: $('sendBtn'),
    quickChips: document.querySelectorAll('.quick-chip'),
    toast: $('toast'),
  };

  var state = {
    token: null,
    socket: null,
    connected: false,
    authenticated: false,
    authFailed: false,
    me: { name: '小满' },
    conversations: [],
    activeId: null,
    active: null,
    historyLoading: false,
    filter: 'all',
    query: '',
    reconnectTimer: null,
    reconnectAttempt: 0,
    visitorTypingTimer: null,
    typingStopTimer: null,
    lastTypingAt: 0,
    toastTimer: null,
    soundOn: true,
    audioCtx: null,
    loginBusy: false,
  };

  var AVATAR_PALETTES = [
    { bg: '#8f6c50', fg: '#fff7ec' },
    { bg: '#7b7f62', fg: '#fbf8ee' },
    { bg: '#a15d47', fg: '#fff6ee' },
    { bg: '#6b7d80', fg: '#f5fbfb' },
    { bg: '#947b53', fg: '#fffaef' },
    { bg: '#785e63', fg: '#fdf5f6' },
    { bg: '#566d5d', fg: '#f5faf4' },
    { bg: '#9b6a3f', fg: '#fff8ef' },
  ];

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  try {
    var storedSound = localStorage.getItem(SOUND_KEY);
    if (storedSound === 'off') state.soundOn = false;
  } catch (_) { /* storage may be disabled */ }

  updateSoundButton();

  var savedToken = null;
  try { savedToken = sessionStorage.getItem(TOKEN_KEY); } catch (_) { /* ignore */ }

  if (savedToken) {
    state.token = savedToken;
    enterConsole();
    connect();
  } else {
    showLoginView('');
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  els.loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (state.loginBusy) return;
    login();
  });

  els.passwordInput.addEventListener('input', function () {
    setLoginError('');
  });

  els.togglePassword.addEventListener('click', function () {
    var showing = els.passwordInput.type === 'text';
    els.passwordInput.type = showing ? 'password' : 'text';
    els.togglePassword.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
    els.togglePassword.title = showing ? '显示密码' : '隐藏密码';
    els.togglePassword.querySelector('use').setAttribute('href', showing ? '#i-eye' : '#i-eye-off');
    els.passwordInput.focus();
  });

  async function login() {
    var password = els.passwordInput.value;
    if (!password) {
      setLoginError('请输入工作台密码。');
      els.passwordInput.focus();
      return;
    }

    initAudio();
    state.loginBusy = true;
    els.loginBtn.disabled = true;
    els.loginBtn.classList.add('is-loading');
    els.loginBtn.querySelector('span').textContent = '正在验证';
    setLoginError('');

    try {
      var response = await fetch('/api/agent/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(data.error || '登录失败，请稍后重试。');
      }

      state.token = data.token;
      state.authFailed = false;
      try { sessionStorage.setItem(TOKEN_KEY, data.token); } catch (_) { /* ignore */ }
      if (data.agent && data.agent.name) {
        state.me.name = data.agent.name;
      }

      enterConsole();
      connect();
    } catch (error) {
      var message = error && error.message ? error.message : '登录失败，请稍后重试。';
      if (error instanceof TypeError) {
        message = '无法连接服务器，请确认后端服务已启动。';
      }
      setLoginError(message);
    } finally {
      state.loginBusy = false;
      els.loginBtn.disabled = false;
      els.loginBtn.classList.remove('is-loading');
      els.loginBtn.querySelector('span').textContent = '进入工作台';
    }
  }

  function setLoginError(text) {
    els.loginError.textContent = text || '';
    els.loginError.hidden = !text;
  }

  function enterConsole() {
    els.body.dataset.view = 'console';
    els.loginView.hidden = true;
    els.consoleView.hidden = false;
    var name = (state.me && state.me.name) || '客服';
    els.agentName.textContent = name;
    els.agentAvatar.textContent = firstChar(name);
    document.title = '拾光客服 · 工作台';
    setConnection('connecting');
  }

  function showLoginView(message) {
    state.token = null;
    state.authenticated = false;
    state.connected = false;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignore */ }

    disconnectSocket();

    state.conversations = [];
    state.activeId = null;
    state.active = null;
    state.historyLoading = false;
    state.filter = 'all';
    state.query = '';
    els.searchInput.value = '';
    els.filterTabs.forEach(function (tab) {
      var active = tab.dataset.filter === 'all';
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    els.consoleView.classList.remove('mobile-chat');
    els.chatLayout.classList.remove('rail-open', 'rail-collapsed');

    els.body.dataset.view = 'login';
    els.consoleView.hidden = true;
    els.loginView.hidden = false;
    document.title = '拾光客服 · 工作台';
    setLoginError(message || '');
    setTimeout(function () {
      if (!message) els.passwordInput.focus();
    }, 80);
  }

  els.logoutBtn.addEventListener('click', function () {
    var token = state.token;
    state.token = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignore */ }
    disconnectSocket();
    showLoginView('');
    toast('已退出工作台。');
    if (token) {
      fetch('/api/agent/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      }).catch(function () { /* non-critical */ });
    }
  });

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  function connect() {
    if (!state.token || state.authFailed) return;
    if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearTimeout(state.reconnectTimer);
    setConnection('connecting');

    var socket;
    try {
      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(protocol + '//' + window.location.host + '/ws');
    } catch (_) {
      setConnection('offline');
      scheduleReconnect();
      return;
    }

    state.socket = socket;

    socket.addEventListener('open', function () {
      if (state.socket !== socket) return;
      socket.send(JSON.stringify({ type: 'agent:hello', token: state.token }));
    });

    socket.addEventListener('message', function (event) {
      var payload;
      try { payload = JSON.parse(event.data); } catch (_) { return; }
      if (state.socket !== socket) return;
      handleEvent(payload);
    });

    socket.addEventListener('close', function (event) {
      if (state.socket !== socket) return;
      state.socket = null;
      state.connected = false;
      state.authenticated = false;

      if (!state.token) return;

      if (event.code === 4001) {
        showLoginView('登录已失效，请重新登录。');
        return;
      }

      setConnection('reconnecting');
      scheduleReconnect();
    });

    socket.addEventListener('error', function () {
      try { socket.close(); } catch (_) { /* ignore */ }
    });
  }

  function disconnectSocket() {
    clearTimeout(state.reconnectTimer);
    var socket = state.socket;
    state.socket = null;
    if (socket) {
      try { socket.close(1000, 'Logout'); } catch (_) { /* ignore */ }
    }
  }

  function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectAttempt += 1;
    var delay = Math.min(1200 * Math.pow(1.6, state.reconnectAttempt - 1), 12_000);
    state.reconnectTimer = setTimeout(connect, delay);
  }

  function send(payload) {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  function setConnection(name) {
    var labels = {
      connecting: '连接中',
      online: '已连接',
      reconnecting: '重连中',
      offline: '已离线',
    };
    els.connectionPill.dataset.state = name;
    els.connectionPill.querySelector('span').textContent = labels[name] || name;
  }

  function handleEvent(payload) {
    switch (payload.type) {
      case 'agent:ready': {
        state.connected = true;
        state.authenticated = true;
        state.authFailed = false;
        state.reconnectAttempt = 0;
        if (payload.me && payload.me.name) {
          state.me.name = payload.me.name;
          els.agentName.textContent = state.me.name;
          els.agentAvatar.textContent = firstChar(state.me.name);
        }
        state.conversations = Array.isArray(payload.conversations) ? payload.conversations.slice() : [];
        setConnection('online');
        renderAll();
        if (state.activeId) {
          var activeSummary = findConversation(state.activeId);
          if (activeSummary) {
            requestConversation(state.activeId);
            renderActiveHeader(activeSummary);
          } else {
            clearActiveConversation();
          }
        } else if (window.innerWidth > 760 && state.conversations.length > 0) {
          var preferred =
            state.conversations.find(function (item) { return item.unreadForAgent > 0; }) ||
            state.conversations[0];
          if (preferred) selectConversation(preferred.id, { auto: true });
        }
        break;
      }

      case 'agent:conversations':
        state.conversations = Array.isArray(payload.conversations) ? payload.conversations.slice() : [];
        renderConversationList();
        updateCounts();
        if (state.activeId) {
          var summary = findConversation(state.activeId);
          if (summary) renderActiveHeader(summary);
        }
        break;

      case 'conversation:update': {
        var incoming = payload.conversation;
        if (!incoming) break;
        var isNew = !findConversation(incoming.id);
        upsertConversation(incoming);
        if (state.activeId === incoming.id) {
          if (state.active) {
            state.active = Object.assign({}, state.active, incoming, {
              messages: state.active.messages || [],
            });
            renderActiveHeader(state.active);
          } else {
            renderActiveHeader(incoming);
          }
        }
        renderConversationList();
        updateCounts();
        if (isNew && state.authenticated) {
          toast('有新的客户消息。');
        }
        break;
      }

      case 'conversation:history': {
        var conversation = payload.conversation;
        if (!conversation || conversation.id !== state.activeId) break;
        state.active = conversation;
        state.historyLoading = false;
        upsertConversation(summaryFromFull(conversation));
        renderConversationList();
        updateCounts();
        renderActiveHeader(conversation);
        renderThread(true);
        updateRail(conversation);
        if (window.innerWidth > 760) {
          setTimeout(function () { els.messageInput.focus(); }, 60);
        }
        break;
      }

      case 'message':
        receiveMessage(payload.conversationId, payload.message);
        break;

      case 'typing':
        if (payload.from === 'visitor' && payload.conversationId === state.activeId) {
          showVisitorTyping(payload.active);
        }
        break;

      case 'conversation:removed':
        state.conversations = state.conversations.filter(function (item) {
          return item.id !== payload.conversationId;
        });
        if (state.activeId === payload.conversationId) clearActiveConversation();
        renderAll();
        break;

      case 'auth:error':
        state.authFailed = true;
        showLoginView(payload.message || '登录已失效，请重新登录。');
        break;

      case 'error':
        toast(payload.message || '操作失败，请稍后重试。');
        break;

      case 'agent:presence':
        break;

      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Conversation data
  // -------------------------------------------------------------------------

  function findConversation(id) {
    for (var i = 0; i < state.conversations.length; i += 1) {
      if (state.conversations[i].id === id) return state.conversations[i];
    }
    return null;
  }

  function upsertConversation(conversation) {
    var index = -1;
    for (var i = 0; i < state.conversations.length; i += 1) {
      if (state.conversations[i].id === conversation.id) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      state.conversations.push(conversation);
    } else {
      state.conversations[index] = Object.assign({}, state.conversations[index], conversation);
    }
    state.conversations.sort(function (a, b) {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  function summaryFromFull(conversation) {
    var summary = Object.assign({}, conversation);
    delete summary.messages;
    delete summary.userAgent;
    return summary;
  }

  function renderAll() {
    renderConversationList();
    updateCounts();
    if (state.activeId) {
      var summary = findConversation(state.activeId);
      if (summary) {
        renderActiveHeader(summary);
        renderThread(false);
        updateRail(state.active || summary);
      }
    } else {
      els.emptyState.hidden = false;
      els.chatLayout.hidden = true;
    }
    updateTitle();
  }

  // -------------------------------------------------------------------------
  // Conversation list
  // -------------------------------------------------------------------------

  function filteredConversations() {
    var query = state.query.trim().toLowerCase();

    return state.conversations.filter(function (conversation) {
      if (state.filter === 'unread' && conversation.unreadForAgent <= 0) return false;
      if (!query) return true;

      var lastText = conversation.lastMessage ? conversation.lastMessage.text : '';
      return (
        conversation.visitorName.toLowerCase().indexOf(query) !== -1 ||
        (conversation.page || '').toLowerCase().indexOf(query) !== -1 ||
        lastText.toLowerCase().indexOf(query) !== -1
      );
    });
  }

  function renderConversationList() {
    els.convList.textContent = '';
    var list = filteredConversations();

    list.forEach(function (conversation) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'conv-item' + (conversation.id === state.activeId ? ' is-active' : '');
      item.setAttribute('role', 'listitem');
      item.dataset.conversationId = conversation.id;

      var avatarWrap = document.createElement('div');
      avatarWrap.className = 'conv-avatar-wrap';
      var avatar = document.createElement('div');
      avatar.className = 'avatar';
      applyVisitorAvatar(avatar, conversation.visitorName);
      avatar.textContent = firstChar(conversation.visitorName);
      avatarWrap.appendChild(avatar);

      var onlineDot = document.createElement('span');
      onlineDot.className = 'conv-online' + (conversation.online ? '' : ' is-offline');
      onlineDot.title = conversation.online ? '客户在线' : '客户离线';
      avatarWrap.appendChild(onlineDot);
      item.appendChild(avatarWrap);

      var main = document.createElement('div');
      main.className = 'conv-main';

      var top = document.createElement('div');
      top.className = 'conv-top';
      var nameEl = document.createElement('span');
      nameEl.className = 'conv-name';
      nameEl.textContent = conversation.visitorName;
      top.appendChild(nameEl);

      var timeEl = document.createElement('time');
      timeEl.className = 'conv-time';
      timeEl.textContent = formatListTime(conversation.updatedAt);
      timeEl.dateTime = conversation.updatedAt;
      top.appendChild(timeEl);
      main.appendChild(top);

      var bottom = document.createElement('div');
      bottom.className = 'conv-bottom';
      var preview = document.createElement('span');
      preview.className = 'conv-preview' + (conversation.unreadForAgent > 0 ? ' is-unread' : '');
      preview.textContent = lastMessagePreview(conversation);
      bottom.appendChild(preview);

      if (conversation.unreadForAgent > 0) {
        var unread = document.createElement('span');
        unread.className = 'conv-unread';
        unread.textContent = conversation.unreadForAgent > 99 ? '99+' : String(conversation.unreadForAgent);
        unread.setAttribute('aria-label', conversation.unreadForAgent + ' 条未读消息');
        bottom.appendChild(unread);
      }

      main.appendChild(bottom);
      item.appendChild(main);
      item.addEventListener('click', function () {
        selectConversation(conversation.id);
      });

      els.convList.appendChild(item);
    });

    if (list.length === 0) {
      els.listEmpty.hidden = false;
      if (state.conversations.length === 0) {
        els.listEmptyTitle.textContent = '还没有客户咨询';
        els.listEmptyText.textContent = '客户发送的消息会实时出现在这里。';
      } else if (state.query.trim()) {
        els.listEmptyTitle.textContent = '没有找到匹配的会话';
        els.listEmptyText.textContent = '试试其他客户名称、页面或消息关键词。';
      } else if (state.filter === 'unread') {
        els.listEmptyTitle.textContent = '没有未读消息';
        els.listEmptyText.textContent = '所有客户消息都已经处理完毕。';
      } else {
        els.listEmptyTitle.textContent = '没有找到匹配的会话';
        els.listEmptyText.textContent = '试试其他客户名称、页面或消息关键词。';
      }
    } else {
      els.listEmpty.hidden = true;
    }
  }

  function lastMessagePreview(conversation) {
    var message = conversation.lastMessage;
    if (!message) return '等待客户发送消息…';
    var text = String(message.text || '').replace(/\s+/g, ' ').trim();
    if (message.role === 'agent') return '你：' + text;
    if (message.role === 'system') return text;
    return text;
  }

  function updateCounts() {
    var unreadConversations = 0;
    var unreadMessages = 0;
    var online = 0;

    state.conversations.forEach(function (conversation) {
      if (conversation.unreadForAgent > 0) unreadConversations += 1;
      unreadMessages += conversation.unreadForAgent || 0;
      if (conversation.online) online += 1;
    });

    els.countAll.textContent = String(state.conversations.length);
    els.countUnread.textContent = String(unreadConversations);
    els.footerOnline.textContent = online + ' 位客户在线';

    document.title =
      unreadMessages > 0
        ? '(' + unreadMessages + ') 拾光客服 · 工作台'
        : '拾光客服 · 工作台';
  }

  function updateTitle() {
    updateCounts();
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  function selectConversation(id, options) {
    options = options || {};
    var summary = findConversation(id);
    if (!summary) return;

    var isSame = state.active && state.active.id === id && !state.historyLoading;
    state.activeId = id;
    state.historyLoading = true;
    if (!isSame) state.active = null;

    summary.unreadForAgent = 0;
    renderConversationList();
    updateCounts();

    els.emptyState.hidden = true;
    els.chatLayout.hidden = false;
    els.chatLayout.classList.remove('rail-open');
    var railVisible =
      window.innerWidth > 1240
        ? !els.chatLayout.classList.contains('rail-collapsed')
        : els.chatLayout.classList.contains('rail-open');
    els.infoToggle.setAttribute('aria-expanded', railVisible ? 'true' : 'false');

    if (window.innerWidth <= 760) {
      els.consoleView.classList.add('mobile-chat');
    }

    renderActiveHeader(summary);
    renderThread(false);
    updateRail(summary);

    if (!isSame) {
      els.chatThread.innerHTML =
        '<div class="thread-loading" role="status">正在载入对话</div>';
    }

    requestConversation(id);
    if (!options.auto) {
      setTimeout(function () {
        if (window.innerWidth > 760) els.messageInput.focus();
      }, 80);
    }
  }

  function requestConversation(id) {
    if (!send({ type: 'agent:open', conversationId: id })) {
      toast('连接已断开，正在尝试重新连接…');
    }
  }

  function clearActiveConversation() {
    state.activeId = null;
    state.active = null;
    state.historyLoading = false;
    els.chatLayout.hidden = true;
    els.chatLayout.classList.remove('rail-open');
    els.emptyState.hidden = false;
    els.visitorTyping.hidden = true;
    els.consoleView.classList.remove('mobile-chat');
    renderConversationList();
    updateCounts();
  }

  els.backBtn.addEventListener('click', function () {
    if (state.activeId) send({ type: 'agent:blur', conversationId: state.activeId });
    clearActiveConversation();
  });

  // -------------------------------------------------------------------------
  // Active chat rendering
  // -------------------------------------------------------------------------

  function renderActiveHeader(conversation) {
    var name = conversation.visitorName || '访客';
    els.visitorName.textContent = name;
    applyVisitorAvatar(els.visitorAvatar, name);
    els.visitorAvatar.textContent = firstChar(name);

    var online = Boolean(conversation.online);
    els.visitorOnlineLabel.classList.toggle('is-offline', !online);
    els.visitorOnlineLabel.querySelector('span').textContent = online ? '在线' : '离线';

    var page = hostPath(conversation.page);
    els.visitorPage.textContent = page;
    els.visitorPage.parentElement.title = conversation.page || '';
    els.visitorSince.textContent = '首次咨询 ' + formatShortDate(conversation.createdAt);

    updateRail(conversation);
  }

  function updateRail(conversation) {
    if (!conversation) return;
    var name = conversation.visitorName || '访客';
    els.railName.textContent = name;
    applyVisitorAvatar(els.railAvatar, name);
    els.railAvatar.textContent = firstChar(name);

    var online = Boolean(conversation.online);
    els.railOnline.classList.toggle('is-offline', !online);
    els.railOnline.innerHTML = '<i class="online-dot"></i>' + (online ? '在线' : '离线');
    els.railVisitorId.textContent = 'ID · ' + shortId(conversation.visitorId);

    els.railPage.textContent = hostPath(conversation.page);
    els.railPage.title = conversation.page || '';
    els.railFirst.textContent = formatFullDate(conversation.createdAt);
    var count =
      state.active && state.active.id === conversation.id && Array.isArray(state.active.messages)
        ? state.active.messages.length
        : conversation.messageCount || 0;
    els.railMessages.textContent = count + ' 条';
    els.railDevice.textContent = deviceLabel(conversation.userAgent || (state.active && state.active.userAgent));
    els.railId.textContent = String(conversation.id || '').slice(0, 8).toUpperCase();
  }

  function renderThread(forceScroll) {
    var body = els.chatBody;
    var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 180;
    els.chatThread.textContent = '';

    if (state.historyLoading && !state.active) {
      els.chatThread.innerHTML = '<div class="thread-loading" role="status">正在载入对话</div>';
      return;
    }

    var conversation = state.active;
    if (!conversation) {
      els.chatThread.innerHTML =
        '<div class="thread-empty"><svg class="icon" aria-hidden="true"><use href="#i-message"></use></svg>正在载入客户信息…</div>';
      return;
    }

    var messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    if (messages.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'thread-empty';
      empty.innerHTML =
        '<div class="thread-empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-message"></use></svg></div>' +
        '<strong>还没有消息</strong>' +
        '<span>等待客户发起第一句话，<br>或使用下方输入框主动问候。</span>';
      els.chatThread.appendChild(empty);
      return;
    }

    var lastDay = '';
    var previous = null;

    messages.forEach(function (message) {
      var day = dayLabel(message.at);
      if (day && day !== lastDay) {
        var divider = document.createElement('div');
        divider.className = 'thread-day';
        divider.textContent = day;
        els.chatThread.appendChild(divider);
        lastDay = day;
        previous = null;
      }

      if (message.role === 'system') {
        var system = document.createElement('div');
        system.className = 'thread-system';
        system.textContent = message.text;
        els.chatThread.appendChild(system);
        previous = message;
        return;
      }

      var grouped =
        previous &&
        previous.role === message.role &&
        previous.role !== 'system' &&
        Math.abs(new Date(message.at).getTime() - new Date(previous.at).getTime()) < 5 * 60 * 1000;

      var row = document.createElement('div');
      row.className = 'msg-row ' + message.role + (grouped ? ' is-grouped' : '');

      var avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      if (message.role === 'agent') {
        avatar.textContent = firstChar(message.authorName || state.me.name);
      } else {
        var author = message.authorName || conversation.visitorName;
        applyVisitorAvatar(avatar, author);
        avatar.textContent = firstChar(author);
      }
      row.appendChild(avatar);

      var stack = document.createElement('div');
      stack.className = 'msg-stack';

      var meta = document.createElement('div');
      meta.className = 'msg-meta';
      var authorEl = document.createElement('strong');
      if (message.role === 'agent') {
        authorEl.textContent = message.authorName
          ? message.authorName + ((message.authorName === state.me.name) ? '（你）' : '')
          : '你';
      } else {
        authorEl.textContent = message.authorName || conversation.visitorName;
      }
      meta.appendChild(authorEl);
      var metaTime = document.createElement('time');
      metaTime.textContent = formatClock(message.at);
      metaTime.dateTime = message.at;
      meta.appendChild(metaTime);
      stack.appendChild(meta);

      var bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.textContent = message.text;
      stack.appendChild(bubble);

      row.appendChild(stack);
      els.chatThread.appendChild(row);
      previous = message;
    });

    if (forceScroll || nearBottom) {
      requestAnimationFrame(function () {
        body.scrollTop = body.scrollHeight;
      });
    }
  }

  function receiveMessage(conversationId, message) {
    if (!conversationId || !message) return;

    var summary = findConversation(conversationId);
    if (summary && message.role) {
      summary.lastMessage = {
        id: message.id,
        role: message.role,
        text: message.text,
        at: message.at,
        authorName: message.authorName,
      };
      summary.updatedAt = message.at;
      if (message.role === 'visitor' && conversationId !== state.activeId) {
        summary.unreadForAgent = (summary.unreadForAgent || 0) + 1;
      }
      state.conversations.sort(function (a, b) {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
    }

    if (state.activeId === conversationId && state.active) {
      if (!state.active.messages.some(function (item) { return item.id === message.id; })) {
        state.active.messages.push(message);
      }
      if (message.role === 'visitor') hideVisitorTyping();
      renderThread(true);
      updateRail(state.active);
    }

    if (message.role === 'visitor' && (document.hidden || state.activeId !== conversationId)) {
      playChime();
    }

    renderConversationList();
    updateCounts();
  }

  function showVisitorTyping(active) {
    clearTimeout(state.visitorTypingTimer);
    if (!active) {
      els.visitorTyping.hidden = true;
      return;
    }
    els.visitorTyping.hidden = false;
    if (window.innerWidth > 760) {
      els.chatBody.scrollTop = els.chatBody.scrollHeight;
    }
    state.visitorTypingTimer = setTimeout(function () {
      els.visitorTyping.hidden = true;
    }, 4000);
  }

  function hideVisitorTyping() {
    clearTimeout(state.visitorTypingTimer);
    els.visitorTyping.hidden = true;
  }

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------

  els.composerForm.addEventListener('submit', function (event) {
    event.preventDefault();
    sendReply();
  });

  function sendReply() {
    var text = els.messageInput.value.trim();
    if (!text) return;

    if (!state.activeId) {
      toast('请先选择一段会话。');
      return;
    }
    if (!state.connected || !state.authenticated) {
      toast('连接已断开，正在尝试重新连接…');
      connect();
      return;
    }

    var clientId = makeId();
    if (!send({ type: 'agent:message', conversationId: state.activeId, text: text, clientId: clientId })) {
      toast('消息发送失败，请稍后重试。');
      return;
    }

    els.messageInput.value = '';
    autoGrow();
    sendTyping(false);
    if (window.innerWidth > 760) els.messageInput.focus();
  }

  els.messageInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.composerForm.requestSubmit();
    }
  });

  els.messageInput.addEventListener('input', function () {
    autoGrow();
    sendTyping(true);
  });

  function autoGrow() {
    els.messageInput.style.height = 'auto';
    els.messageInput.style.height = Math.min(els.messageInput.scrollHeight, 120) + 'px';
  }

  function sendTyping(active) {
    if (!state.activeId) return;
    if (active) {
      var now = Date.now();
      if (now - state.lastTypingAt > 1200) {
        state.lastTypingAt = now;
        send({ type: 'agent:typing', conversationId: state.activeId, active: true });
      }
      clearTimeout(state.typingStopTimer);
      state.typingStopTimer = setTimeout(function () { sendTyping(false); }, 1800);
    } else {
      clearTimeout(state.typingStopTimer);
      state.lastTypingAt = 0;
      send({ type: 'agent:typing', conversationId: state.activeId, active: false });
    }
  }

  els.quickChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      els.messageInput.value = chip.textContent;
      autoGrow();
      els.messageInput.focus();
      els.messageInput.setSelectionRange(els.messageInput.value.length, els.messageInput.value.length);
    });
  });

  // -------------------------------------------------------------------------
  // Search + filters + rail
  // -------------------------------------------------------------------------

  els.searchInput.addEventListener('input', function () {
    state.query = els.searchInput.value;
    renderConversationList();
  });

  els.filterTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      state.filter = tab.dataset.filter || 'all';
      els.filterTabs.forEach(function (other) {
        var active = other === tab;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      renderConversationList();
    });
  });

  els.infoToggle.addEventListener('click', function () {
    if (window.innerWidth > 1240) {
      els.chatLayout.classList.toggle('rail-collapsed');
      var visible = !els.chatLayout.classList.contains('rail-collapsed');
      els.infoToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    } else {
      els.chatLayout.classList.toggle('rail-open');
      var open = els.chatLayout.classList.contains('rail-open');
      els.infoToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  });

  els.closeRail.addEventListener('click', function () {
    if (window.innerWidth > 1240) {
      els.chatLayout.classList.add('rail-collapsed');
    } else {
      els.chatLayout.classList.remove('rail-open');
    }
    els.infoToggle.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('keydown', function (event) {
    var target = event.target;
    var isTyping =
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (event.key === '/' && !isTyping) {
      event.preventDefault();
      els.searchInput.focus();
      return;
    }

    if (event.key === 'Escape') {
      if (els.chatLayout.classList.contains('rail-open')) {
        els.chatLayout.classList.remove('rail-open');
        els.infoToggle.setAttribute('aria-expanded', 'false');
      }
      if (target === els.searchInput) {
        els.searchInput.value = '';
        state.query = '';
        renderConversationList();
        els.searchInput.blur();
      }
    }
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 1240) {
      els.chatLayout.classList.remove('rail-open');
      els.infoToggle.setAttribute('aria-expanded', els.chatLayout.classList.contains('rail-collapsed') ? 'false' : 'true');
    } else {
      els.chatLayout.classList.remove('rail-collapsed');
    }
  });

  // -------------------------------------------------------------------------
  // Sound
  // -------------------------------------------------------------------------

  function updateSoundButton() {
    els.soundToggle.setAttribute('aria-pressed', state.soundOn ? 'true' : 'false');
    els.soundToggle.title = state.soundOn ? '提示音已开启' : '提示音已关闭';
    els.soundToggle.setAttribute('aria-label', els.soundToggle.title);
    els.soundToggle.querySelector('use').setAttribute('href', state.soundOn ? '#i-bell' : '#i-bell-off');
  }

  function initAudio() {
    if (state.audioCtx) {
      if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(function () {});
      return;
    }
    try {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) state.audioCtx = new AudioCtor();
    } catch (_) {
      state.audioCtx = null;
    }
  }

  function playChime() {
    if (!state.soundOn) return;
    initAudio();
    if (!state.audioCtx) return;
    try {
      var ctx = state.audioCtx;
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      var start = ctx.currentTime + 0.02;
      [880, 1174.66].forEach(function (frequency, index) {
        var oscillator = ctx.createOscillator();
        var gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + index * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.055, start + index * 0.09 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.09 + 0.36);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(start + index * 0.09);
        oscillator.stop(start + index * 0.09 + 0.4);
      });
    } catch (_) { /* audio is a nice-to-have */ }
  }

  els.soundToggle.addEventListener('click', function () {
    state.soundOn = !state.soundOn;
    try { localStorage.setItem(SOUND_KEY, state.soundOn ? 'on' : 'off'); } catch (_) { /* ignore */ }
    updateSoundButton();
    if (state.soundOn) playChime();
  });

  document.addEventListener('pointerdown', initAudio, { once: true });

  // -------------------------------------------------------------------------
  // Toast
  // -------------------------------------------------------------------------

  function toast(text) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = text;
    els.toast.hidden = false;
    els.toast.style.animation = 'none';
    // Force a reflow so repeated toasts replay the entrance animation.
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
    state.toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 3400);
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  function firstChar(name) {
    var value = String(name || '').trim();
    if (!value) return '访';
    return Array.from(value)[0] || '访';
  }

  function hashString(value) {
    var hash = 0;
    var text = String(value || '');
    for (var i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  function applyVisitorAvatar(element, name) {
    var palette = AVATAR_PALETTES[hashString(name) % AVATAR_PALETTES.length];
    element.style.background = palette.bg;
    element.style.color = palette.fg;
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      try { return window.crypto.randomUUID(); } catch (_) { /* fall through */ }
    }
    return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function shortId(value) {
    var text = String(value || '').replace(/-/g, '');
    return text.slice(0, 10).toUpperCase() || '—';
  }

  function hostPath(page) {
    if (!page) return '来源页面未知';
    var value = String(page);
    try {
      var url = new URL(value.indexOf('://') === -1 ? 'http://' + value : value);
      value = url.host + (url.pathname === '/' ? '' : url.pathname);
      if (url.search) value += url.search;
    } catch (_) { /* display raw value */ }
    return value;
  }

  function deviceLabel(ua) {
    if (!ua) return '未知设备';
    var browser = '浏览器';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\//i.test(ua)) browser = 'Opera';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua)) browser = 'Safari';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';

    var system = '';
    if (/iPhone/i.test(ua)) system = 'iPhone';
    else if (/iPad/i.test(ua)) system = 'iPad';
    else if (/Android/i.test(ua)) system = 'Android';
    else if (/Windows/i.test(ua)) system = 'Windows';
    else if (/Mac OS X/i.test(ua)) system = 'macOS';
    else if (/Linux/i.test(ua)) system = 'Linux';

    return system ? browser + ' · ' + system : browser;
  }

  function formatListTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((startToday - startDate) / 86400000);
    if (diff <= 0) return formatClock(date);
    if (diff === 1) return '昨天';
    if (diff < 7) return diff + ' 天前';
    if (date.getFullYear() === now.getFullYear()) {
      return date.getMonth() + 1 + '月' + date.getDate() + '日';
    }
    return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
  }

  function formatClock(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
    } catch (_) {
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }
  }

  function formatShortDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    var now = new Date();
    var sameYear = date.getFullYear() === now.getFullYear();
    var prefix = sameYear ? '' : date.getFullYear() + '年';
    return prefix + (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + formatClock(date);
  }

  function formatFullDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return (
      date.getFullYear() +
      '年' +
      (date.getMonth() + 1) +
      '月' +
      date.getDate() +
      '日 ' +
      formatClock(date)
    );
  }

  function dayLabel(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((startToday - startDate) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (date.getFullYear() === now.getFullYear()) {
      return date.getMonth() + 1 + '月' + date.getDate() + '日';
    }
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
  }
})();
