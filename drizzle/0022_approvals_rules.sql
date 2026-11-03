-- T-011 (PR-37, DATA-41, BILL-23, B-14). approval_types is a platform registry; approvals
-- is tenant-shared. clinic_app reads approvals of its tenant (Persetujuan readers) and
-- writes only through the functions below, which take the actor from the bound context,
-- check the type's requester/approver roles, refuse requester = approver (TD-51
-- ERR_APPROVER_IS_REQUESTER, SQLSTATE 'P0422' with that code in the message) except the
-- whitelisted owner self-action with a reason, audit every step and emit an event.
ALTER TABLE public.approval_types ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- PR-37 types and their roles (07 matrix). Later tasks add their own types the same way.
INSERT INTO public.approval_types (key, label, requester_roles, approver_roles, owner_self) VALUES
  -- SET-11: owner approves cash refunds; a manager only where the tenant enables it
  -- (settings registry, T-017 adds manager through that setting).
  ('refund_exception', 'Refund tunai', '{fo_cashier,manager,finance}', '{owner}', false),
  ('write_off', 'Hapus piutang', '{fo_cashier,finance}', '{owner}', true),
  ('attribution_correction', 'Koreksi atribusi staf', '{fo_cashier,manager,finance}', '{owner,manager}', false),
  ('commission_batch', 'Batch komisi', '{finance,manager}', '{owner}', false),
  ('stock_adjustment', 'Penyesuaian stok', '{pharmacist,manager,purchasing}', '{owner,manager}', false),
  ('disposal', 'Pemusnahan', '{pharmacist,manager}', '{owner,manager}', false);--> statement-breakpoint

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Persetujuan readers (19 §2.14: owner, manager, facility head, records officer) see the
-- tenant's approvals (branch roles: their branches); a requester always sees their own.
CREATE POLICY approvals_read ON public.approvals FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_acting_role() = 'owner'
              OR public.app_acting_role() IN ('manager','facility_head','records_officer')
                 AND public.app_branch_allowed(branch_id)
              OR requested_by = public.app_staff_id()));--> statement-breakpoint
GRANT SELECT ON public.approvals TO clinic_app;--> statement-breakpoint

-- The actor of the bound context, verified like audit_append: an active membership that
-- holds the acting role, with the active branch in that role's scope (or none for Level 2).
CREATE FUNCTION public.approval_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  tenant_id := public.app_tenant_id();
  staff_id := public.app_staff_id();
  role := public.app_acting_role();
  branch_id := NULLIF(current_setting('app.active_branch_id', true), '')::uuid;
  IF tenant_id IS NULL OR staff_id IS NULL OR role IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.staff s
         JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
         JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = approval_actor.role
        WHERE s.tenant_id = approval_actor.tenant_id AND s.id = approval_actor.staff_id
          AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())
          AND (approval_actor.branch_id IS NULL
               OR r.role IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor')
               OR EXISTS (SELECT 1 FROM public.staff_branches b
                           WHERE b.tenant_id = s.tenant_id AND b.staff_role_id = r.id AND b.branch_id = approval_actor.branch_id))) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: bound context is not an active membership with that role and branch' USING ERRCODE = '42501';
  END IF;
  -- Level 3 roles act at one branch (same rule as audit_append).
  IF branch_id IS NULL AND role IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a Level 3 acting role must bind an active branch' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_actor() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.approval_request(p_type text, p_subject_kind text, p_subject_id uuid, p_reason text,
                                        p_branch uuid DEFAULT NULL, p_amount_rupiah bigint DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  t public.approval_types;
  v_id uuid;
  v_branch uuid;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO t FROM public.approval_types WHERE key = p_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: unknown approval type' USING ERRCODE = 'P0002';
  END IF;
  IF NOT a.role = ANY (t.requester_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not request this approval' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_reason, '')) > 500 OR p_amount_rupiah < 0 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: reason over 500 characters or negative amount' USING ERRCODE = '22023';
  END IF;
  -- The request belongs to the subject's branch: a branch role's active branch, or the
  -- branch a tenant-wide requester names (it must exist in this tenant).
  v_branch := coalesce(a.branch_id, p_branch);
  IF a.branch_id IS NOT NULL AND p_branch IS NOT NULL AND p_branch <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: request for another branch' USING ERRCODE = '42501';
  END IF;
  IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    INSERT INTO public.approvals (tenant_id, branch_id, type, subject_kind, subject_id, requested_by, requested_as, request_reason, amount_rupiah)
    VALUES (a.tenant_id, v_branch, p_type, p_subject_kind, p_subject_id, a.staff_id, a.role, NULLIF(btrim(p_reason), ''), p_amount_rupiah)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an approval for this subject is already pending or granted' USING ERRCODE = '23505';
  END;
  PERFORM public.audit_append('approval', 'approval', v_id, 'success', 'approval_requested');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v_branch, 'ApprovalRequested', 'approval', v_id,
          jsonb_build_object('approval_type', p_type, 'subject_kind', p_subject_kind, 'subject_id', p_subject_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_request(text, text, uuid, text, uuid, bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_request(text, text, uuid, text, uuid, bigint) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.approval_decide(p_approval uuid, p_approve boolean, p_reason text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  ap public.approvals;
  t public.approval_types;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO ap FROM public.approvals WHERE tenant_id = a.tenant_id AND id = p_approval FOR UPDATE;
  -- What the caller cannot read (approvals_read) does not exist for it: no state, no
  -- existence leak (TD-51).
  IF NOT FOUND OR NOT (a.role = 'owner'
                       OR a.role IN ('manager','facility_head','records_officer') AND public.app_branch_allowed(ap.branch_id)
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
REVOKE ALL ON FUNCTION public.approval_decide(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_decide(uuid, boolean, text) TO clinic_app;--> statement-breakpoint

-- B-14 / BILL-23: the owner acts alone on a whitelisted type with a mandatory reason; the
-- row records the owner as requester and approver.
CREATE FUNCTION public.approval_owner_self(p_type text, p_subject_kind text, p_subject_id uuid, p_reason text,
                                           p_branch uuid DEFAULT NULL, p_amount_rupiah bigint DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  t public.approval_types;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner acts alone' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.approval_types WHERE key = p_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: unknown approval type' USING ERRCODE = 'P0002';
  END IF;
  IF NOT t.owner_self THEN
    RAISE EXCEPTION 'ERR_APPROVER_IS_REQUESTER: this approval needs another person' USING ERRCODE = 'P0422';
  END IF;
  IF length(coalesce(p_reason, '')) > 500 OR p_amount_rupiah < 0 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: reason over 500 characters or negative amount' USING ERRCODE = '22023';
  END IF;
  IF a.branch_id IS NOT NULL AND p_branch IS NOT NULL AND p_branch <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: self-approval for another branch' USING ERRCODE = '42501';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an owner self-action needs a reason of at least 10 characters' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.approvals (tenant_id, branch_id, type, subject_kind, subject_id, requested_by, requested_as,
                                  request_reason, state, decided_by, decided_as, decided_at, decision_reason, owner_self, amount_rupiah)
    VALUES (a.tenant_id, coalesce(a.branch_id, p_branch), p_type, p_subject_kind, p_subject_id, a.staff_id, 'owner',
            btrim(p_reason), 'approved', a.staff_id, 'owner', now(), btrim(p_reason), true, p_amount_rupiah)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an approval for this subject is already pending or granted' USING ERRCODE = '23505';
  END;
  -- The reason stays on the approval row (audit_events carries free text only for
  -- break-glass, T-008).
  PERFORM public.audit_append('approval', 'approval', v_id, 'success', 'approval_owner_self');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (coalesce(a.branch_id, p_branch), 'ApprovalDecided', 'approval', v_id,
          jsonb_build_object('approval_type', p_type, 'outcome', 'approved', 'owner_self', true,
                             'subject_kind', p_subject_kind, 'subject_id', p_subject_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_owner_self(text, text, uuid, text, uuid, bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_owner_self(text, text, uuid, text, uuid, bigint) TO clinic_app;--> statement-breakpoint

-- The requester may withdraw a pending request.
CREATE FUNCTION public.approval_cancel(p_approval uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  UPDATE public.approvals SET state = 'cancelled', decided_by = a.staff_id, decided_as = a.role, decided_at = now()
   WHERE tenant_id = a.tenant_id AND id = p_approval AND requested_by = a.staff_id AND state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no pending request of yours' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('approval', 'approval', p_approval, 'success', 'approval_cancelled');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  SELECT ap.branch_id, 'ApprovalDecided', 'approval', ap.id,
         jsonb_build_object('approval_type', ap.type, 'outcome', 'cancelled', 'subject_kind', ap.subject_kind, 'subject_id', ap.subject_id)
    FROM public.approvals ap WHERE ap.tenant_id = a.tenant_id AND ap.id = p_approval;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- Approvals are financial history: identity columns never change, a decided row is final,
-- nothing is deleted, and an owner self-action exists only for a whitelisted type.
CREATE FUNCTION public.approvals_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approvals are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.owner_self AND NOT EXISTS (SELECT 1 FROM public.approval_types t WHERE t.key = NEW.type AND t.owner_self) THEN
    RAISE EXCEPTION 'owner self-action is not allowed for this approval type' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.state <> 'pending'
      OR (NEW.tenant_id, NEW.type, NEW.subject_kind, NEW.subject_id, NEW.requested_by, NEW.requested_as, NEW.requested_at, NEW.branch_id, NEW.owner_self, NEW.amount_rupiah, NEW.request_reason)
         IS DISTINCT FROM
         (OLD.tenant_id, OLD.type, OLD.subject_kind, OLD.subject_id, OLD.requested_by, OLD.requested_as, OLD.requested_at, OLD.branch_id, OLD.owner_self, OLD.amount_rupiah, OLD.request_reason)) THEN
    RAISE EXCEPTION 'a decided approval is final and its request is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER approvals_guard BEFORE INSERT OR UPDATE OR DELETE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.approvals_guard();--> statement-breakpoint
CREATE TRIGGER approvals_no_truncate BEFORE TRUNCATE ON public.approvals
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.approval_types', 'platform', 'approvals', '{}', 'migrations of approval-owning tasks', 'none'),
  ('public.approvals', 'tenant-shared', 'approvals', '{owner,manager,facility_head,records_officer,self}', 'approval functions (src/modules/approvals)', 'branch of the request');
