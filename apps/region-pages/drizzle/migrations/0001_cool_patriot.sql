CREATE TABLE "workouts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"region_id" varchar,
	"name" varchar NOT NULL,
	"time" varchar NOT NULL,
	"type" varchar NOT NULL,
	"group" varchar NOT NULL,
	"image" varchar,
	"notes" varchar,
	"latitude" double precision,
	"longitude" double precision,
	"location" varchar
);
--> statement-breakpoint
ALTER TABLE "rawPoints" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_locations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "rawPoints" CASCADE;--> statement-breakpoint
DROP TABLE "workout_locations" CASCADE;--> statement-breakpoint
ALTER TABLE "regions" ALTER COLUMN "id" SET DATA TYPE varchar;--> statement-breakpoint
ALTER TABLE "regions" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "regions" ALTER COLUMN "slug" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "website" varchar;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "city" varchar;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "state" varchar;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "country" varchar;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "zoom" integer;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;