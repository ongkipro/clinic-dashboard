-- T-016 (PR-54, DATA-42). notification_types is a platform registry; notifications are
-- tenant-shared. A staff member sees a notification addressed to them, or to their acting
-- role at a branch in scope (tenant-wide notifications: any branch scope). Raising goes
-- through notification_raise() (service contexts: outbox consumers; or staff whose action
-- raises an alert); acknowledging through notification_ack() by a visible recipient.
ALTER TABLE public.notification_types ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Security fix of 0011 semantics: app_branch_allowed returned NULL when a branch was
-- given but the bound branch list was unset or empty, and a NULL check fails open in
-- PL/pgSQL ("IF NOT x" skips on NULL; approval_decide in 0022 had that latent path). It
-- now returns true or false only.
CREATE OR REPLACE FUNCTION public.app_branch_allowed(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN pg_catalog.current_setting('app.allowed_branch_ids', true) = '*' THEN true
    WHEN p_branch IS NULL THEN false
    ELSE coalesce(p_branch::text = ANY (pg_catalog.string_to_array(
           NULLIF(pg_catalog.current_setting('app.allowed_branch_ids', true), ''), ',')), false)
  END
$$;--> statement-breakpoint

-- A test type ships now (generic engine); real alert types come with their tasks:
-- unpaid addition (PR-15), clinical request (PR-43), complaint task (PR-45), approval
-- waiting (PR-44).
INSERT INTO public.notification_types (key, label, recipient_roles, subject_kinds, raisable_by_staff) VALUES
  ('test_alert', 'Peringatan uji', '{fo_cashier,manager,owner,doctor}', '{visit,clinical_request,approval}', false),
  ('test_staff_alert', 'Peringatan uji dari staf', '{fo_cashier,doctor}', '{visit}', true);--> statement-breakpoint

-- Labels for the screen (the registry itself is platform-only).
CREATE FUNCTION public.notification_labels() RETURNS TABLE (key text, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT key, label FROM public.notification_types
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notification_labels() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notification_labels() TO clinic_app;--> statement-breakpoint

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX notifications_source_key ON public.notifications
  (tenant_id, type, source_event_id, recipient_role, recipient_staff_id, branch_id) NULLS NOT DISTINCT
  WHERE source_event_id IS NOT NULL;--> statement-breakpoint
-- Never NULL (a NULL here would slip past "IF NOT visible" in PL/pgSQL): true or false.
CREATE FUNCTION public.notification_visible(p_role text, p_staff uuid, p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(p_staff IS NOT NULL AND p_staff = public.app_staff_id(), false)
      OR coalesce(p_role IS NOT NULL AND p_role = public.app_acting_role()
                  AND (p_branch IS NULL OR public.app_branch_allowed(p_branch)), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notification_visible(text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notification_visible(text, uuid, uuid) TO clinic_app;--> statement-breakpoint
CREATE POLICY notifications_read ON public.notifications FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id() AND public.notification_visible(recipient_role, recipient_staff_id, branch_id));--> statement-breakpoint
GRANT SELECT ON public.notifications TO clinic_app;--> statement-breakpoint

CREATE FUNCTION public.notification_raise(p_type text, p_role text, p_staff uuid, p_branch uuid,
                                          p_subject_kind text, p_subject_id uuid, p_source_event uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_raiser uuid := public.app_staff_id();
  t public.notification_types;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: notifications need a bound tenant context' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.notification_types WHERE key = p_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: unknown notification type' USING ERRCODE = 'P0002';
  END IF;
  IF (p_role IS NULL) = (p_staff IS NULL) THEN
    RAISE EXCEPTION 'address a role or one staff member' USING ERRCODE = '22023'; -- programming error
  END IF;
  IF p_role IS NOT NULL AND p_role = ANY (t.recipient_roles) IS NOT TRUE THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role is not a recipient of this type' USING ERRCODE = '42501';
  END IF;
  IF p_subject_kind = ANY (t.subject_kinds) IS NOT TRUE THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: subject kind not allowed for this type' USING ERRCODE = '42501';
  END IF;
  IF p_staff IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.tenant_id = v_tenant AND s.id = p_staff) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = v_tenant AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  -- Staff raise only types that opt in, at a branch inside their scope (never tenant-wide),
  -- and address a person only if that person holds a role at that branch; the raiser is
  -- recorded. Service contexts (outbox consumers) may address any branch of the tenant.
  IF v_raiser IS NOT NULL THEN
    IF NOT t.raisable_by_staff THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: this alert type is raised by the system only' USING ERRCODE = '42501';
    END IF;
    IF p_branch IS NULL OR public.app_branch_allowed(p_branch) IS NOT TRUE THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: a staff alert names a branch inside the acting role scope' USING ERRCODE = '42501';
    END IF;
    IF p_staff IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.staff_roles r
          WHERE r.tenant_id = v_tenant AND r.staff_id = p_staff
            AND (r.role IN ('owner','admin_pusat','finance','central_cs','marketing','purchasing','auditor')
                 OR EXISTS (SELECT 1 FROM public.staff_branches b WHERE b.tenant_id = v_tenant AND b.staff_role_id = r.id AND b.branch_id = p_branch))) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: recipient does not work at that branch' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Raised from a source event: once per event and recipient (a redelivery returns the
  -- existing notification). Without a source event every call is a new notification.
  IF p_source_event IS NOT NULL THEN
    INSERT INTO public.notifications (tenant_id, type, recipient_role, recipient_staff_id, branch_id, subject_kind, subject_id, source_event_id, raised_by)
    VALUES (v_tenant, p_type, p_role, p_staff, p_branch, p_subject_kind, p_subject_id, p_source_event, v_raiser)
    ON CONFLICT (tenant_id, type, source_event_id, recipient_role, recipient_staff_id, branch_id) WHERE source_event_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO STRICT v_id FROM public.notifications
       WHERE tenant_id = v_tenant AND type = p_type AND source_event_id = p_source_event
         AND recipient_role IS NOT DISTINCT FROM p_role AND recipient_staff_id IS NOT DISTINCT FROM p_staff
         AND branch_id IS NOT DISTINCT FROM p_branch;
    END IF;
    RETURN v_id;
  END IF;
  INSERT INTO public.notifications (tenant_id, type, recipient_role, recipient_staff_id, branch_id, subject_kind, subject_id, raised_by)
  VALUES (v_tenant, p_type, p_role, p_staff, p_branch, p_subject_kind, p_subject_id, v_raiser)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notification_raise(text, text, uuid, uuid, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notification_raise(text, text, uuid, uuid, text, uuid, uuid) TO clinic_app;--> statement-breakpoint

-- PR-54: a recipient acknowledges; the row records who (staff, acting role) and when. A
-- second acknowledgement does not overwrite the first.
CREATE FUNCTION public.notification_ack(p_notification uuid) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_staff uuid := public.app_staff_id();
  v_role text := public.app_acting_role();
  n public.notifications;
BEGIN
  IF v_tenant IS NULL OR v_staff IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: acknowledging needs a staff context' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO n FROM public.notifications WHERE tenant_id = v_tenant AND id = p_notification FOR UPDATE;
  IF NOT FOUND OR public.notification_visible(n.recipient_role, n.recipient_staff_id, n.branch_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: notification not found' USING ERRCODE = 'P0002';
  END IF;
  -- The staff member must really hold the acting role in an active membership.
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                   JOIN public.memberships m ON m.tenant_id = s.tenant_id AND m.id = s.membership_id
                   JOIN public.staff_roles r ON r.tenant_id = s.tenant_id AND r.staff_id = s.id AND r.role = v_role
                  WHERE s.tenant_id = v_tenant AND s.id = v_staff
                    AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: bound context is not an active membership with that role' USING ERRCODE = '42501';
  END IF;
  IF n.acknowledged_at IS NOT NULL THEN
    RETURN n.acknowledged_at;
  END IF;
  UPDATE public.notifications
     SET acknowledged_by = v_staff, acknowledged_as = v_role, acknowledged_at = now(),
         acknowledged_name = (SELECT display_name FROM public.staff WHERE tenant_id = v_tenant AND id = v_staff)
   WHERE tenant_id = v_tenant AND id = p_notification
   RETURNING acknowledged_at INTO n.acknowledged_at;
  RETURN n.acknowledged_at;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notification_ack(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notification_ack(uuid) TO clinic_app;--> statement-breakpoint

-- Notifications are history: the address never changes, an acknowledgement is final,
-- nothing is deleted.
CREATE FUNCTION public.notifications_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notifications are never deleted' USING ERRCODE = '42501';
  END IF;
  IF OLD.acknowledged_at IS NOT NULL
     OR (NEW.tenant_id, NEW.type, NEW.recipient_role, NEW.recipient_staff_id, NEW.branch_id, NEW.subject_kind, NEW.subject_id, NEW.source_event_id, NEW.created_at)
        IS DISTINCT FROM
        (OLD.tenant_id, OLD.type, OLD.recipient_role, OLD.recipient_staff_id, OLD.branch_id, OLD.subject_kind, OLD.subject_id, OLD.source_event_id, OLD.created_at) THEN
    RAISE EXCEPTION 'an acknowledged notification is final and its address is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER notifications_guard BEFORE UPDATE OR DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_guard();--> statement-breakpoint
CREATE TRIGGER notifications_no_truncate BEFORE TRUNCATE ON public.notifications
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.notification_types', 'platform', 'notifications', '{}', 'migrations of alert-owning tasks', 'none'),
  ('public.notifications', 'tenant-shared', 'notifications', '{recipient}', 'notification functions (src/modules/notifications)', 'branch of the alert');
