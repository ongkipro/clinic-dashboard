-- T-031 (PR-91, IAM-11, IAM-13, IAM-16, UX-3). Tenant-shared tables written only through
-- the SECURITY DEFINER functions below; every change is audited (audit_append) and the
-- permission-change log is the audit trail filtered to these reason codes.
-- Staff admins: owner, admin_pusat (07 "Staff & invitations"); the manager views its
-- branch (T-029 readers), the facility head verifies credentials (T-071).

ALTER TABLE public.membership_revocations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY membership_revocations_read ON public.membership_revocations FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat']));--> statement-breakpoint
GRANT SELECT ON public.membership_revocations TO clinic_app;--> statement-breakpoint

ALTER TABLE public.staff_duties ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_duties_read ON public.staff_duties FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_role_in(ARRAY['owner','admin_pusat']) OR staff_id = public.app_staff_id()));--> statement-breakpoint
GRANT SELECT ON public.staff_duties TO clinic_app;--> statement-breakpoint

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_invitations_read ON public.staff_invitations FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_role_in(ARRAY['owner','admin_pusat']));--> statement-breakpoint
-- The token hash never leaves the database.
GRANT SELECT (id, tenant_id, email, display_name, roles, branch_ids, invited_by, invited_at, expires_at, state, accepted_staff_id, closed_at)
  ON public.staff_invitations TO clinic_app;--> statement-breakpoint

-- The staff admin of the bound context: owner or Admin Pusat acting, active membership.
CREATE FUNCTION public.staff_admin() RETURNS TABLE (tenant_id uuid, staff_id uuid, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_staff uuid := public.app_staff_id();
  v_role text := public.app_acting_role();
BEGIN
  IF v_tenant IS NULL OR v_staff IS NULL OR v_role IS NULL OR v_role NOT IN ('owner','admin_pusat') OR NOT EXISTS (
       SELECT 1 FROM public.staff s
         JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
         JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = v_role
        WHERE s.tenant_id = v_tenant AND s.id = v_staff
          -- clock_timestamp, not now(): after waiting on staff_admin_lock, a membership ended
          -- by the transaction that held the lock (effective_to = its start time) is over.
          AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only Owner or Admin Pusat manage staff' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v_tenant, v_staff, v_role;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_admin() FROM PUBLIC;--> statement-breakpoint

-- Every access change of one tenant runs one at a time (two owners ending each other at
-- once would otherwise both pass the actor check and leave no owner). Taken before
-- staff_admin(), so the actor check sees any change committed while waiting.
CREATE FUNCTION public.staff_admin_lock() RETURNS TABLE (tenant_id uuid, staff_id uuid, role text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || public.app_tenant_id()::text, 0));
  END IF;
  RETURN QUERY SELECT * FROM public.staff_admin();
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_admin_lock() FROM PUBLIC;--> statement-breakpoint

-- Can this staff member still send this invitation? An active membership holding Owner,
-- or Admin Pusat with only Level 3 roles invited (IAM-11). Checked at acceptance: an
-- invitation never grants more than its inviter may grant today.
CREATE FUNCTION public.staff_inviter_may_grant(p_tenant uuid, p_inviter uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
      JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id
     WHERE s.tenant_id = p_tenant AND s.id = p_inviter
       AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
       AND (r.role = 'owner'
            OR r.role = 'admin_pusat' AND p_roles <@ ARRAY['manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist']))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_inviter_may_grant(uuid, uuid, text[]) FROM PUBLIC;--> statement-breakpoint

-- When a staff member loses the authority behind their pending invitations (membership
-- ended, Owner/Admin Pusat role removed), those invitations are cancelled and audited.
CREATE FUNCTION public.staff_invitations_recheck(p_tenant uuid, p_inviter uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN UPDATE public.staff_invitations i SET state = 'cancelled', closed_at = now()
               WHERE i.tenant_id = p_tenant AND i.invited_by = p_inviter AND i.state = 'pending'
                 AND NOT public.staff_inviter_may_grant(p_tenant, p_inviter, i.roles)
               RETURNING i.id LOOP
    PERFORM public.audit_append('settings_change', 'staff_invitation', v_id, 'success', 'invitation_cancelled');
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_invitations_recheck(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Ends a staff member's active duties, each audited (IAM-13: duties only on Owner/Admin Pusat).
CREATE FUNCTION public.staff_duties_end(p_tenant uuid, p_staff uuid, p_by uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN UPDATE public.staff_duties SET ended_at = now(), ended_by = p_by
               WHERE tenant_id = p_tenant AND staff_id = p_staff AND ended_at IS NULL RETURNING id LOOP
    PERFORM public.audit_append('settings_change', 'staff_duty', v_id, 'success', 'duty_removed');
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_duties_end(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The target staff member of this tenant, not the actor (nobody changes their own access).
CREATE FUNCTION public.staff_target(p_tenant uuid, p_actor uuid, p_staff uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_membership uuid;
BEGIN
  SELECT s.membership_id INTO v_membership FROM public.staff s WHERE s.tenant_id = p_tenant AND s.id = p_staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_staff = p_actor THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: nobody changes their own access' USING ERRCODE = '42501';
  END IF;
  RETURN v_membership;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_target(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- An Admin Pusat never acts on an owner or another privileged-role holder (IAM-11: those
-- changes need the owner).
CREATE FUNCTION public.staff_admin_may_touch(p_tenant uuid, p_role text, p_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_role = 'owner' OR NOT EXISTS (
    SELECT 1 FROM public.staff_roles r
     WHERE r.tenant_id = p_tenant AND r.staff_id = p_staff
       AND r.role IN ('owner','admin_pusat','finance','facility_head','records_officer','auditor'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_admin_may_touch(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- IAM-16: ends access now. The row lists the sessions it ends — one (Cabut Sesi) or every
-- unexpired session of the member's account — and staff_session_revoked refuses a listed
-- session for this membership on its next request. Listing ids instead of comparing
-- revoked_at with the session's created_at keeps app/database clock skew and transaction
-- start times out of the decision; a later sign-in is a new session and is not listed.
-- Returns the row id: the audit row points at it, so the log can say which role/branch.
CREATE FUNCTION public.staff_revoke(p_tenant uuid, p_membership uuid, p_session uuid, p_reason text, p_by uuid,
                                    p_role text DEFAULT NULL, p_branch uuid DEFAULT NULL) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO public.membership_revocations (tenant_id, membership_id, session_ids, reason, revoked_by, role, branch_id)
  SELECT p_tenant, p_membership,
         CASE WHEN p_session IS NOT NULL THEN ARRAY[p_session]
              ELSE coalesce((SELECT array_agg(se.id ORDER BY se.id) FROM public.auth_session se
                              JOIN public.memberships m ON m.account_id = se.user_id
                             WHERE m.tenant_id = p_tenant AND m.id = p_membership AND se.expires_at > now()), '{}') END,
         p_reason, p_by, p_role, p_branch
  RETURNING id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_revoke(uuid, uuid, uuid, text, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Pengguna & Akses › Cabut Sesi: one session of one staff member's account. The session
-- must belong to that staff member's account; other memberships of the same account are
-- untouched (the revocation is per membership).
CREATE FUNCTION public.staff_session_revoke(p_staff uuid, p_session uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_membership uuid;
  v_rev uuid;
BEGIN
  SELECT * INTO a FROM public.staff_admin_lock();
  v_membership := public.staff_target(a.tenant_id, a.staff_id, p_staff);
  IF NOT public.staff_admin_may_touch(a.tenant_id, a.role, p_staff) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this staff member is managed by the owner' USING ERRCODE = '42501';
  END IF;
  IF p_session IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.auth_session se JOIN public.memberships m ON m.account_id = se.user_id
        WHERE se.id = p_session AND m.tenant_id = a.tenant_id AND m.id = v_membership) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: session not found' USING ERRCODE = 'P0002';
  END IF;
  v_rev := public.staff_revoke(a.tenant_id, v_membership, p_session, 'session_revoked', a.staff_id);
  PERFORM public.audit_append('settings_change', 'membership_revocation', v_rev, 'success', 'session_revoked');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_session_revoke(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_session_revoke(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Akhiri Keanggotaan: the membership ends now and every session of it is revoked.
CREATE FUNCTION public.staff_end_membership(p_staff uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_membership uuid;
BEGIN
  SELECT * INTO a FROM public.staff_admin_lock();
  v_membership := public.staff_target(a.tenant_id, a.staff_id, p_staff);
  IF NOT public.staff_admin_may_touch(a.tenant_id, a.role, p_staff) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this staff member is managed by the owner' USING ERRCODE = '42501';
  END IF;
  -- clock_timestamp: after a lock wait, now() (the transaction start) may lie before this
  -- membership's start; greatest() keeps effective_to after effective_from.
  UPDATE public.memberships SET effective_to = greatest(clock_timestamp(), effective_from + interval '1 microsecond')
   WHERE tenant_id = a.tenant_id AND id = v_membership AND (effective_to IS NULL OR effective_to > clock_timestamp());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: membership already ended' USING ERRCODE = '55000';
  END IF;
  PERFORM public.staff_duties_end(a.tenant_id, p_staff, a.staff_id);
  PERFORM public.staff_invitations_recheck(a.tenant_id, p_staff);
  PERFORM public.audit_append('settings_change', 'membership_revocation',
    public.staff_revoke(a.tenant_id, v_membership, NULL, 'membership_ended', a.staff_id), 'success', 'membership_ended');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_end_membership(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_end_membership(uuid) TO clinic_app;--> statement-breakpoint

-- Removing a role (IAM-11: Admin Pusat removes Level 3 roles directly; privileged roles
-- through the owner). Its branch rows go with it; the membership's sessions are revoked.
CREATE FUNCTION public.staff_role_remove(p_staff uuid, p_role text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_membership uuid;
  v_role_id uuid;
BEGIN
  SELECT * INTO a FROM public.staff_admin_lock();
  v_membership := public.staff_target(a.tenant_id, a.staff_id, p_staff);
  IF a.role = 'admin_pusat' AND p_role NOT IN ('manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: removing this role needs the owner' USING ERRCODE = '42501';
  END IF;
  IF NOT public.staff_admin_may_touch(a.tenant_id, a.role, p_staff) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this staff member is managed by the owner' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_role_id FROM public.staff_roles WHERE tenant_id = a.tenant_id AND staff_id = p_staff AND role = p_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: role not held' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.staff_branches WHERE tenant_id = a.tenant_id AND staff_role_id = v_role_id;
  DELETE FROM public.staff_roles WHERE tenant_id = a.tenant_id AND id = v_role_id;
  PERFORM public.audit_append('settings_change', 'membership_revocation',
    public.staff_revoke(a.tenant_id, v_membership, NULL, 'role_removed', a.staff_id, p_role), 'success', 'role_removed');
  -- IAM-13: duties exist only on an Owner or Admin Pusat; they end with the last such role.
  IF NOT EXISTS (SELECT 1 FROM public.staff_roles WHERE tenant_id = a.tenant_id AND staff_id = p_staff AND role IN ('owner','admin_pusat')) THEN
    PERFORM public.staff_duties_end(a.tenant_id, p_staff, a.staff_id);
  END IF;
  PERFORM public.staff_invitations_recheck(a.tenant_id, p_staff);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_role_remove(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_role_remove(uuid, text) TO clinic_app;--> statement-breakpoint

-- Branch scope of a Level 3 role: add or remove one branch; removal revokes sessions.
CREATE FUNCTION public.staff_branch_set(p_staff uuid, p_role text, p_branch uuid, p_assigned boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_membership uuid;
  v_role_id uuid;
  v_row uuid;
BEGIN
  SELECT * INTO a FROM public.staff_admin_lock();
  v_membership := public.staff_target(a.tenant_id, a.staff_id, p_staff);
  IF NOT public.staff_admin_may_touch(a.tenant_id, a.role, p_staff) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this staff member is managed by the owner' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_role_id FROM public.staff_roles
   WHERE tenant_id = a.tenant_id AND staff_id = p_staff AND role = p_role
     AND p_role IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch role not held' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = a.tenant_id AND id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_assigned THEN
    INSERT INTO public.staff_branches (tenant_id, staff_role_id, staff_id, role, branch_id)
    VALUES (a.tenant_id, v_role_id, p_staff, p_role, p_branch) ON CONFLICT DO NOTHING RETURNING id INTO v_row;
    IF v_row IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: branch already assigned' USING ERRCODE = '55000';
    END IF;
    PERFORM public.audit_append('settings_change', 'staff_branch', v_row, 'success', 'branch_assigned');
  ELSE
    DELETE FROM public.staff_branches WHERE tenant_id = a.tenant_id AND staff_role_id = v_role_id AND branch_id = p_branch;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not assigned' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.audit_append('settings_change', 'membership_revocation',
      public.staff_revoke(a.tenant_id, v_membership, NULL, 'branch_removed', a.staff_id, p_role, p_branch), 'success', 'branch_removed');
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_branch_set(uuid, text, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_branch_set(uuid, text, uuid, boolean) TO clinic_app;--> statement-breakpoint

-- IAM-13 duties: only the owner assigns or ends them, and only on Owner or Admin Pusat.
CREATE FUNCTION public.staff_duty_set(p_staff uuid, p_duty text, p_assigned boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_membership uuid;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.staff_admin_lock();
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner assigns duties' USING ERRCODE = '42501';
  END IF;
  IF p_duty NOT IN ('data_protection','it_admin') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: unknown duty' USING ERRCODE = 'P0002';
  END IF;
  -- An owner may hold a duty themselves (a one-owner clinic); only the target check differs.
  SELECT s.membership_id INTO v_membership FROM public.staff s WHERE s.tenant_id = a.tenant_id AND s.id = p_staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_assigned AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = a.tenant_id AND m.id = v_membership
                                   AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: membership not active' USING ERRCODE = 'P0002';
  END IF;
  IF p_assigned THEN
    IF NOT EXISTS (SELECT 1 FROM public.staff_roles WHERE tenant_id = a.tenant_id AND staff_id = p_staff AND role IN ('owner','admin_pusat')) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: duties go to an Owner or Admin Pusat' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.staff_duties (tenant_id, staff_id, duty, assigned_by) VALUES (a.tenant_id, p_staff, p_duty, a.staff_id)
    ON CONFLICT (tenant_id, staff_id, duty) WHERE ended_at IS NULL DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: duty already assigned' USING ERRCODE = '55000';
    END IF;
    PERFORM public.audit_append('settings_change', 'staff_duty', v_id, 'success', 'duty_assigned');
  ELSE
    UPDATE public.staff_duties SET ended_at = now(), ended_by = a.staff_id
     WHERE tenant_id = a.tenant_id AND staff_id = p_staff AND duty = p_duty AND ended_at IS NULL
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: duty not assigned' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.staff_revoke(a.tenant_id, v_membership, NULL, 'duty_removed', a.staff_id);
    PERFORM public.audit_append('settings_change', 'staff_duty', v_id, 'success', 'duty_removed');
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_duty_set(uuid, text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_duty_set(uuid, text, boolean) TO clinic_app;--> statement-breakpoint

-- Undangan: the staff admin invites a person with roles and branches. Admin Pusat invites
-- only Level 3 roles (the rest need the owner); branch roles need at least one branch.
CREATE FUNCTION public.staff_invite(p_email text, p_name text, p_roles text[], p_branches uuid[], p_token_hash text, p_days integer)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_id uuid;
  v_email text := lower(btrim(p_email));
BEGIN
  SELECT * INTO a FROM public.staff_admin_lock();
  -- NULL arrays first: NULL makes every later check unknown, and IF unknown does not raise.
  IF p_roles IS NULL OR p_days IS NULL OR p_email IS NULL OR p_token_hash IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: invalid invitation' USING ERRCODE = '22023';
  END IF;
  -- One row per role and branch (a duplicate would only fail later, at accept).
  p_roles := ARRAY(SELECT DISTINCT r FROM unnest(p_roles) r ORDER BY 1);
  IF cardinality(p_roles) = 0 OR EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r IS NULL OR r NOT IN
       ('owner','admin_pusat','finance','facility_head','records_officer','auditor','central_cs','marketing','purchasing',
        'manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist'))
     OR v_email IS NULL OR length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
     OR length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 120 OR p_token_hash IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: invalid invitation' USING ERRCODE = '22023';
  END IF;
  p_branches := ARRAY(SELECT DISTINCT b FROM unnest(coalesce(p_branches, '{}')) b ORDER BY 1);
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 14 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an invitation lasts 1 to 14 days' USING ERRCODE = '22023';
  END IF;
  IF a.role = 'admin_pusat' AND EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r NOT IN ('manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist')) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: inviting this role needs the owner' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist'))
     AND cardinality(coalesce(p_branches, '{}')) = 0 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a branch role needs a branch' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_branches, '{}')) b WHERE NOT EXISTS (SELECT 1 FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = b)) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  -- Someone with a membership here (active or ended) is not invited: an account has one
  -- membership per tenant, and rejoining a former member is a separate, later flow.
  IF EXISTS (SELECT 1 FROM public.memberships m JOIN public.auth_user u ON u.id = m.account_id
              WHERE m.tenant_id = a.tenant_id AND lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already a member' USING ERRCODE = '55000';
  END IF;
  -- An expired invitation for this email no longer blocks a new one.
  UPDATE public.staff_invitations SET state = 'expired', closed_at = now()
   WHERE tenant_id = a.tenant_id AND email = v_email AND state = 'pending' AND expires_at <= now();
  BEGIN
    INSERT INTO public.staff_invitations (tenant_id, email, display_name, roles, branch_ids, token_hash, invited_by, expires_at)
    VALUES (a.tenant_id, v_email, btrim(p_name), p_roles, p_branches, p_token_hash, a.staff_id,
            now() + make_interval(days => p_days))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an invitation for this email is pending' USING ERRCODE = '23505';
  END;
  PERFORM public.audit_append('settings_change', 'staff_invitation', v_id, 'success', 'invitation_created');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_invite(text, text, text[], uuid[], text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_invite(text, text, text[], uuid[], text, integer) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.staff_invite_cancel(p_invitation uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.staff_admin_lock();
  -- IAM-11: Admin Pusat cancels only invitations it could have sent (Level 3 roles).
  UPDATE public.staff_invitations SET state = 'cancelled', closed_at = now()
   WHERE tenant_id = a.tenant_id AND id = p_invitation AND state = 'pending'
     AND (a.role = 'owner' OR roles <@ ARRAY['manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist']);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no pending invitation' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('settings_change', 'staff_invitation', p_invitation, 'success', 'invitation_cancelled');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_invite_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_invite_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- Accepting runs before any tenant context exists (the person has no membership yet): the
-- token identifies the invitation; the caller passes the account the invitation flow just
-- created or signed in for that email. Creates membership, staff, roles and branches.
CREATE FUNCTION public.staff_invite_accept(p_token_hash text, p_account uuid) RETURNS TABLE (tenant_id uuid, staff_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  inv public.staff_invitations;
  v_email text;
  v_membership uuid;
  v_staff uuid;
  v_role text;
  v_role_id uuid;
  v_branch uuid;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: accept runs outside a tenant context' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO inv FROM public.staff_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.state <> 'pending' OR inv.expires_at <= now()
     OR NOT public.staff_inviter_may_grant(inv.tenant_id, inv.invited_by, inv.roles) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invitation not valid' USING ERRCODE = 'P0002';
  END IF;
  SELECT email INTO v_email FROM public.auth_user WHERE id = p_account;
  IF NOT FOUND OR lower(v_email) <> inv.email THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the invitation is for another email' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = inv.tenant_id AND m.account_id = p_account) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already a member' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.memberships (tenant_id, account_id) VALUES (inv.tenant_id, p_account) RETURNING id INTO v_membership;
  INSERT INTO public.staff (tenant_id, membership_id, display_name) VALUES (inv.tenant_id, v_membership, inv.display_name) RETURNING id INTO v_staff;
  FOREACH v_role IN ARRAY inv.roles LOOP
    INSERT INTO public.staff_roles (tenant_id, staff_id, role) VALUES (inv.tenant_id, v_staff, v_role) RETURNING id INTO v_role_id;
    IF v_role IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist') THEN
      FOREACH v_branch IN ARRAY inv.branch_ids LOOP
        INSERT INTO public.staff_branches (tenant_id, staff_role_id, staff_id, role, branch_id) VALUES (inv.tenant_id, v_role_id, v_staff, v_role, v_branch);
      END LOOP;
    END IF;
  END LOOP;
  UPDATE public.staff_invitations SET state = 'accepted', accepted_staff_id = v_staff, closed_at = now()
   WHERE id = inv.id;
  -- The acceptance is audited as the new staff member acting in its first invited role
  -- (at its first branch for a branch role); the context is bound only for this call.
  v_role := inv.roles[1];
  PERFORM set_config('app.tenant_id', inv.tenant_id::text, true),
          set_config('app.staff_id', v_staff::text, true),
          set_config('app.roles', v_role, true),
          set_config('app.active_branch_id',
            CASE WHEN v_role IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist')
                 THEN inv.branch_ids[1]::text ELSE '' END, true);
  PERFORM public.audit_append('settings_change', 'staff_invitation', inv.id, 'success', 'invitation_accepted');
  PERFORM set_config('app.tenant_id', '', true), set_config('app.staff_id', '', true),
          set_config('app.roles', '', true), set_config('app.active_branch_id', '', true);
  RETURN QUERY SELECT inv.tenant_id, v_staff;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_invite_accept(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_invite_accept(text, uuid) TO clinic_app;--> statement-breakpoint

-- The invitation an invite link points at (before accepting): who, for which clinic, still valid.
CREATE FUNCTION public.staff_invite_lookup(p_token_hash text) RETURNS TABLE (email text, display_name text, clinic text, roles text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.email, i.display_name, t.legal_name, i.roles
    FROM public.staff_invitations i JOIN public.tenants t ON t.id = i.tenant_id
   WHERE i.token_hash = p_token_hash AND i.state = 'pending' AND i.expires_at > now()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_invite_lookup(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_invite_lookup(text) TO clinic_app;--> statement-breakpoint

-- IAM-16: is this session revoked for this membership? Called with every request's
-- context; a session listed by any revocation of the membership is refused.
CREATE FUNCTION public.staff_session_revoked(p_membership uuid, p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership_revocations r
     WHERE r.membership_id = p_membership AND p_session = ANY (r.session_ids))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_session_revoked(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_session_revoked(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Pengguna & Akses › sessions of one staff member (ids, device hints, times; no tokens).
CREATE FUNCTION public.staff_sessions(p_staff uuid) RETURNS TABLE (session_id uuid, user_agent text, created_at timestamptz, last_active_at timestamptz, revoked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_membership uuid;
BEGIN
  SELECT * INTO a FROM public.staff_admin();
  SELECT s.membership_id INTO v_membership FROM public.staff s WHERE s.tenant_id = a.tenant_id AND s.id = p_staff;
  IF NOT FOUND OR NOT public.staff_admin_may_touch(a.tenant_id, a.role, p_staff) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT se.id, left(se.user_agent, 200), se.created_at, se.last_active_at, public.staff_session_revoked(v_membership, se.id)
    FROM public.auth_session se JOIN public.memberships m ON m.account_id = se.user_id
   WHERE m.tenant_id = a.tenant_id AND m.id = v_membership AND se.expires_at > now()
   ORDER BY se.last_active_at DESC;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_sessions(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.staff_sessions(uuid) TO clinic_app;--> statement-breakpoint

-- Revocations and invitations are history: never updated except closing, never deleted.
CREATE TRIGGER membership_revocations_no_change BEFORE UPDATE OR DELETE ON public.membership_revocations
  FOR EACH ROW EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.membership_revocations', 'tenant-shared', 'org', '{owner,admin_pusat}', 'staff access functions (src/modules/org/access)', 'none'),
  ('public.staff_duties', 'tenant-shared', 'org', '{owner,admin_pusat,self}', 'staff access functions (src/modules/org/access)', 'none'),
  ('public.staff_invitations', 'tenant-shared', 'org', '{owner,admin_pusat}', 'staff access functions (src/modules/org/staff)', 'branches of the invited roles');
--> statement-breakpoint
CREATE INDEX membership_revocations_membership ON public.membership_revocations (membership_id);
