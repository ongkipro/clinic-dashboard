-- HYG-016 (owner 2026-11-13, option A): one clock read per operation. Each function below is its latest
-- definition (vendor_console_support_open 0049, media_token_issue 0072, stock_vial_open_do 0078) with the
-- two clock_timestamp() reads of one row replaced by one v_now, assigned in the body after the locks
-- (DEC-043). Two reads could land a microsecond apart: a 600 s media token then broke media_tokens_check
-- (expires_at <= issued_at + 10 minutes), and a vial's use_by - opened_at was 24 h + 1 us. CREATE OR
-- REPLACE keeps signature, attributes and grants (tests/db/one-clock-drift.test.ts).
CREATE OR REPLACE FUNCTION public.vendor_console_support_open(p_token text, p_ip text, p_tenant uuid, p_purpose text, p_scope text[], p_minutes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c record;
  v_scope text[];
  v_reason text;
  v_needs_owner boolean;
  v_id uuid;
  v_now timestamptz;
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
    -- HYG-008b: authority re-read after the last wait, before this exit.
    PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '10 minutes');
    RETURN jsonb_build_object('ok', false, 'code', CASE v_reason WHEN 'not_found' THEN 'ERR_NOT_FOUND' WHEN 'invalid_input' THEN 'ERR_INVALID_INPUT' ELSE 'ERR_FORBIDDEN' END, 'reason', v_reason);
  END IF;
  v_now := clock_timestamp(); -- HYG-016: one clock read; activated_at and ends_at share it
  v_needs_owner := EXISTS (SELECT 1 FROM public.support_object_kinds k WHERE k.table_name = ANY (v_scope) AND k.support_class IN ('personal','clinical'));
  INSERT INTO public.support_sessions (tenant_id, opened_by, purpose, scope, minutes, state, activated_at, ends_at)
  VALUES (p_tenant, c.staff_id, btrim(p_purpose), v_scope, p_minutes,
          CASE WHEN v_needs_owner THEN 'pending_approval' ELSE 'active' END,
          CASE WHEN v_needs_owner THEN NULL ELSE v_now END,
          CASE WHEN v_needs_owner THEN NULL ELSE v_now + make_interval(mins => p_minutes) END)
  RETURNING id INTO v_id;
  PERFORM public.vendor_log(c.staff_id, c.account_id, c.role, 'support_open', p_tenant, v_id, 'success',
                            CASE WHEN v_needs_owner THEN 'awaiting_owner' ELSE 'active' END, p_ip);
  -- HYG-008b: authority re-read after the last wait, before this exit.
  PERFORM public.vendor_authority_recheck(p_token, p_ip, ARRAY['support','onboarding','platform_owner'], interval '10 minutes');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'state', CASE WHEN v_needs_owner THEN 'pending_approval' ELSE 'active' END);
END
$function$
;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.media_token_issue(p_media uuid, p_purpose text, p_token_hash text, p_ttl_seconds integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  m public.clinical_media;
  t public.media_tokens;
  v_now timestamptz;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('doctor','nurse','therapist','facility_head','records_officer','bc') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read clinical media' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: clinical reads are not available' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_purpose, '') NOT IN ('view','download') OR coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
     OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: token' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.clinical_media x WHERE x.tenant_id = a.tenant_id AND x.id = p_media;
  IF NOT FOUND OR m.removed_at IS NOT NULL OR NOT public.media_readable(m.tenant_id, m.branch_id, m.kind) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: media not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := clock_timestamp(); -- HYG-016: one clock read, after tenant_actor_lock(); issued_at and expires_at share it
  INSERT INTO public.media_tokens (tenant_id, branch_id, media_id, staff_id, acting_role, token_hash, purpose, issued_at, expires_at)
  VALUES (m.tenant_id, m.branch_id, m.id, a.staff_id, a.role, p_token_hash, p_purpose, v_now, v_now + make_interval(secs => p_ttl_seconds))
  RETURNING * INTO t;
  PERFORM public.audit_append('clinical_read', 'clinical_media', m.id, 'success', 'media_token_issued');
  RETURN jsonb_build_object('token_id', t.id, 'expires_at', t.expires_at);
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.stock_vial_open_do(p_tenant uuid, p_branch uuid, p_staff uuid, p_role text, p_batch uuid, p_depot uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.stock_batches;
  i public.stock_items;
  v public.opened_vials;
  v_held numeric;
  v_id uuid;
  v_now timestamptz;
BEGIN
  SELECT * INTO b FROM public.stock_batches x WHERE x.tenant_id = p_tenant AND x.id = p_batch FOR UPDATE;
  IF NOT FOUND OR b.branch_id <> p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = p_tenant AND d.branch_id = p_branch AND d.id = p_depot) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO i FROM public.stock_items x WHERE x.tenant_id = b.tenant_id AND x.id = b.item_id;
  IF i.vial_size IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: not a vial item' USING ERRCODE = '22023';
  END IF;
  IF public.stock_unfit_reason(b) IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_STOCK_UNFIT: %', public.stock_unfit_reason(b) USING ERRCODE = 'P0422';
  END IF;
  SELECT h.quantity INTO v_held FROM public.batch_holdings h WHERE h.tenant_id = p_tenant AND h.depot_id = p_depot AND h.batch_id = b.id FOR UPDATE;
  SELECT * INTO v FROM public.opened_vials x WHERE x.tenant_id = b.tenant_id AND x.batch_id = b.id AND x.depot_id = p_depot AND x.state = 'open' FOR UPDATE;
  v_now := clock_timestamp(); -- HYG-016: one clock read, after the row locks; closed_at, opened_at and use_by share it
  IF FOUND THEN
    IF public.stock_vial_unfit(v) IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a vial of this batch is already open' USING ERRCODE = '55000';
    END IF;
    UPDATE public.opened_vials SET state = 'lapsed', closed_at = v_now WHERE tenant_id = v.tenant_id AND id = v.id;
  END IF;
  IF coalesce(v_held, 0) <= 0 THEN
    RAISE EXCEPTION 'ERR_STOCK_INSUFFICIENT: the batch is empty' USING ERRCODE = 'P0422';
  END IF;
  INSERT INTO public.opened_vials (tenant_id, branch_id, batch_id, depot_id, opened_by, opened_as, opened_at, use_by, remaining)
  VALUES (b.tenant_id, b.branch_id, b.id, p_depot, p_staff, p_role, v_now, v_now + make_interval(hours => i.opened_use_hours), least(i.vial_size, v_held))
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'opened_vial', v_id, 'success', 'stock_vial_opened');
  RETURN v_id;
END
$$;
