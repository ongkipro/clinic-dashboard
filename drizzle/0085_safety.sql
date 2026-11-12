CREATE TABLE "clinical_incident_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "clinical_incident_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "clinical_incident_events_check" CHECK ("clinical_incident_events"."kind" in ('reported','taken','investigated','determined','submitted','closed'))
);
--> statement-breakpoint
CREATE TABLE "clinical_incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"classification" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"patient_id" uuid,
	"visit_id" uuid,
	"summary" text NOT NULL,
	"immediate_response" text NOT NULL,
	"state" text DEFAULT 'reported' NOT NULL,
	"reported_by" uuid NOT NULL,
	"reported_as" text NOT NULL,
	"reported_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"officer_id" uuid,
	"investigation" text,
	"root_cause" text,
	"investigated_at" timestamp with time zone,
	"report_required" boolean,
	"report_recipient" text,
	"report_due_on" date,
	"submitted_at" timestamp with time zone,
	"submission_ref" text,
	"corrective_action" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"command_key" text NOT NULL,
	CONSTRAINT "clinical_incidents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "clinical_incidents_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "clinical_incidents_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "clinical_incidents_check" CHECK ("clinical_incidents"."classification" in ('ktd','knc','ktc','kpc','sentinel') and "clinical_incidents"."state" in ('reported','investigating','closed') and "clinical_incidents"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and ("clinical_incidents"."classification" <> 'kpc' or "clinical_incidents"."patient_id" is null) and ("clinical_incidents"."visit_id" is null or "clinical_incidents"."patient_id" is not null)
      and ("clinical_incidents"."state" = 'reported') = ("clinical_incidents"."officer_id" is null)
      and ("clinical_incidents"."investigated_at" is null) = ("clinical_incidents"."investigation" is null) and ("clinical_incidents"."investigation" is null) = ("clinical_incidents"."root_cause" is null)
      and ("clinical_incidents"."report_required" is not false or "clinical_incidents"."report_recipient" is null and "clinical_incidents"."report_due_on" is null)
      and ("clinical_incidents"."report_required" is not true or "clinical_incidents"."report_recipient" is not null and "clinical_incidents"."report_due_on" is not null)
      and ("clinical_incidents"."submitted_at" is null) = ("clinical_incidents"."submission_ref" is null) and ("clinical_incidents"."submitted_at" is null or "clinical_incidents"."report_required" is true)
      and ("clinical_incidents"."state" = 'closed') = ("clinical_incidents"."closed_at" is not null) and ("clinical_incidents"."closed_at" is null) = ("clinical_incidents"."closed_by" is null)
      and ("clinical_incidents"."state" <> 'closed' or "clinical_incidents"."investigated_at" is not null and "clinical_incidents"."corrective_action" is not null and "clinical_incidents"."report_required" is not null
           and ("clinical_incidents"."report_required" is false or "clinical_incidents"."submitted_at" is not null))),
	CONSTRAINT "clinical_incidents_text_check" CHECK (length(btrim("clinical_incidents"."summary")) between 3 and 1000 and length(btrim("clinical_incidents"."immediate_response")) between 3 and 1000
      and ("clinical_incidents"."investigation" is null or length(btrim("clinical_incidents"."investigation")) between 3 and 2000) and ("clinical_incidents"."root_cause" is null or length(btrim("clinical_incidents"."root_cause")) between 3 and 1000) and ("clinical_incidents"."report_recipient" is null or length(btrim("clinical_incidents"."report_recipient")) between 2 and 200)
      and ("clinical_incidents"."submission_ref" is null or length(btrim("clinical_incidents"."submission_ref")) between 1 and 120) and ("clinical_incidents"."corrective_action" is null or length(btrim("clinical_incidents"."corrective_action")) between 3 and 1000))
);
--> statement-breakpoint
CREATE TABLE "device_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"interval_days" integer NOT NULL,
	"next_due_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "device_schedules_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "device_schedules_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "device_schedules_device_kind_key" UNIQUE("tenant_id","device_id","kind"),
	CONSTRAINT "device_schedules_check" CHECK ("device_schedules"."kind" in ('calibration','maintenance') and "device_schedules"."interval_days" between 1 and 1825)
);
--> statement-breakpoint
CREATE TABLE "logbook_due_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"alerted_on" date NOT NULL,
	CONSTRAINT "logbook_due_alerts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "logbook_due_alerts_key" UNIQUE("tenant_id","schedule_id","due_on")
);
--> statement-breakpoint
CREATE TABLE "logbook_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"performed_on" date NOT NULL,
	"device_id" uuid,
	"room_id" uuid,
	"cycle_no" text,
	"method" text,
	"items_text" text,
	"passed" boolean,
	"result" text,
	"performer_name" text,
	"certificate_no" text,
	"waste_category" text,
	"quantity_grams" bigint,
	"handler_name" text,
	"handover_ref" text,
	"note" text,
	"corrects" uuid,
	"command_key" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_as" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "logbook_entries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "logbook_entries_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "logbook_entries_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "logbook_entries_kind_check" CHECK ("logbook_entries"."kind" in ('sterilization','calibration','maintenance','b3_waste') and "logbook_entries"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and ("logbook_entries"."kind" = 'sterilization') = ("logbook_entries"."method" is not null and "logbook_entries"."passed" is not null and "logbook_entries"."items_text" is not null)
      and ("logbook_entries"."kind" in ('calibration','maintenance')) = ("logbook_entries"."result" is not null and "logbook_entries"."performer_name" is not null and "logbook_entries"."device_id" is not null)
      and ("logbook_entries"."kind" = 'b3_waste') = ("logbook_entries"."waste_category" is not null and "logbook_entries"."quantity_grams" is not null and "logbook_entries"."handler_name" is not null and "logbook_entries"."handover_ref" is not null)
      and ("logbook_entries"."kind" = 'sterilization' or "logbook_entries"."cycle_no" is null and "logbook_entries"."room_id" is null)
      and ("logbook_entries"."kind" in ('calibration','maintenance') or "logbook_entries"."certificate_no" is null)
      and ("logbook_entries"."kind" in ('sterilization','calibration','maintenance') or "logbook_entries"."device_id" is null)
      and ("logbook_entries"."method" is null or "logbook_entries"."method" in ('autoclave','chemical','uv','other'))
      and ("logbook_entries"."result" is null or "logbook_entries"."result" in ('ok','adjusted','out_of_service'))
      and ("logbook_entries"."waste_category" is null or "logbook_entries"."waste_category" in ('infectious','sharps','pharmaceutical','chemical','other'))
      and ("logbook_entries"."quantity_grams" is null or "logbook_entries"."quantity_grams" between 1 and 100000000)),
	CONSTRAINT "logbook_entries_text_check" CHECK (("logbook_entries"."cycle_no" is null or length(btrim("logbook_entries"."cycle_no")) between 1 and 40) and ("logbook_entries"."items_text" is null or length(btrim("logbook_entries"."items_text")) between 2 and 500) and ("logbook_entries"."performer_name" is null or length(btrim("logbook_entries"."performer_name")) between 2 and 120)
      and ("logbook_entries"."certificate_no" is null or length(btrim("logbook_entries"."certificate_no")) between 1 and 80) and ("logbook_entries"."handler_name" is null or length(btrim("logbook_entries"."handler_name")) between 2 and 120) and ("logbook_entries"."handover_ref" is null or length(btrim("logbook_entries"."handover_ref")) between 1 and 80) and ("logbook_entries"."note" is null or length(btrim("logbook_entries"."note")) between 3 and 500))
);
--> statement-breakpoint
ALTER TABLE "clinical_incident_events" ADD CONSTRAINT "clinical_incident_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incident_events" ADD CONSTRAINT "clinical_incident_events_incident_fk" FOREIGN KEY ("tenant_id","branch_id","incident_id") REFERENCES "public"."clinical_incidents"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incident_events" ADD CONSTRAINT "clinical_incident_events_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incidents" ADD CONSTRAINT "clinical_incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incidents" ADD CONSTRAINT "clinical_incidents_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incidents" ADD CONSTRAINT "clinical_incidents_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incidents" ADD CONSTRAINT "clinical_incidents_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incidents" ADD CONSTRAINT "clinical_incidents_reported_by_fk" FOREIGN KEY ("tenant_id","reported_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incidents" ADD CONSTRAINT "clinical_incidents_officer_fk" FOREIGN KEY ("tenant_id","officer_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_incidents" ADD CONSTRAINT "clinical_incidents_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_schedules" ADD CONSTRAINT "device_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_schedules" ADD CONSTRAINT "device_schedules_device_fk" FOREIGN KEY ("tenant_id","branch_id","device_id") REFERENCES "public"."branch_devices"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_schedules" ADD CONSTRAINT "device_schedules_set_by_fk" FOREIGN KEY ("tenant_id","set_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_due_alerts" ADD CONSTRAINT "logbook_due_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_due_alerts" ADD CONSTRAINT "logbook_due_alerts_schedule_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "public"."device_schedules"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_device_fk" FOREIGN KEY ("tenant_id","branch_id","device_id") REFERENCES "public"."branch_devices"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_room_fk" FOREIGN KEY ("tenant_id","branch_id","room_id") REFERENCES "public"."rooms"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_corrects_fk" FOREIGN KEY ("tenant_id","branch_id","corrects") REFERENCES "public"."logbook_entries"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_incident_events_incident_idx" ON "clinical_incident_events" USING btree ("tenant_id","incident_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_incidents_branch_idx" ON "clinical_incidents" USING btree ("tenant_id","branch_id","state","occurred_at");--> statement-breakpoint
CREATE INDEX "logbook_entries_branch_idx" ON "logbook_entries" USING btree ("tenant_id","branch_id","kind","performed_on");--> statement-breakpoint

-- T-068 rules (generated by gen.py; plan docs/tasks/T-068.md)
-- ── Readers and actors (PR-82; T-068) ─────────────────────────────────────────────────────────────────────────
-- Logbooks are read at the branch by the room roles and the manager (writers) and by the facility head, owner,
-- admin_pusat and auditor (readers; tenant-wide roles at any branch they may see).
CREATE FUNCTION public.logbook_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_branch_allowed(p_branch) AND (
      public.app_role_in(ARRAY['owner','admin_pusat','auditor'])
      OR public.app_role_in(ARRAY['doctor','nurse','therapist','manager','facility_head']) AND EXISTS (
        SELECT 1 FROM public.staff_branches sb
         WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.logbook_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.logbook_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Incidents are clinical: the facility head of the branch, owner and auditor read all; a reporter reads the ones
-- they reported (the incident's own reported_by, checked in the policy).
CREATE FUNCTION public.incident_readable(p_tenant uuid, p_branch uuid, p_reporter uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_branch_allowed(p_branch) AND (
      public.app_role_in(ARRAY['owner','auditor'])
      OR (public.app_role_in(ARRAY['facility_head']) OR p_reporter = public.app_staff_id()) AND EXISTS (
        SELECT 1 FROM public.staff_branches sb
         WHERE sb.tenant_id = p_tenant AND sb.staff_id = public.app_staff_id() AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.incident_readable(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.incident_readable(uuid, uuid, uuid) TO clinic_app;--> statement-breakpoint

-- The actor of the safety writers: the staff_access lock first (DEC-043), a role of p_roles; a branch role at its
-- active branch (p_branch must be it), a tenant-wide role at the named branch; the tenant serving visits.
CREATE FUNCTION public.safety_actor(p_roles text[], p_branch uuid, OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not use this safety action' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
  IF branch_id IS NULL OR p_branch IS DISTINCT FROM branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: not your active branch' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.safety_actor(text[], uuid) FROM PUBLIC;--> statement-breakpoint

-- A bounded text from a jsonb field (null when absent or blank).
CREATE FUNCTION public.safety_text(p jsonb, p_key text, p_lo integer, p_hi integer, p_required boolean) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v text := nullif(btrim(coalesce(p ->> p_key, '')), '');
BEGIN
  IF v IS NULL AND p_required OR v IS NOT NULL AND length(v) NOT BETWEEN p_lo AND p_hi THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: %', p_key USING ERRCODE = '22023';
  END IF;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.safety_text(jsonb, text, integer, integer, boolean) FROM PUBLIC;--> statement-breakpoint

-- A local date (YYYY-MM-DD) from a jsonb field, refused when malformed.
CREATE FUNCTION public.safety_date(p jsonb, p_key text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v text := p ->> p_key;
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: %', p_key USING ERRCODE = '22023';
  END IF;
  RETURN v::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: %', p_key USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.safety_date(jsonb, text) FROM PUBLIC;--> statement-breakpoint

-- Today at a branch (its timezone).
CREATE FUNCTION public.safety_today(p_tenant uuid, p_branch uuid) RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (clock_timestamp() AT TIME ZONE coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = p_branch), 'Asia/Jakarta'))::date
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.safety_today(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.device_schedules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY device_schedules_read ON public.device_schedules FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.logbook_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.device_schedules TO clinic_app;--> statement-breakpoint
CREATE POLICY device_schedules_operator_read ON public.device_schedules FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.device_schedules', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.device_schedules TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER device_schedules_no_truncate BEFORE TRUNCATE ON public.device_schedules FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.device_schedules ENABLE ALWAYS TRIGGER device_schedules_no_truncate;--> statement-breakpoint
ALTER TABLE public.logbook_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY logbook_entries_read ON public.logbook_entries FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.logbook_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.logbook_entries TO clinic_app;--> statement-breakpoint
CREATE POLICY logbook_entries_operator_read ON public.logbook_entries FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.logbook_entries', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.logbook_entries TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER logbook_entries_no_truncate BEFORE TRUNCATE ON public.logbook_entries FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.logbook_entries ENABLE ALWAYS TRIGGER logbook_entries_no_truncate;--> statement-breakpoint
ALTER TABLE public.clinical_incidents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinical_incidents_read ON public.clinical_incidents FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.incident_readable(tenant_id, branch_id, reported_by));--> statement-breakpoint
GRANT SELECT ON public.clinical_incidents TO clinic_app;--> statement-breakpoint
CREATE POLICY clinical_incidents_operator_read ON public.clinical_incidents FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.clinical_incidents', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.clinical_incidents TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER clinical_incidents_no_truncate BEFORE TRUNCATE ON public.clinical_incidents FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.clinical_incidents ENABLE ALWAYS TRIGGER clinical_incidents_no_truncate;--> statement-breakpoint
ALTER TABLE public.clinical_incident_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinical_incident_events_read ON public.clinical_incident_events FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.incident_readable(tenant_id, branch_id, (SELECT i.reported_by FROM public.clinical_incidents i WHERE i.tenant_id = clinical_incident_events.tenant_id AND i.id = clinical_incident_events.incident_id)));--> statement-breakpoint
GRANT SELECT ON public.clinical_incident_events TO clinic_app;--> statement-breakpoint
CREATE POLICY clinical_incident_events_operator_read ON public.clinical_incident_events FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.clinical_incident_events', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.clinical_incident_events TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER clinical_incident_events_no_truncate BEFORE TRUNCATE ON public.clinical_incident_events FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.clinical_incident_events ENABLE ALWAYS TRIGGER clinical_incident_events_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.device_schedules', 'branch-scoped', 'safety', '{doctor,nurse,therapist,manager,facility_head,owner,admin_pusat,auditor}', 'safety definers (src/modules/safety)', 'the device''s branch'),
  ('public.logbook_entries', 'branch-scoped', 'safety', '{doctor,nurse,therapist,manager,facility_head,owner,admin_pusat,auditor}', 'safety definers (src/modules/safety)', 'the branch of the entry'),
  ('public.clinical_incidents', 'clinical', 'safety', '{facility_head,owner,auditor,reporter}', 'safety definers (src/modules/safety)', 'the branch of the incident'),
  ('public.clinical_incident_events', 'clinical', 'safety', '{facility_head,owner,auditor,reporter}', 'safety definers (src/modules/safety)', 'the branch of the incident'),
  ('public.logbook_due_alerts', 'tenant-shared', 'safety', '{}', 'logbook_due_scan (src/modules/safety)', 'none');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): logbooks personal, schedules config, incidents clinical, due alerts never.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.device_schedules', 'config'),
  ('public.logbook_entries', 'personal'),
  ('public.clinical_incidents', 'clinical'),
  ('public.clinical_incident_events', 'clinical'),
  ('public.logbook_due_alerts', 'never');--> statement-breakpoint
ALTER TABLE public.logbook_due_alerts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER logbook_due_alerts_no_truncate BEFORE TRUNCATE ON public.logbook_due_alerts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.logbook_due_alerts ENABLE ALWAYS TRIGGER logbook_due_alerts_no_truncate;--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS, after the staff_access lock) ─────────────────────────────────────────────────────────
-- Logbook entries, due alerts and incident events: insert-only, never changed or deleted.
CREATE FUNCTION public.safety_insert_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% rows are never changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.safety_insert_only() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER logbook_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON public.logbook_entries FOR EACH ROW EXECUTE FUNCTION public.safety_insert_only();--> statement-breakpoint
ALTER TABLE public.logbook_entries ENABLE ALWAYS TRIGGER logbook_entries_guard;--> statement-breakpoint
CREATE TRIGGER logbook_due_alerts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.logbook_due_alerts FOR EACH ROW EXECUTE FUNCTION public.safety_insert_only();--> statement-breakpoint
ALTER TABLE public.logbook_due_alerts ENABLE ALWAYS TRIGGER logbook_due_alerts_guard;--> statement-breakpoint
CREATE TRIGGER clinical_incident_events_guard BEFORE INSERT OR UPDATE OR DELETE ON public.clinical_incident_events FOR EACH ROW EXECUTE FUNCTION public.safety_insert_only();--> statement-breakpoint
ALTER TABLE public.clinical_incident_events ENABLE ALWAYS TRIGGER clinical_incident_events_guard;--> statement-breakpoint

-- Device schedules: never deleted; device, kind and identity frozen.
CREATE FUNCTION public.device_schedules_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'device schedules are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.device_id, NEW.kind) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.device_id, OLD.kind) THEN
    RAISE EXCEPTION 'a schedule keeps its device and kind' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.device_schedules_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER device_schedules_guard BEFORE INSERT OR UPDATE OR DELETE ON public.device_schedules FOR EACH ROW EXECUTE FUNCTION public.device_schedules_guard();--> statement-breakpoint
ALTER TABLE public.device_schedules ENABLE ALWAYS TRIGGER device_schedules_guard;--> statement-breakpoint

-- Incidents: never deleted; what was reported is frozen (classification, time, patient, visit, summary, immediate
-- response, reporter, key); states reported → investigating → closed; closed is final; a set officer, finished
-- investigation, determination or submission is never changed again.
CREATE FUNCTION public.clinical_incidents_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'incidents are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'reported' OR num_nonnulls(NEW.officer_id, NEW.investigation, NEW.report_required, NEW.submitted_at, NEW.corrective_action, NEW.closed_at) > 0 THEN
      RAISE EXCEPTION 'an incident opens reported' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.classification, NEW.occurred_at, NEW.patient_id, NEW.visit_id, NEW.summary, NEW.immediate_response,
      NEW.reported_by, NEW.reported_as, NEW.reported_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.classification, OLD.occurred_at, OLD.patient_id, OLD.visit_id, OLD.summary, OLD.immediate_response,
      OLD.reported_by, OLD.reported_as, OLD.reported_at, OLD.command_key)
     OR OLD.state = 'closed'
     OR NOT (OLD.state = NEW.state OR OLD.state = 'reported' AND NEW.state = 'investigating' OR OLD.state = 'investigating' AND NEW.state = 'closed')
     OR OLD.officer_id IS NOT NULL AND NEW.officer_id IS DISTINCT FROM OLD.officer_id
     OR OLD.investigated_at IS NOT NULL AND (NEW.investigation, NEW.root_cause, NEW.investigated_at) IS DISTINCT FROM (OLD.investigation, OLD.root_cause, OLD.investigated_at)
     OR OLD.report_required IS NOT NULL AND (NEW.report_required, NEW.report_recipient, NEW.report_due_on) IS DISTINCT FROM (OLD.report_required, OLD.report_recipient, OLD.report_due_on)
     OR OLD.submitted_at IS NOT NULL AND (NEW.submitted_at, NEW.submission_ref) IS DISTINCT FROM (OLD.submitted_at, OLD.submission_ref) THEN
    RAISE EXCEPTION 'an incident only moves forward and keeps what was recorded' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clinical_incidents_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER clinical_incidents_guard BEFORE INSERT OR UPDATE OR DELETE ON public.clinical_incidents FOR EACH ROW EXECUTE FUNCTION public.clinical_incidents_guard();--> statement-breakpoint
ALTER TABLE public.clinical_incidents ENABLE ALWAYS TRIGGER clinical_incidents_guard;--> statement-breakpoint

-- Alert types (system-only, ids only): the manager of the branch when a device passes its calibration or
-- maintenance due date without an entry (scenario PR-82); the facility head when an incident is reported.
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('logbook_calibration_due', 'Alat lewat jatuh tempo kalibrasi', '{manager}', '{device_schedule}', false),
  ('logbook_maintenance_due', 'Alat lewat jatuh tempo perawatan', '{manager}', '{device_schedule}', false),
  ('incident_reported', 'Insiden keselamatan pasien dilaporkan', '{facility_head}', '{clinical_incident}', false);--> statement-breakpoint

-- ── Writers (PR-82) ─────────────────────────────────────────────────────────────────────────────────────────────
-- Logbook writers: the room roles and the manager at their active branch. Schedules: the manager.
-- Incident reporters: the clinical roles and the manager; the facility head handles.

-- ── device_schedule_set: the calibration / maintenance interval of a device (manager) ───────────────────────────
-- p: {device_id, kind, interval_days, next_due_on, active?}. Upsert per device and kind.
CREATE FUNCTION public.device_schedule_set(p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.safety_actor(ARRAY['manager'], p_branch);
  v_device uuid;
  v_days integer;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p ->> 'kind', '') NOT IN ('calibration','maintenance') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kind' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p -> 'interval_days') IS DISTINCT FROM 'number' OR (p ->> 'interval_days') !~ '^\d{1,4}$' OR (p ->> 'interval_days')::integer NOT BETWEEN 1 AND 1825 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: interval_days' USING ERRCODE = '22023';
  END IF;
  v_days := (p ->> 'interval_days')::integer;
  SELECT d.id INTO v_device FROM public.branch_devices d
   WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.id::text = p ->> 'device_id' AND d.is_active;
  IF v_device IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: device not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.device_schedules AS s (tenant_id, branch_id, device_id, kind, interval_days, next_due_on, active, set_by)
  VALUES (a.tenant_id, a.branch_id, v_device, p ->> 'kind', v_days, public.safety_date(p, 'next_due_on'), coalesce((p ->> 'active')::boolean, true), a.staff_id)
  ON CONFLICT (tenant_id, device_id, kind) DO UPDATE
    SET interval_days = EXCLUDED.interval_days, next_due_on = EXCLUDED.next_due_on, active = EXCLUDED.active, set_by = EXCLUDED.set_by, set_at = clock_timestamp()
  RETURNING s.id INTO v_id;
  PERFORM public.audit_append('settings_change', 'device_schedule', v_id, 'success', 'device_schedule_set');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.device_schedule_set(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.device_schedule_set(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── logbook_record: one entry (sterilization, calibration, maintenance, B3 waste) ────────────────────────────────
-- p: {kind, performed_on, device_id?, room_id?, cycle_no?, method?, items?, passed?, result?, performer_name?,
--     certificate_no?, waste_category?, quantity_grams?, handler_name?, handover_ref?, note?, corrects?}.
-- A calibration / maintenance entry moves its schedule's due date to performed_on + interval (never backwards).
CREATE FUNCTION public.logbook_record(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.safety_actor(ARRAY['doctor','nurse','therapist','manager'], p_branch);
  v_kind text := p ->> 'kind';
  v_on date;
  v_device uuid;
  v_room uuid;
  v_corrects uuid;
  v_qty bigint;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(v_kind, '') NOT IN ('sterilization','calibration','maintenance','b3_waste') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kind' USING ERRCODE = '22023';
  END IF;
  v_on := public.safety_date(p, 'performed_on');
  IF v_on > public.safety_today(a.tenant_id, a.branch_id) OR v_on < public.safety_today(a.tenant_id, a.branch_id) - 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: performed_on' USING ERRCODE = '22023';
  END IF;
  IF p ? 'device_id' AND p ->> 'device_id' IS NOT NULL THEN
    SELECT d.id INTO v_device FROM public.branch_devices d WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.id::text = p ->> 'device_id';
    IF v_device IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: device not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF p ? 'room_id' AND p ->> 'room_id' IS NOT NULL THEN
    SELECT r.id INTO v_room FROM public.rooms r WHERE r.tenant_id = a.tenant_id AND r.branch_id = a.branch_id AND r.id::text = p ->> 'room_id';
    IF v_room IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: room not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF p ? 'corrects' AND p ->> 'corrects' IS NOT NULL THEN
    SELECT e.id INTO v_corrects FROM public.logbook_entries e WHERE e.tenant_id = a.tenant_id AND e.branch_id = a.branch_id AND e.id::text = p ->> 'corrects' AND e.kind = v_kind;
    IF v_corrects IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: entry not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF v_kind IN ('calibration','maintenance') AND v_device IS NULL OR v_kind = 'b3_waste' AND v_device IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: device_id' USING ERRCODE = '22023';
  END IF;
  IF v_room IS NOT NULL AND v_kind <> 'sterilization' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: room_id' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'sterilization' AND (coalesce(p ->> 'method', '') NOT IN ('autoclave','chemical','uv','other') OR jsonb_typeof(p -> 'passed') IS DISTINCT FROM 'boolean') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: sterilization' USING ERRCODE = '22023';
  END IF;
  IF v_kind IN ('calibration','maintenance') AND coalesce(p ->> 'result', '') NOT IN ('ok','adjusted','out_of_service') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: result' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'b3_waste' THEN
    IF coalesce(p ->> 'waste_category', '') NOT IN ('infectious','sharps','pharmaceutical','chemical','other') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: waste_category' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p -> 'quantity_grams') IS DISTINCT FROM 'number' OR (p ->> 'quantity_grams') !~ '^\d{1,9}$' OR (p ->> 'quantity_grams')::bigint NOT BETWEEN 1 AND 100000000 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity_grams' USING ERRCODE = '22023';
    END IF;
    v_qty := (p ->> 'quantity_grams')::bigint;
  END IF;
  INSERT INTO public.logbook_entries (tenant_id, branch_id, kind, performed_on, device_id, room_id, cycle_no, method, items_text, passed, result, performer_name,
                                      certificate_no, waste_category, quantity_grams, handler_name, handover_ref, note, corrects, command_key, recorded_by, recorded_as)
  VALUES (a.tenant_id, a.branch_id, v_kind, v_on, v_device, v_room,
          CASE WHEN v_kind = 'sterilization' THEN public.safety_text(p, 'cycle_no', 1, 40, false) END,
          CASE WHEN v_kind = 'sterilization' THEN p ->> 'method' END,
          CASE WHEN v_kind = 'sterilization' THEN public.safety_text(p, 'items', 2, 500, true) END,
          CASE WHEN v_kind = 'sterilization' THEN (p ->> 'passed')::boolean END,
          CASE WHEN v_kind IN ('calibration','maintenance') THEN p ->> 'result' END,
          CASE WHEN v_kind IN ('calibration','maintenance') THEN public.safety_text(p, 'performer_name', 2, 120, true) END,
          CASE WHEN v_kind IN ('calibration','maintenance') THEN public.safety_text(p, 'certificate_no', 1, 80, false) END,
          CASE WHEN v_kind = 'b3_waste' THEN p ->> 'waste_category' END, v_qty,
          CASE WHEN v_kind = 'b3_waste' THEN public.safety_text(p, 'handler_name', 2, 120, true) END,
          CASE WHEN v_kind = 'b3_waste' THEN public.safety_text(p, 'handover_ref', 1, 80, true) END,
          public.safety_text(p, 'note', 3, 500, false), v_corrects, p_key, a.staff_id, a.role)
  RETURNING id INTO v_id;
  IF v_kind IN ('calibration','maintenance') AND v_corrects IS NULL THEN
    UPDATE public.device_schedules s SET next_due_on = greatest(s.next_due_on, v_on + s.interval_days)
     WHERE s.tenant_id = a.tenant_id AND s.device_id = v_device AND s.kind = v_kind;
  END IF;
  PERFORM public.audit_append('settings_change', 'logbook_entry', v_id, 'success', 'logbook_' || replace(v_kind, 'b3_', ''));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.logbook_record(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.logbook_record(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── logbook_due_scan: the daily job (unbound worker connection, like credential_alert_scan) ─────────────────────
-- Every active schedule past its due date (branch today) without an entry raises one alert to the branch manager
-- per schedule and due date (scenario PR-82). Returns the number of alerts raised.
CREATE FUNCTION public.logbook_due_scan(p_today date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s record;
  v_today date;
  v_alert uuid;
  v_sent integer := 0;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'logbook_due_scan runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  FOR s IN
    SELECT x.* FROM public.device_schedules x
      JOIN public.tenants_registry r ON r.id = x.tenant_id AND r.lifecycle_state IN ('onboarding','live','suspended')
      JOIN public.branch_devices d ON d.tenant_id = x.tenant_id AND d.id = x.device_id AND d.is_active
     WHERE x.active
     ORDER BY x.tenant_id, x.id
  LOOP
    v_today := coalesce(p_today, public.safety_today(s.tenant_id, s.branch_id));
    CONTINUE WHEN s.next_due_on >= v_today;
    v_alert := NULL;
    INSERT INTO public.logbook_due_alerts (tenant_id, schedule_id, due_on, alerted_on) VALUES (s.tenant_id, s.id, s.next_due_on, v_today)
      ON CONFLICT (tenant_id, schedule_id, due_on) DO NOTHING RETURNING id INTO v_alert;
    CONTINUE WHEN v_alert IS NULL;
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id)
    VALUES (s.tenant_id, 'logbook_' || s.kind || '_due', 'manager', s.branch_id, 'device_schedule', s.id);
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.logbook_due_scan(date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.logbook_due_scan(date) TO clinic_app;--> statement-breakpoint

-- ── incident_report: Catat Insiden (clinical roles and the manager) ─────────────────────────────────────────────
-- p: {classification, occurred_at, patient_id?, visit_id?, summary, immediate_response}. KPC (potential) has no
-- patient; a visit must be the patient's at the branch. The facility head of the branch is notified (ids only).
CREATE FUNCTION public.incident_report(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.safety_actor(ARRAY['doctor','nurse','therapist','pharmacist','bc','manager','facility_head'], p_branch);
  v_class text := p ->> 'classification';
  v_at timestamptz;
  v_patient uuid;
  v_visit uuid;
  v_id uuid;
  v_event uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(v_class, '') NOT IN ('ktd','knc','ktc','kpc','sentinel') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: classification' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_at := (p ->> 'occurred_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: occurred_at' USING ERRCODE = '22023';
  END;
  IF v_at IS NULL OR v_at > clock_timestamp() + interval '5 minutes' OR v_at < clock_timestamp() - interval '366 days' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: occurred_at' USING ERRCODE = '22023';
  END IF;
  IF p ->> 'patient_id' IS NOT NULL THEN
    IF v_class = 'kpc' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: patient_id' USING ERRCODE = '22023';
    END IF;
    SELECT x.id INTO v_patient FROM public.patients x WHERE x.tenant_id = a.tenant_id AND x.id::text = p ->> 'patient_id';
    IF v_patient IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF p ->> 'visit_id' IS NOT NULL THEN
    SELECT v.id INTO v_visit FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.branch_id = a.branch_id AND v.id::text = p ->> 'visit_id' AND v.patient_id = v_patient;
    IF v_visit IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  INSERT INTO public.clinical_incidents (tenant_id, branch_id, classification, occurred_at, patient_id, visit_id, summary, immediate_response, reported_by, reported_as, command_key)
  VALUES (a.tenant_id, a.branch_id, v_class, v_at, v_patient, v_visit, public.safety_text(p, 'summary', 3, 1000, true),
          public.safety_text(p, 'immediate_response', 3, 1000, true), a.staff_id, a.role, p_key)
  RETURNING id INTO v_id;
  INSERT INTO public.clinical_incident_events (tenant_id, branch_id, incident_id, kind, actor_id, actor_role) VALUES (a.tenant_id, a.branch_id, v_id, 'reported', a.staff_id, a.role);
  PERFORM public.audit_append('settings_change', 'clinical_incident', v_id, 'success', 'incident_reported');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'IncidentReported', 'clinical_incident', v_id, jsonb_build_object('incident_id', v_id, 'branch_id', a.branch_id, 'classification', v_class))
  RETURNING id INTO v_event;
  INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, source_event_id, raised_by)
  VALUES (a.tenant_id, 'incident_reported', 'facility_head', a.branch_id, 'clinical_incident', v_id, v_event, a.staff_id);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.incident_report(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.incident_report(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── incident_handle: the facility head's steps on one incident ──────────────────────────────────────────────────
-- p_step: take | investigate {investigation, root_cause} | determine {report_required, recipient?, due_on?} |
--         submit {submitted_on, reference} | close {corrective_action}. Each step is recorded once; close needs a
--         finished investigation, a determination and (when required) a submission.
CREATE FUNCTION public.incident_handle(p_incident uuid, p_step text, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  i public.clinical_incidents;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT * INTO i FROM public.clinical_incidents x WHERE x.tenant_id = a.tenant_id AND x.id = p_incident FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: incident not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.safety_actor(ARRAY['facility_head'], i.branch_id);
  IF jsonb_typeof(coalesce(p, '{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: body' USING ERRCODE = '22023';
  END IF;
  p := coalesce(p, '{}'::jsonb);
  IF i.state = 'closed' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: incident closed' USING ERRCODE = '55000';
  END IF;
  IF p_step = 'take' THEN
    IF i.state <> 'reported' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already taken' USING ERRCODE = '55000';
    END IF;
    UPDATE public.clinical_incidents SET state = 'investigating', officer_id = a.staff_id WHERE tenant_id = i.tenant_id AND id = i.id;
  ELSIF i.state = 'reported' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_taken' USING ERRCODE = '55000';
  ELSIF p_step = 'investigate' THEN
    IF i.investigated_at IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already investigated' USING ERRCODE = '55000';
    END IF;
    UPDATE public.clinical_incidents SET investigation = public.safety_text(p, 'investigation', 3, 2000, true), root_cause = public.safety_text(p, 'root_cause', 3, 1000, true),
           investigated_at = clock_timestamp()
     WHERE tenant_id = i.tenant_id AND id = i.id;
  ELSIF p_step = 'determine' THEN
    IF i.report_required IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already determined' USING ERRCODE = '55000';
    END IF;
    IF jsonb_typeof(p -> 'report_required') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: report_required' USING ERRCODE = '22023';
    END IF;
    IF (p ->> 'report_required')::boolean THEN
      UPDATE public.clinical_incidents SET report_required = true, report_recipient = public.safety_text(p, 'recipient', 2, 200, true), report_due_on = public.safety_date(p, 'due_on')
       WHERE tenant_id = i.tenant_id AND id = i.id;
    ELSE
      UPDATE public.clinical_incidents SET report_required = false WHERE tenant_id = i.tenant_id AND id = i.id;
    END IF;
  ELSIF p_step = 'submit' THEN
    IF i.report_required IS NOT TRUE THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_report_required' USING ERRCODE = '55000';
    END IF;
    IF i.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already submitted' USING ERRCODE = '55000';
    END IF;
    UPDATE public.clinical_incidents SET submitted_at = clock_timestamp(), submission_ref = public.safety_text(p, 'reference', 1, 120, true)
     WHERE tenant_id = i.tenant_id AND id = i.id;
  ELSIF p_step = 'close' THEN
    IF i.investigated_at IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: investigation_unfinished' USING ERRCODE = '55000';
    END IF;
    IF i.report_required IS NULL OR i.report_required AND i.submitted_at IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: report_not_submitted' USING ERRCODE = '55000';
    END IF;
    UPDATE public.clinical_incidents SET state = 'closed', corrective_action = public.safety_text(p, 'corrective_action', 3, 1000, true), closed_by = a.staff_id, closed_at = clock_timestamp()
     WHERE tenant_id = i.tenant_id AND id = i.id;
  ELSE
    RAISE EXCEPTION 'ERR_INVALID_INPUT: step' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.clinical_incident_events (tenant_id, branch_id, incident_id, kind, actor_id, actor_role)
  VALUES (i.tenant_id, i.branch_id, i.id, CASE p_step WHEN 'take' THEN 'taken' WHEN 'investigate' THEN 'investigated' WHEN 'determine' THEN 'determined'
                                                       WHEN 'submit' THEN 'submitted' ELSE 'closed' END, a.staff_id, a.role);
  PERFORM public.audit_append('settings_change', 'clinical_incident', i.id, 'success', 'incident_' || p_step);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.incident_handle(uuid, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.incident_handle(uuid, text, jsonb) TO clinic_app;--> statement-breakpoint

-- ── Readers (PR-82) ─────────────────────────────────────────────────────────────────────────────────────────────
-- The reader actor: the staff_access lock first; a logbook or incident role; the tenant may read clinical data.
CREATE FUNCTION public.safety_reader(p_roles text[], OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read this register' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot read clinical data now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.safety_reader(text[]) FROM PUBLIC;--> statement-breakpoint

-- ── logbook_overview: one branch's logbook (UX-9 ▸ Logbook) ─────────────────────────────────────────────────────
-- {role, can_write, can_schedule, today, devices: [{id, label, type, active, schedules: [{id, kind, interval_days,
-- next_due_on, overdue}]}], rooms: [{id, name}], entries: [last 200 of p_kind or all, newest first]}. A device whose
-- schedule is past its due date is overdue (without waiting for the scan).
CREATE FUNCTION public.logbook_overview(p_branch uuid, p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.safety_reader(ARRAY['doctor','nurse','therapist','manager','facility_head','owner','admin_pusat','auditor']);
  v_today date;
BEGIN
  IF p_kind IS NOT NULL AND p_kind NOT IN ('sterilization','calibration','maintenance','b3_waste') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kind' USING ERRCODE = '22023';
  END IF;
  IF p_branch IS NULL OR NOT public.logbook_readable(a.tenant_id, p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  v_today := public.safety_today(a.tenant_id, p_branch);
  RETURN jsonb_build_object(
    'role', a.role,
    'can_write', a.role IN ('doctor','nurse','therapist','manager') AND a.branch_id = p_branch,
    'can_schedule', a.role = 'manager' AND a.branch_id = p_branch,
    'today', v_today,
    'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'type', d.device_type, 'active', d.is_active,
        'schedules', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'interval_days', s.interval_days, 'next_due_on', s.next_due_on,
                                 'active', s.active, 'overdue', s.active AND d.is_active AND s.next_due_on < v_today) ORDER BY s.kind)
                               FROM public.device_schedules s WHERE s.tenant_id = d.tenant_id AND s.device_id = d.id), '[]'::jsonb))
        ORDER BY (EXISTS (SELECT 1 FROM public.device_schedules s WHERE s.tenant_id = d.tenant_id AND s.device_id = d.id AND s.active AND d.is_active AND s.next_due_on < v_today)) DESC,
                 NOT d.is_active, lower(d.label), d.id)
      FROM public.branch_devices d WHERE d.tenant_id = a.tenant_id AND d.branch_id = p_branch), '[]'::jsonb),
    'rooms', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY lower(r.name), r.id)
      FROM public.rooms r WHERE r.tenant_id = a.tenant_id AND r.branch_id = p_branch AND r.is_active), '[]'::jsonb),
    'entries', coalesce((SELECT jsonb_agg(x.j ORDER BY x.performed_on DESC, x.id DESC) FROM (
      SELECT e.performed_on, e.id, jsonb_strip_nulls(jsonb_build_object('id', e.id, 'kind', e.kind, 'performed_on', e.performed_on,
               'device_id', e.device_id, 'device_label', d.label, 'room_name', r.name, 'cycle_no', e.cycle_no, 'method', e.method, 'items', e.items_text,
               'passed', e.passed, 'result', e.result, 'performer_name', e.performer_name, 'certificate_no', e.certificate_no,
               'waste_category', e.waste_category, 'quantity_grams', e.quantity_grams, 'handler_name', e.handler_name, 'handover_ref', e.handover_ref,
               'note', e.note, 'corrects', e.corrects, 'corrected', EXISTS (SELECT 1 FROM public.logbook_entries c WHERE c.tenant_id = e.tenant_id AND c.corrects = e.id),
               'recorded_name', s.display_name, 'recorded_as', e.recorded_as, 'recorded_at', e.recorded_at)) AS j
        FROM public.logbook_entries e
        JOIN public.staff s ON s.tenant_id = e.tenant_id AND s.id = e.recorded_by
        LEFT JOIN public.branch_devices d ON d.tenant_id = e.tenant_id AND d.id = e.device_id
        LEFT JOIN public.rooms r ON r.tenant_id = e.tenant_id AND r.id = e.room_id
       WHERE e.tenant_id = a.tenant_id AND e.branch_id = p_branch
         AND (p_kind IS NULL OR e.kind = p_kind OR p_kind = 'calibration' AND e.kind = 'maintenance')
       ORDER BY e.performed_on DESC, e.id DESC LIMIT 200) x), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.logbook_overview(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.logbook_overview(uuid, text) TO clinic_app;--> statement-breakpoint

-- One incident as the reader sees it: the facility head, owner and auditor see everything; a reporter sees what they
-- reported and the state (not the investigation); patient name for clinical roles only (17:188).
CREATE FUNCTION public.incident_json(i public.clinical_incidents, p_full boolean, p_patient boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', i.id, 'branch_id', i.branch_id, 'classification', i.classification, 'occurred_at', i.occurred_at, 'state', i.state,
    'summary', i.summary, 'immediate_response', i.immediate_response, 'reported_at', i.reported_at, 'reported_as', i.reported_as,
    'reported_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = i.tenant_id AND s.id = i.reported_by),
    'mine', i.reported_by = public.app_staff_id(),
    'patient_id', CASE WHEN p_patient THEN i.patient_id END,
    'patient_name', CASE WHEN p_patient THEN (SELECT p.full_name FROM public.patients p WHERE p.tenant_id = i.tenant_id AND p.id = i.patient_id) END,
    'patient_mrn', CASE WHEN p_patient THEN (SELECT p.mrn FROM public.patients p WHERE p.tenant_id = i.tenant_id AND p.id = i.patient_id) END,
    'has_patient', i.patient_id IS NOT NULL,
    'officer_name', CASE WHEN p_full THEN (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = i.tenant_id AND s.id = i.officer_id) END,
    'investigation', CASE WHEN p_full THEN i.investigation END, 'root_cause', CASE WHEN p_full THEN i.root_cause END,
    'investigated_at', CASE WHEN p_full THEN i.investigated_at END,
    'report_required', CASE WHEN p_full THEN i.report_required END, 'report_recipient', CASE WHEN p_full THEN i.report_recipient END,
    'report_due_on', CASE WHEN p_full THEN i.report_due_on END, 'submitted_at', CASE WHEN p_full THEN i.submitted_at END,
    'submission_ref', CASE WHEN p_full THEN i.submission_ref END, 'corrective_action', CASE WHEN p_full THEN i.corrective_action END,
    'closed_at', i.closed_at))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.incident_json(public.clinical_incidents, boolean, boolean) FROM PUBLIC;--> statement-breakpoint

-- ── incident_list: the register of one branch (facility head, owner, auditor) or my reports (others) ────────────
CREATE FUNCTION public.incident_list(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.safety_reader(ARRAY['doctor','nurse','therapist','pharmacist','bc','manager','facility_head','owner','auditor']);
  v_all boolean;
BEGIN
  IF p_branch IS NULL OR NOT public.app_branch_allowed(p_branch) OR a.role NOT IN ('owner','auditor') AND a.branch_id IS DISTINCT FROM p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  v_all := a.role IN ('facility_head','owner','auditor');
  RETURN jsonb_build_object('role', a.role, 'register', v_all,
    'can_report', a.role IN ('doctor','nurse','therapist','pharmacist','bc','manager','facility_head') AND a.branch_id = p_branch,
    'can_handle', a.role = 'facility_head' AND a.branch_id = p_branch,
    'incidents', coalesce((SELECT jsonb_agg(public.incident_json(i, v_all, a.role IN ('doctor','nurse','therapist','pharmacist','bc','facility_head'))
                                            ORDER BY i.state = 'closed', i.occurred_at DESC, i.id)
      FROM public.clinical_incidents i
     WHERE i.tenant_id = a.tenant_id AND i.branch_id = p_branch AND (v_all OR i.reported_by = a.staff_id)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.incident_list(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.incident_list(uuid) TO clinic_app;--> statement-breakpoint

-- ── incident_get: one incident with its history ─────────────────────────────────────────────────────────────────
CREATE FUNCTION public.incident_get(p_incident uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.safety_reader(ARRAY['doctor','nurse','therapist','pharmacist','bc','manager','facility_head','owner','auditor']);
  i public.clinical_incidents;
  v_all boolean;
BEGIN
  SELECT * INTO i FROM public.clinical_incidents x WHERE x.tenant_id = a.tenant_id AND x.id = p_incident;
  IF NOT FOUND OR NOT public.app_branch_allowed(i.branch_id) OR a.role NOT IN ('owner','auditor') AND a.branch_id IS DISTINCT FROM i.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: incident not found' USING ERRCODE = 'P0002';
  END IF;
  v_all := a.role IN ('facility_head','owner','auditor');
  IF NOT v_all AND i.reported_by <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: incident not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.patient_id IS NOT NULL AND v_all THEN
    PERFORM public.audit_append('clinical_read', 'clinical_incident', i.id, 'success', 'incident_read');
  END IF;
  RETURN public.incident_json(i, v_all, a.role IN ('doctor','nurse','therapist','pharmacist','bc','facility_head'))
    || jsonb_build_object('can_handle', a.role = 'facility_head' AND a.branch_id = i.branch_id AND i.state <> 'closed',
         'events', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'actor_as', e.actor_role, 'at', e.created_at,
                                   'actor_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = e.tenant_id AND s.id = e.actor_id)) ORDER BY e.created_at, e.id)
                              FROM public.clinical_incident_events e WHERE e.tenant_id = i.tenant_id AND e.incident_id = i.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.incident_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.incident_get(uuid) TO clinic_app;--> statement-breakpoint

-- ── incident_patient_options: the patients of the reporter's branch visits today, for Catat Insiden ─────────────
CREATE FUNCTION public.incident_patient_options(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.safety_actor(ARRAY['doctor','nurse','therapist','pharmacist','bc','facility_head'], p_branch);
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('patient_id', p.id, 'visit_id', v.id, 'name', p.full_name, 'mrn', p.mrn) ORDER BY lower(p.full_name), v.id)
    FROM public.visits v JOIN public.patients p ON p.tenant_id = v.tenant_id AND p.id = v.patient_id
   WHERE v.tenant_id = a.tenant_id AND v.branch_id = a.branch_id
     AND (v.checked_in_at AT TIME ZONE coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = a.branch_id), 'Asia/Jakarta'))::date
         >= public.safety_today(a.tenant_id, a.branch_id) - 7), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.incident_patient_options(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.incident_patient_options(uuid) TO clinic_app;
