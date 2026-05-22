CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"status" varchar(20) NOT NULL,
	"duration_sec" integer,
	"regions_pruned" integer,
	"workouts_pruned" integer,
	"regions_seeded" integer,
	"regions_skipped_fresh" integer,
	"workouts_seeded" integer,
	"workouts_deduplicated" integer,
	"workouts_skipped" integer,
	"workout_batches" integer,
	"workouts_skipped_fresh" integer,
	"workouts_skipped_missing_type" integer,
	"workouts_skipped_missing_ao" integer,
	"workouts_skipped_missing_region" integer,
	"workouts_skipped_missing_location" integer,
	"workouts_skipped_missing_group" integer,
	"regions_enriched" integer,
	"error_message" text,
	"workout_region_breakdown" text
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"slug" varchar,
	"name" varchar NOT NULL,
	"description" varchar,
	"website" varchar,
	"image" varchar,
	"city" varchar,
	"state" varchar,
	"zip" varchar,
	"country" varchar,
	"latitude" double precision,
	"longitude" double precision,
	"zoom" integer,
	"email" varchar,
	"facebook" varchar,
	"twitter" varchar,
	"instagram" varchar,
	"last_ingested_at" timestamp,
	CONSTRAINT "regions_slug_unique" UNIQUE("slug"),
	CONSTRAINT "regions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "seed_runs" (
	"key" varchar PRIMARY KEY NOT NULL,
	"last_ingested_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"region_id" varchar,
	"name" varchar NOT NULL,
	"time" varchar NOT NULL,
	"type" varchar NOT NULL,
	"group" varchar NOT NULL,
	"notes" varchar,
	"latitude" double precision,
	"longitude" double precision,
	"city" varchar,
	"state" varchar,
	"zip" varchar,
	"country" varchar,
	"location" varchar,
	"types" text[],
	"last_ingested_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;