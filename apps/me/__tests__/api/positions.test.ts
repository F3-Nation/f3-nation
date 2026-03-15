import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  deleteMyPosition: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import { deleteMyPosition } from "@/lib/api/client";

describe("Positions API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes user from a position assignment", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      sub: "42",
      email: "test@f3.com",
      iat: Date.now(),
    });
    vi.mocked(deleteMyPosition).mockResolvedValue({
      success: true,
      found: true,
    });

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 5, positionId: 10 }),
    });

    const response = await DELETE(req);
    const data = (await response.json()) as {
      success: boolean;
      found: boolean;
    };

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.found).toBe(true);
    expect(deleteMyPosition).toHaveBeenCalledWith(5, 10);
  });

  it("returns 400 when missing required fields", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      sub: "42",
      email: "test@f3.com",
      iat: Date.now(),
    });

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 5 }), // Missing positionId
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });
});
