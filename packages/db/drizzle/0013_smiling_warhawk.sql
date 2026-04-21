CREATE INDEX "idx_attendance_x_types_type_id" ON "attendance_x_attendance_types" USING btree ("attendance_type_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_event_instances_start_date" ON "event_instances" USING btree ("start_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_event_instances_start_date_active" ON "event_instances" USING btree ("start_date" date_ops) WHERE is_active;--> statement-breakpoint
CREATE INDEX "idx_slack_users_user_team_id" ON "slack_users" USING btree ("user_id","slack_team_id");