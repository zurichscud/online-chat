import type { WebSocket } from 'ws';

import type { AuthService } from '@/services/auth.service.js';
import type { ChatService } from '@/services/chat.service.js';
import type { ConnectionHub } from '@/services/connection-hub.js';
import { UnauthorizedError, ValidationError } from '@/utils/errors.js';

/** 客服 WebSocket 消息的通用形状。 */
type Incoming = Record<string, unknown>;

/** 处理客服端 WebSocket 的认证与业务消息。 */
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
      // 客服请求刷新会话列表，服务端返回所有会话摘要。
      case 'agent:list': {
        const conversations = await this.chatService.listConversationSummaries();
        this.hub.send(ws, { type: 'agent:conversations', conversations });
        return;
      }

      // 客服打开某一会话：加载历史消息并把该会话设为当前焦点。
      case 'agent:open': {
        const conversationId = requireConversationId(message);
        const conversation = await this.chatService.openConversationForAgent(conversationId);
        this.hub.setAgentFocus(ws, conversationId);
        this.hub.send(ws, { type: 'conversation:history', conversation });
        return;
      }

      // 客服发送一条消息到指定会话（按 clientId 去重防重复）。
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

      // 客服正在输入/停止输入，广播 typing 状态给访客。
      case 'agent:typing': {
        const conversationId = requireConversationId(message);
        await this.chatService.agentTyping(
          conversationId,
          message.active === true,
          state.name
        );
        return;
      }

      // 客服已读某会话，清零 agent 侧未读计数。
      case 'agent:read': {
        const conversationId = requireConversationId(message);
        await this.chatService.markAgentRead(conversationId);
        return;
      }

      // 客服窗口失焦/离开，清除当前焦点会话。
      case 'agent:blur':
        this.hub.setAgentFocus(ws, null);
        return;

      // 客服删除某一会话及其消息。
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
