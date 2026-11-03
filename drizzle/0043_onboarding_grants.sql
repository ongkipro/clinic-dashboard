CREATE TABLE "onboarding_grants" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"renewed_at" timestamp with time zone,
	"renewed_by_staff" uuid,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "onboarding_grants_expiry_check" CHECK ("onboarding_grants"."expires_at" > "onboarding_grants"."granted_at"),
	CONSTRAINT "onboarding_grants_renew_check" CHECK (("onboarding_grants"."renewed_at" is null) = ("onboarding_grants"."renewed_by_staff" is null)),
	CONSTRAINT "onboarding_grants_end_check" CHECK (("onboarding_grants"."ended_at" is null) = ("onboarding_grants"."end_reason" is null) and ("onboarding_grants"."end_reason" is null or "onboarding_grants"."end_reason" in ('go_live','left_onboarding')))
);
--> statement-breakpoint
CREATE TABLE "onboarding_invitation_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"roles" text[] NOT NULL,
	"branch_ids" uuid[] NOT NULL,
	"drafted_by" uuid NOT NULL,
	"drafted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"decided_by_staff" uuid,
	"decided_at" timestamp with time zone,
	"invitation_id" uuid,
	CONSTRAINT "onboarding_invitation_drafts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "onboarding_invitation_drafts_state_check" CHECK ("onboarding_invitation_drafts"."state" in ('draft','confirmed','declined')),
	CONSTRAINT "onboarding_invitation_drafts_email_check" CHECK ("onboarding_invitation_drafts"."email" = lower("onboarding_invitation_drafts"."email") and "onboarding_invitation_drafts"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' and length("onboarding_invitation_drafts"."email") <= 254),
	CONSTRAINT "onboarding_invitation_drafts_name_check" CHECK (length(btrim("onboarding_invitation_drafts"."display_name")) between 2 and 120),
	CONSTRAINT "onboarding_invitation_drafts_roles_check" CHECK (cardinality("onboarding_invitation_drafts"."roles") >= 1 and "onboarding_invitation_drafts"."roles" <@ array['manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist','central_cs','marketing','purchasing']::text[]),
	CONSTRAINT "onboarding_invitation_drafts_decided_check" CHECK (("onboarding_invitation_drafts"."state" = 'draft') = ("onboarding_invitation_drafts"."decided_at" is null) and ("onboarding_invitation_drafts"."state" = 'draft') = ("onboarding_invitation_drafts"."decided_by_staff" is null) and ("onboarding_invitation_drafts"."state" = 'confirmed') = ("onboarding_invitation_drafts"."invitation_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "onboarding_grants" ADD CONSTRAINT "onboarding_grants_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_invitation_drafts" ADD CONSTRAINT "onboarding_invitation_drafts_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_invitation_drafts" ADD CONSTRAINT "onboarding_invitation_drafts_drafted_by_vendor_staff_id_fk" FOREIGN KEY ("drafted_by") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;