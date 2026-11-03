-- T-023 (PR-1, PR-53, TEN-12, DEC-033). Tenant provisioning from the vendor console and the
-- first-owner invitation. Console entry points take the vendor session token (T-021) and
-- run vendor_guard with a 10-minute TOTP step-up; refusals are returned and logged.

ALTER TABLE public.tenant_owner_invitations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.tenant_owner_invitations', 'platform', 'vendor', '{}', 'tenant provisioning functions (src/modules/vendor/tenants)', 'none');--> statement-breakpoint
-- One open first-owner invitation per tenant.
CREATE UNIQUE INDEX tenant_owner_invitations_one_open ON public.tenant_owner_invitations (tenant_id)
  WHERE state IN ('pending','issued');--> statement-breakpoint
-- History only moves forward (no rewrite, no delete): pending → issued|cancelled,
-- issued → accepted|cancelled|expired.
CREATE FUNCTION public.tenant_owner_invitations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'owner invitations are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.email, NEW.display_name, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.email, OLD.display_name, OLD.requested_by, OLD.requested_at)
     OR NOT (OLD.state = 'pending' AND NEW.state IN ('issued','cancelled')
             OR OLD.state = 'issued' AND NEW.state IN ('accepted','cancelled','expired')
                AND (NEW.approved_by, NEW.approved_at, NEW.token_hash, NEW.expires_at)
                    IS NOT DISTINCT FROM (OLD.approved_by, OLD.approved_at, OLD.token_hash, OLD.expires_at)) THEN
    RAISE EXCEPTION 'an owner invitation only moves forward' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER tenant_owner_invitations_guard BEFORE UPDATE OR DELETE ON public.tenant_owner_invitations
  FOR EACH ROW EXECUTE FUNCTION public.tenant_owner_invitations_guard();--> statement-breakpoint
ALTER TABLE public.tenant_owner_invitations ENABLE ALWAYS TRIGGER tenant_owner_invitations_guard;--> statement-breakpoint
CREATE TRIGGER tenant_owner_invitations_no_truncate BEFORE TRUNCATE ON public.tenant_owner_invitations
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- An Owner joining by any path (first-owner link, role_assign, a confirmed Owner grant)
-- closes the tenant's open first-owner invitation in the same transaction (DEC-033: valid
-- only while the tenant has no Owner), so a later end of that Owner cannot revive a link.
CREATE FUNCTION public.tenant_owner_invitations_close_on_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.role = 'owner' THEN
    UPDATE public.tenant_owner_invitations SET state = 'cancelled', closed_at = now()
     WHERE tenant_id = NEW.tenant_id AND state IN ('pending','issued');
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_owner_invitations_close_on_owner() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER staff_roles_close_owner_invitations AFTER INSERT ON public.staff_roles
  FOR EACH ROW EXECUTE FUNCTION public.tenant_owner_invitations_close_on_owner();--> statement-breakpoint
ALTER TABLE public.staff_roles ENABLE ALWAYS TRIGGER staff_roles_close_owner_invitations;--> statement-breakpoint

-- The console caller for a write: vendor session + vendor_guard (step-up 10 minutes).
-- Returns the staff id and role, or the refusal (logged by vendor_guard).
CREATE FUNCTION public.vendor_console_writer(p_token text, p_ip text, p_roles text[], p_action text, p_tenant uuid,
                                             OUT account_id uuid, OUT staff_id uuid, OUT role text, OUT refusal text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    -- As vendor_console_guard (0034): no valid session means nothing to attribute, and an
    -- unauthenticated caller must not be able to write log rows (flooding). Not logged.
    refusal := 'no_session';
    RETURN;
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, p_roles, p_action, p_tenant, p_tenant, v.second_factor_at, interval '10 minutes');
  account_id := v.account_id;
  staff_id := g.staff_id;
  role := g.role;
  refusal := g.refusal;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_writer(text, text, text[], text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Buat Tenant (UX-40, PR-1): registry (provisioning), legal entity and the first branch, and
-- the first-owner invitation waiting for a second platform owner (DEC-033). No clinic data
-- other than the contract-party contact of the Owner (name, email).
CREATE FUNCTION public.vendor_console_tenant_create(p_token text, p_ip text, p_legal_name text, p_sak text,
                                                    p_branch_code text, p_branch_name text, p_timezone text,
                                                    p_owner_name text, p_owner_email text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
  RETURN jsonb_build_object('ok', true, 'tenant_id', v_tenant, 'branch_id', v_branch, 'invitation_id', v_invite);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_tenant_create(text, text, text, text, text, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_tenant_create(text, text, text, text, text, text, text, text, text) TO clinic_vendor;--> statement-breakpoint

-- A new first-owner invitation for a tenant that has none open and no Owner (reissue after
-- expiry or cancellation; maker = onboarding or platform owner).
CREATE FUNCTION public.vendor_console_owner_invite(p_token text, p_ip text, p_tenant uuid, p_owner_name text, p_owner_email text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  -- Expired issued invitations are closed first.
  UPDATE public.tenant_owner_invitations SET state = 'expired', closed_at = now()
   WHERE tenant_id = p_tenant AND state = 'issued' AND expires_at <= now();
  IF public.tenant_has_role(p_tenant, 'owner')
     OR EXISTS (SELECT 1 FROM public.tenant_owner_invitations WHERE tenant_id = p_tenant AND state IN ('pending','issued')) THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_request', p_tenant, p_tenant, 'denied', 'owner_or_invitation_exists', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'owner_or_invitation_exists');
  END IF;
  IF length(btrim(coalesce(p_owner_name, ''))) NOT BETWEEN 2 AND 120
     OR length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_request', p_tenant, p_tenant, 'denied', 'invalid_input', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  INSERT INTO public.tenant_owner_invitations (tenant_id, email, display_name, requested_by)
  VALUES (p_tenant, v_email, btrim(p_owner_name), w.staff_id) RETURNING id INTO v_invite;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_request', p_tenant, v_invite, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true, 'invitation_id', v_invite);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_owner_invite(text, text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_owner_invite(text, text, uuid, text, text) TO clinic_vendor;--> statement-breakpoint

-- Setujui undangan Owner: a platform owner other than the maker approves; the token hash
-- the console generated is stored and the link (with the raw token) is shown once by the
-- console. 7 days. Refused while the tenant already has an Owner.
CREATE FUNCTION public.vendor_console_owner_invite_approve(p_token text, p_ip text, p_invitation uuid, p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'not_pending');
  END IF;
  IF i.requested_by = w.staff_id THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'denied', 'approver_is_requester', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_APPROVER_IS_REQUESTER');
  END IF;
  IF public.tenant_has_role(i.tenant_id, 'owner') THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'denied', 'owner_exists', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'owner_exists');
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'denied', 'invalid_input', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  UPDATE public.tenant_owner_invitations
     SET state = 'issued', approved_by = w.staff_id, approved_at = now(), token_hash = p_token_hash, expires_at = now() + interval '7 days'
   WHERE id = p_invitation;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_approve', i.tenant_id, p_invitation, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_owner_invite_approve(text, text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_owner_invite_approve(text, text, uuid, text) TO clinic_vendor;--> statement-breakpoint

-- Batalkan undangan Owner (onboarding or platform owner).
CREATE FUNCTION public.vendor_console_owner_invite_cancel(p_token text, p_ip text, p_invitation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'owner_invite_cancel', v_tenant, p_invitation, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_owner_invite_cancel(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_owner_invite_cancel(text, text, uuid) TO clinic_vendor;--> statement-breakpoint

-- Detail Tenant › Ringkasan (UX-40): state, legal name, branches, owner invitations (no
-- token, no raw link), whether an Owner exists, the processor agreement status, and the
-- lifecycle history. No patient, staff or clinical data (PR-60).
CREATE FUNCTION public.vendor_console_tenant_detail(p_token text, p_ip text, p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_tenant_detail');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true,
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
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_tenant_detail(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_tenant_detail(text, text, uuid) TO clinic_vendor;--> statement-breakpoint

-- ── accepting the first-owner invitation (clinic app, before any membership) ────────────
-- What the link points at: the invited name, email and clinic, while still valid.
CREATE FUNCTION public.tenant_owner_invite_lookup(p_token_hash text) RETURNS TABLE (email text, display_name text, clinic text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT o.email, o.display_name, t.legal_name
    FROM public.tenant_owner_invitations o JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.token_hash = p_token_hash AND o.state = 'issued' AND o.expires_at > now()
     AND NOT public.tenant_has_role(o.tenant_id, 'owner')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_owner_invite_lookup(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tenant_owner_invite_lookup(text) TO clinic_app;--> statement-breakpoint

-- Accept: creates the membership, staff and the Owner role (accepting is the person's own
-- confirmation, DEC-033) for the account the invitation flow created or signed in with
-- that email. Never for a vendor staff account: memberships_vendor_guard (0032) refuses the
-- membership insert.
-- Audited in the tenant chain as the new Owner; the vendor log records it too.
CREATE FUNCTION public.tenant_owner_invite_accept(p_token_hash text, p_account uuid) RETURNS TABLE (tenant_id uuid, staff_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o public.tenant_owner_invitations;
  v_email text;
  v_membership uuid;
  v_staff uuid;
  v_role uuid;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: accept runs outside a tenant context' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.tenant_owner_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR o.state <> 'issued' OR o.expires_at <= now() THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invitation not valid' USING ERRCODE = 'P0002';
  END IF;
  -- The same lock as every staff/role change in the tenant (DEC-031): an Owner joining at
  -- the same time is seen.
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || o.tenant_id::text, 0));
  IF public.tenant_has_role(o.tenant_id, 'owner') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invitation not valid' USING ERRCODE = 'P0002';
  END IF;
  SELECT email INTO v_email FROM public.auth_user WHERE id = p_account;
  IF NOT FOUND OR lower(v_email) <> o.email THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the invitation is for another email' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = o.tenant_id AND m.account_id = p_account) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already a member' USING ERRCODE = '55000';
  END IF;
  UPDATE public.tenant_owner_invitations SET state = 'accepted', accepted_account = p_account, closed_at = now() WHERE id = o.id;
  INSERT INTO public.memberships (tenant_id, account_id) VALUES (o.tenant_id, p_account) RETURNING id INTO v_membership;
  INSERT INTO public.staff (tenant_id, membership_id, display_name) VALUES (o.tenant_id, v_membership, o.display_name) RETURNING id INTO v_staff;
  INSERT INTO public.staff_roles (tenant_id, staff_id, role) VALUES (o.tenant_id, v_staff, 'owner') RETURNING id INTO v_role;
  PERFORM set_config('app.tenant_id', o.tenant_id::text, true),
          set_config('app.staff_id', v_staff::text, true),
          set_config('app.roles', 'owner', true),
          set_config('app.active_branch_id', '', true);
  PERFORM public.audit_append('settings_change', 'staff_role', v_role, 'success', 'first_owner_joined');
  PERFORM set_config('app.tenant_id', '', true), set_config('app.staff_id', '', true),
          set_config('app.roles', '', true), set_config('app.active_branch_id', '', true);
  PERFORM public.vendor_log(NULL, NULL, NULL, 'owner_invite_accepted', o.tenant_id, o.id, 'success', NULL, NULL);
  RETURN QUERY SELECT o.tenant_id, v_staff;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_owner_invite_accept(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tenant_owner_invite_accept(text, uuid) TO clinic_app;
--> statement-breakpoint

-- Mulai Onboarding / Aktifkan from the console (T-022, redefined for T-023 review): the
-- guard runs first, so an invalid target or a refused step from a resolved vendor account
-- is logged like every other refusal. A transition the lifecycle rules refuse (not a step,
-- processor agreement not approved, bad reason) is caught in a subtransaction, logged, and
-- returned as a refusal.
CREATE OR REPLACE FUNCTION public.vendor_console_tenant_advance(p_token text, p_ip text, p_tenant uuid, p_to text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  w record;
  v_action text := CASE WHEN p_to IN ('onboarding','live') THEN 'tenant_' || p_to ELSE 'tenant_advance' END;
  v_reason text;
BEGIN
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
