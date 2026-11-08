CREATE TABLE "consent_texts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "consent_texts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "consent_texts_tenant_id_id_purpose_key" UNIQUE("tenant_id","id","purpose"),
	CONSTRAINT "consent_texts_version_key" UNIQUE("tenant_id","purpose","version"),
	CONSTRAINT "consent_texts_purpose_check" CHECK ("consent_texts"."purpose" in ('care_notice','procedure','clinical_photo','marketing_wa','publication')),
	CONSTRAINT "consent_texts_version_check" CHECK ("consent_texts"."version" >= 1),
	CONSTRAINT "consent_texts_body_check" CHECK (length(btrim("consent_texts"."body")) between 1 and 8000),
	CONSTRAINT "consent_texts_created_as_check" CHECK ("consent_texts"."created_as" in ('owner','admin_pusat')),
	CONSTRAINT "consent_texts_effective_check" CHECK ("consent_texts"."effective_from" >= "consent_texts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"consent_text_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_as" text NOT NULL,
	"grant_channel" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdrawn_as" text,
	"withdraw_channel" text,
	"withdraw_reason" text,
	CONSTRAINT "consents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "consents_purpose_check" CHECK ("consents"."purpose" in ('care_notice','clinical_photo','marketing_wa','publication')),
	CONSTRAINT "consents_channel_check" CHECK ("consents"."grant_channel" in ('in_person','paper','whatsapp','phone') and ("consents"."withdraw_channel" is null or "consents"."withdraw_channel" in ('in_person','paper','whatsapp','phone'))),
	CONSTRAINT "consents_role_check" CHECK ("consents"."granted_as" in ('fo_cashier','central_cs','bc','doctor','records_officer','manager') and ("consents"."withdrawn_as" is null or "consents"."withdrawn_as" in ('fo_cashier','central_cs','bc','doctor','records_officer','manager'))),
	CONSTRAINT "consents_withdrawal_check" CHECK (("consents"."withdrawn_at" is null and "consents"."withdrawn_by" is null and "consents"."withdrawn_as" is null and "consents"."withdraw_channel" is null and "consents"."withdraw_reason" is null)
      or ("consents"."withdrawn_at" is not null and "consents"."withdrawn_by" is not null and "consents"."withdrawn_as" is not null and "consents"."withdraw_channel" is not null
          and "consents"."withdraw_reason" is not null and length(btrim("consents"."withdraw_reason")) between 3 and 500 and "consents"."withdrawn_at" >= "consents"."granted_at"))
);
--> statement-breakpoint
ALTER TABLE "consent_texts" ADD CONSTRAINT "consent_texts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_texts" ADD CONSTRAINT "consent_texts_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_patient_id_patients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_text_purpose_fk" FOREIGN KEY ("tenant_id","consent_text_id","purpose") REFERENCES "public"."consent_texts"("tenant_id","id","purpose") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_granted_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","granted_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_withdrawn_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","withdrawn_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consents_one_active" ON "consents" USING btree ("tenant_id","patient_id","purpose") WHERE "consents"."withdrawn_at" is null;;--> statement-breakpoint

-- T-038 rules (generated; see header)
-- T-038 (PR-4, DATA-14, DATA-66, PRIV-1, SET-45, TEN-18; plan docs/tasks/T-038.md, DEC-052): the
-- consent ledger. Texts are insert-only versions; a consent row records one grant and, once, its
-- withdrawal. Care notice is the facility's legal basis (PRIV-1) and cannot be withdrawn; procedure
-- consent is UX-39's (T-054), so the ledger refuses it.

-- ── Readers ─────────────────────────────────────────────────────────────────────────────────
-- Texts are what patients are shown: every member reads them. The ledger is personal data: the 13
-- non-marketing identity roles (as patients, DEC-050); marketing only through marketing_contacts().
ALTER TABLE public.consent_texts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY consent_texts_read ON public.consent_texts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.consent_texts TO clinic_app;--> statement-breakpoint
ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY consents_read ON public.consents FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']));--> statement-breakpoint
GRANT SELECT ON public.consents TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.consent_texts', 'tenant-shared', 'patients', '{*}', 'consent_text_publish (src/modules/patients/consents)', 'none'),
  ('public.consents', 'tenant-shared', 'patients', '{owner,admin_pusat,manager,facility_head,records_officer,fo_cashier,central_cs,bc,doctor,nurse,therapist,pharmacist,finance}', 'consent_grant, consent_withdraw (src/modules/patients/consents)', 'none');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): consents are specific personal data; texts are configuration.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.consent_texts', 'config'), ('public.consents', 'personal');--> statement-breakpoint
CREATE POLICY consent_texts_operator_read ON public.consent_texts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.consent_texts', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.consent_texts TO clinic_operator;--> statement-breakpoint
CREATE POLICY consents_operator_read ON public.consents FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.consents', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.consents TO clinic_operator;--> statement-breakpoint

-- ── Guards (plan r1 P2-2) ───────────────────────────────────────────────────────────────────
CREATE FUNCTION public.consent_texts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'a consent text is never changed or deleted; publish a new version' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
CREATE TRIGGER consent_texts_guard BEFORE UPDATE OR DELETE ON public.consent_texts FOR EACH ROW EXECUTE FUNCTION public.consent_texts_guard();--> statement-breakpoint
ALTER TABLE public.consent_texts ENABLE ALWAYS TRIGGER consent_texts_guard;--> statement-breakpoint
CREATE TRIGGER consent_texts_no_truncate BEFORE TRUNCATE ON public.consent_texts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.consent_texts ENABLE ALWAYS TRIGGER consent_texts_no_truncate;--> statement-breakpoint

CREATE FUNCTION public.consents_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consents are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.withdrawn_at IS NOT NULL OR NEW.withdrawn_by IS NOT NULL OR NEW.withdrawn_as IS NOT NULL
       OR NEW.withdraw_channel IS NOT NULL OR NEW.withdraw_reason IS NOT NULL THEN
      RAISE EXCEPTION 'a consent is recorded granted; withdrawal is a later change' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.purpose, NEW.consent_text_id, NEW.granted_at, NEW.granted_by, NEW.granted_as, NEW.grant_channel)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.purpose, OLD.consent_text_id, OLD.granted_at, OLD.granted_by, OLD.granted_as, OLD.grant_channel) THEN
    RAISE EXCEPTION 'a consent grant is never changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'a withdrawal is recorded once' USING ERRCODE = '42501';
  END IF;
  IF OLD.purpose = 'care_notice' THEN
    RAISE EXCEPTION 'the care notice is the facility''s legal basis and is not withdrawn' USING ERRCODE = '42501';
  END IF;
  IF NEW.withdrawn_at IS NULL THEN
    RAISE EXCEPTION 'the only change to a consent is its withdrawal' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER consents_guard BEFORE INSERT OR UPDATE OR DELETE ON public.consents FOR EACH ROW EXECUTE FUNCTION public.consents_guard();--> statement-breakpoint
ALTER TABLE public.consents ENABLE ALWAYS TRIGGER consents_guard;--> statement-breakpoint
CREATE TRIGGER consents_no_truncate BEFORE TRUNCATE ON public.consents FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.consents ENABLE ALWAYS TRIGGER consents_no_truncate;--> statement-breakpoint

-- ── consent_text_publish (SET-45, IAM-13) ───────────────────────────────────────────────────
-- The Owner, or Admin Pusat holding an active data-protection duty (read on the wall clock after
-- tenant_actor_lock, which serializes with staff_duty_set's lock). Never backdated.
CREATE FUNCTION public.consent_text_publish(p_purpose text, p_body text, p_effective_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_now timestamptz;
  v_effective timestamptz;
  v_version integer;
  v_id uuid := public.uuid_generate_v7();
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT (a.role = 'owner' OR a.role = 'admin_pusat' AND EXISTS (
           SELECT 1 FROM public.staff_duties d
            WHERE d.tenant_id = a.tenant_id AND d.staff_id = a.staff_id AND d.duty = 'data_protection' AND d.ended_at IS NULL)) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not publish consent texts' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.tenant_capability('configuration') OR public.tenant_capability('existing_appointment')) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change consent texts now' USING ERRCODE = '42501';
  END IF;
  IF p_purpose IS NULL OR p_purpose NOT IN ('care_notice','procedure','clinical_photo','marketing_wa','publication') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: purpose' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: body' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  IF p_effective_from IS NOT NULL AND (p_effective_from < v_now - interval '1 minute' OR p_effective_from > v_now + interval '366 days') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: effective_from' USING ERRCODE = '22023';
  END IF;
  v_effective := greatest(coalesce(p_effective_from, v_now), v_now);
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.consent_texts WHERE tenant_id = a.tenant_id AND purpose = p_purpose;
  INSERT INTO public.consent_texts (id, tenant_id, purpose, version, body, effective_from, created_by, created_as, created_at)
  VALUES (v_id, a.tenant_id, p_purpose, v_version, btrim(p_body), v_effective, a.staff_id, a.role, v_now);
  PERFORM public.audit_append('settings_change', 'consent_text', v_id, 'success', 'consent_text_published');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'ConsentTextPublished', 'consent_text', v_id, jsonb_build_object('consent_text_id', v_id, 'purpose', p_purpose));
  RETURN jsonb_build_object('ok', true, 'consent_text_id', v_id, 'version', v_version);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_text_publish(text, text, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consent_text_publish(text, text, timestamptz) TO clinic_app;--> statement-breakpoint

-- ── consent_grant (PR-4) ────────────────────────────────────────────────────────────────────
-- The recorder roles; the patient and the text must be the caller's, the text of that purpose and the
-- one in force now (what was shown is what is recorded). Domain refusals are returned (and replayed by
-- runCommand); forbidden, not found, invalid and suspended raise.
CREATE FUNCTION public.consent_grant(p_patient uuid, p_purpose text, p_text uuid, p_channel text) RETURNS jsonb
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
  PERFORM 1 FROM public.patients WHERE tenant_id = a.tenant_id AND id = p_patient;
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
  IF EXISTS (SELECT 1 FROM public.consents WHERE tenant_id = a.tenant_id AND patient_id = p_patient AND purpose = p_purpose AND withdrawn_at IS NULL) THEN
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
REVOKE ALL ON FUNCTION public.consent_grant(uuid, text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consent_grant(uuid, text, uuid, text) TO clinic_app;--> statement-breakpoint

-- ── consent_withdraw (PR-4, PRIV-1) ─────────────────────────────────────────────────────────
-- Never blocked by the tenant lifecycle: withdrawal must always be possible.
CREATE FUNCTION public.consent_withdraw(p_consent uuid, p_channel text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  r public.consents;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['fo_cashier','central_cs','bc','doctor','records_officer','manager']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not record consents' USING ERRCODE = '42501';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('in_person','paper','whatsapp','phone') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: channel' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.consents WHERE tenant_id = a.tenant_id AND id = p_consent FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: consent not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.purpose = 'care_notice' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_withdrawable');
  END IF;
  IF r.withdrawn_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_withdrawn');
  END IF;
  UPDATE public.consents SET withdrawn_at = clock_timestamp(), withdrawn_by = a.staff_id, withdrawn_as = a.role,
         withdraw_channel = p_channel, withdraw_reason = btrim(p_reason)
   WHERE tenant_id = a.tenant_id AND id = p_consent;
  PERFORM public.audit_append('settings_change', 'consent', p_consent, 'success', 'consent_withdrawn');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'ConsentRecorded', 'consent', p_consent, jsonb_build_object('consent_id', p_consent, 'patient_id', r.patient_id,
          'consent_text_id', r.consent_text_id, 'purpose', r.purpose, 'change', 'withdrawn'));
  RETURN jsonb_build_object('ok', true, 'consent_id', p_consent);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_withdraw(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consent_withdraw(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- ── Readers (plan r1 P1-3) ──────────────────────────────────────────────────────────────────
-- One patient's ledger for an identity reader (T-040 shows it), with each row's text version.
CREATE FUNCTION public.patient_consents(p_patient uuid) RETURNS jsonb
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
     WHERE c.tenant_id = a.tenant_id AND c.patient_id = p_patient), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_consents(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patient_consents(uuid) TO clinic_app;--> statement-breakpoint

-- Whether a patient's consent for a purpose is active now: a staff reader (identity roles or marketing)
-- or a tenant-bound service context (the outbox worker; the same trust as domain_events_read, 0020).
-- False for an unknown or foreign patient and an unknown purpose; never null.
CREATE FUNCTION public.consent_active(p_patient uuid, p_purpose text) RETURNS boolean
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
                  WHERE tenant_id = v_tenant AND patient_id = p_patient AND purpose = p_purpose AND withdrawn_at IS NULL);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_active(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consent_active(uuid, text) TO clinic_app;--> statement-breakpoint

-- Marketing's only view of patients (TEN-18; DEC-052 records the definer function in place of a
-- security-barrier view): id, name and primary phone of patients with an active marketing consent.
CREATE FUNCTION public.marketing_contacts() RETURNS TABLE (patient_id uuid, full_name text, phone text)
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
      JOIN public.consents c ON c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.purpose = 'marketing_wa' AND c.withdrawn_at IS NULL
      LEFT JOIN public.contact_points cp ON cp.tenant_id = p.tenant_id AND cp.patient_id = p.id AND cp.kind = 'phone' AND cp.is_primary
     WHERE p.tenant_id = a.tenant_id
     ORDER BY p.full_name, p.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.marketing_contacts() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.marketing_contacts() TO clinic_app;
