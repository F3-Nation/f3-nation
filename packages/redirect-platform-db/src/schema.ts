import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Schema for the `f3-redirect-platform` Neon Postgres project.
 *
 * See R5 plan, Decision 7 for the authoritative SQL definitions and
 * Decision 8 for the security model that sits on top of these tables.
 *
 * All `*_user_id` / `org_id` columns are LOGICAL references to the
 * f3-nation monorepo DB — they are not FKs because the data lives in
 * a different Postgres project. The region-validator API (Decision 11)
 * is the bridge and the `bind_time_validator_snapshot` column is the
 * durable record of what the validator returned at bind time.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const verificationState = pgEnum("verification_state", [
  "unverified",
  "verified",
  "revoked",
]);

export const verificationMethod = pgEnum("verification_method", [
  "region_admin_confirmed",
  "super_admin_override",
  "self_service_claim_owned_org",
]);

export const bindingSource = pgEnum("binding_source", [
  "manual_admin",
  "auto_backfill",
  "self_service_claim",
]);

export const hostnameRole = pgEnum("hostname_role", ["apex", "stats"]);

export const lifecycleState = pgEnum("lifecycle_state", [
  "pending",
  "awaiting_dns_challenge",
  "validating",
  "provisioning_cert",
  "awaiting_probe",
  "awaiting_cutover",
  "active",
  "degraded",
  "tombstoned",
  "quarantined",
  "released",
]);

// ---------------------------------------------------------------------------
// reconciler_leases — singleton lease (Decision 6 / 7)
// ---------------------------------------------------------------------------

export const reconcilerLeases = pgTable(
  "reconciler_leases",
  {
    leaseKey: varchar("lease_key").primaryKey().notNull(),
    heldBy: varchar("held_by").notNull(),
    acquiredAt: timestamp("acquired_at", { mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  },
  (table) => [index("idx_leases_expires_at").on(table.expiresAt)],
);

// ---------------------------------------------------------------------------
// org_region_bindings — authoritative org → region mapping (Decision 7)
// ---------------------------------------------------------------------------

export const orgRegionBindings = pgTable("org_region_bindings", {
  orgId: integer("org_id").primaryKey().notNull(),
  paxVaultRegionId: varchar("pax_vault_region_id").notNull().unique(),
  regionSlug: varchar("region_slug").notNull().unique(),
  regionName: varchar("region_name").notNull(),

  verificationState: verificationState("verification_state")
    .notNull()
    .default("unverified"),
  verifiedByUserId: integer("verified_by_user_id"),
  verifiedAt: timestamp("verified_at", { mode: "string" }),
  verificationMethod: verificationMethod("verification_method"),

  bindTimeValidatorSnapshot: jsonb("bind_time_validator_snapshot"),

  source: bindingSource("source").notNull(),
  boundByUserId: integer("bound_by_user_id").notNull(),
  boundAt: timestamp("bound_at", { mode: "string" })
    .notNull()
    .default(sql`timezone('utc', now())`),
  createdAt: timestamp("created_at", { mode: "string" })
    .notNull()
    .default(sql`timezone('utc', now())`),
  updatedAt: timestamp("updated_at", { mode: "string" })
    .notNull()
    .default(sql`timezone('utc', now())`),
});

// ---------------------------------------------------------------------------
// org_domain_quota — per-org domain registration cap (Decision 7 / 8)
// ---------------------------------------------------------------------------

export const orgDomainQuota = pgTable(
  "org_domain_quota",
  {
    orgId: integer("org_id").primaryKey().notNull(),
    maxDomains: integer("max_domains").notNull(),
    raisedByUserId: integer("raised_by_user_id").notNull(),
    raisedReason: text("raised_reason"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .default(sql`timezone('utc', now())`),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .default(sql`timezone('utc', now())`),
  },
  (table) => [
    check(
      "org_domain_quota_max_domains_positive",
      sql`${table.maxDomains} > 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// domain_blocklist — reserved/banned hostnames (Decision 7 / 8)
// ---------------------------------------------------------------------------

export const domainBlocklist = pgTable("domain_blocklist", {
  hostname: varchar("hostname").primaryKey().notNull(),
  reason: varchar("reason").notNull(),
  addedByUserId: integer("added_by_user_id").notNull(),
  addedAt: timestamp("added_at", { mode: "string" })
    .notNull()
    .default(sql`timezone('utc', now())`),
});

// ---------------------------------------------------------------------------
// region_custom_domains — core lifecycle table (Decision 7)
// ---------------------------------------------------------------------------

export const regionCustomDomains = pgTable(
  "region_custom_domains",
  {
    id: uuid("id")
      .primaryKey()
      .notNull()
      .default(sql`gen_random_uuid()`),
    orgId: integer("org_id").notNull(),

    // Denormalized redirect targets (sourced from org_region_bindings at
    // registration time so the runtime cache needs no join).
    regionSlug: varchar("region_slug").notNull(),
    regionId: varchar("region_id").notNull(),
    regionName: varchar("region_name").notNull(),

    hostname: varchar("hostname").notNull(),
    hostnameRole: hostnameRole("hostname_role").notNull(),

    // GCP resource IDs (deterministic, derived from this row's UUID)
    gcpDnsAuthorizationId: varchar("gcp_dns_authorization_id"),
    gcpCertificateId: varchar("gcp_certificate_id"),
    gcpCertMapEntryId: varchar("gcp_cert_map_entry_id"),

    dnsChallengeRecordName: varchar("dns_challenge_record_name"),
    dnsChallengeRecordValue: varchar("dns_challenge_record_value"),

    lifecycleState: lifecycleState("lifecycle_state").notNull(),

    // Probe tracking (Decision 4 multi-vantage SNI probe)
    probeConsecutiveSuccesses: integer("probe_consecutive_successes")
      .notNull()
      .default(0),
    probeLastAttemptedAt: timestamp("probe_last_attempted_at", {
      mode: "string",
    }),
    probeLastResultDetail: jsonb("probe_last_result_detail"),
    probeRegionUsCentral1LastSuccess: timestamp(
      "probe_region_us_central1_last_success",
      { mode: "string" },
    ),
    probeRegionEuropeWest1LastSuccess: timestamp(
      "probe_region_europe_west1_last_success",
      { mode: "string" },
    ),

    lastReconciledAt: timestamp("last_reconciled_at", { mode: "string" }),
    // Structured reconciler error payload — schema in Decision 6:
    // { drift_kind, resource_type, resource_name, observed_spec,
    //   expected_spec, recoverable_from, detected_at, reconciler_run_id }
    reconcilerError: jsonb("reconciler_error"),

    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .default(sql`timezone('utc', now())`),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .default(sql`timezone('utc', now())`),
    tombstonedAt: timestamp("tombstoned_at", { mode: "string" }),
    // R5: renamed from `terminates_at`. Eligibility time for the
    // quarantined → released transition; the drift check in
    // Decision 6 op 7 still gates the actual advance.
    releasedAt: timestamp("released_at", { mode: "string" }),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgRegionBindings.orgId],
      name: "region_custom_domains_org_id_fkey",
    }).onDelete("restrict"),
    uniqueIndex("uniq_locked_hostname")
      .on(table.hostname)
      .where(sql`lifecycle_state != 'released'`),
    index("idx_rcd_org_id").on(table.orgId),
    index("idx_rcd_lifecycle").on(table.lifecycleState),
    index("idx_rcd_reconcile")
      .on(table.lastReconciledAt)
      .where(
        sql`lifecycle_state IN ('awaiting_dns_challenge', 'validating', 'provisioning_cert', 'awaiting_probe', 'awaiting_cutover', 'degraded', 'tombstoned', 'quarantined')`,
      ),
    index("idx_rcd_active_hostname")
      .on(table.hostname)
      .where(sql`lifecycle_state = 'active'`),
  ],
);

// ---------------------------------------------------------------------------
// region_custom_domain_events — append-only audit history (Decision 7 / 8)
// ---------------------------------------------------------------------------

export const regionCustomDomainEvents = pgTable(
  "region_custom_domain_events",
  {
    id: uuid("id")
      .primaryKey()
      .notNull()
      .default(sql`gen_random_uuid()`),
    domainId: uuid("domain_id").notNull(),
    eventType: varchar("event_type").notNull(),
    fromState: varchar("from_state"),
    toState: varchar("to_state"),
    actorUserId: integer("actor_user_id"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .default(sql`timezone('utc', now())`),
  },
  (table) => [
    foreignKey({
      columns: [table.domainId],
      foreignColumns: [regionCustomDomains.id],
      name: "region_custom_domain_events_domain_id_fkey",
    }).onDelete("restrict"),
    index("idx_rcde_domain_id").on(table.domainId, table.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Schema export — grouped object mirroring @acme/db's convention
// ---------------------------------------------------------------------------

export const schema = {
  reconcilerLeases,
  orgRegionBindings,
  orgDomainQuota,
  domainBlocklist,
  regionCustomDomains,
  regionCustomDomainEvents,
};

// ---------------------------------------------------------------------------
// Row types — inferred from Drizzle table definitions, no manual shapes
// ---------------------------------------------------------------------------

export type ReconcilerLease = typeof reconcilerLeases.$inferSelect;
export type NewReconcilerLease = typeof reconcilerLeases.$inferInsert;

export type OrgRegionBinding = typeof orgRegionBindings.$inferSelect;
export type NewOrgRegionBinding = typeof orgRegionBindings.$inferInsert;

export type OrgDomainQuota = typeof orgDomainQuota.$inferSelect;
export type NewOrgDomainQuota = typeof orgDomainQuota.$inferInsert;

export type DomainBlocklistEntry = typeof domainBlocklist.$inferSelect;
export type NewDomainBlocklistEntry = typeof domainBlocklist.$inferInsert;

export type RegionCustomDomain = typeof regionCustomDomains.$inferSelect;
export type NewRegionCustomDomain = typeof regionCustomDomains.$inferInsert;

export type RegionCustomDomainEvent =
  typeof regionCustomDomainEvents.$inferSelect;
export type NewRegionCustomDomainEvent =
  typeof regionCustomDomainEvents.$inferInsert;
