import { createId } from '../../shared/ids';
import type { Message } from './message';

export type ConversationStatus = 'open' | 'closed';

export interface Conversation {
  id: string;
  visitorId: string;
  visitorName: string;
  page: string;
  userAgent: string;
  createdAt: string;
  updatedAt: string;
  status: ConversationStatus;
  unreadForAgent: number;
  unreadForVisitor: number;
  messages: Message[];
}

export const MAX_MESSAGES_PER_CONVERSATION = 500;

export interface CreateConversationInput {
  visitorId: string;
  visitorName: string;
  page: string;
  userAgent: string;
}

export function createConversation(input: CreateConversationInput): Conversation {
  const now = new Date().toISOString();
  return {
    id: createId(),
    visitorId: input.visitorId,
    visitorName: input.visitorName,
    page: input.page,
    userAgent: input.userAgent,
    createdAt: now,
    updatedAt: now,
    status: 'open',
    unreadForAgent: 0,
    unreadForVisitor: 0,
    messages: [],
  };
}

export function appendMessage(conversation: Conversation, message: Message): Message {
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

export function lastMessageOf(conversation: Conversation): Message | null {
  return conversation.messages[conversation.messages.length - 1] ?? null;
}
