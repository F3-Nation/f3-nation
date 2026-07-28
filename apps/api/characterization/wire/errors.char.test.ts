import { beforeAll, describe, expect, it } from "vitest";

import { Client, Header } from "@acme/shared/common/enums";

import { expectUnauthorizedRpc } from "../auth/verdict";
import { sessionCookie } from "../fixtures/cookies";
import { normalize, stableStringify } from "../normalize";
import { exhaustRateLimit, RATE_LIMIT_MESSAGE, WINDOW_MS } from "../rate-limit";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

/**
 * The error envelope shape is precisely what #649 must not change: every client
 * in the monorepo branches on `code` and surfaces `message`. Golden it for both
 * handlers.
 */

/** Driven to its limit in beforeAll; only the 429 cases use it. */
const EXHAUSTED_IP = "10.92.9.9";

describe("error envelopes", () => {
  it("goldens the 401 envelope on both handlers", async () => {
    // The router is mounted under API_PREFIX_V1 (packages/api/src/index.ts),
    // and the OpenAPI handler's `prefix: "/"` does not strip it — so the
    // registered path is /v1/event-tag/org/{orgId}, not the brief's
    // unprefixed /event-tag/org/1 (which 404s: verified directly, the OpenAPI
    // handler returns "Not found" for it).
    const rest = await target.invoke(
      req("/v1/event-tag/org/1", {
        headers: { "x-forwarded-for": "10.92.0.1" },
      }),
    );
    expect(rest.status).toBe(401);
    await expect(stableStringify(await normalize(rest))).toMatchFileSnapshot(
      "../__snapshots__/errors-401-openapi.golden.json",
    );

    const rpc = await rpcResponse(
      (client) => client.eventTag.byOrgId({ orgId: 1 }),
      { "x-forwarded-for": "10.92.0.2" },
    );
    await expectUnauthorizedRpc(rpc);
    await expect(stableStringify(await normalize(rpc))).toMatchFileSnapshot(
      "../__snapshots__/errors-401-rpc.golden.json",
    );
  });

  it("goldens the 404 envelope on both handlers", async () => {
    const rest = await target.invoke(
      req("/no-such-route", { headers: { "x-forwarded-for": "10.92.1.1" } }),
    );
    expect(rest.status).toBe(404);
    await expect(stableStringify(await normalize(rest))).toMatchFileSnapshot(
      "../__snapshots__/errors-404-openapi.golden.json",
    );

    // The RPC handler resolves procedures by path under /v1; an unknown one
    // cannot go through the typed client, so issue it directly.
    const rpc = await target.invoke(
      req("/v1/no-such-procedure", {
        method: "POST",
        headers: {
          // Via the enums, not hand-written: the two 404 goldens are
          // byte-identical, so a renamed enum would silently redispatch this
          // to the OpenAPI handler and the test would still pass.
          [Header.Client]: Client.ORPC,
          "content-type": "application/json",
          "x-forwarded-for": "10.92.1.2",
        },
        body: "{}",
      }),
    );
    expect(rpc.status).toBe(404);
    await expect(stableStringify(await normalize(rpc))).toMatchFileSnapshot(
      "../__snapshots__/errors-404-rpc.golden.json",
    );
  });
});

/**
 * `sessionCookie()` signs with the LOCAL `AUTH_SECRET`, so this case only
 * authorizes under `next`/`hono`: staging's secret differs, the cookie is
 * rejected, and it 401s instead of 400 — a staging failure that would read
 * as an error-envelope regression rather than a fixture-only limitation.
 */
describe.runIf(target.inProcess)("error envelopes (in-process only)", () => {
  it("goldens the input-validation envelope on both handlers", async () => {
    // Validation runs AFTER the auth middleware, so an unauthenticated request
    // 401s before it ever gets there. Authorize with a cookie (no DB needed),
    // then send an orgId that z.coerce.number() cannot coerce.
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "user" }],
    });

    const rest = await target.invoke(
      req("/v1/event-tag/org/not-a-number", {
        headers: { cookie, "x-forwarded-for": "10.92.2.1" },
      }),
    );
    // verdict.ts records this as 400, NOT the 422 issue #660 assumed. Pin what
    // the code returns; if it is neither, pin that and say so in the PR body.
    expect(rest.status).toBe(400);
    await expect(stableStringify(await normalize(rest))).toMatchFileSnapshot(
      "../__snapshots__/errors-validation-openapi.golden.json",
    );

    const rpc = await rpcResponse(
      // z.coerce.number() leaves the client's static input type accepting
      // more than a number, so a bad string typechecks with no cast at all —
      // the brief's assumption that one is needed does not hold here.
      (client) => client.eventTag.byOrgId({ orgId: "not-a-number" }),
      { cookie, "x-forwarded-for": "10.92.2.2" },
    );
    expect(rpc.status).toBe(400);
    await expect(stableStringify(await normalize(rpc))).toMatchFileSnapshot(
      "../__snapshots__/errors-validation-rpc.golden.json",
    );
  });
});

/**
 * Separate describe with its own warm-up so no case above pays the ~4s cost or
 * risks inheriting an exhausted counter. The limiter is a module-level
 * singleton and `isolate: true` gives every file a fresh module registry, so
 * exhausting one IP here cannot affect another file.
 */
describe.runIf(target.inProcess)("429 envelope", () => {
  beforeAll(() => exhaustRateLimit(EXHAUSTED_IP), WINDOW_MS);

  it("goldens the 429 envelope on both handlers", async () => {
    const rest = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": EXHAUSTED_IP } }),
    );
    expect(rest.status).toBe(429);
    await expect(
      stableStringify(
        // The retry seconds count down within the window, so scrub the message.
        await normalize(rest, { paths: { message: "<RATE_LIMIT_MESSAGE>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/errors-429-openapi.golden.json");

    const rpc = await rpcResponse((client) => client.ping(), {
      "x-forwarded-for": EXHAUSTED_IP,
    });
    expect(rpc.status).toBe(429);
    // Assert the wording BEFORE scrubbing: the companion wording test below
    // sends no Client header, so it only ever covers the OpenAPI handler.
    const rpcBody = (await rpc.clone().json()) as { json: { message: string } };
    expect(rpcBody.json.message).toMatch(RATE_LIMIT_MESSAGE);
    await expect(
      stableStringify(
        await normalize(rpc, {
          paths: { "json.message": "<RATE_LIMIT_MESSAGE>" },
        }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/errors-429-rpc.golden.json");
  });

  it("pins the retry-message wording separately from the envelope", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": EXHAUSTED_IP } }),
    );
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(RATE_LIMIT_MESSAGE);
  });
});
