CREATE TABLE "automation_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"scenario" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"offset_days" integer NOT NULL,
	"original_planned_for" date NOT NULL,
	"planned_for" date,
	"cap_deferred_days" smallint DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"skip_reason" text,
	"outbound_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "automation_occurrences_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "automation_occurrences_key" UNIQUE("tenant_id","scenario","source_id","offset_days"),
	CONSTRAINT "automation_occurrences_check" CHECK ("automation_occurrences"."scenario" in ('pengingat','aftercare','kepuasan','rencana','belum_jadwal','isi_ulang','ulang_tahun') and "automation_occurrences"."source_kind" in ('appointment','visit','dispensing','patient')
      and "automation_occurrences"."state" in ('queued','skipped')
      and (("automation_occurrences"."state" = 'queued') = ("automation_occurrences"."outbound_id" is not null and "automation_occurrences"."planned_for" is not null))
      and (("automation_occurrences"."state" = 'skipped') = ("automation_occurrences"."skip_reason" is not null))
      and ("automation_occurrences"."skip_reason" is null or "automation_occurrences"."skip_reason" in ('cap_horizon_exceeded','no_consent','patient_phone_required','number_not_sending','template_not_usable','template_missing'))
      and "automation_occurrences"."cap_deferred_days" between 0 and 7 and ("automation_occurrences"."planned_for" is null or "automation_occurrences"."planned_for" = "automation_occurrences"."original_planned_for" + "automation_occurrences"."cap_deferred_days"))
);
--> statement-breakpoint
CREATE TABLE "automation_scenario_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"command_key" text NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"decided_by" uuid,
	"decided_as" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"setting_version_id" uuid,
	CONSTRAINT "automation_scenario_drafts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "automation_scenario_drafts_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "automation_scenario_drafts_check" CHECK ("automation_scenario_drafts"."state" in ('pending','approved','rejected','cancelled')
      and length(btrim("automation_scenario_drafts"."reason")) between 3 and 500
      and (("automation_scenario_drafts"."state" = 'pending') = ("automation_scenario_drafts"."decided_at" is null)) and (("automation_scenario_drafts"."decided_by" is null) = ("automation_scenario_drafts"."decided_as" is null))
      and ("automation_scenario_drafts"."state" <> 'approved' or "automation_scenario_drafts"."decided_by" is not null and "automation_scenario_drafts"."setting_version_id" is not null)
      and ("automation_scenario_drafts"."state" <> 'rejected' or "automation_scenario_drafts"."decided_by" is not null and "automation_scenario_drafts"."decision_reason" is not null and length(btrim("automation_scenario_drafts"."decision_reason")) between 3 and 500)
      and ("automation_scenario_drafts"."state" <> 'cancelled' or "automation_scenario_drafts"."decided_by" = "automation_scenario_drafts"."proposed_by"))
);
--> statement-breakpoint
ALTER TABLE "automation_occurrences" ADD CONSTRAINT "automation_occurrences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_occurrences" ADD CONSTRAINT "automation_occurrences_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_occurrences" ADD CONSTRAINT "automation_occurrences_tenant_id_patient_id_patients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_occurrences" ADD CONSTRAINT "automation_occurrences_tenant_id_outbound_id_outbound_messages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","outbound_id") REFERENCES "public"."outbound_messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_scenario_drafts" ADD CONSTRAINT "automation_scenario_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_scenario_drafts" ADD CONSTRAINT "automation_scenario_drafts_tenant_id_proposed_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","proposed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_scenario_drafts" ADD CONSTRAINT "automation_scenario_drafts_tenant_id_decided_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_occurrences_log_idx" ON "automation_occurrences" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_scenario_drafts_one_pending" ON "automation_scenario_drafts" USING btree ("tenant_id") WHERE "automation_scenario_drafts"."state" = 'pending';--> statement-breakpoint

-- T-097 rules (generated by gen.py; plan docs/tasks/T-097.md)
-- T-097 (PR-94, UX-55; plan docs/tasks/T-097.md; DEC-109): automation scenarios with one occurrence per (scenario, source, offset), a
-- per-patient daily cap and marketing's SET-19 drafts. Helpers and guards first.

-- The delivery log's readers (plan r1 P2-2 (3)): owner, admin_pusat, central_cs, marketing, auditor tenant-wide; manager and facility_head
-- at their allowed branches.
CREATE FUNCTION public.automation_occurrences_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
           public.app_acting_role() = ANY (ARRAY['owner','admin_pusat','central_cs','marketing','auditor'])
        OR public.app_acting_role() = ANY (ARRAY['manager','facility_head']) AND public.app_branch_allowed(p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_occurrences_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.automation_occurrences_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- An occurrence is written once and never changes or goes.
CREATE FUNCTION public.automation_occurrences_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'an automation occurrence is never changed or deleted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_occurrences_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER automation_occurrences_guard BEFORE INSERT OR UPDATE OR DELETE ON public.automation_occurrences FOR EACH ROW EXECUTE FUNCTION public.automation_occurrences_guard();--> statement-breakpoint
ALTER TABLE public.automation_occurrences ENABLE ALWAYS TRIGGER automation_occurrences_guard;--> statement-breakpoint
CREATE TRIGGER automation_occurrences_no_truncate BEFORE TRUNCATE ON public.automation_occurrences FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- A draft is never deleted; its value, reason, key and proposer are frozen; it is created pending and decided once.
CREATE FUNCTION public.automation_scenario_drafts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scenario drafts are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.decided_by IS NOT NULL THEN
      RAISE EXCEPTION 'a scenario draft starts pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.value, NEW.reason, NEW.command_key, NEW.proposed_by, NEW.proposed_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.value, OLD.reason, OLD.command_key, OLD.proposed_by, OLD.proposed_at)
     OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RAISE EXCEPTION 'a scenario draft keeps its proposal and is decided once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_scenario_drafts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER automation_scenario_drafts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.automation_scenario_drafts FOR EACH ROW EXECUTE FUNCTION public.automation_scenario_drafts_guard();--> statement-breakpoint
ALTER TABLE public.automation_scenario_drafts ENABLE ALWAYS TRIGGER automation_scenario_drafts_guard;--> statement-breakpoint
CREATE TRIGGER automation_scenario_drafts_no_truncate BEFORE TRUNCATE ON public.automation_scenario_drafts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

ALTER TABLE public.automation_occurrences ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY automation_occurrences_read ON public.automation_occurrences FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.automation_occurrences_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.automation_occurrences TO clinic_app;--> statement-breakpoint
CREATE POLICY automation_occurrences_operator_read ON public.automation_occurrences FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.automation_occurrences', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.automation_occurrences TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.automation_scenario_drafts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY automation_scenario_drafts_read ON public.automation_scenario_drafts FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','marketing']));--> statement-breakpoint
GRANT SELECT ON public.automation_scenario_drafts TO clinic_app;--> statement-breakpoint
CREATE POLICY automation_scenario_drafts_operator_read ON public.automation_scenario_drafts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.automation_scenario_drafts', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.automation_scenario_drafts TO clinic_operator;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.automation_occurrences', 'tenant-shared', 'crm', '{owner,admin_pusat,central_cs,marketing,auditor,manager,facility_head}', 'automation_scan (src/modules/crm/automation)', 'the source branch'),
  ('public.automation_scenario_drafts', 'tenant-shared', 'crm', '{owner,admin_pusat,marketing}', 'automation_draft_* (src/modules/crm/automation)', 'none: tenant-wide');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.automation_occurrences', 'personal'),
  ('public.automation_scenario_drafts', 'config');--> statement-breakpoint

-- T-097 (plan r1 §3, P1-3; review r2 P3-1): the per-patient daily cap of automated messages (PR-94, SET-19 batas_harian).


-- Automated messages of a patient cluster counted on a branch-local day: care reminders, aftercare and promos that are queued, being
-- sent or sent. A sent / sending row counts on the day it went out; a queued row on the day it will go out (a budget- or suspension-
-- deferred row has moved its planned_for; a carried-over row older than today goes out today).
CREATE FUNCTION public.automation_cap_count(p_tenant uuid, p_patient uuid, p_day date, p_today date, p_tz text) RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT count(*)::integer FROM public.outbound_messages o
   WHERE o.tenant_id = p_tenant AND o.patient_id = ANY (public.patient_cluster(p_tenant, public.patient_canonical(p_tenant, p_patient)))
     AND o.purpose IN ('care_reminder','aftercare','promo') AND o.state IN ('queued','sending','sent')
     AND CASE WHEN o.state IN ('sending','sent') THEN (coalesce(o.sent_at, o.claimed_at) AT TIME ZONE p_tz)::date
              ELSE greatest(o.planned_for, p_today) END = p_day
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_cap_count(uuid, uuid, date, date, text) FROM PUBLIC;--> statement-breakpoint

-- The day an automated message of a patient goes out under the cap: today if it has room, else the first of the next 7 days with room
-- (before p_last when the scenario has a deadline, e.g. the appointment day for pengingat); NULL when none. The caller holds the
-- staff_access lock and then the patient's cap lock (DEC-043 order), so two workers never both see room for the same slot.
CREATE FUNCTION public.automation_cap_day(p_tenant uuid, p_patient uuid, p_today date, p_cap integer, p_last date, p_tz text) RETURNS date
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_step integer;
  v_day date;
BEGIN
  FOR v_step IN 0..7 LOOP
    v_day := p_today + v_step;
    EXIT WHEN p_last IS NOT NULL AND v_day >= p_last;
    IF public.automation_cap_count(p_tenant, p_patient, v_day, p_today, p_tz) < p_cap THEN
      RETURN v_day;
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_cap_day(uuid, uuid, date, integer, date, text) FROM PUBLIC;--> statement-breakpoint

-- The patient's cap lock (after staff_access): two scans for one patient serialize on count + enqueue.
CREATE FUNCTION public.automation_cap_lock(p_tenant uuid, p_patient uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('automation_cap:' || p_tenant::text || ':' || public.patient_canonical(p_tenant, p_patient)::text, 0))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_cap_lock(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- T-097 (plan r1 §1–§3): one occurrence under the cap.

-- One occurrence: under the patient's cap lock, the first day with room (today … today + 7, before p_last), then the queue (T-094's
-- outbound_enqueue_do with the scenario's (purpose, source) pair). Idempotent per (scenario, source, offset): a second call answers the
-- first row. Refusals of the queue (consent, phone, number, template) are recorded as a skipped occurrence. Returns the occurrence id.
-- The caller (the scan) holds the staff_access lock (DEC-043 order: staff_access, then the cap lock).
CREATE FUNCTION public.automation_occur(p_tenant uuid, p_branch uuid, p_scenario text, p_source_kind text, p_source uuid, p_patient uuid,
                                        p_offset integer, p_today date, p_cap integer, p_last date, p_tz text, p_purpose text,
                                        p_queue_kind text, p_queue_source uuid, p_template uuid, p_now timestamptz) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
  v_day date;
  v_out uuid;
  v_reason text;
  v_patient uuid := public.patient_canonical(p_tenant, p_patient);
BEGIN
  SELECT x.id INTO v_id FROM public.automation_occurrences x
   WHERE x.tenant_id = p_tenant AND x.scenario = p_scenario AND x.source_id = p_source AND x.offset_days = p_offset;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  PERFORM public.automation_cap_lock(p_tenant, v_patient);
  -- re-read under the cap lock (a concurrent scan may have written it)
  SELECT x.id INTO v_id FROM public.automation_occurrences x
   WHERE x.tenant_id = p_tenant AND x.scenario = p_scenario AND x.source_id = p_source AND x.offset_days = p_offset;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF p_template IS NULL THEN
    v_reason := 'template_missing';
  ELSE
    v_day := public.automation_cap_day(p_tenant, v_patient, p_today, p_cap, p_last, p_tz);
    IF v_day IS NULL THEN
      v_reason := 'cap_horizon_exceeded';
    ELSE
      BEGIN
        v_out := public.outbound_enqueue_do(p_tenant, 'auto:' || p_scenario || ':' || p_source::text || ':' || p_offset::text, p_purpose, v_patient,
                                            p_branch, p_template, p_queue_kind, p_queue_source, v_day, NULL, NULL, p_now);
      EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE 'P0002' OR SQLSTATE '22023' THEN
        GET STACKED DIAGNOSTICS v_reason = MESSAGE_TEXT;
        v_reason := CASE WHEN v_reason LIKE '%no_marketing_consent%' THEN 'no_consent'
                         WHEN v_reason LIKE '%patient_phone_required%' THEN 'patient_phone_required'
                         WHEN v_reason LIKE '%number_not_sending%' THEN 'number_not_sending'
                         ELSE 'template_not_usable' END;
        v_out := NULL;
      END;
    END IF;
  END IF;
  INSERT INTO public.automation_occurrences (tenant_id, branch_id, scenario, source_kind, source_id, patient_id, offset_days,
                                             original_planned_for, planned_for, cap_deferred_days, state, skip_reason, outbound_id, created_at)
  VALUES (p_tenant, p_branch, p_scenario, p_source_kind, p_source, v_patient, p_offset, p_today,
          CASE WHEN v_out IS NOT NULL THEN v_day END, CASE WHEN v_out IS NOT NULL THEN v_day - p_today ELSE 0 END,
          CASE WHEN v_out IS NOT NULL THEN 'queued' ELSE 'skipped' END, CASE WHEN v_out IS NULL THEN v_reason END, v_out, p_now)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_occur(uuid, uuid, text, text, uuid, uuid, integer, date, integer, date, text, text, text, uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- T-097 (plan r1 §4; review r1 P1-1): marketing's SET-19 drafts; Admin Pusat or the owner decides through setting_set.

-- Marketing proposes (the value checked against SET-19's own spec, as the settings writer does).
CREATE FUNCTION public.automation_draft_propose(p_key text, p_value jsonb, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'marketing' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only marketing proposes a scenario draft' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED' USING ERRCODE = '42501';
  END IF;
  SELECT x.id INTO v_id FROM public.automation_scenario_drafts x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500
     OR NOT public.setting_value_ok((SELECT d.spec FROM public.setting_defs d WHERE d.key = 'SET-19'), p_value) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: draft' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.automation_scenario_drafts x WHERE x.tenant_id = a.tenant_id AND x.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a draft is already waiting' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.automation_scenario_drafts (tenant_id, value, reason, command_key, proposed_by)
  VALUES (a.tenant_id, p_value, btrim(p_reason), p_key, a.staff_id) RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'automation_scenario_draft', v_id, 'success', 'automation_draft_proposed');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_draft_propose(text, jsonb, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.automation_draft_propose(text, jsonb, text) TO clinic_app;--> statement-breakpoint

-- Admin Pusat or the owner decides another person's draft; approve writes the setting as the bound approver.
CREATE FUNCTION public.automation_draft_decide(p_draft uuid, p_approve boolean, p_reason text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  d public.automation_scenario_drafts;
  r jsonb;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('admin_pusat','owner') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only Admin Pusat or the owner decides a scenario draft' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public.automation_scenario_drafts x WHERE x.tenant_id = a.tenant_id AND x.id = p_draft FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: draft not found' USING ERRCODE = 'P0002';
  END IF;
  IF d.state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: draft_decided' USING ERRCODE = '55000';
  END IF;
  IF d.proposed_by = a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the proposer does not decide' USING ERRCODE = '42501';
  END IF;
  IF p_approve THEN
    r := public.setting_set('SET-19', NULL, d.value, NULL, coalesce(nullif(btrim(p_reason), ''), d.reason), false);
    UPDATE public.automation_scenario_drafts SET state = 'approved', decided_by = a.staff_id, decided_as = a.role, decided_at = clock_timestamp(),
           decision_reason = nullif(btrim(p_reason), ''), setting_version_id = (r ->> 'version_id')::uuid
     WHERE tenant_id = d.tenant_id AND id = d.id;
  ELSE
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
    END IF;
    UPDATE public.automation_scenario_drafts SET state = 'rejected', decided_by = a.staff_id, decided_as = a.role, decided_at = clock_timestamp(),
           decision_reason = btrim(p_reason)
     WHERE tenant_id = d.tenant_id AND id = d.id;
  END IF;
  PERFORM public.audit_append('settings_change', 'automation_scenario_draft', d.id, 'success',
                              CASE WHEN p_approve THEN 'automation_draft_approved' ELSE 'automation_draft_rejected' END);
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_draft_decide(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.automation_draft_decide(uuid, boolean, text) TO clinic_app;--> statement-breakpoint

-- The proposer withdraws a pending draft.
CREATE FUNCTION public.automation_draft_cancel(p_draft uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  d public.automation_scenario_drafts;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT * INTO d FROM public.automation_scenario_drafts x WHERE x.tenant_id = a.tenant_id AND x.id = p_draft FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: draft not found' USING ERRCODE = 'P0002';
  END IF;
  IF d.proposed_by <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the proposer withdraws a draft' USING ERRCODE = '42501';
  END IF;
  IF d.state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: draft_decided' USING ERRCODE = '55000';
  END IF;
  UPDATE public.automation_scenario_drafts SET state = 'cancelled', decided_by = a.staff_id, decided_as = a.role, decided_at = clock_timestamp()
   WHERE tenant_id = d.tenant_id AND id = d.id;
  PERFORM public.audit_append('settings_change', 'automation_scenario_draft', d.id, 'success', 'automation_draft_cancelled');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_draft_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.automation_draft_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- T-097 (plan r1 §2, review r2 P3-2): the scan. Unbound (a worker; refuses a bound connection), per live tenant and enabled SET-19
-- scenario, in the source branch's timezone, only while that branch's local time is 07:00–21:00 (P-25, as 0110). Each due source becomes
-- one occurrence through automation_occur (the cap, the queue). SET-19 is read on the unbound path with followup_setting (tenant-wide).

-- The approved template of a tenant by name and category (the WABA's, Indonesian first).
CREATE FUNCTION public.automation_template(p_tenant uuid, p_name text, p_category text) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT t.id FROM public.wa_templates t
   WHERE t.tenant_id = p_tenant AND t.name = p_name AND t.status = 'approved' AND t.category = p_category
   ORDER BY t.language = 'id' DESC, t.id LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_template(uuid, text, text) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.automation_scan(p_now timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  t record;
  c record;
  v_set jsonb;
  v_cap integer;
  v_k integer;
  v_tz text;
  v_today date;
  v_care uuid;
  v_remind uuid;
  v_promo uuid;
  v_birthday uuid;
  v_n integer := 0;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'automation_scan runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  FOR t IN SELECT tr.id AS tenant_id FROM public.tenants_registry tr WHERE tr.lifecycle_state IN ('onboarding','live','suspended') ORDER BY tr.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || t.tenant_id::text, 0));
    v_set := public.followup_setting(t.tenant_id, 'SET-19', v_now);
    v_cap := (v_set ->> 'batas_harian')::integer;
    v_care := public.automation_template(t.tenant_id, 'tindak_lanjut_perawatan', 'utility');
    v_remind := public.automation_template(t.tenant_id, 'pengingat_janji', 'utility');
    v_promo := public.automation_template(t.tenant_id, 'isi_ulang_produk', 'marketing');
    v_birthday := public.automation_template(t.tenant_id, 'sapaan_ulang_tahun', 'marketing');

    -- pengingat: H-k before a booked / confirmed appointment (H-1 and same day are T-095's) → ('care_reminder', 'appointment')
    v_k := (v_set ->> 'pengingat')::integer;
    IF v_k IS NOT NULL THEN
      FOR c IN SELECT ap.id, ap.branch_id, ap.patient_id, ap.starts_at, b.timezone FROM public.appointments ap
                 JOIN public.branches b ON b.tenant_id = ap.tenant_id AND b.id = ap.branch_id
                WHERE ap.tenant_id = t.tenant_id AND ap.state IN ('booked','confirmed') AND ap.starts_at > v_now
                  AND (ap.starts_at AT TIME ZONE b.timezone)::date = (v_now AT TIME ZONE b.timezone)::date + v_k LOOP
        CONTINUE WHEN (v_now AT TIME ZONE c.timezone)::time < time '07:00' OR (v_now AT TIME ZONE c.timezone)::time >= time '21:00';
        v_today := (v_now AT TIME ZONE c.timezone)::date;
        PERFORM public.automation_occur(t.tenant_id, c.branch_id, 'pengingat', 'appointment', c.id, c.patient_id, v_k, v_today, v_cap,
                                        (c.starts_at AT TIME ZONE c.timezone)::date, c.timezone, 'care_reminder', 'appointment', c.id, v_remind, v_now);
        v_n := v_n + 1;
      END LOOP;
    END IF;

    -- post-visit care: aftercare (needs a counted execution), kepuasan, rencana (an unselected, unbilled, non-removed plan item from the
    -- visit's examinations), belum_jadwal (the cluster's latest visit, no open visit, no live appointment) → ('care_reminder', 'followup')
    FOR c IN SELECT v.id, v.branch_id, v.patient_id, b.timezone, (v.closed_at AT TIME ZONE b.timezone)::date AS closed_day,
                    k.scenario, (v_set ->> k.scenario)::integer AS k
               FROM public.visits v
               JOIN public.branches b ON b.tenant_id = v.tenant_id AND b.id = v.branch_id
               CROSS JOIN (VALUES ('aftercare'), ('kepuasan'), ('rencana'), ('belum_jadwal')) k(scenario)
              WHERE v.tenant_id = t.tenant_id AND v.closed_at IS NOT NULL AND (v_set ->> k.scenario) IS NOT NULL
                AND (v_set ->> k.scenario) <> 'false'
                AND (v.closed_at AT TIME ZONE b.timezone)::date + (v_set ->> k.scenario)::integer = (v_now AT TIME ZONE b.timezone)::date LOOP
      CONTINUE WHEN (v_now AT TIME ZONE c.timezone)::time < time '07:00' OR (v_now AT TIME ZONE c.timezone)::time >= time '21:00';
      CONTINUE WHEN c.scenario = 'aftercare' AND NOT EXISTS (SELECT 1 FROM public.treatment_executions e
                     WHERE e.tenant_id = t.tenant_id AND e.visit_id = c.id AND e.counted);
      CONTINUE WHEN c.scenario = 'rencana' AND NOT EXISTS (
        SELECT 1 FROM public.examinations e
          JOIN public.care_plans cp ON cp.tenant_id = e.tenant_id AND cp.state = 'active'
          JOIN public.plan_items pi ON pi.tenant_id = cp.tenant_id AND pi.plan_id = cp.id AND pi.removed_at IS NULL
                                    AND (cp.created_exam_id = e.id OR pi.examination_id = e.id)
         WHERE e.tenant_id = t.tenant_id AND e.visit_id = c.id
           AND coalesce((SELECT sum(si.quantity) FROM public.selection_items si WHERE si.tenant_id = pi.tenant_id AND si.plan_item_id = pi.id), 0) < pi.qty
           AND NOT EXISTS (SELECT 1 FROM public.invoice_lines il JOIN public.invoices i ON i.tenant_id = il.tenant_id AND i.id = il.invoice_id AND i.state = 'issued'
                            WHERE il.tenant_id = pi.tenant_id AND il.plan_item_id = pi.id));
      CONTINUE WHEN c.scenario = 'belum_jadwal' AND (
        EXISTS (SELECT 1 FROM public.visits v2 WHERE v2.tenant_id = t.tenant_id AND v2.patient_id = ANY (public.patient_cluster(t.tenant_id, public.patient_canonical(t.tenant_id, c.patient_id)))
                 AND (v2.closed_at IS NULL OR v2.checked_in_at > (SELECT v3.checked_in_at FROM public.visits v3 WHERE v3.tenant_id = t.tenant_id AND v3.id = c.id)))
        OR EXISTS (SELECT 1 FROM public.appointments ap WHERE ap.tenant_id = t.tenant_id AND ap.patient_id = ANY (public.patient_cluster(t.tenant_id, public.patient_canonical(t.tenant_id, c.patient_id)))
                    AND public.appointment_live(ap)));
      v_today := (v_now AT TIME ZONE c.timezone)::date;
      PERFORM public.automation_occur(t.tenant_id, c.branch_id, c.scenario, 'visit', c.id, c.patient_id, c.k, v_today, v_cap, NULL, c.timezone,
                                      'care_reminder', 'followup', c.id, v_care, v_now);
      v_n := v_n + 1;
    END LOOP;

    -- isi_ulang: H-k before a handed product's estimated run-out (supply days from the prescription's SET-48 snapshot, else SET-48 now),
    -- not a returned line → ('promo', 'patient') with marketing consent (T-094 checks it at enqueue and dispatch)
    v_k := (v_set ->> 'isi_ulang')::integer;
    IF v_k IS NOT NULL THEN
      FOR c IN SELECT d.id, d.branch_id, d.patient_id, b.timezone,
                      (d.handed_at AT TIME ZONE b.timezone)::date
                        + coalesce((rx.set48_snapshot ->> CASE WHEN rx.is_acute THEN 'masa_akut' ELSE 'masa' END)::integer,
                                   (public.followup_setting(d.tenant_id, 'SET-48', v_now) ->> 'masa')::integer, 30) AS run_out
                 FROM public.dispensings d
                 JOIN public.branches b ON b.tenant_id = d.tenant_id AND b.id = d.branch_id
                 LEFT JOIN public.prescription_items pi ON pi.tenant_id = d.tenant_id AND pi.id = d.prescription_item_id
                 LEFT JOIN public.prescriptions rx ON rx.tenant_id = pi.tenant_id AND rx.id = pi.prescription_id
                WHERE d.tenant_id = t.tenant_id AND d.state = 'handed'
                  AND NOT EXISTS (SELECT 1 FROM public.refunds r WHERE r.tenant_id = d.tenant_id AND r.state = 'paid' AND r.returned_quantity IS NOT NULL
                                   AND r.invoice_line_id = d.invoice_line_id) LOOP
        v_today := (v_now AT TIME ZONE c.timezone)::date;
        CONTINUE WHEN v_today <> c.run_out - v_k;
        CONTINUE WHEN (v_now AT TIME ZONE c.timezone)::time < time '07:00' OR (v_now AT TIME ZONE c.timezone)::time >= time '21:00';
        PERFORM public.automation_occur(t.tenant_id, c.branch_id, 'isi_ulang', 'dispensing', c.id, c.patient_id, v_k, v_today, v_cap, NULL,
                                        c.timezone, 'promo', 'patient', public.patient_canonical(t.tenant_id, c.patient_id), v_promo, v_now);
        v_n := v_n + 1;
      END LOOP;
    END IF;

    -- ulang_tahun (when true): on the birth date's month / day in the registered branch's timezone (29 Feb → 28 Feb in a non-leap year),
    -- once a year (offset = the year) → ('promo', 'patient') with marketing consent
    IF (v_set ->> 'ulang_tahun') = 'true' THEN
      FOR c IN SELECT pt.id, pt.registered_branch_id AS branch_id, b.timezone, pt.birth_date FROM public.patients pt
                 JOIN public.branches b ON b.tenant_id = pt.tenant_id AND b.id = pt.registered_branch_id
                WHERE pt.tenant_id = t.tenant_id AND NOT public.patient_is_merged(pt.tenant_id, pt.id) LOOP
        v_today := (v_now AT TIME ZONE c.timezone)::date;
        CONTINUE WHEN NOT (extract(month FROM c.birth_date) = extract(month FROM v_today)
          AND (extract(day FROM c.birth_date) = extract(day FROM v_today)
               OR extract(month FROM c.birth_date) = 2 AND extract(day FROM c.birth_date) = 29 AND extract(day FROM v_today) = 28
                  AND extract(day FROM (v_today + 1)) = 1));
        CONTINUE WHEN (v_now AT TIME ZONE c.timezone)::time < time '07:00' OR (v_now AT TIME ZONE c.timezone)::time >= time '21:00';
        PERFORM public.automation_occur(t.tenant_id, c.branch_id, 'ulang_tahun', 'patient', c.id, c.id, extract(year FROM v_today)::integer,
                                        v_today, v_cap, NULL, c.timezone, 'promo', 'patient', c.id, v_birthday, v_now);
        v_n := v_n + 1;
      END LOOP;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('considered', v_n);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_scan(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.automation_scan(timestamptz) TO clinic_app;--> statement-breakpoint

-- T-097 (plan r1 §4.4, P2-2 (3)): the delivery log and the draft reader for /otomasi. Bound; the actor lock first (DEC-043). Identity as
-- 0108 followup_json: owner, admin_pusat, central_cs, facility_head, manager see the name and MRN; marketing only with an active
-- marketing_wa consent on the cluster (else masked); the auditor a masked MRN tail. Never a message body or a treatment name.
CREATE FUNCTION public.automation_log_list(p_scenario text DEFAULT NULL, p_state text DEFAULT 'all') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','central_cs','marketing','auditor','manager','facility_head') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the delivery log' USING ERRCODE = '42501';
  END IF;
  IF p_scenario IS NOT NULL AND p_scenario NOT IN ('pengingat','aftercare','kepuasan','rencana','belum_jadwal','isi_ulang','ulang_tahun')
     OR coalesce(p_state, 'all') NOT IN ('all','queued','sent','capped','skipped') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: filter' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'rows', coalesce((
    SELECT jsonb_agg(r ORDER BY r ->> 'created_at' DESC, r ->> 'id' DESC) FROM (
      SELECT jsonb_build_object('id', x.id, 'scenario', x.scenario, 'branch_id', x.branch_id,
               'branch_name', (SELECT b.name FROM public.branches b WHERE b.tenant_id = x.tenant_id AND b.id = x.branch_id),
               'original_planned_for', x.original_planned_for, 'planned_for', x.planned_for, 'cap_deferred_days', x.cap_deferred_days,
               'capped', x.cap_deferred_days > 0 OR x.skip_reason = 'cap_horizon_exceeded',
               'state', CASE WHEN x.state = 'skipped' THEN 'skipped' ELSE coalesce(o.state, 'queued') END, 'skip_reason', x.skip_reason,
               'consent_masked', NOT v.identity AND a.role = 'marketing',
               'patient_name', CASE WHEN v.identity THEN pt.full_name END,
               'patient_mrn', CASE WHEN v.identity THEN pt.mrn WHEN a.role = 'auditor' THEN '***' || right(pt.mrn, 3) END,
               'created_at', x.created_at) AS r
        FROM public.automation_occurrences x
        JOIN public.patients pt ON pt.tenant_id = x.tenant_id AND pt.id = x.patient_id
        LEFT JOIN public.outbound_messages o ON o.tenant_id = x.tenant_id AND o.id = x.outbound_id
        CROSS JOIN LATERAL (SELECT a.role IN ('owner','admin_pusat','central_cs','facility_head','manager')
                                   OR a.role = 'marketing' AND EXISTS (SELECT 1 FROM public.consents c WHERE c.tenant_id = x.tenant_id AND c.purpose = 'marketing_wa'
                                        AND c.withdrawn_at IS NULL AND c.patient_id = ANY (public.patient_cluster(x.tenant_id, x.patient_id))) AS identity) v
       WHERE x.tenant_id = a.tenant_id AND public.automation_occurrences_readable(x.tenant_id, x.branch_id)
         AND (a.branch_id IS NULL OR x.branch_id = a.branch_id)
         AND (p_scenario IS NULL OR x.scenario = p_scenario)
         AND CASE coalesce(p_state, 'all') WHEN 'all' THEN true
               WHEN 'capped' THEN x.cap_deferred_days > 0 OR x.skip_reason = 'cap_horizon_exceeded'
               WHEN 'skipped' THEN x.state = 'skipped'
               WHEN 'sent' THEN o.state = 'sent'
               ELSE x.state = 'queued' AND coalesce(o.state, 'queued') IN ('queued','sending') END
       ORDER BY x.created_at DESC, x.id DESC LIMIT 200) q), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_log_list(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.automation_log_list(text, text) TO clinic_app;--> statement-breakpoint

-- The pending draft (if any) for /otomasi: owner, admin_pusat and marketing.
CREATE FUNCTION public.automation_draft_get() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','marketing') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read scenario drafts' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object('id', d.id, 'value', d.value, 'reason', d.reason, 'proposed_at', d.proposed_at,
            'proposed_by_me', d.proposed_by = a.staff_id,
            'proposer', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = d.tenant_id AND s.id = d.proposed_by))
            FROM public.automation_scenario_drafts d WHERE d.tenant_id = a.tenant_id AND d.state = 'pending');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.automation_draft_get() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.automation_draft_get() TO clinic_app;
