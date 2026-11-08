CREATE TABLE "branch_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"price" bigint,
	"effective_from" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "branch_prices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "branch_prices_price_check" CHECK ("branch_prices"."price" is null or "branch_prices"."price" between 1 and 1000000000000),
	CONSTRAINT "branch_prices_state_check" CHECK ("branch_prices"."state" in ('active','cancelled')),
	CONSTRAINT "branch_prices_cancel_check" CHECK (("branch_prices"."state" = 'cancelled') = ("branch_prices"."cancelled_at" is not null and "branch_prices"."cancelled_by" is not null)),
	CONSTRAINT "branch_prices_owner_check" CHECK ("branch_prices"."created_as" = 'owner'),
	CONSTRAINT "branch_prices_reason_check" CHECK (length(btrim("branch_prices"."reason")) between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "branch_prices" ADD CONSTRAINT "branch_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_prices" ADD CONSTRAINT "branch_prices_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_prices" ADD CONSTRAINT "branch_prices_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_prices" ADD CONSTRAINT "branch_prices_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_prices" ADD CONSTRAINT "branch_prices_tenant_id_cancelled_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cancelled_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_prices_one_active_per_time" ON "branch_prices" USING btree ("tenant_id","branch_id","item_id","effective_from") WHERE "branch_prices"."state" = 'active';;--> statement-breakpoint

-- T-035 rules (generated; see header)
-- T-035 (PR-42, B-08, SET-5; plan docs/tasks/T-035.md): branch price overrides on the shared catalog,
-- Owner only, effective-dated, keyed by catalog item. Writes only through branch_price_set and
-- branch_price_cancel; every member reads the effective price through catalog_branch_price().

-- ── Readers ─────────────────────────────────────────────────────────────────────────────────
-- A branch price is commercial data (DEC-046 (2)): every member of the tenant reads the rows.
ALTER TABLE public.branch_prices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY branch_prices_read ON public.branch_prices FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id());--> statement-breakpoint
GRANT SELECT ON public.branch_prices TO clinic_app;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.branch_prices', 'tenant-shared', 'catalog', '{*}', 'branch price functions (src/modules/catalog/prices)', 'none');--> statement-breakpoint

-- Vendor support access (TEN-14, TEN-19): prices are configuration.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.branch_prices', 'config');--> statement-breakpoint
CREATE POLICY branch_prices_operator_read ON public.branch_prices FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.branch_prices', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.branch_prices TO clinic_operator;--> statement-breakpoint

-- ── Guard ───────────────────────────────────────────────────────────────────────────────────
-- An override starts active; the only change is active -> cancelled, before it takes effect (wall
-- clock), with who and when. A row in effect is replaced by a newer row, never edited. Never deleted.
CREATE FUNCTION public.branch_prices_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'branch prices are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'active' OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL THEN
      RAISE EXCEPTION 'a branch price starts active' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','cancelled_at','cancelled_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','cancelled_at','cancelled_by'])
     OR NOT (OLD.state = 'active' AND NEW.state = 'cancelled' AND NEW.cancelled_at IS NOT NULL AND NEW.cancelled_by IS NOT NULL)
     OR OLD.effective_from <= clock_timestamp() THEN
    RAISE EXCEPTION 'a branch price is only cancelled, before it takes effect' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_prices_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER branch_prices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.branch_prices FOR EACH ROW EXECUTE FUNCTION public.branch_prices_guard();--> statement-breakpoint
ALTER TABLE public.branch_prices ENABLE ALWAYS TRIGGER branch_prices_guard;--> statement-breakpoint
CREATE TRIGGER branch_prices_no_truncate BEFORE TRUNCATE ON public.branch_prices FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- ── The effective price (plan r1 P1-1) ──────────────────────────────────────────────────────
-- The price of an item at a branch at p_at: the newest active override with effective_from <= p_at
-- (a "back to normal" row included), else, or when that row's price is null, the active version's
-- normal price. Null for another tenant's or an unknown item or branch, a material, an item without
-- an active version, or no staff context. A definer because commercial roles (the cashier) cannot read
-- catalog_versions (DEC-046 (2)); the default is the wall clock, so a price set "now" is visible later
-- in the same transaction.
CREATE FUNCTION public.catalog_branch_price(p_item uuid, p_branch uuid, p_at timestamptz DEFAULT clock_timestamp()) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT bp.price FROM public.branch_prices bp
                    WHERE bp.tenant_id = i.tenant_id AND bp.branch_id = b.id AND bp.item_id = i.id
                      AND bp.state = 'active' AND bp.effective_from <= p_at
                    ORDER BY bp.effective_from DESC LIMIT 1),
                  v.normal_price)
    FROM public.catalog_items i
    JOIN public.branches b ON b.tenant_id = i.tenant_id AND b.id = p_branch
    JOIN public.catalog_versions v ON v.tenant_id = i.tenant_id AND v.item_id = i.id AND v.state = 'active'
   WHERE i.tenant_id = public.app_tenant_id() AND i.id = p_item AND i.kind <> 'material'
     AND public.app_staff_id() IS NOT NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_branch_price(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_branch_price(uuid, uuid, timestamptz) TO clinic_app;--> statement-breakpoint

-- ── Writers (Owner only; plan r1 P1-3, P2-1) ────────────────────────────────────────────────
-- branch_price_set: an override (p_price 1..1e12) or "back to the normal price" (p_price null) for a
-- sellable item at a branch of the tenant, from p_effective (null = now). Stored at
-- greatest(requested or now, now, the newest active row in effect + 1 µs), as setting_effective: a
-- write "now" always follows the row in force. A requested time over a minute in the past or over
-- 366 days ahead is refused; the same future time as an active row is a conflict. Never restricted by
-- the selected branch (an Owner acts on every branch, HYG-009 N2). Returns
-- {"id","item_id","branch_id","effective_from"}.
CREATE FUNCTION public.branch_price_set(p_item uuid, p_branch uuid, p_price bigint, p_effective timestamptz, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_kind text;
  v_effective timestamptz;
  v_id uuid := public.uuid_generate_v7();
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner sets branch prices' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = a.tenant_id AND id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  -- The item row lock serializes writes on one item (and orders them after catalog_publish's lock).
  SELECT kind INTO v_kind FROM public.catalog_items WHERE tenant_id = a.tenant_id AND id = p_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: catalog item not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_kind = 'material' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: materials have no branch price' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_versions WHERE tenant_id = a.tenant_id AND item_id = p_item AND state = 'active') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: the item has no active version' USING ERRCODE = '22023';
  END IF;
  IF p_price IS NOT NULL AND (p_price < 1 OR p_price > 1000000000000) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: price must be at least Rp1' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: a reason of 3 to 500 characters' USING ERRCODE = '22023';
  END IF;
  IF p_effective < clock_timestamp() - interval '1 minute' OR p_effective > clock_timestamp() + interval '366 days' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: effective from now up to one year ahead' USING ERRCODE = '22023';
  END IF;
  v_effective := greatest(coalesce(p_effective, clock_timestamp()), clock_timestamp(),
                          coalesce((SELECT max(bp.effective_from) + interval '1 microsecond' FROM public.branch_prices bp
                                     WHERE bp.tenant_id = a.tenant_id AND bp.branch_id = p_branch AND bp.item_id = p_item
                                       AND bp.state = 'active' AND bp.effective_from <= clock_timestamp()), '-infinity'));
  BEGIN
    INSERT INTO public.branch_prices (id, tenant_id, branch_id, item_id, price, effective_from, reason, created_by, created_as)
    VALUES (v_id, a.tenant_id, p_branch, p_item, p_price, v_effective, btrim(p_reason), a.staff_id, a.role);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: a price for this branch already starts at that time' USING ERRCODE = '23505';
  END;
  PERFORM public.audit_append('settings_change', 'branch_price', v_id, 'success', 'branch_price_set');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (p_branch, 'BranchPriceChanged', 'branch_price', v_id, jsonb_build_object('item_id', p_item, 'branch_id', p_branch, 'change', 'set'));
  RETURN jsonb_build_object('id', v_id, 'item_id', p_item, 'branch_id', p_branch, 'effective_from', v_effective);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_price_set(uuid, uuid, bigint, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_price_set(uuid, uuid, bigint, timestamptz, text) TO clinic_app;--> statement-breakpoint

-- branch_price_cancel: the Owner withdraws a scheduled override before it takes effect.
CREATE FUNCTION public.branch_price_cancel(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  r public.branch_prices;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role <> 'owner' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: only the owner cancels branch prices' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.branch_prices WHERE tenant_id = a.tenant_id AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch price not found' USING ERRCODE = 'P0002';
  END IF;
  -- Same lock order as branch_price_set: the item row, then the price row.
  PERFORM 1 FROM public.catalog_items WHERE tenant_id = a.tenant_id AND id = r.item_id FOR UPDATE;
  SELECT * INTO r FROM public.branch_prices WHERE tenant_id = a.tenant_id AND id = p_id FOR UPDATE;
  IF r.state <> 'active' OR r.effective_from <= clock_timestamp() THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already in effect or cancelled' USING ERRCODE = '55000';
  END IF;
  UPDATE public.branch_prices SET state = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = a.staff_id
   WHERE tenant_id = a.tenant_id AND id = p_id;
  PERFORM public.audit_append('settings_change', 'branch_price', p_id, 'success', 'branch_price_cancelled');
  INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
  VALUES (r.branch_id, 'BranchPriceChanged', 'branch_price', p_id, jsonb_build_object('item_id', r.item_id, 'branch_id', r.branch_id, 'change', 'cancelled'));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.branch_price_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.branch_price_cancel(uuid) TO clinic_app;
