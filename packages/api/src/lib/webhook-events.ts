import { revalidatePath } from "next/cache";

import type { WebhookPayload } from "./notify-webhooks";
import { notifyWebhooks } from "./notify-webhooks";
import { triggerMapAppRevalidation } from "./revalidate-map";

/**
 * Discriminated union for type-safe webhook event payloads.
 * Each event type has a specific payload structure ensuring type safety.
 *
 * Simple events: Single entity changes (event, location, or org)
 * Compound events: Multiple entities changed together (e.g., request workflow creates event + location + org)
 */
export type WebhookEvent =
  // Simple events - single entity
  | { type: "event.created"; eventId: number }
  | { type: "event.updated"; eventId: number }
  | { type: "event.deleted"; eventId: number }
  | { type: "location.created"; locationId: number }
  | { type: "location.updated"; locationId: number }
  | { type: "location.deleted"; locationId: number }
  | { type: "org.created"; orgId: number }
  | { type: "org.updated"; orgId: number }
  | { type: "org.deleted"; orgId: number }
  // Compound events - multiple entities (for request workflow)
  | {
      type: "map.created";
      eventId?: number;
      locationId?: number;
      orgId?: number;
    }
  | {
      type: "map.updated";
      eventId?: number;
      locationId?: number;
      orgId?: number;
    }
  | {
      type: "map.deleted";
      eventId?: number;
      locationId?: number;
      orgId?: number;
    };

/**
 * Maps webhook event types to the action field used in the webhook payload.
 */
const eventTypeToAction: Record<
  WebhookEvent["type"],
  WebhookPayload["action"]
> = {
  "event.created": "map.created",
  "event.updated": "map.updated",
  "event.deleted": "map.deleted",
  "location.created": "map.created",
  "location.updated": "map.updated",
  "location.deleted": "map.deleted",
  "org.created": "map.created",
  "org.updated": "map.updated",
  "org.deleted": "map.deleted",
  "map.created": "map.created",
  "map.updated": "map.updated",
  "map.deleted": "map.deleted",
};

/**
 * Builds the webhook payload from a typed webhook event.
 */
const buildPayload = (event: WebhookEvent): WebhookPayload => {
  const action = eventTypeToAction[event.type];

  switch (event.type) {
    case "event.created":
    case "event.updated":
    case "event.deleted":
      return { eventId: event.eventId, action };
    case "location.created":
    case "location.updated":
    case "location.deleted":
      return { locationId: event.locationId, action };
    case "org.created":
    case "org.updated":
    case "org.deleted":
      return { orgId: event.orgId, action };
    case "map.created":
    case "map.updated":
    case "map.deleted":
      return {
        eventId: event.eventId,
        locationId: event.locationId,
        orgId: event.orgId,
        action,
      };
  }
};

/**
 * Notifies external systems and invalidates cache when map data changes.
 *
 * This function handles both:
 * 1. Emitting webhook events to external systems
 * 2. Revalidating the Next.js static page cache
 *
 * This function is fire-and-forget - it does not block the response to the client.
 * Errors are logged but do not propagate to the caller.
 *
 * @param event - The typed webhook event to emit
 *
 * @example
 * // After creating an event
 * void notifyMapDataChange({ type: "event.created", eventId: result.id });
 *
 * @example
 * // After updating a location
 * void notifyMapDataChange({ type: "location.updated", locationId: result.id });
 */
export const notifyMapDataChange = (event: WebhookEvent): void => {
  const payload = buildPayload(event);
  console.log("notifyMapDataChange", JSON.stringify({ event, payload }));

  // Revalidate the statically generated map page so Next.js serves fresh data
  // on the next request. Only works in Next.js request context (not in tests).
  try {
    revalidatePath("/");
  } catch (error: unknown) {
    // revalidatePath requires Next.js static generation context, which isn't
    // available in test environments. Silently skip revalidation in tests.
    if (
      error instanceof Error &&
      error.message.includes("static generation store missing")
    ) {
      // Expected in test environment, no need to log
    } else {
      // Unexpected error, log it but don't throw
      console.error(
        "notifyMapDataChange revalidation failed",
        JSON.stringify({
          event,
          error,
        }),
      );
    }
  }

  // Fire and forget - don't await to not block response
  notifyWebhooks(payload).catch((error: unknown) => {
    console.error(
      "notifyMapDataChange failed",
      JSON.stringify({ event, error }),
    );
  });

  // Trigger Map app revalidation via HTTP - API and Map are separate Next.js instances,
  // so revalidatePath above only affects the API. The Map app must be notified explicitly.
  void triggerMapAppRevalidation({ event });
};
