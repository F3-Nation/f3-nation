ALTER TABLE "auth"."better_auth_oauth_access_token" DROP CONSTRAINT "better_auth_oauth_access_token_user_id_better_auth_user_id_fk";
--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_client" DROP CONSTRAINT "better_auth_oauth_client_user_id_better_auth_user_id_fk";
--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_consent" DROP CONSTRAINT "better_auth_oauth_consent_user_id_better_auth_user_id_fk";
--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_refresh_token" DROP CONSTRAINT "better_auth_oauth_refresh_token_user_id_better_auth_user_id_fk";
--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_access_token" ADD CONSTRAINT "better_auth_oauth_access_token_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_client" ADD CONSTRAINT "better_auth_oauth_client_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_consent" ADD CONSTRAINT "better_auth_oauth_consent_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_refresh_token" ADD CONSTRAINT "better_auth_oauth_refresh_token_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE cascade ON UPDATE no action;