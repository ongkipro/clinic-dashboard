CREATE TABLE "opened_vials" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_as" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"use_by" timestamp with time zone NOT NULL,
	"remaining" numeric NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "opened_vials_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "opened_vials_check" CHECK ("opened_vials"."remaining" between 0 and 100000 and scale("opened_vials"."remaining") <= 4 and "opened_vials"."use_by" > "opened_vials"."opened_at"
      and "opened_vials"."state" in ('open','finished','lapsed') and (("opened_vials"."state" = 'open') = ("opened_vials"."closed_at" is null))
      and "opened_vials"."opened_as" in ('pharmacist'))
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expiry" date NOT NULL,
	"quantity" numeric NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"hold_reason" text,
	"held_by" uuid,
	"held_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "stock_batches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_batches_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "stock_batches_tenant_branch_item_id_key" UNIQUE("tenant_id","branch_id","item_id","id"),
	CONSTRAINT "stock_batches_identity_key" UNIQUE("tenant_id","branch_id","item_id","batch_no","expiry"),
	CONSTRAINT "stock_batches_no_check" CHECK ("stock_batches"."batch_no" ~ '^[A-Za-z0-9][A-Za-z0-9./-]{0,39}$'),
	CONSTRAINT "stock_batches_quantity_check" CHECK ("stock_batches"."quantity" between 0 and 1000000000 and scale("stock_batches"."quantity") <= 4),
	CONSTRAINT "stock_batches_state_check" CHECK ("stock_batches"."state" in ('active','quarantined','recalled')
      and (("stock_batches"."state" = 'active') = ("stock_batches"."hold_reason" is null)) and num_nonnulls("stock_batches"."hold_reason", "stock_batches"."held_by", "stock_batches"."held_at") in (0, 3)
      and ("stock_batches"."hold_reason" is null or length(btrim("stock_batches"."hold_reason")) between 3 and 300))
);
--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"system_qty" numeric NOT NULL,
	"counted_qty" numeric,
	"counted_at" timestamp with time zone,
	CONSTRAINT "stock_count_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_count_lines_batch_key" UNIQUE("tenant_id","count_id","batch_id"),
	CONSTRAINT "stock_count_lines_check" CHECK ("stock_count_lines"."system_qty" between 0 and 1000000000 and scale("stock_count_lines"."system_qty") <= 4 and ("stock_count_lines"."counted_qty" is null or "stock_count_lines"."counted_qty" between 0 and 1000000000 and scale("stock_count_lines"."counted_qty") <= 4)
      and (("stock_count_lines"."counted_qty" is null) = ("stock_count_lines"."counted_at" is null)))
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"blind" boolean NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"reason" text,
	"threshold_pct" numeric,
	"exceeds" boolean,
	"approval_id" uuid,
	"started_by" uuid NOT NULL,
	"started_as" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"submitted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "stock_counts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_counts_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "stock_counts_approval_key" UNIQUE("tenant_id","approval_id"),
	CONSTRAINT "stock_counts_check" CHECK ("stock_counts"."state" in ('draft','pending_approval','applied','rejected','cancelled') and "stock_counts"."started_as" in ('pharmacist','manager')
      and ("stock_counts"."state" <> 'draft' or "stock_counts"."submitted_at" is null) and ("stock_counts"."state" not in ('pending_approval','applied','rejected') or "stock_counts"."submitted_at" is not null)
      and (("stock_counts"."state" in ('draft','pending_approval')) = ("stock_counts"."closed_at" is null))
      and (("stock_counts"."submitted_at" is null) = ("stock_counts"."reason" is null)) and ("stock_counts"."reason" is null or length(btrim("stock_counts"."reason")) between 3 and 500)
      and num_nonnulls("stock_counts"."threshold_pct", "stock_counts"."exceeds", "stock_counts"."submitted_at") in (0, 3)
      and ("stock_counts"."threshold_pct" is null or "stock_counts"."threshold_pct" between 0 and 100 and scale("stock_counts"."threshold_pct") <= 4)
      and (("stock_counts"."approval_id" is not null) = coalesce("stock_counts"."exceeds", false))
      and ("stock_counts"."state" <> 'pending_approval' or "stock_counts"."approval_id" is not null)
      and ("stock_counts"."state" <> 'rejected' or "stock_counts"."approval_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"vial_size" numeric,
	"opened_use_hours" integer,
	"storage" text DEFAULT 'ruang' NOT NULL,
	"registration_no" text,
	"high_value" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "stock_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_items_tenant_catalog_key" UNIQUE("tenant_id","catalog_item_id"),
	CONSTRAINT "stock_items_unit_check" CHECK ("stock_items"."unit" ~ '^[a-zA-Z][a-zA-Z0-9.]{0,11}$'),
	CONSTRAINT "stock_items_vial_check" CHECK ((("stock_items"."vial_size" is null) = ("stock_items"."opened_use_hours" is null))
      and ("stock_items"."vial_size" is null or "stock_items"."vial_size" between 0.0001 and 100000 and scale("stock_items"."vial_size") <= 4 and "stock_items"."vial_size" > 0)
      and ("stock_items"."opened_use_hours" is null or "stock_items"."opened_use_hours" between 1 and 8760)),
	CONSTRAINT "stock_items_storage_check" CHECK ("stock_items"."storage" in ('ruang','sejuk','dingin')),
	CONSTRAINT "stock_items_registration_check" CHECK ("stock_items"."registration_no" is null or "stock_items"."registration_no" ~ '^[A-Za-z0-9./ -]{3,40}$')
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"min_qty" numeric NOT NULL,
	"target_qty" numeric NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_as" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "stock_levels_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_levels_branch_item_key" UNIQUE("tenant_id","branch_id","item_id"),
	CONSTRAINT "stock_levels_check" CHECK ("stock_levels"."min_qty" between 0 and 1000000000 and scale("stock_levels"."min_qty") <= 4 and "stock_levels"."target_qty" between 0 and 1000000000 and scale("stock_levels"."target_qty") <= 4 and "stock_levels"."target_qty" >= "stock_levels"."min_qty"
      and "stock_levels"."updated_as" in ('pharmacist','purchasing'))
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric NOT NULL,
	"balance_after" numeric NOT NULL,
	"reason" text,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "stock_movements_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_movements_source_key" UNIQUE("tenant_id","source_kind","source_id","batch_id"),
	CONSTRAINT "stock_movements_check" CHECK ("stock_movements"."kind" in ('receive','adjust','issue','consume','return','waste','transfer_out','transfer_in','supplier_return','dispense') and "stock_movements"."quantity" between -1000000000 and 1000000000 and scale("stock_movements"."quantity") <= 4 and "stock_movements"."quantity" <> 0
      and "stock_movements"."balance_after" between 0 and 1000000000 and scale("stock_movements"."balance_after") <= 4 and "stock_movements"."source_kind" ~ '^[a-z][a-z_]{1,40}$'
      and ("stock_movements"."reason" is null or length(btrim("stock_movements"."reason")) between 3 and 500)
      and ("stock_movements"."kind" <> 'receive' or "stock_movements"."quantity" > 0))
);
--> statement-breakpoint
ALTER TABLE "opened_vials" ADD CONSTRAINT "opened_vials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opened_vials" ADD CONSTRAINT "opened_vials_batch_fk" FOREIGN KEY ("tenant_id","branch_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opened_vials" ADD CONSTRAINT "opened_vials_by_fk" FOREIGN KEY ("tenant_id","opened_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_held_by_fk" FOREIGN KEY ("tenant_id","held_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_fk" FOREIGN KEY ("tenant_id","branch_id","count_id") REFERENCES "public"."stock_counts"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_batch_fk" FOREIGN KEY ("tenant_id","branch_id","item_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_by_fk" FOREIGN KEY ("tenant_id","started_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_catalog_fk" FOREIGN KEY ("tenant_id","catalog_item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_fk" FOREIGN KEY ("tenant_id","branch_id","item_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opened_vials_one_open" ON "opened_vials" USING btree ("tenant_id","batch_id") WHERE state = 'open';--> statement-breakpoint
CREATE INDEX "stock_batches_fefo_idx" ON "stock_batches" USING btree ("tenant_id","branch_id","item_id","expiry","received_at");--> statement-breakpoint
CREATE INDEX "stock_counts_branch_idx" ON "stock_counts" USING btree ("tenant_id","branch_id","state","started_at");--> statement-breakpoint
CREATE INDEX "stock_movements_card_idx" ON "stock_movements" USING btree ("tenant_id","branch_id","item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_batch_idx" ON "stock_movements" USING btree ("tenant_id","batch_id","seq");;--> statement-breakpoint

-- T-060 rules (generated by gen.py; plan docs/tasks/T-060.md)
-- Stok (PR-17, UX-11, DATA-25, CLIN-019; plan Argon r1 3b052a7b adopted, r2 5bff07a3 APPROVE; DEC-070).

-- ── Read helpers (invoker, wall clock, never null) ─────────────────────────────────────────────────
-- An active membership holding the acting role now; for a branch role also its assignment to the branch now.
-- Tenant-wide readers: owner, admin pusat, finance, purchasing, auditor. Branch readers: manager, pharmacist.
CREATE FUNCTION public.stock_member_now(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id() AND EXISTS (
    SELECT 1 FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
      JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = public.app_acting_role()
     WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
       AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_member_now(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_member_now(uuid) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.stock_item_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.app_role_in(ARRAY['owner','admin_pusat','finance','purchasing','auditor','manager','pharmacist'])
                  AND public.stock_member_now(p_tenant), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_item_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_item_readable(uuid) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.stock_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
    public.app_role_in(ARRAY['owner','admin_pusat','finance','purchasing','auditor'])
    OR public.app_role_in(ARRAY['manager','pharmacist']) AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- ── Actor (writers): the staff_access lock first (DEC-043), then the role and the tenant capability ──
-- p_capability 'configuration' (item, level writers) or 'operations' (configuration or existing_appointment:
-- batch, vial, count writers). The branch: a branch role's active branch; a tenant-wide role names one of the
-- tenant (p_branch), which must exist in this tenant (a Level 2 session allows every branch id).
CREATE FUNCTION public.stock_actor(p_roles text[], p_capability text, p_branch uuid,
                                   OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, v_branch FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not change stock' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.tenant_capability('configuration')
          OR p_capability = 'operations' AND public.tenant_capability('existing_appointment')) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: stock changes are not available now' USING ERRCODE = '42501';
  END IF;
  IF role IN ('manager','pharmacist') THEN
    IF p_branch IS NOT NULL AND p_branch <> v_branch THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: another branch' USING ERRCODE = '42501';
    END IF;
    branch_id := v_branch;
  ELSE
    branch_id := p_branch;
  END IF;
  IF branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = stock_actor.tenant_id AND b.id = stock_actor.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_actor(text[], text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Reader actor: the lock, then a reader role; for a branch role the active branch. Readers stay available in
-- every lifecycle state with configuration or existing appointments (stock is operational data).
CREATE FUNCTION public.stock_reader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','admin_pusat','finance','purchasing','auditor','manager','pharmacist') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read stock' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_reader() FROM PUBLIC;--> statement-breakpoint

-- Catalog name and code of a stock item (definer: purchasing, finance and auditor cannot read catalog_versions).
CREATE FUNCTION public.stock_item_label(p_tenant uuid, p_catalog_item uuid, OUT code text, OUT name text, OUT kind text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.code, coalesce(v.name, i.code), i.kind
    FROM public.catalog_items i
    LEFT JOIN public.catalog_versions v ON v.tenant_id = i.tenant_id AND v.item_id = i.id AND v.state = 'active'
   WHERE i.tenant_id = p_tenant AND i.id = p_catalog_item
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_item_label(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- ── Fitness and FEFO (CLIN-019; plan open point 5) ────────────────────────────────────────────────
-- The branch-local date of an instant.
CREATE FUNCTION public.stock_local_date(p_tenant uuid, p_branch uuid, p_at timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (coalesce(p_at, clock_timestamp()) AT TIME ZONE b.timezone)::date FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = p_branch
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_local_date(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Why a batch may not be used at p_at, or null: recalled, quarantined, expired (unfit from the start of the expiry
-- day in the branch's time zone). A vial past its use-by is `vial_lapsed` (stock_vial_unfit).
CREATE FUNCTION public.stock_unfit_reason(b public.stock_batches, p_at timestamptz DEFAULT clock_timestamp()) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN b.state = 'recalled' THEN 'recalled'
              WHEN b.state = 'quarantined' THEN 'quarantined'
              WHEN b.expiry <= public.stock_local_date(b.tenant_id, b.branch_id, p_at) THEN 'expired' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_unfit_reason(public.stock_batches, timestamptz) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.stock_vial_unfit(v public.opened_vials, p_at timestamptz DEFAULT clock_timestamp()) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN v.state <> 'open' OR v.use_by <= coalesce(p_at, clock_timestamp()) THEN 'vial_lapsed' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_vial_unfit(public.opened_vials, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- What may be taken from a batch now: its quantity when fit; the open vial counts only within its use-by (the
-- lapsed remainder is unfit, wasted by T-062).
CREATE FUNCTION public.stock_fit_qty(b public.stock_batches, p_at timestamptz DEFAULT clock_timestamp()) RETURNS numeric
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN public.stock_unfit_reason(b, p_at) IS NOT NULL THEN 0
              ELSE b.quantity - coalesce((SELECT v.remaining FROM public.opened_vials v
                                           WHERE v.tenant_id = b.tenant_id AND v.batch_id = b.id AND v.state = 'open'
                                             AND public.stock_vial_unfit(v, p_at) IS NOT NULL), 0) END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_fit_qty(public.stock_batches, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- FEFO (internal; issuing is T-062, dispensing T-065): the batches to take p_qty of an item at a branch, in two
-- tiers: fit open vials' remaining first (use_by, opened_at, id), then the sealed fit quantity (quantity − open
-- remaining) by expiry, received_at, id. Never an unfit batch or lapsed vial. ERR_STOCK_INSUFFICIENT when short.
CREATE FUNCTION public.stock_fefo(p_tenant uuid, p_branch uuid, p_item uuid, p_qty numeric, p_at timestamptz DEFAULT clock_timestamp())
RETURNS TABLE (batch_id uuid, vial_id uuid, take numeric)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_left numeric := p_qty;
  r record;
BEGIN
  IF p_qty IS NULL OR NOT (p_qty > 0 AND p_qty <= 1000000000 AND scale(p_qty) <= 4) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    SELECT * FROM (
      SELECT 1 AS tier, v.batch_id AS b, v.id AS vid, v.remaining AS avail, v.use_by AS k1, v.opened_at AS k2, v.id AS k3
        FROM public.opened_vials v JOIN public.stock_batches sb ON sb.tenant_id = v.tenant_id AND sb.id = v.batch_id
       WHERE v.tenant_id = p_tenant AND v.branch_id = p_branch AND sb.item_id = p_item AND v.state = 'open'
         AND public.stock_vial_unfit(v, p_at) IS NULL AND public.stock_unfit_reason(sb, p_at) IS NULL AND v.remaining > 0
      UNION ALL
      SELECT 2, sb.id, NULL, sb.quantity - coalesce(ov.remaining, 0), sb.expiry::timestamptz, sb.received_at, sb.id
        FROM public.stock_batches sb
        LEFT JOIN public.opened_vials ov ON ov.tenant_id = sb.tenant_id AND ov.batch_id = sb.id AND ov.state = 'open'
       WHERE sb.tenant_id = p_tenant AND sb.branch_id = p_branch AND sb.item_id = p_item AND public.stock_unfit_reason(sb, p_at) IS NULL
    ) x WHERE x.avail > 0 ORDER BY x.tier, x.k1, x.k2, x.k3
  LOOP
    EXIT WHEN v_left <= 0;
    batch_id := r.b; vial_id := r.vid; take := least(r.avail, v_left);
    v_left := v_left - take;
    RETURN NEXT;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: not enough fit stock' USING ERRCODE = 'P0422';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_fefo(uuid, uuid, uuid, numeric, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- What T-062/T-065 call before taking p_qty from one batch: ERR_STOCK_UNFIT (expired, recalled, quarantined, the
-- vial lapsed) or ERR_STOCK_INSUFFICIENT.
CREATE FUNCTION public.stock_assert_fit(p_tenant uuid, p_batch uuid, p_qty numeric, p_at timestamptz DEFAULT clock_timestamp()) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.stock_batches;
BEGIN
  SELECT * INTO b FROM public.stock_batches WHERE tenant_id = p_tenant AND id = p_batch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF public.stock_unfit_reason(b, p_at) IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_STOCK_UNFIT: %', public.stock_unfit_reason(b, p_at) USING ERRCODE = 'P0422';
  END IF;
  IF p_qty IS NULL OR NOT (p_qty > 0 AND p_qty <= 1000000000 AND scale(p_qty) <= 4) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity' USING ERRCODE = '22023';
  END IF;
  IF public.stock_fit_qty(b, p_at) < p_qty THEN
    IF b.quantity >= p_qty THEN
      RAISE EXCEPTION 'ERR_STOCK_UNFIT: vial_lapsed' USING ERRCODE = 'P0422';
    END IF;
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: not enough stock in the batch' USING ERRCODE = 'P0422';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_assert_fit(uuid, uuid, numeric, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- ── Movement (internal): the one way a batch quantity changes ─────────────────────────────────────────
-- Writes one movement; its insert trigger (stock_movements_apply) locks the batch, checks balance_after and sets the
-- batch quantity. A movement lowering a batch below its open vial's remaining clamps the vial (finished at 0).
CREATE FUNCTION public.stock_move(p_tenant uuid, p_batch uuid, p_kind text, p_qty numeric, p_reason text, p_source_kind text, p_source uuid,
                                  p_by uuid, p_as text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.stock_batches;
  v_new numeric;
  v_id uuid;
BEGIN
  SELECT * INTO b FROM public.stock_batches WHERE tenant_id = p_tenant AND id = p_batch FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  v_new := b.quantity + p_qty;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: the batch would go below zero' USING ERRCODE = 'P0422';
  END IF;
  INSERT INTO public.stock_movements (tenant_id, branch_id, item_id, batch_id, kind, quantity, balance_after, reason, source_kind, source_id, created_by, created_as)
  VALUES (b.tenant_id, b.branch_id, b.item_id, b.id, p_kind, p_qty, v_new, NULLIF(btrim(p_reason), ''), p_source_kind, p_source, p_by, p_as)
  RETURNING id INTO v_id;
  UPDATE public.opened_vials SET remaining = v_new,
         state = CASE WHEN v_new = 0 THEN 'finished' ELSE state END,
         closed_at = CASE WHEN v_new = 0 THEN clock_timestamp() END
   WHERE tenant_id = b.tenant_id AND batch_id = b.id AND state = 'open' AND remaining > v_new;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_move(uuid, uuid, text, numeric, text, text, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_items_read ON public.stock_items FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_item_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.stock_items TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_items_operator_read ON public.stock_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_items TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_items_no_truncate BEFORE TRUNCATE ON public.stock_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_items ENABLE ALWAYS TRIGGER stock_items_no_truncate;--> statement-breakpoint
ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_batches_read ON public.stock_batches FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.stock_batches TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_batches_operator_read ON public.stock_batches FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_batches', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_batches TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_batches_no_truncate BEFORE TRUNCATE ON public.stock_batches FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_batches ENABLE ALWAYS TRIGGER stock_batches_no_truncate;--> statement-breakpoint
ALTER TABLE public.opened_vials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY opened_vials_read ON public.opened_vials FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.opened_vials TO clinic_app;--> statement-breakpoint
CREATE POLICY opened_vials_operator_read ON public.opened_vials FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.opened_vials', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.opened_vials TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER opened_vials_no_truncate BEFORE TRUNCATE ON public.opened_vials FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.opened_vials ENABLE ALWAYS TRIGGER opened_vials_no_truncate;--> statement-breakpoint
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_movements_read ON public.stock_movements FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.stock_movements TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_movements_operator_read ON public.stock_movements FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_movements', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_movements TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON public.stock_movements FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_movements ENABLE ALWAYS TRIGGER stock_movements_no_truncate;--> statement-breakpoint
ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_levels_read ON public.stock_levels FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.stock_levels TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_levels_operator_read ON public.stock_levels FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_levels', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_levels TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_levels_no_truncate BEFORE TRUNCATE ON public.stock_levels FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_levels ENABLE ALWAYS TRIGGER stock_levels_no_truncate;--> statement-breakpoint
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_counts_read ON public.stock_counts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.stock_counts TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_counts_operator_read ON public.stock_counts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_counts', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_counts TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_counts_no_truncate BEFORE TRUNCATE ON public.stock_counts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_counts ENABLE ALWAYS TRIGGER stock_counts_no_truncate;--> statement-breakpoint
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_count_lines_read ON public.stock_count_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, count_id, item_id, batch_id, counted_qty, counted_at) ON public.stock_count_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_count_lines_operator_read ON public.stock_count_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_count_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, count_id, item_id, batch_id, counted_qty, counted_at) ON public.stock_count_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_count_lines_no_truncate BEFORE TRUNCATE ON public.stock_count_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_count_lines ENABLE ALWAYS TRIGGER stock_count_lines_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.stock_items', 'tenant-shared', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'stock_* definers (src/modules/inventory)', 'none'),
  ('public.stock_batches', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'stock_* definers (src/modules/inventory)', 'the batch''s branch'),
  ('public.opened_vials', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'stock_* definers (src/modules/inventory)', 'the batch''s branch'),
  ('public.stock_movements', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'stock_* definers (src/modules/inventory)', 'the batch''s branch'),
  ('public.stock_levels', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'stock_* definers (src/modules/inventory)', 'the level''s branch'),
  ('public.stock_counts', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'stock_* definers (src/modules/inventory)', 'the count''s branch'),
  ('public.stock_count_lines', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'stock_* definers (src/modules/inventory)', 'the count''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19; plan P2-1): items and levels are configuration; batches, vials,
-- movements and counts carry staff attribution and free-text reasons.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.stock_items', 'config'),
  ('public.stock_batches', 'personal'),
  ('public.opened_vials', 'personal'),
  ('public.stock_movements', 'personal'),
  ('public.stock_levels', 'config'),
  ('public.stock_counts', 'personal'),
  ('public.stock_count_lines', 'personal');--> statement-breakpoint

-- ── Guards: staff_access lock first, ENABLE ALWAYS ─────────────────────────────────────────────────
-- Batch ↔ movement, both ways (plan P1-2, r2 P3-1), by construction: a batch opens at quantity 0; its quantity
-- changes only through a movement (the movement's insert trigger sets it), and only to the newest movement's
-- balance_after; a movement's balance_after must be the batch quantity (locked) plus its quantity. So every
-- quantity change has its movement in the same statement and no movement exists without its change.
-- (Implemented as paired row triggers instead of the deferred constraint triggers sketched in the plan: the same
-- invariant, with no window inside a transaction.)

CREATE FUNCTION public.stock_movements_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.stock_batches;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'stock movements are never changed or deleted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.stock_batches WHERE tenant_id = NEW.tenant_id AND id = NEW.batch_id FOR UPDATE;
  IF NOT FOUND OR b.branch_id <> NEW.branch_id OR b.item_id <> NEW.item_id THEN
    RAISE EXCEPTION 'a movement names its batch' USING ERRCODE = '42501';
  END IF;
  IF NEW.balance_after <> b.quantity + NEW.quantity THEN
    RAISE EXCEPTION 'a movement continues the batch balance' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_movements_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_movements_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.stock_movements_guard();--> statement-breakpoint
ALTER TABLE public.stock_movements ENABLE ALWAYS TRIGGER stock_movements_guard;--> statement-breakpoint

CREATE FUNCTION public.stock_movements_apply() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.stock_batches SET quantity = NEW.balance_after WHERE tenant_id = NEW.tenant_id AND id = NEW.batch_id;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_movements_apply() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_movements_apply AFTER INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.stock_movements_apply();--> statement-breakpoint
ALTER TABLE public.stock_movements ENABLE ALWAYS TRIGGER stock_movements_apply;--> statement-breakpoint

-- Batches: never deleted; open at quantity 0, active; identity (tenant, branch, item, number, expiry, received)
-- frozen; quantity only to the newest movement's balance_after; holds: active → quarantined → active or recalled,
-- recalled final; a hold sets reason, by and at, release clears them.
CREATE FUNCTION public.stock_batches_guard() RETURNS trigger
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
       OR NOT (OLD.state = 'active' AND NEW.state IN ('quarantined','recalled') OR OLD.state = 'quarantined' AND NEW.state IN ('active','recalled')) THEN
      RAISE EXCEPTION 'a batch hold moves active → quarantined → active or recalled; recalled is final' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_batches_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_batches FOR EACH ROW EXECUTE FUNCTION public.stock_batches_guard();--> statement-breakpoint
ALTER TABLE public.stock_batches ENABLE ALWAYS TRIGGER stock_batches_guard;--> statement-breakpoint

-- Items: never deleted; catalog item frozen; unit and vial size frozen once a batch, level or count line uses the
-- item; vial fields not cleared once a vial was opened (DATA-4, plan P1-2).
CREATE FUNCTION public.stock_items_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock items are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.catalog_item_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.catalog_item_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a stock item keeps its catalog item' USING ERRCODE = '42501';
  END IF;
  IF (NEW.unit IS DISTINCT FROM OLD.unit OR NEW.vial_size IS DISTINCT FROM OLD.vial_size)
     AND (EXISTS (SELECT 1 FROM public.stock_batches b WHERE b.tenant_id = OLD.tenant_id AND b.item_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.stock_levels l WHERE l.tenant_id = OLD.tenant_id AND l.item_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.stock_count_lines c WHERE c.tenant_id = OLD.tenant_id AND c.item_id = OLD.id)) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the unit is in use' USING ERRCODE = '55000';
  END IF;
  IF NEW.vial_size IS NULL AND OLD.vial_size IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.opened_vials v JOIN public.stock_batches b ON b.tenant_id = v.tenant_id AND b.id = v.batch_id
                  WHERE b.tenant_id = OLD.tenant_id AND b.item_id = OLD.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: vials of this item were opened' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_items_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_items FOR EACH ROW EXECUTE FUNCTION public.stock_items_guard();--> statement-breakpoint
ALTER TABLE public.stock_items ENABLE ALWAYS TRIGGER stock_items_guard;--> statement-breakpoint

-- Opened vials: never deleted; open with remaining ≤ the batch quantity; then only remaining down and the close
-- (open → finished | lapsed), once.
CREATE FUNCTION public.opened_vials_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'opened vials are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open' OR NEW.remaining <= 0
       OR NEW.remaining > (SELECT b.quantity FROM public.stock_batches b WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.batch_id) THEN
      RAISE EXCEPTION 'a vial opens with stock in its batch' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.batch_id, NEW.opened_by, NEW.opened_as, NEW.opened_at, NEW.use_by)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.batch_id, OLD.opened_by, OLD.opened_as, OLD.opened_at, OLD.use_by)
     OR OLD.state <> 'open' OR NEW.remaining > OLD.remaining THEN
    RAISE EXCEPTION 'an opened vial only runs down and closes once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.opened_vials_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER opened_vials_guard BEFORE INSERT OR UPDATE OR DELETE ON public.opened_vials FOR EACH ROW EXECUTE FUNCTION public.opened_vials_guard();--> statement-breakpoint
ALTER TABLE public.opened_vials ENABLE ALWAYS TRIGGER opened_vials_guard;--> statement-breakpoint

-- Counts: never deleted; open as a draft; draft → pending_approval | applied | cancelled; pending_approval →
-- applied | rejected | cancelled; closed counts frozen. Lines: added and counted only while the count is a draft;
-- the system snapshot frozen; never deleted.
CREATE FUNCTION public.stock_counts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock counts are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'a count opens as a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.blind, NEW.started_by, NEW.started_as, NEW.started_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.blind, OLD.started_by, OLD.started_as, OLD.started_at)
     OR NOT (OLD.state = 'draft' AND NEW.state IN ('pending_approval','applied','cancelled')
             OR OLD.state = 'pending_approval' AND NEW.state IN ('applied','rejected','cancelled'))
     OR OLD.state = 'pending_approval' AND (NEW.reason, NEW.threshold_pct, NEW.exceeds, NEW.approval_id, NEW.submitted_at)
                                         IS DISTINCT FROM (OLD.reason, OLD.threshold_pct, OLD.exceeds, OLD.approval_id, OLD.submitted_at) THEN
    RAISE EXCEPTION 'a count moves forward once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_counts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_counts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_counts FOR EACH ROW EXECUTE FUNCTION public.stock_counts_guard();--> statement-breakpoint
ALTER TABLE public.stock_counts ENABLE ALWAYS TRIGGER stock_counts_guard;--> statement-breakpoint

CREATE FUNCTION public.stock_count_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'count lines are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_counts c WHERE c.tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id) AND c.id = coalesce(NEW.count_id, OLD.count_id) AND c.state = 'draft') THEN
    RAISE EXCEPTION 'a count line changes only while its count is a draft' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.count_id, NEW.item_id, NEW.batch_id, NEW.system_qty)
                          IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.count_id, OLD.item_id, OLD.batch_id, OLD.system_qty) THEN
    RAISE EXCEPTION 'a count line keeps its batch and snapshot' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_lines_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_count_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_count_lines FOR EACH ROW EXECUTE FUNCTION public.stock_count_lines_guard();--> statement-breakpoint
ALTER TABLE public.stock_count_lines ENABLE ALWAYS TRIGGER stock_count_lines_guard;--> statement-breakpoint

-- Levels: never deleted; branch and item frozen.
CREATE FUNCTION public.stock_levels_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock levels are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.item_id) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.item_id) THEN
    RAISE EXCEPTION 'a stock level keeps its branch and item' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_levels_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_levels_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_levels FOR EACH ROW EXECUTE FUNCTION public.stock_levels_guard();--> statement-breakpoint
ALTER TABLE public.stock_levels ENABLE ALWAYS TRIGGER stock_levels_guard;--> statement-breakpoint

-- ── Writers (definers; the actor lock first) ───────────────────────────────────────────────────────

-- Master Item (plan open point 1): pharmacist, purchasing, admin pusat. p: {catalog_item_id (create only), unit,
-- vial_size?, opened_use_hours?, storage, registration_no?, high_value, active}. The catalog item: kind material or
-- product with an active version. Returns the stock item id.
CREATE FUNCTION public.stock_item_save(p_item uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing','admin_pusat'], 'configuration', NULL);
  i public.stock_items;
  v_cat uuid;
  v_id uuid;
  v_vial numeric;
  v_hours integer;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: item' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_vial := NULLIF(p ->> 'vial_size', '')::numeric;
    v_hours := NULLIF(p ->> 'opened_use_hours', '')::integer;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: vial' USING ERRCODE = '22023';
  END;
  IF p_item IS NULL THEN
    v_cat := NULLIF(p ->> 'catalog_item_id', '')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.catalog_items ci WHERE ci.tenant_id = a.tenant_id AND ci.id = v_cat AND ci.kind IN ('material','product')
                     AND EXISTS (SELECT 1 FROM public.catalog_versions cv WHERE cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active')) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: catalog item not found' USING ERRCODE = 'P0002';
    END IF;
    BEGIN
      INSERT INTO public.stock_items (tenant_id, catalog_item_id, unit, vial_size, opened_use_hours, storage, registration_no, high_value, active, created_by, updated_by)
      VALUES (a.tenant_id, v_cat, btrim(p ->> 'unit'), v_vial, v_hours, coalesce(p ->> 'storage', 'ruang'), NULLIF(btrim(p ->> 'registration_no'), ''),
              coalesce((p ->> 'high_value')::boolean, false), coalesce((p ->> 'active')::boolean, true), a.staff_id, a.staff_id)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: the catalog item already has a stock item' USING ERRCODE = '23505';
              WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: item' USING ERRCODE = '22023';
    END;
    PERFORM public.audit_append('settings_change', 'stock_item', v_id, 'success', 'stock_item_created');
  ELSE
    SELECT * INTO i FROM public.stock_items x WHERE x.tenant_id = a.tenant_id AND x.id = p_item FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
    END IF;
    BEGIN
      UPDATE public.stock_items SET unit = btrim(p ->> 'unit'), vial_size = v_vial, opened_use_hours = v_hours, storage = coalesce(p ->> 'storage', 'ruang'),
             registration_no = NULLIF(btrim(p ->> 'registration_no'), ''), high_value = coalesce((p ->> 'high_value')::boolean, false),
             active = coalesce((p ->> 'active')::boolean, true), updated_by = a.staff_id, updated_at = clock_timestamp()
       WHERE tenant_id = i.tenant_id AND id = i.id;
    EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: item' USING ERRCODE = '22023';
    END;
    v_id := i.id;
    PERFORM public.audit_append('settings_change', 'stock_item', v_id, 'success', 'stock_item_updated');
  END IF;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_item_save(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_item_save(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Terima Stok (plan open point 2; T-067's goods receipt calls stock_receive_into): pharmacist at the branch,
-- purchasing naming one. p: {item_id, batch_no, expiry (date, after the branch-local today), quantity > 0, reason
-- stok_awal | penerimaan}. Adds to an existing batch of the same number and expiry, else opens one. p_command: the
-- command id (runCommand's key), the movement's source. Returns the batch id.
CREATE FUNCTION public.stock_receive_into(p_tenant uuid, p_staff uuid, p_role text, p_branch uuid, p jsonb, p_source_kind text, p_source uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.stock_items;
  v_expiry date;
  v_qty numeric;
  v_reason text := p ->> 'reason';
  v_batch uuid;
BEGIN
  BEGIN
    v_expiry := (p ->> 'expiry')::date;
    v_qty := (p ->> 'quantity')::numeric;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: expiry or quantity' USING ERRCODE = '22023';
  END;
  SELECT * INTO i FROM public.stock_items x WHERE x.tenant_id = p_tenant AND x.id = NULLIF(p ->> 'item_id', '')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT i.active THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the item is inactive' USING ERRCODE = '55000';
  END IF;
  IF v_expiry IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a batch without expiry cannot be received' USING ERRCODE = '22023';
  END IF;
  IF v_expiry <= public.stock_local_date(p_tenant, p_branch, clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_STOCK_UNFIT: expired' USING ERRCODE = 'P0422';
  END IF;
  IF v_qty IS NULL OR NOT (v_qty > 0 AND v_qty <= 1000000000 AND scale(v_qty) <= 4) OR v_reason NOT IN ('stok_awal','penerimaan') OR v_reason IS NULL
     OR coalesce(p ->> 'batch_no', '') !~ '^[A-Za-z0-9][A-Za-z0-9./-]{0,39}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: batch, quantity or reason' USING ERRCODE = '22023';
  END IF;
  SELECT b.id INTO v_batch FROM public.stock_batches b
   WHERE b.tenant_id = p_tenant AND b.branch_id = p_branch AND b.item_id = i.id AND b.batch_no = p ->> 'batch_no' AND b.expiry = v_expiry FOR UPDATE;
  IF FOUND AND (SELECT b.state FROM public.stock_batches b WHERE b.tenant_id = p_tenant AND b.id = v_batch) = 'recalled' THEN
    RAISE EXCEPTION 'ERR_STOCK_UNFIT: recalled' USING ERRCODE = 'P0422';
  END IF;
  IF v_batch IS NULL THEN
    INSERT INTO public.stock_batches (tenant_id, branch_id, item_id, batch_no, expiry, quantity)
    VALUES (p_tenant, p_branch, i.id, p ->> 'batch_no', v_expiry, 0) RETURNING id INTO v_batch;
  END IF;
  PERFORM public.stock_move(p_tenant, v_batch, 'receive', v_qty, v_reason, p_source_kind, p_source, p_staff, p_role);
  RETURN v_batch;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_receive_into(uuid, uuid, text, uuid, jsonb, text, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.stock_receive(p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'operations', p_branch);
  v_source uuid := public.uuid_generate_v7();
  v_batch uuid;
BEGIN
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  v_batch := public.stock_receive_into(a.tenant_id, a.staff_id, a.role, a.branch_id, p, 'stock_receipt', v_source);
  PERFORM public.audit_append('settings_change', 'stock_batch', v_batch, 'success', 'stock_received');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'StockReceived', 'stock_batch', v_batch, jsonb_build_object('batch_id', v_batch, 'reason', p ->> 'reason'));
  RETURN v_batch;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_receive(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_receive(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Tahan / Tarik / Lepas batch (CLIN-019): pharmacist at the batch's branch. p_state quarantined | recalled |
-- active (release from quarantine); a hold needs a reason; recalled is final.
CREATE FUNCTION public.stock_batch_hold(p_batch uuid, p_state text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist'], 'operations', NULL);
  b public.stock_batches;
BEGIN
  SELECT * INTO b FROM public.stock_batches x WHERE x.tenant_id = a.tenant_id AND x.id = p_batch FOR UPDATE;
  IF NOT FOUND OR b.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_state NOT IN ('quarantined','recalled','active') OR p_state IS NULL
     OR p_state <> 'active' AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: state or reason' USING ERRCODE = '22023';
  END IF;
  IF b.state = 'recalled' OR b.state = p_state OR b.state = 'active' AND p_state = 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: batch already %', b.state USING ERRCODE = '55000';
  END IF;
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
REVOKE ALL ON FUNCTION public.stock_batch_hold(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_batch_hold(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- Buka Vial (plan open point 4): pharmacist at the batch's branch; vial items only; the batch fit and not empty;
-- one open vial per batch (a lapsed open vial is closed as lapsed first). remaining = least(vial size, quantity);
-- use_by = now + the item's opened-use hours. No movement: the units stay in the batch.
CREATE FUNCTION public.stock_vial_open(p_batch uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist'], 'operations', NULL);
  b public.stock_batches;
  i public.stock_items;
  v public.opened_vials;
  v_id uuid;
BEGIN
  SELECT * INTO b FROM public.stock_batches x WHERE x.tenant_id = a.tenant_id AND x.id = p_batch FOR UPDATE;
  IF NOT FOUND OR b.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO i FROM public.stock_items x WHERE x.tenant_id = b.tenant_id AND x.id = b.item_id;
  IF i.vial_size IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: not a vial item' USING ERRCODE = '22023';
  END IF;
  IF public.stock_unfit_reason(b) IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_STOCK_UNFIT: %', public.stock_unfit_reason(b) USING ERRCODE = 'P0422';
  END IF;
  SELECT * INTO v FROM public.opened_vials x WHERE x.tenant_id = b.tenant_id AND x.batch_id = b.id AND x.state = 'open' FOR UPDATE;
  IF FOUND THEN
    IF public.stock_vial_unfit(v) IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a vial of this batch is already open' USING ERRCODE = '55000';
    END IF;
    UPDATE public.opened_vials SET state = 'lapsed', closed_at = clock_timestamp() WHERE tenant_id = v.tenant_id AND id = v.id;
  END IF;
  IF b.quantity <= 0 THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: the batch is empty' USING ERRCODE = 'P0422';
  END IF;
  INSERT INTO public.opened_vials (tenant_id, branch_id, batch_id, opened_by, opened_as, use_by, remaining)
  VALUES (b.tenant_id, b.branch_id, b.id, a.staff_id, a.role, clock_timestamp() + make_interval(hours => i.opened_use_hours), least(i.vial_size, b.quantity))
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'opened_vial', v_id, 'success', 'stock_vial_opened');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_vial_open(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_vial_open(uuid) TO clinic_app;--> statement-breakpoint

-- Atur Min/Target (SET-26; plan open point 6): pharmacist at its branch, purchasing naming one.
CREATE FUNCTION public.stock_level_set(p_branch uuid, p_item uuid, p_min numeric, p_target numeric) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'configuration', p_branch);
BEGIN
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_items i WHERE i.tenant_id = a.tenant_id AND i.id = p_item) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    INSERT INTO public.stock_levels (tenant_id, branch_id, item_id, min_qty, target_qty, updated_by, updated_as)
    VALUES (a.tenant_id, a.branch_id, p_item, p_min, p_target, a.staff_id, a.role)
    ON CONFLICT (tenant_id, branch_id, item_id) DO UPDATE
      SET min_qty = EXCLUDED.min_qty, target_qty = EXCLUDED.target_qty, updated_by = EXCLUDED.updated_by, updated_as = EXCLUDED.updated_as, updated_at = clock_timestamp();
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: min and target' USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'stock_item', p_item, 'success', 'stock_level_set');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_level_set(uuid, uuid, numeric, numeric) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_level_set(uuid, uuid, numeric, numeric) TO clinic_app;--> statement-breakpoint

-- ── Hitung Stok (plan open point 7; PR-44) ──────────────────────────────────────────────────────────
-- Start: pharmacist or manager at the branch; blind or not; the batches of the given items (all items when none)
-- that hold stock or are fit; a batch already in an open count is refused. Each line snapshots the batch quantity.
CREATE FUNCTION public.stock_count_start(p_blind boolean, p_items uuid[]) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','manager'], 'operations', NULL);
  v_id uuid;
  v_n integer;
BEGIN
  IF p_blind IS NULL OR cardinality(p_items) > 200 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: count' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.stock_counts (tenant_id, branch_id, blind, started_by, started_as) VALUES (a.tenant_id, a.branch_id, p_blind, a.staff_id, a.role)
  RETURNING id INTO v_id;
  PERFORM 1 FROM public.stock_batches b
   WHERE b.tenant_id = a.tenant_id AND b.branch_id = a.branch_id AND (p_items IS NULL OR cardinality(p_items) = 0 OR b.item_id = ANY (p_items))
     AND b.state <> 'recalled' AND b.quantity > 0
   ORDER BY b.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.stock_count_lines l JOIN public.stock_counts c ON c.tenant_id = l.tenant_id AND c.id = l.count_id
              JOIN public.stock_batches b ON b.tenant_id = l.tenant_id AND b.id = l.batch_id
             WHERE l.tenant_id = a.tenant_id AND c.branch_id = a.branch_id AND c.state IN ('draft','pending_approval') AND c.id <> v_id
               AND (p_items IS NULL OR cardinality(p_items) = 0 OR b.item_id = ANY (p_items))) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a batch is already in an open count' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.stock_count_lines (tenant_id, branch_id, count_id, item_id, batch_id, system_qty)
  SELECT b.tenant_id, b.branch_id, v_id, b.item_id, b.id, b.quantity FROM public.stock_batches b
   WHERE b.tenant_id = a.tenant_id AND b.branch_id = a.branch_id AND (p_items IS NULL OR cardinality(p_items) = 0 OR b.item_id = ANY (p_items))
     AND b.state <> 'recalled' AND b.quantity > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no stock to count' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('settings_change', 'stock_count', v_id, 'success', 'stock_count_started');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_start(boolean, uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_count_start(boolean, uuid[]) TO clinic_app;--> statement-breakpoint

-- The count of the caller's branch, locked; the starter or another counter of the branch (pharmacist, manager).
CREATE FUNCTION public.stock_count_locked(p_tenant uuid, p_branch uuid, p_count uuid) RETURNS public.stock_counts
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.stock_counts;
BEGIN
  SELECT * INTO c FROM public.stock_counts x WHERE x.tenant_id = p_tenant AND x.id = p_count FOR UPDATE;
  IF NOT FOUND OR c.branch_id <> p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: count not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN c;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_locked(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.stock_count_record(p_count uuid, p_line uuid, p_counted numeric) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','manager'], 'operations', NULL);
  c public.stock_counts := public.stock_count_locked(a.tenant_id, a.branch_id, p_count);
BEGIN
  IF c.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: count submitted' USING ERRCODE = '55000';
  END IF;
  IF p_counted IS NULL OR NOT (p_counted >= 0 AND p_counted <= 1000000000 AND scale(p_counted) <= 4) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: counted quantity' USING ERRCODE = '22023';
  END IF;
  UPDATE public.stock_count_lines SET counted_qty = p_counted, counted_at = clock_timestamp()
   WHERE tenant_id = c.tenant_id AND count_id = c.id AND id = p_line;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: line not found' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_record(uuid, uuid, numeric) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_count_record(uuid, uuid, numeric) TO clinic_app;--> statement-breakpoint

-- Batches of a count locked in id order; any batch that moved since the count started (quantity ≠ snapshot, or a
-- movement after started_at) refuses with ERR_VERSION_CONFLICT (plan P1-3).
CREATE FUNCTION public.stock_count_check_unmoved(c public.stock_counts) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = c.tenant_id
     AND b.id IN (SELECT l.batch_id FROM public.stock_count_lines l WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id)
   ORDER BY b.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.stock_count_lines l JOIN public.stock_batches b ON b.tenant_id = l.tenant_id AND b.id = l.batch_id
              WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id
                AND (b.quantity <> l.system_qty OR EXISTS (SELECT 1 FROM public.stock_movements m
                                                            WHERE m.tenant_id = l.tenant_id AND m.batch_id = l.batch_id AND m.created_at > c.started_at))) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: stock moved since the count started' USING ERRCODE = '55000';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_check_unmoved(public.stock_counts) FROM PUBLIC;--> statement-breakpoint

-- One adjust movement per line with a difference (internal; at submit within threshold, or at approval).
CREATE FUNCTION public.stock_count_apply(c public.stock_counts, p_by uuid, p_as text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l record;
BEGIN
  FOR l IN SELECT * FROM public.stock_count_lines x WHERE x.tenant_id = c.tenant_id AND x.count_id = c.id AND x.counted_qty <> x.system_qty ORDER BY x.batch_id LOOP
    PERFORM public.stock_move(c.tenant_id, l.batch_id, 'adjust', l.counted_qty - l.system_qty, c.reason, 'stock_count', c.id, p_by, p_as);
  END LOOP;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (c.tenant_id, c.branch_id, 'StockAdjusted', 'stock_count', c.id, jsonb_build_object('count_id', c.id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_apply(public.stock_counts, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Submit: every line counted; a reason; the SET-43 selisih_opname snapshotted. Within the threshold the
-- adjustments apply now (state applied); above it one stock_adjustment approval is requested (state
-- pending_approval). A line exceeds when system = 0 and counted > 0, or |counted − system| × 100 > system × pct.
CREATE FUNCTION public.stock_count_submit(p_count uuid, p_reason text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','manager'], 'operations', NULL);
  c public.stock_counts := public.stock_count_locked(a.tenant_id, a.branch_id, p_count);
  v_pct numeric;
  v_exceeds boolean;
  v_approval uuid;
BEGIN
  IF c.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: count submitted' USING ERRCODE = '55000';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_count_lines l WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id AND l.counted_qty IS NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: every line must be counted' USING ERRCODE = '22023';
  END IF;
  PERFORM public.stock_count_check_unmoved(c);
  v_pct := (public.setting_value_at('SET-43', NULL, clock_timestamp()) ->> 'selisih_opname')::numeric;
  v_exceeds := EXISTS (SELECT 1 FROM public.stock_count_lines l WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id
                         AND (l.system_qty = 0 AND l.counted_qty > 0 OR abs(l.counted_qty - l.system_qty) * 100 > l.system_qty * v_pct));
  IF v_exceeds THEN
    v_approval := public.approval_request('stock_adjustment', 'stock_count', c.id, btrim(p_reason), c.branch_id, NULL);
    UPDATE public.stock_counts SET state = 'pending_approval', reason = btrim(p_reason), threshold_pct = v_pct, exceeds = true, approval_id = v_approval,
           submitted_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = c.id;
  ELSE
    UPDATE public.stock_counts SET state = 'applied', reason = btrim(p_reason), threshold_pct = v_pct, exceeds = false,
           submitted_at = clock_timestamp(), closed_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = c.id RETURNING * INTO c;
    PERFORM public.stock_count_apply(c, a.staff_id, a.role);
  END IF;
  PERFORM public.audit_append('settings_change', 'stock_count', c.id, 'success', CASE WHEN v_exceeds THEN 'stock_count_submitted' ELSE 'stock_count_applied' END);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (c.branch_id, 'StockCountSubmitted', 'stock_count', c.id, jsonb_build_object('count_id', c.id, 'exceeds', v_exceeds));
  RETURN CASE WHEN v_exceeds THEN 'pending_approval' ELSE 'applied' END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_submit(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_count_submit(uuid, text) TO clinic_app;--> statement-breakpoint

-- Cancel (r2 P3-2): a draft by any counter of the branch; a pending count by its approval's requester through
-- approval_cancel (lock order staff_access → approvals → stock_counts; the sync trigger cancels the count).
CREATE FUNCTION public.stock_count_cancel(p_count uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','manager'], 'operations', NULL);
  c public.stock_counts;
BEGIN
  SELECT * INTO c FROM public.stock_counts x WHERE x.tenant_id = a.tenant_id AND x.id = p_count;
  IF NOT FOUND OR c.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: count not found' USING ERRCODE = 'P0002';
  END IF;
  IF c.state = 'pending_approval' THEN
    PERFORM public.approval_cancel(c.approval_id);
    RETURN;
  END IF;
  c := public.stock_count_locked(a.tenant_id, a.branch_id, p_count);
  IF c.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: count closed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.stock_counts SET state = 'cancelled', closed_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = c.id;
  PERFORM public.audit_append('settings_change', 'stock_count', c.id, 'success', 'stock_count_cancelled');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_count_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- The stock_adjustment decision applies the count (as record_correction_sync): approved → the batches must not
-- have moved (ERR_VERSION_CONFLICT fails the decision closed), then the adjustments; rejected | cancelled → the
-- count closes without change.
CREATE FUNCTION public.stock_count_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.stock_counts;
BEGIN
  IF NEW.type <> 'stock_adjustment' OR NEW.subject_kind <> 'stock_count' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM public.stock_counts WHERE tenant_id = NEW.tenant_id AND approval_id = NEW.id AND state = 'pending_approval' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NEW.state = 'approved' THEN
    PERFORM public.stock_count_check_unmoved(c);
    UPDATE public.stock_counts SET state = 'applied', closed_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = c.id RETURNING * INTO c;
    PERFORM public.stock_count_apply(c, NEW.decided_by, NEW.decided_as);
  ELSIF NEW.state IN ('rejected','cancelled') THEN
    UPDATE public.stock_counts SET state = NEW.state, closed_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = c.id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_stock_count_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.stock_count_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_stock_count_sync;--> statement-breakpoint

-- ── Readers (definers; catalog names through stock_item_label; plan P2-1) ────────────────────────────
-- The branch a reader looks at: a branch role's active branch (p_branch must match or be null); a tenant-wide
-- role names one of the tenant.
CREATE FUNCTION public.stock_reader_branch(p_tenant uuid, p_role text, p_active uuid, p_branch uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v uuid := CASE WHEN p_role IN ('manager','pharmacist') THEN p_active ELSE p_branch END;
BEGIN
  IF p_role IN ('manager','pharmacist') AND p_branch IS NOT NULL AND p_branch <> p_active
     OR v IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = v) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_reader_branch(uuid, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The page frame: role, the branches the reader may look at, what it may do.
CREATE FUNCTION public.stock_context() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
BEGIN
  RETURN jsonb_build_object('role', a.role, 'active_branch_id', a.branch_id,
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name, b.id) FROM public.branches b
                           WHERE b.tenant_id = a.tenant_id AND (a.role NOT IN ('manager','pharmacist') OR b.id = a.branch_id)), '[]'::jsonb),
    'can_edit_items', a.role IN ('pharmacist','purchasing','admin_pusat'),
    'can_receive', a.role IN ('pharmacist','purchasing'),
    'can_hold', a.role = 'pharmacist', 'can_open_vial', a.role = 'pharmacist',
    'can_set_levels', a.role IN ('pharmacist','purchasing'),
    'can_count', a.role IN ('pharmacist','manager'),
    'near_expiry_days', coalesce((public.setting_value_at('SET-27', a.branch_id, clock_timestamp()) ->> 'kedaluwarsa')::integer, 30));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_context() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_context() TO clinic_app;--> statement-breakpoint

-- Master Item list at a branch: catalog label, unit, vial and storage, fit and total quantity, level, low flag,
-- near-expiry and unfit counts (SET-27 days of that branch).
CREATE FUNCTION public.stock_item_list(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
  v_days integer := coalesce((public.setting_value_at('SET-27', v_branch, clock_timestamp()) ->> 'kedaluwarsa')::integer, 30);
  v_today date := public.stock_local_date(a.tenant_id, v_branch, clock_timestamp());
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(x.j ORDER BY x.j ->> 'name', x.j ->> 'id') FROM (
      SELECT jsonb_build_object('id', i.id, 'code', lb.code, 'name', lb.name, 'kind', lb.kind, 'unit', i.unit, 'vial_size', i.vial_size,
               'opened_use_hours', i.opened_use_hours, 'storage', i.storage, 'high_value', i.high_value, 'active', i.active,
               'quantity', coalesce(q.total, 0), 'fit_quantity', coalesce(q.fit, 0), 'near_expiry', coalesce(q.near, 0), 'unfit', coalesce(q.unfit, 0),
               'min_qty', l.min_qty, 'target_qty', l.target_qty, 'low', l.min_qty IS NOT NULL AND coalesce(q.fit, 0) < l.min_qty) AS j
        FROM public.stock_items i
        CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
        LEFT JOIN public.stock_levels l ON l.tenant_id = i.tenant_id AND l.branch_id = v_branch AND l.item_id = i.id
        LEFT JOIN LATERAL (
          SELECT sum(b.quantity) AS total, sum(public.stock_fit_qty(b)) AS fit,
                 count(*) FILTER (WHERE b.quantity > 0 AND public.stock_unfit_reason(b) IS NULL AND b.expiry <= v_today + v_days) AS near,
                 count(*) FILTER (WHERE b.quantity > 0 AND public.stock_unfit_reason(b) IS NOT NULL) AS unfit
            FROM public.stock_batches b WHERE b.tenant_id = i.tenant_id AND b.branch_id = v_branch AND b.item_id = i.id) q ON true
       WHERE i.tenant_id = a.tenant_id) x), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_item_list(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_item_list(uuid) TO clinic_app;--> statement-breakpoint

-- One item at a branch: attributes, batches in FEFO order with fitness and the open vial, the level, and the
-- next FEFO pick of one unit (what T-062/T-065 would take first).
CREATE FUNCTION public.stock_item_get(p_item uuid, p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
  i public.stock_items;
  lb record;
  v_next uuid;
BEGIN
  SELECT * INTO i FROM public.stock_items x WHERE x.tenant_id = a.tenant_id AND x.id = p_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  lb := public.stock_item_label(i.tenant_id, i.catalog_item_id);
  BEGIN
    SELECT f.batch_id INTO v_next FROM public.stock_fefo(a.tenant_id, v_branch, i.id, 0.0001) f LIMIT 1;
  EXCEPTION WHEN SQLSTATE 'P0422' THEN
    v_next := NULL;
  END;
  RETURN jsonb_build_object('id', i.id, 'catalog_item_id', i.catalog_item_id, 'code', lb.code, 'name', lb.name, 'kind', lb.kind, 'unit', i.unit,
    'vial_size', i.vial_size, 'opened_use_hours', i.opened_use_hours, 'storage', i.storage, 'registration_no', i.registration_no,
    'high_value', i.high_value, 'active', i.active, 'branch_id', v_branch, 'next_batch_id', v_next,
    'level', (SELECT jsonb_build_object('min_qty', l.min_qty, 'target_qty', l.target_qty) FROM public.stock_levels l
               WHERE l.tenant_id = i.tenant_id AND l.branch_id = v_branch AND l.item_id = i.id),
    'batches', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'batch_no', b.batch_no, 'expiry', b.expiry, 'quantity', b.quantity, 'state', b.state,
               'hold_reason', b.hold_reason, 'received_at', b.received_at, 'unfit', public.stock_unfit_reason(b), 'fit_quantity', public.stock_fit_qty(b),
               'vial', (SELECT jsonb_build_object('id', v.id, 'remaining', v.remaining, 'opened_at', v.opened_at, 'use_by', v.use_by,
                                                  'lapsed', public.stock_vial_unfit(v) IS NOT NULL)
                          FROM public.opened_vials v WHERE v.tenant_id = b.tenant_id AND v.batch_id = b.id AND v.state = 'open'))
             ORDER BY b.expiry, b.received_at, b.id)
        FROM public.stock_batches b WHERE b.tenant_id = i.tenant_id AND b.branch_id = v_branch AND b.item_id = i.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_item_get(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_item_get(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Kartu Stok: the movements of one item at a branch, newest first. Purchasing and auditor see patient-linked
-- movements (issue, consume, return, waste, dispense; T-062/T-065) without reason or source (IAM-12).
CREATE FUNCTION public.stock_card(p_item uuid, p_branch uuid, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
  v_mask boolean := a.role IN ('purchasing','auditor');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stock_items x WHERE x.tenant_id = a.tenant_id AND x.id = p_item) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(j ORDER BY s DESC) FROM (
      SELECT m.seq AS s, jsonb_build_object('id', m.id, 'kind', m.kind, 'quantity', m.quantity, 'balance_after', m.balance_after, 'created_at', m.created_at,
               'created_as', m.created_as, 'batch_id', m.batch_id, 'batch_no', b.batch_no, 'expiry', b.expiry,
               'created_by_name', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = m.tenant_id AND st.id = m.created_by),
               'reason', CASE WHEN v_mask AND m.kind IN ('issue','consume','return','waste','dispense') THEN NULL ELSE m.reason END,
               'source_kind', m.source_kind,
               'source_id', CASE WHEN v_mask AND m.kind IN ('issue','consume','return','waste','dispense') THEN NULL ELSE m.source_id END) AS j
        FROM public.stock_movements m JOIN public.stock_batches b ON b.tenant_id = m.tenant_id AND b.id = m.batch_id
       WHERE m.tenant_id = a.tenant_id AND m.branch_id = v_branch AND m.item_id = p_item
       ORDER BY m.seq DESC LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_card(uuid, uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_card(uuid, uuid, integer) TO clinic_app;--> statement-breakpoint

-- Batch & Kedaluwarsa: at a branch, batches holding stock that are unfit, held, or expire within the SET-27 days,
-- and the open vials with their use-by.
CREATE FUNCTION public.stock_batch_watch(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
  v_days integer := coalesce((public.setting_value_at('SET-27', v_branch, clock_timestamp()) ->> 'kedaluwarsa')::integer, 30);
  v_today date := public.stock_local_date(a.tenant_id, v_branch, clock_timestamp());
BEGIN
  RETURN jsonb_build_object('near_expiry_days', v_days, 'today', v_today,
    'batches', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'item_id', b.item_id, 'name', lb.name, 'unit', i.unit, 'batch_no', b.batch_no, 'expiry', b.expiry,
               'quantity', b.quantity, 'state', b.state, 'hold_reason', b.hold_reason, 'unfit', public.stock_unfit_reason(b),
               'days_left', b.expiry - v_today) ORDER BY b.expiry, b.id)
        FROM public.stock_batches b JOIN public.stock_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
        CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
       WHERE b.tenant_id = a.tenant_id AND b.branch_id = v_branch AND b.quantity > 0
         AND (b.state <> 'active' OR b.expiry <= v_today + v_days)), '[]'::jsonb),
    'vials', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', v.id, 'batch_id', b.id, 'item_id', b.item_id, 'name', lb.name, 'unit', i.unit, 'batch_no', b.batch_no,
               'remaining', v.remaining, 'opened_at', v.opened_at, 'use_by', v.use_by, 'lapsed', public.stock_vial_unfit(v) IS NOT NULL) ORDER BY v.use_by, v.id)
        FROM public.opened_vials v JOIN public.stock_batches b ON b.tenant_id = v.tenant_id AND b.id = v.batch_id
        JOIN public.stock_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
        CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = v_branch AND v.state = 'open'), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_batch_watch(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_batch_watch(uuid) TO clinic_app;--> statement-breakpoint

-- Counts at a branch (newest first, last 60 days and every open one).
CREATE FUNCTION public.stock_count_list(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'state', c.state, 'blind', c.blind, 'started_at', c.started_at, 'started_as', c.started_as,
             'started_by_name', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = c.tenant_id AND st.id = c.started_by),
             'lines', (SELECT count(*) FROM public.stock_count_lines l WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id),
             'counted', (SELECT count(*) FROM public.stock_count_lines l WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id AND l.counted_qty IS NOT NULL),
             'exceeds', c.exceeds, 'approval_id', c.approval_id, 'submitted_at', c.submitted_at, 'closed_at', c.closed_at) ORDER BY c.started_at DESC, c.id)
      FROM public.stock_counts c
     WHERE c.tenant_id = a.tenant_id AND c.branch_id = v_branch
       AND (c.state IN ('draft','pending_approval') OR c.started_at > clock_timestamp() - interval '60 days')), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_list(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_count_list(uuid) TO clinic_app;--> statement-breakpoint

-- One count: system quantities hidden while a blind count is a draft (P2-2); the difference shown after submit.
CREATE FUNCTION public.stock_count_get(p_count uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  c public.stock_counts;
  v_hide boolean;
BEGIN
  SELECT * INTO c FROM public.stock_counts x WHERE x.tenant_id = a.tenant_id AND x.id = p_count;
  IF NOT FOUND OR NOT public.stock_readable(c.tenant_id, c.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: count not found' USING ERRCODE = 'P0002';
  END IF;
  v_hide := c.blind AND c.state = 'draft';
  RETURN jsonb_build_object('id', c.id, 'branch_id', c.branch_id, 'state', c.state, 'blind', c.blind, 'reason', c.reason, 'threshold_pct', c.threshold_pct,
    'exceeds', c.exceeds, 'approval_id', c.approval_id, 'started_at', c.started_at, 'started_as', c.started_as, 'submitted_at', c.submitted_at,
    'closed_at', c.closed_at, 'can_count', c.state = 'draft' AND a.role IN ('pharmacist','manager') AND a.branch_id = c.branch_id,
    'can_cancel', a.role IN ('pharmacist','manager') AND a.branch_id = c.branch_id
                  AND (c.state = 'draft' OR c.state = 'pending_approval' AND EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = c.tenant_id AND ap.id = c.approval_id AND ap.requested_by = a.staff_id)),
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'name', lb.name, 'unit', i.unit, 'batch_id', l.batch_id, 'batch_no', b.batch_no,
               'expiry', b.expiry, 'system_qty', CASE WHEN v_hide THEN NULL ELSE l.system_qty END, 'counted_qty', l.counted_qty,
               'difference', CASE WHEN v_hide OR l.counted_qty IS NULL THEN NULL ELSE l.counted_qty - l.system_qty END) ORDER BY lb.name, b.expiry, l.id)
        FROM public.stock_count_lines l JOIN public.stock_batches b ON b.tenant_id = l.tenant_id AND b.id = l.batch_id
        JOIN public.stock_items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
        CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
       WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_count_get(uuid) TO clinic_app;--> statement-breakpoint

-- The Master Item form: catalog items of kind material or product with an active version and no stock item yet.
CREATE FUNCTION public.stock_item_options() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
BEGIN
  IF a.role NOT IN ('pharmacist','purchasing','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not edit stock items' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('catalog_item_id', ci.id, 'code', ci.code, 'kind', ci.kind, 'name', cv.name) ORDER BY cv.name, ci.id)
      FROM public.catalog_items ci JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
     WHERE ci.tenant_id = a.tenant_id AND ci.kind IN ('material','product')
       AND NOT EXISTS (SELECT 1 FROM public.stock_items s WHERE s.tenant_id = ci.tenant_id AND s.catalog_item_id = ci.id)), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_item_options() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_item_options() TO clinic_app;
