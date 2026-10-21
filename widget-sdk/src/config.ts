import type { WidgetConfig, WidgetOptions } from './types';

export const DEFAULT_TITLE = '拾光咖啡 · 在线客服';
export const DEFAULT_ACCENT = '#B4552D';
export const DEFAULT_PROMPTS = [
  '你好，我想咨询一下',
  '帮我推荐一款产品',
  '查询我的订单',
];
const MAX_PROMPTS = 4;

interface RawConfig {
  server?: string;
  title?: string;
  color?: string;
  position?: string;
  prompts?: string | string[];
  autoOpen?: string | boolean;
}

function normalizeServer(value?: string): string {
  const origin = value || window.location.origin;
  return origin.replace(/\/+$/, '');
}

function toWsOrigin(origin: string): string {
  return origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
}

function parsePrompts(value?: string | string[]): string[] {
  const items = Array.isArray(value) ? value : String(value || '').split('|');
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_PROMPTS);
}

function resolveConfig(input: RawConfig): WidgetConfig {
  const serverOrigin = normalizeServer(input.server);
  return {
    title: input.title || DEFAULT_TITLE,
    accent: input.color || DEFAULT_ACCENT,
    position: input.position === 'left' ? 'left' : 'right',
    prompts:
      input.prompts === undefined ? [...DEFAULT_PROMPTS] : parsePrompts(input.prompts),
    autoOpen:
      typeof input.autoOpen === 'boolean'
        ? input.autoOpen
        : String(input.autoOpen || '').toLowerCase() !== 'false',
    wsUrl: `${toWsOrigin(serverOrigin)}/ws`,
  };
}

/**
 * 读取 `<script src=".../widget.js" data-*>` 上的配置。
 * 没有 data-server 时，后端地址取脚本自身来源；放到 CDN 时必须显式指定 data-server。
 */
export function configFromScript(script: HTMLScriptElement | null): WidgetConfig {
  const scriptUrl = script?.src ? new URL(script.src, window.location.href) : null;
  const data = script?.dataset ?? {};
  return resolveConfig({
    server: data.server || (scriptUrl ? scriptUrl.origin : window.location.origin),
    title: data.title,
    color: data.color,
    position: data.position,
    prompts: data.prompts || undefined,
    autoOpen: data.autoOpen,
  });
}

/** 编程式创建组件时的配置；server 省略时回退到当前页面来源。 */
export function configFromOptions(options: WidgetOptions = {}): WidgetConfig {
  return resolveConfig({
    server: options.server,
    title: options.title,
    color: options.color,
    position: options.position,
    prompts: options.prompts,
    autoOpen: options.autoOpen,
  });
}

export { toWsOrigin };
