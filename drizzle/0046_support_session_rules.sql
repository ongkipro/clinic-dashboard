-- T-025 (PR-53, TEN-6, TEN-14, TEN-17, TEN-19): support sessions. A vendor operator opens a
-- reasoned, time-limited session for one tenant; reads go through the clinic_operator role,
-- whose RLS policies (src/db/rls/operator.sql, appended at the end) admit a row only when a
-- session is bound to this backend and transaction. Lock order per tenant as T-024: session
-- check, staff_access, tenant row, session row, audit.

-- clinic_operator: the support reader. NOLOGIN, safe attributes, not a member of clinic_app,
-- SELECT only through the operator policies below, EXECUTE on the bind function only.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'clinic_operator') THEN
    BEGIN
      CREATE ROLE clinic_operator NOLOGIN;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'clinic_operator'
             AND (rolsuper OR rolbypassrls OR rolreplication OR rolcreaterole OR rolcreatedb OR rolcanlogin)) THEN
    RAISE EXCEPTION 'role clinic_operator exists with unsafe attributes; fix it as a superuser';
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO clinic_operator;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_tenant_id() TO clinic_operator;--> statement-breakpoint

ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.support_object_kinds ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.support_session_bindings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.support_session_reads ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.support_bind_tickets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.support_sessions', 'platform', 'vendor', '{}', 'support session functions (src/modules/vendor/support)', 'none'),
  ('public.support_object_kinds', 'platform', 'vendor', '{}', 'migrations', 'none'),
  ('public.support_session_bindings', 'platform', 'vendor', '{}', 'support_session_bind', 'none'),
  ('public.support_session_reads', 'platform', 'vendor', '{}', 'operator_row_read (operator RLS policies)', 'none'),
  ('public.support_bind_tickets', 'platform', 'vendor', '{}', 'vendor_console_support_ticket, support_session_bind', 'none');--> statement-breakpoint

-- The operator class of every tenant table (TEN-14). A new tenant table must add its row
-- (tests/vendor/support.test.ts fails otherwise). personal/clinical need the Owner's approval
-- (T-026) before a session can activate; config is notify-only; never has no operator policy.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.tenants', 'config'),
  ('public.branches', 'config'),
  ('public.setting_versions', 'personal'), -- changed_name and free-text reasons (review round 1)
  ('public.approvals', 'personal'),        -- request/decision reasons, amounts, subjects (review round 1)
  ('public.evidence_items', 'config'),
  ('public.memberships', 'personal'),
  ('public.staff', 'personal'),
  ('public.staff_roles', 'personal'),
  ('public.staff_branches', 'personal'),
  ('public.staff_duties', 'personal'),
  ('public.staff_invitations', 'personal'),
  ('public.membership_revocations', 'personal'),
  ('public.org_actions', 'personal'),
  ('public.role_requests', 'personal'),
  ('public.notifications', 'personal'),
  ('public.evidence_files', 'personal'),
  ('public.evidence_approvals', 'personal'),
  ('public.audit_events', 'personal'),
  ('public.idempotency_records', 'never'),
  ('public.domain_events', 'never'),
  ('public.event_receipts', 'never');--> statement-breakpoint
CREATE TRIGGER support_object_kinds_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.support_object_kinds
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Sessions: requested → active → ended (or requested pending_approval → active → ended);
-- one extension; nothing rewritten; never deleted.
CREATE FUNCTION public.support_sessions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'support sessions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.opened_by, NEW.purpose, NEW.scope, NEW.minutes, NEW.requested_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.opened_by, OLD.purpose, OLD.scope, OLD.minutes, OLD.requested_at)
     OR OLD.state = 'ended'
     OR OLD.state = 'active' AND NEW.state = 'pending_approval'
     OR OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at
     OR OLD.extended_at IS NOT NULL AND (NEW.extended_at, NEW.extension_reason, NEW.ends_at) IS DISTINCT FROM (OLD.extended_at, OLD.extension_reason, OLD.ends_at)
     OR OLD.extended_at IS NULL AND NEW.extended_at IS NULL AND OLD.ends_at IS NOT NULL AND NEW.ends_at IS DISTINCT FROM OLD.ends_at AND NEW.state <> 'ended' THEN
    RAISE EXCEPTION 'a support session only moves forward' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER support_sessions_guard BEFORE UPDATE OR DELETE ON public.support_sessions
  FOR EACH ROW EXECUTE FUNCTION public.support_sessions_guard();--> statement-breakpoint
ALTER TABLE public.support_sessions ENABLE ALWAYS TRIGGER support_sessions_guard;--> statement-breakpoint
CREATE TRIGGER support_session_reads_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.support_session_reads
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER support_sessions_no_truncate BEFORE TRUNCATE ON public.support_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
-- Tickets are never deleted; the only change is consuming one (used_at, once).
CREATE FUNCTION public.support_bind_tickets_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.used_at IS NOT NULL OR NEW.used_at IS NULL
     OR (NEW.id, NEW.session_id, NEW.staff_id, NEW.auth_session_id, NEW.backend_pid, NEW.txid, NEW.issued_at, NEW.expires_at)
        IS DISTINCT FROM (OLD.id, OLD.session_id, OLD.staff_id, OLD.auth_session_id, OLD.backend_pid, OLD.txid, OLD.issued_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'a bind ticket is only consumed, once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER support_bind_tickets_guard BEFORE UPDATE OR DELETE ON public.support_bind_tickets
  FOR EACH ROW EXECUTE FUNCTION public.support_bind_tickets_guard();--> statement-breakpoint
ALTER TABLE public.support_bind_tickets ENABLE ALWAYS TRIGGER support_bind_tickets_guard;--> statement-breakpoint
CREATE TRIGGER support_bind_tickets_no_truncate BEFORE TRUNCATE ON public.support_bind_tickets
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Is the session usable now (active, not past its end by the wall clock, tenant not closed)?
CREATE FUNCTION public.support_session_live(s public.support_sessions) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.state = 'active' AND s.ends_at > clock_timestamp()
     AND EXISTS (SELECT 1 FROM public.tenants_registry r WHERE r.id = s.tenant_id AND r.lifecycle_state <> 'closed')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_session_live(public.support_sessions) FROM PUBLIC;--> statement-breakpoint

-- The operator predicate (TEN-17/TEN-19). The app.* settings are trusted only together with a
-- binding row written by support_session_bind for this backend and this transaction.
CREATE FUNCTION public.operator_scope_allows(p_table text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.support_session_bindings b
      JOIN public.support_sessions s ON s.id = b.session_id
      JOIN public.auth_session a ON a.id = b.auth_session_id
      JOIN public.vendor_staff v ON v.id = b.staff_id
     WHERE b.backend_pid = pg_backend_pid()
       AND b.txid = txid_current_if_assigned()
       -- The operator is still signed in and active (sign-out, lock or deactivation stops reads).
       AND a.surface = 'vendor' AND a.expires_at > clock_timestamp() AND a.locked_at IS NULL
       AND v.state = 'active' AND v.id = s.opened_by
       AND s.id = NULLIF(current_setting('app.operator_session_id', true), '')::uuid
       AND s.tenant_id = public.app_tenant_id()
       AND p_table = ANY (s.scope)
       AND public.support_session_live(s)
       AND EXISTS (SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = p_table AND k.support_class <> 'never'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.operator_scope_allows(text) FROM PUBLIC;--> statement-breakpoint

-- The operator RLS policy for every readable table calls this per row: it admits the row only
-- when operator_scope_allows the table and the row belongs to the bound tenant, and records the
-- row as touched (TEN-14). Limits (DEC-038, review round 2):
--   * the list is a superset of the rows returned: a non-leakproof filter, a sort with LIMIT, a
--     join or an aggregate discards rows after the policy admitted (and recorded) them;
--   * it is written in the reader's transaction, so a reader's ROLLBACK (or rollback to a
--     savepoint) removes it; the durable trace of every read transaction is its bind ticket,
--     committed to the vendor log and the tenant chain before the read could start;
--   * clinic_operator may call this directly while bound and add records for made-up ids (it can
--     never remove one); the Owner's listing (T-026) shows only records that match a row.
CREATE FUNCTION public.operator_row_read(p_table text, p_tenant uuid, p_row uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER COST 1000 SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM public.app_tenant_id() OR NOT public.operator_scope_allows(p_table) THEN
    RETURN false;
  END IF;
  INSERT INTO public.support_session_reads (session_id, table_name, row_id)
  VALUES (current_setting('app.operator_session_id')::uuid, p_table, p_row)
  ON CONFLICT (session_id, table_name, row_id) DO NOTHING;
  RETURN true;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.operator_row_read(text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.operator_row_read(text, uuid, uuid) TO clinic_operator;--> statement-breakpoint

-- The vendor caller of a support command: session first (no lock for a caller without one),
-- then the clinic's staff_access lock (existing tenant only), then vendor_guard.
CREATE FUNCTION public.support_caller(p_token text, p_ip text, p_action text, p_tenant uuid, p_write boolean, p_lock boolean,
                                      OUT account_id uuid, OUT staff_id uuid, OUT role text, OUT refusal text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    refusal := 'no_session'; -- not logged (T-021): nothing to attribute, no flooding
    RETURN;
  END IF;
  -- Commands take the clinic's staff_access lock (lock order); a read bind does not, so an open
  -- read transaction never blocks the Owner, the expiry sweep or staff changes.
  IF p_lock AND p_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || p_tenant::text, 0));
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, ARRAY['support','onboarding','platform_owner'], p_action, p_tenant, p_tenant,
                                           v.second_factor_at, CASE WHEN p_write THEN interval '10 minutes' ELSE interval '12 hours' END);
  account_id := v.account_id;
  staff_id := g.staff_id;
  role := g.role;
  refusal := g.refusal;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_caller(text, text, text, uuid, boolean, boolean) FROM PUBLIC;--> statement-breakpoint

-- The reader of a session (bind): vendor session, active staff, TOTP enrolled, second factor
-- within 12 h, allowlisted IP, a support role — as vendor_guard, but taking no row lock.
-- Refusals are logged by the caller without a tenant (no tenant audit lock in a read txn).
CREATE FUNCTION public.support_read_caller(p_token text, p_ip text, OUT account_id uuid, OUT staff_id uuid, OUT role text, OUT refusal text)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  s public.vendor_staff;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    refusal := 'no_session';
    RETURN;
  END IF;
  account_id := v.account_id;
  SELECT * INTO s FROM public.vendor_staff x WHERE x.account_id = v.account_id;
  refusal := CASE
    WHEN s.id IS NULL THEN 'not_vendor_staff'
    WHEN s.state <> 'active' THEN 'vendor_staff_inactive'
    WHEN NOT EXISTS (SELECT 1 FROM public.auth_user u WHERE u.id = v.account_id AND u.two_factor_enabled) THEN 'totp_required'
    WHEN v.second_factor_at IS NULL OR v.second_factor_at > now() + interval '1 minute' OR v.second_factor_at < now() - interval '12 hours' THEN 'totp_not_verified'
    WHEN NOT public.vendor_ip_allowed(p_ip) THEN 'ip_not_allowed' END;
  IF refusal IS NULL THEN
    SELECT r.role INTO role FROM unnest(ARRAY['support','onboarding','platform_owner']) WITH ORDINALITY x(role, o)
      JOIN public.vendor_staff_roles r ON r.staff_id = s.id AND r.role = x.role ORDER BY x.o LIMIT 1;
    IF role IS NULL THEN
      refusal := 'role_not_held';
    END IF;
  END IF;
  staff_id := s.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_read_caller(text, text) FROM PUBLIC;--> statement-breakpoint

-- Ajukan Sesi (UX-44): tenant, purpose (10–500), tables (scope), minutes (5–120). A scope of
-- config tables only activates at once; any personal/clinical table waits for the Owner
-- (T-026). Unknown tables, never-class tables and closed tenants are refused.
CREATE FUNCTION public.vendor_console_support_open(p_token text, p_ip text, p_tenant uuid, p_purpose text, p_scope text[], p_minutes integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
  v_scope text[];
  v_reason text;
  v_needs_owner boolean;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public.support_caller(p_token, p_ip, 'support_open', p_tenant, true, true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  v_scope := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_scope, '{}')) x ORDER BY 1);
  v_reason := CASE
    WHEN p_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN 'not_found'
    WHEN EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant AND lifecycle_state = 'closed') THEN 'tenant_closed'
    WHEN length(btrim(coalesce(p_purpose, ''))) NOT BETWEEN 10 AND 500 OR p_minutes IS NULL OR p_minutes NOT BETWEEN 5 AND 120
      OR cardinality(v_scope) NOT BETWEEN 1 AND 40 OR EXISTS (SELECT 1 FROM unnest(v_scope) x WHERE x IS NULL) THEN 'invalid_input'
    WHEN EXISTS (SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS (
           SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = x AND k.support_class <> 'never')) THEN 'not_supportable' END;
  IF v_reason IS NOT NULL THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_open', p_tenant, NULL, 'denied', v_reason, p_ip);
    RETURN jsonb_build_object('ok', false, 'code', CASE v_reason WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  v_needs_owner := EXISTS (SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = ANY (v_scope) AND k.support_class IN ('personal','clinical'));
  INSERT INTO public.support_sessions (tenant_id, opened_by, purpose, scope, minutes, state, activated_at, ends_at)
  VALUES (p_tenant, c.staff_id, btrim(p_purpose), v_scope, p_minutes,
          CASE WHEN v_needs_owner THEN 'pending_approval' ELSE 'active' END,
          CASE WHEN v_needs_owner THEN NULL ELSE clock_timestamp() END,
          CASE WHEN v_needs_owner THEN NULL ELSE clock_timestamp() + make_interval(mins => p_minutes) END)
  RETURNING id INTO v_id;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_open', p_tenant, v_id, 'success',
                            CASE WHEN v_needs_owner THEN 'awaiting_owner' ELSE 'active' END, p_ip);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'state', CASE WHEN v_needs_owner THEN 'pending_approval' ELSE 'active' END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_support_open(text, text, uuid, text, text[], integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_support_open(text, text, uuid, text, text[], integer) TO clinic_vendor;--> statement-breakpoint

-- The session's tenant, for lock ordering before the session row is locked.
CREATE FUNCTION public.support_session_tenant(p_session uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT tenant_id FROM public.support_sessions WHERE id = p_session
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_session_tenant(uuid) FROM PUBLIC;--> statement-breakpoint

-- Perpanjang sekali (TEN-14): an active session, by its opener, with a new reason, by at most
-- 120 minutes from now; never a second time. A scope with personal/clinical tables is
-- extended only with the Owner's approval (T-026) — refused here.
CREATE FUNCTION public.vendor_console_support_extend(p_token text, p_ip text, p_session uuid, p_reason text, p_minutes integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.support_session_tenant(p_session);
  c record;
  s public.support_sessions;
  v_reason text;
BEGIN
  SELECT * INTO c FROM public.support_caller(p_token, p_ip, 'support_extend', v_tenant, true, true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  SELECT * INTO s FROM public.support_sessions WHERE id = p_session FOR NO KEY UPDATE;
  v_reason := CASE
    WHEN NOT FOUND THEN 'not_found'
    WHEN s.opened_by <> c.staff_id THEN 'not_opener'
    WHEN NOT public.support_session_live(s) THEN 'not_active'
    WHEN s.extended_at IS NOT NULL THEN 'already_extended'
    WHEN EXISTS (SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = ANY (s.scope) AND k.support_class IN ('personal','clinical')) THEN 'needs_owner_approval'
    WHEN length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 500 OR btrim(p_reason) = s.purpose
      OR p_minutes IS NULL OR p_minutes NOT BETWEEN 5 AND 120 THEN 'invalid_input' END;
  IF v_reason IS NOT NULL THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_extend', v_tenant, p_session, 'denied', v_reason, p_ip);
    RETURN jsonb_build_object('ok', false, 'code', CASE v_reason WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  UPDATE public.support_sessions SET extended_at = clock_timestamp(), extension_reason = btrim(p_reason),
         ends_at = clock_timestamp() + make_interval(mins => p_minutes)
   WHERE id = p_session;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_extend', v_tenant, p_session, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_support_extend(text, text, uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_support_extend(text, text, uuid, text, integer) TO clinic_vendor;--> statement-breakpoint

-- Ends a session (operator, Owner, expiry sweep, closed tenant) and audits it in the tenant
-- chain. The caller holds staff_access for the tenant.
CREATE FUNCTION public.support_session_end(p_session uuid, p_reason text, p_staff uuid, p_account uuid, p_role text, p_service text, p_ip text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s public.support_sessions;
BEGIN
  -- NO KEY UPDATE: read records and bindings reference the row (key share), which must not
  -- block an end.
  SELECT * INTO s FROM public.support_sessions WHERE id = p_session FOR NO KEY UPDATE;
  IF NOT FOUND OR s.state = 'ended' THEN
    RETURN false;
  END IF;
  UPDATE public.support_sessions SET state = 'ended', ended_at = clock_timestamp(), end_reason = p_reason WHERE id = p_session;
  PERFORM public.vendor_log(p_staff, p_account, p_role, 'support_end', s.tenant_id, p_session, 'success', 'ended_' || p_reason, p_ip, NULL, p_service);
  RETURN true;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_session_end(uuid, text, uuid, uuid, text, text, text) FROM PUBLIC;--> statement-breakpoint

-- Akhiri Sesi by the operator who opened it.
CREATE FUNCTION public.vendor_console_support_end(p_token text, p_ip text, p_session uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.support_session_tenant(p_session);
  c record;
BEGIN
  SELECT * INTO c FROM public.support_caller(p_token, p_ip, 'support_end', v_tenant, false, true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_sessions WHERE id = p_session AND opened_by = c.staff_id AND state <> 'ended')
     OR NOT public.support_session_end(p_session, 'operator', c.staff_id, c.account_id, c.role, NULL, p_ip) THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_end', v_tenant, p_session, 'denied', 'not_open', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND', 'reason', 'not_open');
  END IF;
  RETURN jsonb_build_object('ok', true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_support_end(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_support_end(text, text, uuid) TO clinic_vendor;--> statement-breakpoint

-- Sesi Dukungan list (UX-44) for one tenant or all: metadata only (no data read).
CREATE FUNCTION public.vendor_console_support_list(p_token text, p_ip text, p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_support_list');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  RETURN jsonb_build_object('ok', true, 'rows', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'tenant_id', s.tenant_id, 'operator', v.display_name, 'purpose', s.purpose,
                                        'scope', to_jsonb(s.scope), 'state', CASE WHEN s.state = 'active' AND NOT public.support_session_live(s) THEN 'expired' ELSE s.state END,
                                        'requested_at', s.requested_at, 'ends_at', s.ends_at, 'extended', s.extended_at IS NOT NULL, 'end_reason', s.end_reason)
                     ORDER BY s.requested_at DESC)
      FROM public.support_sessions s JOIN public.vendor_staff v ON v.id = s.opened_by
     WHERE p_tenant IS NULL OR s.tenant_id = p_tenant), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_support_list(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_support_list(text, text, uuid) TO clinic_vendor;--> statement-breakpoint

-- Step 1 of a read (review rounds 2–4): the reader has opened its transaction and named its
-- backend pid and txid (txid_current()); the console issues a bind ticket for exactly that
-- transaction in its own short transaction, which commits "bind issued" to the vendor log and
-- the tenant chain before any row can be read. txids are never reused, so the ticket dies with
-- the reader's transaction: a rollback cannot replay it, and every read transaction leaves its
-- own durable trace. Same checks as the bind (session, guard with read age, opener, session
-- live); the transaction must be in progress and older than this one; one ticket per txid;
-- expires 2 minutes after issue.
CREATE FUNCTION public.vendor_console_support_ticket(p_token text, p_ip text, p_session uuid, p_backend_pid integer, p_txid bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.support_session_tenant(p_session);
  c record;
  s public.support_sessions;
  v_reason text;
  v_id uuid;
  v_now timestamptz;
BEGIN
  SELECT * INTO c FROM public.support_caller(p_token, p_ip, 'support_bind', v_tenant, false, true);
  IF c.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  SELECT * INTO s FROM public.support_sessions WHERE id = p_session;
  v_reason := CASE
    WHEN NOT FOUND THEN 'not_found'
    WHEN s.opened_by <> c.staff_id THEN 'not_opener'
    WHEN s.state = 'pending_approval' THEN 'awaiting_owner'
    WHEN NOT public.support_session_live(s) THEN 'not_active'
    WHEN p_backend_pid IS NULL OR p_backend_pid <= 0 OR p_txid IS NULL OR p_txid <= 0 OR p_txid >= txid_current()
      OR p_txid >> 32 <> txid_current() >> 32 -- same epoch: no alias of a live xid from an older epoch
      -- The pair is a live transaction of that backend (it holds its own transaction-id lock),
      -- and the backend is a support-reader login (review round 4): no ticket for another
      -- backend's or a console's transaction. pg_locks and pg_stat_activity.usesysid are
      -- readable without pg_read_all_stats.
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
                      WHERE l.locktype = 'transactionid' AND l.mode = 'ExclusiveLock' AND l.granted
                        AND l.pid = p_backend_pid AND l.transactionid = (p_txid % 4294967296)::text::xid)
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity a
                      WHERE a.pid = p_backend_pid AND pg_has_role(a.usesysid, 'clinic_operator', 'MEMBER')
                        AND NOT pg_has_role(a.usesysid, 'clinic_vendor', 'MEMBER')) THEN 'invalid_input' END;
  IF v_reason IS NOT NULL THEN
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', v_tenant, p_session, 'denied', v_reason, p_ip);
    RETURN jsonb_build_object('ok', false, 'code', CASE v_reason WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  v_now := clock_timestamp();
  BEGIN
    INSERT INTO public.support_bind_tickets (session_id, staff_id, auth_session_id, backend_pid, txid, issued_at, expires_at)
    VALUES (p_session, c.staff_id, (SELECT a.id FROM public.auth_session a WHERE a.token = p_token), p_backend_pid, p_txid, v_now, v_now + interval '2 minutes')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- One ticket per transaction (UNIQUE txid), also against a concurrent issue for the same
    -- txid under another tenant (staff_access is per tenant).
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', v_tenant, p_session, 'denied', 'ticket_exists', p_ip);
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'ticket_exists');
  END;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', v_tenant, p_session, 'success', 'ticket_issued', p_ip);
  RETURN jsonb_build_object('ok', true, 'ticket', v_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_support_ticket(text, text, uuid, integer, bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_support_ticket(text, text, uuid, integer, bigint) TO clinic_vendor;--> statement-breakpoint

-- Step 2: bind a session for reading (TEN-17), on the operator's read connection
-- (clinic_operator), with an unused ticket issued for this backend and transaction, to this
-- operator and login session: the
-- vendor session token, the guard (read age), the opener, the session live; then the binding
-- row for this backend and transaction and the app.* settings, transaction-local. Only READ
-- COMMITTED is accepted: under REPEATABLE READ or SERIALIZABLE the predicate would judge the
-- session, staff and login rows from the snapshot and miss a revocation (review round 2). A
-- refused bind is logged (a session id names the tenant); the module commits the refusal.
CREATE FUNCTION public.support_session_bind(p_token text, p_ip text, p_session uuid, p_ticket uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.support_session_tenant(p_session);
  c record;
  s public.support_sessions;
  v_reason text;
BEGIN
  -- A read bind holds no lock that a revocation needs (the Owner's end, a deactivation, the
  -- sweep, staff changes): the same checks as vendor_guard without its FOR SHARE on the staff
  -- row; the operator predicate re-checks staff state and the login session on every row.
  SELECT * INTO c FROM public.support_read_caller(p_token, p_ip);
  IF c.refusal IS NOT NULL THEN
    IF c.refusal <> 'no_session' THEN
      PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', NULL, p_session, 'denied', c.refusal, p_ip);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', c.refusal);
  END IF;
  SELECT * INTO s FROM public.support_sessions WHERE id = p_session;
  v_reason := CASE
    WHEN NOT FOUND THEN 'not_found'
    -- The level is fixed at the transaction's first statement; this call is at least that.
    WHEN current_setting('transaction_isolation') <> 'read committed' THEN 'isolation_not_read_committed'
    WHEN s.opened_by <> c.staff_id THEN 'not_opener'
    WHEN s.state = 'pending_approval' THEN 'awaiting_owner'
    WHEN NOT public.support_session_live(s) THEN 'not_active' END;
  IF v_reason IS NULL THEN
    -- Consume the ticket. It names this backend and transaction, so it can never bind any other
    -- transaction (a rolled-back reader's txid is dead); used_at records the bind.
    UPDATE public.support_bind_tickets t SET used_at = clock_timestamp()
     WHERE t.id = p_ticket AND t.session_id = p_session AND t.staff_id = c.staff_id AND t.used_at IS NULL
       AND t.backend_pid = pg_backend_pid() AND t.txid = txid_current()
       AND t.expires_at > clock_timestamp()
       AND t.auth_session_id = (SELECT a.id FROM public.auth_session a WHERE a.token = p_token);
    IF NOT FOUND THEN
      v_reason := 'no_ticket';
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    -- Vendor log only, never the tenant chain: the chain's lock would be held by the reader's
    -- transaction (blocking the Owner's end and the sweep), and a REPEATABLE READ snapshot is
    -- older than the chain's tail. The attempt is already in the tenant chain as its ticket
    -- (ticket_issued); the session id names the tenant. The module commits the refusal.
    PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_bind', NULL, p_session, 'denied', v_reason, p_ip);
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN v_reason = 'not_found' THEN 'ERR_NOT_FOUND' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  INSERT INTO public.support_session_bindings (session_id, backend_pid, txid, auth_session_id, staff_id)
  VALUES (p_session, pg_backend_pid(), txid_current(), (SELECT a.id FROM public.auth_session a WHERE a.token = p_token), c.staff_id)
  ON CONFLICT (backend_pid, txid) DO UPDATE SET session_id = EXCLUDED.session_id, auth_session_id = EXCLUDED.auth_session_id,
                                                staff_id = EXCLUDED.staff_id, bound_at = clock_timestamp();
  -- Default caps on statement and idle time. Hygiene, not a guarantee: the reader can override
  -- them with SET LOCAL. Revocation does not depend on them (the predicate runs per row under
  -- READ COMMITTED); the bound is the session's end time.
  PERFORM set_config('statement_timeout', '30s', true),
          set_config('idle_in_transaction_session_timeout', '60s', true);
  -- The durable record of this bind is its ticket ("ticket_issued", committed by the console).
  PERFORM set_config('app.tenant_id', s.tenant_id::text, true),
          set_config('app.operator_session_id', s.id::text, true),
          set_config('app.session_scope', array_to_string(s.scope, ','), true);
  RETURN jsonb_build_object('ok', true, 'tenant_id', s.tenant_id, 'scope', to_jsonb(s.scope), 'ends_at', s.ends_at);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_session_bind(text, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.support_session_bind(text, text, uuid, uuid) TO clinic_operator;--> statement-breakpoint

-- The Owner ends a session now (PR-60; page in T-028).
CREATE FUNCTION public.support_session_end_by_owner(p_session uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_owner uuid := public.onboarding_owner(); -- the acting Owner, under staff_access
BEGIN
  IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM public.support_sessions WHERE id = p_session AND tenant_id = public.app_tenant_id() AND state <> 'ended') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no open support session' USING ERRCODE = 'P0002';
  END IF;
  -- Vendor log row (no service, no staff: the tenant chain row below names the Owner).
  PERFORM public.support_session_end(p_session, 'owner', NULL, NULL, NULL, NULL, NULL);
  PERFORM public.audit_append('operator_session', 'support_session', p_session, 'success', 'ended_by_owner');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_session_end_by_owner(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.support_session_end_by_owner(uuid) TO clinic_app;--> statement-breakpoint

-- Expiry sweep (executor worker): ends active sessions past their end, and every open session
-- of a closed tenant, tenant by tenant in id
-- order, each under its staff_access lock; drops bindings older than a day. The PR-53
-- scenario's audit row ("the owner sees the session in the audit log") comes from here.
CREATE FUNCTION public.support_session_expire() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT s.id, s.tenant_id, (t.lifecycle_state = 'closed') AS closed
             FROM public.support_sessions s JOIN public.tenants_registry t ON t.id = s.tenant_id
            WHERE s.state <> 'ended' AND (s.state = 'active' AND s.ends_at <= clock_timestamp() OR t.lifecycle_state = 'closed')
            ORDER BY s.tenant_id, s.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
    IF public.support_session_end(r.id, CASE WHEN r.closed THEN 'tenant_closed' ELSE 'expired' END, NULL, NULL, NULL,
                                  public.vendor_service_name('support.expiry'), NULL) THEN
      n := n + 1;
    END IF;
  END LOOP;
  DELETE FROM public.support_session_bindings WHERE bound_at < clock_timestamp() - interval '1 day';
  RETURN n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.support_session_expire() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.support_session_expire() TO clinic_executor;--> statement-breakpoint

-- Operator read predicates (TEN-14, TEN-17, TEN-19): one SELECT policy for clinic_operator per tenant
-- table whose support class allows an operator to read it (support_object_kinds: config,
-- personal, clinical, money_total; never = no policy). Each policy first compares the row's
-- tenant with app_tenant_id() (so other tenants' rows never reach the function), then admits
-- the row only through operator_row_read(<table>, tenant, id): a session bound to this backend
-- and transaction, live, for this tenant, opened by the bound operator who is still signed in
-- and active, with the table in its scope — and records the row as touched. Applied by migration
-- 0046_support_session_rules.sql, which ends with this file verbatim (tests/vendor/support.test.ts
-- compares them and checks every table has a class and every readable class one policy).
CREATE POLICY approvals_operator_read ON public.approvals FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.approvals', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.approvals TO clinic_operator;--> statement-breakpoint
CREATE POLICY audit_events_operator_read ON public.audit_events FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.audit_events', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.audit_events TO clinic_operator;--> statement-breakpoint
CREATE POLICY branches_operator_read ON public.branches FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.branches', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.branches TO clinic_operator;--> statement-breakpoint
CREATE POLICY evidence_approvals_operator_read ON public.evidence_approvals FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.evidence_approvals', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.evidence_approvals TO clinic_operator;--> statement-breakpoint
CREATE POLICY evidence_files_operator_read ON public.evidence_files FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.evidence_files', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.evidence_files TO clinic_operator;--> statement-breakpoint
CREATE POLICY evidence_items_operator_read ON public.evidence_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.evidence_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.evidence_items TO clinic_operator;--> statement-breakpoint
CREATE POLICY membership_revocations_operator_read ON public.membership_revocations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.membership_revocations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.membership_revocations TO clinic_operator;--> statement-breakpoint
CREATE POLICY memberships_operator_read ON public.memberships FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.memberships', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.memberships TO clinic_operator;--> statement-breakpoint
CREATE POLICY notifications_operator_read ON public.notifications FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.notifications', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.notifications TO clinic_operator;--> statement-breakpoint
CREATE POLICY org_actions_operator_read ON public.org_actions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.org_actions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.org_actions TO clinic_operator;--> statement-breakpoint
CREATE POLICY role_requests_operator_read ON public.role_requests FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.role_requests', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.role_requests TO clinic_operator;--> statement-breakpoint
CREATE POLICY setting_versions_operator_read ON public.setting_versions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.setting_versions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.setting_versions TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_operator_read ON public.staff FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_branches_operator_read ON public.staff_branches FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_branches', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_branches TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_duties_operator_read ON public.staff_duties FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_duties', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_duties TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_invitations_operator_read ON public.staff_invitations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_invitations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_invitations TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_roles_operator_read ON public.staff_roles FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_roles', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_roles TO clinic_operator;--> statement-breakpoint
CREATE POLICY tenants_operator_read ON public.tenants FOR SELECT TO clinic_operator
  USING (id = public.app_tenant_id() AND public.operator_row_read('public.tenants', id, id));--> statement-breakpoint
GRANT SELECT ON public.tenants TO clinic_operator;
