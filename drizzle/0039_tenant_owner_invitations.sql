CREATE TABLE "tenant_owner_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"accepted_account" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "tenant_owner_invitations_token_key" UNIQUE("token_hash"),
	CONSTRAINT "tenant_owner_invitations_state_check" CHECK ("tenant_owner_invitations"."state" in ('pending','issued','accepted','cancelled','expired')),
	CONSTRAINT "tenant_owner_invitations_email_check" CHECK ("tenant_owner_invitations"."email" = lower("tenant_owner_invitations"."email") and "tenant_owner_invitations"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' and length("tenant_owner_invitations"."email") <= 254),
	CONSTRAINT "tenant_owner_invitations_name_check" CHECK (length(btrim("tenant_owner_invitations"."display_name")) between 2 and 120),
	CONSTRAINT "tenant_owner_invitations_token_check" CHECK ("tenant_owner_invitations"."token_hash" is null or "tenant_owner_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tenant_owner_invitations_checker_check" CHECK ("tenant_owner_invitations"."approved_by" is null or "tenant_owner_invitations"."approved_by" <> "tenant_owner_invitations"."requested_by"),
	CONSTRAINT "tenant_owner_invitations_flow_check" CHECK (("tenant_owner_invitations"."state" <> 'pending' or ("tenant_owner_invitations"."approved_by" is null and "tenant_owner_invitations"."token_hash" is null))
          and ("tenant_owner_invitations"."state" not in ('issued','accepted') or ("tenant_owner_invitations"."approved_by" is not null and "tenant_owner_invitations"."token_hash" is not null and "tenant_owner_invitations"."expires_at" is not null))
          and ("tenant_owner_invitations"."state" = 'accepted') = ("tenant_owner_invitations"."accepted_account" is not null)
          and ("tenant_owner_invitations"."state" in ('pending','issued')) = ("tenant_owner_invitations"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "tenant_owner_invitations" ADD CONSTRAINT "tenant_owner_invitations_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_owner_invitations" ADD CONSTRAINT "tenant_owner_invitations_requested_by_vendor_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_owner_invitations" ADD CONSTRAINT "tenant_owner_invitations_approved_by_vendor_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_owner_invitations" ADD CONSTRAINT "tenant_owner_invitations_accepted_account_auth_user_id_fk" FOREIGN KEY ("accepted_account") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;