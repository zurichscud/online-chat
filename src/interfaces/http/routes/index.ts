import { Router } from 'express';

import type { AppConfig } from '../../../config/env';
import type { ChatService } from '../../../application/services/chat.service';
import type { PresencePort } from '../../../domain/ports/presence.port';
import { createAuthController } from '../controllers/auth.controller';
import { createHealthController } from '../controllers/health.controller';
import { createWidgetController } from '../controllers/widget.controller';
import { createAuthRouter } from './auth.routes';

export interface ApiRouterDependencies {
  config: AppConfig;
  chatService: ChatService;
  presence: PresencePort;
  authController: ReturnType<typeof createAuthController>;
}

export function createApiRouter(dependencies: ApiRouterDependencies): Router {
  const router = Router();

  router.use('/agent', createAuthRouter(dependencies.authController));
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
