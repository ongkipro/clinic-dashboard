-- T-006: Better Auth runs under its own NOLOGIN group role `clinic_auth` (same safety
-- rules as clinic_app, DEC-007). It reads and writes only the auth_* tables, which are
-- global login data, not tenant rows (policy kind `platform`). clinic_app gets nothing
-- on them, and clinic_auth gets nothing on tenant tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'clinic_auth') THEN
    BEGIN
      CREATE ROLE clinic_auth NOLOGIN;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'clinic_auth'
             AND (rolsuper OR rolbypassrls OR rolreplication OR rolcreaterole OR rolcreatedb
                  OR rolcanlogin)) THEN
    RAISE EXCEPTION 'role clinic_auth exists with unsafe attributes; fix it as a superuser';
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO clinic_auth;--> statement-breakpoint

-- RLS on (deny by default for every other role); clinic_auth gets an explicit all-rows
-- policy because these tables carry no tenant.
ALTER TABLE public.auth_user ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.auth_session ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.auth_account ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.auth_verification ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.auth_two_factor ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.auth_rate_limit ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.auth_login_failure ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auth_user_all ON public.auth_user TO clinic_auth USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY auth_session_all ON public.auth_session TO clinic_auth USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY auth_account_all ON public.auth_account TO clinic_auth USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY auth_verification_all ON public.auth_verification TO clinic_auth USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY auth_two_factor_all ON public.auth_two_factor TO clinic_auth USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY auth_rate_limit_all ON public.auth_rate_limit TO clinic_auth USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY auth_login_failure_all ON public.auth_login_failure TO clinic_auth USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_user, public.auth_session,
  public.auth_account, public.auth_verification, public.auth_two_factor,
  public.auth_rate_limit, public.auth_login_failure TO clinic_auth;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.auth_user', 'platform', 'auth', '{}', 'auth (clinic_auth)', 'none'),
  ('public.auth_session', 'platform', 'auth', '{}', 'auth (clinic_auth)', 'none'),
  ('public.auth_account', 'platform', 'auth', '{}', 'auth (clinic_auth)', 'none'),
  ('public.auth_verification', 'platform', 'auth', '{}', 'auth (clinic_auth)', 'none'),
  ('public.auth_two_factor', 'platform', 'auth', '{}', 'auth (clinic_auth)', 'none'),
  ('public.auth_rate_limit', 'platform', 'auth', '{}', 'auth (clinic_auth)', 'none'),
  ('public.auth_login_failure', 'platform', 'auth', '{}', 'auth (clinic_auth)', 'none');
