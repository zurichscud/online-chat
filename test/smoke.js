'use strict';

/**
 * End-to-end smoke test for the live chat system.
 * Boots an isolated server on a random port with a temporary data file,
 * then exercises the actual HTTP + WebSocket protocol used by the UI.
 *
 * Run with: npm test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 43000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const PASSWORD = 'test-password';
const AGENT_NAME = '测试客服';
const DATA_FILE = path.join(os.tmpdir(), `shiguang-chat-test-${process.pid}.json`);
const SERVER_FILE = path.join(__dirname, '..', 'server.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // Server not listening yet.
    }
    await sleep(100);
  }
  throw new Error('Server did not become ready in time.');
}

class WsClient {
  constructor() {
    this.socket = null;
    this.queue = [];
    this.waiters = [];
  }

  static async open(name) {
    const client = new WsClient();
    client.name = name;
    client.socket = new WebSocket(WS_URL);
    client.socket.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      client.push(payload);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name} WebSocket open timed out`)), 5000);
      client.socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      client.socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return client;
  }

  push(payload) {
    for (let i = 0; i < this.waiters.length; i += 1) {
      const waiter = this.waiters[i];
      if (waiter.predicate(payload)) {
        this.waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(payload);
        return;
      }
    }
    this.queue.push(payload);
  }

  send(payload) {
    this.socket.send(JSON.stringify(payload));
  }

  waitFor(predicate, label = 'message', timeoutMs = 4000) {
    const existing = this.queue.findIndex(predicate);
    if (existing !== -1) {
      return Promise.resolve(this.queue.splice(existing, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) this.waiters.splice(index, 1);
          const debug = this.queue
            .map((item) => item.type)
            .slice(-8)
            .join(', ');
          reject(new Error(`[${this.name}] Timed out waiting for ${label}. Recent: ${debug || 'none'}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Ignore teardown errors.
    }
  }
}

function typeIs(type) {
  return (payload) => payload.type === type;
}

let serverProcess = null;
let visitor = null;
let agent = null;
let invalidAgent = null;

function cleanup() {
  if (visitor) visitor.close();
  if (agent) agent.close();
  if (invalidAgent) invalidAgent.close();
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
}

function removeTempFiles() {
  fs.rmSync(DATA_FILE, { force: true });
  if (serverProcess && serverProcess.pid) {
    fs.rmSync(`${DATA_FILE}.${serverProcess.pid}.tmp`, { force: true });
  }
}

async function main() {
  console.log('· Starting isolated server…');
  serverProcess = spawn(process.execPath, [SERVER_FILE], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_FILE,
      AGENT_PASSWORD: PASSWORD,
      AGENT_NAME,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let serverOutput = '';
  serverProcess.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  try {
    const health = await waitForServer();
    assert.strictEqual(health.ok, true);
    assert.strictEqual(health.service, 'shiguang-live-chat');
    console.log('  ✓ health endpoint');

    const widgetResponse = await fetch(`${BASE}/widget.js`);
    assert.strictEqual(widgetResponse.status, 200);
    const widgetSource = await widgetResponse.text();
    assert.ok(widgetSource.includes('ShiguangChat'));
    console.log('  ✓ static widget served');

    const demoResponse = await fetch(`${BASE}/demo.html`);
    assert.strictEqual(demoResponse.status, 200);
    assert.ok((await demoResponse.text()).includes('/widget.js'));
    const agentPageResponse = await fetch(`${BASE}/agent.html`);
    assert.strictEqual(agentPageResponse.status, 200);
    const rootRedirect = await fetch(`${BASE}/`, { redirect: 'manual' });
    assert.ok([301, 302, 307, 308].includes(rootRedirect.status));
    console.log('  ✓ demo page and agent console served');

    const wrongLogin = await fetch(`${BASE}/api/agent/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    assert.strictEqual(wrongLogin.status, 401);
    console.log('  ✓ wrong password rejected');

    const loginResponse = await fetch(`${BASE}/api/agent/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.strictEqual(loginResponse.status, 200);
    const login = await loginResponse.json();
    assert.ok(login.token);
    assert.strictEqual(login.agent.name, AGENT_NAME);
    console.log('  ✓ agent login');

    const visitorId = '11111111-1111-4111-8111-111111111111';
    visitor = await WsClient.open('visitor');
    visitor.send({
      type: 'visitor:hello',
      visitorId,
      page: 'demo.example/coffee',
      open: false,
    });
    const visitorReady = await visitor.waitFor(typeIs('visitor:ready'), 'visitor:ready');
    const conversationId = visitorReady.conversation.id;
    assert.ok(conversationId);
    assert.strictEqual(visitorReady.conversation.visitorName, '访客 1111');
    console.log('  ✓ visitor connected and conversation created');

    agent = await WsClient.open('agent');
    agent.send({ type: 'agent:hello', token: login.token });
    const agentReady = await agent.waitFor(typeIs('agent:ready'), 'agent:ready');
    assert.strictEqual(agentReady.me.name, AGENT_NAME);
    assert.ok(agentReady.conversations.some((item) => item.id === conversationId));
    console.log('  ✓ agent authenticated and received conversation list');

    agent.send({ type: 'agent:open', conversationId });
    const history = await agent.waitFor(
      (payload) => payload.type === 'conversation:history' && payload.conversation.id === conversationId,
      'conversation:history'
    );
    assert.deepStrictEqual(history.conversation.messages, []);

    const clientId = 'visitor-message-1';
    const visitorText = '你好，我想咨询一下山野日晒。';
    visitor.send({ type: 'visitor:message', text: visitorText, clientId });

    const visitorEcho = await visitor.waitFor(
      (payload) =>
        payload.type === 'message' &&
        payload.message.clientId === clientId &&
        payload.message.role === 'visitor',
      'visitor message echo'
    );
    assert.strictEqual(visitorEcho.message.text, visitorText);

    const agentReceived = await agent.waitFor(
      (payload) => payload.type === 'message' && payload.message.id === visitorEcho.message.id,
      'agent receives visitor message'
    );
    assert.strictEqual(agentReceived.message.text, visitorText);
    console.log('  ✓ visitor message delivered to agent');

    // Re-sending the same clientId after a reconnect must not duplicate the message.
    visitor.send({ type: 'visitor:message', text: visitorText, clientId });
    const duplicateEcho = await visitor.waitFor(
      (payload) =>
        payload.type === 'message' &&
        payload.message.clientId === clientId &&
        payload.message.id === visitorEcho.message.id,
      'duplicate echo'
    );
    assert.strictEqual(duplicateEcho.message.id, visitorEcho.message.id);

    agent.send({ type: 'agent:list' });
    const listAfterDuplicate = await agent.waitFor(typeIs('agent:conversations'), 'agent:conversations');
    const summary = listAfterDuplicate.conversations.find((item) => item.id === conversationId);
    assert.strictEqual(summary.messageCount, 1);
    console.log('  ✓ clientId dedupe prevents duplicate messages');

    const replyText = '很适合手冲，建议水温 92℃。';
    agent.send({ type: 'agent:message', conversationId, text: replyText, clientId: 'agent-message-1' });
    const visitorGotReply = await visitor.waitFor(
      (payload) => payload.type === 'message' && payload.message.role === 'agent',
      'visitor receives agent reply'
    );
    assert.strictEqual(visitorGotReply.message.text, replyText);
    assert.strictEqual(visitorGotReply.message.authorName, AGENT_NAME);

    const visitorUnread = await visitor.waitFor(
      (payload) =>
        payload.type === 'conversation:update' &&
        payload.conversation.id === conversationId &&
        payload.conversation.unreadForVisitor > 0,
      'visitor unread update'
    );
    assert.ok(visitorUnread.conversation.unreadForVisitor >= 1);

    visitor.send({ type: 'visitor:read' });
    await agent.waitFor(
      (payload) =>
        payload.type === 'conversation:update' &&
        payload.conversation.id === conversationId &&
        payload.conversation.unreadForVisitor === 0,
      'visitor read update'
    );
    console.log('  ✓ agent reply delivered and unread/read state tracked');

    agent.send({ type: 'agent:typing', conversationId, active: true });
    const agentTyping = await visitor.waitFor(
      (payload) => payload.type === 'typing' && payload.from === 'agent' && payload.active === true,
      'agent typing'
    );
    assert.strictEqual(agentTyping.name, AGENT_NAME);

    visitor.send({ type: 'visitor:typing', active: true });
    const visitorTyping = await agent.waitFor(
      (payload) => payload.type === 'typing' && payload.from === 'visitor' && payload.active === true,
      'visitor typing'
    );
    assert.ok(visitorTyping.conversationId === conversationId);
    console.log('  ✓ typing indicators relay in both directions');

    // Blur the agent so an incoming visitor message counts as unread for the console.
    agent.send({ type: 'agent:blur', conversationId });
    visitor.send({ type: 'visitor:message', text: '还有一个问题。', clientId: 'visitor-message-2' });
    const agentUnread = await agent.waitFor(
      (payload) =>
        payload.type === 'conversation:update' &&
        payload.conversation.id === conversationId &&
        payload.conversation.unreadForAgent >= 1,
      'agent unread update'
    );
    assert.ok(agentUnread.conversation.unreadForAgent >= 1);

    agent.send({ type: 'agent:open', conversationId });
    const reopenedHistory = await agent.waitFor(
      (payload) => payload.type === 'conversation:history' && payload.conversation.id === conversationId,
      'refreshed history'
    );
    assert.ok(reopenedHistory.conversation.messages.length >= 3);
    console.log('  ✓ unread badge and agent focus behavior');

    agent.send({ type: 'agent:setStatus', conversationId, status: 'closed' });
    const closedUpdate = await visitor.waitFor(
      (payload) =>
        payload.type === 'conversation:update' &&
        payload.conversation.id === conversationId &&
        payload.conversation.status === 'closed',
      'conversation closed'
    );
    assert.strictEqual(closedUpdate.conversation.status, 'closed');
    await visitor.waitFor(
      (payload) =>
        payload.type === 'message' &&
        payload.message.role === 'system' &&
        payload.message.text.includes('结束本次会话'),
      'close system message'
    );

    visitor.send({ type: 'visitor:message', text: '我还想再问一句。', clientId: 'visitor-message-3' });
    const reopenedUpdate = await visitor.waitFor(
      (payload) =>
        payload.type === 'conversation:update' &&
        payload.conversation.id === conversationId &&
        payload.conversation.status === 'open',
      'conversation reopened'
    );
    assert.strictEqual(reopenedUpdate.conversation.status, 'open');
    await visitor.waitFor(
      (payload) =>
        payload.type === 'message' &&
        payload.message.role === 'system' &&
        payload.message.text.includes('重新发起'),
      'reopen system message'
    );
    console.log('  ✓ close and auto-reopen by visitor');

    invalidAgent = await WsClient.open('invalid-agent');
    invalidAgent.send({ type: 'agent:hello', token: 'not-a-real-token' });
    const authError = await invalidAgent.waitFor(typeIs('auth:error'), 'auth:error');
    assert.ok(authError.message.length > 0);
    console.log('  ✓ unauthorized agent rejected');

    await sleep(450);
    assert.ok(fs.existsSync(DATA_FILE), 'data file should exist');
    const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const storedConversation = stored.conversations.find((item) => item.id === conversationId);
    assert.ok(storedConversation);
    assert.ok(storedConversation.messages.some((message) => message.text === replyText));
    assert.strictEqual(storedConversation.status, 'open');
    console.log('  ✓ conversation persisted to disk');

    const finalHealth = await (await fetch(`${BASE}/api/health`)).json();
    assert.strictEqual(finalHealth.visitorsOnline, 1);
    console.log('  ✓ health reflects online visitor');

    console.log('\nAll smoke tests passed.');
  } catch (error) {
    console.error('\nSmoke test failed:', error.message);
    if (serverOutput) {
      console.error('\n--- server output ---\n' + serverOutput.slice(-3000));
    }
    process.exitCode = 1;
  } finally {
    cleanup();
    if (serverProcess) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        serverProcess.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    removeTempFiles();
  }
}

main();
