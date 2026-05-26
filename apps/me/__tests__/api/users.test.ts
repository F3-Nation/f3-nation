import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  getUsers: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import { getUsers } from "@/lib/api/client";

const mockSession = {
  sub: "42",
  email: "test@f3.com",
  userId: 42,
};

describe("Users API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("GET /api/users", () => {
    it("returns 400 when neither userId nor searchTerm provided", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users");
      const response = await GET(req);

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toContain("userId or searchTerm");
    });

    it("returns users for a valid searchTerm", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getUsers).mockResolvedValue([
        {
          id: 1,
          f3Name: "Dredd",
          homeRegionId: 1,
          homeRegionName: "Charlotte",
          status: "active",
        },
        {
          id: 2,
          f3Name: "Maverick",
          homeRegionId: 2,
          homeRegionName: "Raleigh",
          status: "active",
        },
      ]);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?searchTerm=dre");
      const response = await GET(req);
      const data = (await response.json()) as {
        users: { id: number; f3Name: string }[];
      };

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(2);
      expect(getUsers).toHaveBeenCalledWith({
        userId: undefined,
        searchTerm: "dre",
      });
    });

    it("returns users for a valid userId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getUsers).mockResolvedValue([
        {
          id: 1,
          f3Name: "Dredd",
          homeRegionId: 5,
          homeRegionName: "Charlotte",
          status: "active",
        },
      ]);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?userId=1");
      const response = await GET(req);
      const data = (await response.json()) as {
        users: { id: number }[];
      };

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(1);
      expect(getUsers).toHaveBeenCalledWith({
        userId: 1,
        searchTerm: undefined,
      });
    });

    it("returns 400 when searchTerm is only 1 character", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?searchTerm=x");
      const response = await GET(req);

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toContain("searchTerm");
    });

    it("returns 400 for non-integer userId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?userId=abc");
      const response = await GET(req);

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toContain("userId");
    });

    it("returns 400 for negative userId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?userId=-1");
      const response = await GET(req);

      expect(response.status).toBe(400);
    });

    it("returns empty list when no users match searchTerm", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getUsers).mockResolvedValue([]);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?searchTerm=zzz");
      const response = await GET(req);
      const data = (await response.json()) as {
        users: { id: number }[];
      };

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(0);
    });

    it("returns 500 when API client throws", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getUsers).mockRejectedValue(new Error("API error 500"));

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?searchTerm=test");
      const response = await GET(req);

      expect(response.status).toBe(500);
      const data = (await response.json()) as { error: string };
      expect(data.error).toContain("Failed to fetch users");
    });

    it("re-throws redirect errors from requireAuth", async () => {
      vi.mocked(requireAuth).mockRejectedValue(new Error("NEXT_REDIRECT: /"));

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users");

      await expect(GET(req)).rejects.toThrow("NEXT_REDIRECT");
    });
  });
});
