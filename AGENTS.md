# AGENTS.md

拾光客服：Express + ws + TypeScript 后端，`public/` 下是无构建的原生前端。文档和用户可见文案用中文。

## 命令

```bash
npm install
npm run dev        # tsx watch src/index.ts；不构建、不做类型检查
npm run typecheck  # 只检查 src/**/*.ts
npm run build      # tsc + tsc-alias -> dist/；不清理旧产物
npm start          # prestart 自动 build，再运行 dist/index.js
npm run clean      # 删除 dist/
npm test           # 仅用户明确要求时；build + test/smoke.cjs
npm run test:smoke # 仅用户明确要求时；复用现有 dist/
```

- 没有 lint / formatter / CI 配置，也没有 `npm run lint`；自查用 `npm run typecheck`。风格跟随现有代码（2 空格、单引号、分号）。
- `npm run build` 不清理 `dist/`；删除或重命名源文件后先 `npm run clean`，避免旧产物残留。
- 配置集中在 `src/config.ts`（Zod 启动校验，非法即退出）；新增环境变量要同步 `.env.example`。`DATA_FILE` 相对项目根目录解析。
- 源码是 ESM（`"type": "module"`）；内部导入统一使用 `@/` 别名并带 `.js` 后缀，例如 `@/services/chat.service.js`。开发时 `tsx` 读取 `tsconfig.json` 的 `paths`，构建时 `tsc-alias` 把别名改写为相对路径。

## 测试策略（必须遵守）

- **不主动进行测试，也不主动新增测试**：除非用户明确要求，不要运行 `npm test` / `npm run test:smoke`，也不要启动服务或用浏览器做手工验证。
- 默认只做静态验证：`npm run typecheck`；需要确认构建产物时再 `npm run build`。
- 唯一测试是 `test/smoke.cjs`，端到端启动随机端口 + 临时 `DATA_FILE`，覆盖登录、WS 消息、未读、`clientId` 去重和 JSON 持久化。没有单元测试，也不能筛选单个用例。
- `npm test` 会先 build；`npm run test:smoke` 不会，可能测到旧 `dist/`。`test/` 被 `tsconfig.json` 排除，`smoke.cjs` 是 CommonJS，不在类型检查范围。

## 架构

- 代码按 `routes` / `controllers` / `services` / `middleware` / `utils` 扁平组织；业务规则集中在 `src/services`，新持久化或状态适配器实现 `src/types.ts` 中的端口，在 `src/index.ts` 装配，不要写进 `ChatService`。
- `ConnectionHub` 同时实现 `PresencePort` 和 `ChatEventPublisher`；在线状态、未读判断和广播都在单进程内存，重启即丢。多实例/Redis 改造必须同时替换这两个端口。
- `ChatService` 的会话写操作都包在 `AsyncMutex` (`writeLock`) 里；新增会改消息、未读或会话状态的方法也要包，否则并发保存会互相覆盖。
- `JsonConversationRepository` 读取返回 `structuredClone`，改完必须 `save()` 才生效；写盘是 250ms debounce + 临时文件 rename，停机时 `src/index.ts` 调 `flush()`。
- 每个会话最多保留 500 条消息（`MAX_MESSAGES_PER_CONVERSATION`），超出截断最旧的；会话列表和历史都没有分页。
- `clientId` 按 role + clientId 去重，是断线重发不重复的关键；修改发送路径时必须保留。

## WebSocket 与 HTTP

- 单端点 `/ws`；连接后 10 秒内必须发 `visitor:hello` 或 `agent:hello`，之后按连接角色分发。实现在 `src/controllers/*.socket-controller.ts`，服务端事件类型在 `src/types.ts`。
- README 的事件表已过时：缺 `agent:read` / `agent:delete`，并列出未实现的 `agent:setStatus`；以控制器 `switch` 为准。
- 业务错误抛 `src/utils/errors.ts` 的 `AppError` 子类；HTTP 由 `error-handler` 转 `{ error }`，WS 转 `{ type: 'error' }`；客服认证失败发 `{ type: 'auth:error' }` 后以 4001 关闭。
- HTTP 路由在 `src/routes`；控制器负责 HTTP 参数解析与响应组装，业务规则放 service。静态文件直接来自 `public/`，`/widget.js` 允许任意来源跨域。

## 前端

- `public/` 无打包步骤，改完直接由 Express 提供（`maxAge: 0`），不需要 build。
- `widget.js` 是单文件 Shadow DOM 组件，通过 `data-*` 配置并暴露 `window.ShiguangChat`；样式必须留在 Shadow DOM 内，不能依赖宿主 CSS。
- 消息文本一律用 `textContent` 渲染；`innerHTML` 只用于固定模板（图标、空状态、加载态），不要把用户/客服内容拼进去。

## 数据与文档

- `data/store.json` 是运行时数据（已 gitignore）；删除即清空会话。解析失败时服务只记日志并按空库启动，后续写入会覆盖原文件，不要手改它来修 bug。
- `README.md` 是当前功能与配置说明；`PLAN.md` 是**尚未实施**的 MySQL + Redis v3 计划，当前仍是 JSON + 单进程，不要把计划当现状。
