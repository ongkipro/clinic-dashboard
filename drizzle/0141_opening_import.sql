CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"cutover_date" date NOT NULL,
	"state" text DEFAULT 'staged' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"validation_revision" integer DEFAULT 0 NOT NULL,
	"validated_manifest_sha256" text,
	"summary_json" jsonb,
	"error_code" text,
	"staged_by" uuid NOT NULL,
	"staged_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_revision" integer,
	"approved_manifest_sha256" text,
	"applied_by" uuid,
	"applied_at" timestamp with time zone,
	"rolled_back_by" uuid,
	"rolled_back_at" timestamp with time zone,
	"rollback_reason" text,
	"purge_after" timestamp with time zone NOT NULL,
	"payload_purged_at" timestamp with time zone,
	CONSTRAINT "import_batches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_batches_source_check" CHECK ("import_batches"."source_system" ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
	CONSTRAINT "import_batches_state_check" CHECK ("import_batches"."state" in ('staged','validated','approved','applying','applied','apply_failed','rolled_back','rejected')),
	CONSTRAINT "import_batches_row_count_check" CHECK ("import_batches"."row_count" between 0 and 2000),
	CONSTRAINT "import_batches_sha_check" CHECK (("import_batches"."validated_manifest_sha256" is null or "import_batches"."validated_manifest_sha256" ~ '^[0-9a-f]{64}$')
        and ("import_batches"."approved_manifest_sha256" is null or "import_batches"."approved_manifest_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "import_batches_error_code_check" CHECK ("import_batches"."error_code" is null or "import_batches"."error_code" ~ '^[a-z][a-z0-9_]{1,48}$'),
	CONSTRAINT "import_batches_approval_check" CHECK (("import_batches"."state" not in ('approved','applying','applied','rolled_back'))
        or ("import_batches"."approved_by" is not null and "import_batches"."approved_at" is not null and "import_batches"."approved_revision" is not null and "import_batches"."approved_manifest_sha256" is not null)),
	CONSTRAINT "import_batches_rollback_check" CHECK (("import_batches"."state" <> 'rolled_back')
        or ("import_batches"."applied_by" is not null and "import_batches"."applied_at" is not null and "import_batches"."rolled_back_by" is not null and "import_batches"."rolled_back_at" is not null and "import_batches"."rollback_reason" in ('cutover_correction','duplicate_batch','mapping_error','owner_cancelled')))
);
--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_opening_facts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"fact_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"amount_idr" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "import_opening_facts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_opening_facts_entity_key" UNIQUE("tenant_id","batch_id","fact_kind","entity_id"),
	CONSTRAINT "import_opening_facts_kind_check" CHECK ("import_opening_facts"."fact_kind" in ('balance','package','booking_dp','receivable')),
	CONSTRAINT "import_opening_facts_amount_check" CHECK ("import_opening_facts"."amount_idr" between 1 and 1000000000000)
);
--> statement-breakpoint
ALTER TABLE "import_opening_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"row_no" integer NOT NULL,
	"source_key_hash" text NOT NULL,
	"canonical_payload_sha256" text NOT NULL,
	"apply_digest" text NOT NULL,
	"branch_id" uuid,
	"amount_idr" bigint DEFAULT 0 NOT NULL,
	"payload_enc" text,
	"dek_version" integer,
	"local_id" uuid,
	"applied_state" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "import_rows_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_rows_batch_entity_row_key" UNIQUE("tenant_id","batch_id","entity","row_no"),
	CONSTRAINT "import_rows_entity_check" CHECK ("import_rows"."entity" in ('patients','packages','balances','receivables','booking_dps')),
	CONSTRAINT "import_rows_row_no_check" CHECK ("import_rows"."row_no" between 1 and 2000),
	CONSTRAINT "import_rows_hash_check" CHECK ("import_rows"."source_key_hash" ~ '^[0-9a-f]{64}$' and "import_rows"."canonical_payload_sha256" ~ '^[0-9a-f]{64}$' and "import_rows"."apply_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_rows_payload_enc_check" CHECK ("import_rows"."payload_enc" is null or "import_rows"."payload_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
	CONSTRAINT "import_rows_amount_check" CHECK ("import_rows"."amount_idr" between 0 and 1000000000000),
	CONSTRAINT "import_rows_applied_state_check" CHECK ("import_rows"."applied_state" in ('pending','applied','replayed','reversed'))
);
--> statement-breakpoint
ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_id_map" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"entity" text NOT NULL,
	"source_key_hash" text NOT NULL,
	"canonical_payload_sha256" text NOT NULL,
	"local_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "source_id_map_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "source_id_map_entity_check" CHECK ("source_id_map"."entity" in ('patients','packages','balances','receivables','booking_dps')),
	CONSTRAINT "source_id_map_hash_check" CHECK ("source_id_map"."source_key_hash" ~ '^[0-9a-f]{64}$' and "source_id_map"."canonical_payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "source_id_map_state_check" CHECK ("source_id_map"."state" in ('active','reversed') and (("source_id_map"."state" = 'reversed') = ("source_id_map"."reversed_at" is not null)))
);
--> statement-breakpoint
ALTER TABLE "source_id_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patients" DROP CONSTRAINT "patients_identity_check";--> statement-breakpoint
ALTER TABLE "booking_deposits" DROP CONSTRAINT "booking_deposits_check";--> statement-breakpoint
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_check";--> statement-breakpoint
ALTER TABLE "balance_entries" DROP CONSTRAINT "balance_entries_check";--> statement-breakpoint
ALTER TABLE "packages" DROP CONSTRAINT "packages_check";--> statement-breakpoint
ALTER TABLE "booking_deposits" ALTER COLUMN "appointment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_deposits" ALTER COLUMN "catalog_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_deposits" ALTER COLUMN "receipt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "receivables" ALTER COLUMN "visit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "invoice_line_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "opening_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "opening_reversed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD COLUMN "is_opening" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD COLUMN "opening_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "receivables" ADD COLUMN "is_opening" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "receivables" ADD COLUMN "opening_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "is_opening" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "opening_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "opening_historical_used_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_staged_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staged_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_approved_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_applied_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","applied_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_rolled_back_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rolled_back_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_opening_facts" ADD CONSTRAINT "import_opening_facts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_opening_facts" ADD CONSTRAINT "import_opening_facts_tenant_id_batch_id_import_batches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."import_batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_opening_facts" ADD CONSTRAINT "import_opening_facts_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_batch_id_import_batches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."import_batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_id_map" ADD CONSTRAINT "source_id_map_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_id_map" ADD CONSTRAINT "source_id_map_tenant_id_batch_id_import_batches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."import_batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_tenant_state_idx" ON "import_batches" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "import_batches_purge_idx" ON "import_batches" USING btree ("purge_after") WHERE "import_batches"."payload_purged_at" is null;--> statement-breakpoint
CREATE INDEX "import_opening_facts_batch_idx" ON "import_opening_facts" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "import_opening_facts_date_idx" ON "import_opening_facts" USING btree ("tenant_id","effective_date");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("tenant_id","batch_id","entity","row_no");--> statement-breakpoint
CREATE UNIQUE INDEX "source_id_map_active_key" ON "source_id_map" USING btree ("tenant_id","source_system","entity","source_key_hash") WHERE "source_id_map"."state" = 'active';--> statement-breakpoint
CREATE INDEX "source_id_map_batch_idx" ON "source_id_map" USING btree ("tenant_id","batch_id");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_identity_check" CHECK (("patients"."identity_type" = 'nik' and "patients"."identity_enc" is not null and "patients"."identity_bidx" is not null and "patients"."no_identity_reason" is null)
      or ("patients"."identity_type" in ('passport','kitas') and "patients"."identity_enc" is not null and "patients"."identity_bidx" is not null and length(btrim(coalesce("patients"."no_identity_reason", ''))) between 3 and 300)
      or ("patients"."identity_type" = 'newborn_via_guardian' and "patients"."identity_enc" is null and "patients"."identity_bidx" is null and length(btrim(coalesce("patients"."no_identity_reason", ''))) between 3 and 300)
      or ("patients"."identity_type" = 'online_pending' and "patients"."created_as" = 'patient_online' and "patients"."created_by" is null and "patients"."identity_enc" is null and "patients"."identity_bidx" is null and "patients"."no_identity_reason" = 'Pendaftaran awal booking online, lengkapi identitas di Front Office')
      or ("patients"."identity_type" = 'opening_import' and "patients"."opening_batch_id" is not null and "patients"."created_as" = 'owner' and "patients"."created_by" is not null and "patients"."identity_enc" is null and "patients"."identity_bidx" is null and "patients"."no_identity_reason" = 'Impor data awal klinik, lengkapi identitas saat kunjungan'));--> statement-breakpoint
ALTER TABLE "booking_deposits" ADD CONSTRAINT "booking_deposits_check" CHECK ("booking_deposits"."amount" between 1 and 1000000000000 and "booking_deposits"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "booking_deposits"."method" in ('cash','edc','transfer') and "booking_deposits"."state" in ('held','applied','moved_to_balance','forfeited','refunded','opening_reversed') and "booking_deposits"."tax_category" in ('exempt_medical','taxable_service','taxable_goods','non_object')
      and "booking_deposits"."vat_base" >= 0 and "booking_deposits"."vat_amount" >= 0 and "booking_deposits"."vat_base" + "booking_deposits"."vat_amount" = "booking_deposits"."amount" and ("booking_deposits"."is_pkp_at_receipt" or "booking_deposits"."vat_amount" = 0)
      and "booking_deposits"."vat_recognised_amount" between 0 and "booking_deposits"."vat_amount" and "booking_deposits"."cutoff_hours" between 0 and 72
      and "booking_deposits"."received_as" in ('owner','manager','fo_cashier','finance')
      and (("booking_deposits"."state" = 'held') = ("booking_deposits"."decided_at" is null)) and (("booking_deposits"."state" = 'held') = ("booking_deposits"."decided_by" is null))
      and (("booking_deposits"."state" = 'applied') = ("booking_deposits"."applied_line_id" is not null))
      and (("booking_deposits"."state" = 'refunded') = ("booking_deposits"."refund_method" is not null)) and ("booking_deposits"."refund_method" is null or "booking_deposits"."refund_method" in ('cash','edc','transfer'))
      and ("booking_deposits"."refund_details" is null or "booking_deposits"."refund_method" in ('edc','transfer') and jsonb_typeof("booking_deposits"."refund_details") = 'object')
      and ("booking_deposits"."state" = 'held' or "booking_deposits"."decision_code" ~ '^[a-z][a-z_]{2,40}$')
      and ("booking_deposits"."decided_as" is null or "booking_deposits"."decided_as" in ('owner','admin_pusat','manager','fo_cashier','central_cs','finance'))
      and ((not "booking_deposits"."is_opening" and "booking_deposits"."appointment_id" is not null and "booking_deposits"."catalog_version_id" is not null and "booking_deposits"."receipt_id" is not null and "booking_deposits"."opening_batch_id" is null and "booking_deposits"."state" <> 'opening_reversed')
        or ("booking_deposits"."is_opening" and "booking_deposits"."receipt_id" is null and "booking_deposits"."opening_batch_id" is not null)));--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_check" CHECK ("receivables"."amount" between 1 and 1000000000000 and "receivables"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "receivables"."state" in ('open','collected','written_off','opening_reversed')
      and "receivables"."collected_amount" >= 0 and "receivables"."written_off_amount" >= 0 and "receivables"."collected_amount" + "receivables"."written_off_amount" <= "receivables"."amount"
      and (("receivables"."state" = 'collected') = ("receivables"."collected_amount" = "receivables"."amount"))
      and (("receivables"."state" = 'written_off') = ("receivables"."written_off_amount" > 0)) and ("receivables"."state" <> 'written_off' or "receivables"."collected_amount" + "receivables"."written_off_amount" = "receivables"."amount")
      and ("receivables"."state" = 'open' or "receivables"."write_off_approval_id" is null or "receivables"."state" = 'written_off')
      and "receivables"."created_as" in ('owner','manager','fo_cashier')
      and ((not "receivables"."is_opening" and "receivables"."visit_id" is not null and "receivables"."opening_batch_id" is null and "receivables"."state" <> 'opening_reversed')
        or ("receivables"."is_opening" and "receivables"."visit_id" is null and "receivables"."opening_batch_id" is not null)));--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_check" CHECK ("balance_entries"."kind" in ('top_up','use','from_expiry','from_cancel','from_interrupted_treatment','from_substitution','from_refund','dp_transfer','cash_refund','opening_balance','opening_reversal') and "balance_entries"."amount" <> 0 and "balance_entries"."balance_after" >= 0
      and ("balance_entries"."kind" in ('use','cash_refund','opening_reversal')) = ("balance_entries"."amount" < 0)
      and not "balance_entries"."vat_settled"
      and num_nonnulls("balance_entries"."payment_id", "balance_entries"."charge_id", "balance_entries"."source_id") = 1
      and ("balance_entries"."source_kind" is null) = ("balance_entries"."source_id" is null) and ("balance_entries"."source_kind" is null or "balance_entries"."source_kind" ~ '^[a-z][a-z_]{1,40}$')
      and ("balance_entries"."kind" = 'use') = ("balance_entries"."payment_id" is not null)
      and ("balance_entries"."reason" is null or length(btrim("balance_entries"."reason")) between 3 and 500)
      and "balance_entries"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$');--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_check" CHECK ("packages"."state" in ('active','expired','cancelled') and "packages"."price" between 1 and 1000000000000
      and "packages"."min_dp" between 1 and "packages"."price" and "packages"."moved_to_balance" between 0 and "packages"."price"
      and (("packages"."state" = 'active') = ("packages"."closed_at" is null))
      and ("packages"."state" = 'active' or "packages"."close_reason" is not null and "packages"."paid_unused_moved" >= 0 and "packages"."remainder_cancelled" >= 0)
      and "packages"."vat_reversed_amount" >= 0 and (("packages"."vat_reversed_amount" > 0) = ("packages"."vat_reversed_at" is not null))
      and ((not "packages"."is_opening" and "packages"."invoice_id" is not null and "packages"."invoice_line_id" is not null and "packages"."opening_batch_id" is null and "packages"."opening_historical_used_count" = 0)
        or ("packages"."is_opening" and "packages"."invoice_id" is null and "packages"."invoice_line_id" is null and "packages"."opening_batch_id" is not null and "packages"."opening_historical_used_count" >= 0)));
-- T-128 SQL Rules (Migration 0141 r3 — Opening-Data Import, PR-85, DATA-58, MIG-3, DEC-133, R3).
-- Closes ALL R3 r2 findings:
--   r2 P1 #1: Cryptographic SQL apply_digest binding recomputed inside import_apply over the EXACT operational columns written,
--             verified against import_rows.apply_digest; TS applyApprovedImportBatch reads & authenticates AEAD staged rows from DB.
--   r2 P1 #2: Patient rollback checks ALL outside-batch financial dependencies (balance_entries, packages, booking_deposits, receivables,
--             appointments, visits, invoices, patient_merges, consents) AND retires the patient via one-way opening_reversed = true
--             (hidden from active patients_read while preserving immutable history).
--   r2 P1 #3: ledger_journal_export preserves historical 'draft-11-2026-11-19' automatic postings alongside 'draft-11-2026-11-26-t128';
--             LEFT JOIN completeness check detects both pending AND missing receipts.
--   r2 P2 #4: Multiple opening balance credits for same patient in one batch allowed and unwound in descending seq order.
--   r2 P2 #5: Base64 ciphertext CHECK on import_rows.payload_enc; strict pre-cast input validation in import_apply with fixed error strings;
--             explicit REVOKE ALL FROM PUBLIC, clinic_app on import_purge_expired.

REVOKE ALL ON TABLE public.import_batches FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.import_rows FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.source_id_map FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.import_opening_facts FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.source_id_map ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.import_opening_facts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.import_batches', 'tenant-shared', 'import', '{owner}', 'import_stage, import_approve, import_apply, import_rollback (src/modules/import)', 'none (tenant-wide)'),
  ('public.import_rows', 'tenant-shared', 'import', '{owner}', 'import_stage, import_apply, import_purge_expired (src/modules/import)', 'none (tenant-wide)'),
  ('public.source_id_map', 'tenant-shared', 'import', '{owner}', 'import_apply, import_rollback (src/modules/import)', 'none (tenant-wide)'),
  ('public.import_opening_facts', 'tenant-shared', 'import', '{owner,finance,auditor}', 'import_apply, import_rollback (src/modules/import)', 'per branch_id');--> statement-breakpoint

INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.import_batches', 'never'),
  ('public.import_rows', 'never'),
  ('public.source_id_map', 'never'),
  ('public.import_opening_facts', 'never');--> statement-breakpoint

-- Patients guard & read policy update (r2 P1 #2): allow ONLY one-way opening_reversed false -> true for opening-imported patients,
-- hiding rolled-back patients from active clinical/cashier reads while preserving immutable history (zero deletes).
CREATE OR REPLACE FUNCTION public.patients_rows_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'patients' AND TG_OP = 'UPDATE'
     AND OLD.opening_batch_id IS NOT NULL
     AND NOT OLD.opening_reversed
     AND NEW.opening_reversed
     AND (NEW.id, NEW.tenant_id, NEW.mrn, NEW.full_name, NEW.birth_date, NEW.sex, NEW.identity_type, NEW.identity_enc,
          NEW.identity_bidx, NEW.no_identity_reason, NEW.religion, NEW.occupation, NEW.education, NEW.marital_status,
          NEW.address, NEW.ihs_patient_id, NEW.registered_branch_id, NEW.opening_batch_id, NEW.created_by, NEW.created_as, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.tenant_id, OLD.mrn, OLD.full_name, OLD.birth_date, OLD.sex, OLD.identity_type, OLD.identity_enc,
          OLD.identity_bidx, OLD.no_identity_reason, OLD.religion, OLD.occupation, OLD.education, OLD.marital_status,
          OLD.address, OLD.ihs_patient_id, OLD.registered_branch_id, OLD.opening_batch_id, OLD.created_by, OLD.created_as, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'patient records are never deleted or rewritten here' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patients_rows_guard() FROM PUBLIC;--> statement-breakpoint

ALTER POLICY patients_read ON public.patients
  USING (tenant_id = public.app_tenant_id()
    AND NOT opening_reversed
    AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']));--> statement-breakpoint

-- Operational guards updated for opening-import rows (preserving 0098 package sharing_allowed freeze):
CREATE OR REPLACE FUNCTION public.packages_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'packages are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'active' OR NEW.moved_to_balance <> 0 OR NEW.vat_reversed_amount <> 0 THEN
      RAISE EXCEPTION 'a package opens active' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_opening THEN
      IF NEW.opening_batch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.import_batches b
         WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.opening_batch_id AND b.state = 'applying'
      ) THEN
        RAISE EXCEPTION 'an opening package requires an applying import batch' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                    WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.invoice_line_id AND i.id = NEW.invoice_id AND i.state = 'issued'
                      AND i.visit_id IS NULL AND NOT i.counter AND NEW.patient_id IN (i.patient_id, public.patient_canonical(i.tenant_id, i.patient_id)) AND i.branch_id = NEW.sold_branch_id
                      AND l.item_id = NEW.item_id AND l.catalog_version_id = NEW.catalog_version_id AND l.line_total = NEW.price AND l.quantity = 1) THEN
      RAISE EXCEPTION 'a package opens active from its invoice line' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.sold_branch_id, NEW.patient_id, NEW.invoice_id, NEW.invoice_line_id, NEW.item_id, NEW.catalog_version_id, NEW.price,
      NEW.min_dp, NEW.validity_end, NEW.created_by, NEW.created_as, NEW.created_at, NEW.sharing_allowed, NEW.is_opening, NEW.opening_batch_id, NEW.opening_historical_used_count)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.sold_branch_id, OLD.patient_id, OLD.invoice_id, OLD.invoice_line_id, OLD.item_id, OLD.catalog_version_id, OLD.price,
      OLD.min_dp, OLD.validity_end, OLD.created_by, OLD.created_as, OLD.created_at, OLD.sharing_allowed, OLD.is_opening, OLD.opening_batch_id, OLD.opening_historical_used_count)
     OR NEW.moved_to_balance < OLD.moved_to_balance OR NEW.vat_reversed_amount < OLD.vat_reversed_amount
     OR OLD.state <> 'active' AND (NEW.state, NEW.closed_at, NEW.closed_by, NEW.closed_as, NEW.close_reason, NEW.paid_unused_moved, NEW.remainder_cancelled, NEW.moved_to_balance)
        IS DISTINCT FROM (OLD.state, OLD.closed_at, OLD.closed_by, OLD.closed_as, OLD.close_reason, OLD.paid_unused_moved, OLD.remainder_cancelled, OLD.moved_to_balance) THEN
    RAISE EXCEPTION 'a package keeps its sale; it closes once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.packages_guard() FROM PUBLIC;--> statement-breakpoint

-- Opening packages carry their paid-remaining value in packages.price (invoice_line_id IS NULL), so package_paid
-- returns price - moved_to_balance for is_opening rows, enabling live session reservation, redemption, and expiry/cancel.
CREATE OR REPLACE FUNCTION public.package_paid(pk public.packages) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT greatest(
    0,
    (CASE WHEN pk.is_opening THEN pk.price ELSE public.kasir_line_paid(pk.tenant_id, pk.invoice_line_id) END)
    - pk.moved_to_balance
  )::bigint
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_paid(public.packages) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.booking_deposits_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'booking deposits are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_opening THEN
      IF NEW.state <> 'held' OR NEW.vat_amount <> 0 OR NEW.vat_recognised_amount <> 0
         OR NEW.opening_batch_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.import_batches b
            WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.opening_batch_id AND b.state = 'applying'
         ) THEN
        RAISE EXCEPTION 'an opening deposit opens held inside an applying import batch' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.state <> 'held' OR NEW.vat_recognised_amount <> NEW.vat_amount
       OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id IS NULL
                        AND r.branch_id = NEW.branch_id AND NOT r.is_simulated AND r.total = NEW.amount)
       OR NOT EXISTS (SELECT 1 FROM public.appointments ap WHERE ap.tenant_id = NEW.tenant_id AND ap.id = NEW.appointment_id AND ap.branch_id = NEW.branch_id
                        AND ap.catalog_version_id = NEW.catalog_version_id AND public.patient_canonical(ap.tenant_id, ap.patient_id) = NEW.patient_id) THEN
      RAISE EXCEPTION 'a deposit is taken held, for its appointment, with its own receipt' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- One-time appointment match for a held opening deposit (r4 P1 #1): verifies tenant, branch, patient, and active service catalog version,
  -- allowing NULL -> NOT NULL on (appointment_id, catalog_version_id) while every other column stays immutable.
  IF OLD.is_opening AND OLD.state = 'held' AND NEW.state = 'held'
     AND OLD.appointment_id IS NULL AND OLD.catalog_version_id IS NULL
     AND NEW.appointment_id IS NOT NULL AND NEW.catalog_version_id IS NOT NULL
     AND (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.receipt_id, NEW.method, NEW.amount,
          NEW.tax_category, NEW.is_pkp_at_receipt, NEW.vat_base, NEW.vat_amount, NEW.vat_recognised_amount,
          NEW.cutoff_hours, NEW.command_key, NEW.received_by, NEW.received_as, NEW.received_at, NEW.is_opening,
          NEW.opening_batch_id, NEW.decided_at, NEW.decided_by, NEW.decided_as, NEW.decision_code,
          NEW.applied_line_id, NEW.refund_method, NEW.refund_details)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.receipt_id, OLD.method, OLD.amount,
          OLD.tax_category, OLD.is_pkp_at_receipt, OLD.vat_base, OLD.vat_amount, OLD.vat_recognised_amount,
          OLD.cutoff_hours, OLD.command_key, OLD.received_by, OLD.received_as, OLD.received_at, OLD.is_opening,
          OLD.opening_batch_id, OLD.decided_at, OLD.decided_by, OLD.decided_as, OLD.decision_code,
          OLD.applied_line_id, OLD.refund_method, OLD.refund_details)
     AND EXISTS (
       SELECT 1 FROM public.appointments ap
         JOIN public.catalog_versions cv ON cv.tenant_id = ap.tenant_id AND cv.id = NEW.catalog_version_id
         JOIN public.catalog_items ci ON ci.tenant_id = cv.tenant_id AND ci.id = cv.item_id
        WHERE ap.tenant_id = NEW.tenant_id
          AND ap.id = NEW.appointment_id
          AND ap.branch_id = NEW.branch_id
          AND ap.catalog_version_id = NEW.catalog_version_id
          AND public.patient_canonical(ap.tenant_id, ap.patient_id) = NEW.patient_id
          AND cv.state = 'active'
          AND ci.kind = 'service'
     ) THEN
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.appointment_id, NEW.patient_id, NEW.catalog_version_id, NEW.receipt_id, NEW.method, NEW.amount,
      NEW.tax_category, NEW.is_pkp_at_receipt, NEW.vat_base, NEW.vat_amount, NEW.cutoff_hours, NEW.command_key, NEW.received_by, NEW.received_as, NEW.received_at, NEW.is_opening, NEW.opening_batch_id)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.appointment_id, OLD.patient_id, OLD.catalog_version_id, OLD.receipt_id, OLD.method, OLD.amount,
      OLD.tax_category, OLD.is_pkp_at_receipt, OLD.vat_base, OLD.vat_amount, OLD.cutoff_hours, OLD.command_key, OLD.received_by, OLD.received_as, OLD.received_at, OLD.is_opening, OLD.opening_batch_id)
     OR OLD.state <> 'held' OR NEW.state = 'held'
     OR NEW.state = 'forfeited' AND NEW.vat_recognised_amount <> OLD.vat_recognised_amount
     OR NEW.state IN ('moved_to_balance','refunded','applied','opening_reversed') AND NEW.vat_recognised_amount <> 0 THEN
    RAISE EXCEPTION 'a deposit is decided once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.booking_deposits_guard() FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.receivables_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receivables are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open' OR NEW.collected_amount <> 0 OR NEW.written_off_amount <> 0 OR NEW.write_off_approval_id IS NOT NULL THEN
      RAISE EXCEPTION 'a receivable opens with nothing collected' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_opening AND (NEW.opening_batch_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.import_batches b WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.opening_batch_id AND b.state = 'applying'
    )) THEN
      RAISE EXCEPTION 'an opening receivable requires an applying import batch' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.visit_id, NEW.amount, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at, NEW.is_opening, NEW.opening_batch_id)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.visit_id, OLD.amount, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at, OLD.is_opening, OLD.opening_batch_id)
     OR OLD.state <> 'open' OR NEW.collected_amount < OLD.collected_amount OR OLD.written_off_amount <> 0 AND NEW.written_off_amount <> OLD.written_off_amount
     OR NEW.write_off_approval_id IS NOT NULL AND OLD.write_off_approval_id IS NOT NULL AND NEW.write_off_approval_id <> OLD.write_off_approval_id THEN
    RAISE EXCEPTION 'a receivable is only collected or written off' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.receivables_guard() FROM PUBLIC;--> statement-breakpoint

-- Import table immutability guards:
CREATE FUNCTION public.import_batches_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: import batches are never deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.tenant_id, NEW.source_system, NEW.cutover_date, NEW.staged_by, NEW.staged_at, NEW.purge_after)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.source_system, OLD.cutover_date, OLD.staged_by, OLD.staged_at, OLD.purge_after) THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: batch identity and purge_after are immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.validated_manifest_sha256 IS NOT NULL AND NEW.validated_manifest_sha256 IS DISTINCT FROM OLD.validated_manifest_sha256 THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: validated manifest digest is immutable once sealed' USING ERRCODE = '55000';
    END IF;
    IF OLD.applied_at IS NOT NULL AND (NEW.applied_by, NEW.applied_at) IS DISTINCT FROM (OLD.applied_by, OLD.applied_at) THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: applied attribution is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.state = 'rolled_back' AND NEW.state IS DISTINCT FROM 'rolled_back' THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: rolled_back batch is terminal' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_batches_guard() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER import_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION public.import_batches_guard();--> statement-breakpoint
ALTER TABLE public.import_batches ENABLE ALWAYS TRIGGER import_batches_guard;--> statement-breakpoint
CREATE TRIGGER import_batches_no_truncate BEFORE TRUNCATE ON public.import_batches FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.import_batches ENABLE ALWAYS TRIGGER import_batches_no_truncate;--> statement-breakpoint

CREATE FUNCTION public.source_id_map_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: source_id_map rows are never deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'reversed' THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: reversed source_id_map tombstone is immutable' USING ERRCODE = '55000';
    END IF;
    IF (NEW.id, NEW.tenant_id, NEW.source_system, NEW.entity, NEW.source_key_hash, NEW.canonical_payload_sha256, NEW.local_id, NEW.batch_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.tenant_id, OLD.source_system, OLD.entity, OLD.source_key_hash, OLD.canonical_payload_sha256, OLD.local_id, OLD.batch_id, OLD.created_at) THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: only active -> reversed transition is permitted' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.source_id_map_guard() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER source_id_map_guard BEFORE UPDATE OR DELETE ON public.source_id_map FOR EACH ROW EXECUTE FUNCTION public.source_id_map_guard();--> statement-breakpoint
ALTER TABLE public.source_id_map ENABLE ALWAYS TRIGGER source_id_map_guard;--> statement-breakpoint
CREATE TRIGGER source_id_map_no_truncate BEFORE TRUNCATE ON public.source_id_map FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.source_id_map ENABLE ALWAYS TRIGGER source_id_map_no_truncate;--> statement-breakpoint

CREATE FUNCTION public.import_opening_facts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: opening facts are never deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.tenant_id, NEW.batch_id, NEW.fact_kind, NEW.entity_id, NEW.branch_id, NEW.effective_date, NEW.amount_idr, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.batch_id, OLD.fact_kind, OLD.entity_id, OLD.branch_id, OLD.effective_date, OLD.amount_idr, OLD.created_at)
       OR (OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at) THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: opening facts are append-only' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_opening_facts_guard() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER import_opening_facts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.import_opening_facts FOR EACH ROW EXECUTE FUNCTION public.import_opening_facts_guard();--> statement-breakpoint
ALTER TABLE public.import_opening_facts ENABLE ALWAYS TRIGGER import_opening_facts_guard;--> statement-breakpoint
CREATE TRIGGER import_opening_facts_no_truncate BEFORE TRUNCATE ON public.import_opening_facts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.import_opening_facts ENABLE ALWAYS TRIGGER import_opening_facts_no_truncate;--> statement-breakpoint

CREATE FUNCTION public._import_owner_actor()
RETURNS TABLE (tenant_id uuid, staff_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: owner_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT a.tenant_id, a.staff_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._import_owner_actor() FROM PUBLIC;--> statement-breakpoint

-- Trusted executor-only owner verifier (r3 P1 #1): validates tenant & active owner under staff_access lock and sets
-- transaction-local tenant/actor GUCs so audit_append and downstream triggers execute under verified authority.
CREATE FUNCTION public._import_executor_owner(p_tenant_id uuid, p_actor_staff_id uuid)
RETURNS TABLE (tenant_id uuid, staff_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF p_tenant_id IS NULL OR p_actor_staff_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: owner_only' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || p_tenant_id::text, 0));
  SELECT EXISTS (
    SELECT 1
      FROM public.tenants_registry tr
      JOIN public.staff s ON s.tenant_id = tr.id AND s.id = p_actor_staff_id
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
       AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
      JOIN public.staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.id AND sr.role = 'owner'
     WHERE tr.id = p_tenant_id
       AND tr.lifecycle_state IN ('onboarding', 'live')
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: owner_only' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true),
          set_config('app.staff_id', p_actor_staff_id::text, true),
          set_config('app.roles', 'owner', true),
          set_config('app.allowed_branch_ids', '*', true),
          set_config('app.active_branch_id', '', true);
  RETURN QUERY SELECT p_tenant_id, p_actor_staff_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._import_executor_owner(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Semantic Gregorian YYYY-MM-DD parser (r3 P2 #5): never passes raw untrusted strings to ::date so PostgreSQL
-- cannot echo patient-supplied values in cast diagnostics.
CREATE FUNCTION public._import_parse_iso_date(p_text text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_y integer;
  v_m integer;
  v_d integer;
  v_max integer;
BEGIN
  IF p_text IS NULL OR p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid date' USING ERRCODE = '22023';
  END IF;
  v_y := substring(p_text FROM 1 FOR 4)::int;
  v_m := substring(p_text FROM 6 FOR 2)::int;
  v_d := substring(p_text FROM 9 FOR 2)::int;
  IF v_y < 1900 OR v_y > 2100 OR v_m < 1 OR v_m > 12 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid date' USING ERRCODE = '22023';
  END IF;
  v_max := CASE
    WHEN v_m IN (1, 3, 5, 7, 8, 10, 12) THEN 31
    WHEN v_m IN (4, 6, 9, 11) THEN 30
    WHEN (v_y % 400 = 0 OR (v_y % 4 = 0 AND v_y % 100 <> 0)) THEN 29
    ELSE 28
  END;
  IF v_d < 1 OR v_d > v_max THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid date' USING ERRCODE = '22023';
  END IF;
  RETURN make_date(v_y, v_m, v_d);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._import_parse_iso_date(text) FROM PUBLIC;--> statement-breakpoint

-- 1. Trusted executor-only batch staging (r3 P1 #1 & P2 #5):
--    - Granted strictly to clinic_executor (revoked from PUBLIC and clinic_app).
--    - Validates versioned AEAD envelope format v1.<dekVer>.<iv>.<tag>.<ct> matching patients.identity_enc.
--    - Derives validated_manifest_sha256 INSIDE SQL directly over the exact staged rows (including payload_enc hash),
--      so owner import_approve binds to the exact server-derived manifest of staged rows.
CREATE FUNCTION public.import_stage(
  p_tenant_id uuid,
  p_actor_staff_id uuid,
  p_source_system text,
  p_cutover_date date,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_now timestamptz;
  v_batch_id uuid;
  v_count integer;
  v_r jsonb;
  v_src text := lower(btrim(coalesce(p_source_system, '')));
  v_branch uuid;
  v_entity text;
  v_row_no_str text;
  v_amt_str text;
  v_dek_str text;
  v_amt bigint;
  v_penc text;
  v_manifest_sha text;
  v_c_pat integer := 0;
  v_c_pkg integer := 0;
  v_c_bal integer := 0;
  v_c_dp integer := 0;
  v_c_ar integer := 0;
  v_s_pkg bigint := 0;
  v_s_bal bigint := 0;
  v_s_dp bigint := 0;
  v_s_ar bigint := 0;
  v_summary jsonb;
BEGIN
  SELECT * INTO a FROM public._import_executor_owner(p_tenant_id, p_actor_staff_id);
  PERFORM public.real_patient_gate_assert(a.tenant_id);
  v_now := clock_timestamp();

  IF v_src !~ '^[a-z0-9][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid source_system' USING ERRCODE = '22023';
  END IF;
  IF p_cutover_date IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: cutover_date required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: rows must be array' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count < 1 OR v_count > 2000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: batch row count out of range' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.import_batches (
    tenant_id, source_system, cutover_date, state, row_count,
    validation_revision, validated_manifest_sha256, summary_json,
    staged_by, staged_at, purge_after
  ) VALUES (
    a.tenant_id, v_src, p_cutover_date, 'validated', v_count,
    1, NULL, NULL,
    a.staff_id, v_now, v_now + interval '7 days'
  ) RETURNING id INTO v_batch_id;

  FOR v_r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_r) <> 'object' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid staged row' USING ERRCODE = '22023';
    END IF;
    v_entity := coalesce(v_r->>'entity', '');
    v_penc := v_r->>'payloadEnc';
    v_row_no_str := coalesce(v_r->>'rowNo', '');
    v_amt_str := coalesce(v_r->>'amountIdr', '0');
    v_dek_str := coalesce(v_r->>'dekVersion', '');
    IF v_entity NOT IN ('patients', 'packages', 'balances', 'receivables', 'booking_dps')
       OR v_row_no_str !~ '^[1-9][0-9]{0,3}$'
       OR v_amt_str !~ '^[0-9]{1,13}$'
       OR v_dek_str !~ '^[1-9][0-9]{0,8}$'
       OR coalesce(v_r->>'sourceKeyHash', '') !~ '^[0-9a-f]{64}$'
       OR coalesce(v_r->>'canonicalPayloadSha256', '') !~ '^[0-9a-f]{64}$'
       OR coalesce(v_r->>'applyDigest', '') !~ '^[0-9a-f]{64}$'
       OR coalesce(v_r->>'branchId', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid staged row metadata' USING ERRCODE = '22023';
    END IF;
    IF v_penc IS NULL OR v_penc !~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: staged payload must be versioned AEAD envelope' USING ERRCODE = '22023';
    END IF;
    v_branch := (v_r->>'branchId')::uuid;
    v_amt := v_amt_str::bigint;
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch
    ) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found in tenant' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.import_rows (
      tenant_id, batch_id, entity, row_no, source_key_hash,
      canonical_payload_sha256, apply_digest, branch_id, amount_idr, payload_enc, dek_version
    ) VALUES (
      a.tenant_id, v_batch_id, v_entity, v_row_no_str::int, (v_r->>'sourceKeyHash'),
      (v_r->>'canonicalPayloadSha256'), (v_r->>'applyDigest'), v_branch,
      v_amt, v_penc, v_dek_str::int
    );
    IF v_entity = 'patients' THEN v_c_pat := v_c_pat + 1;
    ELSIF v_entity = 'packages' THEN v_c_pkg := v_c_pkg + 1; v_s_pkg := v_s_pkg + v_amt;
    ELSIF v_entity = 'balances' THEN v_c_bal := v_c_bal + 1; v_s_bal := v_s_bal + v_amt;
    ELSIF v_entity = 'booking_dps' THEN v_c_dp := v_c_dp + 1; v_s_dp := v_s_dp + v_amt;
    ELSIF v_entity = 'receivables' THEN v_c_ar := v_c_ar + 1; v_s_ar := v_s_ar + v_amt;
    END IF;
  END LOOP;

  -- Server-derived manifest digest over the EXACT staged rows (including ciphertext SHA-256) so approval is
  -- cryptographically bound to the staged rows and never trusts a caller-supplied manifest string (r3 P1 #1).
  SELECT encode(sha256(convert_to(
    'import-manifest-v2|' || v_src || '|' || to_char(p_cutover_date, 'YYYY-MM-DD') || '|' ||
    string_agg(
      r.entity || ':' || r.row_no::text || ':' || r.source_key_hash || ':' || r.canonical_payload_sha256 || ':' ||
      r.apply_digest || ':' || coalesce(r.branch_id::text, '') || ':' || r.amount_idr::text || ':' ||
      r.dek_version::text || ':' || encode(sha256(convert_to(r.payload_enc, 'UTF8')), 'hex'),
      '|' ORDER BY CASE r.entity WHEN 'patients' THEN 0 WHEN 'balances' THEN 1 WHEN 'packages' THEN 2 WHEN 'booking_dps' THEN 3 ELSE 4 END, r.row_no
    ),
    'UTF8'
  )), 'hex')
    INTO v_manifest_sha
    FROM public.import_rows r
   WHERE r.tenant_id = a.tenant_id AND r.batch_id = v_batch_id;

  v_summary := jsonb_build_object(
    'cutoverDate', to_char(p_cutover_date, 'YYYY-MM-DD'),
    'validatedManifestSha256', v_manifest_sha,
    'totalRows', v_count,
    'counts', jsonb_build_object('patients', v_c_pat, 'packages', v_c_pkg, 'balances', v_c_bal, 'bookingDps', v_c_dp, 'receivables', v_c_ar),
    'totalsIdr', jsonb_build_object('packagesPaidRemaining', v_s_pkg::text, 'balances', v_s_bal::text, 'bookingDps', v_s_dp::text, 'receivables', v_s_ar::text)
  );
  UPDATE public.import_batches
     SET validated_manifest_sha256 = v_manifest_sha,
         summary_json = v_summary
   WHERE tenant_id = a.tenant_id AND id = v_batch_id;

  PERFORM public.audit_append('settings_change', 'import_batch', v_batch_id, 'success', 'import_batch_staged');
  RETURN jsonb_build_object(
    'batchId', v_batch_id,
    'state', 'validated',
    'validationRevision', 1,
    'rowCount', v_count,
    'validatedManifestSha256', v_manifest_sha
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_stage(uuid,uuid,text,date,jsonb) FROM PUBLIC, clinic_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_stage(uuid,uuid,text,date,jsonb) TO clinic_executor;--> statement-breakpoint

-- 1b. Trusted executor-only active service catalog lookup by (tenant_id, upper(code)) (r5 P2 #1):
--     Returns a map of upper(code) -> active catalog_version_id strictly for active service items,
--     so stageValidatedImportBatch never accepts caller-supplied catalog UUIDs.
CREATE FUNCTION public.import_active_catalog_services(p_tenant_id uuid, p_actor_staff_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public._import_executor_owner(p_tenant_id, p_actor_staff_id);
  RETURN coalesce((
    SELECT jsonb_object_agg(upper(btrim(ci.code)), cv.id::text)
      FROM public.catalog_items ci
      JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id
     WHERE ci.tenant_id = a.tenant_id
       AND ci.kind = 'service'
       AND cv.state = 'active'
  ), '{}'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_active_catalog_services(uuid,uuid) FROM PUBLIC, clinic_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_active_catalog_services(uuid,uuid) TO clinic_executor;--> statement-breakpoint

-- 2. Owner approval bound strictly to (batch_id, validation_revision, server-derived validated_manifest_sha256) + ARCH-10 gate.
CREATE FUNCTION public.import_approve(p_batch_id uuid, p_revision integer, p_manifest_sha256 text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_b public.import_batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public._import_owner_actor();
  PERFORM public.real_patient_gate_assert(a.tenant_id);
  SELECT * INTO v_b FROM public.import_batches WHERE tenant_id = a.tenant_id AND id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: import batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.state <> 'validated' OR v_b.payload_purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: batch not in validated state' USING ERRCODE = '55000';
  END IF;
  IF v_b.validation_revision <> p_revision OR v_b.validated_manifest_sha256 IS DISTINCT FROM p_manifest_sha256 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: manifest revision mismatch' USING ERRCODE = '55000';
  END IF;

  UPDATE public.import_batches
     SET state = 'approved',
         approved_by = a.staff_id,
         approved_at = clock_timestamp(),
         approved_revision = p_revision,
         approved_manifest_sha256 = p_manifest_sha256
   WHERE tenant_id = a.tenant_id AND id = p_batch_id;

  PERFORM public.audit_append('settings_change', 'import_batch', p_batch_id, 'success', 'import_batch_approved');
  RETURN jsonb_build_object('batchId', p_batch_id, 'state', 'approved');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_approve(uuid,integer,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_approve(uuid,integer,text) TO clinic_app;--> statement-breakpoint

-- 2b. Trusted executor-only reader returning AEAD ciphertext rows strictly for an approved, unpurged batch (r3 P1 #1).
CREATE FUNCTION public.import_staged_rows_for_apply(p_tenant_id uuid, p_actor_staff_id uuid, p_batch_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_b public.import_batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public._import_executor_owner(p_tenant_id, p_actor_staff_id);
  PERFORM public.real_patient_gate_assert(a.tenant_id);
  SELECT * INTO v_b FROM public.import_batches WHERE tenant_id = a.tenant_id AND id = p_batch_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: import batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.state <> 'approved' OR v_b.payload_purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: batch must be approved and unpurged' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'batchId', v_b.id,
    'sourceSystem', v_b.source_system,
    'cutoverDate', to_char(v_b.cutover_date, 'YYYY-MM-DD'),
    'approvedRevision', v_b.approved_revision,
    'approvedManifestSha256', v_b.approved_manifest_sha256,
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'entity', r.entity,
        'rowNo', r.row_no,
        'sourceKeyHash', r.source_key_hash,
        'canonicalPayloadSha256', r.canonical_payload_sha256,
        'applyDigest', r.apply_digest,
        'branchId', r.branch_id,
        'amountIdr', r.amount_idr::text,
        'payloadEnc', r.payload_enc,
        'dekVersion', r.dek_version
      ) ORDER BY CASE r.entity WHEN 'patients' THEN 0 WHEN 'balances' THEN 1 WHEN 'packages' THEN 2 WHEN 'booking_dps' THEN 3 ELSE 4 END, r.row_no)
      FROM public.import_rows r
      WHERE r.tenant_id = a.tenant_id AND r.batch_id = p_batch_id
    ), '[]'::jsonb)
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_staged_rows_for_apply(uuid,uuid,uuid) FROM PUBLIC, clinic_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_staged_rows_for_apply(uuid,uuid,uuid) TO clinic_executor;--> statement-breakpoint

-- 3. Executor-only retention purge worker: explicitly revoked from PUBLIC and clinic_app; granted strictly to clinic_executor (r2 #3).
CREATE FUNCTION public.import_purge_expired(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_purged integer := 0;
  v_row record;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> ''
     OR coalesce(current_setting('app.staff_id', true), '') <> '' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: purge must run unbound' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT tenant_id, id
      FROM public.import_batches
     WHERE payload_purged_at IS NULL
       AND purge_after <= v_now
       AND state <> 'applying'
     ORDER BY purge_after ASC
     LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.import_rows
       SET payload_enc = NULL
     WHERE tenant_id = v_row.tenant_id AND batch_id = v_row.id AND payload_enc IS NOT NULL;
    UPDATE public.import_batches
       SET payload_purged_at = v_now
     WHERE tenant_id = v_row.tenant_id AND id = v_row.id;
    v_purged := v_purged + 1;
  END LOOP;

  RETURN jsonb_build_object('purgedBatches', v_purged);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_purge_expired(integer) FROM PUBLIC, clinic_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_purge_expired(integer) TO clinic_executor;--> statement-breakpoint

-- 4. Owner-only sanitized batch summary reader (counts + cutover + manifest only; zero PII/filenames).
CREATE FUNCTION public.import_batches_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public._import_owner_actor();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'batchId', b.id,
      'sourceSystem', b.source_system,
      'cutoverDate', to_char(b.cutover_date, 'YYYY-MM-DD'),
      'state', b.state,
      'rowCount', b.row_count,
      'validationRevision', b.validation_revision,
      'validatedManifestSha256', b.validated_manifest_sha256,
      'summary', b.summary_json,
      'stagedAt', b.staged_at,
      'approvedAt', b.approved_at,
      'appliedAt', b.applied_at,
      'rolledBackAt', b.rolled_back_at,
      'purgeAfter', b.purge_after,
      'payloadPurgedAt', b.payload_purged_at
    ) ORDER BY b.staged_at DESC)
    FROM public.import_batches b
    WHERE b.tenant_id = a.tenant_id
  ), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_batches_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_batches_list() TO clinic_app;--> statement-breakpoint

-- 5. Option 2A: Bump ledger_map_version() and compliance_config_versions(kind='posting_map')
CREATE OR REPLACE FUNCTION public.ledger_map_version() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT 'draft-11-2026-11-26-t128'::text $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_map_version() FROM PUBLIC;--> statement-breakpoint

INSERT INTO public.compliance_config_versions (tenant_id, kind, version)
SELECT t.id, 'posting_map', public.ledger_map_version() FROM public.tenants t
ON CONFLICT (tenant_id, kind) DO UPDATE SET version = EXCLUDED.version;--> statement-breakpoint

-- 6. Ledger rules for immutable import_opening_facts
CREATE FUNCTION public.ledger_rule_opening_import(p_tenant uuid, p_fact_id uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_f public.import_opening_facts%ROWTYPE;
  v_account text;
BEGIN
  SELECT * INTO v_f FROM public.import_opening_facts
   WHERE tenant_id = p_tenant AND id = p_fact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: import_opening_fact' USING ERRCODE = 'P0002';
  END IF;

  v_account := CASE v_f.fact_kind
    WHEN 'balance' THEN 'liability_patient_balance'
    WHEN 'package' THEN 'liability_packages'
    WHEN 'booking_dp' THEN 'liability_booking_dp'
    WHEN 'receivable' THEN 'patient_receivable'
    ELSE NULL
  END;
  IF v_account IS NULL OR v_f.amount_idr <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid opening fact' USING ERRCODE = '22023';
  END IF;

  RETURN public.ledger_post(
    p_tenant,
    'auto',
    'opening_import:apply:' || v_f.id::text,
    'OpeningImportApplied',
    'import_opening_fact',
    v_f.id,
    p_event,
    v_f.effective_date,
    CASE WHEN v_account = 'patient_receivable'
      THEN jsonb_build_array(
        public.jl('patient_receivable', v_f.branch_id, v_f.amount_idr, 0),
        public.jl('opening_balance_equity', v_f.branch_id, 0, v_f.amount_idr)
      )
      ELSE jsonb_build_array(
        public.jl('opening_balance_equity', v_f.branch_id, v_f.amount_idr, 0),
        public.jl(v_account, v_f.branch_id, 0, v_f.amount_idr)
      )
    END,
    NULL, NULL, NULL
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_rule_opening_import(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.ledger_rule_opening_import_reversed(p_tenant uuid, p_fact_id uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_f public.import_opening_facts%ROWTYPE;
  v_account text;
  v_orig uuid;
  v_apply_event uuid;
BEGIN
  SELECT * INTO v_f FROM public.import_opening_facts
   WHERE tenant_id = p_tenant AND id = p_fact_id AND reversed_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: reversed import_opening_fact' USING ERRCODE = 'P0002';
  END IF;

  v_account := CASE v_f.fact_kind
    WHEN 'balance' THEN 'liability_patient_balance'
    WHEN 'package' THEN 'liability_packages'
    WHEN 'booking_dp' THEN 'liability_booking_dp'
    WHEN 'receivable' THEN 'patient_receivable'
    ELSE NULL
  END;
  IF v_account IS NULL OR v_f.amount_idr <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid reversed opening fact' USING ERRCODE = '22023';
  END IF;

  SELECT e.id INTO v_orig FROM public.journal_entries e
   WHERE e.tenant_id = p_tenant AND e.posting_key = 'opening_import:apply:' || v_f.id::text;
  IF v_orig IS NULL THEN
    SELECT d.id INTO v_apply_event FROM public.domain_events d
     WHERE d.tenant_id = p_tenant AND d.type = 'OpeningImportApplied' AND d.aggregate_id = v_f.id
     ORDER BY d.occurred_at ASC LIMIT 1;
    IF v_apply_event IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: original OpeningImportApplied event missing' USING ERRCODE = 'P0002';
    END IF;
    v_orig := public.ledger_rule_opening_import(p_tenant, v_f.id, v_apply_event);
  END IF;

  RETURN public.ledger_post(
    p_tenant,
    'auto',
    'opening_import:reverse:' || v_f.id::text,
    'OpeningImportReversed',
    'import_opening_fact',
    v_f.id,
    p_event,
    v_f.effective_date,
    CASE WHEN v_account = 'patient_receivable'
      THEN jsonb_build_array(
        public.jl('opening_balance_equity', v_f.branch_id, v_f.amount_idr, 0),
        public.jl('patient_receivable', v_f.branch_id, 0, v_f.amount_idr)
      )
      ELSE jsonb_build_array(
        public.jl(v_account, v_f.branch_id, v_f.amount_idr, 0),
        public.jl('opening_balance_equity', v_f.branch_id, 0, v_f.amount_idr)
      )
    END,
    NULL, NULL, v_orig
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_rule_opening_import_reversed(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.ledger_post_event(p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.domain_events;
  p jsonb;
BEGIN
  SELECT * INTO e FROM public.domain_events x WHERE x.id = p_event;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: event' USING ERRCODE = 'P0002';
  END IF;
  -- a bound caller (the consumer binds the event's tenant) may only post its own tenant's events
  IF public.app_tenant_id() IS DISTINCT FROM e.tenant_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: event of another tenant' USING ERRCODE = '42501';
  END IF;
  p := e.payload;
  RETURN CASE e.type
    WHEN 'PaymentAllocated' THEN public.ledger_rule_payment_allocated(e.tenant_id, (p ->> 'allocation_id')::uuid, e.id)
    WHEN 'TreatmentFinished' THEN public.ledger_rule_treatment_finished(e.tenant_id, (p ->> 'execution_id')::uuid, e.id)
    WHEN 'SessionRedeemed' THEN public.ledger_rule_session_redeemed(e.tenant_id, (p ->> 'session_id')::uuid, e.id)
    WHEN 'ConsultationFeeCharged' THEN public.ledger_rule_consultation_charged(e.tenant_id, (p ->> 'invoice_line_id')::uuid, e.id)
    WHEN 'ProductHandedOver' THEN public.ledger_rule_product_handed(e.tenant_id, (p ->> 'dispensing_id')::uuid, e.id)
    WHEN 'BalanceToppedUp' THEN public.ledger_rule_balance_topped_up(e.tenant_id, (p ->> 'entry_id')::uuid, e.id)
    WHEN 'BalanceMoved' THEN public.ledger_rule_balance_moved(e.tenant_id, (p ->> 'entry_id')::uuid, e.id)
    WHEN 'ReceivableCreated' THEN public.ledger_rule_receivable_created(e.tenant_id, (p ->> 'receivable_id')::uuid, e.id)
    WHEN 'ReceivableCollected' THEN public.ledger_rule_receivable_collected(e.tenant_id, (p ->> 'payment_id')::uuid, e.id)
    WHEN 'ReceivableWrittenOff' THEN public.ledger_rule_receivable_written_off(e.tenant_id, (p ->> 'write_off_id')::uuid, e.id)
    WHEN 'BookingDepositReceived' THEN public.ledger_rule_deposit(e.tenant_id, (p ->> 'deposit_id')::uuid, 'received', e.id)
    WHEN 'BookingDepositApplied' THEN public.ledger_rule_deposit(e.tenant_id, (p ->> 'deposit_id')::uuid, 'applied', e.id)
    WHEN 'BookingDepositForfeited' THEN public.ledger_rule_deposit(e.tenant_id, (p ->> 'deposit_id')::uuid, 'forfeited', e.id)
    WHEN 'BookingDepositRefunded' THEN public.ledger_rule_deposit(e.tenant_id, (p ->> 'deposit_id')::uuid, 'refunded', e.id)
    WHEN 'RefundPaid' THEN public.ledger_rule_refund_paid(e.tenant_id, (p ->> 'refund_id')::uuid, e.id)
    WHEN 'ProductReturned' THEN public.ledger_rule_product_returned(e.tenant_id, (p ->> 'refund_id')::uuid, e.id)
    WHEN 'StockConsumed' THEN public.ledger_rule_stock(e.tenant_id, 'material_consumption', (p ->> 'consumption_id')::uuid, 'consume', e.id)
    WHEN 'StockWasted' THEN coalesce(public.ledger_rule_stock(e.tenant_id, 'material_waste', (p ->> 'waste_id')::uuid, 'waste', e.id),
                                     public.ledger_rule_stock(e.tenant_id, 'material_return', (p ->> 'return_id')::uuid, 'waste', e.id))
    WHEN 'CommissionAccrued' THEN public.ledger_rule_commission(e.tenant_id, 'accrued', (p ->> 'entitlement_id')::uuid, e.id)
    WHEN 'CommissionAdjusted' THEN public.ledger_rule_commission(e.tenant_id, 'adjusted', (p ->> 'adjustment_id')::uuid, e.id)
    WHEN 'CommissionPaid' THEN public.ledger_rule_commission(e.tenant_id, 'paid', (p ->> 'batch_id')::uuid, e.id)
    WHEN 'StockTransferred' THEN public.ledger_rule_stock_transferred(e.tenant_id, (p ->> 'transfer_id')::uuid, p ->> 'state', e.id)
    WHEN 'GoodsReceived' THEN public.ledger_rule_goods_received(e.tenant_id, (p ->> 'receipt_id')::uuid, e.id)
    WHEN 'SupplierInvoiceRecorded' THEN public.ledger_rule_supplier_invoice(e.tenant_id, (p ->> 'invoice_id')::uuid, e.id)
    WHEN 'ExpenseRecorded' THEN public.ledger_rule_expense(e.tenant_id, (p ->> 'expense_id')::uuid, false, e.id)
    WHEN 'ExpenseReversed' THEN public.ledger_rule_expense(e.tenant_id, (p ->> 'expense_id')::uuid, true, e.id)
    WHEN 'SupplierPaymentAllocated' THEN public.ledger_rule_supplier_payment(e.tenant_id, (p ->> 'payment_id')::uuid, (p ->> 'invoice_id')::uuid, false, e.id)
    WHEN 'SupplierPaymentReversed' THEN public.ledger_rule_supplier_payment(e.tenant_id, (p ->> 'payment_id')::uuid, NULL, true, e.id)
    WHEN 'SupplierReturned' THEN public.ledger_rule_supplier_returned(e.tenant_id, (p ->> 'return_id')::uuid, e.id)
    WHEN 'SupplierCreditApplied' THEN public.ledger_rule_supplier_credit(e.tenant_id, (p ->> 'credit_note_id')::uuid, (p ->> 'invoice_id')::uuid, e.id)
    WHEN 'InvoiceVoided' THEN public.ledger_rule_reversal(e.tenant_id, 'InvoiceVoided', (p ->> 'invoice_id')::uuid, e.id)
    WHEN 'SupplierInvoiceReversed' THEN public.ledger_rule_reversal(e.tenant_id, 'SupplierInvoiceReversed', (p ->> 'invoice_id')::uuid, e.id)
    WHEN 'SupplierCreditReversed' THEN public.ledger_rule_reversal(e.tenant_id, 'SupplierCreditReversed', (p ->> 'credit_note_id')::uuid, e.id)
    WHEN 'InvoiceIssued' THEN public.ledger_wake_visit(e.tenant_id,
      (SELECT i.visit_id FROM public.invoices i WHERE i.tenant_id = e.tenant_id AND i.id = (p ->> 'invoice_id')::uuid))
    WHEN 'ApprovalDecided' THEN CASE WHEN p ->> 'approval_type' = 'manual_discount' AND p ->> 'subject_kind' = 'invoice_line' THEN
      public.ledger_wake_visit(e.tenant_id, (SELECT i.visit_id FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                                              WHERE l.tenant_id = e.tenant_id AND l.id = (p ->> 'subject_id')::uuid)) END
    WHEN 'OpeningImportApplied' THEN public.ledger_rule_opening_import(e.tenant_id, (p ->> 'fact_id')::uuid, e.id)
    WHEN 'OpeningImportReversed' THEN public.ledger_rule_opening_import_reversed(e.tenant_id, (p ->> 'fact_id')::uuid, e.id)
    ELSE NULL END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_post_event(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_post_event(uuid) TO clinic_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.ledger_period_lock(p_key text, p_period text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['finance']);
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger_period:' || a.tenant_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.domain_events de
      LEFT JOIN public.event_receipts er
        ON er.tenant_id = de.tenant_id AND er.event_id = de.id AND er.consumer = 'ledger.posting'
     WHERE de.tenant_id = a.tenant_id
       AND de.type IN ('OpeningImportApplied', 'OpeningImportReversed')
       AND (er.id IS NULL OR er.done_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'ERR_POSTING_INCOMPLETE: pending opening import postings' USING ERRCODE = '55000';
  END IF;
  IF p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' OR coalesce(p_period, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO v_id FROM public.ledger_periods x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF p_period >= to_char(public.tax_local_date(a.tenant_id, clock_timestamp(), NULL), 'YYYY-MM') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: period_open' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_periods x WHERE x.tenant_id = a.tenant_id AND x.period = p_period) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: period_locked' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ledger_periods (tenant_id, period, locked_by, command_key) VALUES (a.tenant_id, p_period, a.staff_id, p_key) RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'ledger_period', v_id, 'success', 'period_locked');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_period_lock(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_period_lock(text, text) TO clinic_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.ledger_journal_export(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['finance']);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger_period:' || a.tenant_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.domain_events de
      LEFT JOIN public.event_receipts er
        ON er.tenant_id = de.tenant_id AND er.event_id = de.id AND er.consumer = 'ledger.posting'
     WHERE de.tenant_id = a.tenant_id
       AND de.type IN ('OpeningImportApplied', 'OpeningImportReversed')
       AND (er.id IS NULL OR er.done_at IS NULL)
  ) THEN
    PERFORM public.audit_append('export', 'journal', NULL, 'denied', 'posting_incomplete');
    RETURN jsonb_build_object('refused', 'posting_incomplete');
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  -- a refusal RETURNS its reason (no raise) so the denied audit row commits with it
  PERFORM public.feature_gate_lock('journal_export');
  IF NOT public.feature_gate_open('journal_export') THEN
    PERFORM public.audit_append('export', 'journal', NULL, 'denied', 'posting_map_unsigned');
    RETURN jsonb_build_object('refused', 'posting_map_unsigned');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_activations x WHERE x.tenant_id = a.tenant_id AND x.map_version = public.ledger_map_version()) THEN
    PERFORM public.audit_append('export', 'journal', NULL, 'denied', 'ledger_not_activated');
    RETURN jsonb_build_object('refused', 'ledger_not_activated');
  END IF;
  PERFORM public.audit_append('export', 'journal', NULL, 'success', 'journal_exported');
  RETURN jsonb_build_object('rows', coalesce((SELECT jsonb_agg(jsonb_build_object('date', e.business_date, 'branch', b.code, 'account', c.key, 'debit', l.debit, 'credit', l.credit, 'reference', e.posting_key)
                                    ORDER BY e.business_date, e.id, l.id)
                     FROM public.journal_entries e JOIN public.journal_lines l ON l.tenant_id = e.tenant_id AND l.entry_id = e.id
                     JOIN public.ledger_accounts c ON c.tenant_id = l.tenant_id AND c.id = l.account_id
                     LEFT JOIN public.branches b ON b.tenant_id = l.tenant_id AND b.id = l.branch_id
                    WHERE e.tenant_id = a.tenant_id AND e.business_date BETWEEN p_from AND p_to
                      AND (e.kind <> 'auto' OR e.map_version IN (public.ledger_map_version(), 'draft-11-2026-11-19'))), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_journal_export(date, date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_journal_export(date, date) TO clinic_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.subledger_movements(p_tenant uuid)
RETURNS TABLE (ledger text, term text, day date, at timestamptz, branch_id uuid, dim text, amount bigint, source_kind text, source_id uuid,
               object_kind text, object_id uuid, incomplete boolean)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
WITH
cut AS (SELECT coalesce((SELECT c.cutover_at FROM public.vat_cutovers c WHERE c.tenant_id = p_tenant), '-infinity'::timestamptz) AS at),
-- Include opening packages (invoice_id IS NULL, is_pkp_at_issue = false) so redemption/substitution/close
-- lifecycle movements reduce package_liability without synthesizing an invoice settlement (r3 P1 #4).
pkl AS (SELECT pk.*, coalesce(i.is_pkp_at_issue, false) AS is_pkp_at_issue FROM public.packages pk LEFT JOIN public.invoices i ON i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id WHERE pk.tenant_id = p_tenant),
-- an invoice line's owner: the package of its own line, the package of its substitution (difference line), or none (ordinary)
own AS (
  SELECT l.id AS line_id, l.branch_id, l.line_total, l.vat_amount, l.quantity, l.item_id, l.plan_item_id, l.substitution_id, l.invoice_id,
         coalesce(p1.id, p2.id) AS package_id, p1.id IS NOT NULL AS package_line, u.session_id AS diff_session, l.created_at
    FROM public.invoice_lines l
    LEFT JOIN pkl p1 ON p1.invoice_line_id = l.id
    LEFT JOIN public.package_substitutions u ON u.tenant_id = l.tenant_id AND u.id = l.substitution_id
    LEFT JOIN pkl p2 ON p2.id = u.package_id
   WHERE l.tenant_id = p_tenant),
alloc AS (SELECT a.* FROM public.payment_allocations a WHERE a.tenant_id = p_tenant AND NOT a.is_simulated),
-- seam events from the tenant's cutover on (an event inside the cutover transaction itself is in that object's residue)
ev AS (SELECT e.* FROM public.vat_events e WHERE e.tenant_id = p_tenant AND e.effective_at >= (SELECT at FROM cut)),
res AS (SELECT o.object_kind, o.object_id FROM public.vat_cutover_openings o WHERE o.tenant_id = p_tenant),
-- a pre-cutover interrupted move (S3 unrecorded) reconstructed only where provable FROM THE PRE-CUTOVER SNAPSHOT (Sol r2 #1: never from later
-- facts, so a later interruption or deposit decision cannot change it): the only interruption of that line before the cutover, the line
-- carrying no deposit applied before the cutover, by the writer's formula over the dated recognition (vat_portion) and reversals (paid
-- refunds) up to it (Sol r1 P1-3); otherwise its VAT stays in the line's residue. A move from the cutover on is S3 (never reconstructed).
intr AS (
  SELECT b.id AS entry_id, b.source_id AS execution_id, b.created_at, b.branch_id, b.amount, x.line_id, x.line_total,
         CASE WHEN b.created_at >= (SELECT at FROM cut) OR x.line_id IS NULL OR x.line_total = 0 OR x.n_moves <> 1 OR x.dp THEN NULL
              ELSE least(x.rec - x.rev, (x.rec * b.amount) / x.line_total) END AS vat_rev
    FROM public.balance_entries b
    LEFT JOIN LATERAL (
      SELECT o.line_id, o.line_total,
             coalesce((SELECT sum(a.vat_portion) FROM alloc a WHERE a.invoice_line_id = o.line_id AND a.created_at <= b.created_at), 0) AS rec,
             coalesce((SELECT sum(r.vat_reversed) FROM public.refunds r WHERE r.tenant_id = p_tenant AND r.invoice_line_id = o.line_id AND r.state = 'paid' AND r.paid_at <= b.created_at), 0) AS rev,
             -- interruptions moved from THIS line before the cutover (the same line resolution for each execution)
             (SELECT count(*) FROM public.balance_entries b2 JOIN public.treatment_executions e2 ON e2.tenant_id = b2.tenant_id AND e2.id = b2.source_id
                JOIN public.plan_items t2 ON t2.tenant_id = e2.tenant_id AND t2.id = e2.plan_item_id
               WHERE b2.tenant_id = p_tenant AND b2.kind = 'from_interrupted_treatment' AND b2.created_at < (SELECT at FROM cut)
                 AND EXISTS (SELECT 1 FROM public.invoices i2 WHERE i2.tenant_id = p_tenant AND i2.id = o.invoice_id AND i2.visit_id = e2.visit_id)
                 AND (o.plan_item_id = e2.plan_item_id OR o.plan_item_id IS NULL AND o.item_id = public.package_plan_service(e2.tenant_id, e2.plan_item_id))) AS n_moves,
             EXISTS (SELECT 1 FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.applied_line_id = o.line_id AND d.state = 'applied'
                       AND d.decided_at < (SELECT at FROM cut)) AS dp
        FROM public.treatment_executions e JOIN public.invoices i ON i.tenant_id = p_tenant AND i.visit_id = e.visit_id AND i.state = 'issued'
        JOIN own o ON o.invoice_id = i.id AND o.package_id IS NULL AND o.substitution_id IS NULL
       WHERE e.tenant_id = p_tenant AND e.id = b.source_id
         AND (o.plan_item_id = e.plan_item_id OR o.plan_item_id IS NULL AND o.item_id = public.package_plan_service(e.tenant_id, e.plan_item_id))
       ORDER BY (o.plan_item_id IS NOT NULL) DESC, o.created_at, o.line_id LIMIT 1) x ON true
   WHERE b.tenant_id = p_tenant AND b.kind = 'from_interrupted_treatment'),
-- VAT movements of every canonical object (the VAT ledger and the liabilities' VAT components)
vatm AS (
  SELECT CASE WHEN a.booking_deposit_id IS NOT NULL THEN 'dp_vat' ELSE 'payment_vat' END AS term, a.created_at AS at, a.branch_id, a.vat_portion AS amount,
         'payment_allocation'::text AS sk, a.id AS sid,
         CASE WHEN a.booking_deposit_id IS NOT NULL THEN 'deposit' WHEN o.package_line THEN 'package' ELSE 'line' END AS ok,
         coalesce(a.booking_deposit_id, CASE WHEN o.package_line THEN o.package_id ELSE o.line_id END) AS oid, NULL::uuid AS src
    FROM alloc a LEFT JOIN own o ON o.line_id = a.invoice_line_id WHERE a.vat_portion > 0
  UNION ALL
  SELECT 'dp_reversal', d.decided_at, d.branch_id, -d.vat_amount, 'booking_deposit', d.id, 'deposit', d.id, NULL
    FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state IN ('moved_to_balance','refunded') AND d.vat_amount > 0
  UNION ALL
  SELECT CASE WHEN r.delivered THEN 'refund_reversal_delivered' ELSE 'refund_reversal' END, r.paid_at, r.branch_id, -r.vat_reversed, 'refund', r.id, 'line', r.invoice_line_id, NULL
    FROM public.refunds r WHERE r.tenant_id = p_tenant AND r.state = 'paid' AND r.vat_reversed > 0
  UNION ALL
  SELECT 'interrupted', x.created_at, x.branch_id, -x.vat_rev, 'balance_entry', x.entry_id, 'line', x.line_id, NULL
    FROM intr x WHERE x.created_at < (SELECT at FROM cut) AND x.vat_rev > 0
  UNION ALL
  SELECT e.cause, e.effective_at, e.branch_id, e.delta, 'vat_event', e.id, e.object_kind, e.object_id, e.source_id FROM ev e
  UNION ALL
  SELECT 'cutover_residue', o.cutover_at, o.branch_id, o.amount, 'vat_cutover_opening', o.id, o.object_kind, o.object_id, NULL
    FROM public.vat_cutover_openings o WHERE o.tenant_id = p_tenant),
-- which liability a VAT object's movement belongs to: an ordinary line → paid-not-delivered; the package object and a difference line of a
-- package → package liability; a session's VAT is delivered VAT (out of any liability); a deposit is carried net already (vat_base)
vobj AS (
  SELECT v.*, CASE WHEN v.ok IN ('deposit','session') OR v.term = 'refund_reversal_delivered' THEN NULL
                   WHEN v.ok = 'package' THEN 'package_liability'
                   WHEN (SELECT o.package_id FROM own o WHERE o.line_id = v.oid) IS NOT NULL THEN 'package_liability'
                   ELSE 'paid_not_delivered' END AS liab,
         CASE WHEN v.ok = 'package' THEN v.oid WHEN v.ok = 'session' THEN (SELECT s.package_id FROM public.package_sessions s WHERE s.tenant_id = p_tenant AND s.id = v.oid)
              WHEN v.ok = 'line' THEN (SELECT o.package_id FROM own o WHERE o.line_id = v.oid) END AS pkg,
         v.at < (SELECT at FROM cut) AND v.sk <> 'vat_cutover_opening' AND EXISTS (SELECT 1 FROM res r WHERE r.object_kind = v.ok AND r.object_id = v.oid) AS inc
    FROM vatm v),
-- patient balance: FIFO consumption of credits by debits per account (owner D-B2): overlap of cumulative intervals over seq.
-- opening_reversal matches its original opening credit's branch directly outside ordinary FIFO, and reversed opening credits
-- are excluded from the ordinary FIFO credit pool so later debits never consume them (r3 P1 #3).
be_all_cr AS (SELECT b.* FROM public.balance_entries b WHERE b.tenant_id = p_tenant AND b.amount > 0),
be AS (SELECT b.*, sum(abs(b.amount)) FILTER (WHERE b.amount > 0) OVER w AS c_hi, sum(abs(b.amount)) FILTER (WHERE b.amount < 0) OVER w AS d_hi
         FROM public.balance_entries b
        WHERE b.tenant_id = p_tenant
          AND b.kind <> 'opening_reversal'
          AND NOT (
            b.kind = 'opening_balance'
            AND EXISTS (
              SELECT 1 FROM public.balance_entries rev
               WHERE rev.tenant_id = b.tenant_id
                 AND rev.account_id = b.account_id
                 AND rev.kind = 'opening_reversal'
                 AND rev.source_kind = 'import_opening_fact'
                 AND rev.source_id = b.source_id
            )
          )
       WINDOW w AS (PARTITION BY b.account_id ORDER BY b.seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)),
cr AS (SELECT be.*, be.c_hi - be.amount AS c_lo FROM be WHERE be.amount > 0),
db AS (SELECT be.*, be.d_hi + be.amount AS d_lo FROM be WHERE be.amount < 0),
fifo AS (SELECT db.id AS debit_id, db.kind, db.created_at, cr.branch_id AS origin_branch, cr.id AS credit_id, db.account_id,
                least(cr.c_hi, db.d_hi) - greatest(cr.c_lo, db.d_lo) AS amt
           FROM db JOIN cr ON cr.account_id = db.account_id AND cr.c_lo < db.d_hi AND db.d_lo < cr.c_hi),
-- package liability, money (its VAT component comes from vobj: the package object — payment VAT, S1b/S5b attribution to a delivered session,
-- S4/S5 reversals, residue — and difference lines): settlements of the own line and difference lines (gross); a redemption takes the
-- session's allocated value (a PKP-at-issue package's session VAT leaves through the attribution; a non-PKP-at-issue session's VAT is first
-- due at delivery, S1, inside that value) plus the dearer difference line's remaining net of its VAT position; a cheaper substitution moves
-- its gross difference to balance (its VAT reversal is S5, now or later); a difference line refunded (undelivered); the close moves the gross
pkg_gross AS (
  SELECT o.package_id, 'settlement'::text AS term, a.created_at AS at, a.amount AS amount, 'payment_allocation'::text AS sk, a.id AS sid
    FROM alloc a JOIN own o ON o.line_id = a.invoice_line_id WHERE o.package_id IS NOT NULL
  UNION ALL
  SELECT s.package_id, 'redemption', s.redeemed_at,
         -(s.allocated_value
           + coalesce((SELECT sum(a.amount) FROM alloc a JOIN own o ON o.line_id = a.invoice_line_id WHERE o.diff_session = s.id AND a.created_at <= s.redeemed_at), 0)
           - coalesce((SELECT sum(r.amount) FROM public.refunds r JOIN own o ON o.line_id = r.invoice_line_id
                        WHERE r.tenant_id = p_tenant AND o.diff_session = s.id AND r.state = 'paid' AND r.paid_at <= s.redeemed_at), 0)
           -- the difference line's VAT position leaves with the delivery (its VAT movements stay subtracted in the VAT component)
           - coalesce((SELECT sum(v.amount) FROM vobj v JOIN own o ON o.line_id = v.oid WHERE v.ok = 'line' AND o.diff_session = s.id AND v.at <= s.redeemed_at), 0)),
         'package_session', s.id
    FROM public.package_sessions s JOIN pkl p ON p.id = s.package_id WHERE s.tenant_id = p_tenant AND s.state = 'redeemed'
  UNION ALL
  SELECT u.package_id, 'substitution', u.decided_at, u.difference, 'package_substitution', u.id
    FROM public.package_substitutions u JOIN pkl p ON p.id = u.package_id WHERE u.tenant_id = p_tenant AND u.state = 'approved' AND u.difference < 0
  UNION ALL
  SELECT o.package_id, 'refund', r.paid_at, -r.amount, 'refund', r.id
    FROM public.refunds r JOIN own o ON o.line_id = r.invoice_line_id
   WHERE r.tenant_id = p_tenant AND r.state = 'paid' AND NOT r.delivered AND o.package_id IS NOT NULL
  UNION ALL
  SELECT p.id, 'close', p.closed_at,
         -coalesce((SELECT sum(b.amount) FROM public.balance_entries b WHERE b.tenant_id = p_tenant AND b.source_kind = 'package' AND b.source_id = p.id
                     AND b.kind IN ('from_expiry','from_cancel')), 0),
         'package', p.id
    FROM pkl p WHERE p.closed_at IS NOT NULL),
-- the delivered ordinary line of a counted single treatment (the commission performer's line rule, 0102)
exe AS (
  SELECT e.id, e.branch_id, e.finished_at, t.qty, l.line_id, l.line_total, l.vat_amount, l.quantity
    FROM public.treatment_executions e JOIN public.plan_items t ON t.tenant_id = e.tenant_id AND t.id = e.plan_item_id
    CROSS JOIN LATERAL (
      SELECT o.* FROM own o JOIN public.invoices i ON i.tenant_id = p_tenant AND i.id = o.invoice_id
       WHERE i.visit_id = e.visit_id AND i.state = 'issued' AND o.substitution_id IS NULL AND o.package_id IS NULL AND NOT i.consultation
         AND (o.plan_item_id = e.plan_item_id OR o.plan_item_id IS NULL AND o.item_id = public.package_plan_service(e.tenant_id, e.plan_item_id)
                                                 AND NOT public.addition_of_visit(e.tenant_id, e.visit_id, e.plan_item_id))
       ORDER BY (o.plan_item_id IS NOT NULL) DESC, o.created_at, o.line_id LIMIT 1) l
   WHERE e.tenant_id = p_tenant AND e.state = 'finished' AND e.counted AND NOT public.package_execution_covered(e.tenant_id, e.id)),
-- a handed product: its counter line, or the visit's line of that catalog item
disp AS (
  SELECT d.id, d.branch_id, d.handed_at, d.quantity, l.line_id, l.line_total, l.vat_amount, l.quantity AS line_qty
    FROM public.dispensings d
    LEFT JOIN public.stock_items si ON si.tenant_id = d.tenant_id AND si.id = d.stock_item_id
    CROSS JOIN LATERAL (
      SELECT o.* FROM own o LEFT JOIN public.invoices i ON i.tenant_id = p_tenant AND i.id = o.invoice_id
       WHERE o.line_id = d.invoice_line_id
          OR d.invoice_line_id IS NULL AND i.visit_id = d.visit_id AND i.state = 'issued' AND o.item_id = si.catalog_item_id
             AND o.plan_item_id IS NULL AND o.substitution_id IS NULL AND o.package_id IS NULL
       ORDER BY (o.line_id = d.invoice_line_id) DESC, o.created_at, o.line_id LIMIT 1) l
   WHERE d.tenant_id = p_tenant AND d.state = 'handed'),
-- every row (ledger, term, day, at, branch_id, dim, amount, source_kind, source_id, object_kind, object_id, incomplete)
m (ledger, term, day, at, branch_id, dim, amount, source_kind, source_id, object_kind, object_id, incomplete) AS (
-- ── cash / bank (dim: cash, petty_cash, bank) and gateway clearing (dim: the method) ──
SELECT CASE WHEN y.method IN ('cash','transfer') THEN 'cash_bank' ELSE 'gateway_clearing' END, 'receipt',
       public.tax_local_date(p_tenant, y.received_at, y.branch_id), y.received_at, y.branch_id,
       CASE y.method WHEN 'cash' THEN 'cash' WHEN 'transfer' THEN 'bank' ELSE y.method END, y.amount, 'payment', y.id, NULL::text, NULL::uuid, false
  FROM public.payments y WHERE y.tenant_id = p_tenant AND NOT y.is_simulated AND y.method <> 'balance'
UNION ALL
SELECT CASE WHEN d.refund_method = 'edc' THEN 'gateway_clearing' ELSE 'cash_bank' END, 'refund_dp', public.tax_local_date(p_tenant, d.decided_at, d.branch_id),
       d.decided_at, d.branch_id, CASE d.refund_method WHEN 'cash' THEN 'cash' WHEN 'transfer' THEN 'bank' ELSE d.refund_method END, -d.amount,
       'booking_deposit', d.id, NULL, NULL, false
  FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state = 'refunded'
UNION ALL
SELECT 'cash_bank', 'refund', public.tax_local_date(p_tenant, r.paid_at, r.branch_id), r.paid_at, r.branch_id,
       CASE r.paid_method WHEN 'cash' THEN 'cash' ELSE 'bank' END, b.amount, 'refund', r.id, NULL, NULL, false
  FROM public.refunds r JOIN public.balance_entries b ON b.tenant_id = r.tenant_id AND b.id = r.cash_entry_id
 WHERE r.tenant_id = p_tenant AND r.state = 'paid'
UNION ALL
SELECT 'cash_bank', 'commission_paid', public.tax_local_date(p_tenant, pb.paid_at, NULL), pb.paid_at, NULL,
       CASE pb.paid_method WHEN 'cash' THEN 'cash' ELSE 'bank' END, -sum(l.net_payable)::bigint, 'payout_batch', pb.id, NULL, NULL, false
  FROM public.payout_batches pb JOIN public.payout_batch_lines l ON l.tenant_id = pb.tenant_id AND l.batch_id = pb.id
 WHERE pb.tenant_id = p_tenant AND pb.state = 'paid' GROUP BY pb.id, pb.paid_at, pb.paid_method HAVING sum(l.net_payable) > 0
UNION ALL
SELECT 'cash_bank', 'expense', x.business_date, x.recorded_at, x.branch_id, CASE x.funding WHEN 'bank' THEN 'bank' ELSE x.funding END, -x.amount, 'expense', x.id, NULL, NULL, false
  FROM public.expenses x WHERE x.tenant_id = p_tenant AND x.funding IN ('petty_cash','cash','bank')
UNION ALL
SELECT 'cash_bank', 'expense_reversed', public.tax_local_date(p_tenant, x.reversed_at, x.branch_id), x.reversed_at, x.branch_id,
       CASE x.funding WHEN 'bank' THEN 'bank' ELSE x.funding END, x.amount, 'expense', x.id, NULL, NULL, false
  FROM public.expenses x WHERE x.tenant_id = p_tenant AND x.funding IN ('petty_cash','cash','bank') AND x.reversed_at IS NOT NULL
UNION ALL
SELECT 'cash_bank', 'supplier_payment', x.paid_on::date, x.recorded_at, x.branch_id, CASE x.method WHEN 'cash' THEN 'cash' ELSE 'bank' END, -x.amount,
       'supplier_payment', x.id, NULL, NULL, false
  FROM public.supplier_payments x WHERE x.tenant_id = p_tenant
UNION ALL
SELECT 'cash_bank', 'supplier_payment_reversed', public.tax_local_date(p_tenant, x.reversed_at, x.branch_id), x.reversed_at, x.branch_id,
       CASE x.method WHEN 'cash' THEN 'cash' ELSE 'bank' END, x.amount, 'supplier_payment', x.id, NULL, NULL, false
  FROM public.supplier_payments x WHERE x.tenant_id = p_tenant AND x.reversed_at IS NOT NULL
-- ── paid-not-delivered (ordinary lines): money in gross, delivery at the contractual net (line total − its VAT, frozen at issue; plan r5
-- §2.1), and the VAT component of the line objects (vobj) ──
UNION ALL
SELECT 'paid_not_delivered', 'settlement', public.tax_local_date(p_tenant, a.created_at, a.branch_id), a.created_at, a.branch_id, NULL, a.amount, 'payment_allocation', a.id, 'line', o.line_id, false
  FROM alloc a JOIN own o ON o.line_id = a.invoice_line_id WHERE o.package_id IS NULL
UNION ALL
SELECT 'paid_not_delivered', 'dp_applied', public.tax_local_date(p_tenant, d.decided_at, d.branch_id), d.decided_at, d.branch_id, NULL, d.amount, 'booking_deposit', d.id, 'line', d.applied_line_id, false
  FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state = 'applied'
UNION ALL
SELECT 'paid_not_delivered', 'receivable_convert', public.tax_local_date(p_tenant, rv.created_at, rv.branch_id), rv.created_at, rv.branch_id, NULL, rl.amount, 'receivable', rv.id, 'line', rl.invoice_line_id, false
  FROM public.receivables rv JOIN public.receivable_lines rl ON rl.tenant_id = rv.tenant_id AND rl.receivable_id = rv.id WHERE rv.tenant_id = p_tenant
UNION ALL
SELECT 'paid_not_delivered', 'performance', public.tax_local_date(p_tenant, x.finished_at, x.branch_id), x.finished_at, x.branch_id, NULL, -(((x.line_total - x.vat_amount) * x.qty) / x.quantity), 'treatment_execution', x.id, 'line', x.line_id, false
  FROM exe x
UNION ALL
SELECT 'paid_not_delivered', 'performance', public.tax_local_date(p_tenant, x.handed_at, x.branch_id), x.handed_at, x.branch_id, NULL, -floor(((x.line_total - x.vat_amount) * x.quantity) / x.line_qty)::bigint, 'dispensing', x.id, 'line', x.line_id, false
  FROM disp x
UNION ALL
SELECT 'paid_not_delivered', 'performance', public.tax_local_date(p_tenant, CASE WHEN f.state = 'recharged' THEN f.recharged_at ELSE f.decided_at END, f.branch_id),
       CASE WHEN f.state = 'recharged' THEN f.recharged_at ELSE f.decided_at END, f.branch_id, NULL, -(o.line_total - o.vat_amount), 'consultation_fee', f.id, 'line', o.line_id, false
  FROM public.consultation_fees f JOIN own o ON o.line_id = f.fee_line_id WHERE f.tenant_id = p_tenant AND f.state IN ('charged','recharged')
UNION ALL
SELECT 'paid_not_delivered', 'refund', public.tax_local_date(p_tenant, r.paid_at, r.branch_id), r.paid_at, r.branch_id, NULL, -r.amount, 'refund', r.id, 'line', r.invoice_line_id, false
  FROM public.refunds r JOIN own o ON o.line_id = r.invoice_line_id
 WHERE r.tenant_id = p_tenant AND r.state = 'paid' AND NOT r.delivered AND o.package_id IS NULL
UNION ALL
SELECT 'paid_not_delivered', 'interrupted', public.tax_local_date(p_tenant, x.created_at, x.branch_id), x.created_at, x.branch_id, NULL, -x.amount, 'balance_entry', x.entry_id, 'line', x.line_id, false
  FROM intr x
-- the VAT component of both net liabilities: every VAT-object movement, with the opposite sign, in its owning liability
UNION ALL
SELECT v.liab, 'vat_' || v.term, public.tax_local_date(p_tenant, v.at, v.branch_id), v.at, v.branch_id, NULL, -v.amount, v.sk, v.sid,
       CASE WHEN v.liab = 'package_liability' THEN 'package' ELSE v.ok END, CASE WHEN v.liab = 'package_liability' THEN v.pkg ELSE v.oid END, v.inc
  FROM vobj v WHERE v.liab IS NOT NULL
-- ── receivables (gross) ──
UNION ALL
SELECT 'receivables', 'created', public.tax_local_date(p_tenant, rv.created_at, rv.branch_id), rv.created_at, rv.branch_id, NULL, rv.amount, 'receivable', rv.id, 'receivable', rv.id, false
  FROM public.receivables rv WHERE rv.tenant_id = p_tenant
UNION ALL
SELECT 'receivables', 'collected', public.tax_local_date(p_tenant, c.received_at, c.branch_id), c.received_at, c.branch_id, NULL, -c.amount, 'receivable_collection', c.id, 'receivable', c.receivable_id, false
  FROM public.receivable_collections c WHERE c.tenant_id = p_tenant
UNION ALL
SELECT 'receivables', 'written_off', public.tax_local_date(p_tenant, w.created_at, w.branch_id), w.created_at, w.branch_id, NULL, -w.amount, 'write_off', w.id, 'receivable', w.receivable_id, false
  FROM public.write_offs w WHERE w.tenant_id = p_tenant
-- ── patient balance (gross): credits at their own branch; ordinary debits FIFO against live credits (D-B2);
-- opening_reversal debits matched directly to their original opening credit branch (r3 P1 #3) ──
UNION ALL
SELECT 'patient_balance', b.kind, public.tax_local_date(p_tenant, b.created_at, b.branch_id), b.created_at, b.branch_id, NULL, b.amount,
       'balance_entry', b.id, 'balance_account', b.account_id, false
  FROM be_all_cr b
UNION ALL
SELECT 'patient_balance', f.kind, public.tax_local_date(p_tenant, f.created_at, f.origin_branch), f.created_at, f.origin_branch, f.credit_id::text, -f.amt,
       'balance_entry', f.debit_id, 'balance_account', f.account_id, false
  FROM fifo f WHERE f.amt > 0
UNION ALL
SELECT 'patient_balance', b.kind, public.tax_local_date(p_tenant, b.created_at, b.branch_id), b.created_at, b.branch_id, NULL, b.amount,
       'balance_entry', b.id, 'balance_account', b.account_id, false
  FROM public.balance_entries b WHERE b.tenant_id = p_tenant AND b.kind = 'opening_reversal'

-- ── package liability (gross money; its VAT component above) and inter-branch clearing ──
UNION ALL
SELECT 'package_liability', x.term, public.tax_local_date(p_tenant, x.at, p.sold_branch_id), x.at, p.sold_branch_id, NULL, x.amount, x.sk, x.sid, 'package', p.id, false
  FROM pkg_gross x JOIN pkl p ON p.id = x.package_id
UNION ALL
-- inter-branch: the liability value a redemption takes moves from the selling branch to the executing branch — its money term at the
-- redemption, and each attribution of package-object VAT to that session (S1b at the redemption, S5b later) at its own time
SELECT 'inter_branch', 'redemption', public.tax_local_date(p_tenant, x.at, b.br), x.at, b.br, NULL, b.sign * x.amount, x.sk, x.sid, 'package', p.id, false
  FROM (SELECT g.sid AS session_id, g.at, -g.amount AS amount, 'package_session'::text AS sk, g.sid FROM pkg_gross g WHERE g.term = 'redemption'
        UNION ALL
        SELECT v.src, v.at, v.amount, v.sk, v.sid FROM vobj v WHERE v.ok = 'package' AND v.term = 'session_attribution') x
  JOIN public.package_sessions s ON s.tenant_id = p_tenant AND s.id = x.session_id JOIN pkl p ON p.id = s.package_id
  CROSS JOIN LATERAL (VALUES (p.sold_branch_id, 1), (s.redeemed_branch_id, -1)) b(br, sign)
 WHERE s.redeemed_branch_id <> p.sold_branch_id
-- ── booking DP (net) ──
UNION ALL
SELECT 'booking_dp', 'received', public.tax_local_date(p_tenant, d.received_at, d.branch_id), d.received_at, d.branch_id, NULL, d.vat_base, 'booking_deposit', d.id, 'deposit', d.id, false
  FROM public.booking_deposits d WHERE d.tenant_id = p_tenant
UNION ALL
SELECT 'booking_dp', CASE d.state WHEN 'moved_to_balance' THEN 'moved' ELSE d.state END, public.tax_local_date(p_tenant, d.decided_at, d.branch_id), d.decided_at,
       d.branch_id, NULL, -d.vat_base, 'booking_deposit', d.id, 'deposit', d.id, false
  FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state <> 'held'
-- ── commission payable (per recipient, dim = staff id) ──
UNION ALL
SELECT 'commission_payable', 'accrued', public.tax_local_date(p_tenant, e.accrued_at, e.branch_id), e.accrued_at, e.branch_id, e.staff_id::text, e.amount,
       'commission_entitlement', e.id, 'staff', e.staff_id, false
  FROM public.commission_entitlements e WHERE e.tenant_id = p_tenant AND e.amount <> 0
UNION ALL
SELECT 'commission_payable', 'adjusted', public.tax_local_date(p_tenant, x.adjusted_at, x.branch_id), x.adjusted_at, x.branch_id, x.staff_id::text, x.amount,
       'commission_adjustment', x.id, 'staff', x.staff_id, false
  FROM public.commission_adjustments x WHERE x.tenant_id = p_tenant
UNION ALL
SELECT 'commission_payable', 'paid', public.tax_local_date(p_tenant, pb.paid_at, NULL), pb.paid_at, NULL, l.staff_id::text, -l.net_payable,
       'payout_batch', pb.id, 'staff', l.staff_id, false
  FROM public.payout_batches pb JOIN public.payout_batch_lines l ON l.tenant_id = pb.tenant_id AND l.batch_id = pb.id
 WHERE pb.tenant_id = p_tenant AND pb.state = 'paid' AND l.net_payable > 0

-- ── VAT payable: the signed position of the canonical objects, plus the finance facts (D-A1) ──
UNION ALL
SELECT 'vat', v.term, public.tax_local_date(p_tenant, v.at, v.branch_id), v.at, v.branch_id, NULL, v.amount, v.sk, v.sid, v.ok, v.oid, v.inc FROM vobj v
UNION ALL
SELECT 'vat', 'input_credited', c.effective_on, c.recorded_at, NULL, c.tax_period, -c.amount, 'vat_input_credit', c.id, NULL, NULL, false
  FROM public.vat_input_credits c WHERE c.tenant_id = p_tenant
UNION ALL
SELECT 'vat', 'paid', p.paid_on, p.recorded_at, NULL, p.tax_period, -p.amount, 'vat_payment', p.id, NULL, NULL, false
  FROM public.vat_payments p WHERE p.tenant_id = p_tenant
-- ── opening-data import adjustments (T-128, PR-85, DATA-58, DEC-133) ──
UNION ALL
SELECT 'package_liability', 'opening_import', f.effective_date, f.created_at, f.branch_id, NULL, f.amount_idr,
       'import_opening_fact', f.id, 'package', f.entity_id, false
  FROM public.import_opening_facts f WHERE f.tenant_id = p_tenant AND f.fact_kind = 'package'
UNION ALL
SELECT 'package_liability', 'opening_import_reversed', f.effective_date, f.reversed_at, f.branch_id, NULL, -f.amount_idr,
       'import_opening_fact', f.id, 'package', f.entity_id, false
  FROM public.import_opening_facts f WHERE f.tenant_id = p_tenant AND f.fact_kind = 'package' AND f.reversed_at IS NOT NULL
UNION ALL
SELECT 'receivables', 'opening_import_reversed', public.tax_local_date(p_tenant, rv.created_at, rv.branch_id), rv.created_at, rv.branch_id, NULL, -rv.amount,
       'receivable', rv.id, 'receivable', rv.id, false
  FROM public.receivables rv WHERE rv.tenant_id = p_tenant AND rv.is_opening AND rv.state = 'opening_reversed'
)
SELECT m.* FROM m WHERE m.amount <> 0
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.subledger_movements(uuid) FROM PUBLIC;--> statement-breakpoint

-- 7. Atomic trusted executor-only import_apply (r4):
--    - Granted strictly to clinic_executor (revoked from PUBLIC and clinic_app; r3 P1 #1).
--    - Semantically validates calendar dates via _import_parse_iso_date() (zero raw value cast diagnostics; r3 P2 #5).
--    - Recomputes SHA-256 apply_digest INSIDE SQL over the EXACT operational values written and verifies against import_rows.apply_digest.
--    - Creates REAL operational rows and derives every local_id server-side.
CREATE FUNCTION public.import_apply(
  p_tenant_id uuid,
  p_actor_staff_id uuid,
  p_batch_id uuid,
  p_revision integer,
  p_manifest_sha256 text,
  p_entries jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET log_parameter_max_length_on_error = '0' AS $$
DECLARE
  a record;
  v_b public.import_batches%ROWTYPE;
  v_now timestamptz;
  v_e jsonb;
  v_row public.import_rows%ROWTYPE;
  v_existing public.source_id_map%ROWTYPE;
  v_had_reversed boolean;
  v_local_id uuid;
  v_fact_id uuid;
  v_fact_kind text;
  v_patient_id uuid;
  v_patient_hash text;
  v_acc_id uuid;
  v_acc_bal bigint;
  v_mrn_seq bigint;
  v_branch_tz text;
  v_cutover_ts timestamptz;
  v_cat_item_id uuid;
  v_cat_ver_id uuid;
  v_full_name text;
  v_birth_str text;
  v_birth_date date;
  v_sex text;
  v_phone text;
  v_cat_code text;
  v_cat_ver_str text;
  v_rem_str text;
  v_hist_str text;
  v_exp_str text;
  v_exp_date date;
  v_rem_sessions integer;
  v_hist_used integer;
  v_base_val bigint;
  v_rem_mod bigint;
  v_sess_val bigint;
  v_i integer;
  v_tuple text;
  v_computed_digest text;
  v_applied integer := 0;
  v_replayed integer := 0;
  v_reimported integer := 0;
  v_facts integer := 0;
  v_pending_left integer := 0;
BEGIN
  -- Fail closed if server-level ordinary or sampled statement/duration logging is enabled without bind-parameter suppression (r7/r8 P2 #2).
  IF (coalesce(current_setting('log_statement', true), 'none') <> 'none'
      OR coalesce(current_setting('log_min_duration_statement', true), '-1') <> '-1'
      OR coalesce(current_setting('log_min_duration_sample', true), '-1') <> '-1'
      OR coalesce(nullif(current_setting('log_transaction_sample_rate', true), '')::double precision, 0) > 0)
     AND coalesce(current_setting('log_parameter_max_length', true), '-1') <> '0' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: unsafe server parameter logging configuration' USING ERRCODE = '42501', DETAIL = '', HINT = '';
  END IF;
  SELECT * INTO a FROM public._import_executor_owner(p_tenant_id, p_actor_staff_id);
  PERFORM public.real_patient_gate_assert(a.tenant_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger_period:' || a.tenant_id::text, 0));
  v_now := clock_timestamp();

  SELECT * INTO v_b FROM public.import_batches
   WHERE tenant_id = a.tenant_id AND id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: import batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.state <> 'approved' OR v_b.payload_purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: batch must be approved and unpurged' USING ERRCODE = '55000';
  END IF;
  IF v_b.approved_revision <> p_revision OR v_b.approved_manifest_sha256 IS DISTINCT FROM p_manifest_sha256 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: approval revision or manifest mismatch' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ledger_periods lp
     WHERE lp.tenant_id = a.tenant_id AND lp.period = to_char(v_b.cutover_date, 'YYYY-MM')
  ) THEN
    RAISE EXCEPTION 'ERR_PERIOD_LOCKED: cutover period is locked' USING ERRCODE = '55000';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) <> v_b.row_count THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: entries must cover every batch row' USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_batches SET state = 'applying' WHERE tenant_id = a.tenant_id AND id = p_batch_id;

  FOR v_e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    IF jsonb_typeof(v_e) <> 'object' OR coalesce(v_e->>'rowNo', '') !~ '^[1-9][0-9]{0,3}$' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid staged payload' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_row FROM public.import_rows
     WHERE tenant_id = a.tenant_id
       AND batch_id = p_batch_id
       AND entity = (v_e->>'entity')
       AND row_no = (v_e->>'rowNo')::int
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: import row missing' USING ERRCODE = 'P0002';
    END IF;
    IF v_row.applied_state <> 'pending' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: duplicate entry in apply request' USING ERRCODE = '22023';
    END IF;
    IF v_row.branch_id IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: opening row requires branch_id' USING ERRCODE = '22023';
    END IF;

    -- Pre-validate fields and compute cryptographic SQL apply_digest over the EXACT values being applied (r2 P1 #1 & P2 #5):
    IF jsonb_typeof(v_e->'data') <> 'object' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid staged payload' USING ERRCODE = '22023';
    END IF;

    IF v_row.entity = 'patients' THEN
      v_full_name := btrim(coalesce(v_e->'data'->>'fullName', ''));
      v_birth_str := coalesce(v_e->'data'->>'birthDate', '');
      v_sex := coalesce(v_e->'data'->>'sex', '');
      v_phone := NULLIF(btrim(coalesce(v_e->'data'->>'phone', '')), '');
      IF length(v_full_name) < 2 OR length(v_full_name) > 120
         OR v_sex NOT IN ('female', 'male')
         OR (v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$') THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid staged payload' USING ERRCODE = '22023';
      END IF;
      v_birth_date := public._import_parse_iso_date(v_birth_str);
      v_tuple := 'v1|patients|' || v_row.branch_id::text || '|' || v_full_name || '|' || v_birth_str || '|' || v_sex || '|' || coalesce(v_phone, '');
    ELSE
      v_patient_hash := coalesce(v_e->'data'->>'patientSourceKeyHash', '');
      IF v_patient_hash !~ '^[0-9a-f]{64}$' OR v_row.amount_idr <= 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid staged payload' USING ERRCODE = '22023';
      END IF;
      IF v_row.entity = 'packages' THEN
        v_cat_code := upper(btrim(coalesce(v_e->'data'->>'catalogCode', '')));
        v_cat_ver_str := coalesce(v_e->'data'->>'catalogVersionId', '');
        v_rem_str := coalesce(v_e->'data'->>'remainingSessions', '');
        v_hist_str := coalesce(v_e->'data'->>'historicalUsedCount', '0');
        v_exp_str := coalesce(v_e->'data'->>'expiresOn', '');
        IF length(v_cat_code) < 1 OR length(v_cat_code) > 64
           OR v_cat_ver_str !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           OR v_rem_str !~ '^[1-9][0-9]{0,3}$'
           OR v_hist_str !~ '^[0-9]{1,4}$' THEN
          RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid staged payload' USING ERRCODE = '22023';
        END IF;
        v_cat_ver_id := lower(v_cat_ver_str)::uuid;
        v_exp_date := public._import_parse_iso_date(v_exp_str);
        v_rem_sessions := v_rem_str::int;
        v_hist_used := v_hist_str::int;
        IF v_rem_sessions < 1 OR v_rem_sessions > 1000 THEN
          RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid staged payload' USING ERRCODE = '22023';
        END IF;
        v_tuple := 'v1|packages|' || v_row.branch_id::text || '|' || v_patient_hash || '|' || v_row.amount_idr::text || '|' || v_cat_code || '|' || v_cat_ver_id::text || '|' || v_rem_sessions::text || '|' || v_hist_used::text || '|' || v_exp_str;
      ELSE
        v_tuple := 'v1|' || v_row.entity || '|' || v_row.branch_id::text || '|' || v_patient_hash || '|' || v_row.amount_idr::text;
      END IF;
    END IF;

    v_computed_digest := encode(sha256(convert_to(v_tuple, 'UTF8')), 'hex');
    IF v_computed_digest IS DISTINCT FROM v_row.apply_digest THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: applied payload does not match approved staged digest' USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_existing FROM public.source_id_map
     WHERE tenant_id = a.tenant_id
       AND source_system = v_b.source_system
       AND entity = v_row.entity
       AND source_key_hash = v_row.source_key_hash
       AND state = 'active'
     FOR UPDATE;

    IF FOUND THEN
      IF v_existing.canonical_payload_sha256 IS DISTINCT FROM v_row.canonical_payload_sha256 THEN
        RAISE EXCEPTION 'ERR_SOURCE_CONFLICT: payload hash mismatch on replay' USING ERRCODE = '23505';
      END IF;
      UPDATE public.import_rows
         SET local_id = v_existing.local_id, applied_state = 'replayed'
       WHERE tenant_id = a.tenant_id AND id = v_row.id;
      v_replayed := v_replayed + 1;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.source_id_map
       WHERE tenant_id = a.tenant_id
         AND source_system = v_b.source_system
         AND entity = v_row.entity
         AND source_key_hash = v_row.source_key_hash
         AND state = 'reversed'
    ) INTO v_had_reversed;

    SELECT b.timezone INTO v_branch_tz FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_row.branch_id;
    IF v_branch_tz IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
    END IF;
    v_cutover_ts := (v_b.cutover_date::timestamp + time '12:00:00') AT TIME ZONE v_branch_tz;

    IF v_row.entity = 'patients' THEN
      INSERT INTO public.patient_mrn_counters (tenant_id, last_seq) VALUES (a.tenant_id, 1)
      ON CONFLICT (tenant_id) DO UPDATE SET last_seq = public.patient_mrn_counters.last_seq + 1
      RETURNING last_seq INTO v_mrn_seq;

      BEGIN
        INSERT INTO public.patients (
          tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason,
          religion, occupation, education, marital_status, registered_branch_id,
          opening_batch_id, created_by, created_as, created_at
        ) VALUES (
          a.tenant_id,
          'RM-' || lpad(v_mrn_seq::text, 6, '0'),
          v_full_name,
          v_birth_date,
          v_sex,
          'opening_import',
          'Impor data awal klinik, lengkapi identitas saat kunjungan',
          'lainnya',
          'Belum diisi',
          'lainnya',
          'belum_kawin',
          v_row.branch_id,
          p_batch_id,
          a.staff_id,
          'owner',
          v_cutover_ts
        ) RETURNING id INTO v_local_id;

        IF v_phone IS NOT NULL THEN
          INSERT INTO public.contact_points (tenant_id, patient_id, kind, value, is_primary, created_at)
          VALUES (a.tenant_id, v_local_id, 'phone', v_phone, true, v_cutover_ts);
        END IF;
      EXCEPTION WHEN others THEN
        -- Catch internal write errors inside PL/pgSQL so PostgreSQL never logs or surfaces DETAIL ("Failing row contains (...)") with patient fields (r6 P2 #1).
        RAISE EXCEPTION 'ERR_INVALID_INPUT: patient write failed' USING ERRCODE = '22023', DETAIL = '', HINT = '';
      END;
      v_fact_kind := NULL;
    ELSE
      SELECT sm.local_id INTO v_patient_id
        FROM public.source_id_map sm
       WHERE sm.tenant_id = a.tenant_id
         AND sm.source_system = v_b.source_system
         AND sm.entity = 'patients'
         AND sm.source_key_hash = v_patient_hash
         AND sm.state = 'active';
      IF v_patient_id IS NULL THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: referenced patient not mapped' USING ERRCODE = 'P0002';
      END IF;

      v_fact_id := public.uuid_generate_v7();
      IF v_row.entity = 'balances' THEN
        v_fact_kind := 'balance';
        INSERT INTO public.balance_accounts (tenant_id, patient_id)
        VALUES (a.tenant_id, v_patient_id)
        ON CONFLICT (tenant_id, patient_id) DO NOTHING;

        SELECT ba.id, ba.balance INTO v_acc_id, v_acc_bal
          FROM public.balance_accounts ba
         WHERE ba.tenant_id = a.tenant_id AND ba.patient_id = v_patient_id
         FOR UPDATE;

        INSERT INTO public.balance_entries (
          tenant_id, account_id, branch_id, kind, amount, balance_after,
          vat_settled, source_kind, source_id, command_key, created_by, created_as, created_at
        ) VALUES (
          a.tenant_id, v_acc_id, v_row.branch_id, 'opening_balance', v_row.amount_idr, v_acc_bal + v_row.amount_idr,
          false, 'import_opening_fact', v_fact_id, 'openbal:' || v_fact_id::text, a.staff_id, 'owner', v_cutover_ts
        ) RETURNING id INTO v_local_id;

      ELSIF v_row.entity = 'packages' THEN
        v_fact_kind := 'package';
        -- Recheck that the approved (catalog_version_id, catalog_code) is still an active service version in this tenant (r5 P2 #1).
        SELECT ci.id INTO v_cat_item_id
          FROM public.catalog_versions cv
          JOIN public.catalog_items ci ON ci.tenant_id = cv.tenant_id AND ci.id = cv.item_id
         WHERE cv.tenant_id = a.tenant_id
           AND cv.id = v_cat_ver_id
           AND upper(btrim(ci.code)) = v_cat_code
           AND cv.state = 'active'
           AND ci.kind = 'service';
        IF v_cat_item_id IS NULL THEN
          RAISE EXCEPTION 'ERR_NOT_FOUND: active catalog service version not found for opening package' USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.packages (
          tenant_id, sold_branch_id, patient_id, is_opening, opening_batch_id, opening_historical_used_count,
          item_id, catalog_version_id, price, min_dp, validity_end, state, created_by, created_as, created_at
        ) VALUES (
          a.tenant_id, v_row.branch_id, v_patient_id, true, p_batch_id, v_hist_used,
          v_cat_item_id, v_cat_ver_id, v_row.amount_idr, 1,
          (v_exp_date::timestamp + time '23:59:59') AT TIME ZONE v_branch_tz,
          'active', a.staff_id, 'owner', v_cutover_ts
        ) RETURNING id INTO v_local_id;

        v_base_val := v_row.amount_idr / v_rem_sessions;
        v_rem_mod := v_row.amount_idr % v_rem_sessions;
        FOR v_i IN 1..v_rem_sessions LOOP
          v_sess_val := v_base_val + CASE WHEN v_i <= v_rem_mod THEN 1 ELSE 0 END;
          INSERT INTO public.package_sessions (
            tenant_id, package_id, seq, service_item_id, allocated_value,
            tax_category, tax_basis, vat_base, vat_amount, vat_recognised_amount, state, created_at
          ) VALUES (
            a.tenant_id, v_local_id, v_i::smallint, v_cat_item_id, v_sess_val,
            'non_object', 'opening_import', v_sess_val, 0, 0, 'available', v_cutover_ts
          );
        END LOOP;

      ELSIF v_row.entity = 'booking_dps' THEN
        v_fact_kind := 'booking_dp';
        INSERT INTO public.booking_deposits (
          tenant_id, branch_id, patient_id, is_opening, opening_batch_id,
          method, amount, tax_category, is_pkp_at_receipt, vat_base, vat_amount, vat_recognised_amount,
          cutoff_hours, state, command_key, received_by, received_as, received_at
        ) VALUES (
          a.tenant_id, v_row.branch_id, v_patient_id, true, p_batch_id,
          'transfer', v_row.amount_idr, 'non_object', false, v_row.amount_idr, 0, 0,
          24, 'held', 'opendp:' || v_fact_id::text, a.staff_id, 'owner', v_cutover_ts
        ) RETURNING id INTO v_local_id;

      ELSIF v_row.entity = 'receivables' THEN
        v_fact_kind := 'receivable';
        INSERT INTO public.receivables (
          tenant_id, branch_id, patient_id, is_opening, opening_batch_id,
          amount, collected_amount, written_off_amount, state, command_key, created_by, created_as, created_at
        ) VALUES (
          a.tenant_id, v_row.branch_id, v_patient_id, true, p_batch_id,
          v_row.amount_idr, 0, 0, 'open', 'openar:' || v_fact_id::text, a.staff_id, 'owner', v_cutover_ts
        ) RETURNING id INTO v_local_id;
      ELSE
        RAISE EXCEPTION 'ERR_INVALID_INPUT: unsupported entity' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.import_opening_facts (
        id, tenant_id, batch_id, fact_kind, entity_id, branch_id, effective_date, amount_idr, created_at
      ) VALUES (
        v_fact_id, a.tenant_id, p_batch_id, v_fact_kind, v_local_id, v_row.branch_id, v_b.cutover_date, v_row.amount_idr, v_now
      );

      INSERT INTO public.domain_events (
        tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload
      ) VALUES (
        a.tenant_id, v_row.branch_id, 'OpeningImportApplied', 'import_opening_fact', v_fact_id,
        a.staff_id, 'owner',
        jsonb_build_object('batch_id', p_batch_id, 'fact_id', v_fact_id, 'fact_kind', v_fact_kind)
      );
      v_facts := v_facts + 1;
    END IF;

    INSERT INTO public.source_id_map (
      tenant_id, source_system, entity, source_key_hash,
      canonical_payload_sha256, local_id, batch_id, state, created_at
    ) VALUES (
      a.tenant_id, v_b.source_system, v_row.entity, v_row.source_key_hash,
      v_row.canonical_payload_sha256, v_local_id, p_batch_id, 'active', v_now
    );

    UPDATE public.import_rows
       SET local_id = v_local_id, applied_state = 'applied'
     WHERE tenant_id = a.tenant_id AND id = v_row.id;
    v_applied := v_applied + 1;
    IF v_had_reversed THEN
      v_reimported := v_reimported + 1;
    END IF;
  END LOOP;

  SELECT count(*)::int INTO v_pending_left FROM public.import_rows
   WHERE tenant_id = a.tenant_id AND batch_id = p_batch_id AND applied_state = 'pending';
  IF v_pending_left <> 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: unapplied rows remain in batch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_batches
     SET state = 'applied', applied_by = a.staff_id, applied_at = v_now
   WHERE tenant_id = a.tenant_id AND id = p_batch_id;

  PERFORM public.audit_append('settings_change', 'import_batch', p_batch_id, 'success', 'import_batch_applied');
  RETURN jsonb_build_object(
    'batchId', p_batch_id,
    'state', 'applied',
    'appliedCount', v_applied,
    'replayedCount', v_replayed,
    'reimportedAfterReversalCount', v_reimported,
    'factCount', v_facts
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_apply(uuid, uuid, uuid, integer, text, jsonb) FROM PUBLIC, clinic_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_apply(uuid, uuid, uuid, integer, text, jsonb) TO clinic_executor;--> statement-breakpoint

-- 8. D7 Append-only owner rollback (r3):
--    - Checks outside-batch financial dependencies on imported patients (r2 P1 #2) and retires patients via opening_reversed = true.
--    - Allows multiple opening balance credits from the same batch and unwinds them in descending seq order (r2 P2 #4).
CREATE FUNCTION public.import_rollback(p_batch_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_b public.import_batches%ROWTYPE;
  v_now timestamptz;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_f record;
  v_be public.balance_entries%ROWTYPE;
  v_acc_bal bigint;
  v_rev integer := 0;
BEGIN
  SELECT * INTO a FROM public._import_owner_actor();
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger_period:' || a.tenant_id::text, 0));
  v_now := clock_timestamp();

  IF v_reason NOT IN ('cutover_correction', 'duplicate_batch', 'mapping_error', 'owner_cancelled') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid rollback reason code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_b FROM public.import_batches
   WHERE tenant_id = a.tenant_id AND id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: import batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.state <> 'applied' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: only applied batches may roll back' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_periods lp
     WHERE lp.tenant_id = a.tenant_id AND lp.period = to_char(v_b.cutover_date, 'YYYY-MM')
  ) THEN
    RAISE EXCEPTION 'ERR_PERIOD_LOCKED: cutover period is locked' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.audit_events ae
     WHERE ae.tenant_id = a.tenant_id
       AND ae.action = 'export'
       AND ae.object_kind = 'journal'
       AND ae.outcome = 'success'
       AND ae.reason_code = 'journal_exported'
       AND ae.at >= v_b.applied_at
  ) THEN
    RAISE EXCEPTION 'ERR_JOURNAL_EXPORTED: cannot roll back after official journal export' USING ERRCODE = '55000';
  END IF;

  -- Check ALL clinical, billing, and outside-batch financial dependencies on imported patients (r2 P1 #2):
  IF EXISTS (
    SELECT 1 FROM public.patients p
     WHERE p.tenant_id = a.tenant_id AND p.opening_batch_id = p_batch_id
       AND (
         EXISTS (SELECT 1 FROM public.appointments ap WHERE ap.tenant_id = a.tenant_id AND ap.patient_id = p.id)
         OR EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.patient_id = p.id)
         OR EXISTS (SELECT 1 FROM public.invoices inv WHERE inv.tenant_id = a.tenant_id AND inv.patient_id = p.id)
         OR EXISTS (SELECT 1 FROM public.consents co WHERE co.tenant_id = a.tenant_id AND co.patient_id = p.id)
         OR EXISTS (SELECT 1 FROM public.patient_merges pm WHERE pm.tenant_id = a.tenant_id AND (pm.survivor_id = p.id OR pm.merged_id = p.id))
         OR EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = a.tenant_id AND pk.patient_id = p.id AND pk.opening_batch_id IS DISTINCT FROM p_batch_id)
         OR EXISTS (SELECT 1 FROM public.booking_deposits bd WHERE bd.tenant_id = a.tenant_id AND bd.patient_id = p.id AND bd.opening_batch_id IS DISTINCT FROM p_batch_id)
         OR EXISTS (SELECT 1 FROM public.receivables rv WHERE rv.tenant_id = a.tenant_id AND rv.patient_id = p.id AND rv.opening_batch_id IS DISTINCT FROM p_batch_id)
         OR EXISTS (
           SELECT 1 FROM public.balance_accounts ba
             JOIN public.balance_entries be ON be.tenant_id = ba.tenant_id AND be.account_id = ba.id
            WHERE ba.tenant_id = a.tenant_id AND ba.patient_id = p.id
              AND NOT EXISTS (
                SELECT 1 FROM public.import_opening_facts f2
                 WHERE f2.tenant_id = a.tenant_id
                   AND f2.batch_id = p_batch_id
                   AND f2.fact_kind = 'balance'
                   AND be.source_kind = 'import_opening_fact'
                   AND be.source_id = f2.id
              )
         )
       )
  ) THEN
    RAISE EXCEPTION 'ERR_DOWNSTREAM_ACTIVITY: imported patient already has clinical, billing, or outside-batch financial activity' USING ERRCODE = '55000';
  END IF;

  -- Same-batch balance credits are permitted (r2 P2 #4); null-safe NOT EXISTS catches payment-backed debits (NULL source_kind/source_id; r3 P1 #2):
  IF EXISTS (
    SELECT 1 FROM public.import_opening_facts f
      JOIN public.balance_entries be ON be.tenant_id = f.tenant_id AND be.id = f.entity_id
     WHERE f.tenant_id = a.tenant_id AND f.batch_id = p_batch_id AND f.fact_kind = 'balance'
       AND EXISTS (
         SELECT 1 FROM public.balance_entries be2
          WHERE be2.tenant_id = be.tenant_id AND be2.account_id = be.account_id AND be2.seq > be.seq
            AND NOT EXISTS (
              SELECT 1 FROM public.import_opening_facts f2
               WHERE f2.tenant_id = a.tenant_id
                 AND f2.batch_id = p_batch_id
                 AND f2.fact_kind = 'balance'
                 AND be2.source_kind = 'import_opening_fact'
                 AND be2.source_id = f2.id
            )
       )
  ) THEN
    RAISE EXCEPTION 'ERR_DOWNSTREAM_ACTIVITY: imported balance already used or adjusted' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.packages pk
     WHERE pk.tenant_id = a.tenant_id AND pk.opening_batch_id = p_batch_id
       AND (
         pk.state <> 'active'
         OR EXISTS (SELECT 1 FROM public.package_sessions ps WHERE ps.tenant_id = pk.tenant_id AND ps.package_id = pk.id AND ps.state <> 'available')
         OR EXISTS (SELECT 1 FROM public.package_substitutions su WHERE su.tenant_id = pk.tenant_id AND su.package_id = pk.id)
       )
  ) THEN
    RAISE EXCEPTION 'ERR_DOWNSTREAM_ACTIVITY: imported package already reserved, redeemed, or modified' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_deposits bd
     WHERE bd.tenant_id = a.tenant_id AND bd.opening_batch_id = p_batch_id
       AND (bd.state <> 'held' OR bd.appointment_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'ERR_DOWNSTREAM_ACTIVITY: imported booking deposit already matched or decided' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.receivables rv
     WHERE rv.tenant_id = a.tenant_id AND rv.opening_batch_id = p_batch_id
       AND (rv.state <> 'open' OR rv.collected_amount > 0 OR rv.written_off_amount > 0)
  ) THEN
    RAISE EXCEPTION 'ERR_DOWNSTREAM_ACTIVITY: imported receivable already collected or written off' USING ERRCODE = '55000';
  END IF;

  -- Unwind financial facts (balances in descending seq order per r2 P2 #4):
  FOR v_f IN
    SELECT f.id, f.fact_kind, f.entity_id, f.branch_id, f.amount_idr,
           coalesce(be.seq, 0) AS bal_seq
      FROM public.import_opening_facts f
      LEFT JOIN public.balance_entries be ON f.fact_kind = 'balance' AND be.tenant_id = f.tenant_id AND be.id = f.entity_id
     WHERE f.tenant_id = a.tenant_id AND f.batch_id = p_batch_id AND f.reversed_at IS NULL
     ORDER BY bal_seq DESC, f.id DESC
     FOR UPDATE OF f
  LOOP
    IF v_f.fact_kind = 'balance' THEN
      SELECT * INTO v_be FROM public.balance_entries WHERE tenant_id = a.tenant_id AND id = v_f.entity_id;
      SELECT ba.balance INTO v_acc_bal FROM public.balance_accounts ba WHERE ba.tenant_id = a.tenant_id AND ba.id = v_be.account_id FOR UPDATE;
      INSERT INTO public.balance_entries (
        tenant_id, account_id, branch_id, kind, amount, balance_after,
        vat_settled, source_kind, source_id, command_key, created_by, created_as, created_at
      ) VALUES (
        a.tenant_id, v_be.account_id, v_be.branch_id, 'opening_reversal', -v_be.amount, v_acc_bal - v_be.amount,
        false, 'import_opening_fact', v_f.id, 'openbalrev:' || v_f.id::text, a.staff_id, 'owner', v_be.created_at
      );
    ELSIF v_f.fact_kind = 'package' THEN
      UPDATE public.package_sessions
         SET state = 'closed', version = version + 1
       WHERE tenant_id = a.tenant_id AND package_id = v_f.entity_id AND state = 'available';
      UPDATE public.packages
         SET state = 'cancelled', closed_at = v_now, closed_by = a.staff_id, closed_as = 'owner',
             close_reason = 'opening_import_reversed', paid_unused_moved = 0, remainder_cancelled = price
       WHERE tenant_id = a.tenant_id AND id = v_f.entity_id AND state = 'active';
    ELSIF v_f.fact_kind = 'booking_dp' THEN
      UPDATE public.booking_deposits
         SET state = 'opening_reversed', decided_at = received_at, decided_by = a.staff_id, decided_as = 'owner',
             decision_code = 'opening_import_reversed'
       WHERE tenant_id = a.tenant_id AND id = v_f.entity_id AND state = 'held';
    ELSIF v_f.fact_kind = 'receivable' THEN
      UPDATE public.receivables
         SET state = 'opening_reversed'
       WHERE tenant_id = a.tenant_id AND id = v_f.entity_id AND state = 'open';
    END IF;

    UPDATE public.import_opening_facts
       SET reversed_at = v_now
     WHERE tenant_id = a.tenant_id AND id = v_f.id;

    INSERT INTO public.domain_events (
      tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload
    ) VALUES (
      a.tenant_id, v_f.branch_id, 'OpeningImportReversed', 'import_opening_fact', v_f.id,
      a.staff_id, 'owner',
      jsonb_build_object('batch_id', p_batch_id, 'fact_id', v_f.id, 'fact_kind', v_f.fact_kind)
    );
    v_rev := v_rev + 1;
  END LOOP;

  -- Retire imported patients via one-way opening_reversed = true (r2 P1 #2; zero deletes, hidden from active reads):
  UPDATE public.patients
     SET opening_reversed = true
   WHERE tenant_id = a.tenant_id AND opening_batch_id = p_batch_id AND NOT opening_reversed;

  UPDATE public.source_id_map
     SET state = 'reversed', reversed_at = v_now
   WHERE tenant_id = a.tenant_id AND batch_id = p_batch_id AND state = 'active';

  UPDATE public.import_rows
     SET applied_state = 'reversed'
   WHERE tenant_id = a.tenant_id AND batch_id = p_batch_id AND applied_state = 'applied';

  UPDATE public.import_batches
     SET state = 'rolled_back', rolled_back_by = a.staff_id, rolled_back_at = v_now, rollback_reason = v_reason
   WHERE tenant_id = a.tenant_id AND id = p_batch_id;

  PERFORM public.audit_append('settings_change', 'import_batch', p_batch_id, 'success', 'import_batch_rolled_back');
  RETURN jsonb_build_object('batchId', p_batch_id, 'state', 'rolled_back', 'reversedFacts', v_rev);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_rollback(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_rollback(uuid, text) TO clinic_app;--> statement-breakpoint

-- 9. One-time operational match for a held opening booking deposit to an appointment (r4 P1 #1).
CREATE FUNCTION public.import_opening_deposit_match(p_deposit_id uuid, p_appointment_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_dp public.booking_deposits%ROWTYPE;
  v_ap public.appointments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner', 'manager', 'fo_cashier') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role cannot match opening deposit' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_dp FROM public.booking_deposits
   WHERE tenant_id = a.tenant_id AND id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: booking deposit not found' USING ERRCODE = 'P0002';
  END IF;
  IF a.branch_id IS NOT NULL AND v_dp.branch_id IS DISTINCT FROM a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: branch scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF NOT v_dp.is_opening OR v_dp.state <> 'held' OR v_dp.appointment_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: opening deposit is already matched or decided' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_ap FROM public.appointments
   WHERE tenant_id = a.tenant_id AND id = p_appointment_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: appointment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_ap.branch_id IS DISTINCT FROM v_dp.branch_id
     OR public.patient_canonical(v_ap.tenant_id, v_ap.patient_id) IS DISTINCT FROM v_dp.patient_id
     OR v_ap.state NOT IN ('held', 'booked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: appointment does not match opening deposit scope' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.catalog_versions cv
      JOIN public.catalog_items ci ON ci.tenant_id = cv.tenant_id AND ci.id = cv.item_id
     WHERE cv.tenant_id = a.tenant_id AND cv.id = v_ap.catalog_version_id AND cv.state = 'active' AND ci.kind = 'service'
  ) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: active catalog service version required' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.booking_deposits
     SET appointment_id = v_ap.id,
         catalog_version_id = v_ap.catalog_version_id
   WHERE tenant_id = a.tenant_id AND id = v_dp.id;

  PERFORM public.audit_append('settings_change', 'booking_deposit', v_dp.id, 'success', 'opening_deposit_matched');
  RETURN jsonb_build_object(
    'depositId', v_dp.id,
    'appointmentId', v_ap.id,
    'catalogVersionId', v_ap.catalog_version_id
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.import_opening_deposit_match(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.import_opening_deposit_match(uuid, uuid) TO clinic_app;--> statement-breakpoint

UPDATE public.event_consumers
   SET event_types = (
     SELECT array_agg(DISTINCT x) FROM unnest(event_types || ARRAY['OpeningImportApplied','OpeningImportReversed']) AS x
   )
 WHERE name = 'ledger.posting';--> statement-breakpoint
