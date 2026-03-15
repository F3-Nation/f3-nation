import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock auth server module
vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

// Mock API client
vi.mock("@/lib/api/client", () => ({
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import { getMyProfile, updateMyProfile } from "@/lib/api/client";

const mockUser = {
  id: 42,
  f3Name: "Dredd",
  firstName: "Joe",
  lastName: "Smith",
  email: "test@f3.com",
  emailVerified: true,
  phone: null,
  homeRegionId: 1,
  avatarUrl: null,
  meta: null,
  emergencyContact: null,
  emergencyPhone: null,
  emergencyNotes: null,
  status: "active" as const,
  roles: [],
  positions: [],
  created: "2024-01-01",
  updated: "2024-01-01",
};

describe("Profile API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/profile", () => {
    it("returns user profile on success", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        sub: "42",
        email: "test@f3.com",
        iat: Date.now(),
      });
      vi.mocked(getMyProfile).mockResolvedValue(mockUser);

      const { GET } = await import("@/app/api/profile/route");
      const response = await GET();
      const data = (await response.json()) as { f3Name: string };

      expect(response.status).toBe(200);
      expect(data.f3Name).toBe("Dredd");
      expect(getMyProfile).toHaveBeenCalled();
    });
  });

  describe("PATCH /api/profile", () => {
    it("updates basic fields", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        sub: "42",
        email: "test@f3.com",
        iat: Date.now(),
      });
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        f3Name: "NewName",
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f3Name: "NewName" }),
      });
      const response = await PATCH(req);
      const data = (await response.json()) as { f3Name: string };

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith(
        expect.objectContaining({ f3Name: "NewName" }),
      );
      expect(data.f3Name).toBe("NewName");
    });

    it("passes meta fields to the API for server-side merging", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        sub: "42",
        email: "test@f3.com",
        iat: Date.now(),
      });
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        meta: '{"f3_name_origin":"new origin","custom_key":"preserve me","my_f3_why":"because"}',
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          f3_name_origin: "new origin",
          my_f3_why: "because",
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      // Meta fields should be packaged into a meta object and sent to the API
      expect(updateMyProfile).toHaveBeenCalledWith({
        meta: { f3_name_origin: "new origin", my_f3_why: "because" },
      });
    });

    it("rejects unrecognized fields with 400", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        sub: "42",
        email: "test@f3.com",
        iat: Date.now(),
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          f3Name: "Dredd",
          status: "inactive",
          hackerField: "evil",
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Invalid request body");
    });
  });
});
