import type * as OrpcClient from "@orpc/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_REQUEST_TIMEOUT_MS } from "~/lib/api/availability";

const { cookiesMock, profileMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  profileMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));

vi.mock("@orpc/client", async (importOriginal) => ({
  ...(await importOriginal<typeof OrpcClient>()),
  createORPCClient: () => ({ me: { profile: profileMock } }),
}));

describe("getMyProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("F3_API_BASE_URL", "https://api.test.com");
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token" }),
    });
  });

  it("bounds the profile request with a timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    profileMock.mockResolvedValue({ user: { roles: [] } });

    const { getMyProfile } = await import("~/lib/api/client");
    await getMyProfile();

    expect(timeoutSpy).toHaveBeenCalledWith(API_REQUEST_TIMEOUT_MS);
    const signal: unknown = timeoutSpy.mock.results[0]?.value;
    expect(profileMock).toHaveBeenCalledWith(undefined, { signal });
  });
});
