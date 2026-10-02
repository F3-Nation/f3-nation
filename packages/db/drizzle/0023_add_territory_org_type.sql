-- ADD VALUE keeps the enum's OID, so views, indexes, and cached plans that
-- reference org_type are untouched. BEFORE preserves the declared sort order.
-- The new value cannot be used until this transaction commits, so no later
-- migration in the same batch may reference 'territory'.
ALTER TYPE "public"."org_type" ADD VALUE IF NOT EXISTS 'territory' BEFORE 'sector';--> statement-breakpoint
-- IF NOT EXISTS ignores BEFORE when the label already exists, so refuse a
-- pre-existing label in the wrong position. Read pg_enum directly: casting to
-- org_type here would itself be an unsafe use of the new value.
DO $$
BEGIN
  IF (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum
      WHERE enumtypid = 'public.org_type'::regtype)
     <> ARRAY['ao', 'region', 'area', 'territory', 'sector', 'nation'] THEN
    RAISE EXCEPTION 'org_type labels are not in the expected order';
  END IF;
END $$;
