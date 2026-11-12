ALTER TABLE "api_keys" ALTER COLUMN "key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_hint" varchar(4);--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_key" UNIQUE("key_hash");