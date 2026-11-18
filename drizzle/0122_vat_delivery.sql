ALTER TABLE "vat_events" DROP CONSTRAINT "vat_events_check";--> statement-breakpoint
ALTER TABLE "vat_events" ADD CONSTRAINT "vat_events_check" CHECK ("vat_events"."delta" <> 0 and "vat_events"."object_kind" in ('line','package','session','deposit') and "vat_events"."cause" in ('session_delivery','receivable_convert','interrupted','package_close_line','package_close_package','package_sync_reversal','deposit_apply','session_attribution','line_delivery','line_void'));--> statement-breakpoint

-- HYG-023 logic (generated from the parts by the task's gen.py; plan docs/tasks/HYG-023.md)
-- ── HYG-023 (A-12; DEC-116; Panel 2 Q1–Q5 2026-11-18): VAT at delivery when delivery precedes payment ──
-- A line delivered (an addition counted, a consultation charged) recognises the VAT of the delivered share that is not recognised yet:
-- target = round half up (vat_amount × delivered ÷ line quantity) — kasir_record_payment's rounding — and d = greatest(0, target −
-- vat_recognised_amount) (monotone), so a later payment adds only the remainder and a receivable conversion records 0. Only a line of an
-- issued PKP-at-issue invoice with VAT (vat_amount > 0 implies the vat_on_invoices gate was open at issue), never while its manual
-- discount waits for a decision (the decision rewrites vat_amount and refuses a line with recognised VAT). The line keeps the true tax
-- point (`vat_recognised_at`, the earlier of payment or delivery); the vat_events row is effective no earlier than the tenant's cutover
-- (T-104 readers keep events from the cutover on; a delivery before it billed after it would otherwise drop out — Panel 2 Q3).
-- Not granted: called by the writers below only. Returns d.
CREATE FUNCTION public.vat_line_deliver(p_tenant uuid, p_line uuid, p_num bigint, p_den bigint, p_at timestamptz, p_source uuid) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  v_target bigint;
  v_d bigint;
BEGIN
  SELECT x.* INTO l FROM public.invoice_lines x JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
   WHERE x.tenant_id = p_tenant AND x.id = p_line AND i.state = 'issued' AND i.is_pkp_at_issue FOR UPDATE OF x;
  IF l.id IS NULL OR l.vat_amount <= 0 OR p_num <= 0 OR p_den <= 0 OR p_at IS NULL OR public.discount_pending(l.tenant_id, l.id) THEN
    RETURN 0;
  END IF;
  v_target := floor((l.vat_amount::numeric * least(p_num, p_den)::numeric * 2 + p_den::numeric) / (2 * p_den::numeric))::bigint;
  v_d := greatest(0, v_target - l.vat_recognised_amount);
  IF v_d > 0 THEN
    UPDATE public.invoice_lines SET vat_recognised_amount = vat_recognised_amount + v_d, vat_recognised_at = coalesce(vat_recognised_at, p_at)
     WHERE tenant_id = l.tenant_id AND id = l.id;
    INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
    VALUES (l.tenant_id, l.branch_id, 'line', l.id, v_d,
            greatest(p_at, coalesce((SELECT c.cutover_at FROM public.vat_cutovers c WHERE c.tenant_id = l.tenant_id), p_at)), 'line_delivery', p_source);
  END IF;
  RETURN v_d;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vat_line_deliver(uuid, uuid, bigint, bigint, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint

-- ── HYG-023 seams: each writer re-created with ONE added, marked block (drift-pinned: tests/db/vat-delivery-drift.test.ts) ──

-- treatment_finish (re-created from 0091_packages.sql): an addition delivered on an issued line recognises its VAT (HYG-023).
CREATE OR REPLACE FUNCTION public.treatment_finish(p_key text, p_execution uuid, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.treatment_actor();
  e public.treatment_executions := public.treatment_execution_locked(a.tenant_id, a.branch_id, p_execution);
  r public.material_requests;
  v_outcome text := p ->> 'outcome';
  v_reason text := NULLIF(btrim(coalesce(p ->> 'reason', '')), '');
  v_lines jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_outcome IS NULL OR v_outcome NOT IN ('completed','medical_stop','clinic_stop','patient_stop')
     OR (p ? 'materials' AND jsonb_typeof(p -> 'materials') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outcome' USING ERRCODE = '22023';
  END IF;
  IF (v_outcome <> 'completed') <> (v_reason IS NOT NULL) OR v_reason IS NOT NULL AND length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a stop needs its reason (3–500 characters); completion has none' USING ERRCODE = '22023';
  END IF;
  IF e.state = 'finished' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: the execution is finished' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.treatment_requests(e) x WHERE x.state = 'open') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: material_request_open' USING ERRCODE = '55000';
  END IF;
  IF p ? 'materials' AND EXISTS (SELECT 1 FROM jsonb_object_keys(p -> 'materials') k
                                  WHERE NOT EXISTS (SELECT 1 FROM public.treatment_requests(e) x WHERE x.id::text = k AND x.state = 'issued')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: materials name a request of this treatment' USING ERRCODE = '22023';
  END IF;
  BEGIN
    UPDATE public.treatment_executions SET state = 'finished', paused_at = NULL, finished_at = clock_timestamp(), finished_by = a.staff_id, finished_as = a.role,
           finish_command_key = p_key, outcome = v_outcome, stop_reason = v_reason
     WHERE tenant_id = e.tenant_id AND id = e.id;
    INSERT INTO public.treatment_execution_events (tenant_id, branch_id, visit_id, execution_id, kind, outcome, command_key, by, "as")
    VALUES (e.tenant_id, e.branch_id, e.visit_id, e.id, 'finish', v_outcome, p_key, a.staff_id, a.role);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a finish with this key exists' USING ERRCODE = '23505';
  END;
  -- The actual materials (PR-14): every issued request of the treatment not consumed yet.
  FOR r IN SELECT * FROM public.treatment_requests(e) x
            WHERE x.state = 'issued' AND NOT EXISTS (SELECT 1 FROM public.material_consumptions c WHERE c.tenant_id = x.tenant_id AND c.request_id = x.id) LOOP
    v_lines := p -> 'materials' -> r.id::text;
    PERFORM public.material_consume(encode(sha256(convert_to(p_key || ':' || r.id::text, 'UTF8')), 'hex'), r.id,
                                    CASE WHEN v_lines IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('lines', v_lines) END);
  END LOOP;
  PERFORM public.treatment_visit_step(e.tenant_id, e.visit_id);
  IF v_outcome = 'clinic_stop' AND NOT public.package_execution_covered(e.tenant_id, e.id) THEN
    UPDATE public.visits SET blocker = 'Dihentikan klinik — jadwalkan ulang atau saldo' WHERE tenant_id = e.tenant_id AND id = e.visit_id AND closed_at IS NULL;
  END IF;
  -- HYG-023 A-12 >>
  PERFORM public.vat_line_deliver(dx.tenant_id, dl.id, dt.qty, dl.quantity, dx.finished_at, dx.id)
     FROM public.treatment_executions dx JOIN public.plan_items dt ON dt.tenant_id = dx.tenant_id AND dt.id = dx.plan_item_id
     CROSS JOIN LATERAL public.addition_line(dx.tenant_id, dx.visit_id, dx.plan_item_id) dl
    WHERE dx.tenant_id = e.tenant_id AND dx.id = e.id AND dx.counted AND dl.id IS NOT NULL
      AND public.addition_of_visit(dx.tenant_id, dx.visit_id, dx.plan_item_id) AND NOT public.package_execution_covered(dx.tenant_id, dx.id);
  -- HYG-023 A-12 <<
  PERFORM public.audit_append('sign', 'treatment_execution', e.id, 'success', 'treatment_' || v_outcome);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (e.branch_id, 'TreatmentFinished', 'treatment_execution', e.id,
          jsonb_build_object('execution_id', e.id, 'visit_id', e.visit_id, 'plan_item_id', e.plan_item_id, 'outcome', v_outcome,
                             'counted', v_outcome IN ('completed','patient_stop'), 'performer_id', e.performer_staff_id));
END
$$--> statement-breakpoint

-- invoice_issue (re-created from 0097_promo.sql): an addition already performed recognises its VAT at issue (HYG-023).
CREATE OR REPLACE FUNCTION public.invoice_issue(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  v_at timestamptz := clock_timestamp();
  v_l jsonb;
  v_pkp boolean;
  v_number text;
  l record;
  v_stock uuid;
  v_addition boolean;
  t public.plan_items;
  v_package boolean;
  v_subst boolean;
  u public.package_substitutions;
  dep public.booking_deposits;
  pv public.promo_code_versions;
  v_line uuid;
  v_patient uuid;
  v_lid uuid;
  v_vid uuid;
  v_pid uuid;
  v_dsc bigint;
  v_pl uuid[] := '{}';
  v_pv uuid[] := '{}';
  v_pp uuid[] := '{}';
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF i.state <> 'draft' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF i.consultation THEN -- T-079: a consultation invoice is issued only by the consultation definers
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: consultation_invoice' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'lines' <> '{}'::jsonb OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p -> 'lines') NOT BETWEEN 1 AND 100
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'item_id' - 'quantity' - 'discount' - 'plan_item_id' - 'substitution_id' - 'promo_code' <> '{}'::jsonb
                  OR x ? 'promo_code' AND (jsonb_typeof(x -> 'promo_code') IS DISTINCT FROM 'string' OR length(btrim(x ->> 'promo_code')) NOT BETWEEN 3 AND 32)
                  OR x ? 'substitution_id' AND coalesce(x ->> 'substitution_id', '') !~ '^[0-9a-fA-F-]{36}$'
                  OR x ? 'plan_item_id' AND coalesce(x ->> 'plan_item_id', '') !~ '^[0-9a-fA-F-]{36}$'
                  OR jsonb_typeof(x -> 'quantity') IS DISTINCT FROM 'number' OR (x ->> 'quantity') !~ '^\d{1,5}$'
                  OR x ? 'discount' AND (jsonb_typeof(x -> 'discount') IS DISTINCT FROM 'number' OR (x ->> 'discount') !~ '^\d{1,13}$')
                  OR coalesce(x ->> 'item_id', '') !~ '^[0-9a-fA-F-]{36}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
  END IF;
  -- T-074 (PR-15, P1-3): an addition invoice has only addition lines (each naming its plan item), on a visit invoice.
  v_addition := EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE x ? 'plan_item_id');
  IF v_addition AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE NOT x ? 'plan_item_id') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: mixed_addition_lines' USING ERRCODE = '22023';
  END IF;
  IF v_addition AND i.visit_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: addition_on_visit_only' USING ERRCODE = '22023';
  END IF;
  IF v_addition AND (SELECT count(DISTINCT x ->> 'plan_item_id') FROM jsonb_array_elements(p -> 'lines') x) <> jsonb_array_length(p -> 'lines') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: an addition is billed once' USING ERRCODE = '22023';
  END IF;
  -- T-076 (PR-20, r1 F6, r2 F3): a package invoice is one package line (quantity 1) for the patient with no visit and no
  -- counter; a substitution invoice is one difference line; neither mixes with other lines.
  v_package := EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x JOIN public.catalog_items ci ON ci.tenant_id = i.tenant_id AND ci.id::text = x ->> 'item_id'
                        WHERE ci.kind = 'package');
  v_subst := EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE x ? 'substitution_id');
  IF (v_package OR v_subst) AND (jsonb_array_length(p -> 'lines') <> 1 OR v_addition OR v_package AND v_subst)
     OR v_package AND (i.visit_id IS NOT NULL OR i.counter OR i.patient_id IS NULL OR (p -> 'lines' -> 0 ->> 'quantity')::integer <> 1)
     OR v_subst AND (i.counter OR i.patient_id IS NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: package_invoice' USING ERRCODE = '22023';
  END IF;
  IF v_subst THEN
    SELECT * INTO u FROM public.package_substitutions x WHERE x.tenant_id = i.tenant_id AND x.id = (p -> 'lines' -> 0 ->> 'substitution_id')::uuid FOR UPDATE;
    IF u.id IS NULL OR u.state <> 'approved' OR u.difference <= 0
       OR NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = u.tenant_id AND pk.id = u.package_id AND pk.state = 'active'
                        AND public.patient_canonical(pk.tenant_id, pk.patient_id) = public.patient_canonical(i.tenant_id, i.patient_id))
       OR EXISTS (SELECT 1 FROM public.invoice_lines il JOIN public.invoices x ON x.tenant_id = il.tenant_id AND x.id = il.invoice_id
                   WHERE il.tenant_id = u.tenant_id AND il.substitution_id = u.id AND x.state = 'issued') THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: substitution not found' USING ERRCODE = 'P0002';
    END IF;
    IF (p -> 'lines' -> 0 ->> 'item_id')::uuid IS DISTINCT FROM u.new_service_item_id OR p -> 'lines' -> 0 ? 'discount' THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: substitution_line' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF i.visit_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id AND v.closed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
    END IF;
    IF NOT v_addition AND NOT v_subst AND EXISTS (SELECT 1 FROM public.invoices x WHERE x.tenant_id = i.tenant_id AND x.visit_id = i.visit_id AND x.state = 'issued'
                                   AND public.invoice_is_ordinary(x.tenant_id, x.id)) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_already_invoiced' USING ERRCODE = '55000';
    END IF;
  END IF;
  -- Each addition line: an approved addition of this visit (not removed, not in the selection), the same catalog item
  -- and quantity as its plan item, not already on an issued invoice (under the visit lock).
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x WHERE v_addition LOOP
    SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = i.tenant_id AND x.id = (v_l ->> 'plan_item_id')::uuid;
    IF t.id IS NULL OR NOT public.addition_of_visit(i.tenant_id, i.visit_id, t.id) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: addition not found' USING ERRCODE = 'P0002';
    END IF;
    IF (v_l ->> 'item_id')::uuid IS DISTINCT FROM (SELECT cv.item_id FROM public.catalog_versions cv WHERE cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id)
       OR (v_l ->> 'quantity')::integer <> t.qty THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: addition_item_or_quantity' USING ERRCODE = '22023';
    END IF;
    IF (public.addition_line(i.tenant_id, i.visit_id, t.id)).id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: addition_already_invoiced' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- T-079 (r1 P1-1): while the fee rule is active (SET-6 set) the consultation item has one path, the consultation definers.
  IF public.consultation_fee_amount(v_at) IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE public.consultation_item_is(i.tenant_id, (x ->> 'item_id')::uuid)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: consultation_item' USING ERRCODE = '22023';
  END IF;
  IF i.counter AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x
                             LEFT JOIN public.catalog_items ci ON ci.tenant_id = i.tenant_id AND ci.id = (x ->> 'item_id')::uuid
                            WHERE ci.kind IS DISTINCT FROM 'product') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: counter_products_only' USING ERRCODE = '22023';
  END IF;
  -- T-081 (PR-77, BILL-36): a line may carry a promo code (never with a manual discount, a substitution or the consultation fee,
  -- which never reaches here). Resolution refuses not_found, inactive, outside_period, branch, item (r1 P1-4 A).
  v_patient := CASE WHEN i.patient_id IS NOT NULL THEN public.patient_canonical(i.tenant_id, i.patient_id) END;
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x LOOP
    pv := NULL;
    IF v_l ? 'promo_code' THEN
      pv := public.promo_resolve(i.tenant_id, v_l ->> 'promo_code', (v_l ->> 'item_id')::uuid, i.branch_id, v_patient, v_at);
    END IF;
    v_line := public.invoice_line_snapshot(i, (v_l ->> 'item_id')::uuid, (v_l ->> 'quantity')::integer, coalesce((v_l ->> 'discount')::bigint, 0), v_at,
                                       (v_l ->> 'plan_item_id')::uuid, (v_l ->> 'substitution_id')::uuid, a.role, pv);
    IF pv.id IS NOT NULL THEN
      v_pl := v_pl || v_line; v_pv := v_pv || pv.id; v_pp := v_pp || pv.promo_id;
    END IF;
  END LOOP;
  -- The atomic quota (Done-when), one line at a time in (promo_id, line) order (no deadlock between invoices with several codes):
  -- take a use (the only exhausted check on the write path), insert the line's usage, then under the code row count the
  -- canonical patient's live uses including this one (r1 P1-4 B, r2 P3).
  FOR v_lid, v_vid, v_pid, v_dsc IN SELECT x.line_id, x.version_id, x.promo_id, pl.discount FROM unnest(v_pl, v_pv, v_pp) x(line_id, version_id, promo_id)
              JOIN public.invoice_lines pl ON pl.tenant_id = i.tenant_id AND pl.id = x.line_id ORDER BY x.promo_id, x.line_id LOOP
    PERFORM public.promo_take(i.tenant_id, v_pid);
    INSERT INTO public.promo_usages (tenant_id, branch_id, promo_id, version_id, invoice_id, invoice_line_id, patient_id, discount)
    VALUES (i.tenant_id, i.branch_id, v_pid, v_vid, i.id, v_lid, v_patient, v_dsc);
    IF EXISTS (SELECT 1 FROM public.promo_code_versions pcv WHERE pcv.tenant_id = i.tenant_id AND pcv.id = v_vid AND pcv.per_patient_limit IS NOT NULL
                 AND ((SELECT count(*) FROM public.promo_usages pu WHERE pu.tenant_id = i.tenant_id AND pu.promo_id = v_pid
                        AND pu.state IN ('reserved','consumed') AND public.patient_canonical(pu.tenant_id, pu.patient_id) = v_patient) > pcv.per_patient_limit)) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: promo_patient_limit' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  v_pkp := public.tax_pkp_at(i.tenant_id, v_at, i.branch_id);
  v_number := public.kasir_next_number(i.tenant_id, i.branch_id, 'INV');
  UPDATE public.invoices SET state = 'issued', issued_at = v_at, issued_by = a.staff_id, issued_as = a.role, is_pkp_at_issue = v_pkp, number = v_number
   WHERE tenant_id = i.tenant_id AND id = i.id;
  IF i.counter THEN
    FOR l IN SELECT x.* FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id ORDER BY x.created_at, x.id LOOP
      IF public.pharmacy_special(i.tenant_id, l.item_id) THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: special_item' USING ERRCODE = '22023';
      END IF;
      SELECT si.id INTO v_stock FROM public.stock_items si WHERE si.tenant_id = i.tenant_id AND si.catalog_item_id = l.item_id AND si.active;
      IF v_stock IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: product_without_stock_item' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.dispensings (tenant_id, branch_id, visit_id, patient_id, invoice_line_id, stock_item_id, quantity)
      VALUES (i.tenant_id, i.branch_id, NULL, i.patient_id, l.id, v_stock, l.quantity);
    END LOOP;
  END IF;
  -- T-080: a package line whose discount waits for approval opens its package at the decision (discount_sync); the issue-time
  -- checks still run now so a decision cannot fail on them.
  IF v_package AND EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id AND public.discount_pending(x.tenant_id, x.id)) THEN
    PERFORM public.package_check_open(i, v_at);
  ELSIF v_package THEN
    PERFORM public.package_open(i, a.staff_id, a.role, v_at);
  END IF;
  -- T-077 (scenario 6e): an ordinary visit invoice receives the held DP of the visit's appointment on its booked item's line.
  IF i.visit_id IS NOT NULL AND NOT v_addition AND NOT v_subst THEN
    SELECT dd.* INTO dep FROM public.booking_deposits dd JOIN public.visits vv ON vv.tenant_id = dd.tenant_id AND vv.appointment_id = dd.appointment_id
     WHERE dd.tenant_id = i.tenant_id AND vv.id = i.visit_id AND dd.state = 'held' FOR UPDATE OF dd;
    IF dep.id IS NOT NULL THEN
      SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = i.tenant_id AND x.id = i.id;
      PERFORM public.deposit_apply_do(i, dep, a.staff_id, a.role);
    END IF;
  END IF;
  -- HYG-023 A-12 >>
  PERFORM public.vat_line_deliver(dl.tenant_id, dl.id, dt.qty, dl.quantity, dx.finished_at, dx.id)
     FROM public.invoice_lines dl JOIN public.plan_items dt ON dt.tenant_id = dl.tenant_id AND dt.id = dl.plan_item_id
     CROSS JOIN LATERAL (SELECT e2.id, e2.finished_at FROM public.treatment_executions e2
                          WHERE e2.tenant_id = dl.tenant_id AND e2.visit_id = i.visit_id AND e2.plan_item_id = dl.plan_item_id AND e2.state = 'finished'
                            AND e2.counted AND NOT public.package_execution_covered(e2.tenant_id, e2.id)
                          ORDER BY e2.finished_at, e2.id LIMIT 1) dx
    WHERE v_addition AND dl.tenant_id = i.tenant_id AND dl.invoice_id = i.id;
  -- HYG-023 A-12 <<
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceIssued', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'branch_id', i.branch_id));
  PERFORM public.audit_append('settings_change', 'invoice', i.id, 'success', 'invoice_issued');
  RETURN jsonb_build_object('invoice_id', i.id, 'issued_at', v_at, 'is_pkp_at_issue', v_pkp, 'number', v_number,
    'total', (SELECT sum(x.line_total) FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id),
    'discount_pending', (SELECT count(*) FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id AND public.discount_pending(x.tenant_id, x.id)),
    'promo_lines', (SELECT count(*) FROM public.promo_usages pu WHERE pu.tenant_id = i.tenant_id AND pu.invoice_id = i.id));
END
$$--> statement-breakpoint

-- consultation_invoice_issue (re-created from 0095_consultation.sql): the fee line's VAT at the charge (HYG-023).
CREATE OR REPLACE FUNCTION public.consultation_invoice_issue(v public.visits, p_item uuid, p_amount bigint, p_key text, p_staff uuid, p_role text, p_at timestamptz,
                                                  OUT o_invoice uuid, OUT o_line uuid, OUT o_number text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  cv public.catalog_versions;
  v_pkp boolean := public.tax_pkp_at(v.tenant_id, p_at, v.branch_id);
  v_split record;
BEGIN
  SELECT x.* INTO cv FROM public.catalog_versions x WHERE x.tenant_id = v.tenant_id AND x.item_id = p_item AND x.state = 'active';
  IF cv.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: consultation_item' USING ERRCODE = '55000';
  END IF;
  IF v_pkp AND cv.tax_category IN ('taxable_service','taxable_goods') THEN
    PERFORM public.feature_gate_lock('vat_on_invoices');
    IF NOT public.feature_gate_open('vat_on_invoices') THEN
      RAISE EXCEPTION 'ERR_GATE_CLOSED: vat_on_invoices' USING ERRCODE = '42501';
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.invoices (tenant_id, branch_id, sold_branch_id, patient_id, visit_id, consultation, command_key, created_by, created_as)
    VALUES (v.tenant_id, v.branch_id, v.branch_id, v.patient_id, v.id, true, p_key, p_staff, p_role)
    RETURNING id INTO o_invoice;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an invoice with this key exists' USING ERRCODE = '23505';
  END;
  SELECT * INTO v_split FROM public.tax_vat_split(p_amount, cv.tax_category, v_pkp);
  PERFORM public.catalog_version_reference(cv.id);
  INSERT INTO public.invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, discount, line_total,
                                    tax_category, tax_basis, vat_base, vat_amount)
  VALUES (v.tenant_id, v.branch_id, o_invoice, p_item, cv.id, 1, p_amount, 0, p_amount, cv.tax_category, cv.tax_basis, v_split.base, v_split.vat)
  RETURNING id INTO o_line;
  o_number := public.kasir_next_number(v.tenant_id, v.branch_id, 'INV');
  UPDATE public.invoices SET state = 'issued', issued_at = p_at, issued_by = p_staff, issued_as = p_role, is_pkp_at_issue = v_pkp, number = o_number
   WHERE tenant_id = v.tenant_id AND id = o_invoice;
  -- HYG-023 A-12 >>
  PERFORM public.vat_line_deliver(v.tenant_id, o_line, 1, 1, p_at, v.id);
  -- HYG-023 A-12 <<
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (v.branch_id, 'InvoiceIssued', 'invoice', o_invoice, jsonb_build_object('invoice_id', o_invoice, 'branch_id', v.branch_id));
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (v.tenant_id, v.branch_id, 'ConsultationFeeCharged', 'visit', v.id, p_staff, p_role,
          jsonb_build_object('visit_id', v.id, 'invoice_id', o_invoice, 'invoice_line_id', o_line));
END
$$--> statement-breakpoint

-- invoice_void_sync (re-created from 0097_promo.sql): a void reverses the voided lines' recognised VAT (HYG-023, Panel 2 S7).
CREATE OR REPLACE FUNCTION public.invoice_void_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.invoices;
BEGIN
  IF NEW.type <> 'invoice_void' OR NEW.subject_kind <> 'invoice' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO i FROM public.invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.subject_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NEW.state IN ('approved','rejected') AND NEW.decided_as = 'manager' AND NOT public.kasir_manager_may_void(i.tenant_id, i.id, clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner may decide this void' USING ERRCODE = '42501';
  END IF;
  IF NEW.state <> 'approved' THEN
    RETURN NULL;
  END IF;
  IF i.state <> 'issued' OR EXISTS (SELECT 1 FROM public.payments y WHERE y.tenant_id = i.tenant_id AND y.invoice_id = i.id)
     OR EXISTS (SELECT 1 FROM public.booking_deposits d JOIN public.invoice_lines l ON l.tenant_id = d.tenant_id AND l.id = d.applied_line_id
                 WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND d.state = 'applied')
     OR EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.receivable_amount > 0)
     OR EXISTS (SELECT 1 FROM public.dispensings d JOIN public.invoice_lines l ON l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id
                 WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND d.state = 'handed') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_paid' USING ERRCODE = '55000';
  END IF;
  UPDATE public.invoices SET state = 'void', void_approval_id = NEW.id, voided_at = clock_timestamp() WHERE tenant_id = i.tenant_id AND id = i.id;
  -- HYG-023 A-12 >>
  DECLARE
    v_void_at timestamptz := (SELECT x.voided_at FROM public.invoices x WHERE x.tenant_id = i.tenant_id AND x.id = i.id);
    vl record;
  BEGIN
    FOR vl IN SELECT l.id, l.branch_id, l.vat_recognised_amount - l.vat_reversed_amount AS rev FROM public.invoice_lines l
               WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.vat_recognised_amount - l.vat_reversed_amount > 0 ORDER BY l.id FOR UPDATE LOOP
      UPDATE public.invoice_lines SET vat_reversed_amount = vat_recognised_amount, vat_reversed_at = coalesce(vat_reversed_at, v_void_at)
       WHERE tenant_id = i.tenant_id AND id = vl.id;
      INSERT INTO public.vat_events (tenant_id, branch_id, object_kind, object_id, delta, effective_at, cause, source_id)
      VALUES (i.tenant_id, vl.branch_id, 'line', vl.id, -vl.rev,
              greatest(v_void_at, coalesce((SELECT c.cutover_at FROM public.vat_cutovers c WHERE c.tenant_id = i.tenant_id), v_void_at)), 'line_void', NEW.id);
    END LOOP;
  END;
  -- HYG-023 A-12 <<
  -- T-081 (BILL-36): the void releases the invoice's reserved promo uses.
  PERFORM public.promo_release(l.tenant_id, l.id, 'reserved', 'void') FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id ORDER BY l.id;
  -- T-076: the package of a voided (unpaid) package invoice is cancelled with its sessions.
  PERFORM public.package_close_do(pk, 'cancelled', 'invoice_void', NEW.decided_by, NEW.decided_as, clock_timestamp())
     FROM public.packages pk WHERE pk.tenant_id = i.tenant_id AND pk.invoice_id = i.id AND pk.state = 'active';
  -- T-073 (r1 P1-4): a pending port charge of the invoice is cancelled (a late paid webhook then waits for the balance).
  UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = i.tenant_id AND invoice_id = i.id AND state = 'pending';
  UPDATE public.dispensings d SET state = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = NEW.decided_by, cancel_reason = 'Invoice dibatalkan'
    FROM public.invoice_lines l
   WHERE d.tenant_id = i.tenant_id AND l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id AND l.invoice_id = i.id AND d.state IN ('queued','prepared');
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceVoided', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'approval_id', NEW.id));
  RETURN NULL;
END
$$--> statement-breakpoint

-- discount_sync (re-created from 0096_discounts.sql): a decided discount lets a performed addition line recognise its VAT (HYG-023, Panel 2 S8).
CREATE OR REPLACE FUNCTION public.discount_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  i public.invoices;
  v_split record;
  v_total bigint;
BEGIN
  IF NEW.type <> 'manual_discount' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.subject_id AND x.discount_approval_id = NEW.id;
  IF l.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.state IN ('approved','rejected') AND NEW.decided_as = 'manager'
     AND NOT public.discount_within_limit('manager', l.unit_price * l.quantity, NEW.amount_rupiah, clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner may decide this discount' USING ERRCODE = '42501';
  END IF;
  -- The Kasir lock hierarchy (r1 P2-5c): the visit, then the invoice, then the line.
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = l.tenant_id AND x.id = l.invoice_id;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = l.tenant_id AND x.id = l.invoice_id FOR UPDATE;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = l.tenant_id AND x.id = l.id FOR UPDATE;
  IF NEW.state = 'approved' THEN
    IF i.state <> 'issued' OR l.vat_recognised_amount <> 0 OR l.cancelled_amount <> 0 OR l.discount <> 0
       OR l.moved_to_balance <> 0 OR l.receivable_amount <> 0 OR l.tax_document_ref IS NOT NULL OR public.kasir_line_paid(l.tenant_id, l.id) <> 0
       OR EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.tenant_id = l.tenant_id AND a.invoice_line_id = l.id) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: line_changed' USING ERRCODE = '55000';
    END IF;
    v_total := l.unit_price * l.quantity - NEW.amount_rupiah;
    SELECT * INTO v_split FROM public.tax_vat_split(v_total, l.tax_category, i.is_pkp_at_issue);
    UPDATE public.invoice_lines SET discount = NEW.amount_rupiah, line_total = v_total, vat_base = v_split.base, vat_amount = v_split.vat
     WHERE tenant_id = l.tenant_id AND id = l.id;
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (l.tenant_id, l.branch_id, 'DiscountApproved', 'invoice_line', l.id, NEW.decided_by, NEW.decided_as,
            jsonb_build_object('invoice_id', i.id, 'invoice_line_id', l.id, 'approval_id', NEW.id));
  END IF;
  -- A package line's package opens at the decision, with the issue instant's prices and rules (BILL-7 on the final line_total).
  IF i.state = 'issued' AND EXISTS (SELECT 1 FROM public.catalog_items ci WHERE ci.tenant_id = l.tenant_id AND ci.id = l.item_id AND ci.kind = 'package')
     AND NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id) THEN
    SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = i.tenant_id AND x.id = i.id;
    PERFORM public.package_open(i, i.issued_by, i.issued_as, i.issued_at);
  END IF;
  -- HYG-023 A-12 >>
  PERFORM public.vat_line_deliver(dl.tenant_id, dl.id, dt.qty, dl.quantity, dx.finished_at, dx.id)
     FROM public.invoice_lines dl JOIN public.invoices di ON di.tenant_id = dl.tenant_id AND di.id = dl.invoice_id AND di.state = 'issued'
     JOIN public.plan_items dt ON dt.tenant_id = dl.tenant_id AND dt.id = dl.plan_item_id
     CROSS JOIN LATERAL (SELECT e2.id, e2.finished_at FROM public.treatment_executions e2
                          WHERE e2.tenant_id = dl.tenant_id AND e2.visit_id = di.visit_id AND e2.plan_item_id = dl.plan_item_id AND e2.state = 'finished'
                            AND e2.counted AND NOT public.package_execution_covered(e2.tenant_id, e2.id)
                          ORDER BY e2.finished_at, e2.id LIMIT 1) dx
    WHERE dl.tenant_id = l.tenant_id AND dl.id = l.id;
  -- HYG-023 A-12 <<
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  RETURN NULL;
END
$$--> statement-breakpoint
