-- T-127 r4 (PR-39, UX-51, DEC-131): Persisted monotonic pixel_config_revision on public_sites.
-- Prevents consent/banner-token revival across A -> B -> A rotations or disable -> re-enable cycles:
-- every UPDATE that changes meta_pixel_id or ga_measurement_id advances pixel_config_revision atomically
-- via an ENABLE ALWAYS BEFORE UPDATE trigger (and prevents callers from lowering or spoofing the revision).

ALTER TABLE "public_sites" ADD COLUMN "pixel_config_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "public_sites" ADD CONSTRAINT "public_sites_pixel_rev_check" CHECK ("public_sites"."pixel_config_revision" >= 1);--> statement-breakpoint

CREATE FUNCTION public.public_sites_pixel_revision_bump() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.meta_pixel_id IS DISTINCT FROM OLD.meta_pixel_id
     OR NEW.ga_measurement_id IS DISTINCT FROM OLD.ga_measurement_id THEN
    NEW.pixel_config_revision := OLD.pixel_config_revision + 1;
  ELSE
    NEW.pixel_config_revision := OLD.pixel_config_revision;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_sites_pixel_revision_bump() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER public_sites_pixel_revision_bump
  BEFORE UPDATE ON public.public_sites
  FOR EACH ROW
  EXECUTE FUNCTION public.public_sites_pixel_revision_bump();--> statement-breakpoint
ALTER TABLE public.public_sites ENABLE ALWAYS TRIGGER public_sites_pixel_revision_bump;--> statement-breakpoint

-- Expose pixelConfigRevision from unbound public_site_by_slug() so BOOKING_HOST proxy,
-- PublicPixelGate, and /api/v1/public/pixel-consent bind cookies & banner tokens to the exact revision.
CREATE OR REPLACE FUNCTION public.public_site_by_slug(p_slug text) RETURNS jsonb
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
         s.pixel_config_revision, v.counsel_approval_id, v.snapshot
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

  -- Finding #2 (T-123): re-check live counsel validity & exact approval ID match at serve time!
  v_current_counsel := public._public_site_counsel_approval(v_row.tenant_id);
  IF v_current_counsel IS NULL OR v_current_counsel IS DISTINCT FROM v_row.counsel_approval_id THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  -- Finding #5 (T-123): live branch publish window filter (using clock_timestamp()) + reason-free 30-day closures.
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
    'gaMeasurementId', v_row.ga_measurement_id,
    'pixelConfigRevision', v_row.pixel_config_revision
  );
END
$$;--> statement-breakpoint
