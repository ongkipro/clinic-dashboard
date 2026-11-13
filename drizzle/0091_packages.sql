CREATE TABLE "balance_top_ups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"command_key" text NOT NULL,
	"received_by" uuid NOT NULL,
	"received_as" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "balance_top_ups_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "balance_top_ups_receipt_key" UNIQUE("tenant_id","receipt_id"),
	CONSTRAINT "balance_top_ups_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "balance_top_ups_check" CHECK ("balance_top_ups"."amount" between 1 and 1000000000000 and "balance_top_ups"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "balance_top_ups"."received_as" in ('owner','manager','fo_cashier','finance'))
);
--> statement-breakpoint
CREATE TABLE "package_contents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"service_item_id" uuid NOT NULL,
	"count" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "package_contents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "package_contents_seq_key" UNIQUE("tenant_id","package_version_id","seq"),
	CONSTRAINT "package_contents_service_key" UNIQUE("tenant_id","package_version_id","service_item_id"),
	CONSTRAINT "package_contents_check" CHECK ("package_contents"."seq" between 1 and 20 and "package_contents"."count" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "package_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"service_item_id" uuid NOT NULL,
	"allocated_value" bigint NOT NULL,
	"tax_category" text NOT NULL,
	"tax_basis" text NOT NULL,
	"vat_base" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"vat_recognised_amount" bigint DEFAULT 0 NOT NULL,
	"vat_recognised_at" timestamp with time zone,
	"state" text DEFAULT 'available' NOT NULL,
	"reserved_visit_id" uuid,
	"reserved_execution_id" uuid,
	"returned_execution_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"redeemed_branch_id" uuid,
	"redeemed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "package_sessions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "package_sessions_seq_key" UNIQUE("tenant_id","package_id","seq"),
	CONSTRAINT "package_sessions_execution_key" UNIQUE("tenant_id","reserved_execution_id"),
	CONSTRAINT "package_sessions_check" CHECK ("package_sessions"."state" in ('available','reserved','redeemed','closed') and "package_sessions"."seq" between 1 and 1000
      and "package_sessions"."allocated_value" >= 0 and "package_sessions"."tax_category" in ('exempt_medical','taxable_service','taxable_goods','non_object')
      and "package_sessions"."vat_base" >= 0 and "package_sessions"."vat_amount" >= 0 and "package_sessions"."vat_base" + "package_sessions"."vat_amount" = "package_sessions"."allocated_value"
      and "package_sessions"."vat_recognised_amount" between 0 and "package_sessions"."vat_amount" and (("package_sessions"."vat_recognised_amount" > 0) = ("package_sessions"."vat_recognised_at" is not null))
      and ("package_sessions"."state" <> 'reserved' or "package_sessions"."reserved_visit_id" is not null) and ("package_sessions"."state" not in ('available','closed') or "package_sessions"."reserved_visit_id" is null) and ("package_sessions"."reserved_execution_id" is null or "package_sessions"."state" in ('reserved','redeemed'))
      and (("package_sessions"."state" = 'redeemed') = ("package_sessions"."redeemed_at" is not null)) and (("package_sessions"."state" = 'redeemed') = ("package_sessions"."redeemed_branch_id" is not null))
      and ("package_sessions"."state" <> 'redeemed' or "package_sessions"."reserved_execution_id" is not null) and "package_sessions"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "package_substitutions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"old_service_item_id" uuid NOT NULL,
	"new_service_item_id" uuid NOT NULL,
	"old_value" bigint NOT NULL,
	"new_price" bigint NOT NULL,
	"difference" bigint NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_as" text NOT NULL,
	"decided_by" uuid,
	"decided_as" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"command_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "package_substitutions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "package_substitutions_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "package_substitutions_check" CHECK ("package_substitutions"."state" in ('pending','approved','declined') and "package_substitutions"."old_value" >= 0 and "package_substitutions"."new_price" >= 1
      and "package_substitutions"."difference" = "package_substitutions"."new_price" - "package_substitutions"."old_value" and "package_substitutions"."old_service_item_id" <> "package_substitutions"."new_service_item_id"
      and length(btrim("package_substitutions"."reason")) between 3 and 500 and "package_substitutions"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "package_substitutions"."requested_as" in ('fo_cashier','manager','bc')
      and (("package_substitutions"."state" = 'pending') = ("package_substitutions"."decided_at" is null)) and num_nonnulls("package_substitutions"."decided_at", "package_substitutions"."decided_by", "package_substitutions"."decided_as") in (0, 3)
      and ("package_substitutions"."decided_as" is null or "package_substitutions"."decided_as" in ('doctor','facility_head'))
      and ("package_substitutions"."state" <> 'declined' or length(btrim("package_substitutions"."decision_reason")) between 3 and 500))
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sold_branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"min_dp" bigint NOT NULL,
	"validity_end" timestamp with time zone NOT NULL,
	"moved_to_balance" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_as" text,
	"close_reason" text,
	"paid_unused_moved" bigint,
	"remainder_cancelled" bigint,
	"vat_reversed_amount" bigint DEFAULT 0 NOT NULL,
	"vat_reversed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "packages_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "packages_line_key" UNIQUE("tenant_id","invoice_line_id"),
	CONSTRAINT "packages_check" CHECK ("packages"."state" in ('active','expired','cancelled') and "packages"."price" between 1 and 1000000000000
      and "packages"."min_dp" between 1 and "packages"."price" and "packages"."moved_to_balance" between 0 and "packages"."price"
      and (("packages"."state" = 'active') = ("packages"."closed_at" is null))
      and ("packages"."state" = 'active' or "packages"."close_reason" is not null and "packages"."paid_unused_moved" >= 0 and "packages"."remainder_cancelled" >= 0)
      and "packages"."vat_reversed_amount" >= 0 and (("packages"."vat_reversed_amount" > 0) = ("packages"."vat_reversed_at" is not null)))
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_check";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "cancelled_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "moved_to_balance" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "vat_reversed_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "vat_reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "substitution_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "top_up_id" uuid;--> statement-breakpoint
ALTER TABLE "balance_top_ups" ADD CONSTRAINT "balance_top_ups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_top_ups" ADD CONSTRAINT "balance_top_ups_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_top_ups" ADD CONSTRAINT "balance_top_ups_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_top_ups" ADD CONSTRAINT "balance_top_ups_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_top_ups" ADD CONSTRAINT "balance_top_ups_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_contents" ADD CONSTRAINT "package_contents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_contents" ADD CONSTRAINT "package_contents_version_fk" FOREIGN KEY ("tenant_id","package_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_contents" ADD CONSTRAINT "package_contents_service_fk" FOREIGN KEY ("tenant_id","service_item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_package_fk" FOREIGN KEY ("tenant_id","package_id") REFERENCES "public"."packages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_service_fk" FOREIGN KEY ("tenant_id","service_item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_visit_fk" FOREIGN KEY ("tenant_id","reserved_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_execution_fk" FOREIGN KEY ("tenant_id","reserved_execution_id") REFERENCES "public"."treatment_executions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_redeemed_branch_fk" FOREIGN KEY ("tenant_id","redeemed_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_substitutions" ADD CONSTRAINT "package_substitutions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_substitutions" ADD CONSTRAINT "package_substitutions_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_substitutions" ADD CONSTRAINT "package_substitutions_package_fk" FOREIGN KEY ("tenant_id","package_id") REFERENCES "public"."packages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_substitutions" ADD CONSTRAINT "package_substitutions_session_fk" FOREIGN KEY ("tenant_id","session_id") REFERENCES "public"."package_sessions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_substitutions" ADD CONSTRAINT "package_substitutions_old_fk" FOREIGN KEY ("tenant_id","old_service_item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_substitutions" ADD CONSTRAINT "package_substitutions_new_fk" FOREIGN KEY ("tenant_id","new_service_item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_substitutions" ADD CONSTRAINT "package_substitutions_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_substitutions" ADD CONSTRAINT "package_substitutions_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_branch_fk" FOREIGN KEY ("tenant_id","sold_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_version_fk" FOREIGN KEY ("tenant_id","catalog_version_id") REFERENCES "public"."catalog_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_sessions_visit_idx" ON "package_sessions" USING btree ("tenant_id","reserved_visit_id");--> statement-breakpoint
CREATE INDEX "package_substitutions_session_idx" ON "package_substitutions" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "packages_patient_idx" ON "packages" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "packages_expiry_idx" ON "packages" USING btree ("state","validity_end");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_substitution_key" UNIQUE("tenant_id","invoice_id","substitution_id");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_t076_check" CHECK ("invoice_lines"."cancelled_amount" between 0 and "invoice_lines"."line_total" and "invoice_lines"."moved_to_balance" between 0 and "invoice_lines"."line_total"
      and "invoice_lines"."cancelled_amount" + "invoice_lines"."moved_to_balance" <= "invoice_lines"."line_total" and "invoice_lines"."vat_reversed_amount" between 0 and "invoice_lines"."vat_recognised_amount"
      and (("invoice_lines"."vat_reversed_amount" > 0) = ("invoice_lines"."vat_reversed_at" is not null)));--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_check" CHECK (num_nonnulls("payment_allocations"."invoice_line_id", "payment_allocations"."top_up_id") = 1 and "payment_allocations"."amount" between 1 and 1000000000000
      and "payment_allocations"."vat_portion" between 0 and "payment_allocations"."amount" and "payment_allocations"."method" in ('cash','edc','transfer','qris','va','payment_link','balance') and "payment_allocations"."environment" in ('production','staging','demo','local'));--> statement-breakpoint

-- T-076 rules (generated by gen.py; plan docs/tasks/T-076.md)
-- Read predicate of the package tables (tenant-shared like the balance, DEC-086 (7)): owner, finance and the auditor
-- tenant-wide; manager and FO/cashier at their active branch.
CREATE FUNCTION public.package_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.balance_readable(p_tenant)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_readable(uuid) TO clinic_app;--> statement-breakpoint

-- Package contents are catalog configuration: readable by the catalog readers (the policy of catalog_versions).
CREATE FUNCTION public.package_contents_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_staff_id() IS NOT NULL, false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_contents_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_contents_readable(uuid) TO clinic_app;--> statement-breakpoint

-- BILL-7 split: p_amount over positive weights, proportional, floor in numeric, then +1 to the largest remainders
-- (ties by index). No cap (a package may cost more than its services). Equal weights give the equal split.
CREATE FUNCTION public.package_allocate(p_amount bigint, p_weights bigint[]) RETURNS bigint[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  n integer := coalesce(cardinality(p_weights), 0);
  v_total numeric := 0;
  v_out bigint[];
  v_rem numeric[];
  v_left bigint;
  i integer;
  k integer;
BEGIN
  IF n = 0 OR p_amount IS NULL OR p_amount < 0 OR EXISTS (SELECT 1 FROM unnest(p_weights) w WHERE w IS NULL OR w <= 0) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: package_split' USING ERRCODE = '22023';
  END IF;
  FOR i IN 1..n LOOP v_total := v_total + p_weights[i]; END LOOP;
  v_out := array_fill(0::bigint, ARRAY[n]);
  v_rem := array_fill(0::numeric, ARRAY[n]);
  v_left := p_amount;
  FOR i IN 1..n LOOP
    v_out[i] := floor(p_amount::numeric * p_weights[i]::numeric / v_total)::bigint;
    v_rem[i] := p_amount::numeric * p_weights[i]::numeric / v_total - v_out[i];
    v_left := v_left - v_out[i];
  END LOOP;
  WHILE v_left > 0 LOOP
    k := 1;
    FOR i IN 2..n LOOP
      IF v_rem[i] > v_rem[k] THEN k := i; END IF;
    END LOOP;
    v_out[k] := v_out[k] + 1;
    v_rem[k] := -1;
    v_left := v_left - 1;
  END LOOP;
  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_allocate(bigint, bigint[]) FROM PUBLIC;--> statement-breakpoint

-- The package's line (its invoice, one line).
CREATE FUNCTION public.package_line(pk public.packages) RETURNS public.invoice_lines
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT l.* FROM public.invoice_lines l WHERE l.tenant_id = pk.tenant_id AND l.id = pk.invoice_line_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_line(public.packages) FROM PUBLIC;--> statement-breakpoint

-- Effective paid value (BILL-8): real money on the package line minus what moved to the balance before close.
CREATE FUNCTION public.package_paid(pk public.packages) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT greatest(0, public.kasir_line_paid(pk.tenant_id, pk.invoice_line_id) - pk.moved_to_balance)::bigint
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_paid(public.packages) FROM PUBLIC;--> statement-breakpoint

-- The value already taken by redeemed and reserved sessions.
CREATE FUNCTION public.package_taken(pk public.packages) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(sum(s.allocated_value), 0)::bigint FROM public.package_sessions s
   WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state IN ('reserved','redeemed')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_taken(public.packages) FROM PUBLIC;--> statement-breakpoint

-- Whether an execution is a package session's (reserved, redeemed, or returned to available after a stop; r3 1).
CREATE FUNCTION public.package_execution_covered(p_tenant uuid, p_execution uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.package_sessions s WHERE s.tenant_id = p_tenant
                   AND (s.reserved_execution_id = p_execution OR p_execution = ANY (s.returned_execution_ids)))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_execution_covered(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The service of a plan item (its catalog version's item).
CREATE FUNCTION public.package_plan_service(p_tenant uuid, p_item uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT cv.item_id FROM public.plan_items t JOIN public.catalog_versions cv ON cv.tenant_id = t.tenant_id AND cv.id = t.catalog_version_id
   WHERE t.tenant_id = p_tenant AND t.id = p_item
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_plan_service(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A substitution's difference is settled when there is none (≤ 0) or its line is fully paid in real money.
CREATE FUNCTION public.package_session_settled(s public.package_sessions) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.package_substitutions u WHERE u.tenant_id = s.tenant_id AND u.session_id = s.id AND u.state = 'approved' AND u.difference > 0
       AND NOT EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                        WHERE l.tenant_id = u.tenant_id AND l.substitution_id = u.id AND i.state = 'issued'
                          AND public.kasir_line_paid(l.tenant_id, l.id) >= l.line_total))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_session_settled(public.package_sessions) FROM PUBLIC;--> statement-breakpoint

-- The session covering a plan item on a visit (r2 F5): the plan item's qty is 1 and an unbound reserved session of
-- its service is on the visit with its difference settled; the first by package then seq.
CREATE FUNCTION public.package_covering_session(p_tenant uuid, p_visit uuid, p_item uuid) RETURNS public.package_sessions
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.* FROM public.package_sessions s
   WHERE s.tenant_id = p_tenant AND s.reserved_visit_id = p_visit AND s.state = 'reserved' AND s.reserved_execution_id IS NULL
     AND s.service_item_id = public.package_plan_service(p_tenant, p_item)
     AND EXISTS (SELECT 1 FROM public.plan_items t WHERE t.tenant_id = p_tenant AND t.id = p_item AND t.qty = 1)
     AND public.package_session_settled(s)
   ORDER BY s.package_id, s.seq LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_covering_session(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Whether the visit has any package session reserved or redeemed on it (then uncovered items need the bill).
CREATE FUNCTION public.package_on_visit(p_tenant uuid, p_visit uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.package_sessions s WHERE s.tenant_id = p_tenant AND s.reserved_visit_id = p_visit)
      OR EXISTS (SELECT 1 FROM public.package_sessions s JOIN public.treatment_executions e ON e.tenant_id = s.tenant_id AND e.id = s.reserved_execution_id
                  WHERE s.tenant_id = p_tenant AND e.visit_id = p_visit)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_on_visit(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- An ordinary visit invoice (not addition, substitution or package lines; r2 F3).
CREATE FUNCTION public.invoice_is_ordinary(p_tenant uuid, p_invoice uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_invoice
                       AND (l.plan_item_id IS NOT NULL OR l.substitution_id IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.invoice_id = p_invoice)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_is_ordinary(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Spread the package line's recognised VAT over its sessions (r2 F4, r3 2): only for a package invoiced while PKP;
-- the pool is line recognised − package reversed; waterfall redeemed, reserved, available (by seq), each capped at its
-- own VAT; an excess over the open sessions' VAT (a cheaper substitution) is reversed on the package.
CREATE FUNCTION public.package_sync_vat(p_tenant uuid, p_package uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk public.packages;
  l public.invoice_lines;
  v_pool bigint;
  v_open bigint;
  s record;
  v_give bigint;
BEGIN
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = p_tenant AND x.id = p_package;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id AND i.is_pkp_at_issue) THEN
    RETURN;
  END IF;
  l := public.package_line(pk);
  v_pool := greatest(0, l.vat_recognised_amount - pk.vat_reversed_amount);
  SELECT coalesce(sum(x.vat_amount), 0) INTO v_open FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id AND x.state <> 'closed';
  IF v_pool > v_open THEN
    UPDATE public.packages SET vat_reversed_amount = vat_reversed_amount + (v_pool - v_open), vat_reversed_at = coalesce(vat_reversed_at, p_at)
     WHERE tenant_id = pk.tenant_id AND id = pk.id;
    v_pool := v_open;
  END IF;
  FOR s IN SELECT x.id, x.vat_amount, x.vat_recognised_amount FROM public.package_sessions x
            WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id AND x.state <> 'closed'
            ORDER BY CASE x.state WHEN 'redeemed' THEN 1 WHEN 'reserved' THEN 2 ELSE 3 END, x.seq LOOP
    v_give := least(v_pool, s.vat_amount);
    v_pool := v_pool - v_give;
    IF v_give <> s.vat_recognised_amount THEN
      UPDATE public.package_sessions SET vat_recognised_amount = v_give, vat_recognised_at = CASE WHEN v_give > 0 THEN coalesce(vat_recognised_at, p_at) END,
             version = version + 1
       WHERE tenant_id = pk.tenant_id AND id = s.id;
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_sync_vat(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- The service audit of the unbound expiry scan (r2 F7; as payment_audit_service): no staff, service identity.
CREATE FUNCTION public.package_audit_service(p_tenant uuid, p_action text, p_object_kind text, p_object uuid, p_outcome text, p_reason_code text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_prev text;
  v_seq bigint;
  v_row public.audit_events;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || p_tenant::text, 0));
  SELECT e.hash, e.seq INTO v_prev, v_seq FROM public.audit_events e WHERE e.tenant_id = p_tenant ORDER BY e.seq DESC LIMIT 1;
  v_row := ROW(
    public.uuid_generate_v7(), p_tenant, coalesce(v_seq, 0) + 1, clock_timestamp(),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'package_expiry', NULL,
    p_action, p_object_kind, p_object, p_outcome, p_reason_code, NULL,
    coalesce(v_prev, repeat('0', 64)), repeat('0', 64))::public.audit_events;
  v_row.hash := encode(public.digest(v_row.prev_hash || public.audit_canonical(v_row), 'sha256'), 'hex');
  INSERT INTO public.audit_events SELECT v_row.*;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_audit_service(uuid, text, text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.package_contents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY package_contents_read ON public.package_contents FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.package_contents_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.package_contents TO clinic_app;--> statement-breakpoint
CREATE POLICY package_contents_operator_read ON public.package_contents FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.package_contents', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.package_contents TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER package_contents_no_truncate BEFORE TRUNCATE ON public.package_contents FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.package_contents ENABLE ALWAYS TRIGGER package_contents_no_truncate;--> statement-breakpoint
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY packages_read ON public.packages FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.package_readable(tenant_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, sold_branch_id, patient_id, invoice_id, invoice_line_id, item_id, catalog_version_id, price, min_dp, validity_end, moved_to_balance, state, closed_at, closed_by, closed_as, paid_unused_moved, remainder_cancelled, vat_reversed_amount, vat_reversed_at, created_by, created_as, created_at) ON public.packages TO clinic_app;--> statement-breakpoint
CREATE POLICY packages_operator_read ON public.packages FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.packages', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, sold_branch_id, patient_id, invoice_id, invoice_line_id, item_id, catalog_version_id, price, min_dp, validity_end, moved_to_balance, state, closed_at, closed_by, closed_as, paid_unused_moved, remainder_cancelled, vat_reversed_amount, vat_reversed_at, created_by, created_as, created_at) ON public.packages TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER packages_no_truncate BEFORE TRUNCATE ON public.packages FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.packages ENABLE ALWAYS TRIGGER packages_no_truncate;--> statement-breakpoint
ALTER TABLE public.package_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY package_sessions_read ON public.package_sessions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.package_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.package_sessions TO clinic_app;--> statement-breakpoint
CREATE POLICY package_sessions_operator_read ON public.package_sessions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.package_sessions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.package_sessions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER package_sessions_no_truncate BEFORE TRUNCATE ON public.package_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.package_sessions ENABLE ALWAYS TRIGGER package_sessions_no_truncate;--> statement-breakpoint
ALTER TABLE public.package_substitutions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY package_substitutions_read ON public.package_substitutions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.package_readable(tenant_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, package_id, session_id, old_service_item_id, new_service_item_id, old_value, new_price, difference, state, requested_by, requested_as, decided_by, decided_as, decided_at, command_key, created_at) ON public.package_substitutions TO clinic_app;--> statement-breakpoint
CREATE POLICY package_substitutions_operator_read ON public.package_substitutions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.package_substitutions', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, package_id, session_id, old_service_item_id, new_service_item_id, old_value, new_price, difference, state, requested_by, requested_as, decided_by, decided_as, decided_at, command_key, created_at) ON public.package_substitutions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER package_substitutions_no_truncate BEFORE TRUNCATE ON public.package_substitutions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.package_substitutions ENABLE ALWAYS TRIGGER package_substitutions_no_truncate;--> statement-breakpoint
ALTER TABLE public.balance_top_ups ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY balance_top_ups_read ON public.balance_top_ups FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.kasir_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.balance_top_ups TO clinic_app;--> statement-breakpoint
CREATE POLICY balance_top_ups_operator_read ON public.balance_top_ups FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.balance_top_ups', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.balance_top_ups TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER balance_top_ups_no_truncate BEFORE TRUNCATE ON public.balance_top_ups FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.balance_top_ups ENABLE ALWAYS TRIGGER balance_top_ups_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.package_contents', 'tenant-shared', 'cashier', '{owner,admin_pusat,manager,fo_cashier,finance,auditor}', 'package definers (src/modules/packages)', 'none (catalog configuration)'),
  ('public.packages', 'tenant-shared', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'package definers (src/modules/packages)', 'none (tenant-wide; the sold branch recorded)'),
  ('public.package_sessions', 'tenant-shared', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'package definers (src/modules/packages)', 'none (tenant-wide; redeemed at any branch)'),
  ('public.package_substitutions', 'tenant-shared', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'package definers (src/modules/packages)', 'the requesting branch recorded'),
  ('public.balance_top_ups', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'package definers (src/modules/packages)', 'the receiving branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): package contents are configuration; a patient's packages, sessions, substitutions and top-ups are personal.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.package_contents', 'config'),
  ('public.packages', 'personal'),
  ('public.package_sessions', 'personal'),
  ('public.package_substitutions', 'personal'),
  ('public.balance_top_ups', 'personal');--> statement-breakpoint

-- ── T-076 packages (PR-20, BILL-7..11, BILL-16, BILL-24, BILL-25, DEC-087) ──────────────────────────────────────
-- Cross-module keys (the tables live in the packages module, created above).
ALTER TABLE public.invoice_lines ADD CONSTRAINT invoice_lines_substitution_fk FOREIGN KEY (tenant_id, substitution_id)
  REFERENCES public.package_substitutions (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_top_up_fk FOREIGN KEY (tenant_id, top_up_id)
  REFERENCES public.balance_top_ups (tenant_id, id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX payment_allocations_top_up_idx ON public.payment_allocations (tenant_id, top_up_id) WHERE top_up_id IS NOT NULL;--> statement-breakpoint

-- Package contents: edited while their version is unreferenced (never sold, CLIN-011); a service item; deletable then
-- (a template row, not history).
CREATE FUNCTION public.package_contents_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.package_contents := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || r.tenant_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.catalog_versions v JOIN public.catalog_items i ON i.tenant_id = v.tenant_id AND i.id = v.item_id
                  WHERE v.tenant_id = r.tenant_id AND v.id = r.package_version_id AND i.kind = 'package' AND v.referenced_at IS NULL) THEN
    RAISE EXCEPTION 'package contents change only on an unsold package version' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.catalog_items i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.service_item_id AND i.kind = 'service') THEN
    RAISE EXCEPTION 'a package contains services' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_contents_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_contents_guard BEFORE INSERT OR UPDATE OR DELETE ON public.package_contents FOR EACH ROW EXECUTE FUNCTION public.package_contents_guard();--> statement-breakpoint
ALTER TABLE public.package_contents ENABLE ALWAYS TRIGGER package_contents_guard;--> statement-breakpoint

-- A new version of a package item starts with the previous version's contents (r1 open point 1).
CREATE FUNCTION public.package_contents_carry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_prev uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.catalog_items i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id AND i.kind = 'package') THEN
    RETURN NULL;
  END IF;
  SELECT v.id INTO v_prev FROM public.catalog_versions v WHERE v.tenant_id = NEW.tenant_id AND v.item_id = NEW.item_id AND v.id <> NEW.id
   ORDER BY v.version DESC LIMIT 1;
  IF v_prev IS NOT NULL THEN
    INSERT INTO public.package_contents (tenant_id, package_version_id, seq, service_item_id, count)
    SELECT c.tenant_id, NEW.id, c.seq, c.service_item_id, c.count FROM public.package_contents c WHERE c.tenant_id = NEW.tenant_id AND c.package_version_id = v_prev;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_contents_carry() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER catalog_versions_package_contents AFTER INSERT ON public.catalog_versions FOR EACH ROW EXECUTE FUNCTION public.package_contents_carry();--> statement-breakpoint
ALTER TABLE public.catalog_versions ENABLE ALWAYS TRIGGER catalog_versions_package_contents;--> statement-breakpoint

-- Packages: never deleted; identity and sale snapshot frozen; moved_to_balance only grows; closing once (active →
-- expired or cancelled) with its amounts; the reversed VAT only grows.
CREATE FUNCTION public.packages_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'packages are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'active' OR NEW.moved_to_balance <> 0 OR NEW.vat_reversed_amount <> 0
       OR NOT EXISTS (SELECT 1 FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                       WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.invoice_line_id AND i.id = NEW.invoice_id AND i.state = 'issued'
                         AND i.visit_id IS NULL AND NOT i.counter AND i.patient_id = NEW.patient_id AND i.branch_id = NEW.sold_branch_id
                         AND l.item_id = NEW.item_id AND l.catalog_version_id = NEW.catalog_version_id AND l.line_total = NEW.price AND l.quantity = 1) THEN
      RAISE EXCEPTION 'a package opens active from its invoice line' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.sold_branch_id, NEW.patient_id, NEW.invoice_id, NEW.invoice_line_id, NEW.item_id, NEW.catalog_version_id, NEW.price,
      NEW.min_dp, NEW.validity_end, NEW.created_by, NEW.created_as, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.sold_branch_id, OLD.patient_id, OLD.invoice_id, OLD.invoice_line_id, OLD.item_id, OLD.catalog_version_id, OLD.price,
      OLD.min_dp, OLD.validity_end, OLD.created_by, OLD.created_as, OLD.created_at)
     OR NEW.moved_to_balance < OLD.moved_to_balance OR NEW.vat_reversed_amount < OLD.vat_reversed_amount
     OR OLD.state <> 'active' AND (NEW.state, NEW.closed_at, NEW.closed_by, NEW.closed_as, NEW.close_reason, NEW.paid_unused_moved, NEW.remainder_cancelled, NEW.moved_to_balance)
        IS DISTINCT FROM (OLD.state, OLD.closed_at, OLD.closed_by, OLD.closed_as, OLD.close_reason, OLD.paid_unused_moved, OLD.remainder_cancelled, OLD.moved_to_balance) THEN
    RAISE EXCEPTION 'a package keeps its sale; it closes once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.packages_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER packages_guard BEFORE INSERT OR UPDATE OR DELETE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.packages_guard();--> statement-breakpoint
ALTER TABLE public.packages ENABLE ALWAYS TRIGGER packages_guard;--> statement-breakpoint

-- Sessions: never deleted; identity frozen; available ⇄ reserved (an open visit of the package's patient cluster)
-- → redeemed (final) on a counted execution; any open state → closed with its package; the service and value change
-- only by an approved substitution (version + 1); the reserved visit stays open while reserved.
CREATE FUNCTION public.package_sessions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk public.packages;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'package sessions are never deleted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.package_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'available' OR NEW.vat_recognised_amount <> 0 OR NEW.version <> 0 OR cardinality(NEW.returned_execution_ids) <> 0 OR pk.state IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'a session opens available on an active package' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.package_id, NEW.seq, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.package_id, OLD.seq, OLD.created_at)
     OR OLD.state IN ('redeemed','closed') AND (NEW.state, NEW.service_item_id, NEW.allocated_value, NEW.reserved_visit_id, NEW.reserved_execution_id, NEW.redeemed_at)
        IS DISTINCT FROM (OLD.state, OLD.service_item_id, OLD.allocated_value, OLD.reserved_visit_id, OLD.reserved_execution_id, OLD.redeemed_at)
     OR NOT (NEW.state = OLD.state OR OLD.state = 'available' AND NEW.state IN ('reserved','closed') OR OLD.state = 'reserved' AND NEW.state IN ('available','redeemed','closed'))
     OR NOT (OLD.returned_execution_ids <@ NEW.returned_execution_ids)
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'a session moves available ⇄ reserved → redeemed, or closes with its package' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'reserved' AND OLD.state <> 'reserved' AND (pk.state <> 'active' OR NOT EXISTS (
       SELECT 1 FROM public.visits v WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.reserved_visit_id AND v.closed_at IS NULL
          AND public.patient_canonical(v.tenant_id, v.patient_id) = public.patient_canonical(pk.tenant_id, pk.patient_id))) THEN
    RAISE EXCEPTION 'a session is reserved on an open visit of its patient' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = 'redeemed' AND OLD.state <> 'redeemed' AND NOT EXISTS (
       SELECT 1 FROM public.treatment_executions e WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.reserved_execution_id AND e.state = 'finished' AND e.counted) THEN
    RAISE EXCEPTION 'a session is redeemed by its counted execution' USING ERRCODE = '42501';
  END IF;
  IF (NEW.service_item_id, NEW.allocated_value, NEW.tax_category, NEW.tax_basis) IS DISTINCT FROM (OLD.service_item_id, OLD.allocated_value, OLD.tax_category, OLD.tax_basis)
     AND NOT EXISTS (SELECT 1 FROM public.package_substitutions u WHERE u.tenant_id = NEW.tenant_id AND u.session_id = NEW.id AND u.state = 'approved'
                       AND u.new_service_item_id = NEW.service_item_id AND u.old_service_item_id = OLD.service_item_id) THEN
    RAISE EXCEPTION 'a session changes service only by an approved substitution' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_sessions_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_sessions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.package_sessions FOR EACH ROW EXECUTE FUNCTION public.package_sessions_guard();--> statement-breakpoint
ALTER TABLE public.package_sessions ENABLE ALWAYS TRIGGER package_sessions_guard;--> statement-breakpoint

-- Substitutions: never deleted; the request frozen; decided once (pending → approved or declined).
CREATE FUNCTION public.package_substitutions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'substitutions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' THEN
      RAISE EXCEPTION 'a substitution opens pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','decided_by','decided_as','decided_at','decision_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','decided_by','decided_as','decided_at','decision_reason'])
     OR OLD.state <> 'pending' OR NEW.state = 'pending' OR NEW.decided_by = OLD.requested_by THEN
    RAISE EXCEPTION 'a substitution is decided once, by someone else' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_substitutions_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_substitutions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.package_substitutions FOR EACH ROW EXECUTE FUNCTION public.package_substitutions_guard();--> statement-breakpoint
ALTER TABLE public.package_substitutions ENABLE ALWAYS TRIGGER package_substitutions_guard;--> statement-breakpoint

CREATE TRIGGER balance_top_ups_insert_only BEFORE UPDATE OR DELETE ON public.balance_top_ups FOR EACH ROW EXECUTE FUNCTION public.kasir_rows_insert_only();--> statement-breakpoint
ALTER TABLE public.balance_top_ups ENABLE ALWAYS TRIGGER balance_top_ups_insert_only;--> statement-breakpoint

-- The package opens at issue (invoice_issue, PR-20): its sessions split the line total by the selling branch's
-- effective prices of the contents (BILL-7, PR-42; package_allocate), in contents order; each session snapshots its
-- service's tax category and basis and a share of the line's VAT (by its value), so Σ session VAT = line VAT.
-- Minimum DP (BILL-9): the first session's value or the line × (min_dp_pct, else SET-9 dp_minimum) %, whichever is
-- larger; the whole price when installments are off (the version's switch, else SET-9 cicilan). Validity (BILL-10):
-- the version's days, else SET-8.
CREATE FUNCTION public.package_open(i public.invoices, p_staff uuid, p_role text, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  cv public.catalog_versions;
  v_services uuid[] := '{}';
  v_weights bigint[] := '{}';
  v_alloc bigint[];
  v_vat bigint[];
  c record;
  k integer;
  v_price bigint;
  v_set9 jsonb := public.setting_value_at('SET-9', NULL, p_at);
  v_pct integer;
  v_inst boolean;
  v_min bigint;
  v_days integer;
  v_id uuid;
  sv public.catalog_versions;
BEGIN
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id;
  SELECT * INTO cv FROM public.catalog_versions x WHERE x.tenant_id = l.tenant_id AND x.id = l.catalog_version_id;
  FOR c IN SELECT pc.* FROM public.package_contents pc WHERE pc.tenant_id = cv.tenant_id AND pc.package_version_id = cv.id ORDER BY pc.seq LOOP
    v_price := public.catalog_branch_price(c.service_item_id, i.branch_id, p_at);
    IF v_price IS NULL OR v_price < 1 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: package_service_price' USING ERRCODE = '22023';
    END IF;
    FOR k IN 1..c.count LOOP
      v_services := v_services || c.service_item_id;
      v_weights := v_weights || v_price;
    END LOOP;
  END LOOP;
  IF cardinality(v_services) = 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: package_empty' USING ERRCODE = '22023';
  END IF;
  v_alloc := public.package_allocate(l.line_total, v_weights);
  v_vat := CASE WHEN l.vat_amount = 0 THEN array_fill(0::bigint, ARRAY[cardinality(v_alloc)])
                ELSE public.package_allocate(l.vat_amount, (SELECT array_agg(greatest(x, 1) ORDER BY o) FROM unnest(v_alloc) WITH ORDINALITY t(x, o))) END;
  v_pct := coalesce(cv.min_dp_pct, (v_set9 ->> 'dp_minimum')::integer, 0);
  v_inst := cv.installments_allowed OR coalesce((v_set9 ->> 'cicilan')::boolean, true);
  v_min := CASE WHEN NOT v_inst THEN l.line_total ELSE least(l.line_total, greatest(v_alloc[1], (l.line_total * v_pct + 99) / 100, 1)) END;
  v_days := coalesce(cv.validity_days, (public.setting_value_at('SET-8', NULL, p_at) #>> '{}')::integer, 365);
  INSERT INTO public.packages (tenant_id, sold_branch_id, patient_id, invoice_id, invoice_line_id, item_id, catalog_version_id, price, min_dp, validity_end,
                               created_by, created_as)
  VALUES (i.tenant_id, i.branch_id, public.patient_canonical(i.tenant_id, i.patient_id), i.id, l.id, l.item_id, l.catalog_version_id, l.line_total, v_min,
          p_at + make_interval(days => v_days), p_staff, p_role)
  RETURNING id INTO v_id;
  FOR k IN 1..cardinality(v_services) LOOP
    SELECT x.* INTO sv FROM public.catalog_versions x WHERE x.tenant_id = i.tenant_id AND x.item_id = v_services[k] AND x.state = 'active';
    INSERT INTO public.package_sessions (tenant_id, package_id, seq, service_item_id, allocated_value, tax_category, tax_basis, vat_base, vat_amount)
    VALUES (i.tenant_id, v_id, k, v_services[k], v_alloc[k], coalesce(sv.tax_category, l.tax_category), coalesce(sv.tax_basis, l.tax_basis),
            v_alloc[k] - least(v_vat[k], v_alloc[k]), least(v_vat[k], v_alloc[k]));
  END LOOP;
  -- The sale is InvoiceIssued (TD-7 has no package-sold event).
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_open(public.invoices, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- kasir_outstanding (re-created from 0087): the cancelled remainder is not owed (BILL-10).
CREATE OR REPLACE FUNCTION public.kasir_outstanding(p_tenant uuid, p_invoice uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(sum(greatest(0, l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id))), 0)::bigint
    FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_invoice
$$;--> statement-breakpoint

-- payment_line_room (re-created from 0088): a cancelled remainder has no room.
CREATE OR REPLACE FUNCTION public.payment_line_room(p_tenant uuid, p_line uuid, p_simulated boolean) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT greatest(0, l.line_total - l.cancelled_amount - CASE WHEN p_simulated
           THEN (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = l.tenant_id AND a.invoice_line_id = l.id)
           ELSE public.kasir_line_paid(l.tenant_id, l.id) END)::bigint
    FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.id = p_line
$$;--> statement-breakpoint

-- payment_allocations_guard (re-created from 0087): a top-up target; nothing beyond the line's uncancelled value.
CREATE OR REPLACE FUNCTION public.payment_allocations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  p public.payments;
  l public.invoice_lines;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  SELECT * INTO p FROM public.payments x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.payment_id;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.invoice_line_id;
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
          AND a.is_simulated = NEW.is_simulated) + NEW.amount > l.line_total - l.cancelled_amount
     OR (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.payment_id = NEW.payment_id) + NEW.amount > p.amount THEN
    RAISE EXCEPTION 'an allocation stays within its payment and its line' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- invoice_lines_guard (re-created from 0089): the substitution frozen; the cancelled remainder set once; moved to balance only grows, never beyond the paid value.
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
    IF NEW.cancelled_amount <> 0 OR NEW.moved_to_balance <> 0 OR NEW.vat_reversed_amount <> 0 THEN
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
     OR NEW.vat_reversed_amount < OLD.vat_reversed_amount
     OR NEW.vat_recognised_amount < OLD.vat_recognised_amount
     OR OLD.vat_recognised_at IS NOT NULL AND NEW.vat_recognised_at IS DISTINCT FROM OLD.vat_recognised_at AND NEW.vat_recognised_amount = OLD.vat_recognised_amount
     OR OLD.tax_document_ref IS NOT NULL AND NEW.tax_document_ref IS DISTINCT FROM OLD.tax_document_ref THEN
    RAISE EXCEPTION 'an invoice line is frozen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- invoice_line_snapshot (replaced: the 0089 6-argument version dropped; its only caller is invoice_issue): a substitution
-- difference line priced at the approved difference.
DROP FUNCTION public.invoice_line_snapshot(public.invoices, uuid, integer, bigint, timestamptz, uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.invoice_line_snapshot(p_invoice public.invoices, p_item uuid, p_quantity integer, p_discount bigint, p_at timestamptz, p_plan_item uuid, p_substitution uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.catalog_versions;
  v_price bigint;
  v_total bigint;
  v_pkp boolean;
  v_split record;
  v_id uuid;
  u public.package_substitutions;
BEGIN
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quantity' USING ERRCODE = '22023';
  END IF;
  SELECT x.* INTO v FROM public.catalog_versions x JOIN public.catalog_items i ON i.tenant_id = x.tenant_id AND i.id = x.item_id
   WHERE x.tenant_id = p_invoice.tenant_id AND x.item_id = p_item AND x.state = 'active' AND i.kind <> 'material';
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: item not found' USING ERRCODE = 'P0002';
  END IF;
  v_price := public.catalog_branch_price(p_item, p_invoice.branch_id, p_at);
  -- T-076 (r2 F3): a substitution difference line is priced at the approved difference (never from the request).
  IF p_substitution IS NOT NULL THEN
    SELECT * INTO u FROM public.package_substitutions x WHERE x.tenant_id = p_invoice.tenant_id AND x.id = p_substitution;
    IF u.id IS NULL OR u.state <> 'approved' OR u.difference <= 0 OR u.new_service_item_id <> p_item OR p_quantity <> 1 OR p_discount <> 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: substitution_line' USING ERRCODE = '22023';
    END IF;
    v_price := u.difference;
  END IF;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: item not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_discount IS NULL OR p_discount < 0 OR p_discount > v_price * p_quantity THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: discount' USING ERRCODE = '22023';
  END IF;
  v_total := v_price * p_quantity - p_discount;
  v_pkp := public.tax_pkp_at(p_invoice.tenant_id, p_at, p_invoice.branch_id);
  IF v_pkp AND v.tax_category IN ('taxable_service','taxable_goods') THEN
    PERFORM public.feature_gate_lock('vat_on_invoices');
    IF NOT public.feature_gate_open('vat_on_invoices') THEN
      RAISE EXCEPTION 'ERR_GATE_CLOSED: vat_on_invoices' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_split FROM public.tax_vat_split(v_total, v.tax_category, v_pkp);
  PERFORM public.catalog_version_reference(v.id);
  INSERT INTO public.invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, discount, line_total,
                                    tax_category, tax_basis, vat_base, vat_amount, plan_item_id, substitution_id)
  VALUES (p_invoice.tenant_id, p_invoice.branch_id, p_invoice.id, p_item, v.id, p_quantity, v_price, p_discount, v_total,
          v.tax_category, v.tax_basis, v_split.base, v_split.vat, p_plan_item, p_substitution)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_line_snapshot(public.invoices, uuid, integer, bigint, timestamptz, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- invoice_issue (re-created from 0089): the package invoice (one package line; the package opens with its sessions) and the substitution difference invoice; the one-ordinary-invoice rule counts ordinary invoices only (T-076).
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
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'lines' <> '{}'::jsonb OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p -> 'lines') NOT BETWEEN 1 AND 100
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'item_id' - 'quantity' - 'discount' - 'plan_item_id' - 'substitution_id' <> '{}'::jsonb
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
  IF i.counter AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'lines') x
                             LEFT JOIN public.catalog_items ci ON ci.tenant_id = i.tenant_id AND ci.id = (x ->> 'item_id')::uuid
                            WHERE ci.kind IS DISTINCT FROM 'product') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: counter_products_only' USING ERRCODE = '22023';
  END IF;
  FOR v_l IN SELECT x FROM jsonb_array_elements(p -> 'lines') x LOOP
    PERFORM public.invoice_line_snapshot(i, (v_l ->> 'item_id')::uuid, (v_l ->> 'quantity')::integer, coalesce((v_l ->> 'discount')::bigint, 0), v_at,
                                       (v_l ->> 'plan_item_id')::uuid, (v_l ->> 'substitution_id')::uuid);
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
  IF v_package THEN
    PERFORM public.package_open(i, a.staff_id, a.role, v_at);
  END IF;
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceIssued', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'branch_id', i.branch_id));
  PERFORM public.audit_append('settings_change', 'invoice', i.id, 'success', 'invoice_issued');
  RETURN jsonb_build_object('invoice_id', i.id, 'issued_at', v_at, 'is_pkp_at_issue', v_pkp, 'number', v_number,
    'total', (SELECT sum(x.line_total) FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id));
END
$$;--> statement-breakpoint

-- kasir_record_payment (re-created from 0090): the room excludes a cancelled remainder; a package payment spreads its VAT to the sessions (T-076).
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
      SELECT array_agg(l.id ORDER BY l.id), array_agg(l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id)
        INTO v_ids, v_room FROM public.invoice_lines l
       WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0;
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

-- payment_receive (re-created from 0090): the first payment of a package reaches its minimum DP (BILL-9; T-076).
CREATE OR REPLACE FUNCTION public.payment_receive(p_key text, p_invoice uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  i public.invoices;
  v_at timestamptz := clock_timestamp();
  v_t jsonb;
  v_sum bigint := 0;
  v_r jsonb;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visits v WHERE v.tenant_id = i.tenant_id AND v.id = i.visit_id FOR UPDATE;
  END IF;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice FOR UPDATE;
  IF i.state <> 'issued' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: invoice %', i.state USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id AND ap.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: void_pending' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'tenders' <> '{}'::jsonb OR jsonb_typeof(p -> 'tenders') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p -> 'tenders') NOT BETWEEN 1 AND 6
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'tenders') t
                 WHERE jsonb_typeof(t) IS DISTINCT FROM 'object' OR t - 'method' - 'amount' - 'cash_tendered' - 'details' <> '{}'::jsonb
                    OR coalesce(t ->> 'method', '') NOT IN ('cash','edc','transfer','qris','va','payment_link','balance')
                    OR jsonb_typeof(t -> 'amount') IS DISTINCT FROM 'number' OR (t ->> 'amount') !~ '^[1-9]\d{0,12}$'
                    OR (t ->> 'method' = 'cash') <> (t ? 'cash_tendered')
                    OR t ? 'cash_tendered' AND (jsonb_typeof(t -> 'cash_tendered') IS DISTINCT FROM 'number' OR (t ->> 'cash_tendered') !~ '^[1-9]\d{0,12}$'
                                                 OR (t ->> 'cash_tendered')::bigint < (t ->> 'amount')::bigint)
                    OR t ? 'details' AND (t ->> 'method' NOT IN ('edc','transfer') OR jsonb_typeof(t -> 'details') IS DISTINCT FROM 'object'
                                          OR (t -> 'details') - 'card_type' - 'bank' - 'trace' - 'approval_code' - 'reference' <> '{}'::jsonb
                                          OR EXISTS (SELECT 1 FROM jsonb_each(t -> 'details') d WHERE jsonb_typeof(d.value) <> 'string' OR length(d.value #>> '{}') NOT BETWEEN 1 AND 60)))
     OR (SELECT count(*) FROM jsonb_array_elements(p -> 'tenders') t WHERE t ->> 'method' = 'cash') > 1
     OR (SELECT count(*) FROM jsonb_array_elements(p -> 'tenders') t WHERE t ->> 'method' = 'balance') > 1 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: tenders' USING ERRCODE = '22023';
  END IF;
  FOR v_t IN SELECT t FROM jsonb_array_elements(p -> 'tenders') t LOOP
    IF v_t ->> 'method' IN ('qris','va','payment_link') THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: payment_port' USING ERRCODE = '55000';
    ELSIF NOT public.kasir_method_enabled(v_t ->> 'method', v_at) THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
    ELSIF v_t ->> 'method' = 'balance' AND i.patient_id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_AVAILABLE: balance' USING ERRCODE = '55000';
    END IF;
    v_sum := v_sum + (v_t ->> 'amount')::bigint;
  END LOOP;
  -- Lines in id order, locked; the outstanding is read under the lock.
  PERFORM 1 FROM public.invoice_lines l WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id ORDER BY l.id FOR UPDATE;
  IF v_sum > public.kasir_outstanding(i.tenant_id, i.id) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: overpayment' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = i.tenant_id AND pk.invoice_id = i.id AND public.kasir_line_paid(pk.tenant_id, pk.invoice_line_id) = 0
               AND v_sum < pk.min_dp) THEN
    RAISE EXCEPTION 'ERR_MIN_DP_NOT_MET: min_dp' USING ERRCODE = 'P0422';
  END IF;
  v_r := public.kasir_record_payment(i, p_key, p -> 'tenders', NULL, a.staff_id, a.role, v_at);
  PERFORM public.audit_append('money_correction', 'receipt', (v_r ->> 'receipt_id')::uuid, 'success', 'payment_received');
  RETURN jsonb_build_object('receipt_id', v_r -> 'receipt_id', 'number', v_r -> 'number', 'paid', v_r -> 'paid', 'change', v_r -> 'change',
    'outstanding', public.kasir_outstanding(i.tenant_id, i.id));
END
$$;--> statement-breakpoint

-- payment_charge_create (re-created from 0088): the minimum DP on a first package charge; the room excludes a cancelled remainder (T-076).
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
  SELECT array_agg(l.id ORDER BY l.id), array_agg(l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id) ORDER BY l.id)
    INTO v_ids, v_room FROM public.invoice_lines l
   WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.line_total - l.cancelled_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0;
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

-- invoice_void_sync (re-created from 0088): a void closes its package (T-076).
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

-- payments_guard (re-created from 0090): a payment with no invoice is a balance top-up (T-076, r3 3).
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
  -- T-076 (r3 3): a payment with no invoice is an Isi Saldo: cash, EDC or transfer, a patient, real, no charge, its top-up.
  IF NEW.invoice_id IS NULL THEN
    IF NEW.method NOT IN ('cash','edc','transfer') OR NEW.patient_id IS NULL OR NEW.is_simulated OR NEW.charge_id IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.balance_top_ups u WHERE u.tenant_id = NEW.tenant_id AND u.receipt_id = NEW.receipt_id AND u.branch_id = NEW.branch_id
                        AND u.patient_id = NEW.patient_id AND u.amount = NEW.amount)
       OR NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id AND r.invoice_id IS NULL AND r.branch_id = NEW.branch_id
                        AND NOT r.is_simulated) THEN
      RAISE EXCEPTION 'a payment with no invoice is a balance top-up' USING ERRCODE = '42501';
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

-- receipt_get (re-created from 0088): the auditor's mask also covers a top-up receipt's patient (T-076).
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
               (SELECT u.patient_id FROM public.balance_top_ups u WHERE u.tenant_id = r.tenant_id AND u.receipt_id = r.id)));
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

-- treatment_payment_unpaid (re-created from 0089): a plan item covered by a reserved package session is paid; uncovered items need the ordinary bill when a session is on the visit (T-076).
CREATE OR REPLACE FUNCTION public.treatment_payment_unpaid(v public.visits, p_item uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT v.payment = 'blocked'
      OR NOT (public.package_covering_session(v.tenant_id, v.id, p_item)).id IS NOT NULL AND (
         EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued'
                   AND public.invoice_is_ordinary(i.tenant_id, i.id) AND public.kasir_outstanding(i.tenant_id, i.id) > 0)
      OR (v.selection = 'done' OR public.package_on_visit(v.tenant_id, v.id)) AND NOT public.addition_of_visit(v.tenant_id, v.id, p_item) AND NOT EXISTS (
           SELECT 1 FROM public.invoices i WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued'
              AND public.invoice_is_ordinary(i.tenant_id, i.id)))
      OR v.payment = 'in_progress' AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued')
         AND NOT public.addition_unbilled_counted(v.tenant_id, v.id)
      OR public.addition_of_visit(v.tenant_id, v.id, p_item) AND (public.package_covering_session(v.tenant_id, v.id, p_item)).id IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.addition_releases r WHERE r.tenant_id = v.tenant_id AND r.visit_id = v.id AND r.plan_item_id = p_item)
         AND NOT public.addition_paid(v.tenant_id, v.id, p_item)
$$;--> statement-breakpoint

-- addition_unbilled_counted (re-created from 0089): an addition performed on a package session is not owed (T-076).
CREATE OR REPLACE FUNCTION public.addition_unbilled_counted(p_tenant uuid, p_visit uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.treatment_executions e
     WHERE e.tenant_id = p_tenant AND e.visit_id = p_visit AND e.state = 'finished' AND e.counted
       AND public.addition_of_visit(p_tenant, p_visit, e.plan_item_id) AND NOT public.package_execution_covered(p_tenant, e.id)
       AND (public.addition_line(p_tenant, p_visit, e.plan_item_id)).id IS NULL)
$$;--> statement-breakpoint

-- addition_finished (re-created from 0089): no unpaid alert for an addition performed on a package session (T-076).
CREATE OR REPLACE FUNCTION public.addition_finished() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_event uuid;
BEGIN
  IF OLD.state = 'finished' OR NEW.state <> 'finished' OR NOT NEW.counted OR NOT public.addition_of_visit(NEW.tenant_id, NEW.visit_id, NEW.plan_item_id)
     OR public.package_execution_covered(NEW.tenant_id, NEW.id) THEN
    RETURN NULL;
  END IF;
  IF NOT public.addition_paid(NEW.tenant_id, NEW.visit_id, NEW.plan_item_id) THEN
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (NEW.tenant_id, NEW.branch_id, 'AdditionFinishedUnpaid', 'treatment_execution', NEW.id, NEW.finished_by, NEW.finished_as,
            jsonb_build_object('execution_id', NEW.id, 'visit_id', NEW.visit_id, 'plan_item_id', NEW.plan_item_id))
    RETURNING id INTO v_event;
    INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, source_event_id, raised_by)
    SELECT NEW.tenant_id, 'addition_unpaid_finished', r, NEW.branch_id, 'plan_item', NEW.plan_item_id, v_event, NEW.finished_by
      FROM unnest(ARRAY['fo_cashier','manager']) r;
  END IF;
  PERFORM public.kasir_visit_payment(NEW.tenant_id, NEW.visit_id);
  RETURN NULL;
END
$$;--> statement-breakpoint

-- treatment_finish (re-created from 0081): a package session's clinic stop sets no front-office blocker: the session is back (T-076, r3 1).
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
  PERFORM public.audit_append('sign', 'treatment_execution', e.id, 'success', 'treatment_' || v_outcome);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (e.branch_id, 'TreatmentFinished', 'treatment_execution', e.id,
          jsonb_build_object('execution_id', e.id, 'visit_id', e.visit_id, 'plan_item_id', e.plan_item_id, 'outcome', v_outcome,
                             'counted', v_outcome IN ('completed','patient_stop'), 'performer_id', e.performer_staff_id));
END
$$;--> statement-breakpoint

-- The package writer's actor: FO/cashier or a manager at their active branch (or the owner), cashier capability.
CREATE FUNCTION public.package_actor(p_roles text[]) RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not change packages' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the cashier is not available now' USING ERRCODE = '42501';
  END IF;
  IF a.role IN ('manager','fo_cashier','bc','doctor','facility_head') AND a.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: an active branch is needed' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_actor(text[]) FROM PUBLIC;--> statement-breakpoint

-- The package locked, of the actor's tenant (any branch: BILL-16), active and not past its validity.
CREATE FUNCTION public.package_locked(p_tenant uuid, p_package uuid) RETURNS public.packages
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk public.packages;
BEGIN
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = p_tenant AND x.id = p_package FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package not found' USING ERRCODE = 'P0002';
  END IF;
  IF pk.state <> 'active' OR pk.validity_end <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_PACKAGE_EXPIRED: package' USING ERRCODE = 'P0422';
  END IF;
  RETURN pk;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_locked(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Pesan Sesi (UX-13, B-15, BILL-8, CLIN-007, CLIN-028): FO/cashier or a manager reserves an available session of the
-- service on an open visit of the package's patient at the actor's branch (BILL-16: any branch of the tenant), only
-- within the paid value (redeemed + reserved + this ≤ effective paid; ERR_SESSION_NOT_UNLOCKED with the amount still
-- needed). Lock order: staff_access → visit → package → its sessions. p: {service_item_id?}; the first available
-- session of the service (or of the package) by seq. Nothing is touched on a refusal; replay by key in runCommand.
CREATE FUNCTION public.package_reserve(p_key text, p_package uuid, p_visit uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['fo_cashier','manager']);
  v public.visits;
  pk public.packages;
  s public.package_sessions;
  v_service uuid;
  v_need bigint;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'service_item_id' <> '{}'::jsonb
     OR p ? 'service_item_id' AND coalesce(p ->> 'service_item_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reserve' USING ERRCODE = '22023';
  END IF;
  v_service := (p ->> 'service_item_id')::uuid;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit AND x.branch_id = a.branch_id FOR UPDATE;
  IF NOT FOUND OR v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  pk := public.package_locked(a.tenant_id, p_package);
  IF public.patient_canonical(v.tenant_id, v.patient_id) <> public.patient_canonical(pk.tenant_id, pk.patient_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id ORDER BY x.seq FOR UPDATE;
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = pk.tenant_id AND x.package_id = pk.id AND x.state = 'available'
     AND (v_service IS NULL OR x.service_item_id = v_service) ORDER BY x.seq LIMIT 1;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'ERR_SESSION_NOT_UNLOCKED: no_session' USING ERRCODE = 'P0422';
  END IF;
  v_need := public.package_taken(pk) + s.allocated_value - public.package_paid(pk);
  IF v_need > 0 THEN
    RAISE EXCEPTION 'ERR_SESSION_NOT_UNLOCKED: need %', v_need USING ERRCODE = 'P0422';
  END IF;
  UPDATE public.package_sessions SET state = 'reserved', reserved_visit_id = v.id, version = version + 1 WHERE tenant_id = s.tenant_id AND id = s.id;
  PERFORM public.package_sync_vat(pk.tenant_id, pk.id, clock_timestamp());
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (pk.tenant_id, v.branch_id, 'SessionReserved', 'package_session', s.id, a.staff_id, a.role,
          jsonb_build_object('session_id', s.id, 'package_id', pk.id, 'visit_id', v.id));
  PERFORM public.audit_append('settings_change', 'package_session', s.id, 'success', 'session_reserved');
  RETURN jsonb_build_object('session_id', s.id);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_reserve(text, uuid, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_reserve(text, uuid, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Batal Pesan (CLIN-009): a reserved session not bound to an execution returns to available.
CREATE FUNCTION public.package_session_back(s public.package_sessions, p_staff uuid, p_role text, p_branch uuid, p_why text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.package_sessions SET state = 'available', reserved_visit_id = NULL, version = version + 1 WHERE tenant_id = s.tenant_id AND id = s.id;
  PERFORM public.package_sync_vat(s.tenant_id, s.package_id, clock_timestamp());
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (s.tenant_id, p_branch, 'SessionReleased', 'package_session', s.id, p_staff, p_role,
          jsonb_build_object('session_id', s.id, 'package_id', s.package_id, 'reason', p_why));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_session_back(public.package_sessions, uuid, text, uuid, text) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.package_release(p_session uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['fo_cashier','manager']);
  s public.package_sessions;
  v public.visits;
BEGIN
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = a.tenant_id AND x.id = p_session;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = s.reserved_visit_id AND x.branch_id = a.branch_id FOR UPDATE;
  IF s.id IS NULL OR v.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: session not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.packages x WHERE x.tenant_id = s.tenant_id AND x.id = s.package_id FOR UPDATE;
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = a.tenant_id AND x.id = p_session FOR UPDATE;
  IF s.state <> 'reserved' OR s.reserved_visit_id <> v.id THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: session_not_reserved' USING ERRCODE = '55000';
  END IF;
  IF s.reserved_execution_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: session_in_treatment' USING ERRCODE = '55000';
  END IF;
  PERFORM public.package_session_back(s, a.staff_id, a.role, v.branch_id, 'cancelled');
  PERFORM public.audit_append('settings_change', 'package_session', s.id, 'success', 'session_released');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_release(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_release(uuid) TO clinic_app;--> statement-breakpoint

-- The start binds the execution to the covering session (r1 F5): AFTER INSERT on treatment_executions, in
-- treatment_start's transaction (staff_access and the visit held).
CREATE FUNCTION public.package_execution_bind() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s public.package_sessions;
BEGIN
  s := public.package_covering_session(NEW.tenant_id, NEW.visit_id, NEW.plan_item_id);
  IF s.id IS NOT NULL THEN
    UPDATE public.package_sessions SET reserved_execution_id = NEW.id, version = version + 1 WHERE tenant_id = s.tenant_id AND id = s.id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_execution_bind() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER treatment_executions_00_package_bind AFTER INSERT ON public.treatment_executions FOR EACH ROW EXECUTE FUNCTION public.package_execution_bind();--> statement-breakpoint
ALTER TABLE public.treatment_executions ENABLE ALWAYS TRIGGER treatment_executions_00_package_bind;--> statement-breakpoint

-- The finish (B-15, BILL-24, PR-14; r2 F5): named to fire before the additions trigger. A counted outcome redeems the
-- bound session at the executing branch (scenario 11); a medical or clinic stop returns it to available, the execution
-- kept in its returned list (r3 1). Scenario 16: a session of a package invoiced before PKP, redeemed while PKP with
-- the VAT gate open, recognises its delivery VAT.
CREATE FUNCTION public.package_execution_finish() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s public.package_sessions;
  v_split record;
BEGIN
  IF OLD.state = 'finished' OR NEW.state <> 'finished' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = NEW.tenant_id AND x.reserved_execution_id = NEW.id AND x.state = 'reserved' FOR UPDATE;
  IF s.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM 1 FROM public.packages x WHERE x.tenant_id = s.tenant_id AND x.id = s.package_id FOR UPDATE;
  IF NEW.counted THEN
    UPDATE public.package_sessions SET state = 'redeemed', redeemed_at = NEW.finished_at, redeemed_branch_id = NEW.branch_id, version = version + 1
     WHERE tenant_id = s.tenant_id AND id = s.id;
    IF s.tax_category IN ('taxable_service','taxable_goods') AND s.vat_amount = 0 AND public.tax_pkp_at(NEW.tenant_id, NEW.finished_at, NEW.branch_id)
       AND public.feature_gate_open('vat_on_invoices') THEN
      SELECT * INTO v_split FROM public.tax_vat_split(s.allocated_value, s.tax_category, true);
      UPDATE public.package_sessions SET vat_base = v_split.base, vat_amount = v_split.vat, vat_recognised_amount = v_split.vat,
             vat_recognised_at = CASE WHEN v_split.vat > 0 THEN NEW.finished_at END, version = version + 1
       WHERE tenant_id = s.tenant_id AND id = s.id;
    END IF;
    PERFORM public.package_sync_vat(s.tenant_id, s.package_id, NEW.finished_at);
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (s.tenant_id, NEW.branch_id, 'SessionRedeemed', 'package_session', s.id, NEW.finished_by, NEW.finished_as,
            jsonb_build_object('session_id', s.id, 'package_id', s.package_id, 'execution_id', NEW.id, 'visit_id', NEW.visit_id));
  ELSE
    UPDATE public.package_sessions SET state = 'available', reserved_visit_id = NULL, reserved_execution_id = NULL,
           returned_execution_ids = returned_execution_ids || NEW.id, version = version + 1
     WHERE tenant_id = s.tenant_id AND id = s.id;
    PERFORM public.package_sync_vat(s.tenant_id, s.package_id, NEW.finished_at);
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
    VALUES (s.tenant_id, NEW.branch_id, 'SessionReleased', 'package_session', s.id, NEW.finished_by, NEW.finished_as,
            jsonb_build_object('session_id', s.id, 'package_id', s.package_id, 'execution_id', NEW.id, 'reason', NEW.outcome));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_execution_finish() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER treatment_executions_00_package_finish AFTER UPDATE OF state ON public.treatment_executions FOR EACH ROW EXECUTE FUNCTION public.package_execution_finish();--> statement-breakpoint
ALTER TABLE public.treatment_executions ENABLE ALWAYS TRIGGER treatment_executions_00_package_finish;--> statement-breakpoint

-- A visit that closes releases its reserved sessions still unbound (r1 open point 4); visit_close is not re-created.
CREATE FUNCTION public.package_visit_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s public.package_sessions;
BEGIN
  IF OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL THEN
    RETURN NULL;
  END IF;
  FOR s IN SELECT x.* FROM public.package_sessions x WHERE x.tenant_id = NEW.tenant_id AND x.reserved_visit_id = NEW.id AND x.state = 'reserved'
              AND x.reserved_execution_id IS NULL ORDER BY x.package_id, x.seq FOR UPDATE LOOP
    PERFORM public.package_session_back(s, NEW.closed_by, NULL, NEW.branch_id, 'visit_closed');
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_visit_closed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER visits_package_release AFTER UPDATE OF closed_at ON public.visits FOR EACH ROW EXECUTE FUNCTION public.package_visit_closed();--> statement-breakpoint
ALTER TABLE public.visits ENABLE ALWAYS TRIGGER visits_package_release;--> statement-breakpoint

-- Close a package (BILL-10, PR-20, scenario 8; r1 F4, r2 F3/F7): refused while a session is in treatment; open
-- sessions closed (reserved released); a pending port charge cancelled; the line's unpaid remainder cancelled (not a
-- debt); the paid-unused value (effective paid − redeemed) to the balance when > 0 (from_expiry or from_cancel);
-- unpaid substitution lines of unredeemed sessions cancelled, paid ones moved to the balance; the VAT on what was not
-- redeemed reversed (scenario 19). The caller holds staff_access; the package is locked here.
CREATE FUNCTION public.package_close_do(pk public.packages, p_state text, p_reason text, p_staff uuid, p_role text, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
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
    UPDATE public.invoice_lines SET cancelled_amount = greatest(0, sl.line_total - public.kasir_line_paid(sl.tenant_id, sl.id)),
           moved_to_balance = public.kasir_line_paid(sl.tenant_id, sl.id),
           vat_reversed_amount = sl.vat_recognised_amount, vat_reversed_at = CASE WHEN sl.vat_recognised_amount > 0 THEN p_at END
     WHERE tenant_id = sl.tenant_id AND id = sl.id;
    v_sub_paid := v_sub_paid + public.kasir_line_paid(sl.tenant_id, sl.id);
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
REVOKE ALL ON FUNCTION public.package_close_do(public.packages, text, text, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Batalkan Paket (UX-13 secondary action): the owner or a manager (at their active branch; any package of the tenant,
-- BILL-16) with a reason (3–500).
CREATE FUNCTION public.package_cancel(p_package uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['owner','manager']);
  pk public.packages;
  r jsonb;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = a.tenant_id AND x.id = p_package FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package not found' USING ERRCODE = 'P0002';
  END IF;
  IF pk.state <> 'active' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: package_closed' USING ERRCODE = '55000';
  END IF;
  r := public.package_close_do(pk, 'cancelled', btrim(p_reason), a.staff_id, a.role, clock_timestamp());
  PERFORM public.audit_append('money_correction', 'package', pk.id, 'success', 'package_cancelled'); -- the reason stays on the package
  RETURN r;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_cancel(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_cancel(uuid, text) TO clinic_app;--> statement-breakpoint

-- Daily expiry (BILL-10; r1 open point 5, r2 F7): the unbound worker closes each active package past its validity
-- (as of p_today's end in the sold branch's zone), each under its tenant's staff_access lock taken before any row,
-- re-checked under the lock; a package with a session in treatment waits for the next run. Attributed to the
-- package's creator; audited as the package_expiry service. Returns the number closed.
CREATE FUNCTION public.package_expiry_scan(p_today date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
  pk public.packages;
  v_n integer := 0;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the expiry scan runs unbound' USING ERRCODE = '42501';
  END IF;
  FOR c IN SELECT x.tenant_id, x.id FROM public.packages x JOIN public.branches b ON b.tenant_id = x.tenant_id AND b.id = x.sold_branch_id
            WHERE x.state = 'active'
              AND x.validity_end <= coalesce((p_today + 1)::timestamp AT TIME ZONE b.timezone, clock_timestamp())
            ORDER BY x.tenant_id, x.validity_end, x.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || c.tenant_id::text, 0));
    SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = c.tenant_id AND x.id = c.id FOR UPDATE;
    CONTINUE WHEN pk.state <> 'active'
      OR EXISTS (SELECT 1 FROM public.package_sessions s JOIN public.treatment_executions e ON e.tenant_id = s.tenant_id AND e.id = s.reserved_execution_id
                  WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND e.state IN ('started','paused'));
    PERFORM public.package_close_do(pk, 'expired', 'validity_end', pk.created_by, pk.created_as, clock_timestamp());
    PERFORM public.package_audit_service(pk.tenant_id, 'money_correction', 'package', pk.id, 'success', 'package_expired');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_expiry_scan(date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_expiry_scan(date) TO clinic_app;--> statement-breakpoint

-- Pindahkan ke Saldo (BILL-14, BILL-25, scenarios 7a/7b; r1 F1, r2 F2, r3 1): FO/cashier, a manager or the owner at the
-- visit's branch moves the paid value of a finished, not-counted (medical or clinic stop) execution that is not a
-- package session's to the patient balance, once (`from_interrupted_treatment`, source the execution).
--  * an addition: its line's unpaid remainder is cancelled; what was paid in real money moves;
--  * an initial item: its share (line total × plan qty ÷ line quantity) of a fully paid ordinary line of the visit for
--    the same service with room left (paid − moved ≥ share) moves.
-- The line records it (moved_to_balance, shared with refunds) and the VAT recognised on it is reversed in proportion.
-- The clinic-stop blocker is cleared when no other unresolved clinic stop remains.
CREATE FUNCTION public.interrupted_to_balance(p_key text, p_execution uuid) RETURNS jsonb
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
    v_amount := public.kasir_line_paid(l.tenant_id, l.id) - l.moved_to_balance;
    UPDATE public.invoice_lines SET cancelled_amount = greatest(0, l.line_total - public.kasir_line_paid(l.tenant_id, l.id))
     WHERE tenant_id = l.tenant_id AND id = l.id AND cancelled_amount = 0;
  ELSE
    v_service := public.package_plan_service(e.tenant_id, t.id);
    SELECT x.* INTO l FROM public.invoice_lines x JOIN public.invoices i ON i.tenant_id = x.tenant_id AND i.id = x.invoice_id
     WHERE x.tenant_id = e.tenant_id AND i.visit_id = v.id AND i.state = 'issued' AND public.invoice_is_ordinary(i.tenant_id, i.id)
       AND x.item_id = v_service AND public.kasir_line_paid(x.tenant_id, x.id) >= x.line_total
       AND public.kasir_line_paid(x.tenant_id, x.id) - x.moved_to_balance >= (x.line_total * t.qty) / x.quantity
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
REVOKE ALL ON FUNCTION public.interrupted_to_balance(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.interrupted_to_balance(text, uuid) TO clinic_app;--> statement-breakpoint

-- Tukar Sesi (BILL-11, scenario 12; r2 F2/F3): requested on an unlocked session (available, or reserved without a
-- started execution) of an active package by FO/cashier, a manager or a BC at their branch; decided by a doctor or
-- facility head of that branch (≠ requester). The new price is the new service's effective price at the branch now.
CREATE FUNCTION public.package_substitution_request(p_key text, p_session uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['fo_cashier','manager','bc']);
  s public.package_sessions;
  pk public.packages;
  v_new uuid;
  v_price bigint;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'service_item_id' - 'reason' <> '{}'::jsonb OR coalesce(p ->> 'service_item_id', '') !~ '^[0-9a-fA-F-]{36}$'
     OR length(btrim(coalesce(p ->> 'reason', ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: substitution' USING ERRCODE = '22023';
  END IF;
  v_new := (p ->> 'service_item_id')::uuid;
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = a.tenant_id AND x.id = p_session;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: session not found' USING ERRCODE = 'P0002';
  END IF;
  pk := public.package_locked(a.tenant_id, s.package_id);
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = a.tenant_id AND x.id = p_session FOR UPDATE;
  IF s.state NOT IN ('available','reserved') OR s.reserved_execution_id IS NOT NULL
     OR s.state = 'available' AND public.package_taken(pk) + s.allocated_value > public.package_paid(pk) THEN
    RAISE EXCEPTION 'ERR_SESSION_NOT_UNLOCKED: substitution' USING ERRCODE = 'P0422';
  END IF;
  IF EXISTS (SELECT 1 FROM public.package_substitutions u WHERE u.tenant_id = s.tenant_id AND u.session_id = s.id AND u.state = 'pending') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: substitution_pending' USING ERRCODE = '55000';
  END IF;
  IF v_new = s.service_item_id OR NOT EXISTS (SELECT 1 FROM public.catalog_items i WHERE i.tenant_id = a.tenant_id AND i.id = v_new AND i.kind = 'service') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: service' USING ERRCODE = '22023';
  END IF;
  v_price := public.catalog_branch_price(v_new, a.branch_id, clock_timestamp());
  IF v_price IS NULL OR v_price < 1 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: service' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.package_substitutions (tenant_id, branch_id, package_id, session_id, old_service_item_id, new_service_item_id, old_value, new_price,
                                              difference, reason, requested_by, requested_as, command_key)
    VALUES (a.tenant_id, a.branch_id, pk.id, s.id, s.service_item_id, v_new, s.allocated_value, v_price, v_price - s.allocated_value, btrim(p ->> 'reason'),
            a.staff_id, a.role, p_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a substitution with this key exists' USING ERRCODE = '23505';
  END;
  PERFORM public.audit_append('approval', 'package_substitution', v_id, 'success', 'substitution_requested');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_substitution_request(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_substitution_request(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- The decision: approved → the session takes the new service; cheaper → its value becomes the new price, the
-- difference moves to the balance (from_substitution) and leaves the package (moved_to_balance); dearer → the value is
-- kept and the difference is billed (a substitution line through invoice_issue); equal → the service only.
CREATE FUNCTION public.package_substitution_decide(p_substitution uuid, p_approve boolean, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.package_actor(ARRAY['doctor','facility_head']);
  u public.package_substitutions;
  pk public.packages;
  s public.package_sessions;
  sv public.catalog_versions;
  v_split record;
  v_pkp boolean;
BEGIN
  SELECT * INTO u FROM public.package_substitutions x WHERE x.tenant_id = a.tenant_id AND x.id = p_substitution AND x.branch_id = a.branch_id;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: substitution not found' USING ERRCODE = 'P0002';
  END IF;
  IF u.requested_by = a.staff_id THEN
    RAISE EXCEPTION 'ERR_APPROVER_IS_REQUESTER: substitution' USING ERRCODE = 'P0422';
  END IF;
  pk := public.package_locked(a.tenant_id, u.package_id);
  SELECT * INTO u FROM public.package_substitutions x WHERE x.tenant_id = a.tenant_id AND x.id = p_substitution FOR UPDATE;
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = a.tenant_id AND x.id = u.session_id FOR UPDATE;
  IF u.state <> 'pending' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: substitution_decided' USING ERRCODE = '55000';
  END IF;
  IF NOT p_approve THEN
    IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
    END IF;
    UPDATE public.package_substitutions SET state = 'declined', decided_by = a.staff_id, decided_as = a.role, decided_at = clock_timestamp(), decision_reason = btrim(p_reason)
     WHERE tenant_id = u.tenant_id AND id = u.id;
    PERFORM public.audit_append('approval', 'package_substitution', u.id, 'success', 'substitution_declined');
    RETURN jsonb_build_object('state', 'declined');
  END IF;
  IF s.state NOT IN ('available','reserved') OR s.reserved_execution_id IS NOT NULL OR s.service_item_id <> u.old_service_item_id OR s.allocated_value <> u.old_value THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: session_changed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.package_substitutions SET state = 'approved', decided_by = a.staff_id, decided_as = a.role, decided_at = clock_timestamp(), decision_reason = NULLIF(btrim(coalesce(p_reason, '')), '')
   WHERE tenant_id = u.tenant_id AND id = u.id;
  SELECT x.* INTO sv FROM public.catalog_versions x WHERE x.tenant_id = u.tenant_id AND x.item_id = u.new_service_item_id AND x.state = 'active';
  v_pkp := EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id AND i.is_pkp_at_issue);
  IF u.difference < 0 THEN
    SELECT * INTO v_split FROM public.tax_vat_split(u.new_price, sv.tax_category, v_pkp);
    UPDATE public.package_sessions SET service_item_id = u.new_service_item_id, allocated_value = u.new_price, tax_category = sv.tax_category, tax_basis = sv.tax_basis,
           vat_base = v_split.base, vat_amount = v_split.vat, vat_recognised_amount = least(vat_recognised_amount, v_split.vat),
           vat_recognised_at = CASE WHEN least(vat_recognised_amount, v_split.vat) > 0 THEN vat_recognised_at END, version = version + 1
     WHERE tenant_id = s.tenant_id AND id = s.id;
    UPDATE public.packages SET moved_to_balance = moved_to_balance - u.difference WHERE tenant_id = pk.tenant_id AND id = pk.id;
    PERFORM public.balance_post(pk.tenant_id, pk.patient_id, a.branch_id, 'from_substitution', -u.difference,
                                jsonb_build_object('source_kind', 'package_substitution', 'source_id', u.id), 'substitution:' || u.id::text, a.staff_id, a.role);
    PERFORM public.package_sync_vat(pk.tenant_id, pk.id, clock_timestamp());
  ELSE
    UPDATE public.package_sessions SET service_item_id = u.new_service_item_id, tax_category = sv.tax_category, tax_basis = sv.tax_basis, version = version + 1
     WHERE tenant_id = s.tenant_id AND id = s.id;
  END IF;
  PERFORM public.audit_append('approval', 'package_substitution', u.id, 'success', 'substitution_approved');
  RETURN jsonb_build_object('state', 'approved', 'difference', u.difference);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_substitution_decide(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_substitution_decide(uuid, boolean, text) TO clinic_app;--> statement-breakpoint

-- Isi Saldo (UX-13 Top Up Saldo; r1 open point 2, r2 F6): FO/cashier, a manager, the owner or finance receives cash,
-- EDC or transfer (SET-14) for a patient's balance: a KW receipt, a payment with no invoice, its allocation to the
-- top-up, then the `top_up` balance entry. Not turnover; no VAT until used (A-12). p: {method, amount, cash_tendered?,
-- details?}. Branch: the actor's (manager/FO) or p_branch (owner/finance).
CREATE FUNCTION public.balance_top_up(p_key text, p_patient uuid, p_branch uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_actor();
  -- The branch: a branch role's own; else the named one, the active one, or the tenant's first by name (r-impl F1).
  v_branch uuid := coalesce(a.branch_id, p_branch, NULLIF(current_setting('app.active_branch_id', true), '')::uuid,
                            (SELECT x.id FROM public.branches x WHERE x.tenant_id = a.tenant_id ORDER BY x.name, x.id LIMIT 1));
  v_patient uuid;
  v_at timestamptz := clock_timestamp();
  v_amount bigint;
  v_number text;
  v_receipt uuid;
  v_pay uuid;
  v_id uuid;
  b public.branches;
  v_body text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'method' - 'amount' - 'cash_tendered' - 'details' <> '{}'::jsonb
     OR coalesce(p ->> 'method', '') NOT IN ('cash','edc','transfer') OR jsonb_typeof(p -> 'amount') IS DISTINCT FROM 'number' OR (p ->> 'amount') !~ '^[1-9]\d{0,12}$'
     OR (p ->> 'method' = 'cash') <> (p ? 'cash_tendered')
     OR p ? 'cash_tendered' AND (jsonb_typeof(p -> 'cash_tendered') IS DISTINCT FROM 'number' OR (p ->> 'cash_tendered') !~ '^[1-9]\d{0,12}$'
                                   OR (p ->> 'cash_tendered')::bigint < (p ->> 'amount')::bigint)
     OR p ? 'details' AND (p ->> 'method' NOT IN ('edc','transfer') OR jsonb_typeof(p -> 'details') IS DISTINCT FROM 'object'
                           OR (p -> 'details') - 'card_type' - 'bank' - 'trace' - 'approval_code' - 'reference' <> '{}'::jsonb
                           OR EXISTS (SELECT 1 FROM jsonb_each(p -> 'details') d WHERE jsonb_typeof(d.value) <> 'string' OR length(d.value #>> '{}') NOT BETWEEN 1 AND 60)) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: top_up' USING ERRCODE = '22023';
  END IF;
  IF NOT public.kasir_method_enabled(p ->> 'method', v_at) THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: method_disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.branches x WHERE x.tenant_id = a.tenant_id AND x.id = v_branch;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT public.patient_canonical(x.tenant_id, x.id) INTO v_patient FROM public.patients x WHERE x.tenant_id = a.tenant_id AND x.id = p_patient;
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  v_amount := (p ->> 'amount')::bigint;
  v_number := public.kasir_next_number(a.tenant_id, b.id, 'KW');
  v_body := (SELECT t.legal_name FROM public.tenants t WHERE t.id = a.tenant_id) || E'\n' || b.name || coalesce(' · ' || b.address, '') || E'\n\nStruk ' || v_number
            || E'\n' || to_char((v_at AT TIME ZONE b.timezone), 'DD-MM-YYYY HH24:MI')
            || E'\n\nIsi Saldo pasien ' || (SELECT pt.mrn FROM public.patients pt WHERE pt.tenant_id = a.tenant_id AND pt.id = v_patient)
            || E'\n\nTotal dibayar Rp' || replace(to_char(v_amount, 'FM999G999G999G999'), ',', '.')
            || E'\n' || CASE p ->> 'method' WHEN 'cash' THEN 'Tunai' WHEN 'edc' THEN 'EDC' ELSE 'Transfer' END || ' Rp' || replace(to_char(v_amount, 'FM999G999G999G999'), ',', '.');
  BEGIN
    INSERT INTO public.receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, is_simulated, command_key, issued_by, issued_as, issued_at)
    VALUES (a.tenant_id, b.id, NULL, v_number, v_amount, v_body, '80mm', false, p_key, a.staff_id, a.role, v_at)
    RETURNING id INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a receipt with this key exists' USING ERRCODE = '23505';
  END;
  INSERT INTO public.balance_top_ups (tenant_id, branch_id, patient_id, receipt_id, amount, command_key, received_by, received_as, received_at)
  VALUES (a.tenant_id, b.id, v_patient, v_receipt, v_amount, p_key, a.staff_id, a.role, v_at)
  RETURNING id INTO v_id;
  INSERT INTO public.payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                               environment, is_simulated, received_by, received_as, received_at)
  VALUES (a.tenant_id, b.id, v_receipt, 1, NULL, v_patient, p ->> 'method', v_amount, (p ->> 'cash_tendered')::bigint,
          CASE WHEN p ? 'cash_tendered' THEN (p ->> 'cash_tendered')::bigint - v_amount END, p -> 'details', 'production', false, a.staff_id, a.role, v_at)
  RETURNING id INTO v_pay;
  INSERT INTO public.payment_allocations (tenant_id, branch_id, payment_id, top_up_id, amount, vat_portion, method, environment, is_simulated)
  VALUES (a.tenant_id, b.id, v_pay, v_id, v_amount, 0, p ->> 'method', 'production', false);
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (a.tenant_id, b.id, 'PaymentReceived', 'payment', v_pay, a.staff_id, a.role, jsonb_build_object('payment_id', v_pay, 'top_up_id', v_id));
  PERFORM public.balance_post(a.tenant_id, v_patient, b.id, 'top_up', v_amount, jsonb_build_object('source_kind', 'balance_top_up', 'source_id', v_id),
                              'top_up:' || v_id::text, a.staff_id, a.role);
  PERFORM public.audit_append('money_correction', 'receipt', v_receipt, 'success', 'balance_topped_up');
  RETURN jsonb_build_object('receipt_id', v_receipt, 'number', v_number, 'top_up_id', v_id, 'change',
                            CASE WHEN p ? 'cash_tendered' THEN (p ->> 'cash_tendered')::bigint - v_amount ELSE 0 END);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.balance_top_up(text, uuid, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.balance_top_up(text, uuid, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Isi Paket (spec 19 §2.8, r1 open point 1): the owner or admin pusat replaces the contents of an unsold package
-- version (the guard refuses a sold one). p: {rows: [{service_item_id, count}] 1–20}, in order.
CREATE FUNCTION public.package_contents_set(p_version uuid, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  r jsonb;
  k integer := 0;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not edit package contents' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'rows' <> '{}'::jsonb OR jsonb_typeof(p -> 'rows') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p -> 'rows') NOT BETWEEN 1 AND 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'rows') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'service_item_id' - 'count' <> '{}'::jsonb
                  OR coalesce(x ->> 'service_item_id', '') !~ '^[0-9a-fA-F-]{36}$' OR jsonb_typeof(x -> 'count') IS DISTINCT FROM 'number' OR (x ->> 'count') !~ '^\d{1,2}$'
                  OR (x ->> 'count')::integer NOT BETWEEN 1 AND 50) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: contents' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_versions v JOIN public.catalog_items i ON i.tenant_id = v.tenant_id AND i.id = v.item_id
                  WHERE v.tenant_id = a.tenant_id AND v.id = p_version AND i.kind = 'package') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package version not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catalog_versions v WHERE v.tenant_id = a.tenant_id AND v.id = p_version AND v.referenced_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: package_sold' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'rows') x LEFT JOIN public.catalog_items i ON i.tenant_id = a.tenant_id AND i.id::text = x ->> 'service_item_id'
              WHERE i.kind IS DISTINCT FROM 'service')
     OR (SELECT count(DISTINCT x ->> 'service_item_id') FROM jsonb_array_elements(p -> 'rows') x) <> jsonb_array_length(p -> 'rows') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: contents' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.package_contents WHERE tenant_id = a.tenant_id AND package_version_id = p_version;
  FOR r IN SELECT x FROM jsonb_array_elements(p -> 'rows') x LOOP
    k := k + 1;
    INSERT INTO public.package_contents (tenant_id, package_version_id, seq, service_item_id, count)
    VALUES (a.tenant_id, p_version, k, (r ->> 'service_item_id')::uuid, (r ->> 'count')::integer);
  END LOOP;
  PERFORM public.audit_append('settings_change', 'catalog_version', p_version, 'success', 'package_contents_set');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_contents_set(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_contents_set(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- The package rows of a patient for Paket & Saldo (UX-13): paid, Terpakai (redeemed), Dipesan (reserved), available
-- (unlocked), the amount still needed for the next session, validity, the sold branch; its sessions with their
-- service, value, state, the visit and branch; pending substitutions. No clinical content.
CREATE FUNCTION public.package_row(pk public.packages) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', pk.id, 'name', cv.name, 'price', pk.price, 'paid', public.package_paid(pk), 'min_dp', pk.min_dp,
    'state', pk.state, 'validity_end', pk.validity_end, 'invoice_id', pk.invoice_id, 'invoice_number', i.number,
    'outstanding', public.kasir_outstanding(pk.tenant_id, pk.invoice_id),
    'sold_branch', jsonb_build_object('id', b.id, 'name', b.name),
    'redeemed', (SELECT count(*) FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'redeemed'),
    'reserved', (SELECT count(*) FROM public.package_sessions s WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'reserved'),
    'unlocked_value', greatest(0, public.package_paid(pk) - public.package_taken(pk)),
    'next_need', (SELECT greatest(0, public.package_taken(pk) + s.allocated_value - public.package_paid(pk)) FROM public.package_sessions s
                   WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id AND s.state = 'available' ORDER BY s.seq LIMIT 1),
    'paid_unused_moved', pk.paid_unused_moved, 'remainder_cancelled', pk.remainder_cancelled,
    'sessions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'service_item_id', s.service_item_id, 'service', sv.name,
                          'value', s.allocated_value, 'state', s.state, 'visit_id', s.reserved_visit_id, 'redeemed_at', s.redeemed_at,
                          'redeemed_branch', (SELECT bb.name FROM public.branches bb WHERE bb.tenant_id = s.tenant_id AND bb.id = s.redeemed_branch_id),
                          'pending_substitution', EXISTS (SELECT 1 FROM public.package_substitutions u WHERE u.tenant_id = s.tenant_id AND u.session_id = s.id AND u.state = 'pending'))
                          ORDER BY s.seq)
                          FROM public.package_sessions s
                          LEFT JOIN public.catalog_versions sv ON sv.tenant_id = s.tenant_id AND sv.item_id = s.service_item_id AND sv.state = 'active'
                         WHERE s.tenant_id = pk.tenant_id AND s.package_id = pk.id), '[]'::jsonb))
    FROM public.catalog_versions cv, public.invoices i, public.branches b
   WHERE cv.tenant_id = pk.tenant_id AND cv.id = pk.catalog_version_id AND i.tenant_id = pk.tenant_id AND i.id = pk.invoice_id
     AND b.tenant_id = pk.tenant_id AND b.id = pk.sold_branch_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_row(public.packages) FROM PUBLIC;--> statement-breakpoint

-- Paket & Saldo of a patient (UX-13): the canonical patient (masked for the auditor), packages (active first), the
-- balance (T-075's reader), the patient's open visits at the reader's branch (for Pesan Sesi), and whether the role
-- may act. Readers: owner, finance, auditor tenant-wide; manager and FO/cashier at their active branch.
CREATE FUNCTION public.package_patient_get(p_patient uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  v_patient uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.patients x WHERE x.tenant_id = a.tenant_id AND x.id = p_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  v_patient := public.patient_canonical(a.tenant_id, p_patient);
  RETURN jsonb_build_object('patient', public.kasir_patient_json(a.tenant_id, v_patient, a.role = 'auditor'), 'role', a.role,
    'can_reserve', a.role IN ('fo_cashier','manager'), 'can_cancel', a.role IN ('owner','manager'), 'can_top_up', a.role IN ('owner','manager','fo_cashier','finance'),
    'balance', public.balance_of(a.tenant_id, v_patient),
    'packages', coalesce((SELECT jsonb_agg(public.package_row(pk) ORDER BY (pk.state = 'active') DESC, pk.created_at DESC)
                            FROM public.packages pk WHERE pk.tenant_id = a.tenant_id AND pk.patient_id = ANY (public.patient_cluster(a.tenant_id, v_patient))), '[]'::jsonb),
    'visits', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'checked_in_at', v.checked_in_at) ORDER BY v.checked_in_at DESC)
                          FROM public.visits v WHERE v.tenant_id = a.tenant_id AND v.closed_at IS NULL AND v.branch_id = a.branch_id
                           AND v.patient_id = ANY (public.patient_cluster(a.tenant_id, v_patient))), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_patient_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_patient_get(uuid) TO clinic_app;--> statement-breakpoint

-- Patient search for Paket & Saldo (the Kasir readers): name or MRN, at most 20; masked for the auditor.
CREATE FUNCTION public.package_patient_search(p_query text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  q text := btrim(coalesce(p_query, ''));
BEGIN
  IF length(q) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((SELECT jsonb_agg(x.j) FROM (
      SELECT public.kasir_patient_json(p.tenant_id, p.id, a.role = 'auditor') || jsonb_build_object('balance', public.balance_of(p.tenant_id, p.id),
               'active_packages', (SELECT count(*) FROM public.packages pk WHERE pk.tenant_id = p.tenant_id AND pk.patient_id = ANY (public.patient_cluster(p.tenant_id, p.id)) AND pk.state = 'active')) j
        FROM public.patients p
       WHERE p.tenant_id = a.tenant_id AND NOT public.patient_is_merged(p.tenant_id, p.id)
         AND (p.mrn ILIKE q || '%' OR a.role <> 'auditor' AND p.full_name ILIKE '%' || q || '%')
       ORDER BY p.full_name, p.id LIMIT 20) x), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_patient_search(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_patient_search(text) TO clinic_app;--> statement-breakpoint

-- The contents of a package version (Isi Paket): owner and admin pusat (and the Kasir readers, to see what a package
-- holds).
CREATE FUNCTION public.package_contents_get(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','finance','auditor','manager','fo_cashier') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read package contents' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_versions v JOIN public.catalog_items i ON i.tenant_id = v.tenant_id AND i.id = v.item_id
                  WHERE v.tenant_id = a.tenant_id AND v.id = p_version AND i.kind = 'package') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: package version not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('version_id', p_version, 'sold', EXISTS (SELECT 1 FROM public.catalog_versions v WHERE v.tenant_id = a.tenant_id AND v.id = p_version AND v.referenced_at IS NOT NULL),
    'can_edit', a.role IN ('owner','admin_pusat'),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('seq', c.seq, 'service_item_id', c.service_item_id, 'service', sv.name, 'count', c.count) ORDER BY c.seq)
                        FROM public.package_contents c
                        LEFT JOIN public.catalog_versions sv ON sv.tenant_id = c.tenant_id AND sv.item_id = c.service_item_id AND sv.state = 'active'
                       WHERE c.tenant_id = a.tenant_id AND c.package_version_id = p_version), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_contents_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_contents_get(uuid) TO clinic_app;
