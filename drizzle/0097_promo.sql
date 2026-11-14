CREATE TABLE "promo_code_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"promo_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"discount_kind" text NOT NULL,
	"discount_value" bigint NOT NULL,
	"max_discount" bigint,
	"item_ids" uuid[] NOT NULL,
	"branch_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"per_patient_limit" smallint,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "promo_code_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "promo_code_versions_version_key" UNIQUE("tenant_id","promo_id","version"),
	CONSTRAINT "promo_code_versions_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "promo_code_versions_check" CHECK ("promo_code_versions"."version" between 1 and 1000 and "promo_code_versions"."valid_from" <= "promo_code_versions"."valid_to"
      and "promo_code_versions"."discount_kind" in ('percent','rupiah')
      and ("promo_code_versions"."discount_kind" = 'percent' and "promo_code_versions"."discount_value" between 1 and 100 or "promo_code_versions"."discount_kind" = 'rupiah' and "promo_code_versions"."discount_value" between 1 and 1000000000000)
      and ("promo_code_versions"."max_discount" is null or "promo_code_versions"."max_discount" between 1 and 1000000000000)
      and cardinality("promo_code_versions"."item_ids") between 1 and 200 and cardinality("promo_code_versions"."branch_ids") <= 50
      and ("promo_code_versions"."per_patient_limit" is null or "promo_code_versions"."per_patient_limit" between 1 and 1000)
      and "promo_code_versions"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "promo_code_versions"."created_as" in ('owner','admin_pusat','marketing'))
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"quota" integer NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"command_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "promo_codes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "promo_codes_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "promo_codes_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "promo_codes_check" CHECK ("promo_codes"."code" ~ '^[A-Z0-9-]{3,32}$' and "promo_codes"."quota" between 1 and 1000000 and "promo_codes"."used" between 0 and "promo_codes"."quota"
      and "promo_codes"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "promo_codes"."created_as" in ('owner','admin_pusat','marketing'))
);
--> statement-breakpoint
CREATE TABLE "promo_usages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"promo_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"patient_id" uuid,
	"discount" bigint NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"consumed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_code" text,
	CONSTRAINT "promo_usages_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "promo_usages_line_key" UNIQUE("tenant_id","invoice_line_id"),
	CONSTRAINT "promo_usages_check" CHECK ("promo_usages"."discount" between 1 and 1000000000000 and "promo_usages"."state" in ('reserved','consumed','released')
      and ("promo_usages"."state" <> 'reserved' or "promo_usages"."consumed_at" is null and "promo_usages"."released_at" is null)
      and ("promo_usages"."state" <> 'consumed' or "promo_usages"."consumed_at" is not null and "promo_usages"."released_at" is null)
      and (("promo_usages"."state" = 'released') = ("promo_usages"."released_at" is not null)) and (("promo_usages"."state" = 'released') = ("promo_usages"."release_code" is not null))
      and ("promo_usages"."release_code" is null or "promo_usages"."release_code" in ('void','removed','refunded_full'))
      and ("promo_usages"."release_code" is distinct from 'refunded_full' or "promo_usages"."consumed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_discount_check";--> statement-breakpoint
ALTER TABLE "promo_code_versions" ADD CONSTRAINT "promo_code_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_versions" ADD CONSTRAINT "promo_code_versions_promo_fk" FOREIGN KEY ("tenant_id","promo_id") REFERENCES "public"."promo_codes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_versions" ADD CONSTRAINT "promo_code_versions_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_promo_fk" FOREIGN KEY ("tenant_id","promo_id") REFERENCES "public"."promo_codes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."promo_code_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promo_usages_promo_patient_idx" ON "promo_usages" USING btree ("tenant_id","promo_id","patient_id");--> statement-breakpoint
CREATE INDEX "promo_usages_invoice_idx" ON "promo_usages" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_discount_check" CHECK (("invoice_lines"."discount_kind" is null or "invoice_lines"."discount_kind" in ('manual','promo'))
      and (("invoice_lines"."discount_kind" is null) = ("invoice_lines"."discount" = 0 and "invoice_lines"."discount_approval_id" is null))
      and ("invoice_lines"."discount_kind" is distinct from 'promo' or "invoice_lines"."discount_approval_id" is null));--> statement-breakpoint

-- T-081 rules (generated by gen.py; plan docs/tasks/T-081.md)
-- ── T-081 helpers (plan §4, review r1) ──
-- Promo codes and versions are readable tenant-wide by the code managers and the cashier roles (they hold no patient data);
-- usages follow the Kasir readers (kasir_readable).
CREATE FUNCTION public.promo_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant)
    AND public.app_role_in(ARRAY['owner','admin_pusat','marketing','finance','auditor','manager','fo_cashier']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.promo_readable(uuid) TO clinic_app;--> statement-breakpoint

-- The branch-local date of an instant (the period is in branch dates).
CREATE FUNCTION public.promo_branch_date(p_tenant uuid, p_branch uuid, p_at timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (p_at AT TIME ZONE b.timezone)::date FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = p_branch
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_branch_date(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- The discount of a version on a gross (integer rupiah): percent → floor(gross × value / 100) capped by max_discount;
-- rupiah → least(value, gross). The caller refuses a result < 1, and ≥ gross on a package line.
CREATE FUNCTION public.promo_discount(v public.promo_code_versions, p_gross bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT least(CASE WHEN v.discount_kind = 'percent' THEN (p_gross * v.discount_value) / 100 ELSE least(v.discount_value, p_gross) END,
               coalesce(v.max_discount, p_gross))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_discount(public.promo_code_versions, bigint) FROM PUBLIC;--> statement-breakpoint

-- A code resolved for a line (r1 P1-4 A): the latest version, refused in order not_found, inactive, outside_period, branch,
-- item, then (a precondition only) the patient limit on a counter sale without a patient. **Not** the quota: on the write
-- path the only exhausted check is promo_take's conditional UPDATE. Returns the version.
CREATE FUNCTION public.promo_resolve(p_tenant uuid, p_code text, p_item uuid, p_branch uuid, p_patient uuid, p_at timestamptz) RETURNS public.promo_code_versions
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.promo_codes;
  v public.promo_code_versions;
  v_day date := public.promo_branch_date(p_tenant, p_branch, p_at);
BEGIN
  SELECT * INTO c FROM public.promo_codes x WHERE x.tenant_id = p_tenant AND x.code = upper(btrim(coalesce(p_code, '')));
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: promo' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v FROM public.promo_code_versions x WHERE x.tenant_id = c.tenant_id AND x.promo_id = c.id ORDER BY x.version DESC LIMIT 1;
  IF NOT c.active THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: promo_inactive' USING ERRCODE = '55000';
  END IF;
  IF v_day NOT BETWEEN v.valid_from AND v.valid_to THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: promo_outside_period' USING ERRCODE = '55000';
  END IF;
  IF cardinality(v.branch_ids) > 0 AND NOT p_branch = ANY (v.branch_ids) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: promo_branch' USING ERRCODE = '55000';
  END IF;
  IF NOT p_item = ANY (v.item_ids) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: promo_item' USING ERRCODE = '55000';
  END IF;
  IF v.per_patient_limit IS NOT NULL AND p_patient IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: promo_patient_limit' USING ERRCODE = '55000';
  END IF;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_resolve(uuid, text, uuid, uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- The atomic quota (Done-when): one conditional UPDATE. Under READ COMMITTED a second transaction on the same row waits for the
-- first and re-checks `used < quota` on the committed row, so of two cashiers taking the last use exactly one gets a row.
CREATE FUNCTION public.promo_take(p_tenant uuid, p_promo uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- (active is checked by promo_resolve under the same staff_access as promo_code_set; mutation review r1: redundant here)
  UPDATE public.promo_codes SET used = used + 1 WHERE tenant_id = p_tenant AND id = p_promo AND used < quota;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: promo_exhausted' USING ERRCODE = '55000';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_take(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Reserved → consumed when the line is settled (r1 P1-3): paid, or its remainder converted to a receivable.
CREATE FUNCTION public.promo_usage_sync(p_tenant uuid, p_line uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  UPDATE public.promo_usages u SET state = 'consumed', consumed_at = clock_timestamp()
    FROM public.invoice_lines l
   WHERE u.tenant_id = p_tenant AND u.invoice_line_id = p_line AND u.state = 'reserved'
     AND l.tenant_id = u.tenant_id AND l.id = u.invoice_line_id AND l.line_total - l.cancelled_amount > 0
     AND public.kasir_line_paid(l.tenant_id, l.id) + l.receivable_amount >= l.line_total - l.cancelled_amount
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_usage_sync(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- A release (BILL-36): the line's usage moves to released with its code and the code's counter drops by one, under the code row.
-- p_from: the state it must be in (reserved for void/removed, consumed for refunded_full); anything else is a no-op (idempotent).
CREATE FUNCTION public.promo_release(p_tenant uuid, p_line uuid, p_from text, p_code text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  u public.promo_usages;
BEGIN
  SELECT * INTO u FROM public.promo_usages x WHERE x.tenant_id = p_tenant AND x.invoice_line_id = p_line AND x.state = p_from;
  IF u.id IS NULL THEN
    RETURN;
  END IF;
  PERFORM 1 FROM public.promo_codes c WHERE c.tenant_id = u.tenant_id AND c.id = u.promo_id FOR UPDATE;
  UPDATE public.promo_usages SET state = 'released', released_at = clock_timestamp(), release_code = p_code
   WHERE tenant_id = u.tenant_id AND id = u.id AND state = p_from;
  IF FOUND THEN
    UPDATE public.promo_codes SET used = used - 1 WHERE tenant_id = u.tenant_id AND id = u.promo_id;
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_release(uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY promo_codes_read ON public.promo_codes FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.promo_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.promo_codes TO clinic_app;--> statement-breakpoint
CREATE POLICY promo_codes_operator_read ON public.promo_codes FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.promo_codes', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.promo_codes TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER promo_codes_no_truncate BEFORE TRUNCATE ON public.promo_codes FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.promo_codes ENABLE ALWAYS TRIGGER promo_codes_no_truncate;--> statement-breakpoint
ALTER TABLE public.promo_code_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY promo_code_versions_read ON public.promo_code_versions FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.promo_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.promo_code_versions TO clinic_app;--> statement-breakpoint
CREATE POLICY promo_code_versions_operator_read ON public.promo_code_versions FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.promo_code_versions', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.promo_code_versions TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER promo_code_versions_no_truncate BEFORE TRUNCATE ON public.promo_code_versions FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.promo_code_versions ENABLE ALWAYS TRIGGER promo_code_versions_no_truncate;--> statement-breakpoint
ALTER TABLE public.promo_usages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY promo_usages_read ON public.promo_usages FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.kasir_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.promo_usages TO clinic_app;--> statement-breakpoint
CREATE POLICY promo_usages_operator_read ON public.promo_usages FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.promo_usages', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.promo_usages TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER promo_usages_no_truncate BEFORE TRUNCATE ON public.promo_usages FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.promo_usages ENABLE ALWAYS TRIGGER promo_usages_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.promo_codes', 'tenant-ledger', 'cashier', '{owner,admin_pusat,marketing,finance,auditor,manager,fo_cashier}', 'promo definers (src/modules/promo)', 'tenant-wide (a code serves every eligible branch)'),
  ('public.promo_code_versions', 'tenant-ledger', 'cashier', '{owner,admin_pusat,marketing,finance,auditor,manager,fo_cashier}', 'promo definers (src/modules/promo)', 'tenant-wide (eligible branches listed in the version)'),
  ('public.promo_usages', 'tenant-ledger', 'cashier', '{owner,finance,auditor,manager,fo_cashier}', 'promo definers (src/modules/promo)', 'the invoice''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-19): codes and versions are money totals; usages are personal (patient, invoice).
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.promo_codes', 'money_total'),
  ('public.promo_code_versions', 'money_total'),
  ('public.promo_usages', 'personal');--> statement-breakpoint

-- ── T-081 guards (staff_access first; never deleted) ──
-- Codes: identity, code and key frozen; `used` moves only by one per statement (a take or a release) within 0..quota (CHECK);
-- quota and active change through the management writers.
CREATE FUNCTION public.promo_codes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'promo codes are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.used <> 0 OR NOT NEW.active THEN
      RAISE EXCEPTION 'a promo code opens active and unused' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.code, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.code, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at)
     OR abs(NEW.used - OLD.used) > 1 THEN
    RAISE EXCEPTION 'a promo code keeps its identity; its use moves one at a time' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_codes_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER promo_codes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.promo_codes FOR EACH ROW EXECUTE FUNCTION public.promo_codes_guard();--> statement-breakpoint
ALTER TABLE public.promo_codes ENABLE ALWAYS TRIGGER promo_codes_guard;--> statement-breakpoint

-- Versions are immutable (BILL-36: an edit inserts version + 1); a new version is the next number of its code.
CREATE FUNCTION public.promo_code_versions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'a promo code version is immutable; an edit is a new version' USING ERRCODE = '42501';
  END IF;
  IF NEW.version <> 1 + coalesce((SELECT max(x.version) FROM public.promo_code_versions x WHERE x.tenant_id = NEW.tenant_id AND x.promo_id = NEW.promo_id), 0) THEN
    RAISE EXCEPTION 'a promo code version is the next number' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_code_versions_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER promo_code_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.promo_code_versions FOR EACH ROW EXECUTE FUNCTION public.promo_code_versions_guard();--> statement-breakpoint
ALTER TABLE public.promo_code_versions ENABLE ALWAYS TRIGGER promo_code_versions_guard;--> statement-breakpoint

-- Usages: inserted reserved for a promo line of a draft invoice (its discount and version); identity frozen; reserved →
-- consumed or released (void, removed); consumed → released only on a full refund.
CREATE FUNCTION public.promo_usages_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'promo usages are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'reserved' OR NOT EXISTS (
         SELECT 1 FROM public.invoice_lines l JOIN public.promo_code_versions v ON v.tenant_id = l.tenant_id AND v.id = NEW.version_id
          WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.invoice_line_id AND l.invoice_id = NEW.invoice_id AND l.branch_id = NEW.branch_id
            AND l.discount_kind = 'promo' AND l.discount = NEW.discount AND v.promo_id = NEW.promo_id) THEN
      RAISE EXCEPTION 'a promo usage opens reserved on its promo line' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.promo_id, NEW.version_id, NEW.invoice_id, NEW.invoice_line_id, NEW.patient_id, NEW.discount, NEW.reserved_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.promo_id, OLD.version_id, OLD.invoice_id, OLD.invoice_line_id, OLD.patient_id, OLD.discount, OLD.reserved_at)
     OR NOT (NEW.state = OLD.state AND (NEW.consumed_at, NEW.released_at, NEW.release_code) IS NOT DISTINCT FROM (OLD.consumed_at, OLD.released_at, OLD.release_code)
             OR OLD.state = 'reserved' AND NEW.state = 'consumed'
             OR OLD.state = 'reserved' AND NEW.state = 'released' AND NEW.release_code IN ('void','removed')
             OR OLD.state = 'consumed' AND NEW.state = 'released' AND NEW.release_code = 'refunded_full' AND NEW.consumed_at = OLD.consumed_at) THEN
    RAISE EXCEPTION 'a promo usage moves reserved → consumed → released (full refund) or reserved → released (void, removal)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_usages_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER promo_usages_guard BEFORE INSERT OR UPDATE OR DELETE ON public.promo_usages FOR EACH ROW EXECUTE FUNCTION public.promo_usages_guard();--> statement-breakpoint
ALTER TABLE public.promo_usages ENABLE ALWAYS TRIGGER promo_usages_guard;--> statement-breakpoint

-- ── T-081 code management (owner, Admin Pusat, Marketing; 07:64; capability configuration, r1 P2-5) ──
CREATE FUNCTION public.promo_actor() RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','marketing') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not manage promo codes' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_actor() FROM PUBLIC;--> statement-breakpoint

-- The terms of a version from input: {valid_from, valid_to, discount_kind, discount_value, max_discount?, item_ids, branch_ids?,
-- per_patient_limit?}; items must be active catalog items of the tenant (not materials), branches the tenant's.
CREATE FUNCTION public.promo_version_insert(p_tenant uuid, p_promo uuid, p_key text, p jsonb, p_staff uuid, p_role text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
  v_items uuid[];
  v_branches uuid[];
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'valid_from' - 'valid_to' - 'discount_kind' - 'discount_value' - 'max_discount' - 'item_ids' - 'branch_ids' - 'per_patient_limit' <> '{}'::jsonb
     OR coalesce(p ->> 'valid_from', '') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p ->> 'valid_to', '') !~ '^\d{4}-\d{2}-\d{2}$'
     OR coalesce(p ->> 'discount_kind', '') NOT IN ('percent','rupiah')
     OR jsonb_typeof(p -> 'discount_value') IS DISTINCT FROM 'number' OR (p ->> 'discount_value') !~ '^\d{1,13}$'
     OR p ? 'max_discount' AND jsonb_typeof(p -> 'max_discount') <> 'null' AND (jsonb_typeof(p -> 'max_discount') <> 'number' OR (p ->> 'max_discount') !~ '^\d{1,13}$')
     OR p ? 'per_patient_limit' AND jsonb_typeof(p -> 'per_patient_limit') <> 'null' AND (jsonb_typeof(p -> 'per_patient_limit') <> 'number' OR (p ->> 'per_patient_limit') !~ '^\d{1,4}$')
     OR jsonb_typeof(p -> 'item_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'item_ids') NOT BETWEEN 1 AND 200
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p -> 'item_ids') x WHERE x !~ '^[0-9a-fA-F-]{36}$')
     OR p ? 'branch_ids' AND (jsonb_typeof(p -> 'branch_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'branch_ids') > 50
                              OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p -> 'branch_ids') x WHERE x !~ '^[0-9a-fA-F-]{36}$')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: promo_terms' USING ERRCODE = '22023';
  END IF;
  v_items := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(p -> 'item_ids') x);
  v_branches := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p -> 'branch_ids', '[]'::jsonb)) x);
  IF EXISTS (SELECT 1 FROM unnest(v_items) x WHERE NOT EXISTS (SELECT 1 FROM public.catalog_items ci WHERE ci.tenant_id = p_tenant AND ci.id = x AND ci.kind <> 'material'))
     OR EXISTS (SELECT 1 FROM unnest(v_branches) x WHERE NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = x)) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: promo item or branch' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    INSERT INTO public.promo_code_versions (tenant_id, promo_id, version, valid_from, valid_to, discount_kind, discount_value, max_discount, item_ids, branch_ids,
                                            per_patient_limit, command_key, created_by, created_as)
    VALUES (p_tenant, p_promo, 1 + coalesce((SELECT max(x.version) FROM public.promo_code_versions x WHERE x.tenant_id = p_tenant AND x.promo_id = p_promo), 0),
            (p ->> 'valid_from')::date, (p ->> 'valid_to')::date, p ->> 'discount_kind', (p ->> 'discount_value')::bigint,
            NULLIF(p ->> 'max_discount', '')::bigint, v_items, v_branches, NULLIF(p ->> 'per_patient_limit', '')::smallint, p_key, p_staff, p_role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: promo_terms' USING ERRCODE = '22023';
  END;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_version_insert(uuid, uuid, text, jsonb, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Buat Kode Promo: p: {code, quota, terms: {…}}. Replay by key returns the code.
CREATE FUNCTION public.promo_code_create(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.promo_actor();
  v_id uuid;
  v_code text := upper(btrim(coalesce(p ->> 'code', '')));
BEGIN
  SELECT x.id INTO v_id FROM public.promo_codes x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'code' - 'quota' - 'terms' <> '{}'::jsonb OR v_code !~ '^[A-Z0-9-]{3,32}$'
     OR jsonb_typeof(p -> 'quota') IS DISTINCT FROM 'number' OR (p ->> 'quota') !~ '^\d{1,7}$' OR (p ->> 'quota')::integer NOT BETWEEN 1 AND 1000000
     OR coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: promo' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promo_codes x WHERE x.tenant_id = a.tenant_id AND x.code = v_code) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: promo_code_taken' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.promo_codes (tenant_id, code, quota, command_key, created_by, created_as)
  VALUES (a.tenant_id, v_code, (p ->> 'quota')::integer, p_key, a.staff_id, a.role) RETURNING id INTO v_id;
  PERFORM public.promo_version_insert(a.tenant_id, v_id, p_key || ':v1', p -> 'terms', a.staff_id, a.role);
  PERFORM public.audit_append('settings_change', 'promo_code', v_id, 'success', 'promo_code_created');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_code_create(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.promo_code_create(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Ubah Syarat: new terms → version + 1 (the old version stays, frozen). Replay by key returns the version.
CREATE FUNCTION public.promo_code_version(p_key text, p_promo uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.promo_actor();
  v_id uuid;
BEGIN
  SELECT x.id INTO v_id FROM public.promo_code_versions x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: promo' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.promo_codes x WHERE x.tenant_id = a.tenant_id AND x.id = p_promo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: promo' USING ERRCODE = 'P0002';
  END IF;
  v_id := public.promo_version_insert(a.tenant_id, p_promo, p_key, p, a.staff_id, a.role);
  PERFORM public.audit_append('settings_change', 'promo_code', p_promo, 'success', 'promo_code_versioned');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_code_version(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.promo_code_version(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Aktif/Nonaktif and Kuota (open point 7: never below the current use). Idempotent by state.
CREATE FUNCTION public.promo_code_set(p_promo uuid, p_active boolean, p_quota integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.promo_actor();
  c public.promo_codes;
BEGIN
  SELECT * INTO c FROM public.promo_codes x WHERE x.tenant_id = a.tenant_id AND x.id = p_promo FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: promo' USING ERRCODE = 'P0002';
  END IF;
  IF p_quota IS NOT NULL AND (p_quota NOT BETWEEN 1 AND 1000000) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quota' USING ERRCODE = '22023';
  END IF;
  IF p_quota IS NOT NULL AND p_quota < c.used THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: quota_below_used' USING ERRCODE = '22023';
  END IF;
  IF (coalesce(p_active, c.active), coalesce(p_quota, c.quota)) = (c.active, c.quota) THEN
    RETURN;
  END IF;
  UPDATE public.promo_codes SET active = coalesce(p_active, active), quota = coalesce(p_quota, quota) WHERE tenant_id = c.tenant_id AND id = c.id;
  PERFORM public.audit_append('settings_change', 'promo_code', c.id, 'success', 'promo_code_changed');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_code_set(uuid, boolean, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.promo_code_set(uuid, boolean, integer) TO clinic_app;--> statement-breakpoint

-- Kode Promo & Voucher (K25 data, PR-77 "usage statistics"): per code its latest terms and per version the uses reserved,
-- consumed, released and the discount given — aggregates only (no patient or invoice ids; r1 P2-5). Code managers, the
-- Kasir roles and the auditor; capability configuration or cashier.
CREATE FUNCTION public.promo_codes_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','marketing','finance','auditor','manager','fo_cashier') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read promo codes' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.tenant_capability('configuration') OR public.tenant_capability('cashier')) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: promo codes are not available now' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'quota', c.quota, 'used', c.used, 'active', c.active,
      'versions', (SELECT jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'valid_from', v.valid_from, 'valid_to', v.valid_to,
                          'discount_kind', v.discount_kind, 'discount_value', v.discount_value, 'max_discount', v.max_discount,
                          'item_ids', v.item_ids, 'branch_ids', v.branch_ids, 'per_patient_limit', v.per_patient_limit,
                          'reserved', (SELECT count(*) FROM public.promo_usages u WHERE u.tenant_id = v.tenant_id AND u.version_id = v.id AND u.state = 'reserved'),
                          'consumed', (SELECT count(*) FROM public.promo_usages u WHERE u.tenant_id = v.tenant_id AND u.version_id = v.id AND u.state = 'consumed'),
                          'released', (SELECT count(*) FROM public.promo_usages u WHERE u.tenant_id = v.tenant_id AND u.version_id = v.id AND u.state = 'released'),
                          'discount_given', (SELECT coalesce(sum(u.discount), 0) FROM public.promo_usages u WHERE u.tenant_id = v.tenant_id AND u.version_id = v.id AND u.state = 'consumed'))
                          ORDER BY v.version DESC)
                     FROM public.promo_code_versions v WHERE v.tenant_id = c.tenant_id AND v.promo_id = c.id))
      ORDER BY c.code) FROM public.promo_codes c WHERE c.tenant_id = a.tenant_id), '[]'::jsonb);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_codes_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.promo_codes_list() TO clinic_app;--> statement-breakpoint

-- The Kasir hint (no write): whether a code applies to an item at a branch, for a quantity and an optional patient, and the
-- discount it gives — or the refusal reason (the same order as the issue; exhausted read from the counter, read-only).
CREATE FUNCTION public.promo_code_check(p_code text, p_item uuid, p_branch uuid, p_quantity integer DEFAULT 1, p_patient uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(p_branch);
  v public.promo_code_versions;
  c public.promo_codes;
  v_price bigint;
  v_disc bigint;
  v_patient uuid;
BEGIN
  IF NOT public.tenant_capability('cashier') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the cashier is not available now' USING ERRCODE = '42501';
  END IF;
  IF a.branch_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: promo_check' USING ERRCODE = '22023';
  END IF;
  IF p_patient IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.patients x WHERE x.tenant_id = a.tenant_id AND x.id = p_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  v_patient := CASE WHEN p_patient IS NOT NULL THEN public.patient_canonical(a.tenant_id, p_patient) END;
  BEGIN
    v := public.promo_resolve(a.tenant_id, p_code, p_item, a.branch_id, v_patient, clock_timestamp());
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', regexp_replace(SQLERRM, '^ERR_[A-Z_]+: ', ''));
  END;
  SELECT * INTO c FROM public.promo_codes x WHERE x.tenant_id = v.tenant_id AND x.id = v.promo_id;
  IF c.used >= c.quota THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'promo_exhausted');
  END IF;
  IF v.per_patient_limit IS NOT NULL AND (SELECT count(*) FROM public.promo_usages u WHERE u.tenant_id = c.tenant_id AND u.promo_id = c.id
        AND u.state IN ('reserved','consumed') AND public.patient_canonical(u.tenant_id, u.patient_id) = v_patient) >= v.per_patient_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'promo_patient_limit');
  END IF;
  v_price := public.catalog_branch_price(p_item, a.branch_id, clock_timestamp());
  v_disc := CASE WHEN v_price IS NULL THEN NULL ELSE public.promo_discount(v, v_price * p_quantity) END;
  -- the snapshot's rule (review r1 P2-1): at least 1, and below the gross on a package line
  IF v_disc IS NULL OR v_disc < 1 OR v_disc >= v_price * p_quantity
     AND EXISTS (SELECT 1 FROM public.catalog_items ci WHERE ci.tenant_id = a.tenant_id AND ci.id = p_item AND ci.kind = 'package') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'discount');
  END IF;
  RETURN jsonb_build_object('ok', true, 'promo_id', c.id, 'version', v.version, 'gross', v_price * p_quantity, 'discount', v_disc);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promo_code_check(text, uuid, uuid, integer, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.promo_code_check(text, uuid, uuid, integer, uuid) TO clinic_app;--> statement-breakpoint

-- ── T-081 re-created functions (latest definitions, edits asserted by recreate.py) ──
DROP FUNCTION public.invoice_line_snapshot(public.invoices, uuid, integer, bigint, timestamptz, uuid, uuid, text);--> statement-breakpoint
-- invoice_line_snapshot (re-created from 0096): a promo line (T-081): the version's discount, kind promo; the manual limit and approval only for a manual discount.
CREATE FUNCTION public.invoice_line_snapshot(p_invoice public.invoices, p_item uuid, p_quantity integer, p_discount bigint, p_at timestamptz, p_plan_item uuid, p_substitution uuid, p_role text, p_promo public.promo_code_versions) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v public.catalog_versions;
  v_price bigint;
  v_total bigint;
  v_pkp boolean;
  v_split record;
  v_id uuid;
  u public.package_substitutions;
  v_kind text;
  v_approval uuid;
  v_disc bigint := p_discount;
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
  -- T-081 (PR-77, BILL-28): a promo line is pre-approved — its version's discount, kind 'promo', no manual limit, no approval.
  -- One discount per line (r1 P2-7): at least 1, and below the gross on a package line (packages_check price ≥ 1).
  IF p_promo.id IS NOT NULL THEN
    IF p_discount <> 0 OR p_substitution IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: promo_and_discount' USING ERRCODE = '22023';
    END IF;
    v_disc := public.promo_discount(p_promo, v_price * p_quantity);
    IF v_disc IS NULL OR v_disc < 1 OR v_disc >= v_price * p_quantity
       AND EXISTS (SELECT 1 FROM public.catalog_items ci WHERE ci.tenant_id = p_invoice.tenant_id AND ci.id = p_item AND ci.kind = 'package') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: discount' USING ERRCODE = '22023';
    END IF;
    v_kind := 'promo';
  END IF;
  -- T-080 (PR-72): within the role's SET-12 limit the discount applies now; over it, the line waits at full price for an
  -- approval of the requested amount (the approval's subject is the line id generated here).
  IF p_discount > 0 THEN
    IF p_discount = v_price * p_quantity AND EXISTS (SELECT 1 FROM public.catalog_items ci WHERE ci.tenant_id = p_invoice.tenant_id AND ci.id = p_item AND ci.kind = 'package') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: discount' USING ERRCODE = '22023';
    END IF;
    v_kind := 'manual';
    v_id := public.uuid_generate_v7();
    IF NOT public.discount_within_limit(p_role, v_price * p_quantity, p_discount, p_at) THEN
      v_disc := 0;  -- the approval is requested after every check and the VAT gate lock (r1 P2-5b)
    END IF;
  END IF;
  v_total := v_price * p_quantity - v_disc;
  v_pkp := public.tax_pkp_at(p_invoice.tenant_id, p_at, p_invoice.branch_id);
  IF v_pkp AND v.tax_category IN ('taxable_service','taxable_goods') THEN
    PERFORM public.feature_gate_lock('vat_on_invoices');
    IF NOT public.feature_gate_open('vat_on_invoices') THEN
      RAISE EXCEPTION 'ERR_GATE_CLOSED: vat_on_invoices' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_kind = 'manual' AND v_disc = 0 THEN
    v_approval := public.approval_request('manual_discount', 'invoice_line', v_id, NULL, p_invoice.branch_id, p_discount);
  END IF;
  SELECT * INTO v_split FROM public.tax_vat_split(v_total, v.tax_category, v_pkp);
  PERFORM public.catalog_version_reference(v.id);
  INSERT INTO public.invoice_lines (id, tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, discount, line_total,
                                    tax_category, tax_basis, vat_base, vat_amount, plan_item_id, substitution_id, discount_kind, discount_approval_id)
  VALUES (coalesce(v_id, public.uuid_generate_v7()), p_invoice.tenant_id, p_invoice.branch_id, p_invoice.id, p_item, v.id, p_quantity, v_price, v_disc, v_total,
          v.tax_category, v.tax_basis, v_split.base, v_split.vat, p_plan_item, p_substitution, v_kind, v_approval)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_line_snapshot(public.invoices, uuid, integer, bigint, timestamptz, uuid, uuid, text, public.promo_code_versions) FROM PUBLIC;--> statement-breakpoint

-- invoice_issue (re-created from 0096): lines[].promo_code: resolved, snapshotted, the quota taken atomically, the usage reserved (T-081).
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
  PERFORM public.kasir_visit_payment(i.tenant_id, i.visit_id);
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (i.branch_id, 'InvoiceIssued', 'invoice', i.id, jsonb_build_object('invoice_id', i.id, 'branch_id', i.branch_id));
  PERFORM public.audit_append('settings_change', 'invoice', i.id, 'success', 'invoice_issued');
  RETURN jsonb_build_object('invoice_id', i.id, 'issued_at', v_at, 'is_pkp_at_issue', v_pkp, 'number', v_number,
    'total', (SELECT sum(x.line_total) FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id),
    'discount_pending', (SELECT count(*) FROM public.invoice_lines x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id AND public.discount_pending(x.tenant_id, x.id)),
    'promo_lines', (SELECT count(*) FROM public.promo_usages pu WHERE pu.tenant_id = i.tenant_id AND pu.invoice_id = i.id));
END
$$;--> statement-breakpoint

-- invoice_lines_guard (re-created from 0096): a promo line inserts with its discount and no approval (T-081).
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

-- kasir_record_payment (re-created from 0096): a settled promo line consumes its use (T-081).
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
       WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id AND l.line_total - l.cancelled_amount - l.receivable_amount - public.kasir_line_paid(l.tenant_id, l.id) > 0 AND NOT public.discount_pending(l.tenant_id, l.id);
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
        IF NOT v_sim THEN
          PERFORM public.promo_usage_sync(i.tenant_id, v_line.id); -- T-081: a settled promo line consumes its use
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

-- deposit_apply_do (re-created from 0096): a line settled by the DP consumes its promo use (T-081).
CREATE OR REPLACE FUNCTION public.deposit_apply_do(i public.invoices, d public.booking_deposits, p_staff uuid, p_role text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  il public.invoice_lines;
  v_vat bigint;
BEGIN
  SELECT x.* INTO il FROM public.invoice_lines x
   WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id AND x.item_id = (SELECT cv.item_id FROM public.catalog_versions cv WHERE cv.tenant_id = d.tenant_id AND cv.id = d.catalog_version_id)
     AND x.plan_item_id IS NULL AND x.substitution_id IS NULL
     AND x.line_total - x.cancelled_amount - x.receivable_amount - public.kasir_line_paid(x.tenant_id, x.id) >= d.amount AND NOT public.discount_pending(x.tenant_id, x.id)
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
  PERFORM public.promo_usage_sync(il.tenant_id, il.id); -- T-081
  RETURN il.id;
END
$$;--> statement-breakpoint

-- receivable_convert (re-created from 0096): a converted line consumes its promo use (T-081).
CREATE OR REPLACE FUNCTION public.receivable_convert(p_key text, p_visit uuid) RETURNS jsonb
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
     AND public.refund_line_delivered(l, i) AND NOT public.discount_pending(l.tenant_id, l.id);
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
    PERFORM public.promo_usage_sync(v.tenant_id, v_lines[k]); -- T-081: a converted remainder settles the line
  END LOOP;
  PERFORM public.kasir_visit_payment(v.tenant_id, v.id);
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (v.tenant_id, v.branch_id, 'ReceivableCreated', 'receivable', v_id, a.staff_id, a.role, jsonb_build_object('receivable_id', v_id, 'visit_id', v.id));
  PERFORM public.audit_append('money_correction', 'receivable', v_id, 'success', 'receivable_created');
  RETURN jsonb_build_object('receivable_id', v_id, 'amount', v_sum);
END
$$;--> statement-breakpoint

-- invoice_void_sync (re-created from 0094): the void releases the reserved promo uses (T-081).
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
$$;--> statement-breakpoint

-- interrupted_to_balance (re-created from 0094): a partly paid stopped addition settles its promo use (T-081).
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
    PERFORM public.promo_usage_sync(l.tenant_id, l.id); -- T-081 (r1 P1-1): the cancelled remainder settles a partly paid line
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

-- package_close_do (re-created from 0095): promo use removed, settled or refunded in full with the package (T-081).
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
  v_fee public.consultation_fees;
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
  -- T-081 (BILL-36, r1 P1-2): nothing paid → the line is removed (released; a void has already released its uses as void before
  -- calling here, so the release below is then a no-op); paid → settled
  -- (consumed), and an unredeemed paid package cancelled is the purchase refunded in full (released).
  IF public.kasir_line_paid(l.tenant_id, l.id) = 0 THEN
    PERFORM public.promo_release(l.tenant_id, l.id, 'reserved', 'removed');
  ELSE
    PERFORM public.promo_usage_sync(l.tenant_id, l.id);
    IF p_state = 'cancelled' AND p_reason IS DISTINCT FROM 'invoice_void' AND v_redeemed = 0 THEN
      PERFORM public.promo_release(l.tenant_id, l.id, 'consumed', 'refunded_full');
    END IF;
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
  -- T-079 (PR-12, r1 P1-2): a package cancelled (not by an invoice void) with nothing redeemed is a refund of the purchase.
  IF p_state = 'cancelled' AND p_reason IS DISTINCT FROM 'invoice_void' AND v_redeemed = 0 THEN
    PERFORM public.consultation_controls_cancel(pk.tenant_id, pk.invoice_line_id, NULL);
    v_fee := public.consultation_recharge_due(pk.tenant_id, pk.invoice_line_id, NULL);
    IF v_fee.id IS NOT NULL THEN
      PERFORM 1 FROM public.visits x WHERE x.tenant_id = v_fee.tenant_id AND x.id = v_fee.visit_id FOR UPDATE;
      PERFORM public.consultation_recharge(v_fee, 'package', pk.id, v_unused + v_sub_paid, p_staff, p_role);
    END IF;
  END IF;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload)
  VALUES (pk.tenant_id, pk.sold_branch_id, CASE WHEN p_state = 'expired' THEN 'PackageExpired' ELSE 'PackageCancelled' END, 'package', pk.id, p_staff, p_role,
          jsonb_build_object('package_id', pk.id, 'patient_id', pk.patient_id))
  RETURNING id INTO v_event;
  RETURN jsonb_build_object('package_id', pk.id, 'state', p_state, 'to_balance', v_unused + v_sub_paid, 'cancelled', v_remainder);
END
$$;--> statement-breakpoint

-- refund_settle (re-created from 0095): a full refund releases the promo use (T-081).
CREATE OR REPLACE FUNCTION public.refund_settle(r public.refunds, p_staff uuid, p_role text, p_method text,
                                     OUT o_vat bigint, OUT o_credit uuid, OUT o_cash uuid, OUT o_deducted bigint)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  i public.invoices;
  v_vat bigint;
  dl record;
  v_left integer;
  v_q numeric;
  v_disp uuid;
  v_fee public.consultation_fees;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = r.tenant_id AND x.id = r.invoice_id;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = r.tenant_id AND x.id = r.invoice_line_id FOR UPDATE;
  v_vat := least(l.vat_recognised_amount - l.vat_reversed_amount, CASE WHEN l.line_total = 0 THEN 0 ELSE (l.vat_recognised_amount * r.amount) / l.line_total END);
  UPDATE public.invoice_lines SET moved_to_balance = moved_to_balance + r.amount,
         vat_reversed_amount = vat_reversed_amount + v_vat,
         vat_reversed_at = CASE WHEN vat_reversed_amount + v_vat > 0 THEN coalesce(vat_reversed_at, clock_timestamp()) END
   WHERE tenant_id = l.tenant_id AND id = l.id;
  o_vat := v_vat;
  -- T-081 (BILL-36): a refund of the full line value (cash or balance; this one included) releases its promo use; a partial
  -- refund keeps it consumed.
  IF l.line_total - l.cancelled_amount > 0 AND (SELECT coalesce(sum(x.amount), 0) FROM public.refunds x WHERE x.tenant_id = l.tenant_id AND x.invoice_line_id = l.id
                                                  AND x.state = 'paid' AND x.id <> r.id) + r.amount >= l.line_total - l.cancelled_amount THEN
    PERFORM public.promo_release(l.tenant_id, l.id, 'consumed', 'refunded_full');
  END IF;
  o_credit := public.balance_post(r.tenant_id, r.patient_id, r.branch_id, 'from_refund', r.amount,
                                  jsonb_build_object('source_kind', 'refund', 'source_id', r.id), 'refund:' || r.id::text, p_staff, p_role);
  -- T-079 (PR-12, BILL-21, 4c): the last qualifying purchase refunded re-charges the waived fee from this refund, paid from the
  -- balance before any cash leaves; the source's controls are cancelled. A cash refund pays out the rest.
  o_deducted := 0;
  PERFORM public.consultation_controls_cancel(r.tenant_id, l.id, r.amount);
    v_fee := public.consultation_recharge_due(r.tenant_id, l.id, r.amount);
  IF v_fee.id IS NOT NULL THEN
    o_deducted := public.consultation_recharge(v_fee, 'refund', r.id, r.amount, p_staff, p_role);
  END IF;
  IF r.destination = 'cash' AND r.amount - o_deducted > 0 THEN
    o_cash := public.balance_post(r.tenant_id, r.patient_id, r.branch_id, 'cash_refund', -(r.amount - o_deducted),
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

-- kasir_invoice_get (re-created from 0096): per line the promo code (T-081).
CREATE OR REPLACE FUNCTION public.kasir_invoice_get(p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.kasir_reader(NULL::uuid);
  i public.invoices;
  v_mask boolean := a.role = 'auditor';
  v_at timestamptz := clock_timestamp();
  c public.payment_port_configs;
  v_port boolean;
  v_prod_mock boolean;
  v_bal bigint;
BEGIN
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = a.tenant_id AND x.id = p_invoice;
  IF NOT FOUND OR a.branch_id IS NOT NULL AND i.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: invoice not found' USING ERRCODE = 'P0002';
  END IF;
  v_bal := CASE WHEN i.patient_id IS NULL THEN 0 ELSE public.balance_of(i.tenant_id, i.patient_id) END;
  c := public.payment_port_of(i.tenant_id);
  v_port := public.payment_port_usable(c);
  -- BILL-29, scenario PR-68: a production tenant whose port is the mock is not offered QRIS, VA or link at all.
  v_prod_mock := c.id IS NOT NULL AND c.provider = 'mock' AND public.payment_deploy_env() = 'production';
  RETURN public.kasir_invoice_row(i, v_mask) || jsonb_build_object(
    'branch', (SELECT jsonb_build_object('id', b.id, 'name', b.name) FROM public.branches b WHERE b.tenant_id = i.tenant_id AND b.id = i.branch_id),
    'is_pkp_at_issue', i.is_pkp_at_issue, 'patient_balance', CASE WHEN v_mask OR i.patient_id IS NULL THEN NULL ELSE v_bal END, 'voided_at', i.voided_at, 'role', a.role,
    'can_pay', a.role IN ('owner','manager','fo_cashier','finance'),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'name', cv.name, 'quantity', l.quantity, 'unit_price', l.unit_price,
                                 'discount', l.discount, 'discount_kind', l.discount_kind,
                                 'discount_requested', (SELECT ap.amount_rupiah FROM public.approvals ap WHERE ap.tenant_id = l.tenant_id AND ap.id = l.discount_approval_id AND ap.state = 'pending'),
                                 'promo_code', (SELECT pc.code FROM public.promo_usages pu JOIN public.promo_codes pc ON pc.tenant_id = pu.tenant_id AND pc.id = pu.promo_id
                                                 WHERE pu.tenant_id = l.tenant_id AND pu.invoice_line_id = l.id),
                                 'line_total', l.line_total, 'tax_category', l.tax_category, 'vat_amount', l.vat_amount,
                                 'vat_recognised', l.vat_recognised_amount, 'paid', public.kasir_line_paid(l.tenant_id, l.id), 'plan_item_id', l.plan_item_id,
                                 'dispensing', (SELECT jsonb_build_object('id', d.id, 'state', d.state) FROM public.dispensings d WHERE d.tenant_id = l.tenant_id AND d.invoice_line_id = l.id))
                                 ORDER BY l.created_at, l.id)
                         FROM public.invoice_lines l JOIN public.catalog_versions cv ON cv.tenant_id = l.tenant_id AND cv.id = l.catalog_version_id
                        WHERE l.tenant_id = i.tenant_id AND l.invoice_id = i.id), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'total', r.total, 'issued_at', r.issued_at, 'is_simulated', r.is_simulated,
                                    'payments', (SELECT jsonb_agg(jsonb_build_object('seq', y.seq, 'method', y.method, 'amount', y.amount, 'change', y.change_given) ORDER BY y.seq)
                                                   FROM public.payments y WHERE y.tenant_id = r.tenant_id AND y.receipt_id = r.id)) ORDER BY r.issued_at, r.id)
                            FROM public.receipts r WHERE r.tenant_id = i.tenant_id AND r.invoice_id = i.id), '[]'::jsonb),
    -- QRIS, VA and link: available through a usable port with the channel (QRIS also enabled in SET-14); VA listed only
    -- for a provisioned port that has it (r2 F-4); none of them in production with the mock.
    'tenders', (SELECT jsonb_agg(jsonb_build_object('method', m.k, 'available', m.ok, 'blocked', m.why) ORDER BY m.o) FROM (VALUES
        (1, 'cash', public.kasir_method_enabled('cash', v_at), CASE WHEN NOT public.kasir_method_enabled('cash', v_at) THEN 'method_disabled' END),
        (2, 'qris', v_port AND 'qris' = ANY (c.channels) AND public.kasir_method_enabled('qris', v_at),
            CASE WHEN NOT v_port OR NOT 'qris' = ANY (coalesce(c.channels, '{}')) THEN 'payment_port' WHEN NOT public.kasir_method_enabled('qris', v_at) THEN 'method_disabled' END),
        (3, 'edc', public.kasir_method_enabled('edc', v_at), CASE WHEN NOT public.kasir_method_enabled('edc', v_at) THEN 'method_disabled' END),
        (4, 'transfer', public.kasir_method_enabled('transfer', v_at), CASE WHEN NOT public.kasir_method_enabled('transfer', v_at) THEN 'method_disabled' END),
        (5, 'va', v_port AND 'va' = ANY (c.channels), NULL),
        (6, 'payment_link', v_port AND 'payment_link' = ANY (coalesce(c.channels, '{}')), CASE WHEN NOT (v_port AND 'payment_link' = ANY (coalesce(c.channels, '{}'))) THEN 'payment_port' END),
        (7, 'balance', i.patient_id IS NOT NULL AND v_bal > 0 AND public.kasir_method_enabled('balance', v_at),
            CASE WHEN NOT public.kasir_method_enabled('balance', v_at) THEN 'method_disabled' WHEN i.patient_id IS NULL OR v_bal = 0 THEN 'balance' END)) m(o, k, ok, why)
      WHERE NOT (v_prod_mock AND m.k IN ('qris','va','payment_link')) AND NOT (m.k = 'va' AND NOT (v_port AND 'va' = ANY (coalesce(c.channels, '{}'))))),
    'port', CASE WHEN v_port THEN jsonb_build_object('provider', c.provider, 'simulated', c.provider = 'mock') END,
    'charges', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'channel', x.channel, 'amount', x.amount, 'state', x.state, 'order_ref', x.order_ref,
                                   'expires_at', x.expires_at, 'is_simulated', x.is_simulated, 'review_flag', x.review_flag, 'balance_pending', x.balance_pending,
                                   'receipt_id', x.receipt_id) ORDER BY x.created_at DESC, x.id)
                           FROM public.payment_charges x WHERE x.tenant_id = i.tenant_id AND x.invoice_id = i.id), '[]'::jsonb),
    'void', (SELECT jsonb_build_object('approval_id', ap.id, 'state', ap.state, 'requested_at', ap.requested_at,
                                       'reason', CASE WHEN v_mask THEN NULL ELSE ap.request_reason END)
               FROM public.approvals ap WHERE ap.tenant_id = i.tenant_id AND ap.type = 'invoice_void' AND ap.subject_id = i.id
              ORDER BY ap.requested_at DESC LIMIT 1));
END
$$;
