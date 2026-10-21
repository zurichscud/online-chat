import { configFromOptions } from './config';
import { ensureVisitorId } from './identity';
import { ChatSession } from './session';
import { VisitorTransport } from './transport';
import type {
  ChatWidgetApi,
  ChatWidgetInstance,
  ServerEvent,
  WidgetConfig,
  WidgetOptions,
} from './types';
import { WidgetView, mountShell } from './ui';
import { readStorage, writeStorage } from './utils';

const NUDGE_KEY = 'shiguang_chat_nudge';

function sessionStorageSafe(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * 访客侧聊天组件：把会话状态、WebSocket 传输和 Shadow DOM 视图装配在一起。
 * 嵌入页面只通过 `window.ShiguangChat` 或 createChatWidget 返回的实例访问。
 */
export class ChatWidget implements ChatWidgetInstance {
  readonly visitorId: string;

  private readonly config: WidgetConfig;
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly view: WidgetView;
  private readonly session = new ChatSession();
  private readonly transport: VisitorTransport;
  private readonly container: HTMLElement | null;

  private connected = false;
  private agentOnline = false;
  private panelOpen = false;
  private hasOpened = false;
  private openWhenVisible = false;
  private typingSentAt = 0;
  private typingStopTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly nudgeTimers: Array<ReturnType<typeof setTimeout>> = [];
  private destroyed = false;

  constructor(config: WidgetConfig, options: Pick<WidgetOptions, 'visitorId' | 'container'> = {}) {
    this.config = config;
    this.visitorId = ensureVisitorId(options.visitorId);
    this.container = options.container ?? null;

    this.host = document.createElement('div');
    this.host.setAttribute('data-shiguang-chat', '');
    this.host.style.cssText =
      'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;';

    this.shadow = this.host.attachShadow({ mode: 'open' });
    mountShell(this.shadow, config);
    this.view = new WidgetView(this.shadow, config);

    this.transport = new VisitorTransport(config.wsUrl, {
      onConnecting: () => this.view.setConnection(false, this.agentOnline),
      onOpen: () => this.sendHello(),
      onEvent: (event) => this.handleEvent(event),
      onClose: () => {
        this.connected = false;
        this.view.setConnection(false, this.agentOnline);
      },
    });

    this.view.bind({
      onToggle: () => this.setOpen(!this.panelOpen),
      onMinimize: () => this.setOpen(false),
      onDismissNudge: () => this.dismissNudge(),
      onSend: (text) => this.sendMessage(text),
      onTyping: () => this.sendTyping(),
    });

    document.addEventListener('keydown', this.onKeydown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.startNudge();
    this.mount();
  }

  /* ------------------------------ 对外 API ------------------------------ */

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  toggle(): void {
    this.setOpen(!this.panelOpen);
  }

  isOpen(): boolean {
    return this.panelOpen;
  }

  ask(text: string): void {
    this.setOpen(true);
    const value = String(text || '').trim().slice(0, 2000);
    if (value) {
      setTimeout(() => this.sendMessage(value), 280);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    document.removeEventListener('keydown', this.onKeydown);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.nudgeTimers.forEach((timer) => clearTimeout(timer));
    this.nudgeTimers.length = 0;
    this.stopTyping();
    this.transport.destroy();
    this.view.destroy();
    this.host.remove();
  }

  /** 只包含嵌入页面需要的五个方法，挂到 window.ShiguangChat。 */
  get api(): ChatWidgetApi {
    return {
      open: () => this.open(),
      close: () => this.close(),
      toggle: () => this.toggle(),
      isOpen: () => this.isOpen(),
      ask: (text: string) => this.ask(text),
    };
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  private mount(): void {
    const target = this.container ?? document.body;
    if (target) {
      target.appendChild(this.host);
      this.transport.connect();
      return;
    }
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        if (this.destroyed) return;
        document.body.appendChild(this.host);
        this.transport.connect();
      },
      { once: true }
    );
  }

  private startNudge(): void {
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
        writeStorage(storage, NUDGE_KEY, '1');
      }, 11_000)
    );
  }

  private dismissNudge(): void {
    this.view.setNudgeVisible(false);
    writeStorage(sessionStorageSafe(), NUDGE_KEY, '1');
  }

  /* ------------------------------ 连接与事件 ------------------------------ */

  private sendHello(): void {
    this.transport.send({
      type: 'visitor:hello',
      visitorId: this.visitorId,
      page: (window.location.host + window.location.pathname + window.location.search).slice(0, 300),
      open: this.isReading(),
    });
  }

  private handleEvent(event: ServerEvent): void {
    switch (event.type) {
      case 'visitor:ready':
        this.connected = true;
        this.view.setConnection(true, this.agentOnline);
        this.session.applyConversation(event.conversation ?? null, this.panelOpen);
        this.view.renderBadge(this.session.unread);
        this.view.renderMessages(this.session.messages, true);
        if (this.isReading()) this.markRead();
        this.flushOutbox();
        break;

      case 'agent:presence':
        this.agentOnline = event.online === true;
        this.view.setConnection(this.connected, this.agentOnline);
        break;

      case 'message':
        if (event.message) this.handleMessage(event.message);
        break;

      case 'conversation:update':
        if (event.conversation) {
          this.session.updateConversation(event.conversation, this.panelOpen);
          this.view.renderBadge(this.session.unread);
          this.view.setConnection(this.connected, this.agentOnline);
        }
        break;

      case 'typing':
        if (event.from === 'agent') this.view.showAgentTyping(event.active === true);
        break;

      case 'error':
        this.view.showNotice(event.errorMessage || '消息发送失败，请稍后重试。');
        break;

      case 'conversation:removed':
        this.session.reset();
        this.openWhenVisible = false;
        this.view.renderBadge(0);
        this.view.renderMessages(this.session.messages, false);
        break;

      default:
        break;
    }
  }

  private handleMessage(message: NonNullable<ServerEvent['message']>): void {
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

  private flushOutbox(): void {
    if (!this.connected) return;
    this.session.flush((entry) => {
      this.transport.send({
        type: 'visitor:message',
        text: entry.text,
        clientId: entry.clientId,
      });
      return true;
    });
  }

  /* ------------------------------ 发送 ------------------------------ */

  private sendMessage(text: string): void {
    if (this.destroyed) return;
    const cleaned = String(text || '').trim().slice(0, 2000);
    if (!cleaned) return;

    const entry = this.session.queue(cleaned);
    this.view.renderMessages(this.session.messages, true);
    this.view.clearNotice();

    const sent = this.transport.send({
      type: 'visitor:message',
      text: cleaned,
      clientId: entry.clientId,
    });
    if (!sent) this.view.setConnection(this.connected, this.agentOnline);

    this.stopTyping();
  }

  private sendTyping(): void {
    const now = Date.now();
    if (now - this.typingSentAt > 1200) {
      this.typingSentAt = now;
      this.transport.send({ type: 'visitor:typing', active: true });
    }
    this.clearTypingStopTimer();
    this.typingStopTimer = setTimeout(() => this.stopTyping(), 1800);
  }

  private stopTyping(): void {
    this.clearTypingStopTimer();
    if (this.typingSentAt) {
      this.transport.send({ type: 'visitor:typing', active: false });
      this.typingSentAt = 0;
    }
  }

  private clearTypingStopTimer(): void {
    if (this.typingStopTimer !== null) {
      clearTimeout(this.typingStopTimer);
      this.typingStopTimer = null;
    }
  }

  /* ------------------------------ 打开 / 已读 ------------------------------ */

  private isReading(): boolean {
    return this.panelOpen && document.visibilityState !== 'hidden';
  }

  // 收到客服消息时主动弹出窗口；页面在后台时先记住，等切回前台再弹，
  // 避免访客没看到消息就被标成已读。
  private revealForAgentMessage(): void {
    if (!this.config.autoOpen || this.panelOpen) return;
    if (document.visibilityState !== 'visible') {
      this.openWhenVisible = true;
      return;
    }
    this.setOpen(true, { focus: false });
  }

  private setOpen(open: boolean, options?: { focus?: boolean }): void {
    this.panelOpen = open;
    if (open) {
      this.hasOpened = true;
      this.openWhenVisible = false;
    }
    this.view.setOpen(open, !options || options.focus !== false);

    if (open) {
      this.markRead();
      this.view.renderBadge(this.session.unread);
      this.transport.send({ type: 'visitor:panel', open: this.isReading() });
    } else {
      this.stopTyping();
      this.transport.send({ type: 'visitor:panel', open: false });
    }
  }

  private markRead(): void {
    this.session.markRead();
    this.view.renderBadge(0);
    this.transport.send({ type: 'visitor:read' });
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.panelOpen) this.setOpen(false);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && this.openWhenVisible) {
      this.openWhenVisible = false;
      this.setOpen(true, { focus: false });
    }
    if (!this.panelOpen) return;

    if (document.visibilityState === 'visible') {
      this.markRead();
      this.transport.send({ type: 'visitor:panel', open: true });
    } else {
      this.transport.send({ type: 'visitor:panel', open: false });
    }
  };
}

/** 编程式创建组件（ESM 入口使用）。 */
export function createChatWidget(options: WidgetOptions = {}): ChatWidget {
  return new ChatWidget(configFromOptions(options), {
    visitorId: options.visitorId,
    container: options.container,
  });
}
