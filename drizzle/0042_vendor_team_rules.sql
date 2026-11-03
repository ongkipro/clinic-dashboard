-- HYG-003 (DEC-036, UX-46, PR-57): Konsol Vendor › Tim Vendor — list, invite (one-time
-- link), cancel, deactivate/reactivate; accepting an invitation. Console entry points take
-- the vendor session token (T-021); writes need the 10-minute TOTP step-up (T-020).

ALTER TABLE public.vendor_staff_invitations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.vendor_staff_invitations', 'platform', 'vendor', '{}', 'Tim Vendor functions (src/modules/vendor/team)', 'none');--> statement-breakpoint
-- One open invitation per email.
CREATE UNIQUE INDEX vendor_staff_invitations_one_open ON public.vendor_staff_invitations (email) WHERE state = 'pending';--> statement-breakpoint
-- History only moves forward: pending → accepted | cancelled | expired; nothing else changes.
CREATE FUNCTION public.vendor_staff_invitations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vendor staff invitations are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.email, NEW.display_name, NEW.roles, NEW.token_hash, NEW.invited_by, NEW.invited_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.id, OLD.email, OLD.display_name, OLD.roles, OLD.token_hash, OLD.invited_by, OLD.invited_at, OLD.expires_at)
     OR OLD.state <> 'pending' OR NEW.state NOT IN ('accepted','cancelled','expired') THEN
    RAISE EXCEPTION 'a vendor staff invitation only moves forward' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER vendor_staff_invitations_guard BEFORE UPDATE OR DELETE ON public.vendor_staff_invitations
  FOR EACH ROW EXECUTE FUNCTION public.vendor_staff_invitations_guard();--> statement-breakpoint
ALTER TABLE public.vendor_staff_invitations ENABLE ALWAYS TRIGGER vendor_staff_invitations_guard;--> statement-breakpoint
CREATE TRIGGER vendor_staff_invitations_no_truncate BEFORE TRUNCATE ON public.vendor_staff_invitations
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Tim Vendor list (platform owner): staff with email, roles, state, TOTP enrolled; open
-- invitations without their token. No clinic data.
CREATE FUNCTION public.vendor_console_staff_list(p_token text, p_ip text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
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
  RETURN jsonb_build_object('ok', true,
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
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_staff_list(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_staff_list(text, text) TO clinic_vendor;--> statement-breakpoint

-- Undang (platform owner, step-up): the console made the token and passes only its hash;
-- the link is shown once. Refused for an email that is already vendor staff or has an open
-- invitation.
CREATE FUNCTION public.vendor_console_staff_invite(p_token text, p_ip text, p_email text, p_name text, p_roles text[], p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_staff s JOIN public.auth_user u ON u.id = s.account_id WHERE lower(u.email) = v_email) THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite', NULL, NULL, 'denied', 'already_vendor_staff', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'already_vendor_staff');
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_staff_invitations WHERE email = v_email AND state = 'pending') THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite', NULL, NULL, 'denied', 'invitation_open', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'invitation_open');
  END IF;
  INSERT INTO public.vendor_staff_invitations (email, display_name, roles, token_hash, invited_by, expires_at)
  VALUES (v_email, btrim(p_name), ARRAY(SELECT DISTINCT x FROM unnest(p_roles) x ORDER BY 1), p_token_hash, w.staff_id, now() + interval '7 days')
  RETURNING id INTO v_id;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite', NULL, v_id, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_staff_invite(text, text, text, text, text[], text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_staff_invite(text, text, text, text, text[], text) TO clinic_vendor;--> statement-breakpoint

CREATE FUNCTION public.vendor_console_staff_invite_cancel(p_token text, p_ip text, p_invitation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'vendor_staff_invite_cancel', NULL, p_invitation, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_staff_invite_cancel(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_staff_invite_cancel(text, text, uuid) TO clinic_vendor;--> statement-breakpoint

-- Nonaktifkan / Aktifkan Kembali: vendor_staff_update (T-020) with the session's own
-- account and second-factor time, keeping the staff member's roles. All its rules apply
-- (platform owner, step-up, never oneself, never the last TOTP-enrolled platform owner,
-- dual identity re-checked on reactivation, logged).
CREATE FUNCTION public.vendor_console_staff_state(p_token text, p_ip text, p_staff uuid, p_state text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
  RETURN public.vendor_staff_update(v.account_id, p_ip, v.second_factor_at, p_staff, v_roles, p_state);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_staff_state(text, text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_staff_state(text, text, uuid, text) TO clinic_vendor;--> statement-breakpoint

-- ── accepting (no session yet; vendor host) ──────────────────────────────────────────────
-- A refused use of a known invitation is logged against the invitation only (no token, no
-- account). The same refusal for the same invitation is logged once per 10 minutes, so a
-- holder of a used or expired link cannot flood the vendor log.
CREATE FUNCTION public.vendor_staff_invite_log_refusal(p_invitation uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- Serialises check and insert per invitation, so parallel attempts log exactly once.
  -- Always the innermost lock (after vendor_staff when a caller holds it): no cycle.
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_invite_refusal:' || p_invitation::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.vendor_actions a
                  WHERE a.action = 'vendor_staff_invite_accept' AND a.object_id = p_invitation AND a.outcome = 'denied'
                    AND a.reason_code = p_reason AND a.at > now() - interval '10 minutes') THEN
    PERFORM public.vendor_log(NULL, NULL, NULL, 'vendor_staff_invite_accept', NULL, p_invitation, 'denied', p_reason, NULL);
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_staff_invite_log_refusal(uuid, text) FROM PUBLIC;--> statement-breakpoint

-- The invite-link flow reports refusals it decides before accepting: the link no longer
-- valid (not_open) or the invited email already has an account (account_exists). Logged
-- only when the hash names an existing invitation.
CREATE FUNCTION public.vendor_staff_invite_refused(p_token_hash text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('not_open','account_exists') THEN
    RETURN;
  END IF;
  SELECT id INTO v_id FROM public.vendor_staff_invitations WHERE token_hash = p_token_hash;
  IF v_id IS NOT NULL THEN
    PERFORM public.vendor_staff_invite_log_refusal(v_id, p_reason);
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_staff_invite_refused(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_staff_invite_refused(text, text) TO clinic_vendor;--> statement-breakpoint

CREATE FUNCTION public.vendor_staff_invite_lookup(p_token_hash text) RETURNS TABLE (email text, display_name text, roles text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.email, i.display_name, i.roles
    FROM public.vendor_staff_invitations i
   WHERE i.token_hash = p_token_hash AND i.state = 'pending' AND i.expires_at > now()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_staff_invite_lookup(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_staff_invite_lookup(text) TO clinic_vendor;--> statement-breakpoint

-- Accept for the account the invitation flow created with that email: vendor staff with the
-- invited roles. The inviter must still be an active platform owner; the account must not
-- be vendor staff already nor hold a clinic membership without an approved dual identity
-- (IAM-10). Refusals are returned (never raised) and logged, so the caller can discard the
-- new account and the log row stays.
CREATE FUNCTION public.vendor_staff_invite_accept(p_token_hash text, p_account uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
  IF i.state <> 'pending' OR i.expires_at <= now() THEN
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_staff_invite_accept(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_staff_invite_accept(text, uuid) TO clinic_vendor;
