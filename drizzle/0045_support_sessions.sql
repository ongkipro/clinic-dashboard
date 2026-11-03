CREATE TABLE "support_bind_tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"session_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"auth_session_id" uuid NOT NULL,
	"backend_pid" integer NOT NULL,
	"txid" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "support_bind_tickets_txid_key" UNIQUE("txid"),
	CONSTRAINT "support_bind_tickets_expiry_check" CHECK ("support_bind_tickets"."expires_at" > "support_bind_tickets"."issued_at" and "support_bind_tickets"."expires_at" <= "support_bind_tickets"."issued_at" + interval '2 minutes')
);
--> statement-breakpoint
CREATE TABLE "support_object_kinds" (
	"table_name" text PRIMARY KEY NOT NULL,
	"support_class" text NOT NULL,
	CONSTRAINT "support_object_kinds_class_check" CHECK ("support_object_kinds"."support_class" in ('config','personal','clinical','money_total','never'))
);
--> statement-breakpoint
CREATE TABLE "support_session_bindings" (
	"session_id" uuid NOT NULL,
	"backend_pid" integer NOT NULL,
	"txid" bigint NOT NULL,
	"auth_session_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_session_bindings_key" UNIQUE("backend_pid","txid")
);
--> statement-breakpoint
CREATE TABLE "support_session_reads" (
	"session_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"first_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_session_reads_key" UNIQUE("session_id","table_name","row_id")
);
--> statement-breakpoint
CREATE TABLE "support_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"purpose" text NOT NULL,
	"scope" text[] NOT NULL,
	"minutes" integer NOT NULL,
	"state" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"extended_at" timestamp with time zone,
	"extension_reason" text,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "support_sessions_state_check" CHECK ("support_sessions"."state" in ('pending_approval','active','ended')),
	CONSTRAINT "support_sessions_purpose_check" CHECK (length(btrim("support_sessions"."purpose")) between 10 and 500),
	CONSTRAINT "support_sessions_scope_check" CHECK (cardinality("support_sessions"."scope") between 1 and 40),
	CONSTRAINT "support_sessions_minutes_check" CHECK ("support_sessions"."minutes" between 5 and 120),
	CONSTRAINT "support_sessions_extension_check" CHECK (("support_sessions"."extended_at" is null) = ("support_sessions"."extension_reason" is null) and ("support_sessions"."extension_reason" is null or length(btrim("support_sessions"."extension_reason")) between 10 and 500)),
	CONSTRAINT "support_sessions_active_check" CHECK (("support_sessions"."state" <> 'pending_approval' or "support_sessions"."activated_at" is null) and ("support_sessions"."state" <> 'active' or "support_sessions"."activated_at" is not null) and ("support_sessions"."activated_at" is null) = ("support_sessions"."ends_at" is null) and ("support_sessions"."ends_at" is null or "support_sessions"."ends_at" <= "support_sessions"."activated_at" + interval '4 hours')),
	CONSTRAINT "support_sessions_end_check" CHECK (("support_sessions"."state" = 'ended') = ("support_sessions"."ended_at" is not null) and ("support_sessions"."ended_at" is null) = ("support_sessions"."end_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "support_bind_tickets" ADD CONSTRAINT "support_bind_tickets_session_id_support_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."support_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_session_bindings" ADD CONSTRAINT "support_session_bindings_session_id_support_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."support_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_session_reads" ADD CONSTRAINT "support_session_reads_session_id_support_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."support_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_tenant_id_tenants_registry_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_opened_by_vendor_staff_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."vendor_staff"("id") ON DELETE restrict ON UPDATE no action;