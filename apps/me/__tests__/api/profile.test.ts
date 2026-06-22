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

const mockSession = {
  sub: "42",
  email: "test@f3.com",
  userId: 42,
};

const mockUser = {
  id: 42,
  f3Name: "Dredd",
  firstName: "Joe",
  lastName: "Smith",
  email: "test@f3.com",
  emailVerified: null,
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
    vi.resetModules();
  });

  describe("GET /api/profile", () => {
    it("returns user profile on success", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getMyProfile).mockResolvedValue(mockUser);

      const { GET } = await import("@/app/api/profile/route");
      const response = await GET();
      const data = (await response.json()) as { f3Name: string };

      expect(response.status).toBe(200);
      expect(data.f3Name).toBe("Dredd");
      expect(getMyProfile).toHaveBeenCalled();
    });

    it("returns user with full role and position data", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getMyProfile).mockResolvedValue({
        ...mockUser,
        roles: [
          { roleId: 1, orgId: 10, roleName: "admin", orgName: "Charlotte" },
          { roleId: 2, orgId: 11, roleName: "user", orgName: "Raleigh" },
        ],
        positions: [
          {
            positionId: 1,
            orgId: 10,
            positionName: "Q",
            orgName: "Charlotte",
          },
        ],
      });

      const { GET } = await import("@/app/api/profile/route");
      const response = await GET();
      const data = (await response.json()) as {
        roles: { roleName: string }[];
        positions: { positionName: string }[];
      };

      expect(response.status).toBe(200);
      expect(data.roles).toHaveLength(2);
      expect(data.positions).toHaveLength(1);
    });

    it("returns user with emergency contact fields", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getMyProfile).mockResolvedValue({
        ...mockUser,
        emergencyContact: "Jane Smith",
        emergencyPhone: "555-1234",
        emergencyNotes: "Allergic to peanuts",
      });

      const { GET } = await import("@/app/api/profile/route");
      const response = await GET();
      const data = (await response.json()) as {
        emergencyContact: string;
        emergencyPhone: string;
        emergencyNotes: string;
      };

      expect(response.status).toBe(200);
      expect(data.emergencyContact).toBe("Jane Smith");
      expect(data.emergencyPhone).toBe("555-1234");
      expect(data.emergencyNotes).toBe("Allergic to peanuts");
    });

    it("returns user with meta as JSON object", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getMyProfile).mockResolvedValue({
        ...mockUser,
        meta: { f3_name_origin: "Movie character", my_f3_why: "Fitness" },
      });

      const { GET } = await import("@/app/api/profile/route");
      const response = await GET();
      const data = (await response.json()) as {
        meta: { f3_name_origin: string; my_f3_why: string };
      };

      expect(response.status).toBe(200);
      expect(data.meta.f3_name_origin).toBe("Movie character");
      expect(data.meta.my_f3_why).toBe("Fitness");
    });

    it("returns 500 when API client throws", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(getMyProfile).mockRejectedValue(
        new Error("API error 500: Internal Server Error"),
      );

      const { GET } = await import("@/app/api/profile/route");
      const response = await GET();

      expect(response.status).toBe(500);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Failed to fetch profile");
    });

    it("re-throws redirect errors from requireAuth", async () => {
      vi.mocked(requireAuth).mockRejectedValue(new Error("NEXT_REDIRECT: /"));

      const { GET } = await import("@/app/api/profile/route");
      await expect(GET()).rejects.toThrow("NEXT_REDIRECT");
    });
  });

  describe("PATCH /api/profile", () => {
    it("returns 400 for malformed JSON payload", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{ bad json",
      });

      const response = await PATCH(req);

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Invalid JSON payload");
      expect(updateMyProfile).not.toHaveBeenCalled();
    });

    it("updates basic fields", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
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

    it("updates multiple fields at once", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        f3Name: "NewName",
        firstName: "John",
        phone: "555-9999",
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          f3Name: "NewName",
          firstName: "John",
          phone: "555-9999",
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({
        f3Name: "NewName",
        firstName: "John",
        phone: "555-9999",
      });
    });

    it("updates homeRegionId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        homeRegionId: 5,
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeRegionId: 5 }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({ homeRegionId: 5 });
    });

    it("allows setting homeRegionId to null", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        homeRegionId: null,
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeRegionId: null }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({ homeRegionId: null });
    });

    it("allows setting firstName to null", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        firstName: null,
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: null }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({ firstName: null });
    });

    it("allows setting phone to null", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        phone: null,
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: null }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({ phone: null });
    });

    it("passes meta fields to the API for server-side merging", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        meta: { f3_name_origin: "new origin", my_f3_why: "because" },
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
      expect(updateMyProfile).toHaveBeenCalledWith({
        meta: { f3_name_origin: "new origin", my_f3_why: "because" },
      });
    });

    it("mixes direct fields and meta fields in one request", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        f3Name: "Judge",
        meta: { f3_name_origin: "from the movie" },
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          f3Name: "Judge",
          f3_name_origin: "from the movie",
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({
        f3Name: "Judge",
        meta: { f3_name_origin: "from the movie" },
      });
    });

    it("passes brought_by as a meta field", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue(mockUser);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brought_by: 99 }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({
        meta: { brought_by: 99 },
      });
    });

    it("allows setting brought_by to null", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue(mockUser);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brought_by: null }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({
        meta: { brought_by: null },
      });
    });

    it("passes start_date_override as a meta field", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue(mockUser);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date_override: "2020-01-15" }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({
        meta: { start_date_override: "2020-01-15" },
      });
    });

    it("passes user_emergency_info_dr_sharing as a meta field", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue(mockUser);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_emergency_info_dr_sharing: true }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({
        meta: { user_emergency_info_dr_sharing: true },
      });
    });

    it("updates emergency contact fields", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        emergencyContact: "Jane",
        emergencyPhone: "555-0000",
        emergencyNotes: "No allergies",
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emergencyContact: "Jane",
          emergencyPhone: "555-0000",
          emergencyNotes: "No allergies",
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({
        emergencyContact: "Jane",
        emergencyPhone: "555-0000",
        emergencyNotes: "No allergies",
      });
    });

    it("allows setting emergency fields to null", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emergencyContact: null,
          emergencyPhone: null,
          emergencyNotes: null,
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
      expect(updateMyProfile).toHaveBeenCalledWith({
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
      });
    });

    it("rejects unrecognized fields with 400 (strict schema)", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

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

    it("rejects attempts to change email", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "hacker@evil.com" }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects attempts to change id", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 999 }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects attempts to change status", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects f3Name that is empty string", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f3Name: "" }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects f3Name exceeding 200 chars", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f3Name: "x".repeat(201) }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects emergencyNotes exceeding 1000 chars", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emergencyNotes: "x".repeat(1001) }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects non-positive homeRegionId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeRegionId: -1 }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects non-integer homeRegionId", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeRegionId: 3.5 }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects avatarUrl that is not a valid URL", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: "not-a-url" }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("accepts a valid avatarUrl on the f3-public-images bucket", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      const url =
        "https://storage.googleapis.com/f3-public-images/user-avatars/42.jpg";
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        avatarUrl: url,
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: url }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
    });

    it("accepts a valid avatarUrl on the f3-public-images-staging bucket", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      const url =
        "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg";
      vi.mocked(updateMyProfile).mockResolvedValue({
        ...mockUser,
        avatarUrl: url,
      });

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: url }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(200);
    });

    it("rejects avatarUrl pointing at a non-allow-listed host", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarUrl: "https://attacker.example/track.gif",
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("rejects avatarUrl pointing at a different GCS bucket", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarUrl: "https://storage.googleapis.com/other-bucket/42.jpg",
        }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(400);
    });

    it("returns 500 when updateMyProfile throws", async () => {
      vi.mocked(requireAuth).mockResolvedValue(mockSession);
      vi.mocked(updateMyProfile).mockRejectedValue(new Error("API error 500"));

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f3Name: "Test" }),
      });
      const response = await PATCH(req);

      expect(response.status).toBe(500);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Failed to update profile");
    });

    it("re-throws redirect errors from requireAuth in PATCH", async () => {
      vi.mocked(requireAuth).mockRejectedValue(new Error("NEXT_REDIRECT: /"));

      const { PATCH } = await import("@/app/api/profile/route");
      const req = new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f3Name: "Test" }),
      });

      await expect(PATCH(req)).rejects.toThrow("NEXT_REDIRECT");
    });
  });
});
