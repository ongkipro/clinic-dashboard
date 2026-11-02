CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"account_id" uuid,
	"membership_id" uuid,
	"staff_id" uuid,
	"acting_role" text,
	"branch_id" uuid,
	"vendor_session_id" uuid,
	"vendor_staff_id" uuid,
	"service_identity" text,
	"correlation_id" uuid,
	"action" text NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid,
	"outcome" text NOT NULL,
	"reason_code" text,
	"reason" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "audit_events_tenant_seq_key" UNIQUE("tenant_id","seq"),
	CONSTRAINT "audit_events_action_check" CHECK ("audit_events"."action" in ('clinical_read','media_view','media_download','export','access_denied','break_glass','sign','approval','money_correction','settings_change','operator_session','context_selected')),
	CONSTRAINT "audit_events_outcome_check" CHECK ("audit_events"."outcome" in ('success','denied','error')),
	CONSTRAINT "audit_events_object_kind_check" CHECK ("audit_events"."object_kind" ~ '^[a-z][a-z_]{1,40}$'),
	CONSTRAINT "audit_events_reason_code_check" CHECK ("audit_events"."reason_code" is null or "audit_events"."reason_code" ~ '^[a-z][a-z_]{1,40}$'),
	CONSTRAINT "audit_events_service_check" CHECK ("audit_events"."service_identity" is null or "audit_events"."service_identity" ~ '^[a-z][a-z_.-]{1,60}$'),
	CONSTRAINT "audit_events_reason_check" CHECK (("audit_events"."action" = 'break_glass') = ("audit_events"."reason" is not null)
          and ("audit_events"."reason" is null or char_length("audit_events"."reason") between 15 and 500)),
	CONSTRAINT "audit_events_actor_check" CHECK (num_nonnulls("audit_events"."staff_id", "audit_events"."vendor_staff_id", "audit_events"."service_identity") >= 1),
	CONSTRAINT "audit_events_hash_check" CHECK ("audit_events"."hash" ~ '^[0-9a-f]{64}$' and "audit_events"."prev_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_auth_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_at_idx" ON "audit_events" USING btree ("tenant_id","at");