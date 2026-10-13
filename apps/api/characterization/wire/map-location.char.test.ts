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

    const rest = await target.invoke(
      req(`/v1/map/location/aos-in-region?regionId=${region.id}`, {
        headers: {
          client: "characterization",
          "x-forwarded-for": "10.96.0.2",
        },
      }),
    );
    expect(rest.status).toBe(200);
    expect(await rest.json()).toEqual(expected);
  });
});

describe("map location region query validation", () => {
  it.each(["", "?regionId=not-a-number", "?regionId=Infinity"])(
    "rejects missing or invalid numeric input: %s",
    async (query) => {
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
    },
  );
});
