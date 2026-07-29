/**
 * Tests for notifyWebhooks error handling.
 *
 * Verifies that a failed outbound webhook call surfaces as an
 * ORPCError("BAD_GATEWAY", ...) rather than a raw Error, since oRPC would
 * otherwise mask the latter as an opaque 500 and drop the message.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// `src/__tests__/setup.ts` mocks this module globally so unrelated suites never
// make real outbound calls. This suite is the one place that needs the real
// implementation, so opt back out — without this every assertion below runs
// against a stub that resolves undefined and can never throw.
vi.unmock("./notify-webhooks");

vi.mock("@acme/env", () => ({
  env: {
    NEXT_PUBLIC_API_URL: "https://api.example.test",
    NEXT_PUBLIC_CHANNEL: "local",
    NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED: "https://hooks.example.test/a",
  },
}));

import { ORPCError } from "@orpc/server";

import { notifyWebhooks } from "./notify-webhooks";

describe("notifyWebhooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves when every configured webhook responds ok", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    await expect(
      notifyWebhooks({ action: "map.created", eventId: 1 }),
    ).resolves.toBeUndefined();
  });

  it("throws ORPCError BAD_GATEWAY when the GET ping webhook fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 500, statusText: "Internal Server Error" }),
    );

    let thrown: unknown;
    try {
      await notifyWebhooks({ action: "map.deleted" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ORPCError);
    expect(thrown).toMatchObject({
      code: "BAD_GATEWAY",
      message: "Webhook GET failed: 500 Internal Server Error",
    });
  });

  it("throws ORPCError BAD_GATEWAY when a POST webhook fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 200 })) // GET ping succeeds
      .mockResolvedValueOnce(
        new Response("", { status: 503, statusText: "Service Unavailable" }),
      );

    let thrown: unknown;
    try {
      await notifyWebhooks({ action: "map.updated", orgId: 1 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ORPCError);
    expect(thrown).toMatchObject({
      code: "BAD_GATEWAY",
      message: "Webhook POST failed: 503 Service Unavailable",
    });
  });
});
