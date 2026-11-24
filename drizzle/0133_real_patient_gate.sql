-- T-120 (PR-36, ARCH-9, ARCH-10, PRIV-5, MIG-2; R4) — Residency configuration, deploy-time
-- attestation, dual-marker environment boundary, HYG-024 inconclusive opinion fold-in, and the
-- real-patient gate across patient registration and online booking / hold confirmation.

-- 1. HYG-024 fold-in: allow 'inconclusive' residency opinion outcome on vendor_profile (PRIV-5).
ALTER TABLE public.vendor_profile DROP CONSTRAINT vendor_profile_residency_check;--> statement-breakpoint
ALTER TABLE public.vendor_profile ADD CONSTRAINT vendor_profile_residency_check CHECK (
  (residency_opinion_outcome IS NULL) = (residency_opinion_ref IS NULL)
  AND (residency_opinion_outcome IS NULL) = (residency_opinion_date IS NULL)
  AND (residency_opinion_outcome IS NULL) = (residency_opinion_set_by IS NULL)
  AND (residency_opinion_outcome IS NULL) = (residency_opinion_checksum IS NULL)
  AND (residency_opinion_outcome IS NULL OR residency_opinion_outcome IN ('positive','negative','inconclusive'))
  AND (residency_opinion_checksum IS NULL OR residency_opinion_checksum ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint

-- 2. Deploy/migration-controlled database environment marker (Finding #5).
-- Default when missing or 'production' = production (fail closed). Zero runtime grants.
CREATE TABLE public.platform_environment (
  id smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  deploy_env text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_environment_singleton_check CHECK (id = 1),
  CONSTRAINT platform_environment_env_check CHECK (deploy_env IN ('local','staging','demo','production'))
);--> statement-breakpoint
ALTER TABLE public.platform_environment ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.platform_environment FROM PUBLIC;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.platform_environment', 'platform', 'platform/residency', '{}', 'migration / deploy environment seed', 'none');--> statement-breakpoint

-- 3. Deployed-location attestation bound to release_digest, deployed_locations, config_version, deploy_env (Finding #1).
-- Written solely by deploy/migration owner via residency_attest(); zero runtime grants.
CREATE TABLE public.residency_attestations (
  id smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  release_digest text NOT NULL,
  deployed_locations jsonb NOT NULL DEFAULT '[]'::jsonb,
  deployed_locations_digest text,
  config_version text NOT NULL,
  matched boolean NOT NULL,
  mismatches jsonb NOT NULL DEFAULT '[]'::jsonb,
  deploy_env text NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT residency_attestations_singleton_check CHECK (id = 1),
  CONSTRAINT residency_attestations_release_digest_check CHECK (release_digest ~ '^[0-9a-f]{16,128}$'),
  CONSTRAINT residency_attestations_deployed_check CHECK (jsonb_typeof(deployed_locations) = 'array'),
  CONSTRAINT residency_attestations_deployed_digest_check CHECK ((deployed_locations_digest IS NULL OR deployed_locations_digest ~ '^[0-9a-f]{64}$') AND (NOT matched OR deployed_locations_digest IS NOT NULL)),
  CONSTRAINT residency_attestations_config_version_check CHECK (config_version ~ '^[0-9a-f]{64}$'),
  CONSTRAINT residency_attestations_mismatches_check CHECK (jsonb_typeof(mismatches) = 'array'),
  CONSTRAINT residency_attestations_env_check CHECK (deploy_env IN ('production','staging','demo','local'))
);--> statement-breakpoint
ALTER TABLE public.residency_attestations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.residency_attestations FROM PUBLIC;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.residency_attestations', 'platform', 'platform/residency', '{}', 'residency_attest (src/modules/platform/residency)', 'none');--> statement-breakpoint

-- 4. Private helpers: release digest, runtime residency-config digest, dual-marker production check, and deploy-only locked attester.
CREATE FUNCTION public.residency_release_digest() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN current_setting('app.release_digest', true) ~ '^[0-9a-f]{16,128}$'
    THEN current_setting('app.release_digest', true)
    ELSE NULL
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.residency_release_digest() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.residency_config_digest() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN current_setting('app.residency_config', true) ~ '^[0-9a-f]{64}$'
    THEN current_setting('app.residency_config', true)
    ELSE NULL
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.residency_config_digest() FROM PUBLIC;--> statement-breakpoint

-- Exempt from production real-patient gating ONLY when BOTH app.deploy_env AND platform_environment
-- explicitly indicate a non-production synthetic environment (local/staging/demo). Fail closed otherwise.
CREATE FUNCTION public.residency_is_production() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT (
    public.payment_deploy_env() IN ('local','staging','demo')
    AND EXISTS (
      SELECT 1 FROM public.platform_environment pe
       WHERE pe.id = 1 AND pe.deploy_env IN ('local','staging','demo')
    )
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.residency_is_production() FROM PUBLIC;--> statement-breakpoint

-- Deploy/owner-only attester (never granted to clinic_app, clinic_vendor, or clinic_operator).
-- Locks vendor_profile FOR UPDATE before computing config_version and comparing validated fields
-- NULL-safely (Findings #1, #2).
CREATE FUNCTION public.residency_attest(p_deployed jsonb, p_env text, p_release_digest text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  p public.vendor_profile;
  v_kinds constant text[] := array['database','object_storage','backups','logs','error_tracking'];
  v_seen text[] := '{}';
  el jsonb;
  v_kind text;
  v_prov text;
  v_reg text;
  v_cty text;
  k text;
  d jsonb;
  decl jsonb;
  v_mis jsonb := '[]'::jsonb;
  v_cfg_ver text;
  v_loc_digest text;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: residency_attest runs on an unbound connection' USING ERRCODE = '42501';
  END IF;
  IF p_deployed IS NULL OR jsonb_typeof(p_deployed) IS DISTINCT FROM 'array'
     OR p_env IS NULL OR p_env NOT IN ('production','staging','demo','local')
     OR p_release_digest IS NULL OR p_release_digest !~ '^[0-9a-f]{16,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: residency_attest' USING ERRCODE = '22023';
  END IF;

  -- Validate every deployed element: object, known unique kind, non-null valid provider/region/country.
  FOR el IN SELECT value FROM jsonb_array_elements(p_deployed) LOOP
    IF jsonb_typeof(el) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: residency_attest element must be object' USING ERRCODE = '22023';
    END IF;
    v_kind := el ->> 'kind';
    v_prov := btrim(coalesce(el ->> 'provider', ''));
    v_reg := btrim(coalesce(el ->> 'region', ''));
    v_cty := btrim(coalesce(el ->> 'country', ''));
    IF v_kind IS NULL OR NOT (v_kind = ANY (v_kinds)) OR v_kind = ANY (v_seen)
       OR v_prov !~ '^[\w .-]{2,60}$' OR v_reg !~ '^[\w .-]{2,60}$' OR v_cty !~ '^[A-Z]{2}$' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: residency_attest invalid location' USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || v_kind;
  END LOOP;

  -- Lock vendor_profile FOR UPDATE first so config_version and storage_locations come from one consistent row.
  SELECT * INTO p FROM public.vendor_profile WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: vendor_profile missing' USING ERRCODE = 'P0002';
  END IF;
  v_cfg_ver := encode(sha256(convert_to(p.storage_locations::text, 'UTF8')), 'hex');

  -- Reject any unknown kind declared on vendor_profile.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p.storage_locations, '[]'::jsonb)) x
     WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR coalesce(x ->> 'kind', '') <> ALL (v_kinds)
  ) THEN
    v_mis := v_mis || jsonb_build_object('kind', 'unknown', 'problem', 'invalid_declared');
  END IF;

  FOREACH k IN ARRAY v_kinds LOOP
    SELECT x INTO d FROM jsonb_array_elements(p_deployed) x WHERE x ->> 'kind' = k LIMIT 1;
    SELECT jsonb_agg(x) INTO decl FROM jsonb_array_elements(coalesce(p.storage_locations, '[]'::jsonb)) x WHERE x ->> 'kind' = k;
    IF d IS NULL THEN
      v_mis := v_mis || jsonb_build_object('kind', k, 'problem', 'not_configured');
    ELSIF decl IS NULL THEN
      v_mis := v_mis || jsonb_build_object('kind', k, 'problem', 'undeclared');
    ELSIF jsonb_array_length(decl) > 1 THEN
      v_mis := v_mis || jsonb_build_object('kind', k, 'problem', 'ambiguous');
    ELSIF NULLIF(btrim(coalesce(decl->0->>'provider', '')), '') IS NULL
       OR NULLIF(btrim(coalesce(decl->0->>'region', '')), '') IS NULL
       OR NULLIF(btrim(coalesce(decl->0->>'country', '')), '') IS NULL
       OR lower(btrim(decl->0->>'provider')) IS DISTINCT FROM lower(btrim(d->>'provider'))
       OR lower(btrim(decl->0->>'region')) IS DISTINCT FROM lower(btrim(d->>'region'))
       OR btrim(decl->0->>'country') IS DISTINCT FROM btrim(d->>'country') THEN
      v_mis := v_mis || jsonb_build_object('kind', k, 'problem', 'differs');
    END IF;
  END LOOP;

  IF cardinality(v_seen) = cardinality(v_kinds) THEN
    SELECT encode(
      sha256(
        convert_to(
          string_agg(
            (x ->> 'kind') || '|' || lower(btrim(x ->> 'provider')) || '|' || lower(btrim(x ->> 'region')) || '|' || btrim(x ->> 'country'),
            E'\n' ORDER BY (x ->> 'kind') COLLATE "C"
          ),
          'UTF8'
        )
      ),
      'hex'
    ) INTO v_loc_digest
      FROM jsonb_array_elements(p_deployed) x;
  END IF;

  INSERT INTO public.residency_attestations (id, release_digest, deployed_locations, deployed_locations_digest, config_version, matched, mismatches, deploy_env, attested_at)
  VALUES (1, p_release_digest, p_deployed, v_loc_digest, v_cfg_ver, jsonb_array_length(v_mis) = 0, v_mis, p_env, clock_timestamp())
  ON CONFLICT (id) DO UPDATE SET
    release_digest = EXCLUDED.release_digest,
    deployed_locations = EXCLUDED.deployed_locations,
    deployed_locations_digest = EXCLUDED.deployed_locations_digest,
    config_version = EXCLUDED.config_version,
    matched = EXCLUDED.matched,
    mismatches = EXCLUDED.mismatches,
    deploy_env = EXCLUDED.deploy_env,
    attested_at = EXCLUDED.attested_at;

  RETURN jsonb_build_object(
    'matched', jsonb_array_length(v_mis) = 0,
    'mismatches', v_mis,
    'config_version', v_cfg_ver,
    'release_digest', p_release_digest,
    'deployed_locations_digest', v_loc_digest
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.residency_attest(jsonb, text, text) FROM PUBLIC;--> statement-breakpoint

-- 5. vendor_go_live_blockers (re-created from 0032 with marked inconclusive branch; OD-1 Option B).
CREATE OR REPLACE FUNCTION public.vendor_go_live_blockers() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  p public.vendor_profile;
  out text[] := '{}';
  k text;
BEGIN
  SELECT * INTO p FROM public.vendor_profile WHERE id = 1;
  IF NOT FOUND THEN
    RETURN array['profile_missing'];
  END IF;
  out := out || array(SELECT 'placeholder:' || f FROM unnest(public.vendor_placeholder_fields()) f);
  FOREACH k IN ARRAY array['database','object_storage','backups','logs','error_tracking'] LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.storage_locations) l WHERE l->>'kind' = k) THEN
      out := out || ('storage_undeclared:' || k);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p.storage_locations) l WHERE coalesce(l->>'country', '') <> 'ID') THEN
    IF p.residency_opinion_outcome IS NULL THEN
      out := out || 'residency_opinion_required'::text;
    ELSIF p.residency_opinion_outcome = 'negative' THEN
      out := out || 'residency_opinion_negative'::text;
  -- T-120 ARCH-10 >>
    ELSIF p.residency_opinion_outcome = 'inconclusive' THEN
      out := out || 'residency_opinion_inconclusive'::text;
  -- T-120 ARCH-10 <<
    END IF;
  END IF;
  -- A working maker-checker: an active TOTP-enrolled platform owner, plus another active
  -- TOTP-enrolled vendor finance member (who can request every money kind).
  IF NOT EXISTS (
       SELECT 1 FROM public.vendor_staff po JOIN public.vendor_staff_roles pr ON pr.staff_id = po.id AND pr.role = 'platform_owner'
        WHERE po.state = 'active'
          AND EXISTS (SELECT 1 FROM public.auth_user pu WHERE pu.id = po.account_id AND pu.two_factor_enabled)
          AND EXISTS (SELECT 1 FROM public.vendor_staff mk JOIN public.vendor_staff_roles mr ON mr.staff_id = mk.id
                        JOIN public.auth_user u ON u.id = mk.account_id
                       WHERE mk.id <> po.id AND mk.state = 'active' AND u.two_factor_enabled AND mr.role = 'vendor_finance')) THEN
    out := out || 'vendor_staff_maker_checker'::text;
  END IF;
  RETURN out;
END
$$;--> statement-breakpoint

-- 6. Combined real-patient gate evaluator (wall-clock Jakarta date, release_digest + checksum binding).
CREATE FUNCTION public.real_patient_gate(p_tenant uuid) RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  p public.vendor_profile;
  r public.residency_attestations;
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  v_kinds constant text[] := array['database','object_storage','backups','logs','error_tracking'];
  v_cfg_ver text;
  v_rel text := public.residency_release_digest();
  v_loc text := public.residency_config_digest();
  v_out text[] := '{}';
  v_outside boolean := false;
  v_cnt integer;
  k text;
  ob text;
BEGIN
  SELECT * INTO p FROM public.vendor_profile WHERE id = 1;
  IF NOT FOUND THEN
    RETURN array['vendor:profile_missing'];
  END IF;
  v_cfg_ver := encode(sha256(convert_to(p.storage_locations::text, 'UTF8')), 'hex');

  -- 1. Declared storage locations completeness.
  FOREACH k IN ARRAY v_kinds LOOP
    SELECT count(*)::integer INTO v_cnt FROM jsonb_array_elements(coalesce(p.storage_locations, '[]'::jsonb)) l WHERE l ->> 'kind' = k;
    IF v_cnt = 0 THEN
      v_out := v_out || ('vendor:storage_undeclared:' || k);
    ELSIF v_cnt > 1 THEN
      v_out := v_out || ('vendor:storage_ambiguous:' || k);
    END IF;
  END LOOP;

  -- 2. Deployed-location attestation for production + running APP_RELEASE_DIGEST + running RESIDENCY_* config digest + current config_version.
  SELECT * INTO r FROM public.residency_attestations WHERE id = 1;
  IF NOT FOUND
     OR NOT r.matched
     OR r.deploy_env <> 'production'
     OR r.config_version IS DISTINCT FROM v_cfg_ver
     OR v_rel IS NULL
     OR r.release_digest IS DISTINCT FROM v_rel
     OR v_loc IS NULL
     OR r.deployed_locations_digest IS NULL
     OR r.deployed_locations_digest IS DISTINCT FROM v_loc THEN
    v_out := v_out || 'residency:unattested'::text;
  END IF;

  -- 3. Outside-Indonesia posture: check BOTH declared profile locations AND attested deployed locations.
  v_outside := EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p.storage_locations, '[]'::jsonb)) l
     WHERE coalesce(l ->> 'country', '') <> 'ID'
  ) OR (
    r.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(r.deployed_locations, '[]'::jsonb)) l
       WHERE coalesce(l ->> 'country', '') <> 'ID'
    )
  );

  IF v_outside THEN
    IF p.residency_opinion_outcome IS NULL THEN
      v_out := v_out || 'vendor:residency_opinion_required'::text;
    ELSIF p.residency_opinion_outcome = 'negative' THEN
      v_out := v_out || 'vendor:residency_opinion_negative'::text;
    ELSIF p.residency_opinion_outcome = 'inconclusive' THEN
      v_out := v_out || 'vendor:residency_opinion_inconclusive'::text;
    ELSIF p.residency_opinion_outcome = 'positive' THEN
      -- Finding #4: positive opinion requires approved, unexpired compliance evidence whose
      -- config_version matches storage_locations AND file_sha256 equals residency_opinion_checksum.
      IF NOT EXISTS (
        SELECT 1 FROM public.vendor_evidence_items v
         WHERE v.obligation_key = 'vendor_residency_opinion'
           AND v.state = 'approved'
           AND (v.valid_until IS NULL OR v.valid_until >= v_today)
           AND v.config_version IS NOT DISTINCT FROM v_cfg_ver
           AND v.file_sha256 IS NOT NULL
           AND p.residency_opinion_checksum IS NOT NULL
           AND v.file_sha256 IS NOT DISTINCT FROM p.residency_opinion_checksum
      ) THEN
        v_out := v_out || 'residency:opinion_unapproved'::text;
      END IF;
    END IF;
  END IF;

  -- 4. Vendor obligation (wall-clock Jakarta date).
  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_evidence_items v
     WHERE v.obligation_key = 'vendor_processor_agreement_template'
       AND v.state = 'approved'
       AND (v.valid_until IS NULL OR v.valid_until >= v_today)
  ) THEN
    v_out := v_out || 'obligation:vendor_processor_agreement_template'::text;
  END IF;

  -- 5. Tenant obligations for p_tenant (wall-clock Jakarta date).
  FOREACH ob IN ARRAY array['processor_agreement_signed','dpia','appointment_dpo'] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM public.evidence_items i
        JOIN public.compliance_obligations o ON o.key = i.obligation_key
        JOIN LATERAL (SELECT * FROM public.evidence_approvals x WHERE x.item_id = i.id ORDER BY x.seq DESC LIMIT 1) a ON true
       WHERE i.tenant_id = p_tenant
         AND i.obligation_key = ob
         AND i.state = 'approved'
         AND (i.valid_until IS NULL OR i.valid_until >= v_today)
         AND a.decision = 'approved'
         AND a.file_id = (SELECT f.id FROM public.evidence_files f WHERE f.item_id = i.id ORDER BY f.version DESC LIMIT 1)
         AND a.config_version IS NOT DISTINCT FROM public.compliance_config_version(i.tenant_id, o.config_kind)
    ) THEN
      v_out := v_out || ('obligation:' || ob);
    END IF;
  END LOOP;

  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.real_patient_gate(uuid) FROM PUBLIC;--> statement-breakpoint

-- Authoritative gate assertion called inside real-patient writers.
-- Enforces tenant binding, deterministic lock order (tenant_actor_lock -> vendor_profile ->
-- residency_attestations -> feature_gate_lock), post-lock wall-clock evaluation, and actor re-check (Findings #3, #5).
CREATE FUNCTION public.real_patient_gate_assert(p_tenant uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b text[];
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM public.app_tenant_id() THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: tenant_mismatch' USING ERRCODE = '42501';
  END IF;
  IF NOT public.residency_is_production() THEN
    RETURN;
  END IF;

  -- Deterministic lock order after caller's tenant_actor_lock.
  PERFORM 1 FROM public.vendor_profile WHERE id = 1 FOR SHARE;
  PERFORM 1 FROM public.residency_attestations WHERE id = 1 FOR SHARE;
  PERFORM public.feature_gate_lock('real_patient_go_live');

  -- Re-verify wall-clock actor authority after lock wait (reentrant on already-held staff_access lock).
  IF public.app_staff_id() IS NOT NULL THEN
    PERFORM public.tenant_actor_lock();
  END IF;

  b := public.real_patient_gate(p_tenant);
  IF cardinality(b) > 0 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: real_patient_gate:%', b[1] USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.real_patient_gate_assert(uuid) FROM PUBLIC;--> statement-breakpoint

-- Tenant-bound status reader for Owner / Admin Pusat (Kepatuhan screen).
CREATE FUNCTION public.real_patient_gate_status() RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN public.real_patient_gate(a.tenant_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.real_patient_gate_status() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.real_patient_gate_status() TO clinic_app;--> statement-breakpoint

-- 7. Drift-pinned call sites (patient_register, booking_create, booking_confirm, deposit_receive).
-- Each re-creates its exact prior body with ONE marked -- T-120 ARCH-10 >> ... << block.

CREATE OR REPLACE FUNCTION public.patient_register(p jsonb, p_identity_enc text, p_identity_bidx text, p_decision text) RETURNS jsonb
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
  -- T-120 ARCH-10 >>
  PERFORM public.real_patient_gate_assert(a.tenant_id);
  -- T-120 ARCH-10 <<
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
  -- T-120 ARCH-10 >>
    PERFORM public.real_patient_gate_assert(a.tenant_id);
  -- T-120 ARCH-10 <<
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

CREATE OR REPLACE FUNCTION public.booking_confirm(p_appointment uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  ap public.appointments;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','fo_cashier','central_cs']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not book' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('new_booking') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant does not take new bookings now' USING ERRCODE = '42501';
  END IF;
  PERFORM public.booking_expire_holds(a.tenant_id);
  SELECT * INTO ap FROM public.appointments WHERE tenant_id = a.tenant_id AND id = p_appointment FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: appointment not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.booking_branch(a.tenant_id, a.staff_id, a.role, ap.branch_id);
  IF ap.state <> 'held' THEN -- T-045: any state but a hold
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_booked' USING ERRCODE = '55000';
  END IF;
  IF ap.hold_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: hold_expired' USING ERRCODE = '55000';
  END IF;
  -- T-120 ARCH-10 >>
  IF ap.channel = 'online' THEN
    PERFORM public.real_patient_gate_assert(a.tenant_id);
  END IF;
  -- T-120 ARCH-10 <<
  UPDATE public.appointments SET state = 'booked', hold_until = NULL WHERE tenant_id = a.tenant_id AND id = p_appointment;
  PERFORM public.audit_append('settings_change', 'appointment', p_appointment, 'success', 'appointment_confirmed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (ap.branch_id, 'AppointmentBooked', 'appointment', p_appointment, jsonb_build_object('appointment_id', p_appointment, 'branch_id', ap.branch_id,
          'patient_id', ap.patient_id, 'catalog_version_id', ap.catalog_version_id, 'performer_staff_id', ap.performer_staff_id, 'channel', ap.channel));
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.deposit_receive(p_key text, p_appointment uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  ap public.appointments;
  v public.catalog_versions;
  b public.branches;
  s record;
  v_at timestamptz;
  v_pkp boolean;
  v_split record;
  v_amount bigint;
  v_number text;
  v_receipt uuid;
  v_pay uuid;
  v_id uuid;
  v_patient uuid;
  v_body text;
BEGIN
  -- Roles: kasir_actor admits owner, manager, FO/cashier and finance only (mutation run 1: a second check here was redundant).
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'method' - 'cash_tendered' - 'details' <> '{}'::jsonb
     OR coalesce(p ->> 'method', '') NOT IN ('cash','edc','transfer')
     OR (p ->> 'method' = 'cash') <> (p ? 'cash_tendered')
     OR p ? 'cash_tendered' AND (jsonb_typeof(p -> 'cash_tendered') IS DISTINCT FROM 'number' OR (p ->> 'cash_tendered') !~ '^[1-9]\d{0,12}$')
     OR p ? 'details' AND (p ->> 'method' NOT IN ('edc','transfer') OR jsonb_typeof(p -> 'details') IS DISTINCT FROM 'object'
                           OR (p -> 'details') - 'card_type' - 'bank' - 'trace' - 'approval_code' - 'reference' <> '{}'::jsonb
                           OR EXISTS (SELECT 1 FROM jsonb_each(p -> 'details') d WHERE jsonb_typeof(d.value) <> 'string' OR length(d.value #>> '{}') NOT BETWEEN 1 AND 60)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: deposit' USING ERRCODE = '22023';
  END IF;
  PERFORM public.booking_expire_holds(a.tenant_id);
  SELECT * INTO ap FROM public.appointments x WHERE x.tenant_id = a.tenant_id AND x.id = p_appointment FOR UPDATE;
  IF ap.id IS NULL OR a.branch_id IS NOT NULL AND ap.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: appointment not found' USING ERRCODE = 'P0002';
  END IF;
  -- Idempotent replay: the same key on the same appointment returns the deposit.
  SELECT x.id INTO v_id FROM public.booking_deposits x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.booking_deposits x WHERE x.tenant_id = a.tenant_id AND x.id = v_id AND x.appointment_id = ap.id) THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a deposit with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN (SELECT jsonb_build_object('deposit_id', x.id, 'receipt_id', x.receipt_id, 'number', r.number, 'amount', x.amount, 'change', 0, 'replayed', true)
              FROM public.booking_deposits x JOIN public.receipts r ON r.tenant_id = x.tenant_id AND r.id = x.receipt_id WHERE x.tenant_id = a.tenant_id AND x.id = v_id);
  END IF;
  IF ap.state NOT IN ('held','booked','confirmed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_scheduled' USING ERRCODE = '55000';
  END IF;
  IF ap.state = 'held' AND ap.hold_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: hold_expired' USING ERRCODE = '55000';
  END IF;
  IF ap.state = 'held' AND NOT public.tenant_capability('new_booking') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant does not take new bookings now' USING ERRCODE = '42501';
  END IF;
  -- T-120 ARCH-10 >>
  IF ap.state = 'held' AND ap.channel = 'online' THEN
    PERFORM public.real_patient_gate_assert(a.tenant_id);
  END IF;
  -- T-120 ARCH-10 <<
  IF EXISTS (SELECT 1 FROM public.booking_deposits x WHERE x.tenant_id = a.tenant_id AND x.appointment_id = ap.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: deposit_exists' USING ERRCODE = '55000';
  END IF;
  v_at := clock_timestamp();
  SELECT * INTO v FROM public.catalog_versions x WHERE x.tenant_id = a.tenant_id AND x.id = ap.catalog_version_id;
  SELECT * INTO s FROM public.deposit_setting(ap.branch_id, v_at);
  IF NOT s.enabled OR NOT v.booking_dp_enabled THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: deposit_off' USING ERRCODE = '55000';
  END IF;
  IF NOT public.kasir_method_enabled(p ->> 'method', v_at) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
  END IF;
  v_amount := v.booking_dp_amount;
  IF p ? 'cash_tendered' AND (p ->> 'cash_tendered')::bigint < v_amount THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: cash_tendered' USING ERRCODE = '22023';
  END IF;
  v_pkp := public.tax_pkp_at(a.tenant_id, v_at, ap.branch_id);
  IF v_pkp AND v.tax_category IN ('taxable_service','taxable_goods') THEN
    PERFORM public.feature_gate_lock('vat_on_invoices');
    IF NOT public.feature_gate_open('vat_on_invoices') THEN
      RAISE EXCEPTION 'ERR_GATE_CLOSED: vat_on_invoices' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_split FROM public.tax_vat_split(v_amount, v.tax_category, v_pkp);
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = ap.branch_id;
  v_patient := public.patient_canonical(a.tenant_id, ap.patient_id);
  IF ap.state = 'held' THEN
    UPDATE public.appointments SET state = 'booked', hold_until = NULL WHERE tenant_id = ap.tenant_id AND id = ap.id;
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (a.tenant_id, ap.branch_id, 'AppointmentBooked', 'appointment', ap.id, a.staff_id, a.role, jsonb_build_object('appointment_id', ap.id, 'branch_id', ap.branch_id,
            'patient_id', ap.patient_id, 'catalog_version_id', ap.catalog_version_id, 'performer_staff_id', ap.performer_staff_id, 'channel', ap.channel));
  END IF;
  v_number := public.kasir_next_number(a.tenant_id, b.id, 'KW');
  v_body := (SELECT t.legal_name FROM public.tenants t WHERE t.id = a.tenant_id) || E'\n' || b.name || coalesce(' · ' || b.address, '') || E'\n\nStruk ' || v_number
            || E'\n' || to_char((v_at AT TIME ZONE b.timezone), 'DD-MM-YYYY HH24:MI')
            || E'\n\nDP booking pasien ' || (SELECT pt.mrn FROM public.patients pt WHERE pt.tenant_id = a.tenant_id AND pt.id = v_patient)
            || E'\nJadwal ' || to_char((ap.starts_at AT TIME ZONE b.timezone), 'DD-MM-YYYY HH24:MI')
            || E'\n\nTotal dibayar Rp' || replace(to_char(v_amount, 'FM999G999G999G999'), ',', '.')
            || CASE WHEN v_split.vat > 0 THEN E'\nTermasuk PPN Rp' || replace(to_char(v_split.vat, 'FM999G999G999G999'), ',', '.') ELSE '' END
            || E'\n' || CASE p ->> 'method' WHEN 'cash' THEN 'Tunai' WHEN 'edc' THEN 'EDC' ELSE 'Transfer' END || ' Rp' || replace(to_char(v_amount, 'FM999G999G999G999'), ',', '.');
  BEGIN
    INSERT INTO public.receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, is_simulated, command_key, issued_by, issued_as, issued_at)
    VALUES (a.tenant_id, b.id, NULL, v_number, v_amount, v_body, '80mm', false, p_key, a.staff_id, a.role, v_at)
    RETURNING id INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
  END;
  INSERT INTO public.booking_deposits (tenant_id, branch_id, appointment_id, patient_id, catalog_version_id, receipt_id, method, amount, tax_category,
                                       is_pkp_at_receipt, vat_base, vat_amount, vat_recognised_amount, cutoff_hours, command_key, received_by, received_as, received_at)
  VALUES (a.tenant_id, b.id, ap.id, v_patient, v.id, v_receipt, p ->> 'method', v_amount, v.tax_category, v_pkp, v_split.base, v_split.vat, v_split.vat,
          s.cutoff_hours, p_key, a.staff_id, a.role, v_at)
  RETURNING id INTO v_id;
  INSERT INTO public.payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                               environment, is_simulated, received_by, received_as, received_at)
  VALUES (a.tenant_id, b.id, v_receipt, 1, NULL, v_patient, p ->> 'method', v_amount, (p ->> 'cash_tendered')::bigint,
          CASE WHEN p ? 'cash_tendered' THEN (p ->> 'cash_tendered')::bigint - v_amount END, p -> 'details', 'production', false, a.staff_id, a.role, v_at)
  RETURNING id INTO v_pay;
  INSERT INTO public.payment_allocations (tenant_id, branch_id, payment_id, booking_deposit_id, amount, vat_portion, method, environment, is_simulated)
  VALUES (a.tenant_id, b.id, v_pay, v_id, v_amount, v_split.vat, p ->> 'method', 'production', false);
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (a.tenant_id, b.id, 'PaymentReceived', 'payment', v_pay, a.staff_id, a.role, jsonb_build_object('payment_id', v_pay, 'deposit_id', v_id)),
         (a.tenant_id, b.id, 'BookingDepositReceived', 'booking_deposit', v_id, a.staff_id, a.role, jsonb_build_object('deposit_id', v_id, 'appointment_id', ap.id, 'payment_id', v_pay));
  PERFORM public.audit_append('money_correction', 'booking_deposit', v_id, 'success', 'booking_deposit_received');
  RETURN jsonb_build_object('deposit_id', v_id, 'receipt_id', v_receipt, 'number', v_number, 'amount', v_amount,
                            'change', CASE WHEN p ? 'cash_tendered' THEN (p ->> 'cash_tendered')::bigint - v_amount ELSE 0 END, 'replayed', false);
END
$$;
