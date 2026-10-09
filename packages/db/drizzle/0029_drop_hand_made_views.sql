SET LOCAL lock_timeout = '3s';--> statement-breakpoint

-- These views were created by hand in some environments and no migration
-- defines them. IF EXISTS makes this a no-op where they were never created;
-- RESTRICT (the default) fails rather than dropping anything built on them.
DROP VIEW IF EXISTS public.attendance_expanded;--> statement-breakpoint
DROP VIEW IF EXISTS public.event_instance_expanded;
