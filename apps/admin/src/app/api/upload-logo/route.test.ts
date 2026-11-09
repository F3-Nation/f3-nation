// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionLookup } from "~/lib/auth/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSessionLookup: vi.fn<() => Promise<SessionLookup>>(),
  getOrgParentId: vi.fn<(orgId: number) => Promise<number | null>>(),
  uploadOrgLogo: vi.fn(),
}));

vi.mock("~/lib/auth/server", () => ({
  requireAccessToken: vi.fn(() => Promise.resolve("token")),
  getSessionLookup: mocks.getSessionLookup,
}));
vi.mock("~/lib/api/client", () => ({ getOrgParentId: mocks.getOrgParentId }));
vi.mock("~/lib/storage", () => ({
  storage: { uploadOrgLogo: mocks.uploadOrgLogo },
}));

// Region 30 sits under area 20; region 31 is its sibling.
const parents: Record<number, number | null> = { 30: 20, 31: 20, 20: null };

function sessionWith(
  roles: { orgId: number; roleName: "user" | "editor" | "admin" }[],
): SessionLookup {
  return {
    apiUnavailable: false,
    session: {
      sub: "7",
      id: 7,
      email: "editor@example.com",
      roles: roles.map((role) => ({ ...role, orgName: `Org ${role.orgId}` })),
    },
  };
}

function uploadRequest(orgId: number) {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" }),
  );
  form.set("orgId", String(orgId));
  return new NextRequest("http://localhost/api/upload-logo", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/upload-logo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrgParentId.mockImplementation((orgId) =>
      Promise.resolve(parents[orgId] ?? null),
    );
    mocks.uploadOrgLogo.mockResolvedValue(
      "https://storage.example/org-logos/30.jpg",
    );
  });

  it("uploads for an editor of an ancestor org", async () => {
    mocks.getSessionLookup.mockResolvedValue(
      sessionWith([{ orgId: 20, roleName: "editor" }]),
    );

    const response = await POST(uploadRequest(30));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://storage.example/org-logos/30.jpg",
    });
    expect(mocks.uploadOrgLogo).toHaveBeenCalledWith(30, expect.any(Buffer), {
      size: undefined,
    });
  });

  it("refuses an editor of another region and leaves the logo alone", async () => {
    mocks.getSessionLookup.mockResolvedValue(
      sessionWith([{ orgId: 31, roleName: "editor" }]),
    );

    const response = await POST(uploadRequest(30));

    expect(response.status).toBe(403);
    expect(mocks.uploadOrgLogo).not.toHaveBeenCalled();
  });

  it("refuses a user with only a member role on the org", async () => {
    mocks.getSessionLookup.mockResolvedValue(
      sessionWith([{ orgId: 30, roleName: "user" }]),
    );

    const response = await POST(uploadRequest(30));

    expect(response.status).toBe(403);
    expect(mocks.uploadOrgLogo).not.toHaveBeenCalled();
  });

  it("refuses when the session cannot be resolved", async () => {
    mocks.getSessionLookup.mockResolvedValue({
      session: null,
      apiUnavailable: false,
    });

    const response = await POST(uploadRequest(30));

    expect(response.status).toBe(403);
    expect(mocks.uploadOrgLogo).not.toHaveBeenCalled();
  });

  it("returns 503 without uploading when roles cannot be loaded", async () => {
    mocks.getSessionLookup.mockResolvedValue({
      ...sessionWith([]),
      apiUnavailable: true,
    });

    const response = await POST(uploadRequest(30));

    expect(response.status).toBe(503);
    expect(mocks.uploadOrgLogo).not.toHaveBeenCalled();
  });

  it("returns 503 without uploading when the org lookup hits an outage", async () => {
    mocks.getSessionLookup.mockResolvedValue(
      sessionWith([{ orgId: 20, roleName: "editor" }]),
    );
    mocks.getOrgParentId.mockRejectedValue(new TypeError("fetch failed"));

    const response = await POST(uploadRequest(30));

    expect(response.status).toBe(503);
    expect(mocks.uploadOrgLogo).not.toHaveBeenCalled();
  });
});
