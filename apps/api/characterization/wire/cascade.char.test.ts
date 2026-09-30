import { describe, expect, it, onTestFinished } from "vitest";

import { db, getOrCreateF3NationOrg, uniqueId } from "@acme/api/testing";
import { eq, schema } from "@acme/db";

import { createApiKey } from "../fixtures/api-keys";
import { req, target } from "../transport";

/**
 * `org.delete` on an AO reaches `await import("../lib/cascade-service")`, a
 * dynamic import esbuild can turn into a separate chunk. Nothing else in the
 * matrix routes through it, so without this a broken chunk reference in the
 * built bundle would ship behind a green live leg. The handler's own unit
 * tests cover the cascade logic; this pins that the import resolves and runs
 * end to end.
 *
 * Needs fixtures the server can see, so it runs in-process and on the CI
 * bundle leg (CHAR_TEST_SHARED_DB=1), never against Staging.
 */
describe.runIf(target.sharesDatabase)("cascade-service dynamic import", () => {
  it("soft-deletes an AO and its series through org.delete", async () => {
    const nation = await getOrCreateF3NationOrg();
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Cascade AO ${uniqueId()}`,
        orgType: "ao",
        parentId: nation.id,
        isActive: true,
      })
      .returning({ id: schema.orgs.id });
    if (!ao) throw new Error("failed to insert fixture AO");
    onTestFinished(async () => {
      await db.delete(schema.events).where(eq(schema.events.orgId, ao.id));
      await db.delete(schema.orgs).where(eq(schema.orgs.id, ao.id));
    });

    const [series] = await db
      .insert(schema.events)
      .values({
        name: `Cascade series ${uniqueId()}`,
        orgId: ao.id,
        dayOfWeek: "friday",
        startTime: "0600",
        startDate: "2026-01-01",
        recurrencePattern: "weekly",
        isActive: true,
        highlight: false,
      })
      .returning({ id: schema.events.id });
    if (!series) throw new Error("failed to insert fixture series");

    const apiKey = await createApiKey({
      roles: [{ roleName: "admin", orgId: ao.id }],
    });
    onTestFinished(() => apiKey.cleanup());

    const res = await target.invoke(
      req(`/v1/org/delete/${ao.id}`, {
        method: "DELETE",
        headers: {
          "x-forwarded-for": "10.95.0.1",
          authorization: `Bearer ${apiKey.key}`,
          client: "characterization",
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: ao.id });
    const [after] = await db
      .select({ isActive: schema.events.isActive })
      .from(schema.events)
      .where(eq(schema.events.id, series.id));
    expect(after?.isActive).toBe(false);
  });
});
