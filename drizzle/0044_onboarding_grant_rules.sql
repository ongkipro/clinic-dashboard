-- T-024 (PR-58, TEN-13): onboarding grant and owner-confirmed invitation drafts.
-- Both tables are platform tables (no direct read from any application role); the vendor
-- console reaches them through session-token functions behind vendor_guard, the clinic
-- Owner through SECURITY DEFINER functions bound to app_tenant_id().

ALTER TABLE public.onboarding_grants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.onboarding_invitation_drafts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.onboarding_grants', 'platform', 'vendor', '{}', 'onboarding grant functions (src/modules/vendor/onboarding)', 'none'),
  ('public.onboarding_invitation_drafts', 'platform', 'vendor', '{}', 'onboarding grant functions (src/modules/vendor/onboarding)', 'none');--> statement-breakpoint

-- Grants: never deleted; only end, renew once. Drafts: draft → confirmed | declined, once.
CREATE FUNCTION public.onboarding_grants_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'onboarding grants are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.tenant_id, NEW.granted_at) IS DISTINCT FROM (OLD.tenant_id, OLD.granted_at)
     OR OLD.ended_at IS NOT NULL
     OR OLD.renewed_at IS NOT NULL AND (NEW.renewed_at, NEW.renewed_by_staff, NEW.expires_at) IS DISTINCT FROM (OLD.renewed_at, OLD.renewed_by_staff, OLD.expires_at)
     OR OLD.renewed_at IS NULL AND NEW.renewed_at IS NULL AND NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'an onboarding grant only ends or is renewed once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER onboarding_grants_guard BEFORE UPDATE OR DELETE ON public.onboarding_grants
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_grants_guard();--> statement-breakpoint
ALTER TABLE public.onboarding_grants ENABLE ALWAYS TRIGGER onboarding_grants_guard;--> statement-breakpoint
CREATE TRIGGER onboarding_grants_no_truncate BEFORE TRUNCATE ON public.onboarding_grants
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

CREATE FUNCTION public.onboarding_invitation_drafts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invitation drafts are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.email, NEW.display_name, NEW.roles, NEW.branch_ids, NEW.drafted_by, NEW.drafted_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.email, OLD.display_name, OLD.roles, OLD.branch_ids, OLD.drafted_by, OLD.drafted_at)
     OR OLD.state <> 'draft' OR NEW.state NOT IN ('confirmed','declined') THEN
    RAISE EXCEPTION 'an invitation draft is decided once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER onboarding_invitation_drafts_guard BEFORE UPDATE OR DELETE ON public.onboarding_invitation_drafts
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_invitation_drafts_guard();--> statement-breakpoint
ALTER TABLE public.onboarding_invitation_drafts ENABLE ALWAYS TRIGGER onboarding_invitation_drafts_guard;--> statement-breakpoint
CREATE TRIGGER onboarding_invitation_drafts_no_truncate BEFORE TRUNCATE ON public.onboarding_invitation_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- The grant follows the lifecycle (T-022 history is append-only): entering onboarding
-- creates it (30 days); leaving onboarding ends it (go_live when the next state is live).
CREATE FUNCTION public.onboarding_grant_follow_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- The grant's lock order (staff_access, then the grant row) holds here too: a vendor
  -- transaction holding staff_access never waits on a grant row this transaction holds.
  IF NEW.to_state = 'onboarding' OR NEW.from_state = 'onboarding' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  END IF;
  IF NEW.to_state = 'onboarding' THEN
    INSERT INTO public.onboarding_grants (tenant_id, granted_at, expires_at) VALUES (NEW.tenant_id, now(), now() + interval '30 days')
      ON CONFLICT (tenant_id) DO NOTHING;
  ELSIF NEW.from_state = 'onboarding' THEN
    UPDATE public.onboarding_grants SET ended_at = now(), end_reason = CASE WHEN NEW.to_state = 'live' THEN 'go_live' ELSE 'left_onboarding' END
     WHERE tenant_id = NEW.tenant_id AND ended_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_grant_follow_lifecycle() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER tenant_lifecycle_events_onboarding_grant AFTER INSERT ON public.tenant_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_grant_follow_lifecycle();--> statement-breakpoint
ALTER TABLE public.tenant_lifecycle_events ENABLE ALWAYS TRIGGER tenant_lifecycle_events_onboarding_grant;--> statement-breakpoint

-- Configuration object kinds a grant covers (TEN-13). Everything else (every clinical kind,
-- personal data, money) is outside the grant.
CREATE FUNCTION public.onboarding_grant_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ARRAY['branches','catalog','staff_invitations','imports','branding','templates']
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_grant_kinds() FROM PUBLIC;--> statement-breakpoint

-- Is the tenant's grant active now (not ended, not expired, tenant in onboarding)? Locks the
-- grant row for share so a concurrent go-live or renewal is seen. clock_timestamp(), not
-- now(): a long transaction (or one that waited on a lock) must not use a grant that
-- expired since the transaction started.
CREATE FUNCTION public.onboarding_grant_active(p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g public.onboarding_grants;
BEGIN
  -- Lock first, judge after: a predicate evaluated before a lock wait is not re-evaluated
  -- for elapsed time, so expiry is checked only once the row is held.
  SELECT * INTO g FROM public.onboarding_grants WHERE tenant_id = p_tenant FOR SHARE;
  RETURN FOUND AND g.ended_at IS NULL AND g.expires_at > clock_timestamp()
     AND EXISTS (SELECT 1 FROM public.tenants_registry r WHERE r.id = p_tenant AND r.lifecycle_state = 'onboarding');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_grant_active(uuid) FROM PUBLIC;--> statement-breakpoint

-- The one authority for vendor configuration work in a tenant (PR-58): the caller (session +
-- vendor_guard: onboarding or platform owner; writes with the 10-minute step-up) and the
-- grant (active, kind covered). Every result reaches the vendor log and, for a known tenant,
-- the tenant's audit chain (vendor_log, SEC-16). Returns the caller or the refusal.
CREATE FUNCTION public.onboarding_grant_check(p_token text, p_ip text, p_tenant uuid, p_kind text, p_write boolean,
                                              OUT account_id uuid, OUT staff_id uuid, OUT role text, OUT refusal text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
  v_action text := 'onboarding_' || CASE WHEN p_write THEN 'write' ELSE 'read' END;
BEGIN
  -- The session first (reads auth_session only: no log, no lock), so a caller without one
  -- never takes the clinic's staff_access lock. Then staff_access, before anything that can
  -- log (vendor_guard logs refusals, taking the tenant's audit lock): the per-tenant order is
  -- staff_access, tenant row, grant row, audit. Only for a tenant that exists.
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    -- Not logged, as every console entry point (T-021 vendor_console_guard, T-023): there is
    -- no one to attribute, and an unauthenticated caller who knows a tenant id must not be
    -- able to write rows into that tenant's audit chain (flooding). The console route only
    -- calls this with the session cookie it was given.
    refusal := 'no_session';
    RETURN;
  END IF;
  IF p_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || p_tenant::text, 0));
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, ARRAY['onboarding','platform_owner'], v_action, p_tenant, p_tenant,
                                           v.second_factor_at, CASE WHEN p_write THEN interval '10 minutes' ELSE interval '12 hours' END);
  IF g.refusal IS NOT NULL THEN
    refusal := g.refusal;
    RETURN;
  END IF;
  account_id := v.account_id;
  staff_id := g.staff_id;
  role := g.role;
  refusal := CASE
    WHEN p_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN 'not_found'
    WHEN p_kind IS NULL OR p_kind <> ALL (public.onboarding_grant_kinds()) THEN 'not_in_grant'
    WHEN NOT public.onboarding_grant_active(p_tenant) THEN 'grant_not_active' END;
  -- The object kind asked for is recorded as the reason of a refusal (bounded, a-z_ only).
  PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, v_action, p_tenant, p_tenant,
            CASE WHEN refusal IS NULL THEN 'success' ELSE 'denied' END,
            CASE WHEN refusal IS NULL THEN 'kind_' || p_kind
                 -- 'not_in_grant_' + kind must fit audit_events.reason_code (^[a-z][a-z_]{1,40}$).
                 WHEN refusal = 'not_in_grant' AND p_kind ~ '^[a-z][a-z_]{1,27}$' THEN 'not_in_grant_' || p_kind
                 ELSE refusal END, p_ip);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_grant_check(text, text, uuid, text, boolean) FROM PUBLIC;--> statement-breakpoint

-- Console entry: may this caller open <kind> in this tenant now? (reads; the console's
-- configuration screens and later tasks' writes call onboarding_grant_check themselves).
CREATE FUNCTION public.vendor_console_onboarding_access(p_token text, p_ip text, p_tenant uuid, p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public.onboarding_grant_check(p_token, p_ip, p_tenant, p_kind, false);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN c.refusal = 'not_found' THEN 'ERR_NOT_FOUND' ELSE 'ERR_FORBIDDEN' END, 'reason', c.refusal);
  END IF;
  RETURN jsonb_build_object('ok', true,
    'expires_at', (SELECT expires_at FROM public.onboarding_grants WHERE tenant_id = p_tenant));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_onboarding_access(text, text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_onboarding_access(text, text, uuid, text) TO clinic_vendor;--> statement-breakpoint

-- Onboarding staff prepare a staff invitation (TEN-13): a draft until the Owner confirms.
-- Level 3 roles only; never an email of a vendor staff account (any state) — so a vendor
-- cannot invite itself, as Owner or anything else; branches of this tenant only.
CREATE FUNCTION public.vendor_console_onboarding_invite(p_token text, p_ip text, p_tenant uuid, p_email text, p_name text, p_roles text[], p_branches uuid[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN v_reason = 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  -- The check's vendor_log (after it judged the grant) may have waited on the tenant's
  -- audit lock: judge the grant again immediately before writing.
  IF NOT public.onboarding_grant_active(p_tenant) THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'onboarding_invite', p_tenant, NULL, 'denied', 'grant_not_active', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'grant_not_active');
  END IF;
  INSERT INTO public.onboarding_invitation_drafts (tenant_id, email, display_name, roles, branch_ids, drafted_by)
  VALUES (p_tenant, v_email, btrim(p_name), p_roles, p_branches, c.staff_id) RETURNING id INTO v_id;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'onboarding_invite', p_tenant, v_id, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_onboarding_invite(text, text, uuid, text, text, text[], uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_onboarding_invite(text, text, uuid, text, text, text[], uuid[]) TO clinic_vendor;--> statement-breakpoint

-- ── the clinic Owner (clinic_app, bound to app_tenant_id) ───────────────────────────────
-- The acting Owner of this tenant, under the staff_access lock (as every access change).
CREATE FUNCTION public.onboarding_owner() RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.staff_admin_lock();
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the Owner decides vendor onboarding work' USING ERRCODE = '42501';
  END IF;
  RETURN a.staff_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_owner() FROM PUBLIC;--> statement-breakpoint

-- Akses Vendor data (UX-48, page in T-028): the grant and the drafts awaiting the Owner.
CREATE FUNCTION public.onboarding_grant_status() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
BEGIN
  PERFORM public.onboarding_owner();
  RETURN jsonb_build_object(
    'grant', (SELECT jsonb_build_object('granted_at', g.granted_at, 'expires_at', g.expires_at, 'renewed', g.renewed_at IS NOT NULL,
                                        'ended_at', g.ended_at, 'end_reason', g.end_reason, 'active', public.onboarding_grant_active(g.tenant_id))
                FROM public.onboarding_grants g WHERE g.tenant_id = v_tenant),
    'drafts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'email', d.email, 'name', d.display_name, 'roles', to_jsonb(d.roles),
                                                           'branch_ids', to_jsonb(d.branch_ids), 'drafted_by', s.display_name, 'drafted_at', d.drafted_at)
                                         ORDER BY d.drafted_at)
                          FROM public.onboarding_invitation_drafts d JOIN public.vendor_staff s ON s.id = d.drafted_by
                         WHERE d.tenant_id = v_tenant AND d.state = 'draft'), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_grant_status() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.onboarding_grant_status() TO clinic_app;--> statement-breakpoint

-- Confirm a draft: a normal invitation from the Owner through staff_invite (same rules,
-- lock and audit as any invitation; the Owner sends the one-time link). The draft records
-- the invitation it became.
CREATE FUNCTION public.onboarding_draft_confirm(p_draft uuid, p_token_hash text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_owner uuid := public.onboarding_owner();
  d public.onboarding_invitation_drafts;
  v_inv uuid;
BEGIN
  SELECT * INTO d FROM public.onboarding_invitation_drafts WHERE tenant_id = public.app_tenant_id() AND id = p_draft FOR UPDATE;
  IF NOT FOUND OR d.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no draft awaiting confirmation' USING ERRCODE = 'P0002';
  END IF;
  -- The email may have become a vendor account since the draft (TEN-13).
  IF EXISTS (SELECT 1 FROM public.vendor_staff s JOIN public.auth_user u ON u.id = s.account_id WHERE lower(u.email) = d.email) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: membership not allowed for this account' USING ERRCODE = '42501';
  END IF;
  v_inv := public.staff_invite(d.email, d.display_name, d.roles, d.branch_ids, p_token_hash, 7);
  UPDATE public.onboarding_invitation_drafts SET state = 'confirmed', decided_by_staff = v_owner, decided_at = now(), invitation_id = v_inv WHERE id = d.id;
  PERFORM public.audit_append('settings_change', 'onboarding_draft', d.id, 'success', 'onboarding_draft_confirmed');
  RETURN v_inv;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_draft_confirm(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.onboarding_draft_confirm(uuid, text) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.onboarding_draft_decline(p_draft uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_owner uuid := public.onboarding_owner();
BEGIN
  UPDATE public.onboarding_invitation_drafts SET state = 'declined', decided_by_staff = v_owner, decided_at = now()
   WHERE tenant_id = public.app_tenant_id() AND id = p_draft AND state = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no draft awaiting confirmation' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('settings_change', 'onboarding_draft', p_draft, 'success', 'onboarding_draft_declined');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_draft_decline(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.onboarding_draft_decline(uuid) TO clinic_app;--> statement-breakpoint

-- Renew once (PR-58): 30 days from now, only while active, by the Owner.
CREATE FUNCTION public.onboarding_grant_renew() RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_owner uuid := public.onboarding_owner();
  v_tenant uuid := public.app_tenant_id();
  v_until timestamptz;
BEGIN
  -- onboarding_owner() holds staff_access, and every vendor path takes staff_access before
  -- the grant row, so no vendor transaction holds the row here. The UPDATE repeats the
  -- conditions at the moment it writes (clock_timestamp()).
  IF NOT public.onboarding_grant_active(v_tenant) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no active onboarding grant' USING ERRCODE = '55000';
  END IF;
  UPDATE public.onboarding_grants SET renewed_at = clock_timestamp(), renewed_by_staff = v_owner, expires_at = clock_timestamp() + interval '30 days'
   WHERE tenant_id = v_tenant AND renewed_at IS NULL AND ended_at IS NULL AND expires_at > clock_timestamp()
   RETURNING expires_at INTO v_until;
  IF v_until IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the onboarding grant was renewed already' USING ERRCODE = '55000';
  END IF;
  PERFORM public.audit_append('settings_change', 'onboarding_grant', v_tenant, 'success', 'onboarding_grant_renewed');
  RETURN v_until;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_grant_renew() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.onboarding_grant_renew() TO clinic_app;
--> statement-breakpoint

-- Has this token a live vendor session? (No log, no lock; used to decide whether to take a
-- clinic lock at all.)
CREATE FUNCTION public.vendor_session_valid(p_token text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (SELECT account_id FROM public.vendor_session(p_token)) IS NOT NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_session_valid(text) FROM PUBLIC;--> statement-breakpoint

-- One lock order per tenant for everything that touches the onboarding grant (T-024 review
-- round 5): the tenant's staff_access lock, then the tenant row (tenants_registry), then the
-- grant row, then the audit chain. Vendor checks hold staff_access and later need the tenant
-- row for share (vendor_log's foreign key); a lifecycle edge that locked the tenant row first
-- and then waited for staff_access (the grant trigger) would deadlock with them. Every
-- lifecycle entry point therefore takes staff_access before the tenant row.
CREATE OR REPLACE FUNCTION public.tenant_lifecycle_lock(p_tenant uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || p_tenant::text, 0));
  PERFORM 1 FROM public.tenants_registry WHERE id = p_tenant FOR UPDATE;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tenant_lifecycle_apply_request(p_request uuid, p_kind text, p_tenant uuid, p_service text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_to text := CASE p_kind WHEN 'suspension' THEN 'suspended' WHEN 'reactivation' THEN 'live' WHEN 'exit' THEN 'exit' WHEN 'closure' THEN 'closed' END;
  v_reason text;
BEGIN
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not a lifecycle request (not_found)' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || p_tenant::text, 0));
  PERFORM 1 FROM public.tenants_registry WHERE id = p_tenant FOR UPDATE;
  PERFORM public.vendor_request_consume(p_request, p_kind, p_tenant, p_service);
  SELECT reason INTO STRICT v_reason FROM public.vendor_requests WHERE id = p_request;
  RETURN public.tenant_lifecycle_transition(p_tenant, v_to, v_reason, p_request, 'service', p_service);
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.vendor_console_tenant_advance(p_token text, p_ip text, p_tenant uuid, p_to text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
      RETURN jsonb_build_object('ok', false,
        'code', CASE v_reason WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'not_a_step' THEN 'ERR_VERSION_CONFLICT' ELSE 'ERR_FORBIDDEN' END,
        'reason', v_reason);
  END;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, v_action, p_tenant, p_tenant, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true, 'state', p_to);
END
$$;
