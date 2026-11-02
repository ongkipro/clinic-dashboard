-- T-007: org_actions is insert-only for clinic_app, and every inserted row must carry
-- the bound context: the caller's tenant, staff, acting role and active branch, an acting role the
-- staff really holds in an active membership, and an active branch inside that role's
-- scope. Explicit values that differ are refused (WITH CHECK).
ALTER TABLE public.org_actions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_actions_read ON public.org_actions FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
CREATE POLICY org_actions_insert ON public.org_actions FOR INSERT TO clinic_app
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
         AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())
         AND (org_actions.active_branch_id IS NULL
              OR r.role IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor')
              OR EXISTS (SELECT 1 FROM public.staff_branches b
                          WHERE b.tenant_id = r.tenant_id AND b.staff_role_id = r.id
                            AND b.branch_id = org_actions.active_branch_id))
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT ON public.org_actions TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.org_actions', 'tenant-shared', 'org', '{*}', 'org (context)', 'active branch of the action');
