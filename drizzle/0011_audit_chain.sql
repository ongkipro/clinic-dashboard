-- T-008 audit chain (SEC-5, DATA-60, PR-51).
--
-- One write path: audit_append(), SECURITY DEFINER, callable by clinic_app. It takes the
-- attribution from the bound transaction context (app.tenant_id, app.staff_id, acting
-- role, active branch) and resolves account and membership from the staff row, so a
-- caller can only describe *what* happened (action, object, outcome, reason), never
-- *who* did it. Rows are chained per tenant: hash = sha256(prev_hash || canonical row),
-- serialised by a per-tenant advisory lock, seq gap-free per tenant.
-- The table is append-only for everyone (trigger), and clinic_app reads it through RLS
-- (UX-31): owner and internal auditor read the whole tenant (auditor masked in the read
-- API); facility head and records officer (branch-set roles, IAM-8) read only rows of
-- branches in their acting role's scope.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

CREATE FUNCTION public.audit_canonical(e public.audit_events) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT concat_ws('|',
    e.tenant_id::text, e.seq::text,
    to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(e.account_id::text, ''), coalesce(e.membership_id::text, ''),
    coalesce(e.staff_id::text, ''), coalesce(e.acting_role, ''), coalesce(e.branch_id::text, ''),
    coalesce(e.vendor_session_id::text, ''), coalesce(e.vendor_staff_id::text, ''),
    coalesce(e.service_identity, ''), coalesce(e.correlation_id::text, ''),
    e.action, e.object_kind, coalesce(e.object_id::text, ''), e.outcome,
    coalesce(e.reason_code, ''), coalesce(encode(convert_to(e.reason, 'UTF8'), 'base64'), ''),
    e.id::text)
$$;--> statement-breakpoint

CREATE FUNCTION public.audit_append(
  p_action text, p_object_kind text, p_object_id uuid, p_outcome text,
  p_reason_code text DEFAULT NULL, p_reason text DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
     AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_append(text, text, uuid, text, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.audit_append(text, text, uuid, text, text, text, uuid) TO clinic_app;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_canonical(public.audit_events) FROM PUBLIC;--> statement-breakpoint

-- Append-only for every role, including the owner (corrections are new rows).
CREATE FUNCTION public.audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
-- Write-once copy support (SEC-5): canonical export of one row, so a copy holds exactly
-- what was hashed and any later check recomputes the hash from the copy alone.
CREATE FUNCTION public.audit_export(e public.audit_events) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object(
    'tenant_id', e.tenant_id, 'seq', e.seq::text, 'id', e.id,
    'at', to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'canonical', public.audit_canonical(e), 'prev_hash', e.prev_hash, 'hash', e.hash)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_export(public.audit_events) FROM PUBLIC;--> statement-breakpoint

-- Chain check for one tenant: returns the first broken seq, or NULL when intact. Used by
-- the read API (owner/facility head see "rantai utuh") and the daily copy job.
CREATE FUNCTION public.audit_verify(p_tenant uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.audit_events;
  v_prev text := repeat('0', 64);
  v_expect bigint := 1;
BEGIN
  -- Only the bound tenant, and only for roles that may read the log. The daily copy job
  -- runs as the migration owner and calls audit_verify_all() instead.
  IF p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR coalesce(public.app_acting_role(), '') NOT IN ('owner','facility_head','records_officer','auditor') THEN
    RAISE EXCEPTION 'audit_verify only checks the bound tenant' USING ERRCODE = '42501';
  END IF;
  FOR e IN SELECT * FROM public.audit_events WHERE tenant_id = p_tenant ORDER BY seq LOOP
    IF e.seq <> v_expect OR e.prev_hash <> v_prev
       OR e.hash <> encode(public.digest(e.prev_hash || public.audit_canonical(e), 'sha256'), 'hex') THEN
      RETURN e.seq;
    END IF;
    v_prev := e.hash;
    v_expect := v_expect + 1;
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_verify(uuid) FROM PUBLIC;--> statement-breakpoint
-- For the daily copy job (runs as the migration owner, not granted to any app role):
-- every tenant whose chain is broken, with the first broken seq.
CREATE FUNCTION public.audit_verify_all() RETURNS TABLE (tenant_id uuid, broken_seq bigint)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t uuid;
  e public.audit_events;
  v_prev text;
  v_expect bigint;
BEGIN
  FOR t IN SELECT DISTINCT a.tenant_id FROM public.audit_events a LOOP
    v_prev := repeat('0', 64);
    v_expect := 1;
    FOR e IN SELECT * FROM public.audit_events a WHERE a.tenant_id = t ORDER BY a.seq LOOP
      IF e.seq <> v_expect OR e.prev_hash <> v_prev
         OR e.hash <> encode(public.digest(e.prev_hash || public.audit_canonical(e), 'sha256'), 'hex') THEN
        tenant_id := t;
        broken_seq := e.seq;
        RETURN NEXT;
        EXIT;
      END IF;
      v_prev := e.hash;
      v_expect := v_expect + 1;
    END LOOP;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_verify_all() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.audit_verify(uuid) TO clinic_app;--> statement-breakpoint

CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_events_immutable();--> statement-breakpoint

CREATE FUNCTION public.app_branch_allowed(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN pg_catalog.current_setting('app.allowed_branch_ids', true) = '*' THEN true
    WHEN p_branch IS NULL THEN false
    ELSE p_branch::text = ANY (pg_catalog.string_to_array(
           NULLIF(pg_catalog.current_setting('app.allowed_branch_ids', true), ''), ','))
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_branch_allowed(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_branch_allowed(uuid) TO clinic_app;--> statement-breakpoint
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_events_read ON public.audit_events FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_acting_role() IN ('owner','auditor')
              OR public.app_acting_role() IN ('facility_head','records_officer')
                 AND public.app_branch_allowed(branch_id)));--> statement-breakpoint
GRANT SELECT ON public.audit_events TO clinic_app;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.audit_events', 'tenant-shared', 'audit', '{owner,facility_head,records_officer,auditor}', 'audit_append()', 'branch of the action');
