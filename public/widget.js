/*!
 * 拾光客服 · 可嵌入在线聊天组件 v1.0.0
 * 由 widget-sdk 构建生成，请勿直接修改 public/widget.js。
 * 用法：<script src="https://your-host/widget.js" defer data-server="https://your-host"></script>
 */
"use strict";
(() => {
  // src/config.ts
  var DEFAULT_TITLE = "拾光咖啡 · 在线客服";
  var DEFAULT_ACCENT = "#B4552D";
  var DEFAULT_PROMPTS = [
    "你好，我想咨询一下",
    "帮我推荐一款产品",
    "查询我的订单"
  ];
  var MAX_PROMPTS = 4;
  function normalizeServer(value) {
    const origin = value || window.location.origin;
    return origin.replace(/\/+$/, "");
  }
  function toWsOrigin(origin) {
    return origin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  }
  function parsePrompts(value) {
    const items = Array.isArray(value) ? value : String(value || "").split("|");
    return items.map((item) => item.trim()).filter(Boolean).slice(0, MAX_PROMPTS);
  }
  function resolveConfig(input) {
    const serverOrigin = normalizeServer(input.server);
    return {
      title: input.title || DEFAULT_TITLE,
      accent: input.color || DEFAULT_ACCENT,
      position: input.position === "left" ? "left" : "right",
      prompts: input.prompts === void 0 ? [...DEFAULT_PROMPTS] : parsePrompts(input.prompts),
      autoOpen: typeof input.autoOpen === "boolean" ? input.autoOpen : String(input.autoOpen || "").toLowerCase() !== "false",
      wsUrl: `${toWsOrigin(serverOrigin)}/ws`
    };
  }
  function configFromScript(script) {
    var _a;
    const scriptUrl = (script == null ? void 0 : script.src) ? new URL(script.src, window.location.href) : null;
    const data = (_a = script == null ? void 0 : script.dataset) != null ? _a : {};
    return resolveConfig({
      server: data.server || (scriptUrl ? scriptUrl.origin : window.location.origin),
      title: data.title,
      color: data.color,
      position: data.position,
      prompts: data.prompts || void 0,
      autoOpen: data.autoOpen
    });
  }

  // src/utils.ts
  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      try {
        return window.crypto.randomUUID();
      } catch {
      }
    }
    const random = Math.random().toString(36).slice(2);
    return `v-${Date.now().toString(36)}-${random}${random}`;
  }
  function readStorage(storage, key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  function writeStorage(storage, key, value) {
    try {
      storage == null ? void 0 : storage.setItem(key, value);
    } catch {
    }
  }
  function escapeCss(value) {
    const cleaned = String(value || "").replace(/[;{}<>"'\\]/g, "").slice(0, 40);
    return cleaned || "#B4552D";
  }
  function formatTime(value) {
    const date = value ? new Date(value) : /* @__PURE__ */ new Date();
    if (Number.isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(date);
    } catch {
      return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
    }
  }
  function dayLabel(value) {
    const date = value ? new Date(value) : /* @__PURE__ */ new Date();
    if (Number.isNaN(date.getTime())) return "";
    const today = /* @__PURE__ */ new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 864e5);
    if (diff === 0) return "今天";
    if (diff === 1) return "昨天";
    try {
      return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date);
    } catch {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
  }

  // src/identity.ts
  var VISITOR_KEY = "shiguang_chat_visitor_id";
  var VISITOR_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;
  function localStorageSafe() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  function ensureVisitorId(provided) {
    if (provided && VISITOR_ID_PATTERN.test(provided)) return provided;
    const storage = localStorageSafe();
    const stored = readStorage(storage, VISITOR_KEY);
    if (stored && VISITOR_ID_PATTERN.test(stored)) return stored;
    const visitorId = makeId();
    writeStorage(storage, VISITOR_KEY, visitorId);
    return visitorId;
  }

  // src/session.ts
  function toPendingMessage(entry) {
    return {
      id: `local-${entry.clientId}`,
      clientId: entry.clientId,
      role: "visitor",
      text: entry.text,
      at: entry.at,
      pending: true
    };
  }
  var ChatSession = class {
    constructor() {
      this.conversation = null;
      this.messages = [];
      this.outbox = [];
      this.unread = 0;
    }
    /** 用服务端下发的完整会话替换本地状态，同时对齐未确认消息。 */
    applyConversation(conversation, panelOpen) {
      if (!conversation) {
        this.conversation = null;
        this.messages = this.outbox.map(toPendingMessage);
        this.unread = 0;
        return;
      }
      this.conversation = conversation;
      const serverMessages = Array.isArray(conversation.messages) ? conversation.messages.slice() : [];
      this.outbox = this.outbox.filter(
        (entry) => !serverMessages.some((message) => message.clientId === entry.clientId)
      );
      this.messages = serverMessages.concat(this.outbox.map(toPendingMessage));
      this.unread = panelOpen ? 0 : conversation.unreadForVisitor || 0;
    }
    /** 合并会话摘要（不含 messages），保留现有消息列表。 */
    updateConversation(update, panelOpen) {
      this.conversation = Object.assign({}, this.conversation, update);
      if (!panelOpen) {
        this.unread = Math.max(this.unread, update.unreadForVisitor || 0);
      }
    }
    /** 记录一条待发送消息，并生成对应的本地乐观消息。 */
    queue(text) {
      const entry = {
        clientId: makeId(),
        text,
        at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.outbox.push(entry);
      this.messages.push(toPendingMessage(entry));
      return entry;
    }
    /**
     * 收到服务端消息：clientId 命中本地乐观消息时原位替换，
     * 否则追加到列表末尾。
     */
    receive(message) {
      let replaced = false;
      if (message.clientId) {
        const index = this.messages.findIndex((item) => item.clientId === message.clientId);
        if (index >= 0) {
          this.messages[index] = message;
          replaced = true;
          this.outbox = this.outbox.filter((entry) => entry.clientId !== message.clientId);
        } else {
          this.messages.push(message);
        }
      } else {
        this.messages.push(message);
      }
      return { replaced, fromAgent: message.role === "agent" };
    }
    markRead() {
      this.unread = 0;
      if (this.conversation) this.conversation.unreadForVisitor = 0;
    }
    incrementUnread() {
      this.unread += 1;
    }
    reset() {
      this.conversation = null;
      this.messages = [];
      this.unread = 0;
    }
    /** 断线期间积压的消息在连接恢复后按原 clientId 重发。 */
    flush(send) {
      this.outbox.forEach((entry) => {
        send(entry);
      });
    }
  };

  // src/transport.ts
  var VisitorTransport = class {
    constructor(wsUrl, handlers) {
      this.wsUrl = wsUrl;
      this.handlers = handlers;
      this.socket = null;
      this.reconnectTimer = null;
      this.attempt = 0;
      this.disposed = false;
    }
    connect() {
      if (this.disposed) return;
      const current = this.socket;
      if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
        return;
      }
      this.clearReconnect();
      this.handlers.onConnecting();
      let socket;
      try {
        socket = new WebSocket(this.wsUrl);
      } catch {
        this.scheduleReconnect();
        return;
      }
      this.socket = socket;
      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        this.attempt = 0;
        this.handlers.onOpen();
      });
      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        let raw;
        try {
          raw = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!raw || typeof raw !== "object") return;
        const record = raw;
        this.handlers.onEvent({
          ...record,
          type: String(record.type || ""),
          errorMessage: typeof record.message === "string" ? record.message : void 0
        });
      });
      socket.addEventListener("close", () => {
        if (this.socket !== socket || this.disposed) return;
        this.handlers.onClose();
        this.scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        try {
          socket.close();
        } catch {
        }
      });
    }
    send(payload) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(payload));
        return true;
      }
      return false;
    }
    destroy() {
      this.disposed = true;
      this.clearReconnect();
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        try {
          socket.close(1e3, "Widget destroyed");
        } catch {
        }
      }
    }
    scheduleReconnect() {
      if (this.disposed) return;
      this.clearReconnect();
      this.attempt += 1;
      const delay = Math.min(1e3 * Math.pow(1.6, this.attempt - 1), 12e3);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
    clearReconnect() {
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }
  };

  // src/styles.css
  var styles_default = '  :host { all: initial; }\n  * { box-sizing: border-box; }\n\n  .sg-root {\n    --sg-accent: __SG_ACCENT__;\n    --sg-accent-dark: color-mix(in srgb, var(--sg-accent) 82%, #000);\n    --sg-ink: #29241f;\n    --sg-muted: #8b8177;\n    --sg-paper: #fffcf8;\n    --sg-canvas: #f7f2ea;\n    --sg-border: rgba(65, 52, 40, 0.12);\n    --sg-shadow: 0 24px 70px rgba(45, 34, 24, 0.22), 0 4px 18px rgba(45, 34, 24, 0.1);\n    position: absolute;\n    inset: 0;\n    pointer-events: none;\n    color: var(--sg-ink);\n    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",\n      "Microsoft YaHei", sans-serif;\n    font-size: 14px;\n    line-height: 1.5;\n    -webkit-font-smoothing: antialiased;\n  }\n\n  .sg-root[data-position="left"] { --sg-side: 22px; --sg-align: left; }\n  .sg-root[data-position="right"] { --sg-side: 22px; --sg-align: right; }\n\n  button { font: inherit; color: inherit; }\n\n  /* ----------------------------- Launcher ----------------------------- */\n\n  .sg-launcher {\n    position: absolute;\n    bottom: 22px;\n    right: var(--sg-side);\n    width: 58px;\n    height: 58px;\n    border: 0;\n    border-radius: 19px;\n    background: linear-gradient(145deg, color-mix(in srgb, var(--sg-accent) 92%, #fff), var(--sg-accent));\n    color: #fff8f2;\n    cursor: pointer;\n    pointer-events: auto;\n    display: grid;\n    place-items: center;\n    box-shadow: 0 10px 28px color-mix(in srgb, var(--sg-accent) 38%, transparent),\n      0 2px 8px rgba(41, 36, 31, 0.18);\n    transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.22s ease;\n    -webkit-tap-highlight-color: transparent;\n  }\n  .sg-root[data-position="left"] .sg-launcher { left: var(--sg-side); right: auto; }\n  .sg-launcher:hover { transform: translateY(-3px) scale(1.03); box-shadow: 0 16px 34px color-mix(in srgb, var(--sg-accent) 42%, transparent); }\n  .sg-launcher:active { transform: scale(0.96); }\n  .sg-launcher:focus-visible { outline: 3px solid color-mix(in srgb, var(--sg-accent) 45%, #fff); outline-offset: 3px; }\n\n  .sg-launcher-icon {\n    position: absolute;\n    display: grid;\n    place-items: center;\n    transition: opacity 0.18s ease, transform 0.25s ease;\n  }\n  .sg-launcher-icon svg { width: 27px; height: 27px; }\n  .sg-launcher .icon-close { opacity: 0; transform: rotate(-45deg) scale(0.7); }\n  .sg-root[data-open="true"] .sg-launcher .icon-chat { opacity: 0; transform: rotate(45deg) scale(0.7); }\n  .sg-root[data-open="true"] .sg-launcher .icon-close { opacity: 1; transform: rotate(0) scale(1); }\n\n  .sg-badge {\n    position: absolute;\n    top: -4px;\n    right: -4px;\n    min-width: 20px;\n    height: 20px;\n    padding: 0 6px;\n    border-radius: 999px;\n    background: #fff;\n    color: var(--sg-accent);\n    border: 2px solid var(--sg-accent);\n    font-size: 11px;\n    font-weight: 700;\n    line-height: 16px;\n    text-align: center;\n    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);\n  }\n  .sg-badge[hidden] { display: none; }\n\n  .sg-nudge {\n    position: absolute;\n    bottom: 91px;\n    right: calc(var(--sg-side) + 2px);\n    max-width: 240px;\n    padding: 10px 12px 10px 14px;\n    border-radius: 14px 14px 4px 14px;\n    background: #fffdf9;\n    color: #41362b;\n    font-size: 13px;\n    line-height: 1.45;\n    box-shadow: 0 10px 30px rgba(45, 34, 24, 0.16);\n    border: 1px solid var(--sg-border);\n    pointer-events: auto;\n    opacity: 0;\n    transform: translateY(8px) scale(0.96);\n    transform-origin: bottom right;\n    transition: opacity 0.3s ease, transform 0.3s ease;\n    visibility: hidden;\n  }\n  .sg-root[data-position="left"] .sg-nudge {\n    left: calc(var(--sg-side) + 2px);\n    right: auto;\n    border-radius: 14px 14px 14px 4px;\n    transform-origin: bottom left;\n  }\n  .sg-nudge.is-visible { opacity: 1; transform: none; visibility: visible; }\n  .sg-root[data-open="true"] .sg-nudge { display: none; }\n  .sg-nudge-text { margin-right: 18px; }\n  .sg-nudge-close {\n    position: absolute;\n    top: 4px;\n    right: 4px;\n    width: 22px;\n    height: 22px;\n    padding: 0;\n    border: 0;\n    background: transparent;\n    color: #a29689;\n    cursor: pointer;\n    border-radius: 6px;\n    display: grid;\n    place-items: center;\n  }\n  .sg-nudge-close:hover { background: rgba(65, 52, 40, 0.06); color: #5d5145; }\n  .sg-nudge-close svg { width: 12px; height: 12px; }\n\n  /* ------------------------------ Panel ------------------------------- */\n\n  .sg-panel {\n    position: absolute;\n    bottom: 92px;\n    right: var(--sg-side);\n    width: 382px;\n    height: min(620px, calc(100dvh - 124px));\n    border-radius: 22px;\n    background: var(--sg-paper);\n    box-shadow: var(--sg-shadow);\n    border: 1px solid rgba(65, 52, 40, 0.1);\n    overflow: hidden;\n    display: flex;\n    flex-direction: column;\n    pointer-events: auto;\n    opacity: 0;\n    visibility: hidden;\n    transform: translateY(14px) scale(0.975);\n    transform-origin: bottom right;\n    transition: opacity 0.22s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0.25s;\n  }\n  .sg-root[data-position="left"] .sg-panel {\n    left: var(--sg-side);\n    right: auto;\n    transform-origin: bottom left;\n  }\n  .sg-root[data-open="true"] .sg-panel {\n    opacity: 1;\n    visibility: visible;\n    transform: none;\n  }\n\n  /* Header */\n  .sg-header {\n    position: relative;\n    flex: none;\n    padding: 18px 18px 16px;\n    color: #fbf6ef;\n    background:\n      radial-gradient(120% 180% at 100% 0%, color-mix(in srgb, var(--sg-accent) 55%, transparent) 0%, transparent 55%),\n      linear-gradient(140deg, #332a22 0%, #241e19 100%);\n  }\n  .sg-header::after {\n    content: "";\n    position: absolute;\n    inset: 0;\n    background-image: radial-gradient(rgba(255, 255, 255, 0.13) 0.7px, transparent 0.7px);\n    background-size: 9px 9px;\n    opacity: 0.22;\n    pointer-events: none;\n  }\n  .sg-header-inner { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; }\n  .sg-avatar {\n    position: relative;\n    flex: none;\n    width: 42px;\n    height: 42px;\n    border-radius: 14px;\n    display: grid;\n    place-items: center;\n    background: linear-gradient(145deg, #fff7ec, #f1e2ce);\n    color: #8d3e20;\n    font-family: "Songti SC", "STSong", Georgia, serif;\n    font-size: 22px;\n    font-weight: 700;\n    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28), 0 5px 14px rgba(0, 0, 0, 0.22);\n  }\n  .sg-avatar::after {\n    content: "";\n    position: absolute;\n    right: -1px;\n    bottom: -1px;\n    width: 11px;\n    height: 11px;\n    border-radius: 50%;\n    background: #b6b0a7;\n    border: 2px solid #2b231d;\n    transition: background 0.2s;\n  }\n  .sg-avatar.is-online::after { background: #6fb888; }\n  .sg-heading { min-width: 0; flex: 1; }\n  .sg-title {\n    margin: 0;\n    font-size: 15px;\n    font-weight: 650;\n    letter-spacing: 0.01em;\n    line-height: 1.35;\n    white-space: nowrap;\n    overflow: hidden;\n    text-overflow: ellipsis;\n  }\n  .sg-status {\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    margin: 3px 0 0;\n    font-size: 11.5px;\n    line-height: 1.4;\n    color: rgba(251, 246, 239, 0.66);\n    white-space: nowrap;\n    overflow: hidden;\n    text-overflow: ellipsis;\n  }\n  .sg-status-dot {\n    flex: none;\n    width: 6px;\n    height: 6px;\n    border-radius: 50%;\n    background: #b0a79d;\n    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);\n    transition: background 0.2s;\n  }\n  .sg-status-dot.is-online { background: #7ec596; }\n\n  .sg-header-actions { display: flex; align-items: center; gap: 2px; }\n  .sg-icon-btn {\n    flex: none;\n    width: 30px;\n    height: 30px;\n    border: 0;\n    border-radius: 9px;\n    background: transparent;\n    color: rgba(251, 246, 239, 0.62);\n    cursor: pointer;\n    display: grid;\n    place-items: center;\n    transition: background 0.15s, color 0.15s;\n  }\n  .sg-icon-btn:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }\n  .sg-icon-btn:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.55); outline-offset: 1px; }\n  .sg-icon-btn svg { width: 16px; height: 16px; }\n\n  /* Messages */\n  .sg-body {\n    position: relative;\n    flex: 1;\n    min-height: 0;\n    overflow-y: auto;\n    overscroll-behavior: contain;\n    padding: 20px 16px 12px;\n    background:\n      radial-gradient(90% 60% at 50% 0%, rgba(255, 255, 255, 0.8), transparent 70%),\n      var(--sg-canvas);\n    scrollbar-width: thin;\n    scrollbar-color: rgba(64, 51, 38, 0.18) transparent;\n  }\n  .sg-body::-webkit-scrollbar { width: 6px; }\n  .sg-body::-webkit-scrollbar-thumb { background: rgba(64, 51, 38, 0.18); border-radius: 99px; }\n  .sg-body::-webkit-scrollbar-track { background: transparent; }\n\n  .sg-welcome {\n    padding: 6px 4px 16px;\n    animation: sg-fade-up 0.4s ease both;\n  }\n  .sg-welcome-eyebrow {\n    display: inline-flex;\n    align-items: center;\n    gap: 6px;\n    margin-bottom: 12px;\n    padding: 4px 9px;\n    border-radius: 999px;\n    background: rgba(255, 255, 255, 0.7);\n    border: 1px solid var(--sg-border);\n    color: var(--sg-muted);\n    font-size: 10.5px;\n    letter-spacing: 0.03em;\n  }\n  .sg-welcome-eyebrow .pulse {\n    width: 5px;\n    height: 5px;\n    border-radius: 50%;\n    background: var(--sg-accent);\n  }\n  .sg-welcome h3 {\n    margin: 0 0 7px;\n    font-family: "Songti SC", "STSong", Georgia, serif;\n    font-size: 22px;\n    font-weight: 700;\n    letter-spacing: 0.01em;\n    line-height: 1.35;\n    color: #2e251d;\n  }\n  .sg-welcome p {\n    margin: 0;\n    max-width: 290px;\n    color: #786b5e;\n    font-size: 13px;\n    line-height: 1.65;\n  }\n  .sg-prompts {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 7px;\n    margin-top: 16px;\n  }\n  .sg-prompt {\n    padding: 7px 11px;\n    border-radius: 10px;\n    border: 1px solid rgba(65, 52, 40, 0.14);\n    background: rgba(255, 253, 249, 0.9);\n    color: #635444;\n    font-size: 12px;\n    line-height: 1.4;\n    cursor: pointer;\n    text-align: left;\n    transition: border-color 0.15s, background 0.15s, transform 0.15s;\n  }\n  .sg-prompt:hover {\n    border-color: color-mix(in srgb, var(--sg-accent) 45%, transparent);\n    background: #fff;\n    color: var(--sg-accent);\n    transform: translateY(-1px);\n  }\n  .sg-prompt:focus-visible { outline: 2px solid color-mix(in srgb, var(--sg-accent) 40%, #fff); }\n\n  .sg-list { display: flex; flex-direction: column; gap: 3px; }\n\n  .sg-day {\n    display: flex;\n    align-items: center;\n    gap: 10px;\n    margin: 14px 6px 12px;\n    color: #a29586;\n    font-size: 10.5px;\n    letter-spacing: 0.04em;\n  }\n  .sg-day::before, .sg-day::after {\n    content: "";\n    flex: 1;\n    height: 1px;\n    background: rgba(65, 52, 40, 0.09);\n  }\n\n  .sg-msg {\n    display: flex;\n    align-items: flex-end;\n    gap: 7px;\n    margin: 2px 0;\n    animation: sg-fade-up 0.24s ease both;\n  }\n  .sg-msg.agent { justify-content: flex-start; padding-right: 40px; }\n  .sg-msg.visitor { justify-content: flex-end; padding-left: 46px; }\n  .sg-msg-avatar {\n    flex: none;\n    width: 26px;\n    height: 26px;\n    margin-bottom: 4px;\n    border-radius: 9px;\n    display: grid;\n    place-items: center;\n    background: #2f2821;\n    color: #f3e9da;\n    font-family: "Songti SC", "STSong", Georgia, serif;\n    font-size: 13px;\n    font-weight: 700;\n    box-shadow: 0 2px 6px rgba(41, 36, 31, 0.14);\n  }\n  .sg-msg-stack { min-width: 0; max-width: 100%; }\n\n  .sg-bubble {\n    position: relative;\n    width: fit-content;\n    max-width: 100%;\n    padding: 9px 12px;\n    border-radius: 14px;\n    font-size: 13.5px;\n    line-height: 1.6;\n    white-space: pre-wrap;\n    word-break: break-word;\n    overflow-wrap: anywhere;\n  }\n  .sg-msg.agent .sg-bubble {\n    background: #fffdf9;\n    color: #3c332b;\n    border: 1px solid rgba(65, 52, 40, 0.09);\n    border-bottom-left-radius: 5px;\n    box-shadow: 0 2px 8px rgba(65, 52, 40, 0.045);\n  }\n  .sg-msg.visitor .sg-bubble {\n    margin-left: auto;\n    background: var(--sg-accent);\n    color: #fff9f3;\n    border-bottom-right-radius: 5px;\n    box-shadow: 0 4px 12px color-mix(in srgb, var(--sg-accent) 20%, transparent);\n  }\n  .sg-msg.visitor .sg-bubble.is-pending { opacity: 0.66; }\n  .sg-msg.visitor .sg-bubble.is-failed {\n    background: #8e3b35;\n    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);\n  }\n  .sg-msg-meta {\n    display: flex;\n    align-items: center;\n    gap: 5px;\n    margin: 3px 3px 0;\n    color: #a29586;\n    font-size: 9.5px;\n    letter-spacing: 0.02em;\n    opacity: 0;\n    transition: opacity 0.15s;\n  }\n  .sg-msg:hover .sg-msg-meta, .sg-msg:focus-within .sg-msg-meta { opacity: 1; }\n  .sg-msg.visitor .sg-msg-meta { justify-content: flex-end; }\n  .sg-msg-meta.is-failed { color: #a34741; opacity: 1; }\n\n  .sg-system {\n    align-self: center;\n    max-width: 86%;\n    margin: 8px auto;\n    padding: 4px 10px;\n    border-radius: 999px;\n    background: rgba(255, 253, 249, 0.7);\n    border: 1px solid rgba(65, 52, 40, 0.09);\n    color: #998c7e;\n    font-size: 10.5px;\n    line-height: 1.5;\n    text-align: center;\n  }\n\n  .sg-typing {\n    display: flex;\n    align-items: center;\n    gap: 7px;\n    margin: 8px 2px 0;\n    color: #948678;\n    font-size: 11px;\n    animation: sg-fade-up 0.2s ease both;\n  }\n  .sg-typing[hidden] { display: none; }\n  .sg-typing-dots {\n    display: inline-flex;\n    align-items: center;\n    gap: 3px;\n    padding: 7px 10px;\n    border-radius: 12px 12px 12px 4px;\n    background: #fffdf9;\n    border: 1px solid rgba(65, 52, 40, 0.09);\n  }\n  .sg-typing-dots i {\n    width: 4px;\n    height: 4px;\n    border-radius: 50%;\n    background: #b2a596;\n    animation: sg-bounce 1.1s infinite ease-in-out;\n  }\n  .sg-typing-dots i:nth-child(2) { animation-delay: 0.12s; }\n  .sg-typing-dots i:nth-child(3) { animation-delay: 0.24s; }\n\n  .sg-notice {\n    margin: 8px 4px 2px;\n    padding: 7px 10px;\n    border-radius: 8px;\n    background: #fff1e9;\n    border: 1px solid rgba(180, 85, 45, 0.18);\n    color: #9a4b2b;\n    font-size: 11px;\n    line-height: 1.5;\n  }\n  .sg-notice[hidden] { display: none; }\n\n  /* Composer */\n  .sg-compose-wrap {\n    flex: none;\n    padding: 10px 14px 0;\n    background: var(--sg-paper);\n    border-top: 1px solid rgba(65, 52, 40, 0.08);\n  }\n  .sg-compose {\n    display: flex;\n    align-items: flex-end;\n    gap: 8px;\n    padding: 7px 7px 7px 13px;\n    border: 1px solid rgba(65, 52, 40, 0.13);\n    border-radius: 15px;\n    background: #fff;\n    transition: border-color 0.15s, box-shadow 0.15s;\n  }\n  .sg-compose:focus-within {\n    border-color: color-mix(in srgb, var(--sg-accent) 52%, transparent);\n    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sg-accent) 10%, transparent);\n  }\n  .sg-input {\n    flex: 1;\n    min-width: 0;\n    min-height: 24px;\n    max-height: 96px;\n    padding: 4px 0 2px;\n    border: 0;\n    outline: 0;\n    resize: none;\n    background: transparent;\n    color: #332b24;\n    font-family: inherit;\n    font-size: 13.5px;\n    line-height: 1.5;\n    scrollbar-width: thin;\n  }\n  .sg-input::placeholder { color: #b1a599; }\n  .sg-input:disabled { opacity: 0.6; }\n  .sg-send {\n    flex: none;\n    width: 36px;\n    height: 36px;\n    border: 0;\n    border-radius: 11px;\n    background: var(--sg-accent);\n    color: #fff9f2;\n    cursor: pointer;\n    display: grid;\n    place-items: center;\n    transition: background 0.15s, transform 0.15s, opacity 0.15s;\n  }\n  .sg-send:hover { background: var(--sg-accent-dark); }\n  .sg-send:active { transform: scale(0.94); }\n  .sg-send:disabled { opacity: 0.35; cursor: not-allowed; }\n  .sg-send svg { width: 17px; height: 17px; }\n  .sg-send:focus-visible { outline: 2px solid color-mix(in srgb, var(--sg-accent) 40%, #fff); outline-offset: 2px; }\n\n  .sg-footer {\n    flex: none;\n    padding: 7px 14px 10px;\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    gap: 8px;\n    background: var(--sg-paper);\n    color: #b3a799;\n    font-size: 9.5px;\n    letter-spacing: 0.01em;\n  }\n  .sg-footer-left { display: flex; align-items: center; gap: 5px; }\n  .sg-footer-dot {\n    width: 5px;\n    height: 5px;\n    flex: none;\n    border-radius: 50%;\n    background: var(--sg-accent);\n    opacity: 0.7;\n  }\n  .sg-footer-char.is-limit { color: #b35738; }\n\n  @keyframes sg-fade-up {\n    from { opacity: 0; transform: translateY(6px); }\n    to { opacity: 1; transform: none; }\n  }\n  @keyframes sg-bounce {\n    0%, 60%, 100% { transform: translateY(0); opacity: 0.55; }\n    30% { transform: translateY(-3px); opacity: 1; }\n  }\n\n  @media (max-width: 520px) {\n    .sg-root { --sg-side: 14px; }\n    .sg-launcher { width: 54px; height: 54px; border-radius: 17px; bottom: 16px; }\n    .sg-panel {\n      right: 10px;\n      left: 10px;\n      bottom: 82px;\n      width: auto;\n      height: min(74dvh, calc(100dvh - 104px));\n      border-radius: 20px;\n    }\n    .sg-root[data-position="left"] .sg-panel { left: 10px; right: 10px; }\n    .sg-nudge { bottom: 82px; }\n    .sg-header { padding: 16px 16px 14px; }\n    .sg-welcome h3 { font-size: 21px; }\n  }\n\n  @media (prefers-reduced-motion: reduce) {\n    *, *::before, *::after {\n      animation-duration: 0.01ms !important;\n      transition-duration: 0.01ms !important;\n    }\n  }\n';

  // src/template.ts
  var SHELL_HTML = `
<div class="sg-root" data-position="{{POSITION}}" data-open="false" data-connected="false">
  <div class="sg-nudge" role="status">
    <div class="sg-nudge-text">有问题？在线问问我们</div>
    <button class="sg-nudge-close" type="button" aria-label="关闭提示">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  </div>

  <button class="sg-launcher" type="button" aria-label="打开在线客服" aria-expanded="false">
    <span class="sg-launcher-icon icon-chat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/>
      </svg>
    </span>
    <span class="sg-launcher-icon icon-close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
    </span>
    <span class="sg-badge" hidden>0</span>
  </button>

  <section class="sg-panel" role="dialog" aria-labelledby="sg-title" aria-describedby="sg-status">
    <header class="sg-header">
      <div class="sg-header-inner">
        <div class="sg-avatar" aria-hidden="true">拾</div>
        <div class="sg-heading">
          <h2 class="sg-title" id="sg-title"></h2>
          <p class="sg-status" id="sg-status">
            <span class="sg-status-dot"></span>
            <span class="sg-status-text">正在连接…</span>
          </p>
        </div>
        <div class="sg-header-actions">
          <button class="sg-icon-btn sg-minimize" type="button" title="收起对话" aria-label="收起对话">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </header>

    <div class="sg-body" role="log" aria-live="polite" aria-relevant="additions text">
      <div class="sg-welcome">
        <div class="sg-welcome-eyebrow"><span class="pulse"></span> 欢迎光临</div>
        <h3>你好呀，很高兴见到你</h3>
        <p>欢迎来到拾光咖啡。关于咖啡豆、冲煮方式或订单，都可以在这里问我们。</p>
        <div class="sg-prompts"></div>
      </div>
      <div class="sg-list"></div>
      <div class="sg-typing" hidden>
        <span class="sg-typing-dots"><i></i><i></i><i></i></span>
        <span class="sg-typing-text">客服正在输入…</span>
      </div>
      <div class="sg-notice" hidden role="alert"></div>
    </div>

    <div class="sg-compose-wrap">
      <form class="sg-compose">
        <textarea class="sg-input" id="sg-message-input" name="message" rows="1" maxlength="2000" placeholder="输入消息，按 Enter 发送…" aria-label="消息内容"></textarea>
        <button class="sg-send" type="submit" aria-label="发送消息" title="发送">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
          </svg>
        </button>
      </form>
    </div>
    <div class="sg-footer">
      <span class="sg-footer-left">
        <span class="sg-footer-dot" aria-hidden="true"></span>
        <span class="sg-footer-text">对话已加密保护</span>
      </span>
      <span class="sg-footer-char"></span>
    </div>
  </section>
</div>
`;

  // src/ui.ts
  function query(root, selector) {
    const element = root.querySelector(selector);
    if (!element) {
      throw new Error(`[ShiguangChat] 缺少模板元素: ${selector}`);
    }
    return element;
  }
  function mountShell(shadow, config) {
    const position = config.position === "left" ? "left" : "right";
    const styles = styles_default.replace("__SG_ACCENT__", escapeCss(config.accent));
    const markup = SHELL_HTML.replace("{{POSITION}}", position);
    shadow.innerHTML = `<style>${styles}</style>${markup}`;
  }
  var WidgetView = class {
    constructor(shadow, config) {
      this.typingTimer = null;
      this.noticeTimer = null;
      this.promptHandler = null;
      this.root = query(shadow, ".sg-root");
      this.launcher = query(shadow, ".sg-launcher");
      this.badge = query(shadow, ".sg-badge");
      this.titleEl = query(shadow, ".sg-title");
      this.avatarEl = query(shadow, ".sg-avatar");
      this.statusDot = query(shadow, ".sg-status-dot");
      this.statusText = query(shadow, ".sg-status-text");
      this.bodyEl = query(shadow, ".sg-body");
      this.welcomeEl = query(shadow, ".sg-welcome");
      this.welcomeCopy = query(shadow, ".sg-welcome p");
      this.promptsEl = query(shadow, ".sg-prompts");
      this.listEl = query(shadow, ".sg-list");
      this.typingEl = query(shadow, ".sg-typing");
      this.typingText = query(shadow, ".sg-typing-text");
      this.noticeEl = query(shadow, ".sg-notice");
      this.form = query(shadow, ".sg-compose");
      this.input = query(shadow, ".sg-input");
      this.minimizeBtn = query(shadow, ".sg-minimize");
      this.nudgeEl = query(shadow, ".sg-nudge");
      this.nudgeClose = query(shadow, ".sg-nudge-close");
      this.footerChar = query(shadow, ".sg-footer-char");
      this.footerText = query(shadow, ".sg-footer-text");
      this.titleEl.textContent = config.title;
      this.footerText.textContent = config.wsUrl.startsWith("wss:") ? "对话已加密保护" : "演示环境 · 实时对话";
      this.welcomeCopy.textContent = `欢迎来到${config.title.replace(
        / · 在线客服$/,
        ""
      )}。关于产品、服务或订单，都可以在这里问我们。`;
      this.renderPrompts(config.prompts);
    }
    bind(handlers) {
      this.promptHandler = handlers.onSend;
      this.launcher.addEventListener("click", () => handlers.onToggle());
      this.minimizeBtn.addEventListener("click", () => handlers.onMinimize());
      this.nudgeClose.addEventListener("click", () => handlers.onDismissNudge());
      this.form.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = this.input.value;
        this.input.value = "";
        this.autoGrow();
        this.updateCharCount();
        handlers.onSend(text);
      });
      this.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          this.form.requestSubmit();
        }
      });
      this.input.addEventListener("input", () => {
        this.autoGrow();
        this.updateCharCount();
        handlers.onTyping();
      });
    }
    setOpen(open, focus) {
      this.root.setAttribute("data-open", open ? "true" : "false");
      this.launcher.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        this.nudgeEl.classList.remove("is-visible");
        requestAnimationFrame(() => {
          this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
          if (!focus) return;
          setTimeout(() => {
            if (window.matchMedia("(min-width: 521px)").matches) this.input.focus();
          }, 220);
        });
      } else {
        this.launcher.focus({ preventScroll: true });
      }
    }
    setNudgeVisible(visible) {
      this.nudgeEl.classList.toggle("is-visible", visible);
    }
    renderBadge(unread) {
      if (unread > 0) {
        this.badge.hidden = false;
        this.badge.textContent = unread > 9 ? "9+" : String(unread);
        this.launcher.setAttribute("aria-label", `打开在线客服，${unread} 条未读消息`);
      } else {
        this.badge.hidden = true;
        this.launcher.setAttribute("aria-label", "打开在线客服");
      }
    }
    setConnection(connected, agentOnline) {
      this.root.setAttribute("data-connected", connected ? "true" : "false");
      const online = connected && agentOnline;
      this.statusDot.classList.toggle("is-online", online);
      this.avatarEl.classList.toggle("is-online", online);
      this.statusText.textContent = connected ? online ? "在线" : "离线" : "正在连接客服…";
    }
    renderMessages(messages, forceScroll) {
      const nearBottom = this.bodyEl.scrollHeight - this.bodyEl.scrollTop - this.bodyEl.clientHeight < 120;
      this.listEl.textContent = "";
      this.welcomeEl.hidden = messages.length > 0;
      let lastDay = "";
      messages.forEach((message) => {
        const day = dayLabel(message.at);
        if (day && day !== lastDay) {
          const divider = document.createElement("div");
          divider.className = "sg-day";
          divider.textContent = day;
          this.listEl.appendChild(divider);
          lastDay = day;
        }
        if (message.role === "system") {
          const system = document.createElement("div");
          system.className = "sg-system";
          system.textContent = message.text;
          this.listEl.appendChild(system);
          return;
        }
        const row = document.createElement("div");
        row.className = `sg-msg ${message.role === "agent" ? "agent" : "visitor"}`;
        if (message.role === "agent") {
          const avatar = document.createElement("div");
          avatar.className = "sg-msg-avatar";
          avatar.setAttribute("aria-hidden", "true");
          avatar.textContent = (message.authorName || "客").trim().slice(0, 1) || "客";
          row.appendChild(avatar);
        }
        const stack = document.createElement("div");
        stack.className = "sg-msg-stack";
        const bubble = document.createElement("div");
        bubble.className = "sg-bubble";
        if (message.pending) bubble.classList.add("is-pending");
        if (message.failed) bubble.classList.add("is-failed");
        bubble.textContent = message.text;
        stack.appendChild(bubble);
        const meta = document.createElement("div");
        meta.className = "sg-msg-meta";
        if (message.failed) meta.classList.add("is-failed");
        meta.textContent = message.failed ? "发送失败，请重试" : formatTime(message.at);
        stack.appendChild(meta);
        row.appendChild(stack);
        this.listEl.appendChild(row);
      });
      if (forceScroll || nearBottom) {
        requestAnimationFrame(() => {
          this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
        });
      }
    }
    showAgentTyping(active) {
      this.clearTypingTimer();
      if (active) {
        this.typingText.textContent = "客服正在输入…";
        this.typingEl.hidden = false;
        this.scrollToBottomIfNear();
        this.typingTimer = setTimeout(() => this.hideAgentTyping(), 4e3);
      } else {
        this.hideAgentTyping();
      }
    }
    hideAgentTyping() {
      this.clearTypingTimer();
      this.typingEl.hidden = true;
    }
    showNotice(text) {
      this.clearNotice();
      this.noticeEl.textContent = text;
      this.noticeEl.hidden = false;
      this.noticeTimer = setTimeout(() => this.clearNotice(), 5e3);
    }
    clearNotice() {
      if (this.noticeTimer !== null) {
        clearTimeout(this.noticeTimer);
        this.noticeTimer = null;
      }
      this.noticeEl.hidden = true;
    }
    destroy() {
      this.clearTypingTimer();
      this.clearNotice();
    }
    renderPrompts(prompts) {
      this.promptsEl.textContent = "";
      prompts.forEach((prompt) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sg-prompt";
        button.textContent = prompt;
        button.addEventListener("click", () => {
          var _a;
          (_a = this.promptHandler) == null ? void 0 : _a.call(this, prompt);
        });
        this.promptsEl.appendChild(button);
      });
    }
    autoGrow() {
      this.input.style.height = "auto";
      this.input.style.height = `${Math.min(this.input.scrollHeight, 96)}px`;
    }
    updateCharCount() {
      const length = this.input.value.length;
      this.footerChar.textContent = length > 1800 ? `${length} / 2000` : "";
      this.footerChar.classList.toggle("is-limit", length > 1800);
    }
    scrollToBottomIfNear() {
      if (this.bodyEl.scrollHeight - this.bodyEl.scrollTop - this.bodyEl.clientHeight < 160) {
        requestAnimationFrame(() => {
          this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
        });
      }
    }
    clearTypingTimer() {
      if (this.typingTimer !== null) {
        clearTimeout(this.typingTimer);
        this.typingTimer = null;
      }
    }
  };

  // src/widget.ts
  var NUDGE_KEY = "shiguang_chat_nudge";
  function sessionStorageSafe() {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
  var ChatWidget = class {
    constructor(config, options = {}) {
      this.session = new ChatSession();
      this.connected = false;
      this.agentOnline = false;
      this.panelOpen = false;
      this.hasOpened = false;
      this.openWhenVisible = false;
      this.typingSentAt = 0;
      this.typingStopTimer = null;
      this.nudgeTimers = [];
      this.destroyed = false;
      this.onKeydown = (event) => {
        if (event.key === "Escape" && this.panelOpen) this.setOpen(false);
      };
      this.onVisibilityChange = () => {
        if (document.visibilityState === "visible" && this.openWhenVisible) {
          this.openWhenVisible = false;
          this.setOpen(true, { focus: false });
        }
        if (!this.panelOpen) return;
        if (document.visibilityState === "visible") {
          this.markRead();
          this.transport.send({ type: "visitor:panel", open: true });
        } else {
          this.transport.send({ type: "visitor:panel", open: false });
        }
      };
      var _a;
      this.config = config;
      this.visitorId = ensureVisitorId(options.visitorId);
      this.container = (_a = options.container) != null ? _a : null;
      this.host = document.createElement("div");
      this.host.setAttribute("data-shiguang-chat", "");
      this.host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
      this.shadow = this.host.attachShadow({ mode: "open" });
      mountShell(this.shadow, config);
      this.view = new WidgetView(this.shadow, config);
      this.transport = new VisitorTransport(config.wsUrl, {
        onConnecting: () => this.view.setConnection(false, this.agentOnline),
        onOpen: () => this.sendHello(),
        onEvent: (event) => this.handleEvent(event),
        onClose: () => {
          this.connected = false;
          this.view.setConnection(false, this.agentOnline);
        }
      });
      this.view.bind({
        onToggle: () => this.setOpen(!this.panelOpen),
        onMinimize: () => this.setOpen(false),
        onDismissNudge: () => this.dismissNudge(),
        onSend: (text) => this.sendMessage(text),
        onTyping: () => this.sendTyping()
      });
      document.addEventListener("keydown", this.onKeydown);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.startNudge();
      this.mount();
    }
    /* ------------------------------ 对外 API ------------------------------ */
    open() {
      this.setOpen(true);
    }
    close() {
      this.setOpen(false);
    }
    toggle() {
      this.setOpen(!this.panelOpen);
    }
    isOpen() {
      return this.panelOpen;
    }
    ask(text) {
      this.setOpen(true);
      const value = String(text || "").trim().slice(0, 2e3);
      if (value) {
        setTimeout(() => this.sendMessage(value), 280);
      }
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      document.removeEventListener("keydown", this.onKeydown);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.nudgeTimers.forEach((timer) => clearTimeout(timer));
      this.nudgeTimers.length = 0;
      this.stopTyping();
      this.transport.destroy();
      this.view.destroy();
      this.host.remove();
    }
    /** 只包含嵌入页面需要的五个方法，挂到 window.ShiguangChat。 */
    get api() {
      return {
        open: () => this.open(),
        close: () => this.close(),
        toggle: () => this.toggle(),
        isOpen: () => this.isOpen(),
        ask: (text) => this.ask(text)
      };
    }
    /* ------------------------------ 生命周期 ------------------------------ */
    mount() {
      var _a;
      const target = (_a = this.container) != null ? _a : document.body;
      if (target) {
        target.appendChild(this.host);
        this.transport.connect();
        return;
      }
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (this.destroyed) return;
          document.body.appendChild(this.host);
          this.transport.connect();
        },
        { once: true }
      );
    }
    startNudge() {
      const storage = sessionStorageSafe();
      if (readStorage(storage, NUDGE_KEY)) return;
      this.nudgeTimers.push(
        setTimeout(() => {
          if (!this.panelOpen && !this.hasOpened) this.view.setNudgeVisible(true);
        }, 1800)
      );
      this.nudgeTimers.push(
        setTimeout(() => {
          this.view.setNudgeVisible(false);
          writeStorage(storage, NUDGE_KEY, "1");
        }, 11e3)
      );
    }
    dismissNudge() {
      this.view.setNudgeVisible(false);
      writeStorage(sessionStorageSafe(), NUDGE_KEY, "1");
    }
    /* ------------------------------ 连接与事件 ------------------------------ */
    sendHello() {
      this.transport.send({
        type: "visitor:hello",
        visitorId: this.visitorId,
        page: (window.location.host + window.location.pathname + window.location.search).slice(0, 300),
        open: this.isReading()
      });
    }
    handleEvent(event) {
      var _a;
      switch (event.type) {
        case "visitor:ready":
          this.connected = true;
          this.view.setConnection(true, this.agentOnline);
          this.session.applyConversation((_a = event.conversation) != null ? _a : null, this.panelOpen);
          this.view.renderBadge(this.session.unread);
          this.view.renderMessages(this.session.messages, true);
          if (this.isReading()) this.markRead();
          this.flushOutbox();
          break;
        case "agent:presence":
          this.agentOnline = event.online === true;
          this.view.setConnection(this.connected, this.agentOnline);
          break;
        case "message":
          if (event.message) this.handleMessage(event.message);
          break;
        case "conversation:update":
          if (event.conversation) {
            this.session.updateConversation(event.conversation, this.panelOpen);
            this.view.renderBadge(this.session.unread);
            this.view.setConnection(this.connected, this.agentOnline);
          }
          break;
        case "typing":
          if (event.from === "agent") this.view.showAgentTyping(event.active === true);
          break;
        case "error":
          this.view.showNotice(event.errorMessage || "消息发送失败，请稍后重试。");
          break;
        case "conversation:removed":
          this.session.reset();
          this.openWhenVisible = false;
          this.view.renderBadge(0);
          this.view.renderMessages(this.session.messages, false);
          break;
        default:
          break;
      }
    }
    handleMessage(message) {
      const { fromAgent } = this.session.receive(message);
      if (fromAgent) {
        this.view.hideAgentTyping();
        if (!this.isReading()) this.session.incrementUnread();
        this.revealForAgentMessage();
      }
      this.view.renderBadge(this.session.unread);
      this.view.renderMessages(this.session.messages, false);
      if (this.isReading() && fromAgent) this.markRead();
    }
    flushOutbox() {
      if (!this.connected) return;
      this.session.flush((entry) => {
        this.transport.send({
          type: "visitor:message",
          text: entry.text,
          clientId: entry.clientId
        });
        return true;
      });
    }
    /* ------------------------------ 发送 ------------------------------ */
    sendMessage(text) {
      if (this.destroyed) return;
      const cleaned = String(text || "").trim().slice(0, 2e3);
      if (!cleaned) return;
      const entry = this.session.queue(cleaned);
      this.view.renderMessages(this.session.messages, true);
      this.view.clearNotice();
      const sent = this.transport.send({
        type: "visitor:message",
        text: cleaned,
        clientId: entry.clientId
      });
      if (!sent) this.view.setConnection(this.connected, this.agentOnline);
      this.stopTyping();
    }
    sendTyping() {
      const now = Date.now();
      if (now - this.typingSentAt > 1200) {
        this.typingSentAt = now;
        this.transport.send({ type: "visitor:typing", active: true });
      }
      this.clearTypingStopTimer();
      this.typingStopTimer = setTimeout(() => this.stopTyping(), 1800);
    }
    stopTyping() {
      this.clearTypingStopTimer();
      if (this.typingSentAt) {
        this.transport.send({ type: "visitor:typing", active: false });
        this.typingSentAt = 0;
      }
    }
    clearTypingStopTimer() {
      if (this.typingStopTimer !== null) {
        clearTimeout(this.typingStopTimer);
        this.typingStopTimer = null;
      }
    }
    /* ------------------------------ 打开 / 已读 ------------------------------ */
    isReading() {
      return this.panelOpen && document.visibilityState !== "hidden";
    }
    // 收到客服消息时主动弹出窗口；页面在后台时先记住，等切回前台再弹，
    // 避免访客没看到消息就被标成已读。
    revealForAgentMessage() {
      if (!this.config.autoOpen || this.panelOpen) return;
      if (document.visibilityState !== "visible") {
        this.openWhenVisible = true;
        return;
      }
      this.setOpen(true, { focus: false });
    }
    setOpen(open, options) {
      this.panelOpen = open;
      if (open) {
        this.hasOpened = true;
        this.openWhenVisible = false;
      }
      this.view.setOpen(open, !options || options.focus !== false);
      if (open) {
        this.markRead();
        this.view.renderBadge(this.session.unread);
        this.transport.send({ type: "visitor:panel", open: this.isReading() });
      } else {
        this.stopTyping();
        this.transport.send({ type: "visitor:panel", open: false });
      }
    }
    markRead() {
      this.session.markRead();
      this.view.renderBadge(0);
      this.transport.send({ type: "visitor:read" });
    }
  };

  // src/index.ts
  if (!window.ShiguangChat) {
    const script = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
    const widget = new ChatWidget(configFromScript(script));
    window.ShiguangChat = widget.api;
  }
})();
