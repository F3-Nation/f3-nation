ALTER TABLE "api_keys_x_orgs" RENAME TO "roles_x_api_keys_x_org";--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" DROP CONSTRAINT "api_keys_x_orgs_api_key_id_fkey";
--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" DROP CONSTRAINT "api_keys_x_orgs_org_id_fkey";
--> statement-breakpoint
DROP INDEX "idx_api_keys_x_orgs_api_key_id";--> statement-breakpoint
DROP INDEX "idx_api_keys_x_orgs_org_id";--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" DROP CONSTRAINT "api_keys_x_orgs_pkey";--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" ADD CONSTRAINT "roles_x_api_keys_x_org_pkey" PRIMARY KEY("role_id","api_key_id","org_id");--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" ADD COLUMN "role_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "phone" varchar;--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" ADD CONSTRAINT "roles_x_api_keys_x_org_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" ADD CONSTRAINT "roles_x_api_keys_x_org_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" ADD CONSTRAINT "roles_x_api_keys_x_org_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;