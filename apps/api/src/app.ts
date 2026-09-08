import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";

import { buildHealthResponse, runChecks } from "@f3nation/health";

import { openApiJson } from "~/docs";
import { docsPage } from "~/docs-page";
import { handleRequest } from "~/handler";
import { logError } from "~/lib/logging";
import packageJson from "../package.json";

export const app = new Hono();

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

// Registered early (right after the trailing-slash redirect) so every route
// below — including /health, /docs, and /docs/openapi.json — is covered.
// Hono composes matched handlers in registration order; those routes are
// terminal (no `next()`), so registering this after them would silently skip
// compression for all of them. Load-bearing: Cloud Run does not compress
// responses the way Next's standalone server does today, and the large map
// endpoints (plus /docs/openapi.json's 200+KB payload) must not silently
// lose it.
app.use(compress());

// oRPC's Response objects never set Content-Length, so hono/compress's own
// size-threshold skip (`contentLength && Number(contentLength) < threshold`)
// never fires and it stamps `Vary: Accept-Encoding` on every response, not
// just ones actually worth compressing — a divergence the frozen
// characterization goldens catch on every 401/404/429/validation-error case.
// Registered after compress() (so, per Hono's onion composition, its own
// post-`next()` step runs BEFORE compress's) to give compress the
// information it needs to make the same real-size decision Next's own
// compression already makes today.
app.use(async (c, next) => {
  await next();
  if (
    c.res.body && // redirects, 204s etc. have no body — and Response.redirect()'s
    // headers are spec-immutable, so `.set()` below would throw for them
    !c.res.headers.has("content-length") &&
    !c.res.headers.has("content-encoding") &&
    !c.res.headers.has("transfer-encoding")
  ) {
    try {
      const bytes = await c.res.clone().arrayBuffer();
      c.res.headers.set("content-length", String(bytes.byteLength));
    } catch (err) {
      // The response itself already succeeded upstream; a failure computing
      // its length shouldn't discard it and report a false 500 — log and send
      // it through without a content-length instead.
      logError(
        "api.middleware.content_length_failed",
        { path: c.req.path },
        err,
      );
    }
  }
});

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
