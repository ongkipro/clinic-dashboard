CREATE TABLE "credential_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"threshold" integer NOT NULL,
	"alerted_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "credential_alerts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "credential_alerts_once_key" UNIQUE("tenant_id","credential_id","threshold"),
	CONSTRAINT "credential_alerts_threshold_check" CHECK ("credential_alerts"."threshold" in (60, 30, 7))
);
--> statement-breakpoint
CREATE TABLE "staff_credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"issuer" text NOT NULL,
	"profession" text NOT NULL,
	"scope" text,
	"branch_id" uuid,
	"valid_from" date NOT NULL,
	"expires_on" date,
	"evidence_note" text,
	"replaces" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"ended_by" uuid,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "staff_credentials_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_credentials_kind_check" CHECK ("staff_credentials"."kind" in ('str','sip','sipp','sipa')
      and ("staff_credentials"."kind" = 'str') = ("staff_credentials"."branch_id" is null)
      and ("staff_credentials"."kind" = 'str' or "staff_credentials"."expires_on" is not null)),
	CONSTRAINT "staff_credentials_profession_check" CHECK ("staff_credentials"."profession" in ('dokter','dokter_gigi','perawat','bidan','apoteker','tenaga_kesehatan_lain')
      and ("staff_credentials"."kind" <> 'sipp' or "staff_credentials"."profession" = 'perawat') and ("staff_credentials"."kind" <> 'sipa' or "staff_credentials"."profession" = 'apoteker')
      and ("staff_credentials"."kind" <> 'sip' or "staff_credentials"."profession" in ('dokter','dokter_gigi','bidan','tenaga_kesehatan_lain'))),
	CONSTRAINT "staff_credentials_text_check" CHECK (length(btrim("staff_credentials"."number")) between 3 and 60 and length(btrim("staff_credentials"."issuer")) between 3 and 120
      and ("staff_credentials"."scope" is null or length(btrim("staff_credentials"."scope")) between 1 and 200) and ("staff_credentials"."evidence_note" is null or length(btrim("staff_credentials"."evidence_note")) between 1 and 300)
      and ("staff_credentials"."expires_on" is null or "staff_credentials"."expires_on" >= "staff_credentials"."valid_from") and ("staff_credentials"."replaces" is null or "staff_credentials"."replaces" <> "staff_credentials"."id")),
	CONSTRAINT "staff_credentials_state_check" CHECK ("staff_credentials"."state" in ('pending','verified','rejected','suspended','revoked')
      and (("staff_credentials"."state" = 'pending') = ("staff_credentials"."decided_at" is null)) and (("staff_credentials"."decided_at" is null) = ("staff_credentials"."decided_by" is null))
      and (("staff_credentials"."state" = 'rejected') = ("staff_credentials"."decision_reason" is not null)) and ("staff_credentials"."decision_reason" is null or length(btrim("staff_credentials"."decision_reason")) between 3 and 500)
      and (("staff_credentials"."state" in ('suspended','revoked')) = ("staff_credentials"."ended_at" is not null)) and (("staff_credentials"."ended_at" is null) = ("staff_credentials"."ended_by" is null))
      and (("staff_credentials"."ended_at" is null) = ("staff_credentials"."end_reason" is null)) and ("staff_credentials"."end_reason" is null or length(btrim("staff_credentials"."end_reason")) between 3 and 500)
      and ("staff_credentials"."state" not in ('suspended','revoked') or "staff_credentials"."decided_at" is not null)),
	CONSTRAINT "staff_credentials_verifier_check" CHECK ("staff_credentials"."decided_by" is null or ("staff_credentials"."decided_by" <> "staff_credentials"."staff_id" and "staff_credentials"."decided_by" <> "staff_credentials"."recorded_by"))
);
--> statement-breakpoint
ALTER TABLE "credential_alerts" ADD CONSTRAINT "credential_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_alerts" ADD CONSTRAINT "credential_alerts_credential_fk" FOREIGN KEY ("tenant_id","credential_id") REFERENCES "public"."staff_credentials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_ended_by_fk" FOREIGN KEY ("tenant_id","ended_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_replaces_fk" FOREIGN KEY ("tenant_id","replaces") REFERENCES "public"."staff_credentials"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_credentials_one_replacement" ON "staff_credentials" USING btree ("tenant_id","replaces") WHERE "staff_credentials"."replaces" is not null and "staff_credentials"."state" <> 'rejected';--> statement-breakpoint
CREATE INDEX "staff_credentials_staff_idx" ON "staff_credentials" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE INDEX "staff_credentials_expiry_idx" ON "staff_credentials" USING btree ("expires_on") WHERE "staff_credentials"."expires_on" is not null and "staff_credentials"."state" in ('pending','verified');;--> statement-breakpoint

-- T-050 rules (generated; see header)
-- Clinical credentials (PR-73, IAM-4; plan r1/r2 in docs/tasks/T-050.md). Clinical roles: 'doctor','nurse','therapist','pharmacist','facility_head'.

-- Is the staff member a clinical role holder (at p_branch when given), with an active membership now?
CREATE FUNCTION public.credential_holder_ok(p_tenant uuid, p_staff uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
     WHERE s.tenant_id = p_tenant AND s.id = p_staff
       AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
       AND EXISTS (SELECT 1 FROM public.staff_branches sb
                    WHERE sb.tenant_id = p_tenant AND sb.staff_id = p_staff AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head')
                      AND (p_branch IS NULL OR sb.branch_id = p_branch)))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_holder_ok(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The branches a credential concerns: its own branch (a permit), or every branch where the STR holder
-- holds a clinical role. Used by the read policy, the deciders' scope and the alert addressing.
CREATE FUNCTION public.credential_branches(p_tenant uuid, p_staff uuid, p_branch uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_branch WHERE p_branch IS NOT NULL
  UNION
  SELECT DISTINCT sb.branch_id FROM public.staff_branches sb
   WHERE p_branch IS NULL AND sb.tenant_id = p_tenant AND sb.staff_id = p_staff AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_branches(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Read policy helper (invoker; plan r1 P2-1; review r1 P2-4): Owner and Admin Pusat tenant-wide; Manager and
-- Facility head for a permit of an allowed branch, or an STR whose holder holds a clinical role at an allowed
-- branch (staff_branches is readable to both under its own policy); the holder reads their own. Never null.
CREATE FUNCTION public.credential_readable(p_tenant uuid, p_staff uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_tenant = public.app_tenant_id() AND (
         public.app_role_in(ARRAY['owner','admin_pusat'])
      OR p_staff = public.app_staff_id()
      OR public.app_role_in(ARRAY['manager','facility_head']) AND (
           p_branch IS NOT NULL AND public.app_branch_allowed(p_branch)
        OR p_branch IS NULL AND EXISTS (
             SELECT 1 FROM public.staff_branches sb
              WHERE sb.tenant_id = p_tenant AND sb.staff_id = p_staff AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head') AND public.app_branch_allowed(sb.branch_id)))), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_readable(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.credential_readable(uuid, uuid, uuid) TO clinic_app;--> statement-breakpoint

ALTER TABLE public.staff_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_credentials_read ON public.staff_credentials FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.credential_readable(tenant_id, staff_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.staff_credentials TO clinic_app;--> statement-breakpoint
-- The alert log: ids and dates only, readable by no app or operator role.
ALTER TABLE public.credential_alerts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.staff_credentials', 'tenant-shared', 'org', '{owner,admin_pusat,manager,facility_head,holder}',
   'credential_record, credential_decide, credential_end (src/modules/org/licences)', 'permit: its branch; STR: the holder''s clinical branches'),
  ('public.credential_alerts', 'tenant-shared', 'org', '{}', 'credential_alert_scan (src/modules/org/licences)', 'none');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): a credential describes a person (personal); the alert log is
-- readable by no app role, so never by the operator (vendor-authority 2.8).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.staff_credentials', 'personal'), ('public.credential_alerts', 'never');--> statement-breakpoint
CREATE POLICY staff_credentials_operator_read ON public.staff_credentials FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.staff_credentials', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.staff_credentials TO clinic_operator;--> statement-breakpoint

-- ── Guards (plan r1 P1-3, r2 (a)) ──────────────────────────────────────────────────────────────────
CREATE FUNCTION public.staff_credentials_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.staff_credentials := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  t public.staff_credentials;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credentials are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' THEN
      RAISE EXCEPTION 'a credential is recorded pending' USING ERRCODE = '42501';
    END IF;
    IF NEW.replaces IS NOT NULL THEN
      SELECT * INTO t FROM public.staff_credentials WHERE tenant_id = NEW.tenant_id AND id = NEW.replaces;
      IF NOT FOUND OR t.staff_id <> NEW.staff_id OR t.kind <> NEW.kind OR t.branch_id IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION 'a replacement names a credential of the same staff, kind and branch' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.staff_id, NEW.kind, NEW.number, NEW.issuer, NEW.profession, NEW.scope, NEW.branch_id, NEW.valid_from,
      NEW.expires_on, NEW.evidence_note, NEW.replaces, NEW.recorded_by, NEW.recorded_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.staff_id, OLD.kind, OLD.number, OLD.issuer, OLD.profession, OLD.scope, OLD.branch_id, OLD.valid_from,
      OLD.expires_on, OLD.evidence_note, OLD.replaces, OLD.recorded_by, OLD.recorded_at) THEN
    RAISE EXCEPTION 'a recorded credential never changes; record a replacement' USING ERRCODE = '42501';
  END IF;
  IF NOT (OLD.state = 'pending' AND NEW.state IN ('verified','rejected')
          OR OLD.state = 'verified' AND NEW.state IN ('suspended','revoked')
          OR OLD.state = 'suspended' AND NEW.state = 'revoked') THEN
    RAISE EXCEPTION 'a credential moves pending to verified or rejected, verified to suspended or revoked, suspended to revoked' USING ERRCODE = '42501';
  END IF;
  -- The verification decision is set once (r2 (a)); a revocation after a suspension restamps the end.
  IF OLD.state <> 'pending' AND (NEW.decided_by, NEW.decided_at, NEW.decision_reason) IS DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.decision_reason) THEN
    RAISE EXCEPTION 'a credential keeps its decision' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.staff_credentials_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER staff_credentials_guard BEFORE INSERT OR UPDATE OR DELETE ON public.staff_credentials FOR EACH ROW EXECUTE FUNCTION public.staff_credentials_guard();--> statement-breakpoint
ALTER TABLE public.staff_credentials ENABLE ALWAYS TRIGGER staff_credentials_guard;--> statement-breakpoint
CREATE TRIGGER staff_credentials_no_truncate BEFORE TRUNCATE ON public.staff_credentials FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.staff_credentials ENABLE ALWAYS TRIGGER staff_credentials_no_truncate;--> statement-breakpoint

CREATE FUNCTION public.credential_alerts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'credential alerts are never changed or deleted' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_alerts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER credential_alerts_guard BEFORE UPDATE OR DELETE ON public.credential_alerts FOR EACH ROW EXECUTE FUNCTION public.credential_alerts_guard();--> statement-breakpoint
ALTER TABLE public.credential_alerts ENABLE ALWAYS TRIGGER credential_alerts_guard;--> statement-breakpoint
CREATE TRIGGER credential_alerts_no_truncate BEFORE TRUNCATE ON public.credential_alerts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.credential_alerts ENABLE ALWAYS TRIGGER credential_alerts_no_truncate;--> statement-breakpoint

-- The expiry alert type (system-only; plan r1 P2-2): the holder (addressed to the staff) and the facility
-- head of the credential's branch.
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('credential_expiry', 'STR/SIP hampir habis masa berlaku', '{facility_head}', '{staff_credential}', false);--> statement-breakpoint

-- Today in a credential's time: its branch (a permit), else the holder's earliest clinical branch, else the
-- tenant's earliest branch (open point 3).
CREATE FUNCTION public.credential_timezone(p_tenant uuid, p_staff uuid, p_branch uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT b.timezone FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = p_branch),
    (SELECT b.timezone FROM public.staff_branches sb JOIN public.branches b ON b.tenant_id = sb.tenant_id AND b.id = sb.branch_id
      WHERE sb.tenant_id = p_tenant AND sb.staff_id = p_staff AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head') ORDER BY b.created_at, b.id LIMIT 1),
    (SELECT b.timezone FROM public.branches b WHERE b.tenant_id = p_tenant ORDER BY b.created_at, b.id LIMIT 1),
    'Asia/Jakarta')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_timezone(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- One audit row and one CredentialChanged event (ids and lower-case codes only, no nulls) per change.
CREATE FUNCTION public.credential_changed(c public.staff_credentials, p_action text, p_change text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.audit_append(p_action, 'staff_credential', c.id, 'success', p_change);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (c.branch_id, 'CredentialChanged', 'staff_credential', c.id,
          jsonb_strip_nulls(jsonb_build_object('credential_id', c.id, 'staff_id', c.staff_id, 'branch_id', c.branch_id, 'kind', c.kind, 'change', p_change)));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_changed(public.staff_credentials, text, text) FROM PUBLIC;--> statement-breakpoint

-- ── credential_record (Tambah Kredensial): Owner, Admin Pusat ─────────────────────────────────────────
CREATE FUNCTION public.credential_record(p_staff uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_kind text := p ->> 'kind';
  v_branch uuid;
  v_replaces uuid;
  v_from date;
  v_until date;
  v_open uuid;
  c public.staff_credentials;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the Owner or Admin Pusat records credentials' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change this now' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(v_kind, '') NOT IN ('str','sip','sipp','sipa')
     OR coalesce(p ->> 'profession', '') NOT IN ('dokter','dokter_gigi','perawat','bidan','apoteker','tenaga_kesehatan_lain')
     OR length(btrim(coalesce(p ->> 'number', ''))) NOT BETWEEN 3 AND 60 OR length(btrim(coalesce(p ->> 'issuer', ''))) NOT BETWEEN 3 AND 120
     OR length(btrim(coalesce(p ->> 'scope', ''))) > 200 OR length(btrim(coalesce(p ->> 'evidence_note', ''))) > 300
     OR coalesce(p ->> 'valid_from', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR (p ->> 'expires_on') IS NOT NULL AND (p ->> 'expires_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR (p ->> 'branch_id') IS NOT NULL AND (p ->> 'branch_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (p ->> 'replaces') IS NOT NULL AND (p ->> 'replaces') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: credential' USING ERRCODE = '22023';
  END IF;
  v_branch := (p ->> 'branch_id')::uuid;
  v_replaces := (p ->> 'replaces')::uuid;
  v_from := (p ->> 'valid_from')::date;
  v_until := (p ->> 'expires_on')::date;
  IF (v_kind = 'str') <> (v_branch IS NULL) OR v_kind <> 'str' AND v_until IS NULL OR v_until < v_from
     OR v_kind = 'sipp' AND p ->> 'profession' <> 'perawat' OR v_kind = 'sipa' AND p ->> 'profession' <> 'apoteker'
     OR v_kind = 'sip' AND p ->> 'profession' NOT IN ('dokter','dokter_gigi','bidan','tenaga_kesehatan_lain') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: credential' USING ERRCODE = '22023';
  END IF;
  -- The holder: an active member with a clinical role (at the permit's branch).
  IF NOT public.credential_holder_ok(a.tenant_id, p_staff, v_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: clinical staff not found' USING ERRCODE = 'P0002';
  END IF;
  -- One live credential per staff, kind and branch: a second needs to name the one it replaces (r2 (b)).
  SELECT id INTO v_open FROM public.staff_credentials o
   WHERE o.tenant_id = a.tenant_id AND o.staff_id = p_staff AND o.kind = v_kind AND o.branch_id IS NOT DISTINCT FROM v_branch
     AND o.state IN ('pending','verified')
     AND NOT EXISTS (SELECT 1 FROM public.staff_credentials r WHERE r.tenant_id = o.tenant_id AND r.replaces = o.id AND r.state <> 'rejected')
   LIMIT 1;
  IF v_open IS NOT NULL AND v_replaces IS DISTINCT FROM v_open THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: credential_exists' USING ERRCODE = '55000';
  END IF;
  IF v_replaces IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.staff_credentials t WHERE t.tenant_id = a.tenant_id AND t.id = v_replaces AND t.staff_id = p_staff
          AND t.kind = v_kind AND t.branch_id IS NOT DISTINCT FROM v_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: replaced credential not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_replaces IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.staff_credentials r WHERE r.tenant_id = a.tenant_id AND r.replaces = v_replaces AND r.state <> 'rejected') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_replaced' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, scope, branch_id, valid_from, expires_on, evidence_note, replaces, recorded_by)
  VALUES (a.tenant_id, p_staff, v_kind, btrim(p ->> 'number'), btrim(p ->> 'issuer'), p ->> 'profession', NULLIF(btrim(coalesce(p ->> 'scope', '')), ''),
          v_branch, v_from, v_until, NULLIF(btrim(coalesce(p ->> 'evidence_note', '')), ''), v_replaces, a.staff_id)
  RETURNING * INTO c;
  PERFORM public.credential_changed(c, 'settings_change', 'credential_recorded');
  RETURN c.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_record(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.credential_record(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- A credential of the tenant within the actor's scope, locked (out of scope = not found). The facility head
-- acts for a credential concerning one of their live facility-head branches that is also allowed in the session.
CREATE FUNCTION public.credential_open(a record, p_id uuid) RETURNS public.staff_credentials
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.staff_credentials;
BEGIN
  SELECT * INTO c FROM public.staff_credentials WHERE tenant_id = a.tenant_id AND id = p_id FOR UPDATE;
  IF NOT FOUND OR a.role = 'facility_head' AND NOT EXISTS (
       SELECT 1 FROM public.credential_branches(c.tenant_id, c.staff_id, c.branch_id) b(id)
         JOIN public.staff_branches sb ON sb.tenant_id = a.tenant_id AND sb.staff_id = a.staff_id AND sb.role = 'facility_head' AND sb.branch_id = b.id
        WHERE public.app_branch_allowed(b.id)) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: credential not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN c;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_open(record, uuid) FROM PUBLIC;--> statement-breakpoint

-- The holder's inviter (the accepted invitation), if any.
CREATE FUNCTION public.credential_inviter(p_tenant uuid, p_staff uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.invited_by FROM public.staff_invitations i WHERE i.tenant_id = p_tenant AND i.accepted_staff_id = p_staff
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_inviter(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Is p_actor barred from verifying c (IAM-4): the holder, the recorder or the holder's inviter.
CREATE FUNCTION public.credential_conflicted(c public.staff_credentials, p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_actor = c.staff_id OR p_actor = c.recorded_by OR p_actor IN (SELECT public.credential_inviter(c.tenant_id, c.staff_id))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_conflicted(public.staff_credentials, uuid) FROM PUBLIC;--> statement-breakpoint

-- Is there an active facility head at a branch of c who may verify it (not conflicted)? When none, the
-- Owner verifies (the sole-PJ case; plan r1 P1-2).
CREATE FUNCTION public.credential_has_verifier(c public.staff_credentials) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.credential_branches(c.tenant_id, c.staff_id, c.branch_id) b(id)
      JOIN public.staff_branches sb ON sb.tenant_id = c.tenant_id AND sb.branch_id = b.id AND sb.role = 'facility_head'
      JOIN public.staff s ON s.tenant_id = sb.tenant_id AND s.id = sb.staff_id
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
     WHERE m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
       AND NOT public.credential_conflicted(c, sb.staff_id))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_has_verifier(public.staff_credentials) FROM PUBLIC;--> statement-breakpoint

-- ── credential_decide (Verifikasi / Tolak) ──────────────────────────────────────────────────────────
CREATE FUNCTION public.credential_decide(p_id uuid, p_verified boolean, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  c public.staff_credentials;
  v_today date;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('facility_head','owner') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the facility head verifies credentials' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change this now' USING ERRCODE = '42501';
  END IF;
  IF p_verified IS NULL OR NOT p_verified AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: decision' USING ERRCODE = '22023';
  END IF;
  c := public.credential_open(a, p_id);
  IF a.role = 'owner' AND public.credential_has_verifier(c) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the facility head of the branch verifies this credential' USING ERRCODE = '42501';
  END IF;
  IF public.credential_conflicted(c, a.staff_id) THEN
    RAISE EXCEPTION 'ERR_APPROVER_IS_REQUESTER: the holder, the recorder or the inviter cannot verify' USING ERRCODE = 'P0422';
  END IF;
  IF c.state <> 'pending' OR EXISTS (SELECT 1 FROM public.staff_credentials r WHERE r.tenant_id = c.tenant_id AND r.replaces = c.id AND r.state <> 'rejected') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_pending' USING ERRCODE = '55000';
  END IF;
  IF p_verified THEN
    v_today := (clock_timestamp() AT TIME ZONE public.credential_timezone(c.tenant_id, c.staff_id, c.branch_id))::date;
    IF c.expires_on < v_today OR NOT public.credential_holder_ok(c.tenant_id, c.staff_id, c.branch_id) THEN
      RAISE EXCEPTION 'ERR_CREDENTIAL_INVALID: expired or holder not active' USING ERRCODE = 'P0422';
    END IF;
  END IF;
  UPDATE public.staff_credentials SET state = CASE WHEN p_verified THEN 'verified' ELSE 'rejected' END, decided_by = a.staff_id,
         decided_at = clock_timestamp(), decision_reason = CASE WHEN p_verified THEN NULL ELSE btrim(p_reason) END
   WHERE tenant_id = c.tenant_id AND id = c.id RETURNING * INTO c;
  PERFORM public.credential_changed(c, 'approval', CASE WHEN p_verified THEN 'credential_verified' ELSE 'credential_rejected' END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_decide(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.credential_decide(uuid, boolean, text) TO clinic_app;--> statement-breakpoint

-- For the detail page (review r1 P2-1): per credential the caller may read, whether the caller may verify it
-- now (role and scope, the Owner only without another facility head, never the holder, recorder or inviter)
-- and, if not, why (a code the page words). Reads only credentials the caller can already read.
CREATE FUNCTION public.credential_decidable(p_ids uuid[]) RETURNS TABLE (credential_id uuid, ok boolean, why text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_staff uuid := public.app_staff_id();
  v_role text := public.app_acting_role();
  c public.staff_credentials;
BEGIN
  FOR c IN SELECT * FROM public.staff_credentials k WHERE k.tenant_id = v_tenant AND k.id = ANY (p_ids)
             AND public.credential_readable(k.tenant_id, k.staff_id, k.branch_id) LOOP
    credential_id := c.id;
    why := CASE
      WHEN v_role NOT IN ('facility_head','owner') THEN 'role'
      WHEN v_role = 'facility_head' AND NOT EXISTS (
             SELECT 1 FROM public.credential_branches(c.tenant_id, c.staff_id, c.branch_id) b(bid)
               JOIN public.staff_branches sb ON sb.tenant_id = v_tenant AND sb.staff_id = v_staff AND sb.role = 'facility_head' AND sb.branch_id = b.bid
              WHERE public.app_branch_allowed(b.bid)) THEN 'scope'
      WHEN v_role = 'owner' AND public.credential_has_verifier(c) THEN 'facility_head'
      WHEN v_staff = c.staff_id THEN 'holder'
      WHEN v_staff = c.recorded_by THEN 'recorder'
      WHEN v_staff IN (SELECT public.credential_inviter(c.tenant_id, c.staff_id)) THEN 'inviter'
      ELSE NULL END;
    ok := why IS NULL;
    RETURN NEXT;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_decidable(uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.credential_decidable(uuid[]) TO clinic_app;--> statement-breakpoint

-- ── credential_end (Tangguhkan / Cabut): facility head (scope) or Owner; at once (IAM-4) ─────────────
CREATE FUNCTION public.credential_end(p_id uuid, p_state text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  c public.staff_credentials;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('facility_head','owner') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the facility head or the Owner ends a credential' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.tenant_capability('configuration') OR public.tenant_capability('existing_appointment')) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change this now' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_state, '') NOT IN ('suspended','revoked') OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: end' USING ERRCODE = '22023';
  END IF;
  c := public.credential_open(a, p_id);
  IF NOT (c.state = 'verified' OR c.state = 'suspended' AND p_state = 'revoked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_active' USING ERRCODE = '55000';
  END IF;
  UPDATE public.staff_credentials SET state = p_state, ended_by = a.staff_id, ended_at = clock_timestamp(), end_reason = btrim(p_reason)
   WHERE tenant_id = c.tenant_id AND id = c.id RETURNING * INTO c;
  PERFORM public.credential_changed(c, 'settings_change', CASE WHEN p_state = 'suspended' THEN 'credential_suspended' ELSE 'credential_revoked' END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_end(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.credential_end(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- ── credential_valid (T-054 start gates, T-102 SATUSEHAT; plan r1 P1-4) ─────────────────────────────
-- False, never null: a verified, not superseded STR and a verified, not superseded permit for the branch,
-- both in force on the branch-local date of p_at, of the same profession; the holder active with a
-- clinical role at the branch.
CREATE FUNCTION public.credential_valid(p_staff uuid, p_branch uuid, p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH b AS (
    SELECT b.tenant_id, b.id, (p_at AT TIME ZONE b.timezone)::date AS d
      FROM public.branches b WHERE b.tenant_id = public.app_tenant_id() AND b.id = p_branch AND p_staff IS NOT NULL AND p_at IS NOT NULL
  ), live AS (
    SELECT c.* FROM public.staff_credentials c, b
     WHERE c.tenant_id = b.tenant_id AND c.staff_id = p_staff AND c.state = 'verified' AND c.valid_from <= b.d AND (c.expires_on IS NULL OR c.expires_on >= b.d)
       -- Superseded (review r1 P1-1): by a replacement that is ended (its suspension or revocation ends the
       -- line, never resurrecting the old row) or verified and already in force (an early renewal waits for
       -- its valid_from; the old one stays valid until then).
       AND NOT EXISTS (SELECT 1 FROM public.staff_credentials r WHERE r.tenant_id = c.tenant_id AND r.replaces = c.id
                        AND (r.state IN ('suspended','revoked') OR r.state = 'verified' AND r.valid_from <= b.d))
  )
  SELECT coalesce((
    SELECT public.credential_holder_ok(b.tenant_id, p_staff, b.id) AND EXISTS (
             SELECT 1 FROM live s JOIN live p ON p.profession = s.profession
              WHERE s.kind = 'str' AND p.kind IN ('sip','sipp','sipa') AND p.branch_id = b.id)
      FROM b), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_valid(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.credential_valid(uuid, uuid, timestamptz) TO clinic_app;--> statement-breakpoint

-- ── credential_alert_scan (the daily job; plan r1 P1-1, P2-2) ───────────────────────────────────────
-- Runs on an unbound worker connection (as events_claim). For each pending or verified, not superseded
-- credential with an expiry, of an active holder in an onboarding, live or suspended tenant: days left in
-- the credential's time (p_today overrides "today" for every credential); within 0–60 days the smallest
-- reached threshold (7, 30, 60) fires once, unless that or a smaller one already fired. The alert row is the
-- lock (ON CONFLICT DO NOTHING); notifications go to the holder and to the facility head of each branch
-- concerned. Returns the number of alerts sent.
CREATE FUNCTION public.credential_alert_scan(p_today date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
  v_today date;
  v_left integer;
  v_threshold integer;
  v_alert uuid;
  v_sent integer := 0;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'credential_alert_scan runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  FOR c IN
    SELECT k.* FROM public.staff_credentials k
      JOIN public.tenants_registry r ON r.id = k.tenant_id AND r.lifecycle_state IN ('onboarding','live','suspended')
     WHERE k.expires_on IS NOT NULL AND k.state IN ('pending','verified')
       -- Not superseded, by the same rule as credential_valid (review r1 P1-1): a pending renewal does not
       -- silence the expiry alerts of the credential still in force; an ended or verified-and-started one does.
       AND NOT EXISTS (SELECT 1 FROM public.staff_credentials x WHERE x.tenant_id = k.tenant_id AND x.replaces = k.id
                        AND (x.state IN ('suspended','revoked') OR x.state = 'verified' AND x.valid_from <= coalesce(p_today, current_date)))
       AND public.credential_holder_ok(k.tenant_id, k.staff_id, k.branch_id)
     ORDER BY k.tenant_id, k.id
  LOOP
    v_today := coalesce(p_today, (clock_timestamp() AT TIME ZONE public.credential_timezone(c.tenant_id, c.staff_id, c.branch_id))::date);
    v_left := c.expires_on - v_today;
    CONTINUE WHEN v_left < 0 OR v_left > 60;
    v_threshold := CASE WHEN v_left <= 7 THEN 7 WHEN v_left <= 30 THEN 30 ELSE 60 END;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.credential_alerts ca WHERE ca.tenant_id = c.tenant_id AND ca.credential_id = c.id AND ca.threshold <= v_threshold);
    v_alert := NULL;
    INSERT INTO public.credential_alerts (tenant_id, credential_id, threshold, alerted_on) VALUES (c.tenant_id, c.id, v_threshold, v_today)
      ON CONFLICT (tenant_id, credential_id, threshold) DO NOTHING RETURNING id INTO v_alert;
    CONTINUE WHEN v_alert IS NULL;
    INSERT INTO public.notifications (tenant_id, type, recipient_staff_id, branch_id, subject_kind, subject_id)
    VALUES (c.tenant_id, 'credential_expiry', c.staff_id, c.branch_id, 'staff_credential', c.id);
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id)
    SELECT c.tenant_id, 'credential_expiry', 'facility_head', b.id, 'staff_credential', c.id
      FROM public.credential_branches(c.tenant_id, c.staff_id, c.branch_id) b(id);
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.credential_alert_scan(date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.credential_alert_scan(date) TO clinic_app;
