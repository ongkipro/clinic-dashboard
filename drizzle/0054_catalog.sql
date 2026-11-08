CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "catalog_items_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "catalog_items_kind_check" CHECK ("catalog_items"."kind" in ('service','product','package','material')),
	CONSTRAINT "catalog_items_code_check" CHECK ("catalog_items"."code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$')
);
--> statement-breakpoint
CREATE TABLE "catalog_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" text NOT NULL,
	"name" text NOT NULL,
	"tax_category" text NOT NULL,
	"tax_basis" text NOT NULL,
	"normal_price" bigint NOT NULL,
	"control_count" integer DEFAULT 0 NOT NULL,
	"control_validity_days" integer,
	"booking_dp_enabled" boolean DEFAULT false NOT NULL,
	"booking_dp_amount" bigint,
	"min_dp_pct" integer,
	"installments_allowed" boolean DEFAULT false NOT NULL,
	"validity_days" integer,
	"material_formula" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commission_scope" text[] DEFAULT '{}'::text[] NOT NULL,
	"indications" text,
	"contraindications" text,
	"consent_template" text,
	"delegation" text,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approval_id" uuid,
	"decided_at" timestamp with time zone,
	"referenced_at" timestamp with time zone,
	CONSTRAINT "catalog_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "catalog_versions_item_version_key" UNIQUE("tenant_id","item_id","version"),
	CONSTRAINT "catalog_versions_state_check" CHECK ("catalog_versions"."state" in ('active','superseded','pending_review','rejected','cancelled')),
	CONSTRAINT "catalog_versions_version_check" CHECK ("catalog_versions"."version" >= 1),
	CONSTRAINT "catalog_versions_name_check" CHECK (length(btrim("catalog_versions"."name")) between 2 and 120),
	CONSTRAINT "catalog_versions_tax_check" CHECK ("catalog_versions"."tax_category" in ('exempt_medical','taxable_service','taxable_goods','non_object') and length(btrim("catalog_versions"."tax_basis")) between 3 and 300),
	CONSTRAINT "catalog_versions_price_check" CHECK ("catalog_versions"."normal_price" >= 0 and "catalog_versions"."normal_price" <= 1000000000000),
	CONSTRAINT "catalog_versions_control_check" CHECK ("catalog_versions"."control_count" between 0 and 20 and ("catalog_versions"."control_validity_days" is null or "catalog_versions"."control_validity_days" between 1 and 365) and ("catalog_versions"."control_count" = 0) = ("catalog_versions"."control_validity_days" is null)),
	CONSTRAINT "catalog_versions_dp_check" CHECK (("catalog_versions"."booking_dp_enabled" = ("catalog_versions"."booking_dp_amount" is not null)) and ("catalog_versions"."booking_dp_amount" is null or "catalog_versions"."booking_dp_amount" between 1 and "catalog_versions"."normal_price")),
	CONSTRAINT "catalog_versions_min_dp_check" CHECK ("catalog_versions"."min_dp_pct" is null or "catalog_versions"."min_dp_pct" between 0 and 100),
	CONSTRAINT "catalog_versions_validity_check" CHECK ("catalog_versions"."validity_days" is null or "catalog_versions"."validity_days" between 30 and 1095),
	CONSTRAINT "catalog_versions_formula_check" CHECK (jsonb_typeof("catalog_versions"."material_formula") = 'array'),
	CONSTRAINT "catalog_versions_commission_check" CHECK ("catalog_versions"."commission_scope" <@ array['guiding_bc','closing_bc','new_patient','performer']::text[]),
	CONSTRAINT "catalog_versions_clinical_check" CHECK (coalesce(length("catalog_versions"."indications"), 0) <= 4000 and coalesce(length("catalog_versions"."contraindications"), 0) <= 4000 and coalesce(length("catalog_versions"."consent_template"), 0) <= 20000 and coalesce(length("catalog_versions"."delegation"), 0) <= 2000),
	CONSTRAINT "catalog_versions_reason_check" CHECK (length(btrim("catalog_versions"."reason")) between 3 and 500),
	CONSTRAINT "catalog_versions_review_check" CHECK (("catalog_versions"."state" in ('pending_review','rejected','cancelled')) <= ("catalog_versions"."approval_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_tenant_id_approval_id_approvals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_versions_one_active" ON "catalog_versions" USING btree ("tenant_id","item_id") WHERE "catalog_versions"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_versions_one_pending" ON "catalog_versions" USING btree ("tenant_id","item_id") WHERE "catalog_versions"."state" = 'pending_review';--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_versions_one_per_approval" ON "catalog_versions" USING btree ("tenant_id","approval_id") WHERE "catalog_versions"."approval_id" is not null;--> statement-breakpoint
CREATE INDEX "catalog_versions_item_idx" ON "catalog_versions" USING btree ("tenant_id","item_id","version");;--> statement-breakpoint

-- T-033 rules (generated; see header)
-- T-033 (PR-41, DATA-15, CLIN-011; owner decisions DEC-046): versioned catalog with the clinical
-- review gate. Tenant-shared tables; writes only through the catalog_* functions below.

-- ── Readers (DEC-046 (2)) ───────────────────────────────────────────────────────────────
-- Items: every member (codes and kinds are not clinical). Versions (all columns, incl. clinical
-- content): the editors, the clinical reviewer and the clinical roles that use it in treatment;
-- unpublished versions (pending, rejected, cancelled) only to editors and facility heads. Every
-- other member reads active commercial fields through catalog_commercial().
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalog_items_read ON public.catalog_items FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.catalog_items TO clinic_app;--> statement-breakpoint
ALTER TABLE public.catalog_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalog_versions_read ON public.catalog_versions FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (state IN ('active','superseded') AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','doctor','nurse','therapist','pharmacist'])
              OR public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])));--> statement-breakpoint
GRANT SELECT ON public.catalog_versions TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.catalog_items', 'tenant-shared', 'catalog', '{*}', 'catalog functions (src/modules/catalog)', 'none'),
  ('public.catalog_versions', 'tenant-shared', 'catalog', '{owner,admin_pusat,manager,facility_head,doctor,nurse,therapist,pharmacist}', 'catalog functions (src/modules/catalog)', 'none');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19; full-suite coverage gate tests/vendor/support.test.ts): every
-- tenant table has an operator class and exactly one operator read policy. Items (kind and code) are
-- configuration; versions carry clinical content (indications, contraindications, consent template,
-- delegation; DEC-046 (2)), so a session reading them needs the Owner's approval first (T-026).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.catalog_items', 'config'),
  ('public.catalog_versions', 'clinical');--> statement-breakpoint
CREATE POLICY catalog_items_operator_read ON public.catalog_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.catalog_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.catalog_items TO clinic_operator;--> statement-breakpoint
CREATE POLICY catalog_versions_operator_read ON public.catalog_versions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.catalog_versions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.catalog_versions TO clinic_operator;--> statement-breakpoint

-- The commercial projection of active versions for every member (cashier, CS, finance, ...): no
-- clinical column (DEC-046 (2), IAM-12).
CREATE FUNCTION public.catalog_commercial() RETURNS TABLE (item_id uuid, version_id uuid, version integer, kind text, code text, name text,
    tax_category text, tax_basis text, normal_price bigint, control_count integer, control_validity_days integer, booking_dp_enabled boolean,
    booking_dp_amount bigint, min_dp_pct integer, installments_allowed boolean, validity_days integer, commission_scope text[], pending_review boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.id, v.id, v.version, i.kind, i.code, v.name, v.tax_category, v.tax_basis, v.normal_price, v.control_count, v.control_validity_days,
         v.booking_dp_enabled, v.booking_dp_amount, v.min_dp_pct, v.installments_allowed, v.validity_days, v.commission_scope,
         EXISTS (SELECT 1 FROM public.catalog_versions p WHERE p.tenant_id = i.tenant_id AND p.item_id = i.id AND p.state = 'pending_review')
    FROM public.catalog_items i
    JOIN public.catalog_versions v ON v.tenant_id = i.tenant_id AND v.item_id = i.id AND v.state = 'active'
   WHERE i.tenant_id = public.app_tenant_id() AND public.app_staff_id() IS NOT NULL
   ORDER BY v.name, i.code
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_commercial() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_commercial() TO clinic_app;--> statement-breakpoint

-- Review round 1 (P2): items with no active version yet (a first version waiting for review, or a first
-- version rejected or withdrawn) for editors and facility heads only: name, code, kind, the latest
-- version's state. Not sellable; no commercial or clinical fields.
CREATE FUNCTION public.catalog_unpublished() RETURNS TABLE (item_id uuid, kind text, code text, name text, version_id uuid, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.id, i.kind, i.code, v.name, v.id, v.state
    FROM public.catalog_items i
    JOIN LATERAL (SELECT * FROM public.catalog_versions x WHERE x.tenant_id = i.tenant_id AND x.item_id = i.id ORDER BY x.version DESC LIMIT 1) v ON true
   WHERE i.tenant_id = public.app_tenant_id() AND public.app_staff_id() IS NOT NULL
     AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
     AND NOT EXISTS (SELECT 1 FROM public.catalog_versions a WHERE a.tenant_id = i.tenant_id AND a.item_id = i.id AND a.state = 'active')
   ORDER BY v.name, i.code
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_unpublished() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_unpublished() TO clinic_app;--> statement-breakpoint

-- Review round 1 (P1): the catalog version a catalog_clinical_review approval decides, for the
-- Persetujuan detail (item, name, code, version, proposed and active clinical fields). Readable by the
-- roles that read the approval and the unpublished version (editors, facility heads).
CREATE FUNCTION public.catalog_review_target(p_approval uuid) RETURNS TABLE (item_id uuid, code text, name text, version integer, state text,
    indications text, contraindications text, consent_template text, delegation text,
    has_active boolean, active_indications text, active_contraindications text, active_consent_template text, active_delegation text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.id, i.code, v.name, v.version, v.state, v.indications, v.contraindications, v.consent_template, v.delegation,
         a.id IS NOT NULL, a.indications, a.contraindications, a.consent_template, a.delegation
    FROM public.approvals ap
    JOIN public.catalog_versions v ON v.tenant_id = ap.tenant_id AND v.approval_id = ap.id
    JOIN public.catalog_items i ON i.tenant_id = v.tenant_id AND i.id = v.item_id
    LEFT JOIN public.catalog_versions a ON a.tenant_id = v.tenant_id AND a.item_id = v.item_id AND a.state = 'active'
   WHERE ap.tenant_id = public.app_tenant_id() AND ap.id = p_approval AND ap.type = 'catalog_clinical_review'
     AND public.app_staff_id() IS NOT NULL AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_review_target(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_review_target(uuid) TO clinic_app;--> statement-breakpoint

-- ── Guards (CLIN-011) ───────────────────────────────────────────────────────────────────
-- Items keep kind and code and are never deleted. A version's content is fixed when written;
-- only these transitions exist: active -> superseded; pending_review -> active | rejected |
-- cancelled; referenced_at set once. Nothing is deleted.
CREATE FUNCTION public.catalog_items_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'catalog items are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.kind, NEW.code, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.kind, OLD.code, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a catalog item keeps its kind and code' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_items_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER catalog_items_guard BEFORE UPDATE OR DELETE ON public.catalog_items FOR EACH ROW EXECUTE FUNCTION public.catalog_items_guard();--> statement-breakpoint
ALTER TABLE public.catalog_items ENABLE ALWAYS TRIGGER catalog_items_guard;--> statement-breakpoint
CREATE TRIGGER catalog_items_no_truncate BEFORE TRUNCATE ON public.catalog_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

CREATE FUNCTION public.catalog_versions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'catalog versions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('active','pending_review') OR NEW.decided_at IS NOT NULL OR NEW.referenced_at IS NOT NULL
       OR (NEW.state = 'pending_review') <> (NEW.approval_id IS NOT NULL) THEN
      RAISE EXCEPTION 'a catalog version starts active, or pending review with its approval' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- Content and identity never change (every column but state, decided_at, referenced_at).
  IF (to_jsonb(NEW) - ARRAY['state','decided_at','referenced_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','decided_at','referenced_at']) THEN
    RAISE EXCEPTION 'a catalog version is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.referenced_at IS DISTINCT FROM OLD.referenced_at AND (OLD.referenced_at IS NOT NULL OR NEW.referenced_at IS NULL) THEN
    RAISE EXCEPTION 'a catalog version is referenced once' USING ERRCODE = '42501';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       OLD.state = 'active' AND NEW.state = 'superseded'
    OR OLD.state = 'pending_review' AND NEW.state IN ('active','rejected','cancelled') AND NEW.decided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'catalog version state % cannot become %', OLD.state, NEW.state USING ERRCODE = '42501';
  END IF;
  IF NEW.decided_at IS DISTINCT FROM OLD.decided_at AND NOT (OLD.state = 'pending_review' AND NEW.state <> 'pending_review') THEN
    RAISE EXCEPTION 'a catalog version decision is recorded once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_versions_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER catalog_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.catalog_versions FOR EACH ROW EXECUTE FUNCTION public.catalog_versions_guard();--> statement-breakpoint
ALTER TABLE public.catalog_versions ENABLE ALWAYS TRIGGER catalog_versions_guard;--> statement-breakpoint
CREATE TRIGGER catalog_versions_no_truncate BEFORE TRUNCATE ON public.catalog_versions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- ── Approval type (DEC-046 (1)) ─────────────────────────────────────────────────────────
INSERT INTO public.approval_types (key, label, requester_roles, approver_roles, owner_self) VALUES
  ('catalog_clinical_review', 'Review klinis katalog', '{owner,admin_pusat,manager}', '{facility_head,owner}', false);--> statement-breakpoint

-- ── Publishing ──────────────────────────────────────────────────────────────────────────
-- Normalised clinical text: trimmed; empty is null (clearing a field is a change).
CREATE FUNCTION public.catalog_norm(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NULLIF(btrim(p), '')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_norm(text) FROM PUBLIC;--> statement-breakpoint

-- catalog_publish: Owner, Admin Pusat or Manager publish a new version of an item (p_item) or a new
-- item (p_item null: p_kind and p_code). Under staff_access (tenant_actor_lock), then the item row.
-- Refused while the item has a version awaiting clinical review (DEC-046 (3)). No clinical change
-- (the four clinical fields equal the active version's, normalised; a new item has none) -> active at
-- once, the previous active superseded. Otherwise pending_review with a catalog_clinical_review
-- approval (tenant-wide: branch null); the previous version stays active (PR-41).
-- Returns {"item_id","version_id","version","state","approval_id"}.
CREATE FUNCTION public.catalog_publish(p_item uuid, p_kind text, p_code text, p_fields jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_item uuid := p_item;
  cur public.catalog_versions;
  v_formula jsonb;
  v_next integer;
  v_clinical boolean;
  v_id uuid := public.uuid_generate_v7();
  v_approval uuid;
  v_state text;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','manager']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not publish catalog versions' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(f) <> 'object' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: fields must be an object' USING ERRCODE = '22023';
  END IF;
  IF v_item IS NULL THEN
    IF p_kind IS NULL OR p_code IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: a new item needs a kind and a code' USING ERRCODE = '22023';
    END IF;
    BEGIN
      INSERT INTO public.catalog_items (tenant_id, kind, code, created_by) VALUES (a.tenant_id, p_kind, upper(btrim(p_code)), a.staff_id)
      RETURNING id INTO v_item;
    EXCEPTION
      WHEN unique_violation THEN RAISE EXCEPTION 'ERR_VERSION_CONFLICT: code already used' USING ERRCODE = '23505';
      WHEN check_violation THEN RAISE EXCEPTION 'ERR_INVALID_INPUT: kind or code not allowed' USING ERRCODE = '22023';
    END;
  ELSE
    PERFORM 1 FROM public.catalog_items WHERE tenant_id = a.tenant_id AND id = v_item FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: catalog item not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND item_id = v_item AND state = 'pending_review') THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: catalog_review_pending' USING ERRCODE = '55000';
    END IF;
  END IF;
  SELECT * INTO cur FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND item_id = v_item AND state = 'active';
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND item_id = v_item;
  -- Review rounds 1-2 (P1): an omitted material formula keeps the active version's, or, with no active
  -- version (a first version rejected or withdrawn, corrected from the latest one), the latest version's;
  -- an explicit [] clears it. This is not the clinical baseline (that stays the active version only).
  v_formula := CASE WHEN f ? 'material_formula' THEN f -> 'material_formula'
                    ELSE coalesce(cur.material_formula,
                                  (SELECT x.material_formula FROM public.catalog_versions x WHERE x.tenant_id = a.tenant_id AND x.item_id = v_item
                                    ORDER BY x.version DESC LIMIT 1),
                                  '[]'::jsonb) END;
  v_clinical := (public.catalog_norm(f ->> 'indications'), public.catalog_norm(f ->> 'contraindications'),
                 public.catalog_norm(f ->> 'consent_template'), public.catalog_norm(f ->> 'delegation'))
                IS DISTINCT FROM
                (public.catalog_norm(cur.indications), public.catalog_norm(cur.contraindications),
                 public.catalog_norm(cur.consent_template), public.catalog_norm(cur.delegation));
  IF v_clinical THEN
    -- The approval names the version that will exist (same transaction); tenant-wide review.
    v_approval := public.approval_request('catalog_clinical_review', 'catalog_version', v_id, p_reason, NULL, NULL);
    v_state := 'pending_review';
  ELSE
    v_state := 'active';
    IF cur.id IS NOT NULL THEN
      UPDATE public.catalog_versions SET state = 'superseded' WHERE tenant_id = a.tenant_id AND id = cur.id;
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.catalog_versions (id, tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, control_count,
        control_validity_days, booking_dp_enabled, booking_dp_amount, min_dp_pct, installments_allowed, validity_days, material_formula,
        commission_scope, indications, contraindications, consent_template, delegation, reason, created_by, created_as, approval_id)
    VALUES (v_id, a.tenant_id, v_item, v_next, v_state, btrim(f ->> 'name'), f ->> 'tax_category', btrim(f ->> 'tax_basis'),
        (f ->> 'normal_price')::bigint, coalesce((f ->> 'control_count')::integer, 0), (f ->> 'control_validity_days')::integer,
        coalesce((f ->> 'booking_dp_enabled')::boolean, false), (f ->> 'booking_dp_amount')::bigint, (f ->> 'min_dp_pct')::integer,
        coalesce((f ->> 'installments_allowed')::boolean, false), (f ->> 'validity_days')::integer,
        v_formula,
        coalesce(ARRAY(SELECT jsonb_array_elements_text(f -> 'commission_scope')), '{}'::text[]),
        public.catalog_norm(f ->> 'indications'), public.catalog_norm(f ->> 'contraindications'),
        public.catalog_norm(f ->> 'consent_template'), public.catalog_norm(f ->> 'delegation'),
        btrim(coalesce(p_reason, '')), a.staff_id, a.role, v_approval);
  EXCEPTION
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: %', SQLERRM USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'catalog_version', v_id, 'success',
          CASE WHEN v_clinical THEN 'catalog_review_requested' ELSE 'catalog_version_published' END);
  IF NOT v_clinical THEN
    INSERT INTO public.domain_events (type, aggregate_kind, aggregate_id, payload)
    VALUES ('CatalogVersionPublished', 'catalog_version', v_id, jsonb_build_object('item_id', v_item));
  END IF;
  RETURN jsonb_build_object('item_id', v_item, 'version_id', v_id, 'version', v_next, 'state', v_state, 'approval_id', v_approval);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_publish(uuid, text, text, jsonb, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_publish(uuid, text, text, jsonb, text) TO clinic_app;--> statement-breakpoint

-- Every path that moves a catalog_clinical_review approval out of pending (approval_decide from
-- Persetujuan, approval_cancel by the requester, a later engine expiry) moves its version in the same
-- transaction: approved -> active (the previous active superseded), rejected, cancelled.
CREATE FUNCTION public.catalog_review_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ver public.catalog_versions;
BEGIN
  IF NEW.type <> 'catalog_clinical_review' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO ver FROM public.catalog_versions WHERE tenant_id = NEW.tenant_id AND approval_id = NEW.id AND state = 'pending_review' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NEW.state = 'approved' THEN
    UPDATE public.catalog_versions SET state = 'superseded'
     WHERE tenant_id = NEW.tenant_id AND item_id = ver.item_id AND state = 'active';
    UPDATE public.catalog_versions SET state = 'active', decided_at = clock_timestamp() WHERE tenant_id = NEW.tenant_id AND id = ver.id;
    INSERT INTO public.domain_events (tenant_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (NEW.tenant_id, 'CatalogVersionPublished', 'catalog_version', ver.id, jsonb_build_object('item_id', ver.item_id));
  ELSIF NEW.state IN ('rejected','cancelled') THEN
    UPDATE public.catalog_versions SET state = NEW.state, decided_at = clock_timestamp() WHERE tenant_id = NEW.tenant_id AND id = ver.id;
  ELSE
    RETURN NULL; -- a future approval state is handled when it is introduced
  END IF;
  IF public.app_staff_id() IS NOT NULL THEN
    PERFORM public.audit_append('settings_change', 'catalog_version', ver.id, 'success',
            CASE NEW.state WHEN 'approved' THEN 'catalog_review_approved' WHEN 'rejected' THEN 'catalog_review_rejected' ELSE 'catalog_review_cancelled' END);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_review_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_catalog_review_sync AFTER UPDATE OF state ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.catalog_review_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_catalog_review_sync;--> statement-breakpoint

-- Later sale, package and booking writers mark the version they use, once (CLIN-011).
CREATE FUNCTION public.catalog_version_reference(p_version uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.catalog_versions SET referenced_at = clock_timestamp()
   WHERE tenant_id = public.app_tenant_id() AND id = p_version AND state IN ('active','superseded') AND referenced_at IS NULL;
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.catalog_versions WHERE tenant_id = public.app_tenant_id() AND id = p_version AND referenced_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: catalog version not found or not published' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_version_reference(uuid) FROM PUBLIC;--> statement-breakpoint
-- Called by the cashier, package and booking writers (later tasks) in the caller's tenant context.
GRANT EXECUTE ON FUNCTION public.catalog_version_reference(uuid) TO clinic_app;--> statement-breakpoint
-- approval_is_tenant_setting_draft: also a catalog clinical review (DEC-046 (1))
CREATE OR REPLACE FUNCTION public.approval_is_tenant_setting_draft(p_tenant uuid, p_approval uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT p_tenant = public.app_tenant_id() AND (EXISTS (SELECT 1 FROM public.approvals ap
                   JOIN public.setting_versions v ON v.tenant_id = ap.tenant_id AND v.id = ap.subject_id
                  WHERE ap.tenant_id = p_tenant AND ap.id = p_approval AND ap.type = 'setting_change_fh'
                    AND ap.subject_kind = 'setting_version' AND v.branch_id IS NULL)
    -- T-033 (DEC-046 (1)): a catalog clinical review is tenant-wide like a tenant clinical draft.
    OR EXISTS (SELECT 1 FROM public.approvals ap
                WHERE ap.tenant_id = p_tenant AND ap.id = p_approval AND ap.type = 'catalog_clinical_review'))
$function$
;--> statement-breakpoint
-- approval_decide: the owner is the fallback for the catalog clinical review too (DEC-046 (1))
CREATE OR REPLACE FUNCTION public.approval_decide(p_approval uuid, p_approve boolean, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  ap public.approvals;
  t public.approval_types;
  v_tenant_draft boolean;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  SELECT * INTO ap FROM public.approvals WHERE tenant_id = a.tenant_id AND id = p_approval FOR UPDATE;
  v_tenant_draft := FOUND AND public.approval_is_tenant_setting_draft(a.tenant_id, p_approval);
  -- What the caller cannot read (approvals_read) does not exist for it: no state, no
  -- existence leak (TD-51). A tenant-scope clinical draft is readable by every facility head.
  IF NOT FOUND OR NOT (a.role = 'owner'
                       OR a.role IN ('manager','facility_head','records_officer') AND public.app_branch_allowed(ap.branch_id)
                       OR a.role = 'facility_head' AND v_tenant_draft
                       OR ap.requested_by = a.staff_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: approval not found' USING ERRCODE = 'P0002';
  END IF;
  IF ap.requested_by = a.staff_id THEN
    RAISE EXCEPTION 'ERR_APPROVER_IS_REQUESTER: the requester cannot decide their own request' USING ERRCODE = 'P0422';
  END IF;
  SELECT * INTO t FROM public.approval_types WHERE key = ap.type;
  IF NOT a.role = ANY (t.approver_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not decide this approval' USING ERRCODE = '42501';
  END IF;
  -- D2: the owner is only the fallback for clinical drafts.
  -- A facility head who drafted it cannot decide it, so they do not count (no deadlock).
  IF ap.type IN ('setting_change_fh','catalog_clinical_review') AND a.role = 'owner' AND public.approval_fh_available(a.tenant_id, p_approval, ap.requested_by) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a facility head decides this draft' USING ERRCODE = '42501';
  END IF;
  IF ap.state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: approval already decided' USING ERRCODE = '55000';
  END IF;
  IF length(coalesce(p_reason, '')) > 500 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: reason over 500 characters' USING ERRCODE = '22023';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a decision must approve or reject' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a rejection needs a reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.approvals
     SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = a.staff_id, decided_as = a.role, decided_at = now(), decision_reason = NULLIF(btrim(p_reason), '')
   WHERE tenant_id = a.tenant_id AND id = p_approval;
  PERFORM public.audit_append('approval', 'approval', p_approval, 'success',
                              CASE WHEN p_approve THEN 'approval_approved' ELSE 'approval_rejected' END);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (ap.branch_id, 'ApprovalDecided', 'approval', p_approval,
          jsonb_build_object('approval_type', ap.type, 'outcome', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
                             'subject_kind', ap.subject_kind, 'subject_id', ap.subject_id));
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END
$function$
;--> statement-breakpoint
-- approvals_read: a facility head reads every tenant clinical approval (DEC-046 (1)).
DROP POLICY approvals_read ON public.approvals;--> statement-breakpoint
CREATE POLICY approvals_read ON public.approvals FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_acting_role() = 'owner'
              OR public.app_acting_role() IN ('manager','facility_head','records_officer')
                 AND public.app_branch_allowed(branch_id)
              OR public.app_acting_role() = 'facility_head' AND type IN ('setting_change_fh','catalog_clinical_review')
                 AND public.approval_is_tenant_setting_draft(tenant_id, id)
              OR requested_by = public.app_staff_id()));
