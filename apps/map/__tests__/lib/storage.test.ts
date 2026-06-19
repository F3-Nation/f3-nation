import { describe, expect, it, vi } from "vitest";

describe("map storage bootstrap", () => {
  it("uses prod storage channel when F3_CHANNEL is prod", async () => {
    vi.resetModules();

    const createPublicImageStorage = vi.fn(() => ({
      isAllowedPublicImageUrl: () => true,
    }));

    vi.doMock("@acme/storage", () => ({
      createPublicImageStorage,
    }));

    vi.doMock("~/env", () => ({
      env: {
        F3_CHANNEL: "prod",
        GCS_CREDENTIALS: "cred-prod",
      },
    }));

    await import("~/lib/storage");

    expect(createPublicImageStorage).toHaveBeenCalledWith({
      channel: "prod",
      credentials: "cred-prod",
    });
  });

  it("falls back to staging for non-prod channels", async () => {
    vi.resetModules();

    const createPublicImageStorage = vi.fn(() => ({
      isAllowedPublicImageUrl: () => true,
    }));

    vi.doMock("@acme/storage", () => ({
      createPublicImageStorage,
    }));

    vi.doMock("~/env", () => ({
      env: {
        F3_CHANNEL: "preview",
        GCS_CREDENTIALS: "cred-staging",
      },
    }));

    await import("~/lib/storage");

    expect(createPublicImageStorage).toHaveBeenCalledWith({
      channel: "staging",
      credentials: "cred-staging",
    });
  });
});
