CREATE TABLE "clinical_media" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"examination_id" uuid,
	"kind" text NOT NULL,
	"angle" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removed_as" text,
	"removed_reason" text,
	CONSTRAINT "clinical_media_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "clinical_media_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "clinical_media_kind_check" CHECK ("clinical_media"."kind" in ('photo','document') and "clinical_media"."content_type" in ('image/jpeg','image/png','application/pdf')
      and ("clinical_media"."kind" <> 'photo' or "clinical_media"."content_type" in ('image/jpeg','image/png'))
      and (("clinical_media"."kind" = 'photo') = ("clinical_media"."angle" is not null and "clinical_media"."width" is not null and "clinical_media"."height" is not null))
      and ("clinical_media"."angle" is null or "clinical_media"."angle" in ('depan','serong_45','samping','atas','bawah','dekat'))
      and (("clinical_media"."width" is null and "clinical_media"."height" is null) or ("clinical_media"."width" between 1 and 20000 and "clinical_media"."height" between 1 and 20000))),
	CONSTRAINT "clinical_media_file_check" CHECK ("clinical_media"."size_bytes" between 1 and 5242880 and "clinical_media"."sha256" ~ '^[0-9a-f]{64}$'
      and "clinical_media"."object_key" = 'tenants/' || "clinical_media"."tenant_id"::text || '/clinical-media/' || "clinical_media"."sha256"
      and length(btrim("clinical_media"."file_name")) between 1 and 200 and "clinical_media"."file_name" !~ '[/\\]'),
	CONSTRAINT "clinical_media_uploader_check" CHECK ("clinical_media"."uploaded_as" in ('bc','doctor','nurse') and ("clinical_media"."uploaded_as" <> 'bc' or "clinical_media"."kind" = 'photo')),
	CONSTRAINT "clinical_media_removed_check" CHECK (num_nonnulls("clinical_media"."removed_at", "clinical_media"."removed_by", "clinical_media"."removed_as", "clinical_media"."removed_reason") in (0, 4)
      and ("clinical_media"."removed_reason" is null or length(btrim("clinical_media"."removed_reason")) between 3 and 500))
);
--> statement-breakpoint
CREATE TABLE "clinical_media_blobs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "clinical_media_blobs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "clinical_media_blobs_sha_key" UNIQUE("tenant_id","sha256"),
	CONSTRAINT "clinical_media_blobs_check" CHECK ("clinical_media_blobs"."content_type" in ('image/jpeg','image/png','application/pdf') and "clinical_media_blobs"."sha256" = encode(sha256("clinical_media_blobs"."content"), 'hex')
      and "clinical_media_blobs"."size_bytes" = octet_length("clinical_media_blobs"."content") and "clinical_media_blobs"."size_bytes" between 1 and 5242880)
);
--> statement-breakpoint
CREATE TABLE "media_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"acting_role" text NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "media_tokens_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "media_tokens_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "media_tokens_check" CHECK ("media_tokens"."purpose" in ('view','download') and "media_tokens"."token_hash" ~ '^[0-9a-f]{64}$'
      and "media_tokens"."expires_at" > "media_tokens"."issued_at" and "media_tokens"."expires_at" <= "media_tokens"."issued_at" + interval '10 minutes'
      and "media_tokens"."used_count" >= 0 and (("media_tokens"."used_count" = 0) = ("media_tokens"."last_used_at" is null)))
);
--> statement-breakpoint
ALTER TABLE "clinical_media" ADD CONSTRAINT "clinical_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_media" ADD CONSTRAINT "clinical_media_visit_fk" FOREIGN KEY ("tenant_id","branch_id","visit_id") REFERENCES "public"."visits"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_media" ADD CONSTRAINT "clinical_media_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_media" ADD CONSTRAINT "clinical_media_exam_fk" FOREIGN KEY ("tenant_id","branch_id","examination_id") REFERENCES "public"."examinations"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_media" ADD CONSTRAINT "clinical_media_by_fk" FOREIGN KEY ("tenant_id","uploaded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_media" ADD CONSTRAINT "clinical_media_removed_by_fk" FOREIGN KEY ("tenant_id","removed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_media_blobs" ADD CONSTRAINT "clinical_media_blobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_tokens" ADD CONSTRAINT "media_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_tokens" ADD CONSTRAINT "media_tokens_media_fk" FOREIGN KEY ("tenant_id","branch_id","media_id") REFERENCES "public"."clinical_media"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_tokens" ADD CONSTRAINT "media_tokens_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_media_patient_idx" ON "clinical_media" USING btree ("tenant_id","patient_id","taken_at");--> statement-breakpoint
CREATE INDEX "clinical_media_visit_idx" ON "clinical_media" USING btree ("tenant_id","visit_id");;--> statement-breakpoint

-- T-055 rules (generated by gen.py; plan docs/tasks/T-055.md)
-- Private clinical media (PR-32, CLIN-015, CLIN-021, CLIN-026; plan Argon r1 6074b48f adopted, r2 fac2378b APPROVE).
-- Metadata in clinical_media; bytes content-addressed in clinical_media_blobs (the DB MediaStore; S3 later by
-- configuration, ARCH-9); access only by short-lived tokens whose sha256 is stored (media_tokens).

-- Read helper (invoker, wall clock; plan open points 2–3): doctor, nurse, therapist, facility head, records
-- officer read photos and documents; BC reads photos only — at a branch allowed in the session and held by the
-- acting role now ("assignment", CLIN-026). Pharmacist and every non-clinical role: never (CLIN-021).
CREATE FUNCTION public.media_readable(p_tenant uuid, p_branch uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id()
    AND (public.app_role_in(ARRAY['doctor','nurse','therapist','facility_head','records_officer']) OR public.app_role_in(ARRAY['bc']) AND p_kind = 'photo')
    AND public.app_branch_allowed(p_branch)
    AND EXISTS (
      SELECT 1 FROM public.staff s
        JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
        JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role = public.app_acting_role() AND sb.branch_id = p_branch
       WHERE s.tenant_id = p_tenant AND s.id = public.app_staff_id()
         AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_readable(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_readable(uuid, uuid, text) TO clinic_app;--> statement-breakpoint

-- The type of a file from its first bytes (PDF, PNG, JPEG), or NULL.
CREATE FUNCTION public.media_sniff(p bytea) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN substring(p FROM 1 FOR 5) = '\x255044462d'::bytea THEN 'application/pdf'
    WHEN substring(p FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea AND substring(p FROM 13 FOR 4) = '\x49484452'::bytea THEN 'image/png'
    WHEN substring(p FROM 1 FOR 3) = '\xffd8ff'::bytea THEN 'image/jpeg'
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_sniff(bytea) FROM PUBLIC;--> statement-breakpoint

-- The clinical reader check for media reads (CLIN-021 first: a non-clinical acting role is forbidden whatever the
-- id). Only the session's acting role and tenant are read here: a reader who lost the branch role (CLIN-026)
-- passes this check and then sees nothing (media_readable is false on the wall clock).
CREATE FUNCTION public.media_reader() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.app_tenant_id() IS NULL OR public.app_staff_id() IS NULL
     OR NOT coalesce(public.app_role_in(ARRAY['doctor','nurse','therapist','facility_head','records_officer','bc']), false) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read clinical media' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: clinical reads are not available' USING ERRCODE = '42501';
  END IF;
  RETURN public.app_tenant_id();
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_reader() FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.clinical_media ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinical_media_read ON public.clinical_media FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND removed_at IS NULL AND public.media_readable(tenant_id, branch_id, kind));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, patient_id, visit_id, examination_id, kind, angle, content_type, size_bytes, width, height, taken_at, uploaded_by, uploaded_as, created_at)
  ON public.clinical_media TO clinic_app;--> statement-breakpoint
CREATE POLICY clinical_media_operator_read ON public.clinical_media FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.clinical_media', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, patient_id, visit_id, examination_id, kind, angle, content_type, size_bytes, width, height, taken_at, uploaded_by, uploaded_as, created_at)
  ON public.clinical_media TO clinic_operator;--> statement-breakpoint
-- Bytes and tokens: RLS on, no policy and no grant for any app role (support class never); definers only.
ALTER TABLE public.clinical_media_blobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.media_tokens ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER clinical_media_no_truncate BEFORE TRUNCATE ON public.clinical_media FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.clinical_media ENABLE ALWAYS TRIGGER clinical_media_no_truncate;--> statement-breakpoint
CREATE TRIGGER clinical_media_blobs_no_truncate BEFORE TRUNCATE ON public.clinical_media_blobs FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.clinical_media_blobs ENABLE ALWAYS TRIGGER clinical_media_blobs_no_truncate;--> statement-breakpoint
CREATE TRIGGER media_tokens_no_truncate BEFORE TRUNCATE ON public.media_tokens FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.media_tokens ENABLE ALWAYS TRIGGER media_tokens_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.clinical_media', 'clinical', 'clinical', '{doctor,nurse,therapist,facility_head,records_officer,bc}', 'media_add, media_remove (src/modules/clinical/media)', 'the visit''s branch'),
  ('public.clinical_media_blobs', 'clinical', 'clinical', '{}', 'media_blob_put, media_blob_get (src/modules/clinical/media)', 'none (content-addressed per tenant)'),
  ('public.media_tokens', 'clinical', 'clinical', '{}', 'media_token_issue, media_token_redeem (src/modules/clinical/media)', 'the media''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): metadata clinical; bytes and tokens never.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.clinical_media', 'clinical'), ('public.clinical_media_blobs', 'never'), ('public.media_tokens', 'never');--> statement-breakpoint

-- ── Guards (plan r1 P1-3): staff_access lock first, ENABLE ALWAYS ───────────────────────────────────
-- clinical_media: never deleted; identity and file immutable; removal once (all four removal columns), never
-- while its examination is signed. Blobs: insert-only. Tokens: never deleted; only the use counter moves.
CREATE FUNCTION public.media_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || (coalesce(n, o) ->> 'tenant_id'), 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical media are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'clinical_media' AND n ->> 'removed_at' IS NOT NULL THEN
      RAISE EXCEPTION 'media open present' USING ERRCODE = '42501';
    END IF;
    IF TG_TABLE_NAME = 'media_tokens' AND (n ->> 'used_count')::integer <> 0 THEN
      RAISE EXCEPTION 'a token opens unused' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'clinical_media_blobs' THEN
    RAISE EXCEPTION 'media bytes never change' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'media_tokens' THEN
    IF (n ->> 'used_count')::integer <> (o ->> 'used_count')::integer + 1 OR n ->> 'last_used_at' IS NULL
       OR n - 'used_count' - 'last_used_at' IS DISTINCT FROM o - 'used_count' - 'last_used_at' THEN
      RAISE EXCEPTION 'a token changes only by use' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF o ->> 'removed_at' IS NOT NULL OR n ->> 'removed_at' IS NULL
     OR n - 'removed_at' - 'removed_by' - 'removed_as' - 'removed_reason' IS DISTINCT FROM o - 'removed_at' - 'removed_by' - 'removed_as' - 'removed_reason' THEN
    RAISE EXCEPTION 'media change only by removal, once' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.examinations e WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.examination_id AND e.state = 'signed') THEN
    RAISE EXCEPTION 'media of a signed examination are final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER clinical_media_guard BEFORE INSERT OR UPDATE OR DELETE ON public.clinical_media FOR EACH ROW EXECUTE FUNCTION public.media_guard();--> statement-breakpoint
ALTER TABLE public.clinical_media ENABLE ALWAYS TRIGGER clinical_media_guard;--> statement-breakpoint
CREATE TRIGGER clinical_media_blobs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.clinical_media_blobs FOR EACH ROW EXECUTE FUNCTION public.media_guard();--> statement-breakpoint
ALTER TABLE public.clinical_media_blobs ENABLE ALWAYS TRIGGER clinical_media_blobs_guard;--> statement-breakpoint
CREATE TRIGGER media_tokens_guard BEFORE INSERT OR UPDATE OR DELETE ON public.media_tokens FOR EACH ROW EXECUTE FUNCTION public.media_guard();--> statement-breakpoint
ALTER TABLE public.media_tokens ENABLE ALWAYS TRIGGER media_tokens_guard;--> statement-breakpoint

-- ── The uploader actor: actor lock first, then BC / doctor / nurse and the capability ──────────────
CREATE FUNCTION public.media_uploader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('bc','doctor','nurse') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not add clinical media' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot serve visits now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_uploader() FROM PUBLIC;--> statement-breakpoint

-- ── DbMediaStore.put: the bytes, content-addressed per tenant (the same bytes twice are stored once) ──
-- Checks the type from the bytes, the size and the sha256 the caller computed. Returns the object key.
CREATE FUNCTION public.media_blob_put(p_sha256 text, p_content_type text, p_content bytea) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.media_uploader();
BEGIN
  IF p_content IS NULL OR octet_length(p_content) NOT BETWEEN 1 AND 5242880 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: size' USING ERRCODE = '22023';
  END IF;
  IF public.media_sniff(p_content) IS DISTINCT FROM p_content_type THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: type' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_sha256, '') <> encode(sha256(p_content), 'hex') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: checksum' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.clinical_media_blobs (tenant_id, sha256, content_type, size_bytes, content)
  VALUES (a.tenant_id, p_sha256, p_content_type, octet_length(p_content), p_content)
  ON CONFLICT (tenant_id, sha256) DO NOTHING;
  RETURN 'tenants/' || a.tenant_id::text || '/clinical-media/' || p_sha256;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_blob_put(text, text, bytea) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_blob_put(text, text, bytea) TO clinic_app;--> statement-breakpoint

-- ── media_add: the metadata of a stored file for an open visit at the actor's branch ─────────────────
-- p: {kind, angle?, width?, height?, sha256, content_type, size_bytes, file_name, taken_at?, examination_id?}.
-- The stored object must exist with the same type and size (the DB store; an S3 store is checked by the
-- adapter). BC adds photos only. An examination named must be the visit's draft.
CREATE FUNCTION public.media_add(p_visit uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.media_uploader();
  v public.visits;
  v_exam uuid;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'kind' - 'angle' - 'width' - 'height' - 'sha256' - 'content_type' - 'size_bytes' - 'file_name' - 'taken_at' - 'examination_id' <> '{}'::jsonb
     OR coalesce(p ->> 'kind', '') NOT IN ('photo','document')
     OR (p ->> 'kind' = 'photo') <> (p ? 'angle' AND p ? 'width' AND p ? 'height')
     OR p ? 'width' AND (jsonb_typeof(p -> 'width') <> 'number' OR (p ->> 'width') !~ '^[0-9]{1,5}$')
     OR p ? 'height' AND (jsonb_typeof(p -> 'height') <> 'number' OR (p ->> 'height') !~ '^[0-9]{1,5}$')
     OR jsonb_typeof(p -> 'size_bytes') IS DISTINCT FROM 'number' OR (p ->> 'size_bytes') !~ '^[0-9]{1,7}$'
     OR coalesce(p ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     OR p ? 'examination_id' AND coalesce(p ->> 'examination_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p ? 'taken_at' AND coalesce(p ->> 'taken_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: media' USING ERRCODE = '22023';
  END IF;
  IF a.role = 'bc' AND p ->> 'kind' <> 'photo' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a BC adds photos only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR v.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(v.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clinical_media_blobs b WHERE b.tenant_id = a.tenant_id AND b.sha256 = p ->> 'sha256'
                   AND b.content_type = p ->> 'content_type' AND b.size_bytes = (p ->> 'size_bytes')::integer) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: object_missing' USING ERRCODE = '22023';
  END IF;
  v_exam := (p ->> 'examination_id')::uuid;
  IF v_exam IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.examinations e WHERE e.tenant_id = v.tenant_id AND e.id = v_exam AND e.visit_id = v.id AND e.state = 'draft') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: examination_not_draft' USING ERRCODE = '55000';
  END IF;
  BEGIN
    INSERT INTO public.clinical_media (tenant_id, branch_id, patient_id, visit_id, examination_id, kind, angle, content_type, size_bytes, width, height,
                                       sha256, object_key, file_name, taken_at, uploaded_by, uploaded_as)
    VALUES (v.tenant_id, v.branch_id, public.patient_canonical(v.tenant_id, v.patient_id), v.id, v_exam, p ->> 'kind', p ->> 'angle', p ->> 'content_type',
            (p ->> 'size_bytes')::integer, (p ->> 'width')::integer, (p ->> 'height')::integer, p ->> 'sha256',
            'tenants/' || v.tenant_id::text || '/clinical-media/' || (p ->> 'sha256'), btrim(coalesce(p ->> 'file_name', '')),
            coalesce((p ->> 'taken_at')::timestamptz, clock_timestamp()), a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: media' USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'clinical_media', v_id, 'success', 'media_uploaded');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v.branch_id, 'ClinicalMediaAdded', 'clinical_media', v_id,
          jsonb_strip_nulls(jsonb_build_object('media_id', v_id, 'visit_id', v.id, 'branch_id', v.branch_id, 'kind', p ->> 'kind', 'angle', p ->> 'angle')));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_add(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_add(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── media_remove: the uploader or a facility head hides a mistaken upload (reason); never deletes ───
CREATE FUNCTION public.media_remove(p_media uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  m public.clinical_media;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('bc','doctor','nurse','facility_head') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not remove clinical media' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.clinical_media x WHERE x.tenant_id = a.tenant_id AND x.id = p_media FOR UPDATE;
  IF NOT FOUND OR m.removed_at IS NOT NULL OR m.branch_id IS DISTINCT FROM a.branch_id OR NOT public.app_branch_allowed(m.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: media not found' USING ERRCODE = 'P0002';
  END IF;
  IF a.role <> 'facility_head' AND m.uploaded_by <> a.staff_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the uploader or a facility head removes' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.examinations e WHERE e.tenant_id = m.tenant_id AND e.id = m.examination_id AND e.state = 'signed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: examination_signed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.clinical_media SET removed_at = clock_timestamp(), removed_by = a.staff_id, removed_as = a.role, removed_reason = btrim(p_reason)
   WHERE tenant_id = m.tenant_id AND id = m.id;
  PERFORM public.audit_append('settings_change', 'clinical_media', m.id, 'success', 'media_removed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (m.branch_id, 'ClinicalMediaRemoved', 'clinical_media', m.id, jsonb_build_object('media_id', m.id, 'visit_id', m.visit_id, 'branch_id', m.branch_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_remove(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_remove(uuid, text) TO clinic_app;--> statement-breakpoint

-- ── Tokens (PR-32, SEC-2): issue stores only the hash; ≤ 600 s; bound to the staff and acting role ───
CREATE FUNCTION public.media_token_issue(p_media uuid, p_purpose text, p_token_hash text, p_ttl_seconds integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  m public.clinical_media;
  t public.media_tokens;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('doctor','nurse','therapist','facility_head','records_officer','bc') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read clinical media' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: clinical reads are not available' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_purpose, '') NOT IN ('view','download') OR coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
     OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: token' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.clinical_media x WHERE x.tenant_id = a.tenant_id AND x.id = p_media;
  IF NOT FOUND OR m.removed_at IS NOT NULL OR NOT public.media_readable(m.tenant_id, m.branch_id, m.kind) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: media not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.media_tokens (tenant_id, branch_id, media_id, staff_id, acting_role, token_hash, purpose, issued_at, expires_at)
  VALUES (m.tenant_id, m.branch_id, m.id, a.staff_id, a.role, p_token_hash, p_purpose, clock_timestamp(), clock_timestamp() + make_interval(secs => p_ttl_seconds))
  RETURNING * INTO t;
  PERFORM public.audit_append('clinical_read', 'clinical_media', m.id, 'success', 'media_token_issued');
  RETURN jsonb_build_object('token_id', t.id, 'expires_at', t.expires_at);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_token_issue(uuid, text, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_token_issue(uuid, text, text, integer) TO clinic_app;--> statement-breakpoint

-- Redeem: the caller's own live token; access re-checked now (CLIN-026); an expired token is refused
-- (PR-32). Counts the use and audits a view or download. Returns the metadata to fetch and serve the bytes.
CREATE FUNCTION public.media_token_redeem(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  t public.media_tokens;
  m public.clinical_media;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('doctor','nurse','therapist','facility_head','records_officer','bc') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read clinical media' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('clinical_read') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: clinical reads are not available' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.media_tokens x WHERE x.token_hash = coalesce(p_token_hash, '') AND x.tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND OR t.staff_id <> a.staff_id OR t.acting_role <> a.role THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: link not found' USING ERRCODE = 'P0002';
  END IF;
  IF clock_timestamp() > t.expires_at THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: link_expired' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.clinical_media x WHERE x.tenant_id = t.tenant_id AND x.id = t.media_id;
  IF m.removed_at IS NOT NULL OR NOT public.media_readable(m.tenant_id, m.branch_id, m.kind) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: access_revoked' USING ERRCODE = '42501';
  END IF;
  UPDATE public.media_tokens SET used_count = used_count + 1, last_used_at = clock_timestamp() WHERE tenant_id = t.tenant_id AND id = t.id;
  PERFORM public.audit_append(CASE WHEN t.purpose = 'download' THEN 'media_download' ELSE 'media_view' END, 'clinical_media', m.id, 'success',
                              CASE WHEN t.purpose = 'download' THEN 'media_downloaded' ELSE 'media_viewed' END);
  RETURN jsonb_build_object('media_id', m.id, 'purpose', t.purpose, 'content_type', m.content_type, 'size_bytes', m.size_bytes,
                            'sha256', m.sha256, 'object_key', m.object_key, 'file_name', m.file_name);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_token_redeem(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_token_redeem(text) TO clinic_app;--> statement-breakpoint

-- DbMediaStore.get: the bytes of a token the caller redeemed (used at least once, still live, still readable).
CREATE FUNCTION public.media_blob_get(p_token_hash text) RETURNS bytea
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b bytea;
BEGIN
  SELECT bl.content INTO b
    FROM public.media_tokens t
    JOIN public.clinical_media m ON m.tenant_id = t.tenant_id AND m.id = t.media_id
    JOIN public.clinical_media_blobs bl ON bl.tenant_id = m.tenant_id AND bl.sha256 = m.sha256
   WHERE t.token_hash = coalesce(p_token_hash, '') AND t.tenant_id = public.app_tenant_id()
     AND t.staff_id = public.app_staff_id() AND t.acting_role = public.app_acting_role()
     AND t.used_count >= 1 AND clock_timestamp() <= t.expires_at
     AND m.removed_at IS NULL AND public.media_readable(m.tenant_id, m.branch_id, m.kind);
  IF b IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: media not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN b;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_blob_get(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_blob_get(text) TO clinic_app;--> statement-breakpoint

-- ── Readers (no bytes, no tokens) ──────────────────────────────────────────────────────────────────
-- media_list: the media of a patient's merge cluster (optionally one visit) the caller may read now, newest
-- first. Non-clinical roles: forbidden (CLIN-021); a reader without the branch now: empty (CLIN-026).
CREATE FUNCTION public.media_list(p_patient uuid, p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.media_reader();
  v_canon uuid := public.patient_canonical(v_tenant, p_patient);
  r jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m.id, 'visit_id', m.visit_id, 'branch_id', m.branch_id, 'examination_id', m.examination_id,
           'kind', m.kind, 'angle', m.angle, 'content_type', m.content_type, 'size_bytes', m.size_bytes, 'width', m.width, 'height', m.height,
           'file_name', m.file_name, 'taken_at', m.taken_at, 'uploaded_by', m.uploaded_by, 'uploaded_as', m.uploaded_as)) ORDER BY m.taken_at DESC, m.id), '[]'::jsonb)
    INTO r
    FROM public.clinical_media m
   WHERE m.tenant_id = v_tenant AND m.patient_id = ANY (public.patient_cluster(v_tenant, v_canon))
     AND (p_visit IS NULL OR m.visit_id = p_visit)
     AND m.removed_at IS NULL AND public.media_readable(m.tenant_id, m.branch_id, m.kind);
  -- Audited when something is shown (a reader who lost the branch sees nothing and no longer holds the
  -- branch the audit row would need, CLIN-026).
  IF r <> '[]'::jsonb THEN
    PERFORM public.audit_append('clinical_read', 'patient', v_canon, 'success', 'media_listed');
  END IF;
  RETURN r;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_list(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_list(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- media_compare (CLIN-015): two different readable photos of the same canonical patient. Warns with reasons;
-- never a score, grade or percentage (CLIN-013). Integer rules only:
--   angle_differs; angle_not_in_protocol (SET-29 now); aspect_differs (> 5 % by cross-multiplication);
--   time_too_close (< 24 h apart).
CREATE FUNCTION public.media_compare(p_a uuid, p_b uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.media_reader();
  ma public.clinical_media;
  mb public.clinical_media;
  x public.clinical_media;
  v_protocol jsonb;
  v_reasons text[] := '{}';
  wa bigint;
  wb bigint;
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: compare' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO ma FROM public.clinical_media m WHERE m.tenant_id = v_tenant AND m.id = p_a;
  SELECT * INTO mb FROM public.clinical_media m WHERE m.tenant_id = v_tenant AND m.id = p_b;
  IF ma.id IS NULL OR mb.id IS NULL OR ma.removed_at IS NOT NULL OR mb.removed_at IS NOT NULL
     OR NOT public.media_readable(ma.tenant_id, ma.branch_id, ma.kind) OR NOT public.media_readable(mb.tenant_id, mb.branch_id, mb.kind) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: media not found' USING ERRCODE = 'P0002';
  END IF;
  IF ma.kind <> 'photo' OR mb.kind <> 'photo'
     OR public.patient_canonical(v_tenant, ma.patient_id) <> public.patient_canonical(v_tenant, mb.patient_id) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: compare' USING ERRCODE = '22023';
  END IF;
  IF mb.taken_at < ma.taken_at OR mb.taken_at = ma.taken_at AND mb.id < ma.id THEN
    x := ma; ma := mb; mb := x;
  END IF;
  v_protocol := public.setting_value_at('SET-29', NULL, clock_timestamp());
  IF ma.angle <> mb.angle THEN
    v_reasons := v_reasons || 'angle_differs'::text;
  END IF;
  IF NOT (coalesce(v_protocol, '[]'::jsonb) @> to_jsonb(ma.angle) AND coalesce(v_protocol, '[]'::jsonb) @> to_jsonb(mb.angle)) THEN
    v_reasons := v_reasons || 'angle_not_in_protocol'::text;
  END IF;
  wa := ma.width::bigint * mb.height::bigint;
  wb := mb.width::bigint * ma.height::bigint;
  IF abs(wa - wb) * 20 > greatest(wa, wb) THEN
    v_reasons := v_reasons || 'aspect_differs'::text;
  END IF;
  IF mb.taken_at - ma.taken_at < interval '24 hours' THEN
    v_reasons := v_reasons || 'time_too_close'::text;
  END IF;
  PERFORM public.audit_append('clinical_read', 'clinical_media', ma.id, 'success', 'media_compared');
  RETURN jsonb_build_object('status', CASE WHEN cardinality(v_reasons) = 0 THEN 'comparable' ELSE 'warning' END,
                            'comparable', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons),
                            'earlier', jsonb_build_object('id', ma.id, 'angle', ma.angle, 'taken_at', ma.taken_at, 'width', ma.width, 'height', ma.height),
                            'later', jsonb_build_object('id', mb.id, 'angle', mb.angle, 'taken_at', mb.taken_at, 'width', mb.width, 'height', mb.height));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.media_compare(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.media_compare(uuid, uuid) TO clinic_app;
