CREATE TABLE "record_copy_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"record_count" integer NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "record_copy_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "record_copy_requests_check" CHECK ("record_copy_requests"."record_count" >= 0 and "record_copy_requests"."requested_as" in ('fo_cashier','records_officer','facility_head')
      and length(btrim("record_copy_requests"."reason")) between 3 and 300)
);
--> statement-breakpoint
CREATE TABLE "record_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"delta" jsonb NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"approval_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"decided_at" timestamp with time zone,
	"version_id" uuid,
	CONSTRAINT "record_corrections_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "record_corrections_approval_key" UNIQUE("tenant_id","approval_id"),
	CONSTRAINT "record_corrections_check" CHECK ("record_corrections"."state" in ('pending','approved','rejected','cancelled') and "record_corrections"."requested_as" = 'doctor'
      and jsonb_typeof("record_corrections"."delta") = 'object' and "record_corrections"."delta" <> '{}'::jsonb and length(btrim("record_corrections"."reason")) between 3 and 500
      and (("record_corrections"."state" = 'pending') = ("record_corrections"."decided_at" is null)) and (("record_corrections"."state" = 'approved') = ("record_corrections"."version_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "record_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"delta" jsonb,
	"reason" text,
	"approval_id" uuid,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "record_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "record_versions_version_key" UNIQUE("tenant_id","examination_id","version"),
	CONSTRAINT "record_versions_approval_key" UNIQUE("tenant_id","approval_id"),
	CONSTRAINT "record_versions_kind_check" CHECK ("record_versions"."kind" in ('original','correction') and "record_versions"."created_as" = 'doctor'
      and jsonb_typeof("record_versions"."content") = 'object' and "record_versions"."content_hash" ~ '^[0-9a-f]{64}$'
      and (("record_versions"."kind" = 'original') = ("record_versions"."version" = 1 and "record_versions"."delta" is null and "record_versions"."reason" is null and "record_versions"."approval_id" is null))
      and (("record_versions"."kind" = 'correction') = ("record_versions"."version" > 1 and "record_versions"."delta" is not null and jsonb_typeof("record_versions"."delta") = 'object' and "record_versions"."delta" <> '{}'::jsonb
           and length(btrim(coalesce("record_versions"."reason", ''))) between 3 and 500)))
);
--> statement-breakpoint
ALTER TABLE "examinations" DROP CONSTRAINT "examinations_state_check";--> statement-breakpoint
ALTER TABLE "examinations" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "examinations" ADD COLUMN "signed_by" uuid;--> statement-breakpoint
ALTER TABLE "examinations" ADD COLUMN "signed_as" text;--> statement-breakpoint
ALTER TABLE "examinations" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "record_copy_requests" ADD CONSTRAINT "record_copy_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_copy_requests" ADD CONSTRAINT "record_copy_requests_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_copy_requests" ADD CONSTRAINT "record_copy_requests_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_copy_requests" ADD CONSTRAINT "record_copy_requests_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_corrections" ADD CONSTRAINT "record_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_corrections" ADD CONSTRAINT "record_corrections_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_corrections" ADD CONSTRAINT "record_corrections_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_corrections" ADD CONSTRAINT "record_corrections_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_corrections" ADD CONSTRAINT "record_corrections_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."record_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_copy_requests_patient_idx" ON "record_copy_requests" USING btree ("tenant_id","patient_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "record_corrections_one_pending" ON "record_corrections" USING btree ("tenant_id","examination_id") WHERE state = 'pending';--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_signed_by_fk" FOREIGN KEY ("tenant_id","signed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_state_check" CHECK ("examinations"."state" in ('draft','signed')
      and num_nonnulls("examinations"."signed_at", "examinations"."signed_by", "examinations"."signed_as", "examinations"."content_hash") = (case when "examinations"."state" = 'signed' then 4 else 0 end)
      and ("examinations"."signed_by" is null or "examinations"."signed_by" = "examinations"."author_id") and ("examinations"."signed_as" is null or "examinations"."signed_as" = 'doctor')
      and ("examinations"."content_hash" is null or "examinations"."content_hash" ~ '^[0-9a-f]{64}$'));;--> statement-breakpoint

-- T-053 rules (generated by gen.py; plan docs/tasks/T-053.md)
-- Signing, immutability, corrections, patient copy, retention (PR-13, CLIN-014, CLIN-023, PR-49, PR-3; plan
-- Argon r1 c8f56422 adopted, r2 38d45d43 APPROVE). A signed examination never changes; its content lives in
-- record_versions (v1 = the signed snapshot). Corrections: within 48 h of signing the author writes v n+1 at
-- once; later only through the approval record_late_correction (records officer or facility head).

-- The copy-request read helper (invoker, wall clock): FO, records officer, facility head at an allowed branch
-- held by the acting role now. Never null.
CREATE FUNCTION public.copy_request_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id() AND public.app_role_in(ARRAY['fo_cashier','records_officer','facility_head']) AND public.app_branch_allowed(p_branch)
    AND EXISTS (
      SELECT 1 FROM public.staff s
        JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch
       WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
         AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.copy_request_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.copy_request_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- The approval for a late correction (PR-13): the author doctor requests; a records officer or facility head
-- of the branch decides (never the requester: approval_decide refuses that).
INSERT INTO public.approval_types (key, label, requester_roles, approver_roles, owner_self) VALUES
  ('record_late_correction', 'Koreksi rekam medis', '{doctor}', '{records_officer,facility_head}', false);--> statement-breakpoint

-- The canonical content of an examination: what a version holds (SOAP, template, vitals, ICD-10; the marks and
-- the intake verifications as frozen at signing). Keys fixed; jsonb orders them, so the text is canonical.
CREATE FUNCTION public.record_content(e public.examinations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'subjective', e.subjective, 'objective', e.objective, 'assessment', e.assessment, 'plan_note', e.plan_note,
    'template_key', e.template_key, 'template_values', e.template_values, 'vitals', e.vitals, 'icd10_codes', to_jsonb(e.icd10_codes),
    'marks', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m.id, 'template', m.template, 'layer', m.layer, 'x', m.x, 'y', m.y,
               'label', m.label, 'catalog_version_id', m.catalog_version_id, 'dose_micro', m.dose_micro, 'dose_unit', m.dose_unit)) ORDER BY m.created_at, m.id)
               FROM public.face_map_marks m WHERE m.tenant_id = e.tenant_id AND m.examination_id = e.id), '[]'::jsonb),
    'verifications', coalesce((SELECT jsonb_agg(jsonb_build_object('fact_id', w.fact_id, 'decision', w.decision, 'corrected_value', w.corrected_value,
               'version', w.version, 'verified_at', w.verified_at) ORDER BY w.fact_id)
               FROM public.intake_verifications w WHERE w.tenant_id = e.tenant_id AND w.examination_id = e.id), '[]'::jsonb))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_content(public.examinations) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.record_hash(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_hash(jsonb) FROM PUBLIC;--> statement-breakpoint

-- The SOAP fields of a payload, validated like exam_save (one rule set): returns the next content (the keys
-- given replace the current ones; absent keys stay). Raises ERR_INVALID_INPUT.
CREATE FUNCTION public.record_apply(p_current jsonb, p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tpl text;
  v_vals jsonb;
  v_codes text[];
  v_next jsonb := p_current;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'subjective' - 'objective' - 'assessment' - 'plan_note' - 'template_key' - 'template_values' - 'vitals' - 'icd10_codes' <> '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_each(p) x WHERE x.key IN ('subjective','objective','assessment','plan_note','template_key')
                  AND (jsonb_typeof(x.value) NOT IN ('string','null') OR length(coalesce(x.value #>> '{}', '')) > 4000)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: correction' USING ERRCODE = '22023';
  END IF;
  v_tpl := CASE WHEN p ? 'template_key' THEN NULLIF(p ->> 'template_key', '') ELSE p_current ->> 'template_key' END;
  v_vals := CASE WHEN p ? 'template_values' THEN coalesce(NULLIF(p -> 'template_values', 'null'::jsonb), '{}'::jsonb) ELSE p_current -> 'template_values' END;
  IF jsonb_typeof(v_vals) <> 'object'
     OR v_tpl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.exam_template_fields f WHERE f.template = v_tpl)
     OR v_tpl IS NULL AND v_vals <> '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_each(v_vals) x WHERE jsonb_typeof(x.value) <> 'string' OR NOT EXISTS (
                  SELECT 1 FROM public.exam_template_fields f WHERE f.template = v_tpl AND f.field = x.key AND (x.value #>> '{}') ~ f.pattern)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: template' USING ERRCODE = '22023';
  END IF;
  IF p ? 'vitals' AND (jsonb_typeof(p -> 'vitals') <> 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(p -> 'vitals') x WHERE jsonb_typeof(x.value) <> 'number' OR (x.value #>> '{}') !~ '^[0-9]{1,4}$' OR NOT EXISTS (
         SELECT 1 FROM public.exam_vital_ranges r WHERE r.field = x.key AND (x.value #>> '{}')::integer BETWEEN r.lo AND r.hi))) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: vitals' USING ERRCODE = '22023';
  END IF;
  IF p ? 'icd10_codes' THEN
    IF jsonb_typeof(p -> 'icd10_codes') <> 'array' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p -> 'icd10_codes') c WHERE jsonb_typeof(c) <> 'string' OR (c #>> '{}') !~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: icd10' USING ERRCODE = '22023';
    END IF;
    v_codes := ARRAY(SELECT DISTINCT c FROM jsonb_array_elements_text(p -> 'icd10_codes') c ORDER BY c);
    IF cardinality(v_codes) > 10 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: icd10' USING ERRCODE = '22023';
    END IF;
    v_next := v_next || jsonb_build_object('icd10_codes', to_jsonb(v_codes));
  END IF;
  FOR v_tpl IN SELECT unnest(ARRAY['subjective','objective','assessment','plan_note']) LOOP
    IF p ? v_tpl THEN
      v_next := v_next || jsonb_build_object(v_tpl, NULLIF(btrim(coalesce(p ->> v_tpl, '')), ''));
    END IF;
  END LOOP;
  v_next := v_next || jsonb_build_object('template_key', CASE WHEN p ? 'template_key' THEN NULLIF(p ->> 'template_key', '') ELSE p_current ->> 'template_key' END,
                                         'template_values', v_vals);
  IF p ? 'vitals' THEN
    v_next := v_next || jsonb_build_object('vitals', p -> 'vitals');
  END IF;
  RETURN v_next;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_apply(jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint

-- The net delta between two contents (CLIN-023): only the keys whose value changed.
CREATE FUNCTION public.record_delta(p_from jsonb, p_to jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) FROM jsonb_each(p_to) n WHERE (p_from -> n.key) IS DISTINCT FROM n.value
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_delta(jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint

-- The current (latest) version of a signed examination.
CREATE FUNCTION public.record_current(p_tenant uuid, p_exam uuid) RETURNS public.record_versions
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT * FROM public.record_versions WHERE tenant_id = p_tenant AND examination_id = p_exam ORDER BY version DESC LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_current(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.record_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY record_versions_read ON public.record_versions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.record_versions TO clinic_app;--> statement-breakpoint
CREATE POLICY record_versions_operator_read ON public.record_versions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.record_versions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.record_versions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER record_versions_no_truncate BEFORE TRUNCATE ON public.record_versions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.record_versions ENABLE ALWAYS TRIGGER record_versions_no_truncate;--> statement-breakpoint
ALTER TABLE public.record_corrections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY record_corrections_read ON public.record_corrections FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.record_corrections TO clinic_app;--> statement-breakpoint
CREATE POLICY record_corrections_operator_read ON public.record_corrections FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.record_corrections', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.record_corrections TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER record_corrections_no_truncate BEFORE TRUNCATE ON public.record_corrections FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.record_corrections ENABLE ALWAYS TRIGGER record_corrections_no_truncate;--> statement-breakpoint
ALTER TABLE public.record_copy_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY record_copy_requests_read ON public.record_copy_requests FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.copy_request_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.record_copy_requests TO clinic_app;--> statement-breakpoint
CREATE POLICY record_copy_requests_operator_read ON public.record_copy_requests FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.record_copy_requests', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.record_copy_requests TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER record_copy_requests_no_truncate BEFORE TRUNCATE ON public.record_copy_requests FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.record_copy_requests ENABLE ALWAYS TRIGGER record_copy_requests_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.record_versions', 'clinical', 'clinical', '{doctor,facility_head,records_officer}', 'record_sign, record_correct, record_correction_sync (src/modules/clinical/records)', 'the examination''s branch'),
  ('public.record_corrections', 'clinical', 'clinical', '{doctor,facility_head,records_officer}', 'record_correct, record_correction_sync (src/modules/clinical/records)', 'the examination''s branch'),
  ('public.record_copy_requests', 'clinical', 'clinical', '{fo_cashier,records_officer,facility_head}', 'record_copy_request (src/modules/clinical/records)', 'the requesting branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): clinical class.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.record_versions', 'clinical'), ('public.record_corrections', 'clinical'), ('public.record_copy_requests', 'clinical');--> statement-breakpoint

-- ── Guards ───────────────────────────────────────────────────────────────────────────────────────
-- examinations_guard (0070) re-created: a draft changes freely (identity kept); draft → signed changes only
-- the state, the four signing columns and updated_at; a signed examination is final.
CREATE OR REPLACE FUNCTION public.examinations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_tenant::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'examinations are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'an examination opens as a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'draft' THEN
    RAISE EXCEPTION 'a signed examination is final' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.patient_id, NEW.author_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.patient_id, OLD.author_id, OLD.created_at) THEN
    RAISE EXCEPTION 'an examination keeps its visit, patient and author' USING ERRCODE = '42501';
  END IF;
  IF NEW.state <> 'draft' AND to_jsonb(NEW) - 'state' - 'signed_at' - 'signed_by' - 'signed_as' - 'content_hash' - 'updated_at'
                             IS DISTINCT FROM to_jsonb(OLD) - 'state' - 'signed_at' - 'signed_by' - 'signed_as' - 'content_hash' - 'updated_at' THEN
    RAISE EXCEPTION 'signing changes only the state and the signature' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Versions and copy requests are insert-only. A correction is never deleted and changes once: pending to one
-- terminal state (decided_at set; version_id only when approved), nothing else.
CREATE FUNCTION public.records_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || (coalesce(n, o) ->> 'tenant_id'), 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical records are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'record_corrections' AND n ->> 'state' <> 'pending' THEN
      RAISE EXCEPTION 'a correction opens pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME <> 'record_corrections' THEN
    RAISE EXCEPTION 'a record version or copy request never changes' USING ERRCODE = '42501';
  END IF;
  IF o ->> 'state' <> 'pending' OR n ->> 'state' = 'pending'
     OR n - 'state' - 'decided_at' - 'version_id' IS DISTINCT FROM o - 'state' - 'decided_at' - 'version_id' THEN
    RAISE EXCEPTION 'a correction is decided once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.records_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER record_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.record_versions FOR EACH ROW EXECUTE FUNCTION public.records_guard();--> statement-breakpoint
ALTER TABLE public.record_versions ENABLE ALWAYS TRIGGER record_versions_guard;--> statement-breakpoint
CREATE TRIGGER record_corrections_guard BEFORE INSERT OR UPDATE OR DELETE ON public.record_corrections FOR EACH ROW EXECUTE FUNCTION public.records_guard();--> statement-breakpoint
ALTER TABLE public.record_corrections ENABLE ALWAYS TRIGGER record_corrections_guard;--> statement-breakpoint
CREATE TRIGGER record_copy_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON public.record_copy_requests FOR EACH ROW EXECUTE FUNCTION public.records_guard();--> statement-breakpoint
ALTER TABLE public.record_copy_requests ENABLE ALWAYS TRIGGER record_copy_requests_guard;--> statement-breakpoint

-- ── Signing (PR-13, PR-3) ─────────────────────────────────────────────────────────────────────────
-- record_sign: the author doctor (acting as Dokter: exam_actor refuses any other acting role) with an enrolled
-- second factor signs a draft, after the visit closed too. Version 1 is the signed snapshot. The TS layer
-- verifies a TOTP code first (step-up); the database cannot, so it requires the factor to be enrolled.
CREATE FUNCTION public.record_sign(p_exam uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.exam_actor();
  e public.examinations;
  v_content jsonb;
  v_hash text;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.auth_user u ON u.id = m.account_id AND u.two_factor_enabled
                  WHERE s.tenant_id = a.tenant_id AND s.id = a.staff_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: second_factor_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = a.tenant_id AND x.id = p_exam FOR UPDATE;
  IF NOT FOUND OR e.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(e.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: examination not found' USING ERRCODE = 'P0002';
  END IF;
  IF e.author_id <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the doctor who examined signs' USING ERRCODE = '42501';
  END IF;
  IF e.state = 'signed' THEN
    RETURN (public.record_current(e.tenant_id, e.id)).id;
  END IF;
  v_content := public.record_content(e);
  v_hash := public.record_hash(v_content);
  UPDATE public.examinations SET state = 'signed', signed_at = clock_timestamp(), signed_by = a.staff_id, signed_as = a.role, content_hash = v_hash
   WHERE tenant_id = e.tenant_id AND id = e.id;
  INSERT INTO public.record_versions (tenant_id, branch_id, examination_id, version, kind, content, content_hash, created_by, created_as)
  VALUES (e.tenant_id, e.branch_id, e.id, 1, 'original', v_content, v_hash, a.staff_id, a.role)
  RETURNING id INTO v_id;
  UPDATE public.visits SET doctor = 'done' WHERE tenant_id = e.tenant_id AND id = e.visit_id AND closed_at IS NULL AND doctor <> 'done';
  PERFORM public.audit_append('sign', 'examination', e.id, 'success', 'record_signed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (e.branch_id, 'ExaminationSigned', 'examination', e.id,
          jsonb_build_object('examination_id', e.id, 'visit_id', e.visit_id, 'version_id', v_id, 'branch_id', e.branch_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_sign(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_sign(uuid) TO clinic_app;--> statement-breakpoint

-- Writes version n+1 of a signed examination from a correction (shared by the direct path and the approval).
CREATE FUNCTION public.record_write_version(e public.examinations, p_delta jsonb, p_reason text, p_by uuid, p_as text, p_approval uuid) RETURNS public.record_versions
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  cur public.record_versions;
  v_next jsonb;
  v_delta jsonb;
  r public.record_versions;
BEGIN
  SELECT * INTO cur FROM public.record_versions WHERE tenant_id = e.tenant_id AND examination_id = e.id ORDER BY version DESC LIMIT 1 FOR UPDATE;
  v_next := public.record_apply(cur.content, p_delta);
  v_delta := public.record_delta(cur.content, v_next);
  IF v_delta = '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: no_change' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.record_versions (tenant_id, branch_id, examination_id, version, kind, content, content_hash, delta, reason, approval_id, created_by, created_as)
  VALUES (e.tenant_id, e.branch_id, e.id, cur.version + 1, 'correction', v_next, public.record_hash(v_next), v_delta, btrim(p_reason), p_approval, p_by, p_as)
  RETURNING * INTO r;
  RETURN r;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_write_version(public.examinations, jsonb, text, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- ── Corrections (PR-13, CLIN-023) ─────────────────────────────────────────────────────────────────
-- record_correct: the author of a signed examination. Within 48 h of signing: version n+1 at once (net delta).
-- Later: a pending correction and an approval record_late_correction (one pending per examination); the
-- version is written when the approval is approved. Returns {kind: 'version'|'pending', id}.
CREATE FUNCTION public.record_correct(p_exam uuid, p_delta jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  e public.examinations;
  cur public.record_versions;
  v public.record_versions;
  v_delta jsonb;
  v_corr uuid;
  v_approval uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'doctor' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only a doctor corrects a record' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('record_correction') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot correct records now' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = a.tenant_id AND x.id = p_exam FOR UPDATE;
  IF NOT FOUND OR e.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(e.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: examination not found' USING ERRCODE = 'P0002';
  END IF;
  IF e.author_id <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the doctor who signed corrects' USING ERRCODE = '42501';
  END IF;
  IF e.state <> 'signed' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_signed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.record_corrections c WHERE c.tenant_id = e.tenant_id AND c.examination_id = e.id AND c.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: correction_pending' USING ERRCODE = '55000';
  END IF;
  IF clock_timestamp() <= e.signed_at + interval '48 hours' THEN
    v := public.record_write_version(e, p_delta, p_reason, a.staff_id, a.role, NULL);
    PERFORM public.audit_append('sign', 'examination', e.id, 'success', 'record_corrected');
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (e.branch_id, 'RecordCorrected', 'examination', e.id, jsonb_build_object('examination_id', e.id, 'version_id', v.id, 'change', 'direct'));
    RETURN jsonb_build_object('kind', 'version', 'id', v.id);
  END IF;
  -- Late: the delta is validated and stored as the net delta now; the version is computed again at approval.
  cur := public.record_current(e.tenant_id, e.id);
  v_delta := public.record_delta(cur.content, public.record_apply(cur.content, p_delta));
  IF v_delta = '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: no_change' USING ERRCODE = '22023';
  END IF;
  v_corr := public.uuid_generate_v7();
  v_approval := public.approval_request('record_late_correction', 'record_correction', v_corr, btrim(p_reason), e.branch_id, NULL);
  INSERT INTO public.record_corrections (id, tenant_id, branch_id, examination_id, delta, reason, approval_id, requested_by, requested_as)
  VALUES (v_corr, e.tenant_id, e.branch_id, e.id, v_delta, btrim(p_reason), v_approval, a.staff_id, a.role);
  PERFORM public.audit_append('sign', 'examination', e.id, 'success', 'record_correction_requested');
  RETURN jsonb_build_object('kind', 'pending', 'id', v_corr, 'approval_id', v_approval);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_correct(uuid, jsonb, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_correct(uuid, jsonb, text) TO clinic_app;--> statement-breakpoint

-- Applies a decided late correction (AFTER UPDATE OF state ON approvals). Approved: version n+1 authored by the
-- requesting doctor, the approval named. Rejected or cancelled: the correction closes; the record is unchanged.
-- One pending correction per examination and no direct correction after 48 h, so the delta still changes the
-- record at approval; if it did not, record_write_version raises and the decision fails (fails closed).
CREATE FUNCTION public.record_correction_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.record_corrections;
  e public.examinations;
  v public.record_versions;
  v_state text := NEW.state;
BEGIN
  IF NEW.type <> 'record_late_correction' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM public.record_corrections WHERE tenant_id = NEW.tenant_id AND approval_id = NEW.id AND state = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NEW.state = 'approved' THEN
    SELECT * INTO e FROM public.examinations WHERE tenant_id = c.tenant_id AND id = c.examination_id FOR UPDATE;
    v := public.record_write_version(e, c.delta, c.reason, c.requested_by, c.requested_as, NEW.id);
  ELSIF NEW.state NOT IN ('rejected','cancelled') THEN
    RETURN NULL;
  END IF;
  UPDATE public.record_corrections SET state = v_state, decided_at = clock_timestamp(), version_id = CASE WHEN v_state = 'approved' THEN v.id END
   WHERE tenant_id = c.tenant_id AND id = c.id;
  IF public.app_staff_id() IS NOT NULL THEN
    PERFORM public.audit_append('sign', 'examination', c.examination_id, 'success',
            CASE v_state WHEN 'approved' THEN 'record_corrected' WHEN 'rejected' THEN 'record_correction_rejected' ELSE 'record_correction_cancelled' END);
  END IF;
  IF v_state = 'approved' THEN
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (c.tenant_id, c.branch_id, 'RecordCorrected', 'examination', c.examination_id,
            jsonb_build_object('examination_id', c.examination_id, 'version_id', v.id, 'approval_id', NEW.id, 'change', 'approved'));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_correction_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_record_correction_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.record_correction_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_record_correction_sync;--> statement-breakpoint

-- exam_sheet (0070) re-created (plan r1 P1-1): a signed examination, and the earlier ones, show the latest
-- version's content with the signature and version; a draft reads the row as before.
CREATE OR REPLACE FUNCTION public.exam_sheet(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v public.visits;
  pt public.patients;
  i public.intakes;
  e public.examinations;
  rv public.record_versions;
  c jsonb;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR NOT a.role IN ('doctor','facility_head','records_officer') OR v.branch_id IS DISTINCT FROM a.branch_id
     OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pt FROM public.patients WHERE tenant_id = v.tenant_id AND id = public.patient_canonical(v.tenant_id, v.patient_id);
  SELECT * INTO i FROM public.intakes WHERE tenant_id = v.tenant_id AND visit_id = v.id;
  SELECT * INTO e FROM public.examinations WHERE tenant_id = v.tenant_id AND visit_id = v.id;
  -- T-053: a signed examination shows its latest version (the row itself never changes after signing).
  rv := public.record_current(v.tenant_id, e.id);
  c := CASE WHEN e.state = 'signed' THEN rv.content ELSE to_jsonb(e) END;
  PERFORM public.audit_append('clinical_read', 'examination', coalesce(e.id, v.id), 'success', 'exam_viewed');
  RETURN jsonb_build_object(
    'visit', jsonb_build_object('id', v.id, 'branch_id', v.branch_id, 'checked_in_at', v.checked_in_at, 'closed', v.closed_at IS NOT NULL,
              'intake', v.intake, 'doctor', v.doctor),
    'patient', jsonb_build_object('id', pt.id, 'name', pt.full_name, 'mrn', pt.mrn, 'birth_date', pt.birth_date, 'sex', pt.sex),
    'cautions', public.exam_cautions(v.tenant_id, pt.id),
    'intake', CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', i.id, 'state', i.state, 'complaint', i.complaint, 'sent_at', i.sent_at, 'author_id', i.author_id,
              'author_name', (SELECT display_name FROM public.staff s WHERE s.tenant_id = i.tenant_id AND s.id = i.author_id),
              'observation', (SELECT jsonb_build_object('chips', to_jsonb(o.chips), 'note', o.note) FROM public.skin_observations o WHERE o.tenant_id = i.tenant_id AND o.intake_id = i.id),
              'facts', coalesce((
                SELECT jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'value', f.value, 'provenance', f.provenance, 'prior', f.intake_id <> i.id,
                         'verification', (SELECT jsonb_build_object('decision', w.decision, 'corrected_value', w.corrected_value, 'version', w.version,
                                                   'verified_at', w.verified_at, 'provenance', w.provenance)
                                            FROM public.intake_verifications w WHERE w.tenant_id = f.tenant_id AND w.examination_id = e.id AND w.fact_id = f.id))
                         ORDER BY f.intake_id <> i.id, f.kind, f.id)
                  FROM public.intake_facts f
                 WHERE f.tenant_id = i.tenant_id AND i.state = 'sent' AND (f.intake_id = i.id OR f.id = ANY (i.reviewed_prior))), '[]'::jsonb)) END,
    'examination', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', e.id, 'state', e.state, 'author_id', e.author_id,
              'author_name', (SELECT display_name FROM public.staff s WHERE s.tenant_id = e.tenant_id AND s.id = e.author_id),
              'subjective', c -> 'subjective', 'objective', c -> 'objective',
              'assessment', c -> 'assessment', 'plan_note', c -> 'plan_note',
              'template_key', c -> 'template_key', 'template_values', c -> 'template_values',
              'vitals', c -> 'vitals', 'icd10_codes', c -> 'icd10_codes',
              'updated_at', e.updated_at, 'signed_at', e.signed_at, 'signed_as', e.signed_as, 'version', rv.version, 'content_hash', rv.content_hash,
              'marks', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m.id, 'template', m.template, 'layer', m.layer, 'x', m.x, 'y', m.y,
                                   'label', m.label, 'catalog_version_id', m.catalog_version_id, 'dose_micro', m.dose_micro, 'dose_unit', m.dose_unit)) ORDER BY m.created_at, m.id)
                                   FROM public.face_map_marks m WHERE m.tenant_id = e.tenant_id AND m.examination_id = e.id), '[]'::jsonb)) END,
    'earlier', coalesce((
      SELECT jsonb_agg(jsonb_build_object('visit_id', x.id, 'checked_in_at', x.checked_in_at, 'branch_name', x.branch_name, 'complaint', x.complaint,
               'assessment', x.assessment, 'icd10_codes', to_jsonb(x.icd10_codes), 'author_name', x.author_name) ORDER BY x.checked_in_at DESC)
        FROM (SELECT pv.id, pv.checked_in_at, br.name AS branch_name, pi.complaint,
                     CASE WHEN pe.state = 'signed' THEN (public.record_current(pe.tenant_id, pe.id)).content ->> 'assessment' ELSE pe.assessment END AS assessment,
                     CASE WHEN pe.state = 'signed' THEN ARRAY(SELECT jsonb_array_elements_text((public.record_current(pe.tenant_id, pe.id)).content -> 'icd10_codes'))
                          ELSE pe.icd10_codes END AS icd10_codes,
                     pa.display_name AS author_name
                FROM public.visits pv
                JOIN public.branches br ON br.tenant_id = pv.tenant_id AND br.id = pv.branch_id
                LEFT JOIN public.intakes pi ON pi.tenant_id = pv.tenant_id AND pi.visit_id = pv.id AND pi.state = 'sent'
                LEFT JOIN public.examinations pe ON pe.tenant_id = pv.tenant_id AND pe.visit_id = pv.id
                LEFT JOIN public.staff pa ON pa.tenant_id = pe.tenant_id AND pa.id = pe.author_id
               WHERE pv.tenant_id = v.tenant_id AND pv.id <> v.id AND pv.checked_in_at < v.checked_in_at
                 AND pv.patient_id = ANY (public.patient_cluster(v.tenant_id, pt.id))
                 AND (pi.id IS NOT NULL OR pe.id IS NOT NULL)
               ORDER BY pv.checked_in_at DESC LIMIT 5) x), '[]'::jsonb),
    'plans', public.exam_plans_json(v.tenant_id, pt.id, v.branch_id, true));
END
$$;--> statement-breakpoint

-- ── Readers ──────────────────────────────────────────────────────────────────────────────────────
-- record_get (plan r1 P1-1): a signed examination's metadata, current content, every version in order (the
-- prior versions stay readable, PR-13) and every correction. Clinical readers (doctor, facility head, records
-- officer) at an allowed branch; audited clinical read. Not found otherwise (a draft too).
CREATE FUNCTION public.record_get(p_exam uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  e public.examinations;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = a.tenant_id AND x.id = p_exam;
  IF NOT FOUND OR e.state <> 'signed' OR NOT a.role IN ('doctor','facility_head','records_officer')
     OR e.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(e.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: record not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: clinical reads are not available' USING ERRCODE = '42501';
  END IF;
  PERFORM public.audit_append('clinical_read', 'examination', e.id, 'success', 'record_viewed');
  RETURN jsonb_build_object(
    'id', e.id, 'visit_id', e.visit_id, 'patient_id', e.patient_id, 'author_id', e.author_id,
    'signed_at', e.signed_at, 'signed_by', e.signed_by, 'signed_as', e.signed_as, 'content_hash', e.content_hash,
    'current', (public.record_current(e.tenant_id, e.id)).content,
    'versions', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r.id, 'version', r.version, 'kind', r.kind, 'content', r.content,
                   'content_hash', r.content_hash, 'delta', r.delta, 'reason', r.reason, 'approval_id', r.approval_id,
                   'created_by', r.created_by, 'created_as', r.created_as, 'created_at', r.created_at)) ORDER BY r.version)
                   FROM public.record_versions r WHERE r.tenant_id = e.tenant_id AND r.examination_id = e.id),
    'corrections', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.id, 'state', c.state, 'delta', c.delta, 'reason', c.reason,
                   'approval_id', c.approval_id, 'requested_by', c.requested_by, 'requested_at', c.requested_at, 'decided_at', c.decided_at,
                   'version_id', c.version_id)) ORDER BY c.requested_at, c.id)
                   FROM public.record_corrections c WHERE c.tenant_id = e.tenant_id AND c.examination_id = e.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_get(uuid) TO clinic_app;--> statement-breakpoint

-- The signed examinations of a patient's merge cluster, oldest first: what a patient copy holds.
CREATE FUNCTION public.record_copy_rows(p_tenant uuid, p_canon uuid) RETURNS SETOF public.examinations
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT e.* FROM public.examinations e
   WHERE e.tenant_id = p_tenant AND e.state = 'signed' AND e.patient_id = ANY (public.patient_cluster(p_tenant, p_canon))
   ORDER BY e.signed_at, e.id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_copy_rows(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The copy actor: FO, records officer or facility head at their active branch; capability patient_copy.
CREATE FUNCTION public.record_copy_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('fo_cashier','records_officer','facility_head') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not request a record copy' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('patient_copy') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: record copies are not available' USING ERRCODE = '42501';
  END IF;
  IF branch_id IS NULL OR NOT public.app_branch_allowed(branch_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an active branch is needed' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_copy_actor() FROM PUBLIC;--> statement-breakpoint

-- PR-49: a copy of record content for the patient. Logs the request (content-free) and returns its id and the
-- number of signed records; the content is read with record_copy_data. The patient must have a visit at the
-- actor's branch (as patient_cautions); not found otherwise.
CREATE FUNCTION public.record_copy_request(p_patient uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.record_copy_actor();
  v_canon uuid;
  v_count integer;
  v_id uuid;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  v_canon := public.patient_canonical(a.tenant_id, p_patient);
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE tenant_id = a.tenant_id AND id = v_canon)
     OR NOT EXISTS (SELECT 1 FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.branch_id = a.branch_id
                     AND x.patient_id = ANY (public.patient_cluster(a.tenant_id, v_canon))) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT count(*) INTO v_count FROM public.record_copy_rows(a.tenant_id, v_canon);
  INSERT INTO public.record_copy_requests (tenant_id, branch_id, patient_id, record_count, reason, requested_by, requested_as)
  VALUES (a.tenant_id, a.branch_id, v_canon, v_count, btrim(p_reason), a.staff_id, a.role)
  RETURNING id INTO v_id;
  PERFORM public.audit_append('export', 'record_copy_request', v_id, 'success', 'record_copy_produced');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'RecordCopyRequested', 'record_copy_request', v_id, jsonb_build_object('request_id', v_id, 'patient_id', v_canon));
  RETURN jsonb_build_object('request_id', v_id, 'record_count', v_count);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_copy_request(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_copy_request(uuid, text) TO clinic_app;--> statement-breakpoint

-- The content of a logged copy request, for rendering the PDF: the requester (same staff) at the same branch.
-- The patient header and, per signed record, the visit date, branch, author and the current version's content.
CREATE FUNCTION public.record_copy_data(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.record_copy_actor();
  q public.record_copy_requests;
  pt public.patients;
BEGIN
  SELECT * INTO q FROM public.record_copy_requests x WHERE x.tenant_id = a.tenant_id AND x.id = p_request;
  IF NOT FOUND OR q.requested_by <> a.staff_id OR q.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: copy request not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pt FROM public.patients WHERE tenant_id = q.tenant_id AND id = q.patient_id;
  RETURN jsonb_build_object(
    'request_id', q.id, 'requested_at', q.requested_at,
    'patient', jsonb_build_object('name', pt.full_name, 'mrn', pt.mrn, 'birth_date', pt.birth_date),
    'clinic', (SELECT legal_name FROM public.tenants WHERE id = q.tenant_id),
    'records', coalesce((SELECT jsonb_agg(jsonb_build_object(
                 'checked_in_at', v.checked_in_at, 'branch_name', b.name,
                 'author_name', (SELECT display_name FROM public.staff s WHERE s.tenant_id = e.tenant_id AND s.id = e.author_id),
                 'signed_at', e.signed_at, 'version', (public.record_current(e.tenant_id, e.id)).version,
                 'content', (public.record_current(e.tenant_id, e.id)).content - 'marks' - 'verifications') ORDER BY e.signed_at, e.id)
               FROM public.record_copy_rows(q.tenant_id, q.patient_id) e
               JOIN public.visits v ON v.tenant_id = e.tenant_id AND v.id = e.visit_id
               JOIN public.branches b ON b.tenant_id = v.tenant_id AND b.id = v.branch_id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_copy_data(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_copy_data(uuid) TO clinic_app;--> statement-breakpoint

-- Retention (05:218, PRIV-3): clinical records are kept at least 25 years from the patient's last visit
-- (across the merge cluster). For the future disposal process; clinical readers and records officers.
CREATE FUNCTION public.retention_until(p_patient uuid) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_canon uuid;
  v_last date;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role IN ('records_officer','facility_head') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read retention' USING ERRCODE = '42501';
  END IF;
  v_canon := public.patient_canonical(a.tenant_id, p_patient);
  -- The last visit's local date at its branch (each branch has its own timezone).
  SELECT max((x.checked_in_at AT TIME ZONE b.timezone)::date) INTO v_last FROM public.visits x
    JOIN public.branches b ON b.tenant_id = x.tenant_id AND b.id = x.branch_id
   WHERE x.tenant_id = a.tenant_id AND x.patient_id = ANY (public.patient_cluster(a.tenant_id, v_canon));
  IF v_last IS NULL OR NOT EXISTS (SELECT 1 FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.branch_id = a.branch_id
                                     AND x.patient_id = ANY (public.patient_cluster(a.tenant_id, v_canon))) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN (v_last + interval '25 years')::date;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.retention_until(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.retention_until(uuid) TO clinic_app;
