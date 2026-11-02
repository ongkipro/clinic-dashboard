CREATE TABLE "tenants_registry" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"lifecycle_state" text DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_registry_lifecycle_state_check" CHECK ("tenants_registry"."lifecycle_state" in ('provisioning','onboarding','live','suspended','exit','closed'))
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "branches_tenant_id_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "branches_timezone_check" CHECK ("branches"."timezone" in ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"npwp" text,
	"is_pkp" boolean DEFAULT false NOT NULL,
	"pkp_effective_from" date,
	"sak_framework" text NOT NULL,
	"accent_hex" text,
	"logo_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_sak_framework_check" CHECK ("tenants"."sak_framework" in ('emkm','ep')),
	CONSTRAINT "tenants_accent_hex_check" CHECK ("tenants"."accent_hex" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenants_pkp_check" CHECK (not "tenants"."is_pkp" or "tenants"."pkp_effective_from" is not null)
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_id_tenants_registry_id_fk" FOREIGN KEY ("id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;