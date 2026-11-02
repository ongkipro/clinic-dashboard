CREATE TABLE "org_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid DEFAULT app_tenant_id() NOT NULL,
	"staff_id" uuid DEFAULT app_staff_id() NOT NULL,
	"acting_role" text DEFAULT app_acting_role() NOT NULL,
	"active_branch_id" uuid,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_actions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "org_actions_action_check" CHECK ("org_actions"."action" in ('context_selected'))
);
--> statement-breakpoint
ALTER TABLE "org_actions" ADD CONSTRAINT "org_actions_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_actions" ADD CONSTRAINT "org_actions_tenant_id_active_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","active_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;