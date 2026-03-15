import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  deleteMyRole: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import { deleteMyRole } from "@/lib/api/client";

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
    vi.mocked(deleteMyRole).mockResolvedValue({
      success: true,
      found: true,
    });

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 1, roleId: 5 }),
    });

    const response = await DELETE(req);
    const data = (await response.json()) as {
      success: boolean;
      found: boolean;
    };

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(deleteMyRole).toHaveBeenCalledWith(1, 5);
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
      body: JSON.stringify({ orgId: 1 }), // Missing roleId
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });
});
