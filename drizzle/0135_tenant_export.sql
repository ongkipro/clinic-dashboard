CREATE TABLE "tenant_export_files" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"size" bigint NOT NULL,
	"bytes" "bytea",
	CONSTRAINT "tenant_export_files_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_export_files_gen_path_key" UNIQUE("tenant_id","export_id","generation","path"),
	CONSTRAINT "tenant_export_files_check" CHECK ("tenant_export_files"."generation" >= 1
        and "tenant_export_files"."kind" in ('fhir','pdf','csv','media')
        and "tenant_export_files"."sha256" ~ '^[0-9a-f]{64}$'
        and "tenant_export_files"."size" >= 0 and "tenant_export_files"."size" <= 20971520
        and "tenant_export_files"."path" ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$'
        and length("tenant_export_files"."path") <= 200 and "tenant_export_files"."path" <> 'manifest.json'
        and "tenant_export_files"."path" !~ '(^|/)\.\.?(/|$)'
        and ("tenant_export_files"."bytes" is null or octet_length("tenant_export_files"."bytes") = "tenant_export_files"."size"))
);
--> statement-breakpoint
ALTER TABLE "tenant_export_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_exports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"published_generation" integer,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"size_bytes" bigint,
	"file_count" integer,
	"manifest_json" text,
	"manifest_sha256" text,
	"error_code" text,
	"download_count" integer DEFAULT 0 NOT NULL,
	"purged_at" timestamp with time zone,
	"command_key" text NOT NULL,
	CONSTRAINT "tenant_exports_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_exports_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "tenant_exports_check" CHECK ("tenant_exports"."state" in ('queued','running','ready','failed','expired')
        and "tenant_exports"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
        and "tenant_exports"."generation" >= 0 and "tenant_exports"."attempts" >= 0 and "tenant_exports"."attempts" <= 3
        and (("tenant_exports"."state" = 'running') = ("tenant_exports"."lease_until" is not null))
        and ("tenant_exports"."state" <> 'running' or ("tenant_exports"."generation" >= 1 and "tenant_exports"."attempts" >= 1 and "tenant_exports"."started_at" is not null))
        and (("tenant_exports"."completed_at" is null) = ("tenant_exports"."expires_at" is null))
        and ("tenant_exports"."expires_at" is null or "tenant_exports"."expires_at" = "tenant_exports"."completed_at" + interval '24 hours')
        and (("tenant_exports"."state" in ('ready','expired')) = ("tenant_exports"."completed_at" is not null and "tenant_exports"."manifest_sha256" is not null and "tenant_exports"."manifest_json" is not null and "tenant_exports"."published_generation" is not null))
        and ("tenant_exports"."published_generation" is null or ("tenant_exports"."published_generation" >= 1 and "tenant_exports"."published_generation" <= "tenant_exports"."generation"))
        and ("tenant_exports"."manifest_sha256" is null or "tenant_exports"."manifest_sha256" ~ '^[0-9a-f]{64}$')
        and (("tenant_exports"."state" = 'failed') = ("tenant_exports"."error_code" is not null))
        and ("tenant_exports"."error_code" is null or "tenant_exports"."error_code" ~ '^[a-z][a-z0-9_]{1,48}$')
        and ("tenant_exports"."state" <> 'expired' or "tenant_exports"."purged_at" is not null)
        and ("tenant_exports"."purged_at" is null or "tenant_exports"."state" in ('expired','failed'))
        and "tenant_exports"."download_count" >= 0
        and ("tenant_exports"."size_bytes" is null or "tenant_exports"."size_bytes" >= 0)
        and ("tenant_exports"."file_count" is null or "tenant_exports"."file_count" >= 0))
);
--> statement-breakpoint
ALTER TABLE "tenant_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_export_files" ADD CONSTRAINT "tenant_export_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_export_files" ADD CONSTRAINT "tenant_export_files_export_fk" FOREIGN KEY ("tenant_id","export_id") REFERENCES "public"."tenant_exports"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_exports" ADD CONSTRAINT "tenant_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_exports" ADD CONSTRAINT "tenant_exports_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_export_files_export_gen_idx" ON "tenant_export_files" USING btree ("tenant_id","export_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_exports_one_in_flight" ON "tenant_exports" USING btree ("tenant_id") WHERE "tenant_exports"."state" in ('queued','running');--> statement-breakpoint
CREATE INDEX "tenant_exports_requester_recent" ON "tenant_exports" USING btree ("tenant_id","requested_by","requested_at");--> statement-breakpoint
CREATE INDEX "tenant_exports_purge_due" ON "tenant_exports" USING btree ("state","expires_at","requested_at") WHERE "tenant_exports"."purged_at" is null;
--> statement-breakpoint

--> statement-breakpoint

-- T-122 rules (PR-52, UX-32, TEN-18, RATE-5, SEC-5; R3; closes all 9 findings of t122/PLAN-REVIEW-codex-panel3.md).
-- Security posture:
--   - RLS enabled on both tables (Drizzle .enableRLS() -> isRLSEnabled=true in snapshot); ZERO direct grants to clinic_app, clinic_vendor, clinic_operator.
--   - TEN-19 support_object_kinds = 'never' for BOTH tables (zero operator policy or grant).
--   - Owner-only bound operations verify role='owner', auth_user.two_factor_enabled, and lifecycle IN ('live','suspended','exit') on every path including replays.
--   - Unbound worker operations mirror DEC-124 (0131): export_unbound() asserts all 5 TEN-2 GUCs empty; export_snapshot_read runs on a staffless, roleless tenant-bound REPEATABLE READ tx.
--   - Canonical lock order: tenant_actor_lock (when bound) -> export_tenant_lock(tenant_id) -> tenant_exports FOR UPDATE.

REVOKE ALL ON TABLE public.tenant_exports FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.tenant_export_files FROM PUBLIC;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.tenant_exports', 'tenant-shared', 'export', '{owner}', 'export_request, export_release_commit (bound owner); export_claim, export_finish, export_fail, export_expire (unbound worker)', 'none (tenant-wide)'),
  ('public.tenant_export_files', 'tenant-shared', 'export', '{owner}', 'export_put_file, export_finish, export_expire (unbound worker); read only via export_release_load (bound owner)', 'none (tenant-wide)');--> statement-breakpoint

INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.tenant_exports', 'never'),
  ('public.tenant_export_files', 'never');--> statement-breakpoint

CREATE FUNCTION public.tenant_exports_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: tenant_exports are never deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.generation <> 0 OR NEW.attempts <> 0 OR NEW.published_generation IS NOT NULL
       OR NEW.completed_at IS NOT NULL OR NEW.purged_at IS NOT NULL OR NEW.download_count <> 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: export starts queued' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.requested_by, NEW.requested_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.requested_by, OLD.requested_at, OLD.command_key) THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: export identity is fixed' USING ERRCODE = '55000';
  END IF;
  IF NEW.generation < OLD.generation OR NEW.attempts < OLD.attempts OR NEW.download_count < OLD.download_count THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: counters only move forward' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'expired' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: expired export is final' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'failed' THEN
    IF NEW.state <> 'failed' OR NEW.error_code IS DISTINCT FROM OLD.error_code
       OR (OLD.purged_at IS NOT NULL AND NEW.purged_at IS DISTINCT FROM OLD.purged_at) THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: failed export keeps state and error_code' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF OLD.state = 'ready' THEN
    IF NEW.state NOT IN ('ready','expired')
       OR (NEW.published_generation, NEW.completed_at, NEW.expires_at, NEW.manifest_json, NEW.manifest_sha256, NEW.size_bytes, NEW.file_count)
          IS DISTINCT FROM (OLD.published_generation, OLD.completed_at, OLD.expires_at, OLD.manifest_json, OLD.manifest_sha256, OLD.size_bytes, OLD.file_count) THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: published export manifest and metadata are immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_exports_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER tenant_exports_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_exports FOR EACH ROW EXECUTE FUNCTION public.tenant_exports_guard();--> statement-breakpoint
ALTER TABLE public.tenant_exports ENABLE ALWAYS TRIGGER tenant_exports_guard;--> statement-breakpoint
CREATE TRIGGER tenant_exports_no_truncate BEFORE TRUNCATE ON public.tenant_exports FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.tenant_exports ENABLE ALWAYS TRIGGER tenant_exports_no_truncate;--> statement-breakpoint

CREATE FUNCTION public.tenant_export_files_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_IMMUTABLE: tenant_export_files are never deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.tenant_id, NEW.export_id, NEW.generation, NEW.path, NEW.kind, NEW.sha256, NEW.size)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.export_id, OLD.generation, OLD.path, OLD.kind, OLD.sha256, OLD.size)
       OR NEW.bytes IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_IMMUTABLE: export file rows only allow nulling bytes on purge' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_export_files_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER tenant_export_files_guard BEFORE UPDATE OR DELETE ON public.tenant_export_files FOR EACH ROW EXECUTE FUNCTION public.tenant_export_files_guard();--> statement-breakpoint
ALTER TABLE public.tenant_export_files ENABLE ALWAYS TRIGGER tenant_export_files_guard;--> statement-breakpoint
CREATE TRIGGER tenant_export_files_no_truncate BEFORE TRUNCATE ON public.tenant_export_files FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.tenant_export_files ENABLE ALWAYS TRIGGER tenant_export_files_no_truncate;--> statement-breakpoint

-- Private helper: worker connection must be completely unbound (all five TEN-2 GUCs empty; Finding #1, mirrors DEC-124).
CREATE FUNCTION public.export_unbound() RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> ''
     OR coalesce(current_setting('app.staff_id', true), '') <> ''
     OR coalesce(current_setting('app.roles', true), '') <> ''
     OR coalesce(current_setting('app.allowed_branch_ids', true), '') <> ''
     OR coalesce(current_setting('app.active_branch_id', true), '') <> '' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: export worker runs unbound' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_unbound() FROM PUBLIC;--> statement-breakpoint

-- Private helper: canonical per-tenant lock serializing request/publish/download/purge/lifecycle (Findings #3, #5, #7).
CREATE FUNCTION public.export_tenant_lock(p_tenant uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tenant_export:' || p_tenant::text, 0));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_tenant_lock(uuid) FROM PUBLIC;--> statement-breakpoint

-- Private helper: owner-only + enrolled 2FA + exportable lifecycle (live, suspended, exit; refuses closed; Findings #3 & #4).
CREATE FUNCTION public.export_owner_actor() RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.tenant_actor_lock();
  v_state text;
BEGIN
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: owner_only' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.staff s
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
      JOIN public.auth_user u ON u.id = m.account_id AND u.two_factor_enabled
     WHERE s.tenant_id = a.tenant_id AND s.id = a.staff_id
  ) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: second_factor_required' USING ERRCODE = '42501';
  END IF;
  SELECT r.lifecycle_state INTO v_state FROM public.tenants_registry r WHERE r.id = a.tenant_id FOR SHARE;
  IF v_state IS NULL OR v_state NOT IN ('live','suspended','exit') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: tenant_%', coalesce(v_state, 'unknown') USING ERRCODE = '55000';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_owner_actor() FROM PUBLIC;--> statement-breakpoint

-- 1. Owner request (Mulai Ekspor): owner + 2FA + live/suspended/exit (checked BEFORE replay!), RATE-5, single in-flight, audited.
CREATE FUNCTION public.export_request(p_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.export_owner_actor();
  v_id uuid;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: command_key' USING ERRCODE = '22023';
  END IF;
  PERFORM public.export_tenant_lock(a.tenant_id);

  SELECT x.id INTO v_id FROM public.tenant_exports x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_id, 'replayed', true);
  END IF;

  IF (SELECT count(*) FROM public.tenant_exports x
       WHERE x.tenant_id = a.tenant_id AND x.requested_by = a.staff_id
         AND x.requested_at > clock_timestamp() - interval '5 minutes') >= 5 THEN
    RAISE EXCEPTION 'ERR_RATE_LIMITED: exports' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.tenant_exports (tenant_id, requested_by, command_key)
  VALUES (a.tenant_id, a.staff_id, p_key)
  RETURNING id INTO v_id;

  PERFORM public.audit_append('export', 'tenant_export', v_id, 'success', 'export_requested');
  RETURN jsonb_build_object('id', v_id, 'replayed', false);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: export_in_progress' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_request(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_request(text) TO clinic_app;--> statement-breakpoint

-- 2. Owner list (UX-32): owner-only + live/suspended/exit; metadata only (zero paths/bytes/clinical text).
CREATE FUNCTION public.export_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.export_owner_actor();
  v_now timestamptz := clock_timestamp();
BEGIN
  RETURN jsonb_build_object(
    'now', v_now,
    'jobs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', x.id,
        'state', x.state,
        'requested_at', x.requested_at,
        'completed_at', x.completed_at,
        'expires_at', x.expires_at,
        'size_bytes', x.size_bytes,
        'file_count', x.file_count,
        'manifest_sha256', x.manifest_sha256,
        'download_count', x.download_count,
        'error_code', x.error_code,
        'purged_at', x.purged_at
      ) ORDER BY x.requested_at DESC, x.id DESC)
      FROM public.tenant_exports x
      WHERE x.tenant_id = a.tenant_id
    ), '[]'::jsonb)
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_list() TO clinic_app;--> statement-breakpoint

-- 3a. Guarded release loader (Findings #3, #4, #6, #7, #8): acquires export_tenant_lock -> FOR UPDATE, checks lifecycle & expiry on wall clock,
--     returns published generation rows WITHOUT auditing success yet (audit happens in export_release_commit after integrity verification!).
CREATE FUNCTION public.export_release_load(p_export uuid) RETURNS TABLE (
  export_id uuid,
  tenant_id uuid,
  published_generation integer,
  completed_at timestamptz,
  manifest_json text,
  manifest_sha256 text,
  path text,
  kind text,
  sha256 text,
  size bigint,
  bytes bytea
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.export_owner_actor();
  x public.tenant_exports;
BEGIN
  PERFORM public.export_tenant_lock(a.tenant_id);
  SELECT * INTO x FROM public.tenant_exports e WHERE e.tenant_id = a.tenant_id AND e.id = p_export FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: export' USING ERRCODE = 'P0002';
  END IF;
  IF x.state = 'expired' OR x.purged_at IS NOT NULL OR (x.expires_at IS NOT NULL AND clock_timestamp() >= x.expires_at) THEN
    RAISE EXCEPTION 'ERR_EXPIRED: expired' USING ERRCODE = '55000';
  END IF;
  IF x.state <> 'ready' OR x.published_generation IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_ready' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_export_files f
     WHERE f.tenant_id = x.tenant_id AND f.export_id = x.id AND f.generation = x.published_generation
  ) THEN
    RETURN QUERY
      SELECT x.id, x.tenant_id, x.published_generation, x.completed_at, x.manifest_json, x.manifest_sha256,
             f.path, f.kind, f.sha256, f.size, f.bytes
        FROM public.tenant_export_files f
       WHERE f.tenant_id = x.tenant_id AND f.export_id = x.id AND f.generation = x.published_generation
       ORDER BY f.path ASC;
  ELSE
    RETURN QUERY
      SELECT x.id, x.tenant_id, x.published_generation, x.completed_at, x.manifest_json, x.manifest_sha256,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::bytea;
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_release_load(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_release_load(uuid) TO clinic_app;--> statement-breakpoint

-- 3b. Guarded release commit (Finding #8): called ONLY AFTER TS manifest/byte/ZIP verification passes in the same transaction.
CREATE FUNCTION public.export_release_commit(p_export uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.export_owner_actor();
  x public.tenant_exports;
BEGIN
  PERFORM public.export_tenant_lock(a.tenant_id);
  SELECT * INTO x FROM public.tenant_exports e WHERE e.tenant_id = a.tenant_id AND e.id = p_export FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: export' USING ERRCODE = 'P0002';
  END IF;
  IF x.state <> 'ready' OR x.purged_at IS NOT NULL OR clock_timestamp() >= x.expires_at THEN
    RAISE EXCEPTION 'ERR_EXPIRED: expired' USING ERRCODE = '55000';
  END IF;
  UPDATE public.tenant_exports SET download_count = download_count + 1 WHERE tenant_id = x.tenant_id AND id = x.id;
  PERFORM public.audit_append('export', 'tenant_export', x.id, 'success', 'export_released');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_release_commit(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_release_commit(uuid) TO clinic_app;--> statement-breakpoint

-- 3c. Content-free denial audit (Finding #8): persisted in a separate transaction when release fails.
CREATE FUNCTION public.export_audit_denial(p_export uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.tenant_actor_lock();
  v_reason text := CASE WHEN p_reason ~ '^[a-z][a-z0-9_]{1,48}$' THEN p_reason ELSE 'export_release_denied' END;
BEGIN
  PERFORM public.audit_append('export', 'tenant_export', p_export, 'denied', v_reason);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_audit_denial(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_audit_denial(uuid, text) TO clinic_app;--> statement-breakpoint

-- 4. Unbound worker claim (Findings #1, #2, #3, R3 P2-2): canonical lock order
--    (tenant advisory lock -> tenants_registry FOR SHARE -> tenant_exports FOR UPDATE), skips closed tenants.
CREATE FUNCTION public.export_claim(p_lease_seconds integer DEFAULT 300) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_cand record;
  v_state text;
  x public.tenant_exports;
  v_sec integer := greatest(10, least(coalesce(p_lease_seconds, 300), 3600));
BEGIN
  PERFORM public.export_unbound();

  -- Mark any expired-lease running export that already exhausted MAX_ATTEMPTS (3) as terminal failed.
  FOR v_cand IN
    SELECT e.id, e.tenant_id
      FROM public.tenant_exports e
     WHERE e.state = 'running' AND e.lease_until <= v_now AND e.attempts >= 3
     ORDER BY e.requested_at ASC, e.id ASC
     LIMIT 10
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('tenant_export:' || v_cand.tenant_id::text, 0)) THEN
      CONTINUE;
    END IF;
    SELECT * INTO x
      FROM public.tenant_exports e
     WHERE e.tenant_id = v_cand.tenant_id AND e.id = v_cand.id
       FOR UPDATE;
    IF NOT FOUND OR x.state <> 'running' OR x.lease_until IS NULL OR x.lease_until > v_now OR x.attempts < 3 THEN
      CONTINUE;
    END IF;
    UPDATE public.tenant_exports
       SET state = 'failed', lease_until = NULL, error_code = 'lease_exhausted'
     WHERE tenant_id = x.tenant_id AND id = x.id AND state = 'running' AND generation = x.generation;
    INSERT INTO public.domain_events (tenant_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (x.tenant_id, 'TenantExportFailed', 'tenant_export', x.id, jsonb_build_object('export_id', x.id, 'error_code', 'lease_exhausted'));
  END LOOP;

  -- Claim one queued or expired-lease retryable export whose tenant is live/suspended/exit.
  FOR v_cand IN
    SELECT e.id, e.tenant_id
      FROM public.tenant_exports e
      JOIN public.tenants_registry r ON r.id = e.tenant_id
     WHERE r.lifecycle_state IN ('live','suspended','exit')
       AND (e.state = 'queued' OR (e.state = 'running' AND e.lease_until <= v_now AND e.attempts < 3))
     ORDER BY e.requested_at ASC, e.id ASC
     LIMIT 20
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('tenant_export:' || v_cand.tenant_id::text, 0)) THEN
      CONTINUE;
    END IF;
    SELECT r.lifecycle_state INTO v_state
      FROM public.tenants_registry r
     WHERE r.id = v_cand.tenant_id
       FOR SHARE;
    IF v_state IS NULL OR v_state NOT IN ('live','suspended','exit') THEN
      CONTINUE;
    END IF;
    SELECT * INTO x
      FROM public.tenant_exports e
     WHERE e.tenant_id = v_cand.tenant_id AND e.id = v_cand.id
       FOR UPDATE;
    IF NOT FOUND OR NOT (x.state = 'queued' OR (x.state = 'running' AND x.lease_until <= v_now AND x.attempts < 3)) THEN
      CONTINUE;
    END IF;
    UPDATE public.tenant_exports
       SET state = 'running',
           generation = generation + 1,
           attempts = attempts + 1,
           started_at = coalesce(started_at, v_now),
           lease_until = v_now + make_interval(secs => v_sec)
     WHERE tenant_id = x.tenant_id AND id = x.id
     RETURNING * INTO x;

    RETURN jsonb_build_object('id', x.id, 'tenant_id', x.tenant_id, 'generation', x.generation, 'attempts', x.attempts);
  END LOOP;

  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_claim(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_claim(integer) TO clinic_app;--> statement-breakpoint

-- 5. Staffless, roleless tenant-bound REPEATABLE READ snapshot reader (Findings #1, #2, #3, #9).
--    Reads all 16 business/clinical/CRM families strictly for app_tenant_id(); NEVER reads secrets, auth_*, token_vault, or waba tokens.
CREATE FUNCTION public.export_snapshot_read(p_export uuid, p_gen integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  x public.tenant_exports;
  v_state text;
  v_legal text;
BEGIN
  IF v_tenant IS NULL OR public.app_staff_id() IS NOT NULL OR public.app_acting_role() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: export_snapshot_read requires staffless roleless tenant context' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO x FROM public.tenant_exports e WHERE e.tenant_id = v_tenant AND e.id = p_export;
  IF NOT FOUND OR x.state <> 'running' OR x.generation <> p_gen OR x.lease_until IS NULL OR x.lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: lease_lost' USING ERRCODE = '55000';
  END IF;
  SELECT r.lifecycle_state INTO v_state FROM public.tenants_registry r WHERE r.id = v_tenant;
  IF v_state IS NULL OR v_state NOT IN ('live','suspended','exit') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: tenant_%', coalesce(v_state, 'unknown') USING ERRCODE = '55000';
  END IF;
  SELECT t.legal_name INTO v_legal FROM public.tenants t WHERE t.id = v_tenant;

  RETURN jsonb_build_object(
    'tenant', jsonb_build_object('id', v_tenant, 'legal_name', coalesce(v_legal, '')),
    'tenant_keys', coalesce((
      SELECT jsonb_agg(jsonb_build_object('version', k.version, 'wrapped', k.wrapped) ORDER BY k.version ASC)
        FROM public.tenant_data_keys k WHERE k.tenant_id = v_tenant
    ), '[]'::jsonb),
    'patients', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'mrn', p.mrn, 'full_name', p.full_name, 'birth_date', p.birth_date, 'sex', p.sex,
        'identity_type', p.identity_type, 'identity_enc', p.identity_enc, 'religion', p.religion,
        'occupation', p.occupation, 'education', p.education, 'marital_status', p.marital_status,
        'address', p.address, 'ihs_patient_id', p.ihs_patient_id, 'registered_branch_id', p.registered_branch_id,
        'created_at', p.created_at,
        'phone', (SELECT cp.value FROM public.contact_points cp WHERE cp.tenant_id = p.tenant_id AND cp.patient_id = p.id AND cp.is_primary LIMIT 1)
      ) ORDER BY p.id ASC)
      FROM public.patients p WHERE p.tenant_id = v_tenant
    ), '[]'::jsonb),
    'visits', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'branch_id', v.branch_id, 'branch_name', b.name, 'patient_id', v.patient_id,
        'kind', v.kind, 'checked_in_at', v.checked_in_at, 'closed_at', v.closed_at
      ) ORDER BY v.checked_in_at ASC, v.id ASC)
      FROM public.visits v JOIN public.branches b ON b.tenant_id = v.tenant_id AND b.id = v.branch_id
      WHERE v.tenant_id = v_tenant
    ), '[]'::jsonb),
    'record_versions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rv.id, 'branch_id', rv.branch_id, 'branch_name', b.name, 'examination_id', rv.examination_id,
        'visit_id', e.visit_id, 'patient_id', e.patient_id, 'version', rv.version, 'kind', rv.kind,
        'author_name', st.display_name, 'signed_at', e.signed_at, 'created_at', rv.created_at, 'content', rv.content
      ) ORDER BY rv.created_at ASC, rv.id ASC)
      FROM public.record_versions rv
      JOIN public.examinations e ON e.tenant_id = rv.tenant_id AND e.id = rv.examination_id
      JOIN public.branches b ON b.tenant_id = rv.tenant_id AND b.id = rv.branch_id
      JOIN public.staff st ON st.tenant_id = rv.tenant_id AND st.id = rv.created_by
      WHERE rv.tenant_id = v_tenant
    ), '[]'::jsonb),
    'media', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'patient_id', m.patient_id, 'content_type', m.content_type, 'sha256', m.sha256,
        'content_b64', encode(bl.content, 'base64')
      ) ORDER BY m.created_at ASC, m.id ASC)
      FROM public.clinical_media m
      JOIN public.clinical_media_blobs bl ON bl.tenant_id = m.tenant_id AND bl.sha256 = m.sha256
      WHERE m.tenant_id = v_tenant AND m.removed_at IS NULL
    ), '[]'::jsonb),
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'branch_id', i.branch_id, 'patient_id', i.patient_id, 'visit_id', i.visit_id,
        'number', i.number, 'state', i.state, 'issued_at', i.issued_at, 'created_at', i.created_at
      ) ORDER BY i.created_at ASC, i.id ASC)
      FROM public.invoices i WHERE i.tenant_id = v_tenant
    ), '[]'::jsonb),
    'invoice_lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'invoice_id', l.invoice_id, 'item_id', l.item_id, 'quantity', l.quantity,
        'unit_price', l.unit_price, 'discount', l.discount, 'line_total', l.line_total,
        'tax_category', l.tax_category, 'vat_base', l.vat_base, 'vat_amount', l.vat_amount, 'created_at', l.created_at
      ) ORDER BY l.created_at ASC, l.id ASC)
      FROM public.invoice_lines l WHERE l.tenant_id = v_tenant
    ), '[]'::jsonb),
    'payments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', y.id, 'branch_id', y.branch_id, 'invoice_id', y.invoice_id, 'patient_id', y.patient_id,
        'method', y.method, 'amount', y.amount, 'is_simulated', y.is_simulated, 'received_at', y.received_at
      ) ORDER BY y.received_at ASC, y.id ASC)
      FROM public.payments y WHERE y.tenant_id = v_tenant
    ), '[]'::jsonb),
    'packages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pk.id, 'sold_branch_id', pk.sold_branch_id, 'patient_id', pk.patient_id, 'invoice_id', pk.invoice_id,
        'item_id', pk.item_id, 'price', pk.price, 'state', pk.state, 'validity_end', pk.validity_end, 'created_at', pk.created_at
      ) ORDER BY pk.created_at ASC, pk.id ASC)
      FROM public.packages pk WHERE pk.tenant_id = v_tenant
    ), '[]'::jsonb),
    'balance_entries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', be.id, 'account_id', be.account_id, 'patient_id', ba.patient_id, 'branch_id', be.branch_id,
        'kind', be.kind, 'amount', be.amount, 'balance_after', be.balance_after, 'created_at', be.created_at
      ) ORDER BY be.seq ASC, be.id ASC)
      FROM public.balance_entries be
      JOIN public.balance_accounts ba ON ba.tenant_id = be.tenant_id AND ba.id = be.account_id
      WHERE be.tenant_id = v_tenant
    ), '[]'::jsonb),
    'receivables', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rc.id, 'branch_id', rc.branch_id, 'patient_id', rc.patient_id, 'visit_id', rc.visit_id,
        'amount', rc.amount, 'collected_amount', rc.collected_amount, 'written_off_amount', rc.written_off_amount,
        'state', rc.state, 'created_at', rc.created_at
      ) ORDER BY rc.created_at ASC, rc.id ASC)
      FROM public.receivables rc WHERE rc.tenant_id = v_tenant
    ), '[]'::jsonb),
    'journal_entries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', je.id, 'kind', je.kind, 'event', je.event, 'source_kind', je.source_kind,
        'source_id', je.source_id, 'business_date', je.business_date, 'period', je.period, 'posted_at', je.posted_at
      ) ORDER BY je.posted_at ASC, je.id ASC)
      FROM public.journal_entries je WHERE je.tenant_id = v_tenant
    ), '[]'::jsonb),
    'journal_lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', jl.id, 'entry_id', jl.entry_id, 'account_id', jl.account_id, 'branch_id', jl.branch_id,
        'debit', jl.debit, 'credit', jl.credit
      ) ORDER BY jl.id ASC)
      FROM public.journal_lines jl WHERE jl.tenant_id = v_tenant
    ), '[]'::jsonb),
    'leads', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ld.id, 'branch_id', ld.branch_id, 'source', ld.source, 'patient_id', ld.patient_id,
        'contact_name_enc', ld.contact_name_enc, 'contact_phone', ld.contact_phone, 'stage', ld.stage, 'created_at', ld.created_at
      ) ORDER BY ld.created_at ASC, ld.id ASC)
      FROM public.leads ld WHERE ld.tenant_id = v_tenant
    ), '[]'::jsonb),
    'conversations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cv.id, 'branch_id', cv.branch_id, 'patient_id', cv.patient_id, 'contact_wa_id', cv.contact_wa_id,
        'contact_name_enc', cv.contact_name_enc, 'state', cv.state, 'last_inbound_at', cv.last_inbound_at, 'created_at', cv.created_at
      ) ORDER BY cv.created_at ASC, cv.id ASC)
      FROM public.conversations cv WHERE cv.tenant_id = v_tenant
    ), '[]'::jsonb),
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ms.id, 'conversation_id', ms.conversation_id, 'direction', ms.direction, 'kind', ms.kind,
        'body_enc', ms.body_enc, 'status', ms.status, 'created_at', ms.created_at
      ) ORDER BY ms.created_at ASC, ms.id ASC)
      FROM public.messages ms WHERE ms.tenant_id = v_tenant
    ), '[]'::jsonb)
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_snapshot_read(uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_snapshot_read(uuid, integer) TO clinic_app;--> statement-breakpoint

-- 6. Fenced file put (Findings #2, #3, #7): unbound, verifies running + generation + live lease + lifecycle + SHA-256 + 20 MiB ceiling.
CREATE FUNCTION public.export_put_file(
  p_export uuid,
  p_gen integer,
  p_path text,
  p_kind text,
  p_sha256 text,
  p_bytes bytea
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x public.tenant_exports;
  v_state text;
  v_len bigint;
BEGIN
  PERFORM public.export_unbound();
  IF p_bytes IS NULL OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: file_bytes_required' USING ERRCODE = '22023';
  END IF;
  v_len := octet_length(p_bytes);
  IF v_len > 20971520 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: export_file_too_large' USING ERRCODE = '22023';
  END IF;
  IF encode(sha256(p_bytes), 'hex') IS DISTINCT FROM p_sha256 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: sha256_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO x FROM public.tenant_exports e WHERE e.id = p_export FOR UPDATE;
  IF NOT FOUND OR x.state <> 'running' OR x.generation <> p_gen OR x.lease_until IS NULL OR x.lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: lease_lost' USING ERRCODE = '55000';
  END IF;
  SELECT r.lifecycle_state INTO v_state FROM public.tenants_registry r WHERE r.id = x.tenant_id;
  IF v_state IS NULL OR v_state NOT IN ('live','suspended','exit') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: tenant_%', coalesce(v_state, 'unknown') USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.tenant_export_files (tenant_id, export_id, generation, path, kind, sha256, size, bytes)
  VALUES (x.tenant_id, x.id, p_gen, p_path, p_kind, p_sha256, v_len, p_bytes)
  ON CONFLICT (tenant_id, export_id, generation, path) DO NOTHING;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_put_file(uuid, integer, text, text, text, bytea) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_put_file(uuid, integer, text, text, text, bytea) TO clinic_app;--> statement-breakpoint

-- 7. Fenced publish (Findings #2, #3, #5, #6, #7): acquires export_tenant_lock BEFORE FOR UPDATE, checks lifecycle & lease & manifest hash & ceilings,
--    sets published_generation = p_gen, and reclaims any abandoned generations' bytes immediately.
CREATE FUNCTION public.export_finish(
  p_export uuid,
  p_gen integer,
  p_completed_at timestamptz,
  p_manifest_json text,
  p_manifest_sha256 text
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_tenant uuid;
  v_state text;
  x public.tenant_exports;
  v_count integer;
  v_total bigint;
BEGIN
  PERFORM public.export_unbound();
  IF p_completed_at IS NULL OR NOT isfinite(p_completed_at)
     OR p_manifest_json IS NULL OR p_manifest_sha256 IS NULL
     OR p_manifest_sha256 !~ '^[0-9a-f]{64}$'
     OR encode(sha256(convert_to(p_manifest_json, 'UTF8')), 'hex') IS DISTINCT FROM p_manifest_sha256 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: manifest_hash_mismatch' USING ERRCODE = '22023';
  END IF;
  -- R3 P2-3: bound caller timestamp to DB wall clock (±60s) and derive completed_at/expires_at strictly from DB clock.
  IF abs(extract(epoch FROM (p_completed_at - v_now))) > 60 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: completed_at_skew' USING ERRCODE = '22023';
  END IF;

  SELECT e.tenant_id INTO v_tenant FROM public.tenant_exports e WHERE e.id = p_export;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: export' USING ERRCODE = 'P0002';
  END IF;

  -- Canonical lock order: export_tenant_lock -> tenants_registry FOR SHARE -> tenant_exports FOR UPDATE.
  PERFORM public.export_tenant_lock(v_tenant);
  SELECT r.lifecycle_state INTO v_state FROM public.tenants_registry r WHERE r.id = v_tenant FOR SHARE;
  IF v_state IS NULL OR v_state NOT IN ('live','suspended','exit') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: tenant_%', coalesce(v_state, 'unknown') USING ERRCODE = '55000';
  END IF;

  SELECT * INTO x FROM public.tenant_exports e WHERE e.tenant_id = v_tenant AND e.id = p_export FOR UPDATE;
  IF NOT FOUND OR x.state <> 'running' OR x.generation <> p_gen OR x.lease_until IS NULL OR x.lease_until <= v_now THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: lease_lost' USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer, coalesce(sum(f.size), 0)::bigint
    INTO v_count, v_total
    FROM public.tenant_export_files f
   WHERE f.tenant_id = x.tenant_id AND f.export_id = x.id AND f.generation = p_gen;

  IF v_count > 10000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: export_too_many_entries' USING ERRCODE = '22023';
  END IF;
  IF v_total > 268435456 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: export_total_too_large' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tenant_exports
     SET state = 'ready',
         published_generation = p_gen,
         lease_until = NULL,
         completed_at = v_now,
         expires_at = v_now + interval '24 hours',
         size_bytes = v_total,
         file_count = v_count,
         manifest_json = p_manifest_json,
         manifest_sha256 = p_manifest_sha256
   WHERE tenant_id = x.tenant_id AND id = x.id;

  -- Reclaim bytes of any abandoned prior generation immediately (Finding #2 & #5).
  UPDATE public.tenant_export_files
     SET bytes = NULL
   WHERE tenant_id = x.tenant_id AND export_id = x.id AND generation <> p_gen AND bytes IS NOT NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_finish(uuid, integer, timestamptz, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_finish(uuid, integer, timestamptz, text, text) TO clinic_app;--> statement-breakpoint

-- 8. Fenced failure (Findings #2 & #8): content-free fixed error_code + unbound service event.
CREATE FUNCTION public.export_fail(p_export uuid, p_gen integer, p_error_code text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid;
  x public.tenant_exports;
  v_code text := CASE WHEN p_error_code ~ '^[a-z][a-z0-9_]{1,48}$' THEN p_error_code ELSE 'export_build_failed' END;
BEGIN
  PERFORM public.export_unbound();
  SELECT e.tenant_id INTO v_tenant FROM public.tenant_exports e WHERE e.id = p_export;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: export' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.export_tenant_lock(v_tenant);
  SELECT * INTO x FROM public.tenant_exports e WHERE e.tenant_id = v_tenant AND e.id = p_export FOR UPDATE;
  IF NOT FOUND OR x.state <> 'running' OR x.generation <> p_gen THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: lease_lost' USING ERRCODE = '55000';
  END IF;

  UPDATE public.tenant_exports
     SET state = 'failed', lease_until = NULL, error_code = v_code
   WHERE tenant_id = x.tenant_id AND id = x.id;

  INSERT INTO public.domain_events (tenant_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (x.tenant_id, 'TenantExportFailed', 'tenant_export', x.id, jsonb_build_object('export_id', x.id, 'error_code', v_code));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_fail(uuid, integer, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_fail(uuid, integer, text) TO clinic_app;--> statement-breakpoint

-- 9. Bounded expiry & purge worker (Findings #3 & #5): active even for closed tenants; serializes with download via export_tenant_lock;
--    ready past expires_at -> expired + bytes=NULL + purged_at; failed past requested_at+24h -> keeps state='failed'+error_code + bytes=NULL + purged_at.
CREATE FUNCTION public.export_expire(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_lim integer := greatest(1, least(coalesce(p_limit, 50), 500));
  v_exp_ready integer := 0;
  v_purged_failed integer := 0;
  v_purged_abandoned integer := 0;
  v_oldest double precision;
  r record;
BEGIN
  PERFORM public.export_unbound();

  FOR r IN
    SELECT e.id, e.tenant_id, e.state
      FROM public.tenant_exports e
     WHERE e.purged_at IS NULL
       AND (
         (e.state = 'ready' AND e.expires_at <= v_now)
         OR (e.state = 'failed' AND e.requested_at + interval '24 hours' <= v_now)
       )
     ORDER BY coalesce(e.expires_at, e.requested_at + interval '24 hours') ASC, e.id ASC
     LIMIT v_lim
  LOOP
    PERFORM public.export_tenant_lock(r.tenant_id);
    PERFORM 1 FROM public.tenant_exports e
     WHERE e.tenant_id = r.tenant_id AND e.id = r.id AND e.purged_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.tenant_export_files
       SET bytes = NULL
     WHERE tenant_id = r.tenant_id AND export_id = r.id AND bytes IS NOT NULL;

    IF r.state = 'ready' THEN
      UPDATE public.tenant_exports
         SET state = 'expired', purged_at = v_now
       WHERE tenant_id = r.tenant_id AND id = r.id AND state = 'ready';
      v_exp_ready := v_exp_ready + 1;
    ELSIF r.state = 'failed' THEN
      UPDATE public.tenant_exports
         SET purged_at = v_now
       WHERE tenant_id = r.tenant_id AND id = r.id AND state = 'failed';
      v_purged_failed := v_purged_failed + 1;
    END IF;
  END LOOP;

  -- Also reclaim any abandoned-generation bytes older than 24h from non-published generations.
  UPDATE public.tenant_export_files f
     SET bytes = NULL
    FROM public.tenant_exports e
   WHERE f.tenant_id = e.tenant_id AND f.export_id = e.id
     AND f.bytes IS NOT NULL
     AND (e.published_generation IS NULL OR f.generation <> e.published_generation)
     AND e.requested_at + interval '24 hours' <= v_now
     AND (e.state <> 'running' OR e.lease_until <= v_now);
  GET DIAGNOSTICS v_purged_abandoned = ROW_COUNT;

  SELECT extract(epoch FROM (v_now - min(coalesce(e.expires_at, e.requested_at + interval '24 hours'))))
    INTO v_oldest
    FROM public.tenant_exports e
   WHERE e.purged_at IS NULL
     AND (
       (e.state = 'ready' AND e.expires_at <= v_now)
       OR (e.state = 'failed' AND e.requested_at + interval '24 hours' <= v_now)
     );

  RETURN jsonb_build_object(
    'expired_ready', v_exp_ready,
    'purged_failed', v_purged_failed,
    'purged_abandoned_files', v_purged_abandoned,
    'oldest_due_seconds', CASE WHEN v_oldest IS NULL THEN NULL ELSE greatest(0, floor(v_oldest)) END
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.export_expire(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.export_expire(integer) TO clinic_app;
