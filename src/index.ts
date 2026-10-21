import { createServer } from 'node:http';

import { createApp } from '@/app.js';
import { config } from '@/config.js';
import { AuthService } from '@/services/auth.service.js';
import { ChatService } from '@/services/chat.service.js';
import { InMemoryAgentSessionRepository } from '@/services/agent-session.repository.js';
import { JsonConversationRepository } from '@/services/conversation.repository.js';
import { ConnectionHub } from '@/services/connection-hub.js';
import { ChatWebSocketGateway } from '@/services/websocket.gateway.js';
import {
  FixedWindowRateLimiter,
  LoginAttemptLimiter,
} from '@/utils/rate-limiter.js';
import { logger } from '@/utils/logger.js';

async function createContainer() {
  const repository = new JsonConversationRepository(config.dataFile);
  await repository.initialize();

  const sessions = new InMemoryAgentSessionRepository(config.agentTokenTtlMs);
  const loginAttempts = new LoginAttemptLimiter(8, 10 * 60 * 1000);
  const messageRateLimiter = new FixedWindowRateLimiter(20, 10_000);

  const authService = new AuthService({
    sessions,
    loginAttempts,
    agentName: config.agentName,
    agentPassword: config.agentPassword,
    tokenTtlMs: config.agentTokenTtlMs,
  });

  const hub = new ConnectionHub();
  const chatService = new ChatService({
    repository,
    presence: hub,
    publisher: hub,
    messageRateLimiter,
  });

  return { repository, authService, chatService, hub };
}

async function main(): Promise<void> {
  const container = await createContainer();
  const app = createApp({
    config,
    authService: container.authService,
    chatService: container.chatService,
    presence: container.hub,
  });

  const httpServer = createServer(app);
  const gateway = new ChatWebSocketGateway({
    server: httpServer,
    hub: container.hub,
    authService: container.authService,
    chatService: container.chatService,
  });
  gateway.start();

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, () => resolve());
  });

  logger.info(
    {
      port: config.port,
      environment: config.nodeEnv,
      demoUrl: `http://localhost:${config.port}/demo.html`,
      agentUrl: `http://localhost:${config.port}/agent.html`,
    },
    '拾光客服服务已启动'
  );

  const cleanupTimer = setInterval(() => {
    void container.authService.cleanup().catch((error) => {
      logger.error({ error }, 'Session cleanup failed');
    });
  }, 10 * 60 * 1000);
  cleanupTimer.unref();

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down');

    clearInterval(cleanupTimer);
    gateway.stop();

    const forceExit = setTimeout(() => process.exit(0), 3000);
    forceExit.unref();

    const serverClosed = new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    await container.repository.flush();
    await serverClosed;
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    logger.fatal({ port: config.port }, '端口已被占用，请关闭占用程序或修改 PORT。');
  } else {
    logger.fatal({ error }, '服务启动失败');
  }
  process.exit(1);
});
