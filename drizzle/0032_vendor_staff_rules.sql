-- T-020 (PR-57, IAM-10, DATA-48, SEC-16). Vendor staff, roles, the console IP allowlist,
-- maker-checker requests and the vendor action log are platform tables: clinic_app has no
-- privilege on them (TEN-16). The vendor console (T-021) runs on the platform operator
-- connection and calls the vendor_* functions below with the signed-in account and the
-- client IP; each function verifies the actor (active vendor staff, TOTP enrolled, the
-- needed role, an allowed IP) and logs the action, allowed or refused. The one clinic-side
-- step — a clinic owner approving a dual vendor/clinic identity — is a SECURITY DEFINER
-- function for clinic_app bound to the owner's tenant context.
-- clinic_vendor: the vendor console's database role (T-021 logs in as a member). It holds
-- EXECUTE on the vendor_* command functions below (SECURITY DEFINER) and no privilege on
-- any table, so a console bug or injection cannot edit roles, the allowlist or history
-- directly. Created with safe attributes like clinic_app (0003).
-- clinic_executor: the role of the workers that apply approved requests (suspension, exit,
-- fee change, waiver, clinical grant). It may only consume a request and record a refused
-- consumption; no table privilege.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['clinic_vendor','clinic_executor'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I NOLOGIN', r);
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL;
      END;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r
               AND (rolsuper OR rolbypassrls OR rolreplication OR rolcreaterole OR rolcreatedb OR rolcanlogin)) THEN
      RAISE EXCEPTION 'role % exists with unsafe attributes; fix it as a superuser', r;
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
ALTER TABLE public.vendor_staff ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_staff_roles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_ip_allowlist ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_actions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Is this IP inside the console allowlist? Fails closed: no allowlist entries, a NULL or
-- unparseable address → false.
-- One client host address (no prefix, no spaces), IPv4-mapped IPv6 as IPv4; NULL if not.
CREATE FUNCTION public.vendor_ip_norm(p_ip text) RETURNS inet
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v inet;
BEGIN
  IF p_ip IS NULL OR p_ip !~ '^[0-9A-Fa-f:.]{2,45}$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v := p_ip::inet;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF lower(host(v)) LIKE '::ffff:%.%' THEN
    v := substr(host(v), 8)::inet;
  END IF;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_ip_norm(text) FROM PUBLIC;--> statement-breakpoint
-- Fail closed: an empty allowlist or an unparseable address refuses.
CREATE FUNCTION public.vendor_ip_allowed(p_ip text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT EXISTS (SELECT 1 FROM public.vendor_ip_allowlist a WHERE public.vendor_ip_norm(p_ip) <<= a.cidr::cidr)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_ip_allowed(text) FROM PUBLIC;--> statement-breakpoint
-- A range is a valid CIDR no wider than /16 (IPv4) or /32 (IPv6): never "everyone".
ALTER TABLE public.vendor_ip_allowlist ADD CONSTRAINT vendor_ip_allowlist_cidr_check
  CHECK (masklen(cidr::cidr) >= CASE family(cidr::cidr) WHEN 4 THEN 16 ELSE 32 END);--> statement-breakpoint

-- Append one vendor action row (internal).
-- Append one vendor action row (internal). Unknown account or tenant ids are kept as NULL
-- so the refusal row always commits. Every action on a tenant by known vendor staff is
-- also written to that clinic's audit chain (SEC-16), attributed to the vendor staff.
CREATE FUNCTION public.vendor_log(p_staff uuid, p_account uuid, p_role text, p_action text, p_tenant uuid, p_object uuid,
                                  p_outcome text, p_reason text, p_ip text, p_detail text DEFAULT NULL, p_service text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_account uuid := (SELECT id FROM public.auth_user WHERE id = p_account);
  v_tenant uuid := (SELECT id FROM public.tenants_registry WHERE id = p_tenant);
  v_prev text;
  v_seq bigint;
  v_row public.audit_events;
BEGIN
  INSERT INTO public.vendor_actions (staff_id, account_id, acting_role, action, tenant_id, object_id, outcome, reason_code, detail, client_ip)
  VALUES (p_staff, v_account, coalesce(p_role, 'service:' || p_service), p_action, v_tenant, p_object, p_outcome, p_reason, p_detail, left(p_ip, 64));
  IF p_staff IS NULL AND p_service IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant) THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || v_tenant::text, 0));
  SELECT e.hash, e.seq INTO v_prev, v_seq FROM public.audit_events e WHERE e.tenant_id = v_tenant ORDER BY e.seq DESC LIMIT 1;
  v_row := ROW(
    public.uuid_generate_v7(), v_tenant, coalesce(v_seq, 0) + 1, clock_timestamp(),
    v_account, NULL, NULL, CASE WHEN p_staff IS NOT NULL THEN 'vendor:' || coalesce(p_role, 'none') END, NULL, NULL, p_staff,
    CASE WHEN p_staff IS NULL THEN p_service END, NULL,
    'approval', left(p_action, 41), p_object, p_outcome, p_reason, NULL,
    coalesce(v_prev, repeat('0', 64)), repeat('0', 64))::public.audit_events;
  v_row.hash := encode(public.digest(v_row.prev_hash || public.audit_canonical(v_row), 'sha256'), 'hex');
  INSERT INTO public.audit_events SELECT v_row.*;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_log(uuid, uuid, text, text, uuid, uuid, text, text, text, text, text) FROM PUBLIC;--> statement-breakpoint



-- The acting vendor staff member for an action: the account's vendor_staff row must be
-- active, TOTP enrolled, the request from an allowed IP, and holding one of p_roles (the
-- first held in p_roles order is the acting role). Refusals are logged (outcome denied)
-- and returned as a code; callers return it instead of raising, so the log row commits.
-- p_second_factor_at: when the vendor session last passed its TOTP challenge (the vendor
-- console's sign-in or a step-up, T-021); it must be within p_max_age: 12 hours for
-- requests, 10 minutes for approvals and staff or allowlist changes (step-up). The console passes the
-- account and the time from its own server-side session, never from the request body.
CREATE FUNCTION public.vendor_guard(p_account uuid, p_ip text, p_roles text[], p_action text, p_tenant uuid, p_object uuid,
                                    p_second_factor_at timestamptz, p_max_age interval,
                                    OUT staff_id uuid, OUT role text, OUT refusal text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s public.vendor_staff;
  v_totp boolean;
  v_known boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.auth_user WHERE id = p_account), (SELECT two_factor_enabled FROM public.auth_user WHERE id = p_account)
    INTO v_known, v_totp;
  -- The staff row is locked for share: a concurrent demotion or suspension waits for this
  -- action (or this action sees it).
  SELECT * INTO s FROM public.vendor_staff WHERE account_id = p_account FOR SHARE;
  refusal := CASE
    WHEN s.id IS NULL THEN 'not_vendor_staff'
    WHEN s.state <> 'active' THEN 'vendor_staff_inactive'
    WHEN v_totp IS NOT TRUE THEN 'totp_required'
    WHEN p_second_factor_at IS NULL OR p_second_factor_at > now() + interval '1 minute' OR p_second_factor_at < now() - p_max_age THEN 'totp_not_verified'
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_guard(uuid, text, text[], text, uuid, uuid, timestamptz, interval) FROM PUBLIC;--> statement-breakpoint

-- Vendor and clinic identities of one account change one at a time (both sides take it).
CREATE FUNCTION public.vendor_account_lock(p_account uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('vendor_account:' || p_account::text, 0))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_account_lock(uuid) FROM PUBLIC;--> statement-breakpoint

-- Does the account hold a clinic membership (active now) in a tenant without an approved
-- dual identity for that tenant (IAM-10)?
CREATE FUNCTION public.vendor_dual_approved(p_account uuid, p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.vendor_requests r
                  WHERE r.kind = 'dual_identity' AND r.tenant_id = p_tenant AND r.state = 'approved'
                    AND r.clinic_approved_at IS NOT NULL AND r.payload ->> 'account_id' = p_account::text)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_dual_approved(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.vendor_account_has_unapproved_membership(p_account uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = p_account AND (m.effective_to IS NULL OR m.effective_to > now())
                    AND NOT public.vendor_dual_approved(p_account, m.tenant_id))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_account_has_unapproved_membership(uuid) FROM PUBLIC;--> statement-breakpoint

-- First platform owner and first allowlist entry, once (no vendor staff yet). Run by the
-- operator during setup; logged without an actor.
CREATE FUNCTION public.vendor_bootstrap(p_account uuid, p_name text, p_cidr text, p_label text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
  v_cidr text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_staff', 0));
  IF EXISTS (SELECT 1 FROM public.vendor_staff) THEN
    PERFORM public.vendor_log(NULL, p_account, NULL, 'vendor_bootstrap', NULL, NULL, 'denied', 'already_bootstrapped', NULL);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'already_bootstrapped');
  END IF;
  BEGIN
    v_cidr := p_cidr::cidr::text;
  EXCEPTION WHEN others THEN
    v_cidr := NULL;
  END;
  IF v_cidr IS NULL OR masklen(v_cidr::cidr) < (CASE family(v_cidr::cidr) WHEN 4 THEN 16 ELSE 32 END)
     OR length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 120 OR length(btrim(coalesce(p_label, ''))) NOT BETWEEN 2 AND 80
     OR NOT EXISTS (SELECT 1 FROM public.auth_user WHERE id = p_account) THEN
    PERFORM public.vendor_log(NULL, p_account, NULL, 'vendor_bootstrap', NULL, NULL, 'denied', 'invalid_input', NULL);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  PERFORM public.vendor_account_lock(p_account);
  IF public.vendor_account_has_unapproved_membership(p_account) THEN
    PERFORM public.vendor_log(NULL, p_account, NULL, 'vendor_bootstrap', NULL, NULL, 'denied', 'dual_identity_not_approved', NULL);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'dual_identity_not_approved');
  END IF;
  INSERT INTO public.vendor_staff (account_id, display_name) VALUES (p_account, btrim(p_name)) RETURNING id INTO v_id;
  INSERT INTO public.vendor_staff_roles (staff_id, role) VALUES (v_id, 'platform_owner');
  INSERT INTO public.vendor_ip_allowlist (cidr, label) VALUES (v_cidr, btrim(p_label));
  PERFORM public.vendor_log(NULL, p_account, NULL, 'vendor_bootstrap', NULL, v_id, 'success', NULL, NULL, v_cidr);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_bootstrap(uuid, text, text, text) FROM PUBLIC;--> statement-breakpoint

-- A clinic membership for an account that is vendor staff (not exited) needs an approved
-- dual identity for that tenant: platform owner and that clinic's owner (IAM-10). Every
-- path that creates memberships (invitations, provisioning) passes here.
CREATE FUNCTION public.memberships_vendor_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- Ending a membership is always allowed (offboarding).
  IF NEW.effective_to IS NOT NULL AND NEW.effective_to <= now() THEN
    RETURN NEW;
  END IF;
  PERFORM public.vendor_account_lock(NEW.account_id);
  IF EXISTS (SELECT 1 FROM public.vendor_staff s WHERE s.account_id = NEW.account_id AND s.state <> 'exited')
     AND NOT public.vendor_dual_approved(NEW.account_id, NEW.tenant_id) THEN
    -- Generic for the clinic side (does not reveal that the account is vendor staff).
    RAISE EXCEPTION 'ERR_FORBIDDEN: membership not allowed for this account' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER memberships_vendor_guard BEFORE INSERT OR UPDATE OF account_id, tenant_id, effective_from, effective_to ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.memberships_vendor_guard();--> statement-breakpoint
ALTER TABLE public.memberships ENABLE ALWAYS TRIGGER memberships_vendor_guard;--> statement-breakpoint

-- Tim Vendor (UX-46): the platform owner adds a vendor staff member with roles. The account
-- must have no clinic membership without an approved dual identity.
CREATE FUNCTION public.vendor_staff_create(p_actor uuid, p_ip text, p_mfa_at timestamptz, p_account uuid, p_name text, p_roles text[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
  v_id uuid;
  r text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_staff', 0));
  SELECT * INTO g FROM public.vendor_guard(p_actor, p_ip, ARRAY['platform_owner'], 'vendor_staff_create', NULL, NULL, p_mfa_at, interval '10 minutes');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  IF p_account IS NOT NULL THEN
    PERFORM public.vendor_account_lock(p_account);
  END IF;
  IF p_roles IS NULL OR cardinality(p_roles) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_roles) x WHERE x IS NULL OR x NOT IN ('platform_owner','onboarding','support','vendor_finance','vendor_auditor'))
     OR length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 120
     OR NOT EXISTS (SELECT 1 FROM public.auth_user WHERE id = p_account) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_create', NULL, NULL, 'denied', 'invalid_input', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_staff WHERE account_id = p_account) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_create', NULL, NULL, 'denied', 'already_vendor_staff', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT');
  END IF;
  IF public.vendor_account_has_unapproved_membership(p_account) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_create', NULL, NULL, 'denied', 'dual_identity_not_approved', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'dual_identity_not_approved');
  END IF;
  INSERT INTO public.vendor_staff (account_id, display_name) VALUES (p_account, btrim(p_name)) RETURNING id INTO v_id;
  FOREACH r IN ARRAY ARRAY(SELECT DISTINCT x FROM unnest(p_roles) x ORDER BY 1) LOOP
    INSERT INTO public.vendor_staff_roles (staff_id, role) VALUES (v_id, r);
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_role', NULL, v_id, 'success', 'role_added_' || r, p_ip);
  END LOOP;
  PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_staff_create', NULL, v_id, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_staff_create(uuid, text, timestamptz, uuid, text, text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_staff_create(uuid, text, timestamptz, uuid, text, text[]) TO clinic_vendor;--> statement-breakpoint

-- Roles and state of a vendor staff member (platform owner; never their own; never leaving
-- no active platform owner). Leaving roles or suspending ends nothing else here: vendor
-- sessions are checked on every action (vendor_guard).
CREATE FUNCTION public.vendor_staff_update(p_actor uuid, p_ip text, p_mfa_at timestamptz, p_staff uuid, p_roles text[], p_state text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_staff_update(uuid, text, timestamptz, uuid, text[], text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_staff_update(uuid, text, timestamptz, uuid, text[], text) TO clinic_vendor;--> statement-breakpoint

-- Console IP allowlist (platform owner).
CREATE FUNCTION public.vendor_ip_allowlist_set(p_actor uuid, p_ip text, p_mfa_at timestamptz, p_cidr text, p_label text, p_add boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
  v_cidr text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_ip_allowlist', 0));
  SELECT * INTO g FROM public.vendor_guard(p_actor, p_ip, ARRAY['platform_owner'], 'vendor_ip_allowlist', NULL, NULL, p_mfa_at, interval '10 minutes');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  BEGIN
    v_cidr := p_cidr::cidr::text;
  EXCEPTION WHEN others THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_ip_allowlist', NULL, NULL, 'denied', 'invalid_input', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END;
  IF masklen(v_cidr::cidr) < (CASE family(v_cidr::cidr) WHEN 4 THEN 16 ELSE 32 END) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_ip_allowlist', NULL, NULL, 'denied', 'range_too_wide', p_ip, v_cidr);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT', 'reason', 'range_too_wide');
  END IF;
  IF p_add THEN
    IF length(btrim(coalesce(p_label, ''))) NOT BETWEEN 2 AND 80 THEN
      PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_ip_allowlist', NULL, NULL, 'denied', 'invalid_input', p_ip);
      RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
    END IF;
    IF EXISTS (SELECT 1 FROM public.vendor_ip_allowlist WHERE cidr = v_cidr) THEN
      PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_ip_allowlist', NULL, NULL, 'denied', 'already_present', p_ip, v_cidr);
      RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'already_present');
    END IF;
    INSERT INTO public.vendor_ip_allowlist (cidr, label) VALUES (v_cidr, btrim(p_label));
  ELSE
    -- The caller's own address must stay allowed (no lock-out by this change).
    IF NOT EXISTS (SELECT 1 FROM public.vendor_ip_allowlist WHERE cidr = v_cidr) THEN
      PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_ip_allowlist', NULL, NULL, 'denied', 'not_found', p_ip, v_cidr);
      RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.vendor_ip_allowlist a WHERE a.cidr <> v_cidr AND public.vendor_ip_norm(p_ip) <<= a.cidr::cidr) THEN
      PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_ip_allowlist', NULL, NULL, 'denied', 'lockout', p_ip, v_cidr);
      RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'lockout');
    END IF;
    DELETE FROM public.vendor_ip_allowlist WHERE cidr = v_cidr;
  END IF;
  PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'vendor_ip_allowlist', NULL, NULL, 'success', CASE WHEN p_add THEN 'added' ELSE 'removed' END, p_ip, v_cidr);
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_ip_allowlist_set(uuid, text, timestamptz, text, text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_ip_allowlist_set(uuid, text, timestamptz, text, text, boolean) TO clinic_vendor;--> statement-breakpoint

-- Who may request each kind (19 §3, IAM-10); the platform owner approves every kind.
CREATE FUNCTION public.vendor_request_roles(p_kind text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_kind
    WHEN 'suspension' THEN ARRAY['vendor_finance','support']
    WHEN 'exit' THEN ARRAY['vendor_finance','support']
    WHEN 'server_fee_change' THEN ARRAY['vendor_finance']
    WHEN 'invoice_waiver' THEN ARRAY['vendor_finance']
    WHEN 'clinical_grant' THEN ARRAY['support','onboarding']
    WHEN 'dual_identity' THEN ARRAY['platform_owner','onboarding','support','vendor_finance']
    END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_request_roles(text) FROM PUBLIC;--> statement-breakpoint

-- A whole rupiah amount between 1 and 1 billion (the cast runs only after the type test).
CREATE FUNCTION public.vendor_rupiah_ok(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'number' THEN
    RETURN false;
  END IF;
  RETURN (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) AND (v #>> '{}')::numeric BETWEEN 1 AND 1000000000;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_rupiah_ok(jsonb) FROM PUBLIC;--> statement-breakpoint

-- Is the payload valid for its kind (ids and amounts only)?
CREATE FUNCTION public.vendor_request_payload_ok(p_kind text, p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  RETURN coalesce(CASE p_kind
    WHEN 'suspension' THEN p = '{}'::jsonb
    WHEN 'exit' THEN p = '{}'::jsonb
    WHEN 'server_fee_change' THEN (SELECT count(*) FROM jsonb_object_keys(p)) = 2
      AND public.vendor_rupiah_ok(p -> 'amount_rupiah')
      AND (p ->> 'effective_month') ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    WHEN 'invoice_waiver' THEN (SELECT count(*) FROM jsonb_object_keys(p)) = 2
      AND (p ->> 'invoice_id') ~ uuid_re
      AND public.vendor_rupiah_ok(p -> 'amount_rupiah')
    WHEN 'clinical_grant' THEN (SELECT count(*) FROM jsonb_object_keys(p)) = 1 AND (p ->> 'staff_id') ~ uuid_re
    WHEN 'dual_identity' THEN (SELECT count(*) FROM jsonb_object_keys(p)) = 1 AND (p ->> 'account_id') ~ uuid_re
    END, false);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_request_payload_ok(text, jsonb) FROM PUBLIC;--> statement-breakpoint

-- Ajukan: a maker-checker request for a tenant (PR-57). One pending request per kind and
-- tenant (and per subject for dual identity and clinical grants).
CREATE FUNCTION public.vendor_request(p_actor uuid, p_ip text, p_mfa_at timestamptz, p_kind text, p_tenant uuid, p_payload jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
  v_id uuid;
  v_action text := 'request_' || coalesce(p_kind, 'unknown');
BEGIN
  IF p_kind IS NULL OR public.vendor_request_roles(p_kind) IS NULL THEN
    PERFORM public.vendor_log(NULL, p_actor, NULL, 'request_unknown', p_tenant, NULL, 'denied', 'unknown_kind', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  SELECT * INTO g FROM public.vendor_guard(p_actor, p_ip, public.vendor_request_roles(p_kind), v_action, p_tenant, NULL, p_mfa_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  IF p_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, v_action, NULL, NULL, 'denied', 'tenant_not_found', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  -- Shape first (ids are valid uuids after this), then the checks that read them.
  IF NOT public.vendor_request_payload_ok(p_kind, p_payload) OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 500 THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, v_action, p_tenant, NULL, 'denied', 'invalid_input', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  IF p_kind = 'clinical_grant' AND NOT EXISTS (SELECT 1 FROM public.vendor_staff_roles r JOIN public.vendor_staff v ON v.id = r.staff_id
                                                   WHERE r.staff_id = (p_payload ->> 'staff_id')::uuid AND r.role IN ('support','onboarding') AND v.state = 'active')
     OR p_kind = 'clinical_grant' AND (p_payload ->> 'staff_id')::uuid = g.staff_id
     OR p_kind = 'server_fee_change' AND p_payload ->> 'effective_month' <= to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')
     OR p_kind = 'dual_identity' AND NOT EXISTS (SELECT 1 FROM public.auth_user WHERE id = (p_payload ->> 'account_id')::uuid) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, v_action, p_tenant, NULL, 'denied', 'invalid_input', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_request:' || p_kind || ':' || p_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.vendor_requests r WHERE r.kind = p_kind AND r.tenant_id = p_tenant AND r.state = 'pending'
               AND (p_kind NOT IN ('dual_identity','clinical_grant') OR r.payload = p_payload)) THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, v_action, p_tenant, NULL, 'denied', 'already_pending', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_IDEMPOTENCY_CONFLICT');
  END IF;
  INSERT INTO public.vendor_requests (kind, tenant_id, payload, reason, requested_by, requested_as)
  VALUES (p_kind, p_tenant, p_payload, btrim(p_reason), g.staff_id, g.role) RETURNING id INTO v_id;
  PERFORM public.vendor_log(g.staff_id, p_actor, g.role, v_action, p_tenant, v_id, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_request(uuid, text, timestamptz, text, uuid, jsonb, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_request(uuid, text, timestamptz, text, uuid, jsonb, text) TO clinic_vendor;--> statement-breakpoint

-- Setujui / Tolak by the platform owner; the requester never decides (refused and logged,
-- PR-57). A dual identity is effective only once the clinic owner approved too.
CREATE FUNCTION public.vendor_request_decide(p_actor uuid, p_ip text, p_mfa_at timestamptz, p_request uuid, p_approve boolean, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
  q public.vendor_requests;
BEGIN
  SELECT * INTO g FROM public.vendor_guard(p_actor, p_ip, ARRAY['platform_owner'], 'request_decide',
                                           (SELECT r.tenant_id FROM public.vendor_requests r WHERE r.id = p_request), p_request, p_mfa_at, interval '10 minutes');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  SELECT * INTO q FROM public.vendor_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', NULL, p_request, 'denied', 'not_found', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  IF q.requested_by = g.staff_id THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', q.tenant_id, p_request, 'denied', 'approver_is_requester', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_APPROVER_IS_REQUESTER');
  END IF;
  -- The subject of a dual identity or clinical grant never decides it either.
  IF q.kind = 'dual_identity' AND q.payload ->> 'account_id' = p_actor::text
     OR q.kind = 'clinical_grant' AND q.payload ->> 'staff_id' = g.staff_id::text THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', q.tenant_id, p_request, 'denied', 'approver_is_subject', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_APPROVER_IS_REQUESTER');
  END IF;
  -- One person never supplies both halves of a dual identity.
  IF q.kind = 'dual_identity' AND q.clinic_approved_account = p_actor THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', q.tenant_id, p_request, 'denied', 'approved_clinic_half', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_APPROVER_IS_REQUESTER');
  END IF;
  IF q.state <> 'pending' THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', q.tenant_id, p_request, 'denied', 'already_decided', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT');
  END IF;
  IF p_approve AND NOT EXISTS (SELECT 1 FROM public.vendor_staff v JOIN public.vendor_staff_roles r ON r.staff_id = v.id AND r.role = q.requested_as
                                WHERE v.id = q.requested_by AND v.state = 'active') THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', q.tenant_id, p_request, 'denied', 'requester_inactive', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'requester_inactive');
  END IF;
  IF p_approve AND q.kind = 'server_fee_change' AND q.payload ->> 'effective_month' <= to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', q.tenant_id, p_request, 'denied', 'effective_month_passed', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'effective_month_passed');
  END IF;
  IF p_approve IS NULL OR NOT p_approve AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', q.tenant_id, p_request, 'denied', 'invalid_input', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  UPDATE public.vendor_requests
     SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = g.staff_id, decided_at = now(),
         decision_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_request;
  PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_decide', q.tenant_id, p_request, 'success',
          CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, p_ip);
  RETURN jsonb_build_object('ok', true, 'state', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_request_decide(uuid, text, timestamptz, uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_request_decide(uuid, text, timestamptz, uuid, boolean, text) TO clinic_vendor;--> statement-breakpoint

-- Batalkan: the requester withdraws a pending request.
CREATE FUNCTION public.vendor_request_cancel(p_actor uuid, p_ip text, p_mfa_at timestamptz, p_request uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
  q public.vendor_requests;
BEGIN
  SELECT * INTO g FROM public.vendor_guard(p_actor, p_ip, ARRAY['platform_owner','onboarding','support','vendor_finance'], 'request_cancel',
                                           (SELECT r.tenant_id FROM public.vendor_requests r WHERE r.id = p_request), p_request, p_mfa_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  SELECT * INTO q FROM public.vendor_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR q.requested_by <> g.staff_id OR q.state <> 'pending' THEN
    PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_cancel', q.tenant_id, p_request, 'denied', 'not_found', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  UPDATE public.vendor_requests SET state = 'cancelled', decided_at = now() WHERE id = p_request;
  PERFORM public.vendor_log(g.staff_id, p_actor, g.role, 'request_cancel', q.tenant_id, p_request, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_request_cancel(uuid, text, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_request_cancel(uuid, text, timestamptz, uuid) TO clinic_vendor;--> statement-breakpoint

-- The executing service's audited name, anchored to the database login that claims it.
CREATE FUNCTION public.vendor_service_name(p_service text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  -- audit_events.service_identity allows [a-z_.-] only: digits of the login map to letters.
  SELECT left(p_service || '.' || translate(regexp_replace(lower(session_user::text), '[^a-z0-9_]', '_', 'g'), '0123456789', 'abcdefghij'), 61)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_service_name(text) FROM PUBLIC;--> statement-breakpoint

-- The task that executes an approved request (suspension, exit, fee change, waiver,
-- clinical grant) consumes it once, within 30 days of approval, INSIDE the transaction that
-- applies the effect (a failed effect rolls the consumption back; FOR UPDATE makes a
-- concurrent execution wait and then see it consumed). p_service names the executing
-- service (audited as its service identity, in the vendor log and the clinic's chain);
-- p_tenant binds the request to the tenant the task acts on. A refusal raises (the caller's
-- transaction carries nothing else worth keeping); the executing task re-validates its own
-- preconditions (invoice belongs to the tenant, subject still active) before acting.
CREATE FUNCTION public.vendor_request_consume(p_request uuid, p_kind text, p_tenant uuid, p_service text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
    WHEN q.decided_at < now() - interval '30 days' THEN 'approval_expired'
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
$$;--> statement-breakpoint
-- A refused consumption is recorded by the worker after rolling its effect back, in its own
-- transaction (the refusal inside the effect transaction is rolled back with it). Only the
-- reason codes consume raises are accepted; nothing changes but the logs.
CREATE FUNCTION public.vendor_request_consume_refused(p_request uuid, p_kind text, p_tenant uuid, p_service text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_service IS NULL OR p_service !~ '^[a-z][a-z_.-]{1,60}$'
     OR p_reason IS NULL OR p_reason NOT IN ('not_found','not_approved','already_consumed','approval_expired','effective_month_passed','approver_inactive') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refusal record' USING ERRCODE = '22023';
  END IF;
  -- The tenant is attributed only when the request really belongs to it.
  PERFORM public.vendor_log(NULL, NULL, NULL, 'request_consume', 
          (SELECT r.tenant_id FROM public.vendor_requests r WHERE r.id = p_request AND r.tenant_id = p_tenant),
          p_request, 'denied', p_reason, NULL, NULL, public.vendor_service_name(p_service));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_request_consume_refused(uuid, text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_request_consume_refused(uuid, text, uuid, text, text) TO clinic_executor;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_request_consume(uuid, text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_request_consume(uuid, text, uuid, text) TO clinic_executor;--> statement-breakpoint

-- The clinic owner's half of a dual identity (Akses Vendor, clinic app): the owner acting in
-- that tenant approves or rejects a pending or platform-approved request for an account
-- other than their own; audited in the clinic audit log.
CREATE FUNCTION public.vendor_dual_identity_clinic_decide(p_request uuid, p_approve boolean) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  q public.vendor_requests;
  v_account uuid;
  v_refusal text;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT m.account_id INTO v_account FROM public.staff s JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
   WHERE s.tenant_id = a.tenant_id AND s.id = a.staff_id;
  SELECT * INTO q FROM public.vendor_requests WHERE id = p_request AND kind = 'dual_identity' AND tenant_id = a.tenant_id FOR UPDATE;
  v_refusal := CASE
    WHEN a.role <> 'owner' THEN 'not_owner'
    WHEN q.id IS NULL THEN 'not_found'
    WHEN v_account IS NULL THEN 'not_owner'
    -- Requester ≠ approver on the clinic half too: not the subject, not the vendor staff
    -- who requested it, not the platform owner who approved it.
    WHEN q.payload ->> 'account_id' = v_account::text
      OR EXISTS (SELECT 1 FROM public.vendor_staff v WHERE v.account_id = v_account AND v.id IN (q.requested_by, q.decided_by)) THEN 'approver_is_requester'
    WHEN q.state NOT IN ('pending','approved') OR q.clinic_approved_at IS NOT NULL OR p_approve IS NULL THEN 'already_decided' END;
  IF v_refusal IS NOT NULL THEN
    -- A refusal is audited on the clinic side and committed (the caller gets the code).
    PERFORM public.audit_append('approval', 'vendor_request', p_request, 'denied', 'dual_identity_' || v_refusal);
    RETURN 'refused:' || v_refusal;
  END IF;
  IF p_approve THEN
    UPDATE public.vendor_requests SET clinic_approved_by = a.staff_id, clinic_approved_account = v_account, clinic_approved_at = now() WHERE id = p_request;
  ELSE
    -- The platform decision (if any) stays as it was; the clinic audit row records who rejected.
    UPDATE public.vendor_requests SET state = 'rejected', decided_at = coalesce(decided_at, now()),
           decision_reason = CASE WHEN decided_at IS NULL THEN 'ditolak owner klinik' ELSE decision_reason END
     WHERE id = p_request;
  END IF;
  PERFORM public.audit_append('approval', 'vendor_request', p_request, 'success',
          CASE WHEN p_approve THEN 'vendor_dual_identity_approved' ELSE 'vendor_dual_identity_rejected' END);
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_dual_identity_clinic_decide(uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_dual_identity_clinic_decide(uuid, boolean) TO clinic_app;--> statement-breakpoint

-- Akses Vendor (owner; Admin Pusat read): every dual identity request for this tenant,
-- permanently listed (IAM-10), with both decisions.
CREATE FUNCTION public.vendor_dual_identities() RETURNS TABLE (request_id uuid, account_id uuid, vendor_name text, state text,
  requested_at timestamptz, platform_decided_at timestamptz, clinic_approved_at timestamptz, effective boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF a.role NOT IN ('owner','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: Akses Vendor is for the owner and Admin Pusat' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT q.id, (q.payload ->> 'account_id')::uuid, vs.display_name, q.state, q.requested_at,
         CASE WHEN q.decided_by IS NOT NULL THEN q.decided_at END, q.clinic_approved_at,
         q.state = 'approved' AND q.clinic_approved_at IS NOT NULL
    FROM public.vendor_requests q
    LEFT JOIN public.vendor_staff vs ON vs.account_id = (q.payload ->> 'account_id')::uuid
   WHERE q.kind = 'dual_identity' AND q.tenant_id = a.tenant_id
   ORDER BY q.requested_at DESC;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_dual_identities() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_dual_identities() TO clinic_app;--> statement-breakpoint

-- Requests and the action log are history: never deleted; a request changes only from
-- pending to its decision (and gets the clinic decision once); log rows never change.
CREATE FUNCTION public.vendor_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_same_decision boolean;
  v_same_clinic boolean;
  v_clinic_added boolean;
BEGIN
  IF TG_OP = 'DELETE' OR TG_TABLE_NAME = 'vendor_actions' THEN
    RAISE EXCEPTION 'vendor history is never changed or deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.kind, NEW.tenant_id, NEW.payload, NEW.reason, NEW.requested_by, NEW.requested_as, NEW.requested_at)
     IS DISTINCT FROM (OLD.id, OLD.kind, OLD.tenant_id, OLD.payload, OLD.reason, OLD.requested_by, OLD.requested_as, OLD.requested_at) THEN
    RAISE EXCEPTION 'a vendor request is immutable' USING ERRCODE = '42501';
  END IF;
  v_same_decision := (NEW.decided_by, NEW.decided_at, NEW.decision_reason) IS NOT DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.decision_reason);
  v_same_clinic := (NEW.clinic_approved_by, NEW.clinic_approved_account, NEW.clinic_approved_at)
                   IS NOT DISTINCT FROM (OLD.clinic_approved_by, OLD.clinic_approved_account, OLD.clinic_approved_at);
  v_clinic_added := OLD.clinic_approved_at IS NULL AND NEW.clinic_approved_at IS NOT NULL AND OLD.kind = 'dual_identity';
  -- The only allowed transitions:
  IF -- platform decision or clinic rejection or withdrawal of a pending request
     OLD.state = 'pending' AND NEW.state IN ('approved','rejected','cancelled') AND OLD.decided_at IS NULL AND v_same_clinic
       AND NEW.consumed_at IS NULL
     -- clinic approval of a pending or platform-approved dual identity
     OR OLD.state = NEW.state AND OLD.state IN ('pending','approved') AND v_clinic_added AND v_same_decision
       AND NEW.consumed_at IS NOT DISTINCT FROM OLD.consumed_at
     -- clinic rejection after the platform approved (dual identity, not yet clinic-approved)
     OR OLD.state = 'approved' AND NEW.state = 'rejected' AND OLD.kind = 'dual_identity' AND OLD.clinic_approved_at IS NULL
       AND v_same_decision AND v_same_clinic
     -- execution of an approved request, once
     OR OLD.state = 'approved' AND NEW.state = 'approved' AND OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
       AND v_same_decision AND v_same_clinic THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a decided vendor request is final' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
CREATE TRIGGER vendor_requests_guard BEFORE UPDATE OR DELETE ON public.vendor_requests FOR EACH ROW EXECUTE FUNCTION public.vendor_history_guard();--> statement-breakpoint
CREATE TRIGGER vendor_actions_guard BEFORE UPDATE OR DELETE ON public.vendor_actions FOR EACH ROW EXECUTE FUNCTION public.vendor_history_guard();--> statement-breakpoint
CREATE TRIGGER vendor_requests_no_truncate BEFORE TRUNCATE ON public.vendor_requests FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER vendor_actions_no_truncate BEFORE TRUNCATE ON public.vendor_actions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.vendor_requests ENABLE ALWAYS TRIGGER vendor_requests_guard;--> statement-breakpoint
ALTER TABLE public.vendor_actions ENABLE ALWAYS TRIGGER vendor_actions_guard;--> statement-breakpoint

-- Production go-live needs maker and checker to differ: at least two active vendor staff,
-- one of them an active platform owner (IAM-10).
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

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.vendor_staff', 'platform', 'vendor', '{}', 'vendor staff functions (src/modules/vendor/staff)', 'none'),
  ('public.vendor_staff_roles', 'platform', 'vendor', '{}', 'vendor staff functions (src/modules/vendor/staff)', 'none'),
  ('public.vendor_ip_allowlist', 'platform', 'vendor', '{}', 'vendor staff functions (src/modules/vendor/staff)', 'none'),
  ('public.vendor_requests', 'platform', 'vendor', '{}', 'vendor request functions (src/modules/vendor/staff)', 'none'),
  ('public.vendor_actions', 'platform', 'vendor', '{}', 'vendor functions (append only)', 'none');
