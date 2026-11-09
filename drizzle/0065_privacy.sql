CREATE TABLE "breach_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"breach_id" uuid NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"content_summary" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "breach_notices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "breach_notices_text_check" CHECK ("breach_notices"."recipient_kind" in ('data_subjects','authority','other') and length(btrim("breach_notices"."recipient")) between 2 and 200
      and length(btrim("breach_notices"."channel")) between 2 and 60 and length(btrim("breach_notices"."content_summary")) between 10 and 2000
      and length(btrim("breach_notices"."file_name")) between 1 and 200 and "breach_notices"."file_name" !~ '[/\\]' and "breach_notices"."sent_at" <= "breach_notices"."created_at"),
	CONSTRAINT "breach_notices_file_check" CHECK ("breach_notices"."media_type" in ('application/pdf','image/png','image/jpeg') and "breach_notices"."sha256" ~ '^[0-9a-f]{64}$'
      and "breach_notices"."sha256" = encode(sha256("breach_notices"."content"), 'hex') and "breach_notices"."size_bytes" between 1 and 5242880 and "breach_notices"."size_bytes" = octet_length("breach_notices"."content")),
	CONSTRAINT "breach_notices_created_as_check" CHECK ("breach_notices"."created_as" in ('owner','admin_pusat'))
);
--> statement-breakpoint
CREATE TABLE "breaches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aware_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"affected_count" integer,
	"data_categories" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"not_notifiable_reason" text,
	"assessed_at" timestamp with time zone,
	"assessed_by" uuid,
	"concluded_at" timestamp with time zone,
	"concluded_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "breaches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "breaches_deadline_check" CHECK ("breaches"."deadline_at" = "breaches"."aware_at" + interval '72 hours' and "breaches"."aware_at" <= "breaches"."created_at"),
	CONSTRAINT "breaches_text_check" CHECK (length(btrim("breaches"."description")) between 10 and 2000 and length(btrim("breaches"."data_categories")) between 2 and 300
      and ("breaches"."affected_count" is null or "breaches"."affected_count" >= 0)),
	CONSTRAINT "breaches_state_check" CHECK ("breaches"."state" in ('open','assessed','notified','not_notifiable','closed')
      and (("breaches"."state" = 'open') = ("breaches"."assessed_at" is null)) and (("breaches"."assessed_at" is null) = ("breaches"."assessed_by" is null))
      and (("breaches"."state" in ('open','assessed')) = ("breaches"."concluded_at" is null)) and (("breaches"."concluded_at" is null) = ("breaches"."concluded_by" is null))
      and (("breaches"."state" = 'closed') = ("breaches"."closed_at" is not null)) and (("breaches"."closed_at" is null) = ("breaches"."closed_by" is null))
      and (("breaches"."state" in ('open','assessed','notified') and "breaches"."not_notifiable_reason" is null)
           or ("breaches"."state" = 'not_notifiable' and length(btrim(coalesce("breaches"."not_notifiable_reason", ''))) between 10 and 1000)
           or ("breaches"."state" = 'closed' and ("breaches"."not_notifiable_reason" is null or length(btrim("breaches"."not_notifiable_reason")) between 10 and 1000))))
);
--> statement-breakpoint
CREATE TABLE "processors" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"service" text NOT NULL,
	"data_categories" text NOT NULL,
	"location" text NOT NULL,
	"role" text NOT NULL,
	"cross_border" boolean DEFAULT false NOT NULL,
	"transfer_basis" text,
	"agreement_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "processors_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "processors_text_check" CHECK (length(btrim("processors"."name")) between 2 and 120 and length(btrim("processors"."service")) between 2 and 200
      and length(btrim("processors"."data_categories")) between 2 and 300 and length(btrim("processors"."location")) between 2 and 120
      and ("processors"."agreement_ref" is null or length(btrim("processors"."agreement_ref")) between 1 and 200)),
	CONSTRAINT "processors_role_check" CHECK ("processors"."role" in ('processor','sub_processor')),
	CONSTRAINT "processors_transfer_check" CHECK ((not "processors"."cross_border" and "processors"."transfer_basis" is null) or ("processors"."cross_border" and length(btrim(coalesce("processors"."transfer_basis", ''))) between 3 and 300))
);
--> statement-breakpoint
ALTER TABLE "breach_notices" ADD CONSTRAINT "breach_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_notices" ADD CONSTRAINT "breach_notices_breach_fk" FOREIGN KEY ("tenant_id","breach_id") REFERENCES "public"."breaches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_notices" ADD CONSTRAINT "breach_notices_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breaches" ADD CONSTRAINT "breaches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breaches" ADD CONSTRAINT "breaches_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breaches" ADD CONSTRAINT "breaches_assessed_by_fk" FOREIGN KEY ("tenant_id","assessed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breaches" ADD CONSTRAINT "breaches_concluded_by_fk" FOREIGN KEY ("tenant_id","concluded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breaches" ADD CONSTRAINT "breaches_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processors" ADD CONSTRAINT "processors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processors" ADD CONSTRAINT "processors_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processors" ADD CONSTRAINT "processors_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "breach_notices_breach_idx" ON "breach_notices" USING btree ("tenant_id","breach_id");--> statement-breakpoint
CREATE INDEX "breaches_tenant_aware_idx" ON "breaches" USING btree ("tenant_id","aware_at");;--> statement-breakpoint

-- T-039 rules (generated; see header)
-- The privacy officers (PR-92, 19:211): the Owner, or Admin Pusat holding an active data-protection duty.
-- Invoker helper for the read policies (staff_duties is readable to both roles, 0026).
CREATE FUNCTION public.privacy_officer() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.app_role_in(ARRAY['owner']) OR public.app_role_in(ARRAY['admin_pusat']) AND EXISTS (
    SELECT 1 FROM public.staff_duties d
     WHERE d.tenant_id = public.app_tenant_id() AND d.staff_id = public.app_staff_id() AND d.duty = 'data_protection' AND d.ended_at IS NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.privacy_officer() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.privacy_officer() TO clinic_app;--> statement-breakpoint

ALTER TABLE public.processors ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY processors_read ON public.processors FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.privacy_officer());--> statement-breakpoint
GRANT SELECT ON public.processors TO clinic_app;--> statement-breakpoint
ALTER TABLE public.breaches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY breaches_read ON public.breaches FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.privacy_officer());--> statement-breakpoint
GRANT SELECT ON public.breaches TO clinic_app;--> statement-breakpoint
ALTER TABLE public.breach_notices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY breach_notices_read ON public.breach_notices FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.privacy_officer());--> statement-breakpoint
GRANT SELECT (id, tenant_id, breach_id, recipient_kind, recipient, sent_at, channel, content_summary, file_name, media_type, size_bytes, sha256, created_by, created_as, created_at) ON public.breach_notices TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.processors', 'tenant-shared', 'privacy', '{owner,admin_pusat}', 'processor_upsert, processor_set_active (src/modules/privacy)', 'none (tenant-wide)'),
  ('public.breaches', 'tenant-shared', 'privacy', '{owner,admin_pusat}', 'breach_record, breach_assess, breach_conclude, breach_close (src/modules/privacy)', 'none (tenant-wide)'),
  ('public.breach_notices', 'tenant-shared', 'privacy', '{owner,admin_pusat}', 'breach_notice_add (src/modules/privacy)', 'none (tenant-wide)');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): processors are configuration; a breach and its notices may
-- describe people (personal). Never the notice bytes (column grant).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.processors', 'config'), ('public.breaches', 'personal'), ('public.breach_notices', 'personal');--> statement-breakpoint
CREATE POLICY processors_operator_read ON public.processors FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.processors', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.processors TO clinic_operator;--> statement-breakpoint
CREATE POLICY breaches_operator_read ON public.breaches FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.breaches', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.breaches TO clinic_operator;--> statement-breakpoint
CREATE POLICY breach_notices_operator_read ON public.breach_notices FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.breach_notices', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, breach_id, recipient_kind, recipient, sent_at, channel, content_summary, file_name, media_type, size_bytes, sha256, created_by, created_as, created_at) ON public.breach_notices TO clinic_operator;--> statement-breakpoint

-- ── Guards (plan r1 P1-2) ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.processors_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.processors := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'processors are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a processor keeps its identity' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.processors_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER processors_guard BEFORE INSERT OR UPDATE OR DELETE ON public.processors FOR EACH ROW EXECUTE FUNCTION public.processors_guard();--> statement-breakpoint
ALTER TABLE public.processors ENABLE ALWAYS TRIGGER processors_guard;--> statement-breakpoint
CREATE TRIGGER processors_no_truncate BEFORE TRUNCATE ON public.processors FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.processors ENABLE ALWAYS TRIGGER processors_no_truncate;--> statement-breakpoint

CREATE FUNCTION public.breaches_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.breaches := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'breaches are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open' THEN
      RAISE EXCEPTION 'a breach is recorded open' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.aware_at, NEW.deadline_at, NEW.description, NEW.affected_count, NEW.data_categories, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.aware_at, OLD.deadline_at, OLD.description, OLD.affected_count, OLD.data_categories, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a breach keeps its awareness time, deadline and description' USING ERRCODE = '42501';
  END IF;
  IF NOT (OLD.state = 'open' AND NEW.state = 'assessed'
          OR OLD.state = 'assessed' AND NEW.state IN ('notified','not_notifiable')
          OR OLD.state IN ('notified','not_notifiable') AND NEW.state = 'closed') THEN
    RAISE EXCEPTION 'a breach moves open, assessed, notified or not notifiable, closed' USING ERRCODE = '42501';
  END IF;
  IF OLD.state <> 'open' AND (NEW.assessed_at, NEW.assessed_by) IS DISTINCT FROM (OLD.assessed_at, OLD.assessed_by)
     OR OLD.state IN ('notified','not_notifiable') AND (NEW.concluded_at, NEW.concluded_by, NEW.not_notifiable_reason)
        IS DISTINCT FROM (OLD.concluded_at, OLD.concluded_by, OLD.not_notifiable_reason) THEN
    RAISE EXCEPTION 'a breach keeps its earlier steps' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'notified' AND NOT EXISTS (SELECT 1 FROM public.breach_notices n WHERE n.tenant_id = NEW.tenant_id AND n.breach_id = NEW.id) THEN
    RAISE EXCEPTION 'a breach is notified only with a notice' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breaches_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER breaches_guard BEFORE INSERT OR UPDATE OR DELETE ON public.breaches FOR EACH ROW EXECUTE FUNCTION public.breaches_guard();--> statement-breakpoint
ALTER TABLE public.breaches ENABLE ALWAYS TRIGGER breaches_guard;--> statement-breakpoint
CREATE TRIGGER breaches_no_truncate BEFORE TRUNCATE ON public.breaches FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.breaches ENABLE ALWAYS TRIGGER breaches_no_truncate;--> statement-breakpoint

CREATE FUNCTION public.breach_notices_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.breach_notices := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'breach notices are never changed or deleted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.breaches b WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.breach_id AND b.state IN ('assessed','notified')) THEN
    RAISE EXCEPTION 'a notice belongs to an assessed or notified breach' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breach_notices_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER breach_notices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.breach_notices FOR EACH ROW EXECUTE FUNCTION public.breach_notices_guard();--> statement-breakpoint
ALTER TABLE public.breach_notices ENABLE ALWAYS TRIGGER breach_notices_guard;--> statement-breakpoint
CREATE TRIGGER breach_notices_no_truncate BEFORE TRUNCATE ON public.breach_notices FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.breach_notices ENABLE ALWAYS TRIGGER breach_notices_no_truncate;--> statement-breakpoint

-- The writers' actor (plan r1 P1-3): staff_access first, then the officer check on the post-lock snapshot,
-- then the capability (NULL for the download). Returns the actor record.
CREATE FUNCTION public.privacy_actor(p_capability text) RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT (a.role = 'owner' OR a.role = 'admin_pusat' AND EXISTS (
           SELECT 1 FROM public.staff_duties d
            WHERE d.tenant_id = a.tenant_id AND d.staff_id = a.staff_id AND d.duty = 'data_protection' AND d.ended_at IS NULL)) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the privacy officers manage the privacy registers' USING ERRCODE = '42501';
  END IF;
  IF p_capability IS NOT NULL AND NOT public.tenant_capability(p_capability) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change this now' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.privacy_actor(text) FROM PUBLIC;--> statement-breakpoint

-- Pemroses: add or edit one processor (the register of processors and sub-processors, PRIV-13, PRIV-18).
CREATE FUNCTION public.processor_upsert(p_id uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('configuration');
  v_id uuid;
  v_cross boolean := coalesce((p ->> 'cross_border')::boolean, false);
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p ->> 'role', '') NOT IN ('processor','sub_processor')
     OR length(btrim(coalesce(p ->> 'name', ''))) NOT BETWEEN 2 AND 120 OR length(btrim(coalesce(p ->> 'service', ''))) NOT BETWEEN 2 AND 200
     OR length(btrim(coalesce(p ->> 'data_categories', ''))) NOT BETWEEN 2 AND 300 OR length(btrim(coalesce(p ->> 'location', ''))) NOT BETWEEN 2 AND 120
     OR v_cross AND length(btrim(coalesce(p ->> 'transfer_basis', ''))) NOT BETWEEN 3 AND 300
     OR length(btrim(coalesce(p ->> 'agreement_ref', ''))) > 200 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: processor' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.processors (tenant_id, name, service, data_categories, location, role, cross_border, transfer_basis, agreement_ref, created_by, updated_by)
    VALUES (a.tenant_id, btrim(p ->> 'name'), btrim(p ->> 'service'), btrim(p ->> 'data_categories'), btrim(p ->> 'location'), p ->> 'role', v_cross,
            CASE WHEN v_cross THEN btrim(p ->> 'transfer_basis') END, NULLIF(btrim(coalesce(p ->> 'agreement_ref', '')), ''), a.staff_id, a.staff_id)
    RETURNING id INTO v_id;
    PERFORM public.audit_append('settings_change', 'processor', v_id, 'success', 'processor_added');
  ELSE
    UPDATE public.processors SET name = btrim(p ->> 'name'), service = btrim(p ->> 'service'), data_categories = btrim(p ->> 'data_categories'),
           location = btrim(p ->> 'location'), role = p ->> 'role', cross_border = v_cross, transfer_basis = CASE WHEN v_cross THEN btrim(p ->> 'transfer_basis') END,
           agreement_ref = NULLIF(btrim(coalesce(p ->> 'agreement_ref', '')), ''), updated_by = a.staff_id, updated_at = clock_timestamp()
     WHERE tenant_id = a.tenant_id AND id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: processor not found' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.audit_append('settings_change', 'processor', v_id, 'success', 'processor_changed');
  END IF;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.processor_upsert(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.processor_upsert(uuid, jsonb) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.processor_set_active(p_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('configuration');
  v_id uuid;
BEGIN
  UPDATE public.processors SET active = p_active, updated_by = a.staff_id, updated_at = clock_timestamp()
   WHERE tenant_id = a.tenant_id AND id = p_id AND active IS DISTINCT FROM p_active RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.processors WHERE tenant_id = a.tenant_id AND id = p_id) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: processor not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN;
  END IF;
  PERFORM public.audit_append('settings_change', 'processor', v_id, 'success', CASE WHEN p_active THEN 'processor_activated' ELSE 'processor_ended' END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.processor_set_active(uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.processor_set_active(uuid, boolean) TO clinic_app;--> statement-breakpoint

-- Catat Kebocoran (scenario PR-92): the awareness time (not in the future) sets the 3×24 h deadline.
-- A breach is a statutory record: allowed while the tenant still holds data (data_request).
CREATE FUNCTION public.breach_record(p_aware_at timestamptz, p_description text, p_affected integer, p_categories text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  v_id uuid;
BEGIN
  IF p_aware_at IS NULL OR p_aware_at > clock_timestamp() OR length(btrim(coalesce(p_description, ''))) NOT BETWEEN 10 AND 2000
     OR length(btrim(coalesce(p_categories, ''))) NOT BETWEEN 2 AND 300 OR p_affected < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: breach' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.breaches (tenant_id, aware_at, deadline_at, description, affected_count, data_categories, created_by)
  VALUES (a.tenant_id, p_aware_at, p_aware_at + interval '72 hours', btrim(p_description), p_affected, btrim(p_categories), a.staff_id)
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'breach', v_id, 'success', 'breach_recorded');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breach_record(timestamptz, text, integer, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.breach_record(timestamptz, text, integer, text) TO clinic_app;--> statement-breakpoint

-- A breach row of the tenant, locked, for a transition.
CREATE FUNCTION public.breach_open(a record, p_breach uuid) RETURNS public.breaches
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.breaches;
BEGIN
  SELECT * INTO b FROM public.breaches WHERE tenant_id = a.tenant_id AND id = p_breach FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: breach not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN b;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breach_open(record, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.breach_assess(p_breach uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  b public.breaches := public.breach_open(a, p_breach);
BEGIN
  IF b.state <> 'open' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_open' USING ERRCODE = '55000';
  END IF;
  UPDATE public.breaches SET state = 'assessed', assessed_at = clock_timestamp(), assessed_by = a.staff_id WHERE tenant_id = b.tenant_id AND id = b.id;
  PERFORM public.audit_append('settings_change', 'breach', b.id, 'success', 'breach_assessed');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breach_assess(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.breach_assess(uuid) TO clinic_app;--> statement-breakpoint

-- Assessed → notified (at least one notice recorded) or not notifiable (with the reason).
CREATE FUNCTION public.breach_conclude(p_breach uuid, p_notifiable boolean, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  b public.breaches := public.breach_open(a, p_breach);
BEGIN
  IF b.state <> 'assessed' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_assessed' USING ERRCODE = '55000';
  END IF;
  IF p_notifiable IS NULL OR p_notifiable AND p_reason IS NOT NULL
     OR NOT p_notifiable AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  IF p_notifiable AND NOT EXISTS (SELECT 1 FROM public.breach_notices n WHERE n.tenant_id = b.tenant_id AND n.breach_id = b.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: notice_required' USING ERRCODE = '55000';
  END IF;
  UPDATE public.breaches SET state = CASE WHEN p_notifiable THEN 'notified' ELSE 'not_notifiable' END, concluded_at = clock_timestamp(), concluded_by = a.staff_id,
         not_notifiable_reason = CASE WHEN p_notifiable THEN NULL ELSE btrim(p_reason) END
   WHERE tenant_id = b.tenant_id AND id = b.id;
  PERFORM public.audit_append('settings_change', 'breach', b.id, 'success', CASE WHEN p_notifiable THEN 'breach_notified' ELSE 'breach_not_notifiable' END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breach_conclude(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.breach_conclude(uuid, boolean, text) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.breach_close(p_breach uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  b public.breaches := public.breach_open(a, p_breach);
BEGIN
  IF b.state NOT IN ('notified','not_notifiable') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_concluded' USING ERRCODE = '55000';
  END IF;
  UPDATE public.breaches SET state = 'closed', closed_at = clock_timestamp(), closed_by = a.staff_id WHERE tenant_id = b.tenant_id AND id = b.id;
  PERFORM public.audit_append('settings_change', 'breach', b.id, 'success', 'breach_closed');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breach_close(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.breach_close(uuid) TO clinic_app;--> statement-breakpoint

-- A notice with its evidence file (PRIV-9): the checksum recomputed and the type read from the bytes
-- (as evidence_upload, 0030); the same file twice on one breach adds nothing.
CREATE FUNCTION public.breach_notice_add(p_breach uuid, p jsonb, p_file_name text, p_media_type text, p_content bytea, p_sha256 text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor('data_request');
  b public.breaches := public.breach_open(a, p_breach);
  v_type text;
  v_sent timestamptz;
  v_id uuid;
BEGIN
  IF b.state NOT IN ('assessed','notified') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_assessed' USING ERRCODE = '55000';
  END IF;
  IF p_content IS NULL OR octet_length(p_content) NOT BETWEEN 1 AND 5242880 OR p_sha256 IS DISTINCT FROM encode(sha256(p_content), 'hex') THEN
    RAISE EXCEPTION 'ERR_INVALID_FILE: file missing, too large or checksum mismatch' USING ERRCODE = '22023';
  END IF;
  v_type := CASE
    WHEN substring(p_content FROM 1 FOR 5) = '\x255044462d'::bytea THEN 'application/pdf'
    WHEN substring(p_content FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea THEN 'image/png'
    WHEN substring(p_content FROM 1 FOR 3) = '\xffd8ff'::bytea THEN 'image/jpeg' END;
  IF v_type IS NULL OR p_media_type IS DISTINCT FROM v_type THEN
    RAISE EXCEPTION 'ERR_INVALID_FILE: only PDF, PNG or JPEG by content' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_sent := (p ->> 'sent_at')::timestamptz;
  EXCEPTION WHEN others THEN
    v_sent := NULL;
  END;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p ->> 'recipient_kind', '') NOT IN ('data_subjects','authority','other')
     OR length(btrim(coalesce(p ->> 'recipient', ''))) NOT BETWEEN 2 AND 200 OR length(btrim(coalesce(p ->> 'channel', ''))) NOT BETWEEN 2 AND 60
     OR length(btrim(coalesce(p ->> 'content_summary', ''))) NOT BETWEEN 10 AND 2000
     OR v_sent IS NULL OR v_sent > clock_timestamp() OR v_sent < b.aware_at
     OR length(btrim(coalesce(p_file_name, ''))) NOT BETWEEN 1 AND 200 OR p_file_name ~ '[/\\]' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: notice' USING ERRCODE = '22023';
  END IF;
  SELECT n.id INTO v_id FROM public.breach_notices n WHERE n.tenant_id = b.tenant_id AND n.breach_id = b.id AND n.sha256 = p_sha256;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.breach_notices (tenant_id, breach_id, recipient_kind, recipient, sent_at, channel, content_summary, file_name, media_type, size_bytes,
                                     sha256, content, created_by, created_as)
  VALUES (b.tenant_id, b.id, p ->> 'recipient_kind', btrim(p ->> 'recipient'), v_sent, btrim(p ->> 'channel'), btrim(p ->> 'content_summary'),
          btrim(p_file_name), v_type, octet_length(p_content), encode(sha256(p_content), 'hex'), p_content, a.staff_id, a.role)
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'breach_notice', v_id, 'success', 'breach_notice_added');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breach_notice_add(uuid, jsonb, text, text, bytea, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.breach_notice_add(uuid, jsonb, text, text, bytea, text) TO clinic_app;--> statement-breakpoint

-- One notice file for an officer (the bytes are granted to no app role); every download is audited.
CREATE FUNCTION public.breach_notice_file(p_id uuid) RETURNS TABLE (file_name text, media_type text, content bytea, sha256 text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.privacy_actor(NULL);
BEGIN
  RETURN QUERY SELECT n.file_name, n.media_type, n.content, n.sha256 FROM public.breach_notices n WHERE n.tenant_id = a.tenant_id AND n.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: notice not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_append('export', 'breach_notice', p_id, 'success', 'breach_notice_downloaded');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.breach_notice_file(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.breach_notice_file(uuid) TO clinic_app;--> statement-breakpoint

-- Privasi & Persetujuan (UX-30 ▸ Privasi): the consent texts (every version), ledger counts per purpose and
-- the latest 50 consent events across patients (names and MRNs: the officers read identities; no clinical
-- content), the processors, the breaches with their notices (metadata), and the database time.
CREATE FUNCTION public.privacy_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  IF NOT (a.role = 'owner' OR a.role = 'admin_pusat' AND EXISTS (
           SELECT 1 FROM public.staff_duties d
            WHERE d.tenant_id = a.tenant_id AND d.staff_id = a.staff_id AND d.duty = 'data_protection' AND d.ended_at IS NULL)) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the privacy officers read the privacy registers' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'now', clock_timestamp(),
    'texts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'purpose', t.purpose, 'version', t.version, 'body', t.body,
                 'effective_from', t.effective_from) ORDER BY t.purpose, t.version DESC)
        FROM public.consent_texts t WHERE t.tenant_id = a.tenant_id), '[]'::jsonb),
    'counts', coalesce((SELECT jsonb_agg(jsonb_build_object('purpose', x.purpose, 'active', x.active, 'withdrawn', x.withdrawn) ORDER BY x.purpose) FROM (
        SELECT c.purpose, count(*) FILTER (WHERE c.withdrawn_at IS NULL) AS active, count(*) FILTER (WHERE c.withdrawn_at IS NOT NULL) AS withdrawn
          FROM public.consents c WHERE c.tenant_id = a.tenant_id GROUP BY c.purpose) x), '[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(r ORDER BY r ->> 'at' DESC) FROM (
        SELECT jsonb_build_object('id', c.id, 'patient_id', c.patient_id, 'patient_mrn', p.mrn, 'patient_name', p.full_name, 'purpose', c.purpose,
                 'text_version', t.version, 'state', CASE WHEN c.withdrawn_at IS NULL THEN 'active' ELSE 'withdrawn' END,
                 'granted_at', c.granted_at, 'grant_channel', c.grant_channel, 'withdrawn_at', c.withdrawn_at, 'withdraw_channel', c.withdraw_channel,
                 'at', greatest(c.granted_at, coalesce(c.withdrawn_at, c.granted_at))) AS r
          FROM public.consents c
          JOIN public.patients p ON p.tenant_id = c.tenant_id AND p.id = c.patient_id
          JOIN public.consent_texts t ON t.tenant_id = c.tenant_id AND t.id = c.consent_text_id
         WHERE c.tenant_id = a.tenant_id
         ORDER BY greatest(c.granted_at, coalesce(c.withdrawn_at, c.granted_at)) DESC, c.id LIMIT 50) s), '[]'::jsonb),
    'processors', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'service', x.service, 'data_categories', x.data_categories,
                 'location', x.location, 'role', x.role, 'cross_border', x.cross_border, 'transfer_basis', x.transfer_basis, 'agreement_ref', x.agreement_ref,
                 'active', x.active, 'updated_at', x.updated_at) ORDER BY x.active DESC, x.name)
        FROM public.processors x WHERE x.tenant_id = a.tenant_id), '[]'::jsonb),
    'breaches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'aware_at', b.aware_at, 'deadline_at', b.deadline_at, 'description', b.description,
                 'affected_count', b.affected_count, 'data_categories', b.data_categories, 'state', b.state, 'not_notifiable_reason', b.not_notifiable_reason,
                 'assessed_at', b.assessed_at, 'concluded_at', b.concluded_at, 'closed_at', b.closed_at, 'created_at', b.created_at,
                 'notices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'recipient_kind', n.recipient_kind, 'recipient', n.recipient,
                     'sent_at', n.sent_at, 'channel', n.channel, 'content_summary', n.content_summary, 'file_name', n.file_name, 'media_type', n.media_type,
                     'size_bytes', n.size_bytes, 'sha256', n.sha256) ORDER BY n.sent_at, n.id)
                   FROM public.breach_notices n WHERE n.tenant_id = b.tenant_id AND n.breach_id = b.id), '[]'::jsonb)) ORDER BY b.aware_at DESC, b.id)
        FROM public.breaches b WHERE b.tenant_id = a.tenant_id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.privacy_overview() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.privacy_overview() TO clinic_app;
