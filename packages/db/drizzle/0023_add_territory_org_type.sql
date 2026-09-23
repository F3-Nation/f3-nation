-- ADD VALUE keeps the enum's OID, so views, indexes, and cached plans that
-- reference org_type are untouched. BEFORE preserves the declared sort order.
-- The new value cannot be used until this transaction commits, so no later
-- migration in the same batch may reference 'territory'.
ALTER TYPE "public"."org_type" ADD VALUE IF NOT EXISTS 'territory' BEFORE 'sector';
