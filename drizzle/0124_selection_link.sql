ALTER TABLE "invoice_lines" ADD COLUMN "selection_item_id" uuid;--> statement-breakpoint
CREATE INDEX "invoice_lines_selection_idx" ON "invoice_lines" USING btree ("tenant_id","selection_item_id");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_selection_key" UNIQUE("tenant_id","invoice_id","selection_item_id");--> statement-breakpoint

-- T-105 G-Q4 S1 logic (generated from the parts by s1/gen.py; plan t105 notes S1-PLAN-AND-SCOPE-REQUEST.md)
-- ── T-105 G-Q4 S1 (owner 2026-11-19): an explicit selection row → invoice line identity, captured at billing ──
-- invoice_lines.selection_item_id names the visit selection row (a product) the line bills. It is set by invoice_issue only, once, on a
-- visit (non-counter) invoice line whose item is the row's product and whose quantity equals the row's quantity; never inferred, never
-- backfilled (lines issued before 0124 stay unlinked). One live (issued) line per selection row, serialized under the visit lock.
ALTER TABLE public.invoice_lines ADD CONSTRAINT invoice_lines_selection_fk FOREIGN KEY (tenant_id, selection_item_id)
  REFERENCES public.selection_items (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint

-- The guard's one-shot permission: invoice_issue names the line it links (transaction-local), the guard allows that single NULL → id set.
CREATE FUNCTION public.app_selection_link() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NULLIF(current_setting('app.selection_link', true), '')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_selection_link() FROM PUBLIC;--> statement-breakpoint

-- invoice_lines_guard (re-created from 0097_promo.sql): the selection link is set by invoice_issue only (one marked block on insert, one on update).
CREATE OR REPLACE FUNCTION public.invoice_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice lines are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
  -- T-105 G-Q4 S1 >>
    IF NEW.selection_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'a selection link is set by invoice_issue only' USING ERRCODE = '42501';
    END IF;
  -- T-105 G-Q4 S1 <<
    IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id AND i.state = 'draft') THEN
      RAISE EXCEPTION 'lines are added to a draft invoice only' USING ERRCODE = '42501';
    END IF;
    IF NEW.plan_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id
                                                     AND i.visit_id IS NOT NULL AND NOT i.counter) THEN
      RAISE EXCEPTION 'an addition line is on a visit invoice' USING ERRCODE = '42501';
    END IF;
    IF NEW.discount_approval_id IS NOT NULL AND (NEW.discount <> 0 OR NOT EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = NEW.tenant_id
         AND ap.id = NEW.discount_approval_id AND ap.type = 'manual_discount' AND ap.subject_kind = 'invoice_line' AND ap.subject_id = NEW.id AND ap.state = 'pending'
         AND ap.amount_rupiah BETWEEN 1 AND NEW.unit_price * NEW.quantity)) THEN
      RAISE EXCEPTION 'a requested discount opens at full price with its own pending approval' USING ERRCODE = '42501';
    END IF;
    IF NEW.discount_kind = 'promo' AND (NEW.discount < 1 OR NEW.discount_approval_id IS NOT NULL OR NEW.substitution_id IS NOT NULL) THEN -- T-081
      RAISE EXCEPTION 'a promo line opens with its discount and no approval' USING ERRCODE = '42501';
    END IF;
    IF NEW.cancelled_amount <> 0 OR NEW.moved_to_balance <> 0 OR NEW.vat_reversed_amount <> 0 OR NEW.receivable_amount <> 0 THEN
      RAISE EXCEPTION 'a line opens with nothing cancelled or moved' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- T-105 G-Q4 S1 >>
  -- the link is set once, from NULL, while the invoice is still a draft (inside invoice_issue, before it is issued); then immutable
  IF NEW.selection_item_id IS DISTINCT FROM OLD.selection_item_id AND NOT (
       OLD.selection_item_id IS NULL AND public.app_selection_link() = NEW.id::text
       AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id AND i.state = 'draft')) THEN
    RAISE EXCEPTION 'an invoice line selection link is set once by invoice_issue' USING ERRCODE = '42501';
  END IF;
  -- T-105 G-Q4 S1 <<
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.invoice_id, NEW.item_id, NEW.catalog_version_id, NEW.quantity, NEW.unit_price,
      NEW.tax_category, NEW.tax_basis, NEW.created_at, NEW.plan_item_id, NEW.substitution_id, NEW.discount_kind, NEW.discount_approval_id)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.invoice_id, OLD.item_id, OLD.catalog_version_id, OLD.quantity, OLD.unit_price,
      OLD.tax_category, OLD.tax_basis, OLD.created_at, OLD.plan_item_id, OLD.substitution_id, OLD.discount_kind, OLD.discount_approval_id)
     -- T-080: discount, total and VAT change once, from 0 to the approved amount, on an untouched line
     OR (NEW.discount, NEW.line_total, NEW.vat_base, NEW.vat_amount) IS DISTINCT FROM (OLD.discount, OLD.line_total, OLD.vat_base, OLD.vat_amount)
        AND NOT coalesce(OLD.discount = 0 AND OLD.discount_approval_id IS NOT NULL AND OLD.vat_recognised_amount = 0 AND OLD.cancelled_amount = 0
                 AND OLD.moved_to_balance = 0 AND OLD.receivable_amount = 0 AND OLD.tax_document_ref IS NULL AND public.kasir_line_paid(OLD.tenant_id, OLD.id) = 0
                 AND NEW.line_total = OLD.unit_price * OLD.quantity - NEW.discount
                 AND (NEW.vat_base, NEW.vat_amount) = (SELECT s.base, s.vat FROM public.invoices iv, public.tax_vat_split(NEW.line_total, OLD.tax_category, iv.is_pkp_at_issue) s
                                                        WHERE iv.tenant_id = OLD.tenant_id AND iv.id = OLD.invoice_id)
                 AND NEW.discount = (SELECT ap.amount_rupiah FROM public.approvals ap WHERE ap.tenant_id = OLD.tenant_id AND ap.id = OLD.discount_approval_id AND ap.state = 'approved')
                 AND NOT EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.tenant_id = OLD.tenant_id AND a.invoice_line_id = OLD.id), false)
        -- (coalesce: no approved approval → the subquery is NULL, and a NULL here must refuse, not pass)
     OR OLD.cancelled_amount <> 0 AND NEW.cancelled_amount <> OLD.cancelled_amount
     OR NEW.moved_to_balance < OLD.moved_to_balance OR NEW.moved_to_balance > public.kasir_line_paid(NEW.tenant_id, NEW.id)
     -- T-078: the receivable remainder is set once, from 0, within the unpaid remainder at that moment.
     OR OLD.receivable_amount <> 0 AND NEW.receivable_amount <> OLD.receivable_amount
     OR OLD.receivable_amount = 0 AND NEW.receivable_amount > NEW.line_total - NEW.cancelled_amount - public.kasir_line_paid(NEW.tenant_id, NEW.id)
     OR NEW.vat_reversed_amount < OLD.vat_reversed_amount
     OR NEW.vat_recognised_amount < OLD.vat_recognised_amount
     OR OLD.vat_recognised_at IS NOT NULL AND NEW.vat_recognised_at IS DISTINCT FROM OLD.vat_recognised_at AND NEW.vat_recognised_amount = OLD.vat_recognised_amount
     OR OLD.tax_document_ref IS NOT NULL AND NEW.tax_document_ref IS DISTINCT FROM OLD.tax_document_ref THEN
    RAISE EXCEPTION 'an invoice line is frozen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- invoice_issue (re-created from 0122_vat_delivery.sql): a line may carry its visit selection row (two marked blocks + the payload key).
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
  -- T-105 G-Q4 S1 >>
  v_sel jsonb; -- each line's selection row id (NULL when none), in line order
  v_lines jsonb;
  v_n integer := 0;
  -- T-105 G-Q4 S1 <<
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
  -- T-105 G-Q4 S1 >>
  -- a line may name its visit selection row (validated below); the old shape check then sees the line without it
  IF jsonb_typeof(p) = 'object' AND jsonb_typeof(p -> 'lines') = 'array' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE jsonb_typeof(x) = 'object' AND x ? 'selection_item_id'
                 AND coalesce(x ->> 'selection_item_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: lines' USING ERRCODE = '22023';
    END IF;
    v_sel := (SELECT jsonb_agg(CASE WHEN jsonb_typeof(x) = 'object' THEN x ->> 'selection_item_id' END ORDER BY o) FROM jsonb_array_elements(p -> 'lines') WITH ORDINALITY y(x, o));
    p := jsonb_set(p, '{lines}', (SELECT jsonb_agg(CASE WHEN jsonb_typeof(x) = 'object' THEN x - 'selection_item_id' ELSE x END ORDER BY o)
                                    FROM jsonb_array_elements(p -> 'lines') WITH ORDINALITY y(x, o)));
    v_lines := p -> 'lines'; -- the stripped lines, by ordinal (the link is matched to the inserted line by identity of its payload object)
  END IF;
  -- T-105 G-Q4 S1 <<
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
  -- T-105 G-Q4 S1 >>
  -- A line may name the visit selection row (a product) it bills: only on an ordinary visit invoice (not counter, addition,
  -- substitution or package); the row is of this tenant, branch and visit, a product, of this catalog item, with exactly this
  -- quantity (a fractional row quantity never equals an integer line quantity: not linkable, no rounding), named once per invoice
  -- and not on another live (issued) line. Serialized by the visit lock taken above.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(v_sel, '[]'::jsonb)) z WHERE z IS NOT NULL) THEN
    IF i.visit_id IS NULL OR i.counter OR v_addition OR v_subst OR v_package THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: selection_link' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(z) <> count(DISTINCT z) FROM jsonb_array_elements_text(v_sel) z) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: selection_link_repeated' USING ERRCODE = '22023';
    END IF;
    FOR v_l, v_n IN SELECT x, o FROM jsonb_array_elements(p -> 'lines') WITH ORDINALITY y(x, o) WHERE (v_sel ->> (o - 1)::integer) IS NOT NULL LOOP
      IF NOT EXISTS (SELECT 1 FROM public.selection_items si
                      WHERE si.tenant_id = i.tenant_id AND si.branch_id = i.branch_id AND si.visit_id = i.visit_id
                        AND si.id = (v_sel ->> (v_n - 1))::uuid AND si.kind = 'product') THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: selection item not found' USING ERRCODE = 'P0002';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.selection_items si JOIN public.catalog_versions cv ON cv.tenant_id = si.tenant_id AND cv.id = si.catalog_version_id
                      WHERE si.tenant_id = i.tenant_id AND si.id = (v_sel ->> (v_n - 1))::uuid
                        AND cv.item_id = (v_l ->> 'item_id')::uuid AND si.quantity = (v_l ->> 'quantity')::numeric) THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: selection_item_or_quantity' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.invoice_lines il JOIN public.invoices x ON x.tenant_id = il.tenant_id AND x.id = il.invoice_id
                  WHERE il.tenant_id = i.tenant_id AND il.selection_item_id = (v_sel ->> (v_n - 1))::uuid AND x.state = 'issued') THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: selection_already_invoiced' USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END IF;
  -- T-105 G-Q4 S1 <<
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
  -- T-105 G-Q4 S1 >>
    -- the ordinal of this payload object (lines are distinct objects only up to equality: a repeated identical object shares no link,
    -- because a repeated selection id is refused above and two identical objects without a link need none)
    v_n := (SELECT min(o) FROM jsonb_array_elements(v_lines) WITH ORDINALITY y(x, o) WHERE x = v_l AND (v_sel ->> (o - 1)::integer) IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.invoice_lines il WHERE il.tenant_id = i.tenant_id AND il.invoice_id = i.id AND il.selection_item_id = (v_sel ->> (o - 1)::integer)::uuid));
    IF v_n IS NOT NULL THEN
      PERFORM pg_catalog.set_config('app.selection_link', v_line::text, true);
      UPDATE public.invoice_lines SET selection_item_id = (v_sel ->> (v_n - 1))::uuid WHERE tenant_id = i.tenant_id AND id = v_line;
      PERFORM pg_catalog.set_config('app.selection_link', '', true);
    END IF;
  -- T-105 G-Q4 S1 <<
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
  -- T-105 r8 G-VAT-S1 >>
  -- a linked line whose selection product was already handed over (hand-over → invoice): VAT recognised at the hand-over (r8 G-VAT-S1)
  PERFORM public.vat_line_deliver(dl.tenant_id, dl.id, ceil(dd.quantity)::bigint, dl.quantity, dd.handed_at, dd.id)
     FROM public.invoice_lines dl JOIN public.dispensings dd ON dd.tenant_id = dl.tenant_id AND dd.selection_item_id = dl.selection_item_id AND dd.state = 'handed'
    WHERE dl.tenant_id = i.tenant_id AND dl.invoice_id = i.id AND dl.selection_item_id IS NOT NULL AND dd.quantity = trunc(dd.quantity);
  -- T-105 r8 G-VAT-S1 <<
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

-- kasir_visit_lines (re-created from 0087_kasir.sql): each row's selection id (linkable products) and whether a live line bills it.
CREATE OR REPLACE FUNCTION public.kasir_visit_lines(p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  v public.visits;
BEGIN
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND v.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  -- T-105 G-Q4 S1 >>
  -- each row's id for a product a line can link exactly (integer quantity), and whether a live line bills it, in the row order of 'lines'
  IF true THEN
    RETURN jsonb_build_object('visit_id', v.id, 'branch_id', v.branch_id, 'closed', v.closed_at IS NOT NULL,
      'patient', public.kasir_patient_json(v.tenant_id, v.patient_id, a.role = 'auditor'),
      'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', cv.item_id, 'name', cv.name, 'kind', si.kind, 'quantity', ceil(si.quantity)::integer,
                                   'price', public.catalog_branch_price(cv.item_id, v.branch_id, clock_timestamp()),
                                   'selection_item_id', CASE WHEN si.kind = 'product' AND si.quantity = trunc(si.quantity) THEN si.id END,
                                   'billed', EXISTS (SELECT 1 FROM public.invoice_lines il JOIN public.invoices x ON x.tenant_id = il.tenant_id AND x.id = il.invoice_id
                                                      WHERE il.tenant_id = si.tenant_id AND il.selection_item_id = si.id AND x.state = 'issued')) ORDER BY si.id)
                           FROM public.selection_items si JOIN public.catalog_versions cv ON cv.tenant_id = si.tenant_id AND cv.id = si.catalog_version_id
                          WHERE si.tenant_id = v.tenant_id AND si.visit_id = v.id), '[]'::jsonb));
  END IF;
  -- T-105 G-Q4 S1 <<
  RETURN jsonb_build_object('visit_id', v.id, 'branch_id', v.branch_id, 'closed', v.closed_at IS NOT NULL,
    'patient', public.kasir_patient_json(v.tenant_id, v.patient_id, a.role = 'auditor'),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', cv.item_id, 'name', cv.name, 'kind', si.kind, 'quantity', ceil(si.quantity)::integer,
                                 'price', public.catalog_branch_price(cv.item_id, v.branch_id, clock_timestamp())) ORDER BY si.id)
                         FROM public.selection_items si JOIN public.catalog_versions cv ON cv.tenant_id = si.tenant_id AND cv.id = si.catalog_version_id
                        WHERE si.tenant_id = v.tenant_id AND si.visit_id = v.id), '[]'::jsonb));
END
$$;--> statement-breakpoint

-- ── T-105 G-Q4 S1 ledger: ProductHandedOver on the exact billed line (one coordinated journal, 11 :118) ──
-- A counter dispensing names its line (invoice_line_id: unchanged, key product_handed:<dispensing>). A visit selection dispensing's line is
-- the live (issued) line linked to its selection row (invoice_lines.selection_item_id, set at billing): key product_handed:<dispensing>:<line>,
-- dated handed_at; Dr paid-not-delivered / Cr product revenue (the handed share, net) + Cr VAT first recognised by this hand-over (r8:
-- line_delivery of this dispensing; the payment carries any remainder — no second VAT) and
-- Dr COGS / Cr inventory at the moving-average value, in ONE entry. No linked live line yet (handed before billing, or the line's discount
-- pending) → nothing posts; InvoiceIssued / ApprovalDecided wake the visit (ledger_wake_visit). A selection dispensing never linked (billed
-- unlinked, edited quantity, fractional row, lines before 0124, never billed) posts NOTHING — no COGS-only split, no inference: open G-Q4
-- U1–U4. The former (visit, catalog item, earliest line) inference is removed. Prescription dispensings: unchanged (not posted here).
CREATE FUNCTION public.ledger_rule_product_line(p_tenant uuid, p_dispensing uuid, p_line uuid, p_key text, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  d public.dispensings;
  l public.invoice_lines;
  v_net bigint;
  v_cogs bigint;
  v_vat bigint;
BEGIN
  SELECT * INTO d FROM public.dispensings x WHERE x.tenant_id = p_tenant AND x.id = p_dispensing;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = p_tenant AND x.id = p_line;
  IF d.id IS NULL OR l.id IS NULL OR d.state <> 'handed' OR public.discount_pending(p_tenant, l.id) THEN
    RETURN NULL;
  END IF;
  v_cogs := -coalesce((SELECT sum(mv.value) FROM public.stock_movements m JOIN public.stock_movement_values mv ON mv.tenant_id = m.tenant_id AND mv.movement_id = m.id
                        WHERE m.tenant_id = p_tenant AND m.source_kind = 'dispensing' AND m.source_id = d.id AND m.kind = 'dispense'), 0);
  v_net := floor(((l.line_total - l.vat_amount) * d.quantity) / l.quantity)::bigint;
  -- r8 G-VAT-S1: the VAT first recognised by this hand-over (line_delivery of this dispensing) is credited here; the payment carries the rest
  v_vat := coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.object_kind = 'line' AND v.object_id = l.id
                       AND v.cause = 'line_delivery' AND v.source_id = d.id), 0);
  RETURN public.ledger_post(p_tenant, 'auto', p_key, 'ProductHandedOver', 'dispensing', d.id, p_event,
    public.tax_local_date(p_tenant, d.handed_at, d.branch_id),
    jsonb_build_array(public.jl('liability_paid_not_delivered', d.branch_id, v_net + v_vat, 0), public.jl('revenue_product', d.branch_id, 0, v_net),
                      public.jl('vat_payable', d.branch_id, 0, v_vat),
                      public.jl('cogs', d.branch_id, v_cogs, 0), public.jl('inventory', d.branch_id, 0, v_cogs)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_rule_product_line(uuid, uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ledger_rule_product_handed(p_tenant uuid, p_dispensing uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  d public.dispensings;
  v_line uuid;
BEGIN
  SELECT * INTO d FROM public.dispensings x WHERE x.tenant_id = p_tenant AND x.id = p_dispensing;
  IF d.id IS NULL OR d.state <> 'handed' OR d.prescription_item_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF d.invoice_line_id IS NOT NULL THEN
    RETURN public.ledger_rule_product_line(p_tenant, d.id, d.invoice_line_id, 'product_handed:' || d.id, p_event);
  END IF;
  SELECT il.id INTO v_line FROM public.invoice_lines il JOIN public.invoices i ON i.tenant_id = il.tenant_id AND i.id = il.invoice_id
   WHERE il.tenant_id = p_tenant AND il.selection_item_id = d.selection_item_id AND i.state = 'issued';
  IF v_line IS NULL THEN
    RETURN NULL; -- not billed on a linked line (yet): woken by InvoiceIssued; never linked → open G-Q4 U1–U4
  END IF;
  RETURN public.ledger_rule_product_line(p_tenant, d.id, v_line, 'product_handed:' || d.id || ':' || v_line, p_event);
END
$$;--> statement-breakpoint

-- ledger_wake_visit (re-created from 0123): also wakes the visit's handed selection products (one marked block).
CREATE OR REPLACE FUNCTION public.ledger_wake_visit(p_tenant uuid, p_visit uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x record;
  v_last uuid;
BEGIN
  -- every finished, counted execution of the visit: the rule is idempotent per (execution, line), so a re-billed line posts once
  FOR x IN SELECT e.id FROM public.treatment_executions e
            WHERE e.tenant_id = p_tenant AND e.visit_id = p_visit AND e.state = 'finished' AND e.counted
            ORDER BY e.finished_at, e.id LOOP
    v_last := coalesce(public.ledger_rule_treatment_finished(p_tenant, x.id, NULL), v_last);
  END LOOP;
  -- T-105 G-Q4 S1 >>
  -- a handed selection product of the visit whose linked line became live (issued) or final (discount decided)
  FOR x IN SELECT d.id FROM public.dispensings d WHERE d.tenant_id = p_tenant AND d.visit_id = p_visit AND d.state = 'handed' AND d.selection_item_id IS NOT NULL
            ORDER BY d.handed_at, d.id LOOP
    v_last := coalesce(public.ledger_rule_product_handed(p_tenant, x.id, NULL), v_last);
  END LOOP;
  -- T-105 G-Q4 S1 <<
  RETURN v_last;
END
$$;--> statement-breakpoint

-- ledger_rule_reversal (re-created from 0123): InvoiceVoided also mirrors a linked line's ProductHandedOver entry (one marked block + one match).
CREATE OR REPLACE FUNCTION public.ledger_rule_reversal(p_tenant uuid, p_type text, p_id uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o record;
  v_last uuid;
  iv public.invoices;
  si public.supplier_invoices;
  cn public.supplier_credit_notes;
BEGIN
  IF p_type = 'InvoiceVoided' THEN
    SELECT * INTO iv FROM public.invoices x WHERE x.tenant_id = p_tenant AND x.id = p_id;
    -- the originals first, from their facts: a consultation fee charged on this invoice, any allocation to its lines
    PERFORM public.ledger_rule_consultation_charged(p_tenant, l.id, NULL) FROM public.invoice_lines l
      WHERE l.tenant_id = p_tenant AND l.invoice_id = iv.id ORDER BY l.id;
    PERFORM public.ledger_rule_payment_allocated(p_tenant, a.id, NULL)
       FROM public.payment_allocations a JOIN public.invoice_lines l ON l.tenant_id = a.tenant_id AND l.id = a.invoice_line_id
      WHERE a.tenant_id = p_tenant AND l.invoice_id = iv.id ORDER BY a.id;
    -- S7-DIFF = A: a line of this invoice delivered (before the void) by a counted single treatment — its (execution, line) performance entry,
    -- valued at this line, is posted from the facts first, then mirrored below. Same line match as ledger_rule_treatment_finished.
    PERFORM public.ledger_rule_treatment_line(p_tenant, x.id, l.id, NULL)
       FROM public.invoice_lines l JOIN public.treatment_executions x ON x.tenant_id = l.tenant_id AND x.visit_id = iv.visit_id
      WHERE l.tenant_id = p_tenant AND l.invoice_id = iv.id AND NOT iv.consultation AND l.substitution_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id)
        AND x.state = 'finished' AND x.counted AND x.finished_at <= iv.voided_at AND NOT public.package_execution_covered(p_tenant, x.id)
        AND (l.plan_item_id = x.plan_item_id OR l.plan_item_id IS NULL AND l.item_id = public.package_plan_service(x.tenant_id, x.plan_item_id)
                                                AND NOT public.addition_of_visit(x.tenant_id, x.visit_id, x.plan_item_id))
      ORDER BY l.id, x.id;
  -- T-105 G-Q4 S1 >>
    -- a linked line of this invoice whose selection product was handed over before the void: its coordinated entry, valued at this line,
    -- from the facts first, then mirrored below at voided_at (the re-billed line posts its own once)
    PERFORM public.ledger_rule_product_line(p_tenant, d.id, l.id, 'product_handed:' || d.id || ':' || l.id, NULL)
       FROM public.invoice_lines l JOIN public.dispensings d ON d.tenant_id = l.tenant_id AND d.selection_item_id = l.selection_item_id
      WHERE l.tenant_id = p_tenant AND l.invoice_id = iv.id AND l.selection_item_id IS NOT NULL AND d.state = 'handed' AND d.handed_at <= iv.voided_at
      ORDER BY l.id, d.id;
    FOR o IN SELECT e.id FROM public.journal_entries e
              WHERE e.tenant_id = p_tenant AND e.kind = 'auto' AND e.source_kind = 'dispensing' AND e.posting_key ~ '^product_handed:[0-9a-f-]{36}:[0-9a-f-]{36}$'
                AND right(e.posting_key, 36)::uuid IN (SELECT l.id FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_id)
              ORDER BY e.posted_at, e.id LOOP
      v_last := coalesce(public.ledger_mirror(p_tenant, o.id, 'invoice_voided:' || o.id, 'InvoiceVoided', 'invoice', p_id, p_event,
                                              public.tax_local_date(p_tenant, iv.voided_at, iv.branch_id), 'Invoice dibatalkan'), v_last);
    END LOOP;
  -- T-105 G-Q4 S1 <<
    FOR o IN SELECT e.id, e.posting_key FROM public.journal_entries e
              WHERE e.tenant_id = p_tenant AND e.kind = 'auto' AND (
                    e.source_kind = 'payment_allocation' AND e.source_id IN (SELECT a.id FROM public.payment_allocations a JOIN public.invoice_lines l ON l.tenant_id = a.tenant_id AND l.id = a.invoice_line_id
                                                                            WHERE a.tenant_id = p_tenant AND l.invoice_id = p_id)
                 OR e.source_kind = 'invoice_line' AND e.source_id IN (SELECT l.id FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_id)
                 OR e.source_kind = 'treatment_execution' AND e.posting_key ~ '^treatment_finished:[0-9a-f-]{36}:[0-9a-f-]{36}$'
                    AND right(e.posting_key, 36)::uuid IN (SELECT l.id FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_id))
              ORDER BY e.posted_at, e.id LOOP
      v_last := coalesce(public.ledger_mirror(p_tenant, o.id, 'invoice_voided:' || o.id, 'InvoiceVoided', 'invoice', p_id, p_event,
                                              public.tax_local_date(p_tenant, iv.voided_at, iv.branch_id), 'Invoice dibatalkan'), v_last);
    END LOOP;
    RETURN v_last;
  ELSIF p_type = 'SupplierInvoiceReversed' THEN
    SELECT * INTO si FROM public.supplier_invoices x WHERE x.tenant_id = p_tenant AND x.id = p_id;
    PERFORM public.ledger_rule_supplier_invoice(p_tenant, si.id, NULL);
    RETURN public.ledger_mirror(p_tenant, (SELECT e.id FROM public.journal_entries e WHERE e.tenant_id = p_tenant AND e.posting_key = 'supplier_invoice:' || si.id),
      'supplier_invoice_reversed:' || si.id, 'SupplierInvoiceReversed', 'supplier_invoice', si.id, p_event,
      public.tax_local_date(p_tenant, si.reversed_at, si.branch_id), 'Tagihan pemasok dibatalkan');
  ELSIF p_type = 'SupplierCreditReversed' THEN
    SELECT * INTO cn FROM public.supplier_credit_notes x WHERE x.tenant_id = p_tenant AND x.id = p_id;
    PERFORM public.ledger_rule_supplier_credit(p_tenant, cn.id, NULL, NULL);
    FOR o IN SELECT e.id FROM public.journal_entries e JOIN public.supplier_credit_applications x ON x.tenant_id = e.tenant_id AND e.posting_key = 'supplier_credit_applied:' || x.id
              WHERE e.tenant_id = p_tenant AND x.credit_note_id = cn.id ORDER BY e.id LOOP
      v_last := coalesce(public.ledger_mirror(p_tenant, o.id, 'supplier_credit_reversed:' || o.id, 'SupplierCreditReversed', 'supplier_credit_note', cn.id, p_event,
                                              public.tax_local_date(p_tenant, cn.reversed_at, cn.branch_id), 'Nota kredit pemasok dibatalkan'), v_last);
    END LOOP;
    RETURN v_last;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- ── T-105 G-Q4 U1–U4 (Panel 2 decision 2026-11-19, PANEL2-U1-U4-DECISION.md): the "Selisih penyerahan produk" accounting exception ──
-- A read-only count for the Buku Besar preview: visit SELECTION products physically handed over (dispensings.state = 'handed',
-- selection_item_id set) whose selection row has no exact live (issued) invoice line link today. Such a handover posts no journal (0124 rule:
-- no inference), so stock left without an accounting entry — the exception makes that visible; it decides nothing (no sale, sample, waste or
-- COGS-only journal; no VAT treatment; no operational change). Two mutually exclusive buckets:
--   fractional — the selection row quantity is not an integer (cannot be billed on an integer invoice line; U2);
--   unlinked   — an integer quantity with no live linked line (never billed, billed without the link or at an edited quantity, or billed
--                before the link existed (U1, U3, U4) — not distinguished: no durable fact says which).
-- Window: hand-over date (handed_at, branch-local day) within [p_from, p_to]; the link state is as of NOW (a line issued or voided after the
-- window changes the count; no historical as-of link state is stored). Branch: the dispensing's branch. Counter and prescription
-- dispensings are out of scope. Readers: owner, finance, auditor (the ledger_report roles); counts only — no row identity, patient, amount.
CREATE FUNCTION public.ledger_handover_exceptions(p_from date, p_to date, p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['owner','finance','auditor']);
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch' USING ERRCODE = 'P0002';
  END IF;
  RETURN (
    WITH h AS (
      SELECT (si.quantity <> trunc(si.quantity)) AS fractional
        FROM public.dispensings d JOIN public.selection_items si ON si.tenant_id = d.tenant_id AND si.id = d.selection_item_id
       WHERE d.tenant_id = a.tenant_id AND d.state = 'handed' -- the inner join on selection_items keeps visit selection rows only
         AND (p_branch IS NULL OR d.branch_id = p_branch)
         AND public.tax_local_date(d.tenant_id, d.handed_at, d.branch_id) BETWEEN p_from AND p_to
         AND NOT EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                          WHERE l.tenant_id = d.tenant_id AND l.selection_item_id = d.selection_item_id AND i.state = 'issued'))
    SELECT jsonb_build_object('from', p_from, 'to', p_to, 'branch_id', p_branch, 'as_of', clock_timestamp(),
      'fractional', (SELECT count(*) FROM h WHERE fractional), 'unlinked', (SELECT count(*) FROM h WHERE NOT fractional)));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_handover_exceptions(date, date, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_handover_exceptions(date, date, uuid) TO clinic_app;--> statement-breakpoint

-- ── T-105 r8 G-VAT-S1 (Panel 2 r7 REVISE, PANEL2-R7-REVIEW.md): delivery VAT for exact S1-linked visit products (BILL-6 earlier of payment
-- or delivery), through the existing HYG-023 mechanism only (vat_line_deliver: monotone round-half-up share, line_delivery vat_events row,
-- payment then takes the remainder). Three seams, each a marked block that only calls vat_line_deliver: the hand-over (invoice → hand-over),
-- the linking invoice issue (hand-over → invoice) and the discount decision (pending at issue). share = dispensing quantity ÷ line quantity
-- (the link requires them equal: 1/1); at = handed_at; source = the dispensing. Unlinked, fractional, counter and prescription paths: none.

-- dispense_hand_over (re-created from 0087_kasir.sql): one marked block.
CREATE OR REPLACE FUNCTION public.dispense_hand_over(p_key text, p_dispensing uuid, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.pharmacy_actor(ARRAY['pharmacist']);
  d public.dispensings := public.dispensing_locked(a.tenant_id, a.branch_id, p_dispensing);
  ck constant text[] := ARRAY['identity','validity','dose','allergy','clarification','label','counselling'];
  v_note text := NULLIF(btrim(coalesce(p ->> 'exception_note', '')), '');
  v_block text;
  v_l record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'checks' - 'exception_note' - 'batches' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'checks') IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p -> 'checks') k) <> 7
     OR EXISTS (SELECT 1 FROM unnest(ck) c WHERE jsonb_typeof(p -> 'checks' -> c) IS DISTINCT FROM 'boolean')
     OR p ? 'batches' AND (jsonb_typeof(p -> 'batches') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'batches') NOT BETWEEN 1 AND 20) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: the seven checks' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) NOT BETWEEN 3 AND 500
     OR (EXISTS (SELECT 1 FROM unnest(ck) c WHERE p -> 'checks' -> c = 'false'::jsonb)) <> (v_note IS NOT NULL) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: checks_incomplete' USING ERRCODE = '22023';
  END IF;
  IF d.state <> 'prepared' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: dispensing %', d.state USING ERRCODE = '55000';
  END IF;
  v_block := public.dispensing_blocker(d);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: %', v_block USING ERRCODE = '55000';
  END IF;
  IF d.external_use AND p -> 'checks' -> 'label' = 'true'::jsonb
     AND NOT EXISTS (SELECT 1 FROM public.labels l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id AND l.kind = 'external_use') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: label_not_printed' USING ERRCODE = '55000';
  END IF;
  -- The batches: the pharmacist's (each fit in the depot, summing to the quantity) or FEFO; aggregated per batch.
  BEGIN
    IF p ? 'batches' THEN
      IF (SELECT count(DISTINCT x ->> 'batch_id') <> count(*) OR sum((x ->> 'quantity')::numeric) <> d.quantity
            OR bool_or(NOT ((x ->> 'quantity')::numeric > 0 AND scale((x ->> 'quantity')::numeric) <= 4))
            OR bool_or(NOT EXISTS (SELECT 1 FROM public.stock_batches b WHERE b.tenant_id = d.tenant_id AND b.branch_id = d.branch_id
                                    AND b.id = (x ->> 'batch_id')::uuid AND b.item_id = d.stock_item_id))
            FROM jsonb_array_elements(p -> 'batches') x) THEN
        RAISE EXCEPTION 'ERR_INVALID_INPUT: batches' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.dispensing_lines (tenant_id, branch_id, dispensing_id, batch_id, quantity)
      SELECT d.tenant_id, d.branch_id, d.id, (x ->> 'batch_id')::uuid, (x ->> 'quantity')::numeric FROM jsonb_array_elements(p -> 'batches') x;
    ELSE
      INSERT INTO public.dispensing_lines (tenant_id, branch_id, dispensing_id, batch_id, quantity)
      SELECT d.tenant_id, d.branch_id, d.id, f.batch_id, sum(f.take) FROM public.stock_fefo_depot(d.tenant_id, d.depot_id, d.stock_item_id, d.quantity) f GROUP BY f.batch_id;
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: batches' USING ERRCODE = '22023';
  END;
  -- Lock the batches then the depot's holdings in id order (lock order), re-assert fitness, move.
  PERFORM 1 FROM public.stock_batches b WHERE b.tenant_id = d.tenant_id
     AND b.id IN (SELECT l.batch_id FROM public.dispensing_lines l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id) ORDER BY b.id FOR UPDATE;
  PERFORM 1 FROM public.batch_holdings h WHERE h.tenant_id = d.tenant_id AND h.depot_id = d.depot_id
     AND h.batch_id IN (SELECT l.batch_id FROM public.dispensing_lines l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id) ORDER BY h.id FOR UPDATE;
  FOR v_l IN SELECT * FROM public.dispensing_lines l WHERE l.tenant_id = d.tenant_id AND l.dispensing_id = d.id ORDER BY l.batch_id LOOP
    PERFORM public.stock_assert_fit_depot(d.tenant_id, v_l.batch_id, d.depot_id, v_l.quantity);
    PERFORM public.material_vial_take(d.tenant_id, v_l.batch_id, d.depot_id,
      least(v_l.quantity, coalesce((SELECT v.remaining FROM public.opened_vials v WHERE v.tenant_id = d.tenant_id AND v.batch_id = v_l.batch_id AND v.depot_id = d.depot_id
                                     AND v.state = 'open' AND public.stock_vial_unfit(v) IS NULL), 0)));
    PERFORM public.stock_move_depot(d.tenant_id, v_l.batch_id, d.depot_id, 'dispense', -v_l.quantity, NULL, 'dispensing', d.id, a.staff_id, a.role, NULL);
  END LOOP;
  BEGIN
    UPDATE public.dispensings SET state = 'handed', handed_at = clock_timestamp(), handed_by = a.staff_id, hand_key = p_key, checks = p -> 'checks', exception_note = v_note
     WHERE tenant_id = d.tenant_id AND id = d.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a handover with this key exists' USING ERRCODE = '23505';
  END;
  -- T-105 r8 G-VAT-S1 >>
  -- a visit selection product handed over: its exact linked live line recognises the delivered share's VAT now (BILL-6 earlier of payment
  -- or delivery; HYG-023 mechanism). Already paid → 0 more (the payment recognised it). Unlinked / fractional / counter / prescription: none.
  PERFORM public.vat_line_deliver(dl.tenant_id, dl.id, ceil(d.quantity)::bigint, dl.quantity, clock_timestamp(), d.id)
     FROM public.invoice_lines dl JOIN public.invoices di ON di.tenant_id = dl.tenant_id AND di.id = dl.invoice_id AND di.state = 'issued'
    WHERE d.selection_item_id IS NOT NULL AND d.quantity = trunc(d.quantity) AND dl.tenant_id = d.tenant_id AND dl.selection_item_id = d.selection_item_id;
  -- T-105 r8 G-VAT-S1 <<
  IF d.visit_id IS NOT NULL THEN
    PERFORM public.pharmacy_visit_steps(d.tenant_id, d.visit_id);
  END IF;
  PERFORM public.audit_append('sign', 'dispensing', d.id, 'success', 'dispensing_handed');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (d.branch_id, CASE WHEN d.prescription_item_id IS NOT NULL THEN 'MedicationDispensed' ELSE 'ProductHandedOver' END, 'dispensing', d.id,
          jsonb_strip_nulls(jsonb_build_object('dispensing_id', d.id, 'visit_id', d.visit_id, 'invoice_line_id', d.invoice_line_id)));
END
$$;--> statement-breakpoint

-- discount_sync (re-created from 0122_vat_delivery.sql): one marked block.
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
  -- T-105 r8 G-VAT-S1 >>
  -- a linked line whose selection product was handed over while the discount was pending: delivered at the hand-over once the price is final
  PERFORM public.vat_line_deliver(dl.tenant_id, dl.id, ceil(dd.quantity)::bigint, dl.quantity, dd.handed_at, dd.id)
     FROM public.invoice_lines dl JOIN public.invoices di ON di.tenant_id = dl.tenant_id AND di.id = dl.invoice_id AND di.state = 'issued'
     JOIN public.dispensings dd ON dd.tenant_id = dl.tenant_id AND dd.selection_item_id = dl.selection_item_id AND dd.state = 'handed'
    WHERE dl.tenant_id = l.tenant_id AND dl.id = l.id AND dl.selection_item_id IS NOT NULL AND dd.quantity = trunc(dd.quantity);
  -- T-105 r8 G-VAT-S1 <<
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  RETURN NULL;
END
$$;
