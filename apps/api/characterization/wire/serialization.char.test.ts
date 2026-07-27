import { describe, expect, it } from "vitest";

import { sessionCookie } from "../fixtures/cookies";
import { normalize, stableStringify } from "../normalize";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

/**
 * The two handlers serialize the same handler return value differently, and
 * both shapes are load-bearing contracts for their clients. A port that routes
 * every request through one handler would pass the auth matrix and silently
 * change every date and null on the wire.
 */
describe("serialization", () => {
  it("preserves the Date type over RPC and emits ISO-8601 over REST", async () => {
    // `ping` returns { alive: boolean, timestamp: z.date() }.
    const rpc = await rpcResponse((client) => client.ping(), {
      "x-forwarded-for": "10.93.0.1",
    });
    const rpcBody = (await rpc.clone().json()) as {
      json: { timestamp: unknown };
    };
    // Pin the FORMAT before scrubbing, exactly as the REST branch below does:
    // the <TIMESTAMP> token would otherwise hide a null or an epoch number,
    // since `meta` pins the Date TYPE MARKER, not the encoding.
    expect(rpcBody.json.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    await expect(
      stableStringify(
        await normalize(rpc, { paths: { "json.timestamp": "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot(
      "../__snapshots__/serialization-date-rpc.golden.json",
    );

    const rest = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.93.0.2" } }),
    );
    const restBody = (await rest.clone().json()) as { timestamp: string };
    // Pin the FORMAT before scrubbing the value; a golden alone would hide a
    // switch from ISO-8601 to an epoch number behind the <TIMESTAMP> token.
    expect(restBody.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    await expect(
      stableStringify(
        await normalize(rest, { paths: { timestamp: "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot(
      "../__snapshots__/serialization-date-openapi.golden.json",
    );
  });

  // Reads the database (eventTag.byOrgId), so keep it to the in-process
  // target only, same as the 429 warm-up in errors.char.test.ts. Org id
  // 999999 is well outside the seed's range, so the empty-collection branch
  // is exercised without seeding anything.
  describe.runIf(target.inProcess)("empty collection field", () => {
    it("carries an empty collection through both handlers identically", async () => {
      // eventTag.byOrgId returns { eventTags: EventTag[] | null }. An org id
      // with no tags pins the empty-array case; neither handler has been
      // observed to emit `null` here, so that branch is not covered.
      const cookie = await sessionCookie({
        roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "user" }],
      });

      // The router is mounted under API_PREFIX_V1 (packages/api/src/index.ts)
      // and the OpenAPI handler's prefix "/" does not strip it, so the
      // registered path is /v1/event-tag/org/{orgId} — the brief's unprefixed
      // /event-tag/org/999999 404s (confirmed in errors.char.test.ts for the
      // analogous 401 case).
      const rest = await target.invoke(
        req("/v1/event-tag/org/999999", {
          headers: { cookie, "x-forwarded-for": "10.93.1.1" },
        }),
      );
      expect(rest.status).toBe(200);
      await expect(stableStringify(await normalize(rest))).toMatchFileSnapshot(
        "../__snapshots__/serialization-empty-collection-openapi.golden.json",
      );

      const rpc = await rpcResponse(
        (client) => client.eventTag.byOrgId({ orgId: 999999 }),
        { cookie, "x-forwarded-for": "10.93.1.2" },
      );
      expect(rpc.status).toBe(200);
      await expect(stableStringify(await normalize(rpc))).toMatchFileSnapshot(
        "../__snapshots__/serialization-empty-collection-rpc.golden.json",
      );
    });
  });
});
