/**
 * Tests for recordUpdateRequest error handling.
 *
 * The audit-row write is wrapped in a try/catch that logs and rethrows. A bare
 * `throw error` there is invisible to the ESLint ORPCError rule (an Identifier
 * has no inspectable type), so a raw driver fault would reach oRPC untyped and
 * be masked as an opaque 500 with its cause dropped. These tests pin the
 * guard-then-wrap behavior that lint cannot enforce.
 */

import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import type { Context } from "../shared";
import { db } from "../__tests__/test-utils";
import { recordUpdateRequest } from "./update-request-handlers";

describe("recordUpdateRequest", () => {
  // recordUpdateRequest only ever reads ctx.db.
  const ctx = { db, session: null } as Context;

  const baseRequest = (regionId: number) => ({
    id: crypto.randomUUID(),
    requestType: "delete_event" as const,
    submittedBy: "submitter@example.com",
    regionId,
  });

  it("wraps an unexpected DB fault as ORPCError INTERNAL_SERVER_ERROR", async () => {
    // `update_requests.region_id` carries an FK to `orgs.id`, so a dangling
    // region id makes the insert raise a raw postgres error — an unclassified
    // driver fault, exactly the case the catch must translate.
    let thrown: unknown;
    try {
      await recordUpdateRequest({
        ctx,
        updateRequest: baseRequest(999999999),
        status: "pending",
      });
    } catch (error) {
      thrown = error;
    }

    // Before the guard-then-wrap fix this was a raw postgres DatabaseError.
    expect(thrown).toBeInstanceOf(ORPCError);
    expect(thrown).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to record update request",
    });
  });

  it("does not leak the underlying driver error into the client message", async () => {
    let thrown: unknown;
    try {
      await recordUpdateRequest({
        ctx,
        updateRequest: baseRequest(999999999),
        status: "pending",
      });
    } catch (error) {
      thrown = error;
    }

    // A postgres error names the constraint, table, and columns involved; none
    // of that may reach the caller.
    const message = (thrown as ORPCError<never, never>).message;
    expect(message).not.toMatch(/fkey|constraint|update_requests|region_id/i);
  });

  it("passes a typed ORPCError through instead of re-wrapping it", async () => {
    // A missing regionId is rejected as BAD_REQUEST before the try block, so
    // this also proves the catch cannot downgrade a 4xx raised nearby.
    let thrown: unknown;
    try {
      await recordUpdateRequest({
        ctx,
        updateRequest: {
          id: crypto.randomUUID(),
          requestType: "delete_event",
          submittedBy: "submitter@example.com",
        },
        status: "pending",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ORPCError);
    expect(thrown).toMatchObject({ code: "BAD_REQUEST" });
  });
});
