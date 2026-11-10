CREATE TABLE "complaint_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"task_kind" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "complaint_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "complaint_events_check" CHECK ("complaint_events"."kind" in ('flagged','taken','triaged','note','resolved','reopened','escalated') and "complaint_events"."task_kind" in ('klinis','layanan')
      and (("complaint_events"."kind" in ('note','resolved','reopened')) = ("complaint_events"."note" is not null)) and ("complaint_events"."note" is null or length(btrim("complaint_events"."note")) between 3 and 1000)
      and (("complaint_events"."kind" = 'escalated') = ("complaint_events"."actor_id" is null)) and num_nonnulls("complaint_events"."actor_id", "complaint_events"."actor_role") in (0, 2))
);
--> statement-breakpoint
CREATE TABLE "complaint_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"triage" text,
	"category" text,
	"summary" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"assigned_to" uuid,
	"assigned_as" text,
	"flagged_by" uuid NOT NULL,
	"flagged_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_as" text,
	"resolution_outcome" text,
	"resolution_note" text,
	"escalated_at" timestamp with time zone,
	CONSTRAINT "complaint_tasks_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "complaint_tasks_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "complaint_tasks_kind_check" CHECK ("complaint_tasks"."kind" in ('klinis','layanan')
      and (("complaint_tasks"."kind" = 'klinis') = ("complaint_tasks"."triage" is not null and "complaint_tasks"."category" is null))
      and (("complaint_tasks"."kind" = 'layanan') = ("complaint_tasks"."category" is not null and "complaint_tasks"."triage" is null))
      and ("complaint_tasks"."triage" is null or "complaint_tasks"."triage" in ('merah','kuning','hijau')) and ("complaint_tasks"."category" is null or "complaint_tasks"."category" in ('waktu_tunggu','tagihan','sikap_staf','lainnya'))),
	CONSTRAINT "complaint_tasks_source_check" CHECK ("complaint_tasks"."source" in ('visit_note','staff_flag','pharmacist','message') and ("complaint_tasks"."source" <> 'visit_note' or "complaint_tasks"."visit_id" is not null)
      and ("complaint_tasks"."source" <> 'pharmacist' or ("complaint_tasks"."kind" = 'klinis' and "complaint_tasks"."flagged_as" = 'pharmacist'))
      and "complaint_tasks"."flagged_as" in ('fo_cashier','central_cs','bc','doctor','nurse','pharmacist','facility_head','manager') and ("complaint_tasks"."flagged_as" <> 'manager' or "complaint_tasks"."kind" = 'layanan')),
	CONSTRAINT "complaint_tasks_state_check" CHECK ("complaint_tasks"."state" in ('open','in_progress','resolved')
      and (("complaint_tasks"."state" = 'open') = ("complaint_tasks"."assigned_to" is null and "complaint_tasks"."assigned_as" is null)) and num_nonnulls("complaint_tasks"."assigned_to", "complaint_tasks"."assigned_as") in (0, 2)
      and (("complaint_tasks"."state" = 'resolved') = (num_nonnulls("complaint_tasks"."resolved_at", "complaint_tasks"."resolved_by", "complaint_tasks"."resolved_as", "complaint_tasks"."resolution_outcome", "complaint_tasks"."resolution_note") = 5))
      and num_nonnulls("complaint_tasks"."resolved_at", "complaint_tasks"."resolved_by", "complaint_tasks"."resolved_as", "complaint_tasks"."resolution_outcome", "complaint_tasks"."resolution_note") in (0, 5)
      and ("complaint_tasks"."resolution_outcome" is null or "complaint_tasks"."resolution_outcome" in ('kontrol_gratis','edukasi','resep_tambahan','rujuk','penjelasan','jadwal_ulang','eskalasi_tagihan','pembinaan_staf','lainnya'))),
	CONSTRAINT "complaint_tasks_text_check" CHECK (length(btrim("complaint_tasks"."summary")) between 3 and 1000
      and ("complaint_tasks"."resolution_note" is null or length(btrim("complaint_tasks"."resolution_note")) between 3 and 1000) and "complaint_tasks"."due_at" > "complaint_tasks"."created_at")
);
--> statement-breakpoint
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_task_fk" FOREIGN KEY ("tenant_id","branch_id","task_id") REFERENCES "public"."complaint_tasks"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_tasks" ADD CONSTRAINT "complaint_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_tasks" ADD CONSTRAINT "complaint_tasks_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_tasks" ADD CONSTRAINT "complaint_tasks_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_tasks" ADD CONSTRAINT "complaint_tasks_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_tasks" ADD CONSTRAINT "complaint_tasks_flagged_by_fk" FOREIGN KEY ("tenant_id","flagged_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_tasks" ADD CONSTRAINT "complaint_tasks_assigned_fk" FOREIGN KEY ("tenant_id","assigned_to") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_tasks" ADD CONSTRAINT "complaint_tasks_resolved_by_fk" FOREIGN KEY ("tenant_id","resolved_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "complaint_events_task_idx" ON "complaint_events" USING btree ("tenant_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "complaint_tasks_branch_idx" ON "complaint_tasks" USING btree ("tenant_id","branch_id","state","due_at");--> statement-breakpoint
CREATE INDEX "complaint_tasks_patient_idx" ON "complaint_tasks" USING btree ("tenant_id","patient_id");;--> statement-breakpoint

-- T-057 rules (generated by gen.py; plan docs/tasks/T-057.md)
-- Keluhan Klinis and Layanan (PR-43, CLIN-016, CLIN-024; plan Argon r1 f4867ceb adopted, r2 5dd4df47 APPROVE;
-- DEC-066 revisable defaults).

-- Read helper (invoker, wall clock): klinis → doctor, nurse, pharmacist, facility head; layanan → manager,
-- facility head; acting role held at the branch now (allowed in the session). Never null. Flaggers outside these
-- roles read through the definer readers only (status).
CREATE FUNCTION public.complaint_readable(p_tenant uuid, p_branch uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id()
    AND (p_kind = 'klinis' AND public.app_role_in(ARRAY['doctor','nurse','pharmacist','facility_head'])
         OR p_kind = 'layanan' AND public.app_role_in(ARRAY['manager','facility_head']))
    AND public.app_branch_allowed(p_branch)
    AND EXISTS (
      SELECT 1 FROM public.staff s
        JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch
       WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
         AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_readable(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_readable(uuid, uuid, text) TO clinic_app;--> statement-breakpoint

-- Whether a role handles a kind (handlers write; DEC-066).
CREATE FUNCTION public.complaint_handler(p_role text, p_kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_kind = 'klinis' AND p_role IN ('doctor','nurse','pharmacist','facility_head')
                  OR p_kind = 'layanan' AND p_role IN ('manager','facility_head'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_handler(text, text) FROM PUBLIC;--> statement-breakpoint

-- The due time (PR-43, SET-31): klinis merah / kuning add wall-clock minutes; klinis hijau and layanan add working
-- hours of the branch (branch_hours minus branch_closures, in the branch timezone; a closing time of
-- 23:59:59.999999 is midnight), walked over at most 60 local days; a branch without hours, or a walk that runs
-- out, adds the rest as wall-clock time.
CREATE FUNCTION public.complaint_due_at(p_tenant uuid, p_branch uuid, p_kind text, p_triage text, p_from timestamptz) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tz text;
  v_set jsonb;
  v_left bigint;
  v_day date;
  v_s timestamptz;
  v_e timestamptz;
  r record;
  c record;
BEGIN
  SELECT timezone INTO v_tz FROM public.branches WHERE tenant_id = p_tenant AND id = p_branch;
  IF p_kind = 'klinis' THEN
    v_set := public.setting_value_at('SET-31', p_branch, p_from);
    IF p_triage IN ('merah','kuning') THEN
      RETURN p_from + make_interval(mins => (v_set ->> p_triage)::integer);
    END IF;
    v_left := (v_set ->> 'hijau')::bigint * 3600;
  ELSE
    v_left := (public.setting_value_at('SET-31.layanan', p_branch, p_from) #>> '{}')::bigint * 3600;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branch_hours h WHERE h.tenant_id = p_tenant AND h.branch_id = p_branch) THEN
    RETURN p_from + make_interval(secs => v_left);
  END IF;
  v_day := (p_from AT TIME ZONE v_tz)::date;
  FOR i IN 0..59 LOOP
    IF NOT EXISTS (SELECT 1 FROM public.branch_closures x WHERE x.tenant_id = p_tenant AND x.branch_id = p_branch AND x.closed_on = v_day AND x.from_time IS NULL) THEN
      FOR r IN SELECT h.opens, h.closes FROM public.branch_hours h
                WHERE h.tenant_id = p_tenant AND h.branch_id = p_branch AND h.weekday = extract(dow FROM v_day) ORDER BY h.opens LOOP
        v_s := greatest(public.roster_instant(v_day, r.opens, v_tz), p_from);
        v_e := public.roster_instant(v_day, r.closes, v_tz);
        CONTINUE WHEN v_e <= v_s;
        -- Partial closures of the day cut the interval: count the open pieces in time order.
        FOR c IN SELECT public.roster_instant(v_day, x.from_time, v_tz) AS f, public.roster_instant(v_day, x.until_time, v_tz) AS u
                   FROM public.branch_closures x
                  WHERE x.tenant_id = p_tenant AND x.branch_id = p_branch AND x.closed_on = v_day AND x.from_time IS NOT NULL
                  ORDER BY x.from_time LOOP
          CONTINUE WHEN c.u <= v_s OR c.f >= v_e;
          IF c.f > v_s THEN
            IF extract(epoch FROM c.f - v_s) >= v_left THEN
              RETURN v_s + make_interval(secs => v_left);
            END IF;
            v_left := v_left - extract(epoch FROM c.f - v_s)::bigint;
          END IF;
          v_s := greatest(v_s, c.u);
        END LOOP;
        IF v_e > v_s THEN
          IF extract(epoch FROM v_e - v_s) >= v_left THEN
            RETURN v_s + make_interval(secs => v_left);
          END IF;
          v_left := v_left - extract(epoch FROM v_e - v_s)::bigint;
        END IF;
      END LOOP;
    END IF;
    v_day := v_day + 1;
  END LOOP;
  -- The walk ran out (60 local days): the rest as wall-clock time from the end of the window.
  RETURN public.roster_instant(v_day, time '00:00', v_tz) + make_interval(secs => v_left);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_due_at(uuid, uuid, text, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.complaint_tasks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY complaint_tasks_read ON public.complaint_tasks FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.complaint_readable(tenant_id, branch_id, kind));--> statement-breakpoint
GRANT SELECT ON public.complaint_tasks TO clinic_app;--> statement-breakpoint
CREATE POLICY complaint_tasks_operator_read ON public.complaint_tasks FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.complaint_tasks', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.complaint_tasks TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER complaint_tasks_no_truncate BEFORE TRUNCATE ON public.complaint_tasks FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.complaint_tasks ENABLE ALWAYS TRIGGER complaint_tasks_no_truncate;--> statement-breakpoint
ALTER TABLE public.complaint_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY complaint_events_read ON public.complaint_events FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.complaint_readable(tenant_id, branch_id, task_kind));--> statement-breakpoint
GRANT SELECT ON public.complaint_events TO clinic_app;--> statement-breakpoint
CREATE POLICY complaint_events_operator_read ON public.complaint_events FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.complaint_events', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.complaint_events TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER complaint_events_no_truncate BEFORE TRUNCATE ON public.complaint_events FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.complaint_events ENABLE ALWAYS TRIGGER complaint_events_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.complaint_tasks', 'clinical', 'clinical', '{doctor,nurse,pharmacist,facility_head,manager}', 'complaint_flag, complaint_take, complaint_triage, complaint_resolve, complaint_reopen (src/modules/clinical/complaints)', 'the branch flagged'),
  ('public.complaint_events', 'clinical', 'clinical', '{doctor,nurse,pharmacist,facility_head,manager}', 'the complaint writers (src/modules/clinical/complaints)', 'the task''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): clinical class.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.complaint_tasks', 'clinical'), ('public.complaint_events', 'clinical');--> statement-breakpoint

-- ── Guards: staff_access lock first, ENABLE ALWAYS ─────────────────────────────────────────────────
-- Tasks: never deleted; open, unassigned, unresolved and not escalated on insert; identity, summary and flagger
-- frozen; escalation set once; a resolved task changes only by reopening (to in_progress, resolution cleared).
-- Events: insert-only.
CREATE FUNCTION public.complaint_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  frozen constant text[] := ARRAY['id','tenant_id','branch_id','patient_id','visit_id','kind','source','summary','category','flagged_by','flagged_as','created_at'];
  k text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || (coalesce(n, o) ->> 'tenant_id'), 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'complaints are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'complaint_events' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'complaint history never changes' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF n ->> 'state' <> 'open' OR n ->> 'assigned_to' IS NOT NULL OR n ->> 'resolved_at' IS NOT NULL OR n ->> 'escalated_at' IS NOT NULL THEN
      RAISE EXCEPTION 'a complaint opens open' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  FOREACH k IN ARRAY frozen LOOP
    IF n -> k IS DISTINCT FROM o -> k THEN
      RAISE EXCEPTION 'a complaint keeps its patient, kind and summary' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF o ->> 'escalated_at' IS NOT NULL AND n -> 'escalated_at' IS DISTINCT FROM o -> 'escalated_at' THEN
    RAISE EXCEPTION 'an escalation is set once' USING ERRCODE = '42501';
  END IF;
  IF o ->> 'state' = 'resolved' AND n ->> 'state' <> 'in_progress' THEN
    RAISE EXCEPTION 'a resolved complaint only reopens' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER complaint_tasks_guard BEFORE INSERT OR UPDATE OR DELETE ON public.complaint_tasks FOR EACH ROW EXECUTE FUNCTION public.complaint_guard();--> statement-breakpoint
ALTER TABLE public.complaint_tasks ENABLE ALWAYS TRIGGER complaint_tasks_guard;--> statement-breakpoint
CREATE TRIGGER complaint_events_guard BEFORE INSERT OR UPDATE OR DELETE ON public.complaint_events FOR EACH ROW EXECUTE FUNCTION public.complaint_guard();--> statement-breakpoint
ALTER TABLE public.complaint_events ENABLE ALWAYS TRIGGER complaint_events_guard;--> statement-breakpoint

-- Notification types (PR-54): raised by the complaint definers only.
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('complaint_klinis', 'Keluhan klinis perlu ditangani', '{doctor,nurse,pharmacist,facility_head}', '{complaint_task}', false),
  ('complaint_layanan', 'Keluhan layanan perlu ditangani', '{manager,facility_head}', '{complaint_task}', false),
  ('complaint_overdue', 'Keluhan melewati target waktu respons', '{facility_head,owner}', '{complaint_task}', false);--> statement-breakpoint

-- ── Escalation (read-time; plan open point 5) ─────────────────────────────────────────────────────
-- Marks overdue, unresolved tasks of the tenant (one branch, or all branches allowed in the session when null)
-- once: escalated_at, an `escalated` history row (no actor), ComplaintEscalated, a complaint_overdue notification
-- to the facility head (klinis) or the owner (layanan). Called after tenant_actor_lock (DEC-043 order).
CREATE FUNCTION public.complaint_escalate_due(p_tenant uuid, p_branch uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t public.complaint_tasks;
  v_event uuid;
BEGIN
  FOR t IN SELECT * FROM public.complaint_tasks x
            WHERE x.tenant_id = p_tenant AND (p_branch IS NULL AND public.app_branch_allowed(x.branch_id) OR x.branch_id = p_branch)
              AND x.state <> 'resolved' AND x.escalated_at IS NULL AND x.due_at < clock_timestamp()
            ORDER BY x.id FOR UPDATE LOOP
    UPDATE public.complaint_tasks SET escalated_at = clock_timestamp() WHERE tenant_id = t.tenant_id AND id = t.id;
    INSERT INTO public.complaint_events (tenant_id, branch_id, task_id, task_kind, kind) VALUES (t.tenant_id, t.branch_id, t.id, t.kind, 'escalated');
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (t.tenant_id, t.branch_id, 'ComplaintEscalated', 'complaint_task', t.id, jsonb_build_object('task_id', t.id, 'branch_id', t.branch_id, 'kind', t.kind))
    RETURNING id INTO v_event;
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, source_event_id)
    VALUES (t.tenant_id, 'complaint_overdue', CASE t.kind WHEN 'klinis' THEN 'facility_head' ELSE 'owner' END, t.branch_id, 'complaint_task', t.id, v_event);
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_escalate_due(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The writer's actor: actor lock first, then the capability; returns the actor.
CREATE FUNCTION public.complaint_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('fo_cashier','central_cs','bc','doctor','nurse','pharmacist','facility_head','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not use complaints' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_actor() FROM PUBLIC;--> statement-breakpoint

-- ── complaint_flag (PR-43, CLIN-016, CLIN-024) ────────────────────────────────────────────────────
-- p: {kind, source, summary, triage?, category?, visit_id?, branch_id?}. A visit names the branch (it must be the
-- patient's, at the actor's branch); without one, the actor's branch or the named one (central CS). The manager
-- flags layanan only; the pharmacist source is a pharmacist's klinis flag; the message source waits for the inbox.
CREATE FUNCTION public.complaint_flag(p_patient uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_actor();
  v public.visits;
  v_canon uuid;
  v_branch uuid;
  v_kind text := p ->> 'kind';
  v_triage text;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
  v_event uuid;
  r text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'kind' - 'source' - 'summary' - 'triage' - 'category' - 'visit_id' - 'branch_id' <> '{}'::jsonb
     OR coalesce(v_kind, '') NOT IN ('klinis','layanan') OR coalesce(p ->> 'source', '') NOT IN ('visit_note','staff_flag','pharmacist','message')
     OR jsonb_typeof(p -> 'summary') IS DISTINCT FROM 'string' OR length(btrim(p ->> 'summary')) NOT BETWEEN 3 AND 1000
     OR v_kind = 'klinis' AND (p ? 'category' OR p ? 'triage' AND coalesce(p ->> 'triage', '') NOT IN ('merah','kuning','hijau'))
     OR v_kind = 'layanan' AND (p ? 'triage' OR coalesce(p ->> 'category', '') NOT IN ('waktu_tunggu','tagihan','sikap_staf','lainnya'))
     OR p ? 'visit_id' AND coalesce(p ->> 'visit_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p ? 'branch_id' AND coalesce(p ->> 'branch_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p ->> 'source' = 'visit_note' AND NOT p ? 'visit_id' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: complaint' USING ERRCODE = '22023';
  END IF;
  IF p ->> 'source' = 'message' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: message_source_not_ready' USING ERRCODE = '22023';
  END IF;
  IF a.role = 'manager' AND v_kind <> 'layanan' OR p ->> 'source' = 'pharmacist' AND (a.role <> 'pharmacist' OR v_kind <> 'klinis') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not raise this complaint' USING ERRCODE = '42501';
  END IF;
  v_canon := public.patient_canonical(a.tenant_id, p_patient);
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE tenant_id = a.tenant_id AND id = v_canon) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  IF p ? 'visit_id' THEN
    SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = (p ->> 'visit_id')::uuid;
    IF NOT FOUND OR NOT v.patient_id = ANY (public.patient_cluster(a.tenant_id, v_canon)) OR NOT public.app_branch_allowed(v.branch_id)
       OR a.branch_id IS NOT NULL AND v.branch_id <> a.branch_id OR p ? 'branch_id' AND v.branch_id <> (p ->> 'branch_id')::uuid THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
    END IF;
    v_branch := v.branch_id;
  ELSE
    IF a.branch_id IS NOT NULL AND p ? 'branch_id' AND a.branch_id <> (p ->> 'branch_id')::uuid THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: complaint for another branch' USING ERRCODE = '42501';
    END IF;
    v_branch := coalesce(a.branch_id, (p ->> 'branch_id')::uuid);
    IF v_branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch) OR NOT public.app_branch_allowed(v_branch) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  v_triage := CASE WHEN v_kind = 'klinis' THEN coalesce(p ->> 'triage', 'kuning') END;
  INSERT INTO public.complaint_tasks (tenant_id, branch_id, patient_id, visit_id, kind, source, triage, category, summary, due_at, flagged_by, flagged_as, created_at)
  VALUES (a.tenant_id, v_branch, v_canon, v.id, v_kind, p ->> 'source', v_triage, p ->> 'category', btrim(p ->> 'summary'),
          public.complaint_due_at(a.tenant_id, v_branch, v_kind, v_triage, v_now), a.staff_id, a.role, v_now)
  RETURNING id INTO v_id;
  INSERT INTO public.complaint_events (tenant_id, branch_id, task_id, task_kind, kind, actor_id, actor_role) VALUES (a.tenant_id, v_branch, v_id, v_kind, 'flagged', a.staff_id, a.role);
  PERFORM public.audit_append('settings_change', 'complaint_task', v_id, 'success', 'complaint_flagged');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v_branch, 'ComplaintFlagged', 'complaint_task', v_id,
          jsonb_strip_nulls(jsonb_build_object('task_id', v_id, 'branch_id', v_branch, 'patient_id', v_canon, 'visit_id', v.id, 'kind', v_kind,
                                               'source', p ->> 'source', 'triage', v_triage, 'category', p ->> 'category')))
  RETURNING id INTO v_event;
  FOREACH r IN ARRAY CASE v_kind WHEN 'klinis' THEN ARRAY['doctor','nurse','pharmacist','facility_head'] ELSE ARRAY['manager','facility_head'] END LOOP
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, source_event_id, raised_by)
    VALUES (a.tenant_id, 'complaint_' || v_kind, r, v_branch, 'complaint_task', v_id, v_event, a.staff_id);
  END LOOP;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_flag(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_flag(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- A handler's task, locked: the actor handles the kind and holds the role at the task's branch now.
CREATE FUNCTION public.complaint_handled(a record, p_task uuid) RETURNS public.complaint_tasks
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t public.complaint_tasks;
BEGIN
  SELECT * INTO t FROM public.complaint_tasks x WHERE x.tenant_id = a.tenant_id AND x.id = p_task FOR UPDATE;
  -- The active branch only (impl review P2-1): a handler of several branches acts on the one bound now.
  IF NOT FOUND OR t.branch_id IS DISTINCT FROM a.branch_id OR NOT public.complaint_readable(t.tenant_id, t.branch_id, t.kind) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: complaint not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN t;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_handled(record, uuid) FROM PUBLIC;--> statement-breakpoint

-- One history row, one audit row and one event for a handler's change.
CREATE FUNCTION public.complaint_logged(a record, t public.complaint_tasks, p_kind text, p_note text, p_event text, p_extra jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.complaint_events (tenant_id, branch_id, task_id, task_kind, kind, actor_id, actor_role, note)
  VALUES (t.tenant_id, t.branch_id, t.id, t.kind, p_kind, a.staff_id, a.role, p_note);
  PERFORM public.audit_append('settings_change', 'complaint_task', t.id, 'success', 'complaint_' || p_kind);
  IF p_event IS NOT NULL THEN
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (t.branch_id, p_event, 'complaint_task', t.id, jsonb_strip_nulls(jsonb_build_object('task_id', t.id, 'branch_id', t.branch_id, 'kind', t.kind) || p_extra));
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_logged(record, public.complaint_tasks, text, text, text, jsonb) FROM PUBLIC;--> statement-breakpoint

-- Take (Tangani): an open task becomes in_progress and assigned to the handler (the first taker of the pool).
CREATE FUNCTION public.complaint_take(p_task uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_actor();
  t public.complaint_tasks := public.complaint_handled(a, p_task);
BEGIN
  IF t.state <> 'open' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_taken' USING ERRCODE = '55000';
  END IF;
  UPDATE public.complaint_tasks SET state = 'in_progress', assigned_to = a.staff_id, assigned_as = a.role WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.complaint_logged(a, t, 'taken', NULL, 'ComplaintTaken', jsonb_build_object('assigned_to', a.staff_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_take(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_take(uuid) TO clinic_app;--> statement-breakpoint

-- Re-triage a klinis task (clinicians); the due time is recomputed from the flag time.
CREATE FUNCTION public.complaint_triage(p_task uuid, p_triage text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_actor();
  t public.complaint_tasks := public.complaint_handled(a, p_task);
BEGIN
  IF t.kind <> 'klinis' OR coalesce(p_triage, '') NOT IN ('merah','kuning','hijau') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: triage' USING ERRCODE = '22023';
  END IF;
  IF t.state = 'resolved' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: resolved' USING ERRCODE = '55000';
  END IF;
  IF t.triage = p_triage THEN
    RETURN;
  END IF;
  UPDATE public.complaint_tasks SET triage = p_triage, due_at = public.complaint_due_at(t.tenant_id, t.branch_id, 'klinis', p_triage, t.created_at)
   WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.complaint_logged(a, t, 'triaged', NULL, 'ComplaintTriaged', jsonb_build_object('triage', p_triage));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_triage(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_triage(uuid, text) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.complaint_note(p_task uuid, p_note text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_actor();
  t public.complaint_tasks := public.complaint_handled(a, p_task);
BEGIN
  IF length(btrim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: note' USING ERRCODE = '22023';
  END IF;
  PERFORM public.complaint_logged(a, t, 'note', btrim(p_note), NULL, '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_note(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_note(uuid, text) TO clinic_app;--> statement-breakpoint

-- Resolve with an outcome and a note; an open task is assigned to the resolver.
CREATE FUNCTION public.complaint_resolve(p_task uuid, p_outcome text, p_note text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_actor();
  t public.complaint_tasks := public.complaint_handled(a, p_task);
BEGIN
  IF coalesce(p_outcome, '') NOT IN ('kontrol_gratis','edukasi','resep_tambahan','rujuk','penjelasan','jadwal_ulang','eskalasi_tagihan','pembinaan_staf','lainnya')
     OR length(btrim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: resolution' USING ERRCODE = '22023';
  END IF;
  IF t.state = 'resolved' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: resolved' USING ERRCODE = '55000';
  END IF;
  UPDATE public.complaint_tasks SET state = 'resolved', assigned_to = coalesce(t.assigned_to, a.staff_id), assigned_as = coalesce(t.assigned_as, a.role),
         resolved_at = clock_timestamp(), resolved_by = a.staff_id, resolved_as = a.role, resolution_outcome = p_outcome, resolution_note = btrim(p_note)
   WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.complaint_logged(a, t, 'resolved', btrim(p_note), 'ComplaintResolved', jsonb_build_object('outcome', p_outcome));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_resolve(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_resolve(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- Reopen a resolved task with a reason: back to in_progress, the resolution cleared (history keeps it).
CREATE FUNCTION public.complaint_reopen(p_task uuid, p_note text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_actor();
  t public.complaint_tasks := public.complaint_handled(a, p_task);
BEGIN
  IF length(btrim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: note' USING ERRCODE = '22023';
  END IF;
  IF t.state <> 'resolved' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_resolved' USING ERRCODE = '55000';
  END IF;
  UPDATE public.complaint_tasks SET state = 'in_progress', resolved_at = NULL, resolved_by = NULL, resolved_as = NULL, resolution_outcome = NULL, resolution_note = NULL
   WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.complaint_logged(a, t, 'reopened', btrim(p_note), 'ComplaintReopened', '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_reopen(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_reopen(uuid, text) TO clinic_app;--> statement-breakpoint

-- ── Readers (definer; plan r1 P1-1, P1-4) ─────────────────────────────────────────────────────────
-- Actor lock first (DEC-043), then clinical_read; overdue tasks escalate only while the tenant may serve visits.
-- Content (summary, resolution, event notes) only for a handler of the kind at the task's branch (the read helper);
-- a flagger outside the handlers sees the status of the tasks they flagged; the therapist is refused.
CREATE FUNCTION public.complaint_reader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('fo_cashier','central_cs','bc','doctor','nurse','pharmacist','facility_head','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read Keluhan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot read clinical data now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_reader() FROM PUBLIC;--> statement-breakpoint

-- One task as the reader may see it (content or status).
CREATE FUNCTION public.complaint_json(t public.complaint_tasks, p_content boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', t.id, 'branch_id', t.branch_id, 'branch_name', b.name, 'patient_id', t.patient_id,
           'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'visit_id', t.visit_id, 'kind', t.kind, 'source', t.source,
           'triage', t.triage, 'category', t.category, 'state', t.state, 'due_at', t.due_at,
           'overdue', t.state <> 'resolved' AND clock_timestamp() > t.due_at, 'assigned_to', t.assigned_to,
           'assigned_to_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = t.tenant_id AND s.id = t.assigned_to),
           'flagged_by', t.flagged_by, 'flagged_by_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = t.tenant_id AND s.id = t.flagged_by),
           'flagged_as', t.flagged_as, 'created_at', t.created_at, 'resolved_at', t.resolved_at, 'escalated_at', t.escalated_at, 'content', p_content)
    || CASE WHEN p_content THEN jsonb_build_object('summary', t.summary, 'resolution_outcome', t.resolution_outcome, 'resolution_note', t.resolution_note,
                                                   'resolved_by_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = t.tenant_id AND s.id = t.resolved_by))
            ELSE '{}'::jsonb END
    FROM public.branches b, public.patients pt
   WHERE b.tenant_id = t.tenant_id AND b.id = t.branch_id AND pt.tenant_id = t.tenant_id AND pt.id = public.patient_canonical(t.tenant_id, t.patient_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_json(public.complaint_tasks, boolean) FROM PUBLIC;--> statement-breakpoint

-- The list: p_branch narrows a reader without an active branch (central CS); p_kind narrows to one kind.
-- Unresolved first (most urgent due time), then resolved in the last 30 days.
CREATE FUNCTION public.complaint_list(p_branch uuid, p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_reader();
  v_branch uuid;
BEGIN
  IF p_kind IS NOT NULL AND p_kind NOT IN ('klinis','layanan') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kind' USING ERRCODE = '22023';
  END IF;
  v_branch := coalesce(a.branch_id, p_branch);
  -- A named branch must be the tenant's (impl review P2-2: a Level 2 session allows every id).
  IF v_branch IS NOT NULL AND (NOT public.app_branch_allowed(v_branch)
     OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch)
     OR a.branch_id IS NOT NULL AND p_branch IS NOT NULL AND p_branch <> a.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF public.tenant_capability('existing_appointment') THEN
    PERFORM public.complaint_escalate_due(a.tenant_id, v_branch);
  END IF;
  RETURN jsonb_build_object('role', a.role, 'tasks', coalesce((
    SELECT jsonb_agg(public.complaint_json(t, public.complaint_readable(t.tenant_id, t.branch_id, t.kind))
                     ORDER BY t.state = 'resolved', CASE WHEN t.state = 'resolved' THEN NULL ELSE t.due_at END, t.resolved_at DESC, t.id)
      FROM public.complaint_tasks t
     WHERE t.tenant_id = a.tenant_id AND (v_branch IS NULL AND public.app_branch_allowed(t.branch_id) OR t.branch_id = v_branch)
       AND (p_kind IS NULL OR t.kind = p_kind)
       AND (public.complaint_readable(t.tenant_id, t.branch_id, t.kind) OR t.flagged_by = a.staff_id)
       AND (t.state <> 'resolved' OR t.resolved_at > clock_timestamp() - interval '30 days')), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_list(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_list(uuid, text) TO clinic_app;--> statement-breakpoint

-- One task with its history (notes for a handler only). A handler's klinis read is audited as clinical_read.
CREATE FUNCTION public.complaint_get(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_reader();
  t public.complaint_tasks;
  v_content boolean;
BEGIN
  SELECT * INTO t FROM public.complaint_tasks x WHERE x.tenant_id = a.tenant_id AND x.id = p_task;
  v_content := FOUND AND public.complaint_readable(t.tenant_id, t.branch_id, t.kind);
  IF NOT FOUND OR NOT public.app_branch_allowed(t.branch_id) OR a.branch_id IS NOT NULL AND t.branch_id <> a.branch_id
     OR NOT v_content AND t.flagged_by <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: complaint not found' USING ERRCODE = 'P0002';
  END IF;
  IF public.tenant_capability('existing_appointment') THEN
    PERFORM public.complaint_escalate_due(a.tenant_id, t.branch_id);
    SELECT * INTO t FROM public.complaint_tasks x WHERE x.tenant_id = a.tenant_id AND x.id = p_task;
  END IF;
  IF v_content AND t.kind = 'klinis' THEN
    PERFORM public.audit_append('clinical_read', 'complaint_task', t.id, 'success');
  END IF;
  RETURN public.complaint_json(t, v_content) || jsonb_build_object(
    'handler', v_content, 'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'actor_id', e.actor_id, 'actor_role', e.actor_role,
               'actor_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = e.tenant_id AND s.id = e.actor_id), 'created_at', e.created_at)
               || CASE WHEN v_content THEN jsonb_build_object('note', e.note) ELSE '{}'::jsonb END ORDER BY e.created_at, e.id)
        FROM public.complaint_events e WHERE e.tenant_id = t.tenant_id AND e.task_id = t.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_get(uuid) TO clinic_app;--> statement-breakpoint

-- The flag form's visits: today's visits at the branch (open, or closed today), names only.
CREATE FUNCTION public.complaint_flag_options(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.complaint_reader();
  b public.branches;
  today date;
BEGIN
  IF a.branch_id IS NOT NULL AND p_branch IS NOT NULL AND p_branch <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, coalesce(a.branch_id, p_branch));
  today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object('role', a.role, 'branch_id', b.id, 'branch_name', b.name, 'visits', coalesce((
    SELECT jsonb_agg(jsonb_build_object('visit_id', v.id, 'patient_id', pt.id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'checked_in_at', v.checked_in_at)
                     ORDER BY v.checked_in_at, v.id)
      FROM public.visits v
      JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id)
     WHERE v.tenant_id = a.tenant_id AND v.branch_id = b.id
       AND (v.closed_at IS NULL AND (v.checked_in_at AT TIME ZONE b.timezone)::date = today OR (v.closed_at AT TIME ZONE b.timezone)::date = today)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complaint_flag_options(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complaint_flag_options(uuid) TO clinic_app;
