import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/gcs", () => ({
  uploadAvatar: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  getUserByEmail: vi.fn(),
  updateUser: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import { uploadAvatar } from "@/lib/gcs";
import { getUserByEmail, updateUser } from "@/lib/api/client";

// Helper to create a mock NextRequest whose formData() works in jsdom
function createMockRequest(formData: FormData) {
  return {
    formData: async () => formData,
  } as unknown as import("next/server").NextRequest;
}

describe("Avatar API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without a file", async () => {
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

    const { POST } = await import("@/app/api/profile/avatar/route");
    const formData = new FormData();
    const req = createMockRequest(formData);

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("No file");
  });

  it("rejects invalid file types", async () => {
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

    const { POST } = await import("@/app/api/profile/avatar/route");
    const file = new File(["content"], "test.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.append("file", file);

    const req = createMockRequest(formData);

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid file type");
  });

  it("uploads valid images successfully", async () => {
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
    vi.mocked(uploadAvatar).mockResolvedValue(
      "https://storage.googleapis.com/f3-logos/user-avatars/42.jpg",
    );
    vi.mocked(updateUser).mockResolvedValue({
      id: 42,
      f3Name: "Dredd",
      firstName: null,
      lastName: "Smith",
      email: "test@f3.com",
      phone: null,
      homeRegionId: null,
      avatarUrl: "https://storage.googleapis.com/f3-logos/user-avatars/42.jpg",
      meta: null,
      emergencyContact: null,
      emergencyPhone: null,
      emergencyNotes: null,
      status: "active",
      roles: [],
      created: "2024-01-01",
      updated: "2024-01-01",
    });

    const { POST } = await import("@/app/api/profile/avatar/route");

    // Create a mock file with arrayBuffer support (jsdom File lacks it)
    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const file = {
      name: "avatar.jpg",
      type: "image/jpeg",
      size: content.byteLength,
      arrayBuffer: async () => content.buffer,
    } as unknown as File;
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;

    const req = {
      formData: async () => mockFormData,
    } as unknown as import("next/server").NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.avatarUrl).toContain("storage.googleapis.com");
    expect(uploadAvatar).toHaveBeenCalledWith(42, expect.any(Buffer));
    expect(updateUser).toHaveBeenCalledWith({
      id: 42,
      avatarUrl: "https://storage.googleapis.com/f3-logos/user-avatars/42.jpg",
      roles: [],
    });
  });
});
