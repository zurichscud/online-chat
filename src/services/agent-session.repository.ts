import { createHash, randomBytes } from 'node:crypto';

import type {
  AgentSession,
  AgentSessionRepository,
} from '@/types.js';

/** 内存中保存的会话记录；键为令牌哈希，不保存原始令牌。 */
interface StoredSession {
  /** 客服名称。 */
  name: string;
  /** 过期时间戳（毫秒）。 */
  expiresAt: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 单进程内存令牌仓库。接口保持异步，
 * 方便以后替换为 Redis 实现而不改动业务层。
 */
export class InMemoryAgentSessionRepository implements AgentSessionRepository {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(private readonly ttlMs: number) {}

  async issue(name: string): Promise<AgentSession> {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.sessions.set(hashToken(token), { name, expiresAt });
    return { token, name, expiresAt };
  }

  async find(token: string): Promise<AgentSession | null> {
    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return null;

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }

    return { token, name: session.name, expiresAt: session.expiresAt };
  }

  async revoke(token: string): Promise<void> {
    this.sessions.delete(hashToken(token));
  }

  async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}
