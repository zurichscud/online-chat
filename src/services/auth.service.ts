import { createHash, timingSafeEqual } from 'node:crypto';

import type {
  AgentSession,
  AgentSessionRepository,
  LoginAttemptPort,
} from '@/types.js';
import {
  TooManyRequestsError,
  UnauthorizedError,
} from '@/utils/errors.js';

export interface LoginResult {
  token: string;
  agent: { name: string };
  expiresIn: number;
}

export interface AuthServiceOptions {
  sessions: AgentSessionRepository;
  loginAttempts: LoginAttemptPort;
  agentName: string;
  agentPassword: string;
  tokenTtlMs: number;
}

export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}

  async login(password: string, ip: string): Promise<LoginResult> {
    if (this.options.loginAttempts.isBlocked(ip)) {
      throw new TooManyRequestsError('尝试次数过多，请稍后再试。');
    }

    if (!password || !this.matches(password)) {
      this.options.loginAttempts.recordFailure(ip);
      throw new UnauthorizedError('密码不正确。');
    }

    this.options.loginAttempts.reset(ip);
    const session = await this.options.sessions.issue(this.options.agentName);

    return {
      token: session.token,
      agent: { name: this.options.agentName },
      expiresIn: this.options.tokenTtlMs,
    };
  }

  async logout(token: string): Promise<void> {
    if (token) await this.options.sessions.revoke(token);
  }

  async validateToken(token: string): Promise<AgentSession | null> {
    if (!token) return null;
    return this.options.sessions.find(token);
  }

  async cleanup(): Promise<void> {
    await this.options.sessions.cleanupExpired();
    this.options.loginAttempts.cleanup();
  }

  private matches(candidate: string): boolean {
    // 两边先哈希，保证 timingSafeEqual 的缓冲区长度一致。
    const expected = createHash('sha256').update(this.options.agentPassword).digest();
    const actual = createHash('sha256').update(candidate).digest();
    return timingSafeEqual(expected, actual);
  }
}
