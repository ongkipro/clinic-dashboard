CREATE TABLE "vat_cutover_openings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"cutover_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vat_cutover_openings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vat_cutover_openings_object_key" UNIQUE("tenant_id","object_kind","object_id"),
	CONSTRAINT "vat_cutover_openings_check" CHECK ("vat_cutover_openings"."amount" <> 0 and "vat_cutover_openings"."object_kind" in ('line','package','session','deposit'))
);
--> statement-breakpoint
CREATE TABLE "vat_cutovers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cutover_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vat_cutovers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vat_cutovers_tenant_key" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "vat_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"delta" bigint NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"cause" text NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vat_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vat_events_check" CHECK ("vat_events"."delta" <> 0 and "vat_events"."object_kind" in ('line','package','session','deposit') and "vat_events"."cause" in ('session_delivery','receivable_convert','interrupted','package_close_line','package_close_package','package_sync_reversal','deposit_apply','session_attribution'))
);
--> statement-breakpoint
CREATE TABLE "vat_input_credits" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tax_period" text NOT NULL,
	"amount" bigint NOT NULL,
	"effective_on" date NOT NULL,
	"evidence_ref" text NOT NULL,
	"reason" text,
	"command_key" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_as" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vat_input_credits_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vat_input_credits_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "vat_input_credits_check" CHECK ("vat_input_credits"."tax_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "vat_input_credits"."amount" <> 0 and "vat_input_credits"."amount" between -1000000000000 and 1000000000000
      and length(btrim("vat_input_credits"."evidence_ref")) between 1 and 80 and (("vat_input_credits"."amount" < 0) = ("vat_input_credits"."reason" is not null))
      and ("vat_input_credits"."reason" is null or length(btrim("vat_input_credits"."reason")) between 10 and 500) and "vat_input_credits"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "vat_input_credits"."recorded_as" = 'finance')
);
--> statement-breakpoint
CREATE TABLE "vat_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tax_period" text NOT NULL,
	"amount" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"ntpn" text NOT NULL,
	"reason" text,
	"command_key" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_as" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vat_payments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vat_payments_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "vat_payments_check" CHECK ("vat_payments"."tax_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "vat_payments"."amount" <> 0 and "vat_payments"."amount" between -1000000000000 and 1000000000000
      and length(btrim("vat_payments"."ntpn")) between 1 and 40 and (("vat_payments"."amount" < 0) = ("vat_payments"."reason" is not null))
      and ("vat_payments"."reason" is null or length(btrim("vat_payments"."reason")) between 10 and 500) and "vat_payments"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "vat_payments"."recorded_as" = 'finance')
);
--> statement-breakpoint
ALTER TABLE "vat_cutover_openings" ADD CONSTRAINT "vat_cutover_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_cutover_openings" ADD CONSTRAINT "vat_cutover_openings_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_cutovers" ADD CONSTRAINT "vat_cutovers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_events" ADD CONSTRAINT "vat_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_events" ADD CONSTRAINT "vat_events_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_input_credits" ADD CONSTRAINT "vat_input_credits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_input_credits" ADD CONSTRAINT "vat_input_credits_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_payments" ADD CONSTRAINT "vat_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_payments" ADD CONSTRAINT "vat_payments_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vat_events_tenant_at_idx" ON "vat_events" USING btree ("tenant_id","effective_at");--> statement-breakpoint
CREATE INDEX "vat_events_object_idx" ON "vat_events" USING btree ("tenant_id","object_kind","object_id");--> statement-breakpoint
CREATE INDEX "vat_input_credits_period_idx" ON "vat_input_credits" USING btree ("tenant_id","tax_period");--> statement-breakpoint
CREATE INDEX "vat_payments_period_idx" ON "vat_payments" USING btree ("tenant_id","tax_period");--> statement-breakpoint

-- T-104 logic (generated from the parts by the task's gen.py; plan docs/tasks/T-104.md)
-- ── T-104 table rules (addendum a1 r2 §A1, §A3) ──
-- All five tables are tenant-ledger, read by owner, finance and the auditor of the tenant; nothing is written by the app directly:
-- the D-A facts only through vat_input_credit_record / vat_payment_record, vat_events only inside the C-7 seams, the cutover rows only here.
CREATE FUNCTION public.subledger_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_role_in(ARRAY['owner','finance','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subledger_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.subledger_readable(uuid) TO clinic_app;--> statement-breakpoint

-- Append-only: no UPDATE, no DELETE (TRUNCATE below). The writers hold staff_access first; the guard takes it too (the 0100 pattern).
CREATE FUNCTION public.subledger_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subledger_append_only() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER vat_input_credits_append_only BEFORE UPDATE OR DELETE ON public.vat_input_credits FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.vat_input_credits ENABLE ALWAYS TRIGGER vat_input_credits_append_only;--> statement-breakpoint
CREATE TRIGGER vat_payments_append_only BEFORE UPDATE OR DELETE ON public.vat_payments FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.vat_payments ENABLE ALWAYS TRIGGER vat_payments_append_only;--> statement-breakpoint
CREATE TRIGGER vat_events_append_only BEFORE UPDATE OR DELETE ON public.vat_events FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.vat_events ENABLE ALWAYS TRIGGER vat_events_append_only;--> statement-breakpoint
CREATE TRIGGER vat_cutovers_append_only BEFORE UPDATE OR DELETE ON public.vat_cutovers FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.vat_cutovers ENABLE ALWAYS TRIGGER vat_cutovers_append_only;--> statement-breakpoint
CREATE TRIGGER vat_cutover_openings_append_only BEFORE UPDATE OR DELETE ON public.vat_cutover_openings FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.vat_cutover_openings ENABLE ALWAYS TRIGGER vat_cutover_openings_append_only;--> statement-breakpoint
CREATE TRIGGER vat_input_credits_no_truncate BEFORE TRUNCATE ON public.vat_input_credits FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.vat_input_credits ENABLE ALWAYS TRIGGER vat_input_credits_no_truncate;--> statement-breakpoint
CREATE TRIGGER vat_payments_no_truncate BEFORE TRUNCATE ON public.vat_payments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.vat_payments ENABLE ALWAYS TRIGGER vat_payments_no_truncate;--> statement-breakpoint
CREATE TRIGGER vat_events_no_truncate BEFORE TRUNCATE ON public.vat_events FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.vat_events ENABLE ALWAYS TRIGGER vat_events_no_truncate;--> statement-breakpoint
CREATE TRIGGER vat_cutovers_no_truncate BEFORE TRUNCATE ON public.vat_cutovers FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.vat_cutovers ENABLE ALWAYS TRIGGER vat_cutovers_no_truncate;--> statement-breakpoint
CREATE TRIGGER vat_cutover_openings_no_truncate BEFORE TRUNCATE ON public.vat_cutover_openings FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.vat_cutover_openings ENABLE ALWAYS TRIGGER vat_cutover_openings_no_truncate;--> statement-breakpoint

ALTER TABLE public.vat_input_credits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY vat_input_credits_read ON public.vat_input_credits FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.subledger_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.vat_input_credits TO clinic_app;--> statement-breakpoint
CREATE POLICY vat_input_credits_operator_read ON public.vat_input_credits FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.vat_input_credits', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.vat_input_credits TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.vat_payments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY vat_payments_read ON public.vat_payments FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.subledger_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.vat_payments TO clinic_app;--> statement-breakpoint
CREATE POLICY vat_payments_operator_read ON public.vat_payments FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.vat_payments', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.vat_payments TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.vat_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY vat_events_read ON public.vat_events FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.subledger_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.vat_events TO clinic_app;--> statement-breakpoint
CREATE POLICY vat_events_operator_read ON public.vat_events FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.vat_events', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.vat_events TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.vat_cutovers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY vat_cutovers_read ON public.vat_cutovers FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.subledger_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.vat_cutovers TO clinic_app;--> statement-breakpoint
CREATE POLICY vat_cutovers_operator_read ON public.vat_cutovers FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.vat_cutovers', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.vat_cutovers TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.vat_cutover_openings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY vat_cutover_openings_read ON public.vat_cutover_openings FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.subledger_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.vat_cutover_openings TO clinic_app;--> statement-breakpoint
CREATE POLICY vat_cutover_openings_operator_read ON public.vat_cutover_openings FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.vat_cutover_openings', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.vat_cutover_openings TO clinic_operator;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.vat_input_credits', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'vat_input_credit_record (src/modules/accounting/subledgers)', 'none (tenant tax period)'),
  ('public.vat_payments', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'vat_payment_record (src/modules/accounting/subledgers)', 'none (tenant tax period)'),
  ('public.vat_events', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'the C-7 VAT seams (drizzle/0121)', 'the branch of the VAT object'),
  ('public.vat_cutovers', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'migration 0121 only', 'none'),
  ('public.vat_cutover_openings', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'migration 0121 only', 'the branch of the VAT object');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.vat_input_credits', 'money_total'),
  ('public.vat_payments', 'money_total'),
  ('public.vat_events', 'money_total'),
  ('public.vat_cutovers', 'money_total'),
  ('public.vat_cutover_openings', 'money_total');--> statement-breakpoint

-- ── C-7 VAT recording seams (Panel 2; addendum a1 r2 Sol e647eb18): each writer re-created with ADDED vat_events INSERTs only ──
-- package_execution_finish: from 0098_package_sharing.sql
CREATE OR REPLACE FUNCTION public.package_execution_finish() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s public.package_sessions;
  v_split record;
  v_attr bigint;
BEGIN
  IF OLD.state = 'finished' OR NEW.state <> 'finished' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = NEW.tenant_id AND x.reserved_execution_id = NEW.id AND x.state = 'reserved' FOR UPDATE;
  IF s.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM 1 FROM public.packages x WHERE x.tenant_id = s.tenant_id AND x.id = s.package_id FOR UPDATE;
  IF NEW.counted THEN
    UPDATE public.package_sessions SET state = 'redeemed', redeemed_at = NEW.finished_at, redeemed_branch_id = NEW.branch_id, version = version + 1
     WHERE tenant_id = s.tenant_id AND id = s.id;
    IF s.tax_category IN ('taxable_service','taxable_goods') AND s.vat_amount = 0 AND public.tax_pkp_at(NEW.tenant_id, NEW.finished_at, NEW.branch_id)
       AND public.feature_gate_open('vat_on_invoices') THEN
      SELECT * INTO v_split FROM public.tax_vat_split(s.allocated_value, s.tax_category, true);
      UPDATE public.package_sessions SET vat_base = v_split.base, vat_amount = v_split.vat, vat_recognised_amount = v_split.vat,
             vat_recognised_at = CASE WHEN v_split.vat > 0 THEN NEW.finished_at END, version = version + 1
       WHERE tenant_id = s.tenant_id AND id = s.id;
      IF NOT EXISTS (SELECT 1 FROM public.packages pk JOIN public.invoices i ON i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id WHERE pk.tenant_id = s.tenant_id AND pk.id = s.package_id AND i.is_pkp_at_issue) AND v_split.vat > 0 THEN
        INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
        VALUES (s.tenant_id, NEW.branch_id, 'session', s.id, v_split.vat, NEW.finished_at, 'session_delivery', NEW.id);
      END IF;
    END IF;
    SELECT x.vat_recognised_amount INTO v_attr FROM public.package_sessions x WHERE x.tenant_id = s.tenant_id AND x.id = s.id;
    IF EXISTS (SELECT 1 FROM public.packages pk JOIN public.invoices i ON i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id WHERE pk.tenant_id = s.tenant_id AND pk.id = s.package_id AND i.is_pkp_at_issue) AND v_attr <> 0 THEN
      INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
      SELECT s.tenant_id, pk.sold_branch_id, 'package', pk.id, -v_attr, NEW.finished_at, 'session_attribution', s.id FROM public.packages pk WHERE pk.tenant_id = s.tenant_id AND pk.id = s.package_id
      UNION ALL SELECT s.tenant_id, NEW.branch_id, 'session', s.id, v_attr, NEW.finished_at, 'session_attribution', s.id;
    END IF;
    PERFORM public.package_sync_vat(s.tenant_id, s.package_id, NEW.finished_at);
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (s.tenant_id, NEW.branch_id, 'SessionRedeemed', 'package_session', s.id, NEW.finished_by, NEW.finished_as,
            jsonb_build_object('session_id', s.id, 'package_id', s.package_id, 'execution_id', NEW.id, 'visit_id', NEW.visit_id));
  ELSE
    UPDATE public.package_sessions SET state = 'available', reserved_visit_id = NULL, reserved_execution_id = NULL, beneficiary_patient_id = NULL,
           returned_execution_ids = returned_execution_ids || NEW.id, version = version + 1
     WHERE tenant_id = s.tenant_id AND id = s.id;
    PERFORM public.package_sync_vat(s.tenant_id, s.package_id, NEW.finished_at);
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (s.tenant_id, NEW.branch_id, 'SessionReleased', 'package_session', s.id, NEW.finished_by, NEW.finished_as,
            jsonb_build_object('session_id', s.id, 'package_id', s.package_id, 'execution_id', NEW.id, 'reason', NEW.outcome));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
-- receivable_convert: from 0097_promo.sql
CREATE OR REPLACE FUNCTION public.receivable_convert(p_key text, p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  v public.visits;
  v_lines uuid[];
  v_invs uuid[];
  v_rems bigint[];
  v_id uuid := public.uuid_generate_v7();
  v_sum bigint := 0;
  r public.receivables;
BEGIN
  IF a.role NOT IN ('owner','manager','fo_cashier') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not convert to a receivable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.receivables x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF r.id IS NOT NULL THEN
    IF r.visit_id <> p_visit THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receivable with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('receivable_id', r.id, 'amount', r.amount);
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit AND (a.branch_id IS NULL OR x.branch_id = a.branch_id) FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  IF public.addition_unbilled_counted(v.tenant_id, v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: unbilled_addition' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.invoices i WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued' ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
   WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued' ORDER BY l.id FOR UPDATE OF l;
  -- The convertible lines: a delivered remainder (arrays, in line order).
  SELECT coalesce(array_agg(l.id ORDER BY l.id), '{}'), coalesce(array_agg(i.id ORDER BY l.id), '{}'),
         coalesce(array_agg(l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id), '{}')
    INTO v_lines, v_invs, v_rems
    FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
   WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued'
     AND l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0
     AND public.refund_line_delivered(l, i) AND NOT public.discount_pending(l.tenant_id, l.id);
  v_sum := coalesce((SELECT sum(x) FROM unnest(v_rems) x), 0);
  IF v_sum = 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing_to_convert' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = v.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = ANY (v_invs) AND ap.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: void_pending' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.receivables (id, tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by, created_as)
  VALUES (v_id, v.tenant_id, v.branch_id, public.patient_canonical(v.tenant_id, v.patient_id), v.id, v_sum, p_key, a.staff_id, a.role);
  FOR k IN 1 .. cardinality(v_lines) LOOP
    INSERT INTO public.receivable_lines (tenant_id, branch_id, receivable_id, invoice_line_id, amount) VALUES (v.tenant_id, v.branch_id, v_id, v_lines[k], v_rems[k]);
    INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
    SELECT l.tenant_id, v.branch_id, 'line', l.id, greatest(l.vat_recognised_amount, l.vat_amount) - l.vat_recognised_amount, clock_timestamp(), 'receivable_convert', v_id
      FROM public.invoice_lines l WHERE l.tenant_id = v.tenant_id AND l.id = v_lines[k] AND greatest(l.vat_recognised_amount, l.vat_amount) - l.vat_recognised_amount > 0;
    UPDATE public.invoice_lines SET receivable_amount = v_rems[k],
           vat_recognised_amount = greatest(vat_recognised_amount, vat_amount),
           vat_recognised_at = CASE WHEN vat_amount > 0 THEN coalesce(vat_recognised_at, clock_timestamp()) ELSE vat_recognised_at END
     WHERE tenant_id = v.tenant_id AND id = v_lines[k];
    UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = v.tenant_id AND invoice_id = v_invs[k] AND state = 'pending';
    PERFORM public.promo_usage_sync(v.tenant_id, v_lines[k]); -- T-081: a converted remainder settles the line
  END LOOP;
  PERFORM public.kasir_visit_payment(v.tenant_id, v.id);
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (v.tenant_id, v.branch_id, 'ReceivableCreated', 'receivable', v_id, a.staff_id, a.role, jsonb_build_object('receivable_id', v_id, 'visit_id', v.id));
  PERFORM public.audit_append('money_correction', 'receivable', v_id, 'success', 'receivable_created');
  RETURN jsonb_build_object('receivable_id', v_id, 'amount', v_sum);
END
$$;--> statement-breakpoint
-- interrupted_to_balance: from 0097_promo.sql
CREATE OR REPLACE FUNCTION public.interrupted_to_balance(p_key text, p_execution uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['fo_cashier','manager','owner']);
  e public.treatment_executions;
  v public.visits;
  t public.plan_items;
  l public.invoice_lines;
  v_amount bigint;
  v_vat bigint;
  v_service uuid;
  v_entry uuid;
BEGIN
  SELECT * INTO e FROM public.treatment_executions x WHERE x.tenant_id = a.tenant_id AND x.id = p_execution;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = e.visit_id AND (a.branch_id IS NULL OR x.branch_id = a.branch_id) FOR UPDATE;
  IF e.id IS NULL OR v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: execution not found' USING ERRCODE = 'P0002';
  END IF;
  -- Replay: the entry this execution already moved.
  SELECT x.id INTO v_entry FROM public.balance_entries x WHERE x.tenant_id = e.tenant_id AND x.source_kind = 'treatment_execution' AND x.source_id = e.id;
  IF v_entry IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_moved' USING ERRCODE = '55000';
  END IF;
  IF e.state <> 'finished' OR e.outcome NOT IN ('medical_stop','clinic_stop') OR public.package_execution_covered(e.tenant_id, e.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_movable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = e.tenant_id AND x.id = e.plan_item_id;
  IF public.addition_of_visit(e.tenant_id, v.id, t.id) THEN
    l := public.addition_line(e.tenant_id, v.id, t.id);
    SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = e.tenant_id AND x.id = l.id FOR UPDATE;
    IF l.id IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_movable' USING ERRCODE = '55000';
    END IF;
    v_amount := public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(l.tenant_id, l.id);
    UPDATE public.invoice_lines SET cancelled_amount = greatest(0, l.line_total - public.kasir_line_paid(l.tenant_id, l.id))
     WHERE tenant_id = l.tenant_id AND id = l.id AND cancelled_amount = 0;
    PERFORM public.promo_usage_sync(l.tenant_id, l.id); -- T-081 (r1 P1-1): the cancelled remainder settles a partly paid line
  ELSE
    v_service := public.package_plan_service(e.tenant_id, t.id);
    SELECT x.* INTO l FROM public.invoice_lines x JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
     WHERE x.tenant_id = e.tenant_id AND i.visit_id = v.id AND i.state = 'issued' AND public.invoice_is_ordinary(i.tenant_id, i.id)
       AND x.item_id = v_service AND public.kasir_line_paid(x.tenant_id, x.id) >= x.line_total
       AND public.kasir_line_paid(x.tenant_id, x.id) - x.moved_to_balance - public.refund_reserved(x.tenant_id, x.id) >= (x.line_total * t.qty) / x.quantity
     ORDER BY x.created_at, x.id LIMIT 1 FOR UPDATE OF x;
    IF l.id IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_movable' USING ERRCODE = '55000';
    END IF;
    v_amount := (l.line_total * t.qty) / l.quantity;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_movable' USING ERRCODE = '55000';
  END IF;
  v_vat := CASE WHEN l.line_total = 0 THEN 0 ELSE (l.vat_recognised_amount * v_amount) / l.line_total END;
  IF least(l.vat_recognised_amount, l.vat_reversed_amount + v_vat) - l.vat_reversed_amount > 0 THEN
    INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
    VALUES (l.tenant_id, v.branch_id, 'line', l.id, -(least(l.vat_recognised_amount, l.vat_reversed_amount + v_vat) - l.vat_reversed_amount), clock_timestamp(), 'interrupted', e.id);
  END IF;
  UPDATE public.invoice_lines SET moved_to_balance = moved_to_balance + v_amount,
         vat_reversed_amount = least(vat_recognised_amount, vat_reversed_amount + v_vat),
         vat_reversed_at = CASE WHEN least(vat_recognised_amount, vat_reversed_amount + v_vat) > 0 THEN coalesce(vat_reversed_at, clock_timestamp()) END
   WHERE tenant_id = l.tenant_id AND id = l.id;
  v_entry := public.balance_post(e.tenant_id, v.patient_id, v.branch_id, 'from_interrupted_treatment', v_amount,
                                 jsonb_build_object('source_kind', 'treatment_execution', 'source_id', e.id), p_key, a.staff_id, a.role);
  IF e.outcome = 'clinic_stop' AND NOT EXISTS (
       SELECT 1 FROM public.treatment_executions x WHERE x.tenant_id = e.tenant_id AND x.visit_id = v.id AND x.id <> e.id AND x.outcome = 'clinic_stop'
          AND NOT public.package_execution_covered(x.tenant_id, x.id)
          AND NOT EXISTS (SELECT 1 FROM public.balance_entries b WHERE b.tenant_id = x.tenant_id AND b.source_kind = 'treatment_execution' AND b.source_id = x.id)) THEN
    UPDATE public.visits SET blocker = NULL WHERE tenant_id = v.tenant_id AND id = v.id AND closed_at IS NULL AND blocker IS NOT NULL;
  END IF;
  PERFORM public.kasir_visit_payment(v.tenant_id, v.id);
  PERFORM public.audit_append('money_correction', 'treatment_execution', e.id, 'success', 'interrupted_to_balance');
  RETURN jsonb_build_object('entry_id', v_entry, 'amount', v_amount);
END
$$;--> statement-breakpoint
-- package_close_do: from 0098_package_sharing.sql
CREATE OR REPLACE FUNCTION public.package_close_do(pk public.packages, p_state text, p_reason text, p_staff uuid, p_role text, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_sub_move bigint;
  v_sub_vat bigint;
  l public.invoice_lines;
  v_paid bigint;
  v_redeemed bigint;
  v_unused bigint;
  v_remainder bigint;
  v_redeemed_vat bigint;
  sl record;
  v_sub_paid bigint;
  v_event uuid;
  v_fee public.consultation_fees;
  v_rev_before bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.package_sessions s JOIN public.treatment_executions e ON e.tenant_id = s.tenant_id AND e.id = s.reserved_execution_id
              WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'reserved' AND e.state IN ('started','paused')) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: session_in_treatment' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = pk.tenant_id AND x.id = pk.invoice_line_id FOR UPDATE;
  PERFORM 1 FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id ORDER BY x.seq FOR UPDATE;
  PERFORM public.package_sync_vat(pk.tenant_id, pk.id, p_at);
  SELECT x.vat_reversed_amount INTO v_rev_before FROM public.packages x WHERE x.tenant_id = pk.tenant_id AND x.id = pk.id;
  v_paid := public.package_paid(pk);
  SELECT coalesce(sum(s.allocated_value), 0), coalesce(sum(s.vat_recognised_amount), 0) INTO v_redeemed, v_redeemed_vat
    FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'redeemed';
  v_unused := greatest(0, v_paid - v_redeemed);
  v_remainder := greatest(0, l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id));
  -- Unredeemed sessions' substitution difference lines: unpaid remainder cancelled, real money paid moved with the rest.
  v_sub_paid := 0;
  FOR sl IN SELECT x.* FROM public.invoice_lines x JOIN public.package_substitutions u ON u.tenant_id = x.tenant_id AND u.id = x.substitution_id
              JOIN public.package_sessions s ON s.tenant_id = u.tenant_id AND s.id = u.session_id
              JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
             WHERE u.tenant_id = pk.tenant_id AND u.package_id = pk.id AND s.state <> 'redeemed' AND i.state = 'issued' ORDER BY x.id FOR UPDATE OF x LOOP
    -- T-078 (r1 #4): only the value not already moved (a refund) nor reserved by a pending cash refund; VAT in proportion.
    v_sub_move := greatest(0, public.kasir_line_paid(sl.tenant_id, sl.id) - sl.moved_to_balance - public.refund_reserved(sl.tenant_id, sl.id));
    v_sub_vat := least(sl.vat_recognised_amount - sl.vat_reversed_amount,
                       CASE WHEN sl.line_total = 0 THEN 0 ELSE (sl.vat_recognised_amount * v_sub_move) / sl.line_total END);
    UPDATE public.invoice_lines SET cancelled_amount = greatest(0, sl.line_total - public.kasir_line_paid(sl.tenant_id, sl.id)),
           moved_to_balance = sl.moved_to_balance + v_sub_move,
           vat_reversed_amount = sl.vat_reversed_amount + v_sub_vat,
           vat_reversed_at = CASE WHEN sl.vat_reversed_amount + v_sub_vat > 0 THEN coalesce(sl.vat_reversed_at, p_at) END
     WHERE tenant_id = sl.tenant_id AND id = sl.id;
    IF v_sub_vat > 0 THEN
      INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
      VALUES (sl.tenant_id, pk.sold_branch_id, 'line', sl.id, -v_sub_vat, p_at, 'package_close_line', pk.id);
    END IF;
    v_sub_paid := v_sub_paid + v_sub_move;
  END LOOP;
  UPDATE public.package_sessions SET state = 'closed', reserved_visit_id = NULL, reserved_execution_id = NULL, beneficiary_patient_id = NULL, version = version + 1
   WHERE tenant_id = pk.tenant_id AND package_id = pk.id AND state IN ('available','reserved');
  IF v_remainder > 0 THEN
    UPDATE public.invoice_lines SET cancelled_amount = v_remainder WHERE tenant_id = l.tenant_id AND id = l.id;
  END IF;
  -- T-081 (BILL-36, r1 P1-2): nothing paid → the line is removed (released; a void has already released its uses as void before
  -- calling here, so the release below is then a no-op); paid → settled
  -- (consumed), and an unredeemed paid package cancelled is the purchase refunded in full (released).
  IF public.kasir_line_paid(l.tenant_id, l.id) = 0 THEN
    PERFORM public.promo_release(l.tenant_id, l.id, 'reserved', 'removed');
  ELSE
    PERFORM public.promo_usage_sync(l.tenant_id, l.id);
    IF p_state = 'cancelled' AND p_reason IS DISTINCT FROM 'invoice_void' AND v_redeemed = 0 THEN
      PERFORM public.promo_release(l.tenant_id, l.id, 'consumed', 'refunded_full');
    END IF;
  END IF;
  UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = pk.tenant_id AND invoice_id = pk.invoice_id AND state = 'pending';
  UPDATE public.packages SET state = p_state, closed_at = p_at, closed_by = p_staff, closed_as = p_role, close_reason = p_reason,
         paid_unused_moved = v_unused + v_sub_paid, remainder_cancelled = v_remainder,
         vat_reversed_amount = greatest(vat_reversed_amount, l.vat_recognised_amount - v_redeemed_vat),
         vat_reversed_at = CASE WHEN greatest(vat_reversed_amount, l.vat_recognised_amount - v_redeemed_vat) > 0 THEN coalesce(vat_reversed_at, p_at) END
   WHERE tenant_id = pk.tenant_id AND id = pk.id;
  IF greatest(v_rev_before, l.vat_recognised_amount - v_redeemed_vat) - v_rev_before > 0 THEN
    INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
    VALUES (pk.tenant_id, pk.sold_branch_id, 'package', pk.id, -(greatest(v_rev_before, l.vat_recognised_amount - v_redeemed_vat) - v_rev_before), p_at, 'package_close_package', pk.id);
  END IF;
  IF v_unused + v_sub_paid > 0 THEN
    PERFORM public.balance_post(pk.tenant_id, pk.patient_id, pk.sold_branch_id, CASE WHEN p_state = 'expired' THEN 'from_expiry' ELSE 'from_cancel' END,
                                v_unused + v_sub_paid, jsonb_build_object('source_kind', 'package', 'source_id', pk.id), 'package_close:' || pk.id::text, p_staff, p_role);
  END IF;
  -- T-079 (PR-12, r1 P1-2): a package cancelled (not by an invoice void) with nothing redeemed is a refund of the purchase.
  IF p_state = 'cancelled' AND p_reason IS DISTINCT FROM 'invoice_void' AND v_redeemed = 0 THEN
    PERFORM public.consultation_controls_cancel(pk.tenant_id, pk.invoice_line_id, NULL);
    v_fee := public.consultation_recharge_due(pk.tenant_id, pk.invoice_line_id, NULL);
    IF v_fee.id IS NOT NULL THEN
      PERFORM 1 FROM public.visits x WHERE x.tenant_id = v_fee.tenant_id AND x.id = v_fee.visit_id FOR UPDATE;
      PERFORM public.consultation_recharge(v_fee, 'package', pk.id, v_unused + v_sub_paid, p_staff, p_role);
    END IF;
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (pk.tenant_id, pk.sold_branch_id, CASE WHEN p_state = 'expired' THEN 'PackageExpired' ELSE 'PackageCancelled' END, 'package', pk.id, p_staff, p_role,
          jsonb_build_object('package_id', pk.id, 'patient_id', pk.patient_id))
  RETURNING id INTO v_event;
  RETURN jsonb_build_object('package_id', pk.id, 'state', p_state, 'to_balance', v_unused + v_sub_paid, 'cancelled', v_remainder);
END
$$;--> statement-breakpoint
-- package_sync_vat: from 0091_packages.sql
CREATE OR REPLACE FUNCTION public.package_sync_vat(p_tenant uuid, p_package uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk public.packages;
  l public.invoice_lines;
  v_pool bigint;
  v_open bigint;
  s record;
  v_give bigint;
BEGIN
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = p_tenant AND x.id = p_package;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id AND i.is_pkp_at_issue) THEN
    RETURN;
  END IF;
  l := public.package_line(pk);
  v_pool := greatest(0, l.vat_recognised_amount - pk.vat_reversed_amount);
  SELECT coalesce(sum(x.vat_amount), 0) INTO v_open FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id AND x.state <> 'closed';
  IF v_pool > v_open THEN
    UPDATE public.packages SET vat_reversed_amount = vat_reversed_amount + (v_pool - v_open), vat_reversed_at = coalesce(vat_reversed_at, p_at)
     WHERE tenant_id = pk.tenant_id AND id = pk.id;
    INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
    VALUES (pk.tenant_id, pk.sold_branch_id, 'package', pk.id, -(v_pool - v_open), p_at, 'package_sync_reversal', NULL);
    v_pool := v_open;
  END IF;
  FOR s IN SELECT x.id, x.vat_amount, x.vat_recognised_amount FROM public.package_sessions x
            WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id AND x.state <> 'closed'
            ORDER BY CASE x.state WHEN 'redeemed' THEN 1 WHEN 'reserved' THEN 2 ELSE 3 END, x.seq LOOP
    v_give := least(v_pool, s.vat_amount);
    v_pool := v_pool - v_give;
    IF v_give <> s.vat_recognised_amount THEN
      UPDATE public.package_sessions SET vat_recognised_amount = v_give, vat_recognised_at = CASE WHEN v_give > 0 THEN coalesce(vat_recognised_at, p_at) END,
             version = version + 1
       WHERE tenant_id = pk.tenant_id AND id = s.id;
      IF (SELECT x.state FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.id = s.id) = 'redeemed' AND v_give - s.vat_recognised_amount <> 0 THEN
        INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
        SELECT pk.tenant_id, pk.sold_branch_id, 'package', pk.id, -(v_give - s.vat_recognised_amount), p_at, 'session_attribution', s.id
        UNION ALL SELECT pk.tenant_id, coalesce(x.redeemed_branch_id, pk.sold_branch_id), 'session', s.id, v_give - s.vat_recognised_amount, p_at, 'session_attribution', s.id
          FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.id = s.id;
      END IF;
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
-- deposit_apply_do: from 0097_promo.sql
CREATE OR REPLACE FUNCTION public.deposit_apply_do(i public.invoices, d public.booking_deposits, p_staff uuid, p_role text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  il public.invoice_lines;
  v_vat bigint;
BEGIN
  SELECT x.* INTO il FROM public.invoice_lines x
   WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id AND x.item_id = (SELECT cv.item_id FROM public.catalog_versions cv WHERE cv.tenant_id = d.tenant_id AND cv.id = d.catalog_version_id)
     AND x.plan_item_id IS NULL AND x.substitution_id IS NULL
     AND x.line_total - x.cancelled_amount - x.receivable_amount - public.kasir_line_paid(x.tenant_id, x.id) >= d.amount AND NOT public.discount_pending(x.tenant_id, x.id)
     AND NOT EXISTS (SELECT 1 FROM public.booking_deposits o WHERE o.tenant_id = x.tenant_id AND o.applied_line_id = x.id)
   ORDER BY x.created_at, x.id LIMIT 1 FOR UPDATE;
  IF il.id IS NULL THEN
    RETURN NULL;
  END IF;
  v_vat := least(d.vat_recognised_amount, il.vat_amount - il.vat_recognised_amount);
  UPDATE public.booking_deposits SET state = 'applied', applied_line_id = il.id, decision_code = 'applied_on_arrival', decided_by = p_staff, decided_as = p_role,
         decided_at = clock_timestamp(), vat_recognised_amount = 0
   WHERE tenant_id = d.tenant_id AND id = d.id;
  IF v_vat > 0 THEN
    UPDATE public.invoice_lines SET vat_recognised_amount = vat_recognised_amount + v_vat, vat_recognised_at = coalesce(vat_recognised_at, clock_timestamp())
     WHERE tenant_id = il.tenant_id AND id = il.id;
  END IF;
  IF d.vat_recognised_amount > 0 THEN
    INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
    VALUES (d.tenant_id, d.branch_id, 'deposit', d.id, -d.vat_recognised_amount, clock_timestamp(), 'deposit_apply', d.id);
  END IF;
  IF v_vat > 0 THEN
    INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
    VALUES (il.tenant_id, il.branch_id, 'line', il.id, v_vat, clock_timestamp(), 'deposit_apply', d.id);
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (d.tenant_id, i.branch_id, 'BookingDepositApplied', 'booking_deposit', d.id, p_staff, p_role,
          jsonb_build_object('deposit_id', d.id, 'invoice_id', i.id, 'invoice_line_id', il.id));
  PERFORM public.promo_usage_sync(il.tenant_id, il.id); -- T-081
  RETURN il.id;
END
$$;--> statement-breakpoint

-- ── T-104 movements (plan r5 §2, addendum a1 r2, Sol impl r1 repairs): every sub-ledger movement of a tenant, from the immutable facts ──
-- One row per (ledger, term, fact). day = the fact's own local business date (branch time zone). Patient balance and receivables gross;
-- the two net-of-VAT liabilities (paid-not-delivered, package liability) are their GROSS money movements minus the VAT movements of their
-- own VAT objects (11 :63) — the same dated facts, seam events and cutover residues as the VAT ledger, so liability + VAT = gross by
-- construction and no mutable field (a session's tax category or VAT amount) is read. Simulated money never counts (BILL-29).
-- `incomplete` (owner D-C1, Panel 2 R1): a VAT-object movement before the tenant's cutover on an object that carries a pre-cutover residue
-- (residue <> 0) is known but its object's history is not complete until the residue row (dated at the cutover) is also counted: a reader
-- claims no opening or closing that includes such a row without the residue rows. Objects without a residue, every movement from the cutover
-- on, and the non-VAT ledgers are always exact.
-- Not granted: called only by the definer readers below, which pass the actor's own tenant.
-- lazy: recomputed from all history on every read; a materialised per-month snapshot is the upgrade once a tenant's volume needs it.
CREATE FUNCTION public.subledger_movements(p_tenant uuid)
RETURNS TABLE (ledger text, term text, day date, at timestamptz, branch_id uuid, dim text, amount bigint, source_kind text, source_id uuid,
               object_kind text, object_id uuid, incomplete boolean)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
WITH
cut AS (SELECT coalesce((SELECT c.cutover_at FROM public.vat_cutovers c WHERE c.tenant_id = p_tenant), '-infinity'::timestamptz) AS at),
pkl AS (SELECT pk.*, i.is_pkp_at_issue FROM public.packages pk JOIN public.invoices i ON i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id WHERE pk.tenant_id = p_tenant),
-- an invoice line's owner: the package of its own line, the package of its substitution (difference line), or none (ordinary)
own AS (
  SELECT l.id AS line_id, l.branch_id, l.line_total, l.vat_amount, l.quantity, l.item_id, l.plan_item_id, l.substitution_id, l.invoice_id,
         coalesce(p1.id, p2.id) AS package_id, p1.id IS NOT NULL AS package_line, u.session_id AS diff_session, l.created_at
    FROM public.invoice_lines l
    LEFT JOIN pkl p1 ON p1.invoice_line_id = l.id
    LEFT JOIN public.package_substitutions u ON u.tenant_id = l.tenant_id AND u.id = l.substitution_id
    LEFT JOIN pkl p2 ON p2.id = u.package_id
   WHERE l.tenant_id = p_tenant),
alloc AS (SELECT a.* FROM public.payment_allocations a WHERE a.tenant_id = p_tenant AND NOT a.is_simulated),
-- seam events from the tenant's cutover on (an event inside the cutover transaction itself is in that object's residue)
ev AS (SELECT e.* FROM public.vat_events e WHERE e.tenant_id = p_tenant AND e.effective_at >= (SELECT at FROM cut)),
res AS (SELECT o.object_kind, o.object_id FROM public.vat_cutover_openings o WHERE o.tenant_id = p_tenant),
-- a pre-cutover interrupted move (S3 unrecorded) reconstructed only where provable FROM THE PRE-CUTOVER SNAPSHOT (Sol r2 #1: never from later
-- facts, so a later interruption or deposit decision cannot change it): the only interruption of that line before the cutover, the line
-- carrying no deposit applied before the cutover, by the writer's formula over the dated recognition (vat_portion) and reversals (paid
-- refunds) up to it (Sol r1 P1-3); otherwise its VAT stays in the line's residue. A move from the cutover on is S3 (never reconstructed).
intr AS (
  SELECT b.id AS entry_id, b.source_id AS execution_id, b.created_at, b.branch_id, b.amount, x.line_id, x.line_total,
         CASE WHEN b.created_at >= (SELECT at FROM cut) OR x.line_id IS NULL OR x.line_total = 0 OR x.n_moves <> 1 OR x.dp THEN NULL
              ELSE least(x.rec - x.rev, (x.rec * b.amount) / x.line_total) END AS vat_rev
    FROM public.balance_entries b
    LEFT JOIN LATERAL (
      SELECT o.line_id, o.line_total,
             coalesce((SELECT sum(a.vat_portion) FROM alloc a WHERE a.invoice_line_id = o.line_id AND a.created_at <= b.created_at), 0) AS rec,
             coalesce((SELECT sum(r.vat_reversed) FROM public.refunds r WHERE r.tenant_id = p_tenant AND r.invoice_line_id = o.line_id AND r.state = 'paid' AND r.paid_at <= b.created_at), 0) AS rev,
             -- interruptions moved from THIS line before the cutover (the same line resolution for each execution)
             (SELECT count(*) FROM public.balance_entries b2 JOIN public.treatment_executions e2 ON e2.tenant_id = b2.tenant_id AND e2.id = b2.source_id
                JOIN public.plan_items t2 ON t2.tenant_id = e2.tenant_id AND t2.id = e2.plan_item_id
               WHERE b2.tenant_id = p_tenant AND b2.kind = 'from_interrupted_treatment' AND b2.created_at < (SELECT at FROM cut)
                 AND EXISTS (SELECT 1 FROM public.invoices i2 WHERE i2.tenant_id = p_tenant AND i2.id = o.invoice_id AND i2.visit_id = e2.visit_id)
                 AND (o.plan_item_id = e2.plan_item_id OR o.plan_item_id IS NULL AND o.item_id = public.package_plan_service(e2.tenant_id, e2.plan_item_id))) AS n_moves,
             EXISTS (SELECT 1 FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.applied_line_id = o.line_id AND d.state = 'applied'
                       AND d.decided_at < (SELECT at FROM cut)) AS dp
        FROM public.treatment_executions e JOIN public.invoices i ON i.tenant_id = p_tenant AND i.visit_id = e.visit_id AND i.state = 'issued'
        JOIN own o ON o.invoice_id = i.id AND o.package_id IS NULL AND o.substitution_id IS NULL
       WHERE e.tenant_id = p_tenant AND e.id = b.source_id
         AND (o.plan_item_id = e.plan_item_id OR o.plan_item_id IS NULL AND o.item_id = public.package_plan_service(e.tenant_id, e.plan_item_id))
       ORDER BY (o.plan_item_id IS NOT NULL) DESC, o.created_at, o.line_id LIMIT 1) x ON true
   WHERE b.tenant_id = p_tenant AND b.kind = 'from_interrupted_treatment'),
-- VAT movements of every canonical object (the VAT ledger and the liabilities' VAT components)
vatm AS (
  SELECT CASE WHEN a.booking_deposit_id IS NOT NULL THEN 'dp_vat' ELSE 'payment_vat' END AS term, a.created_at AS at, a.branch_id, a.vat_portion AS amount,
         'payment_allocation'::text AS sk, a.id AS sid,
         CASE WHEN a.booking_deposit_id IS NOT NULL THEN 'deposit' WHEN o.package_line THEN 'package' ELSE 'line' END AS ok,
         coalesce(a.booking_deposit_id, CASE WHEN o.package_line THEN o.package_id ELSE o.line_id END) AS oid, NULL::uuid AS src
    FROM alloc a LEFT JOIN own o ON o.line_id = a.invoice_line_id WHERE a.vat_portion > 0
  UNION ALL
  SELECT 'dp_reversal', d.decided_at, d.branch_id, -d.vat_amount, 'booking_deposit', d.id, 'deposit', d.id, NULL
    FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state IN ('moved_to_balance','refunded') AND d.vat_amount > 0
  UNION ALL
  SELECT CASE WHEN r.delivered THEN 'refund_reversal_delivered' ELSE 'refund_reversal' END, r.paid_at, r.branch_id, -r.vat_reversed, 'refund', r.id, 'line', r.invoice_line_id, NULL
    FROM public.refunds r WHERE r.tenant_id = p_tenant AND r.state = 'paid' AND r.vat_reversed > 0
  UNION ALL
  SELECT 'interrupted', x.created_at, x.branch_id, -x.vat_rev, 'balance_entry', x.entry_id, 'line', x.line_id, NULL
    FROM intr x WHERE x.created_at < (SELECT at FROM cut) AND x.vat_rev > 0
  UNION ALL
  SELECT e.cause, e.effective_at, e.branch_id, e.delta, 'vat_event', e.id, e.object_kind, e.object_id, e.source_id FROM ev e
  UNION ALL
  SELECT 'cutover_residue', o.cutover_at, o.branch_id, o.amount, 'vat_cutover_opening', o.id, o.object_kind, o.object_id, NULL
    FROM public.vat_cutover_openings o WHERE o.tenant_id = p_tenant),
-- which liability a VAT object's movement belongs to: an ordinary line → paid-not-delivered; the package object and a difference line of a
-- package → package liability; a session's VAT is delivered VAT (out of any liability); a deposit is carried net already (vat_base)
vobj AS (
  SELECT v.*, CASE WHEN v.ok IN ('deposit','session') OR v.term = 'refund_reversal_delivered' THEN NULL
                   WHEN v.ok = 'package' THEN 'package_liability'
                   WHEN (SELECT o.package_id FROM own o WHERE o.line_id = v.oid) IS NOT NULL THEN 'package_liability'
                   ELSE 'paid_not_delivered' END AS liab,
         CASE WHEN v.ok = 'package' THEN v.oid WHEN v.ok = 'session' THEN (SELECT s.package_id FROM public.package_sessions s WHERE s.tenant_id = p_tenant AND s.id = v.oid)
              WHEN v.ok = 'line' THEN (SELECT o.package_id FROM own o WHERE o.line_id = v.oid) END AS pkg,
         v.at < (SELECT at FROM cut) AND v.sk <> 'vat_cutover_opening' AND EXISTS (SELECT 1 FROM res r WHERE r.object_kind = v.ok AND r.object_id = v.oid) AS inc
    FROM vatm v),
-- patient balance: FIFO consumption of credits by debits per account (owner D-B2): overlap of cumulative intervals over seq
be AS (SELECT b.*, sum(abs(b.amount)) FILTER (WHERE b.amount > 0) OVER w AS c_hi, sum(abs(b.amount)) FILTER (WHERE b.amount < 0) OVER w AS d_hi
         FROM public.balance_entries b WHERE b.tenant_id = p_tenant
       WINDOW w AS (PARTITION BY b.account_id ORDER BY b.seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)),
cr AS (SELECT be.*, be.c_hi - be.amount AS c_lo FROM be WHERE be.amount > 0),
db AS (SELECT be.*, be.d_hi + be.amount AS d_lo FROM be WHERE be.amount < 0),
fifo AS (SELECT db.id AS debit_id, db.kind, db.created_at, cr.branch_id AS origin_branch, cr.id AS credit_id, db.account_id,
                least(cr.c_hi, db.d_hi) - greatest(cr.c_lo, db.d_lo) AS amt
           FROM db JOIN cr ON cr.account_id = db.account_id AND cr.c_lo < db.d_hi AND db.d_lo < cr.c_hi),
-- package liability, money (its VAT component comes from vobj: the package object — payment VAT, S1b/S5b attribution to a delivered session,
-- S4/S5 reversals, residue — and difference lines): settlements of the own line and difference lines (gross); a redemption takes the
-- session's allocated value (a PKP-at-issue package's session VAT leaves through the attribution; a non-PKP-at-issue session's VAT is first
-- due at delivery, S1, inside that value) plus the dearer difference line's remaining net of its VAT position; a cheaper substitution moves
-- its gross difference to balance (its VAT reversal is S5, now or later); a difference line refunded (undelivered); the close moves the gross
pkg_gross AS (
  SELECT o.package_id, 'settlement'::text AS term, a.created_at AS at, a.amount AS amount, 'payment_allocation'::text AS sk, a.id AS sid
    FROM alloc a JOIN own o ON o.line_id = a.invoice_line_id WHERE o.package_id IS NOT NULL
  UNION ALL
  SELECT s.package_id, 'redemption', s.redeemed_at,
         -(s.allocated_value
           + coalesce((SELECT sum(a.amount) FROM alloc a JOIN own o ON o.line_id = a.invoice_line_id WHERE o.diff_session = s.id AND a.created_at <= s.redeemed_at), 0)
           - coalesce((SELECT sum(r.amount) FROM public.refunds r JOIN own o ON o.line_id = r.invoice_line_id
                        WHERE r.tenant_id = p_tenant AND o.diff_session = s.id AND r.state = 'paid' AND r.paid_at <= s.redeemed_at), 0)
           -- the difference line's VAT position leaves with the delivery (its VAT movements stay subtracted in the VAT component)
           - coalesce((SELECT sum(v.amount) FROM vobj v JOIN own o ON o.line_id = v.oid WHERE v.ok = 'line' AND o.diff_session = s.id AND v.at <= s.redeemed_at), 0)),
         'package_session', s.id
    FROM public.package_sessions s JOIN pkl p ON p.id = s.package_id WHERE s.tenant_id = p_tenant AND s.state = 'redeemed'
  UNION ALL
  SELECT u.package_id, 'substitution', u.decided_at, u.difference, 'package_substitution', u.id
    FROM public.package_substitutions u JOIN pkl p ON p.id = u.package_id WHERE u.tenant_id = p_tenant AND u.state = 'approved' AND u.difference < 0
  UNION ALL
  SELECT o.package_id, 'refund', r.paid_at, -r.amount, 'refund', r.id
    FROM public.refunds r JOIN own o ON o.line_id = r.invoice_line_id
   WHERE r.tenant_id = p_tenant AND r.state = 'paid' AND NOT r.delivered AND o.package_id IS NOT NULL
  UNION ALL
  SELECT p.id, 'close', p.closed_at,
         -coalesce((SELECT sum(b.amount) FROM public.balance_entries b WHERE b.tenant_id = p_tenant AND b.source_kind = 'package' AND b.source_id = p.id
                     AND b.kind IN ('from_expiry','from_cancel')), 0),
         'package', p.id
    FROM pkl p WHERE p.closed_at IS NOT NULL),
-- the delivered ordinary line of a counted single treatment (the commission performer's line rule, 0102)
exe AS (
  SELECT e.id, e.branch_id, e.finished_at, t.qty, l.line_id, l.line_total, l.vat_amount, l.quantity
    FROM public.treatment_executions e JOIN public.plan_items t ON t.tenant_id = e.tenant_id AND t.id = e.plan_item_id
    CROSS JOIN LATERAL (
      SELECT o.* FROM own o JOIN public.invoices i ON i.tenant_id = p_tenant AND i.id = o.invoice_id
       WHERE i.visit_id = e.visit_id AND i.state = 'issued' AND o.substitution_id IS NULL AND o.package_id IS NULL AND NOT i.consultation
         AND (o.plan_item_id = e.plan_item_id OR o.plan_item_id IS NULL AND o.item_id = public.package_plan_service(e.tenant_id, e.plan_item_id)
                                                 AND NOT public.addition_of_visit(e.tenant_id, e.visit_id, e.plan_item_id))
       ORDER BY (o.plan_item_id IS NOT NULL) DESC, o.created_at, o.line_id LIMIT 1) l
   WHERE e.tenant_id = p_tenant AND e.state = 'finished' AND e.counted AND NOT public.package_execution_covered(e.tenant_id, e.id)),
-- a handed product: its counter line, or the visit's line of that catalog item
disp AS (
  SELECT d.id, d.branch_id, d.handed_at, d.quantity, l.line_id, l.line_total, l.vat_amount, l.quantity AS line_qty
    FROM public.dispensings d
    LEFT JOIN public.stock_items si ON si.tenant_id = d.tenant_id AND si.id = d.stock_item_id
    CROSS JOIN LATERAL (
      SELECT o.* FROM own o LEFT JOIN public.invoices i ON i.tenant_id = p_tenant AND i.id = o.invoice_id
       WHERE o.line_id = d.invoice_line_id
          OR d.invoice_line_id IS NULL AND i.visit_id = d.visit_id AND i.state = 'issued' AND o.item_id = si.catalog_item_id
             AND o.plan_item_id IS NULL AND o.substitution_id IS NULL AND o.package_id IS NULL
       ORDER BY (o.line_id = d.invoice_line_id) DESC, o.created_at, o.line_id LIMIT 1) l
   WHERE d.tenant_id = p_tenant AND d.state = 'handed'),
-- every row (ledger, term, day, at, branch_id, dim, amount, source_kind, source_id, object_kind, object_id, incomplete)
m (ledger, term, day, at, branch_id, dim, amount, source_kind, source_id, object_kind, object_id, incomplete) AS (
-- ── cash / bank (dim: cash, petty_cash, bank) and gateway clearing (dim: the method) ──
SELECT CASE WHEN y.method IN ('cash','transfer') THEN 'cash_bank' ELSE 'gateway_clearing' END, 'receipt',
       public.tax_local_date(p_tenant, y.received_at, y.branch_id), y.received_at, y.branch_id,
       CASE y.method WHEN 'cash' THEN 'cash' WHEN 'transfer' THEN 'bank' ELSE y.method END, y.amount, 'payment', y.id, NULL::text, NULL::uuid, false
  FROM public.payments y WHERE y.tenant_id = p_tenant AND NOT y.is_simulated AND y.method <> 'balance'
UNION ALL
SELECT CASE WHEN d.refund_method = 'edc' THEN 'gateway_clearing' ELSE 'cash_bank' END, 'refund_dp', public.tax_local_date(p_tenant, d.decided_at, d.branch_id),
       d.decided_at, d.branch_id, CASE d.refund_method WHEN 'cash' THEN 'cash' WHEN 'transfer' THEN 'bank' ELSE d.refund_method END, -d.amount,
       'booking_deposit', d.id, NULL, NULL, false
  FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state = 'refunded'
UNION ALL
SELECT 'cash_bank', 'refund', public.tax_local_date(p_tenant, r.paid_at, r.branch_id), r.paid_at, r.branch_id,
       CASE r.paid_method WHEN 'cash' THEN 'cash' ELSE 'bank' END, b.amount, 'refund', r.id, NULL, NULL, false
  FROM public.refunds r JOIN public.balance_entries b ON b.tenant_id = r.tenant_id AND b.id = r.cash_entry_id
 WHERE r.tenant_id = p_tenant AND r.state = 'paid'
UNION ALL
SELECT 'cash_bank', 'commission_paid', public.tax_local_date(p_tenant, pb.paid_at, NULL), pb.paid_at, NULL,
       CASE pb.paid_method WHEN 'cash' THEN 'cash' ELSE 'bank' END, -sum(l.net_payable)::bigint, 'payout_batch', pb.id, NULL, NULL, false
  FROM public.payout_batches pb JOIN public.payout_batch_lines l ON l.tenant_id = pb.tenant_id AND l.batch_id = pb.id
 WHERE pb.tenant_id = p_tenant AND pb.state = 'paid' GROUP BY pb.id, pb.paid_at, pb.paid_method HAVING sum(l.net_payable) > 0
UNION ALL
SELECT 'cash_bank', 'expense', x.business_date, x.recorded_at, x.branch_id, CASE x.funding WHEN 'bank' THEN 'bank' ELSE x.funding END, -x.amount, 'expense', x.id, NULL, NULL, false
  FROM public.expenses x WHERE x.tenant_id = p_tenant AND x.funding IN ('petty_cash','cash','bank')
UNION ALL
SELECT 'cash_bank', 'expense_reversed', public.tax_local_date(p_tenant, x.reversed_at, x.branch_id), x.reversed_at, x.branch_id,
       CASE x.funding WHEN 'bank' THEN 'bank' ELSE x.funding END, x.amount, 'expense', x.id, NULL, NULL, false
  FROM public.expenses x WHERE x.tenant_id = p_tenant AND x.funding IN ('petty_cash','cash','bank') AND x.reversed_at IS NOT NULL
UNION ALL
SELECT 'cash_bank', 'supplier_payment', x.paid_on::date, x.recorded_at, x.branch_id, CASE x.method WHEN 'cash' THEN 'cash' ELSE 'bank' END, -x.amount,
       'supplier_payment', x.id, NULL, NULL, false
  FROM public.supplier_payments x WHERE x.tenant_id = p_tenant
UNION ALL
SELECT 'cash_bank', 'supplier_payment_reversed', public.tax_local_date(p_tenant, x.reversed_at, x.branch_id), x.reversed_at, x.branch_id,
       CASE x.method WHEN 'cash' THEN 'cash' ELSE 'bank' END, x.amount, 'supplier_payment', x.id, NULL, NULL, false
  FROM public.supplier_payments x WHERE x.tenant_id = p_tenant AND x.reversed_at IS NOT NULL
-- ── paid-not-delivered (ordinary lines): money in gross, delivery at the contractual net (line total − its VAT, frozen at issue; plan r5
-- §2.1), and the VAT component of the line objects (vobj) ──
UNION ALL
SELECT 'paid_not_delivered', 'settlement', public.tax_local_date(p_tenant, a.created_at, a.branch_id), a.created_at, a.branch_id, NULL, a.amount, 'payment_allocation', a.id, 'line', o.line_id, false
  FROM alloc a JOIN own o ON o.line_id = a.invoice_line_id WHERE o.package_id IS NULL
UNION ALL
SELECT 'paid_not_delivered', 'dp_applied', public.tax_local_date(p_tenant, d.decided_at, d.branch_id), d.decided_at, d.branch_id, NULL, d.amount, 'booking_deposit', d.id, 'line', d.applied_line_id, false
  FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state = 'applied'
UNION ALL
SELECT 'paid_not_delivered', 'receivable_convert', public.tax_local_date(p_tenant, rv.created_at, rv.branch_id), rv.created_at, rv.branch_id, NULL, rl.amount, 'receivable', rv.id, 'line', rl.invoice_line_id, false
  FROM public.receivables rv JOIN public.receivable_lines rl ON rl.tenant_id = rv.tenant_id AND rl.receivable_id = rv.id WHERE rv.tenant_id = p_tenant
UNION ALL
SELECT 'paid_not_delivered', 'performance', public.tax_local_date(p_tenant, x.finished_at, x.branch_id), x.finished_at, x.branch_id, NULL, -(((x.line_total - x.vat_amount) * x.qty) / x.quantity), 'treatment_execution', x.id, 'line', x.line_id, false
  FROM exe x
UNION ALL
SELECT 'paid_not_delivered', 'performance', public.tax_local_date(p_tenant, x.handed_at, x.branch_id), x.handed_at, x.branch_id, NULL, -floor(((x.line_total - x.vat_amount) * x.quantity) / x.line_qty)::bigint, 'dispensing', x.id, 'line', x.line_id, false
  FROM disp x
UNION ALL
SELECT 'paid_not_delivered', 'performance', public.tax_local_date(p_tenant, CASE WHEN f.state = 'recharged' THEN f.recharged_at ELSE f.decided_at END, f.branch_id),
       CASE WHEN f.state = 'recharged' THEN f.recharged_at ELSE f.decided_at END, f.branch_id, NULL, -(o.line_total - o.vat_amount), 'consultation_fee', f.id, 'line', o.line_id, false
  FROM public.consultation_fees f JOIN own o ON o.line_id = f.fee_line_id WHERE f.tenant_id = p_tenant AND f.state IN ('charged','recharged')
UNION ALL
SELECT 'paid_not_delivered', 'refund', public.tax_local_date(p_tenant, r.paid_at, r.branch_id), r.paid_at, r.branch_id, NULL, -r.amount, 'refund', r.id, 'line', r.invoice_line_id, false
  FROM public.refunds r JOIN own o ON o.line_id = r.invoice_line_id
 WHERE r.tenant_id = p_tenant AND r.state = 'paid' AND NOT r.delivered AND o.package_id IS NULL
UNION ALL
SELECT 'paid_not_delivered', 'interrupted', public.tax_local_date(p_tenant, x.created_at, x.branch_id), x.created_at, x.branch_id, NULL, -x.amount, 'balance_entry', x.entry_id, 'line', x.line_id, false
  FROM intr x
-- the VAT component of both net liabilities: every VAT-object movement, with the opposite sign, in its owning liability
UNION ALL
SELECT v.liab, 'vat_' || v.term, public.tax_local_date(p_tenant, v.at, v.branch_id), v.at, v.branch_id, NULL, -v.amount, v.sk, v.sid,
       CASE WHEN v.liab = 'package_liability' THEN 'package' ELSE v.ok END, CASE WHEN v.liab = 'package_liability' THEN v.pkg ELSE v.oid END, v.inc
  FROM vobj v WHERE v.liab IS NOT NULL
-- ── receivables (gross) ──
UNION ALL
SELECT 'receivables', 'created', public.tax_local_date(p_tenant, rv.created_at, rv.branch_id), rv.created_at, rv.branch_id, NULL, rv.amount, 'receivable', rv.id, 'receivable', rv.id, false
  FROM public.receivables rv WHERE rv.tenant_id = p_tenant
UNION ALL
SELECT 'receivables', 'collected', public.tax_local_date(p_tenant, c.received_at, c.branch_id), c.received_at, c.branch_id, NULL, -c.amount, 'receivable_collection', c.id, 'receivable', c.receivable_id, false
  FROM public.receivable_collections c WHERE c.tenant_id = p_tenant
UNION ALL
SELECT 'receivables', 'written_off', public.tax_local_date(p_tenant, w.created_at, w.branch_id), w.created_at, w.branch_id, NULL, -w.amount, 'write_off', w.id, 'receivable', w.receivable_id, false
  FROM public.write_offs w WHERE w.tenant_id = p_tenant
-- ── patient balance (gross): credits at their own branch; debits FIFO against their origin credits (D-B2) ──
UNION ALL
SELECT 'patient_balance', cr.kind, public.tax_local_date(p_tenant, cr.created_at, cr.branch_id), cr.created_at, cr.branch_id, NULL, cr.amount,
       'balance_entry', cr.id, 'balance_account', cr.account_id, false
  FROM cr
UNION ALL
SELECT 'patient_balance', f.kind, public.tax_local_date(p_tenant, f.created_at, f.origin_branch), f.created_at, f.origin_branch, f.credit_id::text, -f.amt,
       'balance_entry', f.debit_id, 'balance_account', f.account_id, false
  FROM fifo f WHERE f.amt > 0

-- ── package liability (gross money; its VAT component above) and inter-branch clearing ──
UNION ALL
SELECT 'package_liability', x.term, public.tax_local_date(p_tenant, x.at, p.sold_branch_id), x.at, p.sold_branch_id, NULL, x.amount, x.sk, x.sid, 'package', p.id, false
  FROM pkg_gross x JOIN pkl p ON p.id = x.package_id
UNION ALL
-- inter-branch: the liability value a redemption takes moves from the selling branch to the executing branch — its money term at the
-- redemption, and each attribution of package-object VAT to that session (S1b at the redemption, S5b later) at its own time
SELECT 'inter_branch', 'redemption', public.tax_local_date(p_tenant, x.at, b.br), x.at, b.br, NULL, b.sign * x.amount, x.sk, x.sid, 'package', p.id, false
  FROM (SELECT g.sid AS session_id, g.at, -g.amount AS amount, 'package_session'::text AS sk, g.sid FROM pkg_gross g WHERE g.term = 'redemption'
        UNION ALL
        SELECT v.src, v.at, v.amount, v.sk, v.sid FROM vobj v WHERE v.ok = 'package' AND v.term = 'session_attribution') x
  JOIN public.package_sessions s ON s.tenant_id = p_tenant AND s.id = x.session_id JOIN pkl p ON p.id = s.package_id
  CROSS JOIN LATERAL (VALUES (p.sold_branch_id, 1), (s.redeemed_branch_id, -1)) b(br, sign)
 WHERE s.redeemed_branch_id <> p.sold_branch_id
-- ── booking DP (net) ──
UNION ALL
SELECT 'booking_dp', 'received', public.tax_local_date(p_tenant, d.received_at, d.branch_id), d.received_at, d.branch_id, NULL, d.vat_base, 'booking_deposit', d.id, 'deposit', d.id, false
  FROM public.booking_deposits d WHERE d.tenant_id = p_tenant
UNION ALL
SELECT 'booking_dp', CASE d.state WHEN 'moved_to_balance' THEN 'moved' ELSE d.state END, public.tax_local_date(p_tenant, d.decided_at, d.branch_id), d.decided_at,
       d.branch_id, NULL, -d.vat_base, 'booking_deposit', d.id, 'deposit', d.id, false
  FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state <> 'held'
-- ── commission payable (per recipient, dim = staff id) ──
UNION ALL
SELECT 'commission_payable', 'accrued', public.tax_local_date(p_tenant, e.accrued_at, e.branch_id), e.accrued_at, e.branch_id, e.staff_id::text, e.amount,
       'commission_entitlement', e.id, 'staff', e.staff_id, false
  FROM public.commission_entitlements e WHERE e.tenant_id = p_tenant AND e.amount <> 0
UNION ALL
SELECT 'commission_payable', 'adjusted', public.tax_local_date(p_tenant, x.adjusted_at, x.branch_id), x.adjusted_at, x.branch_id, x.staff_id::text, x.amount,
       'commission_adjustment', x.id, 'staff', x.staff_id, false
  FROM public.commission_adjustments x WHERE x.tenant_id = p_tenant
UNION ALL
SELECT 'commission_payable', 'paid', public.tax_local_date(p_tenant, pb.paid_at, NULL), pb.paid_at, NULL, l.staff_id::text, -l.net_payable,
       'payout_batch', pb.id, 'staff', l.staff_id, false
  FROM public.payout_batches pb JOIN public.payout_batch_lines l ON l.tenant_id = pb.tenant_id AND l.batch_id = pb.id
 WHERE pb.tenant_id = p_tenant AND pb.state = 'paid' AND l.net_payable > 0

-- ── VAT payable: the signed position of the canonical objects, plus the finance facts (D-A1) ──
UNION ALL
SELECT 'vat', v.term, public.tax_local_date(p_tenant, v.at, v.branch_id), v.at, v.branch_id, NULL, v.amount, v.sk, v.sid, v.ok, v.oid, v.inc FROM vobj v
UNION ALL
SELECT 'vat', 'input_credited', c.effective_on, c.recorded_at, NULL, c.tax_period, -c.amount, 'vat_input_credit', c.id, NULL, NULL, false
  FROM public.vat_input_credits c WHERE c.tenant_id = p_tenant
UNION ALL
SELECT 'vat', 'paid', p.paid_on, p.recorded_at, NULL, p.tax_period, -p.amount, 'vat_payment', p.id, NULL, NULL, false
  FROM public.vat_payments p WHERE p.tenant_id = p_tenant
)
SELECT m.* FROM m WHERE m.amount <> 0
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subledger_movements(uuid) FROM PUBLIC;--> statement-breakpoint

-- ── T-104 readers (UX-22 ▸ Kewajiban, plan r5 §2.5–§4): owner, finance, auditor of the tenant; tenant-wide or one branch ──
CREATE FUNCTION public.subledger_actor(p_roles text[], p_branch uuid, OUT tenant_id uuid, OUT staff_id uuid, OUT role text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role INTO tenant_id, staff_id, role FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the sub-ledgers' USING ERRCODE = '42501';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = subledger_actor.tenant_id AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subledger_actor(text[], uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.subledger_period_ok(p_from date, p_to date) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subledger_period_ok(date, date) FROM PUBLIC;--> statement-breakpoint

-- Roll-forward of every ledger for [p_from, p_to] (local business dates): opening (before p_from), each term, closing (through p_to), the
-- check level and its result. p_branch null = tenant-wide; with a branch, rows without a branch (commission paid, VAT input / paid) are
-- left out and their ledgers say so.
CREATE FUNCTION public.subledger_rollforward(p_from date, p_to date, p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.subledger_actor(ARRAY['owner','finance','auditor'], p_branch);
  v_end timestamptz;
  v_cut timestamptz;
  v_ledgers jsonb;
  v_checks jsonb;
  v_pkp_ever boolean;
  v_periods jsonb;
BEGIN
  PERFORM public.subledger_period_ok(p_from, p_to);
  v_end := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Jakarta');
  v_cut := (SELECT c.cutover_at FROM public.vat_cutovers c WHERE c.tenant_id = a.tenant_id);
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sl_all ON COMMIT DROP AS SELECT * FROM public.subledger_movements(a.tenant_id) LIMIT 0;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sl_mv ON COMMIT DROP AS SELECT * FROM public.subledger_movements(a.tenant_id) LIMIT 0;
  TRUNCATE pg_temp.sl_all;
  TRUNCATE pg_temp.sl_mv;
  INSERT INTO pg_temp.sl_all SELECT * FROM public.subledger_movements(a.tenant_id) m WHERE p_branch IS NULL OR m.branch_id = p_branch;
  INSERT INTO pg_temp.sl_mv SELECT * FROM pg_temp.sl_all m WHERE m.day <= p_to;
  SELECT coalesce(jsonb_object_agg(l.ledger, jsonb_build_object(
           'opening', l.opening, 'closing', l.closing,
           -- (D-C1 / Panel 2 R1) a ledger whose objects carry a pre-cutover residue claims an opening / closing only once every residue row of
           -- the view is inside it — by each row's OWN local date (its object's branch time zone; Sol r2 #2); without a residue every date is
           -- exact
           'closing_complete', NOT (l.res_last IS NOT NULL AND l.res_last > p_to), 'opening_complete', NOT (l.res_last IS NOT NULL AND l.res_last >= p_from),
           'known_before_cutover', CASE WHEN l.res_last IS NOT NULL AND l.res_last > p_to THEN l.closing END,
           'terms', coalesce((SELECT jsonb_object_agg(t.term, t.amount) FROM (SELECT m.term, sum(m.amount)::bigint amount FROM pg_temp.sl_mv m
                                                                            WHERE m.ledger = l.ledger AND m.day >= p_from GROUP BY m.term) t), '{}'::jsonb),
           'by_dim', coalesce((SELECT jsonb_object_agg(t.dim, t.amount) FROM (SELECT m.dim, sum(m.amount)::bigint amount FROM pg_temp.sl_mv m
                                                                             WHERE m.ledger = l.ledger AND m.dim IS NOT NULL AND l.ledger IN ('cash_bank','gateway_clearing','commission_payable')
                                                                             GROUP BY m.dim) t), '{}'::jsonb),
           'by_branch', coalesce((SELECT jsonb_object_agg(coalesce(t.branch_id::text, '-'), t.amount) FROM (SELECT m.branch_id, sum(m.amount)::bigint amount FROM pg_temp.sl_mv m
                                                                               WHERE m.ledger = l.ledger GROUP BY m.branch_id) t), '{}'::jsonb))), '{}'::jsonb)
    INTO v_ledgers
    FROM (SELECT x.ledger, coalesce(sum(m.amount) FILTER (WHERE m.day < p_from), 0)::bigint opening, coalesce(sum(m.amount), 0)::bigint closing,
                 (SELECT max(z.day) FROM pg_temp.sl_all z WHERE z.ledger = x.ledger AND z.source_kind = 'vat_cutover_opening') res_last
            FROM unnest(ARRAY['cash_bank','gateway_clearing','paid_not_delivered','receivables','patient_balance','package_liability','inter_branch',
                              'booking_dp','commission_payable','vat']) x(ledger)
            LEFT JOIN pg_temp.sl_mv m ON m.ledger = x.ledger GROUP BY x.ledger) l;
  -- independent checks at p_to (plan r5 §2.5); each comparator returns its mismatches
  v_checks := jsonb_build_object(
    -- stored historical stock: per patient balance_after of the last entry ≤ p_to vs the per-account ledger sum (tenant-wide: a balance has
    -- no stored origin split)
    'patient_balance', CASE WHEN p_branch IS NULL THEN (SELECT jsonb_build_object('level', 'stored_stock', 'expected', coalesce(sum(st.v), 0)::bigint,
        'mismatches', count(*) FILTER (WHERE st.v <> coalesce(lg.v, 0)))
        FROM (SELECT DISTINCT ON (b.account_id) b.account_id, b.balance_after v FROM public.balance_entries b WHERE b.tenant_id = a.tenant_id AND b.created_at < v_end
               ORDER BY b.account_id, b.seq DESC) st
        LEFT JOIN (SELECT m.object_id, sum(m.amount) v FROM pg_temp.sl_mv m WHERE m.ledger = 'patient_balance' GROUP BY m.object_id) lg ON lg.object_id = st.account_id)
      ELSE jsonb_build_object('level', 'identity') END,
    -- stored historical stock: Σ vat_base of deposits received ≤ p_to and undecided or decided after; per deposit vs the ledger
    'booking_dp', CASE WHEN p_branch IS NULL THEN (SELECT jsonb_build_object('level', 'stored_stock', 'expected', coalesce(sum(CASE WHEN d.decided_at IS NULL OR d.decided_at >= v_end THEN d.vat_base ELSE 0 END), 0)::bigint,
        'mismatches', count(*) FILTER (WHERE (CASE WHEN d.decided_at IS NULL OR d.decided_at >= v_end THEN d.vat_base ELSE 0 END)
                                              <> coalesce((SELECT sum(m.amount) FROM pg_temp.sl_mv m WHERE m.ledger = 'booking_dp' AND m.object_id = d.id), 0)))
        FROM public.booking_deposits d WHERE d.tenant_id = a.tenant_id AND d.received_at < v_end)
      ELSE jsonb_build_object('level', 'identity') END,
    -- object level: per receivable, amount − collections ≤ p_to − write-offs ≤ p_to vs its ledger movements; plus today's stored columns
    'receivables', (SELECT jsonb_build_object('level', 'object', 'expected', coalesce(sum(o.v), 0)::bigint,
        'mismatches', count(*) FILTER (WHERE o.v <> coalesce((SELECT sum(m.amount) FROM pg_temp.sl_mv m WHERE m.ledger = 'receivables' AND m.object_id = o.id), 0)),
        'stored_now', CASE WHEN v_end > clock_timestamp() THEN coalesce(sum(o.stored), 0)::bigint END,
        'stored_mismatches', CASE WHEN v_end > clock_timestamp() THEN count(*) FILTER (WHERE o.stored <> o.v) END)
        FROM (SELECT r.id, r.amount - r.collected_amount - r.written_off_amount stored,
                     r.amount - coalesce((SELECT sum(c.amount) FROM public.receivable_collections c WHERE c.tenant_id = r.tenant_id AND c.receivable_id = r.id AND c.received_at < v_end), 0)
                              - coalesce((SELECT sum(w.amount) FROM public.write_offs w WHERE w.tenant_id = r.tenant_id AND w.receivable_id = r.id AND w.created_at < v_end), 0) v
                FROM public.receivables r WHERE r.tenant_id = a.tenant_id AND r.created_at < v_end AND (p_branch IS NULL OR r.branch_id = p_branch)) o),
    -- object level, every package (open and closed; tenant-wide), against the STORED package state — independent of the seam events and the
    -- movement reader: closed → 0; open → (paid − moved to balance) on the own line, net of the package object's stored VAT position (PKP at
    -- issue: line recognised − package reversed − what redeemed sessions hold), less the allocated value of redeemed sessions, plus every
    -- difference line of an unredeemed session (paid − moved to balance − its stored VAT position). Stored columns are today's state, so the
    -- comparison runs when the report ends today or later (like the receivables' stored check); an incomplete (residue) package is skipped.
    'package_liability', CASE WHEN p_branch IS NOT NULL OR v_end <= clock_timestamp()
      THEN jsonb_build_object('level', 'object', 'ran', false, 'reason', CASE WHEN p_branch IS NOT NULL THEN 'branch_view' ELSE 'historical' END) ELSE
      (SELECT jsonb_build_object('level', 'object', 'ran', true, 'checked', count(*) FILTER (WHERE NOT k.inc), 'mismatches', count(*) FILTER (WHERE NOT k.inc AND k.ledger_v <> k.expect_v),
        'incomplete', count(*) FILTER (WHERE k.inc),
        'mismatched', coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'ledger', k.ledger_v, 'expected', k.expect_v)) FILTER (WHERE NOT k.inc AND k.ledger_v <> k.expect_v), '[]'::jsonb))
        FROM (SELECT p.id,
                     coalesce((SELECT sum(m.amount) FROM pg_temp.sl_mv m WHERE m.ledger = 'package_liability' AND m.object_id = p.id), 0) ledger_v,
                     EXISTS (SELECT 1 FROM public.vat_cutover_openings o WHERE o.tenant_id = p.tenant_id AND (o.object_kind = 'package' AND o.object_id = p.id
                               OR o.object_kind = 'line' AND o.object_id IN (SELECT l2.id FROM public.invoice_lines l2 JOIN public.package_substitutions u2 ON u2.tenant_id = l2.tenant_id AND u2.id = l2.substitution_id WHERE u2.package_id = p.id))) inc,
                     CASE WHEN p.state <> 'active' THEN 0 ELSE
                       public.package_paid(p)
                       - CASE WHEN i.is_pkp_at_issue THEN l.vat_recognised_amount - p.vat_reversed_amount
                                 - coalesce((SELECT sum(ss.vat_recognised_amount) FROM public.package_sessions ss WHERE ss.tenant_id = p.tenant_id AND ss.package_id = p.id AND ss.state = 'redeemed'), 0)
                              ELSE 0 END
                       - coalesce((SELECT sum(ss.allocated_value) FROM public.package_sessions ss WHERE ss.tenant_id = p.tenant_id AND ss.package_id = p.id AND ss.state = 'redeemed'), 0)
                       + coalesce((SELECT sum(public.kasir_line_paid(dl.tenant_id, dl.id) - dl.moved_to_balance - (dl.vat_recognised_amount - dl.vat_reversed_amount))
                                     FROM public.invoice_lines dl JOIN public.package_substitutions u ON u.tenant_id = dl.tenant_id AND u.id = dl.substitution_id
                                     JOIN public.package_sessions ss ON ss.tenant_id = u.tenant_id AND ss.id = u.session_id
                                    WHERE u.package_id = p.id AND ss.state <> 'redeemed'), 0) END expect_v
                FROM public.packages p JOIN public.invoice_lines l ON l.tenant_id = p.tenant_id AND l.id = p.invoice_line_id
                JOIN public.invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
               WHERE p.tenant_id = a.tenant_id) k) END,
    -- object level per recipient: the ledger per staff vs Σ entitlements + adjustments − Σ paid lines ≤ p_to; and at each paid batch the
    -- batch line's carry-forward identity (net − carry out = gross + adjustments − carry in) and the carry-in equal to the previous paid
    -- line's carry-out
    'commission_payable', (SELECT jsonb_build_object('level', 'object', 'checked', count(*),
        'mismatches', count(*) FILTER (WHERE r.ledger_v <> r.expect_v),
        'carry_forward_mismatches', (SELECT count(*) FROM public.payout_batch_lines bl JOIN public.payout_batches pb ON pb.tenant_id = bl.tenant_id AND pb.id = bl.batch_id
              WHERE bl.tenant_id = a.tenant_id AND pb.state = 'paid' AND pb.paid_at < v_end
                AND (bl.net_payable - bl.carry_forward_out <> bl.gross + bl.adjustments - bl.carry_forward_in
                     -- the writer's carry-in (commission_carry_in, 0102): the latest earlier batch line of the staff member, whatever that batch's
                     -- state, unless its remainder had become a staff receivable when this batch was submitted (B-21)
                     OR bl.carry_forward_in <> coalesce((SELECT CASE WHEN EXISTS (SELECT 1 FROM public.staff_commission_receivables sr
                                                                                   WHERE sr.tenant_id = pl.tenant_id AND sr.source_batch_line_id = pl.id
                                                                                     AND sr.created_at <= pb.submitted_at)
                                                                     THEN 0 ELSE pl.carry_forward_out END
                                                          FROM public.payout_batch_lines pl JOIN public.payout_batches pp ON pp.tenant_id = pl.tenant_id AND pp.id = pl.batch_id
                                                          WHERE pl.tenant_id = bl.tenant_id AND pl.staff_id = bl.staff_id AND pp.period_start < pb.period_start
                                                          ORDER BY pp.period_start DESC LIMIT 1), 0))))
        FROM (SELECT st.staff_id,
                     coalesce((SELECT sum(m.amount) FROM pg_temp.sl_mv m WHERE m.ledger = 'commission_payable' AND m.dim = st.staff_id::text), 0) ledger_v,
                     coalesce((SELECT sum(e.amount) FROM public.commission_entitlements e WHERE e.tenant_id = a.tenant_id AND e.staff_id = st.staff_id AND e.accrued_at < v_end
                                AND (p_branch IS NULL OR e.branch_id = p_branch)), 0)
                     + coalesce((SELECT sum(x.amount) FROM public.commission_adjustments x WHERE x.tenant_id = a.tenant_id AND x.staff_id = st.staff_id AND x.adjusted_at < v_end
                                AND (p_branch IS NULL OR x.branch_id = p_branch)), 0)
                     - CASE WHEN p_branch IS NULL THEN coalesce((SELECT sum(bl.net_payable) FROM public.payout_batch_lines bl JOIN public.payout_batches pb ON pb.tenant_id = bl.tenant_id AND pb.id = bl.batch_id
                                WHERE bl.tenant_id = a.tenant_id AND bl.staff_id = st.staff_id AND pb.state = 'paid' AND pb.paid_at < v_end), 0) ELSE 0 END expect_v
                FROM (SELECT DISTINCT e.staff_id FROM public.commission_entitlements e WHERE e.tenant_id = a.tenant_id
                      UNION SELECT DISTINCT x.staff_id FROM public.commission_adjustments x WHERE x.tenant_id = a.tenant_id) st) r),
    -- identity + cross-ledger invariant: every real receipt by method equals its allocations by target plus what is unallocated, and the
    -- inter-branch clearing nets to zero tenant-wide
    'receipts', (SELECT jsonb_build_object('level', 'identity', 'received', coalesce(sum(y.amount), 0)::bigint,
        'allocated', coalesce(sum((SELECT coalesce(sum(al.amount), 0) FROM public.payment_allocations al WHERE al.tenant_id = y.tenant_id AND al.payment_id = y.id)), 0)::bigint,
        'unallocated', coalesce(sum(y.amount - (SELECT coalesce(sum(al.amount), 0) FROM public.payment_allocations al WHERE al.tenant_id = y.tenant_id AND al.payment_id = y.id)), 0)::bigint,
        'mismatches', count(*) FILTER (WHERE (SELECT coalesce(sum(al.amount), 0) FROM public.payment_allocations al WHERE al.tenant_id = y.tenant_id AND al.payment_id = y.id) > y.amount),
        'ledger_mismatch', coalesce(sum(y.amount) FILTER (WHERE y.method <> 'balance'), 0)
                           <> coalesce((SELECT sum(m.amount) FROM pg_temp.sl_mv m WHERE m.ledger IN ('cash_bank','gateway_clearing') AND m.term = 'receipt'), 0))
        FROM public.payments y WHERE y.tenant_id = a.tenant_id AND NOT y.is_simulated AND y.received_at < v_end AND (p_branch IS NULL OR y.branch_id = p_branch)),
    'inter_branch', jsonb_build_object('level', 'identity', 'expected', 0),
    'cash_bank', jsonb_build_object('level', 'identity'), 'gateway_clearing', jsonb_build_object('level', 'identity'),
    'paid_not_delivered', jsonb_build_object('level', 'identity'), 'vat', jsonb_build_object('level', 'identity'));
  -- VAT state: PKP at any time up to p_to, completeness against the cutover, and the D-A facts recorded per PKP month of the period
  v_pkp_ever := EXISTS (SELECT 1 FROM public.tax_profile_changes c WHERE c.tenant_id = a.tenant_id AND c.is_pkp AND c.changed_at < v_end);
  SELECT coalesce(jsonb_agg(jsonb_build_object('period', m.p, 'pkp', public.tax_pkp_at(a.tenant_id, least(v_end, ((m.p || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Jakarta') - interval '1 microsecond', NULL),
            'input_recorded', EXISTS (SELECT 1 FROM public.vat_input_credits c WHERE c.tenant_id = a.tenant_id AND c.tax_period = m.p),
            'paid_recorded', EXISTS (SELECT 1 FROM public.vat_payments x WHERE x.tenant_id = a.tenant_id AND x.tax_period = m.p)) ORDER BY m.p), '[]'::jsonb)
    INTO v_periods
    FROM (SELECT DISTINCT to_char(g, 'YYYY-MM') p FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) m;
  RETURN jsonb_build_object('role', a.role, 'from', p_from, 'to', p_to, 'branch_id', p_branch, 'can_record_vat', a.role = 'finance',
    'can_export', a.role IN ('owner','finance'),
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code) ORDER BY b.name) FROM public.branches b WHERE b.tenant_id = a.tenant_id), '[]'::jsonb),
    'ledgers', v_ledgers, 'checks', v_checks,
    'vat', jsonb_build_object('pkp_ever', v_pkp_ever, 'cutover_at', v_cut,
      -- the VAT closing / opening is claimed only when it includes no undatable pre-cutover movement (per-object residue rule, Panel 2 R1)
      'closing_complete', (v_ledgers -> 'vat' ->> 'closing_complete')::boolean, 'opening_complete', (v_ledgers -> 'vat' ->> 'opening_complete')::boolean,
      'periods', v_periods,
      'input_credits', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'period', c.tax_period, 'amount', c.amount, 'effective_on', c.effective_on,
                                   'evidence_ref', c.evidence_ref, 'reason', c.reason, 'recorded_at', c.recorded_at) ORDER BY c.recorded_at DESC)
                                 FROM public.vat_input_credits c WHERE c.tenant_id = a.tenant_id AND c.effective_on BETWEEN p_from AND p_to), '[]'::jsonb),
      'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'period', x.tax_period, 'amount', x.amount, 'paid_on', x.paid_on,
                              'ntpn', x.ntpn, 'reason', x.reason, 'recorded_at', x.recorded_at) ORDER BY x.recorded_at DESC)
                            FROM public.vat_payments x WHERE x.tenant_id = a.tenant_id AND x.paid_on BETWEEN p_from AND p_to), '[]'::jsonb)),
    'staff', coalesce((SELECT jsonb_object_agg(s.id, s.display_name) FROM public.staff s WHERE s.tenant_id = a.tenant_id
                         AND s.id::text IN (SELECT m.dim FROM pg_temp.sl_mv m WHERE m.ledger = 'commission_payable')), '{}'::jsonb),
    'aging', CASE WHEN v_end > clock_timestamp() THEN (SELECT jsonb_build_object(
        'd0_30', coalesce(sum(o) FILTER (WHERE age <= 30), 0), 'd31_60', coalesce(sum(o) FILTER (WHERE age BETWEEN 31 AND 60), 0),
        'd61_90', coalesce(sum(o) FILTER (WHERE age BETWEEN 61 AND 90), 0), 'd90', coalesce(sum(o) FILTER (WHERE age > 90), 0))
        FROM (SELECT r.amount - r.collected_amount - r.written_off_amount o, (p_to - public.tax_local_date(r.tenant_id, r.created_at, r.branch_id)) age
                FROM public.receivables r WHERE r.tenant_id = a.tenant_id AND r.state = 'open' AND (p_branch IS NULL OR r.branch_id = p_branch)) x) END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subledger_rollforward(date, date, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.subledger_rollforward(date, date, uuid) TO clinic_app;--> statement-breakpoint

-- Ekspor (A-14: sub-ledger and transaction CSV, no journal). Owner and finance (the auditor reads, no export: plan r5 C-4). Ids, document
-- numbers, branch codes, amounts and recipient names only: no patient name, phone, NIK, clinical text or treatment name. Every export audited.
-- p_kind: a ledger id (its movements in the period) or 'payments' | 'invoice_lines' | 'commissions' | 'stock'; p_staff filters commissions.
CREATE FUNCTION public.subledger_export(p_kind text, p_from date, p_to date, p_branch uuid DEFAULT NULL, p_staff uuid DEFAULT NULL)
RETURNS TABLE (c1 text, c2 text, c3 text, c4 text, c5 text, c6 text, c7 text, c8 text, c9 text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.subledger_actor(ARRAY['owner','finance'], p_branch);
BEGIN
  PERFORM public.subledger_period_ok(p_from, p_to);
  IF p_kind IS NULL OR p_kind NOT IN ('cash_bank','gateway_clearing','paid_not_delivered','receivables','patient_balance','package_liability','inter_branch',
                                       'booking_dp','commission_payable','vat','payments','invoice_lines','commissions','stock') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kind' USING ERRCODE = '22023';
  END IF;
  IF p_staff IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.tenant_id = a.tenant_id AND s.id = p_staff) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('export', 'subledger', NULL, 'success', 'subledger_export_' || CASE WHEN p_kind IN ('payments','invoice_lines','commissions','stock') THEN p_kind ELSE 'ledger' END);
  IF p_kind = 'payments' THEN
    RETURN QUERY SELECT 'tanggal', 'cabang', 'metode', 'jumlah', 'nomor_struk', 'id_pembayaran', 'id_invoice', 'lingkungan', ''
    UNION ALL (SELECT public.tax_local_date(y.tenant_id, y.received_at, y.branch_id)::text, b.code, y.method, y.amount::text, r.number, y.id::text, y.invoice_id::text, y.environment, ''
      FROM public.payments y JOIN public.branches b ON b.tenant_id = y.tenant_id AND b.id = y.branch_id JOIN public.receipts r ON r.tenant_id = y.tenant_id AND r.id = y.receipt_id
     WHERE y.tenant_id = a.tenant_id AND NOT y.is_simulated AND public.tax_local_date(y.tenant_id, y.received_at, y.branch_id) BETWEEN p_from AND p_to
       AND (p_branch IS NULL OR y.branch_id = p_branch) ORDER BY y.received_at, y.id);
  ELSIF p_kind = 'invoice_lines' THEN
    RETURN QUERY SELECT 'tanggal_terbit', 'cabang', 'nomor_invoice', 'id_baris', 'kategori_pajak', 'jumlah', 'dpp', 'ppn', 'status_invoice'
    UNION ALL (SELECT public.tax_local_date(i.tenant_id, i.issued_at, i.branch_id)::text, b.code, i.number, l.id::text, l.tax_category, l.line_total::text,
                      l.vat_base::text, l.vat_amount::text, i.state
      FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id JOIN public.branches b ON b.tenant_id = i.tenant_id AND b.id = i.branch_id
     WHERE l.tenant_id = a.tenant_id AND i.issued_at IS NOT NULL AND public.tax_local_date(i.tenant_id, i.issued_at, i.branch_id) BETWEEN p_from AND p_to
       AND (p_branch IS NULL OR i.branch_id = p_branch) ORDER BY i.issued_at, l.id);
  ELSIF p_kind = 'commissions' THEN
    RETURN QUERY SELECT 'tanggal', 'id_penerima', 'nama_penerima', 'jenis', 'jumlah', 'cabang', 'id_sumber', '', ''
    UNION ALL (SELECT m.day::text, m.dim, s.display_name, m.term, m.amount::text, b.code, m.source_id::text, '', ''
      FROM public.subledger_movements(a.tenant_id) m JOIN public.staff s ON s.tenant_id = a.tenant_id AND s.id::text = m.dim
      LEFT JOIN public.branches b ON b.tenant_id = a.tenant_id AND b.id = m.branch_id
     WHERE m.ledger = 'commission_payable' AND m.day BETWEEN p_from AND p_to AND (p_staff IS NULL OR m.dim = p_staff::text)
       AND (p_branch IS NULL OR m.branch_id = p_branch) ORDER BY s.display_name, m.dim, m.at, m.source_id)
    UNION ALL (SELECT 'total', m.dim, s.display_name, 'total', sum(m.amount)::bigint::text, '', '', '', ''
      FROM public.subledger_movements(a.tenant_id) m JOIN public.staff s ON s.tenant_id = a.tenant_id AND s.id::text = m.dim
     WHERE m.ledger = 'commission_payable' AND m.day BETWEEN p_from AND p_to AND (p_staff IS NULL OR m.dim = p_staff::text) AND (p_branch IS NULL OR m.branch_id = p_branch)
     GROUP BY m.dim, s.display_name ORDER BY s.display_name, m.dim);
  ELSIF p_kind = 'stock' THEN
    RETURN QUERY SELECT 'tanggal', 'cabang', 'id_item_stok', 'id_batch', 'jenis', 'jumlah', 'saldo_setelah', 'sumber', 'id_sumber'
    UNION ALL (SELECT public.tax_local_date(sm.tenant_id, sm.created_at, sm.branch_id)::text, b.code, sm.item_id::text, sm.batch_id::text, sm.kind, sm.quantity::text,
                      sm.balance_after::text, sm.source_kind, sm.source_id::text
      FROM public.stock_movements sm JOIN public.branches b ON b.tenant_id = sm.tenant_id AND b.id = sm.branch_id
     WHERE sm.tenant_id = a.tenant_id AND public.tax_local_date(sm.tenant_id, sm.created_at, sm.branch_id) BETWEEN p_from AND p_to
       AND (p_branch IS NULL OR sm.branch_id = p_branch) ORDER BY sm.created_at, sm.seq);
  ELSE
    RETURN QUERY SELECT 'tanggal', 'cabang', 'buku', 'pos', 'jumlah', 'dimensi', 'sumber', 'id_sumber', 'objek'
    UNION ALL (SELECT m.day::text, b.code, m.ledger, m.term, m.amount::text, m.dim, m.source_kind, m.source_id::text, m.object_kind || ':' || m.object_id::text
      FROM public.subledger_movements(a.tenant_id) m LEFT JOIN public.branches b ON b.tenant_id = a.tenant_id AND b.id = m.branch_id
     WHERE m.ledger = p_kind AND m.day BETWEEN p_from AND p_to AND (p_branch IS NULL OR m.branch_id = p_branch) ORDER BY m.at, m.source_id);
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subledger_export(text, date, date, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.subledger_export(text, date, date, uuid, uuid) TO clinic_app;--> statement-breakpoint

-- ── T-104 D-A1: input VAT credited and VAT paid (finance, PKP, append-only, signed corrections, per-period total >= 0) ──
CREATE FUNCTION public.vat_fact_record(p_table text, p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.subledger_actor(ARRAY['finance'], NULL);
  v_input boolean := p_table = 'vat_input_credits';
  v_date_key text := CASE WHEN v_input THEN 'effective_on' ELSE 'paid_on' END;
  v_ref_key text := CASE WHEN v_input THEN 'evidence_ref' ELSE 'ntpn' END;
  v_period text := p ->> 'tax_period';
  v_amount bigint;
  v_date date;
  v_ref text := btrim(coalesce(p ->> v_ref_key, ''));
  v_reason text := NULLIF(btrim(coalesce(p ->> 'reason', '')), '');
  v_id uuid;
  v_same boolean;
  v_total bigint;
  v_end timestamptz;
  v_ref_max integer := CASE WHEN p_table = 'vat_input_credits' THEN 80 ELSE 40 END;
BEGIN
  IF NOT public.tenant_capability('configuration') AND NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: VAT facts are not available now' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'tax_period' - 'amount' - v_date_key - v_ref_key - 'reason' <> '{}'::jsonb
     OR coalesce(v_period, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^-?[0-9]{1,13}$'
     OR coalesce(p ->> v_date_key, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR length(v_ref) NOT BETWEEN 1 AND v_ref_max THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: vat_fact' USING ERRCODE = '22023';
  END IF;
  v_amount := (p ->> 'amount')::bigint;
  BEGIN
    v_date := (p ->> v_date_key)::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: date' USING ERRCODE = '22023';
  END;
  -- replay: the same key with the same content returns its row; another content is a conflict
  IF v_input THEN
    SELECT x.id, (x.tax_period, x.amount, x.effective_on, x.evidence_ref, x.reason) IS NOT DISTINCT FROM (v_period, v_amount, v_date, v_ref, v_reason)
      INTO v_id, v_same FROM public.vat_input_credits x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  ELSE
    SELECT x.id, (x.tax_period, x.amount, x.paid_on, x.ntpn, x.reason) IS NOT DISTINCT FROM (v_period, v_amount, v_date, v_ref, v_reason)
      INTO v_id, v_same FROM public.vat_payments x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  END IF;
  IF v_id IS NOT NULL THEN
    IF NOT v_same THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a VAT fact with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN v_id;
  END IF;
  IF v_amount = 0 OR abs(v_amount) > 1000000000000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: amount' USING ERRCODE = '22023';
  END IF;
  IF (v_amount < 0) <> (v_reason IS NOT NULL) OR v_reason IS NOT NULL AND length(v_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  -- the period is a whole month not after this one; the date not in the future and not before the period's first day
  IF (v_period || '-01')::date > date_trunc('month', public.safety_today(a.tenant_id, NULL))::date
     OR v_date > public.safety_today(a.tenant_id, NULL) OR v_date < (v_period || '-01')::date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  -- PKP at the end of the tax period (the tax-profile history decides, not today's flag)
  v_end := least(clock_timestamp(), (((v_period || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Jakarta') - interval '1 microsecond');
  IF NOT public.tax_pkp_at(a.tenant_id, v_end, NULL) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: not_pkp' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vat_facts:' || a.tenant_id::text, 0));
  IF v_input THEN
    v_total := (SELECT coalesce(sum(x.amount), 0) FROM public.vat_input_credits x WHERE x.tenant_id = a.tenant_id AND x.tax_period = v_period);
  ELSE
    v_total := (SELECT coalesce(sum(x.amount), 0) FROM public.vat_payments x WHERE x.tenant_id = a.tenant_id AND x.tax_period = v_period);
  END IF;
  IF v_total + v_amount < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: below_zero' USING ERRCODE = '22023';
  END IF;
  IF v_input THEN
    INSERT INTO public.vat_input_credits (tenant_id, tax_period, amount, effective_on, evidence_ref, reason, command_key, recorded_by, recorded_as)
    VALUES (a.tenant_id, v_period, v_amount, v_date, v_ref, v_reason, p_key, a.staff_id, a.role) RETURNING id INTO v_id;
    PERFORM public.audit_append('money_correction', 'vat_input_credit', v_id, 'success', 'vat_input_credited');
  ELSE
    INSERT INTO public.vat_payments (tenant_id, tax_period, amount, paid_on, ntpn, reason, command_key, recorded_by, recorded_as)
    VALUES (a.tenant_id, v_period, v_amount, v_date, v_ref, v_reason, p_key, a.staff_id, a.role) RETURNING id INTO v_id;
    PERFORM public.audit_append('money_correction', 'vat_payment', v_id, 'success', 'vat_paid');
  END IF;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vat_fact_record(text, text, jsonb) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.vat_input_credit_record(p_key text, p jsonb) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT public.vat_fact_record('vat_input_credits', p_key, p) $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vat_input_credit_record(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vat_input_credit_record(text, jsonb) TO clinic_app;--> statement-breakpoint
CREATE FUNCTION public.vat_payment_record(p_key text, p jsonb) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT public.vat_fact_record('vat_payments', p_key, p) $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vat_payment_record(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vat_payment_record(text, jsonb) TO clinic_app;--> statement-breakpoint

-- ── T-104 D-C1 cutover (addendum a1 r2 §A3; Panel 2 R1 + R1-C7): one instant per tenant; per canonical VAT object the change before it
-- that no dated fact explains, computed once. Known movements: payment vat_portion, paid refund vat_reversed, DP receipt VAT and its
-- move/refund reversal, and a provably reconstructed interrupted reversal (the same rule as subledger_movements' intr). A pre-cutover DP
-- application is not known (its v_vat was never stored): both legs stay in the objects' residues. A PKP-at-issue package's redeemed sessions
-- hold the VAT attributed to them (their recognition) as their own opening; the package object's position excludes it (total unchanged).
-- Not granted: run by this migration for every existing tenant (a tenant created later has no row: its whole history is recorded). ──
CREATE FUNCTION public.vat_cutover_open(p_tenant uuid, p_at timestamptz) RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.vat_cutovers (tenant_id, cutover_at) VALUES (p_tenant, p_at);
  INSERT INTO public.vat_cutover_openings (tenant_id, branch_id, object_kind, object_id, amount, cutover_at)
  WITH intr AS MATERIALIZED (
    SELECT m.object_id, sum(-m.amount) AS rev FROM public.subledger_movements(p_tenant) m
     WHERE m.ledger = 'vat' AND m.term = 'interrupted' AND m.source_kind = 'balance_entry' AND m.object_kind = 'line' GROUP BY m.object_id)
  SELECT p_tenant, x.branch_id, x.kind, x.id, x.residue, p_at
    FROM (
      -- (a) non-package lines incl. difference lines: position − dated payment VAT + dated refund reversals + reconstructed interruptions
      SELECT l.branch_id, 'line' AS kind, l.id,
             (l.vat_recognised_amount - l.vat_reversed_amount)
             - coalesce((SELECT sum(a.vat_portion) FROM public.payment_allocations a WHERE a.tenant_id = l.tenant_id AND a.invoice_line_id = l.id AND NOT a.is_simulated), 0)
             + coalesce((SELECT sum(r.vat_reversed) FROM public.refunds r WHERE r.tenant_id = l.tenant_id AND r.invoice_line_id = l.id AND r.state = 'paid'), 0)
             + coalesce((SELECT ir.rev FROM intr ir WHERE ir.object_id = l.id), 0) AS residue
        FROM public.invoice_lines l
       WHERE l.tenant_id = p_tenant AND NOT EXISTS (SELECT 1 FROM public.packages p WHERE p.tenant_id = l.tenant_id AND p.invoice_line_id = l.id)
      UNION ALL
      -- (b) package own lines: line recognition − package reversals − what redeemed sessions hold (attributed), minus dated payment VAT
      SELECT p.sold_branch_id, 'package', p.id,
             (l.vat_recognised_amount - p.vat_reversed_amount)
             - CASE WHEN i.is_pkp_at_issue THEN coalesce((SELECT sum(s.vat_recognised_amount) FROM public.package_sessions s
                                                        WHERE s.tenant_id = p.tenant_id AND s.package_id = p.id AND s.state = 'redeemed'), 0) ELSE 0 END
             - coalesce((SELECT sum(a.vat_portion) FROM public.payment_allocations a WHERE a.tenant_id = l.tenant_id AND a.invoice_line_id = l.id AND NOT a.is_simulated), 0)
        FROM public.packages p JOIN public.invoice_lines l ON l.tenant_id = p.tenant_id AND l.id = p.invoice_line_id
        JOIN public.invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
       WHERE p.tenant_id = p_tenant
      UNION ALL
      -- (c) sessions: of a non-PKP-at-issue package, their delivery VAT; of a PKP-at-issue package, redeemed sessions' attributed recognition
      SELECT coalesce(s.redeemed_branch_id, p.sold_branch_id), 'session', s.id, s.vat_recognised_amount
        FROM public.package_sessions s JOIN public.packages p ON p.tenant_id = s.tenant_id AND p.id = s.package_id
        JOIN public.invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
       WHERE s.tenant_id = p_tenant AND (NOT i.is_pkp_at_issue OR s.state = 'redeemed')
      UNION ALL
      -- (d) booking deposits
      SELECT d.branch_id, 'deposit', d.id,
             d.vat_recognised_amount - d.vat_amount + CASE WHEN d.state IN ('moved_to_balance','refunded') THEN d.vat_amount ELSE 0 END
        FROM public.booking_deposits d WHERE d.tenant_id = p_tenant
    ) x
   WHERE x.residue <> 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vat_cutover_open(uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
SELECT public.vat_cutover_open(t.id, clock_timestamp()) FROM public.tenants t ORDER BY t.id;
