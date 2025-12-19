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
CREATE INDEX CONCURRENTLY "idx_attendance_event_instance_id" ON "attendance" USING btree ("event_instance_id" int4_ops);