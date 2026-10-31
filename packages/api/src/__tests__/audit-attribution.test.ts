import type { Session } from "@acme/auth";
import { schema, sql } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as auditContext from "../lib/with-audit-context";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  createNoPermissionSession,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "./test-utils";

describe("API audit attribution", () => {
  const locationIds: number[] = [];
  const orgIds: number[] = [];
  const eventTypeIds: number[] = [];

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => {
    for (const id of locationIds.reverse()) await cleanup.location(id);
    for (const id of eventTypeIds) await cleanup.eventType(id);
    for (const id of orgIds.reverse()) await cleanup.org(id);
  });

  it("records the authenticated actor when a location is created", async () => {
    const nation = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Audit region ${uniqueId()}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning();
    if (!region) throw new Error("Missing synthetic region");
    orgIds.push(region.id);
    await mockAuthWithSession(await createAdminSession());

    const { location } = await createTestClient().location.crupdate({
      name: "Audit location",
      orgId: region.id,
      latitude: 35.5,
      longitude: -80.5,
      isActive: true,
    });
    if (!location) throw new Error("Missing created location");
    locationIds.push(location.id);

    const rows = await db.execute(sql`
      SELECT op, changed_by, changed_via, new_row->>'name' AS name
      FROM public_history.locations WHERE row_id = ${String(location.id)}
      ORDER BY id
    `);
    expect(rows).toEqual([
      {
        op: "I",
        changed_by: 1,
        changed_via: null,
        name: "Audit location",
      },
    ]);
    await createTestClient().location.crupdate({
      id: location.id,
      orgId: region.id,
      name: "Renamed audit location",
      isActive: true,
    });
    await createTestClient().location.delete({ id: location.id });
    expect(
      await db.execute(sql`
      SELECT op, changed_by, new_row->>'is_active' AS active
      FROM public_history.locations WHERE row_id = ${String(location.id)} ORDER BY id
    `),
    ).toEqual([
      { op: "I", changed_by: 1, active: "true" },
      { op: "U", changed_by: 1, active: "true" },
      { op: "U", changed_by: 1, active: "false" },
    ]);
    await mockAuthWithSession(createNoPermissionSession());
    await expect(
      createTestClient().location.crupdate({
        id: location.id,
        orgId: region.id,
        name: "Unauthorized change",
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      await db.execute(
        sql`SELECT id FROM public_history.locations WHERE row_id = ${String(location.id)}`,
      ),
    ).toHaveLength(3);
  });

  it("leaves API-key writes unattributed even when the credential has an owner", async () => {
    const nation = await getOrCreateF3NationOrg();
    const session: Session = {
      ...(await createAdminSession()),
      apiKey: {
        id: 1,
        key: "synthetic-location-key",
        ownerId: 1,
        revokedAt: null,
        expiresAt: null,
        orgIds: [nation.id],
      },
    };
    await mockAuthWithSession(session);
    const { location } = await createTestClient().location.crupdate({
      name: "API key audit location",
      orgId: nation.id,
      isActive: true,
    });
    if (!location) throw new Error("Missing created location");
    locationIds.push(location.id);
    expect(
      await db.execute(
        sql`SELECT changed_by, changed_via FROM public_history.locations WHERE row_id = ${String(location.id)}`,
      ),
    ).toEqual([{ changed_by: null, changed_via: null }]);
  });

  it("does not add an audit transaction to the read-only POST permission check", async () => {
    const nation = await getOrCreateF3NationOrg();
    await mockAuthWithSession(await createAdminSession());
    const audit = vi.spyOn(auditContext, "withAuditContext");
    try {
      const result = await createTestClient().request.canEditRegions({
        orgIds: [nation.id],
      });
      expect(result.results).toMatchObject([{ success: true }]);
      expect(audit).not.toHaveBeenCalled();

      // A covered write proves this spy observes the router's helper calls.
      const { location } = await createTestClient().location.crupdate({
        name: "Audit query control",
        orgId: nation.id,
        isActive: true,
      });
      if (!location) throw new Error("Missing synthetic control location");
      locationIds.push(location.id);
      expect(audit).toHaveBeenCalledTimes(1);
    } finally {
      audit.mockRestore();
    }
  });

  it("keeps an unconverted router's writes unattributed", async () => {
    await mockAuthWithSession(await createAdminSession());
    const { eventType } = await createTestClient().eventType.crupdate({
      name: `Unconverted audit type ${uniqueId()}`,
      eventCategory: "first_f",
      isActive: true,
    });
    const row = eventType?.[0];
    if (!row) throw new Error("Missing synthetic event type");
    eventTypeIds.push(row.id);
    expect(
      await db.execute(
        sql`SELECT changed_by, changed_via FROM public_history.event_types WHERE row_id = ${String(row.id)}`,
      ),
    ).toEqual([{ changed_by: null, changed_via: null }]);
  });
});
