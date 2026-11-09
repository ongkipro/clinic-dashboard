CREATE TABLE "patient_search_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" text NOT NULL,
	"branch_id" uuid,
	"searched_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "patient_search_log_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "patient_segments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "patient_segments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "patient_segments_name_key" UNIQUE("tenant_id","staff_id","name"),
	CONSTRAINT "patient_segments_name_check" CHECK (length(btrim("patient_segments"."name")) between 2 and 60),
	CONSTRAINT "patient_segments_filters_check" CHECK (jsonb_typeof("patient_segments"."filters") = 'object' and "patient_segments"."filters" - 'branch_id' - 'last_visit' - 'visiting_now' = '{}'::jsonb and "patient_segments"."filters" <> '{}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "patient_search_log" ADD CONSTRAINT "patient_search_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_search_log" ADD CONSTRAINT "patient_search_log_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_search_log" ADD CONSTRAINT "patient_search_log_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_segments" ADD CONSTRAINT "patient_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_segments" ADD CONSTRAINT "patient_segments_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_search_log_staff_idx" ON "patient_search_log" USING btree ("tenant_id","staff_id","searched_at");;--> statement-breakpoint

-- T-041 rules (generated; see header)
-- Search log (no query text, append-only): readable by no app role; segments: their owner only.
ALTER TABLE public.patient_search_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.patient_segments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patient_segments_read ON public.patient_segments FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND staff_id = public.app_staff_id() AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']));--> statement-breakpoint
GRANT SELECT ON public.patient_segments TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.patient_search_log', 'tenant-shared', 'patients', '{}', 'patient_search (src/modules/patients/search)', 'branch acted on, nullable'),
  ('public.patient_segments', 'tenant-shared', 'patients', '{owner,admin_pusat,manager,facility_head,records_officer,fo_cashier,central_cs,bc,doctor,nurse,therapist,pharmacist,finance}', 'segment_save, segment_delete (src/modules/patients/search)', 'none (owner only)');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): the log is never supportable (no app role reads it either, and
-- the operator never sees more than the app: B-01/B-03); segments are configuration.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.patient_search_log', 'never'), ('public.patient_segments', 'config');--> statement-breakpoint
CREATE POLICY patient_segments_operator_read ON public.patient_segments FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.patient_segments', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.patient_segments TO clinic_operator;--> statement-breakpoint

-- Guards: the log is append-only; neither table can be truncated.
CREATE FUNCTION public.patient_search_log_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'the patient search log is append-only' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_search_log_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER patient_search_log_guard BEFORE UPDATE OR DELETE ON public.patient_search_log FOR EACH ROW EXECUTE FUNCTION public.patient_search_log_guard();--> statement-breakpoint
ALTER TABLE public.patient_search_log ENABLE ALWAYS TRIGGER patient_search_log_guard;--> statement-breakpoint
CREATE TRIGGER patient_search_log_no_truncate BEFORE TRUNCATE ON public.patient_search_log FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.patient_search_log ENABLE ALWAYS TRIGGER patient_search_log_no_truncate;--> statement-breakpoint
CREATE TRIGGER patient_segments_no_truncate BEFORE TRUNCATE ON public.patient_segments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.patient_segments ENABLE ALWAYS TRIGGER patient_segments_no_truncate;--> statement-breakpoint

-- The abuse alert (PR-76): raised by the system only, to the facility head.
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('patient_search_abuse', 'Pencarian pasien melewati batas wajar', '{facility_head}', '{staff}', false);--> statement-breakpoint

-- A visit the caller may see (PR-76 "only for allowed branches", plan r1 P1-2): the branch is allowed in
-- the session and, for a Level 3 role, the role still holds it (wall clock).
CREATE FUNCTION public.patient_search_visit_visible(p_tenant uuid, p_staff uuid, p_role text, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.app_branch_allowed(p_branch) AND (p_role IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor') OR EXISTS (
    SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = p_tenant AND sb.staff_id = p_staff AND sb.role = p_role AND sb.branch_id = p_branch))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_search_visit_visible(uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Daftar Pasien search (PR-76). The query is an argument only: never stored or logged. Every call is
-- counted (a log row without text); over 200 in the last hour raises one alert per hour to the facility
-- head; over 30 in the last minute returns ERR_RATE_LIMITED (not raised, so the count and the alert
-- commit). Matches name (contains), MRN (exact) or phone digits (suffix, local 0 = 62); filters: the
-- registered branch, the last visit (30 d, 90 d, never) and "visiting now", over visits the caller may
-- see. Keyset pages of up to 50 by (name, id). Projection: no clinical content.
CREATE FUNCTION public.patient_search(p_query text, p_filters jsonb, p_after uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_now timestamptz;
  q text := btrim(coalesce(p_query, ''));
  raw_digits text := regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g');
  norm_digits text;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_branch uuid;
  v_last text;
  v_visiting boolean;
  v_after_name text;
  v_rows jsonb;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not search patients' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(f) <> 'object' OR f - 'branch_id' - 'last_visit' - 'visiting_now' <> '{}'::jsonb
     OR (f ? 'last_visit' AND coalesce(f ->> 'last_visit', '') NOT IN ('30d','90d','never'))
     OR (f ? 'visiting_now' AND jsonb_typeof(f -> 'visiting_now') <> 'boolean')
     OR (f ? 'branch_id' AND coalesce(f ->> 'branch_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR length(q) > 80 OR (length(q) = 1) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: search' USING ERRCODE = '22023';
  END IF;
  v_branch := (f ->> 'branch_id')::uuid;
  v_last := f ->> 'last_visit';
  v_visiting := coalesce((f ->> 'visiting_now')::boolean, false);
  v_now := clock_timestamp();
  INSERT INTO public.patient_search_log (tenant_id, staff_id, role, branch_id, searched_at) VALUES (a.tenant_id, a.staff_id, a.role, a.branch_id, v_now);
  IF (SELECT count(*) FROM public.patient_search_log l WHERE l.tenant_id = a.tenant_id AND l.staff_id = a.staff_id AND l.searched_at > v_now - interval '1 hour') > 200
     AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.tenant_id = a.tenant_id AND n.type = 'patient_search_abuse' AND n.subject_kind = 'staff'
                       AND n.subject_id = a.staff_id AND n.created_at > v_now - interval '1 hour') THEN
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, created_at)
    VALUES (a.tenant_id, 'patient_search_abuse', 'facility_head', a.branch_id, 'staff', a.staff_id, v_now);
  END IF;
  IF (SELECT count(*) FROM public.patient_search_log l WHERE l.tenant_id = a.tenant_id AND l.staff_id = a.staff_id AND l.searched_at > v_now - interval '1 minute') > 30 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_RATE_LIMITED');
  END IF;
  IF p_after IS NOT NULL THEN
    SELECT full_name INTO v_after_name FROM public.patients WHERE tenant_id = a.tenant_id AND id = p_after;
    IF v_after_name IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: after' USING ERRCODE = '22023';
    END IF;
  END IF;
  norm_digits := regexp_replace(raw_digits, '^0', '62');
  SELECT coalesce(jsonb_agg(r ORDER BY r ->> 'full_name', r ->> 'id'), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('id', p.id, 'mrn', p.mrn, 'full_name', p.full_name, 'birth_year', extract(year from p.birth_date)::int,
             'masked_phone', (SELECT left(c.value, 3) || repeat('•', greatest(length(c.value) - 7, 0)) || right(c.value, 4)
                                FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone' AND c.is_primary),
             'registered_branch_id', p.registered_branch_id, 'registered_branch', rb.name,
             'open_visit_branch', (SELECT b.name FROM public.visits v JOIN public.branches b ON b.tenant_id = v.tenant_id AND b.id = v.branch_id
                                    WHERE v.tenant_id = p.tenant_id AND v.patient_id = p.id AND v.closed_at IS NULL AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id)
                                    ORDER BY v.checked_in_at DESC, v.id DESC LIMIT 1),
             'last_visit_at', (SELECT max(v.checked_in_at) FROM public.visits v
                                WHERE v.tenant_id = p.tenant_id AND v.patient_id = p.id AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id))) AS r
      FROM public.patients p
      JOIN public.branches rb ON rb.tenant_id = p.tenant_id AND rb.id = p.registered_branch_id
     WHERE p.tenant_id = a.tenant_id
       AND (q = '' OR p.full_name ILIKE '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR upper(q) = p.mrn
            OR length(raw_digits) >= 6 AND EXISTS (SELECT 1 FROM public.contact_points c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.kind = 'phone'
                                                       AND (substr(c.value, 2) = norm_digits OR right(substr(c.value, 2), length(raw_digits)) = raw_digits)))
       AND (v_branch IS NULL OR p.registered_branch_id = v_branch)
       AND (NOT v_visiting OR EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = p.tenant_id AND v.patient_id = p.id AND v.closed_at IS NULL
                                        AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id)))
       AND (v_last IS NULL
            OR v_last = 'never' AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = p.tenant_id AND v.patient_id = p.id AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id))
            OR v_last IN ('30d','90d') AND EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = p.tenant_id AND v.patient_id = p.id
                                                     AND public.patient_search_visit_visible(a.tenant_id, a.staff_id, a.role, v.branch_id)
                                                     AND v.checked_in_at >= v_now - CASE v_last WHEN '30d' THEN interval '30 days' ELSE interval '90 days' END))
       AND (p_after IS NULL OR (p.full_name, p.id) > (v_after_name, p_after))
     ORDER BY p.full_name, p.id LIMIT 51) s;
  RETURN jsonb_build_object('ok', true, 'rows', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_rows) x LIMIT 50) y),
                            'more', jsonb_array_length(v_rows) > 50);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patient_search(text, jsonb, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patient_search(text, jsonb, uuid) TO clinic_app;--> statement-breakpoint

-- Saved segments: own only, filters validated (never a search text), audited.
CREATE FUNCTION public.segment_actor() RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager','facility_head','records_officer','fo_cashier','central_cs','bc','doctor','nurse','therapist','pharmacist','finance']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not save patient segments' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change segments now' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.segment_actor() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.segment_save(p_name text, p_filters jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.segment_actor();
  f jsonb := p_filters;
  v_id uuid;
BEGIN
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 60 OR jsonb_typeof(f) IS DISTINCT FROM 'object'
     OR f - 'branch_id' - 'last_visit' - 'visiting_now' <> '{}'::jsonb OR f = '{}'::jsonb
     OR (f ? 'last_visit' AND coalesce(f ->> 'last_visit', '') NOT IN ('30d','90d','never'))
     OR (f ? 'visiting_now' AND jsonb_typeof(f -> 'visiting_now') <> 'boolean')
     OR (f ? 'branch_id' AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id::text = f ->> 'branch_id')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: segment' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.patient_segments (tenant_id, staff_id, name, filters) VALUES (a.tenant_id, a.staff_id, btrim(p_name), f)
  ON CONFLICT ON CONSTRAINT patient_segments_name_key DO UPDATE SET filters = EXCLUDED.filters, updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'patient_segment', v_id, 'success', 'segment_saved');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.segment_save(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.segment_save(text, jsonb) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.segment_delete(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.segment_actor();
  v_id uuid;
BEGIN
  DELETE FROM public.patient_segments WHERE tenant_id = a.tenant_id AND staff_id = a.staff_id AND id = p_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: segment not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('settings_change', 'patient_segment', v_id, 'success', 'segment_deleted');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.segment_delete(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.segment_delete(uuid) TO clinic_app;--> statement-breakpoint
