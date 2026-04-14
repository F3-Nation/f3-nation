CREATE TYPE "public"."binding_source" AS ENUM('manual_admin', 'auto_backfill', 'self_service_claim');--> statement-breakpoint
CREATE TYPE "public"."hostname_role" AS ENUM('apex', 'stats');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_state" AS ENUM('pending', 'awaiting_dns_challenge', 'validating', 'provisioning_cert', 'awaiting_probe', 'awaiting_cutover', 'active', 'degraded', 'tombstoned', 'quarantined', 'released');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('region_admin_confirmed', 'super_admin_override', 'self_service_claim_owned_org');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('unverified', 'verified', 'revoked');--> statement-breakpoint
CREATE TABLE "domain_blocklist" (
	"hostname" varchar PRIMARY KEY NOT NULL,
	"reason" varchar NOT NULL,
	"added_by_user_id" integer NOT NULL,
	"added_at" timestamp DEFAULT timezone('utc', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_domain_quota" (
	"org_id" integer PRIMARY KEY NOT NULL,
	"max_domains" integer NOT NULL,
	"raised_by_user_id" integer NOT NULL,
	"raised_reason" text,
	"created_at" timestamp DEFAULT timezone('utc', now()) NOT NULL,
	"updated_at" timestamp DEFAULT timezone('utc', now()) NOT NULL,
	CONSTRAINT "org_domain_quota_max_domains_positive" CHECK ("org_domain_quota"."max_domains" > 0)
);
--> statement-breakpoint
CREATE TABLE "org_region_bindings" (
	"org_id" integer PRIMARY KEY NOT NULL,
	"pax_vault_region_id" varchar NOT NULL,
	"region_slug" varchar NOT NULL,
	"region_name" varchar NOT NULL,
	"verification_state" "verification_state" DEFAULT 'unverified' NOT NULL,
	"verified_by_user_id" integer,
	"verified_at" timestamp,
	"verification_method" "verification_method",
	"bind_time_validator_snapshot" jsonb,
	"source" "binding_source" NOT NULL,
	"bound_by_user_id" integer NOT NULL,
	"bound_at" timestamp DEFAULT timezone('utc', now()) NOT NULL,
	"created_at" timestamp DEFAULT timezone('utc', now()) NOT NULL,
	"updated_at" timestamp DEFAULT timezone('utc', now()) NOT NULL,
	CONSTRAINT "org_region_bindings_pax_vault_region_id_unique" UNIQUE("pax_vault_region_id"),
	CONSTRAINT "org_region_bindings_region_slug_unique" UNIQUE("region_slug")
);
--> statement-breakpoint
CREATE TABLE "reconciler_leases" (
	"lease_key" varchar PRIMARY KEY NOT NULL,
	"held_by" varchar NOT NULL,
	"acquired_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "region_custom_domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"event_type" varchar NOT NULL,
	"from_state" varchar,
	"to_state" varchar,
	"actor_user_id" integer,
	"details" jsonb,
	"created_at" timestamp DEFAULT timezone('utc', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "region_custom_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" integer NOT NULL,
	"region_slug" varchar NOT NULL,
	"region_id" varchar NOT NULL,
	"region_name" varchar NOT NULL,
	"hostname" varchar NOT NULL,
	"hostname_role" "hostname_role" NOT NULL,
	"gcp_dns_authorization_id" varchar,
	"gcp_certificate_id" varchar,
	"gcp_cert_map_entry_id" varchar,
	"dns_challenge_record_name" varchar,
	"dns_challenge_record_value" varchar,
	"lifecycle_state" "lifecycle_state" NOT NULL,
	"probe_consecutive_successes" integer DEFAULT 0 NOT NULL,
	"probe_last_attempted_at" timestamp,
	"probe_last_result_detail" jsonb,
	"probe_region_us_central1_last_success" timestamp,
	"probe_region_europe_west1_last_success" timestamp,
	"last_reconciled_at" timestamp,
	"reconciler_error" jsonb,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT timezone('utc', now()) NOT NULL,
	"updated_at" timestamp DEFAULT timezone('utc', now()) NOT NULL,
	"tombstoned_at" timestamp,
	"released_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "region_custom_domain_events" ADD CONSTRAINT "region_custom_domain_events_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."region_custom_domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_custom_domains" ADD CONSTRAINT "region_custom_domains_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."org_region_bindings"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_leases_expires_at" ON "reconciler_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_rcde_domain_id" ON "region_custom_domain_events" USING btree ("domain_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_locked_hostname" ON "region_custom_domains" USING btree ("hostname") WHERE lifecycle_state != 'released';--> statement-breakpoint
CREATE INDEX "idx_rcd_org_id" ON "region_custom_domains" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_rcd_lifecycle" ON "region_custom_domains" USING btree ("lifecycle_state");--> statement-breakpoint
CREATE INDEX "idx_rcd_reconcile" ON "region_custom_domains" USING btree ("last_reconciled_at") WHERE lifecycle_state IN ('awaiting_dns_challenge', 'validating', 'provisioning_cert', 'awaiting_probe', 'awaiting_cutover', 'degraded', 'tombstoned', 'quarantined');--> statement-breakpoint
CREATE INDEX "idx_rcd_active_hostname" ON "region_custom_domains" USING btree ("hostname") WHERE lifecycle_state = 'active';