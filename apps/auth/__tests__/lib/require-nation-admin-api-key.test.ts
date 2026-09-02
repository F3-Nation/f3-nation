import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chain<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "innerJoin", "set"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const dbMock = { select: vi.fn(), update: vi.fn(() => chain(undefined)) };
vi.mock("~/lib/db", () => ({ db: dbMock }));

const { requireNationAdminApiKey } =
  await import("~/lib/require-nation-admin-api-key");

function makeRequest(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return { headers } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const NATION_ADMIN_ROLES = [
  { orgId: 1, orgName: "F3 Nation", roleName: "admin" },
];

/**
 * First select() call finds the key row; second resolves its org roles.
 * Only queues the second value when a key was actually found — the code
 * never issues that second select() when the first comes back empty, and
 * an unconsumed mockReturnValueOnce would otherwise leak into whichever
 * test runs next.
 */
function mockApiKeyLookup(
  apiKeyRow: { apiKeyId: number }[],
  orgRoles: { orgId: number; orgName: string; roleName: string }[] = [],
) {
  dbMock.select.mockReturnValueOnce(chain(apiKeyRow));
  if (apiKeyRow.length > 0) {
    dbMock.select.mockReturnValueOnce(chain(orgRoles));
  }
}

describe("requireNationAdminApiKey", () => {
  it("authorizes a key with the nation-admin role and records its use", async () => {
    mockApiKeyLookup([{ apiKeyId: 1 }], NATION_ADMIN_ROLES);

    const result = await requireNationAdminApiKey(
      makeRequest("Bearer valid-key"),
    );

    expect(result).toBeNull();
    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });

  it("accepts a lowercase bearer prefix", async () => {
    mockApiKeyLookup([{ apiKeyId: 1 }], NATION_ADMIN_ROLES);

    const result = await requireNationAdminApiKey(
      makeRequest("bearer valid-key"),
    );

    expect(result).toBeNull();
  });

  it("rejects a request with no authorization header", async () => {
    const result = await requireNationAdminApiKey(makeRequest());
    expect(result?.status).toBe(401);
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("rejects a non-bearer authorization header", async () => {
    const result = await requireNationAdminApiKey(
      makeRequest("Basic dXNlcjpwYXNz"),
    );
    expect(result?.status).toBe(401);
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("rejects an empty bearer token", async () => {
    const result = await requireNationAdminApiKey(makeRequest("Bearer "));
    expect(result?.status).toBe(401);
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown key (revoked, expired, or never issued) without recording use", async () => {
    mockApiKeyLookup([]);

    const result = await requireNationAdminApiKey(
      makeRequest("Bearer unknown-key"),
    );

    expect(result?.status).toBe(401);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("rejects a valid key with no nation-admin role at all, but still records its use", async () => {
    mockApiKeyLookup([{ apiKeyId: 1 }], []);

    const result = await requireNationAdminApiKey(
      makeRequest("Bearer valid-key"),
    );

    expect(result?.status).toBe(401);
    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });

  it("rejects a valid key that's an admin of a different org, not the Nation", async () => {
    mockApiKeyLookup(
      [{ apiKeyId: 1 }],
      [{ orgId: 42, orgName: "Some Region", roleName: "admin" }],
    );

    const result = await requireNationAdminApiKey(
      makeRequest("Bearer valid-key"),
    );

    expect(result?.status).toBe(401);
  });

  it("rejects a valid key that's only an editor at the Nation org", async () => {
    mockApiKeyLookup(
      [{ apiKeyId: 1 }],
      [{ orgId: 1, orgName: "F3 Nation", roleName: "editor" }],
    );

    const result = await requireNationAdminApiKey(
      makeRequest("Bearer valid-key"),
    );

    expect(result?.status).toBe(401);
  });
});
