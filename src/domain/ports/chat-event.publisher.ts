import type { Conversation } from '../entities/conversation';
import type { Message } from '../entities/message';

export type ConversationAudience = 'all' | 'agents' | 'visitor';

/**
 * Semantic realtime port. The application layer describes what happened;
 * the WebSocket adapter decides who receives it and how it is serialized.
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
