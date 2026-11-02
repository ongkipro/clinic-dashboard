CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid DEFAULT app_tenant_id() NOT NULL,
	"branch_id" uuid,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"aggregate_kind" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"origin_command_id" uuid,
	"staff_id" uuid DEFAULT app_staff_id(),
	"acting_role" text DEFAULT app_acting_role(),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "domain_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" ~ '^[A-Z][A-Za-z]{2,60}$'),
	CONSTRAINT "domain_events_version_check" CHECK ("domain_events"."version" between 1 and 1000 and "domain_events"."aggregate_version" >= 1),
	CONSTRAINT "domain_events_aggregate_kind_check" CHECK ("domain_events"."aggregate_kind" ~ '^[a-z][a-z_]{1,40}$'),
	CONSTRAINT "domain_events_payload_check" CHECK (jsonb_typeof("domain_events"."payload") = 'object' and octet_length("domain_events"."payload"::text) <= 4096 and public.events_payload_ok("domain_events"."payload"))
);
--> statement-breakpoint
CREATE TABLE "event_consumers" (
	"name" text PRIMARY KEY NOT NULL,
	"event_types" text[] NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	CONSTRAINT "event_consumers_name_check" CHECK ("event_consumers"."name" ~ '^[a-z][a-z0-9_.-]{2,60}$'),
	CONSTRAINT "event_consumers_types_check" CHECK (cardinality("event_consumers"."event_types") >= 1),
	CONSTRAINT "event_consumers_max_attempts_check" CHECK ("event_consumers"."max_attempts" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "event_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"claimed_by" text,
	"lease_until" timestamp with time zone DEFAULT '-infinity' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "event_receipts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "event_receipts_consumer_event_key" UNIQUE("consumer","event_id"),
	CONSTRAINT "event_receipts_consumer_check" CHECK ("event_receipts"."consumer" ~ '^[a-z][a-z0-9_.-]{2,60}$'),
	CONSTRAINT "event_receipts_claimed_by_check" CHECK ("event_receipts"."claimed_by" is null or "event_receipts"."claimed_by" ~ '^[A-Za-z0-9_.:-]{1,80}$'),
	CONSTRAINT "event_receipts_attempts_check" CHECK ("event_receipts"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_receipts" ADD CONSTRAINT "event_receipts_consumer_event_consumers_name_fk" FOREIGN KEY ("consumer") REFERENCES "public"."event_consumers"("name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_receipts" ADD CONSTRAINT "event_receipts_tenant_id_event_id_domain_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."domain_events"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_receipts_open_idx" ON "event_receipts" USING btree ("consumer","event_id") WHERE "event_receipts"."done_at" is null;