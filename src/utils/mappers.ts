import type {
  Conversation,
  ConversationSummaryDto,
  ConversationViewDto,
  LastMessageDto,
  Message,
  MessageDto,
} from '@/types.js';

export function toMessageDto(message: Message): MessageDto {
  const dto: MessageDto = {
    id: message.id,
    role: message.role,
    text: message.text,
    at: message.at,
    authorName: message.authorName,
  };
  if (message.clientId) dto.clientId = message.clientId;
  return dto;
}

function toLastMessageDto(message: Message | null): LastMessageDto | null {
  if (!message) return null;
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    at: message.at,
    authorName: message.authorName,
  };
}

export function toConversationSummary(
  conversation: Conversation,
  online: boolean
): ConversationSummaryDto {
  const lastMessage = conversation.messages[conversation.messages.length - 1] ?? null;
  return {
    id: conversation.id,
    visitorId: conversation.visitorId,
    visitorName: conversation.visitorName,
    page: conversation.page,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    unreadForAgent: conversation.unreadForAgent,
    unreadForVisitor: conversation.unreadForVisitor,
    online,
    messageCount: conversation.messages.length,
    lastMessage: toLastMessageDto(lastMessage),
  };
}

export function toConversationView(
  conversation: Conversation,
  online: boolean
): ConversationViewDto {
  return {
    ...toConversationSummary(conversation, online),
    userAgent: conversation.userAgent,
    messages: conversation.messages.map(toMessageDto),
  };
}
