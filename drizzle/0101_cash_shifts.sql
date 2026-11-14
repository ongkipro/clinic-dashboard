CREATE TABLE "cash_shift_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"method" text NOT NULL,
	"payments" integer NOT NULL,
	"received" bigint NOT NULL,
	"paid_out" bigint NOT NULL,
	"expected" bigint NOT NULL,
	"counted" bigint,
	CONSTRAINT "cash_shift_count_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_shift_count_lines_method_key" UNIQUE("tenant_id","count_id","method"),
	CONSTRAINT "cash_shift_count_lines_check" CHECK ("cash_shift_count_lines"."method" in ('cash','edc','transfer','qris','va','payment_link','balance') and "cash_shift_count_lines"."payments" >= 0 and "cash_shift_count_lines"."received" >= 0 and "cash_shift_count_lines"."paid_out" >= 0
      and ("cash_shift_count_lines"."method" = 'cash' or "cash_shift_count_lines"."paid_out" = 0) and (("cash_shift_count_lines"."method" = 'cash') = ("cash_shift_count_lines"."counted" is not null)))
);
--> statement-breakpoint
CREATE TABLE "cash_shift_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"counted_cash" bigint NOT NULL,
	"expected_cash" bigint NOT NULL,
	"reason" text,
	"threshold" bigint NOT NULL,
	"approval_id" uuid,
	"command_key" text NOT NULL,
	"counted_by" uuid NOT NULL,
	"counted_as" text NOT NULL,
	"counted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "cash_shift_counts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_shift_counts_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "cash_shift_counts_seq_key" UNIQUE("tenant_id","shift_id","seq"),
	CONSTRAINT "cash_shift_counts_approval_key" UNIQUE("tenant_id","approval_id"),
	CONSTRAINT "cash_shift_counts_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "cash_shift_counts_check" CHECK ("cash_shift_counts"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "cash_shift_counts"."seq" between 1 and 100 and "cash_shift_counts"."counted_cash" between 0 and 1000000000000
      and "cash_shift_counts"."threshold" >= 0 and (("cash_shift_counts"."counted_cash" = "cash_shift_counts"."expected_cash") = ("cash_shift_counts"."approval_id" is null))
      and ("cash_shift_counts"."counted_cash" = "cash_shift_counts"."expected_cash" or length(btrim("cash_shift_counts"."reason")) between 3 and 500)
      and "cash_shift_counts"."counted_as" in ('owner','manager','fo_cashier','finance'))
);
--> statement-breakpoint
CREATE TABLE "cash_shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"cashier_role" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"opening_float" bigint NOT NULL,
	"auto_opened" boolean NOT NULL,
	"open_key" text NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_as" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"closed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "cash_shifts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_shifts_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "cash_shifts_open_key" UNIQUE("tenant_id","open_key"),
	CONSTRAINT "cash_shifts_check" CHECK ("cash_shifts"."state" in ('open','pending_approval','recount','closed') and "cash_shifts"."opening_float" between 0 and 1000000000000
      and ("cash_shifts"."auto_opened" or "cash_shifts"."open_key" ~ '^[A-Za-z0-9_.:-]{8,128}$') and "cash_shifts"."cashier_role" in ('owner','manager','fo_cashier','finance') and "cash_shifts"."opened_as" = "cash_shifts"."cashier_role"
      and "cash_shifts"."opened_by" = "cash_shifts"."cashier_id" and ("cash_shifts"."auto_opened" = false or "cash_shifts"."opening_float" = 0)
      and (("cash_shifts"."state" = 'open') = ("cash_shifts"."closed_at" is null)) and (("cash_shifts"."state" = 'closed') = ("cash_shifts"."settled_at" is not null)))
);
--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_shift_count_lines" ADD CONSTRAINT "cash_shift_count_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_count_lines" ADD CONSTRAINT "cash_shift_count_lines_count_fk" FOREIGN KEY ("tenant_id","branch_id","count_id") REFERENCES "public"."cash_shift_counts"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_counts" ADD CONSTRAINT "cash_shift_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_counts" ADD CONSTRAINT "cash_shift_counts_shift_fk" FOREIGN KEY ("tenant_id","branch_id","shift_id") REFERENCES "public"."cash_shifts"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_counts" ADD CONSTRAINT "cash_shift_counts_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_counts" ADD CONSTRAINT "cash_shift_counts_counted_by_fk" FOREIGN KEY ("tenant_id","counted_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_cashier_fk" FOREIGN KEY ("tenant_id","cashier_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_opened_by_fk" FOREIGN KEY ("tenant_id","opened_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_shifts_one_open" ON "cash_shifts" USING btree ("tenant_id","branch_id","cashier_id") WHERE "cash_shifts"."state" = 'open';--> statement-breakpoint

-- T-085 rules (generated by gen.py; plan docs/tasks/T-085.md)
-- ── T-085 helpers, guards and stamping (plan §1, §2, §6; review r1 P1-1, P1-3, P2-1, P2-3, P2-4) ──
-- DRAFT written ahead of the build (2026-11-14) from the T-084 tree; the table DDL comes from src/modules/cashier/schema.ts (drizzle).
-- shift_id on the money tables (DATA-72; plan §1, re-base note): the nullable columns come from schema.ts; the same-branch composite FKs
-- are written here (the tables precede cash_shifts in schema.ts), as T-073 did for payments.charge_id.
ALTER TABLE public.payments ADD CONSTRAINT payments_shift_fk FOREIGN KEY (tenant_id, branch_id, shift_id) REFERENCES public.cash_shifts (tenant_id, branch_id, id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.booking_deposits ADD CONSTRAINT booking_deposits_shift_fk FOREIGN KEY (tenant_id, branch_id, shift_id) REFERENCES public.cash_shifts (tenant_id, branch_id, id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.refunds ADD CONSTRAINT refunds_shift_fk FOREIGN KEY (tenant_id, branch_id, shift_id) REFERENCES public.cash_shifts (tenant_id, branch_id, id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX payments_shift_idx ON public.payments (tenant_id, shift_id) WHERE shift_id IS NOT NULL;--> statement-breakpoint
-- Grants (checked on the T-084 tree): payments (0087:318) and booking_deposits (0093:133) are table-level SELECT grants, so shift_id is
-- readable at once; refunds is a column list (0094:240) without reason/paid_details → add the one column for both roles.
GRANT SELECT (shift_id) ON public.refunds TO clinic_app;--> statement-breakpoint
GRANT SELECT (shift_id) ON public.refunds TO clinic_operator;--> statement-breakpoint

-- r1 P2-4: owner, finance, auditor tenant-wide; manager at an allowed branch it holds; FO/cashier only its own shifts.
CREATE FUNCTION public.cash_shift_readable(p_tenant uuid, p_branch uuid, p_cashier uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
    public.app_role_in(ARRAY['owner','finance','auditor'])
    OR public.app_role_in(ARRAY['manager','fo_cashier']) AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch)
      AND (public.app_acting_role() = 'manager' OR p_cashier = public.app_staff_id())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_readable(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cash_shift_readable(uuid, uuid, uuid) TO clinic_app;--> statement-breakpoint

-- The open shift of a cashier at a branch; auto-opened with an Rp0 float when p_auto (owner decision 1, r1 P1-1: no audit row here —
-- the shift row itself carries opened_by/as/at; the caller holds staff_access).
CREATE FUNCTION public.cash_shift_for(p_tenant uuid, p_branch uuid, p_staff uuid, p_role text, p_at timestamptz, p_auto boolean) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT s.id INTO v_id FROM public.cash_shifts s
   WHERE s.tenant_id = p_tenant AND s.branch_id = p_branch AND s.cashier_id = p_staff AND s.state = 'open';
  IF v_id IS NULL AND p_auto THEN
    INSERT INTO public.cash_shifts (tenant_id, branch_id, cashier_id, cashier_role, state, opening_float, auto_opened, open_key, opened_by, opened_as, opened_at)
    VALUES (p_tenant, p_branch, p_staff, p_role, 'open', 0, true, 'auto-' || replace(public.uuid_generate_v7()::text, '-', ''), p_staff, p_role, p_at)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_for(uuid, uuid, uuid, text, timestamptz, boolean) FROM PUBLIC;--> statement-breakpoint

-- Stamping (§2, r1 P1-1 order, P2-1): every real payment carries its receiver's open shift at the payment's branch. A counter payment
-- (no port charge) auto-opens one; a port payment (QRIS/VA/link, settled by poll or webhook) takes the receiver's open shift or none and
-- never auto-opens; a simulated payment (BILL-29) has no shift; a caller-supplied shift_id is refused. Named to sort after payments_guard.
CREATE FUNCTION public.payments_shift() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF NEW.shift_id IS NOT NULL THEN
    RAISE EXCEPTION 'a payment''s shift is stamped, never supplied' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_simulated THEN
    RETURN NEW;
  END IF;
  NEW.shift_id := public.cash_shift_for(NEW.tenant_id, NEW.branch_id, NEW.received_by, NEW.received_as, NEW.received_at, NEW.charge_id IS NULL);
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payments_shift() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payments_shift BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_shift();--> statement-breakpoint
ALTER TABLE public.payments ENABLE ALWAYS TRIGGER payments_shift;--> statement-breakpoint

-- Cash out of the drawer (r1 P2-3, re-base note): a clinic-cause DP refund in cash and a cash refund paid in cash are stamped with the
-- payer's open shift (auto-opened: the payer handed cash from the drawer) on the transition into that state; set once, never supplied,
-- never changed. The guards compare explicit column lists, so they are not re-created.
CREATE FUNCTION public.booking_deposits_shift() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.shift_id IS NOT NULL THEN
      RAISE EXCEPTION 'a deposit''s cash-out shift is stamped, never supplied' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.shift_id IS NOT NULL OR OLD.state = 'refunded' THEN
    IF NEW.shift_id IS DISTINCT FROM OLD.shift_id THEN
      RAISE EXCEPTION 'a deposit''s cash-out shift never changes' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.shift_id IS NOT NULL THEN
    RAISE EXCEPTION 'a deposit''s cash-out shift is stamped, never supplied' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'refunded' AND NEW.refund_method = 'cash' THEN
    NEW.shift_id := public.cash_shift_for(NEW.tenant_id, NEW.branch_id, NEW.decided_by, NEW.decided_as, NEW.decided_at, true);
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_deposits_shift() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER booking_deposits_shift BEFORE INSERT OR UPDATE ON public.booking_deposits FOR EACH ROW EXECUTE FUNCTION public.booking_deposits_shift();--> statement-breakpoint
ALTER TABLE public.booking_deposits ENABLE ALWAYS TRIGGER booking_deposits_shift;--> statement-breakpoint

CREATE FUNCTION public.refunds_shift() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.shift_id IS NOT NULL THEN
      RAISE EXCEPTION 'a refund''s cash-out shift is stamped, never supplied' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.shift_id IS NOT NULL OR OLD.state = 'paid' THEN
    IF NEW.shift_id IS DISTINCT FROM OLD.shift_id THEN
      RAISE EXCEPTION 'a refund''s cash-out shift never changes' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.shift_id IS NOT NULL THEN
    RAISE EXCEPTION 'a refund''s cash-out shift is stamped, never supplied' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'paid' AND NEW.destination = 'cash' AND NEW.paid_method = 'cash' THEN
    NEW.shift_id := public.cash_shift_for(NEW.tenant_id, NEW.branch_id, NEW.paid_by, NEW.paid_as, NEW.paid_at, true);
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refunds_shift() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER refunds_shift BEFORE INSERT OR UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.refunds_shift();--> statement-breakpoint
ALTER TABLE public.refunds ENABLE ALWAYS TRIGGER refunds_shift;--> statement-breakpoint

-- §1 guard: never deleted; identity frozen; open → pending_approval|closed, pending_approval → closed|recount, recount → pending_approval|closed.
CREATE FUNCTION public.cash_shifts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cash shifts are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open' OR NEW.closed_at IS NOT NULL OR NEW.settled_at IS NOT NULL THEN
      RAISE EXCEPTION 'a shift opens open' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.cashier_id, NEW.cashier_role, NEW.opening_float, NEW.auto_opened, NEW.open_key, NEW.opened_by, NEW.opened_as, NEW.opened_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.cashier_id, OLD.cashier_role, OLD.opening_float, OLD.auto_opened, OLD.open_key, OLD.opened_by, OLD.opened_as, OLD.opened_at)
     OR NOT (OLD.state = 'open' AND NEW.state IN ('pending_approval','closed')
             OR OLD.state = 'pending_approval' AND NEW.state IN ('closed','recount')
             OR OLD.state = 'recount' AND NEW.state IN ('pending_approval','closed'))
     OR OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'a shift keeps its identity and moves forward only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shifts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER cash_shifts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.cash_shifts FOR EACH ROW EXECUTE FUNCTION public.cash_shifts_guard();--> statement-breakpoint
ALTER TABLE public.cash_shifts ENABLE ALWAYS TRIGGER cash_shifts_guard;--> statement-breakpoint

-- r1 P1-2: a count's approval exists, is pending, of this type, names this count and carries |variance|; counts and lines insert-only.
CREATE FUNCTION public.cash_shift_counts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shift counts are insert-only' USING ERRCODE = '42501';
  END IF;
  IF (NEW.approval_id IS NULL) <> (NEW.counted_cash = NEW.expected_cash)
     OR NEW.approval_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = NEW.tenant_id AND ap.id = NEW.approval_id AND ap.type = 'cash_shift_variance'
          AND ap.subject_kind = 'cash_shift_count' AND ap.subject_id = NEW.id AND ap.state = 'pending'
          AND ap.amount_rupiah = abs(NEW.counted_cash - NEW.expected_cash)) THEN
    RAISE EXCEPTION 'a count with a variance carries its own pending approval' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_counts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER cash_shift_counts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.cash_shift_counts FOR EACH ROW EXECUTE FUNCTION public.cash_shift_counts_guard();--> statement-breakpoint
ALTER TABLE public.cash_shift_counts ENABLE ALWAYS TRIGGER cash_shift_counts_guard;--> statement-breakpoint
CREATE TRIGGER cash_shift_count_lines_insert_only BEFORE UPDATE OR DELETE ON public.cash_shift_count_lines FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.cash_shift_count_lines ENABLE ALWAYS TRIGGER cash_shift_count_lines_insert_only;--> statement-breakpoint

ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY cash_shifts_read ON public.cash_shifts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.cash_shift_readable(tenant_id, branch_id, cashier_id));--> statement-breakpoint
GRANT SELECT ON public.cash_shifts TO clinic_app;--> statement-breakpoint
CREATE POLICY cash_shifts_operator_read ON public.cash_shifts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.cash_shifts', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.cash_shifts TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER cash_shifts_no_truncate BEFORE TRUNCATE ON public.cash_shifts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.cash_shifts ENABLE ALWAYS TRIGGER cash_shifts_no_truncate;--> statement-breakpoint
ALTER TABLE public.cash_shift_counts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY cash_shift_counts_read ON public.cash_shift_counts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND EXISTS (SELECT 1 FROM public.cash_shifts s WHERE s.tenant_id = cash_shift_counts.tenant_id AND s.id = cash_shift_counts.shift_id AND public.cash_shift_readable(s.tenant_id, s.branch_id, s.cashier_id)));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, shift_id, seq, counted_cash, expected_cash, threshold, approval_id, command_key, counted_by, counted_as, counted_at) ON public.cash_shift_counts TO clinic_app;--> statement-breakpoint
CREATE POLICY cash_shift_counts_operator_read ON public.cash_shift_counts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.cash_shift_counts', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, shift_id, seq, counted_cash, expected_cash, threshold, approval_id, command_key, counted_by, counted_as, counted_at) ON public.cash_shift_counts TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER cash_shift_counts_no_truncate BEFORE TRUNCATE ON public.cash_shift_counts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.cash_shift_counts ENABLE ALWAYS TRIGGER cash_shift_counts_no_truncate;--> statement-breakpoint
ALTER TABLE public.cash_shift_count_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY cash_shift_count_lines_read ON public.cash_shift_count_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND EXISTS (SELECT 1 FROM public.cash_shift_counts c JOIN public.cash_shifts s ON s.tenant_id = c.tenant_id AND s.id = c.shift_id WHERE c.tenant_id = cash_shift_count_lines.tenant_id AND c.id = cash_shift_count_lines.count_id AND public.cash_shift_readable(s.tenant_id, s.branch_id, s.cashier_id)));--> statement-breakpoint
GRANT SELECT ON public.cash_shift_count_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY cash_shift_count_lines_operator_read ON public.cash_shift_count_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.cash_shift_count_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.cash_shift_count_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER cash_shift_count_lines_no_truncate BEFORE TRUNCATE ON public.cash_shift_count_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.cash_shift_count_lines ENABLE ALWAYS TRIGGER cash_shift_count_lines_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.cash_shifts', 'branch-scoped', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'shift definers (src/modules/cashier/shifts)', 'the shift branch'),
  ('public.cash_shift_counts', 'branch-scoped', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'shift definers (src/modules/cashier/shifts)', 'the shift branch'),
  ('public.cash_shift_count_lines', 'branch-scoped', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'shift definers (src/modules/cashier/shifts)', 'the shift branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19; r1 P1-3): shifts and counts are personal (a named cashier, reasons); count lines are money totals.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.cash_shifts', 'personal'),
  ('public.cash_shift_counts', 'personal'),
  ('public.cash_shift_count_lines', 'money_total');--> statement-breakpoint

-- ── T-085 expectation, writers, routing (plan §3, §5; review r1 P1-2, P2-2, P2-4) ── DRAFT 2026-11-14
-- The approval type (plan §5): FO/cashier, manager, owner, finance request; owner or manager decide (a manager only when the count is
-- not escalated, enforced in cash_shift_sync); never owner-self.
INSERT INTO public.approval_types (key, label, requester_roles, approver_roles, owner_self) VALUES
  ('cash_shift_variance', 'Selisih kas', '{fo_cashier,manager,owner,finance}', '{owner,manager}', false);--> statement-breakpoint

-- §3: the expectation per tender of a shift (the single place that knows the sources). Payments stamped with the shift (non-simulated,
-- every method incl. top-ups and deposit receipts); cash paid out = clinic DP refunds in cash + cash refunds paid in cash, stamped.
-- Expenses are not drawer money (DEC-097). Returns one row per method present plus cash always.
CREATE FUNCTION public.cash_shift_expected(p_tenant uuid, p_shift uuid,
  OUT method text, OUT payments integer, OUT received bigint, OUT paid_out bigint, OUT expected bigint)
RETURNS SETOF record
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH s AS (SELECT * FROM public.cash_shifts x WHERE x.tenant_id = p_tenant AND x.id = p_shift),
  recv AS (
    SELECT y.method, count(*)::integer AS n, sum(y.amount)::bigint AS amt FROM public.payments y
     WHERE y.tenant_id = p_tenant AND y.shift_id = p_shift AND NOT y.is_simulated GROUP BY y.method),
  outs AS (
    SELECT coalesce((SELECT sum(d.amount) FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.shift_id = p_shift), 0)
         + coalesce((SELECT sum(r.amount) FROM public.refunds r WHERE r.tenant_id = p_tenant AND r.shift_id = p_shift), 0) AS amt),
  methods AS (SELECT 'cash'::text AS m UNION SELECT recv.method FROM recv)
  SELECT m.m, coalesce(recv.n, 0), coalesce(recv.amt, 0)::bigint,
         CASE WHEN m.m = 'cash' THEN (SELECT amt FROM outs)::bigint ELSE 0::bigint END,
         CASE WHEN m.m = 'cash' THEN (SELECT s.opening_float FROM s) + coalesce(recv.amt, 0) - (SELECT amt FROM outs) ELSE coalesce(recv.amt, 0) END::bigint
    FROM methods m LEFT JOIN recv ON recv.method = m.m
   ORDER BY m.m
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_expected(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Buka Kasir (§2): the actor lock first; a branch role at its active branch, owner/finance name one; one open shift per cashier per branch.
CREATE FUNCTION public.cash_shift_open(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  v_branch uuid;
  v_id uuid;
BEGIN
  SELECT x.id INTO v_id FROM public.cash_shifts x WHERE x.tenant_id = a.tenant_id AND x.open_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  v_branch := coalesce(a.branch_id, p_branch);
  IF a.branch_id IS NOT NULL AND p_branch IS NOT NULL AND p_branch <> a.branch_id
     OR v_branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'opening_float' <> '{}'::jsonb OR jsonb_typeof(p -> 'opening_float') IS DISTINCT FROM 'number'
     OR (p ->> 'opening_float') !~ '^\d{1,10}$' OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: opening_float' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_shifts x WHERE x.tenant_id = a.tenant_id AND x.branch_id = v_branch AND x.cashier_id = a.staff_id AND x.state = 'open') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: shift_open' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.cash_shifts (tenant_id, branch_id, cashier_id, cashier_role, state, opening_float, auto_opened, open_key, opened_by, opened_as, opened_at)
  VALUES (a.tenant_id, v_branch, a.staff_id, a.role, 'open', (p ->> 'opening_float')::bigint, false, p_key, a.staff_id, a.role, clock_timestamp())
  RETURNING id INTO v_id;
  PERFORM public.audit_append('money_correction', 'cash_shift', v_id, 'success', 'cash_shift_opened');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_open(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cash_shift_open(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Tutup Kasir / Hitung Ulang (§5, r1 P1-2, P2-4): the lock first; the shift readable (else not found) and the actor its cashier or a
-- manager of its branch (owner decision 3; owner/finance submitting another's shift: forbidden); state open or recount; under the lock the
-- expectation is frozen into the count and its lines; SET-13 read once at v_at; variance 0 → closed; else the reason is required, the
-- approval is requested for the count id first (insert-only count), the shift waits.
CREATE FUNCTION public.cash_shift_submit(p_key text, p_shift uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  s public.cash_shifts;
  v_at timestamptz := clock_timestamp();
  v_count uuid;
  v_seq integer;
  v_exp bigint;
  v_counted bigint;
  v_threshold bigint;
  v_approval uuid;
  v_first boolean;
BEGIN
  SELECT x.id INTO v_count FROM public.cash_shift_counts x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_count IS NOT NULL THEN
    RETURN v_count;
  END IF;
  SELECT * INTO s FROM public.cash_shifts x WHERE x.tenant_id = a.tenant_id AND x.id = p_shift FOR UPDATE;
  IF s.id IS NULL OR NOT public.cash_shift_readable(s.tenant_id, s.branch_id, s.cashier_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: shift not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (s.cashier_id = a.staff_id OR a.role = 'manager' AND a.branch_id = s.branch_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the cashier or a manager of the branch counts this shift' USING ERRCODE = '42501';
  END IF;
  IF s.state = 'pending_approval' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: shift_pending' USING ERRCODE = '55000';
  ELSIF s.state = 'closed' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: shift_closed' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'counted_cash' - 'reason' <> '{}'::jsonb OR jsonb_typeof(p -> 'counted_cash') IS DISTINCT FROM 'number'
     OR (p ->> 'counted_cash') !~ '^\d{1,12}$' OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: counted_cash' USING ERRCODE = '22023';
  END IF;
  v_counted := (p ->> 'counted_cash')::bigint;
  SELECT e.expected INTO v_exp FROM public.cash_shift_expected(s.tenant_id, s.id) e WHERE e.method = 'cash';
  IF v_counted <> v_exp AND length(btrim(coalesce(p ->> 'reason', ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  v_threshold := (public.setting_value_at('SET-13', s.branch_id, v_at) #>> '{}')::bigint;
  v_seq := coalesce((SELECT max(c.seq) FROM public.cash_shift_counts c WHERE c.tenant_id = s.tenant_id AND c.shift_id = s.id), 0) + 1;
  v_first := s.closed_at IS NULL;
  v_count := public.uuid_generate_v7();
  IF v_counted <> v_exp THEN
    v_approval := public.approval_request('cash_shift_variance', 'cash_shift_count', v_count, btrim(p ->> 'reason'), s.branch_id, abs(v_counted - v_exp));
  END IF;
  INSERT INTO public.cash_shift_counts (id, tenant_id, branch_id, shift_id, seq, counted_cash, expected_cash, reason, threshold, approval_id,
                                        command_key, counted_by, counted_as, counted_at)
  VALUES (v_count, s.tenant_id, s.branch_id, s.id, v_seq, v_counted, v_exp, NULLIF(btrim(coalesce(p ->> 'reason', '')), ''), v_threshold, v_approval,
          p_key, a.staff_id, a.role, v_at);
  INSERT INTO public.cash_shift_count_lines (tenant_id, branch_id, count_id, method, payments, received, paid_out, expected, counted)
  SELECT s.tenant_id, s.branch_id, v_count, e.method, e.payments, e.received, e.paid_out, e.expected, CASE WHEN e.method = 'cash' THEN v_counted END
    FROM public.cash_shift_expected(s.tenant_id, s.id) e;
  UPDATE public.cash_shifts SET state = CASE WHEN v_approval IS NULL THEN 'closed' ELSE 'pending_approval' END,
         closed_at = coalesce(closed_at, v_at), settled_at = CASE WHEN v_approval IS NULL THEN v_at END
   WHERE tenant_id = s.tenant_id AND id = s.id;
  IF v_first THEN
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (s.branch_id, 'ShiftClosed', 'cash_shift', s.id, jsonb_build_object('shift_id', s.id, 'count_id', v_count,
            'variance', v_approval IS NOT NULL, 'escalated', abs(v_counted - v_exp) > v_threshold));
  END IF;
  PERFORM public.audit_append('money_correction', 'cash_shift', s.id, 'success', 'cash_shift_counted');
  RETURN v_count;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_submit(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cash_shift_submit(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- r1 P1-2 routing: the decision on the latest count of a waiting shift; a manager may not decide an escalated count (|variance| > SET-13
-- frozen on the count); approved → closed; rejected or cancelled → recount (Hitung Ulang).
CREATE FUNCTION public.cash_shift_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.cash_shift_counts;
  s public.cash_shifts;
BEGIN
  IF NEW.type <> 'cash_shift_variance' OR NEW.subject_kind <> 'cash_shift_count' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM public.cash_shift_counts x WHERE x.tenant_id = NEW.tenant_id AND x.approval_id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM public.cash_shifts x WHERE x.tenant_id = c.tenant_id AND x.id = c.shift_id FOR UPDATE;
  IF s.state <> 'pending_approval' OR c.seq <> (SELECT max(y.seq) FROM public.cash_shift_counts y WHERE y.tenant_id = c.tenant_id AND y.shift_id = c.shift_id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: shift_not_waiting' USING ERRCODE = '55000';
  END IF;
  IF NEW.state IN ('approved','rejected') AND NEW.decided_as = 'manager' AND abs(c.counted_cash - c.expected_cash) > c.threshold THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner may decide this variance' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'approved' THEN
    UPDATE public.cash_shifts SET state = 'closed', settled_at = clock_timestamp() WHERE tenant_id = s.tenant_id AND id = s.id;
  ELSE
    UPDATE public.cash_shifts SET state = 'recount' WHERE tenant_id = s.tenant_id AND id = s.id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_cash_shift_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.cash_shift_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_cash_shift_sync;--> statement-breakpoint

-- The inbox helper (as approval_manager_decides_void/_discount): a manager decides only a count that is not escalated.
CREATE FUNCTION public.approval_manager_decides_shift(p_approval uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT abs(c.counted_cash - c.expected_cash) <= c.threshold
                     FROM public.approvals ap JOIN public.cash_shift_counts c ON c.tenant_id = ap.tenant_id AND c.approval_id = ap.id
                    WHERE ap.tenant_id = public.app_tenant_id() AND ap.id = p_approval AND ap.type = 'cash_shift_variance'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_manager_decides_shift(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_manager_decides_shift(uuid) TO clinic_app;--> statement-breakpoint

-- ── T-085 readers (plan §7; r1 P1-3, P2-2, P2-4) ──
-- The shifts a reader sees: an FO/cashier its own at its active branch; a manager its branch; owner/finance/auditor a named branch or all.
-- No reasons in lists. p_state filters (open | pending_approval | recount | closed).
CREATE FUNCTION public.cash_shift_list(p_branch uuid, p_state text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(p_branch);
BEGIN
  IF p_state IS NOT NULL AND p_state NOT IN ('open','pending_approval','recount','closed') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: state' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'branch_id', a.branch_id, 'staff_id', a.staff_id,
    'can_open', a.role IN ('owner','manager','fo_cashier','finance'),
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name) FROM public.branches b
                           WHERE b.tenant_id = a.tenant_id AND (a.role NOT IN ('manager','fo_cashier') OR b.id = a.branch_id)), '[]'::jsonb),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'branch', jsonb_build_object('id', b.id, 'name', b.name),
                        'cashier', jsonb_build_object('id', st.id, 'name', st.display_name), 'state', s.state, 'auto_opened', s.auto_opened,
                        'opening_float', s.opening_float, 'opened_at', s.opened_at, 'closed_at', s.closed_at, 'settled_at', s.settled_at,
                        'escalated', (SELECT abs(c.counted_cash - c.expected_cash) > c.threshold FROM public.cash_shift_counts c
                                       WHERE c.tenant_id = s.tenant_id AND c.shift_id = s.id ORDER BY c.seq DESC LIMIT 1))
                        ORDER BY s.opened_at DESC)
                       FROM public.cash_shifts s
                       JOIN public.branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
                       JOIN public.staff st ON st.tenant_id = s.tenant_id AND st.id = s.cashier_id
                      WHERE s.tenant_id = a.tenant_id AND (a.branch_id IS NULL OR s.branch_id = a.branch_id)
                        AND (a.role <> 'fo_cashier' OR s.cashier_id = a.staff_id)
                        AND (p_state IS NULL OR s.state = p_state)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_list(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cash_shift_list(uuid, text) TO clinic_app;--> statement-breakpoint

-- One shift (UX-15): the shift; the live expectation while open or in recount, else the latest count's frozen lines; the counts with their
-- approval state and decider (reasons masked for the auditor, r1 P1-3); the payments stamped (patients masked for the auditor; simulated ones
-- never stamped); the cash paid out; K23 (r1 P2-2): received (non-balance real payments − cash paid out) vs sales (vat_base of invoices
-- issued at the branch by the cashier from opened_at to closed_at or now); open tagihan of the branch. Not readable → not found.
CREATE FUNCTION public.cash_shift_get(p_shift uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL);
  s public.cash_shifts;
  v_mask boolean := a.role = 'auditor';
  v_until timestamptz;
  v_out bigint;
BEGIN
  SELECT * INTO s FROM public.cash_shifts x WHERE x.tenant_id = a.tenant_id AND x.id = p_shift
     AND (a.branch_id IS NULL OR x.branch_id = a.branch_id) AND (a.role <> 'fo_cashier' OR x.cashier_id = a.staff_id);
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: shift not found' USING ERRCODE = 'P0002';
  END IF;
  v_until := coalesce(s.closed_at, clock_timestamp());
  SELECT e.paid_out INTO v_out FROM public.cash_shift_expected(s.tenant_id, s.id) e WHERE e.method = 'cash';
  RETURN jsonb_build_object('role', a.role, 'staff_id', a.staff_id,
    'shift', jsonb_build_object('id', s.id, 'branch', (SELECT jsonb_build_object('id', b.id, 'name', b.name) FROM public.branches b WHERE b.tenant_id = s.tenant_id AND b.id = s.branch_id),
      'cashier', (SELECT jsonb_build_object('id', st.id, 'name', st.display_name) FROM public.staff st WHERE st.tenant_id = s.tenant_id AND st.id = s.cashier_id),
      'state', s.state, 'auto_opened', s.auto_opened, 'opening_float', s.opening_float, 'opened_at', s.opened_at, 'closed_at', s.closed_at, 'settled_at', s.settled_at),
    'can_count', s.state IN ('open','recount') AND (s.cashier_id = a.staff_id OR a.role = 'manager'),
    'manager_decides', NOT coalesce((SELECT abs(c.counted_cash - c.expected_cash) > c.threshold FROM public.cash_shift_counts c
                                     WHERE c.tenant_id = s.tenant_id AND c.shift_id = s.id ORDER BY c.seq DESC LIMIT 1), false),
    'threshold', (public.setting_value_at('SET-13', s.branch_id, clock_timestamp()) #>> '{}')::bigint,
    'expected', CASE WHEN s.state IN ('open','recount') THEN
        coalesce((SELECT jsonb_agg(jsonb_build_object('method', e.method, 'payments', e.payments, 'received', e.received, 'paid_out', e.paid_out, 'expected', e.expected)
                                   ORDER BY e.method) FROM public.cash_shift_expected(s.tenant_id, s.id) e), '[]'::jsonb)
      ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('method', l.method, 'payments', l.payments, 'received', l.received, 'paid_out', l.paid_out,
                                   'expected', l.expected, 'counted', l.counted) ORDER BY l.method)
                      FROM public.cash_shift_count_lines l
                     WHERE l.tenant_id = s.tenant_id AND l.count_id = (SELECT c.id FROM public.cash_shift_counts c WHERE c.tenant_id = s.tenant_id AND c.shift_id = s.id
                                                                       ORDER BY c.seq DESC LIMIT 1)), '[]'::jsonb) END,
    'counts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'seq', c.seq, 'counted_cash', c.counted_cash, 'expected_cash', c.expected_cash,
                         'variance', c.counted_cash - c.expected_cash, 'threshold', c.threshold, 'escalated', abs(c.counted_cash - c.expected_cash) > c.threshold,
                         'reason', CASE WHEN v_mask THEN NULL ELSE c.reason END, 'counted_at', c.counted_at, 'counted_as', c.counted_as,
                         'counted_by', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = c.tenant_id AND st.id = c.counted_by),
                         'approval', CASE WHEN ap.id IS NULL THEN NULL ELSE jsonb_build_object('id', ap.id, 'state', ap.state, 'decided_as', ap.decided_as,
                                       'decided_by', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = ap.tenant_id AND st.id = ap.decided_by),
                                       'decision_reason', CASE WHEN v_mask THEN NULL ELSE ap.decision_reason END) END) ORDER BY c.seq)
                        FROM public.cash_shift_counts c LEFT JOIN public.approvals ap ON ap.tenant_id = c.tenant_id AND ap.id = c.approval_id
                       WHERE c.tenant_id = s.tenant_id AND c.shift_id = s.id), '[]'::jsonb),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', y.id, 'method', y.method, 'amount', y.amount, 'received_at', y.received_at,
                           'receipt_id', y.receipt_id, 'invoice_id', y.invoice_id, 'reference', coalesce(y.details ->> 'reference', y.details ->> 'trace', y.details ->> 'approval_code'),
                           'patient', public.kasir_patient_json(y.tenant_id, y.patient_id, v_mask)) ORDER BY y.received_at, y.id)
                          FROM public.payments y WHERE y.tenant_id = s.tenant_id AND y.shift_id = s.id), '[]'::jsonb),
    'k23', jsonb_build_object(
      'received', coalesce((SELECT sum(y.amount) FROM public.payments y WHERE y.tenant_id = s.tenant_id AND y.shift_id = s.id AND y.method <> 'balance'), 0) - coalesce(v_out, 0),
      -- r1 P2-2 (impl review r1 P2-1): the excl.-VAT value less the cancelled share; an auto-opened shift (opened by the payment of an
      -- invoice issued just before) also counts the invoices it took payment for, issued after that cashier's previous close.
      'sales', coalesce((SELECT sum(CASE WHEN l.cancelled_amount = 0 THEN l.vat_base
                                         ELSE (public.tax_vat_split(l.line_total - l.cancelled_amount, l.tax_category, i.is_pkp_at_issue)).base END)
                           FROM public.invoices i JOIN public.invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
                          WHERE i.tenant_id = s.tenant_id AND i.branch_id = s.branch_id AND i.issued_by = s.cashier_id AND i.state = 'issued'
                            AND i.issued_at <= v_until
                            AND (i.issued_at >= s.opened_at
                                 OR s.auto_opened
                                    AND EXISTS (SELECT 1 FROM public.payments y WHERE y.tenant_id = i.tenant_id AND y.shift_id = s.id AND y.invoice_id = i.id)
                                    AND i.issued_at > coalesce((SELECT max(ps.closed_at) FROM public.cash_shifts ps
                                                                 WHERE ps.tenant_id = s.tenant_id AND ps.branch_id = s.branch_id AND ps.cashier_id = s.cashier_id
                                                                   AND ps.id <> s.id AND ps.closed_at <= s.opened_at), '-infinity'::timestamptz))), 0)),
    'open_tagihan', (SELECT jsonb_build_object('count', count(*), 'total', coalesce(sum(public.kasir_outstanding(i.tenant_id, i.id)), 0))
                       FROM public.invoices i WHERE i.tenant_id = s.tenant_id AND i.branch_id = s.branch_id AND i.state = 'issued'
                        AND public.kasir_outstanding(i.tenant_id, i.id) > 0));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cash_shift_get(uuid) TO clinic_app;--> statement-breakpoint

-- The actor's current shift at a branch (the page header): open, waiting or in recount; null when none.
CREATE FUNCTION public.cash_shift_mine(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(p_branch);
BEGIN
  RETURN (SELECT jsonb_build_object('id', s.id, 'state', s.state, 'opened_at', s.opened_at, 'opening_float', s.opening_float, 'auto_opened', s.auto_opened)
            FROM public.cash_shifts s
           WHERE s.tenant_id = a.tenant_id AND s.cashier_id = a.staff_id AND s.state <> 'closed' AND (a.branch_id IS NULL OR s.branch_id = a.branch_id)
           ORDER BY s.opened_at DESC LIMIT 1);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cash_shift_mine(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cash_shift_mine(uuid) TO clinic_app;--> statement-breakpoint

-- ── T-085 re-created functions (latest definitions, edits asserted by recreate.py) ──
-- refund_request (re-created from 0095): the positional refunds row gains the trailing shift_id column (T-085).
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
           btrim(p ->> 'reason'), v_approval, NULL, NULL, NULL, NULL, NULL, a.staff_id, a.role, clock_timestamp(), NULL, NULL, NULL, p_key, NULL, NULL)::public.refunds; -- T-085: + shift_id (stamped at payment)
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
$$;
