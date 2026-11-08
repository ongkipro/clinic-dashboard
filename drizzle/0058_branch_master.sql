CREATE TABLE "branch_closures" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"closed_on" date NOT NULL,
	"from_time" time,
	"until_time" time,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_closures_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "branch_closures_range_check" CHECK (("branch_closures"."from_time" is null) = ("branch_closures"."until_time" is null) and ("branch_closures"."from_time" is null or "branch_closures"."from_time" < "branch_closures"."until_time")),
	CONSTRAINT "branch_closures_reason_check" CHECK (length(btrim("branch_closures"."reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "branch_devices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_type" text NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_devices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "branch_devices_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "branch_devices_type_check" CHECK ("branch_devices"."device_type" in ('laser','laser_ablative','laser_non_ablative','ipl','rf','hifu','microneedling_device','centrifuge','facial_machine')),
	CONSTRAINT "branch_devices_label_check" CHECK (length(btrim("branch_devices"."label")) between 2 and 80)
);
--> statement-breakpoint
CREATE TABLE "branch_hours" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens" time NOT NULL,
	"closes" time NOT NULL,
	CONSTRAINT "branch_hours_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "branch_hours_slot_key" UNIQUE("tenant_id","branch_id","weekday","opens"),
	CONSTRAINT "branch_hours_weekday_check" CHECK ("branch_hours"."weekday" between 0 and 6),
	CONSTRAINT "branch_hours_range_check" CHECK ("branch_hours"."opens" < "branch_hours"."closes")
);
--> statement-breakpoint
CREATE TABLE "branch_services" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "branch_services_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "branch_services_item_key" UNIQUE("tenant_id","branch_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"satusehat_location_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "rooms_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "rooms_kind_check" CHECK ("rooms"."kind" in ('consultation','treatment','pharmacy')),
	CONSTRAINT "rooms_name_check" CHECK (length(btrim("rooms"."name")) between 2 and 80),
	CONSTRAINT "rooms_satusehat_check" CHECK (coalesce(length("rooms"."satusehat_location_id"), 0) <= 100)
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "whatsapp_number" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "licence_number" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "nib" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "facility_code" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "satusehat_org_id" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "responsible_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "publish_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "publish_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "branch_closures" ADD CONSTRAINT "branch_closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_closures" ADD CONSTRAINT "branch_closures_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_closures" ADD CONSTRAINT "branch_closures_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_devices" ADD CONSTRAINT "branch_devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_devices" ADD CONSTRAINT "branch_devices_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_devices_label_key" ON "branch_devices" USING btree ("tenant_id","branch_id",lower(btrim("label")));--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_name_key" ON "rooms" USING btree ("tenant_id","branch_id",lower(btrim("name")));--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_map_url_check" CHECK ("branches"."map_url" is null or ("branches"."map_url" ~ '^https://' and length("branches"."map_url") <= 500));--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_whatsapp_check" CHECK ("branches"."whatsapp_number" is null or "branches"."whatsapp_number" ~ '^\+[1-9][0-9]{7,14}$');--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_nib_check" CHECK ("branches"."nib" is null or "branches"."nib" ~ '^[0-9]{13}$');--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_licence_check" CHECK (coalesce(length("branches"."licence_number"), 0) <= 100 and coalesce(length("branches"."facility_code"), 0) <= 50 and coalesce(length("branches"."satusehat_org_id"), 0) <= 100 and coalesce(length("branches"."address"), 0) <= 300);--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_publish_check" CHECK ("branches"."publish_from" is null or "branches"."publish_until" is null or "branches"."publish_until" > "branches"."publish_from");;--> statement-breakpoint

-- T-036 rules (generated; see header)
-- T-036 (PR-2, DATA-11, DATA-46, SET-2, SET-3, SET-46; plan docs/tasks/T-036.md): the branch master.
-- Authority per section (plan r1 open point 2): identity, timezone, contacts, location, publish window,
-- licence data and services offered belong to Owner and Admin Pusat (IAM-11, SET-3, SET-46); hours,
-- closures, rooms and devices also to the manager of that branch (SET-2, 19:69). Owner and Admin Pusat
-- act on every branch even with one selected (HYG-009 N2).

-- The responsible person (Penanggung Jawab, SET-46) is staff of the same tenant.
ALTER TABLE public.branches ADD CONSTRAINT branches_responsible_staff_fk FOREIGN KEY (tenant_id, responsible_staff_id)
  REFERENCES public.staff (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint

-- ── Readers: branch data is operational, every member reads it (DATA-11) ────────────────────
ALTER TABLE public.branch_hours ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY branch_hours_read ON public.branch_hours FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.branch_hours TO clinic_app;--> statement-breakpoint
ALTER TABLE public.branch_closures ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY branch_closures_read ON public.branch_closures FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.branch_closures TO clinic_app;--> statement-breakpoint
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY rooms_read ON public.rooms FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.rooms TO clinic_app;--> statement-breakpoint
ALTER TABLE public.branch_devices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY branch_devices_read ON public.branch_devices FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.branch_devices TO clinic_app;--> statement-breakpoint
ALTER TABLE public.branch_services ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY branch_services_read ON public.branch_services FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.branch_services TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.branch_hours', 'tenant-shared', 'org', '{*}', 'branch functions (src/modules/org/branches)', 'branch of the row'),
  ('public.branch_closures', 'tenant-shared', 'org', '{*}', 'branch functions (src/modules/org/branches)', 'branch of the row'),
  ('public.rooms', 'branch-scoped', 'org', '{*}', 'branch functions (src/modules/org/branches)', 'branch of the room'),
  ('public.branch_devices', 'branch-scoped', 'org', '{*}', 'branch functions (src/modules/org/branches)', 'branch of the device'),
  ('public.branch_services', 'tenant-shared', 'org', '{*}', 'branch functions (src/modules/org/branches)', 'branch of the row');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): branch configuration.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.branch_hours', 'config'), ('public.branch_closures', 'config'), ('public.rooms', 'config'),
  ('public.branch_devices', 'config'), ('public.branch_services', 'config');--> statement-breakpoint
CREATE POLICY branch_hours_operator_read ON public.branch_hours FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.branch_hours', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.branch_hours TO clinic_operator;--> statement-breakpoint
CREATE POLICY branch_closures_operator_read ON public.branch_closures FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.branch_closures', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.branch_closures TO clinic_operator;--> statement-breakpoint
CREATE POLICY rooms_operator_read ON public.rooms FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.rooms', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.rooms TO clinic_operator;--> statement-breakpoint
CREATE POLICY branch_devices_operator_read ON public.branch_devices FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.branch_devices', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.branch_devices TO clinic_operator;--> statement-breakpoint
CREATE POLICY branch_services_operator_read ON public.branch_services FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.branch_services', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.branch_services TO clinic_operator;--> statement-breakpoint

-- ── Guards (plan r1 P1-3) ───────────────────────────────────────────────────────────────────
-- Branches are never deleted; id, tenant, code and creation stay fixed.
CREATE FUNCTION public.branches_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'branches are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.code, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.code, OLD.created_at) THEN
    RAISE EXCEPTION 'a branch keeps its id, tenant and code' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branches_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER branches_guard BEFORE UPDATE OR DELETE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.branches_guard();--> statement-breakpoint
ALTER TABLE public.branches ENABLE ALWAYS TRIGGER branches_guard;--> statement-breakpoint
CREATE TRIGGER branches_no_truncate BEFORE TRUNCATE ON public.branches FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Rooms and devices: deactivated, never deleted; their branch, id and creation never change.
CREATE FUNCTION public.branch_resources_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rooms and devices are deactivated, never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a room or device keeps its branch' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_resources_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER rooms_guard BEFORE UPDATE OR DELETE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.branch_resources_guard();--> statement-breakpoint
ALTER TABLE public.rooms ENABLE ALWAYS TRIGGER rooms_guard;--> statement-breakpoint
CREATE TRIGGER rooms_no_truncate BEFORE TRUNCATE ON public.rooms FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER branch_devices_guard BEFORE UPDATE OR DELETE ON public.branch_devices FOR EACH ROW EXECUTE FUNCTION public.branch_resources_guard();--> statement-breakpoint
ALTER TABLE public.branch_devices ENABLE ALWAYS TRIGGER branch_devices_guard;--> statement-breakpoint
CREATE TRIGGER branch_devices_no_truncate BEFORE TRUNCATE ON public.branch_devices FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Closures: added or removed only while their date is today or later in the branch timezone (wall
-- clock; owner-approved worker question 2, 2026-11-08); a past closure is kept. Never edited. No two
-- overlapping closures on one date.
CREATE FUNCTION public.branch_closures_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.branch_closures;
  v_today date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a closure is added or removed, never edited' USING ERRCODE = '42501';
  END IF;
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT (clock_timestamp() AT TIME ZONE b.timezone)::date INTO v_today FROM public.branches b WHERE b.tenant_id = r.tenant_id AND b.id = r.branch_id;
  IF r.closed_on < v_today THEN
    RAISE EXCEPTION 'a closure in the past is kept' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (
       SELECT 1 FROM public.branch_closures c
        WHERE c.tenant_id = r.tenant_id AND c.branch_id = r.branch_id AND c.closed_on = r.closed_on AND c.id <> r.id
          AND (c.from_time IS NULL OR r.from_time IS NULL OR (c.from_time < r.until_time AND r.from_time < c.until_time))) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: closure_overlap' USING ERRCODE = '23505';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_closures_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER branch_closures_guard BEFORE INSERT OR UPDATE OR DELETE ON public.branch_closures FOR EACH ROW EXECUTE FUNCTION public.branch_closures_guard();--> statement-breakpoint
ALTER TABLE public.branch_closures ENABLE ALWAYS TRIGGER branch_closures_guard;--> statement-breakpoint
CREATE TRIGGER branch_closures_no_truncate BEFORE TRUNCATE ON public.branch_closures FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Services offered: catalog services only, with an active version.
CREATE FUNCTION public.branch_services_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a branch service row is added or removed, never edited' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
       SELECT 1 FROM public.catalog_items i
         JOIN public.catalog_versions v ON v.tenant_id = i.tenant_id AND v.item_id = i.id AND v.state = 'active'
        WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id AND i.kind = 'service') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: services_only' USING ERRCODE = '22023';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_services_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER branch_services_guard BEFORE INSERT OR UPDATE ON public.branch_services FOR EACH ROW EXECUTE FUNCTION public.branch_services_guard();--> statement-breakpoint
ALTER TABLE public.branch_services ENABLE ALWAYS TRIGGER branch_services_guard;--> statement-breakpoint
CREATE TRIGGER branch_services_no_truncate BEFORE TRUNCATE ON public.branch_services FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER branch_hours_no_truncate BEFORE TRUNCATE ON public.branch_hours FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- ── Authority helper (plan r1 open point 2, P1-4) ───────────────────────────────────────────
-- After tenant_actor_lock: the branch must be the tenant's, and the role may change this section of it.
-- Owner and Admin Pusat: every branch. Manager: only the operational sections, and only a branch in
-- the manager's own staff_branches. Locks the branch row (staff_access -> branch -> child row -> audit).
CREATE FUNCTION public.branch_authorize(p_tenant uuid, p_staff uuid, p_role text, p_branch uuid, p_operational boolean) RETURNS public.branches
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.branches;
BEGIN
  IF NOT (p_role IN ('owner','admin_pusat') OR p_operational AND p_role = 'manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not change this part of the branch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.branches WHERE tenant_id = p_tenant AND id = p_branch FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_role = 'manager' AND NOT EXISTS (
       SELECT 1 FROM public.staff_branches sb
        WHERE sb.tenant_id = p_tenant AND sb.staff_id = p_staff AND sb.role = 'manager' AND sb.branch_id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN b;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_authorize(uuid, uuid, text, uuid, boolean) FROM PUBLIC;--> statement-breakpoint

-- One audit row and one BranchChanged event (ids and codes only) per change.
CREATE FUNCTION public.branch_changed(p_branch uuid, p_section text, p_object_kind text, p_object uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.audit_append('settings_change', p_object_kind, p_object, 'success', 'branch_' || p_section);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (p_branch, 'BranchChanged', 'branch', p_branch, jsonb_build_object('branch_id', p_branch, 'section', p_section));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_changed(uuid, text, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- ── Writers ─────────────────────────────────────────────────────────────────────────────────
-- branch_create (plan r1 open point 1): Owner and Admin Pusat add a branch; the onboarding checklist
-- follows by its existing trigger (0051). Returns the new branch id.
CREATE FUNCTION public.branch_create(p_code text, p_name text, p_timezone text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not add branches' USING ERRCODE = '42501';
  END IF;
  IF upper(btrim(coalesce(p_code, ''))) !~ '^[A-Z0-9][A-Z0-9-]{1,15}$' OR length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: code 2-16 letters, digits or dashes; name 2-120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_timezone NOT IN ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: timezone' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.branches (tenant_id, code, name, timezone) VALUES (a.tenant_id, upper(btrim(p_code)), btrim(p_name), p_timezone)
      RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: code already used' USING ERRCODE = '23505';
  END;
  PERFORM public.branch_changed(v_id, 'created', 'branch', v_id);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_create(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_create(text, text, text) TO clinic_app;--> statement-breakpoint

-- branch_update_profile: identity (name, timezone, address), contacts (WhatsApp), location (map),
-- publish window and licence data (SET-46). Owner and Admin Pusat. Omitted keys keep their value; an
-- empty string clears an optional field. The responsible person must be active staff of the tenant now.
CREATE FUNCTION public.branch_update_profile(p_branch uuid, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  f jsonb := coalesce(p, '{}'::jsonb);
  v_staff uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, false);
  IF jsonb_typeof(f) <> 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: fields must be an object' USING ERRCODE = '22023';
  END IF;
  IF f ? 'name' AND length(btrim(coalesce(f ->> 'name', ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: name' USING ERRCODE = '22023';
  END IF;
  IF f ? 'timezone' AND coalesce(f ->> 'timezone', '') NOT IN ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: timezone' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(f ->> 'responsible_staff_id', '') IS NOT NULL THEN
    IF f ->> 'responsible_staff_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: responsible_staff' USING ERRCODE = '22023';
    END IF;
    v_staff := (f ->> 'responsible_staff_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.staff s JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                    WHERE s.tenant_id = a.tenant_id AND s.id = v_staff
                      AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: responsible_staff' USING ERRCODE = '22023';
    END IF;
  END IF;
  BEGIN
    UPDATE public.branches SET
      name = CASE WHEN f ? 'name' THEN btrim(f ->> 'name') ELSE name END,
      timezone = CASE WHEN f ? 'timezone' THEN f ->> 'timezone' ELSE timezone END,
      address = CASE WHEN f ? 'address' THEN NULLIF(btrim(f ->> 'address'), '') ELSE address END,
      whatsapp_number = CASE WHEN f ? 'whatsapp_number' THEN NULLIF(btrim(f ->> 'whatsapp_number'), '') ELSE whatsapp_number END,
      map_url = CASE WHEN f ? 'map_url' THEN NULLIF(btrim(f ->> 'map_url'), '') ELSE map_url END,
      licence_number = CASE WHEN f ? 'licence_number' THEN NULLIF(btrim(f ->> 'licence_number'), '') ELSE licence_number END,
      nib = CASE WHEN f ? 'nib' THEN NULLIF(btrim(f ->> 'nib'), '') ELSE nib END,
      facility_code = CASE WHEN f ? 'facility_code' THEN NULLIF(btrim(f ->> 'facility_code'), '') ELSE facility_code END,
      satusehat_org_id = CASE WHEN f ? 'satusehat_org_id' THEN NULLIF(btrim(f ->> 'satusehat_org_id'), '') ELSE satusehat_org_id END,
      responsible_staff_id = CASE WHEN f ? 'responsible_staff_id' THEN v_staff ELSE responsible_staff_id END,
      publish_from = CASE WHEN f ? 'publish_from' THEN NULLIF(f ->> 'publish_from', '')::timestamptz ELSE publish_from END,
      publish_until = CASE WHEN f ? 'publish_until' THEN NULLIF(f ->> 'publish_until', '')::timestamptz ELSE publish_until END
     WHERE tenant_id = a.tenant_id AND id = p_branch;
  EXCEPTION
    WHEN check_violation OR invalid_datetime_format OR datetime_field_overflow THEN
      DECLARE v_c text;
      BEGIN
        GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
        RAISE EXCEPTION 'ERR_INVALID_INPUT: %', coalesce(NULLIF(v_c, ''), 'invalid value') USING ERRCODE = '22023';
      END;
  END;
  PERFORM public.branch_changed(p_branch, 'profile', 'branch', p_branch);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_update_profile(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_update_profile(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- branch_set_hours (plan r1 P1-1): replaces the whole weekly set, [{weekday 0-6, opens "HH:MM",
-- closes "HH:MM"}], under the branch row lock; overlaps on one weekday are refused. No reason.
CREATE FUNCTION public.branch_set_hours(p_branch uuid, p_weekly jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, true);
  IF jsonb_typeof(coalesce(p_weekly, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_weekly) > 28 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: weekly hours must be a list of at most 28 intervals' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_weekly) x
              WHERE jsonb_typeof(x -> 'weekday') IS DISTINCT FROM 'number'
                 OR coalesce(x ->> 'opens', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                 OR coalesce(x ->> 'closes', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: hours_format' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_weekly) x
              WHERE (x ->> 'weekday')::numeric NOT IN (0,1,2,3,4,5,6)
                 OR (x ->> 'opens')::time >= (CASE WHEN x ->> 'closes' = '24:00' THEN time '23:59:59.999999' ELSE (x ->> 'closes')::time END)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: hours_range' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_weekly) WITH ORDINALITY x(v, i)
               JOIN jsonb_array_elements(p_weekly) WITH ORDINALITY y(v, j) ON x.i < y.j AND (x.v ->> 'weekday') = (y.v ->> 'weekday')
              WHERE (x.v ->> 'opens')::time < (CASE WHEN y.v ->> 'closes' = '24:00' THEN time '23:59:59.999999' ELSE (y.v ->> 'closes')::time END)
                AND (y.v ->> 'opens')::time < (CASE WHEN x.v ->> 'closes' = '24:00' THEN time '23:59:59.999999' ELSE (x.v ->> 'closes')::time END)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: hours_overlap' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.branch_hours WHERE tenant_id = a.tenant_id AND branch_id = p_branch;
  INSERT INTO public.branch_hours (tenant_id, branch_id, weekday, opens, closes)
  SELECT a.tenant_id, p_branch, (x ->> 'weekday')::smallint, (x ->> 'opens')::time,
         CASE WHEN x ->> 'closes' = '24:00' THEN time '23:59:59.999999' ELSE (x ->> 'closes')::time END
    FROM jsonb_array_elements(p_weekly) x;
  PERFORM public.branch_changed(p_branch, 'hours', 'branch', p_branch);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_set_hours(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_set_hours(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- branch_closure_add: a closure on a local date (today or later in branch time), all day or for a time
-- range, with a reason. Returns its id.
CREATE FUNCTION public.branch_closure_add(p_branch uuid, p_date date, p_from time, p_until time, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, true);
  IF p_date IS NULL OR p_date < (clock_timestamp() AT TIME ZONE b.timezone)::date OR p_date > (clock_timestamp() AT TIME ZONE b.timezone)::date + 730 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: closure_date' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.branch_closures (tenant_id, branch_id, closed_on, from_time, until_time, reason, created_by)
    VALUES (a.tenant_id, p_branch, p_date, p_from, p_until, btrim(coalesce(p_reason, '')), a.staff_id) RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation THEN
    DECLARE v_c text;
    BEGIN
      GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
      RAISE EXCEPTION 'ERR_INVALID_INPUT: %', coalesce(NULLIF(v_c, ''), 'invalid value') USING ERRCODE = '22023';
    END;
  END;
  PERFORM public.branch_changed(p_branch, 'closures', 'branch_closure', v_id);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_closure_add(uuid, date, time, time, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_closure_add(uuid, date, time, time, text) TO clinic_app;--> statement-breakpoint

-- branch_closure_remove: a closure whose date is today or later; the manager only on their branch.
CREATE FUNCTION public.branch_closure_remove(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_branch uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT branch_id INTO v_branch FROM public.branch_closures WHERE tenant_id = a.tenant_id AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: closure not found' USING ERRCODE = 'P0002';
  END IF;
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, v_branch, true);
  PERFORM 1 FROM public.branch_closures WHERE tenant_id = a.tenant_id AND id = p_id FOR UPDATE;
  IF (SELECT closed_on FROM public.branch_closures WHERE tenant_id = a.tenant_id AND id = p_id) < (clock_timestamp() AT TIME ZONE b.timezone)::date THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: closure_past' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.branch_closures WHERE tenant_id = a.tenant_id AND id = p_id;
  PERFORM public.branch_changed(v_branch, 'closures', 'branch_closure', p_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_closure_remove(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_closure_remove(uuid) TO clinic_app;--> statement-breakpoint

-- room_upsert: a new room (p_id null) or a change of name, kind or SATUSEHAT location id of an
-- existing one; it may not move to another branch. Returns the room id.
CREATE FUNCTION public.room_upsert(p_branch uuid, p_id uuid, p_name text, p_kind text, p_satusehat text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_branch uuid;
  v_id uuid := p_id;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF p_id IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM public.rooms WHERE tenant_id = a.tenant_id AND id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: room not found' USING ERRCODE = 'P0002';
    END IF;
    -- The caller's scope on the row's own branch comes first (impl review r1 P3-2): a manager of
    -- another branch gets not-found, never a hint that the room exists.
    PERFORM public.branch_authorize(a.tenant_id, a.staff_id, a.role, v_branch, true);
    IF v_branch <> p_branch THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: a room keeps its branch' USING ERRCODE = '22023';
    END IF;
  END IF;
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, true);
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.rooms (tenant_id, branch_id, name, kind, satusehat_location_id)
      VALUES (a.tenant_id, p_branch, btrim(coalesce(p_name, '')), p_kind, NULLIF(btrim(p_satusehat), '')) RETURNING id INTO v_id;
    ELSE
      PERFORM 1 FROM public.rooms WHERE tenant_id = a.tenant_id AND id = p_id FOR UPDATE;
      UPDATE public.rooms SET name = btrim(coalesce(p_name, '')), kind = p_kind, satusehat_location_id = NULLIF(btrim(p_satusehat), '')
       WHERE tenant_id = a.tenant_id AND id = p_id;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'ERR_VERSION_CONFLICT: room_name_used' USING ERRCODE = '23505';
    WHEN check_violation OR not_null_violation THEN
      DECLARE v_c text;
      BEGIN
        GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
        RAISE EXCEPTION 'ERR_INVALID_INPUT: %', coalesce(NULLIF(v_c, ''), 'invalid value') USING ERRCODE = '22023';
      END;
  END;
  PERFORM public.branch_changed(p_branch, 'rooms', 'room', v_id);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.room_upsert(uuid, uuid, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.room_upsert(uuid, uuid, text, text, text) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.room_set_active(p_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_branch uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT branch_id INTO v_branch FROM public.rooms WHERE tenant_id = a.tenant_id AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: room not found' USING ERRCODE = 'P0002';
  END IF;
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, v_branch, true);
  UPDATE public.rooms SET is_active = coalesce(p_active, false) WHERE tenant_id = a.tenant_id AND id = p_id;
  PERFORM public.branch_changed(v_branch, 'rooms', 'room', p_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.room_set_active(uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.room_set_active(uuid, boolean) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.device_upsert(p_branch uuid, p_id uuid, p_type text, p_label text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_branch uuid;
  v_id uuid := p_id;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF p_id IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM public.branch_devices WHERE tenant_id = a.tenant_id AND id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: device not found' USING ERRCODE = 'P0002';
    END IF;
    -- The caller's scope on the row's own branch comes first (impl review r1 P3-2): a manager of
    -- another branch gets not-found, never a hint that the device exists.
    PERFORM public.branch_authorize(a.tenant_id, a.staff_id, a.role, v_branch, true);
    IF v_branch <> p_branch THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: a device keeps its branch' USING ERRCODE = '22023';
    END IF;
  END IF;
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, true);
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.branch_devices (tenant_id, branch_id, device_type, label) VALUES (a.tenant_id, p_branch, p_type, btrim(coalesce(p_label, '')))
        RETURNING id INTO v_id;
    ELSE
      PERFORM 1 FROM public.branch_devices WHERE tenant_id = a.tenant_id AND id = p_id FOR UPDATE;
      UPDATE public.branch_devices SET device_type = p_type, label = btrim(coalesce(p_label, '')) WHERE tenant_id = a.tenant_id AND id = p_id;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'ERR_VERSION_CONFLICT: device_label_used' USING ERRCODE = '23505';
    WHEN check_violation OR not_null_violation THEN
      DECLARE v_c text;
      BEGIN
        GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
        RAISE EXCEPTION 'ERR_INVALID_INPUT: %', coalesce(NULLIF(v_c, ''), 'invalid value') USING ERRCODE = '22023';
      END;
  END;
  PERFORM public.branch_changed(p_branch, 'devices', 'branch_device', v_id);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.device_upsert(uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.device_upsert(uuid, uuid, text, text) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.device_set_active(p_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  v_branch uuid;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT branch_id INTO v_branch FROM public.branch_devices WHERE tenant_id = a.tenant_id AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: device not found' USING ERRCODE = 'P0002';
  END IF;
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, v_branch, true);
  UPDATE public.branch_devices SET is_active = coalesce(p_active, false) WHERE tenant_id = a.tenant_id AND id = p_id;
  PERFORM public.branch_changed(v_branch, 'devices', 'branch_device', p_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.device_set_active(uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.device_set_active(uuid, boolean) TO clinic_app;--> statement-breakpoint

-- branch_set_services: replaces the services offered (catalog services with an active version; the
-- guard checks every row too). Owner and Admin Pusat.
CREATE FUNCTION public.branch_set_services(p_branch uuid, p_items uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  b := public.branch_authorize(a.tenant_id, a.staff_id, a.role, p_branch, false);
  IF coalesce(cardinality(p_items), 0) > 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: at most 500 services' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.branch_services WHERE tenant_id = a.tenant_id AND branch_id = p_branch;
  BEGIN
    INSERT INTO public.branch_services (tenant_id, branch_id, item_id)
    SELECT DISTINCT a.tenant_id, p_branch, x FROM unnest(coalesce(p_items, '{}')) x;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: services_only' USING ERRCODE = '22023';
  END;
  PERFORM public.branch_changed(p_branch, 'services', 'branch', p_branch);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_set_services(uuid, uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_set_services(uuid, uuid[]) TO clinic_app;--> statement-breakpoint

-- ── branch_is_open (plan r1 P1-2) ───────────────────────────────────────────────────────────
-- An instant (p_until null) or an interval [p_from, p_until) in the branch timezone. An interval lies
-- on one local date, inside one weekly interval, and overlaps no closure. False, never null, for no
-- tenant, another tenant's or an unknown branch, a null start, or until before from.
CREATE FUNCTION public.branch_is_open(p_branch uuid, p_from timestamptz, p_until timestamptz DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN p_from IS NULL OR (p_until IS NOT NULL AND p_until < p_from) THEN false
      WHEN p_until IS NULL OR p_until = p_from THEN
        EXISTS (SELECT 1 FROM public.branch_hours h
                 WHERE h.tenant_id = b.tenant_id AND h.branch_id = b.id
                   AND h.weekday = extract(dow FROM (p_from AT TIME ZONE b.timezone))
                   AND h.opens <= (p_from AT TIME ZONE b.timezone)::time AND (p_from AT TIME ZONE b.timezone)::time < h.closes)
        AND NOT EXISTS (SELECT 1 FROM public.branch_closures c
                         WHERE c.tenant_id = b.tenant_id AND c.branch_id = b.id AND c.closed_on = (p_from AT TIME ZONE b.timezone)::date
                           AND (c.from_time IS NULL OR (c.from_time <= (p_from AT TIME ZONE b.timezone)::time AND (p_from AT TIME ZONE b.timezone)::time < c.until_time)))
      ELSE
        -- One local date (an interval ending exactly at midnight counts as ending on that date).
        (p_from AT TIME ZONE b.timezone)::date = ((p_until - interval '1 microsecond') AT TIME ZONE b.timezone)::date
        AND EXISTS (SELECT 1 FROM public.branch_hours h
                     WHERE h.tenant_id = b.tenant_id AND h.branch_id = b.id
                       AND h.weekday = extract(dow FROM (p_from AT TIME ZONE b.timezone))
                       AND h.opens <= (p_from AT TIME ZONE b.timezone)::time
                       -- the last instant inside the interval is before closing; "24:00" is stored as 23:59:59.999999,
                       -- so an interval ending at midnight has its last instant equal to it: allowed with <=
                       AND (((p_until - interval '1 microsecond') AT TIME ZONE b.timezone)::time < h.closes
                            OR (h.closes = time '23:59:59.999999' AND ((p_until - interval '1 microsecond') AT TIME ZONE b.timezone)::time = h.closes)))
        AND NOT EXISTS (SELECT 1 FROM public.branch_closures c
                         WHERE c.tenant_id = b.tenant_id AND c.branch_id = b.id AND c.closed_on = (p_from AT TIME ZONE b.timezone)::date
                           AND (c.from_time IS NULL OR (c.from_time < ((p_until - interval '1 microsecond') AT TIME ZONE b.timezone)::time
                                                        AND (p_from AT TIME ZONE b.timezone)::time < c.until_time)))
    END
      FROM public.branches b
     WHERE b.tenant_id = public.app_tenant_id() AND b.id = p_branch AND public.app_staff_id() IS NOT NULL), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_is_open(uuid, timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_is_open(uuid, timestamptz, timestamptz) TO clinic_app;
