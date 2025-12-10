ALTER TABLE "slack_users" ALTER COLUMN "slack_updated" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "achievements_x_users" ADD COLUMN "award_year" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "achievements_x_users" ADD COLUMN "award_period" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "achievements" DROP COLUMN "verb";--> statement-breakpoint
ALTER TABLE "achievements_x_users" DROP CONSTRAINT "achievements_x_users_pkey";
--> statement-breakpoint
ALTER TABLE "achievements_x_users" ADD CONSTRAINT "achievements_x_users_pkey" PRIMARY KEY("achievement_id","user_id","award_year","award_period");