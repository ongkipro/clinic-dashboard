CREATE TABLE "satusehat_practitioner_lookups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"nik_enc" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"link_id" uuid,
	"lease_gen" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"command_key" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "satusehat_practitioner_lookups_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "satusehat_practitioner_lookups_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "satusehat_practitioner_lookups_check" CHECK ("satusehat_practitioner_lookups"."state" in ('pending','leased','matched','not_found','ambiguous','failed','expired') and "satusehat_practitioner_lookups"."environment" in ('sandbox','production')
      and (("satusehat_practitioner_lookups"."state" in ('pending','leased')) = ("satusehat_practitioner_lookups"."nik_enc" is not null))
      and ("satusehat_practitioner_lookups"."nik_enc" is null or "satusehat_practitioner_lookups"."nik_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
      and (("satusehat_practitioner_lookups"."state" = 'matched') = ("satusehat_practitioner_lookups"."link_id" is not null))
      and (("satusehat_practitioner_lookups"."state" = 'failed') = ("satusehat_practitioner_lookups"."reason" is not null)) and ("satusehat_practitioner_lookups"."reason" is null or "satusehat_practitioner_lookups"."reason" in ('http_4xx','http_5xx','timeout','lost','malformed','token','binding','keys','expired','authority'))
      and (("satusehat_practitioner_lookups"."state" = 'leased') = ("satusehat_practitioner_lookups"."lease_until" is not null)) and "satusehat_practitioner_lookups"."lease_gen" >= 0
      and (("satusehat_practitioner_lookups"."state" in ('pending','leased')) = ("satusehat_practitioner_lookups"."finished_at" is null))
      and "satusehat_practitioner_lookups"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "satusehat_practitioner_lookups"."requested_as" in ('owner','facility_head')
      and "satusehat_practitioner_lookups"."expires_at" > "satusehat_practitioner_lookups"."requested_at" and "satusehat_practitioner_lookups"."expires_at" <= "satusehat_practitioner_lookups"."requested_at" + interval '15 minutes')
);
--> statement-breakpoint
ALTER TABLE "satusehat_practitioner_lookups" ADD CONSTRAINT "satusehat_practitioner_lookups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_practitioner_lookups" ADD CONSTRAINT "satusehat_practitioner_lookups_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_practitioner_lookups" ADD CONSTRAINT "satusehat_practitioner_lookups_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_practitioner_lookups" ADD CONSTRAINT "satusehat_practitioner_lookups_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satusehat_practitioner_lookups" ADD CONSTRAINT "satusehat_practitioner_lookups_link_fk" FOREIGN KEY ("tenant_id","link_id") REFERENCES "public"."satusehat_practitioner_links"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "satusehat_practitioner_lookups_one_open" ON "satusehat_practitioner_lookups" USING btree ("tenant_id","staff_id") WHERE "satusehat_practitioner_lookups"."state" in ('pending','leased');--> statement-breakpoint
CREATE INDEX "satusehat_practitioner_lookups_open_idx" ON "satusehat_practitioner_lookups" USING btree ("state","expires_at") WHERE "satusehat_practitioner_lookups"."state" in ('pending','leased');--> statement-breakpoint

-- T-102 inc4 logic (generated from the parts by the task's gen.py; plan docs/tasks/T-102.md)
-- ── TD-31 practitioner NIK lookup (T-102 increment 4; Panel 2 T102-TD31-DECISION; DEC-123) ───────────────────────────────────────────
-- Guard: never deleted; identity frozen (tenant, staff, branch, environment, key, requester, times of request and expiry); state moves only
-- pending → leased | expired, leased → pending (lease expired) | leased | matched | not_found | ambiguous | failed | expired; a terminal row
-- is final. The erasure of nik_enc at every terminal state is the table CHECK, not this guard.
CREATE FUNCTION public.satusehat_lookup_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb;
  n jsonb;
  k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a practitioner lookup is never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.lease_gen <> 0 OR NEW.link_id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: a lookup starts pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state NOT IN ('pending','leased') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a finished lookup is final' USING ERRCODE = '42501';
  END IF;
  o := to_jsonb(OLD);
  n := to_jsonb(NEW);
  FOREACH k IN ARRAY ARRAY['nik_enc','state','reason','link_id','lease_gen','lease_until','finished_at'] LOOP
    o := o - k;
    n := n - k;
  END LOOP;
  IF o <> n THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: satusehat_practitioner_lookups identity is frozen' USING ERRCODE = '42501';
  END IF;
  IF NEW.nik_enc IS NOT NULL AND NEW.nik_enc IS DISTINCT FROM OLD.nik_enc THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a sealed NIK is written once' USING ERRCODE = '42501';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       OLD.state = 'pending' AND NEW.state IN ('leased','expired')
    OR OLD.state = 'leased' AND NEW.state IN ('pending','matched','not_found','ambiguous','failed','expired')) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: lookup % -> %', OLD.state, NEW.state USING ERRCODE = '40001';
  END IF;
  IF NEW.lease_gen < OLD.lease_gen THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a lease generation only moves forward' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_lookup_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER satusehat_practitioner_lookups_guard BEFORE INSERT OR UPDATE OR DELETE ON public.satusehat_practitioner_lookups FOR EACH ROW EXECUTE FUNCTION public.satusehat_lookup_guard();--> statement-breakpoint
ALTER TABLE public.satusehat_practitioner_lookups ENABLE ALWAYS TRIGGER satusehat_practitioner_lookups_guard;--> statement-breakpoint
CREATE TRIGGER satusehat_practitioner_lookups_no_truncate BEFORE TRUNCATE ON public.satusehat_practitioner_lookups FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.satusehat_practitioner_lookups ENABLE ALWAYS TRIGGER satusehat_practitioner_lookups_no_truncate;--> statement-breakpoint
-- RLS on with no policy and no grant (as every SATUSEHAT table, 0116): read only through satusehat_page (the state, never nik_enc).
ALTER TABLE public.satusehat_practitioner_lookups ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.satusehat_practitioner_lookups', 'tenant-shared', 'integrations', '{}',
   'satusehat_practitioner_lookup_request (bound); satusehat_practitioner_lookup_claim / _record (unbound worker)', 'the branch whose credential is used');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.satusehat_practitioner_lookups', 'never');--> statement-breakpoint

-- Audit of a worker step (no bound staff): the service identity `satusehat.worker`, reason code only.
CREATE FUNCTION public.satusehat_audit_service(p_tenant uuid, p_object_kind text, p_object uuid, p_outcome text, p_reason_code text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_prev text;
  v_seq bigint;
  v_row public.audit_events;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || p_tenant::text, 0));
  SELECT e.hash, e.seq INTO v_prev, v_seq FROM public.audit_events e WHERE e.tenant_id = p_tenant ORDER BY e.seq DESC LIMIT 1;
  v_row := ROW(
    public.uuid_generate_v7(), p_tenant, coalesce(v_seq, 0) + 1, clock_timestamp(),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'satusehat.worker', NULL,
    'settings_change', p_object_kind, p_object, p_outcome, p_reason_code, NULL,
    coalesce(v_prev, repeat('0', 64)), repeat('0', 64))::public.audit_events;
  v_row.hash := encode(public.digest(v_row.prev_hash || public.audit_canonical(v_row), 'sha256'), 'hex');
  INSERT INTO public.audit_events SELECT v_row.*;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_audit_service(uuid, text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- ── The link writer, shared (T-102 inc4): satusehat_practitioner_link_set (0117) keeps its actor, validation and replay, and now calls the
-- internal apply — the same end-current / insert / requeue steps — which the lookup's record step calls too (source 'lookup'), so the
-- requeue of practitioner_unresolved work is identical for both paths. Audit stays with each caller (bound: audit_append; worker: service).
CREATE FUNCTION public.satusehat_practitioner_link_apply(p_tenant uuid, p_staff uuid, p_ihs text, p_source text, p_key text, p_by uuid, p_as text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
  o record;
BEGIN
  UPDATE public.satusehat_practitioner_links SET ended_at = clock_timestamp() WHERE tenant_id = p_tenant AND staff_id = p_staff AND ended_at IS NULL;
  INSERT INTO public.satusehat_practitioner_links (tenant_id, staff_id, ihs_practitioner_id, source, command_key, recorded_by, recorded_as)
  VALUES (p_tenant, p_staff, p_ihs, p_source, p_key, p_by, p_as) RETURNING id INTO v_id;
  FOR o IN SELECT x2.id FROM public.satusehat_outbox x2 JOIN public.satusehat_visit_context c ON c.tenant_id = x2.tenant_id AND c.visit_id = x2.visit_id
            WHERE x2.tenant_id = p_tenant AND x2.state = 'held' AND x2.hold_reason = 'practitioner_unresolved' AND c.doctor_staff_id = p_staff LOOP
    PERFORM public.satusehat_requeue(p_tenant, o.id);
  END LOOP;
  PERFORM public.satusehat_requeue_links(p_tenant, 'practitioner_unresolved', ARRAY(
    SELECT te.visit_id FROM public.treatment_executions te WHERE te.tenant_id = p_tenant AND te.performer_staff_id = p_staff
    UNION SELECT pr.visit_id FROM public.prescriptions pr WHERE pr.tenant_id = p_tenant AND pr.prescriber_staff_id = p_staff
    UNION SELECT d.visit_id FROM public.dispensings d WHERE d.tenant_id = p_tenant AND d.handed_by = p_staff AND d.visit_id IS NOT NULL));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_practitioner_link_apply(uuid, uuid, text, text, text, uuid, text) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.satusehat_practitioner_link_set(p_key text, p_staff uuid, p_ihs text, p_source text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','facility_head']);
  x public.satusehat_practitioner_links;
  v_id uuid;
BEGIN
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR coalesce(p_ihs, '') !~ '^[A-Za-z0-9-]{3,64}$' OR p_source NOT IN ('lookup','manual') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: practitioner' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO x FROM public.satusehat_practitioner_links l WHERE l.tenant_id = a.tenant_id AND l.command_key = p_key;
  -- a replay answers only an actor who may act on that staff member now (review r1 P2-8): authorize first, then replay
  IF NOT EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = a.tenant_id AND sb.staff_id = coalesce(x.staff_id, p_staff)
                   AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head')
                   AND (a.role = 'owner' OR public.app_branch_allowed(sb.branch_id) AND (a.branch_id IS NULL OR sb.branch_id = a.branch_id))) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF x.id IS NOT NULL THEN RETURN x.id; END IF;
  v_id := public.satusehat_practitioner_link_apply(a.tenant_id, p_staff, p_ihs, p_source, p_key, a.staff_id, a.role);
  PERFORM public.audit_append('settings_change', 'satusehat_practitioner_link', v_id, 'success', 'satusehat_practitioner_set');
  RETURN v_id;
END
$$;--> statement-breakpoint

-- May the requester act on this staff member at this branch NOW (wall clock, no session)? The worker's re-authorization at record time:
-- an active membership holding the requested role; the owner tenant-wide, a facility head assigned to the lookup's branch; and the staff
-- member still holds a clinical role at that branch.
CREATE FUNCTION public.satusehat_lookup_authorized(l public.satusehat_practitioner_lookups) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.staff s
             JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
             JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = l.requested_as
            WHERE s.tenant_id = l.tenant_id AND s.id = l.requested_by
              AND m.effective_from <= clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to > clock_timestamp())
              AND (r.role = 'owner' OR EXISTS (SELECT 1 FROM public.staff_branches b WHERE b.tenant_id = s.tenant_id AND b.staff_role_id = r.id
                                                 AND b.branch_id = l.branch_id)))
     AND EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = l.tenant_id AND sb.staff_id = l.staff_id AND sb.branch_id = l.branch_id
                   AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_lookup_authorized(public.satusehat_practitioner_lookups) FROM PUBLIC;--> statement-breakpoint

-- 1. Request (bound; owner / facility head; the actor lock first). p_id is generated by the server action, which sealed the NIK bound to it
-- (staff + lookup id inside the GCM plaintext). Authorization BEFORE the replay answers (as link_set, review r1 P2-8). A replay returns the
-- first id and never stores the new ciphertext. The staff member must hold a clinical role at p_branch, and p_branch an active credential for
-- this environment. One open lookup per staff member: a new request expires the open one (its sealed NIK cleared at once).
CREATE FUNCTION public.satusehat_practitioner_lookup_request(p_id uuid, p_key text, p_staff uuid, p_branch uuid, p_nik_enc text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','facility_head']);
  x public.satusehat_practitioner_lookups;
  v_env text := public.satusehat_env();
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_id IS NULL OR p_staff IS NULL OR p_branch IS NULL OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$'
     OR coalesce(p_nik_enc, '') !~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lookup' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO x FROM public.satusehat_practitioner_lookups l WHERE l.tenant_id = a.tenant_id AND l.command_key = p_key;
  PERFORM public.satusehat_branch(a, coalesce(x.branch_id, p_branch));
  IF NOT EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = a.tenant_id AND sb.staff_id = coalesce(x.staff_id, p_staff)
                   AND sb.branch_id = coalesce(x.branch_id, p_branch) AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head')) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF x.id IS NOT NULL THEN RETURN x.id; END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.satusehat_credentials c WHERE c.tenant_id = a.tenant_id AND c.branch_id = p_branch AND c.environment = v_env
                   AND c.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: credential' USING ERRCODE = '55000';
  END IF;
  UPDATE public.satusehat_practitioner_lookups SET state = 'expired', nik_enc = NULL, lease_until = NULL, finished_at = v_now
   WHERE tenant_id = a.tenant_id AND staff_id = p_staff AND state IN ('pending','leased');
  INSERT INTO public.satusehat_practitioner_lookups (id, tenant_id, staff_id, branch_id, environment, nik_enc, command_key, requested_by, requested_as,
                                                     requested_at, expires_at)
  VALUES (p_id, a.tenant_id, p_staff, p_branch, v_env, p_nik_enc, p_key, a.staff_id, a.role, v_now, v_now + interval '15 minutes');
  PERFORM public.audit_append('settings_change', 'satusehat_practitioner_lookup', p_id, 'success', 'satusehat_lookup_requested');
  PERFORM public.satusehat_event(a.tenant_id, p_branch, 'PractitionerLookupRequested', 'satusehat_practitioner_lookup', p_id,
    jsonb_build_object('lookup_id', p_id, 'staff_id', p_staff));
  RETURN p_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_practitioner_lookup_request(uuid, text, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_practitioner_lookup_request(uuid, text, uuid, uuid, text) TO clinic_app;--> statement-breakpoint

-- 2. Claim (unbound worker). First the sweep: every open lookup past expires_at → expired, its sealed NIK cleared (audited); then leased
-- rows past their lease → pending again; then pending rows of live / suspended tenants are leased (SKIP LOCKED, generation + 1, 2 minutes)
-- and handed to the worker with the branch's active credential for the row's environment (NULL when none) and the tenant's wrapped DEKs.
CREATE FUNCTION public.satusehat_practitioner_lookup_claim(p_now timestamptz DEFAULT NULL, p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  l public.satusehat_practitioner_lookups;
  v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.satusehat_unbound();
  FOR l IN SELECT * FROM public.satusehat_practitioner_lookups x WHERE x.state IN ('pending','leased') AND x.expires_at <= v_now FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.satusehat_practitioner_lookups SET state = 'expired', nik_enc = NULL, lease_until = NULL, finished_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id;
    PERFORM public.satusehat_audit_service(l.tenant_id, 'satusehat_practitioner_lookup', l.id, 'success', 'satusehat_lookup_expired');
  END LOOP;
  UPDATE public.satusehat_practitioner_lookups x SET state = 'pending', lease_until = NULL
   WHERE x.id IN (SELECT y.id FROM public.satusehat_practitioner_lookups y WHERE y.state = 'leased' AND y.lease_until <= v_now FOR UPDATE SKIP LOCKED);
  FOR l IN SELECT x.* FROM public.satusehat_practitioner_lookups x
             JOIN public.tenants_registry tr ON tr.id = x.tenant_id AND tr.lifecycle_state IN ('live','suspended')
            WHERE x.state = 'pending' ORDER BY x.requested_at, x.id LIMIT p_limit FOR UPDATE OF x SKIP LOCKED LOOP
    UPDATE public.satusehat_practitioner_lookups SET state = 'leased', lease_gen = lease_gen + 1, lease_until = v_now + interval '2 minutes'
     WHERE tenant_id = l.tenant_id AND id = l.id;
    v_out := v_out || jsonb_build_object('id', l.id, 'gen', l.lease_gen + 1, 'tenant_id', l.tenant_id, 'branch_id', l.branch_id,
      'staff_id', l.staff_id, 'nik_enc', l.nik_enc, 'expires_at', l.expires_at, 'environment', l.environment,
      'credential', (SELECT jsonb_build_object('id', c.id, 'generation', c.generation, 'organization_id', c.organization_id, 'client_id', c.client_id,
                       'secret_enc', c.secret_enc) FROM public.satusehat_credentials c
                      WHERE c.tenant_id = l.tenant_id AND c.branch_id = l.branch_id AND c.environment = l.environment AND c.revoked_at IS NULL),
      'keys', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', k.version, 'wrapped', k.wrapped, 'is_current', k.is_current) ORDER BY k.version), '[]'::jsonb)
                 FROM public.tenant_data_keys k WHERE k.tenant_id = l.tenant_id));
  END LOOP;
  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_practitioner_lookup_claim(timestamptz, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_practitioner_lookup_claim(timestamptz, integer) TO clinic_app;--> statement-breakpoint

-- 3. Record (unbound worker), fenced by the lease generation: p = {state: matched|not_found|ambiguous|failed, ihs?, reason?}. ONE terminal
-- transition clears the sealed NIK (the CHECK requires it). A lookup past expires_at is recorded expired (no link). On matched the requester's
-- authority is RE-CHECKED now (else failed/authority, no link), then the shared link apply (source 'lookup', key 'lookup:<id>', recorded by the
-- requester). ambiguous / not_found / failed never write a link. Returns the recorded state or 'stale' (not this lease any more).
CREATE FUNCTION public.satusehat_practitioner_lookup_record(p_id uuid, p_gen integer, p jsonb, p_now timestamptz DEFAULT NULL) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  -- review 44a609f4: the fence time is taken AFTER both locks (below). v_entry marks the call; an injected test clock (p_now) is advanced by the
  -- real time spent waiting, so a caller-captured instant never judges a lease or an expiry after a lock wait.
  v_entry timestamptz := clock_timestamp();
  v_now timestamptz;
  l public.satusehat_practitioner_lookups;
  v_state text := p ->> 'state';
  v_reason text := p ->> 'reason';
  v_ihs text := p ->> 'ihs';
  v_link uuid;
  v_tenant uuid;
BEGIN
  PERFORM public.satusehat_unbound();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_state IS NULL OR v_state NOT IN ('matched','not_found','ambiguous','failed')
     OR (v_state = 'matched') <> (v_ihs IS NOT NULL) OR (v_ihs IS NOT NULL AND v_ihs !~ '^[A-Za-z0-9-]{3,64}$')
     OR (v_state = 'failed') <> (v_reason IS NOT NULL)
     OR (v_reason IS NOT NULL AND v_reason NOT IN ('http_4xx','http_5xx','timeout','lost','malformed','token','binding','keys','expired')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lookup outcome' USING ERRCODE = '22023';
  END IF;
  -- review b62a4c56 F1: the record serializes with every authority change and with the manual link writer on the tenant's staff_access lock
  -- (staff_admin_lock, tenant_actor_lock / satusehat_actor), taken BEFORE the lookup row lock — the request path's order (actor lock, then
  -- row). The tenant is read without a lock only to name the lock; the row is then locked, re-read and re-fenced, and authority is judged
  -- in a statement that starts after the lock wait (a fresh snapshot, DEC-043).
  SELECT x.tenant_id INTO v_tenant FROM public.satusehat_practitioner_lookups x WHERE x.id = p_id;
  IF v_tenant IS NULL THEN
    RETURN 'stale';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_tenant::text, 0));
  SELECT * INTO l FROM public.satusehat_practitioner_lookups x WHERE x.id = p_id AND x.tenant_id = v_tenant FOR UPDATE;
  -- the effective fence time, read after the staff_access and row locks: the database wall clock (production passes no p_now), or the
  -- injected test clock plus the elapsed wait
  v_now := CASE WHEN p_now IS NULL THEN clock_timestamp() ELSE p_now + (clock_timestamp() - v_entry) END;
  IF l.id IS NULL OR l.state <> 'leased' OR l.lease_gen <> p_gen OR l.lease_until <= v_now THEN
    RETURN 'stale';
  END IF;
  IF l.expires_at <= v_now THEN
    v_state := 'expired'; v_reason := NULL;
  ELSIF v_state = 'matched' AND NOT public.satusehat_lookup_authorized(l) THEN
    v_state := 'failed'; v_reason := 'authority';
  ELSIF v_state = 'matched' THEN
    v_link := public.satusehat_practitioner_link_apply(l.tenant_id, l.staff_id, v_ihs, 'lookup', 'lookup:' || l.id::text, l.requested_by, l.requested_as);
  END IF;
  UPDATE public.satusehat_practitioner_lookups SET state = v_state, reason = v_reason, link_id = v_link, nik_enc = NULL, lease_until = NULL, finished_at = v_now
   WHERE tenant_id = l.tenant_id AND id = l.id;
  PERFORM public.satusehat_audit_service(l.tenant_id, 'satusehat_practitioner_lookup', l.id, CASE WHEN v_state = 'matched' THEN 'success' ELSE 'error' END,
    'satusehat_lookup_' || v_state);
  PERFORM public.satusehat_event(l.tenant_id, l.branch_id, 'PractitionerLookupFinished', 'satusehat_practitioner_lookup', l.id,
    jsonb_strip_nulls(jsonb_build_object('lookup_id', l.id, 'staff_id', l.staff_id, 'state', v_state, 'link_id', v_link)));
  RETURN v_state;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_practitioner_lookup_record(uuid, integer, jsonb, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_practitioner_lookup_record(uuid, integer, jsonb, timestamptz) TO clinic_app;--> statement-breakpoint

-- 4. Status for UX-23 (bound; owner / facility head of the branch): per staff member the latest lookup at this branch — state, failure reason
-- code, requested_at. Never nik_enc, never a link id. (A separate reader: 0118's satusehat_page is not re-created.)
CREATE FUNCTION public.satusehat_practitioner_lookup_status(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.satusehat_actor(ARRAY['owner','facility_head']);
BEGIN
  PERFORM public.satusehat_branch(a, p_branch);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('staff_id', q.staff_id, 'state', q.state, 'reason', q.reason, 'requested_at', q.requested_at)
                                    ORDER BY q.staff_id)
                     FROM (SELECT DISTINCT ON (l.staff_id) l.staff_id, l.state, l.reason, l.requested_at FROM public.satusehat_practitioner_lookups l
                            WHERE l.tenant_id = a.tenant_id AND l.branch_id = p_branch ORDER BY l.staff_id, l.requested_at DESC, l.id DESC) q), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.satusehat_practitioner_lookup_status(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.satusehat_practitioner_lookup_status(uuid) TO clinic_app;
