CREATE TABLE "receivable_collections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"command_key" text NOT NULL,
	"received_by" uuid NOT NULL,
	"received_as" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "receivable_collections_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "receivable_collections_receipt_key" UNIQUE("tenant_id","receipt_id"),
	CONSTRAINT "receivable_collections_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "receivable_collections_check" CHECK ("receivable_collections"."amount" between 1 and 1000000000000 and "receivable_collections"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "receivable_collections"."method" in ('cash','edc','transfer','balance') and "receivable_collections"."received_as" in ('owner','manager','fo_cashier','finance'))
);
--> statement-breakpoint
CREATE TABLE "receivable_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "receivable_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "receivable_lines_line_key" UNIQUE("tenant_id","invoice_line_id"),
	CONSTRAINT "receivable_lines_check" CHECK ("receivable_lines"."amount" between 1 and 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"collected_amount" bigint DEFAULT 0 NOT NULL,
	"written_off_amount" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"write_off_approval_id" uuid,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "receivables_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "receivables_tenant_branch_id_key" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "receivables_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "receivables_check" CHECK ("receivables"."amount" between 1 and 1000000000000 and "receivables"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "receivables"."state" in ('open','collected','written_off')
      and "receivables"."collected_amount" >= 0 and "receivables"."written_off_amount" >= 0 and "receivables"."collected_amount" + "receivables"."written_off_amount" <= "receivables"."amount"
      and (("receivables"."state" = 'collected') = ("receivables"."collected_amount" = "receivables"."amount"))
      and (("receivables"."state" = 'written_off') = ("receivables"."written_off_amount" > 0)) and ("receivables"."state" <> 'written_off' or "receivables"."collected_amount" + "receivables"."written_off_amount" = "receivables"."amount")
      and ("receivables"."state" = 'open' or "receivables"."write_off_approval_id" is null or "receivables"."state" = 'written_off')
      and "receivables"."created_as" in ('owner','manager','fo_cashier'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"destination" text NOT NULL,
	"state" text NOT NULL,
	"delivered" boolean NOT NULL,
	"vat_reversed" bigint DEFAULT 0 NOT NULL,
	"returned_quantity" integer,
	"reason" text NOT NULL,
	"approval_id" uuid,
	"balance_entry_id" uuid,
	"cash_entry_id" uuid,
	"paid_method" text,
	"paid_details" jsonb,
	"failure_code" text,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"paid_by" uuid,
	"paid_as" text,
	"paid_at" timestamp with time zone,
	"command_key" text NOT NULL,
	"pay_key" text,
	CONSTRAINT "refunds_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "refunds_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "refunds_pay_key" UNIQUE("tenant_id","pay_key"),
	CONSTRAINT "refunds_approval_key" UNIQUE("tenant_id","approval_id"),
	CONSTRAINT "refunds_check" CHECK ("refunds"."amount" between 1 and 1000000000000 and "refunds"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and ("refunds"."pay_key" is null or "refunds"."pay_key" ~ '^[A-Za-z0-9_.:-]{8,128}$')
      and "refunds"."destination" in ('balance','cash') and "refunds"."state" in ('requested','approved','paid','failed') and "refunds"."vat_reversed" between 0 and "refunds"."amount"
      and ("refunds"."returned_quantity" is null or "refunds"."returned_quantity" between 1 and 10000)
      and length(btrim("refunds"."reason")) between 3 and 500 and "refunds"."requested_as" in ('owner','manager','fo_cashier','finance')
      and ("refunds"."destination" = 'cash') = ("refunds"."approval_id" is not null)
      and ("refunds"."destination" = 'cash' or "refunds"."state" = 'paid')
      and (("refunds"."state" = 'paid') = ("refunds"."paid_at" is not null)) and (("refunds"."state" = 'paid') = ("refunds"."balance_entry_id" is not null))
      and (("refunds"."state" = 'paid' and "refunds"."destination" = 'cash') = ("refunds"."cash_entry_id" is not null))
      and (("refunds"."state" = 'paid' and "refunds"."destination" = 'cash') = ("refunds"."paid_method" is not null))
      and ("refunds"."paid_method" is null or "refunds"."paid_method" in ('cash','transfer'))
      and ("refunds"."paid_details" is null or "refunds"."paid_method" = 'transfer' and jsonb_typeof("refunds"."paid_details") = 'object')
      and (("refunds"."state" = 'failed') = ("refunds"."failure_code" is not null)) and ("refunds"."failure_code" is null or "refunds"."failure_code" ~ '^[a-z_]{3,40}$')
      and ("refunds"."paid_as" is null or "refunds"."paid_as" in ('owner','manager','fo_cashier','finance')))
);
--> statement-breakpoint
CREATE TABLE "write_offs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"approval_id" uuid NOT NULL,
	"owner_self" boolean NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"command_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "write_offs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "write_offs_receivable_key" UNIQUE("tenant_id","receivable_id"),
	CONSTRAINT "write_offs_approval_key" UNIQUE("tenant_id","approval_id"),
	CONSTRAINT "write_offs_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "write_offs_check" CHECK ("write_offs"."amount" between 1 and 1000000000000 and "write_offs"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and length(btrim("write_offs"."reason")) between 3 and 500
      and (not "write_offs"."owner_self" or "write_offs"."requested_by" = "write_offs"."approved_by"))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_check";--> statement-breakpoint
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_t076_check";--> statement-breakpoint
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_check";--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "receivable_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "receivable_id" uuid;--> statement-breakpoint
ALTER TABLE "receivable_collections" ADD CONSTRAINT "receivable_collections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_collections" ADD CONSTRAINT "receivable_collections_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_collections" ADD CONSTRAINT "receivable_collections_receivable_fk" FOREIGN KEY ("tenant_id","receivable_id") REFERENCES "public"."receivables"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_collections" ADD CONSTRAINT "receivable_collections_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_collections" ADD CONSTRAINT "receivable_collections_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_lines" ADD CONSTRAINT "receivable_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_lines" ADD CONSTRAINT "receivable_lines_receivable_fk" FOREIGN KEY ("tenant_id","branch_id","receivable_id") REFERENCES "public"."receivables"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_lines" ADD CONSTRAINT "receivable_lines_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_write_off_approval_fk" FOREIGN KEY ("tenant_id","write_off_approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoice_fk" FOREIGN KEY ("tenant_id","branch_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paid_by_fk" FOREIGN KEY ("tenant_id","paid_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_receivable_fk" FOREIGN KEY ("tenant_id","receivable_id") REFERENCES "public"."receivables"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receivable_collections_receivable_idx" ON "receivable_collections" USING btree ("tenant_id","receivable_id");--> statement-breakpoint
CREATE INDEX "receivable_lines_receivable_idx" ON "receivable_lines" USING btree ("tenant_id","receivable_id");--> statement-breakpoint
CREATE INDEX "receivables_patient_idx" ON "receivables" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "refunds_line_idx" ON "refunds" USING btree ("tenant_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "refunds_patient_idx" ON "refunds" USING btree ("tenant_id","patient_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_check" CHECK ("stock_movements"."kind" in ('receive','adjust','issue','consume','return','waste','transfer_out','transfer_in','supplier_return','dispense') and "stock_movements"."quantity" between -1000000000 and 1000000000 and scale("stock_movements"."quantity") <= 4 and "stock_movements"."quantity" <> 0
      and "stock_movements"."balance_after" between 0 and 1000000000 and scale("stock_movements"."balance_after") <= 4 and "stock_movements"."source_kind" ~ '^[a-z][a-z_]{1,40}$'
      and ("stock_movements"."reason" is null or length(btrim("stock_movements"."reason")) between 3 and 500)
      and "stock_movements"."depot_balance_after" between 0 and 1000000000 and scale("stock_movements"."depot_balance_after") <= 4
      and ("stock_movements"."kind" = 'receive' and "stock_movements"."leg" is null and "stock_movements"."quantity" > 0
           or "stock_movements"."kind" = 'adjust' and "stock_movements"."leg" is null
           or "stock_movements"."kind" in ('consume','waste','supplier_return','dispense') and "stock_movements"."leg" is null and "stock_movements"."quantity" < 0
           or "stock_movements"."kind" = 'transfer_out' and "stock_movements"."leg" is not distinct from 'out' and "stock_movements"."quantity" < 0
           or "stock_movements"."kind" = 'transfer_in' and "stock_movements"."leg" is not distinct from 'in' and "stock_movements"."quantity" > 0
           or "stock_movements"."kind" in ('issue','return') and ("stock_movements"."leg" is not distinct from 'out' and "stock_movements"."quantity" < 0
                                                  or "stock_movements"."leg" is not distinct from 'in' and "stock_movements"."quantity" > 0)
           -- T-078 (DATA-61, scenario 15 J2): a product a patient returns on a refund comes back with no leg.
           or "stock_movements"."kind" = 'return' and "stock_movements"."leg" is null and "stock_movements"."quantity" > 0 and "stock_movements"."source_kind" = 'refund'));--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_t076_check" CHECK ("invoice_lines"."cancelled_amount" between 0 and "invoice_lines"."line_total" and "invoice_lines"."moved_to_balance" between 0 and "invoice_lines"."line_total"
      and "invoice_lines"."cancelled_amount" + "invoice_lines"."moved_to_balance" <= "invoice_lines"."line_total" and "invoice_lines"."vat_reversed_amount" between 0 and "invoice_lines"."vat_recognised_amount"
      and "invoice_lines"."receivable_amount" between 0 and "invoice_lines"."line_total" and "invoice_lines"."cancelled_amount" + "invoice_lines"."moved_to_balance" + "invoice_lines"."receivable_amount" <= "invoice_lines"."line_total"
      and (("invoice_lines"."vat_reversed_amount" > 0) = ("invoice_lines"."vat_reversed_at" is not null)));--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_check" CHECK (num_nonnulls("payment_allocations"."invoice_line_id", "payment_allocations"."top_up_id", "payment_allocations"."booking_deposit_id", "payment_allocations"."receivable_id") = 1 and "payment_allocations"."amount" between 1 and 1000000000000
      and "payment_allocations"."vat_portion" between 0 and "payment_allocations"."amount" and "payment_allocations"."method" in ('cash','edc','transfer','qris','va','payment_link','balance') and "payment_allocations"."environment" in ('production','staging','demo','local'));--> statement-breakpoint

-- T-078 rules (generated by gen.py; plan docs/tasks/T-078.md)
-- ── T-078 helpers ──
-- The FKs and indexes of the new allocation target (DATA-28): many collections per receivable, one allocation per payment.
ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_receivable_fk FOREIGN KEY (tenant_id, receivable_id)
  REFERENCES public.receivables (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE UNIQUE INDEX payment_allocations_receivable_payment_key ON public.payment_allocations (tenant_id, payment_id) WHERE receivable_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX payment_allocations_receivable_idx ON public.payment_allocations (tenant_id, receivable_id) WHERE receivable_id IS NOT NULL;--> statement-breakpoint

-- SET-11 (B-04): a manager may decide a cash refund only where the tenant's setting is owner_manager.
UPDATE public.approval_types SET approver_roles = '{owner,manager}' WHERE key = 'refund_exception';--> statement-breakpoint
CREATE FUNCTION public.refund_manager_may_decide(p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((public.setting_value_at('SET-11', NULL, p_at) #>> '{}') = 'owner_manager', false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_manager_may_decide(timestamptz) FROM PUBLIC;--> statement-breakpoint
-- For the inbox: whether a manager may decide this refund approval now.
CREATE FUNCTION public.approval_manager_decides_refund(p_approval uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT public.refund_manager_may_decide(clock_timestamp())
                     FROM public.approvals ap WHERE ap.tenant_id = public.app_tenant_id() AND ap.id = p_approval AND ap.type = 'refund_exception'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approval_manager_decides_refund(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approval_manager_decides_refund(uuid) TO clinic_app;--> statement-breakpoint

-- The room a pending cash refund holds on its line (requested or approved, not yet paid): the shared moved_to_balance ceiling
-- (r1 #8) subtracts it, so an interrupted move or a package close cannot take the same paid value.
CREATE FUNCTION public.refund_reserved(p_tenant uuid, p_line uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(sum(r.amount), 0)::bigint FROM public.refunds r
   WHERE r.tenant_id = p_tenant AND r.invoice_line_id = p_line AND r.state IN ('requested','approved')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_reserved(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Who reads refunds and receivables: the Kasir readers of the branch.
CREATE FUNCTION public.receivable_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.kasir_readable(p_tenant, p_branch)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.receivable_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.receivable_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Whether a line was delivered (decided once at refund request, stored): a product line has a handed dispensing for it
-- (counter) or for its visit and item; a service line has a finished counted execution on the visit for that service.
CREATE FUNCTION public.refund_line_delivered(l public.invoice_lines, i public.invoices) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.dispensings d WHERE d.tenant_id = l.tenant_id AND d.invoice_line_id = l.id AND d.state = 'handed')
      OR i.visit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.dispensings d JOIN public.stock_items si ON si.tenant_id = d.tenant_id AND si.id = d.stock_item_id
                                             WHERE d.tenant_id = l.tenant_id AND d.visit_id = i.visit_id AND d.state = 'handed' AND si.catalog_item_id = l.item_id)
      OR i.visit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.treatment_executions e JOIN public.plan_items t ON t.tenant_id = e.tenant_id AND t.id = e.plan_item_id
                                             WHERE e.tenant_id = l.tenant_id AND e.visit_id = i.visit_id AND e.state = 'finished' AND e.counted
                                               AND (t.id = l.plan_item_id OR public.package_plan_service(t.tenant_id, t.id) = l.item_id))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_line_delivered(public.invoice_lines, public.invoices) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY refunds_read ON public.refunds FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.receivable_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, patient_id, invoice_id, invoice_line_id, amount, destination, state, delivered, vat_reversed, returned_quantity, approval_id, balance_entry_id, cash_entry_id, paid_method, failure_code, requested_by, requested_as, requested_at, paid_by, paid_as, paid_at, command_key, pay_key) ON public.refunds TO clinic_app;--> statement-breakpoint
CREATE POLICY refunds_operator_read ON public.refunds FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.refunds', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, patient_id, invoice_id, invoice_line_id, amount, destination, state, delivered, vat_reversed, returned_quantity, approval_id, balance_entry_id, cash_entry_id, paid_method, failure_code, requested_by, requested_as, requested_at, paid_by, paid_as, paid_at, command_key, pay_key) ON public.refunds TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER refunds_no_truncate BEFORE TRUNCATE ON public.refunds FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.refunds ENABLE ALWAYS TRIGGER refunds_no_truncate;--> statement-breakpoint
ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receivables_read ON public.receivables FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.receivable_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.receivables TO clinic_app;--> statement-breakpoint
CREATE POLICY receivables_operator_read ON public.receivables FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.receivables', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.receivables TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER receivables_no_truncate BEFORE TRUNCATE ON public.receivables FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.receivables ENABLE ALWAYS TRIGGER receivables_no_truncate;--> statement-breakpoint
ALTER TABLE public.receivable_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receivable_lines_read ON public.receivable_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.receivable_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.receivable_lines TO clinic_app;--> statement-breakpoint
CREATE POLICY receivable_lines_operator_read ON public.receivable_lines FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.receivable_lines', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.receivable_lines TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER receivable_lines_no_truncate BEFORE TRUNCATE ON public.receivable_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.receivable_lines ENABLE ALWAYS TRIGGER receivable_lines_no_truncate;--> statement-breakpoint
ALTER TABLE public.receivable_collections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receivable_collections_read ON public.receivable_collections FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.receivable_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.receivable_collections TO clinic_app;--> statement-breakpoint
CREATE POLICY receivable_collections_operator_read ON public.receivable_collections FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.receivable_collections', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.receivable_collections TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER receivable_collections_no_truncate BEFORE TRUNCATE ON public.receivable_collections FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.receivable_collections ENABLE ALWAYS TRIGGER receivable_collections_no_truncate;--> statement-breakpoint
ALTER TABLE public.write_offs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY write_offs_read ON public.write_offs FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.receivable_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, receivable_id, amount, approval_id, owner_self, requested_by, approved_by, command_key, created_at) ON public.write_offs TO clinic_app;--> statement-breakpoint
CREATE POLICY write_offs_operator_read ON public.write_offs FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.write_offs', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, receivable_id, amount, approval_id, owner_self, requested_by, approved_by, command_key, created_at) ON public.write_offs TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER write_offs_no_truncate BEFORE TRUNCATE ON public.write_offs FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.write_offs ENABLE ALWAYS TRIGGER write_offs_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.refunds', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'receivables definers (src/modules/cashier/receivables)', 'the invoice''s branch'),
  ('public.receivables', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'receivables definers (src/modules/cashier/receivables)', 'the visit''s branch'),
  ('public.receivable_lines', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'receivables definers (src/modules/cashier/receivables)', 'the visit''s branch'),
  ('public.receivable_collections', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'receivables definers (src/modules/cashier/receivables)', 'the collecting branch'),
  ('public.write_offs', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'receivables definers (src/modules/cashier/receivables)', 'the receivable''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): refunds, receivables, collections and write-offs are personal; receivable lines are money totals.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.refunds', 'personal'),
  ('public.receivables', 'personal'),
  ('public.receivable_lines', 'money_total'),
  ('public.receivable_collections', 'personal'),
  ('public.write_offs', 'personal');--> statement-breakpoint

-- ── T-078 guards (each takes the staff_access lock first; never deleted; insert-only except the guarded transitions) ──
-- refunds: inserted requested (cash) or paid (balance); a cash refund moves requested → approved → paid, or requested|approved → failed.
CREATE FUNCTION public.refunds_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refunds are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.destination = 'balance' AND NEW.state = 'paid' OR NEW.destination = 'cash' AND NEW.state = 'requested')
       OR NOT EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                       WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.invoice_line_id AND i.id = NEW.invoice_id AND i.branch_id = NEW.branch_id
                         AND i.state = 'issued' AND public.patient_canonical(i.tenant_id, i.patient_id) = NEW.patient_id)
       OR NEW.destination = 'cash' AND NOT EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = NEW.tenant_id AND ap.id = NEW.approval_id
                                                    AND ap.type = 'refund_exception' AND ap.subject_kind = 'refund' AND ap.subject_id = NEW.id
                                                    AND ap.state = 'pending' AND ap.amount_rupiah = NEW.amount) THEN
      RAISE EXCEPTION 'a refund is taken from its issued line, with its own approval when in cash' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.invoice_id, NEW.invoice_line_id, NEW.amount, NEW.destination, NEW.delivered,
      NEW.returned_quantity, NEW.reason, NEW.approval_id, NEW.requested_by, NEW.requested_as, NEW.requested_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.invoice_id, OLD.invoice_line_id, OLD.amount, OLD.destination, OLD.delivered,
      OLD.returned_quantity, OLD.reason, OLD.approval_id, OLD.requested_by, OLD.requested_as, OLD.requested_at, OLD.command_key)
     OR NOT (OLD.state = 'requested' AND NEW.state IN ('approved','failed') OR OLD.state = 'approved' AND NEW.state IN ('paid','failed'))
     OR NEW.state <> 'paid' AND (NEW.balance_entry_id, NEW.cash_entry_id, NEW.paid_by, NEW.pay_key) IS DISTINCT FROM (OLD.balance_entry_id, OLD.cash_entry_id, OLD.paid_by, OLD.pay_key) THEN
    RAISE EXCEPTION 'a cash refund moves requested, approved, paid or failed once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER refunds_guard BEFORE INSERT OR UPDATE OR DELETE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.refunds_guard();--> statement-breakpoint
ALTER TABLE public.refunds ENABLE ALWAYS TRIGGER refunds_guard;--> statement-breakpoint

-- receivables: inserted open with no collection; only collected_amount grows, written_off_amount is set once, the write-off link
-- is set from null or cleared; the state follows the amounts (the CHECK).
CREATE FUNCTION public.receivables_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receivables are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open' OR NEW.collected_amount <> 0 OR NEW.written_off_amount <> 0 OR NEW.write_off_approval_id IS NOT NULL THEN
      RAISE EXCEPTION 'a receivable opens with nothing collected' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.visit_id, NEW.amount, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.visit_id, OLD.amount, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at)
     OR OLD.state <> 'open' OR NEW.collected_amount < OLD.collected_amount OR OLD.written_off_amount <> 0 AND NEW.written_off_amount <> OLD.written_off_amount
     OR NEW.write_off_approval_id IS NOT NULL AND OLD.write_off_approval_id IS NOT NULL AND NEW.write_off_approval_id <> OLD.write_off_approval_id THEN
    RAISE EXCEPTION 'a receivable is only collected or written off' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER receivables_guard BEFORE INSERT OR UPDATE OR DELETE ON public.receivables FOR EACH ROW EXECUTE FUNCTION public.receivables_guard();--> statement-breakpoint
ALTER TABLE public.receivables ENABLE ALWAYS TRIGGER receivables_guard;--> statement-breakpoint

CREATE TRIGGER receivable_lines_insert_only BEFORE UPDATE OR DELETE ON public.receivable_lines FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.receivable_lines ENABLE ALWAYS TRIGGER receivable_lines_insert_only;--> statement-breakpoint
CREATE TRIGGER receivable_collections_insert_only BEFORE UPDATE OR DELETE ON public.receivable_collections FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.receivable_collections ENABLE ALWAYS TRIGGER receivable_collections_insert_only;--> statement-breakpoint
CREATE TRIGGER write_offs_insert_only BEFORE UPDATE OR DELETE ON public.write_offs FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.write_offs ENABLE ALWAYS TRIGGER write_offs_insert_only;--> statement-breakpoint

-- ── T-078 refunds (PR-21, B-04, B-11, BILL-12, DATA-33, DATA-61; scenarios 9, 15) ──
-- The settlement of a refund, in the caller's transaction: the line's paid value moves to the patient balance (moved_to_balance,
-- the shared ceiling), the VAT reverses in proportion (the interrupted_to_balance formula, capped at what is recognised and not
-- yet reversed), from_refund credits the balance; a cash refund then debits it (cash_refund). A returned product comes back to
-- the batch and depot it was dispensed from (kind return, no leg; valued at the moving average) with ProductReturned; an
-- undelivered product line's queued or prepared dispensing is cancelled. Returns the VAT and the entries; the caller records the
-- refund paid (a balance refund is inserted paid after this; a cash refund is updated approved → paid).
CREATE FUNCTION public.refund_settle(r public.refunds, p_staff uuid, p_role text, p_method text,
                                     OUT o_vat bigint, OUT o_credit uuid, OUT o_cash uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  i public.invoices;
  v_vat bigint;
  dl record;
  v_left integer;
  v_q numeric;
  v_disp uuid;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = r.tenant_id AND x.id = r.invoice_id;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = r.tenant_id AND x.id = r.invoice_line_id FOR UPDATE;
  v_vat := least(l.vat_recognised_amount - l.vat_reversed_amount, CASE WHEN l.line_total = 0 THEN 0 ELSE (l.vat_recognised_amount * r.amount) / l.line_total END);
  UPDATE public.invoice_lines SET moved_to_balance = moved_to_balance + r.amount,
         vat_reversed_amount = vat_reversed_amount + v_vat,
         vat_reversed_at = CASE WHEN vat_reversed_amount + v_vat > 0 THEN coalesce(vat_reversed_at, clock_timestamp()) END
   WHERE tenant_id = l.tenant_id AND id = l.id;
  o_vat := v_vat;
  o_credit := public.balance_post(r.tenant_id, r.patient_id, r.branch_id, 'from_refund', r.amount,
                                  jsonb_build_object('source_kind', 'refund', 'source_id', r.id), 'refund:' || r.id::text, p_staff, p_role);
  IF r.destination = 'cash' THEN
    o_cash := public.balance_post(r.tenant_id, r.patient_id, r.branch_id, 'cash_refund', -r.amount,
                                  jsonb_build_object('source_kind', 'refund', 'source_id', r.id), 'cash_refund:' || r.id::text, p_staff, p_role);
  END IF;
  -- The returned product (scenario 15 J2): back to its dispensed batches and depot, newest batch last.
  IF r.returned_quantity IS NOT NULL THEN
    v_left := r.returned_quantity;
    FOR dl IN SELECT d.id AS disp, d.depot_id, x.batch_id, x.quantity FROM public.dispensings d JOIN public.dispensing_lines x ON x.tenant_id = d.tenant_id AND x.dispensing_id = d.id
               WHERE d.tenant_id = r.tenant_id AND d.state = 'handed'
                 AND (d.invoice_line_id = l.id OR i.visit_id IS NOT NULL AND d.visit_id = i.visit_id
                      AND EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = d.tenant_id AND si.id = d.stock_item_id AND si.catalog_item_id = l.item_id))
               ORDER BY d.handed_at, x.id LOOP
      EXIT WHEN v_left <= 0;
      v_q := least(v_left, dl.quantity);
      PERFORM public.stock_move_depot(r.tenant_id, dl.batch_id, dl.depot_id, 'return', v_q, NULL, 'refund', r.id, p_staff, p_role, NULL);
      v_left := v_left - v_q::integer;
      v_disp := dl.disp;
    END LOOP;
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (r.tenant_id, r.branch_id, 'ProductReturned', 'refund', r.id, p_staff, p_role, jsonb_build_object('refund_id', r.id, 'dispensing_id', v_disp));
  END IF;
  IF NOT r.delivered THEN
    UPDATE public.dispensings d SET state = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = p_staff, cancel_reason = 'Dikembalikan ke pasien'
     WHERE d.tenant_id = r.tenant_id AND d.invoice_line_id = l.id AND d.state IN ('queued','prepared');
    IF i.visit_id IS NOT NULL THEN
      PERFORM public.pharmacy_visit_steps(i.tenant_id, i.visit_id);
    END IF;
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (r.tenant_id, r.branch_id, 'RefundPaid', 'refund', r.id, p_staff, p_role,
          jsonb_build_object('refund_id', r.id, 'destination', r.destination) || CASE WHEN p_method IS NOT NULL THEN jsonb_build_object('method', p_method) ELSE '{}'::jsonb END);
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_settle(public.refunds, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- Ajukan Refund (PR-21 default balance; B-04 cash exception): owner, manager, FO/cashier, finance (kasir_actor). The owner may refund
-- to balance only (a cash refund needs another approver). A line of an issued patient invoice, fully paid, not a package line, not on a
-- receivable; the amount within its room (paid − moved − reserved).
CREATE FUNCTION public.refund_request(p_key text, p_line uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  l public.invoice_lines;
  i public.invoices;
  r public.refunds;
  v_dest text;
  v_amount bigint;
  v_room bigint;
  v_id uuid := public.uuid_generate_v7();
  v_approval uuid;
  v_delivered boolean;
  v_qty integer;
  v_handed numeric;
  s record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'amount' - 'destination' - 'reason' - 'returned_quantity' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^[1-9]\d{0,12}$'
     OR coalesce(p ->> 'destination', 'balance') NOT IN ('balance','cash') OR length(btrim(coalesce(p ->> 'reason', ''))) NOT BETWEEN 3 AND 500
     OR p ? 'returned_quantity' AND (jsonb_typeof(p -> 'returned_quantity') IS DISTINCT FROM 'number' OR (p ->> 'returned_quantity') !~ '^[1-9]\d{0,4}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refund' USING ERRCODE = '22023';
  END IF;
  v_dest := coalesce(p ->> 'destination', 'balance');
  v_amount := (p ->> 'amount')::bigint;
  v_qty := (p ->> 'returned_quantity')::integer;
  -- Replay: the same key returns its refund.
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF r.id IS NOT NULL THEN
    IF r.invoice_line_id <> p_line OR r.amount <> v_amount OR r.destination <> v_dest THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a refund with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('refund_id', r.id, 'state', r.state, 'approval_id', r.approval_id);
  END IF;
  SELECT x.* INTO l FROM public.invoice_lines x WHERE x.tenant_id = a.tenant_id AND x.id = p_line;
  SELECT x.* INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = l.invoice_id;
  IF l.id IS NULL OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: line not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT x.* INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = l.invoice_id FOR UPDATE;
  SELECT x.* INTO l FROM public.invoice_lines x WHERE x.tenant_id = a.tenant_id AND x.id = p_line FOR UPDATE;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF i.patient_id IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_without_patient' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: package_line' USING ERRCODE = '55000';
  END IF;
  -- Before line_unpaid: a converted remainder is never paid on the line, so that check would always answer first.
  IF l.receivable_amount > 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: line_on_receivable' USING ERRCODE = '55000';
  END IF;
  IF l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: line_unpaid' USING ERRCODE = '55000';
  END IF;
  v_room := public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(l.tenant_id, l.id);
  IF v_amount > v_room THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: refund_above_paid' USING ERRCODE = '55000';
  END IF;
  IF v_dest = 'cash' AND a.role = 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an owner refunds to balance; a cash refund is requested by staff' USING ERRCODE = '42501';
  END IF;
  v_delivered := public.refund_line_delivered(l, i);
  IF v_qty IS NOT NULL THEN
    v_handed := (SELECT coalesce(sum(x.quantity), 0) FROM public.dispensings d JOIN public.dispensing_lines x ON x.tenant_id = d.tenant_id AND x.dispensing_id = d.id
                  WHERE d.tenant_id = l.tenant_id AND d.state = 'handed'
                    AND (d.invoice_line_id = l.id OR i.visit_id IS NOT NULL AND d.visit_id = i.visit_id
                         AND EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = d.tenant_id AND si.id = d.stock_item_id AND si.catalog_item_id = l.item_id)))
                - (SELECT coalesce(sum(y.returned_quantity), 0) FROM public.refunds y WHERE y.tenant_id = l.tenant_id AND y.invoice_line_id = l.id
                    AND y.state IN ('requested','approved','paid'));
    IF NOT v_delivered OR v_qty > v_handed THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: returned_quantity' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_dest = 'cash' THEN
    v_approval := public.approval_request('refund_exception', 'refund', v_id, btrim(p ->> 'reason'), i.branch_id, v_amount);
  END IF;
  r := ROW(v_id, a.tenant_id, i.branch_id, public.patient_canonical(i.tenant_id, i.patient_id), i.id, l.id, v_amount, v_dest, 'requested', v_delivered, 0, v_qty,
           btrim(p ->> 'reason'), v_approval, NULL, NULL, NULL, NULL, NULL, a.staff_id, a.role, clock_timestamp(), NULL, NULL, NULL, p_key, NULL)::public.refunds;
  IF v_dest = 'balance' THEN
    SELECT * INTO s FROM public.refund_settle(r, a.staff_id, a.role, NULL);
  ELSE
    SELECT 0::bigint AS o_vat, NULL::uuid AS o_credit, NULL::uuid AS o_cash INTO s;
  END IF;
  INSERT INTO public.refunds (id, tenant_id, branch_id, patient_id, invoice_id, invoice_line_id, amount, destination, state, delivered, vat_reversed, returned_quantity,
                              reason, approval_id, balance_entry_id, paid_by, paid_as, paid_at, requested_by, requested_as, command_key)
  VALUES (v_id, a.tenant_id, i.branch_id, r.patient_id, i.id, l.id, v_amount, v_dest, CASE WHEN v_dest = 'balance' THEN 'paid' ELSE 'requested' END,
          v_delivered, coalesce(s.o_vat, 0), v_qty, btrim(p ->> 'reason'), v_approval, s.o_credit,
          CASE WHEN v_dest = 'balance' THEN a.staff_id END, CASE WHEN v_dest = 'balance' THEN a.role END, CASE WHEN v_dest = 'balance' THEN clock_timestamp() END,
          a.staff_id, a.role, p_key);
  PERFORM public.audit_append('money_correction', 'refund', v_id, 'success', CASE WHEN v_dest = 'balance' THEN 'refund_to_balance' ELSE 'refund_cash_requested' END);
  RETURN jsonb_build_object('refund_id', v_id, 'state', CASE WHEN v_dest = 'balance' THEN 'paid' ELSE 'requested' END, 'approval_id', v_approval);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_request(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.refund_request(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Bayar Refund Tunai: an approved cash refund is paid at the drawer (cash or transfer, SET-14). Owner, manager, FO/cashier, finance.
CREATE FUNCTION public.refund_pay(p_key text, p_refund uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  r public.refunds;
  i public.invoices;
  s record;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'method' - 'details' <> '{}'::jsonb OR coalesce(p ->> 'method', '') NOT IN ('cash','transfer')
     OR p ? 'details' AND (p ->> 'method' <> 'transfer' OR jsonb_typeof(p -> 'details') IS DISTINCT FROM 'object'
                           OR (p -> 'details') - 'bank' - 'reference' <> '{}'::jsonb
                           OR EXISTS (SELECT 1 FROM jsonb_each(p -> 'details') x WHERE jsonb_typeof(x.value) <> 'string' OR length(x.value #>> '{}') NOT BETWEEN 1 AND 60))
     OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: refund_pay' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = a.tenant_id AND x.id = p_refund;
  IF r.id IS NULL OR a.branch_id IS NOT NULL AND r.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: refund not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.state = 'paid' AND r.pay_key = p_key THEN
    RETURN jsonb_build_object('refund_id', r.id, 'state', r.state);
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = r.tenant_id AND x.id = r.invoice_id;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = a.tenant_id AND x.id = p_refund FOR UPDATE;
  IF r.state <> 'approved' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: refund %', r.state USING ERRCODE = '55000';
  END IF;
  IF NOT public.kasir_method_enabled(p ->> 'method', clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO s FROM public.refund_settle(r, a.staff_id, a.role, p ->> 'method');
  UPDATE public.refunds SET state = 'paid', vat_reversed = s.o_vat, balance_entry_id = s.o_credit, cash_entry_id = s.o_cash, paid_method = p ->> 'method',
         paid_details = p -> 'details', paid_by = a.staff_id, paid_as = a.role, paid_at = clock_timestamp(), pay_key = p_key
   WHERE tenant_id = r.tenant_id AND id = r.id;
  PERFORM public.audit_append('money_correction', 'refund', r.id, 'success', 'refund_cash_paid');
  RETURN jsonb_build_object('refund_id', r.id, 'state', 'paid');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_pay(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.refund_pay(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- The cash refund approval (pattern invoice_void_sync): a manager decides only where SET-11 allows; approved → the refund approved
-- (RefundApproved); rejected or cancelled → failed (the room freed). Linked by refunds.approval_id only.
CREATE FUNCTION public.refund_exception_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.refunds;
BEGIN
  IF NEW.type <> 'refund_exception' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  IF NEW.state IN ('approved','rejected') AND NEW.decided_as = 'manager' AND NOT public.refund_manager_may_decide(clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner may decide this refund' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = NEW.tenant_id AND x.approval_id = NEW.id FOR UPDATE;
  IF r.id IS NULL OR r.state <> 'requested' THEN
    RETURN NULL;
  END IF;
  IF NEW.state = 'approved' THEN
    UPDATE public.refunds SET state = 'approved' WHERE tenant_id = r.tenant_id AND id = r.id;
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (r.tenant_id, r.branch_id, 'RefundApproved', 'refund', r.id, NEW.decided_by, NEW.decided_as, jsonb_build_object('refund_id', r.id, 'approval_id', NEW.id));
  ELSE
    UPDATE public.refunds SET state = 'failed', failure_code = NEW.state WHERE tenant_id = r.tenant_id AND id = r.id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_exception_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_refund_exception_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.refund_exception_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_refund_exception_sync;--> statement-breakpoint

-- ── T-078 receivables (PR-15 module level, B-18, BILL-22, DATA-32; scenario 3b) ──
-- Jadikan Piutang: FO/cashier, manager or owner convert an open visit's delivered unpaid remainder (every issued invoice of the
-- visit, the addition invoices included) to one receivable, so the visit can close. Undelivered remainders stay owed. A pending
-- void of a convertible invoice refuses (void_pending); an unbilled counted addition refuses (unbilled_addition). On a PKP line
-- the remaining VAT is recognised now (DATA-32: VAT stays with the line). Pending port charges of the converted invoices cancel.
CREATE FUNCTION public.receivable_convert(p_key text, p_visit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  v public.visits;
  v_lines uuid[];
  v_invs uuid[];
  v_rems bigint[];
  v_id uuid := public.uuid_generate_v7();
  v_sum bigint := 0;
  r public.receivables;
BEGIN
  IF a.role NOT IN ('owner','manager','fo_cashier') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not convert to a receivable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.receivables x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF r.id IS NOT NULL THEN
    IF r.visit_id <> p_visit THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receivable with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('receivable_id', r.id, 'amount', r.amount);
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit AND (a.branch_id IS NULL OR x.branch_id = a.branch_id) FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  IF public.addition_unbilled_counted(v.tenant_id, v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: unbilled_addition' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.invoices i WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued' ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
   WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued' ORDER BY l.id FOR UPDATE OF l;
  -- The convertible lines: a delivered remainder (arrays, in line order).
  SELECT coalesce(array_agg(l.id ORDER BY l.id), '{}'), coalesce(array_agg(i.id ORDER BY l.id), '{}'),
         coalesce(array_agg(l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id), '{}')
    INTO v_lines, v_invs, v_rems
    FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
   WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued'
     AND l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0
     AND public.refund_line_delivered(l, i);
  v_sum := coalesce((SELECT sum(x) FROM unnest(v_rems) x), 0);
  IF v_sum = 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing_to_convert' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = v.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = ANY (v_invs) AND ap.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: void_pending' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.receivables (id, tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by, created_as)
  VALUES (v_id, v.tenant_id, v.branch_id, public.patient_canonical(v.tenant_id, v.patient_id), v.id, v_sum, p_key, a.staff_id, a.role);
  FOR k IN 1 .. cardinality(v_lines) LOOP
    INSERT INTO public.receivable_lines (tenant_id, branch_id, receivable_id, invoice_line_id, amount) VALUES (v.tenant_id, v.branch_id, v_id, v_lines[k], v_rems[k]);
    UPDATE public.invoice_lines SET receivable_amount = v_rems[k],
           vat_recognised_amount = greatest(vat_recognised_amount, vat_amount),
           vat_recognised_at = CASE WHEN vat_amount > 0 THEN coalesce(vat_recognised_at, clock_timestamp()) ELSE vat_recognised_at END
     WHERE tenant_id = v.tenant_id AND id = v_lines[k];
    UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = v.tenant_id AND invoice_id = v_invs[k] AND state = 'pending';
  END LOOP;
  PERFORM public.kasir_visit_payment(v.tenant_id, v.id);
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (v.tenant_id, v.branch_id, 'ReceivableCreated', 'receivable', v_id, a.staff_id, a.role, jsonb_build_object('receivable_id', v_id, 'visit_id', v.id));
  PERFORM public.audit_append('money_correction', 'receivable', v_id, 'success', 'receivable_created');
  RETURN jsonb_build_object('receivable_id', v_id, 'amount', v_sum);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.receivable_convert(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.receivable_convert(text, uuid) TO clinic_app;--> statement-breakpoint

-- Tagih Piutang (BILL-22; DATA-32): owner, manager, FO/cashier or finance collect part or all of an open receivable at any branch's
-- Kasir of the tenant-wide roles or the receivable's branch for branch roles. A KW receipt and one payment with no invoice allocated
-- to the receivable (no revenue, no VAT: they stay with the originating line). Cash, EDC, transfer (SET-14) or the patient balance.
-- Insert order (r1 #3): receipt → collection → payment → (balance use) → allocation.
CREATE FUNCTION public.receivable_collect(p_key text, p_receivable uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  r public.receivables;
  b public.branches;
  v_at timestamptz := clock_timestamp();
  v_amount bigint;
  v_open bigint;
  v_number text;
  v_receipt uuid;
  v_pay uuid;
  v_body text;
  v_method text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'method' - 'amount' - 'cash_tendered' - 'details' <> '{}'::jsonb
     OR coalesce(p ->> 'method', '') NOT IN ('cash','edc','transfer','balance') OR jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^[1-9]\d{0,12}$'
     OR (p ->> 'method' = 'cash') <> (p ? 'cash_tendered')
     OR p ? 'cash_tendered' AND (jsonb_typeof(p -> 'cash_tendered') IS DISTINCT FROM 'number' OR (p ->> 'cash_tendered') !~ '^[1-9]\d{0,12}$'
                                   OR (p ->> 'cash_tendered')::bigint < (p ->> 'amount')::bigint)
     OR p ? 'details' AND (p ->> 'method' NOT IN ('edc','transfer') OR jsonb_typeof(p -> 'details') IS DISTINCT FROM 'object'
                           OR (p -> 'details') - 'card_type' - 'bank' - 'trace' - 'approval_code' - 'reference' <> '{}'::jsonb
                           OR EXISTS (SELECT 1 FROM jsonb_each(p -> 'details') d WHERE jsonb_typeof(d.value) <> 'string' OR length(d.value #>> '{}') NOT BETWEEN 1 AND 60)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: collect' USING ERRCODE = '22023';
  END IF;
  v_method := p ->> 'method';
  v_amount := (p ->> 'amount')::bigint;
  SELECT * INTO r FROM public.receivables x WHERE x.tenant_id = a.tenant_id AND x.id = p_receivable FOR UPDATE;
  IF r.id IS NULL OR a.branch_id IS NOT NULL AND r.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: receivable not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.state <> 'open' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: receivable %', r.state USING ERRCODE = '55000';
  END IF;
  v_open := r.amount - r.collected_amount - r.written_off_amount;
  IF v_amount > v_open THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: overpayment' USING ERRCODE = '22023';
  END IF;
  IF NOT public.kasir_method_enabled(v_method, v_at) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = r.tenant_id AND x.id = coalesce(a.branch_id, r.branch_id);
  v_number := public.kasir_next_number(r.tenant_id, b.id, 'KW');
  v_body := (SELECT t.legal_name FROM public.tenants t WHERE t.id = r.tenant_id) || E'\n' || b.name || coalesce(' · ' || b.address, '') || E'\n\nStruk ' || v_number
            || E'\n' || to_char((v_at AT TIME ZONE b.timezone), 'DD-MM-YYYY HH24:MI')
            || E'\n\nPelunasan piutang pasien ' || (SELECT pt.mrn FROM public.patients pt WHERE pt.tenant_id = r.tenant_id AND pt.id = r.patient_id)
            || E'\n\nTotal dibayar Rp' || replace(to_char(v_amount, 'FM999G999G999G999'), ',', '.')
            || E'\nSisa piutang Rp' || replace(to_char(v_open - v_amount, 'FM999G999G999G999'), ',', '.')
            || E'\n' || CASE v_method WHEN 'cash' THEN 'Tunai' WHEN 'edc' THEN 'EDC' WHEN 'transfer' THEN 'Transfer' ELSE 'Saldo' END
            || ' Rp' || replace(to_char(v_amount, 'FM999G999G999G999'), ',', '.');
  BEGIN
    INSERT INTO public.receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, is_simulated, command_key, issued_by, issued_as, issued_at)
    VALUES (r.tenant_id, b.id, NULL, v_number, v_amount, v_body, '80mm', false, p_key, a.staff_id, a.role, v_at)
    RETURNING id INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
  END;
  INSERT INTO public.receivable_collections (tenant_id, branch_id, receivable_id, receipt_id, method, amount, command_key, received_by, received_as, received_at)
  VALUES (r.tenant_id, b.id, r.id, v_receipt, v_method, v_amount, p_key, a.staff_id, a.role, v_at);
  INSERT INTO public.payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                               environment, is_simulated, received_by, received_as, received_at)
  VALUES (r.tenant_id, b.id, v_receipt, 1, NULL, r.patient_id, v_method, v_amount, (p ->> 'cash_tendered')::bigint,
          CASE WHEN p ? 'cash_tendered' THEN (p ->> 'cash_tendered')::bigint - v_amount END, p -> 'details', 'production', false, a.staff_id, a.role, v_at)
  RETURNING id INTO v_pay;
  IF v_method = 'balance' THEN
    PERFORM public.balance_post(r.tenant_id, r.patient_id, b.id, 'use', -v_amount, jsonb_build_object('payment_id', v_pay), 'use:' || v_pay::text, a.staff_id, a.role);
  END IF;
  INSERT INTO public.payment_allocations (tenant_id, branch_id, payment_id, receivable_id, amount, vat_portion, method, environment, is_simulated)
  VALUES (r.tenant_id, b.id, v_pay, r.id, v_amount, 0, v_method, 'production', false);
  UPDATE public.receivables SET collected_amount = collected_amount + v_amount,
         state = CASE WHEN collected_amount + v_amount = amount THEN 'collected' ELSE 'open' END
   WHERE tenant_id = r.tenant_id AND id = r.id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (r.tenant_id, b.id, 'PaymentReceived', 'payment', v_pay, a.staff_id, a.role, jsonb_build_object('payment_id', v_pay, 'receivable_id', r.id)),
         (r.tenant_id, b.id, 'ReceivableCollected', 'receivable', r.id, a.staff_id, a.role, jsonb_build_object('receivable_id', r.id, 'payment_id', v_pay));
  PERFORM public.audit_append('money_correction', 'receivable', r.id, 'success', 'receivable_collected');
  RETURN jsonb_build_object('receipt_id', v_receipt, 'number', v_number, 'open', v_open - v_amount,
                            'change', CASE WHEN p ? 'cash_tendered' THEN (p ->> 'cash_tendered')::bigint - v_amount ELSE 0 END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.receivable_collect(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.receivable_collect(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- ── T-078 write-offs (PR-37, B-14, BILL-23, DATA-41; r1 #1) ──
-- The write-off of a receivable's whole open amount, in the caller's transaction (the owner alone, or the approval sync).
CREATE FUNCTION public.write_off_do(r public.receivables, p_approval uuid, p_reason text, p_owner_self boolean, p_requested_by uuid, p_approved_by uuid,
                                    p_staff uuid, p_role text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_open bigint := r.amount - r.collected_amount - r.written_off_amount;
  v_id uuid;
BEGIN
  IF r.state <> 'open' OR v_open <= 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: receivable_settled' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.write_offs (tenant_id, branch_id, receivable_id, amount, reason, approval_id, owner_self, requested_by, approved_by, command_key)
  VALUES (r.tenant_id, r.branch_id, r.id, v_open, btrim(p_reason), p_approval, p_owner_self, p_requested_by, p_approved_by, 'write_off:' || p_approval::text)
  RETURNING id INTO v_id;
  UPDATE public.receivables SET written_off_amount = v_open, state = 'written_off' WHERE tenant_id = r.tenant_id AND id = r.id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (r.tenant_id, r.branch_id, 'ReceivableWrittenOff', 'receivable', r.id, p_staff, p_role, jsonb_build_object('receivable_id', r.id, 'write_off_id', v_id));
  PERFORM public.audit_append('money_correction', 'receivable', r.id, 'success', 'receivable_written_off');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.write_off_do(public.receivables, uuid, text, boolean, uuid, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Ajukan Hapus Piutang: FO/cashier or finance request a write-off (approval_request admits only the write_off requester roles
-- and refuses a second pending request); the owner decides in Persetujuan.
CREATE FUNCTION public.receivable_write_off_request(p_receivable uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  r public.receivables;
  v_approval uuid;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.receivables x WHERE x.tenant_id = a.tenant_id AND x.id = p_receivable FOR UPDATE;
  IF r.id IS NULL OR a.branch_id IS NOT NULL AND r.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: receivable not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.state <> 'open' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: write_off_pending_or_settled' USING ERRCODE = '55000';
  END IF;
  v_approval := public.approval_request('write_off', 'receivable', r.id, btrim(p_reason), r.branch_id, r.amount - r.collected_amount - r.written_off_amount);
  UPDATE public.receivables SET write_off_approval_id = v_approval WHERE tenant_id = r.tenant_id AND id = r.id;
  RETURN v_approval;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.receivable_write_off_request(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.receivable_write_off_request(uuid, text) TO clinic_app;--> statement-breakpoint

-- Hapus Piutang (owner): the owner writes off alone (approval_owner_self: only the owner, reason ≥ 10, requester = approver, the reason on the row;
-- a pending request for the receivable refuses it: decide that one in Persetujuan).
CREATE FUNCTION public.receivable_write_off_owner(p_key text, p_receivable uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  r public.receivables;
  v_approval uuid;
  v_id uuid;
BEGIN
  SELECT * INTO r FROM public.receivables x WHERE x.tenant_id = a.tenant_id AND x.id = p_receivable FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: receivable not found' USING ERRCODE = 'P0002';
  END IF;
  v_approval := public.approval_owner_self('write_off', 'receivable', r.id, p_reason, r.branch_id, r.amount - r.collected_amount - r.written_off_amount);
  v_id := public.write_off_do(r, v_approval, p_reason, true, a.staff_id, a.staff_id, a.staff_id, a.role);
  RETURN jsonb_build_object('write_off_id', v_id, 'approval_id', v_approval);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.receivable_write_off_owner(text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.receivable_write_off_owner(text, uuid, text) TO clinic_app;--> statement-breakpoint

-- The write-off approval: linked by receivables.write_off_approval_id only; approved → written off; rejected or cancelled → the link cleared.
CREATE FUNCTION public.write_off_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.receivables;
BEGIN
  IF NEW.type <> 'write_off' OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM public.receivables x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.subject_id AND x.write_off_approval_id = NEW.id FOR UPDATE;
  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.state = 'approved' THEN
    PERFORM public.write_off_do(r, NEW.id, NEW.request_reason, false, NEW.requested_by, NEW.decided_by, NEW.decided_by, NEW.decided_as);
  ELSE
    UPDATE public.receivables SET write_off_approval_id = NULL WHERE tenant_id = r.tenant_id AND id = r.id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.write_off_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER approvals_write_off_sync AFTER UPDATE OF state ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.write_off_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_write_off_sync;--> statement-breakpoint

-- ── T-078 readers (UX-14; kasir_reader roles: owner, manager, FO/cashier, finance, auditor; the auditor masked) ──
-- Piutang & Refund: the branch's receivables (open first; aging buckets of SET-41 on the branch-local date), the refunds (with the
-- clinic-cause DP refunds read-only from booking_deposits), and the open visits with a convertible delivered remainder.
CREATE FUNCTION public.piutang_get(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(p_branch);
  v_mask boolean := a.role = 'auditor';
BEGIN
  RETURN jsonb_build_object(
    'role', a.role,
    'receivables', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'branch_id', r.branch_id, 'patient', public.kasir_patient_json(r.tenant_id, r.patient_id, v_mask), 'visit_id', r.visit_id,
        'amount', r.amount, 'collected', r.collected_amount, 'written_off', r.written_off_amount, 'open', r.amount - r.collected_amount - r.written_off_amount,
        'state', r.state, 'write_off_pending', r.write_off_approval_id IS NOT NULL, 'created_at', r.created_at,
        'age_days', (clock_timestamp() AT TIME ZONE b.timezone)::date - (r.created_at AT TIME ZONE b.timezone)::date,
        'bucket', CASE WHEN (clock_timestamp() AT TIME ZONE b.timezone)::date - (r.created_at AT TIME ZONE b.timezone)::date <= 30 THEN '0-30'
                       WHEN (clock_timestamp() AT TIME ZONE b.timezone)::date - (r.created_at AT TIME ZONE b.timezone)::date <= 60 THEN '31-60'
                       WHEN (clock_timestamp() AT TIME ZONE b.timezone)::date - (r.created_at AT TIME ZONE b.timezone)::date <= 90 THEN '61-90' ELSE '>90' END,
        'collector', (SELECT st.display_name FROM public.receivable_lines rl JOIN public.invoice_lines il ON il.tenant_id = rl.tenant_id AND il.id = rl.invoice_line_id
                        JOIN public.addition_releases ar ON ar.tenant_id = il.tenant_id AND ar.plan_item_id = il.plan_item_id
                        JOIN public.staff st ON st.tenant_id = ar.tenant_id AND st.id = ar.collector_staff_id
                       WHERE rl.tenant_id = r.tenant_id AND rl.receivable_id = r.id LIMIT 1),
        'created_by', (SELECT st.display_name FROM public.staff st WHERE st.tenant_id = r.tenant_id AND st.id = r.created_by),
        -- Asal tagihan: the converted lines (read here: a branch reader may not read invoice lines or catalog versions directly).
        'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('name', cv.name, 'amount', rl.amount) ORDER BY rl.id)
                             FROM public.receivable_lines rl JOIN public.invoice_lines il ON il.tenant_id = rl.tenant_id AND il.id = rl.invoice_line_id
                             JOIN public.catalog_versions cv ON cv.tenant_id = il.tenant_id AND cv.id = il.catalog_version_id
                            WHERE rl.tenant_id = r.tenant_id AND rl.receivable_id = r.id), '[]'::jsonb))
      ORDER BY r.state = 'open' DESC, r.created_at)
      FROM public.receivables r JOIN public.branches b ON b.tenant_id = r.tenant_id AND b.id = r.branch_id
     WHERE r.tenant_id = a.tenant_id AND (a.branch_id IS NULL OR r.branch_id = a.branch_id)), '[]'::jsonb),
    'refunds', coalesce((SELECT jsonb_agg(x ORDER BY x ->> 'requested_at' DESC) FROM (
        SELECT jsonb_build_object('id', f.id, 'kind', 'line', 'patient', public.kasir_patient_json(f.tenant_id, f.patient_id, v_mask),
          'invoice_id', f.invoice_id, 'amount', f.amount, 'destination', f.destination, 'state', f.state, 'delivered', f.delivered,
          'reason', CASE WHEN v_mask THEN NULL ELSE f.reason END, 'approval_id', f.approval_id, 'requested_at', f.requested_at, 'paid_at', f.paid_at) AS x
          FROM public.refunds f WHERE f.tenant_id = a.tenant_id AND (a.branch_id IS NULL OR f.branch_id = a.branch_id)
        UNION ALL
        SELECT jsonb_build_object('id', d.id, 'kind', 'deposit', 'patient', public.kasir_patient_json(d.tenant_id, d.patient_id, v_mask),
          'invoice_id', NULL, 'amount', d.amount, 'destination', 'cash', 'state', 'paid', 'delivered', false, 'reason', NULL, 'approval_id', NULL,
          'requested_at', d.decided_at, 'paid_at', d.decided_at)
          FROM public.booking_deposits d WHERE d.tenant_id = a.tenant_id AND d.state = 'refunded' AND (a.branch_id IS NULL OR d.branch_id = a.branch_id)) s), '[]'::jsonb),
    'convertible', coalesce((SELECT jsonb_agg(jsonb_build_object('visit_id', v.id, 'patient', public.kasir_patient_json(v.tenant_id, v.patient_id, v_mask),
        'amount', (SELECT sum(l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id))
                     FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                    WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued'
                      AND l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0 AND public.refund_line_delivered(l, i))))
      FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.closed_at IS NULL AND (a.branch_id IS NULL OR v.branch_id = a.branch_id)
        AND EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                     WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued'
                       AND l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0 AND public.refund_line_delivered(l, i))), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.piutang_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.piutang_get(uuid) TO clinic_app;--> statement-breakpoint

-- The refundable lines of an invoice (Ajukan Refund): each line's room, delivered flag, returnable quantity; why a line is not refundable.
CREATE FUNCTION public.refund_line_options(p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL);
  i public.invoices;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF i.id IS NULL OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('invoice_id', i.id, 'number', i.number, 'state', i.state,
    'patient', public.kasir_patient_json(i.tenant_id, i.patient_id, a.role = 'auditor'),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', ci.name, 'line_total', l.line_total,
        'room', greatest(0, public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(l.tenant_id, l.id)),
        'delivered', public.refund_line_delivered(l, i),
        'blocked', CASE WHEN i.state <> 'issued' THEN 'invoice_not_issued' WHEN i.patient_id IS NULL THEN 'invoice_without_patient'
                        WHEN EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id) THEN 'package_line'
                        WHEN l.receivable_amount > 0 THEN 'line_on_receivable'
                        WHEN l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0 THEN 'line_unpaid'
                        WHEN public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(l.tenant_id, l.id) <= 0 THEN 'nothing_to_refund' END)
      ORDER BY l.created_at, l.id)
      FROM public.invoice_lines l JOIN public.catalog_versions ci ON ci.tenant_id = l.tenant_id AND ci.id = l.catalog_version_id
     WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_line_options(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.refund_line_options(uuid) TO clinic_app;--> statement-breakpoint

-- The Ajukan Refund picker: the reader's branch's issued patient invoices with refundable room, newest first.
CREATE FUNCTION public.refund_invoice_picks() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL);
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'number', x.number, 'total', x.total, 'patient', x.patient) ORDER BY x.issued_at DESC)
    FROM (SELECT i.id, i.number, i.issued_at, sum(l.line_total) AS total, public.kasir_patient_json(i.tenant_id, i.patient_id, a.role = 'auditor') AS patient
            FROM public.invoices i JOIN public.invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
           WHERE i.tenant_id = a.tenant_id AND i.state = 'issued' AND i.patient_id IS NOT NULL AND (a.branch_id IS NULL OR i.branch_id = a.branch_id)
           GROUP BY i.id, i.number, i.issued_at, i.tenant_id, i.patient_id
          HAVING sum(greatest(0, public.kasir_line_paid(i.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(i.tenant_id, l.id))) > 0
           ORDER BY i.issued_at DESC LIMIT 30) x), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refund_invoice_picks() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.refund_invoice_picks() TO clinic_app;--> statement-breakpoint

-- ── T-078 re-created functions (recreate.py) ──
-- kasir_outstanding (re-created from 0091): a remainder converted to a receivable is not owed on the invoice (T-078).
CREATE OR REPLACE FUNCTION public.kasir_outstanding(p_tenant uuid, p_invoice uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(sum(greatest(0, l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id))), 0)::bigint
    FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_invoice
$$;--> statement-breakpoint

-- payment_line_room (re-created from 0093): no tender on a converted remainder (T-078).
CREATE OR REPLACE FUNCTION public.payment_line_room(p_tenant uuid, p_line uuid, p_simulated boolean) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT greatest(0, l.line_total - l.cancelled_amount - l.receivable_amount - CASE WHEN p_simulated
           THEN (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = l.tenant_id AND a.invoice_line_id = l.id)
                + (SELECT coalesce(sum(d.amount), 0) FROM public.booking_deposits d WHERE d.tenant_id = l.tenant_id AND d.applied_line_id = l.id AND d.state = 'applied')
           ELSE public.kasir_line_paid(l.tenant_id, l.id) END)::bigint
    FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.id = p_line
$$;--> statement-breakpoint

-- kasir_record_payment (re-created from 0091): the room excludes a converted remainder (T-078).
CREATE OR REPLACE FUNCTION public.kasir_record_payment(i public.invoices, p_key text, p_tenders jsonb, p_port jsonb, p_staff uuid, p_role text, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_t jsonb;
  v_seq integer := 0;
  v_sum bigint := 0;
  v_change bigint := 0;
  v_allocated bigint := 0;
  v_receipt uuid;
  v_number text;
  v_payment uuid;
  v_ids uuid[];
  v_room bigint[];
  v_alloc record;
  v_line public.invoice_lines;
  v_paid bigint;
  v_target bigint;
  v_portion bigint;
  v_alloc_id uuid;
  v_sim boolean := coalesce((p_port ->> 'is_simulated')::boolean, false);
  v_env text := coalesce(p_port ->> 'environment', 'production');
  v_charge uuid := (p_port ->> 'charge_id')::uuid;
  v_take bigint;
  rb record;
BEGIN
  SELECT sum((t ->> 'amount')::bigint) INTO v_sum FROM jsonb_array_elements(p_tenders) t;
  v_number := public.kasir_next_number(i.tenant_id, i.branch_id, 'KW');
  SELECT * INTO rb FROM public.kasir_receipt_body(i, v_number, p_at, p_tenders);
  BEGIN
    INSERT INTO public.receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, template_version_id, is_simulated, command_key, issued_by, issued_as, issued_at)
    VALUES (i.tenant_id, i.branch_id, i.id, v_number, v_sum, CASE WHEN v_sim THEN E'SIMULASI\n' || rb.body ELSE rb.body END, rb.paper, rb.template_version_id,
            v_sim, p_key, p_staff, p_role, p_at)
    RETURNING id INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
  END;
  FOR v_t IN SELECT t FROM jsonb_array_elements(p_tenders) t LOOP
    v_seq := v_seq + 1;
    IF v_t ? 'cash_tendered' THEN
      v_change := (v_t ->> 'cash_tendered')::bigint - (v_t ->> 'amount')::bigint;
    END IF;
    INSERT INTO public.payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                                 provider, provider_account, environment, is_simulated, charge_id, webhook_event_id, received_by, received_as, received_at)
    VALUES (i.tenant_id, i.branch_id, v_receipt, v_seq, i.id, i.patient_id, v_t ->> 'method', (v_t ->> 'amount')::bigint,
            (v_t ->> 'cash_tendered')::bigint, CASE WHEN v_t ? 'cash_tendered' THEN (v_t ->> 'cash_tendered')::bigint - (v_t ->> 'amount')::bigint END,
            v_t -> 'details', p_port ->> 'provider', p_port ->> 'provider_account', v_env, v_sim, v_charge, (p_port ->> 'webhook_event_id')::uuid,
            p_staff, p_role, p_at)
    RETURNING id INTO v_payment;
    -- T-075 (PR-21): a balance tender spends the patient's balance (never below 0; leaf lock after the lines).
    IF v_t ->> 'method' = 'balance' THEN
      PERFORM public.balance_post(i.tenant_id, i.patient_id, i.branch_id, 'use', -(v_t ->> 'amount')::bigint, jsonb_build_object('payment_id', v_payment),
                                  'use:' || v_payment::text, p_staff, p_role);
    END IF;
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (i.tenant_id, i.branch_id, 'PaymentReceived', 'payment', v_payment, p_staff, p_role, jsonb_build_object('payment_id', v_payment, 'invoice_id', i.id));
    -- The target lines and their room now (after the previous tenders of this receipt).
    IF v_charge IS NULL THEN
      SELECT array_agg(l.id ORDER BY l.id), array_agg(l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id)
        INTO v_ids, v_room FROM public.invoice_lines l
       WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0;
    ELSE
      SELECT array_agg(cl.invoice_line_id ORDER BY cl.invoice_line_id), array_agg(least(cl.amount, public.payment_line_room(i.tenant_id, cl.invoice_line_id, v_sim)) ORDER BY cl.invoice_line_id)
        INTO v_ids, v_room FROM public.payment_charge_lines cl
       WHERE cl.tenant_id = i.tenant_id AND cl.charge_id = v_charge AND public.payment_line_room(i.tenant_id, cl.invoice_line_id, v_sim) > 0;
    END IF;
    -- A port payment may meet less room than it carries (paid after cash, after a void): allocate what fits.
    v_take := least((v_t ->> 'amount')::bigint, coalesce((SELECT sum(x) FROM unnest(v_room) x), 0));
    IF v_take > 0 THEN
      FOR v_alloc IN SELECT * FROM public.kasir_allocate(v_take, v_ids, v_room) LOOP
        SELECT * INTO v_line FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.id = v_alloc.line_id;
        v_portion := 0;
        IF NOT v_sim THEN
          v_paid := public.kasir_line_paid(i.tenant_id, v_line.id) + v_alloc.amount;
          v_target := CASE WHEN v_line.vat_amount = 0 THEN 0
                           ELSE floor((v_line.vat_amount::numeric * v_paid::numeric * 2 + v_line.line_total::numeric) / (2 * v_line.line_total::numeric))::bigint END;
          v_portion := greatest(0, v_target - v_line.vat_recognised_amount);
        END IF;
        INSERT INTO public.payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, vat_portion, method, provider, provider_account, environment, is_simulated)
        VALUES (i.tenant_id, i.branch_id, v_payment, v_line.id, v_alloc.amount, v_portion, v_t ->> 'method', p_port ->> 'provider', p_port ->> 'provider_account', v_env, v_sim)
        RETURNING id INTO v_alloc_id;
        IF v_portion > 0 THEN
          UPDATE public.invoice_lines SET vat_recognised_amount = vat_recognised_amount + v_portion, vat_recognised_at = coalesce(vat_recognised_at, p_at)
           WHERE tenant_id = i.tenant_id AND id = v_line.id;
        END IF;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
        VALUES (i.tenant_id, i.branch_id, 'PaymentAllocated', 'payment_allocation', v_alloc_id, p_staff, p_role, jsonb_build_object('allocation_id', v_alloc_id, 'payment_id', v_payment));
        v_allocated := v_allocated + v_alloc.amount;
      END LOOP;
    END IF;
  END LOOP;
  -- T-076: a package's sessions take their share of the VAT recognised at payment (r2 F4).
  PERFORM public.package_sync_vat(pk.tenant_id, pk.id, p_at) FROM public.packages pk WHERE pk.tenant_id = i.tenant_id AND pk.invoice_id = i.id;
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  RETURN jsonb_build_object('receipt_id', v_receipt, 'number', v_number, 'paid', v_sum, 'change', v_change, 'allocated', v_allocated);
END
$$;--> statement-breakpoint

-- payment_charge_create (re-created from 0091): the charge room excludes a converted remainder (T-078).
CREATE OR REPLACE FUNCTION public.payment_charge_create(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  c public.payment_port_configs;
  ch public.payment_charges;
  v_out bigint;
  v_amount bigint;
  v_ids uuid[];
  v_room bigint[];
  v_alloc record;
  v_hours integer;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'channel' - 'amount' <> '{}'::jsonb OR coalesce(p ->> 'channel', '') NOT IN ('qris','va','payment_link')
     OR p ? 'amount' AND (jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^[1-9]\d{0,12}$') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: charge' USING ERRCODE = '22023';
  END IF;
  c := public.payment_port_of(i.tenant_id);
  IF NOT public.payment_port_usable(c) OR NOT (p ->> 'channel') = ANY (c.channels) OR p ->> 'channel' = 'qris' AND NOT public.kasir_method_enabled('qris', clock_timestamp()) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: payment_port' USING ERRCODE = '55000';
  END IF;
  -- A replay of the same key, or a pending charge of the invoice: return it (no second charge).
  SELECT * INTO ch FROM public.payment_charges x WHERE x.tenant_id = i.tenant_id AND (x.command_key = p_key OR x.invoice_id = i.id AND x.state = 'pending')
   ORDER BY (x.command_key = p_key) DESC LIMIT 1;
  IF ch.id IS NOT NULL THEN
    IF ch.invoice_id <> i.id THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a charge with this key exists' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('charge_id', ch.id, 'order_ref', ch.order_ref, 'external_id', ch.external_id, 'amount', ch.amount, 'expires_at', ch.expires_at,
      'channel', ch.channel, 'is_simulated', ch.is_simulated, 'state', ch.state, 'reused', true);
  END IF;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id AND ap.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: void_pending' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id ORDER BY l.id FOR UPDATE;
  v_out := public.kasir_outstanding(i.tenant_id, i.id);
  v_amount := coalesce((p ->> 'amount')::bigint, v_out);
  IF v_amount < 1 OR v_amount > v_out THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: overpayment' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = i.tenant_id AND pk.invoice_id = i.id AND public.kasir_line_paid(pk.tenant_id, pk.invoice_line_id) = 0
               AND v_amount < pk.min_dp) THEN
    RAISE EXCEPTION 'ERR_MIN_DP_NOT_MET: min_dp' USING ERRCODE = 'P0422';
  END IF;
  v_hours := coalesce((public.setting_value_at('SET-14', NULL, clock_timestamp()) ->> 'link_jam')::integer, 24);
  INSERT INTO public.payment_charges (tenant_id, branch_id, invoice_id, config_id, provider, provider_account, environment, channel, amount, description,
                                      order_ref, external_id, expires_at, is_simulated, command_key, created_by, created_as)
  VALUES (i.tenant_id, i.branch_id, i.id, c.id, c.provider, c.provider_account, c.environment, p ->> 'channel', v_amount,
          public.payment_description(i.tenant_id, i.id), c.order_prefix || '-' || replace(public.uuid_generate_v7()::text, '-', ''),
          'mock_' || replace(public.uuid_generate_v7()::text, '-', ''), clock_timestamp() + make_interval(hours => v_hours), c.provider = 'mock',
          p_key, a.staff_id, a.role)
  RETURNING * INTO ch;
  SELECT array_agg(l.id ORDER BY l.id), array_agg(l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id)
    INTO v_ids, v_room FROM public.invoice_lines l
   WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0;
  FOR v_alloc IN SELECT * FROM public.kasir_allocate(v_amount, v_ids, v_room) LOOP
    INSERT INTO public.payment_charge_lines (tenant_id, branch_id, charge_id, invoice_line_id, amount) VALUES (i.tenant_id, i.branch_id, ch.id, v_alloc.line_id, v_alloc.amount);
  END LOOP;
  IF ch.is_simulated THEN
    INSERT INTO public.payment_mock_states (tenant_id, branch_id, charge_id, amount) VALUES (ch.tenant_id, ch.branch_id, ch.id, ch.amount);
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (i.tenant_id, i.branch_id, 'PaymentChargeCreated', 'payment_charge', ch.id, a.staff_id, a.role, jsonb_build_object('charge_id', ch.id, 'invoice_id', i.id));
  PERFORM public.audit_append('money_correction', 'payment_charge', ch.id, 'success', 'payment_charge_created');
  RETURN jsonb_build_object('charge_id', ch.id, 'order_ref', ch.order_ref, 'external_id', ch.external_id, 'amount', ch.amount, 'expires_at', ch.expires_at,
    'channel', ch.channel, 'is_simulated', ch.is_simulated, 'state', ch.state, 'reused', false);
END
$$;--> statement-breakpoint

-- deposit_apply_do (re-created from 0093): a deposit never lands on a converted line (T-078).
CREATE OR REPLACE FUNCTION public.deposit_apply_do(i public.invoices, d public.booking_deposits, p_staff uuid, p_role text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  il public.invoice_lines;
  v_vat bigint;
BEGIN
  SELECT x.* INTO il FROM public.invoice_lines x
   WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id AND x.item_id = (SELECT cv.item_id FROM public.catalog_versions cv WHERE cv.tenant_id = d.tenant_id AND cv.id = d.catalog_version_id)
     AND x.plan_item_id IS NULL AND x.substitution_id IS NULL
     AND x.line_total - x.cancelled_amount - x.receivable_amount - public.kasir_line_paid(x.tenant_id, x.id) >= d.amount
     AND NOT EXISTS (SELECT 1 FROM public.booking_deposits o WHERE o.tenant_id = x.tenant_id AND o.applied_line_id = x.id)
   ORDER BY x.created_at, x.id LIMIT 1 FOR UPDATE;
  IF il.id IS NULL THEN
    RETURN NULL;
  END IF;
  v_vat := least(d.vat_recognised_amount, il.vat_amount - il.vat_recognised_amount);
  UPDATE public.booking_deposits SET state = 'applied', applied_line_id = il.id, decision_code = 'applied_on_arrival', decided_by = p_staff, decided_as = p_role,
         decided_at = clock_timestamp(), vat_recognised_amount = 0
   WHERE tenant_id = d.tenant_id AND id = d.id;
  IF v_vat > 0 THEN
    UPDATE public.invoice_lines SET vat_recognised_amount = vat_recognised_amount + v_vat, vat_recognised_at = coalesce(vat_recognised_at, clock_timestamp())
     WHERE tenant_id = il.tenant_id AND id = il.id;
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (d.tenant_id, i.branch_id, 'BookingDepositApplied', 'booking_deposit', d.id, p_staff, p_role,
          jsonb_build_object('deposit_id', d.id, 'invoice_id', i.id, 'invoice_line_id', il.id));
  RETURN il.id;
END
$$;--> statement-breakpoint

-- payment_allocations_guard (re-created from 0093): a receivable target; a line's converted remainder has no room (T-078).
CREATE OR REPLACE FUNCTION public.payment_allocations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  p public.payments;
  l public.invoice_lines;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  SELECT * INTO p FROM public.payments x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.payment_id;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.invoice_line_id;
  -- T-078: a receivable allocation: the payment of a collection receipt of this receivable, no invoice, real, no VAT portion, the
  -- collection's amount; one allocation per payment (partial unique index); never above the open amount.
  IF NEW.receivable_id IS NOT NULL THEN
    IF p.id IS NULL OR p.invoice_id IS NOT NULL OR NEW.is_simulated OR NEW.vat_portion <> 0 OR p.amount <> NEW.amount
       OR NOT EXISTS (SELECT 1 FROM public.receivable_collections c JOIN public.receivables r ON r.tenant_id = c.tenant_id AND r.id = c.receivable_id
                       WHERE c.tenant_id = NEW.tenant_id AND c.receipt_id = p.receipt_id AND c.receivable_id = NEW.receivable_id AND c.amount = NEW.amount
                         AND c.method = p.method AND r.state = 'open' AND NEW.amount <= r.amount - r.collected_amount - r.written_off_amount)
       OR (NEW.method, NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated) IS DISTINCT FROM (p.method, p.provider, p.provider_account, p.environment, p.is_simulated) THEN
      RAISE EXCEPTION 'a receivable allocation names its collection' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- T-077: a deposit allocation names its deposit (the payment of its receipt, the same amount, its VAT); no line; one per deposit.
  IF NEW.booking_deposit_id IS NOT NULL THEN
    IF p.id IS NULL OR p.invoice_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND (a.payment_id = NEW.payment_id OR a.booking_deposit_id = NEW.booking_deposit_id))
       OR NOT EXISTS (SELECT 1 FROM public.booking_deposits u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.booking_deposit_id AND u.state = 'held'
         AND u.receipt_id = p.receipt_id AND u.amount = p.amount AND u.amount = NEW.amount AND u.vat_amount = NEW.vat_portion AND u.method = p.method)
       OR NEW.is_simulated
       OR (NEW.method, NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated) IS DISTINCT FROM (p.method, p.provider, p.provider_account, p.environment, p.is_simulated) THEN
      RAISE EXCEPTION 'a deposit allocation names its deposit' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- T-076: a top-up allocation names its top-up (the payment of its receipt, the same amount); no line.
  IF NEW.top_up_id IS NOT NULL THEN
    IF p.id IS NULL OR p.invoice_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND (a.payment_id = NEW.payment_id OR a.top_up_id = NEW.top_up_id))
       OR NOT EXISTS (SELECT 1 FROM public.balance_top_ups u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.top_up_id
         AND u.receipt_id = p.receipt_id AND u.amount = p.amount AND u.amount = NEW.amount) OR NEW.vat_portion <> 0 OR NEW.is_simulated
       OR (NEW.method, NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated) IS DISTINCT FROM (p.method, p.provider, p.provider_account, p.environment, p.is_simulated) THEN
      RAISE EXCEPTION 'a top-up allocation names its top-up' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF p.id IS NULL OR l.id IS NULL OR l.invoice_id <> p.invoice_id
     OR (NEW.method, NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated)
        IS DISTINCT FROM (p.method, p.provider, p.provider_account, p.environment, p.is_simulated)
     OR (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.invoice_line_id = NEW.invoice_line_id
          AND a.is_simulated = NEW.is_simulated) + NEW.amount
        + (SELECT coalesce(sum(d.amount), 0) FROM public.booking_deposits d WHERE d.tenant_id = NEW.tenant_id AND d.applied_line_id = NEW.invoice_line_id AND d.state = 'applied')
        > l.line_total - l.cancelled_amount - l.receivable_amount
     OR (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.payment_id = NEW.payment_id) + NEW.amount > p.amount THEN
    RAISE EXCEPTION 'an allocation stays within its payment and its line' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- payments_guard (re-created from 0093): a payment with no invoice may be a receivable collection; exactly one kind (T-078).
CREATE OR REPLACE FUNCTION public.payments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.payment_charges;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF (NEW.method IN ('qris','va','payment_link')) <> (NEW.charge_id IS NOT NULL) OR NEW.webhook_event_id IS NOT NULL AND NEW.charge_id IS NULL THEN
    RAISE EXCEPTION 'a port payment names its charge; no other does' USING ERRCODE = '42501';
  END IF;
  IF NEW.method = 'balance' AND (NEW.patient_id IS NULL OR NEW.is_simulated) THEN
    RAISE EXCEPTION 'a balance payment has a patient and is never simulated' USING ERRCODE = '42501';
  END IF;
  IF NEW.charge_id IS NOT NULL THEN
    SELECT * INTO c FROM public.payment_charges x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.charge_id;
    IF c.id IS NULL OR c.invoice_id <> NEW.invoice_id OR c.channel <> NEW.method
       OR (c.provider, c.provider_account, c.environment, c.is_simulated) IS DISTINCT FROM (NEW.provider, NEW.provider_account, NEW.environment, NEW.is_simulated) THEN
      RAISE EXCEPTION 'a port payment copies its charge' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- T-076 (r3 3), T-077 (P1-3): a payment with no invoice is an Isi Saldo or a booking DP: cash, EDC or transfer, a patient, real, no
  -- charge, exactly one of its top-up or its deposit.
  IF NEW.invoice_id IS NULL THEN
    -- T-078 (r1 #3): exactly one of a top-up, a held deposit or a receivable collection (balance only for a collection).
    IF NEW.patient_id IS NULL OR NEW.is_simulated OR NEW.charge_id IS NOT NULL
       OR (NEW.method IN ('cash','edc','transfer') AND EXISTS (SELECT 1 FROM public.balance_top_ups u WHERE u.tenant_id = NEW.tenant_id AND u.receipt_id = NEW.receipt_id
                        AND u.branch_id = NEW.branch_id AND u.patient_id = NEW.patient_id AND u.amount = NEW.amount))::int
        + (NEW.method IN ('cash','edc','transfer') AND EXISTS (SELECT 1 FROM public.booking_deposits u WHERE u.tenant_id = NEW.tenant_id AND u.receipt_id = NEW.receipt_id
                        AND u.branch_id = NEW.branch_id AND u.patient_id = NEW.patient_id AND u.amount = NEW.amount AND u.method = NEW.method AND u.state = 'held'))::int
        + (NEW.method IN ('cash','edc','transfer','balance') AND EXISTS (SELECT 1 FROM public.receivable_collections u JOIN public.receivables rc ON rc.tenant_id = u.tenant_id
                        AND rc.id = u.receivable_id WHERE u.tenant_id = NEW.tenant_id AND u.receipt_id = NEW.receipt_id AND u.branch_id = NEW.branch_id
                        AND public.patient_canonical(rc.tenant_id, rc.patient_id) = public.patient_canonical(NEW.tenant_id, NEW.patient_id)
                        AND u.amount = NEW.amount AND u.method = NEW.method))::int <> 1
       OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id IS NULL AND r.branch_id = NEW.branch_id
                        AND NOT r.is_simulated) THEN
      RAISE EXCEPTION 'a payment with no invoice is a balance top-up, a booking deposit or a receivable collection' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id
                   AND (i.state = 'issued' OR i.state = 'void' AND NEW.charge_id IS NOT NULL)
                   AND i.patient_id IS NOT DISTINCT FROM NEW.patient_id)
     OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id IS NOT DISTINCT FROM NEW.invoice_id AND r.branch_id = NEW.branch_id
                      AND r.is_simulated = NEW.is_simulated) THEN
    RAISE EXCEPTION 'a payment is for an issued invoice, its patient and its receipt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- invoice_lines_guard (re-created from 0091): the receivable remainder set once (T-078).
CREATE OR REPLACE FUNCTION public.invoice_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice lines are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id AND i.state = 'draft') THEN
      RAISE EXCEPTION 'lines are added to a draft invoice only' USING ERRCODE = '42501';
    END IF;
    IF NEW.plan_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id
                                                     AND i.visit_id IS NOT NULL AND NOT i.counter) THEN
      RAISE EXCEPTION 'an addition line is on a visit invoice' USING ERRCODE = '42501';
    END IF;
    IF NEW.cancelled_amount <> 0 OR NEW.moved_to_balance <> 0 OR NEW.vat_reversed_amount <> 0 OR NEW.receivable_amount <> 0 THEN
      RAISE EXCEPTION 'a line opens with nothing cancelled or moved' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.invoice_id, NEW.item_id, NEW.catalog_version_id, NEW.quantity, NEW.unit_price, NEW.discount,
      NEW.line_total, NEW.tax_category, NEW.tax_basis, NEW.vat_base, NEW.vat_amount, NEW.created_at, NEW.plan_item_id, NEW.substitution_id)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.invoice_id, OLD.item_id, OLD.catalog_version_id, OLD.quantity, OLD.unit_price, OLD.discount,
      OLD.line_total, OLD.tax_category, OLD.tax_basis, OLD.vat_base, OLD.vat_amount, OLD.created_at, OLD.plan_item_id, OLD.substitution_id)
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

-- invoice_void_request (re-created from 0093): an invoice with a converted remainder is paid (T-078).
CREATE OR REPLACE FUNCTION public.invoice_void_request(p_invoice uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  v_id uuid;
BEGIN
  IF a.role NOT IN ('fo_cashier','manager','finance') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not request a void' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_allocations x JOIN public.payments y ON y.tenant_id = x.tenant_id AND y.id = x.payment_id
              WHERE y.tenant_id = i.tenant_id AND y.invoice_id = i.id)
     OR EXISTS (SELECT 1 FROM public.booking_deposits d JOIN public.invoice_lines l ON l.tenant_id = d.tenant_id AND l.id = d.applied_line_id
                 WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND d.state = 'applied')
     OR EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.receivable_amount > 0) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice_paid' USING ERRCODE = '55000';
  END IF;
  v_id := public.approval_request('invoice_void', 'invoice', i.id, btrim(p_reason), i.branch_id,
    (SELECT sum(l.line_total) FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id)::bigint);
  RETURN v_id;
END
$$;--> statement-breakpoint

-- invoice_void_sync (re-created from 0093): an invoice with a converted remainder is paid (T-078).
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
$$;--> statement-breakpoint

-- receipt_get (re-created from 0093): a collection receipt's patient is masked for the auditor like the others (T-078).
CREATE OR REPLACE FUNCTION public.receipt_get(p_receipt uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  r public.receipts;
  v_body text;
  pt public.patients;
BEGIN
  SELECT * INTO r FROM public.receipts x WHERE x.tenant_id = a.tenant_id AND x.id = p_receipt;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND r.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: receipt not found' USING ERRCODE = 'P0002';
  END IF;
  v_body := r.body;
  IF a.role = 'auditor' THEN
    SELECT p.* INTO pt FROM public.patients p WHERE p.tenant_id = r.tenant_id AND p.id = public.patient_canonical(r.tenant_id,
      coalesce((SELECT i.patient_id FROM public.invoices i WHERE i.tenant_id = r.tenant_id AND i.id = r.invoice_id),
               (SELECT u.patient_id FROM public.balance_top_ups u WHERE u.tenant_id = r.tenant_id AND u.receipt_id = r.id),
               (SELECT u.patient_id FROM public.booking_deposits u WHERE u.tenant_id = r.tenant_id AND u.receipt_id = r.id),
               (SELECT rc.patient_id FROM public.receivable_collections u JOIN public.receivables rc ON rc.tenant_id = u.tenant_id AND rc.id = u.receivable_id
                 WHERE u.tenant_id = r.tenant_id AND u.receipt_id = r.id)));
    IF pt.id IS NOT NULL THEN
      v_body := replace(replace(v_body, pt.full_name, '***'), pt.mrn, '***' || right(pt.mrn, 3));
    END IF;
  END IF;
  RETURN jsonb_build_object('id', r.id, 'number', r.number, 'invoice_id', r.invoice_id, 'total', r.total, 'paper', r.paper, 'body', v_body, 'issued_at', r.issued_at,
    'is_simulated', r.is_simulated,
    'payments', (SELECT jsonb_agg(jsonb_build_object('seq', y.seq, 'method', y.method, 'amount', y.amount, 'change', y.change_given) ORDER BY y.seq)
                   FROM public.payments y WHERE y.tenant_id = r.tenant_id AND y.receipt_id = r.id));
END
$$;--> statement-breakpoint

-- interrupted_to_balance (re-created from 0091): a pending cash refund's reserved room is not moved again (T-078).
CREATE OR REPLACE FUNCTION public.interrupted_to_balance(p_key text, p_execution uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['fo_cashier','manager','owner']);
  e public.treatment_executions;
  v public.visits;
  t public.plan_items;
  l public.invoice_lines;
  v_amount bigint;
  v_vat bigint;
  v_service uuid;
  v_entry uuid;
BEGIN
  SELECT * INTO e FROM public.treatment_executions x WHERE x.tenant_id = a.tenant_id AND x.id = p_execution;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = e.visit_id AND (a.branch_id IS NULL OR x.branch_id = a.branch_id) FOR UPDATE;
  IF e.id IS NULL OR v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: execution not found' USING ERRCODE = 'P0002';
  END IF;
  -- Replay: the entry this execution already moved.
  SELECT x.id INTO v_entry FROM public.balance_entries x WHERE x.tenant_id = e.tenant_id AND x.source_kind = 'treatment_execution' AND x.source_id = e.id;
  IF v_entry IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_moved' USING ERRCODE = '55000';
  END IF;
  IF e.state <> 'finished' OR e.outcome NOT IN ('medical_stop','clinic_stop') OR public.package_execution_covered(e.tenant_id, e.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_movable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO t FROM public.plan_items x WHERE x.tenant_id = e.tenant_id AND x.id = e.plan_item_id;
  IF public.addition_of_visit(e.tenant_id, v.id, t.id) THEN
    l := public.addition_line(e.tenant_id, v.id, t.id);
    SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = e.tenant_id AND x.id = l.id FOR UPDATE;
    IF l.id IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_movable' USING ERRCODE = '55000';
    END IF;
    v_amount := public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance - public.refund_reserved(l.tenant_id, l.id);
    UPDATE public.invoice_lines SET cancelled_amount = greatest(0, l.line_total - public.kasir_line_paid(l.tenant_id, l.id))
     WHERE tenant_id = l.tenant_id AND id = l.id AND cancelled_amount = 0;
  ELSE
    v_service := public.package_plan_service(e.tenant_id, t.id);
    SELECT x.* INTO l FROM public.invoice_lines x JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
     WHERE x.tenant_id = e.tenant_id AND i.visit_id = v.id AND i.state = 'issued' AND public.invoice_is_ordinary(i.tenant_id, i.id)
       AND x.item_id = v_service AND public.kasir_line_paid(x.tenant_id, x.id) >= x.line_total
       AND public.kasir_line_paid(x.tenant_id, x.id) - x.moved_to_balance - public.refund_reserved(x.tenant_id, x.id) >= (x.line_total * t.qty) / x.quantity
     ORDER BY x.created_at, x.id LIMIT 1 FOR UPDATE OF x;
    IF l.id IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_movable' USING ERRCODE = '55000';
    END IF;
    v_amount := (l.line_total * t.qty) / l.quantity;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_movable' USING ERRCODE = '55000';
  END IF;
  v_vat := CASE WHEN l.line_total = 0 THEN 0 ELSE (l.vat_recognised_amount * v_amount) / l.line_total END;
  UPDATE public.invoice_lines SET moved_to_balance = moved_to_balance + v_amount,
         vat_reversed_amount = least(vat_recognised_amount, vat_reversed_amount + v_vat),
         vat_reversed_at = CASE WHEN least(vat_recognised_amount, vat_reversed_amount + v_vat) > 0 THEN coalesce(vat_reversed_at, clock_timestamp()) END
   WHERE tenant_id = l.tenant_id AND id = l.id;
  v_entry := public.balance_post(e.tenant_id, v.patient_id, v.branch_id, 'from_interrupted_treatment', v_amount,
                                 jsonb_build_object('source_kind', 'treatment_execution', 'source_id', e.id), p_key, a.staff_id, a.role);
  IF e.outcome = 'clinic_stop' AND NOT EXISTS (
       SELECT 1 FROM public.treatment_executions x WHERE x.tenant_id = e.tenant_id AND x.visit_id = v.id AND x.id <> e.id AND x.outcome = 'clinic_stop'
          AND NOT public.package_execution_covered(x.tenant_id, x.id)
          AND NOT EXISTS (SELECT 1 FROM public.balance_entries b WHERE b.tenant_id = x.tenant_id AND b.source_kind = 'treatment_execution' AND b.source_id = x.id)) THEN
    UPDATE public.visits SET blocker = NULL WHERE tenant_id = v.tenant_id AND id = v.id AND closed_at IS NULL AND blocker IS NOT NULL;
  END IF;
  PERFORM public.kasir_visit_payment(v.tenant_id, v.id);
  PERFORM public.audit_append('money_correction', 'treatment_execution', e.id, 'success', 'interrupted_to_balance');
  RETURN jsonb_build_object('entry_id', v_entry, 'amount', v_amount);
END
$$;--> statement-breakpoint

-- package_close_do (re-created from 0091): a substitution line moves only what is not moved or reserved (T-078 r1 #4: no double credit after a refund).
CREATE OR REPLACE FUNCTION public.package_close_do(pk public.packages, p_state text, p_reason text, p_staff uuid, p_role text, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_sub_move bigint;
  v_sub_vat bigint;
  l public.invoice_lines;
  v_paid bigint;
  v_redeemed bigint;
  v_unused bigint;
  v_remainder bigint;
  v_redeemed_vat bigint;
  sl record;
  v_sub_paid bigint;
  v_event uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.package_sessions s JOIN public.treatment_executions e ON e.tenant_id = s.tenant_id AND e.id = s.reserved_execution_id
              WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'reserved' AND e.state IN ('started','paused')) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: session_in_treatment' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = pk.tenant_id AND x.id = pk.invoice_line_id FOR UPDATE;
  PERFORM 1 FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id ORDER BY x.seq FOR UPDATE;
  PERFORM public.package_sync_vat(pk.tenant_id, pk.id, p_at);
  v_paid := public.package_paid(pk);
  SELECT coalesce(sum(s.allocated_value), 0), coalesce(sum(s.vat_recognised_amount), 0) INTO v_redeemed, v_redeemed_vat
    FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'redeemed';
  v_unused := greatest(0, v_paid - v_redeemed);
  v_remainder := greatest(0, l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id));
  -- Unredeemed sessions' substitution difference lines: unpaid remainder cancelled, real money paid moved with the rest.
  v_sub_paid := 0;
  FOR sl IN SELECT x.* FROM public.invoice_lines x JOIN public.package_substitutions u ON u.tenant_id = x.tenant_id AND u.id = x.substitution_id
              JOIN public.package_sessions s ON s.tenant_id = u.tenant_id AND s.id = u.session_id
              JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
             WHERE u.tenant_id = pk.tenant_id AND u.package_id = pk.id AND s.state <> 'redeemed' AND i.state = 'issued' ORDER BY x.id FOR UPDATE OF x LOOP
    -- T-078 (r1 #4): only the value not already moved (a refund) nor reserved by a pending cash refund; VAT in proportion.
    v_sub_move := greatest(0, public.kasir_line_paid(sl.tenant_id, sl.id) - sl.moved_to_balance - public.refund_reserved(sl.tenant_id, sl.id));
    v_sub_vat := least(sl.vat_recognised_amount - sl.vat_reversed_amount,
                       CASE WHEN sl.line_total = 0 THEN 0 ELSE (sl.vat_recognised_amount * v_sub_move) / sl.line_total END);
    UPDATE public.invoice_lines SET cancelled_amount = greatest(0, sl.line_total - public.kasir_line_paid(sl.tenant_id, sl.id)),
           moved_to_balance = sl.moved_to_balance + v_sub_move,
           vat_reversed_amount = sl.vat_reversed_amount + v_sub_vat,
           vat_reversed_at = CASE WHEN sl.vat_reversed_amount + v_sub_vat > 0 THEN coalesce(sl.vat_reversed_at, p_at) END
     WHERE tenant_id = sl.tenant_id AND id = sl.id;
    v_sub_paid := v_sub_paid + v_sub_move;
  END LOOP;
  UPDATE public.package_sessions SET state = 'closed', reserved_visit_id = NULL, reserved_execution_id = NULL, version = version + 1
   WHERE tenant_id = pk.tenant_id AND package_id = pk.id AND state IN ('available','reserved');
  IF v_remainder > 0 THEN
    UPDATE public.invoice_lines SET cancelled_amount = v_remainder WHERE tenant_id = l.tenant_id AND id = l.id;
  END IF;
  UPDATE public.payment_charges SET state = 'cancelled' WHERE tenant_id = pk.tenant_id AND invoice_id = pk.invoice_id AND state = 'pending';
  UPDATE public.packages SET state = p_state, closed_at = p_at, closed_by = p_staff, closed_as = p_role, close_reason = p_reason,
         paid_unused_moved = v_unused + v_sub_paid, remainder_cancelled = v_remainder,
         vat_reversed_amount = greatest(vat_reversed_amount, l.vat_recognised_amount - v_redeemed_vat),
         vat_reversed_at = CASE WHEN greatest(vat_reversed_amount, l.vat_recognised_amount - v_redeemed_vat) > 0 THEN coalesce(vat_reversed_at, p_at) END
   WHERE tenant_id = pk.tenant_id AND id = pk.id;
  IF v_unused + v_sub_paid > 0 THEN
    PERFORM public.balance_post(pk.tenant_id, pk.patient_id, pk.sold_branch_id, CASE WHEN p_state = 'expired' THEN 'from_expiry' ELSE 'from_cancel' END,
                                v_unused + v_sub_paid, jsonb_build_object('source_kind', 'package', 'source_id', pk.id), 'package_close:' || pk.id::text, p_staff, p_role);
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (pk.tenant_id, pk.sold_branch_id, CASE WHEN p_state = 'expired' THEN 'PackageExpired' ELSE 'PackageCancelled' END, 'package', pk.id, p_staff, p_role,
          jsonb_build_object('package_id', pk.id, 'patient_id', pk.patient_id))
  RETURNING id INTO v_event;
  RETURN jsonb_build_object('package_id', pk.id, 'state', p_state, 'to_balance', v_unused + v_sub_paid, 'cancelled', v_remainder);
END
$$;--> statement-breakpoint

-- dispensing_blocker (re-created from 0087): a pending refund blocks the handover (T-078).
CREATE OR REPLACE FUNCTION public.dispensing_blocker(d public.dispensings) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.pharmacy_rx_blocker(d),
    CASE WHEN d.visit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.visits v WHERE v.tenant_id = d.tenant_id AND v.id = d.visit_id AND v.payment IN ('in_progress','blocked'))
              OR d.visit_id IS NULL AND EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                                                  WHERE l.tenant_id = d.tenant_id AND l.id = d.invoice_line_id
                                                    AND (i.state <> 'issued' OR public.kasir_outstanding(i.tenant_id, i.id) > 0))
         THEN 'payment_unpaid' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.stock_items si WHERE si.tenant_id = d.tenant_id AND si.id = d.stock_item_id AND public.pharmacy_special(si.tenant_id, si.catalog_item_id))
         THEN 'special_item' END,
    -- T-078 (r1 #4): a product whose line has a pending refund is not handed over.
    CASE WHEN d.invoice_line_id IS NOT NULL AND public.refund_reserved(d.tenant_id, d.invoice_line_id) > 0 THEN 'refund_pending' END)
$$;--> statement-breakpoint

-- patient_merges_balance_guard (re-created from 0090): an open receivable refuses the merge (T-078).
CREATE OR REPLACE FUNCTION public.patient_merges_balance_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.balance_accounts a WHERE a.tenant_id = NEW.tenant_id AND a.patient_id = NEW.merged_id AND a.balance > 0) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: patient_has_balance' USING ERRCODE = '55000';
  END IF;
  -- T-078 (open point 16): a patient with an open receivable is not merged away either (DEC-061: redirect, never move).
  IF EXISTS (SELECT 1 FROM public.receivables r WHERE r.tenant_id = NEW.tenant_id AND r.patient_id = NEW.merged_id AND r.state = 'open') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: patient_has_receivable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
