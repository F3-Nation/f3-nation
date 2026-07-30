import { describe, expect, it } from "vitest";

import { Client, Header } from "@acme/shared/common/enums";

import { expectUnauthorizedRpc } from "../auth/verdict";
import { sessionCookie } from "../fixtures/cookies";
import { normalize, stableStringify } from "../normalize";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

/**
 * Dispatch in `[[...rest]]/route.ts` selects a handler by the `Client` HEADER,
 * not by the path. `/v1` is only the RPC handler's prefix once that handler has
 * already been chosen. A port that routes by path would pass casual testing and
 * silently break SSG and the map client, so pin the rule itself.
 */
describe("handler dispatch", () => {
  // First test in the file: it builds a real oRPC client and pays the suite's
  // one-time cold-start cost (module init + transport wiring), which lands
  // this case right at the 5s default and flakes on a loaded CI runner
  // (observed ~5019ms). Give it headroom without masking a genuine hang.
  it("returns the RPC body shape for a real oRPC client", async () => {
    const res = await rpcResponse((client) => client.ping(), {
      "x-forwarded-for": "10.90.0.1",
    });
    expect(res.status).toBe(200);
    await expect(
      stableStringify(
        await normalize(res, { paths: { "json.timestamp": "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/dispatch-rpc-ping.golden.json");
  }, 20_000);

  it("returns the OpenAPI body shape for the same procedure over REST", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.90.0.2" } }),
    );
    expect(res.status).toBe(200);
    await expect(
      stableStringify(
        await normalize(res, { paths: { timestamp: "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/dispatch-rest-ping.golden.json");
  });

  it.each([
    ["f3-me", Client.F3_ME, "10.90.1.1"],
    ["orpc-ssg", Client.ORPC_SSG, "10.90.1.2"],
  ])("routes %s to the RPC handler", async (_label, clientHeader, clientIp) => {
    // Reality diverges from this plan's prediction: a bare REST-shaped GET
    // DOES resolve at the RPC handler — RPCHandler matches on the router KEY
    // path only (`toHttpPath(["ping"]) === "/ping"`), ignoring both the HTTP
    // method and the `.route({path})` REST path. `/v1/ping` matches because
    // the key happens to equal the REST path; `/v1/api-key` would not (its
    // key path is `/apiKey/list`). So this is a 200, not a 404. What actually
    // distinguishes the handlers is the body shape: the RPC codec wraps the
    // payload in a `{json, meta}` envelope, while the OpenAPI handler returns
    // the plain object (see the dispatch-rpc-ping vs dispatch-rest-ping
    // goldens above).
    const res = await target.invoke(
      req("/v1/ping", {
        headers: {
          [Header.Client]: clientHeader,
          "x-forwarded-for": clientIp,
        },
      }),
    );
    expect(res.status).toBe(200);
    // Asserted against the SAME golden the `orpc` case pins above: all three
    // Client values must produce the byte-identical RPC envelope, `meta`
    // type-preservation table included.
    await expect(
      stableStringify(
        await normalize(res, { paths: { "json.timestamp": "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/dispatch-rpc-ping.golden.json");
  });

  it("falls through to the OpenAPI handler when no Client header is sent", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.90.2.1" } }),
    );
    // Status alone cannot tell the handlers apart — the RPC handler answers
    // this same request with 200 too (see the it.each above). The body shape
    // can: the RPC codec wraps the payload in `{json, meta}`.
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("json");
    expect(Object.keys(body).sort()).toEqual(["alive", "timestamp"]);
    expect(body.alive).toBe(true);
    expect(typeof body.timestamp).toBe("string");
  });

  // route.ts dispatches on strict equality against exactly three of the four
  // Client values; scalar-api is excluded so the Scalar docs UI lands on the
  // OpenAPI handler. Presence checks, `Object.values(Client).includes(v)`, and
  // case-insensitive compares are all plausible ports that break production
  // here, so pin the fall-through against the REST golden rather than status.
  it.each([
    [
      "a Client value the dispatch list excludes",
      Client.SCALAR_API,
      "10.90.4.1",
    ],
    ["an unrecognized Client value", "characterization", "10.90.4.2"],
    ["the right value in the wrong case", "ORPC", "10.90.4.3"],
  ])(
    "falls through to the OpenAPI handler for %s",
    async (_label, clientHeader, clientIp) => {
      const res = await target.invoke(
        req("/v1/ping", {
          headers: {
            [Header.Client]: clientHeader,
            "x-forwarded-for": clientIp,
          },
        }),
      );
      expect(res.status).toBe(200);
      await expect(
        stableStringify(
          await normalize(res, { paths: { timestamp: "<TIMESTAMP>" } }),
        ),
      ).toMatchFileSnapshot("../__snapshots__/dispatch-rest-ping.golden.json");
    },
  );

  it("404s an unknown path under /v1 without a Client header", async () => {
    const res = await target.invoke(
      req("/v1/not-a-procedure", {
        headers: { "x-forwarded-for": "10.90.2.2" },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("404s HEAD on a procedure the OpenAPI handler serves over GET", async () => {
    const res = await target.invoke(
      req("/v1/ping", {
        method: "HEAD",
        headers: { "x-forwarded-for": "10.90.5.1" },
      }),
    );
    // Not the 200 the CORS allowMethods list advertises: the OpenAPI handler
    // serves only the verbs a procedure declares, so HEAD reaches route.ts's
    // hand-built 404 instead. Pinned as-is. This is also what makes the body
    // strip in targets/next.ts load-bearing — it strips THIS body, which is
    // where the in-process target would otherwise disagree with live/hono.
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    expect(await res.text()).toBe("");
  });

  it("404s a verb the procedure does not accept", async () => {
    const res = await target.invoke(
      req("/v1/ping", {
        method: "DELETE",
        headers: { "x-forwarded-for": "10.90.7.1" },
      }),
    );
    // The 404 fall-through, not the 405 that verdict.ts's NOT_AUTHORIZED list
    // anticipates — nothing in the stack synthesizes a verb-mismatch 405.
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  // Gated like the OpenAPI `servers[0].url` case: global-setup pins
  // NEXT_PUBLIC_API_URL for the in-process targets, but a remote `live` server
  // derives the redirect base from its own env and host headers.
  it.runIf(target.inProcess)(
    "redirects the root to the docs using the configured API base",
    async () => {
      // Exercises normalize()'s `location` allow-list, which no golden used.
      const res = await target.invoke(
        req("/", { headers: { "x-forwarded-for": "10.90.6.1" } }),
      );
      await expect(stableStringify(await normalize(res))).toMatchFileSnapshot(
        "../__snapshots__/dispatch-root-redirect.golden.json",
      );
    },
  );
});

/**
 * Carried over from Phase B, which could not reach this branch: the only
 * orpc-ssg case available there (`GET /v1/api-key`) 404s at the RPC handler —
 * its router key path is `/apiKey/list`, so the REST path never matched — and
 * that 404 lands before auth runs. Reaching the skip-auth semantics therefore
 * needed a real RPC frame. This is the precedence rule #646 must preserve.
 */
describe.runIf(target.inProcess)("orpc-ssg skip-auth", () => {
  it("ignores a valid session cookie on an SSG request", async () => {
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    });
    const res = await rpcResponse((client) => client.apiKey.list(), {
      [Header.Client]: Client.ORPC_SSG,
      cookie,
      "x-forwarded-for": "10.90.3.1",
    });
    // The cookie is not consulted on the SSG path, so an admin procedure that
    // succeeds WITH this cookie under Client: orpc must fail without it here.
    await expectUnauthorizedRpc(res);
  });

  it("authorizes the same cookie under Client: orpc (non-SSG dispatch)", async () => {
    // Proves the previous case is about the cookie specifically, not about SSG
    // rejecting everything.
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    });
    const res = await rpcResponse((client) => client.apiKey.list(), {
      [Header.Client]: Client.ORPC,
      cookie,
      "x-forwarded-for": "10.90.3.2",
    });
    expect(res.status).toBe(200);
  });
});
