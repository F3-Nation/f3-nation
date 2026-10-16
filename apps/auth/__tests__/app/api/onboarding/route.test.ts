import type { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chain<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.where = vi.fn(() => obj);
  obj.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const set = vi.fn();
const dbMock = {
  select: vi.fn(() => chain([])),
  update: vi.fn(() => ({ set: set.mockReturnValue({ where: vi.fn() }) })),
};

vi.mock("~/lib/db", () => ({ db: dbMock }));
vi.mock("~/lib/current-session", () => ({ getCurrentSession: vi.fn() }));

const { getCurrentSession } = await import("~/lib/current-session");
const { GET, POST } = await import("../../../../src/app/api/onboarding/route");

const profile = { f3Name: "Test PAX", firstName: "Test", lastName: "User" };

function post(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

// POST reads the active-region check first (when a region is sent), then the
// user's current meta.
function selects(...results: unknown[][]) {
  for (const result of results) {
    dbMock.select.mockReturnValueOnce(chain(result));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.select.mockReset().mockReturnValue(chain([]));
  vi.mocked(getCurrentSession).mockResolvedValue({
    user: { id: "42" },
  } as never);
});

describe("GET /api/onboarding", () => {
  it("requires a session", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("returns the saved home region with the rest of the profile", async () => {
    selects([{ ...profile, homeRegionId: 7 }]);

    const res = await GET();

    expect(await res.json()).toEqual({
      ...profile,
      homeRegionId: 7,
      isExistingUser: true,
    });
  });

  it("returns a null region for someone who never picked one", async () => {
    selects([
      { f3Name: null, firstName: null, lastName: null, homeRegionId: null },
    ]);

    const res = await GET();

    expect(await res.json()).toEqual({
      f3Name: "",
      firstName: "",
      lastName: "",
      homeRegionId: null,
      isExistingUser: false,
    });
  });
});

describe("POST /api/onboarding", () => {
  it("requires a session", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    const res = await POST(post({ ...profile, homeRegionId: 7 }));

    expect(res.status).toBe(401);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("still requires all three names", async () => {
    const res = await POST(post({ f3Name: "Test PAX", homeRegionId: 7 }));

    expect(res.status).toBe(400);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("saves the region and stamps when the profile was confirmed", async () => {
    selects([{ id: 7 }], [{ meta: { slack: "keep-me" } }]);

    const res = await POST(post({ ...profile, homeRegionId: 7 }));

    expect(res.status).toBe(200);
    const update = set.mock.calls[0]?.[0] as {
      meta: Record<string, unknown>;
    } & Record<string, unknown>;
    expect(update).toMatchObject({ ...profile, homeRegionId: 7 });
    expect(update.meta.slack).toBe("keep-me");
    const stamp = update.meta.onboarding_completed;
    expect(typeof stamp).toBe("string");
    expect(new Date(stamp as string).toISOString()).toBe(stamp);
  });

  it("rejects an unknown or retired region", async () => {
    selects([]);

    const res = await POST(post({ ...profile, homeRegionId: 999 }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "homeRegionId must be an active region",
    });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it.each([
    ["a region id that isn't an integer", "7"],
    ["a fractional region id", 7.5],
    ["a region id beyond a 32-bit integer", 2 ** 31],
    ["a negative region id", -1],
  ])("rejects %s without querying", async (_name, homeRegionId) => {
    const res = await POST(post({ ...profile, homeRegionId }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "homeRegionId must be an active region",
    });
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("only accepts an active region, checked in the query itself", async () => {
    // Capture the region lookup's condition (the first select).
    const first = chain([{ id: 7 }]);
    const second = chain([{ meta: {} }]);
    dbMock.select.mockReset();
    dbMock.select.mockReturnValueOnce(first).mockReturnValueOnce(second);

    await POST(post({ ...profile, homeRegionId: 7 }));

    const where = (first.where as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as SQL;
    const { sql, params } = new PgDialect().sqlToQuery(where);
    expect(sql).toContain('"org_type"');
    expect(sql).toContain('"is_active"');
    expect(params).toEqual(expect.arrayContaining([7, "region", true]));
  });

  it("lets a page loaded before the region field existed finish", async () => {
    selects([{ meta: {} }]);

    const res = await POST(post(profile));

    expect(res.status).toBe(200);
    const update = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(update).toMatchObject(profile);
    expect(update).not.toHaveProperty("homeRegionId");
    expect(update.meta).toHaveProperty("onboarding_completed");
  });
});
