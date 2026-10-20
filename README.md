# 拾光客服 · 简易在线客服系统

一个可以直接运行的在线客服演示项目。客户在 `demo.html` 右下角的聊天框中发起咨询，客服在独立工作台中实时接收、回复并管理会话。

项目不依赖数据库或第三方服务，安装依赖后即可本地运行。

## 架构

```text
┌─────────────────────┐        WebSocket        ┌──────────────────────┐
│ demo.html           │ ◄─────────────────────► │ server.js            │
│ widget.js 聊天组件  │                         │ Express + ws + 鉴权  │
└─────────────────────┘                         └──────────┬───────────┘
                                                           │
┌─────────────────────┐        WebSocket                   │ JSON 持久化
│ agent.html          │ ◄─────────────────────►           ▼
│ 客服工作台          │                         ┌──────────────────────┐
└─────────────────────┘                         │ data/store.json      │
                                                └──────────────────────┘
```

- `widget.js` 是一个无框架依赖的单文件组件，可在任意页面通过一行 `<script>` 接入。
- 客户端和客服端都连接同一个 `/ws` 端点，由服务端负责会话、未读状态与在线状态的广播。

## 功能

**客户端（内嵌组件）**

- 右下角常驻客服气泡，可展开/收起聊天窗口
- Shadow DOM 样式隔离，嵌入任何页面都不会污染宿主样式
- 访客身份持久化，刷新页面后继续同一段会话
- 快捷提问、未读角标、输入中提示、连接状态
- 断线自动重连，未确认消息自动重发
- 客服离线时仍可留言
- 会话结束后可发送消息自动重新开启

**客服工作台**

- 密码登录（演示密码 `demo123`）
- 会话列表：搜索、全部 / 未读 / 进行中 / 已结束筛选
- 实时消息、未读计数、WebSocket 重连
- 客户在线状态、来源页面、首次咨询时间、设备信息
- 结束会话 / 重新开启会话
- 快捷回复、提示音、响应式移动端布局
- 页面标题显示未读总数

**后端**

- Node.js + Express + `ws`
- WebSocket 实时协议，支持访客与客服双向消息
- 登录令牌鉴权、登录尝试限流、消息频率限制
- 心跳检测、断连清理、在线状态广播
- 会话与消息持久化到 JSON 文件（原子写入）
- 所有消息以纯文本存储和渲染，前端不使用 `innerHTML` 插入用户内容

## 快速开始

```bash
npm install
npm start
```

启动后打开：

| 页面 | 地址 |
| --- | --- |
| 客户端演示 | http://localhost:3000/demo.html |
| 客服工作台 | http://localhost:3000/agent.html |
| 演示密码 | `demo123` |

### 演示流程

1. 打开客服工作台，使用密码 `demo123` 登录。
2. 打开 `demo.html`，点击右下角气泡，或在页面中点击「和咖啡师聊聊」。
3. 在客户端发送消息，工作台会实时收到并标记未读。
4. 在工作台回复，客户端聊天窗口会即时显示回复。
5. 试试关闭聊天窗口后让客服回复，客户端气泡会出现未读角标。

也可以打开两个浏览器标签页，一个当客户端、一个当客服，观察实时同步。

## 嵌入到任意页面

把客服组件脚本放到页面 `</body>` 前：

```html
<script
  src="http://localhost:3000/widget.js"
  defer
  data-title="拾光咖啡 · 在线客服"
  data-subtitle="通常 1 分钟内回复"
  data-color="#B4552D"
  data-prompts="推荐一款适合手冲的豆子|订单什么时候发货？|你们有线下门店吗？"
></script>
```

组件会自动在右下角渲染气泡和聊天面板，样式完全封装在 Shadow DOM 中。

### 可配置属性

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `data-title` | `拾光咖啡 · 在线客服` | 面板标题 |
| `data-subtitle` | `通常几分钟内回复` | 客服在线时的副标题 |
| `data-color` | `#B4552D` | 主题强调色 |
| `data-position` | `right` | `right` 或 `left` |
| `data-server` | 脚本所在服务器 | 后端地址，跨域嵌入时显式指定 |
| `data-prompts` | 内置三条 | 欢迎页快捷提问，用 `|` 分隔，最多 4 条 |

### JavaScript API

```js
window.ShiguangChat.open();                 // 打开聊天窗口
window.ShiguangChat.close();                // 关闭
window.ShiguangChat.toggle();               // 切换
window.ShiguangChat.isOpen();               // 是否已打开
window.ShiguangChat.ask('你好，想咨询…');    // 打开并自动发送一条消息
```

`demo.html` 中的商品卡片和「和咖啡师聊聊」按钮就是通过 `ask()` 接入的。

## 配置

通过环境变量覆盖默认配置：

```bash
PORT=3001 AGENT_PASSWORD=my-secret AGENT_NAME=小满 npm start
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP / WebSocket 端口 |
| `AGENT_PASSWORD` | `demo123` | 客服工作台登录密码 |
| `AGENT_NAME` | `小满` | 客服昵称 |
| `DATA_FILE` | `data/store.json` | 会话数据文件路径 |

## 测试

```bash
npm test
```

测试会启动一个隔离的服务实例（随机端口、临时数据文件），并通过真实的 HTTP + WebSocket 协议验证：

- 工作台登录与错误密码拒绝
- 访客连接、会话创建
- 客户消息送达客服、客服回复送达客户
- 未读 / 已读状态
- 双向输入中提示
- 会话结束与客户重新发起
- 无效客服令牌拒绝
- JSON 持久化
- 健康检查与静态组件服务

## 项目结构

```
online-chat/
├── public/
│   ├── demo.html        # 客户端演示页面
│   ├── demo.css
│   ├── widget.js        # 可嵌入聊天组件（Shadow DOM）
│   ├── agent.html       # 客服工作台
│   ├── agent.css
│   └── agent.js
├── lib/
│   └── store.js         # JSON 会话存储
├── test/
│   └── smoke.js         # 端到端冒烟测试
├── server.js            # Express + WebSocket 服务
├── data/                # 运行时生成（已在 .gitignore 中忽略）
├── package.json
└── README.md
```

## 设计说明

演示页面是一家虚构咖啡品牌「拾光咖啡」，所有视觉元素（包装、插画、纹理）均由 CSS / 内联 SVG / 内联脚本书写，不依赖外部图片或 CDN。客服工作台使用相同的暖色纸感体系，方便在演示中观察客户端与工作台的对应关系。

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/agent/login` | 使用密码换取客服令牌 |
| `POST` | `/api/agent/logout` | 注销令牌 |
| `GET` | `/api/health` | 服务与在线状态 |
| `GET` | `/api/widget-config` | 客服在线配置 |
| `GET` | `/ws` | WebSocket 实时连接 |

## WebSocket 事件

客户端发送：

- `visitor:hello` / `visitor:message` / `visitor:typing` / `visitor:read` / `visitor:panel`
- `agent:hello` / `agent:open` / `agent:message` / `agent:typing` / `agent:blur` / `agent:setStatus` / `agent:list`

服务端推送：

- `visitor:ready` / `agent:ready` / `message` / `conversation:update` / `conversation:history`
- `typing` / `agent:presence` / `auth:error` / `error`

消息通过可选的 `clientId` 去重，客户端重连后可以安全重发未确认消息。

## 演示限制

这是用于学习与演示的简易实现，投入生产前建议补充：

- 数据库（PostgreSQL / Redis）替代单文件 JSON
- 多客服、分配规则、排队与转接
- 正式的身份认证、令牌过期刷新与权限控制
- 文件/图片消息、消息撤回、历史分页
- HTTPS + WSS、反向代理与跨域白名单
- 审计日志、数据留存与隐私合规

---

页面内容为演示虚构 · Built with Node.js + WebSocket
