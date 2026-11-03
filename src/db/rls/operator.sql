-- Operator read predicates (TEN-14, TEN-17, TEN-19): one SELECT policy for clinic_operator per tenant
-- table whose support class allows an operator to read it (support_object_kinds: config,
-- personal, clinical, money_total; never = no policy). Each policy first compares the row's
-- tenant with app_tenant_id() (so other tenants' rows never reach the function), then admits
-- the row only through operator_row_read(<table>, tenant, id): a session bound to this backend
-- and transaction, live, for this tenant, opened by the bound operator who is still signed in
-- and active, with the table in its scope — and records the row as touched. Applied by migration
-- 0046_support_session_rules.sql, which ends with this file verbatim (tests/vendor/support.test.ts
-- compares them and checks every table has a class and every readable class one policy).
CREATE POLICY approvals_operator_read ON public.approvals FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.approvals', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.approvals TO clinic_operator;--> statement-breakpoint
CREATE POLICY audit_events_operator_read ON public.audit_events FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.audit_events', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.audit_events TO clinic_operator;--> statement-breakpoint
CREATE POLICY branches_operator_read ON public.branches FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.branches', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.branches TO clinic_operator;--> statement-breakpoint
CREATE POLICY evidence_approvals_operator_read ON public.evidence_approvals FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.evidence_approvals', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.evidence_approvals TO clinic_operator;--> statement-breakpoint
CREATE POLICY evidence_files_operator_read ON public.evidence_files FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.evidence_files', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.evidence_files TO clinic_operator;--> statement-breakpoint
CREATE POLICY evidence_items_operator_read ON public.evidence_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.evidence_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.evidence_items TO clinic_operator;--> statement-breakpoint
CREATE POLICY membership_revocations_operator_read ON public.membership_revocations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.membership_revocations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.membership_revocations TO clinic_operator;--> statement-breakpoint
CREATE POLICY memberships_operator_read ON public.memberships FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.memberships', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.memberships TO clinic_operator;--> statement-breakpoint
CREATE POLICY notifications_operator_read ON public.notifications FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.notifications', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.notifications TO clinic_operator;--> statement-breakpoint
CREATE POLICY org_actions_operator_read ON public.org_actions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.org_actions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.org_actions TO clinic_operator;--> statement-breakpoint
CREATE POLICY role_requests_operator_read ON public.role_requests FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.role_requests', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.role_requests TO clinic_operator;--> statement-breakpoint
CREATE POLICY setting_versions_operator_read ON public.setting_versions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.setting_versions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.setting_versions TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_operator_read ON public.staff FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_branches_operator_read ON public.staff_branches FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_branches', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_branches TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_duties_operator_read ON public.staff_duties FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_duties', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_duties TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_invitations_operator_read ON public.staff_invitations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_invitations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_invitations TO clinic_operator;--> statement-breakpoint
CREATE POLICY staff_roles_operator_read ON public.staff_roles FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_roles', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_roles TO clinic_operator;--> statement-breakpoint
CREATE POLICY tenants_operator_read ON public.tenants FOR SELECT TO clinic_operator
  USING (id = public.app_tenant_id() AND public.operator_row_read('public.tenants', id, id));--> statement-breakpoint
GRANT SELECT ON public.tenants TO clinic_operator;
