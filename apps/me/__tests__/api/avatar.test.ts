import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/gcs", () => ({
  uploadAvatar: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  updateMyProfile: vi.fn(),
  isNotFoundApiError: vi.fn().mockReturnValue(false),
  getMyProfile: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/server";
import { uploadAvatar } from "@/lib/gcs";
import {
  updateMyProfile,
  isNotFoundApiError,
  getMyProfile,
} from "@/lib/api/client";
import type { NextRequest } from "next/server";

const mockSession = {
  sub: "42",
  email: "test@f3.com",
  userId: 42,
};

function createMockRequest(formData: FormData) {
  return {
    formData: async () => formData,
  } as unknown as NextRequest;
}

describe("Avatar API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: profile exists (preflight succeeds)
    vi.mocked(getMyProfile).mockResolvedValue({
      id: 42,
      f3Name: "Dredd",
      firstName: null,
      lastName: null,
      email: "test@f3.com",
      emailVerified: null,
      phone: null,
      homeRegionId: null,
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
    });
  });

  it("rejects requests without a file", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { POST } = await import("@/app/api/profile/avatar/route");
    const formData = new FormData();
    const req = createMockRequest(formData);

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("No file");
  });

  it("rejects invalid file types (PDF)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { POST } = await import("@/app/api/profile/avatar/route");
    const file = new File(["content"], "test.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.append("file", file);

    const req = createMockRequest(formData);

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("Invalid file type");
  });

  it("rejects invalid file types (GIF)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { POST } = await import("@/app/api/profile/avatar/route");
    const file = new File(["content"], "funny.gif", {
      type: "image/gif",
    });
    const formData = new FormData();
    formData.append("file", file);

    const req = createMockRequest(formData);

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("Invalid file type");
  });

  it("rejects invalid file types (SVG)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { POST } = await import("@/app/api/profile/avatar/route");
    const file = new File(["<svg></svg>"], "icon.svg", {
      type: "image/svg+xml",
    });
    const formData = new FormData();
    formData.append("file", file);

    const req = createMockRequest(formData);

    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("rejects files over 5MB", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { POST } = await import("@/app/api/profile/avatar/route");
    // Create a file slightly over 5MB
    const bigContent = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([bigContent], "big.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", file);

    const req = createMockRequest(formData);

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("File too large");
  });

  it("accepts files at exactly 5MB", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(uploadAvatar).mockResolvedValue(
      "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
    );
    vi.mocked(updateMyProfile).mockResolvedValue({
      id: 42,
      f3Name: "Dredd",
      firstName: null,
      lastName: "Smith",
      email: "test@f3.com",
      emailVerified: null,
      phone: null,
      homeRegionId: null,
      avatarUrl:
        "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
      meta: null,
      emergencyContact: null,
      emergencyPhone: null,
      emergencyNotes: null,
      status: "active" as const,
      roles: [],
      positions: [],
      created: "2024-01-01",
      updated: "2024-01-01",
    });

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array(5 * 1024 * 1024);
    const file = Object.assign(
      new File([content], "exact5mb.jpg", { type: "image/jpeg" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(200);
  });

  it("uploads valid JPEG images successfully", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(uploadAvatar).mockResolvedValue(
      "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
    );
    vi.mocked(updateMyProfile).mockResolvedValue({
      id: 42,
      f3Name: "Dredd",
      firstName: null,
      lastName: "Smith",
      email: "test@f3.com",
      emailVerified: null,
      phone: null,
      homeRegionId: null,
      avatarUrl:
        "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
      meta: null,
      emergencyContact: null,
      emergencyPhone: null,
      emergencyNotes: null,
      status: "active" as const,
      roles: [],
      positions: [],
      created: "2024-01-01",
      updated: "2024-01-01",
    });

    const { POST } = await import("@/app/api/profile/avatar/route");

    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const file = Object.assign(
      new File([content], "avatar.jpg", { type: "image/jpeg" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = (await response.json()) as { avatarUrl: string };
    expect(data.avatarUrl).toContain("storage.googleapis.com");
    expect(uploadAvatar).toHaveBeenCalledWith(42, expect.any(Buffer));
    expect(updateMyProfile).toHaveBeenCalledWith({
      avatarUrl:
        "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
    });
  });

  it("accepts PNG images", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(uploadAvatar).mockResolvedValue(
      "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
    );
    vi.mocked(updateMyProfile).mockResolvedValue({
      id: 42,
      f3Name: "Dredd",
      firstName: null,
      lastName: "Smith",
      email: "test@f3.com",
      emailVerified: null,
      phone: null,
      homeRegionId: null,
      avatarUrl:
        "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
      meta: null,
      emergencyContact: null,
      emergencyPhone: null,
      emergencyNotes: null,
      status: "active" as const,
      roles: [],
      positions: [],
      created: "2024-01-01",
      updated: "2024-01-01",
    });

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const file = Object.assign(
      new File([content], "avatar.png", { type: "image/png" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(200);
  });

  it("accepts WebP images", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(uploadAvatar).mockResolvedValue(
      "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
    );
    vi.mocked(updateMyProfile).mockResolvedValue({
      id: 42,
      f3Name: "Dredd",
      firstName: null,
      lastName: "Smith",
      email: "test@f3.com",
      emailVerified: null,
      phone: null,
      homeRegionId: null,
      avatarUrl:
        "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
      meta: null,
      emergencyContact: null,
      emergencyPhone: null,
      emergencyNotes: null,
      status: "active" as const,
      roles: [],
      positions: [],
      created: "2024-01-01",
      updated: "2024-01-01",
    });

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const file = Object.assign(
      new File([content], "avatar.webp", { type: "image/webp" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(200);
  });

  it("uses userId from session for upload", async () => {
    const session99 = { ...mockSession, userId: 99 };
    vi.mocked(requireAuth).mockResolvedValue(session99);
    vi.mocked(uploadAvatar).mockResolvedValue(
      "https://storage.googleapis.com/f3-public-images-staging/user-avatars/99.jpg",
    );
    vi.mocked(updateMyProfile).mockResolvedValue({
      id: 99,
      f3Name: "Iceman",
      firstName: null,
      lastName: "Jones",
      email: "ice@f3.com",
      emailVerified: null,
      phone: null,
      homeRegionId: null,
      avatarUrl:
        "https://storage.googleapis.com/f3-public-images-staging/user-avatars/99.jpg",
      meta: null,
      emergencyContact: null,
      emergencyPhone: null,
      emergencyNotes: null,
      status: "active" as const,
      roles: [],
      positions: [],
      created: "2024-01-01",
      updated: "2024-01-01",
    });

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array([0xff, 0xd8]);
    const file = Object.assign(
      new File([content], "pic.jpg", { type: "image/jpeg" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(uploadAvatar).toHaveBeenCalledWith(99, expect.any(Buffer));
  });

  it("returns 500 when uploadAvatar throws", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(uploadAvatar).mockRejectedValue(new Error("GCS upload failed"));

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array([0xff, 0xd8]);
    const file = Object.assign(
      new File([content], "avatar.jpg", { type: "image/jpeg" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(500);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("Failed to upload avatar");
  });

  it("returns 503 with actionable message when GCS service account is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(uploadAvatar).mockRejectedValue(
      new Error("invalid_grant: Invalid grant: account not found"),
    );

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array([0xff, 0xd8]);
    const file = Object.assign(
      new File([content], "avatar.jpg", { type: "image/jpeg" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(503);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("service account was not found");
  });

  it("returns 500 when updateMyProfile throws after upload", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(uploadAvatar).mockResolvedValue(
      "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
    );
    vi.mocked(updateMyProfile).mockRejectedValue(new Error("API error 500"));

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array([0xff, 0xd8]);
    const file = Object.assign(
      new File([content], "avatar.jpg", { type: "image/jpeg" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(500);
  });

  it("returns 404 when profile does not exist (preflight)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    const notFoundErr = Object.assign(new Error("Not found"), {
      code: "NOT_FOUND",
    });
    vi.mocked(getMyProfile).mockRejectedValue(notFoundErr);
    vi.mocked(isNotFoundApiError).mockReturnValueOnce(true);

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array([0xff, 0xd8]);
    const file = Object.assign(
      new File([content], "avatar.jpg", { type: "image/jpeg" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(404);
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it("returns 404 when updateMyProfile throws a not-found error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(uploadAvatar).mockResolvedValue(
      "https://storage.googleapis.com/f3-public-images-staging/user-avatars/42.jpg",
    );
    const notFoundErr = Object.assign(new Error("Not found"), {
      code: "NOT_FOUND",
    });
    vi.mocked(updateMyProfile).mockRejectedValue(notFoundErr);
    vi.mocked(isNotFoundApiError).mockReturnValueOnce(true);

    const { POST } = await import("@/app/api/profile/avatar/route");
    const content = new Uint8Array([0xff, 0xd8]);
    const file = Object.assign(
      new File([content], "avatar.jpg", { type: "image/jpeg" }),
      { arrayBuffer: async () => content.buffer },
    );
    const mockFormData = {
      get: (key: string) => (key === "file" ? file : null),
    } as unknown as FormData;
    const req = {
      formData: async () => mockFormData,
    } as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("re-throws redirect errors from requireAuth", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error("NEXT_REDIRECT: /"));

    const { POST } = await import("@/app/api/profile/avatar/route");
    const formData = new FormData();
    const req = createMockRequest(formData);

    await expect(POST(req)).rejects.toThrow("NEXT_REDIRECT");
  });

  it("rejects non-file form data entries", async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession);

    const { POST } = await import("@/app/api/profile/avatar/route");
    const formData = new FormData();
    formData.append("file", "just a string, not a file");
    const req = createMockRequest(formData);

    const response = await POST(req);
    expect(response.status).toBe(400);
  });
});
