import { Router } from 'express';

import type { AuthController } from '../controllers/auth.controller';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();
  router.post('/login', controller.login);
  router.post('/logout', controller.logout);
  return router;
}
