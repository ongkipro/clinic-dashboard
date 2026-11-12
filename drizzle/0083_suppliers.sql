CREATE TABLE "supplier_credit_expectations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"uncosted" boolean NOT NULL,
	"state" text DEFAULT 'expected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"credit_note_id" uuid,
	"closed_reason" text,
	"closed_by" uuid,
	"closed_as" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "supplier_credit_expectations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_credit_expectations_return_key" UNIQUE("tenant_id","return_id"),
	CONSTRAINT "supplier_credit_expectations_check" CHECK ("supplier_credit_expectations"."amount" between 0 and 1000000000000000000 and "supplier_credit_expectations"."state" in ('expected','received','written_off')
      and (("supplier_credit_expectations"."state" = 'expected') = ("supplier_credit_expectations"."closed_at" is null)) and num_nonnulls("supplier_credit_expectations"."closed_by", "supplier_credit_expectations"."closed_as", "supplier_credit_expectations"."closed_at") in (0, 3)
      and (("supplier_credit_expectations"."state" = 'received') = ("supplier_credit_expectations"."credit_note_id" is not null))
      and (("supplier_credit_expectations"."state" = 'written_off') = ("supplier_credit_expectations"."closed_reason" is not null))
      and ("supplier_credit_expectations"."closed_reason" is null or length(btrim("supplier_credit_expectations"."closed_reason")) between 3 and 300)
      and ("supplier_credit_expectations"."closed_as" is null or "supplier_credit_expectations"."closed_as" in ('finance','purchasing','owner','admin_pusat')))
);
--> statement-breakpoint
CREATE TABLE "supplier_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"unit_cost" bigint NOT NULL,
	"delivery_note" text,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"command_key" text,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"received_by" uuid NOT NULL,
	"received_as" text NOT NULL,
	CONSTRAINT "supplier_receipts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_receipts_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "supplier_receipts_check" CHECK ("supplier_receipts"."quantity" between 0.0001 and 1000000000 and scale("supplier_receipts"."quantity") <= 4 and "supplier_receipts"."unit_cost" between 0 and 1000000000
      and "supplier_receipts"."source_kind" in ('supplier_receipt','goods_receipt') and (("supplier_receipts"."source_kind" = 'supplier_receipt') = ("supplier_receipts"."command_key" is not null))
      and ("supplier_receipts"."command_key" is null or "supplier_receipts"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$') and "supplier_receipts"."received_as" in ('pharmacist','purchasing')
      and ("supplier_receipts"."delivery_note" is null or "supplier_receipts"."delivery_note" ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$'))
);
--> statement-breakpoint
CREATE TABLE "supplier_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"reason" text NOT NULL,
	"note" text NOT NULL,
	"credit_note_ref" text,
	"movement_id" uuid NOT NULL,
	"value" bigint NOT NULL,
	"uncosted_qty" numeric NOT NULL,
	"command_key" text NOT NULL,
	"returned_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"returned_by" uuid NOT NULL,
	"returned_as" text NOT NULL,
	CONSTRAINT "supplier_returns_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_returns_scope_key" UNIQUE("tenant_id","branch_id","supplier_id","id"),
	CONSTRAINT "supplier_returns_movement_key" UNIQUE("tenant_id","movement_id"),
	CONSTRAINT "supplier_returns_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "supplier_returns_check" CHECK ("supplier_returns"."quantity" between 0.0001 and 1000000000 and scale("supplier_returns"."quantity") <= 4 and "supplier_returns"."reason" in ('expired','near_expiry','damaged','recalled','wrong_item','quality','other')
      and length(btrim("supplier_returns"."note")) between 3 and 300 and "supplier_returns"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "supplier_returns"."value" between 0 and 1000000000000000000 and "supplier_returns"."uncosted_qty" between 0 and "supplier_returns"."quantity" and scale("supplier_returns"."uncosted_qty") <= 4
      and "supplier_returns"."returned_as" in ('purchasing','pharmacist','manager','admin_pusat','owner')
      and ("supplier_returns"."credit_note_ref" is null or "supplier_returns"."credit_note_ref" ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"npwp" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "suppliers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_check" CHECK (length(btrim("suppliers"."name")) between 2 and 120 and "suppliers"."payment_terms_days" between 0 and 180
      and ("suppliers"."npwp" is null or "suppliers"."npwp" ~ '^[0-9]{15,16}$')
      and ("suppliers"."contact_name" is null or length(btrim("suppliers"."contact_name")) between 2 and 120)
      and ("suppliers"."phone" is null or "suppliers"."phone" ~ '^\+?[0-9 -]{6,20}$')
      and ("suppliers"."email" is null or ("suppliers"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length("suppliers"."email") <= 200))
      and ("suppliers"."address" is null or length(btrim("suppliers"."address")) between 3 and 300))
);
--> statement-breakpoint
ALTER TABLE "supplier_credit_expectations" ADD CONSTRAINT "supplier_credit_expectations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_expectations" ADD CONSTRAINT "supplier_credit_expectations_return_fk" FOREIGN KEY ("tenant_id","branch_id","supplier_id","return_id") REFERENCES "public"."supplier_returns"("tenant_id","branch_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_expectations" ADD CONSTRAINT "supplier_credit_expectations_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_batch_fk" FOREIGN KEY ("tenant_id","branch_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_depot_fk" FOREIGN KEY ("tenant_id","branch_id","depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_batch_fk" FOREIGN KEY ("tenant_id","branch_id","batch_id") REFERENCES "public"."stock_batches"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_movement_fk" FOREIGN KEY ("tenant_id","movement_id") REFERENCES "public"."stock_movements"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_by_fk" FOREIGN KEY ("tenant_id","returned_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_credit_expectations_open_idx" ON "supplier_credit_expectations" USING btree ("tenant_id","supplier_id","state");--> statement-breakpoint
CREATE INDEX "supplier_receipts_batch_idx" ON "supplier_receipts" USING btree ("tenant_id","branch_id","supplier_id","batch_id");--> statement-breakpoint
CREATE INDEX "supplier_returns_batch_idx" ON "supplier_returns" USING btree ("tenant_id","branch_id","supplier_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers" USING btree ("tenant_id",lower(btrim("name")));--> statement-breakpoint

-- T-066 rules (generated by gen.py; plan docs/tasks/T-066.md)
-- ── Helpers (T-066; no 0000–0082 function re-created) ─────────────────────────────────────────────────────────
-- The returnable quantity of a batch to its supplier at a branch: delivered by that supplier minus returned to it.
CREATE FUNCTION public.supplier_batch_open(p_tenant uuid, p_branch uuid, p_supplier uuid, p_batch uuid) RETURNS numeric
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT sum(r.quantity) FROM public.supplier_receipts r
                    WHERE r.tenant_id = p_tenant AND r.branch_id = p_branch AND r.supplier_id = p_supplier AND r.batch_id = p_batch), 0)
       - coalesce((SELECT sum(x.quantity) FROM public.supplier_returns x
                    WHERE x.tenant_id = p_tenant AND x.branch_id = p_branch AND x.supplier_id = p_supplier AND x.batch_id = p_batch), 0)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_batch_open(uuid, uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A sealed quantity of a batch in a depot: the holding less the open vial's remainder (the opened part stays, as
-- transfer_take_lines in 0078).
CREATE FUNCTION public.supplier_depot_sealed(p_tenant uuid, p_depot uuid, p_batch uuid) RETURNS numeric
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT h.quantity FROM public.batch_holdings h WHERE h.tenant_id = p_tenant AND h.depot_id = p_depot AND h.batch_id = p_batch), 0)
       - coalesce((SELECT v.remaining FROM public.opened_vials v WHERE v.tenant_id = p_tenant AND v.depot_id = p_depot AND v.batch_id = p_batch AND v.state = 'open'), 0)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_depot_sealed(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A receipt from a supplier (internal; T-066's supplier_receive and T-067's goods receipt lines): the supplier must be
-- active; the cost row and the batch receipt go under ('supplier_receipt', the new receipt id) so two lines of one
-- goods receipt never collide on stock_receipt_costs; the supplier_receipts row names its own source (the goods
-- receipt for T-067). p: stock_receive's payload + unit_cost (JSON integer) + delivery_note?.
CREATE FUNCTION public.supplier_receive_into(p_tenant uuid, p_staff uuid, p_role text, p_branch uuid, p_supplier uuid, p jsonb,
                                             p_source_kind text, p_source uuid, p_key text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid := public.uuid_generate_v7();
  v_item uuid;
  v_batch uuid;
  v_qty numeric;
  s public.suppliers;
BEGIN
  SELECT * INTO s FROM public.suppliers x WHERE x.tenant_id = p_tenant AND x.id = p_supplier;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT s.active THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the supplier is inactive' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p -> 'unit_cost') IS DISTINCT FROM 'number' OR (p ->> 'unit_cost') !~ '^[0-9]{1,10}$'
     OR (p ->> 'unit_cost')::bigint > 1000000000
     OR p ? 'delivery_note' AND coalesce(p ->> 'delivery_note', '') !~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: unit cost or delivery note' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_item := NULLIF(p ->> 'item_id', '')::uuid;
    v_qty := (p ->> 'quantity')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: item or quantity' USING ERRCODE = '22023';
  END;
  IF NOT EXISTS (SELECT 1 FROM public.stock_items i WHERE i.tenant_id = p_tenant AND i.id = v_item) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.stock_receipt_costs (tenant_id, branch_id, item_id, source_kind, source_id, unit_cost, created_by, created_as)
  VALUES (p_tenant, p_branch, v_item, 'supplier_receipt', v_id, (p ->> 'unit_cost')::bigint, p_staff, p_role);
  v_batch := public.stock_receive_into(p_tenant, p_staff, p_role, p_branch, p - 'unit_cost' - 'delivery_note' - 'supplier_id', 'supplier_receipt', v_id);
  BEGIN
    INSERT INTO public.supplier_receipts (id, tenant_id, branch_id, supplier_id, batch_id, quantity, unit_cost, delivery_note, source_kind, source_id, command_key,
                                          received_by, received_as)
    VALUES (v_id, p_tenant, p_branch, p_supplier, v_batch, v_qty, (p ->> 'unit_cost')::bigint, p ->> 'delivery_note', p_source_kind, coalesce(p_source, v_id), p_key,
            p_staff, p_role);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
  END;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_receive_into(uuid, uuid, text, uuid, uuid, jsonb, text, uuid, text) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY suppliers_read ON public.suppliers FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_item_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.suppliers TO clinic_app;--> statement-breakpoint
CREATE POLICY suppliers_operator_read ON public.suppliers FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.suppliers', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.suppliers TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER suppliers_no_truncate BEFORE TRUNCATE ON public.suppliers FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.suppliers ENABLE ALWAYS TRIGGER suppliers_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_receipts_read ON public.supplier_receipts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, supplier_id, batch_id, quantity, delivery_note, source_kind, source_id, command_key, received_at, received_by, received_as) ON public.supplier_receipts TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_receipts_operator_read ON public.supplier_receipts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_receipts', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, supplier_id, batch_id, quantity, delivery_note, source_kind, source_id, command_key, received_at, received_by, received_as) ON public.supplier_receipts TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_receipts_no_truncate BEFORE TRUNCATE ON public.supplier_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_receipts ENABLE ALWAYS TRIGGER supplier_receipts_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_returns ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_returns_read ON public.supplier_returns FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, supplier_id, depot_id, batch_id, quantity, reason, note, credit_note_ref, movement_id, uncosted_qty, command_key, returned_at, returned_by, returned_as) ON public.supplier_returns TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_returns_operator_read ON public.supplier_returns FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_returns', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, supplier_id, depot_id, batch_id, quantity, reason, note, credit_note_ref, movement_id, uncosted_qty, command_key, returned_at, returned_by, returned_as) ON public.supplier_returns TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_returns_no_truncate BEFORE TRUNCATE ON public.supplier_returns FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_returns ENABLE ALWAYS TRIGGER supplier_returns_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_credit_expectations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_credit_expectations_read ON public.supplier_credit_expectations FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.supplier_credit_expectations TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_credit_expectations_operator_read ON public.supplier_credit_expectations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_credit_expectations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.supplier_credit_expectations TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_credit_expectations_no_truncate BEFORE TRUNCATE ON public.supplier_credit_expectations FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_credit_expectations ENABLE ALWAYS TRIGGER supplier_credit_expectations_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.suppliers', 'tenant-shared', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'supplier definers (src/modules/purchasing/suppliers)', 'none'),
  ('public.supplier_receipts', 'branch-scoped', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'supplier definers (src/modules/purchasing/suppliers)', 'the receiving branch'),
  ('public.supplier_returns', 'branch-scoped', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'supplier definers (src/modules/purchasing/suppliers)', 'the returning branch'),
  ('public.supplier_credit_expectations', 'tenant-ledger', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'supplier definers (src/modules/purchasing/suppliers)', 'the returning branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): suppliers config; receipts and returns personal; credit expectations money totals.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.suppliers', 'config'),
  ('public.supplier_receipts', 'personal'),
  ('public.supplier_returns', 'personal'),
  ('public.supplier_credit_expectations', 'money_total');--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS, after the staff_access lock) ─────────────────────────────────────────────────────────
-- Suppliers: never deleted; the creator and creation time frozen.
CREATE FUNCTION public.suppliers_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'suppliers are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a supplier keeps its identity' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.suppliers_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER suppliers_guard BEFORE INSERT OR UPDATE OR DELETE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.suppliers_guard();--> statement-breakpoint
ALTER TABLE public.suppliers ENABLE ALWAYS TRIGGER suppliers_guard;--> statement-breakpoint

-- Receipts: insert-only; the batch received under this receipt's own source (the receive movement exists).
CREATE FUNCTION public.supplier_receipts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'supplier receipts are never changed or deleted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.tenant_id = NEW.tenant_id AND m.source_kind = 'supplier_receipt' AND m.source_id = NEW.id
                    AND m.batch_id = NEW.batch_id AND m.kind = 'receive' AND m.quantity = NEW.quantity) THEN
    RAISE EXCEPTION 'a supplier receipt follows its receive movement' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_receipts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER supplier_receipts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_receipts FOR EACH ROW EXECUTE FUNCTION public.supplier_receipts_guard();--> statement-breakpoint
ALTER TABLE public.supplier_receipts ENABLE ALWAYS TRIGGER supplier_receipts_guard;--> statement-breakpoint

-- Returns (finding 1): insert-only; the movement is this return's `supplier_return` movement of the batch in the depot
-- for −quantity, the value and uncosted units are its value row's, and the returned total of the batch to the supplier
-- at the branch never exceeds what the supplier delivered of it.
CREATE FUNCTION public.supplier_returns_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'supplier returns are never changed or deleted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements m JOIN public.stock_movement_values mv ON mv.tenant_id = m.tenant_id AND mv.movement_id = m.id
                  WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.movement_id AND m.kind = 'supplier_return' AND m.source_kind = 'supplier_return'
                    AND m.source_id = NEW.id AND m.batch_id = NEW.batch_id AND m.depot_id = NEW.depot_id AND m.branch_id = NEW.branch_id
                    AND m.quantity = -NEW.quantity AND mv.value = -NEW.value AND mv.uncosted_qty = -NEW.uncosted_qty) THEN
    RAISE EXCEPTION 'a supplier return follows its valued movement' USING ERRCODE = '42501';
  END IF;
  IF public.supplier_batch_open(NEW.tenant_id, NEW.branch_id, NEW.supplier_id, NEW.batch_id) < NEW.quantity THEN
    RAISE EXCEPTION 'a return never exceeds what the supplier delivered' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_returns_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER supplier_returns_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_returns FOR EACH ROW EXECUTE FUNCTION public.supplier_returns_guard();--> statement-breakpoint
ALTER TABLE public.supplier_returns ENABLE ALWAYS TRIGGER supplier_returns_guard;--> statement-breakpoint

-- Expectations: never deleted; open as `expected` with the return's value and uncosted flag; later only expected →
-- received | written_off once (T-067), everything else frozen.
CREATE FUNCTION public.supplier_credit_expectations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit expectations are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'expected' OR NOT EXISTS (
         SELECT 1 FROM public.supplier_returns r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.return_id AND r.value = NEW.amount
            AND NEW.uncosted = (r.uncosted_qty > 0)) THEN
      RAISE EXCEPTION 'an expectation opens expected at its return''s value' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.supplier_id, NEW.return_id, NEW.amount, NEW.uncosted, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.supplier_id, OLD.return_id, OLD.amount, OLD.uncosted, OLD.created_at)
     OR NOT (OLD.state = 'expected' AND NEW.state IN ('received','written_off')) THEN
    RAISE EXCEPTION 'an expectation closes once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_credit_expectations_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER supplier_credit_expectations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_credit_expectations FOR EACH ROW EXECUTE FUNCTION public.supplier_credit_expectations_guard();--> statement-breakpoint
ALTER TABLE public.supplier_credit_expectations ENABLE ALWAYS TRIGGER supplier_credit_expectations_guard;--> statement-breakpoint

-- ── Writers ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pemasok (PR-75, 19:141): purchasing, admin pusat, owner create or update a supplier (never deleted; deactivate).
-- p: {name, npwp?, contact_name?, phone?, email?, address?, payment_terms_days?, active?}. Returns the supplier id.
CREATE FUNCTION public.supplier_save(p_supplier uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['purchasing','admin_pusat','owner'], 'configuration', NULL);
  v_id uuid;
  v_terms integer;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'name' - 'npwp' - 'contact_name' - 'phone' - 'email' - 'address' - 'payment_terms_days' - 'active' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'name') IS DISTINCT FROM 'string'
     OR p ? 'active' AND jsonb_typeof(p -> 'active') <> 'boolean'
     OR p ? 'payment_terms_days' AND (jsonb_typeof(p -> 'payment_terms_days') <> 'number' OR (p ->> 'payment_terms_days') !~ '^[0-9]{1,3}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: supplier' USING ERRCODE = '22023';
  END IF;
  v_terms := coalesce((p ->> 'payment_terms_days')::integer, 30);
  BEGIN
    IF p_supplier IS NULL THEN
      INSERT INTO public.suppliers (tenant_id, name, npwp, contact_name, phone, email, address, payment_terms_days, active, created_by, updated_by)
      VALUES (a.tenant_id, btrim(p ->> 'name'), NULLIF(btrim(p ->> 'npwp'), ''), NULLIF(btrim(p ->> 'contact_name'), ''), NULLIF(btrim(p ->> 'phone'), ''),
              NULLIF(lower(btrim(p ->> 'email')), ''), NULLIF(btrim(p ->> 'address'), ''), v_terms, coalesce((p ->> 'active')::boolean, true), a.staff_id, a.staff_id)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.suppliers SET name = btrim(p ->> 'name'), npwp = NULLIF(btrim(p ->> 'npwp'), ''), contact_name = NULLIF(btrim(p ->> 'contact_name'), ''),
             phone = NULLIF(btrim(p ->> 'phone'), ''), email = NULLIF(lower(btrim(p ->> 'email')), ''), address = NULLIF(btrim(p ->> 'address'), ''),
             payment_terms_days = v_terms, active = coalesce((p ->> 'active')::boolean, active), updated_by = a.staff_id, updated_at = clock_timestamp()
       WHERE tenant_id = a.tenant_id AND id = p_supplier
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: duplicate_name' USING ERRCODE = '55000';
            WHEN check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: supplier' USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'supplier', v_id, 'success', CASE WHEN p_supplier IS NULL THEN 'supplier_created' ELSE 'supplier_updated' END);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_save(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_save(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Terima dari Pemasok (PR-75 "a batch received from a supplier"): pharmacist or purchasing (stock_receive_costed's
-- roles) receive a batch from an active supplier at a unit cost. p: {supplier_id, item_id, batch_no, expiry, quantity,
-- reason, unit_cost, delivery_note?}. Returns the receipt id; StockReceived {batch_id, reason} as stock_receive.
CREATE FUNCTION public.supplier_receive(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'operations', p_branch);
  v_supplier uuid;
  v_id uuid;
  v_batch uuid;
BEGIN
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_supplier := NULLIF(p ->> 'supplier_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: supplier' USING ERRCODE = '22023';
  END;
  v_id := public.supplier_receive_into(a.tenant_id, a.staff_id, a.role, a.branch_id, v_supplier, p, 'supplier_receipt', NULL, p_key);
  SELECT r.batch_id INTO v_batch FROM public.supplier_receipts r WHERE r.tenant_id = a.tenant_id AND r.id = v_id;
  PERFORM public.audit_append('settings_change', 'supplier_receipt', v_id, 'success', 'supplier_received');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'StockReceived', 'stock_batch', v_batch, jsonb_build_object('batch_id', v_batch, 'reason', p ->> 'reason'));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_receive(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_receive(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Retur ke Pemasok (PR-75, BILL-30): a batch the supplier delivered to the branch goes back with a reason; unfit stock
-- (expired, quarantined, temperature excursion, recalled) may go back — no fitness assert; only sealed units of the
-- depot (an open vial's remainder stays); never more than the supplier delivered net of returns. One `supplier_return`
-- movement valued by the moving-average trigger (0080), read back for the return and its credit expectation.
-- Roles: purchasing, pharmacist, manager (active branch), admin pusat, owner (named branch).
-- p: {supplier_id, batch_id, quantity, reason, note, depot_id?, credit_note_ref?}.
CREATE FUNCTION public.supplier_return_record(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['purchasing','pharmacist','manager','admin_pusat','owner'], 'operations', p_branch);
  v_id uuid := public.uuid_generate_v7();
  v_supplier uuid;
  v_batch uuid;
  v_depot uuid;
  v_qty numeric;
  v_note text := btrim(coalesce(p ->> 'note', ''));
  b public.stock_batches;
  d public.depots;
  v_mov uuid;
  v_value bigint;
  v_unc numeric;
  v_exp uuid;
BEGIN
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'supplier_id' - 'batch_id' - 'quantity' - 'reason' - 'note' - 'depot_id' - 'credit_note_ref' <> '{}'::jsonb
     OR coalesce(p ->> 'reason', '') NOT IN ('expired','near_expiry','damaged','recalled','wrong_item','quality','other')
     OR length(v_note) NOT BETWEEN 3 AND 300
     OR p ? 'credit_note_ref' AND coalesce(p ->> 'credit_note_ref', '') !~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: return' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_supplier := (p ->> 'supplier_id')::uuid;
    v_batch := (p ->> 'batch_id')::uuid;
    v_depot := NULLIF(p ->> 'depot_id', '')::uuid;
    v_qty := (p ->> 'quantity')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: return' USING ERRCODE = '22023';
  END;
  IF v_qty IS NULL OR NOT (v_qty BETWEEN 0.0001 AND 1000000000 AND scale(v_qty) <= 4) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.tenant_id = a.tenant_id AND s.id = v_supplier) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: staff_access (actor) → batch → holding (stock_move_depot).
  SELECT * INTO b FROM public.stock_batches x WHERE x.tenant_id = a.tenant_id AND x.id = v_batch FOR UPDATE;
  IF NOT FOUND OR b.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO d FROM public.depots x WHERE x.tenant_id = a.tenant_id AND x.branch_id = b.branch_id AND x.id = coalesce(v_depot, public.depot_default(b.tenant_id, b.branch_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT d.active THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the depot is inactive' USING ERRCODE = '55000';
  END IF;
  IF public.supplier_batch_open(a.tenant_id, b.branch_id, v_supplier, b.id) < v_qty THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: not_delivered' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.batch_holdings h WHERE h.tenant_id = a.tenant_id AND h.depot_id = d.id AND h.batch_id = b.id FOR UPDATE;
  IF public.supplier_depot_sealed(a.tenant_id, d.id, b.id) < v_qty THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: not enough sealed stock in the depot' USING ERRCODE = 'P0422';
  END IF;
  v_mov := public.stock_move_depot(a.tenant_id, b.id, d.id, 'supplier_return', -v_qty, v_note, 'supplier_return', v_id, a.staff_id, a.role, NULL);
  SELECT -mv.value, -mv.uncosted_qty INTO v_value, v_unc FROM public.stock_movement_values mv WHERE mv.tenant_id = a.tenant_id AND mv.movement_id = v_mov;
  BEGIN
    INSERT INTO public.supplier_returns (id, tenant_id, branch_id, supplier_id, depot_id, batch_id, quantity, reason, note, credit_note_ref, movement_id, value,
                                         uncosted_qty, command_key, returned_by, returned_as)
    VALUES (v_id, a.tenant_id, b.branch_id, v_supplier, d.id, b.id, v_qty, p ->> 'reason', v_note, p ->> 'credit_note_ref', v_mov, v_value, v_unc, p_key,
            a.staff_id, a.role);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a return with this key exists' USING ERRCODE = '23505';
  END;
  INSERT INTO public.supplier_credit_expectations (tenant_id, branch_id, supplier_id, return_id, amount, uncosted)
  VALUES (a.tenant_id, b.branch_id, v_supplier, v_id, v_value, v_unc > 0) RETURNING id INTO v_exp;
  PERFORM public.audit_append('settings_change', 'supplier_return', v_id, 'success', 'supplier_returned');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (b.branch_id, 'SupplierReturned', 'supplier_return', v_id,
          jsonb_build_object('return_id', v_id, 'supplier_id', v_supplier, 'batch_id', b.id, 'expectation_id', v_exp));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_return_record(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_return_record(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── Readers (open point 6; finding 2: money fields only for stock_cost_readable) ───────────────────────────────
-- Stock readers: owner, admin pusat, finance, purchasing, auditor (any branch, named), manager and pharmacist (own).
CREATE FUNCTION public.supplier_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'npwp', s.npwp, 'contact_name', s.contact_name, 'phone', s.phone, 'email', s.email,
                     'address', s.address, 'payment_terms_days', s.payment_terms_days, 'active', s.active) ORDER BY s.active DESC, lower(s.name), s.id)
                     FROM public.suppliers s WHERE s.tenant_id = a.tenant_id), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_list() TO clinic_app;--> statement-breakpoint

-- One return as JSON; value and expectation only for a cost reader of its branch.
CREATE FUNCTION public.supplier_return_json(r public.supplier_returns) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', r.id, 'branch_id', r.branch_id, 'supplier_id', r.supplier_id,
           'supplier_name', (SELECT s.name FROM public.suppliers s WHERE s.tenant_id = r.tenant_id AND s.id = r.supplier_id),
           'depot_id', r.depot_id, 'batch_id', r.batch_id, 'batch_no', b.batch_no, 'expiry', b.expiry, 'item', lb.name, 'unit', i.unit,
           'quantity', r.quantity, 'reason', r.reason, 'note', r.note, 'credit_note_ref', r.credit_note_ref, 'returned_at', r.returned_at, 'returned_as', r.returned_as)
      || CASE WHEN public.stock_cost_readable(r.tenant_id, r.branch_id) THEN jsonb_build_object('value', r.value, 'uncosted_qty', r.uncosted_qty,
           'expectation', (SELECT jsonb_build_object('id', e.id, 'amount', e.amount, 'uncosted', e.uncosted, 'state', e.state)
                             FROM public.supplier_credit_expectations e WHERE e.tenant_id = r.tenant_id AND e.return_id = r.id))
         ELSE '{}'::jsonb END
    FROM public.stock_batches b JOIN public.stock_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
    CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
   WHERE b.tenant_id = r.tenant_id AND b.id = r.batch_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_return_json(public.supplier_returns) FROM PUBLIC;--> statement-breakpoint

-- One supplier with its receipts and returns at the branches the reader may see (unit cost for cost readers only).
CREATE FUNCTION public.supplier_get(p_supplier uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  s public.suppliers;
BEGIN
  SELECT * INTO s FROM public.suppliers x WHERE x.tenant_id = a.tenant_id AND x.id = p_supplier;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('id', s.id, 'name', s.name, 'npwp', s.npwp, 'contact_name', s.contact_name, 'phone', s.phone, 'email', s.email, 'address', s.address,
    'payment_terms_days', s.payment_terms_days, 'active', s.active,
    'receipts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'branch_id', r.branch_id, 'batch_id', r.batch_id, 'batch_no', b.batch_no, 'expiry', b.expiry,
                            'item', lb.name, 'unit', i.unit, 'quantity', r.quantity, 'delivery_note', r.delivery_note, 'received_at', r.received_at,
                            'unit_cost', CASE WHEN public.stock_cost_readable(r.tenant_id, r.branch_id) THEN r.unit_cost END) ORDER BY r.received_at DESC, r.id)
                            FROM public.supplier_receipts r JOIN public.stock_batches b ON b.tenant_id = r.tenant_id AND b.id = r.batch_id
                            JOIN public.stock_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
                            CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
                           WHERE r.tenant_id = s.tenant_id AND r.supplier_id = s.id AND public.stock_readable(r.tenant_id, r.branch_id)), '[]'::jsonb),
    'returns', coalesce((SELECT jsonb_agg(public.supplier_return_json(r) ORDER BY r.returned_at DESC, r.id)
                           FROM public.supplier_returns r WHERE r.tenant_id = s.tenant_id AND r.supplier_id = s.id AND public.stock_readable(r.tenant_id, r.branch_id)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_get(uuid) TO clinic_app;--> statement-breakpoint

-- The returns at a branch (a branch role: its own; a tenant-wide role names it), newest first. stock_reader_branch
-- already resolves the branch the reader may see (a branch role's active, membership-checked branch).
CREATE FUNCTION public.supplier_return_list(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
BEGIN
  RETURN coalesce((SELECT jsonb_agg(public.supplier_return_json(r) ORDER BY r.returned_at DESC, r.id)
                     FROM public.supplier_returns r WHERE r.tenant_id = a.tenant_id AND r.branch_id = v_branch), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_return_list(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_return_list(uuid) TO clinic_app;--> statement-breakpoint

-- What may go back to a supplier at a branch: per batch it delivered there, the open quantity (delivered − returned)
-- and the sealed quantity per active depot holding it.
CREATE FUNCTION public.supplier_batches(p_supplier uuid, p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.tenant_id = a.tenant_id AND s.id = p_supplier) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: supplier or branch not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('batch_id', b.id, 'batch_no', b.batch_no, 'expiry', b.expiry, 'state', b.state, 'item', lb.name, 'unit', i.unit,
             'open', public.supplier_batch_open(b.tenant_id, v_branch, p_supplier, b.id),
             'depots', coalesce((SELECT jsonb_agg(jsonb_build_object('depot_id', d.id, 'name', d.name, 'sealed', public.supplier_depot_sealed(b.tenant_id, d.id, b.id))
                                   ORDER BY d.is_default DESC, d.name, d.id)
                                  FROM public.depots d WHERE d.tenant_id = b.tenant_id AND d.branch_id = v_branch AND d.active
                                   AND public.supplier_depot_sealed(b.tenant_id, d.id, b.id) > 0), '[]'::jsonb))
             ORDER BY b.expiry, b.batch_no, b.id)
      FROM public.stock_batches b JOIN public.stock_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
      CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
     WHERE b.tenant_id = a.tenant_id AND b.branch_id = v_branch
       AND EXISTS (SELECT 1 FROM public.supplier_receipts r WHERE r.tenant_id = b.tenant_id AND r.branch_id = v_branch AND r.supplier_id = p_supplier AND r.batch_id = b.id)),
    '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_batches(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_batches(uuid, uuid) TO clinic_app;
