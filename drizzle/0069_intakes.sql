CREATE TABLE "intake_facts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"intake_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"provenance" text DEFAULT 'bc_captured_unverified' NOT NULL,
	"prior_fact_id" uuid,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "intake_facts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "intake_facts_one_per_kind_key" UNIQUE("tenant_id","intake_id","kind"),
	CONSTRAINT "intake_facts_kind_check" CHECK ("intake_facts"."kind" in ('allergy','medication','pregnancy','condition','skincare','prior_treatment','note') and "intake_facts"."provenance" in ('patient_reported','bc_captured_unverified')),
	CONSTRAINT "intake_facts_value_check" CHECK (length(btrim("intake_facts"."value")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"complaint" text,
	"reviewed_prior" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"author_id" uuid NOT NULL,
	"author_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "intakes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "intakes_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "intakes_tenant_visit_key" UNIQUE("tenant_id","visit_id"),
	CONSTRAINT "intakes_state_check" CHECK ("intakes"."state" in ('draft','sent') and ("intakes"."state" = 'sent') = ("intakes"."sent_at" is not null)
      and ("intakes"."state" = 'draft' or "intakes"."complaint" is not null)),
	CONSTRAINT "intakes_text_check" CHECK ("intakes"."complaint" is null or length(btrim("intakes"."complaint")) between 3 and 1000),
	CONSTRAINT "intakes_author_role_check" CHECK ("intakes"."author_role" = 'bc')
);
--> statement-breakpoint
CREATE TABLE "skin_observations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"intake_id" uuid NOT NULL,
	"chips" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "skin_observations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "skin_observations_one_per_intake_key" UNIQUE("tenant_id","intake_id"),
	CONSTRAINT "skin_observations_chips_check" CHECK ("skin_observations"."chips" <@ array['kering','berminyak','kombinasi','kemerahan','jerawat_aktif','bekas_jerawat','flek','pori_besar','garis_halus','sensitif','iritasi','lainnya']::text[] and cardinality("skin_observations"."chips") <= 12),
	CONSTRAINT "skin_observations_note_check" CHECK ("skin_observations"."note" is null or length(btrim("skin_observations"."note")) between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "intake_facts" ADD CONSTRAINT "intake_facts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_facts" ADD CONSTRAINT "intake_facts_intake_fk" FOREIGN KEY ("tenant_id","branch_id","intake_id") REFERENCES "public"."intakes"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_facts" ADD CONSTRAINT "intake_facts_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_facts" ADD CONSTRAINT "intake_facts_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_facts" ADD CONSTRAINT "intake_facts_prior_fk" FOREIGN KEY ("tenant_id","prior_fact_id") REFERENCES "public"."intake_facts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_observations" ADD CONSTRAINT "skin_observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_observations" ADD CONSTRAINT "skin_observations_intake_fk" FOREIGN KEY ("tenant_id","branch_id","intake_id") REFERENCES "public"."intakes"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_observations" ADD CONSTRAINT "skin_observations_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_facts_patient_idx" ON "intake_facts" USING btree ("tenant_id","patient_id","kind");--> statement-breakpoint
CREATE INDEX "intakes_patient_idx" ON "intakes" USING btree ("tenant_id","patient_id","sent_at");;--> statement-breakpoint

-- T-051 rules (generated; see header)
-- BC Pendampingan intake (PR-9, CLIN-001–003; plan r1/r2 in docs/tasks/T-051.md).

-- Read helper (invoker; plan r1 P1-3): the clinical intake readers ('bc','doctor','facility_head','records_officer'), for a branch allowed in the
-- session and held by the acting role on the wall clock (active membership, a staff_branches row). Never null.
CREATE FUNCTION public.intake_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id() AND public.app_role_in(ARRAY['bc','doctor','facility_head','records_officer']) AND public.app_branch_allowed(p_branch)
    AND EXISTS (
      SELECT 1 FROM public.staff s
        JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch
       WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
         AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.intake_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

ALTER TABLE public.intakes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY intakes_read ON public.intakes FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.intake_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.intakes TO clinic_app;--> statement-breakpoint
ALTER TABLE public.intake_facts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY intake_facts_read ON public.intake_facts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.intake_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.intake_facts TO clinic_app;--> statement-breakpoint
ALTER TABLE public.skin_observations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY skin_observations_read ON public.skin_observations FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.intake_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.skin_observations TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.intakes', 'clinical', 'clinical', '{bc,doctor,facility_head,records_officer}', 'intake_open, intake_save, intake_send (src/modules/clinical/intake)', 'the visit''s branch'),
  ('public.intake_facts', 'clinical', 'clinical', '{bc,doctor,facility_head,records_officer}', 'intake_save (src/modules/clinical/intake)', 'the visit''s branch'),
  ('public.skin_observations', 'clinical', 'clinical', '{bc,doctor,facility_head,records_officer}', 'intake_save (src/modules/clinical/intake)', 'the visit''s branch');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): clinical class — a support session naming these needs the Owner (PR-60).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.intakes', 'clinical'), ('public.intake_facts', 'clinical'), ('public.skin_observations', 'clinical');--> statement-breakpoint
CREATE POLICY intakes_operator_read ON public.intakes FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.intakes', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.intakes TO clinic_operator;--> statement-breakpoint
CREATE POLICY intake_facts_operator_read ON public.intake_facts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.intake_facts', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.intake_facts TO clinic_operator;--> statement-breakpoint
CREATE POLICY skin_observations_operator_read ON public.skin_observations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.skin_observations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.skin_observations TO clinic_operator;--> statement-breakpoint

-- ── Guards (plan r1 P1-5) ────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.intakes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.intakes := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'intakes are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'an intake opens as a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'sent' THEN
    RAISE EXCEPTION 'a sent intake is final' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.patient_id, NEW.author_id, NEW.author_role, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.patient_id, OLD.author_id, OLD.author_role, OLD.created_at) THEN
    RAISE EXCEPTION 'an intake keeps its visit, patient and author' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intakes_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER intakes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.intakes FOR EACH ROW EXECUTE FUNCTION public.intakes_guard();--> statement-breakpoint
ALTER TABLE public.intakes ENABLE ALWAYS TRIGGER intakes_guard;--> statement-breakpoint
CREATE TRIGGER intakes_no_truncate BEFORE TRUNCATE ON public.intakes FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.intakes ENABLE ALWAYS TRIGGER intakes_no_truncate;--> statement-breakpoint

-- Facts and observations change only while their intake is a draft (and keep their intake).
CREATE FUNCTION public.intake_parts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  v_intake uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.intake_id ELSE NEW.intake_id END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_tenant::text, 0));
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.intake_id) IS DISTINCT FROM (OLD.tenant_id, OLD.intake_id) THEN
    RAISE EXCEPTION 'a part keeps its intake' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.intakes i WHERE i.tenant_id = v_tenant AND i.id = v_intake AND i.state = 'sent') THEN
    RAISE EXCEPTION 'a sent intake is final' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_parts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER intake_facts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.intake_facts FOR EACH ROW EXECUTE FUNCTION public.intake_parts_guard();--> statement-breakpoint
ALTER TABLE public.intake_facts ENABLE ALWAYS TRIGGER intake_facts_guard;--> statement-breakpoint
CREATE TRIGGER intake_facts_no_truncate BEFORE TRUNCATE ON public.intake_facts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.intake_facts ENABLE ALWAYS TRIGGER intake_facts_no_truncate;--> statement-breakpoint
CREATE TRIGGER skin_observations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.skin_observations FOR EACH ROW EXECUTE FUNCTION public.intake_parts_guard();--> statement-breakpoint
ALTER TABLE public.skin_observations ENABLE ALWAYS TRIGGER skin_observations_guard;--> statement-breakpoint
CREATE TRIGGER skin_observations_no_truncate BEFORE TRUNCATE ON public.skin_observations FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.skin_observations ENABLE ALWAYS TRIGGER skin_observations_no_truncate;--> statement-breakpoint

-- The doctor's alert when an intake is sent (system-only; plan r1 P2-2).
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('intake_ready', 'Intake pasien siap diperiksa dokter', '{doctor}', '{visit}', false);--> statement-breakpoint

-- The patient's history (CLIN-001): per fact kind, the latest fact of a sent intake across the merge cluster,
-- excluding the given intake. Internal helper.
CREATE FUNCTION public.intake_history(p_tenant uuid, p_patient uuid, p_except uuid) RETURNS SETOF public.intake_facts
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT DISTINCT ON (f.kind) f.*
    FROM public.intake_facts f
    JOIN public.intakes i ON i.tenant_id = f.tenant_id AND i.id = f.intake_id AND i.state = 'sent'
   WHERE f.tenant_id = p_tenant AND i.id IS DISTINCT FROM p_except
     AND f.patient_id = ANY (public.patient_cluster(p_tenant, public.patient_canonical(p_tenant, p_patient)))
   ORDER BY f.kind, i.sent_at DESC, f.id DESC
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_history(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The BC writer's actor and visit (plan r1 P1-4): staff_access first (tenant_actor_lock), then the role, the
-- capability, the visit of the tenant at the actor's branch (allowed in the session), never a closed visit.
CREATE FUNCTION public.intake_actor_visit(p_visit uuid, OUT a record, OUT v public.visits)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'bc' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only a BC opens the intake of a visit' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_actor_visit(uuid) FROM PUBLIC;--> statement-breakpoint

-- ── intake_open: the draft for a visit (idempotent per visit); visits.intake → in_progress ─────────
CREATE FUNCTION public.intake_open(p_visit uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x record := public.intake_actor_visit(p_visit);
  a record := x.a;
  v public.visits := x.v;
  i public.intakes;
BEGIN
  SELECT * INTO i FROM public.intakes WHERE tenant_id = a.tenant_id AND visit_id = v.id;
  IF FOUND THEN
    RETURN i.id;
  END IF;
  INSERT INTO public.intakes (tenant_id, branch_id, visit_id, patient_id, author_id, author_role)
  VALUES (a.tenant_id, v.branch_id, v.id, public.patient_canonical(a.tenant_id, v.patient_id), a.staff_id, 'bc')
  RETURNING * INTO i;
  IF v.intake = 'not_started' THEN
    UPDATE public.visits SET intake = 'in_progress' WHERE tenant_id = v.tenant_id AND id = v.id;
  END IF;
  PERFORM public.audit_append('settings_change', 'intake', i.id, 'success', 'intake_opened');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'IntakeOpened', 'intake', i.id, jsonb_build_object('intake_id', i.id, 'visit_id', i.visit_id, 'branch_id', i.branch_id));
  RETURN i.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_open(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.intake_open(uuid) TO clinic_app;--> statement-breakpoint

-- The draft of the author at the visit, locked (out of scope or not the author = not found / forbidden).
CREATE FUNCTION public.intake_draft(p_intake uuid, OUT a record, OUT i public.intakes)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x record;
BEGIN
  -- The actor, role and capability first (review r1 P3-1): a non-BC is refused whatever the intake id.
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'bc' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only a BC records the intake' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public.intakes WHERE tenant_id = a.tenant_id AND id = p_intake;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: intake not found' USING ERRCODE = 'P0002';
  END IF;
  x := public.intake_actor_visit(i.visit_id);
  a := x.a;
  SELECT * INTO i FROM public.intakes WHERE tenant_id = a.tenant_id AND id = p_intake FOR UPDATE;
  IF i.author_id <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the BC who opened the intake edits it' USING ERRCODE = '42501';
  END IF;
  IF i.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: intake_sent' USING ERRCODE = '55000';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_draft(uuid) FROM PUBLIC;--> statement-breakpoint

-- ── intake_save (PR-9, CLIN-001, CLIN-003; plan r1 P1-1, P1-2) ────────────────────────────────────
-- Payload: {complaint?, facts?: [{kind, value} | {kind, same_as}], observation?: {chips, note?}}.
-- A score / grade / skin-type key or a number in the observation (score_field), a diagnosis key
-- (diagnosis_forbidden) or a signing key (sign_forbidden) anywhere in the payload is refused as a committed,
-- audited value: {ok: false, code}; nothing is written. Other malformed input raises ERR_INVALID_INPUT.
-- Facts: an unchanged answer (same_as the latest history fact of that kind, or the same trimmed value) adds
-- no fact; it is listed in reviewed_prior. New or changed facts replace the draft's fact of that kind.
CREATE FUNCTION public.intake_save(p_intake uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x record := public.intake_draft(p_intake);
  a record := x.a;
  i public.intakes := x.i;
  v_keys text;
  v_code text;
  f jsonb;
  h public.intake_facts;
  v_kind text;
  v_value text;
  v_reviewed uuid[] := '{}';
  v_seen text[] := '{}';
  o jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: intake' USING ERRCODE = '22023';
  END IF;
  -- Every key at every depth, lower-case, for the refusal classes (PR-9, CLIN-003).
  SELECT string_agg(lower(k), ' ') INTO v_keys FROM (
    WITH RECURSIVE walk(val) AS (
      SELECT p UNION ALL
      SELECT c.v FROM walk w CROSS JOIN LATERAL (
        SELECT e.value AS v FROM jsonb_each(CASE WHEN jsonb_typeof(w.val) = 'object' THEN w.val ELSE '{}' END) e
        UNION ALL
        SELECT e.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.val) = 'array' THEN w.val ELSE '[]' END) e) c)
    SELECT k.key AS k FROM walk w CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(w.val) = 'object' THEN w.val ELSE '{}' END) k(key)) keys;
  v_code := CASE
    WHEN v_keys ~ '(score|grade|fitzpatrick|skin_type|tipe_kulit|nilai|skor|derajat|level|rating)' OR jsonb_typeof(p -> 'observation') = 'object' AND EXISTS (
           SELECT 1 FROM jsonb_each(p -> 'observation') e WHERE jsonb_typeof(e.value) = 'number')
         OR jsonb_typeof(p #> '{observation,chips}') = 'array' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(p #> '{observation,chips}') c WHERE jsonb_typeof(c) <> 'string') THEN 'score_field'
    WHEN v_keys ~ '(diagnos|icd|assessment|kesimpulan)' THEN 'diagnosis_forbidden'
    WHEN v_keys ~ '(sign|ttd|tanda_tangan|verified|verifikasi)' THEN 'sign_forbidden'
  END;
  IF v_code IS NOT NULL THEN
    PERFORM public.audit_append('access_denied', 'intake', i.id, 'denied', v_code);
    RETURN jsonb_build_object('ok', false, 'code', v_code);
  END IF;
  -- The allowlist: top level and each part.
  IF p - 'complaint' - 'facts' - 'observation' <> '{}'::jsonb
     OR p ? 'complaint' AND jsonb_typeof(p -> 'complaint') NOT IN ('string','null')
     OR p ? 'complaint' AND jsonb_typeof(p -> 'complaint') = 'string' AND length(btrim(p ->> 'complaint')) NOT BETWEEN 3 AND 1000
     OR p ? 'facts' AND jsonb_typeof(p -> 'facts') <> 'array'
     OR p ? 'observation' AND jsonb_typeof(p -> 'observation') NOT IN ('object','null')
     OR jsonb_typeof(p -> 'observation') = 'object' AND ((p -> 'observation') - 'chips' - 'note' <> '{}'::jsonb
        OR jsonb_typeof(p #> '{observation,chips}') IS DISTINCT FROM 'array'
        OR (p #> '{observation,note}') IS NOT NULL AND jsonb_typeof(p #> '{observation,note}') NOT IN ('string','null')
        OR length(btrim(coalesce(p #>> '{observation,note}', ''))) > 1000
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p #> '{observation,chips}') c WHERE c NOT IN ('kering','berminyak','kombinasi','kemerahan','jerawat_aktif','bekas_jerawat','flek','pori_besar','garis_halus','sensitif','iritasi','lainnya'))) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: intake' USING ERRCODE = '22023';
  END IF;
  IF p ? 'complaint' THEN
    UPDATE public.intakes SET complaint = NULLIF(btrim(coalesce(p ->> 'complaint', '')), ''), updated_at = clock_timestamp()
     WHERE tenant_id = i.tenant_id AND id = i.id;
  END IF;
  IF p ? 'facts' THEN
    FOR f IN SELECT * FROM jsonb_array_elements(p -> 'facts') LOOP
      IF jsonb_typeof(f) <> 'object' OR f - 'kind' - 'value' - 'same_as' <> '{}'::jsonb OR coalesce(f ->> 'kind', '') NOT IN ('allergy','medication','pregnancy','condition','skincare','prior_treatment','note')
         OR (f ? 'value') = (f ? 'same_as') OR f ? 'value' AND length(btrim(coalesce(f ->> 'value', ''))) NOT BETWEEN 1 AND 500
         OR (f ->> 'kind') = ANY (v_seen) THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: fact' USING ERRCODE = '22023';
      END IF;
      v_kind := f ->> 'kind';
      v_seen := v_seen || v_kind;
      SELECT * INTO h FROM public.intake_history(i.tenant_id, i.patient_id, i.id) hh WHERE hh.kind = v_kind;
      IF f ? 'same_as' THEN
        IF h.id IS NULL OR (f ->> 'same_as') IS DISTINCT FROM h.id::text THEN
          RAISE EXCEPTION 'ERR_INVALID_INPUT: same_as' USING ERRCODE = '22023';
        END IF;
        v_value := NULL;
      ELSE
        v_value := btrim(f ->> 'value');
      END IF;
      -- Replace the draft's fact of this kind; an unchanged answer adds none (CLIN-001).
      DELETE FROM public.intake_facts WHERE tenant_id = i.tenant_id AND intake_id = i.id AND kind = v_kind;
      IF v_value IS NULL OR h.id IS NOT NULL AND v_value = h.value THEN
        v_reviewed := v_reviewed || h.id;
      ELSE
        INSERT INTO public.intake_facts (tenant_id, branch_id, intake_id, patient_id, kind, value, prior_fact_id, author_id)
        VALUES (i.tenant_id, i.branch_id, i.id, i.patient_id, v_kind, v_value, h.id, a.staff_id);
      END IF;
    END LOOP;
    -- reviewed_prior: the history facts answered "same" now, plus earlier ones of kinds not sent in this save.
    UPDATE public.intakes SET reviewed_prior = ARRAY(
             SELECT DISTINCT r FROM unnest(i.reviewed_prior || v_reviewed) r
              WHERE r = ANY (v_reviewed) OR NOT EXISTS (
                SELECT 1 FROM public.intake_facts hf WHERE hf.tenant_id = i.tenant_id AND hf.id = r AND hf.kind = ANY (v_seen))
              ORDER BY r),
           updated_at = clock_timestamp()
     WHERE tenant_id = i.tenant_id AND id = i.id;
  END IF;
  IF p ? 'observation' THEN
    DELETE FROM public.skin_observations WHERE tenant_id = i.tenant_id AND intake_id = i.id;
    o := p -> 'observation';
    IF jsonb_typeof(o) = 'object' AND (jsonb_array_length(o -> 'chips') > 0 OR length(btrim(coalesce(o ->> 'note', ''))) > 0) THEN
      INSERT INTO public.skin_observations (tenant_id, branch_id, intake_id, chips, note, author_id)
      VALUES (i.tenant_id, i.branch_id, i.id, ARRAY(SELECT DISTINCT c FROM jsonb_array_elements_text(o -> 'chips') c ORDER BY c),
              NULLIF(btrim(coalesce(o ->> 'note', '')), ''), a.staff_id);
    END IF;
  END IF;
  PERFORM public.audit_append('settings_change', 'intake', i.id, 'success', 'intake_saved');
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_save(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.intake_save(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── intake_send ("Kirim ke Dokter"): the draft becomes final; visits.intake → done; the doctor alerted ─
CREATE FUNCTION public.intake_send(p_intake uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x record := public.intake_draft(p_intake);
  a record := x.a;
  i public.intakes := x.i;
BEGIN
  IF i.complaint IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: complaint_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.intakes SET state = 'sent', sent_at = clock_timestamp(), updated_at = clock_timestamp() WHERE tenant_id = i.tenant_id AND id = i.id;
  UPDATE public.visits SET intake = 'done' WHERE tenant_id = i.tenant_id AND id = i.visit_id AND intake <> 'done';
  INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, raised_by)
  VALUES (i.tenant_id, 'intake_ready', 'doctor', i.branch_id, 'visit', i.visit_id, a.staff_id);
  PERFORM public.audit_append('settings_change', 'intake', i.id, 'success', 'intake_sent');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'IntakeSent', 'intake', i.id,
          jsonb_strip_nulls(jsonb_build_object('intake_id', i.id, 'visit_id', i.visit_id, 'branch_id', i.branch_id, 'patient_id', i.patient_id, 'author_id', i.author_id)));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_send(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.intake_send(uuid) TO clinic_app;--> statement-breakpoint

-- ── Readers ──────────────────────────────────────────────────────────────────────────────────────
-- The BC's queue (UX-7 list): today's open visits at the branch and closed ones of today, with the intake
-- state and author, never a diagnosis. BC of the branch only (wall clock through approval_actor).
CREATE FUNCTION public.pendampingan_visits(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  today date;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF a.role <> 'bc' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read Pendampingan' USING ERRCODE = '42501';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, p_branch);
  today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object('today', today, 'branch_name', b.name,
    'visits', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'kind', v.kind, 'checked_in_at', v.checked_in_at, 'patient_id', pt.id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn,
               'intake', v.intake, 'doctor', v.doctor, 'closed', v.closed_at IS NOT NULL,
               'intake_id', i.id, 'intake_state', i.state, 'author_id', i.author_id, 'author_name', au.display_name)
             ORDER BY v.checked_in_at, v.id)
        FROM public.visits v
        JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id)
        LEFT JOIN public.intakes i ON i.tenant_id = v.tenant_id AND i.visit_id = v.id
        LEFT JOIN public.staff au ON au.tenant_id = i.tenant_id AND au.id = i.author_id
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = b.id
         AND (v.closed_at IS NULL AND (v.checked_in_at AT TIME ZONE b.timezone)::date = today
              OR (v.closed_at AT TIME ZONE b.timezone)::date = today)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pendampingan_visits(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pendampingan_visits(uuid) TO clinic_app;--> statement-breakpoint

-- One visit for the flow page: the visit's steps, the patient, the intake (draft or sent) with its facts and
-- observation, and the history (CLIN-001). BC of the visit's branch, or the clinical readers (doctor,
-- facility head, records officer) of that branch; anything else is not found.
CREATE FUNCTION public.pendampingan_visit(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v public.visits;
  pt public.patients;
  i public.intakes;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR NOT a.role IN ('bc','doctor','facility_head','records_officer') OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pt FROM public.patients WHERE tenant_id = v.tenant_id AND id = public.patient_canonical(v.tenant_id, v.patient_id);
  SELECT * INTO i FROM public.intakes WHERE tenant_id = v.tenant_id AND visit_id = v.id;
  PERFORM public.audit_append('clinical_read', 'intake', coalesce(i.id, v.id), 'success', 'intake_viewed');
  RETURN jsonb_build_object(
    'visit', jsonb_build_object('id', v.id, 'branch_id', v.branch_id, 'checked_in_at', v.checked_in_at, 'closed', v.closed_at IS NOT NULL,
              'intake', v.intake, 'doctor', v.doctor, 'selection', v.selection, 'payment', v.payment),
    'patient', jsonb_build_object('id', pt.id, 'name', pt.full_name, 'mrn', pt.mrn, 'birth_date', pt.birth_date, 'sex', pt.sex),
    'intake', CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', i.id, 'state', i.state, 'complaint', i.complaint, 'author_id', i.author_id,
              'author_name', (SELECT display_name FROM public.staff s WHERE s.tenant_id = i.tenant_id AND s.id = i.author_id),
              'sent_at', i.sent_at, 'reviewed_prior', to_jsonb(i.reviewed_prior),
              'facts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'value', f.value, 'provenance', f.provenance, 'prior_fact_id', f.prior_fact_id) ORDER BY f.kind)
                                   FROM public.intake_facts f WHERE f.tenant_id = i.tenant_id AND f.intake_id = i.id), '[]'::jsonb),
              'observation', (SELECT jsonb_build_object('chips', to_jsonb(o.chips), 'note', o.note) FROM public.skin_observations o WHERE o.tenant_id = i.tenant_id AND o.intake_id = i.id)) END,
    'history', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', h.id, 'kind', h.kind, 'value', h.value, 'provenance', h.provenance,
               'sent_at', (SELECT ii.sent_at FROM public.intakes ii WHERE ii.tenant_id = h.tenant_id AND ii.id = h.intake_id)) ORDER BY h.kind)
        FROM public.intake_history(v.tenant_id, v.patient_id, i.id) h), '[]'::jsonb),
    'visits_before', coalesce((
      SELECT jsonb_agg(jsonb_build_object('visit_id', ii.visit_id, 'sent_at', ii.sent_at, 'complaint', ii.complaint) ORDER BY ii.sent_at DESC)
        FROM (SELECT * FROM public.intakes ii WHERE ii.tenant_id = v.tenant_id AND ii.state = 'sent' AND ii.id IS DISTINCT FROM i.id
                 AND ii.patient_id = ANY (public.patient_cluster(v.tenant_id, pt.id)) ORDER BY ii.sent_at DESC LIMIT 5) ii), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pendampingan_visit(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pendampingan_visit(uuid) TO clinic_app;--> statement-breakpoint

-- CLIN-002 (plan open point 5): the patient's unverified allergy cautions across the merge cluster — kind,
-- short value, provenance and when; never the complaint, other facts or the observation. Readers: 'bc','doctor','nurse','therapist','pharmacist','facility_head'
-- (all Level 3), for a patient with a visit at the actor's branch; anything else is not found.
CREATE FUNCTION public.patient_cautions(p_patient uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_canon uuid;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role IN ('bc','doctor','nurse','therapist','pharmacist','facility_head') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read clinical cautions' USING ERRCODE = '42501';
  END IF;
  v_canon := public.patient_canonical(a.tenant_id, p_patient);
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE tenant_id = a.tenant_id AND id = v_canon)
     OR NOT EXISTS (SELECT 1 FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.branch_id = a.branch_id
                     AND x.patient_id = ANY (public.patient_cluster(a.tenant_id, v_canon))) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('fact_id', h.id, 'kind', h.kind, 'value', h.value, 'provenance', h.provenance,
             'sent_at', (SELECT ii.sent_at FROM public.intakes ii WHERE ii.tenant_id = h.tenant_id AND ii.id = h.intake_id)))
      FROM public.intake_history(a.tenant_id, v_canon, NULL) h
     WHERE h.kind = 'allergy' AND h.provenance = 'bc_captured_unverified'), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_cautions(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patient_cautions(uuid) TO clinic_app;
