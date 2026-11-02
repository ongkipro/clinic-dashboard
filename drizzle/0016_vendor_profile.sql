CREATE TABLE "vendor_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" text NOT NULL,
	"nib" text NOT NULL,
	"pse_number" text NOT NULL,
	"npwp" text NOT NULL,
	"meta_business_id" text NOT NULL,
	"website" text NOT NULL,
	"privacy_url" text NOT NULL,
	"support_email" text NOT NULL,
	"support_phone" text NOT NULL,
	"placeholder_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"storage_locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_pkp" boolean DEFAULT false NOT NULL,
	"pkp_effective_from" date,
	"tax_evidence_ref" text,
	"residency_opinion_ref" text,
	"residency_opinion_date" date,
	"residency_opinion_outcome" text,
	"residency_opinion_set_by" uuid,
	"residency_opinion_checksum" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_profile_singleton_check" CHECK ("vendor_profile"."id" = 1),
	CONSTRAINT "vendor_profile_not_blank_check" CHECK (btrim("legal_name") <> '' and btrim("nib") <> '' and btrim("pse_number") <> '' and btrim("npwp") <> '' and btrim("meta_business_id") <> '' and btrim("website") <> '' and btrim("privacy_url") <> '' and btrim("support_email") <> '' and btrim("support_phone") <> ''),
	CONSTRAINT "vendor_profile_tax_evidence_check" CHECK ("vendor_profile"."tax_evidence_ref" is null or btrim("vendor_profile"."tax_evidence_ref") <> ''),
	CONSTRAINT "vendor_profile_placeholder_fields_check" CHECK ("vendor_profile"."placeholder_fields" <@ array['legal_name','nib','pse_number','npwp','meta_business_id','website','privacy_url','support_email','support_phone']::text[]),
	CONSTRAINT "vendor_profile_storage_locations_check" CHECK (jsonb_typeof("vendor_profile"."storage_locations") = 'array'),
	CONSTRAINT "vendor_profile_pkp_check" CHECK (not "vendor_profile"."is_pkp" or ("vendor_profile"."pkp_effective_from" is not null and "vendor_profile"."tax_evidence_ref" is not null)),
	CONSTRAINT "vendor_profile_residency_check" CHECK (("vendor_profile"."residency_opinion_outcome" is null) = ("vendor_profile"."residency_opinion_ref" is null)
       and ("vendor_profile"."residency_opinion_outcome" is null) = ("vendor_profile"."residency_opinion_date" is null)
       and ("vendor_profile"."residency_opinion_outcome" is null) = ("vendor_profile"."residency_opinion_set_by" is null)
       and ("vendor_profile"."residency_opinion_outcome" is null) = ("vendor_profile"."residency_opinion_checksum" is null)
       and ("vendor_profile"."residency_opinion_outcome" is null or "vendor_profile"."residency_opinion_outcome" in ('positive','negative'))
       and ("vendor_profile"."residency_opinion_checksum" is null or "vendor_profile"."residency_opinion_checksum" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "vendor_profile_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text NOT NULL,
	CONSTRAINT "vendor_profile_changes_role_check" CHECK ("vendor_profile_changes"."actor_role" ~ '^[a-z][a-z_]{1,40}$'),
	CONSTRAINT "vendor_profile_changes_field_check" CHECK ("vendor_profile_changes"."field" ~ '^[a-z][a-z_]{1,40}$'),
	CONSTRAINT "vendor_profile_changes_reason_check" CHECK (length(btrim("vendor_profile_changes"."reason")) between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "vendor_profile" ADD CONSTRAINT "vendor_profile_residency_opinion_set_by_auth_user_id_fk" FOREIGN KEY ("residency_opinion_set_by") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_profile_changes" ADD CONSTRAINT "vendor_profile_changes_actor_account_id_auth_user_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;