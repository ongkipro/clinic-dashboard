CREATE TABLE "document_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"paper" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "document_template_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "document_template_versions_number_key" UNIQUE("tenant_id","template_id","version"),
	CONSTRAINT "document_template_versions_check" CHECK ("document_template_versions"."version" >= 1 and length("document_template_versions"."body") between 10 and 20000 and "document_template_versions"."paper" in ('a4','80mm','58mm')
      and ("document_template_versions"."kind" = 'receipt' or "document_template_versions"."paper" = 'a4') and "document_template_versions"."state" in ('active','retired') and "document_template_versions"."created_as" in ('owner','admin_pusat','facility_head'))
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"letter_type" text,
	"name" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_by" uuid,
	"retired_as" text,
	CONSTRAINT "document_templates_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "document_templates_tenant_kind_id_key" UNIQUE("tenant_id","kind","id"),
	CONSTRAINT "document_templates_check" CHECK ("document_templates"."kind" in ('receipt','consent','letter','legal') and (("document_templates"."kind" = 'letter') = ("document_templates"."letter_type" is not null))
      and ("document_templates"."letter_type" is null or "document_templates"."letter_type" in ('surat_keterangan','rujukan','resume')) and length(btrim("document_templates"."name")) between 3 and 120
      and "document_templates"."created_as" in ('owner','admin_pusat','facility_head') and "document_templates"."state" in ('active','retired')
      and (("document_templates"."state" = 'retired') = (num_nonnulls("document_templates"."retired_at", "document_templates"."retired_by", "document_templates"."retired_as") = 3)) and num_nonnulls("document_templates"."retired_at", "document_templates"."retired_by", "document_templates"."retired_as") in (0, 3))
);
--> statement-breakpoint
CREATE TABLE "medical_letter_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"letter_id" uuid NOT NULL,
	"body" text NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"approval_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"decided_at" timestamp with time zone,
	"version_id" uuid,
	CONSTRAINT "medical_letter_corrections_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "medical_letter_corrections_approval_key" UNIQUE("tenant_id","approval_id"),
	CONSTRAINT "medical_letter_corrections_check" CHECK ("medical_letter_corrections"."state" in ('pending','approved','rejected','cancelled') and "medical_letter_corrections"."requested_as" = 'doctor'
      and length(btrim("medical_letter_corrections"."body")) between 10 and 40000 and length(btrim("medical_letter_corrections"."reason")) between 3 and 500
      and (("medical_letter_corrections"."state" = 'pending') = ("medical_letter_corrections"."decided_at" is null)) and (("medical_letter_corrections"."state" = 'approved') = ("medical_letter_corrections"."version_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "medical_letter_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"letter_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"reason" text,
	"approval_id" uuid,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "medical_letter_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "medical_letter_versions_number_key" UNIQUE("tenant_id","letter_id","version"),
	CONSTRAINT "medical_letter_versions_check" CHECK ("medical_letter_versions"."version" >= 1 and "medical_letter_versions"."kind" in ('original','correction')
      and (("medical_letter_versions"."kind" = 'original') = ("medical_letter_versions"."version" = 1)) and (("medical_letter_versions"."kind" = 'correction') = ("medical_letter_versions"."reason" is not null))
      and ("medical_letter_versions"."approval_id" is null or "medical_letter_versions"."kind" = 'correction') and ("medical_letter_versions"."reason" is null or length(btrim("medical_letter_versions"."reason")) between 3 and 500)
      and length(btrim("medical_letter_versions"."body")) between 10 and 40000 and "medical_letter_versions"."content_hash" ~ '^[0-9a-f]{64}$' and "medical_letter_versions"."created_as" = 'doctor')
);
--> statement-breakpoint
CREATE TABLE "medical_letters" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"examination_id" uuid,
	"template_version_id" uuid NOT NULL,
	"letter_type" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	"signed_as" text,
	"content_hash" text,
	CONSTRAINT "medical_letters_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "medical_letters_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "medical_letters_check" CHECK ("medical_letters"."letter_type" in ('surat_keterangan','rujukan','resume') and "medical_letters"."state" in ('draft','signed')
      and length(btrim("medical_letters"."body")) between 10 and 40000
      and (("medical_letters"."state" = 'signed') = (num_nonnulls("medical_letters"."signed_at", "medical_letters"."signed_by", "medical_letters"."signed_as", "medical_letters"."content_hash") = 4))
      and num_nonnulls("medical_letters"."signed_at", "medical_letters"."signed_by", "medical_letters"."signed_as", "medical_letters"."content_hash") in (0, 4)
      and ("medical_letters"."signed_by" is null or ("medical_letters"."signed_by" = "medical_letters"."author_id" and "medical_letters"."signed_as" = 'doctor'))
      and ("medical_letters"."content_hash" is null or "medical_letters"."content_hash" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_template_fk" FOREIGN KEY ("tenant_id","kind","template_id") REFERENCES "public"."document_templates"("tenant_id","kind","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_retired_by_fk" FOREIGN KEY ("tenant_id","retired_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_corrections" ADD CONSTRAINT "medical_letter_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_corrections" ADD CONSTRAINT "medical_letter_corrections_letter_fk" FOREIGN KEY ("tenant_id","branch_id","letter_id") REFERENCES "public"."medical_letters"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_corrections" ADD CONSTRAINT "medical_letter_corrections_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_corrections" ADD CONSTRAINT "medical_letter_corrections_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_corrections" ADD CONSTRAINT "medical_letter_corrections_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."medical_letter_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_versions" ADD CONSTRAINT "medical_letter_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_versions" ADD CONSTRAINT "medical_letter_versions_letter_fk" FOREIGN KEY ("tenant_id","branch_id","letter_id") REFERENCES "public"."medical_letters"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_versions" ADD CONSTRAINT "medical_letter_versions_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letter_versions" ADD CONSTRAINT "medical_letter_versions_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letters" ADD CONSTRAINT "medical_letters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letters" ADD CONSTRAINT "medical_letters_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letters" ADD CONSTRAINT "medical_letters_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letters" ADD CONSTRAINT "medical_letters_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letters" ADD CONSTRAINT "medical_letters_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letters" ADD CONSTRAINT "medical_letters_template_fk" FOREIGN KEY ("tenant_id","template_version_id") REFERENCES "public"."document_template_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letters" ADD CONSTRAINT "medical_letters_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_letters" ADD CONSTRAINT "medical_letters_signed_by_fk" FOREIGN KEY ("tenant_id","signed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_one_active" ON "document_template_versions" USING btree ("tenant_id","template_id") WHERE state = 'active';--> statement-breakpoint
CREATE INDEX "document_templates_kind_idx" ON "document_templates" USING btree ("tenant_id","kind","state");--> statement-breakpoint
CREATE UNIQUE INDEX "medical_letter_corrections_one_pending" ON "medical_letter_corrections" USING btree ("tenant_id","letter_id") WHERE state = 'pending';--> statement-breakpoint
CREATE INDEX "medical_letters_visit_idx" ON "medical_letters" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE INDEX "medical_letters_patient_idx" ON "medical_letters" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "medical_letters_author_idx" ON "medical_letters" USING btree ("tenant_id","branch_id","author_id","created_at");;--> statement-breakpoint

-- T-058 rules (generated by gen.py; plan docs/tasks/T-058.md)
-- Document templates and signed medical letters (PR-74, DATA-19, DATA-53, UX-54; plan Argon r1 22e09cb7 adopted,
-- r2 47f56517 APPROVE; DEC-067 revisable defaults).

-- Template read helper (invoker, wall clock, never null): owner and admin pusat read every kind; the facility head
-- the clinical kinds (consent, letter) and the doctor letter templates, both holding the acting role at the active
-- branch now (a Level 3 role binds a branch; templates are tenant-wide).
CREATE FUNCTION public.template_readable(p_tenant uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id() AND (
      public.app_role_in(ARRAY['owner','admin_pusat'])
      OR (public.app_role_in(ARRAY['facility_head']) AND p_kind IN ('consent','letter')
          OR public.app_role_in(ARRAY['doctor']) AND p_kind = 'letter')
         AND EXISTS (
           SELECT 1 FROM public.staff s
             JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
             JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = public.app_acting_role()
                  AND sb.branch_id = NULLIF(current_setting('app.active_branch_id', true), '')::uuid
            WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
              AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp()))), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_readable(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.template_readable(uuid, text) TO clinic_app;--> statement-breakpoint

-- The closed placeholder set per kind (plan open point 5): required ones first.
CREATE FUNCTION public.template_placeholders(p_kind text, OUT required text[], OUT allowed text[])
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT r, r || o FROM (SELECT
    CASE p_kind
      WHEN 'letter' THEN ARRAY['klinik.nama','tanggal','pasien.nama','pasien.no_rm','dokter.nama','dokter.sip']
      WHEN 'receipt' THEN ARRAY['klinik.nama','cabang.alamat','klinik.npwp','struk.nomor','tanggal','struk.baris','struk.total']
      WHEN 'consent' THEN ARRAY['klinik.nama','pasien.nama','pasien.no_rm','tindakan.daftar','tindakan.risiko','tanggal','tanda_tangan']
      WHEN 'legal' THEN ARRAY['klinik.nama','vendor.nama','tanggal'] END AS r,
    CASE p_kind
      WHEN 'letter' THEN ARRAY['cabang.nama','cabang.alamat','pasien.tanggal_lahir','pasien.jenis_kelamin','kunjungan.tanggal',
                               'pemeriksaan.keluhan','pemeriksaan.objektif','pemeriksaan.asesmen','pemeriksaan.rencana','pemeriksaan.icd10']
      WHEN 'receipt' THEN ARRAY['cabang.nama','pasien.nama','pasien.no_rm','struk.metode_bayar','vendor.nama']
      WHEN 'consent' THEN ARRAY['cabang.nama','dokter.nama','dokter.sip']
      WHEN 'legal' THEN ARRAY['klinik.npwp','cabang.alamat','vendor.nib','vendor.pse','vendor.npwp','vendor.situs','vendor.url_privasi',
                              'vendor.email_dukungan','vendor.telepon_dukungan'] END AS o) x
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_placeholders(text) FROM PUBLIC;--> statement-breakpoint

-- Checks a template body (and name): no patient data patterns (an MRN, a 16-digit NIK), braces only in
-- `{{token}}`, every token known for the kind, every required token present. Raises the reason.
CREATE FUNCTION public.template_check(p_kind text, p_name text, p_body text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ph record := public.template_placeholders(p_kind);
  v_tokens text[];
  k text;
BEGIN
  IF p_name ~* 'RM-[0-9]{6}' OR p_body ~* 'RM-[0-9]{6}' OR p_name ~ '(^|[^0-9])[0-9]{16}([^0-9]|$)' OR p_body ~ '(^|[^0-9])[0-9]{16}([^0-9]|$)' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: patient_data_in_template' USING ERRCODE = '22023';
  END IF;
  -- Removing every well-formed token must leave no brace.
  IF regexp_replace(p_body, '\{\{[a-z_]+(\.[a-z_0-9]+)?\}\}', '', 'g') ~ '[{}]' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: malformed_placeholder' USING ERRCODE = '22023';
  END IF;
  v_tokens := ARRAY(SELECT DISTINCT m[1] FROM regexp_matches(p_body, '\{\{([a-z_]+(?:\.[a-z_0-9]+)?)\}\}', 'g') AS m);
  FOREACH k IN ARRAY v_tokens LOOP
    IF NOT k = ANY (ph.allowed) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: unknown_placeholder' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ph.required LOOP
    IF NOT k = ANY (v_tokens) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: missing_placeholder' USING ERRCODE = '22023';
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_check(text, text, text) FROM PUBLIC;--> statement-breakpoint

-- Replaces the `{{token}}` placeholders of a body from a map of values (missing values render as '-').
CREATE FUNCTION public.template_fill(p_body text, p_values jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_out text := p_body;
  k text;
BEGIN
  FOR k IN SELECT DISTINCT m[1] FROM regexp_matches(p_body, '\{\{([a-z_]+(?:\.[a-z_0-9]+)?)\}\}', 'g') AS m LOOP
    v_out := replace(v_out, '{{' || k || '}}', coalesce(NULLIF(btrim(p_values ->> k), ''), '-'));
  END LOOP;
  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_fill(text, jsonb) FROM PUBLIC;--> statement-breakpoint

-- The letter values for a visit (plan P1-3): tenant, branch, patient, the doctor (SIP verified and in force at the
-- branch on the branch-local date, else '-'), the visit date, and the examination's fields when it exists (the
-- current signed version, else the draft).
CREATE FUNCTION public.letter_values(p_tenant uuid, p_visit uuid, p_doctor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.visits;
  b public.branches;
  pt public.patients;
  e public.examinations;
  c jsonb;
  today date;
BEGIN
  SELECT * INTO v FROM public.visits WHERE tenant_id = p_tenant AND id = p_visit;
  SELECT * INTO b FROM public.branches WHERE tenant_id = p_tenant AND id = v.branch_id;
  SELECT * INTO pt FROM public.patients WHERE tenant_id = p_tenant AND id = public.patient_canonical(p_tenant, v.patient_id);
  SELECT * INTO e FROM public.examinations WHERE tenant_id = p_tenant AND visit_id = p_visit;
  IF FOUND THEN
    c := CASE WHEN e.state = 'signed' THEN (public.record_current(e.tenant_id, e.id)).content ELSE public.record_content(e) END;
  END IF;
  today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object(
    'klinik.nama', (SELECT t.legal_name FROM public.tenants t WHERE t.id = p_tenant),
    'tanggal', to_char(today, 'DD-MM-YYYY'),
    'cabang.nama', b.name,
    'cabang.alamat', b.address,
    'pasien.nama', pt.full_name,
    'pasien.no_rm', pt.mrn,
    'pasien.tanggal_lahir', to_char(pt.birth_date, 'DD-MM-YYYY'),
    'pasien.jenis_kelamin', CASE pt.sex WHEN 'female' THEN 'Perempuan' WHEN 'male' THEN 'Laki-laki' END,
    'kunjungan.tanggal', to_char((v.checked_in_at AT TIME ZONE b.timezone)::date, 'DD-MM-YYYY'),
    'dokter.nama', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = p_tenant AND s.id = p_doctor),
    'dokter.sip', (SELECT k.number FROM public.staff_credentials k
                    WHERE k.tenant_id = p_tenant AND k.staff_id = p_doctor AND k.kind = 'sip' AND k.branch_id = v.branch_id AND k.state = 'verified'
                      AND k.valid_from <= today AND (k.expires_on IS NULL OR k.expires_on >= today)
                      -- Not superseded, by credential_valid's rule (0068).
                      AND NOT EXISTS (SELECT 1 FROM public.staff_credentials r WHERE r.tenant_id = k.tenant_id AND r.replaces = k.id
                                       AND (r.state IN ('suspended','revoked') OR r.state = 'verified' AND r.valid_from <= today))
                    ORDER BY k.valid_from DESC, k.id DESC LIMIT 1),
    'pemeriksaan.keluhan', c ->> 'subjective',
    'pemeriksaan.objektif', c ->> 'objective',
    'pemeriksaan.asesmen', c ->> 'assessment',
    'pemeriksaan.rencana', c ->> 'plan_note',
    'pemeriksaan.icd10', (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(c -> 'icd10_codes') x));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_values(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.letter_hash(p_body text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT encode(sha256(convert_to(p_body, 'UTF8')), 'hex')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_hash(text) FROM PUBLIC;--> statement-breakpoint

-- The current version of a signed letter (the highest number).
CREATE FUNCTION public.letter_current(p_tenant uuid, p_letter uuid) RETURNS public.medical_letter_versions
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT * FROM public.medical_letter_versions WHERE tenant_id = p_tenant AND letter_id = p_letter ORDER BY version DESC LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_current(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY document_templates_read ON public.document_templates FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.template_readable(tenant_id, kind));--> statement-breakpoint
GRANT SELECT ON public.document_templates TO clinic_app;--> statement-breakpoint
CREATE POLICY document_templates_operator_read ON public.document_templates FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.document_templates', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.document_templates TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER document_templates_no_truncate BEFORE TRUNCATE ON public.document_templates FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.document_templates ENABLE ALWAYS TRIGGER document_templates_no_truncate;--> statement-breakpoint
ALTER TABLE public.document_template_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY document_template_versions_read ON public.document_template_versions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.template_readable(tenant_id, kind));--> statement-breakpoint
GRANT SELECT ON public.document_template_versions TO clinic_app;--> statement-breakpoint
CREATE POLICY document_template_versions_operator_read ON public.document_template_versions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.document_template_versions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.document_template_versions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER document_template_versions_no_truncate BEFORE TRUNCATE ON public.document_template_versions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.document_template_versions ENABLE ALWAYS TRIGGER document_template_versions_no_truncate;--> statement-breakpoint
ALTER TABLE public.medical_letters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY medical_letters_read ON public.medical_letters FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.medical_letters TO clinic_app;--> statement-breakpoint
CREATE POLICY medical_letters_operator_read ON public.medical_letters FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.medical_letters', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.medical_letters TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER medical_letters_no_truncate BEFORE TRUNCATE ON public.medical_letters FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.medical_letters ENABLE ALWAYS TRIGGER medical_letters_no_truncate;--> statement-breakpoint
ALTER TABLE public.medical_letter_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY medical_letter_versions_read ON public.medical_letter_versions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.medical_letter_versions TO clinic_app;--> statement-breakpoint
CREATE POLICY medical_letter_versions_operator_read ON public.medical_letter_versions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.medical_letter_versions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.medical_letter_versions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER medical_letter_versions_no_truncate BEFORE TRUNCATE ON public.medical_letter_versions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.medical_letter_versions ENABLE ALWAYS TRIGGER medical_letter_versions_no_truncate;--> statement-breakpoint
ALTER TABLE public.medical_letter_corrections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY medical_letter_corrections_read ON public.medical_letter_corrections FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.exam_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.medical_letter_corrections TO clinic_app;--> statement-breakpoint
CREATE POLICY medical_letter_corrections_operator_read ON public.medical_letter_corrections FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.medical_letter_corrections', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.medical_letter_corrections TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER medical_letter_corrections_no_truncate BEFORE TRUNCATE ON public.medical_letter_corrections FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.medical_letter_corrections ENABLE ALWAYS TRIGGER medical_letter_corrections_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.document_templates', 'tenant-shared', 'documents', '{owner,admin_pusat,facility_head,doctor}', 'template_save, template_retire (src/modules/documents)', 'tenant-wide'),
  ('public.document_template_versions', 'tenant-shared', 'documents', '{owner,admin_pusat,facility_head,doctor}', 'template_save, template_retire (src/modules/documents)', 'tenant-wide'),
  ('public.medical_letters', 'clinical', 'documents', '{doctor,facility_head,records_officer}', 'letter_create, letter_save, letter_sign (src/modules/documents)', 'the visit''s branch'),
  ('public.medical_letter_versions', 'clinical', 'documents', '{doctor,facility_head,records_officer}', 'letter_sign, letter_correct, letter_correction_sync (src/modules/documents)', 'the letter''s branch'),
  ('public.medical_letter_corrections', 'clinical', 'documents', '{doctor,facility_head,records_officer}', 'letter_correct, letter_correction_sync (src/modules/documents)', 'the letter''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): templates are configuration (no patient data, refused by the writer);
-- letters are clinical records.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.document_templates', 'config'), ('public.document_template_versions', 'config'),
  ('public.medical_letters', 'clinical'), ('public.medical_letter_versions', 'clinical'), ('public.medical_letter_corrections', 'clinical');--> statement-breakpoint

-- ── Guards: staff_access lock first, ENABLE ALWAYS ─────────────────────────────────────────────────
-- Nothing is ever deleted. Templates: kind, name and author fixed; active → retired once (never back). Template
-- versions (plan r2): body, paper, number and author fixed; state active → retired only; used_at set once and
-- never changed; a no-op update refused. Letters: a draft changes its body only (author, visit, template fixed);
-- signing freezes it (draft → signed once with the signature columns); a signed letter never changes. Letter
-- versions insert-only. Letter corrections: pending → approved | rejected | cancelled once.
CREATE FUNCTION public.documents_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  k text;
  changed text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || (coalesce(n, o) ->> 'tenant_id'), 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'documents are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'document_templates' AND n ->> 'state' <> 'active'
       OR TG_TABLE_NAME = 'document_template_versions' AND (n ->> 'state' <> 'active' OR n ->> 'used_at' IS NOT NULL)
       OR TG_TABLE_NAME = 'medical_letters' AND n ->> 'state' <> 'draft'
       OR TG_TABLE_NAME = 'medical_letter_corrections' AND n ->> 'state' <> 'pending' THEN
      RAISE EXCEPTION 'a document opens in its first state' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  changed := ARRAY(SELECT key FROM jsonb_each(n) WHERE n -> key IS DISTINCT FROM o -> key);
  IF TG_TABLE_NAME = 'medical_letter_versions' THEN
    RAISE EXCEPTION 'letter versions never change' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'document_templates' THEN
    IF NOT changed <@ ARRAY['state','retired_at','retired_by','retired_as'] OR o ->> 'state' <> 'active' OR n ->> 'state' <> 'retired' THEN
      RAISE EXCEPTION 'a template only retires' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'document_template_versions' THEN
    IF cardinality(changed) = 0 OR NOT changed <@ ARRAY['state','used_at']
       OR 'state' = ANY (changed) AND (o ->> 'state' <> 'active' OR n ->> 'state' <> 'retired')
       OR 'used_at' = ANY (changed) AND (o ->> 'used_at' IS NOT NULL OR n ->> 'used_at' IS NULL) THEN
      RAISE EXCEPTION 'a template version is fixed once saved' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'medical_letters' THEN
    IF o ->> 'state' = 'signed' THEN
      RAISE EXCEPTION 'a signed letter changes only by a new version' USING ERRCODE = '42501';
    END IF;
    IF n ->> 'state' = 'draft' AND NOT changed <@ ARRAY['body','updated_at']
       OR n ->> 'state' = 'signed' AND NOT changed <@ ARRAY['state','body','updated_at','signed_at','signed_by','signed_as','content_hash'] THEN
      RAISE EXCEPTION 'a letter keeps its visit, template and author' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'medical_letter_corrections' THEN
    IF o ->> 'state' <> 'pending' OR n ->> 'state' = 'pending' OR NOT changed <@ ARRAY['state','decided_at','version_id'] THEN
      RAISE EXCEPTION 'a letter correction is decided once' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.documents_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER document_templates_guard BEFORE INSERT OR UPDATE OR DELETE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION public.documents_guard();--> statement-breakpoint
ALTER TABLE public.document_templates ENABLE ALWAYS TRIGGER document_templates_guard;--> statement-breakpoint
CREATE TRIGGER document_template_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.document_template_versions FOR EACH ROW EXECUTE FUNCTION public.documents_guard();--> statement-breakpoint
ALTER TABLE public.document_template_versions ENABLE ALWAYS TRIGGER document_template_versions_guard;--> statement-breakpoint
CREATE TRIGGER medical_letters_guard BEFORE INSERT OR UPDATE OR DELETE ON public.medical_letters FOR EACH ROW EXECUTE FUNCTION public.documents_guard();--> statement-breakpoint
ALTER TABLE public.medical_letters ENABLE ALWAYS TRIGGER medical_letters_guard;--> statement-breakpoint
CREATE TRIGGER medical_letter_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.medical_letter_versions FOR EACH ROW EXECUTE FUNCTION public.documents_guard();--> statement-breakpoint
ALTER TABLE public.medical_letter_versions ENABLE ALWAYS TRIGGER medical_letter_versions_guard;--> statement-breakpoint
CREATE TRIGGER medical_letter_corrections_guard BEFORE INSERT OR UPDATE OR DELETE ON public.medical_letter_corrections FOR EACH ROW EXECUTE FUNCTION public.documents_guard();--> statement-breakpoint
ALTER TABLE public.medical_letter_corrections ENABLE ALWAYS TRIGGER medical_letter_corrections_guard;--> statement-breakpoint

-- ── Template writers (UX-54, SET-32; plan open points 4–6, P1-4, P2-1, P2-2) ─────────────────────
-- Owner and admin pusat for every kind; the facility head at its active branch for consent and letter templates.
CREATE FUNCTION public.template_actor(p_kind text, OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF NOT (role IN ('owner','admin_pusat') OR role = 'facility_head' AND p_kind IN ('consent','letter')) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not change this template' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change configuration now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_actor(text) FROM PUBLIC;--> statement-breakpoint

-- Simpan Versi. p: {kind, letter_type?, name, body, paper} for a new template (p_template null) or
-- {body, paper} for a new version of an active one. The new version becomes the active one; the previous active
-- version retires (kept, never changed). Returns {template_id, version_id}.
CREATE FUNCTION public.template_save(p_template uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t public.document_templates;
  a record;
  v_kind text;
  v_paper text := p ->> 'paper';
  v_next integer;
  v_ver uuid;
BEGIN
  -- The actor lock first (DEC-043): an ended actor is refused before any input is read.
  PERFORM public.tenant_actor_lock();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p -> 'body') IS DISTINCT FROM 'string'
     OR p_template IS NULL AND p - 'kind' - 'letter_type' - 'name' - 'body' - 'paper' <> '{}'::jsonb
     OR p_template IS NOT NULL AND p - 'body' - 'paper' <> '{}'::jsonb
     OR length(p ->> 'body') NOT BETWEEN 10 AND 20000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: template' USING ERRCODE = '22023';
  END IF;
  IF p_template IS NULL THEN
    v_kind := p ->> 'kind';
    IF coalesce(v_kind, '') NOT IN ('receipt','consent','letter','legal')
       OR (v_kind = 'letter') <> (p ? 'letter_type') OR p ? 'letter_type' AND coalesce(p ->> 'letter_type', '') NOT IN ('surat_keterangan','rujukan','resume')
       OR jsonb_typeof(p -> 'name') IS DISTINCT FROM 'string' OR length(btrim(p ->> 'name')) NOT BETWEEN 3 AND 120 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: template' USING ERRCODE = '22023';
    END IF;
    a := public.template_actor(v_kind);
  ELSE
    -- The kind is the template's (looked up under the actor's tenant once the lock is held).
    SELECT x.kind INTO v_kind FROM public.document_templates x WHERE x.tenant_id = public.app_tenant_id() AND x.id = p_template;
    a := public.template_actor(coalesce(v_kind, 'receipt'));
    SELECT * INTO t FROM public.document_templates x WHERE x.tenant_id = a.tenant_id AND x.id = p_template FOR UPDATE;
    IF NOT FOUND OR NOT public.template_readable(t.tenant_id, t.kind) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: template not found' USING ERRCODE = 'P0002';
    END IF;
    IF t.state = 'retired' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: template_retired' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF coalesce(v_paper, '') NOT IN ('a4','80mm','58mm') OR v_kind <> 'receipt' AND v_paper <> 'a4' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: paper' USING ERRCODE = '22023';
  END IF;
  PERFORM public.template_check(v_kind, coalesce(btrim(p ->> 'name'), t.name), p ->> 'body');
  IF p_template IS NULL THEN
    INSERT INTO public.document_templates (tenant_id, kind, letter_type, name, created_by, created_as)
    VALUES (a.tenant_id, v_kind, p ->> 'letter_type', btrim(p ->> 'name'), a.staff_id, a.role)
    RETURNING * INTO t;
  END IF;
  UPDATE public.document_template_versions SET state = 'retired' WHERE tenant_id = t.tenant_id AND template_id = t.id AND state = 'active';
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.document_template_versions WHERE tenant_id = t.tenant_id AND template_id = t.id;
  INSERT INTO public.document_template_versions (tenant_id, template_id, kind, version, body, paper, created_by, created_as)
  VALUES (t.tenant_id, t.id, t.kind, v_next, p ->> 'body', v_paper, a.staff_id, a.role)
  RETURNING id INTO v_ver;
  PERFORM public.audit_append('settings_change', 'document_template', t.id, 'success', 'template_saved');
  INSERT INTO public.domain_events (type, aggregate_kind, aggregate_id, payload)
  VALUES ('TemplateSaved', 'document_template', t.id, jsonb_build_object('template_id', t.id, 'version_id', v_ver, 'kind', t.kind));
  RETURN jsonb_build_object('template_id', t.id, 'version_id', v_ver);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_save(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.template_save(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Pensiunkan: no new letters from it; versions and letters kept.
CREATE FUNCTION public.template_retire(p_template uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  t public.document_templates;
BEGIN
  PERFORM public.tenant_actor_lock();
  a := public.template_actor(coalesce((SELECT x.kind FROM public.document_templates x WHERE x.tenant_id = public.app_tenant_id() AND x.id = p_template), 'receipt'));
  SELECT * INTO t FROM public.document_templates x WHERE x.tenant_id = a.tenant_id AND x.id = p_template FOR UPDATE;
  IF NOT FOUND OR NOT public.template_readable(t.tenant_id, t.kind) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: template not found' USING ERRCODE = 'P0002';
  END IF;
  IF t.state = 'retired' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: template_retired' USING ERRCODE = '55000';
  END IF;
  UPDATE public.document_template_versions SET state = 'retired' WHERE tenant_id = t.tenant_id AND template_id = t.id AND state = 'active';
  UPDATE public.document_templates SET state = 'retired', retired_at = clock_timestamp(), retired_by = a.staff_id, retired_as = a.role
   WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.audit_append('settings_change', 'document_template', t.id, 'success', 'template_retired');
  INSERT INTO public.domain_events (type, aggregate_kind, aggregate_id, payload)
  VALUES ('TemplateRetired', 'document_template', t.id, jsonb_build_object('template_id', t.id, 'kind', t.kind));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_retire(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.template_retire(uuid) TO clinic_app;--> statement-breakpoint

-- ── Letter writers (PR-74; plan open points 3, 7, P1-1, P1-3, P2-2) ───────────────────────────────
-- A doctor at the active branch; existing_appointment for create, save and sign.
CREATE FUNCTION public.letter_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role <> 'doctor' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only a doctor writes a letter' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_actor() FROM PUBLIC;--> statement-breakpoint

-- The author's letter at the active branch, locked.
CREATE FUNCTION public.letter_own(a record, p_letter uuid) RETURNS public.medical_letters
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.medical_letters;
BEGIN
  SELECT * INTO l FROM public.medical_letters x WHERE x.tenant_id = a.tenant_id AND x.id = p_letter FOR UPDATE;
  IF NOT FOUND OR l.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(l.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: letter not found' USING ERRCODE = 'P0002';
  END IF;
  IF l.author_id <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the doctor who wrote the letter changes it' USING ERRCODE = '42501';
  END IF;
  RETURN l;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_own(record, uuid) FROM PUBLIC;--> statement-breakpoint

-- A letter body: 10–40 000 characters, every placeholder resolved.
CREATE FUNCTION public.letter_body_ok(p_body text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 10 AND 40000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: body' USING ERRCODE = '22023';
  END IF;
  IF p_body ~ '\{\{|\}\}' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: unresolved_placeholder' USING ERRCODE = '22023';
  END IF;
  RETURN btrim(p_body);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_body_ok(text) FROM PUBLIC;--> statement-breakpoint

-- Buat Surat: a draft from the active version of an active letter template for a visit at the active branch
-- (open, or closed today). When the visit has an examination, only its author writes the letter (its fields
-- fill the placeholders); otherwise any doctor of the branch. The template version is marked used.
CREATE FUNCTION public.letter_create(p_visit uuid, p_template_version uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.letter_actor();
  v public.visits;
  b public.branches;
  e public.examinations;
  tv public.document_template_versions;
  t public.document_templates;
  v_id uuid;
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO b FROM public.branches WHERE tenant_id = v.tenant_id AND id = v.branch_id;
  IF v.closed_at IS NOT NULL AND (v.closed_at AT TIME ZONE b.timezone)::date < (clock_timestamp() AT TIME ZONE b.timezone)::date THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO tv FROM public.document_template_versions x WHERE x.tenant_id = a.tenant_id AND x.id = p_template_version;
  SELECT * INTO t FROM public.document_templates x WHERE x.tenant_id = a.tenant_id AND x.id = tv.template_id;
  IF tv.id IS NULL OR tv.kind <> 'letter' OR tv.state <> 'active' OR t.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: template not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = v.tenant_id AND x.visit_id = v.id;
  IF FOUND AND e.author_id <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the examining doctor writes a letter for this visit' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.medical_letters (tenant_id, branch_id, visit_id, patient_id, examination_id, template_version_id, letter_type, body, author_id)
  VALUES (v.tenant_id, v.branch_id, v.id, public.patient_canonical(v.tenant_id, v.patient_id), e.id, tv.id, t.letter_type,
          public.template_fill(tv.body, public.letter_values(v.tenant_id, v.id, a.staff_id)), a.staff_id)
  RETURNING id INTO v_id;
  -- Used once (plan r2): later letters match no row and leave the version untouched.
  UPDATE public.document_template_versions SET used_at = clock_timestamp() WHERE tenant_id = tv.tenant_id AND id = tv.id AND used_at IS NULL;
  PERFORM public.audit_append('sign', 'medical_letter', v_id, 'success', 'letter_created');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_create(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.letter_create(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- The author edits the draft text.
CREATE FUNCTION public.letter_save(p_letter uuid, p_body text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.letter_actor();
  l public.medical_letters := public.letter_own(a, p_letter);
  v_body text := public.letter_body_ok(p_body);
BEGIN
  IF l.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: signed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.medical_letters SET body = v_body, updated_at = clock_timestamp() WHERE tenant_id = l.tenant_id AND id = l.id;
  PERFORM public.audit_append('sign', 'medical_letter', l.id, 'success', 'letter_saved');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_save(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.letter_save(uuid, text) TO clinic_app;--> statement-breakpoint

-- Tanda Tangani (PR-74): the author with a second factor (the TS layer requires the step-up proof); the body is
-- frozen and becomes version 1. Signing a signed letter returns its first version.
CREATE FUNCTION public.letter_sign(p_letter uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.letter_actor();
  l public.medical_letters;
  v_body text;
  v_hash text;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.auth_user u ON u.id = m.account_id AND u.two_factor_enabled
                  WHERE s.tenant_id = a.tenant_id AND s.id = a.staff_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: second_factor_required' USING ERRCODE = '42501';
  END IF;
  l := public.letter_own(a, p_letter);
  IF l.state = 'signed' THEN
    RETURN (SELECT x.id FROM public.medical_letter_versions x WHERE x.tenant_id = l.tenant_id AND x.letter_id = l.id AND x.version = 1);
  END IF;
  v_body := public.letter_body_ok(l.body);
  v_hash := public.letter_hash(v_body);
  UPDATE public.medical_letters SET state = 'signed', body = v_body, signed_at = clock_timestamp(), signed_by = a.staff_id, signed_as = a.role, content_hash = v_hash
   WHERE tenant_id = l.tenant_id AND id = l.id;
  INSERT INTO public.medical_letter_versions (tenant_id, branch_id, letter_id, version, kind, body, content_hash, created_by, created_as)
  VALUES (l.tenant_id, l.branch_id, l.id, 1, 'original', v_body, v_hash, a.staff_id, a.role)
  RETURNING id INTO v_id;
  UPDATE public.document_template_versions SET used_at = clock_timestamp() WHERE tenant_id = l.tenant_id AND id = l.template_version_id AND used_at IS NULL;
  PERFORM public.audit_append('sign', 'medical_letter', l.id, 'success', 'letter_signed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (l.branch_id, 'LetterSigned', 'medical_letter', l.id,
          jsonb_build_object('letter_id', l.id, 'visit_id', l.visit_id, 'version_id', v_id, 'branch_id', l.branch_id, 'letter_type', l.letter_type));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_sign(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.letter_sign(uuid) TO clinic_app;--> statement-breakpoint

-- Writes version n+1 of a signed letter (direct correction and the approval).
CREATE FUNCTION public.letter_write_version(l public.medical_letters, p_body text, p_reason text, p_by uuid, p_as text, p_approval uuid) RETURNS public.medical_letter_versions
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  cur public.medical_letter_versions := public.letter_current(l.tenant_id, l.id);
  v public.medical_letter_versions;
BEGIN
  IF p_body = cur.body THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: no_change' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.medical_letter_versions (tenant_id, branch_id, letter_id, version, kind, body, content_hash, reason, approval_id, created_by, created_as)
  VALUES (l.tenant_id, l.branch_id, l.id, cur.version + 1, 'correction', p_body, public.letter_hash(p_body), btrim(p_reason), p_approval, p_by, p_as)
  RETURNING * INTO v;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_write_version(public.medical_letters, text, text, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Koreksi (PR-74, open point 7: the T-053 rule): the author within 48 h of signing writes version n+1; later the
-- correction waits for the record_late_correction approval (records officer or facility head).
CREATE FUNCTION public.letter_correct(p_letter uuid, p_body text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  l public.medical_letters;
  v public.medical_letter_versions;
  v_body text := public.letter_body_ok(p_body);
  v_corr uuid;
  v_approval uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'doctor' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only a doctor corrects a letter' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('record_correction') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot correct records now' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  l := public.letter_own(a, p_letter);
  IF l.state <> 'signed' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_signed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.medical_letter_corrections c WHERE c.tenant_id = l.tenant_id AND c.letter_id = l.id AND c.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: correction_pending' USING ERRCODE = '55000';
  END IF;
  IF clock_timestamp() <= l.signed_at + interval '48 hours' THEN
    v := public.letter_write_version(l, v_body, p_reason, a.staff_id, a.role, NULL);
    PERFORM public.audit_append('sign', 'medical_letter', l.id, 'success', 'letter_corrected');
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (l.branch_id, 'LetterCorrected', 'medical_letter', l.id, jsonb_build_object('letter_id', l.id, 'version_id', v.id, 'change', 'direct'));
    RETURN jsonb_build_object('kind', 'version', 'id', v.id);
  END IF;
  IF v_body = (public.letter_current(l.tenant_id, l.id)).body THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: no_change' USING ERRCODE = '22023';
  END IF;
  v_corr := public.uuid_generate_v7();
  v_approval := public.approval_request('record_late_correction', 'letter_correction', v_corr, btrim(p_reason), l.branch_id, NULL);
  INSERT INTO public.medical_letter_corrections (id, tenant_id, branch_id, letter_id, body, reason, approval_id, requested_by, requested_as)
  VALUES (v_corr, l.tenant_id, l.branch_id, l.id, v_body, btrim(p_reason), v_approval, a.staff_id, a.role);
  PERFORM public.audit_append('sign', 'medical_letter', l.id, 'success', 'letter_correction_requested');
  RETURN jsonb_build_object('kind', 'pending', 'id', v_corr, 'approval_id', v_approval);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_correct(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.letter_correct(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- Applies a decided late letter correction (beside record_correction_sync; each acts on its own subject only).
CREATE FUNCTION public.letter_correction_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.medical_letter_corrections;
  l public.medical_letters;
  v public.medical_letter_versions;
  v_state text := NEW.state;
BEGIN
  IF NEW.type <> 'record_late_correction' OR NEW.subject_kind <> 'letter_correction' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM public.medical_letter_corrections WHERE tenant_id = NEW.tenant_id AND approval_id = NEW.id AND state = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_state = 'approved' THEN
    SELECT * INTO l FROM public.medical_letters WHERE tenant_id = c.tenant_id AND id = c.letter_id FOR UPDATE;
    v := public.letter_write_version(l, c.body, c.reason, c.requested_by, c.requested_as, NEW.id);
  ELSIF v_state NOT IN ('rejected','cancelled') THEN
    RETURN NULL;
  END IF;
  UPDATE public.medical_letter_corrections SET state = v_state, decided_at = clock_timestamp(), version_id = CASE WHEN v_state = 'approved' THEN v.id END
   WHERE tenant_id = c.tenant_id AND id = c.id;
  IF public.app_staff_id() IS NOT NULL THEN
    PERFORM public.audit_append('sign', 'medical_letter', c.letter_id, 'success',
            CASE v_state WHEN 'approved' THEN 'letter_corrected' WHEN 'rejected' THEN 'letter_correction_rejected' ELSE 'letter_correction_cancelled' END);
  END IF;
  IF v_state = 'approved' THEN
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (c.tenant_id, c.branch_id, 'LetterCorrected', 'medical_letter', c.letter_id,
            jsonb_build_object('letter_id', c.letter_id, 'version_id', v.id, 'approval_id', NEW.id, 'change', 'approved'));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_correction_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_letter_correction_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.letter_correction_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_letter_correction_sync;--> statement-breakpoint

-- ── Readers (definer; plan open points 2, 6, P1-2, P2-1, P2-2) ─────────────────────────────────────
-- Templates: the kinds the reader may read (template_readable); configuration or clinical_read.
CREATE FUNCTION public.template_reader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','admin_pusat','facility_head','doctor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read document templates' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.tenant_capability('configuration') OR public.tenant_capability('clinical_read')) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: templates are not available now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_reader() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.template_list(p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.template_reader();
BEGIN
  IF p_kind IS NOT NULL AND p_kind NOT IN ('receipt','consent','letter','legal') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kind' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'templates', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'letter_type', t.letter_type, 'name', t.name, 'state', t.state,
             'version', v.version, 'version_id', v.id, 'used', v.used_at IS NOT NULL, 'updated_at', v.created_at)
             ORDER BY t.state, t.kind, t.name, t.id)
      FROM public.document_templates t
      LEFT JOIN public.document_template_versions v ON v.tenant_id = t.tenant_id AND v.template_id = t.id
           AND v.version = (SELECT max(x.version) FROM public.document_template_versions x WHERE x.tenant_id = t.tenant_id AND x.template_id = t.id)
     WHERE t.tenant_id = a.tenant_id AND (p_kind IS NULL OR t.kind = p_kind) AND public.template_readable(t.tenant_id, t.kind)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_list(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.template_list(text) TO clinic_app;--> statement-breakpoint

-- One template with its versions and the placeholder lists; the preview text of a version is rendered from fixed
-- synthetic samples for patient and clinical fields, the tenant's name and NPWP, and the vendor identity (fields
-- still placeholders are marked "(contoh, belum diisi)"); never from patient rows (plan P2-1).
CREATE FUNCTION public.template_get(p_template uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.template_reader();
  t public.document_templates;
  ph record;
  vi jsonb := public.vendor_identity();
  sample jsonb;
  f text;
  k text;
BEGIN
  SELECT * INTO t FROM public.document_templates x WHERE x.tenant_id = a.tenant_id AND x.id = p_template;
  IF NOT FOUND OR NOT public.template_readable(t.tenant_id, t.kind) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: template not found' USING ERRCODE = 'P0002';
  END IF;
  ph := public.template_placeholders(t.kind);
  sample := jsonb_build_object(
    'klinik.nama', (SELECT x.legal_name FROM public.tenants x WHERE x.id = t.tenant_id),
    'klinik.npwp', (SELECT x.npwp FROM public.tenants x WHERE x.id = t.tenant_id),
    'tanggal', to_char((clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date, 'DD-MM-YYYY'),
    'cabang.nama', 'Cabang Contoh', 'cabang.alamat', 'Jl. Contoh No. 1',
    'pasien.nama', 'Pasien Contoh', 'pasien.no_rm', 'RM-CONTOH', 'pasien.tanggal_lahir', '01-01-1990', 'pasien.jenis_kelamin', 'Perempuan',
    'kunjungan.tanggal', to_char((clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date, 'DD-MM-YYYY'),
    'dokter.nama', 'dr. Contoh', 'dokter.sip', 'SIP-CONTOH',
    'pemeriksaan.keluhan', 'Keluhan contoh', 'pemeriksaan.objektif', 'Temuan contoh', 'pemeriksaan.asesmen', 'Asesmen contoh',
    'pemeriksaan.rencana', 'Rencana contoh', 'pemeriksaan.icd10', 'L70.0',
    'struk.nomor', 'INV-CONTOH', 'struk.baris', 'Layanan contoh × 1  Rp100.000', 'struk.total', 'Rp100.000', 'struk.metode_bayar', 'Tunai',
    'tindakan.daftar', 'Tindakan contoh', 'tindakan.risiko', 'Risiko contoh', 'tanda_tangan', '(tanda tangan)');
  -- vendor_identity() keys (0017) under the template's names.
  FOR f, k IN SELECT * FROM (VALUES ('nama','legal_name'), ('nib','nib'), ('pse','pse_number'), ('npwp','npwp'), ('situs','website'),
                                     ('url_privasi','privacy_url'), ('email_dukungan','support_email'), ('telepon_dukungan','support_phone')) m(a, b) LOOP
    sample := sample || jsonb_build_object('vendor.' || f, coalesce(vi ->> k, '')
      || CASE WHEN vi -> 'placeholders' ? k THEN ' (contoh, belum diisi)' ELSE '' END);
  END LOOP;
  RETURN jsonb_build_object('id', t.id, 'kind', t.kind, 'letter_type', t.letter_type, 'name', t.name, 'state', t.state,
    'writable', a.role IN ('owner','admin_pusat') OR a.role = 'facility_head' AND t.kind IN ('consent','letter'),
    'required', to_jsonb(ph.required), 'allowed', to_jsonb(ph.allowed),
    'versions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'state', v.state, 'paper', v.paper, 'body', v.body,
                 'used', v.used_at IS NOT NULL, 'created_at', v.created_at,
                 'created_by_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = v.tenant_id AND s.id = v.created_by),
                 'preview', public.template_fill(v.body, sample)) ORDER BY v.version DESC)
               FROM public.document_template_versions v WHERE v.tenant_id = t.tenant_id AND v.template_id = t.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.template_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.template_get(uuid) TO clinic_app;--> statement-breakpoint

-- Letters: doctor, facility head, records officer of the active branch (exam_readable); clinical_read.
CREATE FUNCTION public.letter_reader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('doctor','facility_head','records_officer') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read letters' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: clinical reads are not available' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_reader() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.letter_row(l public.medical_letters) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', l.id, 'visit_id', l.visit_id, 'patient_id', l.patient_id, 'letter_type', l.letter_type, 'state', l.state,
           'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'author_id', l.author_id,
           'author_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = l.tenant_id AND s.id = l.author_id),
           'template_name', (SELECT t.name FROM public.document_template_versions v JOIN public.document_templates t ON t.tenant_id = v.tenant_id AND t.id = v.template_id
                              WHERE v.tenant_id = l.tenant_id AND v.id = l.template_version_id),
           'created_at', l.created_at, 'signed_at', l.signed_at,
           'version', (SELECT max(v.version) FROM public.medical_letter_versions v WHERE v.tenant_id = l.tenant_id AND v.letter_id = l.id))
    FROM public.patients pt WHERE pt.tenant_id = l.tenant_id AND pt.id = public.patient_canonical(l.tenant_id, l.patient_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_row(public.medical_letters) FROM PUBLIC;--> statement-breakpoint

-- The letters at the active branch: of a patient (merge cluster), of a visit, or the doctor's own recent ones.
CREATE FUNCTION public.letter_list(p_patient uuid, p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.letter_reader();
BEGIN
  RETURN jsonb_build_object('role', a.role, 'letters', coalesce((
    SELECT jsonb_agg(public.letter_row(l) ORDER BY l.created_at DESC, l.id)
      FROM public.medical_letters l
     WHERE l.tenant_id = a.tenant_id AND l.branch_id = a.branch_id AND public.exam_readable(l.tenant_id, l.branch_id)
       AND (p_patient IS NOT NULL AND l.patient_id = ANY (public.patient_cluster(a.tenant_id, public.patient_canonical(a.tenant_id, p_patient)))
            OR p_patient IS NULL AND p_visit IS NOT NULL AND l.visit_id = p_visit
            OR p_patient IS NULL AND p_visit IS NULL AND (a.role <> 'doctor' OR l.author_id = a.staff_id) AND l.created_at > clock_timestamp() - interval '30 days')), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_list(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.letter_list(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- One letter: the draft body, or the signed versions (the current first); pending correction; audited read.
CREATE FUNCTION public.letter_get(p_letter uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.letter_reader();
  l public.medical_letters;
BEGIN
  SELECT * INTO l FROM public.medical_letters x WHERE x.tenant_id = a.tenant_id AND x.id = p_letter;
  IF NOT FOUND OR l.branch_id IS DISTINCT FROM a.branch_id OR NOT public.exam_readable(l.tenant_id, l.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: letter not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('clinical_read', 'medical_letter', l.id, 'success', 'letter_viewed');
  RETURN public.letter_row(l) || jsonb_build_object(
    'branch_name', (SELECT b.name FROM public.branches b WHERE b.tenant_id = l.tenant_id AND b.id = l.branch_id),
    'own', l.author_id = a.staff_id AND a.role = 'doctor',
    'body', CASE WHEN l.state = 'draft' THEN l.body ELSE (public.letter_current(l.tenant_id, l.id)).body END,
    'correctable_direct', l.state = 'signed' AND clock_timestamp() <= l.signed_at + interval '48 hours',
    'pending_correction', EXISTS (SELECT 1 FROM public.medical_letter_corrections c WHERE c.tenant_id = l.tenant_id AND c.letter_id = l.id AND c.state = 'pending'),
    'versions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'kind', v.kind, 'body', v.body, 'reason', v.reason,
                 'created_at', v.created_at, 'approved', v.approval_id IS NOT NULL) ORDER BY v.version DESC)
               FROM public.medical_letter_versions v WHERE v.tenant_id = l.tenant_id AND v.letter_id = l.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.letter_get(uuid) TO clinic_app;--> statement-breakpoint

-- The Buat Surat form: today's visits at the active branch (or the named one) and the active letter templates.
CREATE FUNCTION public.letter_options(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.letter_actor();
  b public.branches;
  today date;
BEGIN
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = a.branch_id;
  today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object('branch_name', b.name,
    'visits', coalesce((
      SELECT jsonb_agg(jsonb_build_object('visit_id', v.id, 'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'checked_in_at', v.checked_in_at,
               'examined_by_other', EXISTS (SELECT 1 FROM public.examinations e WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id AND e.author_id <> a.staff_id))
               ORDER BY v.checked_in_at, v.id)
        FROM public.visits v
        JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id)
       WHERE v.tenant_id = a.tenant_id AND v.branch_id = b.id AND (p_visit IS NULL OR v.id = p_visit)
         AND (v.closed_at IS NULL AND (v.checked_in_at AT TIME ZONE b.timezone)::date = today OR (v.closed_at AT TIME ZONE b.timezone)::date = today)), '[]'::jsonb),
    'templates', coalesce((
      SELECT jsonb_agg(jsonb_build_object('version_id', v.id, 'name', t.name, 'letter_type', t.letter_type) ORDER BY t.letter_type, t.name, t.id)
        FROM public.document_templates t
        JOIN public.document_template_versions v ON v.tenant_id = t.tenant_id AND v.template_id = t.id AND v.state = 'active'
       WHERE t.tenant_id = a.tenant_id AND t.kind = 'letter' AND t.state = 'active'), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.letter_options(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.letter_options(uuid) TO clinic_app;
