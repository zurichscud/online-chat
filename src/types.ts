/**
 * 全局共享的领域模型、接口协议和端口定义。
 * 这里只放类型与常量，运行时逻辑放在 services 或 utils 中。
 */

export type MessageRole = 'visitor' | 'agent' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  at: string;
  authorName: string;
  clientId?: string;
}

export interface Conversation {
  id: string;
  visitorId: string;
  visitorName: string;
  page: string;
  userAgent: string;
  createdAt: string;
  updatedAt: string;
  unreadForAgent: number;
  unreadForVisitor: number;
  messages: Message[];
}

export const MAX_MESSAGES_PER_CONVERSATION = 500;

/* ---------------------------- HTTP / WebSocket DTO ---------------------------- */

export interface MessageDto {
  id: string;
  role: MessageRole;
  text: string;
  at: string;
  authorName: string;
  clientId?: string;
}

export interface LastMessageDto {
  id: string;
  role: MessageRole;
  text: string;
  at: string;
  authorName: string;
}

export interface ConversationSummaryDto {
  id: string;
  visitorId: string;
  visitorName: string;
  page: string;
  createdAt: string;
  updatedAt: string;
  unreadForAgent: number;
  unreadForVisitor: number;
  online: boolean;
  messageCount: number;
  lastMessage: LastMessageDto | null;
}

export interface ConversationViewDto extends ConversationSummaryDto {
  userAgent: string;
  messages: MessageDto[];
}

export type ServerEvent =
  | {
      type: 'visitor:ready';
      conversation: ConversationViewDto | null;
      serverTime: string;
    }
  | {
      type: 'agent:ready';
      me: { name: string };
      conversations: ConversationSummaryDto[];
      agents: string[];
    }
  | { type: 'agent:conversations'; conversations: ConversationSummaryDto[] }
  | { type: 'conversation:history'; conversation: ConversationViewDto }
  | { type: 'message'; conversationId: string; message: MessageDto }
  | { type: 'conversation:update'; conversation: ConversationSummaryDto }
  | { type: 'conversation:removed'; conversationId: string }
  | {
      type: 'typing';
      conversationId: string;
      from: 'visitor' | 'agent';
      name: string;
      active: boolean;
    }
  | {
      type: 'agent:presence';
      online: boolean;
      agents: string[];
      connections?: number;
    }
  | { type: 'error'; message: string }
  | { type: 'auth:error'; message: string };

/* ------------------------------- 服务端端口 ------------------------------- */

export interface AgentSession {
  token: string;
  name: string;
  expiresAt: number;
}

export interface AgentSessionRepository {
  issue(name: string): Promise<AgentSession>;
  find(token: string): Promise<AgentSession | null>;
  revoke(token: string): Promise<void>;
  cleanupExpired(): Promise<void>;
}

export interface ConversationRepository {
  initialize(): Promise<void>;
  findById(id: string): Promise<Conversation | null>;
  findByVisitorId(visitorId: string): Promise<Conversation | null>;
  listAll(): Promise<Conversation[]>;
  create(conversation: Conversation): Promise<void>;
  save(conversation: Conversation): Promise<void>;
  delete(id: string): Promise<boolean>;
  flush(): Promise<void>;
}

export type ConversationAudience = 'all' | 'agents' | 'visitor';

/**
 * 实时事件的语义接口：业务层只描述“发生了什么”，
 * 由连接中心决定发给谁、如何序列化。
 */
export interface ChatEventPublisher {
  publishMessage(
    conversation: Conversation,
    message: Message,
    audience?: ConversationAudience
  ): void;
  publishConversationUpdate(
    conversation: Conversation,
    audience?: ConversationAudience
  ): void;
  publishVisitorTyping(conversation: Conversation, active: boolean): void;
  publishAgentTyping(
    conversation: Conversation,
    active: boolean,
    agentName: string
  ): void;
  publishConversationRemoved(conversation: Conversation): void;
}

export interface PresencePort {
  isVisitorOnline(visitorId: string): boolean;
  hasOpenVisitorPanel(visitorId: string): boolean;
  hasFocusedAgent(conversationId: string): boolean;
  getOnlineAgentNames(): string[];
  getUniqueVisitorCount(): number;
  getAgentConnectionCount(): number;
}

export interface RateLimiterPort {
  consume(key: string): boolean;
}

export interface LoginAttemptPort {
  isBlocked(ip: string): boolean;
  recordFailure(ip: string): void;
  reset(ip: string): void;
  cleanup(): void;
}
