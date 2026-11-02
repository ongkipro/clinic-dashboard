-- T-003 RLS foundation (TEN-2, TEN-3, TEN-19).
--
-- clinic_app is the NOLOGIN group role the application runs under. The deployment
-- creates one LOGIN role per environment that is a member of clinic_app only and grants
-- it CONNECT on that environment's database; src/db/rls/pool.ts (openAppPool) refuses
-- any connection whose login could bypass RLS. Roles are cluster-wide: this migration
-- creates clinic_app with default (safe) attributes if missing, never alters it, and
-- fails if an existing clinic_app is unsafe. Creating it needs CREATEROLE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'clinic_app') THEN
    BEGIN
      CREATE ROLE clinic_app NOLOGIN;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL; -- created concurrently by another database's migration
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'clinic_app'
             AND (rolsuper OR rolbypassrls OR rolreplication OR rolcreaterole OR rolcreatedb
                  OR rolcanlogin)) THEN
    RAISE EXCEPTION 'role clinic_app exists with unsafe attributes; fix it as a superuser';
  END IF;
END
$$;--> statement-breakpoint

-- No login reaches this database through PUBLIC; each environment grants CONNECT to its
-- own app login, so a login of another environment on the same cluster cannot connect.
DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
-- Functions created later by the migration role are not executable by PUBLIC, so a
-- SECURITY DEFINER function (TEN-16) is reachable only through an explicit grant.
-- Default privileges bind to the role running this statement: every migration must run
-- as the same migration role (DEC-007), and each SECURITY DEFINER function still
-- revokes PUBLIC explicitly.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO clinic_app;--> statement-breakpoint

-- Tenant context accessor. A missing or empty setting yields NULL, so every policy
-- fails closed outside withTenantContext(). Schema-qualified instead of SET search_path
-- so the planner can inline it into policies.
CREATE FUNCTION public.app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::pg_catalog.uuid
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_tenant_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_tenant_id() TO clinic_app;--> statement-breakpoint

-- Deny by default: RLS on every table, including platform tables, which get no
-- policy and no grant (security-definer functions only, TEN-16).
ALTER TABLE public.tenants_registry ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.scope_map ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- tenants is the tenant root (its id is the tenant id); members read their own row.
CREATE POLICY tenants_read ON public.tenants FOR SELECT TO clinic_app
  USING (id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.tenants TO clinic_app;--> statement-breakpoint

-- branches: tenant-shared. Write paths, role readers (TEN-18) and branch scope arrive
-- with the tasks that own them.
CREATE POLICY branches_read ON public.branches FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.branches TO clinic_app;--> statement-breakpoint

-- Keys are `schema.table` (see src/db/scope-map.ts).
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.tenants_registry', 'platform', 'vendor', '{}', 'platform operator', 'none'),
  ('public.scope_map', 'platform', 'db', '{}', 'migrations', 'none'),
  ('public.tenants', 'tenant-shared', 'org', '{*}', 'platform operator', 'tenant root: id is the tenant id'),
  ('public.branches', 'tenant-shared', 'org', '{*}', 'org', 'is the branch');
