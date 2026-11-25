import { describe, expect, it, vi } from "vitest";

const createPublicImageStorage = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("server-only", () => ({}));
vi.mock("@acme/storage", () => ({
  createPublicImageStorage,
  deriveStorageChannel: (channel: string) =>
    channel === "prod" ? "prod" : "staging",
}));
vi.mock("~/env", () => ({ env: { F3_CHANNEL: "prod" } }));

describe("lib/storage", () => {
  it("uses the service identity and the channel's bucket", async () => {
    await import("./storage");

    expect(createPublicImageStorage).toHaveBeenCalledWith({
      channel: "prod",
      auth: { kind: "identity" },
    });
  });
});
