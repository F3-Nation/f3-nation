CREATE TABLE "rawPoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entryId" varchar NOT NULL,
	"region_id" uuid,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"slug" varchar NOT NULL,
	CONSTRAINT "regions_name_unique" UNIQUE("name"),
	CONSTRAINT "regions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workout_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid,
	"points_id" uuid
);
--> statement-breakpoint
ALTER TABLE "rawPoints" ADD CONSTRAINT "rawPoints_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_locations" ADD CONSTRAINT "workout_locations_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_locations" ADD CONSTRAINT "workout_locations_points_id_rawPoints_id_fk" FOREIGN KEY ("points_id") REFERENCES "public"."rawPoints"("id") ON DELETE no action ON UPDATE no action;