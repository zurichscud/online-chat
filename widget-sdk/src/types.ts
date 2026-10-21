/**
 * 对外配置、服务端协议和组件内部状态的类型定义。
 * 这里只放类型，运行时逻辑放在对应的模块中。
 */

export type MessageRole = 'visitor' | 'agent' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  at: string;
  authorName?: string;
  clientId?: string;
  /** 本地乐观消息：已进入发送队列但服务端还没确认。 */
  pending?: boolean;
  failed?: boolean;
}

export interface ConversationView {
  id: string;
  visitorId?: string;
  visitorName?: string;
  page?: string;
  createdAt?: string;
  updatedAt?: string;
  unreadForAgent?: number;
  unreadForVisitor?: number;
  online?: boolean;
  messageCount?: number;
  messages?: ChatMessage[];
}

/** 组件启动所需的全部配置，由 data-* 属性或 createChatWidget 参数解析而来。 */
export interface WidgetConfig {
  title: string;
  accent: string;
  position: 'left' | 'right';
  prompts: string[];
  autoOpen: boolean;
  wsUrl: string;
}

/** 编程式创建组件时的可选参数。 */
export interface WidgetOptions {
  /** 后端地址，例如 https://chat.example.com；省略时使用当前页面来源。 */
  server?: string;
  title?: string;
  color?: string;
  position?: 'left' | 'right';
  prompts?: string | string[];
  autoOpen?: boolean;
  /** 复用已有的访客 ID；省略时从 localStorage 读取或新建。 */
  visitorId?: string;
  /** 挂载容器，默认 document.body。 */
  container?: HTMLElement;
}

export type ConnectionState = 'connecting' | 'online' | 'offline';

export interface OutboxEntry {
  clientId: string;
  text: string;
  at: string;
}

export interface ChatWidgetApi {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  ask(text: string): void;
}

export interface ChatWidgetInstance extends ChatWidgetApi {
  readonly visitorId: string;
  destroy(): void;
}

/** 服务端下发的访客侧事件；字段按 type 取值，未用到的字段可缺省。 */
export interface ServerEvent {
  type: string;
  conversation?: ConversationView | null;
  message?: ChatMessage;
  online?: boolean;
  from?: 'visitor' | 'agent';
  active?: boolean;
  /** transport 把 error 事件的 message 字段统一放到这里，避免和聊天消息混淆。 */
  errorMessage?: string;
}

export type ClientEvent = Record<string, unknown> & { type: string };

declare global {
  interface Window {
    /** 嵌入页面通过 IIFE 引入脚本后可直接调用的全局 API。 */
    ShiguangChat?: ChatWidgetApi;
  }
}
