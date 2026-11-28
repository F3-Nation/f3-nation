import { describe, expect, it, vi } from "vitest";

describe("lib/storage", () => {
  it("uses the service identity and the prod channel when F3_CHANNEL is prod", async () => {
    vi.resetModules();

    const createPublicImageStorage = vi.fn(() => ({
      isAllowedPublicImageUrl: () => true,
    }));

    vi.doMock("@acme/storage", () => ({
      createPublicImageStorage,
      deriveStorageChannel: (channel: string) =>
        channel === "prod" ? "prod" : "staging",
    }));

    vi.doMock("@/env", () => ({
      env: {
        F3_CHANNEL: "prod",
      },
    }));

    await import("@/lib/storage");

    expect(createPublicImageStorage).toHaveBeenCalledWith({
      channel: "prod",
      auth: { kind: "identity" },
    });
  });

  it("falls back to staging channel for non-prod F3_CHANNEL values", async () => {
    vi.resetModules();

    const createPublicImageStorage = vi.fn(() => ({
      isAllowedPublicImageUrl: () => true,
    }));

    vi.doMock("@acme/storage", () => ({
      createPublicImageStorage,
      deriveStorageChannel: (channel: string) =>
        channel === "prod" ? "prod" : "staging",
    }));

    vi.doMock("@/env", () => ({
      env: {
        F3_CHANNEL: "dev",
      },
    }));

    await import("@/lib/storage");

    expect(createPublicImageStorage).toHaveBeenCalledWith({
      channel: "staging",
      auth: { kind: "identity" },
    });
  });
});
