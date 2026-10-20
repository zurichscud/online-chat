'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { Store } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const AGENT_PASSWORD = process.env.AGENT_PASSWORD || 'demo123';
const AGENT_NAME = process.env.AGENT_NAME || '小满';
const AGENT_TOKEN_TTL = 12 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_MESSAGES_PER_WINDOW = 20;
const MESSAGE_WINDOW_MS = 10_000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'store.json');
const store = new Store(DATA_FILE);
store.load();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const agentTokens = new Map(); // token -> { name, expiresAt }
const visitors = new Map(); // ws -> { visitorId, panelOpen }
const agents = new Map(); // ws -> { name, focusedConversationId }
const loginAttempts = new Map(); // ip -> { count, resetAt }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

function normalizeText(value, maxLength = MAX_MESSAGE_LENGTH) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeVisitorId(value) {
  if (typeof value !== 'string') return '';
  return /^[a-zA-Z0-9-]{8,64}$/.test(value) ? value : '';
}

function visitorNameFor(visitorId) {
  const suffix = visitorId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return `访客 ${suffix || '0000'}`;
}

function isVisitorOnline(visitorId) {
  for (const state of visitors.values()) {
    if (state.visitorId === visitorId) return true;
  }
  return false;
}

function visitorSocketsFor(visitorId) {
  const sockets = [];
  for (const [ws, state] of visitors.entries()) {
    if (state.visitorId === visitorId) sockets.push(ws);
  }
  return sockets;
}

function hasOpenVisitorPanel(visitorId) {
  for (const state of visitors.values()) {
    if (state.visitorId === visitorId && state.panelOpen) return true;
  }
  return false;
}

function hasFocusedAgent(conversationId) {
  for (const state of agents.values()) {
    if (state.focusedConversationId === conversationId) return true;
  }
  return false;
}

function onlineAgentNames() {
  return [...new Set([...agents.values()].map((state) => state.name))];
}

function summarize(conversation) {
  const lastMessage = conversation.messages[conversation.messages.length - 1] || null;
  return {
    id: conversation.id,
    visitorId: conversation.visitorId,
    visitorName: conversation.visitorName,
    page: conversation.page,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    status: conversation.status,
    unreadForAgent: conversation.unreadForAgent,
    unreadForVisitor: conversation.unreadForVisitor,
    online: isVisitorOnline(conversation.visitorId),
    messageCount: conversation.messages.length,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          role: lastMessage.role,
          text: lastMessage.text,
          at: lastMessage.at,
          authorName: lastMessage.authorName,
        }
      : null,
  };
}

function fullConversation(conversation) {
  return {
    ...summarize(conversation),
    userAgent: conversation.userAgent,
    messages: conversation.messages,
  };
}

function sortedSummaries() {
  return store.data.conversations
    .map(summarize)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function broadcastToAgents(payload) {
  for (const ws of agents.keys()) send(ws, payload);
}

function broadcastToVisitors(payload) {
  for (const ws of visitors.keys()) send(ws, payload);
}

function broadcastToConversationVisitor(visitorId, payload) {
  for (const ws of visitorSocketsFor(visitorId)) send(ws, payload);
}

function broadcastPresence() {
  const names = onlineAgentNames();
  const payload = {
    type: 'agent:presence',
    online: names.length > 0,
    agents: names,
  };
  broadcastToVisitors(payload);
  for (const ws of agents.keys()) send(ws, { ...payload, connections: agents.size });
}

function broadcastConversationUpdate(conversation, { toVisitor = true } = {}) {
  const summary = summarize(conversation);
  broadcastToAgents({ type: 'conversation:update', conversation: summary });
  if (toVisitor) {
    broadcastToConversationVisitor(conversation.visitorId, {
      type: 'conversation:update',
      conversation: summary,
    });
  }
}

function emitMessage(conversation, message) {
  const payload = { type: 'message', conversationId: conversation.id, message };
  broadcastToConversationVisitor(conversation.visitorId, payload);
  broadcastToAgents(payload);
}

function canSendMessage(ws) {
  const now = Date.now();
  if (!ws.rateWindow || now > ws.rateWindow.resetAt) {
    ws.rateWindow = { count: 0, resetAt: now + MESSAGE_WINDOW_MS };
  }
  ws.rateWindow.count += 1;
  return ws.rateWindow.count <= MAX_MESSAGES_PER_WINDOW;
}

function issueAgentToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  agentTokens.set(token, { name: AGENT_NAME, expiresAt: Date.now() + AGENT_TOKEN_TTL });
  return token;
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

app.post('/api/agent/login', (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  const attempt = loginAttempts.get(ip);

  if (attempt && attempt.resetAt > now && attempt.count >= 8) {
    return res.status(429).json({ error: '尝试次数过多，请稍后再试。' });
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || password !== AGENT_PASSWORD) {
    const next =
      attempt && attempt.resetAt > now
        ? { count: attempt.count + 1, resetAt: attempt.resetAt }
        : { count: 1, resetAt: now + 10 * 60 * 1000 };
    loginAttempts.set(ip, next);
    return res.status(401).json({ error: '密码不正确。' });
  }

  loginAttempts.delete(ip);
  return res.json({
    token: issueAgentToken(),
    agent: { name: AGENT_NAME },
    expiresIn: AGENT_TOKEN_TTL,
  });
});

app.post('/api/agent/logout', (req, res) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) agentTokens.delete(token);
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'shiguang-live-chat',
    time: new Date().toISOString(),
    agentsOnline: agents.size,
    visitorsOnline: new Set([...visitors.values()].map((state) => state.visitorId)).size,
    conversations: store.data.conversations.length,
  });
});

app.get('/api/widget-config', (req, res) => {
  res.json({
    agentName: AGENT_NAME,
    online: agents.size > 0,
    agents: onlineAgentNames(),
  });
});

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('widget.js')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.get('/', (req, res) => res.redirect('/demo.html'));
app.get('/agent', (req, res) => res.redirect('/agent.html'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---------------------------------------------------------------------------
// WebSocket realtime layer
// ---------------------------------------------------------------------------

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.role = null;
  ws.remoteAddress = clientIp(req);
  ws.userAgent = String(req.headers['user-agent'] || '').slice(0, 300);

  const authTimer = setTimeout(() => {
    if (!ws.role) ws.close(4000, 'Hello timeout');
  }, 10_000);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return sendError(ws, '消息格式不正确。');
    }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      return sendError(ws, '消息格式不正确。');
    }

    try {
      handleSocketMessage(ws, message, req, () => clearTimeout(authTimer));
    } catch (error) {
      console.error('[ws] Message handler failed:', error);
      sendError(ws, '服务暂时不可用，请稍后重试。');
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (visitors.has(ws)) {
      const state = visitors.get(ws);
      visitors.delete(ws);
      const conversation = store.findByVisitor(state.visitorId);
      if (conversation) broadcastConversationUpdate(conversation);
    }
    if (agents.has(ws)) {
      agents.delete(ws);
      broadcastPresence();
    }
  });

  ws.on('error', () => {
    // The close handler performs cleanup.
  });
});

function handleSocketMessage(ws, message, req, markAuthenticated) {
  switch (message.type) {
    case 'visitor:hello':
      return handleVisitorHello(ws, message, req, markAuthenticated);
    case 'agent:hello':
      return handleAgentHello(ws, message, markAuthenticated);
    default:
      break;
  }

  if (ws.role === 'visitor') {
    return handleVisitorMessage(ws, message);
  }
  if (ws.role === 'agent') {
    return handleAgentMessage(ws, message);
  }
  return sendError(ws, '请先完成连接。');
}

// ------------------------------- Visitor ----------------------------------

function handleVisitorHello(ws, message, req, markAuthenticated) {
  if (ws.role) return;

  const visitorId = normalizeVisitorId(message.visitorId);
  if (!visitorId) {
    sendError(ws, '访客标识无效。');
    ws.close(4002, 'Invalid visitor');
    return;
  }

  const providedName = normalizeText(message.name, 40);
  const page = normalizeText(message.page, 300);
  const panelOpen = message.open === true;

  let conversation = store.findByVisitor(visitorId);
  if (!conversation) {
    conversation = store.createConversation({
      visitorId,
      visitorName: providedName || visitorNameFor(visitorId),
      page,
      userAgent: ws.userAgent,
    });
  } else {
    if (providedName) conversation.visitorName = providedName;
    if (page) conversation.page = page;
    conversation.userAgent = ws.userAgent || conversation.userAgent;
    if (panelOpen) conversation.unreadForVisitor = 0;
  }

  ws.role = 'visitor';
  markAuthenticated();
  visitors.set(ws, { visitorId, panelOpen });
  store.saveSoon();

  send(ws, {
    type: 'visitor:ready',
    conversation: fullConversation(conversation),
    serverTime: new Date().toISOString(),
  });
  const names = onlineAgentNames();
  send(ws, { type: 'agent:presence', online: names.length > 0, agents: names });

  broadcastToAgents({ type: 'conversation:update', conversation: summarize(conversation) });
}

function handleVisitorMessage(ws, message) {
  const state = visitors.get(ws);
  if (!state) return sendError(ws, '连接已失效，请刷新页面。');

  const conversation = store.findByVisitor(state.visitorId);
  if (!conversation) return sendError(ws, '会话不存在，请刷新页面重试。');

  if (!canSendMessage(ws)) {
    return sendError(ws, '发送太频繁了，请稍后再试。');
  }

  switch (message.type) {
    case 'visitor:message': {
      const text = normalizeText(message.text);
      if (!text) return;

      if (conversation.status === 'closed') {
        conversation.status = 'open';
        const systemMessage = store.addMessage(conversation, {
          role: 'system',
          text: '客户重新发起了咨询',
        });
        emitMessage(conversation, systemMessage);
      }

      const clientId = normalizeText(message.clientId, 64);
      if (clientId) {
        const duplicate = conversation.messages.find(
          (item) => item.clientId === clientId && item.role === 'visitor'
        );
        if (duplicate) {
          send(ws, { type: 'message', conversationId: conversation.id, message: duplicate });
          return;
        }
      }
      const stored = store.addMessage(conversation, {
        role: 'visitor',
        text,
        authorName: conversation.visitorName,
        clientId,
      });

      conversation.unreadForVisitor = 0;
      conversation.unreadForAgent = hasFocusedAgent(conversation.id)
        ? 0
        : conversation.unreadForAgent + 1;
      store.saveSoon();

      emitMessage(conversation, stored);
      broadcastConversationUpdate(conversation);
      return;
    }

    case 'visitor:typing': {
      const active = message.active === true;
      for (const [agentWs, agentState] of agents.entries()) {
        if (active || agentState.focusedConversationId === conversation.id) {
          send(agentWs, {
            type: 'typing',
            conversationId: conversation.id,
            from: 'visitor',
            name: conversation.visitorName,
            active,
          });
        }
      }
      return;
    }

    case 'visitor:read': {
      if (conversation.unreadForVisitor !== 0) {
        conversation.unreadForVisitor = 0;
        store.saveSoon();
        broadcastToAgents({ type: 'conversation:update', conversation: summarize(conversation) });
      }
      return;
    }

    case 'visitor:panel': {
      state.panelOpen = message.open === true;
      if (state.panelOpen && conversation.unreadForVisitor !== 0) {
        conversation.unreadForVisitor = 0;
        store.saveSoon();
        broadcastToAgents({ type: 'conversation:update', conversation: summarize(conversation) });
      }
      return;
    }

    default:
      return sendError(ws, '未知的访客操作。');
  }
}

// -------------------------------- Agent -----------------------------------

function handleAgentHello(ws, message, markAuthenticated) {
  if (ws.role) return;

  const auth = agentTokens.get(message.token);
  if (!auth || auth.expiresAt < Date.now()) {
    if (auth) agentTokens.delete(message.token);
    send(ws, { type: 'auth:error', message: '登录已失效，请重新登录。' });
    ws.close(4001, 'Unauthorized');
    return;
  }

  ws.role = 'agent';
  markAuthenticated();
  agents.set(ws, { name: auth.name, focusedConversationId: null });

  send(ws, {
    type: 'agent:ready',
    me: { name: auth.name },
    conversations: sortedSummaries(),
    agents: onlineAgentNames(),
  });
  broadcastPresence();
}

function handleAgentMessage(ws, message) {
  const state = agents.get(ws);
  if (!state) {
    sendError(ws, '登录已失效，请重新登录。');
    return;
  }

  if (message.type === 'agent:list') {
    send(ws, { type: 'agent:conversations', conversations: sortedSummaries() });
    return;
  }

  if (message.type === 'agent:typing') {
    const conversation = store.getConversation(message.conversationId);
    if (!conversation) return;
    const active = message.active === true;
    broadcastToConversationVisitor(conversation.visitorId, {
      type: 'typing',
      conversationId: conversation.id,
      from: 'agent',
      name: state.name,
      active,
    });
    return;
  }

  const conversation = store.getConversation(message.conversationId);
  if (!conversation) return sendError(ws, '会话不存在或已被删除。');

  switch (message.type) {
    case 'agent:open': {
      state.focusedConversationId = conversation.id;
      if (conversation.unreadForAgent !== 0) {
        conversation.unreadForAgent = 0;
        store.saveSoon();
      }
      send(ws, {
        type: 'conversation:history',
        conversation: fullConversation(conversation),
      });
      broadcastToAgents({ type: 'conversation:update', conversation: summarize(conversation) });
      return;
    }

    case 'agent:blur': {
      if (state.focusedConversationId === conversation.id) {
        state.focusedConversationId = null;
      }
      return;
    }

    case 'agent:read': {
      if (conversation.unreadForAgent !== 0) {
        conversation.unreadForAgent = 0;
        store.saveSoon();
        broadcastToAgents({ type: 'conversation:update', conversation: summarize(conversation) });
      }
      return;
    }

    case 'agent:message': {
      if (!canSendMessage(ws)) {
        return sendError(ws, '发送太频繁了，请稍后再试。');
      }
      const text = normalizeText(message.text);
      if (!text) return;

      if (conversation.status === 'closed') {
        conversation.status = 'open';
        const systemMessage = store.addMessage(conversation, {
          role: 'system',
          text: '客服重新开启了会话',
        });
        emitMessage(conversation, systemMessage);
      }

      state.focusedConversationId = conversation.id;
      const clientId = normalizeText(message.clientId, 64);
      if (clientId) {
        const duplicate = conversation.messages.find(
          (item) => item.clientId === clientId && item.role === 'agent'
        );
        if (duplicate) {
          send(ws, { type: 'message', conversationId: conversation.id, message: duplicate });
          return;
        }
      }
      const stored = store.addMessage(conversation, {
        role: 'agent',
        text,
        authorName: state.name,
        clientId,
      });

      conversation.unreadForAgent = 0;
      conversation.unreadForVisitor = hasOpenVisitorPanel(conversation.visitorId)
        ? 0
        : conversation.unreadForVisitor + 1;
      store.saveSoon();

      emitMessage(conversation, stored);
      broadcastConversationUpdate(conversation);
      return;
    }

    case 'agent:setStatus': {
      const status = message.status === 'closed' ? 'closed' : 'open';
      if (conversation.status === status) return;

      conversation.status = status;
      conversation.unreadForAgent = 0;
      conversation.unreadForVisitor = 0;
      const systemMessage = store.addMessage(conversation, {
        role: 'system',
        text: status === 'closed' ? '客服已结束本次会话' : '客服重新开启了会话',
      });
      emitMessage(conversation, systemMessage);
      broadcastConversationUpdate(conversation);
      return;
    }

    case 'agent:delete': {
      // Not exposed in the UI for safety; kept for API completeness.
      store.removeConversation(conversation.id);
      broadcastToAgents({ type: 'conversation:removed', conversationId: conversation.id });
      broadcastToConversationVisitor(conversation.visitorId, {
        type: 'conversation:removed',
        conversationId: conversation.id,
      });
      return;
    }

    default:
      return sendError(ws, '未知的客服操作。');
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
heartbeat.unref();

setInterval(() => {
  const now = Date.now();
  for (const [token, auth] of agentTokens.entries()) {
    if (auth.expiresAt < now) agentTokens.delete(token);
  }
  for (const [ip, attempt] of loginAttempts.entries()) {
    if (attempt.resetAt < now) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000).unref();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请先关闭占用程序或使用 PORT=3001 npm start。`);
    process.exit(1);
  }
  console.error(error);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  拾光客服 · 在线客服系统已启动');
  console.log('  ------------------------------------');
  console.log(`  演示页面    http://localhost:${PORT}/demo.html`);
  console.log(`  客服工作台  http://localhost:${PORT}/agent.html`);
  console.log(`  演示密码    ${AGENT_PASSWORD}${process.env.AGENT_PASSWORD ? '' : '（可用 AGENT_PASSWORD 环境变量修改）'}`);
  console.log('');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal}, saving data...`);
  store.flush();
  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
