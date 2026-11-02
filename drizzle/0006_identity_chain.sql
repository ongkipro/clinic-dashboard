CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "memberships_tenant_id_account_id_key" UNIQUE("tenant_id","account_id"),
	CONSTRAINT "memberships_effective_check" CHECK ("memberships"."effective_to" is null or "memberships"."effective_to" > "memberships"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_membership_id_key" UNIQUE("membership_id"),
	CONSTRAINT "staff_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "staff_branches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_role_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_branches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_branches_role_branch_key" UNIQUE("tenant_id","staff_role_id","branch_id"),
	CONSTRAINT "staff_branches_level3_check" CHECK ("staff_branches"."role" in ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist'))
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_roles_staff_role_key" UNIQUE("tenant_id","staff_id","role"),
	CONSTRAINT "staff_roles_tenant_id_id_staff_role_key" UNIQUE("tenant_id","id","staff_id","role"),
	CONSTRAINT "staff_roles_role_check" CHECK ("staff_roles"."role" in ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor','manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist'))
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_auth_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_tenant_id_staff_role_id_staff_id_role_staff_roles_tenant_id_id_staff_id_role_fk" FOREIGN KEY ("tenant_id","staff_role_id","staff_id","role") REFERENCES "public"."staff_roles"("tenant_id","id","staff_id","role") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;