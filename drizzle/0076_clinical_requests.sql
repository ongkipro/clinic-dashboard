CREATE TABLE "clinical_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_item_id" uuid,
	"catalog_version_id" uuid NOT NULL,
	"stage" integer NOT NULL,
	"qty" integer NOT NULL,
	"dose_micro" bigint,
	"dose_unit" text,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"decided_by" uuid,
	"decided_as" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"added_item_id" uuid,
	CONSTRAINT "clinical_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "clinical_requests_kind_check" CHECK ("clinical_requests"."kind" in ('addition','plan_change','substitution') and (("clinical_requests"."kind" = 'addition') = ("clinical_requests"."target_item_id" is null))
      and "clinical_requests"."stage" between 1 and 20 and "clinical_requests"."qty" between 1 and 1000
      and (("clinical_requests"."dose_micro" is null) = ("clinical_requests"."dose_unit" is null)) and ("clinical_requests"."dose_micro" is null or "clinical_requests"."dose_micro" between 1 and 1000000000)
      and ("clinical_requests"."dose_unit" is null or "clinical_requests"."dose_unit" in ('unit','ml','mg','cm2')) and length(btrim("clinical_requests"."reason")) between 3 and 500
      and "clinical_requests"."requested_as" in ('bc','doctor','nurse','therapist')),
	CONSTRAINT "clinical_requests_state_check" CHECK ("clinical_requests"."state" in ('pending','approved','declined','cancelled')
      and (("clinical_requests"."state" = 'pending') = ("clinical_requests"."decided_at" is null)) and num_nonnulls("clinical_requests"."decided_by", "clinical_requests"."decided_as") in (0, 2)
      and (("clinical_requests"."state" in ('approved','declined')) = ("clinical_requests"."decided_by" is not null))
      and ("clinical_requests"."decided_as" is null or "clinical_requests"."decided_as" in ('doctor','facility_head')) and ("clinical_requests"."decided_by" is null or "clinical_requests"."decided_by" <> "clinical_requests"."requested_by")
      and (("clinical_requests"."state" = 'approved') = ("clinical_requests"."added_item_id" is not null))
      and (("clinical_requests"."state" = 'declined') = ("clinical_requests"."decision_reason" is not null)) and ("clinical_requests"."decision_reason" is null or length(btrim("clinical_requests"."decision_reason")) between 3 and 500))
);
--> statement-breakpoint
ALTER TABLE "plan_items" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_items" ADD COLUMN "removed_by_request_id" uuid;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."care_plans"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_target_fk" FOREIGN KEY ("tenant_id","target_item_id") REFERENCES "public"."plan_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_added_fk" FOREIGN KEY ("tenant_id","added_item_id") REFERENCES "public"."plan_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_requests" ADD CONSTRAINT "clinical_requests_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_requests_branch_idx" ON "clinical_requests" USING btree ("tenant_id","branch_id","state","requested_at");--> statement-breakpoint
CREATE INDEX "clinical_requests_visit_idx" ON "clinical_requests" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_requests_one_pending_item" ON "clinical_requests" USING btree ("tenant_id","target_item_id") WHERE state = 'pending' and target_item_id is not null;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_request_check" CHECK ("plan_items"."removed_by_request_id" is null or "plan_items"."removed_at" is not null);;--> statement-breakpoint

-- T-056 rules (generated by gen.py; plan docs/tasks/T-056.md)
-- Permintaan Klinis (PR-45, UX-27, DATA-22; plan Argon r1 162e16f4 adopted, r2 a668ec31 APPROVE; DEC-068
-- revisable defaults pending Q-07).

-- Read helper (invoker, wall clock, never null; plan P1-2): doctor, nurse, therapist, facility head, records
-- officer holding the acting role at the branch now. Never BC, FO, pharmacist, manager, owner or admin pusat.
CREATE FUNCTION public.request_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id() AND public.app_role_in(ARRAY['doctor','nurse','therapist','facility_head','records_officer'])
    AND public.app_branch_allowed(p_branch)
    AND EXISTS (
      SELECT 1 FROM public.staff s
        JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch
       WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
         AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.request_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Price impact (plan open point 6, P1-3): proposed quantity × branch price − current quantity × branch price, in
-- integer rupiah (display only; no money is written here, M4).
CREATE FUNCTION public.request_price_impact(r public.clinical_requests) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT r.qty * public.catalog_branch_price(pv.item_id, r.branch_id)
         - coalesce((SELECT t.qty * public.catalog_branch_price(tv.item_id, r.branch_id)
                       FROM public.plan_items t JOIN public.catalog_versions tv ON tv.tenant_id = t.tenant_id AND tv.id = t.catalog_version_id
                      WHERE t.tenant_id = r.tenant_id AND t.id = r.target_item_id), 0)
    FROM public.catalog_versions pv WHERE pv.tenant_id = r.tenant_id AND pv.id = r.catalog_version_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_price_impact(public.clinical_requests) FROM PUBLIC;--> statement-breakpoint

-- Notification types (PR-54): raised by the request definers only; ids, never clinical content.
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('clinical_request_pending', 'Permintaan klinis menunggu keputusan', '{doctor,facility_head}', '{clinical_request}', false),
  ('clinical_request_approved', 'Permintaan klinis disetujui', '{fo_cashier}', '{clinical_request}', false);--> statement-breakpoint

ALTER TABLE public.clinical_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinical_requests_read ON public.clinical_requests FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.request_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.clinical_requests TO clinic_app;--> statement-breakpoint
CREATE POLICY clinical_requests_operator_read ON public.clinical_requests FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.clinical_requests', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.clinical_requests TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER clinical_requests_no_truncate BEFORE TRUNCATE ON public.clinical_requests FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.clinical_requests ENABLE ALWAYS TRIGGER clinical_requests_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.clinical_requests', 'clinical', 'clinical', '{doctor,nurse,therapist,facility_head,records_officer}', 'clinical_request_create, clinical_request_decide, clinical_request_cancel (src/modules/clinical/requests)', 'the visit''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): clinical class.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.clinical_requests', 'clinical');--> statement-breakpoint
-- plan_items ↔ clinical_requests (declared here: the drizzle schemas reference each other).
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."clinical_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_removed_by_request_fk" FOREIGN KEY ("tenant_id","removed_by_request_id") REFERENCES "public"."clinical_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- ── Guards: staff_access lock first, ENABLE ALWAYS ─────────────────────────────────────────────────
-- A request is never deleted; it opens pending with no decision; it is decided or cancelled once (pending →
-- approved | declined | cancelled), its request columns frozen.
CREATE FUNCTION public.clinical_requests_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  decision constant text[] := ARRAY['state','decided_by','decided_as','decided_at','decision_reason','added_item_id'];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || (coalesce(n, o) ->> 'tenant_id'), 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical requests are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF n ->> 'state' <> 'pending' OR num_nonnulls(n ->> 'decided_by', n ->> 'decided_at', n ->> 'decision_reason', n ->> 'added_item_id') > 0 THEN
      RAISE EXCEPTION 'a clinical request opens pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF o ->> 'state' <> 'pending' OR n ->> 'state' = 'pending'
     OR EXISTS (SELECT 1 FROM jsonb_each(n) x WHERE NOT x.key = ANY (decision) AND x.value IS DISTINCT FROM o -> x.key) THEN
    RAISE EXCEPTION 'a clinical request is decided once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clinical_requests_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER clinical_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON public.clinical_requests FOR EACH ROW EXECUTE FUNCTION public.clinical_requests_guard();--> statement-breakpoint
ALTER TABLE public.clinical_requests ENABLE ALWAYS TRIGGER clinical_requests_guard;--> statement-breakpoint

-- plans_guard (0070) re-created (plan open point 2): an item opens present with no removal; the one change of an
-- item is its removal (removed_at, and the request that removed it when a request did). Plans unchanged.
CREATE OR REPLACE FUNCTION public.plans_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || (coalesce(n, o) ->> 'tenant_id'), 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'plans and plan items are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'care_plans' THEN
    IF TG_OP = 'INSERT' THEN
      IF n ->> 'state' <> 'active' THEN
        RAISE EXCEPTION 'a plan opens active' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF o ->> 'state' <> 'active' THEN
      RAISE EXCEPTION 'a closed plan is final' USING ERRCODE = '42501';
    END IF;
    IF n - 'state' - 'closed_exam_id' - 'closed_at' IS DISTINCT FROM o - 'state' - 'closed_exam_id' - 'closed_at' THEN
      RAISE EXCEPTION 'a plan keeps its patient, title and condition' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF n ->> 'removed_at' IS NOT NULL OR n ->> 'removed_by_request_id' IS NOT NULL THEN
      RAISE EXCEPTION 'an item opens present' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF o ->> 'removed_at' IS NOT NULL OR n ->> 'removed_at' IS NULL
     OR n - 'removed_at' - 'removed_by_request_id' IS DISTINCT FROM o - 'removed_at' - 'removed_by_request_id' THEN
    RAISE EXCEPTION 'a plan item changes only by removal' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.plans_guard() FROM PUBLIC;--> statement-breakpoint

-- ── Writers (PR-45; plan open points 1–8, P1-1..P1-3, P2-1) ──────────────────────────────────────
-- The actor lock first (DEC-043), then role and capability (existing_appointment).
CREATE FUNCTION public.request_actor(p_roles text[], OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not use clinical requests' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_actor(text[]) FROM PUBLIC;--> statement-breakpoint

-- Usul Permintaan. p: {kind, plan_id, catalog_version_id, stage, qty, target_item_id?, dose_micro?, dose_unit?,
-- reason}. The visit open at the active branch with an examination; the plan active and of the patient's merge
-- cluster; addition without a target, plan change with the target's version and something changed, substitution
-- with another version; a BC never sets a dose (plan change: the target's dose kept). Alerts the deciders.
CREATE FUNCTION public.clinical_request_create(p_visit uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.request_actor(ARRAY['bc','doctor','nurse','therapist']);
  v public.visits;
  e public.examinations;
  c public.care_plans;
  t public.plan_items;
  v_kind text := p ->> 'kind';
  v_ver uuid;
  v_stage integer;
  v_qty integer;
  v_dose bigint;
  v_unit text;
  v_id uuid;
  v_event uuid;
  r text;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'kind' - 'plan_id' - 'catalog_version_id' - 'stage' - 'qty' - 'target_item_id' - 'dose_micro' - 'dose_unit' - 'reason' <> '{}'::jsonb
     OR coalesce(v_kind, '') NOT IN ('addition','plan_change','substitution')
     OR coalesce(p ->> 'plan_id', '') !~ uuid_re OR coalesce(p ->> 'catalog_version_id', '') !~ uuid_re
     OR (v_kind = 'addition') = (p ? 'target_item_id') OR p ? 'target_item_id' AND coalesce(p ->> 'target_item_id', '') !~ uuid_re
     OR jsonb_typeof(p -> 'stage') IS DISTINCT FROM 'number' OR (p ->> 'stage') !~ '^[0-9]{1,2}$'
     OR jsonb_typeof(p -> 'qty') IS DISTINCT FROM 'number' OR (p ->> 'qty') !~ '^[0-9]{1,4}$'
     OR (p ? 'dose_micro') <> (p ? 'dose_unit')
     OR p ? 'dose_micro' AND (jsonb_typeof(p -> 'dose_micro') <> 'number' OR (p ->> 'dose_micro') !~ '^[0-9]{1,10}$')
     OR p ? 'dose_unit' AND coalesce(p ->> 'dose_unit', '') NOT IN ('unit','ml','mg','cm2')
     OR jsonb_typeof(p -> 'reason') IS DISTINCT FROM 'string' OR length(btrim(p ->> 'reason')) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: request' USING ERRCODE = '22023';
  END IF;
  IF a.role = 'bc' AND p ? 'dose_micro' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: bc_may_not_set_dose' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit FOR UPDATE;
  IF NOT FOUND OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = v.tenant_id AND x.visit_id = v.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_examination' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO c FROM public.care_plans x WHERE x.tenant_id = v.tenant_id AND x.id = (p ->> 'plan_id')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT c.patient_id = ANY (public.patient_cluster(v.tenant_id, public.patient_canonical(v.tenant_id, v.patient_id))) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: plan not found' USING ERRCODE = 'P0002';
  END IF;
  IF c.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: plan_closed' USING ERRCODE = '55000';
  END IF;
  v_ver := (p ->> 'catalog_version_id')::uuid;
  v_stage := (p ->> 'stage')::integer;
  v_qty := (p ->> 'qty')::integer;
  v_dose := (p ->> 'dose_micro')::bigint;
  v_unit := p ->> 'dose_unit';
  IF v_kind <> 'addition' THEN
    SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = c.tenant_id AND x.id = (p ->> 'target_item_id')::uuid FOR UPDATE;
    IF NOT FOUND OR t.plan_id <> c.id THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: plan item not found' USING ERRCODE = 'P0002';
    END IF;
    IF t.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: item_removed' USING ERRCODE = '55000';
    END IF;
    IF v_kind = 'plan_change' THEN
      IF v_ver <> t.catalog_version_id THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: version_changed' USING ERRCODE = '22023';
      END IF;
      IF a.role = 'bc' THEN
        v_dose := t.dose_micro;
        v_unit := t.dose_unit;
      END IF;
      IF v_stage = t.stage AND v_qty = t.qty AND v_dose IS NOT DISTINCT FROM t.dose_micro AND v_unit IS NOT DISTINCT FROM t.dose_unit THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: no_change' USING ERRCODE = '22023';
      END IF;
    ELSIF v_ver = t.catalog_version_id THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: same_item' USING ERRCODE = '22023';
    END IF;
  END IF;
  PERFORM public.exam_version(v.tenant_id, v_ver, ARRAY['service','product','package']);
  BEGIN
    INSERT INTO public.clinical_requests (tenant_id, branch_id, visit_id, patient_id, examination_id, plan_id, kind, target_item_id, catalog_version_id,
                                          stage, qty, dose_micro, dose_unit, reason, requested_by, requested_as)
    VALUES (v.tenant_id, v.branch_id, v.id, public.patient_canonical(v.tenant_id, v.patient_id), e.id, c.id, v_kind, t.id, v_ver,
            v_stage, v_qty, v_dose, v_unit, btrim(p ->> 'reason'), a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: item_request_pending' USING ERRCODE = '55000';
    WHEN check_violation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: request' USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'clinical_request', v_id, 'success', 'clinical_request_created');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v.branch_id, 'ClinicalRequestCreated', 'clinical_request', v_id,
          jsonb_build_object('request_id', v_id, 'visit_id', v.id, 'plan_id', c.id, 'branch_id', v.branch_id, 'kind', v_kind))
  RETURNING id INTO v_event;
  FOREACH r IN ARRAY ARRAY['doctor','facility_head'] LOOP
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, source_event_id, raised_by)
    VALUES (v.tenant_id, 'clinical_request_pending', r, v.branch_id, 'clinical_request', v_id, v_event, a.staff_id);
  END LOOP;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clinical_request_create(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.clinical_request_create(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Setujui / Tolak. A doctor or facility head of the request's branch, never the requester (a nurse waits for
-- Q-07's delegation). Approval: the target removed and the new item added (the plan's branch, the visit's
-- examination), the request approved with its item; the consent step opens again when the plan's consent no longer
-- covers it; FO alerted. Decline needs a reason.
CREATE FUNCTION public.clinical_request_decide(p_request uuid, p_approve boolean, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  q public.clinical_requests;
  v public.visits;
  c public.care_plans;
  t public.plan_items;
  v_added uuid;
  v_consent text;
  v_event uuid;
BEGIN
  -- A nurse is a delegated decider in 07:47 but no delegation exists yet (Q-07): named refusal.
  a := public.request_actor(ARRAY['doctor','facility_head','nurse']);
  IF a.role = 'nurse' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: nurse_delegation_not_configured' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL OR NOT p_approve AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO q FROM public.clinical_requests x WHERE x.tenant_id = a.tenant_id AND x.id = p_request FOR UPDATE;
  IF NOT FOUND OR q.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(q.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: request not found' USING ERRCODE = 'P0002';
  END IF;
  IF q.requested_by = a.staff_id THEN
    RAISE EXCEPTION 'ERR_APPROVER_IS_REQUESTER: the requester cannot decide their own request' USING ERRCODE = 'P0422';
  END IF;
  IF q.state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: decided' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = q.tenant_id AND x.id = q.visit_id FOR UPDATE;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO c FROM public.care_plans x WHERE x.tenant_id = q.tenant_id AND x.id = q.plan_id FOR UPDATE;
  IF c.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: plan_closed' USING ERRCODE = '55000';
  END IF;
  IF NOT p_approve THEN
    UPDATE public.clinical_requests SET state = 'declined', decided_by = a.staff_id, decided_as = a.role, decided_at = clock_timestamp(), decision_reason = btrim(p_reason)
     WHERE tenant_id = q.tenant_id AND id = q.id;
    PERFORM public.audit_append('approval', 'clinical_request', q.id, 'success', 'clinical_request_declined');
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (q.branch_id, 'ClinicalRequestDecided', 'clinical_request', q.id, jsonb_build_object('request_id', q.id, 'decision', 'declined', 'kind', q.kind));
    RETURN jsonb_build_object('state', 'declined');
  END IF;
  IF q.target_item_id IS NOT NULL THEN
    SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = q.tenant_id AND x.id = q.target_item_id FOR UPDATE;
    IF t.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: item_removed' USING ERRCODE = '55000';
    END IF;
  END IF;
  PERFORM public.exam_version(q.tenant_id, q.catalog_version_id, ARRAY['service','product','package']);
  IF t.id IS NOT NULL THEN
    UPDATE public.plan_items SET removed_at = clock_timestamp(), removed_by_request_id = q.id WHERE tenant_id = t.tenant_id AND id = t.id;
  END IF;
  INSERT INTO public.plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty, dose_micro, dose_unit, request_id)
  VALUES (q.tenant_id, c.branch_id, c.id, q.examination_id, q.stage, q.catalog_version_id, q.qty, q.dose_micro, q.dose_unit, q.id)
  RETURNING id INTO v_added;
  UPDATE public.clinical_requests SET state = 'approved', decided_by = a.staff_id, decided_as = a.role, decided_at = clock_timestamp(), added_item_id = v_added
   WHERE tenant_id = q.tenant_id AND id = q.id;
  -- The patient agreement step opens again when the consent no longer covers the plan (T-054's state).
  v_consent := public.consent_state(q.tenant_id, c.id);
  IF v_consent <> 'active' THEN
    UPDATE public.visits SET consent = 'in_progress' WHERE tenant_id = v.tenant_id AND id = v.id AND closed_at IS NULL AND consent <> 'in_progress';
  END IF;
  PERFORM public.audit_append('approval', 'clinical_request', q.id, 'success', 'clinical_request_approved');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (q.branch_id, 'ClinicalRequestDecided', 'clinical_request', q.id,
          jsonb_build_object('request_id', q.id, 'visit_id', q.visit_id, 'plan_id', c.id, 'item_id', v_added, 'decision', 'approved', 'kind', q.kind))
  RETURNING id INTO v_event;
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (q.branch_id, 'CarePlanUpdated', 'care_plan', c.id,
          jsonb_strip_nulls(jsonb_build_object('change', 'request_applied', 'plan_id', c.id, 'request_id', q.id, 'item_id', v_added, 'removed_item_id', t.id)));
  INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, source_event_id, raised_by)
  VALUES (q.tenant_id, 'clinical_request_approved', 'fo_cashier', q.branch_id, 'clinical_request', q.id, v_event, a.staff_id);
  RETURN jsonb_build_object('state', 'approved', 'item_id', v_added, 'consent', v_consent);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clinical_request_decide(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.clinical_request_decide(uuid, boolean, text) TO clinic_app;--> statement-breakpoint

-- Batalkan: the requester, while pending.
CREATE FUNCTION public.clinical_request_cancel(p_request uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.request_actor(ARRAY['bc','doctor','nurse','therapist']);
  q public.clinical_requests;
BEGIN
  SELECT * INTO q FROM public.clinical_requests x WHERE x.tenant_id = a.tenant_id AND x.id = p_request FOR UPDATE;
  IF NOT FOUND OR q.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(q.branch_id) OR q.requested_by <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: request not found' USING ERRCODE = 'P0002';
  END IF;
  IF q.state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: decided' USING ERRCODE = '55000';
  END IF;
  UPDATE public.clinical_requests SET state = 'cancelled', decided_at = clock_timestamp() WHERE tenant_id = q.tenant_id AND id = q.id;
  PERFORM public.audit_append('settings_change', 'clinical_request', q.id, 'success', 'clinical_request_cancelled');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (q.branch_id, 'ClinicalRequestCancelled', 'clinical_request', q.id, jsonb_build_object('request_id', q.id, 'kind', q.kind));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clinical_request_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.clinical_request_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- ── Readers (definer; plan P1-2, P2-1) ────────────────────────────────────────────────────────────
-- The actor lock first, then the roles and clinical_read. Clinical readers see the requests of the active
-- branch with doses, reasons and the plan condition; a BC sees only its own requests, without doses or the
-- condition; every other role is refused.
CREATE FUNCTION public.request_reader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('doctor','nurse','therapist','facility_head','records_officer','bc') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read clinical requests' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: clinical reads are not available' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_reader() FROM PUBLIC;--> statement-breakpoint

-- One request as the reader may see it (p_full: doses, reason, decision reason and condition).
CREATE FUNCTION public.request_json(q public.clinical_requests, p_full boolean, p_staff uuid, p_role text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', q.id, 'visit_id', q.visit_id, 'plan_id', q.plan_id, 'kind', q.kind, 'state', q.state,
           'patient_id', q.patient_id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'plan_title', c.title,
           'item_name', (SELECT cv.name FROM public.catalog_versions cv WHERE cv.tenant_id = q.tenant_id AND cv.id = q.catalog_version_id),
           'target_name', (SELECT cv.name FROM public.plan_items t JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
                            WHERE t.tenant_id = q.tenant_id AND t.id = q.target_item_id),
           'target_qty', (SELECT t.qty FROM public.plan_items t WHERE t.tenant_id = q.tenant_id AND t.id = q.target_item_id),
           'stage', q.stage, 'qty', q.qty, 'price_impact', public.request_price_impact(q),
           'requested_by', q.requested_by, 'requested_as', q.requested_as, 'requested_at', q.requested_at,
           'requester_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = q.tenant_id AND s.id = q.requested_by),
           'decided_as', q.decided_as, 'decided_at', q.decided_at,
           'decider_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = q.tenant_id AND s.id = q.decided_by),
           'visit_open', (SELECT v.closed_at IS NULL FROM public.visits v WHERE v.tenant_id = q.tenant_id AND v.id = q.visit_id),
           'consent', CASE WHEN q.state = 'approved' THEN public.consent_state(q.tenant_id, q.plan_id) END,
           'can_decide', q.state = 'pending' AND p_role IN ('doctor','facility_head') AND q.requested_by <> p_staff,
           'can_cancel', q.state = 'pending' AND q.requested_by = p_staff, 'full', p_full)
    || CASE WHEN p_full THEN jsonb_build_object('reason', q.reason, 'decision_reason', q.decision_reason, 'dose_micro', q.dose_micro, 'dose_unit', q.dose_unit,
              'target_dose_micro', (SELECT t.dose_micro FROM public.plan_items t WHERE t.tenant_id = q.tenant_id AND t.id = q.target_item_id),
              'target_dose_unit', (SELECT t.dose_unit FROM public.plan_items t WHERE t.tenant_id = q.tenant_id AND t.id = q.target_item_id),
              'plan_condition', c.condition)
            ELSE '{}'::jsonb END
    FROM public.patients pt, public.care_plans c
   WHERE pt.tenant_id = q.tenant_id AND pt.id = public.patient_canonical(q.tenant_id, q.patient_id) AND c.tenant_id = q.tenant_id AND c.id = q.plan_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_json(public.clinical_requests, boolean, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- The inbox of the active branch: pending first (oldest first), then the decided ones of the last 7 days.
CREATE FUNCTION public.clinical_request_list(p_state text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.request_reader();
  v_full boolean := a.role <> 'bc';
BEGIN
  IF p_state IS NOT NULL AND p_state NOT IN ('pending','decided') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: state' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'requests', coalesce((
    SELECT jsonb_agg(public.request_json(q, v_full, a.staff_id, a.role) ORDER BY q.state <> 'pending', q.requested_at, q.id)
      FROM public.clinical_requests q
     WHERE q.tenant_id = a.tenant_id AND q.branch_id = a.branch_id AND public.app_branch_allowed(q.branch_id)
       AND (v_full AND public.request_readable(q.tenant_id, q.branch_id) OR NOT v_full AND q.requested_by = a.staff_id)
       AND (p_state IS NULL OR p_state = 'pending' AND q.state = 'pending'
            OR p_state = 'decided' AND q.state <> 'pending' AND q.decided_at > clock_timestamp() - interval '7 days')), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clinical_request_list(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.clinical_request_list(text) TO clinic_app;--> statement-breakpoint

-- One request (audited as clinical_read for a clinical reader).
CREATE FUNCTION public.clinical_request_get(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.request_reader();
  q public.clinical_requests;
  v_full boolean := a.role <> 'bc';
BEGIN
  SELECT * INTO q FROM public.clinical_requests x WHERE x.tenant_id = a.tenant_id AND x.id = p_request;
  IF NOT FOUND OR q.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(q.branch_id)
     OR v_full AND NOT public.request_readable(q.tenant_id, q.branch_id) OR NOT v_full AND q.requested_by <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_full THEN
    PERFORM public.audit_append('clinical_read', 'clinical_request', q.id, 'success', 'clinical_request_viewed');
  END IF;
  RETURN public.request_json(q, v_full, a.staff_id, a.role);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clinical_request_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.clinical_request_get(uuid) TO clinic_app;--> statement-breakpoint

-- The proposal form: today's open visits at the active branch with an examination, the active plans of the
-- patient's cluster and their present items (BC: without doses or the condition), and the catalog versions to add.
CREATE FUNCTION public.clinical_request_options(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.request_actor(ARRAY['bc','doctor','nurse','therapist']);
  b public.branches;
  v_full boolean := a.role <> 'bc';
BEGIN
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = a.branch_id;
  RETURN jsonb_build_object('role', a.role, 'branch_name', b.name,
    'visits', coalesce((
      SELECT jsonb_agg(jsonb_build_object('visit_id', v.id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'checked_in_at', v.checked_in_at,
               'plans', coalesce((SELECT jsonb_agg(jsonb_build_object('plan_id', c.id, 'title', c.title)
                                     || CASE WHEN v_full THEN jsonb_build_object('condition', c.condition) ELSE '{}'::jsonb END
                                     || jsonb_build_object('items', coalesce((
                                          SELECT jsonb_agg(jsonb_build_object('item_id', t.id, 'stage', t.stage, 'qty', t.qty, 'catalog_version_id', t.catalog_version_id,
                                                   'name', cv.name)
                                                   || CASE WHEN v_full THEN jsonb_build_object('dose_micro', t.dose_micro, 'dose_unit', t.dose_unit) ELSE '{}'::jsonb END
                                                   ORDER BY t.stage, t.created_at, t.id)
                                            FROM public.plan_items t JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
                                           WHERE t.tenant_id = c.tenant_id AND t.plan_id = c.id AND t.removed_at IS NULL), '[]'::jsonb)) ORDER BY c.created_at, c.id)
                                   FROM public.care_plans c
                                  WHERE c.tenant_id = v.tenant_id AND c.state = 'active' AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, pt.id))), '[]'::jsonb))
               ORDER BY v.checked_in_at, v.id)
        FROM public.visits v
        JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id)
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = b.id AND v.closed_at IS NULL AND (p_visit IS NULL OR v.id = p_visit)
         AND EXISTS (SELECT 1 FROM public.examinations e WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id)), '[]'::jsonb),
    'catalog', coalesce((
      SELECT jsonb_agg(jsonb_build_object('catalog_version_id', cv.id, 'name', cv.name, 'kind', it.kind) ORDER BY cv.name, cv.id)
        FROM public.catalog_versions cv JOIN public.catalog_items it ON it.tenant_id = cv.tenant_id AND it.id = cv.item_id
       WHERE cv.tenant_id = a.tenant_id AND cv.state = 'active' AND it.kind IN ('service','product','package')), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clinical_request_options(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.clinical_request_options(uuid) TO clinic_app;
