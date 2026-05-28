/**
 * First Event Service
 *
 * Fires the "region in a box" notification email the first time a recurring
 * event is created for a region that has not yet been notified
 * (GitHub issue #273).
 *
 * Deduplication strategy: a `firstEventNotificationSent` flag is stored on the
 * region's `meta` JSON column. Once set it is never cleared, so the
 * notification fires at most once per region.
 *
 * Deferral strategy: if the region has no contact email and no admin users at
 * the time an event is created, the flag is intentionally left unset. This
 * allows the notification to fire on a subsequent event creation once admins
 * have been assigned — which is a common setup ordering in practice.
 *
 * IMPORTANT: before deploying, set `firstEventNotificationSent: true` on all
 * existing region org records to avoid retroactive emails being sent.
 */

import { eq, schema } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { env } from "@acme/env";
import { mail, Templates } from "@acme/mail";

import { getUsersWithRoles } from "../services/map-request-notification";

/**
 * Check whether the region that owns this AO has already received the
 * "region in a box" notification. If not, and if the region has at least one
 * recipient (contact email or admin), send the notification and mark the
 * region as notified.
 *
 * If the region has no recipients yet the flag is intentionally left unset,
 * allowing a later event creation to retry once admins have been assigned.
 *
 * @param db   - Database client
 * @param aoId - The AO (Activity Organization) that owns the newly created event
 */
export async function maybeNotifyFirstEventForRegion(
  db: AppDb,
  aoId: number,
): Promise<void> {
  // Step 1: resolve the AO's direct parent (expected to be a region)
  const [ao] = await db
    .select({ id: schema.orgs.id, parentId: schema.orgs.parentId })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, aoId))
    .limit(1);

  if (!ao?.parentId) {
    console.debug(
      `[first-event-service] AO ${aoId} has no parent org; skipping notification`,
    );
    return;
  }

  const regionId = ao.parentId;

  // Step 2: fetch the parent and verify it is a region
  const [region] = await db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      email: schema.orgs.email,
      orgType: schema.orgs.orgType,
      meta: schema.orgs.meta,
    })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, regionId))
    .limit(1);

  if (!region) {
    console.debug(
      `[first-event-service] Parent org ${regionId} not found; skipping notification`,
    );
    return;
  }

  if (region.orgType !== "region") {
    console.debug(
      `[first-event-service] Parent org ${regionId} is type "${region.orgType}", not "region"; skipping notification`,
    );
    return;
  }

  // Step 3: skip if we have already fired for this region
  const meta = (region.meta ?? {}) as Record<string, unknown>;
  if (meta.firstEventNotificationSent === true) {
    console.debug(
      `[first-event-service] Region ${regionId} ("${region.name}") already notified; skipping`,
    );
    return;
  }

  // Step 4: build the recipient list — region contact email + all region admins.
  const toSet = new Set<string>();
  if (region.email) toSet.add(region.email);

  const adminUsers = await getUsersWithRoles({
    db,
    orgId: regionId,
    roleNames: ["admin", "editor"],
  });
  for (const u of adminUsers) {
    if (u.email) toSet.add(u.email);
  }

  if (toSet.size === 0) {
    // No recipients yet — intentionally leave the flag unset so that the next
    // event creation will retry. This handles the common case where admins are
    // assigned after the first event is already created.
    console.warn(
      `[first-event-service] Region "${region.name}" (id: ${regionId}) has no contact email and no admins — deferring "region in a box" email until admins are assigned.`,
    );
    return;
  }

  // Step 5: send the "region in a box" welcome email.
  // NOTE: if two events are created concurrently before the flag is persisted,
  // both could reach this point and send the email. This is a low-probability
  // race condition accepted as a known trade-off.
  const ccList = (env.EMAIL_REGION_IN_A_BOX_CC ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    await mail.sendTemplateMessages(Templates.regionInABox, {
      to: [...toSet],
      ...(ccList.length > 0 && { cc: ccList }),
      regionName: region.name,
    });
  } catch (err) {
    console.error(
      `[first-event-service] Failed to send "region in a box" email for region "${region.name}" (id: ${regionId}):`,
      err,
    );
    throw err;
  }

  // Step 6: mark the region as notified — only after successful delivery.
  const updatedMeta: Record<string, unknown> = {
    ...meta,
    firstEventNotificationSent: true,
  };

  await db
    .update(schema.orgs)
    .set({ meta: updatedMeta })
    .where(eq(schema.orgs.id, regionId));

  console.debug(
    `[first-event-service] "Region in a box" email sent for region "${region.name}" (id: ${regionId}).`,
  );
}
