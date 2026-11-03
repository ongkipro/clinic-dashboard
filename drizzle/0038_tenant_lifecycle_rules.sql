-- T-022 (PR-56, TEN-12, PRIV-8, PR-57). Tenant lifecycle: transitions, history, owner
-- notice, and the capability check later tasks call (new bookings, public site, marketing
-- stop while suspended; existing appointments, cashier, care messages and clinical
-- read/export continue).
--
-- Who moves a tenant:
--   provisioning → onboarding   onboarding or platform owner (vendor console, T-023); only
--                               with the signed processor agreement approved (TEN-12, PRIV-8)
--   onboarding → live           platform owner (T-024 go-live checklist)
--   live → suspended            maker-checker request `suspension` (finance/support → platform owner)
--   suspended → live            maker-checker request `reactivation` (platform owner → another platform owner)
--   live|suspended → exit       maker-checker request `exit` (finance/support → platform owner)
--   exit → closed               maker-checker request `closure` (platform owner → another platform owner)
-- Requests are executed by a clinic_executor worker through tenant_lifecycle_apply_request,
-- which consumes the request and applies the transition in one call (review round 1: the
-- database, not the wrapper, makes them atomic). Onboarding steps go through the vendor
-- console (vendor_console_tenant_advance), bound to the signed-in vendor session (T-021),
-- never an actor id named by a caller. The internal transition function is granted to
-- nobody.

-- ── reactivation and closure requests ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vendor_request_roles(p_kind text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_kind
    WHEN 'suspension' THEN ARRAY['vendor_finance','support']
    WHEN 'exit' THEN ARRAY['vendor_finance','support']
    WHEN 'server_fee_change' THEN ARRAY['vendor_finance']
    WHEN 'invoice_waiver' THEN ARRAY['vendor_finance']
    WHEN 'clinical_grant' THEN ARRAY['support','onboarding']
    WHEN 'dual_identity' THEN ARRAY['platform_owner','onboarding','support','vendor_finance']
    -- Undoing a suspension and closing a tenant are platform-owner decisions, approved by a
    -- second platform owner (PR-56 "by the platform owner with reason"; PR-57 maker-checker).
    WHEN 'reactivation' THEN ARRAY['platform_owner']
    WHEN 'closure' THEN ARRAY['platform_owner']
    END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.vendor_request_payload_ok(p_kind text, p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  RETURN coalesce(CASE p_kind
    WHEN 'suspension' THEN p = '{}'::jsonb
    WHEN 'exit' THEN p = '{}'::jsonb
    WHEN 'reactivation' THEN p = '{}'::jsonb
    WHEN 'closure' THEN p = '{}'::jsonb
    WHEN 'server_fee_change' THEN (SELECT count(*) FROM jsonb_object_keys(p)) = 2
      AND public.vendor_rupiah_ok(p -> 'amount_rupiah')
      AND (p ->> 'effective_month') ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    WHEN 'invoice_waiver' THEN (SELECT count(*) FROM jsonb_object_keys(p)) = 2
      AND (p ->> 'invoice_id') ~ uuid_re
      AND public.vendor_rupiah_ok(p -> 'amount_rupiah')
    WHEN 'clinical_grant' THEN (SELECT count(*) FROM jsonb_object_keys(p)) = 1 AND (p ->> 'staff_id') ~ uuid_re
    WHEN 'dual_identity' THEN (SELECT count(*) FROM jsonb_object_keys(p)) = 1 AND (p ->> 'account_id') ~ uuid_re
    END, false);
END
$$;--> statement-breakpoint

-- ── history ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_lifecycle_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER tenant_lifecycle_events_no_update BEFORE UPDATE OR DELETE ON public.tenant_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER tenant_lifecycle_events_no_truncate BEFORE TRUNCATE ON public.tenant_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.tenant_lifecycle_events ENABLE ALWAYS TRIGGER tenant_lifecycle_events_no_update;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.tenant_lifecycle_events', 'platform', 'vendor', '{}', 'tenant_lifecycle_transition (src/modules/vendor/lifecycle)', 'none');--> statement-breakpoint

-- The owner's notice on suspension, reactivation, exit and closure (PR-56), system-raised.
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('tenant_lifecycle', 'Status langganan klinik berubah', '{owner}', '{tenant_lifecycle}', false);--> statement-breakpoint

-- ── transition ──────────────────────────────────────────────────────────────────────────
-- Internal: the only writer of tenants_registry.lifecycle_state after provisioning, called
-- by the two entry points below (granted to nobody). Serialised per tenant (row lock).
-- p_request is the request consumed by the caller in this same call; p_actor names the
-- executing service or the vendor staff resolved from the session.
CREATE FUNCTION public.tenant_lifecycle_transition(p_tenant uuid, p_to text, p_reason text, p_request uuid,
                                                   p_actor_kind text, p_actor text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_from text;
  v_kind text;
  q public.vendor_requests;
  v_event uuid;
BEGIN
  SELECT lifecycle_state INTO v_from FROM public.tenants_registry WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: tenant not found' USING ERRCODE = 'P0002';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a transition needs a reason of 10–500 characters' USING ERRCODE = '22023';
  END IF;
  v_kind := CASE
    WHEN v_from = 'provisioning' AND p_to = 'onboarding' THEN '-'
    WHEN v_from = 'onboarding' AND p_to = 'live' THEN '-'
    WHEN v_from = 'live' AND p_to = 'suspended' THEN 'suspension'
    WHEN v_from = 'suspended' AND p_to = 'live' THEN 'reactivation'
    WHEN v_from IN ('live','suspended') AND p_to = 'exit' THEN 'exit'
    WHEN v_from = 'exit' AND p_to = 'closed' THEN 'closure' END;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: % → % is not a lifecycle step', v_from, coalesce(p_to, 'null') USING ERRCODE = '55000';
  END IF;
  IF v_kind = '-' THEN
    -- Onboarding steps are vendor staff actions (console), never a request.
    IF p_request IS NOT NULL OR p_actor_kind IS DISTINCT FROM 'vendor_staff'
       OR NOT EXISTS (SELECT 1 FROM public.vendor_staff v JOIN public.vendor_staff_roles r ON r.staff_id = v.id
                       WHERE v.id::text = p_actor AND v.state = 'active'
                         AND r.role IN (CASE WHEN p_to = 'onboarding' THEN 'onboarding' ELSE 'platform_owner' END, 'platform_owner')) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: this step is a vendor staff action' USING ERRCODE = '42501';
    END IF;
    -- TEN-12 / PRIV-8: no tenant data before the signed processor agreement is approved.
    IF p_to = 'onboarding' AND NOT coalesce((SELECT public.evidence_item_open(i.id) FROM public.evidence_items i
                                              WHERE i.tenant_id = p_tenant AND i.obligation_key = 'processor_agreement_signed'), false) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: the signed processor agreement is not approved' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT * INTO q FROM public.vendor_requests WHERE id = p_request FOR UPDATE;
    IF NOT FOUND OR q.kind <> v_kind OR q.tenant_id <> p_tenant OR q.state <> 'approved' OR q.consumed_at IS NULL
       OR p_actor_kind IS DISTINCT FROM 'service' OR p_actor IS NULL OR p_actor !~ '^[a-z][a-z_.-]{1,40}$'
       OR EXISTS (SELECT 1 FROM public.tenant_lifecycle_events e WHERE e.vendor_request_id = p_request) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: this step needs its approved request, consumed now' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.tenants_registry SET lifecycle_state = p_to WHERE id = p_tenant;
  -- A service actor is recorded as its name anchored to the database login (T-020).
  INSERT INTO public.tenant_lifecycle_events (tenant_id, from_state, to_state, reason, actor_kind, actor, vendor_request_id)
  VALUES (p_tenant, v_from, p_to, btrim(p_reason), p_actor_kind,
          CASE WHEN p_actor_kind = 'service' THEN public.vendor_service_name(p_actor) ELSE p_actor END, p_request);
  -- Platform event (ids only) and the owner's notice, in the tenant's own rows; a tenant
  -- still in provisioning has no tenants row yet for some fixtures, so both need it.
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant) THEN
    PERFORM set_config('app.tenant_id', p_tenant::text, true);
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload, staff_id, acting_role)
    VALUES (p_tenant, NULL, 'TenantLifecycleChanged', 'tenant_lifecycle', p_tenant,
            jsonb_build_object('from_state', v_from, 'to_state', p_to), NULL, NULL)
    RETURNING id INTO v_event;
    IF p_to IN ('suspended','exit','closed') OR v_from = 'suspended' AND p_to = 'live' THEN
      INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, source_event_id)
      VALUES (p_tenant, 'tenant_lifecycle', 'owner', NULL, 'tenant_lifecycle', p_tenant, v_event);
    END IF;
    PERFORM set_config('app.tenant_id', '', true);
  END IF;
  RETURN p_to;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_lifecycle_transition(uuid, text, text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- Worker entry point: lock the tenant, consume the approved request (vendor_request_consume
-- checks state, kind, tenant, expiry, approver) and apply its edge with the reason the
-- checker approved (the request's own reason), in one call. Refusals raise (the worker
-- records them with vendor_request_consume_refused after rolling back, T-020).
CREATE FUNCTION public.tenant_lifecycle_apply_request(p_request uuid, p_kind text, p_tenant uuid, p_service text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_to text := CASE p_kind WHEN 'suspension' THEN 'suspended' WHEN 'reactivation' THEN 'live' WHEN 'exit' THEN 'exit' WHEN 'closure' THEN 'closed' END;
  v_reason text;
BEGIN
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not a lifecycle request (not_found)' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants_registry WHERE id = p_tenant FOR UPDATE;
  PERFORM public.vendor_request_consume(p_request, p_kind, p_tenant, p_service);
  SELECT reason INTO STRICT v_reason FROM public.vendor_requests WHERE id = p_request;
  RETURN public.tenant_lifecycle_transition(p_tenant, v_to, v_reason, p_request, 'service', p_service);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_lifecycle_apply_request(uuid, text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tenant_lifecycle_apply_request(uuid, text, uuid, text) TO clinic_executor;--> statement-breakpoint

-- Console entry point for the onboarding steps (provisioning → onboarding: onboarding or
-- platform owner; onboarding → live: platform owner), bound to the vendor session token
-- and guarded like every console call (vendor_guard: active staff, TOTP within 10 minutes
-- for this step, allowlisted IP, role; refusals logged). The reason is the staff member's.
CREATE FUNCTION public.vendor_console_tenant_advance(p_token text, p_ip text, p_tenant uuid, p_to text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
BEGIN
  IF p_to NOT IN ('onboarding','live') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session');
  END IF;
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip,
    CASE WHEN p_to = 'onboarding' THEN ARRAY['onboarding','platform_owner'] ELSE ARRAY['platform_owner'] END,
    'tenant_' || p_to, p_tenant, p_tenant, v.second_factor_at, interval '10 minutes');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  PERFORM public.tenant_lifecycle_transition(p_tenant, p_to, p_reason, NULL, 'vendor_staff', g.staff_id::text);
  PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'tenant_' || p_to, p_tenant, p_tenant, 'success', NULL, p_ip);
  RETURN jsonb_build_object('ok', true, 'state', p_to);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_tenant_advance(text, text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_tenant_advance(text, text, uuid, text, text) TO clinic_vendor;--> statement-breakpoint

-- Lock order for lifecycle workers: the tenant row first, then the request (consume), then
-- the audit chain (vendor_log). Taking the tenant row before consume makes concurrent
-- workers on one tenant wait instead of deadlocking.
CREATE FUNCTION public.tenant_lifecycle_lock(p_tenant uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT NULL::void FROM public.tenants_registry WHERE id = p_tenant FOR UPDATE
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_lifecycle_lock(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tenant_lifecycle_lock(uuid) TO clinic_executor;--> statement-breakpoint

-- ── capability check (PR-56 effects) ───────────────────────────────────────────────────
-- Is p_capability allowed for the bound tenant in its current state? Unknown capabilities
-- are refused (fail closed). Later tasks call it (assertTenantCapability) before the action:
--   live only:          new_booking, public_site, marketing_message
--   live and suspended: existing_appointment, cashier, care_message, clinical_read,
--                       clinical_export, purpose_read, satusehat_outbox, record_correction,
--                       patient_copy, data_request
--   exit:               clinical_read, clinical_export, purpose_read, patient_copy, data_request
--   onboarding:         configuration (synthetic data only, ARCH-10; later tasks)
--   provisioning, closed: nothing
CREATE FUNCTION public.tenant_capability(p_capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((
    SELECT CASE r.lifecycle_state
      WHEN 'live' THEN p_capability IN ('new_booking','public_site','marketing_message','existing_appointment','cashier','care_message',
                                        'clinical_read','clinical_export','purpose_read','satusehat_outbox','record_correction',
                                        'patient_copy','data_request','configuration')
      WHEN 'suspended' THEN p_capability IN ('existing_appointment','cashier','care_message','clinical_read','clinical_export',
                                             'purpose_read','satusehat_outbox','record_correction','patient_copy','data_request')
      WHEN 'exit' THEN p_capability IN ('clinical_read','clinical_export','purpose_read','patient_copy','data_request')
      WHEN 'onboarding' THEN p_capability IN ('configuration')
      ELSE false END
      FROM public.tenants_registry r WHERE r.id = public.app_tenant_id()), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_capability(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tenant_capability(text) TO clinic_app;--> statement-breakpoint

-- The bound tenant's state and the reason of its last transition (for a banner such as
-- "Klinik ditangguhkan: …"); owners only see the reason.
CREATE FUNCTION public.tenant_lifecycle_status() RETURNS TABLE (state text, since timestamptz, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT r.lifecycle_state, e.at, CASE WHEN public.app_acting_role() = 'owner' THEN e.reason END
    FROM public.tenants_registry r
    LEFT JOIN LATERAL (SELECT * FROM public.tenant_lifecycle_events x WHERE x.tenant_id = r.id ORDER BY x.seq DESC LIMIT 1) e ON true
   WHERE r.id = public.app_tenant_id()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_lifecycle_status() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.tenant_lifecycle_status() TO clinic_app;
