CREATE TABLE "public_site_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"slug" text NOT NULL,
	"counsel_approval_id" uuid NOT NULL,
	"tariff_list_allowed" boolean DEFAULT false NOT NULL,
	"doctor_titles_allowed" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"published_by" uuid NOT NULL,
	"published_as" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_site_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "public_site_versions_tenant_version_key" UNIQUE("tenant_id","version"),
	CONSTRAINT "public_site_versions_version_check" CHECK ("public_site_versions"."version" >= 1),
	CONSTRAINT "public_site_versions_sha_check" CHECK ("public_site_versions"."snapshot_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "public_site_versions_snapshot_check" CHECK (jsonb_typeof("public_site_versions"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "public_site_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "public_sites" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"published_version" integer,
	"brand_name" text NOT NULL,
	"accent_hex" text,
	"hero_photo" text,
	"one_line" text,
	"show_treatments" boolean DEFAULT true NOT NULL,
	"show_branches" boolean DEFAULT true NOT NULL,
	"show_doctors" boolean DEFAULT false NOT NULL,
	"tariff_list_allowed" boolean DEFAULT false NOT NULL,
	"doctor_titles_allowed" boolean DEFAULT false NOT NULL,
	"counsel_approval_id" uuid,
	"meta_pixel_id" text,
	"ga_measurement_id" text,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_sites_tenant_id_key" UNIQUE("tenant_id"),
	CONSTRAINT "public_sites_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "public_sites_slug_key" UNIQUE("slug"),
	CONSTRAINT "public_sites_slug_check" CHECK ("public_sites"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
	CONSTRAINT "public_sites_state_check" CHECK ("public_sites"."state" in ('draft','published','unpublished')),
	CONSTRAINT "public_sites_published_state_check" CHECK (("public_sites"."state" = 'published') = ("public_sites"."published_version" is not null)
        and ("public_sites"."published_version" is null or "public_sites"."first_published_at" is not null)
        and ("public_sites"."published_version" is null or "public_sites"."counsel_approval_id" is not null)),
	CONSTRAINT "public_sites_brand_check" CHECK (length(btrim("public_sites"."brand_name")) between 2 and 120),
	CONSTRAINT "public_sites_accent_check" CHECK ("public_sites"."accent_hex" is null or "public_sites"."accent_hex" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "public_sites_hero_photo_check" CHECK ("public_sites"."hero_photo" is null or "public_sites"."hero_photo" ~ '^/media/public/[a-z0-9-]+/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$'),
	CONSTRAINT "public_sites_one_line_check" CHECK ("public_sites"."one_line" is null or length(btrim("public_sites"."one_line")) <= 160),
	CONSTRAINT "public_sites_counsel_permissions_check" CHECK ((not "public_sites"."tariff_list_allowed" and not "public_sites"."doctor_titles_allowed") or "public_sites"."counsel_approval_id" is not null),
	CONSTRAINT "public_sites_meta_pixel_check" CHECK ("public_sites"."meta_pixel_id" is null or "public_sites"."meta_pixel_id" ~ '^[0-9]{8,20}$'),
	CONSTRAINT "public_sites_ga_check" CHECK ("public_sites"."ga_measurement_id" is null or "public_sites"."ga_measurement_id" ~ '^G-[A-Z0-9]{6,16}$')
);
--> statement-breakpoint
ALTER TABLE "public_sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "public_web_fields" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"public_slug" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"publish_price" boolean DEFAULT false NOT NULL,
	"purpose" text NOT NULL,
	"performed_by" text NOT NULL,
	"downtime" text,
	"sessions" integer,
	"interval_days" integer,
	"price_note" text,
	"hero_photo" text,
	"hero_alt" text,
	"caption" text,
	"clinical_reviewed_version" integer,
	"clinical_reviewed_artifact_sha" text,
	"clinical_reviewed_by" uuid,
	"clinical_reviewed_at" timestamp with time zone,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_web_fields_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "public_web_fields_tenant_item_key" UNIQUE("tenant_id","item_id"),
	CONSTRAINT "public_web_fields_tenant_slug_key" UNIQUE("tenant_id","public_slug"),
	CONSTRAINT "public_web_fields_slug_check" CHECK ("public_web_fields"."public_slug" ~ '^[a-z0-9][a-z0-9-]{0,127}$'),
	CONSTRAINT "public_web_fields_purpose_check" CHECK (length(btrim("public_web_fields"."purpose")) between 3 and 2000),
	CONSTRAINT "public_web_fields_performed_by_check" CHECK (length(btrim("public_web_fields"."performed_by")) between 2 and 120),
	CONSTRAINT "public_web_fields_downtime_check" CHECK ("public_web_fields"."downtime" is null or length(btrim("public_web_fields"."downtime")) <= 200),
	CONSTRAINT "public_web_fields_sessions_check" CHECK ("public_web_fields"."sessions" is null or "public_web_fields"."sessions" between 1 and 50),
	CONSTRAINT "public_web_fields_interval_check" CHECK ("public_web_fields"."interval_days" is null or "public_web_fields"."interval_days" between 1 and 365),
	CONSTRAINT "public_web_fields_price_note_check" CHECK ("public_web_fields"."price_note" is null or length(btrim("public_web_fields"."price_note")) <= 200),
	CONSTRAINT "public_web_fields_hero_photo_check" CHECK ("public_web_fields"."hero_photo" is null or "public_web_fields"."hero_photo" ~ '^/media/public/[a-z0-9-]+/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$'),
	CONSTRAINT "public_web_fields_hero_alt_check" CHECK ("public_web_fields"."hero_alt" is null or length(btrim("public_web_fields"."hero_alt")) <= 160),
	CONSTRAINT "public_web_fields_caption_check" CHECK ("public_web_fields"."caption" is null or length(btrim("public_web_fields"."caption")) <= 240),
	CONSTRAINT "public_web_fields_review_sha_check" CHECK ("public_web_fields"."clinical_reviewed_artifact_sha" is null or "public_web_fields"."clinical_reviewed_artifact_sha" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "public_web_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendor_legal_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_legal_templates_kind_version_key" UNIQUE("kind","version"),
	CONSTRAINT "vendor_legal_templates_kind_check" CHECK ("vendor_legal_templates"."kind" in ('kebijakan-privasi','syarat-ketentuan','kebijakan-pembatalan')),
	CONSTRAINT "vendor_legal_templates_version_check" CHECK ("vendor_legal_templates"."version" >= 1),
	CONSTRAINT "vendor_legal_templates_body_check" CHECK (length(btrim("vendor_legal_templates"."body")) between 20 and 50000 and "vendor_legal_templates"."body" !~ '[<>]'),
	CONSTRAINT "vendor_legal_templates_sha_check" CHECK ("vendor_legal_templates"."body_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "vendor_legal_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public_site_versions" ADD CONSTRAINT "public_site_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_site_versions" ADD CONSTRAINT "public_site_versions_tenant_id_site_id_public_sites_tenant_id_id_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."public_sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_site_versions" ADD CONSTRAINT "public_site_versions_tenant_id_published_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","published_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_site_versions" ADD CONSTRAINT "public_site_versions_tenant_id_counsel_approval_id_evidence_approvals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","counsel_approval_id") REFERENCES "public"."evidence_approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_sites" ADD CONSTRAINT "public_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_sites" ADD CONSTRAINT "public_sites_tenant_id_updated_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_sites" ADD CONSTRAINT "public_sites_tenant_id_counsel_approval_id_evidence_approvals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","counsel_approval_id") REFERENCES "public"."evidence_approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_web_fields" ADD CONSTRAINT "public_web_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_web_fields" ADD CONSTRAINT "public_web_fields_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_web_fields" ADD CONSTRAINT "public_web_fields_tenant_id_updated_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_web_fields" ADD CONSTRAINT "public_web_fields_tenant_id_clinical_reviewed_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","clinical_reviewed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_web_fields_tenant_published_idx" ON "public_web_fields" USING btree ("tenant_id","published");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_legal_templates_one_active" ON "vendor_legal_templates" USING btree ("kind") WHERE "vendor_legal_templates"."is_active";
--> statement-breakpoint
-- T-123 / T-124 SQL Rules (Migration 0136 appendix).
-- Closes Findings #1, #2, #4, #5, #6, #7 of t123/WAVE1-PLAN-REVISED-20261124.md:
--   #1: site_commit_publish re-validates every branch, treatment, review version, price visibility & effective amount
--       against locked canonical master tables + facts_sha256 (zero trust in arbitrary client JSON).
--   #2: Lock order tenant_actor_lock -> feature_gate_lock('public_site_publish') -> public_sites FOR UPDATE;
--       counsel validity evaluated against clock_timestamp() (Asia/Jakarta date); tariff_list_allowed & doctor_titles_allowed
--       bound to counsel_approval_id; unbound public_site_by_slug re-checks counsel validity on every read.
--   #4: Snapshot rejects raw tenant_id UUIDs, rejects third-party heroPhoto URLs, ships zero doctors until T-125,
--       enforces consultation tariff (no amount, no note) whenever tariff_list_allowed=false or publish_price=false.
--   #5: public_site_by_slug overlays live branch publish windows (clock_timestamp()) and live reason-free branch_closures (30-day window).
--   #6: SQL mirrors RESERVED_SEGMENTS from src/lib/hosts.ts; slug immutability driven strictly by first_published_at IS NOT NULL.
--   #7: TEN-19 'never' on public_sites, public_site_versions, public_web_fields; ENABLE RLS + REVOKE ALL FROM PUBLIC.

REVOKE ALL ON TABLE public.public_sites FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.public_site_versions FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.public_web_fields FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.vendor_legal_templates FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.public_sites ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_site_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_web_fields ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_legal_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.public_sites', 'tenant-shared', 'public-site', '{owner,admin_pusat,marketing,facility_head}', 'site_save_settings, site_commit_publish, site_unpublish (src/modules/public-site)', 'none (tenant-wide)'),
  ('public.public_site_versions', 'tenant-shared', 'public-site', '{owner,admin_pusat,marketing,facility_head}', 'site_commit_publish (src/modules/public-site)', 'none (tenant-wide)'),
  ('public.public_web_fields', 'tenant-shared', 'public-site', '{owner,admin_pusat,marketing,facility_head}', 'site_save_web_field, site_approve_web_review (src/modules/public-site)', 'none (tenant-wide)'),
  ('public.vendor_legal_templates', 'platform', 'public-site', '{}', 'vendor legal template admin (T-129)', 'none');--> statement-breakpoint

INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.public_sites', 'never'),
  ('public.public_site_versions', 'never'),
  ('public.public_web_fields', 'never');--> statement-breakpoint

-- Finding #6: exact SQL mirror of RESERVED_SEGMENTS in src/lib/hosts.ts (verified by parity test in tests/public/site.test.ts).
CREATE FUNCTION public.public_site_reserved_slugs() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ARRAY[
    'aftercare','antrean','api','apotek','audit','ekspor','hari-ini','jadwal',
    'jadwal-staf','kampanye','kasir','katalog','keluhan','kepatuhan','keuangan',
    'komisi','laporan','layanan','lead','logbook','masuk','otomasi','pasien',
    'pasienku','pembelian','pemeriksaan','pendampingan','pengaturan','pengguna-akses',
    'permintaan','persetujuan','persetujuan-tindakan','pesan','piutang','privasi',
    'ringkasan','ruang','satusehat','saya','simulasi','situs','staf','stok',
    'templat','vendor','verifikasi','terkunci','aktifkan-2fa','dev','undangan','layar-antrean'
  ]::text[];
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_site_reserved_slugs() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_site_reserved_slugs() TO clinic_app;--> statement-breakpoint

-- Guard trigger on public_sites: reserved slugs refused, slug permanently immutable after first_published_at, never deleted.
CREATE FUNCTION public.public_sites_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: public_sites rows are never deleted' USING ERRCODE = '55000';
  END IF;
  IF NEW.slug = ANY (public.public_site_reserved_slugs()) THEN
    RAISE EXCEPTION 'ERR_SLUG_RESERVED: reserved slug' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.first_published_at IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'ERR_SLUG_IMMUTABLE: slug is immutable after first publish' USING ERRCODE = '55000';
    END IF;
    IF OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: first_published_at is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_sites_guard() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER public_sites_guard BEFORE INSERT OR UPDATE OR DELETE ON public.public_sites FOR EACH ROW EXECUTE FUNCTION public.public_sites_guard();--> statement-breakpoint
ALTER TABLE public.public_sites ENABLE ALWAYS TRIGGER public_sites_guard;--> statement-breakpoint
CREATE TRIGGER public_sites_no_truncate BEFORE TRUNCATE ON public.public_sites FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.public_sites ENABLE ALWAYS TRIGGER public_sites_no_truncate;--> statement-breakpoint
CREATE TRIGGER public_site_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.public_site_versions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.public_site_versions ENABLE ALWAYS TRIGGER public_site_versions_immutable;--> statement-breakpoint

-- Private unbound helper (Finding #2): returns the currently active approved counsel evidence_approvals.id
-- for p_tenant judged strictly against clock_timestamp() (Asia/Jakarta date), covering the latest evidence file version,
-- or NULL if missing/revoked/expired/superseded by a newer unapproved file.
CREATE FUNCTION public._public_site_counsel_approval(p_tenant uuid) RETURNS uuid
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT a.id
    FROM public.evidence_items i
    JOIN LATERAL (
      SELECT f.id AS latest_file_id
        FROM public.evidence_files f
       WHERE f.tenant_id = i.tenant_id AND f.item_id = i.id
       ORDER BY f.version DESC
       LIMIT 1
    ) lf ON true
    JOIN LATERAL (
      SELECT ea.id, ea.file_id, ea.decision, ea.valid_until
        FROM public.evidence_approvals ea
       WHERE ea.tenant_id = i.tenant_id AND ea.item_id = i.id
       ORDER BY ea.seq DESC
       LIMIT 1
    ) a ON true
   WHERE i.tenant_id = p_tenant
     AND i.obligation_key = 'public_site_counsel'
     AND i.state = 'approved'
     AND a.decision = 'approved'
     AND a.file_id = lf.latest_file_id
     AND (i.valid_until IS NULL OR i.valid_until >= (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date)
     AND (a.valid_until IS NULL OR a.valid_until >= (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date)
   LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._public_site_counsel_approval(uuid) FROM PUBLIC;--> statement-breakpoint

-- Private helper: verify active staff actor with role in p_roles and tenant lifecycle capability.
CREATE FUNCTION public._site_actor(p_roles text[], p_capability text DEFAULT 'existing_appointment')
RETURNS TABLE (tenant_id uuid, staff_id uuid, role text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  v_staff uuid := nullif(current_setting('app.staff_id', true), '')::uuid;
  v_role text;
BEGIN
  IF v_tenant IS NULL OR v_staff IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: missing tenant or staff context' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tenant_actor_lock();
  SELECT sr.role INTO v_role
    FROM public.staff s
    JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
    JOIN public.staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.id
   WHERE s.tenant_id = v_tenant
     AND s.id = v_staff
     AND m.effective_from <= clock_timestamp()
     AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
     AND sr.role = ANY (p_roles)
   ORDER BY array_position(p_roles, sr.role)
   LIMIT 1;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role not permitted for public site' USING ERRCODE = '42501';
  END IF;
  IF p_capability IS NOT NULL AND NOT public.tenant_capability(p_capability) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: tenant lifecycle blocks capability %', p_capability USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v_tenant, v_staff, v_role;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._site_actor(text[], text) FROM PUBLIC;--> statement-breakpoint

-- Private canonical review artifact digest (shared 1:1 with TS computeArtifactDigest in rules.ts).
CREATE FUNCTION public._site_web_review_artifact_sha(
  p_slug text,
  p_name text,
  p_purpose text,
  p_performed_by text,
  p_duration_min integer,
  p_downtime text,
  p_sessions integer,
  p_interval_days integer,
  p_contraindications text,
  p_hero_photo text,
  p_hero_alt text,
  p_caption text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT encode(
    sha256(
      convert_to(
        'review-artifact-v1' || E'\n' ||
        'slug=' || to_json(lower(btrim(coalesce(p_slug, ''))))::text || E'\n' ||
        'name=' || to_json(btrim(coalesce(p_name, '')))::text || E'\n' ||
        'purpose=' || to_json(btrim(coalesce(p_purpose, '')))::text || E'\n' ||
        'performedBy=' || to_json(btrim(coalesce(p_performed_by, '')))::text || E'\n' ||
        'durationMin=' || coalesce(to_json(p_duration_min)::text, 'null') || E'\n' ||
        'downtime=' || coalesce(to_json(NULLIF(btrim(coalesce(p_downtime, '')), ''))::text, 'null') || E'\n' ||
        'sessions=' || coalesce(to_json(p_sessions)::text, 'null') || E'\n' ||
        'intervalDays=' || coalesce(to_json(p_interval_days)::text, 'null') || E'\n' ||
        'contraindications=' || coalesce(to_json(NULLIF(btrim(coalesce(p_contraindications, '')), ''))::text, 'null') || E'\n' ||
        'heroPhoto=' || coalesce(to_json(NULLIF(btrim(coalesce(p_hero_photo, '')), ''))::text, 'null') || E'\n' ||
        'heroAlt=' || coalesce(to_json(NULLIF(btrim(coalesce(p_hero_alt, '')), ''))::text, 'null') || E'\n' ||
        'caption=' || coalesce(to_json(NULLIF(btrim(coalesce(p_caption, '')), ''))::text, 'null'),
        'UTF8'
      )
    ),
    'hex'
  );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._site_web_review_artifact_sha(text,text,text,text,integer,text,integer,integer,text,text,text,text) FROM PUBLIC;--> statement-breakpoint

-- Private helper: compute canonical facts payload + sha256 for p_tenant (used by both site_publish_facts and site_commit_publish).
CREATE FUNCTION public._site_build_facts(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_site public.public_sites%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_counsel_id uuid := public._public_site_counsel_approval(p_tenant);
  v_tariff_allowed boolean := false;
  v_branches jsonb;
  v_treatments jsonb;
  v_templates jsonb;
  v_primary_addr text;
  v_primary_wa text;
  v_core jsonb;
  v_sha text;
BEGIN
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant;
  SELECT * INTO v_site FROM public.public_sites WHERE tenant_id = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: site settings not configured' USING ERRCODE = 'P0002';
  END IF;

  -- Optional permissions are active ONLY when bound to the currently valid counsel approval!
  v_tariff_allowed := (v_counsel_id IS NOT NULL AND v_site.counsel_approval_id = v_counsel_id AND v_site.tariff_list_allowed);

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'slug', lower(b.code),
      'name', b.name,
      'city', coalesce(nullif(split_part(coalesce(b.address, ''), ',', 2), ''), b.name),
      'timezone', b.timezone,
      'address', b.address,
      'mapUrl', b.map_url,
      'whatsapp', b.whatsapp_number,
      'publishFrom', CASE WHEN b.publish_from IS NOT NULL THEN to_char(b.publish_from AT TIME ZONE b.timezone, 'YYYY-MM-DD') ELSE NULL END,
      'publishUntil', CASE WHEN b.publish_until IS NOT NULL THEN to_char(b.publish_until AT TIME ZONE b.timezone, 'YYYY-MM-DD') ELSE NULL END,
      'hours', coalesce((
        SELECT jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI')) ORDER BY h.weekday, h.opens)
          FROM public.branch_hours h
         WHERE h.tenant_id = b.tenant_id AND h.branch_id = b.id
      ), '[]'::jsonb)
    ) ORDER BY lower(b.code)
  ), '[]'::jsonb)
  INTO v_branches
  FROM public.branches b
  WHERE b.tenant_id = p_tenant
    AND b.publish_from IS NOT NULL
    AND b.publish_from <= v_now
    AND (b.publish_until IS NULL OR b.publish_until > v_now);

  SELECT b.address, b.whatsapp_number
    INTO v_primary_addr, v_primary_wa
    FROM public.branches b
   WHERE b.tenant_id = p_tenant
   ORDER BY b.created_at ASC
   LIMIT 1;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'slug', wf.public_slug,
      'name', cv.name,
      'category', cv.category,
      'purpose', wf.purpose,
      'performedBy', wf.performed_by,
      'durationMin', cv.treatment_min,
      'downtime', wf.downtime,
      'sessions', wf.sessions,
      'intervalDays', wf.interval_days,
      'contraindications', cv.contraindications,
      'priceNote', wf.price_note,
      'heroPhoto', wf.hero_photo,
      'heroAlt', wf.hero_alt,
      'caption', wf.caption,
      'clinicalReview', jsonb_build_object(
        'state', CASE
          WHEN wf.clinical_reviewed_version = cv.version
           AND wf.clinical_reviewed_artifact_sha IS NOT NULL
           AND wf.clinical_reviewed_artifact_sha = public._site_web_review_artifact_sha(
             wf.public_slug, cv.name, wf.purpose, wf.performed_by,
             cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
             cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
           )
          THEN 'approved' ELSE 'pending' END,
        'reviewedVersion', wf.clinical_reviewed_version,
        'currentVersion', cv.version,
        'reviewedArtifactHash', wf.clinical_reviewed_artifact_sha
      ),
      'publishPrice', wf.publish_price,
      'onlineBookable', cv.online_bookable,
      'published', wf.published,
      'branchSlugs', coalesce((
        SELECT jsonb_agg(lower(b.code) ORDER BY lower(b.code))
          FROM public.branch_services bs
          JOIN public.branches b ON b.tenant_id = bs.tenant_id AND b.id = bs.branch_id
         WHERE bs.tenant_id = p_tenant AND bs.item_id = ci.id
           AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
           AND (b.publish_until IS NULL OR b.publish_until > v_now)
      ), '[]'::jsonb),
      'branchPrices', coalesce((
        SELECT jsonb_object_agg(
          lower(b.code),
          coalesce((
            SELECT bp.price
              FROM public.branch_prices bp
             WHERE bp.tenant_id = p_tenant AND bp.branch_id = b.id AND bp.item_id = ci.id
               AND bp.state = 'active' AND bp.effective_from <= v_now
             ORDER BY bp.effective_from DESC, bp.created_at DESC
             LIMIT 1
          ), cv.normal_price)
        )
          FROM public.branch_services bs
          JOIN public.branches b ON b.tenant_id = bs.tenant_id AND b.id = bs.branch_id
         WHERE bs.tenant_id = p_tenant AND bs.item_id = ci.id
           AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
           AND (b.publish_until IS NULL OR b.publish_until > v_now)
      ), '{}'::jsonb)
    ) ORDER BY wf.public_slug
  ), '[]'::jsonb)
  INTO v_treatments
  FROM public.public_web_fields wf
  JOIN public.catalog_items ci ON ci.tenant_id = wf.tenant_id AND ci.id = wf.item_id AND ci.kind = 'service'
  JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
  WHERE wf.tenant_id = p_tenant AND wf.published = true;

  SELECT coalesce(jsonb_object_agg(t.kind, jsonb_build_object('version', t.version, 'body', t.body)), '{}'::jsonb)
    INTO v_templates
    FROM public.vendor_legal_templates t
   WHERE t.is_active = true;

  v_core := jsonb_build_object(
    'counselApproved', (v_counsel_id IS NOT NULL),
    'counselApprovalId', v_counsel_id,
    'tariffListAllowed', v_tariff_allowed,
    'brand', v_site.brand_name,
    'slug', v_site.slug,
    'accent', v_site.accent_hex,
    'heroPhoto', v_site.hero_photo,
    'oneLine', v_site.one_line,
    'sections', jsonb_build_object(
      'treatments', v_site.show_treatments,
      'branches', v_site.show_branches,
      'doctors', v_site.show_doctors
    ),
    'branches', v_branches,
    'treatments', v_treatments,
    'legalTemplates', v_templates,
    'templateVars', jsonb_build_object(
      'klinik.nama', v_site.brand_name,
      'klinik.alamat', coalesce(v_primary_addr, 'Alamat cabang resmi klinik'),
      'klinik.kontak', coalesce(v_primary_wa, 'Kontak resmi klinik'),
      'klinik.email', 'privasi@klinik.local',
      'vendor.nama', 'Platform Clinic Dashboard'
    )
  );
  v_sha := encode(sha256(convert_to(v_core::text, 'UTF8')), 'hex');

  RETURN v_core || jsonb_build_object(
    'factsSha256', v_sha,
    'nowIso', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._site_build_facts(uuid) FROM PUBLIC;--> statement-breakpoint

-- 1. Admin workspace view
CREATE FUNCTION public.site_admin_view() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_now timestamptz := clock_timestamp();
  v_site jsonb;
  v_legal_name text;
  v_counsel_id uuid;
  v_missing jsonb;
  v_branches jsonb;
  v_services jsonb;
  v_versions jsonb;
BEGIN
  SELECT * INTO a FROM public._site_actor(ARRAY['owner','admin_pusat','marketing','facility_head'], NULL);
  SELECT legal_name INTO v_legal_name FROM public.tenants WHERE id = a.tenant_id;
  v_counsel_id := public._public_site_counsel_approval(a.tenant_id);

  SELECT jsonb_build_object(
    'slug', s.slug,
    'state', s.state,
    'firstPublishedAt', s.first_published_at,
    'publishedVersion', s.published_version,
    'brandName', s.brand_name,
    'accentHex', s.accent_hex,
    'heroPhoto', s.hero_photo,
    'oneLine', s.one_line,
    'showTreatments', s.show_treatments,
    'showBranches', s.show_branches,
    'showDoctors', s.show_doctors,
    'tariffListAllowed', s.tariff_list_allowed,
    'doctorTitlesAllowed', s.doctor_titles_allowed,
    'counselApprovalId', s.counsel_approval_id,
    'metaPixelId', s.meta_pixel_id,
    'gaMeasurementId', s.ga_measurement_id
  ) INTO v_site
  FROM public.public_sites s WHERE s.tenant_id = a.tenant_id;

  SELECT coalesce(jsonb_agg(m.label ORDER BY m.obligation_key), '[]'::jsonb)
    INTO v_missing
    FROM public.feature_gate_missing('public_site_publish') m;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'code', b.code,
      'slug', lower(b.code),
      'name', b.name,
      'timezone', b.timezone,
      'inPublishWindow', (b.publish_from IS NOT NULL AND b.publish_from <= v_now AND (b.publish_until IS NULL OR b.publish_until > v_now)),
      'publishFrom', b.publish_from,
      'publishUntil', b.publish_until
    ) ORDER BY b.code
  ), '[]'::jsonb) INTO v_branches
  FROM public.branches b WHERE b.tenant_id = a.tenant_id;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'itemId', ci.id,
      'code', ci.code,
      'name', cv.name,
      'category', cv.category,
      'activeVersion', cv.version,
      'onlineBookable', cv.online_bookable,
      'contraindications', cv.contraindications,
      'durationMin', cv.treatment_min,
      'webField', CASE WHEN wf.id IS NULL THEN NULL ELSE jsonb_build_object(
        'publicSlug', wf.public_slug,
        'published', wf.published,
        'publishPrice', wf.publish_price,
        'purpose', wf.purpose,
        'performedBy', wf.performed_by,
        'downtime', wf.downtime,
        'sessions', wf.sessions,
        'intervalDays', wf.interval_days,
        'priceNote', wf.price_note,
        'heroPhoto', wf.hero_photo,
        'heroAlt', wf.hero_alt,
        'caption', wf.caption,
        'clinicalReviewedVersion', wf.clinical_reviewed_version,
        'clinicalReviewedArtifactSha', wf.clinical_reviewed_artifact_sha,
        'clinicalReviewedAt', wf.clinical_reviewed_at,
        'currentArtifactSha', public._site_web_review_artifact_sha(
          wf.public_slug, cv.name, wf.purpose, wf.performed_by,
          cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
          cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
        ),
        'clinicalReviewCurrent', (
          wf.clinical_reviewed_version = cv.version
          AND wf.clinical_reviewed_artifact_sha IS NOT NULL
          AND wf.clinical_reviewed_artifact_sha = public._site_web_review_artifact_sha(
            wf.public_slug, cv.name, wf.purpose, wf.performed_by,
            cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
            cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
          )
        )
      ) END
    ) ORDER BY ci.code
  ), '[]'::jsonb) INTO v_services
  FROM public.catalog_items ci
  JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
  LEFT JOIN public.public_web_fields wf ON wf.tenant_id = ci.tenant_id AND wf.item_id = ci.id
  WHERE ci.tenant_id = a.tenant_id AND ci.kind = 'service';

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'version', v.version,
      'slug', v.slug,
      'publishedAt', v.published_at,
      'tariffListAllowed', v.tariff_list_allowed
    ) ORDER BY v.version DESC
  ), '[]'::jsonb) INTO v_versions
  FROM (
    SELECT version, slug, published_at, tariff_list_allowed
      FROM public.public_site_versions
     WHERE tenant_id = a.tenant_id
     ORDER BY version DESC
     LIMIT 10
  ) v;

  RETURN jsonb_build_object(
    'site', v_site,
    'suggestedSlug', regexp_replace(lower(regexp_replace(coalesce(v_legal_name, 'klinik'), '^(pt|cv)\.?\s+', '', 'i')), '[^a-z0-9]+', '-', 'g'),
    'counselGateOpen', (v_counsel_id IS NOT NULL),
    'currentCounselApprovalId', v_counsel_id,
    'counselMissingLabels', v_missing,
    'branches', v_branches,
    'services', v_services,
    'recentVersions', v_versions
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.site_admin_view() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.site_admin_view() TO clinic_app;--> statement-breakpoint

-- 2. Save site settings (owner, admin_pusat, marketing).
CREATE FUNCTION public.site_save_settings(
  p_slug text,
  p_brand_name text,
  p_accent_hex text,
  p_hero_photo text,
  p_one_line text,
  p_show_treatments boolean,
  p_show_branches boolean,
  p_show_doctors boolean,
  p_tariff_list_allowed boolean,
  p_doctor_titles_allowed boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_counsel_id uuid;
  v_row public.public_sites%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public._site_actor(ARRAY['owner','admin_pusat','marketing'], NULL);
  PERFORM public.feature_gate_lock('public_site_publish');
  v_counsel_id := public._public_site_counsel_approval(a.tenant_id);

  IF (p_tariff_list_allowed OR p_doctor_titles_allowed) AND v_counsel_id IS NULL THEN
    RAISE EXCEPTION 'ERR_GATE_CLOSED: counsel approval required for optional permissions' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.public_sites (
    tenant_id, slug, brand_name, accent_hex, hero_photo, one_line,
    show_treatments, show_branches, show_doctors,
    tariff_list_allowed, doctor_titles_allowed, counsel_approval_id,
    updated_by, updated_at
  ) VALUES (
    a.tenant_id, v_slug, btrim(p_brand_name), p_accent_hex, p_hero_photo, NULLIF(btrim(coalesce(p_one_line, '')), ''),
    coalesce(p_show_treatments, true), coalesce(p_show_branches, true), coalesce(p_show_doctors, false),
    coalesce(p_tariff_list_allowed, false), coalesce(p_doctor_titles_allowed, false),
    CASE WHEN coalesce(p_tariff_list_allowed, false) OR coalesce(p_doctor_titles_allowed, false) THEN v_counsel_id ELSE NULL END,
    a.staff_id, clock_timestamp()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    slug = EXCLUDED.slug,
    brand_name = EXCLUDED.brand_name,
    accent_hex = EXCLUDED.accent_hex,
    hero_photo = EXCLUDED.hero_photo,
    one_line = EXCLUDED.one_line,
    show_treatments = EXCLUDED.show_treatments,
    show_branches = EXCLUDED.show_branches,
    show_doctors = EXCLUDED.show_doctors,
    tariff_list_allowed = EXCLUDED.tariff_list_allowed,
    doctor_titles_allowed = EXCLUDED.doctor_titles_allowed,
    counsel_approval_id = CASE
      WHEN EXCLUDED.tariff_list_allowed OR EXCLUDED.doctor_titles_allowed THEN v_counsel_id
      ELSE public.public_sites.counsel_approval_id
    END,
    updated_by = a.staff_id,
    updated_at = clock_timestamp()
  RETURNING * INTO v_row;

  PERFORM public.audit_append('settings_change', 'public_site', a.tenant_id, 'success', 'public_site_settings_saved');
  RETURN jsonb_build_object(
    'slug', v_row.slug, 'state', v_row.state, 'firstPublishedAt', v_row.first_published_at,
    'publishedVersion', v_row.published_version, 'brandName', v_row.brand_name,
    'accentHex', v_row.accent_hex, 'heroPhoto', v_row.hero_photo, 'oneLine', v_row.one_line,
    'showTreatments', v_row.show_treatments, 'showBranches', v_row.show_branches, 'showDoctors', v_row.show_doctors,
    'tariffListAllowed', v_row.tariff_list_allowed, 'doctorTitlesAllowed', v_row.doctor_titles_allowed,
    'counselApprovalId', v_row.counsel_approval_id, 'metaPixelId', v_row.meta_pixel_id, 'gaMeasurementId', v_row.ga_measurement_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_SLUG_TAKEN: slug already taken' USING ERRCODE = '23505';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.site_save_settings(text,text,text,text,text,boolean,boolean,boolean,boolean,boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.site_save_settings(text,text,text,text,text,boolean,boolean,boolean,boolean,boolean) TO clinic_app;--> statement-breakpoint

-- 3. Save per-service public web fields (invalidates clinical review on any text/media change).
CREATE FUNCTION public.site_save_web_field(
  p_item_id uuid,
  p_public_slug text,
  p_published boolean,
  p_publish_price boolean,
  p_purpose text,
  p_performed_by text,
  p_downtime text,
  p_sessions integer,
  p_interval_days integer,
  p_price_note text,
  p_hero_photo text,
  p_hero_alt text,
  p_caption text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_slug text := lower(btrim(coalesce(p_public_slug, '')));
BEGIN
  SELECT * INTO a FROM public._site_actor(ARRAY['owner','admin_pusat','marketing'], NULL);
  IF NOT EXISTS (SELECT 1 FROM public.catalog_items ci WHERE ci.tenant_id = a.tenant_id AND ci.id = p_item_id AND ci.kind = 'service') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: service item not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.public_web_fields (
    tenant_id, item_id, public_slug, published, publish_price,
    purpose, performed_by, downtime, sessions, interval_days,
    price_note, hero_photo, hero_alt, caption,
    updated_by, updated_at
  ) VALUES (
    a.tenant_id, p_item_id, v_slug, coalesce(p_published, false), coalesce(p_publish_price, false),
    btrim(p_purpose), btrim(p_performed_by), NULLIF(btrim(coalesce(p_downtime, '')), ''),
    p_sessions, p_interval_days, NULLIF(btrim(coalesce(p_price_note, '')), ''),
    NULLIF(btrim(coalesce(p_hero_photo, '')), ''), NULLIF(btrim(coalesce(p_hero_alt, '')), ''),
    NULLIF(btrim(coalesce(p_caption, '')), ''), a.staff_id, clock_timestamp()
  )
  ON CONFLICT (tenant_id, item_id) DO UPDATE SET
    public_slug = EXCLUDED.public_slug,
    published = EXCLUDED.published,
    publish_price = EXCLUDED.publish_price,
    purpose = EXCLUDED.purpose,
    performed_by = EXCLUDED.performed_by,
    downtime = EXCLUDED.downtime,
    sessions = EXCLUDED.sessions,
    interval_days = EXCLUDED.interval_days,
    price_note = EXCLUDED.price_note,
    hero_photo = EXCLUDED.hero_photo,
    hero_alt = EXCLUDED.hero_alt,
    caption = EXCLUDED.caption,
    -- Any edit to reviewed content/media clears clinical review until re-approved.
    clinical_reviewed_version = NULL,
    clinical_reviewed_artifact_sha = NULL,
    clinical_reviewed_by = NULL,
    clinical_reviewed_at = NULL,
    updated_by = a.staff_id,
    updated_at = clock_timestamp();

  PERFORM public.audit_append('settings_change', 'public_web_field', p_item_id, 'success', 'public_web_field_saved');
  RETURN jsonb_build_object('itemId', p_item_id, 'publicSlug', v_slug);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.site_save_web_field(uuid,text,boolean,boolean,text,text,text,integer,integer,text,text,text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.site_save_web_field(uuid,text,boolean,boolean,text,text,text,integer,integer,text,text,text,text) TO clinic_app;--> statement-breakpoint

-- 4. Clinical review source & approval (owner or facility_head).
CREATE FUNCTION public.site_web_review_source(p_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_res jsonb;
BEGIN
  SELECT * INTO a FROM public._site_actor(ARRAY['owner','facility_head'], NULL);
  SELECT jsonb_build_object(
    'slug', wf.public_slug,
    'name', cv.name,
    'purpose', wf.purpose,
    'performedBy', wf.performed_by,
    'durationMin', cv.treatment_min,
    'downtime', wf.downtime,
    'sessions', wf.sessions,
    'intervalDays', wf.interval_days,
    'contraindications', cv.contraindications,
    'heroPhoto', wf.hero_photo,
    'heroAlt', wf.hero_alt,
    'caption', wf.caption,
    'activeVersion', cv.version,
    'artifactSha256', public._site_web_review_artifact_sha(
      wf.public_slug, cv.name, wf.purpose, wf.performed_by,
      cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
      cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
    )
  ) INTO v_res
  FROM public.public_web_fields wf
  JOIN public.catalog_items ci ON ci.tenant_id = wf.tenant_id AND ci.id = wf.item_id AND ci.kind = 'service'
  JOIN public.catalog_versions cv ON cv.tenant_id = wf.tenant_id AND cv.item_id = wf.item_id AND cv.state = 'active'
  WHERE wf.tenant_id = a.tenant_id AND wf.item_id = p_item_id;
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: web field or active service version not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_res;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.site_web_review_source(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.site_web_review_source(uuid) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.site_approve_web_review(p_item_id uuid, p_version integer, p_artifact_sha text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_wf public.public_web_fields%ROWTYPE;
  v_cv public.catalog_versions%ROWTYPE;
  v_current_sha text;
BEGIN
  SELECT * INTO a FROM public._site_actor(ARRAY['owner','facility_head'], NULL);
  IF p_artifact_sha IS NULL OR p_artifact_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invalid artifact sha256' USING ERRCODE = '22023';
  END IF;

  -- Lock authoritative source rows in deterministic order (public_web_fields -> catalog_versions)
  -- before checking version and canonical review artifact digest.
  SELECT wf.* INTO v_wf
    FROM public.public_web_fields wf
   WHERE wf.tenant_id = a.tenant_id AND wf.item_id = p_item_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: web field not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT cv.* INTO v_cv
    FROM public.catalog_versions cv
    JOIN public.catalog_items ci ON ci.tenant_id = cv.tenant_id AND ci.id = cv.item_id AND ci.kind = 'service'
   WHERE cv.tenant_id = a.tenant_id AND cv.item_id = p_item_id AND cv.state = 'active'
     FOR SHARE OF cv;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: active service version not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_cv.version <> p_version THEN
    RAISE EXCEPTION 'ERR_CONFLICT: active catalog version changed' USING ERRCODE = '55000';
  END IF;

  v_current_sha := public._site_web_review_artifact_sha(
    v_wf.public_slug, v_cv.name, v_wf.purpose, v_wf.performed_by,
    v_cv.treatment_min, v_wf.downtime, v_wf.sessions, v_wf.interval_days,
    v_cv.contraindications, v_wf.hero_photo, v_wf.hero_alt, v_wf.caption
  );
  IF p_artifact_sha IS DISTINCT FROM v_current_sha THEN
    RAISE EXCEPTION 'ERR_CONFLICT: reviewed content changed before approval' USING ERRCODE = '55000';
  END IF;

  UPDATE public.public_web_fields
     SET clinical_reviewed_version = v_cv.version,
         clinical_reviewed_artifact_sha = v_current_sha,
         clinical_reviewed_by = a.staff_id,
         clinical_reviewed_at = clock_timestamp()
   WHERE tenant_id = a.tenant_id AND item_id = p_item_id;

  PERFORM public.audit_append('settings_change', 'public_web_field', p_item_id, 'success', 'public_web_clinical_reviewed');
  RETURN jsonb_build_object('version', v_cv.version, 'artifactSha256', v_current_sha);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.site_approve_web_review(uuid,integer,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.site_approve_web_review(uuid,integer,text) TO clinic_app;--> statement-breakpoint

-- 5. Locked facts reader for publish pipeline (Finding #1 & #2 lock order).
CREATE FUNCTION public.site_publish_facts() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public._site_actor(ARRAY['owner','admin_pusat','marketing'], 'public_site');
  PERFORM public.feature_gate_lock('public_site_publish');
  PERFORM 1 FROM public.public_sites s WHERE s.tenant_id = a.tenant_id FOR UPDATE;
  PERFORM 1 FROM public.public_web_fields wf WHERE wf.tenant_id = a.tenant_id ORDER BY wf.item_id FOR SHARE;
  PERFORM 1 FROM public.catalog_versions cv WHERE cv.tenant_id = a.tenant_id AND cv.state = 'active' ORDER BY cv.item_id FOR SHARE;
  RETURN public._site_build_facts(a.tenant_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.site_publish_facts() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.site_publish_facts() TO clinic_app;--> statement-breakpoint

-- 6. Fenced publish writer with strict nested fail-closed validation AND authoritative SQL canonical snapshot construction
-- (Findings #1, #2, #4 + Panel 1 preflight: never persist caller-supplied raw JSON; reject NULL branch slugs & unknown nested keys).
CREATE FUNCTION public._site_format_id_int(p_val bigint) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT replace(trim(to_char(p_val, 'FM999,999,999,999,999')), ',', '.');
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._site_format_id_int(bigint) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public._site_canonical_legal_pages(p_vars jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_kind text;
  v_ver integer;
  v_tpl text;
  v_sha text;
  v_rendered text;
  v_out jsonb := '{}'::jsonb;
  v_defaults jsonb := jsonb_build_object(
    'kebijakan-privasi',
    E'Kebijakan Privasi {{klinik.nama}}\n\n{{klinik.nama}} (alamat: {{klinik.alamat}}, kontak: {{klinik.kontak}}, email: {{klinik.email}}) mengelola data pribadi dan rekam medis pasien sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi dan Permenkes No. 24 Tahun 2022. Sistem dikelola secara teknis oleh {{vendor.nama}} sebagai pemroses data.\n\nPasien berhak mengajukan permintaan akses, perbaikan, penarikan persetujuan, atau pembatasan pemrosesan melalui kontak resmi klinik.',
    'syarat-ketentuan',
    E'Syarat dan Ketentuan {{klinik.nama}}\n\nLayanan informasi daring pada situs resmi {{klinik.nama}} bersifat edukatif dan informatif sesuai Permenkes 1787/2010, bukan pengganti konsultasi medis langsung. Seluruh jadwal kunjungan dan tindakan tunduk pada evaluasi dokter di {{klinik.alamat}} (kontak: {{klinik.kontak}}).',
    'kebijakan-pembatalan',
    E'Kebijakan Pembatalan dan Perubahan Jadwal {{klinik.nama}}\n\nPerubahan jadwal atau pembatalan kunjungan dapat dilakukan melalui kontak resmi {{klinik.nama}} di {{klinik.kontak}} atau {{klinik.email}}. Ketentuan pengembalian uang muka mengikuti kebijakan klinik yang berlaku saat reservasi.'
  );
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['kebijakan-privasi','syarat-ketentuan','kebijakan-pembatalan'] LOOP
    SELECT t.version, t.body INTO v_ver, v_tpl
      FROM public.vendor_legal_templates t
     WHERE t.kind = v_kind AND t.is_active = true
     LIMIT 1;
    IF NOT FOUND THEN
      v_ver := 1;
      v_tpl := v_defaults->>v_kind;
    END IF;
    IF v_tpl IS NULL OR length(btrim(v_tpl)) < 20 OR v_tpl ~ '[<>]' THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: invalid legal template for %', v_kind USING ERRCODE = '22023';
    END IF;
    v_sha := encode(sha256(convert_to(v_tpl, 'UTF8')), 'hex');
    v_rendered := replace(
      replace(
        replace(
          replace(
            replace(v_tpl, '{{klinik.nama}}', coalesce(p_vars->>'klinik.nama', '')),
            '{{klinik.alamat}}', coalesce(p_vars->>'klinik.alamat', '')
          ),
          '{{klinik.kontak}}', coalesce(p_vars->>'klinik.kontak', '')
        ),
        '{{klinik.email}}', coalesce(p_vars->>'klinik.email', '')
      ),
      '{{vendor.nama}}', coalesce(p_vars->>'vendor.nama', '')
    );
    v_out := v_out || jsonb_build_object(
      v_kind,
      jsonb_build_object(
        'kind', v_kind,
        'version', v_ver,
        'templateSha256', v_sha,
        'body', v_rendered
      )
    );
  END LOOP;
  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public._site_canonical_legal_pages(jsonb) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.site_commit_publish(p_snapshot jsonb, p_expected_facts_sha text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_site public.public_sites%ROWTYPE;
  v_counsel_id uuid;
  v_facts jsonb;
  v_tariff_allowed boolean;
  v_now timestamptz := clock_timestamp();
  v_next_ver integer;
  v_snap_sha text;
  v_branch jsonb;
  v_hr jsonb;
  v_t jsonb;
  v_bt jsonb;
  v_bs text;
  v_lk text;
  v_lp jsonb;
  v_wf record;
  v_expected_price bigint;
  v_allowed_branches text[];
  v_canonical_branches jsonb;
  v_canonical_treatments jsonb;
  v_canonical_legal jsonb;
  v_canonical_sections jsonb;
  v_stored_snapshot jsonb;
  v_consult_tariff jsonb := jsonb_build_object('kind', 'consultation', 'text', 'Harga dijelaskan saat konsultasi');
  v_expected_branch jsonb;
  v_expected_treatment jsonb;
  v_current_review_sha text;
BEGIN
  SELECT * INTO a FROM public._site_actor(ARRAY['owner','admin_pusat','marketing'], 'public_site');
  PERFORM public.feature_gate_lock('public_site_publish');
  SELECT * INTO v_site FROM public.public_sites s WHERE s.tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: site settings missing' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.public_web_fields wf WHERE wf.tenant_id = a.tenant_id ORDER BY wf.item_id FOR SHARE;
  PERFORM 1 FROM public.catalog_versions cv WHERE cv.tenant_id = a.tenant_id AND cv.state = 'active' ORDER BY cv.item_id FOR SHARE;

  v_counsel_id := public._public_site_counsel_approval(a.tenant_id);
  IF v_counsel_id IS NULL THEN
    RAISE EXCEPTION 'ERR_GATE_CLOSED: public_site_counsel unapproved or expired' USING ERRCODE = '55000';
  END IF;

  v_facts := public._site_build_facts(a.tenant_id);
  IF p_expected_facts_sha IS DISTINCT FROM (v_facts->>'factsSha256') THEN
    RAISE EXCEPTION 'ERR_CONFLICT: master facts changed between projection and publish' USING ERRCODE = '55000';
  END IF;

  -- Build authoritative canonical projections strictly from locked approved DB sources.
  v_tariff_allowed := (v_site.counsel_approval_id = v_counsel_id AND v_site.tariff_list_allowed);
  v_canonical_sections := jsonb_build_object(
    'treatments', v_site.show_treatments,
    'branches', v_site.show_branches,
    'doctors', v_site.show_doctors
  );

  SELECT coalesce(array_agg(lower(b.code) ORDER BY lower(b.code)), ARRAY[]::text[]),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'slug', lower(b.code),
             'name', btrim(b.name),
             'city', btrim(coalesce(nullif(split_part(coalesce(b.address, ''), ',', 2), ''), b.name)),
             'timezone', coalesce(nullif(b.timezone, ''), 'Asia/Jakarta'),
             'address', NULLIF(btrim(coalesce(b.address, '')), ''),
             'mapUrl', CASE
               WHEN b.map_url IS NOT NULL AND length(btrim(b.map_url)) <= 450 AND btrim(b.map_url) ~ '^https://(maps\.google\.com|www\.google\.com/maps|maps\.app\.goo\.gl)/[^\s"''<>]+$'
               THEN btrim(b.map_url) ELSE NULL END,
             'whatsapp', CASE
               WHEN b.whatsapp_number IS NOT NULL AND regexp_replace(b.whatsapp_number, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{7,14}$'
               THEN regexp_replace(b.whatsapp_number, '[^0-9]', '', 'g') ELSE NULL END,
             'hours', coalesce((
               SELECT jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI')) ORDER BY h.weekday, h.opens)
                 FROM public.branch_hours h
                WHERE h.tenant_id = b.tenant_id AND h.branch_id = b.id
             ), '[]'::jsonb),
             'closures', '[]'::jsonb
           ) ORDER BY lower(b.code)
         ), '[]'::jsonb)
    INTO v_allowed_branches, v_canonical_branches
    FROM public.branches b
   WHERE b.tenant_id = a.tenant_id
     AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
     AND (b.publish_until IS NULL OR b.publish_until > v_now);

  IF coalesce(array_length(v_allowed_branches, 1), 0) = 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: at least one active branch required' USING ERRCODE = '22023';
  END IF;

  v_canonical_legal := public._site_canonical_legal_pages(v_facts->'templateVars');

  -- 1. Strict fail-closed validation of caller-supplied p_snapshot (top-level + every nested object).
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: snapshot must be object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_snapshot) k
     WHERE k <> ALL (ARRAY['brand','slug','accent','heroPhoto','oneLine','sections','branches','treatments','doctors','legalPages','builtAt'])
  ) THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unallowlisted top-level snapshot key' USING ERRCODE = '22023';
  END IF;
  IF position(a.tenant_id::text in p_snapshot::text) > 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: raw tenant_id forbidden in public snapshot' USING ERRCODE = '22023';
  END IF;
  IF (p_snapshot->>'slug') IS DISTINCT FROM v_site.slug
     OR (p_snapshot->>'brand') IS DISTINCT FROM btrim(v_site.brand_name)
     OR (p_snapshot->>'accent') IS DISTINCT FROM (CASE WHEN v_site.accent_hex ~* '^#[0-9a-f]{6}$' THEN v_site.accent_hex ELSE NULL END)
     OR (p_snapshot->>'oneLine') IS DISTINCT FROM NULLIF(btrim(coalesce(v_site.one_line, '')), '') THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: top-level site fields mismatch locked source' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_snapshot->'sections') <> 'object'
     OR (p_snapshot->'sections') IS DISTINCT FROM v_canonical_sections THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: sections mismatch locked source' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_snapshot->'doctors') <> 'array' OR jsonb_array_length(p_snapshot->'doctors') <> 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: doctors must be empty array until T-125' USING ERRCODE = '22023';
  END IF;
  IF (p_snapshot->>'heroPhoto') IS DISTINCT FROM (CASE
       WHEN v_site.hero_photo IS NOT NULL AND btrim(v_site.hero_photo) ~ '^/media/public/[a-z0-9-]+/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$'
       THEN btrim(v_site.hero_photo) ELSE NULL END) THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: heroPhoto mismatch or invalid ref' USING ERRCODE = '22023';
  END IF;

  -- 2. Strict nested branch validation (reject NULL/missing slugs, unknown keys, closures, or tampered values).
  IF jsonb_typeof(p_snapshot->'branches') <> 'array' OR jsonb_array_length(p_snapshot->'branches') = 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: branches must be non-empty array' USING ERRCODE = '22023';
  END IF;
  FOR v_branch IN SELECT * FROM jsonb_array_elements(p_snapshot->'branches') LOOP
    IF jsonb_typeof(v_branch) <> 'object' THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: branch item must be object' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_branch) bk
       WHERE bk <> ALL (ARRAY['slug','name','city','timezone','address','mapUrl','whatsapp','hours','closures'])
    ) THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unallowlisted nested branch key' USING ERRCODE = '22023';
    END IF;
    IF (v_branch->>'slug') IS NULL OR btrim(v_branch->>'slug') = '' OR NOT ((v_branch->>'slug') = ANY (v_allowed_branches)) THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: missing or unauthorized branch slug %', coalesce(v_branch->>'slug', '<NULL>') USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_branch->'closures') <> 'array' OR jsonb_array_length(v_branch->'closures') <> 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: stored branch closures must be empty' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_branch->'hours') <> 'array' THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: branch hours must be array' USING ERRCODE = '22023';
    END IF;
    FOR v_hr IN SELECT * FROM jsonb_array_elements(v_branch->'hours') LOOP
      IF jsonb_typeof(v_hr) <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_hr) hk WHERE hk <> ALL (ARRAY['weekday','opens','closes'])
      ) THEN
        RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unallowlisted branch hour key' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    SELECT cb INTO v_expected_branch
      FROM jsonb_array_elements(v_canonical_branches) cb
     WHERE cb->>'slug' = v_branch->>'slug'
     LIMIT 1;
    IF v_expected_branch IS NULL OR v_branch IS DISTINCT FROM v_expected_branch THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: branch payload mismatch locked master for %', v_branch->>'slug' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_array_length(p_snapshot->'branches') <> jsonb_array_length(v_canonical_branches) THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: branch set mismatch locked active branches' USING ERRCODE = '22023';
  END IF;

  -- 3. Strict nested legalPages validation (exact 3 keys, strict nested keys, exact canonical rendered body & sha256).
  IF jsonb_typeof(p_snapshot->'legalPages') <> 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: legalPages must be object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_snapshot->'legalPages') lk
     WHERE lk <> ALL (ARRAY['kebijakan-privasi','syarat-ketentuan','kebijakan-pembatalan'])
  ) THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unallowlisted legalPages key' USING ERRCODE = '22023';
  END IF;
  FOREACH v_lk IN ARRAY ARRAY['kebijakan-privasi','syarat-ketentuan','kebijakan-pembatalan'] LOOP
    v_lp := (p_snapshot->'legalPages')->v_lk;
    IF v_lp IS NULL OR jsonb_typeof(v_lp) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_lp) lpk WHERE lpk <> ALL (ARRAY['kind','version','templateSha256','body'])
    ) THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: invalid legalPage shape for %', v_lk USING ERRCODE = '22023';
    END IF;
    IF v_lp IS DISTINCT FROM (v_canonical_legal->v_lk) THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: legalPage mismatch locked template for %', v_lk USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 4. Build authoritative canonical treatments from locked reviewed sources & validate caller treatments fail-closed.
  IF v_site.show_treatments THEN
    SELECT coalesce(jsonb_agg(t_row.obj ORDER BY t_row.slug), '[]'::jsonb)
      INTO v_canonical_treatments
      FROM (
        SELECT
          wf.public_slug AS slug,
          jsonb_build_object(
            'slug', wf.public_slug,
            'name', btrim(cv.name),
            'category', NULLIF(btrim(coalesce(cv.category, '')), ''),
            'purpose', btrim(wf.purpose),
            'performedBy', btrim(wf.performed_by),
            'duration', CASE WHEN cv.treatment_min IS NOT NULL AND cv.treatment_min > 0
              THEN public._site_format_id_int(cv.treatment_min::bigint) || ' menit' ELSE NULL END,
            'downtime', NULLIF(btrim(coalesce(wf.downtime, '')), ''),
            'sessions', CASE WHEN wf.sessions IS NOT NULL AND wf.sessions > 0 THEN
              public._site_format_id_int(wf.sessions::bigint) || ' sesi' ||
              CASE WHEN wf.interval_days IS NOT NULL AND wf.interval_days > 0
                THEN ', jarak ' || public._site_format_id_int(wf.interval_days::bigint) || ' hari' ELSE '' END
              ELSE NULL END,
            'contraindications', NULLIF(btrim(coalesce(cv.contraindications, '')), ''),
            'heroPhoto', CASE
              WHEN wf.hero_photo IS NOT NULL AND btrim(wf.hero_photo) ~ '^/media/public/[a-z0-9-]+/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$'
              THEN btrim(wf.hero_photo) ELSE NULL END,
            'heroAlt', NULLIF(btrim(coalesce(wf.hero_alt, '')), ''),
            'caption', NULLIF(btrim(coalesce(wf.caption, '')), ''),
            'tariff', CASE
              WHEN v_tariff_allowed AND wf.publish_price AND br.first_price IS NOT NULL AND br.first_price > 0 THEN
                jsonb_build_object(
                  'kind', 'amount',
                  'amount', br.first_price,
                  'text', 'Rp' || public._site_format_id_int(br.first_price),
                  'note', NULLIF(btrim(coalesce(wf.price_note, '')), '')
                )
              ELSE v_consult_tariff
            END,
            'bookable', cv.online_bookable,
            'branchSlugs', br.slugs,
            'branchTariffs', br.tariffs
          ) AS obj
        FROM public.public_web_fields wf
        JOIN public.catalog_items ci ON ci.tenant_id = wf.tenant_id AND ci.id = wf.item_id AND ci.kind = 'service'
        JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
        JOIN LATERAL (
          SELECT
            jsonb_agg(sub.bslug ORDER BY sub.bslug) AS slugs,
            (array_agg(sub.eff_price ORDER BY sub.bslug) FILTER (WHERE sub.eff_price IS NOT NULL))[1] AS first_price,
            jsonb_agg(
              jsonb_build_object(
                'branchSlug', sub.bslug,
                'tariff', CASE
                  WHEN v_tariff_allowed AND wf.publish_price AND sub.eff_price IS NOT NULL AND sub.eff_price > 0 THEN
                    jsonb_build_object(
                      'kind', 'amount',
                      'amount', sub.eff_price,
                      'text', 'Rp' || public._site_format_id_int(sub.eff_price),
                      'note', NULLIF(btrim(coalesce(wf.price_note, '')), '')
                    )
                  ELSE v_consult_tariff
                END
              ) ORDER BY sub.bslug
            ) AS tariffs
          FROM (
            SELECT
              lower(b.code) AS bslug,
              coalesce((
                SELECT bp.price
                  FROM public.branch_prices bp
                 WHERE bp.tenant_id = a.tenant_id AND bp.branch_id = b.id AND bp.item_id = ci.id
                   AND bp.state = 'active' AND bp.effective_from <= v_now
                 ORDER BY bp.effective_from DESC, bp.created_at DESC
                 LIMIT 1
              ), cv.normal_price) AS eff_price
            FROM public.branch_services bs
            JOIN public.branches b ON b.tenant_id = bs.tenant_id AND b.id = bs.branch_id
            WHERE bs.tenant_id = a.tenant_id AND bs.item_id = ci.id
              AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
              AND (b.publish_until IS NULL OR b.publish_until > v_now)
          ) sub
        ) br ON br.slugs IS NOT NULL
        WHERE wf.tenant_id = a.tenant_id
          AND wf.published = true
          AND wf.clinical_reviewed_version = cv.version
          AND wf.clinical_reviewed_artifact_sha IS NOT NULL
          AND wf.clinical_reviewed_artifact_sha = public._site_web_review_artifact_sha(
            wf.public_slug, cv.name, wf.purpose, wf.performed_by,
            cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
            cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
          )
      ) t_row;
  ELSE
    v_canonical_treatments := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_snapshot->'treatments') <> 'array' THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: treatments must be array' USING ERRCODE = '22023';
  END IF;
  IF NOT v_site.show_treatments AND jsonb_array_length(p_snapshot->'treatments') <> 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: treatments must be empty when section hidden' USING ERRCODE = '22023';
  END IF;

  FOR v_t IN SELECT * FROM jsonb_array_elements(p_snapshot->'treatments') LOOP
    IF jsonb_typeof(v_t) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_t) tk
       WHERE tk <> ALL (ARRAY['slug','name','category','purpose','performedBy','duration','downtime','sessions','contraindications','heroPhoto','heroAlt','caption','tariff','bookable','branchSlugs','branchTariffs'])
    ) THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unallowlisted treatment field for %', coalesce(v_t->>'slug', '<NULL>') USING ERRCODE = '22023';
    END IF;
    IF (v_t->>'slug') IS NULL OR btrim(v_t->>'slug') = '' THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: missing treatment slug' USING ERRCODE = '22023';
    END IF;

    SELECT wf.item_id, wf.public_slug, wf.publish_price, wf.purpose, wf.performed_by,
           wf.downtime, wf.sessions, wf.interval_days, wf.hero_photo, wf.hero_alt, wf.caption,
           wf.clinical_reviewed_version, wf.clinical_reviewed_artifact_sha,
           cv.version AS active_version, cv.name AS active_name, cv.treatment_min,
           cv.contraindications, cv.normal_price
      INTO v_wf
      FROM public.public_web_fields wf
      JOIN public.catalog_items ci ON ci.tenant_id = wf.tenant_id AND ci.id = wf.item_id AND ci.kind = 'service'
      JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
     WHERE wf.tenant_id = a.tenant_id AND wf.public_slug = (v_t->>'slug') AND wf.published = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unpublished or unknown treatment %', v_t->>'slug' USING ERRCODE = '22023';
    END IF;
    v_current_review_sha := public._site_web_review_artifact_sha(
      v_wf.public_slug, v_wf.active_name, v_wf.purpose, v_wf.performed_by,
      v_wf.treatment_min, v_wf.downtime, v_wf.sessions, v_wf.interval_days,
      v_wf.contraindications, v_wf.hero_photo, v_wf.hero_alt, v_wf.caption
    );
    IF v_wf.clinical_reviewed_version IS DISTINCT FROM v_wf.active_version
       OR v_wf.clinical_reviewed_artifact_sha IS NULL
       OR v_wf.clinical_reviewed_artifact_sha IS DISTINCT FROM v_current_review_sha THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unreviewed treatment %', v_t->>'slug' USING ERRCODE = '22023';
    END IF;

    -- Validate nested tariff object shape strictly
    IF jsonb_typeof(v_t->'tariff') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_t->'tariff') tfk WHERE tfk <> ALL (ARRAY['kind','amount','text','note'])
    ) THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: invalid tariff object for %', v_t->>'slug' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_tariff_allowed AND v_wf.publish_price) AND (v_t->'tariff') IS DISTINCT FROM v_consult_tariff THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: hidden tariff leaked for %', v_t->>'slug' USING ERRCODE = '22023';
    END IF;

    -- Validate nested branchSlugs & branchTariffs fail-closed (no NULL slugs, no unknown nested keys)
    IF jsonb_typeof(v_t->'branchSlugs') <> 'array' OR jsonb_array_length(v_t->'branchSlugs') = 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: invalid branchSlugs for %', v_t->>'slug' USING ERRCODE = '22023';
    END IF;
    FOR v_bs IN SELECT jsonb_array_elements_text(v_t->'branchSlugs') LOOP
      IF v_bs IS NULL OR NOT (v_bs = ANY (v_allowed_branches)) THEN
        RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unauthorized treatment branchSlug %', coalesce(v_bs, '<NULL>') USING ERRCODE = '22023';
      END IF;
    END LOOP;

    IF jsonb_typeof(v_t->'branchTariffs') <> 'array' THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: branchTariffs must be array for %', v_t->>'slug' USING ERRCODE = '22023';
    END IF;
    FOR v_bt IN SELECT * FROM jsonb_array_elements(v_t->'branchTariffs') LOOP
      IF jsonb_typeof(v_bt) <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_bt) btk WHERE btk <> ALL (ARRAY['branchSlug','tariff'])
      ) THEN
        RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unallowlisted branchTariff key for %', v_t->>'slug' USING ERRCODE = '22023';
      END IF;
      IF (v_bt->>'branchSlug') IS NULL OR NOT ((v_bt->>'branchSlug') = ANY (v_allowed_branches)) THEN
        RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: missing or unauthorized branchTariff branch %', coalesce(v_bt->>'branchSlug', '<NULL>') USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_bt->'tariff') <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_bt->'tariff') btfk WHERE btfk <> ALL (ARRAY['kind','amount','text','note'])
      ) THEN
        RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: invalid nested branchTariff tariff for %', v_t->>'slug' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_tariff_allowed AND v_wf.publish_price) THEN
        IF (v_bt->'tariff') IS DISTINCT FROM v_consult_tariff THEN
          RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: hidden branch tariff leaked' USING ERRCODE = '22023';
        END IF;
      ELSIF (v_bt->'tariff'->>'kind') = 'amount' THEN
        SELECT coalesce((
          SELECT bp.price
            FROM public.branch_prices bp
            JOIN public.branches b ON b.tenant_id = bp.tenant_id AND b.id = bp.branch_id
           WHERE bp.tenant_id = a.tenant_id AND lower(b.code) = (v_bt->>'branchSlug')
             AND bp.item_id = v_wf.item_id AND bp.state = 'active' AND bp.effective_from <= v_now
           ORDER BY bp.effective_from DESC, bp.created_at DESC
           LIMIT 1
        ), v_wf.normal_price) INTO v_expected_price;
        IF ((v_bt->'tariff'->>'amount')::bigint) IS DISTINCT FROM v_expected_price THEN
          RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: price mismatch for %', v_t->>'slug' USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;

    -- Exact equality against authoritative SQL canonical treatment projection
    SELECT ct INTO v_expected_treatment
      FROM jsonb_array_elements(v_canonical_treatments) ct
     WHERE ct->>'slug' = v_t->>'slug'
     LIMIT 1;
    IF v_expected_treatment IS NULL OR v_t IS DISTINCT FROM v_expected_treatment THEN
      RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: treatment payload mismatch locked reviewed source for %', v_t->>'slug' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_array_length(p_snapshot->'treatments') <> jsonb_array_length(v_canonical_treatments) THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: treatment set mismatch locked reviewed treatments' USING ERRCODE = '22023';
  END IF;

  -- Fail closed even if caller omitted a published live-branch treatment whose clinical review is missing or stale.
  IF v_site.show_treatments AND EXISTS (
    SELECT 1
      FROM public.public_web_fields wf
      JOIN public.catalog_items ci ON ci.tenant_id = wf.tenant_id AND ci.id = wf.item_id AND ci.kind = 'service'
      JOIN public.catalog_versions cv ON cv.tenant_id = ci.tenant_id AND cv.item_id = ci.id AND cv.state = 'active'
     WHERE wf.tenant_id = a.tenant_id
       AND wf.published = true
       AND EXISTS (
         SELECT 1
           FROM public.branch_services bs
           JOIN public.branches b ON b.tenant_id = bs.tenant_id AND b.id = bs.branch_id
          WHERE bs.tenant_id = a.tenant_id AND bs.item_id = ci.id
            AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
            AND (b.publish_until IS NULL OR b.publish_until > v_now)
       )
       AND (
         wf.clinical_reviewed_version IS DISTINCT FROM cv.version
         OR wf.clinical_reviewed_artifact_sha IS NULL
         OR wf.clinical_reviewed_artifact_sha IS DISTINCT FROM public._site_web_review_artifact_sha(
           wf.public_slug, cv.name, wf.purpose, wf.performed_by,
           cv.treatment_min, wf.downtime, wf.sessions, wf.interval_days,
           cv.contraindications, wf.hero_photo, wf.hero_alt, wf.caption
         )
       )
  ) THEN
    RAISE EXCEPTION 'ERR_INVALID_SNAPSHOT: unreviewed or stale clinical review on published treatment' USING ERRCODE = '22023';
  END IF;

  -- Construct stored snapshot strictly from authoritative locked SQL facts (never raw caller JSON!).
  v_stored_snapshot := jsonb_build_object(
    'brand', btrim(v_site.brand_name),
    'slug', v_site.slug,
    'accent', CASE WHEN v_site.accent_hex ~* '^#[0-9a-f]{6}$' THEN v_site.accent_hex ELSE NULL END,
    'heroPhoto', CASE
      WHEN v_site.hero_photo IS NOT NULL AND btrim(v_site.hero_photo) ~ '^/media/public/[a-z0-9-]+/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$'
      THEN btrim(v_site.hero_photo) ELSE NULL END,
    'oneLine', NULLIF(btrim(coalesce(v_site.one_line, '')), ''),
    'sections', v_canonical_sections,
    'branches', v_canonical_branches,
    'treatments', v_canonical_treatments,
    'doctors', '[]'::jsonb,
    'legalPages', v_canonical_legal,
    'builtAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  SELECT coalesce(max(version), 0) + 1 INTO v_next_ver
    FROM public.public_site_versions
   WHERE tenant_id = a.tenant_id;

  v_snap_sha := encode(sha256(convert_to(v_stored_snapshot::text, 'UTF8')), 'hex');

  INSERT INTO public.public_site_versions (
    tenant_id, site_id, version, slug, counsel_approval_id,
    tariff_list_allowed, doctor_titles_allowed,
    snapshot, snapshot_sha256, published_by, published_as, published_at
  ) VALUES (
    a.tenant_id, v_site.id, v_next_ver, v_site.slug, v_counsel_id,
    v_tariff_allowed, (v_site.counsel_approval_id = v_counsel_id AND v_site.doctor_titles_allowed),
    v_stored_snapshot, v_snap_sha, a.staff_id, a.role, v_now
  );

  UPDATE public.public_sites
     SET state = 'published',
         first_published_at = coalesce(first_published_at, v_now),
         published_version = v_next_ver,
         counsel_approval_id = v_counsel_id,
         tariff_list_allowed = v_tariff_allowed,
         doctor_titles_allowed = (v_site.counsel_approval_id = v_counsel_id AND v_site.doctor_titles_allowed),
         updated_by = a.staff_id,
         updated_at = v_now
   WHERE tenant_id = a.tenant_id;

  PERFORM public.audit_append('settings_change', 'public_site', a.tenant_id, 'success', 'public_site_published');
  RETURN jsonb_build_object('version', v_next_ver, 'slug', v_site.slug);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.site_commit_publish(jsonb,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.site_commit_publish(jsonb,text) TO clinic_app;--> statement-breakpoint

-- 7. Unpublish site (preserves first_published_at so slug stays permanently immutable per Finding #6!).
CREATE FUNCTION public.site_unpublish() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_slug text;
BEGIN
  SELECT * INTO a FROM public._site_actor(ARRAY['owner','admin_pusat','marketing'], NULL);
  UPDATE public.public_sites
     SET state = 'unpublished',
         published_version = NULL,
         updated_by = a.staff_id,
         updated_at = clock_timestamp()
   WHERE tenant_id = a.tenant_id
  RETURNING slug INTO v_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: site not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('settings_change', 'public_site', a.tenant_id, 'success', 'public_site_unpublished');
  RETURN jsonb_build_object('state', 'unpublished', 'slug', v_slug);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.site_unpublish() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.site_unpublish() TO clinic_app;--> statement-breakpoint

-- 8. Unbound serve-time public lookup for BOOKING_HOST (Findings #2, #4, #5, #8).
-- Never calls tenant-bound feature_gate_open; returns exact neutral {"state":"not_found"} whenever
-- slug is unknown, site is unpublished, tenant is not live, counsel approval is revoked/expired/replaced,
-- or zero branches remain in their live publish windows.
CREATE FUNCTION public.public_site_by_slug(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_row record;
  v_current_counsel uuid;
  v_live_branches jsonb;
  v_live_closures jsonb;
BEGIN
  IF v_slug = '' OR v_slug = ANY (public.public_site_reserved_slugs()) THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT s.tenant_id, s.slug, s.published_version, s.meta_pixel_id, s.ga_measurement_id,
         v.counsel_approval_id, v.snapshot
    INTO v_row
    FROM public.public_sites s
    JOIN public.tenants_registry tr ON tr.id = s.tenant_id
    JOIN public.public_site_versions v ON v.tenant_id = s.tenant_id AND v.version = s.published_version
   WHERE s.slug = v_slug
     AND s.state = 'published'
     AND tr.lifecycle_state = 'live';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  -- Finding #2: re-check live counsel validity & exact approval ID match at serve time!
  v_current_counsel := public._public_site_counsel_approval(v_row.tenant_id);
  IF v_current_counsel IS NULL OR v_current_counsel IS DISTINCT FROM v_row.counsel_approval_id THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  -- Finding #5: live branch publish window filter (using clock_timestamp()) + reason-free 30-day closures.
  SELECT coalesce(jsonb_agg(lower(b.code) ORDER BY lower(b.code)), '[]'::jsonb)
    INTO v_live_branches
    FROM public.branches b
   WHERE b.tenant_id = v_row.tenant_id
     AND b.publish_from IS NOT NULL
     AND b.publish_from <= v_now
     AND (b.publish_until IS NULL OR b.publish_until > v_now);

  IF jsonb_array_length(v_live_branches) = 0 THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'branchSlug', lower(b.code),
      'date', to_char(bc.closed_on, 'YYYY-MM-DD'),
      'opens', CASE WHEN bc.from_time IS NOT NULL THEN to_char(bc.from_time, 'HH24:MI') ELSE NULL END,
      'closes', CASE WHEN bc.until_time IS NOT NULL THEN to_char(bc.until_time, 'HH24:MI') ELSE NULL END
    ) ORDER BY lower(b.code), bc.closed_on, bc.from_time NULLS FIRST
  ), '[]'::jsonb)
    INTO v_live_closures
    FROM public.branch_closures bc
    JOIN public.branches b ON b.tenant_id = bc.tenant_id AND b.id = bc.branch_id
   WHERE bc.tenant_id = v_row.tenant_id
     AND b.publish_from IS NOT NULL AND b.publish_from <= v_now
     AND (b.publish_until IS NULL OR b.publish_until > v_now)
     AND bc.closed_on >= (v_now AT TIME ZONE b.timezone)::date
     AND bc.closed_on <= ((v_now AT TIME ZONE b.timezone)::date + 30);

  RETURN jsonb_build_object(
    'state', 'published',
    'slug', v_row.slug,
    'version', v_row.published_version,
    'snapshot', v_row.snapshot,
    'liveBranchSlugs', v_live_branches,
    'liveClosures', v_live_closures,
    'metaPixelId', v_row.meta_pixel_id,
    'gaMeasurementId', v_row.ga_measurement_id
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_site_by_slug(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_site_by_slug(text) TO clinic_app;--> statement-breakpoint
