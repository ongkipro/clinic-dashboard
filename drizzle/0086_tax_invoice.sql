CREATE TABLE "tax_profile_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"npwp" text,
	"is_pkp" boolean NOT NULL,
	"pkp_effective_from" date,
	"reason" text NOT NULL,
	"command_key" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_as" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "tax_profile_changes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tax_profile_changes_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "tax_profile_changes_check" CHECK ("tax_profile_changes"."is_pkp" = ("tax_profile_changes"."pkp_effective_from" is not null)
      and (not "tax_profile_changes"."is_pkp" or "tax_profile_changes"."npwp" is not null)
      and ("tax_profile_changes"."npwp" is null or "tax_profile_changes"."npwp" ~ '^[0-9]{15,16}$')
      and "tax_profile_changes"."changed_as" = 'owner'
      and length(btrim("tax_profile_changes"."reason")) between 3 and 500
      and "tax_profile_changes"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$')
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"line_total" bigint NOT NULL,
	"tax_category" text NOT NULL,
	"tax_basis" text NOT NULL,
	"vat_base" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"vat_recognised_amount" bigint DEFAULT 0 NOT NULL,
	"vat_recognised_at" timestamp with time zone,
	"tax_document_ref" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "invoice_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_lines_amounts_check" CHECK ("invoice_lines"."quantity" between 1 and 10000
      and "invoice_lines"."unit_price" between 0 and 1000000000000
      and "invoice_lines"."discount" between 0 and "invoice_lines"."unit_price" * "invoice_lines"."quantity"
      and "invoice_lines"."line_total" = "invoice_lines"."unit_price" * "invoice_lines"."quantity" - "invoice_lines"."discount"
      and "invoice_lines"."vat_base" >= 0 and "invoice_lines"."vat_amount" >= 0 and "invoice_lines"."vat_base" + "invoice_lines"."vat_amount" = "invoice_lines"."line_total"),
	CONSTRAINT "invoice_lines_tax_check" CHECK ("invoice_lines"."tax_category" in ('exempt_medical','taxable_service','taxable_goods','non_object')
      and ("invoice_lines"."tax_category" not in ('exempt_medical','non_object') or "invoice_lines"."vat_amount" = 0)
      and length(btrim("invoice_lines"."tax_basis")) between 1 and 500
      and "invoice_lines"."vat_recognised_amount" between 0 and "invoice_lines"."vat_amount"
      and ("invoice_lines"."vat_recognised_amount" > 0) = ("invoice_lines"."vat_recognised_at" is not null)
      and ("invoice_lines"."tax_document_ref" is null or length("invoice_lines"."tax_document_ref") between 1 and 80))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sold_branch_id" uuid NOT NULL,
	"patient_id" uuid,
	"visit_id" uuid,
	"number" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"is_pkp_at_issue" boolean,
	"issued_at" timestamp with time zone,
	"issued_by" uuid,
	"issued_as" text,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "invoices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "invoices_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "invoices_check" CHECK ("invoices"."state" in ('draft','issued','void') and "invoices"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "invoices"."sold_branch_id" = "invoices"."branch_id"
      and ("invoices"."visit_id" is null or "invoices"."patient_id" is not null)
      and (("invoices"."state" = 'draft') = ("invoices"."issued_at" is null))
      and num_nonnulls("invoices"."issued_at", "invoices"."issued_by", "invoices"."issued_as", "invoices"."is_pkp_at_issue") in (0, 4)
      and ("invoices"."number" is null or length("invoices"."number") between 1 and 40))
);
--> statement-breakpoint
ALTER TABLE "tax_profile_changes" ADD CONSTRAINT "tax_profile_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile_changes" ADD CONSTRAINT "tax_profile_changes_changed_by_fk" FOREIGN KEY ("tenant_id","changed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_fk" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_profile_changes_tenant_idx" ON "tax_profile_changes" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_branch_idx" ON "invoices" USING btree ("tenant_id","branch_id","state","issued_at");--> statement-breakpoint

-- T-071 rules (generated by gen.py; plan docs/tasks/T-071.md)
-- ── Helpers (internal; revoked from PUBLIC, never granted) ──────────────────────────────────────────────────────
-- The local date of an instant at a branch (DATA-7: business day in the branch timezone); without a branch, the
-- tenant's earliest branch; without branches, Asia/Jakarta (plan r1 P1-1).
CREATE FUNCTION public.tax_local_date(p_tenant uuid, p_at timestamptz, p_branch uuid) RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (p_at AT TIME ZONE coalesce(
           (SELECT b.timezone FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = p_branch),
           (SELECT b.timezone FROM public.branches b WHERE b.tenant_id = p_tenant ORDER BY b.created_at, b.id LIMIT 1),
           'Asia/Jakarta'))::date
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_local_date(uuid, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint

-- Is the tenant PKP at an instant, at a branch? From the change history (the newest change made at or before the
-- instant), so the history decides, not today's flag: PKP when that change says PKP and its effective date is on or
-- before the branch-local date of the instant.
CREATE FUNCTION public.tax_pkp_at(p_tenant uuid, p_at timestamptz, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT c.is_pkp AND c.pkp_effective_from <= public.tax_local_date(p_tenant, p_at, p_branch)
                     FROM public.tax_profile_changes c
                    WHERE c.tenant_id = p_tenant AND c.changed_at <= p_at
                    ORDER BY c.changed_at DESC, c.id DESC LIMIT 1), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_pkp_at(uuid, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint

-- The VAT split of a VAT-inclusive amount (BILL-6): for a PKP taxable line, base = round half up (amount × 100 / 111)
-- in integers, VAT = amount − base (= 12 % × DPP 11/12 of the base); otherwise base = amount, VAT 0. base + VAT =
-- amount always. Mirrors src/modules/tax/policy.ts.
CREATE FUNCTION public.tax_vat_split(p_amount bigint, p_category text, p_pkp boolean, OUT base bigint, OUT vat bigint)
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: amount' USING ERRCODE = '22023';
  END IF;
  IF p_pkp AND p_category IN ('taxable_service','taxable_goods') THEN
    base := (p_amount * 100 + 55) / 111;
    vat := p_amount - base;
  ELSE
    base := p_amount;
    vat := 0;
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_vat_split(bigint, text, boolean) FROM PUBLIC;--> statement-breakpoint

-- Turnover of the 12 months ending on p_as_of (PR-24, A-07; plan r1 P2-7, open point 5): the line totals of issued
-- invoices whose branch-local issue date is in (p_as_of − 12 months, p_as_of].
CREATE FUNCTION public.tax_turnover_12m(p_tenant uuid, p_as_of date) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(sum(l.line_total), 0)::bigint
    FROM public.invoices i
    JOIN public.branches b ON b.tenant_id = i.tenant_id AND b.id = i.branch_id
    JOIN public.invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
   WHERE i.tenant_id = p_tenant AND i.state = 'issued'
     AND (i.issued_at AT TIME ZONE b.timezone)::date > (p_as_of - interval '12 months')::date
     AND (i.issued_at AT TIME ZONE b.timezone)::date <= p_as_of
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_turnover_12m(uuid, date) FROM PUBLIC;--> statement-breakpoint

-- The latest branch-local date of an issued or void invoice of the tenant (plan r1 P1-2), or null.
CREATE FUNCTION public.tax_latest_issued_date(p_tenant uuid) RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT max((i.issued_at AT TIME ZONE b.timezone)::date)
    FROM public.invoices i JOIN public.branches b ON b.tenant_id = i.tenant_id AND b.id = i.branch_id
   WHERE i.tenant_id = p_tenant AND i.state IN ('issued','void')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_latest_issued_date(uuid) FROM PUBLIC;--> statement-breakpoint

-- Readers of the tax profile (owner, finance, admin pusat, auditor) and of invoices in this task (owner, finance,
-- auditor; the cashier roles arrive with T-072).
CREATE FUNCTION public.invoice_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_role_in(ARRAY['owner','finance','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.invoice_readable(uuid) TO clinic_app;--> statement-breakpoint
CREATE FUNCTION public.tax_profile_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_role_in(ARRAY['owner','finance','admin_pusat','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_profile_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tax_profile_readable(uuid) TO clinic_app;--> statement-breakpoint

ALTER TABLE public.tax_profile_changes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tax_profile_changes_read ON public.tax_profile_changes FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.tax_profile_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.tax_profile_changes TO clinic_app;--> statement-breakpoint
CREATE POLICY tax_profile_changes_operator_read ON public.tax_profile_changes FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.tax_profile_changes', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.tax_profile_changes TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER tax_profile_changes_no_truncate BEFORE TRUNCATE ON public.tax_profile_changes FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.tax_profile_changes ENABLE ALWAYS TRIGGER tax_profile_changes_no_truncate;--> statement-breakpoint
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invoices_read ON public.invoices FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.invoice_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.invoices TO clinic_app;--> statement-breakpoint
CREATE POLICY invoices_operator_read ON public.invoices FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.invoices', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.invoices TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON public.invoices FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.invoices ENABLE ALWAYS TRIGGER invoices_no_truncate;--> statement-breakpoint
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invoice_lines_read ON public.invoice_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.invoice_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.invoice_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY invoice_lines_operator_read ON public.invoice_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.invoice_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.invoice_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER invoice_lines_no_truncate BEFORE TRUNCATE ON public.invoice_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.invoice_lines ENABLE ALWAYS TRIGGER invoice_lines_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.tax_profile_changes', 'tenant-shared', 'cashier', '{owner,finance,admin_pusat,auditor}', 'tax and invoice definers (src/modules/tax, src/modules/cashier/invoice)', 'none (tenant-wide)'),
  ('public.invoices', 'tenant-ledger', 'cashier', '{owner,finance,auditor}', 'tax and invoice definers (src/modules/tax, src/modules/cashier/invoice)', 'the selling branch'),
  ('public.invoice_lines', 'tenant-ledger', 'cashier', '{owner,finance,auditor}', 'tax and invoice definers (src/modules/tax, src/modules/cashier/invoice)', 'the selling branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19; plan r1 P1-3): tax profile config, invoices personal.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.tax_profile_changes', 'config'),
  ('public.invoices', 'personal'),
  ('public.invoice_lines', 'personal');--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS, after the staff_access lock) ─────────────────────────────────────────────────────────
-- Tax profile changes: insert-only.
CREATE FUNCTION public.tax_profile_changes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'tax profile changes are never changed or deleted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_profile_changes_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER tax_profile_changes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tax_profile_changes FOR EACH ROW EXECUTE FUNCTION public.tax_profile_changes_guard();--> statement-breakpoint
ALTER TABLE public.tax_profile_changes ENABLE ALWAYS TRIGGER tax_profile_changes_guard;--> statement-breakpoint

-- Tenants: the tax fields always mirror the newest change row, so they change only after a change row with the new
-- values is written (tax_profile_set writes the row, then the tenant).
CREATE FUNCTION public.tenants_tax_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.tax_profile_changes;
BEGIN
  IF (NEW.npwp, NEW.is_pkp, NEW.pkp_effective_from) IS DISTINCT FROM (OLD.npwp, OLD.is_pkp, OLD.pkp_effective_from) THEN
    SELECT * INTO c FROM public.tax_profile_changes x WHERE x.tenant_id = NEW.id ORDER BY x.changed_at DESC, x.id DESC LIMIT 1;
    IF c.id IS NULL OR (c.npwp, c.is_pkp, c.pkp_effective_from) IS DISTINCT FROM (NEW.npwp, NEW.is_pkp, NEW.pkp_effective_from) THEN
      RAISE EXCEPTION 'tenant tax fields change only through tax_profile_set' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenants_tax_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER tenants_tax_guard BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.tenants_tax_guard();--> statement-breakpoint
ALTER TABLE public.tenants ENABLE ALWAYS TRIGGER tenants_tax_guard;--> statement-breakpoint

-- Invoices: never deleted; a draft may gain its issue fields once (draft → issued); after issue nothing changes but
-- the move to void (T-072) and the number (set at issue by T-072's writer); a visit's invoice is the visit's patient's.
CREATE FUNCTION public.invoices_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'an invoice opens as a draft' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.sold_branch_id, NEW.patient_id, NEW.visit_id, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.sold_branch_id, OLD.patient_id, OLD.visit_id, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at)
       OR OLD.state = 'void'
       OR OLD.state = 'issued' AND (NEW.state NOT IN ('issued','void')
            OR (NEW.issued_at, NEW.issued_by, NEW.issued_as, NEW.is_pkp_at_issue) IS DISTINCT FROM (OLD.issued_at, OLD.issued_by, OLD.issued_as, OLD.is_pkp_at_issue)
            OR OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number)
       OR OLD.state = 'draft' AND NEW.state NOT IN ('draft','issued') THEN
      RAISE EXCEPTION 'an invoice is frozen once issued' USING ERRCODE = '42501';
    END IF;
    IF OLD.state = 'draft' AND NEW.state = 'issued'
       AND NOT EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.tenant_id = NEW.tenant_id AND l.invoice_id = NEW.id) THEN
      RAISE EXCEPTION 'an invoice needs a line to be issued' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = NEW.tenant_id AND v.branch_id = NEW.branch_id
                                                AND v.id = NEW.visit_id AND v.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'a visit''s invoice is the visit''s patient''s' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoices_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER invoices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_guard();--> statement-breakpoint
ALTER TABLE public.invoices ENABLE ALWAYS TRIGGER invoices_guard;--> statement-breakpoint

-- Invoice lines: never deleted; added only to a draft; the frozen price, quantity, discount, totals and tax snapshot
-- never change; only the VAT recognition (once, up to the VAT) and the tax-document reference (once) are filled later.
CREATE FUNCTION public.invoice_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice lines are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id AND i.state = 'draft') THEN
      RAISE EXCEPTION 'lines are added to a draft invoice only' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.invoice_id, NEW.item_id, NEW.catalog_version_id, NEW.quantity, NEW.unit_price, NEW.discount,
      NEW.line_total, NEW.tax_category, NEW.tax_basis, NEW.vat_base, NEW.vat_amount, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.invoice_id, OLD.item_id, OLD.catalog_version_id, OLD.quantity, OLD.unit_price, OLD.discount,
      OLD.line_total, OLD.tax_category, OLD.tax_basis, OLD.vat_base, OLD.vat_amount, OLD.created_at)
     OR NEW.vat_recognised_amount < OLD.vat_recognised_amount
     OR OLD.vat_recognised_at IS NOT NULL AND NEW.vat_recognised_at IS DISTINCT FROM OLD.vat_recognised_at AND NEW.vat_recognised_amount = OLD.vat_recognised_amount
     OR OLD.tax_document_ref IS NOT NULL AND NEW.tax_document_ref IS DISTINCT FROM OLD.tax_document_ref THEN
    RAISE EXCEPTION 'an invoice line is frozen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_lines_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.invoice_lines_guard();--> statement-breakpoint
ALTER TABLE public.invoice_lines ENABLE ALWAYS TRIGGER invoice_lines_guard;--> statement-breakpoint

-- ── Writers (PR-24; every one takes the actor lock, then role and capability, before reading; plan r1 P2-5) ───────

-- tax_profile_set: the owner's tax facts (SET-39). p: {npwp?, is_pkp, pkp_effective_from?, reason}.
-- - NPWP only (is_pkp and the date unchanged): always allowed.
-- - Becoming PKP needs the gate vat_on_invoices open (approved tax advice, PR-97): the evidence is locked inside this
--   definer, after staff_access, so the lock order holds (never assertFeatureGate in TypeScript first).
-- - Any change of is_pkp or the date: the new date (when PKP) must be strictly after the latest issued/void invoice's
--   branch-local date and at most 366 days ahead; refused once an invoice was issued in the current PKP era (on or
--   after the current date) — including ending PKP (open point 2: a correction before PKP-era invoices only).
-- TaxProfileChanged {tenant_id, change_id}; audit reason tax_profile_changed. Returns the change id.
CREATE FUNCTION public.tax_profile_set(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  t public.tenants;
  v_pkp boolean;
  v_from date;
  v_npwp text;
  v_latest date;
  v_today date;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner sets the tax profile' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') AND NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tax profile cannot change now' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'npwp' - 'is_pkp' - 'pkp_effective_from' - 'reason' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'is_pkp') IS DISTINCT FROM 'boolean'
     OR length(btrim(coalesce(p ->> 'reason', ''))) NOT BETWEEN 3 AND 500
     OR p ? 'npwp' AND p ->> 'npwp' IS NOT NULL AND (p ->> 'npwp') !~ '^[0-9]{15,16}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: tax profile' USING ERRCODE = '22023';
  END IF;
  v_pkp := (p ->> 'is_pkp')::boolean;
  IF v_pkp THEN
    IF coalesce(p ->> 'pkp_effective_from', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: pkp_effective_from' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_from := (p ->> 'pkp_effective_from')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: pkp_effective_from' USING ERRCODE = '22023';
    END;
  ELSIF p ? 'pkp_effective_from' AND p ->> 'pkp_effective_from' IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: pkp_effective_from' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.tenants x WHERE x.id = a.tenant_id FOR UPDATE;
  v_npwp := CASE WHEN p ? 'npwp' THEN nullif(p ->> 'npwp', '') ELSE t.npwp END;
  IF v_pkp AND v_npwp IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: npwp_required' USING ERRCODE = '22023';
  END IF;
  IF (v_pkp, v_from) IS DISTINCT FROM (t.is_pkp, t.pkp_effective_from) THEN
    v_latest := public.tax_latest_issued_date(a.tenant_id);
    v_today := public.tax_local_date(a.tenant_id, clock_timestamp(), NULL);
    IF t.is_pkp AND v_latest IS NOT NULL AND v_latest >= t.pkp_effective_from THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: pkp_era_has_invoices' USING ERRCODE = '55000';
    END IF;
    IF v_pkp AND (v_latest IS NOT NULL AND v_from <= v_latest OR v_from > v_today + 366) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: pkp_effective_from' USING ERRCODE = '55000';
    END IF;
    IF v_pkp THEN
      PERFORM public.feature_gate_lock('vat_on_invoices');
      IF NOT public.feature_gate_open('vat_on_invoices') THEN
        RAISE EXCEPTION 'ERR_GATE_CLOSED: vat_on_invoices' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.tax_profile_changes (tenant_id, npwp, is_pkp, pkp_effective_from, reason, command_key, changed_by, changed_as)
    VALUES (a.tenant_id, v_npwp, v_pkp, v_from, btrim(p ->> 'reason'), p_key, a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a tax profile change with this key exists' USING ERRCODE = '23505';
  END;
  UPDATE public.tenants SET npwp = v_npwp, is_pkp = v_pkp, pkp_effective_from = v_from WHERE id = a.tenant_id;
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (NULL, 'TaxProfileChanged', 'tenant', a.tenant_id, jsonb_build_object('tenant_id', a.tenant_id, 'change_id', v_id));
  PERFORM public.audit_append('settings_change', 'tax_profile', v_id, 'success', 'tax_profile_changed');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_profile_set(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tax_profile_set(text, jsonb) TO clinic_app;--> statement-breakpoint

-- The invoice actor: the lock first; owner, manager, fo_cashier or finance; the tenant may use the cashier; a branch
-- role at its active branch, a tenant-wide role at a named branch of the tenant.
CREATE FUNCTION public.invoice_actor(p_branch uuid, OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, v_branch FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','manager','fo_cashier','finance') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not issue invoices' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the cashier is not available now' USING ERRCODE = '42501';
  END IF;
  IF role IN ('manager','fo_cashier') THEN
    IF v_branch IS NULL OR p_branch IS NOT NULL AND p_branch <> v_branch THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: not your active branch' USING ERRCODE = '42501';
    END IF;
    branch_id := v_branch;
  ELSE
    branch_id := p_branch;
  END IF;
  IF branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = invoice_actor.tenant_id AND b.id = invoice_actor.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_actor(uuid) FROM PUBLIC;--> statement-breakpoint

-- invoice_open (minimal; T-072 extends it): a draft at a branch, optionally for a patient and that patient's visit
-- at the branch. p: {patient_id?, visit_id?}. Returns the invoice id.
CREATE FUNCTION public.invoice_open(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.invoice_actor(p_branch);
  v_patient uuid;
  v_visit uuid;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'patient_id' - 'visit_id' <> '{}'::jsonb
     OR p ->> 'visit_id' IS NOT NULL AND p ->> 'patient_id' IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invoice' USING ERRCODE = '22023';
  END IF;
  IF p ->> 'patient_id' IS NOT NULL THEN
    SELECT x.id INTO v_patient FROM public.patients x WHERE x.tenant_id = a.tenant_id AND x.id::text = p ->> 'patient_id';
    IF v_patient IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
    END IF;
    IF public.patient_is_merged(a.tenant_id, v_patient) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: patient_merged' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF p ->> 'visit_id' IS NOT NULL THEN
    SELECT v.id INTO v_visit FROM public.visits v
     WHERE v.tenant_id = a.tenant_id AND v.branch_id = a.branch_id AND v.id::text = p ->> 'visit_id' AND v.patient_id = v_patient;
    IF v_visit IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.invoices (tenant_id, branch_id, sold_branch_id, patient_id, visit_id, command_key, created_by, created_as)
    VALUES (a.tenant_id, a.branch_id, a.branch_id, v_patient, v_visit, p_key, a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an invoice with this key exists' USING ERRCODE = '23505';
  END;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_open(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.invoice_open(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- invoice_line_snapshot (internal; T-072's line writers call it): one line on a draft, frozen at p_at: the branch
-- price, the active version's tax category and basis, the PKP state at the branch-local date and the gate. A PKP
-- taxable line with the gate closed is refused (open point 3). Returns the line id.
CREATE FUNCTION public.invoice_line_snapshot(p_invoice public.invoices, p_item uuid, p_quantity integer, p_discount bigint, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.catalog_versions;
  v_price bigint;
  v_total bigint;
  v_pkp boolean;
  v_split record;
  v_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity' USING ERRCODE = '22023';
  END IF;
  SELECT x.* INTO v FROM public.catalog_versions x JOIN public.catalog_items i ON i.tenant_id = x.tenant_id AND i.id = x.item_id
   WHERE x.tenant_id = p_invoice.tenant_id AND x.item_id = p_item AND x.state = 'active' AND i.kind <> 'material';
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: item not found' USING ERRCODE = 'P0002';
  END IF;
  v_price := public.catalog_branch_price(p_item, p_invoice.branch_id, p_at);
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: item not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_discount IS NULL OR p_discount < 0 OR p_discount > v_price * p_quantity THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: discount' USING ERRCODE = '22023';
  END IF;
  v_total := v_price * p_quantity - p_discount;
  v_pkp := public.tax_pkp_at(p_invoice.tenant_id, p_at, p_invoice.branch_id);
  IF v_pkp AND v.tax_category IN ('taxable_service','taxable_goods') THEN
    PERFORM public.feature_gate_lock('vat_on_invoices');
    IF NOT public.feature_gate_open('vat_on_invoices') THEN
      RAISE EXCEPTION 'ERR_GATE_CLOSED: vat_on_invoices' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_split FROM public.tax_vat_split(v_total, v.tax_category, v_pkp);
  PERFORM public.catalog_version_reference(v.id);
  INSERT INTO public.invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, discount, line_total,
                                    tax_category, tax_basis, vat_base, vat_amount)
  VALUES (p_invoice.tenant_id, p_invoice.branch_id, p_invoice.id, p_item, v.id, p_quantity, v_price, p_discount, v_total,
          v.tax_category, v.tax_basis, v_split.base, v_split.vat)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_line_snapshot(public.invoices, uuid, integer, bigint, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- invoice_issue (minimal; T-072 extends it with numbering, payment and receipts): issues a draft with its lines,
-- all frozen at the same instant (clock_timestamp(); no backdating input, plan r2). p: {lines: [{item_id, quantity,
-- discount?}] 1–100}. Returns {invoice_id, issued_at, is_pkp_at_issue}.
CREATE FUNCTION public.invoice_issue(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.invoice_actor(NULL::uuid);
  i public.invoices;
  v_at timestamptz := clock_timestamp();
  v_l jsonb;
  v_pkp boolean;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF NOT FOUND OR a.role IN ('manager','fo_cashier') AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'lines' <> '{}'::jsonb OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p -> 'lines') NOT BETWEEN 1 AND 100
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'item_id' - 'quantity' - 'discount' <> '{}'::jsonb
                  OR jsonb_typeof(x -> 'quantity') IS DISTINCT FROM 'number' OR (x ->> 'quantity') !~ '^\d{1,5}$'
                  OR x ? 'discount' AND (jsonb_typeof(x -> 'discount') IS DISTINCT FROM 'number' OR (x ->> 'discount') !~ '^\d{1,13}$')
                  OR coalesce(x ->> 'item_id', '') !~ '^[0-9a-fA-F-]{36}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x LOOP
    PERFORM public.invoice_line_snapshot(i, (v_l ->> 'item_id')::uuid, (v_l ->> 'quantity')::integer, coalesce((v_l ->> 'discount')::bigint, 0), v_at);
  END LOOP;
  v_pkp := public.tax_pkp_at(i.tenant_id, v_at, i.branch_id);
  UPDATE public.invoices SET state = 'issued', issued_at = v_at, issued_by = a.staff_id, issued_as = a.role, is_pkp_at_issue = v_pkp
   WHERE tenant_id = i.tenant_id AND id = i.id;
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceIssued', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'branch_id', i.branch_id));
  PERFORM public.audit_append('settings_change', 'invoice', i.id, 'success', 'invoice_issued');
  RETURN jsonb_build_object('invoice_id', i.id, 'issued_at', v_at, 'is_pkp_at_issue', v_pkp);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_issue(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.invoice_issue(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- tax_profile_get: the tenant's tax facts, their history (newest first, up to 50), the VAT gate state, the 12-month
-- turnover and the PR-24 warning for a non-PKP tenant (fixed display thresholds, not settings: near from
-- Rp4,000,000,000, over from Rp4,800,000,000; PKP tenants 'none'). Owner, finance, admin pusat, auditor.
CREATE FUNCTION public.tax_profile_get() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  t public.tenants;
  v_today date;
  v_turnover bigint;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','finance','admin_pusat','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the tax profile' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.tenants x WHERE x.id = a.tenant_id;
  v_today := public.tax_local_date(a.tenant_id, clock_timestamp(), NULL);
  v_turnover := public.tax_turnover_12m(a.tenant_id, v_today);
  RETURN jsonb_build_object(
    'npwp', t.npwp, 'is_pkp', t.is_pkp, 'pkp_effective_from', t.pkp_effective_from,
    'pkp_now', public.tax_pkp_at(a.tenant_id, clock_timestamp(), NULL),
    'vat_gate_open', public.feature_gate_open('vat_on_invoices'),
    'can_change', a.role = 'owner',
    'turnover_12m', v_turnover, 'as_of', v_today,
    'warning', CASE WHEN t.is_pkp THEN 'none' WHEN v_turnover >= 4800000000 THEN 'over' WHEN v_turnover >= 4000000000 THEN 'near' ELSE 'none' END,
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'npwp', c.npwp, 'is_pkp', c.is_pkp, 'pkp_effective_from', c.pkp_effective_from,
                                   'reason', c.reason, 'changed_at', c.changed_at, 'changed_by', s.display_name) ORDER BY c.changed_at DESC, c.id DESC)
                           FROM (SELECT * FROM public.tax_profile_changes x WHERE x.tenant_id = a.tenant_id ORDER BY x.changed_at DESC, x.id DESC LIMIT 50) c
                           JOIN public.staff s ON s.tenant_id = c.tenant_id AND s.id = c.changed_by), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tax_profile_get() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tax_profile_get() TO clinic_app;--> statement-breakpoint

-- invoice_get: one invoice with its lines as frozen (owner, finance, auditor in this task; the cashier roles read
-- through T-072's readers). Not found across tenants.
CREATE FUNCTION public.invoice_get(p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  i public.invoices;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','finance','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read invoices here' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('id', i.id, 'branch_id', i.branch_id, 'state', i.state, 'issued_at', i.issued_at, 'is_pkp_at_issue', i.is_pkp_at_issue,
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'catalog_version_id', l.catalog_version_id, 'quantity', l.quantity,
                                 'unit_price', l.unit_price, 'discount', l.discount, 'line_total', l.line_total, 'tax_category', l.tax_category,
                                 'tax_basis', l.tax_basis, 'vat_base', l.vat_base, 'vat_amount', l.vat_amount) ORDER BY l.created_at, l.id)
                         FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.invoice_get(uuid) TO clinic_app;
