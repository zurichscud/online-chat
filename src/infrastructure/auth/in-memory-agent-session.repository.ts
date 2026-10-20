import { createHash, randomBytes } from 'node:crypto';

import type {
  AgentSession,
  AgentSessionRepository,
} from '../../domain/ports/agent-session.repository';

interface StoredSession {
  name: string;
  expiresAt: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * In-memory token store for the single-process deployment.
 * The port is intentionally async so a Redis implementation can replace it.
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
