CREATE TABLE "auth"."better_auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "better_auth_oauth_access_token_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[],
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "better_auth_oauth_client_client_id_key" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"rotated_at" timestamp,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp,
	"auth_time" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "better_auth_oauth_refresh_token_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean,
	"disabled" boolean,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer,
	"metadata" jsonb,
	CONSTRAINT "better_auth_oauth_resource_identifier_key" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "better_auth_session_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "better_auth_user_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth"."better_auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."better_auth_account" ADD CONSTRAINT "better_auth_account_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_access_token" ADD CONSTRAINT "better_auth_oauth_access_token_client_id_better_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "auth"."better_auth_oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_access_token" ADD CONSTRAINT "better_auth_oauth_access_token_session_id_better_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "auth"."better_auth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_access_token" ADD CONSTRAINT "better_auth_oauth_access_token_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_access_token" ADD CONSTRAINT "better_auth_oauth_access_token_refresh_id_better_auth_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "auth"."better_auth_oauth_refresh_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_client" ADD CONSTRAINT "better_auth_oauth_client_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_client_resource" ADD CONSTRAINT "better_auth_oauth_client_resource_client_id_better_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "auth"."better_auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_client_resource" ADD CONSTRAINT "better_auth_oauth_client_resource_resource_id_better_auth_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "auth"."better_auth_oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_consent" ADD CONSTRAINT "better_auth_oauth_consent_client_id_better_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "auth"."better_auth_oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_consent" ADD CONSTRAINT "better_auth_oauth_consent_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_refresh_token" ADD CONSTRAINT "better_auth_oauth_refresh_token_client_id_better_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "auth"."better_auth_oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_refresh_token" ADD CONSTRAINT "better_auth_oauth_refresh_token_session_id_better_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "auth"."better_auth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_oauth_refresh_token" ADD CONSTRAINT "better_auth_oauth_refresh_token_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."better_auth_session" ADD CONSTRAINT "better_auth_session_user_id_better_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."better_auth_user"("id") ON DELETE cascade ON UPDATE no action;