import { makeId, readStorage, writeStorage } from './utils';

const VISITOR_KEY = 'shiguang_chat_visitor_id';
const VISITOR_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;

function localStorageSafe(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 访客身份保存在宿主页面的 localStorage 中：刷新后继续同一段会话，
 * 不同宿主站之间互不影响。
 */
export function ensureVisitorId(provided?: string): string {
  if (provided && VISITOR_ID_PATTERN.test(provided)) return provided;

  const storage = localStorageSafe();
  const stored = readStorage(storage, VISITOR_KEY);
  if (stored && VISITOR_ID_PATTERN.test(stored)) return stored;

  const visitorId = makeId();
  writeStorage(storage, VISITOR_KEY, visitorId);
  return visitorId;
}
