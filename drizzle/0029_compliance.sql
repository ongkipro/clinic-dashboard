CREATE TABLE "compliance_obligations" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"label" text NOT NULL,
	"area" text NOT NULL,
	"config_kind" text,
	"valid_months" integer,
	CONSTRAINT "compliance_obligations_key_check" CHECK ("compliance_obligations"."key" ~ '^[a-z][a-z0-9_]{2,60}$'),
	CONSTRAINT "compliance_obligations_scope_check" CHECK ("compliance_obligations"."scope" in ('vendor','tenant')),
	CONSTRAINT "compliance_obligations_area_check" CHECK ("compliance_obligations"."area" in ('legal','tax','accounting','clinical','privacy','operations')),
	CONSTRAINT "compliance_obligations_valid_check" CHECK ("compliance_obligations"."valid_months" is null or "compliance_obligations"."valid_months" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "evidence_approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "evidence_approvals_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"config_version" text,
	"decision" text NOT NULL,
	"reason" text,
	"valid_until" date,
	"decided_by" uuid NOT NULL,
	"decided_as" text NOT NULL,
	"decided_name" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_approvals_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "evidence_approvals_decision_check" CHECK ("evidence_approvals"."decision" in ('approved','rejected','revoked')),
	CONSTRAINT "evidence_approvals_reason_check" CHECK ("evidence_approvals"."decision" = 'approved' or length(btrim(coalesce("evidence_approvals"."reason", ''))) >= 3)
);
--> statement-breakpoint
CREATE TABLE "evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"expert_name" text NOT NULL,
	"document_date" date NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_as" text NOT NULL,
	"uploaded_name" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_files_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "evidence_files_tenant_item_id_key" UNIQUE("tenant_id","item_id","id"),
	CONSTRAINT "evidence_files_item_version_key" UNIQUE("item_id","version"),
	CONSTRAINT "evidence_files_sha_check" CHECK ("evidence_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evidence_files_checksum_check" CHECK ("evidence_files"."sha256" = encode(sha256("evidence_files"."content"), 'hex')),
	CONSTRAINT "evidence_files_size_check" CHECK ("evidence_files"."size_bytes" between 1 and 5242880 and "evidence_files"."size_bytes" = octet_length("evidence_files"."content")),
	CONSTRAINT "evidence_files_media_check" CHECK ("evidence_files"."media_type" in ('application/pdf','image/png','image/jpeg')),
	CONSTRAINT "evidence_files_name_check" CHECK (length("evidence_files"."file_name") between 1 and 200 and "evidence_files"."file_name" !~ '[/\\]'),
	CONSTRAINT "evidence_files_expert_check" CHECK (length(btrim("evidence_files"."expert_name")) between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obligation_key" text NOT NULL,
	"state" text DEFAULT 'submitted' NOT NULL,
	"valid_until" date,
	"config_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "evidence_items_one_per_obligation" UNIQUE("tenant_id","obligation_key"),
	CONSTRAINT "evidence_items_state_check" CHECK ("evidence_items"."state" in ('submitted','approved','rejected','revoked'))
);
--> statement-breakpoint
CREATE TABLE "feature_gates" (
	"key" text NOT NULL,
	"obligation_key" text NOT NULL,
	CONSTRAINT "feature_gates_key_obligation_key" UNIQUE("key","obligation_key"),
	CONSTRAINT "feature_gates_key_check" CHECK ("feature_gates"."key" ~ '^[a-z][a-z0-9_]{2,60}$')
);
--> statement-breakpoint
CREATE TABLE "vendor_evidence_items" (
	"obligation_key" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"valid_until" date,
	"config_version" text,
	"file_sha256" text,
	"decided_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_evidence_items_state_check" CHECK ("vendor_evidence_items"."state" in ('submitted','approved','rejected','revoked')),
	CONSTRAINT "vendor_evidence_items_sha_check" CHECK ("vendor_evidence_items"."file_sha256" is null or "vendor_evidence_items"."file_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "evidence_approvals" ADD CONSTRAINT "evidence_approvals_tenant_id_item_id_evidence_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."evidence_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_approvals" ADD CONSTRAINT "evidence_approvals_tenant_id_item_id_file_id_evidence_files_tenant_id_item_id_id_fk" FOREIGN KEY ("tenant_id","item_id","file_id") REFERENCES "public"."evidence_files"("tenant_id","item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_approvals" ADD CONSTRAINT "evidence_approvals_tenant_id_decided_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_tenant_id_item_id_evidence_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."evidence_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_tenant_id_uploaded_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","uploaded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_obligation_key_compliance_obligations_key_fk" FOREIGN KEY ("obligation_key") REFERENCES "public"."compliance_obligations"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_gates" ADD CONSTRAINT "feature_gates_obligation_key_compliance_obligations_key_fk" FOREIGN KEY ("obligation_key") REFERENCES "public"."compliance_obligations"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_evidence_items" ADD CONSTRAINT "vendor_evidence_items_obligation_key_compliance_obligations_key_fk" FOREIGN KEY ("obligation_key") REFERENCES "public"."compliance_obligations"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_approvals_item_idx" ON "evidence_approvals" USING btree ("item_id","seq");