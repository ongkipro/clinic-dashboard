CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waba_id" uuid NOT NULL,
	"wa_number_id" uuid NOT NULL,
	"branch_id" uuid,
	"contact_wa_id" text NOT NULL,
	"contact_name_enc" text,
	"contact_name_dek_ref" text,
	"patient_id" uuid,
	"assignee_staff_id" uuid,
	"assigned_at" timestamp with time zone,
	"state" text DEFAULT 'open' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"window_expires_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "conversations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "conversations_contact_key" UNIQUE("tenant_id","wa_number_id","contact_wa_id"),
	CONSTRAINT "conversations_check" CHECK ("conversations"."contact_wa_id" ~ '^[1-9][0-9]{7,14}$' and "conversations"."state" in ('open','closed')
      and (("conversations"."contact_name_enc" is null) = ("conversations"."contact_name_dek_ref" is null))
      and ("conversations"."contact_name_enc" is null or ("conversations"."contact_name_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and "conversations"."contact_name_dek_ref" ~ '^dek:v[1-9][0-9]{0,8}$'))
      and (("conversations"."last_inbound_at" is null) = ("conversations"."window_expires_at" is null))
      and ("conversations"."last_inbound_at" is null or "conversations"."window_expires_at" = "conversations"."last_inbound_at" + interval '24 hours')
      and (("conversations"."assignee_staff_id" is null) = ("conversations"."assigned_at" is null))
      and cardinality("conversations"."labels") <= 10)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"sent_via" text DEFAULT 'cloud_api' NOT NULL,
	"kind" text NOT NULL,
	"body_enc" text,
	"body_dek_ref" text,
	"template_id" uuid,
	"template_category" text,
	"media_meta_id" text,
	"media_mime_type" text,
	"provider_message_id" text,
	"status" text NOT NULL,
	"provider_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"author_staff_id" uuid,
	"author_as" text,
	"command_key" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "messages_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "messages_check" CHECK ("messages"."direction" in ('in','out') and "messages"."kind" in ('text','template','media')
      and "messages"."status" in ('received','queued','sent','delivered','read','failed') and "messages"."sent_via" in ('cloud_api','business_app')
      and (("messages"."body_enc" is null) = ("messages"."body_dek_ref" is null)) and ("messages"."body_enc" is null or ("messages"."body_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and "messages"."body_dek_ref" ~ '^dek:v[1-9][0-9]{0,8}$'))
      and (("messages"."kind" = 'template') = ("messages"."template_id" is not null)) and (("messages"."template_id" is null) = ("messages"."template_category" is null))
      and (("messages"."kind" = 'media') = ("messages"."media_meta_id" is not null)) and ("messages"."media_meta_id" is null or "messages"."media_meta_id" !~* '^https?://')
      and ("messages"."kind" <> 'text' or "messages"."body_enc" is not null)
      and (("messages"."direction" = 'in') = ("messages"."status" = 'received')) and ("messages"."direction" = 'out' or "messages"."sent_via" = 'cloud_api')
      and ("messages"."direction" = 'in' or "messages"."sent_via" = 'business_app' or "messages"."author_staff_id" is not null)
      and (("messages"."author_staff_id" is null) = ("messages"."author_as" is null))
      and ("messages"."status" in ('received','queued') or "messages"."provider_message_id" is not null)
      and ("messages"."command_key" is null or "messages"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'))
);
--> statement-breakpoint
CREATE TABLE "meta_webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"phone_number_id" text,
	"tenant_id" uuid,
	"signature_ok" boolean NOT NULL,
	"state" text NOT NULL,
	"body_sha256" text NOT NULL,
	"raw_payload_enc" text,
	"payload_dek_ref" text,
	"target_message_id" text,
	"observed_status" text,
	"status_at" timestamp with time zone,
	"error_code" text,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "meta_webhook_receipts_check" CHECK (length("meta_webhook_receipts"."provider_event_id") between 1 and 200 and "meta_webhook_receipts"."body_sha256" ~ '^[0-9a-f]{64}$'
      and "meta_webhook_receipts"."state" in ('received','processed','held_out_of_order','duplicate','rejected_signature','dropped_unknown_route') and "meta_webhook_receipts"."kind" in ('message','status','unknown')
      and ("meta_webhook_receipts"."signature_ok" or "meta_webhook_receipts"."state" = 'rejected_signature')
      and (("meta_webhook_receipts"."raw_payload_enc" is null) = ("meta_webhook_receipts"."payload_dek_ref" is null))
      and ("meta_webhook_receipts"."raw_payload_enc" is null or ("meta_webhook_receipts"."tenant_id" is not null and "meta_webhook_receipts"."raw_payload_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and "meta_webhook_receipts"."payload_dek_ref" ~ '^dek:v[1-9][0-9]{0,8}$'))
      and ("meta_webhook_receipts"."state" not in ('rejected_signature','dropped_unknown_route') or "meta_webhook_receipts"."raw_payload_enc" is null)
      and ("meta_webhook_receipts"."observed_status" is null or "meta_webhook_receipts"."observed_status" in ('sent','delivered','read','failed'))
      and ("meta_webhook_receipts"."error_code" is null or "meta_webhook_receipts"."error_code" ~ '^[a-z][a-z_]{1,60}$'))
);
--> statement-breakpoint
CREATE TABLE "wa_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waba_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'id' NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"body" text NOT NULL,
	"param_count" integer DEFAULT 0 NOT NULL,
	"saved_by" uuid,
	"saved_as" text,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"command_key" text NOT NULL,
	CONSTRAINT "wa_templates_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "wa_templates_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "wa_templates_name_key" UNIQUE("tenant_id","waba_id","name","language"),
	CONSTRAINT "wa_templates_check" CHECK ("wa_templates"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "wa_templates"."name" ~ '^[a-z][a-z0-9_]{1,127}$' and "wa_templates"."language" ~ '^[a-z]{2}(_[A-Z]{2})?$'
      and "wa_templates"."category" in ('utility','marketing','authentication') and "wa_templates"."status" in ('draft','pending','approved','rejected')
      and length(btrim("wa_templates"."body")) between 1 and 1024 and "wa_templates"."param_count" between 0 and 10
      and (("wa_templates"."saved_by" is null) = ("wa_templates"."saved_as" is null)))
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_waba_id_waba_accounts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","waba_id") REFERENCES "public"."waba_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_wa_number_id_wa_numbers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","wa_number_id") REFERENCES "public"."wa_numbers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_assignee_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","assignee_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_conversation_id_conversations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_template_id_wa_templates_tenant_id_id_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."wa_templates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_author_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","author_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_webhook_receipts" ADD CONSTRAINT "meta_webhook_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_templates" ADD CONSTRAINT "wa_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_templates" ADD CONSTRAINT "wa_templates_tenant_id_waba_id_waba_accounts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","waba_id") REFERENCES "public"."waba_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_templates" ADD CONSTRAINT "wa_templates_tenant_id_saved_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","saved_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_id" ON "messages" USING btree ("provider_message_id") WHERE "messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_command_key" ON "messages" USING btree ("tenant_id","command_key") WHERE "messages"."command_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_webhook_receipts_verified_key" ON "meta_webhook_receipts" USING btree ("provider_event_id","kind") WHERE "meta_webhook_receipts"."signature_ok" and "meta_webhook_receipts"."state" in ('received','processed','held_out_of_order');--> statement-breakpoint

-- T-090 rules (generated by gen.py; plan docs/tasks/T-090.md)
-- ── T-090 (PR-28, TD-22, TD-24, TD-25 part, W-05, W-10, DATA-38; plan Argon 92626f3c REVISE adopted, 3688a6e2 APPROVE): predicates, keys,
-- the sealed token for senders, guards ──

-- RLS predicates (r1 open point 4). Threads: owner, central_cs tenant-wide; manager, fo_cashier, bc where the conversation's branch is allowed
-- or not yet routed (brand-wide). Templates: the inbox roles, admin_pusat, marketing, auditor.
CREATE FUNCTION public.inbox_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
           public.app_acting_role() = ANY (ARRAY['owner','central_cs'])
        OR public.app_acting_role() = ANY (ARRAY['manager','fo_cashier','bc']) AND (p_branch IS NULL OR public.app_branch_allowed(p_branch))), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint
CREATE FUNCTION public.wa_templates_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant)
    AND public.app_acting_role() = ANY (ARRAY['owner','admin_pusat','marketing','central_cs','manager','fo_cashier','bc','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_templates_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.wa_templates_readable(uuid) TO clinic_app;--> statement-breakpoint

-- The webhook path's tenant keys (r1 P1-1): an unbound connection only, for a tenant with an active route; stores version 1 when the tenant has
-- none (the candidate is wrapped by the app). Never returns another tenant's keys.
CREATE FUNCTION public.inbox_webhook_keys(p_tenant uuid, p_wrapped text DEFAULT NULL) RETURNS TABLE (version integer, wrapped text, is_current boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the webhook path is unbound' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waba_routes r WHERE r.tenant_id = p_tenant AND r.active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: no active route' USING ERRCODE = 'P0002';
  END IF;
  IF p_wrapped IS NOT NULL THEN
    BEGIN
      INSERT INTO public.tenant_data_keys (tenant_id, version, wrapped, is_current) VALUES (p_tenant, 1, p_wrapped, true) ON CONFLICT DO NOTHING;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: malformed wrapped key' USING ERRCODE = '22023';
    END;
  END IF;
  RETURN QUERY SELECT k.version, k.wrapped, k.is_current FROM public.tenant_data_keys k WHERE k.tenant_id = p_tenant ORDER BY k.version;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_webhook_keys(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_webhook_keys(uuid, text) TO clinic_app;--> statement-breakpoint

-- The inbox and template roles' tenant key (r1 P1-1): `tenant_data_key_ensure` (0057) and `waba_data_key_ensure` (0104) are not re-created.
CREATE FUNCTION public.inbox_data_key_ensure(p_wrapped text) RETURNS TABLE (version integer, wrapped text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['owner','admin_pusat','marketing','central_cs','manager','fo_cashier','bc']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not create tenant data keys' USING ERRCODE = '42501';
  END IF;
  BEGIN
    INSERT INTO public.tenant_data_keys (tenant_id, version, wrapped, is_current) VALUES (a.tenant_id, 1, p_wrapped, true) ON CONFLICT DO NOTHING;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: malformed wrapped key' USING ERRCODE = '22023';
  END;
  RETURN QUERY SELECT k.version, k.wrapped FROM public.tenant_data_keys k WHERE k.tenant_id = a.tenant_id AND k.is_current;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_data_key_ensure(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_data_key_ensure(text) TO clinic_app;--> statement-breakpoint

-- Whether a WABA and number may send now (r2 P3-1, aligned with T-089 freeze-r2): a sending state (or verification_required after one) and a
-- live token.
CREATE FUNCTION public.inbox_can_send(p_tenant uuid, p_waba uuid, p_number uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.waba_accounts w JOIN public.wa_numbers n ON n.tenant_id = w.tenant_id AND n.waba_id = w.id
     WHERE w.tenant_id = p_tenant AND w.id = p_waba AND n.id = p_number
       AND (w.state IN ('active','quality_restricted','display_name_pending','number_registered')
            OR (w.state = 'verification_required' AND w.previous_state IN ('active','quality_restricted','display_name_pending','number_registered')))
       AND n.state IN ('active','quality_restricted','display_name_pending','number_registered')
       AND EXISTS (SELECT 1 FROM public.token_vault t WHERE t.tenant_id = w.tenant_id AND t.waba_id = w.id AND t.revoked_at IS NULL))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_can_send(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The sealed token for an inbox send (r1 P1-1; server code only): the sending roles, a sendable WABA. Never a screen reader.
CREATE FUNCTION public.inbox_sealed_token(p_waba uuid) RETURNS TABLE (encrypted_token text, dek_ref text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (ARRAY['central_cs','fo_cashier','bc','manager','owner','admin_pusat','marketing']) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not send WhatsApp' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waba_accounts w WHERE w.tenant_id = a.tenant_id AND w.id = p_waba AND w.state <> 'revoked') THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: waba not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY SELECT t.encrypted_token, t.dek_ref FROM public.token_vault t WHERE t.tenant_id = a.tenant_id AND t.waba_id = p_waba AND t.revoked_at IS NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_sealed_token(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_sealed_token(uuid) TO clinic_app;--> statement-breakpoint

-- SET-42 for a given tenant (the webhook path is unbound, so `setting_value_at` — keyed on app_tenant_id() — cannot read it there): the branch
-- value, else the tenant value, else 'manual'. Same precedence as setting_value_at (0028), which is not re-created.
CREATE FUNCTION public.inbox_assignment_mode(p_tenant uuid, p_branch uuid, p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT v.value #>> '{}' FROM public.setting_versions v WHERE v.tenant_id = p_tenant AND v.key = 'SET-42' AND v.state = 'active'
        AND p_branch IS NOT NULL AND v.branch_id = p_branch AND v.effective_from <= p_at ORDER BY v.effective_from DESC, v.id DESC LIMIT 1),
    (SELECT v.value #>> '{}' FROM public.setting_versions v WHERE v.tenant_id = p_tenant AND v.key = 'SET-42' AND v.state = 'active'
        AND v.branch_id IS NULL AND v.effective_from <= p_at ORDER BY v.effective_from DESC, v.id DESC LIMIT 1),
    'manual')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_assignment_mode(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Status rank (r1 P2-2): statuses only advance; failed only from queued or sent.
CREATE FUNCTION public.message_status_rank(p text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 1 ELSE NULL END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.message_status_rank(text) FROM PUBLIC;--> statement-breakpoint

-- Guards (r1 P1-3): never deleted; identity frozen; the window never moves back; statuses advance; inbound messages and ciphertexts frozen.
CREATE FUNCTION public.meta_webhook_receipts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhook receipts are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'state' - 'processed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'processed_at')
     OR NOT (OLD.state IN ('received','held_out_of_order') AND NEW.state = 'processed') THEN
    RAISE EXCEPTION 'a receipt only moves to processed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.meta_webhook_receipts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER meta_webhook_receipts_guard BEFORE UPDATE OR DELETE ON public.meta_webhook_receipts FOR EACH ROW EXECUTE FUNCTION public.meta_webhook_receipts_guard();--> statement-breakpoint
ALTER TABLE public.meta_webhook_receipts ENABLE ALWAYS TRIGGER meta_webhook_receipts_guard;--> statement-breakpoint

CREATE FUNCTION public.conversations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'conversations are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.id, NEW.tenant_id, NEW.waba_id, NEW.wa_number_id, NEW.contact_wa_id, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.waba_id, OLD.wa_number_id, OLD.contact_wa_id, OLD.created_at)
     OR NEW.last_inbound_at < OLD.last_inbound_at OR NEW.last_outbound_at < OLD.last_outbound_at
     OR (OLD.first_response_at IS NOT NULL AND NEW.first_response_at IS DISTINCT FROM OLD.first_response_at)
     OR (OLD.branch_id IS NOT NULL AND NEW.branch_id IS DISTINCT FROM OLD.branch_id AND NEW.branch_id IS NULL)) THEN
    RAISE EXCEPTION 'a conversation keeps its identity; its window and responses never move back' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.conversations_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER conversations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.conversations_guard();--> statement-breakpoint
ALTER TABLE public.conversations ENABLE ALWAYS TRIGGER conversations_guard;--> statement-breakpoint

CREATE FUNCTION public.messages_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'messages are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (
       (to_jsonb(NEW) - 'status' - 'provider_message_id' - 'sent_at' - 'delivered_at' - 'read_at' - 'failed_at')
         IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'provider_message_id' - 'sent_at' - 'delivered_at' - 'read_at' - 'failed_at')
     OR OLD.direction = 'in'
     OR (OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id)
     OR public.message_status_rank(NEW.status) < public.message_status_rank(OLD.status)
     OR (NEW.status = 'failed' AND OLD.status NOT IN ('queued','sent','failed'))
     OR (OLD.status = 'failed' AND NEW.status <> 'failed')) THEN
    RAISE EXCEPTION 'a message keeps its content; its status only advances' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.messages_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER messages_guard BEFORE INSERT OR UPDATE OR DELETE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_guard();--> statement-breakpoint
ALTER TABLE public.messages ENABLE ALWAYS TRIGGER messages_guard;--> statement-breakpoint

CREATE FUNCTION public.wa_templates_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'templates are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.waba_id, NEW.name, NEW.language, NEW.command_key)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.waba_id, OLD.name, OLD.language, OLD.command_key) THEN
    RAISE EXCEPTION 'a template keeps its identity' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_templates_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER wa_templates_guard BEFORE INSERT OR UPDATE OR DELETE ON public.wa_templates FOR EACH ROW EXECUTE FUNCTION public.wa_templates_guard();--> statement-breakpoint
ALTER TABLE public.wa_templates ENABLE ALWAYS TRIGGER wa_templates_guard;--> statement-breakpoint

-- W-05 baseline (r1 open point 7): a template body carries no diagnosis, treatment detail or photo reference.
CREATE FUNCTION public.wa_template_body_ok(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p !~* '(diagnos|keluhan medis|resep|obat |dosis|foto|before.?after|sebelum.?sesudah|hasil perawatan|tindakan medis|icd)'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_template_body_ok(text) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY conversations_read ON public.conversations FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.inbox_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, waba_id, wa_number_id, branch_id, contact_wa_id, patient_id, assignee_staff_id, assigned_at, state, labels, last_inbound_at, window_expires_at, last_outbound_at, first_response_at, created_at, updated_at) ON public.conversations TO clinic_app;--> statement-breakpoint
CREATE POLICY conversations_operator_read ON public.conversations FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.conversations', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, waba_id, wa_number_id, branch_id, contact_wa_id, patient_id, assignee_staff_id, assigned_at, state, labels, last_inbound_at, window_expires_at, last_outbound_at, first_response_at, created_at, updated_at) ON public.conversations TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY messages_read ON public.messages FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.tenant_id = messages.tenant_id AND c.id = messages.conversation_id AND public.inbox_readable(c.tenant_id, c.branch_id)));--> statement-breakpoint
GRANT SELECT (id, tenant_id, conversation_id, direction, sent_via, kind, template_id, template_category, media_meta_id, media_mime_type, provider_message_id, status, provider_at, sent_at, delivered_at, read_at, failed_at, author_staff_id, author_as, command_key, created_at) ON public.messages TO clinic_app;--> statement-breakpoint
CREATE POLICY messages_operator_read ON public.messages FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.messages', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, conversation_id, direction, sent_via, kind, template_id, template_category, media_meta_id, media_mime_type, provider_message_id, status, provider_at, sent_at, delivered_at, read_at, failed_at, author_staff_id, author_as, command_key, created_at) ON public.messages TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY wa_templates_read ON public.wa_templates FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.wa_templates_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.wa_templates TO clinic_app;--> statement-breakpoint
CREATE POLICY wa_templates_operator_read ON public.wa_templates FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.wa_templates', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.wa_templates TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.meta_webhook_receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER meta_webhook_receipts_no_truncate BEFORE TRUNCATE ON public.meta_webhook_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.meta_webhook_receipts ENABLE ALWAYS TRIGGER meta_webhook_receipts_no_truncate;--> statement-breakpoint
CREATE TRIGGER conversations_no_truncate BEFORE TRUNCATE ON public.conversations FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.conversations ENABLE ALWAYS TRIGGER conversations_no_truncate;--> statement-breakpoint
CREATE TRIGGER messages_no_truncate BEFORE TRUNCATE ON public.messages FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.messages ENABLE ALWAYS TRIGGER messages_no_truncate;--> statement-breakpoint
CREATE TRIGGER wa_templates_no_truncate BEFORE TRUNCATE ON public.wa_templates FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.wa_templates ENABLE ALWAYS TRIGGER wa_templates_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.meta_webhook_receipts', 'platform', 'messaging', '{}', 'meta_webhook_ingest / meta_webhook_drop (the unbound webhook intake)', 'none (before routing)'),
  ('public.conversations', 'tenant-shared', 'messaging', '{owner,central_cs,manager,fo_cashier,bc}', 'inbox definers (src/modules/messaging/inbox)', 'the number''s branch, or unrouted (brand-wide)'),
  ('public.messages', 'tenant-shared', 'messaging', '{owner,central_cs,manager,fo_cashier,bc}', 'inbox definers (src/modules/messaging/inbox)', 'the conversation''s branch'),
  ('public.wa_templates', 'tenant-shared', 'messaging', '{owner,admin_pusat,marketing,central_cs,manager,fo_cashier,bc,auditor}', 'template definers (src/modules/messaging/inbox)', 'none (tenant-wide)');--> statement-breakpoint
-- Vendor support access (TEN-14: messages are specific personal data; owner approval) and configuration.
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.conversations', 'personal'), ('public.messages', 'personal'), ('public.wa_templates', 'config');--> statement-breakpoint

-- ── T-090: webhook intake (TD-22, TD-24; r1 open point 1, P1-2, P2-2, P2-3; r2 P3-2). The app verifies the signature, parses the event, seals
-- the raw JSON and the body with the tenant DEK (keys from inbox_webhook_keys), and calls one definer per event on an unbound connection. ──

-- A rejected or unroutable delivery: non-personal metadata only (no tenant payload); the platform drop log.
CREATE FUNCTION public.meta_webhook_drop(p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_state text := p ->> 'state';
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the webhook path is unbound' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(v_state, '') NOT IN ('rejected_signature','dropped_unknown_route')
     OR p - 'state' - 'provider_event_id' - 'kind' - 'phone_number_id' - 'body_sha256' - 'error_code' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: drop' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.meta_webhook_receipts (provider_event_id, kind, phone_number_id, signature_ok, state, body_sha256, error_code)
  VALUES (left(coalesce(nullif(p ->> 'provider_event_id', ''), 'unknown'), 200), coalesce(p ->> 'kind', 'unknown'), p ->> 'phone_number_id',
          v_state <> 'rejected_signature', v_state, p ->> 'body_sha256', p ->> 'error_code');
  PERFORM public.vendor_log(NULL, NULL, NULL, 'meta_webhook_drop', NULL, NULL, 'denied', v_state, NULL, NULL, 'meta_webhook');
  RETURN v_state;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: drop' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.meta_webhook_drop(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.meta_webhook_drop(jsonb) TO clinic_app;--> statement-breakpoint

-- Apply a status to a message: rank only advances; a delivered after read backfills delivered_at (r1 P2-2).
CREATE FUNCTION public.message_apply_status(p_tenant uuid, p_message uuid, p_status text, p_at timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  m public.messages;
BEGIN
  SELECT * INTO m FROM public.messages x WHERE x.tenant_id = p_tenant AND x.id = p_message FOR UPDATE;
  IF m.id IS NULL OR m.direction <> 'out' THEN
    RETURN;
  END IF;
  UPDATE public.messages SET
         status = CASE WHEN m.status = 'failed' THEN 'failed'
                       WHEN p_status = 'failed' THEN CASE WHEN m.status IN ('queued','sent') THEN 'failed' ELSE m.status END
                       WHEN public.message_status_rank(p_status) > public.message_status_rank(m.status) THEN p_status ELSE m.status END,
         sent_at = coalesce(sent_at, CASE WHEN p_status IN ('sent','delivered','read') THEN p_at END),
         delivered_at = coalesce(delivered_at, CASE WHEN p_status = 'delivered' THEN p_at END),
         read_at = coalesce(read_at, CASE WHEN p_status = 'read' THEN p_at END),
         failed_at = coalesce(failed_at, CASE WHEN p_status = 'failed' AND m.status IN ('queued','sent') THEN p_at END)
   WHERE tenant_id = p_tenant AND id = p_message;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.message_apply_status(uuid, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Apply the statuses held for a provider message id once its message exists (r1 P2-2), in status time order.
CREATE FUNCTION public.message_apply_held(p_tenant uuid, p_message uuid, p_provider_id text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT h.id, h.observed_status, h.status_at FROM public.meta_webhook_receipts h
            WHERE h.tenant_id = p_tenant AND h.target_message_id = p_provider_id AND h.state = 'held_out_of_order'
            ORDER BY h.status_at, h.id FOR UPDATE LOOP
    PERFORM public.message_apply_status(p_tenant, p_message, r.observed_status, r.status_at);
    UPDATE public.meta_webhook_receipts SET state = 'processed', processed_at = clock_timestamp() WHERE id = r.id;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.message_apply_held(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- SET-42 bergilir (r1 open point 5): the branch's active fo_cashier / bc members (else the tenant's central_cs), least recently assigned first.
CREATE FUNCTION public.inbox_next_assignee(p_tenant uuid, p_branch uuid, p_now timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH pool AS (
    SELECT DISTINCT s.id FROM public.staff s
      JOIN public.staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.branch_id = p_branch AND sb.role IN ('fo_cashier','bc')
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
     WHERE s.tenant_id = p_tenant AND m.effective_from <= p_now AND (m.effective_to IS NULL OR m.effective_to > p_now)
  ), fallback AS (
    SELECT DISTINCT s.id FROM public.staff s
      JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = 'central_cs'
      JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
     WHERE s.tenant_id = p_tenant AND m.effective_from <= p_now AND (m.effective_to IS NULL OR m.effective_to > p_now)
       AND NOT EXISTS (SELECT 1 FROM pool)
  )
  SELECT c.id FROM (SELECT id FROM pool UNION ALL SELECT id FROM fallback) c
   ORDER BY (SELECT max(x.assigned_at) FROM public.conversations x WHERE x.tenant_id = p_tenant AND x.branch_id = p_branch AND x.assignee_staff_id = c.id)
            ASC NULLS FIRST, c.id
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_next_assignee(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- A verified, routed event (unbound). p: {provider_event_id, kind (message|status), phone_number_id, body_sha256, raw_payload_enc,
-- payload_dek_ref, and for a message: contact_wa_id, contact_name_enc?, contact_name_dek_ref?, direction (in|out), sent_via, msg_kind,
-- body_enc?, body_dek_ref?, media_meta_id?, media_mime_type?, provider_message_id, provider_at; for a status: target_message_id,
-- observed_status, status_at}. Returns processed | duplicate | held | dropped.
CREATE FUNCTION public.meta_webhook_ingest(p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  rt record;
  v_now timestamptz;
  v_receipt uuid;
  v_kind text := p ->> 'kind';
  c public.conversations;
  v_msg uuid;
  v_at timestamptz;
  v_assignee uuid;
  v_target public.messages;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the webhook path is unbound' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(v_kind, '') NOT IN ('message','status')
     OR p - 'provider_event_id' - 'kind' - 'phone_number_id' - 'body_sha256' - 'raw_payload_enc' - 'payload_dek_ref' - 'contact_wa_id'
          - 'contact_name_enc' - 'contact_name_dek_ref' - 'direction' - 'sent_via' - 'msg_kind' - 'body_enc' - 'body_dek_ref' - 'media_meta_id'
          - 'media_mime_type' - 'provider_message_id' - 'provider_at' - 'target_message_id' - 'observed_status' - 'status_at' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: event' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO rt FROM public.waba_route_resolve(p ->> 'phone_number_id');
  IF rt.tenant_id IS NULL THEN
    RETURN public.meta_webhook_drop(jsonb_build_object('state', 'dropped_unknown_route', 'provider_event_id', p ->> 'provider_event_id',
      'kind', v_kind, 'phone_number_id', p ->> 'phone_number_id', 'body_sha256', p ->> 'body_sha256', 'error_code', 'unknown_route'));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || rt.tenant_id::text, 0));
  v_now := clock_timestamp();
  -- another tenant's message (a status for it, or a message with its provider id): dropped and audited, never a duplicate of it (review r1 P2-2)
  IF EXISTS (SELECT 1 FROM public.messages m WHERE m.tenant_id <> rt.tenant_id
              AND m.provider_message_id = CASE WHEN v_kind = 'status' THEN p ->> 'target_message_id' ELSE p ->> 'provider_message_id' END)
     OR EXISTS (SELECT 1 FROM public.meta_webhook_receipts r WHERE r.provider_event_id = p ->> 'provider_event_id' AND r.kind = v_kind
                 AND r.signature_ok AND r.state IN ('received','processed','held_out_of_order') AND r.tenant_id IS DISTINCT FROM rt.tenant_id) THEN
    INSERT INTO public.meta_webhook_receipts (provider_event_id, kind, phone_number_id, tenant_id, signature_ok, state, body_sha256, error_code)
    VALUES (p ->> 'provider_event_id', v_kind, p ->> 'phone_number_id', NULL, true, 'dropped_unknown_route', p ->> 'body_sha256', 'tenant_mismatch')
    RETURNING id INTO v_receipt;
    PERFORM public.waba_audit_service(rt.tenant_id, 'access_denied', 'meta_webhook', v_receipt, 'denied', 'tenant_mismatch');
    RETURN 'dropped';
  END IF;
  -- duplicate: the routed tenant's verified live receipt, or the message already stored → a duplicate row, nothing else
  IF EXISTS (SELECT 1 FROM public.meta_webhook_receipts r WHERE r.provider_event_id = p ->> 'provider_event_id' AND r.kind = v_kind
              AND r.signature_ok AND r.state IN ('received','processed','held_out_of_order') AND r.tenant_id = rt.tenant_id)
     OR v_kind = 'message' AND EXISTS (SELECT 1 FROM public.messages m WHERE m.tenant_id = rt.tenant_id AND m.provider_message_id = p ->> 'provider_message_id') THEN
    INSERT INTO public.meta_webhook_receipts (provider_event_id, kind, phone_number_id, tenant_id, signature_ok, state, body_sha256)
    VALUES (p ->> 'provider_event_id', v_kind, p ->> 'phone_number_id', rt.tenant_id, true, 'duplicate', p ->> 'body_sha256');
    RETURN 'duplicate';
  END IF;
  IF v_kind = 'status' THEN
    SELECT * INTO v_target FROM public.messages m WHERE m.tenant_id = rt.tenant_id AND m.provider_message_id = p ->> 'target_message_id';
    INSERT INTO public.meta_webhook_receipts (provider_event_id, kind, phone_number_id, tenant_id, signature_ok, state, body_sha256, raw_payload_enc,
                                              payload_dek_ref, target_message_id, observed_status, status_at, processed_at)
    VALUES (p ->> 'provider_event_id', v_kind, p ->> 'phone_number_id', rt.tenant_id, true,
            CASE WHEN v_target.id IS NULL THEN 'held_out_of_order' ELSE 'processed' END, p ->> 'body_sha256', p ->> 'raw_payload_enc',
            p ->> 'payload_dek_ref', p ->> 'target_message_id', p ->> 'observed_status', (p ->> 'status_at')::timestamptz,
            CASE WHEN v_target.id IS NULL THEN NULL ELSE v_now END);
    IF v_target.id IS NULL THEN
      RETURN 'held';
    END IF;
    PERFORM public.message_apply_status(rt.tenant_id, v_target.id, p ->> 'observed_status', (p ->> 'status_at')::timestamptz);
    RETURN 'processed';
  END IF;
  -- a message: the receipt, the conversation (created on first contact; matched to one canonical patient by phone), the message
  INSERT INTO public.meta_webhook_receipts (provider_event_id, kind, phone_number_id, tenant_id, signature_ok, state, body_sha256, raw_payload_enc,
                                            payload_dek_ref, processed_at)
  VALUES (p ->> 'provider_event_id', v_kind, p ->> 'phone_number_id', rt.tenant_id, true, 'processed', p ->> 'body_sha256', p ->> 'raw_payload_enc',
          p ->> 'payload_dek_ref', v_now);
  v_at := (p ->> 'provider_at')::timestamptz;
  SELECT * INTO c FROM public.conversations x WHERE x.tenant_id = rt.tenant_id AND x.wa_number_id = rt.wa_number_id AND x.contact_wa_id = p ->> 'contact_wa_id' FOR UPDATE;
  IF c.id IS NULL THEN
    v_assignee := CASE WHEN rt.branch_id IS NOT NULL
                        AND public.inbox_assignment_mode(rt.tenant_id, rt.branch_id, v_now) = 'bergilir'
                       THEN public.inbox_next_assignee(rt.tenant_id, rt.branch_id, v_now) END;
    INSERT INTO public.conversations (tenant_id, waba_id, wa_number_id, branch_id, contact_wa_id, contact_name_enc, contact_name_dek_ref, patient_id,
                                      assignee_staff_id, assigned_at, created_at, updated_at)
    VALUES (rt.tenant_id, rt.waba_id, rt.wa_number_id, rt.branch_id, p ->> 'contact_wa_id', p ->> 'contact_name_enc', p ->> 'contact_name_dek_ref',
            (SELECT CASE WHEN count(DISTINCT public.patient_canonical(cp.tenant_id, cp.patient_id)) = 1
                         THEN min(public.patient_canonical(cp.tenant_id, cp.patient_id)::text)::uuid END
               FROM public.contact_points cp WHERE cp.tenant_id = rt.tenant_id AND cp.kind = 'phone' AND cp.value = '+' || (p ->> 'contact_wa_id')),
            v_assignee, CASE WHEN v_assignee IS NOT NULL THEN v_now END, v_now, v_now)
    RETURNING * INTO c;
  END IF;
  INSERT INTO public.messages (tenant_id, conversation_id, direction, sent_via, kind, body_enc, body_dek_ref, media_meta_id, media_mime_type,
                               provider_message_id, status, provider_at, sent_at, created_at)
  VALUES (rt.tenant_id, c.id, p ->> 'direction', coalesce(p ->> 'sent_via', 'cloud_api'), p ->> 'msg_kind', p ->> 'body_enc', p ->> 'body_dek_ref',
          p ->> 'media_meta_id', p ->> 'media_mime_type', p ->> 'provider_message_id',
          CASE WHEN p ->> 'direction' = 'in' THEN 'received' ELSE 'sent' END, v_at, CASE WHEN p ->> 'direction' = 'out' THEN v_at END, v_now)
  RETURNING id INTO v_msg;
  IF p ->> 'direction' = 'in' THEN
    -- a late inbound never moves the window back
    UPDATE public.conversations SET last_inbound_at = greatest(coalesce(last_inbound_at, v_at), v_at),
           window_expires_at = greatest(coalesce(last_inbound_at, v_at), v_at) + interval '24 hours', state = 'open', updated_at = v_now
     WHERE tenant_id = c.tenant_id AND id = c.id;
  ELSE
    -- a Coexistence echo (TD-24): an outbound response; the window unchanged
    UPDATE public.conversations SET last_outbound_at = greatest(coalesce(last_outbound_at, v_at), v_at),
           first_response_at = coalesce(first_response_at, CASE WHEN last_inbound_at IS NOT NULL AND v_at >= last_inbound_at THEN v_at END),
           updated_at = v_now
     WHERE tenant_id = c.tenant_id AND id = c.id;
  END IF;
  PERFORM public.message_apply_held(rt.tenant_id, v_msg, p ->> 'provider_message_id');
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, occurred_at, payload)
  VALUES (rt.tenant_id, c.branch_id, CASE WHEN p ->> 'direction' = 'in' THEN 'MessageReceived' ELSE 'MessageEchoed' END, 'conversation', c.id, v_now,
          jsonb_build_object('conversation_id', c.id, 'message_id', v_msg));
  RETURN 'processed';
EXCEPTION WHEN check_violation OR invalid_text_representation OR invalid_datetime_format THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: event' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.meta_webhook_ingest(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.meta_webhook_ingest(jsonb) TO clinic_app;--> statement-breakpoint

-- ── T-090: inbox commands (r1 P2-1, open points 4–7; r2 P3-1): send (queue → the port in TS → record), assign, route, match a patient, close
-- or reopen, labels; template save and sync. One clock read after the locks (DEC-088). ──

-- The inbox actor: the actor lock first; an inbox writer role (owner reads only).
CREATE FUNCTION public.inbox_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role INTO tenant_id, staff_id, role FROM public.tenant_actor_lock() a;
  IF role NOT IN ('central_cs','fo_cashier','bc','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not work the inbox' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_actor() FROM PUBLIC;--> statement-breakpoint

-- The caller's conversation, locked, or not found (another tenant's, or a branch the caller may not see).
CREATE FUNCTION public.inbox_conversation_for(p_tenant uuid, p_conversation uuid) RETURNS public.conversations
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c public.conversations;
BEGIN
  SELECT * INTO c FROM public.conversations x WHERE x.tenant_id = p_tenant AND x.id = p_conversation FOR UPDATE;
  IF c.id IS NULL OR NOT public.inbox_readable(c.tenant_id, c.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: conversation not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN c;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_conversation_for(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Queue an outbound message (PR-28 scenario): free-form text only inside the 24 h window; otherwise an approved template; a marketing template
-- needs the tenant's marketing capability and the patient cluster's active marketing_wa consent (17:174). p: {kind: text|template,
-- body_enc?, body_dek_ref?, template_id?}. Returns {message_id, status, waba_id, wa_number_id, ...} or the replay.
CREATE FUNCTION public.inbox_send_queue(p_key text, p_conversation uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.inbox_actor();
  c public.conversations;
  t public.wa_templates;
  v_now timestamptz;
  v_id uuid;
  v_kind text := p ->> 'kind';
  v_template uuid;
BEGIN
  SELECT m.id INTO v_id FROM public.messages m WHERE m.tenant_id = a.tenant_id AND m.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN (SELECT jsonb_build_object('message_id', m.id, 'status', m.status, 'replayed', true, 'conversation_id', m.conversation_id)
              FROM public.messages m WHERE m.tenant_id = a.tenant_id AND m.id = v_id);
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_kind NOT IN ('text','template')
     OR p - 'kind' - 'body_enc' - 'body_dek_ref' - 'template_id' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: message' USING ERRCODE = '22023';
  END IF;
  c := public.inbox_conversation_for(a.tenant_id, p_conversation);
  v_now := clock_timestamp();
  IF NOT public.inbox_can_send(c.tenant_id, c.waba_id, c.wa_number_id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: number_not_sending' USING ERRCODE = '55000';
  END IF;
  IF v_kind = 'text' THEN
    IF c.window_expires_at IS NULL OR v_now >= c.window_expires_at THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: window_closed' USING ERRCODE = '55000';
    END IF;
    IF NOT public.tenant_capability('care_message') THEN
      RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: messaging is not available now' USING ERRCODE = '42501';
    END IF;
  ELSE
    BEGIN
      v_template := (p ->> 'template_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: template' USING ERRCODE = '22023';
    END;
    SELECT * INTO t FROM public.wa_templates x WHERE x.tenant_id = c.tenant_id AND x.id = v_template AND x.waba_id = c.waba_id;
    IF t.id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: template not found' USING ERRCODE = 'P0002';
    END IF;
    IF t.status <> 'approved' THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: template_not_approved' USING ERRCODE = '55000';
    END IF;
    IF NOT public.tenant_capability(CASE WHEN t.category = 'marketing' THEN 'marketing_message' ELSE 'care_message' END) THEN
      RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: messaging is not available now' USING ERRCODE = '42501';
    END IF;
    IF t.category = 'marketing' AND c.patient_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.consents k WHERE k.tenant_id = c.tenant_id AND k.purpose = 'marketing_wa' AND k.withdrawn_at IS NULL
            AND k.patient_id = ANY (public.patient_cluster(c.tenant_id, public.patient_canonical(c.tenant_id, c.patient_id)))) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: marketing_consent_required' USING ERRCODE = '55000';
    END IF;
  END IF;
  INSERT INTO public.messages (tenant_id, conversation_id, direction, sent_via, kind, body_enc, body_dek_ref, template_id, template_category,
                               status, author_staff_id, author_as, command_key, created_at)
  VALUES (c.tenant_id, c.id, 'out', 'cloud_api', v_kind, p ->> 'body_enc', p ->> 'body_dek_ref', t.id, t.category, 'queued', a.staff_id, a.role,
          p_key, v_now)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('message_id', v_id, 'status', 'queued', 'replayed', false, 'conversation_id', c.id, 'waba_id', c.waba_id,
    'wa_number_id', c.wa_number_id, 'template_name', t.name, 'template_language', t.language);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: message' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_send_queue(text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_send_queue(text, uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Record the port's acceptance (queued → sent): the provider id, the outbound time, the first response; MessageSent (ids only).
CREATE FUNCTION public.inbox_send_record(p_message uuid, p_provider_message_id text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.inbox_actor();
  m public.messages;
  c public.conversations;
  v_now timestamptz;
BEGIN
  SELECT * INTO m FROM public.messages x WHERE x.tenant_id = a.tenant_id AND x.id = p_message AND x.direction = 'out' FOR UPDATE;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: message not found' USING ERRCODE = 'P0002';
  END IF;
  c := public.inbox_conversation_for(m.tenant_id, m.conversation_id);
  IF m.status <> 'queued' THEN
    RETURN m.status; -- replay
  END IF;
  IF coalesce(p_provider_message_id, '') !~ '^[A-Za-z0-9_.:=-]{8,200}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: provider id' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  UPDATE public.messages SET status = 'sent', provider_message_id = p_provider_message_id, sent_at = v_now WHERE tenant_id = m.tenant_id AND id = m.id;
  UPDATE public.conversations SET last_outbound_at = greatest(coalesce(last_outbound_at, v_now), v_now),
         first_response_at = coalesce(first_response_at, CASE WHEN last_inbound_at IS NOT NULL THEN v_now END), updated_at = v_now
   WHERE tenant_id = c.tenant_id AND id = c.id;
  PERFORM public.message_apply_held(m.tenant_id, m.id, p_provider_message_id);
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (m.tenant_id, c.branch_id, 'MessageSent', 'conversation', c.id, a.staff_id, a.role, v_now,
          jsonb_build_object('conversation_id', c.id, 'message_id', m.id));
  RETURN 'sent';
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_VERSION_CONFLICT: provider_id_taken' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_send_record(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_send_record(uuid, text) TO clinic_app;--> statement-breakpoint

-- Assign, route to a branch, match a patient, close / reopen, labels. p: {action: assign|route|match|close|reopen|labels, staff_id?,
-- branch_id?, patient_id?, labels?}.
CREATE FUNCTION public.inbox_conversation_update(p_conversation uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.inbox_actor();
  c public.conversations;
  v_now timestamptz;
  v_action text := p ->> 'action';
  v_uuid uuid;
  v_assignee uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_action NOT IN ('assign','unassign','route','match','close','reopen','labels')
     OR p - 'action' - 'staff_id' - 'branch_id' - 'patient_id' - 'labels' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: update' USING ERRCODE = '22023';
  END IF;
  c := public.inbox_conversation_for(a.tenant_id, p_conversation);
  v_now := clock_timestamp();
  BEGIN
    v_uuid := coalesce(p ->> 'staff_id', p ->> 'branch_id', p ->> 'patient_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: id' USING ERRCODE = '22023';
  END;
  IF v_action = 'assign' THEN
    -- an active inbox member who can read this conversation's branch
    IF NOT EXISTS (
         SELECT 1 FROM public.staff s JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
          WHERE s.tenant_id = c.tenant_id AND s.id = v_uuid AND m.effective_from <= v_now AND (m.effective_to IS NULL OR m.effective_to > v_now)
            AND (EXISTS (SELECT 1 FROM public.staff_roles r WHERE r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = 'central_cs')
              OR EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = s.tenant_id AND sb.staff_id = s.id
                           AND sb.role IN ('manager','fo_cashier','bc') AND (c.branch_id IS NULL OR sb.branch_id = c.branch_id)))) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.conversations SET assignee_staff_id = v_uuid, assigned_at = v_now, updated_at = v_now WHERE tenant_id = c.tenant_id AND id = c.id;
  ELSIF v_action = 'unassign' THEN
    UPDATE public.conversations SET assignee_staff_id = NULL, assigned_at = NULL, updated_at = v_now WHERE tenant_id = c.tenant_id AND id = c.id;
  ELSIF v_action = 'route' THEN
    -- a brand-wide conversation to one of the caller's branches (or any branch for central_cs); then SET-42
    IF c.branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_routed' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = c.tenant_id AND b.id = v_uuid)
       OR (a.role <> 'central_cs' AND NOT public.app_branch_allowed(v_uuid)) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
    END IF;
    v_assignee := CASE WHEN c.assignee_staff_id IS NULL AND public.inbox_assignment_mode(c.tenant_id, v_uuid, v_now) = 'bergilir'
                       THEN public.inbox_next_assignee(c.tenant_id, v_uuid, v_now) END;
    UPDATE public.conversations SET branch_id = v_uuid, updated_at = v_now,
           assignee_staff_id = coalesce(assignee_staff_id, v_assignee), assigned_at = CASE WHEN assignee_staff_id IS NULL AND v_assignee IS NOT NULL THEN v_now ELSE assigned_at END
     WHERE tenant_id = c.tenant_id AND id = c.id;
  ELSIF v_action = 'match' THEN
    IF NOT EXISTS (SELECT 1 FROM public.patients pt WHERE pt.tenant_id = c.tenant_id AND pt.id = v_uuid) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.conversations SET patient_id = public.patient_canonical(c.tenant_id, v_uuid), updated_at = v_now WHERE tenant_id = c.tenant_id AND id = c.id;
  ELSIF v_action IN ('close','reopen') THEN
    UPDATE public.conversations SET state = CASE WHEN v_action = 'close' THEN 'closed' ELSE 'open' END, updated_at = v_now
     WHERE tenant_id = c.tenant_id AND id = c.id;
  ELSE
    IF jsonb_typeof(p -> 'labels') IS DISTINCT FROM 'array' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p -> 'labels') e WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[a-z][a-z0-9_]{1,30}$') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: labels' USING ERRCODE = '22023';
    END IF;
    UPDATE public.conversations SET labels = ARRAY(SELECT DISTINCT e #>> '{}' FROM jsonb_array_elements(p -> 'labels') e ORDER BY 1), updated_at = v_now
     WHERE tenant_id = c.tenant_id AND id = c.id;
  END IF;
  PERFORM public.audit_append('settings_change', 'conversation', c.id, 'success', 'inbox_' || v_action);
  RETURN (SELECT jsonb_build_object('id', x.id, 'branch_id', x.branch_id, 'assignee_staff_id', x.assignee_staff_id, 'patient_id', x.patient_id,
                  'state', x.state, 'labels', to_jsonb(x.labels)) FROM public.conversations x WHERE x.tenant_id = c.tenant_id AND x.id = c.id);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: update' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_conversation_update(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_conversation_update(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Save a neutral template draft (owner, admin_pusat, marketing; configuration; W-05 baseline). p: {name, language?, category, body, param_count?}.
CREATE FUNCTION public.wa_template_save(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  w uuid;
  v_id uuid;
  v_now timestamptz;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','marketing') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not manage templates' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
  SELECT x.id INTO v_id FROM public.wa_templates x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'name' - 'language' - 'category' - 'body' - 'param_count' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: template' USING ERRCODE = '22023';
  END IF;
  IF NOT public.wa_template_body_ok(coalesce(p ->> 'body', '')) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: clinical_content' USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO w FROM public.waba_accounts x WHERE x.tenant_id = a.tenant_id AND x.state <> 'revoked';
  IF w IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_waba' USING ERRCODE = '55000';
  END IF;
  v_now := clock_timestamp();
  INSERT INTO public.wa_templates (tenant_id, waba_id, name, language, category, status, body, param_count, saved_by, saved_as, updated_at, command_key)
  VALUES (a.tenant_id, w, p ->> 'name', coalesce(p ->> 'language', 'id'), p ->> 'category', 'draft', p ->> 'body',
          coalesce((p ->> 'param_count')::integer, 0), a.staff_id, a.role, v_now, p_key)
  RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'wa_template', v_id, 'success', 'wa_template_saved');
  RETURN v_id;
EXCEPTION WHEN check_violation OR invalid_text_representation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: template' USING ERRCODE = '22023';
WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_VERSION_CONFLICT: template_name_taken' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_template_save(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.wa_template_save(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Sync templates from the port's recorded list (owner, admin_pusat, marketing; configuration; the mock only outside production): upsert by
-- (name, language) with Meta's status and category. p: {templates: [{name, language, category, status, body, param_count}]}.
CREATE FUNCTION public.wa_template_sync(p jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  w uuid;
  r jsonb;
  v_n integer := 0;
  v_now timestamptz;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','marketing') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not manage templates' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
  IF public.payment_deploy_env() = 'production' THEN
    RAISE EXCEPTION 'ERR_NOT_AVAILABLE: live_graph_not_configured' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'templates' <> '{}'::jsonb OR jsonb_typeof(p -> 'templates') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: templates' USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO w FROM public.waba_accounts x WHERE x.tenant_id = a.tenant_id AND x.state <> 'revoked';
  IF w IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_waba' USING ERRCODE = '55000';
  END IF;
  v_now := clock_timestamp();
  FOR r IN SELECT * FROM jsonb_array_elements(p -> 'templates') LOOP
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r - 'name' - 'language' - 'category' - 'status' - 'body' - 'param_count' <> '{}'::jsonb
       OR r ->> 'status' NOT IN ('pending','approved','rejected') OR NOT public.wa_template_body_ok(coalesce(r ->> 'body', '')) THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: templates' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.wa_templates (tenant_id, waba_id, name, language, category, status, body, param_count, updated_at, command_key)
    VALUES (a.tenant_id, w, r ->> 'name', coalesce(r ->> 'language', 'id'), r ->> 'category', r ->> 'status', r ->> 'body',
            coalesce((r ->> 'param_count')::integer, 0), v_now, 'sync:' || md5(w::text || (r ->> 'name') || coalesce(r ->> 'language', 'id')))
    ON CONFLICT (tenant_id, waba_id, name, language) DO UPDATE SET status = excluded.status, category = excluded.category, body = excluded.body,
           param_count = excluded.param_count, updated_at = v_now;
    v_n := v_n + 1;
  END LOOP;
  PERFORM public.audit_append('settings_change', 'waba_account', w, 'success', 'wa_templates_synced');
  RETURN v_n;
EXCEPTION WHEN check_violation OR invalid_text_representation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: templates' USING ERRCODE = '22023';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_template_sync(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.wa_template_sync(jsonb) TO clinic_app;--> statement-breakpoint

-- ── T-090: readers (r1 open point 4, P2-3). Bodies stay sealed: the readers return ciphertext only to the server, which opens them for the
-- inbox roles (W-10); the owner reads; no other role reads threads. One clock read (DEC-088). ──

-- The conversation list: a filter (all | unassigned | mine | label:<x>), the window state and the SLA facts (SET-20 minutes).
CREATE FUNCTION public.inbox_list(p_filter text, p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_now timestamptz;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role INTO a FROM public.tenant_actor_lock() x;
  IF a.role NOT IN ('owner','central_cs','manager','fo_cashier','bc') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the inbox' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_filter, 'all') !~ '^(all|unassigned|mine|closed|label:[a-z][a-z0-9_]{1,30})$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: filter' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  RETURN jsonb_build_object('role', a.role, 'can_write', a.role <> 'owner', 'now', v_now,
    'sla_minutes', coalesce((public.setting_value_at('SET-20', NULL, v_now) #>> '{}')::integer, 15),
    'conversations', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'branch_id', c.branch_id, 'branch_name', b.name, 'contact_wa_id', c.contact_wa_id, 'contact_name_enc', c.contact_name_enc,
        'patient_id', c.patient_id, 'patient_name', (SELECT pt.full_name FROM public.patients pt WHERE pt.tenant_id = c.tenant_id AND pt.id = c.patient_id),
        'assignee_staff_id', c.assignee_staff_id, 'assignee_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = c.tenant_id AND s.id = c.assignee_staff_id),
        'state', c.state, 'labels', to_jsonb(c.labels), 'last_inbound_at', c.last_inbound_at, 'window_expires_at', c.window_expires_at,
        'window_open', c.window_expires_at IS NOT NULL AND v_now < c.window_expires_at, 'first_response_at', c.first_response_at,
        'awaiting_reply', c.last_inbound_at IS NOT NULL AND (c.last_outbound_at IS NULL OR c.last_outbound_at < c.last_inbound_at),
        'last_activity_at', coalesce(greatest(c.last_inbound_at, c.last_outbound_at), c.created_at)) ORDER BY coalesce(greatest(c.last_inbound_at, c.last_outbound_at), c.created_at) DESC, c.id)
      FROM public.conversations c LEFT JOIN public.branches b ON b.tenant_id = c.tenant_id AND b.id = c.branch_id
     WHERE c.tenant_id = a.tenant_id AND public.inbox_readable(c.tenant_id, c.branch_id)
       AND (p_branch IS NULL OR c.branch_id = p_branch OR c.branch_id IS NULL)
       AND CASE coalesce(p_filter, 'all')
             WHEN 'all' THEN c.state = 'open'
             WHEN 'unassigned' THEN c.state = 'open' AND c.assignee_staff_id IS NULL
             WHEN 'mine' THEN c.state = 'open' AND c.assignee_staff_id = a.staff_id
             WHEN 'closed' THEN c.state = 'closed'
             ELSE c.state = 'open' AND substr(p_filter, 7) = ANY (c.labels) END
     LIMIT 200), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_list(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_list(text, uuid) TO clinic_app;--> statement-breakpoint

-- One thread: messages (sealed bodies for the server to open), the side panel facts over the patient cluster (P2-3), the approved templates
-- and whether a marketing template may be sent.
CREATE FUNCTION public.inbox_thread_get(p_conversation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  c public.conversations;
  v_now timestamptz;
  v_cluster uuid[];
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role INTO a FROM public.tenant_actor_lock() x;
  IF a.role NOT IN ('owner','central_cs','manager','fo_cashier','bc') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the inbox' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.conversations x WHERE x.tenant_id = a.tenant_id AND x.id = p_conversation;
  IF c.id IS NULL OR NOT public.inbox_readable(c.tenant_id, c.branch_id) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: conversation not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := clock_timestamp();
  v_cluster := CASE WHEN c.patient_id IS NOT NULL THEN public.patient_cluster(c.tenant_id, public.patient_canonical(c.tenant_id, c.patient_id)) END;
  RETURN jsonb_build_object('role', a.role, 'can_write', a.role <> 'owner', 'now', v_now,
    'conversation', jsonb_build_object('id', c.id, 'branch_id', c.branch_id, 'contact_wa_id', c.contact_wa_id, 'contact_name_enc', c.contact_name_enc,
      'patient_id', c.patient_id, 'assignee_staff_id', c.assignee_staff_id, 'state', c.state, 'labels', to_jsonb(c.labels),
      'window_expires_at', c.window_expires_at, 'window_open', c.window_expires_at IS NOT NULL AND v_now < c.window_expires_at,
      'sending', public.inbox_can_send(c.tenant_id, c.waba_id, c.wa_number_id)),
    'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'sent_via', m.sent_via, 'kind', m.kind,
        'body_enc', m.body_enc, 'template_name', (SELECT t.name FROM public.wa_templates t WHERE t.tenant_id = m.tenant_id AND t.id = m.template_id),
        'media_mime_type', m.media_mime_type, 'status', m.status, 'at', coalesce(m.provider_at, m.sent_at, m.created_at),
        'author_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = m.tenant_id AND s.id = m.author_staff_id))
        ORDER BY coalesce(m.provider_at, m.sent_at, m.created_at), m.id)
      FROM public.messages m WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id), '[]'::jsonb),
    'patient', CASE WHEN c.patient_id IS NULL THEN NULL ELSE (SELECT jsonb_build_object('id', pt.id, 'full_name', pt.full_name, 'mrn', pt.mrn,
        'marketing_consent', EXISTS (SELECT 1 FROM public.consents k WHERE k.tenant_id = c.tenant_id AND k.purpose = 'marketing_wa'
                                       AND k.withdrawn_at IS NULL AND k.patient_id = ANY (v_cluster)),
        'next_appointment_at', (SELECT min(ap.starts_at) FROM public.appointments ap WHERE ap.tenant_id = c.tenant_id AND ap.patient_id = ANY (v_cluster)
                                  AND ap.starts_at >= v_now AND ap.state = 'booked'))
      FROM public.patients pt WHERE pt.tenant_id = c.tenant_id AND pt.id = public.patient_canonical(c.tenant_id, c.patient_id)) END,
    'templates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'language', t.language, 'category', t.category,
        'param_count', t.param_count, 'body', t.body) ORDER BY t.name, t.language)
      FROM public.wa_templates t WHERE t.tenant_id = c.tenant_id AND t.waba_id = c.waba_id AND t.status = 'approved'), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inbox_thread_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_thread_get(uuid) TO clinic_app;--> statement-breakpoint

-- The template list (readers per open point 4; writers flagged).
CREATE FUNCTION public.wa_templates_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role INTO a FROM public.tenant_actor_lock() x;
  IF NOT public.wa_templates_readable(a.tenant_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read templates' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'can_manage', a.role IN ('owner','admin_pusat','marketing'),
    'templates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'language', t.language, 'category', t.category,
        'status', t.status, 'body', t.body, 'param_count', t.param_count, 'updated_at', t.updated_at) ORDER BY t.name, t.language)
      FROM public.wa_templates t JOIN public.waba_accounts w ON w.tenant_id = t.tenant_id AND w.id = t.waba_id AND w.state <> 'revoked'
     WHERE t.tenant_id = a.tenant_id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.wa_templates_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.wa_templates_list() TO clinic_app;
