DROP INDEX "auth"."better_auth_user_f3_user_id_idx";--> statement-breakpoint
ALTER TABLE "auth"."better_auth_user" ADD CONSTRAINT "better_auth_user_f3_user_id_key" UNIQUE("f3_user_id");