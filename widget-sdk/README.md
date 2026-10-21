# @shiguang/chat-widget

拾光客服的可嵌入聊天组件，TypeScript + esbuild 构建，产物是无框架依赖的单文件脚本。

- Shadow DOM 样式隔离，不影响宿主页面
- 通过 `<script>` 的 `data-*` 属性配置，暴露 `window.ShiguangChat`
- 也可用 ESM 入口 `createChatWidget()` 编程式创建
- WebSocket 断线自动重连，未确认消息自动重发

## 开发

```bash
npm install
npm run typecheck
npm run build   # 同时更新 ../public/widget.js
npm run dev     # 监听 src/，重新生成 ../public/widget.js
```

构建产物：

| 文件 | 说明 |
| --- | --- |
| `dist/widget.js` | 未压缩 IIFE |
| `dist/widget.min.js` | 压缩 IIFE，适合 CDN |
| `dist/widget.esm.js` | ESM 入口，适合打包工具 |
| `dist/types/` | TypeScript 类型声明 |
| `../public/widget.js` | 由 Express 直接提供；不要手改 |

## 目录

```text
src/
├── index.ts       # IIFE 入口：读取当前 script 的 data-* 并自动挂载
├── sdk.ts         # ESM 入口：导出 createChatWidget
├── widget.ts      # 控制器：生命周期、打开/已读、发送
├── transport.ts   # WebSocket 建连、事件解析、重连
├── session.ts     # 会话、消息、待发送队列
├── ui.ts          # Shadow DOM 渲染与本地交互
├── template.ts    # 静态标记
├── styles.css     # 样式，构建时内联
├── config.ts      # 配置解析与后端地址推断
├── identity.ts    # 访客 ID
├── utils.ts
└── types.ts
```

## 嵌入

```html
<script
  src="https://cdn.example.com/shiguang/widget.js"
  defer
  data-server="https://chat.example.com"
  data-title="拾光咖啡 · 在线客服"
  data-color="#B4552D"
></script>
```

放到 CDN 或跨域嵌入时必须显式指定 `data-server`，否则组件会把脚本自身域名当作后端地址。正式环境要求 HTTPS（WebSocket 会使用 `wss://`）。

## 编程式创建

```ts
import { createChatWidget } from '@shiguang/chat-widget';

const chat = createChatWidget({
  server: 'https://chat.example.com',
  title: '在线客服',
  prompts: ['查询订单', '退货咨询'],
});

chat.ask('你好');
chat.destroy();
```

`createChatWidget` 不自动挂载。省略 `server` 时使用当前页面来源；通过打包工具跨域部署时务必显式传入。
