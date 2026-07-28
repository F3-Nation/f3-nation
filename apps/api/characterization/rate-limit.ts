import { expect } from "vitest";

import { req, target } from "./transport";

/**
 * Shared scaffolding for exhausting the in-memory rate limiter. The limiter is
 * a module-level singleton and `isolate: true` gives every file a fresh module
 * registry, so each test file still pays its own warm-up — what lives here is
 * the logic and the constants, so the two suites that pin limiter behavior
 * cannot drift apart.
 */

/**
 * Mirrors the non-development branch of the private RATE_LIMIT_MAX_REQUESTS
 * (`isDevelopment ? 10000 : 200`) in packages/api/src/shared.ts; the suite
 * pins NODE_ENV=test, so 200 is the effective limit.
 */
const RATE_LIMIT = 200;

/** checkLimit evicts entries older than now - 60s, so the window slides. */
export const WINDOW_MS = 60_000;

/** The retry wording every 429 body carries; the seconds count down. */
export const RATE_LIMIT_MESSAGE = /^Rate limit exceeded\. Try again in \d+s$/;

/**
 * Drive `ip` to the limit against the public `ping` (no auth or DB involved).
 * Callers use it in a `beforeAll` with a `WINDOW_MS` timeout — deliberately
 * ABOVE the `WINDOW_MS / 2` assertion below rather than equal to it: vitest's
 * default hookTimeout is 10s, which would abort the warm-up — with a generic
 * "Hook timed out" — across exactly the band the diagnostic exists to explain.
 * Past WINDOW_MS the window has fully elapsed and no diagnostic would be true,
 * so aborting is the honest outcome.
 */
export async function exhaustRateLimit(ip: string): Promise<void> {
  const started = Date.now();
  for (let i = 0; i < RATE_LIMIT; i++) {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": ip } }),
    );
    expect(res.status).toBe(200);
  }
  // MemoryRatelimiter's window slides: if the warm-up itself outran half the
  // window, early requests are already evicted and the 429 cases would fail as
  // `expected 200 to be 429` — a slow runner masquerading as a limiter
  // regression. Report the real cause instead. ~4s locally.
  const elapsed = Date.now() - started;
  expect(
    elapsed,
    `warm-up took ${elapsed}ms; the ${WINDOW_MS}ms sliding window already evicted early requests`,
  ).toBeLessThan(WINDOW_MS / 2);
}
