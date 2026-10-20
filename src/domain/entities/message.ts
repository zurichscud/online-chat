import { createId } from '../../shared/ids';

export type MessageRole = 'visitor' | 'agent' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  at: string;
  authorName: string;
  clientId?: string;
}

export interface CreateMessageInput {
  role: MessageRole;
  text: string;
  authorName?: string;
  clientId?: string;
  at?: string;
}

export function createMessage(input: CreateMessageInput): Message {
  const message: Message = {
    id: createId(),
    role: input.role,
    text: input.text,
    at: input.at ?? new Date().toISOString(),
    authorName: input.authorName ?? '',
  };

  if (input.clientId) message.clientId = input.clientId;
  return message;
}
