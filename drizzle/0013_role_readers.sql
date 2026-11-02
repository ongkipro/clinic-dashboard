-- Role-aware readers (TEN-18, IAM-5, PR-63): who may read each tenant-shared table,
-- generated from the 07 role matrix (src/modules/org/roles/matrix.ts; the readers test
-- fails when this file and the matrix disagree). Every read policy keeps the tenant
-- predicate and adds "the acting role is a reader". Applied by migration
-- 0013_role_readers.sql, which must stay byte-identical to this file.
--
-- Staff & invitations: owner, admin_pusat, manager, facility_head (07 row).
-- Every member: tenants and branches; plus their own staff, membership, role, branch,
-- request and context-action rows (a session needs its identity).

CREATE FUNCTION public.app_role_in(p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT public.app_acting_role() = ANY (p_roles)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_role_in(text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_role_in(text[]) TO clinic_app;--> statement-breakpoint

DROP POLICY memberships_read ON public.memberships;--> statement-breakpoint
CREATE POLICY memberships_read ON public.memberships FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
              OR id = (SELECT s.membership_id FROM public.staff s
                        WHERE s.tenant_id = memberships.tenant_id AND s.id = public.app_staff_id())));--> statement-breakpoint

DROP POLICY staff_read ON public.staff;--> statement-breakpoint
CREATE POLICY staff_read ON public.staff FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
              OR id = public.app_staff_id()));--> statement-breakpoint

DROP POLICY staff_roles_read ON public.staff_roles;--> statement-breakpoint
CREATE POLICY staff_roles_read ON public.staff_roles FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
              OR staff_id = public.app_staff_id()));--> statement-breakpoint

DROP POLICY staff_branches_read ON public.staff_branches;--> statement-breakpoint
CREATE POLICY staff_branches_read ON public.staff_branches FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
              OR staff_id = public.app_staff_id()));--> statement-breakpoint

-- Context actions reveal who acted in which role: same readers as staff, plus own rows.
DROP POLICY org_actions_read ON public.org_actions;--> statement-breakpoint
CREATE POLICY org_actions_read ON public.org_actions FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
              OR staff_id = public.app_staff_id()));--> statement-breakpoint

-- Role requests (PR-63): the same readers as staff, plus the requester and the subject.
ALTER TABLE public.role_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY role_requests_read ON public.role_requests FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
              OR requested_by = public.app_staff_id() OR staff_id = public.app_staff_id()));--> statement-breakpoint
GRANT SELECT ON public.role_requests TO clinic_app;--> statement-breakpoint

-- Audit log, data requests: owner, facility_head, records_officer, auditor (07 row;
-- Admin Pusat only with the data-protection duty, which T-031 introduces — none yet).
-- The branch scope for facility head / records officer stays as in 0011.
DROP POLICY audit_events_read ON public.audit_events;--> statement-breakpoint
CREATE POLICY audit_events_read ON public.audit_events FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_role_in(ARRAY['owner','auditor'])
              OR public.app_role_in(ARRAY['facility_head','records_officer'])
                 AND public.app_branch_allowed(branch_id)));--> statement-breakpoint

UPDATE public.scope_map SET reader_roles = '{owner,admin_pusat,manager,facility_head,self}'
 WHERE table_name IN ('public.memberships','public.staff','public.staff_roles','public.staff_branches');--> statement-breakpoint
UPDATE public.scope_map SET reader_roles = '{*}'
 WHERE table_name IN ('public.tenants','public.branches');--> statement-breakpoint
UPDATE public.scope_map SET reader_roles = '{owner,admin_pusat,manager,facility_head,self}'
 WHERE table_name = 'public.org_actions';--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.role_requests', 'tenant-shared', 'org', '{owner,admin_pusat,manager,facility_head,self}', 'org (role requests)', 'none');
--> statement-breakpoint

-- IAM-11 / PR-63 role administration. The only ways clinic_app changes a role set:
--  role_assign(staff, role):
--    acting as Admin Pusat: Level 3 roles apply directly, except Facility head and
--      Records officer (owner-approval list); every other role (all Level 2 roles) becomes
--      a pending request for the owner.
--    acting as Owner: applies directly; the owner's assignment is the owner's approval
--      (DEC-015, to be confirmed by the product owner).
--  role_request_decide(request, approve): an Owner other than the requester and the
--    subject decides.
-- Nobody changes their own role set. Every call is audited (audit_append).
CREATE FUNCTION public.role_assign(p_staff uuid, p_role text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_actor uuid := public.app_staff_id();
  v_as text := public.app_acting_role();
  v_request uuid;
  v_role_id uuid;
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL OR v_as IS NULL OR v_as NOT IN ('owner','admin_pusat') THEN
    RAISE EXCEPTION 'only Owner or Admin Pusat assign roles' USING ERRCODE = '42501';
  END IF;
  -- The actor must really hold the acting role (same check as audit_append).
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = v_as
                  WHERE s.tenant_id = v_tenant AND s.id = v_actor
                    AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())) THEN
    RAISE EXCEPTION 'bound context is not an active membership with that role' USING ERRCODE = '42501';
  END IF;
  IF p_staff = v_actor THEN
    RAISE EXCEPTION 'nobody changes their own role set' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                  WHERE s.tenant_id = v_tenant AND s.id = p_staff
                    AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())) THEN
    RAISE EXCEPTION 'staff not found or membership not active' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_roles x WHERE x.tenant_id = v_tenant AND x.staff_id = p_staff AND x.role = p_role) THEN
    RAISE EXCEPTION 'role already held' USING ERRCODE = '23505';
  END IF;
  -- IAM-11: Admin Pusat assigns Level 3 roles directly; every other role it asks for
  -- becomes a request for the owner. An assignment made while acting as Owner is the
  -- owner's own decision (DEC-015) and applies directly.
  IF v_as = 'admin_pusat'
     AND p_role NOT IN ('manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist') THEN
    -- role_requests_one_pending (unique) refuses a second open request with 23505.
    INSERT INTO public.role_requests (tenant_id, staff_id, role, change, requested_by, requested_as)
    VALUES (v_tenant, p_staff, p_role, 'grant', v_actor, v_as) RETURNING id INTO v_request;
    PERFORM public.audit_append('approval', 'role_request', v_request, 'success', 'role_grant_requested');
    RETURN jsonb_build_object('state', 'pending', 'request_id', v_request);
  END IF;
  INSERT INTO public.staff_roles (tenant_id, staff_id, role) VALUES (v_tenant, p_staff, p_role)
    RETURNING id INTO v_role_id;
  PERFORM public.audit_append('settings_change', 'staff_role', v_role_id, 'success', 'role_assigned');
  RETURN jsonb_build_object('state', 'active', 'staff_role_id', v_role_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.role_assign(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.role_assign(uuid, text) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.role_request_decide(p_request uuid, p_approve boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_actor uuid := public.app_staff_id();
  r public.role_requests;
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL OR public.app_acting_role() IS DISTINCT FROM 'owner'
     OR NOT EXISTS (SELECT 1 FROM public.staff s
                      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                      JOIN public.staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.id AND sr.role = 'owner'
                     WHERE s.tenant_id = v_tenant AND s.id = v_actor
                       AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())) THEN
    RAISE EXCEPTION 'only an Owner decides role requests' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.role_requests
   WHERE tenant_id = v_tenant AND id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.state <> 'pending' THEN
    RAISE EXCEPTION 'request already decided' USING ERRCODE = '55000';
  END IF;
  IF r.change <> 'grant' THEN
    RAISE EXCEPTION 'only grant requests are supported' USING ERRCODE = '0A000';
  END IF;
  IF r.requested_by = v_actor OR r.staff_id = v_actor THEN
    RAISE EXCEPTION 'requester or subject cannot decide' USING ERRCODE = '42501';
  END IF;
  IF p_approve AND NOT EXISTS (
       SELECT 1 FROM public.staff s
         JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        WHERE s.tenant_id = v_tenant AND s.id = r.staff_id
          AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())) THEN
    RAISE EXCEPTION 'subject membership is not active; reject the request instead' USING ERRCODE = '55000';
  END IF;
  UPDATE public.role_requests SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = v_actor, decided_at = now()
   WHERE tenant_id = v_tenant AND id = p_request;
  IF p_approve THEN
    INSERT INTO public.staff_roles (tenant_id, staff_id, role) VALUES (v_tenant, r.staff_id, r.role)
      ON CONFLICT (tenant_id, staff_id, role) DO NOTHING;
  END IF;
  PERFORM public.audit_append('approval', 'role_request', p_request, 'success',
                              CASE WHEN p_approve THEN 'role_grant_approved' ELSE 'role_grant_rejected' END);
  RETURN jsonb_build_object('state', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.role_request_decide(uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.role_request_decide(uuid, boolean) TO clinic_app;
