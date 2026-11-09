CREATE TABLE "queue_displays" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "queue_displays_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "queue_displays_token_key" UNIQUE("token_hash"),
	CONSTRAINT "queue_displays_label_check" CHECK (length(btrim("queue_displays"."label")) between 2 and 60),
	CONSTRAINT "queue_displays_token_check" CHECK ("queue_displays"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "queue_displays_revoked_check" CHECK (("queue_displays"."revoked_at" is null) = ("queue_displays"."revoked_by" is null))
);
--> statement-breakpoint
CREATE TABLE "queue_tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"queue_date" date NOT NULL,
	"seq" integer NOT NULL,
	"prefix" text NOT NULL,
	"visit_id" uuid NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"called_at" timestamp with time zone,
	"called_by" uuid,
	"room_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "queue_tickets_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "queue_tickets_tenant_visit_key" UNIQUE("tenant_id","visit_id"),
	CONSTRAINT "queue_tickets_number_key" UNIQUE("tenant_id","branch_id","queue_date","seq"),
	CONSTRAINT "queue_tickets_seq_check" CHECK ("queue_tickets"."seq" >= 1 and "queue_tickets"."prefix" ~ '^[A-Z]{1,3}$'),
	CONSTRAINT "queue_tickets_state_check" CHECK ("queue_tickets"."state" in ('waiting','called','skipped','done')
      and (("queue_tickets"."called_at" is null) = ("queue_tickets"."called_by" is null)) and (("queue_tickets"."called_at" is null) = ("queue_tickets"."room_id" is null))
      and ("queue_tickets"."state" <> 'called' or "queue_tickets"."called_at" is not null) and ("queue_tickets"."state" <> 'waiting' or "queue_tickets"."called_at" is null))
);
--> statement-breakpoint
ALTER TABLE "queue_displays" ADD CONSTRAINT "queue_displays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_displays" ADD CONSTRAINT "queue_displays_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_displays" ADD CONSTRAINT "queue_displays_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_displays" ADD CONSTRAINT "queue_displays_revoked_by_fk" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_room_fk" FOREIGN KEY ("tenant_id","branch_id","room_id") REFERENCES "public"."rooms"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_called_by_fk" FOREIGN KEY ("tenant_id","called_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_displays_branch_idx" ON "queue_displays" USING btree ("tenant_id","branch_id");;--> statement-breakpoint

-- T-048 rules (generated; see header)
-- Queue tickets and paired displays (PR-71, DATA-52, NAV-8): branch-scoped, read by the board roles;
-- written only by the definers below. A display's token hash is never readable by an app or operator role.
ALTER TABLE public.queue_tickets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY queue_tickets_read ON public.queue_tickets FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','fo_cashier']) AND public.app_branch_allowed(branch_id));--> statement-breakpoint
GRANT SELECT ON public.queue_tickets TO clinic_app;--> statement-breakpoint
ALTER TABLE public.queue_displays ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY queue_displays_read ON public.queue_displays FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','fo_cashier']) AND public.app_branch_allowed(branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, label, created_by, created_at, revoked_at, revoked_by) ON public.queue_displays TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.queue_tickets', 'branch-scoped', 'visits', '{owner,admin_pusat,manager,fo_cashier}', 'queue_issue, queue_call, queue_skip (src/modules/visits/queue)', 'branch of the visit'),
  ('public.queue_displays', 'branch-scoped', 'visits', '{owner,admin_pusat,manager,fo_cashier}', 'queue_display_pair, queue_display_revoke (src/modules/visits/queue)', 'branch of the display');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): a ticket belongs to a visit; a display is configuration
-- (never its token hash: column grant).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.queue_tickets', 'personal'), ('public.queue_displays', 'config');--> statement-breakpoint
CREATE POLICY queue_tickets_operator_read ON public.queue_tickets FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.queue_tickets', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.queue_tickets TO clinic_operator;--> statement-breakpoint
CREATE POLICY queue_displays_operator_read ON public.queue_displays FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.queue_displays', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, label, created_by, created_at, revoked_at, revoked_by) ON public.queue_displays TO clinic_operator;--> statement-breakpoint

-- ── Guards (plan r1 P1-4): never deleted; identity fixed; nothing after done or revoked. ──────────────
CREATE FUNCTION public.queue_tickets_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.queue_tickets := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'queue tickets are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'waiting' THEN
      RAISE EXCEPTION 'a ticket is issued waiting' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.queue_date, NEW.seq, NEW.prefix, NEW.visit_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.queue_date, OLD.seq, OLD.prefix, OLD.visit_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a ticket keeps its number and visit' USING ERRCODE = '42501';
  END IF;
  IF OLD.state = 'done' THEN
    RAISE EXCEPTION 'a done ticket is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_tickets_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER queue_tickets_guard BEFORE INSERT OR UPDATE OR DELETE ON public.queue_tickets FOR EACH ROW EXECUTE FUNCTION public.queue_tickets_guard();--> statement-breakpoint
ALTER TABLE public.queue_tickets ENABLE ALWAYS TRIGGER queue_tickets_guard;--> statement-breakpoint
CREATE TRIGGER queue_tickets_no_truncate BEFORE TRUNCATE ON public.queue_tickets FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.queue_tickets ENABLE ALWAYS TRIGGER queue_tickets_no_truncate;--> statement-breakpoint

CREATE FUNCTION public.queue_displays_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.queue_displays := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'queue displays are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'a display is paired active' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.label, NEW.token_hash, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.label, OLD.token_hash, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a display keeps its branch, label and token' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked display is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_displays_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER queue_displays_guard BEFORE INSERT OR UPDATE OR DELETE ON public.queue_displays FOR EACH ROW EXECUTE FUNCTION public.queue_displays_guard();--> statement-breakpoint
ALTER TABLE public.queue_displays ENABLE ALWAYS TRIGGER queue_displays_guard;--> statement-breakpoint
CREATE TRIGGER queue_displays_no_truncate BEFORE TRUNCATE ON public.queue_displays FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.queue_displays ENABLE ALWAYS TRIGGER queue_displays_no_truncate;--> statement-breakpoint

-- SET-40 for a branch of a given tenant (the feed runs outside any tenant context, plan r1 P1-2):
-- the branch version in force, else the tenant's, else the default.
CREATE FUNCTION public.queue_settings(p_tenant uuid, p_branch uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT v.value FROM public.setting_versions v
      WHERE v.tenant_id = p_tenant AND v.key = 'SET-40' AND v.state = 'active' AND v.branch_id = p_branch AND v.effective_from <= clock_timestamp()
      ORDER BY v.effective_from DESC, v.id DESC LIMIT 1),
    (SELECT v.value FROM public.setting_versions v
      WHERE v.tenant_id = p_tenant AND v.key = 'SET-40' AND v.state = 'active' AND v.branch_id IS NULL AND v.effective_from <= clock_timestamp()
      ORDER BY v.effective_from DESC, v.id DESC LIMIT 1),
    public.setting_default('SET-40'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_settings(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The shown number: prefix, a hyphen, at least three digits (never truncated, plan r1 P3-1).
CREATE FUNCTION public.queue_number(t public.queue_tickets) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT t.prefix || '-' || lpad(t.seq::text, greatest(3, length(t.seq::text)), '0')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_number(public.queue_tickets) FROM PUBLIC;--> statement-breakpoint

-- The next number of the branch's day for a visit (internal). One issuer at a time per branch and day.
CREATE FUNCTION public.queue_issue(v public.visits) RETURNS public.queue_tickets
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.branches;
  d date;
  t public.queue_tickets;
BEGIN
  SELECT * INTO b FROM public.branches WHERE tenant_id = v.tenant_id AND id = v.branch_id;
  d := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('queue:' || v.tenant_id::text || ':' || v.branch_id::text || ':' || d::text, 0));
  INSERT INTO public.queue_tickets (tenant_id, branch_id, queue_date, seq, prefix, visit_id)
  VALUES (v.tenant_id, v.branch_id, d,
          coalesce((SELECT max(x.seq) FROM public.queue_tickets x WHERE x.tenant_id = v.tenant_id AND x.branch_id = v.branch_id AND x.queue_date = d), 0) + 1,
          coalesce(public.queue_settings(v.tenant_id, v.branch_id) ->> 'prefiks_loket', 'A'), v.id)
  RETURNING * INTO t;
  RETURN t;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_issue(public.visits) FROM PUBLIC;--> statement-breakpoint

-- The branch an Antrean action acts on (plan r1 P1-3): the actor's active branch; Owner and Admin Pusat
-- on "Semua Cabang" name it. A Level 3 role (manager, FO) may act only on its active branch.
CREATE FUNCTION public.queue_branch(a record, p_branch uuid) RETURNS public.branches
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v uuid := coalesce(p_branch, a.branch_id);
BEGIN
  IF v IS NULL OR a.role IN ('manager','fo_cashier') AND v IS DISTINCT FROM a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.booking_branch(a.tenant_id, a.staff_id, a.role, v);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_branch(record, uuid) FROM PUBLIC;--> statement-breakpoint

-- One audit row per queue change (ids and codes only).
CREATE FUNCTION public.queue_changed(p_kind text, p_id uuid, p_code text) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.audit_append('settings_change', p_kind, p_id, 'success', p_code)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_changed(text, uuid, text) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.visit_check_in(p_appointment uuid) RETURNS uuid
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
  PERFORM public.queue_issue(v); -- T-048: every check-in gets the next number of the day
  PERFORM public.visit_changed(v, 'VisitCheckedIn', 'visit_checked_in');
  RETURN v.id;
END
$$;--> statement-breakpoint
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
  UPDATE public.queue_tickets SET state = 'done' WHERE tenant_id = v.tenant_id AND visit_id = v.id AND state <> 'done'; -- T-048
  PERFORM public.visit_changed(v, 'VisitClosed', 'visit_closed');
END
$$;--> statement-breakpoint

-- Pasien Datang tanpa janji (scenario PR-71): a walk-in visit with the next number of the day at the
-- branch acted on. Returns the visit id and the number.
CREATE FUNCTION public.visit_walk_in(p_patient uuid, p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.visit_actor();
  b public.branches := public.queue_branch(a, p_branch);
  v public.visits;
  t public.queue_tickets;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = a.tenant_id AND p.id = p_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.branch_id = b.id AND x.patient_id = p_patient AND x.closed_at IS NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_open' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.visits (tenant_id, branch_id, patient_id, kind, checked_in_by)
  VALUES (a.tenant_id, b.id, p_patient, 'walk_in', a.staff_id)
  RETURNING * INTO v;
  t := public.queue_issue(v);
  PERFORM public.visit_changed(v, 'VisitCheckedIn', 'visit_walk_in');
  RETURN jsonb_build_object('visit_id', v.id, 'number', public.queue_number(t));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.visit_walk_in(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.visit_walk_in(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- A ticket for a queue action, locked, on the branch the actor acts on.
CREATE FUNCTION public.queue_ticket_open(a record, p_ticket uuid) RETURNS public.queue_tickets
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t public.queue_tickets;
BEGIN
  SELECT * INTO t FROM public.queue_tickets WHERE tenant_id = a.tenant_id AND id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: ticket not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.queue_branch(a, t.branch_id);
  IF t.state = 'done' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: ticket_done' USING ERRCODE = '55000';
  END IF;
  RETURN t;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_ticket_open(record, uuid) FROM PUBLIC;--> statement-breakpoint

-- Panggil (and Pindah: call again to another room): a waiting, skipped or called ticket to an active
-- room of its branch.
CREATE FUNCTION public.queue_call(p_ticket uuid, p_room uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.visit_actor();
  t public.queue_tickets := public.queue_ticket_open(a, p_ticket);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.tenant_id = t.tenant_id AND r.branch_id = t.branch_id AND r.id = p_room AND r.is_active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: room not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.queue_tickets SET state = 'called', called_at = clock_timestamp(), called_by = a.staff_id, room_id = p_room
   WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.queue_changed('queue_ticket', t.id, 'queue_called');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_call(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.queue_call(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Lewati: a waiting or called ticket is skipped (it may be called again later).
CREATE FUNCTION public.queue_skip(p_ticket uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.visit_actor();
  t public.queue_tickets := public.queue_ticket_open(a, p_ticket);
BEGIN
  IF t.state = 'skipped' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_skipped' USING ERRCODE = '55000';
  END IF;
  UPDATE public.queue_tickets SET state = 'skipped' WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.queue_changed('queue_ticket', t.id, 'queue_skipped');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_skip(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.queue_skip(uuid) TO clinic_app;--> statement-breakpoint

-- Antrean (staff): today's tickets of the branch acted on, with names for staff; the branch's active rooms
-- and its displays (no token hash).
CREATE FUNCTION public.queue_board(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  d date;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the queue' USING ERRCODE = '42501';
  END IF;
  b := public.queue_branch(a, p_branch);
  d := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object(
    'now', clock_timestamp(), 'timezone', b.timezone, 'today', d, 'branch_id', b.id,
    'tickets', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'number', public.queue_number(t), 'seq', t.seq, 'state', t.state, 'called_at', t.called_at,
               'room_id', t.room_id, 'room_name', r.name, 'visit_id', t.visit_id, 'kind', v.kind, 'patient_id', v.patient_id,
               'patient_name', p.full_name, 'patient_mrn', p.mrn, 'created_at', t.created_at) ORDER BY t.seq)
        FROM public.queue_tickets t
        JOIN public.visits v ON v.tenant_id = t.tenant_id AND v.id = t.visit_id
        JOIN public.patients p ON p.tenant_id = v.tenant_id AND p.id = v.patient_id
        LEFT JOIN public.rooms r ON r.tenant_id = t.tenant_id AND r.id = t.room_id
       WHERE t.tenant_id = a.tenant_id AND t.branch_id = b.id AND t.queue_date = d), '[]'::jsonb),
    'rooms', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
        FROM public.rooms r WHERE r.tenant_id = a.tenant_id AND r.branch_id = b.id AND r.is_active), '[]'::jsonb),
    'displays', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'label', x.label, 'created_at', x.created_at) ORDER BY x.created_at)
        FROM public.queue_displays x WHERE x.tenant_id = a.tenant_id AND x.branch_id = b.id AND x.revoked_at IS NULL), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_board(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.queue_board(uuid) TO clinic_app;--> statement-breakpoint

-- The walk-in search on Antrean for the four board roles (plan r1 P2-1): name (2+ characters, contains),
-- MRN (exact) or phone (digits, suffix); at most 20 rows; the minimal projection (PR-76): id, MRN, name,
-- birth year, masked phone. The query is an argument only, never logged.
CREATE FUNCTION public.queue_patient_search(p_query text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  q text := btrim(coalesce(p_query, ''));
  -- Phone digits; a local leading 0 is the country code 62 (contact points are stored +62…).
  digits text := regexp_replace(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '^0', '62');
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not search patients here' USING ERRCODE = '42501';
  END IF;
  IF length(q) < 2 OR length(q) > 80 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: query' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'full_name', x->>'id') FROM (
      SELECT jsonb_build_object('id', p.id, 'mrn', p.mrn, 'full_name', p.full_name, 'birth_year', extract(year from p.birth_date)::int,
               'masked_phone', (SELECT left(c.value, 3) || repeat('•', greatest(length(c.value) - 7, 0)) || right(c.value, 4)
                                  FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.is_primary)) AS x
        FROM public.patients p
       WHERE p.tenant_id = a.tenant_id
         AND (p.full_name ILIKE '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
              OR upper(q) = p.mrn
              OR length(digits) >= 6 AND EXISTS (SELECT 1 FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id
                                                     AND c.kind = 'phone' AND right(regexp_replace(c.value, '[^0-9]', '', 'g'), length(digits)) = digits))
       ORDER BY p.full_name, p.id LIMIT 20) s), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_patient_search(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.queue_patient_search(text) TO clinic_app;--> statement-breakpoint

-- Pasangkan Layar TV (NAV-8): manager, Owner or Admin Pusat pairs a display for the branch acted on; the
-- token is generated by the caller and only its sha256 arrives here (plan r1 P1-1). Returns the id.
CREATE FUNCTION public.queue_display_pair(p_branch uuid, p_label text, p_token_hash text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.visit_actor();
  b public.branches;
  id uuid;
BEGIN
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not pair displays' USING ERRCODE = '42501';
  END IF;
  b := public.queue_branch(a, p_branch);
  IF length(btrim(coalesce(p_label, ''))) NOT BETWEEN 2 AND 60 OR coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: label' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.queue_displays (tenant_id, branch_id, label, token_hash, created_by)
  VALUES (a.tenant_id, b.id, btrim(p_label), p_token_hash, a.staff_id) RETURNING queue_displays.id INTO id;
  PERFORM public.queue_changed('queue_display', id, 'queue_display_paired');
  RETURN id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_display_pair(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.queue_display_pair(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- Cabut: the display stops receiving the feed at once.
CREATE FUNCTION public.queue_display_revoke(p_display uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.visit_actor();
  x public.queue_displays;
BEGIN
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not revoke displays' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO x FROM public.queue_displays WHERE tenant_id = a.tenant_id AND id = p_display FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: display not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.queue_branch(a, x.branch_id);
  IF x.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_revoked' USING ERRCODE = '55000';
  END IF;
  UPDATE public.queue_displays SET revoked_at = clock_timestamp(), revoked_by = a.staff_id WHERE tenant_id = x.tenant_id AND id = x.id;
  PERFORM public.queue_changed('queue_display', x.id, 'queue_display_revoked');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_display_revoke(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.queue_display_revoke(uuid) TO clinic_app;--> statement-breakpoint

-- Layar Antrean (19:56): called outside any tenant context with the token's sha256. For an active display
-- of a live or suspended tenant: the orientation and voice flag (SET-40), the called numbers with their
-- rooms (latest first, at most 6) and the next waiting numbers (at most 6) of its branch today. Numbers
-- and room names only: never a patient name, MRN or any id (fixed rule). Unknown or revoked → null.
CREATE FUNCTION public.queue_display_feed(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x public.queue_displays;
  b public.branches;
  s jsonb;
  d date;
BEGIN
  IF coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  SELECT q.* INTO x FROM public.queue_displays q JOIN public.tenants_registry tr ON tr.id = q.tenant_id
   WHERE q.token_hash = p_token_hash AND q.revoked_at IS NULL AND tr.lifecycle_state IN ('live','suspended');
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO b FROM public.branches WHERE tenant_id = x.tenant_id AND id = x.branch_id;
  s := public.queue_settings(x.tenant_id, x.branch_id);
  d := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object(
    'branch', b.name, 'orientation', coalesce(s ->> 'orientasi', 'landscape'), 'voice', coalesce((s ->> 'suara')::boolean, false),
    'current', coalesce((SELECT jsonb_agg(jsonb_build_object('number', c.n, 'room', c.room) ORDER BY c.at DESC) FROM (
        SELECT public.queue_number(t) AS n, r.name AS room, t.called_at AS at
          FROM public.queue_tickets t JOIN public.rooms r ON r.tenant_id = t.tenant_id AND r.id = t.room_id
         WHERE t.tenant_id = x.tenant_id AND t.branch_id = x.branch_id AND t.queue_date = d AND t.state = 'called'
         ORDER BY t.called_at DESC LIMIT 6) c), '[]'::jsonb),
    'next', coalesce((SELECT jsonb_agg(w.n ORDER BY w.seq) FROM (
        SELECT public.queue_number(t) AS n, t.seq FROM public.queue_tickets t
         WHERE t.tenant_id = x.tenant_id AND t.branch_id = x.branch_id AND t.queue_date = d AND t.state = 'waiting'
         ORDER BY t.seq LIMIT 6) w), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.queue_display_feed(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.queue_display_feed(text) TO clinic_app;
