-- HYG-002 (DEC-031): owner decisions of 2026-11-03 applied to the database.
--
-- D2  Settings drafts decided by the facility head: a tenant-scope draft (no branch) is
--     decided by any active facility head of the tenant; when the tenant has none, the
--     draft goes to the owner instead. A branch draft stays with that branch's facility head.
-- D3  Evidence: the uploader may approve their own file only when nobody else in the tenant
--     could decide that area (sole decider); the approval is audited as self-approval.
-- D7  A new Owner must confirm: an Owner's assignment of the owner role waits for the
--     assigned person's confirmation (role_owner_confirm) before the role exists.

-- ── D2 ──────────────────────────────────────────────────────────────────────────────────
-- The owner decides clinical drafts only as the fallback.
UPDATE public.approval_types SET approver_roles = '{facility_head,owner}' WHERE key = 'setting_change_fh';--> statement-breakpoint

-- Is this approval a settings draft of a tenant-scope value (the draft version has no
-- branch)? The approval itself carries the requester's branch for routing.
-- SECURITY DEFINER: also used by the approvals_read policy (no recursion through RLS).
-- Bound to the caller's tenant (app_tenant_id): never an oracle for another tenant's ids.
CREATE FUNCTION public.approval_is_tenant_setting_draft(p_tenant uuid, p_approval uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = public.app_tenant_id() AND EXISTS (SELECT 1 FROM public.approvals ap
                   JOIN public.setting_versions v ON v.tenant_id = ap.tenant_id AND v.id = ap.subject_id
                  WHERE ap.tenant_id = p_tenant AND ap.id = p_approval AND ap.type = 'setting_change_fh'
                    AND ap.subject_kind = 'setting_version' AND v.branch_id IS NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_is_tenant_setting_draft(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_is_tenant_setting_draft(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Could a facility head other than p_except decide this clinical draft? A tenant-scope draft:
-- any active facility head; a branch draft: one assigned to that branch (finding round 2 #4).
CREATE FUNCTION public.approval_fh_available(p_tenant uuid, p_approval uuid, p_except uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.approvals ap
                   JOIN public.staff s ON s.tenant_id = ap.tenant_id AND s.id IS DISTINCT FROM p_except
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = 'facility_head'
                  WHERE ap.tenant_id = p_tenant AND ap.id = p_approval
                    AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
                    AND (public.approval_is_tenant_setting_draft(p_tenant, p_approval)
                         OR ap.branch_id IS NULL
                         OR EXISTS (SELECT 1 FROM public.staff_branches b WHERE b.tenant_id = s.tenant_id AND b.staff_role_id = r.id AND b.branch_id = ap.branch_id)))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_fh_available(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Does the tenant have an active facility head (any branch)?
CREATE FUNCTION public.tenant_has_role(p_tenant uuid, p_role text, p_except uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = p_role
                  WHERE s.tenant_id = p_tenant AND s.id IS DISTINCT FROM p_except
                    AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now()))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_has_role(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Decide an approval (as 0022), with two settings rules for setting_change_fh:
--  * a tenant-scope draft (branch null) may be decided by a facility head of any branch;
--  * the owner decides it only while the tenant has no active facility head.
CREATE OR REPLACE FUNCTION public.approval_decide(p_approval uuid, p_approve boolean, p_reason text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  ap public.approvals;
  t public.approval_types;
  v_tenant_draft boolean;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO ap FROM public.approvals WHERE tenant_id = a.tenant_id AND id = p_approval FOR UPDATE;
  v_tenant_draft := FOUND AND public.approval_is_tenant_setting_draft(a.tenant_id, p_approval);
  -- What the caller cannot read (approvals_read) does not exist for it: no state, no
  -- existence leak (TD-51). A tenant-scope clinical draft is readable by every facility head.
  IF NOT FOUND OR NOT (a.role = 'owner'
                       OR a.role IN ('manager','facility_head','records_officer') AND public.app_branch_allowed(ap.branch_id)
                       OR a.role = 'facility_head' AND v_tenant_draft
                       OR ap.requested_by = a.staff_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: approval not found' USING ERRCODE = 'P0002';
  END IF;
  IF ap.requested_by = a.staff_id THEN
    RAISE EXCEPTION 'ERR_APPROVER_IS_REQUESTER: the requester cannot decide their own request' USING ERRCODE = 'P0422';
  END IF;
  SELECT * INTO t FROM public.approval_types WHERE key = ap.type;
  IF NOT a.role = ANY (t.approver_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not decide this approval' USING ERRCODE = '42501';
  END IF;
  -- D2: the owner is only the fallback for clinical drafts.
  -- A facility head who drafted it cannot decide it, so they do not count (no deadlock).
  IF ap.type = 'setting_change_fh' AND a.role = 'owner' AND public.approval_fh_available(a.tenant_id, p_approval, ap.requested_by) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a facility head decides this draft' USING ERRCODE = '42501';
  END IF;
  IF ap.state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: approval already decided' USING ERRCODE = '55000';
  END IF;
  IF length(coalesce(p_reason, '')) > 500 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: reason over 500 characters' USING ERRCODE = '22023';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a decision must approve or reject' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a rejection needs a reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.approvals
     SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = a.staff_id, decided_as = a.role, decided_at = now(), decision_reason = NULLIF(btrim(p_reason), '')
   WHERE tenant_id = a.tenant_id AND id = p_approval;
  PERFORM public.audit_append('approval', 'approval', p_approval, 'success',
                              CASE WHEN p_approve THEN 'approval_approved' ELSE 'approval_rejected' END);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (ap.branch_id, 'ApprovalDecided', 'approval', p_approval,
          jsonb_build_object('approval_type', ap.type, 'outcome', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
                             'subject_kind', ap.subject_kind, 'subject_id', ap.subject_id));
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END
$$;--> statement-breakpoint

-- Persetujuan readers: a tenant-scope clinical draft is also visible to every facility head.
DROP POLICY approvals_read ON public.approvals;--> statement-breakpoint
CREATE POLICY approvals_read ON public.approvals FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_acting_role() = 'owner'
              OR public.app_acting_role() IN ('manager','facility_head','records_officer')
                 AND public.app_branch_allowed(branch_id)
              OR public.app_acting_role() = 'facility_head' AND type = 'setting_change_fh'
                 AND public.approval_is_tenant_setting_draft(tenant_id, id)
              OR requested_by = public.app_staff_id()));--> statement-breakpoint

-- ── D3 ──────────────────────────────────────────────────────────────────────────────────
-- Could anyone other than p_staff decide this area in the tenant? (owner for every area,
-- facility head for clinical, finance for tax and accounting.)
-- Derived from compliance_may_act over the tenant's active roles (one rule, no drift).
CREATE FUNCTION public.compliance_other_decider(p_tenant uuid, p_area text, p_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id
                  WHERE s.tenant_id = p_tenant AND s.id <> p_staff
                    AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
                    AND public.compliance_may_act(r.role, p_area))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.compliance_other_decider(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.evidence_decide(p_item uuid, p_file uuid, p_decision text, p_reason text, p_valid_until date)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  i public.evidence_items;
  o public.compliance_obligations;
  f public.evidence_files;
  v_valid date;
  v_name text;
  v_config text;
  v_self boolean := false;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO i FROM public.evidence_items WHERE tenant_id = a.tenant_id AND id = p_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: evidence not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO STRICT o FROM public.compliance_obligations WHERE key = i.obligation_key;
  IF NOT coalesce(public.compliance_may_act(a.role, o.area), false) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this role does not decide this evidence' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved','rejected','revoked') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: unknown decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.evidence_files WHERE item_id = i.id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no file to decide' USING ERRCODE = 'P0002';
  END IF;
  -- The decision is about the file the decider reviewed: a newer upload since then is a conflict.
  IF p_file IS DISTINCT FROM f.id THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a newer file was uploaded' USING ERRCODE = '55000';
  END IF;
  IF p_decision = 'revoked' AND i.state <> 'approved' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: only an approved item is revoked' USING ERRCODE = '55000';
  END IF;
  IF p_decision IN ('approved','rejected') AND public.evidence_item_status(i.id) NOT IN ('submitted','expired','rejected','revoked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already decided' USING ERRCODE = '55000';
  END IF;
  -- The uploader never decides their own file, unless nobody else in the tenant could
  -- (D3: a one-owner clinic is not stuck); that approval is audited as self-approval. The
  -- check runs under the tenant's staff lock so a second decider joining at the same time
  -- is seen.
  IF p_decision IN ('approved','rejected') AND f.uploaded_by = a.staff_id THEN
    -- The same lock as every staff/role change (staff_admin_lock, 0026).
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || a.tenant_id::text, 0));
    IF public.compliance_other_decider(a.tenant_id, o.area, a.staff_id) THEN
      RAISE EXCEPTION 'ERR_APPROVER_IS_REQUESTER: the uploader cannot decide this file' USING ERRCODE = 'P0422';
    END IF;
    v_self := true;
  END IF;
  IF p_decision <> 'approved' AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a rejection or revocation needs a reason' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_reason, '')) > 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason over 500 characters' USING ERRCODE = '22023';
  END IF;
  v_valid := CASE WHEN o.valid_months IS NULL THEN p_valid_until
                  ELSE least(coalesce(p_valid_until, 'infinity'::date), ((now() AT TIME ZONE 'Asia/Jakarta')::date + make_interval(months => o.valid_months))::date) END;
  IF p_decision = 'approved' AND v_valid IS NOT NULL AND v_valid < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: validity in the past' USING ERRCODE = '22023';
  END IF;
  v_config := public.compliance_config_version(i.tenant_id, o.config_kind);
  SELECT display_name INTO STRICT v_name FROM public.staff WHERE tenant_id = a.tenant_id AND id = a.staff_id;
  INSERT INTO public.evidence_approvals (item_id, tenant_id, file_id, config_version, decision, reason, valid_until, decided_by, decided_as, decided_name)
  VALUES (i.id, i.tenant_id, f.id, v_config, p_decision, NULLIF(btrim(p_reason), ''), CASE WHEN p_decision = 'approved' THEN v_valid END,
          a.staff_id, a.role, v_name);
  UPDATE public.evidence_items
     SET state = p_decision, valid_until = CASE WHEN p_decision = 'approved' THEN v_valid ELSE valid_until END,
         config_version = CASE WHEN p_decision = 'approved' THEN v_config ELSE config_version END, updated_at = now()
   WHERE id = i.id;
  PERFORM public.audit_append('approval', 'evidence_item', i.id, 'success',
          CASE WHEN v_self THEN 'self_' ELSE '' END ||
          CASE p_decision WHEN 'approved' THEN 'evidence_approved' WHEN 'rejected' THEN 'evidence_rejected' ELSE 'evidence_revoked' END);
  RETURN p_decision;
END
$$;--> statement-breakpoint

-- The register's "may decide the newest file" follows the same rule.
CREATE OR REPLACE FUNCTION public.compliance_register()
RETURNS TABLE (obligation_key text, scope text, label text, area text, item_id uuid, status text, valid_until date,
               gates text[], latest_version integer, may_act boolean, may_read boolean, may_decide boolean, latest_file uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_tenant uuid;
  v_role text;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  v_tenant := a.tenant_id;
  v_role := a.role;
  IF coalesce(v_role, '') <> ALL (ARRAY['owner','admin_pusat','auditor','facility_head','finance']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: not a reader of the compliance register' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.key, o.scope, o.label, o.area,
         CASE WHEN o.scope = 'tenant' AND (v_role IN ('owner','admin_pusat','auditor') OR public.compliance_may_act(v_role, o.area)) THEN i.id END,
         CASE WHEN o.scope = 'vendor' THEN
                CASE WHEN public.vendor_evidence_open(o.key) THEN 'approved'
                     WHEN vi.state = 'approved' AND vi.valid_until < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'expired'
                     WHEN vi.state = 'approved' THEN 'submitted'
                     ELSE coalesce(vi.state, 'missing') END
              ELSE coalesce(public.evidence_item_status(i.id), 'missing') END,
         CASE WHEN o.scope = 'tenant' THEN i.valid_until WHEN public.vendor_evidence_open(o.key) THEN vi.valid_until END,
         coalesce((SELECT array_agg(g.key ORDER BY g.key) FROM public.feature_gates g WHERE g.obligation_key = o.key AND g.key <> 'test_gate'), '{}'),
         CASE WHEN o.scope = 'tenant' AND (v_role IN ('owner','admin_pusat','auditor') OR public.compliance_may_act(v_role, o.area))
              THEN (SELECT max(f.version) FROM public.evidence_files f WHERE f.tenant_id = v_tenant AND f.item_id = i.id) END,
         o.scope = 'tenant' AND public.compliance_may_act(v_role, o.area),
         o.scope = 'tenant' AND (v_role IN ('owner','admin_pusat','auditor') OR public.compliance_may_act(v_role, o.area)),
         -- Decide the newest file: a handler of the area who did not upload it, or the
         -- uploader when nobody else could decide the area (D3).
         o.scope = 'tenant' AND public.compliance_may_act(v_role, o.area)
           AND EXISTS (SELECT 1 FROM public.evidence_files f WHERE f.tenant_id = v_tenant AND f.item_id = i.id)
           AND ((SELECT f.uploaded_by FROM public.evidence_files f WHERE f.tenant_id = v_tenant AND f.item_id = i.id ORDER BY f.version DESC LIMIT 1) IS DISTINCT FROM a.staff_id
                OR NOT public.compliance_other_decider(v_tenant, o.area, a.staff_id)),
         CASE WHEN o.scope = 'tenant' AND (v_role IN ('owner','admin_pusat','auditor') OR public.compliance_may_act(v_role, o.area))
              THEN (SELECT f.id FROM public.evidence_files f WHERE f.tenant_id = v_tenant AND f.item_id = i.id ORDER BY f.version DESC LIMIT 1) END
    FROM public.compliance_obligations o
    LEFT JOIN public.evidence_items i ON o.scope = 'tenant' AND i.tenant_id = v_tenant AND i.obligation_key = o.key
    LEFT JOIN public.vendor_evidence_items vi ON o.scope = 'vendor' AND vi.obligation_key = o.key
   ORDER BY o.scope DESC, o.area, o.key;
END
$$;--> statement-breakpoint

-- ── D7 ──────────────────────────────────────────────────────────────────────────────────
-- role_assign (as 0013) except: the owner role, assigned by an Owner, becomes a request
-- the assigned person confirms (requested_as = 'owner'); Admin Pusat's Owner request still
-- needs an Owner's approval first and then the person's confirmation.
-- The awaiting_confirmation state, confirmed_at and the adjusted checks and pending index
-- come from the schema (migration 0035_role_owner_confirm).
-- Does this staff member hold this role in an active membership?
CREATE FUNCTION public.tenant_staff_has_role(p_tenant uuid, p_staff uuid, p_role text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = p_role
                  WHERE s.tenant_id = p_tenant AND s.id = p_staff
                    AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp()))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_staff_has_role(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Close a person's Owner grants that are past 14 days or whose granter is no longer an
-- Owner (audited owner_grant_lapsed). Called under the staff lock.
CREATE FUNCTION public.role_owner_grants_lapse(p_tenant uuid, p_staff uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  FOR v IN SELECT r.id FROM public.role_requests r
            WHERE r.tenant_id = p_tenant AND r.staff_id = p_staff AND r.state = 'awaiting_confirmation'
              AND (r.decided_at < now() - interval '14 days' OR NOT public.tenant_staff_has_role(p_tenant, r.decided_by, 'owner'))
            FOR UPDATE LOOP
    UPDATE public.role_requests SET state = 'rejected' WHERE tenant_id = p_tenant AND id = v;
    PERFORM public.audit_append('approval', 'role_request', v, 'success', 'owner_grant_lapsed');
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.role_owner_grants_lapse(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.role_assign(p_staff uuid, p_role text) RETURNS jsonb
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
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_tenant::text, 0));
  -- An Owner grant nobody answered in 14 days lapses here (it no longer blocks a new one).
  PERFORM public.role_owner_grants_lapse(v_tenant, p_staff);
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                  WHERE s.tenant_id = v_tenant AND s.id = p_staff
                    AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())) THEN
    RAISE EXCEPTION 'staff not found or membership not active' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_roles x WHERE x.tenant_id = v_tenant AND x.staff_id = p_staff AND x.role = p_role) THEN
    RAISE EXCEPTION 'role already held' USING ERRCODE = '23505';
  END IF;
  -- D7: an Owner's assignment of Owner is approved by that Owner and waits for the person.
  IF v_as = 'owner' AND p_role = 'owner' THEN
    INSERT INTO public.role_requests (tenant_id, staff_id, role, change, requested_by, requested_as, state, decided_by, decided_at)
    VALUES (v_tenant, p_staff, p_role, 'grant', v_actor, v_as, 'awaiting_confirmation', v_actor, now()) RETURNING id INTO v_request;
    PERFORM public.audit_append('approval', 'role_request', v_request, 'success', 'owner_grant_awaits_confirmation');
    RETURN jsonb_build_object('state', 'awaiting_confirmation', 'request_id', v_request);
  END IF;
  -- IAM-11: Admin Pusat assigns Level 3 roles directly; every other role it asks for
  -- becomes a request for the owner.
  IF v_as = 'admin_pusat'
     AND p_role NOT IN ('manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist') THEN
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

-- An Owner approves Admin Pusat's request (as 0013); an approved Owner grant then waits for
-- the person's confirmation instead of creating the role.
CREATE OR REPLACE FUNCTION public.role_request_decide(p_request uuid, p_approve boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_actor uuid := public.app_staff_id();
  r public.role_requests;
  v_state text;
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL OR public.app_acting_role() IS DISTINCT FROM 'owner'
     OR NOT EXISTS (SELECT 1 FROM public.staff s
                      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                      JOIN public.staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.id AND sr.role = 'owner'
                     WHERE s.tenant_id = v_tenant AND s.id = v_actor
                       AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())) THEN
    RAISE EXCEPTION 'only an Owner decides role requests' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_tenant::text, 0));
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
  v_state := CASE WHEN NOT p_approve THEN 'rejected' WHEN r.role = 'owner' THEN 'awaiting_confirmation' ELSE 'approved' END;
  UPDATE public.role_requests SET state = v_state, decided_by = v_actor, decided_at = now()
   WHERE tenant_id = v_tenant AND id = p_request;
  IF v_state = 'approved' THEN
    INSERT INTO public.staff_roles (tenant_id, staff_id, role) VALUES (v_tenant, r.staff_id, r.role)
      ON CONFLICT (tenant_id, staff_id, role) DO NOTHING;
  END IF;
  PERFORM public.audit_append('approval', 'role_request', p_request, 'success',
                              CASE v_state WHEN 'approved' THEN 'role_grant_approved' WHEN 'rejected' THEN 'role_grant_rejected'
                                           ELSE 'owner_grant_awaits_confirmation' END);
  RETURN jsonb_build_object('state', v_state);
END
$$;--> statement-breakpoint

-- The assigned person answers an Owner grant from their own session (any acting role in
-- that tenant): confirm creates the role, decline closes the request. Nobody else answers.
-- A grant not answered in 14 days lapses (treated as declined when answered late).
CREATE FUNCTION public.role_owner_confirm(p_request uuid, p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  r public.role_requests;
  v_role_id uuid;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || a.tenant_id::text, 0));
  SELECT * INTO r FROM public.role_requests WHERE tenant_id = a.tenant_id AND id = p_request FOR UPDATE;
  IF NOT FOUND OR r.staff_id <> a.staff_id OR r.state <> 'awaiting_confirmation' OR p_accept IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no Owner grant waits for you' USING ERRCODE = 'P0002';
  END IF;
  -- Accepting needs a grant that is still fresh and an Owner who still is one (a removed or
  -- ended Owner's grant lapses); a lapse is recorded instead of the acceptance.
  IF p_accept AND (r.decided_at < now() - interval '14 days' OR NOT public.tenant_staff_has_role(a.tenant_id, r.decided_by, 'owner')) THEN
    UPDATE public.role_requests SET state = 'rejected' WHERE tenant_id = a.tenant_id AND id = p_request;
    PERFORM public.audit_append('approval', 'role_request', p_request, 'success', 'owner_grant_lapsed');
    RETURN jsonb_build_object('state', 'lapsed');
  END IF;
  IF p_accept THEN
    UPDATE public.role_requests SET state = 'approved', confirmed_at = now() WHERE tenant_id = a.tenant_id AND id = p_request;
    INSERT INTO public.staff_roles (tenant_id, staff_id, role) VALUES (a.tenant_id, a.staff_id, 'owner')
      ON CONFLICT (tenant_id, staff_id, role) DO NOTHING RETURNING id INTO v_role_id;
    -- The same role event as every other path that creates a role.
    IF v_role_id IS NOT NULL THEN
      PERFORM public.audit_append('settings_change', 'staff_role', v_role_id, 'success', 'role_assigned');
    END IF;
  ELSE
    UPDATE public.role_requests SET state = 'rejected' WHERE tenant_id = a.tenant_id AND id = p_request;
  END IF;
  PERFORM public.audit_append('approval', 'role_request', p_request, 'success',
                              CASE WHEN p_accept THEN 'owner_grant_confirmed' ELSE 'owner_grant_declined' END);
  RETURN jsonb_build_object('state', CASE WHEN p_accept THEN 'approved' ELSE 'rejected' END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.role_owner_confirm(uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.role_owner_confirm(uuid, boolean) TO clinic_app;
--> statement-breakpoint

-- The Owner grants waiting for the acting staff member (with who granted them; the staff
-- table is not readable to most roles, so the name comes from here).
CREATE FUNCTION public.role_owner_grants_mine() RETURNS TABLE (request_id uuid, granted_by text, granted_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  RETURN QUERY
  SELECT r.id, s.display_name, r.decided_at
    FROM public.role_requests r
    JOIN public.staff s ON s.tenant_id = r.tenant_id AND s.id = r.decided_by
   WHERE r.tenant_id = a.tenant_id AND r.staff_id = a.staff_id AND r.role = 'owner'
     AND r.state = 'awaiting_confirmation' AND r.decided_at > now() - interval '14 days'
   ORDER BY r.decided_at DESC;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.role_owner_grants_mine() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.role_owner_grants_mine() TO clinic_app;
--> statement-breakpoint

-- An Owner withdraws an Owner grant still waiting (any Owner of the tenant; audited).
CREATE FUNCTION public.role_owner_grant_withdraw(p_request uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only an Owner withdraws an Owner grant' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || a.tenant_id::text, 0));
  UPDATE public.role_requests SET state = 'rejected'
   WHERE tenant_id = a.tenant_id AND id = p_request AND state = 'awaiting_confirmation' AND role = 'owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no Owner grant is waiting' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('approval', 'role_request', p_request, 'success', 'owner_grant_withdrawn');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.role_owner_grant_withdraw(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.role_owner_grant_withdraw(uuid) TO clinic_app;--> statement-breakpoint

-- 1: an Owner is never created through an invitation link (the link may be accepted by
-- whoever holds it): invite the person with another role, then assign Owner, which they
-- confirm (D7). staff_invite as 0026 with that one refusal added.
CREATE OR REPLACE FUNCTION public.staff_invite_owner_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF 'owner' = ANY (NEW.roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an Owner is assigned after joining, not invited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER staff_invitations_no_owner BEFORE INSERT OR UPDATE OF roles ON public.staff_invitations
  FOR EACH ROW EXECUTE FUNCTION public.staff_invite_owner_guard();--> statement-breakpoint
ALTER TABLE public.staff_invitations ENABLE ALWAYS TRIGGER staff_invitations_no_owner;
--> statement-breakpoint

-- For the Persetujuan inbox: may the owner decide this clinical draft now (no facility head
-- other than its requester in the bound tenant)? Same rule as approval_decide.
CREATE FUNCTION public.approval_owner_decides_fh(p_approval uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT public.approval_fh_available(ap.tenant_id, ap.id, ap.requested_by)
    FROM public.approvals ap
   WHERE ap.tenant_id = public.app_tenant_id() AND ap.id = p_approval
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_owner_decides_fh(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_owner_decides_fh(uuid) TO clinic_app;
--> statement-breakpoint

-- Finding round 2 #2: open invitations that already name Owner (staging/demo) are cancelled.
UPDATE public.staff_invitations SET state = 'cancelled', closed_at = now()
 WHERE state = 'pending' AND 'owner' = ANY (roles);--> statement-breakpoint

-- D1 residual risk, mitigation: every accepted invitation sent by Admin Pusat (not an
-- Owner) notifies the tenant's owners (new staff, roles, who invited), so an Admin Pusat who
-- accepts their own link is visible at once. Raised as a system notification inside the
-- acceptance (staff_invite_accept binds the new staff's context only for its audit row).
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('staff_joined_by_admin_invite', 'Staf baru bergabung lewat undangan Admin Pusat', '{owner}', '{staff_invitation}', false);--> statement-breakpoint
CREATE FUNCTION public.staff_invitation_accepted_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.state = 'accepted' AND OLD.state = 'pending'
     AND NOT public.tenant_staff_has_role(NEW.tenant_id, NEW.invited_by, 'owner') THEN
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id)
    VALUES (NEW.tenant_id, 'staff_joined_by_admin_invite', 'owner', NULL, 'staff_invitation', NEW.id);
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER staff_invitations_accepted_notify AFTER UPDATE OF state ON public.staff_invitations
  FOR EACH ROW EXECUTE FUNCTION public.staff_invitation_accepted_notify();--> statement-breakpoint
ALTER TABLE public.staff_invitations ENABLE ALWAYS TRIGGER staff_invitations_accepted_notify;
