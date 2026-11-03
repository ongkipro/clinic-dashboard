CREATE TABLE "vendor_staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"roles" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"accepted_staff" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "vendor_staff_invitations_token_key" UNIQUE("token_hash"),
	CONSTRAINT "vendor_staff_invitations_state_check" CHECK ("vendor_staff_invitations"."state" in ('pending','accepted','cancelled','expired')),
	CONSTRAINT "vendor_staff_invitations_email_check" CHECK ("vendor_staff_invitations"."email" = lower("vendor_staff_invitations"."email") and "vendor_staff_invitations"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' and length("vendor_staff_invitations"."email") <= 254),
	CONSTRAINT "vendor_staff_invitations_name_check" CHECK (length(btrim("vendor_staff_invitations"."display_name")) between 2 and 120),
	CONSTRAINT "vendor_staff_invitations_roles_check" CHECK (cardinality("vendor_staff_invitations"."roles") >= 1 and "vendor_staff_invitations"."roles" <@ array['platform_owner','onboarding','support','vendor_finance','vendor_auditor']::text[]),
	CONSTRAINT "vendor_staff_invitations_token_check" CHECK ("vendor_staff_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "vendor_staff_invitations_expiry_check" CHECK ("vendor_staff_invitations"."expires_at" > "vendor_staff_invitations"."invited_at"),
	CONSTRAINT "vendor_staff_invitations_close_check" CHECK (("vendor_staff_invitations"."state" = 'pending') = ("vendor_staff_invitations"."closed_at" is null) and ("vendor_staff_invitations"."state" = 'accepted') = ("vendor_staff_invitations"."accepted_staff" is not null))
);
--> statement-breakpoint
ALTER TABLE "vendor_staff_invitations" ADD CONSTRAINT "vendor_staff_invitations_invited_by_vendor_staff_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_staff_invitations" ADD CONSTRAINT "vendor_staff_invitations_accepted_staff_vendor_staff_id_fk" FOREIGN KEY ("accepted_staff") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;