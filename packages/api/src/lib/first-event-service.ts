/**
 * First Event Service
 *
 * Detects when the first recurring event is created for a region and triggers
 * the "region in a box" notification flow (GitHub issue #273).
 *
 * Deduplication strategy: a `firstEventNotificationSent` flag is stored on the
 * region's `meta` JSON column. Once set it is never cleared, so the notification
 * fires at most once per region even if events are later deleted and re-created.
 */

import { aliasedTable, and, count, eq, schema } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { env } from "@acme/env";
import { mail, Templates } from "@acme/mail";

import { getUsersWithRoles } from "../services/map-request-notification";

/**
 * Check whether the event just inserted is the first recurring event for its
 * region. If it is, mark the region as notified and send the first-event
 * notification email.
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

  // Step 4: count ALL events (including soft-deleted) across every AO under
  // this region. Including soft-deleted rows prevents re-triggering when a
  // user deletes an event and re-creates one.
  const aoOrg = aliasedTable(schema.orgs, "ao_org_fes");
  const [countRow] = await db
    .select({ total: count() })
    .from(schema.events)
    .innerJoin(
      aoOrg,
      and(eq(aoOrg.id, schema.events.orgId), eq(aoOrg.parentId, regionId)),
    );

  const totalEvents = countRow?.total ?? 0;

  if (totalEvents !== 1) {
    // More than one event exists — this is not the first, nothing to do.
    return;
  }

  // Step 5: build the recipient list — region contact email + all region admins.
  const toSet = new Set<string>();
  if (region.email) toSet.add(region.email);

  const adminUsers = await getUsersWithRoles({
    db,
    orgId: regionId,
    roleNames: ["admin"],
  });
  for (const u of adminUsers) {
    if (u.email) toSet.add(u.email);
  }

  if (toSet.size === 0) {
    console.warn(
      `[first-event-service] Region "${region.name}" (id: ${regionId}) has no contact email and no admins — skipping "region in a box" email.`,
    );
    return;
  }

  // Step 6: send the "region in a box" welcome email.
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

  // Step 7: mark the region as notified — only after successful delivery.
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
