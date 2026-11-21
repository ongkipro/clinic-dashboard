-- T-108 (PR-34, UX-22 ▸ Rekon; R3): recon_report — the reconciliation reader. Function and grant only (no table, no index, snapshot 0129 =
-- 0128). Both sides of the reconciliation, per source document, for the pure engine (src/modules/accounting/recon: toReconInput → reconcile).
-- Owner, finance and the auditor (ledger_actor: the tenant's staff_access lock first, wall-clock authority). Ids, days, branch ids, receipt
-- / invoice numbers and integer rupiah only — never a patient, a clinical field or a payload.
--
-- Operational facts (Appendix A attribution, the same rows as dashboard_kpi): K1 money in (payments not simulated and not balance, branch
-- where paid, payment local date; − cash refunds; − refunded booking DPs); K2 completed service (paid-not-delivered performance terms of
-- subledger_movements + redeemed package sessions, executing branch); receivables created / collected / written off.
-- Ledger postings (journal lines placed by business_date): K1 on the tender accounts (cash_shift, bank, gateway_clearing, petty_cash);
-- K2 on the revenue accounts; receivables on patient_receivable. A posting is mapped to the operational document by its source:
-- payment_allocation → its payment (aggregated per payment, Panel 2: a multi-line receipt is one reference), balance_entry (top-up) → the
-- top-up's payment, booking_deposit received → its payment, refunded → the deposit, refund → the refund. Pending: open ledger.posting receipts
-- (hidden from a bound staff connection by RLS, hence this definer). Output VAT is not an operational KPI and is not a metric here (its
-- owners: the VAT sub-ledger, PR-25, and Coretax, PR-98). Every metric returned is fully read, so `unavailable` is empty.
CREATE FUNCTION public.recon_report(p_from date, p_to date, p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['owner','finance','auditor']);
  t uuid := a.tenant_id;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = t AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch' USING ERRCODE = 'P0002';
  END IF;
  RETURN (
    WITH
    br AS (SELECT b.id, b.name FROM public.branches b WHERE b.tenant_id = t AND (p_branch IS NULL OR b.id = p_branch)),
    -- the operational reference of a payment: the receipt number
    pay AS (SELECT y.id, y.branch_id, y.method, y.amount, y.is_simulated, public.tax_local_date(t, y.received_at, y.branch_id) AS day, r.number AS label
              FROM public.payments y JOIN public.receipts r ON r.tenant_id = y.tenant_id AND r.id = y.receipt_id WHERE y.tenant_id = t),
    facts AS (
      -- K1 (dashboard_kpi k1 rows): payments received, not simulated, not balance usage; − cash refunds; − refunded booking DPs
      SELECT 'k1'::text AS metric, 'payment'::text AS kind, p.id, p.label, p.day, p.branch_id, p.amount
        FROM pay p WHERE NOT p.is_simulated AND p.method <> 'balance'
      UNION ALL
      SELECT 'k1', 'refund', r.id, r.id::text, public.tax_local_date(t, r.paid_at, r.branch_id), r.branch_id, b.amount
        FROM public.refunds r JOIN public.balance_entries b ON b.tenant_id = r.tenant_id AND b.id = r.cash_entry_id
       WHERE r.tenant_id = t AND r.state = 'paid'
      UNION ALL
      SELECT 'k1', 'booking_deposit', d.id, d.id::text, public.tax_local_date(t, d.decided_at, d.branch_id), d.branch_id, -d.amount
        FROM public.booking_deposits d WHERE d.tenant_id = t AND d.state = 'refunded'
      UNION ALL
      -- K2 (dashboard_kpi k2 rows): delivered net value at performance + redeemed package sessions (executing branch)
      SELECT 'k2', m.source_kind, m.source_id, m.source_id::text, m.day, m.branch_id, -m.amount
        FROM public.subledger_movements(t) m WHERE m.ledger = 'paid_not_delivered' AND m.term = 'performance'
      UNION ALL
      SELECT 'k2', 'package_session', s.id, s.id::text, public.tax_local_date(t, s.redeemed_at, s.redeemed_branch_id), s.redeemed_branch_id, s.vat_base
        FROM public.package_sessions s WHERE s.tenant_id = t AND s.state = 'redeemed'
      UNION ALL
      -- receivables: created (+), collected (−, its payment), written off (−)
      SELECT 'receivables', 'receivable', rv.id, rv.id::text, public.tax_local_date(t, rv.created_at, rv.branch_id), rv.branch_id, rv.amount
        FROM public.receivables rv WHERE rv.tenant_id = t
      UNION ALL
      SELECT 'receivables', 'payment', p.id, p.label, p.day, p.branch_id, -al.amount
        FROM public.payment_allocations al JOIN pay p ON p.id = al.payment_id
       WHERE al.tenant_id = t AND al.receivable_id IS NOT NULL AND NOT al.is_simulated
      UNION ALL
      SELECT 'receivables', 'write_off', w.id, w.id::text, public.tax_local_date(t, w.created_at, w.branch_id), w.branch_id, -w.amount
        FROM public.write_offs w WHERE w.tenant_id = t),
    -- each journal line of the tenant with its account and the source document; a reversal (ledger_mirror) keeps the document of the
    -- entry it reverses, so a voided fact nets on its own reference instead of appearing as two unrelated orphans
    jl AS (
      SELECT e.id AS entry_id, coalesce(o.source_kind, e.source_kind) AS source_kind, coalesce(o.source_id, e.source_id) AS source_id,
             e.business_date, e.period, e.original_period, l.branch_id, c.key AS account, l.debit, l.credit
        FROM public.journal_entries e JOIN public.journal_lines l ON l.tenant_id = e.tenant_id AND l.entry_id = e.id
        JOIN public.ledger_accounts c ON c.tenant_id = l.tenant_id AND c.id = l.account_id
        LEFT JOIN public.journal_entries o ON o.tenant_id = e.tenant_id AND o.id = e.reverses_entry_id
       WHERE e.tenant_id = t AND e.business_date BETWEEN p_from AND p_to),
    -- the operational document behind a ledger source
    src AS (
      SELECT j.*,
             CASE WHEN j.source_kind = 'payment_allocation' THEN (SELECT al.payment_id FROM public.payment_allocations al WHERE al.tenant_id = t AND al.id = j.source_id)
                  WHEN j.source_kind = 'balance_entry' THEN (SELECT al.payment_id FROM public.balance_entries b JOIN public.payment_allocations al
                                                                ON al.tenant_id = b.tenant_id AND al.top_up_id = b.source_id
                                                             WHERE b.tenant_id = t AND b.id = j.source_id AND b.kind = 'top_up')
                  WHEN j.source_kind = 'booking_deposit' THEN (SELECT al.payment_id FROM public.payment_allocations al
                                                               WHERE al.tenant_id = t AND al.booking_deposit_id = j.source_id)
             END AS payment_id
        FROM jl j),
    posts AS (
      -- K1 on the tender accounts (debit − credit): a received DP / top-up / allocation is its payment; a refunded DP is the deposit
      SELECT 'k1'::text AS metric,
             CASE WHEN s.source_kind = 'booking_deposit' AND s.credit > 0 THEN 'booking_deposit' WHEN s.payment_id IS NOT NULL THEN 'payment' ELSE s.source_kind END AS kind,
             CASE WHEN s.source_kind = 'booking_deposit' AND s.credit > 0 THEN s.source_id ELSE coalesce(s.payment_id, s.source_id) END AS id,
             s.entry_id, s.business_date, s.period, s.original_period, s.branch_id, s.debit - s.credit AS amount
        FROM src s WHERE s.account IN ('cash_shift','bank','gateway_clearing','petty_cash')
         -- patient money only (the K1 sources); expenses, supplier payments, commission payouts and gateway settlements move tender
         -- accounts too but are not K1 facts, so they are out of this reconciliation rather than false orphans
         AND s.source_kind IN ('payment_allocation','balance_entry','booking_deposit','refund')
      UNION ALL
      -- a consultation fee posts on its invoice line (ConsultationFeeCharged); the operational fact is the fee
      SELECT 'k2', CASE WHEN s.source_kind = 'invoice_line' THEN 'consultation_fee' ELSE s.source_kind END,
             CASE WHEN s.source_kind = 'invoice_line' THEN coalesce((SELECT f.id FROM public.consultation_fees f WHERE f.tenant_id = t AND f.fee_line_id = s.source_id), s.source_id)
                  ELSE s.source_id END,
             s.entry_id, s.business_date, s.period, s.original_period, s.branch_id, s.credit - s.debit
        FROM src s WHERE s.account IN ('revenue_treatment','revenue_product','revenue_consultation')
         -- the K2 sources (performance, redemption, hand-over, consultation fee); revenue from balance moves (a delivered refund) is not a K2 fact
         AND s.source_kind IN ('treatment_execution','package_session','dispensing','invoice_line')
      UNION ALL
      SELECT 'receivables', CASE WHEN s.payment_id IS NOT NULL THEN 'payment' ELSE s.source_kind END, coalesce(s.payment_id, s.source_id),
             s.entry_id, s.business_date, s.period, s.original_period, s.branch_id, s.debit - s.credit
        FROM src s WHERE s.account = 'patient_receivable' AND s.source_kind IN ('receivable','payment_allocation','write_off')),
    -- one posting per (metric, document, entry, day, branch): a multi-allocation receipt is aggregated per payment before matching
    postg AS (SELECT p.metric, p.kind, p.id, p.entry_id, p.business_date, p.period, p.original_period, p.branch_id, sum(p.amount)::bigint AS amount
                FROM posts p GROUP BY 1, 2, 3, 4, 5, 6, 7, 8 HAVING sum(p.amount) <> 0),
    -- open ledger.posting receipts, mapped to the same document reference
    pend AS (
      SELECT er.event_id, ev.type AS event,
             CASE ev.type WHEN 'PaymentAllocated' THEN 'payment' WHEN 'ReceivableCollected' THEN 'payment' WHEN 'BalanceToppedUp' THEN 'payment'
                          WHEN 'BookingDepositReceived' THEN 'payment' WHEN 'BookingDepositRefunded' THEN 'booking_deposit' WHEN 'RefundPaid' THEN 'refund'
                          WHEN 'TreatmentFinished' THEN 'treatment_execution' WHEN 'SessionRedeemed' THEN 'package_session' WHEN 'ProductHandedOver' THEN 'dispensing'
                          WHEN 'ConsultationFeeCharged' THEN 'consultation_fee' WHEN 'ReceivableCreated' THEN 'receivable' WHEN 'ReceivableWrittenOff' THEN 'write_off' END AS kind,
             CASE ev.type WHEN 'PaymentAllocated' THEN (ev.payload ->> 'payment_id')::uuid WHEN 'ReceivableCollected' THEN (ev.payload ->> 'payment_id')::uuid
                          WHEN 'BalanceToppedUp' THEN (SELECT al.payment_id FROM public.balance_entries b JOIN public.payment_allocations al
                                                         ON al.tenant_id = b.tenant_id AND al.top_up_id = b.source_id
                                                      WHERE b.tenant_id = t AND b.id = (ev.payload ->> 'entry_id')::uuid)
                          WHEN 'BookingDepositReceived' THEN (SELECT al.payment_id FROM public.payment_allocations al
                                                              WHERE al.tenant_id = t AND al.booking_deposit_id = (ev.payload ->> 'deposit_id')::uuid)
                          WHEN 'BookingDepositRefunded' THEN (ev.payload ->> 'deposit_id')::uuid WHEN 'RefundPaid' THEN (ev.payload ->> 'refund_id')::uuid
                          WHEN 'TreatmentFinished' THEN (ev.payload ->> 'execution_id')::uuid WHEN 'SessionRedeemed' THEN (ev.payload ->> 'session_id')::uuid
                          WHEN 'ProductHandedOver' THEN (ev.payload ->> 'dispensing_id')::uuid WHEN 'ReceivableCreated' THEN (ev.payload ->> 'receivable_id')::uuid
                          WHEN 'ReceivableWrittenOff' THEN (ev.payload ->> 'write_off_id')::uuid
                          WHEN 'ConsultationFeeCharged' THEN (SELECT f.id FROM public.consultation_fees f
                                                              WHERE f.tenant_id = t AND f.fee_line_id = (ev.payload ->> 'invoice_line_id')::uuid) END AS id
        FROM public.event_receipts er JOIN public.domain_events ev ON ev.tenant_id = er.tenant_id AND ev.id = er.event_id
       WHERE er.tenant_id = t AND er.consumer = 'ledger.posting' AND er.done_at IS NULL),
    -- the label of a reference: a payment's receipt number; any other document its id
    lbl AS (SELECT p.id, p.label FROM pay p)
    SELECT jsonb_build_object(
      'from', p_from, 'to', p_to, 'branch_id', p_branch, 'as_of', clock_timestamp(),
      'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name, b.id) FROM br b), '[]'::jsonb),
      'facts', coalesce((SELECT jsonb_agg(jsonb_build_object('metric', f.metric, 'ref', jsonb_build_object('kind', f.kind, 'id', f.id, 'label', f.label),
                                                           'day', f.day, 'branch_id', f.branch_id, 'amount', f.amount) ORDER BY f.day, f.metric, f.kind, f.id)
                           FROM facts f WHERE f.day BETWEEN p_from AND p_to AND f.amount <> 0 AND f.branch_id IN (SELECT b.id FROM br b)), '[]'::jsonb),
      'postings', coalesce((SELECT jsonb_agg(jsonb_build_object('metric', p.metric,
                                                              'ref', jsonb_build_object('kind', p.kind, 'id', p.id, 'label', coalesce((SELECT l.label FROM lbl l WHERE l.id = p.id), p.id::text)),
                                                              'entry_id', p.entry_id, 'business_day', p.business_date, 'period', p.period,
                                                              'original_period', p.original_period, 'branch_id', p.branch_id, 'amount', p.amount)
                                             ORDER BY p.business_date, p.metric, p.kind, p.id, p.entry_id)
                              FROM postg p WHERE p.branch_id IN (SELECT b.id FROM br b)), '[]'::jsonb),
      'pending', coalesce((SELECT jsonb_agg(jsonb_build_object('event_id', x.event_id, 'event', x.event,
                                                             'ref', jsonb_build_object('kind', x.kind, 'id', x.id, 'label', coalesce((SELECT l.label FROM lbl l WHERE l.id = x.id), x.id::text)))
                                            ORDER BY x.event_id)
                             FROM pend x WHERE x.kind IS NOT NULL AND x.id IS NOT NULL), '[]'::jsonb),
      -- inter-branch clearing: the legs of the selected branches only (no other branch's amount is exposed) ...
      'clearing', coalesce((SELECT jsonb_agg(jsonb_build_object('day', c.business_date, 'branch_id', c.branch_id, 'amount', c.amount) ORDER BY c.business_date, c.branch_id)
                              FROM (SELECT j.business_date, j.branch_id, sum(j.debit - j.credit)::bigint AS amount FROM jl j
                                     WHERE j.account = 'inter_branch_clearing' GROUP BY 1, 2) c
                             WHERE c.branch_id IN (SELECT b.id FROM br b)), '[]'::jsonb),
      -- ... and the tenant-wide net per day, which is what must be zero (R3 7adf39f6 F1). Only for a day the selected branches have a leg
      -- on, or a day that does not net to zero (a tenant-wide difference): a balanced day of other branches adds nothing to show.
      'clearing_net', coalesce((SELECT jsonb_agg(jsonb_build_object('day', n.business_date, 'amount', n.amount) ORDER BY n.business_date)
                                  FROM (SELECT j.business_date, sum(j.debit - j.credit)::bigint AS amount,
                                               bool_or(j.branch_id IN (SELECT b.id FROM br b)) AS shown
                                          FROM jl j WHERE j.account = 'inter_branch_clearing' GROUP BY 1) n
                                 WHERE n.shown OR n.amount <> 0), '[]'::jsonb),
      -- G-Q4 U1–U4 exception counts per branch (the 0124 hand-over rule; never valued on either side)
      'handover', coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', h.branch_id, 'fractional', h.fractional, 'unlinked', h.unlinked) ORDER BY h.branch_id)
                              FROM (SELECT d.branch_id, count(*) FILTER (WHERE si.quantity <> trunc(si.quantity)) AS fractional,
                                           count(*) FILTER (WHERE si.quantity = trunc(si.quantity)) AS unlinked
                                      FROM public.dispensings d JOIN public.selection_items si ON si.tenant_id = d.tenant_id AND si.id = d.selection_item_id
                                     WHERE d.tenant_id = t AND d.state = 'handed' AND d.branch_id IN (SELECT b.id FROM br b)
                                       AND public.tax_local_date(d.tenant_id, d.handed_at, d.branch_id) BETWEEN p_from AND p_to
                                       AND NOT EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                                                        WHERE l.tenant_id = d.tenant_id AND l.selection_item_id = d.selection_item_id AND i.state = 'issued')
                                     GROUP BY d.branch_id) h), '[]'::jsonb),
      'unavailable', '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.recon_report(date, date, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.recon_report(date, date, uuid) TO clinic_app;
