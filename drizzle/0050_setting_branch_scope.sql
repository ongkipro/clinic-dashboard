-- HYG-009 N2 (DEC-026; foundation review lane B2 N2): an Owner or other tenant-wide role with a
-- branch selected changes branch and tenant values exactly as without one. setting_set is its latest
-- definition (0048) with only its two branch checks changed: they apply to Level 3 acting roles
-- (tenant_actor_lock's list) instead of to any context with a branch. Which rows a role may change
-- or draft (changers, drafts) is unchanged. tests/db/setting-scope-drift.test.ts checks the diff.
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
  -- (branch null) is for tenant-wide roles only. HYG-009 N2: the checks follow the acting
  -- role's level (the Level 3 list of tenant_actor_lock), not whether a branch is selected,
  -- so a tenant-wide role with a branch selected keeps exactly its rights without one (DEC-026).
  IF p_branch IS NOT NULL AND a.role IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist') AND p_branch IS DISTINCT FROM a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: outside the acting role''s branch' USING ERRCODE = '42501';
  END IF;
  IF p_branch IS NULL AND a.role IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist') AND d.scope = 'branch' THEN
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
;
