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

const mockSession = {
  sub: "42",
  email: "test@f3.com",
  userId: 42,
  iat: Date.now(),
};

describe("Roles API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("removes a role from the user", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
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

  it("returns found:false when role assignment does not exist", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(deleteMyRole).mockResolvedValue({
      success: true,
      found: false,
    });

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 999, roleId: 999 }),
    });

    const response = await DELETE(req);
    const data = (await response.json()) as {
      success: boolean;
      found: boolean;
    };

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.found).toBe(false);
  });

  it("returns 400 when missing roleId", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 1 }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("orgId and roleId are required");
  });

  it("returns 400 when missing orgId", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: 5 }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when orgId is not a number", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "one", roleId: 5 }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when roleId is not a number", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 1, roleId: "admin" }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });

  it("returns 500 when API client throws", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(deleteMyRole).mockRejectedValue(new Error("API error 500"));

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 1, roleId: 5 }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(500);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("Failed to remove role");
  });

  it("re-throws redirect errors from requireAuth", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error("NEXT_REDIRECT: /"));

    const { DELETE } = await import("@/app/api/profile/roles/route");
    const req = new NextRequest("http://localhost/api/profile/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 1, roleId: 5 }),
    });

    await expect(DELETE(req)).rejects.toThrow("NEXT_REDIRECT");
  });
});
