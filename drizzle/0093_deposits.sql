CREATE TABLE "booking_deposits" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"tax_category" text NOT NULL,
	"is_pkp_at_receipt" boolean NOT NULL,
	"vat_base" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"vat_recognised_amount" bigint DEFAULT 0 NOT NULL,
	"cutoff_hours" smallint NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"applied_line_id" uuid,
	"decision_code" text,
	"refund_method" text,
	"refund_details" jsonb,
	"decided_by" uuid,
	"decided_as" text,
	"decided_at" timestamp with time zone,
	"command_key" text NOT NULL,
	"received_by" uuid NOT NULL,
	"received_as" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "booking_deposits_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "booking_deposits_appointment_key" UNIQUE("tenant_id","appointment_id"),
	CONSTRAINT "booking_deposits_receipt_key" UNIQUE("tenant_id","receipt_id"),
	CONSTRAINT "booking_deposits_line_key" UNIQUE("tenant_id","applied_line_id"),
	CONSTRAINT "booking_deposits_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "booking_deposits_check" CHECK ("booking_deposits"."amount" between 1 and 1000000000000 and "booking_deposits"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "booking_deposits"."method" in ('cash','edc','transfer') and "booking_deposits"."state" in ('held','applied','moved_to_balance','forfeited','refunded') and "booking_deposits"."tax_category" in ('exempt_medical','taxable_service','taxable_goods','non_object')
      and "booking_deposits"."vat_base" >= 0 and "booking_deposits"."vat_amount" >= 0 and "booking_deposits"."vat_base" + "booking_deposits"."vat_amount" = "booking_deposits"."amount" and ("booking_deposits"."is_pkp_at_receipt" or "booking_deposits"."vat_amount" = 0)
      and "booking_deposits"."vat_recognised_amount" between 0 and "booking_deposits"."vat_amount" and "booking_deposits"."cutoff_hours" between 0 and 72
      and "booking_deposits"."received_as" in ('owner','manager','fo_cashier','finance')
      and (("booking_deposits"."state" = 'held') = ("booking_deposits"."decided_at" is null)) and (("booking_deposits"."state" = 'held') = ("booking_deposits"."decided_by" is null))
      and (("booking_deposits"."state" = 'applied') = ("booking_deposits"."applied_line_id" is not null))
      and (("booking_deposits"."state" = 'refunded') = ("booking_deposits"."refund_method" is not null)) and ("booking_deposits"."refund_method" is null or "booking_deposits"."refund_method" in ('cash','edc','transfer'))
      and ("booking_deposits"."refund_details" is null or "booking_deposits"."refund_method" in ('edc','transfer') and jsonb_typeof("booking_deposits"."refund_details") = 'object')
      and ("booking_deposits"."state" = 'held' or "booking_deposits"."decision_code" ~ '^[a-z][a-z_]{2,40}$')
      and ("booking_deposits"."decided_as" is null or "booking_deposits"."decided_as" in ('owner','admin_pusat','manager','fo_cashier','central_cs','finance')))
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_check";--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "booking_deposit_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_appointment_fk" FOREIGN KEY ("tenant_id","branch_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_line_fk" FOREIGN KEY ("tenant_id","applied_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_received_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_deposits_patient_idx" ON "booking_deposits" USING btree ("tenant_id","patient_id");--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_check" CHECK (num_nonnulls("payment_allocations"."invoice_line_id", "payment_allocations"."top_up_id", "payment_allocations"."booking_deposit_id") = 1 and "payment_allocations"."amount" between 1 and 1000000000000
      and "payment_allocations"."vat_portion" between 0 and "payment_allocations"."amount" and "payment_allocations"."method" in ('cash','edc','transfer','qris','va','payment_link','balance') and "payment_allocations"."environment" in ('production','staging','demo','local'));--> statement-breakpoint

-- T-077 rules (generated by gen.py; plan docs/tasks/T-077.md)
-- ── T-077 helpers ──
-- The deposit settings of a branch at an instant: SET-10 (DP on/off, cutoff hours).
CREATE FUNCTION public.deposit_setting(p_branch uuid, p_at timestamptz, OUT enabled boolean, OUT cutoff_hours smallint)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((s ->> 'dp_booking')::boolean, false), coalesce((s ->> 'batas_ubah')::smallint, 24::smallint)
    FROM (SELECT public.setting_value_at('SET-10', p_branch, p_at) AS s) x
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deposit_setting(uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Who reads deposits: the Kasir readers of the branch (kasir_readable).
CREATE FUNCTION public.deposit_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.kasir_readable(p_tenant, p_branch)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deposit_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.deposit_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- The single decision of a held deposit (P1-1: one terminal state, atomic with the caller's appointment change).
-- p_outcome: moved_to_balance | forfeited | refunded. VAT recognised at receipt is reversed on a move or a refund
-- (scenarios 6 PKP and 17); a forfeit keeps it (Q-05 pending; the forfeit is other income, A-10). The event payload carries
-- ids and codes only.
CREATE FUNCTION public.deposit_decide(d public.booking_deposits, p_outcome text, p_code text, p_staff uuid, p_role text,
                                      p_refund_method text, p_refund_details jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_at timestamptz := clock_timestamp();
BEGIN
  IF d.state <> 'held' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: deposit_decided' USING ERRCODE = '55000';
  END IF;
  UPDATE public.booking_deposits SET state = p_outcome, decision_code = p_code, decided_by = p_staff, decided_as = p_role, decided_at = v_at,
         vat_recognised_amount = CASE WHEN p_outcome IN ('moved_to_balance','refunded') THEN 0 ELSE vat_recognised_amount END,
         refund_method = p_refund_method, refund_details = p_refund_details
   WHERE tenant_id = d.tenant_id AND id = d.id;
  IF p_outcome = 'moved_to_balance' THEN
    PERFORM public.balance_post(d.tenant_id, d.patient_id, d.branch_id, 'dp_transfer', d.amount,
                                jsonb_build_object('source_kind', 'booking_deposit', 'source_id', d.id), 'dp_transfer:' || d.id::text, p_staff, p_role);
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (d.tenant_id, d.branch_id, CASE p_outcome WHEN 'moved_to_balance' THEN 'BookingDepositMovedToBalance' WHEN 'forfeited' THEN 'BookingDepositForfeited'
                                                   ELSE 'BookingDepositRefunded' END,
          'booking_deposit', d.id, p_staff, p_role, jsonb_build_object('deposit_id', d.id, 'appointment_id', d.appointment_id, 'code', p_code));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deposit_decide(public.booking_deposits, text, text, uuid, text, text, jsonb) FROM PUBLIC;--> statement-breakpoint

-- The patient-caused effect of an appointment change on its held deposit (BILL-13): at or before the cutoff (starts_at minus the
-- snapshotted hours) the DP moves to balance; later, it is forfeited (P2-2: v_at <= starts_at - cutoff -> balance). Called inside
-- the re-created appointment writers after appointment_open (which locked the appointment); no-op without a held deposit.
CREATE FUNCTION public.deposit_on_patient_change(ap public.appointments, p_code text, p_no_show boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  d public.booking_deposits;
BEGIN
  SELECT * INTO d FROM public.booking_deposits x WHERE x.tenant_id = ap.tenant_id AND x.appointment_id = ap.id AND x.state = 'held' FOR UPDATE;
  IF d.id IS NULL THEN
    RETURN;
  END IF;
  IF NOT p_no_show AND clock_timestamp() <= ap.starts_at - make_interval(hours => d.cutoff_hours) THEN
    PERFORM public.deposit_decide(d, 'moved_to_balance', p_code || '_before_cutoff', public.app_staff_id(), public.app_acting_role(), NULL, NULL);
  ELSE
    PERFORM public.deposit_decide(d, 'forfeited', CASE WHEN p_no_show THEN 'no_show' ELSE p_code || '_after_cutoff' END,
                                  public.app_staff_id(), public.app_acting_role(), NULL, NULL);
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deposit_on_patient_change(public.appointments, text, boolean) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.booking_deposits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY booking_deposits_read ON public.booking_deposits FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.deposit_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.booking_deposits TO clinic_app;--> statement-breakpoint
CREATE POLICY booking_deposits_operator_read ON public.booking_deposits FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.booking_deposits', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.booking_deposits TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER booking_deposits_no_truncate BEFORE TRUNCATE ON public.booking_deposits FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.booking_deposits ENABLE ALWAYS TRIGGER booking_deposits_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.booking_deposits', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'deposit definers (src/modules/cashier/deposits)', 'the receiving branch (the appointment''s)');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): a patient's booking deposits are personal.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.booking_deposits', 'personal');--> statement-breakpoint

-- ── T-077 guards ──
-- The FK of the new allocation target (DATA-28).
ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_deposit_fk FOREIGN KEY (tenant_id, booking_deposit_id)
  REFERENCES public.booking_deposits (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE UNIQUE INDEX payment_allocations_deposit_key ON public.payment_allocations (tenant_id, booking_deposit_id) WHERE booking_deposit_id IS NOT NULL;--> statement-breakpoint

-- A deposit is inserted held (by deposit_receive's shape: its receipt has no invoice, one per appointment) and decided once:
-- held -> applied | moved_to_balance | forfeited | refunded. Nothing else changes; the recognised VAT only falls to 0 on a move or
-- a refund, or moves to the line on apply (the deposit then keeps 0). Never deleted; the staff_access lock serializes writers.
CREATE FUNCTION public.booking_deposits_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'booking deposits are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'held' OR NEW.vat_recognised_amount <> NEW.vat_amount
       OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id IS NULL
                        AND r.branch_id = NEW.branch_id AND NOT r.is_simulated AND r.total = NEW.amount)
       OR NOT EXISTS (SELECT 1 FROM public.appointments ap WHERE ap.tenant_id = NEW.tenant_id AND ap.id = NEW.appointment_id AND ap.branch_id = NEW.branch_id
                        AND ap.catalog_version_id = NEW.catalog_version_id AND public.patient_canonical(ap.tenant_id, ap.patient_id) = NEW.patient_id) THEN
      RAISE EXCEPTION 'a deposit is taken held, for its appointment, with its own receipt' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.appointment_id, NEW.patient_id, NEW.catalog_version_id, NEW.receipt_id, NEW.method, NEW.amount,
      NEW.tax_category, NEW.is_pkp_at_receipt, NEW.vat_base, NEW.vat_amount, NEW.cutoff_hours, NEW.command_key, NEW.received_by, NEW.received_as, NEW.received_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.appointment_id, OLD.patient_id, OLD.catalog_version_id, OLD.receipt_id, OLD.method, OLD.amount,
      OLD.tax_category, OLD.is_pkp_at_receipt, OLD.vat_base, OLD.vat_amount, OLD.cutoff_hours, OLD.command_key, OLD.received_by, OLD.received_as, OLD.received_at)
     OR OLD.state <> 'held' OR NEW.state = 'held'
     OR NEW.state = 'forfeited' AND NEW.vat_recognised_amount <> OLD.vat_recognised_amount
     OR NEW.state IN ('moved_to_balance','refunded','applied') AND NEW.vat_recognised_amount <> 0 THEN
    RAISE EXCEPTION 'a deposit is decided once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER booking_deposits_guard BEFORE INSERT OR UPDATE OR DELETE ON public.booking_deposits FOR EACH ROW EXECUTE FUNCTION public.booking_deposits_guard();--> statement-breakpoint
ALTER TABLE public.booking_deposits ENABLE ALWAYS TRIGGER booking_deposits_guard;--> statement-breakpoint

-- ── T-077 writers ──
-- Terima DP (PR-22, BILL-13; P1-3, P1-4, P2-1, P2-2): owner, manager, FO/cashier or finance take the booking DP of a held, booked or
-- confirmed appointment whose booked version has the DP enabled, with SET-10 dp_booking on at its branch. Cash, EDC or transfer
-- (SET-14; real; no charge, no invoice). The amount is the version's booking_dp_amount. Insert order: receipt -> deposit -> payment
-- -> allocation (the top-up pattern). A held appointment is confirmed to booked (capability new_booking); an expired hold is refused.
-- VAT is recognised at receipt when PKP and the item is taxable (the vat_on_invoices gate locked and checked).
CREATE FUNCTION public.deposit_receive(p_key text, p_appointment uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  ap public.appointments;
  v public.catalog_versions;
  b public.branches;
  s record;
  v_at timestamptz;
  v_pkp boolean;
  v_split record;
  v_amount bigint;
  v_number text;
  v_receipt uuid;
  v_pay uuid;
  v_id uuid;
  v_patient uuid;
  v_body text;
BEGIN
  -- Roles: kasir_actor admits owner, manager, FO/cashier and finance only (mutation run 1: a second check here was redundant).
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'method' - 'cash_tendered' - 'details' <> '{}'::jsonb
     OR coalesce(p ->> 'method', '') NOT IN ('cash','edc','transfer')
     OR (p ->> 'method' = 'cash') <> (p ? 'cash_tendered')
     OR p ? 'cash_tendered' AND (jsonb_typeof(p -> 'cash_tendered') IS DISTINCT FROM 'number' OR (p ->> 'cash_tendered') !~ '^[1-9]\d{0,12}$')
     OR p ? 'details' AND (p ->> 'method' NOT IN ('edc','transfer') OR jsonb_typeof(p -> 'details') IS DISTINCT FROM 'object'
                           OR (p -> 'details') - 'card_type' - 'bank' - 'trace' - 'approval_code' - 'reference' <> '{}'::jsonb
                           OR EXISTS (SELECT 1 FROM jsonb_each(p -> 'details') d WHERE jsonb_typeof(d.value) <> 'string' OR length(d.value #>> '{}') NOT BETWEEN 1 AND 60)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: deposit' USING ERRCODE = '22023';
  END IF;
  PERFORM public.booking_expire_holds(a.tenant_id);
  SELECT * INTO ap FROM public.appointments x WHERE x.tenant_id = a.tenant_id AND x.id = p_appointment FOR UPDATE;
  IF ap.id IS NULL OR a.branch_id IS NOT NULL AND ap.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: appointment not found' USING ERRCODE = 'P0002';
  END IF;
  -- Idempotent replay: the same key on the same appointment returns the deposit.
  SELECT x.id INTO v_id FROM public.booking_deposits x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.booking_deposits x WHERE x.tenant_id = a.tenant_id AND x.id = v_id AND x.appointment_id = ap.id) THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a deposit with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN (SELECT jsonb_build_object('deposit_id', x.id, 'receipt_id', x.receipt_id, 'number', r.number, 'amount', x.amount, 'change', 0, 'replayed', true)
              FROM public.booking_deposits x JOIN public.receipts r ON r.tenant_id = x.tenant_id AND r.id = x.receipt_id WHERE x.tenant_id = a.tenant_id AND x.id = v_id);
  END IF;
  IF ap.state NOT IN ('held','booked','confirmed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_scheduled' USING ERRCODE = '55000';
  END IF;
  IF ap.state = 'held' AND ap.hold_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: hold_expired' USING ERRCODE = '55000';
  END IF;
  IF ap.state = 'held' AND NOT public.tenant_capability('new_booking') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant does not take new bookings now' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.booking_deposits x WHERE x.tenant_id = a.tenant_id AND x.appointment_id = ap.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: deposit_exists' USING ERRCODE = '55000';
  END IF;
  v_at := clock_timestamp();
  SELECT * INTO v FROM public.catalog_versions x WHERE x.tenant_id = a.tenant_id AND x.id = ap.catalog_version_id;
  SELECT * INTO s FROM public.deposit_setting(ap.branch_id, v_at);
  IF NOT s.enabled OR NOT v.booking_dp_enabled THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: deposit_off' USING ERRCODE = '55000';
  END IF;
  IF NOT public.kasir_method_enabled(p ->> 'method', v_at) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
  END IF;
  v_amount := v.booking_dp_amount;
  IF p ? 'cash_tendered' AND (p ->> 'cash_tendered')::bigint < v_amount THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: cash_tendered' USING ERRCODE = '22023';
  END IF;
  v_pkp := public.tax_pkp_at(a.tenant_id, v_at, ap.branch_id);
  IF v_pkp AND v.tax_category IN ('taxable_service','taxable_goods') THEN
    PERFORM public.feature_gate_lock('vat_on_invoices');
    IF NOT public.feature_gate_open('vat_on_invoices') THEN
      RAISE EXCEPTION 'ERR_GATE_CLOSED: vat_on_invoices' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_split FROM public.tax_vat_split(v_amount, v.tax_category, v_pkp);
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = ap.branch_id;
  v_patient := public.patient_canonical(a.tenant_id, ap.patient_id);
  IF ap.state = 'held' THEN
    UPDATE public.appointments SET state = 'booked', hold_until = NULL WHERE tenant_id = ap.tenant_id AND id = ap.id;
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (a.tenant_id, ap.branch_id, 'AppointmentBooked', 'appointment', ap.id, a.staff_id, a.role, jsonb_build_object('appointment_id', ap.id, 'branch_id', ap.branch_id,
            'patient_id', ap.patient_id, 'catalog_version_id', ap.catalog_version_id, 'performer_staff_id', ap.performer_staff_id, 'channel', ap.channel));
  END IF;
  v_number := public.kasir_next_number(a.tenant_id, b.id, 'KW');
  v_body := (SELECT t.legal_name FROM public.tenants t WHERE t.id = a.tenant_id) || E'\n' || b.name || coalesce(' · ' || b.address, '') || E'\n\nStruk ' || v_number
            || E'\n' || to_char((v_at AT TIME ZONE b.timezone), 'DD-MM-YYYY HH24:MI')
            || E'\n\nDP booking pasien ' || (SELECT pt.mrn FROM public.patients pt WHERE pt.tenant_id = a.tenant_id AND pt.id = v_patient)
            || E'\nJadwal ' || to_char((ap.starts_at AT TIME ZONE b.timezone), 'DD-MM-YYYY HH24:MI')
            || E'\n\nTotal dibayar Rp' || replace(to_char(v_amount, 'FM999G999G999G999'), ',', '.')
            || CASE WHEN v_split.vat > 0 THEN E'\nTermasuk PPN Rp' || replace(to_char(v_split.vat, 'FM999G999G999G999'), ',', '.') ELSE '' END
            || E'\n' || CASE p ->> 'method' WHEN 'cash' THEN 'Tunai' WHEN 'edc' THEN 'EDC' ELSE 'Transfer' END || ' Rp' || replace(to_char(v_amount, 'FM999G999G999G999'), ',', '.');
  BEGIN
    INSERT INTO public.receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, is_simulated, command_key, issued_by, issued_as, issued_at)
    VALUES (a.tenant_id, b.id, NULL, v_number, v_amount, v_body, '80mm', false, p_key, a.staff_id, a.role, v_at)
    RETURNING id INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
  END;
  INSERT INTO public.booking_deposits (tenant_id, branch_id, appointment_id, patient_id, catalog_version_id, receipt_id, method, amount, tax_category,
                                       is_pkp_at_receipt, vat_base, vat_amount, vat_recognised_amount, cutoff_hours, command_key, received_by, received_as, received_at)
  VALUES (a.tenant_id, b.id, ap.id, v_patient, v.id, v_receipt, p ->> 'method', v_amount, v.tax_category, v_pkp, v_split.base, v_split.vat, v_split.vat,
          s.cutoff_hours, p_key, a.staff_id, a.role, v_at)
  RETURNING id INTO v_id;
  INSERT INTO public.payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                               environment, is_simulated, received_by, received_as, received_at)
  VALUES (a.tenant_id, b.id, v_receipt, 1, NULL, v_patient, p ->> 'method', v_amount, (p ->> 'cash_tendered')::bigint,
          CASE WHEN p ? 'cash_tendered' THEN (p ->> 'cash_tendered')::bigint - v_amount END, p -> 'details', 'production', false, a.staff_id, a.role, v_at)
  RETURNING id INTO v_pay;
  INSERT INTO public.payment_allocations (tenant_id, branch_id, payment_id, booking_deposit_id, amount, vat_portion, method, environment, is_simulated)
  VALUES (a.tenant_id, b.id, v_pay, v_id, v_amount, v_split.vat, p ->> 'method', 'production', false);
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (a.tenant_id, b.id, 'PaymentReceived', 'payment', v_pay, a.staff_id, a.role, jsonb_build_object('payment_id', v_pay, 'deposit_id', v_id)),
         (a.tenant_id, b.id, 'BookingDepositReceived', 'booking_deposit', v_id, a.staff_id, a.role, jsonb_build_object('deposit_id', v_id, 'appointment_id', ap.id, 'payment_id', v_pay));
  PERFORM public.audit_append('money_correction', 'booking_deposit', v_id, 'success', 'booking_deposit_received');
  RETURN jsonb_build_object('deposit_id', v_id, 'receipt_id', v_receipt, 'number', v_number, 'amount', v_amount,
                            'change', CASE WHEN p ? 'cash_tendered' THEN (p ->> 'cash_tendered')::bigint - v_amount ELSE 0 END, 'replayed', false);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deposit_receive(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.deposit_receive(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Batalkan oleh klinik (scenario 6d): the appointment writers' roles cancel for a clinic cause; a held DP moves to balance.
CREATE FUNCTION public.appointment_cancel_clinic(p_appointment uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ap public.appointments := public.appointment_open(p_appointment);
  d public.booking_deposits;
BEGIN
  IF ap.state NOT IN ('booked','confirmed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_scheduled' USING ERRCODE = '55000';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  PERFORM public.appointment_release(ap);
  UPDATE public.appointments SET state = 'cancelled', state_reason = btrim(p_reason), state_changed_at = clock_timestamp(), state_changed_by = public.app_staff_id()
   WHERE tenant_id = ap.tenant_id AND id = ap.id;
  SELECT * INTO d FROM public.booking_deposits x WHERE x.tenant_id = ap.tenant_id AND x.appointment_id = ap.id AND x.state = 'held' FOR UPDATE;
  IF d.id IS NOT NULL THEN
    PERFORM public.deposit_decide(d, 'moved_to_balance', 'clinic_cancel', public.app_staff_id(), public.app_acting_role(), NULL, NULL);
  END IF;
  PERFORM public.appointment_changed(ap, 'AppointmentCancelled', 'appointment_cancelled_clinic', '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_cancel_clinic(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.appointment_cancel_clinic(uuid, text) TO clinic_app;--> statement-breakpoint

-- Kembalikan DP (scenario 17): a clinic-caused cancellation refunded on the patient's request, without the B-04 exception
-- approval. Cancels the scheduled appointment (or acts on one already cancelled by the clinic whose DP is still held) and
-- records the refund on the deposit: cash, EDC or transfer, VAT reversed. Owner, manager or FO/cashier of the branch.
CREATE FUNCTION public.deposit_refund_clinic(p_key text, p_deposit uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  d public.booking_deposits;
  ap public.appointments;
BEGIN
  -- Roles: kasir_actor (owner, manager, FO/cashier, finance) and appointment_open below (no finance) leave owner, manager and
  -- FO/cashier (mutation run 1: a separate check was redundant).
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'method' - 'reason' - 'details' <> '{}'::jsonb OR coalesce(p ->> 'method', '') NOT IN ('cash','edc','transfer')
     OR length(btrim(coalesce(p ->> 'reason', ''))) NOT BETWEEN 3 AND 500
     OR p ? 'details' AND (p ->> 'method' NOT IN ('edc','transfer') OR jsonb_typeof(p -> 'details') IS DISTINCT FROM 'object'
                           OR (p -> 'details') - 'bank' - 'reference' <> '{}'::jsonb
                           OR EXISTS (SELECT 1 FROM jsonb_each(p -> 'details') x WHERE jsonb_typeof(x.value) <> 'string' OR length(x.value #>> '{}') NOT BETWEEN 1 AND 60))
     OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refund' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.booking_deposits x WHERE x.tenant_id = a.tenant_id AND x.id = p_deposit;
  IF d.id IS NULL OR a.branch_id IS NOT NULL AND d.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: deposit not found' USING ERRCODE = 'P0002';
  END IF;
  -- A replay of the same key is answered by the command layer (runCommand) before this runs; a second refund is a conflict.
  ap := public.appointment_open(d.appointment_id);
  SELECT * INTO d FROM public.booking_deposits x WHERE x.tenant_id = a.tenant_id AND x.id = p_deposit FOR UPDATE;
  IF d.state <> 'held' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: deposit_decided' USING ERRCODE = '55000';
  END IF;
  IF ap.state IN ('booked','confirmed') THEN
    PERFORM public.appointment_release(ap);
    UPDATE public.appointments SET state = 'cancelled', state_reason = btrim(p ->> 'reason'), state_changed_at = clock_timestamp(), state_changed_by = a.staff_id
     WHERE tenant_id = ap.tenant_id AND id = ap.id;
    PERFORM public.appointment_changed(ap, 'AppointmentCancelled', 'appointment_cancelled_clinic', '{}'::jsonb);
  ELSIF ap.state <> 'cancelled' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_scheduled' USING ERRCODE = '55000';
  END IF;
  PERFORM public.deposit_decide(d, 'refunded', 'clinic_refund', a.staff_id, a.role, p ->> 'method', p -> 'details');
  PERFORM public.audit_append('money_correction', 'booking_deposit', d.id, 'success', 'booking_deposit_refunded');
  RETURN jsonb_build_object('deposit_id', d.id, 'state', 'refunded');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deposit_refund_clinic(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.deposit_refund_clinic(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── T-077 apply on arrival (scenario 6e; P1-2; r2 build note) ──
-- Applies a held deposit to a line of the visit's ordinary invoice: the line must be for the booked item, its remaining room
-- (line total less cancelled less paid) at least the deposit's amount. One allocation stays on the deposit's payment; the line
-- is paid by the deposit through kasir_line_paid (re-created). The deposit's recognised VAT moves to the line, bounded by the
-- line's own VAT (so the remainder recognises only the rest: VAT counted once). Called by invoice_issue (automatic) and by
-- deposit_apply (explicit); the caller holds the visit and invoice locks.
CREATE FUNCTION public.deposit_apply_do(i public.invoices, d public.booking_deposits, p_staff uuid, p_role text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  il public.invoice_lines;
  v_vat bigint;
BEGIN
  SELECT x.* INTO il FROM public.invoice_lines x
   WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id AND x.item_id = (SELECT cv.item_id FROM public.catalog_versions cv WHERE cv.tenant_id = d.tenant_id AND cv.id = d.catalog_version_id)
     AND x.plan_item_id IS NULL AND x.substitution_id IS NULL
     AND x.line_total - x.cancelled_amount - public.kasir_line_paid(x.tenant_id, x.id) >= d.amount
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
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (d.tenant_id, i.branch_id, 'BookingDepositApplied', 'booking_deposit', d.id, p_staff, p_role,
          jsonb_build_object('deposit_id', d.id, 'invoice_id', i.id, 'invoice_line_id', il.id));
  RETURN il.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deposit_apply_do(public.invoices, public.booking_deposits, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Pakai DP (explicit, idempotent): the Kasir applies the held deposit of the invoice's visit appointment.
CREATE FUNCTION public.deposit_apply(p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  d public.booking_deposits;
  v_line uuid;
BEGIN
  -- Roles: kasir_actor (owner, manager, FO/cashier, finance).
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF i.id IS NULL OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  SELECT dd.* INTO d FROM public.booking_deposits dd JOIN public.visits v ON v.tenant_id = dd.tenant_id AND v.appointment_id = dd.appointment_id
   WHERE dd.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE OF dd;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: deposit not found' USING ERRCODE = 'P0002';
  END IF;
  IF d.state = 'applied' AND EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.tenant_id = d.tenant_id AND x.id = d.applied_line_id AND x.invoice_id = i.id) THEN
    RETURN jsonb_build_object('deposit_id', d.id, 'invoice_line_id', d.applied_line_id, 'replayed', true);
  END IF;
  IF d.state <> 'held' OR i.state <> 'issued' OR NOT public.invoice_is_ordinary(i.tenant_id, i.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: deposit_not_applicable' USING ERRCODE = '55000';
  END IF;
  v_line := public.deposit_apply_do(i, d, a.staff_id, a.role);
  IF v_line IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_line_for_deposit' USING ERRCODE = '55000';
  END IF;
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  PERFORM public.audit_append('money_correction', 'booking_deposit', d.id, 'success', 'booking_deposit_applied');
  RETURN jsonb_build_object('deposit_id', d.id, 'invoice_line_id', v_line, 'replayed', false);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deposit_apply(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.deposit_apply(uuid) TO clinic_app;--> statement-breakpoint

-- ── T-077 re-created functions (recreate.py) ──
-- kasir_line_paid (re-created from 0087): a deposit applied to the line counts as paid (T-077).
CREATE OR REPLACE FUNCTION public.kasir_line_paid(p_tenant uuid, p_line uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (coalesce(sum(a.amount), 0) + coalesce((SELECT sum(d.amount) FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.applied_line_id = p_line
                                                    AND d.state = 'applied'), 0))::bigint FROM public.payment_allocations a
   WHERE a.tenant_id = p_tenant AND a.invoice_line_id = p_line AND NOT a.is_simulated
$$;--> statement-breakpoint

-- payment_line_room (re-created from 0091): the simulated room also excludes an applied deposit (T-077).
CREATE OR REPLACE FUNCTION public.payment_line_room(p_tenant uuid, p_line uuid, p_simulated boolean) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT greatest(0, l.line_total - l.cancelled_amount - CASE WHEN p_simulated
           THEN (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = l.tenant_id AND a.invoice_line_id = l.id)
                + (SELECT coalesce(sum(d.amount), 0) FROM public.booking_deposits d WHERE d.tenant_id = l.tenant_id AND d.applied_line_id = l.id AND d.state = 'applied')
           ELSE public.kasir_line_paid(l.tenant_id, l.id) END)::bigint
    FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.id = p_line
$$;--> statement-breakpoint

-- payment_allocations_guard (re-created from 0091): a deposit target; a line's applied deposit counts against its room (T-077).
CREATE OR REPLACE FUNCTION public.payment_allocations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  p public.payments;
  l public.invoice_lines;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  SELECT * INTO p FROM public.payments x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.payment_id;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.invoice_line_id;
  -- T-077: a deposit allocation names its deposit (the payment of its receipt, the same amount, its VAT); no line; one per deposit.
  IF NEW.booking_deposit_id IS NOT NULL THEN
    IF p.id IS NULL OR p.invoice_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND (a.payment_id = NEW.payment_id OR a.booking_deposit_id = NEW.booking_deposit_id))
       OR NOT EXISTS (SELECT 1 FROM public.booking_deposits u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.booking_deposit_id AND u.state = 'held'
         AND u.receipt_id = p.receipt_id AND u.amount = p.amount AND u.amount = NEW.amount AND u.vat_amount = NEW.vat_portion AND u.method = p.method)
       OR NEW.is_simulated
       OR (NEW.method, NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated) IS DISTINCT FROM (p.method, p.provider, p.provider_account, p.environment, p.is_simulated) THEN
      RAISE EXCEPTION 'a deposit allocation names its deposit' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- T-076: a top-up allocation names its top-up (the payment of its receipt, the same amount); no line.
  IF NEW.top_up_id IS NOT NULL THEN
    IF p.id IS NULL OR p.invoice_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND (a.payment_id = NEW.payment_id OR a.top_up_id = NEW.top_up_id))
       OR NOT EXISTS (SELECT 1 FROM public.balance_top_ups u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.top_up_id
         AND u.receipt_id = p.receipt_id AND u.amount = p.amount AND u.amount = NEW.amount) OR NEW.vat_portion <> 0 OR NEW.is_simulated
       OR (NEW.method, NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated) IS DISTINCT FROM (p.method, p.provider, p.provider_account, p.environment, p.is_simulated) THEN
      RAISE EXCEPTION 'a top-up allocation names its top-up' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF p.id IS NULL OR l.id IS NULL OR l.invoice_id <> p.invoice_id
     OR (NEW.method, NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated)
        IS DISTINCT FROM (p.method, p.provider, p.provider_account, p.environment, p.is_simulated)
     OR (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.invoice_line_id = NEW.invoice_line_id
          AND a.is_simulated = NEW.is_simulated) + NEW.amount
        + (SELECT coalesce(sum(d.amount), 0) FROM public.booking_deposits d WHERE d.tenant_id = NEW.tenant_id AND d.applied_line_id = NEW.invoice_line_id AND d.state = 'applied')
        > l.line_total - l.cancelled_amount
     OR (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.payment_id = NEW.payment_id) + NEW.amount > p.amount THEN
    RAISE EXCEPTION 'an allocation stays within its payment and its line' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- payments_guard (re-created from 0091): a payment with no invoice may be a booking deposit (T-077).
CREATE OR REPLACE FUNCTION public.payments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.payment_charges;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF (NEW.method IN ('qris','va','payment_link')) <> (NEW.charge_id IS NOT NULL) OR NEW.webhook_event_id IS NOT NULL AND NEW.charge_id IS NULL THEN
    RAISE EXCEPTION 'a port payment names its charge; no other does' USING ERRCODE = '42501';
  END IF;
  IF NEW.method = 'balance' AND (NEW.patient_id IS NULL OR NEW.is_simulated) THEN
    RAISE EXCEPTION 'a balance payment has a patient and is never simulated' USING ERRCODE = '42501';
  END IF;
  IF NEW.charge_id IS NOT NULL THEN
    SELECT * INTO c FROM public.payment_charges x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.charge_id;
    IF c.id IS NULL OR c.invoice_id <> NEW.invoice_id OR c.channel <> NEW.method
       OR (c.provider, c.provider_account, c.environment, c.is_simulated) IS DISTINCT FROM (NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated) THEN
      RAISE EXCEPTION 'a port payment copies its charge' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- T-076 (r3 3), T-077 (P1-3): a payment with no invoice is an Isi Saldo or a booking DP: cash, EDC or transfer, a patient, real, no
  -- charge, exactly one of its top-up or its deposit.
  IF NEW.invoice_id IS NULL THEN
    IF NEW.method NOT IN ('cash','edc','transfer') OR NEW.patient_id IS NULL OR NEW.is_simulated OR NEW.charge_id IS NOT NULL
       OR (EXISTS (SELECT 1 FROM public.balance_top_ups u WHERE u.tenant_id = NEW.tenant_id AND u.receipt_id = NEW.receipt_id AND u.branch_id = NEW.branch_id
                        AND u.patient_id = NEW.patient_id AND u.amount = NEW.amount))
          = (EXISTS (SELECT 1 FROM public.booking_deposits u WHERE u.tenant_id = NEW.tenant_id AND u.receipt_id = NEW.receipt_id AND u.branch_id = NEW.branch_id
                        AND u.patient_id = NEW.patient_id AND u.amount = NEW.amount AND u.method = NEW.method AND u.state = 'held'))
       OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id IS NULL AND r.branch_id = NEW.branch_id
                        AND NOT r.is_simulated) THEN
      RAISE EXCEPTION 'a payment with no invoice is a balance top-up or a booking deposit' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id
                   AND (i.state = 'issued' OR i.state = 'void' AND NEW.charge_id IS NOT NULL)
                   AND i.patient_id IS NOT DISTINCT FROM NEW.patient_id)
     OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id IS NOT DISTINCT FROM NEW.invoice_id AND r.branch_id = NEW.branch_id
                      AND r.is_simulated = NEW.is_simulated) THEN
    RAISE EXCEPTION 'a payment is for an issued invoice, its patient and its receipt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- receipt_get (re-created from 0091): a deposit receipt's patient is masked for the auditor like the others (P1-5).
CREATE OR REPLACE FUNCTION public.receipt_get(p_receipt uuid) RETURNS jsonb
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
    SELECT p.* INTO pt FROM public.patients p WHERE p.tenant_id = r.tenant_id AND p.id = public.patient_canonical(r.tenant_id,
      coalesce((SELECT i.patient_id FROM public.invoices i WHERE i.tenant_id = r.tenant_id AND i.id = r.invoice_id),
               (SELECT u.patient_id FROM public.balance_top_ups u WHERE u.tenant_id = r.tenant_id AND u.receipt_id = r.id),
               (SELECT u.patient_id FROM public.booking_deposits u WHERE u.tenant_id = r.tenant_id AND u.receipt_id = r.id)));
    IF pt.id IS NOT NULL THEN
      v_body := replace(replace(v_body, pt.full_name, '***'), pt.mrn, '***' || right(pt.mrn, 3));
    END IF;
  END IF;
  RETURN jsonb_build_object('id', r.id, 'number', r.number, 'invoice_id', r.invoice_id, 'total', r.total, 'paper', r.paper, 'body', v_body, 'issued_at', r.issued_at,
    'is_simulated', r.is_simulated,
    'payments', (SELECT jsonb_agg(jsonb_build_object('seq', y.seq, 'method', y.method, 'amount', y.amount, 'change', y.change_given) ORDER BY y.seq)
                   FROM public.payments y WHERE y.tenant_id = r.tenant_id AND y.receipt_id = r.id));
END
$$;--> statement-breakpoint

-- invoice_void_request (re-created from 0087): an invoice with an applied deposit is paid (T-077).
CREATE OR REPLACE FUNCTION public.invoice_void_request(p_invoice uuid, p_reason text) RETURNS uuid
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
              WHERE y.tenant_id = i.tenant_id AND y.invoice_id = i.id)
     OR EXISTS (SELECT 1 FROM public.booking_deposits d JOIN public.invoice_lines l ON l.tenant_id = d.tenant_id AND l.id = d.applied_line_id
                 WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND d.state = 'applied') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_paid' USING ERRCODE = '55000';
  END IF;
  v_id := public.approval_request('invoice_void', 'invoice', i.id, btrim(p_reason), i.branch_id,
    (SELECT sum(l.line_total) FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id)::bigint);
  RETURN v_id;
END
$$;--> statement-breakpoint

-- invoice_void_sync (re-created from 0091): an invoice with an applied deposit is paid (T-077).
CREATE OR REPLACE FUNCTION public.invoice_void_sync() RETURNS trigger
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
     OR EXISTS (SELECT 1 FROM public.booking_deposits d JOIN public.invoice_lines l ON l.tenant_id = d.tenant_id AND l.id = d.applied_line_id
                 WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND d.state = 'applied')
     OR EXISTS (SELECT 1 FROM public.dispensings d JOIN public.invoice_lines l ON l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id
                 WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND d.state = 'handed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_paid' USING ERRCODE = '55000';
  END IF;
  UPDATE public.invoices SET state = 'void', void_approval_id = NEW.id, voided_at = clock_timestamp() WHERE tenant_id = i.tenant_id AND id = i.id;
  -- T-076: the package of a voided (unpaid) package invoice is cancelled with its sessions.
  PERFORM public.package_close_do(pk, 'cancelled', 'invoice_void', NEW.decided_by, NEW.decided_as, clock_timestamp())
     FROM public.packages pk WHERE pk.tenant_id = i.tenant_id AND pk.invoice_id = i.id AND pk.state = 'active';
  -- T-073 (r1 P1-4): a pending port charge of the invoice is cancelled (a late paid webhook then waits for the balance).
  UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = i.tenant_id AND invoice_id = i.id AND state = 'pending';
  UPDATE public.dispensings d SET state = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = NEW.decided_by, cancel_reason = 'Invoice dibatalkan'
    FROM public.invoice_lines l
   WHERE d.tenant_id = i.tenant_id AND l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id AND l.invoice_id = i.id AND d.state IN ('queued','prepared');
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceVoided', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'approval_id', NEW.id));
  RETURN NULL;
END
$$;--> statement-breakpoint

-- appointment_cancel (re-created from 0062): a patient-caused cancel moves the held DP to balance at or before the cutoff, else forfeits it (T-077).
CREATE OR REPLACE FUNCTION public.appointment_cancel(p_appointment uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ap public.appointments := public.appointment_open(p_appointment);
BEGIN
  IF ap.state NOT IN ('booked','confirmed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_scheduled' USING ERRCODE = '55000';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  PERFORM public.appointment_release(ap);
  UPDATE public.appointments SET state = 'cancelled', state_reason = btrim(p_reason), state_changed_at = clock_timestamp(), state_changed_by = public.app_staff_id()
   WHERE tenant_id = ap.tenant_id AND id = ap.id;
  PERFORM public.deposit_on_patient_change(ap, 'patient_cancel', false); -- T-077: a patient-caused cancel
  PERFORM public.appointment_changed(ap, 'AppointmentCancelled', 'appointment_cancelled', '{}'::jsonb);
END
$$;--> statement-breakpoint

-- appointment_no_show (re-created from 0062): a no-show forfeits the held DP (PR-83, T-077).
CREATE OR REPLACE FUNCTION public.appointment_no_show(p_appointment uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ap public.appointments := public.appointment_open(p_appointment);
BEGIN
  IF ap.state NOT IN ('booked','confirmed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_scheduled' USING ERRCODE = '55000';
  END IF;
  IF clock_timestamp() < public.appointment_no_show_from(ap) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: before_no_show_time' USING ERRCODE = '22023';
  END IF;
  PERFORM public.appointment_release(ap);
  UPDATE public.appointments SET state = 'no_show', state_changed_at = clock_timestamp(), state_changed_by = public.app_staff_id()
   WHERE tenant_id = ap.tenant_id AND id = ap.id;
  PERFORM public.deposit_on_patient_change(ap, 'no_show', true); -- T-077 (PR-83): the DP is forfeited
  PERFORM public.appointment_changed(ap, 'AppointmentNoShow', 'appointment_no_show', '{}'::jsonb);
END
$$;--> statement-breakpoint

-- appointment_reschedule (re-created from 0067): a patient reschedule moves the held DP to balance at or before the cutoff, else forfeits it (PR-22, T-077).
CREATE OR REPLACE FUNCTION public.appointment_reschedule(p_appointment uuid, p_start timestamptz, p_staff uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ap public.appointments := public.appointment_open(p_appointment);
  b public.branches;
  v public.catalog_versions;
  v_end timestamptz;
  p record;
  v_new uuid := public.uuid_generate_v7();
  x uuid;
BEGIN
  IF ap.state NOT IN ('booked','confirmed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_scheduled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.branches WHERE tenant_id = ap.tenant_id AND id = ap.branch_id;
  SELECT * INTO v FROM public.catalog_versions WHERE tenant_id = ap.tenant_id AND id = ap.catalog_version_id;
  IF p_start IS NULL OR p_start < clock_timestamp() - interval '1 minute' OR p_start > clock_timestamp() + interval '366 days'
     OR extract(epoch FROM (p_start AT TIME ZONE b.timezone)::time) % 900 <> 0 OR p_start = ap.starts_at AND p_staff IS NOT DISTINCT FROM ap.performer_staff_id THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: start' USING ERRCODE = '22023';
  END IF;
  v_end := p_start + make_interval(mins => public.booking_minutes(v));
  PERFORM public.appointment_release(ap);
  IF EXISTS (SELECT 1 FROM public.appointments o WHERE o.tenant_id = ap.tenant_id AND o.patient_id = ANY (public.patient_cluster(ap.tenant_id, public.patient_canonical(ap.tenant_id, ap.patient_id))) AND o.id <> ap.id
              AND public.appointment_live(o) AND o.starts_at < v_end AND p_start < o.ends_at) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: patient_overlap' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO p FROM public.booking_pick(ap.tenant_id, ap.branch_id, v.id, p_start, v_end, p_staff);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: slot_taken' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.appointments (id, tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state,
                                   channel, source, campaign, note, created_by, created_as)
  VALUES (v_new, ap.tenant_id, ap.branch_id, ap.patient_id, v.id, p.staff_id, p_start, v_end, 'booked',
          ap.channel, ap.source, ap.campaign, ap.note, public.app_staff_id(), public.app_acting_role());
  BEGIN
    INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
    VALUES (ap.tenant_id, ap.branch_id, v_new, 'staff', p.staff_id, p_start, v_end);
    FOREACH x IN ARRAY p.rooms LOOP
      INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
      VALUES (ap.tenant_id, ap.branch_id, v_new, 'room', x, p_start, v_end);
    END LOOP;
    FOREACH x IN ARRAY p.devices LOOP
      INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
      VALUES (ap.tenant_id, ap.branch_id, v_new, 'device', x, p_start, v_end);
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: slot_taken' USING ERRCODE = '55000';
  END;
  UPDATE public.appointments SET state = 'rescheduled', rescheduled_to = v_new, state_changed_at = clock_timestamp(), state_changed_by = public.app_staff_id()
   WHERE tenant_id = ap.tenant_id AND id = ap.id;
  PERFORM public.deposit_on_patient_change(ap, 'patient_reschedule', false); -- T-077: the new appointment carries no DP
  PERFORM public.appointment_changed(ap, 'AppointmentRescheduled', 'appointment_rescheduled', jsonb_build_object('new_appointment_id', v_new));
  RETURN jsonb_build_object('appointment_id', v_new, 'starts_at', p_start, 'ends_at', v_end, 'staff_id', p.staff_id,
                            'rooms', to_jsonb(p.rooms), 'devices', to_jsonb(p.devices));
END
$$;--> statement-breakpoint

-- invoice_issue (re-created from 0091): the held DP of the visit's appointment is applied at issue (T-077).
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
$$;
