import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  getUserByEmail: vi.fn(),
  updateUser: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import { getUserByEmail, updateUser } from "@/lib/api/client";

describe("Roles API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a role from the user", async () => {
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
      roles: [
        { orgId: 1, roleName: "admin", orgName: "Charlotte" },
        { orgId: 2, roleName: "user", orgName: "Raleigh" },
      ],
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
      roles: [{ orgId: 2, roleName: "user", orgName: "Raleigh" }],
      created: "2024-01-01",
      updated: "2024-01-01",
    });

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 1, roleName: "admin" }),
    });

    const response = await DELETE(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        roles: [{ orgId: 2, roleName: "user", orgName: "Raleigh" }],
      }),
    );
    expect(data.roles).toHaveLength(1);
  });

  it("returns 400 when missing required fields", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      sub: "42",
      email: "test@f3.com",
      iat: Date.now(),
    });

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 1 }), // Missing roleName
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });
});
