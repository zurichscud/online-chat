import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError } from '@/utils/errors.js';
import { logger } from '@/utils/logger.js';

/** express.json 请求体解析失败时抛出的错误形状。 */
interface BodyParserError {
  /** 错误类型，例如 entity.parse.failed。 */
  type?: string;
  /** HTTP 状态码。 */
  status?: number;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = res.locals.requestId as string | undefined;

  if (error instanceof ZodError) {
    res.status(400).json({ error: '请求参数无效。' });
    return;
  }

  const parserError = error as BodyParserError;
  if (parserError?.type === 'entity.parse.failed') {
    res.status(400).json({ error: '请求体格式不正确。' });
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(
        {
          error,
          requestId,
          method: req.method,
          path: req.originalUrl,
        },
        'HTTP application error'
      );
    }
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  logger.error(
    {
      error,
      requestId,
      method: req.method,
      path: req.originalUrl,
    },
    'Unhandled HTTP error'
  );
  res.status(500).json({ error: '服务器内部错误。' });
};
