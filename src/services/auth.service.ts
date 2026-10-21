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

/** 登录成功后的返回体。 */
export interface LoginResult {
  /** 会话令牌，后续请求通过 Bearer 方式携带。 */
  token: string;
  /** 当前登录的客服信息。 */
  agent: { name: string };
  /** 令牌有效期（毫秒）。 */
  expiresIn: number;
}

/** AuthService 的依赖与配置。 */
export interface AuthServiceOptions {
  /** 客服会话令牌仓库。 */
  sessions: AgentSessionRepository;
  /** 登录失败次数限制器。 */
  loginAttempts: LoginAttemptPort;
  /** 配置的单客服名称。 */
  agentName: string;
  /** 配置的客服登录密码。 */
  agentPassword: string;
  /** 令牌有效期（毫秒）。 */
  tokenTtlMs: number;
}

/**
 * 客服认证服务：校验密码、签发/撤销令牌，并配合失败次数限制防止暴力破解。
 */
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
