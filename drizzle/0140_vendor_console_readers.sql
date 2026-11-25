CREATE TABLE "platform_feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"tender_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "platform_feature_flags_key_chk" CHECK ("platform_feature_flags"."key" ~ '^[a-z][a-z0-9_]{2,48}$'),
	CONSTRAINT "platform_feature_flags_label_chk" CHECK (length(btrim("platform_feature_flags"."label")) between 3 and 120)
);--> statement-breakpoint
CREATE TABLE "tenant_feature_flags" (
	"tenant_id" uuid NOT NULL,
	"flag_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"decision_ref" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "tenant_feature_flags_tenant_id_flag_key_pk" PRIMARY KEY("tenant_id","flag_key"),
	CONSTRAINT "tenant_feature_flags_dec_chk" CHECK ("tenant_feature_flags"."decision_ref" ~ '^DEC-[0-9]{3,5}$')
);--> statement-breakpoint
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_flag_key_platform_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."platform_feature_flags"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_approved_by_auth_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- T-129 + HYG-024 (PR-87, 19 §3, ADR-7; R3): Vendor Console readers, audit CSV export, and legal template writers.
-- Every new table has RLS enabled, REVOKE ALL FROM PUBLIC, a platform scope_map row, and TEN-19 'never'.
-- Every vendor_console_* function follows vendor_session + vendor_guard/vendor_console_writer + vendor_authority_recheck
-- immediately before every RETURN after its guard (HYG-008b, tests/rls/vendor-authority.test.ts).
ALTER TABLE public.platform_feature_flags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tenant_feature_flags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.platform_feature_flags FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.tenant_feature_flags FROM PUBLIC;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.platform_feature_flags', 'platform', 'vendor/flags', '{}', 'platform_owner (ADR-7)', 'none'),
  ('public.tenant_feature_flags', 'platform', 'vendor/flags', '{}', 'platform_owner (ADR-7)', 'none');--> statement-breakpoint

INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.platform_feature_flags', 'never'),
  ('public.tenant_feature_flags', 'never'),
  ('public.vendor_legal_templates', 'never')
ON CONFLICT (table_name) DO NOTHING;--> statement-breakpoint

-- 1. Narrow clinic_app reader bound strictly to current app.tenant_id (returns false when unbound or unknown).
CREATE FUNCTION public.feature_flag_on(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((
    SELECT tf.enabled
      FROM public.tenant_feature_flags tf
     WHERE tf.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
       AND tf.flag_key = p_key
  ), false);
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.feature_flag_on(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.feature_flag_on(text) TO clinic_app;--> statement-breakpoint

-- 2. Internal helpers (REVOKE ALL FROM PUBLIC; granted to nobody).
-- Closed finite vocabulary mapper for vendor Integrasi views (never passes raw provider strings!).
CREATE FUNCTION public._vendor_closed_error_code(p_code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE lower(btrim(coalesce(p_code, '')))
    WHEN 'timeout' THEN 'timeout'
    WHEN 'rate_limited' THEN 'rate_limited'
    WHEN 'auth_failed' THEN 'auth_failed'
    WHEN 'invalid_signature' THEN 'invalid_signature'
    WHEN 'rejected_signature' THEN 'rejected_signature'
    WHEN 'held_out_of_order' THEN 'held_out_of_order'
    WHEN 'upstream_5xx' THEN 'upstream_5xx'
    WHEN 'upstream_4xx' THEN 'upstream_4xx'
    WHEN 'missing_credential' THEN 'missing_credential'
    WHEN 'consent_missing' THEN 'consent_missing'
    WHEN 'window_closed' THEN 'window_closed'
    WHEN 'network_error' THEN 'network_error'
    WHEN 'budget_exceeded' THEN 'budget_exceeded'
    ELSE 'lainnya'
  END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._vendor_closed_error_code(text) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public._vendor_closed_codes(p_codes text[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', c, 'count', n) ORDER BY n DESC, c), '[]'::jsonb)
    FROM (
      SELECT public._vendor_closed_error_code(x) AS c, count(*)::int AS n
        FROM unnest(coalesce(p_codes, ARRAY[]::text[])) x
       WHERE x IS NOT NULL
       GROUP BY 1
       ORDER BY 2 DESC, 1
       LIMIT 5
    ) q;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._vendor_closed_codes(text[]) FROM PUBLIC;--> statement-breakpoint

-- Mask client IP in vendor audit projections (/24 for IPv4, 'masked' for IPv6 or non-IPv4).
CREATE FUNCTION public._vendor_mask_ip(p_ip text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN p_ip IS NULL OR btrim(p_ip) = '' THEN NULL
    WHEN p_ip ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
      THEN regexp_replace(p_ip, '\.[0-9]{1,3}$', '.0/24')
    ELSE 'masked'
  END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._vendor_mask_ip(text) FROM PUBLIC;--> statement-breakpoint

-- Strict plain-text legal template validator (zero HTML <>, zero lone braces, only 5 allowlisted tokens in a single pass).
CREATE FUNCTION public._vendor_validate_template_body(p_body text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_stripped text;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) < 20 OR length(p_body) > 50000 THEN
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

-- 3. Konsol Vendor > Integrasi (19 §3: support only; closed vocabulary, zero phone digits/patient IDs).
CREATE FUNCTION public.vendor_console_integrations(p_token text, p_ip text, p_tenant uuid DEFAULT NULL) RETURNS jsonb
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

-- 4. Konsol Vendor > Audit Vendor list & rate-limited export (19 §3: platform_owner, vendor_auditor).
CREATE FUNCTION public.vendor_console_actions_list(
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

CREATE FUNCTION public.vendor_console_actions_export(
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
BEGIN
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, v_roles, 'vendor_actions_export', p_tenant);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT', 'reason', 'invalid_range');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  IF p_tenant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants_registry tr WHERE tr.id = p_tenant) THEN
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND', 'reason', 'tenant_not_found');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  -- Serialize per-account RATE-5 quota (<= 5 exports per 5 minutes).
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
  -- Single-statement snapshot of at most 10,001 rows prevents READ COMMITTED TOCTOU above the 10,000-row cap.
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

-- 5. Konsol Vendor > Profil Vendor reader (19 §3: platform_owner only; delegates residency blockers strictly to T-120 vendor_go_live_blockers()).
CREATE FUNCTION public.vendor_console_profile(p_token text, p_ip text) RETURNS jsonb
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

-- 6. Konsol Vendor > Feature Flag Platform reader (19 §3: platform_owner only; ADR-7 empty Release 1 catalogue, writes closed).
CREATE FUNCTION public.vendor_console_flags(p_token text, p_ip text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
  v_roles text[] := ARRAY['platform_owner'];
  v_res jsonb;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session');
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, v_roles, 'flags_read', NULL, NULL, v.second_factor_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  v_res := jsonb_build_object(
    'ok', true,
    'writesOpen', false,
    'catalogue', coalesce((
      SELECT jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'description', f.description, 'tenderRef', f.tender_ref) ORDER BY f.key)
        FROM public.platform_feature_flags f
    ), '[]'::jsonb),
    'assignments', coalesce((
      SELECT jsonb_agg(jsonb_build_object('tenantId', tf.tenant_id, 'flagKey', tf.flag_key, 'enabled', tf.enabled, 'decisionRef', tf.decision_ref, 'updatedAt', tf.updated_at) ORDER BY tf.tenant_id, tf.flag_key)
        FROM public.tenant_feature_flags tf
    ), '[]'::jsonb)
  );
  PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'flags_read', NULL, NULL, 'success', 'list', p_ip);
  PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
  RETURN v_res;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_flags(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_flags(text, text) TO clinic_vendor;--> statement-breakpoint

-- 7. Konsol Vendor > Templat Global reader & writer (19 §3: platform_owner only; plain text + 5-token allowlist; atomic single-active).
CREATE FUNCTION public.vendor_console_templates_list(p_token text, p_ip text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
  v_roles text[] := ARRAY['platform_owner'];
  v_res jsonb;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session');
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, v_roles, 'templates_read', NULL, NULL, v.second_factor_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  v_res := jsonb_build_object('ok', true, 'rows', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id,
      'kind', t.kind,
      'version', t.version,
      'sha256', t.body_sha256,
      'isActive', t.is_active,
      'updatedAt', t.updated_at,
      'body', t.body
    ) ORDER BY t.kind, t.version DESC)
    FROM public.vendor_legal_templates t
  ), '[]'::jsonb));
  PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'templates_read', NULL, NULL, 'success', 'list', p_ip);
  PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
  RETURN v_res;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_templates_list(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_templates_list(text, text) TO clinic_vendor;--> statement-breakpoint

CREATE FUNCTION public.vendor_console_template_save(
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
    v_res := jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT', 'reason', 'invalid_kind');
    PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '10 minutes');
    RETURN v_res;
  END IF;
  IF NOT public._vendor_validate_template_body(p_body) THEN
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
