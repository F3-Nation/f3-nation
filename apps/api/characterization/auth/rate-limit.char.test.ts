import { beforeAll, describe, expect, it } from "vitest";

import { req, target } from "../transport";

/**
 * The rate limiter is a per-worker in-memory singleton keyed by client IP, and
 * the forks pool gives this file its own instance. NODE_ENV=test puts the limit
 * at 200/60s (isDevelopment would raise it to 10000). Driven against the public
 * `ping` so no auth or DB is involved; excluded from the live target because it
 * depends on in-process counter state.
 */

/** The IP driven to its limit in beforeAll; every case below refers to it. */
const EXHAUSTED = "10.70.1.1";
const LIMIT = 200;
/** checkLimit evicts entries older than now - 60s, so the window slides. */
const WINDOW_MS = 60_000;

function ping(forwardedFor: string): Promise<Response> {
  return target.invoke(
    req("/v1/ping", { headers: { "x-forwarded-for": forwardedFor } }),
  );
}

describe.runIf(target.inProcess)("rate limiting", () => {
  // In beforeAll, not in the first test, so no case depends on another's
  // execution order for the exhausted counter it asserts against.
  beforeAll(async () => {
    const started = Date.now();
    for (let i = 0; i < LIMIT; i++) {
      const res = await ping(EXHAUSTED);
      expect(res.status).toBe(200);
    }
    // MemoryRatelimiter's window slides: if this warm-up itself outran 60s, the
    // earliest requests are already evicted and the "limit exceeded" case would
    // fail as `expected 200 to be 429` — a slow runner masquerading as a
    // limiter regression. Report the real cause instead. ~4s locally.
    const elapsed = Date.now() - started;
    expect(
      elapsed,
      `warm-up took ${elapsed}ms; the ${WINDOW_MS}ms sliding window already evicted early requests`,
    ).toBeLessThan(WINDOW_MS / 2);
    // Hook timeout is a full WINDOW_MS, deliberately ABOVE the WINDOW_MS / 2
    // assertion above rather than equal to it: vitest's default hookTimeout is
    // 10s, which would abort the warm-up — with a generic "Hook timed out" —
    // across exactly the 10s-30s band the diagnostic exists to explain. Equal
    // values would just move that race to the boundary. Past WINDOW_MS the
    // window has fully elapsed and no diagnostic would be true, so aborting is
    // the honest outcome.
  }, WINDOW_MS);

  it("returns 429 with the retry message once the window limit is exceeded", async () => {
    const limited = await ping(EXHAUSTED);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { message: string };
    expect(body.message).toMatch(/^Rate limit exceeded\. Try again in \d+s$/);
  });

  it("keys counters per IP — a fresh IP is unaffected", async () => {
    const res = await ping("10.70.2.1");
    expect(res.status).toBe(200);
  });

  it("keys off the FIRST IP in an x-forwarded-for chain, not a later hop", async () => {
    // Reusing the exhausted IP discriminates which position getClientIP reads:
    // leading, it must inherit that counter; trailing, it must be ignored in
    // favor of the fresh leading address. All-fresh addresses would pass
    // regardless of which position the limiter picked.
    const leading = await ping(`${EXHAUSTED}, 10.0.0.1, 10.0.0.2`);
    expect(leading.status).toBe(429);

    const trailing = await ping(`10.70.3.1, ${EXHAUSTED}, 10.0.0.2`);
    expect(trailing.status).toBe(200);
  });
});
