/**
 * Tiny in-memory token bucket for per-user request shaping.
 *
 * Used by the binding verification POST to cap abusive retries at
 * 10/min per user (F3R5_013 Part 1 deliverable). Not persistent — in
 * a multi-instance deploy each Cloud Run container has its own
 * bucket, which is acceptable for this UX-level throttle.
 *
 * Pure module surface: no singletons in the test-reachable API —
 * `createTokenBucket()` builds a fresh instance for each caller and
 * tests pass their own clock.
 */

export interface TokenBucketConfig {
  capacity: number;
  /** Tokens refilled per second. */
  refillRatePerSecond: number;
  /** Optional clock override — defaults to `Date.now`. Tests inject this. */
  now?: () => number;
}

export interface TokenBucket {
  tryConsume(key: string, tokens?: number): boolean;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export function createTokenBucket(config: TokenBucketConfig): TokenBucket {
  const states = new Map<string, BucketState>();
  const now = config.now ?? (() => Date.now());

  return {
    tryConsume(key, tokens = 1) {
      const nowMs = now();
      const existing = states.get(key);
      const state: BucketState = existing ?? {
        tokens: config.capacity,
        lastRefillMs: nowMs,
      };
      if (existing) {
        const elapsedSec = (nowMs - existing.lastRefillMs) / 1000;
        const refill = elapsedSec * config.refillRatePerSecond;
        state.tokens = Math.min(config.capacity, existing.tokens + refill);
        state.lastRefillMs = nowMs;
      }
      if (state.tokens >= tokens) {
        state.tokens -= tokens;
        states.set(key, state);
        return true;
      }
      states.set(key, state);
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Shared bucket for the binding-verification POST handler — 10/min/user.
// Hoisted to module scope so repeated imports from the same Node process
// observe the same bucket (single-instance semantics).
// ---------------------------------------------------------------------------

const VERIFY_BINDING_BUCKET: TokenBucket = createTokenBucket({
  capacity: 10,
  refillRatePerSecond: 10 / 60,
});

export function tryConsumeVerifyBinding(userId: number): boolean {
  return VERIFY_BINDING_BUCKET.tryConsume(`user:${userId}`);
}
