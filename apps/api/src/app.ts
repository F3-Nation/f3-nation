import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { securityHeadersRecord } from "@acme/security-headers";
import { buildHealthResponse, runChecks } from "@f3nation/health";

import { openApiJson } from "~/docs";
import { docsPage } from "~/docs-page";
import { handleRequest } from "~/handler";
import { logError } from "~/lib/logging";
// Surfaced as the service version in the health endpoints below.
import packageJson from "../package.json";

export const app = new Hono();

// Baseline security headers on every response (including the 308 below and
// errors). The API is never legitimately framed. Registered first so it wraps
// every other middleware. Headers are applied to a clone: responses built with
// `Response.redirect()` or fetched from upstream have immutable headers.
//
// Two invariants this relies on (both pinned in __tests__/app.test.ts):
// - The 500 path is covered because Hono's `compose` catches a handler's throw
//   at the dispatch level, runs `onError`, and returns normally, so the code
//   after `await next()` still runs. Verified on Hono 4.13.x; re-check after a
//   Hono upgrade that touches `compose`.
// - Every body is re-wrapped, and the clone references the body stream without
//   reading it. Nothing here buffers or consumes `c.res.body`, so do not read
//   it in a middleware registered after this one, and vet any future
//   streaming/SSE handler against this clone.
const SECURITY_HEADERS = securityHeadersRecord({ frame: "deny" });
app.use("*", async (c, next) => {
  await next();
  const res = new Response(c.res.body, c.res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(name, value);
  }
  c.res = res;
});

// Next's file-system router unshifts an implicit 308 for `/:path+/` -> `/:path+`
// ahead of every handler. Hono has no equivalent, so it's replicated here as the
// first middleware — the characterization suite's frozen goldens (and real
// clients relying on today's redirect) depend on this exact behavior.
app.use("*", async (c, next) => {
  const { pathname, search } = new URL(c.req.url);
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return new Response(null, {
      status: 308,
      headers: {
        location:
          "/" + pathname.replace(/^\/+/, "").replace(/\/+$/, "") + search,
      },
    });
  }
  await next();
});

// No response compression, matching the service this replaced. Map revisions
// whose /api/orpc proxy forwards the upstream Content-Encoding onto a body its
// fetch() already decoded break on gzip, so don't enable it while any of those
// can still be deployed.

const SERVICE_NAME = "f3-api";

app.get("/health", async (c) => {
  const startedAt = Date.now();
  try {
    const checks = await runChecks([
      {
        id: "process",
        defaultSeverity: "info",
        run: () => ({ status: "ok" }),
      },
    ]);
    const payload = buildHealthResponse({
      service: SERVICE_NAME,
      version: packageJson.version,
      checks,
      startedAt,
    });
    return c.json(payload, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    logError("api.health.endpoint_failed", {}, err);
    const payload = buildHealthResponse({
      service: SERVICE_NAME,
      version: packageJson.version,
      startedAt,
      checks: [
        {
          id: "health-endpoint",
          status: "down",
          severity: "critical",
          message: "Health endpoint failed",
          details: { reason: "internal_error" },
        },
      ],
    });
    return c.json(payload, 200, { "Cache-Control": "no-store" });
  }
});

// Next's route-handler layer only exports GET for /docs and /docs/openapi.json,
// so it auto-synthesizes a 204 for OPTIONS and a 405 for every other verb. Hono
// has no auto-405, so an `app.all` guard runs ahead of the real GET handler on
// each path (Hono composes same-path matches in registration order) and
// short-circuits anything but GET/HEAD — otherwise a non-GET request would
// silently fall through to the catch-all below instead of 405ing, a
// golden-breaking behavior change.
function docsMethodGuard(c: Context, next: Next) {
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { allow: "GET, HEAD, OPTIONS" },
    });
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, HEAD, OPTIONS" },
    });
  }
  return next();
}

app.all("/docs", docsMethodGuard);
app.get("/docs", docsPage);

app.all("/docs/openapi.json", docsMethodGuard);
app.get("/docs/openapi.json", (c) => openApiJson(c.req.raw));

// Only static asset apps/api serves today.
app.use("/favicon.ico", serveStatic({ path: "./public/favicon.ico" }));

app.all("*", (c) => handleRequest(c.req.raw));

// Equivalent of Next's `onRequestError` instrumentation hook: the last-resort
// catch for anything that throws out of a handler unhandled. Registered here
// (not in server.ts) so it's exercised by the characterization parity gate —
// `characterization/targets/hono.ts` dispatches through `app.fetch`, not
// `server.ts` — and counted by the coverage gate, which excludes server.ts as
// process bootstrap. Hono's own default error handler unwraps a thrown
// HTTPException into its carried response; preserve that instead of
// flattening every thrown error to a generic 500.
app.onError((err, c) => {
  logError(
    "api.app.unhandled_error",
    { path: c.req.path, method: c.req.method },
    err,
  );
  if (err instanceof HTTPException) return err.getResponse();
  return c.text("Internal Server Error", 500);
});
