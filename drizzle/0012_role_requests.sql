CREATE TABLE "role_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid DEFAULT app_tenant_id() NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" text NOT NULL,
	"change" text NOT NULL,
	"requested_by" uuid DEFAULT app_staff_id() NOT NULL,
	"requested_as" text DEFAULT app_acting_role() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "role_requests_change_check" CHECK ("role_requests"."change" in ('grant','revoke')),
	CONSTRAINT "role_requests_state_check" CHECK ("role_requests"."state" in ('pending','approved','rejected')),
	CONSTRAINT "role_requests_role_check" CHECK ("role_requests"."role" in ('owner','admin_pusat','finance','facility_head','records_officer','auditor','central_cs','marketing','purchasing')),
	CONSTRAINT "role_requests_decision_check" CHECK (("role_requests"."state" = 'pending') = ("role_requests"."decided_by" is null and "role_requests"."decided_at" is null)),
	CONSTRAINT "role_requests_not_self_check" CHECK ("role_requests"."decided_by" is null or "role_requests"."decided_by" <> "role_requests"."requested_by")
);
--> statement-breakpoint
ALTER TABLE "role_requests" ADD CONSTRAINT "role_requests_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_requests" ADD CONSTRAINT "role_requests_tenant_id_requested_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_requests" ADD CONSTRAINT "role_requests_tenant_id_decided_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_requests_one_pending" ON "role_requests" USING btree ("tenant_id","staff_id","role","change") WHERE "role_requests"."state" = 'pending';