CREATE TABLE "onboarding_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"item" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"owner_staff" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_checklist_items_tenant_branch_item_key" UNIQUE NULLS NOT DISTINCT("tenant_id","branch_id","item"),
	CONSTRAINT "onboarding_checklist_items_item_check" CHECK (("onboarding_checklist_items"."branch_id" is null and "onboarding_checklist_items"."item" in ('entity_tax','catalog','staff_credentials','money_settings','payment_port','waba','satusehat')) or ("onboarding_checklist_items"."branch_id" is not null and "onboarding_checklist_items"."item" = 'branch_setup')),
	CONSTRAINT "onboarding_checklist_items_status_check" CHECK ("onboarding_checklist_items"."status" in ('open','done','not_applicable')),
	CONSTRAINT "onboarding_checklist_items_na_check" CHECK ("onboarding_checklist_items"."status" <> 'not_applicable' or ("onboarding_checklist_items"."item" in ('payment_port','waba','satusehat') and length(btrim(coalesce("onboarding_checklist_items"."note", ''))) between 3 and 500)),
	CONSTRAINT "onboarding_checklist_items_note_check" CHECK ("onboarding_checklist_items"."note" is null or length("onboarding_checklist_items"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ADD CONSTRAINT "onboarding_checklist_items_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ADD CONSTRAINT "onboarding_checklist_items_owner_staff_vendor_staff_id_fk" FOREIGN KEY ("owner_staff") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ADD CONSTRAINT "onboarding_checklist_items_updated_by_vendor_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ADD CONSTRAINT "onboarding_checklist_items_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;;--> statement-breakpoint

-- T-027 functions (generated from live definitions; see header)
-- T-027 (PR-59, UX-41, DATA-48, TEN-16): onboarding checklist per tenant and branch, and the go-live gate.
-- Platform table: no application role reads or writes it; the vendor console reaches it through
-- vendor_console_checklist / vendor_console_checklist_set (vendor_guard, HYG-008b re-check before every
-- exit after the guard). Re-created bodies are their live definitions at 0050 with only the lines named
-- in their comments changed; tests/db/checklist-drift.test.ts checks the diff.
ALTER TABLE public.onboarding_checklist_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.onboarding_checklist_items', 'platform', 'vendor', '{}', 'onboarding checklist functions (src/modules/vendor/checklist)', 'none');--> statement-breakpoint

-- Items are never deleted; only status, note and owner change (and the row's own update stamp).
CREATE FUNCTION public.onboarding_checklist_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'onboarding checklist items are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.item <> OLD.item THEN
    RAISE EXCEPTION 'an onboarding checklist item keeps its tenant, branch and item' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_checklist_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER onboarding_checklist_guard BEFORE UPDATE OR DELETE ON public.onboarding_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_checklist_guard();--> statement-breakpoint
ALTER TABLE public.onboarding_checklist_items ENABLE ALWAYS TRIGGER onboarding_checklist_guard;--> statement-breakpoint
CREATE TRIGGER onboarding_checklist_no_truncate BEFORE TRUNCATE ON public.onboarding_checklist_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Seeding: entering onboarding creates every tenant item and one branch_setup per existing branch;
-- a branch added while the tenant is onboarding gets its item. Idempotent (ON CONFLICT DO NOTHING).
CREATE FUNCTION public.onboarding_checklist_seed(p_tenant uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO public.onboarding_checklist_items (tenant_id, branch_id, item)
  SELECT p_tenant, NULL, k FROM unnest(array['entity_tax','catalog','staff_credentials','money_settings','payment_port','waba','satusehat']) k
  UNION ALL
  SELECT p_tenant, b.id, 'branch_setup' FROM public.branches b WHERE b.tenant_id = p_tenant
  ON CONFLICT (tenant_id, branch_id, item) DO NOTHING
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_checklist_seed(uuid) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.onboarding_checklist_follow_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.to_state = 'onboarding' THEN
    PERFORM public.onboarding_checklist_seed(NEW.tenant_id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_checklist_follow_lifecycle() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER tenant_lifecycle_events_onboarding_checklist AFTER INSERT ON public.tenant_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_checklist_follow_lifecycle();--> statement-breakpoint
ALTER TABLE public.tenant_lifecycle_events ENABLE ALWAYS TRIGGER tenant_lifecycle_events_onboarding_checklist;--> statement-breakpoint
-- Review round 1 (P1): the state is read under the lifecycle's locks, in its order (staff_access, then
-- the registry row), so a branch inserted while the tenant enters onboarding is either seen by the
-- lifecycle seed (this transaction committed first) or seeds itself after the transition commits; and a
-- branch racing go-live is either a blocker the gate sees or is inserted after the tenant is live.
CREATE FUNCTION public.onboarding_checklist_follow_branch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_state text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  SELECT lifecycle_state INTO v_state FROM public.tenants_registry WHERE id = NEW.tenant_id FOR SHARE;
  IF v_state = 'onboarding' THEN
    INSERT INTO public.onboarding_checklist_items (tenant_id, branch_id, item) VALUES (NEW.tenant_id, NEW.id, 'branch_setup')
      ON CONFLICT (tenant_id, branch_id, item) DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.onboarding_checklist_follow_branch() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER branches_onboarding_checklist AFTER INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_checklist_follow_branch();--> statement-breakpoint
ALTER TABLE public.branches ENABLE ALWAYS TRIGGER branches_onboarding_checklist;--> statement-breakpoint
-- Tenants already in onboarding when this migration runs get their items now.
SELECT public.onboarding_checklist_seed(r.id) FROM public.tenants_registry r WHERE r.lifecycle_state = 'onboarding';--> statement-breakpoint

-- Go-live blockers in a fixed order (the first is named by a refusal): open checklist items (tenant
-- items, then branch items by branch code), the vendor profile's production blockers (incl. fewer
-- than two TOTP-enrolled vendor staff, vendor_staff_maker_checker), then every clinical_go_live
-- obligation (PR-97 / Q-07) whose evidence is not open for this tenant.
CREATE FUNCTION public.tenant_go_live_blockers(p_tenant uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT array_agg(x ORDER BY o, k) FROM (
    SELECT 1 AS o, CASE WHEN c.branch_id IS NULL THEN 0 ELSE 1 END || ':' || coalesce(b.code, '') || ':' || c.item AS k,
           'checklist:' || c.item || coalesce('@' || b.code, '') AS x
      FROM public.onboarding_checklist_items c LEFT JOIN public.branches b ON b.tenant_id = c.tenant_id AND b.id = c.branch_id
     WHERE c.tenant_id = p_tenant AND c.status = 'open'
    UNION ALL
    SELECT 1, '9', 'checklist:not_seeded' WHERE NOT EXISTS (SELECT 1 FROM public.onboarding_checklist_items c WHERE c.tenant_id = p_tenant)
    UNION ALL
    SELECT 2, lpad(n::text, 4, '0'), 'vendor:' || v FROM unnest(public.vendor_go_live_blockers()) WITH ORDINALITY AS u(v, n)
    UNION ALL
    SELECT 3, g.obligation_key, 'clinical:' || g.obligation_key
      FROM public.feature_gates g
     WHERE g.key = 'clinical_go_live'
       AND NOT CASE (SELECT scope FROM public.compliance_obligations WHERE key = g.obligation_key)
             WHEN 'vendor' THEN public.vendor_evidence_open(g.obligation_key)
             WHEN 'tenant' THEN coalesce((SELECT public.evidence_item_open(i.id) FROM public.evidence_items i
                                           WHERE i.tenant_id = p_tenant AND i.obligation_key = g.obligation_key), false)
             ELSE false END
  ) q), '{}')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_go_live_blockers(uuid) FROM PUBLIC;--> statement-breakpoint

-- Go-live date (PR-59 → PR-61 billing start): the first onboarding → live transition.
CREATE FUNCTION public.tenant_go_live_at(p_tenant uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT min(e.at) FROM public.tenant_lifecycle_events e
   WHERE e.tenant_id = p_tenant AND e.from_state = 'onboarding' AND e.to_state = 'live'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_go_live_at(uuid) FROM PUBLIC;--> statement-breakpoint
-- tenant_lifecycle_transition: onboarding -> live refused while a go-live blocker exists (PR-59)
CREATE OR REPLACE FUNCTION public.tenant_lifecycle_transition(p_tenant uuid, p_to text, p_reason text, p_request uuid, p_actor_kind text, p_actor text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_from text;
  v_kind text;
  q public.vendor_requests;
  v_event uuid;
  v_blockers text[];
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
    -- T-027 (PR-59): go-live needs every blocking checklist item, the vendor profile and the
    -- clinical go-live evidence; the refusal names the first blocker. Judged after the tenant row
    -- lock above, so a concurrent checklist change is either seen or waits.
    IF v_from = 'onboarding' AND p_to = 'live' THEN
      v_blockers := public.tenant_go_live_blockers(p_tenant);
      IF cardinality(v_blockers) > 0 THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: go_live_blocked:%', v_blockers[1] USING ERRCODE = '42501';
      END IF;
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
$function$
;--> statement-breakpoint
-- vendor_console_tenant_advance: a go-live refusal names its blocker (reason go_live_blocked, blocker)
CREATE OR REPLACE FUNCTION public.vendor_console_tenant_advance(p_token text, p_ip text, p_tenant uuid, p_to text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  w record;
  v_action text := CASE WHEN p_to IN ('onboarding','live') THEN 'tenant_' || p_to ELSE 'tenant_advance' END;
  v_reason text;
  v_blocker text;
BEGIN
  -- staff_access before anything that can log or lock the tenant row (see
  -- tenant_lifecycle_lock): the guard's refusal log takes the audit lock.
  IF public.vendor_session_valid(p_token) AND p_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || p_tenant::text, 0));
  END IF;
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip,
    CASE WHEN p_to = 'live' THEN ARRAY['platform_owner'] ELSE ARRAY['onboarding','platform_owner'] END, v_action, p_tenant);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  IF p_to IS NULL OR p_to NOT IN ('onboarding','live') OR p_tenant IS NULL THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, v_action, p_tenant, p_tenant, 'denied', 'invalid_input', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, CASE WHEN p_to = 'live' THEN ARRAY['platform_owner'] ELSE ARRAY['onboarding','platform_owner'] END, interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  BEGIN
    PERFORM public.tenant_lifecycle_transition(p_tenant, p_to, p_reason, NULL, 'vendor_staff', w.staff_id::text);
  EXCEPTION
    WHEN SQLSTATE '42501' OR SQLSTATE '55000' OR SQLSTATE '22023' OR SQLSTATE 'P0002' THEN
      v_reason := CASE
        WHEN SQLERRM LIKE '%processor agreement%' THEN 'processor_agreement'
        WHEN SQLERRM LIKE '%go_live_blocked:%' THEN 'go_live_blocked'
        WHEN SQLSTATE = '55000' THEN 'not_a_step'
        WHEN SQLSTATE = '22023' THEN 'invalid_input'
        WHEN SQLSTATE = 'P0002' THEN 'not_found'
        ELSE 'not_allowed' END;
      v_blocker := CASE WHEN v_reason = 'go_live_blocked' THEN substring(SQLERRM from 'go_live_blocked:([a-z_]+:[a-z_:]+(@[A-Za-z0-9-]+)?)') END;
      PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, v_action, p_tenant, p_tenant, 'denied', v_reason, p_ip);
      -- HYG-008b: authority re-read after the last wait, before this exit.
      PERFORM public.vendor_authority_recheck(p_token, p_ip, CASE WHEN p_to = 'live' THEN ARRAY['platform_owner'] ELSE ARRAY['onboarding','platform_owner'] END, interval '10 minutes');
      RETURN jsonb_build_object('ok', false,
        'code', CASE v_reason WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'not_a_step' THEN 'ERR_VERSION_CONFLICT' ELSE 'ERR_FORBIDDEN' END,
        'reason', v_reason, 'blocker', v_blocker);
  END;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, v_action, p_tenant, p_tenant, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, CASE WHEN p_to = 'live' THEN ARRAY['platform_owner'] ELSE ARRAY['onboarding','platform_owner'] END, interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'state', p_to);
END
$function$
;--> statement-breakpoint

-- Konsol Vendor › Onboarding (UX-41): the checklist of one tenant, its go-live blockers and date.
-- Reader for every vendor role (as tenant detail); no clinic data (item keys, status, vendor notes).
CREATE FUNCTION public.vendor_console_checklist(p_token text, p_ip text, p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_resp jsonb;
  g record;
BEGIN
  SELECT * INTO g FROM public.vendor_console_guard(p_token, p_ip, 'console_checklist');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner','onboarding','support','vendor_finance','vendor_auditor'], interval '12 hours');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  v_resp := jsonb_build_object('ok', true,
    'id', p_tenant,
    'state', (SELECT lifecycle_state FROM public.tenants_registry WHERE id = p_tenant),
    'name', (SELECT legal_name FROM public.tenants WHERE id = p_tenant),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
                         'item', c.item, 'branch_id', c.branch_id, 'branch_code', b.code, 'branch_name', b.name,
                         'status', c.status, 'note', c.note, 'owner_id', c.owner_staff, 'owner', o.display_name,
                         'updated_by', u.display_name, 'updated_at', c.updated_at)
                         ORDER BY (c.branch_id IS NOT NULL), b.code, c.item)
                         FROM public.onboarding_checklist_items c
                         LEFT JOIN public.branches b ON b.tenant_id = c.tenant_id AND b.id = c.branch_id
                         LEFT JOIN public.vendor_staff o ON o.id = c.owner_staff
                         LEFT JOIN public.vendor_staff u ON u.id = c.updated_by
                        WHERE c.tenant_id = p_tenant), '[]'::jsonb),
    'blockers', to_jsonb(public.tenant_go_live_blockers(p_tenant)),
    'go_live_at', public.tenant_go_live_at(p_tenant),
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'name', v.display_name) ORDER BY v.display_name)
                         FROM public.vendor_staff v WHERE v.state = 'active'
                          AND EXISTS (SELECT 1 FROM public.vendor_staff_roles r WHERE r.staff_id = v.id AND r.role IN ('onboarding','platform_owner'))), '[]'::jsonb),
    'my_roles', (SELECT jsonb_agg(r.role ORDER BY r.role) FROM public.vendor_staff_roles r WHERE r.staff_id = g.staff_id));
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['platform_owner','onboarding','support','vendor_finance','vendor_auditor'], interval '12 hours');
  RETURN v_resp;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_checklist(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_checklist(text, text, uuid) TO clinic_vendor;--> statement-breakpoint

-- Konsol Vendor › Onboarding: set one item's status, note and owner (onboarding or platform owner,
-- tenant in onboarding). The tenant row is locked like a lifecycle step, so a set never interleaves
-- with Tandai Siap Live; staff_access first (the lifecycle lock order, 0044).
CREATE FUNCTION public.vendor_console_checklist_set(p_token text, p_ip text, p_tenant uuid, p_branch uuid, p_item text,
                                                    p_status text, p_note text, p_owner uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  w record;
  v_state text;
  v_id uuid;
BEGIN
  IF public.vendor_session_valid(p_token) AND p_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants_registry WHERE id = p_tenant) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || p_tenant::text, 0));
  END IF;
  SELECT * INTO w FROM public.vendor_console_writer(p_token, p_ip, ARRAY['onboarding','platform_owner'], 'checklist_set', p_tenant);
  IF w.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', w.refusal);
  END IF;
  SELECT lifecycle_state INTO v_state FROM public.tenants_registry WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'checklist_set', NULL, NULL, 'denied', 'not_found', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  SELECT c.id INTO v_id FROM public.onboarding_checklist_items c
   WHERE c.tenant_id = p_tenant AND c.branch_id IS NOT DISTINCT FROM p_branch AND c.item = p_item FOR UPDATE;
  IF v_id IS NULL THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'checklist_set', p_tenant, p_tenant, 'denied', 'not_found', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_NOT_FOUND');
  END IF;
  IF v_state <> 'onboarding' THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'checklist_set', p_tenant, v_id, 'denied', 'not_onboarding', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_VERSION_CONFLICT', 'reason', 'not_onboarding');
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('open','done','not_applicable')
     OR (p_status = 'not_applicable' AND (p_item NOT IN ('payment_port','waba','satusehat') OR length(btrim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 500))
     OR length(coalesce(p_note, '')) > 500
     OR (p_owner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vendor_staff v JOIN public.vendor_staff_roles r ON r.staff_id = v.id
                                             WHERE v.id = p_owner AND v.state = 'active' AND r.role IN ('onboarding','platform_owner'))) THEN
    PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'checklist_set', p_tenant, v_id, 'denied', 'invalid_input', p_ip);
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_INVALID_INPUT');
  END IF;
  UPDATE public.onboarding_checklist_items
     SET status = p_status, note = nullif(btrim(coalesce(p_note, '')), ''), owner_staff = p_owner, updated_by = w.staff_id, updated_at = now()
   WHERE id = v_id;
  PERFORM public.vendor_log(w.staff_id, w.account_id, w.role, 'checklist_set', p_tenant, v_id, 'success', NULL, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['onboarding','platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_checklist_set(text, text, uuid, uuid, text, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_checklist_set(text, text, uuid, uuid, text, text, text, uuid) TO clinic_vendor;
