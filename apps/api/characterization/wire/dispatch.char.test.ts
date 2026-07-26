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
  });

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
    // DOES resolve at the RPC handler (RPCHandler matches procedures by
    // path+method, not only by decoding an RPC-encoded body), so this is a
    // 200, not a 404. What actually distinguishes the handlers is the body
    // shape: the RPC codec wraps the payload in a `{json, meta}` envelope,
    // while the OpenAPI handler returns the plain object (see the
    // dispatch-rpc-ping vs dispatch-rest-ping goldens above).
    const res = await target.invoke(
      req("/v1/ping", {
        headers: {
          [Header.Client]: clientHeader,
          "x-forwarded-for": clientIp,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json?: unknown; meta?: unknown };
    expect(body).toHaveProperty("json");
    expect(body).toHaveProperty("meta");
  });

  it("falls through to the OpenAPI handler when no Client header is sent", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.90.2.1" } }),
    );
    // The OpenAPI handler mounts at prefix "/", so /v1/ping resolves for it.
    expect(res.status).toBe(200);
  });

  it("404s an unknown path under /v1 without a Client header", async () => {
    const res = await target.invoke(
      req("/v1/not-a-procedure", {
        headers: { "x-forwarded-for": "10.90.2.2" },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});

/**
 * Carried over from Phase B, which could not reach this branch: `orpc-ssg` plus
 * a REST-shaped request 404s at the RPC handler BEFORE auth runs, so the
 * skip-auth semantics were unreachable without a real RPC frame. This is the
 * precedence rule #646 must preserve.
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
