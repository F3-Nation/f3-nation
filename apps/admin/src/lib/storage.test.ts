import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Storage from "@acme/storage";

const createPublicImageStorage = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("server-only", () => ({}));

async function loadStorageWithChannel(channel: string) {
  vi.resetModules();
  vi.doMock("@acme/storage", async (importOriginal) => ({
    ...(await importOriginal<typeof Storage>()),
    createPublicImageStorage,
  }));
  vi.doMock("~/env", () => ({ env: { F3_CHANNEL: channel } }));
  await import("./storage");
}

describe("lib/storage", () => {
  beforeEach(() => {
    createPublicImageStorage.mockClear();
  });

  it("uses the service identity and the prod bucket when F3_CHANNEL is prod", async () => {
    await loadStorageWithChannel("prod");

    expect(createPublicImageStorage).toHaveBeenCalledWith({
      channel: "prod",
      auth: { kind: "identity" },
    });
  });

  it("uses the staging bucket for every other F3_CHANNEL", async () => {
    await loadStorageWithChannel("staging");

    expect(createPublicImageStorage).toHaveBeenCalledWith({
      channel: "staging",
      auth: { kind: "identity" },
    });
  });
});
