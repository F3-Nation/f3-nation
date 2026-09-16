-- Operator-led rollback for 0023; not part of the forward migration directory.
-- Stop writers and coordinate the old application version before running.
-- Reconcile the migration journal only after successful rollback; see the spec.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.orgs, public.positions IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orgs WHERE org_type::text = 'territory')
    OR EXISTS (SELECT 1 FROM public.positions WHERE org_type::text = 'territory') THEN
    RAISE EXCEPTION 'Cannot roll back org_type while territory values exist in orgs or positions';
  END IF;
END $$;
DROP INDEX public.idx_orgs_org_type;
ALTER TABLE public.orgs ALTER COLUMN org_type TYPE text;
ALTER TABLE public.positions ALTER COLUMN org_type TYPE text;
DROP TYPE public.org_type;
CREATE TYPE public.org_type AS ENUM ('ao', 'region', 'area', 'sector', 'nation');
ALTER TABLE public.orgs ALTER COLUMN org_type TYPE public.org_type USING org_type::public.org_type;
ALTER TABLE public.positions ALTER COLUMN org_type TYPE public.org_type USING org_type::public.org_type;
CREATE INDEX idx_orgs_org_type ON public.orgs USING btree (org_type enum_ops);
COMMIT;
