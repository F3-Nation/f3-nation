-- Custom SQL migration file, put your code below! --

-- Keeps auth.better_auth_user.email in sync when an admin (or an account
-- merge script) changes users.email directly. Without this, Better Auth's
-- own shadow row still has the old email, so the next sign-in with the new
-- email can't find it, tries to create a fresh row with the same
-- (now-colliding) f3_user_id, and the user is locked out.
--
-- Does not handle deletes/merges that remove a users row entirely — that
-- case is covered by the f3_user_id FK + ON DELETE CASCADE added in the
-- preceding migration.
-- Lowercased: Better Auth's own email-otp lookups/inserts always
-- `.toLowerCase()` the email first (confirmed against the pinned
-- better-auth@1.7.4, e.g. plugins/email-otp/routes.mjs), but
-- public.users.email is citext (case-insensitive, original casing
-- preserved) while better_auth_user.email is plain text with a
-- case-sensitive unique constraint. Writing NEW.email verbatim would
-- let a mixed-case users.email value land in better_auth_user, miss
-- Better Auth's lowercase lookup on the next sign-in, and reproduce
-- the exact lockout this trigger exists to prevent.
--
-- SECURITY DEFINER: runs with this function's owner's privileges (the
-- migration role, which owns auth.better_auth_user) rather than whichever
-- role's UPDATE on public.users fires the trigger — so a narrower
-- runtime role scoped to just the public schema can still update
-- users.email without needing its own grant on the auth schema. search_path
-- is fixed for the standard SECURITY DEFINER hardening (defense in depth on
-- top of already schema-qualifying every reference below).
CREATE OR REPLACE FUNCTION auth.sync_better_auth_user_email()
RETURNS trigger
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
BEGIN
  UPDATE auth.better_auth_user
  SET email = lower(trim(NEW.email)), updated_at = timezone('utc'::text, now())
  WHERE f3_user_id = NEW.id;
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- No email in the message: callers (e.g. packages/api/src/router/user.ts's
    -- crupdate mutation) log the raw driver error on an unexpected DB fault,
    -- and that error's message text is what actually reaches the log, not
    -- just the caller's own PII-scrubbed log context. NEW.id is enough to
    -- find the row for manual reconciliation without leaking the email.
    RAISE EXCEPTION 'Cannot sync users.email to auth.better_auth_user for user %: target email already claimed by a stale/other shadow row (better_auth_user_email_key). Manual reconciliation required.',
      NEW.id
      USING ERRCODE = 'unique_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS users_email_sync_better_auth ON public.users;
CREATE TRIGGER users_email_sync_better_auth
AFTER UPDATE OF email ON public.users
FOR EACH ROW
WHEN (NEW.email IS DISTINCT FROM OLD.email)
EXECUTE FUNCTION auth.sync_better_auth_user_email();
