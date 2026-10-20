import express, { type Express } from 'express';

import type { AppConfig } from './config/env';
import type { AuthService } from './application/services/auth.service';
import type { ChatService } from './application/services/chat.service';
import type { PresencePort } from './domain/ports/presence.port';
import { createAuthController } from './interfaces/http/controllers/auth.controller';
import { errorHandler } from './interfaces/http/middleware/error-handler';
import { notFoundHandler } from './interfaces/http/middleware/not-found';
import { requestContext } from './interfaces/http/middleware/request-context';
import { createApiRouter } from './interfaces/http/routes';

export interface AppDependencies {
  config: AppConfig;
  authService: AuthService;
  chatService: ChatService;
  presence: PresencePort;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestContext);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '32kb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const authController = createAuthController(dependencies.authService);
  app.use(
    '/api',
    createApiRouter({
      config: dependencies.config,
      chatService: dependencies.chatService,
      presence: dependencies.presence,
      authController,
    })
  );

  app.use(
    express.static(dependencies.config.publicDir, {
      etag: true,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('widget.js')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.get('/', (_req, res) => res.redirect('/demo.html'));
  app.get('/agent', (_req, res) => res.redirect('/agent.html'));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
