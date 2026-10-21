/**
 * 全局共享的领域模型、接口协议和端口定义。
 * 这里只放类型与常量，运行时逻辑放在 services 或 utils 中。
 */

/** 消息发送方：访客、客服或系统提示。 */
export type MessageRole = 'visitor' | 'agent' | 'system';

/** 会话中的一条消息（持久化模型）。 */
export interface Message {
  /** 消息唯一标识。 */
  id: string;
  /** 发送方角色。 */
  role: MessageRole;
  /** 消息正文，已去除首尾空白并截断到最大长度。 */
  text: string;
  /** 发送时间，ISO 8601 字符串。 */
  at: string;
  /** 发送方展示名。 */
  authorName: string;
  /** 客户端生成的消息标识，用于断线重发时去重。 */
  clientId?: string;
}

/** 一个访客与客服之间的完整会话。 */
export interface Conversation {
  /** 会话唯一标识。 */
  id: string;
  /** 访客标识，由前端生成并持久化。 */
  visitorId: string;
  /** 访客展示名。 */
  visitorName: string;
  /** 发起会话时访客所在的页面地址。 */
  page: string;
  /** 访客浏览器的 User-Agent。 */
  userAgent: string;
  /** 创建时间，ISO 8601 字符串。 */
  createdAt: string;
  /** 最后一条消息的时间，ISO 8601 字符串。 */
  updatedAt: string;
  /** 客服未读消息数。 */
  unreadForAgent: number;
  /** 访客未读消息数。 */
  unreadForVisitor: number;
  /** 会话消息列表，按时间正序，最多保留 MAX_MESSAGES_PER_CONVERSATION 条。 */
  messages: Message[];
}

/** 单个会话最多保留的消息条数，超出后丢弃最旧的消息。 */
export const MAX_MESSAGES_PER_CONVERSATION = 500;

/* ---------------------------- HTTP / WebSocket DTO ---------------------------- */

/** 通过 HTTP / WebSocket 下发给客户端的消息结构。 */
export interface MessageDto {
  /** 消息唯一标识。 */
  id: string;
  /** 发送方角色。 */
  role: MessageRole;
  /** 消息正文。 */
  text: string;
  /** 发送时间，ISO 8601 字符串。 */
  at: string;
  /** 发送方展示名。 */
  authorName: string;
  /** 客户端生成的消息标识，用于去重。 */
  clientId?: string;
}

/** 会话摘要中的最后一条消息，不包含 clientId。 */
export interface LastMessageDto {
  /** 消息唯一标识。 */
  id: string;
  /** 发送方角色。 */
  role: MessageRole;
  /** 消息正文。 */
  text: string;
  /** 发送时间，ISO 8601 字符串。 */
  at: string;
  /** 发送方展示名。 */
  authorName: string;
}

/** 客服会话列表中的单条会话摘要。 */
export interface ConversationSummaryDto {
  /** 会话唯一标识。 */
  id: string;
  /** 访客标识。 */
  visitorId: string;
  /** 访客展示名。 */
  visitorName: string;
  /** 发起会话时访客所在的页面地址。 */
  page: string;
  /** 创建时间，ISO 8601 字符串。 */
  createdAt: string;
  /** 最后一条消息的时间，ISO 8601 字符串。 */
  updatedAt: string;
  /** 客服未读消息数。 */
  unreadForAgent: number;
  /** 访客未读消息数。 */
  unreadForVisitor: number;
  /** 访客当前是否在线。 */
  online: boolean;
  /** 会话消息总数。 */
  messageCount: number;
  /** 最后一条消息；空会话为 null。 */
  lastMessage: LastMessageDto | null;
}

/** 会话详情，包含完整消息列表，用于访客初始化和客服打开会话。 */
export interface ConversationViewDto extends ConversationSummaryDto {
  /** 访客浏览器的 User-Agent。 */
  userAgent: string;
  /** 会话消息列表，按时间正序。 */
  messages: MessageDto[];
}

/**
 * 服务端通过 WebSocket 下发的全部事件。
 * 客户端根据 type 字段区分事件类型。
 */
export type ServerEvent =
  | {
      type: 'visitor:ready';
      /** 访客已有会话；首次进入时为 null。 */
      conversation: ConversationViewDto | null;
      /** 服务端当前时间，ISO 8601 字符串。 */
      serverTime: string;
    }
  | {
      type: 'agent:ready';
      /** 当前登录的客服信息。 */
      me: { name: string };
      /** 客服可见的会话摘要列表。 */
      conversations: ConversationSummaryDto[];
      /** 当前在线的客服名称列表。 */
      agents: string[];
    }
  | {
      type: 'agent:conversations';
      /** 最新的会话摘要列表。 */
      conversations: ConversationSummaryDto[];
    }
  | {
      type: 'conversation:history';
      /** 被打开会话的完整详情。 */
      conversation: ConversationViewDto;
    }
  | {
      type: 'message';
      /** 消息所属会话标识。 */
      conversationId: string;
      /** 新消息内容。 */
      message: MessageDto;
    }
  | {
      type: 'conversation:update';
      /** 更新后的会话摘要。 */
      conversation: ConversationSummaryDto;
    }
  | {
      type: 'conversation:removed';
      /** 被删除的会话标识。 */
      conversationId: string;
    }
  | {
      type: 'typing';
      /** 正在输入所属会话标识。 */
      conversationId: string;
      /** 输入方角色。 */
      from: 'visitor' | 'agent';
      /** 输入方展示名。 */
      name: string;
      /** true 表示开始输入，false 表示停止。 */
      active: boolean;
    }
  | {
      type: 'agent:presence';
      /** 是否至少有一名客服在线。 */
      online: boolean;
      /** 当前在线的客服名称列表。 */
      agents: string[];
      /** 客服连接数，仅下发给客服端。 */
      connections?: number;
    }
  | {
      type: 'error';
      /** 面向客户端的错误提示。 */
      message: string;
    }
  | {
      type: 'auth:error';
      /** 认证失败提示，随后连接会被关闭。 */
      message: string;
    };

/* ------------------------------- 服务端端口 ------------------------------- */

/** 客服登录后签发的会话令牌。 */
export interface AgentSession {
  /** 原始令牌，只返回给客户端，服务端仅保存哈希。 */
  token: string;
  /** 令牌对应的客服名称。 */
  name: string;
  /** 过期时间戳（毫秒）。 */
  expiresAt: number;
}

/** 客服会话令牌仓库端口，负责签发、查询、撤销和清理过期令牌。 */
export interface AgentSessionRepository {
  /** 为指定客服签发新令牌。 */
  issue(name: string): Promise<AgentSession>;
  /** 按令牌查找有效会话；不存在或已过期时返回 null。 */
  find(token: string): Promise<AgentSession | null>;
  /** 撤销指定令牌。 */
  revoke(token: string): Promise<void>;
  /** 清理所有已过期的令牌。 */
  cleanupExpired(): Promise<void>;
}

/** 会话持久化仓库端口，JSON 与未来的 MySQL 实现都遵循该契约。 */
export interface ConversationRepository {
  /** 初始化仓库（加载已有数据、建立连接等）。 */
  initialize(): Promise<void>;
  /** 按会话标识查找。 */
  findById(id: string): Promise<Conversation | null>;
  /** 按访客标识查找其会话。 */
  findByVisitorId(visitorId: string): Promise<Conversation | null>;
  /** 列出全部会话。 */
  listAll(): Promise<Conversation[]>;
  /** 创建新会话。 */
  create(conversation: Conversation): Promise<void>;
  /** 保存已存在会话的最新状态。 */
  save(conversation: Conversation): Promise<void>;
  /** 删除会话，返回是否实际删除。 */
  delete(id: string): Promise<boolean>;
  /** 将缓存的变更立即落盘。 */
  flush(): Promise<void>;
}

/** 实时事件的接收方：全部连接、仅客服或仅访客。 */
export type ConversationAudience = 'all' | 'agents' | 'visitor';

/**
 * 实时事件的语义接口：业务层只描述“发生了什么”，
 * 由连接中心决定发给谁、如何序列化。
 */
export interface ChatEventPublisher {
  /** 发布新消息事件，默认发给会话双方。 */
  publishMessage(
    conversation: Conversation,
    message: Message,
    audience?: ConversationAudience
  ): void;
  /** 发布会话摘要变更事件（未读数、在线状态等）。 */
  publishConversationUpdate(
    conversation: Conversation,
    audience?: ConversationAudience
  ): void;
  /** 发布访客正在输入事件。 */
  publishVisitorTyping(conversation: Conversation, active: boolean): void;
  /** 发布客服正在输入事件。 */
  publishAgentTyping(
    conversation: Conversation,
    active: boolean,
    agentName: string
  ): void;
  /** 发布会话被删除事件。 */
  publishConversationRemoved(conversation: Conversation): void;
}

/** 实时在线状态查询端口，目前由单进程的 ConnectionHub 实现。 */
export interface PresencePort {
  /** 访客是否至少有一个连接在线。 */
  isVisitorOnline(visitorId: string): boolean;
  /** 访客是否有连接打开了聊天面板。 */
  hasOpenVisitorPanel(visitorId: string): boolean;
  /** 是否有客服正聚焦于指定会话。 */
  hasFocusedAgent(conversationId: string): boolean;
  /** 获取去重后的在线客服名称。 */
  getOnlineAgentNames(): string[];
  /** 获取去重后的在线访客数。 */
  getUniqueVisitorCount(): number;
  /** 获取客服 WebSocket 连接数。 */
  getAgentConnectionCount(): number;
}

/** 通用限流端口，供消息发送等高频操作按 key 限流。 */
export interface RateLimiterPort {
  /** 消费一次配额；超出限制时返回 false。 */
  consume(key: string): boolean;
}

/** 登录失败次数限制端口，用于防止密码暴力破解。 */
export interface LoginAttemptPort {
  /** 指定 IP 是否因失败次数过多被暂时封禁。 */
  isBlocked(ip: string): boolean;
  /** 记录一次登录失败。 */
  recordFailure(ip: string): void;
  /** 登录成功后重置该 IP 的失败记录。 */
  reset(ip: string): void;
  /** 清理已过期的失败记录。 */
  cleanup(): void;
}
