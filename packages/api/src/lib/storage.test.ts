/**
 * Tests for getPublicImageStorage error handling.
 *
 * Verifies a misconfigured environment (missing GCS_CREDENTIALS) surfaces as
 * an ORPCError("INTERNAL_SERVER_ERROR", ...) rather than a raw Error, since
 * oRPC would otherwise mask the latter as an opaque 500 and drop the message.
 */

import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { getPublicImageStorage } from "./storage";

describe("getPublicImageStorage", () => {
  it("throws ORPCError INTERNAL_SERVER_ERROR when GCS_CREDENTIALS is not set", () => {
    expect(process.env.GCS_CREDENTIALS).toBeUndefined();

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
