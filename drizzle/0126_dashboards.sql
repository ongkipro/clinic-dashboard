-- T-107 (PR-33, Appendix A, UX-60; R3): dashboard read models. On read only — no table, no stored aggregate, no refresh job (Panel 2
-- decision 2). Numbered 0126 at the DEC-049 rebase onto main c7f29c4e (after 0125_coretax); written as 0123 in the lane.
-- Two granted readers: dashboard_kpi (K1–K18; K4, K12, K14, K15, K17 per Panel 2 PANEL2-DECISIONS-SLICE4.md 2026-11-19) and dashboard_home
-- (the UX-60 role homes). K19 = target_mine / target_list (0103); Ruang Saya = treatment_room_list + appointments_window + target_mine. Payloads carry ids, branch, local day, money and counts only — never clinical content (PR-33).

-- ── guard (internal): the acting role must be in p_roles; the branch view is the active branch for a Level 3 role (a different branch
-- is not found), any branch of the tenant (or NULL = consolidated) for a tenant-wide role ──
CREATE FUNCTION public.dashboard_actor(p_roles text[], p_branch uuid, OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_active uuid;
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, v_active FROM public.tenant_actor_lock() a;
  IF NOT role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read this dashboard' USING ERRCODE = '42501';
  END IF;
  IF role IN ('manager','facility_head','records_officer','fo_cashier','bc','doctor','nurse','therapist','pharmacist') THEN
    IF p_branch IS NOT NULL AND p_branch IS DISTINCT FROM v_active THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
    END IF;
    branch_id := v_active;
  ELSE
    branch_id := p_branch;
  END IF;
  IF branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = dashboard_actor.tenant_id AND b.id = dashboard_actor.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dashboard_actor(text[], uuid) FROM PUBLIC;--> statement-breakpoint

-- ── KPI reader. Fact rows (branch, local day, dim, amount, source record, two optional group keys); `money` rows sum to `total`, the
-- other rows are counts or flags read through by_dim. Each KPI's rows follow its Appendix A row; the dims are the KPI's parts. ──
CREATE FUNCTION public.dashboard_kpi(p_kpi text, p_from date, p_to date, p_branch uuid DEFAULT NULL, p_detail boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  -- 07 "Dashboards": owner, admin pusat, manager (own branch), finance full; auditor read; marketing K13; purchasing and pharmacist K18;
  -- central CS K13 (PR-33e). K5 keeps the sub-ledger readers' roles (owner, finance, auditor).
  v_roles text[] := CASE p_kpi
    WHEN 'k5' THEN ARRAY['owner','finance','auditor']
    WHEN 'k13' THEN ARRAY['owner','admin_pusat','manager','finance','auditor','central_cs','marketing']
    WHEN 'k14' THEN ARRAY['owner','admin_pusat','manager','finance','auditor','central_cs','marketing']
    WHEN 'k18' THEN ARRAY['owner','admin_pusat','manager','finance','auditor','purchasing','pharmacist']
    ELSE ARRAY['owner','admin_pusat','manager','finance','auditor'] END;
  a record;
  t uuid;
  v_now timestamptz := clock_timestamp();
  v_extra jsonb;
BEGIN
  IF p_kpi IS NULL OR p_kpi NOT IN ('k1','k2','k3','k4','k5','k6','k7','k8','k9','k10','k11','k12','k13','k14','k15','k16','k17','k18') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kpi' USING ERRCODE = '22023';
  END IF;
  a := public.dashboard_actor(v_roles, p_branch);
  t := a.tenant_id;
  PERFORM public.subledger_period_ok(p_from, p_to);
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.dash_f (branch_id uuid, day date, dim text, amount bigint, money boolean, source_kind text, source_id uuid,
                                                  grp1 text, grp2 text, refs jsonb) ON COMMIT DROP;
  TRUNCATE pg_temp.dash_f;

  -- K1 Uang masuk: payments received (not simulated, not balance usage) − cash refunds (the cash entry of a paid refund, a refunded DP);
  -- by payment / refund local date, branch where paid
  IF p_kpi = 'k1' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT y.branch_id, public.tax_local_date(t, y.received_at, y.branch_id), y.method, y.amount, true, 'payment', y.id, NULL, NULL
      FROM public.payments y WHERE y.tenant_id = t AND NOT y.is_simulated AND y.method <> 'balance'
    UNION ALL
    SELECT r.branch_id, public.tax_local_date(t, r.paid_at, r.branch_id), 'cash_refund', b.amount, true, 'refund', r.id, NULL, NULL
      FROM public.refunds r JOIN public.balance_entries b ON b.tenant_id = r.tenant_id AND b.id = r.cash_entry_id
     WHERE r.tenant_id = t AND r.state = 'paid'
    UNION ALL
    SELECT d.branch_id, public.tax_local_date(t, d.decided_at, d.branch_id), 'dp_refund', -d.amount, true, 'booking_deposit', d.id, NULL, NULL
      FROM public.booking_deposits d WHERE d.tenant_id = t AND d.state = 'refunded';
  END IF;

  -- K2 Layanan selesai (and the K2 part of K7): the delivered net value the sub-ledger already derives at performance (a counted single
  -- treatment's line, a handed product's line, a charged consultation fee; T-104) + redeemed package sessions at their VAT-exclusive
  -- allocated value (BILL-7), by performance local date, executing branch.
  -- lazy: subledger_movements is computed for the whole tenant per call (as subledger_rollforward does); upgrade to a performance-only
  -- reader if a measured dashboard read is too slow.
  IF p_kpi IN ('k2','k7') THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT m.branch_id, m.day, CASE m.source_kind WHEN 'treatment_execution' THEN 'treatment' WHEN 'dispensing' THEN 'product' ELSE 'consultation' END,
           -m.amount, true, m.source_kind, m.source_id, NULL, NULL
      FROM public.subledger_movements(t) m WHERE m.ledger = 'paid_not_delivered' AND m.term = 'performance'
    UNION ALL
    SELECT s.redeemed_branch_id, public.tax_local_date(t, s.redeemed_at, s.redeemed_branch_id), 'session', s.vat_base, true, 'package_session', s.id, NULL, NULL
      FROM public.package_sessions s WHERE s.tenant_id = t AND s.state = 'redeemed';
  END IF;

  -- K3 Penjualan: lines of issued invoices after discount, excl. VAT (frozen at issue), by issue local date, selling branch; − the cancelled
  -- unpaid package remainder (net share) in the month of the close; − refunded sale value (net of reversed VAT) in the month of the refund.
  -- A voided invoice is excluded entirely.
  IF p_kpi = 'k3' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT l.branch_id, public.tax_local_date(t, i.issued_at, l.branch_id), CASE WHEN pk.id IS NULL THEN 'line' ELSE 'package' END,
           l.line_total - l.vat_amount, true, 'invoice_line', l.id, NULL, NULL
      FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id AND i.state = 'issued'
      LEFT JOIN public.packages pk ON pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id
     WHERE l.tenant_id = t
    UNION ALL
    SELECT pk.sold_branch_id, public.tax_local_date(t, pk.closed_at, pk.sold_branch_id), 'cancelled_remainder',
           -((pk.remainder_cancelled * (l.line_total - l.vat_amount)) / l.line_total), true, 'package', pk.id, NULL, NULL
      FROM public.packages pk JOIN public.invoice_lines l ON l.tenant_id = pk.tenant_id AND l.id = pk.invoice_line_id
      JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id AND i.state = 'issued'
     WHERE pk.tenant_id = t AND pk.remainder_cancelled > 0 AND l.line_total > 0
    UNION ALL
    SELECT l.branch_id, public.tax_local_date(t, r.paid_at, l.branch_id), 'refund', -(r.amount - r.vat_reversed), true, 'refund', r.id, NULL, NULL
      FROM public.refunds r JOIN public.invoice_lines l ON l.tenant_id = r.tenant_id AND l.id = r.invoice_line_id
      JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id AND i.state = 'issued'
     WHERE r.tenant_id = t AND r.state = 'paid';
  END IF;

  -- K4 Piutang at p_to (Panel 2 decision 1 (b)): open patient receivables (amount − collections − write-offs up to p_to), aged from
  -- receivables.created_at; plus the unpaid part of lines on issued invoices of visits closed by p_to, aged from invoices.issued_at.
  -- Unpaid package remainders and in-progress visits are excluded. dim = aging bucket (0-30, 31-60, 61-90, >90 days at p_to); branch of the
  -- invoice / receivable. r3 (review 3ba1bf52 F2; Sol 2026-11-20): every subtraction is a DATED fact up to p_to, so a later fact never
  -- changes an earlier report — real allocations (created_at), applied deposits (decided_at), conversions (the receivable's created_at), and
  -- a cancellation by its writer's dated fact. The only writer of a closed visit line's cancelled_amount (0121 interrupted_to_balance,
  -- addition branch) posts balance_entries 'from_interrupted_treatment' with source = the execution of the line's plan item on this visit;
  -- its created_at dates the cancellation (package_close_do cancels a package line or a substitution difference line, neither a visit line).
  -- A cancelled_amount no dated fact explains is never valued: K4 is then incomplete (no total, no aging; extra.undated_cancellations).
  IF p_kpi = 'k4' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2, refs)
    WITH lc AS (
      SELECT l.id AS line_id, l.cancelled_amount,
             (SELECT min(b.created_at) FROM public.treatment_executions e
                JOIN public.balance_entries b ON b.tenant_id = e.tenant_id AND b.kind = 'from_interrupted_treatment' AND b.source_kind = 'treatment_execution' AND b.source_id = e.id
               WHERE e.tenant_id = l.tenant_id AND e.visit_id = i.visit_id AND e.plan_item_id = l.plan_item_id) AS cancelled_at
        FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
       WHERE l.tenant_id = t AND l.cancelled_amount > 0 AND l.plan_item_id IS NOT NULL AND i.visit_id IS NOT NULL),
    x AS (
      SELECT r.branch_id, public.tax_local_date(t, r.created_at, r.branch_id) AS day, 'receivable'::text AS sk, r.id AS sid,
             r.amount - coalesce((SELECT sum(c.amount) FROM public.receivable_collections c WHERE c.tenant_id = r.tenant_id AND c.receivable_id = r.id
                                    AND public.tax_local_date(t, c.received_at, c.branch_id) <= p_to), 0)
                      - coalesce((SELECT sum(w.amount) FROM public.write_offs w WHERE w.tenant_id = r.tenant_id AND w.receivable_id = r.id
                                    AND public.tax_local_date(t, w.created_at, w.branch_id) <= p_to), 0) AS owed
        FROM public.receivables r WHERE r.tenant_id = t AND public.tax_local_date(t, r.created_at, r.branch_id) <= p_to
      UNION ALL
      SELECT l.branch_id, public.tax_local_date(t, i.issued_at, l.branch_id), CASE WHEN l.cancelled_amount > 0 AND lc.cancelled_at IS NULL THEN 'undated' ELSE 'invoice_line' END, l.id,
             l.line_total
             - CASE WHEN lc.cancelled_at IS NOT NULL AND public.tax_local_date(t, lc.cancelled_at, l.branch_id) <= p_to THEN l.cancelled_amount ELSE 0 END
             - coalesce((SELECT sum(pa.amount) FROM public.payment_allocations pa WHERE pa.tenant_id = l.tenant_id AND pa.invoice_line_id = l.id AND NOT pa.is_simulated
                           AND public.tax_local_date(t, pa.created_at, pa.branch_id) <= p_to), 0)
             - coalesce((SELECT sum(d.amount) FROM public.booking_deposits d WHERE d.tenant_id = l.tenant_id AND d.applied_line_id = l.id AND d.state = 'applied'
                           AND public.tax_local_date(t, d.decided_at, d.branch_id) <= p_to), 0)
             - coalesce((SELECT sum(rl.amount) FROM public.receivable_lines rl JOIN public.receivables r ON r.tenant_id = rl.tenant_id AND r.id = rl.receivable_id
                          WHERE rl.tenant_id = l.tenant_id AND rl.invoice_line_id = l.id AND public.tax_local_date(t, r.created_at, r.branch_id) <= p_to), 0)
        FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id AND i.state = 'issued'
        JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id AND v.closed_at IS NOT NULL
        LEFT JOIN lc ON lc.line_id = l.id
       WHERE l.tenant_id = t AND public.tax_local_date(t, v.closed_at, v.branch_id) <= p_to
         AND NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id))
    SELECT x.branch_id, x.day, CASE WHEN x.sk = 'undated' THEN 'undated' WHEN p_to - x.day <= 30 THEN '0-30' WHEN p_to - x.day <= 60 THEN '31-60' WHEN p_to - x.day <= 90 THEN '61-90' ELSE '>90' END,
           x.owed, true, x.sk, x.sid, NULL, NULL, NULL::jsonb
      FROM x WHERE x.owed > 0 OR x.sk = 'undated';
  END IF;

  -- K5 Kewajiban prabayar at p_to: paid-not-delivered + package liability + patient balance + booking DP, from the T-104 sub-ledger
  -- movements up to p_to (branch view = where the liability arose); expiry slice: the package liability of packages whose validity ends
  -- within 30 days after p_to; `incomplete` rows count movements inside a pre-cutover residue (the roll-forward's completeness rule).
  IF p_kpi = 'k5' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT m.branch_id, m.day, m.ledger, m.amount, true, m.source_kind, m.source_id, m.object_kind, m.object_id::text
      FROM public.subledger_movements(t) m
     WHERE m.ledger IN ('paid_not_delivered','package_liability','patient_balance','booking_dp') AND m.day <= p_to;
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT f.branch_id, f.day, 'packages_expiring_30', f.amount, false, f.source_kind, f.source_id, f.grp1, f.grp2
      FROM pg_temp.dash_f f JOIN public.packages pk ON pk.tenant_id = t AND pk.id = f.grp2::uuid
     WHERE f.dim = 'package_liability' AND f.grp1 = 'package' AND pk.state = 'active'
       AND public.tax_local_date(t, pk.validity_end, pk.sold_branch_id) > p_to AND public.tax_local_date(t, pk.validity_end, pk.sold_branch_id) <= p_to + 30;
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT m.branch_id, m.day, 'incomplete', 1, false, m.source_kind, m.source_id, NULL, NULL
      FROM public.subledger_movements(t) m
     WHERE m.ledger IN ('paid_not_delivered','package_liability','patient_balance','booking_dp') AND m.day <= p_to AND m.incomplete;
  END IF;

  -- K6 Paket kedaluwarsa ke saldo: paid-unused value moved to balance at expiry, by close local date, selling branch
  IF p_kpi = 'k6' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT pk.sold_branch_id, public.tax_local_date(t, pk.closed_at, pk.sold_branch_id), 'expired_to_balance', pk.paid_unused_moved, true, 'package', pk.id, NULL, NULL
      FROM public.packages pk WHERE pk.tenant_id = t AND pk.state = 'expired' AND pk.paid_unused_moved > 0;
  END IF;

  -- K7 Kontribusi = K2 − material cost − product cost (moving-average movement values) − performer commission (entitlements and their
  -- adjustments), executing branch. Flags (counts, not money): `estimasi` = a bulk-estimated consumption line (0079), `uncosted` = a
  -- movement valued without a known cost (A-13: "biaya belum lengkap"), never shown as zero cost.
  IF p_kpi = 'k7' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT m.branch_id, public.tax_local_date(t, m.created_at, m.branch_id), CASE m.kind WHEN 'consume' THEN 'material_cost' ELSE 'product_cost' END,
           v.value, true, 'stock_movement', m.id, NULL, NULL
      FROM public.stock_movements m JOIN public.stock_movement_values v ON v.tenant_id = m.tenant_id AND v.movement_id = m.id
     WHERE m.tenant_id = t AND (m.kind = 'consume' AND m.source_kind = 'material_consumption' OR m.kind = 'dispense' AND m.source_kind = 'dispensing')
    UNION ALL
    SELECT m.branch_id, public.tax_local_date(t, m.created_at, m.branch_id), 'uncosted', 1, false, 'stock_movement', m.id, NULL, NULL
      FROM public.stock_movements m JOIN public.stock_movement_values v ON v.tenant_id = m.tenant_id AND v.movement_id = m.id
     WHERE m.tenant_id = t AND v.uncosted_qty <> 0
       AND (m.kind = 'consume' AND m.source_kind = 'material_consumption' OR m.kind = 'dispense' AND m.source_kind = 'dispensing')
    UNION ALL
    SELECT c.branch_id, public.tax_local_date(t, c.consumed_at, c.branch_id), 'estimasi', 1, false, 'material_consumption_line', x.id, NULL, NULL
      FROM public.material_consumption_lines x JOIN public.material_consumptions c ON c.tenant_id = x.tenant_id AND c.id = x.consumption_id
     WHERE x.tenant_id = t AND x.estimated
    UNION ALL
    SELECT e.branch_id, public.tax_local_date(t, e.accrued_at, e.branch_id), 'performer_commission', -e.amount, true, 'commission_entitlement', e.id, NULL, NULL
      FROM public.commission_entitlements e JOIN public.commission_contributions c ON c.tenant_id = e.tenant_id AND c.id = e.contribution_id
     WHERE e.tenant_id = t AND c.contribution_type = 'performer'
    UNION ALL
    SELECT x.branch_id, public.tax_local_date(t, x.adjusted_at, x.branch_id), 'performer_commission', -x.amount, true, 'commission_adjustment', x.id, NULL, NULL
      FROM public.commission_adjustments x JOIN public.commission_entitlements e ON e.tenant_id = x.tenant_id AND e.id = x.entitlement_id
      JOIN public.commission_contributions c ON c.tenant_id = e.tenant_id AND c.id = e.contribution_id
     WHERE x.tenant_id = t AND c.contribution_type = 'performer';
  END IF;

  -- K8 Konsultasi jadi pembelian: consultation visits (a consultation-fee decision exists) and those waived by a qualifying purchase on
  -- that visit (BILL-4); visit check-in local date, visit branch
  IF p_kpi = 'k8' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT v.branch_id, public.tax_local_date(t, v.checked_in_at, v.branch_id), d.dim, 1, false, 'visit', v.id, NULL, NULL
      FROM public.consultation_fees f JOIN public.visits v ON v.tenant_id = f.tenant_id AND v.id = f.visit_id
      CROSS JOIN LATERAL (SELECT 'consultation' UNION ALL SELECT 'purchase' WHERE f.state = 'waived' AND f.waiver = 'purchase') d(dim)
     WHERE f.tenant_id = t;
  END IF;

  -- K9 Rencana dipilih: plan items recommended (not removed) by recommendation local date, plan item branch; count and value (the branch
  -- price effective at the recommendation, else the version's normal price, × quantity); selected = on a confirmed selection within
  -- 30 / 60 / 90 days
  IF p_kpi = 'k9' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    WITH r AS (
      SELECT p.id, p.branch_id, public.tax_local_date(t, p.created_at, p.branch_id) AS day,
             p.qty * coalesce((SELECT bp.price FROM public.branch_prices bp WHERE bp.tenant_id = p.tenant_id AND bp.branch_id = p.branch_id AND bp.item_id = cv.item_id
                                  AND bp.state = 'active' AND bp.effective_from <= p.created_at ORDER BY bp.effective_from DESC LIMIT 1), cv.normal_price) AS value,
             (SELECT min(public.tax_local_date(t, s.confirmed_at, p.branch_id)) FROM public.selection_items si
                JOIN public.selections s ON s.tenant_id = si.tenant_id AND s.id = si.selection_id AND s.confirmed_at IS NOT NULL
               WHERE si.tenant_id = p.tenant_id AND si.plan_item_id = p.id) AS sel_day
        FROM public.plan_items p JOIN public.catalog_versions cv ON cv.tenant_id = p.tenant_id AND cv.id = p.catalog_version_id
       WHERE p.tenant_id = t AND p.removed_at IS NULL)
    SELECT r.branch_id, r.day, d.dim, d.amount, false, 'plan_item', r.id, NULL, NULL
      FROM r CROSS JOIN LATERAL (
        SELECT 'recommended_count', 1::bigint UNION ALL SELECT 'recommended_value', r.value
        UNION ALL SELECT 'selected_' || w || '_count', 1 FROM unnest(ARRAY[30,60,90]) w WHERE r.sel_day IS NOT NULL AND r.sel_day - r.day <= w
        UNION ALL SELECT 'selected_' || w || '_value', r.value FROM unnest(ARRAY[30,60,90]) w WHERE r.sel_day IS NOT NULL AND r.sel_day - r.day <= w) d(dim, amount);
  END IF;

  -- K10 / K11: visits of the canonical patient (merges followed); the first visit in the tenant is "new". K11: new patients of the period
  -- with a completed (closed) later visit within the SET-22 second-visit window in force at the first visit (D-06), first-visit branch.
  IF p_kpi IN ('k10','k11') THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    WITH v AS (SELECT x.id, x.branch_id, x.checked_in_at, x.closed_at, public.tax_local_date(t, x.checked_in_at, x.branch_id) AS day,
                      public.patient_canonical(t, x.patient_id) AS cp FROM public.visits x WHERE x.tenant_id = t),
         o AS (SELECT v.*, row_number() OVER (PARTITION BY v.cp ORDER BY v.checked_in_at, v.id) AS n FROM v)
    SELECT o.branch_id, o.day, CASE WHEN o.n = 1 THEN 'new' ELSE 'returning' END, 1, false, 'visit', o.id, NULL, NULL FROM o WHERE p_kpi = 'k10'
    UNION ALL
    SELECT o.branch_id, o.day, d.dim, 1, false, 'visit', o.id, NULL, NULL
      FROM o CROSS JOIN LATERAL (
        SELECT 'new' UNION ALL
        SELECT 'second_visit' WHERE EXISTS (
          SELECT 1 FROM o w WHERE w.cp = o.cp AND w.n > 1 AND w.closed_at IS NOT NULL
             AND w.day - o.day <= coalesce((public.setting_value_at('SET-22', NULL, o.checked_in_at) ->> 'kunjungan_kedua')::integer, 60))) d(dim)
     WHERE p_kpi = 'k11' AND o.n = 1;
  END IF;

  -- K12 Tidak datang / batal < 24 jam (Panel 2 decision 2 (b)): appointments by start local date, booking branch. Numerator = no_show + a
  -- cancel less than 24 hours before the start (fixed KPI window, not SET-10). Denominator = the appointments that stayed on the book: not
  -- rescheduled, not cancelled 24 hours or more before the start, not an expired hold (held).
  IF p_kpi = 'k12' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT ap.branch_id, public.tax_local_date(t, ap.starts_at, ap.branch_id), d.dim, 1, false, 'appointment', ap.id, NULL, NULL
      FROM public.appointments ap CROSS JOIN LATERAL (
        SELECT 'booked' UNION ALL
        SELECT 'no_show' WHERE ap.state = 'no_show' UNION ALL
        SELECT 'late_cancel' WHERE ap.state = 'cancelled') d(dim)
     WHERE ap.tenant_id = t AND ap.state NOT IN ('rescheduled','held')
       AND NOT (ap.state = 'cancelled' AND ap.state_changed_at <= ap.starts_at - interval '24 hours');
  END IF;

  -- K14 Respons lead (Panel 2 decision 3 (a)): leads created inside the branch's opening hours (branch_is_open: weekly hours minus
  -- closures), by creation local date, lead branch; minutes to first response. Median and both on-time shares in `extra`: within 15 minutes
  -- (Appendix A literal) and within SET-20 (tenant SLA at creation). A lead without a branch or a response yet is counted as unanswered.
  -- r3 (review 3ba1bf52 F7) / r4 (re-review 3dcdb005 #2): amount = elapsed MICROSECONDS internally (timestamptz precision, lossless), so
  -- the thresholds compare exactly (<= 900 s, <= SET-20 × 60 s) and the median is taken before rounding; the public unit of the K14 amounts
  -- (by_dim / by_branch / rows) stays SECONDS (fraction kept), converted once at serialization; minutes only for display.
  IF p_kpi = 'k14' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT l.branch_id, public.tax_local_date(t, l.created_at, l.branch_id), CASE WHEN l.first_response_at IS NULL THEN 'unanswered' ELSE 'answered' END,
           CASE WHEN l.first_response_at IS NULL THEN NULL ELSE (extract(epoch FROM l.first_response_at - l.created_at) * 1000000)::bigint END, false, 'lead', l.id,
           coalesce((public.setting_value_at('SET-20', NULL, l.created_at))::text, '15'), NULL
      FROM public.leads l WHERE l.tenant_id = t AND l.branch_id IS NOT NULL AND public.branch_is_open(l.branch_id, l.created_at);
  END IF;

  -- K15 Utilisasi performer (Panel 2 decision 4 (b)): per performer and branch-local day, the union of booked intervals (appointments not
  -- cancelled, rescheduled, no-show or an expired hold) and executed intervals (finished counted executions), clipped to the day, ÷ rostered
  -- work minutes less breaks, leave dates excluded (target_scorecard's roster rule, 0103). Rows: dim `covered` / `rostered` minutes, grp1 =
  -- performer staff id. lazy: interval union in SQL per performer-day; a range_agg (PG14+) rewrite if it shows up in a measured read.
  -- r3 (review 3ba1bf52 F4/F6) / r4 (re-review 3dcdb005 #1): the roster is the branch's PERFORMERS only — a staff member for whom
  -- booking_eligible (0061: a role row without a named `assists` demotion, or a named performs / supervised row within the delegation
  -- floor) holds for at least one service version IN EFFECT on the shift's local date (from its activation, coalesce(decided_at,
  -- created_at), until the next active version's) of an item the branch offers (branch_services, the booking rule's offer; it keeps
  -- no history, so today's offer — lazy: a dated offer table if branch menus start changing mid-period). Idle eligible staff count; a
  -- staff member who only assists, a cashier or a manager is not performer capacity. Each row keeps its normalized minutes once;
  -- the contributing appointments / executions / shifts ride along as non-additive `refs` metadata.
  IF p_kpi = 'k15' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2, refs)
    WITH perf AS (
      SELECT DISTINCT s.branch_id, s.staff_id, s.shift_date FROM public.staff_shifts s
        JOIN public.branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
       WHERE s.tenant_id = t AND s.shift_date BETWEEN p_from AND p_to
         AND EXISTS (SELECT 1 FROM public.branch_services bs
                       JOIN public.catalog_items i ON i.tenant_id = bs.tenant_id AND i.id = bs.item_id AND i.kind = 'service'
                       JOIN public.catalog_versions v ON v.tenant_id = bs.tenant_id AND v.item_id = bs.item_id AND v.state IN ('active','superseded')
                      WHERE bs.tenant_id = t AND bs.branch_id = s.branch_id
                        AND coalesce(v.decided_at, v.created_at) < ((s.shift_date + 1)::timestamp AT TIME ZONE b.timezone)
                        AND NOT EXISTS (SELECT 1 FROM public.catalog_versions nx
                                         WHERE nx.tenant_id = v.tenant_id AND nx.item_id = v.item_id AND nx.version > v.version AND nx.state IN ('active','superseded')
                                           AND coalesce(nx.decided_at, nx.created_at) <= (s.shift_date::timestamp AT TIME ZONE b.timezone))
                        AND public.booking_eligible(t, s.branch_id, v.id, v.category, s.staff_id))),
    iv AS (
      SELECT ap.branch_id, ap.performer_staff_id AS staff, ap.starts_at AS s, ap.ends_at AS e, 'appointment'::text AS sk, ap.id AS sid
        FROM public.appointments ap WHERE ap.tenant_id = t AND ap.state IN ('booked','confirmed','arrived')
      UNION ALL
      SELECT e.branch_id, e.performer_staff_id, e.started_at, e.finished_at, 'treatment_execution', e.id
        FROM public.treatment_executions e WHERE e.tenant_id = t AND e.state = 'finished' AND e.counted AND e.finished_at > e.started_at),
    dd AS (
      SELECT iv.branch_id, iv.staff, iv.sk, iv.sid, d::date AS day,
             greatest(iv.s, (d::date)::timestamp AT TIME ZONE b.timezone) AS s,
             least(iv.e, ((d::date) + 1)::timestamp AT TIME ZONE b.timezone) AS e
        FROM iv JOIN public.branches b ON b.tenant_id = t AND b.id = iv.branch_id
        CROSS JOIN LATERAL generate_series((iv.s AT TIME ZONE b.timezone)::date, ((iv.e - interval '1 microsecond') AT TIME ZONE b.timezone)::date, interval '1 day') d
       WHERE (iv.s AT TIME ZONE b.timezone)::date <= p_to AND ((iv.e - interval '1 microsecond') AT TIME ZONE b.timezone)::date >= p_from),
    ord AS (SELECT dd.*, max(dd.e) OVER (PARTITION BY dd.branch_id, dd.staff, dd.day ORDER BY dd.s, dd.e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_e FROM dd),
    grp AS (SELECT ord.*, sum(CASE WHEN ord.prev_e IS NULL OR ord.s > ord.prev_e THEN 1 ELSE 0 END)
                            OVER (PARTITION BY ord.branch_id, ord.staff, ord.day ORDER BY ord.s, ord.e ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS g FROM ord),
    merged AS (SELECT grp.branch_id, grp.staff, grp.day, min(grp.s) AS s, max(grp.e) AS e FROM grp GROUP BY grp.branch_id, grp.staff, grp.day, grp.g)
    SELECT m.branch_id, m.day, 'covered', (sum(extract(epoch FROM m.e - m.s)) / 60)::bigint, false, 'performer_day', NULL::uuid, m.staff::text, NULL::text,
           (SELECT jsonb_agg(DISTINCT jsonb_build_object('source_kind', d.sk, 'source_id', d.sid)) FROM dd d
             WHERE d.branch_id = m.branch_id AND d.staff = m.staff AND d.day = m.day)
      FROM merged m GROUP BY m.branch_id, m.day, m.staff
    UNION ALL
    SELECT s.branch_id, s.shift_date, 'rostered',
           sum(CASE WHEN s.kind = 'work' THEN 1 ELSE -1 END
               * (extract(epoch FROM public.roster_instant(s.shift_date, s.ends, b.timezone) - public.roster_instant(s.shift_date, s.starts, b.timezone)))::bigint / 60)::bigint,
           false, 'performer_day', NULL::uuid, s.staff_id::text, NULL::text,
           jsonb_agg(jsonb_build_object('source_kind', 'staff_shift', 'source_id', s.id) ORDER BY s.starts, s.id)
      FROM public.staff_shifts s JOIN public.branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
      JOIN perf ON perf.branch_id = s.branch_id AND perf.staff_id = s.staff_id AND perf.shift_date = s.shift_date
     WHERE s.tenant_id = t
       AND NOT EXISTS (SELECT 1 FROM public.staff_leave lv WHERE lv.tenant_id = s.tenant_id AND lv.staff_id = s.staff_id AND lv.cancelled_at IS NULL
                         AND s.shift_date BETWEEN lv.from_date AND lv.to_date)
     GROUP BY s.branch_id, s.shift_date, s.staff_id;
  END IF;

  -- K13 Konversi lead: leads by creation local date, lead branch; stages reached (booked, arrived, paid = converted); group 1 = source,
  -- group 2 = assignee staff id
  IF p_kpi = 'k13' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT l.branch_id, public.tax_local_date(t, l.created_at, l.branch_id), d.dim, 1, false, 'lead', l.id, l.source, l.assignee_staff_id::text
      FROM public.leads l CROSS JOIN LATERAL (
        SELECT 'lead' UNION ALL SELECT 'booked' WHERE l.booked_at IS NOT NULL UNION ALL SELECT 'arrived' WHERE l.arrived_at IS NOT NULL
        UNION ALL SELECT 'paid' WHERE l.converted_at IS NOT NULL) d(dim)
     WHERE l.tenant_id = t;
  END IF;

  -- K16 Lampiran produk: visits with a finished counted treatment, and those with a product line on an issued invoice of the visit
  IF p_kpi = 'k16' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT v.branch_id, public.tax_local_date(t, v.checked_in_at, v.branch_id), d.dim, 1, false, 'visit', v.id, NULL, NULL
      FROM public.visits v CROSS JOIN LATERAL (
        SELECT 'treatment_visit' UNION ALL
        SELECT 'with_product' WHERE EXISTS (
          SELECT 1 FROM public.invoices i JOIN public.invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
            JOIN public.catalog_items ci ON ci.tenant_id = l.tenant_id AND ci.id = l.item_id
           WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued' AND ci.kind = 'product')) d(dim)
     WHERE v.tenant_id = t AND EXISTS (SELECT 1 FROM public.treatment_executions e WHERE e.tenant_id = v.tenant_id AND e.visit_id = v.id
                                         AND e.state = 'finished' AND e.counted);
  END IF;

  -- K17 Komisi terutang (Panel 2 decision 5 (a); r3 review 3ba1bf52 F3, Sol 2026-11-20): owed at p_to from DATED movements, the
  -- commission_payable roll-forward (0121): entitlements (accrued_at) + adjustments (adjusted_at) + the net actually paid, signed negative,
  -- dated payout_batches.paid_at (payout_batch_lines.net_payable — carry-forward and staff receivables already inside the batch line, never
  -- subtracted again). dims accrued / adjusted / paid_net are money and sum to the owed total. The batches' CURRENT workflow state is not
  -- history (a rejection deletes a batch's items, 0102), so it is reported apart in extra.current_workflow (gross rupiah as of now,
  -- informational, never part of owed). grp1 = staff id, grp2 = contribution type (paid_net: '-', a batch line has none).
  IF p_kpi = 'k17' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2, refs)
    SELECT e.branch_id, public.tax_local_date(t, e.accrued_at, e.branch_id), 'accrued', e.amount, true, 'commission_entitlement', e.id, e.staff_id::text, c.contribution_type, NULL::jsonb
      FROM public.commission_entitlements e JOIN public.commission_contributions c ON c.tenant_id = e.tenant_id AND c.id = e.contribution_id
     WHERE e.tenant_id = t AND e.amount <> 0
    UNION ALL
    SELECT ad.branch_id, public.tax_local_date(t, ad.adjusted_at, ad.branch_id), 'adjusted', ad.amount, true, 'commission_adjustment', ad.id, ad.staff_id::text, c.contribution_type, NULL
      FROM public.commission_adjustments ad JOIN public.commission_entitlements e ON e.tenant_id = ad.tenant_id AND e.id = ad.entitlement_id
      JOIN public.commission_contributions c ON c.tenant_id = e.tenant_id AND c.id = e.contribution_id
     WHERE ad.tenant_id = t AND ad.amount <> 0
    UNION ALL
    SELECT NULL::uuid, public.tax_local_date(t, pb.paid_at, NULL), 'paid_net', -l.net_payable, true, 'payout_batch', pb.id, l.staff_id::text, NULL, NULL
      FROM public.payout_batches pb JOIN public.payout_batch_lines l ON l.tenant_id = pb.tenant_id AND l.batch_id = pb.id
     WHERE pb.tenant_id = t AND pb.state = 'paid' AND l.net_payable > 0;
  END IF;

  -- K18 Risiko stok: now (dated p_to) — items whose fit quantity is below the branch minimum; fit batches expiring within the branch's
  -- SET-27 warning days; and, in the period, count lines with a variance on applied counts (by close local date)
  IF p_kpi = 'k18' THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT l.branch_id, p_to, 'below_min', 1, false, 'stock_item', l.item_id, NULL, NULL
      FROM public.stock_levels l
     WHERE l.tenant_id = t AND l.min_qty IS NOT NULL
       AND coalesce((SELECT sum(public.stock_fit_qty(b, v_now)) FROM public.stock_batches b
                      WHERE b.tenant_id = l.tenant_id AND b.branch_id = l.branch_id AND b.item_id = l.item_id), 0) < l.min_qty
    UNION ALL
    SELECT b.branch_id, p_to, 'expiring', 1, false, 'stock_batch', b.id, NULL, NULL
      FROM public.stock_batches b
     WHERE b.tenant_id = t AND b.quantity > 0 AND public.stock_unfit_reason(b, v_now) IS NULL
       AND b.expiry <= public.stock_local_date(t, b.branch_id, v_now)
                       + coalesce((public.setting_value_at('SET-27', b.branch_id, v_now) ->> 'kedaluwarsa')::integer, 30)
    UNION ALL
    SELECT x.branch_id, public.tax_local_date(t, c.closed_at, c.branch_id), 'variance', 1, false, 'stock_count_line', x.id, NULL, NULL
      FROM public.stock_count_lines x JOIN public.stock_counts c ON c.tenant_id = x.tenant_id AND c.id = x.count_id
     WHERE x.tenant_id = t AND c.state = 'applied' AND x.counted_qty IS NOT NULL AND x.counted_qty <> x.system_qty;
  END IF;

  -- the period (K4, K5 and K17 rows are a stock at p_to; K18's current rows are dated p_to) and the branch view
  IF p_kpi = 'k17' THEN  -- earned in the period: gross + adjustments with their date inside it (target_scorecard's commission_net)
    v_extra := jsonb_build_object('earned_net', (SELECT coalesce(sum(f.amount), 0)::bigint FROM pg_temp.dash_f f WHERE f.day BETWEEN p_from AND p_to
                                                   AND f.dim IN ('accrued','adjusted') AND (a.branch_id IS NULL OR f.branch_id = a.branch_id)),
      -- informational: gross rupiah of the entitlements / adjustments up to p_to by their batch's state NOW (not history; not owed)
      'current_workflow', (SELECT jsonb_build_object('as_of', v_now,
          'accrued', coalesce(sum(f.amount) FILTER (WHERE w.state IS NULL OR w.state = 'draft'), 0)::bigint,
          'pending_approval', coalesce(sum(f.amount) FILTER (WHERE w.state = 'pending_approval'), 0)::bigint,
          'approved', coalesce(sum(f.amount) FILTER (WHERE w.state = 'approved'), 0)::bigint,
          'paid', coalesce(sum(f.amount) FILTER (WHERE w.state = 'paid'), 0)::bigint)
        FROM pg_temp.dash_f f
        LEFT JOIN LATERAL (SELECT b.state FROM public.payout_batch_items bi JOIN public.payout_batches b ON b.tenant_id = bi.tenant_id AND b.id = bi.batch_id
                            WHERE bi.tenant_id = t AND (f.dim = 'accrued' AND bi.entitlement_id = f.source_id OR f.dim = 'adjusted' AND bi.adjustment_id = f.source_id)) w ON true
       WHERE f.dim IN ('accrued','adjusted') AND f.day <= p_to AND (a.branch_id IS NULL OR f.branch_id = a.branch_id)));
  END IF;
  DELETE FROM pg_temp.dash_f f WHERE NOT (f.day BETWEEN p_from AND p_to OR p_kpi IN ('k4','k5','k17') AND f.day <= p_to)
                                  OR a.branch_id IS NOT NULL AND f.branch_id IS DISTINCT FROM a.branch_id;
  IF p_kpi = 'k14' THEN
    v_extra := (SELECT jsonb_build_object('leads', count(*), 'answered', count(f.amount),
                  'median_minutes', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY f.amount) FILTER (WHERE f.amount IS NOT NULL) / 60000000.0)::numeric, 1),
                  'within_15m', count(*) FILTER (WHERE f.amount <= 900000000), 'within_sla', count(*) FILTER (WHERE f.amount <= f.grp1::bigint * 60000000),
                  'sla_minutes', (public.setting_value_at('SET-20', NULL, v_now))::integer)
                  FROM pg_temp.dash_f f)
              -- r4 (#3): within_sla is per lead against the SET-20 in effect at its entry; sla_mix says which thresholds the count mixes
              -- (sla_minutes is today's setting only, never the label of the historical count)
              || jsonb_build_object('sla_mix', coalesce((SELECT jsonb_agg(jsonb_build_object('minutes', x.m, 'leads', x.n, 'within', x.w) ORDER BY x.m) FROM (
                   SELECT f.grp1::integer m, count(*) n, count(*) FILTER (WHERE f.amount <= f.grp1::bigint * 60000000) w FROM pg_temp.dash_f f GROUP BY 1) x), '[]'::jsonb));
  ELSIF p_kpi = 'k15' THEN
    v_extra := (SELECT jsonb_build_object('covered_minutes', coalesce(sum(f.amount) FILTER (WHERE f.dim = 'covered'), 0)::bigint,
                  'rostered_minutes', coalesce(sum(f.amount) FILTER (WHERE f.dim = 'rostered'), 0)::bigint) FROM pg_temp.dash_f f);
  ELSIF p_kpi = 'k4' THEN
    v_extra := jsonb_build_object('undated_cancellations', (SELECT count(*) FROM pg_temp.dash_f f WHERE f.dim = 'undated'),
                                  'complete', NOT EXISTS (SELECT 1 FROM pg_temp.dash_f f WHERE f.dim = 'undated'));
    IF EXISTS (SELECT 1 FROM pg_temp.dash_f f WHERE f.dim = 'undated') THEN TRUNCATE pg_temp.dash_f; END IF;  -- never a partial total or aging
  ELSIF p_kpi = 'k12' THEN
    v_extra := (SELECT jsonb_build_object('booked', count(*) FILTER (WHERE f.dim = 'booked'), 'failed', count(*) FILTER (WHERE f.dim <> 'booked')) FROM pg_temp.dash_f f);
  END IF;
  RETURN jsonb_build_object(
    'kpi', p_kpi, 'from', p_from, 'to', p_to, 'branch_id', a.branch_id, 'as_of', v_now, 'extra', v_extra,
    'total', (SELECT sum(f.amount) FILTER (WHERE f.money) FROM pg_temp.dash_f f),
    'by_dim', coalesce((SELECT jsonb_object_agg(x.dim, x.s) FROM (SELECT f.dim, CASE WHEN p_kpi = 'k14' THEN trim_scale(sum(f.amount) / 1000000.0) ELSE sum(f.amount) END s FROM pg_temp.dash_f f GROUP BY f.dim) x), '{}'::jsonb),
    'by_branch', coalesce((SELECT jsonb_object_agg(y.k, y.d) FROM (
        SELECT coalesce(x.branch_id::text, '-') k, jsonb_object_agg(x.dim, x.s) d
          FROM (SELECT f.branch_id, f.dim, CASE WHEN p_kpi = 'k14' THEN trim_scale(sum(f.amount) / 1000000.0) ELSE sum(f.amount) END s FROM pg_temp.dash_f f GROUP BY f.branch_id, f.dim) x GROUP BY x.branch_id) y), '{}'::jsonb),
    'by_grp1', coalesce((SELECT jsonb_object_agg(y.k, y.d) FROM (
        SELECT x.grp1 k, jsonb_object_agg(x.dim, x.s) d
          FROM (SELECT f.grp1, f.dim, sum(f.amount)::bigint s FROM pg_temp.dash_f f WHERE f.grp1 IS NOT NULL AND p_kpi IN ('k13','k15','k17') GROUP BY f.grp1, f.dim) x GROUP BY x.grp1) y), '{}'::jsonb),
    'by_grp2', coalesce((SELECT jsonb_object_agg(y.k, y.d) FROM (
        SELECT x.grp2 k, jsonb_object_agg(x.dim, x.s) d
          FROM (SELECT coalesce(f.grp2, '-') grp2, f.dim, sum(f.amount)::bigint s FROM pg_temp.dash_f f WHERE p_kpi IN ('k13','k17') GROUP BY 1, f.dim) x GROUP BY x.grp2) y), '{}'::jsonb),
    'rows', CASE WHEN p_detail THEN coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', f.branch_id, 'day', f.day, 'dim', f.dim, 'amount', CASE WHEN p_kpi = 'k14' THEN trim_scale(f.amount / 1000000.0) ELSE f.amount END,
                                                                                  'source_kind', f.source_kind, 'source_id', f.source_id)
                                                          || CASE WHEN p_kpi = 'k15' THEN jsonb_build_object('grp1', f.grp1, 'refs', coalesce(f.refs, '[]'::jsonb)) ELSE '{}'::jsonb END
                                                        ORDER BY f.day, f.dim, f.grp1, f.source_id) FROM pg_temp.dash_f f), '[]'::jsonb) END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dashboard_kpi(text, date, date, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dashboard_kpi(text, date, date, uuid, boolean) TO clinic_app;--> statement-breakpoint

-- ── UX-60 role homes (19 §2.1): the acting role's widgets, counts and short non-clinical lists from existing facts; dates in the
-- branch's local day. Klinis (facility head, own branch), Marketing (tenant / branch), Apotek (pharmacist, own branch), Pembelian
-- (purchasing, tenant / branch), Audit (auditor, owner; this month). Ruang Saya reads treatment_room_list / appointments_window. ──
CREATE FUNCTION public.dashboard_home(p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.dashboard_actor(ARRAY['facility_head','marketing','pharmacist','purchasing','auditor','owner'], p_branch);
  t uuid := a.tenant_id;
  bid uuid := a.branch_id;
  v_now timestamptz := clock_timestamp();
  v_today date := public.tax_local_date(a.tenant_id, clock_timestamp(), a.branch_id);
  v_month date := date_trunc('month', public.tax_local_date(a.tenant_id, clock_timestamp(), a.branch_id))::date;
  v_k13 jsonb;
  v_k14 jsonb;
BEGIN
  IF a.role = 'facility_head' THEN
    RETURN jsonb_build_object('home', 'klinis', 'branch_id', bid, 'today', v_today,
      'complaints_open', (SELECT count(*) FROM public.complaint_tasks c WHERE c.tenant_id = t AND c.branch_id = bid AND c.kind = 'klinis' AND c.state <> 'resolved'),
      'corrections_pending', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'requested_at', r.requested_at, 'requested_by', s.display_name) ORDER BY r.requested_at)
          FROM public.record_corrections r JOIN public.staff s ON s.tenant_id = r.tenant_id AND s.id = r.requested_by
         WHERE r.tenant_id = t AND r.branch_id = bid AND r.state = 'pending'), '[]'::jsonb),
      -- verified STR/SIP of staff of this branch expiring within 60 days (the 0068 alert thresholds 60/30/7)
      'credentials_expiring', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'staff', s.display_name, 'kind', c.kind, 'expires_on', c.expires_on) ORDER BY c.expires_on, c.id)
          FROM public.staff_credentials c JOIN public.staff s ON s.tenant_id = c.tenant_id AND s.id = c.staff_id
         WHERE c.tenant_id = t AND c.state = 'verified' AND c.expires_on IS NOT NULL AND c.expires_on <= v_today + 60
           -- r3 (review 3ba1bf52 F1; 0068 credential_readable): a branch permit (SIP/SIPP/SIPA) of THIS branch only; a branch-independent STR when
           -- its holder holds a clinical role at this branch
           AND (c.branch_id = bid
                OR c.branch_id IS NULL AND EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = c.tenant_id AND sb.staff_id = c.staff_id AND sb.branch_id = bid
                                                     AND sb.role IN ('doctor','nurse','therapist','pharmacist','facility_head')))), '[]'::jsonb),
      'satusehat_rejected', (SELECT count(*) FROM public.satusehat_links l WHERE l.tenant_id = t AND l.branch_id = bid AND l.status IN ('failed','exception')),
      'incidents_open', (SELECT count(*) FROM public.clinical_incidents i WHERE i.tenant_id = t AND i.branch_id = bid AND i.state <> 'closed'));
  ELSIF a.role = 'marketing' THEN
    -- r3 (review 3ba1bf52 F5; 19 :40, UX-60): source (K13) and response (K14) for the stated month-to-date window, read through
    -- dashboard_kpi itself (same actor, same branch view) so the home never diverges from the KPI
    v_k13 := public.dashboard_kpi('k13', v_month, v_today, bid, false);
    v_k14 := public.dashboard_kpi('k14', v_month, v_today, bid, false);
    RETURN jsonb_build_object('home', 'marketing', 'branch_id', bid, 'today', v_today, 'month_from', v_month,
      'window', jsonb_build_object('from', v_month, 'to', v_today),
      'k13', jsonb_build_object('lead', coalesce((v_k13 -> 'by_dim' ->> 'lead')::bigint, 0), 'booked', coalesce((v_k13 -> 'by_dim' ->> 'booked')::bigint, 0),
                                'arrived', coalesce((v_k13 -> 'by_dim' ->> 'arrived')::bigint, 0), 'paid', coalesce((v_k13 -> 'by_dim' ->> 'paid')::bigint, 0),
                                'by_source', v_k13 -> 'by_grp1'),
      'k14', v_k14 -> 'extra',
      'leads_by_stage', coalesce((SELECT jsonb_object_agg(x.stage, x.n) FROM (SELECT l.stage, count(*) n FROM public.leads l
          WHERE l.tenant_id = t AND (bid IS NULL OR l.branch_id = bid) GROUP BY l.stage) x), '{}'::jsonb),
      -- promo code performance this month: uses and discount value per code (K25 itself is T-116)
      'promo_this_month', coalesce((SELECT jsonb_agg(jsonb_build_object('code', x.code, 'uses', x.n, 'discount', x.d) ORDER BY x.code) FROM (
          SELECT c.code, count(*) n, sum(u.discount)::bigint d FROM public.promo_usages u JOIN public.promo_codes c ON c.tenant_id = u.tenant_id AND c.id = u.promo_id
           WHERE u.tenant_id = t AND u.state = 'consumed' AND (bid IS NULL OR u.branch_id = bid)
             AND public.tax_local_date(t, u.consumed_at, u.branch_id) >= v_month GROUP BY c.code) x), '[]'::jsonb),
      -- dormant: canonical patients whose last visit is older than the SET-22 dormant days but within 12 months (K21's population)
      'dormant_patients', (SELECT count(*) FROM (SELECT public.patient_canonical(t, v.patient_id) cp, max(v.checked_in_at) last_at
          FROM public.visits v WHERE v.tenant_id = t AND (bid IS NULL OR v.branch_id = bid) GROUP BY 1) x
         WHERE x.last_at < v_now - make_interval(days => coalesce((public.setting_value_at('SET-22', NULL, v_now) ->> 'tidak_datang')::integer, 90))
           AND x.last_at >= v_now - interval '12 months'),
      'surveys_this_month', (SELECT jsonb_build_object('count', count(*), 'average', round(avg(s.score), 2), 'low', count(*) FILTER (WHERE s.score <= 2))
          FROM public.surveys s WHERE s.tenant_id = t AND (bid IS NULL OR s.branch_id = bid) AND public.tax_local_date(t, s.recorded_at, s.branch_id) >= v_month));
  ELSIF a.role = 'pharmacist' THEN
    RETURN jsonb_build_object('home', 'apotek', 'branch_id', bid, 'today', v_today,
      'to_prepare', (SELECT count(*) FROM public.dispensings d WHERE d.tenant_id = t AND d.branch_id = bid AND d.state = 'queued'),
      'to_hand_over', (SELECT count(*) FROM public.dispensings d WHERE d.tenant_id = t AND d.branch_id = bid AND d.state = 'prepared'),
      'near_expiry', (SELECT count(*) FROM public.stock_batches b WHERE b.tenant_id = t AND b.branch_id = bid AND b.quantity > 0
                        AND public.stock_unfit_reason(b, v_now) IS NULL
                        AND b.expiry <= v_today + coalesce((public.setting_value_at('SET-27', bid, v_now) ->> 'kedaluwarsa')::integer, 30)),
      -- opened vials still open: lapsed (use-by passed) and due within 24 hours
      'vials_lapsed', (SELECT count(*) FROM public.opened_vials v WHERE v.tenant_id = t AND v.branch_id = bid AND v.state = 'open' AND v.use_by <= v_now),
      'vials_due_24h', (SELECT count(*) FROM public.opened_vials v WHERE v.tenant_id = t AND v.branch_id = bid AND v.state = 'open'
                          AND v.use_by > v_now AND v.use_by <= v_now + interval '24 hours'),
      'po_received_today', (SELECT count(*) FROM public.goods_receipts g WHERE g.tenant_id = t AND g.branch_id = bid AND public.tax_local_date(t, g.received_at, g.branch_id) = v_today),
      'batches_held', (SELECT jsonb_build_object('quarantined', count(*) FILTER (WHERE b.state IN ('quarantined','temperature_excursion')), 'recalled', count(*) FILTER (WHERE b.state = 'recalled'))
          FROM public.stock_batches b WHERE b.tenant_id = t AND b.branch_id = bid AND b.quantity > 0 AND b.state <> 'active'));
  ELSIF a.role = 'purchasing' THEN
    RETURN jsonb_build_object('home', 'pembelian', 'branch_id', bid, 'today', v_today,
      'below_min_by_branch', coalesce((SELECT jsonb_object_agg(x.branch_id, x.n) FROM (
          SELECT l.branch_id, count(*) n FROM public.stock_levels l
           WHERE l.tenant_id = t AND (bid IS NULL OR l.branch_id = bid) AND l.min_qty IS NOT NULL
             AND coalesce((SELECT sum(public.stock_fit_qty(b, v_now)) FROM public.stock_batches b
                            WHERE b.tenant_id = l.tenant_id AND b.branch_id = l.branch_id AND b.item_id = l.item_id), 0) < l.min_qty
           GROUP BY l.branch_id) x), '{}'::jsonb),
      'po_open', (SELECT count(*) FROM public.purchase_orders p WHERE p.tenant_id = t AND (bid IS NULL OR p.branch_id = bid) AND p.state IN ('sent','partially_received')),
      -- open supplier invoices due within 7 days (or overdue): count and outstanding
      'payables_due', (SELECT jsonb_build_object('count', count(*), 'outstanding', coalesce(sum(i.total - i.paid_amount - i.credited_amount), 0)::bigint)
          FROM public.supplier_invoices i WHERE i.tenant_id = t AND (bid IS NULL OR i.branch_id = bid) AND i.state = 'open'
           AND public.payables_date(i.due_date) <= v_today + 7));
  ELSE -- auditor, owner: Ringkasan Audit for this month (Panel 2: existing facts only, no score or table)
    RETURN jsonb_build_object('home', 'audit', 'branch_id', bid, 'today', v_today, 'month_from', v_month,
      'manual_discounts', (SELECT jsonb_build_object('count', count(*), 'discount', coalesce(sum(l.discount), 0)::bigint)
          FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id AND i.state IN ('issued','void')
         WHERE l.tenant_id = t AND l.discount_kind = 'manual' AND (bid IS NULL OR l.branch_id = bid) AND public.tax_local_date(t, i.issued_at, i.branch_id) >= v_month),
      'voids', (SELECT jsonb_build_object('count', count(*)) FROM public.invoices i
         WHERE i.tenant_id = t AND i.state = 'void' AND (bid IS NULL OR i.branch_id = bid) AND public.tax_local_date(t, i.voided_at, i.branch_id) >= v_month),
      -- the latest count of each shift counted this month with a difference
      'cash_variance', (SELECT jsonb_build_object('count', count(*), 'absolute', coalesce(sum(abs(x.counted_cash - x.expected_cash)), 0)::bigint) FROM (
          SELECT DISTINCT ON (c.shift_id) c.* FROM public.cash_shift_counts c WHERE c.tenant_id = t AND (bid IS NULL OR c.branch_id = bid)
             AND public.tax_local_date(t, c.counted_at, c.branch_id) >= v_month ORDER BY c.shift_id, c.seq DESC) x WHERE x.counted_cash <> x.expected_cash),
      'stock_variance', (SELECT jsonb_build_object('counts', count(DISTINCT c.id), 'lines', count(*)) FROM public.stock_count_lines x
          JOIN public.stock_counts c ON c.tenant_id = x.tenant_id AND c.id = x.count_id
         WHERE x.tenant_id = t AND (bid IS NULL OR x.branch_id = bid) AND c.state IN ('pending_approval','applied') AND x.counted_qty IS NOT NULL
           AND x.counted_qty <> x.system_qty AND public.tax_local_date(t, coalesce(c.closed_at, c.submitted_at), c.branch_id) >= v_month),
      'write_offs', (SELECT jsonb_build_object('count', count(*), 'amount', coalesce(sum(w.amount), 0)::bigint) FROM public.write_offs w
         WHERE w.tenant_id = t AND (bid IS NULL OR w.branch_id = bid) AND public.tax_local_date(t, w.created_at, w.branch_id) >= v_month));
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dashboard_home(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.dashboard_home(uuid) TO clinic_app;
