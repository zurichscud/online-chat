import type {
  ConversationSummaryDto,
  ConversationViewDto,
  MessageDto,
} from './conversation.dto';

export type ServerEvent =
  | { type: 'visitor:ready'; conversation: ConversationViewDto; serverTime: string }
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
