/** 与具体组件无关的纯工具函数。 */

export function makeId(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    try {
      return window.crypto.randomUUID();
    } catch {
      // 某些旧环境会暴露 randomUUID 但调用失败，退回到随机字符串。
    }
  }
  const random = Math.random().toString(36).slice(2);
  return `v-${Date.now().toString(36)}-${random}${random}`;
}

export function readStorage(storage: Storage | null, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function writeStorage(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // 隐私模式或配额不足时忽略，不影响聊天本身。
  }
}

/**
 * 主题色会被写进 CSS 自定义属性，必须去掉可能闭合声明或标签的字符。
 */
export function escapeCss(value: unknown): string {
  const cleaned = String(value || '')
    .replace(/[;{}<>"'\\]/g, '')
    .slice(0, 40);
  return cleaned || '#B4552D';
}

export function formatTime(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return `${date.getHours().toString().padStart(2, '0')}:${date
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }
}

export function dayLabel(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date);
  } catch {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
}
