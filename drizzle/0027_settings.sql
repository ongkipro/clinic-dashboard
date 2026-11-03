CREATE TABLE "setting_defs" (
	"key" text PRIMARY KEY NOT NULL,
	"group_slug" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"spec" jsonb,
	"default_value" jsonb,
	"changers" text[] NOT NULL,
	"drafts" jsonb NOT NULL,
	CONSTRAINT "setting_defs_key_check" CHECK ("setting_defs"."key" ~ '^SET-[0-9]{1,2}(\.[a-z]+)?$'),
	CONSTRAINT "setting_defs_kind_check" CHECK ("setting_defs"."kind" in ('value','ref') and ("setting_defs"."kind" = 'value') = ("setting_defs"."spec" is not null)),
	CONSTRAINT "setting_defs_scope_check" CHECK ("setting_defs"."scope" in ('tenant','branch'))
);
--> statement-breakpoint
CREATE TABLE "setting_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"restored_default" text DEFAULT 'no' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_as" text NOT NULL,
	"changed_name" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approval_id" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "setting_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "setting_versions_state_check" CHECK ("setting_versions"."state" in ('active','draft','rejected','cancelled','superseded')),
	CONSTRAINT "setting_versions_reason_check" CHECK (length(btrim("setting_versions"."reason")) between 3 and 500),
	CONSTRAINT "setting_versions_draft_check" CHECK ("setting_versions"."state" not in ('draft','rejected','cancelled') or "setting_versions"."approval_id" is not null),
	CONSTRAINT "setting_versions_decided_check" CHECK ("setting_versions"."decided_at" is null or "setting_versions"."decided_at" >= "setting_versions"."created_at"),
	CONSTRAINT "setting_versions_restored_check" CHECK ("setting_versions"."restored_default" in ('no','yes'))
);
--> statement-breakpoint
ALTER TABLE "setting_versions" ADD CONSTRAINT "setting_versions_key_setting_defs_key_fk" FOREIGN KEY ("key") REFERENCES "public"."setting_defs"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_versions" ADD CONSTRAINT "setting_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_versions" ADD CONSTRAINT "setting_versions_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_versions" ADD CONSTRAINT "setting_versions_tenant_id_changed_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","changed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_versions" ADD CONSTRAINT "setting_versions_tenant_id_approval_id_approvals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setting_versions_lookup_idx" ON "setting_versions" USING btree ("tenant_id","key","branch_id","effective_from") WHERE "setting_versions"."state" = 'active';