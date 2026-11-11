CREATE TABLE "treatment_execution_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stage" text,
	"outcome" text,
	"command_key" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"by" uuid NOT NULL,
	"as" text NOT NULL,
	CONSTRAINT "treatment_execution_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "treatment_execution_events_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "treatment_execution_events_check" CHECK ("treatment_execution_events"."kind" in ('start','stage','pause','resume','finish') and "treatment_execution_events"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "treatment_execution_events"."as" in ('doctor','nurse','therapist')
      and (("treatment_execution_events"."kind" = 'stage') = ("treatment_execution_events"."stage" is not null)) and (("treatment_execution_events"."kind" = 'finish') = ("treatment_execution_events"."outcome" is not null))
      and ("treatment_execution_events"."stage" is null or "treatment_execution_events"."stage" in ('preparation','anesthesia','procedure','recovery')) and ("treatment_execution_events"."outcome" is null or "treatment_execution_events"."outcome" in ('completed','medical_stop','clinic_stop','patient_stop')))
);
--> statement-breakpoint
CREATE TABLE "treatment_executions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"room_id" uuid,
	"material_request_id" uuid,
	"performer_staff_id" uuid NOT NULL,
	"assisting_staff_id" uuid,
	"supervisor_staff_id" uuid,
	"identity_confirmed" boolean NOT NULL,
	"state" text DEFAULT 'started' NOT NULL,
	"stage" text DEFAULT 'preparation' NOT NULL,
	"stage_started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"paused_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"started_by" uuid NOT NULL,
	"started_as" text NOT NULL,
	"start_command_key" text NOT NULL,
	"finished_at" timestamp with time zone,
	"finished_by" uuid,
	"finished_as" text,
	"finish_command_key" text,
	"outcome" text,
	"counted" boolean GENERATED ALWAYS AS (outcome in ('completed','patient_stop')) STORED,
	"stop_reason" text,
	CONSTRAINT "treatment_executions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "treatment_executions_scope_key" UNIQUE("tenant_id","branch_id","visit_id","id"),
	CONSTRAINT "treatment_executions_item_key" UNIQUE("tenant_id","visit_id","plan_item_id"),
	CONSTRAINT "treatment_executions_request_key" UNIQUE("tenant_id","material_request_id"),
	CONSTRAINT "treatment_executions_start_key" UNIQUE("tenant_id","start_command_key"),
	CONSTRAINT "treatment_executions_finish_key" UNIQUE("tenant_id","finish_command_key"),
	CONSTRAINT "treatment_executions_check" CHECK ("treatment_executions"."state" in ('started','paused','finished') and "treatment_executions"."stage" in ('preparation','anesthesia','procedure','recovery')
      and "treatment_executions"."started_as" in ('doctor','nurse','therapist') and "treatment_executions"."identity_confirmed" and "treatment_executions"."start_command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and ("treatment_executions"."assisting_staff_id" is null or "treatment_executions"."assisting_staff_id" <> "treatment_executions"."performer_staff_id")
      and ("treatment_executions"."supervisor_staff_id" is null or "treatment_executions"."supervisor_staff_id" <> "treatment_executions"."performer_staff_id")
      and (("treatment_executions"."state" = 'paused') = ("treatment_executions"."paused_at" is not null))
      and (("treatment_executions"."state" = 'finished') = ("treatment_executions"."finished_at" is not null)) and num_nonnulls("treatment_executions"."finished_at", "treatment_executions"."finished_by", "treatment_executions"."finished_as", "treatment_executions"."finish_command_key", "treatment_executions"."outcome") in (0, 5)
      and ("treatment_executions"."finished_as" is null or "treatment_executions"."finished_as" in ('doctor','nurse','therapist')) and ("treatment_executions"."finish_command_key" is null or "treatment_executions"."finish_command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$')
      and ("treatment_executions"."outcome" is null or "treatment_executions"."outcome" in ('completed','medical_stop','clinic_stop','patient_stop'))
      and (("treatment_executions"."outcome" in ('medical_stop','clinic_stop','patient_stop')) = ("treatment_executions"."stop_reason" is not null))
      and ("treatment_executions"."stop_reason" is null or length(btrim("treatment_executions"."stop_reason")) between 3 and 500))
);
--> statement-breakpoint
ALTER TABLE "treatment_execution_events" ADD CONSTRAINT "treatment_execution_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_execution_events" ADD CONSTRAINT "treatment_execution_events_execution_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id","execution_id") REFERENCES "public"."treatment_executions"("tenant_id","branch_id","visit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_execution_events" ADD CONSTRAINT "treatment_execution_events_by_fk" FOREIGN KEY ("tenant_id","by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_plan_item_fk" FOREIGN KEY ("tenant_id","plan_item_id") REFERENCES "public"."plan_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_room_fk" FOREIGN KEY ("tenant_id","branch_id","room_id") REFERENCES "public"."rooms"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_request_fk" FOREIGN KEY ("tenant_id","branch_id","material_request_id") REFERENCES "public"."material_requests"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_performer_fk" FOREIGN KEY ("tenant_id","performer_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_assistant_fk" FOREIGN KEY ("tenant_id","assisting_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_supervisor_fk" FOREIGN KEY ("tenant_id","supervisor_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_started_by_fk" FOREIGN KEY ("tenant_id","started_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_executions" ADD CONSTRAINT "treatment_executions_finished_by_fk" FOREIGN KEY ("tenant_id","finished_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "treatment_execution_events_execution_idx" ON "treatment_execution_events" USING btree ("tenant_id","execution_id","at");--> statement-breakpoint
CREATE INDEX "treatment_executions_branch_idx" ON "treatment_executions" USING btree ("tenant_id","branch_id","state","started_at");--> statement-breakpoint

-- T-064 rules (generated by gen.py; plan docs/tasks/T-064.md)
-- ── Readers and actor (open point 8; P3-1) ─────────────────────────────────────────────────────────────────────
-- Executions are read by the room roles (doctor, nurse, therapist) at their branch, on the wall clock.
CREATE FUNCTION public.treatment_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant)
    AND public.app_role_in(ARRAY['doctor','nurse','therapist'])
    AND public.app_branch_allowed(p_branch) AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.treatment_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- The actor of every writer and reader: the staff_access lock first (DEC-043), a room role with its active branch,
-- the tenant serving visits.
CREATE FUNCTION public.treatment_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('doctor','nurse','therapist') OR branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not use the treatment room' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_actor() FROM PUBLIC;--> statement-breakpoint

-- The visit at the actor's branch, locked (lock order: staff_access → visit → execution → material requests →
-- batches → holdings → costs).
CREATE FUNCTION public.treatment_visit_locked(p_tenant uuid, p_branch uuid, p_visit uuid) RETURNS public.visits
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.visits;
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = p_tenant AND x.id = p_visit FOR UPDATE;
  IF NOT FOUND OR v.branch_id <> p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_visit_locked(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- An execution at the actor's branch with its visit locked first (r2 note 1: visit → execution, as in start).
CREATE FUNCTION public.treatment_execution_locked(p_tenant uuid, p_branch uuid, p_execution uuid) RETURNS public.treatment_executions
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_visit uuid;
  e public.treatment_executions;
BEGIN
  SELECT x.visit_id INTO v_visit FROM public.treatment_executions x WHERE x.tenant_id = p_tenant AND x.id = p_execution AND x.branch_id = p_branch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: execution not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.treatment_visit_locked(p_tenant, p_branch, v_visit);
  SELECT * INTO e FROM public.treatment_executions x WHERE x.tenant_id = p_tenant AND x.id = p_execution FOR UPDATE;
  RETURN e;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_execution_locked(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The material requests of an execution: non-cancelled requests of its visit with its plan item or the linked one,
-- not linked to another execution (P1-1).
CREATE FUNCTION public.treatment_requests(e public.treatment_executions) RETURNS SETOF public.material_requests
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT r.* FROM public.material_requests r
   WHERE r.tenant_id = e.tenant_id AND r.branch_id = e.branch_id AND r.visit_id = e.visit_id AND r.state <> 'cancelled'
     AND (r.id = e.material_request_id OR r.plan_item_id = e.plan_item_id)
     AND NOT EXISTS (SELECT 1 FROM public.treatment_executions o WHERE o.tenant_id = r.tenant_id AND o.material_request_id = r.id AND o.id <> e.id)
   ORDER BY r.id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_requests(public.treatment_executions) FROM PUBLIC;--> statement-breakpoint

-- The item-level blockers that need no performer (P2-1): payment, examination, contraindication, consent. Mirrors
-- treatment_start_check's rules (0073) without its audit row; the performer-dependent ones (credential, delegation)
-- come from the eligible-performer list.
CREATE FUNCTION public.treatment_item_blockers(v public.visits, p_item uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b text[] := '{}';
  e public.examinations;
  t public.plan_items;
  k public.procedure_consents;
BEGIN
  SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = v.tenant_id AND x.id = p_item;
  IF v.payment IN ('in_progress','blocked') THEN b := b || 'payment_unpaid'::text; END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = v.tenant_id AND x.visit_id = v.id;
  IF e.id IS NULL OR e.state <> 'signed' THEN b := b || 'examination_unsigned'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.contraindication_reviews r WHERE r.tenant_id = v.tenant_id AND r.examination_id = e.id AND r.plan_item_id = t.id AND r.decision = 'blocked')
     OR EXISTS (SELECT 1 FROM public.catalog_versions cv WHERE cv.tenant_id = v.tenant_id AND cv.id = t.catalog_version_id AND NULLIF(btrim(cv.contraindications), '') IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM public.contraindication_reviews r WHERE r.tenant_id = v.tenant_id AND r.examination_id = e.id AND r.plan_item_id = t.id AND r.decision = 'cleared') THEN
    b := b || 'contraindication_unresolved'::text;
  END IF;
  SELECT * INTO k FROM public.procedure_consents x WHERE x.tenant_id = v.tenant_id AND x.plan_id = t.plan_id AND x.state = 'active';
  IF k.id IS NULL THEN
    b := b || 'consent_missing'::text;
  ELSIF public.consent_state(v.tenant_id, t.plan_id) <> 'active' THEN
    b := b || 'consent_mismatch'::text;
  END IF;
  RETURN b;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_item_blockers(public.visits, uuid) FROM PUBLIC;--> statement-breakpoint

-- Close the visit's treatment step when no execution of it is open: done, unless nothing was started.
CREATE FUNCTION public.treatment_visit_step(p_tenant uuid, p_visit uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.visits SET treatment = CASE
           WHEN EXISTS (SELECT 1 FROM public.treatment_executions e WHERE e.tenant_id = p_tenant AND e.visit_id = p_visit AND e.state IN ('started','paused')) THEN 'in_progress'
           ELSE 'done' END
   WHERE tenant_id = p_tenant AND id = p_visit AND closed_at IS NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_visit_step(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.treatment_executions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY treatment_executions_read ON public.treatment_executions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.treatment_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.treatment_executions TO clinic_app;--> statement-breakpoint
CREATE POLICY treatment_executions_operator_read ON public.treatment_executions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.treatment_executions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.treatment_executions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER treatment_executions_no_truncate BEFORE TRUNCATE ON public.treatment_executions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.treatment_executions ENABLE ALWAYS TRIGGER treatment_executions_no_truncate;--> statement-breakpoint
ALTER TABLE public.treatment_execution_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY treatment_execution_events_read ON public.treatment_execution_events FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.treatment_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.treatment_execution_events TO clinic_app;--> statement-breakpoint
CREATE POLICY treatment_execution_events_operator_read ON public.treatment_execution_events FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.treatment_execution_events', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.treatment_execution_events TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER treatment_execution_events_no_truncate BEFORE TRUNCATE ON public.treatment_execution_events FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.treatment_execution_events ENABLE ALWAYS TRIGGER treatment_execution_events_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.treatment_executions', 'branch-scoped', 'treatment', '{doctor,nurse,therapist}', 'treatment definers (src/modules/treatment)', 'the visit''s branch'),
  ('public.treatment_execution_events', 'branch-scoped', 'treatment', '{doctor,nurse,therapist}', 'treatment definers (src/modules/treatment)', 'the visit''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): treatment executions are clinical records.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.treatment_executions', 'clinical'),
  ('public.treatment_execution_events', 'clinical');--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS, after the staff_access lock) ─────────────────────────────────────────────────────────
-- Executions: never deleted; open started at preparation; identity, people, room, request and start frozen; states
-- started ⇄ paused → finished; stages only forward; finished is final.
CREATE FUNCTION public.treatment_executions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  st constant text[] := ARRAY['preparation','anesthesia','procedure','recovery'];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'treatment executions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'started' OR NEW.stage <> 'preparation' OR NEW.outcome IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = NEW.tenant_id AND v.branch_id = NEW.branch_id AND v.id = NEW.visit_id AND v.closed_at IS NULL) THEN
      RAISE EXCEPTION 'an execution opens started on an open visit' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.plan_item_id, NEW.room_id, NEW.material_request_id, NEW.performer_staff_id,
      NEW.assisting_staff_id, NEW.supervisor_staff_id, NEW.identity_confirmed, NEW.started_at, NEW.started_by, NEW.started_as, NEW.start_command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.plan_item_id, OLD.room_id, OLD.material_request_id, OLD.performer_staff_id,
      OLD.assisting_staff_id, OLD.supervisor_staff_id, OLD.identity_confirmed, OLD.started_at, OLD.started_by, OLD.started_as, OLD.start_command_key)
     OR OLD.state = 'finished'
     OR array_position(st, NEW.stage) < array_position(st, OLD.stage)
     OR NOT (OLD.state = 'started' AND NEW.state IN ('started','paused','finished') OR OLD.state = 'paused' AND NEW.state IN ('started','finished'))
     OR NEW.stage <> OLD.stage AND (OLD.state <> 'started' OR NEW.state <> 'started') THEN
    RAISE EXCEPTION 'an execution only moves forward and closes once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_executions_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER treatment_executions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.treatment_executions FOR EACH ROW EXECUTE FUNCTION public.treatment_executions_guard();--> statement-breakpoint
ALTER TABLE public.treatment_executions ENABLE ALWAYS TRIGGER treatment_executions_guard;--> statement-breakpoint

CREATE FUNCTION public.treatment_execution_events_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'execution events are never changed or deleted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_execution_events_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER treatment_execution_events_guard BEFORE INSERT OR UPDATE OR DELETE ON public.treatment_execution_events FOR EACH ROW EXECUTE FUNCTION public.treatment_execution_events_guard();--> statement-breakpoint
ALTER TABLE public.treatment_execution_events ENABLE ALWAYS TRIGGER treatment_execution_events_guard;--> statement-breakpoint

-- ── Writers (open points 2–6; P1-1, P1-2, P2-1, P2-2, P2-3) ────────────────────────────────────────────────────
-- Every writer runs through runCommand and stores its command key on its event row (unique per tenant).

-- Mulai (PR-11, PR-14): the gate (treatment_start_check, 0073) plus payment; people, room and the material request
-- validated; one execution per (visit, plan item). p: {plan_item_id, performer_id, assistant_id?, supervisor_id?,
-- room_id?, material_request_id?, identity_confirmed: true}.
CREATE FUNCTION public.treatment_start(p_key text, p_visit uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.treatment_actor();
  v public.visits := public.treatment_visit_locked(a.tenant_id, a.branch_id, p_visit);
  r public.material_requests;
  v_item uuid;
  v_performer uuid;
  v_assistant uuid;
  v_supervisor uuid;
  v_room uuid;
  v_request uuid;
  g jsonb;
  b jsonb;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (p -> 'identity_confirmed') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: confirm the patient''s identity' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_item := NULLIF(p ->> 'plan_item_id', '')::uuid;
    v_performer := NULLIF(p ->> 'performer_id', '')::uuid;
    v_assistant := NULLIF(p ->> 'assistant_id', '')::uuid;
    v_supervisor := NULLIF(p ->> 'supervisor_id', '')::uuid;
    v_room := NULLIF(p ->> 'room_id', '')::uuid;
    v_request := NULLIF(p ->> 'material_request_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: start' USING ERRCODE = '22023';
  END;
  IF v_item IS NULL OR v_performer IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: plan item and performer' USING ERRCODE = '22023';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the visit is closed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.treatment_executions x WHERE x.tenant_id = v.tenant_id AND x.visit_id = v.id AND x.plan_item_id = v_item) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: this item was already started on this visit' USING ERRCODE = '55000';
  END IF;
  -- People (P2-3): the assistant a room role of the branch ≠ performer; a supervisor a credentialed doctor ≠ performer.
  IF v_assistant IS NOT NULL AND (v_assistant = v_performer OR NOT (public.consent_staff_role(v.tenant_id, v_assistant, v.branch_id, 'doctor')
       OR public.consent_staff_role(v.tenant_id, v_assistant, v.branch_id, 'nurse') OR public.consent_staff_role(v.tenant_id, v_assistant, v.branch_id, 'therapist'))) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: assistant' USING ERRCODE = '22023';
  END IF;
  IF v_supervisor IS NOT NULL AND (v_supervisor = v_performer OR NOT public.consent_staff_role(v.tenant_id, v_supervisor, v.branch_id, 'doctor')
       OR NOT public.credential_valid(v_supervisor, v.branch_id, clock_timestamp())) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: supervisor' USING ERRCODE = '22023';
  END IF;
  -- The material request (P1-1): issued, unconsumed, of this visit, for this item or none, not linked elsewhere.
  IF v_request IS NOT NULL THEN
    SELECT * INTO r FROM public.material_requests x WHERE x.tenant_id = v.tenant_id AND x.id = v_request FOR UPDATE;
    IF NOT FOUND OR r.branch_id <> v.branch_id OR r.visit_id <> v.id OR (r.plan_item_id IS NOT NULL AND r.plan_item_id <> v_item) OR r.state <> 'issued'
       OR EXISTS (SELECT 1 FROM public.material_consumptions c WHERE c.tenant_id = r.tenant_id AND c.request_id = r.id)
       OR EXISTS (SELECT 1 FROM public.treatment_executions x WHERE x.tenant_id = r.tenant_id AND x.material_request_id = r.id) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: material request' USING ERRCODE = '22023';
    END IF;
    v_room := coalesce(v_room, (SELECT d.room_id FROM public.depots d WHERE d.tenant_id = r.tenant_id AND d.id = r.room_depot_id));
  END IF;
  IF v_room IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rooms x WHERE x.tenant_id = v.tenant_id AND x.branch_id = v.branch_id AND x.id = v_room AND x.kind = 'treatment' AND x.is_active) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: room' USING ERRCODE = '22023';
  END IF;
  -- The gate (0073) for this item, performer and supervisor; payment (P2-1; not_started allowed until the cashier).
  g := public.treatment_start_check(v.id, ARRAY[v_item], v_performer, v_supervisor);
  b := g -> 'blockers';
  IF v.payment IN ('in_progress','blocked') THEN
    b := b || '"payment_unpaid"'::jsonb;
  END IF;
  IF jsonb_array_length(b) > 0 THEN
    RAISE EXCEPTION 'ERR_START_BLOCKED: %', (SELECT string_agg(x, ',') FROM jsonb_array_elements_text(b) x) USING ERRCODE = 'P0422';
  END IF;
  BEGIN
    INSERT INTO public.treatment_executions (tenant_id, branch_id, visit_id, plan_item_id, room_id, material_request_id, performer_staff_id, assisting_staff_id,
                                             supervisor_staff_id, identity_confirmed, started_by, started_as, start_command_key)
    VALUES (v.tenant_id, v.branch_id, v.id, v_item, v_room, v_request, v_performer, v_assistant, v_supervisor, true, a.staff_id, a.role, p_key)
    RETURNING id INTO v_id;
    INSERT INTO public.treatment_execution_events (tenant_id, branch_id, visit_id, execution_id, kind, command_key, by, "as")
    VALUES (v.tenant_id, v.branch_id, v.id, v_id, 'start', p_key, a.staff_id, a.role);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a start with this key exists' USING ERRCODE = '23505';
  END;
  UPDATE public.visits SET treatment = 'in_progress' WHERE tenant_id = v.tenant_id AND id = v.id;
  PERFORM public.audit_append('sign', 'treatment_execution', v_id, 'success', 'treatment_started');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v.branch_id, 'TreatmentStarted', 'treatment_execution', v_id,
          jsonb_build_object('execution_id', v_id, 'visit_id', v.id, 'plan_item_id', v_item, 'performer_id', v_performer));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_start(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.treatment_start(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Stage, pause, resume (P2-2): times only; stages strictly forward while started; a resume shifts the stage start by
-- the pause so the timer excludes it. p_action: 'stage' (p_stage), 'pause', 'resume'.
CREATE FUNCTION public.treatment_timer(p_key text, p_execution uuid, p_action text, p_stage text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.treatment_actor();
  e public.treatment_executions := public.treatment_execution_locked(a.tenant_id, a.branch_id, p_execution);
  st constant text[] := ARRAY['preparation','anesthesia','procedure','recovery'];
BEGIN
  IF p_action = 'stage' THEN
    IF e.state <> 'started' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: execution %', e.state USING ERRCODE = '55000';
    END IF;
    IF p_stage IS NULL OR array_position(st, p_stage) IS NULL OR array_position(st, p_stage) <= array_position(st, e.stage) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: stage' USING ERRCODE = '22023';
    END IF;
    UPDATE public.treatment_executions SET stage = p_stage, stage_started_at = clock_timestamp() WHERE tenant_id = e.tenant_id AND id = e.id;
  ELSIF p_action = 'pause' THEN
    IF e.state <> 'started' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: execution %', e.state USING ERRCODE = '55000';
    END IF;
    UPDATE public.treatment_executions SET state = 'paused', paused_at = clock_timestamp() WHERE tenant_id = e.tenant_id AND id = e.id;
  ELSIF p_action = 'resume' THEN
    IF e.state <> 'paused' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: execution %', e.state USING ERRCODE = '55000';
    END IF;
    UPDATE public.treatment_executions SET state = 'started', stage_started_at = stage_started_at + (clock_timestamp() - paused_at), paused_at = NULL
     WHERE tenant_id = e.tenant_id AND id = e.id;
  ELSE
    RAISE EXCEPTION 'ERR_INVALID_INPUT: action' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.treatment_execution_events (tenant_id, branch_id, visit_id, execution_id, kind, stage, command_key, by, "as")
    VALUES (e.tenant_id, e.branch_id, e.visit_id, e.id, p_action, CASE WHEN p_action = 'stage' THEN p_stage END, p_key, a.staff_id, a.role);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an event with this key exists' USING ERRCODE = '23505';
  END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_timer(text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.treatment_timer(text, uuid, text, text) TO clinic_app;--> statement-breakpoint

-- Selesai Tindakan (PR-14, P1-1): one of the four outcomes, a reason for the three stops; the execution's material
-- requests are consumed in the same transaction (every issued, unconsumed one; refused while one is still open),
-- each with a key derived from the finish key and the request; the visit's treatment step and a clinic-stop blocker
-- for the front office; TreatmentFinished {execution_id, visit_id, plan_item_id, outcome, counted, performer_id}.
-- p: {outcome, reason?, materials?: {<request id>: [{item_id, quantity, batch_id?}]}}.
CREATE FUNCTION public.treatment_finish(p_key text, p_execution uuid, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.treatment_actor();
  e public.treatment_executions := public.treatment_execution_locked(a.tenant_id, a.branch_id, p_execution);
  r public.material_requests;
  v_outcome text := p ->> 'outcome';
  v_reason text := NULLIF(btrim(coalesce(p ->> 'reason', '')), '');
  v_lines jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_outcome IS NULL OR v_outcome NOT IN ('completed','medical_stop','clinic_stop','patient_stop')
     OR (p ? 'materials' AND jsonb_typeof(p -> 'materials') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outcome' USING ERRCODE = '22023';
  END IF;
  IF (v_outcome <> 'completed') <> (v_reason IS NOT NULL) OR v_reason IS NOT NULL AND length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a stop needs its reason (3–500 characters); completion has none' USING ERRCODE = '22023';
  END IF;
  IF e.state = 'finished' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the execution is finished' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.treatment_requests(e) x WHERE x.state = 'open') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: material_request_open' USING ERRCODE = '55000';
  END IF;
  IF p ? 'materials' AND EXISTS (SELECT 1 FROM jsonb_object_keys(p -> 'materials') k
                                  WHERE NOT EXISTS (SELECT 1 FROM public.treatment_requests(e) x WHERE x.id::text = k AND x.state = 'issued')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: materials name a request of this treatment' USING ERRCODE = '22023';
  END IF;
  BEGIN
    UPDATE public.treatment_executions SET state = 'finished', paused_at = NULL, finished_at = clock_timestamp(), finished_by = a.staff_id, finished_as = a.role,
           finish_command_key = p_key, outcome = v_outcome, stop_reason = v_reason
     WHERE tenant_id = e.tenant_id AND id = e.id;
    INSERT INTO public.treatment_execution_events (tenant_id, branch_id, visit_id, execution_id, kind, outcome, command_key, by, "as")
    VALUES (e.tenant_id, e.branch_id, e.visit_id, e.id, 'finish', v_outcome, p_key, a.staff_id, a.role);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a finish with this key exists' USING ERRCODE = '23505';
  END;
  -- The actual materials (PR-14): every issued request of the treatment not consumed yet.
  FOR r IN SELECT * FROM public.treatment_requests(e) x
            WHERE x.state = 'issued' AND NOT EXISTS (SELECT 1 FROM public.material_consumptions c WHERE c.tenant_id = x.tenant_id AND c.request_id = x.id) LOOP
    v_lines := p -> 'materials' -> r.id::text;
    PERFORM public.material_consume(encode(sha256(convert_to(p_key || ':' || r.id::text, 'UTF8')), 'hex'), r.id,
                                    CASE WHEN v_lines IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('lines', v_lines) END);
  END LOOP;
  PERFORM public.treatment_visit_step(e.tenant_id, e.visit_id);
  IF v_outcome = 'clinic_stop' THEN
    UPDATE public.visits SET blocker = 'Dihentikan klinik — jadwalkan ulang atau saldo' WHERE tenant_id = e.tenant_id AND id = e.visit_id AND closed_at IS NULL;
  END IF;
  PERFORM public.audit_append('sign', 'treatment_execution', e.id, 'success', 'treatment_' || v_outcome);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (e.branch_id, 'TreatmentFinished', 'treatment_execution', e.id,
          jsonb_build_object('execution_id', e.id, 'visit_id', e.visit_id, 'plan_item_id', e.plan_item_id, 'outcome', v_outcome,
                             'counted', v_outcome IN ('completed','patient_stop'), 'performer_id', e.performer_staff_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_finish(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.treatment_finish(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── Readers (open point 7; P1-3, P2-1) ─────────────────────────────────────────────────────────────────────────
-- Today's room list at the active branch: open visits and those closed today with a live plan item of an active plan
-- of the patient's cluster or an execution, blocked ones included; per visit the room (an execution's, else the
-- appointment's treatment-room reservation, r2 note 2), the items with their execution state and the VisitTrack
-- steps. No clinical text beyond the treatment names.
CREATE FUNCTION public.treatment_room_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.treatment_actor();
  b public.branches;
  v_today date;
BEGIN
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = a.branch_id;
  IF NOT FOUND OR NOT public.treatment_readable(a.tenant_id, a.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  v_today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object('now', clock_timestamp(), 'today', v_today, 'branch_name', b.name, 'visits', coalesce((
    SELECT jsonb_agg(x.j ORDER BY x.checked_in_at, x.id) FROM (
      SELECT v.id, v.checked_in_at, jsonb_build_object('visit_id', v.id, 'checked_in_at', v.checked_in_at, 'closed', v.closed_at IS NOT NULL,
               'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'blocker', v.blocker,
               'steps', jsonb_build_object('intake', v.intake, 'doctor', v.doctor, 'selection', v.selection, 'consent', v.consent, 'payment', v.payment,
                                           'preparation', v.preparation, 'treatment', v.treatment, 'dispensing', v.dispensing),
               'room', coalesce(
                 (SELECT jsonb_build_object('id', r.id, 'name', r.name) FROM public.treatment_executions e JOIN public.rooms r ON r.tenant_id = e.tenant_id AND r.id = e.room_id
                   WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id ORDER BY e.started_at DESC LIMIT 1),
                 (SELECT jsonb_build_object('id', r.id, 'name', r.name) FROM public.resource_reservations rr JOIN public.rooms r ON r.tenant_id = rr.tenant_id AND r.id = rr.resource_id
                   WHERE v.appointment_id IS NOT NULL AND rr.tenant_id = v.tenant_id AND rr.appointment_id = v.appointment_id AND rr.kind = 'room' AND r.kind = 'treatment'
                   ORDER BY rr.active DESC, rr.id LIMIT 1)),
               'items', coalesce((
                 SELECT jsonb_agg(jsonb_build_object('plan_item_id', t.id, 'name', cv.name, 'stage', t.stage,
                          'execution', (SELECT jsonb_build_object('id', e.id, 'state', e.state, 'stage', e.stage, 'stage_started_at', e.stage_started_at,
                                                                  'paused_at', e.paused_at, 'outcome', e.outcome)
                                          FROM public.treatment_executions e WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id AND e.plan_item_id = t.id))
                          ORDER BY t.stage, cv.name, t.id)
                   FROM public.plan_items t JOIN public.care_plans c ON c.tenant_id = t.tenant_id AND c.id = t.plan_id
                   JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
                  WHERE t.tenant_id = v.tenant_id AND (t.removed_at IS NULL AND c.state = 'active' AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, pt.id))
                        OR EXISTS (SELECT 1 FROM public.treatment_executions e WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id AND e.plan_item_id = t.id))), '[]'::jsonb)
             ) AS j
        FROM public.visits v
        JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id)
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = b.id
         AND (v.closed_at IS NULL AND (v.checked_in_at AT TIME ZONE b.timezone)::date = v_today OR (v.closed_at AT TIME ZONE b.timezone)::date = v_today)
         AND (EXISTS (SELECT 1 FROM public.plan_items t JOIN public.care_plans c ON c.tenant_id = t.tenant_id AND c.id = t.plan_id
                       WHERE t.tenant_id = v.tenant_id AND t.removed_at IS NULL AND c.state = 'active' AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, pt.id)))
              OR EXISTS (SELECT 1 FROM public.treatment_executions e WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id))) x), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_room_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.treatment_room_list() TO clinic_app;--> statement-breakpoint

-- One visit for the room (UX-9): items with their item-level blockers, eligible performers and supervisors per item,
-- the executions, the material requests (T-062's view), and for the materials sheet the branch's ruang depots, the
-- active stock items and the open vials of the requests' batches in ruang depots. One audited clinical read.
CREATE FUNCTION public.treatment_get(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.treatment_actor();
  v public.visits;
  pt public.patients;
  b public.branches;
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR v.branch_id <> a.branch_id OR NOT public.treatment_readable(v.tenant_id, v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pt FROM public.patients x WHERE x.tenant_id = v.tenant_id AND x.id = public.patient_canonical(v.tenant_id, v.patient_id);
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = v.tenant_id AND x.id = v.branch_id;
  PERFORM public.audit_append('clinical_read', 'visit', v.id, 'success', 'treatment_viewed');
  RETURN jsonb_build_object('now', clock_timestamp(),
    'visit', jsonb_build_object('id', v.id, 'closed', v.closed_at IS NOT NULL, 'blocker', v.blocker,
                                'steps', jsonb_build_object('intake', v.intake, 'doctor', v.doctor, 'selection', v.selection, 'consent', v.consent, 'payment', v.payment,
                                                            'preparation', v.preparation, 'treatment', v.treatment, 'dispensing', v.dispensing)),
    'patient', jsonb_build_object('id', pt.id, 'name', pt.full_name, 'mrn', pt.mrn, 'birth_date', pt.birth_date),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object('plan_item_id', t.id, 'name', cv.name, 'stage', t.stage, 'qty', t.qty,
               'blockers', to_jsonb(public.treatment_item_blockers(v, t.id)),
               'performers', coalesce((
                 SELECT jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.display_name, 'mode', m.mode,
                          'credential_ok', public.credential_valid(s.id, v.branch_id, clock_timestamp())) ORDER BY s.display_name, s.id)
                   FROM public.staff s
                   CROSS JOIN LATERAL (SELECT public.consent_mode(v.tenant_id, v.branch_id, s.id, t.catalog_version_id) AS mode) m
                  WHERE s.tenant_id = v.tenant_id AND m.mode IN ('performs','supervised')), '[]'::jsonb),
               'execution', (SELECT to_jsonb(e) - 'tenant_id' - 'start_command_key' - 'finish_command_key'
                               FROM public.treatment_executions e WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id AND e.plan_item_id = t.id))
             ORDER BY t.stage, cv.name, t.id)
        FROM public.plan_items t JOIN public.care_plans c ON c.tenant_id = t.tenant_id AND c.id = t.plan_id
        JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
       WHERE t.tenant_id = v.tenant_id AND (t.removed_at IS NULL AND c.state = 'active' AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, pt.id))
             OR EXISTS (SELECT 1 FROM public.treatment_executions e WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id AND e.plan_item_id = t.id))), '[]'::jsonb),
    'supervisors', coalesce((
      SELECT jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.display_name) ORDER BY s.display_name, s.id)
        FROM public.staff s
       WHERE s.tenant_id = v.tenant_id AND public.consent_staff_role(v.tenant_id, s.id, v.branch_id, 'doctor')
         AND public.credential_valid(s.id, v.branch_id, clock_timestamp())), '[]'::jsonb),
    'assistants', coalesce((
      SELECT jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.display_name) ORDER BY s.display_name, s.id)
        FROM public.staff s
       WHERE s.tenant_id = v.tenant_id AND (public.consent_staff_role(v.tenant_id, s.id, v.branch_id, 'doctor')
             OR public.consent_staff_role(v.tenant_id, s.id, v.branch_id, 'nurse') OR public.consent_staff_role(v.tenant_id, s.id, v.branch_id, 'therapist'))), '[]'::jsonb),
    'rooms', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.name, r.id)
        FROM public.rooms r WHERE r.tenant_id = v.tenant_id AND r.branch_id = v.branch_id AND r.kind = 'treatment' AND r.is_active), '[]'::jsonb),
    'material_requests', coalesce((
      SELECT jsonb_agg(public.material_request_json(r) ORDER BY r.requested_at, r.id)
        FROM public.material_requests r WHERE r.tenant_id = v.tenant_id AND r.branch_id = v.branch_id AND r.visit_id = v.id), '[]'::jsonb),
    'room_depots', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'room_id', d.room_id) ORDER BY d.name, d.id)
        FROM public.depots d WHERE d.tenant_id = v.tenant_id AND d.branch_id = v.branch_id AND d.kind = 'ruang' AND d.active), '[]'::jsonb),
    'stock_items', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'code', lb.code, 'name', lb.name, 'unit', i.unit, 'class', i.material_class) ORDER BY lb.name, i.id)
        FROM public.stock_items i CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
       WHERE i.tenant_id = v.tenant_id AND i.active), '[]'::jsonb),
    'open_vials', coalesce((
      SELECT jsonb_agg(jsonb_build_object('batch_id', o.batch_id, 'depot_id', o.depot_id, 'remaining', o.remaining, 'use_by', o.use_by,
               'lapsed', public.stock_vial_unfit(o) IS NOT NULL) ORDER BY o.use_by, o.id)
        FROM public.opened_vials o JOIN public.depots d ON d.tenant_id = o.tenant_id AND d.id = o.depot_id AND d.kind = 'ruang'
       WHERE o.tenant_id = v.tenant_id AND o.branch_id = v.branch_id AND o.state = 'open'
         AND o.batch_id IN (SELECT il.batch_id FROM public.material_issue_lines il WHERE il.tenant_id = v.tenant_id
                              AND il.request_id IN (SELECT r.id FROM public.material_requests r WHERE r.tenant_id = v.tenant_id AND r.visit_id = v.id))), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.treatment_get(uuid) TO clinic_app;
