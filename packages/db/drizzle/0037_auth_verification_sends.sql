CREATE TABLE "auth_verification_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" varchar NOT NULL,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_auth_verification_sends_identifier_created" ON "auth_verification_sends" USING btree ("identifier" text_ops,"created" timestamp_ops);