CREATE TABLE "doctor_listing_consents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"state" text DEFAULT 'granted' NOT NULL,
	"public_slug" text NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"schedule_summary" text,
	"focus_areas" text[] DEFAULT '{}'::text[] NOT NULL,
	"show_photo" boolean DEFAULT false NOT NULL,
	"photo_ref" text,
	"photo_bytes" bytea,
	"photo_media_type" text,
	"show_title_and_sip" boolean DEFAULT false NOT NULL,
	"acknowledgement_ref" text,
	"consent_sha256" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_as" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdrawn_as" text,
	"withdrawal_reason" text,
	CONSTRAINT "doctor_listing_consents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "doctor_listing_consents_state_chk" CHECK ("doctor_listing_consents"."state" in ('granted','withdrawn')),
	CONSTRAINT "doctor_listing_consents_slug_chk" CHECK ("doctor_listing_consents"."public_slug" ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
	CONSTRAINT "doctor_listing_consents_name_chk" CHECK (length(btrim("doctor_listing_consents"."display_name")) between 2 and 120),
	CONSTRAINT "doctor_listing_consents_title_chk" CHECK ("doctor_listing_consents"."title" is null or length(btrim("doctor_listing_consents"."title")) between 1 and 120),
	CONSTRAINT "doctor_listing_consents_schedule_chk" CHECK ("doctor_listing_consents"."schedule_summary" is null or length(btrim("doctor_listing_consents"."schedule_summary")) between 2 and 240),
	CONSTRAINT "doctor_listing_consents_focus_chk" CHECK (cardinality("doctor_listing_consents"."focus_areas") <= 12),
	CONSTRAINT "doctor_listing_consents_photo_chk" CHECK ("doctor_listing_consents"."photo_ref" is null or "doctor_listing_consents"."photo_ref" ~ '^/api/v1/public/doctor-photo/[a-z0-9-]+/[a-z0-9-]+\?v=[0-9a-f]{24}$'),
	CONSTRAINT "doctor_listing_consents_photo_bytes_chk" CHECK (("doctor_listing_consents"."photo_bytes" is null and "doctor_listing_consents"."photo_media_type" is null and "doctor_listing_consents"."photo_ref" is null)
       or ("doctor_listing_consents"."photo_bytes" is not null and octet_length("doctor_listing_consents"."photo_bytes") between 1 and 524288 and "doctor_listing_consents"."photo_media_type" in ('image/jpeg','image/png','image/webp') and "doctor_listing_consents"."photo_ref" is not null)),
	CONSTRAINT "doctor_listing_consents_photo_toggle_chk" CHECK ("doctor_listing_consents"."show_photo" or ("doctor_listing_consents"."photo_ref" is null and "doctor_listing_consents"."photo_bytes" is null and "doctor_listing_consents"."photo_media_type" is null)),
	CONSTRAINT "doctor_listing_consents_ack_chk" CHECK ("doctor_listing_consents"."acknowledgement_ref" is null or length(btrim("doctor_listing_consents"."acknowledgement_ref")) between 3 and 120),
	CONSTRAINT "doctor_listing_consents_sha_chk" CHECK ("doctor_listing_consents"."consent_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "doctor_listing_consents_withdrawn_chk" CHECK (("doctor_listing_consents"."state" = 'granted' and "doctor_listing_consents"."withdrawn_at" is null and "doctor_listing_consents"."withdrawn_by" is null and "doctor_listing_consents"."withdrawn_as" is null)
       or ("doctor_listing_consents"."state" = 'withdrawn' and "doctor_listing_consents"."withdrawn_at" is not null and "doctor_listing_consents"."withdrawn_by" is not null and "doctor_listing_consents"."withdrawn_as" is not null and "doctor_listing_consents"."photo_ref" is null and "doctor_listing_consents"."photo_bytes" is null and "doctor_listing_consents"."photo_media_type" is null))
);
--> statement-breakpoint
ALTER TABLE "doctor_listing_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doctor_listing_consents" ADD CONSTRAINT "doctor_listing_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_listing_consents" ADD CONSTRAINT "doctor_listing_consents_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_listing_consents" ADD CONSTRAINT "doctor_listing_consents_granted_by_fk" FOREIGN KEY ("tenant_id","granted_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_listing_consents" ADD CONSTRAINT "doctor_listing_consents_withdrawn_by_fk" FOREIGN KEY ("tenant_id","withdrawn_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_listing_consents_active_staff_uidx" ON "doctor_listing_consents" USING btree ("tenant_id","staff_id") WHERE "doctor_listing_consents"."state" = 'granted';--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_listing_consents_active_slug_uidx" ON "doctor_listing_consents" USING btree ("tenant_id","public_slug") WHERE "doctor_listing_consents"."state" = 'granted';--> statement-breakpoint
CREATE INDEX "doctor_listing_consents_tenant_state_idx" ON "doctor_listing_consents" USING btree ("tenant_id","state");--> statement-breakpoint
ALTER TABLE "public_booking_intents" ADD COLUMN "doctor_consent_id" uuid;--> statement-breakpoint
ALTER TABLE "public_booking_intents" ADD CONSTRAINT "public_booking_intents_doctor_consent_fk" FOREIGN KEY ("tenant_id","doctor_consent_id") REFERENCES "public"."doctor_listing_consents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_booking_intents" ADD CONSTRAINT "public_booking_intents_doctor_consent_chk" CHECK (("public_booking_intents"."doctor_staff_id" is null and "public_booking_intents"."doctor_consent_id" is null) or ("public_booking_intents"."doctor_staff_id" is not null and "public_booking_intents"."doctor_consent_id" is not null));
--> statement-breakpoint

-- T-125 SQL Rules (PR-66, UX-50, UX-51, DEC-130): Doctor listing with affirmative consent & immediate purge on withdrawal.
-- Invariants:
--   1. TEN-19 support_class = 'never', ENABLE RLS, REVOKE ALL FROM PUBLIC; zero direct table grants.
--   2. Monotone immutable consent history (granted -> withdrawn ONLY; never deleted/truncated).
--   3. Canonical lock order: tenant_actor_lock() -> public_sites FOR UPDATE (serializes cleanly with site_commit_publish).
--   4. Acting-role authority strictly checked on bound v_a.role (doctor self-grant/withdraw, owner tenant-wide, facility_head shared branch).
--   5. Live serve-time evaluation on unbound public_doctors_by_slug / public_doctor_detail: immediate purge on withdrawal,
--      deactivation, counsel revocation, or branch unpublish; Q-15 + show_title_and_sip gate on titles & SIP; zero UUIDs/expiry.
--   6. Live doctor_handle hooks in public_booking_catalog / public_booking_slots / public_booking_otp_request / verify_and_book.

REVOKE ALL ON TABLE public.doctor_listing_consents FROM PUBLIC;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.doctor_listing_consents', 'tenant-shared', 'public-site/doctors', '{owner,admin_pusat,facility_head,doctor}', 'doctor_listing_grant, doctor_listing_withdraw (src/modules/public-site/doctors)', 'branch-scoped for facility_head');--> statement-breakpoint

INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.doctor_listing_consents', 'never');--> statement-breakpoint

CREATE FUNCTION public.doctor_listing_consents_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'granted' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: new doctor consent must start granted' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: doctor listing consents are never deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'withdrawn' THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: withdrawn consent history is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.state <> 'withdrawn' THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: active consent rows only transition to withdrawn' USING ERRCODE = '55000';
    END IF;
    IF NEW.withdrawn_at IS NULL OR NEW.withdrawn_by IS NULL OR NEW.withdrawn_as IS NULL
       OR NEW.photo_ref IS NOT NULL OR NEW.photo_bytes IS NOT NULL OR NEW.photo_media_type IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: withdrawal requires actor, role, timestamp, and photo purge' USING ERRCODE = '22023';
    END IF;
    IF (
      NEW.id, NEW.tenant_id, NEW.staff_id, NEW.public_slug, NEW.display_name, NEW.title, NEW.schedule_summary,
      NEW.focus_areas, NEW.show_photo, NEW.show_title_and_sip, NEW.acknowledgement_ref, NEW.consent_sha256,
      NEW.granted_at, NEW.granted_by, NEW.granted_as
    ) IS DISTINCT FROM (
      OLD.id, OLD.tenant_id, OLD.staff_id, OLD.public_slug, OLD.display_name, OLD.title, OLD.schedule_summary,
      OLD.focus_areas, OLD.show_photo, OLD.show_title_and_sip, OLD.acknowledgement_ref, OLD.consent_sha256,
      OLD.granted_at, OLD.granted_by, OLD.granted_as
    ) THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: consent provenance is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.doctor_listing_consents_guard() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER doctor_listing_consents_guard BEFORE INSERT OR UPDATE OR DELETE ON public.doctor_listing_consents FOR EACH ROW EXECUTE FUNCTION public.doctor_listing_consents_guard();--> statement-breakpoint
ALTER TABLE public.doctor_listing_consents ENABLE ALWAYS TRIGGER doctor_listing_consents_guard;--> statement-breakpoint
CREATE TRIGGER doctor_listing_consents_no_truncate BEFORE TRUNCATE ON public.doctor_listing_consents FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.doctor_listing_consents ENABLE ALWAYS TRIGGER doctor_listing_consents_no_truncate;--> statement-breakpoint

-- Private canonical consent digest helper (not granted to PUBLIC or clinic_app).
CREATE FUNCTION public._doctor_consent_sha(
  p_slug text,
  p_display_name text,
  p_title text,
  p_schedule_summary text,
  p_focus_areas text[],
  p_show_photo boolean,
  p_photo_ref text,
  p_show_title_and_sip boolean
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT encode(
    sha256(convert_to(
      concat_ws(
        E'\n',
        'doctor-consent-v1',
        'slug=' || to_jsonb(lower(btrim(coalesce(p_slug, ''))))::text,
        'name=' || to_jsonb(btrim(coalesce(p_display_name, '')))::text,
        'title=' || to_jsonb(NULLIF(btrim(coalesce(p_title, '')), ''))::text,
        'schedule=' || to_jsonb(NULLIF(btrim(coalesce(p_schedule_summary, '')), ''))::text,
        'focus=' || to_jsonb(coalesce(p_focus_areas, ARRAY[]::text[]))::text,
        'showPhoto=' || to_jsonb(coalesce(p_show_photo, false))::text,
        'photoRef=' || to_jsonb(CASE WHEN coalesce(p_show_photo, false) THEN NULLIF(btrim(coalesce(p_photo_ref, '')), '') ELSE NULL END)::text,
        'showTitleAndSip=' || to_jsonb(coalesce(p_show_title_and_sip, false))::text
      ),
      'UTF8'
    )),
    'hex'
  );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._doctor_consent_sha(text,text,text,text,text[],boolean,text,boolean) FROM PUBLIC;--> statement-breakpoint

-- Private live doctor resolver for public booking hooks (not granted to PUBLIC or clinic_app).
-- Resolves an opaque public doctor slug to the exact active consent_id + staff_id ONLY when show_doctors=true,
-- consent is granted, membership is active, doctor role holds, and the doctor is assigned to p_branch_id.
CREATE FUNCTION public._public_doctor_resolve_consent(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_doctor_slug text,
  p_now timestamptz
) RETURNS TABLE (consent_id uuid, staff_id uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT d.id, d.staff_id
    FROM public.doctor_listing_consents d
    JOIN public.public_sites s ON s.tenant_id = d.tenant_id
    JOIN public.staff st ON st.tenant_id = d.tenant_id AND st.id = d.staff_id
    JOIN public.memberships m ON m.tenant_id = st.tenant_id AND m.id = st.membership_id
    JOIN public.staff_roles sr ON sr.tenant_id = st.tenant_id AND sr.staff_id = st.id AND sr.role = 'doctor'
    JOIN public.staff_branches sb ON sb.tenant_id = st.tenant_id AND sb.staff_id = st.id AND sb.role = 'doctor' AND sb.branch_id = p_branch_id
    JOIN public.branches b ON b.tenant_id = sb.tenant_id AND b.id = sb.branch_id
   WHERE d.tenant_id = p_tenant_id
     AND d.state = 'granted'
     AND d.public_slug = lower(btrim(coalesce(p_doctor_slug, '')))
     AND s.state = 'published'
     AND s.show_doctors = true
     AND m.effective_from <= p_now
     AND (m.effective_to IS NULL OR m.effective_to > p_now)
     AND b.publish_from IS NOT NULL AND b.publish_from <= p_now
     AND (b.publish_until IS NULL OR b.publish_until > p_now)
   LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._public_doctor_resolve_consent(uuid,uuid,text,timestamptz) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public._public_doctor_resolve_staff(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_doctor_slug text,
  p_now timestamptz
) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT r.staff_id
    FROM public._public_doctor_resolve_consent(p_tenant_id, p_branch_id, p_doctor_slug, p_now) r
   LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._public_doctor_resolve_staff(uuid,uuid,text,timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Private authoritative PR-65 Permenkes 1787/2010 copy linter enforced directly inside doctor_listing_grant
-- (cannot be bypassed by calling doctor_listing_grant directly as clinic_app; T-125 r3 Finding #4).
CREATE FUNCTION public._doctor_copy_is_prohibited(p_text text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_t text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN false;
  END IF;
  -- Strip zero-width evasion codepoints, normalize dashes/spaces, lowercase (mirrors rules.ts normalise()).
  v_t := lower(regexp_replace(
    regexp_replace(p_text, E'[\u200B-\u200D\u2060\uFEFF]', '', 'g'),
    E'[\\-\u2010-\u2015\u2212\\s]+', ' ', 'g'
  ));
  -- Star/strikethrough symbols
  IF p_text ~ E'[\u2605\u2606\u2B50\u0336]|~~|<\\s*(s|del|strike)\\y' THEN
    RETURN true;
  END IF;
  -- Full PR-65 Permenkes 1787/2010 parity across all 7 rule families (superlatif, perbandingan, janji_hasil,
  -- promo_diskon, testimoni, sebelum_sesudah, harga_di_teks).
  RETURN v_t ~* (
    '\y(' ||
      'satu satunya|terbaik|terbagus|termurah|tercanggih|terampuh|terhebat|termutakhir|terlengkap|terpercaya|terdepan|' ||
      'paling (ampuh|bagus|baik|murah|efektif|aman|canggih|hebat|top|manjur|populer|laris)|' ||
      'nomor (satu|1)|no\.? ?1|the only|best|cheapest|number one|most (effective|advanced|trusted)|world class|leading|' ||
      '(lebih|jauh lebih) (baik|bagus|murah|ampuh|efektif|aman|canggih|cepat) (dari|daripada) (klinik|tempat|dokter) (lain|sebelah)|' ||
      'dibanding(kan)? (dengan )?(klinik|tempat) (lain|sebelah)|(tidak|tak) ada di (klinik|tempat) lain|klinik (lain|sebelah) (tidak|tak|kalah)|' ||
      'better than (other|any)|compared (to|with) (other|competitors?)|unlike other clinics|' ||
      'dijamin|garansi|jaminan hasil|pasti (berhasil|hilang|sembuh|putih|mulus)|seratus persen|tanpa efek samping|tanpa risiko|bebas risiko|' ||
      'hasil (instan|permanen|seketika)|langsung (hilang|sembuh|putih)|sekali (sesi|perawatan|tindakan) langsung|' ||
      'guaranteed?|permanent results?|risk free|no side effects?|instant results?|' ||
      'diskon|potongan harga|promo|kode promo|voucher|cashback|gratis|harga (spesial|khusus|coret|promo|hemat)|paket hemat|bundling|' ||
      'hemat (rp|[0-9])|beli [0-9]+ gratis [0-9]+|[0-9]+ ?% ?(off|diskon)|' ||
      'flash sale|sale|discount|free (consult(ation)?|session|treatment)|buy [0-9]+ get [0-9]+|special price|limited offer|' ||
      'testimoni(al)?s?|ulasan|review pasien|kata (pasien|mereka)|pasien (kami )?puas|rating|bintang ?[0-9]|' ||
      '(patient|customer|google) reviews?|reviews? (from|by) (our )?(patients|customers)|[0-9] ?stars?|five star|' ||
      '(foto|hasil|gambar) sebelum ?(dan|&|/| )? ?sesudah|before ?(and|&|/| )? ?after|' ||
      'rp ?\.? ?[0-9][0-9.,]*|idr ?[0-9][0-9.,]*|[0-9][0-9.,]* ?(rb|ribu|jt|juta|k)|(mulai|harga|tarif|biaya) (dari )?[0-9][0-9.,]{3,}' ||
    ')\y'
    || '|#1|100 ?%|\ycicilan 0 ?%|[0-9]([.,][0-9])? ?/ ?5'
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._doctor_copy_is_prohibited(text) FROM PUBLIC;--> statement-breakpoint

-- Private image magic-byte verifier for tenant-owned doctor portraits (JPEG, PNG, WebP only).
CREATE FUNCTION public._doctor_photo_valid(p_bytes bytea, p_media_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_bytes IS NOT NULL
     AND octet_length(p_bytes) BETWEEN 12 AND 524288
     AND (
       (p_media_type = 'image/jpeg' AND substr(p_bytes, 1, 3) = E'\\xFFD8FF'::bytea)
       OR (p_media_type = 'image/png' AND substr(p_bytes, 1, 8) = E'\\x89504E470D0A1A0A'::bytea)
       OR (p_media_type = 'image/webp' AND substr(p_bytes, 1, 4) = E'\\x52494646'::bytea AND substr(p_bytes, 9, 4) = E'\\x57454250'::bytea)
     );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._doctor_photo_valid(bytea,text) FROM PUBLIC;--> statement-breakpoint

-- 1. Grant (or supersede active) doctor listing consent.
CREATE FUNCTION public.doctor_listing_grant(
  p_staff_id uuid,
  p_public_slug text,
  p_display_name text,
  p_title text,
  p_schedule_summary text,
  p_focus_areas text[],
  p_show_photo boolean,
  p_photo_bytes bytea,
  p_photo_media_type text,
  p_show_title_and_sip boolean,
  p_acknowledgement_ref text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_a record;
  v_now timestamptz;
  v_lifecycle text;
  v_site_slug text;
  v_slug text := lower(btrim(coalesce(p_public_slug, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_title text := NULLIF(btrim(coalesce(p_title, '')), '');
  v_schedule text := NULLIF(btrim(coalesce(p_schedule_summary, '')), '');
  v_photo_bytes bytea := NULL;
  v_photo_mime text := NULL;
  v_photo text := NULL;
  v_ack text := NULLIF(btrim(coalesce(p_acknowledgement_ref, '')), '');
  v_areas text[] := coalesce(p_focus_areas, ARRAY[]::text[]);
  v_area text;
  v_sha text;
  v_can_act boolean := false;
  v_is_self_doctor_grant boolean := false;
  v_is_doc boolean := false;
  v_id uuid := public.uuid_generate_v7();
BEGIN
  SELECT * INTO v_a FROM public.tenant_actor_lock();

  SELECT tr.lifecycle_state INTO v_lifecycle
    FROM public.tenants_registry tr
   WHERE tr.id = v_a.tenant_id;
  IF v_lifecycle IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: tenant_not_live' USING ERRCODE = '42501';
  END IF;

  -- Canonical lock order: tenant_actor_lock -> public_sites FOR UPDATE (serializes with site_commit_publish).
  SELECT s.slug INTO v_site_slug
    FROM public.public_sites s
   WHERE s.tenant_id = v_a.tenant_id
     FOR UPDATE;
  -- Refresh clock AFTER acquiring locks (Finding #1).
  v_now := clock_timestamp();

  IF NOT coalesce(p_show_photo, false) AND (p_photo_bytes IS NOT NULL OR NULLIF(btrim(coalesce(p_photo_media_type, '')), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: photo_ref_requires_show_photo' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_show_photo, false) AND (p_photo_bytes IS NOT NULL OR NULLIF(btrim(coalesce(p_photo_media_type, '')), '') IS NOT NULL) THEN
    IF v_site_slug IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: public_site_required_for_photo' USING ERRCODE = '22023';
    END IF;
    v_photo_mime := lower(btrim(coalesce(p_photo_media_type, '')));
    IF NOT public._doctor_photo_valid(p_photo_bytes, v_photo_mime) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid_photo_asset' USING ERRCODE = '22023';
    END IF;
    v_photo_bytes := p_photo_bytes;
    -- Server-derived consent-instance-bound portrait URL (unique per consent_id + photo bytes so withdrawal,
    -- photo replacement, or slug reuse by another doctor keeps the exact old URL permanently HTTP 404).
    v_photo := '/api/v1/public/doctor-photo/' || v_site_slug || '/' || v_slug || '?v=' ||
      left(encode(sha256(convert_to(v_id::text || ':', 'UTF8') || v_photo_bytes), 'hex'), 24);
  END IF;

  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,59}$' OR v_slug = ANY(public.public_site_reserved_slugs()) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid_public_slug' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid_display_name' USING ERRCODE = '22023';
  END IF;

  -- Authoritative PR-65 Permenkes 1787/2010 copy lint enforced at the SQL write boundary (Finding #4).
  IF public._doctor_copy_is_prohibited(v_slug)
     OR public._doctor_copy_is_prohibited(v_name)
     OR public._doctor_copy_is_prohibited(v_title)
     OR public._doctor_copy_is_prohibited(v_schedule) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: forbidden_promotional_copy' USING ERRCODE = '22023';
  END IF;
  FOREACH v_area IN ARRAY v_areas LOOP
    IF public._doctor_copy_is_prohibited(v_area) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: forbidden_promotional_copy' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Authority strictly checked on bound acting role (v_a.role).
  IF v_a.staff_id = p_staff_id AND v_a.role = 'doctor' THEN
    v_can_act := true;
    v_is_self_doctor_grant := true;
  ELSIF v_a.role = 'owner' THEN
    v_can_act := true;
  ELSIF v_a.role = 'facility_head' AND v_a.branch_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = v_a.tenant_id
         AND sb.staff_id = p_staff_id
         AND sb.role = 'doctor'
         AND sb.branch_id = v_a.branch_id
    ) INTO v_can_act;
  END IF;
  IF NOT v_can_act THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: actor cannot grant doctor listing consent' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_self_doctor_grant AND (v_ack IS NULL OR length(v_ack) < 3) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: delegated consent requires acknowledgement_ref' USING ERRCODE = '22023';
  END IF;

  -- Target must be an active doctor in this tenant.
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
      JOIN public.staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.id AND sr.role = 'doctor'
     WHERE s.tenant_id = v_a.tenant_id AND s.id = p_staff_id
       AND m.effective_from <= v_now AND (m.effective_to IS NULL OR m.effective_to > v_now)
  ) INTO v_is_doc;
  IF NOT v_is_doc THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: active doctor not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.doctor_listing_consents d
     WHERE d.tenant_id = v_a.tenant_id AND d.state = 'granted'
       AND d.public_slug = v_slug AND d.staff_id <> p_staff_id
  ) THEN
    RAISE EXCEPTION 'ERR_CONFLICT: doctor_slug_in_use' USING ERRCODE = '23505';
  END IF;

  UPDATE public.doctor_listing_consents
     SET state = 'withdrawn',
         photo_ref = NULL,
         photo_bytes = NULL,
         photo_media_type = NULL,
         withdrawn_at = v_now,
         withdrawn_by = v_a.staff_id,
         withdrawn_as = v_a.role,
         withdrawal_reason = 'superseded_by_new_consent'
   WHERE tenant_id = v_a.tenant_id AND staff_id = p_staff_id AND state = 'granted';

  v_sha := public._doctor_consent_sha(
    v_slug, v_name, v_title, v_schedule, v_areas,
    coalesce(p_show_photo, false), v_photo, coalesce(p_show_title_and_sip, false)
  );

  INSERT INTO public.doctor_listing_consents (
    id, tenant_id, staff_id, state, public_slug, display_name, title, schedule_summary,
    focus_areas, show_photo, photo_ref, photo_bytes, photo_media_type, show_title_and_sip, acknowledgement_ref,
    consent_sha256, granted_at, granted_by, granted_as
  ) VALUES (
    v_id, v_a.tenant_id, p_staff_id, 'granted', v_slug, v_name, v_title, v_schedule,
    v_areas, coalesce(p_show_photo, false), v_photo, v_photo_bytes, v_photo_mime, coalesce(p_show_title_and_sip, false), v_ack,
    v_sha, v_now, v_a.staff_id, v_a.role
  );

  PERFORM public.audit_append('settings_change', 'doctor_listing_consent', v_id, 'success', 'doctor_listing_granted');
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (
    v_a.tenant_id, v_a.branch_id, 'DoctorListingConsentGranted', 'doctor_listing_consent', v_id,
    v_a.staff_id, v_a.role, jsonb_build_object('consent_id', v_id, 'staff_id', p_staff_id)
  );
  RETURN jsonb_build_object('id', v_id, 'publicSlug', v_slug, 'photoUrl', v_photo, 'state', 'granted', 'consentSha256', v_sha);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.doctor_listing_grant(uuid,text,text,text,text,text[],boolean,bytea,text,boolean,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.doctor_listing_grant(uuid,text,text,text,text,text[],boolean,bytea,text,boolean,text) TO clinic_app;--> statement-breakpoint

-- 2. Immediate withdrawal + atomic photo purge (unconditional doctor self-service OR owner / shared-branch facility_head).
CREATE FUNCTION public.doctor_listing_withdraw(p_staff_id uuid, p_reason text DEFAULT 'withdrawn_by_doctor') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_a record;
  v_now timestamptz;
  v_lifecycle text;
  v_can_act boolean := false;
  v_id uuid;
  v_reason text := coalesce(NULLIF(btrim(coalesce(p_reason, '')), ''), 'withdrawn_by_doctor');
BEGIN
  SELECT * INTO v_a FROM public.tenant_actor_lock();

  SELECT tr.lifecycle_state INTO v_lifecycle
    FROM public.tenants_registry tr
   WHERE tr.id = v_a.tenant_id;
  IF v_lifecycle NOT IN ('live', 'suspended', 'exit') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: tenant_closed' USING ERRCODE = '42501';
  END IF;

  -- Lock public_sites FOR UPDATE under staff_access so concurrent site_publish cannot resurrect this doctor.
  PERFORM 1 FROM public.public_sites s WHERE s.tenant_id = v_a.tenant_id FOR UPDATE;
  v_now := clock_timestamp();

  IF v_a.staff_id = p_staff_id THEN
    v_can_act := true;
  ELSIF v_a.role = 'owner' THEN
    v_can_act := true;
  ELSIF v_a.role = 'facility_head' AND v_a.branch_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.staff_branches sb
       WHERE sb.tenant_id = v_a.tenant_id
         AND sb.staff_id = p_staff_id
         AND sb.role = 'doctor'
         AND sb.branch_id = v_a.branch_id
    ) INTO v_can_act;
  END IF;
  IF NOT v_can_act THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: actor cannot withdraw doctor listing consent' USING ERRCODE = '42501';
  END IF;

  UPDATE public.doctor_listing_consents
     SET state = 'withdrawn',
         photo_ref = NULL,
         photo_bytes = NULL,
         photo_media_type = NULL,
         withdrawn_at = v_now,
         withdrawn_by = v_a.staff_id,
         withdrawn_as = v_a.role,
         withdrawal_reason = left(v_reason, 200)
   WHERE tenant_id = v_a.tenant_id AND staff_id = p_staff_id AND state = 'granted'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no active doctor listing consent' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.audit_append('settings_change', 'doctor_listing_consent', v_id, 'success', 'doctor_listing_withdrawn');
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (
    v_a.tenant_id, v_a.branch_id, 'DoctorListingConsentWithdrawn', 'doctor_listing_consent', v_id,
    v_a.staff_id, v_a.role, jsonb_build_object('consent_id', v_id, 'staff_id', p_staff_id)
  );
  RETURN jsonb_build_object('id', v_id, 'state', 'withdrawn');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.doctor_listing_withdraw(uuid,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.doctor_listing_withdraw(uuid,text) TO clinic_app;--> statement-breakpoint

-- 3. Bound staff reader for doctor consent records (owner/admin_pusat tenant-wide, facility_head branch-scoped, doctor own rows).
CREATE FUNCTION public.doctor_listing_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_a record;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_a FROM public.approval_actor();
  IF v_a.role NOT IN ('owner', 'admin_pusat', 'facility_head', 'doctor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role cannot read doctor listing consents' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'staffId', d.staff_id,
      'state', d.state,
      'publicSlug', d.public_slug,
      'displayName', d.display_name,
      'title', d.title,
      'scheduleSummary', d.schedule_summary,
      'focusAreas', to_jsonb(d.focus_areas),
      'showPhoto', d.show_photo,
      'photoRef', d.photo_ref,
      'showTitleAndSip', d.show_title_and_sip,
      'acknowledgementRef', d.acknowledgement_ref,
      'consentSha256', d.consent_sha256,
      'grantedAt', to_char(d.granted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'grantedBy', d.granted_by,
      'grantedAs', d.granted_as,
      'withdrawnAt', CASE WHEN d.withdrawn_at IS NOT NULL THEN to_char(d.withdrawn_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE NULL END,
      'withdrawnBy', d.withdrawn_by,
      'withdrawnAs', d.withdrawn_as,
      'withdrawalReason', d.withdrawal_reason
    ) ORDER BY d.granted_at DESC, d.id DESC
  ), '[]'::jsonb)
    INTO v_rows
    FROM public.doctor_listing_consents d
   WHERE d.tenant_id = v_a.tenant_id
     AND (
       v_a.role IN ('owner', 'admin_pusat')
       OR (v_a.role = 'doctor' AND d.staff_id = v_a.staff_id)
       OR (v_a.role = 'facility_head' AND v_a.branch_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.staff_branches sb
          WHERE sb.tenant_id = d.tenant_id AND sb.staff_id = d.staff_id
            AND sb.role = 'doctor' AND sb.branch_id = v_a.branch_id
       ))
     );

  RETURN v_rows;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.doctor_listing_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.doctor_listing_list() TO clinic_app;--> statement-breakpoint

-- 4. Unbound live public doctors reader (BOOKING_HOST; zero staff_id/tenant_id/branch_id UUIDs, zero SIP expiry dates).
CREATE FUNCTION public.public_doctors_by_slug(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_site record;
  v_counsel uuid;
  v_titles_ok boolean := false;
  v_doctors jsonb;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public doctors run unbound' USING ERRCODE = '42501';
  END IF;

  SELECT s.tenant_id, s.show_doctors, s.doctor_titles_allowed, s.counsel_approval_id, v.counsel_approval_id AS ver_counsel
    INTO v_site
    FROM public.public_sites s
    JOIN public.tenants_registry tr ON tr.id = s.tenant_id
    JOIN public.public_site_versions v ON v.tenant_id = s.tenant_id AND v.version = s.published_version
   WHERE s.slug = v_slug
     AND s.state = 'published'
     AND tr.lifecycle_state = 'live';

  IF NOT FOUND OR NOT v_site.show_doctors THEN
    RETURN '[]'::jsonb;
  END IF;

  v_counsel := public._public_site_counsel_approval(v_site.tenant_id);
  IF v_counsel IS NULL OR v_counsel IS DISTINCT FROM v_site.ver_counsel THEN
    RETURN '[]'::jsonb;
  END IF;

  v_titles_ok := (v_site.doctor_titles_allowed AND v_site.counsel_approval_id = v_counsel);

  SELECT coalesce(jsonb_agg(doc_row.obj ORDER BY doc_row.display_name, doc_row.public_slug), '[]'::jsonb)
    INTO v_doctors
    FROM (
      SELECT
        d.display_name,
        d.public_slug,
        jsonb_build_object(
          'slug', d.public_slug,
          'name', d.display_name,
          'title', CASE WHEN v_titles_ok AND d.show_title_and_sip THEN d.title ELSE NULL END,
          'scheduleSummary', d.schedule_summary,
          'sipNumbers', CASE WHEN v_titles_ok AND d.show_title_and_sip THEN coalesce((
            SELECT jsonb_agg(
              jsonb_build_object('branchSlug', lower(b.code), 'branchName', b.name, 'sip', sc.number)
              ORDER BY lower(b.code), sc.number
            )
              FROM public.staff_credentials sc
              JOIN public.staff_branches sb ON sb.tenant_id = sc.tenant_id AND sb.staff_id = sc.staff_id AND sb.role = 'doctor' AND sb.branch_id = sc.branch_id
              JOIN public.branches b ON b.tenant_id = sc.tenant_id AND b.id = sc.branch_id
             WHERE sc.tenant_id = d.tenant_id AND sc.staff_id = d.staff_id
               AND sc.kind = 'sip' AND sc.state = 'verified'
               AND (sc.valid_from IS NULL OR sc.valid_from <= (v_now AT TIME ZONE b.timezone)::date)
               AND (sc.expires_on IS NULL OR sc.expires_on >= (v_now AT TIME ZONE b.timezone)::date)
               AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
               AND (b.publish_until IS NULL OR b.publish_until > v_now)
          ), '[]'::jsonb) ELSE '[]'::jsonb END,
          'focusAreas', to_jsonb(d.focus_areas),
          'photoUrl', CASE WHEN d.show_photo THEN d.photo_ref ELSE NULL END,
          'branchSlugs', br.slugs
        ) AS obj
      FROM public.doctor_listing_consents d
      JOIN public.staff st ON st.tenant_id = d.tenant_id AND st.id = d.staff_id
      JOIN public.memberships m ON m.tenant_id = st.tenant_id AND m.id = st.membership_id
      JOIN public.staff_roles sr ON sr.tenant_id = st.tenant_id AND sr.staff_id = st.id AND sr.role = 'doctor'
      JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT lower(b.code) ORDER BY lower(b.code)) AS slugs
          FROM public.staff_branches sb
          JOIN public.branches b ON b.tenant_id = sb.tenant_id AND b.id = sb.branch_id
         WHERE sb.tenant_id = d.tenant_id AND sb.staff_id = d.staff_id AND sb.role = 'doctor'
           AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
           AND (b.publish_until IS NULL OR b.publish_until > v_now)
      ) br ON br.slugs IS NOT NULL
     WHERE d.tenant_id = v_site.tenant_id
       AND d.state = 'granted'
       AND m.effective_from <= v_now
       AND (m.effective_to IS NULL OR m.effective_to > v_now)
    ) doc_row;

  RETURN v_doctors;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_doctors_by_slug(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_doctors_by_slug(text) TO clinic_app;--> statement-breakpoint

-- 5. Unbound single-doctor public detail reader (returns neutral not_found immediately on withdraw/deactivation).
CREATE FUNCTION public.public_doctor_detail(p_slug text, p_doctor_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_doc_slug text := lower(btrim(coalesce(p_doctor_slug, '')));
  v_docs jsonb;
  v_match jsonb;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public doctors run unbound' USING ERRCODE = '42501';
  END IF;
  IF v_doc_slug !~ '^[a-z0-9][a-z0-9-]{1,59}$' THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  v_docs := public.public_doctors_by_slug(p_slug);
  SELECT elem INTO v_match
    FROM jsonb_array_elements(v_docs) AS elem
   WHERE elem->>'slug' = v_doc_slug
   LIMIT 1;

  IF v_match IS NULL THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  RETURN jsonb_build_object('state', 'found', 'doctor', v_match);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_doctor_detail(text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_doctor_detail(text,text) TO clinic_app;--> statement-breakpoint

-- 5b. Unbound live public doctor portrait reader (bound to exact issued ?v= consent-instance version:
--     permanent 404 on withdrawal, photo replacement, or slug reassignment; live 404 while deactivated,
--     branch-unpublished, suspended, or lacking active Q-15 counsel).
CREATE FUNCTION public.public_doctor_photo(p_slug text, p_doctor_slug text, p_version text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_doc_slug text := lower(btrim(coalesce(p_doctor_slug, '')));
  v_ver text := lower(btrim(coalesce(p_version, '')));
  v_expected_ref text;
  v_site record;
  v_counsel uuid;
  v_row record;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: public doctors run unbound' USING ERRCODE = '42501';
  END IF;
  IF v_doc_slug !~ '^[a-z0-9][a-z0-9-]{1,59}$' OR v_ver !~ '^[0-9a-f]{24}$' THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  v_expected_ref := '/api/v1/public/doctor-photo/' || v_slug || '/' || v_doc_slug || '?v=' || v_ver;

  SELECT s.tenant_id, s.show_doctors, v.counsel_approval_id AS ver_counsel
    INTO v_site
    FROM public.public_sites s
    JOIN public.tenants_registry tr ON tr.id = s.tenant_id
    JOIN public.public_site_versions v ON v.tenant_id = s.tenant_id AND v.version = s.published_version
   WHERE s.slug = v_slug
     AND s.state = 'published'
     AND tr.lifecycle_state = 'live';

  IF NOT FOUND OR NOT v_site.show_doctors THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  v_counsel := public._public_site_counsel_approval(v_site.tenant_id);
  IF v_counsel IS NULL OR v_counsel IS DISTINCT FROM v_site.ver_counsel THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT d.photo_media_type, d.photo_bytes
    INTO v_row
    FROM public.doctor_listing_consents d
    JOIN public.staff st ON st.tenant_id = d.tenant_id AND st.id = d.staff_id
    JOIN public.memberships m ON m.tenant_id = st.tenant_id AND m.id = st.membership_id
    JOIN public.staff_roles sr ON sr.tenant_id = st.tenant_id AND sr.staff_id = st.id AND sr.role = 'doctor'
   WHERE d.tenant_id = v_site.tenant_id
     AND d.public_slug = v_doc_slug
     AND d.photo_ref = v_expected_ref
     AND d.state = 'granted'
     AND d.show_photo = true
     AND d.photo_bytes IS NOT NULL
     AND d.photo_media_type IS NOT NULL
     AND m.effective_from <= v_now
     AND (m.effective_to IS NULL OR m.effective_to > v_now)
     AND EXISTS (
       SELECT 1
         FROM public.staff_branches sb
         JOIN public.branches b ON b.tenant_id = sb.tenant_id AND b.id = sb.branch_id
        WHERE sb.tenant_id = d.tenant_id AND sb.staff_id = d.staff_id AND sb.role = 'doctor'
          AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
          AND (b.publish_until IS NULL OR b.publish_until > v_now)
     )
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'state', 'found',
    'mediaType', v_row.photo_media_type,
    'bytesBase64', replace(encode(v_row.photo_bytes, 'base64'), E'\n', '')
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_doctor_photo(text,text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_doctor_photo(text,text,text) TO clinic_app;--> statement-breakpoint

-- 6. Hook T-126 public_booking_* seam into live consented public doctors (zero UUIDs, immediate fail-closed on withdrawal).
CREATE OR REPLACE FUNCTION public.public_booking_catalog(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t record;
  v_branches jsonb;
  v_treatments jsonb;
  v_doctors jsonb;
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

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'slug', elem->>'slug',
      'name', elem->>'name',
      'branchSlugs', elem->'branchSlugs'
    )
  ), '[]'::jsonb)
    INTO v_doctors
    FROM jsonb_array_elements(public.public_doctors_by_slug(v_t.slug)) AS elem;

  RETURN jsonb_build_object(
    'state', 'open',
    'slug', v_t.slug,
    'brand', v_t.brand_name,
    'branches', v_branches,
    'treatments', v_treatments,
    'doctors', v_doctors
  );
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.public_booking_slots(
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
  v_doctor_id uuid := NULL;
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

  IF p_doctor_handle IS NOT NULL AND btrim(p_doctor_handle) <> '' THEN
    v_doctor_id := public._public_doctor_resolve_staff(v_t.tenant_id, v_branch.id, p_doctor_handle, v_now);
    IF v_doctor_id IS NULL THEN
      RETURN jsonb_build_object('state', 'open', 'date', p_date, 'timezone', v_branch.timezone, 'slots', '[]'::jsonb);
    END IF;
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
        FROM public._public_booking_pick(v_t.tenant_id, v_branch.id, v_ver.id, v_cursor, v_cursor + make_interval(mins => v_dur), v_doctor_id);
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

CREATE OR REPLACE FUNCTION public.public_booking_otp_request(
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
  v_doctor_id uuid := NULL;
  v_doctor_consent_id uuid := NULL;
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
    SELECT r.consent_id, r.staff_id
      INTO v_doctor_consent_id, v_doctor_id
      FROM public._public_doctor_resolve_consent(v_t.tenant_id, v_branch.id, p_doctor_handle, v_now) r;
    IF v_doctor_id IS NULL OR v_doctor_consent_id IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: doctor_unavailable' USING ERRCODE = '22023';
    END IF;
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
    FROM public._public_booking_pick(v_t.tenant_id, v_branch.id, v_ver.id, p_slot_start, p_slot_start + make_interval(mins => public.booking_minutes(v_ver)), v_doctor_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: slot_taken' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.public_booking_intents (
    tenant_id, intent_hash, branch_id, catalog_version_id, doctor_staff_id, doctor_consent_id,
    slot_start, source_tag, phone_e164, phone_hash, patient_name, birth_date, sex,
    otp_hash, otp_expires_at, ip_hash, last_sent_at
  ) VALUES (
    v_t.tenant_id, p_intent_hash, v_branch.id, v_ver.id, v_doctor_id, v_doctor_consent_id,
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

CREATE OR REPLACE FUNCTION public.public_booking_otp_verify_and_book(
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
  v_existing_appt public.appointments;
  v_branch public.branches;
  v_ver public.catalog_versions;
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

  -- Serialize with tenant clinical/scheduling/doctor-consent writers (canonical lock order: staff_access:<tenant> BEFORE row locks).
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_t.tenant_id::text, 0));

  SELECT * INTO v_intent
    FROM public.public_booking_intents i
   WHERE i.tenant_id = v_t.tenant_id AND i.intent_hash = p_intent_hash
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  -- T-125 r3 Finding #1: refresh clock AFTER acquiring staff_access and intent row locks so a request
  -- that waited past OTP expiry, branch unpublish, or doctor membership expiry fails closed cleanly!
  v_now := clock_timestamp();

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

  -- T-125: Re-verify the EXACT consent row under staff_access lock so a mid-flow withdrawal (even followed by re-grant) fails closed immediately!
  IF v_intent.doctor_staff_id IS NOT NULL THEN
    IF v_intent.doctor_consent_id IS NULL OR NOT EXISTS (
      SELECT 1
        FROM public.doctor_listing_consents d
        JOIN public.public_sites s ON s.tenant_id = d.tenant_id
        JOIN public.staff st ON st.tenant_id = d.tenant_id AND st.id = d.staff_id
        JOIN public.memberships m ON m.tenant_id = st.tenant_id AND m.id = st.membership_id
        JOIN public.staff_roles sr ON sr.tenant_id = st.tenant_id AND sr.staff_id = st.id AND sr.role = 'doctor'
        JOIN public.staff_branches sb ON sb.tenant_id = st.tenant_id AND sb.staff_id = st.id AND sb.role = 'doctor' AND sb.branch_id = v_branch.id
       WHERE d.tenant_id = v_t.tenant_id
         AND d.id = v_intent.doctor_consent_id
         AND d.staff_id = v_intent.doctor_staff_id
         AND d.state = 'granted'
         AND s.state = 'published' AND s.show_doctors = true
         AND m.effective_from <= v_now AND (m.effective_to IS NULL OR m.effective_to > v_now)
    ) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: doctor_unavailable' USING ERRCODE = 'P0002';
    END IF;
  END IF;

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

  RETURN jsonb_build_object(
    'state', CASE WHEN v_is_hold THEN 'held' ELSE 'confirmed' END,
    'replayed', false,
    'sourceTag', v_intent.source_tag,
    'startsAt', to_char(v_intent.slot_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'endsAt', to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'holdUntil', CASE WHEN v_hold_until IS NOT NULL THEN to_char(v_hold_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE NULL END
  );
END
$$;
