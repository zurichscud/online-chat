import stylesText from './styles.css';
import { SHELL_HTML } from './template';
import type { ChatMessage, WidgetConfig } from './types';
import { dayLabel, escapeCss, formatTime } from './utils';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`[ShiguangChat] 缺少模板元素: ${selector}`);
  }
  return element;
}

/** 把样式和标记注入 shadow root；主题色先做 CSS 转义。 */
export function mountShell(shadow: ShadowRoot, config: WidgetConfig): void {
  const position = config.position === 'left' ? 'left' : 'right';
  const styles = stylesText.replace('__SG_ACCENT__', escapeCss(config.accent));
  const markup = SHELL_HTML.replace('{{POSITION}}', position);
  shadow.innerHTML = `<style>${styles}</style>${markup}`;
}

export interface ViewHandlers {
  onToggle(): void;
  onMinimize(): void;
  onDismissNudge(): void;
  onSend(text: string): void;
  onTyping(): void;
}

/**
 * 只关心 Shadow DOM 内部的元素、渲染和本地交互，
 * 业务状态与 WebSocket 生命周期由 ChatWidget 控制。
 */
export class WidgetView {
  private readonly root: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly avatarEl: HTMLElement;
  private readonly statusDot: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly welcomeEl: HTMLElement;
  private readonly welcomeCopy: HTMLElement;
  private readonly promptsEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly typingEl: HTMLElement;
  private readonly typingText: HTMLElement;
  private readonly noticeEl: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLTextAreaElement;
  private readonly minimizeBtn: HTMLButtonElement;
  private readonly nudgeEl: HTMLElement;
  private readonly nudgeClose: HTMLButtonElement;
  private readonly footerChar: HTMLElement;
  private readonly footerText: HTMLElement;

  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private promptHandler: ((text: string) => void) | null = null;

  constructor(shadow: ShadowRoot, config: WidgetConfig) {
    this.root = query<HTMLElement>(shadow, '.sg-root');
    this.launcher = query<HTMLButtonElement>(shadow, '.sg-launcher');
    this.badge = query<HTMLElement>(shadow, '.sg-badge');
    this.titleEl = query<HTMLElement>(shadow, '.sg-title');
    this.avatarEl = query<HTMLElement>(shadow, '.sg-avatar');
    this.statusDot = query<HTMLElement>(shadow, '.sg-status-dot');
    this.statusText = query<HTMLElement>(shadow, '.sg-status-text');
    this.bodyEl = query<HTMLElement>(shadow, '.sg-body');
    this.welcomeEl = query<HTMLElement>(shadow, '.sg-welcome');
    this.welcomeCopy = query<HTMLElement>(shadow, '.sg-welcome p');
    this.promptsEl = query<HTMLElement>(shadow, '.sg-prompts');
    this.listEl = query<HTMLElement>(shadow, '.sg-list');
    this.typingEl = query<HTMLElement>(shadow, '.sg-typing');
    this.typingText = query<HTMLElement>(shadow, '.sg-typing-text');
    this.noticeEl = query<HTMLElement>(shadow, '.sg-notice');
    this.form = query<HTMLFormElement>(shadow, '.sg-compose');
    this.input = query<HTMLTextAreaElement>(shadow, '.sg-input');
    this.minimizeBtn = query<HTMLButtonElement>(shadow, '.sg-minimize');
    this.nudgeEl = query<HTMLElement>(shadow, '.sg-nudge');
    this.nudgeClose = query<HTMLButtonElement>(shadow, '.sg-nudge-close');
    this.footerChar = query<HTMLElement>(shadow, '.sg-footer-char');
    this.footerText = query<HTMLElement>(shadow, '.sg-footer-text');

    this.titleEl.textContent = config.title;
    this.footerText.textContent = config.wsUrl.startsWith('wss:')
      ? '对话已加密保护'
      : '演示环境 · 实时对话';
    this.welcomeCopy.textContent = `欢迎来到${config.title.replace(
      / · 在线客服$/,
      ''
    )}。关于产品、服务或订单，都可以在这里问我们。`;
    this.renderPrompts(config.prompts);
  }

  bind(handlers: ViewHandlers): void {
    this.promptHandler = handlers.onSend;
    this.launcher.addEventListener('click', () => handlers.onToggle());
    this.minimizeBtn.addEventListener('click', () => handlers.onMinimize());
    this.nudgeClose.addEventListener('click', () => handlers.onDismissNudge());

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.input.value;
      this.input.value = '';
      this.autoGrow();
      this.updateCharCount();
      handlers.onSend(text);
    });

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.form.requestSubmit();
      }
    });

    this.input.addEventListener('input', () => {
      this.autoGrow();
      this.updateCharCount();
      handlers.onTyping();
    });
  }

  setOpen(open: boolean, focus: boolean): void {
    this.root.setAttribute('data-open', open ? 'true' : 'false');
    this.launcher.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
      this.nudgeEl.classList.remove('is-visible');
      requestAnimationFrame(() => {
        this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
        if (!focus) return;
        setTimeout(() => {
          if (window.matchMedia('(min-width: 521px)').matches) this.input.focus();
        }, 220);
      });
    } else {
      this.launcher.focus({ preventScroll: true });
    }
  }

  setNudgeVisible(visible: boolean): void {
    this.nudgeEl.classList.toggle('is-visible', visible);
  }

  renderBadge(unread: number): void {
    if (unread > 0) {
      this.badge.hidden = false;
      this.badge.textContent = unread > 9 ? '9+' : String(unread);
      this.launcher.setAttribute('aria-label', `打开在线客服，${unread} 条未读消息`);
    } else {
      this.badge.hidden = true;
      this.launcher.setAttribute('aria-label', '打开在线客服');
    }
  }

  setConnection(connected: boolean, agentOnline: boolean): void {
    this.root.setAttribute('data-connected', connected ? 'true' : 'false');

    const online = connected && agentOnline;
    this.statusDot.classList.toggle('is-online', online);
    this.avatarEl.classList.toggle('is-online', online);
    this.statusText.textContent = connected ? (online ? '在线' : '离线') : '正在连接客服…';
  }

  renderMessages(messages: ChatMessage[], forceScroll: boolean): void {
    const nearBottom = this.bodyEl.scrollHeight - this.bodyEl.scrollTop - this.bodyEl.clientHeight < 120;
    this.listEl.textContent = '';
    this.welcomeEl.hidden = messages.length > 0;

    let lastDay = '';
    messages.forEach((message) => {
      const day = dayLabel(message.at);
      if (day && day !== lastDay) {
        const divider = document.createElement('div');
        divider.className = 'sg-day';
        divider.textContent = day;
        this.listEl.appendChild(divider);
        lastDay = day;
      }

      if (message.role === 'system') {
        const system = document.createElement('div');
        system.className = 'sg-system';
        system.textContent = message.text;
        this.listEl.appendChild(system);
        return;
      }

      const row = document.createElement('div');
      row.className = `sg-msg ${message.role === 'agent' ? 'agent' : 'visitor'}`;

      if (message.role === 'agent') {
        const avatar = document.createElement('div');
        avatar.className = 'sg-msg-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = (message.authorName || '客').trim().slice(0, 1) || '客';
        row.appendChild(avatar);
      }

      const stack = document.createElement('div');
      stack.className = 'sg-msg-stack';

      const bubble = document.createElement('div');
      bubble.className = 'sg-bubble';
      if (message.pending) bubble.classList.add('is-pending');
      if (message.failed) bubble.classList.add('is-failed');
      bubble.textContent = message.text;
      stack.appendChild(bubble);

      const meta = document.createElement('div');
      meta.className = 'sg-msg-meta';
      if (message.failed) meta.classList.add('is-failed');
      meta.textContent = message.failed ? '发送失败，请重试' : formatTime(message.at);
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

  showAgentTyping(active: boolean): void {
    this.clearTypingTimer();
    if (active) {
      this.typingText.textContent = '客服正在输入…';
      this.typingEl.hidden = false;
      this.scrollToBottomIfNear();
      this.typingTimer = setTimeout(() => this.hideAgentTyping(), 4000);
    } else {
      this.hideAgentTyping();
    }
  }

  hideAgentTyping(): void {
    this.clearTypingTimer();
    this.typingEl.hidden = true;
  }

  showNotice(text: string): void {
    this.clearNotice();
    this.noticeEl.textContent = text;
    this.noticeEl.hidden = false;
    this.noticeTimer = setTimeout(() => this.clearNotice(), 5000);
  }

  clearNotice(): void {
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
    this.noticeEl.hidden = true;
  }

  destroy(): void {
    this.clearTypingTimer();
    this.clearNotice();
  }

  private renderPrompts(prompts: string[]): void {
    this.promptsEl.textContent = '';
    prompts.forEach((prompt) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sg-prompt';
      button.textContent = prompt;
      button.addEventListener('click', () => {
        this.promptHandler?.(prompt);
      });
      this.promptsEl.appendChild(button);
    });
  }

  private autoGrow(): void {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 96)}px`;
  }

  private updateCharCount(): void {
    const length = this.input.value.length;
    this.footerChar.textContent = length > 1800 ? `${length} / 2000` : '';
    this.footerChar.classList.toggle('is-limit', length > 1800);
  }

  private scrollToBottomIfNear(): void {
    if (this.bodyEl.scrollHeight - this.bodyEl.scrollTop - this.bodyEl.clientHeight < 160) {
      requestAnimationFrame(() => {
        this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
      });
    }
  }

  private clearTypingTimer(): void {
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
  }
}
