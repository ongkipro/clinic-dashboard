CREATE TABLE "campaign_segments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb NOT NULL,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "campaign_segments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "campaign_segments_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "campaign_segments_check" CHECK ("campaign_segments"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and length(btrim("campaign_segments"."name")) between 2 and 120 and jsonb_typeof("campaign_segments"."rules") = 'object'
      and "campaign_segments"."created_as" in ('owner','admin_pusat','marketing'))
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" DROP CONSTRAINT "outbound_messages_check";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "segment_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "scheduled_for" date;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "send_state" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "queued_by" uuid;--> statement-breakpoint
ALTER TABLE "campaign_segments" ADD CONSTRAINT "campaign_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_segments" ADD CONSTRAINT "campaign_segments_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_fk" FOREIGN KEY ("tenant_id","segment_id") REFERENCES "public"."campaign_segments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."wa_templates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_queued_by_fk" FOREIGN KEY ("tenant_id","queued_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_check" CHECK ("outbound_messages"."purpose" in ('care_reminder','aftercare','promo','bill') and "outbound_messages"."category" in ('utility','marketing')
      and (("outbound_messages"."purpose" = 'promo') = ("outbound_messages"."category" = 'marketing')) and "outbound_messages"."state" in ('queued','sending','sent','skipped','failed')
      and ("outbound_messages"."purpose", "outbound_messages"."source_kind") in (('bill','visit'), ('care_reminder','appointment'), ('care_reminder','followup'), ('care_reminder','consultation_control'), ('aftercare','visit'), ('promo','campaign'), ('promo','promo_code'), ('promo','patient'))
      and "outbound_messages"."contact_wa_id" ~ '^[1-9][0-9]{7,14}$' and "outbound_messages"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "outbound_messages"."rescheduled_count" between 0 and 365 and "outbound_messages"."attempt_count" between 0 and 20
      and (("outbound_messages"."enqueued_by" is null) = ("outbound_messages"."enqueued_as" is null))
      and (("outbound_messages"."state" = 'sent') = ("outbound_messages"."sent_at" is not null and "outbound_messages"."provider_message_id" is not null))
      and (("outbound_messages"."state" = 'skipped') = ("outbound_messages"."skip_reason" is not null)) and (("outbound_messages"."state" = 'failed') = ("outbound_messages"."error_code" is not null))
      and ("outbound_messages"."state" not in ('sending','sent','failed') or "outbound_messages"."claimed_at" is not null)
      and (("outbound_messages"."state" in ('sent','skipped','failed')) = ("outbound_messages"."decided_at" is not null))
      and ("outbound_messages"."skip_reason" is null or "outbound_messages"."skip_reason" in ('consent_withdrawn','patient_merged','number_not_sending','template_withdrawn','campaign_locked','cap_horizon_exceeded'))
      and ("outbound_messages"."deferred_reason" is null or "outbound_messages"."deferred_reason" in ('budget_reached','tenant_suspended','cap_reached')));--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_send_check" CHECK ("campaigns"."send_state" in ('draft','scheduled','queued','cancelled')
      and ("campaigns"."send_state" in ('scheduled','queued')) <= ("campaigns"."segment_id" is not null and "campaigns"."template_id" is not null and "campaigns"."scheduled_for" is not null)
      and ("campaigns"."send_state" = 'queued') = ("campaigns"."queued_at" is not null and "campaigns"."queued_by" is not null));--> statement-breakpoint

-- T-100 rules (generated by gen.py; plan docs/tasks/T-100.md)
-- T-100 (PR-94, UX-19, plan docs/tasks/T-100.md r3, DEC-112): campaigns and segments; sending switched off until the Q-15 counsel evidence.

-- The campaign workspace readers (07:64 Public site & promos): owner, admin_pusat, marketing; the auditor reads.
CREATE FUNCTION public.campaign_workspace_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_acting_role() = ANY (ARRAY['owner','admin_pusat','marketing','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_workspace_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_workspace_readable(uuid) TO clinic_app;--> statement-breakpoint

-- review r1 P1-2 (a): the campaign_sending gate for a GIVEN tenant — the same rule as feature_gate_open (every obligation of the gate open:
-- tenant obligations for this tenant, vendor obligations at platform level; an unknown gate closed), usable on the unbound worker.
CREATE FUNCTION public.campaign_gate_open(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.feature_gates g WHERE g.key = 'campaign_sending')
     AND NOT EXISTS (SELECT 1 FROM public.feature_gates g JOIN public.compliance_obligations o ON o.key = g.obligation_key
                      WHERE g.key = 'campaign_sending'
                        AND NOT CASE o.scope
                              WHEN 'vendor' THEN public.vendor_evidence_open(o.key)
                              WHEN 'tenant' THEN coalesce((SELECT public.evidence_item_open(i.id) FROM public.evidence_items i
                                                            WHERE i.tenant_id = p_tenant AND i.obligation_key = o.key), false)
                              ELSE false END)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_gate_open(uuid) FROM PUBLIC;--> statement-breakpoint

-- The closed rule set of a segment (review r1 P1-1: no service, procedure, package or diagnosis). rules = {branch_id?, visit_within_days?,
-- no_visit_within_days?, birthday_month?, age_min?, age_max?, sex?}; at least one key; numbers in range; ids as uuid text.
CREATE FUNCTION public.campaign_rules_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(p) = 'object' AND p <> '{}'::jsonb
     AND p - 'branch_id' - 'visit_within_days' - 'no_visit_within_days' - 'birthday_month' - 'age_min' - 'age_max' - 'sex' = '{}'::jsonb
     AND (NOT p ? 'branch_id' OR jsonb_typeof(p -> 'branch_id') = 'string'
          AND (p ->> 'branch_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     AND (NOT p ? 'visit_within_days' OR jsonb_typeof(p -> 'visit_within_days') = 'number' AND (p ->> 'visit_within_days') ~ '^[1-9][0-9]{0,2}$'
          AND (p ->> 'visit_within_days')::integer <= 730)
     AND (NOT p ? 'no_visit_within_days' OR jsonb_typeof(p -> 'no_visit_within_days') = 'number' AND (p ->> 'no_visit_within_days') ~ '^[1-9][0-9]{0,2}$'
          AND (p ->> 'no_visit_within_days')::integer <= 730)
     AND (NOT (p ? 'visit_within_days' AND p ? 'no_visit_within_days'))
     AND (NOT p ? 'birthday_month' OR jsonb_typeof(p -> 'birthday_month') = 'number' AND (p ->> 'birthday_month') ~ '^([1-9]|1[0-2])$')
     AND (NOT p ? 'age_min' OR jsonb_typeof(p -> 'age_min') = 'number' AND (p ->> 'age_min') ~ '^[0-9]{1,3}$' AND (p ->> 'age_min')::integer <= 120)
     AND (NOT p ? 'age_max' OR jsonb_typeof(p -> 'age_max') = 'number' AND (p ->> 'age_max') ~ '^[0-9]{1,3}$' AND (p ->> 'age_max')::integer <= 120)
     AND (NOT (p ? 'age_min' AND p ? 'age_max') OR (p ->> 'age_min')::integer <= (p ->> 'age_max')::integer)
     AND (NOT p ? 'sex' OR p ->> 'sex' IN ('female','male'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_rules_ok(jsonb) FROM PUBLIC;--> statement-breakpoint

-- The consented members of a segment on a branch-local day: canonical patients (merged records once) matching every rule AND holding an
-- active marketing_wa consent on their cluster (PR-4). Rules are checked on the canonical patient's own row; the visit window on any visit of
-- the cluster (visit date only). Not granted.
CREATE FUNCTION public.campaign_members(p_tenant uuid, p_rules jsonb, p_today date) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT pt.id FROM public.patients pt
   WHERE pt.tenant_id = p_tenant
     AND public.patient_canonical(p_tenant, pt.id) = pt.id
     AND EXISTS (SELECT 1 FROM public.consents c WHERE c.tenant_id = p_tenant AND c.purpose = 'marketing_wa' AND c.withdrawn_at IS NULL
                   AND c.patient_id = ANY (public.patient_cluster(p_tenant, pt.id)))
     AND (NOT p_rules ? 'branch_id' OR pt.registered_branch_id = (p_rules ->> 'branch_id')::uuid)
     AND (NOT p_rules ? 'birthday_month' OR extract(month FROM pt.birth_date) = (p_rules ->> 'birthday_month')::integer)
     AND (NOT p_rules ? 'sex' OR pt.sex = p_rules ->> 'sex')
     AND (NOT p_rules ? 'age_min' OR extract(year FROM age(p_today, pt.birth_date)) >= (p_rules ->> 'age_min')::integer)
     AND (NOT p_rules ? 'age_max' OR extract(year FROM age(p_today, pt.birth_date)) <= (p_rules ->> 'age_max')::integer)
     AND (NOT p_rules ? 'visit_within_days' OR EXISTS (
            SELECT 1 FROM public.visits v WHERE v.tenant_id = p_tenant AND v.patient_id = ANY (public.patient_cluster(p_tenant, pt.id))
               AND v.checked_in_at >= (p_today - (p_rules ->> 'visit_within_days')::integer)::timestamp AT TIME ZONE 'Asia/Jakarta'))
     AND (NOT p_rules ? 'no_visit_within_days' OR NOT EXISTS (
            SELECT 1 FROM public.visits v WHERE v.tenant_id = p_tenant AND v.patient_id = ANY (public.patient_cluster(p_tenant, pt.id))
               AND v.checked_in_at >= (p_today - (p_rules ->> 'no_visit_within_days')::integer)::timestamp AT TIME ZONE 'Asia/Jakarta'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_members(uuid, jsonb, date) FROM PUBLIC;--> statement-breakpoint

-- Segments: never deleted; identity frozen; the staff_access lock first (DEC-043).
CREATE FUNCTION public.campaign_segments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'campaign segments are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at) THEN
    RAISE EXCEPTION 'a campaign segment keeps its identity' USING ERRCODE = '42501';
  END IF;
  IF NOT public.campaign_rules_ok(NEW.rules) THEN
    RAISE EXCEPTION 'a campaign segment holds only the closed rule set' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_segments_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER campaign_segments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.campaign_segments FOR EACH ROW EXECUTE FUNCTION public.campaign_segments_guard();--> statement-breakpoint
ALTER TABLE public.campaign_segments ENABLE ALWAYS TRIGGER campaign_segments_guard;--> statement-breakpoint
CREATE TRIGGER campaign_segments_no_truncate BEFORE TRUNCATE ON public.campaign_segments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.campaign_segments ENABLE ALWAYS TRIGGER campaign_segments_no_truncate;--> statement-breakpoint

-- review r1 P2-2: campaigns_guard (0107) re-created — identity frozen as before; T-100 adds the send-state machine: insert as draft; draft →
-- scheduled, scheduled → draft, scheduled → queued, draft | scheduled → cancelled; queued and cancelled terminal; the workspace fields
-- (segment, template, schedule) frozen once queued or cancelled.
CREATE OR REPLACE FUNCTION public.campaigns_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'campaigns are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.code, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.code, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at) THEN
    RAISE EXCEPTION 'a campaign keeps its code' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.send_state <> 'draft' THEN
    RAISE EXCEPTION 'a campaign starts as a draft' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.send_state IS DISTINCT FROM OLD.send_state
     AND NOT ((OLD.send_state, NEW.send_state) IN (('draft','scheduled'), ('scheduled','draft'), ('scheduled','queued'), ('draft','cancelled'), ('scheduled','cancelled'))) THEN
    RAISE EXCEPTION 'a campaign moves only along its send states' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.send_state IN ('queued','cancelled')
     AND (NEW.segment_id, NEW.template_id, NEW.scheduled_for, NEW.queued_at, NEW.queued_by)
         IS DISTINCT FROM (OLD.segment_id, OLD.template_id, OLD.scheduled_for, OLD.queued_at, OLD.queued_by) THEN
    RAISE EXCEPTION 'a queued or cancelled campaign is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

ALTER TABLE public.campaign_segments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY campaign_segments_read ON public.campaign_segments FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.campaign_workspace_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.campaign_segments TO clinic_app;--> statement-breakpoint
CREATE POLICY campaign_segments_operator_read ON public.campaign_segments FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.campaign_segments', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.campaign_segments TO clinic_operator;--> statement-breakpoint
-- review r1 P2-1: the legacy lead-tag readers keep the tag columns only; the workspace columns are read through campaign_workspace_list.
REVOKE SELECT ON public.campaigns FROM clinic_app, clinic_operator;--> statement-breakpoint
GRANT SELECT (id, tenant_id, name, code, channel, active, created_by, created_as, created_at, updated_at, command_key) ON public.campaigns TO clinic_app;--> statement-breakpoint
GRANT SELECT (id, tenant_id, name, code, channel, active, created_by, created_as, created_at, updated_at, command_key) ON public.campaigns TO clinic_operator;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.campaign_segments', 'tenant-shared', 'crm', '{owner,admin_pusat,marketing,auditor}', 'campaign_segment_save (src/modules/crm/campaigns)', 'none (tenant-wide)');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.campaign_segments', 'config');--> statement-breakpoint

-- T-100 commands (plan r3 §1, §2, §4b, §5a, §6). Bound; the actor lock first (DEC-043); keyed via runCommand (the TS seam re-authorizes
-- before a replay is answered: campaign_actor_check). Roles: owner, admin_pusat, marketing. Capability: configuration for segment and
-- schedule writes, marketing_message (live only) for sending (review r1 P1-4).
CREATE FUNCTION public.campaign_actor(p_capability text) RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role, x.branch_id INTO a FROM public.tenant_actor_lock() x;
  IF a.role NOT IN ('owner','admin_pusat','marketing') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not manage campaigns' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability(p_capability) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: % is not available now', p_capability USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_actor(text) FROM PUBLIC;--> statement-breakpoint

-- The replay pre-check (as T-099's waitlist_entry_authorized): the TS seam calls it in the same transaction before runCommand, so a stored
-- answer reaches only an actor who may run the command now (role and lifecycle capability). Nothing changes.
CREATE FUNCTION public.campaign_actor_check(p_capability text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_capability NOT IN ('configuration','marketing_message') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: capability' USING ERRCODE = '22023';
  END IF;
  PERFORM public.campaign_actor(p_capability);
  RETURN true;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_actor_check(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_actor_check(text) TO clinic_app;--> statement-breakpoint

-- Save a segment. p: {id?, name, rules}. A new segment is keyed by command_key (a replay answers the first); an id edits name / rules
-- (always allowed — the Scenario's "segment remains editable").
CREATE FUNCTION public.campaign_segment_save(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.campaign_actor('configuration');
  v_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'id' - 'name' - 'rules' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'name') IS DISTINCT FROM 'string' OR length(btrim(p ->> 'name')) NOT BETWEEN 2 AND 120
     OR NOT public.campaign_rules_ok(p -> 'rules')
     OR p ? 'id' AND (jsonb_typeof(p -> 'id') IS DISTINCT FROM 'string' OR (p ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: segment' USING ERRCODE = '22023';
  END IF;
  IF (p -> 'rules') ? 'branch_id'
     AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = (p -> 'rules' ->> 'branch_id')::uuid) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF p ? 'id' THEN
    UPDATE public.campaign_segments SET name = btrim(p ->> 'name'), rules = p -> 'rules', updated_at = v_now
     WHERE tenant_id = a.tenant_id AND id = (p ->> 'id')::uuid RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: segment not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT x.id INTO v_id FROM public.campaign_segments x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
    INSERT INTO public.campaign_segments (tenant_id, name, rules, command_key, created_by, created_as, created_at, updated_at)
    VALUES (a.tenant_id, btrim(p ->> 'name'), p -> 'rules', p_key, a.staff_id, a.role, v_now, v_now) RETURNING id INTO v_id;
  END IF;
  PERFORM public.audit_append('settings_change', 'campaign_segment', v_id, 'success', 'campaign_segment_saved');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_segment_save(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_segment_save(text, jsonb) TO clinic_app;--> statement-breakpoint

-- The campaign row the actor may change (the tenant's), locked.
CREATE FUNCTION public.campaign_for(p_tenant uuid, p_campaign uuid) RETURNS public.campaigns
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.campaigns;
BEGIN
  SELECT * INTO c FROM public.campaigns x WHERE x.tenant_id = p_tenant AND x.id = p_campaign FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: campaign not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN c;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_for(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Schedule (or re-schedule) a draft / scheduled campaign: a segment of the tenant, an approved marketing template whose body passes W-05,
-- a date from today (Asia/Jakarta) to 366 days. p: {segment_id, template_id, scheduled_for}. Returns the send state.
CREATE FUNCTION public.campaign_schedule(p_campaign uuid, p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.campaign_actor('configuration');
  c public.campaigns := public.campaign_for(a.tenant_id, p_campaign);
  t public.wa_templates;
  v_day date;
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'segment_id' - 'template_id' - 'scheduled_for' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'segment_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p -> 'template_id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p -> 'scheduled_for') IS DISTINCT FROM 'string'
     OR (p ->> 'segment_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (p ->> 'template_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (p ->> 'scheduled_for') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: schedule' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_day := (p ->> 'scheduled_for')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: schedule' USING ERRCODE = '22023';
  END;
  IF v_day < v_today OR v_day > v_today + 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: scheduled_for' USING ERRCODE = '22023';
  END IF;
  IF c.send_state NOT IN ('draft','scheduled') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: campaign_final' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.campaign_segments s WHERE s.tenant_id = a.tenant_id AND s.id = (p ->> 'segment_id')::uuid) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: segment not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO t FROM public.wa_templates x WHERE x.tenant_id = a.tenant_id AND x.id = (p ->> 'template_id')::uuid;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: template not found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status <> 'approved' OR t.category <> 'marketing' OR NOT public.outbound_template_ok(a.tenant_id, t.body) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: template_not_usable' USING ERRCODE = '55000';
  END IF;
  UPDATE public.campaigns SET segment_id = (p ->> 'segment_id')::uuid, template_id = t.id, scheduled_for = v_day, send_state = 'scheduled',
         updated_at = clock_timestamp()
   WHERE tenant_id = c.tenant_id AND id = c.id;
  PERFORM public.audit_append('settings_change', 'campaign', c.id, 'success', 'campaign_scheduled');
  RETURN 'scheduled';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_schedule(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_schedule(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Back to draft (unschedule) or cancel a draft / scheduled campaign. p_to: 'draft' | 'cancelled'.
CREATE FUNCTION public.campaign_unschedule(p_campaign uuid, p_to text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.campaign_actor('configuration');
  c public.campaigns := public.campaign_for(a.tenant_id, p_campaign);
BEGIN
  IF p_to IS NULL OR p_to NOT IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: state' USING ERRCODE = '22023';
  END IF;
  IF NOT (c.send_state = 'scheduled' AND p_to = 'draft' OR c.send_state IN ('draft','scheduled') AND p_to = 'cancelled') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: campaign_final' USING ERRCODE = '55000';
  END IF;
  UPDATE public.campaigns SET send_state = p_to, updated_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = c.id;
  PERFORM public.audit_append('settings_change', 'campaign', c.id, 'success', 'campaign_' || p_to);
  RETURN p_to;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_unschedule(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_unschedule(uuid, text) TO clinic_app;--> statement-breakpoint

-- Scenario PR-94 "campaign sending gated": the gate lock, then the gate. Closed → ERR_GATE_CLOSED (the TS seam shows "Pengiriman kampanye
-- terkunci sampai bukti hukum disetujui"); nothing is enqueued, the campaign stays scheduled, the segment editable. Open → each consented
-- member under the per-patient cap (staff_access held → cap lock → first day with room from the scheduled day … +7, SET-19
-- batas_harian), queued once (key per campaign and canonical patient) through outbound_enqueue_do ('promo', 'campaign'); members it cannot
-- queue are counted by reason. The campaign becomes queued. Returns {queued, skipped: {reason: n}}; the event carries ids only (TD-50).
CREATE FUNCTION public.campaign_send(p_campaign uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.campaign_actor('marketing_message');
  c public.campaigns := public.campaign_for(a.tenant_id, p_campaign);
  s public.campaign_segments;
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now AT TIME ZONE 'Asia/Jakarta')::date;
  v_cap integer;
  v_tz text;
  v_mtoday date;
  v_day date;
  v_member uuid;
  v_branch uuid;
  v_reason text;
  v_queued integer := 0;
  v_skipped jsonb := '{}'::jsonb;
BEGIN
  IF c.send_state <> 'scheduled' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: campaign_not_scheduled' USING ERRCODE = '55000';
  END IF;
  PERFORM public.feature_gate_lock('campaign_sending');
  IF NOT public.campaign_gate_open(a.tenant_id) THEN
    RAISE EXCEPTION 'ERR_GATE_CLOSED: campaign_sending' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.campaign_segments x WHERE x.tenant_id = c.tenant_id AND x.id = c.segment_id;
  v_cap := (public.followup_setting(a.tenant_id, 'SET-19', v_now) ->> 'batas_harian')::integer;
  FOR v_member IN SELECT m FROM public.campaign_members(a.tenant_id, s.rules, v_today) m ORDER BY m LOOP
    v_reason := NULL;
    SELECT pt.registered_branch_id, b.timezone INTO v_branch, v_tz FROM public.patients pt
      JOIN public.branches b ON b.tenant_id = pt.tenant_id AND b.id = pt.registered_branch_id
     WHERE pt.tenant_id = a.tenant_id AND pt.id = v_member;
    v_mtoday := (v_now AT TIME ZONE v_tz)::date;
    PERFORM public.automation_cap_lock(a.tenant_id, v_member);
    -- the first day with room from the start day (… start + 7), on the member's branch-local calendar, counted with the real today
    v_day := NULL;
    FOR i IN 0..7 LOOP
      IF public.automation_cap_count(a.tenant_id, v_member, greatest(c.scheduled_for, v_mtoday) + i, v_mtoday, v_tz) < v_cap THEN
        v_day := greatest(c.scheduled_for, v_mtoday) + i;
        EXIT;
      END IF;
    END LOOP;
    IF v_day IS NULL THEN
      v_reason := 'cap_horizon_exceeded';
    ELSE
      BEGIN
        PERFORM public.outbound_enqueue_do(a.tenant_id, 'campaign:' || c.id::text || ':' || v_member::text, 'promo', v_member, v_branch,
                                           c.template_id, 'campaign', c.id, v_day, a.staff_id, a.role, v_now);
        v_queued := v_queued + 1;
      EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE 'P0002' OR SQLSTATE '22023' THEN
        GET STACKED DIAGNOSTICS v_reason = MESSAGE_TEXT;
        v_reason := CASE WHEN v_reason LIKE '%no_marketing_consent%' THEN 'no_consent'
                         WHEN v_reason LIKE '%patient_phone_required%' THEN 'patient_phone_required'
                         WHEN v_reason LIKE '%number_not_sending%' THEN 'number_not_sending'
                         ELSE 'template_not_usable' END;
      END;
    END IF;
    IF v_reason IS NOT NULL THEN
      v_skipped := jsonb_set(v_skipped, ARRAY[v_reason], to_jsonb(coalesce((v_skipped ->> v_reason)::integer, 0) + 1));
    END IF;
  END LOOP;
  UPDATE public.campaigns SET send_state = 'queued', queued_at = v_now, queued_by = a.staff_id, updated_at = v_now
   WHERE tenant_id = c.tenant_id AND id = c.id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (a.tenant_id, NULL, 'CampaignQueued', 'campaign', c.id, a.staff_id, a.role, v_now,
          jsonb_build_object('campaign_id', c.id, 'segment_id', c.segment_id)); -- TD-50: ids only (no numbers); counts are in the result
  PERFORM public.audit_append('settings_change', 'campaign', c.id, 'success', 'campaign_queued');
  RETURN jsonb_build_object('queued', v_queued, 'skipped', v_skipped);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_send(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_send(uuid) TO clinic_app;--> statement-breakpoint

-- T-100 (plan r3 §4c, §4d, §5b; drift allowlist §5c): outbound_enqueue and outbound_claim re-created from their reviewed 0109 bodies
-- with exactly the listed insertions (derived by make-30.py; the drift test pins the rest). Grants unchanged (CREATE OR REPLACE keeps them).
-- T-100 (plan r3 §5b, review r3 P2): the deferral day for a promo at the cap: the first day in today+1 … today+7 (measured from the dispatch
-- day) with room, counted with the REAL today (so the candidate, queued with planned_for ≤ today, counts on today, never on its
-- destination). NULL when none. The caller holds staff_access then the patient's cap lock.
CREATE FUNCTION public.outbound_cap_defer_day(p_tenant uuid, p_patient uuid, p_today date, p_cap integer, p_tz text) RETURNS date
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_step integer;
BEGIN
  FOR v_step IN 1..7 LOOP
    IF public.automation_cap_count(p_tenant, p_patient, p_today + v_step, p_today, p_tz) < p_cap THEN
      RETURN p_today + v_step;
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_cap_defer_day(uuid, uuid, date, integer, text) FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.outbound_enqueue(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_purpose text := p ->> 'purpose';
  v_branch uuid;
  v_now timestamptz;
  v_id uuid;
  v_planned date;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role, x.branch_id INTO a FROM public.tenant_actor_lock() x;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR coalesce(v_purpose, '') NOT IN ('care_reminder','aftercare','promo')
     OR p - 'purpose' - 'patient_id' - 'template_id' - 'source_kind' - 'source_id' - 'branch_id' - 'planned_for' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outbound' USING ERRCODE = '22023';
  END IF;
  -- T-100 (review r1 P1-2 c): a campaign enters the queue only through campaign_send (the Q-15 gate); the generic writer refuses it
  IF p ->> 'source_kind' = 'campaign' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: campaign_source' USING ERRCODE = '22023';
  END IF;
  IF v_purpose = 'promo' AND a.role NOT IN ('marketing','central_cs','owner','admin_pusat')
     OR v_purpose <> 'promo' AND a.role NOT IN ('central_cs','fo_cashier','bc','manager','owner','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not send this message' USING ERRCODE = '42501';
  END IF;
  -- PR-56: care messages continue while suspended; promos do not
  IF NOT public.tenant_capability(CASE WHEN v_purpose = 'promo' THEN 'marketing_message' ELSE 'care_message' END) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot send this message now' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_branch := coalesce(NULLIF(p ->> 'branch_id', '')::uuid, a.branch_id);
    v_planned := NULLIF(p ->> 'planned_for', '')::date;
    IF a.branch_id IS NOT NULL AND v_branch IS DISTINCT FROM a.branch_id THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: another branch' USING ERRCODE = '42501';
    END IF;
    v_now := clock_timestamp();
    v_planned := coalesce(v_planned, (v_now AT TIME ZONE coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch), 'Asia/Jakarta'))::date);
    v_id := public.outbound_enqueue_do(a.tenant_id, p_key, v_purpose, (p ->> 'patient_id')::uuid, v_branch, (p ->> 'template_id')::uuid,
                                       p ->> 'source_kind', (p ->> 'source_id')::uuid, v_planned, a.staff_id, a.role, v_now);
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outbound' USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'outbound_message', v_id, 'success', 'outbound_' || v_purpose);
  RETURN v_id;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.outbound_claim(p_now timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  tn record;
  o public.outbound_messages;
  t public.wa_templates;
  v_today date;
  v_budget integer;
  v_seen text[];
  v_out jsonb := '[]'::jsonb;
  v_suspended boolean;
  v_tz text;
  v_cap integer;
  v_defer date;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'outbound_claim runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  FOR tn IN SELECT DISTINCT o2.tenant_id, o2.waba_id FROM public.outbound_messages o2
             JOIN public.tenants_registry tr ON tr.id = o2.tenant_id AND tr.lifecycle_state IN ('onboarding','live','suspended')
            WHERE o2.state = 'queued' ORDER BY o2.tenant_id, o2.waba_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || tn.tenant_id::text, 0));
    v_suspended := (SELECT tr.lifecycle_state = 'suspended' FROM public.tenants_registry tr WHERE tr.id = tn.tenant_id);
    v_budget := coalesce(public.outbound_budget_limit(tn.tenant_id, tn.waba_id, v_now), 0);
    v_seen := public.outbound_recipients_24h(tn.tenant_id, tn.waba_id, v_now);
    FOR o IN SELECT * FROM public.outbound_messages x
              WHERE x.tenant_id = tn.tenant_id AND x.waba_id = tn.waba_id AND x.state = 'queued'
              ORDER BY x.planned_for, (x.category = 'utility') DESC, x.created_at, x.id FOR UPDATE LOOP
      v_today := (v_now AT TIME ZONE coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = o.tenant_id AND b.id = o.branch_id), 'Asia/Jakarta'))::date;
      CONTINUE WHEN o.planned_for > v_today;
      -- PR-4: a promo whose marketing consent is gone is not sent (no port call, no budget)
      IF o.category = 'marketing' AND NOT EXISTS (SELECT 1 FROM public.consents c WHERE c.tenant_id = o.tenant_id AND c.purpose = 'marketing_wa'
           AND c.withdrawn_at IS NULL AND c.patient_id = ANY (public.patient_cluster(o.tenant_id, o.patient_id))) THEN
        UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'consent_withdrawn', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
        VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,
                jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'consent_withdrawn'));
        CONTINUE;
      END IF;
      -- T-100 (review r1 P1-2 d): a campaign message whose Q-15 evidence is no longer approved (revoked, expired) is not sent
      IF o.purpose = 'promo' AND o.source_kind = 'campaign' AND NOT public.campaign_gate_open(o.tenant_id) THEN
        UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'campaign_locked', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
        VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,
                jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'campaign_locked'));
        CONTINUE;
      END IF;
      -- PR-56: a suspended tenant's promos wait; care messages continue
      IF o.category = 'marketing' AND v_suspended THEN
        UPDATE public.outbound_messages SET planned_for = v_today + 1, rescheduled_count = rescheduled_count + 1, deferred_reason = 'tenant_suspended'
         WHERE tenant_id = o.tenant_id AND id = o.id;
        CONTINUE;
      END IF;
      -- a row that will not send is skipped before the budget, so it never holds a recipient's slot (review r1 P3-1)
      SELECT * INTO t FROM public.wa_templates x WHERE x.tenant_id = o.tenant_id AND x.id = o.template_id;
      IF t.status <> 'approved' OR NOT public.outbound_template_ok(o.tenant_id, t.body) THEN
        UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'template_withdrawn', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
        VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,
                jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'template_withdrawn'));
        CONTINUE;
      END IF;
      IF NOT public.inbox_can_send(o.tenant_id, o.waba_id, o.wa_number_id) THEN
        UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'number_not_sending', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
        VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,
                jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'number_not_sending'));
        CONTINUE;
      END IF;
      -- T-100 (plan r3 §5b): the per-patient daily cap at dispatch (every promo): under the patient's cap lock (after staff_access), today's
      -- count without this row = automation_cap_count(today, today) − 1 (sending/sent today plus due/overdue queued rows, care included).
      -- At the cap → deferred to the first day with room in today+1 … today+7 (cap_reached), else skipped cap_horizon_exceeded.
      IF o.category = 'marketing' THEN
        PERFORM public.automation_cap_lock(o.tenant_id, o.patient_id);
        v_tz := coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = o.tenant_id AND b.id = o.branch_id), 'Asia/Jakarta');
        v_cap := (public.followup_setting(o.tenant_id, 'SET-19', v_now) ->> 'batas_harian')::integer;
        IF public.automation_cap_count(o.tenant_id, o.patient_id, v_today, v_today, v_tz) - 1 >= v_cap THEN
          v_defer := public.outbound_cap_defer_day(o.tenant_id, o.patient_id, v_today, v_cap, v_tz);
          IF v_defer IS NULL THEN
            UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'cap_horizon_exceeded', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
            INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
            VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,
                    jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'cap_horizon_exceeded'));
          ELSE
            UPDATE public.outbound_messages SET planned_for = v_defer, rescheduled_count = rescheduled_count + 1, deferred_reason = 'cap_reached'
             WHERE tenant_id = o.tenant_id AND id = o.id;
          END IF;
          CONTINUE;
        END IF;
      END IF;
      -- W-06 / PR-31: a recipient already reached in 24 h costs nothing; a new one beyond the budget waits for the next window
      IF NOT (o.contact_wa_id = ANY (v_seen)) THEN
        IF cardinality(v_seen) >= v_budget THEN
          UPDATE public.outbound_messages SET planned_for = v_today + 1, rescheduled_count = rescheduled_count + 1, deferred_reason = 'budget_reached'
           WHERE tenant_id = o.tenant_id AND id = o.id;
          CONTINUE;
        END IF;
        v_seen := v_seen || o.contact_wa_id;
      END IF;
      UPDATE public.outbound_messages SET state = 'sending', attempt_count = attempt_count + 1, claimed_at = v_now, deferred_reason = NULL
       WHERE tenant_id = o.tenant_id AND id = o.id;
      v_out := v_out || jsonb_build_object(
        'id', o.id, 'tenant_id', o.tenant_id, 'meta_waba_id', (SELECT w.meta_waba_id FROM public.waba_accounts w WHERE w.tenant_id = o.tenant_id AND w.id = o.waba_id),
        'phone_number_id', (SELECT n.phone_number_id FROM public.wa_numbers n WHERE n.tenant_id = o.tenant_id AND n.id = o.wa_number_id),
        'to', o.contact_wa_id, 'template_name', t.name, 'template_language', t.language,
        'params', to_jsonb((public.outbound_params(o))[1:t.param_count]),
        'encrypted_token', (SELECT v.encrypted_token FROM public.token_vault v WHERE v.tenant_id = o.tenant_id AND v.waba_id = o.waba_id AND v.revoked_at IS NULL),
        'keys', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', k.version, 'wrapped', k.wrapped, 'is_current', k.is_current) ORDER BY k.version), '[]'::jsonb)
                   FROM public.tenant_data_keys k WHERE k.tenant_id = o.tenant_id));
    END LOOP;
  END LOOP;
  RETURN v_out;
END
$$;--> statement-breakpoint

-- T-100 readers (plan r3 §3, §7). Bound; the actor lock first. Counts only — never a member's name, id or phone (review r1 P1-1).

-- The campaign workspace (owner, admin_pusat, marketing; the auditor reads): segments with their consented member COUNT, campaigns with
-- segment, template, schedule, send state and the derived queue outcomes (queued / sending / sent / skipped / failed of source
-- ('campaign', id) — delivery is never claimed at enqueue, review r1 P2-2), and the gate: open, and for owner / admin_pusat the missing
-- evidence labels (marketing cannot open Kepatuhan — review r1 P2-3).
CREATE FUNCTION public.campaign_workspace_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  v_open boolean;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role INTO a FROM public.tenant_actor_lock() x;
  IF NOT public.campaign_workspace_readable(a.tenant_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the campaign workspace' USING ERRCODE = '42501';
  END IF;
  v_open := public.campaign_gate_open(a.tenant_id);
  RETURN jsonb_build_object(
    'role', a.role,
    'can_manage', a.role IN ('owner','admin_pusat','marketing'),
    'gate', jsonb_build_object('open', v_open,
      'missing', CASE WHEN v_open OR a.role NOT IN ('owner','admin_pusat') THEN '[]'::jsonb
                      ELSE coalesce((SELECT jsonb_agg(m.label ORDER BY m.label) FROM public.feature_gate_missing('campaign_sending') m), '[]'::jsonb) END),
    'segments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'rules', s.rules,
                   'members', (SELECT count(*) FROM public.campaign_members(s.tenant_id, s.rules, v_today)), 'updated_at', s.updated_at)
                 ORDER BY s.name, s.id)
               FROM public.campaign_segments s WHERE s.tenant_id = a.tenant_id), '[]'::jsonb),
    'campaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code, 'channel', c.channel, 'active', c.active,
                   'segment_id', c.segment_id, 'template_id', c.template_id, 'template_name', t.name, 'scheduled_for', c.scheduled_for,
                   'send_state', c.send_state, 'queued_at', c.queued_at,
                   'outcomes', (SELECT jsonb_build_object(
                       'queued', count(*) FILTER (WHERE o.state = 'queued'), 'sending', count(*) FILTER (WHERE o.state = 'sending'),
                       'sent', count(*) FILTER (WHERE o.state = 'sent'), 'skipped', count(*) FILTER (WHERE o.state = 'skipped'),
                       'failed', count(*) FILTER (WHERE o.state = 'failed'))
                     FROM public.outbound_messages o WHERE o.tenant_id = c.tenant_id AND o.source_kind = 'campaign' AND o.source_id = c.id))
                 ORDER BY c.active DESC, c.name, c.id)
               FROM public.campaigns c LEFT JOIN public.wa_templates t ON t.tenant_id = c.tenant_id AND t.id = c.template_id
              WHERE c.tenant_id = a.tenant_id), '[]'::jsonb),
    'templates', CASE WHEN a.role IN ('owner','admin_pusat','marketing') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name, t.id)
               FROM public.wa_templates t WHERE t.tenant_id = a.tenant_id AND t.category = 'marketing' AND t.status = 'approved'
                 AND public.outbound_template_ok(t.tenant_id, t.body)), '[]'::jsonb) ELSE '[]'::jsonb END,
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name, b.id)
               FROM public.branches b WHERE b.tenant_id = a.tenant_id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_workspace_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_workspace_list() TO clinic_app;--> statement-breakpoint

-- A rule set's consented member COUNT before saving (the segment editor's preview): validated as campaign_segment_save does; a number only.
CREATE FUNCTION public.campaign_segment_preview(p_rules jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role INTO a FROM public.tenant_actor_lock() x;
  IF a.role NOT IN ('owner','admin_pusat','marketing') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not manage campaigns' USING ERRCODE = '42501';
  END IF;
  IF NOT public.campaign_rules_ok(p_rules) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: segment' USING ERRCODE = '22023';
  END IF;
  RETURN (SELECT count(*) FROM public.campaign_members(a.tenant_id, p_rules, (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_segment_preview(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_segment_preview(jsonb) TO clinic_app;
