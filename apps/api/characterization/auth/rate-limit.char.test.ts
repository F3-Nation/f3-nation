import { beforeAll, describe, expect, it } from "vitest";

import { exhaustRateLimit, RATE_LIMIT_MESSAGE, WINDOW_MS } from "../rate-limit";
import { req, target } from "../transport";

/**
 * The rate limiter is a module-level in-memory singleton keyed by client IP,
 * and `isolate: true` gives this file its own module registry, hence its own
 * instance. NODE_ENV=test puts the limit at 200/60s (isDevelopment would raise
 * it to 10000). Driven against the public
 * `ping` so no auth or DB is involved; excluded from the live target because it
 * depends on in-process counter state.
 */

/** The IP driven to its limit in beforeAll; every case below refers to it. */
const EXHAUSTED = "10.70.1.1";

function ping(forwardedFor: string): Promise<Response> {
  return target.invoke(
    req("/v1/ping", { headers: { "x-forwarded-for": forwardedFor } }),
  );
}

describe.runIf(target.inProcess)("rate limiting", () => {
  // In beforeAll, not in the first test, so no case depends on another's
  // execution order for the exhausted counter it asserts against.
  beforeAll(() => exhaustRateLimit(EXHAUSTED), WINDOW_MS);

  it("returns 429 with the retry message once the window limit is exceeded", async () => {
    const limited = await ping(EXHAUSTED);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { message: string };
    expect(body.message).toMatch(RATE_LIMIT_MESSAGE);
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
