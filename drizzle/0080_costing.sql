CREATE TABLE "stock_costs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric DEFAULT '0' NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"uncosted_quantity" numeric DEFAULT '0' NOT NULL,
	"last_unit_cost" numeric,
	"last_seq" bigint,
	CONSTRAINT "stock_costs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_costs_item_key" UNIQUE("tenant_id","branch_id","item_id"),
	CONSTRAINT "stock_costs_check" CHECK ("stock_costs"."quantity" between 0 and 1000000000000 and scale("stock_costs"."quantity") <= 4 and "stock_costs"."uncosted_quantity" between 0 and 1000000000000 and scale("stock_costs"."uncosted_quantity") <= 4 and "stock_costs"."uncosted_quantity" <= "stock_costs"."quantity"
      and "stock_costs"."value" between 0 and 1000000000000000000 and ("stock_costs"."quantity" > "stock_costs"."uncosted_quantity" or "stock_costs"."value" = 0)
      and ("stock_costs"."last_unit_cost" is null or "stock_costs"."last_unit_cost" between 0 and 1000000000 and scale("stock_costs"."last_unit_cost") <= 4))
);
--> statement-breakpoint
CREATE TABLE "stock_movement_values" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"quantity" numeric NOT NULL,
	"value" bigint NOT NULL,
	"uncosted_qty" numeric NOT NULL,
	"unit_cost" numeric,
	"quantity_after" numeric NOT NULL,
	"value_after" bigint NOT NULL,
	"uncosted_after" numeric NOT NULL,
	CONSTRAINT "stock_movement_values_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_movement_values_movement_key" UNIQUE("tenant_id","movement_id"),
	CONSTRAINT "stock_movement_values_check" CHECK ("stock_movement_values"."quantity" between -1000000000 and 1000000000 and scale("stock_movement_values"."quantity") <= 4 and "stock_movement_values"."quantity" <> 0
      and "stock_movement_values"."uncosted_qty" between -1000000000 and 1000000000 and scale("stock_movement_values"."uncosted_qty") <= 4 and abs("stock_movement_values"."uncosted_qty") <= abs("stock_movement_values"."quantity") and sign("stock_movement_values"."uncosted_qty") in (0, sign("stock_movement_values"."quantity"))
      and "stock_movement_values"."value" between -1000000000000000000 and 1000000000000000000 and sign("stock_movement_values"."value") in (0, sign("stock_movement_values"."quantity"))
      and ("stock_movement_values"."unit_cost" is null or "stock_movement_values"."unit_cost" between 0 and 1000000000 and scale("stock_movement_values"."unit_cost") <= 4)
      and "stock_movement_values"."quantity_after" between 0 and 1000000000000 and scale("stock_movement_values"."quantity_after") <= 4 and "stock_movement_values"."uncosted_after" between 0 and 1000000000000 and scale("stock_movement_values"."uncosted_after") <= 4 and "stock_movement_values"."uncosted_after" <= "stock_movement_values"."quantity_after"
      and "stock_movement_values"."value_after" between 0 and 1000000000000000000 and ("stock_movement_values"."quantity_after" > "stock_movement_values"."uncosted_after" or "stock_movement_values"."value_after" = 0))
);
--> statement-breakpoint
CREATE TABLE "stock_receipt_costs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"unit_cost" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "stock_receipt_costs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_receipt_costs_source_key" UNIQUE("tenant_id","source_kind","source_id","item_id"),
	CONSTRAINT "stock_receipt_costs_check" CHECK ("stock_receipt_costs"."unit_cost" between 0 and 1000000000 and "stock_receipt_costs"."source_kind" ~ '^[a-z][a-z_]{1,40}$'
      and "stock_receipt_costs"."created_as" in ('pharmacist','purchasing'))
);
--> statement-breakpoint
ALTER TABLE "stock_costs" ADD CONSTRAINT "stock_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_costs" ADD CONSTRAINT "stock_costs_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_costs" ADD CONSTRAINT "stock_costs_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_values" ADD CONSTRAINT "stock_movement_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_values" ADD CONSTRAINT "stock_movement_values_movement_fk" FOREIGN KEY ("tenant_id","movement_id") REFERENCES "public"."stock_movements"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_values" ADD CONSTRAINT "stock_movement_values_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_values" ADD CONSTRAINT "stock_movement_values_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_costs" ADD CONSTRAINT "stock_receipt_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_costs" ADD CONSTRAINT "stock_receipt_costs_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_costs" ADD CONSTRAINT "stock_receipt_costs_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_costs" ADD CONSTRAINT "stock_receipt_costs_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movement_values_item_idx" ON "stock_movement_values" USING btree ("tenant_id","branch_id","item_id","seq");--> statement-breakpoint

-- T-063 rules (generated by gen.py; plan docs/tasks/T-063.md)
-- ── Readers (open point 6): tenant-wide money roles and the manager at their branch, on the wall clock ───────────
CREATE FUNCTION public.stock_cost_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
    public.app_role_in(ARRAY['owner','admin_pusat','finance','purchasing','auditor'])
    OR public.app_role_in(ARRAY['manager']) AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_cost_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_cost_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- ── Backfill (open point 4): existing stock is uncosted ─────────────────────────────────────────────────────────
-- Every existing movement gets a value row (value 0, all units uncosted) with running afters per (branch, item) by
-- seq, and every (branch, item) with movements a cost row at its last afters. No movement is written (DATA-58). The
-- guards are created after this part.
INSERT INTO public.stock_movement_values (tenant_id, branch_id, item_id, movement_id, seq, quantity, value, uncosted_qty, unit_cost,
                                          quantity_after, value_after, uncosted_after)
SELECT m.tenant_id, m.branch_id, m.item_id, m.id, m.seq, m.quantity, 0, m.quantity, NULL,
       sum(m.quantity) OVER w, 0, sum(m.quantity) OVER w
  FROM public.stock_movements m
WINDOW w AS (PARTITION BY m.tenant_id, m.branch_id, m.item_id ORDER BY m.seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);--> statement-breakpoint
INSERT INTO public.stock_costs (tenant_id, branch_id, item_id, quantity, value, uncosted_quantity, last_unit_cost, last_seq)
SELECT DISTINCT ON (v.tenant_id, v.branch_id, v.item_id) v.tenant_id, v.branch_id, v.item_id, v.quantity_after, 0, v.uncosted_after, NULL, v.seq
  FROM public.stock_movement_values v
 ORDER BY v.tenant_id, v.branch_id, v.item_id, v.seq DESC;--> statement-breakpoint

ALTER TABLE public.stock_costs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_costs_read ON public.stock_costs FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.stock_costs TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_costs_operator_read ON public.stock_costs FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_costs', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_costs TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_costs_no_truncate BEFORE TRUNCATE ON public.stock_costs FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_costs ENABLE ALWAYS TRIGGER stock_costs_no_truncate;--> statement-breakpoint
ALTER TABLE public.stock_movement_values ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_movement_values_read ON public.stock_movement_values FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.stock_movement_values TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_movement_values_operator_read ON public.stock_movement_values FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_movement_values', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_movement_values TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_movement_values_no_truncate BEFORE TRUNCATE ON public.stock_movement_values FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_movement_values ENABLE ALWAYS TRIGGER stock_movement_values_no_truncate;--> statement-breakpoint
ALTER TABLE public.stock_receipt_costs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_receipt_costs_read ON public.stock_receipt_costs FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.stock_receipt_costs TO clinic_app;--> statement-breakpoint
CREATE POLICY stock_receipt_costs_operator_read ON public.stock_receipt_costs FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.stock_receipt_costs', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.stock_receipt_costs TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER stock_receipt_costs_no_truncate BEFORE TRUNCATE ON public.stock_receipt_costs FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.stock_receipt_costs ENABLE ALWAYS TRIGGER stock_receipt_costs_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.stock_costs', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'costing trigger and definers (src/modules/inventory/costing)', 'the branch whose inventory is valued'),
  ('public.stock_movement_values', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'costing trigger and definers (src/modules/inventory/costing)', 'the movement''s branch'),
  ('public.stock_receipt_costs', 'branch-scoped', 'inventory', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'costing trigger and definers (src/modules/inventory/costing)', 'the receiving branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): cost and value rows are money totals; receipt costs carry staff attribution.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.stock_costs', 'money_total'),
  ('public.stock_movement_values', 'money_total'),
  ('public.stock_receipt_costs', 'personal');--> statement-breakpoint

-- ── Valuation (open points 1, 2; review notes P2-1, P2-2) ──────────────────────────────────────────────────────
-- AFTER INSERT on stock_movements, after stock_movements_apply (trigger order is by name), ENABLE ALWAYS. One value
-- row per movement, then the (branch, item) cost row moves to its afters. Money in integer rupiah; the average is a
-- rate over the costed units. No 0077/0078/0079 function or trigger is re-created.
--   in leg (issue, return, transfer_in): exactly the matched out leg's value and uncosted units (same source, leg
--     out, kind transfer_out for transfer_in else the same kind, quantity −q, a batch of the same item, batch number
--     and expiry) — intra-branch pairs leave the branch unchanged (BILL-35), inter-branch legs move the same value.
--   outflow (q < 0: consume, waste, dispense, supplier_return, adjust < 0, out legs): costed units leave first,
--     valued round(value × costed_out / costed), the whole value when the last costed unit leaves; the rest are
--     uncosted units at 0.
--   inflow without a leg (receive, adjust > 0): the receipt's unit cost (stock_receipt_costs by source and item),
--     else the last average, else uncosted at 0.
CREATE FUNCTION public.stock_movements_value() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.stock_costs;
  mo record;
  v_value bigint;
  v_unc numeric;
  v_unit numeric;
  v_costed numeric;
  v_costed_out numeric;
  v_qa numeric;
  v_va bigint;
  v_ua numeric;
BEGIN
  INSERT INTO public.stock_costs (tenant_id, branch_id, item_id) VALUES (NEW.tenant_id, NEW.branch_id, NEW.item_id)
    ON CONFLICT (tenant_id, branch_id, item_id) DO NOTHING;
  SELECT * INTO c FROM public.stock_costs x WHERE x.tenant_id = NEW.tenant_id AND x.branch_id = NEW.branch_id AND x.item_id = NEW.item_id FOR UPDATE;
  IF NEW.leg = 'in' THEN
    SELECT mv.value, mv.uncosted_qty, mv.unit_cost INTO mo
      FROM public.stock_movements m
      JOIN public.stock_batches bo ON bo.tenant_id = m.tenant_id AND bo.id = m.batch_id
      JOIN public.stock_batches bi ON bi.tenant_id = NEW.tenant_id AND bi.id = NEW.batch_id
      JOIN public.stock_movement_values mv ON mv.tenant_id = m.tenant_id AND mv.movement_id = m.id
     WHERE m.tenant_id = NEW.tenant_id AND m.source_kind = NEW.source_kind AND m.source_id = NEW.source_id AND m.leg = 'out'
       AND m.kind = CASE WHEN NEW.kind = 'transfer_in' THEN 'transfer_out' ELSE NEW.kind END AND m.quantity = -NEW.quantity
       AND bo.item_id = bi.item_id AND bo.batch_no = bi.batch_no AND bo.expiry = bi.expiry;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'an in leg follows its valued out leg' USING ERRCODE = '42501';
    END IF;
    v_value := -mo.value;
    v_unc := -mo.uncosted_qty;
    v_unit := mo.unit_cost;
  ELSIF NEW.quantity < 0 THEN
    v_costed := c.quantity - c.uncosted_quantity;
    v_costed_out := least(-NEW.quantity, v_costed);
    v_value := CASE WHEN v_costed_out = 0 THEN 0
                    WHEN v_costed_out = v_costed THEN -c.value
                    ELSE -round(c.value::numeric * v_costed_out / v_costed)::bigint END;
    v_unc := -(-NEW.quantity - v_costed_out);
    v_unit := CASE WHEN v_costed > 0 THEN round(c.value::numeric / v_costed, 4) END;
  ELSE
    v_unit := (SELECT rc.unit_cost FROM public.stock_receipt_costs rc
                WHERE NEW.kind = 'receive' AND rc.tenant_id = NEW.tenant_id AND rc.source_kind = NEW.source_kind AND rc.source_id = NEW.source_id AND rc.item_id = NEW.item_id);
    v_unit := coalesce(v_unit, c.last_unit_cost);
    v_value := CASE WHEN v_unit IS NULL THEN 0 ELSE round(NEW.quantity * v_unit)::bigint END;
    v_unc := CASE WHEN v_unit IS NULL THEN NEW.quantity ELSE 0 END;
  END IF;
  v_qa := c.quantity + NEW.quantity;
  v_va := c.value + v_value;
  v_ua := c.uncosted_quantity + v_unc;
  INSERT INTO public.stock_movement_values (tenant_id, branch_id, item_id, movement_id, seq, quantity, value, uncosted_qty, unit_cost,
                                            quantity_after, value_after, uncosted_after)
  VALUES (NEW.tenant_id, NEW.branch_id, NEW.item_id, NEW.id, NEW.seq, NEW.quantity, v_value, v_unc, v_unit, v_qa, v_va, v_ua);
  UPDATE public.stock_costs SET quantity = v_qa, value = v_va, uncosted_quantity = v_ua, last_seq = NEW.seq,
         last_unit_cost = CASE WHEN v_qa > v_ua THEN round(v_va::numeric / (v_qa - v_ua), 4) ELSE last_unit_cost END
   WHERE tenant_id = c.tenant_id AND id = c.id;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_movements_value() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_movements_value AFTER INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.stock_movements_value();--> statement-breakpoint
ALTER TABLE public.stock_movements ENABLE ALWAYS TRIGGER stock_movements_value;--> statement-breakpoint

-- Value rows: insert-only; for the newest movement of its (branch, item), copying the movement; the befores are the
-- cost row now (afters − deltas); an in leg carries exactly its out leg's value and uncosted units.
CREATE FUNCTION public.stock_movement_values_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  m public.stock_movements;
  c public.stock_costs;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'movement values are never changed or deleted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.stock_movements x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.movement_id;
  IF NOT FOUND OR (m.branch_id, m.item_id, m.quantity, m.seq) IS DISTINCT FROM (NEW.branch_id, NEW.item_id, NEW.quantity, NEW.seq)
     OR EXISTS (SELECT 1 FROM public.stock_movements x WHERE x.tenant_id = NEW.tenant_id AND x.branch_id = NEW.branch_id AND x.item_id = NEW.item_id AND x.seq > NEW.seq) THEN
    RAISE EXCEPTION 'a value row values the newest movement of its item' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.stock_costs x WHERE x.tenant_id = NEW.tenant_id AND x.branch_id = NEW.branch_id AND x.item_id = NEW.item_id;
  IF NOT FOUND OR (c.quantity + NEW.quantity, c.value + NEW.value, c.uncosted_quantity + NEW.uncosted_qty)
                   IS DISTINCT FROM (NEW.quantity_after, NEW.value_after, NEW.uncosted_after) THEN
    RAISE EXCEPTION 'a value row continues its item''s cost' USING ERRCODE = '42501';
  END IF;
  IF m.leg = 'in' AND NOT EXISTS (
       SELECT 1 FROM public.stock_movements o
         JOIN public.stock_batches bo ON bo.tenant_id = o.tenant_id AND bo.id = o.batch_id
         JOIN public.stock_batches bi ON bi.tenant_id = m.tenant_id AND bi.id = m.batch_id
         JOIN public.stock_movement_values ov ON ov.tenant_id = o.tenant_id AND ov.movement_id = o.id
        WHERE o.tenant_id = m.tenant_id AND o.source_kind = m.source_kind AND o.source_id = m.source_id AND o.leg = 'out'
          AND o.kind = CASE WHEN m.kind = 'transfer_in' THEN 'transfer_out' ELSE m.kind END AND o.quantity = -m.quantity
          AND bo.item_id = bi.item_id AND bo.batch_no = bi.batch_no AND bo.expiry = bi.expiry
          AND ov.value = -NEW.value AND ov.uncosted_qty = -NEW.uncosted_qty) THEN
    RAISE EXCEPTION 'an in leg carries its out leg''s value' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_movement_values_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_movement_values_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movement_values FOR EACH ROW EXECUTE FUNCTION public.stock_movement_values_guard();--> statement-breakpoint
ALTER TABLE public.stock_movement_values ENABLE ALWAYS TRIGGER stock_movement_values_guard;--> statement-breakpoint

-- Cost rows: never deleted; open at zero; change only to the afters of the newest value row of their item, once
-- (last_seq advances), the quantity equal to the item's batches at the branch, the last unit cost as the trigger sets.
CREATE FUNCTION public.stock_costs_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.stock_movement_values;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock costs are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF (NEW.quantity, NEW.value, NEW.uncosted_quantity) IS DISTINCT FROM (0::numeric, 0::bigint, 0::numeric) OR NEW.last_unit_cost IS NOT NULL OR NEW.last_seq IS NOT NULL THEN
      RAISE EXCEPTION 'a cost row opens at zero' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v FROM public.stock_movement_values x WHERE x.tenant_id = NEW.tenant_id AND x.branch_id = NEW.branch_id AND x.item_id = NEW.item_id
   ORDER BY x.seq DESC LIMIT 1;
  IF NOT FOUND OR (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.item_id) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.item_id)
     OR NEW.last_seq IS DISTINCT FROM v.seq OR OLD.last_seq IS NOT DISTINCT FROM v.seq
     OR (NEW.quantity, NEW.value, NEW.uncosted_quantity) IS DISTINCT FROM (v.quantity_after, v.value_after, v.uncosted_after)
     OR (OLD.quantity, OLD.value, OLD.uncosted_quantity) IS DISTINCT FROM (v.quantity_after - v.quantity, v.value_after - v.value, v.uncosted_after - v.uncosted_qty)
     OR NEW.quantity <> coalesce((SELECT sum(b.quantity) FROM public.stock_batches b WHERE b.tenant_id = NEW.tenant_id AND b.branch_id = NEW.branch_id AND b.item_id = NEW.item_id), 0)
     OR NEW.last_unit_cost IS DISTINCT FROM (CASE WHEN NEW.quantity > NEW.uncosted_quantity THEN round(NEW.value::numeric / (NEW.quantity - NEW.uncosted_quantity), 4) ELSE OLD.last_unit_cost END) THEN
    RAISE EXCEPTION 'a cost row changes only by its newest movement value' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_costs_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_costs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_costs FOR EACH ROW EXECUTE FUNCTION public.stock_costs_guard();--> statement-breakpoint
ALTER TABLE public.stock_costs ENABLE ALWAYS TRIGGER stock_costs_guard;--> statement-breakpoint

CREATE FUNCTION public.stock_receipt_costs_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'receipt costs are never changed or deleted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_receipt_costs_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER stock_receipt_costs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_receipt_costs FOR EACH ROW EXECUTE FUNCTION public.stock_receipt_costs_guard();--> statement-breakpoint
ALTER TABLE public.stock_receipt_costs ENABLE ALWAYS TRIGGER stock_receipt_costs_guard;--> statement-breakpoint

-- ── Costed receipt (open point 3): stock_receive plus a unit cost in integer rupiah ─────────────────────────────
-- The cost row is written first under the receipt's source; the valuation trigger reads it. T-060's stock_receive
-- (no cost) is unchanged: its receipts are valued at the last average or uncosted. p: stock_receive's payload +
-- unit_cost (a JSON integer, 0..1,000,000,000).
CREATE FUNCTION public.stock_receive_costed(p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'operations', p_branch);
  v_source uuid := public.uuid_generate_v7();
  v_item uuid;
  v_batch uuid;
BEGIN
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p -> 'unit_cost') IS DISTINCT FROM 'number' OR (p ->> 'unit_cost') !~ '^[0-9]{1,10}$'
     OR (p ->> 'unit_cost')::bigint > 1000000000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: unit cost' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_item := NULLIF(p ->> 'item_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: item' USING ERRCODE = '22023';
  END;
  IF NOT EXISTS (SELECT 1 FROM public.stock_items i WHERE i.tenant_id = a.tenant_id AND i.id = v_item) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.stock_receipt_costs (tenant_id, branch_id, item_id, source_kind, source_id, unit_cost, created_by, created_as)
  VALUES (a.tenant_id, a.branch_id, v_item, 'stock_receipt', v_source, (p ->> 'unit_cost')::bigint, a.staff_id, a.role);
  v_batch := public.stock_receive_into(a.tenant_id, a.staff_id, a.role, a.branch_id, p - 'unit_cost', 'stock_receipt', v_source);
  PERFORM public.audit_append('settings_change', 'stock_batch', v_batch, 'success', 'stock_received');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'StockReceived', 'stock_batch', v_batch, jsonb_build_object('batch_id', v_batch, 'reason', p ->> 'reason'));
  RETURN v_batch;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_receive_costed(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_receive_costed(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── Readers (open point 6): owner, admin pusat, finance, purchasing, auditor (any branch, named), manager (own) ──
CREATE FUNCTION public.stock_cost_reader(p_branch uuid, OUT tenant_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','finance','purchasing','auditor','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read stock value' USING ERRCODE = '42501';
  END IF;
  tenant_id := a.tenant_id;
  role := a.role;
  branch_id := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
  IF NOT public.stock_cost_readable(tenant_id, branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_cost_reader(uuid) FROM PUBLIC;--> statement-breakpoint

-- Inventory value per item at a branch: quantity, value, average over costed units, uncosted units.
CREATE FUNCTION public.stock_cost_list(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_cost_reader(p_branch);
BEGIN
  RETURN jsonb_build_object('branch_id', a.branch_id,
    'total_value', coalesce((SELECT sum(c.value) FROM public.stock_costs c WHERE c.tenant_id = a.tenant_id AND c.branch_id = a.branch_id), 0),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object('item_id', c.item_id, 'code', lb.code, 'name', lb.name, 'unit', i.unit, 'quantity', c.quantity, 'value', c.value,
               'average', CASE WHEN c.quantity > c.uncosted_quantity THEN round(c.value::numeric / (c.quantity - c.uncosted_quantity), 4) END,
               'last_unit_cost', c.last_unit_cost, 'uncosted_quantity', c.uncosted_quantity) ORDER BY lb.name, c.item_id)
        FROM public.stock_costs c JOIN public.stock_items i ON i.tenant_id = c.tenant_id AND i.id = c.item_id
        CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
       WHERE c.tenant_id = a.tenant_id AND c.branch_id = a.branch_id AND (c.quantity > 0 OR c.value > 0)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_cost_list(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_cost_list(uuid) TO clinic_app;--> statement-breakpoint

-- Valued movements of an item at a branch, newest first (kind, quantity, value, unit cost, afters; no reason, no
-- source id: patient-linked kinds stay masked for every reader of this money view).
CREATE FUNCTION public.stock_movement_value_list(p_item uuid, p_branch uuid, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_cost_reader(p_branch);
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: limit' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_items i WHERE i.tenant_id = a.tenant_id AND i.id = p_item) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x.j ORDER BY x.s DESC) FROM (
      SELECT v.seq AS s, jsonb_build_object('movement_id', v.movement_id, 'kind', m.kind, 'leg', m.leg, 'created_at', m.created_at,
               'quantity', v.quantity, 'value', v.value, 'uncosted_quantity', v.uncosted_qty, 'unit_cost', v.unit_cost,
               'quantity_after', v.quantity_after, 'value_after', v.value_after, 'uncosted_after', v.uncosted_after) AS j
        FROM public.stock_movement_values v JOIN public.stock_movements m ON m.tenant_id = v.tenant_id AND m.id = v.movement_id
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = a.branch_id AND v.item_id = p_item
       ORDER BY v.seq DESC LIMIT p_limit) x), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stock_movement_value_list(uuid, uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.stock_movement_value_list(uuid, uuid, integer) TO clinic_app;--> statement-breakpoint

-- ── T-062 defect found by T-063 (verified, reproduced alone): material_consume read v_x.batch_id in a CASE while v_x
-- was unassigned (lines omitted) — the first such call on a connection fails. Re-created with the same signature,
-- attributes and grants; only the assignment changes.
CREATE OR REPLACE FUNCTION public.material_consume(p_key text, p_request uuid, p jsonb) RETURNS uuid
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
    -- T-063 fix: never read a field of an unassigned record (a CASE evaluates it on a fresh connection: "record v_x is not
    -- assigned yet" when lines are omitted).
    IF v_found THEN
      v_batch := v_x.batch_id;
      v_qty := v_x.quantity;
    ELSE
      v_batch := NULL;
      v_qty := (SELECT coalesce(sum(g.free), 0) FROM public.material_batch_ledger(a.tenant_id, r.id) g WHERE g.request_line_id = v_l.id);
    END IF;
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
REVOKE ALL ON FUNCTION public.material_consume(text, uuid, jsonb) FROM PUBLIC;
