CREATE TABLE "instalment_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"due_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"reminded_on" date,
	CONSTRAINT "instalment_rows_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "instalment_rows_seq_key" UNIQUE("tenant_id","schedule_id","seq"),
	CONSTRAINT "instalment_rows_check" CHECK ("instalment_rows"."seq" between 1 and 24 and "instalment_rows"."amount" between 1 and 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "instalment_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"package_id" uuid,
	"receivable_id" uuid,
	"version" integer NOT NULL,
	"base_paid" bigint NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_as" text,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "instalment_schedules_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "instalment_schedules_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "instalment_schedules_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "instalment_schedules_package_version_key" UNIQUE("tenant_id","package_id","version"),
	CONSTRAINT "instalment_schedules_receivable_version_key" UNIQUE("tenant_id","receivable_id","version"),
	CONSTRAINT "instalment_schedules_check" CHECK (num_nonnulls("instalment_schedules"."package_id", "instalment_schedules"."receivable_id") = 1 and "instalment_schedules"."version" >= 1 and "instalment_schedules"."base_paid" >= 0
      and "instalment_schedules"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "instalment_schedules"."created_as" in ('owner','manager','fo_cashier','finance')
      and "instalment_schedules"."state" in ('active','cancelled')
      and (("instalment_schedules"."state" = 'cancelled') = ("instalment_schedules"."cancel_reason" is not null)) and (("instalment_schedules"."state" = 'cancelled') = ("instalment_schedules"."cancelled_at" is not null))
      and ("instalment_schedules"."cancel_reason" is null or "instalment_schedules"."cancel_reason" in ('replaced','target_closed','paid','manual'))
      and ("instalment_schedules"."cancel_reason" is null or "instalment_schedules"."cancel_reason" not in ('manual','replaced') or "instalment_schedules"."cancelled_by" is not null and "instalment_schedules"."cancelled_as" is not null)
      and (("instalment_schedules"."cancelled_by" is null) = ("instalment_schedules"."cancelled_as" is null)))
);
--> statement-breakpoint
ALTER TABLE "instalment_rows" ADD CONSTRAINT "instalment_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_rows" ADD CONSTRAINT "instalment_rows_schedule_fk" FOREIGN KEY ("tenant_id","branch_id","schedule_id") REFERENCES "public"."instalment_schedules"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_schedules" ADD CONSTRAINT "instalment_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_schedules" ADD CONSTRAINT "instalment_schedules_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_schedules" ADD CONSTRAINT "instalment_schedules_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_schedules" ADD CONSTRAINT "instalment_schedules_package_fk" FOREIGN KEY ("tenant_id","package_id") REFERENCES "public"."packages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_schedules" ADD CONSTRAINT "instalment_schedules_receivable_fk" FOREIGN KEY ("tenant_id","receivable_id") REFERENCES "public"."receivables"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_schedules" ADD CONSTRAINT "instalment_schedules_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_schedules" ADD CONSTRAINT "instalment_schedules_cancelled_by_fk" FOREIGN KEY ("tenant_id","cancelled_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instalment_schedules_package_active_key" ON "instalment_schedules" USING btree ("tenant_id","package_id") WHERE "instalment_schedules"."state" = 'active' and "instalment_schedules"."package_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "instalment_schedules_receivable_active_key" ON "instalment_schedules" USING btree ("tenant_id","receivable_id") WHERE "instalment_schedules"."state" = 'active' and "instalment_schedules"."receivable_id" is not null;--> statement-breakpoint

-- T-083 rules (generated by gen.py; plan docs/tasks/T-083.md)
-- ── T-083 helpers (plan §4, review r1) ──
-- The paid and open amounts of a schedule's target (r1 P1-1): a package → the real money on its invoice line (kasir_line_paid,
-- ≤ price; not package_paid, which subtracts a cheaper substitution's moved value); a receivable → its collected amount.
CREATE FUNCTION public.instalment_target_paid(p_tenant uuid, p_package uuid, p_receivable uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_package IS NOT NULL
    THEN (SELECT public.kasir_line_paid(pk.tenant_id, pk.invoice_line_id) FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.id = p_package)
    ELSE (SELECT r.collected_amount FROM public.receivables r WHERE r.tenant_id = p_tenant AND r.id = p_receivable) END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_target_paid(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.instalment_target_total(p_tenant uuid, p_package uuid, p_receivable uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_package IS NOT NULL
    THEN (SELECT pk.price FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.id = p_package)
    ELSE (SELECT r.amount - r.written_off_amount FROM public.receivables r WHERE r.tenant_id = p_tenant AND r.id = p_receivable) END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_target_total(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Whether the target is still open for a schedule: an active package not fully paid, an open receivable.
CREATE FUNCTION public.instalment_target_open(p_tenant uuid, p_package uuid, p_receivable uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_package IS NOT NULL
    THEN coalesce((SELECT pk.state = 'active' FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.id = p_package), false)
    ELSE coalesce((SELECT r.state = 'open' FROM public.receivables r WHERE r.tenant_id = p_tenant AND r.id = p_receivable), false) END
    AND public.instalment_target_paid(p_tenant, p_package, p_receivable) < public.instalment_target_total(p_tenant, p_package, p_receivable)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_target_open(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Cancel the active schedule of a target (a service step: the trigger of a closing or fully paid target). The actor is the session's
-- when bound, otherwise null (an unbound scan or webhook); the reason is target_closed or paid. A no-op when none is active.
CREATE FUNCTION public.instalment_cancel_for(p_tenant uuid, p_package uuid, p_receivable uuid, p_reason text) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  UPDATE public.instalment_schedules SET state = 'cancelled', cancel_reason = p_reason, cancelled_at = clock_timestamp(),
         cancelled_by = public.app_staff_id(), cancelled_as = public.app_acting_role()
   WHERE tenant_id = p_tenant AND state = 'active'
     AND (p_package IS NOT NULL AND package_id = p_package OR p_receivable IS NOT NULL AND receivable_id = p_receivable)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_cancel_for(uuid, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.instalment_schedules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY instalment_schedules_read ON public.instalment_schedules FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.kasir_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.instalment_schedules TO clinic_app;--> statement-breakpoint
CREATE POLICY instalment_schedules_operator_read ON public.instalment_schedules FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.instalment_schedules', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.instalment_schedules TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER instalment_schedules_no_truncate BEFORE TRUNCATE ON public.instalment_schedules FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.instalment_schedules ENABLE ALWAYS TRIGGER instalment_schedules_no_truncate;--> statement-breakpoint
ALTER TABLE public.instalment_rows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY instalment_rows_read ON public.instalment_rows FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.kasir_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.instalment_rows TO clinic_app;--> statement-breakpoint
CREATE POLICY instalment_rows_operator_read ON public.instalment_rows FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.instalment_rows', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.instalment_rows TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER instalment_rows_no_truncate BEFORE TRUNCATE ON public.instalment_rows FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.instalment_rows ENABLE ALWAYS TRIGGER instalment_rows_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.instalment_schedules', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'instalment schedule definers (src/modules/packages/schedules)', 'the target''s branch'),
  ('public.instalment_rows', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'instalment schedule definers (src/modules/packages/schedules)', 'the target''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): schedules and rows are personal (a patient's agreement).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.instalment_schedules', 'personal'),
  ('public.instalment_rows', 'personal');--> statement-breakpoint

-- ── T-083 guards (staff_access first; never deleted) ──
-- Schedules: inserted active as the next version of their target; identity frozen; only active → cancelled once (with its reason).
CREATE FUNCTION public.instalment_schedules_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'instalment schedules are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'active' OR NEW.version <> 1 + coalesce((SELECT max(x.version) FROM public.instalment_schedules x WHERE x.tenant_id = NEW.tenant_id
         AND (NEW.package_id IS NOT NULL AND x.package_id = NEW.package_id OR NEW.receivable_id IS NOT NULL AND x.receivable_id = NEW.receivable_id)), 0) THEN
      RAISE EXCEPTION 'a schedule opens active as the next version of its target' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.package_id, NEW.receivable_id, NEW.version, NEW.base_paid, NEW.command_key,
      NEW.created_by, NEW.created_as, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.package_id, OLD.receivable_id, OLD.version, OLD.base_paid, OLD.command_key,
      OLD.created_by, OLD.created_as, OLD.created_at)
     OR NOT (OLD.state = 'active' AND NEW.state = 'cancelled') THEN
    RAISE EXCEPTION 'a schedule keeps its terms; it is cancelled once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_schedules_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER instalment_schedules_guard BEFORE INSERT OR UPDATE OR DELETE ON public.instalment_schedules FOR EACH ROW EXECUTE FUNCTION public.instalment_schedules_guard();--> statement-breakpoint
ALTER TABLE public.instalment_schedules ENABLE ALWAYS TRIGGER instalment_schedules_guard;--> statement-breakpoint

-- Rows: inserted with their schedule (still active, nothing reminded); frozen except reminded_on, set once while the schedule is active.
CREATE FUNCTION public.instalment_rows_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'instalment rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.instalment_schedules s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.schedule_id AND s.state = 'active') THEN
    RAISE EXCEPTION 'instalment rows change only on an active schedule' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.reminded_on IS NOT NULL THEN
      RAISE EXCEPTION 'a row opens not reminded' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.schedule_id, NEW.seq, NEW.due_on, NEW.amount)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.schedule_id, OLD.seq, OLD.due_on, OLD.amount)
     OR OLD.reminded_on IS NOT NULL OR NEW.reminded_on IS NULL THEN
    RAISE EXCEPTION 'a row keeps its terms; it is reminded once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_rows_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER instalment_rows_guard BEFORE INSERT OR UPDATE OR DELETE ON public.instalment_rows FOR EACH ROW EXECUTE FUNCTION public.instalment_rows_guard();--> statement-breakpoint
ALTER TABLE public.instalment_rows ENABLE ALWAYS TRIGGER instalment_rows_guard;--> statement-breakpoint

-- ── T-083 writers and reader (plan §4.2, §4.5; review r1 P2-3) ──
-- Jadwal Cicilan: owner, manager, FO/cashier, finance (Paket & Saldo / Piutang actors); branch roles at the target's branch. p: {package_id |
-- receivable_id, rows: [{due_on, amount}] 1..24}. Locks: staff_access → the target row → its active schedule. The rows cover the open amount
-- (sum ≤ total − paid now; the paid now is stored as base_paid), due dates strictly increasing, the first ≥ today (branch-local), at most
-- SET-41 cicilan_maks rows when set. A previous active schedule is replaced (version + 1). Replay by key returns the schedule when the target
-- and rows match, else ERR_IDEMPOTENCY_CONFLICT. Nothing of money moves: no receivable, journal, interest, entitlement (BILL-9).
CREATE FUNCTION public.instalment_schedule_set(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_pkg uuid;
  v_rcv uuid;
  v_branch uuid;
  v_patient uuid;
  v_paid bigint;
  v_total bigint;
  v_sum bigint;
  v_n integer;
  v_max integer;
  v_today date;
  v_id uuid;
  v_prev public.instalment_schedules;
  ex public.instalment_schedules;
  pk public.packages;
  r public.receivables;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','manager','fo_cashier','finance') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not set an instalment schedule' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the cashier is not available now' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'package_id' - 'receivable_id' - 'rows' <> '{}'::jsonb
     OR (p ? 'package_id') = (p ? 'receivable_id')
     OR coalesce(p ->> 'package_id', p ->> 'receivable_id', '') !~ '^[0-9a-fA-F-]{36}$'
     OR jsonb_typeof(p -> 'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'rows') NOT BETWEEN 1 AND 24
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'rows') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'due_on' - 'amount' <> '{}'::jsonb
                  OR coalesce(x ->> 'due_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
                  OR jsonb_typeof(x -> 'amount') IS DISTINCT FROM 'number' OR (x ->> 'amount') !~ '^\d{1,13}$' OR (x ->> 'amount')::bigint < 1)
     OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: schedule' USING ERRCODE = '22023';
  END IF;
  v_pkg := (p ->> 'package_id')::uuid;
  v_rcv := (p ->> 'receivable_id')::uuid;
  -- replay by key
  SELECT * INTO ex FROM public.instalment_schedules x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF ex.id IS NOT NULL THEN
    IF ex.package_id IS NOT DISTINCT FROM v_pkg AND ex.receivable_id IS NOT DISTINCT FROM v_rcv
       AND (SELECT jsonb_agg(jsonb_build_object('due_on', w.due_on, 'amount', w.amount) ORDER BY w.seq) FROM public.instalment_rows w WHERE w.tenant_id = ex.tenant_id AND w.schedule_id = ex.id)
           = (SELECT jsonb_agg(jsonb_build_object('due_on', (x ->> 'due_on')::date, 'amount', (x ->> 'amount')::bigint) ORDER BY o) FROM jsonb_array_elements(p -> 'rows') WITH ORDINALITY t(x, o)) THEN
      RETURN ex.id;
    END IF;
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: schedule' USING ERRCODE = '23505';
  END IF;
  -- the target, locked
  IF v_pkg IS NOT NULL THEN
    SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = a.tenant_id AND x.id = v_pkg FOR UPDATE;
    IF pk.id IS NULL OR a.branch_id IS NOT NULL AND a.role IN ('manager','fo_cashier') AND pk.sold_branch_id <> a.branch_id THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: package not found' USING ERRCODE = 'P0002';
    END IF;
    IF pk.state <> 'active' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: target_closed' USING ERRCODE = '55000';
    END IF;
    IF pk.min_dp = pk.price THEN -- a package that must be paid in full takes no schedule (package_open: no instalments)
      RAISE EXCEPTION 'ERR_INVALID_INPUT: instalments_not_allowed' USING ERRCODE = '22023';
    END IF;
    v_branch := pk.sold_branch_id; v_patient := pk.patient_id;
  ELSE
    SELECT * INTO r FROM public.receivables x WHERE x.tenant_id = a.tenant_id AND x.id = v_rcv FOR UPDATE;
    IF r.id IS NULL OR a.role IN ('manager','fo_cashier') AND r.branch_id <> a.branch_id THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: receivable not found' USING ERRCODE = 'P0002';
    END IF;
    IF r.state <> 'open' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: target_closed' USING ERRCODE = '55000';
    END IF;
    v_branch := r.branch_id; v_patient := r.patient_id;
  END IF;
  v_paid := public.instalment_target_paid(a.tenant_id, v_pkg, v_rcv);
  v_total := public.instalment_target_total(a.tenant_id, v_pkg, v_rcv);
  IF v_paid >= v_total THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: target_paid' USING ERRCODE = '55000';
  END IF;
  -- the rows: increasing dates, the first ≥ today, the sum within the open amount, at most SET-41 cicilan_maks
  v_today := public.safety_today(a.tenant_id, v_branch);
  v_n := jsonb_array_length(p -> 'rows');
  v_sum := (SELECT sum((x ->> 'amount')::bigint) FROM jsonb_array_elements(p -> 'rows') x);
  v_max := NULLIF(public.setting_value_at('SET-41', NULL, clock_timestamp()) ->> 'cicilan_maks', '')::integer;
  BEGIN
    IF EXISTS (SELECT 1 FROM (SELECT (x ->> 'due_on')::date d, lag((x ->> 'due_on')::date) OVER (ORDER BY o) prev
                                FROM jsonb_array_elements(p -> 'rows') WITH ORDINALITY t(x, o)) q WHERE q.prev IS NOT NULL AND q.d <= q.prev)
       OR ((p -> 'rows' -> 0 ->> 'due_on')::date) < v_today THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: schedule_dates' USING ERRCODE = '22023';
    END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: schedule_dates' USING ERRCODE = '22023';
  END;
  IF v_sum > v_total - v_paid THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: schedule_above_open' USING ERRCODE = '22023';
  END IF;
  IF v_max IS NOT NULL AND v_n > v_max THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: schedule_too_many_rows' USING ERRCODE = '22023';
  END IF;
  -- replace the active one (version + 1)
  SELECT * INTO v_prev FROM public.instalment_schedules x WHERE x.tenant_id = a.tenant_id AND x.state = 'active'
     AND (v_pkg IS NOT NULL AND x.package_id = v_pkg OR v_rcv IS NOT NULL AND x.receivable_id = v_rcv) FOR UPDATE;
  IF v_prev.id IS NOT NULL THEN
    UPDATE public.instalment_schedules SET state = 'cancelled', cancel_reason = 'replaced', cancelled_at = clock_timestamp(), cancelled_by = a.staff_id, cancelled_as = a.role
     WHERE tenant_id = v_prev.tenant_id AND id = v_prev.id;
  END IF;
  INSERT INTO public.instalment_schedules (tenant_id, branch_id, patient_id, package_id, receivable_id, version, base_paid, command_key, created_by, created_as)
  VALUES (a.tenant_id, v_branch, public.patient_canonical(a.tenant_id, v_patient), v_pkg, v_rcv,
          1 + coalesce((SELECT max(x.version) FROM public.instalment_schedules x WHERE x.tenant_id = a.tenant_id
                         AND (v_pkg IS NOT NULL AND x.package_id = v_pkg OR v_rcv IS NOT NULL AND x.receivable_id = v_rcv)), 0),
          v_paid, p_key, a.staff_id, a.role)
  RETURNING id INTO v_id;
  INSERT INTO public.instalment_rows (tenant_id, branch_id, schedule_id, seq, due_on, amount)
  SELECT a.tenant_id, v_branch, v_id, o::smallint, (x ->> 'due_on')::date, (x ->> 'amount')::bigint
    FROM jsonb_array_elements(p -> 'rows') WITH ORDINALITY t(x, o);
  PERFORM public.audit_append('settings_change', 'instalment_schedule', v_id, 'success', 'instalment_schedule_set');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_schedule_set(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.instalment_schedule_set(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Batalkan Jadwal (r1 P2-3: no key in SQL): the same actors; a no-op when already cancelled manually, a conflict when cancelled otherwise.
CREATE FUNCTION public.instalment_schedule_cancel(p_schedule uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  s public.instalment_schedules;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','manager','fo_cashier','finance') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not cancel an instalment schedule' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the cashier is not available now' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.instalment_schedules x WHERE x.tenant_id = a.tenant_id AND x.id = p_schedule FOR UPDATE;
  IF s.id IS NULL OR a.role IN ('manager','fo_cashier') AND s.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: schedule not found' USING ERRCODE = 'P0002';
  END IF;
  IF s.state = 'cancelled' THEN
    IF s.cancel_reason = 'manual' THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: schedule_closed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.instalment_schedules SET state = 'cancelled', cancel_reason = 'manual', cancelled_at = clock_timestamp(), cancelled_by = a.staff_id, cancelled_as = a.role
   WHERE tenant_id = s.tenant_id AND id = s.id;
  PERFORM public.audit_append('settings_change', 'instalment_schedule', s.id, 'success', 'instalment_schedule_cancelled');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_schedule_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.instalment_schedule_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- Jadwal Cicilan reader (plan §4.5, r1 P3): the Kasir readers; per version its rows with covered / overdue / reminded and the derived
-- linked payments (real allocations whose cumulative interval overlaps the row's), the target's paid and open amounts.
CREATE FUNCTION public.instalment_schedule_get(p_package uuid, p_receivable uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_branch uuid;
  v_paid bigint;
  v_total bigint;
BEGIN
  SELECT * INTO a FROM public.kasir_reader(NULL::uuid); -- the actor lock first (review r1 P2-2)
  IF (p_package IS NULL) = (p_receivable IS NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: schedule_target' USING ERRCODE = '22023';
  END IF;
  IF p_package IS NOT NULL THEN
    SELECT pk.sold_branch_id INTO v_branch FROM public.packages pk WHERE pk.tenant_id = a.tenant_id AND pk.id = p_package;
  ELSE
    SELECT r.branch_id INTO v_branch FROM public.receivables r WHERE r.tenant_id = a.tenant_id AND r.id = p_receivable;
  END IF;
  IF v_branch IS NULL OR a.role IN ('manager','fo_cashier') AND v_branch <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: target not found' USING ERRCODE = 'P0002';
  END IF;
  v_paid := public.instalment_target_paid(a.tenant_id, p_package, p_receivable);
  v_total := public.instalment_target_total(a.tenant_id, p_package, p_receivable);
  RETURN jsonb_build_object('paid', v_paid, 'open', greatest(0, v_total - v_paid),
    'today', public.safety_today(a.tenant_id, v_branch),
    'can_set', a.role IN ('owner','manager','fo_cashier','finance'),
    'schedules', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'version', s.version, 'state', s.state, 'cancel_reason', s.cancel_reason,
        'base_paid', s.base_paid, 'created_at', s.created_at,
        'rows', (SELECT jsonb_agg(jsonb_build_object('seq', q.seq, 'due_on', q.due_on, 'amount', q.amount, 'reminded_on', q.reminded_on,
                   'covered', v_paid - s.base_paid >= q.cum,
                   'overdue', s.state = 'active' AND q.due_on < public.safety_today(a.tenant_id, v_branch) AND v_paid - s.base_paid < q.cum,
                   'linked_payments', coalesce((
                      SELECT jsonb_agg(DISTINCT z.payment_id) FROM (
                        SELECT al.payment_id, sum(al.amount) OVER (ORDER BY al.created_at, al.id) AS c, al.amount
                          FROM public.payment_allocations al
                         WHERE al.tenant_id = a.tenant_id AND NOT al.is_simulated
                           AND (p_package IS NOT NULL AND al.invoice_line_id = (SELECT pk.invoice_line_id FROM public.packages pk WHERE pk.tenant_id = a.tenant_id AND pk.id = p_package)
                                OR p_receivable IS NOT NULL AND al.receivable_id = p_receivable)) z
                       WHERE z.c > s.base_paid + q.cum - q.amount AND z.c - z.amount < s.base_paid + q.cum), '[]'::jsonb))
                   ORDER BY q.seq)
                 FROM (SELECT w.*, sum(w.amount) OVER (ORDER BY w.seq) AS cum FROM public.instalment_rows w WHERE w.tenant_id = s.tenant_id AND w.schedule_id = s.id) q))
      ORDER BY s.version DESC)
      FROM public.instalment_schedules s WHERE s.tenant_id = a.tenant_id
       AND (p_package IS NOT NULL AND s.package_id = p_package OR p_receivable IS NOT NULL AND s.receivable_id = p_receivable)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_schedule_get(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.instalment_schedule_get(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- ── T-083 automatic cancellation (DATA-67; r1 P1-2): the target closes, expires or is fully paid → its active schedule is cancelled ──
-- A package leaving active (cancel, expiry, void): target_closed.
CREATE FUNCTION public.instalment_package_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.state = 'active' AND NEW.state <> 'active' THEN
    PERFORM public.instalment_cancel_for(NEW.tenant_id, NEW.id, NULL, 'target_closed');
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_package_closed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER packages_instalment_closed AFTER UPDATE OF state ON public.packages FOR EACH ROW EXECUTE FUNCTION public.instalment_package_closed();--> statement-breakpoint
ALTER TABLE public.packages ENABLE ALWAYS TRIGGER packages_instalment_closed;--> statement-breakpoint

-- A receivable leaving open: collected → paid; written off → target_closed.
CREATE FUNCTION public.instalment_receivable_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.state = 'open' AND NEW.state <> 'open' THEN
    PERFORM public.instalment_cancel_for(NEW.tenant_id, NULL, NEW.id, CASE WHEN NEW.state = 'collected' THEN 'paid' ELSE 'target_closed' END);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_receivable_closed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER receivables_instalment_closed AFTER UPDATE OF state ON public.receivables FOR EACH ROW EXECUTE FUNCTION public.instalment_receivable_closed();--> statement-breakpoint
ALTER TABLE public.receivables ENABLE ALWAYS TRIGGER receivables_instalment_closed;--> statement-breakpoint

-- A package fully paid without a state change (r1 P1-2): a real allocation to its line that brings the paid value to the price.
-- Runs inside the payment writers (staff_access, invoice and line already locked): the schedule row is a leaf lock.
CREATE FUNCTION public.instalment_package_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk public.packages;
BEGIN
  IF NEW.invoice_line_id IS NULL OR NEW.is_simulated THEN
    RETURN NULL;
  END IF;
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = NEW.tenant_id AND x.invoice_line_id = NEW.invoice_line_id;
  IF pk.id IS NOT NULL AND public.kasir_line_paid(pk.tenant_id, pk.invoice_line_id) >= pk.price THEN
    PERFORM public.instalment_cancel_for(pk.tenant_id, pk.id, NULL, 'paid');
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_package_paid() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payment_allocations_instalment_paid AFTER INSERT ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.instalment_package_paid();--> statement-breakpoint
ALTER TABLE public.payment_allocations ENABLE ALWAYS TRIGGER payment_allocations_instalment_paid;--> statement-breakpoint

-- ── T-083 the reminder (scenario PR-96; plan §4.4, r1 P1-2) ──
-- Unbound worker only (as logbook_due_scan). Per candidate schedule: staff_access of its tenant first (as package_expiry_scan), then
-- the schedule and its rows locked, then everything re-checked under the lock. An active schedule whose target is no longer open is
-- cancelled (the backstop of the triggers); otherwise each row due before today (branch-local), not reminded and not covered
-- (paid − base_paid < its cumulative amount) is marked reminded today and raises one instalment_due notification for FO/cashier at
-- the target's branch (ids only). Returns the number of reminders raised.
CREATE FUNCTION public.instalment_reminder_scan(p_today date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
  s public.instalment_schedules;
  r record;
  v_today date;
  v_paid bigint;
  v_n integer := 0;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'instalment_reminder_scan runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  FOR c IN SELECT x.tenant_id, x.id FROM public.instalment_schedules x
             JOIN public.tenants_registry t ON t.id = x.tenant_id AND t.lifecycle_state IN ('onboarding','live','suspended')
            WHERE x.state = 'active' ORDER BY x.tenant_id, x.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || c.tenant_id::text, 0));
    SELECT * INTO s FROM public.instalment_schedules x WHERE x.tenant_id = c.tenant_id AND x.id = c.id FOR UPDATE;
    CONTINUE WHEN s.state <> 'active';
    IF NOT public.instalment_target_open(s.tenant_id, s.package_id, s.receivable_id) THEN
      PERFORM public.instalment_cancel_for(s.tenant_id, s.package_id, s.receivable_id,
        CASE WHEN public.instalment_target_paid(s.tenant_id, s.package_id, s.receivable_id)
                  >= public.instalment_target_total(s.tenant_id, s.package_id, s.receivable_id) THEN 'paid' ELSE 'target_closed' END);
      CONTINUE;
    END IF;
    v_today := coalesce(p_today, public.safety_today(s.tenant_id, s.branch_id));
    v_paid := public.instalment_target_paid(s.tenant_id, s.package_id, s.receivable_id) - s.base_paid;
    PERFORM 1 FROM public.instalment_rows x WHERE x.tenant_id = s.tenant_id AND x.schedule_id = s.id ORDER BY x.seq FOR UPDATE;
    FOR r IN SELECT x.id, x.due_on, x.reminded_on, sum(x.amount) OVER (ORDER BY x.seq) AS cum
               FROM public.instalment_rows x WHERE x.tenant_id = s.tenant_id AND x.schedule_id = s.id ORDER BY x.seq LOOP
      CONTINUE WHEN r.due_on >= v_today OR r.reminded_on IS NOT NULL OR v_paid >= r.cum;
      UPDATE public.instalment_rows SET reminded_on = v_today WHERE tenant_id = s.tenant_id AND id = r.id AND reminded_on IS NULL;
      INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id)
      VALUES (s.tenant_id, 'instalment_due', 'fo_cashier', s.branch_id, 'instalment_schedule', s.id);
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.instalment_reminder_scan(date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.instalment_reminder_scan(date) TO clinic_app;--> statement-breakpoint

-- The alert type (system-only, ids only): FO/cashier at the target's branch when an agreed instalment is overdue (scenario PR-96).
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('instalment_due', 'Cicilan lewat jatuh tempo', '{fo_cashier}', '{instalment_schedule}', false);
