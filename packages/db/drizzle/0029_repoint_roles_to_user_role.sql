-- Repoint public.roles.name from the duplicate region_role enum onto user_role.
-- Both enums currently hold identical labels ('user', 'editor', 'admin'), so the
-- text round-trip cast succeeds for every existing row. user_role keeps the same
-- OID, and nothing else (no view, function, default, or other column) depends on
-- region_role, so it can then be dropped outright.
ALTER TABLE "public"."roles"
  ALTER COLUMN "name" TYPE "public"."user_role"
  USING "name"::text::"public"."user_role";--> statement-breakpoint
DROP TYPE "public"."region_role";