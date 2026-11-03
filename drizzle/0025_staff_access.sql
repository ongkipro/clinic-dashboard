CREATE TABLE "membership_revocations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"session_ids" uuid[] NOT NULL,
	"reason" text NOT NULL,
	"role" text,
	"branch_id" uuid,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_revocations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "membership_revocations_reason_check" CHECK ("membership_revocations"."reason" in ('session_revoked','role_removed','branch_removed','membership_ended','duty_removed')),
	CONSTRAINT "membership_revocations_detail_check" CHECK (("membership_revocations"."reason" in ('role_removed','branch_removed')) = ("membership_revocations"."role" is not null) and ("membership_revocations"."reason" = 'branch_removed') = ("membership_revocations"."branch_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "staff_duties" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"duty" text NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_by" uuid,
	"ended_at" timestamp with time zone,
	CONSTRAINT "staff_duties_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_duties_duty_check" CHECK ("staff_duties"."duty" in ('data_protection','it_admin')),
	CONSTRAINT "staff_duties_end_check" CHECK (("staff_duties"."ended_at" is null) = ("staff_duties"."ended_by" is null))
);
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"roles" text[] NOT NULL,
	"branch_ids" uuid[] NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"accepted_staff_id" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "staff_invitations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_invitations_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "staff_invitations_email_check" CHECK ("staff_invitations"."email" = lower("staff_invitations"."email") and "staff_invitations"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
	CONSTRAINT "staff_invitations_name_check" CHECK (length(btrim("staff_invitations"."display_name")) between 2 and 120),
	CONSTRAINT "staff_invitations_roles_check" CHECK (cardinality("staff_invitations"."roles") >= 1 and "staff_invitations"."roles" <@ array['owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor','manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist']::text[]),
	CONSTRAINT "staff_invitations_token_check" CHECK ("staff_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "staff_invitations_state_check" CHECK ("staff_invitations"."state" in ('pending','accepted','cancelled','expired')),
	CONSTRAINT "staff_invitations_close_check" CHECK (("staff_invitations"."state" = 'pending') = ("staff_invitations"."closed_at" is null) and ("staff_invitations"."state" = 'accepted') = ("staff_invitations"."accepted_staff_id" is not null)),
	CONSTRAINT "staff_invitations_expiry_check" CHECK ("staff_invitations"."expires_at" > "staff_invitations"."invited_at")
);
--> statement-breakpoint
ALTER TABLE "membership_revocations" ADD CONSTRAINT "membership_revocations_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_revocations" ADD CONSTRAINT "membership_revocations_tenant_id_revoked_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_duties" ADD CONSTRAINT "staff_duties_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_duties" ADD CONSTRAINT "staff_duties_tenant_id_assigned_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","assigned_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_duties" ADD CONSTRAINT "staff_duties_tenant_id_ended_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ended_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_tenant_id_invited_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invited_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_tenant_id_accepted_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","accepted_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_duties_one_active" ON "staff_duties" USING btree ("tenant_id","staff_id","duty") WHERE "staff_duties"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_one_pending" ON "staff_invitations" USING btree ("tenant_id","email") WHERE "staff_invitations"."state" = 'pending';