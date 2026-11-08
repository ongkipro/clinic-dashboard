CREATE TABLE "staff_leave" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	CONSTRAINT "staff_leave_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_leave_kind_check" CHECK ("staff_leave"."kind" in ('leave','sick','absent')),
	CONSTRAINT "staff_leave_range_check" CHECK ("staff_leave"."from_date" <= "staff_leave"."to_date" and "staff_leave"."to_date" - "staff_leave"."from_date" <= 366),
	CONSTRAINT "staff_leave_reason_check" CHECK (length(btrim("staff_leave"."reason")) between 3 and 500),
	CONSTRAINT "staff_leave_cancel_check" CHECK (("staff_leave"."cancelled_at" is null and "staff_leave"."cancelled_by" is null and "staff_leave"."cancel_reason" is null)
      or ("staff_leave"."cancelled_at" is not null and "staff_leave"."cancelled_by" is not null and "staff_leave"."cancel_reason" is not null and length(btrim("staff_leave"."cancel_reason")) between 3 and 500))
);
--> statement-breakpoint
CREATE TABLE "staff_shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"starts" time NOT NULL,
	"ends" time NOT NULL,
	"kind" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "staff_shifts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_shifts_kind_check" CHECK ("staff_shifts"."kind" in ('work','break')),
	CONSTRAINT "staff_shifts_range_check" CHECK ("staff_shifts"."starts" < "staff_shifts"."ends")
);
--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_tenant_id_cancelled_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cancelled_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_leave_branch_idx" ON "staff_leave" USING btree ("tenant_id","branch_id","from_date");--> statement-breakpoint
CREATE INDEX "staff_shifts_branch_date_idx" ON "staff_shifts" USING btree ("tenant_id","branch_id","shift_date");--> statement-breakpoint
CREATE INDEX "staff_shifts_staff_date_idx" ON "staff_shifts" USING btree ("tenant_id","staff_id","shift_date");;--> statement-breakpoint

-- T-043 rules (generated; see header)
-- T-043 (PR-48, DATA-16, UX-33; plan docs/tasks/T-043.md, DEC-053): staff schedules per branch. Owner,
-- Admin Pusat and the manager of a branch (07 "Staff schedules", branch_authorize operational) write;
-- the booking roles read shifts at their branches; leave (kind and reason can be health-related) is read
-- only by the writers and the staff themselves; booking roles get availability through definers.

-- ── Readers ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.staff_shifts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_shifts_read ON public.staff_shifts FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (staff_id = public.app_staff_id()
              OR public.app_role_in(ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs','bc','doctor','nurse','therapist']) AND public.app_branch_allowed(branch_id)));--> statement-breakpoint
GRANT SELECT ON public.staff_shifts TO clinic_app;--> statement-breakpoint
ALTER TABLE public.staff_leave ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_leave_read ON public.staff_leave FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (staff_id = public.app_staff_id()
              OR public.app_role_in(ARRAY['owner','admin_pusat','manager']) AND public.app_branch_allowed(branch_id)));--> statement-breakpoint
GRANT SELECT ON public.staff_leave TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.staff_shifts', 'branch-scoped', 'scheduling', '{owner,admin_pusat,manager,fo_cashier,central_cs,bc,doctor,nurse,therapist,self}', 'roster_set_week (src/modules/scheduling/rosters)', 'branch of the shift'),
  ('public.staff_leave', 'branch-scoped', 'scheduling', '{owner,admin_pusat,manager,self}', 'leave_add, leave_cancel (src/modules/scheduling/rosters)', 'branch of the leave');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): shifts are configuration; leave can be health-related.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.staff_shifts', 'config'), ('public.staff_leave', 'personal');--> statement-breakpoint
CREATE POLICY staff_shifts_operator_read ON public.staff_shifts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_shifts', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_shifts TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_leave_operator_read ON public.staff_leave FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_leave', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_leave TO clinic_operator;--> statement-breakpoint

-- ── Time helpers ────────────────────────────────────────────────────────────────────────────
-- The instant a branch-local date and time denote; "24:00" (stored as 23:59:59.999999) is the next midnight.
CREATE FUNCTION public.roster_instant(p_date date, p_time time, p_tz text) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_time = time '23:59:59.999999' THEN (p_date + 1)::timestamp ELSE p_date + p_time END AT TIME ZONE p_tz
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.roster_instant(date, time, text) FROM PUBLIC;--> statement-breakpoint
-- Today in a branch's timezone, on the wall clock.
CREATE FUNCTION public.roster_today(p_tenant uuid, p_branch uuid) RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (clock_timestamp() AT TIME ZONE b.timezone)::date FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = p_branch
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.roster_today(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- ── Guards (plan r1 P1-1, P1-4; r2 (a)) ─────────────────────────────────────────────────────
-- Row guard: shifts are inserted or deleted (never updated), only from today in branch time. The
-- tenant's staff_access lock first (a no-op from the writers) keeps the lock order for direct SQL.
CREATE FUNCTION public.staff_shifts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.staff_shifts := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a shift is replaced, never edited' USING ERRCODE = '42501';
  END IF;
  IF r.shift_date < public.roster_today(r.tenant_id, r.branch_id) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: shift_past' USING ERRCODE = '22023';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;--> statement-breakpoint
CREATE TRIGGER staff_shifts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.staff_shifts FOR EACH ROW EXECUTE FUNCTION public.staff_shifts_guard();--> statement-breakpoint
ALTER TABLE public.staff_shifts ENABLE ALWAYS TRIGGER staff_shifts_guard;--> statement-breakpoint
CREATE TRIGGER staff_shifts_no_truncate BEFORE TRUNCATE ON public.staff_shifts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.staff_shifts ENABLE ALWAYS TRIGGER staff_shifts_no_truncate;--> statement-breakpoint

-- Structural check after each statement (all rows applied): for every staff member touched, work
-- shifts never overlap as instants across branches; each break lies inside a work shift of the same
-- staff, branch and date; breaks never overlap.
CREATE FUNCTION public.staff_shifts_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_bad text;
BEGIN
  WITH touched AS (
         SELECT DISTINCT tenant_id, staff_id, shift_date FROM changed
       ),
       s AS (
         SELECT x.*, public.roster_instant(x.shift_date, x.starts, b.timezone) AS a, public.roster_instant(x.shift_date, x.ends, b.timezone) AS z
           FROM public.staff_shifts x
           JOIN public.branches b ON b.tenant_id = x.tenant_id AND b.id = x.branch_id
          WHERE EXISTS (SELECT 1 FROM touched t WHERE t.tenant_id = x.tenant_id AND t.staff_id = x.staff_id
                          AND x.shift_date BETWEEN t.shift_date - 1 AND t.shift_date + 1)
       )
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM s s1 JOIN s s2 ON s2.tenant_id = s1.tenant_id AND s2.staff_id = s1.staff_id AND s2.id > s1.id
                         WHERE s1.kind = 'work' AND s2.kind = 'work' AND s1.a < s2.z AND s2.a < s1.z) THEN 'shift_overlap'
           WHEN EXISTS (SELECT 1 FROM s br WHERE br.kind = 'break' AND NOT EXISTS (
                          SELECT 1 FROM s w WHERE w.kind = 'work' AND w.tenant_id = br.tenant_id AND w.staff_id = br.staff_id
                            AND w.branch_id = br.branch_id AND w.shift_date = br.shift_date AND w.starts <= br.starts AND br.ends <= w.ends)) THEN 'break_outside_shift'
           WHEN EXISTS (SELECT 1 FROM s s1 JOIN s s2 ON s2.tenant_id = s1.tenant_id AND s2.staff_id = s1.staff_id AND s2.id > s1.id
                         WHERE s1.kind = 'break' AND s2.kind = 'break' AND s1.a < s2.z AND s2.a < s1.z) THEN 'break_overlap'
         END INTO v_bad;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: %', v_bad USING ERRCODE = '22023';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER staff_shifts_check_ins AFTER INSERT ON public.staff_shifts REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.staff_shifts_check();--> statement-breakpoint
CREATE TRIGGER staff_shifts_check_del AFTER DELETE ON public.staff_shifts REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.staff_shifts_check();--> statement-breakpoint
ALTER TABLE public.staff_shifts ENABLE ALWAYS TRIGGER staff_shifts_check_ins;--> statement-breakpoint
ALTER TABLE public.staff_shifts ENABLE ALWAYS TRIGGER staff_shifts_check_del;--> statement-breakpoint

-- Leave: never deleted; added from today; the only change is a single cancellation while it has not started.
CREATE FUNCTION public.staff_leave_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_today date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'leave is cancelled, never deleted' USING ERRCODE = '42501';
  END IF;
  v_today := public.roster_today(NEW.tenant_id, NEW.branch_id);
  IF TG_OP = 'INSERT' THEN
    IF NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'leave is recorded active; cancellation is a later change' USING ERRCODE = '42501';
    END IF;
    IF NEW.from_date < v_today THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: leave_past' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.staff_id, NEW.kind, NEW.from_date, NEW.to_date, NEW.reason, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.staff_id, OLD.kind, OLD.from_date, OLD.to_date, OLD.reason, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'leave is never edited; cancel it and add another' USING ERRCODE = '42501';
  END IF;
  IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'a leave is cancelled once' USING ERRCODE = '42501';
  END IF;
  IF OLD.from_date < v_today THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: leave_past' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER staff_leave_guard BEFORE INSERT OR UPDATE OR DELETE ON public.staff_leave FOR EACH ROW EXECUTE FUNCTION public.staff_leave_guard();--> statement-breakpoint
ALTER TABLE public.staff_leave ENABLE ALWAYS TRIGGER staff_leave_guard;--> statement-breakpoint
CREATE TRIGGER staff_leave_no_truncate BEFORE TRUNCATE ON public.staff_leave FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.staff_leave ENABLE ALWAYS TRIGGER staff_leave_no_truncate;--> statement-breakpoint

-- A staff member on the roster of a branch: active membership on the wall clock and assigned there.
CREATE FUNCTION public.roster_staff_at(p_tenant uuid, p_staff uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
     WHERE s.tenant_id = p_tenant AND s.id = p_staff
       AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
       AND EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = p_tenant AND sb.staff_id = p_staff AND sb.branch_id = p_branch))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.roster_staff_at(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- One audit row and one RosterChanged event (ids and codes only, no null values) per change.
CREATE FUNCTION public.roster_changed(p_branch uuid, p_change text, p_object_kind text, p_object uuid, p_extra jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.audit_append('settings_change', p_object_kind, p_object, 'success', p_change);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (p_branch, 'RosterChanged', p_object_kind, p_object, jsonb_build_object('branch_id', p_branch, 'change', p_change) || p_extra);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.roster_changed(uuid, text, text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint

-- ── roster_set_week (UX-33 Simpan Jadwal) ───────────────────────────────────────────────────
-- Replaces, for the staff listed in p_staff (the ones the editor shows), their shifts at the branch for
-- the ISO week starting p_week (a Monday) from today on; other staff keep theirs (impl review r1 P1: a
-- role-filtered save must not wipe other roles). p_rows (each for a listed staff member):
-- [{"staff_id", "date", "starts", "ends" ("24:00" allowed), "kind" (work|break)}]. Conflicts with booked
-- appointments are T-044's check (contract: ERR_VERSION_CONFLICT: appointment_conflict).
CREATE FUNCTION public.roster_set_week(p_branch uuid, p_week date, p_staff uuid[], p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_today date;
  x jsonb;
  v_n integer := 0;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, true);
  IF p_week IS NULL OR extract(isodow FROM p_week) <> 1 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: week' USING ERRCODE = '22023';
  END IF;
  v_today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  IF p_week + 6 < v_today THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: shift_past' USING ERRCODE = '22023';
  END IF;
  IF p_staff IS NULL OR cardinality(p_staff) > 500 OR array_position(p_staff, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: staff' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: rows' USING ERRCODE = '22023';
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(x) <> 'object' OR coalesce(x ->> 'kind', '') NOT IN ('work','break')
       OR coalesce(x ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(x ->> 'staff_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR coalesce(x ->> 'starts', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' OR coalesce(x ->> 'ends', '') !~ '^(([01]\d|2[0-3]):[0-5]\d|24:00)$' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: rows' USING ERRCODE = '22023';
    END IF;
    IF (x ->> 'date')::date NOT BETWEEN p_week AND p_week + 6 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: outside_week' USING ERRCODE = '22023';
    END IF;
    IF (x ->> 'date')::date < v_today THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: shift_past' USING ERRCODE = '22023';
    END IF;
    IF NOT (x ->> 'staff_id')::uuid = ANY (p_staff) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: staff_not_listed' USING ERRCODE = '22023';
    END IF;
    IF NOT public.roster_staff_at(a.tenant_id, (x ->> 'staff_id')::uuid, p_branch) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: staff_not_at_branch' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  DELETE FROM public.staff_shifts WHERE tenant_id = a.tenant_id AND branch_id = p_branch AND staff_id = ANY (p_staff)
     AND shift_date BETWEEN greatest(p_week, v_today) AND p_week + 6;
  INSERT INTO public.staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by)
  SELECT a.tenant_id, p_branch, (e ->> 'staff_id')::uuid, (e ->> 'date')::date, (e ->> 'starts')::time,
         CASE WHEN e ->> 'ends' = '24:00' THEN time '23:59:59.999999' ELSE (e ->> 'ends')::time END, e ->> 'kind', a.staff_id
    FROM jsonb_array_elements(p_rows) e;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.roster_changed(p_branch, 'roster_week_set', 'branch_roster', p_branch, '{}'::jsonb);
  RETURN v_n;
EXCEPTION WHEN check_violation THEN
  -- starts >= ends: name the constraint only.
  RAISE EXCEPTION 'ERR_INVALID_INPUT: staff_shifts_range_check' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.roster_set_week(uuid, date, uuid[], jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.roster_set_week(uuid, date, uuid[], jsonb) TO clinic_app;--> statement-breakpoint

-- ── Leave ───────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.leave_add(p_branch uuid, p_staff uuid, p_kind text, p_from date, p_to date, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_id uuid := public.uuid_generate_v7();
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, true);
  IF p_kind IS NULL OR p_kind NOT IN ('leave','sick','absent') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kind' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: dates' USING ERRCODE = '22023';
  END IF;
  IF p_from < (clock_timestamp() AT TIME ZONE b.timezone)::date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: leave_past' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  IF NOT public.roster_staff_at(a.tenant_id, p_staff, p_branch) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: staff_not_at_branch' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.staff_leave (id, tenant_id, branch_id, staff_id, kind, from_date, to_date, reason, created_by)
  VALUES (v_id, a.tenant_id, p_branch, p_staff, p_kind, p_from, p_to, btrim(p_reason), a.staff_id);
  PERFORM public.roster_changed(p_branch, 'leave_added', 'staff_leave', v_id, jsonb_build_object('staff_id', p_staff, 'leave_id', v_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.leave_add(uuid, uuid, text, date, date, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.leave_add(uuid, uuid, text, date, date, text) TO clinic_app;--> statement-breakpoint

-- The leave's own branch is authorized first (a manager of another branch gets not found).
CREATE FUNCTION public.leave_cancel(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_branch uuid;
  r public.staff_leave;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  -- The role first, so a non-writer learns nothing about which leave ids exist (impl review r1 P3).
  IF a.role NOT IN ('owner','admin_pusat','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not change schedules' USING ERRCODE = '42501';
  END IF;
  SELECT branch_id INTO v_branch FROM public.staff_leave WHERE tenant_id = a.tenant_id AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: leave not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.branch_authorize(a.tenant_id, a.staff_id, a.role, v_branch, true);
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.staff_leave WHERE tenant_id = a.tenant_id AND id = p_id FOR UPDATE;
  IF r.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: leave_cancelled' USING ERRCODE = '55000';
  END IF;
  IF r.from_date < public.roster_today(a.tenant_id, v_branch) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: leave_past' USING ERRCODE = '22023';
  END IF;
  UPDATE public.staff_leave SET cancelled_at = clock_timestamp(), cancelled_by = a.staff_id, cancel_reason = btrim(p_reason)
   WHERE tenant_id = a.tenant_id AND id = p_id;
  PERFORM public.roster_changed(v_branch, 'leave_cancelled', 'staff_leave', p_id, jsonb_build_object('staff_id', r.staff_id, 'leave_id', p_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.leave_cancel(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.leave_cancel(uuid, text) TO clinic_app;--> statement-breakpoint

-- ── Readers for booking (plan r1 P1-3, P2-2; r2 (b), (d)) ───────────────────────────────────
-- Whether a staff member can serve [from, until) at a branch: the branch is open, the staff is on its
-- roster (membership and assignment now), inside one work shift, outside every break, and not on an
-- active leave at that branch on that date. False, never null.
CREATE FUNCTION public.staff_available(p_staff uuid, p_branch uuid, p_from timestamptz, p_until timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((
    SELECT p_staff IS NOT NULL AND p_from IS NOT NULL AND p_until IS NOT NULL AND p_until > p_from
       AND public.branch_is_open(p_branch, p_from, p_until)
       AND public.roster_staff_at(b.tenant_id, p_staff, b.id)
       AND EXISTS (SELECT 1 FROM public.staff_shifts w
                    WHERE w.tenant_id = b.tenant_id AND w.branch_id = b.id AND w.staff_id = p_staff AND w.kind = 'work'
                      AND w.shift_date = (p_from AT TIME ZONE b.timezone)::date
                      AND public.roster_instant(w.shift_date, w.starts, b.timezone) <= p_from
                      AND p_until <= public.roster_instant(w.shift_date, w.ends, b.timezone))
       AND NOT EXISTS (SELECT 1 FROM public.staff_shifts br
                        WHERE br.tenant_id = b.tenant_id AND br.branch_id = b.id AND br.staff_id = p_staff AND br.kind = 'break'
                          AND br.shift_date = (p_from AT TIME ZONE b.timezone)::date
                          AND public.roster_instant(br.shift_date, br.starts, b.timezone) < p_until
                          AND p_from < public.roster_instant(br.shift_date, br.ends, b.timezone))
       AND NOT EXISTS (SELECT 1 FROM public.staff_leave l
                        WHERE l.tenant_id = b.tenant_id AND l.branch_id = b.id AND l.staff_id = p_staff AND l.cancelled_at IS NULL
                          AND (p_from AT TIME ZONE b.timezone)::date BETWEEN l.from_date AND l.to_date)
      FROM public.branches b
     WHERE b.tenant_id = public.app_tenant_id() AND b.id = p_branch AND public.app_staff_id() IS NOT NULL), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_available(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_available(uuid, uuid, timestamptz, timestamptz) TO clinic_app;--> statement-breakpoint

-- A branch's shifts and active leave date ranges (no kind or reason) for a date window, for the booking
-- roles at that branch (T-044 slot finding without an N x M loop).
CREATE FUNCTION public.roster_window(p_branch uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs','bc','doctor','nurse','therapist']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read rosters' USING ERRCODE = '42501';
  END IF;
  IF NOT public.app_branch_allowed(p_branch) OR NOT EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = a.tenant_id AND id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: dates' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'shifts', coalesce((SELECT jsonb_agg(jsonb_build_object('staff_id', s.staff_id, 'date', s.shift_date, 'starts', to_char(s.starts, 'HH24:MI'),
                                 'ends', CASE WHEN s.ends = time '23:59:59.999999' THEN '24:00' ELSE to_char(s.ends, 'HH24:MI') END, 'kind', s.kind)
                               ORDER BY s.shift_date, s.staff_id, s.starts)
                          FROM public.staff_shifts s WHERE s.tenant_id = a.tenant_id AND s.branch_id = p_branch AND s.shift_date BETWEEN p_from AND p_to), '[]'::jsonb),
    'leave', coalesce((SELECT jsonb_agg(jsonb_build_object('staff_id', l.staff_id, 'from', l.from_date, 'to', l.to_date) ORDER BY l.from_date, l.staff_id)
                         FROM public.staff_leave l WHERE l.tenant_id = a.tenant_id AND l.branch_id = p_branch AND l.cancelled_at IS NULL
                          AND l.from_date <= p_to AND l.to_date >= p_from), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.roster_window(uuid, date, date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.roster_window(uuid, date, date) TO clinic_app;
