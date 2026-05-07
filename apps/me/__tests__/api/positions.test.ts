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

const mockSession = {
  sub: "42",
  email: "test@f3.com",
  userId: 42,
};

describe("Positions API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes user from a position assignment", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
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

  it("returns found:false when position assignment does not exist", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(deleteMyPosition).mockResolvedValue({
      success: true,
      found: false,
    });

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 999, positionId: 999 }),
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

  it("returns 400 when missing positionId", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 5 }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("orgId and positionId are required");
  });

  it("returns 400 when missing orgId", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionId: 10 }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when orgId is not a number", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "five", positionId: 10 }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when positionId is not a number", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 5, positionId: "ten" }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when body is malformed JSON", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("Invalid JSON");
  });

  it("returns 400 when body is empty", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(400);
  });

  it("returns 500 when API client throws", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(deleteMyPosition).mockRejectedValue(new Error("API error 500"));

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 5, positionId: 10 }),
    });

    const response = await DELETE(req);
    expect(response.status).toBe(500);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("Failed to remove position");
  });

  it("re-throws redirect errors from requireAuth", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error("NEXT_REDIRECT: /"));

    const { DELETE } = await import("@/app/api/profile/positions/route");
    const req = new NextRequest("http://localhost/api/profile/positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: 5, positionId: 10 }),
    });

    await expect(DELETE(req)).rejects.toThrow("NEXT_REDIRECT");
  });
});
