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
    it("returns all users when no homeRegionId provided", async () => {
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
      const req = new NextRequest("http://localhost/api/users");
      const response = await GET(req);
      const data = (await response.json()) as {
        users: { id: number; f3Name: string }[];
      };

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(2);
      expect(getUsers).toHaveBeenCalledWith({
        userId: undefined,
        homeRegionId: undefined,
        searchTerm: undefined,
      });
    });

    it("filters by homeRegionId when provided", async () => {
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
      const req = new NextRequest("http://localhost/api/users?homeRegionId=5");
      const response = await GET(req);
      const data = (await response.json()) as {
        users: { id: number }[];
      };

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(1);
      expect(getUsers).toHaveBeenCalledWith({
        userId: undefined,
        homeRegionId: 5,
        searchTerm: undefined,
      });
    });

    it("passes searchTerm when provided", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getUsers).mockResolvedValue([
        {
          id: 9,
          f3Name: "Forrest",
          homeRegionId: 12,
          homeRegionName: "Shire",
          status: "active",
        },
      ]);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?searchTerm=For");
      const response = await GET(req);

      expect(response.status).toBe(200);
      expect(getUsers).toHaveBeenCalledWith({
        userId: undefined,
        homeRegionId: undefined,
        searchTerm: "For",
      });
    });

    it("returns 400 for non-integer homeRegionId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest(
        "http://localhost/api/users?homeRegionId=abc",
      );
      const response = await GET(req);

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toContain("homeRegionId");
    });

    it("returns 400 for negative homeRegionId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?homeRegionId=-1");
      const response = await GET(req);

      expect(response.status).toBe(400);
    });

    it("returns 400 for zero homeRegionId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest("http://localhost/api/users?homeRegionId=0");
      const response = await GET(req);

      expect(response.status).toBe(400);
    });

    it("returns 400 for decimal homeRegionId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest(
        "http://localhost/api/users?homeRegionId=3.5",
      );
      const response = await GET(req);

      expect(response.status).toBe(400);
    });

    it("returns empty list when no users match", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getUsers).mockResolvedValue([]);

      const { GET } = await import("@/app/api/users/route");
      const req = new NextRequest(
        "http://localhost/api/users?homeRegionId=999",
      );
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
      const req = new NextRequest("http://localhost/api/users");
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
