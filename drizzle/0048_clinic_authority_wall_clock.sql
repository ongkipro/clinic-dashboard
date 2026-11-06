-- HYG-008a (DEC-043, IAM-16; foundation review lane A A-02/N-2, plan review R1-H2, R1-M3, R1-L1,
-- B-02, B-03 clinic side, B-04, 9c-9e): an actor's validity is judged on the wall clock AFTER the
-- tenant's serializing lock. now() is the transaction start: a transaction that started before a
-- membership ended, or waited on staff_access while the end committed, still saw it as active.
-- Expand only: functions, grants, one trigger, one policy, no schema or data change. Every
-- re-created body is the latest definition at 0047 (pg_get_functiondef) with only the lines named
-- in its comment changed; tests/db/authority-drift.test.ts checks the applied diff.
--
-- Lock order (each re-created writer; every sequence starts with staff_access):
--   tenant_actor_lock: staff_access -> (actor check)
--   approval_request/decide/owner_self/cancel, setting_set, evidence_upload, evidence_decide,
--   role_owner_confirm, role_owner_grant_withdraw, vendor_dual_identity_clinic_decide:
--     staff_access (tenant_actor_lock) -> their existing row locks -> per-setting lock -> audit
--   role_assign, role_request_decide: staff_access -> role_requests row -> audit
--   setting_draft_decide/cancel: staff_access -> approval row -> draft -> setting lock -> audit
--     (was approval row -> staff_access through approval_decide: fixed here)
--   staff_invite_accept: staff_access -> invitation row (as staff_end_membership -> recheck)
--   tenant_owner_invite_accept: invitation row -> staff_access (kept; recorded exception: nothing
--     takes staff_access and then an owner-invitation row)
--   audit_append: audit lock only (never staff_access), actor re-checked after it.
-- Callers of the re-created writers (grep drizzle/ and src/, 2026-11-06): setting_set ->
-- approval_request (re-enters staff_access); setting_draft_decide/cancel (fixed);
-- src/modules/approvals/approvals.ts, settings/settings.ts, compliance/compliance.ts,
-- org/roles/roles.ts: no prior row lock. Rule for later code: no caller holds a row lock before
-- calling a writer that takes staff_access.
-- HYG-008a (DEC-043): writers judge their actor AFTER the tenant's staff_access lock, on the
-- wall clock. VOLATILE so the check reads a snapshot taken after the lock wait (a STABLE function
-- would reuse the calling statement's snapshot, taken before it). Callable only by definers.
CREATE FUNCTION public.tenant_actor_lock(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
 RETURNS record
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  tenant_id := public.app_tenant_id();
  staff_id := public.app_staff_id();
  role := public.app_acting_role();
  branch_id := NULLIF(current_setting('app.active_branch_id', true), '')::uuid;
  IF tenant_id IS NULL OR staff_id IS NULL OR role IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: tenant_actor_lock: bound context is not an active membership with that role and branch' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || tenant_id::text, 0));
  IF NOT EXISTS (
       SELECT 1 FROM public.staff s
         JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
         JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = tenant_actor_lock.role
        WHERE s.tenant_id = tenant_actor_lock.tenant_id AND s.id = tenant_actor_lock.staff_id
          AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
          AND (tenant_actor_lock.branch_id IS NULL
               OR r.role IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor')
               OR EXISTS (SELECT 1 FROM public.staff_branches b
                           WHERE b.tenant_id = s.tenant_id AND b.staff_role_id = r.id AND b.branch_id = tenant_actor_lock.branch_id))) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: tenant_actor_lock: bound context is not an active membership with that role and branch' USING ERRCODE = '42501';
  END IF;
  IF branch_id IS NULL AND role IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a Level 3 acting role must bind an active branch' USING ERRCODE = '42501';
  END IF;
END
$function$
;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_actor_lock() FROM PUBLIC;--> statement-breakpoint
-- approval_actor: wall clock; no lock (readers call it)
CREATE OR REPLACE FUNCTION public.approval_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
          AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
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
$function$
;--> statement-breakpoint
-- approval_request: actor judged after staff_access (tenant_actor_lock)
CREATE OR REPLACE FUNCTION public.approval_request(p_type text, p_subject_kind text, p_subject_id uuid, p_reason text, p_branch uuid DEFAULT NULL::uuid, p_amount_rupiah bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  t public.approval_types;
  v_id uuid;
  v_branch uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
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
$function$
;--> statement-breakpoint
-- approval_decide: actor judged after staff_access (tenant_actor_lock)
CREATE OR REPLACE FUNCTION public.approval_decide(p_approval uuid, p_approve boolean, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  ap public.approvals;
  t public.approval_types;
  v_tenant_draft boolean;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
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
$function$
;--> statement-breakpoint
-- approval_owner_self: actor judged after staff_access (tenant_actor_lock)
CREATE OR REPLACE FUNCTION public.approval_owner_self(p_type text, p_subject_kind text, p_subject_id uuid, p_reason text, p_branch uuid DEFAULT NULL::uuid, p_amount_rupiah bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  t public.approval_types;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
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
$function$
;--> statement-breakpoint
-- approval_cancel: actor judged after staff_access (tenant_actor_lock)
CREATE OR REPLACE FUNCTION public.approval_cancel(p_approval uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
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
$function$
;--> statement-breakpoint
-- setting_set: actor judged after staff_access (tenant_actor_lock)
CREATE OR REPLACE FUNCTION public.setting_set(p_key text, p_branch uuid, p_value jsonb, p_effective timestamp with time zone, p_reason text, p_restore boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  d public.setting_defs;
  v_approver text;
  v_value jsonb;
  v_version uuid;
  v_approval uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT * INTO d FROM public.setting_defs WHERE key = p_key;
  IF NOT FOUND THEN
    -- PR-38: a setting outside the decided list does not exist.
    RAISE EXCEPTION 'ERR_SETTING_NOT_ALLOWED: no such setting' USING ERRCODE = 'P0422';
  END IF;
  -- Branch roles act at their active branch only; tenant-wide roles at any branch. A
  -- tenant setting that names a branch role (SET-28/29/31/47 facility head, SET-48
  -- pharmacist) is changed by it tenant-wide; a branch setting's tenant value
  -- (branch null) is for tenant-wide roles only.
  IF p_branch IS NOT NULL AND a.branch_id IS NOT NULL AND p_branch <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: outside the acting role''s branch' USING ERRCODE = '42501';
  END IF;
  IF p_branch IS NULL AND a.branch_id IS NOT NULL AND d.scope = 'branch' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a branch role changes its branch value' USING ERRCODE = '42501';
  END IF;
  v_value := CASE WHEN coalesce(p_restore, false) THEN d.default_value ELSE p_value END;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  -- Changes of one setting in one tenant are serialized (versions ordered by effect).
  PERFORM pg_advisory_xact_lock(hashtextextended('setting:' || a.tenant_id::text || ':' || d.key, 0));
  IF a.role = ANY (d.changers) THEN
    v_version := public.setting_write(a.tenant_id, a.staff_id, a.role, d.key, p_branch, v_value, p_effective, p_reason, 'active', coalesce(p_restore, false));
    RETURN jsonb_build_object('state', 'active', 'version_id', v_version);
  END IF;
  SELECT x ->> 'approver' INTO v_approver FROM jsonb_array_elements(d.drafts) x WHERE x ->> 'by' = a.role;
  IF v_approver IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this role does not change this setting' USING ERRCODE = '42501';
  END IF;
  -- One waiting draft per setting and branch.
  IF EXISTS (SELECT 1 FROM public.setting_versions v WHERE v.tenant_id = a.tenant_id AND v.key = d.key
               AND v.branch_id IS NOT DISTINCT FROM p_branch AND v.state = 'draft') THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a draft for this setting is already waiting' USING ERRCODE = '23505';
  END IF;
  -- The approval names the draft version (its id is chosen first) and the draft names the
  -- approval: both are written in this transaction.
  v_version := public.uuid_generate_v7();
  v_approval := public.approval_request(CASE v_approver WHEN 'owner' THEN 'setting_change_owner' WHEN 'facility_head' THEN 'setting_change_fh' END,
                                        'setting_version', v_version, btrim(p_reason), p_branch, NULL);
  PERFORM public.setting_write(a.tenant_id, a.staff_id, a.role, d.key, p_branch, v_value, p_effective, p_reason, 'draft',
                               coalesce(p_restore, false), v_version, v_approval);
  RETURN jsonb_build_object('state', 'draft', 'version_id', v_version, 'approval_id', v_approval);
END
$function$
;--> statement-breakpoint
-- evidence_upload: actor judged after staff_access (tenant_actor_lock)
CREATE OR REPLACE FUNCTION public.evidence_upload(p_obligation text, p_file_name text, p_media_type text, p_content bytea, p_sha256 text, p_expert text, p_document_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  o public.compliance_obligations;
  v_item uuid;
  v_version integer;
  v_file uuid;
  v_name text;
  v_type text;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT * INTO o FROM public.compliance_obligations WHERE key = p_obligation;
  IF NOT FOUND OR o.scope <> 'tenant' THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: unknown tenant obligation' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(public.compliance_may_act(a.role, o.area), false) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this role does not handle this evidence' USING ERRCODE = '42501';
  END IF;
  -- The checksum is recomputed here: the stored checksum is the database's, never the caller's.
  IF p_content IS NULL OR octet_length(p_content) NOT BETWEEN 1 AND 5242880
     OR p_sha256 IS DISTINCT FROM encode(sha256(p_content), 'hex') THEN
    RAISE EXCEPTION 'ERR_INVALID_FILE: file missing, too large or checksum mismatch' USING ERRCODE = '22023';
  END IF;
  -- The type comes from the bytes (PDF, PNG, JPEG signatures), never from the caller.
  v_type := CASE
    WHEN substring(p_content FROM 1 FOR 5) = '\x255044462d'::bytea THEN 'application/pdf'
    WHEN substring(p_content FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea THEN 'image/png'
    WHEN substring(p_content FROM 1 FOR 3) = '\xffd8ff'::bytea THEN 'image/jpeg' END;
  IF v_type IS NULL OR p_media_type IS DISTINCT FROM v_type THEN
    RAISE EXCEPTION 'ERR_INVALID_FILE: only PDF, PNG or JPEG by content' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_file_name, ''))) NOT BETWEEN 1 AND 200 OR p_file_name ~ '[/\\]'
     OR length(btrim(coalesce(p_expert, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: file name or author missing' USING ERRCODE = '22023';
  END IF;
  IF p_document_date IS NULL OR p_document_date > (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: the document date is in the future' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.evidence_items (tenant_id, obligation_key) VALUES (a.tenant_id, o.key)
  ON CONFLICT ON CONSTRAINT evidence_items_one_per_obligation DO NOTHING;
  SELECT id INTO STRICT v_item FROM public.evidence_items WHERE tenant_id = a.tenant_id AND obligation_key = o.key FOR UPDATE;
  -- The same bytes as the newest version (a double submit or a retry) add no version.
  SELECT id INTO v_file FROM public.evidence_files WHERE item_id = v_item ORDER BY version DESC LIMIT 1;
  IF v_file IS NOT NULL AND (SELECT sha256 FROM public.evidence_files WHERE id = v_file) = encode(sha256(p_content), 'hex') THEN
    RETURN v_file;
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.evidence_files WHERE item_id = v_item;
  SELECT display_name INTO STRICT v_name FROM public.staff WHERE tenant_id = a.tenant_id AND id = a.staff_id;
  INSERT INTO public.evidence_files (item_id, tenant_id, version, file_name, media_type, size_bytes, sha256, content,
                                     expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
  VALUES (v_item, a.tenant_id, v_version, btrim(p_file_name), p_media_type, octet_length(p_content), encode(sha256(p_content), 'hex'),
          p_content, btrim(p_expert), p_document_date, a.staff_id, a.role, v_name)
  RETURNING id INTO v_file;
  -- A new version waits for a decision; an approved item's gate re-opens (closes) until then.
  UPDATE public.evidence_items SET state = 'submitted', updated_at = now() WHERE id = v_item AND state <> 'submitted';
  -- The audit object is the file row (its version and checksum are on it, immutable).
  PERFORM public.audit_append('settings_change', 'evidence_file', v_file, 'success', 'evidence_uploaded');
  RETURN v_file;
END
$function$
;--> statement-breakpoint
-- evidence_decide: actor judged after staff_access (tenant_actor_lock); decided_at = clock_timestamp() (9c)
CREATE OR REPLACE FUNCTION public.evidence_decide(p_item uuid, p_file uuid, p_decision text, p_reason text, p_valid_until date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
  SELECT * INTO a FROM public.tenant_actor_lock();
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
  INSERT INTO public.evidence_approvals (item_id, tenant_id, file_id, config_version, decision, reason, valid_until, decided_by, decided_as, decided_name, decided_at)
  VALUES (i.id, i.tenant_id, f.id, v_config, p_decision, NULLIF(btrim(p_reason), ''), CASE WHEN p_decision = 'approved' THEN v_valid END,
          a.staff_id, a.role, v_name, clock_timestamp());
  UPDATE public.evidence_items
     SET state = p_decision, valid_until = CASE WHEN p_decision = 'approved' THEN v_valid ELSE valid_until END,
         config_version = CASE WHEN p_decision = 'approved' THEN v_config ELSE config_version END, updated_at = now()
   WHERE id = i.id;
  PERFORM public.audit_append('approval', 'evidence_item', i.id, 'success',
          CASE WHEN v_self THEN 'self_' ELSE '' END ||
          CASE p_decision WHEN 'approved' THEN 'evidence_approved' WHEN 'rejected' THEN 'evidence_rejected' ELSE 'evidence_revoked' END);
  RETURN p_decision;
END
$function$
;--> statement-breakpoint
-- role_owner_confirm: actor judged after staff_access (tenant_actor_lock); 14-day lapse on the wall clock
CREATE OR REPLACE FUNCTION public.role_owner_confirm(p_request uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  r public.role_requests;
  v_role_id uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || a.tenant_id::text, 0));
  SELECT * INTO r FROM public.role_requests WHERE tenant_id = a.tenant_id AND id = p_request FOR UPDATE;
  IF NOT FOUND OR r.staff_id <> a.staff_id OR r.state <> 'awaiting_confirmation' OR p_accept IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no Owner grant waits for you' USING ERRCODE = 'P0002';
  END IF;
  -- Accepting needs a grant that is still fresh and an Owner who still is one (a removed or
  -- ended Owner's grant lapses); a lapse is recorded instead of the acceptance.
  IF p_accept AND (r.decided_at < clock_timestamp() - interval '14 days' OR NOT public.tenant_staff_has_role(a.tenant_id, r.decided_by, 'owner')) THEN
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
$function$
;--> statement-breakpoint
-- role_owner_grant_withdraw: actor judged after staff_access (tenant_actor_lock)
CREATE OR REPLACE FUNCTION public.role_owner_grant_withdraw(p_request uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
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
$function$
;--> statement-breakpoint
-- vendor_dual_identity_clinic_decide: actor judged after staff_access (tenant_actor_lock)
CREATE OR REPLACE FUNCTION public.vendor_dual_identity_clinic_decide(p_request uuid, p_approve boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  q public.vendor_requests;
  v_account uuid;
  v_refusal text;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
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
$function$
;--> statement-breakpoint
-- role_assign: staff_access first; actor and target on the wall clock
CREATE OR REPLACE FUNCTION public.role_assign(p_staff uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_actor uuid := public.app_staff_id();
  v_as text := public.app_acting_role();
  v_request uuid;
  v_role_id uuid;
BEGIN
  -- HYG-008a: staff_access first, then the actor on the wall clock (tenant_actor_lock).
  PERFORM public.tenant_actor_lock();
  IF v_as NOT IN ('owner','admin_pusat') THEN
    RAISE EXCEPTION 'only Owner or Admin Pusat assign roles' USING ERRCODE = '42501';
  END IF;
  IF p_staff = v_actor THEN
    RAISE EXCEPTION 'nobody changes their own role set' USING ERRCODE = '42501';
  END IF;
  -- An Owner grant nobody answered in 14 days lapses here (it no longer blocks a new one).
  PERFORM public.role_owner_grants_lapse(v_tenant, p_staff);
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                  WHERE s.tenant_id = v_tenant AND s.id = p_staff
                    AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())) THEN
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
$function$
;--> statement-breakpoint
-- role_request_decide: staff_access first; actor and subject on the wall clock
CREATE OR REPLACE FUNCTION public.role_request_decide(p_request uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_actor uuid := public.app_staff_id();
  r public.role_requests;
  v_state text;
BEGIN
  -- HYG-008a: staff_access first, then the actor on the wall clock (tenant_actor_lock).
  PERFORM public.tenant_actor_lock();
  IF public.app_acting_role() IS DISTINCT FROM 'owner' THEN
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
          AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())) THEN
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
$function$
;--> statement-breakpoint
-- setting_draft_decide: staff_access before the approval row
CREATE OR REPLACE FUNCTION public.setting_draft_decide(p_approval uuid, p_approve boolean, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_key text;
BEGIN
  -- HYG-008a lock order: staff_access, then the approval row (approval_decide/cancel take it
  -- through tenant_actor_lock; taking the row first would invert the order and deadlock).
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_tenant::text, 0));
  PERFORM 1 FROM public.approvals WHERE tenant_id = v_tenant AND id = p_approval FOR UPDATE;
  SELECT key INTO v_key FROM public.setting_versions WHERE tenant_id = v_tenant AND approval_id = p_approval AND state = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: draft not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.approval_decide(p_approval, p_approve, p_reason);
END
$function$
;--> statement-breakpoint
-- setting_draft_cancel: staff_access before the approval row
CREATE OR REPLACE FUNCTION public.setting_draft_cancel(p_approval uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_key text;
BEGIN
  -- HYG-008a lock order: staff_access, then the approval row (approval_decide/cancel take it
  -- through tenant_actor_lock; taking the row first would invert the order and deadlock).
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_tenant::text, 0));
  PERFORM 1 FROM public.approvals WHERE tenant_id = v_tenant AND id = p_approval FOR UPDATE;
  SELECT key INTO v_key FROM public.setting_versions WHERE tenant_id = v_tenant AND approval_id = p_approval AND state = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: draft not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.approval_cancel(p_approval);
END
$function$
;--> statement-breakpoint
-- audit_append: wall clock; actor re-checked after the audit lock
CREATE OR REPLACE FUNCTION public.audit_append(p_action text, p_object_kind text, p_object_id uuid, p_outcome text, p_reason_code text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_correlation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_staff uuid := NULLIF(current_setting('app.staff_id', true), '')::uuid;
  v_role text := public.app_acting_role();
  v_branch uuid := NULLIF(current_setting('app.active_branch_id', true), '')::uuid;
  v_account uuid;
  v_membership uuid;
  v_prev text;
  v_seq bigint;
  v_row public.audit_events;
BEGIN
  IF v_tenant IS NULL OR v_staff IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'audit_append needs a bound tenant context with one acting role'
      USING ERRCODE = '42501';
  END IF;
  -- Level 3 roles act at one branch: the row must say which, so branch-scoped reviewers
  -- (facility head, records officer) see it (IAM-6, IAM-8).
  IF v_branch IS NULL
     AND v_role NOT IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor') THEN
    RAISE EXCEPTION 'a Level 3 acting role must bind an active branch before acting'
      USING ERRCODE = '42501';
  END IF;
  -- The bound staff must hold the acting role in an active membership of this tenant
  -- (same rule as org_actions), and the branch must be in that role's scope.
  SELECT m.account_id, m.id INTO v_account, v_membership
    FROM public.staff s
    JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
    JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = v_role
   WHERE s.tenant_id = v_tenant AND s.id = v_staff
     AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
     AND (v_branch IS NULL
          OR r.role IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor')
             AND EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = v_tenant AND b.id = v_branch)
          OR EXISTS (SELECT 1 FROM public.staff_branches b
                      WHERE b.tenant_id = v_tenant AND b.staff_role_id = r.id AND b.branch_id = v_branch));
  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'bound context is not an active membership with that role and branch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || v_tenant::text, 0));
  -- HYG-008a (R1-H2): the same rule again after the audit lock, on the wall clock: a caller whose
  -- membership, acting role or branch scope ended while it waited (the changing transaction holds
  -- this lock) is refused.
  IF NOT EXISTS (SELECT 1
    FROM public.staff s
    JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
    JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = v_role
   WHERE s.tenant_id = v_tenant AND s.id = v_staff
     AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
     AND (v_branch IS NULL
          OR r.role IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor')
             AND EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = v_tenant AND b.id = v_branch)
          OR EXISTS (SELECT 1 FROM public.staff_branches b
                      WHERE b.tenant_id = v_tenant AND b.staff_role_id = r.id AND b.branch_id = v_branch))) THEN
    RAISE EXCEPTION 'bound context ended while waiting for the audit lock'
      USING ERRCODE = '42501';
  END IF;
  SELECT e.hash, e.seq INTO v_prev, v_seq
    FROM public.audit_events e WHERE e.tenant_id = v_tenant ORDER BY e.seq DESC LIMIT 1;

  v_row := ROW(
    public.uuid_generate_v7(), v_tenant, coalesce(v_seq, 0) + 1, clock_timestamp(),
    v_account, v_membership, v_staff, v_role, v_branch, NULL, NULL, NULL, p_correlation_id,
    p_action, p_object_kind, p_object_id, p_outcome, p_reason_code, p_reason,
    coalesce(v_prev, repeat('0', 64)), repeat('0', 64))::public.audit_events;
  v_row.hash := encode(public.digest(v_row.prev_hash || public.audit_canonical(v_row), 'sha256'), 'hex');

  INSERT INTO public.audit_events SELECT v_row.*;
  RETURN v_row.id;
END
$function$
;--> statement-breakpoint
-- notification_ack: wall clock
CREATE OR REPLACE FUNCTION public.notification_ack(p_notification uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_staff uuid := public.app_staff_id();
  v_role text := public.app_acting_role();
  n public.notifications;
BEGIN
  IF v_tenant IS NULL OR v_staff IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: acknowledging needs a staff context' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO n FROM public.notifications WHERE tenant_id = v_tenant AND id = p_notification FOR UPDATE;
  IF NOT FOUND OR public.notification_visible(n.recipient_role, n.recipient_staff_id, n.branch_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: notification not found' USING ERRCODE = 'P0002';
  END IF;
  -- The staff member must really hold the acting role in an active membership.
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = v_role
                  WHERE s.tenant_id = v_tenant AND s.id = v_staff
                    AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: bound context is not an active membership with that role' USING ERRCODE = '42501';
  END IF;
  IF n.acknowledged_at IS NOT NULL THEN
    RETURN n.acknowledged_at;
  END IF;
  UPDATE public.notifications
     SET acknowledged_by = v_staff, acknowledged_as = v_role, acknowledged_at = now(),
         acknowledged_name = (SELECT display_name FROM public.staff WHERE tenant_id = v_tenant AND id = v_staff)
   WHERE tenant_id = v_tenant AND id = p_notification
   RETURNING acknowledged_at INTO n.acknowledged_at;
  RETURN n.acknowledged_at;
END
$function$
;--> statement-breakpoint
-- tenant_has_role: wall clock
CREATE OR REPLACE FUNCTION public.tenant_has_role(p_tenant uuid, p_role text, p_except uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = p_role
                  WHERE s.tenant_id = p_tenant AND s.id IS DISTINCT FROM p_except
                    AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp()))
$function$
;--> statement-breakpoint
-- role_owner_grants_lapse: 14-day lapse on the wall clock
CREATE OR REPLACE FUNCTION public.role_owner_grants_lapse(p_tenant uuid, p_staff uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v uuid;
BEGIN
  FOR v IN SELECT r.id FROM public.role_requests r
            WHERE r.tenant_id = p_tenant AND r.staff_id = p_staff AND r.state = 'awaiting_confirmation'
              AND (r.decided_at < clock_timestamp() - interval '14 days' OR NOT public.tenant_staff_has_role(p_tenant, r.decided_by, 'owner'))
            FOR UPDATE LOOP
    UPDATE public.role_requests SET state = 'rejected' WHERE tenant_id = p_tenant AND id = v;
    PERFORM public.audit_append('approval', 'role_request', v, 'success', 'owner_grant_lapsed');
  END LOOP;
END
$function$
;--> statement-breakpoint
-- role_owner_grants_mine: 14-day filter on the wall clock
CREATE OR REPLACE FUNCTION public.role_owner_grants_mine()
 RETURNS TABLE(request_id uuid, granted_by text, granted_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  RETURN QUERY
  SELECT r.id, s.display_name, r.decided_at
    FROM public.role_requests r
    JOIN public.staff s ON s.tenant_id = r.tenant_id AND s.id = r.decided_by
   WHERE r.tenant_id = a.tenant_id AND r.staff_id = a.staff_id AND r.role = 'owner'
     AND r.state = 'awaiting_confirmation' AND r.decided_at > clock_timestamp() - interval '14 days'
   ORDER BY r.decided_at DESC;
END
$function$
;--> statement-breakpoint
-- memberships_vendor_guard: the end transition is allowed
CREATE OR REPLACE FUNCTION public.memberships_vendor_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  -- Ending a membership is always allowed (offboarding).
  -- HYG-008a (B-02): an end (written at clock_timestamp(), later than now()) is always allowed;
  -- only the end transition, nothing else changed.
  IF TG_OP = 'UPDATE' AND NEW.effective_to IS NOT NULL AND NEW.effective_to <= clock_timestamp()
     AND NEW.account_id = OLD.account_id AND NEW.tenant_id = OLD.tenant_id AND NEW.effective_from = OLD.effective_from THEN
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
$function$
;--> statement-breakpoint
-- staff_invite_accept: staff_access before the invitation row; wall clock
CREATE OR REPLACE FUNCTION public.staff_invite_accept(p_token_hash text, p_account uuid)
 RETURNS TABLE(tenant_id uuid, staff_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
  -- HYG-008a (R1-M3): staff_access before the invitation row (the order staff_end_membership ->
  -- staff_invitations_recheck uses), then the checks on the wall clock.
  -- An unknown token is refused at once (same generic answer); a token that appears later is
  -- not picked up by the locked re-read, which must name the tenant resolved here (review r1).
  SELECT i.tenant_id INTO v_role_id FROM public.staff_invitations i WHERE i.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invitation not valid' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_role_id::text, 0));
  SELECT * INTO inv FROM public.staff_invitations i WHERE i.token_hash = p_token_hash AND i.tenant_id = v_role_id FOR UPDATE;
  IF NOT FOUND OR inv.state <> 'pending' OR inv.expires_at <= clock_timestamp()
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
$function$
;--> statement-breakpoint
-- tenant_owner_invite_accept: expiry re-checked after staff_access
CREATE OR REPLACE FUNCTION public.tenant_owner_invite_accept(p_token_hash text, p_account uuid)
 RETURNS TABLE(tenant_id uuid, staff_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
  -- HYG-008a (R1-L1): the expiry is judged again after the staff_access wait, on the wall clock.
  -- Order kept (invitation row, then staff_access): nothing takes staff_access then this row.
  IF o.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invitation not valid' USING ERRCODE = 'P0002';
  END IF;
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
$function$
;--> statement-breakpoint
-- B-03 (clinic side): the table-wide identity seq reveals other tenants' decision counts.
-- clinic_app reads every column except seq. The order the app shows (newest decision first)
-- comes from evidence_decisions(), which orders by seq inside without returning it.
REVOKE SELECT ON public.evidence_approvals FROM clinic_app;--> statement-breakpoint
GRANT SELECT (id, tenant_id, item_id, file_id, config_version, decision, reason, valid_until, decided_by, decided_as, decided_name, decided_at)
  ON public.evidence_approvals TO clinic_app;--> statement-breakpoint

-- 9c: the decisions of one item, newest first by seq (the gate's order), seq not returned.
-- SECURITY DEFINER to order by seq, with the evidence_approvals_read rule repeated: the bound
-- tenant and compliance_may_read for the item's obligation.
CREATE FUNCTION public.evidence_decisions(p_item uuid)
RETURNS TABLE (file_id uuid, decision text, reason text, valid_until date, decided_name text, decided_as text, decided_at timestamptz, config_version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT x.file_id, x.decision, x.reason, x.valid_until, x.decided_name, x.decided_as, x.decided_at, x.config_version
    FROM public.evidence_approvals x
    JOIN public.evidence_items i ON i.id = x.item_id AND i.tenant_id = x.tenant_id
   WHERE x.item_id = p_item AND x.tenant_id = public.app_tenant_id()
     AND public.compliance_may_read(i.obligation_key)
   ORDER BY x.seq DESC
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.evidence_decisions(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.evidence_decisions(uuid) TO clinic_app;--> statement-breakpoint

-- B-04: membership_revocations is history like every other; TRUNCATE is refused too.
CREATE TRIGGER membership_revocations_no_truncate BEFORE TRUNCATE ON public.membership_revocations
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- org_actions_insert: membership bounds on the wall clock (low impact; no lock).
ALTER POLICY org_actions_insert ON public.org_actions
  WITH CHECK (
    tenant_id = public.app_tenant_id()
    AND staff_id = public.app_staff_id()
    AND acting_role = public.app_acting_role()
    AND active_branch_id IS NOT DISTINCT FROM
        NULLIF(pg_catalog.current_setting('app.active_branch_id', true), '')::pg_catalog.uuid
    AND EXISTS (
      SELECT 1 FROM public.staff s
        JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id
       WHERE s.tenant_id = org_actions.tenant_id AND s.id = org_actions.staff_id
         AND r.role = org_actions.acting_role
         AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
         AND (org_actions.active_branch_id IS NULL
              OR r.role IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor')
              OR EXISTS (SELECT 1 FROM public.staff_branches b
                          WHERE b.tenant_id = r.tenant_id AND b.staff_role_id = r.id
                            AND b.branch_id = org_actions.active_branch_id))
    )
  );--> statement-breakpoint
