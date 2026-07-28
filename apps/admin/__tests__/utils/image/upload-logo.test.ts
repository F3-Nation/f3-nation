import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadLogo } from "~/utils/image/upload-logo";

const makeFile = () => new Blob(["image-bytes"], { type: "image/png" });

describe("uploadLogo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the file and org id and returns the uploaded url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: "https://cdn.example/logo.png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const url = await uploadLogo({ file: makeFile(), orgId: 7 });

    expect(url).toBe("https://cdn.example/logo.png");
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("/api/upload-logo");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("orgId")).toBe("7");
    expect(body.get("size")).toBeNull();
  });

  it("includes the size field when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: "https://cdn.example/logo.png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await uploadLogo({ file: makeFile(), orgId: 7, size: 256 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get("size")).toBe("256");
  });

  it("throws the server-provided error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "File too large" }),
      }),
    );

    await expect(uploadLogo({ file: makeFile(), orgId: 7 })).rejects.toThrow(
      "File too large",
    );
  });

  it("falls back to a generic error when the failure body is not json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error("not json")),
      }),
    );

    await expect(uploadLogo({ file: makeFile(), orgId: 7 })).rejects.toThrow(
      "Failed to upload logo",
    );
  });
});
