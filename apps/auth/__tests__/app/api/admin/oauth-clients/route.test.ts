import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chain<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const dbMock = { select: vi.fn(() => chain([])) };
vi.mock("~/lib/db", () => ({ db: dbMock }));

const requireSuperAdminApiKeyMock = vi.fn(() => null);
vi.mock("~/lib/require-super-admin", () => ({
  requireSuperAdminApiKey: requireSuperAdminApiKeyMock,
}));

const adminCreateOAuthClientMock = vi.fn();
const getAuthMock = vi.fn(async () => ({
  api: { adminCreateOAuthClient: adminCreateOAuthClientMock },
}));
vi.mock("~/lib/better-auth", () => ({ getAuth: getAuthMock }));

const logErrorMock = vi.fn();
vi.mock("~/lib/logging", () => ({ logError: logErrorMock }));

const { GET, POST } =
  await import("../../../../../src/app/api/admin/oauth-clients/route");

function makeRequest(body?: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdminApiKeyMock.mockReturnValue(null);
});

describe("GET /api/admin/oauth-clients", () => {
  it("rejects an unauthorized caller before touching the database", async () => {
    requireSuperAdminApiKeyMock.mockReturnValue(
      new Response(null, { status: 401 }) as never,
    );
    await GET(makeRequest());
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("lists clients and derives isPublic from tokenEndpointAuthMethod", async () => {
    dbMock.select.mockReturnValue(
      chain([
        {
          clientId: "confidential-1",
          tokenEndpointAuthMethod: "client_secret_basic",
        },
        { clientId: "public-1", tokenEndpointAuthMethod: "none" },
      ]),
    );

    const res = await GET(makeRequest());
    const body = (await res.json()) as { clients: { isPublic: boolean }[] };

    expect(body.clients).toEqual([
      expect.objectContaining({
        clientId: "confidential-1",
        isPublic: false,
      }),
      expect.objectContaining({ clientId: "public-1", isPublic: true }),
    ]);
  });
});

describe("POST /api/admin/oauth-clients", () => {
  it("rejects an unauthorized caller before touching Better Auth", async () => {
    requireSuperAdminApiKeyMock.mockReturnValue(
      new Response(null, { status: 401 }) as never,
    );
    await POST(makeRequest({ name: "x", redirectUris: ["https://x"] }));
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it("400s when name is missing or blank", async () => {
    const res = await POST(makeRequest({ redirectUris: ["https://x"] }));
    expect(res.status).toBe(400);
  });

  it("400s when redirectUris is missing or empty", async () => {
    const res = await POST(makeRequest({ name: "Client", redirectUris: [] }));
    expect(res.status).toBe(400);
  });

  it("creates a confidential client via adminCreateOAuthClient", async () => {
    adminCreateOAuthClientMock.mockResolvedValue({ client_id: "new-client" });

    const res = await POST(
      makeRequest({
        name: "  Paxvault  ",
        redirectUris: ["https://paxvault.example.com/callback"],
        isPublic: false,
      }),
    );

    expect(res.status).toBe(201);
    expect(adminCreateOAuthClientMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        client_name: "Paxvault",
        application_type: "web",
        token_endpoint_auth_method: "client_secret_basic",
      }) as unknown,
    });
  });

  it("creates a public client with no client secret auth method", async () => {
    adminCreateOAuthClientMock.mockResolvedValue({ client_id: "new-client" });

    await POST(
      makeRequest({
        name: "Mobile App",
        redirectUris: ["com.f3nation.app:/callback"],
        isPublic: true,
      }),
    );

    expect(adminCreateOAuthClientMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        application_type: "native",
        token_endpoint_auth_method: "none",
      }) as unknown,
    });
  });

  it("500s and logs when adminCreateOAuthClient throws", async () => {
    adminCreateOAuthClientMock.mockRejectedValue(new Error("boom"));

    const res = await POST(
      makeRequest({ name: "Client", redirectUris: ["https://x"] }),
    );

    expect(res.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith(
      "auth.admin.oauth_client_create_failed",
      { name: "Client" },
      expect.any(Error),
    );
  });
});
