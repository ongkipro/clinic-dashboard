-- T-116 (PR-95, UX-38; R3): K20–K27 report readers. Migration 0130 (slot reserved by Sol on 44a24f48).
-- Function and grant only (no table, no index): the snapshot of this migration equals its predecessor's.
-- Contract: SYSTEM-MAP-DELTA "SQL readers needed" + PANEL2-DECISION (K23 shift by the cash_shift_for invariant; K20 count of issued invoices
-- with sale value > 0; K22 marketing sees MRN + spend only, owner/manager name too; K27 examinations.author_id + clinical_requests.decided_by
-- where decided_as = 'doctor'). Each reader returns the FACTS its src/modules/reporting/reports/calculators.ts function takes (one row per
-- invoice / visit / shift / dispensing / promo usage / survey / examination / request), so the TS calculator is the single definition and
-- the DB test asserts reader-facts → calculator = the same fixture numbers. Ids, branch, local day, instants, integer rupiah, counts only;
-- never a name (except K22 for owner / manager), a clinical field, a payload.
-- Guard: dashboard_actor (0126) — tenant_actor_lock first, the role list per K (07 Dashboards row + Panel 2), branch roles bound to their
-- active branch (another branch not found), tenant-wide roles any branch or consolidated; period ≤ 366 days (subledger_period_ok).

-- ── K3 sale basis shared by K20 / K22 / K23 (the dashboard_kpi k3 rows, 0126:93–110): issued invoice lines at line_total − VAT by the
-- issue's local day and the line's branch; reductions = refunds paid (amount − VAT reversed) by the refund's local day, and cancelled
-- unpaid package remainders (net share) by the close's local day. Internal (no grant). ──
CREATE FUNCTION public.report_sale_facts(p_tenant uuid) RETURNS TABLE (kind text, invoice_id uuid, branch_id uuid, patient_id uuid, day date,
  at timestamptz, issued_by uuid, state text, amount bigint, why text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  -- one row per invoice (issued or void) with its sale value at issue (void → 0: excluded entirely, as K3)
  SELECT 'invoice', i.id, i.branch_id, public.patient_canonical(p_tenant, i.patient_id), public.tax_local_date(p_tenant, i.issued_at, i.branch_id),
         i.issued_at, i.issued_by, i.state,
         CASE WHEN i.state = 'issued' THEN coalesce((SELECT sum(l.line_total - l.vat_amount) FROM public.invoice_lines l
                                                   WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id), 0) ELSE 0 END::bigint, NULL::text
    FROM public.invoices i WHERE i.tenant_id = p_tenant AND i.state IN ('issued','void')
  UNION ALL
  SELECT 'reduction', i.id, l.branch_id, public.patient_canonical(p_tenant, i.patient_id), public.tax_local_date(p_tenant, r.paid_at, l.branch_id),
         r.paid_at, NULL, NULL, (r.amount - r.vat_reversed)::bigint, 'refund'
    FROM public.refunds r JOIN public.invoice_lines l ON l.tenant_id = r.tenant_id AND l.id = r.invoice_line_id
    JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id AND i.state = 'issued'
   WHERE r.tenant_id = p_tenant AND r.state = 'paid'
  UNION ALL
  SELECT 'reduction', i.id, pk.sold_branch_id, public.patient_canonical(p_tenant, i.patient_id), public.tax_local_date(p_tenant, pk.closed_at, pk.sold_branch_id),
         pk.closed_at, NULL, NULL, ((pk.remainder_cancelled * (l.line_total - l.vat_amount)) / l.line_total)::bigint, 'cancelled_unpaid_package'
    FROM public.packages pk JOIN public.invoice_lines l ON l.tenant_id = pk.tenant_id AND l.id = pk.invoice_line_id
    JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id AND i.state = 'issued'
   WHERE pk.tenant_id = p_tenant AND pk.remainder_cancelled > 0 AND l.line_total > 0
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.report_sale_facts(uuid) FROM PUBLIC;--> statement-breakpoint

-- ── K20 Rata-rata transaksi: invoices issued in the period (by the issue's local day) with their sale value, and the period's K3
-- reductions. calculators.k20 counts invoices with sale value > 0 and divides K3 by that count. O A M F AU. ──
CREATE FUNCTION public.report_k20(p_from date, p_to date, p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['owner','admin_pusat','manager','finance','auditor'], p_branch);
BEGIN
  PERFORM public.subledger_period_ok(p_from, p_to);
  RETURN (
    WITH f AS (SELECT * FROM public.report_sale_facts(a.tenant_id) x
                WHERE x.day BETWEEN p_from AND p_to AND (a.branch_id IS NULL OR x.branch_id = a.branch_id))
    SELECT jsonb_build_object('kpi', 'k20', 'from', p_from, 'to', p_to, 'branch_id', a.branch_id, 'as_of', clock_timestamp(),
      'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.invoice_id, 'branch_id', f.branch_id, 'day', f.day, 'state', f.state, 'sale_value', f.amount)
                                             ORDER BY f.day, f.invoice_id) FROM f WHERE f.kind = 'invoice'), '[]'::jsonb),
      'reductions', coalesce((SELECT jsonb_agg(jsonb_build_object('invoice_id', f.invoice_id, 'branch_id', f.branch_id, 'day', f.day, 'amount', f.amount, 'why', f.why)
                                               ORDER BY f.day, f.invoice_id) FROM f WHERE f.kind = 'reduction'), '[]'::jsonb)));
END
$$;--> statement-breakpoint

-- ── K21 Churn at p_as_of: per canonical patient, the last visit (by check-in local day, then branch) in (as_of − 12 months, as_of];
-- SET-22 `tidak_datang` in force at as_of (default 90). calculators.k21 decides active / churned from these facts. O A M F AU MK
-- (07 Dashboards ◐ for marketing is K13/K14 only, but Laporan Pasien (19) is O MK — Panel 2 / owner decision pending, so marketing is NOT
-- admitted here; see the handoff). ──
CREATE FUNCTION public.report_k21(p_as_of date, p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['owner','admin_pusat','manager','finance','auditor'], p_branch);
  v_days integer;
  v_start date;
  v_tz text;
BEGIN
  IF p_as_of IS NULL THEN RAISE EXCEPTION 'ERR_INVALID_INPUT: as_of' USING ERRCODE = '22023'; END IF;
  -- SET-22 in force at the END of the as-of local day (R3 161ff9b9 F3): the last instant before the next local midnight, in the tenant's
  -- day basis (tax_local_date: the scoped branch's timezone, else the tenant's first branch), never the session timezone; a version effective
  -- at that next midnight is the next day's.
  v_tz := coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = a.branch_id),
                   (SELECT b.timezone FROM public.branches b WHERE b.tenant_id = a.tenant_id ORDER BY b.created_at, b.id LIMIT 1), 'Asia/Jakarta');
  v_days := coalesce((public.setting_value_at('SET-22', NULL, ((p_as_of + 1)::timestamp AT TIME ZONE v_tz) - interval '1 microsecond') ->> 'tidak_datang')::integer, 90);
  v_start := (p_as_of - interval '12 months')::date;
  RETURN (
    WITH v AS (SELECT public.patient_canonical(a.tenant_id, x.patient_id) AS cp, x.branch_id, public.tax_local_date(a.tenant_id, x.checked_in_at, x.branch_id) AS day
                 FROM public.visits x WHERE x.tenant_id = a.tenant_id),
         w AS (SELECT DISTINCT ON (v.cp) v.cp, v.branch_id, v.day FROM v WHERE v.day > v_start AND v.day <= p_as_of
                ORDER BY v.cp, v.day DESC, v.branch_id DESC)
    SELECT jsonb_build_object('kpi', 'k21', 'as_of', p_as_of, 'branch_id', a.branch_id, 'dormant_days', v_days, 'read_at', clock_timestamp(),
      'visits', coalesce((SELECT jsonb_agg(jsonb_build_object('patient', w.cp, 'branch_id', w.branch_id, 'day', w.day) ORDER BY w.cp)
                            FROM w WHERE a.branch_id IS NULL OR w.branch_id = a.branch_id), '[]'::jsonb)));
END
$$;--> statement-breakpoint

-- ── K22 Pasien teratas / LTV at p_as_of: per canonical patient, cumulative sale value and reductions up to as_of, per branch; top
-- p_limit (1–100) by total desc, patient id asc. Identity: MRN always; the name only for owner / manager (Panel 2 decision 3). O A M MK.
-- (marketing admitted per Panel 2 decision 3, MRN + spend only.) ──
CREATE FUNCTION public.report_k22(p_as_of date, p_branch uuid DEFAULT NULL, p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['owner','admin_pusat','manager','marketing'], p_branch);
BEGIN
  IF p_as_of IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'ERR_INVALID_INPUT: k22' USING ERRCODE = '22023'; END IF;
  RETURN (
    WITH f AS (SELECT x.patient_id, x.branch_id, CASE WHEN x.kind = 'invoice' THEN x.amount ELSE -x.amount END AS v
                 FROM public.report_sale_facts(a.tenant_id) x
                WHERE x.patient_id IS NOT NULL AND x.day <= p_as_of AND (x.kind = 'reduction' OR x.amount <> 0)
                  AND (a.branch_id IS NULL OR x.branch_id = a.branch_id)),
         t AS (SELECT f.patient_id, sum(f.v)::bigint AS ltv FROM f GROUP BY f.patient_id ORDER BY sum(f.v) DESC, f.patient_id LIMIT p_limit)
    SELECT jsonb_build_object('kpi', 'k22', 'as_of', p_as_of, 'branch_id', a.branch_id, 'read_at', clock_timestamp(),
      'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('patient', t.patient_id, 'mrn', p.mrn,
                                                           'name', CASE WHEN a.role IN ('owner','manager') THEN p.full_name END, 'ltv', t.ltv,
                                                           'by_branch', (SELECT jsonb_agg(jsonb_build_object('branch_id', g.branch_id, 'value', g.s) ORDER BY g.branch_id)
                                                                           FROM (SELECT f.branch_id, sum(f.v)::bigint AS s FROM f WHERE f.patient_id = t.patient_id GROUP BY f.branch_id) g))
                                         ORDER BY t.ltv DESC, t.patient_id)
                         FROM t JOIN public.patients p ON p.tenant_id = a.tenant_id AND p.id = t.patient_id), '[]'::jsonb)));
END
$$;--> statement-breakpoint

-- ── K23 Penjualan dan uang masuk per shift: shifts opened in the period; invoices issued in the period attributed to the shift by the
-- cash_shift_for invariant (same branch and cashier, issued within [opened_at, closed_at]) — unmatched invoices have no shift; payments
-- (not balance, not simulated) and cash refunds paid by their shift_id. calculators.k23 forms the rows and the "tanpa shift" row.
-- O A M F AU (Laporan Operasional is the manager's; owner / finance / auditor read tenant-wide). ──
CREATE FUNCTION public.report_k23(p_from date, p_to date, p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['owner','admin_pusat','manager','finance','auditor'], p_branch);
BEGIN
  PERFORM public.subledger_period_ok(p_from, p_to);
  RETURN (
    WITH sh AS (SELECT s.id, s.branch_id, s.cashier_id, s.opened_at, s.closed_at, public.tax_local_date(a.tenant_id, s.opened_at, s.branch_id) AS day
                  FROM public.cash_shifts s WHERE s.tenant_id = a.tenant_id AND (a.branch_id IS NULL OR s.branch_id = a.branch_id)),
         inv AS (SELECT f.invoice_id, f.branch_id, f.day, f.state, f.amount,
                        (SELECT s.id FROM public.cash_shifts s WHERE s.tenant_id = a.tenant_id AND s.branch_id = f.branch_id AND s.cashier_id = f.issued_by
                            AND f.at >= s.opened_at AND (s.closed_at IS NULL OR f.at <= s.closed_at) ORDER BY s.opened_at DESC LIMIT 1) AS shift_id
                   FROM public.report_sale_facts(a.tenant_id) f
                  WHERE f.kind = 'invoice' AND f.day BETWEEN p_from AND p_to AND (a.branch_id IS NULL OR f.branch_id = a.branch_id)),
         pay AS (SELECT y.branch_id, public.tax_local_date(a.tenant_id, y.received_at, y.branch_id) AS day, y.shift_id, y.amount, y.method, y.is_simulated
                   FROM public.payments y WHERE y.tenant_id = a.tenant_id AND (a.branch_id IS NULL OR y.branch_id = a.branch_id)),
         ref AS (SELECT r.branch_id, public.tax_local_date(a.tenant_id, r.paid_at, r.branch_id) AS day, r.shift_id, (-b.amount)::bigint AS amount
                   FROM public.refunds r JOIN public.balance_entries b ON b.tenant_id = r.tenant_id AND b.id = r.cash_entry_id
                  WHERE r.tenant_id = a.tenant_id AND r.state = 'paid' AND (a.branch_id IS NULL OR r.branch_id = a.branch_id)
                 UNION ALL
                 -- refunded booking DPs, on the K1 basis of dashboard_kpi (0126 k1: − amount by decided_at, the deposit's branch), in the shift
                 -- booking_deposits_shift stamped (a cash refund); any other refund method has no shift → Tanpa shift (R3 161ff9b9 F2)
                 SELECT d.branch_id, public.tax_local_date(a.tenant_id, d.decided_at, d.branch_id), d.shift_id, d.amount
                   FROM public.booking_deposits d
                  WHERE d.tenant_id = a.tenant_id AND d.state = 'refunded' AND (a.branch_id IS NULL OR d.branch_id = a.branch_id))
    SELECT jsonb_build_object('kpi', 'k23', 'from', p_from, 'to', p_to, 'branch_id', a.branch_id, 'as_of', clock_timestamp(),
      -- a shift opened in the period, or an earlier-opened (overnight) shift an in-period fact belongs to (R3 161ff9b9 F1); each once
      'shifts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', sh.id, 'branch_id', sh.branch_id, 'day', sh.day) ORDER BY sh.day, sh.id)
                            FROM sh WHERE sh.day BETWEEN p_from AND p_to
                               OR sh.id IN (SELECT inv.shift_id FROM inv UNION SELECT pay.shift_id FROM pay WHERE pay.day BETWEEN p_from AND p_to
                                            UNION SELECT ref.shift_id FROM ref WHERE ref.day BETWEEN p_from AND p_to)), '[]'::jsonb),
      'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', inv.invoice_id, 'branch_id', inv.branch_id, 'day', inv.day, 'state', inv.state,
                                                               'shift_id', inv.shift_id, 'sale_value', inv.amount) ORDER BY inv.day, inv.invoice_id) FROM inv), '[]'::jsonb),
      'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', pay.branch_id, 'day', pay.day, 'shift_id', pay.shift_id, 'amount', pay.amount,
                                                               'method', pay.method, 'simulated', pay.is_simulated) ORDER BY pay.day, pay.shift_id)
                              FROM pay WHERE pay.day BETWEEN p_from AND p_to), '[]'::jsonb),
      'cash_refunds', coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', ref.branch_id, 'day', ref.day, 'shift_id', ref.shift_id, 'amount', ref.amount)
                                                 ORDER BY ref.day, ref.shift_id) FROM ref WHERE ref.day BETWEEN p_from AND p_to), '[]'::jsonb)));
END
$$;--> statement-breakpoint

-- ── K24 Waktu tunggu apotek: dispensings handed in the period (hand-over local day) with queued_at / handed_at. O A M F AU PH. ──
CREATE FUNCTION public.report_k24(p_from date, p_to date, p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['owner','admin_pusat','manager','finance','auditor','pharmacist'], p_branch);
BEGIN
  PERFORM public.subledger_period_ok(p_from, p_to);
  RETURN (
    WITH d AS (SELECT x.branch_id, x.state, x.queued_at, x.handed_at, public.tax_local_date(a.tenant_id, x.handed_at, x.branch_id) AS hday
                 FROM public.dispensings x WHERE x.tenant_id = a.tenant_id AND x.state = 'handed' AND (a.branch_id IS NULL OR x.branch_id = a.branch_id))
    SELECT jsonb_build_object('kpi', 'k24', 'from', p_from, 'to', p_to, 'branch_id', a.branch_id, 'as_of', clock_timestamp(),
      'dispensings', coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', d.branch_id, 'state', d.state, 'queued_at', d.queued_at, 'handed_at', d.handed_at,
                                                                  'handed_day', d.hday) ORDER BY d.handed_at) FROM d WHERE d.hday BETWEEN p_from AND p_to), '[]'::jsonb)));
END
$$;--> statement-breakpoint

-- ── K25 Performa kode promo: consumed usages in the period (consumption local day, selling branch) with the discount, the line value
-- (line_total − VAT) and the refunded sale value of that line paid in the period. O A M F AU MK CS. ──
CREATE FUNCTION public.report_k25(p_from date, p_to date, p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['owner','admin_pusat','manager','finance','auditor','marketing','central_cs'], p_branch);
BEGIN
  PERFORM public.subledger_period_ok(p_from, p_to);
  RETURN (
    WITH u AS (SELECT x.promo_id, x.version_id, x.branch_id, x.state, x.discount, x.invoice_line_id,
                      public.tax_local_date(a.tenant_id, x.consumed_at, x.branch_id) AS day
                 FROM public.promo_usages x WHERE x.tenant_id = a.tenant_id AND x.state = 'consumed' AND (a.branch_id IS NULL OR x.branch_id = a.branch_id))
    SELECT jsonb_build_object('kpi', 'k25', 'from', p_from, 'to', p_to, 'branch_id', a.branch_id, 'as_of', clock_timestamp(),
      'usages', coalesce((SELECT jsonb_agg(jsonb_build_object('promo', u.promo_id, 'code', c.code, 'version', u.version_id, 'version_no', v.version,
                                                             'branch_id', u.branch_id, 'state', u.state, 'day', u.day, 'discount', u.discount,
                                                             'line_value', (l.line_total - l.vat_amount),
                                                             'refunded_in_period', coalesce((SELECT sum(r.amount - r.vat_reversed) FROM public.refunds r
                                                                WHERE r.tenant_id = a.tenant_id AND r.invoice_line_id = u.invoice_line_id AND r.state = 'paid'
                                                                  AND public.tax_local_date(a.tenant_id, r.paid_at, l.branch_id) BETWEEN p_from AND p_to), 0))
                                         ORDER BY c.code, v.version, u.day)
                           FROM u JOIN public.promo_codes c ON c.tenant_id = a.tenant_id AND c.id = u.promo_id
                           JOIN public.promo_code_versions v ON v.tenant_id = a.tenant_id AND v.id = u.version_id
                           JOIN public.invoice_lines l ON l.tenant_id = a.tenant_id AND l.id = u.invoice_line_id
                          WHERE u.day BETWEEN p_from AND p_to), '[]'::jsonb)));
END
$$;--> statement-breakpoint

-- ── K26 Kepuasan: survey scores recorded in the period (local day, visit branch). O A M F AU MK CS (the survey table's readers). ──
CREATE FUNCTION public.report_k26(p_from date, p_to date, p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['owner','admin_pusat','manager','finance','auditor','marketing','central_cs'], p_branch);
BEGIN
  PERFORM public.subledger_period_ok(p_from, p_to);
  RETURN (
    WITH s AS (SELECT x.branch_id, x.score, public.tax_local_date(a.tenant_id, x.recorded_at, x.branch_id) AS day
                 FROM public.surveys x WHERE x.tenant_id = a.tenant_id AND (a.branch_id IS NULL OR x.branch_id = a.branch_id))
    SELECT jsonb_build_object('kpi', 'k26', 'from', p_from, 'to', p_to, 'branch_id', a.branch_id, 'as_of', clock_timestamp(),
      'surveys', coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', s.branch_id, 'day', s.day, 'score', s.score) ORDER BY s.day)
                             FROM s WHERE s.day BETWEEN p_from AND p_to), '[]'::jsonb)));
END
$$;--> statement-breakpoint

-- ── K27 Aktivitas dokter: examinations by author (signed by the author as doctor, 0071) with state / created / signed instants and the
-- visit's check-in; clinical requests decided by a doctor (decided_as = 'doctor'); the read instant is the 24 h reference. Counts and times
-- only — no SOAP column is read. O A M F AU. ──
CREATE FUNCTION public.report_k27(p_from date, p_to date, p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['owner','admin_pusat','manager','finance','auditor'], p_branch);
  v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.subledger_period_ok(p_from, p_to);
  RETURN (
    WITH e AS (SELECT x.author_id, x.branch_id, x.state, x.created_at, x.signed_at, public.tax_local_date(a.tenant_id, x.signed_at, x.branch_id) AS sday,
                      v.checked_in_at
                 FROM public.examinations x JOIN public.visits v ON v.tenant_id = x.tenant_id AND v.id = x.visit_id
                WHERE x.tenant_id = a.tenant_id AND (a.branch_id IS NULL OR x.branch_id = a.branch_id)
                  AND ((x.state = 'signed' AND public.tax_local_date(a.tenant_id, x.signed_at, x.branch_id) BETWEEN p_from AND p_to)
                       OR (x.state = 'draft' AND x.created_at < v_now - interval '24 hours'))),
         r AS (SELECT x.decided_by, x.branch_id, x.state, public.tax_local_date(a.tenant_id, x.decided_at, x.branch_id) AS dday
                 FROM public.clinical_requests x
                WHERE x.tenant_id = a.tenant_id AND x.decided_as = 'doctor' AND x.state IN ('approved','declined')
                  AND (a.branch_id IS NULL OR x.branch_id = a.branch_id)
                  AND public.tax_local_date(a.tenant_id, x.decided_at, x.branch_id) BETWEEN p_from AND p_to)
    SELECT jsonb_build_object('kpi', 'k27', 'from', p_from, 'to', p_to, 'branch_id', a.branch_id, 'as_of', v_now,
      'examinations', coalesce((SELECT jsonb_agg(jsonb_build_object('doctor', e.author_id, 'branch_id', e.branch_id, 'state', e.state, 'created_at', e.created_at,
                                                                   'signed_at', e.signed_at, 'signed_day', e.sday, 'checked_in_at', e.checked_in_at)
                                                 ORDER BY e.author_id, e.created_at) FROM e), '[]'::jsonb),
      'requests', coalesce((SELECT jsonb_agg(jsonb_build_object('doctor', r.decided_by, 'branch_id', r.branch_id, 'state', r.state, 'decided_day', r.dday)
                                             ORDER BY r.decided_by, r.dday) FROM r), '[]'::jsonb),
      'doctors', coalesce((SELECT jsonb_object_agg(s.id, s.display_name) FROM public.staff s WHERE s.tenant_id = a.tenant_id
                             AND s.id IN (SELECT e.author_id FROM e UNION SELECT r.decided_by FROM r)), '{}'::jsonb)));
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.report_k20(date, date, uuid), public.report_k21(date, uuid), public.report_k22(date, uuid, integer),
  public.report_k23(date, date, uuid), public.report_k24(date, date, uuid), public.report_k25(date, date, uuid), public.report_k26(date, date, uuid),
  public.report_k27(date, date, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.report_k20(date, date, uuid), public.report_k21(date, uuid), public.report_k22(date, uuid, integer),
  public.report_k23(date, date, uuid), public.report_k24(date, date, uuid), public.report_k25(date, date, uuid), public.report_k26(date, date, uuid),
  public.report_k27(date, date, uuid) TO clinic_app;
