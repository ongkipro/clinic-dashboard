CREATE TABLE "dispensing_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"dispensing_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	CONSTRAINT "dispensing_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dispensing_lines_batch_key" UNIQUE("tenant_id","dispensing_id","batch_id"),
	CONSTRAINT "dispensing_lines_check" CHECK ("dispensing_lines"."quantity" between 0.0001 and 1000000000 and scale("dispensing_lines"."quantity") <= 4)
);
--> statement-breakpoint
CREATE TABLE "dispensings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"selection_item_id" uuid,
	"prescription_item_id" uuid,
	"stock_item_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"external_use" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"depot_id" uuid,
	"queued_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"prepared_at" timestamp with time zone,
	"prepared_by" uuid,
	"prepare_key" text,
	"handed_at" timestamp with time zone,
	"handed_by" uuid,
	"hand_key" text,
	"checks" jsonb,
	"exception_note" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	CONSTRAINT "dispensings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dispensings_scope_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "dispensings_selection_item_key" UNIQUE("tenant_id","selection_item_id"),
	CONSTRAINT "dispensings_prescription_item_key" UNIQUE("tenant_id","prescription_item_id"),
	CONSTRAINT "dispensings_prepare_key" UNIQUE("tenant_id","prepare_key"),
	CONSTRAINT "dispensings_hand_key" UNIQUE("tenant_id","hand_key"),
	CONSTRAINT "dispensings_check" CHECK ("dispensings"."state" in ('queued','prepared','handed','cancelled') and "dispensings"."quantity" between 0.0001 and 1000000000 and scale("dispensings"."quantity") <= 4
      and num_nonnulls("dispensings"."selection_item_id", "dispensings"."prescription_item_id") = 1
      and num_nonnulls("dispensings"."prepared_at", "dispensings"."prepared_by", "dispensings"."prepare_key", "dispensings"."depot_id") in (0, 4)
      and num_nonnulls("dispensings"."handed_at", "dispensings"."handed_by", "dispensings"."hand_key", "dispensings"."checks") in (0, 4)
      and num_nonnulls("dispensings"."cancelled_at", "dispensings"."cancelled_by", "dispensings"."cancel_reason") in (0, 3)
      and (("dispensings"."state" in ('prepared','handed')) <= ("dispensings"."prepared_at" is not null))
      and (("dispensings"."state" = 'handed') = ("dispensings"."handed_at" is not null)) and (("dispensings"."state" = 'cancelled') = ("dispensings"."cancelled_at" is not null))
      and ("dispensings"."prepare_key" is null or "dispensings"."prepare_key" ~ '^[A-Za-z0-9_.:-]{8,128}$') and ("dispensings"."hand_key" is null or "dispensings"."hand_key" ~ '^[A-Za-z0-9_.:-]{8,128}$')
      and ("dispensings"."checks" is null or jsonb_typeof("dispensings"."checks") = 'object')
      and ("dispensings"."exception_note" is null or length(btrim("dispensings"."exception_note")) between 3 and 500) and ("dispensings"."exception_note" is null or "dispensings"."handed_at" is not null)
      and ("dispensings"."cancel_reason" is null or length(btrim("dispensings"."cancel_reason")) between 3 and 300))
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"dispensing_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"print_count" integer DEFAULT 1 NOT NULL,
	"first_printed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_printed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_printed_by" uuid NOT NULL,
	CONSTRAINT "labels_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "labels_dispensing_key" UNIQUE("tenant_id","dispensing_id"),
	CONSTRAINT "labels_check" CHECK ("labels"."kind" in ('internal','external_use') and "labels"."print_count" between 1 and 1000 and "labels"."last_printed_at" >= "labels"."first_printed_at")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_recipe_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"set_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"set_by" uuid NOT NULL,
	CONSTRAINT "pharmacy_recipe_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "pharmacy_recipe_items_row_key" UNIQUE("tenant_id","catalog_version_id","row_index"),
	CONSTRAINT "pharmacy_recipe_items_check" CHECK ("pharmacy_recipe_items"."row_index" between 0 and 49 and "pharmacy_recipe_items"."quantity" between 0.0001 and 1000000000 and scale("pharmacy_recipe_items"."quantity") <= 4)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_special_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"added_by" uuid NOT NULL,
	CONSTRAINT "pharmacy_special_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "pharmacy_special_items_item_key" UNIQUE("tenant_id","catalog_item_id"),
	CONSTRAINT "pharmacy_special_items_check" CHECK (length(btrim("pharmacy_special_items"."reason")) between 3 and 300)
);
--> statement-breakpoint
CREATE TABLE "prescription_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"kfa_code" text,
	"signa" text NOT NULL,
	"quantity" numeric NOT NULL,
	"external_use" boolean DEFAULT false NOT NULL,
	"added_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "prescription_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "prescription_items_scope_key" UNIQUE("tenant_id","branch_id","visit_id","id"),
	CONSTRAINT "prescription_items_check" CHECK ("prescription_items"."quantity" between 0.0001 and 1000000000 and scale("prescription_items"."quantity") <= 4 and length(btrim("prescription_items"."signa")) between 3 and 200
      and ("prescription_items"."kfa_code" is null or "prescription_items"."kfa_code" ~ '^[0-9A-Za-z.-]{3,40}$'))
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"prescriber_staff_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"is_acute" boolean DEFAULT false NOT NULL,
	"command_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"signed_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"set48_snapshot" jsonb,
	CONSTRAINT "prescriptions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "prescriptions_scope_key" UNIQUE("tenant_id","branch_id","visit_id","id"),
	CONSTRAINT "prescriptions_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "prescriptions_check" CHECK ("prescriptions"."state" in ('draft','signed') and "prescriptions"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and (("prescriptions"."state" = 'signed') = ("prescriptions"."signed_at" is not null)) and num_nonnulls("prescriptions"."signed_at", "prescriptions"."valid_until", "prescriptions"."set48_snapshot") in (0, 3)
      and ("prescriptions"."valid_until" is null or "prescriptions"."valid_until" > "prescriptions"."signed_at"))
);
--> statement-breakpoint
CREATE TABLE "selection_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"selection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"plan_item_id" uuid,
	"catalog_version_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"material_request_id" uuid,
	CONSTRAINT "selection_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "selection_items_scope_key" UNIQUE("tenant_id","branch_id","visit_id","id"),
	CONSTRAINT "selection_items_plan_item_key" UNIQUE("tenant_id","selection_id","plan_item_id"),
	CONSTRAINT "selection_items_request_key" UNIQUE("tenant_id","material_request_id"),
	CONSTRAINT "selection_items_check" CHECK ("selection_items"."kind" in ('service','product') and "selection_items"."quantity" between 0.0001 and 1000000000 and scale("selection_items"."quantity") <= 4
      and ("selection_items"."material_request_id" is null or "selection_items"."kind" = 'service'))
);
--> statement-breakpoint
CREATE TABLE "selections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"guiding_bc_staff_id" uuid,
	"closing_bc_staff_id" uuid,
	"signature_ref" text,
	"command_key" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_as" text NOT NULL,
	CONSTRAINT "selections_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "selections_scope_key" UNIQUE("tenant_id","branch_id","visit_id","id"),
	CONSTRAINT "selections_visit_key" UNIQUE("tenant_id","visit_id"),
	CONSTRAINT "selections_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "selections_check" CHECK ("selections"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "selections"."confirmed_as" in ('bc','doctor','fo_cashier')
      and ("selections"."signature_ref" is null or length("selections"."signature_ref") between 8 and 200))
);
--> statement-breakpoint
CREATE TABLE "stock_batch_holds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"by" uuid NOT NULL,
	"as" text NOT NULL,
	CONSTRAINT "stock_batch_holds_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_batch_holds_check" CHECK ("stock_batch_holds"."from_state" in ('active','quarantined','temperature_excursion','recalled') and "stock_batch_holds"."to_state" in ('active','quarantined','temperature_excursion','recalled')
      and "stock_batch_holds"."from_state" <> "stock_batch_holds"."to_state" and "stock_batch_holds"."as" = 'pharmacist' and length(btrim("stock_batch_holds"."reason")) between 3 and 300)
);
--> statement-breakpoint
ALTER TABLE "stock_batches" DROP CONSTRAINT "stock_batches_state_check";--> statement-breakpoint
ALTER TABLE "dispensing_lines" ADD CONSTRAINT "dispensing_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensing_lines" ADD CONSTRAINT "dispensing_lines_dispensing_fk" FOREIGN KEY ("tenant_id","branch_id","dispensing_id") REFERENCES "public"."dispensings"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensing_lines" ADD CONSTRAINT "dispensing_lines_batch_fk" FOREIGN KEY ("tenant_id","branch_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_selection_item_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id","selection_item_id") REFERENCES "public"."selection_items"("tenant_id","branch_id","visit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_prescription_item_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id","prescription_item_id") REFERENCES "public"."prescription_items"("tenant_id","branch_id","visit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_item_fk" FOREIGN KEY ("tenant_id","stock_item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_depot_fk" FOREIGN KEY ("tenant_id","branch_id","depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_prepared_by_fk" FOREIGN KEY ("tenant_id","prepared_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_handed_by_fk" FOREIGN KEY ("tenant_id","handed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_cancelled_by_fk" FOREIGN KEY ("tenant_id","cancelled_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_dispensing_fk" FOREIGN KEY ("tenant_id","branch_id","dispensing_id") REFERENCES "public"."dispensings"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_by_fk" FOREIGN KEY ("tenant_id","last_printed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_recipe_items" ADD CONSTRAINT "pharmacy_recipe_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_recipe_items" ADD CONSTRAINT "pharmacy_recipe_items_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_recipe_items" ADD CONSTRAINT "pharmacy_recipe_items_item_fk" FOREIGN KEY ("tenant_id","stock_item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_recipe_items" ADD CONSTRAINT "pharmacy_recipe_items_by_fk" FOREIGN KEY ("tenant_id","set_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_special_items" ADD CONSTRAINT "pharmacy_special_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_special_items" ADD CONSTRAINT "pharmacy_special_items_item_fk" FOREIGN KEY ("tenant_id","catalog_item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_special_items" ADD CONSTRAINT "pharmacy_special_items_by_fk" FOREIGN KEY ("tenant_id","added_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id","prescription_id") REFERENCES "public"."prescriptions"("tenant_id","branch_id","visit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_item_fk" FOREIGN KEY ("tenant_id","stock_item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescriber_fk" FOREIGN KEY ("tenant_id","prescriber_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_items" ADD CONSTRAINT "selection_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_items" ADD CONSTRAINT "selection_items_selection_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id","selection_id") REFERENCES "public"."selections"("tenant_id","branch_id","visit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_items" ADD CONSTRAINT "selection_items_plan_item_fk" FOREIGN KEY ("tenant_id","plan_item_id") REFERENCES "public"."plan_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_items" ADD CONSTRAINT "selection_items_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_items" ADD CONSTRAINT "selection_items_request_fk" FOREIGN KEY ("tenant_id","visit_id","material_request_id") REFERENCES "public"."material_requests"("tenant_id","visit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_guiding_fk" FOREIGN KEY ("tenant_id","guiding_bc_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_closing_fk" FOREIGN KEY ("tenant_id","closing_bc_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_by_fk" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_holds" ADD CONSTRAINT "stock_batch_holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_holds" ADD CONSTRAINT "stock_batch_holds_batch_fk" FOREIGN KEY ("tenant_id","branch_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_holds" ADD CONSTRAINT "stock_batch_holds_by_fk" FOREIGN KEY ("tenant_id","by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_holds" ADD CONSTRAINT "stock_batch_holds_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispensing_lines_batch_idx" ON "dispensing_lines" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "dispensings_queue_idx" ON "dispensings" USING btree ("tenant_id","branch_id","state","queued_at");--> statement-breakpoint
CREATE INDEX "prescriptions_visit_idx" ON "prescriptions" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE INDEX "stock_batch_holds_batch_idx" ON "stock_batch_holds" USING btree ("tenant_id","batch_id","at");--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_state_check" CHECK ("stock_batches"."state" in ('active','quarantined','temperature_excursion','recalled')
      and (("stock_batches"."state" = 'active') = ("stock_batches"."hold_reason" is null)) and num_nonnulls("stock_batches"."hold_reason", "stock_batches"."held_by", "stock_batches"."held_at") in (0, 3)
      and ("stock_batches"."hold_reason" is null or length(btrim("stock_batches"."hold_reason")) between 3 and 300));--> statement-breakpoint

-- T-065 rules (generated by gen.py; plan docs/tasks/T-065.md)
-- ── Readers' predicates (P2-2) ───────────────────────────────────────────────────────────────────────────────
-- Prescriptions, dispensings, lines and labels (clinical, DEC-056 "Resep"): pharmacist, doctor, facility head, records
-- officer at their branch, on the wall clock.
CREATE FUNCTION public.pharmacy_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant)
    AND public.app_role_in(ARRAY['pharmacist','doctor','facility_head','records_officer'])
    AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pharmacy_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Selections (personal, commercial): the Level 2 money and oversight roles; the branch roles at their branch.
CREATE FUNCTION public.selection_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
    public.app_role_in(ARRAY['owner','admin_pusat','finance','auditor'])
    OR public.app_role_in(ARRAY['manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist']) AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.selection_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.selection_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Recipe map and special list (config): the stock readers plus doctor and facility head.
CREATE FUNCTION public.pharmacy_config_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_item_readable(p_tenant)
    OR public.app_role_in(ARRAY['doctor','facility_head']) AND public.stock_member_now(p_tenant), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_config_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pharmacy_config_readable(uuid) TO clinic_app;--> statement-breakpoint

-- ── Actor: the staff_access lock first (DEC-043), the role, the tenant serving visits, the active branch ─────
CREATE FUNCTION public.pharmacy_actor(p_roles text[], OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not use the pharmacy' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.tenant_capability('existing_appointment') OR public.tenant_capability('configuration')) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the pharmacy is not available now' USING ERRCODE = '42501';
  END IF;
  IF branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = pharmacy_actor.tenant_id AND b.id = pharmacy_actor.branch_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an active branch is needed' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_actor(text[]) FROM PUBLIC;--> statement-breakpoint

-- The visit at the actor's branch, locked (lock order: staff_access → visit → selection / prescription → dispensing →
-- batches → holdings).
CREATE FUNCTION public.pharmacy_visit_locked(p_tenant uuid, p_branch uuid, p_visit uuid) RETURNS public.visits
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.visits;
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = p_tenant AND x.id = p_visit FOR UPDATE;
  IF NOT FOUND OR v.branch_id <> p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_visit_locked(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A catalog item on the special list (narcotics, psychotropics: PR-18, never prescribed or dispensed).
CREATE FUNCTION public.pharmacy_special(p_tenant uuid, p_catalog_item uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.pharmacy_special_items s WHERE s.tenant_id = p_tenant AND s.catalog_item_id = p_catalog_item)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_special(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The rows of a service version's recipe (0055: free text) with their mapping (P1-1): the stock item and its quantity
-- times p_qty (rounded to the 4 decimals of a stock quantity), null when the row is not mapped yet.
CREATE FUNCTION public.pharmacy_recipe_lines(p_tenant uuid, p_version uuid, p_qty numeric)
RETURNS TABLE (row_index integer, material text, unit text, recipe_qty numeric, stock_item_id uuid, quantity numeric)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (x.ord - 1)::integer, btrim(x.e ->> 'material'), btrim(x.e ->> 'unit'), (x.e ->> 'qty')::numeric, m.stock_item_id,
         CASE WHEN m.stock_item_id IS NOT NULL THEN round(m.quantity * p_qty, 4) END
    FROM public.catalog_versions cv
   CROSS JOIN LATERAL jsonb_array_elements(cv.material_formula) WITH ORDINALITY x(e, ord)
    LEFT JOIN public.pharmacy_recipe_items m ON m.tenant_id = cv.tenant_id AND m.catalog_version_id = cv.id AND m.row_index = x.ord - 1
   WHERE cv.tenant_id = p_tenant AND cv.id = p_version
   ORDER BY x.ord
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_recipe_lines(uuid, uuid, numeric) FROM PUBLIC;--> statement-breakpoint

-- The room depot for a visit's treatment materials (P1-1): the active ruang depot of the treatment room reserved for
-- the visit's appointment, else the branch's first active ruang depot; null when the branch has none.
CREATE FUNCTION public.pharmacy_room_depot(p_tenant uuid, p_branch uuid, p_appointment uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT d.id FROM public.resource_reservations rr
       JOIN public.depots d ON d.tenant_id = rr.tenant_id AND d.branch_id = rr.branch_id AND d.room_id = rr.resource_id AND d.kind = 'ruang' AND d.active
      WHERE p_appointment IS NOT NULL AND rr.tenant_id = p_tenant AND rr.appointment_id = p_appointment AND rr.kind = 'room'
      ORDER BY rr.active DESC, d.created_at, d.id LIMIT 1),
    (SELECT d.id FROM public.depots d WHERE d.tenant_id = p_tenant AND d.branch_id = p_branch AND d.kind = 'ruang' AND d.active
      ORDER BY d.created_at, d.id LIMIT 1))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_room_depot(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The FEFO suggestion for p_qty of an item in a depot, aggregated per batch (P1-3), or null when the depot cannot
-- cover it with fit stock.
CREATE FUNCTION public.pharmacy_fefo_hint(p_tenant uuid, p_depot uuid, p_item uuid, p_qty numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN (SELECT jsonb_agg(jsonb_build_object('batch_id', b.id, 'batch_no', b.batch_no, 'expiry', b.expiry, 'quantity', f.q) ORDER BY b.expiry, b.received_at, b.id)
            FROM (SELECT g.batch_id, sum(g.take) q FROM public.stock_fefo_depot(p_tenant, p_depot, p_item, p_qty) g GROUP BY g.batch_id) f
            JOIN public.stock_batches b ON b.tenant_id = p_tenant AND b.id = f.batch_id);
EXCEPTION WHEN SQLSTATE 'P0422' OR SQLSTATE '22023' THEN
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_fefo_hint(uuid, uuid, uuid, numeric) FROM PUBLIC;--> statement-breakpoint

-- The default depot to dispense from (P1-3): the branch's first active apotek depot that covers the quantity with fit
-- stock, else the branch's default gudang.
CREATE FUNCTION public.pharmacy_dispense_depot(p_tenant uuid, p_branch uuid, p_item uuid, p_qty numeric) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT d.id FROM public.depots d WHERE d.tenant_id = p_tenant AND d.branch_id = p_branch AND d.kind = 'apotek' AND d.active
        AND public.pharmacy_fefo_hint(p_tenant, d.id, p_item, p_qty) IS NOT NULL
      ORDER BY d.created_at, d.id LIMIT 1),
    public.depot_default(p_tenant, p_branch))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_dispense_depot(uuid, uuid, uuid, numeric) FROM PUBLIC;--> statement-breakpoint

-- The visit's preparation and dispensing steps (P2-3, CLIN-025), recomputed by every pharmacy writer and by the
-- material-request trigger. Preparation: in progress while a request is open or a selected treatment with a recipe has
-- no live request; done once there were requests or selected treatments and none is pending. Dispensing: in progress while a
-- dispensing is queued or prepared (visits_guard then refuses closing); done when one was handed and none is pending;
-- not needed when every one was cancelled. Untouched otherwise and on a closed visit.
CREATE FUNCTION public.pharmacy_visit_steps(p_tenant uuid, p_visit uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_prep text;
  v_disp text;
BEGIN
  v_prep := CASE
    WHEN EXISTS (SELECT 1 FROM public.material_requests r WHERE r.tenant_id = p_tenant AND r.visit_id = p_visit AND r.state = 'open')
      OR EXISTS (SELECT 1 FROM public.selection_items i JOIN public.catalog_versions cv ON cv.tenant_id = i.tenant_id AND cv.id = i.catalog_version_id
                  WHERE i.tenant_id = p_tenant AND i.visit_id = p_visit AND i.kind = 'service' AND jsonb_array_length(cv.material_formula) > 0
                    AND NOT EXISTS (SELECT 1 FROM public.material_requests r WHERE r.tenant_id = i.tenant_id AND r.id = i.material_request_id AND r.state <> 'cancelled'))
      THEN 'in_progress'
    WHEN EXISTS (SELECT 1 FROM public.material_requests r WHERE r.tenant_id = p_tenant AND r.visit_id = p_visit AND r.state <> 'cancelled')
      OR EXISTS (SELECT 1 FROM public.selection_items i WHERE i.tenant_id = p_tenant AND i.visit_id = p_visit AND i.kind = 'service')
      THEN 'done' END;
  v_disp := CASE
    WHEN EXISTS (SELECT 1 FROM public.dispensings d WHERE d.tenant_id = p_tenant AND d.visit_id = p_visit AND d.state IN ('queued','prepared')) THEN 'in_progress'
    WHEN EXISTS (SELECT 1 FROM public.dispensings d WHERE d.tenant_id = p_tenant AND d.visit_id = p_visit AND d.state = 'handed') THEN 'done'
    WHEN EXISTS (SELECT 1 FROM public.dispensings d WHERE d.tenant_id = p_tenant AND d.visit_id = p_visit) THEN 'not_needed' END;
  UPDATE public.visits SET preparation = coalesce(v_prep, preparation), dispensing = coalesce(v_disp, dispensing)
   WHERE tenant_id = p_tenant AND id = p_visit AND closed_at IS NULL
     AND (preparation IS DISTINCT FROM coalesce(v_prep, preparation) OR dispensing IS DISTINCT FROM coalesce(v_disp, dispensing));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_visit_steps(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A dispensing's prescription when it is not dispensable (signed and in date): 'prescription_unsigned' or
-- 'prescription_expired'; null for a product of a selection or a valid prescription.
CREATE FUNCTION public.pharmacy_rx_blocker(d public.dispensings, p_at timestamptz DEFAULT clock_timestamp()) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN rx.id IS NULL THEN NULL WHEN rx.state <> 'signed' THEN 'prescription_unsigned' WHEN rx.valid_until <= p_at THEN 'prescription_expired' END
    FROM (SELECT d.prescription_item_id) s
    LEFT JOIN public.prescription_items pi ON pi.tenant_id = d.tenant_id AND pi.id = s.prescription_item_id
    LEFT JOIN public.prescriptions rx ON rx.tenant_id = pi.tenant_id AND rx.id = pi.prescription_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_rx_blocker(public.dispensings, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- ── Batch states (P1-2): temperature_excursion holds like quarantine; every transition keeps its reason ──────
-- Re-created from 0077 (drift-tested): the unfit reason, the batch guard and the hold writer.
CREATE OR REPLACE FUNCTION public.stock_unfit_reason(b public.stock_batches, p_at timestamptz DEFAULT clock_timestamp()) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN b.state = 'recalled' THEN 'recalled'
              WHEN b.state = 'quarantined' THEN 'quarantined'
              WHEN b.state = 'temperature_excursion' THEN 'temperature_excursion'
              WHEN b.expiry <= public.stock_local_date(b.tenant_id, b.branch_id, p_at) THEN 'expired' END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.stock_batches_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  m public.stock_movements;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock batches are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity <> 0 OR NEW.state <> 'active' THEN
      RAISE EXCEPTION 'a batch opens empty and active; stock enters by a movement' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.branch_id, NEW.item_id, NEW.batch_no, NEW.expiry, NEW.received_at, NEW.id)
     IS DISTINCT FROM (OLD.tenant_id, OLD.branch_id, OLD.item_id, OLD.batch_no, OLD.expiry, OLD.received_at, OLD.id) THEN
    RAISE EXCEPTION 'a batch keeps its identity' USING ERRCODE = '42501';
  END IF;
  IF NEW.quantity <> OLD.quantity THEN
    SELECT * INTO m FROM public.stock_movements WHERE tenant_id = NEW.tenant_id AND batch_id = NEW.id ORDER BY seq DESC LIMIT 1;
    IF NOT FOUND OR m.balance_after <> NEW.quantity OR m.balance_after - m.quantity <> OLD.quantity THEN
      RAISE EXCEPTION 'a batch quantity changes only by its movement' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state OR NEW.hold_reason IS DISTINCT FROM OLD.hold_reason
     OR NEW.held_by IS DISTINCT FROM OLD.held_by OR NEW.held_at IS DISTINCT FROM OLD.held_at THEN
    IF OLD.state = 'recalled' OR NEW.state = OLD.state
       OR NOT (OLD.state = 'active' AND NEW.state IN ('quarantined','temperature_excursion','recalled')
               OR OLD.state IN ('quarantined','temperature_excursion') AND NEW.state IN ('active','recalled')) THEN
      RAISE EXCEPTION 'a batch hold moves active → quarantined | temperature_excursion → active or recalled; recalled is final' USING ERRCODE = '42501';
    END IF;
    -- The newest history row of the batch (uuid v7: time-ordered) is this transition (P1-2).
    IF NOT EXISTS (SELECT 1 FROM (SELECT hh.from_state, hh.to_state FROM public.stock_batch_holds hh
                                   WHERE hh.tenant_id = NEW.tenant_id AND hh.batch_id = NEW.id ORDER BY hh.at DESC, hh.id DESC LIMIT 1) x
                    WHERE x.from_state = OLD.state AND x.to_state = NEW.state) THEN
      RAISE EXCEPTION 'a batch hold or release is recorded with its reason first' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Karantina / Suhu Menyimpang / Tarik / Lepas (PR-18): the pharmacist at the batch's branch; a reason (3–300) for every
-- transition, release included, kept in stock_batch_holds; recalled is final. Validation order keeps 0077's answer
-- for a release of a recalled batch (version conflict before the reason).
CREATE OR REPLACE FUNCTION public.stock_batch_hold(p_batch uuid, p_state text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist'], 'operations', NULL);
  b public.stock_batches;
BEGIN
  SELECT * INTO b FROM public.stock_batches x WHERE x.tenant_id = a.tenant_id AND x.id = p_batch FOR UPDATE;
  IF NOT FOUND OR b.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('quarantined','temperature_excursion','recalled','active') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: state or reason' USING ERRCODE = '22023';
  END IF;
  IF b.state = 'recalled' OR b.state = p_state OR b.state <> 'active' AND p_state NOT IN ('active','recalled') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: batch already %', b.state USING ERRCODE = '55000';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: state or reason' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.stock_batch_holds (tenant_id, branch_id, batch_id, from_state, to_state, reason, by, "as")
  VALUES (b.tenant_id, b.branch_id, b.id, b.state, p_state, btrim(p_reason), a.staff_id, a.role);
  UPDATE public.stock_batches
     SET state = p_state,
         hold_reason = CASE WHEN p_state = 'active' THEN NULL ELSE btrim(p_reason) END,
         held_by = CASE WHEN p_state = 'active' THEN NULL ELSE a.staff_id END,
         held_at = CASE WHEN p_state = 'active' THEN NULL ELSE clock_timestamp() END
   WHERE tenant_id = b.tenant_id AND id = b.id;
  PERFORM public.audit_append('settings_change', 'stock_batch', b.id, 'success', 'stock_batch_' || p_state);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (b.branch_id, 'StockBatchHeld', 'stock_batch', b.id, jsonb_build_object('batch_id', b.id, 'state', p_state));
END
$$;--> statement-breakpoint

ALTER TABLE public.selections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY selections_read ON public.selections FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.selection_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.selections TO clinic_app;--> statement-breakpoint
CREATE POLICY selections_operator_read ON public.selections FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.selections', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.selections TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER selections_no_truncate BEFORE TRUNCATE ON public.selections FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.selections ENABLE ALWAYS TRIGGER selections_no_truncate;--> statement-breakpoint
ALTER TABLE public.selection_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY selection_items_read ON public.selection_items FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.selection_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.selection_items TO clinic_app;--> statement-breakpoint
CREATE POLICY selection_items_operator_read ON public.selection_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.selection_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.selection_items TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER selection_items_no_truncate BEFORE TRUNCATE ON public.selection_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.selection_items ENABLE ALWAYS TRIGGER selection_items_no_truncate;--> statement-breakpoint
ALTER TABLE public.pharmacy_recipe_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pharmacy_recipe_items_read ON public.pharmacy_recipe_items FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.pharmacy_config_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.pharmacy_recipe_items TO clinic_app;--> statement-breakpoint
CREATE POLICY pharmacy_recipe_items_operator_read ON public.pharmacy_recipe_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.pharmacy_recipe_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.pharmacy_recipe_items TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER pharmacy_recipe_items_no_truncate BEFORE TRUNCATE ON public.pharmacy_recipe_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.pharmacy_recipe_items ENABLE ALWAYS TRIGGER pharmacy_recipe_items_no_truncate;--> statement-breakpoint
ALTER TABLE public.pharmacy_special_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pharmacy_special_items_read ON public.pharmacy_special_items FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.pharmacy_config_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.pharmacy_special_items TO clinic_app;--> statement-breakpoint
CREATE POLICY pharmacy_special_items_operator_read ON public.pharmacy_special_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.pharmacy_special_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.pharmacy_special_items TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER pharmacy_special_items_no_truncate BEFORE TRUNCATE ON public.pharmacy_special_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.pharmacy_special_items ENABLE ALWAYS TRIGGER pharmacy_special_items_no_truncate;--> statement-breakpoint
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY prescriptions_read ON public.prescriptions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.pharmacy_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.prescriptions TO clinic_app;--> statement-breakpoint
CREATE POLICY prescriptions_operator_read ON public.prescriptions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.prescriptions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.prescriptions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER prescriptions_no_truncate BEFORE TRUNCATE ON public.prescriptions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.prescriptions ENABLE ALWAYS TRIGGER prescriptions_no_truncate;--> statement-breakpoint
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY prescription_items_read ON public.prescription_items FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.pharmacy_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.prescription_items TO clinic_app;--> statement-breakpoint
CREATE POLICY prescription_items_operator_read ON public.prescription_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.prescription_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.prescription_items TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER prescription_items_no_truncate BEFORE TRUNCATE ON public.prescription_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.prescription_items ENABLE ALWAYS TRIGGER prescription_items_no_truncate;--> statement-breakpoint
ALTER TABLE public.dispensings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY dispensings_read ON public.dispensings FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.pharmacy_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.dispensings TO clinic_app;--> statement-breakpoint
CREATE POLICY dispensings_operator_read ON public.dispensings FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.dispensings', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.dispensings TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER dispensings_no_truncate BEFORE TRUNCATE ON public.dispensings FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.dispensings ENABLE ALWAYS TRIGGER dispensings_no_truncate;--> statement-breakpoint
ALTER TABLE public.dispensing_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY dispensing_lines_read ON public.dispensing_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.pharmacy_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.dispensing_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY dispensing_lines_operator_read ON public.dispensing_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.dispensing_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.dispensing_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER dispensing_lines_no_truncate BEFORE TRUNCATE ON public.dispensing_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.dispensing_lines ENABLE ALWAYS TRIGGER dispensing_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY labels_read ON public.labels FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.pharmacy_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.labels TO clinic_app;--> statement-breakpoint
CREATE POLICY labels_operator_read ON public.labels FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.labels', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.labels TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER labels_no_truncate BEFORE TRUNCATE ON public.labels FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.labels ENABLE ALWAYS TRIGGER labels_no_truncate;--> statement-breakpoint
ALTER TABLE public.stock_batch_holds ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_batch_holds_read ON public.stock_batch_holds FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.stock_batch_holds TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_batch_holds_operator_read ON public.stock_batch_holds FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_batch_holds', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_batch_holds TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_batch_holds_no_truncate BEFORE TRUNCATE ON public.stock_batch_holds FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_batch_holds ENABLE ALWAYS TRIGGER stock_batch_holds_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.selections', 'branch-scoped', 'pharmacy', '{owner,admin_pusat,finance,auditor,manager,fo_cashier,bc,doctor,nurse,therapist,pharmacist}', 'pharmacy definers (src/modules/pharmacy)', 'the visit''s branch'),
  ('public.selection_items', 'branch-scoped', 'pharmacy', '{owner,admin_pusat,finance,auditor,manager,fo_cashier,bc,doctor,nurse,therapist,pharmacist}', 'pharmacy definers (src/modules/pharmacy)', 'the visit''s branch'),
  ('public.pharmacy_recipe_items', 'tenant-shared', 'pharmacy', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist,doctor,facility_head}', 'pharmacy definers (src/modules/pharmacy)', 'none'),
  ('public.pharmacy_special_items', 'tenant-shared', 'pharmacy', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist,doctor,facility_head}', 'pharmacy definers (src/modules/pharmacy)', 'none'),
  ('public.prescriptions', 'clinical', 'pharmacy', '{pharmacist,doctor,facility_head,records_officer}', 'pharmacy definers (src/modules/pharmacy)', 'the visit''s branch'),
  ('public.prescription_items', 'clinical', 'pharmacy', '{pharmacist,doctor,facility_head,records_officer}', 'pharmacy definers (src/modules/pharmacy)', 'the visit''s branch'),
  ('public.dispensings', 'clinical', 'pharmacy', '{pharmacist,doctor,facility_head,records_officer}', 'pharmacy definers (src/modules/pharmacy)', 'the visit''s branch'),
  ('public.dispensing_lines', 'clinical', 'pharmacy', '{pharmacist,doctor,facility_head,records_officer}', 'pharmacy definers (src/modules/pharmacy)', 'the visit''s branch'),
  ('public.labels', 'clinical', 'pharmacy', '{pharmacist,doctor,facility_head,records_officer}', 'pharmacy definers (src/modules/pharmacy)', 'the visit''s branch'),
  ('public.stock_batch_holds', 'branch-scoped', 'pharmacy', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'pharmacy definers (src/modules/pharmacy)', 'the batch''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): prescriptions and dispensings are clinical; selections personal; maps config.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.selections', 'personal'),
  ('public.selection_items', 'personal'),
  ('public.pharmacy_recipe_items', 'config'),
  ('public.pharmacy_special_items', 'config'),
  ('public.prescriptions', 'clinical'),
  ('public.prescription_items', 'clinical'),
  ('public.dispensings', 'clinical'),
  ('public.dispensing_lines', 'clinical'),
  ('public.labels', 'clinical'),
  ('public.stock_batch_holds', 'personal');--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS, after the staff_access lock) ─────────────────────────────────────────────────────────
-- Insert-only rows: selections, holds history, special list, dispensing lines.
CREATE FUNCTION public.pharmacy_rows_insert_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% rows are never changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_rows_insert_only() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER selections_guard BEFORE INSERT OR UPDATE OR DELETE ON public.selections FOR EACH ROW EXECUTE FUNCTION public.pharmacy_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.selections ENABLE ALWAYS TRIGGER selections_guard;--> statement-breakpoint
CREATE TRIGGER stock_batch_holds_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_batch_holds FOR EACH ROW EXECUTE FUNCTION public.pharmacy_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.stock_batch_holds ENABLE ALWAYS TRIGGER stock_batch_holds_guard;--> statement-breakpoint
CREATE TRIGGER pharmacy_special_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pharmacy_special_items FOR EACH ROW EXECUTE FUNCTION public.pharmacy_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.pharmacy_special_items ENABLE ALWAYS TRIGGER pharmacy_special_items_guard;--> statement-breakpoint
CREATE TRIGGER dispensing_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.dispensing_lines FOR EACH ROW EXECUTE FUNCTION public.pharmacy_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.dispensing_lines ENABLE ALWAYS TRIGGER dispensing_lines_guard;--> statement-breakpoint

-- Selection items: never deleted; identity frozen; the material request set once.
CREATE FUNCTION public.selection_items_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'selection items are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.material_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'a selection item opens without a request' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.selection_id, NEW.kind, NEW.plan_item_id, NEW.catalog_version_id, NEW.quantity)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.selection_id, OLD.kind, OLD.plan_item_id, OLD.catalog_version_id, OLD.quantity)
     OR OLD.material_request_id IS NOT NULL OR NEW.material_request_id IS NULL THEN
    RAISE EXCEPTION 'a selection item is frozen; its request is set once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.selection_items_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER selection_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.selection_items FOR EACH ROW EXECUTE FUNCTION public.selection_items_guard();--> statement-breakpoint
ALTER TABLE public.selection_items ENABLE ALWAYS TRIGGER selection_items_guard;--> statement-breakpoint

-- Recipe map: never deleted (a row is re-pointed by update; the history is the audit row).
CREATE FUNCTION public.pharmacy_recipe_items_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recipe mappings are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.catalog_version_id, NEW.row_index) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.catalog_version_id, OLD.row_index) THEN
    RAISE EXCEPTION 'a recipe mapping keeps its row' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_recipe_items_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER pharmacy_recipe_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pharmacy_recipe_items FOR EACH ROW EXECUTE FUNCTION public.pharmacy_recipe_items_guard();--> statement-breakpoint
ALTER TABLE public.pharmacy_recipe_items ENABLE ALWAYS TRIGGER pharmacy_recipe_items_guard;--> statement-breakpoint

-- Prescriptions: never deleted; identity frozen; draft → signed once; a signed one is final.
CREATE FUNCTION public.prescriptions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prescriptions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'a prescription opens as a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.patient_id, NEW.prescriber_staff_id, NEW.is_acute, NEW.command_key, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.patient_id, OLD.prescriber_staff_id, OLD.is_acute, OLD.command_key, OLD.created_at)
     OR OLD.state = 'signed' OR NEW.state <> 'signed' THEN
    RAISE EXCEPTION 'a prescription keeps its identity and is signed once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prescriptions_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER prescriptions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.prescriptions_guard();--> statement-breakpoint
ALTER TABLE public.prescriptions ENABLE ALWAYS TRIGGER prescriptions_guard;--> statement-breakpoint

-- Prescription items: never deleted; added to a draft; removed (removed_at, once) from a draft only.
CREATE FUNCTION public.prescription_items_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_state text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prescription items are never deleted' USING ERRCODE = '42501';
  END IF;
  SELECT rx.state INTO v_state FROM public.prescriptions rx WHERE rx.tenant_id = NEW.tenant_id AND rx.id = NEW.prescription_id;
  IF v_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'a signed prescription is final' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'an item is added live' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.prescription_id, NEW.catalog_version_id, NEW.stock_item_id, NEW.kfa_code, NEW.signa,
      NEW.quantity, NEW.external_use, NEW.added_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.prescription_id, OLD.catalog_version_id, OLD.stock_item_id, OLD.kfa_code, OLD.signa,
      OLD.quantity, OLD.external_use, OLD.added_at)
     OR OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'a prescription item is only removed, once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prescription_items_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER prescription_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.prescription_items FOR EACH ROW EXECUTE FUNCTION public.prescription_items_guard();--> statement-breakpoint
ALTER TABLE public.prescription_items ENABLE ALWAYS TRIGGER prescription_items_guard;--> statement-breakpoint

-- Dispensings: never deleted; identity frozen; queued → prepared → handed, queued | prepared → cancelled; the prepared
-- depot and key, the handover and the cancellation set once; handed and cancelled are final.
CREATE FUNCTION public.dispensings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dispensings are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.prepared_at IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = NEW.tenant_id AND v.branch_id = NEW.branch_id AND v.id = NEW.visit_id AND v.closed_at IS NULL) THEN
      RAISE EXCEPTION 'a dispensing opens queued on an open visit' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.patient_id, NEW.selection_item_id, NEW.prescription_item_id, NEW.stock_item_id, NEW.quantity,
      NEW.external_use, NEW.queued_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.patient_id, OLD.selection_item_id, OLD.prescription_item_id, OLD.stock_item_id, OLD.quantity,
      OLD.external_use, OLD.queued_at)
     OR OLD.state IN ('handed','cancelled')
     OR NOT (OLD.state = 'queued' AND NEW.state IN ('prepared','cancelled') OR OLD.state = 'prepared' AND NEW.state IN ('handed','cancelled'))
     OR OLD.prepared_at IS NOT NULL AND (NEW.prepared_at, NEW.prepared_by, NEW.prepare_key, NEW.depot_id) IS DISTINCT FROM (OLD.prepared_at, OLD.prepared_by, OLD.prepare_key, OLD.depot_id) THEN
    RAISE EXCEPTION 'a dispensing moves queued → prepared → handed or cancelled, once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dispensings_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER dispensings_guard BEFORE INSERT OR UPDATE OR DELETE ON public.dispensings FOR EACH ROW EXECUTE FUNCTION public.dispensings_guard();--> statement-breakpoint
ALTER TABLE public.dispensings ENABLE ALWAYS TRIGGER dispensings_guard;--> statement-breakpoint

-- Labels: never deleted; identity and kind frozen; the count only grows.
CREATE FUNCTION public.labels_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'labels are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.id, NEW.tenant_id, NEW.branch_id, NEW.dispensing_id, NEW.kind, NEW.first_printed_at)
                           IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.dispensing_id, OLD.kind, OLD.first_printed_at)
                           OR NEW.print_count <> OLD.print_count + 1) THEN
    RAISE EXCEPTION 'a label is only reprinted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.labels_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER labels_guard BEFORE INSERT OR UPDATE OR DELETE ON public.labels FOR EACH ROW EXECUTE FUNCTION public.labels_guard();--> statement-breakpoint
ALTER TABLE public.labels ENABLE ALWAYS TRIGGER labels_guard;--> statement-breakpoint

-- P3-1: an item's unit and vial size freeze once a recipe mapping, prescription or dispensing names it (0077's and
-- 0079's guards are not re-created).
CREATE FUNCTION public.stock_items_pharmacy_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF (NEW.unit IS DISTINCT FROM OLD.unit OR NEW.vial_size IS DISTINCT FROM OLD.vial_size)
     AND (EXISTS (SELECT 1 FROM public.pharmacy_recipe_items r WHERE r.tenant_id = OLD.tenant_id AND r.stock_item_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.prescription_items p WHERE p.tenant_id = OLD.tenant_id AND p.stock_item_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.dispensings d WHERE d.tenant_id = OLD.tenant_id AND d.stock_item_id = OLD.id)) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the unit is in use' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_items_pharmacy_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_items_pharmacy_guard BEFORE UPDATE ON public.stock_items FOR EACH ROW EXECUTE FUNCTION public.stock_items_pharmacy_guard();--> statement-breakpoint
ALTER TABLE public.stock_items ENABLE ALWAYS TRIGGER stock_items_pharmacy_guard;--> statement-breakpoint

-- P2-3: the visit's preparation and dispensing steps follow T-062's request transitions (issue, cancel, settle).
CREATE FUNCTION public.material_requests_visit_steps() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.pharmacy_visit_steps(NEW.tenant_id, NEW.visit_id);
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_requests_visit_steps() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER material_requests_visit_steps AFTER INSERT OR UPDATE OF state ON public.material_requests FOR EACH ROW EXECUTE FUNCTION public.material_requests_visit_steps();--> statement-breakpoint
ALTER TABLE public.material_requests ENABLE ALWAYS TRIGGER material_requests_visit_steps;--> statement-breakpoint

-- ── Writers (open points 1–9) ───────────────────────────────────────────────────────────────────────────────
-- Every writer runs through runCommand; its key is stored on its row (unique per tenant) or derived per child row.

-- Konfirmasi Pilihan (DATA-20 subset, PR-18 "approved selections"): BC, doctor or front office at the visit's branch,
-- once per visit. p: {items: [{plan_item_id?, catalog_version_id?, quantity?}], guiding_bc_id?, closing_bc_id?}. A plan
-- item names its version and quantity (its qty); a direct product names an active version and a quantity. Services
-- and products only (packages are the cashier's, M4); no special item; every product has a stock item. Products become
-- queued dispensings; services wait for the pharmacist's Siapkan. ItemsSelected {selection_id, visit_id}.
CREATE FUNCTION public.selection_confirm(p_key text, p_visit uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['bc','doctor','fo_cashier']);
  v public.visits := public.pharmacy_visit_locked(a.tenant_id, a.branch_id, p_visit);
  v_canon uuid;
  v_sel uuid;
  v_guide uuid;
  v_close uuid;
  v_e jsonb;
  v_pi public.plan_items;
  v_ver uuid;
  v_qty numeric;
  v_kind text;
  v_cat uuid;
  v_si uuid;
  v_stock uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'items' - 'guiding_bc_id' - 'closing_bc_id' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'items') NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: selection' USING ERRCODE = '22023';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the visit is closed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.selections s WHERE s.tenant_id = v.tenant_id AND s.visit_id = v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the selection of this visit is confirmed' USING ERRCODE = '55000';
  END IF;
  BEGIN
    v_guide := NULLIF(p ->> 'guiding_bc_id', '')::uuid;
    v_close := NULLIF(p ->> 'closing_bc_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: staff' USING ERRCODE = '22023';
  END;
  IF a.role = 'bc' THEN
    v_guide := coalesce(v_guide, a.staff_id);
    v_close := coalesce(v_close, a.staff_id);
  END IF;
  IF v_guide IS NOT NULL AND NOT public.consent_staff_role(v.tenant_id, v_guide, v.branch_id, 'bc')
     OR v_close IS NOT NULL AND NOT public.consent_staff_role(v.tenant_id, v_close, v.branch_id, 'bc') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a guiding or closing BC is a BC of the branch' USING ERRCODE = '22023';
  END IF;
  v_canon := public.patient_canonical(v.tenant_id, v.patient_id);
  BEGIN
    INSERT INTO public.selections (tenant_id, branch_id, visit_id, patient_id, guiding_bc_staff_id, closing_bc_staff_id, command_key, confirmed_by, confirmed_as)
    VALUES (v.tenant_id, v.branch_id, v.id, v_canon, v_guide, v_close, p_key, a.staff_id, a.role) RETURNING id INTO v_sel;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a selection with this key exists' USING ERRCODE = '23505';
  END;
  FOR v_e IN SELECT x FROM jsonb_array_elements(p -> 'items') x LOOP
    IF jsonb_typeof(v_e) IS DISTINCT FROM 'object' OR v_e - 'plan_item_id' - 'catalog_version_id' - 'quantity' <> '{}'::jsonb
       OR (v_e ? 'plan_item_id') = (v_e ? 'catalog_version_id') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: an item names a plan item or a product version' USING ERRCODE = '22023';
    END IF;
    v_pi := NULL;
    BEGIN
      IF v_e ? 'plan_item_id' THEN
        SELECT * INTO v_pi FROM public.plan_items x WHERE x.tenant_id = v.tenant_id AND x.id = (v_e ->> 'plan_item_id')::uuid;
        v_ver := v_pi.catalog_version_id;
        v_qty := coalesce((v_e ->> 'quantity')::numeric, v_pi.qty);
      ELSE
        v_ver := (v_e ->> 'catalog_version_id')::uuid;
        v_qty := (v_e ->> 'quantity')::numeric;
      END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: item' USING ERRCODE = '22023';
    END;
    IF v_e ? 'plan_item_id' AND (v_pi.id IS NULL OR v_pi.removed_at IS NOT NULL OR NOT EXISTS (
         SELECT 1 FROM public.care_plans c WHERE c.tenant_id = v_pi.tenant_id AND c.id = v_pi.plan_id AND c.state = 'active'
            AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, v_canon)))) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: plan item not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_qty IS NULL OR NOT (v_qty > 0 AND v_qty <= 1000 AND scale(v_qty) <= 4) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity' USING ERRCODE = '22023';
    END IF;
    SELECT it.kind, it.id INTO v_kind, v_cat FROM public.catalog_versions cv JOIN public.catalog_items it ON it.tenant_id = cv.tenant_id AND it.id = cv.item_id
     WHERE cv.tenant_id = v.tenant_id AND cv.id = v_ver AND (cv.state = 'active' OR v_pi.id IS NOT NULL AND cv.state IN ('active','superseded'));
    IF v_kind IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: catalog version not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_kind NOT IN ('service','product') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: services and products only' USING ERRCODE = '22023';
    END IF;
    IF public.pharmacy_special(v.tenant_id, v_cat) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: special_item' USING ERRCODE = '22023';
    END IF;
    PERFORM public.catalog_version_reference(v_ver);
    BEGIN
      INSERT INTO public.selection_items (tenant_id, branch_id, visit_id, selection_id, kind, plan_item_id, catalog_version_id, quantity)
      VALUES (v.tenant_id, v.branch_id, v.id, v_sel, v_kind, v_pi.id, v_ver, v_qty) RETURNING id INTO v_si;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: a plan item is selected once' USING ERRCODE = '22023';
    END;
    IF v_kind = 'product' THEN
      SELECT si.id INTO v_stock FROM public.stock_items si WHERE si.tenant_id = v.tenant_id AND si.catalog_item_id = v_cat AND si.active;
      IF v_stock IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: product_without_stock_item' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.dispensings (tenant_id, branch_id, visit_id, patient_id, selection_item_id, stock_item_id, quantity)
      VALUES (v.tenant_id, v.branch_id, v.id, v_canon, v_si, v_stock, v_qty);
    END IF;
  END LOOP;
  UPDATE public.visits SET selection = 'done' WHERE tenant_id = v.tenant_id AND id = v.id;
  PERFORM public.pharmacy_visit_steps(v.tenant_id, v.id);
  PERFORM public.audit_append('settings_change', 'selection', v_sel, 'success', 'selection_confirmed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v.branch_id, 'ItemsSelected', 'selection', v_sel, jsonb_build_object('selection_id', v_sel, 'visit_id', v.id));
  RETURN v_sel;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.selection_confirm(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.selection_confirm(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Peta Resep (P1-1): the pharmacist maps a recipe row of a service version to a stock item and its quantity per
-- treatment (in the item's unit); re-pointing a row updates it (audited). p: {stock_item_id, quantity}.
CREATE FUNCTION public.recipe_map_set(p_version uuid, p_row integer, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['pharmacist']);
  v_item uuid;
  v_qty numeric;
  v_id uuid;
BEGIN
  BEGIN
    v_item := (p ->> 'stock_item_id')::uuid;
    v_qty := (p ->> 'quantity')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: mapping' USING ERRCODE = '22023';
  END;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'stock_item_id' - 'quantity' <> '{}'::jsonb OR v_item IS NULL
     OR v_qty IS NULL OR NOT (v_qty > 0 AND v_qty <= 100000 AND scale(v_qty) <= 4) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: mapping' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_versions cv JOIN public.catalog_items it ON it.tenant_id = cv.tenant_id AND it.id = cv.item_id
                  WHERE cv.tenant_id = a.tenant_id AND cv.id = p_version AND it.kind = 'service' AND cv.state IN ('active','superseded')
                    AND p_row BETWEEN 0 AND jsonb_array_length(cv.material_formula) - 1) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: recipe row not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = a.tenant_id AND si.id = v_item AND si.active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.pharmacy_recipe_items (tenant_id, catalog_version_id, row_index, stock_item_id, quantity, set_by)
  VALUES (a.tenant_id, p_version, p_row, v_item, v_qty, a.staff_id)
  ON CONFLICT (tenant_id, catalog_version_id, row_index) DO UPDATE SET stock_item_id = EXCLUDED.stock_item_id, quantity = EXCLUDED.quantity,
         set_at = clock_timestamp(), set_by = EXCLUDED.set_by
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'pharmacy_recipe_item', v_id, 'success', 'recipe_mapped');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.recipe_map_set(uuid, integer, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.recipe_map_set(uuid, integer, jsonb) TO clinic_app;--> statement-breakpoint

-- Obat Khusus (PR-18): the pharmacist adds a narcotic or psychotropic catalog item to the special list (insert-only:
-- enabling one needs approved controls, not in this task). Refused if already listed.
CREATE FUNCTION public.special_item_add(p_catalog_item uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['pharmacist']);
  v_id uuid;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_items it WHERE it.tenant_id = a.tenant_id AND it.id = p_catalog_item AND it.kind IN ('product','material')) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: catalog item not found' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    INSERT INTO public.pharmacy_special_items (tenant_id, catalog_item_id, reason, added_by) VALUES (a.tenant_id, p_catalog_item, btrim(p_reason), a.staff_id) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already listed' USING ERRCODE = '55000';
  END;
  PERFORM public.audit_append('settings_change', 'pharmacy_special_item', v_id, 'success', 'special_item_added');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.special_item_add(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.special_item_add(uuid, text) TO clinic_app;--> statement-breakpoint

-- Siapkan (treatment materials, P1-1): the pharmacist turns a selected treatment's mapped recipe × quantity into a
-- T-062 material request for the visit and plan item into the room depot (pharmacy_room_depot unless named), with a
-- key derived from the command key. Refused while a recipe row is unmapped or without a room depot. Then T-062's
-- material_issue issues it.
CREATE FUNCTION public.selection_prepare_materials(p_key text, p_item uuid, p_room_depot uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['pharmacist']);
  v_visit uuid;
  v public.visits;
  i public.selection_items;
  v_depot uuid;
  v_req uuid;
BEGIN
  SELECT x.visit_id INTO v_visit FROM public.selection_items x WHERE x.tenant_id = a.tenant_id AND x.id = p_item AND x.branch_id = a.branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: selection item not found' USING ERRCODE = 'P0002';
  END IF;
  v := public.pharmacy_visit_locked(a.tenant_id, a.branch_id, v_visit);
  SELECT * INTO i FROM public.selection_items x WHERE x.tenant_id = a.tenant_id AND x.id = p_item FOR UPDATE;
  IF v.closed_at IS NOT NULL OR i.kind <> 'service' OR i.material_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing to prepare' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_recipe_lines(i.tenant_id, i.catalog_version_id, i.quantity)) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_recipe' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pharmacy_recipe_lines(i.tenant_id, i.catalog_version_id, i.quantity) l WHERE l.stock_item_id IS NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: recipe_unmapped' USING ERRCODE = '55000';
  END IF;
  v_depot := coalesce(p_room_depot, public.pharmacy_room_depot(v.tenant_id, v.branch_id, v.appointment_id));
  IF v_depot IS NULL OR NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = v.tenant_id AND d.branch_id = v.branch_id AND d.id = v_depot AND d.kind = 'ruang' AND d.active) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: room_depot_missing' USING ERRCODE = '55000';
  END IF;
  BEGIN
    INSERT INTO public.material_requests (tenant_id, branch_id, visit_id, plan_item_id, room_depot_id, command_key, requested_by, requested_as)
    VALUES (v.tenant_id, v.branch_id, v.id, i.plan_item_id, v_depot, p_key, a.staff_id, a.role) RETURNING id INTO v_req;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a request with this key exists' USING ERRCODE = '23505';
  END;
  INSERT INTO public.material_request_lines (tenant_id, branch_id, request_id, item_id, material_class, requested_qty)
  SELECT v.tenant_id, v.branch_id, v_req, l.stock_item_id, si.material_class, sum(l.quantity)
    FROM public.pharmacy_recipe_lines(i.tenant_id, i.catalog_version_id, i.quantity) l
    JOIN public.stock_items si ON si.tenant_id = i.tenant_id AND si.id = l.stock_item_id
   GROUP BY l.stock_item_id, si.material_class;
  UPDATE public.selection_items SET material_request_id = v_req WHERE tenant_id = i.tenant_id AND id = i.id;
  PERFORM public.pharmacy_visit_steps(v.tenant_id, v.id);
  PERFORM public.audit_append('settings_change', 'material_request', v_req, 'success', 'material_requested');
  RETURN v_req;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.selection_prepare_materials(text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.selection_prepare_materials(text, uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Resep (DATA-26): the doctor opens a draft for an open visit at the branch. p: {is_acute?}.
CREATE FUNCTION public.prescription_create(p_key text, p_visit uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['doctor']);
  v public.visits := public.pharmacy_visit_locked(a.tenant_id, a.branch_id, p_visit);
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'is_acute' <> '{}'::jsonb OR p ? 'is_acute' AND jsonb_typeof(p -> 'is_acute') <> 'boolean' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: prescription' USING ERRCODE = '22023';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the visit is closed' USING ERRCODE = '55000';
  END IF;
  BEGIN
    INSERT INTO public.prescriptions (tenant_id, branch_id, visit_id, patient_id, prescriber_staff_id, is_acute, command_key)
    VALUES (v.tenant_id, v.branch_id, v.id, public.patient_canonical(v.tenant_id, v.patient_id), a.staff_id, coalesce((p ->> 'is_acute')::boolean, false), p_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a prescription with this key exists' USING ERRCODE = '23505';
  END;
  PERFORM public.audit_append('sign', 'prescription', v_id, 'success', 'prescription_drafted');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prescription_create(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.prescription_create(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- The prescriber's own draft at the branch, its visit locked first.
CREATE FUNCTION public.prescription_draft_locked(p_tenant uuid, p_branch uuid, p_staff uuid, p_rx uuid) RETURNS public.prescriptions
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_visit uuid;
  rx public.prescriptions;
BEGIN
  SELECT x.visit_id INTO v_visit FROM public.prescriptions x WHERE x.tenant_id = p_tenant AND x.id = p_rx AND x.branch_id = p_branch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: prescription not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.pharmacy_visit_locked(p_tenant, p_branch, v_visit);
  SELECT * INTO rx FROM public.prescriptions x WHERE x.tenant_id = p_tenant AND x.id = p_rx FOR UPDATE;
  IF rx.prescriber_staff_id <> p_staff THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the prescriber edits or signs' USING ERRCODE = '42501';
  END IF;
  IF rx.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the prescription is signed' USING ERRCODE = '55000';
  END IF;
  RETURN rx;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prescription_draft_locked(uuid, uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Add a product to a draft. p: {catalog_version_id, quantity, signa, kfa_code?, external_use?}. An active product
-- version with an active stock item; never a special item.
CREATE FUNCTION public.prescription_item_add(p_key text, p_rx uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['doctor']);
  rx public.prescriptions := public.prescription_draft_locked(a.tenant_id, a.branch_id, a.staff_id, p_rx);
  v_ver uuid;
  v_qty numeric;
  v_cat uuid;
  v_stock uuid;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'catalog_version_id' - 'quantity' - 'signa' - 'kfa_code' - 'external_use' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'signa') IS DISTINCT FROM 'string' OR length(btrim(p ->> 'signa')) NOT BETWEEN 3 AND 200
     OR p ? 'external_use' AND jsonb_typeof(p -> 'external_use') <> 'boolean'
     OR p ? 'kfa_code' AND coalesce(p ->> 'kfa_code', '') !~ '^[0-9A-Za-z.-]{3,40}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: item' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_ver := (p ->> 'catalog_version_id')::uuid;
    v_qty := (p ->> 'quantity')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: item' USING ERRCODE = '22023';
  END;
  IF v_qty IS NULL OR NOT (v_qty > 0 AND v_qty <= 100000 AND scale(v_qty) <= 4) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity' USING ERRCODE = '22023';
  END IF;
  SELECT it.id INTO v_cat FROM public.catalog_versions cv JOIN public.catalog_items it ON it.tenant_id = cv.tenant_id AND it.id = cv.item_id
   WHERE cv.tenant_id = a.tenant_id AND cv.id = v_ver AND cv.state = 'active' AND it.kind = 'product';
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: product not found' USING ERRCODE = 'P0002';
  END IF;
  IF public.pharmacy_special(a.tenant_id, v_cat) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: special_item' USING ERRCODE = '22023';
  END IF;
  SELECT si.id INTO v_stock FROM public.stock_items si WHERE si.tenant_id = a.tenant_id AND si.catalog_item_id = v_cat AND si.active;
  IF v_stock IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: product_without_stock_item' USING ERRCODE = '22023';
  END IF;
  PERFORM public.catalog_version_reference(v_ver);
  INSERT INTO public.prescription_items (tenant_id, branch_id, visit_id, prescription_id, catalog_version_id, stock_item_id, kfa_code, signa, quantity, external_use)
  VALUES (rx.tenant_id, rx.branch_id, rx.visit_id, rx.id, v_ver, v_stock, p ->> 'kfa_code', btrim(p ->> 'signa'), v_qty, coalesce((p ->> 'external_use')::boolean, false))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prescription_item_add(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.prescription_item_add(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.prescription_item_remove(p_rx uuid, p_item uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['doctor']);
  rx public.prescriptions := public.prescription_draft_locked(a.tenant_id, a.branch_id, a.staff_id, p_rx);
BEGIN
  UPDATE public.prescription_items SET removed_at = clock_timestamp()
   WHERE tenant_id = rx.tenant_id AND prescription_id = rx.id AND id = p_item AND removed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: item not found' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prescription_item_remove(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.prescription_item_remove(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Tandatangani Resep (P2-1): the prescriber with an enrolled second factor (the step-up proof is checked by the
-- module, as T-053), at least one live item, none special; valid_until from SET-48 (masa, or masa_akut for an acute
-- prescription) snapshotted; one queued dispensing per live item. PrescriptionSigned {prescription_id, visit_id}.
CREATE FUNCTION public.prescription_sign(p_rx uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['doctor']);
  rx public.prescriptions;
  v_now timestamptz := clock_timestamp();
  v_set jsonb;
  v_days integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.auth_user u ON u.id = m.account_id AND u.two_factor_enabled
                  WHERE s.tenant_id = a.tenant_id AND s.id = a.staff_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: second_factor_required' USING ERRCODE = '42501';
  END IF;
  rx := public.prescription_draft_locked(a.tenant_id, a.branch_id, a.staff_id, p_rx);
  IF NOT EXISTS (SELECT 1 FROM public.prescription_items i WHERE i.tenant_id = rx.tenant_id AND i.prescription_id = rx.id AND i.removed_at IS NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: empty_prescription' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = rx.tenant_id AND v.id = rx.visit_id AND v.closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the visit is closed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.prescription_items i JOIN public.stock_items si ON si.tenant_id = i.tenant_id AND si.id = i.stock_item_id
              WHERE i.tenant_id = rx.tenant_id AND i.prescription_id = rx.id AND i.removed_at IS NULL AND public.pharmacy_special(si.tenant_id, si.catalog_item_id)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: special_item' USING ERRCODE = '22023';
  END IF;
  v_set := public.setting_value_at('SET-48', NULL, v_now);
  v_days := (v_set ->> CASE WHEN rx.is_acute THEN 'masa_akut' ELSE 'masa' END)::integer;
  IF v_days IS NULL OR v_days NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: prescription validity setting' USING ERRCODE = '55000';
  END IF;
  UPDATE public.prescriptions SET state = 'signed', signed_at = v_now, valid_until = v_now + make_interval(days => v_days), set48_snapshot = v_set
   WHERE tenant_id = rx.tenant_id AND id = rx.id;
  INSERT INTO public.dispensings (tenant_id, branch_id, visit_id, patient_id, prescription_item_id, stock_item_id, quantity, external_use)
  SELECT i.tenant_id, i.branch_id, i.visit_id, rx.patient_id, i.id, i.stock_item_id, i.quantity, i.external_use
    FROM public.prescription_items i WHERE i.tenant_id = rx.tenant_id AND i.prescription_id = rx.id AND i.removed_at IS NULL ORDER BY i.id;
  PERFORM public.pharmacy_visit_steps(rx.tenant_id, rx.visit_id);
  PERFORM public.audit_append('sign', 'prescription', rx.id, 'success', 'prescription_signed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (rx.branch_id, 'PrescriptionSigned', 'prescription', rx.id, jsonb_build_object('prescription_id', rx.id, 'visit_id', rx.visit_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prescription_sign(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.prescription_sign(uuid) TO clinic_app;--> statement-breakpoint

-- The dispensing at the pharmacist's branch with its visit locked first.
CREATE FUNCTION public.dispensing_locked(p_tenant uuid, p_branch uuid, p_dispensing uuid) RETURNS public.dispensings
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_visit uuid;
  d public.dispensings;
BEGIN
  SELECT x.visit_id INTO v_visit FROM public.dispensings x WHERE x.tenant_id = p_tenant AND x.id = p_dispensing AND x.branch_id = p_branch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: dispensing not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.pharmacy_visit_locked(p_tenant, p_branch, v_visit);
  SELECT * INTO d FROM public.dispensings x WHERE x.tenant_id = p_tenant AND x.id = p_dispensing FOR UPDATE;
  RETURN d;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dispensing_locked(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- What blocks dispensing now (UX-10 blocked copy, P2-3): the prescription, payment, a special item.
CREATE FUNCTION public.dispensing_blocker(d public.dispensings) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.pharmacy_rx_blocker(d),
    CASE WHEN EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = d.tenant_id AND v.id = d.visit_id AND v.payment IN ('in_progress','blocked')) THEN 'payment_unpaid' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = d.tenant_id AND si.id = d.stock_item_id AND public.pharmacy_special(si.tenant_id, si.catalog_item_id))
         THEN 'special_item' END)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dispensing_blocker(public.dispensings) FROM PUBLIC;--> statement-breakpoint

-- Siapkan (product, CLIN-017): the pharmacist chooses the depot (an active apotek or gudang depot of the branch; default
-- pharmacy_dispense_depot) and checks the FEFO suggestion is coverable; no stock moves and no batch is reserved.
CREATE FUNCTION public.dispense_prepare(p_key text, p_dispensing uuid, p_depot uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['pharmacist']);
  d public.dispensings := public.dispensing_locked(a.tenant_id, a.branch_id, p_dispensing);
  v_depot uuid;
  v_block text;
BEGIN
  IF d.state <> 'queued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: dispensing %', d.state USING ERRCODE = '55000';
  END IF;
  v_block := public.dispensing_blocker(d);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: %', v_block USING ERRCODE = '55000';
  END IF;
  v_depot := coalesce(p_depot, public.pharmacy_dispense_depot(d.tenant_id, d.branch_id, d.stock_item_id, d.quantity));
  IF NOT EXISTS (SELECT 1 FROM public.depots x WHERE x.tenant_id = d.tenant_id AND x.branch_id = d.branch_id AND x.id = v_depot AND x.kind IN ('apotek','gudang') AND x.active) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: depot' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.stock_fefo_depot(d.tenant_id, v_depot, d.stock_item_id, d.quantity);
  BEGIN
    UPDATE public.dispensings SET state = 'prepared', depot_id = v_depot, prepared_at = clock_timestamp(), prepared_by = a.staff_id, prepare_key = p_key
     WHERE tenant_id = d.tenant_id AND id = d.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a preparation with this key exists' USING ERRCODE = '23505';
  END;
  PERFORM public.audit_append('settings_change', 'dispensing', d.id, 'success', 'dispensing_prepared');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dispense_prepare(text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dispense_prepare(text, uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Serahkan (PR-18, CD-19, CLIN-018): once, after the seven checks — each true, or false with the exception note
-- (3–500) that covers every unchecked one; an external-use item needs its printed external_use label unless the label
-- check is excepted; the prescription valid; payment not pending; no special item. FEFO (or the pharmacist's batches)
-- in the prepared depot, aggregated per batch, fit re-asserted under lock; open vials run down; one `dispense`
-- movement per batch. MedicationDispensed / ProductHandedOver {dispensing_id, visit_id}. p: {checks: {<check>: bool},
-- exception_note?, batches?: [{batch_id, quantity}]}.
CREATE FUNCTION public.dispense_hand_over(p_key text, p_dispensing uuid, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['pharmacist']);
  d public.dispensings := public.dispensing_locked(a.tenant_id, a.branch_id, p_dispensing);
  ck constant text[] := ARRAY['identity','validity','dose','allergy','clarification','label','counselling'];
  v_note text := NULLIF(btrim(coalesce(p ->> 'exception_note', '')), '');
  v_block text;
  v_l record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'checks' - 'exception_note' - 'batches' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'checks') IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p -> 'checks') k) <> 7
     OR EXISTS (SELECT 1 FROM unnest(ck) c WHERE jsonb_typeof(p -> 'checks' -> c) IS DISTINCT FROM 'boolean')
     OR p ? 'batches' AND (jsonb_typeof(p -> 'batches') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'batches') NOT BETWEEN 1 AND 20) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: the seven checks' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) NOT BETWEEN 3 AND 500
     OR (EXISTS (SELECT 1 FROM unnest(ck) c WHERE p -> 'checks' -> c = 'false'::jsonb)) <> (v_note IS NOT NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: checks_incomplete' USING ERRCODE = '22023';
  END IF;
  IF d.state <> 'prepared' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: dispensing %', d.state USING ERRCODE = '55000';
  END IF;
  v_block := public.dispensing_blocker(d);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: %', v_block USING ERRCODE = '55000';
  END IF;
  IF d.external_use AND p -> 'checks' -> 'label' = 'true'::jsonb
     AND NOT EXISTS (SELECT 1 FROM public.labels l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id AND l.kind = 'external_use') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: label_not_printed' USING ERRCODE = '55000';
  END IF;
  -- The batches: the pharmacist's (each fit in the depot, summing to the quantity) or FEFO; aggregated per batch.
  BEGIN
    IF p ? 'batches' THEN
      IF (SELECT count(DISTINCT x ->> 'batch_id') <> count(*) OR sum((x ->> 'quantity')::numeric) <> d.quantity
            OR bool_or(NOT ((x ->> 'quantity')::numeric > 0 AND scale((x ->> 'quantity')::numeric) <= 4))
            OR bool_or(NOT EXISTS (SELECT 1 FROM public.stock_batches b WHERE b.tenant_id = d.tenant_id AND b.branch_id = d.branch_id
                                    AND b.id = (x ->> 'batch_id')::uuid AND b.item_id = d.stock_item_id))
            FROM jsonb_array_elements(p -> 'batches') x) THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: batches' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.dispensing_lines (tenant_id, branch_id, dispensing_id, batch_id, quantity)
      SELECT d.tenant_id, d.branch_id, d.id, (x ->> 'batch_id')::uuid, (x ->> 'quantity')::numeric FROM jsonb_array_elements(p -> 'batches') x;
    ELSE
      INSERT INTO public.dispensing_lines (tenant_id, branch_id, dispensing_id, batch_id, quantity)
      SELECT d.tenant_id, d.branch_id, d.id, f.batch_id, sum(f.take) FROM public.stock_fefo_depot(d.tenant_id, d.depot_id, d.stock_item_id, d.quantity) f GROUP BY f.batch_id;
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: batches' USING ERRCODE = '22023';
  END;
  -- Lock the batches then the depot's holdings in id order (lock order), re-assert fitness, move.
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = d.tenant_id
     AND b.id IN (SELECT l.batch_id FROM public.dispensing_lines l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id) ORDER BY b.id FOR UPDATE;
  PERFORM 1 FROM public.batch_holdings h WHERE h.tenant_id = d.tenant_id AND h.depot_id = d.depot_id
     AND h.batch_id IN (SELECT l.batch_id FROM public.dispensing_lines l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id) ORDER BY h.id FOR UPDATE;
  FOR v_l IN SELECT * FROM public.dispensing_lines l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id ORDER BY l.batch_id LOOP
    PERFORM public.stock_assert_fit_depot(d.tenant_id, v_l.batch_id, d.depot_id, v_l.quantity);
    PERFORM public.material_vial_take(d.tenant_id, v_l.batch_id, d.depot_id,
      least(v_l.quantity, coalesce((SELECT v.remaining FROM public.opened_vials v WHERE v.tenant_id = d.tenant_id AND v.batch_id = v_l.batch_id AND v.depot_id = d.depot_id
                                     AND v.state = 'open' AND public.stock_vial_unfit(v) IS NULL), 0)));
    PERFORM public.stock_move_depot(d.tenant_id, v_l.batch_id, d.depot_id, 'dispense', -v_l.quantity, NULL, 'dispensing', d.id, a.staff_id, a.role, NULL);
  END LOOP;
  BEGIN
    UPDATE public.dispensings SET state = 'handed', handed_at = clock_timestamp(), handed_by = a.staff_id, hand_key = p_key, checks = p -> 'checks', exception_note = v_note
     WHERE tenant_id = d.tenant_id AND id = d.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a handover with this key exists' USING ERRCODE = '23505';
  END;
  PERFORM public.pharmacy_visit_steps(d.tenant_id, d.visit_id);
  PERFORM public.audit_append('sign', 'dispensing', d.id, 'success', 'dispensing_handed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (d.branch_id, CASE WHEN d.prescription_item_id IS NOT NULL THEN 'MedicationDispensed' ELSE 'ProductHandedOver' END, 'dispensing', d.id,
          jsonb_build_object('dispensing_id', d.id, 'visit_id', d.visit_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dispense_hand_over(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dispense_hand_over(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Batalkan (CLIN-017 counterpart): the pharmacist cancels a queued or prepared dispensing with a reason; no stock.
CREATE FUNCTION public.dispense_cancel(p_dispensing uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['pharmacist']);
  d public.dispensings := public.dispensing_locked(a.tenant_id, a.branch_id, p_dispensing);
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  IF d.state NOT IN ('queued','prepared') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: dispensing %', d.state USING ERRCODE = '55000';
  END IF;
  UPDATE public.dispensings SET state = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = a.staff_id, cancel_reason = btrim(p_reason)
   WHERE tenant_id = d.tenant_id AND id = d.id;
  PERFORM public.pharmacy_visit_steps(d.tenant_id, d.visit_id);
  PERFORM public.audit_append('settings_change', 'dispensing', d.id, 'success', 'dispensing_cancelled');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dispense_cancel(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dispense_cancel(uuid, text) TO clinic_app;--> statement-breakpoint

-- Cetak Etiket (P2-3): the pharmacist prints (or reprints) a dispensing's label; an external-use item gets the
-- external_use (etiket biru) kind, others internal. Open dispensings only.
CREATE FUNCTION public.label_print(p_dispensing uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['pharmacist']);
  d public.dispensings := public.dispensing_locked(a.tenant_id, a.branch_id, p_dispensing);
  v_kind text;
BEGIN
  IF d.state NOT IN ('queued','prepared') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: dispensing %', d.state USING ERRCODE = '55000';
  END IF;
  v_kind := CASE WHEN d.external_use THEN 'external_use' ELSE 'internal' END;
  INSERT INTO public.labels (tenant_id, branch_id, dispensing_id, kind, last_printed_by)
  VALUES (d.tenant_id, d.branch_id, d.id, v_kind, a.staff_id)
  ON CONFLICT (tenant_id, dispensing_id) DO UPDATE SET print_count = labels.print_count + 1, last_printed_at = clock_timestamp(), last_printed_by = EXCLUDED.last_printed_by;
  RETURN v_kind;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.label_print(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.label_print(uuid) TO clinic_app;--> statement-breakpoint

-- ── Readers (UX-10) ─────────────────────────────────────────────────────────────────────────────────────────
-- Names, codes, quantities and states; no clinical text except on the dispensing detail (signa, cautions), which is
-- one audited clinical read.
CREATE FUNCTION public.pharmacy_reader(p_roles text[], OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) OR branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the pharmacy' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_reader(text[]) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.pharmacy_patient_json(p_tenant uuid, p_visit uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('visit_id', v.id, 'patient_id', pt.id, 'name', pt.full_name, 'mrn', pt.mrn, 'checked_in_at', v.checked_in_at, 'payment', v.payment)
    FROM public.visits v JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id)
   WHERE v.tenant_id = p_tenant AND v.id = p_visit
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_patient_json(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.pharmacy_item_name(p_tenant uuid, p_stock_item uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('stock_item_id', si.id, 'name', lb.name, 'code', lb.code, 'unit', si.unit)
    FROM public.stock_items si CROSS JOIN LATERAL public.stock_item_label(si.tenant_id, si.catalog_item_id) lb
   WHERE si.tenant_id = p_tenant AND si.id = p_stock_item
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_item_name(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- One dispensing row for the lists: patient, item, quantity, state, depot, the FEFO suggestion (in the prepared depot
-- or the default one), label, blocker.
CREATE FUNCTION public.pharmacy_dispensing_row(d public.dispensings) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_depot uuid := coalesce(d.depot_id, public.pharmacy_dispense_depot(d.tenant_id, d.branch_id, d.stock_item_id, d.quantity));
  v_hint jsonb;
BEGIN
  v_hint := CASE WHEN d.state IN ('queued','prepared') THEN public.pharmacy_fefo_hint(d.tenant_id, v_depot, d.stock_item_id, d.quantity) END;
  RETURN jsonb_build_object('id', d.id, 'state', d.state, 'source', CASE WHEN d.prescription_item_id IS NOT NULL THEN 'prescription' ELSE 'selection' END,
    'patient', public.pharmacy_patient_json(d.tenant_id, d.visit_id), 'item', public.pharmacy_item_name(d.tenant_id, d.stock_item_id),
    'quantity', d.quantity, 'external_use', d.external_use, 'queued_at', d.queued_at, 'prepared_at', d.prepared_at, 'handed_at', d.handed_at,
    'depot', (SELECT jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind) FROM public.depots x WHERE x.tenant_id = d.tenant_id AND x.id = v_depot),
    'suggestion', v_hint,
    'blocker', coalesce(public.dispensing_blocker(d), CASE WHEN d.state IN ('queued','prepared') AND v_hint IS NULL THEN 'stock_unavailable' END),
    'label', (SELECT jsonb_build_object('kind', l.kind, 'print_count', l.print_count, 'last_printed_at', l.last_printed_at)
                FROM public.labels l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_dispensing_row(public.dispensings) FROM PUBLIC;--> statement-breakpoint

-- Siapkan (UX-10): at the pharmacist's active branch, open visits only. Treatments of confirmed selections with their
-- recipe (mapped lines × quantity, unmapped rows named, the room depot, the T-062 request once prepared); queued
-- product dispensings; draft prescriptions as blocked rows; the stock items and room depots for the mapping and
-- depot choices.
CREATE FUNCTION public.pharmacy_prep_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_reader(ARRAY['pharmacist']);
  b public.branches;
BEGIN
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = a.branch_id;
  IF NOT FOUND OR NOT public.pharmacy_readable(a.tenant_id, a.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('now', clock_timestamp(), 'branch_name', b.name,
    'treatments', coalesce((
      SELECT jsonb_agg(jsonb_build_object('selection_item_id', i.id, 'patient', public.pharmacy_patient_json(i.tenant_id, i.visit_id),
               'name', cv.name, 'catalog_version_id', cv.id, 'quantity', i.quantity,
               'room_depot', (SELECT jsonb_build_object('id', d.id, 'name', d.name) FROM public.depots d
                               WHERE d.tenant_id = i.tenant_id AND d.id = coalesce(r.room_depot_id, public.pharmacy_room_depot(v.tenant_id, v.branch_id, v.appointment_id))),
               'request', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('id', r.id, 'state', r.state) END,
               'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('row_index', l.row_index, 'material', l.material, 'recipe_qty', l.recipe_qty, 'recipe_unit', l.unit,
                                    'item', CASE WHEN l.stock_item_id IS NOT NULL THEN public.pharmacy_item_name(i.tenant_id, l.stock_item_id) END, 'quantity', l.quantity)
                                    ORDER BY l.row_index)
                                   FROM public.pharmacy_recipe_lines(i.tenant_id, i.catalog_version_id, i.quantity) l), '[]'::jsonb),
               'blocker', CASE
                 WHEN r.id IS NOT NULL THEN NULL
                 WHEN v.payment IN ('in_progress','blocked') THEN 'payment_unpaid'
                 WHEN jsonb_array_length(cv.material_formula) = 0 THEN 'no_recipe'
                 WHEN EXISTS (SELECT 1 FROM public.pharmacy_recipe_lines(i.tenant_id, i.catalog_version_id, i.quantity) l WHERE l.stock_item_id IS NULL) THEN 'recipe_unmapped'
                 WHEN public.pharmacy_room_depot(v.tenant_id, v.branch_id, v.appointment_id) IS NULL THEN 'room_depot_missing' END)
             ORDER BY v.checked_in_at, i.id)
        FROM public.selection_items i
        JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id AND v.closed_at IS NULL
        JOIN public.catalog_versions cv ON cv.tenant_id = i.tenant_id AND cv.id = i.catalog_version_id
        LEFT JOIN public.material_requests r ON r.tenant_id = i.tenant_id AND r.id = i.material_request_id
       WHERE i.tenant_id = a.tenant_id AND i.branch_id = a.branch_id AND i.kind = 'service'
         AND (r.id IS NULL OR r.state = 'open')), '[]'::jsonb),
    'products', coalesce((
      SELECT jsonb_agg(public.pharmacy_dispensing_row(d) ORDER BY d.queued_at, d.id)
        FROM public.dispensings d JOIN public.visits v ON v.tenant_id = d.tenant_id AND v.id = d.visit_id AND v.closed_at IS NULL
       WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.state = 'queued'), '[]'::jsonb),
    'unsigned', coalesce((
      SELECT jsonb_agg(jsonb_build_object('prescription_id', rx.id, 'patient', public.pharmacy_patient_json(rx.tenant_id, rx.visit_id),
               'prescriber', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = rx.tenant_id AND s.id = rx.prescriber_staff_id),
               'items', (SELECT count(*) FROM public.prescription_items pi WHERE pi.tenant_id = rx.tenant_id AND pi.prescription_id = rx.id AND pi.removed_at IS NULL),
               'blocker', 'prescription_unsigned') ORDER BY rx.created_at, rx.id)
        FROM public.prescriptions rx JOIN public.visits v ON v.tenant_id = rx.tenant_id AND v.id = rx.visit_id AND v.closed_at IS NULL
       WHERE rx.tenant_id = a.tenant_id AND rx.branch_id = a.branch_id AND rx.state = 'draft'
         AND EXISTS (SELECT 1 FROM public.prescription_items pi WHERE pi.tenant_id = rx.tenant_id AND pi.prescription_id = rx.id AND pi.removed_at IS NULL)), '[]'::jsonb),
    'stock_items', coalesce((SELECT jsonb_agg(public.pharmacy_item_name(si.tenant_id, si.id) ORDER BY si.id)
                               FROM public.stock_items si WHERE si.tenant_id = a.tenant_id AND si.active), '[]'::jsonb),
    'depots', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'kind', d.kind) ORDER BY d.kind, d.name, d.id)
                          FROM public.depots d WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.active), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_prep_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pharmacy_prep_list() TO clinic_app;--> statement-breakpoint

-- Serahkan (UX-10): prepared dispensings of open visits at the pharmacist's branch, and today's handed ones.
CREATE FUNCTION public.pharmacy_handover_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_reader(ARRAY['pharmacist']);
  b public.branches;
BEGIN
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = a.branch_id;
  IF NOT FOUND OR NOT public.pharmacy_readable(a.tenant_id, a.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('now', clock_timestamp(), 'branch_name', b.name,
    'prepared', coalesce((
      SELECT jsonb_agg(public.pharmacy_dispensing_row(d) ORDER BY d.prepared_at, d.id)
        FROM public.dispensings d JOIN public.visits v ON v.tenant_id = d.tenant_id AND v.id = d.visit_id AND v.closed_at IS NULL
       WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.state = 'prepared'), '[]'::jsonb),
    'handed_today', coalesce((
      SELECT jsonb_agg(public.pharmacy_dispensing_row(d) ORDER BY d.handed_at DESC, d.id)
        FROM public.dispensings d
       WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.state = 'handed'
         AND (d.handed_at AT TIME ZONE b.timezone)::date = (clock_timestamp() AT TIME ZONE b.timezone)::date), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_handover_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pharmacy_handover_list() TO clinic_app;--> statement-breakpoint

-- One dispensing (UX-10 row → prescription detail): the row, the patient's birth date and allergy cautions (CD-19
-- allergy check), the prescription (prescriber, signed, valid until, signa, KFA), the handover (checks, note, batches),
-- the patient's open complaint flag is T-057's. Pharmacist, doctor, facility head, records officer at the branch; one
-- audited clinical read.
CREATE FUNCTION public.pharmacy_dispensing_get(p_dispensing uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_reader(ARRAY['pharmacist','doctor','facility_head','records_officer']);
  d public.dispensings;
  pi public.prescription_items;
  rx public.prescriptions;
BEGIN
  SELECT * INTO d FROM public.dispensings x WHERE x.tenant_id = a.tenant_id AND x.id = p_dispensing;
  IF NOT FOUND OR d.branch_id <> a.branch_id OR NOT public.pharmacy_readable(d.tenant_id, d.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: dispensing not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pi FROM public.prescription_items x WHERE x.tenant_id = d.tenant_id AND x.id = d.prescription_item_id;
  SELECT * INTO rx FROM public.prescriptions x WHERE x.tenant_id = d.tenant_id AND x.id = pi.prescription_id;
  PERFORM public.audit_append('clinical_read', 'dispensing', d.id, 'success', 'dispensing_viewed');
  RETURN public.pharmacy_dispensing_row(d) || jsonb_build_object(
    'birth_date', (SELECT pt.birth_date FROM public.patients pt WHERE pt.tenant_id = d.tenant_id AND pt.id = d.patient_id),
    'cautions', public.exam_cautions(d.tenant_id, d.patient_id),
    'prescription', CASE WHEN rx.id IS NOT NULL THEN jsonb_build_object('id', rx.id, 'state', rx.state, 'is_acute', rx.is_acute, 'signed_at', rx.signed_at,
      'valid_until', rx.valid_until, 'prescriber', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = rx.tenant_id AND s.id = rx.prescriber_staff_id),
      'signa', pi.signa, 'kfa_code', pi.kfa_code) END,
    'checks', d.checks, 'exception_note', d.exception_note, 'cancel_reason', d.cancel_reason,
    'handed_by', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = d.tenant_id AND s.id = d.handed_by),
    'batches', coalesce((SELECT jsonb_agg(jsonb_build_object('batch_id', l.batch_id, 'batch_no', b.batch_no, 'expiry', b.expiry, 'quantity', l.quantity) ORDER BY b.expiry, l.batch_id)
                           FROM public.dispensing_lines l JOIN public.stock_batches b ON b.tenant_id = l.tenant_id AND b.id = l.batch_id
                          WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_dispensing_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pharmacy_dispensing_get(uuid) TO clinic_app;--> statement-breakpoint

-- One prescription (the doctor's draft or a signed one) at the branch: items and their dispensings. Pharmacist,
-- doctor, facility head, records officer; one audited clinical read.
CREATE FUNCTION public.prescription_get(p_rx uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_reader(ARRAY['pharmacist','doctor','facility_head','records_officer']);
  rx public.prescriptions;
BEGIN
  SELECT * INTO rx FROM public.prescriptions x WHERE x.tenant_id = a.tenant_id AND x.id = p_rx;
  IF NOT FOUND OR rx.branch_id <> a.branch_id OR NOT public.pharmacy_readable(rx.tenant_id, rx.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: prescription not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('clinical_read', 'prescription', rx.id, 'success', 'prescription_viewed');
  RETURN jsonb_build_object('id', rx.id, 'state', rx.state, 'is_acute', rx.is_acute, 'created_at', rx.created_at, 'signed_at', rx.signed_at, 'valid_until', rx.valid_until,
    'patient', public.pharmacy_patient_json(rx.tenant_id, rx.visit_id),
    'prescriber', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = rx.tenant_id AND s.id = rx.prescriber_staff_id),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'item', public.pharmacy_item_name(i.tenant_id, i.stock_item_id), 'signa', i.signa,
                                 'kfa_code', i.kfa_code, 'quantity', i.quantity, 'external_use', i.external_use,
                                 'dispensing', (SELECT jsonb_build_object('id', d.id, 'state', d.state) FROM public.dispensings d WHERE d.tenant_id = i.tenant_id AND d.prescription_item_id = i.id))
                                 ORDER BY i.added_at, i.id)
                         FROM public.prescription_items i WHERE i.tenant_id = rx.tenant_id AND i.prescription_id = rx.id AND i.removed_at IS NULL), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prescription_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.prescription_get(uuid) TO clinic_app;--> statement-breakpoint

-- Recall trace (PR-18): the handed dispensings of a batch (patients and quantities), newest first, and the batch's
-- hold history. Pharmacist, facility head, manager at the batch's branch; one audited clinical read.
CREATE FUNCTION public.pharmacy_recall_trace(p_batch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_reader(ARRAY['pharmacist','facility_head','manager']);
  b public.stock_batches;
BEGIN
  SELECT * INTO b FROM public.stock_batches x WHERE x.tenant_id = a.tenant_id AND x.id = p_batch;
  IF NOT FOUND OR b.branch_id <> a.branch_id OR NOT public.app_branch_allowed(b.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('clinical_read', 'stock_batch', b.id, 'success', 'recall_traced');
  RETURN jsonb_build_object('batch_id', b.id, 'batch_no', b.batch_no, 'expiry', b.expiry, 'state', b.state, 'item', public.pharmacy_item_name(b.tenant_id, b.item_id),
    'dispensed', coalesce((SELECT jsonb_agg(jsonb_build_object('dispensing_id', d.id, 'patient', public.pharmacy_patient_json(d.tenant_id, d.visit_id),
                                   'quantity', l.quantity, 'handed_at', d.handed_at) ORDER BY d.handed_at DESC, d.id)
                             FROM public.dispensing_lines l JOIN public.dispensings d ON d.tenant_id = l.tenant_id AND d.id = l.dispensing_id AND d.state = 'handed'
                            WHERE l.tenant_id = b.tenant_id AND l.batch_id = b.id), '[]'::jsonb),
    'holds', coalesce((SELECT jsonb_agg(jsonb_build_object('from', h.from_state, 'to', h.to_state, 'reason', h.reason, 'at', h.at) ORDER BY h.at, h.id)
                         FROM public.stock_batch_holds h WHERE h.tenant_id = b.tenant_id AND h.batch_id = b.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_recall_trace(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pharmacy_recall_trace(uuid) TO clinic_app;
