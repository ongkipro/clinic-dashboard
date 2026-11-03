-- T-019 (PR-97, DATA-71, P-26). Obligation catalogue and feature gates are platform
-- registries; tenant evidence is tenant-shared and written only through the functions
-- below (actor from the bound context, 07 "Compliance register": owner for every tenant
-- item, facility head for clinical items, finance for tax and accounting items; Admin Pusat
-- and the internal auditor read). Vendor items (vendor_evidence_items, platform) are
-- operator-only: the clinic app sees their status through compliance_register().
ALTER TABLE public.compliance_obligations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vendor_evidence_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.feature_gates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- PR-97 obligations. Vendor level: PSE, residency opinion (H-02d), SATUSEHAT vendor
-- registration, Meta, processor-agreement template. Tenant level: tax advice, accountant
-- posting-map sign-off, clinical authority matrix, SOPs (downtime, incidents, waste), DPIA,
-- appointments (DPO, Penanggung Jawab, responsible pharmacist), signed processor
-- agreement, counsel reading for public sites (Q-15).
INSERT INTO public.compliance_obligations (key, scope, label, area, config_kind, valid_months) VALUES
  ('vendor_pse', 'vendor', 'Pendaftaran PSE', 'legal', NULL, NULL),
  ('vendor_residency_opinion', 'vendor', 'Pendapat hukum lokasi data', 'legal', 'residency_locations', NULL),
  ('vendor_satusehat_registration', 'vendor', 'Registrasi vendor SATUSEHAT', 'legal', NULL, NULL),
  ('vendor_meta_business', 'vendor', 'Verifikasi bisnis Meta', 'legal', NULL, NULL),
  ('vendor_processor_agreement_template', 'vendor', 'Templat perjanjian pengolahan data', 'privacy', NULL, NULL),
  ('tax_advice', 'tenant', 'Saran pajak (PPN per jenis layanan)', 'tax', NULL, 12),
  ('posting_map_signoff', 'tenant', 'Persetujuan posting map oleh akuntan', 'accounting', 'posting_map', 12),
  ('clinical_authority_matrix', 'tenant', 'Matriks kewenangan klinis', 'clinical', NULL, 12),
  ('sop_downtime', 'tenant', 'SOP gangguan sistem', 'operations', NULL, 24),
  ('sop_incident', 'tenant', 'SOP insiden', 'operations', NULL, 24),
  ('sop_waste', 'tenant', 'SOP limbah medis', 'clinical', NULL, 24),
  ('dpia', 'tenant', 'Penilaian dampak pelindungan data (DPIA)', 'privacy', NULL, 24),
  ('appointment_dpo', 'tenant', 'Penunjukan pejabat pelindungan data', 'privacy', NULL, NULL),
  ('appointment_responsible_person', 'tenant', 'Penunjukan Penanggung Jawab klinik', 'clinical', NULL, NULL),
  ('appointment_pharmacist', 'tenant', 'Penunjukan apoteker penanggung jawab', 'clinical', NULL, NULL),
  ('processor_agreement_signed', 'tenant', 'Perjanjian pengolahan data yang ditandatangani', 'privacy', NULL, NULL),
  ('public_site_counsel', 'tenant', 'Pendapat hukum situs klinik (Permenkes 1787/2010)', 'legal', NULL, 12);--> statement-breakpoint

-- Gated features (PR-97) and the obligations each needs. `test_gate` is the fixture gate of
-- this task's scenarios; the real gates are switched on by their tasks (VAT T-071, journal
-- export, public-site publish T-123, campaign sending, clinical go-live, real-patient
-- go-live) and already listed so the register shows what each item unlocks.
INSERT INTO public.feature_gates (key, obligation_key) VALUES
  ('vat_on_invoices', 'tax_advice'),
  ('journal_export', 'posting_map_signoff'),
  ('public_site_publish', 'public_site_counsel'),
  ('campaign_sending', 'public_site_counsel'),
  ('clinical_go_live', 'clinical_authority_matrix'),
  ('clinical_go_live', 'appointment_responsible_person'),
  ('clinical_go_live', 'appointment_pharmacist'),
  ('clinical_go_live', 'sop_downtime'),
  ('clinical_go_live', 'sop_incident'),
  ('clinical_go_live', 'sop_waste'),
  ('real_patient_go_live', 'processor_agreement_signed'),
  ('real_patient_go_live', 'dpia'),
  ('real_patient_go_live', 'appointment_dpo'),
  ('real_patient_go_live', 'vendor_residency_opinion'),
  ('real_patient_go_live', 'vendor_processor_agreement_template'),
  ('test_gate', 'tax_advice');--> statement-breakpoint

-- Tenant rows: the item's tenant matches its obligation scope; files and decisions copy
-- the item's tenant (checked by the functions and the guard below).

-- Who may upload and decide a tenant obligation (07): owner always; facility head for
-- clinical items; finance for tax and accounting items.
CREATE FUNCTION public.compliance_may_act(p_role text, p_area text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_role = 'owner'
      OR p_role = 'facility_head' AND p_area = 'clinical'
      OR p_role = 'finance' AND p_area IN ('tax','accounting')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.compliance_may_act(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.compliance_may_act(text, text) TO clinic_app;--> statement-breakpoint

-- Readers (07): owner, Admin Pusat and the internal auditor read every tenant item; the
-- facility head reads clinical items and finance tax and accounting items (their areas).
-- The register page shows every obligation's status to these roles (compliance_register);
-- files and decisions follow the area rule.
CREATE FUNCTION public.compliance_may_read(p_obligation text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.app_role_in(ARRAY['owner','admin_pusat','auditor'])
                  OR public.compliance_may_act(public.app_acting_role(), (SELECT area FROM public.compliance_obligations WHERE key = p_obligation)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.compliance_may_read(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.compliance_may_read(text) TO clinic_app;--> statement-breakpoint
ALTER TABLE public.evidence_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.evidence_files ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.evidence_approvals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY evidence_items_read ON public.evidence_items FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.compliance_may_read(obligation_key));--> statement-breakpoint
CREATE POLICY evidence_files_read ON public.evidence_files FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND public.compliance_may_read((SELECT i.obligation_key FROM public.evidence_items i WHERE i.id = item_id)));--> statement-breakpoint
CREATE POLICY evidence_approvals_read ON public.evidence_approvals FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND public.compliance_may_read((SELECT i.obligation_key FROM public.evidence_items i WHERE i.id = item_id)));--> statement-breakpoint
GRANT SELECT ON public.evidence_items, public.evidence_approvals TO clinic_app;--> statement-breakpoint
-- The file content is read through evidence_file_content() (audited download), not by SELECT.
GRANT SELECT (id, item_id, tenant_id, version, file_name, media_type, size_bytes, sha256, expert_name, document_date,
              uploaded_by, uploaded_as, uploaded_name, uploaded_at) ON public.evidence_files TO clinic_app;--> statement-breakpoint

-- The configuration version an approval of this obligation covers, read from its source
-- (posting map: arrives with the accounting tasks; residency: the vendor profile's storage
-- locations). NULL when the obligation has none or its source does not exist yet.
CREATE FUNCTION public.compliance_config_version(p_tenant uuid, p_config_kind text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_config_kind = 'residency_locations' THEN
    RETURN (SELECT encode(sha256(convert_to(storage_locations::text, 'UTF8')), 'hex') FROM public.vendor_profile WHERE id = 1);
  END IF;
  IF p_config_kind = 'posting_map' THEN
    RETURN (SELECT version FROM public.compliance_config_versions WHERE tenant_id IS NOT DISTINCT FROM p_tenant AND kind = p_config_kind);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.compliance_config_version(uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Configuration versions that approvals bind to (the posting map writes its version here
-- when it changes, in its own task; tests write the fixture version).
CREATE TABLE public.compliance_config_versions (
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z_]{2,40}$'),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 80),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, kind)
);--> statement-breakpoint
ALTER TABLE public.compliance_config_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Is a tenant item usable now? Approved, not expired, its newest decision approves the
-- newest file and covers the current configuration version.
CREATE FUNCTION public.evidence_item_open(p_item uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((
    SELECT i.state = 'approved'
       AND (i.valid_until IS NULL OR i.valid_until >= (now() AT TIME ZONE 'Asia/Jakarta')::date)
       AND a.decision = 'approved'
       AND a.file_id = (SELECT f.id FROM public.evidence_files f WHERE f.item_id = i.id ORDER BY f.version DESC LIMIT 1)
       AND a.config_version IS NOT DISTINCT FROM public.compliance_config_version(i.tenant_id, o.config_kind)
      FROM public.evidence_items i
      JOIN public.compliance_obligations o ON o.key = i.obligation_key
      JOIN LATERAL (SELECT * FROM public.evidence_approvals x WHERE x.item_id = i.id ORDER BY x.seq DESC LIMIT 1) a ON true
     WHERE i.id = p_item), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.evidence_item_open(uuid) FROM PUBLIC;--> statement-breakpoint

-- Is a vendor obligation usable now (platform row: approved, not expired, covering the
-- current configuration version)?
CREATE FUNCTION public.vendor_evidence_open(p_obligation text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((
    SELECT v.state = 'approved'
       AND (v.valid_until IS NULL OR v.valid_until >= (now() AT TIME ZONE 'Asia/Jakarta')::date)
       AND v.config_version IS NOT DISTINCT FROM public.compliance_config_version(NULL, o.config_kind)
      FROM public.vendor_evidence_items v JOIN public.compliance_obligations o ON o.key = v.obligation_key
     WHERE v.obligation_key = p_obligation), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_evidence_open(text) FROM PUBLIC;--> statement-breakpoint

-- The state shown on screen: approved items whose approval no longer covers the newest
-- file / configuration read 'submitted' (waiting again), expired ones 'expired'.
CREATE FUNCTION public.evidence_item_status(p_item uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN i.state = 'approved' AND public.evidence_item_open(i.id) THEN 'approved'
    WHEN i.state = 'approved' AND i.valid_until < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'expired'
    WHEN i.state = 'approved' THEN 'submitted'
    ELSE i.state END
    FROM public.evidence_items i WHERE i.id = p_item
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.evidence_item_status(uuid) FROM PUBLIC;--> statement-breakpoint

-- Is the gate open for the bound tenant? Every obligation the gate needs is open: tenant
-- obligations for this tenant, vendor obligations at platform level. An unknown gate is
-- closed (fail closed).
CREATE FUNCTION public.obligation_open(p_obligation text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE (SELECT scope FROM public.compliance_obligations WHERE key = p_obligation)
    WHEN 'vendor' THEN public.vendor_evidence_open(p_obligation)
    WHEN 'tenant' THEN coalesce((SELECT public.evidence_item_open(i.id) FROM public.evidence_items i
                                  WHERE i.tenant_id = public.app_tenant_id() AND i.obligation_key = p_obligation), false)
    ELSE false END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.obligation_open(text) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.feature_gate_open(p_gate text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.app_tenant_id() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.feature_gates g WHERE g.key = p_gate)
     AND NOT EXISTS (SELECT 1 FROM public.feature_gates g WHERE g.key = p_gate AND NOT public.obligation_open(g.obligation_key))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.feature_gate_open(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.feature_gate_open(text) TO clinic_app;--> statement-breakpoint

-- A gated action calls this in its own transaction before checking the gate: it locks
-- the evidence items the gate reads (FOR SHARE) so a revocation, upload or decision cannot
-- commit between the check and the action (assertFeatureGate). Outside a transaction the
-- lock ends with the statement. Configuration versions (posting map, residency) are not
-- locked: their writers arrive with their tasks and take this lock order then.
CREATE FUNCTION public.feature_gate_lock(p_gate text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.evidence_items i JOIN public.feature_gates g ON g.obligation_key = i.obligation_key
   WHERE g.key = p_gate AND i.tenant_id = public.app_tenant_id()
   FOR SHARE OF i;
  PERFORM 1 FROM public.vendor_evidence_items v JOIN public.feature_gates g ON g.obligation_key = v.obligation_key
   WHERE g.key = p_gate
   FOR SHARE OF v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.feature_gate_lock(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.feature_gate_lock(text) TO clinic_app;--> statement-breakpoint

-- The obligations a closed gate is waiting for (labels for "Fitur {x} terkunci sampai bukti
-- {y} disetujui"), for the bound tenant.
CREATE FUNCTION public.feature_gate_missing(p_gate text) RETURNS TABLE (obligation_key text, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT o.key, o.label FROM public.feature_gates g
    JOIN public.compliance_obligations o ON o.key = g.obligation_key
   WHERE g.key = p_gate AND public.app_tenant_id() IS NOT NULL AND NOT public.obligation_open(o.key)
   ORDER BY o.key
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.feature_gate_missing(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.feature_gate_missing(text) TO clinic_app;--> statement-breakpoint

-- Kepatuhan for the bound tenant: every obligation (tenant and vendor) with its status,
-- validity and the gates it unlocks. Vendor items show status only (no files, names or
-- reasons). Readers: owner, Admin Pusat, auditor, facility head, finance.
CREATE FUNCTION public.compliance_register()
RETURNS TABLE (obligation_key text, scope text, label text, area text, item_id uuid, status text, valid_until date,
               gates text[], latest_version integer, may_act boolean, may_read boolean, may_decide boolean, latest_file uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_tenant uuid;
  v_role text;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  v_tenant := a.tenant_id;
  v_role := a.role;
  IF coalesce(v_role, '') <> ALL (ARRAY['owner','admin_pusat','auditor','facility_head','finance']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: not a reader of the compliance register' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.key, o.scope, o.label, o.area,
         CASE WHEN o.scope = 'tenant' AND (v_role IN ('owner','admin_pusat','auditor') OR public.compliance_may_act(v_role, o.area)) THEN i.id END,
         CASE WHEN o.scope = 'vendor' THEN
                CASE WHEN public.vendor_evidence_open(o.key) THEN 'approved'
                     WHEN vi.state = 'approved' AND vi.valid_until < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'expired'
                     WHEN vi.state = 'approved' THEN 'submitted'
                     ELSE coalesce(vi.state, 'missing') END
              ELSE coalesce(public.evidence_item_status(i.id), 'missing') END,
         CASE WHEN o.scope = 'tenant' THEN i.valid_until WHEN public.vendor_evidence_open(o.key) THEN vi.valid_until END,
         coalesce((SELECT array_agg(g.key ORDER BY g.key) FROM public.feature_gates g WHERE g.obligation_key = o.key AND g.key <> 'test_gate'), '{}'),
         CASE WHEN o.scope = 'tenant' AND (v_role IN ('owner','admin_pusat','auditor') OR public.compliance_may_act(v_role, o.area))
              THEN (SELECT max(f.version) FROM public.evidence_files f WHERE f.tenant_id = v_tenant AND f.item_id = i.id) END,
         o.scope = 'tenant' AND public.compliance_may_act(v_role, o.area),
         o.scope = 'tenant' AND (v_role IN ('owner','admin_pusat','auditor') OR public.compliance_may_act(v_role, o.area)),
         -- Decide the newest file: a handler of the area who did not upload it.
         o.scope = 'tenant' AND public.compliance_may_act(v_role, o.area)
           AND EXISTS (SELECT 1 FROM public.evidence_files f WHERE f.tenant_id = v_tenant AND f.item_id = i.id)
           AND (SELECT f.uploaded_by FROM public.evidence_files f WHERE f.tenant_id = v_tenant AND f.item_id = i.id ORDER BY f.version DESC LIMIT 1) IS DISTINCT FROM a.staff_id,
         CASE WHEN o.scope = 'tenant' AND (v_role IN ('owner','admin_pusat','auditor') OR public.compliance_may_act(v_role, o.area))
              THEN (SELECT f.id FROM public.evidence_files f WHERE f.tenant_id = v_tenant AND f.item_id = i.id ORDER BY f.version DESC LIMIT 1) END
    FROM public.compliance_obligations o
    LEFT JOIN public.evidence_items i ON o.scope = 'tenant' AND i.tenant_id = v_tenant AND i.obligation_key = o.key
    LEFT JOIN public.vendor_evidence_items vi ON o.scope = 'vendor' AND vi.obligation_key = o.key
   ORDER BY o.scope DESC, o.area, o.key;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.compliance_register() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.compliance_register() TO clinic_app;--> statement-breakpoint

-- Unggah Bukti: a new file version of a tenant obligation (created on first upload). A new
-- version re-opens the gate until approved again (the approval names a file version).
CREATE FUNCTION public.evidence_upload(p_obligation text, p_file_name text, p_media_type text, p_content bytea,
                                       p_sha256 text, p_expert text, p_document_date date)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  o public.compliance_obligations;
  v_item uuid;
  v_version integer;
  v_file uuid;
  v_name text;
  v_type text;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO o FROM public.compliance_obligations WHERE key = p_obligation;
  IF NOT FOUND OR o.scope <> 'tenant' THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: unknown tenant obligation' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(public.compliance_may_act(a.role, o.area), false) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this role does not handle this evidence' USING ERRCODE = '42501';
  END IF;
  -- The checksum is recomputed here: the stored checksum is the database's, never the caller's.
  IF p_content IS NULL OR octet_length(p_content) NOT BETWEEN 1 AND 5242880
     OR p_sha256 IS DISTINCT FROM encode(sha256(p_content), 'hex') THEN
    RAISE EXCEPTION 'ERR_INVALID_FILE: file missing, too large or checksum mismatch' USING ERRCODE = '22023';
  END IF;
  -- The type comes from the bytes (PDF, PNG, JPEG signatures), never from the caller.
  v_type := CASE
    WHEN substring(p_content FROM 1 FOR 5) = '\x255044462d'::bytea THEN 'application/pdf'
    WHEN substring(p_content FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea THEN 'image/png'
    WHEN substring(p_content FROM 1 FOR 3) = '\xffd8ff'::bytea THEN 'image/jpeg' END;
  IF v_type IS NULL OR p_media_type IS DISTINCT FROM v_type THEN
    RAISE EXCEPTION 'ERR_INVALID_FILE: only PDF, PNG or JPEG by content' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_file_name, ''))) NOT BETWEEN 1 AND 200 OR p_file_name ~ '[/\\]'
     OR length(btrim(coalesce(p_expert, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: file name or author missing' USING ERRCODE = '22023';
  END IF;
  IF p_document_date IS NULL OR p_document_date > (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: the document date is in the future' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.evidence_items (tenant_id, obligation_key) VALUES (a.tenant_id, o.key)
  ON CONFLICT ON CONSTRAINT evidence_items_one_per_obligation DO NOTHING;
  SELECT id INTO STRICT v_item FROM public.evidence_items WHERE tenant_id = a.tenant_id AND obligation_key = o.key FOR UPDATE;
  -- The same bytes as the newest version (a double submit or a retry) add no version.
  SELECT id INTO v_file FROM public.evidence_files WHERE item_id = v_item ORDER BY version DESC LIMIT 1;
  IF v_file IS NOT NULL AND (SELECT sha256 FROM public.evidence_files WHERE id = v_file) = encode(sha256(p_content), 'hex') THEN
    RETURN v_file;
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.evidence_files WHERE item_id = v_item;
  SELECT display_name INTO STRICT v_name FROM public.staff WHERE tenant_id = a.tenant_id AND id = a.staff_id;
  INSERT INTO public.evidence_files (item_id, tenant_id, version, file_name, media_type, size_bytes, sha256, content,
                                     expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
  VALUES (v_item, a.tenant_id, v_version, btrim(p_file_name), p_media_type, octet_length(p_content), encode(sha256(p_content), 'hex'),
          p_content, btrim(p_expert), p_document_date, a.staff_id, a.role, v_name)
  RETURNING id INTO v_file;
  -- A new version waits for a decision; an approved item's gate re-opens (closes) until then.
  UPDATE public.evidence_items SET state = 'submitted', updated_at = now() WHERE id = v_item AND state <> 'submitted';
  -- The audit object is the file row (its version and checksum are on it, immutable).
  PERFORM public.audit_append('settings_change', 'evidence_file', v_file, 'success', 'evidence_uploaded');
  RETURN v_file;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.evidence_upload(text, text, text, bytea, text, text, date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.evidence_upload(text, text, text, bytea, text, text, date) TO clinic_app;--> statement-breakpoint

-- Tandai Disetujui / Tolak / Cabut: decides the newest file version of an item. Approval
-- binds that file version and the current configuration version; validity comes from the
-- obligation (months) unless the approver names an earlier date. The uploader of the file
-- never approves it (requester ≠ approver, BILL-23).
CREATE FUNCTION public.evidence_decide(p_item uuid, p_file uuid, p_decision text, p_reason text, p_valid_until date)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  i public.evidence_items;
  o public.compliance_obligations;
  f public.evidence_files;
  v_valid date;
  v_name text;
  v_config text;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO i FROM public.evidence_items WHERE tenant_id = a.tenant_id AND id = p_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: evidence not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO STRICT o FROM public.compliance_obligations WHERE key = i.obligation_key;
  IF NOT coalesce(public.compliance_may_act(a.role, o.area), false) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this role does not decide this evidence' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved','rejected','revoked') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: unknown decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.evidence_files WHERE item_id = i.id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no file to decide' USING ERRCODE = 'P0002';
  END IF;
  -- The decision is about the file the decider reviewed: a newer upload since then is a conflict.
  IF p_file IS DISTINCT FROM f.id THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a newer file was uploaded' USING ERRCODE = '55000';
  END IF;
  IF p_decision = 'revoked' AND i.state <> 'approved' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: only an approved item is revoked' USING ERRCODE = '55000';
  END IF;
  IF p_decision IN ('approved','rejected') AND public.evidence_item_status(i.id) NOT IN ('submitted','expired','rejected','revoked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already decided' USING ERRCODE = '55000';
  END IF;
  IF p_decision IN ('approved','rejected') AND f.uploaded_by = a.staff_id THEN
    RAISE EXCEPTION 'ERR_APPROVER_IS_REQUESTER: the uploader cannot decide this file' USING ERRCODE = 'P0422';
  END IF;
  IF p_decision <> 'approved' AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a rejection or revocation needs a reason' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_reason, '')) > 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason over 500 characters' USING ERRCODE = '22023';
  END IF;
  v_valid := CASE WHEN o.valid_months IS NULL THEN p_valid_until
                  ELSE least(coalesce(p_valid_until, 'infinity'::date), ((now() AT TIME ZONE 'Asia/Jakarta')::date + make_interval(months => o.valid_months))::date) END;
  IF p_decision = 'approved' AND v_valid IS NOT NULL AND v_valid < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: validity in the past' USING ERRCODE = '22023';
  END IF;
  v_config := public.compliance_config_version(i.tenant_id, o.config_kind);
  SELECT display_name INTO STRICT v_name FROM public.staff WHERE tenant_id = a.tenant_id AND id = a.staff_id;
  INSERT INTO public.evidence_approvals (item_id, tenant_id, file_id, config_version, decision, reason, valid_until, decided_by, decided_as, decided_name)
  VALUES (i.id, i.tenant_id, f.id, v_config, p_decision, NULLIF(btrim(p_reason), ''), CASE WHEN p_decision = 'approved' THEN v_valid END,
          a.staff_id, a.role, v_name);
  UPDATE public.evidence_items
     SET state = p_decision, valid_until = CASE WHEN p_decision = 'approved' THEN v_valid ELSE valid_until END,
         config_version = CASE WHEN p_decision = 'approved' THEN v_config ELSE config_version END, updated_at = now()
   WHERE id = i.id;
  PERFORM public.audit_append('approval', 'evidence_item', i.id, 'success',
          CASE p_decision WHEN 'approved' THEN 'evidence_approved' WHEN 'rejected' THEN 'evidence_rejected' ELSE 'evidence_revoked' END);
  RETURN p_decision;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.evidence_decide(uuid, uuid, text, text, date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.evidence_decide(uuid, uuid, text, text, date) TO clinic_app;--> statement-breakpoint

-- Download of one evidence file (readers of the register), audited.
CREATE FUNCTION public.evidence_file_content(p_file uuid) RETURNS TABLE (file_name text, media_type text, content bytea, sha256 text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  -- Readers of that item's area only (compliance_may_read); anything else is not found.
  IF NOT EXISTS (SELECT 1 FROM public.evidence_files f JOIN public.evidence_items i ON i.tenant_id = f.tenant_id AND i.id = f.item_id
                  WHERE f.id = p_file AND f.tenant_id = a.tenant_id AND public.compliance_may_read(i.obligation_key)) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: file not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('export', 'evidence_file', p_file, 'success', 'evidence_downloaded');
  RETURN QUERY SELECT f.file_name, f.media_type, f.content, f.sha256 FROM public.evidence_files f WHERE f.id = p_file AND f.tenant_id = a.tenant_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.evidence_file_content(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.evidence_file_content(uuid) TO clinic_app;--> statement-breakpoint

-- Evidence is history: files and decisions are never changed or deleted; an item keeps its
-- identity (only its state, validity and covered configuration change) and names a tenant
-- obligation. Composite tenant keys (05 §3.1) tie files and decisions to their item.
CREATE FUNCTION public.evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_TABLE_NAME IN ('evidence_files','evidence_approvals') AND TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'evidence is never changed or deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'evidence_items' THEN
    IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.obligation_key) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.obligation_key) THEN
      RAISE EXCEPTION 'an evidence item keeps its identity' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.compliance_obligations o WHERE o.key = NEW.obligation_key AND o.scope = 'tenant') THEN
      RAISE EXCEPTION 'a tenant evidence item names a tenant obligation' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER evidence_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_items FOR EACH ROW EXECUTE FUNCTION public.evidence_guard();--> statement-breakpoint
CREATE TRIGGER evidence_files_guard BEFORE UPDATE OR DELETE ON public.evidence_files FOR EACH ROW EXECUTE FUNCTION public.evidence_guard();--> statement-breakpoint
CREATE TRIGGER evidence_approvals_guard BEFORE UPDATE OR DELETE ON public.evidence_approvals FOR EACH ROW EXECUTE FUNCTION public.evidence_guard();--> statement-breakpoint
CREATE TRIGGER evidence_items_no_truncate BEFORE TRUNCATE ON public.evidence_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER evidence_files_no_truncate BEFORE TRUNCATE ON public.evidence_files FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER evidence_approvals_no_truncate BEFORE TRUNCATE ON public.evidence_approvals FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
-- A vendor item names a vendor obligation.
CREATE FUNCTION public.vendor_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.compliance_obligations o WHERE o.key = NEW.obligation_key AND o.scope = 'vendor') THEN
    RAISE EXCEPTION 'a vendor evidence item names a vendor obligation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER vendor_evidence_items_guard BEFORE INSERT OR UPDATE ON public.vendor_evidence_items FOR EACH ROW EXECUTE FUNCTION public.vendor_evidence_guard();--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.compliance_obligations', 'platform', 'compliance', '{}', 'migrations', 'none'),
  ('public.feature_gates', 'platform', 'compliance', '{}', 'migrations of gated features', 'none'),
  ('public.compliance_config_versions', 'platform', 'compliance', '{}', 'configuration owners (posting map, vendor profile)', 'none'),
  ('public.vendor_evidence_items', 'platform', 'compliance', '{}', 'vendor console (platform operator until T-020)', 'none'),
  ('public.evidence_items', 'tenant-shared', 'compliance', '{owner,admin_pusat,auditor,facility_head,finance}', 'evidence functions (src/modules/compliance)', 'none'),
  ('public.evidence_files', 'tenant-shared', 'compliance', '{owner,admin_pusat,auditor,facility_head,finance}', 'evidence_upload', 'none'),
  ('public.evidence_approvals', 'tenant-shared', 'compliance', '{owner,admin_pusat,auditor,facility_head,finance}', 'evidence_decide', 'none');
