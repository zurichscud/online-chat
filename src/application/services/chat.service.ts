import { toConversationSummary, toConversationView } from '../mappers/conversation.mapper';
import type {
  ConversationSummaryDto,
  ConversationViewDto,
} from '../dto/conversation.dto';
import {
  appendMessage,
  createConversation,
  type Conversation,
  type ConversationStatus,
} from '../../domain/entities/conversation';
import { createMessage, type Message } from '../../domain/entities/message';
import { NotFoundError, TooManyRequestsError } from '../../domain/errors';
import type { ChatEventPublisher } from '../../domain/ports/chat-event.publisher';
import type { ConversationRepository } from '../../domain/ports/conversation.repository';
import type { PresencePort } from '../../domain/ports/presence.port';
import type { RateLimiterPort } from '../../domain/ports/rate-limiter.port';
import { AsyncMutex } from '../../shared/async-mutex';
import {
  normalizeClientId,
  normalizeText,
  visitorNameFor,
} from '../../shared/validation';

const MAX_MESSAGE_LENGTH = 2000;

export interface ChatServiceOptions {
  repository: ConversationRepository;
  presence: PresencePort;
  publisher: ChatEventPublisher;
  messageRateLimiter: RateLimiterPort;
}

export interface VisitorConnectionInput {
  visitorId: string;
  name: string;
  page: string;
  userAgent: string;
  panelOpen: boolean;
}

export class ChatService {
  private readonly writeLock = new AsyncMutex();

  constructor(private readonly options: ChatServiceOptions) {}

  async connectVisitor(input: VisitorConnectionInput): Promise<ConversationViewDto> {
    return this.writeLock.run(() => this.connectVisitorLocked(input));
  }

  private async connectVisitorLocked(
    input: VisitorConnectionInput
  ): Promise<ConversationViewDto> {
    let conversation = await this.options.repository.findByVisitorId(input.visitorId);

    if (!conversation) {
      conversation = createConversation({
        visitorId: input.visitorId,
        visitorName: input.name || visitorNameFor(input.visitorId),
        page: input.page,
        userAgent: input.userAgent,
      });
      await this.options.repository.create(conversation);
    } else {
      if (input.name) conversation.visitorName = input.name;
      if (input.page) conversation.page = input.page;
      if (input.userAgent) conversation.userAgent = input.userAgent;
      if (input.panelOpen) conversation.unreadForVisitor = 0;
      await this.options.repository.save(conversation);
    }

    this.options.publisher.publishConversationUpdate(conversation, 'agents');
    return this.toView(conversation);
  }

  async sendVisitorMessage(
    visitorId: string,
    rawText: unknown,
    rawClientId: unknown
  ): Promise<void> {
    return this.writeLock.run(() =>
      this.sendVisitorMessageLocked(visitorId, rawText, rawClientId)
    );
  }

  private async sendVisitorMessageLocked(
    visitorId: string,
    rawText: unknown,
    rawClientId: unknown
  ): Promise<void> {
    const text = normalizeText(rawText, MAX_MESSAGE_LENGTH);
    if (!text) return;

    this.enforceMessageRateLimit(`visitor:${visitorId}`, '发送太频繁了，请稍后再试。');

    const conversation = await this.requireByVisitorId(visitorId);
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

    const created: Message[] = [];

    if (conversation.status === 'closed') {
      conversation.status = 'open';
      created.push(
        appendMessage(
          conversation,
          createMessage({ role: 'system', text: '客户重新发起了咨询' })
        )
      );
    }

    created.push(
      appendMessage(
        conversation,
        createMessage({
          role: 'visitor',
          text,
          authorName: conversation.visitorName,
          clientId,
        })
      )
    );

    conversation.unreadForVisitor = 0;
    conversation.unreadForAgent = this.options.presence.hasFocusedAgent(conversation.id)
      ? 0
      : conversation.unreadForAgent + 1;

    await this.options.repository.save(conversation);
    this.publishCreatedMessages(conversation, created);
    this.options.publisher.publishConversationUpdate(conversation, 'all');
  }

  async visitorTyping(visitorId: string, active: boolean): Promise<void> {
    const conversation = await this.requireByVisitorId(visitorId);
    this.options.publisher.publishVisitorTyping(conversation, active);
  }

  async markVisitorRead(visitorId: string): Promise<void> {
    return this.writeLock.run(() => this.markVisitorReadLocked(visitorId));
  }

  private async markVisitorReadLocked(visitorId: string): Promise<void> {
    const conversation = await this.requireByVisitorId(visitorId);
    if (conversation.unreadForVisitor === 0) return;

    conversation.unreadForVisitor = 0;
    await this.options.repository.save(conversation);
    this.options.publisher.publishConversationUpdate(conversation, 'agents');
  }

  async notifyVisitorDisconnected(visitorId: string): Promise<void> {
    const conversation = await this.options.repository.findByVisitorId(visitorId);
    if (!conversation) return;
    this.options.publisher.publishConversationUpdate(conversation, 'agents');
  }

  async listConversationSummaries(): Promise<ConversationSummaryDto[]> {
    const conversations = await this.options.repository.listAll();
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

    const created: Message[] = [];

    if (conversation.status === 'closed') {
      conversation.status = 'open';
      created.push(
        appendMessage(
          conversation,
          createMessage({ role: 'system', text: '客服重新开启了会话' })
        )
      );
    }

    created.push(
      appendMessage(
        conversation,
        createMessage({
          role: 'agent',
          text,
          authorName: agentName,
          clientId,
        })
      )
    );

    conversation.unreadForAgent = 0;
    conversation.unreadForVisitor = this.options.presence.hasOpenVisitorPanel(
      conversation.visitorId
    )
      ? 0
      : conversation.unreadForVisitor + 1;

    await this.options.repository.save(conversation);
    this.publishCreatedMessages(conversation, created);
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

  async setConversationStatus(
    conversationId: string,
    status: ConversationStatus
  ): Promise<void> {
    return this.writeLock.run(() =>
      this.setConversationStatusLocked(conversationId, status)
    );
  }

  private async setConversationStatusLocked(
    conversationId: string,
    status: ConversationStatus
  ): Promise<void> {
    const conversation = await this.requireById(conversationId);
    if (conversation.status === status) return;

    conversation.status = status;
    conversation.unreadForAgent = 0;
    conversation.unreadForVisitor = 0;

    const systemMessage = appendMessage(
      conversation,
      createMessage({
        role: 'system',
        text: status === 'closed' ? '客服已结束本次会话' : '客服重新开启了会话',
      })
    );

    await this.options.repository.save(conversation);
    this.options.publisher.publishMessage(conversation, systemMessage, 'all');
    this.options.publisher.publishConversationUpdate(conversation, 'all');
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
    const conversations = await this.options.repository.listAll();
    return conversations.length;
  }

  private publishCreatedMessages(conversation: Conversation, messages: Message[]): void {
    for (const message of messages) {
      this.options.publisher.publishMessage(conversation, message, 'all');
    }
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

  private async requireByVisitorId(visitorId: string): Promise<Conversation> {
    const conversation = await this.options.repository.findByVisitorId(visitorId);
    if (!conversation) throw new NotFoundError('会话不存在，请刷新页面重试。');
    return conversation;
  }

  private toView(conversation: Conversation): ConversationViewDto {
    return toConversationView(
      conversation,
      this.options.presence.isVisitorOnline(conversation.visitorId)
    );
  }
}
