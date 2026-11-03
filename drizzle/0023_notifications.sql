CREATE TABLE "notification_types" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"recipient_roles" text[] NOT NULL,
	"subject_kinds" text[] NOT NULL,
	"raisable_by_staff" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_types_key_check" CHECK ("notification_types"."key" ~ '^[a-z][a-z_]{2,40}$'),
	CONSTRAINT "notification_types_roles_check" CHECK (cardinality("notification_types"."recipient_roles") >= 1 and cardinality("notification_types"."subject_kinds") >= 1)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"recipient_role" text,
	"recipient_staff_id" uuid,
	"branch_id" uuid,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"source_event_id" uuid,
	"raised_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_as" text,
	"acknowledged_name" text,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "notifications_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "notifications_recipient_check" CHECK (("notifications"."recipient_role" is null) <> ("notifications"."recipient_staff_id" is null)),
	CONSTRAINT "notifications_subject_kind_check" CHECK ("notifications"."subject_kind" ~ '^[a-z][a-z_]{1,40}$'),
	CONSTRAINT "notifications_ack_check" CHECK (("notifications"."acknowledged_at" is null) = ("notifications"."acknowledged_by" is null) and ("notifications"."acknowledged_at" is null) = ("notifications"."acknowledged_as" is null)
       and ("notifications"."acknowledged_at" is null) = ("notifications"."acknowledged_name" is null))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_notification_types_key_fk" FOREIGN KEY ("type") REFERENCES "public"."notification_types"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_recipient_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","recipient_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_acknowledged_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","acknowledged_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_raised_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","raised_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_open_idx" ON "notifications" USING btree ("tenant_id","recipient_role","branch_id") WHERE "notifications"."acknowledged_at" is null;