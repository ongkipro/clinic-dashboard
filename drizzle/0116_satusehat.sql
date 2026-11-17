CREATE TABLE "satusehat_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"outbox_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"lease_gen" integer NOT NULL,
	"verb" text NOT NULL,
	"body_fingerprint" text,
	"outcome" text,
	"http_status" integer,
	"remote_id" text,
	"remote_version" text,
	"error_code" text,
	"error_path" text,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "satusehat_attempts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_attempts_check" CHECK ("satusehat_attempts"."verb" in ('create','update','search','read') and ("satusehat_attempts"."outcome" is null or "satusehat_attempts"."outcome" in ('ok','http_4xx','http_5xx','timeout','lost','stale','not_found','many','incomplete','mismatch'))
      and (("satusehat_attempts"."outcome" is null) = ("satusehat_attempts"."finished_at" is null)) and "satusehat_attempts"."revision" >= 1 and "satusehat_attempts"."lease_gen" >= 1
      and ("satusehat_attempts"."http_status" is null or "satusehat_attempts"."http_status" between 100 and 599) and ("satusehat_attempts"."remote_id" is null or "satusehat_attempts"."remote_id" ~ '^[A-Za-z0-9-]{3,64}$')
      and ("satusehat_attempts"."remote_version" is null or length("satusehat_attempts"."remote_version") <= 64) and ("satusehat_attempts"."error_code" is null or length("satusehat_attempts"."error_code") <= 80)
      and ("satusehat_attempts"."error_path" is null or length("satusehat_attempts"."error_path") <= 200)
      and (("satusehat_attempts"."verb" in ('create','update')) = ("satusehat_attempts"."body_fingerprint" is not null)) and ("satusehat_attempts"."body_fingerprint" is null or "satusehat_attempts"."body_fingerprint" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "satusehat_code_maps" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"display" text NOT NULL,
	"validated" boolean DEFAULT false NOT NULL,
	"command_key" text NOT NULL,
	"mapped_by" uuid NOT NULL,
	"mapped_as" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "satusehat_code_maps_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_code_maps_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "satusehat_code_maps_check" CHECK ("satusehat_code_maps"."kind" = 'icd9cm' and "satusehat_code_maps"."code" ~ '^[0-9]{2}(\.[0-9]{1,2})?$' and length(btrim("satusehat_code_maps"."display")) between 2 and 200
      and "satusehat_code_maps"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "satusehat_code_maps"."mapped_as" in ('owner','facility_head') and ("satusehat_code_maps"."effective_to" is null or "satusehat_code_maps"."effective_to" > "satusehat_code_maps"."effective_from"))
);
--> statement-breakpoint
CREATE TABLE "satusehat_code_systems" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"kind" text NOT NULL,
	"system_uri" text NOT NULL,
	"code" text NOT NULL,
	"display" text NOT NULL,
	"local_field" text,
	"release_ref" text NOT NULL,
	"provenance_url" text NOT NULL,
	"validated" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "satusehat_code_systems_key" UNIQUE("kind","code","effective_from"),
	CONSTRAINT "satusehat_code_systems_check" CHECK ("satusehat_code_systems"."kind" in ('icd10','icd9cm','loinc','kfa') and "satusehat_code_systems"."system_uri" ~ '^https?://[a-z0-9./_-]+$'
      and length("satusehat_code_systems"."code") between 1 and 40 and length(btrim("satusehat_code_systems"."display")) between 2 and 200 and length("satusehat_code_systems"."release_ref") between 3 and 120
      and "satusehat_code_systems"."provenance_url" ~ '^https://' and ("satusehat_code_systems"."local_field" is null or "satusehat_code_systems"."local_field" ~ '^[a-z][a-z0-9_]{1,40}$')
      and ("satusehat_code_systems"."effective_to" is null or "satusehat_code_systems"."effective_to" > "satusehat_code_systems"."effective_from"))
);
--> statement-breakpoint
CREATE TABLE "satusehat_credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"dek_ref" text NOT NULL,
	"generation" integer NOT NULL,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "satusehat_credentials_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_credentials_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "satusehat_credentials_generation_key" UNIQUE("tenant_id","branch_id","environment","generation"),
	CONSTRAINT "satusehat_credentials_check" CHECK ("satusehat_credentials"."environment" in ('sandbox','production') and "satusehat_credentials"."organization_id" ~ '^[A-Za-z0-9-]{3,64}$'
      and length(btrim("satusehat_credentials"."client_id")) between 3 and 200 and "satusehat_credentials"."secret_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and "satusehat_credentials"."dek_ref" ~ '^dek:v[1-9][0-9]{0,8}$' and "satusehat_credentials"."generation" >= 1
      and "satusehat_credentials"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "satusehat_credentials"."created_as" in ('owner','admin_pusat'))
);
--> statement-breakpoint
CREATE TABLE "satusehat_errors" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "satusehat_errors_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_errors_attempt_key" UNIQUE("tenant_id","attempt_id"),
	CONSTRAINT "satusehat_errors_check" CHECK (jsonb_typeof("satusehat_errors"."body") = 'object' and length("satusehat_errors"."body"::text) <= 20000)
);
--> statement-breakpoint
CREATE TABLE "satusehat_link_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"exam_version_id" uuid NOT NULL,
	"materialized" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "satusehat_link_revisions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_link_revisions_key" UNIQUE("tenant_id","link_id","revision"),
	CONSTRAINT "satusehat_link_revisions_check" CHECK ("satusehat_link_revisions"."revision" >= 1 and jsonb_typeof("satusehat_link_revisions"."materialized") = 'object' and "satusehat_link_revisions"."fingerprint" ~ '^[0-9a-f]{64}$'
      and "satusehat_link_revisions"."organization_id" ~ '^[A-Za-z0-9-]{3,64}$')
);
--> statement-breakpoint
CREATE TABLE "satusehat_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"visit_id" uuid NOT NULL,
	"fhir_type" text NOT NULL,
	"local_key" text NOT NULL,
	"organization_id" text NOT NULL,
	"remote_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"status_reason" text,
	"current_revision" integer NOT NULL,
	"confirmed_revision" integer,
	"check_after" timestamp with time zone,
	"reconcile_rounds" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"sent_refs" jsonb,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "satusehat_links_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_links_resource_key" UNIQUE("tenant_id","environment","fhir_type","visit_id","local_key"),
	CONSTRAINT "satusehat_links_check" CHECK ("satusehat_links"."environment" in ('sandbox','production') and "satusehat_links"."fhir_type" in ('Encounter','Condition','Observation','Procedure','Medication','MedicationRequest','MedicationDispense')
      and "satusehat_links"."status" in ('queued','held','sending','confirmed','failed','outcome_unknown','exception','withdrawal_pending') and length("satusehat_links"."local_key") between 1 and 120 and "satusehat_links"."organization_id" ~ '^[A-Za-z0-9-]{3,64}$'
      and ("satusehat_links"."remote_id" is null or "satusehat_links"."remote_id" ~ '^[A-Za-z0-9-]{3,64}$') and "satusehat_links"."current_revision" >= 1 and ("satusehat_links"."confirmed_revision" is null or "satusehat_links"."confirmed_revision" between 1 and "satusehat_links"."current_revision")
      and ("satusehat_links"."status_reason" is null or "satusehat_links"."status_reason" ~ '^[a-z][a-z0-9_]{1,48}$') and "satusehat_links"."reconcile_rounds" >= 0 and "satusehat_links"."retries" >= 0
      and ("satusehat_links"."status" <> 'confirmed' or ("satusehat_links"."remote_id" is not null and "satusehat_links"."confirmed_revision" = "satusehat_links"."current_revision"))
      and (("satusehat_links"."status" in ('held','exception','failed','withdrawal_pending')) = ("satusehat_links"."status_reason" is not null))
      and ("satusehat_links"."sent_refs" is null or jsonb_typeof("satusehat_links"."sent_refs") = 'array'))
);
--> statement-breakpoint
CREATE TABLE "satusehat_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"exam_version_id" uuid NOT NULL,
	"kind" text DEFAULT 'revision' NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"hold_reason" text,
	"lease_gen" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "satusehat_outbox_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_outbox_check" CHECK ("satusehat_outbox"."state" in ('queued','held','leased','done','superseded') and "satusehat_outbox"."kind" in ('revision','resend') and "satusehat_outbox"."revision" >= 1
      and "satusehat_outbox"."lease_gen" >= 0 and "satusehat_outbox"."attempts" >= 0 and (("satusehat_outbox"."state" = 'held') = ("satusehat_outbox"."hold_reason" is not null))
      and ("satusehat_outbox"."hold_reason" is null or "satusehat_outbox"."hold_reason" ~ '^[a-z][a-z0-9_]{1,48}$') and (("satusehat_outbox"."state" = 'leased') = ("satusehat_outbox"."lease_until" is not null))
      and (("satusehat_outbox"."state" in ('done','superseded')) = ("satusehat_outbox"."finished_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "satusehat_patient_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"ihs_patient_id" text,
	"evidence" text,
	"decided_by" uuid,
	"decided_as" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "satusehat_patient_identity_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_patient_identity_check" CHECK ("satusehat_patient_identity"."state" in ('matched','review','resolved_manual','unresolvable') and ("satusehat_patient_identity"."reason" is null or "satusehat_patient_identity"."reason" ~ '^[a-z][a-z0-9_]{1,48}$')
      and ("satusehat_patient_identity"."ihs_patient_id" is null or "satusehat_patient_identity"."ihs_patient_id" ~ '^[A-Za-z0-9-]{3,64}$') and ("satusehat_patient_identity"."evidence" is null or length(btrim("satusehat_patient_identity"."evidence")) between 3 and 300)
      and (("satusehat_patient_identity"."state" in ('matched','resolved_manual')) = ("satusehat_patient_identity"."ihs_patient_id" is not null))
      and (("satusehat_patient_identity"."state" = 'review') = ("satusehat_patient_identity"."reason" is not null))
      and (("satusehat_patient_identity"."state" in ('resolved_manual','unresolvable')) = ("satusehat_patient_identity"."decided_by" is not null and "satusehat_patient_identity"."evidence" is not null))
      and (("satusehat_patient_identity"."decided_by" is null) = ("satusehat_patient_identity"."decided_as" is null)))
);
--> statement-breakpoint
CREATE TABLE "satusehat_practitioner_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"ihs_practitioner_id" text NOT NULL,
	"source" text NOT NULL,
	"command_key" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_as" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "satusehat_practitioner_links_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_practitioner_links_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "satusehat_practitioner_links_check" CHECK ("satusehat_practitioner_links"."ihs_practitioner_id" ~ '^[A-Za-z0-9-]{3,64}$' and "satusehat_practitioner_links"."source" in ('lookup','manual') and "satusehat_practitioner_links"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "satusehat_practitioner_links"."recorded_as" in ('owner','facility_head'))
);
--> statement-breakpoint
CREATE TABLE "satusehat_visit_context" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_staff_id" uuid NOT NULL,
	"room_id" uuid,
	"room_set_by" uuid,
	"arrived_at" timestamp with time zone NOT NULL,
	"in_progress_at" timestamp with time zone NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "satusehat_visit_context_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_visit_context_key" UNIQUE("tenant_id","visit_id")
);
--> statement-breakpoint
ALTER TABLE "satusehat_attempts" ADD CONSTRAINT "satusehat_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_attempts" ADD CONSTRAINT "satusehat_attempts_link_fk" FOREIGN KEY ("tenant_id","link_id") REFERENCES "public"."satusehat_links"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_attempts" ADD CONSTRAINT "satusehat_attempts_outbox_fk" FOREIGN KEY ("tenant_id","outbox_id") REFERENCES "public"."satusehat_outbox"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_code_maps" ADD CONSTRAINT "satusehat_code_maps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_code_maps" ADD CONSTRAINT "satusehat_code_maps_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_code_maps" ADD CONSTRAINT "satusehat_code_maps_by_fk" FOREIGN KEY ("tenant_id","mapped_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_credentials" ADD CONSTRAINT "satusehat_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_credentials" ADD CONSTRAINT "satusehat_credentials_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_credentials" ADD CONSTRAINT "satusehat_credentials_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_errors" ADD CONSTRAINT "satusehat_errors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_errors" ADD CONSTRAINT "satusehat_errors_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_errors" ADD CONSTRAINT "satusehat_errors_attempt_fk" FOREIGN KEY ("tenant_id","attempt_id") REFERENCES "public"."satusehat_attempts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_link_revisions" ADD CONSTRAINT "satusehat_link_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_link_revisions" ADD CONSTRAINT "satusehat_link_revisions_link_fk" FOREIGN KEY ("tenant_id","link_id") REFERENCES "public"."satusehat_links"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_link_revisions" ADD CONSTRAINT "satusehat_link_revisions_version_fk" FOREIGN KEY ("tenant_id","exam_version_id") REFERENCES "public"."record_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_links" ADD CONSTRAINT "satusehat_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_links" ADD CONSTRAINT "satusehat_links_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_outbox" ADD CONSTRAINT "satusehat_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_outbox" ADD CONSTRAINT "satusehat_outbox_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_outbox" ADD CONSTRAINT "satusehat_outbox_version_fk" FOREIGN KEY ("tenant_id","exam_version_id") REFERENCES "public"."record_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_patient_identity" ADD CONSTRAINT "satusehat_patient_identity_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_patient_identity" ADD CONSTRAINT "satusehat_patient_identity_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_patient_identity" ADD CONSTRAINT "satusehat_patient_identity_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_practitioner_links" ADD CONSTRAINT "satusehat_practitioner_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_practitioner_links" ADD CONSTRAINT "satusehat_practitioner_links_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_practitioner_links" ADD CONSTRAINT "satusehat_practitioner_links_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_visit_context" ADD CONSTRAINT "satusehat_visit_context_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_visit_context" ADD CONSTRAINT "satusehat_visit_context_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_visit_context" ADD CONSTRAINT "satusehat_visit_context_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_visit_context" ADD CONSTRAINT "satusehat_visit_context_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_visit_context" ADD CONSTRAINT "satusehat_visit_context_doctor_fk" FOREIGN KEY ("tenant_id","doctor_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_visit_context" ADD CONSTRAINT "satusehat_visit_context_room_fk" FOREIGN KEY ("tenant_id","branch_id","room_id") REFERENCES "public"."rooms"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_visit_context" ADD CONSTRAINT "satusehat_visit_context_room_by_fk" FOREIGN KEY ("tenant_id","room_set_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "satusehat_attempts_link_idx" ON "satusehat_attempts" USING btree ("tenant_id","link_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "satusehat_code_maps_current" ON "satusehat_code_maps" USING btree ("tenant_id","item_id","kind") WHERE "satusehat_code_maps"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "satusehat_code_systems_field_key" ON "satusehat_code_systems" USING btree ("local_field") WHERE "satusehat_code_systems"."local_field" is not null and "satusehat_code_systems"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "satusehat_credentials_one_active" ON "satusehat_credentials" USING btree ("tenant_id","branch_id","environment") WHERE "satusehat_credentials"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "satusehat_links_branch_idx" ON "satusehat_links" USING btree ("tenant_id","branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "satusehat_outbox_one_lease" ON "satusehat_outbox" USING btree ("tenant_id","visit_id") WHERE "satusehat_outbox"."state" = 'leased';--> statement-breakpoint
CREATE UNIQUE INDEX "satusehat_outbox_one_revision" ON "satusehat_outbox" USING btree ("tenant_id","visit_id","revision") WHERE "satusehat_outbox"."kind" = 'revision';--> statement-breakpoint
CREATE INDEX "satusehat_outbox_due_idx" ON "satusehat_outbox" USING btree ("state","next_at");--> statement-breakpoint
CREATE UNIQUE INDEX "satusehat_patient_identity_current" ON "satusehat_patient_identity" USING btree ("tenant_id","patient_id") WHERE "satusehat_patient_identity"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "satusehat_practitioner_links_current" ON "satusehat_practitioner_links" USING btree ("tenant_id","staff_id") WHERE "satusehat_practitioner_links"."ended_at" is null;--> statement-breakpoint

-- T-102 rules (generated by gen.py; plan docs/tasks/T-102.md)
-- ── T-102 helpers, guards, RLS (plan r4 §1–§7; Q-19: docs/tasks/T-102.md) ──────────────────────────────────────────────────────────

-- The SATUSEHAT environment of this transaction: production unless the server bound a non-production deploy env (fail closed, as
-- payment_deploy_env, 0088).
CREATE FUNCTION public.satusehat_env() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN current_setting('app.deploy_env', true) IN ('staging','demo','local') THEN 'sandbox' ELSE 'production' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_env() FROM PUBLIC;--> statement-breakpoint

-- A worker function refuses a bound connection (as outbound_claim).
CREATE FUNCTION public.satusehat_unbound() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'satusehat worker functions run on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_unbound() FROM PUBLIC;--> statement-breakpoint

-- The bound actor with one of p_roles (the tenant-wide staff_access lock first, DEC-043).
CREATE FUNCTION public.satusehat_actor(p_roles text[]) RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role, x.branch_id INTO a FROM public.tenant_actor_lock() x;
  IF NOT a.role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not do this in SATUSEHAT' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_actor(text[]) FROM PUBLIC;--> statement-breakpoint

-- A branch of the bound tenant the actor may act on (its grant, and its active branch when one is set).
CREATE FUNCTION public.satusehat_branch(a record, p_branch uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = p_branch)
     OR NOT public.app_branch_allowed(p_branch) OR (a.branch_id IS NOT NULL AND a.branch_id <> p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_branch(record, uuid) FROM PUBLIC;--> statement-breakpoint

-- An event row (ids and codes only, TD-50) on an unbound or bound connection.
CREATE FUNCTION public.satusehat_event(p_tenant uuid, p_branch uuid, p_type text, p_kind text, p_id uuid, p jsonb) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (p_tenant, p_branch, p_type, p_kind, p_id, public.app_staff_id(), public.app_acting_role(), clock_timestamp(), p)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_event(uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint

-- Guards (plan §4): nothing is ever deleted; identities frozen; the link and outbox transition tables enforced here for every writer.
CREATE FUNCTION public.satusehat_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb;
  n jsonb;
  ob jsonb;
  nb jsonb;
  k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: % rows are never deleted', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  -- fields are read through jsonb: plpgsql resolves NEW.<field> even in a branch for another table
  n := to_jsonb(NEW);
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'satusehat_attempts' AND n ->> 'outcome' IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: an attempt starts open' USING ERRCODE = '22023';
    END IF;
    IF TG_TABLE_NAME = 'satusehat_outbox' AND n ->> 'state' NOT IN ('queued','held') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: an outbox item starts queued or held' USING ERRCODE = '22023';
    END IF;
    IF TG_TABLE_NAME = 'satusehat_links' AND n ->> 'status' NOT IN ('queued','held','exception') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: a link starts queued, held or exception' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  o := to_jsonb(OLD);
  ob := o;
  nb := n;
  -- the columns each table may change; everything else is frozen
  FOREACH k IN ARRAY CASE TG_TABLE_NAME
      WHEN 'satusehat_credentials' THEN ARRAY['revoked_at']
      WHEN 'satusehat_visit_context' THEN ARRAY['room_id','room_set_by']
      WHEN 'satusehat_outbox' THEN ARRAY['state','hold_reason','lease_gen','lease_until','attempts','next_at','finished_at']
      WHEN 'satusehat_links' THEN ARRAY['remote_id','status','status_reason','current_revision','confirmed_revision','check_after','reconcile_rounds',
                                         'next_at','retries','sent_refs','updated_at']
      WHEN 'satusehat_attempts' THEN ARRAY['outcome','http_status','remote_id','remote_version','error_code','error_path','finished_at']
      WHEN 'satusehat_patient_identity' THEN ARRAY['is_current']
      WHEN 'satusehat_practitioner_links' THEN ARRAY['ended_at']
      WHEN 'satusehat_code_maps' THEN ARRAY['effective_to']
      WHEN 'satusehat_code_systems' THEN ARRAY['validated','effective_to']
      ELSE ARRAY[]::text[] END LOOP
    o := o - k;
    n := n - k;
  END LOOP;
  IF o <> n THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: % identity is frozen', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  o := ob;
  n := nb;
  IF TG_TABLE_NAME = 'satusehat_credentials' AND (o ->> 'revoked_at') IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a revoked credential is final' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'satusehat_visit_context' AND (o ->> 'room_id') IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the reporting room is set once' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'satusehat_attempts' AND (o ->> 'outcome') IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a finished attempt is final' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'satusehat_patient_identity' AND (NOT (o ->> 'is_current')::boolean OR (n ->> 'is_current')::boolean) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an identity decision is only superseded' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME IN ('satusehat_practitioner_links') AND (o ->> 'ended_at') IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an ended link is final' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME IN ('satusehat_code_maps','satusehat_code_systems') AND (o ->> 'effective_to') IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an ended mapping is final' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'satusehat_code_systems' AND (o ->> 'validated')::boolean AND NOT (n ->> 'validated')::boolean THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: validation is never withdrawn in place' USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'satusehat_outbox' AND (o ->> 'state') IS DISTINCT FROM (n ->> 'state') AND NOT (
          (o ->> 'state') = 'queued' AND (n ->> 'state') IN ('leased','held','superseded')
       OR (o ->> 'state') = 'leased' AND (n ->> 'state') IN ('queued','done','held')
       OR (o ->> 'state') = 'held' AND (n ->> 'state') = 'superseded') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: outbox % -> %', (o ->> 'state'), (n ->> 'state') USING ERRCODE = '40001';
  ELSIF TG_TABLE_NAME = 'satusehat_links' THEN
    IF (o ->> 'status') IS DISTINCT FROM (n ->> 'status') AND NOT (
          (o ->> 'status') = 'queued' AND (n ->> 'status') IN ('held','sending','exception','withdrawal_pending')
       OR (o ->> 'status') = 'held' AND (n ->> 'status') IN ('queued','exception','withdrawal_pending')
       OR (o ->> 'status') = 'sending' AND (n ->> 'status') IN ('confirmed','queued','failed','outcome_unknown')
       OR (o ->> 'status') = 'outcome_unknown' AND (n ->> 'status') IN ('confirmed','queued','exception')
       OR (o ->> 'status') = 'confirmed' AND (n ->> 'status') IN ('queued','withdrawal_pending','exception')
       OR (o ->> 'status') IN ('failed','exception') AND (n ->> 'status') = 'queued') THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: link % -> %', (o ->> 'status'), (n ->> 'status') USING ERRCODE = '40001';
    END IF;
    -- the remote id is learnt once; only a manual re-create of an unresolved create clears it (plan §5)
    IF (o ->> 'remote_id') IS NOT NULL AND (n ->> 'remote_id') IS DISTINCT FROM (o ->> 'remote_id')
       AND NOT ((o ->> 'status') = 'exception' AND (o ->> 'status_reason') = 'reconcile_unresolved' AND (n ->> 'status') = 'queued' AND (n ->> 'remote_id') IS NULL) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: a remote id is never replaced' USING ERRCODE = '42501';
    END IF;
    IF (n ->> 'current_revision')::integer < (o ->> 'current_revision')::integer OR (n ->> 'confirmed_revision')::integer < (o ->> 'confirmed_revision')::integer THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: revisions only move forward' USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER satusehat_credentials_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_credentials FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_visit_context_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_visit_context FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_outbox_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_outbox FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_links_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_links FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_link_revisions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_link_revisions FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_attempts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_attempts FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_errors_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_errors FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_patient_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_patient_identity FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_practitioner_links_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_practitioner_links FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_code_systems_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_code_systems FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
CREATE TRIGGER satusehat_code_maps_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_code_maps FOR EACH ROW EXECUTE FUNCTION public.satusehat_guard();--> statement-breakpoint
ALTER TABLE public.satusehat_credentials ENABLE ALWAYS TRIGGER satusehat_credentials_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_visit_context ENABLE ALWAYS TRIGGER satusehat_visit_context_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_outbox ENABLE ALWAYS TRIGGER satusehat_outbox_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_links ENABLE ALWAYS TRIGGER satusehat_links_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_link_revisions ENABLE ALWAYS TRIGGER satusehat_link_revisions_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_attempts ENABLE ALWAYS TRIGGER satusehat_attempts_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_errors ENABLE ALWAYS TRIGGER satusehat_errors_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_patient_identity ENABLE ALWAYS TRIGGER satusehat_patient_identity_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_practitioner_links ENABLE ALWAYS TRIGGER satusehat_practitioner_links_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_code_systems ENABLE ALWAYS TRIGGER satusehat_code_systems_guard;--> statement-breakpoint
ALTER TABLE public.satusehat_code_maps ENABLE ALWAYS TRIGGER satusehat_code_maps_guard;--> statement-breakpoint
CREATE TRIGGER satusehat_credentials_no_truncate BEFORE TRUNCATE ON public.satusehat_credentials FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_visit_context_no_truncate BEFORE TRUNCATE ON public.satusehat_visit_context FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_outbox_no_truncate BEFORE TRUNCATE ON public.satusehat_outbox FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_links_no_truncate BEFORE TRUNCATE ON public.satusehat_links FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_link_revisions_no_truncate BEFORE TRUNCATE ON public.satusehat_link_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_attempts_no_truncate BEFORE TRUNCATE ON public.satusehat_attempts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_errors_no_truncate BEFORE TRUNCATE ON public.satusehat_errors FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_patient_identity_no_truncate BEFORE TRUNCATE ON public.satusehat_patient_identity FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_practitioner_links_no_truncate BEFORE TRUNCATE ON public.satusehat_practitioner_links FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_code_systems_no_truncate BEFORE TRUNCATE ON public.satusehat_code_systems FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER satusehat_code_maps_no_truncate BEFORE TRUNCATE ON public.satusehat_code_maps FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- ── T-102 RLS, scope map, support classes, notification type, terminology seed ─────────────────────────────────────────────────────
-- Every SATUSEHAT table is read only through the definers below (monitor, exceptions, identity queue, my records); none is granted to
-- clinic_app or clinic_operator, so RLS is on with no policy (deny by default, TEN-16). Vendor support never reaches them (class never).
ALTER TABLE public.satusehat_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_visit_context ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_outbox ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_link_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_errors ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_patient_identity ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_practitioner_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_code_systems ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.satusehat_code_maps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.satusehat_credentials', 'tenant-shared', 'integrations', '{}', 'satusehat_credential_set / _revoke (src/modules/integrations/satusehat); the secret only to the worker', 'the credential''s branch'),
  ('public.satusehat_visit_context', 'clinical', 'integrations', '{}', 'record_versions trigger satusehat_on_record_version; satusehat_context_room_set', 'the visit''s branch'),
  ('public.satusehat_outbox', 'branch-scoped', 'integrations', '{}', 'satusehat_on_record_version, satusehat_resend, satusehat worker functions', 'the visit''s branch'),
  ('public.satusehat_links', 'branch-scoped', 'integrations', '{}', 'satusehat worker functions', 'the visit''s branch'),
  ('public.satusehat_link_revisions', 'clinical', 'integrations', '{}', 'satusehat worker functions (materializer)', 'the link''s visit branch'),
  ('public.satusehat_attempts', 'branch-scoped', 'integrations', '{}', 'satusehat worker functions (append-only)', 'the link''s visit branch'),
  ('public.satusehat_errors', 'clinical', 'integrations', '{}', 'satusehat worker functions; the body only to clinical roles through satusehat_error_body', 'the error''s branch'),
  ('public.satusehat_patient_identity', 'tenant-shared', 'integrations', '{}', 'satusehat worker functions, satusehat_identity_resolve', 'none (per patient)'),
  ('public.satusehat_practitioner_links', 'tenant-shared', 'integrations', '{}', 'satusehat_practitioner_link_set', 'none (per staff)'),
  ('public.satusehat_code_systems', 'platform', 'integrations', '{}', 'migration seed (vendor-maintained); read by the materializer', 'none'),
  ('public.satusehat_code_maps', 'tenant-shared', 'integrations', '{}', 'satusehat_code_map_set', 'none (per catalog item)');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.satusehat_credentials', 'never'), ('public.satusehat_visit_context', 'never'), ('public.satusehat_outbox', 'never'),
  ('public.satusehat_links', 'never'), ('public.satusehat_link_revisions', 'never'), ('public.satusehat_attempts', 'never'),
  ('public.satusehat_errors', 'never'), ('public.satusehat_patient_identity', 'never'), ('public.satusehat_practitioner_links', 'never'),
  ('public.satusehat_code_systems', 'never'), ('public.satusehat_code_maps', 'never');--> statement-breakpoint
-- The reconciliation task after an IHS id change (TD-31): to the branch's records officer and facility head (raised by the server).
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('satusehat_ihs_changed', 'Nomor IHS pasien berubah setelah data terkirim', '{records_officer,facility_head}', '{patient}', false);--> statement-breakpoint

-- Terminology register seed (plan §2; Q-19 "Terminology"): the guide's Standar Terminologi v12.0 (2026-10-31) is the release reference. ICD-10
-- is a whole-system row (the doctor's validated ICD-10 code is used as is). Vitals: LOINC 8867-4 is the guide's own example; the others are
-- standard vital-sign codes to confirm in sandbox. All rows start unvalidated (production holds them until the owner-gated sandbox step).
INSERT INTO public.satusehat_code_systems (kind, system_uri, code, display, local_field, release_ref, provenance_url, effective_from) VALUES
  ('icd10', 'http://hl7.org/fhir/sid/icd-10', '*', 'ICD-10 (kode diagnosis dokter)', NULL, 'SATUSEHAT Standar Terminologi v12.0 (2026-10-31)',
   'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/condition/', '2026-11-17'),
  ('loinc', 'http://loinc.org', '8480-6', 'Systolic blood pressure', 'td_sistolik', 'SATUSEHAT Standar Terminologi v12.0 (2026-10-31)',
   'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/observation/', '2026-11-17'),
  ('loinc', 'http://loinc.org', '8462-4', 'Diastolic blood pressure', 'td_diastolik', 'SATUSEHAT Standar Terminologi v12.0 (2026-10-31)',
   'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/observation/', '2026-11-17'),
  ('loinc', 'http://loinc.org', '8867-4', 'Heart rate', 'nadi', 'SATUSEHAT Standar Terminologi v12.0 (2026-10-31)',
   'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/observation/', '2026-11-17'),
  ('loinc', 'http://loinc.org', '8310-5', 'Body temperature', 'suhu_c10', 'SATUSEHAT Standar Terminologi v12.0 (2026-10-31)',
   'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/observation/', '2026-11-17'),
  ('loinc', 'http://loinc.org', '29463-7', 'Body weight', 'berat_kg', 'SATUSEHAT Standar Terminologi v12.0 (2026-10-31)',
   'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/observation/', '2026-11-17');--> statement-breakpoint

-- ── T-102 enqueue at signing (plan §1; PR-35 "outages never block local care") ─────────────────────────────────────────────────────
-- AFTER INSERT on record_versions: the original version snapshots the reporting context (room as called at signing — later re-calls do not
-- change it; arrival = check-in; in progress = the examination opened) and adds revision 1; a correction adds revision n+1 pinned to its
-- version (the worker's claim supersedes older items not yet leased — review r1 P1-1: the trigger only inserts). Plain inserts with ON CONFLICT
-- DO NOTHING: no check that can fail on SATUSEHAT-side data; no external call. The outbox item stays queued until the visit closes (the worker reads closed_at).
CREATE FUNCTION public.satusehat_on_record_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.examinations;
  v_rev integer;
BEGIN
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.examination_id;
  IF NEW.kind = 'original' THEN
    INSERT INTO public.satusehat_visit_context (tenant_id, branch_id, visit_id, examination_id, patient_id, doctor_staff_id, room_id, arrived_at,
                                                in_progress_at, signed_at)
    SELECT e.tenant_id, e.branch_id, e.visit_id, e.id, e.patient_id, e.author_id,
           (SELECT q.room_id FROM public.queue_tickets q WHERE q.tenant_id = e.tenant_id AND q.visit_id = e.visit_id),
           v.checked_in_at, e.created_at, coalesce(e.signed_at, NEW.created_at)
      FROM public.visits v WHERE v.tenant_id = e.tenant_id AND v.id = e.visit_id
    ON CONFLICT DO NOTHING;
  END IF;
  v_rev := NEW.version;
  INSERT INTO public.satusehat_outbox (tenant_id, branch_id, visit_id, revision, exam_version_id)
  VALUES (e.tenant_id, e.branch_id, e.visit_id, v_rev, NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_on_record_version() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER satusehat_on_record_version AFTER INSERT ON public.record_versions FOR EACH ROW EXECUTE FUNCTION public.satusehat_on_record_version();--> statement-breakpoint
ALTER TABLE public.record_versions ENABLE ALWAYS TRIGGER satusehat_on_record_version;--> statement-breakpoint

-- ── T-102 worker (plan §3–§7): claim with lease, prepare (facility context, identity, materialize + pin), fenced attempts, release ─────
-- All unbound (satusehat_unbound). The TS worker does the HTTP calls between these functions; SQL owns every state transition.

-- A visit's context and reasons it may not be sent now (plan §6 invariant), as of p_now; also the active credential.
CREATE FUNCTION public.satusehat_hold_reason(p_tenant uuid, p_visit uuid, p_env text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.satusehat_visit_context;
  v_org text;
  cr public.satusehat_credentials;
  v_loc text;
BEGIN
  SELECT * INTO c FROM public.satusehat_visit_context x WHERE x.tenant_id = p_tenant AND x.visit_id = p_visit;
  IF c.visit_id IS NULL THEN RETURN 'facility_context'; END IF;
  SELECT b.satusehat_org_id INTO v_org FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = c.branch_id;
  SELECT * INTO cr FROM public.satusehat_credentials x
   WHERE x.tenant_id = p_tenant AND x.branch_id = c.branch_id AND x.environment = p_env AND x.revoked_at IS NULL;
  IF cr.id IS NULL THEN RETURN 'credentials_missing'; END IF;
  IF v_org IS NULL OR cr.organization_id <> v_org THEN RETURN 'facility_context'; END IF;
  IF c.room_id IS NULL THEN RETURN 'no_room'; END IF;
  SELECT r.satusehat_location_id INTO v_loc FROM public.rooms r WHERE r.tenant_id = p_tenant AND r.branch_id = c.branch_id AND r.id = c.room_id;
  IF v_loc IS NULL THEN RETURN 'location_missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.rooms r WHERE r.tenant_id = p_tenant AND r.branch_id <> c.branch_id AND r.satusehat_location_id = v_loc) THEN
    RETURN 'location_conflict';
  END IF;
  -- credential_valid reads the bound tenant: bind it for this check only (precedent 0038 tenant_lifecycle_set)
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  IF NOT public.credential_valid(c.doctor_staff_id, c.branch_id, c.signed_at) THEN
    PERFORM set_config('app.tenant_id', '', true);
    RETURN 'practitioner_credential';
  END IF;
  PERFORM set_config('app.tenant_id', '', true);
  IF NOT EXISTS (SELECT 1 FROM public.satusehat_practitioner_links l WHERE l.tenant_id = p_tenant AND l.staff_id = c.doctor_staff_id AND l.ended_at IS NULL) THEN
    RETURN 'practitioner_unresolved';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_hold_reason(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Hold an item (and audit it as an event: ids and codes only).
CREATE FUNCTION public.satusehat_hold(o public.satusehat_outbox, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.satusehat_outbox SET state = 'held', hold_reason = p_reason, lease_until = NULL WHERE tenant_id = o.tenant_id AND id = o.id;
  PERFORM public.satusehat_event(o.tenant_id, o.branch_id, 'SatusehatHeld', 'satusehat_outbox', o.id,
    jsonb_build_object('outbox_id', o.id, 'visit_id', o.visit_id, 'reason', p_reason));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_hold(public.satusehat_outbox, text) FROM PUBLIC;--> statement-breakpoint

-- Requeue held work as a new resend item (plan §4: a held item is superseded, never reopened).
CREATE FUNCTION public.satusehat_requeue(p_tenant uuid, p_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o public.satusehat_outbox;
  v_id uuid;
BEGIN
  SELECT * INTO o FROM public.satusehat_outbox x WHERE x.tenant_id = p_tenant AND x.id = p_id FOR UPDATE;
  IF o.state = 'held' THEN
    UPDATE public.satusehat_outbox SET state = 'superseded', finished_at = clock_timestamp(), hold_reason = NULL WHERE tenant_id = o.tenant_id AND id = o.id;
  END IF;
  INSERT INTO public.satusehat_outbox (tenant_id, branch_id, visit_id, revision, exam_version_id, kind)
  VALUES (o.tenant_id, o.branch_id, o.visit_id, o.revision, o.exam_version_id, 'resend') RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_requeue(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Claim (plan §3): first recover expired leases (in-flight writes become outcome_unknown — a crash after a possible remote commit), then
-- lease due items of closed visits whose tenant may still report (satusehat_outbox capability: live and suspended, TEN-12), one per visit.
CREATE FUNCTION public.satusehat_claim(p_now timestamptz DEFAULT NULL, p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  o public.satusehat_outbox;
  v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.satusehat_unbound();
  -- an item not yet leased is superseded by a newer revision of the same visit (review r1 P1-1: here, not in the signing trigger); a held one
  -- loses its reason with its state (the outbox CHECK); rows another claimant holds are skipped, never waited on
  UPDATE public.satusehat_outbox x SET state = 'superseded', hold_reason = NULL, finished_at = v_now
   WHERE x.id IN (SELECT y.id FROM public.satusehat_outbox y WHERE y.state IN ('queued','held')
                    AND EXISTS (SELECT 1 FROM public.satusehat_outbox z WHERE z.tenant_id = y.tenant_id AND z.visit_id = y.visit_id AND z.revision > y.revision)
                  FOR UPDATE SKIP LOCKED);
  FOR o IN SELECT * FROM public.satusehat_outbox x WHERE x.state = 'leased' AND x.lease_until <= v_now FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.satusehat_links SET status = 'outcome_unknown', check_after = v_now, reconcile_rounds = 0, updated_at = v_now
     WHERE tenant_id = o.tenant_id AND visit_id = o.visit_id AND status = 'sending';
    -- the dead worker's open attempts: no answer was recorded (the write may have committed)
    UPDATE public.satusehat_attempts SET outcome = 'lost', finished_at = v_now WHERE tenant_id = o.tenant_id AND outbox_id = o.id AND outcome IS NULL;
    UPDATE public.satusehat_outbox SET state = 'queued', lease_until = NULL, next_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
  END LOOP;
  FOR o IN SELECT x.* FROM public.satusehat_outbox x
             JOIN public.visits v ON v.tenant_id = x.tenant_id AND v.id = x.visit_id AND v.closed_at IS NOT NULL
             JOIN public.tenants_registry tr ON tr.id = x.tenant_id AND tr.lifecycle_state IN ('live','suspended')
            WHERE x.state = 'queued' AND x.next_at <= v_now
              AND NOT EXISTS (SELECT 1 FROM public.satusehat_outbox l WHERE l.tenant_id = x.tenant_id AND l.visit_id = x.visit_id AND l.state = 'leased')
            ORDER BY x.next_at, x.id LIMIT p_limit FOR UPDATE OF x SKIP LOCKED LOOP
    -- one claimant per visit (review r1 P2-4): SKIP LOCKED guards rows, not visits; a visit another claimant is taking is skipped
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('satusehat_visit:' || o.tenant_id::text || o.visit_id::text, 0));
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.satusehat_outbox l WHERE l.tenant_id = o.tenant_id AND l.visit_id = o.visit_id AND l.state = 'leased');
    UPDATE public.satusehat_outbox SET state = 'leased', lease_gen = lease_gen + 1, lease_until = v_now + interval '5 minutes', attempts = attempts + 1
     WHERE tenant_id = o.tenant_id AND id = o.id;
    v_out := v_out || jsonb_build_object('id', o.id, 'gen', o.lease_gen + 1, 'tenant_id', o.tenant_id);
  END LOOP;
  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_claim(timestamptz, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_claim(timestamptz, integer) TO clinic_app;--> statement-breakpoint

-- The fence (plan §3): the item is still leased with this generation and the lease has not run out.
CREATE FUNCTION public.satusehat_fenced(p_item uuid, p_gen integer, p_now timestamptz) RETURNS public.satusehat_outbox
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o public.satusehat_outbox;
BEGIN
  SELECT * INTO o FROM public.satusehat_outbox x WHERE x.id = p_item FOR UPDATE;
  IF o.id IS NULL OR o.state <> 'leased' OR o.lease_gen <> p_gen OR o.lease_until <= p_now THEN
    RETURN NULL;
  END IF;
  RETURN o;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_fenced(uuid, integer, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Materialize the links of a revision (plan §2): the Encounter, one Condition per ICD-10 code of the pinned version; pin what each was built
-- from (code, system, register row, organization) with a fingerprint; an unchanged confirmed link moves to the revision without sending; a
-- changed one is queued for an update; a Condition whose code left the record is withdrawal_pending; a link created under another
-- organization becomes an exception (plan §6).
CREATE FUNCTION public.satusehat_materialize(o public.satusehat_outbox, p_env text, p_org text, p_ctx jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  rv public.record_versions;
  r record;
  l public.satusehat_links;
  v_fp text;
  v_reg uuid;
  v_valid boolean;
BEGIN
  SELECT * INTO rv FROM public.record_versions x WHERE x.tenant_id = o.tenant_id AND x.id = o.exam_version_id;
  SELECT s.id INTO v_reg FROM public.satusehat_code_systems s WHERE s.kind = 'icd10' AND s.code = '*' AND s.effective_to IS NULL;
  FOR r IN
    -- every value a body is built from is pinned here (review r1 P1-3): the worker builds bodies from this, never from the current packet
    SELECT 'Encounter'::text AS fhir_type, 'visit'::text AS local_key,
           jsonb_build_object('visit_id', o.visit_id, 'class', 'AMB', 'organization', p_org) || p_ctx AS m
    UNION ALL
    SELECT 'Condition', 'exam:' || c, jsonb_build_object('code', c, 'system', 'http://hl7.org/fhir/sid/icd-10', 'register_id', v_reg, 'rank', ord,
           'organization', p_org, 'patient_ihs', p_ctx ->> 'patient_ihs', 'visit_id', o.visit_id)
      FROM jsonb_array_elements_text(rv.content -> 'icd10_codes') WITH ORDINALITY AS t(c, ord)
  LOOP
    -- the rank lives in the Encounter's diagnosis list, not in the Condition: it is pinned but not part of the Condition's content
    v_fp := encode(sha256(convert_to((r.m - 'rank')::text, 'UTF8')), 'hex');
    SELECT * INTO l FROM public.satusehat_links x
     WHERE x.tenant_id = o.tenant_id AND x.environment = p_env AND x.fhir_type = r.fhir_type AND x.visit_id = o.visit_id AND x.local_key = r.local_key FOR UPDATE;
    IF l.id IS NULL THEN
      INSERT INTO public.satusehat_links (tenant_id, branch_id, environment, visit_id, fhir_type, local_key, organization_id, current_revision)
      VALUES (o.tenant_id, o.branch_id, p_env, o.visit_id, r.fhir_type, r.local_key, p_org, o.revision) RETURNING * INTO l;
    ELSIF l.current_revision < o.revision THEN
      IF l.status = 'confirmed' AND v_fp = (SELECT lr.fingerprint FROM public.satusehat_link_revisions lr
                                              WHERE lr.tenant_id = l.tenant_id AND lr.link_id = l.id AND lr.revision = l.confirmed_revision) THEN
        UPDATE public.satusehat_links SET current_revision = o.revision, confirmed_revision = o.revision, updated_at = clock_timestamp()
         WHERE tenant_id = l.tenant_id AND id = l.id;
      ELSIF l.status IN ('confirmed','held','queued') THEN
        UPDATE public.satusehat_links SET current_revision = o.revision, status = 'queued', status_reason = NULL, next_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE tenant_id = l.tenant_id AND id = l.id;
      ELSE
        -- failed / exception / outcome_unknown: the barrier holds; the revision moves forward and waits behind it
        UPDATE public.satusehat_links SET current_revision = o.revision, updated_at = clock_timestamp() WHERE tenant_id = l.tenant_id AND id = l.id;
      END IF;
    END IF;
    INSERT INTO public.satusehat_link_revisions (tenant_id, link_id, revision, exam_version_id, materialized, fingerprint, organization_id)
    VALUES (o.tenant_id, l.id, o.revision, o.exam_version_id, r.m, v_fp, p_org) ON CONFLICT DO NOTHING;
    -- production sends only validated terminology (plan §2). Both the hold and its release read the register row PINNED for the link's current
    -- revision (stored at its first materialization; ON CONFLICT keeps it) — never the currently active row (review r2 P2-2).
    IF r.fhir_type = 'Condition' THEN
      SELECT coalesce(s.validated, false) INTO v_valid FROM public.satusehat_link_revisions lr
        LEFT JOIN public.satusehat_code_systems s ON s.id = (lr.materialized ->> 'register_id')::uuid
       WHERE lr.tenant_id = l.tenant_id AND lr.link_id = l.id
         AND lr.revision = (SELECT x.current_revision FROM public.satusehat_links x WHERE x.tenant_id = l.tenant_id AND x.id = l.id);
      IF p_env = 'production' AND NOT coalesce(v_valid, false) THEN
        UPDATE public.satusehat_links SET status = 'held', status_reason = 'mapping_unvalidated', updated_at = clock_timestamp()
         WHERE tenant_id = l.tenant_id AND id = l.id AND status = 'queued';
      ELSE
        UPDATE public.satusehat_links SET status = 'queued', status_reason = NULL, next_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE tenant_id = l.tenant_id AND id = l.id AND status = 'held' AND status_reason = 'mapping_unvalidated';
      END IF;
    END IF;
  END LOOP;
  -- a Condition whose code is gone from this revision (no guide rule for withdrawal: manual)
  UPDATE public.satusehat_links x SET status = 'withdrawal_pending', status_reason = 'source_removed', updated_at = clock_timestamp()
   WHERE x.tenant_id = o.tenant_id AND x.environment = p_env AND x.visit_id = o.visit_id AND x.fhir_type = 'Condition' AND x.status IN ('confirmed','queued','held')
     AND x.current_revision < o.revision AND x.remote_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(rv.content -> 'icd10_codes') c WHERE x.local_key = 'exam:' || c);
  UPDATE public.satusehat_links x SET status = 'held', status_reason = 'source_removed', updated_at = clock_timestamp()
   WHERE x.tenant_id = o.tenant_id AND x.environment = p_env AND x.visit_id = o.visit_id AND x.fhir_type = 'Condition' AND x.status = 'queued'
     AND x.current_revision < o.revision AND x.remote_id IS NULL;
  -- organization binding (plan §6, r2 P1-3)
  UPDATE public.satusehat_links x SET status = 'exception', status_reason = 'organization_changed', updated_at = clock_timestamp()
   WHERE x.tenant_id = o.tenant_id AND x.environment = p_env AND x.visit_id = o.visit_id AND x.organization_id <> p_org
     AND x.status IN ('queued','held','confirmed','outcome_unknown');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_materialize(public.satusehat_outbox, text, text, jsonb) FROM PUBLIC;--> statement-breakpoint

-- Prepare one leased item: the facility context, the patient identity, then materialize; returns the work packet for the TS worker (ids,
-- references, the sealed secret and the tenant keys — never decrypted in SQL), or {held}, {stale}, {identity} (a NIK lookup is needed).
CREATE FUNCTION public.satusehat_prepare(p_item uuid, p_gen integer, p_now timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  o public.satusehat_outbox;
  c public.satusehat_visit_context;
  cr public.satusehat_credentials;
  pt public.patients;
  idn public.satusehat_patient_identity;
  v_env text := public.satusehat_env();
  v_reason text;
  v_org text;
  v_patient uuid;
BEGIN
  PERFORM public.satusehat_unbound();
  o := public.satusehat_fenced(p_item, p_gen, v_now);
  IF o.id IS NULL THEN RETURN jsonb_build_object('stale', true); END IF;
  v_reason := public.satusehat_hold_reason(o.tenant_id, o.visit_id, v_env);
  IF v_reason IS NOT NULL THEN
    PERFORM public.satusehat_hold(o, v_reason);
    RETURN jsonb_build_object('held', v_reason);
  END IF;
  SELECT * INTO c FROM public.satusehat_visit_context x WHERE x.tenant_id = o.tenant_id AND x.visit_id = o.visit_id;
  v_patient := public.patient_canonical(o.tenant_id, c.patient_id);
  SELECT * INTO idn FROM public.satusehat_patient_identity x WHERE x.tenant_id = o.tenant_id AND x.patient_id = v_patient AND x.is_current;
  IF idn.id IS NULL THEN
    SELECT * INTO pt FROM public.patients x WHERE x.tenant_id = o.tenant_id AND x.id = v_patient;
    IF pt.identity_type <> 'nik' THEN
      -- passport, KITAS, newborn via guardian: search-only in the guide (Q-19) → review at once, never the guardian's NIK
      INSERT INTO public.satusehat_patient_identity (tenant_id, patient_id, state, reason) VALUES (o.tenant_id, v_patient, 'review', 'no_nik');
      PERFORM public.satusehat_hold(o, 'identity_review');
      RETURN jsonb_build_object('held', 'identity_review');
    END IF;
    RETURN jsonb_build_object('identity', jsonb_build_object('patient_id', v_patient, 'identity_enc', pt.identity_enc),
      'keys', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', k.version, 'wrapped', k.wrapped, 'is_current', k.is_current) ORDER BY k.version), '[]'::jsonb)
                 FROM public.tenant_data_keys k WHERE k.tenant_id = o.tenant_id),
      'credential', (SELECT jsonb_build_object('id', x.id, 'generation', x.generation, 'organization_id', x.organization_id, 'client_id', x.client_id,
                       'secret_enc', x.secret_enc) FROM public.satusehat_credentials x
                      WHERE x.tenant_id = o.tenant_id AND x.branch_id = o.branch_id AND x.environment = v_env AND x.revoked_at IS NULL),
      'environment', v_env, 'branch_id', o.branch_id, 'tenant_id', o.tenant_id);
  END IF;
  IF idn.state NOT IN ('matched','resolved_manual') THEN
    PERFORM public.satusehat_hold(o, 'identity_review');
    RETURN jsonb_build_object('held', 'identity_review');
  END IF;
  SELECT * INTO cr FROM public.satusehat_credentials x WHERE x.tenant_id = o.tenant_id AND x.branch_id = o.branch_id AND x.environment = v_env AND x.revoked_at IS NULL;
  v_org := cr.organization_id;
  PERFORM public.satusehat_materialize(o, v_env, v_org, jsonb_build_object(
    'patient_ihs', idn.ihs_patient_id,
    'practitioner_ihs', (SELECT l.ihs_practitioner_id FROM public.satusehat_practitioner_links l WHERE l.tenant_id = o.tenant_id AND l.staff_id = c.doctor_staff_id AND l.ended_at IS NULL),
    'location_id', (SELECT r.satusehat_location_id FROM public.rooms r WHERE r.tenant_id = o.tenant_id AND r.id = c.room_id),
    'arrived_at', c.arrived_at, 'in_progress_at', c.in_progress_at,
    'finished_at', (SELECT v.closed_at FROM public.visits v WHERE v.tenant_id = o.tenant_id AND v.id = o.visit_id)));
  RETURN jsonb_build_object(
    'tenant_id', o.tenant_id, 'branch_id', o.branch_id, 'visit_id', o.visit_id, 'revision', o.revision, 'environment', v_env,
    'organization_id', v_org,
    'credential', jsonb_build_object('id', cr.id, 'generation', cr.generation, 'organization_id', cr.organization_id, 'client_id', cr.client_id, 'secret_enc', cr.secret_enc),
    'keys', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', k.version, 'wrapped', k.wrapped, 'is_current', k.is_current) ORDER BY k.version), '[]'::jsonb)
               FROM public.tenant_data_keys k WHERE k.tenant_id = o.tenant_id),
    'patient_ihs', idn.ihs_patient_id,
    'practitioner_ihs', (SELECT l.ihs_practitioner_id FROM public.satusehat_practitioner_links l WHERE l.tenant_id = o.tenant_id AND l.staff_id = c.doctor_staff_id AND l.ended_at IS NULL),
    'location_id', (SELECT r.satusehat_location_id FROM public.rooms r WHERE r.tenant_id = o.tenant_id AND r.id = c.room_id),
    'arrived_at', c.arrived_at, 'in_progress_at', c.in_progress_at,
    'finished_at', (SELECT v.closed_at FROM public.visits v WHERE v.tenant_id = o.tenant_id AND v.id = o.visit_id),
    'links', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'fhir_type', l.fhir_type, 'local_key', l.local_key, 'status', l.status,
                'remote_id', l.remote_id, 'check_after', l.check_after, 'next_at', l.next_at, 'sent_refs', l.sent_refs,
                'materialized', (SELECT lr.materialized FROM public.satusehat_link_revisions lr WHERE lr.tenant_id = l.tenant_id AND lr.link_id = l.id AND lr.revision = l.current_revision),
                'previous', (SELECT lr.materialized FROM public.satusehat_link_revisions lr WHERE lr.tenant_id = l.tenant_id AND lr.link_id = l.id AND lr.revision = l.confirmed_revision
                               AND l.confirmed_revision < l.current_revision))
              ORDER BY l.fhir_type <> 'Encounter', l.local_key), '[]'::jsonb)
              FROM public.satusehat_links l WHERE l.tenant_id = o.tenant_id AND l.environment = v_env AND l.visit_id = o.visit_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_prepare(uuid, integer, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_prepare(uuid, integer, timestamptz) TO clinic_app;--> statement-breakpoint

-- A patient NIK lookup result (plan §7): exactly one result whose birth date, gender and normalised name equal the local record → matched;
-- one with any difference → review demographics_conflict; none → not_found; several → ambiguous. Fenced like any work.
CREATE FUNCTION public.satusehat_identity_record(p_item uuid, p_gen integer, p jsonb, p_now timestamptz DEFAULT NULL) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o public.satusehat_outbox;
  c public.satusehat_visit_context;
  pt public.patients;
  v_patient uuid;
  v_state text;
  v_reason text;
  v_norm text := '[^a-z0-9]+';
BEGIN
  PERFORM public.satusehat_unbound();
  o := public.satusehat_fenced(p_item, p_gen, coalesce(p_now, clock_timestamp()));
  IF o.id IS NULL THEN RETURN 'stale'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p ->> 'kind' NOT IN ('one','none','many','error') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: identity result' USING ERRCODE = '22023';
  END IF;
  -- the lookup itself failed (token, 4xx, 5xx, timeout): nothing is decided; the item waits 5 minutes
  IF p ->> 'kind' = 'error' THEN
    UPDATE public.satusehat_outbox SET state = 'queued', lease_until = NULL, next_at = clock_timestamp() + interval '5 minutes' WHERE tenant_id = o.tenant_id AND id = o.id;
    RETURN 'retry';
  END IF;
  SELECT * INTO c FROM public.satusehat_visit_context x WHERE x.tenant_id = o.tenant_id AND x.visit_id = o.visit_id;
  v_patient := public.patient_canonical(o.tenant_id, c.patient_id);
  SELECT * INTO pt FROM public.patients x WHERE x.tenant_id = o.tenant_id AND x.id = v_patient;
  IF p ->> 'kind' = 'none' THEN v_state := 'review'; v_reason := 'not_found';
  ELSIF p ->> 'kind' = 'many' THEN v_state := 'review'; v_reason := 'ambiguous';
  ELSIF (p ->> 'ihs') IS NULL OR (p ->> 'ihs') !~ '^[A-Za-z0-9-]{3,64}$' THEN v_state := 'review'; v_reason := 'not_found';
  ELSIF (p ->> 'birth_date') IS DISTINCT FROM pt.birth_date::text OR (p ->> 'gender') IS DISTINCT FROM pt.sex
     OR btrim(regexp_replace(lower(coalesce(p ->> 'name', '')), v_norm, ' ', 'g')) <> btrim(regexp_replace(lower(pt.full_name), v_norm, ' ', 'g')) THEN
    v_state := 'review'; v_reason := 'demographics_conflict';
  ELSE v_state := 'matched';
  END IF;
  UPDATE public.satusehat_patient_identity SET is_current = false WHERE tenant_id = o.tenant_id AND patient_id = v_patient AND is_current;
  INSERT INTO public.satusehat_patient_identity (tenant_id, patient_id, state, reason, ihs_patient_id)
  VALUES (o.tenant_id, v_patient, v_state, v_reason, CASE WHEN v_state = 'matched' THEN p ->> 'ihs' END);
  RETURN v_state;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_identity_record(uuid, integer, jsonb, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_identity_record(uuid, integer, jsonb, timestamptz) TO clinic_app;--> statement-breakpoint

-- Before a remote call (plan §3): fenced; a write needs the link queued (the barrier: nothing newer is written while an older write is
-- unresolved); a reconciliation needs it outcome_unknown and due. Opens an attempt; a write marks the link sending.
CREATE FUNCTION public.satusehat_begin(p_item uuid, p_gen integer, p_link uuid, p_verb text, p_now timestamptz DEFAULT NULL, p_fp text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  o public.satusehat_outbox;
  l public.satusehat_links;
  v_id uuid;
BEGIN
  PERFORM public.satusehat_unbound();
  o := public.satusehat_fenced(p_item, p_gen, v_now);
  IF o.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO l FROM public.satusehat_links x WHERE x.tenant_id = o.tenant_id AND x.id = p_link AND x.visit_id = o.visit_id FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'ERR_NOT_FOUND: link' USING ERRCODE = 'P0002'; END IF;
  IF p_verb = 'create' AND NOT (l.status = 'queued' AND l.remote_id IS NULL AND l.next_at <= greatest(v_now, clock_timestamp()))
     OR p_verb = 'update' AND NOT (l.status = 'queued' AND l.remote_id IS NOT NULL AND l.next_at <= greatest(v_now, clock_timestamp()))
     OR p_verb = 'search' AND NOT (l.status = 'outcome_unknown' AND l.remote_id IS NULL AND l.check_after <= v_now)
     OR p_verb = 'read' AND NOT (l.status = 'outcome_unknown' AND l.remote_id IS NOT NULL AND l.check_after <= v_now)
     OR p_verb NOT IN ('create','update','search','read') THEN
    RETURN NULL;
  END IF;
  IF p_verb IN ('create','update') THEN
    IF coalesce(p_fp, '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: a write needs the fingerprint of its body' USING ERRCODE = '22023';
    END IF;
    UPDATE public.satusehat_links SET status = 'sending', updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
  END IF;
  INSERT INTO public.satusehat_attempts (tenant_id, link_id, outbox_id, revision, lease_gen, verb, body_fingerprint, started_at)
  VALUES (o.tenant_id, l.id, o.id, l.current_revision, p_gen, p_verb, CASE WHEN p_verb IN ('create','update') THEN p_fp END, v_now) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_begin(uuid, integer, uuid, text, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_begin(uuid, integer, uuid, text, timestamptz, text) TO clinic_app;--> statement-breakpoint

-- After a remote call (plan §3–§5, §8). p: outcome (ok | http_4xx | http_5xx | timeout | lost | not_found | many | incomplete | mismatch),
-- http_status, remote_id, remote_version, error_code, error_path, body (4xx provider body → satusehat_errors, clinical class), refs (the
-- Encounter's diagnosis references sent), read_fingerprint (a read: the fingerprint of the mapped fields of the resource read back). A stale
-- fence keeps the attempt (outcome stale, the remote id kept) and never moves the link past a newer state; a late answer to an attempt that
-- crash recovery already closed as lost is appended as stale evidence (review r1 P2-5). Locks: outbox → link → attempt, the same order as
-- recovery (review r1 P2-6).
CREATE FUNCTION public.satusehat_finish(p_attempt uuid, p jsonb, p_now timestamptz DEFAULT NULL) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  t public.satusehat_attempts;
  o public.satusehat_outbox;
  l public.satusehat_links;
  v_out text := p ->> 'outcome';
  v_last record;
  v_backoff interval[] := ARRAY[interval '1 minute', interval '5 minutes', interval '15 minutes', interval '60 minutes', interval '240 minutes'];
BEGIN
  PERFORM public.satusehat_unbound();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_out IS NULL OR v_out NOT IN ('ok','http_4xx','http_5xx','timeout','lost','not_found','many','incomplete','mismatch') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: attempt result' USING ERRCODE = '22023';
  END IF;
  -- read the immutable identifiers without a lock, then lock in the recovery order and re-read
  SELECT * INTO t FROM public.satusehat_attempts x WHERE x.id = p_attempt;
  IF t.id IS NULL THEN RAISE EXCEPTION 'ERR_NOT_FOUND: attempt' USING ERRCODE = 'P0002'; END IF;
  o := public.satusehat_fenced(t.outbox_id, t.lease_gen, v_now);
  SELECT * INTO l FROM public.satusehat_links x WHERE x.tenant_id = t.tenant_id AND x.id = t.link_id FOR UPDATE;
  SELECT * INTO t FROM public.satusehat_attempts x WHERE x.id = p_attempt FOR UPDATE;
  IF t.outcome IS NOT NULL THEN
    -- already closed (recovery wrote lost): keep the late answer as its own stale evidence row; nothing else changes
    INSERT INTO public.satusehat_attempts (tenant_id, link_id, outbox_id, revision, lease_gen, verb, body_fingerprint, started_at)
    VALUES (t.tenant_id, t.link_id, t.outbox_id, t.revision, t.lease_gen, t.verb, t.body_fingerprint, t.started_at) RETURNING * INTO t;
    UPDATE public.satusehat_attempts SET outcome = 'stale', http_status = (p ->> 'http_status')::integer, remote_id = p ->> 'remote_id',
           remote_version = p ->> 'remote_version', finished_at = v_now WHERE tenant_id = t.tenant_id AND id = t.id;
    RETURN 'stale';
  END IF;
  IF o.id IS NULL THEN
    UPDATE public.satusehat_attempts SET outcome = 'stale', http_status = (p ->> 'http_status')::integer, remote_id = p ->> 'remote_id',
           remote_version = p ->> 'remote_version', finished_at = v_now WHERE tenant_id = t.tenant_id AND id = t.id;
    IF l.status = 'sending' THEN
      UPDATE public.satusehat_links SET status = 'outcome_unknown', check_after = v_now, updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
    END IF;
    RETURN 'stale';
  END IF;
  UPDATE public.satusehat_attempts SET outcome = v_out, http_status = (p ->> 'http_status')::integer, remote_id = p ->> 'remote_id',
         remote_version = p ->> 'remote_version', error_code = left(p ->> 'error_code', 80), error_path = left(p ->> 'error_path', 200), finished_at = v_now
   WHERE tenant_id = t.tenant_id AND id = t.id;
  IF t.verb IN ('create','update') THEN
    IF v_out = 'ok' THEN
      UPDATE public.satusehat_links SET status = 'confirmed', status_reason = NULL, remote_id = coalesce(l.remote_id, p ->> 'remote_id'),
             confirmed_revision = t.revision, sent_refs = CASE WHEN p ? 'refs' THEN p -> 'refs' ELSE sent_refs END, retries = 0, reconcile_rounds = 0,
             check_after = NULL, updated_at = v_now
       WHERE tenant_id = l.tenant_id AND id = l.id;
    ELSIF v_out = 'http_4xx' THEN
      UPDATE public.satusehat_links SET status = 'failed', status_reason = 'http_4xx', updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
      IF jsonb_typeof(p -> 'body') = 'object' THEN
        INSERT INTO public.satusehat_errors (tenant_id, branch_id, attempt_id, body) VALUES (t.tenant_id, l.branch_id, t.id, p -> 'body');
      END IF;
    ELSIF v_out = 'http_5xx' THEN
      IF l.retries < cardinality(v_backoff) THEN
        UPDATE public.satusehat_links SET status = 'queued', next_at = v_now + v_backoff[l.retries + 1], retries = retries + 1, updated_at = v_now
         WHERE tenant_id = l.tenant_id AND id = l.id;
      ELSE
        UPDATE public.satusehat_links SET status = 'failed', status_reason = 'retry_exhausted', updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
      END IF;
    ELSE -- timeout / lost: the write may have committed
      UPDATE public.satusehat_links SET status = 'outcome_unknown', check_after = v_now, reconcile_rounds = 0, updated_at = v_now
       WHERE tenant_id = l.tenant_id AND id = l.id;
    END IF;
  ELSE
    -- reconciliation (plan §5): search for an uncertain create (exact stable identifier), read for an uncertain update: the read-back's
    -- fingerprint must equal the fingerprint of the body the last uncertain write sent (review r1 P1-3); it confirms THAT write's revision,
    -- and a newer revision is then queued as a normal update
    SELECT a.revision, a.body_fingerprint INTO v_last FROM public.satusehat_attempts a
     WHERE a.tenant_id = l.tenant_id AND a.link_id = l.id AND a.verb IN ('create','update') AND a.body_fingerprint IS NOT NULL
     ORDER BY a.started_at DESC, a.id DESC LIMIT 1;
    IF v_out = 'ok' AND (t.verb = 'search' AND (p ->> 'remote_id') ~ '^[A-Za-z0-9-]{3,64}$'
                         OR t.verb = 'read' AND p ->> 'read_fingerprint' = v_last.body_fingerprint) THEN
      UPDATE public.satusehat_links SET status = CASE WHEN coalesce(v_last.revision, l.current_revision) < l.current_revision THEN 'queued' ELSE 'confirmed' END,
             status_reason = NULL, remote_id = coalesce(l.remote_id, p ->> 'remote_id'),
             confirmed_revision = coalesce(v_last.revision, l.current_revision), next_at = v_now,
             sent_refs = CASE WHEN p ? 'refs' THEN p -> 'refs' ELSE sent_refs END, reconcile_rounds = 0, check_after = NULL, updated_at = v_now
       WHERE tenant_id = l.tenant_id AND id = l.id;
    ELSIF v_out = 'many' THEN
      UPDATE public.satusehat_links SET status = 'exception', status_reason = 'duplicate_remote', updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
    ELSIF v_out IN ('not_found','incomplete','mismatch') OR v_out = 'ok' AND t.verb = 'read' THEN
      IF l.reconcile_rounds = 0 THEN
        UPDATE public.satusehat_links SET check_after = v_now + interval '30 minutes', reconcile_rounds = 1, updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
      ELSE
        UPDATE public.satusehat_links SET status = 'exception', status_reason = CASE WHEN t.verb = 'search' THEN 'reconcile_unresolved' ELSE 'update_unresolved' END,
               updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
      END IF;
    ELSE -- the reconciliation call itself failed (4xx / 5xx / timeout): try again later; it never writes
      UPDATE public.satusehat_links SET check_after = v_now + interval '5 minutes', updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
    END IF;
  END IF;
  SELECT * INTO l FROM public.satusehat_links x WHERE x.tenant_id = t.tenant_id AND x.id = t.link_id;
  RETURN l.status;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_finish(uuid, jsonb, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_finish(uuid, jsonb, timestamptz) TO clinic_app;--> statement-breakpoint

-- The Encounter must name its confirmed diagnoses (guide: Encounter.diagnosis.condition): when the confirmed Conditions differ from what the
-- Encounter last carried, the confirmed Encounter is queued for an update. Fenced.
CREATE FUNCTION public.satusehat_refs_check(p_item uuid, p_gen integer, p_now timestamptz DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  o public.satusehat_outbox;
  v_refs jsonb;
  n integer;
BEGIN
  PERFORM public.satusehat_unbound();
  o := public.satusehat_fenced(p_item, p_gen, v_now);
  IF o.id IS NULL THEN RETURN false; END IF;
  SELECT coalesce(jsonb_agg(c.remote_id ORDER BY (lr.materialized ->> 'rank')::integer, c.local_key), '[]'::jsonb) INTO v_refs
    FROM public.satusehat_links c JOIN public.satusehat_link_revisions lr ON lr.tenant_id = c.tenant_id AND lr.link_id = c.id AND lr.revision = c.confirmed_revision
   WHERE c.tenant_id = o.tenant_id AND c.environment = public.satusehat_env() AND c.visit_id = o.visit_id AND c.fhir_type = 'Condition' AND c.status = 'confirmed';
  UPDATE public.satusehat_links SET status = 'queued', next_at = v_now, updated_at = v_now
   WHERE tenant_id = o.tenant_id AND environment = public.satusehat_env() AND visit_id = o.visit_id AND fhir_type = 'Encounter' AND status = 'confirmed'
     AND sent_refs IS DISTINCT FROM v_refs;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_refs_check(uuid, integer, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_refs_check(uuid, integer, timestamptz) TO clinic_app;--> statement-breakpoint

-- Release the lease (plan §4): done when no link of the visit is queued, sending or outcome_unknown; otherwise queued again for the earliest
-- due link (a retry or a reconciliation). A stale fence changes nothing.
CREATE FUNCTION public.satusehat_release(p_item uuid, p_gen integer, p_now timestamptz DEFAULT NULL) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  o public.satusehat_outbox;
  v_next timestamptz;
BEGIN
  PERFORM public.satusehat_unbound();
  o := public.satusehat_fenced(p_item, p_gen, v_now);
  IF o.id IS NULL THEN RETURN 'stale'; END IF;
  UPDATE public.satusehat_links SET status = 'outcome_unknown', check_after = v_now, updated_at = v_now
   WHERE tenant_id = o.tenant_id AND visit_id = o.visit_id AND status = 'sending';
  -- work left that can progress: the Encounter itself, or a dependent whose Encounter is confirmed (a Condition behind an Encounter in an
  -- exception or failure waits for a person — Kirim Ulang adds a new item — instead of keeping the item busy)
  SELECT min(CASE WHEN l.status = 'queued' THEN l.next_at ELSE l.check_after END) INTO v_next FROM public.satusehat_links l
   WHERE l.tenant_id = o.tenant_id AND l.environment = public.satusehat_env() AND l.visit_id = o.visit_id AND l.status IN ('queued','outcome_unknown')
     AND (l.fhir_type = 'Encounter' OR EXISTS (SELECT 1 FROM public.satusehat_links e WHERE e.tenant_id = l.tenant_id AND e.environment = l.environment
            AND e.visit_id = l.visit_id AND e.fhir_type = 'Encounter' AND e.status IN ('confirmed','queued','outcome_unknown')));
  IF v_next IS NULL THEN
    UPDATE public.satusehat_outbox SET state = 'done', lease_until = NULL, finished_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
    RETURN 'done';
  END IF;
  UPDATE public.satusehat_outbox SET state = 'queued', lease_until = NULL, next_at = greatest(v_next, v_now) WHERE tenant_id = o.tenant_id AND id = o.id;
  RETURN 'queued';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_release(uuid, integer, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_release(uuid, integer, timestamptz) TO clinic_app;--> statement-breakpoint

-- ── T-102 bound commands and readers (plan §6, §7, §4 Kirim Ulang; increment 1 — the UX-23 page is increment 3) ──────────────────
-- Bound, the actor lock first (DEC-043); keyed where they create rows (command_key); ids and codes in events and audit.

-- Credentials (TD-30): owner / admin_pusat with the configuration capability; the organization must equal the branch's SATUSEHAT
-- organization id (SET-46). A new generation revokes the active one. The secret arrives sealed (the app seals with the tenant DEK).
CREATE FUNCTION public.satusehat_credential_set(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','admin_pusat']);
  x public.satusehat_credentials;
  v_branch uuid;
  v_env text;
  v_org text;
  v_gen integer;
  v_id uuid;
BEGIN
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'branch_id' - 'environment' - 'organization_id' - 'client_id' - 'secret_enc' - 'dek_ref' <> '{}'::jsonb
     OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR coalesce(p ->> 'branch_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR coalesce(p ->> 'environment', '') NOT IN ('sandbox','production') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: credential' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO x FROM public.satusehat_credentials c WHERE c.tenant_id = a.tenant_id AND c.command_key = p_key;
  IF x.id IS NOT NULL THEN
    PERFORM public.satusehat_branch(a, x.branch_id);
    RETURN x.id;
  END IF;
  v_branch := (p ->> 'branch_id')::uuid;
  v_env := p ->> 'environment';
  PERFORM public.satusehat_branch(a, v_branch);
  SELECT b.satusehat_org_id INTO v_org FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch;
  IF v_org IS NULL OR v_org IS DISTINCT FROM p ->> 'organization_id' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: organization_mismatch' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('satusehat_cred:' || a.tenant_id::text || v_branch::text || v_env, 0));
  SELECT coalesce(max(c.generation), 0) + 1 INTO v_gen FROM public.satusehat_credentials c
   WHERE c.tenant_id = a.tenant_id AND c.branch_id = v_branch AND c.environment = v_env;
  UPDATE public.satusehat_credentials SET revoked_at = clock_timestamp()
   WHERE tenant_id = a.tenant_id AND branch_id = v_branch AND environment = v_env AND revoked_at IS NULL;
  BEGIN
    INSERT INTO public.satusehat_credentials (tenant_id, branch_id, environment, organization_id, client_id, secret_enc, dek_ref, generation, command_key,
                                              created_by, created_as)
    VALUES (a.tenant_id, v_branch, v_env, v_org, btrim(p ->> 'client_id'), p ->> 'secret_enc', p ->> 'dek_ref', v_gen, p_key, a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: credential' USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'satusehat_credential', v_id, 'success', 'satusehat_credential_set');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_credential_set(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_credential_set(text, jsonb) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.satusehat_credential_revoke(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','admin_pusat']);
  x public.satusehat_credentials;
BEGIN
  SELECT * INTO x FROM public.satusehat_credentials c WHERE c.tenant_id = a.tenant_id AND c.id = p_id FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION 'ERR_NOT_FOUND: credential not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.satusehat_branch(a, x.branch_id);
  IF x.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.satusehat_credentials SET revoked_at = clock_timestamp() WHERE tenant_id = x.tenant_id AND id = x.id;
  PERFORM public.audit_append('settings_change', 'satusehat_credential', x.id, 'success', 'satusehat_credential_revoked');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_credential_revoke(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_credential_revoke(uuid) TO clinic_app;--> statement-breakpoint

-- The credential status of the bound tenant's branches (never the secret): for the credentials section and the tests.
CREATE FUNCTION public.satusehat_credential_status() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','admin_pusat']);
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'branch_id', c.branch_id, 'environment', c.environment, 'organization_id', c.organization_id,
            'client_id', c.client_id, 'generation', c.generation, 'created_at', c.created_at, 'revoked_at', c.revoked_at)
            ORDER BY c.branch_id, c.environment, c.generation), '[]'::jsonb)
            FROM public.satusehat_credentials c WHERE c.tenant_id = a.tenant_id AND public.app_branch_allowed(c.branch_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_credential_status() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_credential_status() TO clinic_app;--> statement-breakpoint

-- Practitioner IHS id (DEC-113 (6)): owner or facility head of a branch where the staff holds a clinical role; lookup or manual; the NIK of a
-- lookup is never passed here. A new link ends the current one. Holds of that practitioner are requeued.
CREATE FUNCTION public.satusehat_practitioner_link_set(p_key text, p_staff uuid, p_ihs text, p_source text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','facility_head']);
  x public.satusehat_practitioner_links;
  v_id uuid;
  o record;
BEGIN
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR coalesce(p_ihs, '') !~ '^[A-Za-z0-9-]{3,64}$' OR p_source NOT IN ('lookup','manual') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: practitioner' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO x FROM public.satusehat_practitioner_links l WHERE l.tenant_id = a.tenant_id AND l.command_key = p_key;
  -- a replay answers only an actor who may act on that staff member now (review r1 P2-8): authorize first, then replay
  IF NOT EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = a.tenant_id AND sb.staff_id = coalesce(x.staff_id, p_staff)
                   AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head')
                   AND (a.role = 'owner' OR public.app_branch_allowed(sb.branch_id) AND (a.branch_id IS NULL OR sb.branch_id = a.branch_id))) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF x.id IS NOT NULL THEN RETURN x.id; END IF;
  UPDATE public.satusehat_practitioner_links SET ended_at = clock_timestamp() WHERE tenant_id = a.tenant_id AND staff_id = p_staff AND ended_at IS NULL;
  INSERT INTO public.satusehat_practitioner_links (tenant_id, staff_id, ihs_practitioner_id, source, command_key, recorded_by, recorded_as)
  VALUES (a.tenant_id, p_staff, p_ihs, p_source, p_key, a.staff_id, a.role) RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'satusehat_practitioner_link', v_id, 'success', 'satusehat_practitioner_set');
  FOR o IN SELECT x2.id FROM public.satusehat_outbox x2 JOIN public.satusehat_visit_context c ON c.tenant_id = x2.tenant_id AND c.visit_id = x2.visit_id
            WHERE x2.tenant_id = a.tenant_id AND x2.state = 'held' AND x2.hold_reason = 'practitioner_unresolved' AND c.doctor_staff_id = p_staff LOOP
    PERFORM public.satusehat_requeue(a.tenant_id, o.id);
  END LOOP;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_practitioner_link_set(text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_practitioner_link_set(text, uuid, text, text) TO clinic_app;--> statement-breakpoint

-- Identity review (plan §7): a records officer or facility head of a branch where the patient has a held item resolves it with an IHS id
-- and evidence, or marks it unresolvable (stays held). Resolution requeues that patient's identity holds.
CREATE FUNCTION public.satusehat_identity_resolve(p_patient uuid, p_ihs text, p_evidence text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['records_officer','facility_head']);
  v_patient uuid;
  v_state text := CASE WHEN p_ihs IS NULL THEN 'unresolvable' ELSE 'resolved_manual' END;
  o record;
BEGIN
  IF p_ihs IS NOT NULL AND p_ihs !~ '^[A-Za-z0-9-]{3,64}$' OR length(btrim(coalesce(p_evidence, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: identity' USING ERRCODE = '22023';
  END IF;
  v_patient := public.patient_canonical(a.tenant_id, p_patient);
  IF v_patient IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.satusehat_visit_context c WHERE c.tenant_id = a.tenant_id AND c.patient_id = ANY (public.patient_cluster(a.tenant_id, v_patient))
          AND public.app_branch_allowed(c.branch_id) AND (a.branch_id IS NULL OR c.branch_id = a.branch_id))
     OR NOT EXISTS (SELECT 1 FROM public.satusehat_patient_identity i WHERE i.tenant_id = a.tenant_id AND i.patient_id = v_patient AND i.is_current AND i.state IN ('review','unresolvable')) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no identity review for this patient' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.satusehat_patient_identity SET is_current = false WHERE tenant_id = a.tenant_id AND patient_id = v_patient AND is_current;
  INSERT INTO public.satusehat_patient_identity (tenant_id, patient_id, state, ihs_patient_id, evidence, decided_by, decided_as)
  VALUES (a.tenant_id, v_patient, v_state, p_ihs, btrim(p_evidence), a.staff_id, a.role);
  PERFORM public.audit_append('settings_change', 'patient', v_patient, 'success', 'satusehat_identity_' || v_state);
  IF v_state = 'resolved_manual' THEN
    FOR o IN SELECT x.id FROM public.satusehat_outbox x JOIN public.satusehat_visit_context c ON c.tenant_id = x.tenant_id AND c.visit_id = x.visit_id
              WHERE x.tenant_id = a.tenant_id AND x.state = 'held' AND x.hold_reason = 'identity_review'
                AND c.patient_id = ANY (public.patient_cluster(a.tenant_id, v_patient)) LOOP
      PERFORM public.satusehat_requeue(a.tenant_id, o.id);
    END LOOP;
  END IF;
  RETURN v_state;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_identity_resolve(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_identity_resolve(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- A visit signed without a called room (plan §1): a records officer or facility head of that branch sets the reporting room once.
CREATE FUNCTION public.satusehat_context_room_set(p_visit uuid, p_room uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['records_officer','facility_head']);
  c public.satusehat_visit_context;
  o record;
BEGIN
  SELECT * INTO c FROM public.satusehat_visit_context x WHERE x.tenant_id = a.tenant_id AND x.visit_id = p_visit FOR UPDATE;
  IF c.visit_id IS NULL THEN RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.satusehat_branch(a, c.branch_id);
  IF c.room_id IS NOT NULL THEN RAISE EXCEPTION 'ERR_VERSION_CONFLICT: room already set' USING ERRCODE = '40001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.tenant_id = a.tenant_id AND r.branch_id = c.branch_id AND r.id = p_room AND r.is_active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: room not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.satusehat_visit_context SET room_id = p_room, room_set_by = a.staff_id WHERE tenant_id = c.tenant_id AND visit_id = c.visit_id;
  PERFORM public.audit_append('settings_change', 'visit', p_visit, 'success', 'satusehat_room_set');
  FOR o IN SELECT x.id FROM public.satusehat_outbox x WHERE x.tenant_id = a.tenant_id AND x.visit_id = p_visit AND x.state = 'held' AND x.hold_reason = 'no_room' LOOP
    PERFORM public.satusehat_requeue(a.tenant_id, o.id);
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_context_room_set(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_context_room_set(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Kirim Ulang (plan §4): owner, manager, facility head, records officer of the visit's branch. Failed and unresolved-reconciliation links of
-- the visit go back to queued (withdrawal_pending stays manual: the guide states no withdrawal rule) (a reconcile_unresolved create is re-created anew: its remote id cleared; an organization_changed or
-- duplicate_remote exception is not resendable — it needs a person to decide outside the system), held items are requeued, and a new resend
-- item is added. Audited with a reason code from a closed set (audit rows carry no free text outside break-glass).
CREATE FUNCTION public.satusehat_resend(p_visit uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','manager','facility_head','records_officer']);
  o public.satusehat_outbox;
  v_branch uuid;
  n integer;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('remote_checked','provider_recovered','data_corrected') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT x.branch_id INTO v_branch FROM public.satusehat_outbox x WHERE x.tenant_id = a.tenant_id AND x.visit_id = p_visit LIMIT 1;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.satusehat_branch(a, v_branch);
  UPDATE public.satusehat_links SET status = 'queued', status_reason = NULL, retries = 0, reconcile_rounds = 0, next_at = clock_timestamp(),
         remote_id = CASE WHEN status = 'exception' AND status_reason = 'reconcile_unresolved' THEN NULL ELSE remote_id END,
         updated_at = clock_timestamp()
   WHERE tenant_id = a.tenant_id AND visit_id = p_visit AND environment = public.satusehat_env()
     AND (status = 'failed' OR status = 'exception' AND status_reason IN ('reconcile_unresolved','update_unresolved'));
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT * INTO o FROM public.satusehat_outbox x WHERE x.tenant_id = a.tenant_id AND x.visit_id = p_visit
   ORDER BY x.revision DESC, x.created_at DESC LIMIT 1;
  IF o.state IN ('done','held') THEN
    PERFORM public.satusehat_requeue(a.tenant_id, o.id);
  END IF;
  PERFORM public.audit_append('settings_change', 'visit', p_visit, 'success', 'satusehat_resend_' || p_reason);
  RETURN n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_resend(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_resend(uuid, text) TO clinic_app;--> statement-breakpoint

-- Monitor (UX-23 data, increment 1 minimum): per visit of the branch, counts by link status and the outbox state; codes only.
CREATE FUNCTION public.satusehat_monitor(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','manager','facility_head','records_officer']);
BEGIN
  PERFORM public.satusehat_branch(a, p_branch);
  RETURN (SELECT jsonb_build_object(
    'outbox', (SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb) FROM (SELECT x.state || coalesce(':' || x.hold_reason, '') s, count(*) n
                 FROM public.satusehat_outbox x WHERE x.tenant_id = a.tenant_id AND x.branch_id = p_branch AND x.state NOT IN ('superseded') GROUP BY 1) q),
    'links', (SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb) FROM (SELECT l.status || coalesce(':' || l.status_reason, '') s, count(*) n
                 FROM public.satusehat_links l WHERE l.tenant_id = a.tenant_id AND l.branch_id = p_branch AND l.environment = public.satusehat_env() GROUP BY 1) q)));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_monitor(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_monitor(uuid) TO clinic_app;
