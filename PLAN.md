# 后续优化计划：MySQL + Redis 持久化

> 状态：待开始（本文件只描述计划，当前系统仍使用 `data/store.json`；后端已完成 TypeScript 分层重构）
>
> 目标版本：v3.0
>
> 最后更新：2026-10-21

## 1. 背景

当前版本是一个可运行的单进程演示系统：

- `src/infrastructure/persistence/json-conversation.repository.ts` 将全部会话和消息写入单个 JSON 文件。
- 在线状态、客服令牌、登录限流和连接状态都保存在 Node.js 进程内存中。
- WebSocket 广播只在当前进程内完成。
- 会话列表一次返回全部会话，消息一次返回全部历史，最多保留 500 条。

这些选择让项目可以零依赖启动，但也带来明显限制：

| 当前限制 | 影响 |
| --- | --- |
| 单文件 JSON | 数据量增长后读写变慢，无法支撑多实例并发写入 |
| 进程内在线状态 | 多个 Node 实例之间无法共享客服/访客状态 |
| 进程内令牌 | 服务重启后客服需要重新登录；无法多实例共享 |
| 进程内广播 | 客户连接实例 A、客服连接实例 B 时消息不能互通 |
| 无分页 | 会话多、消息多时首屏负载不可控 |
| 直接覆盖写入 | 没有事务保障，异常退出可能丢失最后一批消息 |
| 无账号体系 | 单个共享密码，无法支持多客服和操作审计 |

这次优化的目标是：**以 MySQL 作为持久化事实来源，以 Redis 作为在线状态与跨实例通信层**，同时保持当前 WebSocket 协议和前端交互基本不变。

## 2. 目标与非目标

### 2.1 目标

1. 会话、消息、访客、客服账号保存到 MySQL，服务重启不丢数据。
2. Redis 承载客服登录令牌、在线状态、输入中状态、限流计数和跨实例 Pub/Sub。
3. 支持至少 2 个 Node.js WebSocket 实例，无需粘性会话也能互通消息。
4. 为会话列表和历史消息增加分页，避免一次性加载全部数据。
5. 提供从现有 JSON 数据到 MySQL 的可重复、可校验迁移脚本。
6. 保持现有客户端组件与工作台的主要交互不变，协议做向后兼容的小幅扩展。
7. 为后续多客服、会话分配和审计留出数据库结构。

### 2.2 非目标（本阶段不做）

- 多租户与 SaaS 计费
- 文件、图片、语音消息
- 完整 RBAC 权限系统、SSO
- 客服排班、工单、机器人/AI 自动回复
- 消息全文检索（先使用 MySQL 索引，后续可接 OpenSearch）
- Kafka 等重型消息总线
- 跨地域部署

## 3. 目标架构

```text
                     HTTPS / WSS
  ┌──────────────┐        │         ┌────────────────────────────┐
  │ 客户端页面    │        │         │ 反向代理 / 负载均衡          │
  │ widget.js    │◄───────┴────────►│                            │
  └──────────────┘                  └─────────┬──────────┬───────┘
                                              │          │
                              ┌───────────────▼──┐  ┌────▼─────────────┐
                              │ Node 实例 A      │  │ Node 实例 B      │
                              │ Express + ws     │  │ Express + ws     │
                              └───────┬──────┬───┘  └──────┬──────┬───┘
                                      │      │             │      │
                         ┌────────────▼──┐ ┌─▼─────────────▼──┐   │
                         │ MySQL 8       │ │ Redis 7          │   │
                         │ 持久化事实来源 │ │ 状态 / 缓存 / 广播│◄──┘
                         └───────────────┘ └──────────────────┘
                                      ▲
                              ┌───────┴────────┐
                              │ 客服工作台      │
                              │ agent.html      │
                              └────────────────┘
```

### 3.1 职责划分

**MySQL = Source of Truth**

- 访客、客服账号
- 会话及状态
- 全部消息
- 未读计数（权威值）
- 最近消息摘要、时间戳
- 后续的分配、审计记录

**Redis = Ephemeral State / Coordination**

- 客服登录会话令牌（可 TTL 过期）
- 在线状态与心跳
- 输入中状态（短 TTL）
- 登录与消息频率限制
- 跨 Node 实例的事件广播
- 可选的热数据缓存（会话摘要）
- 可选的会话状态变更锁

> 原则：**Redis 可以丢，业务数据不能丢。** 任何用户可见的消息、未读数、会话状态都必须先提交到 MySQL，再更新/发布 Redis 事件。

## 4. 技术选型

| 组件 | 选择 | 说明 |
| --- | --- | --- |
| MySQL 驱动 | `mysql2/promise` | 支持连接池、预处理语句、事务 |
| Redis 客户端 | `ioredis` | 支持 Pub/Sub、Lua、自动重连，API 成熟 |
| 密码哈希 | `argon2` | 客服密码使用 Argon2id |
| 数据校验 | 原生代码 + 环境变量校验函数 | 暂不引入 ORM，保持查询可控 |
| 数据库迁移 | 手写 SQL + 迁移 runner | 轻量、易审计；后续团队需要可换 Prisma/Knex |
| 本地依赖 | `docker-compose.yml` | MySQL 8.0 + Redis 7 + 可选 Adminer |

新增生产依赖：

```bash
npm install mysql2 ioredis argon2
```

不建议在本次改造中引入 ORM。现有查询量小且结构清晰，使用 `mysql2` + Repository 层可以更直接地控制事务和索引，也便于把 JSON 适配器保留为测试替身。

## 5. MySQL 数据模型

数据库名示例：`shiguang_chat`，字符集 `utf8mb4`，排序规则 `utf8mb4_0900_ai_ci`，时间统一存储为 UTC。

### 5.1 访客

```sql
CREATE TABLE visitors (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  name         VARCHAR(64) NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

### 5.2 客服账号

```sql
CREATE TABLE agents (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_agents_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

说明：

- 首次实现时，可以通过环境变量 `AGENT_NAME` / `AGENT_PASSWORD` 在启动时创建默认客服，并只保留这一条演示数据。
- 生产模式下密码必须使用 Argon2id 哈希，不再明文比较。
- 客服登录令牌不写入 MySQL，由 Redis 管理 TTL；主动退出时删除对应 Redis key。

### 5.3 会话

```sql
CREATE TABLE conversations (
  id                 CHAR(36)      NOT NULL PRIMARY KEY,
  visitor_id         CHAR(36)      NOT NULL,
  assigned_agent_id  CHAR(36)      NULL,
  status             ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  entry_page         VARCHAR(512)  NOT NULL DEFAULT '',
  user_agent         VARCHAR(512)  NOT NULL DEFAULT '',
  unread_for_agent   INT UNSIGNED  NOT NULL DEFAULT 0,
  unread_for_visitor INT UNSIGNED  NOT NULL DEFAULT 0,
  last_message_id    BIGINT UNSIGNED NULL,
  last_message_at    DATETIME(3)   NULL,
  created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  active_visitor_id  CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN status = 'open' THEN visitor_id ELSE NULL END
  ) STORED,
  UNIQUE KEY uq_conversations_active_visitor (active_visitor_id),
  KEY idx_conversations_updated (updated_at DESC),
  KEY idx_conversations_status_updated (status, updated_at DESC),
  KEY idx_conversations_assigned (assigned_agent_id, status, updated_at DESC),
  CONSTRAINT fk_conversations_visitor FOREIGN KEY (visitor_id) REFERENCES visitors (id),
  CONSTRAINT fk_conversations_agent FOREIGN KEY (assigned_agent_id) REFERENCES agents (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

说明：

- `active_visitor_id` 生成列保证**每个访客同一时间只能有一个 open 会话**，同时允许历史 closed 会话保留。
- 访客姓名以 `visitors.name` 为准；会话中保留 `entry_page`、`user_agent` 作为本次会话的来源。
- `unread_for_agent` / `unread_for_visitor` 是权威未读数，首版不做 Redis 未读计数，避免缓存丢失导致“消息消失”。
- `last_message_id` 不建外键，避免 `messages` 与 `conversations` 循环引用；由服务层在同一事务内更新。
- `assigned_agent_id` 为后续多客服分配预留。

### 5.4 消息

```sql
CREATE TABLE messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id CHAR(36)        NOT NULL,
  role            ENUM('visitor', 'agent', 'system') NOT NULL,
  author_name     VARCHAR(64)     NOT NULL DEFAULT '',
  content         TEXT            NOT NULL,
  client_id       VARCHAR(64)     NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_messages_client (conversation_id, role, client_id),
  KEY idx_messages_conversation_id (conversation_id, id),
  CONSTRAINT fk_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

说明：

- 消息使用自增 `BIGINT` 作为稳定排序和游标分页依据；在 HTTP / WebSocket JSON 中统一转成字符串，避免 JavaScript 数值精度问题。
- `(conversation_id, role, client_id)` 唯一索引实现幂等：客户端重连重发相同消息不会重复写入；`client_id` 为 `NULL` 的消息不受影响。
- 没有 `clientId` 的消息必须写 `NULL`，不能写空字符串，否则唯一索引会把第二条无 `clientId` 的消息判为重复。
- `content` 保留纯文本，不存 HTML；渲染继续使用 `textContent`。
- 一条消息最多 2000 字符，仍由应用层校验。

### 5.5 可选审计表（Phase 4）

```sql
CREATE TABLE audit_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id CHAR(36)        NULL,
  actor_type      ENUM('visitor', 'agent', 'system') NOT NULL,
  actor_id        CHAR(36)        NULL,
  event           VARCHAR(64)     NOT NULL,
  payload         JSON            NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_conversation (conversation_id, id),
  KEY idx_audit_event_time (event, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

用于记录 `login`、`conversation_closed`、`conversation_reopened`、`message_deleted` 等关键动作。

## 6. Redis Key 设计

所有 key 统一使用 `chat:` 前缀；时间使用 UTC 毫秒时间戳。

| Key | 类型 | TTL | 用途 |
| --- | --- | --- | --- |
| `chat:session:agent:{tokenHash}` | String/JSON | 12h | 客服登录令牌，value 包含 `agentId`、`name`、`issuedAt` |
| `chat:presence:visitor:{visitorId}` | ZSET | 60s | member 为连接 ID，score 为过期时间；每个标签页一个连接 |
| `chat:presence:agent:{agentId}` | ZSET | 60s | 客服多 tab / 多实例在线连接 |
| `chat:presence:agents` | ZSET | 60s | 在线客服列表，供客户端显示“客服在线” |
| `chat:panel:visitor:{visitorId}` | String | 60s | 客户聊天面板是否打开且可见；关闭/隐藏时删除 |
| `chat:focus:conversation:{id}` | ZSET | 60s | 当前正在查看该会话的客服连接，member 为 `agentId:connId` |
| `chat:typing:agent:{visitorId}` | String | 5s | 客服正在输入 |
| `chat:typing:visitor:{visitorId}` | String | 5s | 客户正在输入 |
| `chat:rate:login:{ip}` | String | 10min | 登录失败计数 |
| `chat:rate:msg:{actorId}` | String | 10s | 消息频率计数 |
| `chat:cache:conversation:{id}` | String/JSON | 10–30s | 可选的会话摘要缓存，写操作后主动失效 |
| `chat:lock:conversation:{id}` | String | 5s | 可选的会话状态/分配分布式锁 |

### 6.1 在线状态

- 连接建立时：`ZADD chat:presence:visitor:{visitorId} {connId} {expiresAt}`，并刷新 key TTL。
- 心跳（20s）：更新自己 member 的 score；服务端定期 `ZREMRANGEBYSCORE` 清理过期连接。
- 断开连接：`ZREM` 当前 `connId`；最后一个连接移除后，key 自然过期。
- 查询某访客是否在线：清理过期 member 后检查 `ZCARD`；查询客服时同理。
- 客服在线列表：`ZADD chat:presence:agents {agentId} {expiresAt}`；客服主动退出/最后一个连接关闭时移除。
- 多实例下每个节点只写自己的连接，因此不会互相覆盖。

### 6.2 面板与客服焦点

未读行为依赖两个短 TTL 状态：

- **客户面板打开**：`SET chat:panel:visitor:{visitorId} 1 EX 60`；面板关闭或页面隐藏时 `DEL`；打开期间每 20 秒刷新 TTL。客服回复时若该 key 存在，`unread_for_visitor = 0`。
- **客服正在查看会话**：客服 `agent:open` 时，将 `agentId:connId` 写入 `chat:focus:conversation:{conversationId}` ZSET，并定期刷新过期分数；`agent:blur`、切换会话或断连时移除。访客新消息到达时，若清理过期 member 后 ZCARD > 0，则保持 `unread_for_agent = 0`，否则原子加一。

这两个 key 只用于决定**是否增加未读**，未读数的最终值仍写回 MySQL。TTL 让进程崩溃或网络断开后状态自动失效，避免永久抑制未读。

### 6.3 跨实例广播

使用 Redis Pub/Sub，频道：`chat:events`。

事件信封：

```json
{
  "eventId": "uuid",
  "sourceNodeId": "node-a",
  "type": "message",
  "target": { "kind": "visitor", "visitorId": "..." },
  "payload": {},
  "ts": "2026-10-20T12:00:00.000Z"
}
```

- 消息写入 MySQL 并提交事务后，发布事件。
- 每个 Node 实例都订阅该频道；收到事件后只投递给本机持有的目标 WebSocket。
- 通过 `sourceNodeId` 跳过本节点重复投递（本节点在发布前已直接发送）。
- Pub/Sub 是 at-most-once：消息已经持久化，客户端重连时用 `sinceMessageId` 从 MySQL 补齐，因此可接受。
- 后续如果要求更强的实时投递保证，可替换为 Redis Streams + consumer group；当前不引入。

### 6.4 令牌与限流

- 登录成功后生成随机 token，Redis 只保存 `SHA-256(token)` 对应的 value；明文 token 只返回给客户端浏览器。
- 登录失败计数使用 `INCR` + `EXPIRE`，成功登录后删除。
- 消息限流使用 `INCR` + `PEXPIRE`，也可以用 Lua 原子完成。
- 客服 logout 删除 token key；token 过期后 WebSocket 需重新登录。
- Redis 重启丢令牌是可接受的：客服重新登录即可，不能因此丢失任何业务数据。

## 7. 后端改造

### 7.1 当前分层与适配器位置

后端已完成 TypeScript 分层重构，MySQL / Redis 适配器应放入现有边界，而不是另起一套目录：

```text
src/
├── domain/
│   ├── entities/
│   ├── ports/                     # Repository / Presence / Publisher 端口
│   └── errors.ts
├── application/
│   ├── dto/
│   ├── mappers/
│   └── services/                  # ChatService / AuthService
├── infrastructure/
│   ├── persistence/
│   │   ├── json-conversation.repository.ts
│   │   ├── mysql/                 # 新增：连接池、事务、Repository
│   │   │   ├── mysql-pool.ts
│   │   │   ├── migrate.ts
│   │   │   ├── migrations/
│   │   │   │   ├── 001_init.sql
│   │   │   │   └── 002_audit.sql
│   │   │   ├── mysql-conversation.repository.ts
│   │   │   └── mysql-message.repository.ts
│   │   └── ...
│   ├── auth/
│   │   ├── in-memory-agent-session.repository.ts
│   │   └── redis-agent-session.repository.ts   # 新增
│   ├── cache/
│   │   ├── redis-client.ts        # 新增
│   │   ├── redis-presence.ts      # 实现 PresencePort
│   │   ├── redis-rate-limiter.ts  # 新增
│   │   └── redis-event-publisher.ts
│   └── realtime/                  # WS 网关、Hub、socket controllers
├── interfaces/http/
├── shared/
├── config/
├── app.ts
├── container.ts                   # 按 STORAGE_DRIVER / REDIS_URL 装配
└── server.ts
scripts/
├── migrate-json-to-mysql.ts
└── export-mysql-to-json.ts        # 回滚预案
```

`src/server.ts` 只负责启动与生命周期；`src/container.ts` 是唯一装配点；HTTP 与 WebSocket 适配器不直接做持久化。业务规则继续留在 `src/application/services/chat.service.ts`。

### 7.2 Storage 抽象

当前 `src/domain/ports/conversation.repository.ts` 以会话聚合为单位保存，适合 JSON 适配器。进入 MySQL 阶段后建议拆成三个端口：

```ts
// 目标形态（TypeScript 伪代码）
interface ConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  findByVisitorId(visitorId: string): Promise<Conversation | null>;
  list(filter: ConversationFilter, page: PageRequest): Promise<ConversationPage>;
  create(input: NewConversation): Promise<Conversation>;
  updateState(id: string, patch: ConversationStatePatch): Promise<void>;
  delete(id: string): Promise<boolean>;
}

interface MessageRepository {
  append(input: NewMessage, tx: Transaction): Promise<StoredMessage>;
  findByClientId(conversationId: string, role: MessageRole, clientId: string): Promise<StoredMessage | null>;
  listPage(conversationId: string, beforeId: string | null, limit: number): Promise<MessagePage>;
}

interface TransactionManager {
  withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}
```

原因：`save(整个 conversation)` 对 JSON 很方便，但 MySQL 不应在每条消息时重写整段会话。Conversation 状态、Message 插入和未读更新必须通过事务组合。

通过环境变量切换：

```env
STORAGE_DRIVER=mysql   # mysql | json
```

- `mysql` 为生产/默认目标。
- `json` 仅保留给快速本地演示和部分单元测试，功能上不做多实例保证。
- 迁移完成后可以删除 JSON 写入路径，或将其标记为 `deprecated`。

### 7.3 消息写入流程

以客户发送消息为例：

```text
接收 visitor:message
  ↓
校验长度 / 频率限制（Redis）
  ↓
开启 MySQL 事务
  ├─ 必要时将 closed 会话重新置为 open
  ├─ 按 clientId 检查是否已存在，存在则返回旧消息
  ├─ INSERT messages
  ├─ UPDATE conversations: last_message_id, last_message_at,
  │  unread_for_agent = unread_for_agent + 1 (无客服 focus 时)
  └─ COMMIT
  ↓
失效会话摘要缓存
  ↓
发布 chat:events: message
  ↓
本机直接投递 WebSocket
```

- **事务提交后再广播**，避免客户端收到一条数据库里不存在的消息。
- 未读数的更新与消息插入必须同一事务。
- 客服回复时，若客户当前面板打开（通过 Redis presence/panel 状态判断），`unread_for_visitor` 归零；否则加一。
- `agent:open` / `visitor:read` 使用单条 `UPDATE` 清零并广播摘要更新。
- 客服结束会话：事务内更新 `status` + 插入 system message + 更新 `last_message_*`。
- 同一会话的 `agent:setStatus` 可选加 Redis 短锁，避免两个客服同时操作造成状态竞争。

### 7.4 会话列表与历史分页

当前 `sortedSummaries()` 和 `fullConversation()` 会全量返回，需要改为：

- 会话列表：
  - 通过 WebSocket `agent:list` 请求，支持 `status`、`query`、`cursor`、`limit`（默认 30，最大 100）。
  - 搜索先使用 `visitor.name LIKE`、`entry_page LIKE` 和最近消息内容前缀匹配；数据量大后再接全文索引。
- 历史消息：
  - `agent:open` 返回最近 50 条 + `hasMoreBefore` + `nextBeforeId`。
  - 新增 `agent:history` / `visitor:history` 加载更早消息。
  - 游标使用 `messages.id < beforeId ORDER BY id DESC LIMIT n`，返回前反转成时间正序。
- 断线补偿：
  - `visitor:hello` / `agent:hello` 增加可选 `sinceMessageId`。
  - 服务端返回该会话在 `sinceMessageId` 之后的消息，避免重连后只能看到未读摘要。
  - 客户端按消息 ID 去重合并，保持当前 UI 不重复、不乱序。

### 7.5 认证

- 新增 `agents` 账号表和 Argon2id。
- 首版可以保留一个由环境变量初始化的演示账号，避免破坏当前演示体验。
- 登录返回短 token；WebSocket `agent:hello` 通过 Redis 校验。
- 生产环境移除“明文共享密码直接比较”，并在启动时强制要求 `AGENT_PASSWORD` 被哈希后写入数据库或由管理脚本创建账号。

## 8. 前端改造

### 8.1 客服工作台 `agent.js`

- 会话列表状态改为服务端分页；筛选/搜索触发带游标的查询。
- 打开会话时只加载最近一页；滚动到顶部加载更早消息，并保持滚动位置。
- 消息 ID 统一当作字符串处理，使用 Map 去重。
- 重连时带上当前会话的 `sinceMessageId`，合并缺失消息。
- 除消息 ID 格式变化外，工作台的现有交互保持不变。
- 可选：在“客户信息”中显示 `assigned_agent_id` 和更完整的时间线。

### 8.2 客户端组件 `widget.js`

- `visitor:ready` 接收分页字段；仅渲染最近 50 条。
- 增加“加载更早消息”按钮或滚动触顶加载。
- 重连时发送本地最后一条已确认消息 ID，补齐断线期间消息。
- 仍保持 Shadow DOM 和单文件接入方式。
- 离线留言仍写入 MySQL，不依赖 Redis。

### 8.3 协议兼容

- 现有字段不删除，只新增：
  - `hasMoreBefore`、`nextBeforeId`
  - `sinceMessageId`
  - `cursor`、`limit`
- JSON 中的 message `id` 从 UUID 变为数字字符串时，前端不得做数值运算或大小比较；统一以服务端顺序为准。
- 可增加协议版本 `protocolVersion: 2`，服务端兼容 v1 一段时间。

## 9. JSON 数据迁移

新增脚本：`scripts/migrate-json-to-mysql.ts`

### 9.1 执行步骤

1. 停止旧服务，备份 `data/store.json`。
2. 校验 JSON 结构：会话 ID、访客 ID、消息角色、时间、长度。
3. 在一个 MySQL 事务中：
   - 写入 `visitors`（按 visitorId 去重）。
   - 写入 `agents`（至少一个默认客服）。
   - 写入 `conversations`，保留原 UUID，映射 status/page/userAgent。
   - 写入 `messages`，按原时间插入；记录旧 ID 到新 `BIGINT` 的映射。
   - 回填 `last_message_id`、`last_message_at`、未读数。
4. 校验：
   - 会话数一致；
   - 每个会话消息数一致；
   - 首尾消息内容和时间一致；
   - 未读数不为负；
   - 每个访客最多一个 open 会话。
5. 将迁移结果摘要输出到控制台，并写入 `schema_migrations` / 迁移日志。
6. 切换 `STORAGE_DRIVER=mysql`，启动新服务，执行冒烟流程。

### 9.2 幂等与重跑

- 使用会话 ID 和消息 `client_id` 做幂等键。
- 重跑时跳过已导入的会话；消息冲突时记录并跳过，不覆盖线上新消息。
- 迁移失败默认整体回滚，不留下半成品数据。
- 时间统一从 ISO 字符串转换为 UTC `DATETIME(3)`。
- 超过字段长度的 page / userAgent 截断并记录警告。

### 9.3 回滚

- 切换前保留 JSON 全量备份。
- 提供 `scripts/export-mysql-to-json.ts`，在切换后需要回退时把 MySQL 数据导出为当前 `Store` 格式，避免回滚丢失新消息。
- 回滚窗口内关闭写入，导出、恢复、重启 `STORAGE_DRIVER=json`；回滚完成后进行一致性核对。

## 10. 部署与配置

### 10.1 Docker Compose

新增 `docker-compose.yml`：

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: shiguang_chat
      MYSQL_USER: chat
      MYSQL_PASSWORD: chat_dev_password
      MYSQL_ROOT_PASSWORD: root_dev_password
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u root -p$$MYSQL_ROOT_PASSWORD --silent"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  mysql-data:
  redis-data:
```

### 10.2 环境变量

新增 `.env.example`：

```env
PORT=3000
STORAGE_DRIVER=mysql

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=chat
MYSQL_PASSWORD=chat_dev_password
MYSQL_DATABASE=shiguang_chat
MYSQL_CONNECTION_LIMIT=10

REDIS_URL=redis://127.0.0.1:6379

AGENT_NAME=小满
AGENT_PASSWORD=demo123

# 可选
NODE_ID=node-a
LOG_LEVEL=info
```

- `.env` 不提交到仓库，`.env.example` 可以提交。
- Redis 生产环境开启密码和 TLS；MySQL 使用独立最小权限账号。
- 健康检查拆分：
  - `GET /api/health` → 进程存活
  - `GET /api/ready` → MySQL + Redis 可用 + migration 版本正确

### 10.3 多实例

- Node 服务本身无状态，WebSocket 可落到任意实例。
- 每个实例启动时生成 `NODE_ID`（或从环境变量读取）。
- 所有实例连接同一 Redis 和 MySQL。
- 反向代理需要支持 WebSocket upgrade 和足够的空闲超时。
- 停止服务时依次：停止接收新连接 → 关闭 WebSocket → 刷新落库 → 关闭连接池/Redis。

## 11. 测试计划

### 11.1 保持现有测试

- 现有 `test/smoke.js` 在 `STORAGE_DRIVER=json` 下继续通过。
- 增加 `STORAGE_DRIVER=mysql` 模式，连接专用测试库和 Redis DB。
- 测试数据库需每次清空或在事务中隔离，禁止指向开发/生产库。

### 11.2 新增测试用例

| 用例 | 验证点 |
| --- | --- |
| 消息事务 | 插入消息失败时未读数不增加 |
| 幂等 | 同一 `clientId` 重发只产生一条记录 |
| 分页 | 100 条消息分页无重复、无遗漏、顺序正确 |
| 未读 | 打开会话清零、关闭页面后新增消息加一 |
| 活跃会话约束 | 同一访客不能同时存在两个 open 会话 |
| Redis 掉线 | 业务读写的行为符合降级策略，不丢已提交消息 |
| 令牌 | Redis 中令牌过期后 WS 拒绝连接 |
| 跨实例 | 客户连 A、客服连 B，消息能通过 Pub/Sub 到达 |
| 断线补偿 | 携带 `sinceMessageId` 重连能补齐消息 |
| 迁移 | 样例 JSON 导入后会话、消息、未读数完全一致 |

### 11.3 跨实例测试

本地启动两个 Node 实例（不同端口、同一 Redis/MySQL），用两个 WebSocket 客户端分别连接不同实例：

```text
visitor -> ws://localhost:3001/ws
agent   -> ws://localhost:3002/ws
```

验证：

1. 客户消息写入 MySQL；
2. 实例 A 发布 Pub/Sub；
3. 实例 B 收到并推送给客服；
4. 客服回复反向送达；
5. 会话摘要和未读状态在两端一致。

### 11.4 验收标准

- [ ] 服务重启后，会话与消息仍可完整读取。
- [ ] 两个 Node 实例之间消息双向送达。
- [ ] Redis 重启后消息不丢，客服重新登录后在线状态恢复。
- [ ] 现有 `npm test` 全部通过，并新增 MySQL/Redis 测试套件。
- [ ] JSON 迁移后会话数、消息数、最后一条消息、未读数一致。
- [ ] 100 条会话 / 10,000 条消息下，会话列表首屏 p95 < 300ms。
- [ ] 浏览器控制台无报错，桌面与移动端交互不回退。
- [ ] 关闭 Redis 或 MySQL 时错误可观测、可恢复，不出现静默丢消息。

## 12. 分阶段实施

预计总工作量：**6–8 个开发日**（单人估算，不含生产环境审批与运维窗口）。

### Phase 0：基线与设计（0.5 天）

- [ ] 确认 MySQL 8 / Redis 7 版本与部署环境。
- [ ] 固化环境变量、迁移版本和回滚负责人。
- [ ] 备份当前 JSON 数据。
- [ ] 把现有 `test/smoke.js` 参数化为可切换存储驱动。

### Phase 1：MySQL 持久化（2 天）

- [ ] 增加 `mysql2`、连接池与健康检查。
- [ ] 编写 `001_init.sql`、迁移 runner。
- [ ] 扩展 Repository 端口：会话、消息、事务管理器。
- [ ] 实现 visitor / agent / conversation / message Repository。
- [ ] ChatService 从聚合式 JSON 保存切换到 MySQL Repository + 事务。
- [ ] 用事务实现消息写入、未读更新、关闭/重开会话。
- [ ] 保留 JSON 适配器，`npm test` 仍可离线运行。
- [ ] 完成 MySQL 版冒烟测试和分页查询。

### Phase 2：Redis 状态与跨实例（1.5 天）

- [ ] 接入 `ioredis`，实现连接重试和健康检查。
- [ ] 客服令牌迁入 Redis，补登出与 TTL。
- [ ] 在线状态按访客/客服连接写入 ZSET，加入心跳和过期清理。
- [ ] 输入中状态、登录限流、消息限流迁入 Redis。
- [ ] 实现 `chat:events` Pub/Sub，Node 实例间转发。
- [ ] 增加 `NODE_ID` 和订阅清理逻辑。
- [ ] 两实例本地联调。

### Phase 3：协议与前端分页（1.5 天）

- [ ] `agent:list` 支持 status/search/cursor/limit。
- [ ] `agent:open` 返回最近一页历史。
- [ ] 增加 `agent:history`、`visitor:history`。
- [ ] 增加 `sinceMessageId` 断线补偿。
- [ ] 工作台滚动加载、消息去重、滚动位置保持。
- [ ] 客户端组件加载更早消息。
- [ ] 检查移动端和现有 UI 完整回归。

### Phase 4：迁移、运维与测试（1.5 天）

- [ ] 编写 `migrate-json-to-mysql.js` 与校验输出。
- [ ] 编写 `export-mysql-to-json.js` 回滚工具。
- [ ] `docker-compose.yml`、`.env.example`、启动文档。
- [ ] 增加 `/api/ready`、连接池关闭、优雅停机。
- [ ] 完成跨实例、Redis 重启、MySQL 故障、迁移一致性测试。
- [ ] 更新 README、架构说明和部署手册。

### Phase 5：灰度与切换（0.5 天）

- [ ] 预发环境跑迁移演练。
- [ ] 维护窗口停止旧服务，迁移 JSON。
- [ ] 切换 `STORAGE_DRIVER=mysql`，启动新服务。
- [ ] 执行登录、发消息、收消息、关闭/重开、移动端全流程验收。
- [ ] 观察日志与错误率，确认后关闭 JSON 写入。
- [ ] 保留 JSON 备份与导出脚本至少一个发布周期。

## 13. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| Redis 未读计数与 MySQL 不一致 | 客户看到错误角标 | **未读只以 MySQL 为准**，Redis 不存权威未读 |
| Pub/Sub 丢事件 | 实时界面短暂不同步 | 消息已落库；重连带 `sinceMessageId` 补齐 |
| Redis 重启丢登录态 | 客服被登出 | 可接受；重新登录，业务数据不受影响 |
| MySQL 连接池耗尽 | 请求超时 | 限制池大小、设置查询超时、监控连接数 |
| 迁移遗漏消息 | 历史数据不完整 | 事务迁移 + 数量/首尾消息校验 + 回滚脚本 |
| 多实例重复投递 | 消息重复显示 | 前端按消息 ID 去重；Pub/Sub 跳过 sourceNodeId |
| 会话状态并发变更 | 重复关闭/重开 | `agent:setStatus` 使用短锁或带状态条件的 UPDATE |
| BIGINT 精度问题 | 消息 ID 被 JS 截断 | API 一律以字符串传输，禁止数值运算 |
| 大消息表变慢 | 历史加载慢 | `(conversation_id, id)` 索引 + 游标分页 + 归档策略 |

## 14. 后续可选优化（本计划之外）

完成 MySQL + Redis 后，可以继续推进：

- 多客服账号、角色权限、在线状态和自动分配
- Redis 分布式锁 + 会话转接
- 消息已读回执、撤回、附件上传（对象存储）
- 会话标签、客户备注、黑名单
- 客服工作日历与离线留言邮件通知
- 消息归档表 / 冷热分层，长时间历史查询
- Prometheus 指标、结构化日志、链路追踪
- Redis Streams 替代 Pub/Sub，提供更强的实时投递保证
- 管理后台：客服账号、数据统计、会话质检

---

**执行原则**：每一步都必须保持当前演示可运行；先让 MySQL 成为可靠的事实来源，再引入 Redis 提升多实例能力，最后做前端分页与迁移切换。任何阶段出现数据不一致，优先保住“消息已落库”这条底线。
