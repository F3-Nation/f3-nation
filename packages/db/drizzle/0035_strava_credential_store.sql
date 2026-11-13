SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "user_strava_credentials" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"athlete_id" bigint NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "user_strava_credentials_athlete_id_key" UNIQUE("athlete_id"),
	CONSTRAINT "user_strava_credentials_complete" CHECK ("user_strava_credentials"."athlete_id" > 0 AND "user_strava_credentials"."expires_at" > 0 AND length("user_strava_credentials"."access_token") > 0 AND length("user_strava_credentials"."refresh_token") > 0)
);
--> statement-breakpoint
ALTER TABLE "user_strava_credentials" ADD CONSTRAINT "user_strava_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;