-- T-010 (TD-50): backstop validator for domain event payloads, used by the
-- domain_events CHECK. Keys are lower-case codes; scalars are UUIDs, lower-case codes or
-- booleans; no numbers (amounts), nulls or free text (names, phones, clinical content).
CREATE FUNCTION public.events_payload_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  WITH RECURSIVE walk(v, k) AS (
    SELECT p, NULL::text
    UNION ALL
    SELECT c.v, c.k FROM walk w
      CROSS JOIN LATERAL (
        SELECT e.value AS v, e.key AS k
          FROM jsonb_each(CASE WHEN jsonb_typeof(w.v) = 'object' THEN w.v ELSE '{}'::jsonb END) e
        UNION ALL
        SELECT a.value, NULL
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.v) = 'array' THEN w.v ELSE '[]'::jsonb END) a
      ) c
  )
  SELECT coalesce(bool_and(
    (k IS NULL OR k ~ '^[a-z][a-z0-9_]{0,30}$')
    AND CASE jsonb_typeof(v)
      WHEN 'object' THEN true
      WHEN 'array' THEN true
      WHEN 'boolean' THEN true
      WHEN 'string' THEN (v #>> '{}') ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z][a-z0-9_]{0,40})$'
      ELSE false END), true)
  FROM walk
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.events_payload_ok(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.events_payload_ok(jsonb) TO clinic_app;
