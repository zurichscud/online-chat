import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

import { logger } from "@/utils/logger.js";

/**
 * 请求上下文中间件：为每个 HTTP 请求分配/复用 X-Request-Id，
 * 记录请求方法、路径、状态码与耗时，并写入响应头便于链路追踪。
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incomingId = req.headers["x-request-id"];
  const requestId =
    typeof incomingId === "string" && incomingId.length > 0
      ? incomingId
      : randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    // 记录请求日志
    const meta = {
      requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    };

    if (req.originalUrl.startsWith("/api/health")) {
      logger.debug(meta, "HTTP request");
    } else {
      logger.info(meta, "HTTP request");
    }
  });

  next();
};
