CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"channel" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"command_key" text NOT NULL,
	CONSTRAINT "campaigns_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "campaigns_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "campaigns_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "campaigns_check" CHECK ("campaigns"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and length(btrim("campaigns"."name")) between 2 and 120 and "campaigns"."code" ~ '^[a-z0-9][a-z0-9_-]{1,40}$'
      and "campaigns"."channel" in ('whatsapp','instagram','tiktok','website','referral','ads','event','other'))
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"reason" text,
	"appointment_id" uuid,
	"visit_id" uuid,
	"invoice_id" uuid,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "lead_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "lead_events_check" CHECK ("lead_events"."kind" in ('created','stage_changed','reopened','assigned','routed','patient_matched') and "lead_events"."to_stage" in ('new','contacted','booked','arrived','converted','lost')
      and ("lead_events"."from_stage" is null or "lead_events"."from_stage" in ('new','contacted','booked','arrived','converted','lost')) and (("lead_events"."kind" = 'created') = ("lead_events"."from_stage" is null))
      and (("lead_events"."to_stage" = 'lost' and "lead_events"."kind" = 'stage_changed') = ("lead_events"."reason" is not null)))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"source" text NOT NULL,
	"campaign_id" uuid,
	"conversation_id" uuid,
	"patient_id" uuid,
	"contact_name_enc" text,
	"contact_name_dek_ref" text,
	"contact_phone" text,
	"assignee_staff_id" uuid,
	"assigned_at" timestamp with time zone,
	"stage" text DEFAULT 'new' NOT NULL,
	"lost_reason" text,
	"lost_note" text,
	"first_response_at" timestamp with time zone,
	"contacted_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"appointment_id" uuid,
	"visit_id" uuid,
	"converted_invoice_id" uuid,
	"created_by" uuid NOT NULL,
	"created_as" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"command_key" text NOT NULL,
	CONSTRAINT "leads_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "leads_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "leads_check" CHECK ("leads"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$' and "leads"."stage" in ('new','contacted','booked','arrived','converted','lost') and "leads"."source" in ('whatsapp','walk_in','phone','instagram','tiktok','website','referral','ads','other')
      and ("leads"."stage" not in ('contacted','booked','arrived','converted') or ("leads"."contacted_at" is not null and "leads"."first_response_at" is not null))
      and ("leads"."stage" not in ('booked','arrived','converted') or ("leads"."patient_id" is not null and "leads"."branch_id" is not null and "leads"."appointment_id" is not null and "leads"."booked_at" is not null))
      and ("leads"."stage" not in ('arrived','converted') or ("leads"."visit_id" is not null and "leads"."arrived_at" is not null))
      and (("leads"."stage" = 'converted') = ("leads"."converted_invoice_id" is not null and "leads"."converted_at" is not null))
      and (("leads"."stage" = 'lost') = ("leads"."lost_reason" is not null and "leads"."lost_at" is not null))
      and ("leads"."lost_reason" is null or "leads"."lost_reason" in ('harga','jadwal','lokasi','tidak_merespons','memilih_klinik_lain','tidak_cocok','duplikat','lainnya'))
      and ("leads"."lost_reason" is distinct from 'lainnya' or "leads"."lost_note" is not null)
      and ("leads"."lost_note" is null or length(btrim("leads"."lost_note")) between 3 and 500)
      and (("leads"."assignee_staff_id" is null) = ("leads"."assigned_at" is null))
      and (("leads"."contact_name_enc" is null) = ("leads"."contact_name_dek_ref" is null))
      and ("leads"."contact_name_enc" is null or ("leads"."contact_name_enc" ~ '^v1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and "leads"."contact_name_dek_ref" ~ '^dek:v[1-9][0-9]{0,8}$'))
      and ("leads"."contact_phone" is null or "leads"."contact_phone" ~ '^\+[1-9][0-9]{7,14}$')
      and ("leads"."conversation_id" is null or "leads"."source" = 'whatsapp'))
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_tenant_id_lead_id_leads_tenant_id_id_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_tenant_id_appointment_id_appointments_tenant_id_id_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_tenant_id_visit_id_visits_tenant_id_id_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_tenant_id_invoice_id_invoices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_tenant_id_actor_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_conversation_id_conversations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_patient_id_patients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_assignee_staff_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","assignee_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_appointment_id_appointments_tenant_id_id_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_visit_id_visits_tenant_id_id_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_converted_invoice_id_invoices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","converted_invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_created_by_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("tenant_id","lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_open_conversation_key" ON "leads" USING btree ("tenant_id","conversation_id") WHERE "leads"."conversation_id" is not null and "leads"."stage" not in ('converted','lost');--> statement-breakpoint
CREATE UNIQUE INDEX "leads_open_patient_key" ON "leads" USING btree ("tenant_id","patient_id") WHERE "leads"."patient_id" is not null and "leads"."stage" not in ('converted','lost');--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("tenant_id","branch_id","stage");--> statement-breakpoint

-- T-092 rules (generated by gen.py; plan docs/tasks/T-092.md)
-- ── T-092 (PR-29, DATA-39, UX-18, TD-24; plan Argon 0fb1febb REVISE adopted, 231572ab APPROVE): predicates, guards, the first-response
-- trigger, the stage fact helpers. Every kasir / scheduling fact is evaluated inside the definers (r2 P3-3). ──

-- Readers (r1 open point 3): owner, central_cs, marketing (masked), auditor (masked) tenant-wide; manager its branches; bc its own and the
-- unassigned leads of its branches (unrouted ones too, to claim them).
CREATE FUNCTION public.leads_readable(p_tenant uuid, p_branch uuid, p_assignee uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
           public.app_acting_role() = ANY (ARRAY['owner','central_cs','marketing','auditor'])
        OR public.app_acting_role() = 'manager' AND (p_branch IS NULL OR public.app_branch_allowed(p_branch))
        OR public.app_acting_role() = 'bc' AND (p_branch IS NULL OR public.app_branch_allowed(p_branch))
           AND (p_assignee IS NULL OR p_assignee = public.app_staff_id())), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.leads_readable(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.leads_readable(uuid, uuid, uuid) TO clinic_app;--> statement-breakpoint
CREATE FUNCTION public.campaigns_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant)
    AND public.app_acting_role() = ANY (ARRAY['owner','admin_pusat','marketing','central_cs','manager','bc','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaigns_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaigns_readable(uuid) TO clinic_app;--> statement-breakpoint

-- Guards (r1 P1-3): never deleted; identity frozen; a conversation link, a branch and a first response never cleared; the stage only moves along
-- the allowed edges (forward one step, any open stage → lost, lost → new); converted is final. Events are insert-only.
CREATE FUNCTION public.campaigns_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'campaigns are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.code, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.code, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at) THEN
    RAISE EXCEPTION 'a campaign keeps its code' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaigns_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER campaigns_guard BEFORE INSERT OR UPDATE OR DELETE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.campaigns_guard();--> statement-breakpoint
ALTER TABLE public.campaigns ENABLE ALWAYS TRIGGER campaigns_guard;--> statement-breakpoint

CREATE FUNCTION public.lead_stage_edge(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_from = p_to
      OR (p_from, p_to) IN (('new','contacted'), ('contacted','booked'), ('booked','arrived'), ('arrived','converted'), ('lost','new'))
      OR p_to = 'lost' AND p_from IN ('new','contacted','booked','arrived')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_stage_edge(text, text) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.leads_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'leads are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage <> 'new' THEN
      RAISE EXCEPTION 'a lead starts new' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.source, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.source, OLD.command_key, OLD.created_by, OLD.created_as, OLD.created_at)
     OR OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR OLD.branch_id IS NOT NULL AND NEW.branch_id IS NULL
     OR OLD.first_response_at IS NOT NULL AND NEW.first_response_at IS DISTINCT FROM OLD.first_response_at
     OR OLD.stage = 'converted' AND to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at'
     OR NOT public.lead_stage_edge(OLD.stage, NEW.stage) THEN
    RAISE EXCEPTION 'a lead keeps its identity; its stage moves along the pipeline only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.leads_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER leads_guard BEFORE INSERT OR UPDATE OR DELETE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.leads_guard();--> statement-breakpoint
ALTER TABLE public.leads ENABLE ALWAYS TRIGGER leads_guard;--> statement-breakpoint

CREATE FUNCTION public.lead_events_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'lead history never changes' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_events_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER lead_events_guard BEFORE UPDATE OR DELETE ON public.lead_events FOR EACH ROW EXECUTE FUNCTION public.lead_events_guard();--> statement-breakpoint
ALTER TABLE public.lead_events ENABLE ALWAYS TRIGGER lead_events_guard;--> statement-breakpoint

-- The first response (TD-24, r1 P2-1; r2 P3-2: SECURITY INVOKER — conversations is updated only inside definers or by the owner): the first
-- staff reply or Coexistence echo on a conversation stamps its leads that have none.
CREATE FUNCTION public.conversations_lead_first_response() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.first_response_at IS NULL AND NEW.first_response_at IS NOT NULL THEN
    UPDATE public.leads SET first_response_at = NEW.first_response_at, updated_at = NEW.updated_at
     WHERE tenant_id = NEW.tenant_id AND conversation_id = NEW.id AND first_response_at IS NULL;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.conversations_lead_first_response() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER conversations_lead_first_response AFTER UPDATE OF first_response_at ON public.conversations FOR EACH ROW
  EXECUTE FUNCTION public.conversations_lead_first_response();--> statement-breakpoint
ALTER TABLE public.conversations ENABLE ALWAYS TRIGGER conversations_lead_first_response;--> statement-breakpoint

-- includes applied DP; minus what moved to balance and pending refunds), or when the lead's visit has a collected receivable.
CREATE FUNCTION public.lead_paid_invoice(p_tenant uuid, p_cluster uuid[], p_visit uuid, p_invoice uuid, p_since timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.id FROM public.invoices i
   WHERE i.tenant_id = p_tenant AND i.state = 'issued' AND i.patient_id = ANY (p_cluster)
     AND (p_invoice IS NULL OR i.id = p_invoice)
     AND (i.visit_id = p_visit OR (i.visit_id IS NULL AND NOT i.counter AND i.issued_at >= p_since))
     AND (EXISTS (SELECT 1 FROM public.invoice_lines il WHERE il.tenant_id = i.tenant_id AND il.invoice_id = i.id
                   AND public.kasir_line_paid(il.tenant_id, il.id) - il.moved_to_balance - public.refund_reserved(il.tenant_id, il.id) > 0)
          OR i.visit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.receivables r WHERE r.tenant_id = i.tenant_id AND r.visit_id = i.visit_id AND r.collected_amount > 0))
   ORDER BY i.issued_at DESC, i.id LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_paid_invoice(uuid, uuid[], uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- booked: a live appointment of the cluster (booked / confirmed / arrived), the one named or the latest created since the lead.
CREATE FUNCTION public.lead_live_appointment(p_tenant uuid, p_cluster uuid[], p_branch uuid, p_appointment uuid, p_since timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ap.id FROM public.appointments ap
   WHERE ap.tenant_id = p_tenant AND ap.patient_id = ANY (p_cluster) AND ap.state IN ('booked','confirmed','arrived')
     AND (p_branch IS NULL OR ap.branch_id = p_branch)
     AND (p_appointment IS NULL OR ap.id = p_appointment)
     AND (p_appointment IS NOT NULL OR ap.created_at >= p_since OR ap.starts_at >= p_since)
   ORDER BY ap.created_at DESC, ap.id LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_live_appointment(uuid, uuid[], uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- arrived: a checked-in visit of the cluster at the lead's branch — the one named, the booked appointment's, or one checked in since the lead.
CREATE FUNCTION public.lead_checked_in_visit(p_tenant uuid, p_cluster uuid[], p_branch uuid, p_visit uuid, p_appointment uuid, p_since timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT v.id FROM public.visits v
   WHERE v.tenant_id = p_tenant AND v.patient_id = ANY (p_cluster) AND v.branch_id = p_branch
     AND (p_visit IS NULL OR v.id = p_visit)
     AND (p_visit IS NOT NULL OR v.appointment_id = p_appointment OR v.checked_in_at >= p_since)
   ORDER BY (v.appointment_id = p_appointment) DESC NULLS LAST, v.checked_in_at DESC, v.id LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_checked_in_visit(uuid, uuid[], uuid, uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY campaigns_read ON public.campaigns FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.campaigns_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.campaigns TO clinic_app;--> statement-breakpoint
CREATE POLICY campaigns_operator_read ON public.campaigns FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.campaigns', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.campaigns TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY leads_read ON public.leads FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.leads_readable(tenant_id, branch_id, assignee_staff_id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, source, campaign_id, conversation_id, patient_id, assignee_staff_id, assigned_at, stage, lost_reason, first_response_at, contacted_at, booked_at, arrived_at, converted_at, lost_at, appointment_id, visit_id, converted_invoice_id, created_by, created_as, created_at, updated_at, command_key) ON public.leads TO clinic_app;--> statement-breakpoint
CREATE POLICY leads_operator_read ON public.leads FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.leads', tenant_id, id));--> statement-breakpoint
GRANT SELECT (id, tenant_id, branch_id, source, campaign_id, conversation_id, patient_id, assignee_staff_id, assigned_at, stage, lost_reason, first_response_at, contacted_at, booked_at, arrived_at, converted_at, lost_at, appointment_id, visit_id, converted_invoice_id, created_by, created_as, created_at, updated_at, command_key) ON public.leads TO clinic_operator;--> statement-breakpoint
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY lead_events_read ON public.lead_events FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND EXISTS (SELECT 1 FROM public.leads l WHERE l.tenant_id = lead_events.tenant_id AND l.id = lead_events.lead_id AND public.leads_readable(l.tenant_id, l.branch_id, l.assignee_staff_id)));--> statement-breakpoint
GRANT SELECT ON public.lead_events TO clinic_app;--> statement-breakpoint
CREATE POLICY lead_events_operator_read ON public.lead_events FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.lead_events', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.lead_events TO clinic_operator;--> statement-breakpoint
CREATE TRIGGER campaigns_no_truncate BEFORE TRUNCATE ON public.campaigns FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.campaigns ENABLE ALWAYS TRIGGER campaigns_no_truncate;--> statement-breakpoint
CREATE TRIGGER leads_no_truncate BEFORE TRUNCATE ON public.leads FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.leads ENABLE ALWAYS TRIGGER leads_no_truncate;--> statement-breakpoint
CREATE TRIGGER lead_events_no_truncate BEFORE TRUNCATE ON public.lead_events FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.lead_events ENABLE ALWAYS TRIGGER lead_events_no_truncate;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.campaigns', 'tenant-shared', 'crm', '{owner,admin_pusat,marketing,central_cs,manager,bc,auditor}', 'campaign_save (src/modules/crm/leads)', 'none (tenant-wide)'),
  ('public.leads', 'tenant-shared', 'crm', '{owner,central_cs,marketing,auditor,manager,bc}', 'lead definers (src/modules/crm/leads)', 'the lead''s branch, or unrouted'),
  ('public.lead_events', 'tenant-shared', 'crm', '{owner,central_cs,marketing,auditor,manager,bc}', 'lead definers (src/modules/crm/leads)', 'the lead''s branch');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.campaigns', 'config'), ('public.leads', 'personal'), ('public.lead_events', 'personal');--> statement-breakpoint

-- ── T-092: writers (r1 P1-1, P1-2, P2-2, P3-2; open points 1, 4, 6). The actor lock first, one clock read after the locks (DEC-088). ──

-- The lead actor: central_cs (tenant-wide), bc (own, its active branch), manager (its active branch).
CREATE FUNCTION public.lead_actor(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('central_cs','bc','manager') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not work leads' USING ERRCODE = '42501';
  END IF;
  IF role <> 'central_cs' AND branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: choose a branch first' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_actor() FROM PUBLIC;--> statement-breakpoint

-- The actor's lead, locked, or not found (another tenant's, another branch, or — for a BC — another staff member's).
CREATE FUNCTION public.lead_for(a record, p_lead uuid) RETURNS public.leads
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.leads;
BEGIN
  SELECT * INTO l FROM public.leads x WHERE x.tenant_id = a.tenant_id AND x.id = p_lead FOR UPDATE;
  IF l.id IS NULL OR NOT public.leads_readable(l.tenant_id, l.branch_id, l.assignee_staff_id)
     OR a.branch_id IS NOT NULL AND l.branch_id IS NOT NULL AND l.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: lead not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN l;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_for(record, uuid) FROM PUBLIC;--> statement-breakpoint

-- Another open lead for the patient cluster (one open lead per patient, DEC-061 across merges).
CREATE FUNCTION public.lead_open_for_cluster(p_tenant uuid, p_patient uuid, p_except uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_patient IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads x WHERE x.tenant_id = p_tenant AND x.stage NOT IN ('converted','lost')
    AND x.id IS DISTINCT FROM p_except AND x.patient_id = ANY (public.patient_cluster(p_tenant, public.patient_canonical(p_tenant, p_patient))))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_open_for_cluster(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- The history row, the audit row and LeadStatusChanged (ids and codes only).
CREATE FUNCTION public.lead_logged(a record, l public.leads, p_kind text, p_from text, p_reason text, p_now timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.lead_events (tenant_id, lead_id, kind, from_stage, to_stage, reason, appointment_id, visit_id, invoice_id, actor_id, actor_role, created_at)
  VALUES (l.tenant_id, l.id, p_kind, p_from, l.stage, p_reason,
          CASE WHEN p_kind = 'stage_changed' AND l.stage = 'booked' THEN l.appointment_id END,
          CASE WHEN p_kind = 'stage_changed' AND l.stage = 'arrived' THEN l.visit_id END,
          CASE WHEN p_kind = 'stage_changed' AND l.stage = 'converted' THEN l.converted_invoice_id END, a.staff_id, a.role, p_now);
  PERFORM public.audit_append('settings_change', 'lead', l.id, 'success', 'lead_' || p_kind);
  IF p_kind IN ('created','stage_changed','reopened') THEN
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
    VALUES (l.tenant_id, l.branch_id, 'LeadStatusChanged', 'lead', l.id, a.staff_id, a.role, p_now,
            jsonb_strip_nulls(jsonb_build_object('lead_id', l.id, 'from_stage', p_from, 'to_stage', l.stage, 'source', l.source)));
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_logged(record, public.leads, text, text, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Create a lead (r1 P3-2): from a conversation (whatsapp; branch, patient and first response from it) or by hand (a source). p: {source,
-- conversation_id?, patient_id?, branch_id?, campaign_id?, contact_name_enc?, contact_name_dek_ref?, contact_phone?}.
CREATE FUNCTION public.lead_create(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.lead_actor();
  c public.conversations;
  l public.leads;
  v_id uuid;
  v_branch uuid;
  v_patient uuid;
  v_now timestamptz;
  v_source text := p ->> 'source';
BEGIN
  SELECT x.id INTO v_id FROM public.leads x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF NOT public.tenant_capability('new_booking') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot take new leads now' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'source' - 'conversation_id' - 'patient_id' - 'branch_id' - 'campaign_id' - 'contact_name_enc' - 'contact_name_dek_ref' - 'contact_phone' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: lead' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch := NULLIF(p ->> 'branch_id', '')::uuid;
    v_patient := NULLIF(p ->> 'patient_id', '')::uuid;
    IF p ? 'conversation_id' THEN
      SELECT * INTO c FROM public.conversations x WHERE x.tenant_id = a.tenant_id AND x.id = (p ->> 'conversation_id')::uuid FOR UPDATE;
      IF c.id IS NULL OR NOT public.inbox_readable(c.tenant_id, c.branch_id) OR NOT (a.branch_id IS NULL OR c.branch_id IS NULL OR c.branch_id = a.branch_id) THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: conversation not found' USING ERRCODE = 'P0002';
      END IF;
      v_source := 'whatsapp';
      v_branch := coalesce(v_branch, c.branch_id);
      v_patient := coalesce(v_patient, c.patient_id);
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: id' USING ERRCODE = '22023';
  END;
  v_branch := coalesce(v_branch, a.branch_id);
  IF a.branch_id IS NOT NULL AND v_branch IS DISTINCT FROM a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: lead for another branch' USING ERRCODE = '42501';
  END IF;
  IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = v_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_patient IS NOT NULL THEN
    v_patient := public.patient_canonical(a.tenant_id, v_patient);
    IF NOT EXISTS (SELECT 1 FROM public.patients x WHERE x.tenant_id = a.tenant_id AND x.id = v_patient) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
    END IF;
    IF public.lead_open_for_cluster(a.tenant_id, v_patient, NULL) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: open_lead_exists' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF p ? 'campaign_id' AND NOT EXISTS (SELECT 1 FROM public.campaigns x WHERE x.tenant_id = a.tenant_id AND x.id = (p ->> 'campaign_id')::uuid AND x.active) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: campaign not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := clock_timestamp();
  INSERT INTO public.leads (tenant_id, branch_id, source, campaign_id, conversation_id, patient_id, contact_name_enc, contact_name_dek_ref, contact_phone,
                            assignee_staff_id, assigned_at, first_response_at, created_by, created_as, created_at, updated_at, command_key)
  VALUES (a.tenant_id, v_branch, v_source, NULLIF(p ->> 'campaign_id', '')::uuid, c.id, v_patient, p ->> 'contact_name_enc', p ->> 'contact_name_dek_ref',
          NULLIF(p ->> 'contact_phone', ''), CASE WHEN a.role = 'bc' THEN a.staff_id END, CASE WHEN a.role = 'bc' THEN v_now END, c.first_response_at,
          a.staff_id, a.role, v_now, v_now, p_key)
  RETURNING * INTO l;
  PERFORM public.lead_logged(a, l, 'created', NULL, NULL, v_now);
  RETURN l.id;
EXCEPTION WHEN check_violation OR invalid_text_representation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: lead' USING ERRCODE = '22023';
WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_VERSION_CONFLICT: open_lead_exists' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_create(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lead_create(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Assign / take, release, route, match a patient, choose a campaign. p: {action: assign|unassign|route|match|campaign, staff_id?, branch_id?,
-- patient_id?, campaign_id?}. A BC only takes (assigns to itself) and releases its own.
CREATE FUNCTION public.lead_update(p_lead uuid, p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.lead_actor();
  l public.leads;
  v_now timestamptz;
  v_action text := p ->> 'action';
  v_id uuid;
BEGIN
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change leads now' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(v_action, '') NOT IN ('assign','unassign','route','match','campaign')
     OR p - 'action' - 'staff_id' - 'branch_id' - 'patient_id' - 'campaign_id' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: update' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_id := coalesce(p ->> 'staff_id', p ->> 'branch_id', p ->> 'patient_id', p ->> 'campaign_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: id' USING ERRCODE = '22023';
  END;
  l := public.lead_for(a, p_lead);
  IF l.stage IN ('converted','lost') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: lead_closed' USING ERRCODE = '55000';
  END IF;
  v_now := clock_timestamp();
  IF v_action = 'assign' THEN
    IF a.role = 'bc' AND v_id IS DISTINCT FROM a.staff_id THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: a BC takes leads for itself' USING ERRCODE = '42501';
    END IF;
    -- an active member with a lead role who may work this lead's branch
    IF NOT EXISTS (SELECT 1 FROM public.staff s JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                    WHERE s.tenant_id = l.tenant_id AND s.id = v_id AND m.effective_from <= v_now AND (m.effective_to IS NULL OR m.effective_to > v_now)
                      AND (EXISTS (SELECT 1 FROM public.staff_roles r WHERE r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = 'central_cs')
                        OR EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.tenant_id = s.tenant_id AND sb.staff_id = s.id AND sb.role IN ('bc','manager')
                                     AND (l.branch_id IS NULL OR sb.branch_id = l.branch_id)))) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.leads SET assignee_staff_id = v_id, assigned_at = v_now, updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSIF v_action = 'unassign' THEN
    UPDATE public.leads SET assignee_staff_id = NULL, assigned_at = NULL, updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSIF v_action = 'route' THEN
    IF l.branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: already_routed' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = l.tenant_id AND b.id = v_id) OR a.branch_id IS NOT NULL AND v_id <> a.branch_id THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.leads SET branch_id = v_id, updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSIF v_action = 'match' THEN
    v_id := public.patient_canonical(l.tenant_id, v_id);
    IF NOT EXISTS (SELECT 1 FROM public.patients x WHERE x.tenant_id = l.tenant_id AND x.id = v_id) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: patient not found' USING ERRCODE = 'P0002';
    END IF;
    IF public.lead_open_for_cluster(l.tenant_id, v_id, l.id) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: open_lead_exists' USING ERRCODE = '55000';
    END IF;
    UPDATE public.leads SET patient_id = v_id, updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSE
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.campaigns x WHERE x.tenant_id = l.tenant_id AND x.id = v_id AND x.active) THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: campaign not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.leads SET campaign_id = v_id, updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  END IF;
  PERFORM public.lead_logged(a, l, CASE v_action WHEN 'assign' THEN 'assigned' WHEN 'unassign' THEN 'assigned' WHEN 'route' THEN 'routed'
                                                 WHEN 'match' THEN 'patient_matched' ELSE 'assigned' END, l.stage, NULL, v_now);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: update' USING ERRCODE = '22023';
WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_VERSION_CONFLICT: open_lead_exists' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_update(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lead_update(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Ubah Status (r1 P1-1): forward one step with its fact, lost with a reason, reopen a lost lead. p: {to, appointment_id?, visit_id?,
-- invoice_id?, reason?, note?}. Converted needs a real payment (Scenario PR-29).
CREATE FUNCTION public.lead_stage_set(p_lead uuid, p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.lead_actor();
  l public.leads;
  c public.conversations;
  v_to text := p ->> 'to';
  v_from text;
  v_now timestamptz;
  v_cluster uuid[];
  v_ref uuid;
  v_found uuid;
BEGIN
  IF NOT public.tenant_capability('existing_appointment') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: the tenant cannot change leads now' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(v_to, '') NOT IN ('contacted','booked','arrived','converted','lost','new')
     OR p - 'to' - 'appointment_id' - 'visit_id' - 'invoice_id' - 'reason' - 'note' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: stage' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_ref := coalesce(p ->> 'appointment_id', p ->> 'visit_id', p ->> 'invoice_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: id' USING ERRCODE = '22023';
  END;
  l := public.lead_for(a, p_lead);
  v_from := l.stage;
  IF v_from = v_to OR NOT public.lead_stage_edge(v_from, v_to) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: stage_order' USING ERRCODE = '55000';
  END IF;
  v_now := clock_timestamp();
  v_cluster := CASE WHEN l.patient_id IS NOT NULL THEN public.patient_cluster(l.tenant_id, public.patient_canonical(l.tenant_id, l.patient_id)) END;
  IF v_to = 'contacted' THEN
    IF l.conversation_id IS NOT NULL THEN
      SELECT * INTO c FROM public.conversations x WHERE x.tenant_id = l.tenant_id AND x.id = l.conversation_id;
    END IF;
    UPDATE public.leads SET stage = 'contacted', contacted_at = v_now, first_response_at = coalesce(first_response_at, c.first_response_at, v_now), updated_at = v_now
     WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSIF v_to = 'booked' THEN
    IF l.patient_id IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: match_patient_first' USING ERRCODE = '55000';
    END IF;
    v_found := public.lead_live_appointment(l.tenant_id, v_cluster, l.branch_id, CASE WHEN p ? 'appointment_id' THEN v_ref END, l.created_at);
    IF v_found IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: appointment_required' USING ERRCODE = '55000';
    END IF;
    IF a.branch_id IS NOT NULL AND (SELECT ap.branch_id FROM public.appointments ap WHERE ap.tenant_id = l.tenant_id AND ap.id = v_found) <> a.branch_id THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: appointment_required' USING ERRCODE = '55000';
    END IF;
    UPDATE public.leads SET stage = 'booked', booked_at = v_now, appointment_id = v_found, updated_at = v_now,
           branch_id = coalesce(branch_id, (SELECT ap.branch_id FROM public.appointments ap WHERE ap.tenant_id = l.tenant_id AND ap.id = v_found))
     WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSIF v_to = 'arrived' THEN
    v_found := public.lead_checked_in_visit(l.tenant_id, v_cluster, l.branch_id, CASE WHEN p ? 'visit_id' THEN v_ref END, l.appointment_id, l.created_at);
    IF v_found IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: visit_required' USING ERRCODE = '55000';
    END IF;
    UPDATE public.leads SET stage = 'arrived', arrived_at = v_now, visit_id = v_found, updated_at = v_now WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSIF v_to = 'converted' THEN
    v_found := public.lead_paid_invoice(l.tenant_id, v_cluster, l.visit_id, CASE WHEN p ? 'invoice_id' THEN v_ref END, l.created_at);
    IF v_found IS NULL THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: payment_required' USING ERRCODE = '55000';
    END IF;
    UPDATE public.leads SET stage = 'converted', converted_at = v_now, converted_invoice_id = v_found, updated_at = v_now
     WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSIF v_to = 'lost' THEN
    IF coalesce(p ->> 'reason', '') NOT IN ('harga','jadwal','lokasi','tidak_merespons','memilih_klinik_lain','tidak_cocok','duplikat','lainnya')
       OR p ->> 'reason' = 'lainnya' AND length(btrim(coalesce(p ->> 'note', ''))) < 3 THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: lost_reason' USING ERRCODE = '22023';
    END IF;
    UPDATE public.leads SET stage = 'lost', lost_reason = p ->> 'reason', lost_note = NULLIF(btrim(coalesce(p ->> 'note', '')), ''), lost_at = v_now, updated_at = v_now
     WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  ELSE
    -- reopen: one open lead per conversation and patient cluster; the funnel facts cleared, the first response kept
    IF public.lead_open_for_cluster(l.tenant_id, l.patient_id, l.id)
       OR l.conversation_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads x WHERE x.tenant_id = l.tenant_id AND x.conversation_id = l.conversation_id
                                                     AND x.id <> l.id AND x.stage NOT IN ('converted','lost')) THEN
      RAISE EXCEPTION 'ERR_VERSION_CONFLICT: open_lead_exists' USING ERRCODE = '55000';
    END IF;
    UPDATE public.leads SET stage = 'new', lost_reason = NULL, lost_note = NULL, lost_at = NULL, contacted_at = NULL, booked_at = NULL, arrived_at = NULL,
           appointment_id = NULL, visit_id = NULL, updated_at = v_now
     WHERE tenant_id = l.tenant_id AND id = l.id RETURNING * INTO l;
  END IF;
  PERFORM public.lead_logged(a, l, CASE WHEN v_to = 'new' THEN 'reopened' ELSE 'stage_changed' END, v_from,
                             CASE WHEN v_to = 'lost' THEN p ->> 'reason' END, v_now);
  RETURN l.stage;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: stage' USING ERRCODE = '22023';
WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_VERSION_CONFLICT: open_lead_exists' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_stage_set(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lead_stage_set(uuid, jsonb) TO clinic_app;--> statement-breakpoint

-- Save a campaign (owner, admin_pusat, marketing; configuration). p: {id?, name, code, channel, active?} — an id edits name/channel/active.
CREATE FUNCTION public.campaign_save(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_id uuid;
  v_now timestamptz;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF a.role NOT IN ('owner','admin_pusat','marketing') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not manage campaigns' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_capability('configuration') THEN
    RAISE EXCEPTION 'ERR_TENANT_SUSPENDED: configuration is not available now' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_key, '') !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'id' - 'name' - 'code' - 'channel' - 'active' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: campaign' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  IF p ? 'id' THEN
    UPDATE public.campaigns SET name = coalesce(p ->> 'name', name), channel = coalesce(p ->> 'channel', channel),
           active = coalesce((p ->> 'active')::boolean, active), updated_at = v_now
     WHERE tenant_id = a.tenant_id AND id = (p ->> 'id')::uuid RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: campaign not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT x.id INTO v_id FROM public.campaigns x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
    INSERT INTO public.campaigns (tenant_id, name, code, channel, active, created_by, created_as, created_at, updated_at, command_key)
    VALUES (a.tenant_id, btrim(p ->> 'name'), p ->> 'code', p ->> 'channel', coalesce((p ->> 'active')::boolean, true), a.staff_id, a.role, v_now, v_now, p_key)
    RETURNING id INTO v_id;
  END IF;
  PERFORM public.audit_append('settings_change', 'campaign', v_id, 'success', 'campaign_saved');
  RETURN v_id;
EXCEPTION WHEN check_violation OR invalid_text_representation THEN
  RAISE EXCEPTION 'ERR_INVALID_INPUT: campaign' USING ERRCODE = '22023';
WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_VERSION_CONFLICT: campaign_code_taken' USING ERRCODE = '55000';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_save(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_save(text, jsonb) TO clinic_app;--> statement-breakpoint

-- ── T-092: readers (r1 P1-2, P2-1; r2 P3-4). The masked projections: marketing sees identity only with an active marketing_wa consent on the
-- patient cluster (PR-63, TEN-18), the auditor never (IAM-12, the MRN tail); nobody but the full readers gets the lost note. Sealed contact
-- names are returned to the server, which opens them for the reader allowed to see them. One clock read. ──

CREATE FUNCTION public.lead_json(l public.leads, p_role text, p_now timestamptz, p_sla integer, p_full boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH p AS (
    SELECT public.patient_canonical(l.tenant_id, l.patient_id) AS canon),
  k AS (
    SELECT p.canon, CASE WHEN p.canon IS NOT NULL THEN public.patient_cluster(l.tenant_id, p.canon) ELSE '{}'::uuid[] END AS cluster FROM p),
  m AS (
    SELECT k.canon, k.cluster, (k.canon IS NOT NULL AND EXISTS (SELECT 1 FROM public.consents c WHERE c.tenant_id = l.tenant_id AND c.purpose = 'marketing_wa'
            AND c.withdrawn_at IS NULL AND c.patient_id = ANY (k.cluster))) AS consent FROM k),
  v AS (
    SELECT m.*, (p_role IN ('central_cs','bc','manager','owner') OR p_role = 'marketing' AND m.consent) AS identity FROM m)
  SELECT jsonb_build_object(
    'id', l.id, 'branch_id', l.branch_id, 'branch_name', (SELECT b.name FROM public.branches b WHERE b.tenant_id = l.tenant_id AND b.id = l.branch_id),
    'source', l.source, 'campaign_id', l.campaign_id,
    'campaign_name', (SELECT c.name FROM public.campaigns c WHERE c.tenant_id = l.tenant_id AND c.id = l.campaign_id),
    'conversation_id', CASE WHEN p_role IN ('central_cs','bc','manager','owner') THEN l.conversation_id END,
    'patient_id', CASE WHEN v.identity OR p_role = 'auditor' THEN v.canon END,
    'patient_name', CASE WHEN v.identity THEN (SELECT pt.full_name FROM public.patients pt WHERE pt.tenant_id = l.tenant_id AND pt.id = v.canon) END,
    'patient_mrn', CASE WHEN v.identity THEN (SELECT pt.mrn FROM public.patients pt WHERE pt.tenant_id = l.tenant_id AND pt.id = v.canon)
                        WHEN p_role = 'auditor' THEN (SELECT '***' || right(pt.mrn, 3) FROM public.patients pt WHERE pt.tenant_id = l.tenant_id AND pt.id = v.canon) END,
    'contact_name_enc', CASE WHEN v.identity THEN coalesce(l.contact_name_enc,
        (SELECT cv.contact_name_enc FROM public.conversations cv WHERE cv.tenant_id = l.tenant_id AND cv.id = l.conversation_id)) END,
    'contact_name_source', CASE WHEN v.identity THEN CASE WHEN l.contact_name_enc IS NOT NULL THEN 'lead' WHEN l.conversation_id IS NOT NULL THEN 'conversation' END END,
    'contact_phone', CASE WHEN v.identity THEN coalesce(l.contact_phone,
        (SELECT '+' || cv.contact_wa_id FROM public.conversations cv WHERE cv.tenant_id = l.tenant_id AND cv.id = l.conversation_id)) END,
    'assignee_staff_id', l.assignee_staff_id,
    'assignee_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = l.tenant_id AND s.id = l.assignee_staff_id),
    'stage', l.stage, 'lost_reason', l.lost_reason, 'lost_note', CASE WHEN p_role IN ('central_cs','bc','manager','owner') THEN l.lost_note END,
    'marketing_consent', v.consent, 'consent_masked', NOT v.identity,
    'first_response_at', l.first_response_at, 'contacted_at', l.contacted_at, 'booked_at', l.booked_at, 'arrived_at', l.arrived_at,
    'converted_at', l.converted_at, 'lost_at', l.lost_at, 'created_at', l.created_at,
    'appointment_id', l.appointment_id, 'visit_id', l.visit_id, 'converted_invoice_id', l.converted_invoice_id,
    'sla_minutes', p_sla,
    'response_minutes', CASE WHEN l.first_response_at IS NOT NULL THEN floor(extract(epoch FROM l.first_response_at - l.created_at) / 60)::integer END,
    'sla_overdue', l.first_response_at IS NULL AND l.stage = 'new' AND p_now > l.created_at + make_interval(mins => p_sla))
  || CASE WHEN p_full THEN jsonb_build_object(
       -- readiness for the next step (the facts the definer will check; r1 P2-4: "Belum ada pembayaran untuk konversi")
       'next_appointment_id', CASE WHEN l.stage = 'contacted' AND v.canon IS NOT NULL THEN public.lead_live_appointment(l.tenant_id, v.cluster, l.branch_id, NULL, l.created_at) END,
       'next_visit_id', CASE WHEN l.stage = 'booked' THEN public.lead_checked_in_visit(l.tenant_id, v.cluster, l.branch_id, NULL, l.appointment_id, l.created_at) END,
       'next_invoice_id', CASE WHEN l.stage = 'arrived' THEN public.lead_paid_invoice(l.tenant_id, v.cluster, l.visit_id, NULL, l.created_at) END,
       'events', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'from_stage', e.from_stage, 'to_stage', e.to_stage, 'reason', e.reason,
           'actor_name', (SELECT s.display_name FROM public.staff s WHERE s.tenant_id = e.tenant_id AND s.id = e.actor_id), 'at', e.created_at) ORDER BY e.created_at, e.id)
         FROM public.lead_events e WHERE e.tenant_id = l.tenant_id AND e.lead_id = l.id), '[]'::jsonb))
     ELSE '{}'::jsonb END
  FROM v
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_json(public.leads, text, timestamptz, integer, boolean) FROM PUBLIC;--> statement-breakpoint

-- The lead reader: the actor lock first; the lead readers.
CREATE FUNCTION public.lead_reader(OUT tenant_id uuid, OUT staff_id uuid, OUT role text, OUT branch_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT a.tenant_id, a.staff_id, a.role, a.branch_id INTO tenant_id, staff_id, role, branch_id FROM public.tenant_actor_lock() a;
  IF role NOT IN ('owner','central_cs','marketing','auditor','manager','bc') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read leads' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_reader() FROM PUBLIC;--> statement-breakpoint

-- The list: a stage filter (all | open | <stage>) and a scope (all | mine | unassigned); counts per stage.
CREATE FUNCTION public.lead_list(p_stage text, p_scope text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.lead_reader();
  v_now timestamptz;
  v_sla integer;
BEGIN
  IF coalesce(p_stage, 'open') NOT IN ('open','all','new','contacted','booked','arrived','converted','lost') OR coalesce(p_scope, 'all') NOT IN ('all','mine','unassigned') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: filter' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  v_sla := coalesce((public.setting_value_at('SET-20', NULL, v_now) #>> '{}')::integer, 15);
  RETURN jsonb_build_object('role', a.role, 'can_write', a.role IN ('central_cs','bc','manager'), 'now', v_now, 'sla_minutes', v_sla,
    'counts', (SELECT coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) FROM (SELECT l.stage, count(*) n FROM public.leads l
                WHERE l.tenant_id = a.tenant_id AND public.leads_readable(l.tenant_id, l.branch_id, l.assignee_staff_id)
                  AND (a.branch_id IS NULL OR l.branch_id IS NULL OR l.branch_id = a.branch_id) GROUP BY l.stage) s),
    'leads', coalesce((SELECT jsonb_agg(public.lead_json(l, a.role, v_now, v_sla, false) ORDER BY l.updated_at DESC, l.id)
      FROM (SELECT * FROM public.leads l
             WHERE l.tenant_id = a.tenant_id AND public.leads_readable(l.tenant_id, l.branch_id, l.assignee_staff_id)
               AND (a.branch_id IS NULL OR l.branch_id IS NULL OR l.branch_id = a.branch_id)
               AND CASE coalesce(p_stage, 'open') WHEN 'open' THEN l.stage NOT IN ('converted','lost') WHEN 'all' THEN true ELSE l.stage = p_stage END
               AND CASE coalesce(p_scope, 'all') WHEN 'mine' THEN l.assignee_staff_id = a.staff_id WHEN 'unassigned' THEN l.assignee_staff_id IS NULL ELSE true END
             ORDER BY l.updated_at DESC, l.id LIMIT 200) l), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_list(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lead_list(text, text) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.lead_get(p_lead uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.lead_reader();
  l public.leads;
  v_now timestamptz;
BEGIN
  SELECT * INTO l FROM public.leads x WHERE x.tenant_id = a.tenant_id AND x.id = p_lead;
  IF l.id IS NULL OR NOT public.leads_readable(l.tenant_id, l.branch_id, l.assignee_staff_id)
     OR a.branch_id IS NOT NULL AND l.branch_id IS NOT NULL AND l.branch_id <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: lead not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := clock_timestamp();
  RETURN jsonb_build_object('role', a.role, 'can_write', a.role IN ('central_cs','bc','manager'), 'me', a.staff_id, 'now', v_now,
    'lead', public.lead_json(l, a.role, v_now, coalesce((public.setting_value_at('SET-20', NULL, v_now) #>> '{}')::integer, 15), true));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lead_get(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lead_get(uuid) TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.campaigns_list() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role INTO a FROM public.tenant_actor_lock() x;
  IF NOT public.campaigns_readable(a.tenant_id) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read campaigns' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('role', a.role, 'can_manage', a.role IN ('owner','admin_pusat','marketing'),
    'campaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code, 'channel', c.channel, 'active', c.active,
        'leads', (SELECT count(*) FROM public.leads l WHERE l.tenant_id = c.tenant_id AND l.campaign_id = c.id)) ORDER BY c.active DESC, c.name)
      FROM public.campaigns c WHERE c.tenant_id = a.tenant_id), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaigns_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaigns_list() TO clinic_app;
