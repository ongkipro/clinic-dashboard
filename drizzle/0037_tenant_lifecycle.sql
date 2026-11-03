CREATE TABLE "tenant_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "tenant_lifecycle_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"reason" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor" text NOT NULL,
	"vendor_request_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_lifecycle_events_request_key" UNIQUE("vendor_request_id"),
	CONSTRAINT "tenant_lifecycle_events_states_check" CHECK ("tenant_lifecycle_events"."from_state" in ('provisioning','onboarding','live','suspended','exit','closed') and "tenant_lifecycle_events"."to_state" in ('provisioning','onboarding','live','suspended','exit','closed') and "tenant_lifecycle_events"."from_state" <> "tenant_lifecycle_events"."to_state"),
	CONSTRAINT "tenant_lifecycle_events_reason_check" CHECK (length(btrim("tenant_lifecycle_events"."reason")) between 10 and 500),
	CONSTRAINT "tenant_lifecycle_events_actor_check" CHECK ("tenant_lifecycle_events"."actor_kind" in ('service','vendor_staff') and "tenant_lifecycle_events"."actor" ~ '^[a-z0-9][a-z0-9_.-]{1,80}$')
);
--> statement-breakpoint
ALTER TABLE "vendor_requests" DROP CONSTRAINT "vendor_requests_kind_check";--> statement-breakpoint
ALTER TABLE "tenant_lifecycle_events" ADD CONSTRAINT "tenant_lifecycle_events_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_lifecycle_events" ADD CONSTRAINT "tenant_lifecycle_events_vendor_request_id_vendor_requests_id_fk" FOREIGN KEY ("vendor_request_id") REFERENCES "public"."vendor_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_kind_check" CHECK ("vendor_requests"."kind" in ('clinical_grant','suspension','exit','server_fee_change','invoice_waiver','dual_identity','reactivation','closure'));