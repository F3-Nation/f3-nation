/**
 * Sends the region-in-a-box welcome packet once a region has eligible
 * recipients. The existing region marker is claimed atomically before sending;
 * failed sends release it for a later trigger to retry. A process crash after
 * claiming but before sending can leave the marker set, so this does not provide
 * exactly-once delivery.
 */

import { and, eq, exists, isNotNull, sql, schema } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { env } from "@acme/env";
import { mail, Templates } from "@acme/mail";
import { ORPCError } from "@orpc/server";

import { logError, logDebug, logWarn } from "../logger";
import { getUsersWithRoles } from "../services/map-request-notification";

async function maybeNotifyRegion(
  db: AppDb,
  regionId: number,
  requireActiveSeriesEvent: boolean,
): Promise<void> {
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
    logDebug("api.first_event.parent_org_not_found", { regionId });
    return;
  }
  if (region.orgType !== "region") {
    logDebug("api.first_event.parent_not_region", { regionId });
    return;
  }

  if (requireActiveSeriesEvent) {
    const qualifyingEvent = db
      .select({ id: schema.events.id })
      .from(schema.events)
      .innerJoin(schema.orgs, eq(schema.events.orgId, schema.orgs.id))
      .where(
        and(
          eq(schema.orgs.orgType, "ao"),
          eq(schema.orgs.parentId, regionId),
          eq(schema.events.isActive, true),
          isNotNull(schema.events.dayOfWeek),
        ),
      );
    const [eligible] = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(and(eq(schema.orgs.id, regionId), exists(qualifyingEvent)))
      .limit(1);
    if (!eligible) {
      logDebug("api.first_event.no_eligible_event", { regionId });
      return;
    }
  }

  const meta = (region.meta ?? {}) as Record<string, unknown>;
  if (meta.firstEventNotificationSent === true) {
    logDebug("api.first_event.already_notified", {
      regionId,
      regionName: region.name,
    });
    return;
  }

  // Resolve recipients before claiming so an empty region remains retryable.
  const recipients = new Set<string>();
  if (region.email) recipients.add(region.email);
  const adminUsers = await getUsersWithRoles({
    db,
    orgId: regionId,
    roleNames: ["admin", "editor"],
  });
  for (const user of adminUsers) {
    if (user.email) recipients.add(user.email);
  }
  if (recipients.size === 0) {
    logWarn("api.first_event.no_recipients", {
      regionId,
      regionName: region.name,
    });
    return;
  }

  // This conditional JSONB update both preserves unrelated metadata and makes
  // the region-level claim atomic across concurrent API instances.
  const [claim] = await db
    .update(schema.orgs)
    .set({
      meta: sql`jsonb_set(
        CASE WHEN jsonb_typeof(${schema.orgs.meta}) = 'object'
          THEN ${schema.orgs.meta} ELSE '{}'::jsonb END,
        '{firstEventNotificationSent}', 'true'::jsonb, true
      )`,
    })
    .where(
      and(
        eq(schema.orgs.id, regionId),
        sql`${schema.orgs.meta}->'firstEventNotificationSent' IS DISTINCT FROM 'true'::jsonb`,
      ),
    )
    .returning({ id: schema.orgs.id });
  if (!claim) {
    logDebug("api.first_event.already_notified", { regionId });
    return;
  }

  const ccList = (env.EMAIL_REGION_IN_A_BOX_CC ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  try {
    await mail.sendTemplateMessages(Templates.regionInABox, {
      to: [...recipients],
      ...(ccList.length > 0 && { cc: ccList }),
      regionName: region.name,
    });
  } catch (error) {
    logError("api.first_event.email_failed", { regionId }, error);
    // Delete only our marker, using the current JSONB value to retain other
    // metadata updates made while delivery was in flight.
    try {
      await db
        .update(schema.orgs)
        .set({
          meta: sql`(CASE WHEN jsonb_typeof(${schema.orgs.meta}) = 'object'
            THEN ${schema.orgs.meta} ELSE '{}'::jsonb END) - 'firstEventNotificationSent'`,
        })
        .where(
          and(
            eq(schema.orgs.id, regionId),
            sql`${schema.orgs.meta}->'firstEventNotificationSent' = 'true'::jsonb`,
          ),
        );
    } catch (releaseError) {
      logError(
        "api.first_event.claim_release_failed",
        { regionId },
        releaseError,
      );
    }
    if (error instanceof ORPCError) throw error;
    throw new ORPCError("BAD_GATEWAY", {
      message: "Region notification could not be sent",
    });
  }

  logDebug("api.first_event.email_sent", { regionId, regionName: region.name });
}

/** New AO/event change triggers require an active recurring event in the region. */
export async function maybeNotifyRegionInABox(
  db: AppDb,
  regionId: number,
): Promise<void> {
  await maybeNotifyRegion(db, regionId, true);
}

/**
 * Legacy event.crupdate creation behavior. Deliberately does not enforce the
 * active-series eligibility check introduced for newly added triggers.
 */
export async function maybeNotifyFirstEventForRegion(
  db: AppDb,
  aoId: number,
  capturedRegionId?: number,
): Promise<void> {
  if (capturedRegionId != null) {
    await maybeNotifyRegion(db, capturedRegionId, false);
    return;
  }
  const [ao] = await db
    .select({ parentId: schema.orgs.parentId })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, aoId))
    .limit(1);
  if (!ao?.parentId) {
    logDebug("api.first_event.no_parent_org", { aoId });
    return;
  }
  await maybeNotifyRegion(db, ao.parentId, false);
}
