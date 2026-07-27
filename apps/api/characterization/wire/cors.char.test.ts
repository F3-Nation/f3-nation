import { describe, expect, it } from "vitest";

import { normalize, stableStringify } from "../normalize";
import { req, target } from "../transport";

/**
 * The `CORSPlugin` in `[[...rest]]/route.ts` is configured with
 * `origin: (origin) => origin`, `credentials: true`, `maxAge: 600`, and
 * allow-headers content-type / authorization / client. All of it lands in these
 * goldens. This is the group that catches a Hono port wiring OPTIONS wrong —
 * the failure mode there is a preflight that 404s or omits the credentials
 * header, which browsers surface as an opaque CORS error rather than a 500.
 */
describe("CORS", () => {
  it("echoes the origin on a preflight and allows credentials", async () => {
    const res = await target.invoke(
      req("/v1/ping", {
        method: "OPTIONS",
        headers: {
          origin: "https://map.f3nation.com",
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type,client",
          "x-forwarded-for": "10.91.0.1",
        },
      }),
    );
    await expect(stableStringify(await normalize(res))).toMatchFileSnapshot(
      "../__snapshots__/cors-preflight.golden.json",
    );
  });

  it("carries CORS headers on an actual response, not just the preflight", async () => {
    const res = await target.invoke(
      req("/v1/ping", {
        headers: {
          origin: "https://map.f3nation.com",
          "x-forwarded-for": "10.91.0.2",
        },
      }),
    );
    expect(res.status).toBe(200);
    await expect(
      stableStringify(
        await normalize(res, { paths: { timestamp: "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/cors-actual-response.golden.json");
  });

  it("echoes a different origin verbatim rather than a fixed allow-list", async () => {
    // `origin: (origin) => origin` reflects whatever is asked for. Pinning a
    // second origin makes that reflection explicit, so a port that hardcodes
    // one production origin fails here instead of in a browser.
    const res = await target.invoke(
      req("/v1/ping", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.invalid",
          "access-control-request-method": "GET",
          "x-forwarded-for": "10.91.0.3",
        },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://example.invalid",
    );
  });

  it("carries CORS headers on a handler-produced error response", async () => {
    const res = await target.invoke(
      req("/v1/event-tag/org/1", {
        headers: {
          origin: "https://map.f3nation.com",
          "x-forwarded-for": "10.91.1.1",
        },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://map.f3nation.com",
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("omits CORS headers on the out-of-handler 404 fall-through", async () => {
    // route.ts builds this Response outside handler.handle(), so CORSPlugin
    // never sees it — a browser gets an opaque CORS error, not a 404. Pinned
    // as the current contract, quirk and all.
    const res = await target.invoke(
      req("/no-such-route", {
        headers: {
          origin: "https://map.f3nation.com",
          "x-forwarded-for": "10.91.1.2",
        },
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
