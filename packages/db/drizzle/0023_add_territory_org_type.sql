DROP INDEX "public"."idx_orgs_org_type";--> statement-breakpoint
ALTER TABLE "orgs" ALTER COLUMN "org_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "org_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."org_type";--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('ao', 'region', 'area', 'territory', 'sector', 'nation');--> statement-breakpoint
ALTER TABLE "orgs" ALTER COLUMN "org_type" SET DATA TYPE "public"."org_type" USING "org_type"::"public"."org_type";--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "org_type" SET DATA TYPE "public"."org_type" USING "org_type"::"public"."org_type";--> statement-breakpoint
CREATE INDEX "idx_orgs_org_type" ON "orgs" USING btree ("org_type" enum_ops);
