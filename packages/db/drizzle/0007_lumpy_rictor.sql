CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"owner_id" integer,
	"org_ids" json DEFAULT '[]'::json,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated" timestamp DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "api_keys_key_key" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;