CREATE TABLE "payment_charge_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "payment_charge_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_charge_lines_charge_line_key" UNIQUE("tenant_id","charge_id","invoice_line_id"),
	CONSTRAINT "payment_charge_lines_check" CHECK ("payment_charge_lines"."amount" between 1 and 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "payment_charges" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"config_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account" text NOT NULL,
	"environment" text NOT NULL,
	"channel" text NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"order_ref" text NOT NULL,
	"external_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_simulated" boolean NOT NULL,
	"review_flag" text,
	"balance_pending" bigint DEFAULT 0 NOT NULL,
	"receipt_id" uuid,
	"settled_at" timestamp with time zone,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_charges_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_charges_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "payment_charges_order_ref_key" UNIQUE("order_ref"),
	CONSTRAINT "payment_charges_external_key" UNIQUE("tenant_id","provider","provider_account","environment","external_id"),
	CONSTRAINT "payment_charges_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "payment_charges_check" CHECK ("payment_charges"."amount" between 1 and 1000000000000 and "payment_charges"."state" in ('created','pending','paid','expired','failed','cancelled')
      and "payment_charges"."channel" in ('qris','va','payment_link') and "payment_charges"."environment" in ('production','staging','demo','local') and "payment_charges"."provider" in ('mock')
      and ("payment_charges"."review_flag" is null or "payment_charges"."review_flag" in ('paid_after_expiry','paid_after_failed','paid_after_cash','amount_mismatch'))
      and "payment_charges"."balance_pending" between 0 and "payment_charges"."amount" and "payment_charges"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "payment_charges"."created_as" in ('owner','manager','fo_cashier','finance')
      and "payment_charges"."description" in ('Layanan klinik','Produk','Layanan dan produk klinik')
      and "payment_charges"."order_ref" ~ '^[A-Z0-9]{6,12}-[0-9a-f]{32}$' and length("payment_charges"."external_id") between 1 and 80
      and (("payment_charges"."state" = 'paid') = ("payment_charges"."settled_at" is not null)) and ("payment_charges"."receipt_id" is null or "payment_charges"."state" = 'paid')
      and ("payment_charges"."is_simulated" = ("payment_charges"."provider" = 'mock')))
);
--> statement-breakpoint
CREATE TABLE "payment_mock_states" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"amount" bigint NOT NULL,
	"changed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_event_id" text,
	"event_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_mock_states_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_mock_states_charge_key" UNIQUE("tenant_id","charge_id"),
	CONSTRAINT "payment_mock_states_check" CHECK ("payment_mock_states"."state" in ('pending','paid','expired','failed','cancelled') and "payment_mock_states"."amount" between 1 and 1000000000000 and "payment_mock_states"."event_seq" >= 0
      and ("payment_mock_states"."last_event_id" is null or "payment_mock_states"."last_event_id" ~ '^[A-Za-z0-9_.:-]{8,80}$'))
);
--> statement-breakpoint
CREATE TABLE "payment_port_configs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account" text NOT NULL,
	"environment" text NOT NULL,
	"channels" text[] NOT NULL,
	"order_prefix" text NOT NULL,
	"kek_version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_port_configs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_port_configs_prefix_key" UNIQUE("order_prefix"),
	CONSTRAINT "payment_port_configs_check" CHECK ("payment_port_configs"."provider" in ('mock') and "payment_port_configs"."environment" in ('production','staging','demo','local')
      and "payment_port_configs"."provider_account" ~ '^[a-z0-9][a-z0-9_.-]{2,79}$' and "payment_port_configs"."order_prefix" ~ '^[A-Z0-9]{6,12}$' and "payment_port_configs"."kek_version" >= 1
      and cardinality("payment_port_configs"."channels") between 1 and 3 and "payment_port_configs"."channels" <@ array['qris','va','payment_link']::text[]
      and "payment_port_configs"."created_as" in ('owner','manager'))
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"provider_refund_id" text NOT NULL,
	"state" text NOT NULL,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_refunds_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_refunds_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "payment_refunds_check" CHECK ("payment_refunds"."amount" between 1 and 1000000000000 and "payment_refunds"."state" = 'succeeded' and "payment_refunds"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and length("payment_refunds"."provider_refund_id") between 1 and 80 and "payment_refunds"."created_as" in ('owner','manager'))
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account" text NOT NULL,
	"environment" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"order_ref" text NOT NULL,
	"charge_id" uuid,
	"observed_state" text,
	"amount" bigint,
	"signature_ok" boolean NOT NULL,
	"timestamp_ok" boolean NOT NULL,
	"outcome" text NOT NULL,
	"body_sha256" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_webhook_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_webhook_events_check" CHECK ("payment_webhook_events"."outcome" in ('received','applied','duplicate','flagged','rejected_signature','rejected_window','rejected_amount','dropped_tenant_mismatch','dropped_unknown_charge') and "payment_webhook_events"."provider" in ('mock')
      and "payment_webhook_events"."environment" in ('production','staging','demo','local') and length("payment_webhook_events"."provider_event_id") between 1 and 80 and length("payment_webhook_events"."order_ref") between 1 and 60
      and "payment_webhook_events"."body_sha256" ~ '^[0-9a-f]{64}$' and ("payment_webhook_events"."amount" is null or "payment_webhook_events"."amount" between 0 and 1000000000000)
      and ("payment_webhook_events"."observed_state" is null or "payment_webhook_events"."observed_state" in ('pending','paid','expired','failed','cancelled'))
      and ("payment_webhook_events"."outcome" not in ('received','applied','flagged','rejected_amount','duplicate') or ("payment_webhook_events"."signature_ok" and "payment_webhook_events"."timestamp_ok")))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "charge_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "webhook_event_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_charge_lines" ADD CONSTRAINT "payment_charge_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge_lines" ADD CONSTRAINT "payment_charge_lines_charge_fk" FOREIGN KEY ("tenant_id","branch_id","charge_id") REFERENCES "public"."payment_charges"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge_lines" ADD CONSTRAINT "payment_charge_lines_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_config_fk" FOREIGN KEY ("tenant_id","config_id") REFERENCES "public"."payment_port_configs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_mock_states" ADD CONSTRAINT "payment_mock_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_mock_states" ADD CONSTRAINT "payment_mock_states_charge_fk" FOREIGN KEY ("tenant_id","branch_id","charge_id") REFERENCES "public"."payment_charges"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_port_configs" ADD CONSTRAINT "payment_port_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_port_configs" ADD CONSTRAINT "payment_port_configs_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_charge_fk" FOREIGN KEY ("tenant_id","branch_id","charge_id") REFERENCES "public"."payment_charges"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_charge_fk" FOREIGN KEY ("tenant_id","charge_id") REFERENCES "public"."payment_charges"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_charges_one_pending" ON "payment_charges" USING btree ("tenant_id","invoice_id") WHERE "payment_charges"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "payment_charges_invoice_idx" ON "payment_charges" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_port_configs_one_active" ON "payment_port_configs" USING btree ("tenant_id") WHERE "payment_port_configs"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_verified_key" ON "payment_webhook_events" USING btree ("provider","provider_account","environment","provider_event_id") WHERE "payment_webhook_events"."outcome" in ('applied','flagged','rejected_amount');--> statement-breakpoint
CREATE INDEX "payment_webhook_events_charge_idx" ON "payment_webhook_events" USING btree ("tenant_id","charge_id");--> statement-breakpoint

-- T-073 rules (generated by gen.py; plan docs/tasks/T-073.md)
-- ── Helpers (T-073; plan docs/tasks/T-073.md) ─────────────────────────────────────────────────────────────────────

-- The deployment environment (DEL-3) as the server set it for this transaction (`app.deploy_env`, from deployEnv());
-- anything else or nothing reads as production (fail closed: the mock is then unusable, BILL-29).
CREATE FUNCTION public.payment_deploy_env() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN current_setting('app.deploy_env', true) IN ('staging','demo','local') THEN current_setting('app.deploy_env', true) ELSE 'production' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_deploy_env() FROM PUBLIC;--> statement-breakpoint

-- The tenant's active port, or a null row.
CREATE FUNCTION public.payment_port_of(p_tenant uuid) RETURNS public.payment_port_configs
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.* FROM public.payment_port_configs c WHERE c.tenant_id = p_tenant AND c.active
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_port_of(uuid) FROM PUBLIC;--> statement-breakpoint

-- A port is usable when it is active and is not the mock in production (BILL-29; plan r1 P2-6).
CREATE FUNCTION public.payment_port_usable(c public.payment_port_configs) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(c.id IS NOT NULL AND c.active AND (c.provider <> 'mock' OR public.payment_deploy_env() <> 'production'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_port_usable(public.payment_port_configs) FROM PUBLIC;--> statement-breakpoint

-- An audit row written by the payment service (a webhook has no staff; plan r1 P1-1): the same hash chain as
-- audit_append, under the tenant's audit lock, with service_identity = payment_webhook (audit_events_actor_check).
CREATE FUNCTION public.payment_audit_service(p_tenant uuid, p_action text, p_object_kind text, p_object uuid, p_outcome text, p_reason_code text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_prev text;
  v_seq bigint;
  v_row public.audit_events;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || p_tenant::text, 0));
  SELECT e.hash, e.seq INTO v_prev, v_seq FROM public.audit_events e WHERE e.tenant_id = p_tenant ORDER BY e.seq DESC LIMIT 1;
  v_row := ROW(
    public.uuid_generate_v7(), p_tenant, coalesce(v_seq, 0) + 1, clock_timestamp(),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'payment_webhook', NULL,
    p_action, p_object_kind, p_object, p_outcome, p_reason_code, NULL,
    coalesce(v_prev, repeat('0', 64)), repeat('0', 64))::public.audit_events;
  v_row.hash := encode(public.digest(v_row.prev_hash || public.audit_canonical(v_row), 'sha256'), 'hex');
  INSERT INTO public.audit_events SELECT v_row.*;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_audit_service(uuid, text, text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- Who reads the port tables directly (RLS): the Kasir readers.
CREATE FUNCTION public.payment_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.kasir_readable(p_tenant, p_branch)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint
CREATE FUNCTION public.payment_config_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_role_in(ARRAY['owner','manager','fo_cashier','finance','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_config_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_config_readable(uuid) TO clinic_app;--> statement-breakpoint

-- The room a charge may still take on one of its lines (r2 F-2): a real charge, what the line still owes in real money
-- (simulated allocations never count, BILL-29); a simulated charge, the line total less every allocation, real or
-- simulated (so a line settled in cash first leaves no room and the money waits for the balance, flagged).
CREATE FUNCTION public.payment_line_room(p_tenant uuid, p_line uuid, p_simulated boolean) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT greatest(0, l.line_total - CASE WHEN p_simulated
           THEN (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = l.tenant_id AND a.invoice_line_id = l.id)
           ELSE public.kasir_line_paid(l.tenant_id, l.id) END)::bigint
    FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.id = p_line
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_line_room(uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint

-- The generic description a gateway sees (SEC-15, TD-40): never a treatment or product name.
CREATE FUNCTION public.payment_description(p_tenant uuid, p_invoice uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN bool_and(ci.kind = 'product') THEN 'Produk' WHEN bool_or(ci.kind = 'product') THEN 'Layanan dan produk klinik' ELSE 'Layanan klinik' END
    FROM public.invoice_lines l JOIN public.catalog_items ci ON ci.tenant_id = l.tenant_id AND ci.id = l.item_id
   WHERE l.tenant_id = p_tenant AND l.invoice_id = p_invoice
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_description(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The webhook payload of the mock's current state of a charge (what the simulator returns to sign and deliver).
CREATE FUNCTION public.payment_mock_payload(c public.payment_charges, m public.payment_mock_states) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('event_id', m.last_event_id, 'order_ref', c.order_ref, 'state', m.state, 'amount', m.amount, 'at', m.changed_at,
    'provider', c.provider, 'provider_account', c.provider_account, 'environment', c.environment)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_mock_payload(public.payment_charges, public.payment_mock_states) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.payment_port_configs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_port_configs_read ON public.payment_port_configs FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.payment_config_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.payment_port_configs TO clinic_app;--> statement-breakpoint
CREATE POLICY payment_port_configs_operator_read ON public.payment_port_configs FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payment_port_configs', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payment_port_configs TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payment_port_configs_no_truncate BEFORE TRUNCATE ON public.payment_port_configs FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payment_port_configs ENABLE ALWAYS TRIGGER payment_port_configs_no_truncate;--> statement-breakpoint
ALTER TABLE public.payment_charges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_charges_read ON public.payment_charges FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.payment_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.payment_charges TO clinic_app;--> statement-breakpoint
CREATE POLICY payment_charges_operator_read ON public.payment_charges FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payment_charges', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payment_charges TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payment_charges_no_truncate BEFORE TRUNCATE ON public.payment_charges FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payment_charges ENABLE ALWAYS TRIGGER payment_charges_no_truncate;--> statement-breakpoint
ALTER TABLE public.payment_charge_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_charge_lines_read ON public.payment_charge_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.payment_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.payment_charge_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY payment_charge_lines_operator_read ON public.payment_charge_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payment_charge_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payment_charge_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payment_charge_lines_no_truncate BEFORE TRUNCATE ON public.payment_charge_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payment_charge_lines ENABLE ALWAYS TRIGGER payment_charge_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.payment_mock_states ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_mock_states_read ON public.payment_mock_states FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.payment_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.payment_mock_states TO clinic_app;--> statement-breakpoint
CREATE POLICY payment_mock_states_operator_read ON public.payment_mock_states FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payment_mock_states', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payment_mock_states TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payment_mock_states_no_truncate BEFORE TRUNCATE ON public.payment_mock_states FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payment_mock_states ENABLE ALWAYS TRIGGER payment_mock_states_no_truncate;--> statement-breakpoint
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_webhook_events_read ON public.payment_webhook_events FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.payment_config_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.payment_webhook_events TO clinic_app;--> statement-breakpoint
CREATE POLICY payment_webhook_events_operator_read ON public.payment_webhook_events FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payment_webhook_events', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payment_webhook_events TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payment_webhook_events_no_truncate BEFORE TRUNCATE ON public.payment_webhook_events FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payment_webhook_events ENABLE ALWAYS TRIGGER payment_webhook_events_no_truncate;--> statement-breakpoint
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_refunds_read ON public.payment_refunds FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.payment_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.payment_refunds TO clinic_app;--> statement-breakpoint
CREATE POLICY payment_refunds_operator_read ON public.payment_refunds FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.payment_refunds', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.payment_refunds TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER payment_refunds_no_truncate BEFORE TRUNCATE ON public.payment_refunds FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.payment_refunds ENABLE ALWAYS TRIGGER payment_refunds_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.payment_port_configs', 'tenant-shared', 'cashier', '{owner,manager,fo_cashier,finance,auditor}', 'payment port definers (src/modules/payments)', 'none (tenant-wide)'),
  ('public.payment_charges', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'payment port definers (src/modules/payments)', 'the selling branch'),
  ('public.payment_charge_lines', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'payment port definers (src/modules/payments)', 'the selling branch'),
  ('public.payment_mock_states', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'payment port definers (src/modules/payments)', 'the selling branch'),
  ('public.payment_webhook_events', 'tenant-ledger', 'cashier', '{owner,manager,fo_cashier,finance,auditor}', 'payment port definers (src/modules/payments)', 'none (tenant-wide)'),
  ('public.payment_refunds', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'payment port definers (src/modules/payments)', 'the selling branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): port config, charges personal, the rest money totals.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.payment_port_configs', 'config'),
  ('public.payment_charges', 'personal'),
  ('public.payment_charge_lines', 'money_total'),
  ('public.payment_mock_states', 'money_total'),
  ('public.payment_webhook_events', 'money_total'),
  ('public.payment_refunds', 'money_total');--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS; the staff_access lock first) ───────────────────────────────────────────────────────────

-- DATA-51 chain: a payment names its charge and the webhook event that settled it (composite FKs; the tables exist now).
ALTER TABLE public.payments ADD CONSTRAINT payments_charge_fk FOREIGN KEY (tenant_id, branch_id, charge_id)
  REFERENCES public.payment_charges (tenant_id, branch_id, id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.payments ADD CONSTRAINT payments_webhook_event_fk FOREIGN KEY (tenant_id, webhook_event_id)
  REFERENCES public.payment_webhook_events (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE UNIQUE INDEX payments_charge_key ON public.payments (tenant_id, charge_id) WHERE charge_id IS NOT NULL;--> statement-breakpoint

-- payments_guard (re-created from 0087): as before for cash, EDC and transfer; a port payment (QRIS, VA, link) names
-- its charge (of this invoice, the same method, provider, account, environment and simulated flag) and may land on a
-- void invoice only through that charge (paid after the void: the money waits for the balance, plan r1 P1-4).
CREATE OR REPLACE FUNCTION public.payments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.payment_charges;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF (NEW.method IN ('qris','va','payment_link')) <> (NEW.charge_id IS NOT NULL) OR NEW.webhook_event_id IS NOT NULL AND NEW.charge_id IS NULL THEN
    RAISE EXCEPTION 'a port payment names its charge; no other does' USING ERRCODE = '42501';
  END IF;
  IF NEW.charge_id IS NOT NULL THEN
    SELECT * INTO c FROM public.payment_charges x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.charge_id;
    IF c.id IS NULL OR c.invoice_id <> NEW.invoice_id OR c.channel <> NEW.method
       OR (c.provider, c.provider_account, c.environment, c.is_simulated) IS DISTINCT FROM (NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated) THEN
      RAISE EXCEPTION 'a port payment copies its charge' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id
                   AND (i.state = 'issued' OR i.state = 'void' AND NEW.charge_id IS NOT NULL)
                   AND i.patient_id IS NOT DISTINCT FROM NEW.patient_id)
     OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id = NEW.invoice_id
                      AND r.is_simulated = NEW.is_simulated) THEN
    RAISE EXCEPTION 'a payment is for an issued invoice, its patient and its receipt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Port configs: never deleted; identity, prefix, provider and account frozen; only `active` turns off (once).
CREATE FUNCTION public.payment_port_configs_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment port configs are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.id, NEW.tenant_id, NEW.provider, NEW.provider_account, NEW.environment, NEW.channels, NEW.order_prefix, NEW.kek_version,
                            NEW.created_by, NEW.created_as, NEW.created_at)
                           IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.provider, OLD.provider_account, OLD.environment, OLD.channels, OLD.order_prefix,
                            OLD.kek_version, OLD.created_by, OLD.created_as, OLD.created_at)
                           OR NOT OLD.active AND NEW.active) THEN
    RAISE EXCEPTION 'a payment port config only turns off' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_port_configs_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payment_port_configs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payment_port_configs FOR EACH ROW EXECUTE FUNCTION public.payment_port_configs_guard();--> statement-breakpoint
ALTER TABLE public.payment_port_configs ENABLE ALWAYS TRIGGER payment_port_configs_guard;--> statement-breakpoint

-- Charges: never deleted; identity, money and channel frozen; pending → paid | expired | failed | cancelled; a
-- closed charge (expired, failed, cancelled) may still become paid (a late paid webhook, TD-41) with its review flag;
-- a paid charge is final (no transition leaves `paid`); the flag, balance_pending and the receipt are set once with the
-- payment.
CREATE FUNCTION public.payment_charges_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment charges are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.receipt_id IS NOT NULL OR NEW.review_flag IS NOT NULL OR NEW.balance_pending <> 0 THEN
      RAISE EXCEPTION 'a charge opens pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.invoice_id, NEW.config_id, NEW.provider, NEW.provider_account, NEW.environment, NEW.channel, NEW.amount,
      NEW.description, NEW.order_ref, NEW.external_id, NEW.expires_at, NEW.is_simulated, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.invoice_id, OLD.config_id, OLD.provider, OLD.provider_account, OLD.environment, OLD.channel,
      OLD.amount, OLD.description, OLD.order_ref, OLD.external_id, OLD.expires_at, OLD.is_simulated, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at)
     OR NOT (OLD.state = 'pending' AND NEW.state IN ('pending','paid','expired','failed','cancelled')
             OR OLD.state IN ('expired','failed','cancelled') AND NEW.state IN (OLD.state, 'paid'))
     OR NEW.state <> 'paid' AND (NEW.review_flag, NEW.balance_pending, NEW.receipt_id) IS DISTINCT FROM (OLD.review_flag, OLD.balance_pending, OLD.receipt_id) THEN
    RAISE EXCEPTION 'a charge moves pending → paid | expired | failed | cancelled; a closed one only to paid' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_charges_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payment_charges_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payment_charges FOR EACH ROW EXECUTE FUNCTION public.payment_charges_guard();--> statement-breakpoint
ALTER TABLE public.payment_charges ENABLE ALWAYS TRIGGER payment_charges_guard;--> statement-breakpoint

-- Charge lines, refunds: insert-only (the Kasir's append-only trigger function, 0087).
CREATE TRIGGER payment_charge_lines_insert_only BEFORE UPDATE OR DELETE ON public.payment_charge_lines FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.payment_charge_lines ENABLE ALWAYS TRIGGER payment_charge_lines_insert_only;--> statement-breakpoint
CREATE TRIGGER payment_refunds_insert_only BEFORE UPDATE OR DELETE ON public.payment_refunds FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.payment_refunds ENABLE ALWAYS TRIGGER payment_refunds_insert_only;--> statement-breakpoint

-- Refunds: of a paid charge, Σ ≤ the charge amount (TD-43 refund idempotent incl. partial).
CREATE FUNCTION public.payment_refunds_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.payment_charges c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.charge_id AND c.state = 'paid'
                   AND (SELECT coalesce(sum(r.amount), 0) FROM public.payment_refunds r WHERE r.tenant_id = NEW.tenant_id AND r.charge_id = NEW.charge_id) + NEW.amount <= c.amount) THEN
    RAISE EXCEPTION 'a refund is of a paid charge, within its amount' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_refunds_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payment_refunds_guard BEFORE INSERT ON public.payment_refunds FOR EACH ROW EXECUTE FUNCTION public.payment_refunds_guard();--> statement-breakpoint
ALTER TABLE public.payment_refunds ENABLE ALWAYS TRIGGER payment_refunds_guard;--> statement-breakpoint

-- Mock states: never deleted; the charge frozen; the event sequence only grows.
CREATE FUNCTION public.payment_mock_states_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' AND ((NEW.id, NEW.tenant_id, NEW.branch_id, NEW.charge_id) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.charge_id)
                                                OR NEW.event_seq < OLD.event_seq) THEN
    RAISE EXCEPTION 'a mock state keeps its charge' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_mock_states_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payment_mock_states_guard BEFORE UPDATE OR DELETE ON public.payment_mock_states FOR EACH ROW EXECUTE FUNCTION public.payment_mock_states_guard();--> statement-breakpoint
ALTER TABLE public.payment_mock_states ENABLE ALWAYS TRIGGER payment_mock_states_guard;--> statement-breakpoint

-- Webhook events: never deleted; a `received` row gets its final outcome once; nothing else changes.
CREATE FUNCTION public.payment_webhook_events_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' AND (OLD.outcome <> 'received'
       OR (NEW.id, NEW.tenant_id, NEW.provider, NEW.provider_account, NEW.environment, NEW.provider_event_id, NEW.order_ref, NEW.observed_state, NEW.amount,
           NEW.signature_ok, NEW.timestamp_ok, NEW.body_sha256, NEW.received_at)
          IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.provider, OLD.provider_account, OLD.environment, OLD.provider_event_id, OLD.order_ref, OLD.observed_state,
           OLD.amount, OLD.signature_ok, OLD.timestamp_ok, OLD.body_sha256, OLD.received_at)
       OR OLD.charge_id IS NOT NULL AND NEW.charge_id IS DISTINCT FROM OLD.charge_id) THEN
    RAISE EXCEPTION 'a webhook event is recorded once' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_webhook_events_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER payment_webhook_events_guard BEFORE UPDATE OR DELETE ON public.payment_webhook_events FOR EACH ROW EXECUTE FUNCTION public.payment_webhook_events_guard();--> statement-breakpoint
ALTER TABLE public.payment_webhook_events ENABLE ALWAYS TRIGGER payment_webhook_events_guard;--> statement-breakpoint

-- ── The shared recording path (cash and the port; plan §3, r1 P1-4, r2 F-3) ──────────────────────────────────────

-- kasir_record_payment (internal): one receipt with 1–6 payments on an invoice, each allocated in order over the
-- running room of its target lines (the invoice's lines with what they still owe for real money; a port payment, the
-- lines of its charge with their room, payment_line_room), allocations only where > 0. A real payment recognises VAT
-- at payment (A-12) on PKP lines; a simulated one never touches the VAT recognition (BILL-29). Events name the tenant,
-- the staff and the acting role (a webhook settles in no staff context: attribution to the charge's creator, DATA-60).
-- p_tenders: [{method, amount, cash_tendered?, details?}]; p_port: null for cash/EDC/transfer, else {charge_id,
-- provider, provider_account, environment, is_simulated, webhook_event_id?}. Returns {receipt_id, number, paid, change,
-- allocated} (allocated: what reached the lines; the rest is the caller's to place).
CREATE FUNCTION public.kasir_record_payment(i public.invoices, p_key text, p_tenders jsonb, p_port jsonb, p_staff uuid, p_role text, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_t jsonb;
  v_seq integer := 0;
  v_sum bigint := 0;
  v_change bigint := 0;
  v_allocated bigint := 0;
  v_receipt uuid;
  v_number text;
  v_payment uuid;
  v_ids uuid[];
  v_room bigint[];
  v_alloc record;
  v_line public.invoice_lines;
  v_paid bigint;
  v_target bigint;
  v_portion bigint;
  v_alloc_id uuid;
  v_sim boolean := coalesce((p_port ->> 'is_simulated')::boolean, false);
  v_env text := coalesce(p_port ->> 'environment', 'production');
  v_charge uuid := (p_port ->> 'charge_id')::uuid;
  v_take bigint;
  rb record;
BEGIN
  SELECT sum((t ->> 'amount')::bigint) INTO v_sum FROM jsonb_array_elements(p_tenders) t;
  v_number := public.kasir_next_number(i.tenant_id, i.branch_id, 'KW');
  SELECT * INTO rb FROM public.kasir_receipt_body(i, v_number, p_at, p_tenders);
  BEGIN
    INSERT INTO public.receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, template_version_id, is_simulated, command_key, issued_by, issued_as, issued_at)
    VALUES (i.tenant_id, i.branch_id, i.id, v_number, v_sum, CASE WHEN v_sim THEN E'SIMULASI\n' || rb.body ELSE rb.body END, rb.paper, rb.template_version_id,
            v_sim, p_key, p_staff, p_role, p_at)
    RETURNING id INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
  END;
  FOR v_t IN SELECT t FROM jsonb_array_elements(p_tenders) t LOOP
    v_seq := v_seq + 1;
    IF v_t ? 'cash_tendered' THEN
      v_change := (v_t ->> 'cash_tendered')::bigint - (v_t ->> 'amount')::bigint;
    END IF;
    INSERT INTO public.payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                                 provider, provider_account, environment, is_simulated, charge_id, webhook_event_id, received_by, received_as, received_at)
    VALUES (i.tenant_id, i.branch_id, v_receipt, v_seq, i.id, i.patient_id, v_t ->> 'method', (v_t ->> 'amount')::bigint,
            (v_t ->> 'cash_tendered')::bigint, CASE WHEN v_t ? 'cash_tendered' THEN (v_t ->> 'cash_tendered')::bigint - (v_t ->> 'amount')::bigint END,
            v_t -> 'details', p_port ->> 'provider', p_port ->> 'provider_account', v_env, v_sim, v_charge, (p_port ->> 'webhook_event_id')::uuid,
            p_staff, p_role, p_at)
    RETURNING id INTO v_payment;
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (i.tenant_id, i.branch_id, 'PaymentReceived', 'payment', v_payment, p_staff, p_role, jsonb_build_object('payment_id', v_payment, 'invoice_id', i.id));
    -- The target lines and their room now (after the previous tenders of this receipt).
    IF v_charge IS NULL THEN
      SELECT array_agg(l.id ORDER BY l.id), array_agg(l.line_total - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id)
        INTO v_ids, v_room FROM public.invoice_lines l
       WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.line_total - public.kasir_line_paid(l.tenant_id, l.id) > 0;
    ELSE
      SELECT array_agg(cl.invoice_line_id ORDER BY cl.invoice_line_id), array_agg(least(cl.amount, public.payment_line_room(i.tenant_id, cl.invoice_line_id, v_sim)) ORDER BY cl.invoice_line_id)
        INTO v_ids, v_room FROM public.payment_charge_lines cl
       WHERE cl.tenant_id = i.tenant_id AND cl.charge_id = v_charge AND public.payment_line_room(i.tenant_id, cl.invoice_line_id, v_sim) > 0;
    END IF;
    -- A port payment may meet less room than it carries (paid after cash, after a void): allocate what fits.
    v_take := least((v_t ->> 'amount')::bigint, coalesce((SELECT sum(x) FROM unnest(v_room) x), 0));
    IF v_take > 0 THEN
      FOR v_alloc IN SELECT * FROM public.kasir_allocate(v_take, v_ids, v_room) LOOP
        SELECT * INTO v_line FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.id = v_alloc.line_id;
        v_portion := 0;
        IF NOT v_sim THEN
          v_paid := public.kasir_line_paid(i.tenant_id, v_line.id) + v_alloc.amount;
          v_target := CASE WHEN v_line.vat_amount = 0 THEN 0
                           ELSE floor((v_line.vat_amount::numeric * v_paid::numeric * 2 + v_line.line_total::numeric) / (2 * v_line.line_total::numeric))::bigint END;
          v_portion := greatest(0, v_target - v_line.vat_recognised_amount);
        END IF;
        INSERT INTO public.payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, vat_portion, method, provider, provider_account, environment, is_simulated)
        VALUES (i.tenant_id, i.branch_id, v_payment, v_line.id, v_alloc.amount, v_portion, v_t ->> 'method', p_port ->> 'provider', p_port ->> 'provider_account', v_env, v_sim)
        RETURNING id INTO v_alloc_id;
        IF v_portion > 0 THEN
          UPDATE public.invoice_lines SET vat_recognised_amount = vat_recognised_amount + v_portion, vat_recognised_at = coalesce(vat_recognised_at, p_at)
           WHERE tenant_id = i.tenant_id AND id = v_line.id;
        END IF;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
        VALUES (i.tenant_id, i.branch_id, 'PaymentAllocated', 'payment_allocation', v_alloc_id, p_staff, p_role, jsonb_build_object('allocation_id', v_alloc_id, 'payment_id', v_payment));
        v_allocated := v_allocated + v_alloc.amount;
      END LOOP;
    END IF;
  END LOOP;
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  RETURN jsonb_build_object('receipt_id', v_receipt, 'number', v_number, 'paid', v_sum, 'change', v_change, 'allocated', v_allocated);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_record_payment(public.invoices, text, jsonb, jsonb, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- payment_receive (re-created from 0087, the same signature): the cash/EDC/transfer Terima now records through
-- kasir_record_payment; QRIS, VA and link are charges (payment_charge_create), never tenders here; the balance waits
-- for T-075. Behaviour otherwise as 0087.
CREATE OR REPLACE FUNCTION public.payment_receive(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  v_at timestamptz := clock_timestamp();
  v_t jsonb;
  v_sum bigint := 0;
  v_r jsonb;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id AND ap.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: void_pending' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'tenders' <> '{}'::jsonb OR jsonb_typeof(p -> 'tenders') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p -> 'tenders') NOT BETWEEN 1 AND 6
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'tenders') t
                 WHERE jsonb_typeof(t) IS DISTINCT FROM 'object' OR t - 'method' - 'amount' - 'cash_tendered' - 'details' <> '{}'::jsonb
                    OR coalesce(t ->> 'method', '') NOT IN ('cash','edc','transfer','qris','va','payment_link','balance')
                    OR jsonb_typeof(t -> 'amount') IS DISTINCT FROM 'number' OR (t ->> 'amount') !~ '^[1-9]\d{0,12}$'
                    OR (t ->> 'method' = 'cash') <> (t ? 'cash_tendered')
                    OR t ? 'cash_tendered' AND (jsonb_typeof(t -> 'cash_tendered') IS DISTINCT FROM 'number' OR (t ->> 'cash_tendered') !~ '^[1-9]\d{0,12}$'
                                                 OR (t ->> 'cash_tendered')::bigint < (t ->> 'amount')::bigint)
                    OR t ? 'details' AND (t ->> 'method' NOT IN ('edc','transfer') OR jsonb_typeof(t -> 'details') IS DISTINCT FROM 'object'
                                          OR (t -> 'details') - 'card_type' - 'bank' - 'trace' - 'approval_code' - 'reference' <> '{}'::jsonb
                                          OR EXISTS (SELECT 1 FROM jsonb_each(t -> 'details') d WHERE jsonb_typeof(d.value) <> 'string' OR length(d.value #>> '{}') NOT BETWEEN 1 AND 60)))
     OR (SELECT count(*) FROM jsonb_array_elements(p -> 'tenders') t WHERE t ->> 'method' = 'cash') > 1 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: tenders' USING ERRCODE = '22023';
  END IF;
  FOR v_t IN SELECT t FROM jsonb_array_elements(p -> 'tenders') t LOOP
    IF v_t ->> 'method' IN ('qris','va','payment_link') THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: payment_port' USING ERRCODE = '55000';
    ELSIF v_t ->> 'method' = 'balance' THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: balance' USING ERRCODE = '55000';
    ELSIF NOT public.kasir_method_enabled(v_t ->> 'method', v_at) THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
    END IF;
    v_sum := v_sum + (v_t ->> 'amount')::bigint;
  END LOOP;
  -- Lines in id order, locked; the outstanding is read under the lock.
  PERFORM 1 FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id ORDER BY l.id FOR UPDATE;
  IF v_sum > public.kasir_outstanding(i.tenant_id, i.id) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: overpayment' USING ERRCODE = '22023';
  END IF;
  v_r := public.kasir_record_payment(i, p_key, p -> 'tenders', NULL, a.staff_id, a.role, v_at);
  PERFORM public.audit_append('money_correction', 'receipt', (v_r ->> 'receipt_id')::uuid, 'success', 'payment_received');
  RETURN jsonb_build_object('receipt_id', v_r -> 'receipt_id', 'number', v_r -> 'number', 'paid', v_r -> 'paid', 'change', v_r -> 'change',
    'outstanding', public.kasir_outstanding(i.tenant_id, i.id));
END
$$;--> statement-breakpoint

-- ── The port (PR-68, TD-41) ──────────────────────────────────────────────────────────────────────────────────────

-- payment_port_enable (Simulasi "Aktifkan Port Simulasi"; owner or manager; non-production only): the tenant's mock
-- port with its order prefix (random, unique across tenants) and the KEK version its webhook secret derives from.
-- Idempotent: an active config is returned as it is. Returns {config_id, order_prefix, provider_account, kek_version}.
CREATE FUNCTION public.payment_port_enable(p_kek_version integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  c public.payment_port_configs;
  v_prefix text;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not set up the payment port' USING ERRCODE = '42501';
  END IF;
  IF public.payment_deploy_env() = 'production' THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: mock_in_production' USING ERRCODE = '55000';
  END IF;
  IF p_kek_version IS NULL OR p_kek_version < 1 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kek_version' USING ERRCODE = '22023';
  END IF;
  c := public.payment_port_of(a.tenant_id);
  IF c.id IS NULL THEN
    LOOP
      v_prefix := upper(substr(translate(encode(public.gen_random_bytes(8), 'base64'), '+/=', ''), 1, 8));
      EXIT WHEN v_prefix ~ '^[A-Z0-9]{8}$' AND NOT EXISTS (SELECT 1 FROM public.payment_port_configs x WHERE x.order_prefix = v_prefix);
    END LOOP;
    INSERT INTO public.payment_port_configs (tenant_id, provider, provider_account, environment, channels, order_prefix, kek_version, created_by, created_as)
    VALUES (a.tenant_id, 'mock', 'mock-' || lower(substr(replace(a.tenant_id::text, '-', ''), 1, 12)), public.payment_deploy_env(),
            ARRAY['qris','va','payment_link'], v_prefix, p_kek_version, a.staff_id, a.role)
    RETURNING * INTO c;
    PERFORM public.audit_append('settings_change', 'payment_port', c.id, 'success', 'payment_port_enabled');
  END IF;
  RETURN jsonb_build_object('config_id', c.id, 'order_prefix', c.order_prefix, 'provider_account', c.provider_account, 'kek_version', c.kek_version);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_port_enable(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_port_enable(integer) TO clinic_app;--> statement-breakpoint

-- payment_charge_create (Kasir roles at the invoice's branch): a QRIS/VA/link charge for the invoice's outstanding (or
-- an amount ≤ it), split over its lines with kasir_allocate; generic description (SEC-15); expires per SET-14 link
-- hours. One pending charge per invoice: a retry returns the pending one (scenario 18: never a second charge).
-- p: {channel, amount?}. Returns {charge_id, order_ref, external_id, amount, expires_at, channel, is_simulated, reused}.
CREATE FUNCTION public.payment_charge_create(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  c public.payment_port_configs;
  ch public.payment_charges;
  v_out bigint;
  v_amount bigint;
  v_ids uuid[];
  v_room bigint[];
  v_alloc record;
  v_hours integer;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'channel' - 'amount' <> '{}'::jsonb OR coalesce(p ->> 'channel', '') NOT IN ('qris','va','payment_link')
     OR p ? 'amount' AND (jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^[1-9]\d{0,12}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: charge' USING ERRCODE = '22023';
  END IF;
  c := public.payment_port_of(i.tenant_id);
  IF NOT public.payment_port_usable(c) OR NOT (p ->> 'channel') = ANY (c.channels) OR p ->> 'channel' = 'qris' AND NOT public.kasir_method_enabled('qris', clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: payment_port' USING ERRCODE = '55000';
  END IF;
  -- A replay of the same key, or a pending charge of the invoice: return it (no second charge).
  SELECT * INTO ch FROM public.payment_charges x WHERE x.tenant_id = i.tenant_id AND (x.command_key = p_key OR x.invoice_id = i.id AND x.state = 'pending')
   ORDER BY (x.command_key = p_key) DESC LIMIT 1;
  IF ch.id IS NOT NULL THEN
    IF ch.invoice_id <> i.id THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a charge with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('charge_id', ch.id, 'order_ref', ch.order_ref, 'external_id', ch.external_id, 'amount', ch.amount, 'expires_at', ch.expires_at,
      'channel', ch.channel, 'is_simulated', ch.is_simulated, 'state', ch.state, 'reused', true);
  END IF;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id AND ap.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: void_pending' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id ORDER BY l.id FOR UPDATE;
  v_out := public.kasir_outstanding(i.tenant_id, i.id);
  v_amount := coalesce((p ->> 'amount')::bigint, v_out);
  IF v_amount < 1 OR v_amount > v_out THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: overpayment' USING ERRCODE = '22023';
  END IF;
  v_hours := coalesce((public.setting_value_at('SET-14', NULL, clock_timestamp()) ->> 'link_jam')::integer, 24);
  INSERT INTO public.payment_charges (tenant_id, branch_id, invoice_id, config_id, provider, provider_account, environment, channel, amount, description,
                                      order_ref, external_id, expires_at, is_simulated, command_key, created_by, created_as)
  VALUES (i.tenant_id, i.branch_id, i.id, c.id, c.provider, c.provider_account, c.environment, p ->> 'channel', v_amount,
          public.payment_description(i.tenant_id, i.id), c.order_prefix || '-' || replace(public.uuid_generate_v7()::text, '-', ''),
          'mock_' || replace(public.uuid_generate_v7()::text, '-', ''), clock_timestamp() + make_interval(hours => v_hours), c.provider = 'mock',
          p_key, a.staff_id, a.role)
  RETURNING * INTO ch;
  SELECT array_agg(l.id ORDER BY l.id), array_agg(l.line_total - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id)
    INTO v_ids, v_room FROM public.invoice_lines l
   WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.line_total - public.kasir_line_paid(l.tenant_id, l.id) > 0;
  FOR v_alloc IN SELECT * FROM public.kasir_allocate(v_amount, v_ids, v_room) LOOP
    INSERT INTO public.payment_charge_lines (tenant_id, branch_id, charge_id, invoice_line_id, amount) VALUES (i.tenant_id, i.branch_id, ch.id, v_alloc.line_id, v_alloc.amount);
  END LOOP;
  IF ch.is_simulated THEN
    INSERT INTO public.payment_mock_states (tenant_id, branch_id, charge_id, amount) VALUES (ch.tenant_id, ch.branch_id, ch.id, ch.amount);
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (i.tenant_id, i.branch_id, 'PaymentChargeCreated', 'payment_charge', ch.id, a.staff_id, a.role, jsonb_build_object('charge_id', ch.id, 'invoice_id', i.id));
  PERFORM public.audit_append('money_correction', 'payment_charge', ch.id, 'success', 'payment_charge_created');
  RETURN jsonb_build_object('charge_id', ch.id, 'order_ref', ch.order_ref, 'external_id', ch.external_id, 'amount', ch.amount, 'expires_at', ch.expires_at,
    'channel', ch.channel, 'is_simulated', ch.is_simulated, 'state', ch.state, 'reused', false);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_charge_create(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_charge_create(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- payment_charge_settle (internal; the single settle path of the webhook and the status poll, TD-41): the caller has
-- taken staff_access and locked the visit, the invoice and its lines (in that order), then the charge FOR UPDATE.
-- Idempotent on the charge: a paid charge returns {state: paid, receipt_id}. `paid` with the charge's exact amount:
-- one receipt (command key charge:<id>), one payment (method = channel; provider, account, environment, simulated
-- copied; the webhook event when there is one), allocations to the charge's lines up to their room, the rest to
-- balance_pending; flagged when the charge had expired or failed or was cancelled, when the invoice is void, or when
-- the lines had less room than the charge (paid after cash). A different amount is not recorded: amount_mismatch.
-- `expired` / `failed` / `cancelled` on a pending charge close it. Returns {outcome, state, receipt_id?, flag?}.
CREATE FUNCTION public.payment_charge_settle(ch public.payment_charges, i public.invoices, p_state text, p_amount bigint, p_event uuid, p_staff uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_at timestamptz := clock_timestamp();
  v_flag text;
  v_r jsonb;
  v_pending bigint;
  v_method text;
BEGIN
  IF ch.state = 'paid' THEN
    RETURN jsonb_build_object('outcome', 'duplicate', 'state', 'paid', 'receipt_id', ch.receipt_id);
  END IF;
  IF p_state IN ('expired','failed','cancelled') THEN
    IF ch.state = 'pending' THEN
      UPDATE public.payment_charges SET state = p_state WHERE tenant_id = ch.tenant_id AND id = ch.id;
      RETURN jsonb_build_object('outcome', 'applied', 'state', p_state);
    END IF;
    RETURN jsonb_build_object('outcome', 'duplicate', 'state', ch.state);
  END IF;
  IF p_state = 'pending' THEN
    RETURN jsonb_build_object('outcome', 'duplicate', 'state', ch.state);
  END IF;
  -- paid
  IF p_amount IS DISTINCT FROM ch.amount THEN
    RETURN jsonb_build_object('outcome', 'rejected_amount', 'state', ch.state, 'flag', 'amount_mismatch');
  END IF;
  v_flag := CASE WHEN ch.state = 'expired' OR ch.state = 'pending' AND ch.expires_at < v_at THEN 'paid_after_expiry'
                 WHEN ch.state IN ('failed','cancelled') OR i.state = 'void' THEN 'paid_after_failed' END;
  v_method := ch.channel;
  IF v_flag = 'paid_after_expiry' OR i.state = 'void' THEN
    -- Nothing reaches the lines: the whole amount waits for the patient balance (T-075).
    v_r := public.kasir_record_payment_unallocated(ch, i, p_event, p_staff, p_role, v_at);
  ELSE
    v_r := public.kasir_record_payment(i, 'charge:' || ch.id::text, jsonb_build_array(jsonb_build_object('method', v_method, 'amount', ch.amount)),
      jsonb_build_object('charge_id', ch.id, 'provider', ch.provider, 'provider_account', ch.provider_account, 'environment', ch.environment,
                         'is_simulated', ch.is_simulated, 'webhook_event_id', p_event), p_staff, p_role, v_at);
  END IF;
  v_pending := ch.amount - coalesce((v_r ->> 'allocated')::bigint, 0);
  IF v_flag IS NULL AND v_pending > 0 THEN
    v_flag := 'paid_after_cash';
  END IF;
  UPDATE public.payment_charges SET state = 'paid', receipt_id = (v_r ->> 'receipt_id')::uuid, settled_at = v_at, review_flag = v_flag, balance_pending = v_pending
   WHERE tenant_id = ch.tenant_id AND id = ch.id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (ch.tenant_id, ch.branch_id, 'PaymentChargeSettled', 'payment_charge', ch.id, p_staff, p_role, jsonb_build_object('charge_id', ch.id, 'receipt_id', (v_r ->> 'receipt_id')::uuid));
  RETURN jsonb_build_object('outcome', CASE WHEN v_flag IS NULL THEN 'applied' ELSE 'flagged' END, 'state', 'paid', 'receipt_id', v_r -> 'receipt_id', 'flag', v_flag);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_charge_settle(public.payment_charges, public.invoices, text, bigint, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- A port payment with no allocation (paid after expiry, or on a void invoice): one receipt and one payment against the
-- charge; nothing reaches the lines (balance_pending carries it). The visit step is recomputed as usual.
CREATE FUNCTION public.kasir_record_payment_unallocated(ch public.payment_charges, i public.invoices, p_event uuid, p_staff uuid, p_role text, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_number text := public.kasir_next_number(i.tenant_id, i.branch_id, 'KW');
  v_receipt uuid;
  v_payment uuid;
  rb record;
BEGIN
  SELECT * INTO rb FROM public.kasir_receipt_body(i, v_number, p_at, jsonb_build_array(jsonb_build_object('method', ch.channel, 'amount', ch.amount)));
  INSERT INTO public.receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, template_version_id, is_simulated, command_key, issued_by, issued_as, issued_at)
  VALUES (i.tenant_id, i.branch_id, i.id, v_number, ch.amount, CASE WHEN ch.is_simulated THEN E'SIMULASI\n' || rb.body ELSE rb.body END, rb.paper,
          rb.template_version_id, ch.is_simulated, 'charge:' || ch.id::text, p_staff, p_role, p_at)
  RETURNING id INTO v_receipt;
  INSERT INTO public.payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, provider, provider_account, environment, is_simulated,
                               charge_id, webhook_event_id, received_by, received_as, received_at)
  VALUES (i.tenant_id, i.branch_id, v_receipt, 1, i.id, i.patient_id, ch.channel, ch.amount, ch.provider, ch.provider_account, ch.environment, ch.is_simulated,
          ch.id, p_event, p_staff, p_role, p_at)
  RETURNING id INTO v_payment;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (i.tenant_id, i.branch_id, 'PaymentReceived', 'payment', v_payment, p_staff, p_role, jsonb_build_object('payment_id', v_payment, 'invoice_id', i.id));
  RETURN jsonb_build_object('receipt_id', v_receipt, 'number', v_number, 'paid', ch.amount, 'change', 0, 'allocated', 0);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kasir_record_payment_unallocated(public.payment_charges, public.invoices, uuid, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- The lock order of every port path: the visit, the invoice, its lines in id order, then the charge (the caller has
-- staff_access). Returns the charge and its invoice locked.
CREATE FUNCTION public.payment_charge_locked(p_tenant uuid, p_charge uuid, OUT ch public.payment_charges, OUT i public.invoices)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_invoice uuid;
  v_visit uuid;
BEGIN
  SELECT x.invoice_id INTO v_invoice FROM public.payment_charges x WHERE x.tenant_id = p_tenant AND x.id = p_charge;
  IF v_invoice IS NULL THEN
    RETURN;
  END IF;
  SELECT x.visit_id INTO v_visit FROM public.invoices x WHERE x.tenant_id = p_tenant AND x.id = v_invoice;
  IF v_visit IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = p_tenant AND v.id = v_visit FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = p_tenant AND x.id = v_invoice FOR UPDATE;
  PERFORM 1 FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = v_invoice ORDER BY l.id FOR UPDATE;
  SELECT * INTO ch FROM public.payment_charges x WHERE x.tenant_id = p_tenant AND x.id = p_charge FOR UPDATE;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_charge_locked(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- payment_charge_poll (Kasir roles; "Cek Status", the lost-webhook path of scenario 18): the server asked the adapter
-- for the charge's status (TypeScript, the mock reads payment_mock_states) and passes what it saw; settles through the
-- same path; never creates a charge. p: {state, amount}. Returns the settle result.
CREATE FUNCTION public.payment_charge_poll(p_charge uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  l record;
  v_r jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'state' - 'amount' <> '{}'::jsonb OR coalesce(p ->> 'state', '') NOT IN ('pending','paid','expired','failed','cancelled')
     OR jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^\d{1,13}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM public.payment_charge_locked(a.tenant_id, p_charge);
  IF (l.ch).id IS NULL OR a.branch_id IS NOT NULL AND (l.ch).branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: charge not found' USING ERRCODE = 'P0002';
  END IF;
  v_r := public.payment_charge_settle(l.ch, l.i, p ->> 'state', (p ->> 'amount')::bigint, NULL, a.staff_id, a.role);
  PERFORM public.audit_append('money_correction', 'payment_charge', p_charge, CASE WHEN v_r ->> 'outcome' = 'rejected_amount' THEN 'denied' ELSE 'success' END,
    'payment_charge_polled');
  RETURN v_r;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_charge_poll(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_charge_poll(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- payment_charge_cancel (Kasir roles): a pending charge is cancelled (the adapter cancels it at the provider first; the
-- mock state follows). A paid one cannot be.
CREATE FUNCTION public.payment_charge_cancel(p_charge uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  l record;
BEGIN
  SELECT * INTO l FROM public.payment_charge_locked(a.tenant_id, p_charge);
  IF (l.ch).id IS NULL OR a.branch_id IS NOT NULL AND (l.ch).branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: charge not found' USING ERRCODE = 'P0002';
  END IF;
  IF (l.ch).state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: charge %', (l.ch).state USING ERRCODE = '55000';
  END IF;
  UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = a.tenant_id AND id = p_charge;
  UPDATE public.payment_mock_states SET state = 'cancelled', changed_at = clock_timestamp() WHERE tenant_id = a.tenant_id AND charge_id = p_charge AND state = 'pending';
  PERFORM public.audit_append('money_correction', 'payment_charge', p_charge, 'success', 'payment_charge_cancelled');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_charge_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_charge_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- payment_refund (owner or manager; the port operation only, TD-43 "refund idempotent incl. partial"; T-078 owns the
-- patient-facing refund): a replay of the key returns the same refund; Σ ≤ the paid charge. Returns {refund_id, refunded}.
CREATE FUNCTION public.payment_refund(p_key text, p_charge uuid, p_amount bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  l record;
  r public.payment_refunds;
BEGIN
  IF a.role NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not refund a charge' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.payment_charge_locked(a.tenant_id, p_charge);
  IF (l.ch).id IS NULL OR a.branch_id IS NOT NULL AND (l.ch).branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: charge not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.payment_refunds x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF r.id IS NOT NULL THEN
    IF r.charge_id <> p_charge OR r.amount <> p_amount THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a refund with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('refund_id', r.id, 'replayed', true,
      'refunded', (SELECT sum(x.amount) FROM public.payment_refunds x WHERE x.tenant_id = a.tenant_id AND x.charge_id = p_charge));
  END IF;
  IF (l.ch).state <> 'paid' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: charge %', (l.ch).state USING ERRCODE = '55000';
  END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount + (SELECT coalesce(sum(x.amount), 0) FROM public.payment_refunds x WHERE x.tenant_id = a.tenant_id AND x.charge_id = p_charge) > (l.ch).amount THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refund_amount' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.payment_refunds (tenant_id, branch_id, charge_id, amount, provider_refund_id, state, command_key, created_by, created_as)
  VALUES (a.tenant_id, (l.ch).branch_id, p_charge, p_amount, 'mock_rf_' || replace(public.uuid_generate_v7()::text, '-', ''), 'succeeded', p_key, a.staff_id, a.role)
  RETURNING * INTO r;
  PERFORM public.audit_append('money_correction', 'payment_charge', p_charge, 'success', 'payment_refunded');
  RETURN jsonb_build_object('refund_id', r.id, 'replayed', false,
    'refunded', (SELECT sum(x.amount) FROM public.payment_refunds x WHERE x.tenant_id = a.tenant_id AND x.charge_id = p_charge));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_refund(text, uuid, bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_refund(text, uuid, bigint) TO clinic_app;--> statement-breakpoint

-- ── Webhook ingest (TD-40, TD-41, TD-43, SEC-8; unbound worker connection; plan r1 P1-1, P1-2, P1-5) ─────────────

-- The route of an order prefix for the webhook verifier (unbound; the TypeScript route derives the secret from the
-- KEK version and checks the signature): {tenant_id, provider, provider_account, environment, kek_version, usable}, or
-- null for an unknown prefix (dropped and logged by the ingest call).
CREATE FUNCTION public.payment_webhook_route(p_order_ref text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.payment_port_configs;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'payment_webhook_route runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_order_ref, '') !~ '^[A-Z0-9]{6,12}-[0-9a-f]{32}$' THEN
    RETURN NULL;
  END IF;
  SELECT x.* INTO c FROM public.payment_port_configs x WHERE x.order_prefix = split_part(p_order_ref, '-', 1) AND x.active;
  IF c.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('tenant_id', c.tenant_id, 'provider', c.provider, 'provider_account', c.provider_account, 'environment', c.environment,
    'kek_version', c.kek_version, 'usable', public.payment_port_usable(c));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_webhook_route(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_webhook_route(text) TO clinic_app;--> statement-breakpoint

-- payment_webhook_ingest (unbound): e = {provider, provider_account, environment, event_id, order_ref, state, amount},
-- with the route's verdict on the signature and the timestamp window and the body's sha-256. Order (r1 P1-2):
-- 1. route by the order prefix — unknown: logged on the platform (vendor_log), no tenant row;
-- 2. the routed tenant's staff_access lock, then provider/account/environment against the route — mismatch: an event
--    row dropped_tenant_mismatch, audited;
-- 3. signature and window — refused: an event row with the refusal, audited; never claims the event id;
-- 4. a verified event: duplicate of an applied event id → a duplicate row, nothing else; else the row as `received`,
--    the charge locked (visit → invoice → lines → charge) and settled; the row's outcome set once. Returns the outcome.
CREATE FUNCTION public.payment_webhook_ingest(e jsonb, p_signature_ok boolean, p_timestamp_ok boolean, p_body_sha256 text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.payment_port_configs;
  l record;
  v_tenant uuid;
  v_event uuid;
  v_r jsonb;
  v_outcome text;
  v_charge uuid;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'payment_webhook_ingest runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR coalesce(p_body_sha256, '') !~ '^[0-9a-f]{64}$' OR p_signature_ok IS NULL OR p_timestamp_ok IS NULL
     OR coalesce(e ->> 'event_id', '') !~ '^[A-Za-z0-9_.:-]{8,80}$' OR coalesce(e ->> 'order_ref', '') !~ '^[A-Z0-9]{6,12}-[0-9a-f]{32}$'
     OR coalesce(e ->> 'provider', '') NOT IN ('mock') OR coalesce(e ->> 'environment', '') NOT IN ('production','staging','demo','local')
     OR coalesce(e ->> 'provider_account', '') !~ '^[a-z0-9][a-z0-9_.-]{2,79}$'
     OR coalesce(e ->> 'state', '') NOT IN ('pending','paid','expired','failed','cancelled')
     OR jsonb_typeof(e -> 'amount') IS DISTINCT FROM 'number' OR (e ->> 'amount') !~ '^\d{1,13}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: webhook' USING ERRCODE = '22023';
  END IF;
  SELECT x.* INTO c FROM public.payment_port_configs x WHERE x.order_prefix = split_part(e ->> 'order_ref', '-', 1) AND x.active;
  IF c.id IS NULL THEN
    PERFORM public.vendor_log(NULL, NULL, NULL, 'payment_webhook_drop', NULL, NULL, 'denied', 'unknown_route', NULL, NULL, 'payment_webhook');
    RETURN 'dropped_unknown_route';
  END IF;
  v_tenant := c.tenant_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_tenant::text, 0));
  IF (e ->> 'provider', e ->> 'provider_account', e ->> 'environment') IS DISTINCT FROM (c.provider, c.provider_account, c.environment) THEN
    v_outcome := 'dropped_tenant_mismatch';
  ELSIF NOT p_signature_ok THEN
    v_outcome := 'rejected_signature';
  ELSIF NOT p_timestamp_ok THEN
    v_outcome := 'rejected_window';
  ELSIF NOT public.payment_port_usable(c) THEN
    v_outcome := 'dropped_tenant_mismatch';
  END IF;
  SELECT x.id INTO v_charge FROM public.payment_charges x WHERE x.tenant_id = v_tenant AND x.order_ref = e ->> 'order_ref';
  IF v_outcome IS NOT NULL THEN
    INSERT INTO public.payment_webhook_events (tenant_id, provider, provider_account, environment, provider_event_id, order_ref, charge_id, observed_state, amount,
                                               signature_ok, timestamp_ok, outcome, body_sha256)
    VALUES (v_tenant, c.provider, c.provider_account, c.environment, e ->> 'event_id', e ->> 'order_ref', v_charge, e ->> 'state', (e ->> 'amount')::bigint,
            p_signature_ok, p_timestamp_ok, v_outcome, p_body_sha256)
    RETURNING id INTO v_event;
    PERFORM public.payment_audit_service(v_tenant, 'access_denied', 'payment_webhook', v_event, 'denied', v_outcome);
    RETURN v_outcome;
  END IF;
  -- Verified. A repeat of an event id already applied is a duplicate (TD-43: one payment).
  IF EXISTS (SELECT 1 FROM public.payment_webhook_events x WHERE x.provider = c.provider AND x.provider_account = c.provider_account AND x.environment = c.environment
               AND x.provider_event_id = e ->> 'event_id' AND x.outcome IN ('received','applied','flagged','rejected_amount')) THEN
    INSERT INTO public.payment_webhook_events (tenant_id, provider, provider_account, environment, provider_event_id, order_ref, charge_id, observed_state, amount,
                                               signature_ok, timestamp_ok, outcome, body_sha256)
    VALUES (v_tenant, c.provider, c.provider_account, c.environment, e ->> 'event_id', e ->> 'order_ref', v_charge, e ->> 'state', (e ->> 'amount')::bigint,
            true, true, 'duplicate', p_body_sha256);
    RETURN 'duplicate';
  END IF;
  IF v_charge IS NULL THEN
    INSERT INTO public.payment_webhook_events (tenant_id, provider, provider_account, environment, provider_event_id, order_ref, observed_state, amount,
                                               signature_ok, timestamp_ok, outcome, body_sha256)
    VALUES (v_tenant, c.provider, c.provider_account, c.environment, e ->> 'event_id', e ->> 'order_ref', e ->> 'state', (e ->> 'amount')::bigint,
            true, true, 'dropped_unknown_charge', p_body_sha256)
    RETURNING id INTO v_event;
    PERFORM public.payment_audit_service(v_tenant, 'access_denied', 'payment_webhook', v_event, 'denied', 'dropped_unknown_charge');
    RETURN 'dropped_unknown_charge';
  END IF;
  INSERT INTO public.payment_webhook_events (tenant_id, provider, provider_account, environment, provider_event_id, order_ref, charge_id, observed_state, amount,
                                             signature_ok, timestamp_ok, outcome, body_sha256)
  VALUES (v_tenant, c.provider, c.provider_account, c.environment, e ->> 'event_id', e ->> 'order_ref', v_charge, e ->> 'state', (e ->> 'amount')::bigint,
          true, true, 'received', p_body_sha256)
  RETURNING id INTO v_event;
  SELECT * INTO l FROM public.payment_charge_locked(v_tenant, v_charge);
  v_r := public.payment_charge_settle(l.ch, l.i, e ->> 'state', (e ->> 'amount')::bigint, v_event, (l.ch).created_by, (l.ch).created_as);
  v_outcome := v_r ->> 'outcome';
  UPDATE public.payment_webhook_events SET outcome = v_outcome WHERE tenant_id = v_tenant AND id = v_event;
  PERFORM public.payment_audit_service(v_tenant, 'money_correction', 'payment_charge', v_charge,
    CASE WHEN v_outcome IN ('applied','flagged','duplicate') THEN 'success' ELSE 'denied' END, 'payment_webhook_' || v_outcome);
  RETURN v_outcome;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_webhook_ingest(jsonb, boolean, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_webhook_ingest(jsonb, boolean, boolean, text) TO clinic_app;--> statement-breakpoint

-- ── The simulator (UX-56; FO/cashier and manager of the branch, owner and finance; non-production only) ──────────
-- simulasi_set(charge, action): the mock gateway's own state of a charge changes (paid | expired | failed) or its last
-- webhook is sent again (resend) or a late copy is prepared (late); the clinic's charge is untouched (only the settle
-- path changes it). Returns the webhook payload to sign and deliver after this transaction commits (r1 P1-3); null
-- when nothing is sent. Actions: paid, expired, failed (new event id each), resend (the same event id).
CREATE FUNCTION public.simulasi_set(p_charge uuid, p_action text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  l record;
  m public.payment_mock_states;
BEGIN
  IF public.payment_deploy_env() = 'production' THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: mock_in_production' USING ERRCODE = '55000';
  END IF;
  IF coalesce(p_action, '') NOT IN ('paid','expired','failed','resend') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM public.payment_charge_locked(a.tenant_id, p_charge);
  IF (l.ch).id IS NULL OR NOT (l.ch).is_simulated OR a.branch_id IS NOT NULL AND (l.ch).branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: charge not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO m FROM public.payment_mock_states x WHERE x.tenant_id = a.tenant_id AND x.charge_id = p_charge FOR UPDATE;
  IF p_action = 'resend' THEN
    IF m.last_event_id IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing_sent' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF m.state = 'paid' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: mock_paid' USING ERRCODE = '55000';
    END IF;
    UPDATE public.payment_mock_states SET state = p_action, changed_at = clock_timestamp(), event_seq = event_seq + 1,
           last_event_id = 'mockevt_' || replace((l.ch).id::text, '-', '') || '_' || (event_seq + 1)
     WHERE tenant_id = a.tenant_id AND id = m.id RETURNING * INTO m;
  END IF;
  PERFORM public.audit_append('money_correction', 'payment_charge', p_charge, 'success', 'simulasi_' || p_action);
  RETURN public.payment_mock_payload(l.ch, m);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.simulasi_set(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.simulasi_set(uuid, text) TO clinic_app;--> statement-breakpoint

-- The mock adapter's status(): what the mock gateway says about a charge now (the Kasir's Cek Status passes it to
-- payment_charge_poll). Kasir roles at the branch.
CREATE FUNCTION public.payment_mock_status(p_charge uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  ch public.payment_charges;
  m public.payment_mock_states;
BEGIN
  SELECT * INTO ch FROM public.payment_charges x WHERE x.tenant_id = a.tenant_id AND x.id = p_charge;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND ch.branch_id <> a.branch_id OR NOT ch.is_simulated THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: charge not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO m FROM public.payment_mock_states x WHERE x.tenant_id = a.tenant_id AND x.charge_id = p_charge;
  RETURN jsonb_build_object('state', m.state, 'amount', m.amount, 'at', m.changed_at);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payment_mock_status(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payment_mock_status(uuid) TO clinic_app;--> statement-breakpoint

-- kasir_receipt_body (re-created from 0087): QRIS, VA and Link Bayar named on the receipt.
CREATE OR REPLACE FUNCTION public.kasir_receipt_body(i public.invoices, p_number text, p_at timestamptz, p_tenders jsonb, OUT body text, OUT paper text, OUT template_version_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.branches;
  tv public.document_template_versions;
  vi jsonb := public.vendor_identity();
  v_lines text;
  v_methods text;
  v_vals jsonb;
  rp text;
BEGIN
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = i.tenant_id AND x.id = i.branch_id;
  SELECT string_agg(cv.name || ' × ' || l.quantity || '  Rp' || to_char(l.line_total, 'FM999G999G999G999'), E'\n' ORDER BY l.created_at, l.id)
    INTO v_lines FROM public.invoice_lines l JOIN public.catalog_versions cv ON cv.tenant_id = l.tenant_id AND cv.id = l.catalog_version_id
   WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id;
  SELECT string_agg(CASE t ->> 'method' WHEN 'cash' THEN 'Tunai' WHEN 'edc' THEN 'EDC' WHEN 'transfer' THEN 'Transfer' WHEN 'qris' THEN 'QRIS' WHEN 'va' THEN 'Virtual Account' WHEN 'payment_link' THEN 'Link Bayar' ELSE t ->> 'method' END
                    || ' Rp' || to_char((t ->> 'amount')::bigint, 'FM999G999G999G999'), ', ')
    INTO v_methods FROM jsonb_array_elements(p_tenders) t;
  rp := 'Rp' || to_char((SELECT sum((t ->> 'amount')::bigint) FROM jsonb_array_elements(p_tenders) t), 'FM999G999G999G999');
  v_vals := jsonb_build_object(
    'klinik.nama', (SELECT t.legal_name FROM public.tenants t WHERE t.id = i.tenant_id),
    'klinik.npwp', (SELECT t.npwp FROM public.tenants t WHERE t.id = i.tenant_id),
    'cabang.nama', b.name, 'cabang.alamat', b.address,
    'tanggal', to_char((p_at AT TIME ZONE b.timezone), 'DD-MM-YYYY HH24:MI'),
    'struk.nomor', p_number, 'struk.baris', replace(v_lines, ',', '.'), 'struk.total', replace(rp, ',', '.'), 'struk.metode_bayar', replace(v_methods, ',', '.'),
    'pasien.nama', (SELECT pt.full_name FROM public.patients pt WHERE pt.tenant_id = i.tenant_id AND pt.id = public.patient_canonical(i.tenant_id, i.patient_id)),
    'pasien.no_rm', (SELECT pt.mrn FROM public.patients pt WHERE pt.tenant_id = i.tenant_id AND pt.id = public.patient_canonical(i.tenant_id, i.patient_id)),
    'vendor.nama', coalesce(vi ->> 'legal_name', '') || CASE WHEN vi -> 'placeholders' ? 'legal_name' THEN ' (contoh, belum diisi)' ELSE '' END);
  SELECT v.* INTO tv FROM public.document_template_versions v JOIN public.document_templates t ON t.tenant_id = v.tenant_id AND t.id = v.template_id
   WHERE v.tenant_id = i.tenant_id AND v.kind = 'receipt' AND v.state = 'active' AND t.state = 'active'
   ORDER BY v.created_at DESC, v.id DESC LIMIT 1;
  IF tv.id IS NOT NULL THEN
    body := public.template_fill(tv.body, v_vals);
    paper := tv.paper;
    template_version_id := tv.id;
    UPDATE public.document_template_versions SET used_at = clock_timestamp() WHERE tenant_id = tv.tenant_id AND id = tv.id AND used_at IS NULL;
  ELSE
    body := public.template_fill(E'{{klinik.nama}}\n{{cabang.nama}} · {{cabang.alamat}}\nNPWP {{klinik.npwp}}\n\nStruk {{struk.nomor}}\n{{tanggal}}\n\n{{struk.baris}}\n\nTotal dibayar {{struk.total}}\n{{struk.metode_bayar}}', v_vals);
    paper := '80mm';
  END IF;
END
$$;--> statement-breakpoint

-- invoice_void_sync (re-created from 0087): the void also cancels the invoice's pending port charge.
CREATE OR REPLACE FUNCTION public.invoice_void_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.invoices;
BEGIN
  IF NEW.type <> 'invoice_void' OR NEW.subject_kind <> 'invoice' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO i FROM public.invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.subject_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NEW.state IN ('approved','rejected') AND NEW.decided_as = 'manager' AND NOT public.kasir_manager_may_void(i.tenant_id, i.id, clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner may decide this void' USING ERRCODE = '42501';
  END IF;
  IF NEW.state <> 'approved' THEN
    RETURN NULL;
  END IF;
  IF i.state <> 'issued' OR EXISTS (SELECT 1 FROM public.payments y WHERE y.tenant_id = i.tenant_id AND y.invoice_id = i.id)
     OR EXISTS (SELECT 1 FROM public.dispensings d JOIN public.invoice_lines l ON l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id
                 WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND d.state = 'handed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_paid' USING ERRCODE = '55000';
  END IF;
  UPDATE public.invoices SET state = 'void', void_approval_id = NEW.id, voided_at = clock_timestamp() WHERE tenant_id = i.tenant_id AND id = i.id;
  -- T-073 (r1 P1-4): a pending port charge of the invoice is cancelled (a late paid webhook then waits for the balance).
  UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = i.tenant_id AND invoice_id = i.id AND state = 'pending';
  UPDATE public.dispensings d SET state = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = NEW.decided_by, cancel_reason = 'Invoice dibatalkan'
    FROM public.invoice_lines l
   WHERE d.tenant_id = i.tenant_id AND l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id AND l.invoice_id = i.id AND d.state IN ('queued','prepared');
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceVoided', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'approval_id', NEW.id));
  RETURN NULL;
END
$$;--> statement-breakpoint

-- kasir_invoice_get (re-created from 0087, the same signature): the port's tenders, its charges, simulated receipts.
CREATE OR REPLACE FUNCTION public.kasir_invoice_get(p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  i public.invoices;
  v_mask boolean := a.role = 'auditor';
  v_at timestamptz := clock_timestamp();
  c public.payment_port_configs;
  v_port boolean;
  v_prod_mock boolean;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  c := public.payment_port_of(i.tenant_id);
  v_port := public.payment_port_usable(c);
  -- BILL-29, scenario PR-68: a production tenant whose port is the mock is not offered QRIS, VA or link at all.
  v_prod_mock := c.id IS NOT NULL AND c.provider = 'mock' AND public.payment_deploy_env() = 'production';
  RETURN public.kasir_invoice_row(i, v_mask) || jsonb_build_object(
    'branch', (SELECT jsonb_build_object('id', b.id, 'name', b.name) FROM public.branches b WHERE b.tenant_id = i.tenant_id AND b.id = i.branch_id),
    'is_pkp_at_issue', i.is_pkp_at_issue, 'voided_at', i.voided_at, 'role', a.role,
    'can_pay', a.role IN ('owner','manager','fo_cashier','finance'),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'name', cv.name, 'quantity', l.quantity, 'unit_price', l.unit_price,
                                 'discount', l.discount, 'line_total', l.line_total, 'tax_category', l.tax_category, 'vat_amount', l.vat_amount,
                                 'vat_recognised', l.vat_recognised_amount, 'paid', public.kasir_line_paid(l.tenant_id, l.id),
                                 'dispensing', (SELECT jsonb_build_object('id', d.id, 'state', d.state) FROM public.dispensings d WHERE d.tenant_id = l.tenant_id AND d.invoice_line_id = l.id))
                                 ORDER BY l.created_at, l.id)
                         FROM public.invoice_lines l JOIN public.catalog_versions cv ON cv.tenant_id = l.tenant_id AND cv.id = l.catalog_version_id
                        WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'total', r.total, 'issued_at', r.issued_at, 'is_simulated', r.is_simulated,
                                    'payments', (SELECT jsonb_agg(jsonb_build_object('seq', y.seq, 'method', y.method, 'amount', y.amount, 'change', y.change_given) ORDER BY y.seq)
                                                   FROM public.payments y WHERE y.tenant_id = r.tenant_id AND y.receipt_id = r.id)) ORDER BY r.issued_at, r.id)
                            FROM public.receipts r WHERE r.tenant_id = i.tenant_id AND r.invoice_id = i.id), '[]'::jsonb),
    -- QRIS, VA and link: available through a usable port with the channel (QRIS also enabled in SET-14); VA listed only
    -- for a provisioned port that has it (r2 F-4); none of them in production with the mock.
    'tenders', (SELECT jsonb_agg(jsonb_build_object('method', m.k, 'available', m.ok, 'blocked', m.why) ORDER BY m.o) FROM (VALUES
        (1, 'cash', public.kasir_method_enabled('cash', v_at), CASE WHEN NOT public.kasir_method_enabled('cash', v_at) THEN 'method_disabled' END),
        (2, 'qris', v_port AND 'qris' = ANY (c.channels) AND public.kasir_method_enabled('qris', v_at),
            CASE WHEN NOT v_port OR NOT 'qris' = ANY (coalesce(c.channels, '{}')) THEN 'payment_port' WHEN NOT public.kasir_method_enabled('qris', v_at) THEN 'method_disabled' END),
        (3, 'edc', public.kasir_method_enabled('edc', v_at), CASE WHEN NOT public.kasir_method_enabled('edc', v_at) THEN 'method_disabled' END),
        (4, 'transfer', public.kasir_method_enabled('transfer', v_at), CASE WHEN NOT public.kasir_method_enabled('transfer', v_at) THEN 'method_disabled' END),
        (5, 'va', v_port AND 'va' = ANY (c.channels), NULL),
        (6, 'payment_link', v_port AND 'payment_link' = ANY (coalesce(c.channels, '{}')), CASE WHEN NOT (v_port AND 'payment_link' = ANY (coalesce(c.channels, '{}'))) THEN 'payment_port' END),
        (7, 'balance', false, 'balance')) m(o, k, ok, why)
      WHERE NOT (v_prod_mock AND m.k IN ('qris','va','payment_link')) AND NOT (m.k = 'va' AND NOT (v_port AND 'va' = ANY (coalesce(c.channels, '{}'))))),
    'port', CASE WHEN v_port THEN jsonb_build_object('provider', c.provider, 'simulated', c.provider = 'mock') END,
    'charges', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'channel', x.channel, 'amount', x.amount, 'state', x.state, 'order_ref', x.order_ref,
                                   'expires_at', x.expires_at, 'is_simulated', x.is_simulated, 'review_flag', x.review_flag, 'balance_pending', x.balance_pending,
                                   'receipt_id', x.receipt_id) ORDER BY x.created_at DESC, x.id)
                           FROM public.payment_charges x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id), '[]'::jsonb),
    'void', (SELECT jsonb_build_object('approval_id', ap.id, 'state', ap.state, 'requested_at', ap.requested_at,
                                       'reason', CASE WHEN v_mask THEN NULL ELSE ap.request_reason END)
               FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id
              ORDER BY ap.requested_at DESC LIMIT 1));
END
$$;--> statement-breakpoint

-- receipt_get (re-created from 0087): says whether the receipt is simulated (SIMULASI).
CREATE OR REPLACE FUNCTION public.receipt_get(p_receipt uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  r public.receipts;
  v_body text;
  pt public.patients;
BEGIN
  SELECT * INTO r FROM public.receipts x WHERE x.tenant_id = a.tenant_id AND x.id = p_receipt;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND r.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: receipt not found' USING ERRCODE = 'P0002';
  END IF;
  v_body := r.body;
  IF a.role = 'auditor' THEN
    SELECT p.* INTO pt FROM public.invoices i JOIN public.patients p ON p.tenant_id = i.tenant_id AND p.id = public.patient_canonical(i.tenant_id, i.patient_id)
     WHERE i.tenant_id = r.tenant_id AND i.id = r.invoice_id;
    IF pt.id IS NOT NULL THEN
      v_body := replace(replace(v_body, pt.full_name, '***'), pt.mrn, '***' || right(pt.mrn, 3));
    END IF;
  END IF;
  RETURN jsonb_build_object('id', r.id, 'number', r.number, 'invoice_id', r.invoice_id, 'total', r.total, 'paper', r.paper, 'body', v_body, 'issued_at', r.issued_at,
    'is_simulated', r.is_simulated,
    'payments', (SELECT jsonb_agg(jsonb_build_object('seq', y.seq, 'method', y.method, 'amount', y.amount, 'change', y.change_given) ORDER BY y.seq)
                   FROM public.payments y WHERE y.tenant_id = r.tenant_id AND y.receipt_id = r.id));
END
$$;--> statement-breakpoint

-- Simulasi (UX-56): the tenant's simulated charges at the branch (a tenant-wide reader names it, else every branch),
-- pending first, with the mock gateway's state; whether the mock port is enabled and usable here. Kasir readers.
CREATE FUNCTION public.simulasi_list(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(p_branch);
  c public.payment_port_configs := public.payment_port_of(a.tenant_id);
BEGIN
  RETURN jsonb_build_object('environment', public.payment_deploy_env(), 'role', a.role,
    'port', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('provider', c.provider, 'order_prefix', c.order_prefix, 'usable', public.payment_port_usable(c)) END,
    'can_enable', a.role IN ('owner','manager') AND public.payment_deploy_env() <> 'production',
    'charges', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'invoice_id', x.invoice_id, 'invoice_number', i.number, 'channel', x.channel, 'amount', x.amount,
                                   'state', x.state, 'mock_state', m.state, 'mock_event', m.last_event_id, 'expires_at', x.expires_at, 'review_flag', x.review_flag,
                                   'balance_pending', x.balance_pending, 'created_at', x.created_at)
                                   ORDER BY (x.state = 'pending') DESC, x.created_at DESC, x.id)
                           FROM (SELECT * FROM public.payment_charges y WHERE y.tenant_id = a.tenant_id AND y.is_simulated
                                   AND (a.branch_id IS NULL OR y.branch_id = a.branch_id) ORDER BY y.created_at DESC LIMIT 100) x
                           JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
                           LEFT JOIN public.payment_mock_states m ON m.tenant_id = x.tenant_id AND m.charge_id = x.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.simulasi_list(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.simulasi_list(uuid) TO clinic_app;
