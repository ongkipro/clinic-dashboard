CREATE TABLE "package_beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_as" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"grant_reason" text NOT NULL,
	"removed_by" uuid,
	"removed_as" text,
	"removed_at" timestamp with time zone,
	"remove_reason" text,
	"command_key" text NOT NULL,
	CONSTRAINT "package_beneficiaries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "package_beneficiaries_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "package_beneficiaries_check" CHECK ("package_beneficiaries"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and length(btrim("package_beneficiaries"."grant_reason")) between 3 and 500
      and "package_beneficiaries"."granted_as" in ('owner','manager','fo_cashier')
      and num_nonnulls("package_beneficiaries"."removed_by", "package_beneficiaries"."removed_as", "package_beneficiaries"."removed_at", "package_beneficiaries"."remove_reason") in (0, 4)
      and ("package_beneficiaries"."remove_reason" is null or length(btrim("package_beneficiaries"."remove_reason")) between 3 and 500)
      and ("package_beneficiaries"."removed_as" is null or "package_beneficiaries"."removed_as" in ('owner','manager','fo_cashier')))
);
--> statement-breakpoint
CREATE TABLE "package_sharing" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"reason" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_as" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "package_sharing_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "package_sharing_version_key" UNIQUE("tenant_id","item_id","version"),
	CONSTRAINT "package_sharing_check" CHECK ("package_sharing"."version" >= 1 and length(btrim("package_sharing"."reason")) between 3 and 500 and "package_sharing"."changed_as" = 'owner')
);
--> statement-breakpoint
ALTER TABLE "package_sessions" ADD COLUMN "beneficiary_patient_id" uuid;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "sharing_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "package_beneficiaries" ADD CONSTRAINT "package_beneficiaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_beneficiaries" ADD CONSTRAINT "package_beneficiaries_package_fk" FOREIGN KEY ("tenant_id","package_id") REFERENCES "public"."packages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_beneficiaries" ADD CONSTRAINT "package_beneficiaries_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_beneficiaries" ADD CONSTRAINT "package_beneficiaries_granted_by_fk" FOREIGN KEY ("tenant_id","granted_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_beneficiaries" ADD CONSTRAINT "package_beneficiaries_removed_by_fk" FOREIGN KEY ("tenant_id","removed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sharing" ADD CONSTRAINT "package_sharing_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sharing" ADD CONSTRAINT "package_sharing_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sharing" ADD CONSTRAINT "package_sharing_changed_by_fk" FOREIGN KEY ("tenant_id","changed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_beneficiaries_package_idx" ON "package_beneficiaries" USING btree ("tenant_id","package_id");--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_beneficiary_fk" FOREIGN KEY ("tenant_id","beneficiary_patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_sessions_beneficiary_idx" ON "package_sessions" USING btree ("tenant_id","beneficiary_patient_id") WHERE "package_sessions"."beneficiary_patient_id" is not null;--> statement-breakpoint
-- T-082 backfill (expand-only; r1 P1-2): every reserved or redeemed session before 0098 belongs to its package's owner (no sharing
-- existed); its treated patient is the reserved visit's canonical patient. The session guard is disabled only for this statement and
-- re-enabled ALWAYS (the T-080 pattern); version is not bumped (a data backfill, not a session transition).
ALTER TABLE public.package_sessions DISABLE TRIGGER package_sessions_guard;--> statement-breakpoint
UPDATE public.package_sessions s SET beneficiary_patient_id = public.patient_canonical(v.tenant_id, v.patient_id)
  FROM public.visits v WHERE v.tenant_id = s.tenant_id AND v.id = s.reserved_visit_id AND s.state IN ('reserved','redeemed');--> statement-breakpoint
ALTER TABLE public.package_sessions ENABLE ALWAYS TRIGGER package_sessions_guard;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_beneficiary_check" CHECK (("package_sessions"."state" in ('reserved','redeemed')) = ("package_sessions"."beneficiary_patient_id" is not null));--> statement-breakpoint

-- T-082 rules (generated by gen.py; plan docs/tasks/T-082.md)
-- ── T-082 helpers (plan §4, review r1) ──
-- The sharing switch of a package template as of an instant (r1 P1-1): the latest version changed at or before it; no row = off.
CREATE FUNCTION public.package_sharing_at(p_tenant uuid, p_item uuid, p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT s.enabled FROM public.package_sharing s WHERE s.tenant_id = p_tenant AND s.item_id = p_item AND s.changed_at <= p_at
                    ORDER BY s.version DESC LIMIT 1), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_sharing_at(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Whether a patient (any id of a merged cluster) is an active beneficiary of a sharing package, never the owner's own cluster
-- (r1 P2-1: canonical ids on both sides; DEC-061 redirect). A beneficiary row exists only on a sharing package (the insert guard;
-- sharing_allowed is frozen with the sale), so the switch is not re-read here (mutation review r1).
CREATE FUNCTION public.package_beneficiary_active(p_tenant uuid, p_package uuid, p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT EXISTS (
      SELECT 1 FROM public.package_beneficiaries b WHERE b.tenant_id = pk.tenant_id AND b.package_id = pk.id AND b.removed_at IS NULL
         AND public.patient_canonical(b.tenant_id, b.patient_id) = public.patient_canonical(p_tenant, p_patient))
      AND public.patient_canonical(p_tenant, p_patient) <> public.patient_canonical(pk.tenant_id, pk.patient_id)
    FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.id = p_package), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_beneficiary_active(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Whether a patient may reserve a session of the package: the owner's cluster, or an active beneficiary.
CREATE FUNCTION public.package_patient_may_use(p_tenant uuid, p_package uuid, p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT public.patient_canonical(p_tenant, p_patient) = public.patient_canonical(pk.tenant_id, pk.patient_id)
    FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.id = p_package), false)
    OR public.package_beneficiary_active(p_tenant, p_package, p_patient)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_patient_may_use(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.package_sharing ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY package_sharing_read ON public.package_sharing FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.package_contents_readable(tenant_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, item_id, version, enabled, changed_by, changed_as, changed_at) ON public.package_sharing TO clinic_app;--> statement-breakpoint
CREATE POLICY package_sharing_operator_read ON public.package_sharing FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.package_sharing', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, item_id, version, enabled, changed_by, changed_as, changed_at) ON public.package_sharing TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER package_sharing_no_truncate BEFORE TRUNCATE ON public.package_sharing FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.package_sharing ENABLE ALWAYS TRIGGER package_sharing_no_truncate;--> statement-breakpoint
ALTER TABLE public.package_beneficiaries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY package_beneficiaries_read ON public.package_beneficiaries FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.package_readable(tenant_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, package_id, patient_id, granted_by, granted_as, granted_at, removed_by, removed_as, removed_at, command_key) ON public.package_beneficiaries TO clinic_app;--> statement-breakpoint
CREATE POLICY package_beneficiaries_operator_read ON public.package_beneficiaries FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.package_beneficiaries', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, package_id, patient_id, granted_by, granted_as, granted_at, removed_by, removed_as, removed_at, command_key) ON public.package_beneficiaries TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER package_beneficiaries_no_truncate BEFORE TRUNCATE ON public.package_beneficiaries FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.package_beneficiaries ENABLE ALWAYS TRIGGER package_beneficiaries_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.package_sharing', 'tenant-shared', 'cashier', '{owner,admin_pusat,manager,fo_cashier,finance,auditor}', 'package sharing definers (src/modules/packages/sharing)', 'none (catalog configuration)'),
  ('public.package_beneficiaries', 'tenant-shared', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'package sharing definers (src/modules/packages/sharing)', 'none (tenant-wide, as packages)');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): the template switch is configuration; beneficiaries are personal.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.package_sharing', 'config'),
  ('public.package_beneficiaries', 'personal');--> statement-breakpoint
-- r1 P1-4: the new packages column is granted like the others (column grants on packages, 0091:390,393).
GRANT SELECT (sharing_allowed) ON public.packages TO clinic_app;--> statement-breakpoint
GRANT SELECT (sharing_allowed) ON public.packages TO clinic_operator;--> statement-breakpoint

-- ── T-082 guards (staff_access first; never deleted) ──
-- The switch is insert-only: each change is the next version of its item; the item is a package template.
CREATE FUNCTION public.package_sharing_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'the sharing switch is insert-only' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_items i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id AND i.kind = 'package')
     OR NEW.version <> 1 + coalesce((SELECT max(x.version) FROM public.package_sharing x WHERE x.tenant_id = NEW.tenant_id AND x.item_id = NEW.item_id), 0) THEN
    RAISE EXCEPTION 'a sharing change is the next version of a package template' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_sharing_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_sharing_guard BEFORE INSERT OR UPDATE OR DELETE ON public.package_sharing FOR EACH ROW EXECUTE FUNCTION public.package_sharing_guard();--> statement-breakpoint
ALTER TABLE public.package_sharing ENABLE ALWAYS TRIGGER package_sharing_guard;--> statement-breakpoint

-- Beneficiaries: inserted on an active sharing package for a patient outside the owner's cluster, not merged away, with no other
-- active row of the same canonical patient; afterwards only the removal (once).
CREATE FUNCTION public.package_beneficiaries_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk public.packages;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'package beneficiaries are never deleted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.package_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.removed_at IS NOT NULL OR pk.state IS DISTINCT FROM 'active' OR NOT pk.sharing_allowed
       OR public.patient_is_merged(NEW.tenant_id, NEW.patient_id)
       OR public.patient_canonical(NEW.tenant_id, NEW.patient_id) = public.patient_canonical(pk.tenant_id, pk.patient_id)
       OR EXISTS (SELECT 1 FROM public.package_beneficiaries b WHERE b.tenant_id = NEW.tenant_id AND b.package_id = NEW.package_id AND b.removed_at IS NULL
                    AND public.patient_canonical(b.tenant_id, b.patient_id) = public.patient_canonical(NEW.tenant_id, NEW.patient_id)) THEN
      RAISE EXCEPTION 'a beneficiary is another patient of an active sharing package, once' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.package_id, NEW.patient_id, NEW.granted_by, NEW.granted_as, NEW.granted_at, NEW.grant_reason, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.package_id, OLD.patient_id, OLD.granted_by, OLD.granted_as, OLD.granted_at, OLD.grant_reason, OLD.command_key)
     OR OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'a beneficiary keeps its grant; it is removed once' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.package_sessions s WHERE s.tenant_id = NEW.tenant_id AND s.package_id = NEW.package_id AND s.state = 'reserved'
               AND public.patient_canonical(s.tenant_id, s.beneficiary_patient_id) = public.patient_canonical(NEW.tenant_id, NEW.patient_id)
               AND public.patient_canonical(NEW.tenant_id, NEW.patient_id) <> public.patient_canonical(pk.tenant_id, pk.patient_id)) THEN
    RAISE EXCEPTION 'a beneficiary holding a reserved session is not removed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_beneficiaries_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_beneficiaries_guard BEFORE INSERT OR UPDATE OR DELETE ON public.package_beneficiaries FOR EACH ROW EXECUTE FUNCTION public.package_beneficiaries_guard();--> statement-breakpoint
ALTER TABLE public.package_beneficiaries ENABLE ALWAYS TRIGGER package_beneficiaries_guard;--> statement-breakpoint

-- ── T-082 writers (plan §4.1, §4.3; review r1) ──
-- Berbagi Keluarga on/off for a package template (PR-93 "where the owner enables it"; open point 1): the owner only, with a reason;
-- capability configuration. Insert-only versions; the same value is a no-op. Applies to packages sold after the change.
CREATE FUNCTION public.package_sharing_set(p_item uuid, p_enabled boolean, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_now boolean;
  v_version integer;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner switches family sharing' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: sharing' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_items i WHERE i.tenant_id = a.tenant_id AND i.id = p_item AND i.kind = 'package') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package template not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := public.package_sharing_at(a.tenant_id, p_item, clock_timestamp());
  IF v_now = p_enabled THEN
    RETURN jsonb_build_object('enabled', v_now, 'changed', false);
  END IF;
  v_version := 1 + coalesce((SELECT max(x.version) FROM public.package_sharing x WHERE x.tenant_id = a.tenant_id AND x.item_id = p_item), 0);
  INSERT INTO public.package_sharing (tenant_id, item_id, version, enabled, reason, changed_by, changed_as)
  VALUES (a.tenant_id, p_item, v_version, p_enabled, btrim(p_reason), a.staff_id, a.role);
  PERFORM public.audit_append('settings_change', 'catalog_item', p_item, 'success', 'package_sharing_set');
  RETURN jsonb_build_object('enabled', p_enabled, 'changed', true, 'version', v_version);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_sharing_set(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_sharing_set(uuid, boolean, text) TO clinic_app;--> statement-breakpoint

-- The template page state: owner and Admin Pusat (and the Kasir readers, to know whether a template shares); capability configuration
-- or cashier. The current state and the history (version, value, who and when; no reason text: IAM-12 keeps reasons off readers).
CREATE FUNCTION public.package_sharing_get(p_item uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','manager','fo_cashier','finance','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read package sharing' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.tenant_capability('configuration') OR public.tenant_capability('cashier')) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_items i WHERE i.tenant_id = a.tenant_id AND i.id = p_item AND i.kind = 'package') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package template not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('item_id', p_item, 'enabled', public.package_sharing_at(a.tenant_id, p_item, clock_timestamp()),
    'can_change', a.role = 'owner',
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('version', s.version, 'enabled', s.enabled, 'changed_at', s.changed_at, 'changed_as', s.changed_as)
                                        ORDER BY s.version DESC)
                           FROM public.package_sharing s WHERE s.tenant_id = a.tenant_id AND s.item_id = p_item), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_sharing_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_sharing_get(uuid) TO clinic_app;--> statement-breakpoint

-- Tambah Penerima Manfaat (open point 2): owner, manager, FO/cashier (the Paket & Saldo actors), with a reason. Locks the package
-- after staff_access (package_actor → package_locked). The canonical patient; an active row of the same canonical patient is the replay.
CREATE FUNCTION public.package_beneficiary_add(p_key text, p_package uuid, p_patient uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['owner','manager','fo_cashier']);
  pk public.packages;
  v_patient uuid;
  v_id uuid;
BEGIN
  SELECT b.id INTO v_id FROM public.package_beneficiaries b WHERE b.tenant_id = a.tenant_id AND b.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: beneficiary' USING ERRCODE = '22023';
  END IF;
  pk := public.package_locked(a.tenant_id, p_package);
  IF NOT pk.sharing_allowed THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: sharing_disabled' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients x WHERE x.tenant_id = a.tenant_id AND x.id = p_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  v_patient := public.patient_canonical(a.tenant_id, p_patient);
  IF v_patient = public.patient_canonical(pk.tenant_id, pk.patient_id) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: beneficiary_owner' USING ERRCODE = '22023';
  END IF;
  SELECT b.id INTO v_id FROM public.package_beneficiaries b WHERE b.tenant_id = pk.tenant_id AND b.package_id = pk.id AND b.removed_at IS NULL
     AND public.patient_canonical(b.tenant_id, b.patient_id) = v_patient;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.package_beneficiaries (tenant_id, package_id, patient_id, granted_by, granted_as, grant_reason, command_key)
  VALUES (pk.tenant_id, pk.id, v_patient, a.staff_id, a.role, btrim(p_reason), p_key) RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'package', pk.id, 'success', 'package_beneficiary_added');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_beneficiary_add(text, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_beneficiary_add(text, uuid, uuid, text) TO clinic_app;--> statement-breakpoint

-- Hapus Penerima Manfaat (P3: no key in SQL; runCommand in TS): the same actors; refused while the beneficiary holds a reserved session
-- of the package (release it first). Locks the package first.
CREATE FUNCTION public.package_beneficiary_remove(p_beneficiary uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['owner','manager','fo_cashier']);
  b public.package_beneficiaries;
  pk public.packages;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO b FROM public.package_beneficiaries x WHERE x.tenant_id = a.tenant_id AND x.id = p_beneficiary;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: beneficiary not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = b.tenant_id AND x.id = b.package_id FOR UPDATE;
  SELECT * INTO b FROM public.package_beneficiaries x WHERE x.tenant_id = a.tenant_id AND x.id = p_beneficiary FOR UPDATE;
  IF b.removed_at IS NOT NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'reserved'
               AND public.patient_canonical(s.tenant_id, s.beneficiary_patient_id) = public.patient_canonical(b.tenant_id, b.patient_id)) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: beneficiary_reserved' USING ERRCODE = '55000';
  END IF;
  UPDATE public.package_beneficiaries SET removed_by = a.staff_id, removed_as = a.role, removed_at = clock_timestamp(), remove_reason = btrim(p_reason)
   WHERE tenant_id = b.tenant_id AND id = b.id;
  PERFORM public.audit_append('settings_change', 'package', pk.id, 'success', 'package_beneficiary_removed');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_beneficiary_remove(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_beneficiary_remove(uuid, text) TO clinic_app;--> statement-breakpoint

-- ── T-082 re-created functions (latest definitions, edits asserted by recreate.py) ──
-- package_open (re-created from 0091): sharing_allowed snapshotted from the template at the sale instant (T-082).
CREATE OR REPLACE FUNCTION public.package_open(i public.invoices, p_staff uuid, p_role text, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  cv public.catalog_versions;
  v_services uuid[] := '{}';
  v_weights bigint[] := '{}';
  v_alloc bigint[];
  v_vat bigint[];
  c record;
  k integer;
  v_price bigint;
  v_set9 jsonb := public.setting_value_at('SET-9', NULL, p_at);
  v_pct integer;
  v_inst boolean;
  v_min bigint;
  v_days integer;
  v_id uuid;
  sv public.catalog_versions;
BEGIN
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id;
  SELECT * INTO cv FROM public.catalog_versions x WHERE x.tenant_id = l.tenant_id AND x.id = l.catalog_version_id;
  FOR c IN SELECT pc.* FROM public.package_contents pc WHERE pc.tenant_id = cv.tenant_id AND pc.package_version_id = cv.id ORDER BY pc.seq LOOP
    v_price := public.catalog_branch_price(c.service_item_id, i.branch_id, p_at);
    IF v_price IS NULL OR v_price < 1 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: package_service_price' USING ERRCODE = '22023';
    END IF;
    FOR k IN 1..c.count LOOP
      v_services := v_services || c.service_item_id;
      v_weights := v_weights || v_price;
    END LOOP;
  END LOOP;
  IF cardinality(v_services) = 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: package_empty' USING ERRCODE = '22023';
  END IF;
  v_alloc := public.package_allocate(l.line_total, v_weights);
  v_vat := CASE WHEN l.vat_amount = 0 THEN array_fill(0::bigint, ARRAY[cardinality(v_alloc)])
                ELSE public.package_allocate(l.vat_amount, (SELECT array_agg(greatest(x, 1) ORDER BY o) FROM unnest(v_alloc) WITH ORDINALITY t(x, o))) END;
  v_pct := coalesce(cv.min_dp_pct, (v_set9 ->> 'dp_minimum')::integer, 0);
  v_inst := cv.installments_allowed OR coalesce((v_set9 ->> 'cicilan')::boolean, true);
  v_min := CASE WHEN NOT v_inst THEN l.line_total ELSE least(l.line_total, greatest(v_alloc[1], (l.line_total * v_pct + 99) / 100, 1)) END;
  v_days := coalesce(cv.validity_days, (public.setting_value_at('SET-8', NULL, p_at) #>> '{}')::integer, 365);
  INSERT INTO public.packages (tenant_id, sold_branch_id, patient_id, invoice_id, invoice_line_id, item_id, catalog_version_id, price, min_dp, validity_end,
                               created_by, created_as, sharing_allowed)
  VALUES (i.tenant_id, i.branch_id, public.patient_canonical(i.tenant_id, i.patient_id), i.id, l.id, l.item_id, l.catalog_version_id, l.line_total, v_min,
          p_at + make_interval(days => v_days), p_staff, p_role,
          public.package_sharing_at(i.tenant_id, l.item_id, p_at)) -- T-082: the template's switch at the sale instant
  RETURNING id INTO v_id;
  FOR k IN 1..cardinality(v_services) LOOP
    SELECT x.* INTO sv FROM public.catalog_versions x WHERE x.tenant_id = i.tenant_id AND x.item_id = v_services[k] AND x.state = 'active';
    INSERT INTO public.package_sessions (tenant_id, package_id, seq, service_item_id, allocated_value, tax_category, tax_basis, vat_base, vat_amount)
    VALUES (i.tenant_id, v_id, k, v_services[k], v_alloc[k], coalesce(sv.tax_category, l.tax_category), coalesce(sv.tax_basis, l.tax_basis),
            v_alloc[k] - least(v_vat[k], v_alloc[k]), least(v_vat[k], v_alloc[k]));
  END LOOP;
  -- The sale is InvoiceIssued (TD-7 has no package-sold event).
  RETURN v_id;
END
$$;--> statement-breakpoint

-- packages_guard (re-created from 0096): sharing_allowed frozen with the sale (T-082).
CREATE OR REPLACE FUNCTION public.packages_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'packages are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'active' OR NEW.moved_to_balance <> 0 OR NEW.vat_reversed_amount <> 0
       OR NOT EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                       WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.invoice_line_id AND i.id = NEW.invoice_id AND i.state = 'issued'
                         AND i.visit_id IS NULL AND NOT i.counter AND NEW.patient_id IN (i.patient_id, public.patient_canonical(i.tenant_id, i.patient_id)) AND i.branch_id = NEW.sold_branch_id
                         AND l.item_id = NEW.item_id AND l.catalog_version_id = NEW.catalog_version_id AND l.line_total = NEW.price AND l.quantity = 1) THEN
      RAISE EXCEPTION 'a package opens active from its invoice line' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.sold_branch_id, NEW.patient_id, NEW.invoice_id, NEW.invoice_line_id, NEW.item_id, NEW.catalog_version_id, NEW.price,
      NEW.min_dp, NEW.validity_end, NEW.created_by, NEW.created_as, NEW.created_at, NEW.sharing_allowed)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.sold_branch_id, OLD.patient_id, OLD.invoice_id, OLD.invoice_line_id, OLD.item_id, OLD.catalog_version_id, OLD.price,
      OLD.min_dp, OLD.validity_end, OLD.created_by, OLD.created_as, OLD.created_at, OLD.sharing_allowed) -- T-082: the sharing snapshot is part of the sale
     OR NEW.moved_to_balance < OLD.moved_to_balance OR NEW.vat_reversed_amount < OLD.vat_reversed_amount
     OR OLD.state <> 'active' AND (NEW.state, NEW.closed_at, NEW.closed_by, NEW.closed_as, NEW.close_reason, NEW.paid_unused_moved, NEW.remainder_cancelled, NEW.moved_to_balance)
        IS DISTINCT FROM (OLD.state, OLD.closed_at, OLD.closed_by, OLD.closed_as, OLD.close_reason, OLD.paid_unused_moved, OLD.remainder_cancelled, OLD.moved_to_balance) THEN
    RAISE EXCEPTION 'a package keeps its sale; it closes once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- package_reserve (re-created from 0091): the owner or an active beneficiary reserves; the treated patient recorded (T-082).
CREATE OR REPLACE FUNCTION public.package_reserve(p_key text, p_package uuid, p_visit uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['fo_cashier','manager']);
  v public.visits;
  pk public.packages;
  s public.package_sessions;
  v_service uuid;
  v_need bigint;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'service_item_id' <> '{}'::jsonb
     OR p ? 'service_item_id' AND coalesce(p ->> 'service_item_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reserve' USING ERRCODE = '22023';
  END IF;
  v_service := (p ->> 'service_item_id')::uuid;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit AND x.branch_id = a.branch_id FOR UPDATE;
  IF NOT FOUND OR v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  pk := public.package_locked(a.tenant_id, p_package);
  -- T-082 (PR-93, DATA-67): the visit's patient is the owner's or an active beneficiary of a sharing package, checked under the
  -- package row lock (package_locked) together with the paid value below, so two beneficiaries never reserve beyond it.
  IF NOT public.package_patient_may_use(pk.tenant_id, pk.id, v.patient_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id ORDER BY x.seq FOR UPDATE;
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id AND x.state = 'available'
     AND (v_service IS NULL OR x.service_item_id = v_service) ORDER BY x.seq LIMIT 1;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'ERR_SESSION_NOT_UNLOCKED: no_session' USING ERRCODE = 'P0422';
  END IF;
  v_need := public.package_taken(pk) + s.allocated_value - public.package_paid(pk);
  IF v_need > 0 THEN
    RAISE EXCEPTION 'ERR_SESSION_NOT_UNLOCKED: need %', v_need USING ERRCODE = 'P0422';
  END IF;
  UPDATE public.package_sessions SET state = 'reserved', reserved_visit_id = v.id, beneficiary_patient_id = public.patient_canonical(v.tenant_id, v.patient_id),
         version = version + 1 WHERE tenant_id = s.tenant_id AND id = s.id;
  PERFORM public.package_sync_vat(pk.tenant_id, pk.id, clock_timestamp());
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (pk.tenant_id, v.branch_id, 'SessionReserved', 'package_session', s.id, a.staff_id, a.role,
          jsonb_build_object('session_id', s.id, 'package_id', pk.id, 'visit_id', v.id));
  PERFORM public.audit_append('settings_change', 'package_session', s.id, 'success', 'session_reserved');
  RETURN jsonb_build_object('session_id', s.id);
END
$$;--> statement-breakpoint

-- package_sessions_guard (re-created from 0091): a beneficiary's reservation; the visit and treated patient frozen while reserved (T-082).
CREATE OR REPLACE FUNCTION public.package_sessions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk public.packages;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'package sessions are never deleted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.package_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'available' OR NEW.vat_recognised_amount <> 0 OR NEW.version <> 0 OR cardinality(NEW.returned_execution_ids) <> 0 OR pk.state IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'a session opens available on an active package' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.package_id, NEW.seq, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.package_id, OLD.seq, OLD.created_at)
     OR OLD.state IN ('redeemed','closed') AND (NEW.state, NEW.service_item_id, NEW.allocated_value, NEW.reserved_visit_id, NEW.reserved_execution_id, NEW.redeemed_at)
        IS DISTINCT FROM (OLD.state, OLD.service_item_id, OLD.allocated_value, OLD.reserved_visit_id, OLD.reserved_execution_id, OLD.redeemed_at)
     OR NOT (NEW.state = OLD.state OR OLD.state = 'available' AND NEW.state IN ('reserved','closed') OR OLD.state = 'reserved' AND NEW.state IN ('available','redeemed','closed'))
     OR NOT (OLD.returned_execution_ids <@ NEW.returned_execution_ids)
     -- T-082 (r1 P1-2): the treated patient is frozen once redeemed or closed, and the visit and patient stay while reserved
     OR OLD.state IN ('redeemed','closed') AND NEW.beneficiary_patient_id IS DISTINCT FROM OLD.beneficiary_patient_id
     OR OLD.state = 'reserved' AND NEW.state IN ('reserved','redeemed')
        AND (NEW.reserved_visit_id, NEW.beneficiary_patient_id) IS DISTINCT FROM (OLD.reserved_visit_id, OLD.beneficiary_patient_id)
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'a session moves available ⇄ reserved → redeemed, or closes with its package' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'reserved' AND OLD.state <> 'reserved' AND (pk.state <> 'active' OR NOT EXISTS (
       SELECT 1 FROM public.visits v WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.reserved_visit_id AND v.closed_at IS NULL
          AND NEW.beneficiary_patient_id = public.patient_canonical(v.tenant_id, v.patient_id) -- T-082: the treated patient
          AND public.package_patient_may_use(pk.tenant_id, pk.id, v.patient_id))) THEN
    RAISE EXCEPTION 'a session is reserved on an open visit of its patient' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'redeemed' AND OLD.state <> 'redeemed' AND NOT EXISTS (
       SELECT 1 FROM public.treatment_executions e WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.reserved_execution_id AND e.state = 'finished' AND e.counted
          AND e.visit_id = NEW.reserved_visit_id) THEN -- T-082: on the reserved visit
    RAISE EXCEPTION 'a session is redeemed by its counted execution' USING ERRCODE = '42501';
  END IF;
  IF (NEW.service_item_id, NEW.allocated_value, NEW.tax_category, NEW.tax_basis) IS DISTINCT FROM (OLD.service_item_id, OLD.allocated_value, OLD.tax_category, OLD.tax_basis)
     AND NOT EXISTS (SELECT 1 FROM public.package_substitutions u WHERE u.tenant_id = NEW.tenant_id AND u.session_id = NEW.id AND u.state = 'approved'
                       AND u.new_service_item_id = NEW.service_item_id AND u.old_service_item_id = OLD.service_item_id) THEN
    RAISE EXCEPTION 'a session changes service only by an approved substitution' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- package_session_back (re-created from 0091): the treated patient cleared with the reservation (T-082).
CREATE OR REPLACE FUNCTION public.package_session_back(s public.package_sessions, p_staff uuid, p_role text, p_branch uuid, p_why text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.package_sessions SET state = 'available', reserved_visit_id = NULL, beneficiary_patient_id = NULL, version = version + 1
   WHERE tenant_id = s.tenant_id AND id = s.id;
  PERFORM public.package_sync_vat(s.tenant_id, s.package_id, clock_timestamp());
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (s.tenant_id, p_branch, 'SessionReleased', 'package_session', s.id, p_staff, p_role,
          jsonb_build_object('session_id', s.id, 'package_id', s.package_id, 'reason', p_why));
END
$$;--> statement-breakpoint

-- package_execution_finish (re-created from 0091): the treated patient cleared on a returned session (T-082).
CREATE OR REPLACE FUNCTION public.package_execution_finish() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s public.package_sessions;
  v_split record;
BEGIN
  IF OLD.state = 'finished' OR NEW.state <> 'finished' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = NEW.tenant_id AND x.reserved_execution_id = NEW.id AND x.state = 'reserved' FOR UPDATE;
  IF s.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM 1 FROM public.packages x WHERE x.tenant_id = s.tenant_id AND x.id = s.package_id FOR UPDATE;
  IF NEW.counted THEN
    UPDATE public.package_sessions SET state = 'redeemed', redeemed_at = NEW.finished_at, redeemed_branch_id = NEW.branch_id, version = version + 1
     WHERE tenant_id = s.tenant_id AND id = s.id;
    IF s.tax_category IN ('taxable_service','taxable_goods') AND s.vat_amount = 0 AND public.tax_pkp_at(NEW.tenant_id, NEW.finished_at, NEW.branch_id)
       AND public.feature_gate_open('vat_on_invoices') THEN
      SELECT * INTO v_split FROM public.tax_vat_split(s.allocated_value, s.tax_category, true);
      UPDATE public.package_sessions SET vat_base = v_split.base, vat_amount = v_split.vat, vat_recognised_amount = v_split.vat,
             vat_recognised_at = CASE WHEN v_split.vat > 0 THEN NEW.finished_at END, version = version + 1
       WHERE tenant_id = s.tenant_id AND id = s.id;
    END IF;
    PERFORM public.package_sync_vat(s.tenant_id, s.package_id, NEW.finished_at);
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (s.tenant_id, NEW.branch_id, 'SessionRedeemed', 'package_session', s.id, NEW.finished_by, NEW.finished_as,
            jsonb_build_object('session_id', s.id, 'package_id', s.package_id, 'execution_id', NEW.id, 'visit_id', NEW.visit_id));
  ELSE
    UPDATE public.package_sessions SET state = 'available', reserved_visit_id = NULL, reserved_execution_id = NULL, beneficiary_patient_id = NULL,
           returned_execution_ids = returned_execution_ids || NEW.id, version = version + 1
     WHERE tenant_id = s.tenant_id AND id = s.id;
    PERFORM public.package_sync_vat(s.tenant_id, s.package_id, NEW.finished_at);
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (s.tenant_id, NEW.branch_id, 'SessionReleased', 'package_session', s.id, NEW.finished_by, NEW.finished_as,
            jsonb_build_object('session_id', s.id, 'package_id', s.package_id, 'execution_id', NEW.id, 'reason', NEW.outcome));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- package_close_do (re-created from 0097): the treated patient cleared on closed sessions (T-082).
CREATE OR REPLACE FUNCTION public.package_close_do(pk public.packages, p_state text, p_reason text, p_staff uuid, p_role text, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_sub_move bigint;
  v_sub_vat bigint;
  l public.invoice_lines;
  v_paid bigint;
  v_redeemed bigint;
  v_unused bigint;
  v_remainder bigint;
  v_redeemed_vat bigint;
  sl record;
  v_sub_paid bigint;
  v_event uuid;
  v_fee public.consultation_fees;
BEGIN
  IF EXISTS (SELECT 1 FROM public.package_sessions s JOIN public.treatment_executions e ON e.tenant_id = s.tenant_id AND e.id = s.reserved_execution_id
              WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'reserved' AND e.state IN ('started','paused')) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: session_in_treatment' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = pk.tenant_id AND x.id = pk.invoice_line_id FOR UPDATE;
  PERFORM 1 FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id ORDER BY x.seq FOR UPDATE;
  PERFORM public.package_sync_vat(pk.tenant_id, pk.id, p_at);
  v_paid := public.package_paid(pk);
  SELECT coalesce(sum(s.allocated_value), 0), coalesce(sum(s.vat_recognised_amount), 0) INTO v_redeemed, v_redeemed_vat
    FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'redeemed';
  v_unused := greatest(0, v_paid - v_redeemed);
  v_remainder := greatest(0, l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id));
  -- Unredeemed sessions' substitution difference lines: unpaid remainder cancelled, real money paid moved with the rest.
  v_sub_paid := 0;
  FOR sl IN SELECT x.* FROM public.invoice_lines x JOIN public.package_substitutions u ON u.tenant_id = x.tenant_id AND u.id = x.substitution_id
              JOIN public.package_sessions s ON s.tenant_id = u.tenant_id AND s.id = u.session_id
              JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
             WHERE u.tenant_id = pk.tenant_id AND u.package_id = pk.id AND s.state <> 'redeemed' AND i.state = 'issued' ORDER BY x.id FOR UPDATE OF x LOOP
    -- T-078 (r1 #4): only the value not already moved (a refund) nor reserved by a pending cash refund; VAT in proportion.
    v_sub_move := greatest(0, public.kasir_line_paid(sl.tenant_id, sl.id) - sl.moved_to_balance - public.refund_reserved(sl.tenant_id, sl.id));
    v_sub_vat := least(sl.vat_recognised_amount - sl.vat_reversed_amount,
                       CASE WHEN sl.line_total = 0 THEN 0 ELSE (sl.vat_recognised_amount * v_sub_move) / sl.line_total END);
    UPDATE public.invoice_lines SET cancelled_amount = greatest(0, sl.line_total - public.kasir_line_paid(sl.tenant_id, sl.id)),
           moved_to_balance = sl.moved_to_balance + v_sub_move,
           vat_reversed_amount = sl.vat_reversed_amount + v_sub_vat,
           vat_reversed_at = CASE WHEN sl.vat_reversed_amount + v_sub_vat > 0 THEN coalesce(sl.vat_reversed_at, p_at) END
     WHERE tenant_id = sl.tenant_id AND id = sl.id;
    v_sub_paid := v_sub_paid + v_sub_move;
  END LOOP;
  UPDATE public.package_sessions SET state = 'closed', reserved_visit_id = NULL, reserved_execution_id = NULL, beneficiary_patient_id = NULL, version = version + 1
   WHERE tenant_id = pk.tenant_id AND package_id = pk.id AND state IN ('available','reserved');
  IF v_remainder > 0 THEN
    UPDATE public.invoice_lines SET cancelled_amount = v_remainder WHERE tenant_id = l.tenant_id AND id = l.id;
  END IF;
  -- T-081 (BILL-36, r1 P1-2): nothing paid → the line is removed (released; a void has already released its uses as void before
  -- calling here, so the release below is then a no-op); paid → settled
  -- (consumed), and an unredeemed paid package cancelled is the purchase refunded in full (released).
  IF public.kasir_line_paid(l.tenant_id, l.id) = 0 THEN
    PERFORM public.promo_release(l.tenant_id, l.id, 'reserved', 'removed');
  ELSE
    PERFORM public.promo_usage_sync(l.tenant_id, l.id);
    IF p_state = 'cancelled' AND p_reason IS DISTINCT FROM 'invoice_void' AND v_redeemed = 0 THEN
      PERFORM public.promo_release(l.tenant_id, l.id, 'consumed', 'refunded_full');
    END IF;
  END IF;
  UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = pk.tenant_id AND invoice_id = pk.invoice_id AND state = 'pending';
  UPDATE public.packages SET state = p_state, closed_at = p_at, closed_by = p_staff, closed_as = p_role, close_reason = p_reason,
         paid_unused_moved = v_unused + v_sub_paid, remainder_cancelled = v_remainder,
         vat_reversed_amount = greatest(vat_reversed_amount, l.vat_recognised_amount - v_redeemed_vat),
         vat_reversed_at = CASE WHEN greatest(vat_reversed_amount, l.vat_recognised_amount - v_redeemed_vat) > 0 THEN coalesce(vat_reversed_at, p_at) END
   WHERE tenant_id = pk.tenant_id AND id = pk.id;
  IF v_unused + v_sub_paid > 0 THEN
    PERFORM public.balance_post(pk.tenant_id, pk.patient_id, pk.sold_branch_id, CASE WHEN p_state = 'expired' THEN 'from_expiry' ELSE 'from_cancel' END,
                                v_unused + v_sub_paid, jsonb_build_object('source_kind', 'package', 'source_id', pk.id), 'package_close:' || pk.id::text, p_staff, p_role);
  END IF;
  -- T-079 (PR-12, r1 P1-2): a package cancelled (not by an invoice void) with nothing redeemed is a refund of the purchase.
  IF p_state = 'cancelled' AND p_reason IS DISTINCT FROM 'invoice_void' AND v_redeemed = 0 THEN
    PERFORM public.consultation_controls_cancel(pk.tenant_id, pk.invoice_line_id, NULL);
    v_fee := public.consultation_recharge_due(pk.tenant_id, pk.invoice_line_id, NULL);
    IF v_fee.id IS NOT NULL THEN
      PERFORM 1 FROM public.visits x WHERE x.tenant_id = v_fee.tenant_id AND x.id = v_fee.visit_id FOR UPDATE;
      PERFORM public.consultation_recharge(v_fee, 'package', pk.id, v_unused + v_sub_paid, p_staff, p_role);
    END IF;
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (pk.tenant_id, pk.sold_branch_id, CASE WHEN p_state = 'expired' THEN 'PackageExpired' ELSE 'PackageCancelled' END, 'package', pk.id, p_staff, p_role,
          jsonb_build_object('package_id', pk.id, 'patient_id', pk.patient_id))
  RETURNING id INTO v_event;
  RETURN jsonb_build_object('package_id', pk.id, 'state', p_state, 'to_balance', v_unused + v_sub_paid, 'cancelled', v_remainder);
END
$$;--> statement-breakpoint

-- package_row (re-created from 0091): sharing, beneficiaries and the treated patient per session (T-082).
CREATE OR REPLACE FUNCTION public.package_row(pk public.packages) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', pk.id, 'name', cv.name, 'price', pk.price, 'paid', public.package_paid(pk), 'min_dp', pk.min_dp,
    'state', pk.state, 'validity_end', pk.validity_end, 'invoice_id', pk.invoice_id, 'invoice_number', i.number,
    'outstanding', public.kasir_outstanding(pk.tenant_id, pk.invoice_id),
    'sold_branch', jsonb_build_object('id', b.id, 'name', b.name),
    'redeemed', (SELECT count(*) FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'redeemed'),
    'reserved', (SELECT count(*) FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'reserved'),
    'unlocked_value', greatest(0, public.package_paid(pk) - public.package_taken(pk)),
    'next_need', (SELECT greatest(0, public.package_taken(pk) + s.allocated_value - public.package_paid(pk)) FROM public.package_sessions s
                   WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'available' ORDER BY s.seq LIMIT 1),
    'paid_unused_moved', pk.paid_unused_moved, 'remainder_cancelled', pk.remainder_cancelled,
    -- T-082 (PR-93, 17:198): the sharing snapshot, the active beneficiaries (masked for the auditor, IAM-12) and who may add one
    'sharing_allowed', pk.sharing_allowed,
    'can_share', pk.sharing_allowed AND pk.state = 'active' AND public.app_acting_role() IN ('owner','manager','fo_cashier'),
    'beneficiaries', coalesce((SELECT jsonb_agg(jsonb_build_object('id', bn.id, 'patient', public.kasir_patient_json(bn.tenant_id, bn.patient_id, public.app_acting_role() = 'auditor'),
                                'granted_at', bn.granted_at) ORDER BY bn.granted_at, bn.id)
                                FROM public.package_beneficiaries bn WHERE bn.tenant_id = pk.tenant_id AND bn.package_id = pk.id AND bn.removed_at IS NULL
                                 AND public.patient_canonical(bn.tenant_id, bn.patient_id) <> public.patient_canonical(pk.tenant_id, pk.patient_id)), '[]'::jsonb),
    'sessions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'service_item_id', s.service_item_id, 'service', sv.name,
                          'value', s.allocated_value, 'state', s.state, 'visit_id', s.reserved_visit_id, 'redeemed_at', s.redeemed_at,
                          'patient', public.kasir_patient_json(s.tenant_id, s.beneficiary_patient_id, public.app_acting_role() = 'auditor'), -- T-082: who redeemed
                          'redeemed_branch', (SELECT bb.name FROM public.branches bb WHERE bb.tenant_id = s.tenant_id AND bb.id = s.redeemed_branch_id),
                          'pending_substitution', EXISTS (SELECT 1 FROM public.package_substitutions u WHERE u.tenant_id = s.tenant_id AND u.session_id = s.id AND u.state = 'pending'))
                          ORDER BY s.seq)
                          FROM public.package_sessions s
                          LEFT JOIN public.catalog_versions sv ON sv.tenant_id = s.tenant_id AND sv.item_id = s.service_item_id AND sv.state = 'active'
                         WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id), '[]'::jsonb))
    FROM public.catalog_versions cv, public.invoices i, public.branches b
   WHERE cv.tenant_id = pk.tenant_id AND cv.id = pk.catalog_version_id AND i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id
     AND b.tenant_id = pk.tenant_id AND b.id = pk.sold_branch_id
$$;--> statement-breakpoint

-- package_patient_get (re-created from 0091): shared_packages for a beneficiary (T-082).
CREATE OR REPLACE FUNCTION public.package_patient_get(p_patient uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  v_patient uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.patients x WHERE x.tenant_id = a.tenant_id AND x.id = p_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  v_patient := public.patient_canonical(a.tenant_id, p_patient);
  RETURN jsonb_build_object('patient', public.kasir_patient_json(a.tenant_id, v_patient, a.role = 'auditor'), 'role', a.role,
    'can_reserve', a.role IN ('fo_cashier','manager'), 'can_cancel', a.role IN ('owner','manager'), 'can_top_up', a.role IN ('owner','manager','fo_cashier','finance'),
    'balance', public.balance_of(a.tenant_id, v_patient),
    'packages', coalesce((SELECT jsonb_agg(public.package_row(pk) ORDER BY (pk.state = 'active') DESC, pk.created_at DESC)
                            FROM public.packages pk WHERE pk.tenant_id = a.tenant_id AND pk.patient_id = ANY (public.patient_cluster(a.tenant_id, v_patient))), '[]'::jsonb),
    -- T-082 (r1 P1-3): packages shared with this patient — a beneficiary projection: no invoice or billing fields, no other
    -- beneficiaries, the owner masked for the auditor, a session's visit and patient only for this patient's own reservations.
    'shared_packages', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pk.id, 'name', cv.name, 'state', pk.state, 'validity_end', pk.validity_end,
        'sold_branch', jsonb_build_object('id', b.id, 'name', b.name),
        'shared_from', public.kasir_patient_json(pk.tenant_id, pk.patient_id, a.role = 'auditor'),
        'redeemed', (SELECT count(*) FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'redeemed'),
        'reserved', (SELECT count(*) FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'reserved'),
        'unlocked_value', greatest(0, public.package_paid(pk) - public.package_taken(pk)),
        'next_need', (SELECT greatest(0, public.package_taken(pk) + s.allocated_value - public.package_paid(pk)) FROM public.package_sessions s
                       WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'available' ORDER BY s.seq LIMIT 1),
        'can_reserve', a.role IN ('fo_cashier','manager'), 'can_cancel', false, 'can_share', false,
        'sessions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'service_item_id', s.service_item_id, 'service', sv.name, 'state', s.state,
                               'visit_id', CASE WHEN s.beneficiary_patient_id = ANY (public.patient_cluster(a.tenant_id, v_patient)) THEN s.reserved_visit_id END,
                               'mine', coalesce(s.beneficiary_patient_id = ANY (public.patient_cluster(a.tenant_id, v_patient)), false)) ORDER BY s.seq)
                               FROM public.package_sessions s
                               LEFT JOIN public.catalog_versions sv ON sv.tenant_id = s.tenant_id AND sv.item_id = s.service_item_id AND sv.state = 'active'
                              WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id), '[]'::jsonb))
        ORDER BY pk.created_at DESC)
        FROM public.packages pk
        JOIN public.catalog_versions cv ON cv.tenant_id = pk.tenant_id AND cv.id = pk.catalog_version_id
        JOIN public.branches b ON b.tenant_id = pk.tenant_id AND b.id = pk.sold_branch_id
       WHERE pk.tenant_id = a.tenant_id AND pk.state = 'active' AND pk.sharing_allowed
         AND public.package_beneficiary_active(a.tenant_id, pk.id, v_patient)), '[]'::jsonb),
    'visits', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'checked_in_at', v.checked_in_at) ORDER BY v.checked_in_at DESC)
                          FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.closed_at IS NULL AND v.branch_id = a.branch_id
                           AND v.patient_id = ANY (public.patient_cluster(a.tenant_id, v_patient))), '[]'::jsonb));
END
$$;
