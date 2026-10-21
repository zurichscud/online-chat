export const SHELL_HTML = `
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
