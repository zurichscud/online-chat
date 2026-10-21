import type { ChatMessage, ConversationView, OutboxEntry } from './types';
import { makeId } from './utils';

function toPendingMessage(entry: OutboxEntry): ChatMessage {
  return {
    id: `local-${entry.clientId}`,
    clientId: entry.clientId,
    role: 'visitor',
    text: entry.text,
    at: entry.at,
    pending: true,
  };
}

/**
 * 会话与消息的本地状态。只负责合并服务端数据和本地乐观消息，
 * DOM 渲染和网络发送由上层决定。
 */
export class ChatSession {
  conversation: ConversationView | null = null;
  messages: ChatMessage[] = [];
  outbox: OutboxEntry[] = [];
  unread = 0;

  /** 用服务端下发的完整会话替换本地状态，同时对齐未确认消息。 */
  applyConversation(conversation: ConversationView | null, panelOpen: boolean): void {
    if (!conversation) {
      // 还没有会话：只保留本地待发送消息，首条消息发送后服务端才会创建会话。
      this.conversation = null;
      this.messages = this.outbox.map(toPendingMessage);
      this.unread = 0;
      return;
    }

    this.conversation = conversation;
    const serverMessages = Array.isArray(conversation.messages)
      ? conversation.messages.slice()
      : [];

    // 服务端已确认的消息从 outbox 中移除，本地不再重复展示。
    this.outbox = this.outbox.filter(
      (entry) => !serverMessages.some((message) => message.clientId === entry.clientId)
    );

    this.messages = serverMessages.concat(this.outbox.map(toPendingMessage));
    this.unread = panelOpen ? 0 : conversation.unreadForVisitor || 0;
  }

  /** 合并会话摘要（不含 messages），保留现有消息列表。 */
  updateConversation(update: ConversationView, panelOpen: boolean): void {
    this.conversation = Object.assign({}, this.conversation, update);
    if (!panelOpen) {
      this.unread = Math.max(this.unread, update.unreadForVisitor || 0);
    }
  }

  /** 记录一条待发送消息，并生成对应的本地乐观消息。 */
  queue(text: string): OutboxEntry {
    const entry: OutboxEntry = {
      clientId: makeId(),
      text,
      at: new Date().toISOString(),
    };
    this.outbox.push(entry);
    this.messages.push(toPendingMessage(entry));
    return entry;
  }

  /**
   * 收到服务端消息：clientId 命中本地乐观消息时原位替换，
   * 否则追加到列表末尾。
   */
  receive(message: ChatMessage): { replaced: boolean; fromAgent: boolean } {
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

    return { replaced, fromAgent: message.role === 'agent' };
  }

  markRead(): void {
    this.unread = 0;
    if (this.conversation) this.conversation.unreadForVisitor = 0;
  }

  incrementUnread(): void {
    this.unread += 1;
  }

  reset(): void {
    this.conversation = null;
    this.messages = [];
    this.unread = 0;
  }

  /** 断线期间积压的消息在连接恢复后按原 clientId 重发。 */
  flush(send: (entry: OutboxEntry) => boolean): void {
    this.outbox.forEach((entry) => {
      send(entry);
    });
  }
}
