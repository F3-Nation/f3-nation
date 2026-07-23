import { describe, expect, it } from "vitest";

import { req, target } from "../transport";

/**
 * The rate limiter is a per-worker in-memory singleton keyed by client IP, and
 * the forks pool gives this file its own instance. NODE_ENV=test puts the limit
 * at 200/60s (isDevelopment would raise it to 10000). Driven against the public
 * `ping` so no auth or DB is involved; excluded from the live target because it
 * depends on in-process counter state.
 */

describe.runIf(target.inProcess)("rate limiting", () => {
  it("returns 429 with the retry message once the window limit is exceeded", async () => {
    const ip = "10.70.1.1";
    // 200 succeed, the 201st trips the limiter.
    for (let i = 0; i < 200; i++) {
      const res = await target.invoke(
        req("/v1/ping", { headers: { "x-forwarded-for": ip } }),
      );
      expect(res.status).toBe(200);
    }
    const limited = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": ip } }),
    );
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { message: string };
    expect(body.message).toMatch(/^Rate limit exceeded\. Try again in \d+s$/);
  });

  it("keys counters per IP — a fresh IP is unaffected", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.70.2.1" } }),
    );
    expect(res.status).toBe(200);
  });

  it("keys off the first IP in an x-forwarded-for chain", async () => {
    // getClientIP takes forwarded.split(",")[0], so proxy hops are ignored and
    // this maps to a fresh client key.
    const res = await target.invoke(
      req("/v1/ping", {
        headers: { "x-forwarded-for": "10.70.3.1, 10.0.0.1, 10.0.0.2" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
