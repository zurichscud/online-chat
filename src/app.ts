import express, { type Express } from 'express';

import type { AppConfig } from '@/config.js';
import type { AuthService } from '@/services/auth.service.js';
import type { ChatService } from '@/services/chat.service.js';
import type { PresencePort } from '@/types.js';
import { errorHandler } from '@/middleware/error-handler.js';
import { notFoundHandler } from '@/middleware/not-found.js';
import { requestContext } from '@/middleware/request-context.js';
import { createApiRouter } from '@/routes/index.js';

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

  app.use('/api', createApiRouter(dependencies));

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
