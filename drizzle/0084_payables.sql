CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"po_id" uuid,
	"depot_id" uuid NOT NULL,
	"delivery_note" text,
	"command_key" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"received_by" uuid NOT NULL,
	"received_as" text NOT NULL,
	CONSTRAINT "goods_receipts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "goods_receipts_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "goods_receipts_check" CHECK ("goods_receipts"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "goods_receipts"."received_as" in ('pharmacist','purchasing') and ("goods_receipts"."delivery_note" is null or "goods_receipts"."delivery_note" ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$'))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ordered_qty" numeric NOT NULL,
	"received_qty" numeric DEFAULT '0' NOT NULL,
	"unit_price" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "purchase_order_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_lines_item_key" UNIQUE("tenant_id","po_id","item_id"),
	CONSTRAINT "purchase_order_lines_check" CHECK ("purchase_order_lines"."ordered_qty" between 0.0001 and 1000000000 and scale("purchase_order_lines"."ordered_qty") <= 4 and "purchase_order_lines"."received_qty" between 0 and "purchase_order_lines"."ordered_qty" and scale("purchase_order_lines"."received_qty") <= 4
      and "purchase_order_lines"."unit_price" between 0 and 1000000000 and ("purchase_order_lines"."active" or "purchase_order_lines"."received_qty" = 0))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"number" text NOT NULL,
	"expected_date" text,
	"note" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"command_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_by" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "purchase_orders_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_orders_scope_key" UNIQUE("tenant_id","branch_id","supplier_id","id"),
	CONSTRAINT "purchase_orders_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "purchase_orders_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "purchase_orders_check" CHECK ("purchase_orders"."state" in ('draft','sent','partially_received','received','cancelled') and "purchase_orders"."number" ~ '^PO-[0-9]{6}-[0-9]{4,6}$' and "purchase_orders"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and ("purchase_orders"."expected_date" is null or "purchase_orders"."expected_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') and ("purchase_orders"."note" is null or length(btrim("purchase_orders"."note")) between 1 and 300)
      and (("purchase_orders"."state" = 'draft') = ("purchase_orders"."sent_at" is null) or "purchase_orders"."state" = 'cancelled')
      and (("purchase_orders"."state" = 'cancelled') = ("purchase_orders"."cancelled_at" is not null)) and (("purchase_orders"."cancelled_at" is null) = ("purchase_orders"."cancel_reason" is null)) and ("purchase_orders"."cancel_reason" is null or length(btrim("purchase_orders"."cancel_reason")) between 3 and 300))
);
--> statement-breakpoint
CREATE TABLE "supplier_credit_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	"command_key" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"applied_by" uuid NOT NULL,
	CONSTRAINT "supplier_credit_applications_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_credit_applications_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "supplier_credit_applications_check" CHECK ("supplier_credit_applications"."amount" between 1 and 1000000000000000000 and "supplier_credit_applications"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$')
);
--> statement-breakpoint
CREATE TABLE "supplier_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"number" text NOT NULL,
	"amount" bigint NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"available_amount" bigint NOT NULL,
	"source_kind" text NOT NULL,
	"return_id" uuid,
	"invoice_id" uuid,
	"issued_on" text NOT NULL,
	"state" text DEFAULT 'live' NOT NULL,
	"command_key" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_as" text NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reverse_reason" text,
	CONSTRAINT "supplier_credit_notes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_credit_notes_scope_key" UNIQUE("tenant_id","branch_id","supplier_id","id"),
	CONSTRAINT "supplier_credit_notes_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "supplier_credit_notes_return_key" UNIQUE("tenant_id","return_id"),
	CONSTRAINT "supplier_credit_notes_check" CHECK ("supplier_credit_notes"."number" ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$' and "supplier_credit_notes"."amount" between 1 and 1000000000000000000 and "supplier_credit_notes"."tax_amount" between 0 and "supplier_credit_notes"."amount"
      and "supplier_credit_notes"."available_amount" between 0 and "supplier_credit_notes"."amount" and "supplier_credit_notes"."source_kind" in ('return','invoice')
      and (("supplier_credit_notes"."source_kind" = 'return') = ("supplier_credit_notes"."return_id" is not null)) and (("supplier_credit_notes"."source_kind" = 'invoice') = ("supplier_credit_notes"."invoice_id" is not null))
      and "supplier_credit_notes"."issued_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and "supplier_credit_notes"."state" in ('live','reversed') and "supplier_credit_notes"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "supplier_credit_notes"."recorded_as" in ('purchasing','finance')
      and ("supplier_credit_notes"."state" <> 'reversed' or "supplier_credit_notes"."available_amount" = 0)
      and (("supplier_credit_notes"."state" = 'reversed') = ("supplier_credit_notes"."reversed_at" is not null)) and num_nonnulls("supplier_credit_notes"."reversed_at", "supplier_credit_notes"."reversed_by", "supplier_credit_notes"."reverse_reason") in (0, 3) and ("supplier_credit_notes"."reverse_reason" is null or length(btrim("supplier_credit_notes"."reverse_reason")) between 3 and 300))
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"receipt_id" uuid,
	"grni_amount" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "supplier_invoice_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_invoice_lines_check" CHECK ("supplier_invoice_lines"."grni_amount" between 0 and 1000000000000000000 and "supplier_invoice_lines"."amount" between 0 and 1000000000000000000)
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expense_id" uuid,
	"number" text NOT NULL,
	"invoice_date" text NOT NULL,
	"due_date" text NOT NULL,
	"total" bigint NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	"credited_amount" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"command_key" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_as" text NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reverse_reason" text,
	CONSTRAINT "supplier_invoices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_invoices_scope_key" UNIQUE("tenant_id","branch_id","supplier_id","id"),
	CONSTRAINT "supplier_invoices_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "supplier_invoices_check" CHECK ("supplier_invoices"."kind" in ('purchase','expense') and (("supplier_invoices"."kind" = 'expense') = ("supplier_invoices"."expense_id" is not null))
      and "supplier_invoices"."number" ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$' and "supplier_invoices"."invoice_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and "supplier_invoices"."due_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and "supplier_invoices"."due_date" >= "supplier_invoices"."invoice_date"
      and "supplier_invoices"."total" between 1 and 1000000000000000000 and "supplier_invoices"."paid_amount" between 0 and 1000000000000000000 and "supplier_invoices"."credited_amount" between 0 and 1000000000000000000 and "supplier_invoices"."paid_amount" + "supplier_invoices"."credited_amount" <= "supplier_invoices"."total"
      and "supplier_invoices"."state" in ('open','paid','reversed') and "supplier_invoices"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "supplier_invoices"."recorded_as" in ('purchasing','finance')
      and (("supplier_invoices"."state" = 'paid') = ("supplier_invoices"."paid_amount" + "supplier_invoices"."credited_amount" = "supplier_invoices"."total" and "supplier_invoices"."state" <> 'reversed'))
      and ("supplier_invoices"."state" <> 'reversed' or ("supplier_invoices"."paid_amount" = 0 and "supplier_invoices"."credited_amount" = 0))
      and (("supplier_invoices"."state" = 'reversed') = ("supplier_invoices"."reversed_at" is not null)) and num_nonnulls("supplier_invoices"."reversed_at", "supplier_invoices"."reversed_by", "supplier_invoices"."reverse_reason") in (0, 3) and ("supplier_invoices"."reverse_reason" is null or length(btrim("supplier_invoices"."reverse_reason")) between 3 and 300))
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	"command_key" text NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "supplier_payment_allocations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_payment_allocations_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "supplier_payment_allocations_check" CHECK ("supplier_payment_allocations"."amount" between 1 and 1000000000000000000 and "supplier_payment_allocations"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$')
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"allocated_amount" bigint DEFAULT 0 NOT NULL,
	"method" text NOT NULL,
	"paid_on" text NOT NULL,
	"reference" text,
	"state" text DEFAULT 'live' NOT NULL,
	"command_key" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"recorded_by" uuid NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reverse_reason" text,
	CONSTRAINT "supplier_payments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_payments_scope_key" UNIQUE("tenant_id","branch_id","supplier_id","id"),
	CONSTRAINT "supplier_payments_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "supplier_payments_check" CHECK ("supplier_payments"."amount" between 1 and 1000000000000000000 and "supplier_payments"."allocated_amount" between 0 and "supplier_payments"."amount" and "supplier_payments"."method" in ('cash','bank_transfer')
      and "supplier_payments"."paid_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and ("supplier_payments"."reference" is null or "supplier_payments"."reference" ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$') and "supplier_payments"."state" in ('live','reversed')
      and "supplier_payments"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and ("supplier_payments"."state" <> 'reversed' or "supplier_payments"."allocated_amount" = 0)
      and (("supplier_payments"."state" = 'reversed') = ("supplier_payments"."reversed_at" is not null)) and num_nonnulls("supplier_payments"."reversed_at", "supplier_payments"."reversed_by", "supplier_payments"."reverse_reason") in (0, 3) and ("supplier_payments"."reverse_reason" is null or length(btrim("supplier_payments"."reverse_reason")) between 3 and 300))
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_fk" FOREIGN KEY ("tenant_id","branch_id","supplier_id","po_id") REFERENCES "public"."purchase_orders"("tenant_id","branch_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_depot_fk" FOREIGN KEY ("tenant_id","branch_id","depot_id") REFERENCES "public"."depots"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_fk" FOREIGN KEY ("tenant_id","po_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."stock_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_applications" ADD CONSTRAINT "supplier_credit_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_applications" ADD CONSTRAINT "supplier_credit_applications_credit_fk" FOREIGN KEY ("tenant_id","branch_id","supplier_id","credit_note_id") REFERENCES "public"."supplier_credit_notes"("tenant_id","branch_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_applications" ADD CONSTRAINT "supplier_credit_applications_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","supplier_id","invoice_id") REFERENCES "public"."supplier_invoices"("tenant_id","branch_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_applications" ADD CONSTRAINT "supplier_credit_applications_by_fk" FOREIGN KEY ("tenant_id","applied_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_return_fk" FOREIGN KEY ("tenant_id","branch_id","supplier_id","return_id") REFERENCES "public"."supplier_returns"("tenant_id","branch_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","supplier_id","invoice_id") REFERENCES "public"."supplier_invoices"("tenant_id","branch_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."supplier_invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."supplier_receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payment_fk" FOREIGN KEY ("tenant_id","branch_id","supplier_id","payment_id") REFERENCES "public"."supplier_payments"("tenant_id","branch_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","supplier_id","invoice_id") REFERENCES "public"."supplier_invoices"("tenant_id","branch_id","supplier_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipts_branch_idx" ON "goods_receipts" USING btree ("tenant_id","branch_id","received_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_state_idx" ON "purchase_orders" USING btree ("tenant_id","branch_id","state","created_at");--> statement-breakpoint
CREATE INDEX "supplier_credit_applications_invoice_idx" ON "supplier_credit_applications" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_credit_notes_number_key" ON "supplier_credit_notes" USING btree ("tenant_id","supplier_id",lower(btrim("number")));--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_lines_receipt_open_key" ON "supplier_invoice_lines" USING btree ("tenant_id","receipt_id") WHERE receipt_id is not null and not reversed;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoices_number_key" ON "supplier_invoices" USING btree ("tenant_id","supplier_id",lower(btrim("number")));--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoices_expense_key" ON "supplier_invoices" USING btree ("tenant_id","expense_id") WHERE expense_id is not null;--> statement-breakpoint
CREATE INDEX "supplier_invoices_open_idx" ON "supplier_invoices" USING btree ("tenant_id","supplier_id","state","due_date");--> statement-breakpoint
CREATE INDEX "supplier_payment_allocations_invoice_idx" ON "supplier_payment_allocations" USING btree ("tenant_id","invoice_id");--> statement-breakpoint

-- T-067 rules (generated by gen.py; plan docs/tasks/T-067.md)
-- ── Helpers (T-067; no 0000–0083 function re-created) ─────────────────────────────────────────────────────────
-- A credit note settles a T-066 credit expectation (r1 P2-5): the expectation names it.
ALTER TABLE public.supplier_credit_expectations ADD CONSTRAINT supplier_credit_expectations_credit_note_fk
  FOREIGN KEY (tenant_id, credit_note_id) REFERENCES public.supplier_credit_notes (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint

-- The next PO number of the tenant for the branch's local month: PO-YYYYMM-NNNN (serialised by the staff_access lock
-- every writer takes first).
CREATE FUNCTION public.po_next_number(p_tenant uuid, p_branch uuid) RETURNS text
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT 'PO-' || to_char(public.stock_local_date(p_tenant, p_branch, clock_timestamp()), 'YYYYMM') || '-'
         || lpad((coalesce(max(substr(po.number, 11)::integer), 0) + 1)::text, 4, '0')
    FROM public.purchase_orders po
   WHERE po.tenant_id = p_tenant AND substr(po.number, 4, 6) = to_char(public.stock_local_date(p_tenant, p_branch, clock_timestamp()), 'YYYYMM')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.po_next_number(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A calendar date from JSON text (YYYY-MM-DD, a real date) or null.
CREATE FUNCTION public.payables_date(p text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN p::date;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payables_date(text) FROM PUBLIC;--> statement-breakpoint

-- A money amount from JSON (a JSON integer 1..1e18) or null.
CREATE FUNCTION public.payables_money(p jsonb) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'number' AND (p #>> '{}') ~ '^[0-9]{1,18}$' AND (p #>> '{}')::numeric BETWEEN 1 AND 1000000000000000000
              THEN (p #>> '{}')::bigint END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payables_money(jsonb) FROM PUBLIC;--> statement-breakpoint

-- GRNI of a supplier receipt line: quantity × unit cost in integer rupiah (as the valuation trigger, 0080).
CREATE FUNCTION public.payables_grni(r public.supplier_receipts) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT round(r.quantity * r.unit_cost)::bigint
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payables_grni(public.supplier_receipts) FROM PUBLIC;--> statement-breakpoint

-- Allocate up to p_amount of a locked live payment to one invoice (r1 P2-4): the invoice is locked here (callers
-- lock invoices in id order before calling for several), its outstanding read from the locked row; the allocation
-- takes least(requested, outstanding, unallocated). Returns the amount taken (0 when nothing is outstanding).
CREATE FUNCTION public.payables_allocate(pm public.supplier_payments, p_invoice uuid, p_amount bigint, p_key text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  inv public.supplier_invoices;
  v_take bigint;
BEGIN
  SELECT * INTO inv FROM public.supplier_invoices x WHERE x.tenant_id = pm.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF NOT FOUND OR inv.branch_id <> pm.branch_id OR inv.supplier_id <> pm.supplier_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT x.amount - x.allocated_amount INTO v_take FROM public.supplier_payments x WHERE x.tenant_id = pm.tenant_id AND x.id = pm.id;
  v_take := least(coalesce(p_amount, v_take), v_take, CASE WHEN inv.state = 'open' THEN inv.total - inv.paid_amount - inv.credited_amount ELSE 0 END);
  IF v_take <= 0 THEN
    RETURN 0;
  END IF;
  BEGIN
    INSERT INTO public.supplier_payment_allocations (tenant_id, branch_id, supplier_id, payment_id, invoice_id, amount, command_key)
    VALUES (pm.tenant_id, pm.branch_id, pm.supplier_id, pm.id, inv.id, v_take, p_key);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an allocation with this key exists' USING ERRCODE = '23505';
  END;
  UPDATE public.supplier_invoices SET paid_amount = paid_amount + v_take,
         state = CASE WHEN paid_amount + v_take + credited_amount = total THEN 'paid' ELSE 'open' END
   WHERE tenant_id = inv.tenant_id AND id = inv.id;
  UPDATE public.supplier_payments SET allocated_amount = allocated_amount + v_take WHERE tenant_id = pm.tenant_id AND id = pm.id;
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (pm.branch_id, 'SupplierPaymentAllocated', 'supplier_payment', pm.id, jsonb_build_object('payment_id', pm.id, 'invoice_id', inv.id));
  RETURN v_take;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payables_allocate(public.supplier_payments, uuid, bigint, text) FROM PUBLIC;--> statement-breakpoint

-- Allocate a locked live payment over a list of named invoices ({invoice_id, amount?}) or, when none is named, the
-- supplier's open invoices at the branch oldest due first. Named invoices are locked in id order first; a named
-- invoice with nothing outstanding is refused (r1 P2-4). Keys per invoice are derived from p_key.
CREATE FUNCTION public.payables_allocate_many(pm public.supplier_payments, p_targets jsonb, p_key text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_t record;
  v_got bigint;
  v_total bigint := 0;
BEGIN
  IF p_targets IS NOT NULL THEN
    IF jsonb_typeof(p_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_targets) NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_targets) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'invoice_id' - 'amount' <> '{}'::jsonb
                    OR coalesce(x ->> 'invoice_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    OR x ? 'amount' AND public.payables_money(x -> 'amount') IS NULL)
       OR (SELECT count(DISTINCT x ->> 'invoice_id') <> count(*) FROM jsonb_array_elements(p_targets) x) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: allocations' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.supplier_invoices i WHERE i.tenant_id = pm.tenant_id
       AND i.id IN (SELECT (x ->> 'invoice_id')::uuid FROM jsonb_array_elements(p_targets) x) ORDER BY i.id FOR UPDATE;
    FOR v_t IN SELECT (x ->> 'invoice_id')::uuid AS invoice_id, public.payables_money(x -> 'amount') AS amount
                 FROM jsonb_array_elements(p_targets) x ORDER BY (x ->> 'invoice_id') LOOP
      EXIT WHEN (SELECT x.amount - x.allocated_amount FROM public.supplier_payments x WHERE x.tenant_id = pm.tenant_id AND x.id = pm.id) = 0;
      v_got := public.payables_allocate(pm, v_t.invoice_id, v_t.amount, encode(sha256(convert_to(p_key || ':' || v_t.invoice_id::text, 'UTF8')), 'hex'));
      IF v_got = 0 THEN
        RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing_outstanding' USING ERRCODE = '55000';
      END IF;
      v_total := v_total + v_got;
    END LOOP;
  ELSE
    PERFORM 1 FROM public.supplier_invoices i WHERE i.tenant_id = pm.tenant_id AND i.branch_id = pm.branch_id AND i.supplier_id = pm.supplier_id
       AND i.state = 'open' ORDER BY i.id FOR UPDATE;
    FOR v_t IN SELECT i.id AS invoice_id FROM public.supplier_invoices i
                WHERE i.tenant_id = pm.tenant_id AND i.branch_id = pm.branch_id AND i.supplier_id = pm.supplier_id AND i.state = 'open'
                ORDER BY i.due_date, i.invoice_date, i.id LOOP
      EXIT WHEN (SELECT x.amount - x.allocated_amount FROM public.supplier_payments x WHERE x.tenant_id = pm.tenant_id AND x.id = pm.id) = 0;
      v_total := v_total + public.payables_allocate(pm, v_t.invoice_id, NULL, encode(sha256(convert_to(p_key || ':' || v_t.invoice_id::text, 'UTF8')), 'hex'));
    END LOOP;
  END IF;
  RETURN v_total;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payables_allocate_many(public.supplier_payments, jsonb, text) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY purchase_orders_read ON public.purchase_orders FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.purchase_orders TO clinic_app;--> statement-breakpoint
CREATE POLICY purchase_orders_operator_read ON public.purchase_orders FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.purchase_orders', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.purchase_orders TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER purchase_orders_no_truncate BEFORE TRUNCATE ON public.purchase_orders FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.purchase_orders ENABLE ALWAYS TRIGGER purchase_orders_no_truncate;--> statement-breakpoint
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY purchase_order_lines_read ON public.purchase_order_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, po_id, item_id, ordered_qty, received_qty, active) ON public.purchase_order_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY purchase_order_lines_operator_read ON public.purchase_order_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.purchase_order_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, po_id, item_id, ordered_qty, received_qty, active) ON public.purchase_order_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER purchase_order_lines_no_truncate BEFORE TRUNCATE ON public.purchase_order_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.purchase_order_lines ENABLE ALWAYS TRIGGER purchase_order_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY goods_receipts_read ON public.goods_receipts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.goods_receipts TO clinic_app;--> statement-breakpoint
CREATE POLICY goods_receipts_operator_read ON public.goods_receipts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.goods_receipts', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.goods_receipts TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER goods_receipts_no_truncate BEFORE TRUNCATE ON public.goods_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.goods_receipts ENABLE ALWAYS TRIGGER goods_receipts_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_invoices_read ON public.supplier_invoices FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.supplier_invoices TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_invoices_operator_read ON public.supplier_invoices FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_invoices', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.supplier_invoices TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_invoices_no_truncate BEFORE TRUNCATE ON public.supplier_invoices FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_invoices ENABLE ALWAYS TRIGGER supplier_invoices_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_invoice_lines_read ON public.supplier_invoice_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.supplier_invoice_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_invoice_lines_operator_read ON public.supplier_invoice_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_invoice_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.supplier_invoice_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_invoice_lines_no_truncate BEFORE TRUNCATE ON public.supplier_invoice_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_invoice_lines ENABLE ALWAYS TRIGGER supplier_invoice_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_payments_read ON public.supplier_payments FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.supplier_payments TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_payments_operator_read ON public.supplier_payments FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_payments', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.supplier_payments TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_payments_no_truncate BEFORE TRUNCATE ON public.supplier_payments FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_payments ENABLE ALWAYS TRIGGER supplier_payments_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_payment_allocations_read ON public.supplier_payment_allocations FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.supplier_payment_allocations TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_payment_allocations_operator_read ON public.supplier_payment_allocations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_payment_allocations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.supplier_payment_allocations TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_payment_allocations_no_truncate BEFORE TRUNCATE ON public.supplier_payment_allocations FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_payment_allocations ENABLE ALWAYS TRIGGER supplier_payment_allocations_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_credit_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_credit_notes_read ON public.supplier_credit_notes FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.supplier_credit_notes TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_credit_notes_operator_read ON public.supplier_credit_notes FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_credit_notes', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.supplier_credit_notes TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_credit_notes_no_truncate BEFORE TRUNCATE ON public.supplier_credit_notes FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_credit_notes ENABLE ALWAYS TRIGGER supplier_credit_notes_no_truncate;--> statement-breakpoint
ALTER TABLE public.supplier_credit_applications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_credit_applications_read ON public.supplier_credit_applications FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.stock_cost_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.supplier_credit_applications TO clinic_app;--> statement-breakpoint
CREATE POLICY supplier_credit_applications_operator_read ON public.supplier_credit_applications FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.supplier_credit_applications', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.supplier_credit_applications TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER supplier_credit_applications_no_truncate BEFORE TRUNCATE ON public.supplier_credit_applications FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.supplier_credit_applications ENABLE ALWAYS TRIGGER supplier_credit_applications_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.purchase_orders', 'branch-scoped', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'payables definers (src/modules/purchasing)', 'the ordering branch'),
  ('public.purchase_order_lines', 'branch-scoped', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'payables definers (src/modules/purchasing)', 'the ordering branch'),
  ('public.goods_receipts', 'branch-scoped', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager,pharmacist}', 'payables definers (src/modules/purchasing)', 'the receiving branch'),
  ('public.supplier_invoices', 'tenant-ledger', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'payables definers (src/modules/purchasing)', 'the invoice branch'),
  ('public.supplier_invoice_lines', 'tenant-ledger', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'payables definers (src/modules/purchasing)', 'the invoice branch'),
  ('public.supplier_payments', 'tenant-ledger', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'payables definers (src/modules/purchasing)', 'the paying branch'),
  ('public.supplier_payment_allocations', 'tenant-ledger', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'payables definers (src/modules/purchasing)', 'the paying branch'),
  ('public.supplier_credit_notes', 'tenant-ledger', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'payables definers (src/modules/purchasing)', 'the credit branch'),
  ('public.supplier_credit_applications', 'tenant-ledger', 'purchasing', '{owner,admin_pusat,finance,purchasing,auditor,manager}', 'payables definers (src/modules/purchasing)', 'the credit branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): purchase orders and receipts personal; payables money totals.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.purchase_orders', 'personal'),
  ('public.purchase_order_lines', 'personal'),
  ('public.goods_receipts', 'personal'),
  ('public.supplier_invoices', 'money_total'),
  ('public.supplier_invoice_lines', 'money_total'),
  ('public.supplier_payments', 'money_total'),
  ('public.supplier_payment_allocations', 'money_total'),
  ('public.supplier_credit_notes', 'money_total'),
  ('public.supplier_credit_applications', 'money_total');--> statement-breakpoint

-- ── Guards (ENABLE ALWAYS, after the staff_access lock; r1 P2-4: counters equal their live children) ───────────
-- Purchase orders: never deleted; identity frozen; draft (editable) → sent → partially_received → received;
-- draft | sent → cancelled only before any receipt.
CREATE FUNCTION public.purchase_orders_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchase orders are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'a purchase order opens as a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.supplier_id, NEW.number, NEW.command_key, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.supplier_id, OLD.number, OLD.command_key, OLD.created_at, OLD.created_by)
     OR OLD.state IN ('received','cancelled')
     OR OLD.state <> 'draft' AND (NEW.expected_date, NEW.note) IS DISTINCT FROM (OLD.expected_date, OLD.note)
     OR NOT (OLD.state = 'draft' AND NEW.state IN ('draft','sent','cancelled')
             OR OLD.state IN ('sent','partially_received') AND NEW.state IN ('partially_received','received')
             OR OLD.state = 'sent' AND NEW.state = 'cancelled')
     OR NEW.state = 'cancelled' AND EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.tenant_id = NEW.tenant_id AND l.po_id = NEW.id AND l.received_qty > 0) THEN
    RAISE EXCEPTION 'a purchase order moves draft → sent → received, or is cancelled before any receipt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.purchase_orders_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER purchase_orders_guard BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_guard();--> statement-breakpoint
ALTER TABLE public.purchase_orders ENABLE ALWAYS TRIGGER purchase_orders_guard;--> statement-breakpoint

-- PO lines: never deleted; added or edited (quantity, price, active) only on a draft; afterwards only received_qty
-- grows (r1 P2-6).
CREATE FUNCTION public.purchase_order_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_state text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchase order lines are never deleted' USING ERRCODE = '42501';
  END IF;
  SELECT po.state INTO v_state FROM public.purchase_orders po WHERE po.tenant_id = NEW.tenant_id AND po.id = NEW.po_id AND po.branch_id = NEW.branch_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'a line belongs to a purchase order of its branch' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_state <> 'draft' OR NEW.received_qty <> 0 OR NOT NEW.active THEN
      RAISE EXCEPTION 'lines are added to a draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.po_id, NEW.item_id) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.po_id, OLD.item_id)
     OR v_state = 'draft' AND NEW.received_qty <> OLD.received_qty
     OR v_state <> 'draft' AND ((NEW.ordered_qty, NEW.unit_price, NEW.active) IS DISTINCT FROM (OLD.ordered_qty, OLD.unit_price, OLD.active)
                                OR NEW.received_qty < OLD.received_qty OR NOT OLD.active OR v_state NOT IN ('sent','partially_received')) THEN
    RAISE EXCEPTION 'a line is edited on a draft; afterwards only received grows' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.purchase_order_lines_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER purchase_order_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.purchase_order_lines_guard();--> statement-breakpoint
ALTER TABLE public.purchase_order_lines ENABLE ALWAYS TRIGGER purchase_order_lines_guard;--> statement-breakpoint

-- Insert-only rows: goods receipts.
CREATE FUNCTION public.payables_rows_insert_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% rows are never changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payables_rows_insert_only() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER goods_receipts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.goods_receipts FOR EACH ROW EXECUTE FUNCTION public.payables_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.goods_receipts ENABLE ALWAYS TRIGGER goods_receipts_guard;--> statement-breakpoint

-- Invoices: never deleted; open with zero counters; identity and amounts frozen; paid = live allocations, credited =
-- live applications; open ⇄ paid by the counters; open → reversed with nothing paid or credited.
CREATE FUNCTION public.supplier_invoices_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier invoices are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open' OR NEW.paid_amount <> 0 OR NEW.credited_amount <> 0 THEN
      RAISE EXCEPTION 'an invoice opens with nothing paid' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.supplier_id, NEW.kind, NEW.expense_id, NEW.number, NEW.invoice_date, NEW.due_date, NEW.total, NEW.command_key,
      NEW.recorded_at, NEW.recorded_by, NEW.recorded_as)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.supplier_id, OLD.kind, OLD.expense_id, OLD.number, OLD.invoice_date, OLD.due_date, OLD.total, OLD.command_key,
      OLD.recorded_at, OLD.recorded_by, OLD.recorded_as)
     OR OLD.state = 'reversed'
     OR NEW.paid_amount <> coalesce((SELECT sum(x.amount) FROM public.supplier_payment_allocations x WHERE x.tenant_id = NEW.tenant_id AND x.invoice_id = NEW.id AND NOT x.reversed), 0)
     OR NEW.credited_amount <> coalesce((SELECT sum(x.amount) FROM public.supplier_credit_applications x WHERE x.tenant_id = NEW.tenant_id AND x.invoice_id = NEW.id AND NOT x.reversed), 0) THEN
    RAISE EXCEPTION 'an invoice keeps its amounts; its counters follow its live allocations and credits' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_invoices_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER supplier_invoices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_invoices FOR EACH ROW EXECUTE FUNCTION public.supplier_invoices_guard();--> statement-breakpoint
ALTER TABLE public.supplier_invoices ENABLE ALWAYS TRIGGER supplier_invoices_guard;--> statement-breakpoint

-- At commit, every invoice totals its lines (lines are inserted after their invoice in the same transaction).
CREATE FUNCTION public.supplier_invoices_total_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- a deferred trigger sees the row as inserted: read the invoice as it is at commit
  IF (SELECT i.total FROM public.supplier_invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.id)
     <> coalesce((SELECT sum(l.amount) FROM public.supplier_invoice_lines l WHERE l.tenant_id = NEW.tenant_id AND l.invoice_id = NEW.id), 0) THEN
    RAISE EXCEPTION 'an invoice totals its lines' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_invoices_total_check() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER supplier_invoices_total_check AFTER INSERT ON public.supplier_invoices DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.supplier_invoices_total_check();--> statement-breakpoint
ALTER TABLE public.supplier_invoices ENABLE ALWAYS TRIGGER supplier_invoices_total_check;--> statement-breakpoint

-- Invoice lines (r1 P2-5): never deleted; added while their invoice is new (open, nothing paid); a purchase line names
-- a receipt of the invoice's supplier and branch at its GRNI; afterwards only reversed false → true once the invoice is
-- reversed.
CREATE FUNCTION public.supplier_invoice_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  inv public.supplier_invoices;
  r public.supplier_receipts;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice lines are never deleted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO inv FROM public.supplier_invoices x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.invoice_id;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO r FROM public.supplier_receipts x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.receipt_id;
    IF inv.id IS NULL OR inv.branch_id <> NEW.branch_id OR inv.state <> 'open' OR inv.paid_amount <> 0 OR inv.credited_amount <> 0 OR NEW.reversed
       OR (inv.kind = 'purchase') <> (NEW.receipt_id IS NOT NULL)
       OR NEW.receipt_id IS NOT NULL AND (r.id IS NULL OR r.branch_id <> inv.branch_id OR r.supplier_id <> inv.supplier_id OR NEW.grni_amount <> public.payables_grni(r)) THEN
      RAISE EXCEPTION 'a purchase line names a receipt of its supplier and branch at its GRNI' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.invoice_id, NEW.receipt_id, NEW.grni_amount, NEW.amount)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.invoice_id, OLD.receipt_id, OLD.grni_amount, OLD.amount)
     OR OLD.reversed OR NOT NEW.reversed OR inv.state <> 'reversed' THEN
    RAISE EXCEPTION 'an invoice line is only reversed with its invoice' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_invoice_lines_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER supplier_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_invoice_lines FOR EACH ROW EXECUTE FUNCTION public.supplier_invoice_lines_guard();--> statement-breakpoint
ALTER TABLE public.supplier_invoice_lines ENABLE ALWAYS TRIGGER supplier_invoice_lines_guard;--> statement-breakpoint

-- Payments: never deleted; live with nothing allocated at insert; identity frozen; allocated = live allocations;
-- live → reversed once.
CREATE FUNCTION public.supplier_payments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier payments are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'live' OR NEW.allocated_amount <> 0 THEN
      RAISE EXCEPTION 'a payment opens live with nothing allocated' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.supplier_id, NEW.amount, NEW.method, NEW.paid_on, NEW.reference, NEW.command_key, NEW.recorded_at, NEW.recorded_by)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.supplier_id, OLD.amount, OLD.method, OLD.paid_on, OLD.reference, OLD.command_key, OLD.recorded_at, OLD.recorded_by)
     OR OLD.state = 'reversed'
     OR NEW.allocated_amount <> coalesce((SELECT sum(x.amount) FROM public.supplier_payment_allocations x WHERE x.tenant_id = NEW.tenant_id AND x.payment_id = NEW.id AND NOT x.reversed), 0) THEN
    RAISE EXCEPTION 'a payment keeps its amount; allocated follows its live allocations' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_payments_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER supplier_payments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.supplier_payments_guard();--> statement-breakpoint
ALTER TABLE public.supplier_payments ENABLE ALWAYS TRIGGER supplier_payments_guard;--> statement-breakpoint

-- Credit notes: never deleted; available = amount at insert; identity frozen; available = amount − live applications
-- while live; live → reversed once with available 0.
CREATE FUNCTION public.supplier_credit_notes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit notes are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'live' OR NEW.available_amount <> NEW.amount THEN
      RAISE EXCEPTION 'a credit note opens live and fully available' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.supplier_id, NEW.number, NEW.amount, NEW.tax_amount, NEW.source_kind, NEW.return_id, NEW.invoice_id, NEW.issued_on,
      NEW.command_key, NEW.recorded_at, NEW.recorded_by, NEW.recorded_as)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.supplier_id, OLD.number, OLD.amount, OLD.tax_amount, OLD.source_kind, OLD.return_id, OLD.invoice_id, OLD.issued_on,
      OLD.command_key, OLD.recorded_at, OLD.recorded_by, OLD.recorded_as)
     OR OLD.state = 'reversed'
     OR NEW.state = 'live' AND NEW.available_amount <> NEW.amount - coalesce((SELECT sum(x.amount) FROM public.supplier_credit_applications x
                                                                               WHERE x.tenant_id = NEW.tenant_id AND x.credit_note_id = NEW.id AND NOT x.reversed), 0)
     OR NEW.state = 'reversed' AND EXISTS (SELECT 1 FROM public.supplier_credit_applications x WHERE x.tenant_id = NEW.tenant_id AND x.credit_note_id = NEW.id AND NOT x.reversed) THEN
    RAISE EXCEPTION 'a credit note keeps its amount; available follows its live applications' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_credit_notes_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER supplier_credit_notes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_credit_notes FOR EACH ROW EXECUTE FUNCTION public.supplier_credit_notes_guard();--> statement-breakpoint
ALTER TABLE public.supplier_credit_notes ENABLE ALWAYS TRIGGER supplier_credit_notes_guard;--> statement-breakpoint

-- Allocations and applications: never deleted; inserted against a live payment / credit note and an open invoice;
-- afterwards only reversed false → true.
CREATE FUNCTION public.supplier_settlements_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.reversed OR NOT EXISTS (SELECT 1 FROM public.supplier_invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id AND i.state = 'open')
       OR TG_TABLE_NAME = 'supplier_payment_allocations'
          AND NOT EXISTS (SELECT 1 FROM public.supplier_payments p WHERE p.tenant_id = NEW.tenant_id AND p.id = (to_jsonb(NEW) ->> 'payment_id')::uuid AND p.state = 'live')
       OR TG_TABLE_NAME = 'supplier_credit_applications'
          AND NOT EXISTS (SELECT 1 FROM public.supplier_credit_notes c WHERE c.tenant_id = NEW.tenant_id AND c.id = (to_jsonb(NEW) ->> 'credit_note_id')::uuid AND c.state = 'live') THEN
      RAISE EXCEPTION 'a settlement opens against a live source and an open invoice' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF to_jsonb(NEW) - 'reversed' IS DISTINCT FROM to_jsonb(OLD) - 'reversed' OR OLD.reversed OR NOT NEW.reversed THEN
    RAISE EXCEPTION 'a settlement is only reversed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_settlements_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER supplier_payment_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_payment_allocations FOR EACH ROW EXECUTE FUNCTION public.supplier_settlements_guard();--> statement-breakpoint
ALTER TABLE public.supplier_payment_allocations ENABLE ALWAYS TRIGGER supplier_payment_allocations_guard;--> statement-breakpoint
CREATE TRIGGER supplier_credit_applications_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_credit_applications FOR EACH ROW EXECUTE FUNCTION public.supplier_settlements_guard();--> statement-breakpoint
ALTER TABLE public.supplier_credit_applications ENABLE ALWAYS TRIGGER supplier_credit_applications_guard;--> statement-breakpoint

-- ── Writers (open points 1–6; r1 findings) ──────────────────────────────────────────────────────────────────────
-- Buat / Ubah PO (draft): purchasing, admin pusat, owner (named branch), manager (own branch). p: {supplier_id, branch?
-- (tenant-wide roles), expected_date?, note?, lines: [{item_id, quantity, unit_price}]}. A draft's lines are upserted by
-- item; omitted ones are deactivated (never deleted, r1 P2-6). Returns the PO id.
CREATE FUNCTION public.po_save(p_key text, p_po uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  po public.purchase_orders;
  v_branch uuid;
  v_supplier uuid;
  v_id uuid;
  v_l jsonb;
  v_item uuid;
  v_qty numeric;
  v_price bigint;
BEGIN
  BEGIN
    v_branch := NULLIF(p ->> 'branch_id', '')::uuid;
    v_supplier := NULLIF(p ->> 'supplier_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: purchase order' USING ERRCODE = '22023';
  END;
  a := public.stock_actor(ARRAY['purchasing','admin_pusat','owner','manager'], 'operations', v_branch);
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'supplier_id' - 'branch_id' - 'expected_date' - 'note' - 'lines' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'lines') NOT BETWEEN 1 AND 100
     OR p ? 'expected_date' AND public.payables_date(p ->> 'expected_date') IS NULL
     OR p ? 'note' AND length(btrim(coalesce(p ->> 'note', ''))) NOT BETWEEN 1 AND 300
     OR (SELECT count(DISTINCT x ->> 'item_id') <> count(*) FROM jsonb_array_elements(p -> 'lines') x) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: purchase order' USING ERRCODE = '22023';
  END IF;
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.tenant_id = a.tenant_id AND s.id = v_supplier AND s.active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_po IS NULL THEN
    BEGIN
      INSERT INTO public.purchase_orders (tenant_id, branch_id, supplier_id, number, expected_date, note, command_key, created_by)
      VALUES (a.tenant_id, a.branch_id, v_supplier, public.po_next_number(a.tenant_id, a.branch_id), p ->> 'expected_date', NULLIF(btrim(p ->> 'note'), ''), p_key, a.staff_id)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a purchase order with this key exists' USING ERRCODE = '23505';
    END;
  ELSE
    SELECT * INTO po FROM public.purchase_orders x WHERE x.tenant_id = a.tenant_id AND x.id = p_po FOR UPDATE;
    IF NOT FOUND OR po.branch_id <> a.branch_id THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: purchase order not found' USING ERRCODE = 'P0002';
    END IF;
    IF po.state <> 'draft' OR po.supplier_id <> v_supplier THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: purchase order %', po.state USING ERRCODE = '55000';
    END IF;
    UPDATE public.purchase_orders SET expected_date = p ->> 'expected_date', note = NULLIF(btrim(p ->> 'note'), '') WHERE tenant_id = po.tenant_id AND id = po.id;
    v_id := po.id;
  END IF;
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x ORDER BY x ->> 'item_id' LOOP
    BEGIN
      v_item := (v_l ->> 'item_id')::uuid;
      v_qty := (v_l ->> 'quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: line' USING ERRCODE = '22023';
    END;
    v_price := CASE WHEN jsonb_typeof(v_l -> 'unit_price') = 'number' AND (v_l ->> 'unit_price') ~ '^[0-9]{1,10}$' AND (v_l ->> 'unit_price')::bigint <= 1000000000
                    THEN (v_l ->> 'unit_price')::bigint END;
    IF jsonb_typeof(v_l) IS DISTINCT FROM 'object' OR v_l - 'item_id' - 'quantity' - 'unit_price' <> '{}'::jsonb
       OR v_qty IS NULL OR NOT (v_qty BETWEEN 0.0001 AND 1000000000 AND scale(v_qty) <= 4) OR v_price IS NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: line' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.stock_items i WHERE i.tenant_id = a.tenant_id AND i.id = v_item AND i.active) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: stock item not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.purchase_order_lines (tenant_id, branch_id, po_id, item_id, ordered_qty, unit_price)
    VALUES (a.tenant_id, a.branch_id, v_id, v_item, v_qty, v_price)
    ON CONFLICT (tenant_id, po_id, item_id) DO UPDATE SET ordered_qty = EXCLUDED.ordered_qty, unit_price = EXCLUDED.unit_price, active = true;
  END LOOP;
  UPDATE public.purchase_order_lines SET active = false
   WHERE tenant_id = a.tenant_id AND po_id = v_id AND active AND item_id::text NOT IN (SELECT x ->> 'item_id' FROM jsonb_array_elements(p -> 'lines') x);
  PERFORM public.audit_append('settings_change', 'purchase_order', v_id, 'success', CASE WHEN p_po IS NULL THEN 'po_created' ELSE 'po_updated' END);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.po_save(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.po_save(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- The PO at the actor's branch, locked.
CREATE FUNCTION public.po_locked(p_tenant uuid, p_branch uuid, p_po uuid) RETURNS public.purchase_orders
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  po public.purchase_orders;
BEGIN
  SELECT * INTO po FROM public.purchase_orders x WHERE x.tenant_id = p_tenant AND x.id = p_po FOR UPDATE;
  IF NOT FOUND OR p_branch IS NOT NULL AND po.branch_id <> p_branch THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: purchase order not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN po;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.po_locked(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Kirim PO: a draft becomes sent (its lines freeze; po_save always leaves at least one active line). PurchaseOrderSent {purchase_order_id}.
-- Cancel: draft or sent with nothing received, with a reason.
CREATE FUNCTION public.po_transition(p_po uuid, p_action text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  -- the actor lock first, before any row is read (review 2665ab81 P1-1); a manager's PO of another branch is not found
  a record := public.stock_actor(ARRAY['purchasing','admin_pusat','owner','manager'], 'operations', NULL);
  po public.purchase_orders := public.po_locked(a.tenant_id, a.branch_id, p_po);
BEGIN
  IF p_action = 'send' THEN
    IF po.state <> 'draft' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: purchase order %', po.state USING ERRCODE = '55000';
    END IF;
    UPDATE public.purchase_orders SET state = 'sent', sent_at = clock_timestamp() WHERE tenant_id = po.tenant_id AND id = po.id;
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (po.branch_id, 'PurchaseOrderSent', 'purchase_order', po.id, jsonb_build_object('purchase_order_id', po.id));
  ELSIF p_action = 'cancel' THEN
    IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
    END IF;
    IF po.state NOT IN ('draft','sent') OR EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.tenant_id = po.tenant_id AND l.po_id = po.id AND l.received_qty > 0) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: purchase order %', po.state USING ERRCODE = '55000';
    END IF;
    UPDATE public.purchase_orders SET state = 'cancelled', cancelled_at = clock_timestamp(), cancel_reason = btrim(p_reason) WHERE tenant_id = po.tenant_id AND id = po.id;
  ELSE
    RAISE EXCEPTION 'ERR_INVALID_INPUT: action' USING ERRCODE = '22023';
  END IF;
  PERFORM public.audit_append('settings_change', 'purchase_order', po.id, 'success', 'po_' || p_action);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.po_transition(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.po_transition(uuid, text, text) TO clinic_app;--> statement-breakpoint

-- Terima Barang (PR-17, BILL-34 GRNI): pharmacist or purchasing at a branch; against a sent PO (same supplier and
-- branch; per item received + delta ≤ ordered; a line's unit cost defaults to the PO price, r1 P1-3) or without one.
-- Lines through T-066's supplier_receive_into with source ('goods_receipt', this receipt). p: {supplier_id, po_id?,
-- depot_id?, delivery_note?, lines: [{item_id, batch_no, expiry, quantity, unit_cost?}]}. GoodsReceived {receipt_id,
-- purchase_order_id?}.
CREATE FUNCTION public.goods_receipt_record(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['pharmacist','purchasing'], 'operations', p_branch);
  v_id uuid := public.uuid_generate_v7();
  v_supplier uuid;
  v_po uuid;
  v_depot uuid;
  po public.purchase_orders;
  v_l jsonb;
  v_pl public.purchase_order_lines;
  v_cost jsonb;
  v_sum record;
BEGIN
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'supplier_id' - 'po_id' - 'depot_id' - 'delivery_note' - 'lines' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'lines') NOT BETWEEN 1 AND 100
     OR p ? 'delivery_note' AND coalesce(p ->> 'delivery_note', '') !~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
                  OR x - 'item_id' - 'batch_no' - 'expiry' - 'quantity' - 'unit_cost' <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: receipt' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE coalesce(x ->> 'expiry', '') = '') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: expiry_missing' USING ERRCODE = '22023';
  END IF;
  -- Every line's quantity bounded before any PO line is counted (review 2665ab81 P3).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x
              WHERE CASE WHEN coalesce(x ->> 'quantity', '') ~ '^\d{1,10}(\.\d{1,4})?$' THEN (x ->> 'quantity')::numeric NOT BETWEEN 0.0001 AND 1000000000 ELSE true END) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_supplier := (p ->> 'supplier_id')::uuid;
    v_po := NULLIF(p ->> 'po_id', '')::uuid;
    v_depot := coalesce(NULLIF(p ->> 'depot_id', '')::uuid, public.depot_default(a.tenant_id, a.branch_id));
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: receipt' USING ERRCODE = '22023';
  END;
  IF NOT EXISTS (SELECT 1 FROM public.depots d WHERE d.tenant_id = a.tenant_id AND d.branch_id = a.branch_id AND d.id = v_depot AND d.active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: depot not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_po IS NOT NULL THEN
    po := public.po_locked(a.tenant_id, a.branch_id, v_po);
    IF po.state NOT IN ('sent','partially_received') OR po.supplier_id IS DISTINCT FROM v_supplier THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: purchase order %', po.state USING ERRCODE = '55000';
    END IF;
    PERFORM 1 FROM public.purchase_order_lines l WHERE l.tenant_id = po.tenant_id AND l.po_id = po.id ORDER BY l.id FOR UPDATE;
    BEGIN
      FOR v_sum IN SELECT (x ->> 'item_id')::uuid AS item, sum((x ->> 'quantity')::numeric) AS q FROM jsonb_array_elements(p -> 'lines') x GROUP BY 1 LOOP
        SELECT * INTO v_pl FROM public.purchase_order_lines l WHERE l.tenant_id = po.tenant_id AND l.po_id = po.id AND l.item_id = v_sum.item AND l.active;
        IF v_pl.id IS NULL THEN
          RAISE EXCEPTION 'ERR_INVALID_INPUT: item_not_ordered' USING ERRCODE = '22023';
        END IF;
        IF v_sum.q IS NULL OR v_pl.received_qty + v_sum.q > v_pl.ordered_qty THEN
          RAISE EXCEPTION 'ERR_INVALID_INPUT: more_than_ordered' USING ERRCODE = '22023';
        END IF;
        UPDATE public.purchase_order_lines SET received_qty = received_qty + v_sum.q WHERE tenant_id = v_pl.tenant_id AND id = v_pl.id;
      END LOOP;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: receipt' USING ERRCODE = '22023';
    END;
  END IF;
  BEGIN
    INSERT INTO public.goods_receipts (id, tenant_id, branch_id, supplier_id, po_id, depot_id, delivery_note, command_key, received_by, received_as)
    VALUES (v_id, a.tenant_id, a.branch_id, v_supplier, v_po, v_depot, p ->> 'delivery_note', p_key, a.staff_id, a.role);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
            WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
  END;
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x ORDER BY x ->> 'item_id', x ->> 'batch_no', x ->> 'expiry' LOOP
    v_cost := coalesce(v_l -> 'unit_cost', CASE WHEN v_po IS NOT NULL THEN to_jsonb((SELECT l.unit_price FROM public.purchase_order_lines l
                                                   WHERE l.tenant_id = a.tenant_id AND l.po_id = v_po AND l.item_id::text = v_l ->> 'item_id')) END);
    PERFORM public.supplier_receive_into(a.tenant_id, a.staff_id, a.role, a.branch_id, v_supplier,
      jsonb_build_object('item_id', v_l -> 'item_id', 'batch_no', v_l -> 'batch_no', 'expiry', v_l -> 'expiry', 'quantity', v_l -> 'quantity',
                         'reason', 'penerimaan', 'unit_cost', v_cost, 'depot_id', v_depot)
      || CASE WHEN p ? 'delivery_note' THEN jsonb_build_object('delivery_note', p -> 'delivery_note') ELSE '{}'::jsonb END,
      'goods_receipt', v_id, NULL);
  END LOOP;
  IF v_po IS NOT NULL THEN
    UPDATE public.purchase_orders SET state = CASE WHEN NOT EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.tenant_id = po.tenant_id AND l.po_id = po.id
                                                                       AND l.active AND l.received_qty < l.ordered_qty) THEN 'received' ELSE 'partially_received' END
     WHERE tenant_id = po.tenant_id AND id = po.id;
  END IF;
  PERFORM public.audit_append('settings_change', 'goods_receipt', v_id, 'success', 'goods_received');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'GoodsReceived', 'goods_receipt', v_id,
          jsonb_build_object('receipt_id', v_id) || CASE WHEN v_po IS NOT NULL THEN jsonb_build_object('purchase_order_id', v_po) ELSE '{}'::jsonb END);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.goods_receipt_record(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.goods_receipt_record(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- The money actor (r1 decisions): finance and the stock-cost roles that may record. Branch: a branch role's active
-- branch; a tenant-wide role names it.
CREATE FUNCTION public.payables_actor(p_roles text[], p_branch uuid, OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(p_roles, 'operations', p_branch);
BEGIN
  IF a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END IF;
  tenant_id := a.tenant_id; staff_id := a.staff_id; role := a.role; branch_id := a.branch_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payables_actor(text[], uuid) FROM PUBLIC;--> statement-breakpoint

-- Catat Faktur (PR-90, BILL-34): purchasing or finance; a purchase invoice of one supplier and branch over goods-receipt
-- lines not invoiced yet (each at most once across live invoices); due date default invoice date + the supplier's
-- terms. p: {supplier_id, number, invoice_date, due_date?, lines: [{receipt_id, amount?}]} (amount default GRNI).
-- SupplierInvoiceRecorded {invoice_id}.
CREATE FUNCTION public.supplier_invoice_record(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.payables_actor(ARRAY['purchasing','finance'], p_branch);
  s public.suppliers;
  v_date date := public.payables_date(p ->> 'invoice_date');
  v_due date;
  v_id uuid;
  v_r public.supplier_receipts;
  v_l jsonb;
  v_total bigint := 0;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'supplier_id' - 'number' - 'invoice_date' - 'due_date' - 'lines' <> '{}'::jsonb
     OR coalesce(p ->> 'number', '') !~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$' OR v_date IS NULL
     OR p ? 'due_date' AND public.payables_date(p ->> 'due_date') IS NULL
     OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'lines') NOT BETWEEN 1 AND 200
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'receipt_id' - 'amount' <> '{}'::jsonb
                  OR coalesce(x ->> 'receipt_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  OR x ? 'amount' AND (jsonb_typeof(x -> 'amount') <> 'number' OR (x ->> 'amount') !~ '^[0-9]{1,18}$'))
     OR (SELECT count(DISTINCT x ->> 'receipt_id') <> count(*) FROM jsonb_array_elements(p -> 'lines') x) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: invoice' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT * INTO s FROM public.suppliers x WHERE x.tenant_id = a.tenant_id AND x.id = (p ->> 'supplier_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: supplier' USING ERRCODE = '22023';
  END;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
  END IF;
  v_due := coalesce(public.payables_date(p ->> 'due_date'), v_date + s.payment_terms_days);
  IF v_due < v_date THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: due date' USING ERRCODE = '22023';
  END IF;
  -- A duplicate number (per supplier, ignoring case) is refused by supplier_invoices_number_key (handler below).
  -- Lock order: the receipts by id, then the (new) invoice. Lines are validated and totalled before the invoice is
  -- written (its total is frozen once inserted).
  PERFORM 1 FROM public.supplier_receipts r WHERE r.tenant_id = a.tenant_id
     AND r.id IN (SELECT (x ->> 'receipt_id')::uuid FROM jsonb_array_elements(p -> 'lines') x) ORDER BY r.id FOR UPDATE;
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x ORDER BY x ->> 'receipt_id' LOOP
    SELECT * INTO v_r FROM public.supplier_receipts r WHERE r.tenant_id = a.tenant_id AND r.id = (v_l ->> 'receipt_id')::uuid;
    IF v_r.id IS NULL OR v_r.branch_id <> a.branch_id OR v_r.supplier_id <> s.id THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: receipt not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.supplier_invoice_lines l WHERE l.tenant_id = a.tenant_id AND l.receipt_id = v_r.id AND NOT l.reversed) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: receipt_already_invoiced' USING ERRCODE = '55000';
    END IF;
    v_total := v_total + coalesce((v_l ->> 'amount')::bigint, public.payables_grni(v_r));
  END LOOP;
  IF v_total <= 0 OR v_total > 1000000000000000000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: an invoice totals above zero' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.supplier_invoices (tenant_id, branch_id, supplier_id, kind, number, invoice_date, due_date, total, command_key, recorded_by, recorded_as)
    VALUES (a.tenant_id, a.branch_id, s.id, 'purchase', btrim(p ->> 'number'), v_date::text, v_due::text, v_total, p_key, a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (SELECT 1 FROM public.supplier_invoices i WHERE i.tenant_id = a.tenant_id AND i.command_key = p_key) THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an invoice with this key exists' USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: duplicate_invoice_number' USING ERRCODE = '55000';
  END;
  INSERT INTO public.supplier_invoice_lines (tenant_id, branch_id, invoice_id, receipt_id, grni_amount, amount)
  SELECT a.tenant_id, a.branch_id, v_id, r.id, public.payables_grni(r), coalesce((x ->> 'amount')::bigint, public.payables_grni(r))
    FROM jsonb_array_elements(p -> 'lines') x JOIN public.supplier_receipts r ON r.tenant_id = a.tenant_id AND r.id = (x ->> 'receipt_id')::uuid
   ORDER BY r.id;
  PERFORM public.audit_append('money_correction', 'supplier_invoice', v_id, 'success', 'supplier_invoice_recorded');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (a.branch_id, 'SupplierInvoiceRecorded', 'supplier_invoice', v_id, jsonb_build_object('invoice_id', v_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_invoice_record(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_invoice_record(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Bayar (PR-90, scenario b): finance records a payment to a supplier at a branch and allocates it now to the named
-- invoices or oldest due first (r1 P2-4); the remainder stays unallocated. p: {supplier_id, amount, method, paid_on,
-- reference?, allocations?: [{invoice_id, amount?}]}. Returns the payment id.
CREATE FUNCTION public.supplier_payment_record(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.payables_actor(ARRAY['finance'], p_branch);
  v_id uuid;
  pm public.supplier_payments;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'supplier_id' - 'amount' - 'method' - 'paid_on' - 'reference' - 'allocations' <> '{}'::jsonb
     OR public.payables_money(p -> 'amount') IS NULL OR coalesce(p ->> 'method', '') NOT IN ('cash','bank_transfer')
     OR public.payables_date(p ->> 'paid_on') IS NULL
     OR p ? 'reference' AND coalesce(p ->> 'reference', '') !~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$'
     OR coalesce(p ->> 'supplier_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: payment' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.tenant_id = a.tenant_id AND s.id = (p ->> 'supplier_id')::uuid) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: supplier not found' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    INSERT INTO public.supplier_payments (tenant_id, branch_id, supplier_id, amount, method, paid_on, reference, command_key, recorded_by)
    VALUES (a.tenant_id, a.branch_id, (p ->> 'supplier_id')::uuid, public.payables_money(p -> 'amount'), p ->> 'method', p ->> 'paid_on', p ->> 'reference', p_key, a.staff_id)
    RETURNING * INTO pm;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a payment with this key exists' USING ERRCODE = '23505';
  END;
  PERFORM public.payables_allocate_many(pm, p -> 'allocations', p_key);
  PERFORM public.audit_append('money_correction', 'supplier_payment', pm.id, 'success', 'supplier_payment_recorded');
  RETURN pm.id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_payment_record(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_payment_record(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Alokasikan sisa pembayaran: finance allocates a live payment's unallocated remainder (lock: payment, then invoices
-- by id). p_targets as supplier_payment_record's allocations (null: oldest due first). Returns the amount allocated.
CREATE FUNCTION public.supplier_payment_allocate(p_key text, p_payment uuid, p_targets jsonb) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['finance'], 'operations', NULL); -- the actor lock first (review 2665ab81 P1-1)
  pm public.supplier_payments;
  v_got bigint;
BEGIN
  SELECT * INTO pm FROM public.supplier_payments x WHERE x.tenant_id = a.tenant_id AND x.id = p_payment FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF pm.state <> 'live' OR pm.allocated_amount = pm.amount THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing_unallocated' USING ERRCODE = '55000';
  END IF;
  v_got := public.payables_allocate_many(pm, p_targets, p_key);
  RETURN v_got;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_payment_allocate(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_payment_allocate(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Catat Nota Kredit: purchasing or finance; source a T-066 return (one credit note per return; the expectation closes
-- received with this note: lock order expectation → note) or an invoice of the supplier at the branch. p: {supplier_id,
-- number, amount, tax_amount?, issued_on, return_id? | invoice_id?}.
CREATE FUNCTION public.supplier_credit_note_record(p_key text, p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.payables_actor(ARRAY['purchasing','finance'], p_branch);
  v_amount bigint := public.payables_money(p -> 'amount');
  v_tax bigint := coalesce(CASE WHEN p ? 'tax_amount' THEN CASE WHEN jsonb_typeof(p -> 'tax_amount') = 'number' AND (p ->> 'tax_amount') ~ '^[0-9]{1,18}$'
                                                          THEN (p ->> 'tax_amount')::numeric END END, 0);
  e public.supplier_credit_expectations;
  v_supplier uuid;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'supplier_id' - 'number' - 'amount' - 'tax_amount' - 'issued_on' - 'return_id' - 'invoice_id' <> '{}'::jsonb
     OR coalesce(p ->> 'number', '') !~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$' OR v_amount IS NULL OR v_tax IS NULL OR v_tax > v_amount
     OR public.payables_date(p ->> 'issued_on') IS NULL OR (p ? 'return_id') = (p ? 'invoice_id')
     OR coalesce(p ->> 'supplier_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR coalesce(p ->> 'return_id', p ->> 'invoice_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: credit note' USING ERRCODE = '22023';
  END IF;
  v_supplier := (p ->> 'supplier_id')::uuid;
  IF p ? 'return_id' THEN
    SELECT * INTO e FROM public.supplier_credit_expectations x WHERE x.tenant_id = a.tenant_id AND x.return_id = (p ->> 'return_id')::uuid FOR UPDATE;
    IF NOT FOUND OR e.branch_id <> a.branch_id OR e.supplier_id <> v_supplier THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: return not found' USING ERRCODE = 'P0002';
    END IF;
    IF e.state <> 'expected' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: expectation %', e.state USING ERRCODE = '55000';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.supplier_invoices i WHERE i.tenant_id = a.tenant_id AND i.id = (p ->> 'invoice_id')::uuid
                     AND i.branch_id = a.branch_id AND i.supplier_id = v_supplier AND i.state <> 'reversed') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    INSERT INTO public.supplier_credit_notes (tenant_id, branch_id, supplier_id, number, amount, tax_amount, available_amount, source_kind, return_id, invoice_id, issued_on,
                                              command_key, recorded_by, recorded_as)
    VALUES (a.tenant_id, a.branch_id, v_supplier, btrim(p ->> 'number'), v_amount, v_tax, v_amount, CASE WHEN p ? 'return_id' THEN 'return' ELSE 'invoice' END,
            (p ->> 'return_id')::uuid, (p ->> 'invoice_id')::uuid, p ->> 'issued_on', p_key, a.staff_id, a.role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (SELECT 1 FROM public.supplier_credit_notes c WHERE c.tenant_id = a.tenant_id AND c.command_key = p_key) THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a credit note with this key exists' USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: duplicate_credit_note_number' USING ERRCODE = '55000';
  END;
  IF e.id IS NOT NULL THEN
    UPDATE public.supplier_credit_expectations SET state = 'received', credit_note_id = v_id, closed_by = a.staff_id, closed_as = a.role, closed_at = clock_timestamp()
     WHERE tenant_id = e.tenant_id AND id = e.id;
  END IF;
  PERFORM public.audit_append('money_correction', 'supplier_credit_note', v_id, 'success', 'supplier_credit_note_recorded');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_credit_note_record(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_credit_note_record(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Terapkan Nota Kredit: finance applies up to p_amount (null: as much as possible) of a live credit note to an open
-- invoice of the same supplier and branch: least(requested, available, outstanding) under the lock order note →
-- invoice (r1 P2-4); nothing to apply is refused. SupplierCreditApplied {credit_note_id, invoice_id}.
CREATE FUNCTION public.supplier_credit_apply(p_key text, p_credit_note uuid, p_invoice uuid, p_amount bigint) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['finance'], 'operations', NULL); -- the actor lock first (review 2665ab81 P1-1)
  c public.supplier_credit_notes;
  inv public.supplier_invoices;
  v_take bigint;
BEGIN
  IF p_amount IS NOT NULL AND NOT (p_amount BETWEEN 1 AND 1000000000000000000) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: amount' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.supplier_credit_notes x WHERE x.tenant_id = a.tenant_id AND x.id = p_credit_note FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: credit note not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO inv FROM public.supplier_invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF NOT FOUND OR inv.branch_id <> c.branch_id OR inv.supplier_id <> c.supplier_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  v_take := least(coalesce(p_amount, c.available_amount), CASE WHEN c.state = 'live' THEN c.available_amount ELSE 0 END,
                  CASE WHEN inv.state = 'open' THEN inv.total - inv.paid_amount - inv.credited_amount ELSE 0 END);
  IF v_take <= 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing_to_apply' USING ERRCODE = '55000';
  END IF;
  BEGIN
    INSERT INTO public.supplier_credit_applications (tenant_id, branch_id, supplier_id, credit_note_id, invoice_id, amount, command_key, applied_by)
    VALUES (c.tenant_id, c.branch_id, c.supplier_id, c.id, inv.id, v_take, p_key, a.staff_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: an application with this key exists' USING ERRCODE = '23505';
  END;
  UPDATE public.supplier_invoices SET credited_amount = credited_amount + v_take,
         state = CASE WHEN paid_amount + credited_amount + v_take = total THEN 'paid' ELSE 'open' END
   WHERE tenant_id = inv.tenant_id AND id = inv.id;
  UPDATE public.supplier_credit_notes SET available_amount = available_amount - v_take WHERE tenant_id = c.tenant_id AND id = c.id;
  PERFORM public.audit_append('money_correction', 'supplier_credit_note', c.id, 'success', 'supplier_credit_applied');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (c.branch_id, 'SupplierCreditApplied', 'supplier_credit_note', c.id, jsonb_build_object('credit_note_id', c.id, 'invoice_id', inv.id));
  RETURN v_take;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_credit_apply(text, uuid, uuid, bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_credit_apply(text, uuid, uuid, bigint) TO clinic_app;--> statement-breakpoint

-- Hapus Buku Ekspektasi (T-066 expectation): finance writes off an expected credit with a reason.
CREATE FUNCTION public.supplier_credit_expectation_write_off(p_return uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_actor(ARRAY['finance'], 'operations', NULL); -- the actor lock first (review 2665ab81 P1-1)
  e public.supplier_credit_expectations;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO e FROM public.supplier_credit_expectations x WHERE x.tenant_id = a.tenant_id AND x.return_id = p_return FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: return not found' USING ERRCODE = 'P0002';
  END IF;
  IF e.state <> 'expected' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: expectation %', e.state USING ERRCODE = '55000';
  END IF;
  UPDATE public.supplier_credit_expectations SET state = 'written_off', closed_reason = btrim(p_reason), closed_by = a.staff_id, closed_as = a.role, closed_at = clock_timestamp()
   WHERE tenant_id = e.tenant_id AND id = e.id;
  PERFORM public.audit_append('money_correction', 'supplier_return', p_return, 'success', 'credit_expectation_written_off');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_credit_expectation_write_off(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_credit_expectation_write_off(uuid, text) TO clinic_app;--> statement-breakpoint

-- Reversals (BILL-34 "never deletion"; r1 P2-7). p_kind: 'invoice' (purchasing, finance; nothing paid or credited;
-- its lines reversed so its receipts may be invoiced again), 'payment' (finance; its live allocations reversed, the
-- invoices reopened), 'credit_note' (finance; its live applications reversed, the invoices reopened, available 0).
-- Lock order: credit note / payment → invoices by id. Events Supplier{Invoice,Payment,Credit}Reversed.
CREATE FUNCTION public.supplier_payable_reverse(p_kind text, p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  -- the actor lock first, before any row is read (review 2665ab81 P1-1)
  a record := public.stock_actor(CASE WHEN p_kind = 'invoice' THEN ARRAY['purchasing','finance'] ELSE ARRAY['finance'] END, 'operations', NULL);
  inv public.supplier_invoices;
  pm public.supplier_payments;
  c public.supplier_credit_notes;
  v_x record;
BEGIN
  IF p_kind NOT IN ('invoice','payment','credit_note') OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reversal' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'invoice' THEN
    SELECT * INTO inv FROM public.supplier_invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
    END IF;
    IF inv.state <> 'open' OR inv.paid_amount <> 0 OR inv.credited_amount <> 0 THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_settled' USING ERRCODE = '55000';
    END IF;
    UPDATE public.supplier_invoices SET state = 'reversed', reversed_at = clock_timestamp(), reversed_by = a.staff_id, reverse_reason = btrim(p_reason)
     WHERE tenant_id = inv.tenant_id AND id = inv.id;
    UPDATE public.supplier_invoice_lines SET reversed = true WHERE tenant_id = inv.tenant_id AND invoice_id = inv.id;
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (inv.branch_id, 'SupplierInvoiceReversed', 'supplier_invoice', inv.id, jsonb_build_object('invoice_id', inv.id));
  ELSIF p_kind = 'payment' THEN
    SELECT * INTO pm FROM public.supplier_payments x WHERE x.tenant_id = a.tenant_id AND x.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: payment not found' USING ERRCODE = 'P0002';
    END IF;
    IF pm.state <> 'live' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: payment reversed' USING ERRCODE = '55000';
    END IF;
    PERFORM 1 FROM public.supplier_invoices i WHERE i.tenant_id = pm.tenant_id
       AND i.id IN (SELECT x.invoice_id FROM public.supplier_payment_allocations x WHERE x.tenant_id = pm.tenant_id AND x.payment_id = pm.id AND NOT x.reversed) ORDER BY i.id FOR UPDATE;
    FOR v_x IN SELECT x.id, x.invoice_id, x.amount FROM public.supplier_payment_allocations x WHERE x.tenant_id = pm.tenant_id AND x.payment_id = pm.id AND NOT x.reversed ORDER BY x.invoice_id, x.id LOOP
      UPDATE public.supplier_payment_allocations SET reversed = true WHERE tenant_id = pm.tenant_id AND id = v_x.id;
      UPDATE public.supplier_invoices SET paid_amount = paid_amount - v_x.amount, state = 'open' WHERE tenant_id = pm.tenant_id AND id = v_x.invoice_id;
    END LOOP;
    UPDATE public.supplier_payments SET state = 'reversed', allocated_amount = 0, reversed_at = clock_timestamp(), reversed_by = a.staff_id, reverse_reason = btrim(p_reason)
     WHERE tenant_id = pm.tenant_id AND id = pm.id;
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (pm.branch_id, 'SupplierPaymentReversed', 'supplier_payment', pm.id, jsonb_build_object('payment_id', pm.id));
  ELSE
    SELECT * INTO c FROM public.supplier_credit_notes x WHERE x.tenant_id = a.tenant_id AND x.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: credit note not found' USING ERRCODE = 'P0002';
    END IF;
    IF c.state <> 'live' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: credit note reversed' USING ERRCODE = '55000';
    END IF;
    PERFORM 1 FROM public.supplier_invoices i WHERE i.tenant_id = c.tenant_id
       AND i.id IN (SELECT x.invoice_id FROM public.supplier_credit_applications x WHERE x.tenant_id = c.tenant_id AND x.credit_note_id = c.id AND NOT x.reversed) ORDER BY i.id FOR UPDATE;
    FOR v_x IN SELECT x.id, x.invoice_id, x.amount FROM public.supplier_credit_applications x WHERE x.tenant_id = c.tenant_id AND x.credit_note_id = c.id AND NOT x.reversed ORDER BY x.invoice_id, x.id LOOP
      UPDATE public.supplier_credit_applications SET reversed = true WHERE tenant_id = c.tenant_id AND id = v_x.id;
      UPDATE public.supplier_invoices SET credited_amount = credited_amount - v_x.amount, state = 'open' WHERE tenant_id = c.tenant_id AND id = v_x.invoice_id;
    END LOOP;
    UPDATE public.supplier_credit_notes SET state = 'reversed', available_amount = 0, reversed_at = clock_timestamp(), reversed_by = a.staff_id, reverse_reason = btrim(p_reason)
     WHERE tenant_id = c.tenant_id AND id = c.id;
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (c.branch_id, 'SupplierCreditReversed', 'supplier_credit_note', c.id, jsonb_build_object('credit_note_id', c.id));
  END IF;
  PERFORM public.audit_append('money_correction', 'supplier_' || p_kind, p_id, 'success', 'supplier_' || p_kind || '_reversed');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_payable_reverse(text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_payable_reverse(text, uuid, text) TO clinic_app;--> statement-breakpoint

-- ── Readers (r1 P1-3, P3-8: compact; money only for stock_cost_readable of the row's branch) ─────────────────────
-- The UX-52 frame: role, branches, abilities (the pages hide what the role may not do; the database decides).
CREATE FUNCTION public.purchasing_context() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
BEGIN
  RETURN jsonb_build_object('role', a.role, 'active_branch_id', a.branch_id,
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name, b.id) FROM public.branches b
                           WHERE b.tenant_id = a.tenant_id AND (a.role NOT IN ('manager','pharmacist') OR b.id = a.branch_id)), '[]'::jsonb),
    'money', a.role IN ('owner','admin_pusat','finance','purchasing','auditor','manager'),
    'can_supplier', a.role IN ('purchasing','admin_pusat','owner'),
    'can_po', a.role IN ('purchasing','admin_pusat','owner','manager'),
    'can_receive', a.role IN ('pharmacist','purchasing'),
    'can_return', a.role IN ('purchasing','pharmacist','manager','admin_pusat','owner'),
    'can_transfer', a.role IN ('pharmacist','purchasing'),
    'can_invoice', a.role IN ('purchasing','finance'),
    'can_pay', a.role = 'finance',
    'suppliers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'active', s.active, 'payment_terms_days', s.payment_terms_days)
                                           ORDER BY s.active DESC, lower(s.name), s.id) FROM public.suppliers s WHERE s.tenant_id = a.tenant_id), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'name', lb.name, 'code', lb.code, 'unit', i.unit) ORDER BY lb.name, i.id)
                         FROM public.stock_items i CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
                        WHERE i.tenant_id = a.tenant_id AND i.active), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.purchasing_context() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.purchasing_context() TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.po_json(po public.purchase_orders, p_lines boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', po.id, 'number', po.number, 'branch_id', po.branch_id, 'supplier_id', po.supplier_id,
           'supplier_name', (SELECT s.name FROM public.suppliers s WHERE s.tenant_id = po.tenant_id AND s.id = po.supplier_id),
           'state', po.state, 'expected_date', po.expected_date, 'note', po.note, 'created_at', po.created_at, 'sent_at', po.sent_at, 'cancel_reason', po.cancel_reason,
           'total', CASE WHEN public.stock_cost_readable(po.tenant_id, po.branch_id)
                         THEN (SELECT sum(round(l.ordered_qty * l.unit_price))::bigint FROM public.purchase_order_lines l WHERE l.tenant_id = po.tenant_id AND l.po_id = po.id AND l.active) END)
      || CASE WHEN p_lines THEN jsonb_build_object('lines', coalesce((
           SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'name', lb.name, 'unit', i.unit, 'ordered', l.ordered_qty, 'received', l.received_qty,
                    'active', l.active, 'unit_price', CASE WHEN public.stock_cost_readable(po.tenant_id, po.branch_id) THEN l.unit_price END) ORDER BY lb.name, l.id)
             FROM public.purchase_order_lines l JOIN public.stock_items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
             CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
            WHERE l.tenant_id = po.tenant_id AND l.po_id = po.id), '[]'::jsonb)) ELSE '{}'::jsonb END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.po_json(public.purchase_orders, boolean) FROM PUBLIC;--> statement-breakpoint

-- The POs at a branch (a branch role: its own; a tenant-wide role names it), newest first; p_state optional.
CREATE FUNCTION public.po_list(p_branch uuid, p_state text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
BEGIN
  RETURN coalesce((SELECT jsonb_agg(public.po_json(po, false) ORDER BY po.created_at DESC, po.id)
                     FROM public.purchase_orders po WHERE po.tenant_id = a.tenant_id AND po.branch_id = v_branch AND (p_state IS NULL OR po.state = p_state)), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.po_list(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.po_list(uuid, text) TO clinic_app;--> statement-breakpoint

-- One PO with lines and its receipts (lines with batch, expiry, quantity; unit cost for cost readers).
CREATE FUNCTION public.po_get(p_po uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  po public.purchase_orders;
BEGIN
  SELECT * INTO po FROM public.purchase_orders x WHERE x.tenant_id = a.tenant_id AND x.id = p_po;
  IF NOT FOUND OR NOT public.stock_readable(po.tenant_id, po.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: purchase order not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.po_json(po, true) || jsonb_build_object('receipts', coalesce((
    SELECT jsonb_agg(public.goods_receipt_json(g) ORDER BY g.received_at, g.id) FROM public.goods_receipts g WHERE g.tenant_id = po.tenant_id AND g.po_id = po.id), '[]'::jsonb));
END
$$;--> statement-breakpoint

CREATE FUNCTION public.goods_receipt_json(g public.goods_receipts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', g.id, 'branch_id', g.branch_id, 'supplier_id', g.supplier_id,
           'supplier_name', (SELECT s.name FROM public.suppliers s WHERE s.tenant_id = g.tenant_id AND s.id = g.supplier_id),
           'po_id', g.po_id, 'po_number', (SELECT po.number FROM public.purchase_orders po WHERE po.tenant_id = g.tenant_id AND po.id = g.po_id),
           'depot_id', g.depot_id, 'delivery_note', g.delivery_note, 'received_at', g.received_at, 'received_as', g.received_as,
           'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('receipt_id', r.id, 'batch_id', r.batch_id, 'batch_no', b.batch_no, 'expiry', b.expiry, 'item', lb.name,
                                'unit', i.unit, 'quantity', r.quantity,
                                'unit_cost', CASE WHEN public.stock_cost_readable(g.tenant_id, g.branch_id) THEN r.unit_cost END,
                                'grni', CASE WHEN public.stock_cost_readable(g.tenant_id, g.branch_id) THEN public.payables_grni(r) END,
                                'invoiced', EXISTS (SELECT 1 FROM public.supplier_invoice_lines l WHERE l.tenant_id = r.tenant_id AND l.receipt_id = r.id AND NOT l.reversed))
                                ORDER BY lb.name, b.batch_no, r.id)
                               FROM public.supplier_receipts r JOIN public.stock_batches b ON b.tenant_id = r.tenant_id AND b.id = r.batch_id
                               JOIN public.stock_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
                               CROSS JOIN LATERAL public.stock_item_label(i.tenant_id, i.catalog_item_id) lb
                              WHERE r.tenant_id = g.tenant_id AND r.source_kind = 'goods_receipt' AND r.source_id = g.id), '[]'::jsonb))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.goods_receipt_json(public.goods_receipts) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.po_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.po_get(uuid) TO clinic_app;--> statement-breakpoint

-- The goods receipts at a branch, newest first (p_limit 1..200).
CREATE FUNCTION public.goods_receipt_list(p_branch uuid, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_reader();
  v_branch uuid := public.stock_reader_branch(a.tenant_id, a.role, a.branch_id, p_branch);
BEGIN
  RETURN coalesce((SELECT jsonb_agg(public.goods_receipt_json(g) ORDER BY g.received_at DESC, g.id)
                     FROM (SELECT * FROM public.goods_receipts g WHERE g.tenant_id = a.tenant_id AND g.branch_id = v_branch
                            ORDER BY g.received_at DESC, g.id LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) g), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.goods_receipt_list(uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.goods_receipt_list(uuid, integer) TO clinic_app;--> statement-breakpoint

-- Utang (UX-52 ▸ Utang): money readers (owner, admin pusat, finance, purchasing, auditor; manager own branch) at a
-- branch: open and recent invoices with outstanding and due state, uninvoiced receipt lines, payments with their
-- unallocated part, credit notes with available amounts, expected credits (T-066), and per supplier the balance (r1
-- P3-8: open_payable = invoices − allocations − applied credits; net_balance = invoices − payments − applied credits).
CREATE FUNCTION public.payable_overview(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.stock_cost_reader(p_branch);
  v_today date := public.stock_local_date(a.tenant_id, a.branch_id, clock_timestamp());
BEGIN
  RETURN jsonb_build_object('branch_id', a.branch_id, 'today', v_today,
    'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'supplier_id', i.supplier_id, 'supplier_name', s.name, 'number', i.number, 'kind', i.kind,
                     'invoice_date', i.invoice_date, 'due_date', i.due_date, 'total', i.total, 'paid', i.paid_amount, 'credited', i.credited_amount,
                     'outstanding', CASE WHEN i.state = 'open' THEN i.total - i.paid_amount - i.credited_amount ELSE 0 END, 'state', i.state,
                     'overdue', i.state = 'open' AND i.due_date::date < v_today,
                     'variance', (SELECT sum(l.amount - l.grni_amount) FROM public.supplier_invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id))
                     ORDER BY (i.state = 'open') DESC, i.due_date, i.id)
                     FROM public.supplier_invoices i JOIN public.suppliers s ON s.tenant_id = i.tenant_id AND s.id = i.supplier_id
                    WHERE i.tenant_id = a.tenant_id AND i.branch_id = a.branch_id
                      AND (i.state = 'open' OR i.recorded_at > clock_timestamp() - interval '90 days')), '[]'::jsonb),
    'uninvoiced', coalesce((SELECT jsonb_agg(jsonb_build_object('receipt_id', r.id, 'supplier_id', r.supplier_id, 'supplier_name', s.name, 'item', lb.name, 'unit', it.unit,
                     'batch_no', b.batch_no, 'quantity', r.quantity, 'unit_cost', r.unit_cost, 'grni', public.payables_grni(r), 'received_at', r.received_at,
                     'delivery_note', r.delivery_note) ORDER BY s.name, r.received_at, r.id)
                     FROM public.supplier_receipts r JOIN public.suppliers s ON s.tenant_id = r.tenant_id AND s.id = r.supplier_id
                     JOIN public.stock_batches b ON b.tenant_id = r.tenant_id AND b.id = r.batch_id
                     JOIN public.stock_items it ON it.tenant_id = b.tenant_id AND it.id = b.item_id
                     CROSS JOIN LATERAL public.stock_item_label(it.tenant_id, it.catalog_item_id) lb
                    WHERE r.tenant_id = a.tenant_id AND r.branch_id = a.branch_id
                      AND NOT EXISTS (SELECT 1 FROM public.supplier_invoice_lines l WHERE l.tenant_id = r.tenant_id AND l.receipt_id = r.id AND NOT l.reversed)), '[]'::jsonb),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pm.id, 'supplier_id', pm.supplier_id, 'supplier_name', s.name, 'amount', pm.amount,
                     'unallocated', CASE WHEN pm.state = 'live' THEN pm.amount - pm.allocated_amount ELSE 0 END, 'method', pm.method, 'paid_on', pm.paid_on,
                     'reference', pm.reference, 'state', pm.state) ORDER BY pm.paid_on DESC, pm.id)
                     FROM public.supplier_payments pm JOIN public.suppliers s ON s.tenant_id = pm.tenant_id AND s.id = pm.supplier_id
                    WHERE pm.tenant_id = a.tenant_id AND pm.branch_id = a.branch_id
                      AND (pm.state = 'live' AND pm.allocated_amount < pm.amount OR pm.recorded_at > clock_timestamp() - interval '90 days')), '[]'::jsonb),
    'credit_notes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'supplier_id', c.supplier_id, 'supplier_name', s.name, 'number', c.number, 'amount', c.amount,
                     'available', c.available_amount, 'source', c.source_kind, 'issued_on', c.issued_on, 'state', c.state) ORDER BY c.issued_on DESC, c.id)
                     FROM public.supplier_credit_notes c JOIN public.suppliers s ON s.tenant_id = c.tenant_id AND s.id = c.supplier_id
                    WHERE c.tenant_id = a.tenant_id AND c.branch_id = a.branch_id
                      AND (c.state = 'live' AND c.available_amount > 0 OR c.recorded_at > clock_timestamp() - interval '90 days')), '[]'::jsonb),
    'expected_credits', coalesce((SELECT jsonb_agg(jsonb_build_object('return_id', e.return_id, 'supplier_id', e.supplier_id, 'supplier_name', s.name, 'amount', e.amount,
                     'uncosted', e.uncosted, 'created_at', e.created_at) ORDER BY e.created_at, e.id)
                     FROM public.supplier_credit_expectations e JOIN public.suppliers s ON s.tenant_id = e.tenant_id AND s.id = e.supplier_id
                    WHERE e.tenant_id = a.tenant_id AND e.branch_id = a.branch_id AND e.state = 'expected'), '[]'::jsonb),
    'balances', coalesce((SELECT jsonb_agg(public.supplier_balance_json(a.tenant_id, a.branch_id, s.id) ORDER BY lower(s.name), s.id)
                     FROM public.suppliers s WHERE s.tenant_id = a.tenant_id
                      AND (EXISTS (SELECT 1 FROM public.supplier_invoices i WHERE i.tenant_id = s.tenant_id AND i.branch_id = a.branch_id AND i.supplier_id = s.id AND i.state <> 'reversed')
                           OR EXISTS (SELECT 1 FROM public.supplier_payments pm WHERE pm.tenant_id = s.tenant_id AND pm.branch_id = a.branch_id AND pm.supplier_id = s.id AND pm.state = 'live')
                           OR EXISTS (SELECT 1 FROM public.supplier_credit_notes c WHERE c.tenant_id = s.tenant_id AND c.branch_id = a.branch_id AND c.supplier_id = s.id))), '[]'::jsonb));
END
$$;--> statement-breakpoint

-- One supplier's balance at a branch (r1 P3-8).
CREATE FUNCTION public.supplier_balance_json(p_tenant uuid, p_branch uuid, p_supplier uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH inv AS (SELECT coalesce(sum(i.total), 0) t FROM public.supplier_invoices i
                WHERE i.tenant_id = p_tenant AND i.branch_id = p_branch AND i.supplier_id = p_supplier AND i.state <> 'reversed'),
       pay AS (SELECT coalesce(sum(pm.amount), 0) amount, coalesce(sum(pm.allocated_amount), 0) allocated FROM public.supplier_payments pm
                WHERE pm.tenant_id = p_tenant AND pm.branch_id = p_branch AND pm.supplier_id = p_supplier AND pm.state = 'live'),
       cr AS (SELECT coalesce(sum(c.amount - c.available_amount), 0) applied, coalesce(sum(c.available_amount), 0) available FROM public.supplier_credit_notes c
                WHERE c.tenant_id = p_tenant AND c.branch_id = p_branch AND c.supplier_id = p_supplier AND c.state = 'live')
  SELECT jsonb_build_object('supplier_id', p_supplier, 'supplier_name', (SELECT s.name FROM public.suppliers s WHERE s.tenant_id = p_tenant AND s.id = p_supplier),
           'invoiced_total', inv.t, 'allocated_payments', pay.allocated, 'unallocated_payments', pay.amount - pay.allocated, 'applied_credits', cr.applied,
           'available_credits', cr.available, 'open_payable', inv.t - pay.allocated - cr.applied, 'net_balance', inv.t - pay.amount - cr.applied)
    FROM inv, pay, cr
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_balance_json(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.payable_overview(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.payable_overview(uuid) TO clinic_app;
