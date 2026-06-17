import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// emulatorFetch — Authorization header injection
// ---------------------------------------------------------------------------

describe("emulatorFetch", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("injects Authorization: Bearer local-dev-token on every request", async () => {
    const capturedInits: RequestInit[] = [];
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInits.push(init ?? {});
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const { emulatorFetch } = await import("./emulator");
    await emulatorFetch("http://localhost:4443/test");

    expect(capturedInits).toHaveLength(1);
    const headers = new Headers(capturedInits[0]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer local-dev-token");
  });

  it("preserves caller-supplied headers alongside Authorization", async () => {
    const capturedInits: RequestInit[] = [];
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInits.push(init ?? {});
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const { emulatorFetch } = await import("./emulator");
    await emulatorFetch("http://localhost:4443/test", {
      headers: { "Content-Type": "image/jpeg" },
    });

    const headers = new Headers(capturedInits[0]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer local-dev-token");
    expect(headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("throws with URL context when fetch rejects", async () => {
    globalThis.fetch = vi.fn(() => {
      throw new TypeError("fetch failed");
    });

    const { emulatorFetch } = await import("./emulator");
    await expect(
      emulatorFetch("http://localhost:4443/unreachable"),
    ).rejects.toThrow(
      "GCS emulator unreachable at http://localhost:4443/unreachable",
    );
  });
});

// ---------------------------------------------------------------------------
// uploadFile — emulator URL format and path encoding
// ---------------------------------------------------------------------------

describe("uploadFile (emulator mode)", () => {
  const EMULATOR_HOST = "localhost:4443";
  const BUCKET = "test-bucket";

  beforeEach(() => {
    vi.resetModules();
    process.env.GCS_EMULATOR_HOST = EMULATOR_HOST;
    process.env.GCS_BUCKET = BUCKET;
  });

  afterEach(() => {
    delete process.env.GCS_EMULATOR_HOST;
    delete process.env.GCS_BUCKET;
    vi.restoreAllMocks();
  });

  it("returns a URL with a literal-slash path (not percent-encoded)", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );

    const { uploadFile } = await import("./upload");
    const url = await uploadFile(
      "user-avatars/42.jpg",
      Buffer.from("data"),
      "image/jpeg",
    );

    expect(url).toBe(`http://${EMULATOR_HOST}/${BUCKET}/user-avatars/42.jpg`);
  });

  it("uses percent-encoded path in the upload request URL, not the returned URL", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      requestedUrls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const { uploadFile } = await import("./upload");
    await uploadFile("org logos/1.jpg", Buffer.from("data"), "image/jpeg");

    // The GCS JSON API upload endpoint receives the encoded name query param
    expect(requestedUrls[0]).toContain("name=org%20logos%2F1.jpg");
  });

  it("throws when the emulator returns a non-2xx status", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("bucket not found", { status: 404 })),
    );

    const { uploadFile } = await import("./upload");
    await expect(
      uploadFile("a/b.jpg", Buffer.from("data"), "image/jpeg"),
    ).rejects.toThrow("GCS emulator upload failed: HTTP 404 bucket not found");
  });
});

// ---------------------------------------------------------------------------
// deleteFile — 404 no-op invariant
// ---------------------------------------------------------------------------

describe("deleteFile (emulator mode)", () => {
  const EMULATOR_HOST = "localhost:4443";
  const BUCKET = "test-bucket";

  beforeEach(() => {
    vi.resetModules();
    process.env.GCS_EMULATOR_HOST = EMULATOR_HOST;
    process.env.GCS_BUCKET = BUCKET;
  });

  afterEach(() => {
    delete process.env.GCS_EMULATOR_HOST;
    delete process.env.GCS_BUCKET;
    vi.restoreAllMocks();
  });

  it("does not throw when the emulator returns 404 (file already gone)", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );

    const { deleteFile } = await import("./delete");
    await expect(deleteFile("user-avatars/42.jpg")).resolves.toBeUndefined();
  });

  it("throws with response body when emulator returns a non-404 error", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("internal error", { status: 500 })),
    );

    const { deleteFile } = await import("./delete");
    await expect(deleteFile("user-avatars/42.jpg")).rejects.toThrow(
      "GCS emulator delete failed: HTTP 500 internal error",
    );
  });

  it("resolves without error on 200", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );

    const { deleteFile } = await import("./delete");
    await expect(deleteFile("user-avatars/42.jpg")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getStorage — throw paths for missing / invalid credentials
// ---------------------------------------------------------------------------

describe("getStorage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GCS_CREDENTIALS;
    vi.resetModules();
  });

  it("throws when GCS_CREDENTIALS is not set", async () => {
    delete process.env.GCS_CREDENTIALS;
    const { getStorage } = await import("./client");
    expect(() => getStorage()).toThrow("GCS_CREDENTIALS is not set");
  });

  it("throws when GCS_CREDENTIALS is not valid base64-encoded JSON", async () => {
    process.env.GCS_CREDENTIALS = Buffer.from("not json").toString("base64");
    const { getStorage } = await import("./client");
    expect(() => getStorage()).toThrow("Invalid GCS_CREDENTIALS payload");
  });

  it("throws when GCS_CREDENTIALS JSON is missing required fields", async () => {
    const incomplete = { client_email: "svc@proj.iam.gserviceaccount.com" };
    process.env.GCS_CREDENTIALS = Buffer.from(
      JSON.stringify(incomplete),
    ).toString("base64");
    const { getStorage } = await import("./client");
    expect(() => getStorage()).toThrow(
      "GCS_CREDENTIALS is missing required service account fields",
    );
  });

  it("returns a Storage instance for valid credentials", async () => {
    const valid = {
      client_email: "svc@proj.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
    };
    process.env.GCS_CREDENTIALS = Buffer.from(JSON.stringify(valid)).toString(
      "base64",
    );
    const { getStorage } = await import("./client");
    expect(() => getStorage()).not.toThrow();
  });
});
