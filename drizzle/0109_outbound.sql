CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"purpose" text NOT NULL,
	"category" text NOT NULL,
	"template_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"waba_id" uuid NOT NULL,
	"wa_number_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_wa_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"planned_for" date NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"rescheduled_count" smallint DEFAULT 0 NOT NULL,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"deferred_reason" text,
	"skip_reason" text,
	"error_code" text,
	"message_id" uuid,
	"provider_message_id" text,
	"command_key" text NOT NULL,
	"enqueued_by" uuid,
	"enqueued_as" text,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "outbound_messages_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "outbound_messages_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "outbound_messages_check" CHECK ("outbound_messages"."purpose" in ('care_reminder','aftercare','promo','bill') and "outbound_messages"."category" in ('utility','marketing')
      and (("outbound_messages"."purpose" = 'promo') = ("outbound_messages"."category" = 'marketing')) and "outbound_messages"."state" in ('queued','sending','sent','skipped','failed')
      and ("outbound_messages"."purpose", "outbound_messages"."source_kind") in (('bill','visit'), ('care_reminder','appointment'), ('care_reminder','followup'), ('care_reminder','consultation_control'), ('aftercare','visit'), ('promo','campaign'), ('promo','promo_code'), ('promo','patient'))
      and "outbound_messages"."contact_wa_id" ~ '^[1-9][0-9]{7,14}$' and "outbound_messages"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and "outbound_messages"."rescheduled_count" between 0 and 365 and "outbound_messages"."attempt_count" between 0 and 20
      and (("outbound_messages"."enqueued_by" is null) = ("outbound_messages"."enqueued_as" is null))
      and (("outbound_messages"."state" = 'sent') = ("outbound_messages"."sent_at" is not null and "outbound_messages"."provider_message_id" is not null))
      and (("outbound_messages"."state" = 'skipped') = ("outbound_messages"."skip_reason" is not null)) and (("outbound_messages"."state" = 'failed') = ("outbound_messages"."error_code" is not null))
      and ("outbound_messages"."state" not in ('sending','sent','failed') or "outbound_messages"."claimed_at" is not null)
      and (("outbound_messages"."state" in ('sent','skipped','failed')) = ("outbound_messages"."decided_at" is not null))
      and ("outbound_messages"."skip_reason" is null or "outbound_messages"."skip_reason" in ('consent_withdrawn','patient_merged','number_not_sending','template_withdrawn'))
      and ("outbound_messages"."deferred_reason" is null or "outbound_messages"."deferred_reason" in ('budget_reached','tenant_suspended')))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_check";--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_template_id_wa_templates_tenant_id_id_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."wa_templates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_patient_id_patients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_waba_id_waba_accounts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","waba_id") REFERENCES "public"."waba_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_wa_number_id_wa_numbers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","wa_number_id") REFERENCES "public"."wa_numbers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_conversation_id_conversations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_message_id_messages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_enqueued_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","enqueued_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_messages_due_idx" ON "outbound_messages" USING btree ("tenant_id","state","planned_for");--> statement-breakpoint
CREATE INDEX "outbound_messages_recipient_idx" ON "outbound_messages" USING btree ("tenant_id","waba_id","contact_wa_id","sent_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_check" CHECK ("messages"."direction" in ('in','out') and "messages"."kind" in ('text','template','media')
      and "messages"."status" in ('received','queued','sent','delivered','read','failed') and "messages"."sent_via" in ('cloud_api','business_app')
      and (("messages"."body_enc" is null) = ("messages"."body_dek_ref" is null)) and ("messages"."body_enc" is null or ("messages"."body_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and "messages"."body_dek_ref" ~ '^dek:v[1-9][0-9]{0,8}$'))
      and (("messages"."kind" = 'template') = ("messages"."template_id" is not null)) and (("messages"."template_id" is null) = ("messages"."template_category" is null))
      and (("messages"."kind" = 'media') = ("messages"."media_meta_id" is not null)) and ("messages"."media_meta_id" is null or "messages"."media_meta_id" !~* '^https?://')
      and ("messages"."kind" <> 'text' or "messages"."body_enc" is not null)
      and (("messages"."direction" = 'in') = ("messages"."status" = 'received')) and ("messages"."direction" = 'out' or "messages"."sent_via" = 'cloud_api')
      and ("messages"."direction" = 'in' or "messages"."sent_via" = 'business_app' or "messages"."kind" = 'template' or "messages"."author_staff_id" is not null)
      and (("messages"."author_staff_id" is null) = ("messages"."author_as" is null))
      and ("messages"."status" in ('received','queued') or "messages"."provider_message_id" is not null)
      and ("messages"."command_key" is null or "messages"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$'));--> statement-breakpoint

-- T-094 rules (generated by gen.py; plan docs/tasks/T-094.md)
-- T-094 DRAFT helpers (plan r1, Argon abfa14f1 APPROVE). Not in any worktree; dry-run on main once T-093 is integrated.

-- The tenant's daily outbound budget on an unbound connection (P1-3): floor(portfolio_messaging_limit × SET-21 / 100); SET-21 read from
-- setting_versions for the tenant (setting_value_at keys on app_tenant_id(), null when unbound), default 80 (as waba_status 0104:776).
CREATE FUNCTION public.outbound_budget_limit(p_tenant uuid, p_waba uuid, p_at timestamptz) RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT floor(w.portfolio_messaging_limit * coalesce(
           (SELECT (v.value #>> '{}')::numeric FROM public.setting_versions v
             WHERE v.tenant_id = p_tenant AND v.key = 'SET-21' AND v.state = 'active' AND v.branch_id IS NULL AND v.effective_from <= p_at
             ORDER BY v.effective_from DESC, v.id DESC LIMIT 1),
           (public.setting_default('SET-21') #>> '{}')::numeric, 80) / 100.0)::integer
    FROM public.waba_accounts w WHERE w.tenant_id = p_tenant AND w.id = p_waba
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_budget_limit(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- The recipients reached in the 24 h before p_at across the WABA's numbers (W-06: unique users, shared): queued work sent or being sent, and
-- template messages recorded in the inbox (a staff-sent template counts too).
CREATE FUNCTION public.outbound_recipients_24h(p_tenant uuid, p_waba uuid, p_at timestamptz) RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT x.wa), '{}'::text[]) FROM (
    SELECT o.contact_wa_id AS wa FROM public.outbound_messages o
     WHERE o.tenant_id = p_tenant AND o.waba_id = p_waba AND o.state IN ('sending','sent') AND coalesce(o.sent_at, o.claimed_at) > p_at - interval '24 hours'
    UNION
    SELECT c.contact_wa_id FROM public.messages m JOIN public.conversations c ON c.tenant_id = m.tenant_id AND c.id = m.conversation_id
     WHERE m.tenant_id = p_tenant AND c.waba_id = p_waba AND m.direction = 'out' AND m.kind = 'template' AND coalesce(m.sent_at, m.created_at) > p_at - interval '24 hours') x
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_recipients_24h(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- W-05 at enqueue and claim (P1-4 (3)): the body passes wa_template_body_ok and names no service of the tenant (PRIV-15).
CREATE FUNCTION public.outbound_template_ok(p_tenant uuid, p_body text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.wa_template_body_ok(p_body) AND NOT EXISTS (
    SELECT 1 FROM public.catalog_versions cv JOIN public.catalog_items ci ON ci.tenant_id = cv.tenant_id AND ci.id = cv.item_id
     WHERE cv.tenant_id = p_tenant AND ci.kind = 'service' AND length(btrim(cv.name)) >= 3 AND strpos(lower(p_body), lower(btrim(cv.name))) > 0)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_template_ok(uuid, text) FROM PUBLIC;--> statement-breakpoint

-- CHECKED (0105:33-56, 98-112; 0054; 0057:11): messages.direction / kind / sent_at / created_at; wa_templates.body / param_count;
-- catalog_items.kind in (service, product, package, material); contact_points.value carries '+' — strip it for contact_wa_id.

-- RLS predicate (plan r1 P2-2 (4)): owner, admin_pusat, central_cs, marketing, auditor tenant-wide; manager, fo_cashier, bc their branches
-- (brand-wide rows too). Identity masking happens in the reader projection.
CREATE FUNCTION public.outbound_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
           public.app_acting_role() = ANY (ARRAY['owner','admin_pusat','central_cs','marketing','auditor'])
        OR public.app_acting_role() = ANY (ARRAY['manager','fo_cashier','bc']) AND (p_branch IS NULL OR public.app_branch_allowed(p_branch))), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.outbound_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Guard (plan r1 P2-3 (1)): the staff_access lock first; never deleted; inserted queued; identity frozen; planned_for never moves back;
-- transitions queued → sending → sent | failed and queued → skipped only; a decided row is final.
CREATE FUNCTION public.outbound_messages_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbound messages are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.attempt_count <> 0 OR NEW.rescheduled_count <> 0 THEN
      RAISE EXCEPTION 'an outbound message starts queued' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.purpose, NEW.category, NEW.template_id, NEW.patient_id, NEW.waba_id, NEW.wa_number_id,
      NEW.conversation_id, NEW.contact_wa_id, NEW.source_kind, NEW.source_id, NEW.command_key, NEW.enqueued_by, NEW.enqueued_as, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.purpose, OLD.category, OLD.template_id, OLD.patient_id, OLD.waba_id, OLD.wa_number_id,
      OLD.conversation_id, OLD.contact_wa_id, OLD.source_kind, OLD.source_id, OLD.command_key, OLD.enqueued_by, OLD.enqueued_as, OLD.created_at)
     OR OLD.state IN ('sent','skipped','failed')
     OR NEW.planned_for < OLD.planned_for
     OR NOT ((OLD.state, NEW.state) IN (('queued','queued'), ('queued','sending'), ('queued','skipped'), ('sending','sent'), ('sending','failed')))
     OR NEW.attempt_count < OLD.attempt_count OR NEW.rescheduled_count < OLD.rescheduled_count THEN
    RAISE EXCEPTION 'an outbound message keeps its identity and moves forward only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_messages_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER outbound_messages_guard BEFORE INSERT OR UPDATE OR DELETE ON public.outbound_messages FOR EACH ROW EXECUTE FUNCTION public.outbound_messages_guard();--> statement-breakpoint
ALTER TABLE public.outbound_messages ENABLE ALWAYS TRIGGER outbound_messages_guard;--> statement-breakpoint
CREATE TRIGGER outbound_messages_no_truncate BEFORE TRUNCATE ON public.outbound_messages FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.outbound_messages ENABLE ALWAYS TRIGGER outbound_messages_no_truncate;--> statement-breakpoint

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY outbound_messages_read ON public.outbound_messages FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.outbound_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.outbound_messages TO clinic_app;--> statement-breakpoint
CREATE POLICY outbound_messages_operator_read ON public.outbound_messages FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.outbound_messages', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.outbound_messages TO clinic_operator;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.outbound_messages', 'tenant-shared', 'messaging', '{owner,admin_pusat,central_cs,marketing,auditor,manager,fo_cashier,bc}', 'outbound definers and outbound_claim / outbound_complete (src/modules/messaging/outbound)',
   'the sending branch, or brand-wide');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.outbound_messages', 'personal');--> statement-breakpoint

-- T-094 DRAFT: the internal enqueue (plan r1 "Writers"; P2-1, P2-2 (1), P1-4 (3)). Not granted: the bound writers below call it, and T-095 /
-- T-096 / T-097 call it from their own SQL. Returns the outbound row id (an existing one for the same command key).

CREATE FUNCTION public.outbound_enqueue_do(p_tenant uuid, p_key text, p_purpose text, p_patient uuid, p_branch uuid, p_template uuid,
                                           p_source_kind text, p_source_id uuid, p_planned date, p_by uuid, p_as text, p_now timestamptz) RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid;
  v_patient uuid;
  v_phone text;
  t public.wa_templates;
  n public.wa_numbers;
  v_conv uuid;
  v_category text := CASE WHEN p_purpose = 'promo' THEN 'marketing' ELSE 'utility' END;
BEGIN
  SELECT o.id INTO v_id FROM public.outbound_messages o WHERE o.tenant_id = p_tenant AND o.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  v_patient := public.patient_canonical(p_tenant, p_patient);
  IF NOT EXISTS (SELECT 1 FROM public.patients x WHERE x.tenant_id = p_tenant AND x.id = v_patient) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
  END IF;
  -- an approved template of the purpose's category whose body passes W-05 (PRIV-15: no diagnosis, photo or service name)
  SELECT * INTO t FROM public.wa_templates x WHERE x.tenant_id = p_tenant AND x.id = p_template;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: template not found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status <> 'approved' OR t.category <> v_category THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: template_not_usable' USING ERRCODE = '55000';
  END IF;
  IF NOT public.outbound_template_ok(p_tenant, t.body) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: template_clinical_content' USING ERRCODE = '22023';
  END IF;
  -- PR-4: a promo needs an active marketing_wa consent on the patient cluster at enqueue (re-checked at dispatch)
  IF v_category = 'marketing' AND NOT EXISTS (SELECT 1 FROM public.consents c WHERE c.tenant_id = p_tenant AND c.purpose = 'marketing_wa'
       AND c.withdrawn_at IS NULL AND c.patient_id = ANY (public.patient_cluster(p_tenant, v_patient))) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: no_marketing_consent' USING ERRCODE = '55000';
  END IF;
  -- the cluster's primary phone (contact_points carry '+'; WhatsApp ids do not)
  SELECT ltrim(cp.value, '+') INTO v_phone FROM public.contact_points cp
   WHERE cp.tenant_id = p_tenant AND cp.kind = 'phone' AND cp.patient_id = ANY (public.patient_cluster(p_tenant, v_patient))
   ORDER BY (cp.patient_id = v_patient) DESC, cp.is_primary DESC, cp.id LIMIT 1;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: patient_phone_required' USING ERRCODE = '55000';
  END IF;
  -- a sendable number of the template's WABA: the branch's, else brand-wide, else the earliest sendable
  SELECT x.* INTO n FROM public.wa_numbers x
   WHERE x.tenant_id = p_tenant AND x.waba_id = t.waba_id AND public.inbox_can_send(p_tenant, x.waba_id, x.id)
   ORDER BY (x.branch_id IS NOT DISTINCT FROM p_branch) DESC, (x.branch_id IS NULL) DESC, x.added_at, x.id LIMIT 1;
  IF n.id IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: number_not_sending' USING ERRCODE = '55000';
  END IF;
  -- first contact: the conversation exists without a window (approved templates send regardless of it, P2-1)
  INSERT INTO public.conversations (tenant_id, waba_id, wa_number_id, branch_id, contact_wa_id, patient_id, created_at, updated_at)
  VALUES (p_tenant, n.waba_id, n.id, coalesce(n.branch_id, p_branch), v_phone, v_patient, p_now, p_now)
  ON CONFLICT (tenant_id, wa_number_id, contact_wa_id) DO NOTHING;
  SELECT c.id INTO v_conv FROM public.conversations c WHERE c.tenant_id = p_tenant AND c.wa_number_id = n.id AND c.contact_wa_id = v_phone;
  INSERT INTO public.outbound_messages (tenant_id, branch_id, purpose, category, template_id, patient_id, waba_id, wa_number_id, conversation_id,
                                        contact_wa_id, source_kind, source_id, planned_for, command_key, enqueued_by, enqueued_as, created_at)
  VALUES (p_tenant, p_branch, p_purpose, v_category, t.id, v_patient, n.waba_id, n.id, v_conv, v_phone, p_source_kind, p_source_id, p_planned,
          p_key, p_by, p_as, p_now)
  RETURNING id INTO v_id;
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (p_tenant, p_branch, 'OutboundMessageQueued', 'outbound_message', v_id, p_by, p_as, p_now,
          jsonb_build_object('outbound_id', v_id, 'patient_id', v_patient, 'purpose', p_purpose, 'category', v_category, 'source_kind', p_source_kind,
                             'source_id', p_source_id));
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_enqueue_do(uuid, text, text, uuid, uuid, uuid, text, uuid, date, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint
-- CHECKED: wa_numbers has added_at (no created_at, 0104:35). conversations_guard on INSERT only takes the lock (0105:275).--> statement-breakpoint

-- T-094 dispatch (plan r1 P1-1, P1-3, P1-4 (2)): two steps on an unbound worker connection, replay-safe. outbound_claim locks each tenant,
-- skips promos whose consent is gone (PR-4), holds promos of a suspended tenant, defers new recipients beyond the day's budget (W-06, PR-31),
-- moves the rest queued → sending and returns them with the params built now from the ids (no clinical content, PRIV-15 / BILL-22), the
-- sealed token and the tenant's wrapped DEKs; TypeScript opens the token, calls the port, then outbound_complete records the result.

-- The template params, built at send time from the ids (P1-4 (2)); truncated to the template's param count by the caller.
CREATE FUNCTION public.outbound_params(o public.outbound_messages) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_name text;
  v_branch text;
  v_tz text;
  v_out bigint;
  v_numbers text;
BEGIN
  SELECT pt.full_name INTO v_name FROM public.patients pt WHERE pt.tenant_id = o.tenant_id AND pt.id = o.patient_id;
  SELECT b.name, b.timezone INTO v_branch, v_tz FROM public.branches b
   WHERE b.tenant_id = o.tenant_id AND b.id = coalesce(o.branch_id, (SELECT n.branch_id FROM public.wa_numbers n WHERE n.tenant_id = o.tenant_id AND n.id = o.wa_number_id));
  v_branch := coalesce(v_branch, (SELECT t.legal_name FROM public.tenants t WHERE t.id = o.tenant_id));
  IF o.purpose = 'bill' THEN
    SELECT string_agg(coalesce(i.number, 'tagihan'), ', ' ORDER BY i.issued_at), sum(public.kasir_outstanding(i.tenant_id, i.id))::bigint
      INTO v_numbers, v_out
      FROM public.invoices i WHERE i.tenant_id = o.tenant_id AND i.visit_id = o.source_id AND i.state = 'issued' AND public.kasir_outstanding(i.tenant_id, i.id) > 0;
    -- amount, reference, the clinic's payment channel and an authenticated link — never a treatment name (BILL-22)
    RETURN ARRAY[v_name, coalesce(v_numbers, '-'), 'Rp' || replace(to_char(coalesce(v_out, 0), 'FM999G999G999G999'), ',', '.'),
                 'kasir ' || v_branch, '/tagihan/' || o.source_id::text];
  ELSIF o.purpose = 'care_reminder' THEN
    RETURN ARRAY[v_name, v_branch];
  ELSIF o.purpose = 'aftercare' THEN
    RETURN ARRAY[v_name, '/perawatan/' || o.source_id::text];
  END IF;
  RETURN ARRAY[v_branch];
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_params(public.outbound_messages) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.outbound_claim(p_now timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  tn record;
  o public.outbound_messages;
  t public.wa_templates;
  v_today date;
  v_budget integer;
  v_seen text[];
  v_out jsonb := '[]'::jsonb;
  v_suspended boolean;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'outbound_claim runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  FOR tn IN SELECT DISTINCT o2.tenant_id, o2.waba_id FROM public.outbound_messages o2
             JOIN public.tenants_registry tr ON tr.id = o2.tenant_id AND tr.lifecycle_state IN ('onboarding','live','suspended')
            WHERE o2.state = 'queued' ORDER BY o2.tenant_id, o2.waba_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || tn.tenant_id::text, 0));
    v_suspended := (SELECT tr.lifecycle_state = 'suspended' FROM public.tenants_registry tr WHERE tr.id = tn.tenant_id);
    v_budget := coalesce(public.outbound_budget_limit(tn.tenant_id, tn.waba_id, v_now), 0);
    v_seen := public.outbound_recipients_24h(tn.tenant_id, tn.waba_id, v_now);
    FOR o IN SELECT * FROM public.outbound_messages x
              WHERE x.tenant_id = tn.tenant_id AND x.waba_id = tn.waba_id AND x.state = 'queued'
              ORDER BY x.planned_for, (x.category = 'utility') DESC, x.created_at, x.id FOR UPDATE LOOP
      v_today := (v_now AT TIME ZONE coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = o.tenant_id AND b.id = o.branch_id), 'Asia/Jakarta'))::date;
      CONTINUE WHEN o.planned_for > v_today;
      -- PR-4: a promo whose marketing consent is gone is not sent (no port call, no budget)
      IF o.category = 'marketing' AND NOT EXISTS (SELECT 1 FROM public.consents c WHERE c.tenant_id = o.tenant_id AND c.purpose = 'marketing_wa'
           AND c.withdrawn_at IS NULL AND c.patient_id = ANY (public.patient_cluster(o.tenant_id, o.patient_id))) THEN
        UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'consent_withdrawn', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
        VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,
                jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'consent_withdrawn'));
        CONTINUE;
      END IF;
      -- PR-56: a suspended tenant's promos wait; care messages continue
      IF o.category = 'marketing' AND v_suspended THEN
        UPDATE public.outbound_messages SET planned_for = v_today + 1, rescheduled_count = rescheduled_count + 1, deferred_reason = 'tenant_suspended'
         WHERE tenant_id = o.tenant_id AND id = o.id;
        CONTINUE;
      END IF;
      -- a row that will not send is skipped before the budget, so it never holds a recipient's slot (review r1 P3-1)
      SELECT * INTO t FROM public.wa_templates x WHERE x.tenant_id = o.tenant_id AND x.id = o.template_id;
      IF t.status <> 'approved' OR NOT public.outbound_template_ok(o.tenant_id, t.body) THEN
        UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'template_withdrawn', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
        VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,
                jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'template_withdrawn'));
        CONTINUE;
      END IF;
      IF NOT public.inbox_can_send(o.tenant_id, o.waba_id, o.wa_number_id) THEN
        UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'number_not_sending', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
        VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,
                jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'number_not_sending'));
        CONTINUE;
      END IF;
      -- W-06 / PR-31: a recipient already reached in 24 h costs nothing; a new one beyond the budget waits for the next window
      IF NOT (o.contact_wa_id = ANY (v_seen)) THEN
        IF cardinality(v_seen) >= v_budget THEN
          UPDATE public.outbound_messages SET planned_for = v_today + 1, rescheduled_count = rescheduled_count + 1, deferred_reason = 'budget_reached'
           WHERE tenant_id = o.tenant_id AND id = o.id;
          CONTINUE;
        END IF;
        v_seen := v_seen || o.contact_wa_id;
      END IF;
      UPDATE public.outbound_messages SET state = 'sending', attempt_count = attempt_count + 1, claimed_at = v_now, deferred_reason = NULL
       WHERE tenant_id = o.tenant_id AND id = o.id;
      v_out := v_out || jsonb_build_object(
        'id', o.id, 'tenant_id', o.tenant_id, 'meta_waba_id', (SELECT w.meta_waba_id FROM public.waba_accounts w WHERE w.tenant_id = o.tenant_id AND w.id = o.waba_id),
        'phone_number_id', (SELECT n.phone_number_id FROM public.wa_numbers n WHERE n.tenant_id = o.tenant_id AND n.id = o.wa_number_id),
        'to', o.contact_wa_id, 'template_name', t.name, 'template_language', t.language,
        'params', to_jsonb((public.outbound_params(o))[1:t.param_count]),
        'encrypted_token', (SELECT v.encrypted_token FROM public.token_vault v WHERE v.tenant_id = o.tenant_id AND v.waba_id = o.waba_id AND v.revoked_at IS NULL),
        'keys', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', k.version, 'wrapped', k.wrapped, 'is_current', k.is_current) ORDER BY k.version), '[]'::jsonb)
                   FROM public.tenant_data_keys k WHERE k.tenant_id = o.tenant_id));
    END LOOP;
  END LOOP;
  RETURN v_out;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_claim(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.outbound_claim(timestamptz) TO clinic_app;--> statement-breakpoint

-- The result of one send (unbound): sending → sent (the template recorded in messages, the conversation's last outbound advanced, MessageSent)
-- or failed; idempotent once decided.
CREATE FUNCTION public.outbound_complete(p_id uuid, p_provider_message_id text, p_error_code text, p_now timestamptz DEFAULT NULL) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  o public.outbound_messages;
  v_msg uuid;
BEGIN
  IF public.app_tenant_id() IS NOT NULL OR public.app_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'outbound_complete runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  SELECT x.tenant_id INTO o.tenant_id FROM public.outbound_messages x WHERE x.id = p_id;
  IF o.tenant_id IS NULL THEN
    RAISE EXCEPTION 'outbound message not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || o.tenant_id::text, 0));
  SELECT * INTO o FROM public.outbound_messages x WHERE x.tenant_id = o.tenant_id AND x.id = p_id FOR UPDATE;
  IF o.state IN ('sent','failed','skipped') THEN
    RETURN o.state; -- replay
  END IF;
  IF o.state <> 'sending' THEN
    RAISE EXCEPTION 'outbound message not claimed' USING ERRCODE = '55000';
  END IF;
  IF p_error_code IS NOT NULL THEN
    UPDATE public.outbound_messages SET state = 'failed', error_code = left(p_error_code, 80), decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;
    RETURN 'failed';
  END IF;
  IF coalesce(p_provider_message_id, '') !~ '^[A-Za-z0-9_.:=-]{8,200}$' THEN
    RAISE EXCEPTION 'provider id' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.messages (tenant_id, conversation_id, direction, sent_via, kind, template_id, template_category, provider_message_id, status, sent_at, created_at)
  VALUES (o.tenant_id, o.conversation_id, 'out', 'cloud_api', 'template', o.template_id, o.category, p_provider_message_id, 'sent', v_now, v_now)
  RETURNING id INTO v_msg;
  UPDATE public.conversations SET last_outbound_at = greatest(coalesce(last_outbound_at, v_now), v_now), updated_at = v_now
   WHERE tenant_id = o.tenant_id AND id = o.conversation_id;
  UPDATE public.outbound_messages SET state = 'sent', sent_at = v_now, provider_message_id = p_provider_message_id, message_id = v_msg, decided_at = v_now
   WHERE tenant_id = o.tenant_id AND id = o.id;
  PERFORM public.message_apply_held(o.tenant_id, v_msg, p_provider_message_id);
  INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
  VALUES (o.tenant_id, o.branch_id, 'MessageSent', 'conversation', o.conversation_id, NULL, NULL, v_now,
          jsonb_build_object('conversation_id', o.conversation_id, 'message_id', v_msg, 'outbound_id', o.id));
  RETURN 'sent';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_complete(uuid, text, text, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.outbound_complete(uuid, text, text, timestamptz) TO clinic_app;--> statement-breakpoint

-- T-094 bound writers and the backlog reader (plan r1 P2-2 (2)-(4)). The actor lock first; one clock read (DEC-088); audit only here.

-- Enqueue a care reminder, an aftercare note or a promo. p: {purpose, patient_id, template_id, source_kind, source_id, branch_id?, planned_for?}.
CREATE FUNCTION public.outbound_enqueue(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_purpose text := p ->> 'purpose';
  v_branch uuid;
  v_now timestamptz;
  v_id uuid;
  v_planned date;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role, x.branch_id INTO a FROM public.tenant_actor_lock() x;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR coalesce(v_purpose, '') NOT IN ('care_reminder','aftercare','promo')
     OR p - 'purpose' - 'patient_id' - 'template_id' - 'source_kind' - 'source_id' - 'branch_id' - 'planned_for' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outbound' USING ERRCODE = '22023';
  END IF;
  IF v_purpose = 'promo' AND a.role NOT IN ('marketing','central_cs','owner','admin_pusat')
     OR v_purpose <> 'promo' AND a.role NOT IN ('central_cs','fo_cashier','bc','manager','owner','admin_pusat') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not send this message' USING ERRCODE = '42501';
  END IF;
  -- PR-56: care messages continue while suspended; promos do not
  IF NOT public.tenant_capability(CASE WHEN v_purpose = 'promo' THEN 'marketing_message' ELSE 'care_message' END) THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot send this message now' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_branch := coalesce(NULLIF(p ->> 'branch_id', '')::uuid, a.branch_id);
    v_planned := NULLIF(p ->> 'planned_for', '')::date;
    IF a.branch_id IS NOT NULL AND v_branch IS DISTINCT FROM a.branch_id THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: another branch' USING ERRCODE = '42501';
    END IF;
    v_now := clock_timestamp();
    v_planned := coalesce(v_planned, (v_now AT TIME ZONE coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch), 'Asia/Jakarta'))::date);
    v_id := public.outbound_enqueue_do(a.tenant_id, p_key, v_purpose, (p ->> 'patient_id')::uuid, v_branch, (p ->> 'template_id')::uuid,
                                       p ->> 'source_kind', (p ->> 'source_id')::uuid, v_planned, a.staff_id, a.role, v_now);
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR check_violation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: outbound' USING ERRCODE = '22023';
  END;
  PERFORM public.audit_append('settings_change', 'outbound_message', v_id, 'success', 'outbound_' || v_purpose);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_enqueue(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.outbound_enqueue(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Kirim Tagihan WhatsApp (PR-15, BILL-22): FO/cashier, the manager or the owner at the visit's branch; an open visit with an issued invoice that
-- still owes, and no performed addition left unbilled; the approved utility template `tagihan_kunjungan`. The visit stays blocked until paid
-- or converted to a receivable (unchanged rules).
CREATE FUNCTION public.outbound_bill(p_key text, p_visit uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v public.visits;
  v_tpl uuid;
  v_now timestamptz;
  v_id uuid;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role, x.branch_id INTO a FROM public.tenant_actor_lock() x;
  IF a.role NOT IN ('fo_cashier','manager','owner') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not send a bill' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('cashier') OR NOT public.tenant_capability('care_message') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot send a bill now' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: key' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM public.visits x WHERE x.tenant_id = a.tenant_id AND x.id = p_visit;
  IF v.id IS NULL OR a.branch_id IS NOT NULL AND v.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: visit not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_closed' USING ERRCODE = '55000';
  END IF;
  IF public.addition_unbilled_counted(v.tenant_id, v.id) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: unbilled_addition' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.tenant_id = v.tenant_id AND i.visit_id = v.id AND i.state = 'issued'
                   AND public.kasir_outstanding(i.tenant_id, i.id) > 0) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: nothing_unpaid' USING ERRCODE = '55000';
  END IF;
  SELECT t.id INTO v_tpl FROM public.wa_templates t
   WHERE t.tenant_id = v.tenant_id AND t.name = 'tagihan_kunjungan' AND t.status = 'approved' AND t.category = 'utility'
   ORDER BY t.updated_at DESC, t.id LIMIT 1;
  IF v_tpl IS NULL THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: bill_template_missing' USING ERRCODE = '55000';
  END IF;
  v_now := clock_timestamp();
  v_id := public.outbound_enqueue_do(v.tenant_id, p_key, 'bill', v.patient_id, v.branch_id, v_tpl, 'visit', v.id,
                                     (v_now AT TIME ZONE coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = v.tenant_id AND b.id = v.branch_id), 'Asia/Jakarta'))::date,
                                     a.staff_id, a.role, v_now);
  PERFORM public.audit_append('settings_change', 'outbound_message', v_id, 'success', 'outbound_bill');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_bill(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.outbound_bill(text, uuid) TO clinic_app;--> statement-breakpoint

-- The backlog (Scenario PR-31: the dashboard shows it): queued counts per planned day and purpose, deferred counts by reason; the readers of
-- outbound_readable at their branch scope. Counts only (no identity).
CREATE FUNCTION public.outbound_backlog(p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role, x.branch_id INTO a FROM public.tenant_actor_lock() x;
  IF a.role NOT IN ('owner','admin_pusat','central_cs','marketing','auditor','manager','fo_cashier','bc') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read the outbound backlog' USING ERRCODE = '42501';
  END IF;
  IF p_branch IS NOT NULL AND a.branch_id IS NOT NULL AND p_branch <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: another branch' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('role', a.role,
    'queued', coalesce((SELECT jsonb_agg(jsonb_build_object('planned_for', x.planned_for, 'purpose', x.purpose, 'count', x.n,
                                                            'deferred_budget', x.d_budget, 'deferred_suspended', x.d_susp) ORDER BY x.planned_for, x.purpose)
      FROM (SELECT o.planned_for, o.purpose, count(*)::integer n,
                   count(*) FILTER (WHERE o.deferred_reason = 'budget_reached')::integer d_budget,
                   count(*) FILTER (WHERE o.deferred_reason = 'tenant_suspended')::integer d_susp
              FROM public.outbound_messages o
             WHERE o.tenant_id = a.tenant_id AND o.state = 'queued' AND public.outbound_readable(o.tenant_id, o.branch_id)
               AND (coalesce(p_branch, a.branch_id) IS NULL OR o.branch_id IS NULL OR o.branch_id = coalesce(p_branch, a.branch_id))
             GROUP BY o.planned_for, o.purpose) x), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbound_backlog(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.outbound_backlog(uuid) TO clinic_app;
