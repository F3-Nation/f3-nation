import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { cleanup, createMixedOrgTree, db, uniqueId } from "@acme/api/testing";
import { eq, schema } from "@acme/db";

import { target } from "../transport";

// Run the Auth handler against the characterization database, never its app DB.
vi.mock("../../../auth/src/lib/db", () => ({ db }));

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("../../../auth/src/lib/current-session", () => ({
  getCurrentSession: () => Promise.resolve({ user: { id: session.userId } }),
}));
// Resolve handlers through Vitest with Auth's aliases; each app typechecks its
// own source. These tests exercise the HTTP request/response boundary.
const { POST } = await vi.importActual<{
  POST: (request: Request) => Promise<Response>;
}>("../../../auth/src/app/api/onboarding/route");
const { GET } = await vi.importActual<{
  GET: () => Promise<Response>;
}>("../../../auth/src/app/api/regions/route");

describe.runIf(target.inProcess)("registration region choices", () => {
  const orgIds: number[] = [];
  let userId: number;
  let tree: Awaited<ReturnType<typeof createMixedOrgTree>>;

  beforeAll(async () => {
    tree = await createMixedOrgTree(orgIds);
    const [user] = await db
      .insert(schema.users)
      .values({ email: `${uniqueId()}@example.invalid` })
      .returning({ id: schema.users.id });
    if (!user) throw new Error("Missing fixture user");
    userId = user.id;
    session.userId = String(userId);
    await db
      .update(schema.orgs)
      .set({ isActive: false })
      .where(eq(schema.orgs.id, tree.directBranch.area.id));
    await db
      .update(schema.orgs)
      .set({ isActive: false })
      .where(eq(schema.orgs.id, tree.territoryBranch.region.id));
  });

  afterAll(async () => {
    if (userId) await cleanup.user(userId);
    for (const id of [...orgIds].reverse()) await cleanup.org(id);
  });

  it("offers active regions only when their ancestors are active", async () => {
    const response = await GET();
    const rows = (await response.json()) as { id: number; name: string }[];
    expect(response.status).toBe(200);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(tree.unrelatedBranch.region.id);
    expect(ids).not.toContain(tree.directBranch.region.id);
    expect(ids).not.toContain(tree.territoryBranch.region.id);
    expect(ids).not.toContain(tree.unrelatedBranch.ao.id);
    expect(
      rows.every((row) => Object.keys(row).sort().join(",") === "id,name"),
    ).toBe(true);
  });
  it("rejects onboarding into a region beneath an inactive ancestor without changing the profile", async () => {
    const request = new Request("https://auth.test.invalid/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        f3Name: "Fixture",
        firstName: "Synthetic",
        lastName: "Member",
        homeRegionId: tree.directBranch.region.id,
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const [stored] = await db
      .select({
        homeRegionId: schema.users.homeRegionId,
        f3Name: schema.users.f3Name,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(stored).toEqual({ homeRegionId: null, f3Name: null });
  });
});
