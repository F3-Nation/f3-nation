import { beforeEach, describe, expect, it, vi } from "vitest";

import { orgs } from "@acme/db/schema/schema";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  rows: vi.fn(),
  depthScan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/db", () => ({ db: { select: mocks.select } }));
vi.mock("@acme/api/org-tree", () => ({
  logIfOrgTreeExceedsMaxDepth: mocks.depthScan,
}));

const { GET } = await import("~/app/api/regions/route");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.mockResolvedValue([]);
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: mocks.rows,
  };
  mocks.select.mockReturnValue(query);
});

describe("GET /api/regions", () => {
  it("exposes only public region identifiers and names", async () => {
    const regions = [{ id: 7, name: "Test region" }];
    mocks.rows.mockResolvedValue(regions);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(regions);
    expect(mocks.select).toHaveBeenCalledWith({ id: orgs.id, name: orgs.name });
  });

  it("returns an empty list when no selectable regions exist", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("does not disguise a database failure as an empty successful list", async () => {
    const failure = new Error("Database unavailable");
    mocks.rows.mockRejectedValue(failure);
    await expect(GET()).rejects.toBe(failure);
  });
});
