/**
 * Rate limiting ports. The demo uses in-memory fixed-window adapters; the
 * MySQL + Redis plan will provide Redis-backed implementations.
 */
export interface RateLimiterPort {
  consume(key: string): boolean;
}

export interface LoginAttemptPort {
  isBlocked(ip: string): boolean;
  recordFailure(ip: string): void;
  reset(ip: string): void;
  cleanup(): void;
}
