CREATE TABLE "delegation_floor" (
	"category" text NOT NULL,
	"profession" text NOT NULL,
	"max_mode" text NOT NULL,
	CONSTRAINT "delegation_floor_key" UNIQUE("category","profession"),
	CONSTRAINT "delegation_floor_mode_check" CHECK ("delegation_floor"."max_mode" in ('performs','supervised','assists','none'))
);
--> statement-breakpoint
CREATE TABLE "service_resources" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_resources_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_resources_version_code_key" UNIQUE("tenant_id","version_id","kind","code"),
	CONSTRAINT "service_resources_code_check" CHECK ("service_resources"."kind" = 'room' and "service_resources"."code" in ('consultation','treatment','pharmacy')
      or "service_resources"."kind" = 'device' and "service_resources"."code" in ('laser','laser_ablative','laser_non_ablative','ipl','rf','hifu','microneedling_device','centrifuge','facial_machine'))
);
--> statement-breakpoint
CREATE TABLE "service_staff_eligibility" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"role" text,
	"staff_id" uuid,
	"mode" text NOT NULL,
	CONSTRAINT "service_staff_eligibility_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_staff_eligibility_target_check" CHECK (("service_staff_eligibility"."role" is null) <> ("service_staff_eligibility"."staff_id" is null) and ("service_staff_eligibility"."role" is null or "service_staff_eligibility"."role" in ('doctor','nurse','therapist'))),
	CONSTRAINT "service_staff_eligibility_mode_check" CHECK ("service_staff_eligibility"."mode" in ('performs','supervised','assists'))
);
--> statement-breakpoint
ALTER TABLE "catalog_versions" DROP CONSTRAINT "catalog_versions_review_check";--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD COLUMN "prep_min" integer;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD COLUMN "treatment_min" integer;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD COLUMN "buffer_min" integer;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD COLUMN "online_bookable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD COLUMN "aftercare_text" text;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD COLUMN "materials_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_tenant_id_version_id_catalog_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_staff_eligibility" ADD CONSTRAINT "service_staff_eligibility_tenant_id_version_id_catalog_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_staff_eligibility" ADD CONSTRAINT "service_staff_eligibility_tenant_id_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_staff_eligibility_role_key" ON "service_staff_eligibility" USING btree ("tenant_id","version_id","role") WHERE "service_staff_eligibility"."role" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_staff_eligibility_staff_key" ON "service_staff_eligibility" USING btree ("tenant_id","version_id","staff_id") WHERE "service_staff_eligibility"."staff_id" is not null;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_tenant_id_materials_approval_id_approvals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","materials_approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_versions_one_per_materials_approval" ON "catalog_versions" USING btree ("tenant_id","materials_approval_id") WHERE "catalog_versions"."materials_approval_id" is not null;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_service_check" CHECK (("catalog_versions"."category" is null or "catalog_versions"."category" in ('filler','toxin','threads','laser_ablative','injection','infusion','laser_non_ablative','peeling_chemical','microneedling','facial','body_treatment','consultation'))
      and ("catalog_versions"."prep_min" is null or "catalog_versions"."prep_min" between 0 and 120) and ("catalog_versions"."treatment_min" is null or "catalog_versions"."treatment_min" between 5 and 480) and ("catalog_versions"."buffer_min" is null or "catalog_versions"."buffer_min" between 0 and 120)
      and coalesce(length("catalog_versions"."aftercare_text"), 0) <= 4000);--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_review_check" CHECK (("catalog_versions"."state" in ('pending_review','rejected','cancelled')) <= ("catalog_versions"."approval_id" is not null or "catalog_versions"."materials_approval_id" is not null));;--> statement-breakpoint

-- T-034 rules (generated; see header)
-- T-034 (PR-88, DATA-62; owner-delegated decisions DEC-047): the service master on the versioned
-- catalog. Service fields live on the immutable catalog version; resources and staff eligibility are
-- child rows written once with their version by catalog_publish. Clinical fields, aftercare and
-- eligibility pass the one catalog_clinical_review gate; the BHP recipe passes the new
-- catalog_materials_review gate; a version needing both waits for both.

-- ── Child rows: readers follow the parent version (DEC-047 (4)) ───────────────────────────────
-- A child row is visible exactly when its version is (the subquery runs under the caller's
-- catalog_versions policy): clinical-content roles see active and superseded versions, editors and
-- facility heads also unpublished ones. Booking roles read active requirements through
-- catalog_service_requirements(). Written only by catalog_publish (no write grant).
ALTER TABLE public.service_resources ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY service_resources_read ON public.service_resources FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND EXISTS (SELECT 1 FROM public.catalog_versions v WHERE v.tenant_id = service_resources.tenant_id AND v.id = service_resources.version_id));--> statement-breakpoint
GRANT SELECT ON public.service_resources TO clinic_app;--> statement-breakpoint
ALTER TABLE public.service_staff_eligibility ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY service_staff_eligibility_read ON public.service_staff_eligibility FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND EXISTS (SELECT 1 FROM public.catalog_versions v WHERE v.tenant_id = service_staff_eligibility.tenant_id AND v.id = service_staff_eligibility.version_id));--> statement-breakpoint
GRANT SELECT ON public.service_staff_eligibility TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.service_resources', 'tenant-shared', 'catalog', '{owner,admin_pusat,manager,facility_head,doctor,nurse,therapist,pharmacist}', 'catalog functions (src/modules/catalog)', 'none'),
  ('public.service_staff_eligibility', 'tenant-shared', 'catalog', '{owner,admin_pusat,manager,facility_head,doctor,nurse,therapist,pharmacist}', 'catalog functions (src/modules/catalog)', 'none'),
  ('public.delegation_floor', 'platform', 'catalog', '{}', 'migrations (class F, DEC-047 (3))', 'none');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): resources are configuration; eligibility names staff
-- members (personal, DEC-047 (4)).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.service_resources', 'config'),
  ('public.service_staff_eligibility', 'personal');--> statement-breakpoint
CREATE POLICY service_resources_operator_read ON public.service_resources FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.service_resources', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.service_resources TO clinic_operator;--> statement-breakpoint
CREATE POLICY service_staff_eligibility_operator_read ON public.service_staff_eligibility FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.service_staff_eligibility', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.service_staff_eligibility TO clinic_operator;--> statement-breakpoint

-- Child rows are never changed or removed (the version is the snapshot a booking stores).
CREATE FUNCTION public.service_master_rows_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'service master rows are written once with their version' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.service_master_rows_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER service_resources_guard BEFORE UPDATE OR DELETE ON public.service_resources FOR EACH ROW EXECUTE FUNCTION public.service_master_rows_guard();--> statement-breakpoint
ALTER TABLE public.service_resources ENABLE ALWAYS TRIGGER service_resources_guard;--> statement-breakpoint
CREATE TRIGGER service_resources_no_truncate BEFORE TRUNCATE ON public.service_resources FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER service_staff_eligibility_guard BEFORE UPDATE OR DELETE ON public.service_staff_eligibility FOR EACH ROW EXECUTE FUNCTION public.service_master_rows_guard();--> statement-breakpoint
ALTER TABLE public.service_staff_eligibility ENABLE ALWAYS TRIGGER service_staff_eligibility_guard;--> statement-breakpoint
CREATE TRIGGER service_staff_eligibility_no_truncate BEFORE TRUNCATE ON public.service_staff_eligibility FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- ── The legal delegation floor (DEC-047 (3); class F, pending the clinical lead Q-07) ─────────
-- Platform table, no grants: read only by catalog_publish. Mirrored in
-- src/modules/catalog/service/floor.ts (tests/catalog/service.test.ts keeps them equal).
ALTER TABLE public.delegation_floor ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.delegation_floor (category, profession, max_mode) VALUES
  ('filler','doctor','performs'),
  ('filler','nurse','assists'),
  ('filler','therapist','none'),
  ('toxin','doctor','performs'),
  ('toxin','nurse','assists'),
  ('toxin','therapist','none'),
  ('threads','doctor','performs'),
  ('threads','nurse','assists'),
  ('threads','therapist','none'),
  ('laser_ablative','doctor','performs'),
  ('laser_ablative','nurse','assists'),
  ('laser_ablative','therapist','none'),
  ('injection','doctor','performs'),
  ('injection','nurse','supervised'),
  ('injection','therapist','none'),
  ('infusion','doctor','performs'),
  ('infusion','nurse','supervised'),
  ('infusion','therapist','none'),
  ('laser_non_ablative','doctor','performs'),
  ('laser_non_ablative','nurse','supervised'),
  ('laser_non_ablative','therapist','none'),
  ('peeling_chemical','doctor','performs'),
  ('peeling_chemical','nurse','supervised'),
  ('peeling_chemical','therapist','none'),
  ('microneedling','doctor','performs'),
  ('microneedling','nurse','supervised'),
  ('microneedling','therapist','none'),
  ('facial','doctor','performs'),
  ('facial','nurse','performs'),
  ('facial','therapist','performs'),
  ('body_treatment','doctor','performs'),
  ('body_treatment','nurse','performs'),
  ('body_treatment','therapist','performs'),
  ('consultation','doctor','performs'),
  ('consultation','nurse','assists'),
  ('consultation','therapist','none');--> statement-breakpoint

-- Mode rank: performs > supervised > assists > none.
CREATE FUNCTION public.catalog_mode_rank(p text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p WHEN 'performs' THEN 3 WHEN 'supervised' THEN 2 WHEN 'assists' THEN 1 ELSE 0 END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_mode_rank(text) FROM PUBLIC;--> statement-breakpoint

-- ── Materials review (DEC-047 (2)) ──────────────────────────────────────────────────────────
INSERT INTO public.approval_types (key, label, requester_roles, approver_roles, owner_self) VALUES
  ('catalog_materials_review', 'Review bahan (BHP) katalog', '{owner,admin_pusat,manager}', '{pharmacist,facility_head,owner}', false);--> statement-breakpoint

-- True while an active pharmacist of the caller's tenant other than the requester could decide this
-- materials review (wall clock, HYG-008): then the facility head and the owner may not.
CREATE FUNCTION public.approval_ph_available(p_approval uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.approvals ap
                   JOIN public.staff s ON s.tenant_id = ap.tenant_id AND s.id <> ap.requested_by
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = 'pharmacist'
                  WHERE ap.tenant_id = public.app_tenant_id() AND ap.id = p_approval AND ap.type = 'catalog_materials_review'
                    AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp()))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_ph_available(uuid) FROM PUBLIC;--> statement-breakpoint
-- The Persetujuan inbox offers the decision only where approval_decide accepts it.
GRANT EXECUTE ON FUNCTION public.approval_ph_available(uuid) TO clinic_app;--> statement-breakpoint

-- ── Readers ─────────────────────────────────────────────────────────────────────────────────
-- The commercial projection gains the operational service fields (every member; no clinical column).
DROP FUNCTION public.catalog_commercial();--> statement-breakpoint
CREATE FUNCTION public.catalog_commercial() RETURNS TABLE (item_id uuid, version_id uuid, version integer, kind text, code text, name text,
    tax_category text, tax_basis text, normal_price bigint, control_count integer, control_validity_days integer, booking_dp_enabled boolean,
    booking_dp_amount bigint, min_dp_pct integer, installments_allowed boolean, validity_days integer, commission_scope text[], pending_review boolean,
    category text, prep_min integer, treatment_min integer, buffer_min integer, online_bookable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.id, v.id, v.version, i.kind, i.code, v.name, v.tax_category, v.tax_basis, v.normal_price, v.control_count, v.control_validity_days,
         v.booking_dp_enabled, v.booking_dp_amount, v.min_dp_pct, v.installments_allowed, v.validity_days, v.commission_scope,
         EXISTS (SELECT 1 FROM public.catalog_versions p WHERE p.tenant_id = i.tenant_id AND p.item_id = i.id AND p.state = 'pending_review'),
         v.category, v.prep_min, v.treatment_min, v.buffer_min, v.online_bookable
    FROM public.catalog_items i
    JOIN public.catalog_versions v ON v.tenant_id = i.tenant_id AND v.item_id = i.id AND v.state = 'active'
   WHERE i.tenant_id = public.app_tenant_id() AND public.app_staff_id() IS NOT NULL
   ORDER BY v.name, i.code
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_commercial() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_commercial() TO clinic_app;--> statement-breakpoint

-- The resources and staff eligibility of an active service version for the booking and catalog
-- roles (DEC-047 (4); T-044 finds slots and performers with them). No clinical text. Null when the
-- version is not active, not the caller's tenant's, or the role is not a booking role.
CREATE FUNCTION public.catalog_service_requirements(p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
           'resources', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', r.kind, 'code', r.code, 'required', r.required) ORDER BY r.kind, r.code)
                                    FROM public.service_resources r WHERE r.tenant_id = v.tenant_id AND r.version_id = v.id), '[]'::jsonb),
           'eligibility', coalesce((SELECT jsonb_agg(jsonb_build_object('role', e.role, 'staff_id', e.staff_id, 'mode', e.mode) ORDER BY e.role, e.staff_id::text)
                                      FROM public.service_staff_eligibility e WHERE e.tenant_id = v.tenant_id AND e.version_id = v.id), '[]'::jsonb))
    FROM public.catalog_versions v
   WHERE v.tenant_id = public.app_tenant_id() AND v.id = p_version AND v.state = 'active'
     AND public.app_staff_id() IS NOT NULL AND public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head','pharmacist','fo_cashier','central_cs','bc','doctor','nurse','therapist'])
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_service_requirements(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_service_requirements(uuid) TO clinic_app;--> statement-breakpoint

-- The version a catalog review approval decides, for the Persetujuan detail. A clinical review shows
-- the proposed and active clinical fields, aftercare and eligibility, never the recipe; a materials
-- review shows the proposed and active recipe, never clinical text (round 2 hole 1: the pharmacist
-- reads unpublished recipes only here). Editors and facility heads read both types; a pharmacist
-- only materials reviews.
-- A version's eligibility with staff names, for the clinical reviewer (internal; no grant).
CREATE FUNCTION public.catalog_eligibility_named(p_tenant uuid, p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('role', e.role, 'staff_id', e.staff_id, 'staff_name', s.display_name, 'mode', e.mode)
                            ORDER BY e.role, s.display_name, e.staff_id::text), '[]'::jsonb)
    FROM public.service_staff_eligibility e
    LEFT JOIN public.staff s ON s.tenant_id = e.tenant_id AND s.id = e.staff_id
   WHERE e.tenant_id = p_tenant AND e.version_id = p_version
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_eligibility_named(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

DROP FUNCTION public.catalog_review_target(uuid);--> statement-breakpoint
CREATE FUNCTION public.catalog_review_target(p_approval uuid) RETURNS TABLE (review_type text, item_id uuid, kind text, code text, name text, version integer, state text,
    indications text, contraindications text, consent_template text, delegation text, aftercare_text text, category text, eligibility jsonb,
    has_active boolean, active_indications text, active_contraindications text, active_consent_template text, active_delegation text,
    active_aftercare_text text, active_eligibility jsonb, material_formula jsonb, active_material_formula jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH x AS (
    SELECT ap.type, ap.type = 'catalog_clinical_review' AS cl, v, i, a
      FROM public.approvals ap
      JOIN public.catalog_versions v ON v.tenant_id = ap.tenant_id AND (v.approval_id = ap.id OR v.materials_approval_id = ap.id)
      JOIN public.catalog_items i ON i.tenant_id = v.tenant_id AND i.id = v.item_id
      LEFT JOIN public.catalog_versions a ON a.tenant_id = v.tenant_id AND a.item_id = v.item_id AND a.state = 'active'
     WHERE ap.tenant_id = public.app_tenant_id() AND ap.id = p_approval
       AND ap.type IN ('catalog_clinical_review','catalog_materials_review') AND public.app_staff_id() IS NOT NULL
       AND (public.app_role_in(ARRAY['owner','admin_pusat','manager','facility_head'])
            OR ap.type = 'catalog_materials_review' AND public.app_role_in(ARRAY['pharmacist'])))
  SELECT x.type, (x.i).id, (x.i).kind, (x.i).code, (x.v).name, (x.v).version, (x.v).state,
         CASE WHEN x.cl THEN (x.v).indications END, CASE WHEN x.cl THEN (x.v).contraindications END,
         CASE WHEN x.cl THEN (x.v).consent_template END, CASE WHEN x.cl THEN (x.v).delegation END,
         CASE WHEN x.cl THEN (x.v).aftercare_text END, (x.v).category,
         CASE WHEN x.cl THEN public.catalog_eligibility_named((x.v).tenant_id, (x.v).id) END,
         (x.a).id IS NOT NULL,
         CASE WHEN x.cl THEN (x.a).indications END, CASE WHEN x.cl THEN (x.a).contraindications END,
         CASE WHEN x.cl THEN (x.a).consent_template END, CASE WHEN x.cl THEN (x.a).delegation END,
         CASE WHEN x.cl THEN (x.a).aftercare_text END,
         CASE WHEN x.cl AND (x.a).id IS NOT NULL THEN public.catalog_eligibility_named((x.a).tenant_id, (x.a).id) END,
         CASE WHEN NOT x.cl THEN (x.v).material_formula END, CASE WHEN NOT x.cl THEN (x.a).material_formula END
    FROM x
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_review_target(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_review_target(uuid) TO clinic_app;--> statement-breakpoint
-- catalog_versions_guard: a pending version carries a clinical or a materials approval (or both)
CREATE OR REPLACE FUNCTION public.catalog_versions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'catalog versions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('active','pending_review') OR NEW.decided_at IS NOT NULL OR NEW.referenced_at IS NOT NULL
       OR (NEW.state = 'pending_review') <> (NEW.approval_id IS NOT NULL OR NEW.materials_approval_id IS NOT NULL) THEN
      RAISE EXCEPTION 'a catalog version starts active, or pending review with its approvals' USING ERRCODE = '42501';
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
$function$
;--> statement-breakpoint
-- catalog_publish (T-033, extended by T-034 / DEC-047). Omitted service fields, resources and
-- eligibility carry forward from the active version, else the latest (like the T-033 recipe); a new
-- service starts at 10/30/10 minutes. The gates compare with the ACTIVE version only: clinical = the
-- four T-033 fields, aftercare, eligibility -> catalog_clinical_review; materials = the recipe ->
-- catalog_materials_review; both -> both. Operational fields alone are active at once. Eligibility is
-- checked against the legal floor for the version's category (a named staff member: the highest floor
-- of their active clinical roles; none -> refused).
CREATE OR REPLACE FUNCTION public.catalog_publish(p_item uuid, p_kind text, p_code text, p_fields jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record;
  v_item uuid := p_item;
  v_kind text;
  cur public.catalog_versions;
  src public.catalog_versions;
  v_formula jsonb;
  v_category text;
  v_prep integer;
  v_treat integer;
  v_buffer integer;
  v_online boolean;
  v_aftercare text;
  v_resources jsonb;
  v_elig jsonb;
  v_cur_elig jsonb;
  v_floor integer;
  e jsonb;
  v_next integer;
  v_clinical boolean;
  v_materials boolean;
  v_id uuid := public.uuid_generate_v7();
  v_approval uuid;
  v_mapproval uuid;
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
      RETURNING id, kind INTO v_item, v_kind;
    EXCEPTION
      WHEN unique_violation THEN RAISE EXCEPTION 'ERR_VERSION_CONFLICT: code already used' USING ERRCODE = '23505';
      WHEN check_violation THEN RAISE EXCEPTION 'ERR_INVALID_INPUT: kind or code not allowed' USING ERRCODE = '22023';
    END;
  ELSE
    SELECT kind INTO v_kind FROM public.catalog_items WHERE tenant_id = a.tenant_id AND id = v_item FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: catalog item not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND item_id = v_item AND state = 'pending_review') THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: catalog_review_pending' USING ERRCODE = '55000';
    END IF;
  END IF;
  SELECT * INTO cur FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND item_id = v_item AND state = 'active';
  -- The carry-forward source: the active version, else the latest (a first version rejected or
  -- withdrawn, corrected from the latest one). Never the gate baseline (that is cur only).
  SELECT * INTO src FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND item_id = v_item
   ORDER BY (state = 'active') DESC, version DESC LIMIT 1;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND item_id = v_item;
  BEGIN
    -- An omitted recipe keeps the source's; an explicit [] clears it.
    v_formula := CASE WHEN f ? 'material_formula' THEN f -> 'material_formula' ELSE coalesce(src.material_formula, '[]'::jsonb) END;
    IF jsonb_typeof(v_formula) <> 'array' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: material formula must be a list' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_formula) > 50 OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_formula) x
          WHERE jsonb_typeof(x) <> 'object' OR jsonb_typeof(x -> 'material') IS DISTINCT FROM 'string'
             OR jsonb_typeof(x -> 'qty') IS DISTINCT FROM 'number' OR jsonb_typeof(x -> 'unit') IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: material formula rows need material, qty and unit' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_formula) x
                WHERE length(btrim(x ->> 'material')) NOT BETWEEN 1 AND 120 OR (x ->> 'qty')::numeric <= 0
                   OR (x ->> 'qty')::numeric > 100000 OR length(btrim(x ->> 'unit')) NOT BETWEEN 1 AND 16) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: material formula rows need material, qty > 0 and unit' USING ERRCODE = '22023';
    END IF;
    IF v_kind <> 'service' THEN
      IF f ?| ARRAY['category','prep_min','treatment_min','buffer_min','online_bookable','aftercare_text','resources','eligibility'] THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: service fields are for services only' USING ERRCODE = '22023';
      END IF;
      v_online := false;
      v_resources := '[]'::jsonb;
      v_elig := '[]'::jsonb;
    ELSE
      v_category := CASE WHEN f ? 'category' THEN NULLIF(f ->> 'category', '') ELSE src.category END;
      IF v_category IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.delegation_floor d WHERE d.category = v_category) THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: category not allowed' USING ERRCODE = '22023';
      END IF;
      v_prep := coalesce((f ->> 'prep_min')::integer, src.prep_min, 10);
      v_treat := coalesce((f ->> 'treatment_min')::integer, src.treatment_min, 30);
      v_buffer := coalesce((f ->> 'buffer_min')::integer, src.buffer_min, 10);
      v_online := coalesce((f ->> 'online_bookable')::boolean, src.online_bookable, false);
      v_aftercare := CASE WHEN f ? 'aftercare_text' THEN public.catalog_norm(f ->> 'aftercare_text') ELSE src.aftercare_text END;
      IF f ? 'resources' THEN
        IF jsonb_typeof(f -> 'resources') <> 'array' OR jsonb_array_length(f -> 'resources') > 20 THEN
          RAISE EXCEPTION 'ERR_INVALID_INPUT: resources must be a list of at most 20' USING ERRCODE = '22023';
        END IF;
        v_resources := (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', x ->> 'kind', 'code', x ->> 'code',
                                                                    'required', coalesce((x ->> 'required')::boolean, true))
                                                  ORDER BY x ->> 'kind', x ->> 'code'), '[]'::jsonb)
                          FROM jsonb_array_elements(f -> 'resources') x);
      ELSE
        v_resources := coalesce((SELECT jsonb_agg(jsonb_build_object('kind', r.kind, 'code', r.code, 'required', r.required) ORDER BY r.kind, r.code)
                                   FROM public.service_resources r WHERE r.tenant_id = a.tenant_id AND r.version_id = src.id), '[]'::jsonb);
      END IF;
      IF f ? 'eligibility' THEN
        IF jsonb_typeof(f -> 'eligibility') <> 'array' OR jsonb_array_length(f -> 'eligibility') > 50 THEN
          RAISE EXCEPTION 'ERR_INVALID_INPUT: eligibility must be a list of at most 50' USING ERRCODE = '22023';
        END IF;
        v_elig := (SELECT coalesce(jsonb_agg(jsonb_build_object('role', NULLIF(x ->> 'role', ''), 'staff_id', lower(NULLIF(x ->> 'staff_id', '')), 'mode', x ->> 'mode')
                                             ORDER BY NULLIF(x ->> 'role', ''), lower(NULLIF(x ->> 'staff_id', '')), x ->> 'mode'), '[]'::jsonb)
                     FROM jsonb_array_elements(f -> 'eligibility') x);
      ELSE
        v_elig := coalesce((SELECT jsonb_agg(jsonb_build_object('role', e.role, 'staff_id', e.staff_id::text, 'mode', e.mode)
                                   ORDER BY e.role, e.staff_id::text, e.mode)
                         FROM public.service_staff_eligibility e WHERE e.tenant_id = a.tenant_id AND e.version_id = src.id), '[]'::jsonb);
      END IF;
    END IF;
    -- The legal floor (DEC-047 (3)): every row, carried or new, against the version's category.
    IF jsonb_array_length(v_elig) > 0 AND v_category IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: category_required' USING ERRCODE = '22023';
    END IF;
    FOR e IN SELECT x FROM jsonb_array_elements(v_elig) x LOOP
      IF (e ->> 'role' IS NULL) = (e ->> 'staff_id' IS NULL) OR e ->> 'role' NOT IN ('doctor','nurse','therapist')
         OR e ->> 'mode' IS DISTINCT FROM 'performs' AND e ->> 'mode' IS DISTINCT FROM 'supervised' AND e ->> 'mode' IS DISTINCT FROM 'assists' THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: eligibility rows name a doctor, nurse or therapist role or one staff member, and a mode' USING ERRCODE = '22023';
      END IF;
      IF e ->> 'role' IS NOT NULL THEN
        SELECT public.catalog_mode_rank(d.max_mode) INTO v_floor FROM public.delegation_floor d
         WHERE d.category = v_category AND d.profession = e ->> 'role';
      ELSE
        SELECT max(public.catalog_mode_rank(d.max_mode)) INTO v_floor
          FROM public.staff s
          JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
          JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id
          JOIN public.delegation_floor d ON d.category = v_category AND d.profession = r.role
         WHERE s.tenant_id = a.tenant_id AND s.id = (e ->> 'staff_id')::uuid
           AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp());
      END IF;
      IF coalesce(v_floor, 0) < public.catalog_mode_rank(e ->> 'mode') THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: delegation_floor' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  EXCEPTION
    -- Bad casts only (my own ERR_ raises use 22023 and pass through untouched).
    WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: %', SQLERRM USING ERRCODE = '22023';
  END;
  v_cur_elig := coalesce((SELECT jsonb_agg(jsonb_build_object('role', e.role, 'staff_id', e.staff_id::text, 'mode', e.mode)
                                   ORDER BY e.role, e.staff_id::text, e.mode)
                         FROM public.service_staff_eligibility e WHERE e.tenant_id = a.tenant_id AND e.version_id = cur.id), '[]'::jsonb);
  v_clinical := (public.catalog_norm(f ->> 'indications'), public.catalog_norm(f ->> 'contraindications'),
                 public.catalog_norm(f ->> 'consent_template'), public.catalog_norm(f ->> 'delegation'), v_aftercare, v_elig)
                IS DISTINCT FROM
                (public.catalog_norm(cur.indications), public.catalog_norm(cur.contraindications),
                 public.catalog_norm(cur.consent_template), public.catalog_norm(cur.delegation), cur.aftercare_text, v_cur_elig);
  v_materials := v_formula IS DISTINCT FROM coalesce(cur.material_formula, '[]'::jsonb);
  -- The approvals name the version that will exist (same transaction); tenant-wide reviews.
  IF v_clinical THEN
    v_approval := public.approval_request('catalog_clinical_review', 'catalog_version', v_id, p_reason, NULL, NULL);
  END IF;
  IF v_materials THEN
    v_mapproval := public.approval_request('catalog_materials_review', 'catalog_version', v_id, p_reason, NULL, NULL);
  END IF;
  IF v_clinical OR v_materials THEN
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
        commission_scope, indications, contraindications, consent_template, delegation, category, prep_min, treatment_min, buffer_min,
        online_bookable, aftercare_text, reason, created_by, created_as, approval_id, materials_approval_id)
    VALUES (v_id, a.tenant_id, v_item, v_next, v_state, btrim(f ->> 'name'), f ->> 'tax_category', btrim(f ->> 'tax_basis'),
        (f ->> 'normal_price')::bigint, coalesce((f ->> 'control_count')::integer, 0), (f ->> 'control_validity_days')::integer,
        coalesce((f ->> 'booking_dp_enabled')::boolean, false), (f ->> 'booking_dp_amount')::bigint, (f ->> 'min_dp_pct')::integer,
        coalesce((f ->> 'installments_allowed')::boolean, false), (f ->> 'validity_days')::integer,
        v_formula,
        coalesce(ARRAY(SELECT jsonb_array_elements_text(f -> 'commission_scope')), '{}'::text[]),
        public.catalog_norm(f ->> 'indications'), public.catalog_norm(f ->> 'contraindications'),
        public.catalog_norm(f ->> 'consent_template'), public.catalog_norm(f ->> 'delegation'),
        v_category, v_prep, v_treat, v_buffer, v_online, v_aftercare,
        btrim(coalesce(p_reason, '')), a.staff_id, a.role, v_approval, v_mapproval);
    INSERT INTO public.service_resources (tenant_id, version_id, kind, code, required)
    SELECT a.tenant_id, v_id, x ->> 'kind', x ->> 'code', (x ->> 'required')::boolean FROM jsonb_array_elements(v_resources) x;
    INSERT INTO public.service_staff_eligibility (tenant_id, version_id, role, staff_id, mode)
    SELECT a.tenant_id, v_id, x ->> 'role', (x ->> 'staff_id')::uuid, x ->> 'mode' FROM jsonb_array_elements(v_elig) x;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range
      OR unique_violation OR foreign_key_violation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: %', SQLERRM USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'catalog_version', v_id, 'success',
          CASE WHEN v_state = 'pending_review' THEN 'catalog_review_requested' ELSE 'catalog_version_published' END);
  IF v_state = 'active' THEN
    INSERT INTO public.domain_events (type, aggregate_kind, aggregate_id, payload)
    VALUES ('CatalogVersionPublished', 'catalog_version', v_id, jsonb_build_object('item_id', v_item));
  END IF;
  RETURN jsonb_build_object('item_id', v_item, 'version_id', v_id, 'version', v_next, 'state', v_state,
                            'approval_id', v_approval, 'materials_approval_id', v_mapproval);
END
$function$
;--> statement-breakpoint
-- catalog_review_sync (T-033, extended by T-034 / DEC-047 (2)): every path that moves a catalog
-- review approval out of pending moves its version in the same transaction. Approved: active (the
-- previous active superseded) once every attached approval is approved; until then the version waits.
-- Rejected or cancelled: the version takes that state FIRST (so the recursive fire for the sibling
-- finds no pending version and exits), then the other still-pending approval is cancelled with the
-- same decider, audited and announced (round 2 hole 2).
CREATE OR REPLACE FUNCTION public.catalog_review_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  ver public.catalog_versions;
  v_other uuid;
BEGIN
  IF NEW.type NOT IN ('catalog_clinical_review','catalog_materials_review') OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO ver FROM public.catalog_versions
   WHERE tenant_id = NEW.tenant_id AND (approval_id = NEW.id OR materials_approval_id = NEW.id) AND state = 'pending_review' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_other := CASE WHEN ver.approval_id = NEW.id THEN ver.materials_approval_id ELSE ver.approval_id END;
  IF NEW.state = 'approved' THEN
    IF v_other IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.approvals WHERE tenant_id = NEW.tenant_id AND id = v_other AND state = 'approved') THEN
      RETURN NULL; -- the other review is still open
    END IF;
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
  IF NEW.state IN ('rejected','cancelled') AND v_other IS NOT NULL THEN
    UPDATE public.approvals SET state = 'cancelled', decided_by = NEW.decided_by, decided_as = NEW.decided_as, decided_at = clock_timestamp()
     WHERE tenant_id = NEW.tenant_id AND id = v_other AND state = 'pending';
    IF FOUND THEN
      IF public.app_staff_id() IS NOT NULL THEN
        PERFORM public.audit_append('approval', 'approval', v_other, 'success', 'approval_cancelled');
      END IF;
      INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
      SELECT ap.tenant_id, ap.branch_id, 'ApprovalDecided', 'approval', ap.id,
             jsonb_build_object('approval_type', ap.type, 'outcome', 'cancelled', 'subject_kind', ap.subject_kind, 'subject_id', ap.subject_id)
        FROM public.approvals ap WHERE ap.tenant_id = NEW.tenant_id AND ap.id = v_other;
    END IF;
  END IF;
  RETURN NULL;
END
$function$
;--> statement-breakpoint
-- approval_is_tenant_setting_draft: the materials review is tenant-wide too (DEC-047 (2))
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
                WHERE ap.tenant_id = p_tenant AND ap.id = p_approval AND ap.type IN ('catalog_clinical_review','catalog_materials_review')))
$function$
;--> statement-breakpoint
-- approval_decide: pharmacist routing and fallback for the materials review (DEC-047 (2))
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
                       OR a.role = 'pharmacist' AND ap.type = 'catalog_materials_review'
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
  -- DEC-047 (2): a pharmacist decides the materials review; the facility head or the owner only
  -- while no pharmacist other than the requester could.
  IF ap.type = 'catalog_materials_review' AND a.role IN ('facility_head','owner') AND public.approval_ph_available(p_approval) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a pharmacist decides this review' USING ERRCODE = '42501';
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
-- approvals_read: facility heads read the materials review tenant-wide; pharmacists read it (DEC-047 (2)).
DROP POLICY approvals_read ON public.approvals;--> statement-breakpoint
CREATE POLICY approvals_read ON public.approvals FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (public.app_acting_role() = 'owner'
              OR public.app_acting_role() IN ('manager','facility_head','records_officer')
                 AND public.app_branch_allowed(branch_id)
              OR public.app_acting_role() = 'facility_head' AND type IN ('setting_change_fh','catalog_clinical_review','catalog_materials_review')
                 AND public.approval_is_tenant_setting_draft(tenant_id, id)
              OR public.app_acting_role() = 'pharmacist' AND type = 'catalog_materials_review'
              OR requested_by = public.app_staff_id()));
