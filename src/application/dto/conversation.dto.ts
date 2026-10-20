import type { ConversationStatus } from '../../domain/entities/conversation';
import type { MessageRole } from '../../domain/entities/message';

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
  status: ConversationStatus;
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
