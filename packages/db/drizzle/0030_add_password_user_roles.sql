-- user_role now backs public.roles.name (see 0029). Add the new password roles
-- with ADD VALUE so the enum keeps its OID and existing rows/plans are untouched.
-- IF NOT EXISTS makes this idempotent; order does not matter for these labels.
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'password_manager';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'password_reader';