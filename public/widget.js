/*!
 * 拾光客服 · 可嵌入在线聊天组件
 * 用法：<script src="https://your-host/widget.js" defer></script>
 * 可选属性：data-title, data-subtitle, data-color, data-position, data-server, data-prompts
 */
(function () {
  'use strict';

  if (window.ShiguangChat) return;

  var scriptEl = document.currentScript;
  var scriptUrl = scriptEl && scriptEl.src ? new URL(scriptEl.src, window.location.href) : null;
  var scriptData = (scriptEl && scriptEl.dataset) || {};

  var serverOrigin = (scriptData.server || (scriptUrl ? scriptUrl.origin : window.location.origin)).replace(/\/+$/, '');
  var wsOrigin = serverOrigin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');

  var config = {
    title: scriptData.title || '拾光咖啡 · 在线客服',
    subtitle: scriptData.subtitle || '通常几分钟内回复',
    accent: scriptData.color || '#B4552D',
    position: scriptData.position === 'left' ? 'left' : 'right',
    prompts: (scriptData.prompts || '你好，我想咨询一下|帮我推荐一款产品|查询我的订单')
      .split('|')
      .map(function (item) { return item.trim(); })
      .filter(Boolean)
      .slice(0, 4),
    wsUrl: wsOrigin + '/ws',
  };

  // -------------------------------------------------------------------------
  // Visitor identity
  // -------------------------------------------------------------------------

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      try { return window.crypto.randomUUID(); } catch (_) { /* fall through */ }
    }
    var random = Math.random().toString(36).slice(2);
    return 'v-' + Date.now().toString(36) + '-' + random + random;
  }

  function readStorage(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }

  function writeStorage(storage, key, value) {
    try { storage.setItem(key, value); } catch (_) { /* storage may be disabled */ }
  }

  var VISITOR_KEY = 'shiguang_chat_visitor_id';
  var visitorId = readStorage(window.localStorage, VISITOR_KEY);
  if (!visitorId || !/^[a-zA-Z0-9-]{8,64}$/.test(visitorId)) {
    visitorId = makeId();
    writeStorage(window.localStorage, VISITOR_KEY, visitorId);
  }

  // -------------------------------------------------------------------------
  // Markup + styles (inside a shadow root, so the host page is isolated)
  // -------------------------------------------------------------------------

  var host = document.createElement('div');
  host.setAttribute('data-shiguang-chat', '');
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;';

  var shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }

  .sg-root {
    --sg-accent: ${escapeCss(config.accent)};
    --sg-accent-dark: color-mix(in srgb, var(--sg-accent) 82%, #000);
    --sg-ink: #29241f;
    --sg-muted: #8b8177;
    --sg-paper: #fffcf8;
    --sg-canvas: #f7f2ea;
    --sg-border: rgba(65, 52, 40, 0.12);
    --sg-shadow: 0 24px 70px rgba(45, 34, 24, 0.22), 0 4px 18px rgba(45, 34, 24, 0.1);
    position: absolute;
    inset: 0;
    pointer-events: none;
    color: var(--sg-ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
      "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .sg-root[data-position="left"] { --sg-side: 22px; --sg-align: left; }
  .sg-root[data-position="right"] { --sg-side: 22px; --sg-align: right; }

  button { font: inherit; color: inherit; }

  /* ----------------------------- Launcher ----------------------------- */

  .sg-launcher {
    position: absolute;
    bottom: 22px;
    right: var(--sg-side);
    width: 58px;
    height: 58px;
    border: 0;
    border-radius: 19px;
    background: linear-gradient(145deg, color-mix(in srgb, var(--sg-accent) 92%, #fff), var(--sg-accent));
    color: #fff8f2;
    cursor: pointer;
    pointer-events: auto;
    display: grid;
    place-items: center;
    box-shadow: 0 10px 28px color-mix(in srgb, var(--sg-accent) 38%, transparent),
      0 2px 8px rgba(41, 36, 31, 0.18);
    transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.22s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .sg-root[data-position="left"] .sg-launcher { left: var(--sg-side); right: auto; }
  .sg-launcher:hover { transform: translateY(-3px) scale(1.03); box-shadow: 0 16px 34px color-mix(in srgb, var(--sg-accent) 42%, transparent); }
  .sg-launcher:active { transform: scale(0.96); }
  .sg-launcher:focus-visible { outline: 3px solid color-mix(in srgb, var(--sg-accent) 45%, #fff); outline-offset: 3px; }

  .sg-launcher-icon {
    position: absolute;
    display: grid;
    place-items: center;
    transition: opacity 0.18s ease, transform 0.25s ease;
  }
  .sg-launcher-icon svg { width: 27px; height: 27px; }
  .sg-launcher .icon-close { opacity: 0; transform: rotate(-45deg) scale(0.7); }
  .sg-root[data-open="true"] .sg-launcher .icon-chat { opacity: 0; transform: rotate(45deg) scale(0.7); }
  .sg-root[data-open="true"] .sg-launcher .icon-close { opacity: 1; transform: rotate(0) scale(1); }

  .sg-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: #fff;
    color: var(--sg-accent);
    border: 2px solid var(--sg-accent);
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }
  .sg-badge[hidden] { display: none; }

  .sg-nudge {
    position: absolute;
    bottom: 91px;
    right: calc(var(--sg-side) + 2px);
    max-width: 240px;
    padding: 10px 12px 10px 14px;
    border-radius: 14px 14px 4px 14px;
    background: #fffdf9;
    color: #41362b;
    font-size: 13px;
    line-height: 1.45;
    box-shadow: 0 10px 30px rgba(45, 34, 24, 0.16);
    border: 1px solid var(--sg-border);
    pointer-events: auto;
    opacity: 0;
    transform: translateY(8px) scale(0.96);
    transform-origin: bottom right;
    transition: opacity 0.3s ease, transform 0.3s ease;
    visibility: hidden;
  }
  .sg-root[data-position="left"] .sg-nudge {
    left: calc(var(--sg-side) + 2px);
    right: auto;
    border-radius: 14px 14px 14px 4px;
    transform-origin: bottom left;
  }
  .sg-nudge.is-visible { opacity: 1; transform: none; visibility: visible; }
  .sg-root[data-open="true"] .sg-nudge { display: none; }
  .sg-nudge-text { margin-right: 18px; }
  .sg-nudge-close {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    color: #a29689;
    cursor: pointer;
    border-radius: 6px;
    display: grid;
    place-items: center;
  }
  .sg-nudge-close:hover { background: rgba(65, 52, 40, 0.06); color: #5d5145; }
  .sg-nudge-close svg { width: 12px; height: 12px; }

  /* ------------------------------ Panel ------------------------------- */

  .sg-panel {
    position: absolute;
    bottom: 92px;
    right: var(--sg-side);
    width: 382px;
    height: min(620px, calc(100dvh - 124px));
    border-radius: 22px;
    background: var(--sg-paper);
    box-shadow: var(--sg-shadow);
    border: 1px solid rgba(65, 52, 40, 0.1);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    opacity: 0;
    visibility: hidden;
    transform: translateY(14px) scale(0.975);
    transform-origin: bottom right;
    transition: opacity 0.22s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0.25s;
  }
  .sg-root[data-position="left"] .sg-panel {
    left: var(--sg-side);
    right: auto;
    transform-origin: bottom left;
  }
  .sg-root[data-open="true"] .sg-panel {
    opacity: 1;
    visibility: visible;
    transform: none;
  }

  /* Header */
  .sg-header {
    position: relative;
    flex: none;
    padding: 18px 18px 16px;
    color: #fbf6ef;
    background:
      radial-gradient(120% 180% at 100% 0%, color-mix(in srgb, var(--sg-accent) 55%, transparent) 0%, transparent 55%),
      linear-gradient(140deg, #332a22 0%, #241e19 100%);
  }
  .sg-header::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: radial-gradient(rgba(255, 255, 255, 0.13) 0.7px, transparent 0.7px);
    background-size: 9px 9px;
    opacity: 0.22;
    pointer-events: none;
  }
  .sg-header-inner { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; }
  .sg-avatar {
    position: relative;
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #fff7ec, #f1e2ce);
    color: #8d3e20;
    font-family: "Songti SC", "STSong", Georgia, serif;
    font-size: 22px;
    font-weight: 700;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28), 0 5px 14px rgba(0, 0, 0, 0.22);
  }
  .sg-avatar::after {
    content: "";
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #b6b0a7;
    border: 2px solid #2b231d;
    transition: background 0.2s;
  }
  .sg-avatar.is-online::after { background: #6fb888; }
  .sg-heading { min-width: 0; flex: 1; }
  .sg-title {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0.01em;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sg-status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: rgba(251, 246, 239, 0.66);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sg-status-dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #b0a79d;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);
    transition: background 0.2s;
  }
  .sg-status-dot.is-online { background: #7ec596; }

  .sg-header-actions { display: flex; align-items: center; gap: 2px; }
  .sg-icon-btn {
    flex: none;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: rgba(251, 246, 239, 0.62);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 0.15s, color 0.15s;
  }
  .sg-icon-btn:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }
  .sg-icon-btn:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.55); outline-offset: 1px; }
  .sg-icon-btn svg { width: 16px; height: 16px; }

  /* Messages */
  .sg-body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 20px 16px 12px;
    background:
      radial-gradient(90% 60% at 50% 0%, rgba(255, 255, 255, 0.8), transparent 70%),
      var(--sg-canvas);
    scrollbar-width: thin;
    scrollbar-color: rgba(64, 51, 38, 0.18) transparent;
  }
  .sg-body::-webkit-scrollbar { width: 6px; }
  .sg-body::-webkit-scrollbar-thumb { background: rgba(64, 51, 38, 0.18); border-radius: 99px; }
  .sg-body::-webkit-scrollbar-track { background: transparent; }

  .sg-welcome {
    padding: 6px 4px 16px;
    animation: sg-fade-up 0.4s ease both;
  }
  .sg-welcome-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.7);
    border: 1px solid var(--sg-border);
    color: var(--sg-muted);
    font-size: 10.5px;
    letter-spacing: 0.03em;
  }
  .sg-welcome-eyebrow .pulse {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--sg-accent);
  }
  .sg-welcome h3 {
    margin: 0 0 7px;
    font-family: "Songti SC", "STSong", Georgia, serif;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1.35;
    color: #2e251d;
  }
  .sg-welcome p {
    margin: 0;
    max-width: 290px;
    color: #786b5e;
    font-size: 13px;
    line-height: 1.65;
  }
  .sg-prompts {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 16px;
  }
  .sg-prompt {
    padding: 7px 11px;
    border-radius: 10px;
    border: 1px solid rgba(65, 52, 40, 0.14);
    background: rgba(255, 253, 249, 0.9);
    color: #635444;
    font-size: 12px;
    line-height: 1.4;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s, transform 0.15s;
  }
  .sg-prompt:hover {
    border-color: color-mix(in srgb, var(--sg-accent) 45%, transparent);
    background: #fff;
    color: var(--sg-accent);
    transform: translateY(-1px);
  }
  .sg-prompt:focus-visible { outline: 2px solid color-mix(in srgb, var(--sg-accent) 40%, #fff); }

  .sg-list { display: flex; flex-direction: column; gap: 3px; }

  .sg-day {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 14px 6px 12px;
    color: #a29586;
    font-size: 10.5px;
    letter-spacing: 0.04em;
  }
  .sg-day::before, .sg-day::after {
    content: "";
    flex: 1;
    height: 1px;
    background: rgba(65, 52, 40, 0.09);
  }

  .sg-msg {
    display: flex;
    align-items: flex-end;
    gap: 7px;
    margin: 2px 0;
    animation: sg-fade-up 0.24s ease both;
  }
  .sg-msg.agent { justify-content: flex-start; padding-right: 40px; }
  .sg-msg.visitor { justify-content: flex-end; padding-left: 46px; }
  .sg-msg-avatar {
    flex: none;
    width: 26px;
    height: 26px;
    margin-bottom: 4px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    background: #2f2821;
    color: #f3e9da;
    font-family: "Songti SC", "STSong", Georgia, serif;
    font-size: 13px;
    font-weight: 700;
    box-shadow: 0 2px 6px rgba(41, 36, 31, 0.14);
  }
  .sg-msg-stack { min-width: 0; max-width: 100%; }

  .sg-bubble {
    position: relative;
    width: fit-content;
    max-width: 100%;
    padding: 9px 12px;
    border-radius: 14px;
    font-size: 13.5px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .sg-msg.agent .sg-bubble {
    background: #fffdf9;
    color: #3c332b;
    border: 1px solid rgba(65, 52, 40, 0.09);
    border-bottom-left-radius: 5px;
    box-shadow: 0 2px 8px rgba(65, 52, 40, 0.045);
  }
  .sg-msg.visitor .sg-bubble {
    margin-left: auto;
    background: var(--sg-accent);
    color: #fff9f3;
    border-bottom-right-radius: 5px;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--sg-accent) 20%, transparent);
  }
  .sg-msg.visitor .sg-bubble.is-pending { opacity: 0.66; }
  .sg-msg.visitor .sg-bubble.is-failed {
    background: #8e3b35;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
  }
  .sg-msg-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 3px 3px 0;
    color: #a29586;
    font-size: 9.5px;
    letter-spacing: 0.02em;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .sg-msg:hover .sg-msg-meta, .sg-msg:focus-within .sg-msg-meta { opacity: 1; }
  .sg-msg.visitor .sg-msg-meta { justify-content: flex-end; }
  .sg-msg-meta.is-failed { color: #a34741; opacity: 1; }

  .sg-system {
    align-self: center;
    max-width: 86%;
    margin: 8px auto;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 253, 249, 0.7);
    border: 1px solid rgba(65, 52, 40, 0.09);
    color: #998c7e;
    font-size: 10.5px;
    line-height: 1.5;
    text-align: center;
  }

  .sg-typing {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 8px 2px 0;
    color: #948678;
    font-size: 11px;
    animation: sg-fade-up 0.2s ease both;
  }
  .sg-typing[hidden] { display: none; }
  .sg-typing-dots {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 7px 10px;
    border-radius: 12px 12px 12px 4px;
    background: #fffdf9;
    border: 1px solid rgba(65, 52, 40, 0.09);
  }
  .sg-typing-dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #b2a596;
    animation: sg-bounce 1.1s infinite ease-in-out;
  }
  .sg-typing-dots i:nth-child(2) { animation-delay: 0.12s; }
  .sg-typing-dots i:nth-child(3) { animation-delay: 0.24s; }

  .sg-closed {
    margin: 10px 4px 2px;
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-radius: 12px;
    background: rgba(255, 253, 249, 0.86);
    border: 1px dashed rgba(65, 52, 40, 0.17);
    color: #8b7e70;
    font-size: 11.5px;
    line-height: 1.5;
  }
  .sg-closed[hidden] { display: none; }
  .sg-closed span { flex: 1; }
  .sg-closed button {
    flex: none;
    padding: 5px 9px;
    border: 1px solid rgba(65, 52, 40, 0.15);
    border-radius: 8px;
    background: #fff;
    color: var(--sg-accent);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .sg-closed button:hover { border-color: var(--sg-accent); }

  .sg-notice {
    margin: 8px 4px 2px;
    padding: 7px 10px;
    border-radius: 8px;
    background: #fff1e9;
    border: 1px solid rgba(180, 85, 45, 0.18);
    color: #9a4b2b;
    font-size: 11px;
    line-height: 1.5;
  }
  .sg-notice[hidden] { display: none; }

  /* Composer */
  .sg-compose-wrap {
    flex: none;
    padding: 10px 14px 0;
    background: var(--sg-paper);
    border-top: 1px solid rgba(65, 52, 40, 0.08);
  }
  .sg-compose {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 7px 7px 7px 13px;
    border: 1px solid rgba(65, 52, 40, 0.13);
    border-radius: 15px;
    background: #fff;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .sg-compose:focus-within {
    border-color: color-mix(in srgb, var(--sg-accent) 52%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sg-accent) 10%, transparent);
  }
  .sg-input {
    flex: 1;
    min-width: 0;
    min-height: 24px;
    max-height: 96px;
    padding: 4px 0 2px;
    border: 0;
    outline: 0;
    resize: none;
    background: transparent;
    color: #332b24;
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.5;
    scrollbar-width: thin;
  }
  .sg-input::placeholder { color: #b1a599; }
  .sg-input:disabled { opacity: 0.6; }
  .sg-send {
    flex: none;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 11px;
    background: var(--sg-accent);
    color: #fff9f2;
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 0.15s, transform 0.15s, opacity 0.15s;
  }
  .sg-send:hover { background: var(--sg-accent-dark); }
  .sg-send:active { transform: scale(0.94); }
  .sg-send:disabled { opacity: 0.35; cursor: not-allowed; }
  .sg-send svg { width: 17px; height: 17px; }
  .sg-send:focus-visible { outline: 2px solid color-mix(in srgb, var(--sg-accent) 40%, #fff); outline-offset: 2px; }

  .sg-footer {
    flex: none;
    padding: 7px 14px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--sg-paper);
    color: #b3a799;
    font-size: 9.5px;
    letter-spacing: 0.01em;
  }
  .sg-footer-left { display: flex; align-items: center; gap: 5px; }
  .sg-footer-dot {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: 50%;
    background: var(--sg-accent);
    opacity: 0.7;
  }
  .sg-footer-char.is-limit { color: #b35738; }

  @keyframes sg-fade-up {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
  @keyframes sg-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.55; }
    30% { transform: translateY(-3px); opacity: 1; }
  }

  @media (max-width: 520px) {
    .sg-root { --sg-side: 14px; }
    .sg-launcher { width: 54px; height: 54px; border-radius: 17px; bottom: 16px; }
    .sg-panel {
      right: 10px;
      left: 10px;
      bottom: 82px;
      width: auto;
      height: min(74dvh, calc(100dvh - 104px));
      border-radius: 20px;
    }
    .sg-root[data-position="left"] .sg-panel { left: 10px; right: 10px; }
    .sg-nudge { bottom: 82px; }
    .sg-header { padding: 16px 16px 14px; }
    .sg-welcome h3 { font-size: 21px; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
</style>

<div class="sg-root" data-position="${config.position}" data-open="false" data-connected="false">
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
      <div class="sg-closed" hidden>
        <span>本次会话已结束，你仍可以发送消息继续咨询。</span>
        <button type="button" class="sg-reopen">再次咨询</button>
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

  function escapeCss(value) {
    // The value is used inside a CSS custom property; strip anything that
    // could break out of the declaration.
    return String(value || '').replace(/[;{}<>"'\\]/g, '').slice(0, 40) || '#B4552D';
  }

  // -------------------------------------------------------------------------
  // Element references
  // -------------------------------------------------------------------------

  var root = shadow.querySelector('.sg-root');
  var launcher = shadow.querySelector('.sg-launcher');
  var badge = shadow.querySelector('.sg-badge');
  var panel = shadow.querySelector('.sg-panel');
  var titleEl = shadow.querySelector('.sg-title');
  var avatarEl = shadow.querySelector('.sg-avatar');
  var statusDot = shadow.querySelector('.sg-status-dot');
  var statusText = shadow.querySelector('.sg-status-text');
  var bodyEl = shadow.querySelector('.sg-body');
  var welcomeEl = shadow.querySelector('.sg-welcome');
  var welcomeCopy = shadow.querySelector('.sg-welcome p');
  var promptsEl = shadow.querySelector('.sg-prompts');
  var listEl = shadow.querySelector('.sg-list');
  var typingEl = shadow.querySelector('.sg-typing');
  var typingText = shadow.querySelector('.sg-typing-text');
  var closedEl = shadow.querySelector('.sg-closed');
  var reopenBtn = shadow.querySelector('.sg-reopen');
  var noticeEl = shadow.querySelector('.sg-notice');
  var form = shadow.querySelector('.sg-compose');
  var input = shadow.querySelector('.sg-input');
  var sendBtn = shadow.querySelector('.sg-send');
  var minimizeBtn = shadow.querySelector('.sg-minimize');
  var nudgeEl = shadow.querySelector('.sg-nudge');
  var nudgeClose = shadow.querySelector('.sg-nudge-close');
  var footerChar = shadow.querySelector('.sg-footer-char');
  var footerText = shadow.querySelector('.sg-footer-text');

  titleEl.textContent = config.title;
  footerText.textContent = config.wsUrl.indexOf('wss:') === 0 ? '对话已加密保护' : '演示环境 · 实时对话';
  welcomeCopy.textContent = `欢迎来到${config.title.replace(/ · 在线客服$/, '')}。关于产品、服务或订单，都可以在这里问我们。`;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  var state = {
    conversation: null,
    messages: [],
    outbox: [],
    unread: 0,
    panelOpen: false,
    connected: false,
    agentOnline: false,
    agentNames: [],
    typingTimer: null,
    typingSentAt: 0,
    typingStopTimer: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    hasOpened: false,
    noticeTimer: null,
    socket: null,
  };

  config.prompts.forEach(function (prompt) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sg-prompt';
    button.textContent = prompt;
    button.addEventListener('click', function () {
      sendMessage(prompt);
    });
    promptsEl.appendChild(button);
  });

  // -------------------------------------------------------------------------
  // WebSocket connection
  // -------------------------------------------------------------------------

  function connect() {
    if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clearTimeout(state.reconnectTimer);
    setConnectionState('connecting');

    var socket;
    try {
      socket = new WebSocket(config.wsUrl);
    } catch (_) {
      scheduleReconnect();
      return;
    }
    state.socket = socket;

    socket.addEventListener('open', function () {
      state.reconnectAttempt = 0;
      sendRaw({
        type: 'visitor:hello',
        visitorId: visitorId,
        page: (window.location.host + window.location.pathname + window.location.search).slice(0, 300),
        open: isReading(),
      });
    });

    socket.addEventListener('message', function (event) {
      var payload;
      try { payload = JSON.parse(event.data); } catch (_) { return; }
      handleEvent(payload);
    });

    socket.addEventListener('close', function () {
      if (state.socket !== socket) return;
      state.connected = false;
      setConnectionState('offline');
      scheduleReconnect();
    });

    socket.addEventListener('error', function () {
      try { socket.close(); } catch (_) { /* ignore */ }
    });
  }

  function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectAttempt += 1;
    var delay = Math.min(1000 * Math.pow(1.6, state.reconnectAttempt - 1), 12000);
    state.reconnectTimer = setTimeout(connect, delay);
  }

  function sendRaw(payload) {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  function handleEvent(payload) {
    switch (payload.type) {
      case 'visitor:ready':
        state.connected = true;
        state.reconnectAttempt = 0;
        setConnectionState('online');
        applyConversation(payload.conversation);
        flushOutbox();
        break;

      case 'agent:presence':
        state.agentOnline = payload.online === true;
        state.agentNames = Array.isArray(payload.agents) ? payload.agents : [];
        renderStatus();
        break;

      case 'message':
        receiveMessage(payload.message);
        break;

      case 'conversation:update':
        if (payload.conversation) updateConversation(payload.conversation);
        break;

      case 'typing':
        if (payload.from === 'agent') showAgentTyping(payload.active, payload.name);
        break;

      case 'error':
        showNotice(payload.message || '消息发送失败，请稍后重试。');
        break;

      case 'conversation:removed':
        state.messages = [];
        renderMessages();
        break;

      default:
        break;
    }
  }

  function flushOutbox() {
    if (!state.connected) return;
    state.outbox.forEach(function (entry) {
      sendRaw({
        type: 'visitor:message',
        text: entry.text,
        clientId: entry.clientId,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Conversation and message rendering
  // -------------------------------------------------------------------------

  function applyConversation(conversation) {
    if (!conversation) return;
    state.conversation = conversation;
    var serverMessages = Array.isArray(conversation.messages) ? conversation.messages.slice() : [];

    // Reconcile local optimistic messages with the authoritative server state.
    state.outbox = state.outbox.filter(function (entry) {
      return !serverMessages.some(function (message) { return message.clientId === entry.clientId; });
    });

    state.messages = serverMessages.concat(
      state.outbox.map(function (entry) {
        return {
          id: 'local-' + entry.clientId,
          clientId: entry.clientId,
          role: 'visitor',
          text: entry.text,
          at: entry.at,
          pending: true,
        };
      })
    );

    state.unread = state.panelOpen ? 0 : conversation.unreadForVisitor || 0;
    updateBadge();
    renderMessages(true);
    updateClosedState();
    if (isReading()) markRead();
  }

  function updateConversation(conversation) {
    state.conversation = Object.assign({}, state.conversation, conversation);
    if (!state.panelOpen) {
      state.unread = Math.max(state.unread, conversation.unreadForVisitor || 0);
      updateBadge();
    }
    updateClosedState();
    renderStatus();
  }

  function receiveMessage(message) {
    if (!message) return;

    if (message.clientId) {
      var matched = false;
      for (var i = 0; i < state.messages.length; i += 1) {
        if (state.messages[i].clientId === message.clientId) {
          state.messages[i] = message;
          matched = true;
          break;
        }
      }
      if (matched) {
        state.outbox = state.outbox.filter(function (entry) { return entry.clientId !== message.clientId; });
      } else {
        state.messages.push(message);
      }
    } else {
      state.messages.push(message);
    }

    if (message.role === 'agent') {
      hideAgentTyping();
      if (!isReading()) {
        state.unread += 1;
        updateBadge();
      }
    }

    renderMessages(false);
    updateClosedState();
    if (isReading() && message.role === 'agent') markRead();
  }

  function renderMessages(forceScroll) {
    var nearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 120;
    listEl.textContent = '';

    var messages = state.messages;
    welcomeEl.hidden = messages.length > 0;

    var lastDay = '';
    messages.forEach(function (message) {
      var day = dayLabel(message.at);
      if (day && day !== lastDay) {
        var divider = document.createElement('div');
        divider.className = 'sg-day';
        divider.textContent = day;
        listEl.appendChild(divider);
        lastDay = day;
      }

      if (message.role === 'system') {
        var system = document.createElement('div');
        system.className = 'sg-system';
        system.textContent = message.text;
        listEl.appendChild(system);
        return;
      }

      var row = document.createElement('div');
      row.className = 'sg-msg ' + (message.role === 'agent' ? 'agent' : 'visitor');

      if (message.role === 'agent') {
        var av = document.createElement('div');
        av.className = 'sg-msg-avatar';
        av.setAttribute('aria-hidden', 'true');
        av.textContent = (message.authorName || '客').trim().slice(0, 1) || '客';
        row.appendChild(av);
      }

      var stack = document.createElement('div');
      stack.className = 'sg-msg-stack';

      var bubble = document.createElement('div');
      bubble.className = 'sg-bubble';
      if (message.pending) bubble.classList.add('is-pending');
      if (message.failed) bubble.classList.add('is-failed');
      bubble.textContent = message.text;
      stack.appendChild(bubble);

      var meta = document.createElement('div');
      meta.className = 'sg-msg-meta';
      if (message.failed) meta.classList.add('is-failed');
      meta.textContent = message.failed ? '发送失败，请重试' : formatTime(message.at);
      stack.appendChild(meta);

      row.appendChild(stack);
      listEl.appendChild(row);
    });

    if (forceScroll || nearBottom) {
      requestAnimationFrame(function () {
        bodyEl.scrollTop = bodyEl.scrollHeight;
      });
    }
  }

  function updateClosedState() {
    var closed = state.conversation && state.conversation.status === 'closed';
    closedEl.hidden = !closed;
    input.placeholder = closed
      ? '发送消息即可重新开始咨询…'
      : '输入消息，按 Enter 发送…';
  }

  function updateBadge() {
    if (state.unread > 0) {
      badge.hidden = false;
      badge.textContent = state.unread > 9 ? '9+' : String(state.unread);
      launcher.setAttribute('aria-label', `打开在线客服，${state.unread} 条未读消息`);
    } else {
      badge.hidden = true;
      launcher.setAttribute('aria-label', '打开在线客服');
    }
  }

  function renderStatus() {
    var online = state.connected && state.agentOnline;
    statusDot.classList.toggle('is-online', online);
    avatarEl.classList.toggle('is-online', online);

    if (!state.connected) {
      statusText.textContent = '正在连接客服…';
    } else if (online) {
      var name = state.agentNames[0];
      statusText.textContent = name ? `${name} 在线 · ${config.subtitle}` : config.subtitle;
    } else {
      statusText.textContent = '客服暂时离线 · 留言后会尽快回复';
    }
  }

  function showAgentTyping(active, name) {
    clearTimeout(state.typingTimer);
    if (active) {
      typingText.textContent = `${name || '客服'}正在输入…`;
      typingEl.hidden = false;
      scrollToBottomIfNear();
      state.typingTimer = setTimeout(hideAgentTyping, 4000);
    } else {
      hideAgentTyping();
    }
  }

  function hideAgentTyping() {
    clearTimeout(state.typingTimer);
    typingEl.hidden = true;
  }

  function scrollToBottomIfNear() {
    if (bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 160) {
      requestAnimationFrame(function () { bodyEl.scrollTop = bodyEl.scrollHeight; });
    }
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  function sendMessage(text) {
    var cleaned = String(text || '').trim().slice(0, 2000);
    if (!cleaned) return;

    var clientId = makeId();
    var entry = { clientId: clientId, text: cleaned, at: new Date().toISOString() };
    state.outbox.push(entry);
    state.messages.push({
      id: 'local-' + clientId,
      clientId: clientId,
      role: 'visitor',
      text: cleaned,
      at: entry.at,
      pending: true,
    });

    renderMessages(true);
    updateClosedState();
    clearNotice();

    if (!sendRaw({ type: 'visitor:message', text: cleaned, clientId: clientId })) {
      renderStatus();
    }

    stopTyping();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value;
    input.value = '';
    autoGrow();
    updateCharCount();
    sendMessage(text);
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  input.addEventListener('input', function () {
    autoGrow();
    updateCharCount();
    sendTyping();
  });

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  }

  function updateCharCount() {
    var length = input.value.length;
    footerChar.textContent = length > 1800 ? String(length) + ' / 2000' : '';
    footerChar.classList.toggle('is-limit', length > 1800);
  }

  // -------------------------------------------------------------------------
  // Typing indicator (visitor -> agent)
  // -------------------------------------------------------------------------

  function sendTyping() {
    var now = Date.now();
    if (now - state.typingSentAt > 1200) {
      state.typingSentAt = now;
      sendRaw({ type: 'visitor:typing', active: true });
    }
    clearTimeout(state.typingStopTimer);
    state.typingStopTimer = setTimeout(stopTyping, 1800);
  }

  function stopTyping() {
    clearTimeout(state.typingStopTimer);
    if (state.typingSentAt) {
      sendRaw({ type: 'visitor:typing', active: false });
      state.typingSentAt = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Open / close vs read state
  // -------------------------------------------------------------------------

  function isReading() {
    return state.panelOpen && document.visibilityState !== 'hidden';
  }

  function setOpen(open) {
    state.panelOpen = open;
    root.setAttribute('data-open', open ? 'true' : 'false');
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
      state.hasOpened = true;
      nudgeEl.classList.remove('is-visible');
      markRead();
      updateBadge();
      sendRaw({ type: 'visitor:panel', open: isReading() });
      requestAnimationFrame(function () {
        bodyEl.scrollTop = bodyEl.scrollHeight;
        setTimeout(function () {
          if (window.matchMedia('(min-width: 521px)').matches) input.focus();
        }, 220);
      });
    } else {
      stopTyping();
      sendRaw({ type: 'visitor:panel', open: false });
      launcher.focus({ preventScroll: true });
    }
  }

  function markRead() {
    state.unread = 0;
    updateBadge();
    sendRaw({ type: 'visitor:read' });
    if (state.conversation) state.conversation.unreadForVisitor = 0;
  }

  launcher.addEventListener('click', function () {
    setOpen(!state.panelOpen);
  });
  minimizeBtn.addEventListener('click', function () { setOpen(false); });
  reopenBtn.addEventListener('click', function () {
    input.focus();
    showNotice('发送一条消息，即可继续本次咨询。');
    setTimeout(clearNotice, 4000);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.panelOpen) setOpen(false);
  });

  document.addEventListener('visibilitychange', function () {
    if (!state.panelOpen) return;
    if (document.visibilityState === 'visible') {
      markRead();
      sendRaw({ type: 'visitor:panel', open: true });
    } else {
      sendRaw({ type: 'visitor:panel', open: false });
    }
  });

  // -------------------------------------------------------------------------
  // Nudge + notices
  // -------------------------------------------------------------------------

  nudgeClose.addEventListener('click', function () {
    nudgeEl.classList.remove('is-visible');
    writeStorage(window.sessionStorage, 'shiguang_chat_nudge', '1');
  });

  if (!readStorage(window.sessionStorage, 'shiguang_chat_nudge')) {
    setTimeout(function () {
      if (!state.panelOpen && !state.hasOpened) nudgeEl.classList.add('is-visible');
    }, 1800);
    setTimeout(function () {
      nudgeEl.classList.remove('is-visible');
      writeStorage(window.sessionStorage, 'shiguang_chat_nudge', '1');
    }, 11000);
  }

  function showNotice(text) {
    clearTimeout(state.noticeTimer);
    noticeEl.textContent = text;
    noticeEl.hidden = false;
    state.noticeTimer = setTimeout(clearNotice, 5000);
  }

  function clearNotice() {
    clearTimeout(state.noticeTimer);
    noticeEl.hidden = true;
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  function formatTime(value) {
    var date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    } catch (_) {
      return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
    }
  }

  function dayLabel(value) {
    var date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    var today = new Date();
    var startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((startOfToday - startOfDate) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    try {
      return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date);
    } catch (_) {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
  }

  function setConnectionState(connection) {
    root.setAttribute('data-connected', connection === 'online' ? 'true' : 'false');
    renderStatus();
  }

  function documentReady() {
    if (document.body) {
      document.body.appendChild(host);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(host);
      }, { once: true });
    }
    connect();
  }

  // Expose a tiny API for host pages (e.g. a "联系我们" button).
  window.ShiguangChat = {
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: function () { setOpen(!state.panelOpen); },
    isOpen: function () { return state.panelOpen; },
    ask: function (text) {
      setOpen(true);
      var value = String(text || '').trim().slice(0, 2000);
      if (value) {
        setTimeout(function () { sendMessage(value); }, 280);
      }
    },
  };

  documentReady();
})();
