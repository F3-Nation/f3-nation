import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chain<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "set"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const dbMock = {
  select: vi.fn(() => chain([{ clientId: "existing-client" }])),
  update: vi.fn(() => chain(undefined)),
};
vi.mock("~/lib/db", () => ({ db: dbMock }));

const requireSuperAdminApiKeyMock = vi.fn(() => null);
vi.mock("~/lib/require-super-admin", () => ({
  requireSuperAdminApiKey: requireSuperAdminApiKeyMock,
}));

const adminUpdateOAuthClientMock = vi.fn();
const getAuthMock = vi.fn(async () => ({
  api: { adminUpdateOAuthClient: adminUpdateOAuthClientMock },
}));
vi.mock("~/lib/better-auth", () => ({ getAuth: getAuthMock }));

const logErrorMock = vi.fn();
vi.mock("~/lib/logging", () => ({ logError: logErrorMock }));

const { PATCH } =
  await import("../../../../../../src/app/api/admin/oauth-clients/[clientId]/route");

function makeRequest(body?: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

function makeInvalidJsonRequest(): NextRequest {
  return {
    headers: new Headers(),
    json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
  } as unknown as NextRequest;
}

function makeContext(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdminApiKeyMock.mockReturnValue(null);
  dbMock.select.mockReturnValue(chain([{ clientId: "existing-client" }]));
  dbMock.update.mockReturnValue(chain(undefined));
});

describe("PATCH /api/admin/oauth-clients/[clientId]", () => {
  it("rejects an unauthorized caller before touching the database", async () => {
    requireSuperAdminApiKeyMock.mockReturnValue(
      new Response(null, { status: 401 }) as never,
    );
    await PATCH(makeRequest({}), makeContext("existing-client"));
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("400s on malformed JSON instead of throwing", async () => {
    const res = await PATCH(
      makeInvalidJsonRequest(),
      makeContext("existing-client"),
    );

    expect(res.status).toBe(400);
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("400s on a null body instead of throwing on property access", async () => {
    const res = await PATCH(makeRequest(null), makeContext("existing-client"));

    expect(res.status).toBe(400);
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("404s when the client does not exist", async () => {
    dbMock.select.mockReturnValue(chain([]));

    const res = await PATCH(makeRequest({}), makeContext("missing-client"));

    expect(res.status).toBe(404);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("flips disabled via a direct DB update", async () => {
    const res = await PATCH(
      makeRequest({ disabled: true }),
      makeContext("existing-client"),
    );

    expect(dbMock.update).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true });
  });

  it("applies a field update via adminUpdateOAuthClient without touching disabled", async () => {
    await PATCH(
      makeRequest({ name: "Renamed" }),
      makeContext("existing-client"),
    );

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(adminUpdateOAuthClientMock).toHaveBeenCalledWith({
      body: {
        client_id: "existing-client",
        update: { client_name: "Renamed" },
      },
    });
  });

  it("applies both a disable flip and a field update in one request", async () => {
    await PATCH(
      makeRequest({ disabled: true, scope: "openid profile" }),
      makeContext("existing-client"),
    );

    expect(dbMock.update).toHaveBeenCalled();
    expect(adminUpdateOAuthClientMock).toHaveBeenCalledWith({
      body: {
        client_id: "existing-client",
        update: { scope: "openid profile" },
      },
    });
  });

  it("500s and logs when the disabled DB write throws", async () => {
    dbMock.update.mockImplementation(() => {
      throw new Error("connection lost");
    });

    const res = await PATCH(
      makeRequest({ disabled: true }),
      makeContext("existing-client"),
    );

    expect(res.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith(
      "auth.admin.oauth_client_disable_failed",
      { clientId: "existing-client" },
      expect.any(Error),
    );
  });

  it("does not flip disabled when a combined field update fails", async () => {
    adminUpdateOAuthClientMock.mockRejectedValue(new Error("boom"));

    const res = await PATCH(
      makeRequest({ name: "Renamed", disabled: true }),
      makeContext("existing-client"),
    );

    expect(res.status).toBe(500);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("500s and logs when adminUpdateOAuthClient throws", async () => {
    adminUpdateOAuthClientMock.mockRejectedValue(new Error("boom"));

    const res = await PATCH(
      makeRequest({ name: "Renamed" }),
      makeContext("existing-client"),
    );

    expect(res.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith(
      "auth.admin.oauth_client_update_failed",
      { clientId: "existing-client" },
      expect.any(Error),
    );
  });
});
