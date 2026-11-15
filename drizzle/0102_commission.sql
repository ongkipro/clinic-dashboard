CREATE TABLE "commission_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"cause" text NOT NULL,
	"fact_kind" text NOT NULL,
	"fact_id" uuid NOT NULL,
	"after_payout" boolean NOT NULL,
	"adjusted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_adjustments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "commission_adjustments_fact_key" UNIQUE("tenant_id","entitlement_id","fact_kind","fact_id"),
	CONSTRAINT "commission_adjustments_check" CHECK ("commission_adjustments"."amount" between -1000000000000 and -1 and "commission_adjustments"."cause" in ('refund','interrupted','package_close','substitution','write_off','attribution')
      and "commission_adjustments"."fact_kind" in ('refund','invoice_line','package','package_session','write_off','attribution'))
);
--> statement-breakpoint
CREATE TABLE "commission_contributions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"contribution_type" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"sale_at" timestamp with time zone NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_contributions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "commission_contributions_one" UNIQUE("tenant_id","staff_id","contribution_type","source_kind","source_id"),
	CONSTRAINT "commission_contributions_check" CHECK ("commission_contributions"."contribution_type" in ('closing_bc','guiding_bc','new_patient','performer') and "commission_contributions"."source_kind" in ('invoice_line','treatment_execution','examination')
      and (("commission_contributions"."contribution_type" = 'performer') = ("commission_contributions"."source_kind" <> 'invoice_line'))
      and ("commission_contributions"."source_kind" <> 'invoice_line' or "commission_contributions"."source_id" = "commission_contributions"."invoice_line_id"))
);
--> statement-breakpoint
CREATE TABLE "commission_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"contribution_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"basis" bigint NOT NULL,
	"fact_kind" text NOT NULL,
	"fact_id" uuid NOT NULL,
	"accrued_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_entitlements_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "commission_entitlements_fact_key" UNIQUE("tenant_id","contribution_id","fact_kind","fact_id"),
	CONSTRAINT "commission_entitlements_check" CHECK ("commission_entitlements"."amount" between 0 and 1000000000000 and "commission_entitlements"."basis" >= 0
      and "commission_entitlements"."fact_kind" in ('allocation','deposit','collection','execution','session','examination','attribution'))
);
--> statement-breakpoint
CREATE TABLE "commission_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"basis_points" integer,
	"fixed_amount" bigint,
	"effective_from" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"prepared_by" uuid NOT NULL,
	"prepared_as" text NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"activated_by" uuid,
	"activated_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"command_key" text NOT NULL,
	CONSTRAINT "commission_rule_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "commission_rule_versions_version_key" UNIQUE("tenant_id","rule_id","version"),
	CONSTRAINT "commission_rule_versions_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "commission_rule_versions_check" CHECK ("commission_rule_versions"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "commission_rule_versions"."version" >= 1 and "commission_rule_versions"."state" in ('draft','active','superseded','cancelled')
      and (("commission_rule_versions"."kind" = 'percent') = ("commission_rule_versions"."basis_points" is not null)) and (("commission_rule_versions"."kind" = 'fixed') = ("commission_rule_versions"."fixed_amount" is not null))
      and ("commission_rule_versions"."basis_points" is null or "commission_rule_versions"."basis_points" between 1 and 10000) and ("commission_rule_versions"."fixed_amount" is null or "commission_rule_versions"."fixed_amount" between 1 and 1000000000000)
      and "commission_rule_versions"."prepared_as" in ('owner','finance') and (("commission_rule_versions"."state" in ('active','superseded')) = ("commission_rule_versions"."activated_at" is not null))
      and (("commission_rule_versions"."state" in ('superseded','cancelled')) = ("commission_rule_versions"."ended_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contribution_type" text NOT NULL,
	"role" text,
	"staff_id" uuid,
	"catalog_item_id" uuid,
	"category" text,
	"priority" smallint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"command_key" text NOT NULL,
	CONSTRAINT "commission_rules_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "commission_rules_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "commission_rules_check" CHECK ("commission_rules"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "commission_rules"."priority" between -100 and 100 and length(btrim("commission_rules"."name")) between 2 and 80
      and ("commission_rules"."catalog_item_id" is null or "commission_rules"."category" is null) and "commission_rules"."created_as" in ('owner','finance')
      and ("commission_rules"."staff_id" is null or "commission_rules"."role" is null))
);
--> statement-breakpoint
CREATE TABLE "commission_sale_attributions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"closing_bc_staff_id" uuid,
	"guiding_bc_staff_id" uuid,
	"state" text NOT NULL,
	"source" text NOT NULL,
	"approval_id" uuid,
	"reason" text,
	"attributed_by" uuid,
	"attributed_as" text,
	"attributed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"ended_at" timestamp with time zone,
	"command_key" text,
	CONSTRAINT "commission_sale_attributions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "commission_sale_attributions_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "commission_sale_attributions_check" CHECK ("commission_sale_attributions"."state" in ('pending_approval','active','superseded','rejected') and "commission_sale_attributions"."source" in ('selection','command','correction')
      and ("commission_sale_attributions"."command_key" is null or "commission_sale_attributions"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$') and ("commission_sale_attributions"."reason" is null or length(btrim("commission_sale_attributions"."reason")) between 3 and 500)
      and ("commission_sale_attributions"."state" <> 'pending_approval' or "commission_sale_attributions"."approval_id" is not null) and ("commission_sale_attributions"."source" <> 'correction' or "commission_sale_attributions"."approval_id" is not null)
      and (("commission_sale_attributions"."state" in ('superseded','rejected')) = ("commission_sale_attributions"."ended_at" is not null))
      and ("commission_sale_attributions"."source" = 'selection' or "commission_sale_attributions"."attributed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "guiding_bc_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"care_plan_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"state" text NOT NULL,
	"source" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"approval_id" uuid,
	"reason" text,
	"assigned_by" uuid,
	"assigned_as" text,
	"assigned_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"command_key" text,
	CONSTRAINT "guiding_bc_assignments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "guiding_bc_assignments_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "guiding_bc_assignments_check" CHECK ("guiding_bc_assignments"."state" in ('pending_approval','active','superseded','rejected') and "guiding_bc_assignments"."source" in ('selection','command','correction')
      and ("guiding_bc_assignments"."command_key" is null or "guiding_bc_assignments"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$') and ("guiding_bc_assignments"."reason" is null or length(btrim("guiding_bc_assignments"."reason")) between 3 and 500)
      and ("guiding_bc_assignments"."effective_to" is null or "guiding_bc_assignments"."effective_to" >= "guiding_bc_assignments"."effective_from") and ("guiding_bc_assignments"."source" = 'selection' or "guiding_bc_assignments"."assigned_by" is not null)
      and ("guiding_bc_assignments"."state" <> 'pending_approval' or "guiding_bc_assignments"."approval_id" is not null) and ("guiding_bc_assignments"."source" <> 'correction' or "guiding_bc_assignments"."approval_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "payout_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"entitlement_id" uuid,
	"adjustment_id" uuid,
	"amount" bigint NOT NULL,
	CONSTRAINT "payout_batch_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payout_batch_items_entitlement_key" UNIQUE("tenant_id","entitlement_id"),
	CONSTRAINT "payout_batch_items_adjustment_key" UNIQUE("tenant_id","adjustment_id"),
	CONSTRAINT "payout_batch_items_check" CHECK (num_nonnulls("payout_batch_items"."entitlement_id", "payout_batch_items"."adjustment_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "payout_batch_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"gross" bigint NOT NULL,
	"adjustments" bigint NOT NULL,
	"carry_forward_in" bigint NOT NULL,
	"net_payable" bigint NOT NULL,
	"carry_forward_out" bigint NOT NULL,
	CONSTRAINT "payout_batch_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payout_batch_lines_staff_key" UNIQUE("tenant_id","batch_id","staff_id"),
	CONSTRAINT "payout_batch_lines_check" CHECK ("payout_batch_lines"."gross" >= 0 and "payout_batch_lines"."adjustments" <= 0 and "payout_batch_lines"."carry_forward_in" >= 0 and "payout_batch_lines"."net_payable" >= 0 and "payout_batch_lines"."carry_forward_out" >= 0
      and "payout_batch_lines"."net_payable" - "payout_batch_lines"."carry_forward_out" = "payout_batch_lines"."gross" + "payout_batch_lines"."adjustments" - "payout_batch_lines"."carry_forward_in"
      and ("payout_batch_lines"."net_payable" = 0 or "payout_batch_lines"."carry_forward_out" = 0))
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"closing_day" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"approval_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"paid_method" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"command_key" text NOT NULL,
	CONSTRAINT "payout_batches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payout_batches_period_key" UNIQUE("tenant_id","period_key"),
	CONSTRAINT "payout_batches_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "payout_batches_check" CHECK ("payout_batches"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "payout_batches"."period_key" ~ '^\d{4}-\d{2}$' and "payout_batches"."period_end" > "payout_batches"."period_start"
      and "payout_batches"."state" in ('draft','pending_approval','approved','paid') and (("payout_batches"."state" = 'draft') = ("payout_batches"."submitted_at" is null))
      and (("payout_batches"."state" = 'paid') = ("payout_batches"."paid_at" is not null)) and ("payout_batches"."paid_method" is null or "payout_batches"."paid_method" in ('cash','transfer'))
      and ("payout_batches"."state" = 'draft' or "payout_batches"."approval_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "staff_commission_receivables" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"source_batch_line_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"decision_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "staff_commission_receivables_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_commission_receivables_line_key" UNIQUE("tenant_id","source_batch_line_id"),
	CONSTRAINT "staff_commission_receivables_check" CHECK ("staff_commission_receivables"."amount" between 1 and 1000000000000 and "staff_commission_receivables"."state" in ('open','settled','waived')
      and (("staff_commission_receivables"."state" = 'open') = ("staff_commission_receivables"."decided_at" is null)) and ("staff_commission_receivables"."state" = 'open' or length(btrim("staff_commission_receivables"."decision_reason")) between 3 and 500))
);
--> statement-breakpoint
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_entitlement_fk" FOREIGN KEY ("tenant_id","entitlement_id") REFERENCES "public"."commission_entitlements"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_contributions" ADD CONSTRAINT "commission_contributions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_contributions" ADD CONSTRAINT "commission_contributions_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_contributions" ADD CONSTRAINT "commission_contributions_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_contributions" ADD CONSTRAINT "commission_contributions_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_contributions" ADD CONSTRAINT "commission_contributions_rule_fk" FOREIGN KEY ("tenant_id","rule_version_id") REFERENCES "public"."commission_rule_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entitlements" ADD CONSTRAINT "commission_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entitlements" ADD CONSTRAINT "commission_entitlements_contribution_fk" FOREIGN KEY ("tenant_id","contribution_id") REFERENCES "public"."commission_contributions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entitlements" ADD CONSTRAINT "commission_entitlements_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_versions" ADD CONSTRAINT "commission_rule_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_versions" ADD CONSTRAINT "commission_rule_versions_rule_fk" FOREIGN KEY ("tenant_id","rule_id") REFERENCES "public"."commission_rules"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_versions" ADD CONSTRAINT "commission_rule_versions_prepared_by_fk" FOREIGN KEY ("tenant_id","prepared_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_versions" ADD CONSTRAINT "commission_rule_versions_activated_by_fk" FOREIGN KEY ("tenant_id","activated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_item_fk" FOREIGN KEY ("tenant_id","catalog_item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_sale_attributions" ADD CONSTRAINT "commission_sale_attributions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_sale_attributions" ADD CONSTRAINT "commission_sale_attributions_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_sale_attributions" ADD CONSTRAINT "commission_sale_attributions_closing_fk" FOREIGN KEY ("tenant_id","closing_bc_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_sale_attributions" ADD CONSTRAINT "commission_sale_attributions_guiding_fk" FOREIGN KEY ("tenant_id","guiding_bc_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_sale_attributions" ADD CONSTRAINT "commission_sale_attributions_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_sale_attributions" ADD CONSTRAINT "commission_sale_attributions_by_fk" FOREIGN KEY ("tenant_id","attributed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guiding_bc_assignments" ADD CONSTRAINT "guiding_bc_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guiding_bc_assignments" ADD CONSTRAINT "guiding_bc_assignments_plan_fk" FOREIGN KEY ("tenant_id","care_plan_id") REFERENCES "public"."care_plans"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guiding_bc_assignments" ADD CONSTRAINT "guiding_bc_assignments_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guiding_bc_assignments" ADD CONSTRAINT "guiding_bc_assignments_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guiding_bc_assignments" ADD CONSTRAINT "guiding_bc_assignments_by_fk" FOREIGN KEY ("tenant_id","assigned_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch_items" ADD CONSTRAINT "payout_batch_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch_items" ADD CONSTRAINT "payout_batch_items_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."payout_batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch_items" ADD CONSTRAINT "payout_batch_items_entitlement_fk" FOREIGN KEY ("tenant_id","entitlement_id") REFERENCES "public"."commission_entitlements"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch_items" ADD CONSTRAINT "payout_batch_items_adjustment_fk" FOREIGN KEY ("tenant_id","adjustment_id") REFERENCES "public"."commission_adjustments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch_lines" ADD CONSTRAINT "payout_batch_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch_lines" ADD CONSTRAINT "payout_batch_lines_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."payout_batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch_lines" ADD CONSTRAINT "payout_batch_lines_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_paid_by_fk" FOREIGN KEY ("tenant_id","paid_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_commission_receivables" ADD CONSTRAINT "staff_commission_receivables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_commission_receivables" ADD CONSTRAINT "staff_commission_receivables_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_commission_receivables" ADD CONSTRAINT "staff_commission_receivables_line_fk" FOREIGN KEY ("tenant_id","source_batch_line_id") REFERENCES "public"."payout_batch_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_commission_receivables" ADD CONSTRAINT "staff_commission_receivables_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_adjustments_staff_idx" ON "commission_adjustments" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE INDEX "commission_contributions_line_idx" ON "commission_contributions" USING btree ("tenant_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "commission_entitlements_staff_idx" ON "commission_entitlements" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_sale_attributions_one_active" ON "commission_sale_attributions" USING btree ("tenant_id","invoice_id") WHERE "commission_sale_attributions"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "commission_sale_attributions_one_pending" ON "commission_sale_attributions" USING btree ("tenant_id","invoice_id") WHERE "commission_sale_attributions"."state" = 'pending_approval';--> statement-breakpoint
CREATE UNIQUE INDEX "guiding_bc_assignments_one_active" ON "guiding_bc_assignments" USING btree ("tenant_id","care_plan_id") WHERE "guiding_bc_assignments"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "guiding_bc_assignments_one_pending" ON "guiding_bc_assignments" USING btree ("tenant_id","care_plan_id") WHERE "guiding_bc_assignments"."state" = 'pending_approval';--> statement-breakpoint
CREATE INDEX "payout_batch_items_batch_idx" ON "payout_batch_items" USING btree ("tenant_id","batch_id","staff_id");--> statement-breakpoint

-- T-087 rules (generated by gen.py; plan docs/tasks/T-087.md)
-- ── T-087 stage (a): readers' predicates, rule resolution, attribution (plan §6; r1 P1-1, P1-2, P2-2; r2 P2-1) ──

-- Commission readers (r1 P2-3): owner, finance, auditor tenant-wide; a recipient sees only its own rows; Admin Pusat none (PR-63).
CREATE FUNCTION public.commission_readable(p_tenant uuid, p_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
    public.app_role_in(ARRAY['owner','finance','auditor']) OR p_staff = public.app_staff_id()), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Rules are read by owner, finance, manager and auditor (07:56; 19:155 manager views).
CREATE FUNCTION public.commission_rules_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_role_in(ARRAY['owner','finance','manager','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rules_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_rules_readable(uuid) TO clinic_app;--> statement-breakpoint

-- The contribution types an item may earn (r1 P2-2): the version's commission_scope when set, else the kind's standard scopes (service:
-- all four; product and package: the sales scopes).
CREATE FUNCTION public.commission_item_scopes(p_tenant uuid, p_version uuid) RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN cardinality(cv.commission_scope) > 0 THEN cv.commission_scope
              WHEN ci.kind = 'service' THEN ARRAY['closing_bc','guiding_bc','new_patient','performer']
              ELSE ARRAY['closing_bc','guiding_bc','new_patient'] END
    FROM public.catalog_versions cv JOIN public.catalog_items ci ON ci.tenant_id = cv.tenant_id AND ci.id = cv.item_id
   WHERE cv.tenant_id = p_tenant AND cv.id = p_version
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_item_scopes(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The rule version that applies to a contributor at the sale instant (r1 P1-2, P2-2): only versions active or superseded whose window
-- covers p_at (effective_from ≤ p_at < ended_at); an individual override of the contributor replaces every role default; then item, then
-- category, then rule-wide; then priority; then the newest version. A consultation line (r1 P1-4) matches only a rule scoped to the
-- consultation category or item. NULL when none applies (no commission).
CREATE FUNCTION public.commission_rule_at(p_tenant uuid, p_type text, p_staff uuid, p_role text, p_item uuid, p_category text,
  p_consultation boolean, p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT v.id FROM public.commission_rules r
    JOIN public.commission_rule_versions v ON v.tenant_id = r.tenant_id AND v.rule_id = r.id
   WHERE r.tenant_id = p_tenant AND r.contribution_type = p_type
     AND v.state IN ('active','superseded') AND v.effective_from <= p_at AND (v.ended_at IS NULL OR v.ended_at > p_at)
     AND (r.staff_id = p_staff OR r.staff_id IS NULL AND (r.role IS NULL OR r.role = p_role))
     AND (r.catalog_item_id IS NULL OR r.catalog_item_id = p_item)
     AND (r.category IS NULL OR r.category = p_category)
     AND (NOT p_consultation OR r.catalog_item_id = p_item OR r.category = 'consultation')
   ORDER BY (r.staff_id IS NOT NULL) DESC, (r.catalog_item_id IS NOT NULL) DESC, (r.category IS NOT NULL) DESC, r.priority DESC, v.version DESC, v.id DESC
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rule_at(uuid, text, uuid, text, uuid, text, boolean, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- The acting role a contributor earns under: the role it held for the contribution (the BC role for BC types, the performer's role for
-- performer, the registrar's role for new patient), read from its staff roles (one staff identity, a role set; B-19). The first
-- matching role in a fixed order keeps it deterministic.
CREATE FUNCTION public.commission_staff_role(p_tenant uuid, p_staff uuid, p_type text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT r.role FROM public.staff_roles r
   WHERE r.tenant_id = p_tenant AND r.staff_id = p_staff AND r.role <> 'owner'
   ORDER BY CASE WHEN p_type IN ('closing_bc','guiding_bc') AND r.role = 'bc' THEN 0
                 WHEN p_type = 'performer' AND r.role IN ('doctor','nurse','therapist') THEN 0
                 WHEN p_type = 'new_patient' AND r.role IN ('fo_cashier','central_cs','bc') THEN 0 ELSE 1 END, r.role
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_staff_role(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- The open guiding assignment of the patient's active care plan at an instant (r1 P1-1): the canonical patient's cluster; the newest
-- plan when several are active.
CREATE FUNCTION public.commission_guiding_at(p_tenant uuid, p_patient uuid, p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT g.staff_id FROM public.guiding_bc_assignments g
    JOIN public.care_plans cp ON cp.tenant_id = g.tenant_id AND cp.id = g.care_plan_id
   WHERE g.tenant_id = p_tenant AND g.state IN ('active','superseded') AND cp.patient_id = ANY (public.patient_cluster(p_tenant, public.patient_canonical(p_tenant, p_patient)))
     AND g.effective_from <= p_at AND (g.effective_to IS NULL OR g.effective_to > p_at)
   ORDER BY cp.created_at DESC, g.effective_from DESC
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_guiding_at(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Guards: rules and versions — identity frozen; a version's value frozen; only draft → active|cancelled and active → superseded; no delete.
CREATE FUNCTION public.commission_rules_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'commission rules are insert-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rules_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER commission_rules_guard BEFORE INSERT OR UPDATE OR DELETE ON public.commission_rules FOR EACH ROW EXECUTE FUNCTION public.commission_rules_guard();--> statement-breakpoint
ALTER TABLE public.commission_rules ENABLE ALWAYS TRIGGER commission_rules_guard;--> statement-breakpoint

CREATE FUNCTION public.commission_rule_versions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commission rule versions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'a rule version is prepared as a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.rule_id, NEW.version, NEW.kind, NEW.basis_points, NEW.fixed_amount, NEW.effective_from, NEW.prepared_by,
      NEW.prepared_as, NEW.prepared_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.rule_id, OLD.version, OLD.kind, OLD.basis_points, OLD.fixed_amount, OLD.effective_from,
      OLD.prepared_by, OLD.prepared_as, OLD.prepared_at, OLD.command_key)
     OR NOT (OLD.state = 'draft' AND NEW.state IN ('active','cancelled') OR OLD.state = 'active' AND NEW.state = 'superseded') THEN
    RAISE EXCEPTION 'a rule version keeps its value; draft → active|cancelled, active → superseded' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rule_versions_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER commission_rule_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.commission_rule_versions FOR EACH ROW EXECUTE FUNCTION public.commission_rule_versions_guard();--> statement-breakpoint
ALTER TABLE public.commission_rule_versions ENABLE ALWAYS TRIGGER commission_rule_versions_guard;--> statement-breakpoint

-- The rule actor: the lock first; owner (activate) or finance (prepare); configuration capability.
CREATE FUNCTION public.commission_rule_actor(p_roles text[], OUT tenant_id uuid, OUT staff_id uuid, OUT role text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role INTO tenant_id, staff_id, role FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not change commission rules' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rule_actor(text[]) FROM PUBLIC;--> statement-breakpoint

-- Aturan Komisi: a new rule with its first draft version (owner or finance prepare). p: {contribution_type, role?, staff_id?,
-- catalog_item_id?, category?, priority?, name, kind, basis_points | fixed_amount, effective_from}.
CREATE FUNCTION public.commission_rule_create(p_key text, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_rule_actor(ARRAY['owner','finance']);
  v_rule uuid;
  v_version uuid;
BEGIN
  SELECT r.id INTO v_rule FROM public.commission_rules r WHERE r.tenant_id = a.tenant_id AND r.command_key = p_key;
  IF v_rule IS NOT NULL THEN
    SELECT v.id INTO v_version FROM public.commission_rule_versions v WHERE v.tenant_id = a.tenant_id AND v.rule_id = v_rule AND v.version = 1;
    RETURN jsonb_build_object('rule_id', v_rule, 'version_id', v_version);
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'contribution_type' - 'role' - 'staff_id' - 'catalog_item_id' - 'category' - 'priority' - 'name' - 'kind' - 'basis_points'
          - 'fixed_amount' - 'effective_from' <> '{}'::jsonb
     OR coalesce(p ->> 'contribution_type', '') NOT IN ('closing_bc','guiding_bc','new_patient','performer')
     OR coalesce(p ->> 'kind', '') NOT IN ('percent','fixed') OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$'
     OR p ? 'role' AND (p ->> 'role') = 'owner' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: rule' USING ERRCODE = '22023';
  END IF;
  IF p ? 'staff_id' AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.tenant_id = a.tenant_id AND s.id = (p ->> 'staff_id')::uuid) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF p ? 'catalog_item_id' AND NOT EXISTS (SELECT 1 FROM public.catalog_items ci WHERE ci.tenant_id = a.tenant_id AND ci.id = (p ->> 'catalog_item_id')::uuid) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: item not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.commission_rules (tenant_id, contribution_type, role, staff_id, catalog_item_id, category, priority, name, created_by, created_as, command_key)
  VALUES (a.tenant_id, p ->> 'contribution_type', p ->> 'role', (p ->> 'staff_id')::uuid, (p ->> 'catalog_item_id')::uuid, p ->> 'category',
          coalesce((p ->> 'priority')::smallint, 0), btrim(p ->> 'name'), a.staff_id, a.role, p_key)
  RETURNING id INTO v_rule;
  INSERT INTO public.commission_rule_versions (tenant_id, rule_id, version, kind, basis_points, fixed_amount, effective_from, prepared_by, prepared_as, command_key)
  VALUES (a.tenant_id, v_rule, 1, p ->> 'kind', (p ->> 'basis_points')::integer, (p ->> 'fixed_amount')::bigint,
          coalesce((p ->> 'effective_from')::timestamptz, clock_timestamp()), a.staff_id, a.role, 'v1:' || p_key)
  RETURNING id INTO v_version;
  PERFORM public.audit_append('settings_change', 'commission_rule', v_rule, 'success', 'commission_rule_prepared');
  RETURN jsonb_build_object('rule_id', v_rule, 'version_id', v_version);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: rule' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rule_create(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_rule_create(text, jsonb) TO clinic_app;--> statement-breakpoint

-- A new draft version of an existing rule (owner or finance prepare). p: {kind, basis_points | fixed_amount, effective_from}.
CREATE FUNCTION public.commission_rule_version(p_key text, p_rule uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_rule_actor(ARRAY['owner','finance']);
  v_id uuid;
BEGIN
  SELECT v.id INTO v_id FROM public.commission_rule_versions v WHERE v.tenant_id = a.tenant_id AND v.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commission_rules r WHERE r.tenant_id = a.tenant_id AND r.id = p_rule) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: rule not found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'kind' - 'basis_points' - 'fixed_amount' - 'effective_from' <> '{}'::jsonb
     OR coalesce(p ->> 'kind', '') NOT IN ('percent','fixed') OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: rule' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.commission_rule_versions (tenant_id, rule_id, version, kind, basis_points, fixed_amount, effective_from, prepared_by, prepared_as, command_key)
  SELECT a.tenant_id, p_rule, coalesce(max(v.version), 0) + 1, p ->> 'kind', (p ->> 'basis_points')::integer, (p ->> 'fixed_amount')::bigint,
         coalesce((p ->> 'effective_from')::timestamptz, clock_timestamp()), a.staff_id, a.role, p_key
    FROM public.commission_rule_versions v WHERE v.tenant_id = a.tenant_id AND v.rule_id = p_rule
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'commission_rule', p_rule, 'success', 'commission_rule_prepared');
  RETURN v_id;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: rule' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rule_version(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_rule_version(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- The owner activates a draft (r1 P2-2): the rule's active version (if any) is superseded at the new version's effective_from; or cancels a
-- draft. p_action: 'activate' | 'cancel'.
CREATE FUNCTION public.commission_rule_decide(p_version uuid, p_action text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_rule_actor(ARRAY['owner']);
  v public.commission_rule_versions;
BEGIN
  SELECT * INTO v FROM public.commission_rule_versions x WHERE x.tenant_id = a.tenant_id AND x.id = p_version FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: rule version not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_draft' USING ERRCODE = '55000';
  END IF;
  IF p_action = 'cancel' THEN
    UPDATE public.commission_rule_versions SET state = 'cancelled', ended_at = clock_timestamp() WHERE tenant_id = v.tenant_id AND id = v.id;
  ELSIF p_action = 'activate' THEN
    UPDATE public.commission_rule_versions SET state = 'superseded', ended_at = greatest(v.effective_from, effective_from)
     WHERE tenant_id = v.tenant_id AND rule_id = v.rule_id AND state = 'active';
    UPDATE public.commission_rule_versions SET state = 'active', activated_by = a.staff_id, activated_at = clock_timestamp()
     WHERE tenant_id = v.tenant_id AND id = v.id;
  ELSE
    RAISE EXCEPTION 'ERR_INVALID_INPUT: action' USING ERRCODE = '22023';
  END IF;
  PERFORM public.audit_append('settings_change', 'commission_rule', v.rule_id, 'success', 'commission_rule_' || p_action);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rule_decide(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_rule_decide(uuid, text) TO clinic_app;--> statement-breakpoint

ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY commission_rules_read ON public.commission_rules FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_rules_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.commission_rules TO clinic_app;--> statement-breakpoint
CREATE POLICY commission_rules_operator_read ON public.commission_rules FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.commission_rules', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.commission_rules TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER commission_rules_no_truncate BEFORE TRUNCATE ON public.commission_rules FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.commission_rules ENABLE ALWAYS TRIGGER commission_rules_no_truncate;--> statement-breakpoint
ALTER TABLE public.commission_rule_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY commission_rule_versions_read ON public.commission_rule_versions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_rules_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.commission_rule_versions TO clinic_app;--> statement-breakpoint
CREATE POLICY commission_rule_versions_operator_read ON public.commission_rule_versions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.commission_rule_versions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.commission_rule_versions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER commission_rule_versions_no_truncate BEFORE TRUNCATE ON public.commission_rule_versions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.commission_rule_versions ENABLE ALWAYS TRIGGER commission_rule_versions_no_truncate;--> statement-breakpoint
ALTER TABLE public.commission_sale_attributions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY commission_sale_attributions_read ON public.commission_sale_attributions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND (public.commission_readable(tenant_id, closing_bc_staff_id) OR public.commission_readable(tenant_id, guiding_bc_staff_id)));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, invoice_id, closing_bc_staff_id, guiding_bc_staff_id, state, source, approval_id, attributed_by, attributed_as, attributed_at, ended_at, command_key) ON public.commission_sale_attributions TO clinic_app;--> statement-breakpoint
CREATE POLICY commission_sale_attributions_operator_read ON public.commission_sale_attributions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.commission_sale_attributions', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, invoice_id, closing_bc_staff_id, guiding_bc_staff_id, state, source, approval_id, attributed_by, attributed_as, attributed_at, ended_at, command_key) ON public.commission_sale_attributions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER commission_sale_attributions_no_truncate BEFORE TRUNCATE ON public.commission_sale_attributions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.commission_sale_attributions ENABLE ALWAYS TRIGGER commission_sale_attributions_no_truncate;--> statement-breakpoint
ALTER TABLE public.guiding_bc_assignments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY guiding_bc_assignments_read ON public.guiding_bc_assignments FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_readable(tenant_id, staff_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, care_plan_id, staff_id, state, source, effective_from, effective_to, approval_id, assigned_by, assigned_as, assigned_at, command_key) ON public.guiding_bc_assignments TO clinic_app;--> statement-breakpoint
CREATE POLICY guiding_bc_assignments_operator_read ON public.guiding_bc_assignments FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.guiding_bc_assignments', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, care_plan_id, staff_id, state, source, effective_from, effective_to, approval_id, assigned_by, assigned_as, assigned_at, command_key) ON public.guiding_bc_assignments TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER guiding_bc_assignments_no_truncate BEFORE TRUNCATE ON public.guiding_bc_assignments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.guiding_bc_assignments ENABLE ALWAYS TRIGGER guiding_bc_assignments_no_truncate;--> statement-breakpoint
ALTER TABLE public.commission_contributions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY commission_contributions_read ON public.commission_contributions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_readable(tenant_id, staff_id));--> statement-breakpoint
GRANT SELECT ON public.commission_contributions TO clinic_app;--> statement-breakpoint
CREATE POLICY commission_contributions_operator_read ON public.commission_contributions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.commission_contributions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.commission_contributions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER commission_contributions_no_truncate BEFORE TRUNCATE ON public.commission_contributions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.commission_contributions ENABLE ALWAYS TRIGGER commission_contributions_no_truncate;--> statement-breakpoint
ALTER TABLE public.commission_entitlements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY commission_entitlements_read ON public.commission_entitlements FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_readable(tenant_id, staff_id));--> statement-breakpoint
GRANT SELECT ON public.commission_entitlements TO clinic_app;--> statement-breakpoint
CREATE POLICY commission_entitlements_operator_read ON public.commission_entitlements FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.commission_entitlements', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.commission_entitlements TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER commission_entitlements_no_truncate BEFORE TRUNCATE ON public.commission_entitlements FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.commission_entitlements ENABLE ALWAYS TRIGGER commission_entitlements_no_truncate;--> statement-breakpoint
ALTER TABLE public.commission_adjustments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY commission_adjustments_read ON public.commission_adjustments FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_readable(tenant_id, staff_id));--> statement-breakpoint
GRANT SELECT ON public.commission_adjustments TO clinic_app;--> statement-breakpoint
CREATE POLICY commission_adjustments_operator_read ON public.commission_adjustments FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.commission_adjustments', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.commission_adjustments TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER commission_adjustments_no_truncate BEFORE TRUNCATE ON public.commission_adjustments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.commission_adjustments ENABLE ALWAYS TRIGGER commission_adjustments_no_truncate;--> statement-breakpoint
ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payout_batches_read ON public.payout_batches FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND (public.commission_readable(tenant_id, NULL) OR EXISTS (SELECT 1 FROM public.payout_batch_lines l WHERE l.tenant_id = payout_batches.tenant_id AND l.batch_id = payout_batches.id AND l.staff_id = public.app_staff_id() AND public.commission_readable(l.tenant_id, l.staff_id))));--> statement-breakpoint
GRANT SELECT ON public.payout_batches TO clinic_app;--> statement-breakpoint
CREATE POLICY payout_batches_operator_read ON public.payout_batches FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payout_batches', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payout_batches TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payout_batches_no_truncate BEFORE TRUNCATE ON public.payout_batches FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payout_batches ENABLE ALWAYS TRIGGER payout_batches_no_truncate;--> statement-breakpoint
ALTER TABLE public.payout_batch_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payout_batch_items_read ON public.payout_batch_items FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_readable(tenant_id, staff_id));--> statement-breakpoint
GRANT SELECT ON public.payout_batch_items TO clinic_app;--> statement-breakpoint
CREATE POLICY payout_batch_items_operator_read ON public.payout_batch_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payout_batch_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payout_batch_items TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payout_batch_items_no_truncate BEFORE TRUNCATE ON public.payout_batch_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payout_batch_items ENABLE ALWAYS TRIGGER payout_batch_items_no_truncate;--> statement-breakpoint
ALTER TABLE public.payout_batch_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payout_batch_lines_read ON public.payout_batch_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_readable(tenant_id, staff_id));--> statement-breakpoint
GRANT SELECT ON public.payout_batch_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY payout_batch_lines_operator_read ON public.payout_batch_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payout_batch_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payout_batch_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payout_batch_lines_no_truncate BEFORE TRUNCATE ON public.payout_batch_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payout_batch_lines ENABLE ALWAYS TRIGGER payout_batch_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.staff_commission_receivables ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_commission_receivables_read ON public.staff_commission_receivables FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.commission_readable(tenant_id, staff_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, staff_id, source_batch_line_id, amount, state, decided_by, decided_at, created_at) ON public.staff_commission_receivables TO clinic_app;--> statement-breakpoint
CREATE POLICY staff_commission_receivables_operator_read ON public.staff_commission_receivables FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_commission_receivables', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, staff_id, source_batch_line_id, amount, state, decided_by, decided_at, created_at) ON public.staff_commission_receivables TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER staff_commission_receivables_no_truncate BEFORE TRUNCATE ON public.staff_commission_receivables FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.staff_commission_receivables ENABLE ALWAYS TRIGGER staff_commission_receivables_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.commission_rules', 'tenant-shared', 'commission', '{owner,finance,manager,auditor}', 'commission definers (src/modules/commission)', 'none (tenant configuration)'),
  ('public.commission_rule_versions', 'tenant-shared', 'commission', '{owner,finance,manager,auditor}', 'commission definers (src/modules/commission)', 'none (tenant configuration)'),
  ('public.commission_sale_attributions', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)'),
  ('public.guiding_bc_assignments', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)'),
  ('public.commission_contributions', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)'),
  ('public.commission_entitlements', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)'),
  ('public.commission_adjustments', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)'),
  ('public.payout_batches', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)'),
  ('public.payout_batch_items', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)'),
  ('public.payout_batch_lines', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)'),
  ('public.staff_commission_receivables', 'tenant-ledger', 'commission', '{owner,finance,auditor,manager,bc,doctor,nurse,therapist,fo_cashier,central_cs,pharmacist}', 'commission definers (src/modules/commission)', 'none (tenant-wide; the recipient reads its own rows)');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19; r1 P2-3): rules are configuration; attributions, assignments and staff receivables are personal
-- (named staff, reasons); the money rows are money totals.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.commission_rules', 'config'),
  ('public.commission_rule_versions', 'config'),
  ('public.commission_sale_attributions', 'personal'),
  ('public.guiding_bc_assignments', 'personal'),
  ('public.commission_contributions', 'money_total'),
  ('public.commission_entitlements', 'money_total'),
  ('public.commission_adjustments', 'money_total'),
  ('public.payout_batches', 'money_total'),
  ('public.payout_batch_items', 'money_total'),
  ('public.payout_batch_lines', 'money_total'),
  ('public.staff_commission_receivables', 'personal');--> statement-breakpoint

-- ── T-087 stage (a): attribution of sales and care plans (r1 P1-1; r2 P2-1) ──

-- Guards: attributions and assignments — never deleted; identity frozen; state moves pending_approval → active|rejected,
-- active → superseded; an assignment's effective_to set once.
CREATE FUNCTION public.commission_attribution_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attributions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.state = 'active' OR NEW.state = 'pending_approval') THEN
      RAISE EXCEPTION 'an attribution opens active or pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (OLD.state = 'pending_approval' AND NEW.state IN ('active','rejected') OR OLD.state = 'active' AND NEW.state = 'superseded' OR OLD.state = 'active' AND NEW.state = 'active' AND TG_TABLE_NAME = 'guiding_bc_assignments') THEN
    RAISE EXCEPTION 'an attribution moves forward only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_attribution_guard() FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.commission_sale_attributions_frozen() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.invoice_id, NEW.closing_bc_staff_id, NEW.guiding_bc_staff_id, NEW.source,
      NEW.approval_id, NEW.reason, NEW.attributed_by, NEW.attributed_as, NEW.attributed_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.invoice_id, OLD.closing_bc_staff_id, OLD.guiding_bc_staff_id, OLD.source,
      OLD.approval_id, OLD.reason, OLD.attributed_by, OLD.attributed_as, OLD.attributed_at, OLD.command_key) THEN
    RAISE EXCEPTION 'an attribution keeps its content' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_sale_attributions_frozen() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER commission_sale_attributions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.commission_sale_attributions FOR EACH ROW EXECUTE FUNCTION public.commission_attribution_guard();--> statement-breakpoint
ALTER TABLE public.commission_sale_attributions ENABLE ALWAYS TRIGGER commission_sale_attributions_guard;--> statement-breakpoint
CREATE TRIGGER commission_sale_attributions_frozen BEFORE UPDATE ON public.commission_sale_attributions FOR EACH ROW EXECUTE FUNCTION public.commission_sale_attributions_frozen();--> statement-breakpoint
ALTER TABLE public.commission_sale_attributions ENABLE ALWAYS TRIGGER commission_sale_attributions_frozen;--> statement-breakpoint

CREATE FUNCTION public.guiding_bc_assignments_frozen() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ((NEW.id, NEW.tenant_id, NEW.care_plan_id, NEW.staff_id, NEW.source, NEW.effective_from, NEW.approval_id, NEW.reason,
      NEW.assigned_by, NEW.assigned_as, NEW.assigned_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.care_plan_id, OLD.staff_id, OLD.source, OLD.effective_from, OLD.approval_id, OLD.reason,
      OLD.assigned_by, OLD.assigned_as, OLD.assigned_at, OLD.command_key)
     OR OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to) THEN
    RAISE EXCEPTION 'an assignment keeps its content; it ends once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guiding_bc_assignments_frozen() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER guiding_bc_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.guiding_bc_assignments FOR EACH ROW EXECUTE FUNCTION public.commission_attribution_guard();--> statement-breakpoint
ALTER TABLE public.guiding_bc_assignments ENABLE ALWAYS TRIGGER guiding_bc_assignments_guard;--> statement-breakpoint
CREATE TRIGGER guiding_bc_assignments_frozen BEFORE UPDATE ON public.guiding_bc_assignments FOR EACH ROW EXECUTE FUNCTION public.guiding_bc_assignments_frozen();--> statement-breakpoint
ALTER TABLE public.guiding_bc_assignments ENABLE ALWAYS TRIGGER guiding_bc_assignments_frozen;--> statement-breakpoint

-- Seeding (r2 check a): a selection's guiding BC becomes the guiding BC of the patient's active care plans without one (from the plan's
-- creation); a care plan that completes or stops closes its open assignment.
CREATE FUNCTION public.commission_selection_seed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF NEW.guiding_bc_staff_id IS NOT NULL THEN
    INSERT INTO public.guiding_bc_assignments (tenant_id, care_plan_id, staff_id, state, source, effective_from)
    SELECT cp.tenant_id, cp.id, NEW.guiding_bc_staff_id, 'active', 'selection', cp.created_at
      FROM public.care_plans cp
     WHERE cp.tenant_id = NEW.tenant_id AND cp.state = 'active'
       AND cp.patient_id = ANY (public.patient_cluster(NEW.tenant_id, public.patient_canonical(NEW.tenant_id, NEW.patient_id)))
       AND NOT EXISTS (SELECT 1 FROM public.guiding_bc_assignments g WHERE g.tenant_id = cp.tenant_id AND g.care_plan_id = cp.id AND g.state IN ('active','pending_approval'));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_selection_seed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER selections_commission_seed AFTER INSERT ON public.selections FOR EACH ROW EXECUTE FUNCTION public.commission_selection_seed();--> statement-breakpoint
ALTER TABLE public.selections ENABLE ALWAYS TRIGGER selections_commission_seed;--> statement-breakpoint

CREATE FUNCTION public.commission_care_plan_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.state = 'active' AND NEW.state IN ('completed','stopped') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    UPDATE public.guiding_bc_assignments SET effective_to = coalesce(NEW.closed_at, clock_timestamp())
     WHERE tenant_id = NEW.tenant_id AND care_plan_id = NEW.id AND state = 'active' AND effective_to IS NULL;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_care_plan_closed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER care_plans_commission_closed AFTER UPDATE OF state ON public.care_plans FOR EACH ROW EXECUTE FUNCTION public.commission_care_plan_closed();--> statement-breakpoint
ALTER TABLE public.care_plans ENABLE ALWAYS TRIGGER care_plans_commission_closed;--> statement-breakpoint

-- At issue (r2 check a): a non-counter invoice gets its sale attribution — the closing BC from the visit's selection, the guiding BC from
-- the patient's care plan at issue (or the selection's). A non-visit invoice (packages, a standalone substitution) opens with no closing BC
-- until the command sets it.
CREATE FUNCTION public.commission_invoice_issued() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  sel public.selections;
  v_guiding uuid;
BEGIN
  IF OLD.state = 'draft' AND NEW.state = 'issued' AND NOT NEW.counter THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    IF NEW.visit_id IS NOT NULL THEN
      SELECT * INTO sel FROM public.selections s WHERE s.tenant_id = NEW.tenant_id AND s.visit_id = NEW.visit_id;
    END IF;
    v_guiding := coalesce(CASE WHEN NEW.patient_id IS NOT NULL THEN public.commission_guiding_at(NEW.tenant_id, NEW.patient_id, NEW.issued_at) END,
                          sel.guiding_bc_staff_id);
    INSERT INTO public.commission_sale_attributions (tenant_id, branch_id, invoice_id, closing_bc_staff_id, guiding_bc_staff_id, state, source)
    VALUES (NEW.tenant_id, NEW.branch_id, NEW.id, sel.closing_bc_staff_id, v_guiding, 'active', 'selection');
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_invoice_issued() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER invoices_commission_issued AFTER UPDATE OF state ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.commission_invoice_issued();--> statement-breakpoint
ALTER TABLE public.invoices ENABLE ALWAYS TRIGGER invoices_commission_issued;--> statement-breakpoint

-- ── T-087 stage (a): attribution commands and the attribution_correction sync (r2 P2-1) ──

-- The attribution actor: the lock first; owner, manager, FO/cashier, finance, BC (a branch role at its active branch).
CREATE FUNCTION public.commission_attribution_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','manager','fo_cashier','finance','bc','doctor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not set commission attribution' USING ERRCODE = '42501';
  END IF;
  IF role IN ('manager','fo_cashier','bc','doctor') AND branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an active branch is needed' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_attribution_actor() FROM PUBLIC;--> statement-breakpoint

-- Set the closing (and guiding) BC of a sale (packages, standalone substitutions, visits without a selection). While the invoice has no
-- closing BC this applies at once; replacing a set staff member opens a pending correction that `attribution_correction` decides.
-- p: {closing_bc_staff_id?, guiding_bc_staff_id?, reason?}. Returns {attribution_id, state}.
CREATE FUNCTION public.commission_attribute_sale(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_attribution_actor();
  i public.invoices;
  cur public.commission_sale_attributions;
  v_id uuid;
  v_closing uuid;
  v_guiding uuid;
  v_approval uuid;
BEGIN
  SELECT x.id, x.state INTO v_id, cur.state FROM public.commission_sale_attributions x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('attribution_id', v_id, 'state', cur.state);
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF i.id IS NULL OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id OR i.counter THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_not_issued' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'closing_bc_staff_id' - 'guiding_bc_staff_id' - 'reason' <> '{}'::jsonb
     OR NOT (p ? 'closing_bc_staff_id' OR p ? 'guiding_bc_staff_id') OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: attribution' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cur FROM public.commission_sale_attributions x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id AND x.state = 'active' FOR UPDATE;
  v_closing := coalesce((p ->> 'closing_bc_staff_id')::uuid, cur.closing_bc_staff_id);
  v_guiding := coalesce((p ->> 'guiding_bc_staff_id')::uuid, cur.guiding_bc_staff_id);
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[v_closing, v_guiding]) s(id) WHERE s.id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.staff_roles r WHERE r.tenant_id = i.tenant_id AND r.staff_id = s.id AND r.role = 'bc')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: not_a_bc' USING ERRCODE = '22023';
  END IF;
  IF (cur.closing_bc_staff_id IS NULL OR cur.closing_bc_staff_id = v_closing) AND (cur.guiding_bc_staff_id IS NULL OR cur.guiding_bc_staff_id = v_guiding) THEN
    -- an initial attribution (nothing set is replaced): applies at once
    IF cur.id IS NOT NULL THEN
      UPDATE public.commission_sale_attributions SET state = 'superseded', ended_at = clock_timestamp() WHERE tenant_id = cur.tenant_id AND id = cur.id;
    END IF;
    INSERT INTO public.commission_sale_attributions (tenant_id, branch_id, invoice_id, closing_bc_staff_id, guiding_bc_staff_id, state, source, reason,
                                                     attributed_by, attributed_as, command_key)
    VALUES (i.tenant_id, i.branch_id, i.id, v_closing, v_guiding, 'active', 'command', NULLIF(btrim(coalesce(p ->> 'reason', '')), ''), a.staff_id, a.role, p_key)
    RETURNING id INTO v_id;
    PERFORM public.commission_attribution_reconcile(i.tenant_id, i.id, a.staff_id, a.role);
    PERFORM public.audit_append('money_correction', 'commission_attribution', v_id, 'success', 'commission_attributed');
    RETURN jsonb_build_object('attribution_id', v_id, 'state', 'active');
  END IF;
  -- a correction: a pending row the approval activates (its id is the approval subject)
  IF length(btrim(coalesce(p ->> 'reason', ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  v_id := public.uuid_generate_v7();
  v_approval := public.approval_request('attribution_correction', 'commission_sale_attribution', v_id, btrim(p ->> 'reason'), i.branch_id, NULL);
  INSERT INTO public.commission_sale_attributions (id, tenant_id, branch_id, invoice_id, closing_bc_staff_id, guiding_bc_staff_id, state, source, approval_id,
                                                   reason, attributed_by, attributed_as, command_key)
  VALUES (v_id, i.tenant_id, i.branch_id, i.id, v_closing, v_guiding, 'pending_approval', 'correction', v_approval, btrim(p ->> 'reason'), a.staff_id, a.role, p_key);
  RETURN jsonb_build_object('attribution_id', v_id, 'state', 'pending_approval');
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: attribution' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_attribute_sale(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_attribute_sale(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Set the guiding BC of an active care plan: at once when it has none; replacing one opens a pending correction.
CREATE FUNCTION public.guiding_bc_assign(p_key text, p_care_plan uuid, p_staff uuid, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_attribution_actor();
  cp public.care_plans;
  cur public.guiding_bc_assignments;
  v_id uuid;
  v_approval uuid;
  v_state text;
BEGIN
  SELECT x.id, x.state INTO v_id, v_state FROM public.guiding_bc_assignments x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('assignment_id', v_id, 'state', v_state);
  END IF;
  SELECT * INTO cp FROM public.care_plans x WHERE x.tenant_id = a.tenant_id AND x.id = p_care_plan FOR UPDATE;
  IF cp.id IS NULL OR a.branch_id IS NOT NULL AND cp.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: care plan not found' USING ERRCODE = 'P0002';
  END IF;
  IF cp.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: plan_closed' USING ERRCODE = '55000';
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$'
     OR NOT EXISTS (SELECT 1 FROM public.staff_roles r WHERE r.tenant_id = cp.tenant_id AND r.staff_id = p_staff AND r.role = 'bc') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: not_a_bc' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cur FROM public.guiding_bc_assignments x WHERE x.tenant_id = cp.tenant_id AND x.care_plan_id = cp.id AND x.state = 'active' FOR UPDATE;
  IF cur.id IS NULL THEN
    INSERT INTO public.guiding_bc_assignments (tenant_id, care_plan_id, staff_id, state, source, effective_from, assigned_by, assigned_as, command_key)
    VALUES (cp.tenant_id, cp.id, p_staff, 'active', 'command', cp.created_at, a.staff_id, a.role, p_key) RETURNING id INTO v_id;
    PERFORM public.audit_append('money_correction', 'guiding_bc_assignment', v_id, 'success', 'guiding_bc_assigned');
    RETURN jsonb_build_object('assignment_id', v_id, 'state', 'active');
  END IF;
  IF cur.staff_id = p_staff THEN
    RETURN jsonb_build_object('assignment_id', cur.id, 'state', 'active');
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  v_id := public.uuid_generate_v7();
  v_approval := public.approval_request('attribution_correction', 'guiding_bc_assignment', v_id, btrim(p_reason), cp.branch_id, NULL);
  INSERT INTO public.guiding_bc_assignments (id, tenant_id, care_plan_id, staff_id, state, source, effective_from, approval_id, reason, assigned_by, assigned_as, command_key)
  VALUES (v_id, cp.tenant_id, cp.id, p_staff, 'pending_approval', 'correction', clock_timestamp(), v_approval, btrim(p_reason), a.staff_id, a.role, p_key);
  RETURN jsonb_build_object('assignment_id', v_id, 'state', 'pending_approval');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guiding_bc_assign(text, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.guiding_bc_assign(text, uuid, uuid, text) TO clinic_app;--> statement-breakpoint

-- attribution_correction decided (r2 P2-1): approved → the pending row becomes active and the previous one superseded (a guiding
-- assignment: the old one ends now, the new one starts now; a sale attribution: the settled basis is reconciled); rejected or cancelled →
-- the pending row is rejected.
CREATE FUNCTION public.commission_attribution_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  sa public.commission_sale_attributions;
  ga public.guiding_bc_assignments;
BEGIN
  IF NEW.type <> 'attribution_correction' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF NEW.subject_kind = 'commission_sale_attribution' THEN
    SELECT * INTO sa FROM public.commission_sale_attributions x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.subject_id AND x.state = 'pending_approval' FOR UPDATE;
    IF sa.id IS NULL THEN
      RETURN NULL;
    END IF;
    IF NEW.state = 'approved' THEN
      UPDATE public.commission_sale_attributions SET state = 'superseded', ended_at = clock_timestamp()
       WHERE tenant_id = sa.tenant_id AND invoice_id = sa.invoice_id AND state = 'active';
      UPDATE public.commission_sale_attributions SET state = 'active' WHERE tenant_id = sa.tenant_id AND id = sa.id;
      PERFORM public.commission_attribution_reconcile(sa.tenant_id, sa.invoice_id, NEW.decided_by, NEW.decided_as);
    ELSE
      UPDATE public.commission_sale_attributions SET state = 'rejected', ended_at = clock_timestamp() WHERE tenant_id = sa.tenant_id AND id = sa.id;
    END IF;
  ELSIF NEW.subject_kind = 'guiding_bc_assignment' THEN
    SELECT * INTO ga FROM public.guiding_bc_assignments x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.subject_id AND x.state = 'pending_approval' FOR UPDATE;
    IF ga.id IS NULL THEN
      RETURN NULL;
    END IF;
    IF NEW.state = 'approved' THEN
      UPDATE public.guiding_bc_assignments SET state = 'superseded', effective_to = coalesce(effective_to, clock_timestamp())
       WHERE tenant_id = ga.tenant_id AND care_plan_id = ga.care_plan_id AND state = 'active';
      UPDATE public.guiding_bc_assignments SET state = 'active' WHERE tenant_id = ga.tenant_id AND id = ga.id;
    ELSE
      UPDATE public.guiding_bc_assignments SET state = 'rejected', effective_to = clock_timestamp() WHERE tenant_id = ga.tenant_id AND id = ga.id;
    END IF;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_attribution_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_commission_attribution_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.commission_attribution_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_commission_attribution_sync;--> statement-breakpoint

-- ── T-087 stage (b): the accrual core (r1 P1-3, P2-1; r2 P2-2, P3-5) ──

-- A line's share (gross) of a receivable's real collections so far (r2 P2-2: Σ allocations with the receivable id, which includes the
-- row being inserted; the collected total distributed over the receivable's lines by kasir_allocate, deterministic).
CREATE FUNCTION public.commission_collected_share(p_tenant uuid, p_receivable uuid, p_line uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_collected bigint;
  v_lines uuid[];
  v_amounts bigint[];
BEGIN
  SELECT coalesce(sum(a.amount), 0) INTO v_collected FROM public.payment_allocations a
   WHERE a.tenant_id = p_tenant AND a.receivable_id = p_receivable AND NOT a.is_simulated;
  IF v_collected = 0 THEN
    RETURN 0;
  END IF;
  SELECT array_agg(rl.invoice_line_id ORDER BY rl.invoice_line_id), array_agg(rl.amount ORDER BY rl.invoice_line_id)
    INTO v_lines, v_amounts FROM public.receivable_lines rl WHERE rl.tenant_id = p_tenant AND rl.receivable_id = p_receivable;
  RETURN coalesce((SELECT k.amount FROM public.kasir_allocate(least(v_collected, (SELECT sum(x) FROM unnest(v_amounts) x)::bigint), v_lines, v_amounts) k
                    WHERE k.line_id = p_line), 0);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_collected_share(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The cumulative net % basis of a line: real allocations to the line (amount − vat_portion), applied deposits (amount − vat_amount), and
-- the line's share of real receivable collections (the collected total distributed over the receivable's lines, each share net by the
-- line's vat_base / line_total). Monotone in the settlement facts; refunds and moves are adjustments, not a lower basis.
CREATE FUNCTION public.commission_line_basis(p_tenant uuid, p_line uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH l AS (SELECT * FROM public.invoice_lines x WHERE x.tenant_id = p_tenant AND x.id = p_line)
  SELECT (coalesce((SELECT sum(a.amount - a.vat_portion) FROM public.payment_allocations a
                     WHERE a.tenant_id = p_tenant AND a.invoice_line_id = p_line AND NOT a.is_simulated), 0)
        + coalesce((SELECT sum(d.amount - d.vat_amount) FROM public.booking_deposits d
                     WHERE d.tenant_id = p_tenant AND d.applied_line_id = p_line AND d.state = 'applied'), 0)
        + coalesce((SELECT sum(public.commission_collected_share(rl.tenant_id, rl.receivable_id, rl.invoice_line_id)
                             * (SELECT l.vat_base FROM l) / nullif((SELECT l.line_total FROM l), 0))
                      FROM public.receivable_lines rl WHERE rl.tenant_id = p_tenant AND rl.invoice_line_id = p_line), 0))::bigint
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_line_basis(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A line paid in full for a fixed commission (r1 P1-3): real money (allocations, applied deposits, the collected receivable share) covers
-- the line total, and nothing of it was cancelled, moved to balance or written off.
CREATE FUNCTION public.commission_line_fully_paid(p_tenant uuid, p_line uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT public.kasir_line_paid(l.tenant_id, l.id)
                        + coalesce((SELECT sum(public.commission_collected_share(rl.tenant_id, rl.receivable_id, rl.invoice_line_id))
                                     FROM public.receivable_lines rl WHERE rl.tenant_id = l.tenant_id AND rl.invoice_line_id = l.id), 0) >= l.line_total
                   AND l.cancelled_amount = 0 AND l.moved_to_balance = 0
                   AND NOT EXISTS (SELECT 1 FROM public.receivable_lines rl JOIN public.write_offs w ON w.tenant_id = rl.tenant_id AND w.receivable_id = rl.receivable_id
                                    WHERE rl.tenant_id = l.tenant_id AND rl.invoice_line_id = l.id)
              FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.id = p_line), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_line_fully_paid(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The contribution of (staff, type, source), created on first use with the rule version at the sale instant; NULL when no rule applies,
-- the item's scope excludes the type, or the staff is the owner (BILL-15). The item judged (scope, category, rule) is the line's, except
-- for a performer, whose item is the executed service (a package session's line is the package, scenario 11/12; plan item version).
CREATE FUNCTION public.commission_contribution(p_tenant uuid, p_branch uuid, p_staff uuid, p_type text, p_source_kind text, p_source uuid,
  p_line uuid, p_sale_at timestamptz) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
  l public.invoice_lines;
  v_category text;
  v_consult boolean;
  v_rule uuid;
  v_version uuid;
  v_item uuid;
BEGIN
  IF p_staff IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT c.id INTO v_id FROM public.commission_contributions c
   WHERE c.tenant_id = p_tenant AND c.staff_id = p_staff AND c.contribution_type = p_type AND c.source_kind = p_source_kind AND c.source_id = p_source;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = p_tenant AND x.id = p_line;
  v_version := l.catalog_version_id; -- a consultation performer (source examination) is judged on the consultation line's item
  IF p_source_kind = 'treatment_execution' THEN
    SELECT t.catalog_version_id INTO v_version FROM public.treatment_executions e JOIN public.plan_items t ON t.tenant_id = e.tenant_id AND t.id = e.plan_item_id
     WHERE e.tenant_id = p_tenant AND e.id = p_source;
    v_version := coalesce(v_version, l.catalog_version_id);
  END IF;
  IF NOT p_type = ANY (public.commission_item_scopes(p_tenant, v_version)) THEN
    RETURN NULL;
  END IF;
  SELECT cv.category, cv.item_id INTO v_category, v_item FROM public.catalog_versions cv WHERE cv.tenant_id = p_tenant AND cv.id = v_version;
  SELECT i.consultation INTO v_consult FROM public.invoices i WHERE i.tenant_id = p_tenant AND i.id = l.invoice_id;
  v_rule := public.commission_rule_at(p_tenant, p_type, p_staff, public.commission_staff_role(p_tenant, p_staff, p_type), v_item, v_category,
                                      coalesce(v_consult, false), p_sale_at);
  IF v_rule IS NULL OR public.commission_staff_role(p_tenant, p_staff, p_type) IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.commission_contributions (tenant_id, branch_id, staff_id, contribution_type, source_kind, source_id, invoice_line_id, rule_version_id, sale_at)
  VALUES (p_tenant, p_branch, p_staff, p_type, p_source_kind, p_source, p_line, v_rule, p_sale_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_contribution(uuid, uuid, uuid, text, text, uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- A % step (r1 P2-1): the rounded cumulative amount at the new cumulative basis minus what was accrued before; written once per fact.
CREATE FUNCTION public.commission_accrue_percent(p_tenant uuid, p_contribution uuid, p_cum_basis bigint, p_fact_kind text, p_fact uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.commission_contributions;
  v public.commission_rule_versions;
  v_before bigint;
  v_step bigint;
BEGIN
  SELECT * INTO c FROM public.commission_contributions x WHERE x.tenant_id = p_tenant AND x.id = p_contribution;
  IF c.id IS NULL OR c.blocked THEN
    RETURN;
  END IF;
  SELECT * INTO v FROM public.commission_rule_versions x WHERE x.tenant_id = p_tenant AND x.id = c.rule_version_id;
  IF v.kind <> 'percent' THEN
    RETURN;
  END IF;
  -- accrued so far, less what an attribution correction took back (a BC attributed again earns again; refunds and moves stay out:
  -- their basis is handled by commission_line_moved)
  SELECT coalesce(sum(e.amount), 0)
       + coalesce((SELECT sum(x.amount) FROM public.commission_adjustments x JOIN public.commission_entitlements e2 ON e2.tenant_id = x.tenant_id AND e2.id = x.entitlement_id
                    WHERE x.tenant_id = p_tenant AND e2.contribution_id = c.id AND x.cause = 'attribution'), 0)
    INTO v_before FROM public.commission_entitlements e WHERE e.tenant_id = p_tenant AND e.contribution_id = c.id;
  v_step := (p_cum_basis * v.basis_points + 5000) / 10000 - v_before;
  IF v_step <= 0 THEN
    RETURN;
  END IF;
  INSERT INTO public.commission_entitlements (tenant_id, branch_id, contribution_id, staff_id, amount, basis, fact_kind, fact_id)
  VALUES (p_tenant, c.branch_id, c.id, c.staff_id, v_step, p_cum_basis, p_fact_kind, p_fact)
  ON CONFLICT (tenant_id, contribution_id, fact_kind, fact_id) DO NOTHING;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_accrue_percent(uuid, uuid, bigint, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- A fixed entitlement (the rule's amount), once per contribution.
CREATE FUNCTION public.commission_accrue_fixed(p_tenant uuid, p_contribution uuid, p_fact_kind text, p_fact uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.commission_contributions;
  v public.commission_rule_versions;
BEGIN
  SELECT * INTO c FROM public.commission_contributions x WHERE x.tenant_id = p_tenant AND x.id = p_contribution;
  IF c.id IS NULL OR c.blocked OR EXISTS (SELECT 1 FROM public.commission_entitlements e WHERE e.tenant_id = p_tenant AND e.contribution_id = c.id) THEN
    RETURN;
  END IF;
  SELECT * INTO v FROM public.commission_rule_versions x WHERE x.tenant_id = p_tenant AND x.id = c.rule_version_id;
  IF v.kind <> 'fixed' THEN
    RETURN;
  END IF;
  INSERT INTO public.commission_entitlements (tenant_id, branch_id, contribution_id, staff_id, amount, basis, fact_kind, fact_id)
  VALUES (p_tenant, c.branch_id, c.id, c.staff_id, v.fixed_amount, 0, p_fact_kind, p_fact);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_accrue_fixed(uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- A sale's sales contributions on one line at its current cumulative basis (closing BC, guiding BC; new patient on the patient's first
-- visit only, B-12): sold branch, the invoice's issue instant. A consultation line, a substitution difference line, a package line: the sales
-- types apply (performer never accrues through a line payment). A counter sale has no BC.
CREATE FUNCTION public.commission_accrue_line(p_tenant uuid, p_line uuid, p_fact_kind text, p_fact uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  i public.invoices;
  sa public.commission_sale_attributions;
  v_basis bigint;
  v_registrar uuid;
  v_contribution uuid;
BEGIN
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = p_tenant AND x.id = p_line;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = p_tenant AND x.id = l.invoice_id;
  IF i.id IS NULL OR i.state <> 'issued' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.receivable_lines rl JOIN public.write_offs w ON w.tenant_id = rl.tenant_id AND w.receivable_id = rl.receivable_id
              WHERE rl.tenant_id = p_tenant AND rl.invoice_line_id = p_line) THEN
    RETURN; -- BILL-23: no commission on a written-off item
  END IF;
  v_basis := public.commission_line_basis(p_tenant, p_line);
  SELECT * INTO sa FROM public.commission_sale_attributions x WHERE x.tenant_id = p_tenant AND x.invoice_id = i.id AND x.state = 'active';
  v_contribution := public.commission_contribution(p_tenant, i.sold_branch_id, sa.closing_bc_staff_id, 'closing_bc', 'invoice_line', l.id, l.id, i.issued_at);
  PERFORM public.commission_accrue_percent(p_tenant, v_contribution, v_basis, p_fact_kind, p_fact);
  v_contribution := public.commission_contribution(p_tenant, i.sold_branch_id, sa.guiding_bc_staff_id, 'guiding_bc', 'invoice_line', l.id, l.id, i.issued_at);
  PERFORM public.commission_accrue_percent(p_tenant, v_contribution, v_basis, p_fact_kind, p_fact);
  IF i.visit_id IS NOT NULL AND i.patient_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.visits v WHERE v.tenant_id = p_tenant AND v.id <> i.visit_id
          AND v.patient_id = ANY (public.patient_cluster(p_tenant, public.patient_canonical(p_tenant, i.patient_id)))
          AND v.checked_in_at < (SELECT v2.checked_in_at FROM public.visits v2 WHERE v2.tenant_id = p_tenant AND v2.id = i.visit_id)) THEN
    SELECT p.created_by INTO v_registrar FROM public.patients p WHERE p.tenant_id = p_tenant AND p.id = public.patient_canonical(p_tenant, i.patient_id);
    v_contribution := public.commission_contribution(p_tenant, i.sold_branch_id, v_registrar, 'new_patient', 'invoice_line', l.id, l.id, i.issued_at);
    PERFORM public.commission_accrue_percent(p_tenant, v_contribution, v_basis, p_fact_kind, p_fact);
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_accrue_line(uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- The performer of a single or addition treatment (r1 P1-3): its own line (the plan item's line on the visit's invoices, not a substitution
-- difference line) fully paid and the execution counted; executing branch; the line's invoice issue instant. Package executions are
-- accrued at redemption instead.
CREATE FUNCTION public.commission_accrue_execution(p_tenant uuid, p_execution uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.treatment_executions;
  l public.invoice_lines;
  i public.invoices;
  v_contribution uuid;
BEGIN
  SELECT * INTO e FROM public.treatment_executions x WHERE x.tenant_id = p_tenant AND x.id = p_execution;
  IF e.id IS NULL OR e.state <> 'finished' OR NOT e.counted OR public.package_execution_covered(p_tenant, e.id) THEN
    RETURN;
  END IF;
  SELECT l2.* INTO l FROM public.invoice_lines l2 JOIN public.invoices i2 ON i2.tenant_id = l2.tenant_id AND i2.id = l2.invoice_id
   WHERE l2.tenant_id = p_tenant AND i2.visit_id = e.visit_id AND i2.state = 'issued' AND l2.substitution_id IS NULL AND NOT i2.consultation
     AND (l2.plan_item_id = e.plan_item_id OR l2.plan_item_id IS NULL AND l2.item_id = public.package_plan_service(e.tenant_id, e.plan_item_id)
                                              AND NOT public.addition_of_visit(e.tenant_id, e.visit_id, e.plan_item_id))
   ORDER BY (l2.plan_item_id IS NOT NULL) DESC, i2.issued_at, l2.id LIMIT 1;
  IF l.id IS NULL OR NOT public.commission_line_fully_paid(p_tenant, l.id) THEN
    RETURN;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = p_tenant AND x.id = l.invoice_id;
  v_contribution := public.commission_contribution(p_tenant, e.branch_id, e.performer_staff_id, 'performer', 'treatment_execution', e.id, l.id, i.issued_at);
  PERFORM public.commission_accrue_fixed(p_tenant, v_contribution, 'execution', e.id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_accrue_execution(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A consultation performer (r1 P1-4, r2 P2-4): the visit's signed examination's author earns on a fully paid consultation line (a charged
-- or re-charged fee; a waived fee has no line), under a rule scoped to consultation only (commission_rule_at). Both orders: called on the
-- line's settlement and on the examination's signing.
CREATE FUNCTION public.commission_accrue_consultation(p_tenant uuid, p_line uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.invoices;
  ex record;
  v_contribution uuid;
BEGIN
  SELECT x.* INTO i FROM public.invoices x JOIN public.invoice_lines l ON l.tenant_id = x.tenant_id AND l.invoice_id = x.id
   WHERE l.tenant_id = p_tenant AND l.id = p_line;
  IF i.id IS NULL OR NOT i.consultation OR i.state <> 'issued' OR i.visit_id IS NULL OR NOT public.commission_line_fully_paid(p_tenant, p_line) THEN
    RETURN;
  END IF;
  SELECT e.id, e.branch_id, e.author_id INTO ex FROM public.examinations e
   WHERE e.tenant_id = p_tenant AND e.visit_id = i.visit_id AND e.state = 'signed' ORDER BY e.signed_at, e.id LIMIT 1;
  IF ex.id IS NULL THEN
    RETURN;
  END IF;
  v_contribution := public.commission_contribution(p_tenant, ex.branch_id, ex.author_id, 'performer', 'examination', ex.id, p_line, i.issued_at);
  PERFORM public.commission_accrue_fixed(p_tenant, v_contribution, 'examination', ex.id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_accrue_consultation(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Every counted, finished single/addition execution whose line is this one (called when a settlement completes the line); and the
-- consultation performer on a consultation line.
CREATE FUNCTION public.commission_accrue_line_performers(p_tenant uuid, p_line uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_exec uuid;
BEGIN
  PERFORM public.commission_accrue_consultation(p_tenant, p_line);
  FOR v_exec IN SELECT e.id FROM public.treatment_executions e
                  JOIN public.invoice_lines l ON l.tenant_id = e.tenant_id
                   AND (l.plan_item_id = e.plan_item_id OR l.plan_item_id IS NULL AND l.item_id = public.package_plan_service(e.tenant_id, e.plan_item_id)
                                                        AND NOT public.addition_of_visit(e.tenant_id, e.visit_id, e.plan_item_id))
                  JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id AND i.visit_id = e.visit_id
                 WHERE l.tenant_id = p_tenant AND l.id = p_line AND l.substitution_id IS NULL AND e.state = 'finished' AND e.counted
                 ORDER BY e.id LOOP
    PERFORM public.commission_accrue_execution(p_tenant, v_exec);
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_accrue_line_performers(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- ── T-087 stage (b): the settlement triggers (r2 check a). Each is a definer with a pinned search path, takes staff_access first, and is
-- enabled always. None re-creates an M4 writer. ──

-- A real allocation: to a line → the line's sales contributions and, when the line becomes fully paid, its performers; to a receivable →
-- every line of the receivable (the collected share moved).
CREATE FUNCTION public.commission_allocation_accrue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_line uuid;
BEGIN
  IF NEW.is_simulated THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF NEW.invoice_line_id IS NOT NULL THEN
    PERFORM public.commission_accrue_line(NEW.tenant_id, NEW.invoice_line_id, 'allocation', NEW.id);
    PERFORM public.commission_accrue_line_performers(NEW.tenant_id, NEW.invoice_line_id);
  ELSIF NEW.receivable_id IS NOT NULL THEN
    FOR v_line IN SELECT rl.invoice_line_id FROM public.receivable_lines rl
                   WHERE rl.tenant_id = NEW.tenant_id AND rl.receivable_id = NEW.receivable_id ORDER BY rl.invoice_line_id LOOP
      PERFORM public.commission_accrue_line(NEW.tenant_id, v_line, 'collection', NEW.id);
      PERFORM public.commission_accrue_line_performers(NEW.tenant_id, v_line);
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_allocation_accrue() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payment_allocations_commission AFTER INSERT ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.commission_allocation_accrue();--> statement-breakpoint
ALTER TABLE public.payment_allocations ENABLE ALWAYS TRIGGER payment_allocations_commission;--> statement-breakpoint

-- A booking deposit applied to its line (6e).
CREATE FUNCTION public.commission_deposit_accrue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.state = 'held' AND NEW.state = 'applied' AND NEW.applied_line_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    PERFORM public.commission_accrue_line(NEW.tenant_id, NEW.applied_line_id, 'deposit', NEW.id);
    PERFORM public.commission_accrue_line_performers(NEW.tenant_id, NEW.applied_line_id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_deposit_accrue() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER booking_deposits_commission AFTER UPDATE OF state ON public.booking_deposits FOR EACH ROW EXECUTE FUNCTION public.commission_deposit_accrue();--> statement-breakpoint
ALTER TABLE public.booking_deposits ENABLE ALWAYS TRIGGER booking_deposits_commission;--> statement-breakpoint

-- A treatment finished counted (named to fire after the package finish and the addition triggers).
CREATE FUNCTION public.commission_execution_accrue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.state <> 'finished' AND NEW.state = 'finished' AND NEW.counted THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    PERFORM public.commission_accrue_execution(NEW.tenant_id, NEW.id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_execution_accrue() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER treatment_executions_20_commission AFTER UPDATE OF state ON public.treatment_executions FOR EACH ROW EXECUTE FUNCTION public.commission_execution_accrue();--> statement-breakpoint
ALTER TABLE public.treatment_executions ENABLE ALWAYS TRIGGER treatment_executions_20_commission;--> statement-breakpoint

-- An examination signed → the consultation performer of the visit's paid consultation lines (the other order: payment first).
CREATE FUNCTION public.commission_examination_signed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_line uuid;
BEGIN
  IF OLD.state <> 'signed' AND NEW.state = 'signed' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    FOR v_line IN SELECT l.id FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                   WHERE i.tenant_id = NEW.tenant_id AND i.visit_id = NEW.visit_id AND i.consultation AND i.state = 'issued' ORDER BY l.id LOOP
      PERFORM public.commission_accrue_consultation(NEW.tenant_id, v_line);
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_examination_signed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER examinations_commission_signed AFTER UPDATE OF state ON public.examinations FOR EACH ROW EXECUTE FUNCTION public.commission_examination_signed();--> statement-breakpoint
ALTER TABLE public.examinations ENABLE ALWAYS TRIGGER examinations_commission_signed;--> statement-breakpoint

-- A package session redeemed → the performer of its execution at the redeeming branch, on the package line, at the package invoice's
-- issue (BILL-16; 5a, 7d, 11, 12, 13, 16). No second sales commission on a redemption.
CREATE FUNCTION public.commission_session_accrue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.treatment_executions;
  pk public.packages;
  v_issued timestamptz;
  v_contribution uuid;
BEGIN
  IF OLD.state <> 'redeemed' AND NEW.state = 'redeemed' AND NEW.reserved_execution_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    SELECT * INTO e FROM public.treatment_executions x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.reserved_execution_id;
    SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.package_id;
    SELECT i.issued_at INTO v_issued FROM public.invoices i WHERE i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id;
    v_contribution := public.commission_contribution(NEW.tenant_id, coalesce(NEW.redeemed_branch_id, e.branch_id), e.performer_staff_id, 'performer',
                                                     'treatment_execution', e.id, pk.invoice_line_id, v_issued);
    PERFORM public.commission_accrue_fixed(NEW.tenant_id, v_contribution, 'session', NEW.id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_session_accrue() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_sessions_commission AFTER UPDATE OF state ON public.package_sessions FOR EACH ROW EXECUTE FUNCTION public.commission_session_accrue();--> statement-breakpoint
ALTER TABLE public.package_sessions ENABLE ALWAYS TRIGGER package_sessions_commission;--> statement-breakpoint

-- Attribution set or corrected after money settled (r2 P2-1): the sales contributions of the invoice's lines are reconciled — every
-- unreversed BC entitlement of a staff member no longer attributed is reversed (cause attribution), then the lines accrue for the active
-- attribution at their current basis. The replaced BC's contribution is not blocked: it only accrues while attributed (commission_accrue_line
-- reads the active attribution), and if attributed again it earns again (commission_accrue_percent nets the attribution reversals).
CREATE FUNCTION public.commission_attribution_reconcile(p_tenant uuid, p_invoice uuid, p_staff uuid, p_role text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  sa public.commission_sale_attributions;
  c record;
  v_line uuid;
BEGIN
  SELECT * INTO sa FROM public.commission_sale_attributions x WHERE x.tenant_id = p_tenant AND x.invoice_id = p_invoice AND x.state = 'active';
  FOR c IN SELECT cc.id FROM public.commission_contributions cc
             JOIN public.invoice_lines l ON l.tenant_id = cc.tenant_id AND l.id = cc.invoice_line_id
            WHERE cc.tenant_id = p_tenant AND l.invoice_id = p_invoice AND NOT cc.blocked
              AND (cc.contribution_type = 'closing_bc' AND cc.staff_id IS DISTINCT FROM sa.closing_bc_staff_id
                OR cc.contribution_type = 'guiding_bc' AND cc.staff_id IS DISTINCT FROM sa.guiding_bc_staff_id)
            ORDER BY cc.id LOOP
    PERFORM public.commission_reverse_contribution(p_tenant, c.id, 'attribution', 'attribution', sa.id);
  END LOOP;
  FOR v_line IN SELECT l.id FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_invoice ORDER BY l.id LOOP
    PERFORM public.commission_accrue_line(p_tenant, v_line, 'attribution', sa.id);
    -- the newly attributed BC accrued on the settled basis; re-apply what already left the line (refunds, moves; a package line's
    -- cheaper substitutions) so it earns only on what stayed (review r1 P2-1)
    PERFORM public.commission_line_moved(p_tenant, v_line,
      (SELECT (greatest(0, l.moved_to_balance - l.vat_reversed_amount)
            + coalesce((SELECT greatest(0, l.vat_base - (SELECT coalesce(sum(s.vat_base), 0) FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id))
                          FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id), 0))::bigint
         FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.id = v_line),
      'attribution', 'attribution', sa.id);
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_attribution_reconcile(uuid, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- ── T-087 stage (b): adjustments (r1 P1-5; r2 P2-2, P3-5) ──

-- Whether an entitlement is in a sealed batch (pending_approval, approved, paid): an adjustment then lands in the next open batch.
CREATE FUNCTION public.commission_entitlement_sealed(p_tenant uuid, p_entitlement uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.payout_batch_items bi JOIN public.payout_batches b ON b.tenant_id = bi.tenant_id AND b.id = bi.batch_id
                  WHERE bi.tenant_id = p_tenant AND bi.entitlement_id = p_entitlement AND b.state IN ('pending_approval','approved','paid'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_entitlement_sealed(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Spread a reduction D (> 0) of a contribution over its entitlements LIFO (newest first), each capped at what remains of it; one
-- adjustment row per touched entitlement, once per (entitlement, fact).
CREATE FUNCTION public.commission_reduce(p_tenant uuid, p_contribution uuid, p_amount bigint, p_cause text, p_fact_kind text, p_fact uuid) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e record;
  v_left bigint := p_amount;
  v_take bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN 0;
  END IF;
  FOR e IN SELECT x.id, x.branch_id, x.staff_id,
                  x.amount + coalesce((SELECT sum(a.amount) FROM public.commission_adjustments a WHERE a.tenant_id = x.tenant_id AND a.entitlement_id = x.id), 0) AS remaining
             FROM public.commission_entitlements x
            WHERE x.tenant_id = p_tenant AND x.contribution_id = p_contribution
            ORDER BY x.accrued_at DESC, x.id DESC LOOP
    EXIT WHEN v_left <= 0;
    CONTINUE WHEN e.remaining <= 0;
    v_take := least(v_left, e.remaining);
    INSERT INTO public.commission_adjustments (tenant_id, branch_id, entitlement_id, staff_id, amount, cause, fact_kind, fact_id, after_payout)
    VALUES (p_tenant, e.branch_id, e.id, e.staff_id, -v_take, p_cause, p_fact_kind, p_fact, public.commission_entitlement_sealed(p_tenant, e.id))
    ON CONFLICT (tenant_id, entitlement_id, fact_kind, fact_id) DO NOTHING;
    IF FOUND THEN
      v_left := v_left - v_take;
    END IF;
  END LOOP;
  RETURN p_amount - v_left;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_reduce(uuid, uuid, bigint, text, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Reverse everything still unreversed of a contribution (a write-off, an attribution change, a performer whose line is no longer paid).
CREATE FUNCTION public.commission_reverse_contribution(p_tenant uuid, p_contribution uuid, p_cause text, p_fact_kind text, p_fact uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_open bigint;
BEGIN
  SELECT coalesce(sum(x.amount), 0) + coalesce((SELECT sum(a.amount) FROM public.commission_adjustments a JOIN public.commission_entitlements e2
                                                  ON e2.tenant_id = a.tenant_id AND e2.id = a.entitlement_id
                                                 WHERE a.tenant_id = p_tenant AND e2.contribution_id = p_contribution), 0)
    INTO v_open FROM public.commission_entitlements x WHERE x.tenant_id = p_tenant AND x.contribution_id = p_contribution;
  PERFORM public.commission_reduce(p_tenant, p_contribution, v_open, p_cause, p_fact_kind, p_fact);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_reverse_contribution(uuid, uuid, text, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- The % reduction of a line's sales contributions for a cumulative net moved basis: each contribution's target total is the rounded
-- amount at (accrued basis − moved basis); the reduction is what exceeds it, minus what was already reduced (cumulative, no drift).
CREATE FUNCTION public.commission_line_moved(p_tenant uuid, p_line uuid, p_cum_moved bigint, p_cause text, p_fact_kind text, p_fact uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
  v_target bigint;
  v_net bigint;
BEGIN
  FOR c IN SELECT cc.id, v.basis_points,
                  (SELECT coalesce(max(e.basis), 0) FROM public.commission_entitlements e WHERE e.tenant_id = cc.tenant_id AND e.contribution_id = cc.id) AS basis,
                  (SELECT coalesce(sum(e.amount), 0) FROM public.commission_entitlements e WHERE e.tenant_id = cc.tenant_id AND e.contribution_id = cc.id)
                + (SELECT coalesce(sum(a.amount), 0) FROM public.commission_adjustments a JOIN public.commission_entitlements e
                     ON e.tenant_id = a.tenant_id AND e.id = a.entitlement_id WHERE a.tenant_id = cc.tenant_id AND e.contribution_id = cc.id) AS net
             FROM public.commission_contributions cc
             JOIN public.commission_rule_versions v ON v.tenant_id = cc.tenant_id AND v.id = cc.rule_version_id
            WHERE cc.tenant_id = p_tenant AND cc.invoice_line_id = p_line AND cc.source_kind = 'invoice_line' AND v.kind = 'percent'
            ORDER BY cc.id LOOP
    v_target := (greatest(c.basis - p_cum_moved, 0) * c.basis_points + 5000) / 10000;
    v_net := c.net;
    IF v_net > v_target THEN
      PERFORM public.commission_reduce(p_tenant, c.id, v_net - v_target, p_cause, p_fact_kind, p_fact);
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_line_moved(uuid, uuid, bigint, text, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Reverse the performers of a line no longer fully paid (r1 P1-5: a refund, a move or a write-off of a single/addition treatment line).
CREATE FUNCTION public.commission_line_performers_reverse(p_tenant uuid, p_line uuid, p_cause text, p_fact_kind text, p_fact uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c uuid;
BEGIN
  IF public.commission_line_fully_paid(p_tenant, p_line) THEN
    RETURN;
  END IF;
  FOR c IN SELECT cc.id FROM public.commission_contributions cc
            WHERE cc.tenant_id = p_tenant AND cc.invoice_line_id = p_line
              AND (cc.source_kind = 'treatment_execution' AND NOT public.package_execution_covered(p_tenant, cc.source_id) OR cc.source_kind = 'examination')
            ORDER BY cc.id LOOP
    PERFORM public.commission_reverse_contribution(p_tenant, c, p_cause, p_fact_kind, p_fact);
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_line_performers_reverse(uuid, uuid, text, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- A line's paid value moved to balance (a refund to balance or in cash, an interrupted treatment, an unredeemed substitution line at a
-- package close): cumulative net moved = moved_to_balance − vat_reversed_amount (r2 P2-2: on the mutated column).
CREATE FUNCTION public.commission_line_moved_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_cause text;
BEGIN
  IF NEW.moved_to_balance > OLD.moved_to_balance THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    -- the cause (review r1 P3-1): interrupted_to_balance updates the line before it posts the from_interrupted_treatment entry, so an
    -- unmoved medical/clinic stop on the line's visit marks the move as interrupted; a refund (any other move) stays 'refund' 
    v_cause := CASE WHEN NEW.substitution_id IS NULL AND EXISTS (
                      SELECT 1 FROM public.invoices i JOIN public.treatment_executions e ON e.tenant_id = i.tenant_id AND e.visit_id = i.visit_id
                       WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id AND e.state = 'finished' AND e.outcome IN ('medical_stop','clinic_stop')
                         AND NOT public.package_execution_covered(e.tenant_id, e.id)
                         AND NOT EXISTS (SELECT 1 FROM public.balance_entries b WHERE b.tenant_id = e.tenant_id AND b.source_kind = 'treatment_execution' AND b.source_id = e.id)
                         AND NOT EXISTS (SELECT 1 FROM public.refunds r WHERE r.tenant_id = NEW.tenant_id AND r.invoice_line_id = NEW.id AND r.state IN ('requested','approved')))
                    THEN 'interrupted' ELSE 'refund' END;
    PERFORM public.commission_line_moved(NEW.tenant_id, NEW.id, NEW.moved_to_balance - NEW.vat_reversed_amount, v_cause, 'invoice_line',
                                         public.uuid_generate_v7());
    PERFORM public.commission_line_performers_reverse(NEW.tenant_id, NEW.id, v_cause, 'invoice_line', NEW.id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_line_moved_trigger() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER invoice_lines_commission_moved AFTER UPDATE OF moved_to_balance ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.commission_line_moved_trigger();--> statement-breakpoint
ALTER TABLE public.invoice_lines ENABLE ALWAYS TRIGGER invoice_lines_commission_moved;--> statement-breakpoint

-- A package closed with paid unused value moved (expiry or cancel; 8, 19): its line's sales contributions by the net basis that left the
-- package line: paid − redeemed (unused at close and earlier cheaper-substitution moves; scenarios 8, 12; review r1 P2-1).
CREATE FUNCTION public.commission_package_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.state = 'active' AND NEW.state IN ('expired','cancelled') AND NEW.paid_unused_moved > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    -- cumulative net moved off the package line: what was paid on it less what was redeemed (this includes the earlier cheaper-substitution
    -- moves and excludes the substitution difference lines, which adjust their own lines through moved_to_balance), less the VAT reversed
    PERFORM public.commission_line_moved(NEW.tenant_id, NEW.invoice_line_id,
      greatest(0, public.kasir_line_paid(NEW.tenant_id, NEW.invoice_line_id)
                  - (SELECT coalesce(sum(s.allocated_value), 0) FROM public.package_sessions s WHERE s.tenant_id = NEW.tenant_id AND s.package_id = NEW.id AND s.state = 'redeemed')
                  - NEW.vat_reversed_amount)::bigint,
      'package_close', 'package', NEW.id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_package_closed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER packages_commission_closed AFTER UPDATE OF state ON public.packages FOR EACH ROW EXECUTE FUNCTION public.commission_package_closed();--> statement-breakpoint
ALTER TABLE public.packages ENABLE ALWAYS TRIGGER packages_commission_closed;--> statement-breakpoint

-- A cheaper substitution (12b): the session's net base drops; the package line's sales contributions are reduced by the cumulative drop
-- of all its sessions' bases (session base sum at sale − now).
CREATE FUNCTION public.commission_session_cheaper() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk public.packages;
  v_drop bigint;
BEGIN
  IF NEW.allocated_value < OLD.allocated_value THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.package_id;
    -- the cumulative drop of the sessions' bases against the package line's base (independent of who earns and how much is paid)
    v_drop := greatest((SELECT l.vat_base FROM public.invoice_lines l WHERE l.tenant_id = pk.tenant_id AND l.id = pk.invoice_line_id)
                       - (SELECT coalesce(sum(s.vat_base), 0) FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id), 0)::bigint;
    PERFORM public.commission_line_moved(pk.tenant_id, pk.invoice_line_id, v_drop, 'substitution', 'package_session', NEW.id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_session_cheaper() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_sessions_commission_cheaper AFTER UPDATE OF allocated_value ON public.package_sessions FOR EACH ROW EXECUTE FUNCTION public.commission_session_cheaper();--> statement-breakpoint
ALTER TABLE public.package_sessions ENABLE ALWAYS TRIGGER package_sessions_commission_cheaper;--> statement-breakpoint

-- A write-off (14; BILL-23): every contribution of the written-off lines is reversed and blocked.
CREATE FUNCTION public.commission_write_off() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  FOR c IN SELECT cc.id FROM public.commission_contributions cc
             JOIN public.receivable_lines rl ON rl.tenant_id = cc.tenant_id AND rl.invoice_line_id = cc.invoice_line_id
            WHERE rl.tenant_id = NEW.tenant_id AND rl.receivable_id = NEW.receivable_id ORDER BY cc.id LOOP
    PERFORM public.commission_reverse_contribution(NEW.tenant_id, c, 'write_off', 'write_off', NEW.id);
    UPDATE public.commission_contributions SET blocked = true WHERE tenant_id = NEW.tenant_id AND id = c;
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_write_off() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER write_offs_commission AFTER INSERT ON public.write_offs FOR EACH ROW EXECUTE FUNCTION public.commission_write_off();--> statement-breakpoint
ALTER TABLE public.write_offs ENABLE ALWAYS TRIGGER write_offs_commission;--> statement-breakpoint

-- ── T-087 stage (c): batches, carry-forward, staff receivables, events (r1 P1-6, P1-7; B-13, B-21; SET-44) ──

-- The batch window of a period key (YYYY-MM) under SET-44: month_end → [first of month, first of next month) WIB; day d → [d of the
-- previous month + 1 day, d of this month + 1 day) WIB, i.e. the window closes at the end of day d (Asia/Jakarta).
CREATE FUNCTION public.commission_period(p_tenant uuid, p_key text, OUT period_start timestamptz, OUT period_end timestamptz, OUT closing_day text)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v jsonb := public.setting_value_at('SET-44', NULL, clock_timestamp());
  m date := to_date(p_key || '-01', 'YYYY-MM-DD');
  d integer;
BEGIN
  IF coalesce(v ->> 'k', 'month_end') = 'day' THEN
    d := (v ->> 'v')::integer;
    closing_day := d::text;
    period_start := ((m - interval '1 month') + (d * interval '1 day'))::timestamp AT TIME ZONE 'Asia/Jakarta';
    period_end := (m + (d * interval '1 day'))::timestamp AT TIME ZONE 'Asia/Jakarta';
  ELSE
    closing_day := 'month_end';
    period_start := m::timestamp AT TIME ZONE 'Asia/Jakarta';
    period_end := (m + interval '1 month')::timestamp AT TIME ZONE 'Asia/Jakarta';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_period(uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Guards: batches move draft → pending_approval → approved → paid (pending_approval → draft on rejection); content frozen once
-- submitted; items and lines insert-only (lines written once at submit); staff receivables open → settled|waived once.
CREATE FUNCTION public.payout_batches_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout batches are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'a batch opens as a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.period_key, NEW.period_start, NEW.period_end, NEW.created_by, NEW.created_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.period_key, OLD.period_start, OLD.period_end, OLD.created_by, OLD.created_at, OLD.command_key)
     OR NOT (OLD.state = 'draft' AND NEW.state = 'pending_approval' OR OLD.state = 'pending_approval' AND NEW.state IN ('approved','draft')
             OR OLD.state = 'approved' AND NEW.state = 'paid') THEN
    RAISE EXCEPTION 'a batch moves draft → pending_approval → approved → paid' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payout_batches_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payout_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payout_batches FOR EACH ROW EXECUTE FUNCTION public.payout_batches_guard();--> statement-breakpoint
ALTER TABLE public.payout_batches ENABLE ALWAYS TRIGGER payout_batches_guard;--> statement-breakpoint

CREATE FUNCTION public.commission_insert_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% rows are insert-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_insert_only() FROM PUBLIC;--> statement-breakpoint
-- Entitlements, adjustments, batch items and lines are insert-only (contributions only flip blocked; see below).
CREATE TRIGGER commission_entitlements_insert_only BEFORE UPDATE OR DELETE ON public.commission_entitlements FOR EACH ROW EXECUTE FUNCTION public.commission_insert_only();--> statement-breakpoint
ALTER TABLE public.commission_entitlements ENABLE ALWAYS TRIGGER commission_entitlements_insert_only;--> statement-breakpoint
CREATE TRIGGER commission_adjustments_insert_only BEFORE UPDATE OR DELETE ON public.commission_adjustments FOR EACH ROW EXECUTE FUNCTION public.commission_insert_only();--> statement-breakpoint
ALTER TABLE public.commission_adjustments ENABLE ALWAYS TRIGGER commission_adjustments_insert_only;--> statement-breakpoint
-- Batch items and lines: never updated; deleted only while their batch is a draft (a rejection returned it, r2 P2-3).
CREATE FUNCTION public.payout_batch_children_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR NOT EXISTS (SELECT 1 FROM public.payout_batches b WHERE b.tenant_id = OLD.tenant_id AND b.id = OLD.batch_id AND b.state = 'draft') THEN
    RAISE EXCEPTION '% rows are insert-only; deleted only with a rejected batch', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payout_batch_children_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payout_batch_items_insert_only BEFORE UPDATE OR DELETE ON public.payout_batch_items FOR EACH ROW EXECUTE FUNCTION public.payout_batch_children_guard();--> statement-breakpoint
ALTER TABLE public.payout_batch_items ENABLE ALWAYS TRIGGER payout_batch_items_insert_only;--> statement-breakpoint
CREATE TRIGGER payout_batch_lines_insert_only BEFORE UPDATE OR DELETE ON public.payout_batch_lines FOR EACH ROW EXECUTE FUNCTION public.payout_batch_children_guard();--> statement-breakpoint
ALTER TABLE public.payout_batch_lines ENABLE ALWAYS TRIGGER payout_batch_lines_insert_only;--> statement-breakpoint

-- Contributions: only blocked false → true; never deleted.
CREATE FUNCTION public.commission_contributions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'blocked') IS DISTINCT FROM (to_jsonb(OLD) - 'blocked') OR OLD.blocked AND NOT NEW.blocked THEN
    RAISE EXCEPTION 'a contribution keeps its content; it is only blocked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_contributions_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER commission_contributions_guard BEFORE UPDATE OR DELETE ON public.commission_contributions FOR EACH ROW EXECUTE FUNCTION public.commission_contributions_guard();--> statement-breakpoint
ALTER TABLE public.commission_contributions ENABLE ALWAYS TRIGGER commission_contributions_guard;--> statement-breakpoint

-- Events (P1-6): ids and booleans only.
CREATE FUNCTION public.commission_entitlement_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (NEW.tenant_id, NEW.branch_id, 'CommissionAccrued', 'commission_entitlement', NEW.id,
          jsonb_build_object('entitlement_id', NEW.id, 'contribution_id', NEW.contribution_id, 'staff_id', NEW.staff_id));
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_entitlement_event() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER commission_entitlements_event AFTER INSERT ON public.commission_entitlements FOR EACH ROW EXECUTE FUNCTION public.commission_entitlement_event();--> statement-breakpoint
ALTER TABLE public.commission_entitlements ENABLE ALWAYS TRIGGER commission_entitlements_event;--> statement-breakpoint
CREATE FUNCTION public.commission_adjustment_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (NEW.tenant_id, NEW.branch_id, 'CommissionAdjusted', 'commission_adjustment', NEW.id,
          jsonb_build_object('adjustment_id', NEW.id, 'entitlement_id', NEW.entitlement_id, 'staff_id', NEW.staff_id, 'after_payout', NEW.after_payout));
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_adjustment_event() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER commission_adjustments_event AFTER INSERT ON public.commission_adjustments FOR EACH ROW EXECUTE FUNCTION public.commission_adjustment_event();--> statement-breakpoint
ALTER TABLE public.commission_adjustments ENABLE ALWAYS TRIGGER commission_adjustments_event;--> statement-breakpoint

-- The batch actor: finance or manager open/submit; finance marks paid; capability cashier.
CREATE FUNCTION public.commission_batch_actor(p_roles text[], OUT tenant_id uuid, OUT staff_id uuid, OUT role text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role INTO tenant_id, staff_id, role FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not handle commission batches' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_batch_actor(text[]) FROM PUBLIC;--> statement-breakpoint

-- Open the batch of a period (finance, manager); idempotent per period key.
CREATE FUNCTION public.commission_batch_open(p_key text, p_period text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_batch_actor(ARRAY['finance','manager']);
  w record;
  v_id uuid;
BEGIN
  SELECT b.id INTO v_id FROM public.payout_batches b WHERE b.tenant_id = a.tenant_id AND (b.command_key = p_key OR b.period_key = p_period);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF coalesce(p_period, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  w := public.commission_period(a.tenant_id, p_period);
  IF w.period_end > clock_timestamp() + interval '40 days' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period_in_future' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.payout_batches (tenant_id, period_key, period_start, period_end, closing_day, created_by, command_key)
  VALUES (a.tenant_id, p_period, w.period_start, w.period_end, w.closing_day, a.staff_id, p_key) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_batch_open(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_batch_open(text, text) TO clinic_app;--> statement-breakpoint

-- ── T-087 stage (c): submit, approval sync, mark paid, staff exit (P1-7; B-13, B-21) ──

-- A staff member's carry-forward entering a batch: the carry_forward_out of their latest earlier line, unless that remainder already
-- became a staff receivable (B-21: an exited member's remainder leaves the batch flow).
CREATE FUNCTION public.commission_carry_in(p_tenant uuid, p_staff uuid, p_before timestamptz) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT CASE WHEN EXISTS (SELECT 1 FROM public.staff_commission_receivables r WHERE r.tenant_id = l.tenant_id AND r.source_batch_line_id = l.id)
                               THEN 0 ELSE l.carry_forward_out END
                     FROM public.payout_batch_lines l JOIN public.payout_batches b ON b.tenant_id = l.tenant_id AND b.id = l.batch_id
                    WHERE l.tenant_id = p_tenant AND l.staff_id = p_staff AND b.period_start < p_before
                    ORDER BY b.period_start DESC LIMIT 1), 0)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_carry_in(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Submit: materialize (every entitlement and adjustment before period_end not yet in a batch, and a later before-payout adjustment on an
-- entitlement of this batch; adjustments of entitlements already in a sealed batch are after payout), one line per staff with items or a
-- carry-forward in (raw = gross + adj − cf_in; net = max(0, raw); cf_out = max(0, −raw)), then the commission_batch approval (requesters
-- finance/manager, owner approves; amount = Σ net). A rejection deletes the items and lines (r2 P2-3), so a resubmit materializes afresh.
CREATE FUNCTION public.commission_batch_submit(p_batch uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_batch_actor(ARRAY['finance','manager']);
  b public.payout_batches;
  v_approval uuid;
  v_total bigint;
BEGIN
  SELECT * INTO b FROM public.payout_batches x WHERE x.tenant_id = a.tenant_id AND x.id = p_batch FOR UPDATE;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF b.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_draft' USING ERRCODE = '55000';
  END IF;
  IF b.period_end > clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: period_open' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_batches x WHERE x.tenant_id = b.tenant_id AND x.period_start < b.period_start AND x.state IN ('draft','pending_approval')) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: earlier_batch_open' USING ERRCODE = '55000';
  END IF;
  -- a draft never holds items or lines (they go with a rejection), so the batch always materializes afresh at submit
  BEGIN
    INSERT INTO public.payout_batch_items (tenant_id, batch_id, staff_id, entitlement_id, amount)
    SELECT e.tenant_id, b.id, e.staff_id, e.id, e.amount FROM public.commission_entitlements e
     WHERE e.tenant_id = b.tenant_id AND e.accrued_at < b.period_end AND e.amount > 0
       AND NOT EXISTS (SELECT 1 FROM public.payout_batch_items i WHERE i.tenant_id = e.tenant_id AND i.entitlement_id = e.id);
    -- adjustments up to the period's end, plus a before-payout one made later against an entitlement of this batch (it reduces the unpaid
    -- amount here, r1 P1-7)
    INSERT INTO public.payout_batch_items (tenant_id, batch_id, staff_id, adjustment_id, amount)
    SELECT x.tenant_id, b.id, x.staff_id, x.id, x.amount FROM public.commission_adjustments x
     WHERE x.tenant_id = b.tenant_id
       AND (x.adjusted_at < b.period_end
            OR NOT x.after_payout AND EXISTS (SELECT 1 FROM public.payout_batch_items i WHERE i.tenant_id = x.tenant_id AND i.batch_id = b.id AND i.entitlement_id = x.entitlement_id))
       AND NOT EXISTS (SELECT 1 FROM public.payout_batch_items i WHERE i.tenant_id = x.tenant_id AND i.adjustment_id = x.id);
    INSERT INTO public.payout_batch_lines (tenant_id, batch_id, staff_id, gross, adjustments, carry_forward_in, net_payable, carry_forward_out)
    SELECT b.tenant_id, b.id, s.staff_id, s.gross, s.adj, s.cf_in, greatest(s.gross + s.adj - s.cf_in, 0), greatest(s.cf_in - s.gross - s.adj, 0)
      FROM (SELECT st.staff_id,
                   coalesce(sum(i.amount) FILTER (WHERE i.entitlement_id IS NOT NULL), 0)::bigint AS gross,
                   coalesce(sum(i.amount) FILTER (WHERE i.adjustment_id IS NOT NULL), 0)::bigint AS adj,
                   public.commission_carry_in(b.tenant_id, st.staff_id, b.period_start) AS cf_in
              FROM (SELECT i.staff_id FROM public.payout_batch_items i WHERE i.tenant_id = b.tenant_id AND i.batch_id = b.id
                    UNION
                    SELECT l.staff_id FROM public.payout_batch_lines l WHERE l.tenant_id = b.tenant_id AND l.carry_forward_out > 0
                       AND public.commission_carry_in(b.tenant_id, l.staff_id, b.period_start) > 0) st
              LEFT JOIN public.payout_batch_items i ON i.tenant_id = b.tenant_id AND i.batch_id = b.id AND i.staff_id = st.staff_id
             GROUP BY st.staff_id) s;
  END;
  SELECT coalesce(sum(l.net_payable), 0)::bigint INTO v_total FROM public.payout_batch_lines l WHERE l.tenant_id = b.tenant_id AND l.batch_id = b.id;
  v_approval := public.approval_request('commission_batch', 'payout_batch', b.id, 'Batch komisi ' || b.period_key, NULL, NULLIF(v_total, 0));
  UPDATE public.payout_batches SET state = 'pending_approval', approval_id = v_approval, submitted_by = a.staff_id, submitted_at = clock_timestamp()
   WHERE tenant_id = b.tenant_id AND id = b.id;
  RETURN v_approval;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_batch_submit(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_batch_submit(uuid) TO clinic_app;--> statement-breakpoint

-- commission_batch decided: approved → the batch approved + PayoutBatchApproved; rejected/cancelled → draft (resubmit).
CREATE FUNCTION public.commission_batch_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.type <> 'commission_batch' OR NEW.subject_kind <> 'payout_batch' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF NEW.state = 'approved' THEN
    UPDATE public.payout_batches SET state = 'approved' WHERE tenant_id = NEW.tenant_id AND id = NEW.subject_id AND state = 'pending_approval';
    IF FOUND THEN
      INSERT INTO public.domain_events (tenant_id, type, aggregate_kind, aggregate_id, payload)
      VALUES (NEW.tenant_id, 'PayoutBatchApproved', 'payout_batch', NEW.subject_id, jsonb_build_object('batch_id', NEW.subject_id, 'approval_id', NEW.id));
    END IF;
  ELSE
    -- rejected or cancelled (r2 P2-3): back to draft, and only then its items and lines go, so a resubmit materializes afresh
    UPDATE public.payout_batches SET state = 'draft', submitted_at = NULL, submitted_by = NULL
     WHERE tenant_id = NEW.tenant_id AND id = NEW.subject_id AND state = 'pending_approval';
    IF FOUND THEN
      DELETE FROM public.payout_batch_items WHERE tenant_id = NEW.tenant_id AND batch_id = NEW.subject_id;
      DELETE FROM public.payout_batch_lines WHERE tenant_id = NEW.tenant_id AND batch_id = NEW.subject_id;
    END IF;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_batch_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_commission_batch_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.commission_batch_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_commission_batch_sync;--> statement-breakpoint

-- Tandai Dibayar (finance): approved → paid + CommissionPaid; then B-21 for members already exited with a remainder.
CREATE FUNCTION public.commission_batch_mark_paid(p_batch uuid, p_method text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_batch_actor(ARRAY['finance']);
  b public.payout_batches;
BEGIN
  SELECT * INTO b FROM public.payout_batches x WHERE x.tenant_id = a.tenant_id AND x.id = p_batch FOR UPDATE;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(p_method, '') NOT IN ('cash','transfer') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: method' USING ERRCODE = '22023';
  END IF;
  IF b.state = 'paid' THEN
    RETURN;
  END IF;
  IF b.state <> 'approved' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_approved' USING ERRCODE = '55000';
  END IF;
  UPDATE public.payout_batches SET state = 'paid', paid_by = a.staff_id, paid_at = clock_timestamp(), paid_method = p_method
   WHERE tenant_id = b.tenant_id AND id = b.id;
  INSERT INTO public.domain_events (tenant_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (b.tenant_id, 'CommissionPaid', 'payout_batch', b.id, jsonb_build_object('batch_id', b.id));
  PERFORM public.commission_exit_receivables(b.tenant_id);
  PERFORM public.audit_append('money_correction', 'payout_batch', b.id, 'success', 'commission_batch_paid');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_batch_mark_paid(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_batch_mark_paid(uuid, text) TO clinic_app;--> statement-breakpoint

-- B-21: a member whose membership has ended and whose latest paid line carries a remainder → one open staff receivable for the owner.
CREATE FUNCTION public.commission_exit_receivables(p_tenant uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.staff_commission_receivables (tenant_id, staff_id, source_batch_line_id, amount)
  SELECT l.tenant_id, l.staff_id, l.id, l.carry_forward_out
    FROM public.payout_batch_lines l
    JOIN public.payout_batches b ON b.tenant_id = l.tenant_id AND b.id = l.batch_id AND b.state = 'paid'
    JOIN public.staff s ON s.tenant_id = l.tenant_id AND s.id = l.staff_id
    JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
   WHERE l.tenant_id = p_tenant AND l.carry_forward_out > 0 AND m.effective_to IS NOT NULL AND m.effective_to <= clock_timestamp()
     AND b.period_start = (SELECT max(b2.period_start) FROM public.payout_batch_lines l2 JOIN public.payout_batches b2 ON b2.tenant_id = l2.tenant_id AND b2.id = l2.batch_id
                            WHERE l2.tenant_id = l.tenant_id AND l2.staff_id = l.staff_id)
  ON CONFLICT (tenant_id, source_batch_line_id) DO NOTHING;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_exit_receivables(uuid) FROM PUBLIC;--> statement-breakpoint

-- A membership ended (staff exit) → its remainder, if any, becomes a staff receivable.
CREATE FUNCTION public.commission_membership_ended() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.effective_to IS NOT NULL AND OLD.effective_to IS DISTINCT FROM NEW.effective_to THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
    PERFORM public.commission_exit_receivables(NEW.tenant_id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_membership_ended() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER memberships_commission_exit AFTER UPDATE OF effective_to ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.commission_membership_ended();--> statement-breakpoint
ALTER TABLE public.memberships ENABLE ALWAYS TRIGGER memberships_commission_exit;--> statement-breakpoint

-- The owner decides a staff receivable: settled (recovered outside the batch flow) or waived, with a reason.
CREATE FUNCTION public.staff_commission_receivable_decide(p_id uuid, p_state text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_batch_actor(ARRAY['owner']);
BEGIN
  IF coalesce(p_state, '') NOT IN ('settled','waived') OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: decision' USING ERRCODE = '22023';
  END IF;
  UPDATE public.staff_commission_receivables SET state = p_state, decision_reason = btrim(p_reason), decided_by = a.staff_id, decided_at = clock_timestamp()
   WHERE tenant_id = a.tenant_id AND id = p_id AND state = 'open';
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.staff_commission_receivables r WHERE r.tenant_id = a.tenant_id AND r.id = p_id) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: decided' USING ERRCODE = '55000';
    END IF;
    RAISE EXCEPTION 'ERR_NOT_FOUND: receivable not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('money_correction', 'staff_commission_receivable', p_id, 'success', 'staff_receivable_' || p_state);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_commission_receivable_decide(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_commission_receivable_decide(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- Staff receivables: open → settled|waived once; never deleted.
CREATE FUNCTION public.staff_commission_receivables_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'open'
     OR (NEW.id, NEW.tenant_id, NEW.staff_id, NEW.source_batch_line_id, NEW.amount, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.staff_id, OLD.source_batch_line_id, OLD.amount, OLD.created_at) THEN
    RAISE EXCEPTION 'a staff receivable is decided once and never deleted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_commission_receivables_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER staff_commission_receivables_guard BEFORE UPDATE OR DELETE ON public.staff_commission_receivables FOR EACH ROW EXECUTE FUNCTION public.staff_commission_receivables_guard();--> statement-breakpoint
ALTER TABLE public.staff_commission_receivables ENABLE ALWAYS TRIGGER staff_commission_receivables_guard;--> statement-breakpoint

-- ── T-087 stage (d): readers (UX-16; r1 P2-3). Definers with the reader predicate; no patient data in any commission reader (a line is
-- named by its catalog item and invoice number only); the auditor reads masked (no reasons, no staff names beyond the recipient's). ──

-- The reader: the actor lock first (staff_access; the wall clock, 0048); owner/finance/auditor tenant-wide; manager rules only; anyone
-- with own commission reads own rows; Admin Pusat none (PR-63).
CREATE FUNCTION public.commission_reader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role INTO tenant_id, staff_id, role FROM public.tenant_actor_lock() a;
  IF role = 'admin_pusat' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: commission is not readable' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_reader() FROM PUBLIC;--> statement-breakpoint

-- One line of the per-recipient breakdown: contribution type, item, invoice number, branch, the rule's value, gross and adjustments.
CREATE FUNCTION public.commission_rows_json(p_tenant uuid, p_staff uuid, p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY r ->> 'at', r ->> 'id'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('id', e.id, 'kind', 'entitlement', 'at', e.accrued_at, 'type', c.contribution_type, 'amount', e.amount, 'basis', e.basis,
             'item', (SELECT cv.name FROM public.invoice_lines l JOIN public.catalog_versions cv ON cv.tenant_id = l.tenant_id AND cv.id = l.catalog_version_id
                       WHERE l.tenant_id = c.tenant_id AND l.id = c.invoice_line_id),
             'invoice', (SELECT i.number FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                          WHERE l.tenant_id = c.tenant_id AND l.id = c.invoice_line_id),
             'branch', (SELECT b.name FROM public.branches b WHERE b.tenant_id = e.tenant_id AND b.id = e.branch_id),
             'rule', (SELECT jsonb_build_object('kind', v.kind, 'basis_points', v.basis_points, 'fixed_amount', v.fixed_amount, 'version', v.version)
                        FROM public.commission_rule_versions v WHERE v.tenant_id = c.tenant_id AND v.id = c.rule_version_id)) r
      FROM public.commission_entitlements e JOIN public.commission_contributions c ON c.tenant_id = e.tenant_id AND c.id = e.contribution_id
     WHERE e.tenant_id = p_tenant AND e.staff_id = p_staff AND e.accrued_at >= p_from AND e.accrued_at < p_to
    UNION ALL
    SELECT jsonb_build_object('id', x.id, 'kind', 'adjustment', 'at', x.adjusted_at, 'type', c.contribution_type, 'amount', x.amount, 'cause', x.cause,
             'after_payout', x.after_payout,
             'item', (SELECT cv.name FROM public.invoice_lines l JOIN public.catalog_versions cv ON cv.tenant_id = l.tenant_id AND cv.id = l.catalog_version_id
                       WHERE l.tenant_id = c.tenant_id AND l.id = c.invoice_line_id),
             'invoice', (SELECT i.number FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                          WHERE l.tenant_id = c.tenant_id AND l.id = c.invoice_line_id),
             'branch', (SELECT b.name FROM public.branches b WHERE b.tenant_id = x.tenant_id AND b.id = x.branch_id))
      FROM public.commission_adjustments x JOIN public.commission_entitlements e ON e.tenant_id = x.tenant_id AND e.id = x.entitlement_id
      JOIN public.commission_contributions c ON c.tenant_id = e.tenant_id AND c.id = e.contribution_id
     WHERE x.tenant_id = p_tenant AND x.staff_id = p_staff AND x.adjusted_at >= p_from AND x.adjusted_at < p_to) s(r)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rows_json(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Rekap Komisi & Batch (owner, finance, auditor): the batches by period with state and totals; per batch the lines per recipient.
CREATE FUNCTION public.commission_batches_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_reader();
BEGIN
  IF a.role NOT IN ('owner','finance','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read commission batches' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'staff_id', a.staff_id,
    'can_open', a.role = 'finance', 'can_pay', a.role = 'finance', 'can_approve', a.role = 'owner',
    'batches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'period', b.period_key, 'period_start', b.period_start, 'period_end', b.period_end,
                 'closing_day', b.closing_day, 'state', b.state, 'approval_id', b.approval_id, 'submitted_at', b.submitted_at, 'paid_at', b.paid_at, 'paid_method', b.paid_method,
                 'submitted_by', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = b.tenant_id AND st.id = b.submitted_by),
                 'recipients', (SELECT count(*) FROM public.payout_batch_lines l WHERE l.tenant_id = b.tenant_id AND l.batch_id = b.id),
                 'net_payable', (SELECT coalesce(sum(l.net_payable), 0) FROM public.payout_batch_lines l WHERE l.tenant_id = b.tenant_id AND l.batch_id = b.id),
                 'open_period', b.period_end > clock_timestamp()) ORDER BY b.period_start DESC)
               FROM public.payout_batches b WHERE b.tenant_id = a.tenant_id), '[]'::jsonb),
    -- commission accrued and not yet in a batch (the coming batch)
    'unbatched', jsonb_build_object(
      'gross', coalesce((SELECT sum(e.amount) FROM public.commission_entitlements e WHERE e.tenant_id = a.tenant_id
                          AND NOT EXISTS (SELECT 1 FROM public.payout_batch_items i WHERE i.tenant_id = e.tenant_id AND i.entitlement_id = e.id)), 0),
      'adjustments', coalesce((SELECT sum(x.amount) FROM public.commission_adjustments x WHERE x.tenant_id = a.tenant_id
                          AND NOT EXISTS (SELECT 1 FROM public.payout_batch_items i WHERE i.tenant_id = x.tenant_id AND i.adjustment_id = x.id)), 0)),
    'receivables', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'staff', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = r.tenant_id AND st.id = r.staff_id),
                 'amount', r.amount, 'state', r.state, 'decided_at', r.decided_at,
                 'decision_reason', CASE WHEN a.role = 'auditor' THEN NULL ELSE r.decision_reason END) ORDER BY r.created_at DESC)
               FROM public.staff_commission_receivables r WHERE r.tenant_id = a.tenant_id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_batches_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_batches_list() TO clinic_app;--> statement-breakpoint

-- One batch: per-recipient lines (gross, adjustments, carry-forward in/out, net) with each recipient's items and contribution types.
CREATE FUNCTION public.commission_batch_get(p_batch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_reader();
  b public.payout_batches;
BEGIN
  IF a.role NOT IN ('owner','finance','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read commission batches' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.payout_batches x WHERE x.tenant_id = a.tenant_id AND x.id = p_batch;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('role', a.role,
    'batch', jsonb_build_object('id', b.id, 'period', b.period_key, 'period_start', b.period_start, 'period_end', b.period_end, 'closing_day', b.closing_day,
      'state', b.state, 'approval_id', b.approval_id, 'submitted_at', b.submitted_at, 'paid_at', b.paid_at, 'paid_method', b.paid_method,
      'submitted_by_me', b.submitted_by = a.staff_id, 'open_period', b.period_end > clock_timestamp(),
      'approval_state', (SELECT ap.state FROM public.approvals ap WHERE ap.tenant_id = b.tenant_id AND ap.id = b.approval_id)),
    'can_submit', a.role = 'finance' AND b.state = 'draft' AND b.period_end <= clock_timestamp(),
    'can_approve', a.role = 'owner' AND b.state = 'pending_approval',
    'can_pay', a.role = 'finance' AND b.state = 'approved',
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('staff_id', l.staff_id, 'staff', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = l.tenant_id AND st.id = l.staff_id),
                 'gross', l.gross, 'adjustments', l.adjustments, 'carry_forward_in', l.carry_forward_in, 'net_payable', l.net_payable, 'carry_forward_out', l.carry_forward_out,
                 'types', (SELECT coalesce(jsonb_agg(DISTINCT c.contribution_type), '[]'::jsonb) FROM public.payout_batch_items i
                             LEFT JOIN public.commission_entitlements e ON e.tenant_id = i.tenant_id AND e.id = i.entitlement_id
                             LEFT JOIN public.commission_adjustments x ON x.tenant_id = i.tenant_id AND x.id = i.adjustment_id
                             LEFT JOIN public.commission_entitlements e2 ON e2.tenant_id = x.tenant_id AND e2.id = x.entitlement_id
                             JOIN public.commission_contributions c ON c.tenant_id = i.tenant_id AND c.id = coalesce(e.contribution_id, e2.contribution_id)
                            WHERE i.tenant_id = l.tenant_id AND i.batch_id = l.batch_id AND i.staff_id = l.staff_id)) ORDER BY l.net_payable DESC, l.staff_id)
               FROM public.payout_batch_lines l WHERE l.tenant_id = b.tenant_id AND l.batch_id = b.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_batch_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_batch_get(uuid) TO clinic_app;--> statement-breakpoint

-- Ekspor per penerima (finance, owner, auditor): one row per recipient of a batch, staff identity and amounts only (no patient data).
CREATE FUNCTION public.commission_batch_export(p_batch uuid) RETURNS TABLE (staff_id uuid, staff_name text, gross bigint, adjustments bigint, carry_forward_in bigint,
  net_payable bigint, carry_forward_out bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_reader();
BEGIN
  IF a.role NOT IN ('owner','finance','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not export commission' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payout_batches b WHERE b.tenant_id = a.tenant_id AND b.id = p_batch AND b.state <> 'draft') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('export', 'payout_batch', p_batch, 'success', 'commission_export');
  RETURN QUERY SELECT l.staff_id, st.display_name, l.gross, l.adjustments, l.carry_forward_in, l.net_payable, l.carry_forward_out
    FROM public.payout_batch_lines l JOIN public.staff st ON st.tenant_id = l.tenant_id AND st.id = l.staff_id
   WHERE l.tenant_id = a.tenant_id AND l.batch_id = p_batch ORDER BY st.display_name, l.staff_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_batch_export(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_batch_export(uuid) TO clinic_app;--> statement-breakpoint

-- Komisi Saya: the acting staff member's own rows of a month (WIB), the month's totals, and their batch lines; nobody else's.
CREATE FUNCTION public.commission_mine(p_month text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_reader();
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF coalesce(p_month, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: month' USING ERRCODE = '22023';
  END IF;
  v_from := to_date(p_month || '-01', 'YYYY-MM-DD')::timestamp AT TIME ZONE 'Asia/Jakarta';
  v_to := (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp AT TIME ZONE 'Asia/Jakarta';
  RETURN jsonb_build_object('role', a.role, 'month', p_month,
    'rows', public.commission_rows_json(a.tenant_id, a.staff_id, v_from, v_to),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('period', b.period_key, 'state', b.state, 'gross', l.gross, 'adjustments', l.adjustments,
                 'carry_forward_in', l.carry_forward_in, 'net_payable', l.net_payable, 'carry_forward_out', l.carry_forward_out, 'paid_at', b.paid_at) ORDER BY b.period_start DESC)
               FROM public.payout_batch_lines l JOIN public.payout_batches b ON b.tenant_id = l.tenant_id AND b.id = l.batch_id
              WHERE l.tenant_id = a.tenant_id AND l.staff_id = a.staff_id), '[]'::jsonb),
    'receivables', coalesce((SELECT jsonb_agg(jsonb_build_object('amount', r.amount, 'state', r.state)) FROM public.staff_commission_receivables r
                              WHERE r.tenant_id = a.tenant_id AND r.staff_id = a.staff_id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_mine(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_mine(text) TO clinic_app;--> statement-breakpoint

-- Aturan Komisi (owner, finance, manager, auditor read; owner/finance write): rules with their versions; staff and items named.
CREATE FUNCTION public.commission_rules_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_reader();
BEGIN
  IF a.role NOT IN ('owner','finance','manager','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read commission rules' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'can_prepare', a.role IN ('owner','finance'), 'can_activate', a.role = 'owner',
    'rules', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'contribution_type', r.contribution_type, 'role', r.role, 'category', r.category,
                 'priority', r.priority,
                 'staff', (SELECT jsonb_build_object('id', st.id, 'name', st.display_name) FROM public.staff st WHERE st.tenant_id = r.tenant_id AND st.id = r.staff_id),
                 'item', (SELECT jsonb_build_object('id', ci.id, 'code', ci.code) FROM public.catalog_items ci WHERE ci.tenant_id = r.tenant_id AND ci.id = r.catalog_item_id),
                 'versions', (SELECT jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'kind', v.kind, 'basis_points', v.basis_points, 'fixed_amount', v.fixed_amount,
                                'effective_from', v.effective_from, 'state', v.state, 'ended_at', v.ended_at,
                                'in_force', v.state IN ('active','superseded') AND v.effective_from <= clock_timestamp() AND (v.ended_at IS NULL OR v.ended_at > clock_timestamp()),
                                'ended', v.ended_at IS NOT NULL AND v.ended_at <= clock_timestamp(),
                                'prepared_by', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = v.tenant_id AND st.id = v.prepared_by)) ORDER BY v.version DESC)
                                FROM public.commission_rule_versions v WHERE v.tenant_id = r.tenant_id AND v.rule_id = r.id)) ORDER BY r.contribution_type, r.priority DESC, r.created_at)
               FROM public.commission_rules r WHERE r.tenant_id = a.tenant_id), '[]'::jsonb),
    'staff', CASE WHEN a.role IN ('owner','finance') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id', st.id, 'name', st.display_name) ORDER BY st.display_name)
               FROM public.staff st WHERE st.tenant_id = a.tenant_id AND EXISTS (SELECT 1 FROM public.staff_roles sr WHERE sr.tenant_id = st.tenant_id AND sr.staff_id = st.id AND sr.role <> 'owner')), '[]'::jsonb) ELSE '[]'::jsonb END,
    -- the catalog items in force (an item-scoped rule; the simulator): finance and the auditor do not read the catalog directly
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.item_id, 'name', x.name) ORDER BY x.name, x.item_id)
               FROM (SELECT DISTINCT ON (cv.item_id) cv.item_id, cv.name FROM public.catalog_versions cv
                      WHERE cv.tenant_id = a.tenant_id AND cv.state = 'active' ORDER BY cv.item_id, cv.version DESC) x), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rules_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_rules_list() TO clinic_app;--> statement-breakpoint

-- Simulator (read-only; P2-2): for a sale of an item at a price and instant, the rule version and rupiah each contributor would earn
-- (net of VAT, full payment). p: {item_id, price, at?, closing_bc_staff_id?, guiding_bc_staff_id?, registrar_staff_id?, performer_staff_id?}.
CREATE FUNCTION public.commission_rule_simulate(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.commission_reader();
  v_item uuid;
  v_version uuid;
  v_price bigint;
  v_at timestamptz;
  v_base bigint;
  v_cat text;
  v_tax text;
  v_out jsonb := '[]'::jsonb;
  t record;
  v_rule uuid;
  rv public.commission_rule_versions;
BEGIN
  IF a.role NOT IN ('owner','finance','manager','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not simulate commission' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_item := (p ->> 'item_id')::uuid;
    v_price := (p ->> 'price')::bigint;
    v_at := coalesce((p ->> 'at')::timestamptz, clock_timestamp());
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: simulation' USING ERRCODE = '22023';
  END;
  IF v_item IS NULL OR v_price IS NULL OR v_price NOT BETWEEN 1 AND 1000000000000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: simulation' USING ERRCODE = '22023';
  END IF;
  SELECT cv.id, cv.category, cv.tax_category INTO v_version, v_cat, v_tax FROM public.catalog_versions cv
   WHERE cv.tenant_id = a.tenant_id AND cv.item_id = v_item AND cv.state = 'active' ORDER BY cv.version DESC LIMIT 1;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: item not found' USING ERRCODE = 'P0002';
  END IF;
  v_base := (public.tax_vat_split(v_price, v_tax, coalesce(public.tax_pkp_at(a.tenant_id, v_at, NULL), false))).base;
  FOR t IN SELECT x.type, (p ->> x.k)::uuid AS staff FROM (VALUES ('closing_bc', 'closing_bc_staff_id'), ('guiding_bc', 'guiding_bc_staff_id'),
                                                              ('new_patient', 'registrar_staff_id'), ('performer', 'performer_staff_id')) x(type, k)
            WHERE p ? x.k LOOP
    CONTINUE WHEN NOT t.type = ANY (public.commission_item_scopes(a.tenant_id, v_version));
    v_rule := public.commission_rule_at(a.tenant_id, t.type, t.staff, public.commission_staff_role(a.tenant_id, t.staff, t.type), v_item, v_cat, false, v_at);
    SELECT * INTO rv FROM public.commission_rule_versions x WHERE x.tenant_id = a.tenant_id AND x.id = v_rule;
    v_out := v_out || jsonb_build_object('type', t.type, 'staff_id', t.staff, 'rule_version_id', v_rule,
      'kind', rv.kind, 'basis_points', rv.basis_points, 'fixed_amount', rv.fixed_amount,
      'amount', CASE WHEN rv.id IS NULL THEN 0 WHEN rv.kind = 'fixed' THEN rv.fixed_amount ELSE (v_base * rv.basis_points + 5000) / 10000 END);
  END LOOP;
  RETURN jsonb_build_object('basis', v_base, 'contributions', v_out);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commission_rule_simulate(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commission_rule_simulate(jsonb) TO clinic_app;
