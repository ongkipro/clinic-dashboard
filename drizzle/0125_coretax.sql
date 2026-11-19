CREATE TABLE "coretax_exports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"doc_kind" text NOT NULL,
	"sha256" text NOT NULL,
	"row_count" bigint NOT NULL,
	"tax_base_total" bigint NOT NULL,
	"vat_total" bigint NOT NULL,
	"exported_by" uuid NOT NULL,
	"exported_as" text NOT NULL,
	"exported_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "coretax_exports_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "coretax_exports_check" CHECK ("coretax_exports"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "coretax_exports"."doc_kind" in ('retail','faktur','retur','pembatalan') and "coretax_exports"."sha256" ~ '^[0-9a-f]{64}$'
      and ("coretax_exports"."doc_kind" = 'faktur' and "coretax_exports"."row_count" = 0 and "coretax_exports"."tax_base_total" = 0 and "coretax_exports"."vat_total" = 0 or "coretax_exports"."row_count" between 1 and 1000000)
      and "coretax_exports"."tax_base_total" between 0 and 1000000000000000 and "coretax_exports"."vat_total" between 0 and 1000000000000000
      and "coretax_exports"."exported_as" in ('owner','finance'))
);
--> statement-breakpoint
ALTER TABLE "coretax_exports" ADD CONSTRAINT "coretax_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coretax_exports" ADD CONSTRAINT "coretax_exports_exported_by_fk" FOREIGN KEY ("tenant_id","exported_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coretax_exports_period_idx" ON "coretax_exports" USING btree ("tenant_id","period","exported_at");--> statement-breakpoint

-- T-106 logic (generated from the parts by the task's gen.py; plan docs/tasks/T-106.md)
-- ── coretax_exports: append-only, read by owner / finance / auditor; written only by coretax_export (definer) ─────────────────────────────
CREATE TRIGGER coretax_exports_append_only BEFORE UPDATE OR DELETE ON public.coretax_exports FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.coretax_exports ENABLE ALWAYS TRIGGER coretax_exports_append_only;--> statement-breakpoint
CREATE TRIGGER coretax_exports_no_truncate BEFORE TRUNCATE ON public.coretax_exports FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.coretax_exports ENABLE ALWAYS TRIGGER coretax_exports_no_truncate;--> statement-breakpoint
ALTER TABLE public.coretax_exports ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY coretax_exports_read ON public.coretax_exports FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.ledger_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.coretax_exports TO clinic_app;--> statement-breakpoint
CREATE POLICY coretax_exports_operator_read ON public.coretax_exports FOR SELECT TO clinic_operator USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.coretax_exports', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.coretax_exports TO clinic_operator;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.coretax_exports', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'coretax_export (src/modules/accounting/coretax)', 'none (tenant tax month)');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.coretax_exports', 'money_total');--> statement-breakpoint

-- The Coretax export is its own gated feature (PR-97, A-15; Panel 2 decision 5): the same tax-advice evidence as VAT on invoices.
INSERT INTO public.feature_gates (key, obligation_key) VALUES ('coretax_export', 'tax_advice');--> statement-breakpoint

-- ── Coretax facts (internal; revoked from PUBLIC, never granted) ───────────────────────────────────────────────────────────────────────────
-- Totals are numeric (a sum of bigint facts never overflows; coretax_in_bounds decides before any cast — r2 P2). Every number below is a FROZEN fact: an invoice line's snapshot at issue (vat_base, vat_amount, tax_category, quantity, unit_price, discount)
-- on an invoice issued while the tenant was PKP (is_pkp_at_issue), or a paid refund's vat_reversed. Nothing is recomputed from today's catalog
-- or settings (Panel 2 decision 3). The months are branch-local (tax_local_date), like every tax date of the system.

-- The seller TIN: the 16-digit NPWP (a 15-digit NPWP is left-padded with '0', DJP's 16-digit TIN rule; Panel 2 decision 2).
CREATE FUNCTION public.coretax_tin(p_npwp text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_npwp ~ '^[0-9]{16}$' THEN p_npwp WHEN p_npwp ~ '^[0-9]{15}$' THEN '0' || p_npwp END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_tin(text) FROM PUBLIC;--> statement-breakpoint

-- Text placed in an element: control characters (not allowed in XML 1.0) become spaces; xmlelement escapes the rest.
CREATE FUNCTION public.coretax_txt(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_txt(text) FROM PUBLIC;--> statement-breakpoint

-- DPP Nilai Lain (PMK 131/2024): 11/12 of the base, rounded half up to whole rupiah — the DJP templates' ROUND(11/12 × DPP, 0).
CREATE FUNCTION public.coretax_other_base(p_base bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (p_base * 11 + 6) / 12
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_other_base(bigint) FROM PUBLIC;--> statement-breakpoint

-- The PKP-at-issue invoice lines of one issue month (branch-local), with a STABLE serial: YYYYMM × 10^6 + the line's ordinal among every PKP
-- line issued that month (issued_at, invoice, line) — later voids never renumber a month. info = invoice number / line ordinal on the invoice.
-- void_period: the branch-local month of the invoice's void (NULL when not voided). pending: a manual discount still awaiting approval (the
-- line's snapshot is not final yet).
CREATE FUNCTION public.coretax_lines(p_tenant uuid, p_period text)
RETURNS TABLE (line_id uuid, invoice_id uuid, serial bigint, info text, issue_date date, void_period text, void_date date, kind text, name text,
               tax_category text, quantity integer, unit_price bigint, discount bigint, line_total bigint, vat_base bigint, vat_amount bigint, pending boolean)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH l AS (
    SELECT x.*, i.number, i.issued_at, i.voided_at, i.branch_id AS ibranch, c.kind, v.name,
           public.tax_local_date(i.tenant_id, i.issued_at, i.branch_id) AS d
      FROM public.invoice_lines x
      JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
      JOIN public.catalog_items c ON c.tenant_id = x.tenant_id AND c.id = x.item_id
      JOIN public.catalog_versions v ON v.tenant_id = x.tenant_id AND v.id = x.catalog_version_id
     WHERE x.tenant_id = p_tenant AND i.is_pkp_at_issue AND i.issued_at IS NOT NULL)
  SELECT l.id, l.invoice_id,
         replace(p_period, '-', '')::bigint * 1000000 + row_number() OVER (ORDER BY l.issued_at, l.invoice_id, l.created_at, l.id),
         l.number || '/' || row_number() OVER (PARTITION BY l.invoice_id ORDER BY l.created_at, l.id),
         l.d,
         CASE WHEN l.voided_at IS NOT NULL THEN to_char(public.tax_local_date(l.tenant_id, l.voided_at, l.ibranch), 'YYYY-MM') END,
         CASE WHEN l.voided_at IS NOT NULL THEN public.tax_local_date(l.tenant_id, l.voided_at, l.ibranch) END,
         l.kind, l.name, l.tax_category, l.quantity, l.unit_price, l.discount, l.line_total, l.vat_base, l.vat_amount,
         public.discount_pending(l.tenant_id, l.id)
    FROM l WHERE to_char(l.d, 'YYYY-MM') = p_period
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_lines(uuid, text) FROM PUBLIC;--> statement-breakpoint

-- ── The four documents of a month (internal). Each returns its rows' count and totals and the exact document text. ─────────────────────────

-- 1. Faktur Pajak Keluaran digunggung (RetailInvoiceBulk; Lampiran I.A.5 Normal / I.A.9 08 / I.B NoVAT — DJP "Retail_XML Induk IA5 IA9 dan IB"):
-- one RetailInvoice per PKP line issued in the month, except the lines of an invoice voided in that same month (those go to the cancellation
-- register only). Buyer: the generic end consumer — no patient identity is read (Panel 2 decision 2, data minimisation, 13).
CREATE FUNCTION public.coretax_doc_retail(p_tenant uuid, p_tin text, p_period text, OUT n bigint, OUT base numeric, OUT vat numeric, OUT pending bigint,
                                          OUT mismatch bigint, OUT doc text)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT count(*), coalesce(sum(r.vat_base), 0), coalesce(sum(r.vat_amount), 0), count(*) FILTER (WHERE r.pending),
         -- rows whose frozen VAT differs from DJP's 12 % × DPP Nilai Lain (half up): reported, never changed (decision 3; owner/tax adviser item)
         count(*) FILTER (WHERE r.tax_category IN ('taxable_goods','taxable_service') AND r.vat_amount <> (public.coretax_other_base(r.vat_base) * 12 + 50) / 100),
         CASE WHEN count(*) > 0 THEN
           '<?xml version="1.0" encoding="utf-8"?>' || E'\n' || xmlelement(name "RetailInvoiceBulk",
             xmlattributes('http://www.w3.org/2001/XMLSchema-instance' AS "xmlns:xsi", 'schema.xsd' AS "xsi:noNamespaceSchemaLocation"),
             xmlelement(name "TIN", p_tin),
             xmlelement(name "TaxPeriodMonth", split_part(p_period, '-', 2)::integer),
             xmlelement(name "TaxPeriodYear", split_part(p_period, '-', 1)::integer),
             xmlelement(name "ListOfRetailInvoice", xmlagg(xmlelement(name "RetailInvoice",
               xmlelement(name "TrxCode", CASE r.tax_category WHEN 'exempt_medical' THEN '08' WHEN 'non_object' THEN 'NoVAT' ELSE 'Normal' END),
               xmlelement(name "BuyerName", 'Konsumen Akhir'),
               xmlelement(name "BuyerIdOpt", 'NIK'),
               xmlelement(name "BuyerIdNumber", '0000000000000000'),
               xmlelement(name "GoodServiceOpt", CASE WHEN r.tax_category = 'taxable_goods' OR r.kind IN ('product','material') THEN 'A' ELSE 'B' END),
               xmlelement(name "SerialNo", r.serial),
               xmlelement(name "TransactionDate", to_char(r.issue_date, 'YYYY-MM-DD')),
               xmlelement(name "TaxBaseSellingPrice", r.vat_base),
               xmlelement(name "OtherTaxBaseSellingPrice", CASE WHEN r.tax_category IN ('taxable_goods','taxable_service') THEN public.coretax_other_base(r.vat_base) ELSE r.vat_base END),
               xmlelement(name "VAT", r.vat_amount),
               xmlelement(name "STLG", 0),
               xmlelement(name "Info", public.coretax_txt(r.info))) ORDER BY r.serial)))::text || E'\n' END
    INTO n, base, vat, pending, mismatch, doc
    FROM public.coretax_lines(p_tenant, p_period) r
   WHERE r.void_period IS DISTINCT FROM p_period;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_doc_retail(uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- 2. Faktur Pajak Keluaran with a named buyer (TaxInvoiceBulk, DJP "Sample Faktur PK Template v.1.4"): a pure serializer of rows already in
-- DJP terms. The clinic records no buyer tax identity, so the monthly export passes no rows (every sale is the digunggung document above) and
-- the document is the STRUCTURAL envelope: TIN and an empty ListOfTaxInvoice (Panel 2 decision 2.2; r2 P1). The line → faktur mapping (net
-- unit price, rounding) waits for a buyer-identity decision and a tax adviser's rule. Element order = the sample.
-- p_rows: [{date, trx_code, buyer_tin, buyer_document, buyer_document_number, buyer_name, buyer_address, buyer_email, buyer_idtku, ref,
--           lines: [{opt, code, name, unit, price, qty, discount, tax_base, other_tax_base, vat_rate, vat}]}]
CREATE FUNCTION public.coretax_doc_faktur(p_tin text, p_rows jsonb, OUT n bigint, OUT base numeric, OUT vat numeric, OUT doc text)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH f AS (SELECT x.value AS f, x.ordinality AS o FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) WITH ORDINALITY x),
  g AS (SELECT f.o, y.value AS g, y.ordinality AS k FROM f, jsonb_array_elements(f.f -> 'lines') WITH ORDINALITY y)
  SELECT (SELECT count(*) FROM f), (SELECT coalesce(sum((g.g ->> 'tax_base')::numeric), 0) FROM g),
         (SELECT coalesce(sum((g.g ->> 'vat')::numeric), 0) FROM g),
         '<?xml version="1.0" encoding="utf-8"?>' || E'\n' || xmlelement(name "TaxInvoiceBulk",
             xmlattributes('http://www.w3.org/2001/XMLSchema-instance' AS "xmlns:xsi", 'TaxInvoice.xsd' AS "xsi:noNamespaceSchemaLocation"),
             xmlelement(name "TIN", p_tin),
             xmlelement(name "ListOfTaxInvoice", (SELECT xmlagg(xmlelement(name "TaxInvoice",
               xmlelement(name "TaxInvoiceDate", f.f ->> 'date'),
               xmlelement(name "TaxInvoiceOpt", 'Normal'),
               xmlelement(name "TrxCode", f.f ->> 'trx_code'),
               xmlelement(name "AddInfo"), xmlelement(name "CustomDoc"), xmlelement(name "CustomDocMonthYear"),
               xmlelement(name "RefDesc", public.coretax_txt(f.f ->> 'ref')),
               xmlelement(name "FacilityStamp"),
               xmlelement(name "SellerIDTKU", p_tin || '000000'),
               xmlelement(name "BuyerTin", f.f ->> 'buyer_tin'),
               xmlelement(name "BuyerDocument", f.f ->> 'buyer_document'),
               xmlelement(name "BuyerCountry", 'IND'),
               xmlelement(name "BuyerDocumentNumber", public.coretax_txt(f.f ->> 'buyer_document_number')),
               xmlelement(name "BuyerName", public.coretax_txt(f.f ->> 'buyer_name')),
               xmlelement(name "BuyerAdress", public.coretax_txt(f.f ->> 'buyer_address')),
               xmlelement(name "BuyerEmail", public.coretax_txt(f.f ->> 'buyer_email')),
               xmlelement(name "BuyerIDTKU", f.f ->> 'buyer_idtku'),
               xmlelement(name "ListOfGoodService", (SELECT xmlagg(xmlelement(name "GoodService",
                 xmlelement(name "Opt", g.g ->> 'opt'),
                 xmlelement(name "Code", g.g ->> 'code'),
                 xmlelement(name "Name", public.coretax_txt(g.g ->> 'name')),
                 xmlelement(name "Unit", g.g ->> 'unit'),
                 xmlelement(name "Price", (g.g ->> 'price')::bigint),
                 xmlelement(name "Qty", (g.g ->> 'qty')::bigint),
                 xmlelement(name "TotalDiscount", (g.g ->> 'discount')::bigint),
                 xmlelement(name "TaxBase", (g.g ->> 'tax_base')::bigint),
                 xmlelement(name "OtherTaxBase", (g.g ->> 'other_tax_base')::bigint),
                 xmlelement(name "VATRate", (g.g ->> 'vat_rate')::integer),
                 xmlelement(name "VAT", (g.g ->> 'vat')::bigint),
                 xmlelement(name "STLGRate", 0),
                 xmlelement(name "STLG", 0)) ORDER BY g.k) FROM g WHERE g.o = f.o))) ORDER BY f.o) FROM f)))::text || E'\n'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_doc_faktur(text, jsonb) FROM PUBLIC;--> statement-breakpoint

-- 3. Retur (OutputSpecialDocReturn, DJP "Retur Dok Lain Keluaran"; Panel 2 decision 4): one row per refund PAID in the month (branch-local) on
-- a line of a PKP-at-issue invoice that reversed VAT. Values from the refund's frozen facts: ReturnVAT = vat_reversed, ReturnTaxBase = amount −
-- vat_reversed. Fields per the DJP template: DocumentNumber = the document returned (the invoice number), ReturnDocumentNumber = the return's
-- own number (RTR-<refund id>), DocumentDate DD-MM-YYYY = the refund's paid date, buyer = the end consumer (BuyerTIN 0000000000000000), codes
-- = the template's own sample (TransactionType 01 delivery, DocumentType 1 normal, TransactionDetail 01, TransactionDocument 01).
CREATE FUNCTION public.coretax_doc_retur(p_tenant uuid, p_tin text, p_period text, OUT n bigint, OUT base numeric, OUT vat numeric, OUT doc text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH r AS (
    SELECT f.id, f.amount, f.vat_reversed, f.paid_at, i.number, public.tax_local_date(f.tenant_id, f.paid_at, f.branch_id) AS d
      FROM public.refunds f JOIN public.invoices i ON i.tenant_id = f.tenant_id AND i.id = f.invoice_id
     WHERE f.tenant_id = p_tenant AND f.state = 'paid' AND f.vat_reversed > 0 AND i.is_pkp_at_issue)
  SELECT count(*), coalesce(sum(r.amount - r.vat_reversed), 0), coalesce(sum(r.vat_reversed), 0),
         CASE WHEN count(*) > 0 THEN
           '<?xml version="1.0" encoding="utf-8"?>' || E'\n' || xmlelement(name "OutputSpecialDocReturn",
             xmlattributes('schema.xsd' AS "xsi:noNamespaceSchemaLocation", 'http://www.w3.org/2001/XMLSchema-instance' AS "xmlns:xsi"),
             xmlelement(name "TIN", p_tin),
             xmlelement(name "OutputReturnDataList", xmlagg(xmlelement(name "OutputReturnData",
               xmlelement(name "DocumentNumber", r.number),
               xmlelement(name "ReturnDocumentNumber", 'RTR-' || r.id::text),
               xmlelement(name "TransactionType", '01'),
               xmlelement(name "DocumentType", '1'),
               xmlelement(name "TransactionDetail", '01'),
               xmlelement(name "TransactionDocument", '01'),
               xmlelement(name "DocumentDate", to_char(r.d, 'DD-MM-YYYY')),
               xmlelement(name "BuyerTIN", '0000000000000000'),
               xmlelement(name "BuyerTaxpayerName", 'Konsumen Akhir'),
               xmlelement(name "BuyerAddress", '-'),
               xmlelement(name "ReturnTaxBase", r.amount - r.vat_reversed),
               xmlelement(name "ReturnVAT", r.vat_reversed),
               xmlelement(name "ReturnSTLG", 0)) ORDER BY r.paid_at, r.id)))::text || E'\n' END
    FROM r WHERE to_char(r.d, 'YYYY-MM') = p_period
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_doc_retur(uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- 4. Daftar pembatalan (the clinic's own register — NOT a DJP import format; Panel 2 decision 4): every line of a PKP-at-issue invoice voided
-- in the month. Reported = issued in an EARLIER month, so it is in that month's digunggung document and must be cancelled in Coretax by hand
-- (by its SerialNo); not reported = issued and voided in the same month, so it was left out of the digunggung document.
CREATE FUNCTION public.coretax_doc_pembatalan(p_tenant uuid, p_tin text, p_period text, OUT n bigint, OUT base numeric, OUT vat numeric, OUT doc text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH m AS (
    SELECT DISTINCT to_char(public.tax_local_date(i.tenant_id, i.issued_at, i.branch_id), 'YYYY-MM') AS issue_period
      FROM public.invoices i
     WHERE i.tenant_id = p_tenant AND i.is_pkp_at_issue AND i.voided_at IS NOT NULL
       AND to_char(public.tax_local_date(i.tenant_id, i.voided_at, i.branch_id), 'YYYY-MM') = p_period),
  r AS (SELECT m.issue_period, x.* FROM m, LATERAL public.coretax_lines(p_tenant, m.issue_period) x WHERE x.void_period = p_period)
  SELECT count(*), coalesce(sum(r.vat_base), 0), coalesce(sum(r.vat_amount), 0),
         CASE WHEN count(*) > 0 THEN
           '<?xml version="1.0" encoding="utf-8"?>' || E'\n' || xmlelement(name "DaftarPembatalanCoretax",
             xmlelement(name "TIN", p_tin),
             xmlelement(name "TaxPeriodMonth", split_part(p_period, '-', 2)::integer),
             xmlelement(name "TaxPeriodYear", split_part(p_period, '-', 1)::integer),
             xmlelement(name "ListOfCancellation", xmlagg(xmlelement(name "Cancellation",
               xmlelement(name "SerialNo", r.serial),
               xmlelement(name "Info", public.coretax_txt(r.info)),
               xmlelement(name "TransactionDate", to_char(r.issue_date, 'YYYY-MM-DD')),
               xmlelement(name "VoidDate", to_char(r.void_date, 'YYYY-MM-DD')),
               xmlelement(name "TaxPeriodReported", CASE WHEN r.issue_period < p_period THEN r.issue_period ELSE 'none' END),
               xmlelement(name "TaxBaseSellingPrice", r.vat_base),
               xmlelement(name "VAT", r.vat_amount)) ORDER BY r.issue_period, r.serial)))::text || E'\n' END
    FROM r
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_doc_pembatalan(uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- The supported ceiling of one document (r2, Panel 2 P2): 10^6 rows, Rp10^15 DPP and PPN — the coretax_exports check, and all far below
-- Number.MAX_SAFE_INTEGER (9,007,199,254,740,991), so every total the status and the export hand to JavaScript is exact. Above it: refused.
CREATE FUNCTION public.coretax_in_bounds(p_n bigint, p_base numeric, p_vat numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_n <= 1000000 AND p_base BETWEEN 0 AND 1000000000000000 AND p_vat BETWEEN 0 AND 1000000000000000
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_in_bounds(bigint, numeric, numeric) FROM PUBLIC;--> statement-breakpoint

-- ── The month's status and the export (granted) ──────────────────────────────────────────────────────────────────────────────────────────
-- The month's preconditions in order (the first failing one is THE reason): a valid month not in the future; the tenant's NPWP (the seller
-- TIN); PKP (the tenant is PKP now or issued PKP invoices in that month); the coretax_export gate (approved tax-advice evidence, PR-97). The
-- caller has taken feature_gate_lock first when it acts on the answer.
CREATE FUNCTION public.coretax_block(p_tenant uuid, p_period text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN p_period IS NULL OR p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR p_period < '2022-01' THEN 'bad_period'
    WHEN p_period > to_char(public.tax_local_date(p_tenant, clock_timestamp(), NULL), 'YYYY-MM') THEN 'future_period'
    WHEN public.coretax_tin((SELECT t.npwp FROM public.tenants t WHERE t.id = p_tenant)) IS NULL THEN 'npwp_missing'
    WHEN NOT coalesce((SELECT t.is_pkp FROM public.tenants t WHERE t.id = p_tenant), false)
         AND NOT EXISTS (SELECT 1 FROM public.coretax_lines(p_tenant, p_period)) THEN 'not_pkp'
    WHEN NOT public.feature_gate_open('coretax_export') THEN 'gate_closed'
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_block(uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Pajak ▸ Coretax status of a month (owner, finance, auditor): PKP facts, the gate and what it waits for, each document's row count and totals
-- (never the patient), and the export log. Read-only: no document is built for the reader beyond its counts. A document beyond the supported
-- ceiling reports bounds_exceeded and NO totals (never an inexact JavaScript number).
CREATE FUNCTION public.coretax_status(p_period text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['owner','finance','auditor']);
  t public.tenants;
  v_block text;
  v_tin text;
  rt record; rr record; rp record;
BEGIN
  IF p_period IS NULL OR p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.tenants x WHERE x.id = a.tenant_id;
  v_block := public.coretax_block(a.tenant_id, p_period);
  v_tin := coalesce(public.coretax_tin(t.npwp), '0000000000000000');
  SELECT * INTO rt FROM public.coretax_doc_retail(a.tenant_id, v_tin, p_period);
  SELECT * INTO rr FROM public.coretax_doc_retur(a.tenant_id, v_tin, p_period);
  SELECT * INTO rp FROM public.coretax_doc_pembatalan(a.tenant_id, v_tin, p_period);
  RETURN jsonb_build_object(
    'period', p_period, 'role', a.role, 'is_pkp', t.is_pkp, 'pkp_effective_from', t.pkp_effective_from, 'npwp_set', t.npwp IS NOT NULL,
    'gate_open', public.feature_gate_open('coretax_export'),
    'missing', coalesce((SELECT jsonb_agg(m.label ORDER BY m.obligation_key) FROM public.feature_gate_missing('coretax_export') m), '[]'::jsonb),
    'block', v_block,
    'docs', jsonb_build_object(
      'retail', CASE WHEN public.coretax_in_bounds(rt.n, rt.base, rt.vat)
                     THEN jsonb_build_object('n', rt.n, 'base', rt.base, 'vat', rt.vat, 'pending', rt.pending, 'mismatch', rt.mismatch, 'bounds_exceeded', false)
                     ELSE jsonb_build_object('n', 0, 'base', 0, 'vat', 0, 'pending', 0, 'mismatch', 0, 'bounds_exceeded', true) END,
      'faktur', jsonb_build_object('n', 0, 'base', 0, 'vat', 0, 'bounds_exceeded', false),
      'retur', CASE WHEN public.coretax_in_bounds(rr.n, rr.base, rr.vat) THEN jsonb_build_object('n', rr.n, 'base', rr.base, 'vat', rr.vat, 'bounds_exceeded', false)
                    ELSE jsonb_build_object('n', 0, 'base', 0, 'vat', 0, 'bounds_exceeded', true) END,
      'pembatalan', CASE WHEN public.coretax_in_bounds(rp.n, rp.base, rp.vat) THEN jsonb_build_object('n', rp.n, 'base', rp.base, 'vat', rp.vat, 'bounds_exceeded', false)
                         ELSE jsonb_build_object('n', 0, 'base', 0, 'vat', 0, 'bounds_exceeded', true) END),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('period', e.period, 'kind', e.doc_kind, 'sha256', e.sha256, 'rows', e.row_count, 'base', e.tax_base_total,
                                                           'vat', e.vat_total, 'by', s.display_name, 'at', e.exported_at) ORDER BY e.exported_at DESC, e.id DESC)
                           FROM (SELECT * FROM public.coretax_exports x WHERE x.tenant_id = a.tenant_id ORDER BY x.exported_at DESC, x.id DESC LIMIT 20) e
                           JOIN public.staff s ON s.tenant_id = e.tenant_id AND s.id = e.exported_by), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_status(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coretax_status(text) TO clinic_app;--> statement-breakpoint

-- Ekspor Coretax (owner, finance): one document of one month. Refusals are RETURNED (no raise) so their denied audit row commits; reasons:
-- bad_period, future_period, npwp_missing, not_pkp, gate_closed (with the missing evidence labels — Scenario PR-98), discount_pending (a
-- digunggung line's manual discount awaits approval: its snapshot is not final), bounds_exceeded (beyond the supported ceiling: checked
-- before the totals are returned or logged — r2 P2), empty (no rows; never for the named-buyer faktur, whose empty ListOfTaxInvoice is the
-- structural document — r2 P1). A served document is logged with the SHA-256 of its
-- exact UTF-8 bytes and audited. Nothing else is written: not invoice_lines.tax_document_ref (the NSFP comes from DJP after upload).
CREATE FUNCTION public.coretax_export(p_period text, p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['owner','finance']);
  v_block text;
  v_tin text;
  d record;
  v_sha text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('retail','faktur','retur','pembatalan') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: kind' USING ERRCODE = '22023';
  END IF;
  -- the evidence the gate reads is locked before the answer is used (PR-97: no revocation between check and export)
  PERFORM public.feature_gate_lock('coretax_export');
  v_block := public.coretax_block(a.tenant_id, p_period);
  IF v_block IS NOT NULL THEN
    PERFORM public.audit_append('export', 'coretax', NULL, 'denied', 'coretax_' || v_block);
    RETURN jsonb_build_object('refused', v_block,
      'missing', CASE WHEN v_block = 'gate_closed' THEN coalesce((SELECT jsonb_agg(m.label ORDER BY m.obligation_key) FROM public.feature_gate_missing('coretax_export') m), '[]'::jsonb) END);
  END IF;
  v_tin := public.coretax_tin((SELECT t.npwp FROM public.tenants t WHERE t.id = a.tenant_id));
  IF p_kind = 'retail' THEN
    SELECT x.n, x.base, x.vat, x.doc, x.pending INTO d FROM public.coretax_doc_retail(a.tenant_id, v_tin, p_period) x;
    IF d.pending > 0 THEN
      PERFORM public.audit_append('export', 'coretax', NULL, 'denied', 'coretax_discount_pending');
      RETURN jsonb_build_object('refused', 'discount_pending', 'count', d.pending);
    END IF;
  ELSIF p_kind = 'faktur' THEN
    -- no buyer tax identity is recorded by the clinic: the named-buyer faktur has no rows (see coretax_doc_faktur)
    SELECT x.n, x.base, x.vat, x.doc INTO d FROM public.coretax_doc_faktur(v_tin, '[]'::jsonb) x;
  ELSIF p_kind = 'retur' THEN
    SELECT x.n, x.base, x.vat, x.doc INTO d FROM public.coretax_doc_retur(a.tenant_id, v_tin, p_period) x;
  ELSE
    SELECT x.n, x.base, x.vat, x.doc INTO d FROM public.coretax_doc_pembatalan(a.tenant_id, v_tin, p_period) x;
  END IF;
  IF NOT public.coretax_in_bounds(d.n, d.base, d.vat) THEN
    PERFORM public.audit_append('export', 'coretax', NULL, 'denied', 'coretax_bounds_exceeded');
    RETURN jsonb_build_object('refused', 'bounds_exceeded');
  END IF;
  IF d.n = 0 AND p_kind <> 'faktur' THEN
    PERFORM public.audit_append('export', 'coretax', NULL, 'denied', 'coretax_empty');
    RETURN jsonb_build_object('refused', 'empty');
  END IF;
  v_sha := encode(sha256(convert_to(d.doc, 'UTF8')), 'hex');
  INSERT INTO public.coretax_exports (tenant_id, period, doc_kind, sha256, row_count, tax_base_total, vat_total, exported_by, exported_as)
  VALUES (a.tenant_id, p_period, p_kind, v_sha, d.n, d.base, d.vat, a.staff_id, a.role);
  PERFORM public.audit_append('export', 'coretax', NULL, 'success', 'coretax_' || p_kind);
  RETURN jsonb_build_object('doc', d.doc, 'sha256', v_sha, 'rows', d.n, 'base', d.base, 'vat', d.vat);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.coretax_export(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coretax_export(text, text) TO clinic_app;
