import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

import type { AuthService } from '@/services/auth.service.js';
import type { ChatService } from '@/services/chat.service.js';
import type { ConnectionHub } from '@/services/connection-hub.js';
import { AgentSocketController } from '@/controllers/agent.socket-controller.js';
import { VisitorSocketController } from '@/controllers/visitor.socket-controller.js';
import { AppError, ValidationError } from '@/utils/errors.js';
import { logger } from '@/utils/logger.js';
import { isRecord } from '@/utils/validation.js';

/** WebSocket 网关的依赖。 */
export interface WebSocketGatewayOptions {
  /** 复用的 HTTP 服务，用于挂载 /ws 升级处理。 */
  server: HttpServer;
  /** 连接状态与事件广播中心。 */
  hub: ConnectionHub;
  /** 客服令牌校验服务。 */
  authService: AuthService;
  /** 会话业务服务。 */
  chatService: ChatService;
}

/** 已通过基础校验、带 type 字段的客户端消息。 */
type IncomingPayload = Record<string, unknown> & { type: string };

/**
 * WebSocket 网关：处理 /ws 升级、首包认证分发、心跳检测和连接关闭清理。
 */
export class ChatWebSocketGateway {
  private readonly wss: WebSocketServer;
  private readonly visitorController: VisitorSocketController;
  private readonly agentController: AgentSocketController;
  private readonly alive = new WeakSet<WebSocket>();
  private readonly authTimers = new WeakMap<WebSocket, NodeJS.Timeout>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: WebSocketGatewayOptions) {
    this.wss = new WebSocketServer({
      server: options.server,
      path: '/ws',
      maxPayload: 64 * 1024,
    });

    this.visitorController = new VisitorSocketController(
      options.hub,
      options.chatService
    );
    this.agentController = new AgentSocketController(
      options.hub,
      options.authService,
      options.chatService
    );

    this.wss.on('connection', (ws, request) => this.handleConnection(ws, request));
    this.wss.on('error', (error) => {
      logger.error({ error }, 'WebSocket server error');
    });
  }

  start(): void {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
    this.heartbeatTimer.unref();
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const ws of this.wss.clients) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // 已关闭的连接直接忽略。
      }
    }
    this.wss.close();
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    this.alive.add(ws);

    const authTimer = setTimeout(() => {
      if (!this.options.hub.getVisitor(ws) && !this.options.hub.getAgent(ws)) {
        ws.close(4000, 'Hello timeout');
      }
    }, 10_000);
    authTimer.unref();
    this.authTimers.set(ws, authTimer);

    const userAgentHeader = request.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader.join(' ')
      : (userAgentHeader ?? '');

    ws.on('pong', () => {
      this.alive.add(ws);
    });

    ws.on('message', (raw) => {
      void this.onMessage(ws, raw, userAgent).catch((error) => {
        this.handleSocketError(ws, error);
      });
    });

    ws.on('close', () => {
      void this.handleClose(ws);
    });

    ws.on('error', (error) => {
      logger.warn({ error }, 'WebSocket connection error');
    });
  }

  private async onMessage(
    ws: WebSocket,
    raw: RawData,
    userAgent: string
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      throw new ValidationError('消息格式不正确。');
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string' || !parsed.type) {
      throw new ValidationError('消息格式不正确。');
    }
    const message = parsed as IncomingPayload;

    if (this.options.hub.getVisitor(ws)) {
      await this.visitorController.handle(ws, message);
      return;
    }
    if (this.options.hub.getAgent(ws)) {
      await this.agentController.handle(ws, message);
      return;
    }

    const onAuthenticated = () => this.markAuthenticated(ws);
    if (message.type === 'visitor:hello') {
      await this.visitorController.hello(ws, message, userAgent, onAuthenticated);
      return;
    }
    if (message.type === 'agent:hello') {
      await this.agentController.hello(ws, message, onAuthenticated);
      return;
    }

    throw new ValidationError('请先完成连接。');
  }

  private markAuthenticated(ws: WebSocket): void {
    const timer = this.authTimers.get(ws);
    if (timer) clearTimeout(timer);
    this.authTimers.delete(ws);
  }

  private async handleClose(ws: WebSocket): Promise<void> {
    this.markAuthenticated(ws);
    this.alive.delete(ws);

    const visitor = this.options.hub.removeVisitor(ws);
    if (visitor) {
      try {
        await this.options.chatService.notifyVisitorDisconnected(visitor.visitorId);
      } catch (error) {
        logger.warn({ error, visitorId: visitor.visitorId }, 'Failed to update visitor presence');
      }
    }

    const agent = this.options.hub.removeAgent(ws);
    if (agent) this.options.hub.broadcastPresence();
  }

  private handleSocketError(ws: WebSocket, error: unknown): void {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        logger.error({ error }, 'WebSocket application error');
      }
      this.options.hub.send(ws, { type: 'error', message: error.message });
      return;
    }

    logger.error({ error }, 'Unhandled WebSocket error');
    this.options.hub.send(ws, {
      type: 'error',
      message: '服务暂时不可用，请稍后重试。',
    });
  }

  private heartbeat(): void {
    for (const ws of this.wss.clients) {
      if (!this.alive.has(ws)) {
        ws.terminate();
        continue;
      }
      this.alive.delete(ws);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }
}
