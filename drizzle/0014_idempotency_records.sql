CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid DEFAULT app_tenant_id() NOT NULL,
	"command" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"staff_id" uuid DEFAULT app_staff_id(),
	"status" text DEFAULT 'in_progress' NOT NULL,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_records_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "idempotency_records_command_key" UNIQUE("tenant_id","command","key"),
	CONSTRAINT "idempotency_records_command_check" CHECK ("idempotency_records"."command" ~ '^[a-z][a-z0-9_.]{2,80}$'),
	CONSTRAINT "idempotency_records_key_check" CHECK ("idempotency_records"."key" ~ '^[A-Za-z0-9_.:-]{8,128}$'),
	CONSTRAINT "idempotency_records_fingerprint_check" CHECK ("idempotency_records"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_records_result_size_check" CHECK ("idempotency_records"."result" is null or octet_length("idempotency_records"."result"::text) <= 8192),
	CONSTRAINT "idempotency_records_status_check" CHECK ("idempotency_records"."status" in ('in_progress','succeeded','failed')),
	CONSTRAINT "idempotency_records_error_code_check" CHECK ("idempotency_records"."error_code" is null or "idempotency_records"."error_code" ~ '^ERR_[A-Z_]{2,60}$'),
	CONSTRAINT "idempotency_records_outcome_check" CHECK (("idempotency_records"."status" = 'in_progress' and "idempotency_records"."completed_at" is null and "idempotency_records"."result" is null and "idempotency_records"."error_code" is null)
       or ("idempotency_records"."status" = 'succeeded' and "idempotency_records"."completed_at" is not null and "idempotency_records"."error_code" is null)
       or ("idempotency_records"."status" = 'failed' and "idempotency_records"."completed_at" is not null and "idempotency_records"."result" is null and "idempotency_records"."error_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;