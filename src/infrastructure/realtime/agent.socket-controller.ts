import type { WebSocket } from 'ws';

import type { AuthService } from '../../application/services/auth.service';
import type { ChatService } from '../../application/services/chat.service';
import { UnauthorizedError, ValidationError } from '../../domain/errors';
import type { ConnectionHub } from './connection.hub';

type Incoming = Record<string, unknown>;

export class AgentSocketController {
  constructor(
    private readonly hub: ConnectionHub,
    private readonly authService: AuthService,
    private readonly chatService: ChatService
  ) {}

  async hello(
    ws: WebSocket,
    message: Incoming,
    onAuthenticated: () => void
  ): Promise<void> {
    const token = typeof message.token === 'string' ? message.token : '';
    const session = await this.authService.validateToken(token);

    if (!session) {
      this.hub.send(ws, { type: 'auth:error', message: '登录已失效，请重新登录。' });
      ws.close(4001, 'Unauthorized');
      return;
    }

    this.hub.registerAgent(ws, {
      name: session.name,
      focusedConversationId: null,
    });
    onAuthenticated();

    try {
      const conversations = await this.chatService.listConversationSummaries();
      this.hub.send(ws, {
        type: 'agent:ready',
        me: { name: session.name },
        conversations,
        agents: this.hub.getOnlineAgentNames(),
      });
      this.hub.broadcastPresence();
    } catch (error) {
      this.hub.removeAgent(ws);
      throw error;
    }
  }

  async handle(ws: WebSocket, message: Incoming): Promise<void> {
    const state = this.hub.getAgent(ws);
    if (!state) throw new UnauthorizedError('登录已失效，请重新登录。');

    switch (message.type) {
      case 'agent:list': {
        const conversations = await this.chatService.listConversationSummaries();
        this.hub.send(ws, { type: 'agent:conversations', conversations });
        return;
      }

      case 'agent:open': {
        const conversationId = requireConversationId(message);
        const conversation = await this.chatService.openConversationForAgent(conversationId);
        this.hub.setAgentFocus(ws, conversationId);
        this.hub.send(ws, { type: 'conversation:history', conversation });
        return;
      }

      case 'agent:message': {
        const conversationId = requireConversationId(message);
        await this.chatService.sendAgentMessage(
          conversationId,
          message.text,
          message.clientId,
          state.name
        );
        this.hub.setAgentFocus(ws, conversationId);
        return;
      }

      case 'agent:typing': {
        const conversationId = requireConversationId(message);
        await this.chatService.agentTyping(
          conversationId,
          message.active === true,
          state.name
        );
        return;
      }

      case 'agent:read': {
        const conversationId = requireConversationId(message);
        await this.chatService.markAgentRead(conversationId);
        return;
      }

      case 'agent:blur':
        this.hub.setAgentFocus(ws, null);
        return;

      case 'agent:setStatus': {
        const conversationId = requireConversationId(message);
        const status = message.status === 'closed' ? 'closed' : 'open';
        await this.chatService.setConversationStatus(conversationId, status);
        return;
      }

      case 'agent:delete': {
        const conversationId = requireConversationId(message);
        await this.chatService.deleteConversation(conversationId);
        return;
      }

      default:
        throw new ValidationError('未知的客服操作。');
    }
  }
}

function requireConversationId(message: Incoming): string {
  if (typeof message.conversationId !== 'string' || !message.conversationId) {
    throw new ValidationError('会话标识无效。');
  }
  return message.conversationId;
}
