import type { WebSocket } from 'ws';

import type { ChatService } from '../../application/services/chat.service';
import { UnauthorizedError, ValidationError } from '../../domain/errors';
import type { ConnectionHub } from './connection.hub';
import {
  normalizeText,
  normalizeVisitorId,
} from '../../shared/validation';

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
    this.hub.registerVisitor(ws, { visitorId, panelOpen });
    onAuthenticated();

    try {
      const conversation = await this.chatService.connectVisitor({
        visitorId,
        name: normalizeText(message.name, 40),
        page: normalizeText(message.page, 300),
        userAgent: userAgent.slice(0, 300),
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
          state.visitorId,
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
