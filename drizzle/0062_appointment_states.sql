ALTER TABLE "appointments" DROP CONSTRAINT "appointments_state_check";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "state_reason" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "state_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "state_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "rescheduled_to" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_state_changed_by_fk" FOREIGN KEY ("tenant_id","state_changed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_to_fk" FOREIGN KEY ("tenant_id","branch_id","rescheduled_to") REFERENCES "public"."appointments"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_state_check" CHECK ("appointments"."state" in ('held','booked','confirmed','arrived','no_show','cancelled','rescheduled')
      and (("appointments"."state" = 'held') = ("appointments"."hold_until" is not null))
      and (("appointments"."state" = 'cancelled') = ("appointments"."state_reason" is not null and length(btrim("appointments"."state_reason")) between 3 and 500))
      and (("appointments"."state" = 'rescheduled') = ("appointments"."rescheduled_to" is not null and "appointments"."rescheduled_to" <> "appointments"."id"))
      and (("appointments"."state" in ('confirmed','arrived','no_show','cancelled','rescheduled')) = ("appointments"."state_changed_at" is not null and "appointments"."state_changed_by" is not null)));;--> statement-breakpoint

-- T-045 rules (generated; see header)
-- T-045 (PR-83, UX-5; plan docs/tasks/T-045.md, DEC-055): the later appointment states and their
-- writers. Confirm, cancel, no-show and reschedule act on existing appointments, so they run while the
-- tenant is live or suspended (PR-56, TEN-12); none of them moves money (DP effects are M4).

-- An appointment holds its slot while booked, confirmed, arrived, or held with the hold not yet expired.
CREATE FUNCTION public.appointment_live(ap public.appointments) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ap.state IN ('booked','confirmed','arrived') OR ap.state = 'held' AND ap.hold_until > clock_timestamp()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_live(public.appointments) FROM PUBLIC;--> statement-breakpoint

-- ── Re-created from 0061 with the live helper and the new transitions (drift-tracked) ────────
CREATE OR REPLACE FUNCTION public.appointments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.appointments := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'appointments are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- T-045: an appointment is created held or booked; the later states come from the writers.
    IF NEW.state NOT IN ('held','booked') THEN
      RAISE EXCEPTION 'an appointment is created held or booked' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.catalog_version_id, NEW.performer_staff_id, NEW.starts_at, NEW.ends_at,
      NEW.channel, NEW.source, NEW.campaign, NEW.note, NEW.created_by, NEW.created_as, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.catalog_version_id, OLD.performer_staff_id, OLD.starts_at, OLD.ends_at,
      OLD.channel, OLD.source, OLD.campaign, OLD.note, OLD.created_by, OLD.created_as, OLD.created_at) THEN
    RAISE EXCEPTION 'an appointment keeps its patient, service, performer, time and source' USING ERRCODE = '42501';
  END IF;
  -- T-045 (PR-83, DEC-055): held → booked; booked → confirmed; booked|confirmed → cancelled, no-show,
  -- rescheduled or arrived (T-047). A releasing state needs its reservations released first.
  IF NOT (OLD.state = 'held' AND NEW.state = 'booked' AND NEW.hold_until IS NULL
          OR OLD.state = 'booked' AND NEW.state = 'confirmed'
          OR OLD.state IN ('booked','confirmed') AND NEW.state IN ('cancelled','no_show','rescheduled','arrived')) THEN
    RAISE EXCEPTION 'the only change to an appointment here is confirming a hold' USING ERRCODE = '42501';
  END IF;
  IF NEW.state IN ('cancelled','no_show','rescheduled') AND EXISTS (
       SELECT 1 FROM public.resource_reservations rr
        WHERE rr.tenant_id = NEW.tenant_id AND rr.branch_id = NEW.branch_id AND rr.appointment_id = NEW.id AND rr.active) THEN
    RAISE EXCEPTION 'release the reservations before leaving the schedule' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.booking_busy(p_tenant uuid, p_kind text, p_resource uuid, p_from timestamptz, p_until timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.resource_reservations r
                   JOIN public.appointments ap ON ap.tenant_id = r.tenant_id AND ap.branch_id = r.branch_id AND ap.id = r.appointment_id
                  WHERE r.tenant_id = p_tenant AND r.kind = p_kind AND r.resource_id = p_resource AND r.active
                    AND public.appointment_live(ap)
                    AND r.starts_at < p_until AND p_from < r.ends_at)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.booking_pick(p_tenant uuid, p_branch uuid, p_version uuid, p_from timestamptz, p_until timestamptz, p_staff uuid)
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
                AND public.appointment_live(ap)
                AND r.starts_at >= v_day0 AND r.starts_at < v_day1), s.id
   LIMIT 1;
  IF v_pick IS NULL THEN
    RETURN;
  END IF;
  staff_id := v_pick; rooms := v_rooms; devices := v_devices;
  RETURN NEXT;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.booking_create(p_branch uuid, p_patient uuid, p_version uuid, p_start timestamptz, p_staff uuid,
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
              AND public.appointment_live(ap)
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
CREATE OR REPLACE FUNCTION public.booking_confirm(p_appointment uuid) RETURNS void
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
  IF ap.state <> 'held' THEN -- T-045: any state but a hold
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
                AND public.appointment_live(ap) AND ap.ends_at > clock_timestamp()
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
                AND public.appointment_live(ap) AND ap.ends_at > clock_timestamp()
                AND (ap.starts_at AT TIME ZONE b.timezone)::date BETWEEN p_from AND p_to) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: appointment_conflict' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.staff_leave (id, tenant_id, branch_id, staff_id, kind, from_date, to_date, reason, created_by)
  VALUES (v_id, a.tenant_id, p_branch, p_staff, p_kind, p_from, p_to, btrim(p_reason), a.staff_id);
  PERFORM public.roster_changed(p_branch, 'leave_added', 'staff_leave', v_id, jsonb_build_object('staff_id', p_staff, 'leave_id', v_id));
  RETURN v_id;
END
$$;--> statement-breakpoint

-- ── Writers (plan r1 P1-2, P1-4; r2 P1-1, P2-1) ─────────────────────────────────────────────
-- The appointment to change, after the role, lifecycle, hold release, row lock and branch scope.
CREATE FUNCTION public.appointment_open(p_appointment uuid) RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  ap public.appointments;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not change appointments' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change appointments now' USING ERRCODE = '42501';
  END IF;
  PERFORM public.booking_expire_holds(a.tenant_id);
  SELECT * INTO ap FROM public.appointments WHERE tenant_id = a.tenant_id AND id = p_appointment FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: appointment not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.booking_branch(a.tenant_id, a.staff_id, a.role, ap.branch_id);
  RETURN ap;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_open(uuid) FROM PUBLIC;--> statement-breakpoint

-- Releases an appointment's reservations (before a releasing state, plan r2 P2-1).
CREATE FUNCTION public.appointment_release(ap public.appointments) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  UPDATE public.resource_reservations SET active = false
   WHERE tenant_id = ap.tenant_id AND branch_id = ap.branch_id AND appointment_id = ap.id AND active
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_release(public.appointments) FROM PUBLIC;--> statement-breakpoint

-- One audit row and one event (ids and codes only) per change.
CREATE FUNCTION public.appointment_changed(ap public.appointments, p_type text, p_code text, p_extra jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.audit_append('settings_change', 'appointment', ap.id, 'success', p_code);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (ap.branch_id, p_type, 'appointment', ap.id,
          jsonb_build_object('appointment_id', ap.id, 'branch_id', ap.branch_id, 'patient_id', ap.patient_id) || p_extra);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_changed(public.appointments, text, text, jsonb) FROM PUBLIC;--> statement-breakpoint

-- Booked → confirmed (the patient confirmed by phone or at the desk; reminder replies are T-095).
CREATE FUNCTION public.appointment_confirm(p_appointment uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ap public.appointments := public.appointment_open(p_appointment);
BEGIN
  IF ap.state <> 'booked' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_booked' USING ERRCODE = '55000';
  END IF;
  UPDATE public.appointments SET state = 'confirmed', state_changed_at = clock_timestamp(), state_changed_by = public.app_staff_id()
   WHERE tenant_id = ap.tenant_id AND id = ap.id;
  PERFORM public.appointment_changed(ap, 'AppointmentConfirmed', 'appointment_attendance_confirmed', '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_confirm(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.appointment_confirm(uuid) TO clinic_app;--> statement-breakpoint

-- Batalkan: booked|confirmed → cancelled with a reason; the slot is free again. The reason stays on
-- the row (never in audit or events).
CREATE FUNCTION public.appointment_cancel(p_appointment uuid, p_reason text) RETURNS void
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
  PERFORM public.appointment_changed(ap, 'AppointmentCancelled', 'appointment_cancelled', '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_cancel(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.appointment_cancel(uuid, text) TO clinic_app;--> statement-breakpoint

-- The time from which an appointment may be marked no-show: its start plus SET-15 minutes (a JSON null
-- default means off, plan r1 P1-4).
CREATE FUNCTION public.appointment_no_show_from(ap public.appointments) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ap.starts_at + make_interval(mins => coalesce((public.setting_value_at('SET-15', ap.branch_id, clock_timestamp()) #>> '{}')::integer, 0))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_no_show_from(public.appointments) FROM PUBLIC;--> statement-breakpoint

-- Tandai Tidak Datang (scenario PR-83 without DP): booked|confirmed → no-show after start + lateness.
-- No money moves here (PR-22 forfeit is M4).
CREATE FUNCTION public.appointment_no_show(p_appointment uuid) RETURNS void
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
  PERFORM public.appointment_changed(ap, 'AppointmentNoShow', 'appointment_no_show', '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_no_show(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.appointment_no_show(uuid) TO clinic_app;--> statement-breakpoint

-- Ubah Jadwal: booked|confirmed → rescheduled, with a new booked appointment for the same patient,
-- service version, branch and source, at a valid slot. Old reservations are released first so the move
-- may overlap itself; any refusal rolls back the whole move.
CREATE FUNCTION public.appointment_reschedule(p_appointment uuid, p_start timestamptz, p_staff uuid) RETURNS jsonb
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
  IF EXISTS (SELECT 1 FROM public.appointments o WHERE o.tenant_id = ap.tenant_id AND o.patient_id = ap.patient_id AND o.id <> ap.id
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
  PERFORM public.appointment_changed(ap, 'AppointmentRescheduled', 'appointment_rescheduled', jsonb_build_object('new_appointment_id', v_new));
  RETURN jsonb_build_object('appointment_id', v_new, 'starts_at', p_start, 'ends_at', v_end, 'staff_id', p.staff_id,
                            'rooms', to_jsonb(p.rooms), 'devices', to_jsonb(p.devices));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_reschedule(uuid, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.appointment_reschedule(uuid, timestamptz, uuid) TO clinic_app;--> statement-breakpoint

-- ── The calendar (plan r1 P1-3) ─────────────────────────────────────────────────────────────
-- A branch's appointments for a date window with patient name and MRN, service, performer, rooms and
-- devices (from reservations, active or not), the no-show time, and the branch performers for the
-- filter. Booking roles at the branch; expired holds are left out.
CREATE FUNCTION public.appointments_window(p_branch uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs','bc','doctor','nurse','therapist']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the calendar' USING ERRCODE = '42501';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, p_branch);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: dates' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'appointments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', ap.id, 'state', ap.state, 'starts_at', ap.starts_at, 'ends_at', ap.ends_at, 'hold_until', ap.hold_until,
               'no_show_from', public.appointment_no_show_from(ap), 'channel', ap.channel,
               'patient_id', ap.patient_id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn,
               'service_name', v.name, 'version_id', v.id, 'performer_id', ap.performer_staff_id, 'performer_name', s.display_name,
               'rooms', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name)
                                    FROM public.resource_reservations r JOIN public.rooms x ON x.tenant_id = r.tenant_id AND x.id = r.resource_id
                                   WHERE r.tenant_id = ap.tenant_id AND r.appointment_id = ap.id AND r.kind = 'room'), '[]'::jsonb),
               'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.label) ORDER BY x.label)
                                      FROM public.resource_reservations r JOIN public.branch_devices x ON x.tenant_id = r.tenant_id AND x.id = r.resource_id
                                     WHERE r.tenant_id = ap.tenant_id AND r.appointment_id = ap.id AND r.kind = 'device'), '[]'::jsonb))
             ORDER BY ap.starts_at, ap.id)
        FROM public.appointments ap
        JOIN public.patients pt ON pt.tenant_id = ap.tenant_id AND pt.id = ap.patient_id
        JOIN public.catalog_versions v ON v.tenant_id = ap.tenant_id AND v.id = ap.catalog_version_id
        JOIN public.staff s ON s.tenant_id = ap.tenant_id AND s.id = ap.performer_staff_id
       WHERE ap.tenant_id = a.tenant_id AND ap.branch_id = p_branch
         AND (ap.starts_at AT TIME ZONE b.timezone)::date BETWEEN p_from AND p_to
         AND NOT (ap.state = 'held' AND ap.hold_until <= clock_timestamp())), '[]'::jsonb),
    'performers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.display_name) ORDER BY s.display_name, s.id)
        FROM public.staff s
       WHERE s.tenant_id = a.tenant_id AND public.roster_staff_at(a.tenant_id, s.id, p_branch)
         AND EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.branch_id = p_branch
                       AND sb.role IN ('doctor','nurse','therapist'))), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointments_window(uuid, date, date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.appointments_window(uuid, date, date) TO clinic_app;
