ALTER TABLE "support_session_bindings" ADD COLUMN "client_ip" text;--> statement-breakpoint

-- HYG-008b (DEC-043, DEC-042; IAM-16, TEN-17, TEN-19; foundation review lane A A-01, A-03, B-01, B-03
-- operator side; plan review R1-M2, 5a, 9e, 9f): vendor and operator authority on the wall clock
-- after every wait. Expand only: one nullable column (above, drizzle-generated), functions,
-- grants. Every re-created body is the latest definition at 0048 (pg_get_functiondef) with only
-- the lines named in its comment changed; tests/db/vendor-authority-drift.test.ts checks the diff.
--
-- The rule for every vendor console entry point: it calls vendor_authority_recheck after its last
-- statement that can wait or have an effect and before every exit that can keep an effect or
-- return data, outside any EXCEPTION block. Readers build their response into v_resp first. The
-- re-check raises 42501 "vendor_authority: <reason>"; the TS helper logs the refusal in its own
-- transaction (vendor_authority_refused) and answers ERR_FORBIDDEN.
-- Waits each entry point has before its final exit (2026-11-06 inventory, 0048 bodies):
--   readers (me, tenants, tenant_detail, support_list): none after the guard;
--   staff_list: the expiry UPDATE of pending invitations (rows another path can hold);
--   onboarding_access / _invite: staff_access and the audit lock (onboarding_grant_check), the
--     grant row FOR SHARE, the drafts insert's foreign-key share on tenants_registry;
--   owner_invite: tenants_registry FOR UPDATE, the expiry UPDATE;
--   owner_invite_approve: tenants_registry FOR UPDATE, the invitation row;
--   owner_invite_cancel / staff_invite_cancel: the invitation row (UPDATE);
--   staff_invite: the global vendor_staff lock, the expiry UPDATE;
--   staff_state: the global lock, the target row, the target account lock (in
--     vendor_staff_update_checked, which re-checks on its success branch);
--   support_open / _extend / _end / _ticket: staff_access, the staff row FOR SHARE (support_caller),
--     the session row, the inserts' foreign-key shares;
--   tenant_advance: staff_access, tenants_registry FOR UPDATE (inside the transition);
--   tenant_create: new rows only (re-checked anyway: the rule has no exception).
-- Lock order is unchanged: the re-check takes no lock; vendor_guard never takes staff_access.
-- The six actor-id writers (vendor_staff_create, vendor_staff_update, vendor_ip_allowlist_set,
-- vendor_request, vendor_request_decide, vendor_request_cancel) are not executable by
-- clinic_vendor (0034); a task that exposes one wraps it in a token-taking entry point.
--> statement-breakpoint
-- vendor_session: expiry on the wall clock
CREATE OR REPLACE FUNCTION public.vendor_session(p_token text, OUT account_id uuid, OUT second_factor_at timestamp with time zone)
 RETURNS record
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT s.user_id, s.second_factor_at
    FROM public.auth_session s
   WHERE p_token IS NOT NULL AND length(p_token) BETWEEN 16 AND 256
     AND s.token = p_token AND s.surface = 'vendor'
     AND s.expires_at > clock_timestamp() AND s.locked_at IS NULL
$function$
;--> statement-breakpoint
-- vendor_guard: TOTP read after the FOR SHARE wait; second-factor age on the wall clock
CREATE OR REPLACE FUNCTION public.vendor_guard(p_account uuid, p_ip text, p_roles text[], p_action text, p_tenant uuid, p_object uuid, p_second_factor_at timestamp with time zone, p_max_age interval, OUT staff_id uuid, OUT role text, OUT refusal text)
 RETURNS record
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  s public.vendor_staff;
  v_totp boolean;
  v_known boolean;
BEGIN
  -- The staff row is locked for share: a concurrent demotion or suspension waits for this
  -- action (or this action sees it). HYG-008b: TOTP enrolment is read after that wait.
  SELECT * INTO s FROM public.vendor_staff WHERE account_id = p_account FOR SHARE;
  SELECT EXISTS (SELECT 1 FROM public.auth_user WHERE id = p_account), (SELECT two_factor_enabled FROM public.auth_user WHERE id = p_account)
    INTO v_known, v_totp;
  refusal := CASE
    WHEN s.id IS NULL THEN 'not_vendor_staff'
    WHEN s.state <> 'active' THEN 'vendor_staff_inactive'
    WHEN v_totp IS NOT TRUE THEN 'totp_required'
    WHEN p_second_factor_at IS NULL OR p_second_factor_at > clock_timestamp() + interval '1 minute' OR p_second_factor_at < clock_timestamp() - p_max_age THEN 'totp_not_verified'
    WHEN NOT public.vendor_ip_allowed(p_ip) THEN 'ip_not_allowed' END;
  IF refusal IS NULL THEN
    SELECT r.role INTO role FROM unnest(p_roles) WITH ORDINALITY x(role, o)
      JOIN public.vendor_staff_roles r ON r.staff_id = s.id AND r.role = x.role ORDER BY x.o LIMIT 1;
    IF role IS NULL THEN
      refusal := 'role_not_held';
    END IF;
  END IF;
  staff_id := s.id;
  IF refusal IS NOT NULL THEN
    PERFORM public.vendor_log(s.id, CASE WHEN v_known THEN p_account END, NULL, p_action, p_tenant, p_object, 'denied', refusal, p_ip);
    staff_id := NULL;
    role := NULL;
  END IF;
END
$function$
;--> statement-breakpoint
-- vendor_console_guard: second-factor age on the wall clock (in lockstep with vendor_guard)
CREATE OR REPLACE FUNCTION public.vendor_console_guard(p_token text, p_ip text, p_action text, OUT staff_id uuid, OUT role text, OUT refusal text)
 RETURNS record
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    WHEN v.second_factor_at IS NULL OR v.second_factor_at > clock_timestamp() + interval '1 minute' OR v.second_factor_at < clock_timestamp() - interval '12 hours' THEN 'totp_not_verified'
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
$function$
;--> statement-breakpoint
-- support_read_caller: second-factor age on the wall clock
CREATE OR REPLACE FUNCTION public.support_read_caller(p_token text, p_ip text, OUT account_id uuid, OUT staff_id uuid, OUT role text, OUT refusal text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record;
  s public.vendor_staff;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    refusal := 'no_session';
    RETURN;
  END IF;
  account_id := v.account_id;
  SELECT * INTO s FROM public.vendor_staff x WHERE x.account_id = v.account_id;
  refusal := CASE
    WHEN s.id IS NULL THEN 'not_vendor_staff'
    WHEN s.state <> 'active' THEN 'vendor_staff_inactive'
    WHEN NOT EXISTS (SELECT 1 FROM public.auth_user u WHERE u.id = v.account_id AND u.two_factor_enabled) THEN 'totp_required'
    WHEN v.second_factor_at IS NULL OR v.second_factor_at > clock_timestamp() + interval '1 minute' OR v.second_factor_at < clock_timestamp() - interval '12 hours' THEN 'totp_not_verified'
    WHEN NOT public.vendor_ip_allowed(p_ip) THEN 'ip_not_allowed' END;
  IF refusal IS NULL THEN
    SELECT r.role INTO role FROM unnest(ARRAY['support','onboarding','platform_owner']) WITH ORDINALITY x(role, o)
      JOIN public.vendor_staff_roles r ON r.staff_id = s.id AND r.role = x.role ORDER BY x.o LIMIT 1;
    IF role IS NULL THEN
      refusal := 'role_not_held';
    END IF;
  END IF;
  staff_id := s.id;
END
$function$
;--> statement-breakpoint
-- HYG-008b: the authority a vendor console entry point acted under, re-read at its final
-- authorization point (after its last wait, before an exit that keeps an effect or returns data):
-- the session, its second-factor age against the same limit the entry point's guard used, TOTP
-- enrolment, the staff row's state, a held role, the address. A refusal raises 42501 with the
-- reason (the transaction and any effect roll back); the console helper logs it in a separate
-- transaction through vendor_authority_refused. VOLATILE: reads with a fresh snapshot. No lock.
CREATE FUNCTION public.vendor_authority_recheck(p_token text, p_ip text, p_roles text[], p_max_age interval)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record;
  v_reason text;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  v_reason := CASE
    WHEN v.account_id IS NULL THEN 'no_session'
    WHEN NOT EXISTS (SELECT 1 FROM public.vendor_staff s WHERE s.account_id = v.account_id) THEN 'not_vendor_staff'
    WHEN NOT EXISTS (SELECT 1 FROM public.vendor_staff s WHERE s.account_id = v.account_id AND s.state = 'active') THEN 'vendor_staff_inactive'
    WHEN NOT EXISTS (SELECT 1 FROM public.auth_user u WHERE u.id = v.account_id AND u.two_factor_enabled) THEN 'totp_required'
    WHEN v.second_factor_at IS NULL OR v.second_factor_at > clock_timestamp() + interval '1 minute'
      OR v.second_factor_at < clock_timestamp() - p_max_age THEN 'totp_not_verified'
    WHEN NOT public.vendor_ip_allowed(p_ip) THEN 'ip_not_allowed'
    WHEN NOT EXISTS (SELECT 1 FROM public.vendor_staff s JOIN public.vendor_staff_roles r ON r.staff_id = s.id
                      WHERE s.account_id = v.account_id AND r.role = ANY (p_roles)) THEN 'role_not_held' END;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: vendor_authority: %', v_reason USING ERRCODE = '42501';
  END IF;
END
$function$
;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_authority_recheck(text, text, text[], interval) FROM PUBLIC;--> statement-breakpoint

-- The refusal of a re-check, committed by the console helper in its own transaction after the
-- refused one rolled back (as vendor_request_consume_refused). Only the re-check's reasons and a
-- console action name are accepted. Attribution: the staff and account only while the token still
-- names a vendor session of a vendor staff account; the tenant and object resolved here from the
-- id the command was about (p_kind): a tenant, a support session (its tenant), an owner invitation
-- (its tenant), or an object with no tenant (vendor staff, vendor invitations). An unknown id
-- resolves to no tenant.
CREATE FUNCTION public.vendor_authority_refused(p_token text, p_ip text, p_action text, p_kind text, p_id uuid, p_object uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record;
  v_staff uuid;
  v_tenant uuid;
  v_object uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('no_session','not_vendor_staff','vendor_staff_inactive','totp_required','totp_not_verified','ip_not_allowed','role_not_held')
     OR p_action IS NULL OR p_action !~ '^vendor_console_[a-z_]{2,40}$'
     OR p_kind IS NULL OR p_kind NOT IN ('tenant','support_session','owner_invitation','object') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refusal record' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM public.vendor_session(p_token);
  SELECT s.id INTO v_staff FROM public.vendor_staff s WHERE s.account_id = v.account_id;
  CASE p_kind
    WHEN 'tenant' THEN v_tenant := (SELECT r.id FROM public.tenants_registry r WHERE r.id = p_id); v_object := coalesce(p_object, v_tenant);
    WHEN 'support_session' THEN v_tenant := public.support_session_tenant(p_id); v_object := (SELECT x.id FROM public.support_sessions x WHERE x.id = p_id);
    WHEN 'owner_invitation' THEN v_tenant := (SELECT o.tenant_id FROM public.tenant_owner_invitations o WHERE o.id = p_id); v_object := (SELECT o.id FROM public.tenant_owner_invitations o WHERE o.id = p_id);
    ELSE v_object := p_id;
  END CASE;
  PERFORM public.vendor_log(v_staff, CASE WHEN v_staff IS NOT NULL THEN v.account_id END, NULL, p_action,
          v_tenant, v_object, 'denied', 'authority_' || p_reason, p_ip);
END
$function$
;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_authority_refused(text, text, text, text, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_authority_refused(text, text, text, text, uuid, uuid, text) TO clinic_vendor;--> statement-breakpoint
-- vendor_console_me: reader: response built, authority re-read before every exit after the guard
CREATE OR REPLACE FUNCTION public.vendor_console_me(p_token text, p_ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_resp jsonb;
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_open');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  v_resp := jsonb_build_object('ok', true,
    'staff_id', g.staff_id,
    'name', (SELECT s.display_name FROM public.vendor_staff s WHERE s.id = g.staff_id),
    'roles', (SELECT jsonb_agg(r.role ORDER BY r.role) FROM public.vendor_staff_roles r WHERE r.staff_id = g.staff_id));
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner','onboarding','support','vendor_finance','vendor_auditor'], interval '12 hours');
  RETURN v_resp;
END
$function$
;--> statement-breakpoint
-- vendor_console_tenants: reader: response built, authority re-read before every exit after the guard
CREATE OR REPLACE FUNCTION public.vendor_console_tenants(p_token text, p_ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_resp jsonb;
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_tenants');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  v_resp := jsonb_build_object('ok', true, 'rows', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'state', r.lifecycle_state, 'name', t.legal_name,
             'branches', (SELECT count(*) FROM public.branches b WHERE b.tenant_id = r.id))
           ORDER BY t.legal_name, r.id)
      FROM public.tenants_registry r LEFT JOIN public.tenants t ON t.id = r.id), '[]'::jsonb));
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner','onboarding','support','vendor_finance','vendor_auditor'], interval '12 hours');
  RETURN v_resp;
END
$function$
;--> statement-breakpoint
-- vendor_console_tenant_detail: reader: response built, authority re-read before every exit after the guard
CREATE OR REPLACE FUNCTION public.vendor_console_tenant_detail(p_token text, p_ip text, p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_resp jsonb;
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_tenant_detail');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner','onboarding','support','vendor_finance','vendor_auditor'], interval '12 hours');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  v_resp := jsonb_build_object('ok', true,
    'id', p_tenant,
    'state', (SELECT lifecycle_state FROM public.tenants_registry WHERE id = p_tenant),
    'name', (SELECT legal_name FROM public.tenants WHERE id = p_tenant),
    'sak', (SELECT sak_framework FROM public.tenants WHERE id = p_tenant),
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'timezone', b.timezone) ORDER BY b.code)
                            FROM public.branches b WHERE b.tenant_id = p_tenant), '[]'::jsonb),
    'has_owner', public.tenant_has_role(p_tenant, 'owner'),
    'processor_agreement', coalesce((SELECT public.evidence_item_open(i.id) FROM public.evidence_items i
                                      WHERE i.tenant_id = p_tenant AND i.obligation_key = 'processor_agreement_signed'), false),
    'invitations', coalesce((SELECT jsonb_agg(jsonb_build_object(
                               'id', o.id, 'email', o.email, 'name', o.display_name,
                               'state', CASE WHEN o.state = 'issued' AND o.expires_at <= now() THEN 'expired' ELSE o.state END,
                               'requested_by', rq.display_name, 'requested_by_id', o.requested_by, 'requested_at', o.requested_at,
                               'approved_by', ap.display_name, 'expires_at', o.expires_at) ORDER BY o.requested_at DESC)
                              FROM public.tenant_owner_invitations o
                              JOIN public.vendor_staff rq ON rq.id = o.requested_by
                              LEFT JOIN public.vendor_staff ap ON ap.id = o.approved_by
                             WHERE o.tenant_id = p_tenant), '[]'::jsonb),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('from', e.from_state, 'to', e.to_state, 'reason', e.reason, 'at', e.at) ORDER BY e.seq)
                           FROM public.tenant_lifecycle_events e WHERE e.tenant_id = p_tenant), '[]'::jsonb),
    'me', g.staff_id,
    'my_roles', (SELECT jsonb_agg(r.role ORDER BY r.role) FROM public.vendor_staff_roles r WHERE r.staff_id = g.staff_id));
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner','onboarding','support','vendor_finance','vendor_auditor'], interval '12 hours');
  RETURN v_resp;
END
$function$
;--> statement-breakpoint
-- vendor_console_support_list: reader: response built, authority re-read before every exit after the guard
CREATE OR REPLACE FUNCTION public.vendor_console_support_list(p_token text, p_ip text, p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_resp jsonb;
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_support_list');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  v_resp := jsonb_build_object('ok', true, 'rows', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'tenant_id', s.tenant_id, 'operator', v.display_name, 'purpose', s.purpose,
                                        'scope', to_jsonb(s.scope), 'state', CASE WHEN s.state = 'active' AND NOT public.support_session_live(s) THEN 'expired' ELSE s.state END,
                                        'requested_at', s.requested_at, 'ends_at', s.ends_at, 'extended', s.extended_at IS NOT NULL, 'end_reason', s.end_reason)
                     ORDER BY s.requested_at DESC)
      FROM public.support_sessions s JOIN public.vendor_staff v ON v.id = s.opened_by
     WHERE p_tenant IS NULL OR s.tenant_id = p_tenant), '[]'::jsonb));
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner','onboarding','support','vendor_finance','vendor_auditor'], interval '12 hours');
  RETURN v_resp;
END
$function$
;--> statement-breakpoint
-- vendor_console_staff_list: reader: response built, authority re-read before every exit after the guard
CREATE OR REPLACE FUNCTION public.vendor_console_staff_list(p_token text, p_ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_resp jsonb;
  v record;
  g record;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session');
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, ARRAY['platform_owner'], 'console_staff_list', NULL, NULL, v.second_factor_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  UPDATE public.vendor_staff_invitations SET state = 'expired', closed_at = now() WHERE state = 'pending' AND expires_at <= now();
  v_resp := jsonb_build_object('ok', true,
    'me', g.staff_id,
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id', s.id, 'name', s.display_name, 'email', u.email, 'state', s.state, 'totp', u.two_factor_enabled,
                'roles', (SELECT coalesce(jsonb_agg(r.role ORDER BY r.role), '[]'::jsonb) FROM public.vendor_staff_roles r WHERE r.staff_id = s.id))
              ORDER BY s.state = 'exited', s.display_name)
              FROM public.vendor_staff s JOIN public.auth_user u ON u.id = s.account_id), '[]'::jsonb),
    'invitations', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id', i.id, 'name', i.display_name, 'email', i.email, 'roles', to_jsonb(i.roles),
                'invited_by', b.display_name, 'expires_at', i.expires_at) ORDER BY i.invited_at DESC)
              FROM public.vendor_staff_invitations i JOIN public.vendor_staff b ON b.id = i.invited_by
             WHERE i.state = 'pending'), '[]'::jsonb));
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '12 hours');
  RETURN v_resp;
END
$function$
;--> statement-breakpoint
-- vendor_console_onboarding_access: reader: response built, authority re-read before every exit after the guard
CREATE OR REPLACE FUNCTION public.vendor_console_onboarding_access(p_token text, p_ip text, p_tenant uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_resp jsonb;
  c record;
BEGIN
  SELECT * INTO c FROM public.onboarding_grant_check(p_token, p_ip, p_tenant, p_kind, false);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN c.refusal = 'not_found' THEN 'ERR_NOT_FOUND' ELSE 'ERR_FORBIDDEN' END, 'reason', c.refusal);
  END IF;
  v_resp := jsonb_build_object('ok', true,
    'expires_at', (SELECT expires_at FROM public.onboarding_grants WHERE tenant_id = p_tenant));
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '12 hours');
  RETURN v_resp;
END
$function$
;--> statement-breakpoint
-- vendor_console_onboarding_invite: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_onboarding_invite(p_token text, p_ip text, p_tenant uuid, p_email text, p_name text, p_roles text[], p_branches uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c record;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_reason text;
  v_id uuid;
BEGIN
  -- onboarding_grant_check takes staff_access, then the grant row (the one lock order).
  SELECT * INTO c FROM public.onboarding_grant_check(p_token, p_ip, p_tenant, 'staff_invitations', true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN c.refusal = 'not_found' THEN 'ERR_NOT_FOUND' ELSE 'ERR_FORBIDDEN' END, 'reason', c.refusal);
  END IF;
  p_roles := ARRAY(SELECT DISTINCT r FROM unnest(coalesce(p_roles, '{}')) r ORDER BY 1);
  p_branches := ARRAY(SELECT DISTINCT b FROM unnest(coalesce(p_branches, '{}')) b ORDER BY 1);
  v_reason := CASE
    WHEN EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r IN ('owner','admin_pusat','finance','facility_head','records_officer','auditor')) THEN 'role_not_assignable'
    WHEN cardinality(p_roles) = 0 OR EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r IS NULL OR r NOT IN
           ('manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist','central_cs','marketing','purchasing'))
      OR length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
      OR length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 120 THEN 'invalid_input'
    WHEN EXISTS (SELECT 1 FROM public.vendor_staff s JOIN public.auth_user u ON u.id = s.account_id WHERE lower(u.email) = v_email) THEN 'vendor_account'
    WHEN EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r IN ('manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist'))
      AND cardinality(p_branches) = 0 THEN 'invalid_input'
    WHEN EXISTS (SELECT 1 FROM unnest(p_branches) b WHERE NOT EXISTS (SELECT 1 FROM public.branches x WHERE x.tenant_id = p_tenant AND x.id = b)) THEN 'invalid_input'
    WHEN EXISTS (SELECT 1 FROM public.memberships m JOIN public.auth_user u ON u.id = m.account_id WHERE m.tenant_id = p_tenant AND lower(u.email) = v_email) THEN 'already_member'
    WHEN EXISTS (SELECT 1 FROM public.onboarding_invitation_drafts d WHERE d.tenant_id = p_tenant AND d.email = v_email AND d.state = 'draft') THEN 'draft_open' END;
  IF v_reason IS NOT NULL THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'onboarding_invite', p_tenant, NULL, 'denied', v_reason, p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN v_reason = 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  -- The check's vendor_log (after it judged the grant) may have waited on the tenant's
  -- audit lock: judge the grant again immediately before writing.
  IF NOT public.onboarding_grant_active(p_tenant) THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'onboarding_invite', p_tenant, NULL, 'denied', 'grant_not_active', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'grant_not_active');
  END IF;
  INSERT INTO public.onboarding_invitation_drafts (tenant_id, email, display_name, roles, branch_ids, drafted_by)
  VALUES (p_tenant, v_email, btrim(p_name), p_roles, p_branches, c.staff_id) RETURNING id INTO v_id;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'onboarding_invite', p_tenant, v_id, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$function$
;--> statement-breakpoint
-- vendor_console_owner_invite: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_owner_invite(p_token text, p_ip text, p_tenant uuid, p_owner_name text, p_owner_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  w record;
  v_invite uuid;
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
BEGIN
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, ARRAY['onboarding','platform_owner'], 'owner_invite_request', p_tenant);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  PERFORM 1 FROM public.tenants_registry WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant) THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_request', NULL, p_tenant, 'denied', 'not_found', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  -- Expired issued invitations are closed first.
  UPDATE public.tenant_owner_invitations SET state = 'expired', closed_at = now()
   WHERE tenant_id = p_tenant AND state = 'issued' AND expires_at <= now();
  IF public.tenant_has_role(p_tenant, 'owner')
     OR EXISTS (SELECT 1 FROM public.tenant_owner_invitations WHERE tenant_id = p_tenant AND state IN ('pending','issued')) THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_request', p_tenant, p_tenant, 'denied', 'owner_or_invitation_exists', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'owner_or_invitation_exists');
  END IF;
  IF length(btrim(coalesce(p_owner_name, ''))) NOT BETWEEN 2 AND 120
     OR length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_request', p_tenant, p_tenant, 'denied', 'invalid_input', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  INSERT INTO public.tenant_owner_invitations (tenant_id, email, display_name, requested_by)
  VALUES (p_tenant, v_email, btrim(p_owner_name), w.staff_id) RETURNING id INTO v_invite;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_request', p_tenant, v_invite, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'invitation_id', v_invite);
END
$function$
;--> statement-breakpoint
-- vendor_console_owner_invite_approve: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_owner_invite_approve(p_token text, p_ip text, p_invitation uuid, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  w record;
  i public.tenant_owner_invitations;
BEGIN
  SELECT tenant_id INTO i.tenant_id FROM public.tenant_owner_invitations WHERE id = p_invitation;
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, ARRAY['platform_owner'], 'owner_invite_approve', i.tenant_id);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  PERFORM 1 FROM public.tenants_registry WHERE id = i.tenant_id FOR UPDATE;
  SELECT * INTO i FROM public.tenant_owner_invitations WHERE id = p_invitation FOR UPDATE;
  IF NOT FOUND OR i.state <> 'pending' THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'denied', 'not_pending', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'not_pending');
  END IF;
  IF i.requested_by = w.staff_id THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'denied', 'approver_is_requester', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_APPROVER_IS_REQUESTER');
  END IF;
  IF public.tenant_has_role(i.tenant_id, 'owner') THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'denied', 'owner_exists', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'owner_exists');
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'denied', 'invalid_input', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  UPDATE public.tenant_owner_invitations
     SET state = 'issued', approved_by = w.staff_id, approved_at = now(), token_hash = p_token_hash, expires_at = now() + interval '7 days'
   WHERE id = p_invitation;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true);
END
$function$
;--> statement-breakpoint
-- vendor_console_owner_invite_cancel: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_owner_invite_cancel(p_token text, p_ip text, p_invitation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  w record;
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.tenant_owner_invitations WHERE id = p_invitation;
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, ARRAY['onboarding','platform_owner'], 'owner_invite_cancel', v_tenant);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  UPDATE public.tenant_owner_invitations SET state = 'cancelled', closed_at = now()
   WHERE id = p_invitation AND state IN ('pending','issued');
  IF NOT FOUND THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_cancel', v_tenant, p_invitation, 'denied', 'not_open', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_cancel', v_tenant, p_invitation, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true);
END
$function$
;--> statement-breakpoint
-- vendor_console_staff_invite: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_staff_invite(p_token text, p_ip text, p_email text, p_name text, p_roles text[], p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  w record;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_staff', 0));
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, ARRAY['platform_owner'], 'vendor_staff_invite', NULL);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  UPDATE public.vendor_staff_invitations SET state = 'expired', closed_at = now() WHERE state = 'pending' AND expires_at <= now();
  IF length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
     OR length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 120
     OR p_roles IS NULL OR cardinality(p_roles) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_roles) x WHERE x IS NULL OR x NOT IN ('platform_owner','onboarding','support','vendor_finance','vendor_auditor'))
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite', NULL, NULL, 'denied', 'invalid_input', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_staff s JOIN public.auth_user u ON u.id = s.account_id WHERE lower(u.email) = v_email) THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite', NULL, NULL, 'denied', 'already_vendor_staff', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'already_vendor_staff');
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_staff_invitations WHERE email = v_email AND state = 'pending') THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite', NULL, NULL, 'denied', 'invitation_open', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'invitation_open');
  END IF;
  INSERT INTO public.vendor_staff_invitations (email, display_name, roles, token_hash, invited_by, expires_at)
  VALUES (v_email, btrim(p_name), ARRAY(SELECT DISTINCT x FROM unnest(p_roles) x ORDER BY 1), p_token_hash, w.staff_id, now() + interval '7 days')
  RETURNING id INTO v_id;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite', NULL, v_id, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$function$
;--> statement-breakpoint
-- vendor_console_staff_invite_cancel: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_staff_invite_cancel(p_token text, p_ip text, p_invitation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  w record;
BEGIN
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, ARRAY['platform_owner'], 'vendor_staff_invite_cancel', NULL);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  UPDATE public.vendor_staff_invitations SET state = 'cancelled', closed_at = now() WHERE id = p_invitation AND state = 'pending';
  IF NOT FOUND THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite_cancel', NULL, p_invitation, 'denied', 'not_open', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite_cancel', NULL, p_invitation, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true);
END
$function$
;--> statement-breakpoint
-- vendor_console_support_open: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_support_open(p_token text, p_ip text, p_tenant uuid, p_purpose text, p_scope text[], p_minutes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c record;
  v_scope text[];
  v_reason text;
  v_needs_owner boolean;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public.support_caller(p_token, p_ip, 'support_open', p_tenant, true, true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  v_scope := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_scope, '{}')) x ORDER BY 1);
  v_reason := CASE
    WHEN p_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN 'not_found'
    WHEN EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant AND lifecycle_state = 'closed') THEN 'tenant_closed'
    WHEN length(btrim(coalesce(p_purpose, ''))) NOT BETWEEN 10 AND 500 OR p_minutes IS NULL OR p_minutes NOT BETWEEN 5 AND 120
      OR cardinality(v_scope) NOT BETWEEN 1 AND 40 OR EXISTS (SELECT 1 FROM unnest(v_scope) x WHERE x IS NULL) THEN 'invalid_input'
    WHEN EXISTS (SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS (
           SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = x AND k.support_class <> 'never')) THEN 'not_supportable' END;
  IF v_reason IS NOT NULL THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_open', p_tenant, NULL, 'denied', v_reason, p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', CASE v_reason WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  v_needs_owner := EXISTS (SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = ANY (v_scope) AND k.support_class IN ('personal','clinical'));
  INSERT INTO public.support_sessions (tenant_id, opened_by, purpose, scope, minutes, state, activated_at, ends_at)
  VALUES (p_tenant, c.staff_id, btrim(p_purpose), v_scope, p_minutes,
          CASE WHEN v_needs_owner THEN 'pending_approval' ELSE 'active' END,
          CASE WHEN v_needs_owner THEN NULL ELSE clock_timestamp() END,
          CASE WHEN v_needs_owner THEN NULL ELSE clock_timestamp() + make_interval(mins => p_minutes) END)
  RETURNING id INTO v_id;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_open', p_tenant, v_id, 'success',
                            CASE WHEN v_needs_owner THEN 'awaiting_owner' ELSE 'active' END, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'state', CASE WHEN v_needs_owner THEN 'pending_approval' ELSE 'active' END);
END
$function$
;--> statement-breakpoint
-- vendor_console_support_extend: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_support_extend(p_token text, p_ip text, p_session uuid, p_reason text, p_minutes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.support_session_tenant(p_session);
  c record;
  s public.support_sessions;
  v_reason text;
BEGIN
  SELECT * INTO c FROM public.support_caller(p_token, p_ip, 'support_extend', v_tenant, true, true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  SELECT * INTO s FROM public.support_sessions WHERE id = p_session FOR NO KEY UPDATE;
  v_reason := CASE
    WHEN NOT FOUND THEN 'not_found'
    WHEN s.opened_by <> c.staff_id THEN 'not_opener'
    WHEN NOT public.support_session_live(s) THEN 'not_active'
    WHEN s.extended_at IS NOT NULL THEN 'already_extended'
    WHEN EXISTS (SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = ANY (s.scope) AND k.support_class IN ('personal','clinical')) THEN 'needs_owner_approval'
    WHEN length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 500 OR btrim(p_reason) = s.purpose
      OR p_minutes IS NULL OR p_minutes NOT BETWEEN 5 AND 120 THEN 'invalid_input' END;
  IF v_reason IS NOT NULL THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_extend', v_tenant, p_session, 'denied', v_reason, p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', CASE v_reason WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  UPDATE public.support_sessions SET extended_at = clock_timestamp(), extension_reason = btrim(p_reason),
         ends_at = clock_timestamp() + make_interval(mins => p_minutes)
   WHERE id = p_session;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_extend', v_tenant, p_session, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true);
END
$function$
;--> statement-breakpoint
-- vendor_console_support_end: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_support_end(p_token text, p_ip text, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.support_session_tenant(p_session);
  c record;
BEGIN
  SELECT * INTO c FROM public.support_caller(p_token, p_ip, 'support_end', v_tenant, false, true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_sessions WHERE id = p_session AND opened_by = c.staff_id AND state <> 'ended')
     OR NOT public.support_session_end(p_session, 'operator', c.staff_id, c.account_id, c.role, NULL, p_ip) THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_end', v_tenant, p_session, 'denied', 'not_open', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '12 hours');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND', 'reason', 'not_open');
  END IF;
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '12 hours');
  RETURN jsonb_build_object('ok', true);
END
$function$
;--> statement-breakpoint
-- vendor_console_support_ticket: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_support_ticket(p_token text, p_ip text, p_session uuid, p_backend_pid integer, p_txid bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.support_session_tenant(p_session);
  c record;
  s public.support_sessions;
  v_reason text;
  v_id uuid;
  v_now timestamptz;
BEGIN
  SELECT * INTO c FROM public.support_caller(p_token, p_ip, 'support_bind', v_tenant, false, true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  SELECT * INTO s FROM public.support_sessions WHERE id = p_session;
  v_reason := CASE
    WHEN NOT FOUND THEN 'not_found'
    WHEN s.opened_by <> c.staff_id THEN 'not_opener'
    WHEN s.state = 'pending_approval' THEN 'awaiting_owner'
    WHEN NOT public.support_session_live(s) THEN 'not_active'
    WHEN p_backend_pid IS NULL OR p_backend_pid <= 0 OR p_txid IS NULL OR p_txid <= 0 OR p_txid >= txid_current()
      OR p_txid >> 32 <> txid_current() >> 32 -- same epoch: no alias of a live xid from an older epoch
      -- The pair is a live transaction of that backend (it holds its own transaction-id lock),
      -- and the backend is a support-reader login (review round 4): no ticket for another
      -- backend's or a console's transaction. pg_locks and pg_stat_activity.usesysid are
      -- readable without pg_read_all_stats.
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
                      WHERE l.locktype = 'transactionid' AND l.mode = 'ExclusiveLock' AND l.granted
                        AND l.pid = p_backend_pid AND l.transactionid = (p_txid % 4294967296)::text::xid)
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity a
                      WHERE a.pid = p_backend_pid AND pg_has_role(a.usesysid, 'clinic_operator', 'MEMBER')
                        AND NOT pg_has_role(a.usesysid, 'clinic_vendor', 'MEMBER')) THEN 'invalid_input' END;
  IF v_reason IS NOT NULL THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', v_tenant, p_session, 'denied', v_reason, p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '12 hours');
    RETURN jsonb_build_object('ok', false, 'code', CASE v_reason WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  v_now := clock_timestamp();
  BEGIN
    INSERT INTO public.support_bind_tickets (session_id, staff_id, auth_session_id, backend_pid, txid, issued_at, expires_at)
    VALUES (p_session, c.staff_id, (SELECT a.id FROM public.auth_session a WHERE a.token = p_token), p_backend_pid, p_txid, v_now, v_now + interval '2 minutes')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- One ticket per transaction (UNIQUE txid), also against a concurrent issue for the same
    -- txid under another tenant (staff_access is per tenant).
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', v_tenant, p_session, 'denied', 'ticket_exists', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '12 hours');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'ticket_exists');
  END;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', v_tenant, p_session, 'success', 'ticket_issued', p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '12 hours');
  RETURN jsonb_build_object('ok', true, 'ticket', v_id);
END
$function$
;--> statement-breakpoint
-- vendor_console_tenant_create: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_tenant_create(p_token text, p_ip text, p_legal_name text, p_sak text, p_branch_code text, p_branch_name text, p_timezone text, p_owner_name text, p_owner_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  w record;
  v_tenant uuid;
  v_branch uuid;
  v_invite uuid;
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
BEGIN
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, ARRAY['onboarding','platform_owner'], 'tenant_create', NULL);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  IF length(btrim(coalesce(p_legal_name, ''))) NOT BETWEEN 3 AND 160
     OR p_sak IS NULL OR p_sak NOT IN ('emkm','ep')
     OR p_branch_code IS NULL OR p_branch_code !~ '^[A-Z0-9]{2,8}$'
     OR length(btrim(coalesce(p_branch_name, ''))) NOT BETWEEN 2 AND 120
     OR p_timezone IS NULL OR p_timezone NOT IN ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura')
     OR length(btrim(coalesce(p_owner_name, ''))) NOT BETWEEN 2 AND 120
     OR length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'tenant_create', NULL, NULL, 'denied', 'invalid_input', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  INSERT INTO public.tenants_registry (lifecycle_state) VALUES ('provisioning') RETURNING id INTO v_tenant;
  INSERT INTO public.tenants (id, legal_name, sak_framework) VALUES (v_tenant, btrim(p_legal_name), p_sak);
  INSERT INTO public.branches (tenant_id, code, name, timezone) VALUES (v_tenant, p_branch_code, btrim(p_branch_name), p_timezone)
    RETURNING id INTO v_branch;
  INSERT INTO public.tenant_owner_invitations (tenant_id, email, display_name, requested_by)
  VALUES (v_tenant, v_email, btrim(p_owner_name), w.staff_id) RETURNING id INTO v_invite;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'tenant_create', v_tenant, v_tenant, 'success', NULL, p_ip);
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_request', v_tenant, v_invite, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'tenant_id', v_tenant, 'branch_id', v_branch, 'invitation_id', v_invite);
END
$function$
;--> statement-breakpoint
-- vendor_console_tenant_advance: writer: authority re-read before every exit after the guard (after its last wait)
CREATE OR REPLACE FUNCTION public.vendor_console_tenant_advance(p_token text, p_ip text, p_tenant uuid, p_to text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  w record;
  v_action text := CASE WHEN p_to IN ('onboarding','live') THEN 'tenant_' || p_to ELSE 'tenant_advance' END;
  v_reason text;
BEGIN
  -- staff_access before anything that can log or lock the tenant row (see
  -- tenant_lifecycle_lock): the guard's refusal log takes the audit lock.
  IF public.vendor_session_valid(p_token) AND p_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || p_tenant::text, 0));
  END IF;
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip,
    CASE WHEN p_to = 'live' THEN ARRAY['platform_owner'] ELSE ARRAY['onboarding','platform_owner'] END, v_action, p_tenant);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  IF p_to IS NULL OR p_to NOT IN ('onboarding','live') OR p_tenant IS NULL THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, v_action, p_tenant, p_tenant, 'denied', 'invalid_input', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, CASE WHEN p_to = 'live' THEN ARRAY['platform_owner'] ELSE ARRAY['onboarding','platform_owner'] END, interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  BEGIN
    PERFORM public.tenant_lifecycle_transition(p_tenant, p_to, p_reason, NULL, 'vendor_staff', w.staff_id::text);
  EXCEPTION
    WHEN SQLSTATE '42501' OR SQLSTATE '55000' OR SQLSTATE '22023' OR SQLSTATE 'P0002' THEN
      v_reason := CASE
        WHEN SQLERRM LIKE '%processor agreement%' THEN 'processor_agreement'
        WHEN SQLSTATE = '55000' THEN 'not_a_step'
        WHEN SQLSTATE = '22023' THEN 'invalid_input'
        WHEN SQLSTATE = 'P0002' THEN 'not_found'
        ELSE 'not_allowed' END;
      PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, v_action, p_tenant, p_tenant, 'denied', v_reason, p_ip);
      -- HYG-008b: authority re-read after the last wait, before this exit.
      PERFORM public.vendor_authority_recheck(p_token, p_ip, CASE WHEN p_to = 'live' THEN ARRAY['platform_owner'] ELSE ARRAY['onboarding','platform_owner'] END, interval '10 minutes');
      RETURN jsonb_build_object('ok', false,
        'code', CASE v_reason WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'not_a_step' THEN 'ERR_VERSION_CONFLICT' ELSE 'ERR_FORBIDDEN' END,
        'reason', v_reason);
  END;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, v_action, p_tenant, p_tenant, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, CASE WHEN p_to = 'live' THEN ARRAY['platform_owner'] ELSE ARRAY['onboarding','platform_owner'] END, interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'state', p_to);
END
$function$
;--> statement-breakpoint
-- vendor_console_staff_state: passes its token to vendor_staff_update_checked
CREATE OR REPLACE FUNCTION public.vendor_console_staff_state(p_token text, p_ip text, p_staff uuid, p_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record;
  v_roles text[];
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session');
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('active','suspended') THEN
    p_state := NULL; -- vendor_staff_update refuses and logs invalid input after its guard
  END IF;
  -- The lock every vendor staff change takes, before reading the roles: a concurrent role
  -- change either finishes first (and is read here) or waits, so it is never overwritten.
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_staff', 0));
  v_roles := ARRAY(SELECT r.role FROM public.vendor_staff_roles r WHERE r.staff_id = p_staff ORDER BY 1);
  RETURN public.vendor_staff_update_checked(p_token, v.account_id, p_ip, v.second_factor_at, p_staff, v_roles, p_state);
END
$function$
;--> statement-breakpoint
-- vendor_staff_update_checked (new): vendor_staff_update with the token, re-checked on success.
CREATE FUNCTION public.vendor_staff_update_checked(p_token text, p_actor uuid, p_ip text, p_mfa_at timestamp with time zone, p_staff uuid, p_roles text[], p_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  g record;
  s public.vendor_staff;
  r text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_staff', 0));
  SELECT * INTO g FROM public.vendor_guard(p_actor, p_ip, ARRAY['platform_owner'], 'vendor_staff_update', NULL, p_staff, p_mfa_at, interval '10 minutes');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  SELECT * INTO s FROM public.vendor_staff WHERE id = p_staff FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_update', NULL, p_staff, 'denied', 'not_found', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  IF s.id = g.staff_id THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_update', NULL, p_staff, 'denied', 'self_change', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'self_change');
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('active','suspended','exited') OR p_roles IS NULL OR cardinality(p_roles) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_roles) x WHERE x IS NULL OR x NOT IN ('platform_owner','onboarding','support','vendor_finance','vendor_auditor'))
     OR s.state = 'exited' THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_update', NULL, p_staff, 'denied', 'invalid_input', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  PERFORM public.vendor_account_lock(s.account_id);
  -- Reactivation re-checks the dual identity rule.
  IF p_state = 'active' AND s.state <> 'active' AND public.vendor_account_has_unapproved_membership(s.account_id) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_update', NULL, p_staff, 'denied', 'dual_identity_not_approved', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'dual_identity_not_approved');
  END IF;
  -- At least one active platform owner remains (checked before changing anything, so the
  -- refusal is logged). Defence in depth: the actor is itself an active platform owner and
  -- never changes itself, so this holds by construction today.
  IF NOT (p_state = 'active' AND 'platform_owner' = ANY (p_roles)) AND NOT EXISTS (
       SELECT 1 FROM public.vendor_staff v JOIN public.vendor_staff_roles x ON x.staff_id = v.id
          JOIN public.auth_user u ON u.id = v.account_id AND u.two_factor_enabled
        WHERE v.state = 'active' AND x.role = 'platform_owner' AND v.id <> p_staff) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_update', NULL, p_staff, 'denied', 'last_platform_owner', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'last_platform_owner');
  END IF;
  -- One log row per role removed or added (the role rows themselves are replaced).
  FOR r IN SELECT x.role FROM public.vendor_staff_roles x WHERE x.staff_id = p_staff AND x.role <> ALL (p_roles) ORDER BY 1 LOOP
    DELETE FROM public.vendor_staff_roles WHERE staff_id = p_staff AND role = r;
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_role', NULL, p_staff, 'success', 'role_removed_' || r, p_ip);
  END LOOP;
  FOR r IN SELECT DISTINCT x FROM unnest(p_roles) x WHERE NOT EXISTS (SELECT 1 FROM public.vendor_staff_roles y WHERE y.staff_id = p_staff AND y.role = x) ORDER BY 1 LOOP
    INSERT INTO public.vendor_staff_roles (staff_id, role) VALUES (p_staff, r);
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_role', NULL, p_staff, 'success', 'role_added_' || r, p_ip);
  END LOOP;
  UPDATE public.vendor_staff SET state = p_state, state_changed_at = CASE WHEN p_state <> s.state THEN now() ELSE state_changed_at END
   WHERE id = p_staff;
  PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_update', NULL, p_staff, 'success',
          CASE WHEN p_state <> s.state THEN 'state_' || p_state ELSE 'roles_changed' END, p_ip);
  -- HYG-008b: the authority re-read after the target row and account waits, before the change commits.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true);
END
$function$
;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_staff_update_checked(text, uuid, text, timestamp with time zone, uuid, text[], text) FROM PUBLIC;--> statement-breakpoint
-- operator_scope_allows: role, TOTP, second-factor age and address re-checked per row
CREATE OR REPLACE FUNCTION public.operator_scope_allows(p_table text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.support_session_bindings b
      JOIN public.support_sessions s ON s.id = b.session_id
      JOIN public.auth_session a ON a.id = b.auth_session_id
      JOIN public.vendor_staff v ON v.id = b.staff_id
     WHERE b.backend_pid = pg_backend_pid()
       AND b.txid = txid_current_if_assigned()
       -- The operator is still signed in and active (sign-out, lock or deactivation stops reads).
       AND a.surface = 'vendor' AND a.expires_at > clock_timestamp() AND a.locked_at IS NULL
       AND v.state = 'active' AND v.id = s.opened_by
       -- HYG-008b (A-01, R1-M2): the opener still holds a support-capable role, TOTP is still
       -- enrolled and the session's second factor is within 12 h, on every row.
       AND EXISTS (SELECT 1 FROM public.vendor_staff_roles r WHERE r.staff_id = v.id AND r.role IN ('support','onboarding','platform_owner'))
       AND EXISTS (SELECT 1 FROM public.auth_user u WHERE u.id = v.account_id AND u.two_factor_enabled)
       AND a.second_factor_at IS NOT NULL AND a.second_factor_at > clock_timestamp() - interval '12 hours'
       -- 9f (DEC-042): the binding's address is allowed while the allowlist is enforced.
       AND b.client_ip IS NOT NULL AND public.vendor_ip_allowed(b.client_ip)
       AND s.id = NULLIF(current_setting('app.operator_session_id', true), '')::uuid
       AND s.tenant_id = public.app_tenant_id()
       AND p_table = ANY (s.scope)
       AND public.support_session_live(s)
       AND EXISTS (SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = p_table AND k.support_class <> 'never'))
$function$
;--> statement-breakpoint
-- operator_row_read: scope judged again after the read-record insert
CREATE OR REPLACE FUNCTION public.operator_row_read(p_table text, p_tenant uuid, p_row uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER COST 1000
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM public.app_tenant_id() OR NOT public.operator_scope_allows(p_table) THEN
    RETURN false;
  END IF;
  INSERT INTO public.support_session_reads (session_id, table_name, row_id)
  VALUES (current_setting('app.operator_session_id')::uuid, p_table, p_row)
  ON CONFLICT (session_id, table_name, row_id) DO NOTHING;
  -- HYG-008b (5a): the insert can wait on another reader's uncommitted record of the same row;
  -- a revocation committed during that wait is seen by judging the scope again after it.
  IF NOT public.operator_scope_allows(p_table) THEN
    RETURN false;
  END IF;
  RETURN true;
END
$function$
;--> statement-breakpoint
-- support_session_bind: stores the binding's address (9f)
CREATE OR REPLACE FUNCTION public.support_session_bind(p_token text, p_ip text, p_session uuid, p_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.support_session_tenant(p_session);
  c record;
  s public.support_sessions;
  v_reason text;
BEGIN
  -- A read bind holds no lock that a revocation needs (the Owner's end, a deactivation, the
  -- sweep, staff changes): the same checks as vendor_guard without its FOR SHARE on the staff
  -- row; the operator predicate re-checks staff state and the login session on every row.
  SELECT * INTO c FROM public.support_read_caller(p_token, p_ip);
  IF c.refusal IS NOT NULL THEN
    IF c.refusal <> 'no_session' THEN
      PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', NULL, p_session, 'denied', c.refusal, p_ip);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  SELECT * INTO s FROM public.support_sessions WHERE id = p_session;
  v_reason := CASE
    WHEN NOT FOUND THEN 'not_found'
    -- The level is fixed at the transaction's first statement; this call is at least that.
    WHEN current_setting('transaction_isolation') <> 'read committed' THEN 'isolation_not_read_committed'
    WHEN s.opened_by <> c.staff_id THEN 'not_opener'
    WHEN s.state = 'pending_approval' THEN 'awaiting_owner'
    WHEN NOT public.support_session_live(s) THEN 'not_active' END;
  IF v_reason IS NULL THEN
    -- Consume the ticket. It names this backend and transaction, so it can never bind any other
    -- transaction (a rolled-back reader's txid is dead); used_at records the bind.
    UPDATE public.support_bind_tickets t SET used_at = clock_timestamp()
     WHERE t.id = p_ticket AND t.session_id = p_session AND t.staff_id = c.staff_id AND t.used_at IS NULL
       AND t.backend_pid = pg_backend_pid() AND t.txid = txid_current()
       AND t.expires_at > clock_timestamp()
       AND t.auth_session_id = (SELECT a.id FROM public.auth_session a WHERE a.token = p_token);
    IF NOT FOUND THEN
      v_reason := 'no_ticket';
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    -- Vendor log only, never the tenant chain: the chain's lock would be held by the reader's
    -- transaction (blocking the Owner's end and the sweep), and a REPEATABLE READ snapshot is
    -- older than the chain's tail. The attempt is already in the tenant chain as its ticket
    -- (ticket_issued); the session id names the tenant. The module commits the refusal.
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', NULL, p_session, 'denied', v_reason, p_ip);
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN v_reason = 'not_found' THEN 'ERR_NOT_FOUND' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  INSERT INTO public.support_session_bindings (session_id, backend_pid, txid, auth_session_id, staff_id, client_ip)
  VALUES (p_session, pg_backend_pid(), txid_current(), (SELECT a.id FROM public.auth_session a WHERE a.token = p_token), c.staff_id, left(p_ip, 64))
  ON CONFLICT (backend_pid, txid) DO UPDATE SET session_id = EXCLUDED.session_id, auth_session_id = EXCLUDED.auth_session_id,
                                                staff_id = EXCLUDED.staff_id, bound_at = clock_timestamp(), client_ip = EXCLUDED.client_ip;
  -- Default caps on statement and idle time. Hygiene, not a guarantee: the reader can override
  -- them with SET LOCAL. Revocation does not depend on them (the predicate runs per row under
  -- READ COMMITTED); the bound is the session's end time.
  PERFORM set_config('statement_timeout', '30s', true),
          set_config('idle_in_transaction_session_timeout', '60s', true);
  -- The durable record of this bind is its ticket ("ticket_issued", committed by the console).
  PERFORM set_config('app.tenant_id', s.tenant_id::text, true),
          set_config('app.operator_session_id', s.id::text, true),
          set_config('app.session_scope', array_to_string(s.scope, ','), true);
  RETURN jsonb_build_object('ok', true, 'tenant_id', s.tenant_id, 'scope', to_jsonb(s.scope), 'ends_at', s.ends_at);
END
$function$
;--> statement-breakpoint
-- support_session_expire: each session judged again after the tenant's lock
CREATE OR REPLACE FUNCTION public.support_session_expire()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT s.id, s.tenant_id, (t.lifecycle_state = 'closed') AS closed
             FROM public.support_sessions s JOIN public.tenants_registry t ON t.id = s.tenant_id
            WHERE s.state <> 'ended' AND (s.state = 'active' AND s.ends_at <= clock_timestamp() OR t.lifecycle_state = 'closed')
            ORDER BY s.tenant_id, s.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
    -- HYG-008b (A-03): judged again after the lock: an extension committed while the sweep waited
    -- keeps the session.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.support_sessions s JOIN public.tenants_registry t ON t.id = s.tenant_id
       WHERE s.id = r.id AND s.state <> 'ended'
         AND (s.state = 'active' AND s.ends_at <= clock_timestamp() OR t.lifecycle_state = 'closed'));
    IF public.support_session_end(r.id, CASE WHEN r.closed THEN 'tenant_closed' ELSE 'expired' END, NULL, NULL, NULL,
                                  public.vendor_service_name('support.expiry'), NULL) THEN
      n := n + 1;
    END IF;
  END LOOP;
  DELETE FROM public.support_session_bindings WHERE bound_at < clock_timestamp() - interval '1 day';
  RETURN n;
END
$function$
;--> statement-breakpoint
-- vendor_staff_invite_accept: expiry on the wall clock (after the global lock)
CREATE OR REPLACE FUNCTION public.vendor_staff_invite_accept(p_token_hash text, p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  i public.vendor_staff_invitations;
  v_email text;
  v_id uuid;
  r text;
  v_refusal text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_staff', 0));
  SELECT * INTO i FROM public.vendor_staff_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  IF i.state <> 'pending' OR i.expires_at <= clock_timestamp() THEN
    PERFORM public.vendor_staff_invite_log_refusal(i.id, 'not_open');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  PERFORM public.vendor_account_lock(p_account);
  SELECT email INTO v_email FROM public.auth_user WHERE id = p_account;
  v_refusal := CASE
    WHEN v_email IS NULL OR lower(v_email) <> i.email THEN 'email_mismatch'
    WHEN NOT EXISTS (SELECT 1 FROM public.vendor_staff s JOIN public.vendor_staff_roles x ON x.staff_id = s.id
                      WHERE s.id = i.invited_by AND s.state = 'active' AND x.role = 'platform_owner') THEN 'inviter_not_authorised'
    WHEN EXISTS (SELECT 1 FROM public.vendor_staff WHERE account_id = p_account) THEN 'already_vendor_staff'
    WHEN public.vendor_account_has_unapproved_membership(p_account) THEN 'dual_identity_not_approved' END;
  IF v_refusal IS NOT NULL THEN
    -- Attributed to the invitation only: the caller removes the just-created account after
    -- a refusal, which a log row naming it (FK, ON DELETE RESTRICT) would block.
    PERFORM public.vendor_staff_invite_log_refusal(i.id, v_refusal);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', v_refusal);
  END IF;
  INSERT INTO public.vendor_staff (account_id, display_name) VALUES (p_account, i.display_name) RETURNING id INTO v_id;
  FOREACH r IN ARRAY i.roles LOOP
    INSERT INTO public.vendor_staff_roles (staff_id, role) VALUES (v_id, r);
    PERFORM public.vendor_log(i.invited_by, NULL, 'platform_owner', 'vendor_staff_role', NULL, v_id, 'success', 'role_added_' || r, NULL);
  END LOOP;
  UPDATE public.vendor_staff_invitations SET state = 'accepted', accepted_staff = v_id, closed_at = now() WHERE id = i.id;
  PERFORM public.vendor_log(v_id, p_account, NULL, 'vendor_staff_invite_accept', NULL, i.id, 'success', NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'staff_id', v_id);
END
$function$
;--> statement-breakpoint
-- vendor_request_consume: 30-day approval limit on the wall clock
CREATE OR REPLACE FUNCTION public.vendor_request_consume(p_request uuid, p_kind text, p_tenant uuid, p_service text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  q public.vendor_requests;
  v_refusal text;
BEGIN
  IF p_service IS NULL OR p_service !~ '^[a-z][a-z_.-]{1,60}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a named executing service consumes a request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO q FROM public.vendor_requests WHERE id = p_request FOR UPDATE;
  v_refusal := CASE
    WHEN q.id IS NULL OR q.kind IS DISTINCT FROM p_kind OR q.kind = 'dual_identity' OR q.tenant_id IS DISTINCT FROM p_tenant THEN 'not_found'
    WHEN q.state <> 'approved' THEN 'not_approved'
    WHEN q.consumed_at IS NOT NULL THEN 'already_consumed'
    WHEN q.decided_at < clock_timestamp() - interval '30 days' THEN 'approval_expired'
    WHEN q.kind = 'server_fee_change' AND q.payload ->> 'effective_month' <= to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') THEN 'effective_month_passed'
    WHEN NOT EXISTS (SELECT 1 FROM public.vendor_staff v JOIN public.vendor_staff_roles r ON r.staff_id = v.id AND r.role = 'platform_owner'
                      WHERE v.id = q.decided_by AND v.state = 'active') THEN 'approver_inactive' END;
  IF v_refusal IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: vendor request not executable (%)', v_refusal USING ERRCODE = '42501';
  END IF;
  UPDATE public.vendor_requests SET consumed_at = now() WHERE id = p_request;
  PERFORM public.vendor_log(NULL, NULL, NULL, 'request_consume', q.tenant_id, p_request, 'success', NULL, NULL, NULL, public.vendor_service_name(p_service));
  RETURN q.payload;
END
$function$
;--> statement-breakpoint
-- B-01 and B-03 (operator side): clinic_operator reads exactly the columns clinic_app reads on
-- these tables (TEN-19 projections): no evidence_files.content, no staff_invitations.token_hash,
-- no evidence_approvals.seq. src/db/rls/operator.sql stays the tail of 0046 (an applied migration
-- is never edited); the effective privileges are asserted by tests/rls/vendor-authority.test.ts.
REVOKE SELECT ON public.evidence_files, public.staff_invitations, public.evidence_approvals FROM clinic_operator;--> statement-breakpoint
GRANT SELECT (id, tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name, uploaded_at)
  ON public.evidence_files TO clinic_operator;--> statement-breakpoint
GRANT SELECT (id, tenant_id, email, display_name, roles, branch_ids, invited_by, invited_at, expires_at, state, accepted_staff_id, closed_at)
  ON public.staff_invitations TO clinic_operator;--> statement-breakpoint
GRANT SELECT (id, tenant_id, item_id, file_id, config_version, decision, reason, valid_until, decided_by, decided_as, decided_name, decided_at)
  ON public.evidence_approvals TO clinic_operator;
