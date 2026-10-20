import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { logger } from '../../../shared/logger';

export const requestContext: RequestHandler = (req, res, next) => {
  const incomingId = req.headers['x-request-id'];
  const requestId =
    typeof incomingId === 'string' && incomingId.length > 0
      ? incomingId
      : randomUUID();

  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const meta = {
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    };

    if (req.originalUrl.startsWith('/api/health')) {
      logger.debug(meta, 'HTTP request');
    } else {
      logger.info(meta, 'HTTP request');
    }
  });

  next();
};
