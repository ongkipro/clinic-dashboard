-- DEC-117 Row 2a P2 & Row 4 P2/P3 hardening:
-- 1. DB-backed pending vs failed state on auth_login_failure (shared across all app instances).
-- 2. SEC-16 post-auth refusal audit + whitespace-only template body guard on vendor console functions.

ALTER TABLE public.auth_login_failure
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'pending';--> statement-breakpoint
UPDATE public.auth_login_failure SET state = 'failed' WHERE state = 'pending';--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'auth_login_failure_state_check'
       AND conrelid = 'public.auth_login_failure'::regclass
  ) THEN
    ALTER TABLE public.auth_login_failure
      ADD CONSTRAINT auth_login_failure_state_check CHECK (state IN ('pending', 'failed'));
  END IF;
END
$$;--> statement-breakpoint

-- 1. Trim all ASCII whitespace (space, tab, CR, LF) before enforcing minimum 20-char legal template body length.
CREATE OR REPLACE FUNCTION public._vendor_validate_template_body(p_body text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_stripped text;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body, E' \t\r\n')) < 20 OR length(p_body) > 50000 THEN
    RETURN false;
  END IF;
  IF p_body ~ '[<>]' THEN
    RETURN false;
  END IF;
  v_stripped := regexp_replace(
    p_body,
    '\{\{(klinik\.(nama|alamat|kontak|email)|vendor\.nama)\}\}',
    '',
    'g'
  );
  RETURN v_stripped !~ '[{}]';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._vendor_validate_template_body(text) FROM PUBLIC;--> statement-breakpoint

-- 2. Log post-auth refusals (tenant_not_found) in vendor_console_integrations before authority recheck.
CREATE OR REPLACE FUNCTION public.vendor_console_integrations(p_token text, p_ip text, p_tenant uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
  v_now timestamptz;
  v_roles text[] := ARRAY['support'];
  v_res jsonb;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session');
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, v_roles, 'integrations_read', p_tenant, NULL, v.second_factor_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  IF p_tenant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants_registry tr WHERE tr.id = p_tenant) THEN
    PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'integrations_read', NULL, NULL, 'denied', 'tenant_not_found', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND', 'reason', 'tenant_not_found');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
    RETURN v_res;
  END IF;
  v_now := clock_timestamp();
  v_res := jsonb_build_object(
    'ok', true,
    'at', v_now,
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'tenantId', tr.id,
        'legalName', t.legal_name,
        'state', tr.lifecycle_state,
        'whatsapp', jsonb_build_object(
          'accountsCount', (SELECT count(*)::int FROM public.waba_accounts wa WHERE wa.tenant_id = tr.id),
          'activeAccounts', (SELECT count(*)::int FROM public.waba_accounts wa WHERE wa.tenant_id = tr.id AND wa.revoked_at IS NULL AND wa.state IN ('number_registered','live')),
          'failed24h', (SELECT count(*)::int FROM public.outbound_messages o WHERE o.tenant_id = tr.id AND o.state = 'failed' AND o.decided_at > v_now - interval '24 hours'),
          'codes', (SELECT public._vendor_closed_codes(array_agg(coalesce(o.error_code, o.deferred_reason)))
                      FROM public.outbound_messages o
                     WHERE o.tenant_id = tr.id AND o.state = 'failed' AND o.decided_at > v_now - interval '24 hours')
        ),
        'satusehat', jsonb_build_object(
          'queued', (SELECT count(*)::int FROM public.satusehat_outbox x WHERE x.tenant_id = tr.id AND x.state IN ('queued','held','leased')),
          'failed24h', (SELECT count(*)::int FROM public.satusehat_attempts a WHERE a.tenant_id = tr.id AND a.started_at > v_now - interval '24 hours' AND a.outcome IS NOT NULL AND a.outcome <> 'ok'),
          'codes', (SELECT public._vendor_closed_codes(array_agg(coalesce(a.error_code, a.outcome)))
                      FROM public.satusehat_attempts a
                     WHERE a.tenant_id = tr.id AND a.started_at > v_now - interval '24 hours' AND a.outcome IS NOT NULL AND a.outcome <> 'ok')
        ),
        'payments', jsonb_build_object(
          'rejected24h', (SELECT count(*)::int FROM public.payment_webhook_events w WHERE w.tenant_id = tr.id AND w.received_at > v_now - interval '24 hours' AND (w.outcome LIKE 'rejected_%' OR w.outcome LIKE 'dropped_%')),
          'codes', (SELECT public._vendor_closed_codes(array_agg(w.outcome))
                      FROM public.payment_webhook_events w
                     WHERE w.tenant_id = tr.id AND w.received_at > v_now - interval '24 hours' AND w.outcome NOT IN ('received','applied','duplicate'))
        )
      ) ORDER BY t.legal_name, tr.id)
      FROM public.tenants_registry tr
      LEFT JOIN public.tenants t ON t.id = tr.id
      WHERE p_tenant IS NULL OR tr.id = p_tenant
    ), '[]'::jsonb)
  );
  PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'integrations_read', p_tenant, NULL, 'success', 'list', p_ip);
  PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
  RETURN v_res;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_integrations(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_integrations(text, text, uuid) TO clinic_vendor;--> statement-breakpoint

-- 3. Log post-auth refusals (tenant_not_found) in vendor_console_actions_list before authority recheck.
CREATE OR REPLACE FUNCTION public.vendor_console_actions_list(
  p_token text,
  p_ip text,
  p_tenant uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
  v_roles text[] := ARRAY['platform_owner','vendor_auditor'];
  v_lim integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_res jsonb;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session');
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, v_roles, 'actions_read', p_tenant, NULL, v.second_factor_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  IF p_tenant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants_registry tr WHERE tr.id = p_tenant) THEN
    PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'actions_read', NULL, NULL, 'denied', 'tenant_not_found', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND', 'reason', 'tenant_not_found');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
    RETURN v_res;
  END IF;
  v_res := jsonb_build_object('ok', true, 'rows', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', q.id,
      'at', q.at,
      'actorRole', q.acting_role,
      'action', q.action,
      'tenantId', q.tenant_id,
      'tenantName', q.legal_name,
      'outcome', q.outcome,
      'reasonCode', q.reason_code,
      'clientIp', public._vendor_mask_ip(q.client_ip)
    ) ORDER BY q.at DESC, q.seq DESC)
    FROM (
      SELECT a.id, a.seq, a.at, a.acting_role, a.action, a.tenant_id, t.legal_name, a.outcome, a.reason_code, a.client_ip
        FROM public.vendor_actions a
        LEFT JOIN public.tenants t ON t.id = a.tenant_id
       WHERE (p_tenant IS NULL OR a.tenant_id = p_tenant)
         AND (p_from IS NULL OR a.at >= p_from)
         AND (p_to IS NULL OR a.at <= p_to)
       ORDER BY a.at DESC, a.seq DESC
       LIMIT v_lim
    ) q
  ), '[]'::jsonb));
  PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'actions_read', p_tenant, NULL, 'success', 'list', p_ip);
  PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
  RETURN v_res;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_actions_list(text, text, uuid, timestamptz, timestamptz, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_actions_list(text, text, uuid, timestamptz, timestamptz, integer) TO clinic_vendor;--> statement-breakpoint

-- 4. Log post-auth refusals (invalid_range, tenant_not_found) in vendor_console_actions_export before authority recheck.
CREATE OR REPLACE FUNCTION public.vendor_console_actions_export(
  p_token text,
  p_ip text,
  p_tenant uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  w record;
  v_roles text[] := ARRAY['platform_owner','vendor_auditor'];
  v_now timestamptz;
  v_recent integer;
  v_count integer;
  v_rows jsonb;
  v_res jsonb;
  v_tenant_exists boolean := false;
BEGIN
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, v_roles, 'vendor_actions_export', p_tenant);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  IF p_tenant IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.tenants_registry tr WHERE tr.id = p_tenant) INTO v_tenant_exists;
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_actions_export', CASE WHEN v_tenant_exists THEN p_tenant ELSE NULL END, NULL, 'denied', 'invalid_range', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT', 'reason', 'invalid_range');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  IF p_tenant IS NOT NULL AND NOT v_tenant_exists THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_actions_export', NULL, NULL, 'denied', 'tenant_not_found', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND', 'reason', 'tenant_not_found');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_actions_export:' || w.account_id::text, 0));
  v_now := clock_timestamp();
  SELECT count(*) INTO v_recent
    FROM public.vendor_actions a
   WHERE a.account_id = w.account_id
     AND a.action = 'vendor_actions_export'
     AND a.outcome = 'success'
     AND a.at > v_now - interval '5 minutes';
  IF v_recent >= 5 THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_actions_export', p_tenant, NULL, 'denied', 'rate_limited', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_RATE_LIMITED', 'reason', 'rate_limited');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  WITH slice AS (
    SELECT a.id, a.seq, a.at, a.acting_role, a.action, a.tenant_id, t.legal_name, a.outcome, a.reason_code, a.client_ip
      FROM public.vendor_actions a
      LEFT JOIN public.tenants t ON t.id = a.tenant_id
     WHERE (p_tenant IS NULL OR a.tenant_id = p_tenant)
       AND (p_from IS NULL OR a.at >= p_from)
       AND (p_to IS NULL OR a.at <= p_to)
     ORDER BY a.at DESC, a.seq DESC
     LIMIT 10001
  )
  SELECT count(*)::int,
         CASE WHEN count(*) > 10000 THEN '[]'::jsonb
              ELSE coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id,
                'at', s.at,
                'actorRole', s.acting_role,
                'action', s.action,
                'tenantId', s.tenant_id,
                'tenantName', s.legal_name,
                'outcome', s.outcome,
                'reasonCode', s.reason_code,
                'clientIp', public._vendor_mask_ip(s.client_ip)
              ) ORDER BY s.at DESC, s.seq DESC), '[]'::jsonb)
         END
    INTO v_count, v_rows
    FROM slice s;
  IF v_count > 10000 THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_actions_export', p_tenant, NULL, 'denied', 'row_limit_exceeded', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_LIMIT_EXCEEDED', 'reason', 'row_limit_exceeded', 'count', v_count, 'max', 10000);
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_actions_export', p_tenant, NULL, 'success', 'exported', p_ip);
  v_res := jsonb_build_object('ok', true, 'count', v_count, 'rows', v_rows);
  PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
  RETURN v_res;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_actions_export(text, text, uuid, timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_actions_export(text, text, uuid, timestamptz, timestamptz) TO clinic_vendor;--> statement-breakpoint

-- 5. Log post-auth refusals (profile_missing, invalid_kind, invalid_body) in profile & template_save.
CREATE OR REPLACE FUNCTION public.vendor_console_profile(p_token text, p_ip text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
  p public.vendor_profile;
  v_roles text[] := ARRAY['platform_owner'];
  v_res jsonb;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session');
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, v_roles, 'profile_read', NULL, NULL, v.second_factor_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  SELECT * INTO p FROM public.vendor_profile WHERE id = 1;
  IF p.id IS NULL THEN
    PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'profile_read', NULL, NULL, 'denied', 'profile_missing', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND', 'reason', 'profile_missing');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
    RETURN v_res;
  END IF;
  v_res := jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'legalName', p.legal_name,
      'nib', p.nib,
      'pseNumber', p.pse_number,
      'npwp', p.npwp,
      'metaBusinessId', p.meta_business_id,
      'website', p.website,
      'privacyUrl', p.privacy_url,
      'supportEmail', p.support_email,
      'supportPhone', p.support_phone,
      'placeholderFields', to_jsonb(p.placeholder_fields),
      'storageLocations', p.storage_locations,
      'isPkp', p.is_pkp,
      'pkpEffectiveFrom', p.pkp_effective_from,
      'residencyOpinionOutcome', p.residency_opinion_outcome,
      'residencyOpinionDate', p.residency_opinion_date,
      'residencyOpinionRef', p.residency_opinion_ref,
      'updatedAt', p.updated_at
    ),
    'goLiveBlockers', to_jsonb(public.vendor_go_live_blockers())
  );
  PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'profile_read', NULL, NULL, 'success', 'read', p_ip);
  PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
  RETURN v_res;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_profile(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_profile(text, text) TO clinic_vendor;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.vendor_console_template_save(
  p_token text,
  p_ip text,
  p_kind text,
  p_body text,
  p_activate boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  w record;
  v_roles text[] := ARRAY['platform_owner'];
  v_next_ver integer;
  v_sha text;
  v_id uuid;
  v_now timestamptz;
  v_res jsonb;
BEGIN
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, v_roles, 'vendor_template_save', NULL);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('kebijakan-privasi','syarat-ketentuan','kebijakan-pembatalan') THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_template_save', NULL, NULL, 'denied', 'invalid_kind', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT', 'reason', 'invalid_kind');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  IF NOT public._vendor_validate_template_body(p_body) THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_template_save', NULL, NULL, 'denied', 'invalid_body', p_ip);
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT', 'reason', 'invalid_body');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_legal_template:' || p_kind, 0));
  v_now := clock_timestamp();
  SELECT coalesce(max(version), 0) + 1 INTO v_next_ver
    FROM public.vendor_legal_templates
   WHERE kind = p_kind;
  v_sha := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');
  IF coalesce(p_activate, false) THEN
    UPDATE public.vendor_legal_templates
       SET is_active = false
     WHERE kind = p_kind AND is_active = true;
  END IF;
  INSERT INTO public.vendor_legal_templates (kind, version, body, body_sha256, is_active, updated_by, updated_at)
  VALUES (p_kind, v_next_ver, p_body, v_sha, coalesce(p_activate, false), w.account_id::text, v_now)
  RETURNING id INTO v_id;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_template_save', NULL, v_id, 'success', replace(p_kind, '-', '_'), p_ip);
  v_res := jsonb_build_object('ok', true, 'id', v_id, 'kind', p_kind, 'version', v_next_ver, 'sha256', v_sha, 'isActive', coalesce(p_activate, false));
  PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
  RETURN v_res;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_template_save(text, text, text, text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_template_save(text, text, text, text, boolean) TO clinic_vendor;
