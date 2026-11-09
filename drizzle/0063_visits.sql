CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kind" text NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"checked_in_by" uuid NOT NULL,
	"intake" text DEFAULT 'not_started' NOT NULL,
	"doctor" text DEFAULT 'not_started' NOT NULL,
	"selection" text DEFAULT 'not_started' NOT NULL,
	"consent" text DEFAULT 'not_started' NOT NULL,
	"payment" text DEFAULT 'not_started' NOT NULL,
	"preparation" text DEFAULT 'not_started' NOT NULL,
	"treatment" text DEFAULT 'not_started' NOT NULL,
	"dispensing" text DEFAULT 'not_started' NOT NULL,
	"blocker" text,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "visits_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "visits_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "visits_tenant_appointment_key" UNIQUE("tenant_id","appointment_id"),
	CONSTRAINT "visits_kind_check" CHECK ("visits"."kind" in ('booked','walk_in') and (("visits"."kind" = 'booked') = ("visits"."appointment_id" is not null))),
	CONSTRAINT "visits_closed_check" CHECK (("visits"."closed_at" is null) = ("visits"."closed_by" is null)),
	CONSTRAINT "visits_blocker_check" CHECK ("visits"."blocker" is null or length(btrim("visits"."blocker")) between 1 and 120),
	CONSTRAINT "visits_states_check" CHECK ("visits"."intake" in ('not_started','in_progress','done','not_needed','blocked') and "visits"."doctor" in ('not_started','in_progress','done','not_needed','blocked') and "visits"."selection" in ('not_started','in_progress','done','not_needed','blocked') and "visits"."consent" in ('not_started','in_progress','done','not_needed','blocked')
      and "visits"."payment" in ('not_started','in_progress','done','not_needed','blocked') and "visits"."preparation" in ('not_started','in_progress','done','not_needed','blocked') and "visits"."treatment" in ('not_started','in_progress','done','not_needed','blocked') and "visits"."dispensing" in ('not_started','in_progress','done','not_needed','blocked'))
);
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_appointment_fk" FOREIGN KEY ("tenant_id","branch_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_checked_in_by_fk" FOREIGN KEY ("tenant_id","checked_in_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visits_one_open_per_patient" ON "visits" USING btree ("tenant_id","branch_id","patient_id") WHERE "visits"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "visits_branch_checked_in_idx" ON "visits" USING btree ("tenant_id","branch_id","checked_in_at");;--> statement-breakpoint

-- T-047 rules (generated; see header)
-- Visits (PR-7, DATA-17, UX-6; DEC-057): branch-scoped, read by the scheduling readers; written only by
-- the definers below (clinic_app has SELECT only). The step columns are set by their own later writers.
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY visits_read ON public.visits FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs','bc','doctor','nurse','therapist']) AND public.app_branch_allowed(branch_id));--> statement-breakpoint
GRANT SELECT ON public.visits TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.visits', 'branch-scoped', 'visits', '{owner,admin_pusat,manager,fo_cashier,central_cs,bc,doctor,nurse,therapist}', 'visit_check_in, visit_close (src/modules/visits)', 'branch of the visit');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): a visit names a patient.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.visits', 'personal');--> statement-breakpoint
CREATE POLICY visits_operator_read ON public.visits FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.visits', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.visits TO clinic_operator;--> statement-breakpoint

-- ── Guard (plan r1 P1-2): never deleted; a booked visit opens on its arrived appointment; identity
-- columns fixed; a closed visit is final; no close while a blocker holds. ─────────────────────────────
CREATE FUNCTION public.visits_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.visits := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'visits are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a visit opens open' USING ERRCODE = '42501';
    END IF;
    IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.appointments ap
          WHERE ap.tenant_id = NEW.tenant_id AND ap.branch_id = NEW.branch_id AND ap.id = NEW.appointment_id
            AND ap.patient_id = NEW.patient_id AND ap.state = 'arrived') THEN
      RAISE EXCEPTION 'a booked visit opens on its arrived appointment' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.appointment_id, NEW.kind, NEW.checked_in_at, NEW.checked_in_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.appointment_id, OLD.kind, OLD.checked_in_at, OLD.checked_in_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a visit keeps its branch, patient, appointment and check-in' USING ERRCODE = '42501';
  END IF;
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a closed visit is final' USING ERRCODE = '42501';
  END IF;
  IF NEW.closed_at IS NOT NULL AND (NEW.payment IN ('in_progress','blocked') OR NEW.dispensing IN ('in_progress','blocked') OR NEW.treatment IN ('in_progress','blocked')) THEN
    RAISE EXCEPTION 'a visit does not close while a blocker holds' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.visits_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER visits_guard BEFORE INSERT OR UPDATE OR DELETE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.visits_guard();--> statement-breakpoint
ALTER TABLE public.visits ENABLE ALWAYS TRIGGER visits_guard;--> statement-breakpoint
CREATE TRIGGER visits_no_truncate BEFORE TRUNCATE ON public.visits FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.visits ENABLE ALWAYS TRIGGER visits_no_truncate;--> statement-breakpoint

-- The writers' actor: the board roles only (central CS books but does not check patients in, 17:326),
-- a tenant that may still serve existing appointments. Returns the actor record.
CREATE FUNCTION public.visit_actor() RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not check patients in or close visits' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.visit_actor() FROM PUBLIC;--> statement-breakpoint

-- One audit row and one event (ids only, no nulls) per change.
CREATE FUNCTION public.visit_changed(v public.visits, p_type text, p_code text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.audit_append('settings_change', 'visit', v.id, 'success', p_code);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v.branch_id, p_type, 'visit', v.id,
          jsonb_strip_nulls(jsonb_build_object('visit_id', v.id, 'branch_id', v.branch_id, 'patient_id', v.patient_id, 'appointment_id', v.appointment_id)));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.visit_changed(public.visits, text, text) FROM PUBLIC;--> statement-breakpoint

-- Pasien Datang (PR-7): a booked or confirmed appointment of today (branch time), from two hours before
-- its start; the appointment becomes arrived (its reservations kept: the slot is in use) and one visit
-- opens. Returns the visit id.
CREATE FUNCTION public.visit_check_in(p_appointment uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.visit_actor();
  ap public.appointments;
  b public.branches;
  v public.visits;
BEGIN
  PERFORM public.booking_expire_holds(a.tenant_id);
  SELECT * INTO ap FROM public.appointments WHERE tenant_id = a.tenant_id AND id = p_appointment FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: appointment not found' USING ERRCODE = 'P0002';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, ap.branch_id);
  IF ap.state NOT IN ('booked','confirmed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_scheduled' USING ERRCODE = '55000';
  END IF;
  IF (ap.starts_at AT TIME ZONE b.timezone)::date <> (clock_timestamp() AT TIME ZONE b.timezone)::date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: not_today' USING ERRCODE = '22023';
  END IF;
  IF clock_timestamp() < ap.starts_at - interval '2 hours' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: too_early' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.branch_id = ap.branch_id AND x.patient_id = ap.patient_id AND x.closed_at IS NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_open' USING ERRCODE = '55000';
  END IF;
  UPDATE public.appointments SET state = 'arrived', state_changed_at = clock_timestamp(), state_changed_by = a.staff_id
   WHERE tenant_id = ap.tenant_id AND id = ap.id;
  INSERT INTO public.visits (tenant_id, branch_id, patient_id, appointment_id, kind, checked_in_by)
  VALUES (a.tenant_id, ap.branch_id, ap.patient_id, ap.id, 'booked', a.staff_id)
  RETURNING * INTO v;
  PERFORM public.visit_changed(v, 'VisitCheckedIn', 'visit_checked_in');
  RETURN v.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.visit_check_in(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.visit_check_in(uuid) TO clinic_app;--> statement-breakpoint

-- Tutup Kunjungan (PR-7, PR-15): refused while a bill is unpaid or dispensing or treatment is pending
-- (the blocker named); otherwise closed once and the appointment's reservations released.
CREATE FUNCTION public.visit_close(p_visit uuid) RETURNS void
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
  IF v.payment IN ('in_progress','blocked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: unpaid_bill' USING ERRCODE = '55000';
  END IF;
  IF v.dispensing IN ('in_progress','blocked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: pending_dispensing' USING ERRCODE = '55000';
  END IF;
  IF v.treatment IN ('in_progress','blocked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: pending_treatment' USING ERRCODE = '55000';
  END IF;
  IF v.appointment_id IS NOT NULL THEN
    UPDATE public.resource_reservations SET active = false
     WHERE tenant_id = v.tenant_id AND branch_id = v.branch_id AND appointment_id = v.appointment_id AND active;
  END IF;
  UPDATE public.visits SET closed_at = clock_timestamp(), closed_by = a.staff_id WHERE tenant_id = v.tenant_id AND id = v.id
  RETURNING * INTO v;
  PERFORM public.visit_changed(v, 'VisitClosed', 'visit_closed');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.visit_close(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.visit_close(uuid) TO clinic_app;--> statement-breakpoint

-- Hari Ini (UX-6): the branch's open visits and today's closed ones (branch time), and today's booked or
-- confirmed appointments not yet arrived with the time check-in opens. Names and MRNs only: no clinical
-- content. The database time comes with it so the page never uses the server clock.
CREATE FUNCTION public.visits_today(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  today date;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read Hari Ini' USING ERRCODE = '42501';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, p_branch);
  today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object(
    'now', clock_timestamp(), 'timezone', b.timezone, 'today', today,
    'visits', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'kind', v.kind, 'checked_in_at', v.checked_in_at, 'appointment_id', v.appointment_id, 'starts_at', ap.starts_at,
               'patient_id', v.patient_id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn,
               'intake', v.intake, 'doctor', v.doctor, 'selection', v.selection, 'consent', v.consent, 'payment', v.payment,
               'preparation', v.preparation, 'treatment', v.treatment, 'dispensing', v.dispensing, 'blocker', v.blocker, 'closed_at', v.closed_at)
             ORDER BY coalesce(ap.starts_at, v.checked_in_at), v.id)
        FROM public.visits v
        JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = v.patient_id
        LEFT JOIN public.appointments ap ON ap.tenant_id = v.tenant_id AND ap.id = v.appointment_id
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = p_branch
         AND (v.closed_at IS NULL OR (v.closed_at AT TIME ZONE b.timezone)::date = today)), '[]'::jsonb),
    'arrivals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', ap.id, 'state', ap.state, 'starts_at', ap.starts_at, 'check_in_from', ap.starts_at - interval '2 hours',
               'patient_id', ap.patient_id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'service_name', cv.name)
             ORDER BY ap.starts_at, ap.id)
        FROM public.appointments ap
        JOIN public.patients pt ON pt.tenant_id = ap.tenant_id AND pt.id = ap.patient_id
        JOIN public.catalog_versions cv ON cv.tenant_id = ap.tenant_id AND cv.id = ap.catalog_version_id
       WHERE ap.tenant_id = a.tenant_id AND ap.branch_id = p_branch AND ap.state IN ('booked','confirmed')
         AND (ap.starts_at AT TIME ZONE b.timezone)::date = today), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.visits_today(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.visits_today(uuid) TO clinic_app;
