CREATE TABLE "data_subject_request_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"link_kind" text NOT NULL,
	"link_id" uuid NOT NULL,
	"handoff_ref" text,
	"addresses_request" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "dsr_links_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dsr_links_kind_check" CHECK ("data_subject_request_links"."link_kind" in ('record_copy','record_version','record_correction','consent_withdrawal')
      and (("data_subject_request_links"."link_kind" = 'record_copy') = ("data_subject_request_links"."handoff_ref" is not null))
      and ("data_subject_request_links"."handoff_ref" is null or length(btrim("data_subject_request_links"."handoff_ref")) between 3 and 200)
      and ("data_subject_request_links"."link_kind" not in ('record_version','record_correction') or "data_subject_request_links"."addresses_request" = true))
);
--> statement-breakpoint
ALTER TABLE "data_subject_request_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid,
	"requester_kind" text NOT NULL,
	"right" text NOT NULL,
	"correction_scope" text,
	"requested_purposes" text[],
	"channel" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"identity_method" text,
	"identity_verified_by" uuid,
	"assigned_to" uuid,
	"state" text DEFAULT 'received' NOT NULL,
	"outcome" text,
	"outcome_basis_code" text,
	"outcome_note" text,
	"delivery_channel" text,
	"delivery_confirmed_at" timestamp with time zone,
	"delivery_actor" uuid,
	"delivery_ref" text,
	"withdrawal_source" text,
	"withdrawal_attestation" text,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"command_key" text NOT NULL,
	"input_sha256" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "dsr_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dsr_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "dsr_kind_check" CHECK ("data_subject_requests"."requester_kind" in ('patient','guardian','representative')
      and "data_subject_requests"."right" in ('access','correction','consent_withdrawal','restriction','erasure')
      and "data_subject_requests"."channel" in ('in_person','paper','whatsapp','phone','email')
      and (("data_subject_requests"."right" = 'correction') = ("data_subject_requests"."correction_scope" is not null))
      and ("data_subject_requests"."correction_scope" is null or "data_subject_requests"."correction_scope" in ('demographic','clinical'))
      and (("data_subject_requests"."right" = 'restriction') = ("data_subject_requests"."requested_purposes" is not null))
      and ("data_subject_requests"."requested_purposes" is null or (cardinality("data_subject_requests"."requested_purposes") between 1 and 2 and "data_subject_requests"."requested_purposes" <@ array['marketing_wa','publication']::text[]))),
	CONSTRAINT "dsr_deadline_check" CHECK (isfinite("data_subject_requests"."received_at") and isfinite("data_subject_requests"."deadline_at") and "data_subject_requests"."deadline_at" = "data_subject_requests"."received_at" + interval '72 hours' and "data_subject_requests"."received_at" <= "data_subject_requests"."created_at"),
	CONSTRAINT "dsr_identity_check" CHECK ((("data_subject_requests"."identity_verified_at" is null) = ("data_subject_requests"."identity_method" is null))
      and (("data_subject_requests"."identity_verified_at" is null) = ("data_subject_requests"."identity_verified_by" is null))
      and ("data_subject_requests"."identity_verified_at" is null or (isfinite("data_subject_requests"."identity_verified_at") and "data_subject_requests"."identity_verified_at" >= "data_subject_requests"."received_at"))
      and ("data_subject_requests"."identity_method" is null
        or "data_subject_requests"."requester_kind" = 'patient' and "data_subject_requests"."identity_method" in ('ktp_in_person','ktp_video')
        or "data_subject_requests"."requester_kind" = 'guardian' and "data_subject_requests"."identity_method" = 'guardian_document'
        or "data_subject_requests"."requester_kind" = 'representative' and "data_subject_requests"."identity_method" = 'power_of_attorney')),
	CONSTRAINT "dsr_state_check" CHECK ("data_subject_requests"."state" in ('received','in_progress','closed')
      and (("data_subject_requests"."state" = 'received') = ("data_subject_requests"."identity_verified_at" is null and "data_subject_requests"."closed_at" is null))
      and (("data_subject_requests"."state" = 'in_progress') = ("data_subject_requests"."identity_verified_at" is not null and "data_subject_requests"."closed_at" is null))
      and (("data_subject_requests"."state" = 'closed') = ("data_subject_requests"."closed_at" is not null))
      and (("data_subject_requests"."closed_at" is null) = ("data_subject_requests"."closed_by" is null))
      and (("data_subject_requests"."closed_at" is null) = ("data_subject_requests"."outcome" is null))
      and (("data_subject_requests"."closed_at" is null) = ("data_subject_requests"."outcome_basis_code" is null))),
	CONSTRAINT "dsr_outcome_check" CHECK (("data_subject_requests"."outcome" is null and "data_subject_requests"."outcome_basis_code" is null and "data_subject_requests"."outcome_note" is null
        and "data_subject_requests"."delivery_channel" is null and "data_subject_requests"."delivery_confirmed_at" is null and "data_subject_requests"."delivery_actor" is null and "data_subject_requests"."delivery_ref" is null
        and "data_subject_requests"."withdrawal_source" is null and "data_subject_requests"."withdrawal_attestation" is null)
      or ("data_subject_requests"."outcome" = 'withdrawn'
        and "data_subject_requests"."outcome_basis_code" = 'withdrawn_by_requester'
        and "data_subject_requests"."delivery_channel" is null and "data_subject_requests"."delivery_confirmed_at" is null and "data_subject_requests"."delivery_actor" is null and "data_subject_requests"."delivery_ref" is null
        and "data_subject_requests"."withdrawal_source" in ('in_person','paper','whatsapp','phone','email')
        and length(btrim(coalesce("data_subject_requests"."withdrawal_attestation", ''))) between 5 and 200
        and ("data_subject_requests"."outcome_note" is null or length(btrim("data_subject_requests"."outcome_note")) between 1 and 300)
        and isfinite("data_subject_requests"."closed_at") and "data_subject_requests"."closed_at" >= "data_subject_requests"."received_at")
      or ("data_subject_requests"."outcome" in ('fulfilled','partially_fulfilled','refused')
        and "data_subject_requests"."identity_verified_at" is not null
        and "data_subject_requests"."outcome_basis_code" in (
          'fulfilled_delivered','fulfilled_corrected','fulfilled_consent_withdrawn','fulfilled_restricted',
          'partial_medical_record_retention_pmk24_2022','partial_demographic_edit_pending','partial_subset_applied',
          'refused_medical_record_retention_pmk24_2022','refused_statutory_tax_accounting_retention',
          'refused_demographic_edit_unavailable','refused_unverifiable_or_unauthorized','refused_no_matching_data'
        )
        and "data_subject_requests"."delivery_channel" in ('in_person','paper','whatsapp','phone','email')
        and "data_subject_requests"."delivery_confirmed_at" is not null and isfinite("data_subject_requests"."delivery_confirmed_at")
        and "data_subject_requests"."delivery_actor" is not null
        and length(btrim(coalesce("data_subject_requests"."delivery_ref", ''))) between 3 and 200
        and "data_subject_requests"."withdrawal_source" is null and "data_subject_requests"."withdrawal_attestation" is null
        and ("data_subject_requests"."outcome_note" is null or length(btrim("data_subject_requests"."outcome_note")) between 1 and 300)
        and isfinite("data_subject_requests"."closed_at")
        and "data_subject_requests"."received_at" <= "data_subject_requests"."identity_verified_at"
        and "data_subject_requests"."identity_verified_at" <= "data_subject_requests"."delivery_confirmed_at"
        and "data_subject_requests"."delivery_confirmed_at" <= "data_subject_requests"."closed_at")),
	CONSTRAINT "dsr_meta_check" CHECK (length("data_subject_requests"."command_key") between 8 and 200 and "data_subject_requests"."input_sha256" ~ '^[0-9a-f]{64}$' and "data_subject_requests"."created_as" in ('owner','admin_pusat'))
);
--> statement-breakpoint
ALTER TABLE "data_subject_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "record_copy_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"copy_request_id" uuid NOT NULL,
	"artifact_sha256" text NOT NULL,
	"handoff_channel" text NOT NULL,
	"handed_off_at" timestamp with time zone NOT NULL,
	"handoff_ref" text NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "record_copy_handoffs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "record_copy_handoffs_copy_key" UNIQUE("tenant_id","copy_request_id"),
	CONSTRAINT "record_copy_handoffs_check" CHECK ("record_copy_handoffs"."artifact_sha256" ~ '^[0-9a-f]{64}$'
      and "record_copy_handoffs"."handoff_channel" in ('in_person','paper','whatsapp','phone','email')
      and isfinite("record_copy_handoffs"."handed_off_at") and "record_copy_handoffs"."handed_off_at" <= "record_copy_handoffs"."confirmed_at"
      and length(btrim("record_copy_handoffs"."handoff_ref")) between 3 and 200)
);
--> statement-breakpoint
ALTER TABLE "record_copy_handoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_subject_request_links" ADD CONSTRAINT "data_subject_request_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_request_links" ADD CONSTRAINT "dsr_links_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."data_subject_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_request_links" ADD CONSTRAINT "dsr_links_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "dsr_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "dsr_verified_by_fk" FOREIGN KEY ("tenant_id","identity_verified_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "dsr_assigned_to_fk" FOREIGN KEY ("tenant_id","assigned_to") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "dsr_delivery_actor_fk" FOREIGN KEY ("tenant_id","delivery_actor") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "dsr_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "dsr_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_copy_handoffs" ADD CONSTRAINT "record_copy_handoffs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_copy_handoffs" ADD CONSTRAINT "record_copy_handoffs_copy_fk" FOREIGN KEY ("tenant_id","copy_request_id") REFERENCES "public"."record_copy_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_copy_handoffs" ADD CONSTRAINT "record_copy_handoffs_by_fk" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dsr_links_unique_item" ON "data_subject_request_links" USING btree ("tenant_id","request_id","link_kind","link_id");--> statement-breakpoint
CREATE INDEX "dsr_links_request_idx" ON "data_subject_request_links" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE INDEX "dsr_open_idx" ON "data_subject_requests" USING btree ("tenant_id","deadline_at") WHERE "data_subject_requests"."state" <> 'closed';

--> statement-breakpoint

-- T-121 rules (PR-50, PRIV-2, UX-30 ▸ Permintaan; R3; closes all 8 findings of t121/PLAN-REVIEW-codex-panel3.md
-- plus R3 r1 review findings: confirmed record-copy artifact/handoff table + FOR SHARE reader locking).
-- Security posture:
--   - RLS enabled on all three tables; ZERO direct table SELECT/INSERT/UPDATE/DELETE grants to clinic_app, clinic_vendor, clinic_operator.
--   - TEN-19 support_object_kinds = 'never' for all three tables (no operator policy or grant; zero clinical link IDs or free text exposed to support).
--   - All reads and writes go strictly through privacy_actor('data_request') SECURITY DEFINER functions (staff_access lock -> officer check -> lifecycle 'data_request' check).
--   - Mutators lock open request rows FOR UPDATE (dsr_open); readers lock request rows FOR SHARE (dsr_list in id order, dsr_get, dsr_link_options) so lifecycle projections are strictly consistent with concurrent mutations.

REVOKE ALL ON TABLE public.data_subject_requests FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.data_subject_request_links FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.record_copy_handoffs FROM PUBLIC;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.data_subject_requests', 'tenant-shared', 'privacy/requests', '{owner,admin_pusat}', 'dsr_log, dsr_bind_subject, dsr_verify, dsr_assign, dsr_close (src/modules/privacy/requests)', 'none (tenant-wide)'),
  ('public.data_subject_request_links', 'tenant-shared', 'privacy/requests', '{owner,admin_pusat}', 'dsr_link (src/modules/privacy/requests)', 'none (tenant-wide)'),
  ('public.record_copy_handoffs', 'tenant-shared', 'privacy/requests', '{owner,admin_pusat}', 'dsr_confirm_copy_handoff (src/modules/privacy/requests)', 'none (tenant-wide)');--> statement-breakpoint

INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.data_subject_requests', 'never'),
  ('public.data_subject_request_links', 'never'),
  ('public.record_copy_handoffs', 'never');--> statement-breakpoint

-- Guard: append-only/monotone state machine; closed is final; facts immutable; patient_id bindable NULL->non-null ONLY before identity verification; never deleted.
CREATE FUNCTION public.dsr_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ord constant text[] := ARRAY['received','in_progress','closed'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: data-subject requests are never deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'closed' THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: a closed request is final' USING ERRCODE = '55000';
    END IF;
    IF array_position(ord, NEW.state) < array_position(ord, OLD.state)
       OR (NEW.tenant_id, NEW.requester_kind, NEW."right", NEW.correction_scope, NEW.requested_purposes, NEW.channel, NEW.received_at, NEW.deadline_at, NEW.command_key, NEW.input_sha256, NEW.created_by, NEW.created_as, NEW.created_at)
          IS DISTINCT FROM (OLD.tenant_id, OLD.requester_kind, OLD."right", OLD.correction_scope, OLD.requested_purposes, OLD.channel, OLD.received_at, OLD.deadline_at, OLD.command_key, OLD.input_sha256, OLD.created_by, OLD.created_as, OLD.created_at)
       OR (NEW.patient_id IS DISTINCT FROM OLD.patient_id AND (OLD.patient_id IS NOT NULL OR OLD.identity_verified_at IS NOT NULL OR NEW.patient_id IS NULL))
       OR (OLD.identity_verified_at IS NOT NULL AND (NEW.identity_verified_at, NEW.identity_method, NEW.identity_verified_by)
          IS DISTINCT FROM (OLD.identity_verified_at, OLD.identity_method, OLD.identity_verified_by)) THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: request facts, subject binding, and identity are fixed; states only move forward' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_guard() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER dsr_guard BEFORE INSERT OR UPDATE OR DELETE ON public.data_subject_requests FOR EACH ROW EXECUTE FUNCTION public.dsr_guard();--> statement-breakpoint
ALTER TABLE public.data_subject_requests ENABLE ALWAYS TRIGGER dsr_guard;--> statement-breakpoint
CREATE TRIGGER dsr_no_truncate BEFORE TRUNCATE ON public.data_subject_requests FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.data_subject_requests ENABLE ALWAYS TRIGGER dsr_no_truncate;--> statement-breakpoint
CREATE TRIGGER dsr_links_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.data_subject_request_links FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.data_subject_request_links ENABLE ALWAYS TRIGGER dsr_links_immutable;--> statement-breakpoint
CREATE TRIGGER record_copy_handoffs_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.record_copy_handoffs FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.record_copy_handoffs ENABLE ALWAYS TRIGGER record_copy_handoffs_immutable;--> statement-breakpoint

-- Private helper: whether p_staff is currently an active privacy officer (Owner, or Admin Pusat with active data_protection duty) on wall clock.
CREATE FUNCTION public.dsr_is_privacy_officer(p_tenant uuid, p_staff uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
      JOIN public.staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.id
     WHERE s.tenant_id = p_tenant
       AND s.id = p_staff
       AND m.effective_from <= clock_timestamp()
       AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
       AND (sr.role = 'owner' OR (sr.role = 'admin_pusat' AND EXISTS (
         SELECT 1 FROM public.staff_duties d
          WHERE d.tenant_id = s.tenant_id AND d.staff_id = s.id AND d.duty = 'data_protection' AND d.ended_at IS NULL
       )))
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_is_privacy_officer(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Private helper: dynamic canonical merge cluster for a request's subject patient (NULL -> empty).
CREATE FUNCTION public.dsr_subject_cluster(p_tenant uuid, p_patient uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN p_patient IS NULL THEN ARRAY[]::uuid[]
    ELSE public.patient_cluster(p_tenant, public.patient_canonical(p_tenant, p_patient))
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_subject_cluster(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Private helper: check whether a link row still validly points into the subject's CURRENT canonical cluster and satisfies right/kind invariants.
-- For record_copy: requires a confirmed record_copy_handoffs row (artifact SHA-256 + confirmed handoff at/after both copy request and identity verification, record_count > 0).
CREATE FUNCTION public.dsr_link_valid_in_cluster(
  p_tenant uuid,
  p_right text,
  p_correction_scope text,
  p_requested_purposes text[],
  p_identity_verified_at timestamptz,
  p_cluster uuid[],
  p_kind text,
  p_link_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF cardinality(p_cluster) = 0 THEN
    RETURN false;
  END IF;
  IF p_kind = 'record_copy' THEN
    RETURN p_right = 'access' AND p_identity_verified_at IS NOT NULL AND EXISTS (
      SELECT 1
        FROM public.record_copy_requests c
        JOIN public.record_copy_handoffs h
          ON h.tenant_id = c.tenant_id AND h.copy_request_id = c.id
       WHERE c.tenant_id = p_tenant
         AND c.id = p_link_id
         AND c.patient_id = ANY (p_cluster)
         AND c.record_count > 0
         AND h.handed_off_at >= c.requested_at
         AND h.handed_off_at >= p_identity_verified_at
    );
  ELSIF p_kind = 'record_version' THEN
    RETURN p_right = 'correction' AND p_correction_scope = 'clinical' AND EXISTS (
      SELECT 1
        FROM public.record_versions rv
        JOIN public.examinations e ON e.tenant_id = rv.tenant_id AND e.id = rv.examination_id
       WHERE rv.tenant_id = p_tenant AND rv.id = p_link_id AND rv.kind = 'correction' AND e.patient_id = ANY (p_cluster)
    );
  ELSIF p_kind = 'record_correction' THEN
    RETURN p_right = 'correction' AND p_correction_scope = 'clinical' AND EXISTS (
      SELECT 1
        FROM public.record_corrections rc
        JOIN public.examinations e ON e.tenant_id = rc.tenant_id AND e.id = rc.examination_id
        JOIN public.record_versions rv ON rv.tenant_id = rc.tenant_id AND rv.id = rc.version_id AND rv.kind = 'correction'
       WHERE rc.tenant_id = p_tenant AND rc.id = p_link_id AND rc.state = 'approved' AND rc.version_id IS NOT NULL AND e.patient_id = ANY (p_cluster)
    );
  ELSIF p_kind = 'consent_withdrawal' THEN
    IF p_right = 'restriction' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.consents c
         WHERE c.tenant_id = p_tenant AND c.id = p_link_id AND c.patient_id = ANY (p_cluster)
           AND c.withdrawn_at IS NOT NULL AND c.purpose = ANY (coalesce(p_requested_purposes, ARRAY[]::text[]))
      );
    ELSIF p_right = 'erasure' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.consents c
         WHERE c.tenant_id = p_tenant AND c.id = p_link_id AND c.patient_id = ANY (p_cluster)
           AND c.withdrawn_at IS NOT NULL AND c.purpose IN ('marketing_wa','publication')
      );
    ELSIF p_right = 'consent_withdrawal' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.consents c
         WHERE c.tenant_id = p_tenant AND c.id = p_link_id AND c.patient_id = ANY (p_cluster)
           AND c.withdrawn_at IS NOT NULL AND c.purpose IN ('clinical_photo','marketing_wa','publication')
      );
    END IF;
  END IF;
  RETURN false;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_link_valid_in_cluster(uuid, text, text, text[], timestamptz, uuid[], text, uuid) FROM PUBLIC;--> statement-breakpoint

-- Private helper: lock an open request row for update (after privacy_actor).
CREATE FUNCTION public.dsr_open(a record, p_id uuid) RETURNS public.data_subject_requests
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.data_subject_requests;
BEGIN
  SELECT * INTO r FROM public.data_subject_requests WHERE tenant_id = a.tenant_id AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r.state = 'closed' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: closed' USING ERRCODE = '55000';
  END IF;
  RETURN r;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_open(record, uuid) FROM PUBLIC;--> statement-breakpoint

-- 0. Confirm artifact SHA-256 and physical/channel handoff of a produced record_copy_requests row (Finding #4 + R3 r1/r3).
-- Enforces the DSR boundary transactionally (open access DSR, verified identity, copy in current subject cluster,
-- handed_off_at >= copy.requested_at AND >= identity_verified_at) BEFORE writing record_copy_handoffs so a rejected
-- confirmation never bricks the copy from a subsequent valid confirmation.
CREATE FUNCTION public.dsr_confirm_copy_handoff(
  p_id uuid,
  p_copy_request uuid,
  p_artifact_sha256 text,
  p_channel text,
  p_handed_off_at timestamptz,
  p_handoff_ref text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  r public.data_subject_requests := public.dsr_open(a, p_id);
  v_now timestamptz := clock_timestamp();
  v_cluster uuid[];
  c public.record_copy_requests;
  v_existing public.record_copy_handoffs;
  v_ref text := NULLIF(btrim(coalesce(p_handoff_ref, '')), '');
  v_id uuid;
BEGIN
  IF r."right" <> 'access' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: link_invalid_for_request' USING ERRCODE = '22023';
  END IF;
  IF r.identity_verified_at IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: identity_unverified' USING ERRCODE = '55000';
  END IF;
  IF r.patient_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: subject_required' USING ERRCODE = '22023';
  END IF;
  IF p_copy_request IS NULL
     OR p_artifact_sha256 IS NULL OR p_artifact_sha256 !~ '^[0-9a-f]{64}$'
     OR p_channel IS NULL OR p_channel NOT IN ('in_person','paper','whatsapp','phone','email')
     OR p_handed_off_at IS NULL OR NOT isfinite(p_handed_off_at) OR p_handed_off_at > v_now
     OR v_ref IS NULL OR length(v_ref) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: handoff_ref_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public.record_copy_requests WHERE tenant_id = a.tenant_id AND id = p_copy_request FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: not_found' USING ERRCODE = 'P0002';
  END IF;
  IF c.record_count <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: copy_handoff_unconfirmed' USING ERRCODE = '22023';
  END IF;
  v_cluster := public.dsr_subject_cluster(a.tenant_id, r.patient_id);
  IF NOT (c.patient_id = ANY (v_cluster)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: link_invalid_for_request' USING ERRCODE = '22023';
  END IF;
  IF p_handed_off_at < c.requested_at OR p_handed_off_at < r.identity_verified_at THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: chronology_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.record_copy_handoffs WHERE tenant_id = a.tenant_id AND copy_request_id = p_copy_request FOR UPDATE;
  IF FOUND THEN
    IF v_existing.artifact_sha256 = p_artifact_sha256
       AND v_existing.handoff_channel = p_channel
       AND v_existing.handed_off_at = p_handed_off_at
       AND v_existing.handoff_ref = v_ref THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: handoff_already_confirmed' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.record_copy_handoffs (tenant_id, copy_request_id, artifact_sha256, handoff_channel, handed_off_at, handoff_ref, confirmed_by, confirmed_at)
  VALUES (a.tenant_id, p_copy_request, p_artifact_sha256, p_channel, p_handed_off_at, v_ref, a.staff_id, v_now)
  RETURNING id INTO v_id;

  PERFORM public.audit_append('export', 'record_copy_request', p_copy_request, 'success', 'record_copy_handoff_confirmed');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_confirm_copy_handoff(uuid, uuid, text, text, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_confirm_copy_handoff(uuid, uuid, text, text, timestamptz, text) TO clinic_app;--> statement-breakpoint

-- 1. Log a data-subject request (Findings #1, #2, #7, #8).
-- Authority runs FIRST before replay lookup; input_sha256 checked inside SQL so replay with changed body -> ERR_IDEMPOTENCY_CONFLICT.
CREATE FUNCTION public.dsr_log(
  p_key text,
  p_patient uuid,
  p_requester text,
  p_right text,
  p_channel text,
  p_received_at timestamptz,
  p_correction_scope text DEFAULT NULL,
  p_requested_purposes text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  v_now timestamptz := clock_timestamp();
  v_purposes text[];
  v_input_sha text;
  v_existing public.data_subject_requests;
  v_id uuid;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 200
     OR p_requester IS NULL OR p_requester NOT IN ('patient','guardian','representative')
     OR p_right IS NULL OR p_right NOT IN ('access','correction','consent_withdrawal','restriction','erasure')
     OR p_channel IS NULL OR p_channel NOT IN ('in_person','paper','whatsapp','phone','email')
     OR p_received_at IS NULL OR NOT isfinite(p_received_at) OR p_received_at > v_now THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: dsr_log' USING ERRCODE = '22023';
  END IF;

  IF p_right = 'correction' THEN
    IF p_correction_scope IS NULL OR p_correction_scope NOT IN ('demographic','clinical') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: correction_scope_required' USING ERRCODE = '22023';
    END IF;
  ELSIF p_correction_scope IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: correction_scope_unexpected' USING ERRCODE = '22023';
  END IF;

  IF p_right = 'restriction' THEN
    IF p_requested_purposes IS NULL OR cardinality(p_requested_purposes) = 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: requested_purposes_required' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT x ORDER BY x) INTO v_purposes FROM unnest(p_requested_purposes) x;
    IF v_purposes IS NULL OR cardinality(v_purposes) NOT BETWEEN 1 AND 2 OR NOT (v_purposes <@ ARRAY['marketing_wa','publication']::text[]) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: requested_purposes_invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF p_requested_purposes IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: requested_purposes_unexpected' USING ERRCODE = '22023';
  END IF;

  v_input_sha := encode(sha256(convert_to(
    jsonb_build_object(
      'patient', p_patient,
      'requester', p_requester,
      'right', p_right,
      'channel', p_channel,
      'received_at', to_char(p_received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'correction_scope', p_correction_scope,
      'requested_purposes', v_purposes
    )::text,
    'UTF8'
  )), 'hex');

  SELECT * INTO v_existing FROM public.data_subject_requests WHERE tenant_id = a.tenant_id AND command_key = p_key;
  IF FOUND THEN
    IF v_existing.input_sha256 IS DISTINCT FROM v_input_sha THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: dsr_log' USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id, 'replayed', true);
  END IF;

  IF p_patient IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.patients pt WHERE pt.tenant_id = a.tenant_id AND pt.id = p_patient
  ) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.data_subject_requests (
    tenant_id, patient_id, requester_kind, "right", correction_scope, requested_purposes,
    channel, received_at, deadline_at, command_key, input_sha256, created_by, created_as, created_at
  ) VALUES (
    a.tenant_id, p_patient, p_requester, p_right, p_correction_scope, v_purposes,
    p_channel, p_received_at, p_received_at + interval '72 hours', p_key, v_input_sha, a.staff_id, a.role, v_now
  ) RETURNING id INTO v_id;

  PERFORM public.audit_append('settings_change', 'data_subject_request', v_id, 'success', 'dsr_logged');
  RETURN jsonb_build_object('id', v_id, 'replayed', false);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_log(text, uuid, text, text, text, timestamptz, text, text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_log(text, uuid, text, text, text, timestamptz, text, text[]) TO clinic_app;--> statement-breakpoint

-- 2. Bind an unbound (NULL patient_id) request to a same-tenant patient once before identity verification (Finding #3).
CREATE FUNCTION public.dsr_bind_subject(p_id uuid, p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  r public.data_subject_requests := public.dsr_open(a, p_id);
BEGIN
  IF p_patient IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: patient_required' USING ERRCODE = '22023';
  END IF;
  IF r.identity_verified_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: subject_locked_after_verify' USING ERRCODE = '55000';
  END IF;
  IF r.patient_id IS NOT NULL THEN
    IF r.patient_id = p_patient THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: subject_already_bound' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients pt WHERE pt.tenant_id = a.tenant_id AND pt.id = p_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.data_subject_requests SET patient_id = p_patient WHERE tenant_id = a.tenant_id AND id = p_id;
  PERFORM public.audit_append('settings_change', 'data_subject_request', p_id, 'success', 'dsr_subject_bound');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_bind_subject(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_bind_subject(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- 3. Verify requester identity (monotone received -> in_progress).
CREATE FUNCTION public.dsr_verify(p_id uuid, p_method text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  r public.data_subject_requests := public.dsr_open(a, p_id);
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_method IS NULL OR NOT (
       (r.requester_kind = 'patient' AND p_method IN ('ktp_in_person','ktp_video'))
       OR (r.requester_kind = 'guardian' AND p_method = 'guardian_document')
       OR (r.requester_kind = 'representative' AND p_method = 'power_of_attorney')
     ) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: identity_method' USING ERRCODE = '22023';
  END IF;
  IF r.identity_verified_at IS NOT NULL THEN
    IF r.identity_method = p_method THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: identity_already_verified' USING ERRCODE = '55000';
  END IF;
  IF v_now < r.received_at THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: chronology_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.data_subject_requests
     SET identity_verified_at = v_now,
         identity_method = p_method,
         identity_verified_by = a.staff_id,
         state = 'in_progress'
   WHERE tenant_id = a.tenant_id AND id = p_id;
  PERFORM public.audit_append('settings_change', 'data_subject_request', p_id, 'success', 'dsr_identity_verified');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_verify(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_verify(uuid, text) TO clinic_app;--> statement-breakpoint

-- 4. Assign to an active same-tenant privacy officer (Finding #6). Routing only; never grants access.
CREATE FUNCTION public.dsr_assign(p_id uuid, p_staff uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  r public.data_subject_requests := public.dsr_open(a, p_id);
BEGIN
  IF r.identity_verified_at IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: identity_unverified' USING ERRCODE = '55000';
  END IF;
  IF p_staff IS NOT NULL AND NOT public.dsr_is_privacy_officer(a.tenant_id, p_staff) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: assignee_not_privacy_officer' USING ERRCODE = '42501';
  END IF;

  UPDATE public.data_subject_requests SET assigned_to = p_staff WHERE tenant_id = a.tenant_id AND id = p_id;
  PERFORM public.audit_append('settings_change', 'data_subject_request', p_id, 'success', 'dsr_assigned');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_assign(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_assign(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- 5. Link fulfillment evidence (Findings #1, #2, #3, #4 + R3 r1 P1-1 confirmed copy handoff).
CREATE FUNCTION public.dsr_link(
  p_id uuid,
  p_kind text,
  p_link uuid,
  p_handoff_ref text DEFAULT NULL,
  p_addresses_request boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  r public.data_subject_requests := public.dsr_open(a, p_id);
  v_cluster uuid[];
  v_existing uuid;
  v_handoff text := NULLIF(btrim(coalesce(p_handoff_ref, '')), '');
  v_confirmed_ref text;
  v_id uuid;
BEGIN
  IF r.identity_verified_at IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: identity_unverified' USING ERRCODE = '55000';
  END IF;
  IF r.patient_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: subject_required' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('record_copy','record_version','record_correction','consent_withdrawal') OR p_link IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: link_required' USING ERRCODE = '22023';
  END IF;

  IF r."right" = 'correction' AND r.correction_scope = 'demographic' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: demographic_unavailable' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'record_copy' AND (v_handoff IS NULL OR length(v_handoff) NOT BETWEEN 3 AND 200) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: handoff_ref_required' USING ERRCODE = '22023';
  END IF;
  IF p_kind <> 'record_copy' AND v_handoff IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: handoff_ref_unexpected' USING ERRCODE = '22023';
  END IF;
  IF p_kind IN ('record_version','record_correction') AND p_addresses_request IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: addresses_request_required' USING ERRCODE = '22023';
  END IF;

  v_cluster := public.dsr_subject_cluster(a.tenant_id, r.patient_id);

  IF p_kind = 'record_copy' THEN
    SELECT h.handoff_ref INTO v_confirmed_ref
      FROM public.record_copy_handoffs h
     WHERE h.tenant_id = a.tenant_id AND h.copy_request_id = p_link;
    IF NOT FOUND OR v_confirmed_ref IS DISTINCT FROM v_handoff THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: copy_handoff_unconfirmed' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NOT public.dsr_link_valid_in_cluster(a.tenant_id, r."right", r.correction_scope, r.requested_purposes, r.identity_verified_at, v_cluster, p_kind, p_link) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: link_invalid_for_request' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing FROM public.data_subject_request_links
   WHERE tenant_id = a.tenant_id AND request_id = p_id AND link_kind = p_kind AND link_id = p_link;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.data_subject_request_links (tenant_id, request_id, link_kind, link_id, handoff_ref, addresses_request, created_by)
  VALUES (a.tenant_id, p_id, p_kind, p_link, v_handoff, coalesce(p_addresses_request, false), a.staff_id)
  RETURNING id INTO v_id;

  PERFORM public.audit_append('settings_change', 'data_subject_request', p_id, 'success', 'dsr_linked');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_link(uuid, text, uuid, text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_link(uuid, text, uuid, text, boolean) TO clinic_app;--> statement-breakpoint

-- 6. Close a data-subject request (Findings #1–#7).
CREATE FUNCTION public.dsr_close(
  p_id uuid,
  p_outcome text,
  p_basis_code text,
  p_note text DEFAULT NULL,
  p_delivery_channel text DEFAULT NULL,
  p_delivery_confirmed_at timestamptz DEFAULT NULL,
  p_delivery_ref text DEFAULT NULL,
  p_withdrawal_source text DEFAULT NULL,
  p_withdrawal_attestation text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  r public.data_subject_requests := public.dsr_open(a, p_id);
  v_now timestamptz := clock_timestamp();
  v_cluster uuid[];
  v_note text := NULLIF(btrim(coalesce(p_note, '')), '');
  v_dref text := NULLIF(btrim(coalesce(p_delivery_ref, '')), '');
  v_watt text := NULLIF(btrim(coalesce(p_withdrawal_attestation, '')), '');
  v_still_active int := 0;
  v_inactive_count int := 0;
  v_purpose text;
  v_has_valid_link boolean := false;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('fulfilled','partially_fulfilled','refused','withdrawn')
     OR p_basis_code IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outcome_required' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: note_too_long' USING ERRCODE = '22023';
  END IF;

  -- Withdrawn: permitted before or after verification, but ONLY with explicit source + officer attestation (Finding #4).
  IF p_outcome = 'withdrawn' THEN
    IF p_basis_code <> 'withdrawn_by_requester'
       OR p_withdrawal_source IS NULL OR p_withdrawal_source NOT IN ('in_person','paper','whatsapp','phone','email')
       OR v_watt IS NULL OR length(v_watt) NOT BETWEEN 5 AND 200
       OR p_delivery_channel IS NOT NULL OR p_delivery_confirmed_at IS NOT NULL OR v_dref IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: withdrawal_required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.data_subject_requests
       SET state = 'closed',
           outcome = 'withdrawn',
           outcome_basis_code = p_basis_code,
           outcome_note = v_note,
           withdrawal_source = p_withdrawal_source,
           withdrawal_attestation = v_watt,
           closed_at = v_now,
           closed_by = a.staff_id
     WHERE tenant_id = a.tenant_id AND id = p_id;
    PERFORM public.audit_append('settings_change', 'data_subject_request', p_id, 'success', 'dsr_closed');
    RETURN;
  END IF;

  -- Non-withdrawn: verified identity + confirmed delivery + valid finite chronology (Findings #4 & #7).
  IF r.identity_verified_at IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: identity_unverified' USING ERRCODE = '55000';
  END IF;
  IF p_delivery_channel IS NULL OR p_delivery_channel NOT IN ('in_person','paper','whatsapp','phone','email')
     OR p_delivery_confirmed_at IS NULL OR NOT isfinite(p_delivery_confirmed_at)
     OR v_dref IS NULL OR length(v_dref) NOT BETWEEN 3 AND 200
     OR p_withdrawal_source IS NOT NULL OR v_watt IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: delivery_required' USING ERRCODE = '22023';
  END IF;
  IF p_delivery_confirmed_at < r.identity_verified_at OR r.identity_verified_at < r.received_at OR p_delivery_confirmed_at > v_now THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: chronology_invalid' USING ERRCODE = '22023';
  END IF;

  -- Validate typed outcome basis matches outcome family.
  IF (p_outcome = 'fulfilled' AND p_basis_code NOT IN ('fulfilled_delivered','fulfilled_corrected','fulfilled_consent_withdrawn','fulfilled_restricted'))
     OR (p_outcome = 'partially_fulfilled' AND p_basis_code NOT IN ('partial_medical_record_retention_pmk24_2022','partial_demographic_edit_pending','partial_subset_applied'))
     OR (p_outcome = 'refused' AND p_basis_code NOT IN ('refused_medical_record_retention_pmk24_2022','refused_statutory_tax_accounting_retention','refused_demographic_edit_unavailable','refused_unverifiable_or_unauthorized','refused_no_matching_data')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: basis_required' USING ERRCODE = '22023';
  END IF;

  v_cluster := public.dsr_subject_cluster(a.tenant_id, r.patient_id);

  -- Revalidate EVERY previously linked row against the CURRENT canonical cluster (Finding #3: unmerge after link blocks closure).
  IF EXISTS (
    SELECT 1 FROM public.data_subject_request_links l
     WHERE l.tenant_id = a.tenant_id AND l.request_id = p_id
       AND NOT public.dsr_link_valid_in_cluster(a.tenant_id, r."right", r.correction_scope, r.requested_purposes, r.identity_verified_at, v_cluster, l.link_kind, l.link_id)
  ) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: cluster_changed' USING ERRCODE = '55000';
  END IF;

  -- D3 Erasure (Finding #2): NEVER 'fulfilled' even with zero retained history.
  IF r."right" = 'erasure' THEN
    IF p_outcome = 'fulfilled' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: clinical_retention' USING ERRCODE = '55000';
    END IF;
    IF p_outcome = 'partially_fulfilled' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.data_subject_request_links l
         WHERE l.tenant_id = a.tenant_id AND l.request_id = p_id AND l.link_kind = 'consent_withdrawal'
      ) THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: link_required' USING ERRCODE = '55000';
      END IF;
      IF EXISTS (
        SELECT 1
          FROM public.data_subject_request_links l
          JOIN public.consents cw ON cw.tenant_id = l.tenant_id AND cw.id = l.link_id
          JOIN public.consents active_c ON active_c.tenant_id = a.tenant_id
           AND active_c.patient_id = ANY (v_cluster)
           AND active_c.purpose = cw.purpose
           AND active_c.withdrawn_at IS NULL
         WHERE l.tenant_id = a.tenant_id AND l.request_id = p_id AND l.link_kind = 'consent_withdrawal'
      ) THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: restriction_still_active' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  -- Correction (Finding #1): demographic correction can never close 'fulfilled' until D2 lands.
  IF r."right" = 'correction' AND r.correction_scope = 'demographic' AND p_outcome = 'fulfilled' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: demographic_unavailable' USING ERRCODE = '55000';
  END IF;

  -- Fulfillment checks for non-refused outcomes.
  IF p_outcome IN ('fulfilled','partially_fulfilled') THEN
    IF r."right" = 'access' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.data_subject_request_links l
         WHERE l.tenant_id = a.tenant_id AND l.request_id = p_id AND l.link_kind = 'record_copy'
      ) INTO v_has_valid_link;
      IF NOT v_has_valid_link THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: link_required' USING ERRCODE = '55000';
      END IF;

    ELSIF r."right" = 'correction' AND r.correction_scope = 'clinical' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.data_subject_request_links l
         WHERE l.tenant_id = a.tenant_id AND l.request_id = p_id AND l.link_kind IN ('record_version','record_correction')
      ) INTO v_has_valid_link;
      IF NOT v_has_valid_link THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: link_required' USING ERRCODE = '55000';
      END IF;

    ELSIF r."right" = 'consent_withdrawal' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.data_subject_request_links l
         WHERE l.tenant_id = a.tenant_id AND l.request_id = p_id AND l.link_kind = 'consent_withdrawal'
      ) INTO v_has_valid_link;
      IF NOT v_has_valid_link THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: link_required' USING ERRCODE = '55000';
      END IF;
      IF EXISTS (
        SELECT 1
          FROM public.data_subject_request_links l
          JOIN public.consents cw ON cw.tenant_id = l.tenant_id AND cw.id = l.link_id
          JOIN public.consents active_c ON active_c.tenant_id = a.tenant_id
           AND active_c.patient_id = ANY (v_cluster)
           AND active_c.purpose = cw.purpose
           AND active_c.withdrawn_at IS NULL
         WHERE l.tenant_id = a.tenant_id AND l.request_id = p_id AND l.link_kind = 'consent_withdrawal'
      ) THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: restriction_still_active' USING ERRCODE = '55000';
      END IF;

    ELSIF r."right" = 'restriction' THEN
      IF cardinality(v_cluster) = 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: subject_required' USING ERRCODE = '22023';
      END IF;
      FOREACH v_purpose IN ARRAY coalesce(r.requested_purposes, ARRAY[]::text[]) LOOP
        IF EXISTS (
          SELECT 1 FROM public.consents c
           WHERE c.tenant_id = a.tenant_id AND c.patient_id = ANY (v_cluster) AND c.purpose = v_purpose AND c.withdrawn_at IS NULL
        ) THEN
          v_still_active := v_still_active + 1;
        ELSE
          v_inactive_count := v_inactive_count + 1;
        END IF;
      END LOOP;
      IF p_outcome = 'fulfilled' AND v_still_active > 0 THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: restriction_still_active' USING ERRCODE = '55000';
      END IF;
      IF p_outcome = 'partially_fulfilled' AND v_inactive_count = 0 THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: restriction_still_active' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  UPDATE public.data_subject_requests
     SET state = 'closed',
         outcome = p_outcome,
         outcome_basis_code = p_basis_code,
         outcome_note = v_note,
         delivery_channel = p_delivery_channel,
         delivery_confirmed_at = p_delivery_confirmed_at,
         delivery_actor = a.staff_id,
         delivery_ref = v_dref,
         closed_at = v_now,
         closed_by = a.staff_id
   WHERE tenant_id = a.tenant_id AND id = p_id;

  PERFORM public.audit_append('settings_change', 'data_subject_request', p_id, 'success', 'dsr_closed');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_close(uuid, text, text, text, text, timestamptz, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_close(uuid, text, text, text, text, timestamptz, text, text, text) TO clinic_app;--> statement-breakpoint

-- 7. Approved officer projection list reader (Findings #5, #6, #7 + R3 r1 P1-2 FOR SHARE locking in deterministic id order). MRN only; never patient name or clinical text.
CREATE FUNCTION public.dsr_list(p_state text DEFAULT 'all', p_right text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  v_now timestamptz := clock_timestamp();
  v_rows jsonb;
BEGIN
  IF p_state IS NOT NULL AND p_state NOT IN ('open','closed','all') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: state' USING ERRCODE = '22023';
  END IF;
  IF p_right IS NOT NULL AND p_right NOT IN ('access','correction','consent_withdrawal','restriction','erasure') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: right' USING ERRCODE = '22023';
  END IF;

  -- Serialize with concurrent FOR UPDATE mutations on tenant requests in deterministic id order.
  PERFORM 1 FROM public.data_subject_requests r WHERE r.tenant_id = a.tenant_id ORDER BY r.id FOR SHARE;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'right', r."right",
    'correction_scope', r.correction_scope,
    'requested_purposes', r.requested_purposes,
    'requester_kind', r.requester_kind,
    'channel', r.channel,
    'received_at', r.received_at,
    'deadline_at', r.deadline_at,
    'state', r.state,
    'identity_verified_at', r.identity_verified_at,
    'outcome', r.outcome,
    'outcome_basis_code', r.outcome_basis_code,
    'delivery_confirmed_at', r.delivery_confirmed_at,
    'closed_at', r.closed_at,
    'mrn', pt.mrn,
    'assignee_id', r.assigned_to,
    'assignee_name', st.display_name,
    'assignee_active', CASE WHEN r.assigned_to IS NULL THEN true ELSE public.dsr_is_privacy_officer(a.tenant_id, r.assigned_to) END
  ) ORDER BY (r.state = 'closed') ASC, CASE WHEN r.state = 'closed' THEN NULL ELSE r.deadline_at END ASC, r.closed_at DESC NULLS LAST, r.id ASC), '[]'::jsonb)
  INTO v_rows
  FROM public.data_subject_requests r
  LEFT JOIN public.patients pt ON pt.tenant_id = r.tenant_id AND pt.id = public.patient_canonical(r.tenant_id, r.patient_id)
  LEFT JOIN public.staff st ON st.tenant_id = r.tenant_id AND st.id = r.assigned_to
  WHERE r.tenant_id = a.tenant_id
    AND (p_state IS NULL OR p_state = 'all' OR (p_state = 'open' AND r.state <> 'closed') OR (p_state = 'closed' AND r.state = 'closed'))
    AND (p_right IS NULL OR r."right" = p_right);

  RETURN jsonb_build_object('now', v_now, 'rows', v_rows);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_list(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_list(text, text) TO clinic_app;--> statement-breakpoint

-- 8. Approved officer detail reader (Findings #2, #3, #5, #6, #7 + R3 r1 P1-2 FOR SHARE locking).
CREATE FUNCTION public.dsr_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  v_now timestamptz := clock_timestamp();
  r public.data_subject_requests;
  v_cluster uuid[];
  v_mrn text;
  v_assignee text;
  v_assignee_active boolean;
  v_has_clinical boolean := false;
  v_links jsonb;
  v_restr jsonb := '[]'::jsonb;
  v_officers jsonb;
  v_purpose text;
  v_pstatus text;
BEGIN
  SELECT * INTO r FROM public.data_subject_requests WHERE tenant_id = a.tenant_id AND id = p_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: not_found' USING ERRCODE = 'P0002';
  END IF;

  v_cluster := public.dsr_subject_cluster(a.tenant_id, r.patient_id);
  IF r.patient_id IS NOT NULL THEN
    SELECT pt.mrn INTO v_mrn FROM public.patients pt WHERE pt.tenant_id = a.tenant_id AND pt.id = public.patient_canonical(a.tenant_id, r.patient_id);
    v_has_clinical := EXISTS (SELECT 1 FROM public.examinations e WHERE e.tenant_id = a.tenant_id AND e.patient_id = ANY (v_cluster))
                   OR EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.patient_id = ANY (v_cluster));
  END IF;

  IF r.assigned_to IS NOT NULL THEN
    SELECT st.display_name INTO v_assignee FROM public.staff st WHERE st.tenant_id = a.tenant_id AND st.id = r.assigned_to;
    v_assignee_active := public.dsr_is_privacy_officer(a.tenant_id, r.assigned_to);
  ELSE
    v_assignee_active := true;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'link_kind', l.link_kind,
    'link_id', l.link_id,
    'handoff_ref', l.handoff_ref,
    'addresses_request', l.addresses_request,
    'cluster_valid', public.dsr_link_valid_in_cluster(a.tenant_id, r."right", r.correction_scope, r.requested_purposes, r.identity_verified_at, v_cluster, l.link_kind, l.link_id),
    'purpose', CASE WHEN l.link_kind = 'consent_withdrawal' THEN (SELECT c.purpose FROM public.consents c WHERE c.tenant_id = a.tenant_id AND c.id = l.link_id) ELSE NULL END,
    'created_at', l.created_at
  ) ORDER BY l.created_at ASC, l.id ASC), '[]'::jsonb)
  INTO v_links
  FROM public.data_subject_request_links l
  WHERE l.tenant_id = a.tenant_id AND l.request_id = r.id;

  IF r."right" = 'restriction' AND r.requested_purposes IS NOT NULL THEN
    FOREACH v_purpose IN ARRAY r.requested_purposes LOOP
      IF cardinality(v_cluster) > 0 AND EXISTS (
        SELECT 1 FROM public.consents c
         WHERE c.tenant_id = a.tenant_id AND c.patient_id = ANY (v_cluster) AND c.purpose = v_purpose AND c.withdrawn_at IS NULL
      ) THEN
        v_pstatus := 'still_active';
      ELSIF EXISTS (
        SELECT 1
          FROM public.data_subject_request_links l
          JOIN public.consents c ON c.tenant_id = a.tenant_id AND c.id = l.link_id AND c.purpose = v_purpose AND c.patient_id = ANY (v_cluster)
         WHERE l.tenant_id = a.tenant_id AND l.request_id = r.id AND l.link_kind = 'consent_withdrawal'
      ) THEN
        v_pstatus := 'applied';
      ELSE
        v_pstatus := 'already_inactive';
      END IF;
      v_restr := v_restr || jsonb_build_object('purpose', v_purpose, 'status', v_pstatus);
    END LOOP;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', o.staff_id,
    'display_name', o.display_name,
    'role', o.role
  ) ORDER BY o.display_name ASC), '[]'::jsonb)
  INTO v_officers
  FROM (
    SELECT DISTINCT ON (s.id) s.id AS staff_id, s.display_name, sr.role
      FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
      JOIN public.staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.id
     WHERE s.tenant_id = a.tenant_id
       AND m.effective_from <= v_now AND (m.effective_to IS NULL OR m.effective_to > v_now)
       AND (sr.role = 'owner' OR (sr.role = 'admin_pusat' AND EXISTS (
         SELECT 1 FROM public.staff_duties d
          WHERE d.tenant_id = s.tenant_id AND d.staff_id = s.id AND d.duty = 'data_protection' AND d.ended_at IS NULL
       )))
     ORDER BY s.id, (sr.role = 'owner') DESC
  ) o;

  RETURN jsonb_build_object(
    'now', v_now,
    'id', r.id,
    'patient_id', r.patient_id,
    'mrn', v_mrn,
    'requester_kind', r.requester_kind,
    'right', r."right",
    'correction_scope', r.correction_scope,
    'requested_purposes', r.requested_purposes,
    'channel', r.channel,
    'received_at', r.received_at,
    'deadline_at', r.deadline_at,
    'state', r.state,
    'identity_verified_at', r.identity_verified_at,
    'identity_method', r.identity_method,
    'assigned_to', r.assigned_to,
    'assignee_name', v_assignee,
    'assignee_active', v_assignee_active,
    'has_clinical_records', v_has_clinical,
    'restriction_statuses', v_restr,
    'links', v_links,
    'outcome', r.outcome,
    'outcome_basis_code', r.outcome_basis_code,
    'outcome_note', r.outcome_note,
    'delivery_channel', r.delivery_channel,
    'delivery_confirmed_at', r.delivery_confirmed_at,
    'delivery_ref', r.delivery_ref,
    'withdrawal_source', r.withdrawal_source,
    'withdrawal_attestation', r.withdrawal_attestation,
    'closed_at', r.closed_at,
    'officers', v_officers
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_get(uuid) TO clinic_app;--> statement-breakpoint

-- 9. Linkable evidence options reader (current merge cluster only; confirmed record-copy handoffs only; FOR SHARE row lock; zero clinical text/diagnoses exposed).
CREATE FUNCTION public.dsr_link_options(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  r public.data_subject_requests;
  v_cluster uuid[];
  v_copies jsonb := '[]'::jsonb;
  v_unconfirmed_copies jsonb := '[]'::jsonb;
  v_versions jsonb := '[]'::jsonb;
  v_corrections jsonb := '[]'::jsonb;
  v_consents jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO r FROM public.data_subject_requests WHERE tenant_id = a.tenant_id AND id = p_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: not_found' USING ERRCODE = 'P0002';
  END IF;
  v_cluster := public.dsr_subject_cluster(a.tenant_id, r.patient_id);
  IF cardinality(v_cluster) = 0 THEN
    RETURN jsonb_build_object('record_copies', v_copies, 'unconfirmed_record_copies', v_unconfirmed_copies, 'record_versions', v_versions, 'record_corrections', v_corrections, 'consent_withdrawals', v_consents);
  END IF;

  IF r."right" = 'access' AND r.identity_verified_at IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'requested_at', c.requested_at,
      'record_count', c.record_count,
      'handoff_ref', h.handoff_ref,
      'handed_off_at', h.handed_off_at
    ) ORDER BY h.handed_off_at DESC, c.id DESC), '[]'::jsonb)
      INTO v_copies
      FROM public.record_copy_requests c
      JOIN public.record_copy_handoffs h
        ON h.tenant_id = c.tenant_id AND h.copy_request_id = c.id
     WHERE c.tenant_id = a.tenant_id
       AND c.patient_id = ANY (v_cluster)
       AND c.record_count > 0
       AND h.handed_off_at >= c.requested_at
       AND h.handed_off_at >= r.identity_verified_at;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'requested_at', c.requested_at,
      'record_count', c.record_count
    ) ORDER BY c.requested_at DESC, c.id DESC), '[]'::jsonb)
      INTO v_unconfirmed_copies
      FROM public.record_copy_requests c
     WHERE c.tenant_id = a.tenant_id
       AND c.patient_id = ANY (v_cluster)
       AND c.record_count > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.record_copy_handoffs h
          WHERE h.tenant_id = c.tenant_id AND h.copy_request_id = c.id
       );
  ELSIF r."right" = 'correction' AND r.correction_scope = 'clinical' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', rv.id, 'version', rv.version, 'created_at', rv.created_at) ORDER BY rv.created_at DESC), '[]'::jsonb)
      INTO v_versions
      FROM public.record_versions rv
      JOIN public.examinations e ON e.tenant_id = rv.tenant_id AND e.id = rv.examination_id
     WHERE rv.tenant_id = a.tenant_id AND rv.kind = 'correction' AND e.patient_id = ANY (v_cluster);

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', rc.id, 'decided_at', rc.decided_at, 'version_id', rc.version_id) ORDER BY rc.decided_at DESC), '[]'::jsonb)
      INTO v_corrections
      FROM public.record_corrections rc
      JOIN public.examinations e ON e.tenant_id = rc.tenant_id AND e.id = rc.examination_id
      JOIN public.record_versions rv ON rv.tenant_id = rc.tenant_id AND rv.id = rc.version_id AND rv.kind = 'correction'
     WHERE rc.tenant_id = a.tenant_id AND rc.state = 'approved' AND rc.version_id IS NOT NULL AND e.patient_id = ANY (v_cluster);
  ELSIF r."right" IN ('consent_withdrawal','restriction','erasure') THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'purpose', c.purpose, 'withdrawn_at', c.withdrawn_at) ORDER BY c.withdrawn_at DESC), '[]'::jsonb)
      INTO v_consents
      FROM public.consents c
     WHERE c.tenant_id = a.tenant_id
       AND c.patient_id = ANY (v_cluster)
       AND c.withdrawn_at IS NOT NULL
       AND (
         (r."right" = 'restriction' AND c.purpose = ANY (coalesce(r.requested_purposes, ARRAY[]::text[])))
         OR (r."right" = 'erasure' AND c.purpose IN ('marketing_wa','publication'))
         OR (r."right" = 'consent_withdrawal' AND c.purpose IN ('clinical_photo','marketing_wa','publication'))
       );
  END IF;

  RETURN jsonb_build_object(
    'record_copies', v_copies,
    'unconfirmed_record_copies', v_unconfirmed_copies,
    'record_versions', v_versions,
    'record_corrections', v_corrections,
    'consent_withdrawals', v_consents
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dsr_link_options(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dsr_link_options(uuid) TO clinic_app;
