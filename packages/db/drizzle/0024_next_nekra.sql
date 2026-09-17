-- Custom SQL migration file, put your code below! --

-- Part of #953: keeps auth.better_auth_user.email in sync when an admin (or
-- Tackle's merge script) changes users.email directly. Without this, Better
-- Auth's own shadow row still has the old email, so the next sign-in with
-- the new email can't find it, tries to create a fresh row with the same
-- (now-colliding) f3_user_id, and the user is locked out.
--
-- Does not handle deletes/merges that remove a users row entirely — that
-- case is covered by the f3_user_id FK + ON DELETE CASCADE added in
-- 0023_calm_edwin_jarvis.sql.
CREATE OR REPLACE FUNCTION auth.sync_better_auth_user_email()
RETURNS trigger AS $$
BEGIN
  UPDATE auth.better_auth_user
  SET email = NEW.email, updated_at = timezone('utc'::text, now())
  WHERE f3_user_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER users_email_sync_better_auth
AFTER UPDATE OF email ON public.users
FOR EACH ROW
WHEN (NEW.email IS DISTINCT FROM OLD.email)
EXECUTE FUNCTION auth.sync_better_auth_user_email();
