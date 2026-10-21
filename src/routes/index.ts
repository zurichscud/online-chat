import { Router } from 'express';

import type { AppConfig } from '@/config.js';
import type { AuthService } from '@/services/auth.service.js';
import type { ChatService } from '@/services/chat.service.js';
import type { PresencePort } from '@/types.js';
import { createAuthController } from '@/controllers/agent.controller.js';
import { createHealthController } from '@/controllers/health.controller.js';
import { createWidgetController } from '@/controllers/widget.controller.js';

/** 挂载 /api 路由所需的依赖。 */
export interface ApiRouterDependencies {
  /** 应用配置。 */
  config: AppConfig;
  /** 客服认证服务。 */
  authService: AuthService;
  /** 会话业务服务。 */
  chatService: ChatService;
  /** 在线状态查询端口。 */
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
