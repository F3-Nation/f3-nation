import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  getPositionAssignments: vi.fn(),
  updatePositionAssignments: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import {
  getPositionAssignments,
  updatePositionAssignments,
} from "@/lib/api/client";

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
    vi.mocked(getPositionAssignments).mockResolvedValue({
      orgId: 5,
      assignments: [
        { positionId: 10, positionName: "Nantan", userIds: [42, 100, 200] },
        { positionId: 20, positionName: "Weasel Shaker", userIds: [300] },
      ],
    });
    vi.mocked(updatePositionAssignments).mockResolvedValue({
      orgId: 5,
      assignments: [
        { positionId: 10, positionName: "Nantan", userIds: [100, 200] },
        { positionId: 20, positionName: "Weasel Shaker", userIds: [300] },
      ],
    });

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 5, positionId: 10 }),
    });

    const response = await DELETE(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify it preserved other users and other positions
    expect(updatePositionAssignments).toHaveBeenCalledWith(5, [
      { positionId: 10, userIds: [100, 200] }, // 42 removed
      { positionId: 20, userIds: [300] }, // Untouched
    ]);
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
