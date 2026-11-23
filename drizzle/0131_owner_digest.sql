-- T-117 (PR-80, P-18; R3): owner daily digest, slice B1. Migration 0131 (owner decision 2026-11-23, t117/OWNER-DECISION-20261123.md;
-- r2–r4 after the R3 reviews R3-REVIEW-B1D-codex-panel3.md, -r2- and -r3-; r4 design: DESIGN-r4.md in the freeze).
-- digest_runs: one run per tenant per local business day (the earliest-created branch's day, tax_local_date's tenant basis; Asia/Jakarta
-- without a branch), written only by the worker functions digest_claim / digest_dispatch / digest_delivered / digest_complete on a FULLY
-- unbound connection. The facts are read only by the claimed job (TEN-5: claim unbound -> bind the run's tenant with no staff, no role, every
-- branch -> digest_facts(run, generation)). Each send is authorized by digest_dispatch (generation, unexpired lease, CURRENT opt-in,
-- recipients and lifecycle, on a clock read after its locks), at most once per generation. Outcomes (r5, DESIGN-r5.md): 'sent' (a receipt
-- is recorded — a receipt wins over every closure); 'refused:<code>' (ONLY a run never dispatched); 'unconfirmed:<code>' (dispatched, no
-- receipt, no further send allowed: it may have been delivered — an operator checks the provider). Exactly-once is the PROVIDER's: the adapter passes
-- digestKey as its idempotency key. One clock for leases: clock_timestamp() (p_now only chooses the due business day).
-- K1 / K2 are the dashboard_kpi rows, extracted into shared internal helpers (dashboard_kpi re-points to them; output unchanged). The six
-- exceptions are the T-109 Ringkasan Owner "Perlu ditangani" items, counted in SQL (count(*), no reader cap).
-- Payload: the clinic name, branch names, integer rupiah and counts only — never a patient field, a clinical text or a source row id.
CREATE TABLE "digest_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"recipients" text[] NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"lease_gen" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"dispatched_at" timestamp with time zone,
	"dispatched_gens" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"delivered_at" timestamp with time zone,
	"provider_ref" text,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "digest_runs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "digest_runs_one_per_day" UNIQUE("tenant_id","business_date"),
	CONSTRAINT "digest_runs_check" CHECK ("digest_runs"."state" in ('queued','leased','dispatching','done') and "digest_runs"."lease_gen" >= 0 and "digest_runs"."attempts" >= 0
      and cardinality("digest_runs"."recipients") between 1 and 4 and "digest_runs"."recipients" <@ array['owner','admin_pusat','finance','manager']::text[]
      and (("digest_runs"."state" in ('leased','dispatching')) = ("digest_runs"."lease_until" is not null))
      and ("digest_runs"."state" <> 'dispatching' or "digest_runs"."dispatched_at" is not null) and (("digest_runs"."dispatched_at" is null) = (cardinality("digest_runs"."dispatched_gens") = 0))
      and (("digest_runs"."delivered_at" is null) = ("digest_runs"."provider_ref" is null)) and ("digest_runs"."delivered_at" is null or "digest_runs"."dispatched_at" is not null)
      and ("digest_runs"."provider_ref" is null or "digest_runs"."provider_ref" ~ '^[A-Za-z0-9_.:-]{1,128}$')
      and (("digest_runs"."state" = 'done') = ("digest_runs"."outcome" is not null)) and (("digest_runs"."state" = 'done') = ("digest_runs"."finished_at" is not null))
      and ("digest_runs"."outcome" is null or "digest_runs"."outcome" ~ '^(sent|refused:[a-z][a-z0-9_]{1,48}|unconfirmed:[a-z][a-z0-9_]{1,48})$')
      and (coalesce("digest_runs"."outcome" = 'sent', false) = ("digest_runs"."state" = 'done' and "digest_runs"."delivered_at" is not null))
      and ("digest_runs"."outcome" is null or "digest_runs"."outcome" = 'sent' or "digest_runs"."delivered_at" is null)
      and ("digest_runs"."outcome" is null or "digest_runs"."outcome" not like 'unconfirmed:%' or "digest_runs"."dispatched_at" is not null)
      and ("digest_runs"."outcome" is null or "digest_runs"."outcome" not like 'refused:%' or cardinality("digest_runs"."dispatched_gens") = 0))
);
--> statement-breakpoint
ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- ── digest_runs rules: RLS on, no app grant (only the definers below touch it); never deleted; identity frozen; generations and attempts only
-- move forward; a dispatch record is append-only; a recorded receipt never changes. A finished run is final, with ONE exception: a receipt
-- arriving after a terminal 'unconfirmed:*' upgrades it to 'sent' (digest_delivered) — the only allowed change of a terminal outcome. ──
ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE FUNCTION public.digest_runs_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: digest runs are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.lease_gen <> 0 OR NEW.attempts <> 0 OR NEW.dispatched_at IS NOT NULL OR cardinality(NEW.dispatched_gens) <> 0
       OR NEW.delivered_at IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: a digest run starts queued' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.business_date, NEW.recipients, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.business_date, OLD.recipients, OLD.created_at) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a digest run keeps its identity' USING ERRCODE = '42501';
  END IF;
  IF OLD.state = 'done' AND NOT (OLD.outcome LIKE 'unconfirmed:%' AND NEW.outcome = 'sent' AND OLD.delivered_at IS NULL AND NEW.delivered_at IS NOT NULL
       AND (NEW.lease_gen, NEW.attempts, NEW.dispatched_at, NEW.dispatched_gens) IS NOT DISTINCT FROM (OLD.lease_gen, OLD.attempts, OLD.dispatched_at, OLD.dispatched_gens)) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a finished digest run is final (only unconfirmed -> sent on a receipt)' USING ERRCODE = '42501';
  END IF;
  IF NEW.outcome LIKE 'refused:%' AND cardinality(NEW.dispatched_gens) <> 0 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a dispatched run is never refused (unconfirmed instead)' USING ERRCODE = '42501';
  END IF;
  IF NEW.outcome IS DISTINCT FROM 'sent' AND NEW.state = 'done' AND NEW.delivered_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a run with a receipt is finished as sent' USING ERRCODE = '42501';
  END IF;
  IF OLD.delivered_at IS NOT NULL AND (NEW.delivered_at, NEW.provider_ref) IS DISTINCT FROM (OLD.delivered_at, OLD.provider_ref) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a recorded delivery is never changed' USING ERRCODE = '42501';
  END IF;
  IF NOT (NEW.dispatched_gens @> OLD.dispatched_gens) OR NEW.lease_gen < OLD.lease_gen OR NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: generations, attempts and dispatches only move forward' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_runs_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER digest_runs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.digest_runs FOR EACH ROW EXECUTE FUNCTION public.digest_runs_guard();--> statement-breakpoint
ALTER TABLE public.digest_runs ENABLE ALWAYS TRIGGER digest_runs_guard;--> statement-breakpoint
CREATE TRIGGER digest_runs_no_truncate BEFORE TRUNCATE ON public.digest_runs FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.digest_runs', 'tenant-shared', 'reporting', '{}', 'digest_claim / digest_dispatch / digest_delivered / digest_complete on the unbound worker connection (src/modules/reporting/digest/run.ts); read only through digest_facts by the claimed job',
   'none: tenant-wide, the earliest-created branch''s local day');--> statement-breakpoint

-- ── K1 / K2 facts (internal: revoked from PUBLIC, never granted): exactly the dashboard_kpi k1 / k2 rows (0126:60-89), moved here so the
-- dashboard and the digest share one definition. Columns: branch, local day, dim, amount (integer rupiah), source record. ──
-- K1 Uang masuk: payments received (not simulated, not balance usage) − cash refunds (the cash entry of a paid refund, a refunded DP);
-- by payment / refund local date, branch where paid.
CREATE FUNCTION public.kpi_k1_facts(p_tenant uuid) RETURNS TABLE (branch_id uuid, day date, dim text, amount bigint, source_kind text, source_id uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT y.branch_id, public.tax_local_date(p_tenant, y.received_at, y.branch_id), y.method, y.amount, 'payment', y.id
      FROM public.payments y WHERE y.tenant_id = p_tenant AND NOT y.is_simulated AND y.method <> 'balance'
    UNION ALL
    SELECT r.branch_id, public.tax_local_date(p_tenant, r.paid_at, r.branch_id), 'cash_refund', b.amount, 'refund', r.id
      FROM public.refunds r JOIN public.balance_entries b ON b.tenant_id = r.tenant_id AND b.id = r.cash_entry_id
     WHERE r.tenant_id = p_tenant AND r.state = 'paid'
    UNION ALL
    SELECT d.branch_id, public.tax_local_date(p_tenant, d.decided_at, d.branch_id), 'dp_refund', -d.amount, 'booking_deposit', d.id
      FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.state = 'refunded'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kpi_k1_facts(uuid) FROM PUBLIC;--> statement-breakpoint

-- K2 Layanan selesai: the delivered net value the sub-ledger derives at performance (a counted single treatment's line, a handed product's
-- line, a charged consultation fee; T-104) + redeemed package sessions at their VAT-exclusive allocated value (BILL-7), by performance local
-- date, executing branch.
CREATE FUNCTION public.kpi_k2_facts(p_tenant uuid) RETURNS TABLE (branch_id uuid, day date, dim text, amount bigint, source_kind text, source_id uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.branch_id, m.day, CASE m.source_kind WHEN 'treatment_execution' THEN 'treatment' WHEN 'dispensing' THEN 'product' ELSE 'consultation' END,
           -m.amount, m.source_kind, m.source_id
      FROM public.subledger_movements(p_tenant) m WHERE m.ledger = 'paid_not_delivered' AND m.term = 'performance'
    UNION ALL
    SELECT s.redeemed_branch_id, public.tax_local_date(p_tenant, s.redeemed_at, s.redeemed_branch_id), 'session', s.vat_base, 'package_session', s.id
      FROM public.package_sessions s WHERE s.tenant_id = p_tenant AND s.state = 'redeemed'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kpi_k2_facts(uuid) FROM PUBLIC;--> statement-breakpoint

-- ── dashboard_kpi (0126) re-pointed: the k1 and k2 blocks insert from the shared helpers; nothing else changes (signature, roles, guard,
-- the other KPIs, the output). Proved by tests/reporting/dashboards.test.ts and reports.test.ts passing unmodified. ──
CREATE OR REPLACE FUNCTION public.dashboard_kpi(p_kpi text, p_from date, p_to date, p_branch uuid DEFAULT NULL, p_detail boolean DEFAULT false) RETURNS jsonb
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
    SELECT f.branch_id, f.day, f.dim, f.amount, true, f.source_kind, f.source_id, NULL, NULL FROM public.kpi_k1_facts(t) f;
  END IF;

  -- K2 Layanan selesai (and the K2 part of K7): the delivered net value the sub-ledger already derives at performance (a counted single
  -- treatment's line, a handed product's line, a charged consultation fee; T-104) + redeemed package sessions at their VAT-exclusive
  -- allocated value (BILL-7), by performance local date, executing branch.
  -- lazy: subledger_movements is computed for the whole tenant per call (as subledger_rollforward does); upgrade to a performance-only
  -- reader if a measured dashboard read is too slow.
  IF p_kpi IN ('k2','k7') THEN
    INSERT INTO pg_temp.dash_f (branch_id, day, dim, amount, money, source_kind, source_id, grp1, grp2)
    SELECT f.branch_id, f.day, f.dim, f.amount, true, f.source_kind, f.source_id, NULL, NULL FROM public.kpi_k2_facts(t) f;
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

-- ── POLICY (confirmed by the owner, 2026-11-23): each is ONE constant the owner can change here.
--   digest_max_attempts: a run leased this many times without a completion is finished — refused:attempts_exhausted if it was never
--   dispatched, unconfirmed:attempts_exhausted if it was (it may have been delivered; never a refusal).
--   digest_lease: how long a claim (and a dispatch) holds the run on the database clock. ──
CREATE FUNCTION public.digest_max_attempts() RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT 5 $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_max_attempts() FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.digest_lease() RETURNS interval
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT interval '5 minutes' $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_lease() FROM PUBLIC;--> statement-breakpoint

-- A worker entry point refuses ANY context binding (all five TEN-2 settings, src/db/rls/context.ts CONTEXT_SETTINGS): a half-bound context
-- (a role, a branch list or an active branch without a tenant) is not an unbound worker.
CREATE FUNCTION public.digest_unbound() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['app.tenant_id','app.allowed_branch_ids','app.active_branch_id','app.staff_id','app.roles']) n
              WHERE coalesce(current_setting(n, true), '') <> '') THEN
    RAISE EXCEPTION 'digest worker functions run on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_unbound() FROM PUBLIC;--> statement-breakpoint

-- The tenant's SET-37 at p_at (followup_setting: the tenant's newest active version, else the default), checked as dayClose / optIn do:
-- 'out' (ringkasan null = Nonaktif), 'invalid' (outside 17:00–23:00, malformed, or penerima not 1–4 distinct known roles), or 'in'.
CREATE FUNCTION public.digest_opt_in(p_tenant uuid, p_at timestamptz, OUT state text, OUT at text, OUT roles text[])
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v jsonb := public.followup_setting(p_tenant, 'SET-37', p_at);
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN state := 'invalid'; RETURN; END IF;
  IF jsonb_typeof(v -> 'ringkasan') IS NULL OR jsonb_typeof(v -> 'ringkasan') = 'null' THEN state := 'out'; RETURN; END IF;
  at := v ->> 'ringkasan';
  IF jsonb_typeof(v -> 'ringkasan') <> 'string' OR at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR at < '17:00' OR at > '23:00'
     OR jsonb_typeof(v -> 'penerima') IS DISTINCT FROM 'array' THEN
    state := 'invalid'; RETURN;
  END IF;
  roles := ARRAY(SELECT jsonb_array_elements_text(v -> 'penerima'));
  IF cardinality(roles) NOT BETWEEN 1 AND 4 OR NOT roles <@ ARRAY['owner','admin_pusat','finance','manager']
     OR (SELECT count(DISTINCT x) FROM unnest(roles) x) <> cardinality(roles) THEN
    state := 'invalid'; roles := NULL; RETURN;
  END IF;
  state := 'in';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_opt_in(uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- ── digest_claim (worker, unbound only; the satusehat_claim / outbound_claim pattern). Two clocks, each with one job:
--   p_now (else the wall clock) is the SCHEDULE only: which tenants are due and for which local business day;
--   clock_timestamp() is the LEASE clock: reaping, lease expiry and generation validity (the same clock digest_facts / _dispatch check).
--   1. create the due run for every live tenant opted in whose primary-branch local time (at p_now) has reached `ringkasan` — idempotent per
--      (tenant, local day);
--   2. reap leases that ran out on the wall clock (leased or dispatching), for ANY lifecycle (recovery never depends on the tenant being live):
--        a recorded receipt                              -> 'sent';
--        attempts at digest_max_attempts(), dispatched   -> 'unconfirmed:attempts_exhausted' (never a refusal: it may have been delivered);
--        attempts at digest_max_attempts(), never sent   -> 'refused:attempts_exhausted';
--        otherwise                                        -> queued again (a dispatched run keeps its dispatch record);
--      then every QUEUED run whose tenant is no longer live is closed: 'sent' if it has a receipt, 'unconfirmed:not_live' if it was ever
--      dispatched (no facts read, nothing sent), else 'refused:not_live'. Every closure is computed from the row itself (receipt first, then
--      dispatch), so it always satisfies the table's CHECK: one tenant's row can never fail — and roll back — the multi-tenant claim;
--   3. lease queued runs of live tenants, FOR UPDATE SKIP LOCKED, for digest_lease(), lease_gen + 1.
-- Returns [{id, tenant_id, business_date, gen}] — ids, the day and the generation only (recipients are decided at dispatch).
-- lazy: one SET-37 read per live tenant per claim (pilot scale: a handful of tenants); index or pre-filter if claims get slow. ──
CREATE FUNCTION public.digest_claim(p_now timestamptz DEFAULT NULL, p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_clock timestamptz := clock_timestamp();
  v_sched timestamptz := coalesce(p_now, v_clock);
  tn record;
  o record;
  v_local timestamp;
  r public.digest_runs;
  v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.digest_unbound();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: limit' USING ERRCODE = '22023';
  END IF;
  FOR tn IN SELECT tr.id FROM public.tenants_registry tr JOIN public.tenants t ON t.id = tr.id WHERE tr.lifecycle_state = 'live' ORDER BY tr.id LOOP
    o := public.digest_opt_in(tn.id, v_sched);
    CONTINUE WHEN o.state IS DISTINCT FROM 'in';
    v_local := v_sched AT TIME ZONE coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = tn.id ORDER BY b.created_at, b.id LIMIT 1), 'Asia/Jakarta');
    CONTINUE WHEN to_char(v_local, 'HH24:MI') < o.at;
    INSERT INTO public.digest_runs (tenant_id, business_date, recipients) VALUES (tn.id, v_local::date, o.roles)
      ON CONFLICT (tenant_id, business_date) DO NOTHING;
  END LOOP;
  -- recovery: every lifecycle, no facts, no send; the outcome is decided by whether a send was ever authorized (dispatched_at)
  UPDATE public.digest_runs x
     SET (state, lease_until, outcome, finished_at) = (
           SELECT CASE WHEN c.code IS NULL THEN 'queued' ELSE 'done' END, NULL::timestamptz, c.code, CASE WHEN c.code IS NULL THEN NULL ELSE v_clock END
             FROM (SELECT CASE
                     WHEN x.delivered_at IS NOT NULL THEN 'sent'
                     WHEN x.attempts >= public.digest_max_attempts() THEN CASE WHEN cardinality(x.dispatched_gens) = 0 THEN 'refused' ELSE 'unconfirmed' END || ':attempts_exhausted'
                   END AS code) c)
   WHERE x.id IN (SELECT y.id FROM public.digest_runs y WHERE y.state IN ('leased','dispatching') AND y.lease_until <= v_clock FOR UPDATE SKIP LOCKED);
  -- every queued run (including one just reaped above) whose tenant is no longer live: closed without facts or a send
  UPDATE public.digest_runs x
     SET state = 'done', finished_at = v_clock,
         outcome = CASE WHEN x.delivered_at IS NOT NULL THEN 'sent' WHEN cardinality(x.dispatched_gens) = 0 THEN 'refused:not_live' ELSE 'unconfirmed:not_live' END
   WHERE x.id IN (SELECT y.id FROM public.digest_runs y JOIN public.tenants_registry tr ON tr.id = y.tenant_id AND tr.lifecycle_state <> 'live'
                   WHERE y.state = 'queued' FOR UPDATE OF y SKIP LOCKED);
  FOR r IN SELECT x.* FROM public.digest_runs x JOIN public.tenants_registry tr ON tr.id = x.tenant_id AND tr.lifecycle_state = 'live'
            WHERE x.state = 'queued' ORDER BY x.created_at, x.id LIMIT p_limit FOR UPDATE OF x SKIP LOCKED LOOP
    UPDATE public.digest_runs SET state = 'leased', lease_gen = lease_gen + 1, lease_until = v_clock + public.digest_lease(), attempts = attempts + 1
     WHERE tenant_id = r.tenant_id AND id = r.id;
    v_out := v_out || jsonb_build_object('id', r.id, 'tenant_id', r.tenant_id, 'business_date', r.business_date, 'gen', r.lease_gen + 1);
  END LOOP;
  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_claim(timestamptz, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.digest_claim(timestamptz, integer) TO clinic_app;--> statement-breakpoint

-- The fence shared by the worker calls: the run exists, its generation is EXACTLY p_lease_gen (NULL never matches), it is held, and its lease
-- has not run out at p_clock. NULL-strict: every comparison is IS DISTINCT FROM / IS NOT TRUE, so SQL UNKNOWN can never skip it.
CREATE FUNCTION public.digest_held(r public.digest_runs, p_lease_gen integer, p_clock timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT r.id IS NOT NULL AND p_lease_gen IS NOT NULL AND r.lease_gen IS NOT DISTINCT FROM p_lease_gen
     AND r.state IN ('leased','dispatching') AND (r.lease_until > p_clock) IS TRUE
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_held(public.digest_runs, integer, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- ── digest_dispatch (worker, unbound only): the authorization of ONE send, in its own short transaction, immediately before the port call.
-- Order: lock the run row, take the tenant's staff_access lock (the owner's setting command and lifecycle changes take it), THEN read the
-- database clock — lease, current SET-37 / lifecycle and the renewed lease are all judged on that fresh instant.
-- 1. Fence (digest_held): this generation, held, unexpired → else 40001 (a stale worker never passes).
-- 2. {mode: 'recover'}: a receipt is already recorded — the worker completes 'sent' and never calls the port; authority is not re-checked.
-- 3. A generation dispatches at most once: a repeat by the same generation is 40001 (no second authorized send).
-- 4. p_refusal (the composer / delivery refused this digest before any send) → refused:<code> if the run was never dispatched, else
--    unconfirmed:<code> (an earlier generation may have delivered). (A receipt is handled in 2: it always wins.)
-- 5. Send-time authority: live (else not_live), SET-37 on (opted_out / invalid_setting), recipients = the run's roles still in the current
--    `penerima` (none left: no_recipients) → closes the run refused:<reason> if never dispatched, unconfirmed:<reason> if it was.
-- 6. {mode: 'send', recipients}: the generation is recorded in dispatched_gens (append-only), dispatched_at set, the run `dispatching`, the
--    lease renewed from the fresh clock. A retry of an unconfirmed run sends again with the SAME digestKey (the provider dedups by contract). ──
CREATE FUNCTION public.digest_dispatch(p_run_id uuid, p_lease_gen integer, p_refusal text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_clock timestamptz;
  v_t uuid;
  r public.digest_runs;
  o record;
  v_roles text[];
  v_reason text;
BEGIN
  PERFORM public.digest_unbound();
  IF p_lease_gen IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: run and generation are required' USING ERRCODE = '22023';
  END IF;
  IF p_refusal IS NOT NULL AND p_refusal !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refusal' USING ERRCODE = '22023';
  END IF;
  SELECT x.tenant_id INTO v_t FROM public.digest_runs x WHERE x.id = p_run_id;
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: stale or expired digest lease' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO r FROM public.digest_runs x WHERE x.id = p_run_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || v_t::text, 0));
  v_clock := clock_timestamp();  -- after both locks: every judgement below uses this instant
  IF public.digest_held(r, p_lease_gen, v_clock) IS NOT TRUE THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: stale or expired digest lease' USING ERRCODE = '40001';
  END IF;
  IF r.delivered_at IS NOT NULL THEN
    RETURN jsonb_build_object('mode', 'recover');
  END IF;
  IF p_lease_gen = ANY (r.dispatched_gens) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: this generation already dispatched' USING ERRCODE = '40001';
  END IF;
  IF p_refusal IS NOT NULL THEN
    v_reason := p_refusal;
  ELSIF NOT EXISTS (SELECT 1 FROM public.tenants_registry tr WHERE tr.id = r.tenant_id AND tr.lifecycle_state = 'live') THEN
    v_reason := 'not_live';
  ELSE
    o := public.digest_opt_in(r.tenant_id, v_clock);
    IF o.state IS NOT DISTINCT FROM 'out' THEN v_reason := 'opted_out';
    ELSIF o.state IS DISTINCT FROM 'in' THEN v_reason := 'invalid_setting';
    ELSE
      v_roles := ARRAY(SELECT x FROM unnest(r.recipients) WITH ORDINALITY u(x, i) WHERE x = ANY (o.roles) ORDER BY i);
      IF coalesce(cardinality(v_roles), 0) = 0 THEN v_reason := 'no_recipients'; END IF;
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    v_reason := CASE WHEN cardinality(r.dispatched_gens) = 0 THEN 'refused:' ELSE 'unconfirmed:' END || v_reason;
    UPDATE public.digest_runs SET state = 'done', lease_until = NULL, outcome = v_reason, finished_at = v_clock
     WHERE tenant_id = r.tenant_id AND id = r.id;
    RETURN jsonb_build_object('mode', 'closed', 'outcome', v_reason);
  END IF;
  UPDATE public.digest_runs SET state = 'dispatching', dispatched_at = v_clock, dispatched_gens = dispatched_gens || p_lease_gen,
         lease_until = v_clock + public.digest_lease()
   WHERE tenant_id = r.tenant_id AND id = r.id;
  RETURN jsonb_build_object('mode', 'send', 'recipients', to_jsonb(v_roles));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_dispatch(uuid, integer, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.digest_dispatch(uuid, integer, text) TO clinic_app;--> statement-breakpoint

-- ── digest_delivered (worker, unbound only): records that the port ACCEPTED the digest — the receipt, in its own transaction, before the
-- completion. Accepted from any generation that DISPATCHED this run (p_lease_gen ∈ dispatched_gens: a late acceptance by a worker whose
-- lease ran out is still a fact). A run that is QUEUED (its lease was reaped) or closed 'unconfirmed:*' is finished as 'sent' in the same
-- statement (no receipted row stays queued; unconfirmed → sent is the only allowed change of a terminal outcome); a run still held keeps
-- its lease for the holder's completion. Never over 'refused:*' (that run was never dispatched) and never by a generation that did not
-- dispatch. The same reference again is a no-op; a different one is refused (40001). NULL-strict. ──
CREATE FUNCTION public.digest_delivered(p_run_id uuid, p_lease_gen integer, p_provider_ref text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.digest_runs;
BEGIN
  PERFORM public.digest_unbound();
  IF p_run_id IS NULL OR p_lease_gen IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: run and generation are required' USING ERRCODE = '22023';
  END IF;
  IF p_provider_ref IS NULL OR p_provider_ref !~ '^[A-Za-z0-9_.:-]{1,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: provider reference' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.digest_runs x WHERE x.id = p_run_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: digest run' USING ERRCODE = 'P0002';
  END IF;
  IF r.delivered_at IS NOT NULL AND r.provider_ref IS NOT DISTINCT FROM p_provider_ref THEN
    RETURN 'recorded';
  END IF;
  IF r.delivered_at IS NOT NULL OR (p_lease_gen = ANY (r.dispatched_gens)) IS NOT TRUE
     OR (r.state = 'done' AND r.outcome NOT LIKE 'unconfirmed:%') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no dispatch of this generation to record' USING ERRCODE = '40001';
  END IF;
  IF r.state IN ('done','queued') THEN
    UPDATE public.digest_runs SET delivered_at = clock_timestamp(), provider_ref = p_provider_ref, state = 'done', outcome = 'sent',
           finished_at = coalesce(finished_at, clock_timestamp())
     WHERE tenant_id = r.tenant_id AND id = r.id;
    RETURN CASE WHEN r.state = 'done' THEN 'upgraded' ELSE 'finished' END;
  END IF;
  UPDATE public.digest_runs SET delivered_at = clock_timestamp(), provider_ref = p_provider_ref WHERE tenant_id = r.tenant_id AND id = r.id;
  RETURN 'recorded';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_delivered(uuid, integer, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.digest_delivered(uuid, integer, text) TO clinic_app;--> statement-breakpoint

-- ── digest_complete (worker, unbound only): finishes the run held with this generation. 'sent' only with a recorded receipt.
-- A port refusal ('refused:<code>', before acceptance) on a dispatched run — including its FIRST generation — is written as
-- 'unconfirmed:<code>': terminal for the day (owner policy), never 'refused:*' (reserved for runs never dispatched). Never over a receipt. A replay of the
-- same completion answers the stored outcome ('sent' also when the reaper finished it); anything else is 40001. NULL-strict. ──
CREATE FUNCTION public.digest_complete(p_run_id uuid, p_lease_gen integer, p_outcome text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.digest_runs;
  v_out text;
BEGIN
  PERFORM public.digest_unbound();
  IF p_run_id IS NULL OR p_lease_gen IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: run and generation are required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome !~ '^(sent|refused:[a-z][a-z0-9_]{1,48})$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.digest_runs x WHERE x.id = p_run_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: digest run' USING ERRCODE = 'P0002';
  END IF;
  -- the outcome this call would write: a port refusal after an earlier generation's dispatch is unconfirmed, never refused
  v_out := CASE WHEN p_outcome = 'sent' THEN 'sent'
                WHEN cardinality(r.dispatched_gens) <> 0 THEN 'unconfirmed:' || substr(p_outcome, 9)
                ELSE p_outcome END;
  IF r.state = 'done' AND r.outcome IS NOT DISTINCT FROM v_out AND (r.lease_gen IS NOT DISTINCT FROM p_lease_gen OR v_out = 'sent') THEN
    RETURN r.outcome;
  END IF;
  -- the generation is the fence (a worker whose lease ran out but was not re-claimed may still record what it did)
  IF (r.state IN ('leased','dispatching') AND r.lease_gen IS NOT DISTINCT FROM p_lease_gen) IS NOT TRUE THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: stale digest lease' USING ERRCODE = '40001';
  END IF;
  IF (v_out = 'sent' AND r.delivered_at IS NULL) OR (v_out <> 'sent' AND r.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the outcome contradicts the receipt' USING ERRCODE = '40001';
  END IF;
  UPDATE public.digest_runs SET state = 'done', lease_until = NULL, outcome = v_out, finished_at = clock_timestamp()
   WHERE tenant_id = r.tenant_id AND id = r.id;
  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_complete(uuid, integer, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.digest_complete(uuid, integer, text) TO clinic_app;--> statement-breakpoint

-- ── digest_facts (the claimed job only, TEN-5; the consent_active precedent: a half-bound context is not a service context). Refuses (42501)
-- unless the connection is bound exactly as the job binds (withTenantContext {tenantId, allowedBranchIds: "*", roles: []}: a tenant, every
-- branch, no active branch, no staff, no role) and that tenant's run is held with THIS generation and an unexpired lease on the wall clock,
-- the tenant live. Another tenant's run, an unknown id, a stale generation and an expired lease are the same refusal (no oracle).
-- Returns exactly the keys projectFacts reads: clinic (SET-1 nama, else the legal name), branches [{name, k1_rupiah, k2_rupiah}] (every
-- branch, earliest-created first; a branch without facts is a real 0; each at ITS local day = the run's day), and the six exception counts.
-- POLICY (confirmed by the owner, 2026-11-23): the exceptions are a snapshot at the read (as the owner screen shows them now), not the
-- state at the scheduled time; each keeps the meaning of its T-109 reader. ──
CREATE FUNCTION public.digest_facts(p_run_id uuid, p_lease_gen integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_t uuid := public.app_tenant_id();
  r public.digest_runs;
  v_sla integer;
BEGIN
  IF v_t IS NULL OR public.app_staff_id() IS NOT NULL OR coalesce(current_setting('app.roles', true), '') <> ''
     OR coalesce(current_setting('app.allowed_branch_ids', true), '') <> '*' OR coalesce(current_setting('app.active_branch_id', true), '') <> '' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: digest facts are read only by a claimed digest job' USING ERRCODE = '42501';
  END IF;
  SELECT x.* INTO r FROM public.digest_runs x JOIN public.tenants_registry tr ON tr.id = x.tenant_id AND tr.lifecycle_state = 'live'
   WHERE x.tenant_id = v_t AND x.id = p_run_id AND x.state IN ('leased','dispatching') AND x.lease_gen = p_lease_gen AND x.lease_until > v_now;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: no digest run of this tenant held with this generation' USING ERRCODE = '42501';
  END IF;
  -- SET-20 for the tenant (lead_list: setting_value_at('SET-20', NULL, now), default 15)
  v_sla := coalesce((public.followup_setting(v_t, 'SET-20', v_now) #>> '{}')::integer, 15);
  RETURN jsonb_build_object(
    'clinic', coalesce(nullif(btrim(public.followup_setting(v_t, 'SET-1', v_now) ->> 'nama'), ''), (SELECT t.legal_name FROM public.tenants t WHERE t.id = v_t)),
    'branches', coalesce((
      WITH k1 AS (SELECT f.branch_id, sum(f.amount)::bigint s FROM public.kpi_k1_facts(v_t) f WHERE f.day = r.business_date GROUP BY f.branch_id),
           k2 AS (SELECT f.branch_id, sum(f.amount)::bigint s FROM public.kpi_k2_facts(v_t) f WHERE f.day = r.business_date GROUP BY f.branch_id)
      SELECT jsonb_agg(jsonb_build_object('name', b.name, 'k1_rupiah', coalesce(k1.s, 0), 'k2_rupiah', coalesce(k2.s, 0)) ORDER BY b.created_at, b.id)
        FROM public.branches b LEFT JOIN k1 ON k1.branch_id = b.id LEFT JOIN k2 ON k2.branch_id = b.id
       WHERE b.tenant_id = v_t), '[]'::jsonb),
    'exceptions', jsonb_build_object(
      -- persetujuan: listInbox('owner') (src/modules/approvals/inbox.ts:112-127): pending approvals of the types the owner decides (approval_types
      -- approver_roles; tests/approvals/inbox.test.ts keeps the TS registry equal to these rows); the clinical drafts only while no facility head
      -- other than the requester could decide (approval_owner_decides_fh, 0036:518); the BHP review only while no pharmacist could (0055:163)
      'approvals', (SELECT count(*) FROM public.approvals a JOIN public.approval_types ty ON ty.key = a.type AND 'owner' = ANY (ty.approver_roles)
                     WHERE a.tenant_id = v_t AND a.state = 'pending'
                       AND (a.type NOT IN ('setting_change_fh','catalog_clinical_review') OR NOT public.approval_fh_available(v_t, a.id, a.requested_by))
                       AND (a.type <> 'catalog_materials_review' OR NOT public.approval_ph_available(a.id))),
      -- belum_bayar: attention.ts:41-55 + visits.ts unpaid(): open visits whose payment step is in progress or blocked, checked in before the
      -- branch's own today (both dates in the branch timezone, as visits_today, 0067:510-544)
      'unpaid_visits', (SELECT count(*) FROM public.visits v JOIN public.branches b ON b.tenant_id = v.tenant_id AND b.id = v.branch_id
                         WHERE v.tenant_id = v_t AND v.closed_at IS NULL AND v.payment IN ('in_progress','blocked')
                           AND (v.checked_in_at AT TIME ZONE b.timezone)::date < (v_now AT TIME ZONE b.timezone)::date),
      -- stok_klinis: the K18 below_min rows (0126:400-406): items whose fit quantity is below the branch minimum, now
      'low_stock', (SELECT count(*) FROM public.stock_levels l
                     WHERE l.tenant_id = v_t AND l.min_qty IS NOT NULL
                       AND coalesce((SELECT sum(public.stock_fit_qty(sb, v_now)) FROM public.stock_batches sb
                                      WHERE sb.tenant_id = l.tenant_id AND sb.branch_id = l.branch_id AND sb.item_id = l.item_id), 0) < l.min_qty),
      -- lead_sla: lead_json sla_overdue (0107:686) over every lead of the tenant (the owner reads all): new, never answered, past SET-20 minutes
      'leads_overdue', (SELECT count(*) FROM public.leads l
                         WHERE l.tenant_id = v_t AND l.stage = 'new' AND l.first_response_at IS NULL AND v_now > l.created_at + make_interval(mins => v_sla)),
      -- satusehat: satusehat_monitor links (0116:1282-1294) of every branch, status failed or exception (any reason), this environment
      'satusehat_errors', (SELECT count(*) FROM public.satusehat_links l
                            WHERE l.tenant_id = v_t AND l.environment = public.satusehat_env() AND l.status IN ('failed','exception')),
      -- kepatuhan: the compliance_register() rows whose status is 'expired' (0036:222-262): tenant items by evidence_item_status (0030:158),
      -- vendor items by the register's own CASE (approved, not open, valid_until before today in Asia/Jakarta)
      'compliance_expired', (SELECT count(*) FROM public.compliance_obligations o
                              LEFT JOIN public.evidence_items i ON o.scope = 'tenant' AND i.tenant_id = v_t AND i.obligation_key = o.key
                              LEFT JOIN public.vendor_evidence_items vi ON o.scope = 'vendor' AND vi.obligation_key = o.key
                             WHERE CASE WHEN o.scope = 'vendor' THEN NOT public.vendor_evidence_open(o.key) AND vi.state = 'approved'
                                                                   AND vi.valid_until < (now() AT TIME ZONE 'Asia/Jakarta')::date
                                        ELSE public.evidence_item_status(i.id) = 'expired' END)));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.digest_facts(uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.digest_facts(uuid, integer) TO clinic_app;
