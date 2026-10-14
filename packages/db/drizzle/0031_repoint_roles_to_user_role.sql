-- Repoint public.roles.name from the duplicate region_role enum onto user_role.
-- user_role holds every region_role label ('user', 'editor', 'admin'), so the
-- text round-trip cast succeeds for every existing row. DROP TYPE without
-- CASCADE fails if anything else still depends on region_role.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
ALTER TABLE "public"."roles"
  ALTER COLUMN "name" TYPE "public"."user_role"
  USING "name"::text::"public"."user_role";--> statement-breakpoint
DROP TYPE "public"."region_role";