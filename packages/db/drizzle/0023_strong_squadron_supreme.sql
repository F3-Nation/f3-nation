CREATE TABLE "f3versary_announcement_settings" (
	"slack_space_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel" text,
	"lead_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "f3versary_announcement_settings_pkey" PRIMARY KEY("slack_space_id","org_id"),
	CONSTRAINT "f3versary_announcement_settings_lead_days_check" CHECK ("f3versary_announcement_settings"."lead_days" BETWEEN 0 AND 30),
	CONSTRAINT "f3versary_announcement_settings_enabled_channel_check" CHECK (NOT "f3versary_announcement_settings"."enabled" OR ("f3versary_announcement_settings"."channel" IS NOT NULL AND length("f3versary_announcement_settings"."channel") > 0))
);
--> statement-breakpoint
CREATE TABLE "f3versary_delivery_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"page_number" integer NOT NULL,
	"text" text NOT NULL,
	"blocks" jsonb NOT NULL,
	"client_msg_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"claim_token" uuid,
	"claim_expires_at" timestamp with time zone,
	"slack_ts" varchar(32),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "f3versary_delivery_pages_run_page_key" UNIQUE("run_id","page_number"),
	CONSTRAINT "f3versary_delivery_pages_client_msg_id_key" UNIQUE("client_msg_id"),
	CONSTRAINT "f3versary_delivery_pages_page_number_check" CHECK ("f3versary_delivery_pages"."page_number" >= 1),
	CONSTRAINT "f3versary_delivery_pages_status_check" CHECK ("f3versary_delivery_pages"."status" IN ('pending', 'claimed', 'sent'))
);
--> statement-breakpoint
CREATE TABLE "f3versary_delivery_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slack_space_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"processing_date" date NOT NULL,
	"target_date" date NOT NULL,
	"channel" text NOT NULL,
	"lead_days" integer NOT NULL,
	"status" varchar(16) DEFAULT 'planned' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "f3versary_delivery_runs_space_org_date_key" UNIQUE("slack_space_id","org_id","processing_date"),
	CONSTRAINT "f3versary_delivery_runs_status_check" CHECK ("f3versary_delivery_runs"."status" IN ('planned', 'complete', 'abandoned')),
	CONSTRAINT "f3versary_delivery_runs_lead_days_check" CHECK ("f3versary_delivery_runs"."lead_days" BETWEEN 0 AND 30),
	CONSTRAINT "f3versary_delivery_runs_page_count_check" CHECK ("f3versary_delivery_runs"."page_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "f3versary_announcement_settings" ADD CONSTRAINT "f3versary_announcement_settings_slack_space_id_fkey" FOREIGN KEY ("slack_space_id") REFERENCES "public"."slack_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f3versary_announcement_settings" ADD CONSTRAINT "f3versary_announcement_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f3versary_delivery_pages" ADD CONSTRAINT "f3versary_delivery_pages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."f3versary_delivery_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f3versary_delivery_runs" ADD CONSTRAINT "f3versary_delivery_runs_slack_space_id_fkey" FOREIGN KEY ("slack_space_id") REFERENCES "public"."slack_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f3versary_delivery_runs" ADD CONSTRAINT "f3versary_delivery_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_f3versary_delivery_pages_run_status_page" ON "f3versary_delivery_pages" USING btree ("run_id","status","page_number");--> statement-breakpoint
CREATE INDEX "idx_f3versary_delivery_runs_space_org_status" ON "f3versary_delivery_runs" USING btree ("slack_space_id","org_id","status","processing_date");