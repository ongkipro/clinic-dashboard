CREATE TABLE "vendor_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "vendor_actions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_id" uuid,
	"account_id" uuid,
	"acting_role" text,
	"action" text NOT NULL,
	"tenant_id" uuid,
	"object_id" uuid,
	"outcome" text NOT NULL,
	"reason_code" text,
	"detail" text,
	"client_ip" text,
	CONSTRAINT "vendor_actions_action_check" CHECK ("vendor_actions"."action" ~ '^[a-z][a-z_]{2,60}$'),
	CONSTRAINT "vendor_actions_outcome_check" CHECK ("vendor_actions"."outcome" in ('success','denied')),
	CONSTRAINT "vendor_actions_reason_check" CHECK ("vendor_actions"."reason_code" is null or "vendor_actions"."reason_code" ~ '^[a-z][a-z_]{1,60}$'),
	CONSTRAINT "vendor_actions_detail_check" CHECK ("vendor_actions"."detail" is null or "vendor_actions"."detail" ~ '^[0-9A-Fa-f:./]{2,64}$')
);
--> statement-breakpoint
CREATE TABLE "vendor_ip_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"cidr" text NOT NULL,
	"label" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_ip_allowlist_cidr_unique" UNIQUE("cidr"),
	CONSTRAINT "vendor_ip_allowlist_label_check" CHECK (length(btrim("vendor_ip_allowlist"."label")) between 2 and 80)
);
--> statement-breakpoint
CREATE TABLE "vendor_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"kind" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"clinic_approved_by" uuid,
	"clinic_approved_account" uuid,
	"clinic_approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "vendor_requests_kind_check" CHECK ("vendor_requests"."kind" in ('clinical_grant','suspension','exit','server_fee_change','invoice_waiver','dual_identity')),
	CONSTRAINT "vendor_requests_state_check" CHECK ("vendor_requests"."state" in ('pending','approved','rejected','cancelled')),
	CONSTRAINT "vendor_requests_reason_check" CHECK (length(btrim("vendor_requests"."reason")) between 10 and 500),
	CONSTRAINT "vendor_requests_payload_check" CHECK (jsonb_typeof("vendor_requests"."payload") = 'object'),
	CONSTRAINT "vendor_requests_maker_checker_check" CHECK ("vendor_requests"."decided_by" is null or "vendor_requests"."decided_by" <> "vendor_requests"."requested_by"),
	CONSTRAINT "vendor_requests_decided_check" CHECK (("vendor_requests"."state" = 'pending') = ("vendor_requests"."decided_at" is null)),
	CONSTRAINT "vendor_requests_cancel_check" CHECK ("vendor_requests"."state" <> 'cancelled' or "vendor_requests"."decided_by" is null),
	CONSTRAINT "vendor_requests_approved_check" CHECK ("vendor_requests"."state" <> 'approved' or "vendor_requests"."decided_by" is not null),
	CONSTRAINT "vendor_requests_clinic_check" CHECK (("vendor_requests"."clinic_approved_at" is null) = ("vendor_requests"."clinic_approved_by" is null) and ("vendor_requests"."clinic_approved_at" is null) = ("vendor_requests"."clinic_approved_account" is null) and ("vendor_requests"."clinic_approved_at" is null or "vendor_requests"."kind" = 'dual_identity')),
	CONSTRAINT "vendor_requests_consumed_check" CHECK ("vendor_requests"."consumed_at" is null or "vendor_requests"."state" = 'approved' and "vendor_requests"."kind" <> 'dual_identity')
);
--> statement-breakpoint
CREATE TABLE "vendor_staff" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_changed_at" timestamp with time zone,
	CONSTRAINT "vendor_staff_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "vendor_staff_state_check" CHECK ("vendor_staff"."state" in ('active','suspended','exited')),
	CONSTRAINT "vendor_staff_name_check" CHECK (length(btrim("vendor_staff"."display_name")) between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "vendor_staff_roles" (
	"staff_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_staff_roles_key" UNIQUE("staff_id","role"),
	CONSTRAINT "vendor_staff_roles_role_check" CHECK ("vendor_staff_roles"."role" in ('platform_owner','onboarding','support','vendor_finance','vendor_auditor'))
);
--> statement-breakpoint
ALTER TABLE "vendor_actions" ADD CONSTRAINT "vendor_actions_staff_id_vendor_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_actions" ADD CONSTRAINT "vendor_actions_account_id_auth_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_actions" ADD CONSTRAINT "vendor_actions_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_requested_by_vendor_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_decided_by_vendor_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_clinic_approved_account_auth_user_id_fk" FOREIGN KEY ("clinic_approved_account") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_staff" ADD CONSTRAINT "vendor_staff_account_id_auth_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_staff_roles" ADD CONSTRAINT "vendor_staff_roles_staff_id_vendor_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;