CREATE TABLE "public_booking_intents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"intent_hash" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"doctor_staff_id" uuid,
	"slot_start" timestamp with time zone NOT NULL,
	"source_tag" text NOT NULL,
	"phone_e164" text,
	"phone_hash" text NOT NULL,
	"patient_name" text,
	"birth_date" date,
	"sex" text,
	"otp_hash" text NOT NULL,
	"otp_expires_at" timestamp with time zone NOT NULL,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"ip_hash" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"appointment_id" uuid,
	"command_key" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "public_booking_intents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "public_booking_intents_hash_key" UNIQUE("tenant_id","intent_hash"),
	CONSTRAINT "public_booking_intents_cmd_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "public_booking_intents_intent_hash_chk" CHECK ("public_booking_intents"."intent_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "public_booking_intents_otp_hash_chk" CHECK ("public_booking_intents"."otp_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "public_booking_intents_phone_hash_chk" CHECK ("public_booking_intents"."phone_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "public_booking_intents_ip_hash_chk" CHECK ("public_booking_intents"."ip_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "public_booking_intents_pii_chk" CHECK (("public_booking_intents"."consumed_at" is null and "public_booking_intents"."purged_at" is null and "public_booking_intents"."phone_e164" is not null and "public_booking_intents"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$' and "public_booking_intents"."patient_name" is not null and length(btrim("public_booking_intents"."patient_name")) between 2 and 120 and "public_booking_intents"."birth_date" is not null and "public_booking_intents"."birth_date" >= date '1900-01-01' and "public_booking_intents"."sex" is not null and "public_booking_intents"."sex" in ('female','male')) or (("public_booking_intents"."consumed_at" is not null or "public_booking_intents"."purged_at" is not null) and "public_booking_intents"."phone_e164" is null and "public_booking_intents"."patient_name" is null and "public_booking_intents"."birth_date" is null and "public_booking_intents"."sex" is null)),
	CONSTRAINT "public_booking_intents_source_chk" CHECK ("public_booking_intents"."source_tag" ~ '^situs(-[a-z0-9]{1,30})?$'),
	CONSTRAINT "public_booking_intents_attempts_chk" CHECK ("public_booking_intents"."otp_attempts" between 0 and 5),
	CONSTRAINT "public_booking_intents_resend_chk" CHECK ("public_booking_intents"."resend_count" between 0 and 5),
	CONSTRAINT "public_booking_intents_consumed_chk" CHECK (("public_booking_intents"."consumed_at" is null and "public_booking_intents"."appointment_id" is null and "public_booking_intents"."command_key" is null) or ("public_booking_intents"."consumed_at" is not null and "public_booking_intents"."appointment_id" is not null and "public_booking_intents"."command_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "public_booking_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patients" DROP CONSTRAINT "patients_identity_check";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_created_as_check";--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "public_booking_intents" ADD CONSTRAINT "public_booking_intents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_booking_intents" ADD CONSTRAINT "public_booking_intents_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_booking_intents" ADD CONSTRAINT "public_booking_intents_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_booking_intents" ADD CONSTRAINT "public_booking_intents_doctor_fk" FOREIGN KEY ("tenant_id","doctor_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_booking_intents" ADD CONSTRAINT "public_booking_intents_appt_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_booking_intents_rate_phone_idx" ON "public_booking_intents" USING btree ("tenant_id","phone_hash","created_at");--> statement-breakpoint
CREATE INDEX "public_booking_intents_rate_ip_idx" ON "public_booking_intents" USING btree ("ip_hash","created_at");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_as_check" CHECK (("patients"."created_as" <> 'patient_online' and "patients"."created_by" is not null) or ("patients"."created_as" = 'patient_online' and "patients"."created_by" is null));--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_identity_check" CHECK (("patients"."identity_type" = 'nik' and "patients"."identity_enc" is not null and "patients"."identity_bidx" is not null and "patients"."no_identity_reason" is null)
      or ("patients"."identity_type" in ('passport','kitas') and "patients"."identity_enc" is not null and "patients"."identity_bidx" is not null and length(btrim(coalesce("patients"."no_identity_reason", ''))) between 3 and 300)
      or ("patients"."identity_type" = 'newborn_via_guardian' and "patients"."identity_enc" is null and "patients"."identity_bidx" is null and length(btrim(coalesce("patients"."no_identity_reason", ''))) between 3 and 300)
      or ("patients"."identity_type" = 'online_pending' and "patients"."created_as" = 'patient_online' and "patients"."created_by" is null and "patients"."identity_enc" is null and "patients"."identity_bidx" is null and "patients"."no_identity_reason" = 'Pendaftaran awal booking online, lengkapi identitas di Front Office'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_as_check" CHECK (("appointments"."created_as" in ('owner','admin_pusat','manager','fo_cashier','central_cs') and "appointments"."created_by" is not null) or ("appointments"."created_as" = 'patient_online' and "appointments"."created_by" is null and "appointments"."channel" = 'online'));-- ── T-126 (PR-67, UX-24, DATA-56, OD-1 Option B): Narrow Public Booking Seam ──
-- RLS is enabled by Drizzle DDL above; REVOKE ALL FROM PUBLIC prevents any direct clinic_app/vendor access
-- while SECURITY DEFINER functions owned by the migration role operate cleanly without requiring BYPASSRLS.
REVOKE ALL ON TABLE public.public_booking_intents FROM PUBLIC;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.public_booking_intents', 'tenant-shared', 'public-site/booking', '{}', 'public_booking_otp_request, public_booking_otp_abort, public_booking_otp_resend_prepare, public_booking_otp_resend_commit, public_booking_otp_verify_and_book, public_booking_purge_expired', 'branch-validated via FK');--> statement-breakpoint

INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.public_booking_intents', 'never');--> statement-breakpoint

-- 1. Private helper: resolve live, published, counsel-valid tenant from public slug (fail-closed -> empty).
CREATE FUNCTION public._public_booking_tenant(p_slug text)
RETURNS TABLE (tenant_id uuid, brand_name text, slug text, show_treatments boolean, show_branches boolean)
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.tenant_id, s.brand_name, s.slug, s.show_treatments, s.show_branches
    FROM public.public_sites s
    JOIN public.tenants_registry tr ON tr.id = s.tenant_id
    JOIN public.public_site_versions v ON v.tenant_id = s.tenant_id AND v.version = s.published_version
   WHERE s.slug = lower(btrim(coalesce(p_slug, '')))
     AND s.state = 'published'
     AND tr.lifecycle_state = 'live'
     AND public._public_site_counsel_approval(s.tenant_id) = v.counsel_approval_id
   LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._public_booking_tenant(text) FROM PUBLIC;--> statement-breakpoint

-- 1b. Private unbound resource/performer picker (exact parity with booking_pick without requiring app.staff_id).
CREATE FUNCTION public._public_booking_pick(
  p_tenant uuid,
  p_branch uuid,
  p_version uuid,
  p_from timestamptz,
  p_until timestamptz,
  p_staff uuid
) RETURNS TABLE (staff_id uuid, rooms uuid[], devices uuid[])
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.catalog_versions;
  v_b public.branches;
  v_kind text;
  v_rooms uuid[] := '{}';
  v_devices uuid[] := '{}';
  v_pick uuid;
  req record;
  v_day0 timestamptz;
  v_day1 timestamptz;
  v_local_date date;
  v_start_time time;
  v_last_time time;
BEGIN
  IF p_from IS NULL OR p_until IS NULL OR p_until <= p_from THEN
    RETURN;
  END IF;
  SELECT * INTO v FROM public.catalog_versions WHERE tenant_id = p_tenant AND id = p_version AND state = 'active';
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_b FROM public.branches WHERE tenant_id = p_tenant AND id = p_branch;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT i.kind INTO v_kind FROM public.catalog_items i WHERE i.tenant_id = p_tenant AND i.id = v.item_id;
  IF v_kind IS DISTINCT FROM 'service'
     OR NOT EXISTS (SELECT 1 FROM public.branch_services bs WHERE bs.tenant_id = p_tenant AND bs.branch_id = p_branch AND bs.item_id = v.item_id) THEN
    RETURN;
  END IF;

  -- Branch open check (mirrors branch_is_open for single local date without requiring app.staff_id)
  v_local_date := (p_from AT TIME ZONE v_b.timezone)::date;
  IF v_local_date <> ((p_until - interval '1 microsecond') AT TIME ZONE v_b.timezone)::date THEN
    RETURN;
  END IF;
  v_start_time := (p_from AT TIME ZONE v_b.timezone)::time;
  v_last_time := ((p_until - interval '1 microsecond') AT TIME ZONE v_b.timezone)::time;

  IF NOT EXISTS (
    SELECT 1 FROM public.branch_hours h
     WHERE h.tenant_id = p_tenant AND h.branch_id = p_branch
       AND h.weekday = extract(dow FROM (p_from AT TIME ZONE v_b.timezone))
       AND h.opens <= v_start_time
       AND (v_last_time < h.closes OR (h.closes = time '23:59:59.999999' AND v_last_time = h.closes))
  ) OR EXISTS (
    SELECT 1 FROM public.branch_closures c
     WHERE c.tenant_id = p_tenant AND c.branch_id = p_branch AND c.closed_on = v_local_date
       AND (c.from_time IS NULL OR (c.from_time < v_last_time AND v_start_time < c.until_time))
  ) THEN
    RETURN;
  END IF;

  -- One free active room of each required kind, one free active device of each required type
  FOR req IN SELECT sr.kind, sr.code FROM public.service_resources sr WHERE sr.tenant_id = p_tenant AND sr.version_id = v.id AND sr.required ORDER BY sr.kind, sr.code LOOP
    IF req.kind = 'room' THEN
      SELECT x.id INTO v_pick FROM public.rooms x
       WHERE x.tenant_id = p_tenant AND x.branch_id = p_branch AND x.kind = req.code AND x.is_active
         AND NOT public.booking_busy(p_tenant, 'room', x.id, p_from, p_until)
       ORDER BY x.id LIMIT 1;
      IF v_pick IS NULL THEN RETURN; END IF;
      v_rooms := v_rooms || v_pick;
    ELSE
      SELECT x.id INTO v_pick FROM public.branch_devices x
       WHERE x.tenant_id = p_tenant AND x.branch_id = p_branch AND x.device_type = req.code AND x.is_active
         AND NOT public.booking_busy(p_tenant, 'device', x.id, p_from, p_until)
       ORDER BY x.id LIMIT 1;
      IF v_pick IS NULL THEN RETURN; END IF;
      v_devices := v_devices || v_pick;
    END IF;
  END LOOP;

  -- Performer: eligible, active membership at branch, rostered work shift with no break/leave, not busy
  v_day0 := v_local_date::timestamp AT TIME ZONE v_b.timezone;
  v_day1 := (v_local_date + 1)::timestamp AT TIME ZONE v_b.timezone;
  SELECT s.id INTO v_pick
    FROM public.staff s
   WHERE s.tenant_id = p_tenant AND (p_staff IS NULL OR s.id = p_staff)
     AND public.booking_eligible(p_tenant, p_branch, v.id, v.category, s.id)
     AND public.roster_staff_at(p_tenant, s.id, p_branch)
     AND EXISTS (
       SELECT 1 FROM public.staff_shifts w
        WHERE w.tenant_id = p_tenant AND w.branch_id = p_branch AND w.staff_id = s.id AND w.kind = 'work'
          AND w.shift_date = v_local_date
          AND public.roster_instant(w.shift_date, w.starts, v_b.timezone) <= p_from
          AND p_until <= public.roster_instant(w.shift_date, w.ends, v_b.timezone)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_shifts br
        WHERE br.tenant_id = p_tenant AND br.branch_id = p_branch AND br.staff_id = s.id AND br.kind = 'break'
          AND br.shift_date = v_local_date
          AND public.roster_instant(br.shift_date, br.starts, v_b.timezone) < p_until
          AND p_from < public.roster_instant(br.shift_date, br.ends, v_b.timezone)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_leave l
        WHERE l.tenant_id = p_tenant AND l.branch_id = p_branch AND l.staff_id = s.id AND l.cancelled_at IS NULL
          AND v_local_date BETWEEN l.from_date AND l.to_date
     )
     AND NOT public.booking_busy(p_tenant, 'staff', s.id, p_from, p_until)
   ORDER BY (
     SELECT count(*) FROM public.resource_reservations r
       JOIN public.appointments ap ON ap.tenant_id = r.tenant_id AND ap.branch_id = r.branch_id AND ap.id = r.appointment_id
      WHERE r.tenant_id = p_tenant AND r.kind = 'staff' AND r.resource_id = s.id AND r.active
        AND public.appointment_live(ap)
        AND r.starts_at >= v_day0 AND r.starts_at < v_day1
   ), s.id
   LIMIT 1;
  IF v_pick IS NULL THEN
    RETURN;
  END IF;
  staff_id := v_pick; rooms := v_rooms; devices := v_devices;
  RETURN NEXT;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._public_booking_pick(uuid, uuid, uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint

-- 1c. Private PII hygiene helper: purge PII on abandoned/expired (> 15m past OTP expiry or created > 15m ago) or locked intents for one tenant.
CREATE FUNCTION public._public_booking_purge_expired(p_tenant uuid, p_now timestamptz) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  UPDATE public.public_booking_intents
     SET phone_e164 = NULL,
         patient_name = NULL,
         birth_date = NULL,
         sex = NULL,
         purged_at = p_now
   WHERE tenant_id = p_tenant
     AND consumed_at IS NULL
     AND purged_at IS NULL
     AND (otp_expires_at <= p_now - interval '15 minutes' OR created_at <= p_now - interval '15 minutes' OR otp_attempts >= 5);
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._public_booking_purge_expired(uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 1d. Unbound scheduled retention purge across ALL tenants independent of public traffic, publication, or suspension state (B3).
CREATE FUNCTION public.public_booking_purge_expired(p_grace_minutes integer DEFAULT 15) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_grace integer := greatest(0, coalesce(p_grace_minutes, 15));
  v_count integer;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public booking purge runs unbound' USING ERRCODE = '42501';
  END IF;
  UPDATE public.public_booking_intents
     SET phone_e164 = NULL,
         patient_name = NULL,
         birth_date = NULL,
         sex = NULL,
         purged_at = v_now
   WHERE consumed_at IS NULL
     AND purged_at IS NULL
     AND (
       otp_expires_at <= v_now - make_interval(mins => v_grace)
       OR created_at <= v_now - make_interval(mins => greatest(15, v_grace))
       OR otp_attempts >= 5
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_booking_purge_expired(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_booking_purge_expired(integer) TO clinic_app;--> statement-breakpoint

-- 1e. Unbound abort helper: immediately purge PII on an unconsumed intent if runtime OTP delivery throws (B1).
CREATE FUNCTION public.public_booking_otp_abort(p_slug text, p_intent_hash text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t record;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public booking runs unbound' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public._public_booking_tenant(p_slug);
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.public_booking_intents
     SET phone_e164 = NULL,
         patient_name = NULL,
         birth_date = NULL,
         sex = NULL,
         purged_at = v_now
   WHERE tenant_id = v_t.tenant_id
     AND intent_hash = p_intent_hash
     AND consumed_at IS NULL
     AND purged_at IS NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_booking_otp_abort(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_booking_otp_abort(text, text) TO clinic_app;--> statement-breakpoint

-- 2. Public booking catalog reader (opaque public slugs/handles only — zero internal UUIDs).
CREATE FUNCTION public.public_booking_catalog(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t record;
  v_branches jsonb;
  v_treatments jsonb;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public booking runs unbound' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public._public_booking_tenant(p_slug);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'slug', lower(b.code),
      'name', b.name,
      'timezone', b.timezone,
      'whatsapp', b.whatsapp_number
    ) ORDER BY lower(b.code)
  ), '[]'::jsonb) INTO v_branches
  FROM public.branches b
  WHERE b.tenant_id = v_t.tenant_id
    AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
    AND (b.publish_until IS NULL OR b.publish_until > v_now);

  IF jsonb_array_length(v_branches) = 0 THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  IF v_t.show_treatments THEN
    SELECT coalesce(jsonb_agg(t_row.obj ORDER BY t_row.slug), '[]'::jsonb)
      INTO v_treatments
      FROM (
        SELECT
          wf.public_slug AS slug,
          jsonb_build_object(
            'slug', wf.public_slug,
            'name', cv.name,
            'durationMin', cv.treatment_min,
            'dpRequired', cv.booking_dp_enabled,
            'dpAmount', CASE WHEN cv.booking_dp_enabled THEN cv.booking_dp_amount ELSE NULL END,
            'branchSlugs', br.slugs
          ) AS obj
        FROM public.public_web_fields wf
        JOIN public.catalog_items ci ON ci.tenant_id = wf.tenant_id AND ci.id = wf.item_id AND ci.kind = 'service'
        JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
        JOIN LATERAL (
          SELECT jsonb_agg(lower(b.code) ORDER BY lower(b.code)) AS slugs
            FROM public.branch_services bs
            JOIN public.branches b ON b.tenant_id = bs.tenant_id AND b.id = bs.branch_id
           WHERE bs.tenant_id = v_t.tenant_id AND bs.item_id = ci.id
             AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
             AND (b.publish_until IS NULL OR b.publish_until > v_now)
        ) br ON br.slugs IS NOT NULL
        WHERE wf.tenant_id = v_t.tenant_id
          AND wf.published = true
          AND wf.clinical_reviewed_version = cv.version
          AND wf.clinical_reviewed_artifact_sha IS NOT NULL
          AND wf.clinical_reviewed_artifact_sha = public._site_web_review_artifact_sha(
            wf.public_slug, cv.name, wf.purpose, wf.performed_by,
            cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
            cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
          )
          AND cv.online_bookable = true
      ) t_row;
  ELSE
    v_treatments := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'state', 'open',
    'slug', v_t.slug,
    'brand', v_t.brand_name,
    'branches', v_branches,
    'treatments', v_treatments,
    'doctors', '[]'::jsonb
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_booking_catalog(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_booking_catalog(text) TO clinic_app;--> statement-breakpoint

-- 3. Public booking slot reader (returns ONLY ISO timestamps & local HH:MI, never internal staff/room/device UUIDs).
CREATE FUNCTION public.public_booking_slots(
  p_slug text,
  p_treatment_slug text,
  p_branch_slug text,
  p_date date,
  p_doctor_handle text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t record;
  v_branch public.branches;
  v_ver public.catalog_versions;
  v_set jsonb;
  v_dur integer;
  v_min_start timestamptz;
  v_max_date date;
  v_cursor timestamptz;
  v_day_end timestamptz;
  v_slots jsonb := '[]'::jsonb;
  v_pick record;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public booking runs unbound' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public._public_booking_tenant(p_slug);
  IF NOT FOUND OR NOT v_t.show_treatments THEN
    RETURN jsonb_build_object('state', 'not_found', 'slots', '[]'::jsonb);
  END IF;

  SELECT * INTO v_branch
    FROM public.branches b
   WHERE b.tenant_id = v_t.tenant_id AND lower(b.code) = lower(btrim(coalesce(p_branch_slug, '')))
     AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
     AND (b.publish_until IS NULL OR b.publish_until > v_now);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found', 'slots', '[]'::jsonb);
  END IF;

  SELECT cv.* INTO v_ver
    FROM public.public_web_fields wf
    JOIN public.catalog_items ci ON ci.tenant_id = wf.tenant_id AND ci.id = wf.item_id AND ci.kind = 'service'
    JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
    JOIN public.branch_services bs ON bs.tenant_id = wf.tenant_id AND bs.branch_id = v_branch.id AND bs.item_id = ci.id
   WHERE wf.tenant_id = v_t.tenant_id
     AND wf.public_slug = lower(btrim(coalesce(p_treatment_slug, '')))
     AND wf.published = true
     AND wf.clinical_reviewed_version = cv.version
     AND wf.clinical_reviewed_artifact_sha IS NOT NULL
     AND wf.clinical_reviewed_artifact_sha = public._site_web_review_artifact_sha(
       wf.public_slug, cv.name, wf.purpose, wf.performed_by,
       cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
       cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
     )
     AND cv.online_bookable = true;
  IF NOT FOUND OR v_ver.treatment_min IS NULL THEN
    RETURN jsonb_build_object('state', 'not_found', 'slots', '[]'::jsonb);
  END IF;

  -- Consented public doctor handles arrive in T-125; fail closed until then.
  IF p_doctor_handle IS NOT NULL AND btrim(p_doctor_handle) <> '' THEN
    RETURN jsonb_build_object('state', 'open', 'date', p_date, 'timezone', v_branch.timezone, 'slots', '[]'::jsonb);
  END IF;

  PERFORM set_config('app.tenant_id', v_t.tenant_id::text, true);
  v_set := public.setting_value_at('SET-16', v_branch.id, v_now);
  v_min_start := v_now + make_interval(hours => coalesce((v_set->>'batas')::integer, 2));
  v_max_date := (v_now AT TIME ZONE v_branch.timezone)::date + coalesce((v_set->>'horizon')::integer, 30);
  IF p_date IS NULL OR p_date < (v_now AT TIME ZONE v_branch.timezone)::date OR p_date > v_max_date THEN
    RETURN jsonb_build_object('state', 'open', 'date', p_date, 'timezone', v_branch.timezone, 'slots', '[]'::jsonb);
  END IF;

  PERFORM public.booking_expire_holds(v_t.tenant_id);
  v_dur := public.booking_minutes(v_ver);
  v_cursor := (p_date::timestamp + time '06:00') AT TIME ZONE v_branch.timezone;
  v_day_end := (p_date::timestamp + time '22:00') AT TIME ZONE v_branch.timezone;

  WHILE v_cursor < v_day_end LOOP
    IF v_cursor >= v_min_start THEN
      SELECT * INTO v_pick
        FROM public._public_booking_pick(v_t.tenant_id, v_branch.id, v_ver.id, v_cursor, v_cursor + make_interval(mins => v_dur), NULL);
      IF FOUND THEN
        v_slots := v_slots || jsonb_build_array(
          jsonb_build_object(
            'startsAt', to_char(v_cursor AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'localTime', to_char(v_cursor AT TIME ZONE v_branch.timezone, 'HH24:MI')
          )
        );
      END IF;
    END IF;
    v_cursor := v_cursor + interval '15 minutes';
  END LOOP;

  RETURN jsonb_build_object('state', 'open', 'date', p_date, 'timezone', v_branch.timezone, 'slots', v_slots);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_booking_slots(text,text,text,date,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_booking_slots(text,text,text,date,text) TO clinic_app;--> statement-breakpoint

-- 4. Public booking OTP intake (OD-1 real_patient_gate_assert BEFORE any rate/DB/outbox side effect!).
CREATE FUNCTION public.public_booking_otp_request(
  p_slug text,
  p_treatment_slug text,
  p_branch_slug text,
  p_slot_start timestamptz,
  p_doctor_handle text,
  p_source_tag text,
  p_phone_e164 text,
  p_phone_hash text,
  p_patient_name text,
  p_birth_date date,
  p_sex text,
  p_otp_hash text,
  p_intent_hash text,
  p_ip_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t record;
  v_branch public.branches;
  v_ver public.catalog_versions;
  v_set jsonb;
  v_pick record;
  v_src text := CASE WHEN p_source_tag ~ '^situs(-[a-z0-9]{1,30})?$' THEN p_source_tag ELSE 'situs' END;
  v_ip_cnt integer;
  v_phone_cnt integer;
  v_tenant_cnt integer;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public booking runs unbound' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public._public_booking_tenant(p_slug);
  IF NOT FOUND OR NOT v_t.show_treatments THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  -- OD-1 Option B: enforce real-patient gate BEFORE any durable phone/OTP intake or OTP delivery!
  PERFORM set_config('app.tenant_id', v_t.tenant_id::text, true);
  PERFORM public.real_patient_gate_assert(v_t.tenant_id);

  IF NOT public.tenant_capability('new_booking') THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  PERFORM public._public_booking_purge_expired(v_t.tenant_id, v_now);

  -- Serialize global IP -> tenant -> tenant/phone quotas in canonical order to prevent concurrent burst bypass & deadlocks.
  PERFORM pg_advisory_xact_lock(hashtextextended('pubbook_ip:' || coalesce(p_ip_hash, ''), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('pubbook_tenant:' || v_t.tenant_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('pubbook_phone:' || v_t.tenant_id::text || ':' || coalesce(p_phone_hash, ''), 0));

  SELECT count(*) INTO v_ip_cnt
    FROM public.public_booking_intents i
   WHERE i.ip_hash = p_ip_hash AND i.created_at > v_now - interval '15 minutes';
  IF v_ip_cnt >= 20 THEN
    RAISE EXCEPTION 'ERR_RATE_LIMITED: ip_quota' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_phone_cnt
    FROM public.public_booking_intents i
   WHERE i.tenant_id = v_t.tenant_id AND i.phone_hash = p_phone_hash AND i.created_at > v_now - interval '15 minutes';
  IF v_phone_cnt >= 5 THEN
    RAISE EXCEPTION 'ERR_RATE_LIMITED: phone_quota' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_tenant_cnt
    FROM public.public_booking_intents i
   WHERE i.tenant_id = v_t.tenant_id AND i.created_at > v_now - interval '15 minutes';
  IF v_tenant_cnt >= 200 THEN
    RAISE EXCEPTION 'ERR_RATE_LIMITED: tenant_quota' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_branch
    FROM public.branches b
   WHERE b.tenant_id = v_t.tenant_id AND lower(b.code) = lower(btrim(coalesce(p_branch_slug, '')))
     AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
     AND (b.publish_until IS NULL OR b.publish_until > v_now);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT cv.* INTO v_ver
    FROM public.public_web_fields wf
    JOIN public.catalog_items ci ON ci.tenant_id = wf.tenant_id AND ci.id = wf.item_id AND ci.kind = 'service'
    JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
    JOIN public.branch_services bs ON bs.tenant_id = wf.tenant_id AND bs.branch_id = v_branch.id AND bs.item_id = ci.id
   WHERE wf.tenant_id = v_t.tenant_id
     AND wf.public_slug = lower(btrim(coalesce(p_treatment_slug, '')))
     AND wf.published = true
     AND wf.clinical_reviewed_version = cv.version
     AND wf.clinical_reviewed_artifact_sha IS NOT NULL
     AND wf.clinical_reviewed_artifact_sha = public._site_web_review_artifact_sha(
       wf.public_slug, cv.name, wf.purpose, wf.performed_by,
       cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
       cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
     )
     AND cv.online_bookable = true;
  IF NOT FOUND OR v_ver.treatment_min IS NULL THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  IF p_doctor_handle IS NOT NULL AND btrim(p_doctor_handle) <> '' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: doctor_unavailable' USING ERRCODE = '22023';
  END IF;

  IF p_patient_name IS NULL OR length(btrim(p_patient_name)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid_name' USING ERRCODE = '22023';
  END IF;
  IF p_birth_date IS NULL OR p_birth_date < date '1900-01-01' OR p_birth_date > (v_now AT TIME ZONE v_branch.timezone)::date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid_birth_date' USING ERRCODE = '22023';
  END IF;
  IF p_sex IS NULL OR p_sex NOT IN ('female', 'male') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid_sex' USING ERRCODE = '22023';
  END IF;
  IF p_phone_e164 IS NULL OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid_phone' USING ERRCODE = '22023';
  END IF;

  v_set := public.setting_value_at('SET-16', v_branch.id, v_now);
  IF p_slot_start IS NULL
     OR p_slot_start < v_now + make_interval(hours => coalesce((v_set->>'batas')::integer, 2))
     OR (p_slot_start AT TIME ZONE v_branch.timezone)::date > (v_now AT TIME ZONE v_branch.timezone)::date + coalesce((v_set->>'horizon')::integer, 30)
     OR extract(epoch FROM (p_slot_start AT TIME ZONE v_branch.timezone)::time) % 900 <> 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: online_window' USING ERRCODE = '22023';
  END IF;

  PERFORM public.booking_expire_holds(v_t.tenant_id);
  SELECT * INTO v_pick
    FROM public._public_booking_pick(v_t.tenant_id, v_branch.id, v_ver.id, p_slot_start, p_slot_start + make_interval(mins => public.booking_minutes(v_ver)), NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: slot_taken' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.public_booking_intents (
    tenant_id, intent_hash, branch_id, catalog_version_id, doctor_staff_id,
    slot_start, source_tag, phone_e164, phone_hash, patient_name, birth_date, sex,
    otp_hash, otp_expires_at, ip_hash, last_sent_at
  ) VALUES (
    v_t.tenant_id, p_intent_hash, v_branch.id, v_ver.id, NULL,
    p_slot_start, v_src, p_phone_e164, p_phone_hash, btrim(p_patient_name), p_birth_date, p_sex,
    p_otp_hash, v_now + interval '5 minutes', p_ip_hash, v_now
  );

  RETURN jsonb_build_object(
    'state', 'otp_sent',
    'expiresAt', to_char((v_now + interval '5 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'dpRequired', v_ver.booking_dp_enabled
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_booking_otp_request(text,text,text,timestamptz,text,text,text,text,text,date,text,text,text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_booking_otp_request(text,text,text,timestamptz,text,text,text,text,text,date,text,text,text,text) TO clinic_app;--> statement-breakpoint

-- 5a. Public booking OTP resend prepare (OD-1 gate + lockout + 15m absolute intent age + 60s cooldown + max 5 resends;
-- returns deliveryPhone WITHOUT rotating otp_hash so a delivery failure never invalidates the previous code).
CREATE FUNCTION public.public_booking_otp_resend_prepare(
  p_slug text,
  p_intent_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t record;
  v_intent public.public_booking_intents;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public booking runs unbound' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public._public_booking_tenant(p_slug);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  PERFORM set_config('app.tenant_id', v_t.tenant_id::text, true);
  PERFORM public.real_patient_gate_assert(v_t.tenant_id);
  IF NOT public.tenant_capability('new_booking') THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT * INTO v_intent
    FROM public.public_booking_intents i
   WHERE i.tenant_id = v_t.tenant_id AND i.intent_hash = p_intent_hash
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  IF v_intent.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: intent_already_used' USING ERRCODE = '55000';
  END IF;
  IF v_intent.otp_attempts >= 5 THEN
    IF v_intent.purged_at IS NULL THEN
      UPDATE public.public_booking_intents
         SET phone_e164 = NULL, patient_name = NULL, birth_date = NULL, sex = NULL, purged_at = v_now
       WHERE id = v_intent.id;
    END IF;
    RETURN jsonb_build_object('state', 'otp_locked');
  END IF;
  -- Enforce absolute 15-minute server-side intent lifetime under row lock (never revive aged intents).
  IF v_intent.purged_at IS NOT NULL OR v_intent.phone_e164 IS NULL OR v_intent.created_at + interval '15 minutes' <= v_now THEN
    IF v_intent.purged_at IS NULL THEN
      UPDATE public.public_booking_intents
         SET phone_e164 = NULL, patient_name = NULL, birth_date = NULL, sex = NULL, purged_at = v_now
       WHERE id = v_intent.id;
    END IF;
    RETURN jsonb_build_object('state', 'otp_expired');
  END IF;
  IF v_intent.resend_count >= 5 THEN
    RAISE EXCEPTION 'ERR_RATE_LIMITED: resend_limit' USING ERRCODE = '55000';
  END IF;
  IF v_now - v_intent.last_sent_at < interval '60 seconds' THEN
    RAISE EXCEPTION 'ERR_RATE_LIMITED: resend_cooldown' USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'state', 'ready',
    'deliveryPhone', v_intent.phone_e164
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_booking_otp_resend_prepare(text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_booking_otp_resend_prepare(text,text) TO clinic_app;--> statement-breakpoint

-- 5b. Public booking OTP resend commit (called ONLY after OTP port confirms delivery; re-checks all predicates under FOR UPDATE;
-- preserves cumulative otp_attempts and original ip_hash).
CREATE FUNCTION public.public_booking_otp_resend_commit(
  p_slug text,
  p_intent_hash text,
  p_new_otp_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t record;
  v_intent public.public_booking_intents;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public booking runs unbound' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public._public_booking_tenant(p_slug);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  PERFORM set_config('app.tenant_id', v_t.tenant_id::text, true);
  PERFORM public.real_patient_gate_assert(v_t.tenant_id);
  IF NOT public.tenant_capability('new_booking') THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT * INTO v_intent
    FROM public.public_booking_intents i
   WHERE i.tenant_id = v_t.tenant_id AND i.intent_hash = p_intent_hash
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  IF v_intent.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: intent_already_used' USING ERRCODE = '55000';
  END IF;
  IF v_intent.otp_attempts >= 5 THEN
    IF v_intent.purged_at IS NULL THEN
      UPDATE public.public_booking_intents
         SET phone_e164 = NULL, patient_name = NULL, birth_date = NULL, sex = NULL, purged_at = v_now
       WHERE id = v_intent.id;
    END IF;
    RETURN jsonb_build_object('state', 'otp_locked');
  END IF;
  IF v_intent.purged_at IS NOT NULL OR v_intent.phone_e164 IS NULL OR v_intent.created_at + interval '15 minutes' <= v_now THEN
    IF v_intent.purged_at IS NULL THEN
      UPDATE public.public_booking_intents
         SET phone_e164 = NULL, patient_name = NULL, birth_date = NULL, sex = NULL, purged_at = v_now
       WHERE id = v_intent.id;
    END IF;
    RETURN jsonb_build_object('state', 'otp_expired');
  END IF;
  IF v_intent.resend_count >= 5 THEN
    RAISE EXCEPTION 'ERR_RATE_LIMITED: resend_limit' USING ERRCODE = '55000';
  END IF;
  IF v_now - v_intent.last_sent_at < interval '60 seconds' THEN
    RAISE EXCEPTION 'ERR_RATE_LIMITED: resend_cooldown' USING ERRCODE = '55000';
  END IF;

  -- Preserve cumulative otp_attempts (never reset on resend) and original ip_hash.
  UPDATE public.public_booking_intents
     SET otp_hash = p_new_otp_hash,
         otp_expires_at = v_now + interval '5 minutes',
         resend_count = resend_count + 1,
         last_sent_at = v_now
   WHERE id = v_intent.id;

  RETURN jsonb_build_object(
    'state', 'otp_sent',
    'expiresAt', to_char((v_now + interval '5 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'resendCount', v_intent.resend_count + 1
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_booking_otp_resend_commit(text,text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_booking_otp_resend_commit(text,text,text) TO clinic_app;--> statement-breakpoint

-- 6. Atomic OTP verify & book (FOR UPDATE single consumption + durable attempt increment + OD-1 gate + zero UUIDs returned).
CREATE FUNCTION public.public_booking_otp_verify_and_book(
  p_slug text,
  p_intent_hash text,
  p_otp_hash text,
  p_command_key text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t record;
  v_intent public.public_booking_intents;
  v_branch public.branches;
  v_ver public.catalog_versions;
  v_existing_appt public.appointments;
  v_patient_id uuid;
  v_mrn_seq bigint;
  v_mrn text;
  v_pick record;
  v_end timestamptz;
  v_is_hold boolean;
  v_hold_until timestamptz;
  v_appt_id uuid := public.uuid_generate_v7();
  x uuid;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public booking runs unbound' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public._public_booking_tenant(p_slug);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  -- OD-1 Option B: re-assert real-patient gate inside booking commit transaction!
  PERFORM set_config('app.tenant_id', v_t.tenant_id::text, true);
  PERFORM public.real_patient_gate_assert(v_t.tenant_id);

  IF NOT public.tenant_capability('new_booking') THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  -- Serialize with tenant clinical/scheduling writers (canonical lock order: staff_access:<tenant> BEFORE row locks)
  -- so concurrent verifications cannot create duplicate online_pending patients or bypass patient_overlap.
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_t.tenant_id::text, 0));

  -- Lock intent row FOR UPDATE for atomic single-use consumption
  SELECT * INTO v_intent
    FROM public.public_booking_intents i
   WHERE i.tenant_id = v_t.tenant_id AND i.intent_hash = p_intent_hash
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  -- Idempotent replay on same command_key: report honest live state (never falsely report cancelled/expired hold as confirmed).
  IF v_intent.consumed_at IS NOT NULL THEN
    IF v_intent.command_key = p_command_key AND v_intent.appointment_id IS NOT NULL THEN
      SELECT * INTO v_existing_appt
        FROM public.appointments ap
       WHERE ap.tenant_id = v_t.tenant_id AND ap.id = v_intent.appointment_id;
      RETURN jsonb_build_object(
        'state', CASE
          WHEN v_existing_appt.state = 'held' AND (v_existing_appt.hold_until IS NULL OR v_existing_appt.hold_until > v_now) THEN 'held'
          WHEN v_existing_appt.state IN ('booked', 'confirmed', 'arrived') THEN 'confirmed'
          ELSE 'inactive'
        END,
        'replayed', true,
        'sourceTag', v_intent.source_tag,
        'startsAt', to_char(v_existing_appt.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'endsAt', to_char(v_existing_appt.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'holdUntil', CASE WHEN v_existing_appt.hold_until IS NOT NULL THEN to_char(v_existing_appt.hold_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE NULL END
      );
    END IF;
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: intent_already_used' USING ERRCODE = '55000';
  END IF;

  IF v_intent.otp_attempts >= 5 THEN
    IF v_intent.purged_at IS NULL THEN
      UPDATE public.public_booking_intents
         SET phone_e164 = NULL, patient_name = NULL, birth_date = NULL, sex = NULL, purged_at = v_now
       WHERE id = v_intent.id;
    END IF;
    RETURN jsonb_build_object('state', 'otp_locked');
  END IF;
  IF v_intent.purged_at IS NOT NULL OR v_intent.otp_expires_at <= v_now THEN
    IF v_intent.purged_at IS NULL THEN
      UPDATE public.public_booking_intents
         SET phone_e164 = NULL, patient_name = NULL, birth_date = NULL, sex = NULL, purged_at = v_now
       WHERE id = v_intent.id;
    END IF;
    RETURN jsonb_build_object('state', 'otp_expired');
  END IF;

  -- Commit durable failed-attempt counter on mismatch (never roll back attempts; purge PII on 5th lock!).
  IF v_intent.otp_hash IS DISTINCT FROM p_otp_hash THEN
    IF v_intent.otp_attempts + 1 >= 5 THEN
      UPDATE public.public_booking_intents
         SET otp_attempts = otp_attempts + 1,
             phone_e164 = NULL,
             patient_name = NULL,
             birth_date = NULL,
             sex = NULL,
             purged_at = v_now
       WHERE id = v_intent.id;
    ELSE
      UPDATE public.public_booking_intents
         SET otp_attempts = otp_attempts + 1
       WHERE id = v_intent.id;
    END IF;
    RETURN jsonb_build_object(
      'state', CASE WHEN v_intent.otp_attempts + 1 >= 5 THEN 'otp_locked' ELSE 'otp_mismatch' END,
      'attemptsRemaining', greatest(0, 5 - (v_intent.otp_attempts + 1))
    );
  END IF;

  -- Re-verify branch publish window & canonical clinical review of treatment before committing
  SELECT * INTO v_branch
    FROM public.branches b
   WHERE b.tenant_id = v_t.tenant_id AND b.id = v_intent.branch_id
     AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
     AND (b.publish_until IS NULL OR b.publish_until > v_now);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT cv.* INTO v_ver
    FROM public.catalog_versions cv
    JOIN public.public_web_fields wf ON wf.tenant_id = cv.tenant_id AND wf.item_id = cv.item_id
   WHERE cv.tenant_id = v_t.tenant_id AND cv.id = v_intent.catalog_version_id
     AND cv.state = 'active' AND cv.online_bookable = true
     AND wf.published = true
     AND wf.clinical_reviewed_version = cv.version
     AND wf.clinical_reviewed_artifact_sha IS NOT NULL
     AND wf.clinical_reviewed_artifact_sha = public._site_web_review_artifact_sha(
       wf.public_slug, cv.name, wf.purpose, wf.performed_by,
       cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
       cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: service_unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- Match existing tenant patient ONLY when verified phone, normalized full name, AND birth date all match
  -- (prevents shared family phones from attaching a booking to the wrong patient's RME).
  SELECT p.id INTO v_patient_id
    FROM public.contact_points cp
    JOIN public.patients p ON p.tenant_id = cp.tenant_id AND p.id = cp.patient_id
   WHERE cp.tenant_id = v_t.tenant_id
     AND cp.kind = 'phone'
     AND cp.value = v_intent.phone_e164
     AND lower(btrim(p.full_name)) = lower(btrim(v_intent.patient_name))
     AND p.birth_date = v_intent.birth_date
     AND NOT public.patient_is_merged(v_t.tenant_id, p.id)
   ORDER BY p.created_at ASC
   LIMIT 1;

  IF v_patient_id IS NULL THEN
    INSERT INTO public.patient_mrn_counters (tenant_id, last_seq) VALUES (v_t.tenant_id, 1)
      ON CONFLICT (tenant_id) DO UPDATE SET last_seq = public.patient_mrn_counters.last_seq + 1
      RETURNING last_seq INTO v_mrn_seq;
    v_mrn := 'RM-' || lpad(v_mrn_seq::text, 6, '0');

    INSERT INTO public.patients (
      tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason,
      religion, occupation, education, marital_status, registered_branch_id,
      created_by, created_as, created_at
    ) VALUES (
      v_t.tenant_id, v_mrn, v_intent.patient_name, v_intent.birth_date, v_intent.sex,
      'online_pending', 'Pendaftaran awal booking online, lengkapi identitas di Front Office',
      'lainnya', 'Booking online (belum dilengkapi)', 'lainnya', 'belum_kawin',
      v_branch.id, NULL, 'patient_online', v_now
    ) RETURNING id INTO v_patient_id;

    INSERT INTO public.contact_points (tenant_id, patient_id, kind, value, is_primary, created_at)
    VALUES (v_t.tenant_id, v_patient_id, 'phone', v_intent.phone_e164, true, v_now);
  END IF;

  PERFORM public.booking_expire_holds(v_t.tenant_id);
  v_end := v_intent.slot_start + make_interval(mins => public.booking_minutes(v_ver));

  IF EXISTS (
    SELECT 1 FROM public.appointments ap
     WHERE ap.tenant_id = v_t.tenant_id
       AND ap.patient_id = ANY (public.patient_cluster(v_t.tenant_id, v_patient_id))
       AND public.appointment_live(ap)
       AND ap.starts_at < v_end AND v_intent.slot_start < ap.ends_at
  ) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: patient_overlap' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_pick
    FROM public._public_booking_pick(v_t.tenant_id, v_branch.id, v_ver.id, v_intent.slot_start, v_end, v_intent.doctor_staff_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: slot_taken' USING ERRCODE = '55000';
  END IF;

  v_is_hold := coalesce(v_ver.booking_dp_enabled, false);
  IF v_is_hold THEN
    v_hold_until := v_now + make_interval(mins => (public.setting_value_at('SET-17', NULL, v_now))::text::integer);
  END IF;

  INSERT INTO public.appointments (
    id, tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id,
    starts_at, ends_at, state, hold_until, channel, source, created_by, created_as
  ) VALUES (
    v_appt_id, v_t.tenant_id, v_branch.id, v_patient_id, v_ver.id, v_pick.staff_id,
    v_intent.slot_start, v_end, CASE WHEN v_is_hold THEN 'held' ELSE 'booked' END,
    v_hold_until, 'online', v_intent.source_tag, NULL, 'patient_online'
  );

  BEGIN
    INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
    VALUES (v_t.tenant_id, v_branch.id, v_appt_id, 'staff', v_pick.staff_id, v_intent.slot_start, v_end);
    FOREACH x IN ARRAY v_pick.rooms LOOP
      INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
      VALUES (v_t.tenant_id, v_branch.id, v_appt_id, 'room', x, v_intent.slot_start, v_end);
    END LOOP;
    FOREACH x IN ARRAY v_pick.devices LOOP
      INSERT INTO public.resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at)
      VALUES (v_t.tenant_id, v_branch.id, v_appt_id, 'device', x, v_intent.slot_start, v_end);
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: slot_taken' USING ERRCODE = '55000';
  END;

  PERFORM public.catalog_version_reference(v_ver.id);
  UPDATE public.public_booking_intents
     SET consumed_at = v_now,
         appointment_id = v_appt_id,
         command_key = p_command_key,
         phone_e164 = NULL,
         patient_name = NULL,
         birth_date = NULL,
         sex = NULL
   WHERE id = v_intent.id;

  IF NOT v_is_hold THEN
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (
      v_t.tenant_id, v_branch.id, 'AppointmentBooked', 'appointment', v_appt_id,
      jsonb_build_object('appointment_id', v_appt_id, 'branch_id', v_branch.id, 'patient_id', v_patient_id,
                         'catalog_version_id', v_ver.id, 'performer_staff_id', v_pick.staff_id, 'channel', 'online')
    );
  END IF;

  -- Return ONLY safe public confirmation data (zero internal staff/room/device/patient/appointment UUIDs!)
  RETURN jsonb_build_object(
    'state', CASE WHEN v_is_hold THEN 'held' ELSE 'confirmed' END,
    'replayed', false,
    'sourceTag', v_intent.source_tag,
    'startsAt', to_char(v_intent.slot_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'endsAt', to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'holdUntil', CASE WHEN v_hold_until IS NOT NULL THEN to_char(v_hold_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE NULL END
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_booking_otp_verify_and_book(text,text,text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_booking_otp_verify_and_book(text,text,text,text) TO clinic_app;
