CREATE TABLE "care_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"title" text NOT NULL,
	"condition" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_exam_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"closed_exam_id" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "care_plans_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "care_plans_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "care_plans_text_check" CHECK (length(btrim("care_plans"."title")) between 3 and 160 and length(btrim("care_plans"."condition")) between 3 and 200),
	CONSTRAINT "care_plans_state_check" CHECK ("care_plans"."state" in ('active','completed','stopped') and (("care_plans"."state" = 'active') = ("care_plans"."closed_at" is null)) and (("care_plans"."closed_at" is null) = ("care_plans"."closed_exam_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "examinations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"subjective" text,
	"objective" text,
	"assessment" text,
	"plan_note" text,
	"template_key" text,
	"template_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vitals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icd10_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "examinations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "examinations_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "examinations_tenant_visit_key" UNIQUE("tenant_id","visit_id"),
	CONSTRAINT "examinations_state_check" CHECK ("examinations"."state" in ('draft')),
	CONSTRAINT "examinations_text_check" CHECK (("examinations"."subjective" is null or length("examinations"."subjective") <= 4000) and ("examinations"."objective" is null or length("examinations"."objective") <= 4000)
      and ("examinations"."assessment" is null or length("examinations"."assessment") <= 4000) and ("examinations"."plan_note" is null or length("examinations"."plan_note") <= 4000)
      and ("examinations"."template_key" is null or "examinations"."template_key" ~ '^[a-z][a-z_]{1,40}$') and jsonb_typeof("examinations"."template_values") = 'object' and jsonb_typeof("examinations"."vitals") = 'object'),
	CONSTRAINT "examinations_icd10_check" CHECK (cardinality("examinations"."icd10_codes") <= 10 and array_to_string("examinations"."icd10_codes", ',') ~ '^([A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?(,|$))*$')
);
--> statement-breakpoint
CREATE TABLE "face_map_marks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"template" text NOT NULL,
	"layer" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"label" text NOT NULL,
	"catalog_version_id" uuid,
	"dose_micro" bigint,
	"dose_unit" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "face_map_marks_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "face_map_marks_point_check" CHECK ("face_map_marks"."template" in ('face_front','face_left','face_right','body') and "face_map_marks"."layer" in ('keluhan','pemeriksaan','tindakan')
      and "face_map_marks"."x" between 0 and 1000 and "face_map_marks"."y" between 0 and 1000 and length(btrim("face_map_marks"."label")) between 1 and 120),
	CONSTRAINT "face_map_marks_dose_check" CHECK ((("face_map_marks"."layer" = 'tindakan') = ("face_map_marks"."dose_micro" is not null and "face_map_marks"."dose_unit" is not null))
      and ("face_map_marks"."dose_micro" is null or "face_map_marks"."dose_micro" between 1 and 1000000000) and ("face_map_marks"."dose_unit" is null or "face_map_marks"."dose_unit" in ('unit','ml','mg','cm2'))
      and ("face_map_marks"."layer" = 'tindakan' or "face_map_marks"."catalog_version_id" is null))
);
--> statement-breakpoint
CREATE TABLE "intake_verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"corrected_value" text,
	"provenance" text DEFAULT 'clinician_verified' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"verified_by" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "intake_verifications_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "intake_verifications_once_key" UNIQUE("tenant_id","examination_id","fact_id"),
	CONSTRAINT "intake_verifications_decision_check" CHECK ("intake_verifications"."decision" in ('confirmed','corrected') and "intake_verifications"."provenance" = 'clinician_verified' and "intake_verifications"."version" >= 1
      and (("intake_verifications"."decision" = 'corrected') = ("intake_verifications"."corrected_value" is not null)) and ("intake_verifications"."corrected_value" is null or length(btrim("intake_verifications"."corrected_value")) between 1 and 500))
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"stage" integer NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"dose_micro" bigint,
	"dose_unit" text,
	"note" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "plan_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "plan_items_check" CHECK ("plan_items"."stage" between 1 and 20 and "plan_items"."qty" between 1 and 1000
      and (("plan_items"."dose_micro" is null) = ("plan_items"."dose_unit" is null)) and ("plan_items"."dose_micro" is null or "plan_items"."dose_micro" between 1 and 1000000000)
      and ("plan_items"."dose_unit" is null or "plan_items"."dose_unit" in ('unit','ml','mg','cm2')) and ("plan_items"."note" is null or length(btrim("plan_items"."note")) between 1 and 500))
);
--> statement-breakpoint
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_created_exam_fk" FOREIGN KEY ("tenant_id","branch_id","created_exam_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_closed_exam_fk" FOREIGN KEY ("tenant_id","closed_exam_id") REFERENCES "public"."examinations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_map_marks" ADD CONSTRAINT "face_map_marks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_map_marks" ADD CONSTRAINT "face_map_marks_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_map_marks" ADD CONSTRAINT "face_map_marks_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_verifications" ADD CONSTRAINT "intake_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_verifications" ADD CONSTRAINT "intake_verifications_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_verifications" ADD CONSTRAINT "intake_verifications_fact_fk" FOREIGN KEY ("tenant_id","fact_id") REFERENCES "public"."intake_facts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_verifications" ADD CONSTRAINT "intake_verifications_by_fk" FOREIGN KEY ("tenant_id","verified_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_fk" FOREIGN KEY ("tenant_id","branch_id","plan_id") REFERENCES "public"."care_plans"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_exam_fk" FOREIGN KEY ("tenant_id","examination_id") REFERENCES "public"."examinations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_plans_patient_idx" ON "care_plans" USING btree ("tenant_id","patient_id","state");--> statement-breakpoint
CREATE INDEX "examinations_patient_idx" ON "examinations" USING btree ("tenant_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "face_map_marks_exam_idx" ON "face_map_marks" USING btree ("tenant_id","examination_id");--> statement-breakpoint
CREATE INDEX "intake_verifications_fact_idx" ON "intake_verifications" USING btree ("tenant_id","fact_id");--> statement-breakpoint
CREATE INDEX "plan_items_plan_idx" ON "plan_items" USING btree ("tenant_id","plan_id");;--> statement-breakpoint

-- T-052 rules (generated by gen.py; plan docs/tasks/T-052.md)
-- Lembar Pemeriksaan (PR-10, CLIN-004, CLIN-012; plan Argon r1 92ad9b18 adopted, r2 235c1610 APPROVE).
-- The doctor's draft examination of a visit (signing in T-053), verification of BC facts, face-map marks
-- and care plans. Clinical rows: doctor, facility head, records officer (exam_readable); BC, FO, nurse and
-- therapist see only the plan projection plan_options (items and live prices).

-- Allowed SOAP templates with their structured values (doctor-graded scales; 19:87) and vital-sign ranges.
-- Platform reference rows, read only by the definer writers.
CREATE TABLE public.exam_template_fields (template text NOT NULL, field text NOT NULL, pattern text NOT NULL, PRIMARY KEY (template, field));--> statement-breakpoint
INSERT INTO public.exam_template_fields (template, field, pattern) VALUES
  ('kulit_umum', 'fitzpatrick', '^(I|II|III|IV|V|VI)$'), ('kulit_umum', 'kelembapan', '^[1-5]$'),
  ('kulit_umum', 'sebum', '^[1-5]$'), ('kulit_umum', 'sensitivitas', '^[1-5]$'),
  ('jerawat', 'fitzpatrick', '^(I|II|III|IV|V|VI)$'), ('jerawat', 'lesi_inflamasi', '^[0-9]{1,3}$'),
  ('jerawat', 'lesi_noninflamasi', '^[0-9]{1,3}$'), ('jerawat', 'derajat', '^(ringan|sedang|berat)$'),
  ('pigmentasi', 'fitzpatrick', '^(I|II|III|IV|V|VI)$'), ('pigmentasi', 'area', '^(dahi|pipi|hidung|dagu|leher|seluruh_wajah)$'),
  ('pigmentasi', 'intensitas', '^[1-5]$'),
  ('penuaan', 'fitzpatrick', '^(I|II|III|IV|V|VI)$'), ('penuaan', 'kerutan', '^[1-5]$'), ('penuaan', 'elastisitas', '^[1-5]$');--> statement-breakpoint
CREATE TABLE public.exam_vital_ranges (field text PRIMARY KEY, lo integer NOT NULL, hi integer NOT NULL);--> statement-breakpoint
INSERT INTO public.exam_vital_ranges (field, lo, hi) VALUES
  ('td_sistolik', 50, 260), ('td_diastolik', 30, 160), ('nadi', 30, 220), ('suhu_c10', 340, 420), ('berat_kg', 1, 400);--> statement-breakpoint
REVOKE ALL ON public.exam_template_fields, public.exam_vital_ranges FROM PUBLIC;--> statement-breakpoint
-- RLS on with no policy: no app role reads them; the definer writers (table owner) do.
ALTER TABLE public.exam_template_fields ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.exam_vital_ranges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.exam_template_fields', 'platform', 'clinical', '{}', 'migrations', 'none'),
  ('public.exam_vital_ranges', 'platform', 'clinical', '{}', 'migrations', 'none');--> statement-breakpoint

-- Read helper (invoker, plan P1-4): doctor, facility head, records officer at a branch allowed in the session
-- and held by the acting role on the wall clock. Never null.
CREATE FUNCTION public.exam_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id() AND public.app_role_in(ARRAY['doctor','facility_head','records_officer']) AND public.app_branch_allowed(p_branch)
    AND EXISTS (
      SELECT 1 FROM public.staff s
        JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch
       WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
         AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.exam_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

ALTER TABLE public.examinations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY examinations_read ON public.examinations FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.examinations TO clinic_app;--> statement-breakpoint
CREATE POLICY examinations_operator_read ON public.examinations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.examinations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.examinations TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER examinations_no_truncate BEFORE TRUNCATE ON public.examinations FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.examinations ENABLE ALWAYS TRIGGER examinations_no_truncate;--> statement-breakpoint
ALTER TABLE public.intake_verifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY intake_verifications_read ON public.intake_verifications FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.intake_verifications TO clinic_app;--> statement-breakpoint
CREATE POLICY intake_verifications_operator_read ON public.intake_verifications FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.intake_verifications', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.intake_verifications TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER intake_verifications_no_truncate BEFORE TRUNCATE ON public.intake_verifications FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.intake_verifications ENABLE ALWAYS TRIGGER intake_verifications_no_truncate;--> statement-breakpoint
ALTER TABLE public.face_map_marks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY face_map_marks_read ON public.face_map_marks FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.face_map_marks TO clinic_app;--> statement-breakpoint
CREATE POLICY face_map_marks_operator_read ON public.face_map_marks FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.face_map_marks', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.face_map_marks TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER face_map_marks_no_truncate BEFORE TRUNCATE ON public.face_map_marks FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.face_map_marks ENABLE ALWAYS TRIGGER face_map_marks_no_truncate;--> statement-breakpoint
ALTER TABLE public.care_plans ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY care_plans_read ON public.care_plans FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.care_plans TO clinic_app;--> statement-breakpoint
CREATE POLICY care_plans_operator_read ON public.care_plans FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.care_plans', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.care_plans TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER care_plans_no_truncate BEFORE TRUNCATE ON public.care_plans FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.care_plans ENABLE ALWAYS TRIGGER care_plans_no_truncate;--> statement-breakpoint
ALTER TABLE public.plan_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY plan_items_read ON public.plan_items FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.plan_items TO clinic_app;--> statement-breakpoint
CREATE POLICY plan_items_operator_read ON public.plan_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.plan_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.plan_items TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER plan_items_no_truncate BEFORE TRUNCATE ON public.plan_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.plan_items ENABLE ALWAYS TRIGGER plan_items_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.examinations', 'clinical', 'clinical', '{doctor,facility_head,records_officer}', 'exam_open, exam_save (src/modules/clinical/exam)', 'the visit''s branch'),
  ('public.intake_verifications', 'clinical', 'clinical', '{doctor,facility_head,records_officer}', 'intake_verify (src/modules/clinical/exam)', 'the visit''s branch'),
  ('public.face_map_marks', 'clinical', 'clinical', '{doctor,facility_head,records_officer}', 'mark_set, mark_remove (src/modules/clinical/exam)', 'the visit''s branch'),
  ('public.care_plans', 'clinical', 'clinical', '{doctor,facility_head,records_officer}', 'plan_create, plan_close (src/modules/clinical/exam)', 'the branch of the plan''s creating examination'),
  ('public.plan_items', 'clinical', 'clinical', '{doctor,facility_head,records_officer}', 'plan_item_add, plan_item_remove (src/modules/clinical/exam)', 'the branch of the plan''s creating examination');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): clinical class.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.examinations', 'clinical'), ('public.intake_verifications', 'clinical'), ('public.face_map_marks', 'clinical'), ('public.care_plans', 'clinical'), ('public.plan_items', 'clinical');--> statement-breakpoint

-- ── Guards (plan P1-5): staff_access lock first, ENABLE ALWAYS ──────────────────────────────────────
-- Examinations: never deleted; open as a draft; identity immutable; a non-draft examination is final (T-053 signs).
CREATE FUNCTION public.examinations_guard() RETURNS trigger
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
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.examinations_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER examinations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.examinations FOR EACH ROW EXECUTE FUNCTION public.examinations_guard();--> statement-breakpoint
ALTER TABLE public.examinations ENABLE ALWAYS TRIGGER examinations_guard;--> statement-breakpoint

-- Parts of an examination change only while it is a draft. Verifications are never deleted and keep their
-- examination, fact and branch; marks are never updated (replaced) and may be deleted while a draft.
CREATE FUNCTION public.exam_parts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  r jsonb := coalesce(n, o);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || (r ->> 'tenant_id'), 0));
  IF TG_TABLE_NAME = 'intake_verifications' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'verifications are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'face_map_marks' AND TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a mark is replaced, not changed' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (n -> 'id', n -> 'tenant_id', n -> 'branch_id', n -> 'examination_id', n -> 'fact_id')
                         IS DISTINCT FROM (o -> 'id', o -> 'tenant_id', o -> 'branch_id', o -> 'examination_id', o -> 'fact_id') THEN
    RAISE EXCEPTION 'a verification keeps its examination and fact' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.examinations e
                  WHERE e.tenant_id = (r ->> 'tenant_id')::uuid AND e.id = (r ->> 'examination_id')::uuid AND e.state = 'draft') THEN
    RAISE EXCEPTION 'a signed examination is final' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_parts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER intake_verifications_guard BEFORE INSERT OR UPDATE OR DELETE ON public.intake_verifications FOR EACH ROW EXECUTE FUNCTION public.exam_parts_guard();--> statement-breakpoint
ALTER TABLE public.intake_verifications ENABLE ALWAYS TRIGGER intake_verifications_guard;--> statement-breakpoint
CREATE TRIGGER face_map_marks_guard BEFORE INSERT OR UPDATE OR DELETE ON public.face_map_marks FOR EACH ROW EXECUTE FUNCTION public.exam_parts_guard();--> statement-breakpoint
ALTER TABLE public.face_map_marks ENABLE ALWAYS TRIGGER face_map_marks_guard;--> statement-breakpoint

-- Plans and items are never deleted. A plan opens active, keeps its identity, title and condition, and a
-- closed plan is final. An item opens present, and changes only once, by removal (removed_at).
CREATE FUNCTION public.plans_guard() RETURNS trigger
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
    IF n ->> 'removed_at' IS NOT NULL THEN
      RAISE EXCEPTION 'an item opens present' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF o ->> 'removed_at' IS NOT NULL OR n ->> 'removed_at' IS NULL OR n - 'removed_at' IS DISTINCT FROM o - 'removed_at' THEN
    RAISE EXCEPTION 'a plan item changes only by removal' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.plans_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER care_plans_guard BEFORE INSERT OR UPDATE OR DELETE ON public.care_plans FOR EACH ROW EXECUTE FUNCTION public.plans_guard();--> statement-breakpoint
ALTER TABLE public.care_plans ENABLE ALWAYS TRIGGER care_plans_guard;--> statement-breakpoint
CREATE TRIGGER plan_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.plan_items FOR EACH ROW EXECUTE FUNCTION public.plans_guard();--> statement-breakpoint
ALTER TABLE public.plan_items ENABLE ALWAYS TRIGGER plan_items_guard;--> statement-breakpoint

-- ── Writers (plan P1-3): tenant_actor_lock first, then doctor and capability, before any id lookup ────
-- One audit row and, when typed, one event (ids and lower-case codes only) per change.
CREATE FUNCTION public.exam_changed(p_branch uuid, p_type text, p_kind text, p_id uuid, p_change text, p_extra jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.audit_append('settings_change', p_kind, p_id, 'success', p_change);
  IF p_type IS NOT NULL THEN
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (p_branch, p_type, p_kind, p_id, jsonb_strip_nulls(jsonb_build_object('change', p_change) || p_extra));
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_changed(uuid, text, text, uuid, text, jsonb) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.exam_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role <> 'doctor' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only a doctor examines' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_actor() FROM PUBLIC;--> statement-breakpoint

-- The author's draft examination, locked; its visit open at the actor's branch.
CREATE FUNCTION public.exam_draft(p_exam uuid) RETURNS public.examinations
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.exam_actor();
  e public.examinations;
BEGIN
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = a.tenant_id AND x.id = p_exam FOR UPDATE;
  IF NOT FOUND OR e.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(e.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: examination not found' USING ERRCODE = 'P0002';
  END IF;
  IF e.author_id <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the doctor who opened the examination edits it' USING ERRCODE = '42501';
  END IF;
  IF e.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: examination_signed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = e.tenant_id AND v.id = e.visit_id AND v.closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  RETURN e;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_draft(uuid) FROM PUBLIC;--> statement-breakpoint

-- ── exam_open: one examination per visit, opened by any doctor of the branch (idempotent) ──────────
CREATE FUNCTION public.exam_open(p_visit uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.exam_actor();
  v public.visits;
  e public.examinations;
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = a.tenant_id AND x.visit_id = v.id;
  IF FOUND THEN
    RETURN e.id;
  END IF;
  INSERT INTO public.examinations (tenant_id, branch_id, visit_id, patient_id, author_id)
  VALUES (a.tenant_id, v.branch_id, v.id, public.patient_canonical(a.tenant_id, v.patient_id), a.staff_id)
  RETURNING * INTO e;
  UPDATE public.visits SET doctor = 'in_progress' WHERE tenant_id = v.tenant_id AND id = v.id AND doctor = 'not_started';
  PERFORM public.exam_changed(e.branch_id, 'ExaminationOpened', 'examination', e.id, 'examination_opened',
    jsonb_build_object('examination_id', e.id, 'visit_id', e.visit_id, 'branch_id', e.branch_id));
  RETURN e.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_open(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.exam_open(uuid) TO clinic_app;--> statement-breakpoint

-- ── exam_save: SOAP sections, template values, vitals, ICD-10 (allowlist; absent keys unchanged) ────
CREATE FUNCTION public.exam_save(p_exam uuid, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations := public.exam_draft(p_exam);
  v_tpl text;
  v_vals jsonb;
  v_codes text[];
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'subjective' - 'objective' - 'assessment' - 'plan_note' - 'template_key' - 'template_values' - 'vitals' - 'icd10_codes' <> '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_each(p) x WHERE x.key IN ('subjective','objective','assessment','plan_note','template_key')
                  AND (jsonb_typeof(x.value) NOT IN ('string','null') OR length(coalesce(x.value #>> '{}', '')) > 4000)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: examination' USING ERRCODE = '22023';
  END IF;
  v_tpl := CASE WHEN p ? 'template_key' THEN NULLIF(p ->> 'template_key', '') ELSE e.template_key END;
  v_vals := CASE WHEN p ? 'template_values' THEN coalesce(NULLIF(p -> 'template_values', 'null'::jsonb), '{}'::jsonb) ELSE e.template_values END;
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
  END IF;
  UPDATE public.examinations SET
    subjective = CASE WHEN p ? 'subjective' THEN NULLIF(btrim(coalesce(p ->> 'subjective', '')), '') ELSE subjective END,
    objective = CASE WHEN p ? 'objective' THEN NULLIF(btrim(coalesce(p ->> 'objective', '')), '') ELSE objective END,
    assessment = CASE WHEN p ? 'assessment' THEN NULLIF(btrim(coalesce(p ->> 'assessment', '')), '') ELSE assessment END,
    plan_note = CASE WHEN p ? 'plan_note' THEN NULLIF(btrim(coalesce(p ->> 'plan_note', '')), '') ELSE plan_note END,
    template_key = v_tpl, template_values = v_vals,
    vitals = CASE WHEN p ? 'vitals' THEN p -> 'vitals' ELSE vitals END,
    icd10_codes = coalesce(v_codes, icd10_codes),
    updated_at = clock_timestamp()
   WHERE tenant_id = e.tenant_id AND id = e.id;
  PERFORM public.exam_changed(e.branch_id, NULL, 'examination', e.id, 'examination_saved', '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_save(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.exam_save(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── intake_verify (CLIN-004): a fact of the visit's sent intake, or one it reviewed, confirmed or
-- corrected. The BC fact never changes; a re-decision on the draft raises the version. ───────────────
CREATE FUNCTION public.intake_verify(p_exam uuid, p_fact uuid, p_decision text, p_value text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations := public.exam_draft(p_exam);
  i public.intakes;
  w public.intake_verifications;
  v_value text := CASE WHEN p_decision = 'corrected' THEN btrim(p_value) END;
BEGIN
  IF coalesce(p_decision, '') NOT IN ('confirmed','corrected')
     OR p_decision = 'corrected' AND length(coalesce(v_value, '')) NOT BETWEEN 1 AND 500
     OR p_decision = 'confirmed' AND p_value IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: verification' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.intakes x WHERE x.tenant_id = e.tenant_id AND x.visit_id = e.visit_id;
  IF NOT FOUND OR i.state <> 'sent' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: intake_not_sent' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.intake_facts f WHERE f.tenant_id = e.tenant_id AND f.id = p_fact
                   AND (f.intake_id = i.id OR f.id = ANY (i.reviewed_prior))) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: fact not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO w FROM public.intake_verifications x WHERE x.tenant_id = e.tenant_id AND x.examination_id = e.id AND x.fact_id = p_fact FOR UPDATE;
  IF FOUND THEN
    IF (w.decision, w.corrected_value) IS NOT DISTINCT FROM (p_decision, v_value) THEN
      RETURN w.version;
    END IF;
    UPDATE public.intake_verifications SET decision = p_decision, corrected_value = v_value, version = w.version + 1,
           verified_by = e.author_id, verified_at = clock_timestamp()
     WHERE tenant_id = w.tenant_id AND id = w.id RETURNING * INTO w;
  ELSE
    INSERT INTO public.intake_verifications (tenant_id, branch_id, examination_id, fact_id, decision, corrected_value, verified_by)
    VALUES (e.tenant_id, e.branch_id, e.id, p_fact, p_decision, v_value, e.author_id)
    RETURNING * INTO w;
  END IF;
  PERFORM public.exam_changed(e.branch_id, 'IntakeVerified', 'examination', e.id, 'intake_verified',
    jsonb_build_object('examination_id', e.id, 'fact_id', p_fact, 'decision', p_decision));
  RETURN w.version;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_verify(uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.intake_verify(uuid, uuid, text, text) TO clinic_app;--> statement-breakpoint

-- An active catalog version of the tenant of an allowed kind, marked referenced (CLIN-011).
CREATE FUNCTION public.exam_version(p_tenant uuid, p_version uuid, p_kinds text[]) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.catalog_versions v JOIN public.catalog_items it ON it.tenant_id = v.tenant_id AND it.id = v.item_id
                  WHERE v.tenant_id = p_tenant AND v.id = p_version AND v.state = 'active' AND it.kind = ANY (p_kinds)) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: catalog version not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.catalog_version_reference(p_version);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_version(uuid, uuid, text[]) FROM PUBLIC;--> statement-breakpoint

-- ── Face-map marks: integer permille coordinates; tindakan ⇔ dose; a version only on tindakan ─────
CREATE FUNCTION public.mark_set(p_exam uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations := public.exam_draft(p_exam);
  v_id uuid;
  v_version uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'template' - 'layer' - 'x' - 'y' - 'label' - 'catalog_version_id' - 'dose_micro' - 'dose_unit' <> '{}'::jsonb
     OR coalesce(p ->> 'template', '') NOT IN ('face_front','face_left','face_right','body')
     OR coalesce(p ->> 'layer', '') NOT IN ('keluhan','pemeriksaan','tindakan')
     OR jsonb_typeof(p -> 'x') IS DISTINCT FROM 'number' OR (p ->> 'x') !~ '^[0-9]{1,4}$'
     OR jsonb_typeof(p -> 'y') IS DISTINCT FROM 'number' OR (p ->> 'y') !~ '^[0-9]{1,4}$'
     OR jsonb_typeof(p -> 'label') IS DISTINCT FROM 'string' OR length(btrim(p ->> 'label')) NOT BETWEEN 1 AND 120
     OR (p ->> 'layer' = 'tindakan') <> (p ? 'dose_micro' AND p ? 'dose_unit')
     OR (p ? 'dose_micro') <> (p ? 'dose_unit')
     OR p ? 'dose_micro' AND (jsonb_typeof(p -> 'dose_micro') <> 'number' OR (p ->> 'dose_micro') !~ '^[0-9]{1,10}$')
     OR p ? 'dose_unit' AND coalesce(p ->> 'dose_unit', '') NOT IN ('unit','ml','mg','cm2')
     OR p ? 'catalog_version_id' AND (p ->> 'layer' <> 'tindakan'
          OR coalesce(p ->> 'catalog_version_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: mark' USING ERRCODE = '22023';
  END IF;
  v_version := (p ->> 'catalog_version_id')::uuid;
  IF v_version IS NOT NULL THEN
    PERFORM public.exam_version(e.tenant_id, v_version, ARRAY['service','product','material']);
  END IF;
  -- the CHECKs (0–1000, 1–10⁹) refuse out-of-range values as 23514; map them to invalid input
  BEGIN
    INSERT INTO public.face_map_marks (tenant_id, branch_id, examination_id, template, layer, x, y, label, catalog_version_id, dose_micro, dose_unit)
    VALUES (e.tenant_id, e.branch_id, e.id, p ->> 'template', p ->> 'layer', (p ->> 'x')::integer, (p ->> 'y')::integer, btrim(p ->> 'label'),
            v_version, (p ->> 'dose_micro')::bigint, p ->> 'dose_unit')
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: mark' USING ERRCODE = '22023';
  END;
  PERFORM public.exam_changed(e.branch_id, NULL, 'examination', e.id, 'mark_set', '{}'::jsonb);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mark_set(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mark_set(uuid, jsonb) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.mark_remove(p_exam uuid, p_mark uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations := public.exam_draft(p_exam);
BEGIN
  DELETE FROM public.face_map_marks WHERE tenant_id = e.tenant_id AND examination_id = e.id AND id = p_mark;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: mark not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.exam_changed(e.branch_id, NULL, 'examination', e.id, 'mark_removed', '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mark_remove(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mark_remove(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- ── Care plans (CLIN-012/013): several in parallel, through the author's draft; no percentage ────
CREATE FUNCTION public.plan_create(p_exam uuid, p_title text, p_condition text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations := public.exam_draft(p_exam);
  v_id uuid;
BEGIN
  IF length(btrim(coalesce(p_title, ''))) NOT BETWEEN 3 AND 160 OR length(btrim(coalesce(p_condition, ''))) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: plan' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id, created_by)
  VALUES (e.tenant_id, e.branch_id, e.patient_id, btrim(p_title), btrim(p_condition), e.id, e.author_id)
  RETURNING id INTO v_id;
  PERFORM public.exam_changed(e.branch_id, 'CarePlanCreated', 'care_plan', v_id, 'plan_created',
    jsonb_build_object('plan_id', v_id, 'examination_id', e.id, 'patient_id', e.patient_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.plan_create(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.plan_create(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- An active plan of the examination's patient (merge cluster), locked.
CREATE FUNCTION public.exam_plan(e public.examinations, p_plan uuid) RETURNS public.care_plans
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.care_plans;
BEGIN
  SELECT * INTO c FROM public.care_plans x WHERE x.tenant_id = e.tenant_id AND x.id = p_plan
     AND x.patient_id = ANY (public.patient_cluster(e.tenant_id, public.patient_canonical(e.tenant_id, e.patient_id))) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: plan not found' USING ERRCODE = 'P0002';
  END IF;
  IF c.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: plan_closed' USING ERRCODE = '55000';
  END IF;
  RETURN c;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_plan(public.examinations, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.plan_item_add(p_exam uuid, p_plan uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations := public.exam_draft(p_exam);
  c public.care_plans := public.exam_plan(e, p_plan);
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'stage' - 'catalog_version_id' - 'qty' - 'dose_micro' - 'dose_unit' - 'note' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'stage') IS DISTINCT FROM 'number' OR (p ->> 'stage') !~ '^[0-9]{1,2}$'
     OR jsonb_typeof(p -> 'qty') IS DISTINCT FROM 'number' OR (p ->> 'qty') !~ '^[0-9]{1,4}$'
     OR coalesce(p ->> 'catalog_version_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (p ? 'dose_micro') <> (p ? 'dose_unit')
     OR p ? 'dose_micro' AND (jsonb_typeof(p -> 'dose_micro') <> 'number' OR (p ->> 'dose_micro') !~ '^[0-9]{1,10}$')
     OR p ? 'dose_unit' AND coalesce(p ->> 'dose_unit', '') NOT IN ('unit','ml','mg','cm2')
     OR p ? 'note' AND (jsonb_typeof(p -> 'note') <> 'string' OR length(btrim(p ->> 'note')) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: plan_item' USING ERRCODE = '22023';
  END IF;
  PERFORM public.exam_version(e.tenant_id, (p ->> 'catalog_version_id')::uuid, ARRAY['service','product','package']);
  BEGIN
    INSERT INTO public.plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty, dose_micro, dose_unit, note)
    VALUES (e.tenant_id, c.branch_id, c.id, e.id, (p ->> 'stage')::integer, (p ->> 'catalog_version_id')::uuid, (p ->> 'qty')::integer,
            (p ->> 'dose_micro')::bigint, p ->> 'dose_unit', btrim(p ->> 'note'))
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: plan_item' USING ERRCODE = '22023';
  END;
  PERFORM public.exam_changed(e.branch_id, 'CarePlanUpdated', 'care_plan', c.id, 'plan_item_added',
    jsonb_build_object('plan_id', c.id, 'examination_id', e.id, 'item_id', v_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.plan_item_add(uuid, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.plan_item_add(uuid, uuid, jsonb) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.plan_item_remove(p_exam uuid, p_item uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations := public.exam_draft(p_exam);
  t public.plan_items;
  c public.care_plans;
BEGIN
  SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = e.tenant_id AND x.id = p_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: plan item not found' USING ERRCODE = 'P0002';
  END IF;
  c := public.exam_plan(e, t.plan_id);
  SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = e.tenant_id AND x.id = p_item FOR UPDATE;
  IF t.removed_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE public.plan_items SET removed_at = clock_timestamp() WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.exam_changed(e.branch_id, 'CarePlanUpdated', 'care_plan', c.id, 'plan_item_removed',
    jsonb_build_object('plan_id', c.id, 'examination_id', e.id, 'item_id', t.id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.plan_item_remove(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.plan_item_remove(uuid, uuid) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.plan_close(p_exam uuid, p_plan uuid, p_state text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations := public.exam_draft(p_exam);
  c public.care_plans;
BEGIN
  IF coalesce(p_state, '') NOT IN ('completed','stopped') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: plan_state' USING ERRCODE = '22023';
  END IF;
  c := public.exam_plan(e, p_plan);
  UPDATE public.care_plans SET state = p_state, closed_exam_id = e.id, closed_at = clock_timestamp()
   WHERE tenant_id = c.tenant_id AND id = c.id;
  PERFORM public.exam_changed(e.branch_id, 'CarePlanClosed', 'care_plan', c.id, 'plan_' || p_state,
    jsonb_build_object('plan_id', c.id, 'examination_id', e.id, 'state', p_state));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.plan_close(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.plan_close(uuid, uuid, text) TO clinic_app;--> statement-breakpoint

-- ── Cautions (plan P1-2): an allergy the doctor verified is reported as clinician_verified with the
-- decided value (the corrected value when corrected); an unverified one is unchanged from 0069. The latest
-- verification of the fact wins. Internal helper (no grant): patient_cautions and exam_sheet call it.
CREATE FUNCTION public.exam_cautions(p_tenant uuid, p_patient uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('fact_id', h.id, 'kind', h.kind,
           'value', CASE WHEN w.id IS NULL THEN h.value ELSE coalesce(w.corrected_value, h.value) END,
           'provenance', CASE WHEN w.id IS NULL THEN h.provenance ELSE w.provenance END,
           'sent_at', (SELECT ii.sent_at FROM public.intakes ii WHERE ii.tenant_id = h.tenant_id AND ii.id = h.intake_id))
         || CASE WHEN w.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('verified_at', w.verified_at, 'decision', w.decision) END), '[]'::jsonb)
    FROM public.intake_history(p_tenant, p_patient, NULL) h
    LEFT JOIN LATERAL (SELECT x.* FROM public.intake_verifications x WHERE x.tenant_id = h.tenant_id AND x.fact_id = h.id
                        ORDER BY x.verified_at DESC, x.id DESC LIMIT 1) w ON true
   WHERE h.kind = 'allergy' AND h.provenance = 'bc_captured_unverified'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_cautions(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- patient_cautions (0069) re-created: the same authority and not-found rules; the result from exam_cautions.
CREATE OR REPLACE FUNCTION public.patient_cautions(p_patient uuid) RETURNS jsonb
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
  RETURN public.exam_cautions(a.tenant_id, v_canon);
END
$$;

-- ── Readers (plan P1-1): the merge cluster for history, intakes, examinations, cautions and plans ────
-- The doctor's queue (UX-8 list): today's open visits at the branch and those closed today, with the
-- intake and doctor steps, intake state, examination and its author, and the number of allergy cautions.
-- Doctor, facility head, records officer of the branch (wall clock through approval_actor).
CREATE FUNCTION public.pemeriksaan_visits(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  today date;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role IN ('doctor','facility_head','records_officer') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read Pemeriksaan' USING ERRCODE = '42501';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, p_branch);
  today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object('today', today, 'branch_name', b.name,
    'visits', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'kind', v.kind, 'checked_in_at', v.checked_in_at, 'patient_id', pt.id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn,
               'intake', v.intake, 'doctor', v.doctor, 'closed', v.closed_at IS NOT NULL, 'intake_state', i.state,
               'exam_id', e.id, 'exam_state', e.state, 'author_id', e.author_id, 'author_name', au.display_name,
               'cautions', (SELECT count(*) FROM public.intake_history(v.tenant_id, pt.id, NULL) h WHERE h.kind = 'allergy'))
             ORDER BY v.checked_in_at, v.id)
        FROM public.visits v
        JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id)
        LEFT JOIN public.intakes i ON i.tenant_id = v.tenant_id AND i.visit_id = v.id
        LEFT JOIN public.examinations e ON e.tenant_id = v.tenant_id AND e.visit_id = v.id
        LEFT JOIN public.staff au ON au.tenant_id = e.tenant_id AND au.id = e.author_id
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = b.id
         AND (v.closed_at IS NULL AND (v.checked_in_at AT TIME ZONE b.timezone)::date = today
              OR (v.closed_at AT TIME ZONE b.timezone)::date = today)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pemeriksaan_visits(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pemeriksaan_visits(uuid) TO clinic_app;--> statement-breakpoint

-- Active plans of a patient cluster with items and live branch prices (integer rupiah; never stored).
-- p_full adds the clinical fields (condition, dose, note) for the clinical readers only.
CREATE FUNCTION public.exam_plans_json(p_tenant uuid, p_patient uuid, p_branch uuid, p_full boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'state', c.state, 'created_at', c.created_at)
           || CASE WHEN p_full THEN jsonb_build_object('condition', c.condition, 'created_exam_id', c.created_exam_id) ELSE '{}'::jsonb END
           || jsonb_build_object('items', coalesce((
                SELECT jsonb_agg(x.j ORDER BY x.stage, x.created_at, x.id) FROM (
                  SELECT t.stage, t.created_at, t.id, jsonb_build_object('id', t.id, 'stage', t.stage, 'item_id', it.id, 'version_id', cv.id,
                           'name', cv.name, 'kind', it.kind, 'qty', t.qty, 'unit_price', pr.price, 'line_total', t.qty * pr.price)
                         || CASE WHEN p_full THEN jsonb_strip_nulls(jsonb_build_object('dose_micro', t.dose_micro, 'dose_unit', t.dose_unit, 'note', t.note, 'examination_id', t.examination_id)) ELSE '{}'::jsonb END AS j
                    FROM public.plan_items t
                    JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
                    JOIN public.catalog_items it ON it.tenant_id = cv.tenant_id AND it.id = cv.item_id
                    CROSS JOIN LATERAL (SELECT public.catalog_branch_price(it.id, p_branch) AS price) pr
                   WHERE t.tenant_id = c.tenant_id AND t.plan_id = c.id AND t.removed_at IS NULL) x), '[]'::jsonb))
           ORDER BY c.created_at, c.id), '[]'::jsonb)
    FROM public.care_plans c
   WHERE c.tenant_id = p_tenant AND c.state = 'active'
     AND c.patient_id = ANY (public.patient_cluster(p_tenant, public.patient_canonical(p_tenant, p_patient)))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.exam_plans_json(uuid, uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint

-- The sheet of one visit (PR-10: one read): patient, cautions, today's intake with its facts and the reviewed
-- prior facts with this examination's verification, the examination with marks, earlier visits of the
-- cluster, active plans. Clinical readers of the visit's branch; anything else is not found. Audited.
CREATE FUNCTION public.exam_sheet(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v public.visits;
  pt public.patients;
  i public.intakes;
  e public.examinations;
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
              'subjective', e.subjective, 'objective', e.objective, 'assessment', e.assessment, 'plan_note', e.plan_note,
              'template_key', e.template_key, 'template_values', e.template_values, 'vitals', e.vitals, 'icd10_codes', to_jsonb(e.icd10_codes),
              'updated_at', e.updated_at,
              'marks', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m.id, 'template', m.template, 'layer', m.layer, 'x', m.x, 'y', m.y,
                                   'label', m.label, 'catalog_version_id', m.catalog_version_id, 'dose_micro', m.dose_micro, 'dose_unit', m.dose_unit)) ORDER BY m.created_at, m.id)
                                   FROM public.face_map_marks m WHERE m.tenant_id = e.tenant_id AND m.examination_id = e.id), '[]'::jsonb)) END,
    'earlier', coalesce((
      SELECT jsonb_agg(jsonb_build_object('visit_id', x.id, 'checked_in_at', x.checked_in_at, 'branch_name', x.branch_name, 'complaint', x.complaint,
               'assessment', x.assessment, 'icd10_codes', to_jsonb(x.icd10_codes), 'author_name', x.author_name) ORDER BY x.checked_in_at DESC)
        FROM (SELECT pv.id, pv.checked_in_at, br.name AS branch_name, pi.complaint, pe.assessment, pe.icd10_codes, pa.display_name AS author_name
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
REVOKE ALL ON FUNCTION public.exam_sheet(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.exam_sheet(uuid) TO clinic_app;--> statement-breakpoint

-- The plan projection (07:45, 19:91): BC, FO, doctor, nurse, therapist of the visit's branch see the active
-- plans of the visit's patient — title, state and items with live prices only; never the condition, a dose, a
-- note, or anything of the examination or the marks. Not a clinical read.
CREATE FUNCTION public.plan_options(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v public.visits;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR NOT a.role IN ('bc','fo_cashier','doctor','nurse','therapist') OR v.branch_id IS DISTINCT FROM a.branch_id
     OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('visit_id', v.id, 'plans', public.exam_plans_json(v.tenant_id, v.patient_id, v.branch_id, false));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.plan_options(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.plan_options(uuid) TO clinic_app;
