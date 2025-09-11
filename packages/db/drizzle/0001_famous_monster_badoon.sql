CREATE TYPE "public"."day_of_week" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');--> statement-breakpoint
CREATE TYPE "public"."event_cadence" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."event_category" AS ENUM('first_f', 'second_f', 'third_f');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('ao', 'region', 'area', 'sector', 'nation');--> statement-breakpoint
CREATE TYPE "public"."region_role" AS ENUM('user', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('create_location', 'create_event', 'edit', 'delete_event');--> statement-breakpoint
CREATE TYPE "public"."update_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"verb" varchar NOT NULL,
	"image_url" varchar,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"specific_org_id" integer
);
--> statement-breakpoint
CREATE TABLE "achievements_x_users" (
	"achievement_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"date_awarded" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "achievements_x_users_pkey" PRIMARY KEY("achievement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "alembic_version" (
	"version_num" varchar(32) PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"is_planned" boolean NOT NULL,
	"meta" json,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"event_instance_id" integer NOT NULL,
	CONSTRAINT "attendance_event_instance_id_user_id_is_planned_key" UNIQUE("user_id","is_planned","event_instance_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar NOT NULL,
	"description" varchar,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_x_attendance_types" (
	"attendance_id" integer NOT NULL,
	"attendance_type_id" integer NOT NULL,
	CONSTRAINT "attendance_x_attendance_types_pkey" PRIMARY KEY("attendance_id","attendance_type_id")
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"user_id" integer NOT NULL,
	"type" varchar NOT NULL,
	"provider" varchar NOT NULL,
	"provider_account_id" varchar NOT NULL,
	"refresh_token" varchar,
	"access_token" varchar,
	"expires_at" timestamp,
	"token_type" varchar,
	"scope" varchar,
	"id_token" varchar,
	"session_state" varchar,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "auth_accounts_pkey" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires" timestamp NOT NULL,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verification_tokens" (
	"identifier" varchar NOT NULL,
	"token" varchar NOT NULL,
	"expires" timestamp NOT NULL,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "auth_verification_tokens_pkey" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "event_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"location_id" integer,
	"series_id" integer,
	"is_active" boolean NOT NULL,
	"highlight" boolean NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"start_time" varchar,
	"end_time" varchar,
	"name" varchar NOT NULL,
	"description" varchar,
	"email" varchar,
	"pax_count" integer,
	"fng_count" integer,
	"preblast" varchar,
	"backblast" varchar,
	"preblast_rich" json,
	"backblast_rich" json,
	"preblast_ts" double precision,
	"backblast_ts" double precision,
	"meta" json,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_instances_x_event_types" (
	"event_instance_id" integer NOT NULL,
	"event_type_id" integer NOT NULL,
	CONSTRAINT "event_instances_x_event_types_pkey" PRIMARY KEY("event_instance_id","event_type_id")
);
--> statement-breakpoint
CREATE TABLE "event_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"color" varchar,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"specific_org_id" integer
);
--> statement-breakpoint
CREATE TABLE "event_tags_x_event_instances" (
	"event_instance_id" integer NOT NULL,
	"event_tag_id" integer NOT NULL,
	CONSTRAINT "event_tags_x_event_instances_pkey" PRIMARY KEY("event_instance_id","event_tag_id")
);
--> statement-breakpoint
CREATE TABLE "event_tags_x_events" (
	"event_id" integer NOT NULL,
	"event_tag_id" integer NOT NULL,
	CONSTRAINT "event_tags_x_events_pkey" PRIMARY KEY("event_id","event_tag_id")
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"acronym" varchar,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"specific_org_id" integer,
	"event_category" "event_category" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"location_id" integer,
	"series_id" integer,
	"is_active" boolean NOT NULL,
	"highlight" boolean NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"start_time" varchar,
	"end_time" varchar,
	"day_of_week" "day_of_week",
	"name" varchar NOT NULL,
	"description" varchar,
	"recurrence_pattern" "event_cadence",
	"recurrence_interval" integer,
	"index_within_interval" integer,
	"meta" json,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"email" varchar
);
--> statement-breakpoint
CREATE TABLE "events_x_event_types" (
	"event_id" integer NOT NULL,
	"event_type_id" integer NOT NULL,
	CONSTRAINT "events_x_event_types_pkey" PRIMARY KEY("event_id","event_type_id")
);
--> statement-breakpoint
CREATE TABLE "expansions" (
	"id" serial PRIMARY KEY NOT NULL,
	"area" varchar NOT NULL,
	"pinned_lat" double precision NOT NULL,
	"pinned_lon" double precision NOT NULL,
	"user_lat" double precision NOT NULL,
	"user_lon" double precision NOT NULL,
	"interested_in_organizing" boolean NOT NULL,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expansions_x_users" (
	"expansion_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"request_date" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"notes" varchar,
	CONSTRAINT "expansions_x_users_pkey" PRIMARY KEY("expansion_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"is_active" boolean NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"address_street" varchar,
	"address_city" varchar,
	"address_state" varchar,
	"address_zip" varchar,
	"address_country" varchar,
	"meta" json,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"email" varchar,
	"address_street2" varchar
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"default_location_id" integer,
	"name" varchar NOT NULL,
	"description" varchar,
	"is_active" boolean NOT NULL,
	"logo_url" varchar,
	"website" varchar,
	"email" varchar,
	"twitter" varchar,
	"facebook" varchar,
	"instagram" varchar,
	"last_annual_review" date,
	"meta" json,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"org_type" "org_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs_x_slack_spaces" (
	"org_id" integer NOT NULL,
	"slack_space_id" integer NOT NULL,
	CONSTRAINT "orgs_x_slack_spaces_pkey" PRIMARY KEY("org_id","slack_space_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"org_id" integer,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"org_type" "org_type"
);
--> statement-breakpoint
CREATE TABLE "positions_x_orgs_x_users" (
	"position_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "positions_x_orgs_x_users_pkey" PRIMARY KEY("position_id","org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" "region_role" NOT NULL,
	"description" varchar,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles_x_permissions" (
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "roles_x_permissions_pkey" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles_x_users_x_org" (
	"role_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	CONSTRAINT "roles_x_users_x_org_pkey" PRIMARY KEY("role_id","user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "slack_spaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" varchar NOT NULL,
	"workspace_name" varchar,
	"bot_token" varchar,
	"settings" json,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "slack_spaces_team_id_key" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE "slack_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"slack_id" varchar NOT NULL,
	"user_name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"is_admin" boolean NOT NULL,
	"is_owner" boolean NOT NULL,
	"is_bot" boolean NOT NULL,
	"user_id" integer,
	"avatar_url" varchar,
	"slack_team_id" varchar NOT NULL,
	"strava_access_token" varchar,
	"strava_refresh_token" varchar,
	"strava_expires_at" timestamp,
	"strava_athlete_id" integer,
	"meta" json,
	"slack_updated" timestamp,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "update_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"region_id" integer NOT NULL,
	"event_id" integer,
	"event_type_ids" integer[],
	"event_tag" varchar,
	"event_series_id" integer,
	"event_is_series" boolean,
	"event_is_active" boolean,
	"event_highlight" boolean,
	"event_start_date" date,
	"event_end_date" date,
	"event_start_time" varchar,
	"event_end_time" varchar,
	"event_day_of_week" "day_of_week",
	"event_name" varchar NOT NULL,
	"event_description" varchar,
	"event_recurrence_pattern" "event_cadence",
	"event_recurrence_interval" integer,
	"event_index_within_interval" integer,
	"event_meta" json,
	"event_contact_email" varchar,
	"location_name" varchar,
	"location_description" varchar,
	"location_address" varchar,
	"location_address2" varchar,
	"location_city" varchar,
	"location_state" varchar,
	"location_zip" varchar,
	"location_country" varchar,
	"location_lat" real,
	"location_lng" real,
	"location_id" integer,
	"location_contact_email" varchar,
	"ao_id" integer,
	"ao_name" varchar,
	"ao_logo" varchar,
	"submitted_by" varchar NOT NULL,
	"submitter_validated" boolean,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"status" "update_request_status" DEFAULT 'pending' NOT NULL,
	"meta" json,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"request_type" "request_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"f3_name" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"email" "citext" NOT NULL,
	"phone" varchar,
	"home_region_id" integer,
	"avatar_url" varchar,
	"meta" json,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"emergency_contact" varchar,
	"emergency_phone" varchar,
	"emergency_notes" varchar,
	"email_verified" timestamp,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_specific_org_id_fkey" FOREIGN KEY ("specific_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements_x_users" ADD CONSTRAINT "achievements_x_users_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements_x_users" ADD CONSTRAINT "achievements_x_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "event_instance_id_fkey" FOREIGN KEY ("event_instance_id") REFERENCES "public"."event_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_x_attendance_types" ADD CONSTRAINT "attendance_x_attendance_types_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_x_attendance_types" ADD CONSTRAINT "attendance_x_attendance_types_attendance_type_id_fkey" FOREIGN KEY ("attendance_type_id") REFERENCES "public"."attendance_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances" ADD CONSTRAINT "event_instances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances" ADD CONSTRAINT "event_instances_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances" ADD CONSTRAINT "event_instances_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances_x_event_types" ADD CONSTRAINT "event_instances_x_event_types_event_instance_id_fkey" FOREIGN KEY ("event_instance_id") REFERENCES "public"."event_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances_x_event_types" ADD CONSTRAINT "event_instances_x_event_types_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_specific_org_id_fkey" FOREIGN KEY ("specific_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags_x_event_instances" ADD CONSTRAINT "event_tags_x_event_instances_event_instance_id_fkey" FOREIGN KEY ("event_instance_id") REFERENCES "public"."event_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags_x_event_instances" ADD CONSTRAINT "event_tags_x_event_instances_event_tag_id_fkey" FOREIGN KEY ("event_tag_id") REFERENCES "public"."event_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags_x_events" ADD CONSTRAINT "event_tags_x_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags_x_events" ADD CONSTRAINT "event_tags_x_events_event_tag_id_fkey" FOREIGN KEY ("event_tag_id") REFERENCES "public"."event_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_specific_org_id_fkey" FOREIGN KEY ("specific_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_x_event_types" ADD CONSTRAINT "events_x_event_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_x_event_types" ADD CONSTRAINT "events_x_event_types_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansions_x_users" ADD CONSTRAINT "expansions_x_users_expansion_id_fkey" FOREIGN KEY ("expansion_id") REFERENCES "public"."expansions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansions_x_users" ADD CONSTRAINT "expansions_x_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs_x_slack_spaces" ADD CONSTRAINT "orgs_x_slack_spaces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs_x_slack_spaces" ADD CONSTRAINT "orgs_x_slack_spaces_slack_space_id_fkey" FOREIGN KEY ("slack_space_id") REFERENCES "public"."slack_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_x_orgs_x_users" ADD CONSTRAINT "positions_x_orgs_x_users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_x_orgs_x_users" ADD CONSTRAINT "positions_x_orgs_x_users_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_x_orgs_x_users" ADD CONSTRAINT "positions_x_orgs_x_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_permissions" ADD CONSTRAINT "roles_x_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_permissions" ADD CONSTRAINT "roles_x_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_users_x_org" ADD CONSTRAINT "roles_x_users_x_org_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_users_x_org" ADD CONSTRAINT "roles_x_users_x_org_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_users_x_org" ADD CONSTRAINT "roles_x_users_x_org_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_users" ADD CONSTRAINT "slack_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_requests" ADD CONSTRAINT "update_requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_requests" ADD CONSTRAINT "update_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_requests" ADD CONSTRAINT "update_requests_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_region_id_fkey" FOREIGN KEY ("home_region_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_event_instances_is_active" ON "event_instances" USING btree ("is_active" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_event_instances_location_id" ON "event_instances" USING btree ("location_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_event_instances_org_id" ON "event_instances" USING btree ("org_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_events_is_active" ON "events" USING btree ("is_active" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_events_location_id" ON "events" USING btree ("location_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_events_org_id" ON "events" USING btree ("org_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_events_x_event_types_event_id" ON "events_x_event_types" USING btree ("event_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_events_x_event_types_event_type_id" ON "events_x_event_types" USING btree ("event_type_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_locations_is_active" ON "locations" USING btree ("is_active" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_locations_name" ON "locations" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "idx_locations_org_id" ON "locations" USING btree ("org_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_orgs_is_active" ON "orgs" USING btree ("is_active" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_orgs_org_type" ON "orgs" USING btree ("org_type" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_orgs_parent_id" ON "orgs" USING btree ("parent_id" int4_ops);