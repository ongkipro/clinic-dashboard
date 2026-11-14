CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "expense_categories_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_categories_check" CHECK (length(btrim("expense_categories"."name")) between 2 and 60)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"funding" text NOT NULL,
	"description" text NOT NULL,
	"supplier_id" uuid,
	"receipt_file_name" text,
	"receipt_media_type" text,
	"receipt_size" integer,
	"receipt_sha256" text,
	"receipt_content" "bytea",
	"state" text DEFAULT 'recorded' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversed_as" text,
	"reverse_reason" text,
	"command_key" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_as" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "expenses_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "expenses_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "expenses_check" CHECK ("expenses"."amount" between 1 and 1000000000000 and "expenses"."funding" in ('petty_cash','cash','bank','unpaid')
      and length(btrim("expenses"."description")) between 3 and 200 and "expenses"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "expenses"."recorded_as" in ('owner','finance','manager')
      and ("expenses"."funding" <> 'unpaid' or "expenses"."supplier_id" is not null)
      and num_nonnulls("expenses"."receipt_file_name", "expenses"."receipt_media_type", "expenses"."receipt_size", "expenses"."receipt_sha256", "expenses"."receipt_content") in (0, 5)
      and ("expenses"."receipt_media_type" is null or "expenses"."receipt_media_type" in ('application/pdf','image/png','image/jpeg'))
      and ("expenses"."receipt_size" is null or "expenses"."receipt_size" between 1 and 5242880)
      and ("expenses"."receipt_sha256" is null or "expenses"."receipt_sha256" ~ '^[0-9a-f]{64}$')
      and ("expenses"."funding" not in ('petty_cash','cash') or "expenses"."receipt_content" is not null)
      and "expenses"."state" in ('recorded','reversed') and (("expenses"."state" = 'reversed') = ("expenses"."reversed_at" is not null))
      and num_nonnulls("expenses"."reversed_at", "expenses"."reversed_by", "expenses"."reversed_as", "expenses"."reverse_reason") in (0, 4)
      and ("expenses"."reverse_reason" is null or length(btrim("expenses"."reverse_reason")) between 3 and 300))
);
--> statement-breakpoint
ALTER TABLE "supplier_invoices" DROP CONSTRAINT "supplier_invoices_check";--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."expense_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_branch_date_idx" ON "expenses" USING btree ("tenant_id","branch_id","business_date");--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_check" CHECK ("supplier_invoices"."kind" in ('purchase','expense') and (("supplier_invoices"."kind" = 'expense') = ("supplier_invoices"."expense_id" is not null))
      and "supplier_invoices"."number" ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$' and "supplier_invoices"."invoice_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and "supplier_invoices"."due_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and "supplier_invoices"."due_date" >= "supplier_invoices"."invoice_date"
      and "supplier_invoices"."total" between 1 and 1000000000000000000 and "supplier_invoices"."paid_amount" between 0 and 1000000000000000000 and "supplier_invoices"."credited_amount" between 0 and 1000000000000000000 and "supplier_invoices"."paid_amount" + "supplier_invoices"."credited_amount" <= "supplier_invoices"."total"
      and "supplier_invoices"."state" in ('open','paid','reversed') and "supplier_invoices"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and ("supplier_invoices"."kind" = 'purchase' and "supplier_invoices"."recorded_as" in ('purchasing','finance') or "supplier_invoices"."kind" = 'expense' and "supplier_invoices"."recorded_as" in ('owner','finance','manager'))
      and (("supplier_invoices"."state" = 'paid') = ("supplier_invoices"."paid_amount" + "supplier_invoices"."credited_amount" = "supplier_invoices"."total" and "supplier_invoices"."state" <> 'reversed'))
      and ("supplier_invoices"."state" <> 'reversed' or ("supplier_invoices"."paid_amount" = 0 and "supplier_invoices"."credited_amount" = 0))
      and (("supplier_invoices"."state" = 'reversed') = ("supplier_invoices"."reversed_at" is not null)) and num_nonnulls("supplier_invoices"."reversed_at", "supplier_invoices"."reversed_by", "supplier_invoices"."reverse_reason") in (0, 3) and ("supplier_invoices"."reverse_reason" is null or length(btrim("supplier_invoices"."reverse_reason")) between 3 and 300));--> statement-breakpoint

-- T-084 rules (generated by gen.py; plan docs/tasks/T-084.md)
-- ── T-084 helpers and guards (plan §4.1, review r1 P1-2) ──
-- Expenses are read by the owner, finance and the auditor tenant-wide and by a manager at the allowed active branch (no Admin Pusat,
-- no purchasing: open point 4 resolved). Categories by the same roles.
CREATE FUNCTION public.expense_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
    public.app_role_in(ARRAY['owner','finance','auditor'])
    OR public.app_role_in(ARRAY['manager']) AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.expense_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.expense_category_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_role_in(ARRAY['owner','finance','auditor','manager']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_category_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.expense_category_readable(uuid) TO clinic_app;--> statement-breakpoint

-- Categories: never deleted; name and active change (rename, deactivate); identity frozen.
CREATE FUNCTION public.expense_categories_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expense categories are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'an expense category keeps its identity' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_categories_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER expense_categories_guard BEFORE INSERT OR UPDATE OR DELETE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.expense_categories_guard();--> statement-breakpoint
ALTER TABLE public.expense_categories ENABLE ALWAYS TRIGGER expense_categories_guard;--> statement-breakpoint

-- Expenses: inserted recorded (an active category of the tenant; the receipt's type sniffed from its bytes and its hash matching);
-- content frozen; only recorded → reversed once, with its actor and reason.
CREATE FUNCTION public.expenses_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expenses are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'recorded'
       OR NOT EXISTS (SELECT 1 FROM public.expense_categories c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.category_id AND c.active)
       OR NEW.receipt_content IS NOT NULL AND (public.media_sniff(NEW.receipt_content) IS DISTINCT FROM NEW.receipt_media_type
            OR encode(sha256(NEW.receipt_content), 'hex') <> NEW.receipt_sha256 OR octet_length(NEW.receipt_content) <> NEW.receipt_size) THEN
      RAISE EXCEPTION 'an expense opens recorded in an active category with a matching receipt' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','reversed_at','reversed_by','reversed_as','reverse_reason']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['state','reversed_at','reversed_by','reversed_as','reverse_reason'])
     OR NOT (OLD.state = 'recorded' AND NEW.state = 'reversed') THEN
    RAISE EXCEPTION 'an expense keeps its content; it is reversed once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expenses_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER expenses_guard BEFORE INSERT OR UPDATE OR DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.expenses_guard();--> statement-breakpoint
ALTER TABLE public.expenses ENABLE ALWAYS TRIGGER expenses_guard;--> statement-breakpoint

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY expense_categories_read ON public.expense_categories FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.expense_category_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.expense_categories TO clinic_app;--> statement-breakpoint
CREATE POLICY expense_categories_operator_read ON public.expense_categories FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.expense_categories', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.expense_categories TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER expense_categories_no_truncate BEFORE TRUNCATE ON public.expense_categories FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.expense_categories ENABLE ALWAYS TRIGGER expense_categories_no_truncate;--> statement-breakpoint
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY expenses_read ON public.expenses FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.expense_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, category_id, business_date, amount, funding, description, supplier_id, receipt_file_name, receipt_media_type, receipt_size, receipt_sha256, state, reversed_at, reversed_by, reversed_as, reverse_reason, command_key, recorded_by, recorded_as, recorded_at) ON public.expenses TO clinic_app;--> statement-breakpoint
CREATE POLICY expenses_operator_read ON public.expenses FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.expenses', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, category_id, business_date, amount, funding, description, supplier_id, receipt_file_name, receipt_media_type, receipt_size, receipt_sha256, state, reversed_at, reversed_by, reversed_as, reverse_reason, command_key, recorded_by, recorded_as, recorded_at) ON public.expenses TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER expenses_no_truncate BEFORE TRUNCATE ON public.expenses FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.expenses ENABLE ALWAYS TRIGGER expenses_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.expense_categories', 'tenant-shared', 'cashier', '{owner,finance,auditor,manager}', 'expense definers (src/modules/expenses)', 'none'),
  ('public.expenses', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager}', 'expense definers (src/modules/expenses)', 'the expense branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): categories are configuration; expenses are money totals (the receipt bytes never granted).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.expense_categories', 'config'),
  ('public.expenses', 'money_total');--> statement-breakpoint

-- ── T-084 the payables side (plan §5, review r1 P1-1, P2-4) ──
-- r1 P1-1: an expense invoice is recorded by the expense's recorder (owner, finance, manager); a purchase invoice keeps purchasing/finance.
-- The constraint is replaced as a superset for existing rows (every existing invoice is a purchase).
-- (r1 P1-1: supplier_invoices_check is replaced in the generated DDL above from src/modules/purchasing/schema.ts — purchase invoices
-- recorded by purchasing/finance, expense invoices by owner/finance/manager.)
ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_expense_fk FOREIGN KEY (tenant_id, expense_id)
  REFERENCES public.expenses (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint

-- r1 P2-4: a purchase invoice totals its lines; an expense invoice has no lines and totals its expense (unpaid, same branch, supplier
-- and amount). Deferred to commit (the expense and its invoice are written in one transaction).
-- SECURITY DEFINER: the check reads the paired expense at commit whatever the session's read rights (an RLS-scoped reader would see none).
CREATE OR REPLACE FUNCTION public.supplier_invoices_total_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.supplier_invoices;
BEGIN
  -- a deferred trigger sees the row as inserted: read the invoice as it is at commit
  SELECT * INTO i FROM public.supplier_invoices x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.id;
  IF i.kind = 'expense' THEN
    IF EXISTS (SELECT 1 FROM public.supplier_invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id)
       OR NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.tenant_id = i.tenant_id AND e.id = i.expense_id AND e.funding = 'unpaid'
                        AND e.branch_id = i.branch_id AND e.supplier_id = i.supplier_id AND e.amount = i.total) THEN
      RAISE EXCEPTION 'an expense invoice totals its unpaid expense' USING ERRCODE = '42501';
    END IF;
  ELSIF i.total <> coalesce((SELECT sum(l.amount) FROM public.supplier_invoice_lines l WHERE l.tenant_id = NEW.tenant_id AND l.invoice_id = NEW.id), 0) THEN
    RAISE EXCEPTION 'an invoice totals its lines' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- r1 P2-4 (both ways): an unpaid expense has its expense invoice at commit, reversed together.
CREATE FUNCTION public.expenses_payable_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.expenses;
  i public.supplier_invoices;
BEGIN
  SELECT * INTO e FROM public.expenses x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.id;
  SELECT * INTO i FROM public.supplier_invoices x WHERE x.tenant_id = e.tenant_id AND x.expense_id = e.id;
  IF e.funding = 'unpaid' AND (i.id IS NULL OR (e.state = 'reversed') <> (i.state = 'reversed'))
     OR e.funding <> 'unpaid' AND i.id IS NOT NULL THEN
    RAISE EXCEPTION 'an unpaid expense has its expense invoice, reversed together' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expenses_payable_check() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expenses_payable_check AFTER INSERT OR UPDATE ON public.expenses DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.expenses_payable_check();--> statement-breakpoint
ALTER TABLE public.expenses ENABLE ALWAYS TRIGGER expenses_payable_check;--> statement-breakpoint

-- ── T-084 writers and readers (plan §4.2, §4.3; review r1 P1-1, P2-4, P3) ──
-- Kategori Biaya (open point 1): owner, finance; create (p_id null) or rename / deactivate; never deleted. Capability configuration.
CREATE FUNCTION public.expense_category_save(p_id uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','finance') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not manage expense categories' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'name' - 'active' <> '{}'::jsonb
     OR length(btrim(coalesce(p ->> 'name', ''))) NOT BETWEEN 2 AND 60
     OR p ? 'active' AND jsonb_typeof(p -> 'active') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: category' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.expense_categories c WHERE c.tenant_id = a.tenant_id AND lower(c.name) = lower(btrim(p ->> 'name'))
               AND c.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: category_name_taken' USING ERRCODE = '55000';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.expense_categories (tenant_id, name, active, created_by, updated_by)
    VALUES (a.tenant_id, btrim(p ->> 'name'), coalesce((p ->> 'active')::boolean, true), a.staff_id, a.staff_id) RETURNING id INTO v_id;
  ELSE
    UPDATE public.expense_categories SET name = btrim(p ->> 'name'), active = coalesce((p ->> 'active')::boolean, active), updated_by = a.staff_id,
           updated_at = clock_timestamp()
     WHERE tenant_id = a.tenant_id AND id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: category not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  PERFORM public.audit_append('settings_change', 'expense_category', v_id, 'success', 'expense_category_saved');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_category_save(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.expense_category_save(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Catat Biaya (PR-79, BILL-37): owner, finance (any branch), manager (own branch). p: {category_id, business_date, amount, funding
-- (petty_cash|cash|bank|unpaid), description, supplier_id?, supplier_invoice_number?, receipt_file_name?, receipt_media_type?, receipt_size?,
-- receipt_sha256?}; the receipt bytes in p_receipt (r1 P2-4: not base64 in JSON). The receipt is required for petty cash and cash (open point 2),
-- a supplier for unpaid. Unpaid → one supplier invoice of kind expense written in the same transaction (the deferred checks pair them).
-- ExpenseRecorded (ids only). Replay by key returns the expense.
CREATE FUNCTION public.expense_record(p_key text, p_branch uuid, p jsonb, p_receipt bytea DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.payables_actor(ARRAY['owner','finance','manager'], p_branch);
  v_id uuid;
  v_date date;
  v_funding text := p ->> 'funding';
  s public.suppliers;
  v_inv uuid;
BEGIN
  SELECT x.id INTO v_id FROM public.expenses x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'category_id' - 'business_date' - 'amount' - 'funding' - 'description' - 'supplier_id' - 'supplier_invoice_number'
          - 'receipt_file_name' - 'receipt_media_type' - 'receipt_size' - 'receipt_sha256' <> '{}'::jsonb
     OR coalesce(p ->> 'category_id', '') !~ '^[0-9a-fA-F-]{36}$' OR coalesce(p ->> 'business_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
     OR jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^\d{1,13}$' OR (p ->> 'amount')::bigint < 1
     OR coalesce(v_funding, '') NOT IN ('petty_cash','cash','bank','unpaid')
     OR length(btrim(coalesce(p ->> 'description', ''))) NOT BETWEEN 3 AND 200
     OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: expense' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_date := (p ->> 'business_date')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: business_date' USING ERRCODE = '22023';
  END;
  IF v_date > public.safety_today(a.tenant_id, a.branch_id) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: business_date' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.expense_categories c WHERE c.tenant_id = a.tenant_id AND c.id = (p ->> 'category_id')::uuid AND c.active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: category not found' USING ERRCODE = 'P0002';
  END IF;
  -- the receipt (r1 P2-4): required for petty cash and cash; checked in SQL by its bytes
  IF p_receipt IS NULL AND v_funding IN ('petty_cash','cash') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: receipt_required' USING ERRCODE = '22023';
  END IF;
  IF p_receipt IS NOT NULL AND (octet_length(p_receipt) NOT BETWEEN 1 AND 5242880
       OR public.media_sniff(p_receipt) IS DISTINCT FROM (p ->> 'receipt_media_type')
       OR encode(sha256(p_receipt), 'hex') IS DISTINCT FROM (p ->> 'receipt_sha256')
       OR (p ->> 'receipt_size') IS DISTINCT FROM octet_length(p_receipt)::text
       OR length(btrim(coalesce(p ->> 'receipt_file_name', ''))) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: receipt' USING ERRCODE = '22023';
  END IF;
  IF p ? 'supplier_id' THEN
    BEGIN
      SELECT * INTO s FROM public.suppliers x WHERE x.tenant_id = a.tenant_id AND x.id = (p ->> 'supplier_id')::uuid AND x.active;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: supplier' USING ERRCODE = '22023';
    END;
    IF s.id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF v_funding = 'unpaid' AND s.id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: supplier_required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.expenses (tenant_id, branch_id, category_id, business_date, amount, funding, description, supplier_id,
                               receipt_file_name, receipt_media_type, receipt_size, receipt_sha256, receipt_content,
                               command_key, recorded_by, recorded_as)
  VALUES (a.tenant_id, a.branch_id, (p ->> 'category_id')::uuid, v_date, (p ->> 'amount')::bigint, v_funding, btrim(p ->> 'description'), s.id,
          CASE WHEN p_receipt IS NOT NULL THEN btrim(p ->> 'receipt_file_name') END, CASE WHEN p_receipt IS NOT NULL THEN p ->> 'receipt_media_type' END,
          CASE WHEN p_receipt IS NOT NULL THEN octet_length(p_receipt) END, CASE WHEN p_receipt IS NOT NULL THEN p ->> 'receipt_sha256' END, p_receipt,
          p_key, a.staff_id, a.role)
  RETURNING id INTO v_id;
  IF v_funding = 'unpaid' THEN
    -- the payable document (DATA-64, BILL-37): one expense invoice, number from the payee or the full expense id (r1 P2-4)
    INSERT INTO public.supplier_invoices (tenant_id, branch_id, supplier_id, kind, expense_id, number, invoice_date, due_date, total,
                                          command_key, recorded_by, recorded_as)
    VALUES (a.tenant_id, a.branch_id, s.id, 'expense', v_id,
            coalesce(NULLIF(btrim(p ->> 'supplier_invoice_number'), ''), 'EXP-' || upper(replace(v_id::text, '-', ''))),
            v_date::text, (v_date + s.payment_terms_days)::text, (p ->> 'amount')::bigint,
            encode(sha256(convert_to('expense:' || p_key, 'UTF8')), 'hex'), a.staff_id, a.role)
    RETURNING id INTO v_inv;
  END IF;
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'ExpenseRecorded', 'expense', v_id, jsonb_strip_nulls(jsonb_build_object('expense_id', v_id, 'supplier_invoice_id', v_inv)));
  PERFORM public.audit_append('money_correction', 'expense', v_id, 'success', 'expense_recorded');
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  IF SQLERRM LIKE '%supplier_invoices_number_key%' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: duplicate_invoice_number' USING ERRCODE = '55000';
  END IF;
  RAISE;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_record(text, uuid, jsonb, bytea) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.expense_record(text, uuid, jsonb, bytea) TO clinic_app;--> statement-breakpoint

-- Batalkan Biaya (BILL-37 "corrections by reversal"; r1 P2-4): owner or finance; the actor lock first (T-067 P1-1), then the expense, then
-- its invoice; refused when already reversed or when its payable has any payment or credit; the invoice reversed with it.
CREATE FUNCTION public.expense_reverse(p_expense uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['owner','finance'], 'operations', NULL);
  e public.expenses;
  i public.supplier_invoices;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO e FROM public.expenses x WHERE x.tenant_id = a.tenant_id AND x.id = p_expense FOR UPDATE;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: expense not found' USING ERRCODE = 'P0002';
  END IF;
  IF e.state = 'reversed' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: expense_reversed' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO i FROM public.supplier_invoices x WHERE x.tenant_id = e.tenant_id AND x.expense_id = e.id FOR UPDATE;
  IF i.id IS NOT NULL AND (i.state <> 'open' OR i.paid_amount <> 0 OR i.credited_amount <> 0) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: expense_paid' USING ERRCODE = '55000';
  END IF;
  UPDATE public.expenses SET state = 'reversed', reversed_at = clock_timestamp(), reversed_by = a.staff_id, reversed_as = a.role, reverse_reason = btrim(p_reason)
   WHERE tenant_id = e.tenant_id AND id = e.id;
  IF i.id IS NOT NULL THEN
    UPDATE public.supplier_invoices SET state = 'reversed', reversed_at = clock_timestamp(), reversed_by = a.staff_id, reverse_reason = btrim(p_reason)
     WHERE tenant_id = i.tenant_id AND id = i.id;
  END IF;
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (e.branch_id, 'ExpenseReversed', 'expense', e.id, jsonb_strip_nulls(jsonb_build_object('expense_id', e.id, 'supplier_invoice_id', i.id)));
  PERFORM public.audit_append('money_correction', 'expense', e.id, 'success', 'expense_reversed');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_reverse(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.expense_reverse(uuid, text) TO clinic_app;--> statement-breakpoint

-- ── T-084 readers (plan §4.3; review r1 P1-2, P3) ──
-- The reader actor: the lock, then owner, finance, auditor (tenant-wide) or a manager at the active branch; capability configuration or
-- operations (as the stock readers). For a manager the branch is always the active one.
CREATE FUNCTION public.expense_reader(p_branch uuid, OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, v_branch FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','finance','auditor','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read expenses' USING ERRCODE = '42501';
  END IF;
  IF role = 'manager' THEN
    IF v_branch IS NULL OR p_branch IS NOT NULL AND p_branch <> v_branch THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: not your active branch' USING ERRCODE = '42501';
    END IF;
    branch_id := v_branch;
  ELSE
    branch_id := p_branch;
    IF branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = expense_reader.tenant_id AND b.id = expense_reader.branch_id) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_reader(uuid) FROM PUBLIC;--> statement-breakpoint

-- Biaya Operasional & Kas Kecil list: a period of business dates, optional branch / category / funding; rows without the receipt bytes
-- (a flag and the file name) and with the linked payable summary (r1 P3); the categories for the form and filters; what the role may do.
CREATE FUNCTION public.expenses_list(p_branch uuid, p_from date, p_to date, p_category uuid DEFAULT NULL, p_funding text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.expense_reader(p_branch);
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 OR p_funding IS NOT NULL AND p_funding NOT IN ('petty_cash','cash','bank','unpaid') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'branch_id', a.branch_id,
    'can_record', a.role IN ('owner','finance','manager'), 'can_reverse', a.role IN ('owner','finance'), 'can_categories', a.role IN ('owner','finance'),
    'categories', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'active', c.active) ORDER BY c.name)
                             FROM public.expense_categories c WHERE c.tenant_id = a.tenant_id), '[]'::jsonb),
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name) FROM public.branches b
                           WHERE b.tenant_id = a.tenant_id AND (a.role <> 'manager' OR b.id = a.branch_id)), '[]'::jsonb),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'business_date', e.business_date, 'branch', jsonb_build_object('id', b.id, 'name', b.name),
                        'category', jsonb_build_object('id', c.id, 'name', c.name), 'description', e.description, 'funding', e.funding, 'amount', e.amount,
                        'state', e.state, 'has_receipt', e.receipt_content IS NOT NULL, 'receipt_file_name', e.receipt_file_name, 'receipt_media_type', e.receipt_media_type,
                        'supplier', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id', s.id, 'name', s.name) END,
                        'payable', CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object('invoice_id', i.id, 'number', i.number, 'state', i.state,
                                      'due_date', i.due_date, 'paid', i.paid_amount, 'credited', i.credited_amount) END,
                        'recorded_at', e.recorded_at, 'recorded_as', e.recorded_as)
                        ORDER BY e.business_date DESC, e.recorded_at DESC)
                       FROM public.expenses e
                       JOIN public.branches b ON b.tenant_id = e.tenant_id AND b.id = e.branch_id
                       JOIN public.expense_categories c ON c.tenant_id = e.tenant_id AND c.id = e.category_id
                       LEFT JOIN public.suppliers s ON s.tenant_id = e.tenant_id AND s.id = e.supplier_id
                       LEFT JOIN public.supplier_invoices i ON i.tenant_id = e.tenant_id AND i.expense_id = e.id
                      WHERE e.tenant_id = a.tenant_id AND e.business_date BETWEEN p_from AND p_to
                        AND (a.branch_id IS NULL OR e.branch_id = a.branch_id)
                        AND (p_category IS NULL OR e.category_id = p_category) AND (p_funding IS NULL OR e.funding = p_funding)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expenses_list(uuid, date, date, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.expenses_list(uuid, date, date, uuid, text) TO clinic_app;--> statement-breakpoint

-- The receipt file for the same readers (the bytes only through this definer; column grants exclude them).
CREATE FUNCTION public.expense_receipt(p_expense uuid, OUT file_name text, OUT media_type text, OUT content bytea)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.expense_reader(NULL);
  e public.expenses;
BEGIN
  SELECT * INTO e FROM public.expenses x WHERE x.tenant_id = a.tenant_id AND x.id = p_expense AND (a.role <> 'manager' OR x.branch_id = a.branch_id);
  IF e.id IS NULL OR e.receipt_content IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: receipt not found' USING ERRCODE = 'P0002';
  END IF;
  file_name := e.receipt_file_name; media_type := e.receipt_media_type; content := e.receipt_content;
  PERFORM public.audit_append('export', 'expense', e.id, 'success', 'expense_receipt_read');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_receipt(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.expense_receipt(uuid) TO clinic_app;--> statement-breakpoint

-- Branch expense totals for a period (scenario PR-79 "B1 margin includes it in that period"; the margin report consumes it): recorded, not
-- reversed, by branch and category; a manager sees the active branch only (r1 P3).
CREATE FUNCTION public.expense_branch_totals(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.expense_reader(NULL);
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', t.branch_id, 'category_id', t.category_id, 'amount', t.amount) ORDER BY t.branch_id, t.category_id)
    FROM (SELECT e.branch_id, e.category_id, sum(e.amount)::bigint AS amount FROM public.expenses e
           WHERE e.tenant_id = a.tenant_id AND e.state = 'recorded' AND e.business_date BETWEEN p_from AND p_to
             AND (a.role <> 'manager' OR e.branch_id = a.branch_id)
           GROUP BY e.branch_id, e.category_id) t), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expense_branch_totals(date, date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.expense_branch_totals(date, date) TO clinic_app;--> statement-breakpoint

-- ── T-084 re-created functions (latest definitions, edits asserted by recreate.py) ──
-- supplier_payable_reverse (re-created from 0084): an expense invoice is reversed with its expense (T-084).
CREATE OR REPLACE FUNCTION public.supplier_payable_reverse(p_kind text, p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  -- the actor lock first, before any row is read (review 2665ab81 P1-1)
  a record := public.stock_actor(CASE WHEN p_kind = 'invoice' THEN ARRAY['purchasing','finance'] ELSE ARRAY['finance'] END, 'operations', NULL);
  inv public.supplier_invoices;
  pm public.supplier_payments;
  c public.supplier_credit_notes;
  v_x record;
BEGIN
  IF p_kind NOT IN ('invoice','payment','credit_note') OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reversal' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'invoice' THEN
    SELECT * INTO inv FROM public.supplier_invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
    END IF;
    IF inv.kind = 'expense' THEN -- T-084: an expense owns its payable; reverse the expense (expense_reverse)
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: expense_invoice' USING ERRCODE = '55000';
    END IF;
    IF inv.state <> 'open' OR inv.paid_amount <> 0 OR inv.credited_amount <> 0 THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_settled' USING ERRCODE = '55000';
    END IF;
    UPDATE public.supplier_invoices SET state = 'reversed', reversed_at = clock_timestamp(), reversed_by = a.staff_id, reverse_reason = btrim(p_reason)
     WHERE tenant_id = inv.tenant_id AND id = inv.id;
    UPDATE public.supplier_invoice_lines SET reversed = true WHERE tenant_id = inv.tenant_id AND invoice_id = inv.id;
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (inv.branch_id, 'SupplierInvoiceReversed', 'supplier_invoice', inv.id, jsonb_build_object('invoice_id', inv.id));
  ELSIF p_kind = 'payment' THEN
    SELECT * INTO pm FROM public.supplier_payments x WHERE x.tenant_id = a.tenant_id AND x.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: payment not found' USING ERRCODE = 'P0002';
    END IF;
    IF pm.state <> 'live' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: payment reversed' USING ERRCODE = '55000';
    END IF;
    PERFORM 1 FROM public.supplier_invoices i WHERE i.tenant_id = pm.tenant_id
       AND i.id IN (SELECT x.invoice_id FROM public.supplier_payment_allocations x WHERE x.tenant_id = pm.tenant_id AND x.payment_id = pm.id AND NOT x.reversed) ORDER BY i.id FOR UPDATE;
    FOR v_x IN SELECT x.id, x.invoice_id, x.amount FROM public.supplier_payment_allocations x WHERE x.tenant_id = pm.tenant_id AND x.payment_id = pm.id AND NOT x.reversed ORDER BY x.invoice_id, x.id LOOP
      UPDATE public.supplier_payment_allocations SET reversed = true WHERE tenant_id = pm.tenant_id AND id = v_x.id;
      UPDATE public.supplier_invoices SET paid_amount = paid_amount - v_x.amount, state = 'open' WHERE tenant_id = pm.tenant_id AND id = v_x.invoice_id;
    END LOOP;
    UPDATE public.supplier_payments SET state = 'reversed', allocated_amount = 0, reversed_at = clock_timestamp(), reversed_by = a.staff_id, reverse_reason = btrim(p_reason)
     WHERE tenant_id = pm.tenant_id AND id = pm.id;
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (pm.branch_id, 'SupplierPaymentReversed', 'supplier_payment', pm.id, jsonb_build_object('payment_id', pm.id));
  ELSE
    SELECT * INTO c FROM public.supplier_credit_notes x WHERE x.tenant_id = a.tenant_id AND x.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: credit note not found' USING ERRCODE = 'P0002';
    END IF;
    IF c.state <> 'live' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: credit note reversed' USING ERRCODE = '55000';
    END IF;
    PERFORM 1 FROM public.supplier_invoices i WHERE i.tenant_id = c.tenant_id
       AND i.id IN (SELECT x.invoice_id FROM public.supplier_credit_applications x WHERE x.tenant_id = c.tenant_id AND x.credit_note_id = c.id AND NOT x.reversed) ORDER BY i.id FOR UPDATE;
    FOR v_x IN SELECT x.id, x.invoice_id, x.amount FROM public.supplier_credit_applications x WHERE x.tenant_id = c.tenant_id AND x.credit_note_id = c.id AND NOT x.reversed ORDER BY x.invoice_id, x.id LOOP
      UPDATE public.supplier_credit_applications SET reversed = true WHERE tenant_id = c.tenant_id AND id = v_x.id;
      UPDATE public.supplier_invoices SET credited_amount = credited_amount - v_x.amount, state = 'open' WHERE tenant_id = c.tenant_id AND id = v_x.invoice_id;
    END LOOP;
    UPDATE public.supplier_credit_notes SET state = 'reversed', available_amount = 0, reversed_at = clock_timestamp(), reversed_by = a.staff_id, reverse_reason = btrim(p_reason)
     WHERE tenant_id = c.tenant_id AND id = c.id;
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (c.branch_id, 'SupplierCreditReversed', 'supplier_credit_note', c.id, jsonb_build_object('credit_note_id', c.id));
  END IF;
  PERFORM public.audit_append('money_correction', 'supplier_' || p_kind, p_id, 'success', 'supplier_' || p_kind || '_reversed');
END
$$;
