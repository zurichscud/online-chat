import { Router } from 'express';

import type { AppConfig } from '@/config.js';
import type { AuthService } from '@/services/auth.service.js';
import type { ChatService } from '@/services/chat.service.js';
import type { PresencePort } from '@/types.js';
import { createAuthController } from '@/controllers/agent.controller.js';
import { createHealthController } from '@/controllers/health.controller.js';
import { createWidgetController } from '@/controllers/widget.controller.js';

export interface ApiRouterDependencies {
  config: AppConfig;
  authService: AuthService;
  chatService: ChatService;
  presence: PresencePort;
}

export function createApiRouter(dependencies: ApiRouterDependencies): Router {
  const router = Router();
  const authController = createAuthController(dependencies.authService);

  const agentRouter = Router();
  agentRouter.post('/login', authController.login);
  agentRouter.post('/logout', authController.logout);

  router.use('/agent', agentRouter);
  router.get(
    '/health',
    createHealthController(dependencies.chatService, dependencies.presence)
  );
  router.get(
    '/widget-config',
    createWidgetController(dependencies.config, dependencies.presence)
  );

  return router;
}
