CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"performer_staff_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"hold_until" timestamp with time zone,
	"channel" text NOT NULL,
	"source" text,
	"campaign" text,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "appointments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "appointments_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "appointments_range_check" CHECK ("appointments"."starts_at" < "appointments"."ends_at"),
	CONSTRAINT "appointments_state_check" CHECK ("appointments"."state" in ('held','booked') and (("appointments"."state" = 'held') = ("appointments"."hold_until" is not null))),
	CONSTRAINT "appointments_channel_check" CHECK ("appointments"."channel" in ('walk_in','phone','whatsapp','staff','online')),
	CONSTRAINT "appointments_source_check" CHECK (("appointments"."source" is null or "appointments"."source" ~ '^[a-z0-9][a-z0-9_-]{0,39}$') and ("appointments"."campaign" is null or "appointments"."campaign" ~ '^[a-z0-9][a-z0-9_-]{0,39}$')),
	CONSTRAINT "appointments_note_check" CHECK ("appointments"."note" is null or length("appointments"."note") <= 500),
	CONSTRAINT "appointments_created_as_check" CHECK ("appointments"."created_as" in ('owner','admin_pusat','manager','fo_cashier','central_cs'))
);
--> statement-breakpoint
CREATE TABLE "resource_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "resource_reservations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "resource_reservations_appointment_resource_key" UNIQUE("tenant_id","appointment_id","kind","resource_id"),
	CONSTRAINT "resource_reservations_kind_check" CHECK ("resource_reservations"."kind" in ('staff','room','device')),
	CONSTRAINT "resource_reservations_range_check" CHECK ("resource_reservations"."starts_at" < "resource_reservations"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_performer_fk" FOREIGN KEY ("tenant_id","performer_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_appointment_fk" FOREIGN KEY ("tenant_id","branch_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_branch_start_idx" ON "appointments" USING btree ("tenant_id","branch_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("tenant_id","patient_id","starts_at");;--> statement-breakpoint

-- T-044 rules (generated; see header)
-- T-044 (PR-6, DATA-16, PR-88, PR-2, PR-48; plan docs/tasks/T-044.md, DEC-054): the booking engine.
-- An appointment stores the catalog version used and reserves, together, the performer, one room of
-- each required kind and one device of each required type at the branch. One exclusion constraint
-- refuses overlapping active reservations of one resource (staff across branches: one person, one
-- place). A hold (DP pending, SET-17) blocks until it expires; expired holds are released by every
-- booking and schedule writer under the tenant lock.

CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE public.resource_reservations ADD CONSTRAINT resource_reservations_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, kind WITH =, resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (active);--> statement-breakpoint

-- ── Readers ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY appointments_read ON public.appointments FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs','bc','doctor','nurse','therapist']) AND public.app_branch_allowed(branch_id));--> statement-breakpoint
GRANT SELECT ON public.appointments TO clinic_app;--> statement-breakpoint
ALTER TABLE public.resource_reservations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY resource_reservations_read ON public.resource_reservations FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs','bc','doctor','nurse','therapist']) AND public.app_branch_allowed(branch_id));--> statement-breakpoint
GRANT SELECT ON public.resource_reservations TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.appointments', 'branch-scoped', 'scheduling', '{owner,admin_pusat,manager,fo_cashier,central_cs,bc,doctor,nurse,therapist}', 'booking_create, booking_confirm (src/modules/scheduling/booking)', 'branch of the appointment'),
  ('public.resource_reservations', 'branch-scoped', 'scheduling', '{owner,admin_pusat,manager,fo_cashier,central_cs,bc,doctor,nurse,therapist}', 'booking_create (src/modules/scheduling/booking)', 'branch of the appointment');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): appointments name patients; reservations point at them.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.appointments', 'personal'), ('public.resource_reservations', 'personal');--> statement-breakpoint
CREATE POLICY appointments_operator_read ON public.appointments FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.appointments', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.appointments TO clinic_operator;--> statement-breakpoint
CREATE POLICY resource_reservations_operator_read ON public.resource_reservations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.resource_reservations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.resource_reservations TO clinic_operator;--> statement-breakpoint

-- ── Guards (plan r1 P1-3; r2 (b), (c)) ──────────────────────────────────────────────────────
CREATE FUNCTION public.appointments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.appointments := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'appointments are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.catalog_version_id, NEW.performer_staff_id, NEW.starts_at, NEW.ends_at,
      NEW.channel, NEW.source, NEW.campaign, NEW.note, NEW.created_by, NEW.created_as, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.catalog_version_id, OLD.performer_staff_id, OLD.starts_at, OLD.ends_at,
      OLD.channel, OLD.source, OLD.campaign, OLD.note, OLD.created_by, OLD.created_as, OLD.created_at) THEN
    RAISE EXCEPTION 'an appointment keeps its patient, service, performer, time and source' USING ERRCODE = '42501';
  END IF;
  IF NOT (OLD.state = 'held' AND NEW.state = 'booked' AND NEW.hold_until IS NULL) THEN
    RAISE EXCEPTION 'the only change to an appointment here is confirming a hold' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointments_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_guard();--> statement-breakpoint
ALTER TABLE public.appointments ENABLE ALWAYS TRIGGER appointments_guard;--> statement-breakpoint
CREATE TRIGGER appointments_no_truncate BEFORE TRUNCATE ON public.appointments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.appointments ENABLE ALWAYS TRIGGER appointments_no_truncate;--> statement-breakpoint

-- A reservation is inserted active, for the range of its appointment, holding a resource of that branch
-- (an active room or device) or the performer of the appointment; later only released (active → false).
CREATE FUNCTION public.resource_reservations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.resource_reservations := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  ap public.appointments;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reservations are released, never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.appointment_id, NEW.kind, NEW.resource_id, NEW.starts_at, NEW.ends_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.appointment_id, OLD.kind, OLD.resource_id, OLD.starts_at, OLD.ends_at)
       OR NOT (OLD.active AND NOT NEW.active) THEN
      RAISE EXCEPTION 'a reservation is only released' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO ap FROM public.appointments WHERE tenant_id = NEW.tenant_id AND branch_id = NEW.branch_id AND id = NEW.appointment_id;
  IF NOT NEW.active OR NEW.starts_at <> ap.starts_at OR NEW.ends_at <> ap.ends_at
     OR NOT coalesce(NEW.kind = 'staff' AND NEW.resource_id = ap.performer_staff_id
                     OR NEW.kind = 'room' AND EXISTS (SELECT 1 FROM public.rooms x
                                                       WHERE x.tenant_id = NEW.tenant_id AND x.branch_id = NEW.branch_id AND x.id = NEW.resource_id AND x.is_active)
                     OR NEW.kind = 'device' AND EXISTS (SELECT 1 FROM public.branch_devices x
                                                         WHERE x.tenant_id = NEW.tenant_id AND x.branch_id = NEW.branch_id AND x.id = NEW.resource_id AND x.is_active), false) THEN
    RAISE EXCEPTION 'a reservation holds the performer of its appointment or an active resource of that branch for its time' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resource_reservations_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER resource_reservations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.resource_reservations FOR EACH ROW EXECUTE FUNCTION public.resource_reservations_guard();--> statement-breakpoint
ALTER TABLE public.resource_reservations ENABLE ALWAYS TRIGGER resource_reservations_guard;--> statement-breakpoint
CREATE TRIGGER resource_reservations_no_truncate BEFORE TRUNCATE ON public.resource_reservations FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.resource_reservations ENABLE ALWAYS TRIGGER resource_reservations_no_truncate;--> statement-breakpoint

-- ── Holds (plan r1 open point 1) ────────────────────────────────────────────────────────────
-- Releases the reservations of expired holds of a tenant; called after tenant_actor_lock by every
-- booking and schedule writer, so an expired hold never blocks a new reservation.
CREATE FUNCTION public.booking_expire_holds(p_tenant uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  UPDATE public.resource_reservations r SET active = false
    FROM public.appointments ap
   WHERE r.tenant_id = p_tenant AND r.active AND ap.tenant_id = r.tenant_id AND ap.branch_id = r.branch_id AND ap.id = r.appointment_id
     AND ap.state = 'held' AND ap.hold_until <= clock_timestamp()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_expire_holds(uuid) FROM PUBLIC;--> statement-breakpoint

-- ── Slot finding ────────────────────────────────────────────────────────────────────────────
-- The resources one exact slot would take, or no row: the service offered at the branch, the branch
-- open, an eligible performer (named or the least-loaded one) available and not reserved anywhere, one
-- free active room of each required kind and one free active device of each required type. A
-- reservation blocks when it is active and its appointment is booked or a live hold. Internal: the
-- callers check the actor and the branch scope.
CREATE FUNCTION public.booking_pick(p_tenant uuid, p_branch uuid, p_version uuid, p_from timestamptz, p_until timestamptz, p_staff uuid)
RETURNS TABLE (staff_id uuid, rooms uuid[], devices uuid[])
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.catalog_versions;
  v_kind text;
  v_rooms uuid[] := '{}';
  v_devices uuid[] := '{}';
  v_pick uuid;
  req record;
  v_tz text;
  v_day0 timestamptz;
  v_day1 timestamptz;
BEGIN
  SELECT * INTO v FROM public.catalog_versions WHERE tenant_id = p_tenant AND id = p_version AND state = 'active';
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT i.kind INTO v_kind FROM public.catalog_items i WHERE i.tenant_id = p_tenant AND i.id = v.item_id;
  IF v_kind IS DISTINCT FROM 'service'
     OR NOT EXISTS (SELECT 1 FROM public.branch_services bs WHERE bs.tenant_id = p_tenant AND bs.branch_id = p_branch AND bs.item_id = v.item_id)
     OR NOT public.branch_is_open(p_branch, p_from, p_until) THEN
    RETURN;
  END IF;
  -- One free active room of each required kind, one free active device of each required type.
  FOR req IN SELECT sr.kind, sr.code FROM public.service_resources sr WHERE sr.tenant_id = p_tenant AND sr.version_id = v.id AND sr.required ORDER BY sr.kind, sr.code LOOP
    IF req.kind = 'room' THEN
      SELECT x.id INTO v_pick FROM public.rooms x
       WHERE x.tenant_id = p_tenant AND x.branch_id = p_branch AND x.kind = req.code AND x.is_active
         AND NOT public.booking_busy(p_tenant, 'room', x.id, p_from, p_until)
       ORDER BY x.id LIMIT 1;
      IF v_pick IS NULL THEN RETURN; END IF;
      v_rooms := v_rooms || v_pick;
    ELSE
      SELECT x.id INTO v_pick FROM public.branch_devices x
       WHERE x.tenant_id = p_tenant AND x.branch_id = p_branch AND x.device_type = req.code AND x.is_active
         AND NOT public.booking_busy(p_tenant, 'device', x.id, p_from, p_until)
       ORDER BY x.id LIMIT 1;
      IF v_pick IS NULL THEN RETURN; END IF;
      v_devices := v_devices || v_pick;
    END IF;
  END LOOP;
  -- The performer: eligible at this branch (plan r1 P1-5), available, not reserved anywhere; the named
  -- one, else the one with the fewest live reservations that branch-local day (impl review r1 P2), then by id.
  SELECT timezone INTO v_tz FROM public.branches WHERE tenant_id = p_tenant AND id = p_branch;
  v_day0 := ((p_from AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz;
  v_day1 := ((p_from AT TIME ZONE v_tz)::date + 1)::timestamp AT TIME ZONE v_tz;
  SELECT s.id INTO v_pick
    FROM public.staff s
   WHERE s.tenant_id = p_tenant AND (p_staff IS NULL OR s.id = p_staff)
     AND public.booking_eligible(p_tenant, p_branch, v.id, v.category, s.id)
     AND public.staff_available(s.id, p_branch, p_from, p_until)
     AND NOT public.booking_busy(p_tenant, 'staff', s.id, p_from, p_until)
   ORDER BY (SELECT count(*) FROM public.resource_reservations r JOIN public.appointments ap
               ON ap.tenant_id = r.tenant_id AND ap.branch_id = r.branch_id AND ap.id = r.appointment_id
              WHERE r.tenant_id = p_tenant AND r.kind = 'staff' AND r.resource_id = s.id AND r.active
                AND (ap.state = 'booked' OR ap.state = 'held' AND ap.hold_until > clock_timestamp())
                AND r.starts_at >= v_day0 AND r.starts_at < v_day1), s.id
   LIMIT 1;
  IF v_pick IS NULL THEN
    RETURN;
  END IF;
  staff_id := v_pick; rooms := v_rooms; devices := v_devices;
  RETURN NEXT;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_pick(uuid, uuid, uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint

-- Whether a resource is taken in [from, until): an active reservation of a booked appointment or a live hold.
CREATE FUNCTION public.booking_busy(p_tenant uuid, p_kind text, p_resource uuid, p_from timestamptz, p_until timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.resource_reservations r
                   JOIN public.appointments ap ON ap.tenant_id = r.tenant_id AND ap.branch_id = r.branch_id AND ap.id = r.appointment_id
                  WHERE r.tenant_id = p_tenant AND r.kind = p_kind AND r.resource_id = p_resource AND r.active
                    AND (ap.state = 'booked' OR ap.state = 'held' AND ap.hold_until > clock_timestamp())
                    AND r.starts_at < p_until AND p_from < r.ends_at)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_busy(uuid, text, uuid, timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- A staff member may perform a service version at a branch (DEC-047 (3)/(4); plan r1 P1-5): a role row
-- (performs or supervised) needs that role at the branch and no named row demoting the person to
-- assists; a named row (performs or supervised) needs a clinical role at the branch whose delegation
-- floor for the category allows that mode.
CREATE FUNCTION public.booking_eligible(p_tenant uuid, p_branch uuid, p_version uuid, p_category text, p_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.service_staff_eligibility n
                      WHERE n.tenant_id = p_tenant AND n.version_id = p_version AND n.staff_id = p_staff AND n.mode = 'assists')
     AND (EXISTS (SELECT 1 FROM public.service_staff_eligibility e
                    JOIN public.staff_branches sb ON sb.tenant_id = e.tenant_id AND sb.staff_id = p_staff AND sb.branch_id = p_branch AND sb.role = e.role
                   WHERE e.tenant_id = p_tenant AND e.version_id = p_version AND e.role IS NOT NULL AND e.mode IN ('performs','supervised'))
          OR EXISTS (SELECT 1 FROM public.service_staff_eligibility e
                       JOIN public.staff_branches sb ON sb.tenant_id = e.tenant_id AND sb.staff_id = e.staff_id AND sb.branch_id = p_branch
                                                    AND sb.role IN ('doctor','nurse','therapist')
                       JOIN public.delegation_floor d ON d.category = p_category AND d.profession = sb.role
                      WHERE e.tenant_id = p_tenant AND e.version_id = p_version AND e.staff_id = p_staff AND e.mode IN ('performs','supervised')
                        AND public.catalog_mode_rank(d.max_mode) >= public.catalog_mode_rank(e.mode)))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_eligible(uuid, uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- The caller may act at a branch: an allowed branch of this tenant; Level 3 roles at a branch of their
-- own role. Unknown, foreign and out-of-scope branches are all "not found".
CREATE FUNCTION public.booking_branch(p_tenant uuid, p_staff uuid, p_role text, p_branch uuid) RETURNS public.branches
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.branches;
BEGIN
  SELECT * INTO b FROM public.branches WHERE tenant_id = p_tenant AND id = p_branch;
  IF NOT FOUND OR NOT public.app_branch_allowed(p_branch)
     OR p_role NOT IN ('owner','admin_pusat','central_cs') AND NOT EXISTS (
          SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = p_tenant AND sb.staff_id = p_staff AND sb.role = p_role AND sb.branch_id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN b;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_branch(uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- The slot length of a service version: prep + treatment + buffer minutes.
CREATE FUNCTION public.booking_minutes(v public.catalog_versions) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(v.prep_min, 0) + v.treatment_min + coalesce(v.buffer_min, 0)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_minutes(public.catalog_versions) FROM PUBLIC;--> statement-breakpoint

-- Every valid start (15-minute grid, plan r1 open point 3) of a local date at a branch for a service
-- version, with the resources it would take; optional named performer. Booking roles at the branch.
CREATE FUNCTION public.booking_slots(p_branch uuid, p_version uuid, p_date date, p_staff uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v public.catalog_versions;
  v_len interval;
  t timestamptz;
  p record;
  out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs','bc','doctor','nurse','therapist']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read booking slots' USING ERRCODE = '42501';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, p_branch);
  SELECT * INTO v FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND id = p_version AND state = 'active';
  IF NOT FOUND OR v.treatment_min IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: service not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: date' USING ERRCODE = '22023';
  END IF;
  v_len := make_interval(mins => public.booking_minutes(v));
  FOR i IN 0..95 LOOP
    t := (p_date + make_interval(mins => i * 15)) AT TIME ZONE b.timezone;
    CONTINUE WHEN t < clock_timestamp();
    SELECT * INTO p FROM public.booking_pick(a.tenant_id, p_branch, v.id, t, t + v_len, p_staff);
    IF FOUND THEN
      out := out || jsonb_build_object('starts_at', t, 'ends_at', t + v_len, 'staff_id', p.staff_id, 'rooms', to_jsonb(p.rooms), 'devices', to_jsonb(p.devices));
    END IF;
  END LOOP;
  RETURN out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_slots(uuid, uuid, date, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.booking_slots(uuid, uuid, date, uuid) TO clinic_app;--> statement-breakpoint

-- ── booking_create (PR-6) ───────────────────────────────────────────────────────────────────
-- Books (or holds, for the DP flow) one slot: checks role, lifecycle, branch scope, patient and service
-- first (plan r1 P2-3), then picks the resources under the tenant lock and inserts the appointment and
-- its reservations together; the exclusion constraint is the last guard (slot_taken).
CREATE FUNCTION public.booking_create(p_branch uuid, p_patient uuid, p_version uuid, p_start timestamptz, p_staff uuid,
                                      p_channel text, p_source text, p_campaign text, p_note text, p_hold boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v public.catalog_versions;
  v_end timestamptz;
  v_set jsonb;
  p record;
  v_id uuid := public.uuid_generate_v7();
  v_hold timestamptz;
  v_is_hold boolean := coalesce(p_hold, false); -- impl review r1 P2: a null never skips the event
  x uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not book' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('new_booking') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant does not take new bookings now' USING ERRCODE = '42501';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, p_branch);
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE tenant_id = a.tenant_id AND id = p_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND id = p_version AND state = 'active';
  IF NOT FOUND OR v.treatment_min IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: service not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('walk_in','phone','whatsapp','staff','online') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: channel' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source !~ '^[a-z0-9][a-z0-9_-]{0,39}$' OR p_campaign IS NOT NULL AND p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,39}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: source' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: note' USING ERRCODE = '22023';
  END IF;
  IF p_start IS NULL OR p_start < clock_timestamp() - interval '1 minute' OR p_start > clock_timestamp() + interval '366 days'
     OR extract(epoch FROM (p_start AT TIME ZONE b.timezone)::time) % 900 <> 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: start' USING ERRCODE = '22023';
  END IF;
  -- The public flow (later task): online-bookable services within SET-16 of the branch.
  IF p_channel = 'online' THEN
    v_set := public.setting_value_at('SET-16', p_branch, clock_timestamp());
    IF NOT v.online_bookable OR p_start < clock_timestamp() + make_interval(hours => (v_set ->> 'batas')::integer)
       OR (p_start AT TIME ZONE b.timezone)::date > (clock_timestamp() AT TIME ZONE b.timezone)::date + (v_set ->> 'horizon')::integer THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: online_window' USING ERRCODE = '22023';
    END IF;
  END IF;
  PERFORM public.booking_expire_holds(a.tenant_id);
  v_end := p_start + make_interval(mins => public.booking_minutes(v));
  -- One patient, one appointment at a time.
  IF EXISTS (SELECT 1 FROM public.appointments ap WHERE ap.tenant_id = a.tenant_id AND ap.patient_id = p_patient
              AND (ap.state = 'booked' OR ap.state = 'held' AND ap.hold_until > clock_timestamp())
              AND ap.starts_at < v_end AND p_start < ap.ends_at) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: patient_overlap' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO p FROM public.booking_pick(a.tenant_id, p_branch, v.id, p_start, v_end, p_staff);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: slot_taken' USING ERRCODE = '55000';
  END IF;
  IF v_is_hold THEN
    v_hold := clock_timestamp() + make_interval(mins => (public.setting_value_at('SET-17', NULL, clock_timestamp()))::text::integer);
  END IF;
  INSERT INTO public.appointments (id, tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, hold_until,
                                   channel, source, campaign, note, created_by, created_as)
  VALUES (v_id, a.tenant_id, p_branch, p_patient, v.id, p.staff_id, p_start, v_end, CASE WHEN v_is_hold THEN 'held' ELSE 'booked' END, v_hold,
          p_channel, p_source, p_campaign, NULLIF(btrim(p_note), ''), a.staff_id, a.role);
  BEGIN
    INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
    VALUES (a.tenant_id, p_branch, v_id, 'staff', p.staff_id, p_start, v_end);
    FOREACH x IN ARRAY p.rooms LOOP
      INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
      VALUES (a.tenant_id, p_branch, v_id, 'room', x, p_start, v_end);
    END LOOP;
    FOREACH x IN ARRAY p.devices LOOP
      INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
      VALUES (a.tenant_id, p_branch, v_id, 'device', x, p_start, v_end);
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: slot_taken' USING ERRCODE = '55000';
  END;
  PERFORM public.catalog_version_reference(v.id);
  PERFORM public.audit_append('settings_change', 'appointment', v_id, 'success', CASE WHEN v_is_hold THEN 'appointment_held' ELSE 'appointment_booked' END);
  IF NOT v_is_hold THEN
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (p_branch, 'AppointmentBooked', 'appointment', v_id, jsonb_build_object('appointment_id', v_id, 'branch_id', p_branch, 'patient_id', p_patient,
            'catalog_version_id', v.id, 'performer_staff_id', p.staff_id, 'channel', p_channel));
  END IF;
  RETURN jsonb_build_object('appointment_id', v_id, 'state', CASE WHEN v_is_hold THEN 'held' ELSE 'booked' END, 'starts_at', p_start, 'ends_at', v_end,
                            'staff_id', p.staff_id, 'rooms', to_jsonb(p.rooms), 'devices', to_jsonb(p.devices), 'hold_until', v_hold);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_create(uuid, uuid, uuid, timestamptz, uuid, text, text, text, text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.booking_create(uuid, uuid, uuid, timestamptz, uuid, text, text, text, text, boolean) TO clinic_app;--> statement-breakpoint

-- ── booking_confirm ─────────────────────────────────────────────────────────────────────────
-- Turns a live hold into a booking (the DP was paid, M4). An expired hold cannot be confirmed.
CREATE FUNCTION public.booking_confirm(p_appointment uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  ap public.appointments;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not book' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('new_booking') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant does not take new bookings now' USING ERRCODE = '42501';
  END IF;
  PERFORM public.booking_expire_holds(a.tenant_id);
  SELECT * INTO ap FROM public.appointments WHERE tenant_id = a.tenant_id AND id = p_appointment FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: appointment not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.booking_branch(a.tenant_id, a.staff_id, a.role, ap.branch_id);
  IF ap.state = 'booked' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_booked' USING ERRCODE = '55000';
  END IF;
  IF ap.hold_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: hold_expired' USING ERRCODE = '55000';
  END IF;
  UPDATE public.appointments SET state = 'booked', hold_until = NULL WHERE tenant_id = a.tenant_id AND id = p_appointment;
  PERFORM public.audit_append('settings_change', 'appointment', p_appointment, 'success', 'appointment_confirmed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (ap.branch_id, 'AppointmentBooked', 'appointment', p_appointment, jsonb_build_object('appointment_id', p_appointment, 'branch_id', ap.branch_id,
          'patient_id', ap.patient_id, 'catalog_version_id', ap.catalog_version_id, 'performer_staff_id', ap.performer_staff_id, 'channel', ap.channel));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_confirm(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.booking_confirm(uuid) TO clinic_app;--> statement-breakpoint

-- ── UX-33 appointment-conflict check in the roster writers (DEC-053; plan r1 P1-1) ─────────────
CREATE OR REPLACE FUNCTION public.roster_set_week(p_branch uuid, p_week date, p_staff uuid[], p_rows jsonb) RETURNS integer
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
  PERFORM public.booking_expire_holds(a.tenant_id); -- T-044: expired holds never block
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
  -- T-044 (UX-33, DEC-053): every live appointment of a listed staff member in the edited days must
  -- still lie inside one work shift of its performer and outside every break.
  IF EXISTS (SELECT 1 FROM public.appointments ap
              WHERE ap.tenant_id = a.tenant_id AND ap.branch_id = p_branch AND ap.performer_staff_id = ANY (p_staff)
                AND (ap.state = 'booked' OR ap.state = 'held' AND ap.hold_until > clock_timestamp()) AND ap.ends_at > clock_timestamp()
                AND (ap.starts_at AT TIME ZONE b.timezone)::date BETWEEN greatest(p_week, v_today) AND p_week + 6
                AND (NOT EXISTS (SELECT 1 FROM public.staff_shifts w
                                  WHERE w.tenant_id = ap.tenant_id AND w.branch_id = ap.branch_id AND w.staff_id = ap.performer_staff_id AND w.kind = 'work'
                                    AND w.shift_date = (ap.starts_at AT TIME ZONE b.timezone)::date
                                    AND public.roster_instant(w.shift_date, w.starts, b.timezone) <= ap.starts_at
                                    AND ap.ends_at <= public.roster_instant(w.shift_date, w.ends, b.timezone))
                     OR EXISTS (SELECT 1 FROM public.staff_shifts br
                                 WHERE br.tenant_id = ap.tenant_id AND br.branch_id = ap.branch_id AND br.staff_id = ap.performer_staff_id AND br.kind = 'break'
                                   AND br.shift_date = (ap.starts_at AT TIME ZONE b.timezone)::date
                                   AND public.roster_instant(br.shift_date, br.starts, b.timezone) < ap.ends_at
                                   AND ap.starts_at < public.roster_instant(br.shift_date, br.ends, b.timezone)))) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: appointment_conflict' USING ERRCODE = '55000';
  END IF;
  PERFORM public.roster_changed(p_branch, 'roster_week_set', 'branch_roster', p_branch, '{}'::jsonb);
  RETURN v_n;
EXCEPTION WHEN check_violation THEN
  -- starts >= ends: name the constraint only.
  RAISE EXCEPTION 'ERR_INVALID_INPUT: staff_shifts_range_check' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.leave_add(p_branch uuid, p_staff uuid, p_kind text, p_from date, p_to date, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_id uuid := public.uuid_generate_v7();
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, true);
  PERFORM public.booking_expire_holds(a.tenant_id); -- T-044: expired holds never block
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
  -- T-044 (UX-33, DEC-053): no live appointment of this staff member at the branch in the leave days.
  IF EXISTS (SELECT 1 FROM public.appointments ap
              WHERE ap.tenant_id = a.tenant_id AND ap.branch_id = p_branch AND ap.performer_staff_id = p_staff
                AND (ap.state = 'booked' OR ap.state = 'held' AND ap.hold_until > clock_timestamp()) AND ap.ends_at > clock_timestamp()
                AND (ap.starts_at AT TIME ZONE b.timezone)::date BETWEEN p_from AND p_to) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: appointment_conflict' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.staff_leave (id, tenant_id, branch_id, staff_id, kind, from_date, to_date, reason, created_by)
  VALUES (v_id, a.tenant_id, p_branch, p_staff, p_kind, p_from, p_to, btrim(p_reason), a.staff_id);
  PERFORM public.roster_changed(p_branch, 'leave_added', 'staff_leave', v_id, jsonb_build_object('staff_id', p_staff, 'leave_id', v_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
