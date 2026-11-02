-- T-010 (DATA-59, TD-50, TEN-5). domain_events and event_receipts are tenant-ledger;
-- event_consumers is a platform registry.
-- domain_events: producers insert inside their own tenant context, attributed from the
-- bound context; nobody updates or deletes (trigger). Only a service context (tenant
-- bound, no staff: workers and posting) reads events; staff sessions never read the
-- event stream (tenant-ledger: posting service only).
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY domain_events_read ON public.domain_events FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_staff_id() IS NULL);--> statement-breakpoint
CREATE POLICY domain_events_insert ON public.domain_events FOR INSERT TO clinic_app
  WITH CHECK (tenant_id = public.app_tenant_id()
              AND staff_id IS NOT DISTINCT FROM public.app_staff_id()
              AND acting_role IS NOT DISTINCT FROM public.app_acting_role()
              AND (branch_id IS NULL OR public.app_branch_allowed(branch_id)));--> statement-breakpoint
GRANT SELECT, INSERT ON public.domain_events TO clinic_app;--> statement-breakpoint
CREATE FUNCTION public.domain_events_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'domain_events is append-only' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
CREATE TRIGGER domain_events_no_update BEFORE UPDATE OR DELETE ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
CREATE TRIGGER domain_events_no_truncate BEFORE TRUNCATE ON public.domain_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Consumers register in a migration of their own task (platform registry, no app access).
ALTER TABLE public.event_consumers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Fan-out: inserting an event creates one open receipt per subscribed consumer in the
-- same transaction, so receipts become visible exactly with their event (no cursor over
-- the event history, no late-commit gaps). The trigger function is not executable by
-- anyone directly (triggers fire regardless of EXECUTE).
CREATE FUNCTION public.domain_events_fan_out() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.event_receipts (tenant_id, consumer, event_id)
  SELECT NEW.tenant_id, c.name, NEW.id
    FROM public.event_consumers c
   WHERE NEW.type = ANY (c.event_types) OR '*' = ANY (c.event_types);
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.domain_events_fan_out() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER domain_events_fan_out AFTER INSERT ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.domain_events_fan_out();--> statement-breakpoint

-- event_receipts: created by the fan-out, leased by events_claim(), completed by the
-- consumer inside the event's tenant service context, in the same transaction as its
-- effects.
ALTER TABLE public.event_receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY event_receipts_read ON public.event_receipts FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_staff_id() IS NULL);--> statement-breakpoint
CREATE POLICY event_receipts_complete ON public.event_receipts FOR UPDATE TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.app_staff_id() IS NULL AND done_at IS NULL)
  WITH CHECK (tenant_id = public.app_tenant_id() AND done_at IS NOT NULL);--> statement-breakpoint
GRANT SELECT ON public.event_receipts TO clinic_app;--> statement-breakpoint
GRANT UPDATE (done_at) ON public.event_receipts TO clinic_app;--> statement-breakpoint

-- TEN-5 claim, across tenants, returning ids only. Only on an unbound connection (no
-- tenant, no staff: the worker, never a request), only for a registered consumer. Scans
-- open receipts only (partial index), skips rows another claim holds (SKIP LOCKED),
-- live leases and dead letters (attempts reached the consumer's max_attempts).
CREATE FUNCTION public.events_claim(p_consumer text, p_worker text, p_limit integer, p_lease_seconds integer)
RETURNS TABLE (event_id uuid, tenant_id uuid, branch_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_max integer;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'events_claim runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  IF p_worker !~ '^[A-Za-z0-9_.:-]{1,80}$' OR p_limit NOT BETWEEN 1 AND 500 OR p_lease_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid claim arguments' USING ERRCODE = '22023';
  END IF;
  SELECT max_attempts INTO v_max FROM public.event_consumers WHERE name = p_consumer;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown consumer' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT r.id FROM public.event_receipts r
     WHERE r.consumer = p_consumer AND r.done_at IS NULL
       AND r.lease_until <= clock_timestamp() AND r.attempts < v_max
     ORDER BY r.event_id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ),
  leased AS (
    UPDATE public.event_receipts r
       SET claimed_by = p_worker, attempts = r.attempts + 1,
           lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
      FROM picked
     WHERE r.id = picked.id
    RETURNING r.event_id, r.tenant_id
  )
  SELECT l.event_id, l.tenant_id, e.branch_id
    FROM leased l JOIN public.domain_events e ON e.id = l.event_id AND e.tenant_id = l.tenant_id
   ORDER BY l.event_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.events_claim(text, text, integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.events_claim(text, text, integer, integer) TO clinic_app;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.domain_events', 'tenant-ledger', 'events', '{}', 'producers in the fact transaction (src/modules/events)', 'branch of the fact'),
  ('public.event_receipts', 'tenant-ledger', 'events', '{}', 'fan-out trigger; outbox worker (src/workers/outbox.ts)', 'none'),
  ('public.event_consumers', 'platform', 'events', '{}', 'migrations of consumer tasks', 'none');
