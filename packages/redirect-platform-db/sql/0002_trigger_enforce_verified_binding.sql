-- R5 bootstrap migration (hand-written): BEFORE INSERT OR UPDATE trigger on
-- region_custom_domains that enforces the referenced org_region_bindings row
-- is in 'verified' state.
--
-- Source of truth: docs/plans/2026-04-14-multi-tenant-saas-refactor.md,
-- Decision 7 "enforce_verified_binding()" function + trg_rcd_verified_binding
-- trigger block.
--
-- This is the DB-level authorization gate the R4 review asked for. The
-- application layer still checks verification state for UX, but the DB is
-- the authority — even a compromised admin UI role cannot insert a domain
-- for an unverified binding, because the trigger will raise check_violation.
--
-- Apply AFTER 0000_*.sql (Drizzle tables) and 0001_roles_and_grants.sql.
-- Must be run as redirect_platform_admin (only role with CREATE TRIGGER).

-- R5: BEFORE INSERT OR UPDATE trigger on region_custom_domains enforces
-- that the referenced org_region_bindings row is in 'verified' state.
-- This is the DB-level authorization gate the R4 review asked for.
CREATE OR REPLACE FUNCTION enforce_verified_binding()
RETURNS TRIGGER AS $$
DECLARE
  v_state VARCHAR;
BEGIN
  SELECT verification_state INTO v_state
    FROM org_region_bindings
   WHERE org_id = NEW.org_id;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'no org_region_bindings row for org_id=%', NEW.org_id
      USING ERRCODE = '23514';  -- check_violation
  END IF;

  IF v_state != 'verified' THEN
    RAISE EXCEPTION 'org_region_bindings.verification_state = % for org_id=%, domain registration requires verified', v_state, NEW.org_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rcd_verified_binding
BEFORE INSERT OR UPDATE OF org_id ON region_custom_domains
FOR EACH ROW EXECUTE FUNCTION enforce_verified_binding();
