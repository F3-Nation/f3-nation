import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./resize", () => ({
  prepareImageForStorage: vi.fn(() => Promise.resolve(Buffer.from("fakejpeg"))),
}));

import { createPublicImageStorage } from "./public-images";

const EMULATOR_HOST = "localhost:4443";
const FAKE_CREDENTIALS = Buffer.from(
  JSON.stringify({
    client_email: "svc@proj.iam.gserviceaccount.com",
    private_key:
      "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
  }),
).toString("base64");

// ---------------------------------------------------------------------------
// isAllowedPublicImageUrl
// ---------------------------------------------------------------------------

describe("isAllowedPublicImageUrl", () => {
  const storage = createPublicImageStorage({
    channel: "staging",
    credentials: FAKE_CREDENTIALS,
  });

  it("allows prod bucket URLs", () => {
    expect(
      storage.isAllowedPublicImageUrl(
        "https://storage.googleapis.com/f3-public-images/org-logos/1.jpg",
      ),
    ).toBe(true);
  });

  it("allows staging bucket URLs", () => {
    expect(
      storage.isAllowedPublicImageUrl(
        "https://storage.googleapis.com/f3-public-images-staging/user-avatars/2.jpg",
      ),
    ).toBe(true);
  });

  it("rejects other GCS URLs", () => {
    expect(
      storage.isAllowedPublicImageUrl(
        "https://storage.googleapis.com/some-other-bucket/file.jpg",
      ),
    ).toBe(false);
  });

  it("rejects non-GCS URLs", () => {
    expect(
      storage.isAllowedPublicImageUrl("https://example.com/avatar.jpg"),
    ).toBe(false);
  });

  it("rejects URLs that use prod bucket name as a prefix trick", () => {
    expect(
      storage.isAllowedPublicImageUrl(
        "https://storage.googleapis.com/f3-public-images-evil/file.jpg",
      ),
    ).toBe(false);
  });

  describe("with GCS_EMULATOR_HOST set", () => {
    beforeEach(() => {
      process.env.GCS_EMULATOR_HOST = EMULATOR_HOST;
    });

    afterEach(() => {
      delete process.env.GCS_EMULATOR_HOST;
    });

    it("allows emulator staging bucket URLs", () => {
      expect(
        storage.isAllowedPublicImageUrl(
          `http://${EMULATOR_HOST}/f3-public-images-staging/org-logos/1.jpg`,
        ),
      ).toBe(true);
    });

    it("rejects emulator URLs for other buckets", () => {
      expect(
        storage.isAllowedPublicImageUrl(
          `http://${EMULATOR_HOST}/some-other-bucket/file.jpg`,
        ),
      ).toBe(false);
    });

    it("rejects http URLs when the emulator is not active", () => {
      delete process.env.GCS_EMULATOR_HOST;
      expect(
        storage.isAllowedPublicImageUrl(
          `http://${EMULATOR_HOST}/f3-public-images-staging/org-logos/1.jpg`,
        ),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// uploadOrgLogo — emulator mode (prod channel)
// ---------------------------------------------------------------------------

describe("uploadOrgLogo (emulator mode)", () => {
  beforeEach(() => {
    process.env.GCS_EMULATOR_HOST = EMULATOR_HOST;
  });

  afterEach(() => {
    delete process.env.GCS_EMULATOR_HOST;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uploads to prod bucket and returns canonical URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))),
    );

    const storage = createPublicImageStorage({
      channel: "prod",
      credentials: FAKE_CREDENTIALS,
    });
    const url = await storage.uploadOrgLogo(123, Buffer.from("img"));
    expect(url).toBe(
      `http://${EMULATOR_HOST}/f3-public-images/org-logos/123.jpg`,
    );
  });

  it("isolates pending uploads under a requestId path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))),
    );

    const storage = createPublicImageStorage({
      channel: "prod",
      credentials: FAKE_CREDENTIALS,
    });
    const url = await storage.uploadOrgLogo(123, Buffer.from("img"), {
      requestId: "abc-123",
    });
    expect(url).toBe(
      `http://${EMULATOR_HOST}/f3-public-images/org-logos/123-abc-123.jpg`,
    );
  });

  it("rejects a path-unsafe requestId", async () => {
    const storage = createPublicImageStorage({
      channel: "prod",
      credentials: FAKE_CREDENTIALS,
    });
    await expect(
      storage.uploadOrgLogo(1, Buffer.from("img"), { requestId: "../evil" }),
    ).rejects.toThrow("requestId must be alphanumeric");
  });

  it("uploads to staging bucket and returns canonical URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))),
    );

    const storage = createPublicImageStorage({
      channel: "staging",
      credentials: FAKE_CREDENTIALS,
    });
    const url = await storage.uploadOrgLogo(42, Buffer.from("img"));
    expect(url).toBe(
      `http://${EMULATOR_HOST}/f3-public-images-staging/org-logos/42.jpg`,
    );
  });

  it("throws when emulator returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("bucket not found", { status: 404 })),
      ),
    );

    const storage = createPublicImageStorage({
      channel: "staging",
      credentials: FAKE_CREDENTIALS,
    });
    await expect(storage.uploadOrgLogo(1, Buffer.from("img"))).rejects.toThrow(
      "GCS emulator upload failed: HTTP 404 bucket not found",
    );
  });
});

// ---------------------------------------------------------------------------
// uploadOrgLogo — production mode (credentials validation)
// ---------------------------------------------------------------------------

describe("uploadOrgLogo (production mode)", () => {
  afterEach(() => {
    delete process.env.GCS_EMULATOR_HOST;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws when credentials JSON is missing required fields", async () => {
    const badCreds = Buffer.from(JSON.stringify({ client_email: "" })).toString(
      "base64",
    );
    const storage = createPublicImageStorage({
      channel: "staging",
      credentials: badCreds,
    });
    await expect(storage.uploadOrgLogo(1, Buffer.from("img"))).rejects.toThrow(
      "GCS_CREDENTIALS is missing required service account fields",
    );
  });
});

// ---------------------------------------------------------------------------
// uploadUserAvatar — emulator mode
// ---------------------------------------------------------------------------

describe("uploadUserAvatar (emulator mode)", () => {
  beforeEach(() => {
    process.env.GCS_EMULATOR_HOST = EMULATOR_HOST;
  });

  afterEach(() => {
    delete process.env.GCS_EMULATOR_HOST;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uploads to correct path and returns canonical URL", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        requestedUrls.push(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );

    const storage = createPublicImageStorage({
      channel: "staging",
      credentials: FAKE_CREDENTIALS,
    });
    const url = await storage.uploadUserAvatar(7, Buffer.from("img"));

    expect(url).toBe(
      `http://${EMULATOR_HOST}/f3-public-images-staging/user-avatars/7.jpg`,
    );
    expect(requestedUrls[0]).toContain("name=user-avatars%2F7.jpg");
  });
});

// ---------------------------------------------------------------------------
// deleteOrgLogo — emulator mode
// ---------------------------------------------------------------------------

describe("deleteOrgLogo (emulator mode)", () => {
  beforeEach(() => {
    process.env.GCS_EMULATOR_HOST = EMULATOR_HOST;
  });

  afterEach(() => {
    delete process.env.GCS_EMULATOR_HOST;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not throw when emulator returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
    );

    const storage = createPublicImageStorage({
      channel: "staging",
      credentials: FAKE_CREDENTIALS,
    });
    await expect(storage.deleteOrgLogo(5)).resolves.toBeUndefined();
  });

  it("throws when emulator returns non-404 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("internal error", { status: 500 })),
      ),
    );

    const storage = createPublicImageStorage({
      channel: "prod",
      credentials: FAKE_CREDENTIALS,
    });
    await expect(storage.deleteOrgLogo(5)).rejects.toThrow(
      "GCS emulator delete failed: HTTP 500 internal error",
    );
  });
});

// ---------------------------------------------------------------------------
// deleteUserAvatar — emulator mode
// ---------------------------------------------------------------------------

describe("deleteUserAvatar (emulator mode)", () => {
  beforeEach(() => {
    process.env.GCS_EMULATOR_HOST = EMULATOR_HOST;
  });

  afterEach(() => {
    delete process.env.GCS_EMULATOR_HOST;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );

    const storage = createPublicImageStorage({
      channel: "staging",
      credentials: FAKE_CREDENTIALS,
    });
    await expect(storage.deleteUserAvatar(3)).resolves.toBeUndefined();
  });

  it("uses correct path in delete request", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        requestedUrls.push(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        return Promise.resolve(new Response(null, { status: 200 }));
      }),
    );

    const storage = createPublicImageStorage({
      channel: "prod",
      credentials: FAKE_CREDENTIALS,
    });
    await storage.deleteUserAvatar(9);
    expect(requestedUrls[0]).toContain(
      `/f3-public-images/o/user-avatars%2F9.jpg`,
    );
  });
});

// ---------------------------------------------------------------------------
// id / size validation
// ---------------------------------------------------------------------------

describe("id and size validation", () => {
  const storage = createPublicImageStorage({
    channel: "staging",
    credentials: FAKE_CREDENTIALS,
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid orgId %p",
    async (orgId) => {
      await expect(
        storage.uploadOrgLogo(orgId, Buffer.from("img")),
      ).rejects.toThrow("orgId must be a positive integer");
      await expect(storage.deleteOrgLogo(orgId)).rejects.toThrow(
        "orgId must be a positive integer",
      );
    },
  );

  it.each([0, -1, 2.25, Number.NaN])(
    "rejects invalid userId %p",
    async (userId) => {
      await expect(
        storage.uploadUserAvatar(userId, Buffer.from("img")),
      ).rejects.toThrow("userId must be a positive integer");
      await expect(storage.deleteUserAvatar(userId)).rejects.toThrow(
        "userId must be a positive integer",
      );
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid size %p for uploadOrgLogo",
    async (size) => {
      await expect(
        storage.uploadOrgLogo(1, Buffer.from("img"), { size }),
      ).rejects.toThrow("size must be a positive integer");
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid size %p for uploadUserAvatar",
    async (size) => {
      await expect(
        storage.uploadUserAvatar(1, Buffer.from("img"), { size }),
      ).rejects.toThrow("size must be a positive integer");
    },
  );
});

// ---------------------------------------------------------------------------
// promoteOrgLogo — emulator mode
// ---------------------------------------------------------------------------

describe("promoteOrgLogo (emulator mode)", () => {
  beforeEach(() => {
    process.env.GCS_EMULATOR_HOST = EMULATOR_HOST;
  });

  afterEach(() => {
    delete process.env.GCS_EMULATOR_HOST;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("moves pending logo to canonical path and deletes the pending file", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { method?: string }) => {
        calls.push({ url, method: init?.method ?? "GET" });
        return Promise.resolve(
          new Response("img-bytes", {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
        );
      }),
    );

    const storage = createPublicImageStorage({
      channel: "prod",
      credentials: FAKE_CREDENTIALS,
    });
    const result = await storage.promoteOrgLogo(
      `http://${EMULATOR_HOST}/f3-public-images/org-logos/123-abc-123.jpg`,
    );

    expect(result).toBe(
      `http://${EMULATOR_HOST}/f3-public-images/org-logos/123.jpg`,
    );
    // read pending, upload canonical (overwrites previous), delete pending
    expect(calls[0]?.url).toContain(
      "/f3-public-images/org-logos/123-abc-123.jpg",
    );
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toContain("org-logos%2F123.jpg");
    expect(calls[2]?.method).toBe("DELETE");
    expect(calls[2]?.url).toContain("org-logos%2F123-abc-123.jpg");
  });

  it("returns an already-canonical URL unchanged without touching storage", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const storage = createPublicImageStorage({
      channel: "prod",
      credentials: FAKE_CREDENTIALS,
    });
    const canonical = `http://${EMULATOR_HOST}/f3-public-images/org-logos/123.jpg`;
    await expect(storage.promoteOrgLogo(canonical)).resolves.toBe(canonical);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a URL outside the allowed buckets", async () => {
    const storage = createPublicImageStorage({
      channel: "prod",
      credentials: FAKE_CREDENTIALS,
    });
    await expect(
      storage.promoteOrgLogo("https://evil.example.com/org-logos/1-x.jpg"),
    ).rejects.toThrow("not an allowed public image");
  });
});
