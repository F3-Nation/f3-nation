import { afterEach, describe, expect, it, vi } from "vitest";

const { authMock, checkHasRoleOnOrgMock, uploadOrgLogoMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    checkHasRoleOnOrgMock: vi.fn(),
    uploadOrgLogoMock: vi.fn(),
  }),
);

vi.mock("@acme/auth", () => ({
  auth: authMock,
}));

vi.mock("@acme/api", () => ({
  checkHasRoleOnOrg: checkHasRoleOnOrgMock,
}));

vi.mock("@acme/db/client", () => ({
  db: {},
}));

vi.mock("~/lib/storage", () => ({
  storage: { uploadOrgLogo: uploadOrgLogoMock },
}));

vi.mock("~/lib/logging", () => ({
  logError: vi.fn(),
}));

import { POST } from "~/app/api/upload-logo/route";

function buildRequest(fields: Record<string, string | Blob>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  // Stub formData() directly: constructing a real multipart Request body and
  // re-parsing it via undici hangs under jsdom, and the route only ever calls
  // request.formData().
  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

const validFields = () => ({
  file: new File(["abc"], "logo.png", { type: "image/png" }),
  orgId: "42",
  requestId: "req-1",
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/upload-logo", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(buildRequest(validFields()));

    expect(res.status).toBe(401);
    expect(checkHasRoleOnOrgMock).not.toHaveBeenCalled();
    expect(uploadOrgLogoMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller has no role on the org", async () => {
    authMock.mockResolvedValue({ id: "u1", roles: [] });
    checkHasRoleOnOrgMock.mockResolvedValue({ success: false });

    const res = await POST(buildRequest(validFields()));

    expect(res.status).toBe(403);
    expect(checkHasRoleOnOrgMock).toHaveBeenCalledWith({
      session: { id: "u1", roles: [] },
      orgId: 42,
      db: {},
    });
    expect(uploadOrgLogoMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid orgId before checking authorization", async () => {
    authMock.mockResolvedValue({ id: "u1", roles: [] });

    const res = await POST(
      buildRequest({ ...validFields(), orgId: "not-a-number" }),
    );

    expect(res.status).toBe(400);
    expect(checkHasRoleOnOrgMock).not.toHaveBeenCalled();
  });

  it("uploads and returns the url when authorized", async () => {
    authMock.mockResolvedValue({ id: "u1", roles: [] });
    checkHasRoleOnOrgMock.mockResolvedValue({ success: true });
    uploadOrgLogoMock.mockResolvedValue("https://example.com/org-logos/42.jpg");

    const res = await POST(buildRequest(validFields()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://example.com/org-logos/42.jpg",
    });
    expect(uploadOrgLogoMock).toHaveBeenCalledWith(
      42,
      expect.any(Buffer),
      expect.objectContaining({ requestId: "req-1" }),
    );
  });
});
