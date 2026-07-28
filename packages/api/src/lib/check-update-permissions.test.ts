import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@acme/auth";

// checkUpdatePermissions builds where clauses with eq/inArray and reads rows
// off schema.events / schema.locations. Keep those as identity tokens so the
// fake db below can route `.from(table)` to the right rows without a real DB.
vi.mock("@acme/db", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  inArray: vi.fn((column: unknown, values: unknown) => ({ column, values })),
  schema: {
    events: { id: "events.id" },
    locations: { id: "locations.id" },
  },
}));

// The per-org role check has its own coverage; here we drive its boolean
// outcome directly to isolate the aggregation rule (.every) under test.
vi.mock("../check-has-role-on-org", () => ({
  checkHasRoleOnOrg: vi.fn(),
}));

import { schema } from "@acme/db";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { checkUpdatePermissions } from "./check-update-permissions";

type CheckArgs = Parameters<typeof checkUpdatePermissions>[0];

const mockCheckHasRoleOnOrg = vi.mocked(checkHasRoleOnOrg);

/**
 * Makes checkHasRoleOnOrg succeed only for the given org ids, so a test can
 * describe exactly which regions/AOs the reviewer controls.
 */
const allowOrgs = (allowed: number[]) => {
  mockCheckHasRoleOnOrg.mockImplementation(({ orgId }) =>
    Promise.resolve({
      success: allowed.includes(orgId),
      orgId,
      roleName: "editor",
      mode: allowed.includes(orgId) ? "direct-permission" : "no-permission",
    }),
  );
};

/** The org ids that were actually run through the role check, sorted. */
const checkedOrgIds = () =>
  mockCheckHasRoleOnOrg.mock.calls
    .map((call) => call[0].orgId)
    .sort((a, b) => a - b);

interface FakeRows {
  event?: Record<string, unknown>;
  locations?: Record<string, unknown>[];
}

/**
 * Minimal db that resolves `.select().from(table).where()` to the configured
 * rows, keyed by which table was queried.
 */
const makeDb = (rows: FakeRows): CheckArgs["ctx"]["db"] =>
  ({
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          Promise.resolve(
            table === schema.events
              ? rows.event
                ? [rows.event]
                : []
              : table === schema.locations
                ? (rows.locations ?? [])
                : [],
          ),
      }),
    }),
  }) as unknown as CheckArgs["ctx"]["db"];

const session = {
  user: { email: "reviewer@example.com" },
} as unknown as Session;

describe("checkUpdatePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success:false and runs no role checks when there is no session", async () => {
    const result = await checkUpdatePermissions({
      input: { originalRegionId: 1, newRegionId: 2 },
      ctx: { db: makeDb({}), session: null },
    });

    expect(result).toEqual({ success: false, results: [] });
    expect(mockCheckHasRoleOnOrg).not.toHaveBeenCalled();
  });

  it("returns success:false and runs no role checks when there are no orgs to check", async () => {
    const result = await checkUpdatePermissions({
      input: {},
      ctx: { db: makeDb({}), session },
    });

    expect(result).toEqual({ success: false, results: [] });
    expect(mockCheckHasRoleOnOrg).not.toHaveBeenCalled();
  });

  it("checks BOTH the source and the target region for a cross-region move", async () => {
    allowOrgs([1, 2]);

    const result = await checkUpdatePermissions({
      input: { originalRegionId: 1, newRegionId: 2 },
      ctx: { db: makeDb({}), session },
    });

    expect(result.success).toBe(true);
    // newRegionId must be part of the checked set, not just the source region;
    // dropping it would let a single-region editor move an AO into a region
    // they don't control.
    expect(checkedOrgIds()).toEqual([1, 2]);
  });

  it("denies the move when the editor controls only the source region", async () => {
    // Editor on the source (originalRegionId) but not the target (newRegionId).
    allowOrgs([1]);

    const result = await checkUpdatePermissions({
      input: { originalRegionId: 1, newRegionId: 2 },
      ctx: { db: makeDb({}), session },
    });

    // The rule is `.every` — a `.some` regression (or dropping newRegionId from
    // the checked set) would wrongly allow this move.
    expect(result.success).toBe(false);
    expect(checkedOrgIds()).toEqual([1, 2]);
  });

  it("denies the move when the editor controls only the target region", async () => {
    allowOrgs([2]);

    const result = await checkUpdatePermissions({
      input: { originalRegionId: 1, newRegionId: 2 },
      ctx: { db: makeDb({}), session },
    });

    expect(result.success).toBe(false);
    expect(checkedOrgIds()).toEqual([1, 2]);
  });

  it("grants the move only when the editor controls every affected org", async () => {
    allowOrgs([1, 2, 3]);

    const result = await checkUpdatePermissions({
      input: { originalRegionId: 1, newRegionId: 2, originalAoId: 3 },
      ctx: { db: makeDb({}), session },
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(checkedOrgIds()).toEqual([1, 2, 3]);
  });

  it("expands the org set to include the event's org and its location's org", async () => {
    // The submitter only named a region, but the existing event lives under a
    // different AO/location; those orgs must also be authorized.
    allowOrgs([1, 50, 70]);

    const result = await checkUpdatePermissions({
      input: { originalEventId: 10, originalRegionId: 1 },
      ctx: {
        db: makeDb({
          event: { id: 10, orgId: 50, locationId: 60 },
          locations: [{ id: 60, orgId: 70 }],
        }),
        session,
      },
    });

    expect(result.success).toBe(true);
    expect(checkedOrgIds()).toEqual([1, 50, 70]);
  });

  it("denies when the reviewer lacks permission on the event's own AO", async () => {
    // Reviewer controls the named region but not the AO the event sits under.
    allowOrgs([1]);

    const result = await checkUpdatePermissions({
      input: { originalEventId: 10, originalRegionId: 1 },
      ctx: {
        db: makeDb({ event: { id: 10, orgId: 50, locationId: null } }),
        session,
      },
    });

    expect(result.success).toBe(false);
    expect(checkedOrgIds()).toEqual([1, 50]);
  });

  it("dedupes repeated org ids so each affected org is checked once", async () => {
    allowOrgs([1]);

    const result = await checkUpdatePermissions({
      input: { originalRegionId: 1, newRegionId: 1, originalAoId: 1 },
      ctx: { db: makeDb({}), session },
    });

    expect(result.success).toBe(true);
    expect(mockCheckHasRoleOnOrg).toHaveBeenCalledTimes(1);
    expect(checkedOrgIds()).toEqual([1]);
  });
});
