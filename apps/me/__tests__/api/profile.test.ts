import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock auth server module
vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

// Mock API client
vi.mock("@/lib/api/client", () => ({
  getUserByEmail: vi.fn(),
  updateUser: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import { getUserByEmail, updateUser } from "@/lib/api/client";

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
      vi.mocked(getUserByEmail).mockResolvedValue({
        id: 42,
        f3Name: "Dredd",
        firstName: "Joe",
        lastName: "Smith",
        email: "test@f3.com",
        phone: null,
        homeRegionId: 1,
        avatarUrl: null,
        meta: '{"f3_name_origin":"test"}',
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
        status: "active",
        roles: [],
        created: "2024-01-01",
        updated: "2024-01-01",
      });

      const { GET } = await import("@/app/api/profile/route");
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.f3Name).toBe("Dredd");
      expect(getUserByEmail).toHaveBeenCalledWith("test@f3.com");
    });
  });

  describe("PATCH /api/profile", () => {
    it("updates basic fields", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        sub: "42",
        email: "test@f3.com",
        iat: Date.now(),
      });
      vi.mocked(getUserByEmail).mockResolvedValue({
        id: 42,
        f3Name: "Dredd",
        firstName: "Joe",
        lastName: "Smith",
        email: "test@f3.com",
        phone: null,
        homeRegionId: 1,
        avatarUrl: null,
        meta: null,
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
        status: "active",
        roles: [],
        created: "2024-01-01",
        updated: "2024-01-01",
      });
      vi.mocked(updateUser).mockResolvedValue({
        id: 42,
        f3Name: "NewName",
        firstName: "Joe",
        lastName: "Smith",
        email: "test@f3.com",
        phone: null,
        homeRegionId: 1,
        avatarUrl: null,
        meta: null,
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
        status: "active",
        roles: [],
        created: "2024-01-01",
        updated: "2024-01-01",
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f3Name: "NewName" }),
      });
      const response = await PATCH(req);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, f3Name: "NewName" }),
      );
      expect(data.f3Name).toBe("NewName");
    });

    it("merges meta fields with existing meta", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        sub: "42",
        email: "test@f3.com",
        iat: Date.now(),
      });
      vi.mocked(getUserByEmail).mockResolvedValue({
        id: 42,
        f3Name: "Dredd",
        firstName: null,
        lastName: "Smith",
        email: "test@f3.com",
        phone: null,
        homeRegionId: null,
        avatarUrl: null,
        meta: '{"f3_name_origin":"old origin","custom_key":"preserve me"}',
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
        status: "active",
        roles: [],
        created: "2024-01-01",
        updated: "2024-01-01",
      });
      vi.mocked(updateUser).mockResolvedValue({
        id: 42,
        f3Name: "Dredd",
        firstName: null,
        lastName: "Smith",
        email: "test@f3.com",
        phone: null,
        homeRegionId: null,
        avatarUrl: null,
        meta: '{"f3_name_origin":"new origin","custom_key":"preserve me","my_f3_why":"because"}',
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
        status: "active",
        roles: [],
        created: "2024-01-01",
        updated: "2024-01-01",
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
      // Should have fetched current user for existing meta
      expect(getUserByEmail).toHaveBeenCalledWith("test@f3.com");
      // Should have merged meta
      const updateCall = vi.mocked(updateUser).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      const meta = JSON.parse(updateCall.meta as string);
      expect(meta.f3_name_origin).toBe("new origin");
      expect(meta.my_f3_why).toBe("because");
      expect(meta.custom_key).toBe("preserve me");
    });

    it("ignores unrecognized fields", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        sub: "42",
        email: "test@f3.com",
        iat: Date.now(),
      });
      vi.mocked(getUserByEmail).mockResolvedValue({
        id: 42,
        f3Name: "Dredd",
        firstName: null,
        lastName: "Smith",
        email: "test@f3.com",
        phone: null,
        homeRegionId: null,
        avatarUrl: null,
        meta: null,
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
        status: "active",
        roles: [],
        created: "2024-01-01",
        updated: "2024-01-01",
      });
      vi.mocked(updateUser).mockResolvedValue({
        id: 42,
        f3Name: "Dredd",
        firstName: null,
        lastName: "Smith",
        email: "test@f3.com",
        phone: null,
        homeRegionId: null,
        avatarUrl: null,
        meta: null,
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
        status: "active",
        roles: [],
        created: "2024-01-01",
        updated: "2024-01-01",
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          f3Name: "Dredd",
          status: "inactive", // Should be ignored
          hackerField: "evil", // Should be ignored
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      const updateCall = vi.mocked(updateUser).mock.calls[0]![0];
      expect(updateCall).not.toHaveProperty("status");
      expect(updateCall).not.toHaveProperty("hackerField");
    });
  });
});
