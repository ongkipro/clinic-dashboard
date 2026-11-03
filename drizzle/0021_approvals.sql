CREATE TABLE "approval_types" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"requester_roles" text[] NOT NULL,
	"approver_roles" text[] NOT NULL,
	"owner_self" boolean DEFAULT false NOT NULL,
	CONSTRAINT "approval_types_key_check" CHECK ("approval_types"."key" ~ '^[a-z][a-z_]{2,40}$'),
	CONSTRAINT "approval_types_roles_check" CHECK (cardinality("approval_types"."requester_roles") >= 1 and cardinality("approval_types"."approver_roles") >= 1),
	CONSTRAINT "approval_types_owner_self_check" CHECK (not "approval_types"."owner_self" or 'owner' = any("approval_types"."approver_roles"))
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"type" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_reason" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_as" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"owner_self" boolean DEFAULT false NOT NULL,
	"amount_rupiah" bigint,
	CONSTRAINT "approvals_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "approvals_amount_check" CHECK ("approvals"."amount_rupiah" is null or "approvals"."amount_rupiah" >= 0),
	CONSTRAINT "approvals_subject_kind_check" CHECK ("approvals"."subject_kind" ~ '^[a-z][a-z_]{1,40}$'),
	CONSTRAINT "approvals_state_check" CHECK ("approvals"."state" in ('pending','approved','rejected','cancelled')),
	CONSTRAINT "approvals_decision_check" CHECK (("approvals"."state" = 'pending') = ("approvals"."decided_by" is null and "approvals"."decided_at" is null and "approvals"."decided_as" is null)),
	CONSTRAINT "approvals_maker_checker_check" CHECK ("approvals"."decided_by" is null or "approvals"."decided_by" <> "approvals"."requested_by" or "approvals"."state" = 'cancelled'
          or ("approvals"."owner_self" and "approvals"."requested_as" = 'owner' and "approvals"."decided_as" = 'owner' and length(btrim("approvals"."decision_reason")) >= 10)),
	CONSTRAINT "approvals_reason_length_check" CHECK (coalesce(length("approvals"."request_reason"), 0) <= 500 and coalesce(length("approvals"."decision_reason"), 0) <= 500)
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_type_approval_types_key_fk" FOREIGN KEY ("type") REFERENCES "public"."approval_types"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_requested_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_decided_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_per_subject" ON "approvals" USING btree ("tenant_id","type","subject_kind","subject_id") WHERE "approvals"."state" in ('pending','approved');--> statement-breakpoint
CREATE INDEX "approvals_pending_idx" ON "approvals" USING btree ("tenant_id","type") WHERE "approvals"."state" = 'pending';