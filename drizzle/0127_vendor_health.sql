-- T-118 (UX-45, PR-62, OBS-2–OBS-4; Panel 2 D1 = Option A): Konsol Vendor › Kesehatan Platform reader. Function + grant only — no table,
-- no index, no schema change (snapshot 0127 = 0126). Output = exactly the keys src/app/vendor/kesehatan/model.ts projectHealth reads:
-- counts, ages (seconds), instants, sanitised codes (outbox: dead_letter = exhausted receipts now; its 24-hour failures unmeasured). Never: patient_id, contact_wa_id, payload, template_id, provider_message_id, order_ref,
-- amount, body_fingerprint, raw_payload_enc, remote_id, error_path, phone_number_id. One clock read (HYG-016). Authority re-check before
-- the exit after the guard (HYG-008b). Guard: platform_owner + support, 12-hour second factor (read-only, as console_staff_list).
-- lazy: full scans of the time-windowed tables at pilot scale (no (started_at) / (received_at) index); add indexes if the read exceeds 200 ms.
-- WAL archive: pg_stat_archiver is readable by every role on PostgreSQL 16 (verified locally with a NOLOGIN non-superuser role); the
-- figures are reported only while archive_mode is on, else wal_readable = false (no archiver → "Belum terpantau", never a fake time).

-- A code shown to the vendor: the strict pattern, else 'lainnya' (model.ts safeCode mirrors it).
CREATE FUNCTION public.vendor_health_code(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p ~ '^[A-Za-z][A-Za-z0-9_.]{1,48}$' THEN p ELSE 'lainnya' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_health_code(text) FROM PUBLIC;--> statement-breakpoint

-- Top 5 codes of a set of (code) rows as [{code, count}] (merged after sanitising).
CREATE FUNCTION public.vendor_health_codes(p_codes text[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', c, 'count', n) ORDER BY n DESC, c), '[]'::jsonb)
    FROM (SELECT public.vendor_health_code(x) c, count(*)::int n FROM unnest(p_codes) x WHERE x IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5) q
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_health_codes(text[]) FROM PUBLIC;--> statement-breakpoint

-- WhatsApp outbound aggregate for one tenant at a given instant (internal: granted to nobody; the reader passes its one clock read, so a
-- test can evaluate it at a fixed instant — the p_now pattern of outbound_budget_limit / inbox_next_assignee). r2 (review 1d2a370d #1):
-- "due" is outbound_claim's rule (0115): planned_for <= today in the message's branch timezone (tenant-qualified lookup), Asia/Jakarta when
-- the message has no branch — one predicate for the open count and the oldest age. The age is backlog age (since created_at), not the
-- time since it became due.
CREATE FUNCTION public.vendor_health_whatsapp(p_tenant uuid, p_now timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
SELECT jsonb_build_object(
            'open', count(*) FILTER (WHERE d.due),
            'oldest_seconds', floor(extract(epoch FROM p_now - min(o.created_at) FILTER (WHERE d.due)))::int,
            'failed_1h', count(*) FILTER (WHERE o.state = 'failed' AND o.decided_at > p_now - interval '1 hour'),
            'failed_24h', count(*) FILTER (WHERE o.state = 'failed' AND o.decided_at > p_now - interval '24 hours'),
            'attempts_1h', count(*) FILTER (WHERE o.claimed_at > p_now - interval '1 hour'),
            'codes', public.vendor_health_codes(array_agg(coalesce(o.error_code, o.deferred_reason)) FILTER (WHERE (o.state = 'failed' AND o.decided_at > p_now - interval '24 hours') OR (o.state = 'queued' AND o.deferred_reason IS NOT NULL))),
            'last_activity', max(o.claimed_at))
          FROM public.outbound_messages o
          CROSS JOIN LATERAL (SELECT o.state = 'queued' AND o.planned_for <= (p_now AT TIME ZONE coalesce(
                     (SELECT b.timezone FROM public.branches b WHERE b.tenant_id = o.tenant_id AND b.id = o.branch_id), 'Asia/Jakarta'))::date AS due) d
         WHERE o.tenant_id = p_tenant
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_health_whatsapp(uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.vendor_console_health(p_token text, p_ip text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
  g record;
  v_now timestamptz;
  v_roles text[] := ARRAY['platform_owner','support'];
  v_wal_on boolean;
  v_wal_at timestamptz;
  v_wal_failed timestamptz;
  r jsonb;
BEGIN
  SELECT * INTO v FROM public.vendor_session(p_token);
  IF v.account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', 'no_session'); -- not logged (as every console reader)
  END IF;
  -- read-only page: the 12-hour second factor (as console_staff_list), not the 10-minute writer step-up
  SELECT * INTO g FROM public.vendor_guard(v.account_id, p_ip, v_roles, 'health_read', NULL, NULL, v.second_factor_at, interval '12 hours');
  IF g.refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ERR_FORBIDDEN', 'reason', g.refusal); -- vendor_guard logged the denial
  END IF;
  v_now := clock_timestamp();
  -- pg_stat_archiver (readable by every role on PostgreSQL 16); the times count only while archive_mode is on (off in tests and locally).
  v_wal_on := current_setting('archive_mode') IN ('on', 'always');
  SELECT a.last_archived_time, a.last_failed_time INTO v_wal_at, v_wal_failed FROM pg_catalog.pg_stat_archiver a;
  r := jsonb_build_object('ok', true, 'at', v_now,
    'tenants', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', tn.legal_name, 'state', t.lifecycle_state, 'providers', jsonb_build_object(
        'outbox', (SELECT jsonb_build_object(
            'open', count(*) FILTER (WHERE er.done_at IS NULL),
            'oldest_seconds', floor(extract(epoch FROM v_now - min(de.occurred_at) FILTER (WHERE er.done_at IS NULL)))::int,
            -- r2 (review 1d2a370d #2): exhausted receipts are a CURRENT dead-letter stock; the receipts record no failure time, so the
            -- outbox's 1-hour and 24-hour failure counts are not measured (null) — never the stock, never dated by occurred_at.
            'dead_letter', count(*) FILTER (WHERE er.done_at IS NULL AND er.attempts >= ec.max_attempts),
            'failed_24h', NULL, 'failed_1h', NULL, 'attempts_1h', NULL,
            'codes', public.vendor_health_codes(array_agg(er.consumer) FILTER (WHERE er.done_at IS NULL AND er.attempts >= ec.max_attempts)),
            'last_activity', NULL)
          FROM public.event_receipts er JOIN public.domain_events de ON de.tenant_id = er.tenant_id AND de.id = er.event_id
          JOIN public.event_consumers ec ON ec.name = er.consumer WHERE er.tenant_id = t.id),
        'whatsapp', public.vendor_health_whatsapp(t.id, v_now),
        'satusehat', (SELECT jsonb_build_object(
            'open', (SELECT count(*) FROM public.satusehat_outbox x WHERE x.tenant_id = t.id AND x.state IN ('queued','held','leased')),
            'oldest_seconds', (SELECT floor(extract(epoch FROM v_now - min(x.created_at)))::int FROM public.satusehat_outbox x WHERE x.tenant_id = t.id AND x.state = 'queued'),
            'failed_1h', count(*) FILTER (WHERE a.started_at > v_now - interval '1 hour' AND a.outcome IS NOT NULL AND a.outcome <> 'ok'),
            'attempts_1h', count(*) FILTER (WHERE a.started_at > v_now - interval '1 hour' AND a.outcome IS NOT NULL),
            'failed_24h', count(*) FILTER (WHERE a.started_at > v_now - interval '24 hours' AND a.outcome IS NOT NULL AND a.outcome <> 'ok'),
            'codes', public.vendor_health_codes(array_agg(coalesce(a.error_code, a.outcome)) FILTER (WHERE a.started_at > v_now - interval '24 hours' AND a.outcome IS NOT NULL AND a.outcome <> 'ok')
                       || coalesce((SELECT array_agg(x.hold_reason) FROM public.satusehat_outbox x WHERE x.tenant_id = t.id AND x.state = 'held'), '{}')),
            'last_activity', max(a.started_at))
          FROM public.satusehat_attempts a WHERE a.tenant_id = t.id),
        'payment_webhook', (SELECT jsonb_build_object(
            'open', NULL, 'oldest_seconds', NULL, 'attempts_1h', NULL,
            'failed_1h', count(*) FILTER (WHERE w.received_at > v_now - interval '1 hour' AND (w.outcome LIKE 'rejected_%' OR w.outcome LIKE 'dropped_%')),
            'failed_24h', count(*) FILTER (WHERE w.received_at > v_now - interval '24 hours' AND (w.outcome LIKE 'rejected_%' OR w.outcome LIKE 'dropped_%')),
            'codes', public.vendor_health_codes(array_agg(w.outcome) FILTER (WHERE w.received_at > v_now - interval '24 hours' AND w.outcome NOT IN ('received','applied','duplicate'))),
            'last_activity', max(w.received_at))
          FROM public.payment_webhook_events w WHERE w.tenant_id = t.id),
        'meta_webhook', (SELECT jsonb_build_object(
            'open', count(*) FILTER (WHERE m.state IN ('received','held_out_of_order')),
            'oldest_seconds', floor(extract(epoch FROM v_now - min(m.received_at) FILTER (WHERE m.state IN ('received','held_out_of_order'))))::int,
            'failed_1h', count(*) FILTER (WHERE m.received_at > v_now - interval '1 hour' AND m.state = 'rejected_signature'),
            'failed_24h', count(*) FILTER (WHERE m.received_at > v_now - interval '24 hours' AND m.state = 'rejected_signature'),
            'attempts_1h', NULL,
            'codes', public.vendor_health_codes(array_agg(coalesce(m.error_code, m.state)) FILTER (WHERE m.received_at > v_now - interval '24 hours' AND m.state IN ('held_out_of_order','rejected_signature'))),
            'last_activity', max(m.received_at))
          FROM public.meta_webhook_receipts m WHERE m.tenant_id = t.id)
      )) ORDER BY tn.legal_name, t.id)
      FROM public.tenants_registry t LEFT JOIN public.tenants tn ON tn.id = t.id), '[]'::jsonb),
    'platform', jsonb_build_object(
      'unrouted', (SELECT count(*) FROM public.meta_webhook_receipts m WHERE m.tenant_id IS NULL AND m.received_at > v_now - interval '24 hours'),
      'wal_readable', v_wal_on,
      'wal_archived_at', CASE WHEN v_wal_on THEN v_wal_at END,
      'wal_failed_at', CASE WHEN v_wal_on THEN v_wal_failed END),
    -- Option A: no source exists for these (no probe, no worker process, no backup record, no request counter).
    'not_measured', jsonb_build_array('uptime', 'worker_heartbeat', 'backup_age', 'error_rate'));
  PERFORM public.vendor_log(g.staff_id, v.account_id, g.role, 'health_read', NULL, NULL, 'success', 'list', p_ip);
  PERFORM public.vendor_authority_recheck(p_token, p_ip, v_roles, interval '12 hours');
  RETURN r;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vendor_console_health(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.vendor_console_health(text, text) TO clinic_vendor;
