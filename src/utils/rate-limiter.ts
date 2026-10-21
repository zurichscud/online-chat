import type {
  LoginAttemptPort,
  RateLimiterPort,
} from '@/types.js';

/** 固定窗口限流器的计数与窗口重置时间。 */
interface WindowCounter {
  /** 当前窗口内已消费的请求数。 */
  count: number;
  /** 窗口重置时间戳（毫秒）。 */
  resetAt: number;
}

/**
 * 单进程固定窗口限流器。多实例部署时可替换为 Redis 实现，
 * 业务层只依赖 RateLimiterPort。
 */
export class FixedWindowRateLimiter implements RateLimiterPort {
  private readonly windows = new Map<string, WindowCounter>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    const current = this.windows.get(key);

    if (!current || now >= current.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }

    current.count += 1;
    return current.count <= this.maxRequests;
  }

  private sweep(now: number): void {
    if (this.windows.size < 5000) return;
    for (const [key, window] of this.windows.entries()) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
  }
}

/** 登录失败计数器的计数与窗口重置时间。 */
interface AttemptCounter {
  /** 当前窗口内的失败次数。 */
  count: number;
  /** 窗口重置时间戳（毫秒）。 */
  resetAt: number;
}

/** 按 IP 统计登录失败次数，超过阈值后在窗口期内拒绝登录。 */
export class LoginAttemptLimiter implements LoginAttemptPort {
  /** 按 IP 记录登录失败次数与窗口过期时间，用于登录暴力破解防护。 */
  private readonly attempts = new Map<string, AttemptCounter>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number
  ) {}

  isBlocked(ip: string): boolean {
    const attempt = this.attempts.get(ip);
    if (!attempt) return false;
    if (Date.now() >= attempt.resetAt) {
      this.attempts.delete(ip);
      return false;
    }
    return attempt.count >= this.maxFailures;
  }

  recordFailure(ip: string): void {
    const now = Date.now();
    const attempt = this.attempts.get(ip);
    if (!attempt || now >= attempt.resetAt) {
      this.attempts.set(ip, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    attempt.count += 1;
  }

  reset(ip: string): void {
    this.attempts.delete(ip);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [ip, attempt] of this.attempts.entries()) {
      if (now >= attempt.resetAt) this.attempts.delete(ip);
    }
  }
}
