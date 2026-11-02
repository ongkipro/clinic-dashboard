-- T-007: RLS and the one cross-tenant lookup of the identity chain.
--
-- memberships, staff, staff_roles, staff_branches are tenant-shared: a member reads its
-- own tenant's rows (role readers arrive with T-029). Writes go through the org service
-- (invitations, T-022/T-031) and are not granted to clinic_app yet.
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.staff_branches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY memberships_read ON public.memberships FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
CREATE POLICY staff_read ON public.staff FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
CREATE POLICY staff_roles_read ON public.staff_roles FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
CREATE POLICY staff_branches_read ON public.staff_branches FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.memberships, public.staff, public.staff_roles, public.staff_branches
  TO clinic_app;--> statement-breakpoint

-- ARCH-8: before a tenant context exists, the server must learn which memberships an
-- authenticated account holds. This SECURITY DEFINER function returns ids and role
-- keys only, for one account, for active memberships. Callers pass the account id that
-- Better Auth resolved from the session cookie; the function itself trusts nothing else.
-- Caller: clinic_app (context selection and the T-006 TOTP gate's RoleSource).
CREATE FUNCTION public.account_memberships(p_account_id uuid)
RETURNS TABLE (tenant_id uuid, membership_id uuid, staff_id uuid, role text, branch_ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.tenant_id, m.id, s.id, r.role,
         CASE WHEN r.role IN ('manager','facility_head','records_officer','fo_cashier','bc',
                              'doctor','nurse','therapist','pharmacist')
              THEN COALESCE((SELECT array_agg(b.branch_id ORDER BY b.branch_id)
                               FROM public.staff_branches b
                              WHERE b.tenant_id = r.tenant_id AND b.staff_role_id = r.id), '{}')
              ELSE NULL END
    FROM public.memberships m
    JOIN public.staff s ON s.tenant_id = m.tenant_id AND s.membership_id = m.id
    JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id
   WHERE m.account_id = p_account_id
     AND m.effective_from <= now()
     AND (m.effective_to IS NULL OR m.effective_to > now())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_memberships(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.account_memberships(uuid) TO clinic_app;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.memberships', 'tenant-shared', 'org', '{*}', 'org (invitations)', 'none'),
  ('public.staff', 'tenant-shared', 'org', '{*}', 'org (invitations)', 'none'),
  ('public.staff_roles', 'tenant-shared', 'org', '{*}', 'org (access)', 'none'),
  ('public.staff_branches', 'tenant-shared', 'org', '{*}', 'org (access)', 'branch scope of a Level 3 role');
--> statement-breakpoint

-- IAM-3 / DATA-60: the acting role and staff of the current transaction, bound by
-- withTenantContext from a context resolved server-side (resolveContext). app.roles
-- holds exactly the acting role. Tables that record who acted use these as column
-- defaults, so the client can never supply them (T-008 builds audit_events on them).
CREATE FUNCTION public.app_staff_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.staff_id', true), '')::pg_catalog.uuid
$$;--> statement-breakpoint
CREATE FUNCTION public.app_acting_role() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN pg_catalog.strpos(pg_catalog.current_setting('app.roles', true), ',') > 0
              THEN NULL -- more than one role bound: no single acting role, refuse to attribute
              ELSE NULLIF(pg_catalog.current_setting('app.roles', true), '') END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_staff_id(), public.app_acting_role() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_staff_id(), public.app_acting_role() TO clinic_app;
