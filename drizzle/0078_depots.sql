CREATE TABLE "batch_holdings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	CONSTRAINT "batch_holdings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "batch_holdings_depot_batch_key" UNIQUE("tenant_id","depot_id","batch_id"),
	CONSTRAINT "batch_holdings_quantity_check" CHECK ("batch_holdings"."quantity" between 0 and 1000000000 and scale("batch_holdings"."quantity") <= 4)
);
--> statement-breakpoint
CREATE TABLE "depot_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source_batch_id" uuid NOT NULL,
	"destination_batch_id" uuid,
	"quantity" numeric NOT NULL,
	CONSTRAINT "depot_transfer_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "depot_transfer_lines_batch_key" UNIQUE("tenant_id","transfer_id","source_batch_id"),
	CONSTRAINT "depot_transfer_lines_check" CHECK ("depot_transfer_lines"."quantity" between 0.0001 and 1000000000 and scale("depot_transfer_lines"."quantity") <= 4 and "depot_transfer_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "depot_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"from_depot_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"to_depot_id" uuid,
	"state" text NOT NULL,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"closed_by" uuid,
	"closed_as" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "depot_transfers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "depot_transfers_branches_key" UNIQUE("tenant_id","id","from_branch_id","to_branch_id"),
	CONSTRAINT "depot_transfers_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "depot_transfers_check" CHECK ("depot_transfers"."kind" in ('intra','inter') and "depot_transfers"."state" in ('posted','sent','received','cancelled')
      and "depot_transfers"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "depot_transfers"."created_as" in ('pharmacist','purchasing')
      and ("depot_transfers"."kind" = 'intra' and "depot_transfers"."from_branch_id" = "depot_transfers"."to_branch_id" and "depot_transfers"."state" = 'posted' and "depot_transfers"."to_depot_id" is not null and "depot_transfers"."to_depot_id" <> "depot_transfers"."from_depot_id"
           or "depot_transfers"."kind" = 'inter' and "depot_transfers"."from_branch_id" <> "depot_transfers"."to_branch_id" and "depot_transfers"."state" in ('sent','received','cancelled')
              and (("depot_transfers"."state" = 'received') = ("depot_transfers"."to_depot_id" is not null)))
      and (("depot_transfers"."state" in ('received','cancelled')) = ("depot_transfers"."closed_at" is not null)) and num_nonnulls("depot_transfers"."closed_by", "depot_transfers"."closed_as", "depot_transfers"."closed_at") in (0, 3)
      and ("depot_transfers"."closed_as" is null or "depot_transfers"."closed_as" in ('pharmacist','purchasing')))
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"room_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "depots_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "depots_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "depots_branch_name_key" UNIQUE("tenant_id","branch_id","name"),
	CONSTRAINT "depots_check" CHECK ("depots"."kind" in ('gudang','ruang','apotek') and length(btrim("depots"."name")) between 2 and 60
      and (not "depots"."is_default" or ("depots"."kind" = 'gudang' and "depots"."active")) and ("depots"."room_id" is null or "depots"."kind" = 'ruang'))
);
--> statement-breakpoint
ALTER TABLE "stock_count_lines" DROP CONSTRAINT "stock_count_lines_batch_key";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_source_key";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_check";--> statement-breakpoint
DROP INDEX "opened_vials_one_open";--> statement-breakpoint
ALTER TABLE "opened_vials" ADD COLUMN "depot_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD COLUMN "depot_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "depot_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "depot_balance_after" numeric;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "leg" text;--> statement-breakpoint
ALTER TABLE "batch_holdings" ADD CONSTRAINT "batch_holdings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_holdings" ADD CONSTRAINT "batch_holdings_depot_fk" FOREIGN KEY ("tenant_id","branch_id","depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_holdings" ADD CONSTRAINT "batch_holdings_batch_fk" FOREIGN KEY ("tenant_id","branch_id","item_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfer_lines" ADD CONSTRAINT "depot_transfer_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfer_lines" ADD CONSTRAINT "depot_transfer_lines_transfer_fk" FOREIGN KEY ("tenant_id","transfer_id","from_branch_id","to_branch_id") REFERENCES "public"."depot_transfers"("tenant_id","id","from_branch_id","to_branch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfer_lines" ADD CONSTRAINT "depot_transfer_lines_source_fk" FOREIGN KEY ("tenant_id","from_branch_id","item_id","source_batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfer_lines" ADD CONSTRAINT "depot_transfer_lines_destination_fk" FOREIGN KEY ("tenant_id","to_branch_id","item_id","destination_batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfers" ADD CONSTRAINT "depot_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfers" ADD CONSTRAINT "depot_transfers_from_fk" FOREIGN KEY ("tenant_id","from_branch_id","from_depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfers" ADD CONSTRAINT "depot_transfers_to_branch_fk" FOREIGN KEY ("tenant_id","to_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfers" ADD CONSTRAINT "depot_transfers_to_fk" FOREIGN KEY ("tenant_id","to_branch_id","to_depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfers" ADD CONSTRAINT "depot_transfers_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_transfers" ADD CONSTRAINT "depot_transfers_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depots" ADD CONSTRAINT "depots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depots" ADD CONSTRAINT "depots_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depots" ADD CONSTRAINT "depots_room_fk" FOREIGN KEY ("tenant_id","branch_id","room_id") REFERENCES "public"."rooms"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depots" ADD CONSTRAINT "depots_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_holdings_batch_idx" ON "batch_holdings" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "depot_transfers_from_idx" ON "depot_transfers" USING btree ("tenant_id","from_branch_id","state","created_at");--> statement-breakpoint
CREATE INDEX "depot_transfers_to_idx" ON "depot_transfers" USING btree ("tenant_id","to_branch_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "depots_one_default" ON "depots" USING btree ("tenant_id","branch_id") WHERE is_default;--> statement-breakpoint
ALTER TABLE "opened_vials" ADD CONSTRAINT "opened_vials_depot_fk" FOREIGN KEY ("tenant_id","branch_id","depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_depot_fk" FOREIGN KEY ("tenant_id","branch_id","depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_depot_fk" FOREIGN KEY ("tenant_id","branch_id","depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_depot_idx" ON "stock_movements" USING btree ("tenant_id","batch_id","depot_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "opened_vials_one_open" ON "opened_vials" USING btree ("tenant_id","batch_id","depot_id") WHERE state = 'open';--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_batch_key" UNIQUE("tenant_id","count_id","batch_id","depot_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_key" UNIQUE NULLS NOT DISTINCT("tenant_id","source_kind","source_id","batch_id","depot_id","leg");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_check" CHECK ("stock_movements"."kind" in ('receive','adjust','issue','consume','return','waste','transfer_out','transfer_in','supplier_return','dispense') and "stock_movements"."quantity" between -1000000000 and 1000000000 and scale("stock_movements"."quantity") <= 4 and "stock_movements"."quantity" <> 0
      and "stock_movements"."balance_after" between 0 and 1000000000 and scale("stock_movements"."balance_after") <= 4 and "stock_movements"."source_kind" ~ '^[a-z][a-z_]{1,40}$'
      and ("stock_movements"."reason" is null or length(btrim("stock_movements"."reason")) between 3 and 500)
      and ("stock_movements"."kind" <> 'receive' or "stock_movements"."quantity" > 0) and "stock_movements"."depot_balance_after" between 0 and 1000000000 and scale("stock_movements"."depot_balance_after") <= 4
      and ("stock_movements"."kind" = 'transfer_out' and "stock_movements"."leg" is not distinct from 'out' and "stock_movements"."quantity" < 0
           or "stock_movements"."kind" = 'transfer_in' and "stock_movements"."leg" is not distinct from 'in' and "stock_movements"."quantity" > 0
           or "stock_movements"."kind" not in ('transfer_out','transfer_in') and "stock_movements"."leg" is null));--> statement-breakpoint

-- T-061 rules (generated by gen.py; plan docs/tasks/T-061.md)
-- Depots, batch holdings, linked transfers (PR-89, DATA-63; plan Argon r1 f201c55c adopted, r2 4cce2116 APPROVE;
-- DEC-071). Expand-only: the new columns open nullable (gen.py), are backfilled here, then made NOT NULL.

-- One default gudang per existing branch (created_by null: seeded).
INSERT INTO public.depots (tenant_id, branch_id, name, kind, is_default, active)
SELECT b.tenant_id, b.id, 'Gudang', 'gudang', true, true FROM public.branches b;--> statement-breakpoint
-- Every batch's quantity is held in its branch's gudang.
INSERT INTO public.batch_holdings (tenant_id, branch_id, depot_id, item_id, batch_id, quantity)
SELECT sb.tenant_id, sb.branch_id, d.id, sb.item_id, sb.id, sb.quantity
  FROM public.stock_batches sb JOIN public.depots d ON d.tenant_id = sb.tenant_id AND d.branch_id = sb.branch_id AND d.is_default;--> statement-breakpoint
-- Existing movements, vials and count lines are in that gudang (one depot per branch so far: the depot balance is the
-- batch balance). The T-060 guards refuse these updates; disabled only inside this migration, re-enabled ALWAYS.
ALTER TABLE public.stock_movements DISABLE TRIGGER stock_movements_guard;--> statement-breakpoint
ALTER TABLE public.opened_vials DISABLE TRIGGER opened_vials_guard;--> statement-breakpoint
ALTER TABLE public.stock_count_lines DISABLE TRIGGER stock_count_lines_guard;--> statement-breakpoint
UPDATE public.stock_movements m SET depot_id = d.id, depot_balance_after = m.balance_after
  FROM public.depots d WHERE d.tenant_id = m.tenant_id AND d.branch_id = m.branch_id AND d.is_default;--> statement-breakpoint
UPDATE public.opened_vials v SET depot_id = d.id
  FROM public.depots d WHERE d.tenant_id = v.tenant_id AND d.branch_id = v.branch_id AND d.is_default;--> statement-breakpoint
UPDATE public.stock_count_lines l SET depot_id = d.id
  FROM public.depots d WHERE d.tenant_id = l.tenant_id AND d.branch_id = l.branch_id AND d.is_default;--> statement-breakpoint
ALTER TABLE public.stock_movements ENABLE ALWAYS TRIGGER stock_movements_guard;--> statement-breakpoint
ALTER TABLE public.opened_vials ENABLE ALWAYS TRIGGER opened_vials_guard;--> statement-breakpoint
ALTER TABLE public.stock_count_lines ENABLE ALWAYS TRIGGER stock_count_lines_guard;--> statement-breakpoint
ALTER TABLE public.stock_movements ALTER COLUMN depot_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE public.stock_movements ALTER COLUMN depot_balance_after SET NOT NULL;--> statement-breakpoint
ALTER TABLE public.opened_vials ALTER COLUMN depot_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE public.stock_count_lines ALTER COLUMN depot_id SET NOT NULL;--> statement-breakpoint
-- r2 P3-3 (T-060): count lines keep system_qty ungranted; the new column joins the granted list.
GRANT SELECT (depot_id) ON public.stock_count_lines TO clinic_app;--> statement-breakpoint
GRANT SELECT (depot_id) ON public.stock_count_lines TO clinic_operator;--> statement-breakpoint

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────
-- The default gudang of a branch.
CREATE FUNCTION public.depot_default(p_tenant uuid, p_branch uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT d.id FROM public.depots d WHERE d.tenant_id = p_tenant AND d.branch_id = p_branch AND d.is_default
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.depot_default(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Transfer readers: either branch's stock reader (plan P3-1).
CREATE FUNCTION public.transfer_readable(p_tenant uuid, p_from uuid, p_to uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.stock_readable(p_tenant, p_from) OR public.stock_readable(p_tenant, p_to)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.transfer_readable(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.transfer_readable(uuid, uuid, uuid) TO clinic_app;--> statement-breakpoint

-- ── Movement (internal): the one way a batch and a holding change ─────────────────────────────────────
-- Writes one movement on (batch, depot); its insert trigger locks the batch and the holding and sets both. A
-- movement lowering a depot holding below that depot's open vial clamps the vial (finished at 0). p_leg only for
-- transfer legs. The batch lock comes first (every writer locks batches in id order before holdings).
CREATE FUNCTION public.stock_move_depot(p_tenant uuid, p_batch uuid, p_depot uuid, p_kind text, p_qty numeric, p_reason text, p_source_kind text,
                                        p_source uuid, p_by uuid, p_as text, p_leg text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.stock_batches;
  v_held numeric;
  v_new numeric;
  v_depot_new numeric;
  v_id uuid;
BEGIN
  SELECT * INTO b FROM public.stock_batches WHERE tenant_id = p_tenant AND id = p_batch FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = p_tenant AND d.branch_id = b.branch_id AND d.id = p_depot) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT h.quantity INTO v_held FROM public.batch_holdings h WHERE h.tenant_id = p_tenant AND h.depot_id = p_depot AND h.batch_id = p_batch FOR UPDATE;
  v_new := b.quantity + p_qty;
  v_depot_new := coalesce(v_held, 0) + p_qty;
  IF v_new < 0 OR v_depot_new < 0 THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: the depot would go below zero' USING ERRCODE = 'P0422';
  END IF;
  INSERT INTO public.stock_movements (tenant_id, branch_id, item_id, batch_id, depot_id, kind, quantity, balance_after, depot_balance_after, leg, reason,
                                      source_kind, source_id, created_by, created_as)
  VALUES (b.tenant_id, b.branch_id, b.item_id, b.id, p_depot, p_kind, p_qty, v_new, v_depot_new, p_leg, NULLIF(btrim(p_reason), ''),
          p_source_kind, p_source, p_by, p_as)
  RETURNING id INTO v_id;
  UPDATE public.opened_vials SET remaining = v_depot_new,
         state = CASE WHEN v_depot_new = 0 THEN 'finished' ELSE state END,
         closed_at = CASE WHEN v_depot_new = 0 THEN clock_timestamp() END
   WHERE tenant_id = b.tenant_id AND batch_id = b.id AND depot_id = p_depot AND state = 'open' AND remaining > v_depot_new;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_move_depot(uuid, uuid, uuid, text, numeric, text, text, uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- T-060's movement entry keeps its signature: the batch's branch default gudang.
CREATE OR REPLACE FUNCTION public.stock_move(p_tenant uuid, p_batch uuid, p_kind text, p_qty numeric, p_reason text, p_source_kind text, p_source uuid,
                                  p_by uuid, p_as text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN public.stock_move_depot(p_tenant, p_batch,
    public.depot_default(p_tenant, (SELECT b.branch_id FROM public.stock_batches b WHERE b.tenant_id = p_tenant AND b.id = p_batch)),
    p_kind, p_qty, p_reason, p_source_kind, p_source, p_by, p_as, NULL);
END
$$;--> statement-breakpoint

-- What may be taken from a batch branch-wide: its quantity when fit, less the remainder of every lapsed open vial
-- (one per depot now: P1-2).
CREATE OR REPLACE FUNCTION public.stock_fit_qty(b public.stock_batches, p_at timestamptz DEFAULT clock_timestamp()) RETURNS numeric
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN public.stock_unfit_reason(b, p_at) IS NOT NULL THEN 0
              ELSE b.quantity - coalesce((SELECT sum(v.remaining) FROM public.opened_vials v
                                           WHERE v.tenant_id = b.tenant_id AND v.batch_id = b.id AND v.state = 'open'
                                             AND public.stock_vial_unfit(v, p_at) IS NOT NULL), 0) END
$$;--> statement-breakpoint

-- FEFO branch-wide (T-060 signature): fit open vials first, then each batch's sealed fit quantity (quantity − all its
-- open vials' remaining, P1-2), by expiry, received_at, id.
CREATE OR REPLACE FUNCTION public.stock_fefo(p_tenant uuid, p_branch uuid, p_item uuid, p_qty numeric, p_at timestamptz DEFAULT clock_timestamp())
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
      SELECT 2, sb.id, NULL, sb.quantity - coalesce((SELECT sum(ov.remaining) FROM public.opened_vials ov
                                                       WHERE ov.tenant_id = sb.tenant_id AND ov.batch_id = sb.id AND ov.state = 'open'), 0),
             sb.expiry::timestamptz, sb.received_at, sb.id
        FROM public.stock_batches sb
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

-- FEFO within one depot (T-062 issues from a depot; T-065 dispenses from the apotek): that depot's fit open vial
-- first, then each holding's sealed fit quantity (holding − that depot's open vial remaining).
CREATE FUNCTION public.stock_fefo_depot(p_tenant uuid, p_depot uuid, p_item uuid, p_qty numeric, p_at timestamptz DEFAULT clock_timestamp())
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
       WHERE v.tenant_id = p_tenant AND v.depot_id = p_depot AND sb.item_id = p_item AND v.state = 'open'
         AND public.stock_vial_unfit(v, p_at) IS NULL AND public.stock_unfit_reason(sb, p_at) IS NULL AND v.remaining > 0
      UNION ALL
      SELECT 2, sb.id, NULL, h.quantity - coalesce(ov.remaining, 0), sb.expiry::timestamptz, sb.received_at, sb.id
        FROM public.batch_holdings h JOIN public.stock_batches sb ON sb.tenant_id = h.tenant_id AND sb.id = h.batch_id
        LEFT JOIN public.opened_vials ov ON ov.tenant_id = h.tenant_id AND ov.batch_id = h.batch_id AND ov.depot_id = h.depot_id AND ov.state = 'open'
       WHERE h.tenant_id = p_tenant AND h.depot_id = p_depot AND h.item_id = p_item AND public.stock_unfit_reason(sb, p_at) IS NULL
    ) x WHERE x.avail > 0 ORDER BY x.tier, x.k1, x.k2, x.k3
  LOOP
    EXIT WHEN v_left <= 0;
    batch_id := r.b; vial_id := r.vid; take := least(r.avail, v_left);
    v_left := v_left - take;
    RETURN NEXT;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: not enough fit stock in the depot' USING ERRCODE = 'P0422';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_fefo_depot(uuid, uuid, uuid, numeric, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- What T-062/T-065 call before taking p_qty from a batch in a depot.
CREATE FUNCTION public.stock_assert_fit_depot(p_tenant uuid, p_batch uuid, p_depot uuid, p_qty numeric, p_at timestamptz DEFAULT clock_timestamp()) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.stock_batches;
  v_held numeric;
  v_lapsed numeric := 0;
  v public.opened_vials;
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
  SELECT h.quantity INTO v_held FROM public.batch_holdings h WHERE h.tenant_id = p_tenant AND h.depot_id = p_depot AND h.batch_id = p_batch;
  SELECT * INTO v FROM public.opened_vials x WHERE x.tenant_id = p_tenant AND x.depot_id = p_depot AND x.batch_id = p_batch AND x.state = 'open';
  IF FOUND AND public.stock_vial_unfit(v, p_at) IS NOT NULL THEN
    v_lapsed := v.remaining;
  END IF;
  IF coalesce(v_held, 0) - v_lapsed < p_qty THEN
    IF coalesce(v_held, 0) >= p_qty THEN
      RAISE EXCEPTION 'ERR_STOCK_UNFIT: vial_lapsed' USING ERRCODE = 'P0422';
    END IF;
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: not enough stock in the depot' USING ERRCODE = 'P0422';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_assert_fit_depot(uuid, uuid, uuid, numeric, timestamptz) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY depots_read ON public.depots FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.depots TO clinic_app;--> statement-breakpoint
CREATE POLICY depots_operator_read ON public.depots FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.depots', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.depots TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER depots_no_truncate BEFORE TRUNCATE ON public.depots FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.depots ENABLE ALWAYS TRIGGER depots_no_truncate;--> statement-breakpoint
ALTER TABLE public.batch_holdings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY batch_holdings_read ON public.batch_holdings FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.batch_holdings TO clinic_app;--> statement-breakpoint
CREATE POLICY batch_holdings_operator_read ON public.batch_holdings FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.batch_holdings', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.batch_holdings TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER batch_holdings_no_truncate BEFORE TRUNCATE ON public.batch_holdings FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.batch_holdings ENABLE ALWAYS TRIGGER batch_holdings_no_truncate;--> statement-breakpoint
ALTER TABLE public.depot_transfers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY depot_transfers_read ON public.depot_transfers FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.transfer_readable(tenant_id, from_branch_id, to_branch_id));--> statement-breakpoint
GRANT SELECT ON public.depot_transfers TO clinic_app;--> statement-breakpoint
CREATE POLICY depot_transfers_operator_read ON public.depot_transfers FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.depot_transfers', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.depot_transfers TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER depot_transfers_no_truncate BEFORE TRUNCATE ON public.depot_transfers FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.depot_transfers ENABLE ALWAYS TRIGGER depot_transfers_no_truncate;--> statement-breakpoint
ALTER TABLE public.depot_transfer_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY depot_transfer_lines_read ON public.depot_transfer_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.transfer_readable(tenant_id, from_branch_id, to_branch_id));--> statement-breakpoint
GRANT SELECT ON public.depot_transfer_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY depot_transfer_lines_operator_read ON public.depot_transfer_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.depot_transfer_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.depot_transfer_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER depot_transfer_lines_no_truncate BEFORE TRUNCATE ON public.depot_transfer_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.depot_transfer_lines ENABLE ALWAYS TRIGGER depot_transfer_lines_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.depots', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'depot and transfer definers (src/modules/inventory/depots)', 'the depot''s branch'),
  ('public.batch_holdings', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'depot and transfer definers (src/modules/inventory/depots)', 'the depot''s branch'),
  ('public.depot_transfers', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'depot and transfer definers (src/modules/inventory/depots)', 'the source and destination branches'),
  ('public.depot_transfer_lines', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'depot and transfer definers (src/modules/inventory/depots)', 'the source and destination branches');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): depots are configuration; holdings and transfers carry staff attribution.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.depots', 'config'),
  ('public.batch_holdings', 'personal'),
  ('public.depot_transfers', 'personal'),
  ('public.depot_transfer_lines', 'personal');--> statement-breakpoint

-- ── Guards: staff_access lock first, ENABLE ALWAYS ─────────────────────────────────────────────────
-- The T-060 invariant extended to holdings (plan open point 1): a movement names a depot of its batch's branch; it
-- continues the batch balance and that depot's holding balance (both locked: batch first); its insert trigger sets
-- both; the holding guard accepts a quantity change only as the newest movement of (batch, depot) continuing it. So
-- Σ holdings of a batch = the batch quantity at every statement boundary. A movement written without a depot (a
-- T-060 caller) is on the branch's default gudang.
CREATE OR REPLACE FUNCTION public.stock_movements_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.stock_batches;
  h public.batch_holdings;
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
  NEW.depot_id := coalesce(NEW.depot_id, public.depot_default(NEW.tenant_id, NEW.branch_id));
  IF NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = NEW.tenant_id AND d.branch_id = NEW.branch_id AND d.id = NEW.depot_id) THEN
    RAISE EXCEPTION 'a movement names a depot of its branch' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.batch_holdings (tenant_id, branch_id, depot_id, item_id, batch_id, quantity)
  VALUES (NEW.tenant_id, NEW.branch_id, NEW.depot_id, NEW.item_id, NEW.batch_id, 0) ON CONFLICT (tenant_id, depot_id, batch_id) DO NOTHING;
  SELECT * INTO h FROM public.batch_holdings WHERE tenant_id = NEW.tenant_id AND depot_id = NEW.depot_id AND batch_id = NEW.batch_id FOR UPDATE;
  NEW.depot_balance_after := coalesce(NEW.depot_balance_after, h.quantity + NEW.quantity);
  IF NEW.depot_balance_after <> h.quantity + NEW.quantity THEN
    RAISE EXCEPTION 'a movement continues the depot balance' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.stock_movements_apply() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.stock_batches SET quantity = NEW.balance_after WHERE tenant_id = NEW.tenant_id AND id = NEW.batch_id;
  UPDATE public.batch_holdings SET quantity = NEW.depot_balance_after WHERE tenant_id = NEW.tenant_id AND depot_id = NEW.depot_id AND batch_id = NEW.batch_id;
  RETURN NULL;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.batch_holdings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  m public.stock_movements;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'batch holdings are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity <> 0 THEN
      RAISE EXCEPTION 'a holding opens empty; stock enters by a movement' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.depot_id, NEW.item_id, NEW.batch_id)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.depot_id, OLD.item_id, OLD.batch_id) THEN
    RAISE EXCEPTION 'a holding keeps its depot and batch' USING ERRCODE = '42501';
  END IF;
  IF NEW.quantity <> OLD.quantity THEN
    SELECT * INTO m FROM public.stock_movements WHERE tenant_id = NEW.tenant_id AND batch_id = NEW.batch_id AND depot_id = NEW.depot_id ORDER BY seq DESC LIMIT 1;
    IF NOT FOUND OR m.depot_balance_after <> NEW.quantity OR m.depot_balance_after - m.quantity <> OLD.quantity THEN
      RAISE EXCEPTION 'a holding changes only by its movement' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.batch_holdings_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER batch_holdings_guard BEFORE INSERT OR UPDATE OR DELETE ON public.batch_holdings FOR EACH ROW EXECUTE FUNCTION public.batch_holdings_guard();--> statement-breakpoint
ALTER TABLE public.batch_holdings ENABLE ALWAYS TRIGGER batch_holdings_guard;--> statement-breakpoint

-- Depots: never deleted; branch, kind, default and creator frozen; name, room and active change; the default gudang
-- stays active (CHECK); a depot holding stock or an open vial cannot be deactivated.
CREATE FUNCTION public.depots_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'depots are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.kind, NEW.is_default, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.kind, OLD.is_default, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'a depot keeps its branch, kind and default' USING ERRCODE = '42501';
    END IF;
    IF OLD.active AND NOT NEW.active
       AND (EXISTS (SELECT 1 FROM public.batch_holdings h WHERE h.tenant_id = OLD.tenant_id AND h.depot_id = OLD.id AND h.quantity > 0)
            OR EXISTS (SELECT 1 FROM public.opened_vials v WHERE v.tenant_id = OLD.tenant_id AND v.depot_id = OLD.id AND v.state = 'open')) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the depot holds stock' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NEW.room_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.tenant_id = NEW.tenant_id AND r.branch_id = NEW.branch_id AND r.id = NEW.room_id AND r.kind = 'treatment') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: room' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.depots_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER depots_guard BEFORE INSERT OR UPDATE OR DELETE ON public.depots FOR EACH ROW EXECUTE FUNCTION public.depots_guard();--> statement-breakpoint
ALTER TABLE public.depots ENABLE ALWAYS TRIGGER depots_guard;--> statement-breakpoint

-- Every new branch gets its default gudang (P1-3: sorts after branches_onboarding_checklist; created_by null).
CREATE FUNCTION public.branches_seed_depot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.depots (tenant_id, branch_id, name, kind, is_default, active) VALUES (NEW.tenant_id, NEW.id, 'Gudang', 'gudang', true, true);
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branches_seed_depot() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER branches_seed_depot AFTER INSERT ON public.branches FOR EACH ROW EXECUTE FUNCTION public.branches_seed_depot();--> statement-breakpoint
ALTER TABLE public.branches ENABLE ALWAYS TRIGGER branches_seed_depot;--> statement-breakpoint

-- Transfers: never deleted; open posted (intra) or sent (inter); only an inter transfer moves once, sent → received
-- (with its destination depot) or cancelled, setting the close stamp; everything else frozen.
CREATE FUNCTION public.depot_transfers_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transfers are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.kind = 'intra' AND NEW.state = 'posted' OR NEW.kind = 'inter' AND NEW.state = 'sent') OR NEW.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a transfer opens posted or sent' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'sent' OR NEW.state NOT IN ('received','cancelled')
     OR (NEW.id, NEW.tenant_id, NEW.kind, NEW.from_branch_id, NEW.from_depot_id, NEW.to_branch_id, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.kind, OLD.from_branch_id, OLD.from_depot_id, OLD.to_branch_id, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at) THEN
    RAISE EXCEPTION 'a transfer is received or cancelled once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.depot_transfers_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER depot_transfers_guard BEFORE INSERT OR UPDATE OR DELETE ON public.depot_transfers FOR EACH ROW EXECUTE FUNCTION public.depot_transfers_guard();--> statement-breakpoint
ALTER TABLE public.depot_transfers ENABLE ALWAYS TRIGGER depot_transfers_guard;--> statement-breakpoint

-- Lines: never deleted; added only before the transfer's first movement; the destination batch set once, while the
-- transfer is sent; everything else frozen.
CREATE FUNCTION public.depot_transfer_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transfer lines are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.destination_batch_id IS NOT NULL AND NEW.from_branch_id <> NEW.to_branch_id
       OR EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.tenant_id = NEW.tenant_id AND m.source_kind = 'depot_transfer' AND m.source_id = NEW.transfer_id) THEN
      RAISE EXCEPTION 'a transfer line is added before the transfer moves stock' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.destination_batch_id IS NOT NULL OR NEW.destination_batch_id IS NULL
     OR (NEW.id, NEW.tenant_id, NEW.transfer_id, NEW.from_branch_id, NEW.to_branch_id, NEW.item_id, NEW.source_batch_id, NEW.quantity)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.transfer_id, OLD.from_branch_id, OLD.to_branch_id, OLD.item_id, OLD.source_batch_id, OLD.quantity)
     OR NOT EXISTS (SELECT 1 FROM public.depot_transfers t WHERE t.tenant_id = OLD.tenant_id AND t.id = OLD.transfer_id AND t.state = 'sent') THEN
    RAISE EXCEPTION 'a transfer line gets its destination batch once, on receipt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.depot_transfer_lines_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER depot_transfer_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.depot_transfer_lines FOR EACH ROW EXECUTE FUNCTION public.depot_transfer_lines_guard();--> statement-breakpoint
ALTER TABLE public.depot_transfer_lines ENABLE ALWAYS TRIGGER depot_transfer_lines_guard;--> statement-breakpoint

-- Opened vials (P1-2): open with remaining ≤ the depot's holding; depot frozen.
CREATE OR REPLACE FUNCTION public.opened_vials_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'opened vials are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open' OR NEW.remaining <= 0
       OR NEW.remaining > coalesce((SELECT h.quantity FROM public.batch_holdings h WHERE h.tenant_id = NEW.tenant_id AND h.depot_id = NEW.depot_id AND h.batch_id = NEW.batch_id), 0) THEN
      RAISE EXCEPTION 'a vial opens with stock in its depot' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.batch_id, NEW.depot_id, NEW.opened_by, NEW.opened_as, NEW.opened_at, NEW.use_by)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.batch_id, OLD.depot_id, OLD.opened_by, OLD.opened_as, OLD.opened_at, OLD.use_by)
     OR OLD.state <> 'open' OR NEW.remaining > OLD.remaining THEN
    RAISE EXCEPTION 'an opened vial only runs down and closes once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.stock_count_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'count lines are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_counts c WHERE c.tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id) AND c.id = coalesce(NEW.count_id, OLD.count_id) AND c.state = 'draft') THEN
    RAISE EXCEPTION 'a count line changes only while its count is a draft' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.count_id, NEW.item_id, NEW.batch_id, NEW.depot_id, NEW.system_qty)
                          IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.count_id, OLD.item_id, OLD.batch_id, OLD.depot_id, OLD.system_qty) THEN
    RAISE EXCEPTION 'a count line keeps its batch, depot and snapshot' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- ── Writers (definers; the actor lock first) ───────────────────────────────────────────────────────

-- Gudang & Depot (plan open point 8): pharmacist at its branch, purchasing and admin pusat naming a branch.
-- Create p: {branch_id, name, kind gudang|ruang|apotek, room_id?}; update p: {name, room_id?, active}. Never deleted;
-- the default gudang cannot be deactivated (CHECK); a depot with stock cannot be deactivated (guard).
CREATE FUNCTION public.depot_save(p_depot uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  d public.depots;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: depot' USING ERRCODE = '22023';
  END IF;
  IF p_depot IS NULL THEN
    a := public.stock_actor(ARRAY['pharmacist','purchasing','admin_pusat'], 'configuration', NULLIF(p ->> 'branch_id', '')::uuid);
    IF a.branch_id IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
    END IF;
    BEGIN
      INSERT INTO public.depots (tenant_id, branch_id, name, kind, room_id, created_by)
      VALUES (a.tenant_id, a.branch_id, btrim(p ->> 'name'), p ->> 'kind', NULLIF(p ->> 'room_id', '')::uuid, a.staff_id)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: name_in_use' USING ERRCODE = '22023';
              WHEN check_violation OR not_null_violation OR invalid_text_representation OR foreign_key_violation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: depot' USING ERRCODE = '22023';
    END;
    PERFORM public.audit_append('settings_change', 'depot', v_id, 'success', 'depot_created');
    RETURN v_id;
  END IF;
  a := public.stock_actor(ARRAY['pharmacist','purchasing','admin_pusat'], 'configuration', NULL);
  SELECT * INTO d FROM public.depots x WHERE x.tenant_id = a.tenant_id AND x.id = p_depot FOR UPDATE;
  IF NOT FOUND OR a.role = 'pharmacist' AND d.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    UPDATE public.depots SET name = btrim(p ->> 'name'), room_id = NULLIF(p ->> 'room_id', '')::uuid, active = coalesce((p ->> 'active')::boolean, true)
     WHERE tenant_id = d.tenant_id AND id = d.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: name_in_use' USING ERRCODE = '22023';
            WHEN check_violation OR not_null_violation OR invalid_text_representation OR foreign_key_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: depot' USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'depot', d.id, 'success', 'depot_updated');
  RETURN d.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.depot_save(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.depot_save(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- The source depot of a transfer as the caller may use it: pharmacist at its branch, purchasing any branch of the
-- tenant; active.
CREATE FUNCTION public.transfer_source(p_tenant uuid, p_role text, p_branch uuid, p_depot uuid) RETURNS public.depots
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  d public.depots;
BEGIN
  SELECT * INTO d FROM public.depots x WHERE x.tenant_id = p_tenant AND x.id = p_depot;
  IF NOT FOUND OR p_role = 'pharmacist' AND d.branch_id <> p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT d.active THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the depot is inactive' USING ERRCODE = '55000';
  END IF;
  RETURN d;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.transfer_source(uuid, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Validates p.lines (1–200, distinct batches of the source depot's branch, quantities > 0) and takes the locks in
-- order (P2-2): the batches in id order, then the source holdings in id order. Each line must be fit sealed stock of
-- the source depot: the batch fit (ERR_STOCK_UNFIT), the holding less that depot's open vial enough
-- (ERR_STOCK_INSUFFICIENT). Returns the lines as (batch, item, quantity).
CREATE FUNCTION public.transfer_take_lines(p_tenant uuid, d public.depots, p_lines jsonb)
RETURNS TABLE (batch_id uuid, item_id uuid, quantity numeric)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_batches uuid[];
  v_qtys numeric[];
  r record;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT array_agg((x ->> 'batch_id')::uuid ORDER BY (x ->> 'batch_id')), array_agg((x ->> 'quantity')::numeric ORDER BY (x ->> 'batch_id'))
      INTO v_batches, v_qtys FROM jsonb_array_elements(p_lines) x;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END;
  IF array_position(v_batches, NULL) IS NOT NULL OR array_position(v_qtys, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT u) FROM unnest(v_batches) u) <> cardinality(v_batches)
     OR EXISTS (SELECT 1 FROM unnest(v_qtys) q WHERE NOT (q > 0 AND q <= 1000000000 AND scale(q) <= 4)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = p_tenant AND b.id = ANY (v_batches) ORDER BY b.id FOR UPDATE;
  IF (SELECT count(*) FROM public.stock_batches b WHERE b.tenant_id = p_tenant AND b.id = ANY (v_batches) AND b.branch_id = d.branch_id) <> cardinality(v_batches) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.batch_holdings h WHERE h.tenant_id = p_tenant AND h.depot_id = d.id AND h.batch_id = ANY (v_batches) ORDER BY h.id FOR UPDATE;
  FOR r IN SELECT sb AS row, u.q FROM unnest(v_batches, v_qtys) AS u(b, q) JOIN public.stock_batches sb ON sb.tenant_id = p_tenant AND sb.id = u.b ORDER BY u.b LOOP
    IF public.stock_unfit_reason(r.row) IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_STOCK_UNFIT: %', public.stock_unfit_reason(r.row) USING ERRCODE = 'P0422';
    END IF;
    IF coalesce((SELECT h.quantity FROM public.batch_holdings h WHERE h.tenant_id = p_tenant AND h.depot_id = d.id AND h.batch_id = (r.row).id), 0)
       - coalesce((SELECT v.remaining FROM public.opened_vials v WHERE v.tenant_id = p_tenant AND v.depot_id = d.id AND v.batch_id = (r.row).id AND v.state = 'open'), 0) < r.q THEN
      RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: not enough stock in the source depot' USING ERRCODE = 'P0422';
    END IF;
  END LOOP;
  RETURN QUERY SELECT u.b, sb.item_id, u.q FROM unnest(v_batches, v_qtys) AS u(b, q) JOIN public.stock_batches sb ON sb.tenant_id = p_tenant AND sb.id = u.b ORDER BY u.b;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.transfer_take_lines(uuid, public.depots, jsonb) FROM PUBLIC;--> statement-breakpoint

-- Transfer between depots of one branch (PR-89): one record, per line two linked legs on the same batch (out of the
-- source depot, into the destination), posted at once. p_key: the command key (one transfer per key).
-- p: {from_depot_id, to_depot_id, lines: [{batch_id, quantity}]}.
CREATE FUNCTION public.depot_transfer(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'operations', NULL);
  s public.depots;
  t public.depots;
  v_id uuid;
  l record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: transfer' USING ERRCODE = '22023';
  END IF;
  s := public.transfer_source(a.tenant_id, a.role, a.branch_id, NULLIF(p ->> 'from_depot_id', '')::uuid);
  SELECT * INTO t FROM public.depots x WHERE x.tenant_id = a.tenant_id AND x.id = NULLIF(p ->> 'to_depot_id', '')::uuid;
  IF NOT FOUND OR t.branch_id <> s.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  IF t.id = s.id OR NOT t.active THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: destination depot' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.depot_transfers (tenant_id, kind, from_branch_id, from_depot_id, to_branch_id, to_depot_id, state, command_key, created_by, created_as)
    VALUES (a.tenant_id, 'intra', s.branch_id, s.id, s.branch_id, t.id, 'posted', p_key, a.staff_id, a.role) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a transfer with this key exists' USING ERRCODE = '23505';
            WHEN check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: transfer' USING ERRCODE = '22023';
  END;
  FOR l IN SELECT * FROM public.transfer_take_lines(a.tenant_id, s, p -> 'lines') LOOP
    INSERT INTO public.depot_transfer_lines (tenant_id, transfer_id, from_branch_id, to_branch_id, item_id, source_batch_id, destination_batch_id, quantity)
    VALUES (a.tenant_id, v_id, s.branch_id, s.branch_id, l.item_id, l.batch_id, l.batch_id, l.quantity);
  END LOOP;
  FOR l IN SELECT * FROM public.depot_transfer_lines x WHERE x.tenant_id = a.tenant_id AND x.transfer_id = v_id ORDER BY x.source_batch_id LOOP
    PERFORM public.stock_move_depot(a.tenant_id, l.source_batch_id, s.id, 'transfer_out', -l.quantity, NULL, 'depot_transfer', v_id, a.staff_id, a.role, 'out');
    PERFORM public.stock_move_depot(a.tenant_id, l.source_batch_id, t.id, 'transfer_in', l.quantity, NULL, 'depot_transfer', v_id, a.staff_id, a.role, 'in');
  END LOOP;
  PERFORM public.audit_append('settings_change', 'depot_transfer', v_id, 'success', 'stock_transfer_posted');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (s.branch_id, 'StockTransferred', 'depot_transfer', v_id, jsonb_build_object('transfer_id', v_id, 'kind', 'intra', 'state', 'posted'));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.depot_transfer(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.depot_transfer(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Transfer to another branch (PR-17), step 1: the out legs leave the source depot; the stock is in transit on the
-- transfer's lines. p: {from_depot_id, to_branch_id, lines: [{batch_id, quantity}]}.
CREATE FUNCTION public.branch_transfer_send(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'operations', NULL);
  s public.depots;
  v_to uuid;
  v_id uuid;
  l record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: transfer' USING ERRCODE = '22023';
  END IF;
  s := public.transfer_source(a.tenant_id, a.role, a.branch_id, NULLIF(p ->> 'from_depot_id', '')::uuid);
  SELECT b.id INTO v_to FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = NULLIF(p ->> 'to_branch_id', '')::uuid;
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_to = s.branch_id THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: same branch' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.depot_transfers (tenant_id, kind, from_branch_id, from_depot_id, to_branch_id, state, command_key, created_by, created_as)
    VALUES (a.tenant_id, 'inter', s.branch_id, s.id, v_to, 'sent', p_key, a.staff_id, a.role) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a transfer with this key exists' USING ERRCODE = '23505';
            WHEN check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: transfer' USING ERRCODE = '22023';
  END;
  FOR l IN SELECT * FROM public.transfer_take_lines(a.tenant_id, s, p -> 'lines') LOOP
    INSERT INTO public.depot_transfer_lines (tenant_id, transfer_id, from_branch_id, to_branch_id, item_id, source_batch_id, quantity)
    VALUES (a.tenant_id, v_id, s.branch_id, v_to, l.item_id, l.batch_id, l.quantity);
  END LOOP;
  FOR l IN SELECT * FROM public.depot_transfer_lines x WHERE x.tenant_id = a.tenant_id AND x.transfer_id = v_id ORDER BY x.source_batch_id LOOP
    PERFORM public.stock_move_depot(a.tenant_id, l.source_batch_id, s.id, 'transfer_out', -l.quantity, NULL, 'depot_transfer', v_id, a.staff_id, a.role, 'out');
  END LOOP;
  PERFORM public.audit_append('settings_change', 'depot_transfer', v_id, 'success', 'stock_transfer_sent');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (s.branch_id, 'StockTransferred', 'depot_transfer', v_id, jsonb_build_object('transfer_id', v_id, 'kind', 'inter', 'state', 'sent'));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_transfer_send(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_transfer_send(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Step 2: the in legs, on the destination branch's batch of the same item, batch number and expiry (opened at 0 when
-- missing), into the named active depot of the destination branch or its default gudang. A destination batch that
-- is recalled refuses (ERR_STOCK_UNFIT). Pharmacist at the destination branch, or purchasing.
CREATE FUNCTION public.branch_transfer_receive(p_transfer uuid, p_depot uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'operations', NULL);
  t public.depot_transfers;
  d public.depots;
  l record;
  v_batch uuid;
BEGIN
  SELECT * INTO t FROM public.depot_transfers x WHERE x.tenant_id = a.tenant_id AND x.id = p_transfer FOR UPDATE;
  IF NOT FOUND OR t.kind <> 'inter' OR a.role = 'pharmacist' AND t.to_branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: transfer not found' USING ERRCODE = 'P0002';
  END IF;
  IF t.state <> 'sent' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: transfer %', t.state USING ERRCODE = '55000';
  END IF;
  SELECT * INTO d FROM public.depots x WHERE x.tenant_id = t.tenant_id AND x.branch_id = t.to_branch_id
     AND x.id = coalesce(p_depot, public.depot_default(t.tenant_id, t.to_branch_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT d.active THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the depot is inactive' USING ERRCODE = '55000';
  END IF;
  -- Destination batches: found or opened at 0, then locked in id order (P2-2).
  FOR l IN SELECT x.*, sb.batch_no, sb.expiry FROM public.depot_transfer_lines x JOIN public.stock_batches sb ON sb.tenant_id = x.tenant_id AND sb.id = x.source_batch_id
            WHERE x.tenant_id = t.tenant_id AND x.transfer_id = t.id ORDER BY x.source_batch_id LOOP
    SELECT b.id INTO v_batch FROM public.stock_batches b
     WHERE b.tenant_id = t.tenant_id AND b.branch_id = t.to_branch_id AND b.item_id = l.item_id AND b.batch_no = l.batch_no AND b.expiry = l.expiry;
    IF v_batch IS NULL THEN
      INSERT INTO public.stock_batches (tenant_id, branch_id, item_id, batch_no, expiry, quantity) VALUES (t.tenant_id, t.to_branch_id, l.item_id, l.batch_no, l.expiry, 0)
      RETURNING id INTO v_batch;
    END IF;
    UPDATE public.depot_transfer_lines SET destination_batch_id = v_batch WHERE tenant_id = l.tenant_id AND id = l.id;
  END LOOP;
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = t.tenant_id
     AND b.id IN (SELECT x.destination_batch_id FROM public.depot_transfer_lines x WHERE x.tenant_id = t.tenant_id AND x.transfer_id = t.id) ORDER BY b.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.depot_transfer_lines x JOIN public.stock_batches b ON b.tenant_id = x.tenant_id AND b.id = x.destination_batch_id
              WHERE x.tenant_id = t.tenant_id AND x.transfer_id = t.id AND b.state = 'recalled') THEN
    RAISE EXCEPTION 'ERR_STOCK_UNFIT: recalled' USING ERRCODE = 'P0422';
  END IF;
  FOR l IN SELECT * FROM public.depot_transfer_lines x WHERE x.tenant_id = t.tenant_id AND x.transfer_id = t.id ORDER BY x.destination_batch_id LOOP
    PERFORM public.stock_move_depot(t.tenant_id, l.destination_batch_id, d.id, 'transfer_in', l.quantity, NULL, 'depot_transfer', t.id, a.staff_id, a.role, 'in');
  END LOOP;
  UPDATE public.depot_transfers SET state = 'received', to_depot_id = d.id, closed_by = a.staff_id, closed_as = a.role, closed_at = clock_timestamp()
   WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.audit_append('settings_change', 'depot_transfer', t.id, 'success', 'stock_transfer_received');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (t.to_branch_id, 'StockTransferred', 'depot_transfer', t.id, jsonb_build_object('transfer_id', t.id, 'kind', 'inter', 'state', 'received'));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_transfer_receive(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_transfer_receive(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Cancel while sent: the in legs return the stock to the source batches in the source depot. Pharmacist at the
-- source branch, or purchasing.
CREATE FUNCTION public.branch_transfer_cancel(p_transfer uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'operations', NULL);
  t public.depot_transfers;
  l record;
BEGIN
  SELECT * INTO t FROM public.depot_transfers x WHERE x.tenant_id = a.tenant_id AND x.id = p_transfer FOR UPDATE;
  IF NOT FOUND OR t.kind <> 'inter' OR a.role = 'pharmacist' AND t.from_branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: transfer not found' USING ERRCODE = 'P0002';
  END IF;
  IF t.state <> 'sent' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: transfer %', t.state USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = t.tenant_id
     AND b.id IN (SELECT x.source_batch_id FROM public.depot_transfer_lines x WHERE x.tenant_id = t.tenant_id AND x.transfer_id = t.id) ORDER BY b.id FOR UPDATE;
  FOR l IN SELECT * FROM public.depot_transfer_lines x WHERE x.tenant_id = t.tenant_id AND x.transfer_id = t.id ORDER BY x.source_batch_id LOOP
    PERFORM public.stock_move_depot(t.tenant_id, l.source_batch_id, t.from_depot_id, 'transfer_in', l.quantity, NULL, 'depot_transfer', t.id, a.staff_id, a.role, 'in');
  END LOOP;
  UPDATE public.depot_transfers SET state = 'cancelled', closed_by = a.staff_id, closed_as = a.role, closed_at = clock_timestamp()
   WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.audit_append('settings_change', 'depot_transfer', t.id, 'success', 'stock_transfer_cancelled');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (t.from_branch_id, 'StockTransferred', 'depot_transfer', t.id, jsonb_build_object('transfer_id', t.id, 'kind', 'inter', 'state', 'cancelled'));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_transfer_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_transfer_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- ── T-060 writers made depot-aware (same signatures; P2-1) ──────────────────────────────────────────
-- Receive into p.depot_id (a depot of the branch) or the branch's default gudang.
CREATE OR REPLACE FUNCTION public.stock_receive_into(p_tenant uuid, p_staff uuid, p_role text, p_branch uuid, p jsonb, p_source_kind text, p_source uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.stock_items;
  v_expiry date;
  v_qty numeric;
  v_reason text := p ->> 'reason';
  v_batch uuid;
  v_depot uuid;
BEGIN
  BEGIN
    v_expiry := (p ->> 'expiry')::date;
    v_qty := (p ->> 'quantity')::numeric;
    v_depot := coalesce(NULLIF(p ->> 'depot_id', '')::uuid, public.depot_default(p_tenant, p_branch));
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: expiry or quantity' USING ERRCODE = '22023';
  END;
  IF NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = p_tenant AND d.branch_id = p_branch AND d.id = v_depot AND d.active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
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
  PERFORM public.stock_move_depot(p_tenant, v_batch, v_depot, 'receive', v_qty, v_reason, p_source_kind, p_source, p_staff, p_role, NULL);
  RETURN v_batch;
END
$$;--> statement-breakpoint

-- Buka Vial in a depot (internal; the actor checked by the caller): vial items only; the batch fit and held in the
-- depot; one open vial per (batch, depot); remaining = least(vial size, the depot's holding).
CREATE FUNCTION public.stock_vial_open_do(p_tenant uuid, p_branch uuid, p_staff uuid, p_role text, p_batch uuid, p_depot uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.stock_batches;
  i public.stock_items;
  v public.opened_vials;
  v_held numeric;
  v_id uuid;
BEGIN
  SELECT * INTO b FROM public.stock_batches x WHERE x.tenant_id = p_tenant AND x.id = p_batch FOR UPDATE;
  IF NOT FOUND OR b.branch_id <> p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = p_tenant AND d.branch_id = p_branch AND d.id = p_depot) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO i FROM public.stock_items x WHERE x.tenant_id = b.tenant_id AND x.id = b.item_id;
  IF i.vial_size IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: not a vial item' USING ERRCODE = '22023';
  END IF;
  IF public.stock_unfit_reason(b) IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_STOCK_UNFIT: %', public.stock_unfit_reason(b) USING ERRCODE = 'P0422';
  END IF;
  SELECT h.quantity INTO v_held FROM public.batch_holdings h WHERE h.tenant_id = p_tenant AND h.depot_id = p_depot AND h.batch_id = b.id FOR UPDATE;
  SELECT * INTO v FROM public.opened_vials x WHERE x.tenant_id = b.tenant_id AND x.batch_id = b.id AND x.depot_id = p_depot AND x.state = 'open' FOR UPDATE;
  IF FOUND THEN
    IF public.stock_vial_unfit(v) IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a vial of this batch is already open' USING ERRCODE = '55000';
    END IF;
    UPDATE public.opened_vials SET state = 'lapsed', closed_at = clock_timestamp() WHERE tenant_id = v.tenant_id AND id = v.id;
  END IF;
  IF coalesce(v_held, 0) <= 0 THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: the batch is empty' USING ERRCODE = 'P0422';
  END IF;
  INSERT INTO public.opened_vials (tenant_id, branch_id, batch_id, depot_id, opened_by, opened_as, use_by, remaining)
  VALUES (b.tenant_id, b.branch_id, b.id, p_depot, p_staff, p_role, clock_timestamp() + make_interval(hours => i.opened_use_hours), least(i.vial_size, v_held))
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'opened_vial', v_id, 'success', 'stock_vial_opened');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_vial_open_do(uuid, uuid, uuid, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.stock_vial_open(p_batch uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist'], 'operations', NULL);
BEGIN
  RETURN public.stock_vial_open_do(a.tenant_id, a.branch_id, a.staff_id, a.role, p_batch, public.depot_default(a.tenant_id, a.branch_id));
END
$$;--> statement-breakpoint

CREATE FUNCTION public.stock_vial_open_in(p_batch uuid, p_depot uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist'], 'operations', NULL);
BEGIN
  RETURN public.stock_vial_open_do(a.tenant_id, a.branch_id, a.staff_id, a.role, p_batch, p_depot);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_vial_open_in(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_vial_open_in(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Hitung Stok per holding (internal): a line per (batch, depot) holding stock, of the given items, in one depot or
-- all; a holding already in an open count is refused.
CREATE FUNCTION public.stock_count_start_do(p_tenant uuid, p_branch uuid, p_staff uuid, p_role text, p_blind boolean, p_items uuid[], p_depot uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
  v_n integer;
BEGIN
  IF p_blind IS NULL OR cardinality(p_items) > 200 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: count' USING ERRCODE = '22023';
  END IF;
  IF p_depot IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = p_tenant AND d.branch_id = p_branch AND d.id = p_depot) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.stock_counts (tenant_id, branch_id, blind, started_by, started_as) VALUES (p_tenant, p_branch, p_blind, p_staff, p_role)
  RETURNING id INTO v_id;
  PERFORM 1 FROM public.stock_batches b
   WHERE b.tenant_id = p_tenant AND b.branch_id = p_branch AND (p_items IS NULL OR cardinality(p_items) = 0 OR b.item_id = ANY (p_items))
     AND b.state <> 'recalled' AND b.quantity > 0
   ORDER BY b.id FOR UPDATE;
  PERFORM 1 FROM public.batch_holdings h JOIN public.stock_batches b ON b.tenant_id = h.tenant_id AND b.id = h.batch_id
   WHERE h.tenant_id = p_tenant AND h.branch_id = p_branch AND (p_depot IS NULL OR h.depot_id = p_depot)
     AND (p_items IS NULL OR cardinality(p_items) = 0 OR h.item_id = ANY (p_items)) AND b.state <> 'recalled' AND h.quantity > 0
   ORDER BY h.id FOR UPDATE OF h;
  IF EXISTS (SELECT 1 FROM public.stock_count_lines l JOIN public.stock_counts c ON c.tenant_id = l.tenant_id AND c.id = l.count_id
             WHERE l.tenant_id = p_tenant AND c.branch_id = p_branch AND c.state IN ('draft','pending_approval') AND c.id <> v_id
               AND (p_depot IS NULL OR l.depot_id = p_depot)
               AND (p_items IS NULL OR cardinality(p_items) = 0 OR l.item_id = ANY (p_items))) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a batch is already in an open count' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.stock_count_lines (tenant_id, branch_id, count_id, item_id, batch_id, depot_id, system_qty)
  SELECT h.tenant_id, h.branch_id, v_id, h.item_id, h.batch_id, h.depot_id, h.quantity
    FROM public.batch_holdings h JOIN public.stock_batches b ON b.tenant_id = h.tenant_id AND b.id = h.batch_id
   WHERE h.tenant_id = p_tenant AND h.branch_id = p_branch AND (p_depot IS NULL OR h.depot_id = p_depot)
     AND (p_items IS NULL OR cardinality(p_items) = 0 OR h.item_id = ANY (p_items)) AND b.state <> 'recalled' AND h.quantity > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no stock to count' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('settings_change', 'stock_count', v_id, 'success', 'stock_count_started');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_start_do(uuid, uuid, uuid, text, boolean, uuid[], uuid) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.stock_count_start(p_blind boolean, p_items uuid[]) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','manager'], 'operations', NULL);
BEGIN
  RETURN public.stock_count_start_do(a.tenant_id, a.branch_id, a.staff_id, a.role, p_blind, p_items, NULL);
END
$$;--> statement-breakpoint

CREATE FUNCTION public.stock_count_start_in(p_blind boolean, p_items uuid[], p_depot uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','manager'], 'operations', NULL);
BEGIN
  IF p_depot IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: depot' USING ERRCODE = '22023';
  END IF;
  RETURN public.stock_count_start_do(a.tenant_id, a.branch_id, a.staff_id, a.role, p_blind, p_items, p_depot);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_count_start_in(boolean, uuid[], uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_count_start_in(boolean, uuid[], uuid) TO clinic_app;--> statement-breakpoint

-- Unmoved per (batch, depot): the batches locked in id order, then the holdings; a holding off its snapshot or a
-- movement on (batch, depot) after the count started refuses.
CREATE OR REPLACE FUNCTION public.stock_count_check_unmoved(c public.stock_counts) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = c.tenant_id
     AND b.id IN (SELECT l.batch_id FROM public.stock_count_lines l WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id)
   ORDER BY b.id FOR UPDATE;
  PERFORM 1 FROM public.batch_holdings h JOIN public.stock_count_lines l ON l.tenant_id = h.tenant_id AND l.batch_id = h.batch_id AND l.depot_id = h.depot_id
   WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id ORDER BY h.id FOR UPDATE OF h;
  IF EXISTS (SELECT 1 FROM public.stock_count_lines l LEFT JOIN public.batch_holdings h ON h.tenant_id = l.tenant_id AND h.batch_id = l.batch_id AND h.depot_id = l.depot_id
              WHERE l.tenant_id = c.tenant_id AND l.count_id = c.id
                AND (coalesce(h.quantity, 0) <> l.system_qty OR EXISTS (SELECT 1 FROM public.stock_movements m
                                                            WHERE m.tenant_id = l.tenant_id AND m.batch_id = l.batch_id AND m.depot_id = l.depot_id AND m.created_at > c.started_at))) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: stock moved since the count started' USING ERRCODE = '55000';
  END IF;
END
$$;--> statement-breakpoint

-- One adjust movement per line with a difference, on the line's depot (r2 note).
CREATE OR REPLACE FUNCTION public.stock_count_apply(c public.stock_counts, p_by uuid, p_as text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l record;
BEGIN
  FOR l IN SELECT * FROM public.stock_count_lines x WHERE x.tenant_id = c.tenant_id AND x.count_id = c.id AND x.counted_qty <> x.system_qty ORDER BY x.batch_id, x.depot_id LOOP
    PERFORM public.stock_move_depot(c.tenant_id, l.batch_id, l.depot_id, 'adjust', l.counted_qty - l.system_qty, c.reason, 'stock_count', c.id, p_by, p_as, NULL);
  END LOOP;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (c.tenant_id, c.branch_id, 'StockAdjusted', 'stock_count', c.id, jsonb_build_object('count_id', c.id));
END
$$;--> statement-breakpoint

-- ── Readers (definers; stock readers as T-060) ─────────────────────────────────────────────────────
-- Depots of a branch with their holdings (quantity per item) and the open vials.
CREATE FUNCTION public.depot_list(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'kind', d.kind, 'room_id', d.room_id, 'is_default', d.is_default, 'active', d.active,
             'batches', (SELECT count(*) FROM public.batch_holdings h WHERE h.tenant_id = d.tenant_id AND h.depot_id = d.id AND h.quantity > 0),
             'open_vials', (SELECT count(*) FROM public.opened_vials v WHERE v.tenant_id = d.tenant_id AND v.depot_id = d.id AND v.state = 'open'))
           ORDER BY NOT d.is_default, d.name, d.id)
      FROM public.depots d WHERE d.tenant_id = a.tenant_id AND d.branch_id = v_branch), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.depot_list(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.depot_list(uuid) TO clinic_app;--> statement-breakpoint

-- One depot: its holdings by item and batch (FEFO order), each with fitness and that depot's open vial.
CREATE FUNCTION public.depot_get(p_depot uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  d public.depots;
BEGIN
  SELECT * INTO d FROM public.depots x WHERE x.tenant_id = a.tenant_id AND x.id = p_depot;
  IF NOT FOUND OR NOT public.stock_readable(d.tenant_id, d.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('id', d.id, 'branch_id', d.branch_id, 'name', d.name, 'kind', d.kind, 'room_id', d.room_id, 'is_default', d.is_default, 'active', d.active,
    'holdings', coalesce((
      SELECT jsonb_agg(jsonb_build_object('item_id', h.item_id, 'name', lb.name, 'unit', i.unit, 'batch_id', b.id, 'batch_no', b.batch_no, 'expiry', b.expiry,
               'quantity', h.quantity, 'unfit', public.stock_unfit_reason(b),
               'vial', (SELECT jsonb_build_object('id', v.id, 'remaining', v.remaining, 'use_by', v.use_by, 'lapsed', public.stock_vial_unfit(v) IS NOT NULL)
                          FROM public.opened_vials v WHERE v.tenant_id = h.tenant_id AND v.depot_id = h.depot_id AND v.batch_id = h.batch_id AND v.state = 'open'))
             ORDER BY lb.name, b.expiry, b.received_at, b.id)
        FROM public.batch_holdings h JOIN public.stock_batches b ON b.tenant_id = h.tenant_id AND b.id = h.batch_id
        JOIN public.stock_items i ON i.tenant_id = h.tenant_id AND i.id = h.item_id
        CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
       WHERE h.tenant_id = d.tenant_id AND h.depot_id = d.id AND h.quantity > 0), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.depot_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.depot_get(uuid) TO clinic_app;--> statement-breakpoint

-- One transfer as JSON (both branches' readers).
CREATE FUNCTION public.transfer_json(t public.depot_transfers) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', t.id, 'kind', t.kind, 'state', t.state, 'from_branch_id', t.from_branch_id, 'to_branch_id', t.to_branch_id,
    'from_depot_id', t.from_depot_id, 'to_depot_id', t.to_depot_id,
    'from_branch', (SELECT b.name FROM public.branches b WHERE b.tenant_id = t.tenant_id AND b.id = t.from_branch_id),
    'to_branch', (SELECT b.name FROM public.branches b WHERE b.tenant_id = t.tenant_id AND b.id = t.to_branch_id),
    'from_depot', (SELECT d.name FROM public.depots d WHERE d.tenant_id = t.tenant_id AND d.id = t.from_depot_id),
    'to_depot', (SELECT d.name FROM public.depots d WHERE d.tenant_id = t.tenant_id AND d.id = t.to_depot_id),
    'created_at', t.created_at, 'created_as', t.created_as,
    'created_by_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = t.tenant_id AND s.id = t.created_by),
    'closed_at', t.closed_at, 'closed_as', t.closed_as,
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'name', lb.name, 'unit', i.unit, 'source_batch_id', l.source_batch_id,
                         'destination_batch_id', l.destination_batch_id, 'batch_no', sb.batch_no, 'expiry', sb.expiry, 'quantity', l.quantity) ORDER BY lb.name, sb.batch_no, l.id)
                         FROM public.depot_transfer_lines l JOIN public.stock_batches sb ON sb.tenant_id = l.tenant_id AND sb.id = l.source_batch_id
                         JOIN public.stock_items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
                         CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
                        WHERE l.tenant_id = t.tenant_id AND l.transfer_id = t.id), '[]'::jsonb))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.transfer_json(public.depot_transfers) FROM PUBLIC;--> statement-breakpoint

-- Transfers touching a branch (sent from or to it), newest first: open ones (sent) always, closed ones 60 days.
CREATE FUNCTION public.transfer_list(p_branch uuid, p_state text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
BEGIN
  IF p_state IS NOT NULL AND p_state NOT IN ('posted','sent','received','cancelled') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: state' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.transfer_json(t) ORDER BY t.created_at DESC, t.id)
      FROM public.depot_transfers t
     WHERE t.tenant_id = a.tenant_id AND (t.from_branch_id = v_branch OR t.to_branch_id = v_branch)
       AND (p_state IS NULL OR t.state = p_state)
       AND (t.state = 'sent' OR t.created_at > clock_timestamp() - interval '60 days')), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.transfer_list(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.transfer_list(uuid, text) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.transfer_get(p_transfer uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  t public.depot_transfers;
BEGIN
  SELECT * INTO t FROM public.depot_transfers x WHERE x.tenant_id = a.tenant_id AND x.id = p_transfer;
  IF NOT FOUND OR NOT public.transfer_readable(t.tenant_id, t.from_branch_id, t.to_branch_id)
     OR a.role IN ('manager','pharmacist') AND a.branch_id NOT IN (t.from_branch_id, t.to_branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: transfer not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.transfer_json(t);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.transfer_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.transfer_get(uuid) TO clinic_app;--> statement-breakpoint

-- T-060's item page (same signature; r2 note): `vial` stays one object (the earliest use-by open vial of the batch)
-- and `vials` lists every open vial with its depot (P1-2: one per depot now).
CREATE OR REPLACE FUNCTION public.stock_item_get(p_item uuid, p_branch uuid) RETURNS jsonb
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
                          FROM public.opened_vials v WHERE v.tenant_id = b.tenant_id AND v.batch_id = b.id AND v.state = 'open' ORDER BY v.use_by, v.id LIMIT 1),
               'vials', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'depot_id', v.depot_id, 'remaining', v.remaining, 'opened_at', v.opened_at,
                                                    'use_by', v.use_by, 'lapsed', public.stock_vial_unfit(v) IS NOT NULL) ORDER BY v.use_by, v.id)
                                  FROM public.opened_vials v WHERE v.tenant_id = b.tenant_id AND v.batch_id = b.id AND v.state = 'open'), '[]'::jsonb),
               'holdings', coalesce((SELECT jsonb_agg(jsonb_build_object('depot_id', h.depot_id, 'quantity', h.quantity) ORDER BY h.depot_id)
                                     FROM public.batch_holdings h WHERE h.tenant_id = b.tenant_id AND h.batch_id = b.id AND h.quantity > 0), '[]'::jsonb))
             ORDER BY b.expiry, b.received_at, b.id)
        FROM public.stock_batches b WHERE b.tenant_id = i.tenant_id AND b.branch_id = v_branch AND b.item_id = i.id), '[]'::jsonb));
END
$$;
