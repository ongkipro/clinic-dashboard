CREATE TABLE "material_consumption_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"consumption_id" uuid NOT NULL,
	"request_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"quantity" numeric NOT NULL,
	"class_used" text NOT NULL,
	"estimated" boolean NOT NULL,
	CONSTRAINT "material_consumption_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_consumption_lines_batch_key" UNIQUE NULLS NOT DISTINCT("tenant_id","consumption_id","request_line_id","batch_id"),
	CONSTRAINT "material_consumption_lines_check" CHECK ("material_consumption_lines"."class_used" in ('bulk','standard','precise') and "material_consumption_lines"."quantity" between 0 and 1000000000 and scale("material_consumption_lines"."quantity") <= 4
      and "material_consumption_lines"."estimated" = ("material_consumption_lines"."class_used" = 'bulk') and (("material_consumption_lines"."batch_id" is null) = ("material_consumption_lines"."estimated" or "material_consumption_lines"."quantity" = 0)))
);
--> statement-breakpoint
CREATE TABLE "material_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"command_key" text NOT NULL,
	"consumed_by" uuid NOT NULL,
	"consumed_as" text NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "material_consumptions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_consumptions_request_key" UNIQUE("tenant_id","request_id"),
	CONSTRAINT "material_consumptions_scope_key" UNIQUE("tenant_id","request_id","id"),
	CONSTRAINT "material_consumptions_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "material_consumptions_check" CHECK ("material_consumptions"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "material_consumptions"."consumed_as" in ('doctor','nurse','therapist'))
);
--> statement-breakpoint
CREATE TABLE "material_issue_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"request_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	CONSTRAINT "material_issue_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_issue_lines_batch_key" UNIQUE("tenant_id","issue_id","batch_id"),
	CONSTRAINT "material_issue_lines_check" CHECK ("material_issue_lines"."quantity" between 0.0001 and 1000000000 and scale("material_issue_lines"."quantity") <= 4 and "material_issue_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_issues" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"from_depot_id" uuid NOT NULL,
	"command_key" text NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_as" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "material_issues_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_issues_request_key" UNIQUE("tenant_id","request_id"),
	CONSTRAINT "material_issues_scope_key" UNIQUE("tenant_id","request_id","id"),
	CONSTRAINT "material_issues_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "material_issues_check" CHECK ("material_issues"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "material_issues"."issued_as" = 'pharmacist')
);
--> statement-breakpoint
CREATE TABLE "material_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"material_class" text NOT NULL,
	"requested_qty" numeric NOT NULL,
	CONSTRAINT "material_request_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_request_lines_item_key" UNIQUE("tenant_id","request_id","item_id"),
	CONSTRAINT "material_request_lines_scope_key" UNIQUE("tenant_id","branch_id","request_id","item_id","id"),
	CONSTRAINT "material_request_lines_check" CHECK ("material_request_lines"."material_class" in ('bulk','standard','precise') and "material_request_lines"."requested_qty" between 0.0001 and 1000000000 and scale("material_request_lines"."requested_qty") <= 4 and "material_request_lines"."requested_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"plan_item_id" uuid,
	"room_depot_id" uuid NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"command_key" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "material_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_requests_branch_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "material_requests_visit_key" UNIQUE("tenant_id","visit_id","id"),
	CONSTRAINT "material_requests_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "material_requests_check" CHECK ("material_requests"."state" in ('open','issued','reconciled','cancelled') and "material_requests"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "material_requests"."requested_as" in ('doctor','nurse','therapist','pharmacist') and (("material_requests"."state" in ('reconciled','cancelled')) = ("material_requests"."closed_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "material_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"request_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	CONSTRAINT "material_return_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_return_lines_batch_key" UNIQUE("tenant_id","return_id","batch_id"),
	CONSTRAINT "material_return_lines_check" CHECK ("material_return_lines"."quantity" between 0.0001 and 1000000000 and scale("material_return_lines"."quantity") <= 4 and "material_return_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"condition" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"to_depot_id" uuid,
	"command_key" text NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposed_as" text NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"decided_by" uuid,
	"decided_as" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "material_returns_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_returns_scope_key" UNIQUE("tenant_id","request_id","id"),
	CONSTRAINT "material_returns_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "material_returns_check" CHECK ("material_returns"."condition" in ('unopened','opened','damaged') and "material_returns"."state" in ('pending','usable','waste') and "material_returns"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "material_returns"."proposed_as" in ('doctor','nurse','therapist') and (("material_returns"."state" = 'usable') = ("material_returns"."to_depot_id" is not null))
      and ("material_returns"."state" <> 'usable' or "material_returns"."condition" <> 'damaged')
      and (("material_returns"."state" = 'pending') = ("material_returns"."decided_at" is null)) and num_nonnulls("material_returns"."decided_by", "material_returns"."decided_as", "material_returns"."decided_at") in (0, 3)
      and ("material_returns"."decided_as" is null or "material_returns"."decided_as" = 'pharmacist'))
);
--> statement-breakpoint
CREATE TABLE "material_waste_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"waste_id" uuid NOT NULL,
	"request_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	CONSTRAINT "material_waste_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_waste_lines_batch_key" UNIQUE("tenant_id","waste_id","batch_id"),
	CONSTRAINT "material_waste_lines_check" CHECK ("material_waste_lines"."quantity" between 0.0001 and 1000000000 and scale("material_waste_lines"."quantity") <= 4 and "material_waste_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_wastes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"command_key" text NOT NULL,
	"wasted_by" uuid NOT NULL,
	"wasted_as" text NOT NULL,
	"wasted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "material_wastes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "material_wastes_scope_key" UNIQUE("tenant_id","request_id","id"),
	CONSTRAINT "material_wastes_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "material_wastes_check" CHECK ("material_wastes"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "material_wastes"."wasted_as" in ('doctor','nurse','therapist') and length(btrim("material_wastes"."reason")) between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_check";--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "material_class" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "material_consumption_lines" ADD CONSTRAINT "material_consumption_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_consumption_lines" ADD CONSTRAINT "material_consumption_lines_header_fk" FOREIGN KEY ("tenant_id","request_id","consumption_id") REFERENCES "public"."material_consumptions"("tenant_id","request_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_consumption_lines" ADD CONSTRAINT "material_consumption_lines_line_fk" FOREIGN KEY ("tenant_id","branch_id","request_id","item_id","request_line_id") REFERENCES "public"."material_request_lines"("tenant_id","branch_id","request_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_consumption_lines" ADD CONSTRAINT "material_consumption_lines_batch_fk" FOREIGN KEY ("tenant_id","branch_id","item_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_consumptions" ADD CONSTRAINT "material_consumptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_consumptions" ADD CONSTRAINT "material_consumptions_request_fk" FOREIGN KEY ("tenant_id","branch_id","request_id") REFERENCES "public"."material_requests"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_consumptions" ADD CONSTRAINT "material_consumptions_by_fk" FOREIGN KEY ("tenant_id","consumed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_issue_fk" FOREIGN KEY ("tenant_id","request_id","issue_id") REFERENCES "public"."material_issues"("tenant_id","request_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_line_fk" FOREIGN KEY ("tenant_id","branch_id","request_id","item_id","request_line_id") REFERENCES "public"."material_request_lines"("tenant_id","branch_id","request_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_batch_fk" FOREIGN KEY ("tenant_id","branch_id","item_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_request_fk" FOREIGN KEY ("tenant_id","branch_id","request_id") REFERENCES "public"."material_requests"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_depot_fk" FOREIGN KEY ("tenant_id","branch_id","from_depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_by_fk" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_request_fk" FOREIGN KEY ("tenant_id","branch_id","request_id") REFERENCES "public"."material_requests"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_plan_item_fk" FOREIGN KEY ("tenant_id","plan_item_id") REFERENCES "public"."plan_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_room_fk" FOREIGN KEY ("tenant_id","branch_id","room_depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_return_lines" ADD CONSTRAINT "material_return_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_return_lines" ADD CONSTRAINT "material_return_lines_header_fk" FOREIGN KEY ("tenant_id","request_id","return_id") REFERENCES "public"."material_returns"("tenant_id","request_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_return_lines" ADD CONSTRAINT "material_return_lines_line_fk" FOREIGN KEY ("tenant_id","branch_id","request_id","item_id","request_line_id") REFERENCES "public"."material_request_lines"("tenant_id","branch_id","request_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_return_lines" ADD CONSTRAINT "material_return_lines_batch_fk" FOREIGN KEY ("tenant_id","branch_id","item_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_returns" ADD CONSTRAINT "material_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_returns" ADD CONSTRAINT "material_returns_request_fk" FOREIGN KEY ("tenant_id","branch_id","request_id") REFERENCES "public"."material_requests"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_returns" ADD CONSTRAINT "material_returns_depot_fk" FOREIGN KEY ("tenant_id","branch_id","to_depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_returns" ADD CONSTRAINT "material_returns_by_fk" FOREIGN KEY ("tenant_id","proposed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_returns" ADD CONSTRAINT "material_returns_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_waste_lines" ADD CONSTRAINT "material_waste_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_waste_lines" ADD CONSTRAINT "material_waste_lines_header_fk" FOREIGN KEY ("tenant_id","request_id","waste_id") REFERENCES "public"."material_wastes"("tenant_id","request_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_waste_lines" ADD CONSTRAINT "material_waste_lines_line_fk" FOREIGN KEY ("tenant_id","branch_id","request_id","item_id","request_line_id") REFERENCES "public"."material_request_lines"("tenant_id","branch_id","request_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_waste_lines" ADD CONSTRAINT "material_waste_lines_batch_fk" FOREIGN KEY ("tenant_id","branch_id","item_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_wastes" ADD CONSTRAINT "material_wastes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_wastes" ADD CONSTRAINT "material_wastes_request_fk" FOREIGN KEY ("tenant_id","branch_id","request_id") REFERENCES "public"."material_requests"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_wastes" ADD CONSTRAINT "material_wastes_by_fk" FOREIGN KEY ("tenant_id","wasted_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_requests_queue_idx" ON "material_requests" USING btree ("tenant_id","branch_id","state","requested_at");--> statement-breakpoint
CREATE INDEX "material_returns_queue_idx" ON "material_returns" USING btree ("tenant_id","branch_id","state");--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_material_class_check" CHECK ("stock_items"."material_class" in ('bulk','standard','precise'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_check" CHECK ("stock_movements"."kind" in ('receive','adjust','issue','consume','return','waste','transfer_out','transfer_in','supplier_return','dispense') and "stock_movements"."quantity" between -1000000000 and 1000000000 and scale("stock_movements"."quantity") <= 4 and "stock_movements"."quantity" <> 0
      and "stock_movements"."balance_after" between 0 and 1000000000 and scale("stock_movements"."balance_after") <= 4 and "stock_movements"."source_kind" ~ '^[a-z][a-z_]{1,40}$'
      and ("stock_movements"."reason" is null or length(btrim("stock_movements"."reason")) between 3 and 500)
      and "stock_movements"."depot_balance_after" between 0 and 1000000000 and scale("stock_movements"."depot_balance_after") <= 4
      and ("stock_movements"."kind" = 'receive' and "stock_movements"."leg" is null and "stock_movements"."quantity" > 0
           or "stock_movements"."kind" = 'adjust' and "stock_movements"."leg" is null
           or "stock_movements"."kind" in ('consume','waste','supplier_return','dispense') and "stock_movements"."leg" is null and "stock_movements"."quantity" < 0
           or "stock_movements"."kind" = 'transfer_out' and "stock_movements"."leg" is not distinct from 'out' and "stock_movements"."quantity" < 0
           or "stock_movements"."kind" = 'transfer_in' and "stock_movements"."leg" is not distinct from 'in' and "stock_movements"."quantity" > 0
           or "stock_movements"."kind" in ('issue','return') and ("stock_movements"."leg" is not distinct from 'out' and "stock_movements"."quantity" < 0
                                                  or "stock_movements"."leg" is not distinct from 'in' and "stock_movements"."quantity" > 0)));--> statement-breakpoint

-- T-062 rules (generated by gen.py; plan docs/tasks/T-062.md)
-- ── Readers and actors (plan open point 8, P2) ─────────────────────────────────────────────────────────────────
-- Material rows are read by the room and pharmacy roles and the manager at their branch, on the wall clock
-- (stock_member_now: the acting role held now; a branch role only at a branch it holds now). Purchasing and the
-- auditor have no clinical projection (IAM-12): they see these movements only through stock_card, masked.
CREATE FUNCTION public.material_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant)
    AND public.app_role_in(ARRAY['doctor','nurse','therapist','pharmacist','manager'])
    AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Writer actor: the staff_access lock first (DEC-043), the role, the tenant serving visits, and the active branch for
-- every role (all material writers are Level 3 roles; tenant_actor_lock refuses a Level 3 role without one). Unlike
-- stock_actor (0077), a doctor, nurse or therapist keeps the active branch (P2-2). No 0077/0078 function changes.
CREATE FUNCTION public.material_actor(p_roles text[], OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not use materials' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.tenant_capability('existing_appointment') OR public.tenant_capability('configuration')) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: materials are not available now' USING ERRCODE = '42501';
  END IF;
  IF branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = material_actor.tenant_id AND b.id = material_actor.branch_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an active branch is needed' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_actor(text[]) FROM PUBLIC;--> statement-breakpoint

-- Reader actor: the lock, a reader role, its active branch.
CREATE FUNCTION public.material_reader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('doctor','nurse','therapist','pharmacist','manager') OR branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read materials' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_reader() FROM PUBLIC;--> statement-breakpoint

-- The request at the actor's active branch, locked (lock order: staff_access → request → child header → batches →
-- holdings). Another branch's or tenant's request is not found.
CREATE FUNCTION public.material_request_locked(p_tenant uuid, p_branch uuid, p_request uuid) RETURNS public.material_requests
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.material_requests;
BEGIN
  SELECT * INTO r FROM public.material_requests x WHERE x.tenant_id = p_tenant AND x.id = p_request FOR UPDATE;
  IF NOT FOUND OR r.branch_id <> p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: request not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN r;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_request_locked(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Per (request line, batch): issued, consumed, returned (decided usable), wasted (waste lines + returns decided
-- waste), pending (lines of pending returns) and the free quantity issued − all the others (plan P1-2, r2 note 2).
CREATE FUNCTION public.material_batch_ledger(p_tenant uuid, p_request uuid)
RETURNS TABLE (request_line_id uuid, batch_id uuid, expiry date, received_at timestamptz, issued numeric, consumed numeric,
               returned numeric, wasted numeric, pending numeric, free numeric)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH i AS (SELECT l.request_line_id, l.batch_id, sum(l.quantity) q FROM public.material_issue_lines l
              WHERE l.tenant_id = p_tenant AND l.request_id = p_request GROUP BY 1, 2),
       c AS (SELECT l.request_line_id, l.batch_id, sum(l.quantity) q FROM public.material_consumption_lines l
              WHERE l.tenant_id = p_tenant AND l.request_id = p_request AND l.batch_id IS NOT NULL GROUP BY 1, 2),
       r AS (SELECT l.request_line_id, l.batch_id,
                    sum(l.quantity) FILTER (WHERE m.state = 'usable') ru, sum(l.quantity) FILTER (WHERE m.state = 'waste') rw,
                    sum(l.quantity) FILTER (WHERE m.state = 'pending') rp
               FROM public.material_return_lines l JOIN public.material_returns m ON m.tenant_id = l.tenant_id AND m.id = l.return_id
              WHERE l.tenant_id = p_tenant AND l.request_id = p_request GROUP BY 1, 2),
       w AS (SELECT l.request_line_id, l.batch_id, sum(l.quantity) q FROM public.material_waste_lines l
              WHERE l.tenant_id = p_tenant AND l.request_id = p_request GROUP BY 1, 2)
  SELECT i.request_line_id, i.batch_id, b.expiry, b.received_at, i.q,
         coalesce(c.q, 0), coalesce(r.ru, 0), coalesce(w.q, 0) + coalesce(r.rw, 0), coalesce(r.rp, 0),
         i.q - coalesce(c.q, 0) - coalesce(r.ru, 0) - coalesce(w.q, 0) - coalesce(r.rw, 0) - coalesce(r.rp, 0)
    FROM i JOIN public.stock_batches b ON b.tenant_id = p_tenant AND b.id = i.batch_id
    LEFT JOIN c ON c.request_line_id = i.request_line_id AND c.batch_id = i.batch_id
    LEFT JOIN r ON r.request_line_id = i.request_line_id AND r.batch_id = i.batch_id
    LEFT JOIN w ON w.request_line_id = i.request_line_id AND w.batch_id = i.batch_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_batch_ledger(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Run an open vial of (batch, depot) down by what was just taken out of the depot (P1-1: stock_move_depot clamps a
-- vial only when the depot balance falls below it, so a vial beside sealed stock would keep its remainder). Closed
-- `finished` at 0, or `lapsed` when it was already unfit (a wasted lapsed remainder).
CREATE FUNCTION public.material_vial_take(p_tenant uuid, p_batch uuid, p_depot uuid, p_qty numeric) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.opened_vials;
  v_new numeric;
BEGIN
  SELECT * INTO v FROM public.opened_vials x WHERE x.tenant_id = p_tenant AND x.batch_id = p_batch AND x.depot_id = p_depot AND x.state = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_new := greatest(v.remaining - p_qty, 0);
  UPDATE public.opened_vials SET remaining = v_new,
         state = CASE WHEN v_new = 0 THEN CASE WHEN public.stock_vial_unfit(v) IS NOT NULL THEN 'lapsed' ELSE 'finished' END ELSE state END,
         closed_at = CASE WHEN v_new = 0 THEN clock_timestamp() END
   WHERE tenant_id = v.tenant_id AND id = v.id AND remaining > v_new;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_vial_take(uuid, uuid, uuid, numeric) FROM PUBLIC;--> statement-breakpoint

-- The request is reconciled when every line is (non-bulk: consumed + returned + wasted = issued; bulk: consumed above
-- zero, or returned + wasted = issued) and no return is pending. A bulk line used 0 stays open for its return or waste.
CREATE FUNCTION public.material_request_settle(p_tenant uuid, p_request uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.material_returns m WHERE m.tenant_id = p_tenant AND m.request_id = p_request AND m.state = 'pending') THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.material_request_lines l
      LEFT JOIN LATERAL (SELECT coalesce(sum(g.issued), 0) iss, coalesce(sum(g.consumed), 0) con, coalesce(sum(g.returned), 0) ret, coalesce(sum(g.wasted), 0) was
                           FROM public.material_batch_ledger(p_tenant, p_request) g WHERE g.request_line_id = l.id) g ON true
     WHERE l.tenant_id = p_tenant AND l.request_id = p_request
       AND NOT CASE WHEN l.material_class = 'bulk'
                    THEN EXISTS (SELECT 1 FROM public.material_consumption_lines c WHERE c.tenant_id = p_tenant AND c.request_line_id = l.id AND c.quantity > 0)
                         OR g.ret + g.was = g.iss
                    ELSE g.con + g.ret + g.was = g.iss END) THEN
    RETURN;
  END IF;
  UPDATE public.material_requests SET state = 'reconciled', closed_at = clock_timestamp()
   WHERE tenant_id = p_tenant AND id = p_request AND state = 'issued';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_request_settle(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.material_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_requests_read ON public.material_requests FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_requests TO clinic_app;--> statement-breakpoint
CREATE POLICY material_requests_operator_read ON public.material_requests FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_requests', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_requests TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_requests_no_truncate BEFORE TRUNCATE ON public.material_requests FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_requests ENABLE ALWAYS TRIGGER material_requests_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_request_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_request_lines_read ON public.material_request_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_request_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY material_request_lines_operator_read ON public.material_request_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_request_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_request_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_request_lines_no_truncate BEFORE TRUNCATE ON public.material_request_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_request_lines ENABLE ALWAYS TRIGGER material_request_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_issues ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_issues_read ON public.material_issues FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_issues TO clinic_app;--> statement-breakpoint
CREATE POLICY material_issues_operator_read ON public.material_issues FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_issues', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_issues TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_issues_no_truncate BEFORE TRUNCATE ON public.material_issues FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_issues ENABLE ALWAYS TRIGGER material_issues_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_issue_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_issue_lines_read ON public.material_issue_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_issue_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY material_issue_lines_operator_read ON public.material_issue_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_issue_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_issue_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_issue_lines_no_truncate BEFORE TRUNCATE ON public.material_issue_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_issue_lines ENABLE ALWAYS TRIGGER material_issue_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_consumptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_consumptions_read ON public.material_consumptions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_consumptions TO clinic_app;--> statement-breakpoint
CREATE POLICY material_consumptions_operator_read ON public.material_consumptions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_consumptions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_consumptions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_consumptions_no_truncate BEFORE TRUNCATE ON public.material_consumptions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_consumptions ENABLE ALWAYS TRIGGER material_consumptions_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_consumption_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_consumption_lines_read ON public.material_consumption_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_consumption_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY material_consumption_lines_operator_read ON public.material_consumption_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_consumption_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_consumption_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_consumption_lines_no_truncate BEFORE TRUNCATE ON public.material_consumption_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_consumption_lines ENABLE ALWAYS TRIGGER material_consumption_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_returns ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_returns_read ON public.material_returns FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_returns TO clinic_app;--> statement-breakpoint
CREATE POLICY material_returns_operator_read ON public.material_returns FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_returns', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_returns TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_returns_no_truncate BEFORE TRUNCATE ON public.material_returns FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_returns ENABLE ALWAYS TRIGGER material_returns_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_return_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_return_lines_read ON public.material_return_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_return_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY material_return_lines_operator_read ON public.material_return_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_return_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_return_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_return_lines_no_truncate BEFORE TRUNCATE ON public.material_return_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_return_lines ENABLE ALWAYS TRIGGER material_return_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_wastes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_wastes_read ON public.material_wastes FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_wastes TO clinic_app;--> statement-breakpoint
CREATE POLICY material_wastes_operator_read ON public.material_wastes FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_wastes', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_wastes TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_wastes_no_truncate BEFORE TRUNCATE ON public.material_wastes FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_wastes ENABLE ALWAYS TRIGGER material_wastes_no_truncate;--> statement-breakpoint
ALTER TABLE public.material_waste_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY material_waste_lines_read ON public.material_waste_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.material_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.material_waste_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY material_waste_lines_operator_read ON public.material_waste_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.material_waste_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.material_waste_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER material_waste_lines_no_truncate BEFORE TRUNCATE ON public.material_waste_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.material_waste_lines ENABLE ALWAYS TRIGGER material_waste_lines_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.material_requests', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_request_lines', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_issues', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_issue_lines', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_consumptions', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_consumption_lines', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_returns', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_return_lines', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_wastes', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)'),
  ('public.material_waste_lines', 'branch-scoped', 'inventory', '{doctor,nurse,therapist,pharmacist,manager}', 'material definers (src/modules/inventory/materials)', 'the request''s branch (the visit''s)');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): material rows are patient-linked through the visit (personal).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.material_requests', 'personal'),
  ('public.material_request_lines', 'personal'),
  ('public.material_issues', 'personal'),
  ('public.material_issue_lines', 'personal'),
  ('public.material_consumptions', 'personal'),
  ('public.material_consumption_lines', 'personal'),
  ('public.material_returns', 'personal'),
  ('public.material_return_lines', 'personal'),
  ('public.material_wastes', 'personal'),
  ('public.material_waste_lines', 'personal');--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS, after the staff_access lock; clinic_app holds SELECT only, so these are the second line) ─
-- Child rows (lines of requests, issues, consumptions, returns, wastes) are insert-only and never deleted.
CREATE FUNCTION public.material_rows_insert_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% rows are never changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_rows_insert_only() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER material_request_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_request_lines FOR EACH ROW EXECUTE FUNCTION public.material_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.material_request_lines ENABLE ALWAYS TRIGGER material_request_lines_guard;--> statement-breakpoint
CREATE TRIGGER material_issues_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_issues FOR EACH ROW EXECUTE FUNCTION public.material_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.material_issues ENABLE ALWAYS TRIGGER material_issues_guard;--> statement-breakpoint
CREATE TRIGGER material_issue_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_issue_lines FOR EACH ROW EXECUTE FUNCTION public.material_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.material_issue_lines ENABLE ALWAYS TRIGGER material_issue_lines_guard;--> statement-breakpoint
CREATE TRIGGER material_consumptions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_consumptions FOR EACH ROW EXECUTE FUNCTION public.material_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.material_consumptions ENABLE ALWAYS TRIGGER material_consumptions_guard;--> statement-breakpoint
CREATE TRIGGER material_consumption_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_consumption_lines FOR EACH ROW EXECUTE FUNCTION public.material_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.material_consumption_lines ENABLE ALWAYS TRIGGER material_consumption_lines_guard;--> statement-breakpoint
CREATE TRIGGER material_return_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_return_lines FOR EACH ROW EXECUTE FUNCTION public.material_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.material_return_lines ENABLE ALWAYS TRIGGER material_return_lines_guard;--> statement-breakpoint
CREATE TRIGGER material_wastes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_wastes FOR EACH ROW EXECUTE FUNCTION public.material_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.material_wastes ENABLE ALWAYS TRIGGER material_wastes_guard;--> statement-breakpoint
CREATE TRIGGER material_waste_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_waste_lines FOR EACH ROW EXECUTE FUNCTION public.material_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.material_waste_lines ENABLE ALWAYS TRIGGER material_waste_lines_guard;--> statement-breakpoint

-- Requests: never deleted; a new request is open, for an open visit, into an active ruang depot of the visit's
-- branch, its plan item (if any) live and of an active plan of the visit's patient (merge cluster, r2 note 3); later
-- only the state moves: open → issued | cancelled, issued → reconciled.
CREATE FUNCTION public.material_requests_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'material requests are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open'
       OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = NEW.tenant_id AND v.branch_id = NEW.branch_id AND v.id = NEW.visit_id AND v.closed_at IS NULL)
       OR NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = NEW.tenant_id AND d.branch_id = NEW.branch_id AND d.id = NEW.room_depot_id AND d.kind = 'ruang' AND d.active) THEN
      RAISE EXCEPTION 'a request opens for an open visit into a room depot of its branch' USING ERRCODE = '42501';
    END IF;
    IF NEW.plan_item_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.plan_items i
           JOIN public.care_plans c ON c.tenant_id = i.tenant_id AND c.id = i.plan_id AND c.state = 'active'
           JOIN public.visits v ON v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
          WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.plan_item_id AND i.removed_at IS NULL
            AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, public.patient_canonical(v.tenant_id, v.patient_id)))) THEN
      RAISE EXCEPTION 'a request names a live plan item of the visit''s patient' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.plan_item_id, NEW.room_depot_id, NEW.command_key, NEW.requested_by, NEW.requested_as, NEW.requested_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.plan_item_id, OLD.room_depot_id, OLD.command_key, OLD.requested_by, OLD.requested_as, OLD.requested_at)
     OR NOT (OLD.state = 'open' AND NEW.state IN ('issued','cancelled') OR OLD.state = 'issued' AND NEW.state = 'reconciled') THEN
    RAISE EXCEPTION 'a request only moves open → issued | cancelled → … issued → reconciled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_requests_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER material_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_requests FOR EACH ROW EXECUTE FUNCTION public.material_requests_guard();--> statement-breakpoint
ALTER TABLE public.material_requests ENABLE ALWAYS TRIGGER material_requests_guard;--> statement-breakpoint

-- Returns: never deleted; a new return is pending; later only the decision (state, depot, decider) once.
CREATE FUNCTION public.material_returns_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'material returns are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' THEN
      RAISE EXCEPTION 'a return opens pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.request_id, NEW.condition, NEW.command_key, NEW.proposed_by, NEW.proposed_as, NEW.proposed_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.request_id, OLD.condition, OLD.command_key, OLD.proposed_by, OLD.proposed_as, OLD.proposed_at)
     OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RAISE EXCEPTION 'a return is decided once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_returns_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER material_returns_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_returns FOR EACH ROW EXECUTE FUNCTION public.material_returns_guard();--> statement-breakpoint
ALTER TABLE public.material_returns ENABLE ALWAYS TRIGGER material_returns_guard;--> statement-breakpoint

-- P3-2: an item's unit and vial size freeze once a request line names it (0077's stock_items_guard covers batches,
-- levels and count lines; it is not re-created).
CREATE FUNCTION public.stock_items_materials_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF (NEW.unit IS DISTINCT FROM OLD.unit OR NEW.vial_size IS DISTINCT FROM OLD.vial_size)
     AND EXISTS (SELECT 1 FROM public.material_request_lines l WHERE l.tenant_id = OLD.tenant_id AND l.item_id = OLD.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the unit is in use' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_items_materials_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_items_materials_guard BEFORE UPDATE ON public.stock_items FOR EACH ROW EXECUTE FUNCTION public.stock_items_materials_guard();--> statement-breakpoint
ALTER TABLE public.stock_items ENABLE ALWAYS TRIGGER stock_items_materials_guard;--> statement-breakpoint

-- ── Writers (plan open points 1–7; lock order staff_access → request → child header → batches → holdings) ────────
-- Every command runs through runCommand (key in idempotency_records) and stores its own command key on its header row
-- (unique per tenant): a replay returns the stored result; a second write with the key cannot exist.

-- Item class (open point 1): pharmacist, purchasing, admin pusat; changes later requests only (each line keeps the
-- class it was requested with).
CREATE FUNCTION public.stock_item_class_set(p_item uuid, p_class text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing','admin_pusat'], 'configuration', NULL);
BEGIN
  IF p_class IS NULL OR p_class NOT IN ('bulk','standard','precise') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: class' USING ERRCODE = '22023';
  END IF;
  UPDATE public.stock_items SET material_class = p_class, updated_by = a.staff_id, updated_at = clock_timestamp()
   WHERE tenant_id = a.tenant_id AND id = p_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('settings_change', 'stock_item', p_item, 'success', 'stock_item_class_set');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_item_class_set(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_item_class_set(uuid, text) TO clinic_app;--> statement-breakpoint

-- Request (open point 2): moves no stock. p: {visit_id, room_depot_id, plan_item_id?, lines: [{item_id, quantity}]}.
CREATE FUNCTION public.material_request_create(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_actor(ARRAY['doctor','nurse','therapist','pharmacist']);
  v_id uuid;
  v_items uuid[];
  v_qtys numeric[];
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'lines') NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: request' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT array_agg((x ->> 'item_id')::uuid), array_agg((x ->> 'quantity')::numeric) INTO v_items, v_qtys FROM jsonb_array_elements(p -> 'lines') x;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END;
  IF array_position(v_items, NULL) IS NOT NULL OR array_position(v_qtys, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT u) FROM unnest(v_items) u) <> cardinality(v_items)
     OR EXISTS (SELECT 1 FROM unnest(v_qtys) q WHERE NOT (q > 0 AND q <= 1000000000 AND scale(q) <= 4)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.stock_items i WHERE i.tenant_id = a.tenant_id AND i.id = ANY (v_items) AND i.active) <> cardinality(v_items) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.branch_id = a.branch_id AND v.id = NULLIF(p ->> 'visit_id', '')::uuid AND v.closed_at IS NULL) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.id = NULLIF(p ->> 'room_depot_id', '')::uuid
                    AND d.kind = 'ruang' AND d.active) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: room depot' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.material_requests (tenant_id, branch_id, visit_id, plan_item_id, room_depot_id, command_key, requested_by, requested_as)
    VALUES (a.tenant_id, a.branch_id, (p ->> 'visit_id')::uuid, NULLIF(p ->> 'plan_item_id', '')::uuid, (p ->> 'room_depot_id')::uuid, p_key, a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a request with this key exists' USING ERRCODE = '23505';
            WHEN check_violation OR foreign_key_violation OR invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: request' USING ERRCODE = '22023';
            WHEN insufficient_privilege THEN  -- material_requests_guard: visit, room depot or plan item
    RAISE EXCEPTION 'ERR_INVALID_INPUT: request' USING ERRCODE = '22023';
  END;
  INSERT INTO public.material_request_lines (tenant_id, branch_id, request_id, item_id, material_class, requested_qty)
  SELECT a.tenant_id, a.branch_id, v_id, u.i, si.material_class, u.q
    FROM unnest(v_items, v_qtys) u(i, q) JOIN public.stock_items si ON si.tenant_id = a.tenant_id AND si.id = u.i;
  PERFORM public.audit_append('settings_change', 'material_request', v_id, 'success', 'material_requested');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_request_create(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_request_create(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Cancel before any issue (open point 7).
CREATE FUNCTION public.material_request_cancel(p_request uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_actor(ARRAY['doctor','nurse','therapist','pharmacist']);
  r public.material_requests := public.material_request_locked(a.tenant_id, a.branch_id, p_request);
BEGIN
  IF r.state <> 'open' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: request %', r.state USING ERRCODE = '55000';
  END IF;
  UPDATE public.material_requests SET state = 'cancelled', closed_at = clock_timestamp() WHERE tenant_id = r.tenant_id AND id = r.id;
  PERFORM public.audit_append('settings_change', 'material_request', r.id, 'success', 'material_request_cancelled');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_request_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_request_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- Issue (open point 3, P1-1, P1-2): once per request, every line, by the pharmacist, from one depot of the branch into
-- the request's room depot. Per line FEFO in the source depot (fit stock only); picks aggregated per batch (one out/in
-- pair of `issue` legs per batch: the batch quantity is unchanged); a pick that took a fit open vial's remainder runs
-- that vial down. p: {from_depot_id, lines?: [{item_id, quantity}]} (default: the requested quantities).
CREATE FUNCTION public.material_issue(p_key text, p_request uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_actor(ARRAY['pharmacist']);
  r public.material_requests := public.material_request_locked(a.tenant_id, a.branch_id, p_request);
  s public.depots;
  v_id uuid;
  v_l record;
  v_pk record;
  v_qty numeric;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (p ? 'lines' AND jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: issue' USING ERRCODE = '22023';
  END IF;
  IF r.state <> 'open' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: request %', r.state USING ERRCODE = '55000';
  END IF;
  SELECT * INTO s FROM public.depots d WHERE d.tenant_id = a.tenant_id AND d.branch_id = r.branch_id AND d.id = NULLIF(p ->> 'from_depot_id', '')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  IF s.id = r.room_depot_id OR NOT s.active THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: source depot' USING ERRCODE = '22023';
  END IF;
  IF p ? 'lines' AND (SELECT count(DISTINCT x ->> 'item_id') <> count(*) FROM jsonb_array_elements(p -> 'lines') x) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  IF p ? 'lines' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p -> 'lines') x
        WHERE NOT EXISTS (SELECT 1 FROM public.material_request_lines rq WHERE rq.tenant_id = r.tenant_id AND rq.request_id = r.id AND rq.item_id::text = x ->> 'item_id')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.material_issues (tenant_id, branch_id, request_id, from_depot_id, command_key, issued_by, issued_as)
    VALUES (a.tenant_id, r.branch_id, r.id, s.id, p_key, a.staff_id, a.role) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an issue with this key exists' USING ERRCODE = '23505';
  END;
  FOR v_l IN SELECT * FROM public.material_request_lines x WHERE x.tenant_id = r.tenant_id AND x.request_id = r.id ORDER BY x.id LOOP
    BEGIN
      v_qty := coalesce((SELECT (x ->> 'quantity')::numeric FROM jsonb_array_elements(p -> 'lines') x WHERE x ->> 'item_id' = v_l.item_id::text LIMIT 1), v_l.requested_qty);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
    END;
    IF v_qty IS NULL OR NOT (v_qty > 0 AND v_qty <= v_l.requested_qty AND scale(v_qty) <= 4) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: an issued quantity is above zero and at most the requested' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.material_issue_lines (tenant_id, branch_id, request_id, issue_id, request_line_id, item_id, batch_id, quantity)
    SELECT a.tenant_id, r.branch_id, r.id, v_id, v_l.id, v_l.item_id, f.batch_id, sum(f.take)
      FROM public.stock_fefo_depot(a.tenant_id, s.id, v_l.item_id, v_qty) f GROUP BY f.batch_id;
  END LOOP;
  -- Lock the batches then the source and room holdings in id order before the legs (lock order).
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = a.tenant_id
     AND b.id IN (SELECT il.batch_id FROM public.material_issue_lines il WHERE il.tenant_id = a.tenant_id AND il.issue_id = v_id) ORDER BY b.id FOR UPDATE;
  PERFORM 1 FROM public.batch_holdings h WHERE h.tenant_id = a.tenant_id AND h.depot_id IN (s.id, r.room_depot_id)
     AND h.batch_id IN (SELECT il.batch_id FROM public.material_issue_lines il WHERE il.tenant_id = a.tenant_id AND il.issue_id = v_id) ORDER BY h.id FOR UPDATE;
  FOR v_pk IN SELECT * FROM public.material_issue_lines il WHERE il.tenant_id = a.tenant_id AND il.issue_id = v_id ORDER BY il.batch_id LOOP
    -- The fit open vial of the source depot is taken first by FEFO (tier 1): run it down by what it gave.
    PERFORM public.material_vial_take(a.tenant_id, v_pk.batch_id, s.id,
      least(v_pk.quantity, coalesce((SELECT v.remaining FROM public.opened_vials v WHERE v.tenant_id = a.tenant_id AND v.batch_id = v_pk.batch_id AND v.depot_id = s.id
                                     AND v.state = 'open' AND public.stock_vial_unfit(v) IS NULL), 0)));
    PERFORM public.stock_move_depot(a.tenant_id, v_pk.batch_id, s.id, 'issue', -v_pk.quantity, NULL, 'material_issue', v_id, a.staff_id, a.role, 'out');
    PERFORM public.stock_move_depot(a.tenant_id, v_pk.batch_id, r.room_depot_id, 'issue', v_pk.quantity, NULL, 'material_issue', v_id, a.staff_id, a.role, 'in');
  END LOOP;
  UPDATE public.material_requests SET state = 'issued' WHERE tenant_id = r.tenant_id AND id = r.id;
  PERFORM public.audit_append('settings_change', 'material_request', r.id, 'success', 'material_issued');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (r.branch_id, 'StockIssued', 'material_request', r.id, jsonb_build_object('request_id', r.id, 'issue_id', v_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_issue(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_issue(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Allocation of a quantity of a line over its batches (P1-2): a named batch (precise always; others may) or the
-- line's batches with free quantity in FEFO order. Refuses ERR_STOCK_INSUFFICIENT when the free quantity is short.
CREATE FUNCTION public.material_allocate(p_tenant uuid, p_request uuid, p_line uuid, p_batch uuid, p_qty numeric)
RETURNS TABLE (batch_id uuid, take numeric)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_left numeric := p_qty;
  v_g record;
BEGIN
  FOR v_g IN SELECT * FROM public.material_batch_ledger(p_tenant, p_request) x
            WHERE x.request_line_id = p_line AND x.free > 0 AND (p_batch IS NULL OR x.batch_id = p_batch)
            ORDER BY x.expiry, x.received_at, x.batch_id LOOP
    EXIT WHEN v_left <= 0;
    batch_id := v_g.batch_id; take := least(v_g.free, v_left);
    v_left := v_left - take;
    RETURN NEXT;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: more than was issued and is still open on the line' USING ERRCODE = 'P0422';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_allocate(uuid, uuid, uuid, uuid, numeric) FROM PUBLIC;--> statement-breakpoint

-- The lines of a consume/return/waste payload: [{item_id, quantity, batch_id?}] → (request line, class, batch, qty);
-- each item once, of this request; quantity ≥ 0 (consume) or > 0 (return, waste).
CREATE FUNCTION public.material_payload_lines(p_tenant uuid, p_request uuid, p_lines jsonb)
RETURNS TABLE (request_line_id uuid, item_id uuid, material_class text, batch_id uuid, quantity numeric)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  BEGIN
    RETURN QUERY
      SELECT l.id, l.item_id, l.material_class, NULLIF(x ->> 'batch_id', '')::uuid, (x ->> 'quantity')::numeric
        FROM jsonb_array_elements(p_lines) x
        LEFT JOIN public.material_request_lines l ON l.tenant_id = p_tenant AND l.request_id = p_request AND l.item_id::text = x ->> 'item_id';
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_payload_lines(uuid, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.material_lines_checked(p_tenant uuid, p_request uuid, p_lines jsonb, p_allow_zero boolean)
RETURNS TABLE (request_line_id uuid, item_id uuid, material_class text, batch_id uuid, quantity numeric)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.material_payload_lines(p_tenant, p_request, p_lines) x
              WHERE x.request_line_id IS NULL OR x.quantity IS NULL OR scale(x.quantity) > 4 OR x.quantity > 1000000000
                 OR (CASE WHEN p_allow_zero THEN x.quantity < 0 ELSE x.quantity <= 0 END))
     OR (SELECT count(DISTINCT x.request_line_id) <> count(*) FROM public.material_payload_lines(p_tenant, p_request, p_lines) x) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT * FROM public.material_payload_lines(p_tenant, p_request, p_lines) x ORDER BY x.request_line_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_lines_checked(uuid, uuid, jsonb, boolean) FROM PUBLIC;--> statement-breakpoint

-- Consumption (open point 4, CLIN-008): once per request (unique), by the room staff, for every line of an issued
-- request. Lines left out use their issued quantity (deviations only). standard/precise: `consume` from the room depot
-- on the allocated batches (precise: the batch named), running a fit open vial down; 0 is recorded and moves nothing.
-- bulk: an estimate (estimated = true), no movement (the pack left usable stock when issued; room counts own it).
-- p: {lines?: [{item_id, quantity, batch_id?}]}.
CREATE FUNCTION public.material_consume(p_key text, p_request uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_actor(ARRAY['doctor','nurse','therapist']);
  r public.material_requests := public.material_request_locked(a.tenant_id, a.branch_id, p_request);
  v_id uuid;
  v_l record;
  v_x record;
  v_al record;
  v_qty numeric;
  v_batch uuid;
  v_found boolean;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: consumption' USING ERRCODE = '22023';
  END IF;
  IF r.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: request %', r.state USING ERRCODE = '55000';
  END IF;
  IF p ? 'lines' THEN
    PERFORM 1 FROM public.material_lines_checked(a.tenant_id, r.id, p -> 'lines', true);
  END IF;
  BEGIN
    INSERT INTO public.material_consumptions (tenant_id, branch_id, request_id, command_key, consumed_by, consumed_as)
    VALUES (a.tenant_id, r.branch_id, r.id, p_key, a.staff_id, a.role) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (SELECT 1 FROM public.material_consumptions c WHERE c.tenant_id = a.tenant_id AND c.request_id = r.id) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the request was already consumed' USING ERRCODE = '55000';
    END IF;
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a consumption with this key exists' USING ERRCODE = '23505';
  END;
  FOR v_l IN SELECT * FROM public.material_request_lines y WHERE y.tenant_id = r.tenant_id AND y.request_id = r.id ORDER BY y.id LOOP
    v_found := false;
    IF p ? 'lines' THEN
      SELECT * INTO v_x FROM public.material_lines_checked(a.tenant_id, r.id, p -> 'lines', true) z WHERE z.request_line_id = v_l.id;
      v_found := FOUND;
    END IF;
    v_batch := CASE WHEN v_found THEN v_x.batch_id END;
    v_qty := CASE WHEN v_found THEN v_x.quantity
                  ELSE (SELECT coalesce(sum(g.free), 0) FROM public.material_batch_ledger(a.tenant_id, r.id) g WHERE g.request_line_id = v_l.id) END;
    IF v_l.material_class = 'bulk' THEN
      IF v_batch IS NOT NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: a bulk line names no batch' USING ERRCODE = '22023';
      END IF;
      -- Impl review ce8d7903 P1: a bulk line handed to the room count must still hold its whole issue (no return or
      -- waste on it, pending or decided), and the estimate cannot exceed what is open on the line.
      IF v_qty > 0 AND (EXISTS (SELECT 1 FROM public.material_return_lines r0 WHERE r0.tenant_id = a.tenant_id AND r0.request_line_id = v_l.id)
                        OR EXISTS (SELECT 1 FROM public.material_waste_lines w0 WHERE w0.tenant_id = a.tenant_id AND w0.request_line_id = v_l.id)) THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a returned or wasted bulk line cannot be consumed' USING ERRCODE = '55000';
      END IF;
      IF v_qty > (SELECT coalesce(sum(g.free), 0) FROM public.material_batch_ledger(a.tenant_id, r.id) g WHERE g.request_line_id = v_l.id) THEN
        RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: more than was issued and is still open on the line' USING ERRCODE = 'P0422';
      END IF;
      INSERT INTO public.material_consumption_lines (tenant_id, branch_id, request_id, consumption_id, request_line_id, item_id, batch_id, quantity, class_used, estimated)
      VALUES (a.tenant_id, r.branch_id, r.id, v_id, v_l.id, v_l.item_id, NULL, v_qty, 'bulk', true);
    ELSIF v_qty = 0 THEN
      INSERT INTO public.material_consumption_lines (tenant_id, branch_id, request_id, consumption_id, request_line_id, item_id, batch_id, quantity, class_used, estimated)
      VALUES (a.tenant_id, r.branch_id, r.id, v_id, v_l.id, v_l.item_id, NULL, 0, v_l.material_class, false);
    ELSE
      IF v_l.material_class = 'precise' AND v_batch IS NULL AND (SELECT count(*) FROM public.material_batch_ledger(a.tenant_id, r.id) g WHERE g.request_line_id = v_l.id AND g.free > 0) > 1 THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: a precise line names its batch' USING ERRCODE = '22023';
      END IF;
      FOR v_al IN SELECT * FROM public.material_allocate(a.tenant_id, r.id, v_l.id, v_batch, v_qty) LOOP
        INSERT INTO public.material_consumption_lines (tenant_id, branch_id, request_id, consumption_id, request_line_id, item_id, batch_id, quantity, class_used, estimated)
        VALUES (a.tenant_id, r.branch_id, r.id, v_id, v_l.id, v_l.item_id, v_al.batch_id, v_al.take, v_l.material_class, false);
      END LOOP;
    END IF;
  END LOOP;
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = a.tenant_id
     AND b.id IN (SELECT c.batch_id FROM public.material_consumption_lines c WHERE c.tenant_id = a.tenant_id AND c.consumption_id = v_id) ORDER BY b.id FOR UPDATE;
  PERFORM 1 FROM public.batch_holdings h WHERE h.tenant_id = a.tenant_id AND h.depot_id = r.room_depot_id
     AND h.batch_id IN (SELECT c.batch_id FROM public.material_consumption_lines c WHERE c.tenant_id = a.tenant_id AND c.consumption_id = v_id) ORDER BY h.id FOR UPDATE;
  FOR v_al IN SELECT c.batch_id, sum(c.quantity) q FROM public.material_consumption_lines c
             WHERE c.tenant_id = a.tenant_id AND c.consumption_id = v_id AND c.batch_id IS NOT NULL GROUP BY c.batch_id ORDER BY c.batch_id LOOP
    PERFORM public.material_vial_take(a.tenant_id, v_al.batch_id, r.room_depot_id, v_al.q);
    PERFORM public.stock_move_depot(a.tenant_id, v_al.batch_id, r.room_depot_id, 'consume', -v_al.q, NULL, 'material_consumption', v_id, a.staff_id, a.role, NULL);
  END LOOP;
  PERFORM public.material_request_settle(a.tenant_id, r.id);
  PERFORM public.audit_append('settings_change', 'material_request', r.id, 'success', 'material_consumed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (r.branch_id, 'StockConsumed', 'material_request', r.id, jsonb_build_object('request_id', r.id, 'consumption_id', v_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_consume(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_consume(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- A bulk line consumed above zero belongs to room counts: no return or waste on it (P1-2; a line used 0 stays open).
CREATE FUNCTION public.material_assert_open_line(p_tenant uuid, p_line uuid, p_class text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_class = 'bulk' AND EXISTS (SELECT 1 FROM public.material_consumption_lines c WHERE c.tenant_id = p_tenant AND c.request_line_id = p_line AND c.quantity > 0) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a consumed bulk line is counted in the room' USING ERRCODE = '55000';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_assert_open_line(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Return proposal (open point 5): by the room staff; the stock stays in the room depot, reserved until decided.
-- p: {condition, lines: [{item_id, quantity, batch_id?}]}.
CREATE FUNCTION public.material_return_propose(p_key text, p_request uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_actor(ARRAY['doctor','nurse','therapist']);
  r public.material_requests := public.material_request_locked(a.tenant_id, a.branch_id, p_request);
  v_id uuid;
  v_x record;
  v_al record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p ->> 'condition', '') NOT IN ('unopened','opened','damaged') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: return' USING ERRCODE = '22023';
  END IF;
  IF r.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: request %', r.state USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.material_lines_checked(a.tenant_id, r.id, p -> 'lines', false);
  BEGIN
    INSERT INTO public.material_returns (tenant_id, branch_id, request_id, condition, command_key, proposed_by, proposed_as)
    VALUES (a.tenant_id, r.branch_id, r.id, p ->> 'condition', p_key, a.staff_id, a.role) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a return with this key exists' USING ERRCODE = '23505';
  END;
  FOR v_x IN SELECT * FROM public.material_lines_checked(a.tenant_id, r.id, p -> 'lines', false) LOOP
    PERFORM public.material_assert_open_line(a.tenant_id, v_x.request_line_id, v_x.material_class);
    FOR v_al IN SELECT * FROM public.material_allocate(a.tenant_id, r.id, v_x.request_line_id, v_x.batch_id, v_x.quantity) LOOP
      INSERT INTO public.material_return_lines (tenant_id, branch_id, request_id, return_id, request_line_id, item_id, batch_id, quantity)
      VALUES (a.tenant_id, r.branch_id, r.id, v_id, v_x.request_line_id, v_x.item_id, v_al.batch_id, v_al.take);
    END LOOP;
  END LOOP;
  PERFORM public.audit_append('settings_change', 'material_return', v_id, 'success', 'material_return_proposed');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_return_propose(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_return_propose(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Return decision (open point 5, P1-1): by the pharmacist. usable → `return` legs room → a depot of the branch
-- (sealed fit stock only: not damaged, batch fit, holding − open vial remainder in the room ≥ quantity); waste →
-- `waste` from the room depot, running an open vial down (lapsed when unfit). p_to: the depot for usable.
CREATE FUNCTION public.material_return_decide(p_return uuid, p_outcome text, p_to uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_actor(ARRAY['pharmacist']);
  m public.material_returns;
  r public.material_requests;
  t public.depots;
  v_l record;
  b public.stock_batches;
BEGIN
  SELECT * INTO m FROM public.material_returns x WHERE x.tenant_id = a.tenant_id AND x.id = p_return;
  IF NOT FOUND OR m.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: return not found' USING ERRCODE = 'P0002';
  END IF;
  r := public.material_request_locked(a.tenant_id, a.branch_id, m.request_id);
  SELECT * INTO m FROM public.material_returns x WHERE x.tenant_id = a.tenant_id AND x.id = p_return FOR UPDATE;
  IF m.state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: return %', m.state USING ERRCODE = '55000';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('usable','waste') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outcome' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'usable' THEN
    IF m.condition = 'damaged' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: damaged material is not usable' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO t FROM public.depots d WHERE d.tenant_id = a.tenant_id AND d.branch_id = r.branch_id AND d.id = p_to;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
    END IF;
    IF t.id = r.room_depot_id OR NOT t.active THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: destination depot' USING ERRCODE = '22023';
    END IF;
  ELSIF p_to IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a wasted return names no depot' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.stock_batches x WHERE x.tenant_id = a.tenant_id
     AND x.id IN (SELECT rl.batch_id FROM public.material_return_lines rl WHERE rl.tenant_id = a.tenant_id AND rl.return_id = m.id) ORDER BY x.id FOR UPDATE;
  PERFORM 1 FROM public.batch_holdings h WHERE h.tenant_id = a.tenant_id AND h.depot_id IN (r.room_depot_id, coalesce(t.id, r.room_depot_id))
     AND h.batch_id IN (SELECT rl.batch_id FROM public.material_return_lines rl WHERE rl.tenant_id = a.tenant_id AND rl.return_id = m.id) ORDER BY h.id FOR UPDATE;
  FOR v_l IN SELECT rl.batch_id, sum(rl.quantity) q FROM public.material_return_lines rl
            WHERE rl.tenant_id = a.tenant_id AND rl.return_id = m.id GROUP BY rl.batch_id ORDER BY rl.batch_id LOOP
    IF p_outcome = 'usable' THEN
      SELECT * INTO b FROM public.stock_batches x WHERE x.tenant_id = a.tenant_id AND x.id = v_l.batch_id;
      IF public.stock_unfit_reason(b) IS NOT NULL THEN
        RAISE EXCEPTION 'ERR_STOCK_UNFIT: %', public.stock_unfit_reason(b) USING ERRCODE = 'P0422';
      END IF;
      IF coalesce((SELECT h.quantity FROM public.batch_holdings h WHERE h.tenant_id = a.tenant_id AND h.depot_id = r.room_depot_id AND h.batch_id = v_l.batch_id), 0)
         - coalesce((SELECT v.remaining FROM public.opened_vials v WHERE v.tenant_id = a.tenant_id AND v.depot_id = r.room_depot_id AND v.batch_id = v_l.batch_id AND v.state = 'open'), 0) < v_l.q THEN
        RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: not enough sealed stock in the room depot' USING ERRCODE = 'P0422';
      END IF;
      PERFORM public.stock_move_depot(a.tenant_id, v_l.batch_id, r.room_depot_id, 'return', -v_l.q, NULL, 'material_return', m.id, a.staff_id, a.role, 'out');
      PERFORM public.stock_move_depot(a.tenant_id, v_l.batch_id, t.id, 'return', v_l.q, NULL, 'material_return', m.id, a.staff_id, a.role, 'in');
    ELSE
      PERFORM public.material_vial_take(a.tenant_id, v_l.batch_id, r.room_depot_id, v_l.q);
      PERFORM public.stock_move_depot(a.tenant_id, v_l.batch_id, r.room_depot_id, 'waste', -v_l.q, NULL, 'material_return', m.id, a.staff_id, a.role, NULL);
    END IF;
  END LOOP;
  UPDATE public.material_returns SET state = p_outcome, to_depot_id = CASE WHEN p_outcome = 'usable' THEN t.id END,
         decided_by = a.staff_id, decided_as = a.role, decided_at = clock_timestamp()
   WHERE tenant_id = m.tenant_id AND id = m.id;
  PERFORM public.material_request_settle(a.tenant_id, r.id);
  PERFORM public.audit_append('settings_change', 'material_return', m.id, 'success', 'material_return_' || p_outcome);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (r.branch_id, CASE WHEN p_outcome = 'usable' THEN 'StockReturned' ELSE 'StockWasted' END, 'material_request', r.id,
          jsonb_build_object('request_id', r.id, 'return_id', m.id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_return_decide(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_return_decide(uuid, text, uuid) TO clinic_app;--> statement-breakpoint

-- Waste (open point 6): by the room staff, from the issued quantity still open on the line, reason required; `waste`
-- from the room depot, running an open vial down. p: {reason, lines: [{item_id, quantity, batch_id?}]}.
CREATE FUNCTION public.material_waste(p_key text, p_request uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_actor(ARRAY['doctor','nurse','therapist']);
  r public.material_requests := public.material_request_locked(a.tenant_id, a.branch_id, p_request);
  v_id uuid;
  v_x record;
  v_al record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR length(btrim(coalesce(p ->> 'reason', ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: waste' USING ERRCODE = '22023';
  END IF;
  IF r.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: request %', r.state USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.material_lines_checked(a.tenant_id, r.id, p -> 'lines', false);
  BEGIN
    INSERT INTO public.material_wastes (tenant_id, branch_id, request_id, reason, command_key, wasted_by, wasted_as)
    VALUES (a.tenant_id, r.branch_id, r.id, btrim(p ->> 'reason'), p_key, a.staff_id, a.role) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a waste with this key exists' USING ERRCODE = '23505';
  END;
  FOR v_x IN SELECT * FROM public.material_lines_checked(a.tenant_id, r.id, p -> 'lines', false) LOOP
    PERFORM public.material_assert_open_line(a.tenant_id, v_x.request_line_id, v_x.material_class);
    FOR v_al IN SELECT * FROM public.material_allocate(a.tenant_id, r.id, v_x.request_line_id, v_x.batch_id, v_x.quantity) LOOP
      INSERT INTO public.material_waste_lines (tenant_id, branch_id, request_id, waste_id, request_line_id, item_id, batch_id, quantity)
      VALUES (a.tenant_id, r.branch_id, r.id, v_id, v_x.request_line_id, v_x.item_id, v_al.batch_id, v_al.take);
    END LOOP;
  END LOOP;
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = a.tenant_id
     AND b.id IN (SELECT w.batch_id FROM public.material_waste_lines w WHERE w.tenant_id = a.tenant_id AND w.waste_id = v_id) ORDER BY b.id FOR UPDATE;
  PERFORM 1 FROM public.batch_holdings h WHERE h.tenant_id = a.tenant_id AND h.depot_id = r.room_depot_id
     AND h.batch_id IN (SELECT w.batch_id FROM public.material_waste_lines w WHERE w.tenant_id = a.tenant_id AND w.waste_id = v_id) ORDER BY h.id FOR UPDATE;
  FOR v_al IN SELECT w.batch_id, sum(w.quantity) q FROM public.material_waste_lines w
             WHERE w.tenant_id = a.tenant_id AND w.waste_id = v_id GROUP BY w.batch_id ORDER BY w.batch_id LOOP
    PERFORM public.material_vial_take(a.tenant_id, v_al.batch_id, r.room_depot_id, v_al.q);
    PERFORM public.stock_move_depot(a.tenant_id, v_al.batch_id, r.room_depot_id, 'waste', -v_al.q, btrim(p ->> 'reason'), 'material_waste', v_id, a.staff_id, a.role, NULL);
  END LOOP;
  PERFORM public.material_request_settle(a.tenant_id, r.id);
  PERFORM public.audit_append('settings_change', 'material_waste', v_id, 'success', 'material_wasted');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (r.branch_id, 'StockWasted', 'material_request', r.id, jsonb_build_object('request_id', r.id, 'waste_id', v_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_waste(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_waste(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── Readers (open point 8): room and pharmacy roles and the manager at their active branch ──────────────────────
-- One request as JSON: lines with item name and unit, class, requested, and per batch issued / consumed / returned /
-- wasted / pending / free; returns and their state. Ids, names of stock items and staff; no clinical content.
CREATE FUNCTION public.material_request_json(r public.material_requests) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', r.id, 'branch_id', r.branch_id, 'visit_id', r.visit_id, 'plan_item_id', r.plan_item_id,
    'room_depot_id', r.room_depot_id, 'room_depot', (SELECT d.name FROM public.depots d WHERE d.tenant_id = r.tenant_id AND d.id = r.room_depot_id),
    'state', r.state, 'requested_at', r.requested_at, 'requested_as', r.requested_as,
    'requested_by_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = r.tenant_id AND s.id = r.requested_by),
    'closed_at', r.closed_at,
    'issued_at', (SELECT i.issued_at FROM public.material_issues i WHERE i.tenant_id = r.tenant_id AND i.request_id = r.id),
    'consumed_at', (SELECT c.consumed_at FROM public.material_consumptions c WHERE c.tenant_id = r.tenant_id AND c.request_id = r.id),
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'name', lb.name, 'unit', si.unit, 'class', l.material_class,
               'requested', l.requested_qty,
               'consumed_estimate', (SELECT sum(c.quantity) FROM public.material_consumption_lines c WHERE c.tenant_id = l.tenant_id AND c.request_line_id = l.id AND c.estimated),
               'batches', coalesce((SELECT jsonb_agg(jsonb_build_object('batch_id', g.batch_id, 'batch_no', b.batch_no, 'expiry', g.expiry, 'issued', g.issued,
                                       'consumed', g.consumed, 'returned', g.returned, 'wasted', g.wasted, 'pending', g.pending, 'free', g.free)
                                       ORDER BY g.expiry, g.received_at, g.batch_id)
                                      FROM public.material_batch_ledger(r.tenant_id, r.id) g JOIN public.stock_batches b ON b.tenant_id = r.tenant_id AND b.id = g.batch_id
                                     WHERE g.request_line_id = l.id), '[]'::jsonb))
             ORDER BY lb.name, l.id)
        FROM public.material_request_lines l JOIN public.stock_items si ON si.tenant_id = l.tenant_id AND si.id = l.item_id
        CROSS JOIN LATERAL public.stock_item_label(si.tenant_id, si.catalog_item_id) lb
       WHERE l.tenant_id = r.tenant_id AND l.request_id = r.id), '[]'::jsonb),
    'returns', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'condition', m.condition, 'state', m.state, 'to_depot_id', m.to_depot_id,
                                  'proposed_at', m.proposed_at, 'decided_at', m.decided_at) ORDER BY m.proposed_at, m.id)
                           FROM public.material_returns m WHERE m.tenant_id = r.tenant_id AND m.request_id = r.id), '[]'::jsonb))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_request_json(public.material_requests) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.material_request_get(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_reader();
  r public.material_requests;
BEGIN
  SELECT * INTO r FROM public.material_requests x WHERE x.tenant_id = a.tenant_id AND x.id = p_request;
  IF NOT FOUND OR r.branch_id <> a.branch_id OR NOT public.material_readable(r.tenant_id, r.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: request not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.material_request_json(r);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_request_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_request_get(uuid) TO clinic_app;--> statement-breakpoint

-- The requests of a visit at the active branch.
CREATE FUNCTION public.material_requests_for_visit(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_reader();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.branch_id = a.branch_id AND v.id = p_visit)
     OR NOT public.material_readable(a.tenant_id, a.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(public.material_request_json(r) ORDER BY r.requested_at, r.id)
                     FROM public.material_requests r WHERE r.tenant_id = a.tenant_id AND r.branch_id = a.branch_id AND r.visit_id = p_visit), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_requests_for_visit(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_requests_for_visit(uuid) TO clinic_app;--> statement-breakpoint

-- The pharmacist's queue at the active branch: open requests to issue and pending returns to decide.
CREATE FUNCTION public.material_issue_queue() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.material_reader();
BEGIN
  IF a.role NOT IN ('pharmacist','manager') OR NOT public.material_readable(a.tenant_id, a.branch_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the issue queue' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'to_issue', coalesce((SELECT jsonb_agg(public.material_request_json(r) ORDER BY r.requested_at, r.id)
                            FROM public.material_requests r WHERE r.tenant_id = a.tenant_id AND r.branch_id = a.branch_id AND r.state = 'open'), '[]'::jsonb),
    'returns', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'request_id', m.request_id, 'condition', m.condition, 'proposed_at', m.proposed_at,
                                   'lines', (SELECT jsonb_agg(jsonb_build_object('item_id', rl.item_id, 'batch_id', rl.batch_id, 'quantity', rl.quantity) ORDER BY rl.batch_id)
                                               FROM public.material_return_lines rl WHERE rl.tenant_id = m.tenant_id AND rl.return_id = m.id))
                                   ORDER BY m.proposed_at, m.id)
                           FROM public.material_returns m WHERE m.tenant_id = a.tenant_id AND m.branch_id = a.branch_id AND m.state = 'pending'), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.material_issue_queue() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.material_issue_queue() TO clinic_app;
