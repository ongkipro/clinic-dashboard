-- HYG-014 (PR-59, TEN-12, PRIV-8; owner decision DEC-045, from the T-032 R4 review): go-live re-checks
-- the processor agreement. tenant_go_live_blockers is its live definition at 0052 with one block added
-- (tests/db/agreement-go-live-drift.test.ts); signature, volatility, SECURITY DEFINER, search_path and
-- grants are unchanged (CREATE OR REPLACE keeps the ACL). tenant_lifecycle_transition (onboarding ->
-- live) and the console checklist read this function, so both see the new blocker.
CREATE OR REPLACE FUNCTION public.tenant_go_live_blockers(p_tenant uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT coalesce((SELECT array_agg(x ORDER BY o, k) FROM (
    -- HYG-014 (PR-59, DEC-045): the signed processor agreement, checked when onboarding started, is
    -- checked again here: revoked, replaced by an unapproved file or expired since, it blocks go-live
    -- and is named first.
    SELECT 0 AS o, '' AS k, 'agreement:processor_agreement_signed' AS x
     WHERE NOT coalesce((SELECT public.evidence_item_open(i.id) FROM public.evidence_items i
                          WHERE i.tenant_id = p_tenant AND i.obligation_key = 'processor_agreement_signed'), false)
    UNION ALL
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
$function$
;
