CREATE SCHEMA "slackbot";
--> statement-breakpoint
CREATE TABLE "slackbot"."f3versary_delivery_pages" (
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
	CONSTRAINT "f3versary_delivery_pages_page_number_check" CHECK ("slackbot"."f3versary_delivery_pages"."page_number" >= 1),
	CONSTRAINT "f3versary_delivery_pages_status_check" CHECK ("slackbot"."f3versary_delivery_pages"."status" IN ('pending', 'claimed', 'sent'))
);
--> statement-breakpoint
CREATE TABLE "slackbot"."f3versary_delivery_runs" (
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
	CONSTRAINT "f3versary_delivery_runs_status_check" CHECK ("slackbot"."f3versary_delivery_runs"."status" IN ('planned', 'complete', 'abandoned')),
	CONSTRAINT "f3versary_delivery_runs_lead_days_check" CHECK ("slackbot"."f3versary_delivery_runs"."lead_days" BETWEEN 0 AND 30),
	CONSTRAINT "f3versary_delivery_runs_page_count_check" CHECK ("slackbot"."f3versary_delivery_runs"."page_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "slackbot"."f3versary_delivery_pages" ADD CONSTRAINT "f3versary_delivery_pages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "slackbot"."f3versary_delivery_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slackbot"."f3versary_delivery_runs" ADD CONSTRAINT "f3versary_delivery_runs_slack_space_id_fkey" FOREIGN KEY ("slack_space_id") REFERENCES "public"."slack_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slackbot"."f3versary_delivery_runs" ADD CONSTRAINT "f3versary_delivery_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_f3versary_delivery_pages_run_status_page" ON "slackbot"."f3versary_delivery_pages" USING btree ("run_id","status","page_number");--> statement-breakpoint
CREATE INDEX "idx_f3versary_delivery_runs_space_org_status" ON "slackbot"."f3versary_delivery_runs" USING btree ("slack_space_id","org_id","status","processing_date");