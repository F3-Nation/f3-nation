import { describe, expect, it, onTestFinished } from "vitest";

import { db, getOrCreateF3NationOrg, uniqueId } from "@acme/api/testing";
import { eq, schema } from "@acme/db";

import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

describe.runIf(target.sharesDatabase)("map location AOs in region", () => {
  it("returns the same AOs for a REST query string and a numeric RPC input", async () => {
    const nation = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Transport region ${uniqueId()}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning({ id: schema.orgs.id });
    if (!region) throw new Error("failed to insert fixture region");
    onTestFinished(async () => {
      await db.delete(schema.orgs).where(eq(schema.orgs.parentId, region.id));
      await db.delete(schema.orgs).where(eq(schema.orgs.id, region.id));
    });

    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Transport AO ${uniqueId()}`,
        orgType: "ao",
        parentId: region.id,
        isActive: true,
      })
      .returning({ id: schema.orgs.id, name: schema.orgs.name });
    if (!ao) throw new Error("failed to insert fixture AO");

    const expected = { aos: [{ ...ao, workouts: [] }] };
    const rpc = await rpcResponse(
      (client) => client.map.location.getAOsInRegion({ regionId: region.id }),
      { "x-forwarded-for": "10.96.0.1" },
    );
    expect(rpc.status).toBe(200);
    expect(await rpc.json()).toEqual({ json: expected });

    for (const regionId of [`${region.id}`, ` 00${region.id}.0 `]) {
      const rest = await target.invoke(
        req(
          `/v1/map/location/aos-in-region?regionId=${encodeURIComponent(regionId)}`,
          {
            headers: {
              client: "characterization",
              "x-forwarded-for": "10.96.0.2",
            },
          },
        ),
      );
      expect(rest.status).toBe(200);
      expect(await rest.json()).toEqual(expected);
    }
  });
});

describe("map location region query validation", () => {
  it.each([
    "",
    "?regionId=",
    "?regionId=%20%20",
    "?regionId=not-a-number",
    "?regionId=Infinity",
    "?regionId=0x10",
    "?regionId=1e3",
    "?regionId=1.0000000000000001",
    "?regionId=2147483647.0000001",
    "?regionId=-2147483648.0000001",
  ])("rejects missing or invalid numeric input: %s", async (query) => {
    const res = await target.invoke(
      req(`/v1/map/location/aos-in-region${query}`, {
        headers: {
          client: "characterization",
          "x-forwarded-for": "10.96.0.3",
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each(
    [
      null,
      false,
      true,
      [],
      [1],
      {},
      "0x10",
      "1e3",
      "1.0000000000000001",
      "2147483647.0000001",
      "-2147483648.0000001",
    ].map((regionId) => ({
      regionId,
    })),
  )("rejects invalid RPC input: %j", async ({ regionId }) => {
    const res = await rpcResponse(
      (client) => client.map.location.getAOsInRegion({ regionId }),
      { "x-forwarded-for": "10.96.0.4" },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      json: { code: "BAD_REQUEST" },
    });
  });

  it.each([
    0, -1, -2, -2_147_483_648, 1.5, -1.5, 2_147_483_648, -2_147_483_649,
    99_999_999_999,
  ])(
    "rejects a REST region ID outside the positive integer domain: %s",
    async (regionId) => {
      const res = await target.invoke(
        req(`/v1/map/location/aos-in-region?regionId=${regionId}`, {
          headers: {
            client: "characterization",
            "x-forwarded-for": "10.96.0.7",
          },
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    },
  );

  it.each([
    0, -1, -2, -2_147_483_648, 1.5, -1.5, 2_147_483_648, -2_147_483_649,
    99_999_999_999,
  ])(
    "rejects an RPC region ID outside the positive integer domain: %s",
    async (regionId) => {
      const res = await rpcResponse(
        (client) => client.map.location.getAOsInRegion({ regionId }),
        { "x-forwarded-for": "10.96.0.8" },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        json: { code: "BAD_REQUEST" },
      });
    },
  );

  it.each([1, 2_147_483_647])(
    "accepts an inclusive positive integer bound for REST and RPC: %s",
    async (regionId) => {
      const rpc = await rpcResponse(
        (client) => client.map.location.getAOsInRegion({ regionId }),
        { "x-forwarded-for": "10.96.0.5" },
      );
      expect(rpc.status).toBe(200);
      const rpcBody = (await rpc.json()) as { json: { aos: unknown[] } };
      expect(rpcBody.json.aos).toBeInstanceOf(Array);

      const rest = await target.invoke(
        req(`/v1/map/location/aos-in-region?regionId=${regionId}`, {
          headers: {
            client: "characterization",
            "x-forwarded-for": "10.96.0.6",
          },
        }),
      );
      expect(rest.status).toBe(200);
      expect(await rest.json()).toEqual(rpcBody.json);
    },
  );
});
