import type { WebSocket } from 'ws';

import type { ChatService } from '@/services/chat.service.js';
import type { ConnectionHub } from '@/services/connection-hub.js';
import { UnauthorizedError, ValidationError } from '@/utils/errors.js';
import {
  normalizeText,
  normalizeVisitorId,
} from '@/utils/validation.js';

type Incoming = Record<string, unknown>;

export class VisitorSocketController {
  constructor(
    private readonly hub: ConnectionHub,
    private readonly chatService: ChatService
  ) {}

  async hello(
    ws: WebSocket,
    message: Incoming,
    userAgent: string,
    onAuthenticated: () => void
  ): Promise<void> {
    const visitorId = normalizeVisitorId(message.visitorId);
    if (!visitorId) {
      this.hub.send(ws, { type: 'error', message: '访客标识无效。' });
      ws.close(4002, 'Invalid visitor');
      return;
    }

    const panelOpen = message.open === true;
    const name = normalizeText(message.name, 40);
    const page = normalizeText(message.page, 300);
    const userAgentText = userAgent.slice(0, 300);
    this.hub.registerVisitor(ws, {
      visitorId,
      name,
      page,
      userAgent: userAgentText,
      panelOpen,
    });
    onAuthenticated();

    try {
      const conversation = await this.chatService.connectVisitor({
        visitorId,
        name,
        page,
        userAgent: userAgentText,
        panelOpen,
      });

      this.hub.send(ws, {
        type: 'visitor:ready',
        conversation,
        serverTime: new Date().toISOString(),
      });
      this.hub.send(ws, this.hub.getPresenceEvent());
    } catch (error) {
      this.hub.removeVisitor(ws);
      throw error;
    }
  }

  async handle(ws: WebSocket, message: Incoming): Promise<void> {
    const state = this.hub.getVisitor(ws);
    if (!state) throw new UnauthorizedError('连接已失效，请刷新页面。');

    switch (message.type) {
      case 'visitor:message':
        await this.chatService.sendVisitorMessage(
          state,
          message.text,
          message.clientId
        );
        return;

      case 'visitor:typing':
        await this.chatService.visitorTyping(state.visitorId, message.active === true);
        return;

      case 'visitor:read':
        await this.chatService.markVisitorRead(state.visitorId);
        return;

      case 'visitor:panel': {
        const open = message.open === true;
        this.hub.setVisitorPanel(ws, open);
        if (open) await this.chatService.markVisitorRead(state.visitorId);
        return;
      }

      default:
        throw new ValidationError('未知的访客操作。');
    }
  }
}
