/**
 * Tests for getPublicImageStorage error handling.
 *
 * Verifies a misconfigured environment (missing GCS_CREDENTIALS) surfaces as
 * an ORPCError("INTERNAL_SERVER_ERROR", ...) rather than a raw Error, since
 * oRPC would otherwise mask the latter as an opaque 500 and drop the message.
 */

import { ORPCError } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("getPublicImageStorage", () => {
  const originalCredentials = process.env.GCS_CREDENTIALS;

  afterEach(() => {
    if (originalCredentials === undefined) {
      delete process.env.GCS_CREDENTIALS;
    } else {
      process.env.GCS_CREDENTIALS = originalCredentials;
    }
    vi.resetModules();
  });

  it("throws ORPCError INTERNAL_SERVER_ERROR when GCS_CREDENTIALS is not set", async () => {
    // Some environments (e.g. CI) set a placeholder GCS_CREDENTIALS for other
    // tests, so this must explicitly unset it and re-import for a fresh
    // module instance rather than relying on the ambient env.
    delete process.env.GCS_CREDENTIALS;
    vi.resetModules();
    const { getPublicImageStorage } = await import("./storage");

    let thrown: unknown;
    try {
      getPublicImageStorage();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ORPCError);
    expect(thrown).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "GCS_CREDENTIALS is not set",
    });
  });
});
