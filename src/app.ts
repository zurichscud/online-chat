import express, { type Express } from "express";

import type { AppConfig } from "@/config.js";
import type { AuthService } from "@/services/auth.service.js";
import type { ChatService } from "@/services/chat.service.js";
import type { PresencePort } from "@/types.js";
import { errorHandler } from "@/middleware/error-handler.js";
import { notFoundHandler } from "@/middleware/not-found.js";
import { requestContext } from "@/middleware/request-context.js";
import { createApiRouter } from "@/routes/index.js";

/** 创建 Express 应用所需的依赖。 */
export interface AppDependencies {
  /** 应用配置，用于静态资源目录等。 */
  config: AppConfig;
  /** 客服认证服务。 */
  authService: AuthService;
  /** 会话业务服务。 */
  chatService: ChatService;
  /** 在线状态查询端口。 */
  presence: PresencePort;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestContext);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use("/api", createApiRouter(dependencies));

  // 提供静态文件服务
  app.use(
    express.static(dependencies.config.publicDir, {
      etag: true,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith("widget.js")) {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  app.get("/", (_req, res) => res.redirect("/demo.html"));
  app.get("/agent", (_req, res) => res.redirect("/agent.html"));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
