-- T-026 (PR-60, TEN-14): the Owner approves or rejects a support session whose scope holds
-- specific personal data or clinical tables (T-025 leaves them pending_approval), and the
-- Owner (Admin Pusat read, 19 §2.16) sees every session with its access windows, refused binds
-- and the records read. Functions and two indexes, no new table (DEC-038 allowed this migration). Lock order per tenant as
-- T-024/T-025: staff_access, session row, audit.

-- The Owner's access log reads tickets and refused binds by session (review round 3).
CREATE INDEX "support_bind_tickets_session_idx" ON "support_bind_tickets" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "vendor_actions_object_idx" ON "vendor_actions" USING btree ("object_id","action");--> statement-breakpoint

-- The Owner's decision on a pending session. Approve: active from now for its minutes (the
-- TTL starts at approval). Reject: ended (end_reason owner). A caller who is not the acting
-- Owner is refused by an exception (rolled back, not in the chain — as support_session_end_by_owner).
-- Other refusals are audited in the tenant chain and returned as 'refused:<code>' (the caller commits them). No free-text reason:
-- audit_events.reason is reserved for break-glass (as vendor_dual_identity_clinic_decide).
CREATE FUNCTION public.support_session_owner_decide(p_session uuid, p_approve boolean) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_owner uuid := public.onboarding_owner(); -- acting Owner, under the tenant's staff_access lock
  v_tenant uuid := public.app_tenant_id();
  v_account uuid;
  s public.support_sessions;
  v_refusal text;
  v_now timestamptz;
BEGIN
  SELECT m.account_id INTO v_account FROM public.staff x JOIN public.memberships m ON m.tenant_id = x.tenant_id AND m.id = x.membership_id
   WHERE x.tenant_id = v_tenant AND x.id = v_owner;
  IF p_session IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no support session named' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO s FROM public.support_sessions WHERE id = p_session AND tenant_id = v_tenant FOR NO KEY UPDATE;
  v_refusal := CASE
    WHEN NOT FOUND THEN 'not_found'
    WHEN p_approve IS NULL THEN 'invalid_input'
    WHEN s.state <> 'pending_approval' THEN 'not_pending'
    WHEN EXISTS (SELECT 1 FROM public.tenants_registry r WHERE r.id = v_tenant AND r.lifecycle_state = 'closed') THEN 'tenant_closed'
    -- Requester ≠ approver: not the opener's own account holding the Owner role (dual identity).
    -- Rejecting is the safe direction and stays allowed.
    WHEN p_approve AND EXISTS (SELECT 1 FROM public.vendor_staff v WHERE v.id = s.opened_by AND v.account_id = v_account) THEN 'approver_is_requester'
    WHEN p_approve AND NOT EXISTS (SELECT 1 FROM public.vendor_staff v WHERE v.id = s.opened_by AND v.state = 'active') THEN 'operator_inactive' END;
  IF v_refusal IS NOT NULL THEN
    -- Not found: no tenant row to name; audited against the id the Owner tried.
    PERFORM public.audit_append('approval', 'support_session', p_session, 'denied', 'support_scope_' || v_refusal);
    RETURN 'refused:' || v_refusal;
  END IF;
  v_now := clock_timestamp();
  IF p_approve THEN
    UPDATE public.support_sessions SET state = 'active', activated_at = v_now, ends_at = v_now + make_interval(mins => s.minutes)
     WHERE id = p_session;
  ELSE
    UPDATE public.support_sessions SET state = 'ended', ended_at = v_now, end_reason = 'owner' WHERE id = p_session;
  END IF;
  -- The vendor console's record (no staff, no service: the clinic chain row below names the Owner).
  PERFORM public.vendor_log(NULL, NULL, NULL, 'support_scope_decide', v_tenant, p_session, 'success',
                            CASE WHEN p_approve THEN 'approved_by_owner' ELSE 'rejected_by_owner' END, NULL);
  PERFORM public.audit_append('approval', 'support_session', p_session, 'success',
                              CASE WHEN p_approve THEN 'support_scope_approved' ELSE 'support_scope_rejected' END);
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_session_owner_decide(uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.support_session_owner_decide(uuid, boolean) TO clinic_app;--> statement-breakpoint

-- Who may read Akses Vendor (19: owner; Admin Pusat read): an active membership acting as one
-- of them (approval_actor checks the bound context).
CREATE FUNCTION public.support_owner_reader() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF a.role NOT IN ('owner','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: Akses Vendor is for the owner and Admin Pusat' USING ERRCODE = '42501';
  END IF;
  RETURN a.tenant_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_owner_reader() FROM PUBLIC;--> statement-breakpoint

-- Does a read record name a row that exists now in this tenant? true / false, or NULL when the
-- table cannot be checked (not a classed public table, or no id/tenant column). Used only to
-- flag records in the Owner's log: every record is listed (review round 1), because a real read
-- whose row was deleted later must stay visible, and a record for a row that never existed in
-- this tenant (a bound operator calling operator_row_read directly) is evidence to show, not
-- hide. The table name comes from support_object_kinds (fixed whitelist), never the caller.
CREATE FUNCTION public.support_read_row_exists(p_table text, p_tenant uuid, p_row uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_rel regclass;
  v_col text := CASE WHEN p_table = 'public.tenants' THEN 'id' ELSE 'tenant_id' END;
  v_found boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = p_table AND k.support_class <> 'never') THEN
    RETURN NULL;
  END IF;
  -- Resolved in schema public by name (never through search_path, so never pg_temp).
  SELECT c.oid INTO v_rel FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND 'public.' || c.relname = p_table AND c.relkind IN ('r','p');
  IF v_rel IS NULL OR (SELECT count(*) FROM pg_catalog.pg_attribute t
                        WHERE t.attrelid = v_rel AND t.attname IN ('id', v_col) AND NOT t.attisdropped AND t.atttypid = 'uuid'::regtype) < 2
                         - (CASE WHEN v_col = 'id' THEN 1 ELSE 0 END) THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1 AND %I = $2)', v_rel, v_col) INTO v_found USING p_row, p_tenant;
  RETURN v_found;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_read_row_exists(text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Akses Vendor › Sesi Dukungan (UX-48, page T-028): every session of the tenant, newest first,
-- with operator, purpose, scope (and its classes), state, times, and counts of access windows
-- (bind tickets), refused binds and listed reads.
CREATE FUNCTION public.support_sessions_for_owner() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.support_owner_reader();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', s.id, 'operator', v.display_name, 'purpose', s.purpose,
             'scope', (SELECT jsonb_agg(jsonb_build_object('table', x, 'class', k.support_class) ORDER BY x)
                         FROM unnest(s.scope) x LEFT JOIN public.support_object_kinds k ON k.table_name = x),
             'state', CASE WHEN s.state <> 'active' OR public.support_session_live(s) THEN s.state
                           WHEN s.ends_at <= clock_timestamp() THEN 'expired' ELSE 'tenant_closed' END,
             'needs_approval', s.state = 'pending_approval'
                               AND EXISTS (SELECT 1 FROM public.tenants_registry r WHERE r.id = s.tenant_id AND r.lifecycle_state <> 'closed'),
             'minutes', s.minutes, 'requested_at', s.requested_at, 'activated_at', s.activated_at, 'ends_at', s.ends_at,
             'extended_at', s.extended_at, 'extension_reason', s.extension_reason, 'ended_at', s.ended_at, 'end_reason', s.end_reason,
             'access_windows', (SELECT count(*) FROM public.support_bind_tickets t WHERE t.session_id = s.id),
             'refused_reads', (SELECT count(*) FROM public.vendor_actions va WHERE va.action = 'support_bind' AND va.outcome = 'denied' AND va.object_id = s.id),
             'records_read', (SELECT count(*) FROM public.support_session_reads r WHERE r.session_id = s.id))
           ORDER BY s.requested_at DESC, s.id DESC)
      FROM public.support_sessions s JOIN public.vendor_staff v ON v.id = s.opened_by
     WHERE s.tenant_id = v_tenant), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_sessions_for_owner() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.support_sessions_for_owner() TO clinic_app;--> statement-breakpoint

-- One session's access log (TEN-14: object kind, id, time, grouped by session) as one stream of
-- events, oldest first, a page at a time (limit 1–500; every part of the answer is bounded):
--   window   an access window opened (bind ticket issued; used_at when bound)
--   refused  a refused bind (reason)
--   read     a record read (object kind, id), flagged row_found: the row exists now in this
--            tenant / false: deleted since, or never this tenant's (shown, not hidden) / null:
--            not checkable
-- with the total of each kind. Another tenant's session reads as not found.
CREATE FUNCTION public.support_session_reads_for_owner(p_session uuid, p_offset integer, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.support_owner_reader();
BEGIN
  IF p_session IS NULL OR NOT EXISTS (SELECT 1 FROM public.support_sessions WHERE id = p_session AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no such support session' USING ERRCODE = 'P0002';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: page out of range' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'windows', (SELECT count(*) FROM public.support_bind_tickets t WHERE t.session_id = p_session),
      'refused', (SELECT count(*) FROM public.vendor_actions va WHERE va.action = 'support_bind' AND va.outcome = 'denied' AND va.object_id = p_session),
      'reads', (SELECT count(*) FROM public.support_session_reads r WHERE r.session_id = p_session)),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'kind', e.kind, 'at', e.at, 'used_at', e.used_at, 'reason', e.reason, 'object_kind', e.object_kind, 'id', e.row_id))
             || CASE WHEN e.kind = 'read' THEN jsonb_build_object('row_found', public.support_read_row_exists(e.object_kind, v_tenant, e.row_id)) ELSE '{}'::jsonb END
             ORDER BY e.at, e.kind, e.k)
        FROM (SELECT * FROM (
                SELECT 'window'::text AS kind, t.issued_at AS at, t.used_at, NULL::text AS reason, NULL::text AS object_kind, NULL::uuid AS row_id, t.id::text AS k
                  FROM public.support_bind_tickets t WHERE t.session_id = p_session
                UNION ALL
                SELECT 'refused', va.at, NULL, coalesce(va.reason_code, 'unknown'), NULL, NULL, lpad(va.seq::text, 19, '0')
                  FROM public.vendor_actions va WHERE va.action = 'support_bind' AND va.outcome = 'denied' AND va.object_id = p_session
                UNION ALL
                SELECT 'read', r.first_read_at, NULL, NULL, r.table_name, r.row_id, r.table_name || ':' || r.row_id::text
                  FROM public.support_session_reads r WHERE r.session_id = p_session) x
               ORDER BY x.at, x.kind, x.k OFFSET p_offset LIMIT p_limit) e), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_session_reads_for_owner(uuid, integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.support_session_reads_for_owner(uuid, integer, integer) TO clinic_app;
