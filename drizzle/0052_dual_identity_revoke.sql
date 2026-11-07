ALTER TABLE "vendor_requests" ADD COLUMN "clinic_revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD COLUMN "clinic_revoked_account" uuid;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD COLUMN "clinic_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_clinic_revoked_account_auth_user_id_fk" FOREIGN KEY ("clinic_revoked_account") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_clinic_revoked_check" CHECK (("vendor_requests"."clinic_revoked_at" is null) = ("vendor_requests"."clinic_revoked_by" is null) and ("vendor_requests"."clinic_revoked_at" is null) = ("vendor_requests"."clinic_revoked_account" is null) and ("vendor_requests"."clinic_revoked_at" is null or "vendor_requests"."clinic_approved_at" is not null and "vendor_requests"."kind" = 'dual_identity'));;--> statement-breakpoint

-- HYG-013 functions (generated from live definitions; see header)
-- HYG-013 (DEC-030 (1), DEC-044; PR-57, IAM-10): the clinic Owner revokes an approved dual vendor/clinic
-- identity. The request is kept (both approvals and the revocation stay visible); the subject's clinic
-- membership in this tenant ends at the same moment; the vendor account is not touched. Re-created
-- bodies are their live definitions at 0051 with only the lines named in their comments changed.
-- vendor_dual_approved: not after the clinic Owner revoked it (HYG-013)
CREATE OR REPLACE FUNCTION public.vendor_dual_approved(p_account uuid, p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.vendor_requests r
                  WHERE r.kind = 'dual_identity' AND r.tenant_id = p_tenant AND r.state = 'approved'
                    AND r.clinic_approved_at IS NOT NULL AND r.payload ->> 'account_id' = p_account::text
                    AND r.clinic_revoked_at IS NULL)
$function$
;--> statement-breakpoint
-- vendor_history_guard: one more transition, the clinic revocation (HYG-013)
CREATE OR REPLACE FUNCTION public.vendor_history_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_same_decision boolean;
  v_same_clinic boolean;
  v_clinic_added boolean;
  v_revoke_same boolean;
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
  -- HYG-013: the revocation columns change only by the clinic revocation, once, of a dual identity
  -- carrying the clinic approval (effective, or still awaiting the platform), with nothing else changed;
  -- every other transition keeps them as they were (a revoked pending request may still be decided by
  -- the platform, but stays revoked, so it never becomes effective).
  v_revoke_same := (NEW.clinic_revoked_by, NEW.clinic_revoked_account, NEW.clinic_revoked_at)
                   IS NOT DISTINCT FROM (OLD.clinic_revoked_by, OLD.clinic_revoked_account, OLD.clinic_revoked_at);
  IF NOT v_revoke_same THEN
    IF OLD.kind = 'dual_identity' AND OLD.state IN ('pending','approved') AND NEW.state = OLD.state AND OLD.clinic_approved_at IS NOT NULL
       AND OLD.clinic_revoked_at IS NULL AND NEW.clinic_revoked_at IS NOT NULL AND v_same_decision AND v_same_clinic
       AND NEW.consumed_at IS NOT DISTINCT FROM OLD.consumed_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a decided vendor request is final' USING ERRCODE = '42501';
  END IF;
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
$function$
;--> statement-breakpoint
-- vendor_dual_identities: revoked_at added; effective is false once revoked (HYG-013)
DROP FUNCTION public.vendor_dual_identities();--> statement-breakpoint
CREATE FUNCTION public.vendor_dual_identities()
 RETURNS TABLE(request_id uuid, account_id uuid, vendor_name text, state text, requested_at timestamp with time zone, platform_decided_at timestamp with time zone, clinic_approved_at timestamp with time zone, effective boolean, revoked_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
         q.state = 'approved' AND q.clinic_approved_at IS NOT NULL AND q.clinic_revoked_at IS NULL, q.clinic_revoked_at
    FROM public.vendor_requests q
    LEFT JOIN public.vendor_staff vs ON vs.account_id = (q.payload ->> 'account_id')::uuid
   WHERE q.kind = 'dual_identity' AND q.tenant_id = a.tenant_id
   ORDER BY q.requested_at DESC;
END
$function$
;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_dual_identities() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_dual_identities() TO clinic_app;--> statement-breakpoint

-- Saya › Akses Vendor › Cabut (DEC-044): the acting Owner revokes an effective dual identity of this
-- tenant. Lock order: staff_access (tenant_actor_lock, actor judged on the wall clock), the request row,
-- then the subject's vendor_account lock (the lock memberships_vendor_guard takes before reading
-- vendor_dual_approved), so a membership being added for the subject either commits first and is ended
-- here, or waits and is refused. Every effective dual identity of that account in this tenant is stamped
-- (a second approved request would otherwise keep it approved). The subject's active membership here
-- ends as in staff_end_membership: effective_to on the wall clock, duties ended, its pending invitations
-- re-checked, its sessions listed as revoked; each audited. Refusals are returned and audited.
CREATE FUNCTION public.vendor_dual_identity_clinic_revoke(p_request uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  q public.vendor_requests;
  v_account uuid;
  v_subject uuid;
  v_refusal text;
  v_id uuid;
  m record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT mm.account_id INTO v_account FROM public.staff s JOIN public.memberships mm ON mm.tenant_id = s.tenant_id AND mm.id = s.membership_id
   WHERE s.tenant_id = a.tenant_id AND s.id = a.staff_id;
  SELECT * INTO q FROM public.vendor_requests WHERE id = p_request AND kind = 'dual_identity' AND tenant_id = a.tenant_id FOR UPDATE;
  v_subject := (q.payload ->> 'account_id')::uuid;
  v_refusal := CASE
    WHEN a.role <> 'owner' OR v_account IS NULL THEN 'not_owner'
    WHEN q.id IS NULL THEN 'not_found'
    -- Nobody revokes their own dual identity (ending one's own access is offboarding by another Owner).
    WHEN v_subject = v_account THEN 'self'
    WHEN q.state <> 'approved' OR q.clinic_approved_at IS NULL OR q.clinic_revoked_at IS NOT NULL THEN 'not_effective' END;
  IF v_refusal IS NOT NULL THEN
    PERFORM public.audit_append('approval', 'vendor_request', p_request, 'denied', 'dual_identity_' || v_refusal);
    RETURN 'refused:' || v_refusal;
  END IF;
  -- Review round 1 (P2): the subject's membership row is locked before the account lock, the order a
  -- membership write takes (row, then memberships_vendor_guard's account lock), so the two never
  -- deadlock; it is read again after the account lock, so a reopening committed while we waited is seen.
  PERFORM 1 FROM public.memberships mm WHERE mm.tenant_id = a.tenant_id AND mm.account_id = v_subject FOR UPDATE;
  PERFORM public.vendor_account_lock(v_subject);
  -- Review round 1 (P1): every request of this account here carrying a clinic approval is revoked: the
  -- effective one(s) and one still awaiting the platform, which would otherwise turn effective on the
  -- platform's approval without a clinic approval given after the revocation. A platform decision holds
  -- the request row lock, so it either commits first (and is revoked here) or waits and keeps the stamp.
  FOR v_id IN UPDATE public.vendor_requests
                 SET clinic_revoked_by = a.staff_id, clinic_revoked_account = v_account, clinic_revoked_at = clock_timestamp()
               WHERE kind = 'dual_identity' AND tenant_id = a.tenant_id AND payload ->> 'account_id' = v_subject::text
                 AND state IN ('pending','approved') AND clinic_approved_at IS NOT NULL AND clinic_revoked_at IS NULL
               RETURNING id LOOP
    PERFORM public.audit_append('approval', 'vendor_request', v_id, 'success', 'vendor_dual_identity_revoked');
  END LOOP;
  SELECT mm.id AS membership_id, s.id AS staff_id INTO m
    FROM public.memberships mm LEFT JOIN public.staff s ON s.tenant_id = mm.tenant_id AND s.membership_id = mm.id
   WHERE mm.tenant_id = a.tenant_id AND mm.account_id = v_subject
     AND (mm.effective_to IS NULL OR mm.effective_to > clock_timestamp())
   FOR UPDATE OF mm;
  IF m.membership_id IS NOT NULL THEN
    UPDATE public.memberships SET effective_to = greatest(clock_timestamp(), effective_from + interval '1 microsecond')
     WHERE tenant_id = a.tenant_id AND id = m.membership_id;
    IF m.staff_id IS NOT NULL THEN
      PERFORM public.staff_duties_end(a.tenant_id, m.staff_id, a.staff_id);
      PERFORM public.staff_invitations_recheck(a.tenant_id, m.staff_id);
    END IF;
    PERFORM public.audit_append('settings_change', 'membership_revocation',
      public.staff_revoke(a.tenant_id, m.membership_id, NULL, 'membership_ended', a.staff_id), 'success', 'membership_ended');
  END IF;
  RETURN 'revoked';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_dual_identity_clinic_revoke(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_dual_identity_clinic_revoke(uuid) TO clinic_app;
