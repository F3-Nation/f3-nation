/**
 * GET /health — unconditional 200 for the SNI probe (R5 Decision 4).
 *
 * This handler **intentionally** ignores the Host header and the request
 * context entirely. It must return 200 regardless of which tenant name
 * the probe dials with, because:
 *
 *   1. The reconciler-side SNI probe (F3R5_010) dials the LB static IP
 *      with SNI + Host header set to the tenant hostname. The TLS
 *      handshake has already proven cert match — by the time this
 *      handler runs, identity is settled. The HTTP layer is liveness.
 *   2. Gating /health on Host-header lookup would cause the probe to
 *      fail in `awaiting_probe` state (the runtime doesn't hold
 *      `awaiting_probe` rows in its cache — it only loads `active`).
 *      The whole R5 probe design depends on /health being trivially
 *      live.
 *   3. /health reveals no tenant data, has no side effects, and is
 *      idempotent.
 *
 * The `x-redirect-platform: ok` response header is the magic value the
 * reconciler asserts after the HTTP response — it proves the request
 * terminated at this runtime rather than at a proxy or a captive
 * portal.
 *
 * This route is a static segment alongside the optional catch-all
 * `[[...catchall]]`; Next.js App Router prefers static segments over
 * catch-alls, so `/health` hits this handler first.
 *
 * This file deliberately imports nothing that touches env validation
 * or the DB — liveness should survive a degraded Neon.
 */

export const dynamic = "force-dynamic";
// Run in the Node.js runtime (default) so we inherit the same process
// as the cache refresh loop — but note we don't import the cache here.
export const runtime = "nodejs";

export function GET(): Response {
  return new Response("ok\n", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-redirect-platform": "ok",
      "cache-control": "no-store",
    },
  });
}

// HEAD probes from Cloud Run / health monitors should also succeed.
export function HEAD(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "x-redirect-platform": "ok",
      "cache-control": "no-store",
    },
  });
}
