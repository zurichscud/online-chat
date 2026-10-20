import type {
  LoginAttemptPort,
  RateLimiterPort,
} from '../domain/ports/rate-limiter.port';

interface WindowCounter {
  count: number;
  resetAt: number;
}

/**
 * Small fixed-window limiter used by the demo backend. In a multi-instance
 * deployment this adapter is replaced by a Redis-backed implementation.
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

interface AttemptCounter {
  count: number;
  resetAt: number;
}

export class LoginAttemptLimiter implements LoginAttemptPort {
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
