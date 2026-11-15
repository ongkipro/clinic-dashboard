CREATE TABLE "token_vault" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waba_id" uuid NOT NULL,
	"token_kind" text NOT NULL,
	"granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"encrypted_token" text NOT NULL,
	"dek_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "token_vault_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "token_vault_check" CHECK ("token_vault"."token_kind" in ('business_integration_system_user','system_user','bsp_api_key') and "token_vault"."encrypted_token" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and "token_vault"."dek_ref" ~ '^dek:v[1-9][0-9]{0,8}$'
      and cardinality("token_vault"."granted_scopes") <= 30 and (("token_vault"."revoked_at" is null) = ("token_vault"."revoked_reason" is null))
      and ("token_vault"."revoked_reason" is null or "token_vault"."revoked_reason" ~ '^[a-z][a-z_]{1,40}$'))
);
--> statement-breakpoint
CREATE TABLE "wa_numbers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waba_id" uuid NOT NULL,
	"branch_id" uuid,
	"phone_number" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_name" text NOT NULL,
	"state" text DEFAULT 'number_pending_registration' NOT NULL,
	"display_name_status" text DEFAULT 'none' NOT NULL,
	"quality_rating" text DEFAULT 'unknown' NOT NULL,
	"is_coexistence" boolean DEFAULT false NOT NULL,
	"history_sync_enabled" boolean DEFAULT false NOT NULL,
	"registration_pin_enc" text NOT NULL,
	"pin_dek_ref" text NOT NULL,
	"added_by" uuid NOT NULL,
	"added_as" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"registered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"revoked_at" timestamp with time zone,
	"command_key" text NOT NULL,
	CONSTRAINT "wa_numbers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "wa_numbers_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "wa_numbers_check" CHECK ("wa_numbers"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "wa_numbers"."state" in ('number_pending_registration','number_registered','display_name_pending','active','quality_restricted','revoked')
      and "wa_numbers"."display_name_status" in ('none','pending_review','approved','declined') and "wa_numbers"."quality_rating" in ('unknown','green','yellow','red')
      and "wa_numbers"."phone_number" ~ '^\+[1-9][0-9]{7,14}$' and "wa_numbers"."phone_number_id" ~ '^[0-9]{5,32}$' and length(btrim("wa_numbers"."display_name")) between 3 and 120
      and (not "wa_numbers"."history_sync_enabled" or "wa_numbers"."is_coexistence") and "wa_numbers"."registration_pin_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and "wa_numbers"."pin_dek_ref" ~ '^dek:v[1-9][0-9]{0,8}$'
      and "wa_numbers"."added_as" in ('owner','admin_pusat') and (("wa_numbers"."state" = 'revoked') = ("wa_numbers"."revoked_at" is not null))
      and (("wa_numbers"."state" = 'number_pending_registration') = ("wa_numbers"."registered_at" is null)))
);
--> statement-breakpoint
CREATE TABLE "waba_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"state" text DEFAULT 'signup_started' NOT NULL,
	"previous_state" text,
	"onboarding_channel" text NOT NULL,
	"bsp_provider" text,
	"meta_waba_id" text,
	"meta_business_id" text,
	"business_verification_status" text DEFAULT 'unverified' NOT NULL,
	"quality_rating" text DEFAULT 'unknown' NOT NULL,
	"portfolio_messaging_limit" integer DEFAULT 250 NOT NULL,
	"app_subscribed" boolean DEFAULT false NOT NULL,
	"started_by" uuid NOT NULL,
	"started_as" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"revoked_at" timestamp with time zone,
	"command_key" text NOT NULL,
	CONSTRAINT "waba_accounts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "waba_accounts_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "waba_accounts_check" CHECK ("waba_accounts"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "waba_accounts"."state" in ('not_connected','signup_started','token_exchanged','app_subscribed','number_pending_registration','number_registered','display_name_pending','active','verification_required','quality_restricted','revoked')
      and ("waba_accounts"."previous_state" is null or "waba_accounts"."previous_state" in ('not_connected','signup_started','token_exchanged','app_subscribed','number_pending_registration','number_registered','display_name_pending','active','verification_required','quality_restricted','revoked'))
      and "waba_accounts"."onboarding_channel" in ('cloud_api','bsp_fallback') and (("waba_accounts"."onboarding_channel" = 'bsp_fallback') = ("waba_accounts"."bsp_provider" is not null))
      and ("waba_accounts"."bsp_provider" is null or length(btrim("waba_accounts"."bsp_provider")) between 2 and 60)
      and ("waba_accounts"."meta_waba_id" is null or "waba_accounts"."meta_waba_id" ~ '^[0-9]{5,32}$') and ("waba_accounts"."meta_business_id" is null or "waba_accounts"."meta_business_id" ~ '^[0-9]{5,32}$')
      and "waba_accounts"."business_verification_status" in ('unverified','pending','verified') and "waba_accounts"."quality_rating" in ('unknown','green','yellow','red')
      and "waba_accounts"."portfolio_messaging_limit" between 0 and 100000000 and "waba_accounts"."started_as" in ('owner','admin_pusat')
      and (("waba_accounts"."state" = 'revoked') = ("waba_accounts"."revoked_at" is not null))
      and ("waba_accounts"."state" in ('not_connected','signup_started') or "waba_accounts"."meta_waba_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "waba_routes" (
	"phone_number_id" text NOT NULL,
	"meta_waba_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waba_id" uuid NOT NULL,
	"wa_number_id" uuid NOT NULL,
	"branch_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "waba_routes_pkey" PRIMARY KEY("phone_number_id"),
	CONSTRAINT "waba_routes_check" CHECK ("waba_routes"."phone_number_id" ~ '^[0-9]{5,32}$' and "waba_routes"."meta_waba_id" ~ '^[0-9]{5,32}$'
      and ("waba_routes"."active" = ("waba_routes"."deactivated_at" is null)))
);
--> statement-breakpoint
ALTER TABLE "token_vault" ADD CONSTRAINT "token_vault_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_vault" ADD CONSTRAINT "token_vault_waba_fk" FOREIGN KEY ("tenant_id","waba_id") REFERENCES "public"."waba_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_numbers" ADD CONSTRAINT "wa_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_numbers" ADD CONSTRAINT "wa_numbers_waba_fk" FOREIGN KEY ("tenant_id","waba_id") REFERENCES "public"."waba_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_numbers" ADD CONSTRAINT "wa_numbers_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_numbers" ADD CONSTRAINT "wa_numbers_added_by_fk" FOREIGN KEY ("tenant_id","added_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waba_accounts" ADD CONSTRAINT "waba_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waba_accounts" ADD CONSTRAINT "waba_accounts_started_by_fk" FOREIGN KEY ("tenant_id","started_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waba_routes" ADD CONSTRAINT "waba_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waba_routes" ADD CONSTRAINT "waba_routes_waba_fk" FOREIGN KEY ("tenant_id","waba_id") REFERENCES "public"."waba_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waba_routes" ADD CONSTRAINT "waba_routes_number_fk" FOREIGN KEY ("tenant_id","wa_number_id") REFERENCES "public"."wa_numbers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waba_routes" ADD CONSTRAINT "waba_routes_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "token_vault_one_live" ON "token_vault" USING btree ("tenant_id","waba_id") WHERE "token_vault"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_numbers_phone_id_live" ON "wa_numbers" USING btree ("phone_number_id") WHERE "wa_numbers"."state" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "wa_numbers_phone_live" ON "wa_numbers" USING btree ("phone_number") WHERE "wa_numbers"."state" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "wa_numbers_branch_live" ON "wa_numbers" USING btree ("tenant_id","branch_id") WHERE "wa_numbers"."branch_id" is not null and "wa_numbers"."state" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "wa_numbers_brand_live" ON "wa_numbers" USING btree ("tenant_id","waba_id") WHERE "wa_numbers"."branch_id" is null and "wa_numbers"."state" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "waba_accounts_one_live" ON "waba_accounts" USING btree ("tenant_id") WHERE "waba_accounts"."state" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "waba_accounts_meta_id" ON "waba_accounts" USING btree ("meta_waba_id") WHERE "waba_accounts"."meta_waba_id" is not null and "waba_accounts"."state" <> 'revoked';--> statement-breakpoint

-- T-089 rules (generated by gen.py; plan docs/tasks/T-089.md)
-- ── T-089 (PR-27, TD-20, TD-21, DATA-38, DATA-57, W-01…W-09; plan Argon 951920bb REVISE adopted, 7341159c APPROVE): helpers, readers'
-- predicates, guards, the tenant key ──

-- RLS predicates (r1 open point 2): owner, admin_pusat, central_cs, marketing, auditor tenant-wide; manager, fo_cashier, bc where the number's
-- branch is allowed or the number is brand-wide. Admin Pusat is not refused here (19:223 Integrasi › WhatsApp is theirs).
CREATE FUNCTION public.waba_accounts_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant)
    AND public.app_acting_role() = ANY (ARRAY['owner','admin_pusat','central_cs','marketing','auditor','manager','fo_cashier','bc']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_accounts_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_accounts_readable(uuid) TO clinic_app;--> statement-breakpoint
CREATE FUNCTION public.wa_numbers_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
           public.app_acting_role() = ANY (ARRAY['owner','admin_pusat','central_cs','marketing','auditor'])
        OR public.app_acting_role() = ANY (ARRAY['manager','fo_cashier','bc']) AND (p_branch IS NULL OR public.app_branch_allowed(p_branch))), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_numbers_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.wa_numbers_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Service-identity audit (r1 P1-3; the payment/package precedent): the webhook path has no staff.
CREATE FUNCTION public.waba_audit_service(p_tenant uuid, p_action text, p_object_kind text, p_object uuid, p_outcome text, p_reason_code text) RETURNS void
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
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'meta_webhook', NULL,
    p_action, p_object_kind, p_object, p_outcome, p_reason_code, NULL,
    coalesce(v_prev, repeat('0', 64)), repeat('0', 64))::public.audit_events;
  v_row.hash := encode(public.digest(v_row.prev_hash || public.audit_canonical(v_row), 'sha256'), 'hex');
  INSERT INTO public.audit_events SELECT v_row.*;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_audit_service(uuid, text, text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint

-- The tenant key for the WABA secrets (r1 P1-1): `tenant_data_key_ensure` (0057) is the registrars' and is not re-created; the onboarding roles
-- store version 1 when the tenant has none and get the winning row back.
CREATE FUNCTION public.waba_data_key_ensure(p_wrapped text) RETURNS TABLE (version integer, wrapped text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not create tenant data keys' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
  BEGIN
    INSERT INTO public.tenant_data_keys (tenant_id, version, wrapped, is_current) VALUES (a.tenant_id, 1, p_wrapped, true) ON CONFLICT DO NOTHING;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: malformed wrapped key' USING ERRCODE = '22023';
  END;
  RETURN QUERY SELECT k.version, k.wrapped FROM public.tenant_data_keys k WHERE k.tenant_id = a.tenant_id AND k.is_current;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_data_key_ensure(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_data_key_ensure(text) TO clinic_app;--> statement-breakpoint

-- Guards (r1 P1-2). WABA: never deleted; identity frozen; a revoked WABA is final. Token: never deleted; the ciphertext frozen; only the revoke
-- columns set once. Numbers: never deleted; identity and the sealed PIN frozen; a revoked number is final; the cap (≤ 2 while the business is not
-- verified, ≤ 20 after) at insert. Routes: never deleted; only deactivated.
CREATE FUNCTION public.waba_accounts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WABA accounts are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.id, NEW.tenant_id, NEW.started_by, NEW.started_as, NEW.started_at, NEW.command_key)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.started_by, OLD.started_as, OLD.started_at, OLD.command_key)
     OR OLD.state = 'revoked') THEN
    RAISE EXCEPTION 'a WABA keeps its identity; a revoked WABA is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_accounts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER waba_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.waba_accounts FOR EACH ROW EXECUTE FUNCTION public.waba_accounts_guard();--> statement-breakpoint
ALTER TABLE public.waba_accounts ENABLE ALWAYS TRIGGER waba_accounts_guard;--> statement-breakpoint

CREATE FUNCTION public.token_vault_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tokens are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'a token is stored unrevoked' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'revoked_at' - 'revoked_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoked_reason')
     OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'a token keeps its value; it is revoked once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.token_vault_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER token_vault_guard BEFORE INSERT OR UPDATE OR DELETE ON public.token_vault FOR EACH ROW EXECUTE FUNCTION public.token_vault_guard();--> statement-breakpoint
ALTER TABLE public.token_vault ENABLE ALWAYS TRIGGER token_vault_guard;--> statement-breakpoint

CREATE FUNCTION public.wa_numbers_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_verified boolean;
  v_live integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WhatsApp numbers are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT w.business_verification_status = 'verified' INTO v_verified FROM public.waba_accounts w WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.waba_id;
    SELECT count(*) INTO v_live FROM public.wa_numbers n WHERE n.tenant_id = NEW.tenant_id AND n.waba_id = NEW.waba_id AND n.state <> 'revoked';
    IF v_live >= (CASE WHEN v_verified THEN 20 ELSE 2 END) THEN
      RAISE EXCEPTION 'the WABA number cap is reached (W-07)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.waba_id, NEW.branch_id, NEW.phone_number, NEW.phone_number_id, NEW.registration_pin_enc, NEW.pin_dek_ref,
      NEW.is_coexistence, NEW.history_sync_enabled, NEW.added_by, NEW.added_as, NEW.added_at, NEW.command_key)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.waba_id, OLD.branch_id, OLD.phone_number, OLD.phone_number_id, OLD.registration_pin_enc, OLD.pin_dek_ref,
      OLD.is_coexistence, OLD.history_sync_enabled, OLD.added_by, OLD.added_as, OLD.added_at, OLD.command_key)
     OR OLD.state = 'revoked' THEN
    RAISE EXCEPTION 'a number keeps its identity and PIN; a revoked number is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_numbers_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER wa_numbers_guard BEFORE INSERT OR UPDATE OR DELETE ON public.wa_numbers FOR EACH ROW EXECUTE FUNCTION public.wa_numbers_guard();--> statement-breakpoint
ALTER TABLE public.wa_numbers ENABLE ALWAYS TRIGGER wa_numbers_guard;--> statement-breakpoint

CREATE FUNCTION public.waba_routes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WABA routes are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - 'active' - 'deactivated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'active' - 'deactivated_at')
       OR NOT OLD.active OR NEW.active) THEN
    RAISE EXCEPTION 'a route keeps its target; it is deactivated once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_routes_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER waba_routes_guard BEFORE UPDATE OR DELETE ON public.waba_routes FOR EACH ROW EXECUTE FUNCTION public.waba_routes_guard();--> statement-breakpoint
ALTER TABLE public.waba_routes ENABLE ALWAYS TRIGGER waba_routes_guard;--> statement-breakpoint

-- The brand of the display names (W-08): SET-1 `nama`, else the legal name.
CREATE FUNCTION public.waba_brand(p_tenant uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(nullif(btrim(public.setting_value_at('SET-1', NULL, clock_timestamp()) ->> 'nama'), ''), (SELECT t.legal_name FROM public.tenants t WHERE t.id = p_tenant))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_brand(uuid) FROM PUBLIC;--> statement-breakpoint

-- The onboarding actor: the lock first; owner or admin_pusat; configuration capability.
CREATE FUNCTION public.waba_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role INTO tenant_id, staff_id, role FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not onboard WhatsApp' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_actor() FROM PUBLIC;--> statement-breakpoint

-- The deployment environment (DEL-3): the mock Graph port is unusable in production (the payment port's rule).
CREATE FUNCTION public.waba_mock_allowed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.payment_deploy_env() <> 'production'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_mock_allowed() FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.waba_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY waba_accounts_read ON public.waba_accounts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.waba_accounts_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.waba_accounts TO clinic_app;--> statement-breakpoint
CREATE POLICY waba_accounts_operator_read ON public.waba_accounts FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.waba_accounts', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.waba_accounts TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.wa_numbers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY wa_numbers_read ON public.wa_numbers FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.wa_numbers_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, waba_id, branch_id, phone_number, phone_number_id, display_name, state, display_name_status, quality_rating, is_coexistence, history_sync_enabled, added_by, added_as, added_at, registered_at, updated_at, revoked_at, command_key) ON public.wa_numbers TO clinic_app;--> statement-breakpoint
CREATE POLICY wa_numbers_operator_read ON public.wa_numbers FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.wa_numbers', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, waba_id, branch_id, phone_number, phone_number_id, display_name, state, display_name_status, quality_rating, is_coexistence, history_sync_enabled, added_by, added_as, added_at, registered_at, updated_at, revoked_at, command_key) ON public.wa_numbers TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.token_vault ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.waba_routes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER waba_accounts_no_truncate BEFORE TRUNCATE ON public.waba_accounts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.waba_accounts ENABLE ALWAYS TRIGGER waba_accounts_no_truncate;--> statement-breakpoint
CREATE TRIGGER wa_numbers_no_truncate BEFORE TRUNCATE ON public.wa_numbers FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.wa_numbers ENABLE ALWAYS TRIGGER wa_numbers_no_truncate;--> statement-breakpoint
CREATE TRIGGER token_vault_no_truncate BEFORE TRUNCATE ON public.token_vault FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.token_vault ENABLE ALWAYS TRIGGER token_vault_no_truncate;--> statement-breakpoint
CREATE TRIGGER waba_routes_no_truncate BEFORE TRUNCATE ON public.waba_routes FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.waba_routes ENABLE ALWAYS TRIGGER waba_routes_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.waba_accounts', 'tenant-shared', 'messaging', '{owner,admin_pusat,central_cs,marketing,auditor,manager,fo_cashier,bc}', 'WABA definers (src/modules/messaging/waba)', 'none (one WABA per tenant)'),
  ('public.wa_numbers', 'tenant-shared', 'messaging', '{owner,admin_pusat,central_cs,marketing,auditor,manager,fo_cashier,bc}', 'WABA definers (src/modules/messaging/waba)', 'the number''s branch, or brand-wide'),
  ('public.token_vault', 'tenant-shared', 'messaging', '{}', 'WABA definers (src/modules/messaging/waba); never read by the app', 'none (server-side only)'),
  ('public.waba_routes', 'platform', 'messaging', '{}', 'waba_register_number; read by waba_route_resolve (the webhook intake)', 'the number''s branch');--> statement-breakpoint
-- Vendor support access (TEN-14, TEN-17, TEN-19; r1 P1-2): the WABA and its numbers are configuration; the token vault is never supportable.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.waba_accounts', 'config'), ('public.wa_numbers', 'config'), ('public.token_vault', 'never');--> statement-breakpoint
-- The revocation notification (TD-21): to the owner, raised by the server (not by staff).
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('waba_revoked', 'Koneksi WhatsApp Business dicabut', '{owner}', '{waba_account}', false);--> statement-breakpoint

-- ── T-089: writers and readers (r1 open points 1–6, P1-3; r2 build notes: the port runs in TS, the definers take its recorded result) ──

-- Mark a WABA's numbers' states from a Graph status (per number: display name status, quality). A number moves registered → display_name_pending
-- → active (approved and not red), quality red → quality_restricted, back to active when green/yellow and approved.
CREATE FUNCTION public.wa_number_next_state(p_state text, p_display text, p_quality text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_state IN ('revoked','number_pending_registration') THEN p_state
              WHEN p_quality = 'red' THEN 'quality_restricted'
              WHEN p_display = 'approved' THEN 'active'
              WHEN p_display = 'none' THEN 'number_registered'
              ELSE 'display_name_pending' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_number_next_state(text, text, text) FROM PUBLIC;--> statement-breakpoint

-- A WABA's own state from its numbers (TD-20): revoked final; verification_required kept until verified; any red number → quality_restricted;
-- any active number → active; any number past registration → display_name_pending / number_registered; else number_pending_registration if a
-- number exists; else the onboarding steps (app_subscribed / token_exchanged).
CREATE FUNCTION public.waba_derive_state(p_tenant uuid, p_waba uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN w.state = 'revoked' THEN 'revoked'
    WHEN w.state = 'verification_required' AND w.business_verification_status <> 'verified' THEN 'verification_required'
    WHEN EXISTS (SELECT 1 FROM public.wa_numbers n WHERE n.tenant_id = w.tenant_id AND n.waba_id = w.id AND n.state = 'quality_restricted') THEN 'quality_restricted'
    WHEN EXISTS (SELECT 1 FROM public.wa_numbers n WHERE n.tenant_id = w.tenant_id AND n.waba_id = w.id AND n.state = 'active') THEN 'active'
    WHEN EXISTS (SELECT 1 FROM public.wa_numbers n WHERE n.tenant_id = w.tenant_id AND n.waba_id = w.id AND n.state = 'display_name_pending') THEN 'display_name_pending'
    WHEN EXISTS (SELECT 1 FROM public.wa_numbers n WHERE n.tenant_id = w.tenant_id AND n.waba_id = w.id AND n.state = 'number_registered') THEN 'number_registered'
    WHEN EXISTS (SELECT 1 FROM public.wa_numbers n WHERE n.tenant_id = w.tenant_id AND n.waba_id = w.id AND n.state = 'number_pending_registration') THEN 'number_pending_registration'
    WHEN w.app_subscribed THEN 'app_subscribed'
    WHEN w.meta_waba_id IS NOT NULL THEN 'token_exchanged'
    ELSE w.state END
  FROM public.waba_accounts w WHERE w.tenant_id = p_tenant AND w.id = p_waba
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_derive_state(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Embedded Signup started (or a BSP fallback chosen, W-09): the tenant's WABA in signup_started. p: {onboarding_channel, bsp_provider?}.
CREATE FUNCTION public.waba_signup_start(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
  v_id uuid;
BEGIN
  SELECT w.id INTO v_id FROM public.waba_accounts w WHERE w.tenant_id = a.tenant_id AND w.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'onboarding_channel' - 'bsp_provider' <> '{}'::jsonb
     OR coalesce(p ->> 'onboarding_channel', '') NOT IN ('cloud_api','bsp_fallback') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: signup' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.waba_accounts w WHERE w.tenant_id = a.tenant_id AND w.state <> 'revoked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: waba_exists' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.waba_accounts (tenant_id, state, onboarding_channel, bsp_provider, started_by, started_as, command_key)
  VALUES (a.tenant_id, 'signup_started', p ->> 'onboarding_channel', NULLIF(btrim(coalesce(p ->> 'bsp_provider', '')), ''), a.staff_id, a.role, p_key)
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'waba_account', v_id, 'success', 'waba_signup_started');
  RETURN v_id;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: signup' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_signup_start(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_signup_start(text, jsonb) TO clinic_app;--> statement-breakpoint

-- The code exchanged and the app subscribed (TD-20 acceptance): the sealed token stored, the WABA facts recorded. p: {encrypted_token, dek_ref,
-- token_kind, granted_scopes[], meta_waba_id, meta_business_id, business_verification_status, portfolio_messaging_limit, app_subscribed}.
CREATE FUNCTION public.waba_complete_signup(p_waba uuid, p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
  w public.waba_accounts;
  v_now timestamptz;
BEGIN
  IF NOT public.waba_mock_allowed() THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: live_graph_not_configured' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO w FROM public.waba_accounts x WHERE x.tenant_id = a.tenant_id AND x.id = p_waba FOR UPDATE;
  IF w.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: waba not found' USING ERRCODE = 'P0002';
  END IF;
  IF w.state NOT IN ('signup_started','token_exchanged') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_in_signup' USING ERRCODE = '55000';
  END IF;
  -- exactly this key set (failure-close2): a stray field (a plaintext token) is refused, never stored or logged
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p -> 'granted_scopes') IS DISTINCT FROM 'array' OR jsonb_typeof(p -> 'app_subscribed') IS DISTINCT FROM 'boolean'
     OR p - 'encrypted_token' - 'dek_ref' - 'token_kind' - 'granted_scopes' - 'meta_waba_id' - 'meta_business_id' - 'business_verification_status'
          - 'portfolio_messaging_limit' - 'app_subscribed' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: signup_result' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  UPDATE public.token_vault SET revoked_at = v_now, revoked_reason = 'replaced' WHERE tenant_id = w.tenant_id AND waba_id = w.id AND revoked_at IS NULL;
  INSERT INTO public.token_vault (tenant_id, waba_id, token_kind, granted_scopes, encrypted_token, dek_ref, created_at)
  VALUES (w.tenant_id, w.id, p ->> 'token_kind', ARRAY(SELECT jsonb_array_elements_text(p -> 'granted_scopes')), p ->> 'encrypted_token', p ->> 'dek_ref', v_now);
  UPDATE public.waba_accounts SET meta_waba_id = p ->> 'meta_waba_id', meta_business_id = p ->> 'meta_business_id',
         business_verification_status = p ->> 'business_verification_status', portfolio_messaging_limit = (p ->> 'portfolio_messaging_limit')::integer,
         app_subscribed = (p ->> 'app_subscribed')::boolean, updated_at = v_now,
         state = CASE WHEN (p ->> 'app_subscribed')::boolean THEN 'app_subscribed' ELSE 'token_exchanged' END
   WHERE tenant_id = w.tenant_id AND id = w.id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (w.tenant_id, NULL, 'WabaConnected', 'waba_account', w.id, a.staff_id, a.role, v_now, jsonb_build_object('waba_id', w.id));
  PERFORM public.audit_append('settings_change', 'waba_account', w.id, 'success', 'waba_connected');
  RETURN (SELECT x.state FROM public.waba_accounts x WHERE x.tenant_id = w.tenant_id AND x.id = w.id);
EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: signup_result' USING ERRCODE = '22023';
WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_VERSION_CONFLICT: waba_taken' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_complete_signup(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_complete_signup(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Add a number (step 1 of 2): the cap (W-07) — while the business is not verified and two numbers live, the WABA COMMITS verification_required
-- (r1 P1-3; scenario PR-27) and the reply says so, no row and no register call; else the number is inserted pending registration with its sealed
-- PIN and the display name `Brand – Branch` / `Brand` (W-08). p: {branch_id?, phone_number, phone_number_id, is_coexistence?, history_sync_enabled?,
-- registration_pin_enc, pin_dek_ref}.
CREATE FUNCTION public.waba_add_number(p_key text, p_waba uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
  w public.waba_accounts;
  v_id uuid;
  v_branch uuid;
  v_name text;
  v_live integer;
  v_now timestamptz;
BEGIN
  SELECT n.id INTO v_id FROM public.wa_numbers n WHERE n.tenant_id = a.tenant_id AND n.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN (SELECT jsonb_build_object('ok', true, 'replayed', true, 'wa_number_id', n.id, 'state', n.state, 'phone_number_id', n.phone_number_id,
                    'phone_number', n.phone_number, 'display_name', n.display_name, 'is_coexistence', n.is_coexistence, 'history_sync_enabled', n.history_sync_enabled)
              FROM public.wa_numbers n WHERE n.tenant_id = a.tenant_id AND n.id = v_id);
  END IF;
  SELECT * INTO w FROM public.waba_accounts x WHERE x.tenant_id = a.tenant_id AND x.id = p_waba FOR UPDATE;
  IF w.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: waba not found' USING ERRCODE = 'P0002';
  END IF;
  IF w.state IN ('not_connected','signup_started','token_exchanged','revoked') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: waba_not_ready' USING ERRCODE = '55000';
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'branch_id' - 'phone_number' - 'phone_number_id' - 'is_coexistence' - 'history_sync_enabled' - 'registration_pin_enc' - 'pin_dek_ref' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: number' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch := NULLIF(p ->> 'branch_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: branch' USING ERRCODE = '22023';
  END;
  IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := clock_timestamp();
  SELECT count(*) INTO v_live FROM public.wa_numbers n WHERE n.tenant_id = w.tenant_id AND n.waba_id = w.id AND n.state <> 'revoked';
  IF w.business_verification_status <> 'verified' AND v_live >= 2 THEN
    UPDATE public.waba_accounts SET previous_state = CASE WHEN state = 'verification_required' THEN previous_state ELSE state END,
           state = 'verification_required', updated_at = v_now WHERE tenant_id = w.tenant_id AND id = w.id;
    PERFORM public.audit_append('access_denied', 'waba_account', w.id, 'denied', 'verification_required');
    RETURN jsonb_build_object('ok', false, 'code', 'verification_required', 'waba_state', 'verification_required',
      'message', 'Selesaikan verifikasi bisnis Meta terlebih dahulu untuk menambah lebih dari 2 nomor WhatsApp.');
  END IF;
  IF v_live >= 20 THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: number_cap' USING ERRCODE = '55000';
  END IF;
  v_name := public.waba_brand(w.tenant_id) || CASE WHEN v_branch IS NULL THEN '' ELSE ' – ' || (SELECT b.name FROM public.branches b WHERE b.tenant_id = w.tenant_id AND b.id = v_branch) END;
  INSERT INTO public.wa_numbers (tenant_id, waba_id, branch_id, phone_number, phone_number_id, display_name, is_coexistence, history_sync_enabled,
                                 registration_pin_enc, pin_dek_ref, added_by, added_as, added_at, updated_at, command_key)
  VALUES (w.tenant_id, w.id, v_branch, p ->> 'phone_number', p ->> 'phone_number_id', v_name, coalesce((p ->> 'is_coexistence')::boolean, false),
          coalesce((p ->> 'history_sync_enabled')::boolean, false), p ->> 'registration_pin_enc', p ->> 'pin_dek_ref', a.staff_id, a.role, v_now, v_now, p_key)
  RETURNING id INTO v_id;
  UPDATE public.waba_accounts SET state = public.waba_derive_state(tenant_id, id), updated_at = v_now WHERE tenant_id = w.tenant_id AND id = w.id;
  PERFORM public.audit_append('settings_change', 'wa_number', v_id, 'success', 'wa_number_added');
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'wa_number_id', v_id, 'state', 'number_pending_registration', 'phone_number_id', p ->> 'phone_number_id',
    'phone_number', p ->> 'phone_number', 'display_name', v_name, 'is_coexistence', coalesce((p ->> 'is_coexistence')::boolean, false),
    'history_sync_enabled', coalesce((p ->> 'history_sync_enabled')::boolean, false), 'meta_waba_id', w.meta_waba_id);
EXCEPTION WHEN check_violation OR invalid_text_representation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: number' USING ERRCODE = '22023';
WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_VERSION_CONFLICT: number_taken' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_add_number(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_add_number(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Register a number (step 2 of 2): the recorded Graph register result applied; the route written (DATA-57). p: {registered, verified_name?,
-- display_name_status, quality_rating}.
CREATE FUNCTION public.waba_register_number(p_number uuid, p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
  n public.wa_numbers;
  w public.waba_accounts;
  v_now timestamptz;
BEGIN
  IF NOT public.waba_mock_allowed() THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: live_graph_not_configured' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO n FROM public.wa_numbers x WHERE x.tenant_id = a.tenant_id AND x.id = p_number FOR UPDATE;
  IF n.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: number not found' USING ERRCODE = 'P0002';
  END IF;
  IF n.state <> 'number_pending_registration' THEN
    RETURN n.state; -- replay: already registered
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (p ->> 'registered') IS DISTINCT FROM 'true'
     OR p - 'registered' - 'verified_name' - 'display_name_status' - 'quality_rating' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: register_result' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO w FROM public.waba_accounts x WHERE x.tenant_id = n.tenant_id AND x.id = n.waba_id FOR UPDATE;
  v_now := clock_timestamp();
  UPDATE public.wa_numbers SET registered_at = v_now, updated_at = v_now, display_name_status = p ->> 'display_name_status', quality_rating = p ->> 'quality_rating',
         state = public.wa_number_next_state('number_registered', p ->> 'display_name_status', p ->> 'quality_rating')
   WHERE tenant_id = n.tenant_id AND id = n.id;
  INSERT INTO public.waba_routes (phone_number_id, meta_waba_id, tenant_id, waba_id, wa_number_id, branch_id, created_at)
  VALUES (n.phone_number_id, w.meta_waba_id, n.tenant_id, n.waba_id, n.id, n.branch_id, v_now);
  UPDATE public.waba_accounts SET state = public.waba_derive_state(tenant_id, id), updated_at = v_now WHERE tenant_id = w.tenant_id AND id = w.id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (n.tenant_id, n.branch_id, 'WabaNumberRegistered', 'wa_number', n.id, a.staff_id, a.role, v_now, jsonb_build_object('wa_number_id', n.id, 'waba_id', n.waba_id));
  PERFORM public.audit_append('settings_change', 'wa_number', n.id, 'success', 'wa_number_registered');
  RETURN (SELECT x.state FROM public.wa_numbers x WHERE x.tenant_id = n.tenant_id AND x.id = n.id);
EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: register_result' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_register_number(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_register_number(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Sync the WABA's status from a recorded Graph read: verification (verified recovers verification_required to the derived state), the portfolio
-- limit, each number's display name and quality. p: {business_verification_status, portfolio_messaging_limit, numbers: {<phone_number_id>:
-- {display_name_status, quality_rating}}}.
CREATE FUNCTION public.waba_sync_status(p_waba uuid, p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
  w public.waba_accounts;
  v_now timestamptz;
  v_k text;
  v_v jsonb;
BEGIN
  IF NOT public.waba_mock_allowed() THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: live_graph_not_configured' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO w FROM public.waba_accounts x WHERE x.tenant_id = a.tenant_id AND x.id = p_waba FOR UPDATE;
  IF w.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: waba not found' USING ERRCODE = 'P0002';
  END IF;
  IF w.state = 'revoked' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: waba_revoked' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(coalesce(p -> 'numbers', '{}'::jsonb)) IS DISTINCT FROM 'object'
     OR p - 'business_verification_status' - 'portfolio_messaging_limit' - 'numbers' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: status' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  UPDATE public.waba_accounts SET business_verification_status = coalesce(p ->> 'business_verification_status', business_verification_status),
         portfolio_messaging_limit = coalesce((p ->> 'portfolio_messaging_limit')::integer, portfolio_messaging_limit), updated_at = v_now
   WHERE tenant_id = w.tenant_id AND id = w.id;
  FOR v_k, v_v IN SELECT * FROM jsonb_each(coalesce(p -> 'numbers', '{}'::jsonb)) LOOP
    UPDATE public.wa_numbers SET display_name_status = coalesce(v_v ->> 'display_name_status', display_name_status),
           quality_rating = coalesce(v_v ->> 'quality_rating', quality_rating), updated_at = v_now,
           state = public.wa_number_next_state(state, coalesce(v_v ->> 'display_name_status', display_name_status), coalesce(v_v ->> 'quality_rating', quality_rating))
     WHERE tenant_id = w.tenant_id AND waba_id = w.id AND phone_number_id = v_k AND state <> 'revoked';
  END LOOP;
  UPDATE public.waba_accounts SET state = public.waba_derive_state(tenant_id, id),
         previous_state = CASE WHEN state = 'verification_required' AND business_verification_status = 'verified' THEN NULL ELSE previous_state END
   WHERE tenant_id = w.tenant_id AND id = w.id;
  PERFORM public.audit_append('settings_change', 'waba_account', w.id, 'success', 'waba_status_synced');
  RETURN (SELECT x.state FROM public.waba_accounts x WHERE x.tenant_id = w.tenant_id AND x.id = w.id);
EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: status' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_sync_status(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_sync_status(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- BSP fallback → Cloud API (W-09, TD-27): the BSP token revoked, the Cloud API token stored, every id and route kept. p: as waba_complete_signup.
CREATE FUNCTION public.waba_migrate_to_cloud_api(p_waba uuid, p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
  w public.waba_accounts;
  v_now timestamptz;
BEGIN
  IF NOT public.waba_mock_allowed() THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: live_graph_not_configured' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO w FROM public.waba_accounts x WHERE x.tenant_id = a.tenant_id AND x.id = p_waba FOR UPDATE;
  IF w.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: waba not found' USING ERRCODE = 'P0002';
  END IF;
  IF w.onboarding_channel <> 'bsp_fallback' OR w.state = 'revoked' THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: not_bsp' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p -> 'granted_scopes') IS DISTINCT FROM 'array' OR (p ->> 'meta_waba_id') IS DISTINCT FROM w.meta_waba_id
     OR p - 'encrypted_token' - 'dek_ref' - 'token_kind' - 'granted_scopes' - 'meta_waba_id' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: migration_result' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  UPDATE public.token_vault SET revoked_at = v_now, revoked_reason = 'migrated' WHERE tenant_id = w.tenant_id AND waba_id = w.id AND revoked_at IS NULL;
  INSERT INTO public.token_vault (tenant_id, waba_id, token_kind, granted_scopes, encrypted_token, dek_ref, created_at)
  VALUES (w.tenant_id, w.id, p ->> 'token_kind', ARRAY(SELECT jsonb_array_elements_text(p -> 'granted_scopes')), p ->> 'encrypted_token', p ->> 'dek_ref', v_now);
  UPDATE public.waba_accounts SET onboarding_channel = 'cloud_api', bsp_provider = NULL, updated_at = v_now WHERE tenant_id = w.tenant_id AND id = w.id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (w.tenant_id, NULL, 'WabaMigratedToCloudApi', 'waba_account', w.id, a.staff_id, a.role, v_now, jsonb_build_object('waba_id', w.id));
  PERFORM public.audit_append('settings_change', 'waba_account', w.id, 'success', 'waba_migrated_cloud_api');
  RETURN 'cloud_api';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: migration_result' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_migrate_to_cloud_api(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_migrate_to_cloud_api(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Revocation core (TD-21): every live token revoked, the WABA and its numbers revoked, routes deactivated, WabaRevoked, the owner notified.
CREATE FUNCTION public.waba_revoke_do(p_tenant uuid, p_waba uuid, p_reason text, p_staff uuid, p_role text, p_now timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_event uuid := public.uuid_generate_v7();
BEGIN
  UPDATE public.token_vault SET revoked_at = p_now, revoked_reason = p_reason WHERE tenant_id = p_tenant AND waba_id = p_waba AND revoked_at IS NULL;
  UPDATE public.wa_numbers SET state = 'revoked', revoked_at = p_now, updated_at = p_now WHERE tenant_id = p_tenant AND waba_id = p_waba AND state <> 'revoked';
  UPDATE public.waba_routes SET active = false, deactivated_at = p_now WHERE tenant_id = p_tenant AND waba_id = p_waba AND active;
  UPDATE public.waba_accounts SET state = 'revoked', revoked_at = p_now, updated_at = p_now WHERE tenant_id = p_tenant AND id = p_waba;
  INSERT INTO public.domain_events (id, tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (v_event, p_tenant, NULL, 'WabaRevoked', 'waba_account', p_waba, p_staff, p_role, p_now, jsonb_build_object('waba_id', p_waba, 'reason', p_reason));
  INSERT INTO public.notifications (tenant_id, type, recipient_role, branch_id, subject_kind, subject_id, source_event_id)
  VALUES (p_tenant, 'waba_revoked', 'owner', NULL, 'waba_account', p_waba, v_event);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_revoke_do(uuid, uuid, text, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Revoke interactively (owner, admin_pusat).
CREATE FUNCTION public.waba_revoke(p_waba uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
  w public.waba_accounts;
BEGIN
  SELECT * INTO w FROM public.waba_accounts x WHERE x.tenant_id = a.tenant_id AND x.id = p_waba FOR UPDATE;
  IF w.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: waba not found' USING ERRCODE = 'P0002';
  END IF;
  IF w.state = 'revoked' THEN
    RETURN;
  END IF;
  IF coalesce(p_reason, '') !~ '^[a-z][a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reason' USING ERRCODE = '22023';
  END IF;
  PERFORM public.waba_revoke_do(w.tenant_id, w.id, p_reason, a.staff_id, a.role, clock_timestamp());
  PERFORM public.audit_append('settings_change', 'waba_account', w.id, 'success', 'waba_revoked');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_revoke(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_revoke(uuid, text) TO clinic_app;--> statement-breakpoint

-- The webhook account update (TD-21; T-090's intake calls it on an unbound connection): resolve the tenant by the Meta WABA id; partner_removed /
-- account_revoked revoke; quality_update / verification_update record the fact. A bound (staff) connection is refused.
CREATE FUNCTION public.waba_webhook_account_update(p_meta_waba_id text, p_event text, p_detail jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  w public.waba_accounts;
  v_now timestamptz;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the webhook path is unbound' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM public.waba_accounts x WHERE x.meta_waba_id = p_meta_waba_id AND x.state <> 'revoked';
  IF w.id IS NULL THEN
    RETURN 'unknown';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || w.tenant_id::text, 0));
  SELECT * INTO w FROM public.waba_accounts x WHERE x.tenant_id = w.tenant_id AND x.id = w.id FOR UPDATE;
  IF w.state = 'revoked' THEN
    RETURN 'duplicate';
  END IF;
  v_now := clock_timestamp();
  IF p_event IN ('partner_removed','account_revoked') THEN
    PERFORM public.waba_revoke_do(w.tenant_id, w.id, p_event, NULL, NULL, v_now);
    PERFORM public.waba_audit_service(w.tenant_id, 'settings_change', 'waba_account', w.id, 'success', 'waba_revoked');
    RETURN 'revoked';
  ELSIF p_event = 'verification_update' AND coalesce(p_detail ->> 'business_verification_status', '') IN ('unverified','pending','verified') THEN
    UPDATE public.waba_accounts SET business_verification_status = p_detail ->> 'business_verification_status', updated_at = v_now WHERE tenant_id = w.tenant_id AND id = w.id;
    UPDATE public.waba_accounts SET state = public.waba_derive_state(tenant_id, id),
           previous_state = CASE WHEN state = 'verification_required' AND business_verification_status = 'verified' THEN NULL ELSE previous_state END
     WHERE tenant_id = w.tenant_id AND id = w.id;
    PERFORM public.waba_audit_service(w.tenant_id, 'settings_change', 'waba_account', w.id, 'success', 'waba_verification_updated');
    RETURN 'recorded';
  ELSIF p_event = 'quality_update' AND coalesce(p_detail ->> 'quality_rating', '') IN ('unknown','green','yellow','red') THEN
    UPDATE public.wa_numbers SET quality_rating = p_detail ->> 'quality_rating', updated_at = v_now,
           state = public.wa_number_next_state(state, display_name_status, p_detail ->> 'quality_rating')
     WHERE tenant_id = w.tenant_id AND waba_id = w.id AND phone_number_id = p_detail ->> 'phone_number_id' AND state <> 'revoked';
    UPDATE public.waba_accounts SET state = public.waba_derive_state(tenant_id, id), updated_at = v_now WHERE tenant_id = w.tenant_id AND id = w.id;
    PERFORM public.waba_audit_service(w.tenant_id, 'settings_change', 'waba_account', w.id, 'success', 'waba_quality_updated');
    RETURN 'recorded';
  END IF;
  RAISE EXCEPTION 'ERR_INVALID_INPUT: event' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_webhook_account_update(text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_webhook_account_update(text, text, jsonb) TO clinic_app;--> statement-breakpoint

-- The webhook route (DATA-57; T-090): a Meta phone number id → its tenant, number and branch (active routes only); unbound connections only.
CREATE FUNCTION public.waba_route_resolve(p_phone_number_id text) RETURNS TABLE (tenant_id uuid, waba_id uuid, wa_number_id uuid, branch_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the webhook path is unbound' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT r.tenant_id, r.waba_id, r.wa_number_id, r.branch_id FROM public.waba_routes r WHERE r.phone_number_id = p_phone_number_id AND r.active;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_route_resolve(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_route_resolve(text) TO clinic_app;--> statement-breakpoint

-- Readers: the WABA's status (metadata only: never a ciphertext) with the daily outbound budget (SET-21, default 80 % of the portfolio limit;
-- TD-25, for T-094) and its numbers (the branch-scoped roles see brand-wide and their allowed branches' numbers).
CREATE FUNCTION public.waba_status() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  w public.waba_accounts;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role INTO a FROM public.tenant_actor_lock() x;
  IF NOT public.waba_accounts_readable(a.tenant_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read WhatsApp' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM public.waba_accounts x WHERE x.tenant_id = a.tenant_id ORDER BY (x.state = 'revoked'), x.started_at DESC LIMIT 1;
  IF w.id IS NULL THEN
    RETURN jsonb_build_object('role', a.role, 'can_manage', a.role IN ('owner','admin_pusat'), 'waba', NULL, 'numbers', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('role', a.role, 'can_manage', a.role IN ('owner','admin_pusat'),
    'waba', jsonb_build_object('id', w.id, 'state', w.state, 'onboarding_channel', w.onboarding_channel, 'bsp_provider', w.bsp_provider,
      'meta_waba_id', w.meta_waba_id, 'business_verification_status', w.business_verification_status, 'portfolio_messaging_limit', w.portfolio_messaging_limit,
      'daily_outbound_budget', floor(w.portfolio_messaging_limit * coalesce((public.setting_value_at('SET-21', NULL, clock_timestamp()) #>> '{}')::numeric, 80) / 100.0)::integer,
      'app_subscribed', w.app_subscribed, 'revoked_at', w.revoked_at,
      'has_active_token', EXISTS (SELECT 1 FROM public.token_vault t WHERE t.tenant_id = w.tenant_id AND t.waba_id = w.id AND t.revoked_at IS NULL),
      'token_kind', (SELECT t.token_kind FROM public.token_vault t WHERE t.tenant_id = w.tenant_id AND t.waba_id = w.id AND t.revoked_at IS NULL),
      'granted_scopes', (SELECT to_jsonb(t.granted_scopes) FROM public.token_vault t WHERE t.tenant_id = w.tenant_id AND t.waba_id = w.id AND t.revoked_at IS NULL),
      'sending_allowed', w.state IN ('active','quality_restricted','display_name_pending')
        OR (w.state = 'verification_required' AND w.previous_state IN ('active','quality_restricted','display_name_pending'))),
    'numbers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'branch_id', n.branch_id, 'phone_number', n.phone_number, 'phone_number_id', n.phone_number_id,
                 'display_name', n.display_name, 'state', n.state, 'display_name_status', n.display_name_status, 'quality_rating', n.quality_rating,
                 'is_coexistence', n.is_coexistence, 'history_sync_enabled', n.history_sync_enabled, 'has_pin', true) ORDER BY n.added_at, n.id)
               FROM public.wa_numbers n WHERE n.tenant_id = w.tenant_id AND n.waba_id = w.id AND public.wa_numbers_readable(n.tenant_id, n.branch_id)), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_status() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_status() TO clinic_app;
--> statement-breakpoint

-- The sealed token for a port call (server code only; owner/admin_pusat; configuration): the live token's ciphertext and DEK reference, which the
-- server decrypts in memory for the Graph call and never returns to a client. Not a reader of any screen (build note: the port needs the token
-- for register and status calls after the signup; the vault stays ungranted).
CREATE FUNCTION public.waba_sealed_token(p_waba uuid) RETURNS TABLE (encrypted_token text, dek_ref text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.waba_accounts w WHERE w.tenant_id = a.tenant_id AND w.id = p_waba AND w.state <> 'revoked') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: waba not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY SELECT t.encrypted_token, t.dek_ref FROM public.token_vault t WHERE t.tenant_id = a.tenant_id AND t.waba_id = p_waba AND t.revoked_at IS NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_sealed_token(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_sealed_token(uuid) TO clinic_app;
--> statement-breakpoint

-- The sealed two-step PIN of a number still pending registration (server code only; owner/admin_pusat; configuration): a replayed add retries the
-- register call with the PIN that was stored, never a new one. Not a screen reader (the PIN columns stay ungranted).
CREATE FUNCTION public.waba_sealed_pin(p_number uuid) RETURNS TABLE (registration_pin_enc text, pin_dek_ref text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.waba_actor();
BEGIN
  RETURN QUERY SELECT n.registration_pin_enc, n.pin_dek_ref FROM public.wa_numbers n
   WHERE n.tenant_id = a.tenant_id AND n.id = p_number AND n.state = 'number_pending_registration';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waba_sealed_pin(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.waba_sealed_pin(uuid) TO clinic_app;
