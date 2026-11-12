CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"amount" bigint NOT NULL,
	"vat_portion" bigint DEFAULT 0 NOT NULL,
	"method" text NOT NULL,
	"provider" text,
	"provider_account" text,
	"environment" text NOT NULL,
	"is_simulated" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_allocations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_allocations_payment_line_key" UNIQUE("tenant_id","payment_id","invoice_line_id"),
	CONSTRAINT "payment_allocations_check" CHECK (num_nonnulls("payment_allocations"."invoice_line_id") = 1 and "payment_allocations"."amount" between 1 and 1000000000000
      and "payment_allocations"."vat_portion" between 0 and "payment_allocations"."amount" and "payment_allocations"."method" in ('cash','edc','transfer','qris','va','payment_link','balance') and "payment_allocations"."environment" in ('production','staging','demo','local'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"invoice_id" uuid NOT NULL,
	"patient_id" uuid,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"cash_tendered" bigint,
	"change_given" bigint,
	"details" jsonb,
	"provider" text,
	"provider_account" text,
	"environment" text NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"received_by" uuid NOT NULL,
	"received_as" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "payments_receipt_seq_key" UNIQUE("tenant_id","receipt_id","seq"),
	CONSTRAINT "payments_check" CHECK ("payments"."seq" between 1 and 6 and "payments"."method" in ('cash','edc','transfer','qris','va','payment_link','balance') and "payments"."environment" in ('production','staging','demo','local')
      and "payments"."amount" between 1 and 1000000000000
      and (("payments"."method" = 'cash') = ("payments"."cash_tendered" is not null)) and num_nonnulls("payments"."cash_tendered", "payments"."change_given") in (0, 2)
      and ("payments"."cash_tendered" is null or "payments"."cash_tendered" between "payments"."amount" and 1000000000000 and "payments"."change_given" = "payments"."cash_tendered" - "payments"."amount")
      and ("payments"."details" is null or jsonb_typeof("payments"."details") = 'object')
      and ("payments"."provider" is null or length("payments"."provider") between 1 and 40) and ("payments"."provider_account" is null or length("payments"."provider_account") between 1 and 80)
      and "payments"."received_as" in ('owner','manager','fo_cashier','finance'))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"number" text NOT NULL,
	"total" bigint NOT NULL,
	"body" text NOT NULL,
	"paper" text NOT NULL,
	"template_version_id" uuid,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"command_key" text NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_as" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "receipts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "receipts_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "receipts_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "receipts_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "receipts_check" CHECK ("receipts"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and length("receipts"."number") between 1 and 40 and "receipts"."total" between 1 and 1000000000000
      and length("receipts"."body") between 10 and 40000 and "receipts"."paper" in ('a4','80mm','58mm') and "receipts"."issued_as" in ('owner','manager','fo_cashier','finance'))
);
--> statement-breakpoint
ALTER TABLE "dispensings" DROP CONSTRAINT "dispensings_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_check";--> statement-breakpoint
ALTER TABLE "dispensings" ALTER COLUMN "visit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dispensings" ALTER COLUMN "patient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dispensings" ADD COLUMN "invoice_line_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "counter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "void_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fk" FOREIGN KEY ("tenant_id","branch_id","payment_id") REFERENCES "public"."payments"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_fk" FOREIGN KEY ("tenant_id","branch_id","receipt_id") REFERENCES "public"."receipts"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_template_fk" FOREIGN KEY ("tenant_id","template_version_id") REFERENCES "public"."document_template_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_issued_by_fk" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_allocations_line_idx" ON "payment_allocations" USING btree ("tenant_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "receipts_invoice_idx" ON "receipts" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_invoice_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_void_approval_fk" FOREIGN KEY ("tenant_id","void_approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_invoice_line_key" UNIQUE("tenant_id","invoice_line_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_key" UNIQUE("tenant_id","number");--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_check" CHECK ("dispensings"."state" in ('queued','prepared','handed','cancelled') and "dispensings"."quantity" between 0.0001 and 1000000000 and scale("dispensings"."quantity") <= 4
      and num_nonnulls("dispensings"."selection_item_id", "dispensings"."prescription_item_id", "dispensings"."invoice_line_id") = 1
      and (("dispensings"."invoice_line_id" is null) = ("dispensings"."visit_id" is not null)) and ("dispensings"."visit_id" is null or "dispensings"."patient_id" is not null)
      and num_nonnulls("dispensings"."prepared_at", "dispensings"."prepared_by", "dispensings"."prepare_key", "dispensings"."depot_id") in (0, 4)
      and num_nonnulls("dispensings"."handed_at", "dispensings"."handed_by", "dispensings"."hand_key", "dispensings"."checks") in (0, 4)
      and num_nonnulls("dispensings"."cancelled_at", "dispensings"."cancelled_by", "dispensings"."cancel_reason") in (0, 3)
      and (("dispensings"."state" in ('prepared','handed')) <= ("dispensings"."prepared_at" is not null))
      and (("dispensings"."state" = 'handed') = ("dispensings"."handed_at" is not null)) and (("dispensings"."state" = 'cancelled') = ("dispensings"."cancelled_at" is not null))
      and ("dispensings"."prepare_key" is null or "dispensings"."prepare_key" ~ '^[A-Za-z0-9_.:-]{8,128}$') and ("dispensings"."hand_key" is null or "dispensings"."hand_key" ~ '^[A-Za-z0-9_.:-]{8,128}$')
      and ("dispensings"."checks" is null or jsonb_typeof("dispensings"."checks") = 'object')
      and ("dispensings"."exception_note" is null or length(btrim("dispensings"."exception_note")) between 3 and 500) and ("dispensings"."exception_note" is null or "dispensings"."handed_at" is not null)
      and ("dispensings"."cancel_reason" is null or length(btrim("dispensings"."cancel_reason")) between 3 and 300));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_check" CHECK ("invoices"."state" in ('draft','issued','void') and "invoices"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "invoices"."sold_branch_id" = "invoices"."branch_id"
      and ("invoices"."visit_id" is null or "invoices"."patient_id" is not null) and (not "invoices"."counter" or "invoices"."visit_id" is null)
      and (("invoices"."state" = 'draft') = ("invoices"."issued_at" is null))
      and num_nonnulls("invoices"."issued_at", "invoices"."issued_by", "invoices"."issued_as", "invoices"."is_pkp_at_issue") in (0, 4)
      and ("invoices"."number" is null or length("invoices"."number") between 1 and 40)
      and (("invoices"."state" = 'void') = ("invoices"."voided_at" is not null)) and ("invoices"."voided_at" is null or "invoices"."void_approval_id" is not null));--> statement-breakpoint

-- T-072 rules (generated by gen.py; plan docs/tasks/T-072.md)
-- ── Helpers (T-072; plan docs/tasks/T-072.md) ─────────────────────────────────────────────────────────────────────

-- Who reads the Kasir tables directly (RLS): the cashier roles at an allowed branch, owner, finance and auditor
-- tenant-wide. Writes go through the definers only. `receipts.body` is never granted (IAM-12: served masked by
-- receipt_get).
CREATE FUNCTION public.kasir_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
    public.app_role_in(ARRAY['owner','finance','auditor'])
    OR public.app_role_in(ARRAY['manager','fo_cashier']) AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kasir_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- The actor of the writers on an existing invoice (r: T-071's invoice_issue required a named branch, so a
-- tenant-wide owner or finance user could not issue or pay): the lock first; owner, manager, FO/cashier or finance;
-- the cashier capability; a branch role's active branch, NULL for a tenant-wide role (any branch of the tenant; the
-- writer reads the invoice's own branch).
CREATE FUNCTION public.kasir_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','manager','fo_cashier','finance') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not use the cashier' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the cashier is not available now' USING ERRCODE = '42501';
  END IF;
  IF role IN ('manager','fo_cashier') AND branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an active branch is needed' USING ERRCODE = '42501';
  END IF;
  IF role NOT IN ('manager','fo_cashier') THEN
    branch_id := NULL;
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_actor() FROM PUBLIC;--> statement-breakpoint

-- The next number of a series for the branch's local month: <prefix>-<BRANCHCODE>-YYYYMM-NNNN (BILL-19). Serialised by
-- the staff_access lock every writer takes first; the unique constraints stay the backstop.
CREATE FUNCTION public.kasir_next_number(p_tenant uuid, p_branch uuid, p_prefix text) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_stem text;
  v_n integer;
BEGIN
  SELECT p_prefix || '-' || b.code || '-' || to_char(public.tax_local_date(p_tenant, clock_timestamp(), p_branch), 'YYYYMM') || '-'
    INTO v_stem FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = p_branch;
  IF p_prefix = 'INV' THEN
    SELECT coalesce(max(substr(i.number, length(v_stem) + 1)::integer), 0) + 1 INTO v_n
      FROM public.invoices i WHERE i.tenant_id = p_tenant AND i.branch_id = p_branch AND i.number LIKE v_stem || '%';
  ELSE
    SELECT coalesce(max(substr(r.number, length(v_stem) + 1)::integer), 0) + 1 INTO v_n
      FROM public.receipts r WHERE r.tenant_id = p_tenant AND r.branch_id = p_branch AND r.number LIKE v_stem || '%';
  END IF;
  RETURN v_stem || lpad(v_n::text, 4, '0');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_next_number(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- What is still owed on a line / an invoice: the line total less real (not simulated, BILL-29) allocations.
CREATE FUNCTION public.kasir_line_paid(p_tenant uuid, p_line uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(sum(a.amount), 0)::bigint FROM public.payment_allocations a
   WHERE a.tenant_id = p_tenant AND a.invoice_line_id = p_line AND NOT a.is_simulated
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_line_paid(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.kasir_outstanding(p_tenant uuid, p_invoice uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(sum(l.line_total - public.kasir_line_paid(l.tenant_id, l.id)), 0)::bigint
    FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_invoice
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_outstanding(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The visit payment step (T-047's open item; plan §4, r1 P3-7): in_progress while an issued invoice of the visit
-- still owes; done when it has issued invoices and none owes; not_started when it has none (after a void).
CREATE FUNCTION public.kasir_visit_payment(p_tenant uuid, p_visit uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_state text;
BEGIN
  IF p_visit IS NULL THEN
    RETURN;
  END IF;
  v_state := CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = p_tenant AND i.visit_id = p_visit AND i.state = 'issued') THEN 'not_started'
    WHEN EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = p_tenant AND i.visit_id = p_visit AND i.state = 'issued'
                   AND public.kasir_outstanding(i.tenant_id, i.id) > 0) THEN 'in_progress'
    ELSE 'done' END;
  UPDATE public.visits SET payment = v_state WHERE tenant_id = p_tenant AND id = p_visit AND closed_at IS NULL AND payment IS DISTINCT FROM v_state;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_visit_payment(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The SET-14 methods enabled at an instant (Kasir names → setting names), and the environment of this deployment
-- (the tenant's port is the mock adapter until T-073; nothing here reaches a provider).
CREATE FUNCTION public.kasir_method_enabled(p_method text, p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((public.setting_value_at('SET-14', NULL, p_at) -> 'metode') ?
    CASE p_method WHEN 'cash' THEN 'tunai' WHEN 'edc' THEN 'edc' WHEN 'transfer' THEN 'transfer' WHEN 'qris' THEN 'qris' WHEN 'balance' THEN 'saldo' ELSE '-' END, false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_method_enabled(text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Masking for the auditor (IAM-12): a patient reference without the name; the MRN's last 3 characters.
CREATE FUNCTION public.kasir_patient_json(p_tenant uuid, p_patient uuid, p_mask boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_patient IS NULL THEN NULL
    WHEN p_mask THEN (SELECT jsonb_build_object('id', pt.id, 'name', NULL, 'mrn', '***' || right(pt.mrn, 3)) FROM public.patients pt
                       WHERE pt.tenant_id = p_tenant AND pt.id = public.patient_canonical(p_tenant, p_patient))
    ELSE (SELECT jsonb_build_object('id', pt.id, 'name', pt.full_name, 'mrn', pt.mrn) FROM public.patients pt
           WHERE pt.tenant_id = p_tenant AND pt.id = public.patient_canonical(p_tenant, p_patient)) END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_patient_json(uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint

-- The pure allocation (BILL-2, plan §2, r1 P1-4): amount p over the lines' outstanding (in id order), proportional by
-- floor in numeric, then one rupiah each to the largest remainders (ties by line order). Σ = p; 0 ≤ a_i ≤ o_i.
-- Mirrored by src/modules/cashier/allocation.ts.
CREATE FUNCTION public.kasir_allocate(p_amount bigint, p_lines uuid[], p_outstanding bigint[]) RETURNS TABLE (line_id uuid, amount bigint)
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  n integer := coalesce(array_length(p_lines, 1), 0);
  v_total numeric := 0;
  v_base bigint[];
  v_rem numeric[];
  v_left bigint;
  i integer;
  k integer;
BEGIN
  IF n = 0 OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN;
  END IF;
  FOR i IN 1..n LOOP
    v_total := v_total + p_outstanding[i];
  END LOOP;
  IF p_amount > v_total THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: overpayment' USING ERRCODE = '22023';
  END IF;
  v_base := array_fill(0::bigint, ARRAY[n]);
  v_rem := array_fill(0::numeric, ARRAY[n]);
  v_left := p_amount;
  FOR i IN 1..n LOOP
    v_base[i] := floor(p_amount::numeric * p_outstanding[i]::numeric / v_total)::bigint;
    v_rem[i] := p_amount::numeric * p_outstanding[i]::numeric - v_base[i]::numeric * v_total;
    v_left := v_left - v_base[i];
  END LOOP;
  -- The residual rupiah (fewer than n): one each to the largest remainders. No line passes its outstanding:
  -- p ≤ Σo gives floor(p·o_i/Σo) ≤ o_i, and a floor reaches o_i only when p = Σo, where nothing is left over.
  FOR k IN SELECT x.i FROM unnest(v_rem) WITH ORDINALITY AS x(r, i) ORDER BY x.r DESC, x.i LOOP
    EXIT WHEN v_left <= 0;
    v_base[k] := v_base[k] + 1;
    v_left := v_left - 1;
  END LOOP;
  FOR i IN 1..n LOOP
    IF v_base[i] > 0 THEN
      line_id := p_lines[i]; amount := v_base[i];
      RETURN NEXT;
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_allocate(bigint, uuid[], bigint[]) FROM PUBLIC;--> statement-breakpoint

-- A void decided as manager (SET-43 `void`, r1 P1-3): only when the setting is "manager on the same day" and the
-- decision falls on the invoice's branch-local issue date; otherwise the owner decides. For the inbox copy.
CREATE FUNCTION public.kasir_manager_may_void(p_tenant uuid, p_invoice uuid, p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((public.setting_value_at('SET-43', NULL, p_at) ->> 'void') = 'manajer_hari_sama'
     AND public.tax_local_date(i.tenant_id, i.issued_at, i.branch_id) = public.tax_local_date(i.tenant_id, p_at, i.branch_id), false)
    FROM public.invoices i WHERE i.tenant_id = p_tenant AND i.id = p_invoice
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_manager_may_void(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.approval_manager_decides_void(p_approval uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT public.kasir_manager_may_void(ap.tenant_id, ap.subject_id, clock_timestamp())
                     FROM public.approvals ap WHERE ap.tenant_id = public.app_tenant_id() AND ap.id = p_approval AND ap.type = 'invoice_void'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_manager_decides_void(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_manager_decides_void(uuid) TO clinic_app;--> statement-breakpoint

INSERT INTO public.approval_types (key, label, requester_roles, approver_roles, owner_self) VALUES
  ('invoice_void', 'Void invoice', '{fo_cashier,manager,finance}', '{owner,manager}', false);--> statement-breakpoint

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receipts_read ON public.receipts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.kasir_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, invoice_id, number, total, paper, template_version_id, is_simulated, command_key, issued_by, issued_as, issued_at) ON public.receipts TO clinic_app;--> statement-breakpoint
CREATE POLICY receipts_operator_read ON public.receipts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.receipts', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, invoice_id, number, total, paper, template_version_id, is_simulated, command_key, issued_by, issued_as, issued_at) ON public.receipts TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER receipts_no_truncate BEFORE TRUNCATE ON public.receipts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.receipts ENABLE ALWAYS TRIGGER receipts_no_truncate;--> statement-breakpoint
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payments_read ON public.payments FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.kasir_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.payments TO clinic_app;--> statement-breakpoint
CREATE POLICY payments_operator_read ON public.payments FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payments', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payments TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON public.payments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payments ENABLE ALWAYS TRIGGER payments_no_truncate;--> statement-breakpoint
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_allocations_read ON public.payment_allocations FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.kasir_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.payment_allocations TO clinic_app;--> statement-breakpoint
CREATE POLICY payment_allocations_operator_read ON public.payment_allocations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payment_allocations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payment_allocations TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payment_allocations_no_truncate BEFORE TRUNCATE ON public.payment_allocations FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payment_allocations ENABLE ALWAYS TRIGGER payment_allocations_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.receipts', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'Kasir definers (src/modules/cashier)', 'the selling branch'),
  ('public.payments', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'Kasir definers (src/modules/cashier)', 'the selling branch'),
  ('public.payment_allocations', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'Kasir definers (src/modules/cashier)', 'the selling branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): receipts and payments personal, allocations money totals.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.receipts', 'personal'),
  ('public.payments', 'personal'),
  ('public.payment_allocations', 'money_total');--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS; the staff_access lock first, as every T-071 guard) ─────────────────────────────────────

-- Invoices (re-created from 0086): as before, plus the counter flag and the void fields frozen; a void names its
-- approval; a counter invoice has no visit.
CREATE OR REPLACE FUNCTION public.invoices_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.void_approval_id IS NOT NULL THEN
      RAISE EXCEPTION 'an invoice opens as a draft' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.sold_branch_id, NEW.patient_id, NEW.visit_id, NEW.counter, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.sold_branch_id, OLD.patient_id, OLD.visit_id, OLD.counter, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at)
       OR OLD.state = 'void'
       OR OLD.state = 'issued' AND (NEW.state NOT IN ('issued','void')
            OR (NEW.issued_at, NEW.issued_by, NEW.issued_as, NEW.is_pkp_at_issue) IS DISTINCT FROM (OLD.issued_at, OLD.issued_by, OLD.issued_as, OLD.is_pkp_at_issue)
            OR OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number)
       OR OLD.state = 'draft' AND NEW.state NOT IN ('draft','issued')
       OR OLD.state <> 'issued' AND NEW.void_approval_id IS DISTINCT FROM OLD.void_approval_id
       OR NEW.state = 'void' AND NOT EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = NEW.tenant_id AND ap.id = NEW.void_approval_id
                                               AND ap.type = 'invoice_void' AND ap.subject_id = NEW.id AND ap.state = 'approved') THEN
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

-- Receipts, payments and allocations: append-only (DATA-3); never changed or deleted.
CREATE FUNCTION public.kasir_rows_insert_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% rows are never changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_rows_insert_only() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER receipts_insert_only BEFORE UPDATE OR DELETE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.receipts ENABLE ALWAYS TRIGGER receipts_insert_only;--> statement-breakpoint
CREATE TRIGGER payments_insert_only BEFORE UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.payments ENABLE ALWAYS TRIGGER payments_insert_only;--> statement-breakpoint
CREATE TRIGGER payment_allocations_insert_only BEFORE UPDATE OR DELETE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.payment_allocations ENABLE ALWAYS TRIGGER payment_allocations_insert_only;--> statement-breakpoint

-- A payment is for an issued invoice of its branch and the invoice's patient (05:193 same-patient key).
CREATE FUNCTION public.payments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id AND i.state = 'issued'
                   AND i.patient_id IS NOT DISTINCT FROM NEW.patient_id)
     OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id = NEW.invoice_id
                      AND r.is_simulated = NEW.is_simulated) THEN
    RAISE EXCEPTION 'a payment is for an issued invoice, its patient and its receipt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payments_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_guard();--> statement-breakpoint
ALTER TABLE public.payments ENABLE ALWAYS TRIGGER payments_guard;--> statement-breakpoint

-- An allocation goes to a line of its payment's invoice, copies the payment's method, provider, account, environment
-- and simulated flag (DATA-28), and never takes a line above its total (the line is locked by the writer first).
CREATE FUNCTION public.payment_allocations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  p public.payments;
  l public.invoice_lines;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  SELECT * INTO p FROM public.payments x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.payment_id;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.invoice_line_id;
  IF p.id IS NULL OR l.id IS NULL OR l.invoice_id <> p.invoice_id
     OR (NEW.method, NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated)
        IS DISTINCT FROM (p.method, p.provider, p.provider_account, p.environment, p.is_simulated)
     OR (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.invoice_line_id = NEW.invoice_line_id
          AND a.is_simulated = NEW.is_simulated) + NEW.amount > l.line_total
     OR (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.payment_id = NEW.payment_id) + NEW.amount > p.amount THEN
    RAISE EXCEPTION 'an allocation stays within its payment and its line' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_allocations_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payment_allocations_guard BEFORE INSERT ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.payment_allocations_guard();--> statement-breakpoint
ALTER TABLE public.payment_allocations ENABLE ALWAYS TRIGGER payment_allocations_guard;--> statement-breakpoint

-- Dispensings (re-created from 0082): a visit dispensing opens queued on an open visit (as before); a counter
-- dispensing (T-072) opens queued on a line of an issued counter invoice of its branch, for that invoice's patient;
-- the invoice line is frozen like the rest of the identity.
CREATE OR REPLACE FUNCTION public.dispensings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dispensings are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.prepared_at IS NOT NULL
       OR NEW.visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = NEW.tenant_id AND v.branch_id = NEW.branch_id AND v.id = NEW.visit_id AND v.closed_at IS NULL)
       OR NEW.visit_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
             WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.invoice_line_id AND i.branch_id = NEW.branch_id AND i.counter AND i.state = 'issued'
               AND i.patient_id IS NOT DISTINCT FROM NEW.patient_id) THEN
      RAISE EXCEPTION 'a dispensing opens queued on an open visit or an issued counter sale' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.patient_id, NEW.selection_item_id, NEW.prescription_item_id, NEW.invoice_line_id, NEW.stock_item_id, NEW.quantity,
      NEW.external_use, NEW.queued_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.patient_id, OLD.selection_item_id, OLD.prescription_item_id, OLD.invoice_line_id, OLD.stock_item_id, OLD.quantity,
      OLD.external_use, OLD.queued_at)
     OR OLD.state IN ('handed','cancelled')
     OR NOT (OLD.state = 'queued' AND NEW.state IN ('prepared','cancelled') OR OLD.state = 'prepared' AND NEW.state IN ('handed','cancelled'))
     OR OLD.prepared_at IS NOT NULL AND (NEW.prepared_at, NEW.prepared_by, NEW.prepare_key, NEW.depot_id) IS DISTINCT FROM (OLD.prepared_at, OLD.prepared_by, OLD.prepare_key, OLD.depot_id) THEN
    RAISE EXCEPTION 'a dispensing moves queued → prepared → handed or cancelled, once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- ── Writers (PR-19; the actor lock first, then role, capability and branch; idempotency by key; events ids only) ──

-- invoice_open (re-created from 0086): adds the counter flag (Jual Cepat: no visit, patient optional) and refuses a
-- closed visit (r1 P2-5). p: {patient_id?, visit_id?, counter?}. Returns the invoice id.
CREATE OR REPLACE FUNCTION public.invoice_open(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.invoice_actor(p_branch);
  v_patient uuid;
  v_visit uuid;
  v_counter boolean;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'patient_id' - 'visit_id' - 'counter' <> '{}'::jsonb
     OR p ->> 'visit_id' IS NOT NULL AND p ->> 'patient_id' IS NULL
     OR p ? 'counter' AND jsonb_typeof(p -> 'counter') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invoice' USING ERRCODE = '22023';
  END IF;
  v_counter := coalesce((p ->> 'counter')::boolean, false);
  IF v_counter AND p ->> 'visit_id' IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: counter_without_visit' USING ERRCODE = '22023';
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
    IF EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.id = v_visit AND v.closed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.invoices (tenant_id, branch_id, sold_branch_id, patient_id, visit_id, counter, command_key, created_by, created_as)
    VALUES (a.tenant_id, a.branch_id, a.branch_id, v_patient, v_visit, v_counter, p_key, a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an invoice with this key exists' USING ERRCODE = '23505';
  END;
  RETURN v_id;
END
$$;--> statement-breakpoint

-- invoice_issue (re-created from 0086; one issue path for the Kasir and T-071's callers): T-071's freezing at one
-- instant (every line through invoice_line_snapshot), then the Kasir rules (PR-19, r1 P2-5). A visit invoice: the visit
-- locked first (staff_access → visit → invoice → lines), open, and not yet invoiced; the payment step follows. A
-- counter invoice: products only, each with an active stock item and not on the special list (PR-18), each line one
-- queued counter dispensing. The number INV-<branch>-YYYYMM-NNNN is set at issue. p: {lines: [{item_id, quantity,
-- discount?}] 1–100}. Returns {invoice_id, number, issued_at, is_pkp_at_issue, total}.
CREATE OR REPLACE FUNCTION public.invoice_issue(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  v_at timestamptz := clock_timestamp();
  v_l jsonb;
  v_pkp boolean;
  v_number text;
  l record;
  v_stock uuid;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
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
  IF i.visit_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id AND v.closed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.invoices x WHERE x.tenant_id = i.tenant_id AND x.visit_id = i.visit_id AND x.state = 'issued') THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_already_invoiced' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF i.counter AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x
                             LEFT JOIN public.catalog_items ci ON ci.tenant_id = i.tenant_id AND ci.id = (x ->> 'item_id')::uuid
                            WHERE ci.kind IS DISTINCT FROM 'product') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: counter_products_only' USING ERRCODE = '22023';
  END IF;
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x LOOP
    PERFORM public.invoice_line_snapshot(i, (v_l ->> 'item_id')::uuid, (v_l ->> 'quantity')::integer, coalesce((v_l ->> 'discount')::bigint, 0), v_at);
  END LOOP;
  v_pkp := public.tax_pkp_at(i.tenant_id, v_at, i.branch_id);
  v_number := public.kasir_next_number(i.tenant_id, i.branch_id, 'INV');
  UPDATE public.invoices SET state = 'issued', issued_at = v_at, issued_by = a.staff_id, issued_as = a.role, is_pkp_at_issue = v_pkp, number = v_number
   WHERE tenant_id = i.tenant_id AND id = i.id;
  IF i.counter THEN
    FOR l IN SELECT x.* FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id ORDER BY x.created_at, x.id LOOP
      IF public.pharmacy_special(i.tenant_id, l.item_id) THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: special_item' USING ERRCODE = '22023';
      END IF;
      SELECT si.id INTO v_stock FROM public.stock_items si WHERE si.tenant_id = i.tenant_id AND si.catalog_item_id = l.item_id AND si.active;
      IF v_stock IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: product_without_stock_item' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.dispensings (tenant_id, branch_id, visit_id, patient_id, invoice_line_id, stock_item_id, quantity)
      VALUES (i.tenant_id, i.branch_id, NULL, i.patient_id, l.id, v_stock, l.quantity);
    END LOOP;
  END IF;
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceIssued', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'branch_id', i.branch_id));
  PERFORM public.audit_append('settings_change', 'invoice', i.id, 'success', 'invoice_issued');
  RETURN jsonb_build_object('invoice_id', i.id, 'issued_at', v_at, 'is_pkp_at_issue', v_pkp, 'number', v_number,
    'total', (SELECT sum(x.line_total) FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id));
END
$$;--> statement-breakpoint

-- The receipt body (BILL-19): the tenant's active receipt template when there is one (its version stamped used once,
-- DEC-067), else the built-in layout; commercial facts only (item names, quantities, amounts, methods), never
-- clinical content. The vendor name is marked while the vendor identity still has placeholders (DEC-018).
CREATE FUNCTION public.kasir_receipt_body(i public.invoices, p_number text, p_at timestamptz, p_tenders jsonb, OUT body text, OUT paper text, OUT template_version_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.branches;
  tv public.document_template_versions;
  vi jsonb := public.vendor_identity();
  v_lines text;
  v_methods text;
  v_vals jsonb;
  rp text;
BEGIN
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = i.tenant_id AND x.id = i.branch_id;
  SELECT string_agg(cv.name || ' × ' || l.quantity || '  Rp' || to_char(l.line_total, 'FM999G999G999G999'), E'\n' ORDER BY l.created_at, l.id)
    INTO v_lines FROM public.invoice_lines l JOIN public.catalog_versions cv ON cv.tenant_id = l.tenant_id AND cv.id = l.catalog_version_id
   WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id;
  SELECT string_agg(CASE t ->> 'method' WHEN 'cash' THEN 'Tunai' WHEN 'edc' THEN 'EDC' WHEN 'transfer' THEN 'Transfer' ELSE t ->> 'method' END
                    || ' Rp' || to_char((t ->> 'amount')::bigint, 'FM999G999G999G999'), ', ')
    INTO v_methods FROM jsonb_array_elements(p_tenders) t;
  rp := 'Rp' || to_char((SELECT sum((t ->> 'amount')::bigint) FROM jsonb_array_elements(p_tenders) t), 'FM999G999G999G999');
  v_vals := jsonb_build_object(
    'klinik.nama', (SELECT t.legal_name FROM public.tenants t WHERE t.id = i.tenant_id),
    'klinik.npwp', (SELECT t.npwp FROM public.tenants t WHERE t.id = i.tenant_id),
    'cabang.nama', b.name, 'cabang.alamat', b.address,
    'tanggal', to_char((p_at AT TIME ZONE b.timezone), 'DD-MM-YYYY HH24:MI'),
    'struk.nomor', p_number, 'struk.baris', replace(v_lines, ',', '.'), 'struk.total', replace(rp, ',', '.'), 'struk.metode_bayar', replace(v_methods, ',', '.'),
    'pasien.nama', (SELECT pt.full_name FROM public.patients pt WHERE pt.tenant_id = i.tenant_id AND pt.id = public.patient_canonical(i.tenant_id, i.patient_id)),
    'pasien.no_rm', (SELECT pt.mrn FROM public.patients pt WHERE pt.tenant_id = i.tenant_id AND pt.id = public.patient_canonical(i.tenant_id, i.patient_id)),
    'vendor.nama', coalesce(vi ->> 'legal_name', '') || CASE WHEN vi -> 'placeholders' ? 'legal_name' THEN ' (contoh, belum diisi)' ELSE '' END);
  SELECT v.* INTO tv FROM public.document_template_versions v JOIN public.document_templates t ON t.tenant_id = v.tenant_id AND t.id = v.template_id
   WHERE v.tenant_id = i.tenant_id AND v.kind = 'receipt' AND v.state = 'active' AND t.state = 'active'
   ORDER BY v.created_at DESC, v.id DESC LIMIT 1;
  IF tv.id IS NOT NULL THEN
    body := public.template_fill(tv.body, v_vals);
    paper := tv.paper;
    template_version_id := tv.id;
    UPDATE public.document_template_versions SET used_at = clock_timestamp() WHERE tenant_id = tv.tenant_id AND id = tv.id AND used_at IS NULL;
  ELSE
    body := public.template_fill(E'{{klinik.nama}}\n{{cabang.nama}} · {{cabang.alamat}}\nNPWP {{klinik.npwp}}\n\nStruk {{struk.nomor}}\n{{tanggal}}\n\n{{struk.baris}}\n\nTotal dibayar {{struk.total}}\n{{struk.metode_bayar}}', v_vals);
    paper := '80mm';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_receipt_body(public.invoices, text, timestamptz, jsonb) FROM PUBLIC;--> statement-breakpoint

-- payment_receive (PR-19, BILL-2, BILL-17, A-12): one Terima on an issued invoice. p: {tenders: [{method, amount,
-- cash_tendered?, details?}] 1–6}. Methods now: cash (at most one; tendered ≥ amount, change returned), EDC, transfer,
-- each enabled in SET-14 at this instant; QRIS, VA and payment link wait for the payment port (T-073) and the patient
-- balance for T-075 (ERR_NOT_AVAILABLE). The invoice and its lines are locked (staff_access → visit → invoice → lines
-- in id order); Σ amounts ≤ outstanding. One receipt (the command key), one payment per tender (seq), each allocated in
-- order over the running outstanding (proportional after discount, largest remainder; VAT-inclusive outstanding
-- weights, plan open point 1), allocations only where > 0. A PKP line recognises its VAT at payment (the earlier tax
-- point) up to its share of what is paid, never twice. Events PaymentReceived and PaymentAllocated (ids only).
-- Returns {receipt_id, number, paid, change, outstanding}.
CREATE FUNCTION public.payment_receive(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  v_at timestamptz := clock_timestamp();
  v_t jsonb;
  v_seq integer := 0;
  v_sum bigint := 0;
  v_change bigint := 0;
  v_receipt uuid;
  v_number text;
  v_payment uuid;
  v_ids uuid[];
  v_out bigint[];
  v_alloc record;
  v_line public.invoice_lines;
  v_paid bigint;
  v_target bigint;
  v_portion bigint;
  v_alloc_id uuid;
  v_env text;
  rb record;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id AND ap.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: void_pending' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'tenders' <> '{}'::jsonb OR jsonb_typeof(p -> 'tenders') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p -> 'tenders') NOT BETWEEN 1 AND 6
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'tenders') t
                 WHERE jsonb_typeof(t) IS DISTINCT FROM 'object' OR t - 'method' - 'amount' - 'cash_tendered' - 'details' <> '{}'::jsonb
                    OR coalesce(t ->> 'method', '') NOT IN ('cash','edc','transfer','qris','va','payment_link','balance')
                    OR jsonb_typeof(t -> 'amount') IS DISTINCT FROM 'number' OR (t ->> 'amount') !~ '^[1-9]\d{0,12}$'
                    OR (t ->> 'method' = 'cash') <> (t ? 'cash_tendered')
                    OR t ? 'cash_tendered' AND (jsonb_typeof(t -> 'cash_tendered') IS DISTINCT FROM 'number' OR (t ->> 'cash_tendered') !~ '^[1-9]\d{0,12}$'
                                                 OR (t ->> 'cash_tendered')::bigint < (t ->> 'amount')::bigint)
                    OR t ? 'details' AND (t ->> 'method' NOT IN ('edc','transfer') OR jsonb_typeof(t -> 'details') IS DISTINCT FROM 'object'
                                          OR (t -> 'details') - 'card_type' - 'bank' - 'trace' - 'approval_code' - 'reference' <> '{}'::jsonb
                                          OR EXISTS (SELECT 1 FROM jsonb_each(t -> 'details') d WHERE jsonb_typeof(d.value) <> 'string' OR length(d.value #>> '{}') NOT BETWEEN 1 AND 60)))
     OR (SELECT count(*) FROM jsonb_array_elements(p -> 'tenders') t WHERE t ->> 'method' = 'cash') > 1 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: tenders' USING ERRCODE = '22023';
  END IF;
  FOR v_t IN SELECT t FROM jsonb_array_elements(p -> 'tenders') t LOOP
    IF v_t ->> 'method' IN ('qris','va','payment_link') THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: payment_port' USING ERRCODE = '55000';
    ELSIF v_t ->> 'method' = 'balance' THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: balance' USING ERRCODE = '55000';
    ELSIF NOT public.kasir_method_enabled(v_t ->> 'method', v_at) THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
    END IF;
    v_sum := v_sum + (v_t ->> 'amount')::bigint;
  END LOOP;
  -- Lines in id order, locked; the outstanding is read under the lock.
  PERFORM 1 FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id ORDER BY l.id FOR UPDATE;
  IF v_sum > public.kasir_outstanding(i.tenant_id, i.id) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: overpayment' USING ERRCODE = '22023';
  END IF;
  v_env := 'production';
  v_number := public.kasir_next_number(i.tenant_id, i.branch_id, 'KW');
  SELECT * INTO rb FROM public.kasir_receipt_body(i, v_number, v_at, p -> 'tenders');
  BEGIN
    INSERT INTO public.receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, template_version_id, command_key, issued_by, issued_as, issued_at)
    VALUES (i.tenant_id, i.branch_id, i.id, v_number, v_sum, rb.body, rb.paper, rb.template_version_id, p_key, a.staff_id, a.role, v_at)
    RETURNING id INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
  END;
  FOR v_t IN SELECT t FROM jsonb_array_elements(p -> 'tenders') t LOOP
    v_seq := v_seq + 1;
    IF v_t ? 'cash_tendered' THEN
      v_change := (v_t ->> 'cash_tendered')::bigint - (v_t ->> 'amount')::bigint;
    END IF;
    INSERT INTO public.payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                                 environment, received_by, received_as, received_at)
    VALUES (i.tenant_id, i.branch_id, v_receipt, v_seq, i.id, i.patient_id, v_t ->> 'method', (v_t ->> 'amount')::bigint,
            (v_t ->> 'cash_tendered')::bigint, CASE WHEN v_t ? 'cash_tendered' THEN (v_t ->> 'cash_tendered')::bigint - (v_t ->> 'amount')::bigint END,
            v_t -> 'details', v_env, a.staff_id, a.role, v_at)
    RETURNING id INTO v_payment;
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (i.branch_id, 'PaymentReceived', 'payment', v_payment, jsonb_build_object('payment_id', v_payment, 'invoice_id', i.id));
    -- This tender over the running outstanding (r1 P1-4: sequential, so no rupiah is allocated twice).
    SELECT array_agg(l.id ORDER BY l.id), array_agg(l.line_total - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id)
      INTO v_ids, v_out FROM public.invoice_lines l
     WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.line_total - public.kasir_line_paid(l.tenant_id, l.id) > 0;
    FOR v_alloc IN SELECT * FROM public.kasir_allocate((v_t ->> 'amount')::bigint, v_ids, v_out) LOOP
      SELECT * INTO v_line FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.id = v_alloc.line_id;
      v_paid := public.kasir_line_paid(i.tenant_id, v_line.id) + v_alloc.amount;
      -- VAT due at payment: the paid share of the line's VAT, rounded half up, never below what is recognised.
      v_target := CASE WHEN v_line.vat_amount = 0 THEN 0
                       ELSE floor((v_line.vat_amount::numeric * v_paid::numeric * 2 + v_line.line_total::numeric) / (2 * v_line.line_total::numeric))::bigint END;
      v_portion := greatest(0, v_target - v_line.vat_recognised_amount);
      INSERT INTO public.payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, vat_portion, method, provider, provider_account, environment, is_simulated)
      VALUES (i.tenant_id, i.branch_id, v_payment, v_line.id, v_alloc.amount, v_portion, v_t ->> 'method', NULL, NULL, v_env, false)
      RETURNING id INTO v_alloc_id;
      IF v_portion > 0 THEN
        UPDATE public.invoice_lines SET vat_recognised_amount = vat_recognised_amount + v_portion, vat_recognised_at = coalesce(vat_recognised_at, v_at)
         WHERE tenant_id = i.tenant_id AND id = v_line.id;
      END IF;
      INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
      VALUES (i.branch_id, 'PaymentAllocated', 'payment_allocation', v_alloc_id, jsonb_build_object('allocation_id', v_alloc_id, 'payment_id', v_payment));
    END LOOP;
  END LOOP;
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  PERFORM public.audit_append('money_correction', 'receipt', v_receipt, 'success', 'payment_received');
  RETURN jsonb_build_object('receipt_id', v_receipt, 'number', v_number, 'paid', v_sum, 'change', v_change,
    'outstanding', public.kasir_outstanding(i.tenant_id, i.id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_receive(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_receive(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- invoice_void_request (PR-19, PR-44): FO/cashier, manager or finance asks to void an issued invoice with a reason,
-- only while nothing is paid and no counter dispensing is handed (r1 open point 2: a paid invoice is corrected by a
-- refund, T-078). One pending request per invoice (approvals_one_per_subject). Returns the approval id.
CREATE FUNCTION public.invoice_void_request(p_invoice uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  v_id uuid;
BEGIN
  IF a.role NOT IN ('fo_cashier','manager','finance') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not request a void' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_allocations x JOIN public.payments y ON y.tenant_id = x.tenant_id AND y.id = x.payment_id
              WHERE y.tenant_id = i.tenant_id AND y.invoice_id = i.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_paid' USING ERRCODE = '55000';
  END IF;
  v_id := public.approval_request('invoice_void', 'invoice', i.id, btrim(p_reason), i.branch_id,
    (SELECT sum(l.line_total) FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id)::bigint);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_void_request(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.invoice_void_request(uuid, text) TO clinic_app;--> statement-breakpoint

-- The void decision (as stock_count_sync): approved → the invoice void, its open counter dispensings cancelled, the
-- visit step recomputed, InvoiceVoided; a decision taken as manager follows SET-43 `void` (manager on the issue day
-- only, else the owner; r1 P1-3; approved and rejected only, never a withdrawal, r2). A payment after the request
-- blocks the approval (the preconditions are re-checked under the lock).
CREATE FUNCTION public.invoice_void_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.invoices;
BEGIN
  IF NEW.type <> 'invoice_void' OR NEW.subject_kind <> 'invoice' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO i FROM public.invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.subject_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NEW.state IN ('approved','rejected') AND NEW.decided_as = 'manager' AND NOT public.kasir_manager_may_void(i.tenant_id, i.id, clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner may decide this void' USING ERRCODE = '42501';
  END IF;
  IF NEW.state <> 'approved' THEN
    RETURN NULL;
  END IF;
  IF i.state <> 'issued' OR EXISTS (SELECT 1 FROM public.payments y WHERE y.tenant_id = i.tenant_id AND y.invoice_id = i.id)
     OR EXISTS (SELECT 1 FROM public.dispensings d JOIN public.invoice_lines l ON l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id
                 WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND d.state = 'handed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_paid' USING ERRCODE = '55000';
  END IF;
  UPDATE public.invoices SET state = 'void', void_approval_id = NEW.id, voided_at = clock_timestamp() WHERE tenant_id = i.tenant_id AND id = i.id;
  UPDATE public.dispensings d SET state = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = NEW.decided_by, cancel_reason = 'Invoice dibatalkan'
    FROM public.invoice_lines l
   WHERE d.tenant_id = i.tenant_id AND l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id AND l.invoice_id = i.id AND d.state IN ('queued','prepared');
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceVoided', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'approval_id', NEW.id));
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_void_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_invoice_void_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.invoice_void_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_invoice_void_sync;--> statement-breakpoint

-- ── Counter-sale dispensings in the pharmacy (PR-19 "pharmacist hand-over"; r1 P1-1, P1-2) ────────────────────────
-- Re-created from 0082 with the same signatures and attributes; a counter dispensing has no visit (its invoice line
-- names it): the payment blocker reads the invoice, the lists admit it, the events carry no null.

-- The patient of a dispensing for the lists: the visit's (as 0082), or for a counter sale the named patient or
-- "Penjualan langsung", keyed by the invoice line (the Siapkan grouping key) and timed by the queue time.
CREATE FUNCTION public.pharmacy_dispensing_patient(d public.dispensings) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN d.visit_id IS NOT NULL THEN public.pharmacy_patient_json(d.tenant_id, d.visit_id)
    ELSE coalesce(
      (SELECT jsonb_build_object('visit_id', d.invoice_line_id, 'patient_id', pt.id, 'name', pt.full_name, 'mrn', pt.mrn, 'checked_in_at', d.queued_at,
                                 'payment', CASE WHEN public.kasir_outstanding(i.tenant_id, i.id) > 0 THEN 'in_progress' ELSE 'done' END)
         FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
         JOIN public.patients pt ON pt.tenant_id = i.tenant_id AND pt.id = public.patient_canonical(i.tenant_id, i.patient_id)
        WHERE l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id),
      (SELECT jsonb_build_object('visit_id', d.invoice_line_id, 'patient_id', NULL, 'name', 'Penjualan langsung', 'mrn', NULL, 'checked_in_at', d.queued_at,
                                 'payment', CASE WHEN public.kasir_outstanding(i.tenant_id, i.id) > 0 THEN 'in_progress' ELSE 'done' END)
         FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
        WHERE l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id)) END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pharmacy_dispensing_patient(public.dispensings) FROM PUBLIC;--> statement-breakpoint

-- The dispensing locked with its visit first (0082), or for a counter sale its invoice first (the Kasir's order:
-- staff_access → invoice → dispensing).
CREATE OR REPLACE FUNCTION public.dispensing_locked(p_tenant uuid, p_branch uuid, p_dispensing uuid) RETURNS public.dispensings
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_visit uuid;
  v_line uuid;
  d public.dispensings;
BEGIN
  SELECT x.visit_id, x.invoice_line_id INTO v_visit, v_line FROM public.dispensings x WHERE x.tenant_id = p_tenant AND x.id = p_dispensing AND x.branch_id = p_branch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: dispensing not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_visit IS NOT NULL THEN
    PERFORM public.pharmacy_visit_locked(p_tenant, p_branch, v_visit);
  ELSE
    PERFORM 1 FROM public.invoices i JOIN public.invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
     WHERE l.tenant_id = p_tenant AND l.id = v_line FOR UPDATE OF i;
  END IF;
  SELECT * INTO d FROM public.dispensings x WHERE x.tenant_id = p_tenant AND x.id = p_dispensing FOR UPDATE;
  RETURN d;
END
$$;--> statement-breakpoint

-- What blocks dispensing now: the prescription, payment (the visit step, or a counter sale's invoice still owing or
-- void), a special item.
CREATE OR REPLACE FUNCTION public.dispensing_blocker(d public.dispensings) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.pharmacy_rx_blocker(d),
    CASE WHEN d.visit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = d.tenant_id AND v.id = d.visit_id AND v.payment IN ('in_progress','blocked'))
              OR d.visit_id IS NULL AND EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                                                  WHERE l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id
                                                    AND (i.state <> 'issued' OR public.kasir_outstanding(i.tenant_id, i.id) > 0))
         THEN 'payment_unpaid' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = d.tenant_id AND si.id = d.stock_item_id AND public.pharmacy_special(si.tenant_id, si.catalog_item_id))
         THEN 'special_item' END)
$$;--> statement-breakpoint

-- Serahkan (as 0082): the visit step only for a visit dispensing; the event payload without nulls (0018).
CREATE OR REPLACE FUNCTION public.dispense_hand_over(p_key text, p_dispensing uuid, p jsonb) RETURNS void
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
  IF d.visit_id IS NOT NULL THEN
    PERFORM public.pharmacy_visit_steps(d.tenant_id, d.visit_id);
  END IF;
  PERFORM public.audit_append('sign', 'dispensing', d.id, 'success', 'dispensing_handed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (d.branch_id, CASE WHEN d.prescription_item_id IS NOT NULL THEN 'MedicationDispensed' ELSE 'ProductHandedOver' END, 'dispensing', d.id,
          jsonb_strip_nulls(jsonb_build_object('dispensing_id', d.id, 'visit_id', d.visit_id, 'invoice_line_id', d.invoice_line_id)));
END
$$;--> statement-breakpoint

-- Batalkan (as 0082): the visit step only for a visit dispensing.
CREATE OR REPLACE FUNCTION public.dispense_cancel(p_dispensing uuid, p_reason text) RETURNS void
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
  IF d.visit_id IS NOT NULL THEN
    PERFORM public.pharmacy_visit_steps(d.tenant_id, d.visit_id);
  END IF;
  PERFORM public.audit_append('settings_change', 'dispensing', d.id, 'success', 'dispensing_cancelled');
END
$$;--> statement-breakpoint

-- One dispensing row (as 0082): the patient through pharmacy_dispensing_patient; source 'counter' for a sale.
CREATE OR REPLACE FUNCTION public.pharmacy_dispensing_row(d public.dispensings) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_depot uuid := coalesce(d.depot_id, public.pharmacy_dispense_depot(d.tenant_id, d.branch_id, d.stock_item_id, d.quantity));
  v_hint jsonb;
BEGIN
  v_hint := CASE WHEN d.state IN ('queued','prepared') THEN public.pharmacy_fefo_hint(d.tenant_id, v_depot, d.stock_item_id, d.quantity) END;
  RETURN jsonb_build_object('id', d.id, 'state', d.state,
    'source', CASE WHEN d.prescription_item_id IS NOT NULL THEN 'prescription' WHEN d.selection_item_id IS NOT NULL THEN 'selection' ELSE 'counter' END,
    'patient', public.pharmacy_dispensing_patient(d), 'item', public.pharmacy_item_name(d.tenant_id, d.stock_item_id),
    'quantity', d.quantity, 'external_use', d.external_use, 'queued_at', d.queued_at, 'prepared_at', d.prepared_at, 'handed_at', d.handed_at,
    'depot', (SELECT jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind) FROM public.depots x WHERE x.tenant_id = d.tenant_id AND x.id = v_depot),
    'suggestion', v_hint,
    'blocker', coalesce(public.dispensing_blocker(d), CASE WHEN d.state IN ('queued','prepared') AND v_hint IS NULL THEN 'stock_unavailable' END),
    'label', (SELECT jsonb_build_object('kind', l.kind, 'print_count', l.print_count, 'last_printed_at', l.last_printed_at)
                FROM public.labels l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id));
END
$$;--> statement-breakpoint

-- Siapkan (as 0082): queued counter dispensings are listed with the visit ones (LEFT JOIN, r1 P1-2).
CREATE OR REPLACE FUNCTION public.pharmacy_prep_list() RETURNS jsonb
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
        FROM public.dispensings d LEFT JOIN public.visits v ON v.tenant_id = d.tenant_id AND v.id = d.visit_id
       WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.state = 'queued' AND v.closed_at IS NULL), '[]'::jsonb), -- no visit row (a counter sale) reads as open
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

-- Serahkan list (as 0082): prepared counter dispensings too.
CREATE OR REPLACE FUNCTION public.pharmacy_handover_list() RETURNS jsonb
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
        FROM public.dispensings d LEFT JOIN public.visits v ON v.tenant_id = d.tenant_id AND v.id = d.visit_id
       WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.state = 'prepared' AND v.closed_at IS NULL), '[]'::jsonb), -- no visit row (a counter sale) reads as open
    'handed_today', coalesce((
      SELECT jsonb_agg(public.pharmacy_dispensing_row(d) ORDER BY d.handed_at DESC, d.id)
        FROM public.dispensings d
       WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.state = 'handed'
         AND (d.handed_at AT TIME ZONE b.timezone)::date = (clock_timestamp() AT TIME ZONE b.timezone)::date), '[]'::jsonb));
END
$$;--> statement-breakpoint

-- Recall trace (as 0082): a counter sale's patient (or "Penjualan langsung") through pharmacy_dispensing_patient.
CREATE OR REPLACE FUNCTION public.pharmacy_recall_trace(p_batch uuid) RETURNS jsonb
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
    'dispensed', coalesce((SELECT jsonb_agg(jsonb_build_object('dispensing_id', d.id, 'patient', public.pharmacy_dispensing_patient(d),
                                   'quantity', l.quantity, 'handed_at', d.handed_at) ORDER BY d.handed_at DESC, d.id)
                             FROM public.dispensing_lines l JOIN public.dispensings d ON d.tenant_id = l.tenant_id AND d.id = l.dispensing_id AND d.state = 'handed'
                            WHERE l.tenant_id = b.tenant_id AND l.batch_id = b.id), '[]'::jsonb),
    'holds', coalesce((SELECT jsonb_agg(jsonb_build_object('from', h.from_state, 'to', h.to_state, 'reason', h.reason, 'at', h.at) ORDER BY h.at, h.id)
                         FROM public.stock_batch_holds h WHERE h.tenant_id = b.tenant_id AND h.batch_id = b.id), '[]'::jsonb));
END
$$;--> statement-breakpoint

-- ── Readers (UX-12; commercial facts only, never clinical content; the auditor masked, IAM-12) ──────────────────

-- The Kasir reader: the actor lock; manager and FO/cashier at their active branch; owner, finance and auditor
-- tenant-wide (07 "Cashier & receipts"), at a named branch when given. Returns the actor and the branch (NULL for a
-- tenant-wide role without one; the lists then default to the first branch by name).
CREATE FUNCTION public.kasir_reader(p_branch uuid, OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, v_branch FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','manager','fo_cashier','finance','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the cashier' USING ERRCODE = '42501';
  END IF;
  IF role IN ('manager','fo_cashier') THEN
    IF v_branch IS NULL OR p_branch IS NOT NULL AND p_branch <> v_branch THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: not your active branch' USING ERRCODE = '42501';
    END IF;
    branch_id := v_branch;
  ELSE
    branch_id := p_branch;
    IF branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = kasir_reader.tenant_id AND b.id = kasir_reader.branch_id) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_reader(uuid) FROM PUBLIC;--> statement-breakpoint

-- One invoice row for the lists.
CREATE FUNCTION public.kasir_invoice_row(i public.invoices, p_mask boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', i.id, 'number', i.number, 'state', i.state, 'counter', i.counter, 'visit_id', i.visit_id, 'issued_at', i.issued_at,
    'patient', public.kasir_patient_json(i.tenant_id, i.patient_id, p_mask),
    'total', (SELECT coalesce(sum(l.line_total), 0) FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id),
    'outstanding', public.kasir_outstanding(i.tenant_id, i.id),
    'void_pending', EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id AND ap.state = 'pending'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_invoice_row(public.invoices, boolean) FROM PUBLIC;--> statement-breakpoint

-- Kasir queue (UX-12 ▸ Siap Ditagih · Tagihan Terbuka): open visits of the branch with a confirmed selection and no
-- issued invoice; issued invoices still owing; drafts not yet issued. Newest activity first, bounded.
CREATE FUNCTION public.kasir_queue(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(p_branch);
  b public.branches;
  v_mask boolean := a.role = 'auditor';
BEGIN
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND (x.id = a.branch_id OR a.branch_id IS NULL) ORDER BY x.name, x.id LIMIT 1;
  a.branch_id := b.id;
  RETURN jsonb_build_object('now', clock_timestamp(), 'branch', jsonb_build_object('id', b.id, 'name', b.name), 'role', a.role,
    'ready', coalesce((SELECT jsonb_agg(x.j ORDER BY x.t) FROM (
        SELECT jsonb_build_object('visit_id', v.id, 'checked_in_at', v.checked_in_at, 'patient', public.kasir_patient_json(v.tenant_id, v.patient_id, v_mask),
                 'draft_id', (SELECT i.id FROM public.invoices i WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'draft' ORDER BY i.created_at DESC LIMIT 1)) j,
               v.checked_in_at t
          FROM public.visits v
         WHERE v.tenant_id = a.tenant_id AND v.branch_id = a.branch_id AND v.closed_at IS NULL AND v.selection = 'done'
           AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued')
         ORDER BY v.checked_in_at LIMIT 200) x), '[]'::jsonb),
    'open', coalesce((SELECT jsonb_agg(public.kasir_invoice_row(i, v_mask) ORDER BY i.issued_at)
        FROM (SELECT * FROM public.invoices i WHERE i.tenant_id = a.tenant_id AND i.branch_id = a.branch_id AND i.state = 'issued'
                AND public.kasir_outstanding(i.tenant_id, i.id) > 0 ORDER BY i.issued_at LIMIT 200) i), '[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(public.kasir_invoice_row(i, v_mask) ORDER BY i.issued_at DESC)
        FROM (SELECT * FROM public.invoices i WHERE i.tenant_id = a.tenant_id AND i.branch_id = a.branch_id AND i.state IN ('issued','void')
                AND i.issued_at >= clock_timestamp() - interval '2 days' AND public.kasir_outstanding(i.tenant_id, i.id) = 0
              ORDER BY i.issued_at DESC LIMIT 50) i), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_queue(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kasir_queue(uuid) TO clinic_app;--> statement-breakpoint

-- One invoice for the Kasir (UX-12): header, lines (frozen price, tax badge, paid, outstanding), payments by receipt,
-- the tenders offered now with their blocked reason, the void state. The auditor sees the patient masked and no
-- free-text void reason.
CREATE FUNCTION public.kasir_invoice_get(p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  i public.invoices;
  v_mask boolean := a.role = 'auditor';
  v_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.kasir_invoice_row(i, v_mask) || jsonb_build_object(
    'branch', (SELECT jsonb_build_object('id', b.id, 'name', b.name) FROM public.branches b WHERE b.tenant_id = i.tenant_id AND b.id = i.branch_id),
    'is_pkp_at_issue', i.is_pkp_at_issue, 'voided_at', i.voided_at, 'role', a.role,
    'can_pay', a.role IN ('owner','manager','fo_cashier','finance'),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'name', cv.name, 'quantity', l.quantity, 'unit_price', l.unit_price,
                                 'discount', l.discount, 'line_total', l.line_total, 'tax_category', l.tax_category, 'vat_amount', l.vat_amount,
                                 'vat_recognised', l.vat_recognised_amount, 'paid', public.kasir_line_paid(l.tenant_id, l.id),
                                 'dispensing', (SELECT jsonb_build_object('id', d.id, 'state', d.state) FROM public.dispensings d WHERE d.tenant_id = l.tenant_id AND d.invoice_line_id = l.id))
                                 ORDER BY l.created_at, l.id)
                         FROM public.invoice_lines l JOIN public.catalog_versions cv ON cv.tenant_id = l.tenant_id AND cv.id = l.catalog_version_id
                        WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'total', r.total, 'issued_at', r.issued_at,
                                    'payments', (SELECT jsonb_agg(jsonb_build_object('seq', y.seq, 'method', y.method, 'amount', y.amount, 'change', y.change_given) ORDER BY y.seq)
                                                   FROM public.payments y WHERE y.tenant_id = r.tenant_id AND y.receipt_id = r.id)) ORDER BY r.issued_at, r.id)
                            FROM public.receipts r WHERE r.tenant_id = i.tenant_id AND r.invoice_id = i.id), '[]'::jsonb),
    'tenders', (SELECT jsonb_agg(jsonb_build_object('method', m.k, 'available', m.ok, 'blocked', m.why) ORDER BY m.o) FROM (VALUES
        (1, 'cash', public.kasir_method_enabled('cash', v_at), CASE WHEN NOT public.kasir_method_enabled('cash', v_at) THEN 'method_disabled' END),
        (2, 'qris', false, 'payment_port'),
        (3, 'edc', public.kasir_method_enabled('edc', v_at), CASE WHEN NOT public.kasir_method_enabled('edc', v_at) THEN 'method_disabled' END),
        (4, 'transfer', public.kasir_method_enabled('transfer', v_at), CASE WHEN NOT public.kasir_method_enabled('transfer', v_at) THEN 'method_disabled' END),
        (5, 'payment_link', false, 'payment_port'),
        (6, 'balance', false, 'balance')) m(o, k, ok, why)),
    'void', (SELECT jsonb_build_object('approval_id', ap.id, 'state', ap.state, 'requested_at', ap.requested_at,
                                       'reason', CASE WHEN v_mask THEN NULL ELSE ap.request_reason END)
               FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id
              ORDER BY ap.requested_at DESC LIMIT 1));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_invoice_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kasir_invoice_get(uuid) TO clinic_app;--> statement-breakpoint

-- The suggested lines of a visit (the confirmed selection): catalog item, name, integer quantity (a fractional one is
-- rounded up for the cashier to edit), the branch price now. Commercial facts only.
CREATE FUNCTION public.kasir_visit_lines(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  v public.visits;
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND v.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('visit_id', v.id, 'branch_id', v.branch_id, 'closed', v.closed_at IS NOT NULL,
    'patient', public.kasir_patient_json(v.tenant_id, v.patient_id, a.role = 'auditor'),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', cv.item_id, 'name', cv.name, 'kind', si.kind, 'quantity', ceil(si.quantity)::integer,
                                 'price', public.catalog_branch_price(cv.item_id, v.branch_id, clock_timestamp())) ORDER BY si.id)
                         FROM public.selection_items si JOIN public.catalog_versions cv ON cv.tenant_id = si.tenant_id AND cv.id = si.catalog_version_id
                        WHERE si.tenant_id = v.tenant_id AND si.visit_id = v.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_visit_lines(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kasir_visit_lines(uuid) TO clinic_app;--> statement-breakpoint

-- Jual Cepat items (at the branch: a branch role's own, a tenant-wide role names it): sellable products with an active stock item, not on the special list, with the branch price now;
-- optionally filtered by name or code (case-insensitive), at most 50.
CREATE FUNCTION public.kasir_counter_items(p_branch uuid, p_query text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(p_branch);
  v_q text := NULLIF(btrim(coalesce(p_query, '')), '');
BEGIN
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  IF length(v_q) > 80 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: query' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(x.j ORDER BY x.n) FROM (
      SELECT jsonb_build_object('item_id', ci.id, 'code', ci.code, 'name', cv.name, 'tax_category', cv.tax_category,
               'price', public.catalog_branch_price(ci.id, a.branch_id, clock_timestamp())) j, lower(cv.name) n
        FROM public.catalog_items ci JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
       WHERE ci.tenant_id = a.tenant_id AND ci.kind = 'product'
         AND EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = ci.tenant_id AND si.catalog_item_id = ci.id AND si.active)
         AND NOT public.pharmacy_special(ci.tenant_id, ci.id)
         AND (v_q IS NULL OR strpos(lower(cv.name), lower(v_q)) > 0 OR strpos(lower(ci.code), lower(v_q)) > 0)
       ORDER BY lower(cv.name) LIMIT 50) x), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_counter_items(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kasir_counter_items(uuid, text) TO clinic_app;--> statement-breakpoint

-- One receipt (Cetak): its frozen body (the auditor gets the patient's name and MRN masked in it), number, invoice,
-- payments. Not found across branches for the branch roles and across tenants.
CREATE FUNCTION public.receipt_get(p_receipt uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  r public.receipts;
  v_body text;
  pt public.patients;
BEGIN
  SELECT * INTO r FROM public.receipts x WHERE x.tenant_id = a.tenant_id AND x.id = p_receipt;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND r.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: receipt not found' USING ERRCODE = 'P0002';
  END IF;
  v_body := r.body;
  IF a.role = 'auditor' THEN
    SELECT p.* INTO pt FROM public.invoices i JOIN public.patients p ON p.tenant_id = i.tenant_id AND p.id = public.patient_canonical(i.tenant_id, i.patient_id)
     WHERE i.tenant_id = r.tenant_id AND i.id = r.invoice_id;
    IF pt.id IS NOT NULL THEN
      v_body := replace(replace(v_body, pt.full_name, '***'), pt.mrn, '***' || right(pt.mrn, 3));
    END IF;
  END IF;
  RETURN jsonb_build_object('id', r.id, 'number', r.number, 'invoice_id', r.invoice_id, 'total', r.total, 'paper', r.paper, 'body', v_body, 'issued_at', r.issued_at,
    'payments', (SELECT jsonb_agg(jsonb_build_object('seq', y.seq, 'method', y.method, 'amount', y.amount, 'change', y.change_given) ORDER BY y.seq)
                   FROM public.payments y WHERE y.tenant_id = r.tenant_id AND y.receipt_id = r.id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.receipt_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.receipt_get(uuid) TO clinic_app;
