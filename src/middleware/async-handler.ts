import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** 返回 Promise 的 Express 路由处理器。 */
type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
