-- T-009: idempotency records are private to the caller that made them (staff, or the
-- tenant's service context when no staff is bound). clinic_app inserts its own claim and
-- completes it once (in_progress -> succeeded/failed); the key, command, fingerprint and
-- owner never change, and nothing is deleted.
ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY idempotency_records_read ON public.idempotency_records FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND staff_id IS NOT DISTINCT FROM public.app_staff_id());--> statement-breakpoint
CREATE POLICY idempotency_records_insert ON public.idempotency_records FOR INSERT TO clinic_app
  WITH CHECK (tenant_id = public.app_tenant_id() AND staff_id IS NOT DISTINCT FROM public.app_staff_id()
              AND status = 'in_progress');--> statement-breakpoint
CREATE POLICY idempotency_records_complete ON public.idempotency_records FOR UPDATE TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND staff_id IS NOT DISTINCT FROM public.app_staff_id()
         AND status = 'in_progress')
  WITH CHECK (tenant_id = public.app_tenant_id() AND staff_id IS NOT DISTINCT FROM public.app_staff_id()
              AND status IN ('succeeded','failed'));--> statement-breakpoint
GRANT SELECT, INSERT ON public.idempotency_records TO clinic_app;--> statement-breakpoint
GRANT UPDATE (status, result, error_code, completed_at) ON public.idempotency_records TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.idempotency_records', 'tenant-shared', 'idempotency', '{self}', 'command wrapper (src/lib/command.ts)', 'none');
