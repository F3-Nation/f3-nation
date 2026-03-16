CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "auth"."email_mfa_code" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."oauth_access_token" (
	"token" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scopes" text NOT NULL,
	"expires" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."oauth_authorization_code" (
	"code" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text NOT NULL,
	"code_challenge" text,
	"code_challenge_method" text,
	"expires" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client_secret" text NOT NULL,
	"redirect_uris" text NOT NULL,
	"allowed_origin" text NOT NULL,
	"scopes" text DEFAULT 'openid profile email' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."oauth_refresh_token" (
	"token" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."oauth_authorization_code" ADD CONSTRAINT "oauth_authorization_code_client_id_oauth_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_access_token_oauth_access_token_token_fk" FOREIGN KEY ("access_token") REFERENCES "auth"."oauth_access_token"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_mfa_code_email_idx" ON "auth"."email_mfa_code" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_mfa_code_expires_idx" ON "auth"."email_mfa_code" USING btree ("expires_at");