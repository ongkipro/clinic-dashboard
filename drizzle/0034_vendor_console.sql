-- T-021 (PR-57, SEC-21, SEC-16, PR-60). Vendor console functions. The console logs in as a
-- member of clinic_vendor (0032), which holds no table privilege. Every console call names
-- the caller by its vendor-surface session token (the secret in the __Host-vendor
-- session cookie), never by an account id: the database resolves the account and the time
-- the session last passed TOTP from auth_session itself, so a console process cannot act
-- as anyone whose session it does not hold (owner decision 2026-11-03, hardening of the
-- T-020 trust assumption). The client IP still comes from the trusted proxy header.

-- The session behind a vendor-console call: a vendor-surface session that has not expired
-- or been idle-locked. NULL account when there is none.
CREATE FUNCTION public.vendor_session(p_token text, OUT account_id uuid, OUT second_factor_at timestamptz)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.user_id, s.second_factor_at
    FROM public.auth_session s
   WHERE p_token IS NOT NULL AND length(p_token) BETWEEN 16 AND 256
     AND s.token = p_token AND s.surface = 'vendor'
     AND s.expires_at > now() AND s.locked_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_session(text) FROM PUBLIC;--> statement-breakpoint

-- Guard for a console read: resolves the session, then vendor_guard (T-020). A caller with
-- no valid session is refused without a log row (nothing to attribute). A refusal already
-- logged for the same account, IP and reason in the last 10 minutes is not logged again,
-- so a signed-in non-vendor account reloading the page cannot flood the vendor log.
CREATE FUNCTION public.vendor_console_guard(p_token text, p_ip text, p_action text, OUT staff_id uuid, OUT role text, OUT refusal text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
  v_roles text[] := ARRAY['platform_owner','onboarding','support','vendor_finance','vendor_auditor'];
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    refusal := 'no_session';
    RETURN;
  END IF;
  -- Same checks as vendor_guard, in its order, without logging, to decide whether a log row
  -- is due (tests/vendor/host.test.ts compares both on every refusal state).
  refusal := CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.vendor_staff s WHERE s.account_id = v.account_id) THEN 'not_vendor_staff'
    WHEN NOT EXISTS (SELECT 1 FROM public.vendor_staff s WHERE s.account_id = v.account_id AND s.state = 'active') THEN 'vendor_staff_inactive'
    WHEN NOT EXISTS (SELECT 1 FROM public.auth_user u WHERE u.id = v.account_id AND u.two_factor_enabled) THEN 'totp_required'
    WHEN v.second_factor_at IS NULL OR v.second_factor_at > now() + interval '1 minute' OR v.second_factor_at < now() - interval '12 hours' THEN 'totp_not_verified'
    WHEN NOT public.vendor_ip_allowed(p_ip) THEN 'ip_not_allowed' END;
  IF refusal IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.vendor_actions a
        WHERE a.account_id = v.account_id AND a.action = p_action AND a.outcome = 'denied' AND a.reason_code = refusal
          AND a.client_ip IS NOT DISTINCT FROM left(p_ip, 64) AND a.at > now() - interval '10 minutes') THEN
    RETURN;
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, v_roles, p_action, NULL, NULL, v.second_factor_at, interval '12 hours');
  staff_id := g.staff_id;
  role := g.role;
  refusal := g.refusal;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_guard(text, text, text) FROM PUBLIC;--> statement-breakpoint

-- Who is signed in: the acting vendor staff member and every role held.
CREATE FUNCTION public.vendor_console_me(p_token text, p_ip text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_open');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  RETURN jsonb_build_object('ok', true,
    'staff_id', g.staff_id,
    'name', (SELECT s.display_name FROM public.vendor_staff s WHERE s.id = g.staff_id),
    'roles', (SELECT jsonb_agg(r.role ORDER BY r.role) FROM public.vendor_staff_roles r WHERE r.staff_id = g.staff_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_me(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_me(text, text) TO clinic_vendor;--> statement-breakpoint

-- Konsol Vendor › Tenant (UX-40, first columns): lifecycle state, legal name and branch
-- count only. Platform pages never show patient, staff or clinical data (PR-60). Every
-- vendor role reads it (19 §3). Tenant names are tenant-controlled strings: the console
-- renders them as text (escaped), never as markup.
CREATE FUNCTION public.vendor_console_tenants(p_token text, p_ip text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_tenants');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  RETURN jsonb_build_object('ok', true, 'rows', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'state', r.lifecycle_state, 'name', t.legal_name,
             'branches', (SELECT count(*) FROM public.branches b WHERE b.tenant_id = r.id))
           ORDER BY t.legal_name, r.id)
      FROM public.tenants_registry r LEFT JOIN public.tenants t ON t.id = r.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_tenants(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_tenants(text, text) TO clinic_vendor;--> statement-breakpoint

-- Sign-in on the vendor host is accepted only from an allowlisted address (the console
-- checks this before the password is looked at). Answers only yes/no for the caller's IP.
CREATE FUNCTION public.vendor_console_ip_allowed(p_ip text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.vendor_ip_allowed(p_ip)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_ip_allowed(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_ip_allowed(text) TO clinic_vendor;--> statement-breakpoint

-- The T-020 commands take an account id from the caller. The console must not be able to
-- name an actor, so clinic_vendor loses them; the tasks that add console actions add
-- session-token wrappers like the reads above.
REVOKE EXECUTE ON FUNCTION public.vendor_staff_create(uuid, text, timestamptz, uuid, text, text[]) FROM clinic_vendor;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.vendor_staff_update(uuid, text, timestamptz, uuid, text[], text) FROM clinic_vendor;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.vendor_ip_allowlist_set(uuid, text, timestamptz, text, text, boolean) FROM clinic_vendor;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.vendor_request(uuid, text, timestamptz, text, uuid, jsonb, text) FROM clinic_vendor;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.vendor_request_decide(uuid, text, timestamptz, uuid, boolean, text) FROM clinic_vendor;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.vendor_request_cancel(uuid, text, timestamptz, uuid) FROM clinic_vendor;
