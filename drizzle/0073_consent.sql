CREATE TABLE "contraindication_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "contraindication_reviews_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "contraindication_reviews_once_key" UNIQUE("tenant_id","examination_id","plan_item_id"),
	CONSTRAINT "contraindication_reviews_check" CHECK ("contraindication_reviews"."decision" in ('cleared','blocked') and "contraindication_reviews"."version" >= 1
      and ("contraindication_reviews"."reason" is null or length(btrim("contraindication_reviews"."reason")) between 3 and 500) and ("contraindication_reviews"."decision" <> 'blocked' or "contraindication_reviews"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "procedure_consent_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"stage" integer NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"dose_micro" bigint,
	"dose_unit" text,
	CONSTRAINT "procedure_consent_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "procedure_consent_items_once_key" UNIQUE("tenant_id","consent_id","plan_item_id"),
	CONSTRAINT "procedure_consent_items_check" CHECK ("procedure_consent_items"."stage" between 1 and 20 and "procedure_consent_items"."qty" between 1 and 1000
      and (("procedure_consent_items"."dose_micro" is null) = ("procedure_consent_items"."dose_unit" is null)) and ("procedure_consent_items"."dose_micro" is null or "procedure_consent_items"."dose_micro" between 1 and 1000000000)
      and ("procedure_consent_items"."dose_unit" is null or "procedure_consent_items"."dose_unit" in ('unit','ml','mg','cm2')))
);
--> statement-breakpoint
CREATE TABLE "procedure_consents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"signer" text NOT NULL,
	"guardian_name" text,
	"guardian_relation" text,
	"captured_by" uuid NOT NULL,
	"captured_as" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"consent_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"signature_png" "bytea" NOT NULL,
	"signature_sha256" text NOT NULL,
	"signature_size" integer NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdrawn_as" text,
	"withdraw_reason" text,
	CONSTRAINT "procedure_consents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "procedure_consents_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "procedure_consents_version_key" UNIQUE("tenant_id","plan_id","version"),
	CONSTRAINT "procedure_consents_state_check" CHECK ("procedure_consents"."state" in ('active','superseded','withdrawn') and "procedure_consents"."version" >= 1 and "procedure_consents"."captured_as" in ('doctor','nurse')
      and (num_nonnulls("procedure_consents"."superseded_at", "procedure_consents"."superseded_by_id") = 2) = ("procedure_consents"."state" = 'superseded') and num_nonnulls("procedure_consents"."superseded_at", "procedure_consents"."superseded_by_id") in (0, 2)
      and (num_nonnulls("procedure_consents"."withdrawn_at", "procedure_consents"."withdrawn_by", "procedure_consents"."withdrawn_as", "procedure_consents"."withdraw_reason") = 4) = ("procedure_consents"."state" = 'withdrawn')
      and num_nonnulls("procedure_consents"."withdrawn_at", "procedure_consents"."withdrawn_by", "procedure_consents"."withdrawn_as", "procedure_consents"."withdraw_reason") in (0, 4)
      and ("procedure_consents"."withdraw_reason" is null or length(btrim("procedure_consents"."withdraw_reason")) between 3 and 500) and ("procedure_consents"."withdrawn_as" is null or "procedure_consents"."withdrawn_as" in ('doctor','nurse'))),
	CONSTRAINT "procedure_consents_signer_check" CHECK ("procedure_consents"."signer" in ('patient','guardian')
      and (("procedure_consents"."signer" = 'guardian') = ("procedure_consents"."guardian_name" is not null and "procedure_consents"."guardian_relation" is not null))
      and ("procedure_consents"."signer" = 'guardian' or ("procedure_consents"."guardian_name" is null and "procedure_consents"."guardian_relation" is null))
      and ("procedure_consents"."guardian_name" is null or length(btrim("procedure_consents"."guardian_name")) between 2 and 120)
      and ("procedure_consents"."guardian_relation" is null or "procedure_consents"."guardian_relation" in ('ayah','ibu','wali','lainnya'))),
	CONSTRAINT "procedure_consents_text_check" CHECK (length("procedure_consents"."consent_text") between 1 and 60000 and "procedure_consents"."content_hash" = encode(sha256(convert_to("procedure_consents"."consent_text", 'UTF8')), 'hex')),
	CONSTRAINT "procedure_consents_signature_check" CHECK ("procedure_consents"."signature_size" between 68 and 204800 and "procedure_consents"."signature_size" = octet_length("procedure_consents"."signature_png")
      and "procedure_consents"."signature_sha256" = encode(sha256("procedure_consents"."signature_png"), 'hex')
      and substring("procedure_consents"."signature_png" from 1 for 8) = '\x89504e470d0a1a0a'::bytea and substring("procedure_consents"."signature_png" from 13 for 4) = '\x49484452'::bytea)
);
--> statement-breakpoint
ALTER TABLE "contraindication_reviews" ADD CONSTRAINT "contraindication_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contraindication_reviews" ADD CONSTRAINT "contraindication_reviews_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contraindication_reviews" ADD CONSTRAINT "contraindication_reviews_item_fk" FOREIGN KEY ("tenant_id","plan_item_id") REFERENCES "public"."plan_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contraindication_reviews" ADD CONSTRAINT "contraindication_reviews_by_fk" FOREIGN KEY ("tenant_id","reviewed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consent_items" ADD CONSTRAINT "procedure_consent_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consent_items" ADD CONSTRAINT "procedure_consent_items_consent_fk" FOREIGN KEY ("tenant_id","branch_id","consent_id") REFERENCES "public"."procedure_consents"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consent_items" ADD CONSTRAINT "procedure_consent_items_item_fk" FOREIGN KEY ("tenant_id","plan_item_id") REFERENCES "public"."plan_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consent_items" ADD CONSTRAINT "procedure_consent_items_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consents" ADD CONSTRAINT "procedure_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consents" ADD CONSTRAINT "procedure_consents_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consents" ADD CONSTRAINT "procedure_consents_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consents" ADD CONSTRAINT "procedure_consents_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."care_plans"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consents" ADD CONSTRAINT "procedure_consents_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consents" ADD CONSTRAINT "procedure_consents_by_fk" FOREIGN KEY ("tenant_id","captured_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_consents" ADD CONSTRAINT "procedure_consents_withdrawn_by_fk" FOREIGN KEY ("tenant_id","withdrawn_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_consents_one_active" ON "procedure_consents" USING btree ("tenant_id","plan_id") WHERE state = 'active';--> statement-breakpoint
CREATE INDEX "procedure_consents_visit_idx" ON "procedure_consents" USING btree ("tenant_id","visit_id");;--> statement-breakpoint

-- T-054 rules (generated by gen.py; plan docs/tasks/T-054.md)
-- Procedure consent (UX-39) and the treatment start gate (PR-11, CLIN-005, CLIN-022; plan Argon r1 2821b6df
-- adopted, r2 5c3d858a APPROVE; DEC-065 revisable defaults pending Q-07).

-- Read helper (invoker, wall clock): doctor, nurse, therapist, facility head, records officer at a branch allowed
-- in the session and held by the acting role now. Never BC, FO/cashier, pharmacist or non-clinical roles (they see
-- only the visit's consent step). Never null.
CREATE FUNCTION public.consent_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id() AND public.app_role_in(ARRAY['doctor','nurse','therapist','facility_head','records_officer'])
    AND public.app_branch_allowed(p_branch)
    AND EXISTS (
      SELECT 1 FROM public.staff s
        JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch
       WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
         AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consent_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Whether a staff member holds a clinical role at a branch now (membership and branch role on the wall clock).
CREATE FUNCTION public.consent_staff_role(p_tenant uuid, p_staff uuid, p_branch uuid, p_role text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
      JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = p_role AND sb.branch_id = p_branch
     WHERE s.tenant_id = p_tenant AND s.id = p_staff
       AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp()))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_staff_role(uuid, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- A dose in micro-units as text with up to six decimals and a comma (integer arithmetic only).
CREATE FUNCTION public.consent_dose(p bigint) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (p / 1000000)::text || CASE WHEN p % 1000000 = 0 THEN '' ELSE ',' || rtrim(lpad((p % 1000000)::text, 6, '0'), '0') END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_dose(bigint) FROM PUBLIC;--> statement-breakpoint

-- The consent text of a plan's active items (deterministic; the snapshot a signature binds to). Per item: name,
-- stage, quantity, dose and unit, the version's consent template (a fixed clause when none), its contraindications;
-- then a fixed risk section. Items in stage, catalog version and id order.
CREATE FUNCTION public.consent_text_of(p_tenant uuid, p_plan uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT 'PERSETUJUAN TINDAKAN KEDOKTERAN' || E'\n\n' || c.title || E'\n'
    || coalesce(string_agg(
         format(E'\nTahap %s — %s × %s%s\n%s%s',
                t.stage, cv.name, t.qty,
                CASE WHEN t.dose_micro IS NULL THEN '' ELSE format(' (dosis %s %s)', public.consent_dose(t.dose_micro), t.dose_unit) END,
                coalesce(NULLIF(btrim(cv.consent_template), ''),
                         'Saya telah mendapat penjelasan tentang tujuan, cara, manfaat, dan kemungkinan efek samping tindakan ini, serta pilihan lain yang tersedia.'),
                CASE WHEN NULLIF(btrim(cv.contraindications), '') IS NULL THEN '' ELSE E'\nKontraindikasi: ' || btrim(cv.contraindications) END),
         E'\n' ORDER BY t.stage, t.catalog_version_id, t.id), '')
    || E'\n\nRisiko umum: kemerahan, bengkak, nyeri, atau memar sementara; reaksi alergi; infeksi; hasil yang berbeda dari harapan. '
    || 'Saya dapat bertanya dan menarik persetujuan ini sebelum tindakan dimulai.'
    FROM public.care_plans c
    LEFT JOIN public.plan_items t ON t.tenant_id = c.tenant_id AND t.plan_id = c.id AND t.removed_at IS NULL
    LEFT JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
   WHERE c.tenant_id = p_tenant AND c.id = p_plan
   GROUP BY c.id, c.title
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_text_of(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.procedure_consents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY procedure_consents_read ON public.procedure_consents FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.consent_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, patient_id, visit_id, examination_id, plan_id, version, state, signer, guardian_name, guardian_relation, captured_by, captured_as, captured_at, consent_text, content_hash, signature_sha256, signature_size, superseded_at, superseded_by_id, withdrawn_at, withdrawn_by, withdrawn_as, withdraw_reason) ON public.procedure_consents TO clinic_app;--> statement-breakpoint
CREATE POLICY procedure_consents_operator_read ON public.procedure_consents FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.procedure_consents', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, patient_id, visit_id, examination_id, plan_id, version, state, signer, guardian_name, guardian_relation, captured_by, captured_as, captured_at, consent_text, content_hash, signature_sha256, signature_size, superseded_at, superseded_by_id, withdrawn_at, withdrawn_by, withdrawn_as, withdraw_reason) ON public.procedure_consents TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER procedure_consents_no_truncate BEFORE TRUNCATE ON public.procedure_consents FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.procedure_consents ENABLE ALWAYS TRIGGER procedure_consents_no_truncate;--> statement-breakpoint
ALTER TABLE public.procedure_consent_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY procedure_consent_items_read ON public.procedure_consent_items FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.consent_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.procedure_consent_items TO clinic_app;--> statement-breakpoint
CREATE POLICY procedure_consent_items_operator_read ON public.procedure_consent_items FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.procedure_consent_items', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.procedure_consent_items TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER procedure_consent_items_no_truncate BEFORE TRUNCATE ON public.procedure_consent_items FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.procedure_consent_items ENABLE ALWAYS TRIGGER procedure_consent_items_no_truncate;--> statement-breakpoint
ALTER TABLE public.contraindication_reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY contraindication_reviews_read ON public.contraindication_reviews FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.consent_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.contraindication_reviews TO clinic_app;--> statement-breakpoint
CREATE POLICY contraindication_reviews_operator_read ON public.contraindication_reviews FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.contraindication_reviews', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.contraindication_reviews TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER contraindication_reviews_no_truncate BEFORE TRUNCATE ON public.contraindication_reviews FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.contraindication_reviews ENABLE ALWAYS TRIGGER contraindication_reviews_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.procedure_consents', 'clinical', 'clinical', '{doctor,nurse,therapist,facility_head,records_officer}', 'procedure_consent_capture, procedure_consent_withdraw (src/modules/clinical/consent)', 'the visit''s branch'),
  ('public.procedure_consent_items', 'clinical', 'clinical', '{doctor,nurse,therapist,facility_head,records_officer}', 'procedure_consent_capture (src/modules/clinical/consent)', 'the visit''s branch'),
  ('public.contraindication_reviews', 'clinical', 'clinical', '{doctor,nurse,therapist,facility_head,records_officer}', 'contraindication_review (src/modules/clinical/consent)', 'the visit''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): clinical class.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.procedure_consents', 'clinical'), ('public.procedure_consent_items', 'clinical'), ('public.contraindication_reviews', 'clinical');--> statement-breakpoint

-- ── Guards: staff_access lock first, ENABLE ALWAYS ─────────────────────────────────────────────────
-- Consents: never deleted; open active; content, identity and signature frozen; change once, active →
-- superseded or active → withdrawn (only those columns). Items: insert-only. Reviews: never deleted; keep their
-- examination and item; change (a re-decision) only while the visit is open.
CREATE FUNCTION public.consent_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || (coalesce(n, o) ->> 'tenant_id'), 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consents and reviews are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'procedure_consents' AND n ->> 'state' <> 'active' THEN
      RAISE EXCEPTION 'a consent opens active' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'procedure_consent_items' THEN
    RAISE EXCEPTION 'consented items never change' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'procedure_consents' THEN
    IF o ->> 'state' <> 'active' OR n ->> 'state' NOT IN ('superseded','withdrawn')
       OR n - 'state' - 'superseded_at' - 'superseded_by_id' - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_as' - 'withdraw_reason'
          IS DISTINCT FROM o - 'state' - 'superseded_at' - 'superseded_by_id' - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_as' - 'withdraw_reason' THEN
      RAISE EXCEPTION 'a consent is final; it is superseded or withdrawn once' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- contraindication_reviews
  IF (n -> 'id', n -> 'tenant_id', n -> 'branch_id', n -> 'examination_id', n -> 'plan_item_id')
     IS DISTINCT FROM (o -> 'id', o -> 'tenant_id', o -> 'branch_id', o -> 'examination_id', o -> 'plan_item_id') THEN
    RAISE EXCEPTION 'a review keeps its examination and item' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.examinations e JOIN public.visits v ON v.tenant_id = e.tenant_id AND v.id = e.visit_id
              WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.examination_id AND v.closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a review of a closed visit is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER procedure_consents_guard BEFORE INSERT OR UPDATE OR DELETE ON public.procedure_consents FOR EACH ROW EXECUTE FUNCTION public.consent_guard();--> statement-breakpoint
ALTER TABLE public.procedure_consents ENABLE ALWAYS TRIGGER procedure_consents_guard;--> statement-breakpoint
CREATE TRIGGER procedure_consent_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.procedure_consent_items FOR EACH ROW EXECUTE FUNCTION public.consent_guard();--> statement-breakpoint
ALTER TABLE public.procedure_consent_items ENABLE ALWAYS TRIGGER procedure_consent_items_guard;--> statement-breakpoint
CREATE TRIGGER contraindication_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON public.contraindication_reviews FOR EACH ROW EXECUTE FUNCTION public.consent_guard();--> statement-breakpoint
ALTER TABLE public.contraindication_reviews ENABLE ALWAYS TRIGGER contraindication_reviews_guard;--> statement-breakpoint

-- ── The consent writer's actor: actor lock first, then doctor or nurse (DEC-065), then the capability ──
CREATE FUNCTION public.consent_actor(p_capability boolean, OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('doctor','nurse') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only a doctor or nurse records procedure consent' USING ERRCODE = '42501';
  END IF;
  IF p_capability AND NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_actor(boolean) FROM PUBLIC;--> statement-breakpoint

-- The open visit at the actor's branch, its examination, and an active plan of the visit's patient cluster,
-- locked. Not found otherwise; a closed visit is a conflict.
CREATE FUNCTION public.consent_target(a record, p_visit uuid, p_plan uuid, OUT v public.visits, OUT e public.examinations, OUT c public.care_plans)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = v.tenant_id AND x.visit_id = v.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_examination' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO c FROM public.care_plans x WHERE x.tenant_id = v.tenant_id AND x.id = p_plan
     AND x.patient_id = ANY (public.patient_cluster(v.tenant_id, public.patient_canonical(v.tenant_id, v.patient_id))) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: plan not found' USING ERRCODE = 'P0002';
  END IF;
  IF c.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: plan_closed' USING ERRCODE = '55000';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_target(record, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The text to show before signing (and its hash, sent back at capture). Doctor or nurse of the visit's branch.
CREATE FUNCTION public.procedure_consent_text(p_visit uuid, p_plan uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.consent_actor(false);
  tg record := public.consent_target(a, p_visit, p_plan);
  c public.care_plans := tg.c;
  v_text text := public.consent_text_of(c.tenant_id, c.id);
BEGIN
  PERFORM public.audit_append('clinical_read', 'care_plan', c.id, 'success', 'consent_text_viewed');
  RETURN jsonb_build_object('text', v_text, 'content_hash', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'),
    'items', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('plan_item_id', t.id, 'stage', t.stage, 'catalog_version_id', t.catalog_version_id,
               'name', cv.name, 'qty', t.qty, 'dose_micro', t.dose_micro, 'dose_unit', t.dose_unit)) ORDER BY t.stage, t.catalog_version_id, t.id)
               FROM public.plan_items t JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
              WHERE t.tenant_id = c.tenant_id AND t.plan_id = c.id AND t.removed_at IS NULL), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.procedure_consent_text(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.procedure_consent_text(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- ── procedure_consent_capture (UX-39, PR-11, CLIN-022) ─────────────────────────────────────────────
-- The patient's or guardian's signature over the text shown (hash checked: a plan changed since is refused);
-- a guardian for a minor (branch-local date) or a newborn (DEC-050); supersedes the active consent; snapshots the
-- plan's active items; the visit's consent step → done. Returns the consent id.
CREATE FUNCTION public.procedure_consent_capture(p_visit uuid, p_plan uuid, p jsonb, p_signature bytea) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.consent_actor(true);
  tg record := public.consent_target(a, p_visit, p_plan);
  v public.visits := tg.v;
  e public.examinations := tg.e;
  c public.care_plans := tg.c;
  pt public.patients;
  v_today date;
  v_text text;
  v_prev public.procedure_consents;
  v_id uuid;
  v_guardian boolean;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'signer' - 'guardian_name' - 'guardian_relation' - 'expected_hash' <> '{}'::jsonb
     OR coalesce(p ->> 'signer', '') NOT IN ('patient','guardian') OR coalesce(p ->> 'expected_hash', '') !~ '^[0-9a-f]{64}$'
     OR (p ->> 'signer' = 'guardian') <> (p ? 'guardian_name' AND p ? 'guardian_relation')
     OR p ? 'guardian_name' AND length(btrim(coalesce(p ->> 'guardian_name', ''))) NOT BETWEEN 2 AND 120
     OR p ? 'guardian_relation' AND coalesce(p ->> 'guardian_relation', '') NOT IN ('ayah','ibu','wali','lainnya') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: consent' USING ERRCODE = '22023';
  END IF;
  IF p_signature IS NULL OR octet_length(p_signature) NOT BETWEEN 68 AND 204800
     OR substring(p_signature FROM 1 FOR 8) <> '\x89504e470d0a1a0a'::bytea OR substring(p_signature FROM 13 FOR 4) <> '\x49484452'::bytea THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: signature' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plan_items t WHERE t.tenant_id = c.tenant_id AND t.plan_id = c.id AND t.removed_at IS NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: empty_plan' USING ERRCODE = '22023';
  END IF;
  -- The guardian rule on the branch-local date (DEC-050).
  SELECT * INTO pt FROM public.patients WHERE tenant_id = v.tenant_id AND id = public.patient_canonical(v.tenant_id, v.patient_id);
  SELECT (clock_timestamp() AT TIME ZONE b.timezone)::date INTO v_today FROM public.branches b WHERE b.tenant_id = v.tenant_id AND b.id = v.branch_id;
  v_guardian := p ->> 'signer' = 'guardian';
  IF NOT v_guardian AND (pt.birth_date > (v_today - interval '18 years')::date OR pt.identity_type = 'newborn_via_guardian') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: guardian_required' USING ERRCODE = '22023';
  END IF;
  -- The text signed is the text shown: a plan changed since is refused.
  v_text := public.consent_text_of(c.tenant_id, c.id);
  IF encode(sha256(convert_to(v_text, 'UTF8')), 'hex') <> p ->> 'expected_hash' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: plan_changed' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_prev FROM public.procedure_consents x WHERE x.tenant_id = c.tenant_id AND x.plan_id = c.id AND x.state = 'active' FOR UPDATE;
  v_id := public.uuid_generate_v7();
  IF v_prev.id IS NOT NULL THEN
    UPDATE public.procedure_consents SET state = 'superseded', superseded_at = clock_timestamp(), superseded_by_id = v_id
     WHERE tenant_id = v_prev.tenant_id AND id = v_prev.id;
  END IF;
  INSERT INTO public.procedure_consents (id, tenant_id, branch_id, patient_id, visit_id, examination_id, plan_id, version, signer, guardian_name, guardian_relation,
                                         captured_by, captured_as, consent_text, content_hash, signature_png, signature_sha256, signature_size)
  VALUES (v_id, v.tenant_id, v.branch_id, pt.id, v.id, e.id, c.id,
          coalesce((SELECT max(version) FROM public.procedure_consents x WHERE x.tenant_id = c.tenant_id AND x.plan_id = c.id), 0) + 1,
          p ->> 'signer', CASE WHEN v_guardian THEN btrim(p ->> 'guardian_name') END, CASE WHEN v_guardian THEN p ->> 'guardian_relation' END,
          a.staff_id, a.role, v_text, encode(sha256(convert_to(v_text, 'UTF8')), 'hex'),
          p_signature, encode(sha256(p_signature), 'hex'), octet_length(p_signature));
  INSERT INTO public.procedure_consent_items (tenant_id, branch_id, consent_id, plan_item_id, stage, catalog_version_id, qty, dose_micro, dose_unit)
  SELECT v.tenant_id, v.branch_id, v_id, t.id, t.stage, t.catalog_version_id, t.qty, t.dose_micro, t.dose_unit
    FROM public.plan_items t WHERE t.tenant_id = c.tenant_id AND t.plan_id = c.id AND t.removed_at IS NULL;
  UPDATE public.visits SET consent = 'done' WHERE tenant_id = v.tenant_id AND id = v.id AND closed_at IS NULL AND consent <> 'done';
  PERFORM public.audit_append('sign', 'procedure_consent', v_id, 'success', 'consent_recorded');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v.branch_id, 'ConsentRecorded', 'procedure_consent', v_id,
          jsonb_strip_nulls(jsonb_build_object('consent_id', v_id, 'visit_id', v.id, 'plan_id', c.id, 'branch_id', v.branch_id,
                                               'superseded_id', v_prev.id, 'signer', p ->> 'signer')));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.procedure_consent_capture(uuid, uuid, jsonb, bytea) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.procedure_consent_capture(uuid, uuid, jsonb, bytea) TO clinic_app;--> statement-breakpoint

-- ── procedure_consent_withdraw: never blocked by the tenant lifecycle (PRIV-1) ─────────────────────
CREATE FUNCTION public.procedure_consent_withdraw(p_consent uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.consent_actor(false);
  k public.procedure_consents;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO k FROM public.procedure_consents x WHERE x.tenant_id = a.tenant_id AND x.id = p_consent FOR UPDATE;
  IF NOT FOUND OR k.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(k.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: consent not found' USING ERRCODE = 'P0002';
  END IF;
  IF k.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: consent_not_active' USING ERRCODE = '55000';
  END IF;
  UPDATE public.procedure_consents SET state = 'withdrawn', withdrawn_at = clock_timestamp(), withdrawn_by = a.staff_id, withdrawn_as = a.role,
         withdraw_reason = btrim(p_reason)
   WHERE tenant_id = k.tenant_id AND id = k.id;
  UPDATE public.visits SET consent = 'not_started' WHERE tenant_id = k.tenant_id AND id = k.visit_id AND closed_at IS NULL AND consent = 'done';
  PERFORM public.audit_append('sign', 'procedure_consent', k.id, 'success', 'consent_withdrawn');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (k.branch_id, 'ConsentWithdrawn', 'procedure_consent', k.id, jsonb_build_object('consent_id', k.id, 'visit_id', k.visit_id, 'plan_id', k.plan_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.procedure_consent_withdraw(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.procedure_consent_withdraw(uuid, text) TO clinic_app;--> statement-breakpoint

-- ── contraindication_review: the examining doctor clears or blocks one plan item for this examination ──
CREATE FUNCTION public.contraindication_review(p_exam uuid, p_item uuid, p_decision text, p_reason text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  e public.examinations;
  v public.visits;
  t public.plan_items;
  r public.contraindication_reviews;
  v_reason text := NULLIF(btrim(coalesce(p_reason, '')), '');
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'doctor' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the examining doctor reviews contraindications' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_decision, '') NOT IN ('cleared','blocked') OR p_decision = 'blocked' AND v_reason IS NULL
     OR v_reason IS NOT NULL AND length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: review' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = a.tenant_id AND x.id = p_exam;
  IF NOT FOUND OR e.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(e.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: examination not found' USING ERRCODE = 'P0002';
  END IF;
  IF e.author_id <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the examining doctor reviews contraindications' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = e.tenant_id AND x.id = e.visit_id;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  SELECT t2.* INTO t FROM public.plan_items t2 JOIN public.care_plans c ON c.tenant_id = t2.tenant_id AND c.id = t2.plan_id
   WHERE t2.tenant_id = e.tenant_id AND t2.id = p_item AND t2.removed_at IS NULL AND c.state = 'active'
     AND c.patient_id = ANY (public.patient_cluster(e.tenant_id, public.patient_canonical(e.tenant_id, e.patient_id)));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: plan item not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.contraindication_reviews x WHERE x.tenant_id = e.tenant_id AND x.examination_id = e.id AND x.plan_item_id = t.id FOR UPDATE;
  IF FOUND THEN
    IF (r.decision, r.reason) IS NOT DISTINCT FROM (p_decision, v_reason) THEN
      RETURN r.version;
    END IF;
    UPDATE public.contraindication_reviews SET decision = p_decision, reason = v_reason, version = r.version + 1, reviewed_by = a.staff_id, reviewed_at = clock_timestamp()
     WHERE tenant_id = r.tenant_id AND id = r.id RETURNING * INTO r;
  ELSE
    INSERT INTO public.contraindication_reviews (tenant_id, branch_id, examination_id, plan_item_id, decision, reason, reviewed_by)
    VALUES (e.tenant_id, e.branch_id, e.id, t.id, p_decision, v_reason, a.staff_id) RETURNING * INTO r;
  END IF;
  PERFORM public.audit_append('settings_change', 'examination', e.id, 'success', 'contraindication_reviewed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (e.branch_id, 'ContraindicationReviewed', 'examination', e.id,
          jsonb_build_object('examination_id', e.id, 'plan_item_id', t.id, 'decision', p_decision));
  RETURN r.version;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.contraindication_review(uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.contraindication_review(uuid, uuid, text, text) TO clinic_app;--> statement-breakpoint

-- ── The start gate (PR-11, CLIN-005, CLIN-022) ─────────────────────────────────────────────────────
-- The effective mode of a performer for one catalog version at a branch (DEC-047 (3), DEC-065), consistent with
-- booking_eligible (0061): over every clinical role the performer holds at the branch now —
--   services: a named staff row decides (capped by the best delegation floor among those roles); otherwise each
--   role row is capped by its role's floor, and the best wins;
--   non-service items: doctor performs, nurse supervised, therapist none; the best wins.
CREATE FUNCTION public.consent_mode(p_tenant uuid, p_branch uuid, p_staff uuid, p_version uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_kind text;
  v_category text;
  v_roles text[];
  v_named text;
  rank constant text[] := ARRAY['none','assists','supervised','performs'];
  v_best integer;
BEGIN
  SELECT it.kind, cv.category INTO v_kind, v_category
    FROM public.catalog_versions cv JOIN public.catalog_items it ON it.tenant_id = cv.tenant_id AND it.id = cv.item_id
   WHERE cv.tenant_id = p_tenant AND cv.id = p_version;
  v_roles := ARRAY(SELECT r FROM unnest(ARRAY['doctor','nurse','therapist']) r WHERE public.consent_staff_role(p_tenant, p_staff, p_branch, r));
  IF cardinality(v_roles) = 0 OR v_kind IS NULL THEN
    RETURN 'none';
  END IF;
  IF v_kind <> 'service' THEN
    SELECT max(array_position(rank, CASE r WHEN 'doctor' THEN 'performs' WHEN 'nurse' THEN 'supervised' ELSE 'none' END)) INTO v_best FROM unnest(v_roles) r;
    RETURN rank[v_best];
  END IF;
  SELECT e.mode INTO v_named FROM public.service_staff_eligibility e WHERE e.tenant_id = p_tenant AND e.version_id = p_version AND e.staff_id = p_staff;
  IF v_named IS NOT NULL THEN
    SELECT least(array_position(rank, v_named), max(array_position(rank, coalesce(d.max_mode, 'performs')))) INTO v_best
      FROM unnest(v_roles) r LEFT JOIN public.delegation_floor d ON d.category = v_category AND d.profession = r;
    RETURN rank[v_best];
  END IF;
  SELECT max(least(array_position(rank, e.mode), array_position(rank, coalesce(d.max_mode, 'performs')))) INTO v_best
    FROM unnest(v_roles) r
    JOIN public.service_staff_eligibility e ON e.tenant_id = p_tenant AND e.version_id = p_version AND e.role = r
    LEFT JOIN public.delegation_floor d ON d.category = v_category AND d.profession = r;
  RETURN coalesce(rank[v_best], 'none');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_mode(uuid, uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Whether a staff member's credentials have lapsed (a verified STR and a branch permit of one profession
-- exist, in force once, and one is now past its date) — expired vs missing (CLIN-005).
CREATE FUNCTION public.consent_credential_lapsed(p_tenant uuid, p_staff uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH b AS (SELECT (clock_timestamp() AT TIME ZONE timezone)::date AS d FROM public.branches WHERE tenant_id = p_tenant AND id = p_branch)
  SELECT EXISTS (
    SELECT 1 FROM public.staff_credentials s JOIN public.staff_credentials p ON p.tenant_id = s.tenant_id AND p.staff_id = s.staff_id AND p.profession = s.profession, b
     WHERE s.tenant_id = p_tenant AND s.staff_id = p_staff AND s.kind = 'str' AND s.state = 'verified'
       AND p.kind IN ('sip','sipp','sipa') AND p.branch_id = p_branch AND p.state = 'verified'
       AND s.valid_from <= b.d AND p.valid_from <= b.d
       AND (s.expires_on < b.d OR p.expires_on < b.d))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_credential_lapsed(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- treatment_start_check: whether these plan items may start now with this performer (and supervisor). Every
-- blocker is reported, in this order: examination_unsigned, credential_missing | credential_expired, not_eligible,
-- contraindication_unresolved, consent_missing | consent_mismatch. No writes; an audited clinical read.
CREATE FUNCTION public.treatment_start_check(p_visit uuid, p_items uuid[], p_performer uuid, p_supervisor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v public.visits;
  e public.examinations;
  v_plan uuid;
  k public.procedure_consents;
  b text[] := '{}';
  v_mode text;
  t public.plan_items;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role IN ('doctor','nurse','therapist','facility_head','records_officer') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not check treatment start' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_items IS NULL OR cardinality(p_items) = 0 OR p_performer IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: start_check' USING ERRCODE = '22023';
  END IF;
  -- The requested items: of one active plan of the visit's patient cluster.
  SELECT min(c.id::text)::uuid INTO v_plan FROM public.plan_items x JOIN public.care_plans c ON c.tenant_id = x.tenant_id AND c.id = x.plan_id
   WHERE x.tenant_id = v.tenant_id AND x.id = ANY (p_items) AND c.state = 'active'
     AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, public.patient_canonical(v.tenant_id, v.patient_id)))
  HAVING count(DISTINCT c.id) = 1 AND count(*) = cardinality(p_items);
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: plan items not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO e FROM public.examinations x WHERE x.tenant_id = v.tenant_id AND x.visit_id = v.id;
  IF e.id IS NULL OR e.state <> 'signed' THEN
    b := b || 'examination_unsigned'::text;
  END IF;
  IF NOT public.credential_valid(p_performer, v.branch_id, clock_timestamp()) THEN
    b := b || CASE WHEN public.consent_credential_lapsed(v.tenant_id, p_performer, v.branch_id) THEN 'credential_expired' ELSE 'credential_missing' END;
  END IF;
  FOR t IN SELECT * FROM public.plan_items x WHERE x.tenant_id = v.tenant_id AND x.id = ANY (p_items) ORDER BY x.stage, x.id LOOP
    v_mode := public.consent_mode(v.tenant_id, v.branch_id, p_performer, t.catalog_version_id);
    IF v_mode IN ('none','assists')
       OR v_mode = 'supervised' AND NOT (p_supervisor IS NOT NULL AND p_supervisor <> p_performer
                                         AND public.consent_staff_role(v.tenant_id, p_supervisor, v.branch_id, 'doctor')
                                         AND public.credential_valid(p_supervisor, v.branch_id, clock_timestamp())) THEN
      IF NOT 'not_eligible' = ANY (b) THEN b := b || 'not_eligible'::text; END IF;
    END IF;
    IF NOT 'contraindication_unresolved' = ANY (b) AND (
         EXISTS (SELECT 1 FROM public.contraindication_reviews r WHERE r.tenant_id = v.tenant_id AND r.examination_id = e.id AND r.plan_item_id = t.id AND r.decision = 'blocked')
         OR EXISTS (SELECT 1 FROM public.catalog_versions cv WHERE cv.tenant_id = v.tenant_id AND cv.id = t.catalog_version_id AND NULLIF(btrim(cv.contraindications), '') IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM public.contraindication_reviews r WHERE r.tenant_id = v.tenant_id AND r.examination_id = e.id AND r.plan_item_id = t.id AND r.decision = 'cleared')) THEN
      b := b || 'contraindication_unresolved'::text;
    END IF;
  END LOOP;
  -- Consent (PR-11, CLIN-022): the active consent covers the plan's active items per (stage, version, unit). A dose
  -- where none was consented is a group of another unit (dose_unit is set exactly when a dose is), so it has no match.
  SELECT * INTO k FROM public.procedure_consents x WHERE x.tenant_id = v.tenant_id AND x.plan_id = v_plan AND x.state = 'active';
  IF k.id IS NULL THEN
    b := b || 'consent_missing'::text;
  ELSIF EXISTS (SELECT 1 FROM public.plan_items x WHERE x.tenant_id = v.tenant_id AND x.id = ANY (p_items) AND x.removed_at IS NOT NULL)
     OR EXISTS (
       WITH plan AS (SELECT stage, catalog_version_id AS ver, coalesce(dose_unit, '') AS unit, sum(qty) AS qty, sum(dose_micro) AS dose
                       FROM public.plan_items WHERE tenant_id = v.tenant_id AND plan_id = v_plan AND removed_at IS NULL GROUP BY 1, 2, 3),
            cons AS (SELECT stage, catalog_version_id AS ver, coalesce(dose_unit, '') AS unit, sum(qty) AS qty, sum(dose_micro) AS dose
                       FROM public.procedure_consent_items WHERE tenant_id = k.tenant_id AND consent_id = k.id GROUP BY 1, 2, 3)
       SELECT 1 FROM plan LEFT JOIN cons USING (stage, ver, unit)
        WHERE cons.ver IS NULL OR plan.qty > cons.qty OR coalesce(plan.dose, 0) > coalesce(cons.dose, 0)) THEN
    b := b || 'consent_mismatch'::text;
  END IF;
  PERFORM public.audit_append('clinical_read', 'visit', v.id, 'success', 'treatment_start_checked');
  RETURN jsonb_build_object('ok', cardinality(b) = 0, 'blockers', to_jsonb(b), 'plan_id', v_plan, 'consent_id', k.id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.treatment_start_check(uuid, uuid[], uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.treatment_start_check(uuid, uuid[], uuid, uuid) TO clinic_app;--> statement-breakpoint

-- ── Readers for UX-39 ─────────────────────────────────────────────────────────────────────────────
-- The list: today's open visits at the branch (and closed today) with an examination and an active plan of the
-- patient, with each plan's consent state: none | active (covers the active items) | outdated (mismatch).
-- Doctor or nurse of the branch (wall clock).
CREATE FUNCTION public.consent_visits(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  b public.branches;
  today date;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT a.role IN ('doctor','nurse') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read Persetujuan Tindakan' USING ERRCODE = '42501';
  END IF;
  b := public.booking_branch(a.tenant_id, a.staff_id, a.role, p_branch);
  today := (clock_timestamp() AT TIME ZONE b.timezone)::date;
  RETURN jsonb_build_object('today', today, 'branch_name', b.name, 'visits', coalesce((
    SELECT jsonb_agg(jsonb_build_object('visit_id', v.id, 'checked_in_at', v.checked_in_at, 'closed', v.closed_at IS NOT NULL,
             'patient_name', pt.full_name, 'patient_mrn', pt.mrn, 'exam_state', e.state,
             'plans', (SELECT coalesce(jsonb_agg(jsonb_build_object('plan_id', c.id, 'title', c.title, 'consent', public.consent_state(c.tenant_id, c.id)) ORDER BY c.created_at, c.id), '[]'::jsonb)
                         FROM public.care_plans c WHERE c.tenant_id = v.tenant_id AND c.state = 'active'
                          AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, pt.id))
                          AND EXISTS (SELECT 1 FROM public.plan_items t WHERE t.tenant_id = c.tenant_id AND t.plan_id = c.id AND t.removed_at IS NULL)))
             ORDER BY v.checked_in_at, v.id)
      FROM public.visits v
      JOIN public.patients pt ON pt.tenant_id = v.tenant_id AND pt.id = public.patient_canonical(v.tenant_id, v.patient_id)
      JOIN public.examinations e ON e.tenant_id = v.tenant_id AND e.visit_id = v.id
     WHERE v.tenant_id = a.tenant_id AND v.branch_id = b.id
       AND (v.closed_at IS NULL AND (v.checked_in_at AT TIME ZONE b.timezone)::date = today OR (v.closed_at AT TIME ZONE b.timezone)::date = today)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_visits(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consent_visits(uuid) TO clinic_app;--> statement-breakpoint

-- none | active | outdated: whether the plan's active consent still covers its active items (the gate's rule).
CREATE FUNCTION public.consent_state(p_tenant uuid, p_plan uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN k.id IS NULL THEN 'none'
              WHEN EXISTS (
                WITH plan AS (SELECT stage, catalog_version_id AS ver, coalesce(dose_unit, '') AS unit, sum(qty) AS qty, sum(dose_micro) AS dose
                                FROM public.plan_items WHERE tenant_id = p_tenant AND plan_id = p_plan AND removed_at IS NULL GROUP BY 1, 2, 3),
                     cons AS (SELECT stage, catalog_version_id AS ver, coalesce(dose_unit, '') AS unit, sum(qty) AS qty, sum(dose_micro) AS dose
                                FROM public.procedure_consent_items WHERE tenant_id = k.tenant_id AND consent_id = k.id GROUP BY 1, 2, 3)
                SELECT 1 FROM plan LEFT JOIN cons USING (stage, ver, unit)
                 WHERE cons.ver IS NULL OR plan.qty > cons.qty OR coalesce(plan.dose, 0) > coalesce(cons.dose, 0)) THEN 'outdated'
              ELSE 'active' END
    FROM (SELECT p_tenant AS t) s
    LEFT JOIN public.procedure_consents k ON k.tenant_id = p_tenant AND k.plan_id = p_plan AND k.state = 'active'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_state(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- One visit's page: patient (and whether a guardian must sign), the examination state, each active plan with its
-- active items, consent state and history (no signature bytes). Doctor or nurse of the visit's branch; audited.
CREATE FUNCTION public.consent_visit(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v public.visits;
  pt public.patients;
  e public.examinations;
  v_today date;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR NOT a.role IN ('doctor','nurse') OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pt FROM public.patients WHERE tenant_id = v.tenant_id AND id = public.patient_canonical(v.tenant_id, v.patient_id);
  SELECT * INTO e FROM public.examinations WHERE tenant_id = v.tenant_id AND visit_id = v.id;
  SELECT (clock_timestamp() AT TIME ZONE b.timezone)::date INTO v_today FROM public.branches b WHERE b.tenant_id = v.tenant_id AND b.id = v.branch_id;
  PERFORM public.audit_append('clinical_read', 'visit', v.id, 'success', 'consent_viewed');
  RETURN jsonb_build_object(
    'visit', jsonb_build_object('id', v.id, 'closed', v.closed_at IS NOT NULL, 'consent', v.consent),
    'patient', jsonb_build_object('id', pt.id, 'name', pt.full_name, 'mrn', pt.mrn,
                                  'guardian_required', pt.birth_date > (v_today - interval '18 years')::date OR pt.identity_type = 'newborn_via_guardian'),
    'examination', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id', e.id, 'state', e.state, 'author_id', e.author_id) END,
    'plans', coalesce((SELECT jsonb_agg(jsonb_build_object('plan_id', c.id, 'title', c.title, 'consent', public.consent_state(c.tenant_id, c.id),
               'items', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('plan_item_id', t.id, 'stage', t.stage, 'name', cv.name, 'qty', t.qty,
                           'dose_micro', t.dose_micro, 'dose_unit', t.dose_unit, 'has_contraindications', NULLIF(btrim(cv.contraindications), '') IS NOT NULL,
                           'review', (SELECT r.decision FROM public.contraindication_reviews r WHERE r.tenant_id = t.tenant_id AND r.examination_id = e.id AND r.plan_item_id = t.id)))
                           ORDER BY t.stage, t.catalog_version_id, t.id), '[]'::jsonb)
                           FROM public.plan_items t JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
                          WHERE t.tenant_id = c.tenant_id AND t.plan_id = c.id AND t.removed_at IS NULL),
               'history', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('consent_id', k.id, 'version', k.version, 'state', k.state, 'signer', k.signer,
                           'guardian_name', k.guardian_name, 'captured_as', k.captured_as, 'captured_at', k.captured_at,
                           'captured_by_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = k.tenant_id AND s.id = k.captured_by),
                           'superseded_at', k.superseded_at, 'withdrawn_at', k.withdrawn_at, 'withdraw_reason', k.withdraw_reason)) ORDER BY k.version DESC), '[]'::jsonb)
                           FROM public.procedure_consents k WHERE k.tenant_id = c.tenant_id AND k.plan_id = c.id))
             ORDER BY c.created_at, c.id)
        FROM public.care_plans c WHERE c.tenant_id = v.tenant_id AND c.state = 'active' AND c.patient_id = ANY (public.patient_cluster(v.tenant_id, pt.id))), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_visit(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consent_visit(uuid) TO clinic_app;--> statement-breakpoint

-- The signature image of a consent, for the clinical readers of its branch only; audited media view.
CREATE FUNCTION public.consent_signature(p_consent uuid) RETURNS bytea
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  k public.procedure_consents;
BEGIN
  SELECT * INTO k FROM public.procedure_consents x WHERE x.tenant_id = public.app_tenant_id() AND x.id = p_consent;
  IF NOT FOUND OR NOT public.consent_readable(k.tenant_id, k.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: consent not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('media_view', 'procedure_consent', k.id, 'success', 'consent_signature_viewed');
  RETURN k.signature_png;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consent_signature(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consent_signature(uuid) TO clinic_app;
