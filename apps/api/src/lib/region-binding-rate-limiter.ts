/**
 * In-memory token-bucket rate limiter for the internal region-binding
 * validator endpoint (R5 Decision 11: 60 rpm per caller).
 *
 * Keyed by caller user id (the endpoint's `calling_user_id` query param).
 * Acceptable for an internal service-to-service route where the caller
 * count is small and rate-limit precision across pods is not critical.
 *
 * TODO(F3R5_014-followup): if apps/api goes multi-pod for this endpoint,
 * swap this for a Redis-backed limiter (Upstash or the existing
 * @orpc/experimental-ratelimit/memory adapter wired to Redis).
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface BucketState {
  count: number;
  /** Epoch ms when the current window ends. */
  windowEndMs: number;
}

export interface RegionBindingRateLimiterOptions {
  /** Max requests allowed per window. Default: 60. */
  maxRequests?: number;
  /** Window length in milliseconds. Default: 60_000 (1 minute). */
  windowMs?: number;
  /** Clock override — used by tests. */
  now?: () => number;
}

export interface RegionBindingRateLimiter {
  check: (callerId: number | string) => RateLimitResult;
}

export const createRegionBindingRateLimiter = (
  options: RegionBindingRateLimiterOptions = {},
): RegionBindingRateLimiter => {
  const maxRequests = options.maxRequests ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, BucketState>();

  return {
    check: (callerId) => {
      const key = String(callerId);
      const currentMs = now();
      const existing = buckets.get(key);

      if (!existing || currentMs >= existing.windowEndMs) {
        buckets.set(key, {
          count: 1,
          windowEndMs: currentMs + windowMs,
        });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (existing.count < maxRequests) {
        existing.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.windowEndMs - currentMs) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    },
  };
};

/**
 * Default singleton limiter used by the route handler. Exported so that
 * tests can import and reset it. For unit tests that mock the service, this
 * is not used.
 */
export const regionBindingRateLimiter = createRegionBindingRateLimiter();
