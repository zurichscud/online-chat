import { randomUUID } from 'node:crypto';

import {
  MAX_MESSAGES_PER_CONVERSATION,
  type ChatEventPublisher,
  type Conversation,
  type ConversationRepository,
  type ConversationSummaryDto,
  type ConversationViewDto,
  type Message,
  type MessageRole,
  type PresencePort,
  type RateLimiterPort,
} from '@/types.js';
import { NotFoundError, TooManyRequestsError } from '@/utils/errors.js';
import {
  toConversationSummary,
  toConversationView,
} from '@/utils/mappers.js';
import { AsyncMutex } from '@/utils/mutex.js';
import {
  normalizeClientId,
  normalizeText,
  visitorNameFor,
} from '@/utils/validation.js';

const MAX_MESSAGE_LENGTH = 2000;

export interface ChatServiceOptions {
  repository: ConversationRepository;
  presence: PresencePort;
  publisher: ChatEventPublisher;
  messageRateLimiter: RateLimiterPort;
}

export interface VisitorIdentity {
  visitorId: string;
  name: string;
  page: string;
  userAgent: string;
}

export interface VisitorConnectionInput extends VisitorIdentity {
  panelOpen: boolean;
}

export class ChatService {
  private readonly writeLock = new AsyncMutex();

  constructor(private readonly options: ChatServiceOptions) {}

  async connectVisitor(
    input: VisitorConnectionInput
  ): Promise<ConversationViewDto | null> {
    return this.writeLock.run(() => this.connectVisitorLocked(input));
  }

  private async connectVisitorLocked(
    input: VisitorConnectionInput
  ): Promise<ConversationViewDto | null> {
    const conversation = await this.options.repository.findByVisitorId(input.visitorId);
    if (!conversation) return null;

    if (input.name) conversation.visitorName = input.name;
    if (input.page) conversation.page = input.page;
    if (input.userAgent) conversation.userAgent = input.userAgent;
    if (input.panelOpen) conversation.unreadForVisitor = 0;
    await this.options.repository.save(conversation);

    // 还没有消息的会话不进入客服列表，只保留访客资料供首条消息使用。
    if (conversation.messages.length > 0) {
      this.options.publisher.publishConversationUpdate(conversation, 'agents');
    }
    return this.toView(conversation);
  }

  async sendVisitorMessage(
    visitor: VisitorIdentity,
    rawText: unknown,
    rawClientId: unknown
  ): Promise<void> {
    return this.writeLock.run(() =>
      this.sendVisitorMessageLocked(visitor, rawText, rawClientId)
    );
  }

  private async sendVisitorMessageLocked(
    visitor: VisitorIdentity,
    rawText: unknown,
    rawClientId: unknown
  ): Promise<void> {
    const text = normalizeText(rawText, MAX_MESSAGE_LENGTH);
    if (!text) return;

    this.enforceMessageRateLimit(
      `visitor:${visitor.visitorId}`,
      '发送太频繁了，请稍后再试。'
    );

    const existing = await this.options.repository.findByVisitorId(visitor.visitorId);
    const isNew = !existing;
    const conversation =
      existing ??
      createConversation({
        visitorId: visitor.visitorId,
        visitorName: visitor.name || visitorNameFor(visitor.visitorId),
        page: visitor.page,
        userAgent: visitor.userAgent,
      });

    if (existing) {
      if (visitor.name) conversation.visitorName = visitor.name;
      if (visitor.page) conversation.page = visitor.page;
      if (visitor.userAgent) conversation.userAgent = visitor.userAgent;
    }

    const clientId = normalizeClientId(rawClientId);

    if (clientId) {
      const duplicate = conversation.messages.find(
        (message) => message.role === 'visitor' && message.clientId === clientId
      );
      if (duplicate) {
        this.options.publisher.publishMessage(conversation, duplicate, 'visitor');
        return;
      }
    }

    const message = appendMessage(
      conversation,
      createMessage({
        role: 'visitor',
        text,
        authorName: conversation.visitorName,
        clientId,
      })
    );

    conversation.unreadForVisitor = 0;
    conversation.unreadForAgent = this.options.presence.hasFocusedAgent(conversation.id)
      ? 0
      : conversation.unreadForAgent + 1;

    if (isNew) {
      await this.options.repository.create(conversation);
    } else {
      await this.options.repository.save(conversation);
    }
    this.options.publisher.publishMessage(conversation, message, 'all');
    this.options.publisher.publishConversationUpdate(conversation, 'all');
  }

  async visitorTyping(visitorId: string, active: boolean): Promise<void> {
    const conversation = await this.options.repository.findByVisitorId(visitorId);
    if (!conversation) return;
    this.options.publisher.publishVisitorTyping(conversation, active);
  }

  async markVisitorRead(visitorId: string): Promise<void> {
    return this.writeLock.run(() => this.markVisitorReadLocked(visitorId));
  }

  private async markVisitorReadLocked(visitorId: string): Promise<void> {
    const conversation = await this.options.repository.findByVisitorId(visitorId);
    if (!conversation || conversation.unreadForVisitor === 0) return;

    conversation.unreadForVisitor = 0;
    await this.options.repository.save(conversation);
    this.options.publisher.publishConversationUpdate(conversation, 'agents');
  }

  async notifyVisitorDisconnected(visitorId: string): Promise<void> {
    const conversation = await this.options.repository.findByVisitorId(visitorId);
    if (!conversation || conversation.messages.length === 0) return;
    this.options.publisher.publishConversationUpdate(conversation, 'agents');
  }

  async listConversationSummaries(): Promise<ConversationSummaryDto[]> {
    const conversations = await this.listVisibleConversations();
    return conversations
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((conversation) =>
        toConversationSummary(
          conversation,
          this.options.presence.isVisitorOnline(conversation.visitorId)
        )
      );
  }

  async openConversationForAgent(conversationId: string): Promise<ConversationViewDto> {
    return this.writeLock.run(() => this.openConversationForAgentLocked(conversationId));
  }

  private async openConversationForAgentLocked(
    conversationId: string
  ): Promise<ConversationViewDto> {
    const conversation = await this.requireById(conversationId);

    if (conversation.unreadForAgent !== 0) {
      conversation.unreadForAgent = 0;
      await this.options.repository.save(conversation);
    }

    this.options.publisher.publishConversationUpdate(conversation, 'agents');
    return this.toView(conversation);
  }

  async sendAgentMessage(
    conversationId: string,
    rawText: unknown,
    rawClientId: unknown,
    agentName: string
  ): Promise<void> {
    return this.writeLock.run(() =>
      this.sendAgentMessageLocked(conversationId, rawText, rawClientId, agentName)
    );
  }

  private async sendAgentMessageLocked(
    conversationId: string,
    rawText: unknown,
    rawClientId: unknown,
    agentName: string
  ): Promise<void> {
    const text = normalizeText(rawText, MAX_MESSAGE_LENGTH);
    if (!text) return;

    this.enforceMessageRateLimit(`agent:${agentName}`, '发送太频繁了，请稍后再试。');

    const conversation = await this.requireById(conversationId);
    const clientId = normalizeClientId(rawClientId);

    if (clientId) {
      const duplicate = conversation.messages.find(
        (message) => message.role === 'agent' && message.clientId === clientId
      );
      if (duplicate) {
        this.options.publisher.publishMessage(conversation, duplicate, 'agents');
        return;
      }
    }

    const message = appendMessage(
      conversation,
      createMessage({
        role: 'agent',
        text,
        authorName: agentName,
        clientId,
      })
    );

    conversation.unreadForAgent = 0;
    conversation.unreadForVisitor = this.options.presence.hasOpenVisitorPanel(
      conversation.visitorId
    )
      ? 0
      : conversation.unreadForVisitor + 1;

    await this.options.repository.save(conversation);
    this.options.publisher.publishMessage(conversation, message, 'all');
    this.options.publisher.publishConversationUpdate(conversation, 'all');
  }

  async agentTyping(
    conversationId: string,
    active: boolean,
    agentName: string
  ): Promise<void> {
    const conversation = await this.requireById(conversationId);
    this.options.publisher.publishAgentTyping(conversation, active, agentName);
  }

  async markAgentRead(conversationId: string): Promise<void> {
    return this.writeLock.run(() => this.markAgentReadLocked(conversationId));
  }

  private async markAgentReadLocked(conversationId: string): Promise<void> {
    const conversation = await this.requireById(conversationId);
    if (conversation.unreadForAgent === 0) return;

    conversation.unreadForAgent = 0;
    await this.options.repository.save(conversation);
    this.options.publisher.publishConversationUpdate(conversation, 'agents');
  }

  async deleteConversation(conversationId: string): Promise<void> {
    return this.writeLock.run(() => this.deleteConversationLocked(conversationId));
  }

  private async deleteConversationLocked(conversationId: string): Promise<void> {
    const conversation = await this.requireById(conversationId);
    const deleted = await this.options.repository.delete(conversationId);
    if (!deleted) throw new NotFoundError('会话不存在或已被删除。');
    this.options.publisher.publishConversationRemoved(conversation);
  }

  async getConversationCount(): Promise<number> {
    const conversations = await this.listVisibleConversations();
    return conversations.length;
  }

  private async listVisibleConversations(): Promise<Conversation[]> {
    const conversations = await this.options.repository.listAll();
    return conversations.filter((conversation) => conversation.messages.length > 0);
  }

  private enforceMessageRateLimit(key: string, message: string): void {
    if (!this.options.messageRateLimiter.consume(key)) {
      throw new TooManyRequestsError(message);
    }
  }

  private async requireById(conversationId: string): Promise<Conversation> {
    const conversation = await this.options.repository.findById(conversationId);
    if (!conversation) throw new NotFoundError('会话不存在或已被删除。');
    return conversation;
  }

  private toView(conversation: Conversation): ConversationViewDto {
    return toConversationView(
      conversation,
      this.options.presence.isVisitorOnline(conversation.visitorId)
    );
  }
}

/* ------------------------------ 领域对象构造 ------------------------------ */

interface CreateConversationInput {
  visitorId: string;
  visitorName: string;
  page: string;
  userAgent: string;
}

function createConversation(input: CreateConversationInput): Conversation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    visitorId: input.visitorId,
    visitorName: input.visitorName,
    page: input.page,
    userAgent: input.userAgent,
    createdAt: now,
    updatedAt: now,
    unreadForAgent: 0,
    unreadForVisitor: 0,
    messages: [],
  };
}

function appendMessage(conversation: Conversation, message: Message): Message {
  conversation.messages.push(message);
  if (conversation.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    conversation.messages.splice(
      0,
      conversation.messages.length - MAX_MESSAGES_PER_CONVERSATION
    );
  }
  conversation.updatedAt = message.at;
  return message;
}

interface CreateMessageInput {
  role: MessageRole;
  text: string;
  authorName?: string;
  clientId?: string;
  at?: string;
}

function createMessage(input: CreateMessageInput): Message {
  const message: Message = {
    id: randomUUID(),
    role: input.role,
    text: input.text,
    at: input.at ?? new Date().toISOString(),
    authorName: input.authorName ?? '',
  };

  if (input.clientId) message.clientId = input.clientId;
  return message;
}
