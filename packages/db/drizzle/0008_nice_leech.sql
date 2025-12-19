ALTER TABLE "attendance" DROP CONSTRAINT "event_instance_id_fkey";
--> statement-breakpoint
ALTER TABLE "attendance_x_attendance_types" DROP CONSTRAINT "attendance_x_attendance_types_attendance_id_fkey";
--> statement-breakpoint
ALTER TABLE "event_instances" DROP CONSTRAINT "event_instances_series_id_fkey";
--> statement-breakpoint
ALTER TABLE "event_instances_x_event_types" DROP CONSTRAINT "event_instances_x_event_types_event_instance_id_fkey";
--> statement-breakpoint
ALTER TABLE "event_tags_x_event_instances" DROP CONSTRAINT "event_tags_x_event_instances_event_instance_id_fkey";
--> statement-breakpoint
ALTER TABLE "event_tags_x_events" DROP CONSTRAINT "event_tags_x_events_event_id_fkey";
--> statement-breakpoint
ALTER TABLE "events_x_event_types" DROP CONSTRAINT "events_x_event_types_event_id_fkey";
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "event_instance_id_fkey" FOREIGN KEY ("event_instance_id") REFERENCES "public"."event_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_x_attendance_types" ADD CONSTRAINT "attendance_x_attendance_types_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances" ADD CONSTRAINT "event_instances_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances_x_event_types" ADD CONSTRAINT "event_instances_x_event_types_event_instance_id_fkey" FOREIGN KEY ("event_instance_id") REFERENCES "public"."event_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags_x_event_instances" ADD CONSTRAINT "event_tags_x_event_instances_event_instance_id_fkey" FOREIGN KEY ("event_instance_id") REFERENCES "public"."event_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags_x_events" ADD CONSTRAINT "event_tags_x_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_x_event_types" ADD CONSTRAINT "events_x_event_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attendance_event_instance_id" ON "attendance" USING btree ("event_instance_id" int4_ops);

-- Everything below is manually added to keep updated columns current
CREATE OR REPLACE FUNCTION public.set_updated_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$function$;

-- event_instances
DROP TRIGGER IF EXISTS set_updated_event_instances ON public.event_instances;
CREATE TRIGGER set_updated_event_instances
BEFORE UPDATE ON public.event_instances
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- permissions
DROP TRIGGER IF EXISTS set_updated_permissions ON public.permissions;
CREATE TRIGGER set_updated_permissions
BEFORE UPDATE ON public.permissions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- slack_spaces
DROP TRIGGER IF EXISTS set_updated_slack_spaces ON public.slack_spaces;
CREATE TRIGGER set_updated_slack_spaces
BEFORE UPDATE ON public.slack_spaces
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- expansions
DROP TRIGGER IF EXISTS set_updated_expansions ON public.expansions;
CREATE TRIGGER set_updated_expansions
BEFORE UPDATE ON public.expansions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- slack_users
DROP TRIGGER IF EXISTS set_updated_slack_users ON public.slack_users;
CREATE TRIGGER set_updated_slack_users
BEFORE UPDATE ON public.slack_users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- attendance
DROP TRIGGER IF EXISTS set_updated_attendance ON public.attendance;
CREATE TRIGGER set_updated_attendance
BEFORE UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- attendance_types
DROP TRIGGER IF EXISTS set_updated_attendance_types ON public.attendance_types;
CREATE TRIGGER set_updated_attendance_types
BEFORE UPDATE ON public.attendance_types
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- locations
DROP TRIGGER IF EXISTS set_updated_locations ON public.locations;
CREATE TRIGGER set_updated_locations
BEFORE UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- event_tags
DROP TRIGGER IF EXISTS set_updated_event_tags ON public.event_tags;
CREATE TRIGGER set_updated_event_tags
BEFORE UPDATE ON public.event_tags
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- roles
DROP TRIGGER IF EXISTS set_updated_roles ON public.roles;
CREATE TRIGGER set_updated_roles
BEFORE UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- users
DROP TRIGGER IF EXISTS set_updated_users ON public.users;
CREATE TRIGGER set_updated_users
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- achievements
DROP TRIGGER IF EXISTS set_updated_achievements ON public.achievements;
CREATE TRIGGER set_updated_achievements
BEFORE UPDATE ON public.achievements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- event_types
DROP TRIGGER IF EXISTS set_updated_event_types ON public.event_types;
CREATE TRIGGER set_updated_event_types
BEFORE UPDATE ON public.event_types
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- orgs
DROP TRIGGER IF EXISTS set_updated_orgs ON public.orgs;
CREATE TRIGGER set_updated_orgs
BEFORE UPDATE ON public.orgs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- positions
DROP TRIGGER IF EXISTS set_updated_positions ON public.positions;
CREATE TRIGGER set_updated_positions
BEFORE UPDATE ON public.positions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- events
DROP TRIGGER IF EXISTS set_updated_events ON public.events;
CREATE TRIGGER set_updated_events
BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- update_requests
DROP TRIGGER IF EXISTS set_updated_update_requests ON public.update_requests;
CREATE TRIGGER set_updated_update_requests
BEFORE UPDATE ON public.update_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- auth_accounts
DROP TRIGGER IF EXISTS set_updated_auth_accounts ON public.auth_accounts;
CREATE TRIGGER set_updated_auth_accounts
BEFORE UPDATE ON public.auth_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- auth_sessions
DROP TRIGGER IF EXISTS set_updated_auth_sessions ON public.auth_sessions;
CREATE TRIGGER set_updated_auth_sessions
BEFORE UPDATE ON public.auth_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- auth_verification_tokens
DROP TRIGGER IF EXISTS set_updated_auth_verification_tokens ON public.auth_verification_tokens;
CREATE TRIGGER set_updated_auth_verification_tokens
BEFORE UPDATE ON public.auth_verification_tokens
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();

-- api_keys
DROP TRIGGER IF EXISTS set_updated_api_keys ON public.api_keys;
CREATE TRIGGER set_updated_api_keys
BEFORE UPDATE ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.set_updated_column();