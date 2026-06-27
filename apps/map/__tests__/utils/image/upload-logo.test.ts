import { describe, expect, it, vi, afterEach } from "vitest";

import { uploadLogo } from "~/utils/image/upload-logo";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uploadLogo", () => {
  it("returns url on successful upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ url: "https://example.com/logo.jpg" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      ),
    );

    const result = await uploadLogo({
      file: new Blob(["abc"], { type: "image/png" }),
      orgId: 42,
      requestId: "req-1",
    });

    expect(result).toBe("https://example.com/logo.jpg");
  });

  it("sends requestId in the form body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ url: "https://example.com/logo.jpg" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadLogo({
      file: new Blob(["abc"], { type: "image/png" }),
      orgId: 42,
      requestId: "req-1",
    });

    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    const body = init.body as FormData;
    expect(body.get("requestId")).toBe("req-1");
  });

  it("throws API-provided error message on failed upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Upload denied" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );

    await expect(
      uploadLogo({
        file: new Blob(["abc"], { type: "image/png" }),
        orgId: 42,
        requestId: "req-1",
      }),
    ).rejects.toThrow("Upload denied");
  });

  it("throws fallback error when failed upload body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("not json", {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          }),
        ),
      ),
    );

    await expect(
      uploadLogo({
        file: new Blob(["abc"], { type: "image/png" }),
        orgId: 42,
        requestId: "req-1",
      }),
    ).rejects.toThrow("Failed to upload logo");
  });
});
