import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({ get: () => ({ value: "synthetic-token" }) }),
  ),
}));

const fetchMock = vi.fn<typeof fetch>();

describe("Admin API client identifiers", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("$client", undefined);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("F3_API_BASE_URL", "https://api.test/v1");
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ json: { user: { id: 42 } } }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps the server-side direct client on RPC and retains its bearer token", async () => {
    const { getMyProfile } = await import("~/lib/api/client");
    expect(await getMyProfile()).toEqual({ id: 42 });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.headers.get("client")).toBe("orpc");
    expect(request.headers.get("authorization")).toBe("Bearer synthetic-token");
  });

  it("keeps the browser client on RPC and retains cookies", async () => {
    const { client } = await import("~/orpc/client");
    await client.me.profile();
    const [request, init] = fetchMock.mock.calls[0]!;
    expect((request as Request).headers.get("client")).toBe("orpc");
    expect(init?.credentials).toBe("include");
  });
});
