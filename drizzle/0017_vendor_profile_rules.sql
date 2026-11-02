-- T-018 (PR-55, DATA-47, S-04, H-02d, PR-36). vendor_profile and its change log are
-- platform tables: RLS on, no policy and no grant for clinic_app (TEN-16). The clinic
-- app reads the public vendor identity (receipts, legal pages) and the go-live blockers
-- through two security-definer functions; writes go through the platform operator
-- connection (src/modules/vendor/profile) until the vendor console exists (T-020/T-021).
ALTER TABLE public.vendor_profile ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_profile_changes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.vendor_profile', 'platform', 'vendor', '{}', 'platform operator (vendor profile)', 'none'),
  ('public.vendor_profile_changes', 'platform', 'vendor', '{}', 'platform operator (vendor profile)', 'none');--> statement-breakpoint

-- The change log is append-only for everyone.
CREATE FUNCTION public.vendor_profile_changes_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'vendor_profile_changes is append-only' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
CREATE TRIGGER vendor_profile_changes_no_update BEFORE UPDATE OR DELETE ON public.vendor_profile_changes
  FOR EACH ROW EXECUTE FUNCTION public.vendor_profile_changes_immutable();--> statement-breakpoint
CREATE TRIGGER vendor_profile_changes_no_truncate BEFORE TRUNCATE ON public.vendor_profile_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.vendor_profile_changes_immutable();--> statement-breakpoint

-- S-04: the vendor entity is a placeholder until the owner names it.
INSERT INTO public.vendor_profile (id, legal_name, nib, pse_number, npwp, meta_business_id, website, privacy_url,
                                   support_email, support_phone, placeholder_fields)
VALUES (1, 'PT [Nama Badan Usaha]', '[NIB]', '[Nomor PSE]', '[NPWP]', '[Meta Business ID]',
        'https://[situs-vendor]', 'https://[situs-vendor]/kebijakan-privasi', 'dukungan@[situs-vendor]', '[Nomor Dukungan]',
        array['legal_name','nib','pse_number','npwp','meta_business_id','website','privacy_url','support_email','support_phone']);--> statement-breakpoint

-- A value is a placeholder when it is listed, blank, or carries any bracket (an open or
-- closed "[...]" marker): detection fails closed for writes that bypass the profile module.
CREATE FUNCTION public.vendor_placeholder_fields() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(f ORDER BY f), '{}')
    FROM public.vendor_profile p,
         LATERAL (VALUES ('legal_name', p.legal_name), ('nib', p.nib), ('pse_number', p.pse_number),
                         ('npwp', p.npwp), ('meta_business_id', p.meta_business_id), ('website', p.website),
                         ('privacy_url', p.privacy_url), ('support_email', p.support_email),
                         ('support_phone', p.support_phone)) v(f, val)
   WHERE p.id = 1 AND (f = ANY (p.placeholder_fields) OR btrim(val) = '' OR val ~ '[][]')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_placeholder_fields() FROM PUBLIC;--> statement-breakpoint

-- Public vendor identity for receipts, templates and legal pages (no residency or tax
-- evidence), with the placeholder markers so every renderer can mark them.
CREATE FUNCTION public.vendor_identity() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'legal_name', legal_name, 'nib', nib, 'pse_number', pse_number, 'npwp', npwp,
    'meta_business_id', meta_business_id, 'website', website, 'privacy_url', privacy_url,
    'support_email', support_email, 'support_phone', support_phone,
    'placeholders', to_jsonb(public.vendor_placeholder_fields()))
  FROM public.vendor_profile WHERE id = 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_identity() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_identity() TO clinic_app;--> statement-breakpoint

-- Production go-live blockers (PR-55, PR-36, H-02d): placeholder fields; every storage
-- kind declared; all locations in Indonesia (ID) or a positive residency opinion.
-- Empty array = go-live allowed by the vendor profile. The reasons (residency posture,
-- legal outcome) are for the platform operator only; the clinic app gets a boolean.
CREATE FUNCTION public.vendor_go_live_blockers() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  p public.vendor_profile;
  out text[] := '{}';
  k text;
BEGIN
  SELECT * INTO p FROM public.vendor_profile WHERE id = 1;
  IF NOT FOUND THEN
    RETURN array['profile_missing'];
  END IF;
  out := out || array(SELECT 'placeholder:' || f FROM unnest(public.vendor_placeholder_fields()) f);
  FOREACH k IN ARRAY array['database','object_storage','backups','logs','error_tracking'] LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.storage_locations) l WHERE l->>'kind' = k) THEN
      out := out || ('storage_undeclared:' || k);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p.storage_locations) l WHERE coalesce(l->>'country', '') <> 'ID') THEN
    IF p.residency_opinion_outcome IS NULL THEN
      out := out || 'residency_opinion_required'::text;
    ELSIF p.residency_opinion_outcome = 'negative' THEN
      out := out || 'residency_opinion_negative'::text;
    END IF;
  END IF;
  RETURN out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_go_live_blockers() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.vendor_go_live_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT cardinality(public.vendor_go_live_blockers()) = 0
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_go_live_allowed() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_go_live_allowed() TO clinic_app;
