

CREATE TABLE "roles_x_api_keys_x_org" (
	"role_id" integer NOT NULL,
	"api_key_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	CONSTRAINT "roles_x_api_keys_x_org_pkey" PRIMARY KEY("role_id","api_key_id","org_id")
);
--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" ADD CONSTRAINT "roles_x_api_keys_x_org_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" ADD CONSTRAINT "roles_x_api_keys_x_org_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_x_api_keys_x_org" ADD CONSTRAINT "roles_x_api_keys_x_org_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Migrate existing org_ids JSON data to the join table
-- Assign admin role to all existing org associations
INSERT INTO "roles_x_api_keys_x_org" ("role_id", "api_key_id", "org_id")
SELECT 
	r.id AS role_id,
	ak.id AS api_key_id,
	(org_id.value::text)::integer AS org_id
FROM "api_keys" ak
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ak.org_ids::jsonb, '[]'::jsonb)) AS org_id
INNER JOIN "roles" r ON r.name = 'admin'
WHERE ak.org_ids IS NOT NULL 
	AND ak.org_ids::jsonb != '[]'::jsonb
	AND (org_id.value::text)::integer IS NOT NULL
ON CONFLICT ("role_id", "api_key_id", "org_id") DO NOTHING;
--> statement-breakpoint

ALTER TABLE "api_keys" DROP COLUMN "org_ids";