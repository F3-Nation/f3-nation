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

  // A refused connection / DNS failure rejects `fetch` with a TypeError rather
  // than resolving a non-2xx Response. Untranslated, oRPC masks it as an opaque
  // 500 — the same masking the non-2xx cases above exist to prevent.
  it("throws ORPCError BAD_GATEWAY when the GET ping fetch rejects", async () => {
    const cause = new TypeError("fetch failed");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(cause);

    let thrown: unknown;
    try {
      await notifyWebhooks({ action: "map.deleted" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ORPCError);
    expect(thrown).toMatchObject({
      code: "BAD_GATEWAY",
      message: "Webhook GET failed: request could not be completed",
    });
    // The original rejection stays reachable for the caller's logError, but the
    // client-facing message never interpolates it — it can name internal hosts.
    expect((thrown as ORPCError<never, never>).cause).toBe(cause);
  });

  it("throws ORPCError BAD_GATEWAY when a POST webhook fetch rejects", async () => {
    const cause = new TypeError("fetch failed");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 200 })) // GET ping succeeds
      .mockRejectedValueOnce(cause);

    let thrown: unknown;
    try {
      await notifyWebhooks({ action: "map.updated", orgId: 1 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ORPCError);
    expect(thrown).toMatchObject({
      code: "BAD_GATEWAY",
      message: "Webhook POST failed: request could not be completed",
    });
    expect((thrown as ORPCError<never, never>).cause).toBe(cause);
  });
});
