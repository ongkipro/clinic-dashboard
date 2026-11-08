CREATE TABLE "contact_points" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_points_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "contact_points_kind_check" CHECK ("contact_points"."kind" in ('phone')),
	CONSTRAINT "contact_points_phone_check" CHECK ("contact_points"."kind" <> 'phone' or "contact_points"."value" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"guardian_name" text NOT NULL,
	"relation" text NOT NULL,
	"phone" text,
	"guardian_patient_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardians_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "guardians_name_check" CHECK (length(btrim("guardians"."guardian_name")) between 2 and 120),
	CONSTRAINT "guardians_relation_check" CHECK ("guardians"."relation" in ('ayah','ibu','wali','lainnya')),
	CONSTRAINT "guardians_phone_check" CHECK ("guardians"."phone" is null or "guardians"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "guardians_self_check" CHECK ("guardians"."guardian_patient_id" is null or "guardians"."guardian_patient_id" <> "guardians"."patient_id")
);
--> statement-breakpoint
CREATE TABLE "patient_mrn_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" bigint NOT NULL,
	CONSTRAINT "patient_mrn_counters_seq_check" CHECK ("patient_mrn_counters"."last_seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mrn" text NOT NULL,
	"full_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"sex" text NOT NULL,
	"identity_type" text NOT NULL,
	"identity_enc" text,
	"identity_bidx" text,
	"no_identity_reason" text,
	"religion" text NOT NULL,
	"occupation" text NOT NULL,
	"education" text NOT NULL,
	"marital_status" text NOT NULL,
	"address" text,
	"ihs_patient_id" text,
	"registered_branch_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "patients_tenant_mrn_key" UNIQUE("tenant_id","mrn"),
	CONSTRAINT "patients_mrn_check" CHECK ("patients"."mrn" ~ '^RM-[0-9]{6,}$'),
	CONSTRAINT "patients_name_check" CHECK (length(btrim("patients"."full_name")) between 2 and 120),
	CONSTRAINT "patients_birth_check" CHECK ("patients"."birth_date" >= date '1900-01-01'),
	CONSTRAINT "patients_sex_check" CHECK ("patients"."sex" in ('female','male')),
	CONSTRAINT "patients_identity_check" CHECK (("patients"."identity_type" = 'nik' and "patients"."identity_enc" is not null and "patients"."identity_bidx" is not null and "patients"."no_identity_reason" is null)
      or ("patients"."identity_type" in ('passport','kitas') and "patients"."identity_enc" is not null and "patients"."identity_bidx" is not null and length(btrim(coalesce("patients"."no_identity_reason", ''))) between 3 and 300)
      or ("patients"."identity_type" = 'newborn_via_guardian' and "patients"."identity_enc" is null and "patients"."identity_bidx" is null and length(btrim(coalesce("patients"."no_identity_reason", ''))) between 3 and 300)),
	CONSTRAINT "patients_identity_enc_check" CHECK ("patients"."identity_enc" is null or "patients"."identity_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
	CONSTRAINT "patients_identity_bidx_check" CHECK ("patients"."identity_bidx" is null or "patients"."identity_bidx" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "patients_social_check" CHECK ("patients"."religion" in ('islam','kristen','katolik','hindu','buddha','konghucu','lainnya')
      and "patients"."education" in ('tidak_sekolah','sd','smp','sma','diploma','s1','s2','s3','lainnya')
      and "patients"."marital_status" in ('belum_kawin','kawin','cerai_hidup','cerai_mati')
      and length(btrim("patients"."occupation")) between 2 and 80),
	CONSTRAINT "patients_address_check" CHECK ("patients"."address" is null or length("patients"."address") <= 300)
);
--> statement-breakpoint
CREATE TABLE "tenant_data_keys" (
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"wrapped" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_data_keys_tenant_id_version_pk" PRIMARY KEY("tenant_id","version"),
	CONSTRAINT "tenant_data_keys_version_check" CHECK ("tenant_data_keys"."version" >= 1),
	CONSTRAINT "tenant_data_keys_wrapped_check" CHECK ("tenant_data_keys"."wrapped" ~ '^k1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_tenant_id_patient_id_patients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_patient_id_patients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_guardian_patient_id_patients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","guardian_patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_mrn_counters" ADD CONSTRAINT "patient_mrn_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_registered_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","registered_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_data_keys" ADD CONSTRAINT "tenant_data_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_points_one_primary" ON "contact_points" USING btree ("tenant_id","patient_id","kind") WHERE "contact_points"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "patients_tenant_identity_key" ON "patients" USING btree ("tenant_id","identity_bidx") WHERE "patients"."identity_bidx" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_data_keys_one_current" ON "tenant_data_keys" USING btree ("tenant_id") WHERE "tenant_data_keys"."is_current";;--> statement-breakpoint

-- T-037 rules (generated; see header)
-- T-037 (PR-5, DATA-8, DATA-13; plan docs/tasks/T-037.md): patient registration with the identity number
-- encrypted under the tenant data key, a blind index for lookup, a guardian for minors, and duplicates
-- resolved by explicit decision. The identity number never reaches the database in clear.

-- ── Tenant data keys (DATA-8, ARCH-7) ──────────────────────────────────────────────────────
-- Platform tables: RLS on, no grants. The app reaches them only through the two definers below.
ALTER TABLE public.tenant_data_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.patient_mrn_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.tenant_data_keys', 'platform', 'patients', '{}', 'tenant_data_key_ensure (src/lib/keys/runtime.ts)', 'none'),
  ('public.patient_mrn_counters', 'platform', 'patients', '{}', 'patient_register', 'none');--> statement-breakpoint
CREATE FUNCTION public.tenant_data_keys_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'tenant data keys are written once and never changed here' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_data_keys_guard() FROM PUBLIC;--> statement-breakpoint
-- Rotation tooling (later, DEC-031 D10) will replace this guard deliberately; until then a wrapped key
-- is never edited or deleted, so no field value can lose the key that opens it.
CREATE TRIGGER tenant_data_keys_guard BEFORE UPDATE OR DELETE ON public.tenant_data_keys FOR EACH ROW EXECUTE FUNCTION public.tenant_data_keys_guard();--> statement-breakpoint
ALTER TABLE public.tenant_data_keys ENABLE ALWAYS TRIGGER tenant_data_keys_guard;--> statement-breakpoint
CREATE TRIGGER tenant_data_keys_no_truncate BEFORE TRUNCATE ON public.tenant_data_keys FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- The caller's own tenant's wrapped data keys (useless without the KEK). Any active member: decrypting
-- for display is decided by the readers that call it.
CREATE FUNCTION public.tenant_data_keys_for() RETURNS TABLE (version integer, wrapped text, is_current boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT k.version, k.wrapped, k.is_current FROM public.tenant_data_keys k
   WHERE k.tenant_id = public.app_tenant_id() AND public.app_staff_id() IS NOT NULL
   ORDER BY k.version
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_data_keys_for() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tenant_data_keys_for() TO clinic_app;--> statement-breakpoint

-- First encrypted write of a tenant (plan r1 open point 1): stores version 1 if the tenant has no key
-- yet and returns the stored (winning) row; the app encrypts only with the returned key. Registrars
-- only (the one writer of encrypted fields today).
CREATE FUNCTION public.tenant_data_key_ensure(p_wrapped text) RETURNS TABLE (version integer, wrapped text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['fo_cashier','central_cs']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not create tenant data keys' USING ERRCODE = '42501';
  END IF;
  BEGIN
    INSERT INTO public.tenant_data_keys (tenant_id, version, wrapped, is_current) VALUES (a.tenant_id, 1, p_wrapped, true)
      ON CONFLICT DO NOTHING;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: malformed wrapped key' USING ERRCODE = '22023';
  END;
  RETURN QUERY SELECT k.version, k.wrapped FROM public.tenant_data_keys k WHERE k.tenant_id = a.tenant_id AND k.is_current;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_data_key_ensure(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tenant_data_key_ensure(text) TO clinic_app;--> statement-breakpoint

-- ── Patients: readers (PR-5, 07 "Patient identity", TEN-18; plan r1 P1-3) ──────────────────
-- The 13 non-marketing identity roles read; marketing reads through a consent-filtered view later
-- (T-038). clinic_app never selects identity_enc or identity_bidx (column grant).
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patients_read ON public.patients FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']));--> statement-breakpoint
GRANT SELECT (id, tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education,
  marital_status, address, ihs_patient_id, registered_branch_id, created_by, created_as, created_at) ON public.patients TO clinic_app;--> statement-breakpoint
ALTER TABLE public.contact_points ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY contact_points_read ON public.contact_points FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']));--> statement-breakpoint
GRANT SELECT ON public.contact_points TO clinic_app;--> statement-breakpoint
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY guardians_read ON public.guardians FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']));--> statement-breakpoint
GRANT SELECT ON public.guardians TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.patients', 'tenant-shared', 'patients', '{owner,admin_pusat,manager,facility_head,records_officer,fo_cashier,central_cs,bc,doctor,nurse,therapist,pharmacist,finance}', 'patient_register (src/modules/patients)', 'none'),
  ('public.contact_points', 'tenant-shared', 'patients', '{owner,admin_pusat,manager,facility_head,records_officer,fo_cashier,central_cs,bc,doctor,nurse,therapist,pharmacist,finance}', 'patient_register (src/modules/patients)', 'none'),
  ('public.guardians', 'tenant-shared', 'patients', '{owner,admin_pusat,manager,facility_head,records_officer,fo_cashier,central_cs,bc,doctor,nurse,therapist,pharmacist,finance}', 'patient_register (src/modules/patients)', 'none');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): patient identity is personal (Owner approval first).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.patients', 'personal'), ('public.contact_points', 'personal'), ('public.guardians', 'personal');--> statement-breakpoint
CREATE POLICY patients_operator_read ON public.patients FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.patients', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education,
  marital_status, address, ihs_patient_id, registered_branch_id, created_by, created_as, created_at) ON public.patients TO clinic_operator;--> statement-breakpoint
CREATE POLICY contact_points_operator_read ON public.contact_points FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.contact_points', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.contact_points TO clinic_operator;--> statement-breakpoint
CREATE POLICY guardians_operator_read ON public.guardians FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.guardians', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.guardians TO clinic_operator;--> statement-breakpoint

-- ── Guards: never deleted (PRIV-3, S-05); corrections are a later task ─────────────────────
CREATE FUNCTION public.patients_rows_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'patient records are never deleted or rewritten here' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patients_rows_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER patients_guard BEFORE UPDATE OR DELETE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.patients_rows_guard();--> statement-breakpoint
ALTER TABLE public.patients ENABLE ALWAYS TRIGGER patients_guard;--> statement-breakpoint
CREATE TRIGGER patients_no_truncate BEFORE TRUNCATE ON public.patients FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER contact_points_guard BEFORE UPDATE OR DELETE ON public.contact_points FOR EACH ROW EXECUTE FUNCTION public.patients_rows_guard();--> statement-breakpoint
ALTER TABLE public.contact_points ENABLE ALWAYS TRIGGER contact_points_guard;--> statement-breakpoint
CREATE TRIGGER contact_points_no_truncate BEFORE TRUNCATE ON public.contact_points FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER guardians_guard BEFORE UPDATE OR DELETE ON public.guardians FOR EACH ROW EXECUTE FUNCTION public.patients_rows_guard();--> statement-breakpoint
ALTER TABLE public.guardians ENABLE ALWAYS TRIGGER guardians_guard;--> statement-breakpoint
CREATE TRIGGER guardians_no_truncate BEFORE TRUNCATE ON public.guardians FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- ── Phone normalisation (plan r1 P2-1): the same rule in TS (src/modules/patients/phone.ts) ──
-- Digits only; a leading 0 or 62 becomes +62; anything else must already be +<country>. Null when the
-- result is not E.164.
CREATE FUNCTION public.patient_phone_norm(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN v ~ '^\+[1-9][0-9]{7,14}$' THEN v END
    FROM (SELECT CASE
                   WHEN d ~ '^0' THEN '+62' || substr(d, 2)
                   WHEN d ~ '^62' THEN '+' || d
                   WHEN btrim(coalesce(p, '')) ~ '^\+' THEN '+' || d
                   ELSE NULL END AS v
            FROM (SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') AS d) x) y
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_phone_norm(text) FROM PUBLIC;--> statement-breakpoint

-- The minimal match projection (PR-76, PR-5): id, MRN, name, birth year, masked phone. Never identity,
-- address, clinical data or the full phone.
CREATE FUNCTION public.patient_match_rows(p_tenant uuid, p_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'mrn', p.mrn, 'full_name', p.full_name,
                                               'birth_year', extract(year FROM p.birth_date)::int,
                                               'masked_phone', (SELECT left(c.value, 3) || repeat('•', greatest(length(c.value) - 7, 0)) || right(c.value, 4)
                                                                  FROM public.contact_points c
                                                                 WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.is_primary))
                            ORDER BY p.full_name, p.mrn), '[]'::jsonb)
    FROM public.patients p WHERE p.tenant_id = p_tenant AND p.id = ANY (p_ids)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_match_rows(uuid, uuid[]) FROM PUBLIC;--> statement-breakpoint

-- Cari dulu (19:53): by phone, name (optionally with birth date), MRN, or the identity blind index;
-- at most 20 patients, minimal projection. FO and CS only.
CREATE FUNCTION public.patient_matches(p_phone text, p_name text, p_birth date, p_mrn text, p_identity_bidx text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_phone text := public.patient_phone_norm(p_phone);
  v_ids uuid[];
BEGIN
  IF v_tenant IS NULL OR public.app_staff_id() IS NULL OR NOT public.app_role_in(ARRAY['fo_cashier','central_cs']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not search patients for registration' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT p.id FROM public.patients p
     WHERE p.tenant_id = v_tenant AND (
           (v_phone IS NOT NULL AND EXISTS (SELECT 1 FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.value = v_phone))
        OR (length(btrim(coalesce(p_name, ''))) >= 2 AND p_birth IS NOT NULL AND lower(btrim(p.full_name)) = lower(btrim(p_name)) AND p.birth_date = p_birth)
        OR (length(btrim(coalesce(p_name, ''))) >= 2 AND p_birth IS NULL AND p.full_name ILIKE '%' || replace(replace(replace(btrim(p_name), '\', '\\'), '%', '\%'), '_', '\_') || '%')
        OR (p_mrn IS NOT NULL AND p.mrn = upper(btrim(p_mrn)))
        OR (p_identity_bidx IS NOT NULL AND p.identity_bidx = p_identity_bidx))
     ORDER BY p.full_name, p.mrn LIMIT 20) m;
  RETURN public.patient_match_rows(v_tenant, coalesce(v_ids, '{}'));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_matches(text, text, date, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patient_matches(text, text, date, text, text) TO clinic_app;--> statement-breakpoint

-- ── patient_register (PR-5; plan r1 P1-1, P1-2, P1-4, P1-5, P2-1) ──────────────────────────
-- FO/cashier or central CS register a patient at the active branch (or, on "Semua Cabang", the branch
-- they choose). The identity number arrives encrypted (identity_enc, v1.) with its blind index; the
-- database never sees it in clear. Live tenants only (tenant_capability 'new_booking': PR-56, TEN-12).
-- Returns {"ok":true,"patient_id","mrn"}, or {"ok":false,"code":"duplicate_identity"|
-- "duplicate_decision_required","matches":[...]} (nothing written). A refused registration consumes
-- no MRN. Audited settings_change / patient_registered; event PatientRegistered (ids only).
CREATE FUNCTION public.patient_register(p jsonb, p_identity_enc text, p_identity_bidx text, p_decision text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  f jsonb := coalesce(p, '{}'::jsonb);
  v_branch uuid;
  v_tz text;
  v_today date;
  v_birth date;
  v_type text := f ->> 'identity_type';
  v_phone text;
  v_minor boolean;
  v_guardian jsonb := f -> 'guardian';
  v_gphone text;
  v_ids uuid[];
  v_seq bigint;
  v_id uuid := public.uuid_generate_v7();
  v_mrn text;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['fo_cashier','central_cs']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not register patients' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('new_booking') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant does not take new patients now' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(f) <> 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: fields must be an object' USING ERRCODE = '22023';
  END IF;
  -- The registration branch: the active one, else the chosen one (central CS on Semua Cabang).
  IF NULLIF(f ->> 'branch_id', '') IS NOT NULL AND f ->> 'branch_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  v_branch := coalesce(a.branch_id, NULLIF(f ->> 'branch_id', '')::uuid);
  IF a.branch_id IS NOT NULL AND NULLIF(f ->> 'branch_id', '') IS NOT NULL AND (f ->> 'branch_id')::uuid <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: registration for another branch' USING ERRCODE = '42501';
  END IF;
  SELECT timezone INTO v_tz FROM public.branches WHERE tenant_id = a.tenant_id AND id = v_branch;
  IF v_branch IS NULL OR v_tz IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  v_today := (clock_timestamp() AT TIME ZONE v_tz)::date;
  BEGIN
    v_birth := (f ->> 'birth_date')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: birth date' USING ERRCODE = '22023';
  END;
  IF v_birth IS NULL OR v_birth < date '1900-01-01' OR v_birth > v_today THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: birth date' USING ERRCODE = '22023';
  END IF;
  v_minor := v_birth > (v_today - interval '18 years')::date;
  v_phone := public.patient_phone_norm(f ->> 'phone');
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: phone' USING ERRCODE = '22023';
  END IF;
  -- Identity: encrypted value and index for nik/passport/kitas; none for a newborn (table checks too).
  IF v_type IN ('nik','passport','kitas') THEN
    IF p_identity_enc IS NULL OR p_identity_bidx IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: identity number required' USING ERRCODE = '22023';
    END IF;
  ELSIF v_type = 'newborn_via_guardian' THEN
    IF p_identity_enc IS NOT NULL OR p_identity_bidx IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: a newborn has no identity number' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'ERR_INVALID_INPUT: identity type' USING ERRCODE = '22023';
  END IF;
  -- A guardian for a minor and a newborn (UU 35/2014; plan r1 open point 5); optional otherwise.
  IF (v_minor OR v_type = 'newborn_via_guardian') AND (v_guardian IS NULL OR jsonb_typeof(v_guardian) <> 'object') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: guardian_required' USING ERRCODE = '22023';
  END IF;
  IF v_guardian IS NOT NULL AND jsonb_typeof(v_guardian) = 'object' THEN
    v_gphone := CASE WHEN NULLIF(v_guardian ->> 'phone', '') IS NULL THEN NULL ELSE public.patient_phone_norm(v_guardian ->> 'phone') END;
    IF NULLIF(v_guardian ->> 'phone', '') IS NOT NULL AND v_gphone IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: guardian phone' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_decision IS NOT NULL AND p_decision <> 'new' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: decision' USING ERRCODE = '22023';
  END IF;
  -- Review r1 P3-3: the remaining required fields are checked before any duplicate pause, so a pause is
  -- never followed by a refusal of fields the user already entered.
  IF f ->> 'sex' IS DISTINCT FROM 'female' AND f ->> 'sex' IS DISTINCT FROM 'male'
     OR coalesce(f ->> 'religion', '') NOT IN ('islam','kristen','katolik','hindu','buddha','konghucu','lainnya')
     OR coalesce(f ->> 'education', '') NOT IN ('tidak_sekolah','sd','smp','sma','diploma','s1','s2','s3','lainnya')
     OR coalesce(f ->> 'marital_status', '') NOT IN ('belum_kawin','kawin','cerai_hidup','cerai_mati')
     OR length(btrim(coalesce(f ->> 'occupation', ''))) NOT BETWEEN 2 AND 80
     OR length(btrim(coalesce(f ->> 'full_name', ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: required_fields' USING ERRCODE = '22023';
  END IF;
  -- The same identity in the tenant: never a second record (PR-5); offer the existing one.
  IF p_identity_bidx IS NOT NULL THEN
    SELECT array_agg(id) INTO v_ids FROM public.patients WHERE tenant_id = a.tenant_id AND identity_bidx = p_identity_bidx;
    IF v_ids IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'duplicate_identity', 'matches', public.patient_match_rows(a.tenant_id, v_ids));
    END IF;
  END IF;
  -- The same phone, or the same name and birth date: an explicit decision (UX-4, no auto-merge).
  IF p_decision IS DISTINCT FROM 'new' THEN
    SELECT array_agg(id) INTO v_ids FROM (
      SELECT p.id FROM public.patients p
       WHERE p.tenant_id = a.tenant_id
         AND (EXISTS (SELECT 1 FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.value = v_phone)
              OR (lower(btrim(p.full_name)) = lower(btrim(f ->> 'full_name')) AND p.birth_date = v_birth))
       ORDER BY p.full_name, p.mrn LIMIT 20) m;
    IF v_ids IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'duplicate_decision_required', 'matches', public.patient_match_rows(a.tenant_id, v_ids));
    END IF;
  END IF;
  -- The MRN, gap-free per tenant, taken after every check (19:340).
  INSERT INTO public.patient_mrn_counters (tenant_id, last_seq) VALUES (a.tenant_id, 1)
    ON CONFLICT (tenant_id) DO UPDATE SET last_seq = public.patient_mrn_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;
  v_mrn := 'RM-' || lpad(v_seq::text, 6, '0');
  BEGIN
    INSERT INTO public.patients (id, tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, no_identity_reason,
        religion, occupation, education, marital_status, address, registered_branch_id, created_by, created_as)
    VALUES (v_id, a.tenant_id, v_mrn, btrim(f ->> 'full_name'), v_birth, f ->> 'sex', v_type, p_identity_enc, p_identity_bidx,
        NULLIF(btrim(f ->> 'no_identity_reason'), ''), f ->> 'religion', btrim(f ->> 'occupation'), f ->> 'education', f ->> 'marital_status',
        NULLIF(btrim(f ->> 'address'), ''), v_branch, a.staff_id, a.role);
    INSERT INTO public.contact_points (tenant_id, patient_id, kind, value, is_primary) VALUES (a.tenant_id, v_id, 'phone', v_phone, true);
    IF v_guardian IS NOT NULL AND jsonb_typeof(v_guardian) = 'object' THEN
      INSERT INTO public.guardians (tenant_id, patient_id, guardian_name, relation, phone, guardian_patient_id)
      VALUES (a.tenant_id, v_id, btrim(v_guardian ->> 'name'), v_guardian ->> 'relation', v_gphone, NULLIF(v_guardian ->> 'patient_id', '')::uuid);
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the identity was registered meanwhile' USING ERRCODE = '23505';
    WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_text_representation THEN
      -- The message names the constraint only (never a value: SQLERRM of a check can quote one).
      DECLARE v_c text;
      BEGIN
        GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
        RAISE EXCEPTION 'ERR_INVALID_INPUT: %', coalesce(NULLIF(v_c, ''), 'invalid value') USING ERRCODE = '22023';
      END;
  END;
  PERFORM public.audit_append('settings_change', 'patient', v_id, 'success', 'patient_registered');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v_branch, 'PatientRegistered', 'patient', v_id, jsonb_build_object('patient_id', v_id, 'branch_id', v_branch));
  RETURN jsonb_build_object('ok', true, 'patient_id', v_id, 'mrn', v_mrn);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_register(jsonb, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patient_register(jsonb, text, text, text) TO clinic_app;--> statement-breakpoint

-- ── patient_get (scenario PR-1; plan r1 open point 4, P1-1) ────────────────────────────────
-- One patient of the caller's tenant for an identity reader, or null. Every not-found (another tenant's
-- id or an unknown one, indistinguishable) and every refused role is audited in the caller's own chain
-- and answered with null, never an exception, so the audit row commits.
CREATE FUNCTION public.patient_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  r jsonb;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']) THEN
    PERFORM public.audit_append('access_denied', 'patient', p_id, 'denied', 'role_forbidden');
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object('id', p.id, 'mrn', p.mrn, 'full_name', p.full_name, 'birth_date', p.birth_date, 'sex', p.sex,
                            'identity_type', p.identity_type, 'religion', p.religion, 'occupation', p.occupation, 'education', p.education,
                            'marital_status', p.marital_status, 'address', p.address, 'registered_branch_id', p.registered_branch_id,
                            'created_at', p.created_at,
                            'phone', (SELECT c.value FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.is_primary),
                            'guardians', coalesce((SELECT jsonb_agg(jsonb_build_object('name', g.guardian_name, 'relation', g.relation, 'phone', g.phone) ORDER BY g.created_at)
                                                    FROM public.guardians g WHERE g.tenant_id = p.tenant_id AND g.patient_id = p.id), '[]'::jsonb))
    INTO r FROM public.patients p WHERE p.tenant_id = a.tenant_id AND p.id = p_id;
  IF r IS NULL THEN
    PERFORM public.audit_append('access_denied', 'patient', p_id, 'denied', 'patient_not_found');
  END IF;
  RETURN r;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patient_get(uuid) TO clinic_app;
