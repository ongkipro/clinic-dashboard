CREATE TABLE "consultation_controls" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"control_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"state" text DEFAULT 'scheduled' NOT NULL,
	"used_visit_id" uuid,
	"used_at" timestamp with time zone,
	"cancel_code" text,
	"scheduled_by" uuid NOT NULL,
	"scheduled_as" text NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"command_key" text NOT NULL,
	CONSTRAINT "consultation_controls_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "consultation_controls_seq_key" UNIQUE("tenant_id","invoice_line_id","seq"),
	CONSTRAINT "consultation_controls_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "consultation_controls_check" CHECK ("consultation_controls"."state" in ('scheduled','used','cancelled') and "consultation_controls"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "consultation_controls"."seq" between 1 and 20
      and "consultation_controls"."valid_until" >= "consultation_controls"."control_date"
      and (("consultation_controls"."state" = 'used') = ("consultation_controls"."used_visit_id" is not null)) and (("consultation_controls"."state" = 'used') = ("consultation_controls"."used_at" is not null))
      and (("consultation_controls"."state" = 'cancelled') = ("consultation_controls"."cancel_code" is not null))
      and ("consultation_controls"."cancel_code" is null or "consultation_controls"."cancel_code" in ('source_refunded'))
      and "consultation_controls"."scheduled_as" in ('owner','manager','fo_cashier','doctor'))
);
--> statement-breakpoint
CREATE TABLE "consultation_fee_purchases" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"fee_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	CONSTRAINT "consultation_fee_purchases_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "consultation_fee_purchases_line_key" UNIQUE("tenant_id","fee_id","invoice_line_id")
);
--> statement-breakpoint
CREATE TABLE "consultation_fees" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"state" text NOT NULL,
	"waiver" text,
	"fee_amount" bigint,
	"fee_line_id" uuid,
	"control_id" uuid,
	"complaint_task_id" uuid,
	"recharge_refund_id" uuid,
	"recharge_package_id" uuid,
	"deducted" bigint,
	"decided_by" uuid NOT NULL,
	"decided_as" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"recharged_at" timestamp with time zone,
	"command_key" text NOT NULL,
	CONSTRAINT "consultation_fees_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "consultation_fees_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "consultation_fees_visit_key" UNIQUE("tenant_id","visit_id"),
	CONSTRAINT "consultation_fees_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "consultation_fees_control_key" UNIQUE("tenant_id","control_id"),
	CONSTRAINT "consultation_fees_complaint_key" UNIQUE("tenant_id","complaint_task_id"),
	CONSTRAINT "consultation_fees_refund_key" UNIQUE("tenant_id","recharge_refund_id"),
	CONSTRAINT "consultation_fees_check" CHECK ("consultation_fees"."state" in ('charged','waived','recharged') and "consultation_fees"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and ("consultation_fees"."waiver" is null or "consultation_fees"."waiver" in ('purchase','package_session','control','complaint'))
      and (("consultation_fees"."state" = 'charged') = ("consultation_fees"."waiver" is null))
      and ("consultation_fees"."state" <> 'charged' or "consultation_fees"."fee_line_id" is not null)
      and ("consultation_fees"."state" <> 'waived' or "consultation_fees"."fee_line_id" is null)
      and (("consultation_fees"."state" = 'charged' or "consultation_fees"."waiver" = 'purchase') = ("consultation_fees"."fee_amount" is not null))
      and ("consultation_fees"."fee_amount" is null or "consultation_fees"."fee_amount" between 1 and 1000000000000)
      and (("consultation_fees"."waiver" = 'control') = ("consultation_fees"."control_id" is not null))
      and (("consultation_fees"."waiver" = 'complaint') = ("consultation_fees"."complaint_task_id" is not null))
      and (("consultation_fees"."state" = 'recharged') = ("consultation_fees"."recharged_at" is not null))
      and ("consultation_fees"."state" <> 'recharged' or ("consultation_fees"."waiver" = 'purchase' and "consultation_fees"."fee_line_id" is not null
           and num_nonnulls("consultation_fees"."recharge_refund_id", "consultation_fees"."recharge_package_id") = 1 and "consultation_fees"."deducted" between 0 and "consultation_fees"."fee_amount"))
      and ("consultation_fees"."state" = 'recharged' or num_nonnulls("consultation_fees"."recharge_refund_id", "consultation_fees"."recharge_package_id", "consultation_fees"."deducted") = 0)
      and "consultation_fees"."decided_as" in ('owner','admin_pusat','manager','fo_cashier','finance'))
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "consultation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "consultation_controls" ADD CONSTRAINT "consultation_controls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_controls" ADD CONSTRAINT "consultation_controls_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_controls" ADD CONSTRAINT "consultation_controls_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_controls" ADD CONSTRAINT "consultation_controls_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_controls" ADD CONSTRAINT "consultation_controls_visit_fk" FOREIGN KEY ("tenant_id","used_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_controls" ADD CONSTRAINT "consultation_controls_by_fk" FOREIGN KEY ("tenant_id","scheduled_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_fee_purchases" ADD CONSTRAINT "consultation_fee_purchases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_fee_purchases" ADD CONSTRAINT "consultation_fee_purchases_fee_fk" FOREIGN KEY ("tenant_id","branch_id","fee_id") REFERENCES "public"."consultation_fees"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_fee_purchases" ADD CONSTRAINT "consultation_fee_purchases_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_fees" ADD CONSTRAINT "consultation_fees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_fees" ADD CONSTRAINT "consultation_fees_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_fees" ADD CONSTRAINT "consultation_fees_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_fees" ADD CONSTRAINT "consultation_fees_line_fk" FOREIGN KEY ("tenant_id","fee_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_fees" ADD CONSTRAINT "consultation_fees_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultation_controls_patient_idx" ON "consultation_controls" USING btree ("tenant_id","patient_id","state");--> statement-breakpoint
CREATE INDEX "consultation_fee_purchases_line_idx" ON "consultation_fee_purchases" USING btree ("tenant_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "consultation_fees_patient_idx" ON "consultation_fees" USING btree ("tenant_id","patient_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_consultation_check" CHECK (not "invoices"."consultation" or ("invoices"."visit_id" is not null and not "invoices"."counter"));--> statement-breakpoint

-- T-079 rules (generated by gen.py; plan docs/tasks/T-079.md)
-- ── T-079 helpers (PR-12, BILL-4/5/21, DATA-34; plan docs/tasks/T-079.md §4, review r1) ──
-- The FKs Drizzle cannot express here: packages and complaint tasks (import cycles), the control used by a waiver, and the
-- refund of a re-charge DEFERRABLE (refund_request settles before it inserts the refunds row; r1 P3-3).
ALTER TABLE public.consultation_fees ADD CONSTRAINT consultation_fees_control_fk FOREIGN KEY (tenant_id, control_id)
  REFERENCES public.consultation_controls (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.consultation_fees ADD CONSTRAINT consultation_fees_complaint_fk FOREIGN KEY (tenant_id, complaint_task_id)
  REFERENCES public.complaint_tasks (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.consultation_fees ADD CONSTRAINT consultation_fees_package_fk FOREIGN KEY (tenant_id, recharge_package_id)
  REFERENCES public.packages (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.consultation_fees ADD CONSTRAINT consultation_fees_refund_fk FOREIGN KEY (tenant_id, recharge_refund_id)
  REFERENCES public.refunds (tenant_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- The fee amount (SET-6) at a moment; null = the rule is not active for the tenant yet (r1 P1-1, plan §7.2).
CREATE FUNCTION public.consultation_fee_amount(p_at timestamptz) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(public.setting_value_at('SET-6', NULL, p_at)) = 'number'
              THEN (public.setting_value_at('SET-6', NULL, p_at) #>> '{}')::bigint END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_fee_amount(timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Whether an item is the tenant's consultation service (an active service version with category consultation).
CREATE FUNCTION public.consultation_item_is(p_tenant uuid, p_item uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.catalog_items ci JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id
                  WHERE ci.tenant_id = p_tenant AND ci.id = p_item AND ci.kind = 'service' AND cv.state = 'active' AND cv.category = 'consultation')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_item_is(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The consultation item: the given one (must be a consultation service) or the first active one by created_at, id (r1 P2-4).
CREATE FUNCTION public.consultation_item(p_tenant uuid, p_item uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  IF p_item IS NOT NULL THEN
    IF NOT public.consultation_item_is(p_tenant, p_item) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: item_id' USING ERRCODE = '22023';
    END IF;
    RETURN p_item;
  END IF;
  SELECT ci.id INTO v FROM public.catalog_items ci JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id
   WHERE ci.tenant_id = p_tenant AND ci.kind = 'service' AND cv.state = 'active' AND cv.category = 'consultation'
   ORDER BY ci.created_at, ci.id LIMIT 1;
  IF v IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: consultation_item' USING ERRCODE = '55000';
  END IF;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_item(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A consultation visit: the doctor step was opened (an examination exists; plan §7.9).
CREATE FUNCTION public.consultation_visit(p_tenant uuid, p_visit uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.examinations e WHERE e.tenant_id = p_tenant AND e.visit_id = p_visit)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_visit(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The visit's live (issued) consultation invoice, if any.
CREATE FUNCTION public.consultation_live_invoice(p_tenant uuid, p_visit uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.id FROM public.invoices i WHERE i.tenant_id = p_tenant AND i.visit_id = p_visit AND i.consultation AND i.state = 'issued'
   ORDER BY i.issued_at LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_live_invoice(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Fully refunded (r1 P2-1): a package line → its package cancelled (not by an invoice void) with no session redeemed; another
-- line → a positive total whose paid refunds, plus an in-flight amount on p_extra_line, reach line_total − cancelled_amount.
CREATE FUNCTION public.consultation_line_refunded(p_tenant uuid, p_line uuid, p_extra_line uuid, p_extra_amount bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.invoice_line_id = p_line)
    THEN EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.invoice_line_id = p_line AND pk.state = 'cancelled'
                   AND pk.close_reason IS DISTINCT FROM 'invoice_void'
                   AND NOT EXISTS (SELECT 1 FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'redeemed'))
    ELSE EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.id = p_line AND l.line_total - l.cancelled_amount > 0
                   AND (SELECT coalesce(sum(r.amount), 0) FROM public.refunds r WHERE r.tenant_id = l.tenant_id AND r.invoice_line_id = l.id AND r.state = 'paid')
                       + CASE WHEN l.id IS NOT DISTINCT FROM p_extra_line THEN coalesce(p_extra_amount, 0) ELSE 0 END
                       >= l.line_total - l.cancelled_amount)
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_line_refunded(uuid, uuid, uuid, bigint) FROM PUBLIC;--> statement-breakpoint

-- The qualifying purchases of a visit (BILL-4; plan §4.1, r1 P1-2): positive lines of its issued non-consultation visit invoices
-- with no substitution line (ordinary and addition invoices), and the lines of paid active packages of its canonical patient issued
-- at its branch while it was open, not already recorded for another visit's fee; each not fully refunded.
CREATE FUNCTION public.consultation_qualifying_lines(v public.visits, p_at timestamptz) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(x.id ORDER BY x.id), '{}') FROM (
    SELECT l.id FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
     WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued' AND NOT i.consultation AND l.line_total > 0
       AND NOT EXISTS (SELECT 1 FROM public.invoice_lines s WHERE s.tenant_id = i.tenant_id AND s.invoice_id = i.id AND s.substitution_id IS NOT NULL)
       AND NOT public.consultation_line_refunded(l.tenant_id, l.id, NULL, NULL)
    UNION
    SELECT l.id FROM public.packages pk JOIN public.invoice_lines l ON l.tenant_id = pk.tenant_id AND l.id = pk.invoice_line_id
      JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
     WHERE pk.tenant_id = v.tenant_id AND pk.state = 'active' AND public.package_paid(pk) > 0 AND i.branch_id = v.branch_id AND i.state = 'issued'
       AND public.patient_canonical(pk.tenant_id, pk.patient_id) = public.patient_canonical(v.tenant_id, v.patient_id)
       AND i.issued_at >= v.checked_in_at AND i.issued_at <= coalesce(v.closed_at, p_at)
       AND NOT EXISTS (SELECT 1 FROM public.consultation_fee_purchases fp JOIN public.consultation_fees f ON f.tenant_id = fp.tenant_id AND f.id = fp.fee_id
                        WHERE fp.tenant_id = l.tenant_id AND fp.invoice_line_id = l.id AND f.visit_id <> v.id)
  ) x
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_qualifying_lines(public.visits, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- The earliest-expiring valid control of the visit's patient (BILL-5; r1 P1-5): scheduled, valid on the visit's branch-local date,
-- its source line on an issued invoice that is not this visit's, not fully refunded.
CREATE FUNCTION public.consultation_valid_control(v public.visits, p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.id FROM public.consultation_controls c
    JOIN public.invoice_lines l ON l.tenant_id = c.tenant_id AND l.id = c.invoice_line_id
    JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
    JOIN public.branches b ON b.tenant_id = v.tenant_id AND b.id = v.branch_id
   WHERE c.tenant_id = v.tenant_id AND c.state = 'scheduled'
     AND public.patient_canonical(c.tenant_id, c.patient_id) = public.patient_canonical(v.tenant_id, v.patient_id)
     AND (p_at AT TIME ZONE b.timezone)::date <= c.valid_until
     AND i.state = 'issued' AND i.visit_id IS DISTINCT FROM v.id
     AND NOT public.consultation_line_refunded(l.tenant_id, l.id, NULL, NULL)
   ORDER BY c.valid_until, c.id LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_valid_control(public.visits, timestamptz) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.consultation_fees ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY consultation_fees_read ON public.consultation_fees FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.balance_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.consultation_fees TO clinic_app;--> statement-breakpoint
CREATE POLICY consultation_fees_operator_read ON public.consultation_fees FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.consultation_fees', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.consultation_fees TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER consultation_fees_no_truncate BEFORE TRUNCATE ON public.consultation_fees FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.consultation_fees ENABLE ALWAYS TRIGGER consultation_fees_no_truncate;--> statement-breakpoint
ALTER TABLE public.consultation_fee_purchases ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY consultation_fee_purchases_read ON public.consultation_fee_purchases FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.balance_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.consultation_fee_purchases TO clinic_app;--> statement-breakpoint
CREATE POLICY consultation_fee_purchases_operator_read ON public.consultation_fee_purchases FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.consultation_fee_purchases', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.consultation_fee_purchases TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER consultation_fee_purchases_no_truncate BEFORE TRUNCATE ON public.consultation_fee_purchases FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.consultation_fee_purchases ENABLE ALWAYS TRIGGER consultation_fee_purchases_no_truncate;--> statement-breakpoint
ALTER TABLE public.consultation_controls ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY consultation_controls_read ON public.consultation_controls FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.balance_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.consultation_controls TO clinic_app;--> statement-breakpoint
CREATE POLICY consultation_controls_operator_read ON public.consultation_controls FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.consultation_controls', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.consultation_controls TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER consultation_controls_no_truncate BEFORE TRUNCATE ON public.consultation_controls FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.consultation_controls ENABLE ALWAYS TRIGGER consultation_controls_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.consultation_fees', 'tenant-shared', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'consultation definers (src/modules/cashier/consultation)', 'the visit''s branch'),
  ('public.consultation_fee_purchases', 'tenant-shared', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'consultation definers (src/modules/cashier/consultation)', 'the visit''s branch'),
  ('public.consultation_controls', 'tenant-shared', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'consultation definers (src/modules/cashier/consultation)', 'any branch of the tenant');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): fees and controls are personal; the frozen purchases are money totals.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.consultation_fees', 'personal'),
  ('public.consultation_fee_purchases', 'money_total'),
  ('public.consultation_controls', 'personal');--> statement-breakpoint

-- ── T-079 guards (each takes the staff_access lock first; never deleted) ──
-- consultation_fees: inserted charged or waived; the one transition waived(purchase) → recharged, once, setting only the
-- re-charge columns (the refund FK is deferred; this guard does not read refunds, r1 P3-3).
CREATE FUNCTION public.consultation_fees_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consultation fees are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('charged','waived') THEN
      RAISE EXCEPTION 'a consultation fee is decided charged or waived' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.patient_id, NEW.waiver, NEW.fee_amount, NEW.control_id, NEW.complaint_task_id,
      NEW.decided_by, NEW.decided_as, NEW.decided_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.patient_id, OLD.waiver, OLD.fee_amount, OLD.control_id, OLD.complaint_task_id,
      OLD.decided_by, OLD.decided_as, OLD.decided_at, OLD.command_key)
     OR NOT (OLD.state = 'waived' AND OLD.waiver = 'purchase' AND NEW.state = 'recharged') THEN
    RAISE EXCEPTION 'a purchase waiver is re-charged once; a fee decision is otherwise frozen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_fees_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER consultation_fees_guard BEFORE INSERT OR UPDATE OR DELETE ON public.consultation_fees FOR EACH ROW EXECUTE FUNCTION public.consultation_fees_guard();--> statement-breakpoint
ALTER TABLE public.consultation_fees ENABLE ALWAYS TRIGGER consultation_fees_guard;--> statement-breakpoint

-- consultation_controls: inserted scheduled; scheduled → used (by a visit) or → cancelled (its source refunded), once.
CREATE FUNCTION public.consultation_controls_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'controls are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'scheduled' THEN
      RAISE EXCEPTION 'a control is scheduled first' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.invoice_line_id, NEW.seq, NEW.control_date, NEW.valid_until,
      NEW.scheduled_by, NEW.scheduled_as, NEW.scheduled_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.invoice_line_id, OLD.seq, OLD.control_date, OLD.valid_until,
      OLD.scheduled_by, OLD.scheduled_as, OLD.scheduled_at, OLD.command_key)
     OR NOT (OLD.state = 'scheduled' AND NEW.state IN ('used','cancelled')) THEN
    RAISE EXCEPTION 'a control is used or cancelled once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_controls_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER consultation_controls_guard BEFORE INSERT OR UPDATE OR DELETE ON public.consultation_controls FOR EACH ROW EXECUTE FUNCTION public.consultation_controls_guard();--> statement-breakpoint
ALTER TABLE public.consultation_controls ENABLE ALWAYS TRIGGER consultation_controls_guard;--> statement-breakpoint

CREATE TRIGGER consultation_fee_purchases_insert_only BEFORE UPDATE OR DELETE ON public.consultation_fee_purchases FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.consultation_fee_purchases ENABLE ALWAYS TRIGGER consultation_fee_purchases_insert_only;--> statement-breakpoint

-- ── T-079 writers (SECURITY DEFINER, actor first = tenant_actor_lock; idempotent by key; events carry ids only) ──
-- A consultation invoice for a visit: a draft with consultation = true, one fee line at p_amount (SET-6 or the frozen waived
-- amount, not the branch price; plan §7.1) on the consultation item's active version (its tax snapshot, A-06; the vat gate as
-- invoice_line_snapshot), issued, InvoiceIssued + ConsultationFeeCharged (exactly once per new consultation line, 11:119).
-- The caller holds the visit lock. Works on a closed visit (the re-charge); invoice_open is not used (it refuses one).
CREATE FUNCTION public.consultation_invoice_issue(v public.visits, p_item uuid, p_amount bigint, p_key text, p_staff uuid, p_role text, p_at timestamptz,
                                                  OUT o_invoice uuid, OUT o_line uuid, OUT o_number text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  cv public.catalog_versions;
  v_pkp boolean := public.tax_pkp_at(v.tenant_id, p_at, v.branch_id);
  v_split record;
BEGIN
  SELECT x.* INTO cv FROM public.catalog_versions x WHERE x.tenant_id = v.tenant_id AND x.item_id = p_item AND x.state = 'active';
  IF cv.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: consultation_item' USING ERRCODE = '55000';
  END IF;
  IF v_pkp AND cv.tax_category IN ('taxable_service','taxable_goods') THEN
    PERFORM public.feature_gate_lock('vat_on_invoices');
    IF NOT public.feature_gate_open('vat_on_invoices') THEN
      RAISE EXCEPTION 'ERR_GATE_CLOSED: vat_on_invoices' USING ERRCODE = '42501';
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.invoices (tenant_id, branch_id, sold_branch_id, patient_id, visit_id, consultation, command_key, created_by, created_as)
    VALUES (v.tenant_id, v.branch_id, v.branch_id, v.patient_id, v.id, true, p_key, p_staff, p_role)
    RETURNING id INTO o_invoice;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an invoice with this key exists' USING ERRCODE = '23505';
  END;
  SELECT * INTO v_split FROM public.tax_vat_split(p_amount, cv.tax_category, v_pkp);
  PERFORM public.catalog_version_reference(cv.id);
  INSERT INTO public.invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, discount, line_total,
                                    tax_category, tax_basis, vat_base, vat_amount)
  VALUES (v.tenant_id, v.branch_id, o_invoice, p_item, cv.id, 1, p_amount, 0, p_amount, cv.tax_category, cv.tax_basis, v_split.base, v_split.vat)
  RETURNING id INTO o_line;
  o_number := public.kasir_next_number(v.tenant_id, v.branch_id, 'INV');
  UPDATE public.invoices SET state = 'issued', issued_at = p_at, issued_by = p_staff, issued_as = p_role, is_pkp_at_issue = v_pkp, number = o_number
   WHERE tenant_id = v.tenant_id AND id = o_invoice;
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v.branch_id, 'InvoiceIssued', 'invoice', o_invoice, jsonb_build_object('invoice_id', o_invoice, 'branch_id', v.branch_id));
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (v.tenant_id, v.branch_id, 'ConsultationFeeCharged', 'visit', v.id, p_staff, p_role,
          jsonb_build_object('visit_id', v.id, 'invoice_id', o_invoice, 'invoice_line_id', o_line));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_invoice_issue(public.visits, uuid, bigint, text, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Tagih Konsultasi (BILL-4, 4a): owner, manager, FO/cashier, finance (kasir_actor; Admin Pusat and the auditor refused, PR-63)
-- charge SET-6 on an open consultation visit with no qualifying purchase and no fee decision. Paid by an ordinary Terima.
CREATE FUNCTION public.consultation_fee_charge(p_key text, p_visit uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  v public.visits;
  i public.invoices;
  v_at timestamptz := clock_timestamp();
  v_amount bigint;
  v_item uuid;
  s record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'item_id' <> '{}'::jsonb
     OR p ? 'item_id' AND coalesce(p ->> 'item_id', '') !~ '^[0-9a-fA-F-]{36}$'
     OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: consultation_fee' USING ERRCODE = '22023';
  END IF;
  -- Replay: the same key returns its invoice.
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF i.id IS NOT NULL THEN
    IF NOT i.consultation OR i.visit_id IS DISTINCT FROM p_visit THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an invoice with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('invoice_id', i.id, 'number', i.number,
                              'invoice_line_id', (SELECT l.id FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id),
                              'amount', (SELECT l.line_total FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id));
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit AND (a.branch_id IS NULL OR x.branch_id = a.branch_id) FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  IF NOT public.consultation_visit(v.tenant_id, v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_a_consultation' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.consultation_fees f WHERE f.tenant_id = v.tenant_id AND f.visit_id = v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: fee_decided' USING ERRCODE = '55000';
  END IF;
  IF public.consultation_live_invoice(v.tenant_id, v.id) IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: fee_already_charged' USING ERRCODE = '55000';
  END IF;
  IF cardinality(public.consultation_qualifying_lines(v, v_at)) > 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: purchase_on_visit' USING ERRCODE = '55000';
  END IF;
  v_amount := public.consultation_fee_amount(v_at);
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: consultation_fee_unset' USING ERRCODE = '55000';
  END IF;
  v_item := public.consultation_item(v.tenant_id, (p ->> 'item_id')::uuid);
  SELECT * INTO s FROM public.consultation_invoice_issue(v, v_item, v_amount, p_key, a.staff_id, a.role, v_at);
  PERFORM public.kasir_visit_payment(v.tenant_id, v.id);
  PERFORM public.audit_append('money_correction', 'consultation_fee', v.id, 'success', 'consultation_fee_charged');
  RETURN jsonb_build_object('invoice_id', s.o_invoice, 'number', s.o_number, 'invoice_line_id', s.o_line, 'amount', v_amount);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_fee_charge(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consultation_fee_charge(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Konsultasi Gratis (BILL-4/5, PR-43): record a control or a kontrol_gratis complaint as the visit's waiver before close.
CREATE FUNCTION public.consultation_fee_exempt(p_key text, p_visit uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  v public.visits;
  f public.consultation_fees;
  c public.consultation_controls;
  b public.branches;
  v_at timestamptz := clock_timestamp();
  v_waiver text := p ->> 'waiver';
  v_id uuid;
  v_task uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(v_waiver, '') NOT IN ('control','complaint')
     OR v_waiver = 'control' AND (p - 'waiver' - 'control_id' <> '{}'::jsonb OR coalesce(p ->> 'control_id', '') !~ '^[0-9a-fA-F-]{36}$')
     OR v_waiver = 'complaint' AND (p - 'waiver' - 'complaint_task_id' <> '{}'::jsonb OR coalesce(p ->> 'complaint_task_id', '') !~ '^[0-9a-fA-F-]{36}$')
     OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: consultation_exempt' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.consultation_fees x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF f.id IS NOT NULL THEN
    IF f.visit_id <> p_visit OR f.waiver IS DISTINCT FROM v_waiver THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a fee decision with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('fee_id', f.id);
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit AND (a.branch_id IS NULL OR x.branch_id = a.branch_id) FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  IF NOT public.consultation_visit(v.tenant_id, v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_a_consultation' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.consultation_fees x WHERE x.tenant_id = v.tenant_id AND x.visit_id = v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: fee_decided' USING ERRCODE = '55000';
  END IF;
  IF public.consultation_live_invoice(v.tenant_id, v.id) IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: fee_already_charged' USING ERRCODE = '55000';
  END IF;
  IF cardinality(public.consultation_qualifying_lines(v, v_at)) > 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: purchase_on_visit' USING ERRCODE = '55000';
  END IF;
  v_id := public.uuid_generate_v7();
  IF v_waiver = 'control' THEN
    SELECT * INTO b FROM public.branches x WHERE x.tenant_id = v.tenant_id AND x.id = v.branch_id;
    SELECT x.* INTO c FROM public.consultation_controls x
      JOIN public.invoice_lines l ON l.tenant_id = x.tenant_id AND l.id = x.invoice_line_id
      JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
     WHERE x.tenant_id = v.tenant_id AND x.id = (p ->> 'control_id')::uuid AND x.state = 'scheduled'
       AND public.patient_canonical(x.tenant_id, x.patient_id) = public.patient_canonical(v.tenant_id, v.patient_id)
       AND (v_at AT TIME ZONE b.timezone)::date <= x.valid_until
       AND i.state = 'issued' AND i.visit_id IS DISTINCT FROM v.id
       AND NOT public.consultation_line_refunded(l.tenant_id, l.id, NULL, NULL)
     FOR UPDATE OF x;
    IF c.id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: control not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.consultation_controls SET state = 'used', used_visit_id = v.id, used_at = v_at WHERE tenant_id = c.tenant_id AND id = c.id;
    INSERT INTO public.consultation_fees (id, tenant_id, branch_id, visit_id, patient_id, state, waiver, control_id, decided_by, decided_as, decided_at, command_key)
    VALUES (v_id, v.tenant_id, v.branch_id, v.id, public.patient_canonical(v.tenant_id, v.patient_id), 'waived', 'control', c.id, a.staff_id, a.role, v_at, p_key);
  ELSE
    SELECT t.id INTO v_task FROM public.complaint_tasks t
     WHERE t.tenant_id = v.tenant_id AND t.id = (p ->> 'complaint_task_id')::uuid AND t.resolution_outcome = 'kontrol_gratis'
       AND public.patient_canonical(t.tenant_id, t.patient_id) = public.patient_canonical(v.tenant_id, v.patient_id);
    IF v_task IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: complaint not found' USING ERRCODE = 'P0002';
    END IF;
    BEGIN
      INSERT INTO public.consultation_fees (id, tenant_id, branch_id, visit_id, patient_id, state, waiver, complaint_task_id, decided_by, decided_as, decided_at, command_key)
      VALUES (v_id, v.tenant_id, v.branch_id, v.id, public.patient_canonical(v.tenant_id, v.patient_id), 'waived', 'complaint', v_task, a.staff_id, a.role, v_at, p_key);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: complaint_used' USING ERRCODE = '55000';
    END;
  END IF;
  PERFORM public.audit_append('money_correction', 'consultation_fee', v_id, 'success', 'consultation_fee_waived');
  RETURN jsonb_build_object('fee_id', v_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_fee_exempt(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consultation_fee_exempt(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Jadwalkan Kontrol (BILL-5): owner, manager, FO/cashier or doctor schedule a free control of a purchased line whose version has
-- control_count > 0; within control_validity_days of the purchase; valid to the date + SET-7 hari (snapshotted). Lock order
-- visit → invoice → line (r1 P2-2); a branch actor only on its branch's invoice.
CREATE FUNCTION public.control_schedule(p_key text, p_line uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.tenant_actor_lock();
  v_branch uuid;
  l public.invoice_lines;
  i public.invoices;
  cv public.catalog_versions;
  b public.branches;
  c public.consultation_controls;
  v_at timestamptz := clock_timestamp();
  v_date date;
  v_today date;
  v_bought date;
  v_days integer;
  v_seq integer;
  v_id uuid;
BEGIN
  -- tenant_actor_lock already requires an active branch of manager, FO/cashier and doctor; the owner acts tenant-wide.
  IF a.role NOT IN ('owner','manager','fo_cashier','doctor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not schedule a control' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the cashier is not available now' USING ERRCODE = '42501';
  END IF;
  v_branch := CASE WHEN a.role = 'owner' THEN NULL ELSE a.branch_id END;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'control_date' <> '{}'::jsonb OR coalesce(p ->> 'control_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
     OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: control' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_date := (p ->> 'control_date')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: control_date' USING ERRCODE = '22023';
  END;
  SELECT * INTO c FROM public.consultation_controls x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF c.id IS NOT NULL THEN
    IF c.invoice_line_id <> p_line OR c.control_date <> v_date THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a control with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('control_id', c.id, 'control_date', c.control_date, 'valid_until', c.valid_until);
  END IF;
  SELECT x.* INTO l FROM public.invoice_lines x WHERE x.tenant_id = a.tenant_id AND x.id = p_line;
  SELECT x.* INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = l.invoice_id;
  IF l.id IS NULL OR v_branch IS NOT NULL AND i.branch_id <> v_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: line not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits x WHERE x.tenant_id = i.tenant_id AND x.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT x.* INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = l.invoice_id FOR UPDATE;
  SELECT x.* INTO l FROM public.invoice_lines x WHERE x.tenant_id = a.tenant_id AND x.id = p_line FOR UPDATE;
  IF i.state <> 'issued' OR i.patient_id IS NULL OR i.consultation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: line_not_eligible' USING ERRCODE = '55000';
  END IF;
  SELECT x.* INTO cv FROM public.catalog_versions x WHERE x.tenant_id = l.tenant_id AND x.id = l.catalog_version_id;
  IF cv.control_count IS NULL OR cv.control_count = 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_control' USING ERRCODE = '55000';
  END IF;
  IF public.consultation_line_refunded(l.tenant_id, l.id, NULL, NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: line_refunded' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) + 1 INTO v_seq FROM public.consultation_controls x WHERE x.tenant_id = l.tenant_id AND x.invoice_line_id = l.id;
  IF (SELECT count(*) FROM public.consultation_controls x WHERE x.tenant_id = l.tenant_id AND x.invoice_line_id = l.id AND x.state <> 'cancelled') >= cv.control_count THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: controls_used' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = i.tenant_id AND x.id = i.branch_id;
  v_today := (v_at AT TIME ZONE b.timezone)::date;
  v_bought := (i.issued_at AT TIME ZONE b.timezone)::date;
  IF v_date < v_today OR v_date > v_bought + cv.control_validity_days THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: control_date' USING ERRCODE = '22023';
  END IF;
  v_days := coalesce((public.setting_value_at('SET-7', NULL, v_at) ->> 'hari')::integer, 7);
  v_id := public.uuid_generate_v7();
  INSERT INTO public.consultation_controls (id, tenant_id, branch_id, patient_id, invoice_line_id, seq, control_date, valid_until, scheduled_by, scheduled_as, scheduled_at, command_key)
  VALUES (v_id, l.tenant_id, i.branch_id, public.patient_canonical(i.tenant_id, i.patient_id), l.id, v_seq, v_date, v_date + v_days, a.staff_id, a.role, v_at, p_key);
  PERFORM public.audit_append('settings_change', 'consultation_control', v_id, 'success', 'control_scheduled');
  RETURN jsonb_build_object('control_id', v_id, 'control_date', v_date, 'valid_until', v_date + v_days);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.control_schedule(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.control_schedule(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── T-079 close decision and re-charge (BILL-4, BILL-21, PR-12; plan §4.3, r1 P1-2/P1-4/P2-4) ──
-- The fee decision at close (visit_close, under its visit lock, after its own checks): a fee row → nothing; a live
-- consultation invoice → charged; no examination or SET-6 unset → nothing; qualifying purchases → waived/purchase with them
-- frozen; a package session on the visit → waived/package_session; a valid control → waived/control (the control used);
-- else refuse consultation_fee_due (17:341 "Consultation fee charged (PR-12) before close").
CREATE FUNCTION public.consultation_fee_on_close(v public.visits, p_staff uuid, p_role text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_at timestamptz := clock_timestamp();
  v_inv uuid;
  v_line public.invoice_lines;
  v_lines uuid[];
  v_amount bigint;
  v_control uuid;
  v_id uuid := public.uuid_generate_v7();
  v_key text := 'visit_close:' || v.id::text;
  v_patient uuid := public.patient_canonical(v.tenant_id, v.patient_id);
BEGIN
  IF EXISTS (SELECT 1 FROM public.consultation_fees f WHERE f.tenant_id = v.tenant_id AND f.visit_id = v.id) THEN
    RETURN;
  END IF;
  v_inv := public.consultation_live_invoice(v.tenant_id, v.id);
  IF v_inv IS NOT NULL THEN
    SELECT * INTO v_line FROM public.invoice_lines l WHERE l.tenant_id = v.tenant_id AND l.invoice_id = v_inv;
    INSERT INTO public.consultation_fees (id, tenant_id, branch_id, visit_id, patient_id, state, fee_amount, fee_line_id, decided_by, decided_as, decided_at, command_key)
    VALUES (v_id, v.tenant_id, v.branch_id, v.id, v_patient, 'charged', v_line.line_total, v_line.id, p_staff, p_role, v_at, v_key);
    RETURN;
  END IF;
  v_amount := public.consultation_fee_amount(v_at);
  IF v_amount IS NULL OR NOT public.consultation_visit(v.tenant_id, v.id) THEN
    RETURN;
  END IF;
  v_lines := public.consultation_qualifying_lines(v, v_at);
  IF cardinality(v_lines) > 0 THEN
    INSERT INTO public.consultation_fees (id, tenant_id, branch_id, visit_id, patient_id, state, waiver, fee_amount, decided_by, decided_as, decided_at, command_key)
    VALUES (v_id, v.tenant_id, v.branch_id, v.id, v_patient, 'waived', 'purchase', v_amount, p_staff, p_role, v_at, v_key);
    INSERT INTO public.consultation_fee_purchases (tenant_id, branch_id, fee_id, invoice_line_id)
    SELECT v.tenant_id, v.branch_id, v_id, x FROM unnest(v_lines) x;
  ELSIF public.package_on_visit(v.tenant_id, v.id) THEN
    INSERT INTO public.consultation_fees (id, tenant_id, branch_id, visit_id, patient_id, state, waiver, decided_by, decided_as, decided_at, command_key)
    VALUES (v_id, v.tenant_id, v.branch_id, v.id, v_patient, 'waived', 'package_session', p_staff, p_role, v_at, v_key);
  ELSE
    v_control := public.consultation_valid_control(v, v_at);
    IF v_control IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: consultation_fee_due' USING ERRCODE = '55000';
    END IF;
    UPDATE public.consultation_controls SET state = 'used', used_visit_id = v.id, used_at = v_at WHERE tenant_id = v.tenant_id AND id = v_control;
    INSERT INTO public.consultation_fees (id, tenant_id, branch_id, visit_id, patient_id, state, waiver, control_id, decided_by, decided_as, decided_at, command_key)
    VALUES (v_id, v.tenant_id, v.branch_id, v.id, v_patient, 'waived', 'control', v_control, p_staff, p_role, v_at, v_key);
  END IF;
  PERFORM public.audit_append('money_correction', 'consultation_fee', v_id, 'success', 'consultation_fee_waived');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_fee_on_close(public.visits, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- The purchase waiver a refund (or a package cancel) of p_line would turn into a re-charge: the fee whose frozen purchases are
-- all fully refunded once p_amount more is refunded on p_line (paid refunds count; the in-flight one is not paid yet).
-- p_amount NULL = a package cancel (the package line reads as refunded only after its package row is cancelled).
CREATE FUNCTION public.consultation_recharge_due(p_tenant uuid, p_line uuid, p_amount bigint) RETURNS public.consultation_fees
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT f.* FROM public.consultation_fees f
   WHERE f.tenant_id = p_tenant AND f.state = 'waived' AND f.waiver = 'purchase'
     AND EXISTS (SELECT 1 FROM public.consultation_fee_purchases fp WHERE fp.tenant_id = f.tenant_id AND fp.fee_id = f.id AND fp.invoice_line_id = p_line)
     AND NOT EXISTS (SELECT 1 FROM public.consultation_fee_purchases fp WHERE fp.tenant_id = f.tenant_id AND fp.fee_id = f.id
                       AND NOT public.consultation_line_refunded(fp.tenant_id, fp.invoice_line_id, p_line, p_amount))
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_recharge_due(uuid, uuid, bigint) FROM PUBLIC;--> statement-breakpoint

-- The re-charge (S4c-J3/J4): a consultation invoice for the (closed) visit at the waived amount frozen at the waiver, issued
-- (ConsultationFeeCharged for the new line), ConsultationFeeRecharged (notification only), then D = least(fee, p_available)
-- paid from the patient balance through kasir_record_payment ('use' entry, PaymentAllocated) when D > 0 (r1 P1-2); the rest
-- stays owed on that invoice (Tagihan Terbuka, r1 P3-1). The caller holds the visit lock. Returns D.
CREATE FUNCTION public.consultation_recharge(f public.consultation_fees, p_kind text, p_source uuid, p_available bigint, p_staff uuid, p_role text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.visits;
  i public.invoices;
  s record;
  v_at timestamptz := clock_timestamp();
  v_d bigint := least(f.fee_amount, greatest(0, coalesce(p_available, 0)));
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = f.tenant_id AND x.id = f.visit_id;
  SELECT * INTO s FROM public.consultation_invoice_issue(v, public.consultation_item(f.tenant_id, NULL), f.fee_amount, 'consult_recharge_inv:' || f.id::text,
                                                         p_staff, p_role, v_at);
  UPDATE public.consultation_fees SET state = 'recharged', fee_line_id = s.o_line, deducted = v_d, recharged_at = v_at,
         recharge_refund_id = CASE WHEN p_kind = 'refund' THEN p_source END, recharge_package_id = CASE WHEN p_kind = 'package' THEN p_source END
   WHERE tenant_id = f.tenant_id AND id = f.id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (f.tenant_id, f.branch_id, 'ConsultationFeeRecharged', 'visit', f.visit_id, p_staff, p_role,
          jsonb_build_object('fee_id', f.id, 'visit_id', f.visit_id) || CASE WHEN p_kind = 'refund' THEN jsonb_build_object('refund_id', p_source)
                                                                            ELSE jsonb_build_object('package_id', p_source) END);
  IF v_d > 0 THEN
    SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = f.tenant_id AND x.id = s.o_invoice;
    PERFORM public.kasir_record_payment(i, 'consult_recharge:' || f.id::text, jsonb_build_array(jsonb_build_object('method', 'balance', 'amount', v_d)),
                                        NULL, p_staff, p_role, v_at);
  END IF;
  PERFORM public.audit_append('money_correction', 'consultation_fee', f.id, 'success', 'consultation_fee_recharged');
  RETURN v_d;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_recharge(public.consultation_fees, text, uuid, bigint, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- A source line fully refunded: its scheduled controls are cancelled (BILL-5 entitlement follows the purchase).
CREATE FUNCTION public.consultation_controls_cancel(p_tenant uuid, p_line uuid, p_extra_amount bigint) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  UPDATE public.consultation_controls c SET state = 'cancelled', cancel_code = 'source_refunded'
   WHERE c.tenant_id = p_tenant AND c.invoice_line_id = p_line AND c.state = 'scheduled'
     AND public.consultation_line_refunded(p_tenant, p_line, p_line, p_extra_amount)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_controls_cancel(uuid, uuid, bigint) FROM PUBLIC;--> statement-breakpoint

-- ── T-079 readers (kasir_reader roles: owner, manager, FO/cashier, finance, auditor masked; Admin Pusat refused, PR-63) ──
-- The visit's consultation fee: status due | charged | waived | recharged | none, the amount, the waiver kind, the consultation
-- invoice, and the valid control that would waive it at close.
CREATE FUNCTION public.consultation_fee_get(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL);
  v public.visits;
  f public.consultation_fees;
  v_at timestamptz := clock_timestamp();
  v_amount bigint;
  v_status text;
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit AND (a.branch_id IS NULL OR x.branch_id = a.branch_id);
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO f FROM public.consultation_fees x WHERE x.tenant_id = v.tenant_id AND x.visit_id = v.id;
  v_amount := public.consultation_fee_amount(v_at);
  v_status := CASE WHEN f.id IS NOT NULL THEN f.state
                   WHEN public.consultation_live_invoice(v.tenant_id, v.id) IS NOT NULL THEN 'charged'
                   WHEN v.closed_at IS NOT NULL OR v_amount IS NULL OR NOT public.consultation_visit(v.tenant_id, v.id) THEN 'none'
                   WHEN cardinality(public.consultation_qualifying_lines(v, v_at)) > 0 OR public.package_on_visit(v.tenant_id, v.id) THEN 'none'
                   ELSE 'due' END;
  RETURN jsonb_build_object('visit_id', v.id, 'status', v_status, 'waiver', f.waiver,
    'amount', coalesce(f.fee_amount, CASE WHEN v_status = 'due' THEN v_amount END), 'deducted', f.deducted,
    'invoice_id', coalesce((SELECT l.invoice_id FROM public.invoice_lines l WHERE l.tenant_id = v.tenant_id AND l.id = f.fee_line_id),
                           public.consultation_live_invoice(v.tenant_id, v.id)),
    'control_id', CASE WHEN v_status = 'due' THEN public.consultation_valid_control(v, v_at) END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultation_fee_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consultation_fee_get(uuid) TO clinic_app;--> statement-breakpoint

-- A patient's controls (no clinical content: the item name, dates and state) and the remaining entitlement per source line.
CREATE FUNCTION public.control_list(p_patient uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL);
  v_patient uuid;
BEGIN
  SELECT public.patient_canonical(p.tenant_id, p.id) INTO v_patient FROM public.patients p WHERE p.tenant_id = a.tenant_id AND p.id = p_patient;
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('patient_id', v_patient,
    'controls', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'invoice_line_id', c.invoice_line_id, 'item', cv.name, 'seq', c.seq,
                                                         'control_date', c.control_date, 'valid_until', c.valid_until, 'state', c.state,
                                                         'used_visit_id', c.used_visit_id, 'branch_id', c.branch_id) ORDER BY c.control_date, c.id)
       FROM public.consultation_controls c JOIN public.invoice_lines l ON l.tenant_id = c.tenant_id AND l.id = c.invoice_line_id
       JOIN public.catalog_versions cv ON cv.tenant_id = l.tenant_id AND cv.id = l.catalog_version_id
      WHERE c.tenant_id = a.tenant_id AND public.patient_canonical(c.tenant_id, c.patient_id) = v_patient), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.control_list(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.control_list(uuid) TO clinic_app;--> statement-breakpoint

-- ── T-079 re-created functions (latest definitions, edits asserted by recreate.py) ──
-- visit_close (re-created from 0089): the consultation fee is decided at close (T-079).
CREATE OR REPLACE FUNCTION public.visit_close(p_visit uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.visit_actor();
  v public.visits;
BEGIN
  SELECT * INTO v FROM public.visits WHERE tenant_id = a.tenant_id AND id = p_visit FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.booking_branch(a.tenant_id, a.staff_id, a.role, v.branch_id);
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_closed' USING ERRCODE = '55000';
  END IF;
  IF public.addition_unbilled_counted(v.tenant_id, v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: unbilled_addition' USING ERRCODE = '55000';
  END IF;
  IF v.payment IN ('in_progress','blocked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: unpaid_bill' USING ERRCODE = '55000';
  END IF;
  IF v.dispensing IN ('in_progress','blocked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: pending_dispensing' USING ERRCODE = '55000';
  END IF;
  IF v.treatment IN ('in_progress','blocked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: pending_treatment' USING ERRCODE = '55000';
  END IF;
  -- T-079 (PR-12, 17:341): the consultation fee is decided before the visit closes (may refuse consultation_fee_due).
  PERFORM public.consultation_fee_on_close(v, a.staff_id, a.role);
  IF v.appointment_id IS NOT NULL THEN
    UPDATE public.resource_reservations SET active = false
     WHERE tenant_id = v.tenant_id AND branch_id = v.branch_id AND appointment_id = v.appointment_id AND active;
  END IF;
  UPDATE public.visits SET closed_at = clock_timestamp(), closed_by = a.staff_id WHERE tenant_id = v.tenant_id AND id = v.id
  RETURNING * INTO v;
  UPDATE public.queue_tickets SET state = 'done' WHERE tenant_id = v.tenant_id AND visit_id = v.id AND state <> 'done'; -- T-048
  PERFORM public.visit_changed(v, 'VisitClosed', 'visit_closed');
END
$$;--> statement-breakpoint

-- refund_settle (re-created from 0094): a refund that takes the last qualifying purchase re-charges the waived consultation fee first (T-079).
DROP FUNCTION public.refund_settle(public.refunds, uuid, text, text);--> statement-breakpoint
CREATE FUNCTION public.refund_settle(r public.refunds, p_staff uuid, p_role text, p_method text,
                                     OUT o_vat bigint, OUT o_credit uuid, OUT o_cash uuid, OUT o_deducted bigint)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  i public.invoices;
  v_vat bigint;
  dl record;
  v_left integer;
  v_q numeric;
  v_disp uuid;
  v_fee public.consultation_fees;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = r.tenant_id AND x.id = r.invoice_id;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = r.tenant_id AND x.id = r.invoice_line_id FOR UPDATE;
  v_vat := least(l.vat_recognised_amount - l.vat_reversed_amount, CASE WHEN l.line_total = 0 THEN 0 ELSE (l.vat_recognised_amount * r.amount) / l.line_total END);
  UPDATE public.invoice_lines SET moved_to_balance = moved_to_balance + r.amount,
         vat_reversed_amount = vat_reversed_amount + v_vat,
         vat_reversed_at = CASE WHEN vat_reversed_amount + v_vat > 0 THEN coalesce(vat_reversed_at, clock_timestamp()) END
   WHERE tenant_id = l.tenant_id AND id = l.id;
  o_vat := v_vat;
  o_credit := public.balance_post(r.tenant_id, r.patient_id, r.branch_id, 'from_refund', r.amount,
                                  jsonb_build_object('source_kind', 'refund', 'source_id', r.id), 'refund:' || r.id::text, p_staff, p_role);
  -- T-079 (PR-12, BILL-21, 4c): the last qualifying purchase refunded re-charges the waived fee from this refund, paid from the
  -- balance before any cash leaves; the source's controls are cancelled. A cash refund pays out the rest.
  o_deducted := 0;
  PERFORM public.consultation_controls_cancel(r.tenant_id, l.id, r.amount);
    v_fee := public.consultation_recharge_due(r.tenant_id, l.id, r.amount);
  IF v_fee.id IS NOT NULL THEN
    o_deducted := public.consultation_recharge(v_fee, 'refund', r.id, r.amount, p_staff, p_role);
  END IF;
  IF r.destination = 'cash' AND r.amount - o_deducted > 0 THEN
    o_cash := public.balance_post(r.tenant_id, r.patient_id, r.branch_id, 'cash_refund', -(r.amount - o_deducted),
                                  jsonb_build_object('source_kind', 'refund', 'source_id', r.id), 'cash_refund:' || r.id::text, p_staff, p_role);
  END IF;
  -- The returned product (scenario 15 J2): back to its dispensed batches and depot, newest batch last.
  IF r.returned_quantity IS NOT NULL THEN
    v_left := r.returned_quantity;
    FOR dl IN SELECT d.id AS disp, d.depot_id, x.batch_id, x.quantity FROM public.dispensings d JOIN public.dispensing_lines x ON x.tenant_id = d.tenant_id AND x.dispensing_id = d.id
               WHERE d.tenant_id = r.tenant_id AND d.state = 'handed'
                 AND (d.invoice_line_id = l.id OR i.visit_id IS NOT NULL AND d.visit_id = i.visit_id
                      AND EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = d.tenant_id AND si.id = d.stock_item_id AND si.catalog_item_id = l.item_id))
               ORDER BY d.handed_at, x.id LOOP
      EXIT WHEN v_left <= 0;
      v_q := least(v_left, dl.quantity);
      PERFORM public.stock_move_depot(r.tenant_id, dl.batch_id, dl.depot_id, 'return', v_q, NULL, 'refund', r.id, p_staff, p_role, NULL);
      v_left := v_left - v_q::integer;
      v_disp := dl.disp;
    END LOOP;
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (r.tenant_id, r.branch_id, 'ProductReturned', 'refund', r.id, p_staff, p_role, jsonb_build_object('refund_id', r.id, 'dispensing_id', v_disp));
  END IF;
  IF NOT r.delivered THEN
    UPDATE public.dispensings d SET state = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = p_staff, cancel_reason = 'Dikembalikan ke pasien'
     WHERE d.tenant_id = r.tenant_id AND d.invoice_line_id = l.id AND d.state IN ('queued','prepared');
    IF i.visit_id IS NOT NULL THEN
      PERFORM public.pharmacy_visit_steps(i.tenant_id, i.visit_id);
    END IF;
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (r.tenant_id, r.branch_id, 'RefundPaid', 'refund', r.id, p_staff, p_role,
          jsonb_build_object('refund_id', r.id, 'destination', r.destination) || CASE WHEN p_method IS NOT NULL THEN jsonb_build_object('method', p_method) ELSE '{}'::jsonb END);
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_settle(public.refunds, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- refund_request (re-created from 0094): no refund of a consultation line; an absorbed cash refund refused or failed; fee_deducted (T-079).
CREATE OR REPLACE FUNCTION public.refund_request(p_key text, p_line uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  l public.invoice_lines;
  i public.invoices;
  r public.refunds;
  v_dest text;
  v_amount bigint;
  v_room bigint;
  v_id uuid := public.uuid_generate_v7();
  v_approval uuid;
  v_delivered boolean;
  v_qty integer;
  v_handed numeric;
  s record;
  v_fee public.consultation_fees;
  c public.refunds;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'amount' - 'destination' - 'reason' - 'returned_quantity' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^[1-9]\d{0,12}$'
     OR coalesce(p ->> 'destination', 'balance') NOT IN ('balance','cash') OR length(btrim(coalesce(p ->> 'reason', ''))) NOT BETWEEN 3 AND 500
     OR p ? 'returned_quantity' AND (jsonb_typeof(p -> 'returned_quantity') IS DISTINCT FROM 'number' OR (p ->> 'returned_quantity') !~ '^[1-9]\d{0,4}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refund' USING ERRCODE = '22023';
  END IF;
  v_dest := coalesce(p ->> 'destination', 'balance');
  v_amount := (p ->> 'amount')::bigint;
  v_qty := (p ->> 'returned_quantity')::integer;
  -- Replay: the same key returns its refund.
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF r.id IS NOT NULL THEN
    IF r.invoice_line_id <> p_line OR r.amount <> v_amount OR r.destination <> v_dest THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a refund with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('refund_id', r.id, 'state', r.state, 'approval_id', r.approval_id,
                              'fee_deducted', coalesce((SELECT f.deducted FROM public.consultation_fees f WHERE f.tenant_id = r.tenant_id AND f.recharge_refund_id = r.id), 0));
  END IF;
  SELECT x.* INTO l FROM public.invoice_lines x WHERE x.tenant_id = a.tenant_id AND x.id = p_line;
  SELECT x.* INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = l.invoice_id;
  IF l.id IS NULL OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: line not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT x.* INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = l.invoice_id FOR UPDATE;
  SELECT x.* INTO l FROM public.invoice_lines x WHERE x.tenant_id = a.tenant_id AND x.id = p_line FOR UPDATE;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF i.patient_id IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_without_patient' USING ERRCODE = '55000';
  END IF;
  IF i.consultation THEN -- T-079 (r1 P1-3): a consultation fee is never refunded
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: consultation_line' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: package_line' USING ERRCODE = '55000';
  END IF;
  -- Before line_unpaid: a converted remainder is never paid on the line, so that check would always answer first.
  IF l.receivable_amount > 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: line_on_receivable' USING ERRCODE = '55000';
  END IF;
  IF l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: line_unpaid' USING ERRCODE = '55000';
  END IF;
  -- T-079 (r1 P2-3): a pending cash refund on this line that, with this balance refund, would complete the full refund and
  -- be absorbed whole by the re-charge is failed, releasing its room (else it stays approved and refund_pay refuses it).
  IF v_dest = 'balance' THEN
    FOR c IN SELECT x.* FROM public.refunds x WHERE x.tenant_id = l.tenant_id AND x.invoice_line_id = l.id AND x.destination = 'cash'
               AND x.state IN ('requested','approved') ORDER BY x.id FOR UPDATE LOOP
      v_fee := public.consultation_recharge_due(c.tenant_id, l.id, v_amount + c.amount);
      IF v_fee.id IS NOT NULL AND v_fee.fee_amount >= c.amount THEN
        UPDATE public.refunds SET state = 'failed', failure_code = 'absorbed_by_fee' WHERE tenant_id = c.tenant_id AND id = c.id;
        PERFORM public.audit_append('money_correction', 'refund', c.id, 'success', 'refund_absorbed_by_fee');
      END IF;
    END LOOP;
  END IF;
  v_room := public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(l.tenant_id, l.id);
  IF v_amount > v_room THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: refund_above_paid' USING ERRCODE = '55000';
  END IF;
  IF v_dest = 'cash' THEN -- T-079 (plan §7.5): a cash refund the re-charge would absorb whole is a refund to balance
    v_fee := public.consultation_recharge_due(l.tenant_id, l.id, v_amount);
    IF v_fee.id IS NOT NULL AND v_fee.fee_amount >= v_amount THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: refund_absorbed_by_fee' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_dest = 'cash' AND a.role = 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an owner refunds to balance; a cash refund is requested by staff' USING ERRCODE = '42501';
  END IF;
  v_delivered := public.refund_line_delivered(l, i);
  IF v_qty IS NOT NULL THEN
    v_handed := (SELECT coalesce(sum(x.quantity), 0) FROM public.dispensings d JOIN public.dispensing_lines x ON x.tenant_id = d.tenant_id AND x.dispensing_id = d.id
                  WHERE d.tenant_id = l.tenant_id AND d.state = 'handed'
                    AND (d.invoice_line_id = l.id OR i.visit_id IS NOT NULL AND d.visit_id = i.visit_id
                         AND EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = d.tenant_id AND si.id = d.stock_item_id AND si.catalog_item_id = l.item_id)))
                - (SELECT coalesce(sum(y.returned_quantity), 0) FROM public.refunds y WHERE y.tenant_id = l.tenant_id AND y.invoice_line_id = l.id
                    AND y.state IN ('requested','approved','paid'));
    IF NOT v_delivered OR v_qty > v_handed THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: returned_quantity' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_dest = 'cash' THEN
    v_approval := public.approval_request('refund_exception', 'refund', v_id, btrim(p ->> 'reason'), i.branch_id, v_amount);
  END IF;
  r := ROW(v_id, a.tenant_id, i.branch_id, public.patient_canonical(i.tenant_id, i.patient_id), i.id, l.id, v_amount, v_dest, 'requested', v_delivered, 0, v_qty,
           btrim(p ->> 'reason'), v_approval, NULL, NULL, NULL, NULL, NULL, a.staff_id, a.role, clock_timestamp(), NULL, NULL, NULL, p_key, NULL)::public.refunds;
  IF v_dest = 'balance' THEN
    SELECT * INTO s FROM public.refund_settle(r, a.staff_id, a.role, NULL);
  ELSE
    SELECT 0::bigint AS o_vat, NULL::uuid AS o_credit, NULL::uuid AS o_cash, 0::bigint AS o_deducted INTO s;
  END IF;
  INSERT INTO public.refunds (id, tenant_id, branch_id, patient_id, invoice_id, invoice_line_id, amount, destination, state, delivered, vat_reversed, returned_quantity,
                              reason, approval_id, balance_entry_id, paid_by, paid_as, paid_at, requested_by, requested_as, command_key)
  VALUES (v_id, a.tenant_id, i.branch_id, r.patient_id, i.id, l.id, v_amount, v_dest, CASE WHEN v_dest = 'balance' THEN 'paid' ELSE 'requested' END,
          v_delivered, coalesce(s.o_vat, 0), v_qty, btrim(p ->> 'reason'), v_approval, s.o_credit,
          CASE WHEN v_dest = 'balance' THEN a.staff_id END, CASE WHEN v_dest = 'balance' THEN a.role END, CASE WHEN v_dest = 'balance' THEN clock_timestamp() END,
          a.staff_id, a.role, p_key);
  PERFORM public.audit_append('money_correction', 'refund', v_id, 'success', CASE WHEN v_dest = 'balance' THEN 'refund_to_balance' ELSE 'refund_cash_requested' END);
  RETURN jsonb_build_object('refund_id', v_id, 'state', CASE WHEN v_dest = 'balance' THEN 'paid' ELSE 'requested' END, 'approval_id', v_approval,
                            'fee_deducted', coalesce(s.o_deducted, 0));
END
$$;--> statement-breakpoint

-- refund_pay (re-created from 0094): the absorbed-cash re-check and fee_deducted (T-079).
CREATE OR REPLACE FUNCTION public.refund_pay(p_key text, p_refund uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  r public.refunds;
  i public.invoices;
  s record;
  v_fee public.consultation_fees;
  l public.invoice_lines;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'method' - 'details' <> '{}'::jsonb OR coalesce(p ->> 'method', '') NOT IN ('cash','transfer')
     OR p ? 'details' AND (p ->> 'method' <> 'transfer' OR jsonb_typeof(p -> 'details') IS DISTINCT FROM 'object'
                           OR (p -> 'details') - 'bank' - 'reference' <> '{}'::jsonb
                           OR EXISTS (SELECT 1 FROM jsonb_each(p -> 'details') x WHERE jsonb_typeof(x.value) <> 'string' OR length(x.value #>> '{}') NOT BETWEEN 1 AND 60))
     OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refund_pay' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = a.tenant_id AND x.id = p_refund;
  IF r.id IS NULL OR a.branch_id IS NOT NULL AND r.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: refund not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.state = 'paid' AND r.pay_key = p_key THEN
    RETURN jsonb_build_object('refund_id', r.id, 'state', r.state,
                              'fee_deducted', coalesce((SELECT f.deducted FROM public.consultation_fees f WHERE f.tenant_id = r.tenant_id AND f.recharge_refund_id = r.id), 0));
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = r.tenant_id AND x.id = r.invoice_id;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = a.tenant_id AND x.id = p_refund FOR UPDATE;
  IF r.state <> 'approved' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: refund %', r.state USING ERRCODE = '55000';
  END IF;
  -- T-079 (plan §7.5): a sibling refund to balance may since have made this one absorb the whole re-charge.
  v_fee := public.consultation_recharge_due(r.tenant_id, r.invoice_line_id, r.amount);
  IF v_fee.id IS NOT NULL AND v_fee.fee_amount >= r.amount THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: refund_absorbed_by_fee' USING ERRCODE = '55000';
  END IF;
  IF NOT public.kasir_method_enabled(p ->> 'method', clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO s FROM public.refund_settle(r, a.staff_id, a.role, p ->> 'method');
  UPDATE public.refunds SET state = 'paid', vat_reversed = s.o_vat, balance_entry_id = s.o_credit, cash_entry_id = s.o_cash, paid_method = p ->> 'method',
         paid_details = p -> 'details', paid_by = a.staff_id, paid_as = a.role, paid_at = clock_timestamp(), pay_key = p_key
   WHERE tenant_id = r.tenant_id AND id = r.id;
  PERFORM public.audit_append('money_correction', 'refund', r.id, 'success', 'refund_cash_paid');
  RETURN jsonb_build_object('refund_id', r.id, 'state', 'paid', 'fee_deducted', coalesce(s.o_deducted, 0));
END
$$;--> statement-breakpoint

-- package_close_do (re-created from 0094): a cancelled unredeemed package re-charges the waived consultation fee (T-079).
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
BEGIN
  IF EXISTS (SELECT 1 FROM public.package_sessions s JOIN public.treatment_executions e ON e.tenant_id = s.tenant_id AND e.id = s.reserved_execution_id
              WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'reserved' AND e.state IN ('started','paused')) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: session_in_treatment' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = pk.tenant_id AND x.id = pk.invoice_line_id FOR UPDATE;
  PERFORM 1 FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id ORDER BY x.seq FOR UPDATE;
  PERFORM public.package_sync_vat(pk.tenant_id, pk.id, p_at);
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
    v_sub_paid := v_sub_paid + v_sub_move;
  END LOOP;
  UPDATE public.package_sessions SET state = 'closed', reserved_visit_id = NULL, reserved_execution_id = NULL, version = version + 1
   WHERE tenant_id = pk.tenant_id AND package_id = pk.id AND state IN ('available','reserved');
  IF v_remainder > 0 THEN
    UPDATE public.invoice_lines SET cancelled_amount = v_remainder WHERE tenant_id = l.tenant_id AND id = l.id;
  END IF;
  UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = pk.tenant_id AND invoice_id = pk.invoice_id AND state = 'pending';
  UPDATE public.packages SET state = p_state, closed_at = p_at, closed_by = p_staff, closed_as = p_role, close_reason = p_reason,
         paid_unused_moved = v_unused + v_sub_paid, remainder_cancelled = v_remainder,
         vat_reversed_amount = greatest(vat_reversed_amount, l.vat_recognised_amount - v_redeemed_vat),
         vat_reversed_at = CASE WHEN greatest(vat_reversed_amount, l.vat_recognised_amount - v_redeemed_vat) > 0 THEN coalesce(vat_reversed_at, p_at) END
   WHERE tenant_id = pk.tenant_id AND id = pk.id;
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

-- package_cancel (re-created from 0091): the fee visit is locked before the package (T-079).
CREATE OR REPLACE FUNCTION public.package_cancel(p_package uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['owner','manager']);
  pk public.packages;
  r jsonb;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  -- T-079 (plan §7.3): the lock order is visit → package; a package bought on a consultation visit locks that visit first.
  PERFORM 1 FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.id = (
    SELECT f.visit_id FROM public.consultation_fee_purchases fp JOIN public.consultation_fees f ON f.tenant_id = fp.tenant_id AND f.id = fp.fee_id
      JOIN public.packages x ON x.tenant_id = fp.tenant_id AND x.invoice_line_id = fp.invoice_line_id
     WHERE fp.tenant_id = a.tenant_id AND x.id = p_package LIMIT 1) FOR UPDATE;
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = a.tenant_id AND x.id = p_package FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package not found' USING ERRCODE = 'P0002';
  END IF;
  IF pk.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: package_closed' USING ERRCODE = '55000';
  END IF;
  r := public.package_close_do(pk, 'cancelled', btrim(p_reason), a.staff_id, a.role, clock_timestamp());
  PERFORM public.audit_append('money_correction', 'package', pk.id, 'success', 'package_cancelled'); -- the reason stays on the package
  RETURN r;
END
$$;--> statement-breakpoint

-- invoice_is_ordinary (re-created from 0091): a consultation invoice is never ordinary (T-079).
CREATE OR REPLACE FUNCTION public.invoice_is_ordinary(p_tenant uuid, p_invoice uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_invoice
                       AND (l.plan_item_id IS NOT NULL OR l.substitution_id IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.invoice_id = p_invoice)
     AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = p_tenant AND i.id = p_invoice AND i.consultation)
$$;--> statement-breakpoint

-- invoices_guard (re-created from 0087): the consultation flag is frozen (T-079).
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
    IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.sold_branch_id, NEW.patient_id, NEW.visit_id, NEW.counter, NEW.consultation, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.sold_branch_id, OLD.patient_id, OLD.visit_id, OLD.counter, OLD.consultation, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at)
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

-- invoice_issue (re-created from 0093): a consultation invoice and (with SET-6 set) the consultation item stay out of ordinary issue (T-079).
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
  v_addition boolean;
  t public.plan_items;
  v_package boolean;
  v_subst boolean;
  u public.package_substitutions;
  dep public.booking_deposits;
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
  IF i.consultation THEN -- T-079: a consultation invoice is issued only by the consultation definers
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: consultation_invoice' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'lines' <> '{}'::jsonb OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p -> 'lines') NOT BETWEEN 1 AND 100
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'item_id' - 'quantity' - 'discount' - 'plan_item_id' - 'substitution_id' <> '{}'::jsonb
                  OR x ? 'substitution_id' AND coalesce(x ->> 'substitution_id', '') !~ '^[0-9a-fA-F-]{36}$'
                  OR x ? 'plan_item_id' AND coalesce(x ->> 'plan_item_id', '') !~ '^[0-9a-fA-F-]{36}$'
                  OR jsonb_typeof(x -> 'quantity') IS DISTINCT FROM 'number' OR (x ->> 'quantity') !~ '^\d{1,5}$'
                  OR x ? 'discount' AND (jsonb_typeof(x -> 'discount') IS DISTINCT FROM 'number' OR (x ->> 'discount') !~ '^\d{1,13}$')
                  OR coalesce(x ->> 'item_id', '') !~ '^[0-9a-fA-F-]{36}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  -- T-074 (PR-15, P1-3): an addition invoice has only addition lines (each naming its plan item), on a visit invoice.
  v_addition := EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE x ? 'plan_item_id');
  IF v_addition AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE NOT x ? 'plan_item_id') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: mixed_addition_lines' USING ERRCODE = '22023';
  END IF;
  IF v_addition AND i.visit_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: addition_on_visit_only' USING ERRCODE = '22023';
  END IF;
  IF v_addition AND (SELECT count(DISTINCT x ->> 'plan_item_id') FROM jsonb_array_elements(p -> 'lines') x) <> jsonb_array_length(p -> 'lines') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: an addition is billed once' USING ERRCODE = '22023';
  END IF;
  -- T-076 (PR-20, r1 F6, r2 F3): a package invoice is one package line (quantity 1) for the patient with no visit and no
  -- counter; a substitution invoice is one difference line; neither mixes with other lines.
  v_package := EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x JOIN public.catalog_items ci ON ci.tenant_id = i.tenant_id AND ci.id::text = x ->> 'item_id'
                        WHERE ci.kind = 'package');
  v_subst := EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE x ? 'substitution_id');
  IF (v_package OR v_subst) AND (jsonb_array_length(p -> 'lines') <> 1 OR v_addition OR v_package AND v_subst)
     OR v_package AND (i.visit_id IS NOT NULL OR i.counter OR i.patient_id IS NULL OR (p -> 'lines' -> 0 ->> 'quantity')::integer <> 1)
     OR v_subst AND (i.counter OR i.patient_id IS NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: package_invoice' USING ERRCODE = '22023';
  END IF;
  IF v_subst THEN
    SELECT * INTO u FROM public.package_substitutions x WHERE x.tenant_id = i.tenant_id AND x.id = (p -> 'lines' -> 0 ->> 'substitution_id')::uuid FOR UPDATE;
    IF u.id IS NULL OR u.state <> 'approved' OR u.difference <= 0
       OR NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = u.tenant_id AND pk.id = u.package_id AND pk.state = 'active'
                        AND public.patient_canonical(pk.tenant_id, pk.patient_id) = public.patient_canonical(i.tenant_id, i.patient_id))
       OR EXISTS (SELECT 1 FROM public.invoice_lines il JOIN public.invoices x ON x.tenant_id = il.tenant_id AND x.id = il.invoice_id
                   WHERE il.tenant_id = u.tenant_id AND il.substitution_id = u.id AND x.state = 'issued') THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: substitution not found' USING ERRCODE = 'P0002';
    END IF;
    IF (p -> 'lines' -> 0 ->> 'item_id')::uuid IS DISTINCT FROM u.new_service_item_id OR p -> 'lines' -> 0 ? 'discount' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: substitution_line' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF i.visit_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id AND v.closed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
    END IF;
    IF NOT v_addition AND NOT v_subst AND EXISTS (SELECT 1 FROM public.invoices x WHERE x.tenant_id = i.tenant_id AND x.visit_id = i.visit_id AND x.state = 'issued'
                                   AND public.invoice_is_ordinary(x.tenant_id, x.id)) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_already_invoiced' USING ERRCODE = '55000';
    END IF;
  END IF;
  -- Each addition line: an approved addition of this visit (not removed, not in the selection), the same catalog item
  -- and quantity as its plan item, not already on an issued invoice (under the visit lock).
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x WHERE v_addition LOOP
    SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = i.tenant_id AND x.id = (v_l ->> 'plan_item_id')::uuid;
    IF t.id IS NULL OR NOT public.addition_of_visit(i.tenant_id, i.visit_id, t.id) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: addition not found' USING ERRCODE = 'P0002';
    END IF;
    IF (v_l ->> 'item_id')::uuid IS DISTINCT FROM (SELECT cv.item_id FROM public.catalog_versions cv WHERE cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id)
       OR (v_l ->> 'quantity')::integer <> t.qty THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: addition_item_or_quantity' USING ERRCODE = '22023';
    END IF;
    IF (public.addition_line(i.tenant_id, i.visit_id, t.id)).id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: addition_already_invoiced' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- T-079 (r1 P1-1): while the fee rule is active (SET-6 set) the consultation item has one path, the consultation definers.
  IF public.consultation_fee_amount(v_at) IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE public.consultation_item_is(i.tenant_id, (x ->> 'item_id')::uuid)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: consultation_item' USING ERRCODE = '22023';
  END IF;
  IF i.counter AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x
                             LEFT JOIN public.catalog_items ci ON ci.tenant_id = i.tenant_id AND ci.id = (x ->> 'item_id')::uuid
                            WHERE ci.kind IS DISTINCT FROM 'product') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: counter_products_only' USING ERRCODE = '22023';
  END IF;
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x LOOP
    PERFORM public.invoice_line_snapshot(i, (v_l ->> 'item_id')::uuid, (v_l ->> 'quantity')::integer, coalesce((v_l ->> 'discount')::bigint, 0), v_at,
                                       (v_l ->> 'plan_item_id')::uuid, (v_l ->> 'substitution_id')::uuid);
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
  IF v_package THEN
    PERFORM public.package_open(i, a.staff_id, a.role, v_at);
  END IF;
  -- T-077 (scenario 6e): an ordinary visit invoice receives the held DP of the visit's appointment on its booked item's line.
  IF i.visit_id IS NOT NULL AND NOT v_addition AND NOT v_subst THEN
    SELECT dd.* INTO dep FROM public.booking_deposits dd JOIN public.visits vv ON vv.tenant_id = dd.tenant_id AND vv.appointment_id = dd.appointment_id
     WHERE dd.tenant_id = i.tenant_id AND vv.id = i.visit_id AND dd.state = 'held' FOR UPDATE OF dd;
    IF dep.id IS NOT NULL THEN
      SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = i.tenant_id AND x.id = i.id;
      PERFORM public.deposit_apply_do(i, dep, a.staff_id, a.role);
    END IF;
  END IF;
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceIssued', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'branch_id', i.branch_id));
  PERFORM public.audit_append('settings_change', 'invoice', i.id, 'success', 'invoice_issued');
  RETURN jsonb_build_object('invoice_id', i.id, 'issued_at', v_at, 'is_pkp_at_issue', v_pkp, 'number', v_number,
    'total', (SELECT sum(x.line_total) FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id));
END
$$;--> statement-breakpoint

-- kasir_queue (re-created from 0087): adds consultation_due (T-079).
CREATE OR REPLACE FUNCTION public.kasir_queue(p_branch uuid) RETURNS jsonb
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
    -- T-079 (r1 P1-1): consultation visits that owe the fee (the "Pasien Tidak Membeli" route, 17:341), only with SET-6 set.
    'consultation_due', coalesce((SELECT jsonb_agg(x.j ORDER BY x.t) FROM (
        SELECT jsonb_build_object('visit_id', v.id, 'checked_in_at', v.checked_in_at, 'patient', public.kasir_patient_json(v.tenant_id, v.patient_id, v_mask),
                 'amount', public.consultation_fee_amount(clock_timestamp())) j, v.checked_in_at t
          FROM public.visits v
         WHERE v.tenant_id = a.tenant_id AND v.branch_id = a.branch_id AND v.closed_at IS NULL AND public.consultation_fee_amount(clock_timestamp()) IS NOT NULL
           AND public.consultation_visit(v.tenant_id, v.id)
           AND NOT EXISTS (SELECT 1 FROM public.consultation_fees f WHERE f.tenant_id = v.tenant_id AND f.visit_id = v.id)
           AND public.consultation_live_invoice(v.tenant_id, v.id) IS NULL
           AND cardinality(public.consultation_qualifying_lines(v, clock_timestamp())) = 0 AND NOT public.package_on_visit(v.tenant_id, v.id)
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

-- kasir_invoice_row (re-created from 0087): names a consultation invoice (T-079).
CREATE OR REPLACE FUNCTION public.kasir_invoice_row(i public.invoices, p_mask boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', i.id, 'number', i.number, 'state', i.state, 'counter', i.counter, 'consultation', i.consultation, 'visit_id', i.visit_id, 'issued_at', i.issued_at,
    'patient', public.kasir_patient_json(i.tenant_id, i.patient_id, p_mask),
    'total', (SELECT coalesce(sum(l.line_total), 0) FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id),
    'outstanding', public.kasir_outstanding(i.tenant_id, i.id),
    'void_pending', EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id AND ap.state = 'pending'))
$$;--> statement-breakpoint

-- refund_line_delivered (re-created from 0094): a consultation line is delivered (T-079).
CREATE OR REPLACE FUNCTION public.refund_line_delivered(l public.invoice_lines, i public.invoices) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.consultation -- T-079 (r1 P1-3): the consultation has been performed (11:119)
      OR EXISTS (SELECT 1 FROM public.dispensings d WHERE d.tenant_id = l.tenant_id AND d.invoice_line_id = l.id AND d.state = 'handed')
      OR i.visit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.dispensings d JOIN public.stock_items si ON si.tenant_id = d.tenant_id AND si.id = d.stock_item_id
                                             WHERE d.tenant_id = l.tenant_id AND d.visit_id = i.visit_id AND d.state = 'handed' AND si.catalog_item_id = l.item_id)
      OR i.visit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.treatment_executions e JOIN public.plan_items t ON t.tenant_id = e.tenant_id AND t.id = e.plan_item_id
                                             WHERE e.tenant_id = l.tenant_id AND e.visit_id = i.visit_id AND e.state = 'finished' AND e.counted
                                               AND (t.id = l.plan_item_id OR public.package_plan_service(t.tenant_id, t.id) = l.item_id))
$$;--> statement-breakpoint

-- refunds_guard (re-created from 0094): a consultation line is never refunded (T-079).
CREATE OR REPLACE FUNCTION public.refunds_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refunds are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.destination = 'balance' AND NEW.state = 'paid' OR NEW.destination = 'cash' AND NEW.state = 'requested')
       OR NOT EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                       WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.invoice_line_id AND i.id = NEW.invoice_id AND i.branch_id = NEW.branch_id
                         AND i.state = 'issued' AND NOT i.consultation AND public.patient_canonical(i.tenant_id, i.patient_id) = NEW.patient_id)
       OR NEW.destination = 'cash' AND NOT EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = NEW.tenant_id AND ap.id = NEW.approval_id
                                                    AND ap.type = 'refund_exception' AND ap.subject_kind = 'refund' AND ap.subject_id = NEW.id
                                                    AND ap.state = 'pending' AND ap.amount_rupiah = NEW.amount) THEN
      RAISE EXCEPTION 'a refund is taken from its issued line, with its own approval when in cash' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.invoice_id, NEW.invoice_line_id, NEW.amount, NEW.destination, NEW.delivered,
      NEW.returned_quantity, NEW.reason, NEW.approval_id, NEW.requested_by, NEW.requested_as, NEW.requested_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.invoice_id, OLD.invoice_line_id, OLD.amount, OLD.destination, OLD.delivered,
      OLD.returned_quantity, OLD.reason, OLD.approval_id, OLD.requested_by, OLD.requested_as, OLD.requested_at, OLD.command_key)
     OR NOT (OLD.state = 'requested' AND NEW.state IN ('approved','failed') OR OLD.state = 'approved' AND NEW.state IN ('paid','failed'))
     OR NEW.state <> 'paid' AND (NEW.balance_entry_id, NEW.cash_entry_id, NEW.paid_by, NEW.pay_key) IS DISTINCT FROM (OLD.balance_entry_id, OLD.cash_entry_id, OLD.paid_by, OLD.pay_key) THEN
    RAISE EXCEPTION 'a cash refund moves requested, approved, paid or failed once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- refund_line_options (re-created from 0094): a consultation line is blocked (T-079).
CREATE OR REPLACE FUNCTION public.refund_line_options(p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL);
  i public.invoices;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF i.id IS NULL OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('invoice_id', i.id, 'number', i.number, 'state', i.state,
    'patient', public.kasir_patient_json(i.tenant_id, i.patient_id, a.role = 'auditor'),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', ci.name, 'line_total', l.line_total,
        'room', greatest(0, public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(l.tenant_id, l.id)),
        'delivered', public.refund_line_delivered(l, i),
        'blocked', CASE WHEN i.state <> 'issued' THEN 'invoice_not_issued' WHEN i.patient_id IS NULL THEN 'invoice_without_patient'
                        WHEN i.consultation THEN 'consultation_line'
                        WHEN EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id) THEN 'package_line'
                        WHEN l.receivable_amount > 0 THEN 'line_on_receivable'
                        WHEN l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0 THEN 'line_unpaid'
                        WHEN public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(l.tenant_id, l.id) <= 0 THEN 'nothing_to_refund' END)
      ORDER BY l.created_at, l.id)
      FROM public.invoice_lines l JOIN public.catalog_versions ci ON ci.tenant_id = l.tenant_id AND ci.id = l.catalog_version_id
     WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id), '[]'::jsonb));
END
$$;--> statement-breakpoint

-- refund_invoice_picks (re-created from 0094): consultation invoices are not refund picks (T-079).
CREATE OR REPLACE FUNCTION public.refund_invoice_picks() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL);
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'number', x.number, 'total', x.total, 'patient', x.patient) ORDER BY x.issued_at DESC)
    FROM (SELECT i.id, i.number, i.issued_at, sum(l.line_total) AS total, public.kasir_patient_json(i.tenant_id, i.patient_id, a.role = 'auditor') AS patient
            FROM public.invoices i JOIN public.invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
           WHERE i.tenant_id = a.tenant_id AND i.state = 'issued' AND i.patient_id IS NOT NULL AND NOT i.consultation AND (a.branch_id IS NULL OR i.branch_id = a.branch_id)
           GROUP BY i.id, i.number, i.issued_at, i.tenant_id, i.patient_id
          HAVING sum(greatest(0, public.kasir_line_paid(i.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(i.tenant_id, l.id))) > 0
           ORDER BY i.issued_at DESC LIMIT 30) x), '[]'::jsonb);
END
$$;
