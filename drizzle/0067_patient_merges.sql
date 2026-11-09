CREATE TABLE "patient_merges" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survivor_id" uuid NOT NULL,
	"merged_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"merged_by" uuid NOT NULL,
	"merged_as" text NOT NULL,
	"merged_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"undone_as" text,
	"undo_reason" text,
	CONSTRAINT "patient_merges_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "patient_merges_pair_check" CHECK ("patient_merges"."survivor_id" <> "patient_merges"."merged_id"),
	CONSTRAINT "patient_merges_reason_check" CHECK (length(btrim("patient_merges"."reason")) between 10 and 500 and "patient_merges"."merged_as" = 'records_officer'),
	CONSTRAINT "patient_merges_undo_check" CHECK (("patient_merges"."undone_at" is null and "patient_merges"."undone_by" is null and "patient_merges"."undone_as" is null and "patient_merges"."undo_reason" is null)
      or ("patient_merges"."undone_at" is not null and "patient_merges"."undone_by" is not null and "patient_merges"."undone_as" = 'records_officer' and length(btrim(coalesce("patient_merges"."undo_reason", ''))) between 10 and 500 and "patient_merges"."undone_at" >= "patient_merges"."merged_at"))
);
--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_survivor_fk" FOREIGN KEY ("tenant_id","survivor_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_merged_fk" FOREIGN KEY ("tenant_id","merged_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_merged_by_fk" FOREIGN KEY ("tenant_id","merged_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_undone_by_fk" FOREIGN KEY ("tenant_id","undone_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_merges_one_active" ON "patient_merges" USING btree ("tenant_id","merged_id") WHERE "patient_merges"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "patient_merges_survivor_idx" ON "patient_merges" USING btree ("tenant_id","survivor_id") WHERE "patient_merges"."undone_at" is null;;--> statement-breakpoint

-- T-042 rules (generated; see header)
-- Merges (PR-85): read by the identity readers; written only by patient_merge / patient_unmerge.
ALTER TABLE public.patient_merges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patient_merges_read ON public.patient_merges FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']));--> statement-breakpoint
GRANT SELECT ON public.patient_merges TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.patient_merges', 'tenant-shared', 'patients', '{owner,admin_pusat,manager,facility_head,records_officer,fo_cashier,central_cs,bc,doctor,nurse,therapist,pharmacist,finance}', 'patient_merge, patient_unmerge (src/modules/patients/merge)', 'none');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.patient_merges', 'personal');--> statement-breakpoint
CREATE POLICY patient_merges_operator_read ON public.patient_merges FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.patient_merges', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.patient_merges TO clinic_operator;--> statement-breakpoint

-- Guard (plan r1 P1-2): the staff-access lock first, so concurrent merges in a tenant serialize; an
-- active merge never chains (the survivor is not merged, the duplicate is not a survivor); identity
-- fixed; undo once; never deleted.
CREATE FUNCTION public.patient_merges_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.patient_merges := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'patient merges are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.undone_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.patient_merges m WHERE m.tenant_id = NEW.tenant_id AND m.undone_at IS NULL
                                               AND (m.merged_id = NEW.survivor_id OR m.survivor_id = NEW.merged_id)) THEN
      RAISE EXCEPTION 'a merge never chains' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.survivor_id, NEW.merged_id, NEW.reason, NEW.merged_by, NEW.merged_as, NEW.merged_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.survivor_id, OLD.merged_id, OLD.reason, OLD.merged_by, OLD.merged_as, OLD.merged_at)
     OR OLD.undone_at IS NOT NULL OR NEW.undone_at IS NULL THEN
    RAISE EXCEPTION 'a merge is undone once and otherwise kept' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_merges_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER patient_merges_guard BEFORE INSERT OR UPDATE OR DELETE ON public.patient_merges FOR EACH ROW EXECUTE FUNCTION public.patient_merges_guard();--> statement-breakpoint
ALTER TABLE public.patient_merges ENABLE ALWAYS TRIGGER patient_merges_guard;--> statement-breakpoint
CREATE TRIGGER patient_merges_no_truncate BEFORE TRUNCATE ON public.patient_merges FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.patient_merges ENABLE ALWAYS TRIGGER patient_merges_no_truncate;--> statement-breakpoint

-- Merge resolution (internal): the survivor of an actively merged id, else the id; whether an id is an
-- active duplicate; a survivor with its active duplicates.
CREATE FUNCTION public.patient_canonical(p_tenant uuid, p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT m.survivor_id FROM public.patient_merges m WHERE m.tenant_id = p_tenant AND m.merged_id = p_id AND m.undone_at IS NULL), p_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_canonical(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.patient_is_merged(p_tenant uuid, p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.patient_merges m WHERE m.tenant_id = p_tenant AND m.merged_id = p_id AND m.undone_at IS NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_is_merged(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.patient_cluster(p_tenant uuid, p_survivor uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ARRAY[p_survivor] || coalesce(ARRAY(SELECT m.merged_id FROM public.patient_merges m WHERE m.tenant_id = p_tenant AND m.survivor_id = p_survivor AND m.undone_at IS NULL ORDER BY m.merged_at, m.id), '{}')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_cluster(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The records officer (19:77) of any branch merges and unmerges tenant-shared patients (DEC-050).
CREATE FUNCTION public.patient_merge_actor() RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role IS DISTINCT FROM 'records_officer' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the records officer merges patients' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('record_correction') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot correct records now' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_merge_actor() FROM PUBLIC;--> statement-breakpoint

-- Gabung Data Ganda (PR-85): the duplicate is redirected to the survivor; no row moves. Audited on both
-- patients with the merge id as correlation; the reason stays on the merge row; an ids-only event.
CREATE FUNCTION public.patient_merge(p_survivor uuid, p_merged uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.patient_merge_actor();
  v_id uuid;
BEGIN
  IF p_survivor IS NULL OR p_merged IS NULL OR p_survivor = p_merged OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: merge' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.patients p WHERE p.tenant_id = a.tenant_id AND p.id IN (p_survivor, p_merged)) <> 2 THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_merges m WHERE m.tenant_id = a.tenant_id AND m.undone_at IS NULL
               AND (m.merged_id IN (p_survivor, p_merged) OR m.survivor_id = p_merged)) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_merged' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.patient_merges (tenant_id, survivor_id, merged_id, reason, merged_by, merged_as)
  VALUES (a.tenant_id, p_survivor, p_merged, btrim(p_reason), a.staff_id, a.role) RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'patient', p_survivor, 'success', 'patient_merged', NULL, v_id);
  PERFORM public.audit_append('settings_change', 'patient', p_merged, 'success', 'patient_merged', NULL, v_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'PatientMerged', 'patient_merge', v_id, jsonb_build_object('merge_id', v_id, 'survivor_id', p_survivor, 'merged_id', p_merged));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_merge(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patient_merge(uuid, uuid, text) TO clinic_app;--> statement-breakpoint

-- Batalkan gabung: the merge row is stamped; both patients are exactly as before with all their rows.
CREATE FUNCTION public.patient_unmerge(p_merge uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.patient_merge_actor();
  m public.patient_merges;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.patient_merges WHERE tenant_id = a.tenant_id AND id = p_merge FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: merge not found' USING ERRCODE = 'P0002';
  END IF;
  IF m.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_undone' USING ERRCODE = '55000';
  END IF;
  UPDATE public.patient_merges SET undone_at = clock_timestamp(), undone_by = a.staff_id, undone_as = a.role, undo_reason = btrim(p_reason)
   WHERE tenant_id = m.tenant_id AND id = m.id;
  PERFORM public.audit_append('settings_change', 'patient', m.survivor_id, 'success', 'patient_unmerged', NULL, m.id);
  PERFORM public.audit_append('settings_change', 'patient', m.merged_id, 'success', 'patient_unmerged', NULL, m.id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'PatientUnmerged', 'patient_merge', m.id, jsonb_build_object('merge_id', m.id, 'survivor_id', m.survivor_id, 'merged_id', m.merged_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_unmerge(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patient_unmerge(uuid, text) TO clinic_app;--> statement-breakpoint

-- Re-created readers and writers (plan r1 P1-1): each its latest definition plus the merge resolution.
CREATE OR REPLACE FUNCTION public.patient_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  r jsonb;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']) THEN
    PERFORM public.audit_append('access_denied', 'patient', p_id, 'denied', 'role_forbidden');
    RETURN NULL;
  END IF;
  v_id := public.patient_canonical(a.tenant_id, p_id); -- T-042: a merged duplicate opens its survivor
  SELECT jsonb_build_object('id', p.id, 'merged_into', CASE WHEN v_id <> p_id THEN v_id END, 'mrn', p.mrn, 'full_name', p.full_name, 'birth_date', p.birth_date, 'sex', p.sex,
                            'identity_type', p.identity_type, 'religion', p.religion, 'occupation', p.occupation, 'education', p.education,
                            'marital_status', p.marital_status, 'address', p.address, 'registered_branch_id', p.registered_branch_id,
                            'created_at', p.created_at,
                            'phone', (SELECT c.value FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.is_primary),
                            'guardians', coalesce((SELECT jsonb_agg(jsonb_build_object('name', g.guardian_name, 'relation', g.relation, 'phone', g.phone) ORDER BY g.created_at)
                                                    FROM public.guardians g WHERE g.tenant_id = p.tenant_id AND g.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id))), '[]'::jsonb))
    INTO r FROM public.patients p WHERE p.tenant_id = a.tenant_id AND p.id = v_id;
  IF r IS NULL THEN
    PERFORM public.audit_append('access_denied', 'patient', p_id, 'denied', 'patient_not_found');
  END IF;
  RETURN r;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.patient_match_rows(p_tenant uuid, p_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'mrn', p.mrn, 'full_name', p.full_name,
                                               'birth_year', extract(year FROM p.birth_date)::int,
                                               'masked_phone', (SELECT left(c.value, 3) || repeat('•', greatest(length(c.value) - 7, 0)) || right(c.value, 4)
                                                                  FROM public.contact_points c
                                                                 WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.is_primary))
                            ORDER BY p.full_name, p.mrn), '[]'::jsonb)
    FROM public.patients p WHERE p.tenant_id = p_tenant AND p.id = ANY (ARRAY(SELECT public.patient_canonical(p_tenant, x) FROM unnest(p_ids) x)) -- T-042
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.consent_grant(p_patient uuid, p_purpose text, p_text uuid, p_channel text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_current uuid;
  v_id uuid := public.uuid_generate_v7();
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['fo_cashier','central_cs','bc','doctor','records_officer','manager']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not record consents' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot record consents now' USING ERRCODE = '42501';
  END IF;
  IF p_purpose IS NULL OR p_purpose NOT IN ('care_notice','clinical_photo','marketing_wa','publication') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: purpose' USING ERRCODE = '22023';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('in_person','paper','whatsapp','phone') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: channel' USING ERRCODE = '22023';
  END IF;
  -- Two grants for one patient already serialize on tenant_actor_lock (the tenant's staff_access
  -- advisory lock), and consents_one_active backs the rule; no row lock is needed here.
  PERFORM 1 FROM public.patients WHERE tenant_id = a.tenant_id AND id = p_patient AND NOT public.patient_is_merged(a.tenant_id, p_patient); -- T-042
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consent_texts WHERE tenant_id = a.tenant_id AND id = p_text AND purpose = p_purpose) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: consent text not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_current FROM public.consent_texts
   WHERE tenant_id = a.tenant_id AND purpose = p_purpose AND effective_from <= clock_timestamp()
   ORDER BY version DESC LIMIT 1;
  IF v_current IS DISTINCT FROM p_text THEN
    RETURN jsonb_build_object('ok', false, 'code', 'consent_text_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.consents WHERE tenant_id = a.tenant_id AND patient_id = ANY (public.patient_cluster(a.tenant_id, p_patient)) AND purpose = p_purpose AND withdrawn_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_granted');
  END IF;
  INSERT INTO public.consents (id, tenant_id, patient_id, purpose, consent_text_id, granted_at, granted_by, granted_as, grant_channel)
  VALUES (v_id, a.tenant_id, p_patient, p_purpose, p_text, clock_timestamp(), a.staff_id, a.role, p_channel);
  PERFORM public.audit_append('settings_change', 'consent', v_id, 'success', 'consent_granted');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'ConsentRecorded', 'consent', v_id, jsonb_build_object('consent_id', v_id, 'patient_id', p_patient,
          'consent_text_id', p_text, 'purpose', p_purpose, 'change', 'granted'));
  RETURN jsonb_build_object('ok', true, 'consent_id', v_id);
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.patient_consents(p_patient uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read consents' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE tenant_id = a.tenant_id AND id = p_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', c.id, 'purpose', c.purpose, 'text_id', c.consent_text_id, 'text_version', t.version,
             'granted_at', c.granted_at, 'granted_by', c.granted_by, 'granted_as', c.granted_as, 'grant_channel', c.grant_channel,
             'withdrawn_at', c.withdrawn_at, 'withdrawn_by', c.withdrawn_by, 'withdrawn_as', c.withdrawn_as,
             'withdraw_channel', c.withdraw_channel, 'withdraw_reason', c.withdraw_reason)
           ORDER BY c.granted_at DESC, c.id DESC)
      FROM public.consents c
      JOIN public.consent_texts t ON t.tenant_id = c.tenant_id AND t.id = c.consent_text_id
     WHERE c.tenant_id = a.tenant_id AND c.patient_id = ANY (public.patient_cluster(a.tenant_id, public.patient_canonical(a.tenant_id, p_patient)))), '[]'::jsonb); -- T-042
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.consent_active(p_patient uuid, p_purpose text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_tenant uuid := public.app_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;
  -- A service context binds a tenant and nothing else; any staff or role setting goes through
  -- approval_actor (plan r2 note: a half-bound context is not a service context).
  IF public.app_staff_id() IS NOT NULL OR NULLIF(current_setting('app.roles', true), '') IS NOT NULL THEN
    SELECT * INTO a FROM public.approval_actor();
    IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance','marketing']) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read consents' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.consents
                  WHERE tenant_id = v_tenant AND patient_id = ANY (public.patient_cluster(v_tenant, public.patient_canonical(v_tenant, p_patient))) AND purpose = p_purpose AND withdrawn_at IS NULL); -- T-042
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.marketing_contacts() RETURNS TABLE (patient_id uuid, full_name text, phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF a.role <> 'marketing' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: marketing contacts are for the marketing role' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, cp.value
      FROM public.patients p
      LEFT JOIN public.contact_points cp ON cp.tenant_id = p.tenant_id AND cp.patient_id = p.id AND cp.kind = 'phone' AND cp.is_primary
     WHERE p.tenant_id = a.tenant_id AND NOT public.patient_is_merged(p.tenant_id, p.id) -- T-042: the survivor, with consents of the cluster
       AND EXISTS (SELECT 1 FROM public.consents c WHERE c.tenant_id = p.tenant_id AND c.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND c.purpose = 'marketing_wa' AND c.withdrawn_at IS NULL)
     ORDER BY p.full_name, p.id;
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
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE tenant_id = a.tenant_id AND id = p_patient) OR public.patient_is_merged(a.tenant_id, p_patient) THEN -- T-042
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
  IF EXISTS (SELECT 1 FROM public.appointments ap WHERE ap.tenant_id = a.tenant_id AND ap.patient_id = ANY (public.patient_cluster(a.tenant_id, p_patient))
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
CREATE OR REPLACE FUNCTION public.appointment_reschedule(p_appointment uuid, p_start timestamptz, p_staff uuid) RETURNS jsonb
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
  IF EXISTS (SELECT 1 FROM public.appointments o WHERE o.tenant_id = ap.tenant_id AND o.patient_id = ANY (public.patient_cluster(ap.tenant_id, public.patient_canonical(ap.tenant_id, ap.patient_id))) AND o.id <> ap.id
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
CREATE OR REPLACE FUNCTION public.appointments_window(p_branch uuid, p_from date, p_to date) RETURNS jsonb
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
               'patient_id', pt.id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn,
               'service_name', v.name, 'version_id', v.id, 'performer_id', ap.performer_staff_id, 'performer_name', s.display_name,
               'rooms', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name)
                                    FROM public.resource_reservations r JOIN public.rooms x ON x.tenant_id = r.tenant_id AND x.id = r.resource_id
                                   WHERE r.tenant_id = ap.tenant_id AND r.appointment_id = ap.id AND r.kind = 'room'), '[]'::jsonb),
               'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.label) ORDER BY x.label)
                                      FROM public.resource_reservations r JOIN public.branch_devices x ON x.tenant_id = r.tenant_id AND x.id = r.resource_id
                                     WHERE r.tenant_id = ap.tenant_id AND r.appointment_id = ap.id AND r.kind = 'device'), '[]'::jsonb))
             ORDER BY ap.starts_at, ap.id)
        FROM public.appointments ap
        JOIN public.patients pt ON pt.tenant_id = ap.tenant_id AND pt.id = public.patient_canonical(ap.tenant_id, ap.patient_id) -- T-042
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
CREATE OR REPLACE FUNCTION public.visits_today(p_branch uuid) RETURNS jsonb
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
               'patient_id', pt.id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn,
               'intake', v.intake, 'doctor', v.doctor, 'selection', v.selection, 'consent', v.consent, 'payment', v.payment,
               'preparation', v.preparation, 'treatment', v.treatment, 'dispensing', v.dispensing, 'blocker', v.blocker, 'closed_at', v.closed_at)
             ORDER BY coalesce(ap.starts_at, v.checked_in_at), v.id)
        FROM public.visits v
        JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id) -- T-042
        LEFT JOIN public.appointments ap ON ap.tenant_id = v.tenant_id AND ap.id = v.appointment_id
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = p_branch
         AND (v.closed_at IS NULL OR (v.closed_at AT TIME ZONE b.timezone)::date = today)), '[]'::jsonb),
    'arrivals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', ap.id, 'state', ap.state, 'starts_at', ap.starts_at, 'check_in_from', ap.starts_at - interval '2 hours',
               'patient_id', pt.id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'service_name', cv.name)
             ORDER BY ap.starts_at, ap.id)
        FROM public.appointments ap
        JOIN public.patients pt ON pt.tenant_id = ap.tenant_id AND pt.id = public.patient_canonical(ap.tenant_id, ap.patient_id) -- T-042
        JOIN public.catalog_versions cv ON cv.tenant_id = ap.tenant_id AND cv.id = ap.catalog_version_id
       WHERE ap.tenant_id = a.tenant_id AND ap.branch_id = p_branch AND ap.state IN ('booked','confirmed')
         AND (ap.starts_at AT TIME ZONE b.timezone)::date = today), '[]'::jsonb));
END
$$;--> statement-breakpoint
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
  IF EXISTS (SELECT 1 FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.branch_id = ap.branch_id AND x.patient_id = ANY (public.patient_cluster(a.tenant_id, public.patient_canonical(a.tenant_id, ap.patient_id))) AND x.closed_at IS NULL) THEN -- T-042
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
CREATE OR REPLACE FUNCTION public.visit_walk_in(p_patient uuid, p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.visit_actor();
  b public.branches := public.queue_branch(a, p_branch);
  v public.visits;
  t public.queue_tickets;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = a.tenant_id AND p.id = p_patient) OR public.patient_is_merged(a.tenant_id, p_patient) THEN -- T-042
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.branch_id = b.id AND x.patient_id = ANY (public.patient_cluster(a.tenant_id, p_patient)) AND x.closed_at IS NULL) THEN
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
CREATE OR REPLACE FUNCTION public.queue_board(p_branch uuid) RETURNS jsonb
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
               'room_id', t.room_id, 'room_name', r.name, 'visit_id', t.visit_id, 'kind', v.kind, 'patient_id', p.id,
               'patient_name', p.full_name, 'patient_mrn', p.mrn, 'created_at', t.created_at) ORDER BY t.seq)
        FROM public.queue_tickets t
        JOIN public.visits v ON v.tenant_id = t.tenant_id AND v.id = t.visit_id
        JOIN public.patients p ON p.tenant_id = v.tenant_id AND p.id = public.patient_canonical(v.tenant_id, v.patient_id) -- T-042
        LEFT JOIN public.rooms r ON r.tenant_id = t.tenant_id AND r.id = t.room_id
       WHERE t.tenant_id = a.tenant_id AND t.branch_id = b.id AND t.queue_date = d), '[]'::jsonb),
    'rooms', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
        FROM public.rooms r WHERE r.tenant_id = a.tenant_id AND r.branch_id = b.id AND r.is_active), '[]'::jsonb),
    'displays', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'label', x.label, 'created_at', x.created_at) ORDER BY x.created_at)
        FROM public.queue_displays x WHERE x.tenant_id = a.tenant_id AND x.branch_id = b.id AND x.revoked_at IS NULL), '[]'::jsonb));
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.queue_patient_search(p_query text) RETURNS jsonb
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
       WHERE p.tenant_id = a.tenant_id AND NOT public.patient_is_merged(p.tenant_id, p.id) -- T-042: survivors only, matched over the cluster
         AND (p.full_name ILIKE '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
              OR EXISTS (SELECT 1 FROM public.patients m WHERE m.tenant_id = p.tenant_id AND m.id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND m.mrn = upper(q))
              OR length(digits) >= 6 AND EXISTS (SELECT 1 FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id))
                                                     AND c.kind = 'phone' AND right(regexp_replace(c.value, '[^0-9]', '', 'g'), length(digits)) = digits))
       ORDER BY p.full_name, p.id LIMIT 20) s), '[]'::jsonb);
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.patient_search(p_query text, p_filters jsonb, p_after uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_now timestamptz;
  q text := btrim(coalesce(p_query, ''));
  raw_digits text := regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g');
  norm_digits text;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_branch uuid;
  v_last text;
  v_visiting boolean;
  v_after_name text;
  v_rows jsonb;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not search patients' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(f) <> 'object' OR f - 'branch_id' - 'last_visit' - 'visiting_now' <> '{}'::jsonb
     OR (f ? 'last_visit' AND coalesce(f ->> 'last_visit', '') NOT IN ('30d','90d','never'))
     OR (f ? 'visiting_now' AND jsonb_typeof(f -> 'visiting_now') <> 'boolean')
     OR (f ? 'branch_id' AND coalesce(f ->> 'branch_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR length(q) > 80 OR (length(q) = 1) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: search' USING ERRCODE = '22023';
  END IF;
  v_branch := (f ->> 'branch_id')::uuid;
  v_last := f ->> 'last_visit';
  v_visiting := coalesce((f ->> 'visiting_now')::boolean, false);
  v_now := clock_timestamp();
  INSERT INTO public.patient_search_log (tenant_id, staff_id, role, branch_id, searched_at) VALUES (a.tenant_id, a.staff_id, a.role, a.branch_id, v_now);
  IF (SELECT count(*) FROM public.patient_search_log l WHERE l.tenant_id = a.tenant_id AND l.staff_id = a.staff_id AND l.searched_at > v_now - interval '1 hour') > 200
     AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.tenant_id = a.tenant_id AND n.type = 'patient_search_abuse' AND n.subject_kind = 'staff'
                       AND n.subject_id = a.staff_id AND n.created_at > v_now - interval '1 hour') THEN
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, created_at)
    VALUES (a.tenant_id, 'patient_search_abuse', 'facility_head', a.branch_id, 'staff', a.staff_id, v_now);
  END IF;
  IF (SELECT count(*) FROM public.patient_search_log l WHERE l.tenant_id = a.tenant_id AND l.staff_id = a.staff_id AND l.searched_at > v_now - interval '1 minute') > 30 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_RATE_LIMITED');
  END IF;
  IF p_after IS NOT NULL THEN
    SELECT full_name INTO v_after_name FROM public.patients WHERE tenant_id = a.tenant_id AND id = p_after;
    IF v_after_name IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: after' USING ERRCODE = '22023';
    END IF;
  END IF;
  norm_digits := regexp_replace(raw_digits, '^0', '62');
  SELECT coalesce(jsonb_agg(r ORDER BY r ->> 'full_name', r ->> 'id'), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('id', p.id, 'mrn', p.mrn, 'full_name', p.full_name, 'birth_year', extract(year from p.birth_date)::int,
             'masked_phone', (SELECT left(c.value, 3) || repeat('•', greatest(length(c.value) - 7, 0)) || right(c.value, 4)
                                FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.is_primary),
             'registered_branch_id', p.registered_branch_id, 'registered_branch', rb.name,
             'open_visit_branch', (SELECT b.name FROM public.visits v JOIN public.branches b ON b.tenant_id = v.tenant_id AND b.id = v.branch_id
                                    WHERE v.tenant_id = p.tenant_id AND v.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND v.closed_at IS NULL AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id)
                                    ORDER BY v.checked_in_at DESC, v.id DESC LIMIT 1),
             'last_visit_at', (SELECT max(v.checked_in_at) FROM public.visits v
                                WHERE v.tenant_id = p.tenant_id AND v.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id))) AS r
      FROM public.patients p
      JOIN public.branches rb ON rb.tenant_id = p.tenant_id AND rb.id = p.registered_branch_id
     WHERE p.tenant_id = a.tenant_id AND NOT public.patient_is_merged(p.tenant_id, p.id) -- T-042: survivors only, matched over the cluster
       AND (q = '' OR p.full_name ILIKE '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR EXISTS (SELECT 1 FROM public.patients m WHERE m.tenant_id = p.tenant_id AND m.id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND m.mrn = upper(q))
            OR length(raw_digits) >= 6 AND EXISTS (SELECT 1 FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND c.kind = 'phone'
                                                       AND (substr(c.value, 2) = norm_digits OR right(substr(c.value, 2), length(raw_digits)) = raw_digits)))
       AND (v_branch IS NULL OR p.registered_branch_id = v_branch)
       AND (NOT v_visiting OR EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = p.tenant_id AND v.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND v.closed_at IS NULL
                                        AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id)))
       AND (v_last IS NULL
            OR v_last = 'never' AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = p.tenant_id AND v.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id))
            OR v_last IN ('30d','90d') AND EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = p.tenant_id AND v.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id))
                                                     AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id)
                                                     AND v.checked_in_at >= v_now - CASE v_last WHEN '30d' THEN interval '30 days' ELSE interval '90 days' END))
       AND (p_after IS NULL OR (p.full_name, p.id) > (v_after_name, p_after))
     ORDER BY p.full_name, p.id LIMIT 51) s;
  RETURN jsonb_build_object('ok', true, 'rows', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_rows) x LIMIT 50) y),
                            'more', jsonb_array_length(v_rows) > 50);
END
$$;--> statement-breakpoint
