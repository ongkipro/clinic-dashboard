CREATE TABLE "autolaris_settlement_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"meaning" text NOT NULL,
	"status" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"flag" text,
	"evidence_ref" text,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "autolaris_settlement_rules_key" UNIQUE("meaning","status"),
	CONSTRAINT "autolaris_settlement_rules_check" CHECK ("autolaris_settlement_rules"."meaning" in ('settled','expired','failed') and "autolaris_settlement_rules"."status" ~ '^[A-Z0-9_]{2,40}$'
      and (not "autolaris_settlement_rules"."confirmed" or "autolaris_settlement_rules"."evidence_ref" is not null) and ("autolaris_settlement_rules"."flag" is null or "autolaris_settlement_rules"."flag" = 'pending_q13'))
);
--> statement-breakpoint
CREATE TABLE "server_fee_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount_rupiah" integer NOT NULL,
	"effective_month" text NOT NULL,
	"reason" text NOT NULL,
	"request_id" uuid NOT NULL,
	"proposed_by" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "server_fee_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "server_fee_versions_tenant_month_key" UNIQUE("tenant_id","effective_month"),
	CONSTRAINT "server_fee_versions_request_key" UNIQUE("request_id"),
	CONSTRAINT "server_fee_versions_check" CHECK ("server_fee_versions"."amount_rupiah" > 0 and "server_fee_versions"."effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and length(btrim("server_fee_versions"."reason")) between 10 and 500
      and "server_fee_versions"."proposed_by" <> "server_fee_versions"."approved_by")
);
--> statement-breakpoint
CREATE TABLE "vendor_advice_observations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"source" text NOT NULL,
	"http_status" integer,
	"rc" text,
	"status" text,
	"amount_rupiah" integer,
	"interpreted" text NOT NULL,
	"rule_id" uuid,
	"raw" jsonb NOT NULL,
	CONSTRAINT "vendor_advice_observations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vendor_advice_observations_check" CHECK ("vendor_advice_observations"."source" in ('advice','create_late') and "vendor_advice_observations"."interpreted" in ('pending','settled','settled_unconfirmed',
      'expired','failed','expired_unconfirmed','failed_unconfirmed','amount_mismatch','envelope_error','unrecognized','transport_error')
      and ("vendor_advice_observations"."rc" is null or length("vendor_advice_observations"."rc") <= 8) and ("vendor_advice_observations"."status" is null or length("vendor_advice_observations"."status") <= 40) and jsonb_typeof("vendor_advice_observations"."raw") = 'object'
      and length("vendor_advice_observations"."raw"::text) <= 4000)
);
--> statement-breakpoint
CREATE TABLE "vendor_attempt_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"evidence_ref" text NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_as" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vendor_attempt_notes_check" CHECK (length(btrim("vendor_attempt_notes"."evidence_ref")) between 3 and 120 and length(btrim("vendor_attempt_notes"."reason")) between 10 and 500
      and "vendor_attempt_notes"."recorded_as" = 'vendor_finance')
);
--> statement-breakpoint
CREATE TABLE "vendor_billing_policy" (
	"id" integer PRIMARY KEY NOT NULL,
	"channel_fee_bearer" text,
	"fee_bearer_ref" text,
	"tax_treatment_ref" text,
	CONSTRAINT "vendor_billing_policy_check" CHECK ("vendor_billing_policy"."id" = 1 and ("vendor_billing_policy"."channel_fee_bearer" is null or "vendor_billing_policy"."channel_fee_bearer" in ('tenant','vendor'))
      and ("vendor_billing_policy"."channel_fee_bearer" is null) = ("vendor_billing_policy"."fee_bearer_ref" is null) and ("vendor_billing_policy"."tax_treatment_ref" is null or length(btrim("vendor_billing_policy"."tax_treatment_ref")) between 3 and 200))
);
--> statement-breakpoint
CREATE TABLE "vendor_billing_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid,
	"period" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vendor_billing_reviews_check" CHECK ("vendor_billing_reviews"."kind" in ('advice_unconfirmed','amount_mismatch','attempt_unknown','tax_status_unknown')
      and ("vendor_billing_reviews"."subject_id" is not null) <> ("vendor_billing_reviews"."period" is not null) and ("vendor_billing_reviews"."period" is null or "vendor_billing_reviews"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'))
);
--> statement-breakpoint
CREATE TABLE "vendor_credit_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_rupiah" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vendor_credit_allocations_key" UNIQUE("credit_id","invoice_id"),
	CONSTRAINT "vendor_credit_allocations_check" CHECK ("vendor_credit_allocations"."amount_rupiah" > 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_rupiah" integer NOT NULL,
	"remaining_rupiah" integer NOT NULL,
	"reason" text NOT NULL,
	"request_id" uuid,
	"payment_id" uuid,
	"requested_by" uuid,
	"approved_by" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vendor_credit_notes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vendor_credit_notes_check" CHECK ("vendor_credit_notes"."kind" in ('waiver','credit','overpayment','exit_remainder') and "vendor_credit_notes"."amount_rupiah" > 0
      and "vendor_credit_notes"."remaining_rupiah" between 0 and "vendor_credit_notes"."amount_rupiah" and length(btrim("vendor_credit_notes"."reason")) between 3 and 500
      and ("vendor_credit_notes"."kind" in ('waiver','credit')) = ("vendor_credit_notes"."request_id" is not null and "vendor_credit_notes"."requested_by" is not null and "vendor_credit_notes"."approved_by" is not null)
      and ("vendor_credit_notes"."kind" = 'overpayment') = ("vendor_credit_notes"."payment_id" is not null) and ("vendor_credit_notes"."requested_by" is null or "vendor_credit_notes"."requested_by" <> "vendor_credit_notes"."approved_by"))
);
--> statement-breakpoint
CREATE TABLE "vendor_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"service_from" date NOT NULL,
	"service_to" date NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"fee_version_id" uuid,
	"fee_source" text NOT NULL,
	"fee_amount" integer NOT NULL,
	"proration" jsonb NOT NULL,
	"amount_rupiah" integer NOT NULL,
	"vat_rupiah" integer NOT NULL,
	"total_rupiah" integer NOT NULL,
	"tax_basis" jsonb NOT NULL,
	"state" text DEFAULT 'issued' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vendor_invoices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vendor_invoices_tenant_period_key" UNIQUE("tenant_id","period"),
	CONSTRAINT "vendor_invoices_number_key" UNIQUE("number"),
	CONSTRAINT "vendor_invoices_check" CHECK ("vendor_invoices"."number" ~ '^VND-[0-9]{6}-[0-9]{4,}$' and "vendor_invoices"."kind" in ('first','monthly') and "vendor_invoices"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      and "vendor_invoices"."service_from" <= "vendor_invoices"."service_to" and "vendor_invoices"."due_date" >= "vendor_invoices"."issue_date" and "vendor_invoices"."fee_source" in ('version','default')
      and ("vendor_invoices"."fee_source" = 'version') = ("vendor_invoices"."fee_version_id" is not null) and "vendor_invoices"."fee_amount" > 0 and "vendor_invoices"."amount_rupiah" >= 0 and "vendor_invoices"."vat_rupiah" >= 0
      and "vendor_invoices"."total_rupiah" = "vendor_invoices"."amount_rupiah" + "vendor_invoices"."vat_rupiah" and jsonb_typeof("vendor_invoices"."proration") = 'object' and jsonb_typeof("vendor_invoices"."tax_basis") = 'object'
      and "vendor_invoices"."state" in ('issued','paid','waived','credited') and ("vendor_invoices"."state" = 'issued') = ("vendor_invoices"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "vendor_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_rupiah" integer NOT NULL,
	CONSTRAINT "vendor_payment_allocations_key" UNIQUE("payment_id","invoice_id"),
	CONSTRAINT "vendor_payment_allocations_check" CHECK ("vendor_payment_allocations"."amount_rupiah" > 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"reff_id" text NOT NULL,
	"command_key" text NOT NULL,
	"channel_code" text NOT NULL,
	"amount_rupiah" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'creating' NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"provider_trx_id" text,
	"provider_admin" integer,
	"provider_total" integer,
	"instruction" jsonb,
	"rc" text,
	"ket" text,
	"advice_next_at" timestamp with time zone,
	"advice_count" integer DEFAULT 0 NOT NULL,
	"creating_since" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"closed_by" text,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vendor_payment_attempts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vendor_payment_attempts_reff_key" UNIQUE("reff_id"),
	CONSTRAINT "vendor_payment_attempts_invoice_seq_key" UNIQUE("invoice_id","seq"),
	CONSTRAINT "vendor_payment_attempts_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "vendor_payment_attempts_check" CHECK ("vendor_payment_attempts"."reff_id" ~ '^SF[0-9]{10,}A[0-9]{1,}$' and length("vendor_payment_attempts"."reff_id") <= 30 and "vendor_payment_attempts"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "vendor_payment_attempts"."channel_code" ~ '^[A-Z0-9_]{2,20}$'
      and "vendor_payment_attempts"."amount_rupiah" > 0 and "vendor_payment_attempts"."state" in ('creating','pending','unknown','paid','expired','failed') and "vendor_payment_attempts"."generation" >= 1
      and ("vendor_payment_attempts"."provider_trx_id" is null or "vendor_payment_attempts"."provider_trx_id" ~ '^[A-Za-z0-9_-]{1,64}$') and ("vendor_payment_attempts"."rc" is null or "vendor_payment_attempts"."rc" ~ '^[0-9A-Za-z]{1,8}$')
      and ("vendor_payment_attempts"."ket" is null or length("vendor_payment_attempts"."ket") <= 200) and ("vendor_payment_attempts"."provider_admin" is null or "vendor_payment_attempts"."provider_admin" >= 0)
      and ("vendor_payment_attempts"."provider_total" is null or "vendor_payment_attempts"."provider_total" >= "vendor_payment_attempts"."amount_rupiah") and ("vendor_payment_attempts"."instruction" is null or jsonb_typeof("vendor_payment_attempts"."instruction") = 'object')
      and "vendor_payment_attempts"."created_as" in ('owner','finance') and "vendor_payment_attempts"."advice_count" >= 0
      and ("vendor_payment_attempts"."state" <> 'pending' or "vendor_payment_attempts"."provider_trx_id" is not null) and ("vendor_payment_attempts"."state" <> 'paid' or "vendor_payment_attempts"."provider_trx_id" is not null)
      and ("vendor_payment_attempts"."closed_by" is null or "vendor_payment_attempts"."closed_by" in ('advice','create_rc')))
);
--> statement-breakpoint
CREATE TABLE "vendor_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"settled_rupiah" integer NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	"observation_id" uuid NOT NULL,
	CONSTRAINT "vendor_payments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "vendor_payments_attempt_key" UNIQUE("attempt_id"),
	CONSTRAINT "vendor_payments_check" CHECK ("vendor_payments"."settled_rupiah" > 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vendor_reminders_key" UNIQUE("invoice_id","kind"),
	CONSTRAINT "vendor_reminders_check" CHECK ("vendor_reminders"."kind" in ('due','plus7','plus14'))
);
--> statement-breakpoint
ALTER TABLE "server_fee_versions" ADD CONSTRAINT "server_fee_versions_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_fee_versions" ADD CONSTRAINT "server_fee_versions_request_id_vendor_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."vendor_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_advice_observations" ADD CONSTRAINT "vendor_advice_observations_attempt_fk" FOREIGN KEY ("tenant_id","attempt_id") REFERENCES "public"."vendor_payment_attempts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_attempt_notes" ADD CONSTRAINT "vendor_attempt_notes_attempt_fk" FOREIGN KEY ("tenant_id","attempt_id") REFERENCES "public"."vendor_payment_attempts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_billing_reviews" ADD CONSTRAINT "vendor_billing_reviews_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credit_allocations" ADD CONSTRAINT "vendor_credit_allocations_credit_fk" FOREIGN KEY ("tenant_id","credit_id") REFERENCES "public"."vendor_credit_notes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credit_allocations" ADD CONSTRAINT "vendor_credit_allocations_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."vendor_invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credit_notes" ADD CONSTRAINT "vendor_credit_notes_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credit_notes" ADD CONSTRAINT "vendor_credit_notes_request_id_vendor_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."vendor_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credit_notes" ADD CONSTRAINT "vendor_credit_notes_invoice_fk" FOREIGN KEY ("tenant_id","source_invoice_id") REFERENCES "public"."vendor_invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credit_notes" ADD CONSTRAINT "vendor_credit_notes_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."vendor_payments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_fee_version_fk" FOREIGN KEY ("tenant_id","fee_version_id") REFERENCES "public"."server_fee_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."vendor_payments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."vendor_invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payment_attempts" ADD CONSTRAINT "vendor_payment_attempts_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."vendor_invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payment_attempts" ADD CONSTRAINT "vendor_payment_attempts_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_attempt_fk" FOREIGN KEY ("tenant_id","attempt_id") REFERENCES "public"."vendor_payment_attempts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."vendor_invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_observation_fk" FOREIGN KEY ("tenant_id","observation_id") REFERENCES "public"."vendor_advice_observations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_reminders" ADD CONSTRAINT "vendor_reminders_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."vendor_invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_billing_reviews_key" ON "vendor_billing_reviews" USING btree ("tenant_id","kind",coalesce("subject_id"::text, "period"));--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_credit_notes_request_key" ON "vendor_credit_notes" USING btree ("request_id") WHERE "vendor_credit_notes"."request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_credit_notes_payment_key" ON "vendor_credit_notes" USING btree ("payment_id") WHERE "vendor_credit_notes"."payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_credit_notes_exit_key" ON "vendor_credit_notes" USING btree ("source_invoice_id") WHERE "vendor_credit_notes"."kind" = 'exit_remainder';--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_payment_attempts_trx_key" ON "vendor_payment_attempts" USING btree ("provider_trx_id") WHERE "vendor_payment_attempts"."provider_trx_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_payment_attempts_one_open" ON "vendor_payment_attempts" USING btree ("invoice_id") WHERE "vendor_payment_attempts"."state" in ('creating','pending','unknown');--> statement-breakpoint
CREATE INDEX "vendor_payment_attempts_advice_idx" ON "vendor_payment_attempts" USING btree ("advice_next_at") WHERE "vendor_payment_attempts"."provider_trx_id" is not null and "vendor_payment_attempts"."state" in ('pending','unknown','expired');--> statement-breakpoint

-- T-103 increment 1 logic (generated by /data/tmp/clinic-dashboard/t103/inc1/gen.py; plan docs/tasks/T-103.md)
-- ── RLS, scope map, guards, seeds ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Platform tables (the vendor's billing domain, DATA-49): none is granted to any login; every read and write is a definer below (deny by
-- default, TEN-16). The vendor support operator never reaches them (platform policy kind; no operator policy).
ALTER TABLE public.server_fee_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_invoices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_payment_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_advice_observations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.autolaris_settlement_rules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_payments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_payment_allocations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_credit_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_credit_allocations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_attempt_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_billing_policy ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_reminders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_billing_reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.server_fee_versions', 'platform', 'vendor', '{}', 'vendor_billing_apply_fee_change (approved server_fee_change, executor)', 'none'),
  ('public.vendor_invoices', 'platform', 'vendor', '{}', 'vendor_billing_issue (executor); state by settlement / credit functions', 'none'),
  ('public.vendor_payment_attempts', 'platform', 'vendor', '{}', 'vendor_billing_bayar_begin / _finish (clinic owner, finance), advice and recovery workers', 'none'),
  ('public.vendor_advice_observations', 'platform', 'vendor', '{}', 'vendor_billing_advice_record (executor; append-only)', 'none'),
  ('public.autolaris_settlement_rules', 'platform', 'vendor', '{}', 'migration seed only (unconfirmed, Q-13); no writer in T-103', 'none'),
  ('public.vendor_payments', 'platform', 'vendor', '{}', 'vendor_billing_advice_record (confirmed rule only)', 'none'),
  ('public.vendor_payment_allocations', 'platform', 'vendor', '{}', 'vendor_billing_advice_record', 'none'),
  ('public.vendor_credit_notes', 'platform', 'vendor', '{}', 'vendor_billing_apply_waiver (approved invoice_waiver), settlement (overpayment), exit credit', 'none'),
  ('public.vendor_credit_allocations', 'platform', 'vendor', '{}', 'vendor_billing_allocate (inside the issuer and credit writers)', 'none'),
  ('public.vendor_attempt_notes', 'platform', 'vendor', '{}', 'vendor_billing_attempt_note — increment 2 (vendor console); append-only; never changes an attempt', 'none'),
  ('public.vendor_billing_policy', 'platform', 'vendor', '{}', 'migration seed only (fee bearer and tax treatment undecided; no writer in T-103)', 'none'),
  ('public.vendor_reminders', 'platform', 'vendor', '{}', 'vendor_billing_reminders (executor)', 'none'),
  ('public.vendor_billing_reviews', 'platform', 'vendor', '{}', 'billing workers (review items for vendor finance)', 'none');--> statement-breakpoint

-- Guards: documents are never deleted; amounts, numbers, dates, snapshots and identities are frozen; states move forward only.
CREATE FUNCTION public.vendor_billing_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb;
  n jsonb;
  k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: % rows are never deleted', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  n := to_jsonb(NEW);
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'vendor_invoices' AND n ->> 'state' <> 'issued'
       OR TG_TABLE_NAME = 'vendor_payment_attempts' AND n ->> 'state' <> 'creating'
       OR TG_TABLE_NAME = 'vendor_credit_notes' AND (n ->> 'remaining_rupiah')::integer <> (n ->> 'amount_rupiah')::integer THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: % starts in its initial state', TG_TABLE_NAME USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  o := to_jsonb(OLD);
  FOREACH k IN ARRAY CASE TG_TABLE_NAME
      WHEN 'vendor_invoices' THEN ARRAY['state','closed_at']
      WHEN 'vendor_payment_attempts' THEN ARRAY['state','generation','provider_trx_id','provider_admin','provider_total','instruction','rc','ket',
                                                'advice_next_at','advice_count','closed_by','updated_at']
      WHEN 'vendor_credit_notes' THEN ARRAY['remaining_rupiah']
      WHEN 'autolaris_settlement_rules' THEN ARRAY['confirmed','flag','evidence_ref','confirmed_by']
      WHEN 'vendor_billing_policy' THEN ARRAY['channel_fee_bearer','fee_bearer_ref','tax_treatment_ref']
      ELSE ARRAY[]::text[] END LOOP
    o := o - k;
    n := n - k;
  END LOOP;
  IF o <> n THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: % is frozen', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  o := to_jsonb(OLD);
  n := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'vendor_invoices' AND (o ->> 'state') IS DISTINCT FROM (n ->> 'state') AND NOT ((o ->> 'state') = 'issued') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice % -> %', (o ->> 'state'), (n ->> 'state') USING ERRCODE = '40001';
  ELSIF TG_TABLE_NAME = 'vendor_payment_attempts' THEN
    IF (o ->> 'state') IS DISTINCT FROM (n ->> 'state') AND NOT (
          (o ->> 'state') = 'creating' AND (n ->> 'state') IN ('pending','failed','unknown')
       OR (o ->> 'state') = 'unknown' AND (n ->> 'state') IN ('pending','paid','expired','failed')
       OR (o ->> 'state') = 'pending' AND (n ->> 'state') IN ('paid','expired','failed')
       OR (o ->> 'state') = 'expired' AND (n ->> 'state') = 'paid') THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: attempt % -> %', (o ->> 'state'), (n ->> 'state') USING ERRCODE = '40001';
    END IF;
    IF (o ->> 'provider_trx_id') IS NOT NULL AND (n ->> 'provider_trx_id') IS DISTINCT FROM (o ->> 'provider_trx_id') THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: a provider transaction id is learnt once' USING ERRCODE = '42501';
    END IF;
    IF (n ->> 'generation')::integer < (o ->> 'generation')::integer THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: generations only move forward' USING ERRCODE = '40001';
    END IF;
  ELSIF TG_TABLE_NAME = 'vendor_credit_notes' AND (n ->> 'remaining_rupiah')::integer > (o ->> 'remaining_rupiah')::integer THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a credit is only consumed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER server_fee_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.server_fee_versions FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_invoices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_payment_attempts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_payment_attempts FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_advice_observations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_advice_observations FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER autolaris_settlement_rules_guard BEFORE INSERT OR UPDATE OR DELETE ON public.autolaris_settlement_rules FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_payments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_payments FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_payment_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_payment_allocations FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_credit_notes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_credit_notes FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_credit_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_credit_allocations FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_attempt_notes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_attempt_notes FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_billing_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_billing_policy FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_reminders_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_reminders FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
CREATE TRIGGER vendor_billing_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vendor_billing_reviews FOR EACH ROW EXECUTE FUNCTION public.vendor_billing_guard();--> statement-breakpoint
ALTER TABLE public.server_fee_versions ENABLE ALWAYS TRIGGER server_fee_versions_guard;--> statement-breakpoint
ALTER TABLE public.vendor_invoices ENABLE ALWAYS TRIGGER vendor_invoices_guard;--> statement-breakpoint
ALTER TABLE public.vendor_payment_attempts ENABLE ALWAYS TRIGGER vendor_payment_attempts_guard;--> statement-breakpoint
ALTER TABLE public.vendor_advice_observations ENABLE ALWAYS TRIGGER vendor_advice_observations_guard;--> statement-breakpoint
ALTER TABLE public.autolaris_settlement_rules ENABLE ALWAYS TRIGGER autolaris_settlement_rules_guard;--> statement-breakpoint
ALTER TABLE public.vendor_payments ENABLE ALWAYS TRIGGER vendor_payments_guard;--> statement-breakpoint
ALTER TABLE public.vendor_payment_allocations ENABLE ALWAYS TRIGGER vendor_payment_allocations_guard;--> statement-breakpoint
ALTER TABLE public.vendor_credit_notes ENABLE ALWAYS TRIGGER vendor_credit_notes_guard;--> statement-breakpoint
ALTER TABLE public.vendor_credit_allocations ENABLE ALWAYS TRIGGER vendor_credit_allocations_guard;--> statement-breakpoint
ALTER TABLE public.vendor_attempt_notes ENABLE ALWAYS TRIGGER vendor_attempt_notes_guard;--> statement-breakpoint
ALTER TABLE public.vendor_billing_policy ENABLE ALWAYS TRIGGER vendor_billing_policy_guard;--> statement-breakpoint
ALTER TABLE public.vendor_reminders ENABLE ALWAYS TRIGGER vendor_reminders_guard;--> statement-breakpoint
ALTER TABLE public.vendor_billing_reviews ENABLE ALWAYS TRIGGER vendor_billing_reviews_guard;--> statement-breakpoint
CREATE TRIGGER vendor_invoices_no_truncate BEFORE TRUNCATE ON public.vendor_invoices FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER vendor_payment_attempts_no_truncate BEFORE TRUNCATE ON public.vendor_payment_attempts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER vendor_payments_no_truncate BEFORE TRUNCATE ON public.vendor_payments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER vendor_credit_notes_no_truncate BEFORE TRUNCATE ON public.vendor_credit_notes FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Seeds (addendum a1): the undecided policies (NULL = closed), the unconfirmed settlement placeholder (Q-13), the reminder notification type.
INSERT INTO public.vendor_billing_policy (id, channel_fee_bearer, fee_bearer_ref, tax_treatment_ref) VALUES (1, NULL, NULL, NULL);--> statement-breakpoint
INSERT INTO public.autolaris_settlement_rules (meaning, status, confirmed, flag) VALUES ('settled', 'PENDING_Q13_PLACEHOLDER', false, 'pending_q13');--> statement-breakpoint
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('vendor_invoice_reminder', 'Tagihan server belum dibayar', '{owner,finance}', '{vendor_invoice}', false);--> statement-breakpoint

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Lock order (plan §4b): tenant billing lock → invoice row → attempt row. Taken first by every writer that touches a tenant's billing.
CREATE FUNCTION public.vendor_billing_lock(p_tenant uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('vendor_billing:' || p_tenant::text, 0))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_lock(uuid) FROM PUBLIC;--> statement-breakpoint

-- What is still payable on an invoice: amount − credit allocations − payment allocations (never below 0 by construction).
CREATE FUNCTION public.vendor_invoice_outstanding(p_invoice uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.total_rupiah
         - coalesce((SELECT sum(c.amount_rupiah) FROM public.vendor_credit_allocations c WHERE c.invoice_id = i.id), 0)::integer
         - coalesce((SELECT sum(p.amount_rupiah) FROM public.vendor_payment_allocations p WHERE p.invoice_id = i.id), 0)::integer
    FROM public.vendor_invoices i WHERE i.id = p_invoice
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_invoice_outstanding(uuid) FROM PUBLIC;--> statement-breakpoint

-- Close an issued invoice whose outstanding reached 0 (§Settlement allocation): paid when at least one payment covers part of it, else
-- waived when a waiver covers it, else credited. Under the tenant lock and the invoice row lock.
CREATE FUNCTION public.vendor_invoice_settle_state(p_invoice uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.vendor_invoices;
BEGIN
  SELECT * INTO i FROM public.vendor_invoices WHERE id = p_invoice FOR UPDATE;
  IF i.state <> 'issued' OR public.vendor_invoice_outstanding(i.id) > 0 THEN RETURN; END IF;
  UPDATE public.vendor_invoices SET closed_at = clock_timestamp(),
         state = CASE WHEN EXISTS (SELECT 1 FROM public.vendor_payment_allocations p WHERE p.invoice_id = i.id) THEN 'paid'
                      WHEN EXISTS (SELECT 1 FROM public.vendor_credit_allocations a JOIN public.vendor_credit_notes c ON c.id = a.credit_id
                                    WHERE a.invoice_id = i.id AND c.kind = 'waiver') THEN 'waived'
                      ELSE 'credited' END
   WHERE id = i.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_invoice_settle_state(uuid) FROM PUBLIC;--> statement-breakpoint

-- Allocate the tenant's open credits, oldest first, to one issued invoice up to its outstanding (§2b). A credit is never spent twice. Invariant
-- (Panel 2): (1) every caller — vendor_billing_issue, vendor_billing_exit_credit (inside the issuer), vendor_billing_apply_waiver — holds
-- vendor_billing_lock(tenant) first, so allocations of one tenant never interleave; (2) the invoice row is locked and re-read as issued before
-- anything is allocated, and outstanding is computed after that lock; (3) each open credit row is locked and its remaining re-read; (4) the
-- NOT EXISTS guard and UNIQUE(credit, invoice) keep a credit from being allocated to the same invoice twice even if (1) were broken (defence in
-- depth: a step either exhausts a credit or closes the invoice, so the guard is not reached by the current callers).
-- tests/vendor/billing/concurrency.test.ts forces the interleavings.
CREATE FUNCTION public.vendor_billing_allocate(p_tenant uuid, p_invoice uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
  v_left integer;
  v_take integer;
  v_total integer := 0;
BEGIN
  PERFORM 1 FROM public.vendor_invoices WHERE id = p_invoice AND tenant_id = p_tenant AND state = 'issued' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  FOR c IN SELECT * FROM public.vendor_credit_notes WHERE tenant_id = p_tenant AND remaining_rupiah > 0
            AND NOT EXISTS (SELECT 1 FROM public.vendor_credit_allocations a WHERE a.credit_id = vendor_credit_notes.id AND a.invoice_id = p_invoice)
            ORDER BY created_at, id FOR UPDATE LOOP
    v_left := public.vendor_invoice_outstanding(p_invoice);
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, c.remaining_rupiah);
    INSERT INTO public.vendor_credit_allocations (tenant_id, credit_id, invoice_id, amount_rupiah) VALUES (p_tenant, c.id, p_invoice, v_take);
    UPDATE public.vendor_credit_notes SET remaining_rupiah = remaining_rupiah - v_take WHERE id = c.id;
    v_total := v_total + v_take;
  END LOOP;
  PERFORM public.vendor_invoice_settle_state(p_invoice);
  RETURN v_total;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_allocate(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A review item for vendor finance (once per tenant, kind and subject / period).
CREATE FUNCTION public.vendor_billing_review(p_tenant uuid, p_kind text, p_subject uuid, p_period text) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO public.vendor_billing_reviews (tenant_id, kind, subject_id, period) VALUES (p_tenant, p_kind, p_subject, p_period) ON CONFLICT DO NOTHING
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_review(uuid, text, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- The vendor's VAT for an amount (addendum a1-4), or NULL when it cannot be determined: the tax treatment reference must be set, and the
-- vendor's status determinate — PKP (the 0016 check requires effective-from and evidence) or non-PKP with tax evidence. Unknown = NULL.
CREATE FUNCTION public.vendor_billing_vat(p_amount integer, p_on date, OUT vat integer, OUT basis jsonb)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.vendor_profile;
  t text := (SELECT tax_treatment_ref FROM public.vendor_billing_policy WHERE id = 1);
  dpp integer;
BEGIN
  SELECT * INTO v FROM public.vendor_profile WHERE id = 1;
  IF t IS NULL OR v.id IS NULL THEN RETURN; END IF;
  IF v.is_pkp AND v.pkp_effective_from IS NOT NULL AND v.pkp_effective_from <= p_on THEN
    dpp := floor(p_amount::numeric * 11 / 12);
    vat := floor(dpp::numeric * 12 / 100);
    basis := jsonb_build_object('status', 'pkp', 'dpp', dpp, 'rate', '12/100 x 11/12', 'treatment_ref', t, 'evidence_ref', v.tax_evidence_ref);
  ELSIF NOT v.is_pkp AND v.tax_evidence_ref IS NOT NULL THEN
    vat := 0;
    basis := jsonb_build_object('status', 'non_pkp', 'treatment_ref', t, 'evidence_ref', v.tax_evidence_ref);
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_vat(integer, date) FROM PUBLIC;--> statement-breakpoint

-- ── Issuer (BILL-31; unbound worker, clinic_executor) ─────────────────────────────────────────────────────────────────────────────────
-- For every tenant: the first invoice from the go-live event (prorated), then one invoice per month on the 1st (Asia/Jakarta) while live or
-- suspended, until exit. Idempotent: UNIQUE(tenant, period). Never edits an issued invoice. An undeterminable VAT → no invoice, a review item.
CREATE FUNCTION public.vendor_billing_issue(p_now timestamptz, p_service text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r record;
  v_today date := (p_now AT TIME ZONE 'Asia/Jakarta')::date;
  v_go date;
  v_exit date;
  v_period text;
  v_month date;
  v_kind text;
  v_from date;
  v_to date;
  v_issue date;
  v_due date;
  v_fee record;
  v_days integer;
  v_dim integer;
  v_amount integer;
  v_vat record;
  v_seq integer;
  v_id uuid;
  n integer := 0;
BEGIN
  IF p_service IS NULL OR p_service !~ '^[a-z][a-z_.-]{1,60}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a named executing service issues invoices' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT t.id, t.lifecycle_state FROM public.tenants_registry t ORDER BY t.id LOOP
    SELECT (min(e.at) AT TIME ZONE 'Asia/Jakarta')::date INTO v_go FROM public.tenant_lifecycle_events e
     WHERE e.tenant_id = r.id AND e.from_state = 'onboarding' AND e.to_state = 'live';
    CONTINUE WHEN v_go IS NULL OR v_go > v_today;
    SELECT (min(e.at) AT TIME ZONE 'Asia/Jakarta')::date INTO v_exit FROM public.tenant_lifecycle_events e
     WHERE e.tenant_id = r.id AND e.to_state = 'exit';
    PERFORM public.vendor_billing_lock(r.id);
    -- every month from the go-live month to today's month (catch-up is idempotent); none after the exit month
    v_month := date_trunc('month', v_go)::date;
    WHILE v_month <= date_trunc('month', v_today)::date AND (v_exit IS NULL OR v_month <= date_trunc('month', v_exit)::date) LOOP
      v_period := to_char(v_month, 'YYYY-MM');
      IF NOT EXISTS (SELECT 1 FROM public.vendor_invoices WHERE tenant_id = r.id AND period = v_period) THEN
        v_dim := extract(day FROM (v_month + interval '1 month - 1 day'))::integer;
        v_to := (v_month + interval '1 month - 1 day')::date;
        IF v_month = date_trunc('month', v_go)::date THEN
          v_kind := 'first'; v_from := v_go; v_issue := v_go; v_due := v_go + 10;
        ELSE
          v_kind := 'monthly'; v_from := v_month; v_issue := v_month; v_due := v_month + 9;
        END IF;
        SELECT f.id, f.amount_rupiah INTO v_fee FROM public.server_fee_versions f
         WHERE f.tenant_id = r.id AND f.effective_month <= v_period ORDER BY f.effective_month DESC LIMIT 1;
        v_days := v_to - v_from + 1;
        v_amount := floor(coalesce(v_fee.amount_rupiah, 1000000)::numeric * v_days / v_dim);
        SELECT * INTO v_vat FROM public.vendor_billing_vat(v_amount, v_issue);
        IF v_vat.vat IS NULL THEN
          PERFORM public.vendor_billing_review(r.id, 'tax_status_unknown', NULL, v_period);
        ELSE
          PERFORM pg_advisory_xact_lock(hashtextextended('vendor_invoice_number:' || to_char(v_issue, 'YYYYMM'), 0));
          SELECT coalesce(max(substring(number FROM '^VND-[0-9]{6}-([0-9]+)$')::integer), 0) + 1 INTO v_seq
            FROM public.vendor_invoices WHERE number LIKE 'VND-' || to_char(v_issue, 'YYYYMM') || '-%';
          INSERT INTO public.vendor_invoices (tenant_id, number, kind, period, service_from, service_to, issue_date, due_date, fee_version_id,
                                              fee_source, fee_amount, proration, amount_rupiah, vat_rupiah, total_rupiah, tax_basis, created_by)
          VALUES (r.id, 'VND-' || to_char(v_issue, 'YYYYMM') || '-' || CASE WHEN v_seq < 10000 THEN lpad(v_seq::text, 4, '0') ELSE v_seq::text END, v_kind, v_period, v_from, v_to, v_issue, v_due,
                  v_fee.id, CASE WHEN v_fee.id IS NULL THEN 'default' ELSE 'version' END, coalesce(v_fee.amount_rupiah, 1000000),
                  jsonb_build_object('days', v_days, 'days_in_month', v_dim, 'formula', 'floor(fee * days / days_in_month)'),
                  v_amount, v_vat.vat, v_amount + v_vat.vat, v_vat.basis, public.vendor_service_name(p_service))
          RETURNING id INTO v_id;
          PERFORM public.vendor_billing_allocate(r.id, v_id);
          PERFORM public.vendor_log(NULL, NULL, NULL, 'vendor_invoice_issue', r.id, v_id, 'success', NULL, NULL, NULL, public.vendor_service_name(p_service));
          n := n + 1;
        END IF;
      END IF;
      v_month := (v_month + interval '1 month')::date;
    END LOOP;
    -- exit: the advance-billed remainder of the exit month, per day from the frozen monthly fee, capped (§2 exit)
    IF v_exit IS NOT NULL THEN
      PERFORM public.vendor_billing_exit_credit(r.id, v_exit, p_service);
    END IF;
  END LOOP;
  RETURN n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_issue(timestamptz, text) FROM PUBLIC;--> statement-breakpoint

-- Exit credit (§2): days after the exit date up to the invoice's service end, from the frozen fee; capped at the uncredited amount. Once per
-- invoice (partial unique index). An unpaid invoice receives it at once; a paid one keeps it as balance (offline refund, listed on UX-43).
CREATE FUNCTION public.vendor_billing_exit_credit(p_tenant uuid, p_exit date, p_service text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.vendor_invoices;
  v_unused integer;
  v_credit integer;
  v_cap integer;
BEGIN
  SELECT * INTO i FROM public.vendor_invoices WHERE tenant_id = p_tenant AND period = to_char(p_exit, 'YYYY-MM') FOR UPDATE;
  IF i.id IS NULL OR p_exit >= i.service_to OR EXISTS (SELECT 1 FROM public.vendor_credit_notes c WHERE c.source_invoice_id = i.id AND c.kind = 'exit_remainder') THEN
    RETURN;
  END IF;
  v_unused := i.service_to - greatest(p_exit, i.service_from - 1);
  v_credit := floor(i.fee_amount::numeric * v_unused / (i.proration ->> 'days_in_month')::integer);
  v_cap := i.amount_rupiah - coalesce((SELECT sum(c.amount_rupiah) FROM public.vendor_credit_notes c WHERE c.source_invoice_id = i.id
                                                                     AND c.kind IN ('waiver','credit','exit_remainder')), 0)::integer;
  v_credit := least(v_credit, v_cap);
  IF v_credit <= 0 THEN RETURN; END IF;
  INSERT INTO public.vendor_credit_notes (tenant_id, source_invoice_id, kind, amount_rupiah, remaining_rupiah, reason, created_by)
  VALUES (p_tenant, i.id, 'exit_remainder', v_credit, v_credit, 'Sisa periode setelah tanggal keluar', public.vendor_service_name(p_service));
  PERFORM public.vendor_billing_allocate(p_tenant, i.id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_exit_credit(uuid, date, text) FROM PUBLIC;--> statement-breakpoint

-- ── Payment attempts (BILL-32, TD-42) ────────────────────────────────────────────────────────────────────────────────────────────────
-- Bayar, phase 1 (bound; the tenant's owner or finance, 07 :67): validates the invoice and the gates, then inserts the attempt `creating` with
-- a fresh reff_id. The caller commits this before the provider call (the reff_id exists before the request). Keyed: a replay of the same key
-- returns the same attempt (never a second one).
CREATE FUNCTION public.vendor_billing_bayar_begin(p_key text, p_invoice uuid, p_channel text, p_channels text[], p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  i public.vendor_invoices;
  x public.vendor_payment_attempts;
  p public.vendor_billing_policy;
  v_out integer;
  v_seq integer;
  v_id uuid;
  v_reff text;
BEGIN
  SELECT x0.tenant_id, x0.staff_id, x0.role INTO a FROM public.tenant_actor_lock() x0;
  IF a.role NOT IN ('owner','finance') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner or finance pays the server fee' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR p_channel IS NULL OR p_channel !~ '^[A-Z0-9_]{2,20}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: bayar' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO x FROM public.vendor_payment_attempts WHERE tenant_id = a.tenant_id AND command_key = p_key;
  IF x.id IS NOT NULL THEN
    RETURN jsonb_build_object('attempt_id', x.id, 'reff_id', x.reff_id, 'amount', x.amount_rupiah, 'channel', x.channel_code,
                              'expires_at', x.expires_at, 'generation', x.generation, 'state', x.state, 'replayed', true);
  END IF;
  -- runtime channel list (TD-42: from list_payment at runtime, passed by the server after its own call); COD is never a server-fee channel
  IF p_channels IS NULL OR NOT p_channel = ANY (p_channels) OR p_channel = 'COD' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: channel_unavailable' USING ERRCODE = '22023';
  END IF;
  PERFORM public.vendor_billing_lock(a.tenant_id);
  SELECT * INTO i FROM public.vendor_invoices WHERE tenant_id = a.tenant_id AND id = p_invoice FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO p FROM public.vendor_billing_policy WHERE id = 1;
  IF p.channel_fee_bearer IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: fee_policy_pending' USING ERRCODE = '40001';
  ELSIF p.channel_fee_bearer <> 'tenant' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: fee_policy_unsupported' USING ERRCODE = '40001';
  END IF;
  IF i.state <> 'issued' THEN RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_closed' USING ERRCODE = '40001'; END IF;
  -- one open attempt per invoice; an unknown / pending / creating one blocks (only Advice with a confirmed rule closes it, a1-1)
  IF EXISTS (SELECT 1 FROM public.vendor_payment_attempts WHERE invoice_id = i.id AND state IN ('creating','pending','unknown')) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: attempt_open' USING ERRCODE = '40001';
  END IF;
  -- an expired-by-Advice attempt still inside its reconciliation window does not block (BILL-32: a new attempt after Advice proves expiry)
  v_out := public.vendor_invoice_outstanding(i.id);
  IF v_out <= 0 THEN RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing_payable' USING ERRCODE = '40001'; END IF;
  SELECT coalesce(max(seq), 0) + 1 INTO v_seq FROM public.vendor_payment_attempts WHERE invoice_id = i.id;
  -- SF + the invoice number's digits (YYYYMM, then its sequence) + 'A' + the attempt sequence: never truncated, never ambiguous
  v_reff := 'SF' || replace(substring(i.number FROM 5), '-', '') || 'A' || v_seq::text;
  INSERT INTO public.vendor_payment_attempts (tenant_id, invoice_id, seq, reff_id, command_key, channel_code, amount_rupiah, expires_at,
                                              created_by, created_as)
  VALUES (a.tenant_id, i.id, v_seq, v_reff, p_key, p_channel, v_out, p_now + interval '24 hours', a.staff_id, a.role)
  RETURNING id INTO v_id;
  PERFORM public.audit_append('money_correction', 'vendor_payment_attempt', v_id, 'success', 'vendor_bayar_begin');
  RETURN jsonb_build_object('attempt_id', v_id, 'reff_id', v_reff, 'amount', v_out, 'channel', p_channel, 'expires_at', p_now + interval '24 hours',
                            'generation', 1, 'state', 'creating', 'replayed', false);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_bayar_begin(text, uuid, text, text[], timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_bayar_begin(text, uuid, text, text[], timestamptz) TO clinic_app;--> statement-breakpoint

-- Bayar, phase 2 (unbound worker on the executor login: the server writes the provider's answer after the call). Fenced on (state,
-- generation): `creating` with the same generation → pending (rc 00, trx id, admin, total, instruction) or failed (rc ≠ 00, no trx id — the
-- invoice stays issued) or unknown (timeout / transport). If recovery already moved it to `unknown`, a late success still records the
-- provider ids once and returns it to pending (§3); a state reached by Advice is never regressed (the answer is kept as an observation).
CREATE FUNCTION public.vendor_billing_bayar_finish(p_attempt uuid, p_generation integer, p_outcome text, p jsonb, p_now timestamptz, p_service text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x public.vendor_payment_attempts;
  v_trx text := p ->> 'trx_id';
  v_raw jsonb := coalesce(p -> 'raw', '{}'::jsonb);
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('ok','rc','transport') OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p_service IS NULL OR p_service !~ '^[a-z][a-z_.-]{1,60}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: bayar finish' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO x FROM public.vendor_payment_attempts WHERE id = p_attempt;
  IF x.id IS NULL THEN RAISE EXCEPTION 'ERR_NOT_FOUND: attempt not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.vendor_billing_lock(x.tenant_id);
  PERFORM 1 FROM public.vendor_invoices WHERE id = x.invoice_id FOR UPDATE;
  SELECT * INTO x FROM public.vendor_payment_attempts WHERE id = p_attempt FOR UPDATE;
  IF p_outcome = 'ok' AND (v_trx IS NULL OR v_trx !~ '^[A-Za-z0-9_-]{1,64}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: provider id' USING ERRCODE = '22023';
  END IF;
  IF x.state = 'creating' AND x.generation = p_generation THEN
    IF p_outcome = 'ok' THEN
      UPDATE public.vendor_payment_attempts SET state = 'pending', provider_trx_id = v_trx, provider_admin = (p ->> 'admin')::integer,
             provider_total = (p ->> 'total')::integer, instruction = p -> 'instruction', rc = '00', ket = left(p ->> 'ket', 200),
             advice_next_at = p_now + interval '1 minute', updated_at = clock_timestamp()
       WHERE id = x.id;
      RETURN 'pending';
    ELSIF p_outcome = 'rc' THEN
      UPDATE public.vendor_payment_attempts SET state = 'failed', rc = left(p ->> 'rc', 8), ket = left(p ->> 'ket', 200), closed_by = 'create_rc',
             updated_at = clock_timestamp()
       WHERE id = x.id;
      RETURN 'failed';
    ELSE
      UPDATE public.vendor_payment_attempts SET state = 'unknown', updated_at = clock_timestamp() WHERE id = x.id;
      PERFORM public.vendor_billing_review(x.tenant_id, 'attempt_unknown', x.id, NULL);
      RETURN 'unknown';
    END IF;
  END IF;
  -- recovered to unknown before the answer came: learn the provider id once and return to reconciliation
  IF x.state = 'unknown' AND x.provider_trx_id IS NULL AND p_outcome = 'ok' THEN
    UPDATE public.vendor_payment_attempts SET state = 'pending', provider_trx_id = v_trx, provider_admin = (p ->> 'admin')::integer,
           provider_total = (p ->> 'total')::integer, instruction = p -> 'instruction', rc = '00', ket = left(p ->> 'ket', 200),
           advice_next_at = p_now + interval '1 minute', updated_at = clock_timestamp()
     WHERE id = x.id;
    RETURN 'pending';
  END IF;
  -- anything else: keep the late answer as evidence only
  INSERT INTO public.vendor_advice_observations (tenant_id, attempt_id, source, rc, status, interpreted, raw)
  VALUES (x.tenant_id, x.id, 'create_late', left(p ->> 'rc', 8), NULL, 'unrecognized', jsonb_strip_nulls(v_raw));
  RETURN 'stale';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_bayar_finish(uuid, integer, text, jsonb, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_bayar_finish(uuid, integer, text, jsonb, timestamptz, text) TO clinic_executor;--> statement-breakpoint

-- Crash recovery (§3): an attempt left `creating` past 2 minutes moves to `unknown` (generation + 1) without another create; it then waits for
-- Advice (when its provider id arrives late) — never unlocked by time (a1-1).
CREATE FUNCTION public.vendor_billing_recover(p_now timestamptz, p_service text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x record;
  n integer := 0;
BEGIN
  -- tenant order, as the issuer: two workers never take two tenants' billing locks in opposite orders
  FOR x IN SELECT id, tenant_id, invoice_id FROM public.vendor_payment_attempts WHERE state = 'creating' AND creating_since < p_now - interval '2 minutes'
            ORDER BY tenant_id, id LOOP
    PERFORM public.vendor_billing_lock(x.tenant_id);
    PERFORM 1 FROM public.vendor_invoices WHERE id = x.invoice_id FOR UPDATE;
    UPDATE public.vendor_payment_attempts SET state = 'unknown', generation = generation + 1, updated_at = clock_timestamp()
     WHERE id = x.id AND state = 'creating';
    IF FOUND THEN
      PERFORM public.vendor_billing_review(x.tenant_id, 'attempt_unknown', x.id, NULL);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_recover(timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_recover(timestamptz, text) TO clinic_executor;--> statement-breakpoint

-- ── Advice (TD-42; BILL-32; Q-13 fail-closed) ───────────────────────────────────────────────────────────────────────────────────────
-- Due attempts for the Advice worker: a provider id, state pending / unknown / expired (late settlement), next read due, inside expires_at +
-- 24 h (schedule 1, 5, 15, 60 min then hourly). The worker calls the port outside any transaction and records each answer.
CREATE FUNCTION public.vendor_billing_advice_due(p_now timestamptz, p_limit integer) RETURNS TABLE (attempt_id uuid, trx_id text, generation integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT x.id, x.provider_trx_id, x.generation FROM public.vendor_payment_attempts x
   WHERE x.provider_trx_id IS NOT NULL AND x.state IN ('pending','unknown','expired') AND x.advice_next_at <= p_now
     AND p_now <= x.expires_at + interval '24 hours'
   ORDER BY x.advice_next_at, x.id LIMIT least(greatest(coalesce(p_limit, 50), 1), 500)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_advice_due(timestamptz, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_advice_due(timestamptz, integer) TO clinic_executor;--> statement-breakpoint

-- Record one Advice answer. The success envelope comes first and is not configurable (TD-42): HTTP 2xx and rc '00', or nothing in `data` is
-- read as settlement. Then the rule table (Q-13): only a CONFIRMED rule settles / expires / fails; an unconfirmed match is recorded and raises a
-- review item — never paid, never unlocked (a1-1, a1-2). A settlement whose amount differs from the attempt stays unpaid and is audited. A
-- verified settlement is allocated only up to the invoice's payable; any excess becomes an overpayment credit (§Settlement allocation).
CREATE FUNCTION public.vendor_billing_advice_record(p_attempt uuid, p_http integer, p jsonb, p_now timestamptz, p_service text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x public.vendor_payment_attempts;
  rl public.autolaris_settlement_rules;
  v_rc text := left(p ->> 'rc', 8);
  v_status text := upper(left(coalesce(p #>> '{data,status}', p ->> 'ket'), 40));
  v_amount integer;
  v_interp text;
  v_obs uuid;
  v_pay uuid;
  v_payable integer;
  v_alloc integer;
  v_next interval;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p_service IS NULL OR p_service !~ '^[a-z][a-z_.-]{1,60}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: advice' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO x FROM public.vendor_payment_attempts WHERE id = p_attempt;
  IF x.id IS NULL THEN RAISE EXCEPTION 'ERR_NOT_FOUND: attempt not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.vendor_billing_lock(x.tenant_id);
  PERFORM 1 FROM public.vendor_invoices WHERE id = x.invoice_id FOR UPDATE;
  SELECT * INTO x FROM public.vendor_payment_attempts WHERE id = p_attempt FOR UPDATE;
  BEGIN
    v_amount := CASE WHEN (p #>> '{data,amount}') ~ '^[0-9]{1,12}$' THEN (p #>> '{data,amount}')::integer END;
  EXCEPTION WHEN numeric_value_out_of_range THEN v_amount := NULL;
  END;
  IF p_http IS NULL THEN
    v_interp := 'transport_error';
  ELSIF p_http NOT BETWEEN 200 AND 299 OR v_rc IS DISTINCT FROM '00' THEN
    -- 02 / PENDING and any other non-success envelope: nothing in data is consumed
    v_interp := CASE WHEN v_rc = '02' THEN 'pending' ELSE 'envelope_error' END;
  ELSE
    SELECT * INTO rl FROM public.autolaris_settlement_rules WHERE status = v_status ORDER BY confirmed DESC LIMIT 1;
    v_interp := CASE
      WHEN rl.id IS NULL THEN 'unrecognized'
      WHEN rl.meaning = 'settled' AND rl.confirmed AND v_amount IS DISTINCT FROM x.amount_rupiah THEN 'amount_mismatch'
      WHEN rl.meaning = 'settled' AND rl.confirmed THEN 'settled'
      WHEN rl.meaning = 'settled' THEN 'settled_unconfirmed'
      WHEN rl.confirmed THEN rl.meaning
      ELSE rl.meaning || '_unconfirmed' END;
  END IF;
  INSERT INTO public.vendor_advice_observations (tenant_id, attempt_id, source, http_status, rc, status, amount_rupiah, interpreted, rule_id, raw)
  VALUES (x.tenant_id, x.id, 'advice', p_http, v_rc, v_status, v_amount, v_interp, rl.id,
          jsonb_build_object('rc', v_rc, 'ket', left(p ->> 'ket', 120), 'status', v_status, 'amount', v_amount))
  RETURNING id INTO v_obs;
  IF v_interp IN ('settled_unconfirmed','expired_unconfirmed','failed_unconfirmed','unrecognized') THEN
    PERFORM public.vendor_billing_review(x.tenant_id, 'advice_unconfirmed', x.id, NULL);
  ELSIF v_interp = 'amount_mismatch' THEN
    PERFORM public.vendor_billing_review(x.tenant_id, 'amount_mismatch', x.id, NULL);
    PERFORM public.vendor_log(NULL, NULL, NULL, 'vendor_advice_amount_mismatch', x.tenant_id, x.id, 'denied', 'amount_mismatch', NULL, NULL,
                              public.vendor_service_name(p_service));
  ELSIF v_interp = 'settled' AND x.state IN ('pending','unknown','expired') THEN
    UPDATE public.vendor_payment_attempts SET state = 'paid', closed_by = 'advice', advice_next_at = NULL, updated_at = clock_timestamp() WHERE id = x.id;
    INSERT INTO public.vendor_payments (tenant_id, attempt_id, invoice_id, settled_rupiah, settled_at, observation_id)
    VALUES (x.tenant_id, x.id, x.invoice_id, v_amount, p_now, v_obs) RETURNING id INTO v_pay;
    v_payable := CASE WHEN (SELECT state FROM public.vendor_invoices WHERE id = x.invoice_id) = 'issued'
                      THEN greatest(public.vendor_invoice_outstanding(x.invoice_id), 0) ELSE 0 END;
    v_alloc := least(v_payable, v_amount);
    IF v_alloc > 0 THEN
      INSERT INTO public.vendor_payment_allocations (tenant_id, payment_id, invoice_id, amount_rupiah) VALUES (x.tenant_id, v_pay, x.invoice_id, v_alloc);
    END IF;
    IF v_amount > v_alloc THEN
      INSERT INTO public.vendor_credit_notes (tenant_id, source_invoice_id, kind, amount_rupiah, remaining_rupiah, reason, payment_id, created_by)
      VALUES (x.tenant_id, x.invoice_id, 'overpayment', v_amount - v_alloc, v_amount - v_alloc, 'Pembayaran melebihi sisa tagihan', v_pay,
              public.vendor_service_name(p_service));
    END IF;
    PERFORM public.vendor_invoice_settle_state(x.invoice_id);
    PERFORM public.vendor_log(NULL, NULL, NULL, 'vendor_invoice_settled', x.tenant_id, x.invoice_id, 'success', NULL, NULL, NULL,
                              public.vendor_service_name(p_service));
    RETURN 'settled';
  ELSIF v_interp IN ('expired','failed') AND x.state IN ('pending','unknown') THEN
    UPDATE public.vendor_payment_attempts SET state = v_interp, closed_by = 'advice', updated_at = clock_timestamp(),
           advice_next_at = CASE WHEN v_interp = 'expired' THEN p_now + interval '1 hour' END
     WHERE id = x.id;
    RETURN v_interp;
  END IF;
  -- next read: 1, 5, 15, 60 min, then hourly (inside expires_at + 24 h; advice_due stops after)
  v_next := CASE x.advice_count WHEN 0 THEN interval '4 minutes' WHEN 1 THEN interval '10 minutes' WHEN 2 THEN interval '45 minutes' ELSE interval '1 hour' END;
  UPDATE public.vendor_payment_attempts SET advice_count = advice_count + 1, advice_next_at = p_now + v_next, updated_at = clock_timestamp()
   WHERE id = x.id AND state IN ('pending','unknown','expired');
  RETURN v_interp;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_advice_record(uuid, integer, jsonb, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_advice_record(uuid, integer, jsonb, timestamptz, text) TO clinic_executor;--> statement-breakpoint

-- ── Approved vendor requests (existing maker-checker: requester ≠ approver, platform owner approves; vendor_request_consume) ─────────
-- A server_fee_change (BILL-20): consumed and applied in one call on the executor login. Under the tenant billing lock, so "the change takes
-- effect in a month after the last issued invoice" is checked against issuance serialized by the same lock (§4b).
CREATE FUNCTION public.vendor_billing_apply_fee_change(p_request uuid, p_tenant uuid, p_service text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  q public.vendor_requests;
  pl jsonb;
  v_id uuid;
BEGIN
  PERFORM public.vendor_billing_lock(p_tenant);
  pl := public.vendor_request_consume(p_request, 'server_fee_change', p_tenant, p_service);
  SELECT * INTO STRICT q FROM public.vendor_requests WHERE id = p_request;
  IF EXISTS (SELECT 1 FROM public.vendor_invoices i WHERE i.tenant_id = p_tenant AND i.period >= pl ->> 'effective_month') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: effective month not after the last issued invoice (already_invoiced)' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.server_fee_versions (tenant_id, amount_rupiah, effective_month, reason, request_id, proposed_by, approved_by)
  VALUES (p_tenant, (pl ->> 'amount_rupiah')::integer, pl ->> 'effective_month', q.reason, q.id, q.requested_by, q.decided_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_apply_fee_change(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_apply_fee_change(uuid, uuid, text) TO clinic_executor;--> statement-breakpoint

-- An invoice_waiver (BILL-31; plan §4, Panel 2 D): the binding is re-validated at consume — the invoice belongs to the request's tenant and is
-- issued, the approved amount ≤ its outstanding (an altered or stale amount is refused and the request stays unconsumed: the whole call rolls
-- back). amount = outstanding → waiver (invoice waived); less → a partial credit allocated to that invoice. Both immutable notes.
CREATE FUNCTION public.vendor_billing_apply_waiver(p_request uuid, p_tenant uuid, p_service text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  q public.vendor_requests;
  pl jsonb;
  i public.vendor_invoices;
  v_amount integer;
  v_out integer;
  v_id uuid;
BEGIN
  PERFORM public.vendor_billing_lock(p_tenant);
  SELECT * INTO q FROM public.vendor_requests WHERE id = p_request;
  SELECT * INTO i FROM public.vendor_invoices WHERE id = (q.payload ->> 'invoice_id')::uuid AND tenant_id = p_tenant FOR UPDATE;
  pl := public.vendor_request_consume(p_request, 'invoice_waiver', p_tenant, p_service);
  IF i.id IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: waiver invoice not of this tenant (not_found)' USING ERRCODE = '42501';
  END IF;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice closed (invoice_closed)' USING ERRCODE = '40001';
  END IF;
  v_amount := (pl ->> 'amount_rupiah')::integer;
  v_out := public.vendor_invoice_outstanding(i.id);
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount > v_out THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: waiver amount above the outstanding (amount_stale)' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.vendor_credit_notes (tenant_id, source_invoice_id, kind, amount_rupiah, remaining_rupiah, reason, request_id, requested_by, approved_by, created_by)
  VALUES (p_tenant, i.id, CASE WHEN v_amount = v_out THEN 'waiver' ELSE 'credit' END, v_amount, v_amount, q.reason, q.id, q.requested_by, q.decided_by,
          public.vendor_service_name(p_service))
  RETURNING id INTO v_id;
  PERFORM public.vendor_billing_allocate(p_tenant, i.id);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_apply_waiver(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_apply_waiver(uuid, uuid, text) TO clinic_executor;--> statement-breakpoint

-- ── Reminders (PR-61: at the due date, +7, +14; Asia/Jakarta) — in-app, to the tenant's owner and finance roles; once per invoice and kind.
CREATE FUNCTION public.vendor_billing_reminders(p_now timestamptz, p_service text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i record;
  k text;
  v_today date := (p_now AT TIME ZONE 'Asia/Jakarta')::date;
  n integer := 0;
BEGIN
  FOR i IN SELECT v.id, v.tenant_id, v.due_date FROM public.vendor_invoices v
            WHERE v.state = 'issued' AND v.due_date <= v_today AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v.tenant_id)
            ORDER BY v.id LOOP
    FOREACH k IN ARRAY ARRAY['due','plus7','plus14'] LOOP
      CONTINUE WHEN v_today < i.due_date + CASE k WHEN 'due' THEN 0 WHEN 'plus7' THEN 7 ELSE 14 END;
      INSERT INTO public.vendor_reminders AS vr (tenant_id, invoice_id, kind) VALUES (i.tenant_id, i.id, k) ON CONFLICT ON CONSTRAINT vendor_reminders_key DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id)
        VALUES (i.tenant_id, 'vendor_invoice_reminder', 'owner', NULL, 'vendor_invoice', i.id),
               (i.tenant_id, 'vendor_invoice_reminder', 'finance', NULL, 'vendor_invoice', i.id);
        n := n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_reminders(timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_reminders(timestamptz, text) TO clinic_executor;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.vendor_billing_issue(timestamptz, text) TO clinic_executor;--> statement-breakpoint

-- ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Saya › Tagihan Server (UX-49; 07 :67): the bound tenant's invoices with outstanding, credits and attempts (instructions only for an open
-- attempt; never a provider body). Owner and finance (pay), Admin Pusat and the auditor (read). The undecided gates are reported so the page
-- can show "Pembayaran belum tersedia" without guessing.
CREATE FUNCTION public.vendor_billing_tenant_view() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT x0.tenant_id, x0.staff_id, x0.role INTO a FROM public.tenant_actor_lock() x0;
  IF a.role NOT IN ('owner','finance','admin_pusat','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the server-fee invoices' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'role', a.role,
    'can_pay', a.role IN ('owner','finance'),
    'payment_available', (SELECT channel_fee_bearer = 'tenant' FROM public.vendor_billing_policy WHERE id = 1) IS TRUE,
    'credit_balance', coalesce((SELECT sum(remaining_rupiah) FROM public.vendor_credit_notes WHERE tenant_id = a.tenant_id), 0),
    'invoices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'number', i.number, 'kind', i.kind, 'period', i.period, 'service_from', i.service_from, 'service_to', i.service_to,
        'issue_date', i.issue_date, 'due_date', i.due_date, 'fee_amount', i.fee_amount, 'proration', i.proration, 'amount', i.amount_rupiah,
        'vat', i.vat_rupiah, 'total', i.total_rupiah, 'state', i.state, 'outstanding', public.vendor_invoice_outstanding(i.id),
        'credits', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'amount', ca.amount_rupiah) ORDER BY ca.created_at), '[]'::jsonb)
                      FROM public.vendor_credit_allocations ca JOIN public.vendor_credit_notes c ON c.id = ca.credit_id WHERE ca.invoice_id = i.id),
        'attempts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'reff_id', x.reff_id, 'channel', x.channel_code, 'amount', x.amount_rupiah,
                       'state', x.state, 'expires_at', x.expires_at, 'admin', x.provider_admin, 'total', x.provider_total,
                       'instruction', CASE WHEN x.state = 'pending' THEN x.instruction END) ORDER BY x.seq), '[]'::jsonb)
                       FROM public.vendor_payment_attempts x WHERE x.invoice_id = i.id))
        ORDER BY i.period DESC), '[]'::jsonb)
      FROM public.vendor_invoices i WHERE i.tenant_id = a.tenant_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_billing_tenant_view() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_billing_tenant_view() TO clinic_app;
