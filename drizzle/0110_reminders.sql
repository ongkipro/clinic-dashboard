CREATE TABLE "appointment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"outbound_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reply" text,
	"reply_message_id" uuid,
	"replied_at" timestamp with time zone,
	"followup_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "appointment_reminders_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "appointment_reminders_appointment_kind_key" UNIQUE("tenant_id","appointment_id","kind"),
	CONSTRAINT "appointment_reminders_outbound_key" UNIQUE("tenant_id","outbound_id"),
	CONSTRAINT "appointment_reminders_check" CHECK ("appointment_reminders"."kind" in ('h1','same_day')
      and ("appointment_reminders"."reply" is null or "appointment_reminders"."reply" in ('confirm','reschedule'))
      and (("appointment_reminders"."reply" is null) = ("appointment_reminders"."reply_message_id" is null)) and (("appointment_reminders"."reply" is null) = ("appointment_reminders"."replied_at" is null))
      and (("appointment_reminders"."followup_id" is not null) = ("appointment_reminders"."reply" is not distinct from 'reschedule')))
);
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_state_check";--> statement-breakpoint
ALTER TABLE "followups" DROP CONSTRAINT "followups_check";--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_tenant_id_branch_id_appointment_id_appointments_tenant_id_branch_id_id_fk" FOREIGN KEY ("tenant_id","branch_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_tenant_id_patient_id_patients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_tenant_id_outbound_id_outbound_messages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","outbound_id") REFERENCES "public"."outbound_messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_tenant_id_reply_message_id_messages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reply_message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_tenant_id_followup_id_followups_tenant_id_id_fk" FOREIGN KEY ("tenant_id","followup_id") REFERENCES "public"."followups"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_state_check" CHECK ("appointments"."state" in ('held','booked','confirmed','arrived','no_show','cancelled','rescheduled')
      and (("appointments"."state" = 'held') = ("appointments"."hold_until" is not null))
      and (("appointments"."state" = 'cancelled') = ("appointments"."state_reason" is not null and length(btrim("appointments"."state_reason")) between 3 and 500))
      and (("appointments"."state" = 'rescheduled') = ("appointments"."rescheduled_to" is not null and "appointments"."rescheduled_to" <> "appointments"."id"))
      and (("appointments"."state" in ('confirmed','arrived','no_show','cancelled','rescheduled')) = ("appointments"."state_changed_at" is not null))
      and ("appointments"."state" in ('confirmed','arrived','no_show','cancelled','rescheduled') or "appointments"."state_changed_by" is null)
      and ("appointments"."state" in ('held','booked','confirmed') or "appointments"."state_changed_by" is not null));--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_check" CHECK ("followups"."state" in ('open','done','dismissed')
      and ("followups"."rule_code", "followups"."source_kind", "followups"."role_queue") in (('control_due','consultation_control','bc'), ('package_stage','package','bc'), ('package_expiry','package','bc'), ('instalment_locked','instalment_row','cs'), ('receivable','receivable','cs'), ('plan_unselected','care_plan','bc'), ('no_show','appointment','cs'), ('dormant','patient','cs'), ('reschedule_request','appointment','cs'))
      and "followups"."step" ~ '^[a-z0-9_]{1,40}$' and "followups"."snooze_count" between 0 and 50 and "followups"."due_on" >= "followups"."original_due_on"
      and (("followups"."assignee_staff_id" is null) = ("followups"."assigned_at" is null))
      and (("followups"."state" = 'open') = ("followups"."closed_at" is null)) and (("followups"."state" = 'open') = ("followups"."outcome" is null))
      and (("followups"."closed_by" is null) = ("followups"."closed_as" is null))
      and ("followups"."outcome_note" is null or length(btrim("followups"."outcome_note")) between 3 and 500)
      and ("followups"."state" <> 'done' or "followups"."outcome" in ('dihubungi','jadwal_dibuat','sudah_bayar','tidak_tertarik','tidak_merespons','lainnya') and "followups"."closed_by" is not null
           and ("followups"."outcome" <> 'lainnya' or "followups"."outcome_note" is not null))
      and ("followups"."state" <> 'dismissed' or ("followups"."outcome" = 'diganti' and "followups"."closed_by" is null)
           or ("followups"."outcome" = 'dilewati' and "followups"."closed_by" is not null and "followups"."outcome_note" is not null)));--> statement-breakpoint

-- T-095 rules (generated by gen.py; plan docs/tasks/T-095.md)
-- T-095 (PR-69, plan docs/tasks/T-095.md; DEC-107): neutral appointment reminders on the T-094 outbound queue, with Konfirmasi / Ubah Jadwal
-- replies. Helpers first: who reads a reminder, the guard, SET-18 on the unbound path, the due time.

-- A reminder is read by the inbox and front-desk roles (as outbound_readable, T-094), branch roles at their allowed branches.
CREATE FUNCTION public.appointment_reminders_readable(p_tenant uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND (
           public.app_acting_role() = ANY (ARRAY['owner','admin_pusat','central_cs','auditor'])
        OR public.app_acting_role() = ANY (ARRAY['manager','fo_cashier','bc']) AND public.app_branch_allowed(p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_reminders_readable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.appointment_reminders_readable(uuid, uuid) TO clinic_app;--> statement-breakpoint

-- Never deleted; identity frozen; created unanswered; the reply is set once and is final (plan r1 P2-2).
CREATE FUNCTION public.appointment_reminders_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || coalesce(NEW.tenant_id, OLD.tenant_id)::text, 0));
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'appointment reminders are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.reply IS NOT NULL OR NEW.followup_id IS NOT NULL THEN
      RAISE EXCEPTION 'a reminder starts unanswered' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.appointment_id, NEW.patient_id, NEW.kind, NEW.outbound_id, NEW.due_at, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.appointment_id, OLD.patient_id, OLD.kind, OLD.outbound_id, OLD.due_at, OLD.created_at)
     OR OLD.reply IS NOT NULL OR NEW.reply IS NULL THEN
    RAISE EXCEPTION 'a reminder keeps its identity and is answered once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.appointment_reminders_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_reminders_guard BEFORE INSERT OR UPDATE OR DELETE ON public.appointment_reminders FOR EACH ROW EXECUTE FUNCTION public.appointment_reminders_guard();--> statement-breakpoint
ALTER TABLE public.appointment_reminders ENABLE ALWAYS TRIGGER appointment_reminders_guard;--> statement-breakpoint
CREATE TRIGGER appointment_reminders_no_truncate BEFORE TRUNCATE ON public.appointment_reminders FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY appointment_reminders_read ON public.appointment_reminders FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.appointment_reminders_readable(tenant_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.appointment_reminders TO clinic_app;--> statement-breakpoint
CREATE POLICY appointment_reminders_operator_read ON public.appointment_reminders FOR SELECT TO clinic_operator
  USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.appointment_reminders', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.appointment_reminders TO clinic_operator;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.appointment_reminders', 'tenant-shared', 'crm', '{owner,admin_pusat,central_cs,auditor,manager,fo_cashier,bc}', 'reminder_scan and reminder_reply_handle (src/modules/crm/reminders)',
   'the appointment branch');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES ('public.appointment_reminders', 'personal');--> statement-breakpoint

-- T-095: SET-18 on the unbound path and the reminder scan (plan r1 P2-1).

-- SET-18 for a branch on an unbound connection: the branch's newest active version at p_at, else the tenant-wide one, else the default
-- (setting_value_at keys on app_tenant_id(), null when unbound; followup_setting is tenant-wide only).
CREATE FUNCTION public.reminder_setting(p_tenant uuid, p_branch uuid, p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT v.value FROM public.setting_versions v
      WHERE v.tenant_id = p_tenant AND v.key = 'SET-18' AND v.state = 'active' AND v.branch_id = p_branch AND v.effective_from <= p_at
      ORDER BY v.effective_from DESC, v.id DESC LIMIT 1),
    public.followup_setting(p_tenant, 'SET-18', p_at))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reminder_setting(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- When a reminder of an appointment is due (plan r1 P2-1), in the branch timezone: h1 at (day − 1) + SET-18 h1; same_day at starts_at −
-- SET-18 sebelum hours, never before 07:00 of the appointment day (the quiet window 21:00–07:00 is fixed, P-25).
CREATE FUNCTION public.reminder_due_at(ap public.appointments, p_kind text, p_set jsonb, p_tz text) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_kind
    WHEN 'h1' THEN (((ap.starts_at AT TIME ZONE p_tz)::date - 1) + (p_set ->> 'h1')::time) AT TIME ZONE p_tz
    ELSE greatest(ap.starts_at - make_interval(hours => (p_set ->> 'sebelum')::integer),
                  ((ap.starts_at AT TIME ZONE p_tz)::date + time '07:00') AT TIME ZONE p_tz) END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reminder_due_at(public.appointments, text, jsonb, text) FROM PUBLIC;--> statement-breakpoint

-- The scan (unbound; a scheduler runs it every few minutes): for each booked / confirmed appointment in the next 2 days, each kind whose due
-- time has come, before the appointment, inside 07:00–21:00 branch time, with no reminder yet → outbound_enqueue_do (care_reminder, source
-- appointment, the tenant's approved pengingat_janji) + an appointment_reminders row. A refusal of one appointment (no phone, no sendable
-- number, no template) is counted, not raised: the rest of the batch continues. h1 is only sent on day − 1 (a booking made on the day gets
-- the same-day one only).
CREATE FUNCTION public.reminder_scan(p_now timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  ap public.appointments;
  v_tz text;
  v_set jsonb;
  v_kind text;
  v_due timestamptz;
  v_local timestamp;
  v_tpl uuid;
  v_out uuid;
  v_queued integer := 0;
  v_refused integer := 0;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'reminder_scan runs on an unbound worker connection only' USING ERRCODE = '42501';
  END IF;
  FOR ap IN SELECT a.* FROM public.appointments a
             JOIN public.tenants_registry tr ON tr.id = a.tenant_id AND tr.lifecycle_state IN ('onboarding','live','suspended')
            WHERE a.state IN ('booked','confirmed') AND a.starts_at > v_now AND a.starts_at < v_now + interval '2 days'
            ORDER BY a.tenant_id, a.starts_at, a.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || ap.tenant_id::text, 0));
    SELECT b.timezone INTO v_tz FROM public.branches b WHERE b.tenant_id = ap.tenant_id AND b.id = ap.branch_id;
    v_local := v_now AT TIME ZONE v_tz;
    CONTINUE WHEN v_local::time < time '07:00' OR v_local::time >= time '21:00';
    v_set := public.reminder_setting(ap.tenant_id, ap.branch_id, v_now);
    FOREACH v_kind IN ARRAY ARRAY['h1','same_day'] LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.appointment_reminders r WHERE r.tenant_id = ap.tenant_id AND r.appointment_id = ap.id AND r.kind = v_kind);
      v_due := public.reminder_due_at(ap, v_kind, v_set, v_tz);
      CONTINUE WHEN v_now < v_due;
      CONTINUE WHEN v_kind = 'h1' AND v_local::date <> (ap.starts_at AT TIME ZONE v_tz)::date - 1;
      SELECT t.id INTO v_tpl FROM public.wa_templates t
       WHERE t.tenant_id = ap.tenant_id AND t.name = 'pengingat_janji' AND t.status = 'approved' AND t.category = 'utility'
       ORDER BY t.language = 'id' DESC, t.id LIMIT 1;
      IF v_tpl IS NULL THEN
        v_refused := v_refused + 1;
        CONTINUE;
      END IF;
      BEGIN
        v_out := public.outbound_enqueue_do(ap.tenant_id, 'reminder:' || ap.id::text || ':' || v_kind, 'care_reminder', ap.patient_id, ap.branch_id,
                                            v_tpl, 'appointment', ap.id, v_local::date, NULL, NULL, v_now);
        INSERT INTO public.appointment_reminders (tenant_id, branch_id, appointment_id, patient_id, kind, outbound_id, due_at, created_at)
        VALUES (ap.tenant_id, ap.branch_id, ap.id, public.patient_canonical(ap.tenant_id, ap.patient_id), v_kind, v_out, v_due, v_now);
        v_queued := v_queued + 1;
      EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE 'P0002' OR SQLSTATE '22023' THEN
        -- only the enqueue refusals are swallowed (no phone, no sendable number, template unusable / not found); anything else raises
        v_refused := v_refused + 1;
      END;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('queued', v_queued, 'refused', v_refused);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reminder_scan(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.reminder_scan(timestamptz) TO clinic_app;--> statement-breakpoint
-- A refused appointment is retried by later scans (no row written): the refusals are configuration states (no phone, no sendable number, no
-- approved template) that may be fixed the same day; the scan result counts them.--> statement-breakpoint

-- T-095 (plan r1 P1-1, P1-2, P2-2; review r2 P3-1): the reminder reply on the unbound webhook path. ingestOne (inbox.ts) calls it in
-- the webhook's transaction after meta_webhook_ingest returned 'processed', with ids and an enum only (the reply text stays sealed, W-10).

CREATE FUNCTION public.reminder_reply_handle(p jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  rt record;
  m public.messages;
  r public.appointment_reminders;
  ap public.appointments;
  v_now timestamptz := clock_timestamp();
  v_ctx text := p ->> 'context_provider_message_id';
  v_action text := p ->> 'action';
  v_tz text;
  v_fid uuid;
BEGIN
  IF public.app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: the webhook path is unbound' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - 'phone_number_id' - 'provider_message_id' - 'action' - 'context_provider_message_id' <> '{}'::jsonb
     OR v_action IS NULL OR v_action NOT IN ('confirm','reschedule') OR p ->> 'provider_message_id' IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: reply' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO rt FROM public.waba_route_resolve(p ->> 'phone_number_id');
  IF rt.tenant_id IS NULL THEN
    RETURN 'no_reminder';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || rt.tenant_id::text, 0));
  SELECT * INTO m FROM public.messages x
   WHERE x.tenant_id = rt.tenant_id AND x.provider_message_id = p ->> 'provider_message_id' AND x.direction = 'in';
  IF m.id IS NULL THEN
    RETURN 'no_reminder';
  END IF;
  -- the reminder this reply answers: the quoted template (context id) exactly, else the latest unanswered one in the conversation
  IF v_ctx IS NOT NULL THEN
    SELECT x.* INTO r FROM public.appointment_reminders x
      JOIN public.outbound_messages o ON o.tenant_id = x.tenant_id AND o.id = x.outbound_id
     WHERE x.tenant_id = rt.tenant_id AND o.conversation_id = m.conversation_id AND o.state = 'sent' AND o.provider_message_id = v_ctx;
  ELSE
    SELECT x.* INTO r FROM public.appointment_reminders x
      JOIN public.outbound_messages o ON o.tenant_id = x.tenant_id AND o.id = x.outbound_id
     WHERE x.tenant_id = rt.tenant_id AND o.conversation_id = m.conversation_id AND o.state = 'sent' AND x.reply IS NULL
     ORDER BY o.sent_at DESC, x.id DESC LIMIT 1;
  END IF;
  IF r.id IS NULL THEN
    RETURN 'no_reminder';
  END IF;
  IF r.reply IS NOT NULL THEN
    RETURN 'already_answered';
  END IF;
  SELECT * INTO ap FROM public.appointments x WHERE x.tenant_id = r.tenant_id AND x.id = r.appointment_id FOR UPDATE;
  IF ap.state NOT IN ('booked','confirmed') OR ap.starts_at <= v_now THEN
    RETURN 'appointment_closed';
  END IF;
  IF v_action = 'confirm' THEN
    UPDATE public.appointment_reminders SET reply = 'confirm', reply_message_id = m.id, replied_at = v_now WHERE tenant_id = r.tenant_id AND id = r.id;
    IF ap.state = 'booked' THEN
      -- a patient's reply has no staff actor (plan r1 P1-2: appointments_state_check admits state_changed_by null for confirmed only)
      UPDATE public.appointments SET state = 'confirmed', state_changed_at = v_now, state_changed_by = NULL WHERE tenant_id = ap.tenant_id AND id = ap.id;
      INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)
      VALUES (ap.tenant_id, ap.branch_id, 'AppointmentConfirmed', 'appointment', ap.id, NULL, NULL, v_now,
              jsonb_build_object('appointment_id', ap.id, 'branch_id', ap.branch_id, 'patient_id', ap.patient_id, 'reminder_id', r.id));
    END IF;
    RETURN 'confirmed';
  END IF;
  -- reschedule: a CS task (PR-83); the appointment is unchanged until CS moves it with the T-045 writer
  SELECT b.timezone INTO v_tz FROM public.branches b WHERE b.tenant_id = ap.tenant_id AND b.id = ap.branch_id;
  PERFORM public.followup_create(ap.tenant_id, ap.branch_id, ap.patient_id, 'reschedule_request', 'appointment', ap.id, r.kind, 'cs', NULL,
                                 (v_now AT TIME ZONE v_tz)::date, v_now);
  SELECT f.id INTO v_fid FROM public.followups f
   WHERE f.tenant_id = ap.tenant_id AND f.rule_code = 'reschedule_request' AND f.source_id = ap.id AND f.step = r.kind;
  UPDATE public.appointment_reminders SET reply = 'reschedule', reply_message_id = m.id, replied_at = v_now, followup_id = v_fid
   WHERE tenant_id = r.tenant_id AND id = r.id;
  RETURN 'reschedule_requested';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reminder_reply_handle(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.reminder_reply_handle(jsonb) TO clinic_app;--> statement-breakpoint
-- CHECKED: the staff path (0062 appointment_changed) emits AppointmentConfirmed with {appointment_id, branch_id, patient_id} || extra; this
-- one adds reminder_id (the extra), same type and base shape. appointment_changed itself is not reusable here (audit_append needs a bound
-- actor; its insert relies on the bound tenant default).--> statement-breakpoint

-- T-095: re-created functions (pinned in tests/db/reminders-drift): T-094's outbound_params gains the appointment date and time for a
-- care reminder (plan r1 P1-3); T-093's followup_list accepts the reschedule_request rule (P2-2). Grants are unchanged by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.outbound_params(o public.outbound_messages) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_name text;
  v_branch text;
  v_tz text;
  v_out bigint;
  v_numbers text;
  v_at timestamptz;
  v_clinic text;
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
    -- T-095 (plan r1 P1-3, PRIV-15): an appointment reminder names the clinic, the branch, the date and the time — never the service
    SELECT ap.starts_at INTO v_at FROM public.appointments ap WHERE ap.tenant_id = o.tenant_id AND ap.id = o.source_id AND o.source_kind = 'appointment';
    IF v_at IS NULL THEN
      RETURN ARRAY[v_name, v_branch];
    END IF;
    -- the clinic's display name (SET-1, read unbound: review r2 P3-2) else the legal name; dates without the server locale
    v_clinic := coalesce(nullif(btrim(public.followup_setting(o.tenant_id, 'SET-1', clock_timestamp()) ->> 'nama'), ''),
                         (SELECT t.legal_name FROM public.tenants t WHERE t.id = o.tenant_id));
    v_tz := coalesce(v_tz, 'Asia/Jakarta');
    RETURN ARRAY[v_name, v_clinic || ' – ' || v_branch || ', '
      || (ARRAY['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'])[extract(dow FROM v_at AT TIME ZONE v_tz)::integer + 1] || ' '
      || extract(day FROM v_at AT TIME ZONE v_tz)::integer || ' '
      || (ARRAY['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'])[extract(month FROM v_at AT TIME ZONE v_tz)::integer] || ' '
      || extract(year FROM v_at AT TIME ZONE v_tz)::integer || ' pukul ' || to_char(v_at AT TIME ZONE v_tz, 'HH24:MI')];
  ELSIF o.purpose = 'aftercare' THEN
    RETURN ARRAY[v_name, '/perawatan/' || o.source_id::text];
  END IF;
  RETURN ARRAY[v_branch];
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.followup_list(p_filter text, p_scope text, p_rule text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_now timestamptz;
BEGIN
  SELECT x.tenant_id, x.staff_id, x.role, x.branch_id INTO a FROM public.tenant_actor_lock() x;
  IF a.role NOT IN ('owner','central_cs','manager','bc','finance','marketing','auditor') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not read follow-ups' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_filter, 'open') NOT IN ('all','open','due_today','overdue','done','dismissed') OR coalesce(p_scope, 'all') NOT IN ('all','mine','unassigned')
     OR p_rule IS NOT NULL AND p_rule NOT IN ('control_due','package_stage','package_expiry','instalment_locked','receivable','plan_unselected','no_show','dormant','reschedule_request') THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: filter' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  RETURN jsonb_build_object('role', a.role, 'can_write', a.role IN ('central_cs','manager','bc'), 'now', v_now,
    'followups', coalesce((SELECT jsonb_agg(public.followup_json(f, a.role, public.followup_branch_today(f.tenant_id, f.branch_id, v_now)) ORDER BY f.due_on, f.id)
      FROM (SELECT * FROM public.followups f
             WHERE f.tenant_id = a.tenant_id AND public.followups_readable(f.tenant_id, f.branch_id, f.rule_code, f.role_queue, f.assignee_staff_id)
               AND (a.branch_id IS NULL OR f.branch_id = a.branch_id)
               AND (p_rule IS NULL OR f.rule_code = p_rule)
               AND CASE coalesce(p_filter, 'open')
                     WHEN 'all' THEN true WHEN 'done' THEN f.state = 'done' WHEN 'dismissed' THEN f.state = 'dismissed'
                     WHEN 'open' THEN f.state = 'open'
                     WHEN 'due_today' THEN f.state = 'open' AND f.due_on = public.followup_branch_today(f.tenant_id, f.branch_id, v_now)
                     ELSE f.state = 'open' AND f.due_on < public.followup_branch_today(f.tenant_id, f.branch_id, v_now) END
               AND CASE coalesce(p_scope, 'all') WHEN 'mine' THEN f.assignee_staff_id = a.staff_id WHEN 'unassigned' THEN f.assignee_staff_id IS NULL ELSE true END
             ORDER BY f.due_on, f.id LIMIT 200) f), '[]'::jsonb));
END
$$;
