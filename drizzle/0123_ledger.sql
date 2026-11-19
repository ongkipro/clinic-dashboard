CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"posting_key" text NOT NULL,
	"event" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_event_id" uuid,
	"business_date" date NOT NULL,
	"period" text NOT NULL,
	"original_period" text NOT NULL,
	"map_version" text,
	"reverses_entry_id" uuid,
	"memo" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "journal_entries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "journal_entries_posting_key" UNIQUE("tenant_id","posting_key"),
	CONSTRAINT "journal_entries_check" CHECK ("journal_entries"."kind" in ('auto','manual','reversal') and length("journal_entries"."posting_key") between 3 and 200
      and "journal_entries"."event" ~ '^[A-Z][A-Za-z]{2,60}$' and "journal_entries"."source_kind" ~ '^[a-z][a-z_]{2,40}$' and "journal_entries"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "journal_entries"."original_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      and "journal_entries"."period" >= "journal_entries"."original_period" and (("journal_entries"."kind" = 'auto') = ("journal_entries"."map_version" is not null))
      and (("journal_entries"."kind" = 'manual') = ("journal_entries"."posted_by" is not null)) and ("journal_entries"."kind" <> 'manual' or length(btrim("journal_entries"."memo")) between 10 and 500)
      and ("journal_entries"."memo" is null or length("journal_entries"."memo") <= 500))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"branch_id" uuid,
	"debit" bigint NOT NULL,
	"credit" bigint NOT NULL,
	CONSTRAINT "journal_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "journal_lines_check" CHECK ("journal_lines"."debit" between 0 and 1000000000000 and "journal_lines"."credit" between 0 and 1000000000000
      and ("journal_lines"."debit" = 0) <> ("journal_lines"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"class" text NOT NULL,
	"system" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ledger_accounts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_accounts_key" UNIQUE("tenant_id","key"),
	CONSTRAINT "ledger_accounts_check" CHECK ("ledger_accounts"."key" ~ '^[a-z][a-z0-9_]{2,40}$' and length(btrim("ledger_accounts"."label")) between 2 and 80
      and "ledger_accounts"."class" in ('asset','liability','equity','revenue','expense') and "ledger_accounts"."system" in ('system','manual') and (("ledger_accounts"."system" = 'system') = ("ledger_accounts"."created_by" is null)))
);
--> statement-breakpoint
CREATE TABLE "ledger_activations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"map_version" text NOT NULL,
	"activated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ledger_activations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_activations_tenant_key" UNIQUE("tenant_id"),
	CONSTRAINT "ledger_activations_check" CHECK (length(btrim("ledger_activations"."map_version")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "ledger_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"locked_by" uuid NOT NULL,
	"locked_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"command_key" text NOT NULL,
	CONSTRAINT "ledger_periods_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_periods_key" UNIQUE("tenant_id","period"),
	CONSTRAINT "ledger_periods_command_key" UNIQUE("tenant_id","command_key"),
	CONSTRAINT "ledger_periods_check" CHECK ("ledger_periods"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "ledger_periods"."command_key" ~ '^[A-Za-z0-9_.:-]{8,128}$')
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_fk" FOREIGN KEY ("tenant_id","reverses_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_activations" ADD CONSTRAINT "ledger_activations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_periods" ADD CONSTRAINT "ledger_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_periods" ADD CONSTRAINT "ledger_periods_locked_by_fk" FOREIGN KEY ("tenant_id","locked_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_period_idx" ON "journal_entries" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("tenant_id","source_kind","source_id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("tenant_id","entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("tenant_id","account_id");--> statement-breakpoint

-- T-105 logic (generated from the parts by the task's gen.py; plan docs/tasks/T-105.md)
-- ── T-105 database invariants (PR-26, DATA-37, DATA-3; Panel 2 G1–G4, E1/E2) ──
-- Readers: owner, finance, auditor (07 :61 "Ledger, periods, exports": finance ●, owner ◐, auditor read). Nothing is written by the app
-- directly: entries only through the posting definers and ledger_manual_post, periods only through ledger_period_lock, accounts only by
-- seed and ledger_account_add. ledger_activations has NO writer in T-105 (open gate G-ACT): every automatic entry is a preview.
CREATE FUNCTION public.ledger_readable(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.stock_member_now(p_tenant) AND public.app_role_in(ARRAY['owner','finance','auditor']), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_readable(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_readable(uuid) TO clinic_app;--> statement-breakpoint

-- Posted entries, their lines, locked periods and activations are immutable (DATA-3: corrections are reversing or adjusting entries).
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.journal_entries ENABLE ALWAYS TRIGGER journal_entries_append_only;--> statement-breakpoint
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.journal_lines ENABLE ALWAYS TRIGGER journal_lines_append_only;--> statement-breakpoint
CREATE TRIGGER ledger_periods_append_only BEFORE UPDATE OR DELETE ON public.ledger_periods FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.ledger_periods ENABLE ALWAYS TRIGGER ledger_periods_append_only;--> statement-breakpoint
CREATE TRIGGER ledger_activations_append_only BEFORE UPDATE OR DELETE ON public.ledger_activations FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.ledger_activations ENABLE ALWAYS TRIGGER ledger_activations_append_only;--> statement-breakpoint
CREATE TRIGGER ledger_accounts_append_only BEFORE UPDATE OR DELETE ON public.ledger_accounts FOR EACH ROW EXECUTE FUNCTION public.subledger_append_only();--> statement-breakpoint
ALTER TABLE public.ledger_accounts ENABLE ALWAYS TRIGGER ledger_accounts_append_only;--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON public.journal_entries FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.journal_entries ENABLE ALWAYS TRIGGER journal_entries_no_truncate;--> statement-breakpoint
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON public.journal_lines FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.journal_lines ENABLE ALWAYS TRIGGER journal_lines_no_truncate;--> statement-breakpoint
CREATE TRIGGER ledger_periods_no_truncate BEFORE TRUNCATE ON public.ledger_periods FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.ledger_periods ENABLE ALWAYS TRIGGER ledger_periods_no_truncate;--> statement-breakpoint
CREATE TRIGGER ledger_activations_no_truncate BEFORE TRUNCATE ON public.ledger_activations FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.ledger_activations ENABLE ALWAYS TRIGGER ledger_activations_no_truncate;--> statement-breakpoint
CREATE TRIGGER ledger_accounts_no_truncate BEFORE TRUNCATE ON public.ledger_accounts FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint
ALTER TABLE public.ledger_accounts ENABLE ALWAYS TRIGGER ledger_accounts_no_truncate;--> statement-breakpoint

-- Lines are added only in the transaction that created their entry, and never to a reversed or locked-period entry afterwards; the entry
-- balances (Σ debit = Σ credit > 0) and has at least two lines at COMMIT (deferred constraint trigger, one check per entry).
CREATE FUNCTION public.journal_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- the entry must have been inserted by this transaction: its writer records it in a transaction-local setting (ledger_entry_open)
  IF NEW.entry_id::text IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.ledger_entry', true), '') THEN
    RAISE EXCEPTION 'journal lines are written with their entry only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.journal_lines_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER journal_lines_guard BEFORE INSERT ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.journal_lines_guard();--> statement-breakpoint
ALTER TABLE public.journal_lines ENABLE ALWAYS TRIGGER journal_lines_guard;--> statement-breakpoint
-- SECURITY DEFINER: the check reads every line of the entry whatever the caller's role (the posting consumer runs in a service context with
-- no role, so RLS would hide the lines and the entry would look empty).
CREATE FUNCTION public.journal_entry_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v record;
BEGIN
  SELECT count(*) n, coalesce(sum(l.debit), 0) d, coalesce(sum(l.credit), 0) c INTO v
    FROM public.journal_lines l WHERE l.tenant_id = NEW.tenant_id AND l.entry_id = NEW.id;
  IF v.n < 2 OR v.d <> v.c OR v.d = 0 THEN
    RAISE EXCEPTION 'journal entry % is not balanced (lines %, debit %, credit %)', NEW.id, v.n, v.d, v.c USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.journal_entry_balanced() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON public.journal_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.journal_entry_balanced();--> statement-breakpoint
ALTER TABLE public.journal_entries ENABLE ALWAYS TRIGGER journal_entries_balanced;--> statement-breakpoint
-- An entry never posts into a locked period (the posting definers move a late fact to the next open period, PR-26 scenario).
CREATE FUNCTION public.journal_entries_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_access:' || NEW.tenant_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.ledger_periods p WHERE p.tenant_id = NEW.tenant_id AND p.period = NEW.period) THEN
    RAISE EXCEPTION 'ERR_PERIOD_LOCKED: %', NEW.period USING ERRCODE = '55000';
  END IF;
  IF NEW.reverses_entry_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.journal_entries r WHERE r.tenant_id = NEW.tenant_id AND r.reverses_entry_id = NEW.reverses_entry_id) THEN
    RAISE EXCEPTION 'an entry is reversed once' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.journal_entries_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER journal_entries_guard BEFORE INSERT ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.journal_entries_guard();--> statement-breakpoint
ALTER TABLE public.journal_entries ENABLE ALWAYS TRIGGER journal_entries_guard;--> statement-breakpoint

-- The writer side of the line guard: the definer that inserts an entry marks it open for its lines (transaction-local).
CREATE FUNCTION public.ledger_entry_open(p_entry uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_catalog.set_config('app.ledger_entry', p_entry::text, true);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_entry_open(uuid) FROM PUBLIC;--> statement-breakpoint

-- RLS: read only; the operator reads a support-session scope (money totals class), like the T-104 tables.
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ledger_periods ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ledger_activations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ledger_accounts_read ON public.ledger_accounts FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.ledger_readable(tenant_id));--> statement-breakpoint
CREATE POLICY ledger_periods_read ON public.ledger_periods FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.ledger_readable(tenant_id));--> statement-breakpoint
CREATE POLICY journal_entries_read ON public.journal_entries FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.ledger_readable(tenant_id));--> statement-breakpoint
CREATE POLICY journal_lines_read ON public.journal_lines FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.ledger_readable(tenant_id));--> statement-breakpoint
CREATE POLICY ledger_activations_read ON public.ledger_activations FOR SELECT TO clinic_app USING (tenant_id = public.app_tenant_id() AND public.ledger_readable(tenant_id));--> statement-breakpoint
GRANT SELECT ON public.ledger_accounts, public.ledger_periods, public.journal_entries, public.journal_lines, public.ledger_activations TO clinic_app;--> statement-breakpoint
CREATE POLICY ledger_accounts_operator_read ON public.ledger_accounts FOR SELECT TO clinic_operator USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.ledger_accounts', tenant_id, id));--> statement-breakpoint
CREATE POLICY ledger_periods_operator_read ON public.ledger_periods FOR SELECT TO clinic_operator USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.ledger_periods', tenant_id, id));--> statement-breakpoint
CREATE POLICY journal_entries_operator_read ON public.journal_entries FOR SELECT TO clinic_operator USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.journal_entries', tenant_id, id));--> statement-breakpoint
CREATE POLICY journal_lines_operator_read ON public.journal_lines FOR SELECT TO clinic_operator USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.journal_lines', tenant_id, id));--> statement-breakpoint
CREATE POLICY ledger_activations_operator_read ON public.ledger_activations FOR SELECT TO clinic_operator USING (tenant_id = public.app_tenant_id() AND public.operator_row_read('public.ledger_activations', tenant_id, id));--> statement-breakpoint
GRANT SELECT ON public.ledger_accounts, public.ledger_periods, public.journal_entries, public.journal_lines, public.ledger_activations TO clinic_operator;--> statement-breakpoint
INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.ledger_accounts', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'seed (ledger_seed_accounts) and ledger_account_add (src/modules/accounting/ledger)', 'none'),
  ('public.ledger_periods', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'ledger_period_lock (src/modules/accounting/ledger)', 'none (tenant month)'),
  ('public.journal_entries', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'the posting definers (drizzle/0123) and ledger_manual_post', 'per line'),
  ('public.journal_lines', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'with their entry only', 'the branch dimension of the line'),
  ('public.ledger_activations', 'tenant-ledger', 'accounting', '{owner,finance,auditor}', 'none in T-105 (open gate G-ACT)', 'none');--> statement-breakpoint
INSERT INTO public.support_object_kinds (table_name, support_class) VALUES
  ('public.ledger_accounts', 'money_total'), ('public.ledger_periods', 'money_total'), ('public.journal_entries', 'money_total'),
  ('public.journal_lines', 'money_total'), ('public.ledger_activations', 'money_total');--> statement-breakpoint

-- The chart of accounts (G3: stable keys, Indonesian labels, no numeric codes; the fixture's 23 accounts + the purchasing / expense rows of
-- the draft map). Seeded for every tenant, now and at creation.
CREATE FUNCTION public.ledger_seed_accounts(p_tenant uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO public.ledger_accounts (tenant_id, key, label, class, system)
  SELECT p_tenant, x.k, x.l, x.c, 'system' FROM (VALUES
    ('cash_shift', 'Kas (shift)', 'asset'), ('petty_cash', 'Kas kecil', 'asset'), ('bank', 'Bank', 'asset'),
    ('gateway_clearing', 'Kliring gateway', 'asset'), ('patient_receivable', 'Piutang pasien', 'asset'),
    ('staff_receivable', 'Piutang staf', 'asset'), ('supplier_receivable', 'Piutang pemasok (nota kredit)', 'asset'),
    ('inventory', 'Persediaan', 'asset'), ('vat_input', 'PPN masukan', 'asset'), ('inter_branch_clearing', 'Kliring antarcabang', 'asset'),
    ('liability_paid_not_delivered', 'Kewajiban kontrak — dibayar belum diberikan', 'liability'),
    ('liability_packages', 'Kewajiban kontrak — paket', 'liability'),
    ('liability_patient_balance', 'Kewajiban kontrak — saldo pasien', 'liability'),
    ('liability_booking_dp', 'Kewajiban kontrak — DP booking', 'liability'),
    ('vat_payable', 'PPN keluaran terutang', 'liability'), ('commission_payable', 'Utang komisi', 'liability'),
    ('grni', 'Barang diterima belum ditagih', 'liability'), ('accounts_payable', 'Utang usaha', 'liability'),
    ('opening_balance_equity', 'Ekuitas saldo awal', 'equity'),
    ('revenue_treatment', 'Pendapatan tindakan', 'revenue'), ('revenue_product', 'Pendapatan produk', 'revenue'),
    ('revenue_consultation', 'Pendapatan konsultasi', 'revenue'), ('other_income', 'Pendapatan lain-lain', 'revenue'),
    ('cogs', 'Harga pokok penjualan', 'expense'), ('materials_cost', 'Biaya bahan', 'expense'), ('waste_expense', 'Biaya bahan terbuang', 'expense'),
    ('bad_debt_expense', 'Beban piutang tak tertagih', 'expense'), ('merchant_fee_expense', 'Beban biaya merchant', 'expense'),
    ('commission_expense', 'Beban komisi', 'expense'), ('purchase_price_variance', 'Selisih harga pembelian', 'expense'),
    ('branch_expense', 'Beban operasional cabang', 'expense')
  ) AS x(k, l, c)
  ON CONFLICT (tenant_id, key) DO NOTHING
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_seed_accounts(uuid) FROM PUBLIC;--> statement-breakpoint
SELECT public.ledger_seed_accounts(t.id) FROM public.tenants t;--> statement-breakpoint
CREATE FUNCTION public.tenants_ledger_seed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ledger_seed_accounts(NEW.id);
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenants_ledger_seed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER tenants_ledger_seed AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.tenants_ledger_seed();--> statement-breakpoint
ALTER TABLE public.tenants ENABLE ALWAYS TRIGGER tenants_ledger_seed;--> statement-breakpoint

-- The posting map version this migration ships (G4). The accountant's posting_map_signoff approval binds to the version recorded in
-- compliance_config_versions (0030 compliance_config_version): written here for existing tenants (only where none is recorded yet — a tenant's
-- recorded version is never overwritten silently), and for a new tenant by the first posting (ledger_post), so an approval always covers
-- the exact rules that posted.
INSERT INTO public.compliance_config_versions (tenant_id, kind, version) SELECT t.id, 'posting_map', 'draft-11-2026-11-19' FROM public.tenants t
  ON CONFLICT (tenant_id, kind) DO NOTHING;--> statement-breakpoint
CREATE FUNCTION public.ledger_map_version() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT 'draft-11-2026-11-19'::text $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_map_version() FROM PUBLIC;--> statement-breakpoint

-- ── T-105 posting core ──
-- The account id of a system key for a tenant (fails loudly on an unknown key: a posting rule never invents an account).
CREATE FUNCTION public.ledger_account(p_tenant uuid, p_key text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  SELECT a.id INTO v FROM public.ledger_accounts a WHERE a.tenant_id = p_tenant AND a.key = p_key;
  IF v IS NULL THEN
    RAISE EXCEPTION 'ledger account % missing', p_key USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_account(uuid, text) FROM PUBLIC;--> statement-breakpoint

-- The first open period at or after a business date's month (PR-26: a fact of a locked month posts in the next open period with a reference
-- to its own month, original_period).
CREATE FUNCTION public.ledger_open_period(p_tenant uuid, p_date date) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v date := date_trunc('month', p_date)::date;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.ledger_periods p WHERE p.tenant_id = p_tenant AND p.period = to_char(v, 'YYYY-MM')) LOOP
    v := (v + interval '1 month')::date;
  END LOOP;
  RETURN to_char(v, 'YYYY-MM');
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_open_period(uuid, date) FROM PUBLIC;--> statement-breakpoint

-- Post one balanced entry: p_lines = [{account (system key), branch (uuid|null), debit, credit}], zero rows dropped, rows with the same
-- (account, branch, side) kept separate as given. Idempotent on (tenant, posting key): a second call returns NULL and writes nothing.
-- Not granted: called by the posting definers (auto, map version stamped) and the manual / reversal writers.
CREATE FUNCTION public.ledger_post(p_tenant uuid, p_kind text, p_key text, p_event text, p_source_kind text, p_source uuid, p_source_event uuid,
                                   p_date date, p_lines jsonb, p_memo text, p_staff uuid, p_reverses uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_id uuid := public.uuid_generate_v7();
  x jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.tenant_id = p_tenant AND e.posting_key = p_key) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) l WHERE coalesce((l ->> 'debit')::bigint, 0) + coalesce((l ->> 'credit')::bigint, 0) <> 0) THEN
    RETURN NULL; -- nothing to post (a zero fact)
  END IF;
  IF p_kind = 'auto' THEN
    INSERT INTO public.compliance_config_versions (tenant_id, kind, version) VALUES (p_tenant, 'posting_map', public.ledger_map_version())
      ON CONFLICT (tenant_id, kind) DO NOTHING;
  END IF;
  INSERT INTO public.journal_entries (id, tenant_id, kind, posting_key, event, source_kind, source_id, source_event_id, business_date, period, original_period,
                                      map_version, reverses_entry_id, memo, posted_by)
  VALUES (v_id, p_tenant, p_kind, p_key, p_event, p_source_kind, p_source, p_source_event, p_date, public.ledger_open_period(p_tenant, p_date),
          to_char(p_date, 'YYYY-MM'), CASE WHEN p_kind = 'auto' THEN public.ledger_map_version() END, p_reverses, p_memo, p_staff);
  PERFORM public.ledger_entry_open(v_id);
  FOR x IN SELECT l FROM jsonb_array_elements(p_lines) l LOOP
    IF coalesce((x ->> 'debit')::bigint, 0) < 0 OR coalesce((x ->> 'credit')::bigint, 0) < 0 THEN
      RAISE EXCEPTION 'a journal line amount is never negative' USING ERRCODE = '22023';
    END IF;
    IF coalesce((x ->> 'debit')::bigint, 0) + coalesce((x ->> 'credit')::bigint, 0) = 0 THEN
      CONTINUE;
    END IF;
    INSERT INTO public.journal_lines (tenant_id, entry_id, account_id, branch_id, debit, credit)
    VALUES (p_tenant, v_id, public.ledger_account(p_tenant, x ->> 'account'), NULLIF(x ->> 'branch', '')::uuid,
            coalesce((x ->> 'debit')::bigint, 0), coalesce((x ->> 'credit')::bigint, 0));
  END LOOP;
  PERFORM pg_catalog.set_config('app.ledger_entry', '', true);
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_post(uuid, text, text, text, text, uuid, uuid, date, jsonb, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
-- A line helper: {"account", "branch", "debit"} or {"account", "branch", "credit"}.
CREATE FUNCTION public.jl(p_account text, p_branch uuid, p_debit bigint, p_credit bigint) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('account', p_account, 'branch', p_branch, 'debit', coalesce(p_debit, 0), 'credit', coalesce(p_credit, 0))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.jl(text, uuid, bigint, bigint) FROM PUBLIC;--> statement-breakpoint

-- ── T-105 posting rules: the canonical posting-trigger matrix (docs/spec/11 :101–140), the DRAFT map version (G4) ──
-- Every rule is SECURITY DEFINER (it reads the facts whatever the caller's role: the consumer runs in a service context with no role) and
-- granted to nobody: the only entry point is ledger_post_event, which refuses an event of another tenant than the bound one.
-- One rule per TD-50 event. Each reads only immutable source facts by the ids the event carries and posts one balanced entry keyed
-- (tenant, source fact, posting kind) — a replayed or duplicate event posts nothing (unique posting key). Branch dimension per line;
-- business date = the fact's local date. Simulated money never posts (BILL-29). Tender rule: cash → Kas (shift), transfer → Bank, every
-- other external tender → Kliring gateway; balance → patient-balance liability. Rules a fixture marks PENDING post as draft like every
-- other automatic entry (no activation exists in T-105; open gates G-ACT / G-PENDING).

-- The tender account of a payment method.
CREATE FUNCTION public.ledger_tender(p_method text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_method WHEN 'cash' THEN 'cash_shift' WHEN 'transfer' THEN 'bank' WHEN 'bank_transfer' THEN 'bank' WHEN 'balance' THEN 'liability_patient_balance'
                       WHEN 'petty_cash' THEN 'petty_cash' WHEN 'bank' THEN 'bank' ELSE 'gateway_clearing' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_tender(text) FROM PUBLIC;--> statement-breakpoint
-- The revenue account of a catalog item.
CREATE FUNCTION public.ledger_revenue(p_tenant uuid, p_item uuid, p_consultation boolean) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_consultation THEN 'revenue_consultation'
              WHEN (SELECT ci.kind FROM public.catalog_items ci WHERE ci.tenant_id = p_tenant AND ci.id = p_item) = 'product' THEN 'revenue_product'
              ELSE 'revenue_treatment' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_revenue(uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint

-- PaymentAllocated: target an invoice line (→ paid-not-delivered; a package line → package liability) — VAT only for the portion this
-- allocation recognised (the tax-point guard: vat_portion). Top-up, booking DP and receivable allocations post elsewhere (their own events).
CREATE FUNCTION public.ledger_rule_payment_allocated(p_tenant uuid, p_alloc uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a public.payment_allocations;
  y public.payments;
  v_liab text;
BEGIN
  SELECT * INTO a FROM public.payment_allocations x WHERE x.tenant_id = p_tenant AND x.id = p_alloc;
  IF a.id IS NULL OR a.is_simulated OR a.invoice_line_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO y FROM public.payments x WHERE x.tenant_id = p_tenant AND x.id = a.payment_id;
  v_liab := CASE WHEN EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = p_tenant AND pk.invoice_line_id = a.invoice_line_id)
                 THEN 'liability_packages' ELSE 'liability_paid_not_delivered' END;
  RETURN public.ledger_post(p_tenant, 'auto', 'payment_allocated:' || a.id, 'PaymentAllocated', 'payment_allocation', a.id, p_event,
    public.tax_local_date(p_tenant, a.created_at, a.branch_id),
    jsonb_build_array(public.jl(public.ledger_tender(y.method), a.branch_id, a.amount, 0),
                      public.jl(v_liab, a.branch_id, 0, a.amount - a.vat_portion),
                      public.jl('vat_payable', a.branch_id, 0, a.vat_portion)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- TreatmentFinished: a counted single treatment (not a package session) → Dr paid-not-delivered (its net share of the line) / Cr revenue
-- (executing branch) + VAT first recognised by this delivery (vat_events line_delivery of this execution, HYG-023). The entry needs the
-- FINAL line: while its line is not issued yet, or its manual discount is pending (HYG-023 S8: discount_sync fixes the price and recognises
-- the delivery VAT at the decision), nothing posts and nothing raises; the event that finalizes the line wakes it durably
-- (ledger_wake_visit on InvoiceIssued and on a manual_discount ApprovalDecided — approved, rejected or cancelled), not a finite retry.
-- Panel 2 S7-DIFF = A (the HYG-023 S7 single-treatment seam): the entry values one exact (execution, line) fact and is keyed
-- treatment_finished:<execution>:<line>; dated finished_at. A line voided after the delivery keeps its entry and InvoiceVoided mirrors it at
-- voided_at; the re-billed final line posts its own entry once. A package-covered execution keeps treatment_finished:<execution> (unchanged).
CREATE FUNCTION public.ledger_rule_treatment_line(p_tenant uuid, p_execution uuid, p_line uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.treatment_executions;
  l public.invoice_lines;
  v_qty numeric;
  v_net bigint;
  v_vat bigint;
BEGIN
  SELECT * INTO e FROM public.treatment_executions x WHERE x.tenant_id = p_tenant AND x.id = p_execution;
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = p_tenant AND x.id = p_line;
  IF e.id IS NULL OR l.id IS NULL OR e.state <> 'finished' OR NOT e.counted OR public.discount_pending(p_tenant, l.id) THEN
    RETURN NULL;
  END IF;
  v_qty := (SELECT t.qty FROM public.plan_items t WHERE t.tenant_id = p_tenant AND t.id = e.plan_item_id);
  v_net := ((l.line_total - l.vat_amount) * v_qty) / l.quantity;
  v_vat := coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.object_kind = 'line' AND v.object_id = l.id
                       AND v.cause = 'line_delivery' AND v.source_id = e.id), 0);
  RETURN public.ledger_post(p_tenant, 'auto', 'treatment_finished:' || e.id || ':' || l.id, 'TreatmentFinished', 'treatment_execution', e.id, p_event,
    public.tax_local_date(p_tenant, e.finished_at, e.branch_id),
    jsonb_build_array(public.jl('liability_paid_not_delivered', e.branch_id, v_net + v_vat, 0),
                      public.jl(public.ledger_revenue(p_tenant, l.item_id, false), e.branch_id, 0, v_net),
                      public.jl('vat_payable', e.branch_id, 0, v_vat)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint
CREATE FUNCTION public.ledger_rule_treatment_finished(p_tenant uuid, p_execution uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.treatment_executions;
  l record;
  v_net bigint;
  v_vat bigint;
BEGIN
  SELECT * INTO e FROM public.treatment_executions x WHERE x.tenant_id = p_tenant AND x.id = p_execution;
  IF e.id IS NULL OR e.state <> 'finished' OR NOT e.counted THEN
    RETURN NULL;
  END IF;
  IF public.package_execution_covered(p_tenant, e.id) THEN
    -- A package session's performance is SessionRedeemed's. Scenario 12a's dearer substitution (fixture S12a-J3, PENDING A-02 — the split is
    -- the fixture's draft proposal): the difference line paid up to the delivery moves from paid-not-delivered to revenue here, so the
    -- session value plus the difference is recognised once. Draft only (G-PENDING).
    v_net := coalesce((SELECT sum(a.amount - a.vat_portion) FROM public.payment_allocations a
                        JOIN public.invoice_lines il ON il.tenant_id = a.tenant_id AND il.id = a.invoice_line_id
                        JOIN public.package_substitutions u ON u.tenant_id = il.tenant_id AND u.id = il.substitution_id
                        JOIN public.package_sessions s ON s.tenant_id = u.tenant_id AND s.id = u.session_id
                       WHERE a.tenant_id = p_tenant AND NOT a.is_simulated AND s.reserved_execution_id = e.id AND s.state = 'redeemed'
                         AND a.created_at <= e.finished_at), 0);
    IF v_net = 0 THEN
      RETURN NULL;
    END IF;
    RETURN public.ledger_post(p_tenant, 'auto', 'treatment_finished:' || e.id, 'TreatmentFinished', 'treatment_execution', e.id, p_event,
      public.tax_local_date(p_tenant, e.finished_at, e.branch_id),
      jsonb_build_array(public.jl('liability_paid_not_delivered', e.branch_id, v_net, 0), public.jl('revenue_treatment', e.branch_id, 0, v_net)),
      'PENDING A-02 (12a difference line, draft)', NULL, NULL);
  END IF;
  SELECT o.id, o.item_id, o.line_total, o.vat_amount, o.quantity, t.qty INTO l
    FROM public.plan_items t CROSS JOIN LATERAL (
      SELECT il.* FROM public.invoice_lines il JOIN public.invoices i ON i.tenant_id = il.tenant_id AND i.id = il.invoice_id
       WHERE il.tenant_id = p_tenant AND i.visit_id = e.visit_id AND i.state = 'issued' AND il.substitution_id IS NULL AND NOT i.consultation
         AND NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = il.tenant_id AND pk.invoice_line_id = il.id)
         AND (il.plan_item_id = e.plan_item_id OR il.plan_item_id IS NULL AND il.item_id = public.package_plan_service(e.tenant_id, e.plan_item_id)
                                                 AND NOT public.addition_of_visit(e.tenant_id, e.visit_id, e.plan_item_id))
       ORDER BY (il.plan_item_id IS NOT NULL) DESC, il.created_at, il.id LIMIT 1) o
   WHERE t.tenant_id = p_tenant AND t.id = e.plan_item_id;
  IF l.id IS NULL THEN
    -- not final yet: an addition performed before its line is issued (a visit cannot close with an unbilled performed addition, PR-15); a
    -- line whose manual discount waits for its decision waits in ledger_rule_treatment_line. Woken by InvoiceIssued / ApprovalDecided.
    RETURN NULL;
  END IF;
  RETURN public.ledger_rule_treatment_line(p_tenant, e.id, l.id, p_event);
END
$$;--> statement-breakpoint

-- SessionRedeemed: a counted package session → Dr package liability (session value, net of the session's VAT recognised before) / Cr revenue
-- at the executing branch (+ VAT first due at delivery: S1 session_delivery). Cross-branch: balanced inter-branch clearing in the same entry.
CREATE FUNCTION public.ledger_rule_session_redeemed(p_tenant uuid, p_session uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  s public.package_sessions;
  pk public.packages;
  v_vat_now bigint;
  v_vat_before bigint;
  v_net bigint;
  v_lines jsonb;
BEGIN
  SELECT * INTO s FROM public.package_sessions x WHERE x.tenant_id = p_tenant AND x.id = p_session;
  IF s.id IS NULL OR s.state <> 'redeemed' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO pk FROM public.packages x WHERE x.tenant_id = p_tenant AND x.id = s.package_id;
  v_vat_now := coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.object_kind = 'session' AND v.object_id = s.id
                           AND v.cause = 'session_delivery'), 0);
  v_vat_before := coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.object_kind = 'session' AND v.object_id = s.id
                              AND v.cause = 'session_attribution'), 0);
  v_net := s.allocated_value - v_vat_now - v_vat_before;
  IF coalesce(s.redeemed_branch_id, pk.sold_branch_id) = pk.sold_branch_id THEN
    v_lines := jsonb_build_array(public.jl('liability_packages', pk.sold_branch_id, v_net + v_vat_now, 0),
                                 public.jl('revenue_treatment', pk.sold_branch_id, 0, v_net), public.jl('vat_payable', pk.sold_branch_id, 0, v_vat_now));
  ELSE
    v_lines := jsonb_build_array(public.jl('liability_packages', pk.sold_branch_id, v_net + v_vat_now, 0),
                                 public.jl('inter_branch_clearing', pk.sold_branch_id, 0, v_net + v_vat_now),
                                 public.jl('inter_branch_clearing', s.redeemed_branch_id, v_net + v_vat_now, 0),
                                 public.jl('revenue_treatment', s.redeemed_branch_id, 0, v_net), public.jl('vat_payable', s.redeemed_branch_id, 0, v_vat_now));
  END IF;
  RETURN public.ledger_post(p_tenant, 'auto', 'session_redeemed:' || s.id, 'SessionRedeemed', 'package_session', s.id, p_event,
    public.tax_local_date(p_tenant, s.redeemed_at, coalesce(s.redeemed_branch_id, pk.sold_branch_id)), v_lines, NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- ConsultationFeeCharged: the fee line (charged or re-charged) → Dr paid-not-delivered / Cr consultation revenue + VAT recognised at the charge.
CREATE FUNCTION public.ledger_rule_consultation_charged(p_tenant uuid, p_line uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  l public.invoice_lines;
  i public.invoices;
  v_vat bigint;
BEGIN
  SELECT * INTO l FROM public.invoice_lines x WHERE x.tenant_id = p_tenant AND x.id = p_line;
  SELECT * INTO i FROM public.invoices x WHERE x.tenant_id = p_tenant AND x.id = l.invoice_id;
  IF l.id IS NULL OR NOT i.consultation THEN
    RETURN NULL;
  END IF;
  v_vat := coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.object_kind = 'line' AND v.object_id = l.id AND v.cause = 'line_delivery'), 0);
  RETURN public.ledger_post(p_tenant, 'auto', 'consultation_charged:' || l.id, 'ConsultationFeeCharged', 'invoice_line', l.id, p_event,
    public.tax_local_date(p_tenant, i.issued_at, i.branch_id),
    jsonb_build_array(public.jl('liability_paid_not_delivered', i.branch_id, l.line_total - l.vat_amount + v_vat, 0),
                      public.jl('revenue_consultation', i.branch_id, 0, l.line_total - l.vat_amount), public.jl('vat_payable', i.branch_id, 0, v_vat)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- ProductHandedOver: one coordinated entry — Dr paid-not-delivered / Cr product revenue (the handed share, net) and Dr COGS / Cr inventory at
-- the moving-average value of the dispense movements (stock_movement_values).
CREATE FUNCTION public.ledger_rule_product_handed(p_tenant uuid, p_dispensing uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  d public.dispensings;
  l record;
  v_net bigint;
  v_cogs bigint;
BEGIN
  SELECT * INTO d FROM public.dispensings x WHERE x.tenant_id = p_tenant AND x.id = p_dispensing;
  IF d.id IS NULL OR d.state <> 'handed' OR d.prescription_item_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT o.id, o.item_id, o.line_total, o.vat_amount, o.quantity INTO l FROM (
    SELECT il.* FROM public.invoice_lines il LEFT JOIN public.invoices i ON i.tenant_id = il.tenant_id AND i.id = il.invoice_id
      LEFT JOIN public.stock_items si ON si.tenant_id = d.tenant_id AND si.id = d.stock_item_id
     WHERE il.tenant_id = p_tenant AND (il.id = d.invoice_line_id
            OR d.invoice_line_id IS NULL AND i.visit_id = d.visit_id AND i.state = 'issued' AND il.item_id = si.catalog_item_id AND il.plan_item_id IS NULL)
     ORDER BY il.created_at, il.id LIMIT 1) o;
  v_cogs := -coalesce((SELECT sum(mv.value) FROM public.stock_movements m JOIN public.stock_movement_values mv ON mv.tenant_id = m.tenant_id AND mv.movement_id = m.id
                        WHERE m.tenant_id = p_tenant AND m.source_kind = 'dispensing' AND m.source_id = d.id AND m.kind = 'dispense'), 0);
  v_net := CASE WHEN l.id IS NULL THEN 0 ELSE floor(((l.line_total - l.vat_amount) * d.quantity) / l.quantity)::bigint END;
  RETURN public.ledger_post(p_tenant, 'auto', 'product_handed:' || d.id, 'ProductHandedOver', 'dispensing', d.id, p_event,
    public.tax_local_date(p_tenant, d.handed_at, d.branch_id),
    jsonb_build_array(public.jl('liability_paid_not_delivered', d.branch_id, v_net, 0), public.jl('revenue_product', d.branch_id, 0, v_net),
                      public.jl('cogs', d.branch_id, v_cogs, 0), public.jl('inventory', d.branch_id, 0, v_cogs)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- BalanceToppedUp: an external top-up → Dr tender / Cr patient balance (no VAT).
CREATE FUNCTION public.ledger_rule_balance_topped_up(p_tenant uuid, p_entry uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.balance_entries;
  y public.payments;
BEGIN
  SELECT * INTO b FROM public.balance_entries x WHERE x.tenant_id = p_tenant AND x.id = p_entry;
  -- the tender is the top-up's own payment (its allocation names the top-up; balance_entries.payment_id is not set for a top-up)
  SELECT y2.* INTO y FROM public.payment_allocations a JOIN public.payments y2 ON y2.tenant_id = a.tenant_id AND y2.id = a.payment_id
   WHERE a.tenant_id = p_tenant AND a.top_up_id = b.source_id;
  IF b.id IS NULL OR b.kind <> 'top_up' OR y.id IS NULL OR y.is_simulated THEN
    RETURN NULL;
  END IF;
  RETURN public.ledger_post(p_tenant, 'auto', 'balance_topped_up:' || b.id, 'BalanceToppedUp', 'balance_entry', b.id, p_event,
    public.tax_local_date(p_tenant, b.created_at, b.branch_id),
    jsonb_build_array(public.jl(public.ledger_tender(y.method), b.branch_id, b.amount, 0),
                      public.jl('liability_patient_balance', b.branch_id, 0, b.amount)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- ReceivableCreated: Dr patient receivable / Cr paid-not-delivered (clears the delivered unpaid remainder); no revenue, no new VAT here
-- (a conversion's VAT, S2, is recognised on the line; it is credited by this entry so the liability stays net of VAT).
CREATE FUNCTION public.ledger_rule_receivable_created(p_tenant uuid, p_receivable uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.receivables;
  v_vat bigint;
BEGIN
  SELECT * INTO r FROM public.receivables x WHERE x.tenant_id = p_tenant AND x.id = p_receivable;
  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  v_vat := coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.cause = 'receivable_convert' AND v.source_id = r.id), 0);
  RETURN public.ledger_post(p_tenant, 'auto', 'receivable_created:' || r.id, 'ReceivableCreated', 'receivable', r.id, p_event,
    public.tax_local_date(p_tenant, r.created_at, r.branch_id),
    jsonb_build_array(public.jl('patient_receivable', r.branch_id, r.amount, 0), public.jl('liability_paid_not_delivered', r.branch_id, 0, r.amount - v_vat),
                      public.jl('vat_payable', r.branch_id, 0, v_vat)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- ReceivableCollected: Dr tender (or patient balance) / Cr patient receivable; no revenue, no VAT.
CREATE FUNCTION public.ledger_rule_receivable_collected(p_tenant uuid, p_payment uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a public.payment_allocations;
BEGIN
  SELECT * INTO a FROM public.payment_allocations x WHERE x.tenant_id = p_tenant AND x.payment_id = p_payment AND x.receivable_id IS NOT NULL;
  IF a.id IS NULL OR a.is_simulated THEN
    RETURN NULL;
  END IF;
  RETURN public.ledger_post(p_tenant, 'auto', 'receivable_collected:' || a.id, 'ReceivableCollected', 'payment_allocation', a.id, p_event,
    public.tax_local_date(p_tenant, a.created_at, a.branch_id),
    jsonb_build_array(public.jl(public.ledger_tender(a.method), a.branch_id, a.amount, 0), public.jl('patient_receivable', a.branch_id, 0, a.amount)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- ReceivableWrittenOff: Dr bad-debt expense / Cr patient receivable.
CREATE FUNCTION public.ledger_rule_receivable_written_off(p_tenant uuid, p_write_off uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  w public.write_offs;
BEGIN
  SELECT * INTO w FROM public.write_offs x WHERE x.tenant_id = p_tenant AND x.id = p_write_off;
  IF w.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.ledger_post(p_tenant, 'auto', 'receivable_written_off:' || w.id, 'ReceivableWrittenOff', 'write_off', w.id, p_event,
    public.tax_local_date(p_tenant, w.created_at, w.branch_id),
    jsonb_build_array(public.jl('bad_debt_expense', w.branch_id, w.amount, 0), public.jl('patient_receivable', w.branch_id, 0, w.amount)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- Booking DP: received (Dr tender / Cr DP liability + VAT separated at receipt), applied (Dr DP liability / Cr paid-not-delivered; the DP's
-- VAT moves with it — S6 deposit −V / line +v, so no second VAT), forfeited (Dr DP liability / Cr other income — PENDING A-10 / Q-05, draft),
-- refunded on clinic cancellation (Dr DP liability + VAT reversed / Cr tender, gross).
CREATE FUNCTION public.ledger_rule_deposit(p_tenant uuid, p_deposit uuid, p_kind text, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  d public.booking_deposits;
  v_net bigint;
  v_line_vat bigint;
BEGIN
  SELECT * INTO d FROM public.booking_deposits x WHERE x.tenant_id = p_tenant AND x.id = p_deposit;
  IF d.id IS NULL THEN
    RETURN NULL;
  END IF;
  v_net := d.amount - d.vat_amount;
  IF p_kind = 'received' THEN
    RETURN public.ledger_post(p_tenant, 'auto', 'deposit_received:' || d.id, 'BookingDepositReceived', 'booking_deposit', d.id, p_event,
      public.tax_local_date(p_tenant, d.received_at, d.branch_id),
      jsonb_build_array(public.jl(public.ledger_tender(d.method), d.branch_id, d.amount, 0), public.jl('liability_booking_dp', d.branch_id, 0, v_net),
                        public.jl('vat_payable', d.branch_id, 0, d.vat_amount)), NULL, NULL, NULL);
  ELSIF p_kind = 'applied' AND d.state = 'applied' THEN
    -- the DP's recognised VAT leaves the DP object (−V) and the line takes v ≤ V (S6); any excess V − v is reversed here
    v_line_vat := coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.object_kind = 'line' AND v.cause = 'deposit_apply' AND v.source_id = d.id), 0);
    RETURN public.ledger_post(p_tenant, 'auto', 'deposit_applied:' || d.id, 'BookingDepositApplied', 'booking_deposit', d.id, p_event,
      public.tax_local_date(p_tenant, d.decided_at, d.branch_id),
      jsonb_build_array(public.jl('liability_booking_dp', d.branch_id, v_net, 0), public.jl('vat_payable', d.branch_id, d.vat_amount - v_line_vat, 0),
                        public.jl('liability_paid_not_delivered', d.branch_id, 0, d.amount - v_line_vat)), NULL, NULL, NULL);
  ELSIF p_kind = 'forfeited' AND d.state = 'forfeited' THEN
    RETURN public.ledger_post(p_tenant, 'auto', 'deposit_forfeited:' || d.id, 'BookingDepositForfeited', 'booking_deposit', d.id, p_event,
      public.tax_local_date(p_tenant, d.decided_at, d.branch_id),
      jsonb_build_array(public.jl('liability_booking_dp', d.branch_id, v_net, 0), public.jl('vat_payable', d.branch_id, d.vat_amount, 0),
                        public.jl('other_income', d.branch_id, 0, d.amount)), 'PENDING A-10 / Q-05 (draft)', NULL, NULL);
  ELSIF p_kind = 'refunded' AND d.state = 'refunded' THEN
    RETURN public.ledger_post(p_tenant, 'auto', 'deposit_refunded:' || d.id, 'BookingDepositRefunded', 'booking_deposit', d.id, p_event,
      public.tax_local_date(p_tenant, d.decided_at, d.branch_id),
      jsonb_build_array(public.jl('liability_booking_dp', d.branch_id, v_net, 0), public.jl('vat_payable', d.branch_id, d.vat_amount, 0),
                        public.jl(public.ledger_tender(d.refund_method), d.branch_id, 0, d.amount)), NULL, NULL, NULL);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- BalanceMoved (one source fact, one reason): Dr source liability net + VAT reversed / Cr patient balance gross; for a delivered-item refund
-- Dr revenue (net) + VAT reversed / Cr balance. Sources: package expiry / cancellation (packages), interrupted treatment (paid-not-delivered),
-- cheaper substitution (packages), booking DP moved (DP liability), refund (paid-not-delivered, or revenue when delivered).
CREATE FUNCTION public.ledger_rule_balance_moved(p_tenant uuid, p_entry uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  b public.balance_entries;
  v_src text;
  v_vat bigint := 0;
  v_rev text;
  r public.refunds;
BEGIN
  SELECT * INTO b FROM public.balance_entries x WHERE x.tenant_id = p_tenant AND x.id = p_entry;
  IF b.id IS NULL OR b.kind NOT IN ('from_expiry','from_cancel','from_interrupted_treatment','from_substitution','from_refund','dp_transfer') THEN
    RETURN NULL;
  END IF;
  IF b.kind IN ('from_expiry','from_cancel') THEN
    v_src := 'liability_packages';
    v_vat := -coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.source_id = b.source_id
                          AND v.cause IN ('package_close_line','package_close_package')), 0);
  ELSIF b.kind = 'from_substitution' THEN
    v_src := 'liability_packages';
    v_vat := -coalesce((SELECT sum(v.delta) FROM public.vat_events v JOIN public.package_substitutions u ON u.tenant_id = v.tenant_id AND u.id = b.source_id
                         WHERE v.tenant_id = p_tenant AND v.object_kind = 'package' AND v.object_id = u.package_id AND v.cause = 'package_sync_reversal'
                           AND v.effective_at = u.decided_at), 0);
  ELSIF b.kind = 'from_interrupted_treatment' THEN
    v_src := 'liability_paid_not_delivered';
    v_vat := -coalesce((SELECT sum(v.delta) FROM public.vat_events v WHERE v.tenant_id = p_tenant AND v.cause = 'interrupted' AND v.source_id = b.source_id), 0);
  ELSIF b.kind = 'dp_transfer' THEN
    v_src := 'liability_booking_dp';
    v_vat := coalesce((SELECT d.vat_amount FROM public.booking_deposits d WHERE d.tenant_id = p_tenant AND d.id = b.source_id), 0);
  ELSE
    SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = p_tenant AND x.id = b.source_id;
    v_vat := r.vat_reversed;
    IF r.delivered THEN
      v_src := public.ledger_revenue(p_tenant, (SELECT l.item_id FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.id = r.invoice_line_id), false);
    ELSE
      v_src := 'liability_paid_not_delivered';
    END IF;
  END IF;
  RETURN public.ledger_post(p_tenant, 'auto', 'balance_moved:' || b.id, 'BalanceMoved', 'balance_entry', b.id, p_event,
    public.tax_local_date(p_tenant, b.created_at, b.branch_id),
    jsonb_build_array(public.jl(v_src, b.branch_id, b.amount - v_vat, 0), public.jl('vat_payable', b.branch_id, v_vat, 0),
                      public.jl('liability_patient_balance', b.branch_id, 0, b.amount)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- RefundPaid: the cash-refund exception only → Dr patient balance / Cr tender (balance refunds post through BalanceMoved).
CREATE FUNCTION public.ledger_rule_refund_paid(p_tenant uuid, p_refund uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.refunds;
  b public.balance_entries;
BEGIN
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = p_tenant AND x.id = p_refund;
  IF r.id IS NULL OR r.state <> 'paid' OR r.destination <> 'cash' OR r.cash_entry_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO b FROM public.balance_entries x WHERE x.tenant_id = p_tenant AND x.id = r.cash_entry_id;
  RETURN public.ledger_post(p_tenant, 'auto', 'refund_paid:' || r.id, 'RefundPaid', 'refund', r.id, p_event,
    public.tax_local_date(p_tenant, r.paid_at, r.branch_id),
    jsonb_build_array(public.jl('liability_patient_balance', r.branch_id, -b.amount, 0),
                      public.jl(public.ledger_tender(coalesce(r.paid_method, 'cash')), r.branch_id, 0, -b.amount)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- ProductReturned: COGS only — Dr inventory / Cr COGS at the moving-average value of the return movements.
CREATE FUNCTION public.ledger_rule_product_returned(p_tenant uuid, p_refund uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.refunds;
  v bigint;
BEGIN
  SELECT * INTO r FROM public.refunds x WHERE x.tenant_id = p_tenant AND x.id = p_refund;
  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  v := coalesce((SELECT sum(mv.value) FROM public.stock_movements m JOIN public.stock_movement_values mv ON mv.tenant_id = m.tenant_id AND mv.movement_id = m.id
                  WHERE m.tenant_id = p_tenant AND m.source_kind = 'refund' AND m.source_id = r.id AND m.kind = 'return'), 0);
  RETURN public.ledger_post(p_tenant, 'auto', 'product_returned:' || r.id, 'ProductReturned', 'refund', r.id, p_event,
    public.tax_local_date(p_tenant, r.paid_at, r.branch_id),
    jsonb_build_array(public.jl('inventory', r.branch_id, v, 0), public.jl('cogs', r.branch_id, 0, v)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- StockConsumed / StockWasted: Dr materials cost / waste expense / Cr inventory at the moving-average value of the movements of that fact.
CREATE FUNCTION public.ledger_rule_stock(p_tenant uuid, p_source_kind text, p_source uuid, p_kind text, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v bigint;
  v_branch uuid;
  v_at timestamptz;
BEGIN
  SELECT -sum(mv.value), min(m.branch_id::text)::uuid, min(m.created_at) INTO v, v_branch, v_at
    FROM public.stock_movements m JOIN public.stock_movement_values mv ON mv.tenant_id = m.tenant_id AND mv.movement_id = m.id
   WHERE m.tenant_id = p_tenant AND m.source_kind = p_source_kind AND m.source_id = p_source AND m.kind = p_kind;
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.ledger_post(p_tenant, 'auto', 'stock_' || p_kind || ':' || p_source, CASE WHEN p_kind = 'consume' THEN 'StockConsumed' ELSE 'StockWasted' END,
    p_source_kind, p_source, p_event, public.tax_local_date(p_tenant, v_at, v_branch),
    jsonb_build_array(public.jl(CASE WHEN p_kind = 'consume' THEN 'materials_cost' ELSE 'waste_expense' END, v_branch, v, 0), public.jl('inventory', v_branch, 0, v)),
    NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- Commission: accrued (Dr expense / Cr payable), adjusted (Dr payable — or staff receivable when already paid — / Cr expense), paid (Dr payable /
-- Cr tender for the batch's net lines).
CREATE FUNCTION public.ledger_rule_commission(p_tenant uuid, p_kind text, p_id uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.commission_entitlements;
  x public.commission_adjustments;
  b public.payout_batches;
  v bigint;
BEGIN
  IF p_kind = 'accrued' THEN
    SELECT * INTO e FROM public.commission_entitlements y WHERE y.tenant_id = p_tenant AND y.id = p_id;
    IF e.id IS NULL OR e.amount = 0 THEN RETURN NULL; END IF;
    RETURN public.ledger_post(p_tenant, 'auto', 'commission_accrued:' || e.id, 'CommissionAccrued', 'commission_entitlement', e.id, p_event,
      public.tax_local_date(p_tenant, e.accrued_at, e.branch_id),
      jsonb_build_array(public.jl('commission_expense', e.branch_id, e.amount, 0), public.jl('commission_payable', e.branch_id, 0, e.amount)), NULL, NULL, NULL);
  ELSIF p_kind = 'adjusted' THEN
    SELECT * INTO x FROM public.commission_adjustments y WHERE y.tenant_id = p_tenant AND y.id = p_id;
    IF x.id IS NULL OR x.amount = 0 THEN RETURN NULL; END IF;
    RETURN public.ledger_post(p_tenant, 'auto', 'commission_adjusted:' || x.id, 'CommissionAdjusted', 'commission_adjustment', x.id, p_event,
      public.tax_local_date(p_tenant, x.adjusted_at, x.branch_id),
      jsonb_build_array(public.jl(CASE WHEN x.after_payout THEN 'staff_receivable' ELSE 'commission_payable' END, x.branch_id, -x.amount, 0),
                        public.jl('commission_expense', x.branch_id, 0, -x.amount)), NULL, NULL, NULL);
  ELSIF p_kind = 'paid' THEN
    SELECT * INTO b FROM public.payout_batches y WHERE y.tenant_id = p_tenant AND y.id = p_id;
    IF b.id IS NULL OR b.state <> 'paid' THEN RETURN NULL; END IF;
    v := coalesce((SELECT sum(l.net_payable) FROM public.payout_batch_lines l WHERE l.tenant_id = p_tenant AND l.batch_id = b.id), 0);
    RETURN public.ledger_post(p_tenant, 'auto', 'commission_paid:' || b.id, 'CommissionPaid', 'payout_batch', b.id, p_event,
      public.tax_local_date(p_tenant, b.paid_at, NULL),
      jsonb_build_array(public.jl('commission_payable', NULL, v, 0), public.jl(public.ledger_tender(b.paid_method), NULL, 0, v)), NULL, NULL, NULL);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- GatewaySettlementReceived (G1 = b): a settlement fact {branch, settled_on, gross, fee} → Dr Bank (gross − fee) + Merchant fee expense / Cr
-- Kliring gateway (gross). NO production intake exists (open gate G-SETTLE): only a test harness calls this, through the real posting core.
CREATE FUNCTION public.ledger_rule_gateway_settlement(p_tenant uuid, p_settlement uuid, p_branch uuid, p_settled_on date, p_gross bigint, p_fee bigint, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_gross <= 0 OR p_fee < 0 OR p_fee >= p_gross THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: settlement' USING ERRCODE = '22023';
  END IF;
  RETURN public.ledger_post(p_tenant, 'auto', 'gateway_settlement:' || p_settlement, 'GatewaySettlementReceived', 'gateway_settlement', p_settlement, p_event, p_settled_on,
    jsonb_build_array(public.jl('bank', p_branch, p_gross - p_fee, 0), public.jl('merchant_fee_expense', p_branch, p_fee, 0),
                      public.jl('gateway_clearing', p_branch, 0, p_gross)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- ── T-105 posting rules: stock, purchasing, expenses and domain reversals (docs/spec/11 :128–138; draft map) ──
-- Values are the facts' own: moving-average movement values (stock_movement_values), receipt costs (supplier_receipts), invoice lines,
-- allocations, credit notes, expenses. Draft rows of the map's "pending accountant" block (GRNI, PPV, supplier receivable, VAT input) post as
-- draft like every automatic entry (G-PENDING / G-ACT).

-- StockReturned: only a return reversing a posted consumption mirrors it; unconsumed issued stock returned has no GL movement (11 :133). The
-- materials flow posts consumption at use, so a usable return of issued stock is never a reversal here: nothing posts.

-- Consumption order (Panel 2 REVISE r2): events_claim skips live leases and locked rows, so a domain reversal can be consumed before its
-- original. Only the reversal rules read journal entries; every other rule reads immutable facts. So each reversal first posts its
-- original FROM THE FACT (idempotent on the posting key: the original event, consumed later, posts nothing), then mirrors it, dated at the
-- domain reversal (reversed_at / voided_at / closed_at), never at the worker's clock. An original posted on behalf of its reversal has
-- source_event_id NULL (its own event has not been consumed yet). An original that legitimately posts nothing (a zero or simulated fact)
-- leaves nothing to mirror; the reversal then acks with nothing posted.

-- StockTransferred: Dr Inventory (to branch) / Cr Inventory (from branch), same value, one fact; an intra-branch transfer is a zero-net same
-- account move and posts nothing; an inter-branch transfer posts at dispatch ('sent') and is mirrored if cancelled.
CREATE FUNCTION public.ledger_rule_stock_transferred(p_tenant uuid, p_transfer uuid, p_state text, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t public.depot_transfers;
  v bigint;
  v_at timestamptz;
  v_id uuid;
BEGIN
  SELECT * INTO t FROM public.depot_transfers x WHERE x.tenant_id = p_tenant AND x.id = p_transfer;
  IF t.id IS NULL OR t.kind <> 'inter' OR p_state NOT IN ('sent','cancelled') THEN
    RETURN NULL;
  END IF;
  SELECT -sum(mv.value), min(m.created_at) INTO v, v_at FROM public.stock_movements m JOIN public.stock_movement_values mv ON mv.tenant_id = m.tenant_id AND mv.movement_id = m.id
   WHERE m.tenant_id = p_tenant AND m.source_kind = 'depot_transfer' AND m.source_id = t.id AND m.kind = 'transfer_out';
  -- the send posts from its movements whichever event is consumed first
  v_id := public.ledger_post(p_tenant, 'auto', 'stock_transferred:' || t.id, 'StockTransferred', 'depot_transfer', t.id,
    CASE WHEN p_state = 'sent' THEN p_event END, public.tax_local_date(p_tenant, v_at, t.from_branch_id),
    jsonb_build_array(public.jl('inventory', t.to_branch_id, v, 0), public.jl('inventory', t.from_branch_id, 0, v)), NULL, NULL, NULL);
  IF p_state = 'sent' THEN
    RETURN v_id;
  END IF;
  RETURN public.ledger_post(p_tenant, 'reversal', 'stock_transfer_cancelled:' || t.id, 'StockTransferred', 'depot_transfer', t.id, p_event,
    public.tax_local_date(p_tenant, t.closed_at, t.from_branch_id),
    jsonb_build_array(public.jl('inventory', t.from_branch_id, v, 0), public.jl('inventory', t.to_branch_id, 0, v)), 'Transfer dibatalkan', NULL,
    (SELECT e.id FROM public.journal_entries e WHERE e.tenant_id = p_tenant AND e.posting_key = 'stock_transferred:' || t.id));
END
$$;--> statement-breakpoint

-- GoodsReceived: Dr Inventory / Cr GRNI at the receipt costs (Σ quantity × unit cost of its supplier receipts; payables_grni rounding).
CREATE FUNCTION public.ledger_rule_goods_received(p_tenant uuid, p_receipt uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g public.goods_receipts;
  v bigint;
BEGIN
  SELECT * INTO g FROM public.goods_receipts x WHERE x.tenant_id = p_tenant AND x.id = p_receipt;
  IF g.id IS NULL THEN
    RETURN NULL;
  END IF;
  v := coalesce((SELECT sum(public.payables_grni(r)) FROM public.supplier_receipts r WHERE r.tenant_id = p_tenant AND r.source_kind = 'goods_receipt' AND r.source_id = g.id), 0);
  RETURN public.ledger_post(p_tenant, 'auto', 'goods_received:' || g.id, 'GoodsReceived', 'goods_receipt', g.id, p_event,
    public.tax_local_date(p_tenant, g.received_at, g.branch_id),
    jsonb_build_array(public.jl('inventory', g.branch_id, v, 0), public.jl('grni', g.branch_id, 0, v)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- SupplierInvoiceRecorded (goods invoices only): Dr GRNI (the receipts' GRNI) ± purchase price variance / Cr AP (invoice total).
CREATE FUNCTION public.ledger_rule_supplier_invoice(p_tenant uuid, p_invoice uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i public.supplier_invoices;
  v_grni bigint;
BEGIN
  SELECT * INTO i FROM public.supplier_invoices x WHERE x.tenant_id = p_tenant AND x.id = p_invoice;
  IF i.id IS NULL OR i.kind <> 'purchase' THEN
    RETURN NULL;
  END IF;
  v_grni := coalesce((SELECT sum(l.grni_amount) FROM public.supplier_invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = i.id), 0);
  RETURN public.ledger_post(p_tenant, 'auto', 'supplier_invoice:' || i.id, 'SupplierInvoiceRecorded', 'supplier_invoice', i.id, p_event,
    public.tax_local_date(p_tenant, i.recorded_at, i.branch_id),
    jsonb_build_array(public.jl('grni', i.branch_id, v_grni, 0),
                      public.jl('purchase_price_variance', i.branch_id, greatest(i.total - v_grni, 0), greatest(v_grni - i.total, 0)),
                      public.jl('accounts_payable', i.branch_id, 0, i.total)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- ExpenseRecorded: Dr branch expense / Cr petty cash, cash, bank or AP (an unpaid expense's linked invoice posts nothing of its own).
CREATE FUNCTION public.ledger_rule_expense(p_tenant uuid, p_expense uuid, p_reversed boolean, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.expenses;
  v_credit text;
  v_id uuid;
BEGIN
  SELECT * INTO e FROM public.expenses x WHERE x.tenant_id = p_tenant AND x.id = p_expense;
  IF e.id IS NULL OR p_reversed AND e.state <> 'reversed' THEN
    RETURN NULL;
  END IF;
  v_credit := CASE e.funding WHEN 'unpaid' THEN 'accounts_payable' WHEN 'cash' THEN 'cash_shift' ELSE public.ledger_tender(e.funding) END;
  -- the recognition posts from the fact whichever event is consumed first
  v_id := public.ledger_post(p_tenant, 'auto', 'expense:' || e.id, 'ExpenseRecorded', 'expense', e.id, CASE WHEN NOT p_reversed THEN p_event END, e.business_date,
    jsonb_build_array(public.jl('branch_expense', e.branch_id, e.amount, 0), public.jl(v_credit, e.branch_id, 0, e.amount)), NULL, NULL, NULL);
  IF NOT p_reversed THEN
    RETURN v_id;
  END IF;
  RETURN public.ledger_post(p_tenant, 'reversal', 'expense_reversed:' || e.id, 'ExpenseReversed', 'expense', e.id, p_event,
    public.tax_local_date(p_tenant, e.reversed_at, e.branch_id),
    jsonb_build_array(public.jl(v_credit, e.branch_id, e.amount, 0), public.jl('branch_expense', e.branch_id, 0, e.amount)), 'Biaya dibatalkan', NULL,
    (SELECT j.id FROM public.journal_entries j WHERE j.tenant_id = p_tenant AND j.posting_key = 'expense:' || e.id));
END
$$;--> statement-breakpoint

-- SupplierPaymentAllocated: Dr AP / Cr Cash/Bank per allocation (goods or expense invoice); SupplierPaymentReversed mirrors the allocations.
CREATE FUNCTION public.ledger_rule_supplier_payment(p_tenant uuid, p_payment uuid, p_invoice uuid, p_reversed boolean, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pm public.supplier_payments;
  x public.supplier_payment_allocations;
  v_last uuid;
  v_id uuid;
BEGIN
  SELECT * INTO pm FROM public.supplier_payments y WHERE y.tenant_id = p_tenant AND y.id = p_payment;
  IF pm.id IS NULL THEN
    RETURN NULL;
  END IF;
  FOR x IN SELECT * FROM public.supplier_payment_allocations y WHERE y.tenant_id = p_tenant AND y.payment_id = pm.id
             AND (p_invoice IS NULL OR y.invoice_id = p_invoice) ORDER BY y.allocated_at, y.id LOOP
    -- each allocation posts from the fact whichever event is consumed first
    v_id := public.ledger_post(p_tenant, 'auto', 'supplier_payment_allocated:' || x.id, 'SupplierPaymentAllocated', 'supplier_payment_allocation', x.id,
      CASE WHEN NOT p_reversed THEN p_event END, public.tax_local_date(p_tenant, x.allocated_at, x.branch_id),
      jsonb_build_array(public.jl('accounts_payable', x.branch_id, x.amount, 0), public.jl(public.ledger_tender(pm.method), x.branch_id, 0, x.amount)), NULL, NULL, NULL);
    IF NOT p_reversed THEN
      v_last := coalesce(v_id, v_last);
    ELSIF x.reversed THEN
      v_last := coalesce(public.ledger_post(p_tenant, 'reversal', 'supplier_payment_reversed:' || x.id, 'SupplierPaymentReversed', 'supplier_payment_allocation', x.id, p_event,
        public.tax_local_date(p_tenant, pm.reversed_at, x.branch_id),
        jsonb_build_array(public.jl(public.ledger_tender(pm.method), x.branch_id, x.amount, 0), public.jl('accounts_payable', x.branch_id, 0, x.amount)), 'Pembayaran pemasok dibatalkan', NULL,
        (SELECT j.id FROM public.journal_entries j WHERE j.tenant_id = p_tenant AND j.posting_key = 'supplier_payment_allocated:' || x.id)), v_last);
    END IF;
  END LOOP;
  RETURN v_last;
END
$$;--> statement-breakpoint

-- SupplierReturned: Dr supplier receivable / Cr inventory at the moving-average value moved out (credit-note VAT per the signed map: draft).
CREATE FUNCTION public.ledger_rule_supplier_returned(p_tenant uuid, p_return uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.supplier_returns;
BEGIN
  SELECT * INTO r FROM public.supplier_returns x WHERE x.tenant_id = p_tenant AND x.id = p_return;
  IF r.id IS NULL OR r.value = 0 THEN
    RETURN NULL;
  END IF;
  RETURN public.ledger_post(p_tenant, 'auto', 'supplier_returned:' || r.id, 'SupplierReturned', 'supplier_return', r.id, p_event,
    public.tax_local_date(p_tenant, r.returned_at, r.branch_id),
    jsonb_build_array(public.jl('supplier_receivable', r.branch_id, r.value, 0), public.jl('inventory', r.branch_id, 0, r.value)), NULL, NULL, NULL);
END
$$;--> statement-breakpoint

-- SupplierCreditApplied: Dr AP / Cr supplier receivable per application.
CREATE FUNCTION public.ledger_rule_supplier_credit(p_tenant uuid, p_note uuid, p_invoice uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x public.supplier_credit_applications;
  v_last uuid;
BEGIN
  -- every application of the pair posts, also one already reversed with its note (SupplierCreditReversed mirrors it); p_invoice NULL = all
  FOR x IN SELECT * FROM public.supplier_credit_applications y WHERE y.tenant_id = p_tenant AND y.credit_note_id = p_note AND (p_invoice IS NULL OR y.invoice_id = p_invoice)
            ORDER BY y.applied_at, y.id LOOP
    v_last := coalesce(public.ledger_post(p_tenant, 'auto', 'supplier_credit_applied:' || x.id, 'SupplierCreditApplied', 'supplier_credit_application', x.id, p_event,
      public.tax_local_date(p_tenant, x.applied_at, x.branch_id),
      jsonb_build_array(public.jl('accounts_payable', x.branch_id, x.amount, 0), public.jl('supplier_receivable', x.branch_id, 0, x.amount)), NULL, NULL, NULL), v_last);
  END LOOP;
  RETURN v_last;
END
$$;--> statement-breakpoint

-- Domain reversals that own the exact mirror of their original entry (11 :134): InvoiceVoided (the voided invoice's ConsultationFeeCharged
-- and PaymentAllocated entries — a void is refused once paid, DP-applied, converted or handed over; a treatment delivered on the voided line
-- stays recognised: TreatmentFinished is keyed per execution and the re-billed line settles it, PR-15 / HYG-023 S7), SupplierInvoiceReversed,
-- SupplierCreditReversed. A mirror swaps debit and credit of every line, posts once (reverses_entry_id unique), into the open period.
CREATE FUNCTION public.ledger_mirror(p_tenant uuid, p_original uuid, p_key text, p_event_name text, p_source_kind text, p_source uuid, p_event uuid, p_date date, p_memo text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_lines jsonb;
BEGIN
  IF p_original IS NULL OR EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.tenant_id = p_tenant AND e.reverses_entry_id = p_original) THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_agg(public.jl(a.key, l.branch_id, l.credit, l.debit) ORDER BY l.id) INTO v_lines
    FROM public.journal_lines l JOIN public.ledger_accounts a ON a.tenant_id = l.tenant_id AND a.id = l.account_id
   WHERE l.tenant_id = p_tenant AND l.entry_id = p_original;
  RETURN public.ledger_post(p_tenant, 'reversal', p_key, p_event_name, p_source_kind, p_source, p_event, p_date, v_lines, p_memo, NULL, p_original);
END
$$;--> statement-breakpoint
CREATE FUNCTION public.ledger_rule_reversal(p_tenant uuid, p_type text, p_id uuid, p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o record;
  v_last uuid;
  iv public.invoices;
  si public.supplier_invoices;
  cn public.supplier_credit_notes;
BEGIN
  IF p_type = 'InvoiceVoided' THEN
    SELECT * INTO iv FROM public.invoices x WHERE x.tenant_id = p_tenant AND x.id = p_id;
    -- the originals first, from their facts: a consultation fee charged on this invoice, any allocation to its lines
    PERFORM public.ledger_rule_consultation_charged(p_tenant, l.id, NULL) FROM public.invoice_lines l
      WHERE l.tenant_id = p_tenant AND l.invoice_id = iv.id ORDER BY l.id;
    PERFORM public.ledger_rule_payment_allocated(p_tenant, a.id, NULL)
       FROM public.payment_allocations a JOIN public.invoice_lines l ON l.tenant_id = a.tenant_id AND l.id = a.invoice_line_id
      WHERE a.tenant_id = p_tenant AND l.invoice_id = iv.id ORDER BY a.id;
    -- S7-DIFF = A: a line of this invoice delivered (before the void) by a counted single treatment — its (execution, line) performance entry,
    -- valued at this line, is posted from the facts first, then mirrored below. Same line match as ledger_rule_treatment_finished.
    PERFORM public.ledger_rule_treatment_line(p_tenant, x.id, l.id, NULL)
       FROM public.invoice_lines l JOIN public.treatment_executions x ON x.tenant_id = l.tenant_id AND x.visit_id = iv.visit_id
      WHERE l.tenant_id = p_tenant AND l.invoice_id = iv.id AND NOT iv.consultation AND l.substitution_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.packages pk WHERE pk.tenant_id = l.tenant_id AND pk.invoice_line_id = l.id)
        AND x.state = 'finished' AND x.counted AND x.finished_at <= iv.voided_at AND NOT public.package_execution_covered(p_tenant, x.id)
        AND (l.plan_item_id = x.plan_item_id OR l.plan_item_id IS NULL AND l.item_id = public.package_plan_service(x.tenant_id, x.plan_item_id)
                                                AND NOT public.addition_of_visit(x.tenant_id, x.visit_id, x.plan_item_id))
      ORDER BY l.id, x.id;
    FOR o IN SELECT e.id, e.posting_key FROM public.journal_entries e
              WHERE e.tenant_id = p_tenant AND e.kind = 'auto' AND (
                    e.source_kind = 'payment_allocation' AND e.source_id IN (SELECT a.id FROM public.payment_allocations a JOIN public.invoice_lines l ON l.tenant_id = a.tenant_id AND l.id = a.invoice_line_id
                                                                            WHERE a.tenant_id = p_tenant AND l.invoice_id = p_id)
                 OR e.source_kind = 'invoice_line' AND e.source_id IN (SELECT l.id FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_id)
                 OR e.source_kind = 'treatment_execution' AND e.posting_key ~ '^treatment_finished:[0-9a-f-]{36}:[0-9a-f-]{36}$'
                    AND right(e.posting_key, 36)::uuid IN (SELECT l.id FROM public.invoice_lines l WHERE l.tenant_id = p_tenant AND l.invoice_id = p_id))
              ORDER BY e.posted_at, e.id LOOP
      v_last := coalesce(public.ledger_mirror(p_tenant, o.id, 'invoice_voided:' || o.id, 'InvoiceVoided', 'invoice', p_id, p_event,
                                              public.tax_local_date(p_tenant, iv.voided_at, iv.branch_id), 'Invoice dibatalkan'), v_last);
    END LOOP;
    RETURN v_last;
  ELSIF p_type = 'SupplierInvoiceReversed' THEN
    SELECT * INTO si FROM public.supplier_invoices x WHERE x.tenant_id = p_tenant AND x.id = p_id;
    PERFORM public.ledger_rule_supplier_invoice(p_tenant, si.id, NULL);
    RETURN public.ledger_mirror(p_tenant, (SELECT e.id FROM public.journal_entries e WHERE e.tenant_id = p_tenant AND e.posting_key = 'supplier_invoice:' || si.id),
      'supplier_invoice_reversed:' || si.id, 'SupplierInvoiceReversed', 'supplier_invoice', si.id, p_event,
      public.tax_local_date(p_tenant, si.reversed_at, si.branch_id), 'Tagihan pemasok dibatalkan');
  ELSIF p_type = 'SupplierCreditReversed' THEN
    SELECT * INTO cn FROM public.supplier_credit_notes x WHERE x.tenant_id = p_tenant AND x.id = p_id;
    PERFORM public.ledger_rule_supplier_credit(p_tenant, cn.id, NULL, NULL);
    FOR o IN SELECT e.id FROM public.journal_entries e JOIN public.supplier_credit_applications x ON x.tenant_id = e.tenant_id AND e.posting_key = 'supplier_credit_applied:' || x.id
              WHERE e.tenant_id = p_tenant AND x.credit_note_id = cn.id ORDER BY e.id LOOP
      v_last := coalesce(public.ledger_mirror(p_tenant, o.id, 'supplier_credit_reversed:' || o.id, 'SupplierCreditReversed', 'supplier_credit_note', cn.id, p_event,
                                              public.tax_local_date(p_tenant, cn.reversed_at, cn.branch_id), 'Nota kredit pemasok dibatalkan'), v_last);
    END LOOP;
    RETURN v_last;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_rule_stock_transferred(uuid, uuid, text, uuid), public.ledger_rule_goods_received(uuid, uuid, uuid),
  public.ledger_rule_supplier_invoice(uuid, uuid, uuid), public.ledger_rule_expense(uuid, uuid, boolean, uuid),
  public.ledger_rule_supplier_payment(uuid, uuid, uuid, boolean, uuid), public.ledger_rule_supplier_returned(uuid, uuid, uuid),
  public.ledger_rule_supplier_credit(uuid, uuid, uuid, uuid), public.ledger_mirror(uuid, uuid, text, text, text, uuid, uuid, date, text),
  public.ledger_rule_reversal(uuid, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- ── T-105 dispatch: one domain event → its matrix rule (payload ids only); the outbox consumer 'ledger.posting' ──
-- Durable wake-up (Panel 2 REVISE r3): the performance entries of a visit whose line was not final when TreatmentFinished was consumed post
-- when the line becomes final — at InvoiceIssued (the line exists) and at a manual_discount ApprovalDecided (the price is final: approved,
-- rejected or cancelled; every writer of approvals.state emits ApprovalDecided). Idempotent on the posting key; posts nothing of its own.
CREATE FUNCTION public.ledger_wake_visit(p_tenant uuid, p_visit uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  x record;
  v_last uuid;
BEGIN
  -- every finished, counted execution of the visit: the rule is idempotent per (execution, line), so a re-billed line posts once
  FOR x IN SELECT e.id FROM public.treatment_executions e
            WHERE e.tenant_id = p_tenant AND e.visit_id = p_visit AND e.state = 'finished' AND e.counted
            ORDER BY e.finished_at, e.id LOOP
    v_last := coalesce(public.ledger_rule_treatment_finished(p_tenant, x.id, NULL), v_last);
  END LOOP;
  RETURN v_last;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_wake_visit(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.ledger_post_event(p_event uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  e public.domain_events;
  p jsonb;
BEGIN
  SELECT * INTO e FROM public.domain_events x WHERE x.id = p_event;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: event' USING ERRCODE = 'P0002';
  END IF;
  -- a bound caller (the consumer binds the event's tenant) may only post its own tenant's events
  IF public.app_tenant_id() IS DISTINCT FROM e.tenant_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: event of another tenant' USING ERRCODE = '42501';
  END IF;
  p := e.payload;
  RETURN CASE e.type
    WHEN 'PaymentAllocated' THEN public.ledger_rule_payment_allocated(e.tenant_id, (p ->> 'allocation_id')::uuid, e.id)
    WHEN 'TreatmentFinished' THEN public.ledger_rule_treatment_finished(e.tenant_id, (p ->> 'execution_id')::uuid, e.id)
    WHEN 'SessionRedeemed' THEN public.ledger_rule_session_redeemed(e.tenant_id, (p ->> 'session_id')::uuid, e.id)
    WHEN 'ConsultationFeeCharged' THEN public.ledger_rule_consultation_charged(e.tenant_id, (p ->> 'invoice_line_id')::uuid, e.id)
    WHEN 'ProductHandedOver' THEN public.ledger_rule_product_handed(e.tenant_id, (p ->> 'dispensing_id')::uuid, e.id)
    WHEN 'BalanceToppedUp' THEN public.ledger_rule_balance_topped_up(e.tenant_id, (p ->> 'entry_id')::uuid, e.id)
    WHEN 'BalanceMoved' THEN public.ledger_rule_balance_moved(e.tenant_id, (p ->> 'entry_id')::uuid, e.id)
    WHEN 'ReceivableCreated' THEN public.ledger_rule_receivable_created(e.tenant_id, (p ->> 'receivable_id')::uuid, e.id)
    WHEN 'ReceivableCollected' THEN public.ledger_rule_receivable_collected(e.tenant_id, (p ->> 'payment_id')::uuid, e.id)
    WHEN 'ReceivableWrittenOff' THEN public.ledger_rule_receivable_written_off(e.tenant_id, (p ->> 'write_off_id')::uuid, e.id)
    WHEN 'BookingDepositReceived' THEN public.ledger_rule_deposit(e.tenant_id, (p ->> 'deposit_id')::uuid, 'received', e.id)
    WHEN 'BookingDepositApplied' THEN public.ledger_rule_deposit(e.tenant_id, (p ->> 'deposit_id')::uuid, 'applied', e.id)
    WHEN 'BookingDepositForfeited' THEN public.ledger_rule_deposit(e.tenant_id, (p ->> 'deposit_id')::uuid, 'forfeited', e.id)
    WHEN 'BookingDepositRefunded' THEN public.ledger_rule_deposit(e.tenant_id, (p ->> 'deposit_id')::uuid, 'refunded', e.id)
    WHEN 'RefundPaid' THEN public.ledger_rule_refund_paid(e.tenant_id, (p ->> 'refund_id')::uuid, e.id)
    WHEN 'ProductReturned' THEN public.ledger_rule_product_returned(e.tenant_id, (p ->> 'refund_id')::uuid, e.id)
    WHEN 'StockConsumed' THEN public.ledger_rule_stock(e.tenant_id, 'material_consumption', (p ->> 'consumption_id')::uuid, 'consume', e.id)
    WHEN 'StockWasted' THEN coalesce(public.ledger_rule_stock(e.tenant_id, 'material_waste', (p ->> 'waste_id')::uuid, 'waste', e.id),
                                     public.ledger_rule_stock(e.tenant_id, 'material_return', (p ->> 'return_id')::uuid, 'waste', e.id))
    WHEN 'CommissionAccrued' THEN public.ledger_rule_commission(e.tenant_id, 'accrued', (p ->> 'entitlement_id')::uuid, e.id)
    WHEN 'CommissionAdjusted' THEN public.ledger_rule_commission(e.tenant_id, 'adjusted', (p ->> 'adjustment_id')::uuid, e.id)
    WHEN 'CommissionPaid' THEN public.ledger_rule_commission(e.tenant_id, 'paid', (p ->> 'batch_id')::uuid, e.id)
    WHEN 'StockTransferred' THEN public.ledger_rule_stock_transferred(e.tenant_id, (p ->> 'transfer_id')::uuid, p ->> 'state', e.id)
    WHEN 'GoodsReceived' THEN public.ledger_rule_goods_received(e.tenant_id, (p ->> 'receipt_id')::uuid, e.id)
    WHEN 'SupplierInvoiceRecorded' THEN public.ledger_rule_supplier_invoice(e.tenant_id, (p ->> 'invoice_id')::uuid, e.id)
    WHEN 'ExpenseRecorded' THEN public.ledger_rule_expense(e.tenant_id, (p ->> 'expense_id')::uuid, false, e.id)
    WHEN 'ExpenseReversed' THEN public.ledger_rule_expense(e.tenant_id, (p ->> 'expense_id')::uuid, true, e.id)
    WHEN 'SupplierPaymentAllocated' THEN public.ledger_rule_supplier_payment(e.tenant_id, (p ->> 'payment_id')::uuid, (p ->> 'invoice_id')::uuid, false, e.id)
    WHEN 'SupplierPaymentReversed' THEN public.ledger_rule_supplier_payment(e.tenant_id, (p ->> 'payment_id')::uuid, NULL, true, e.id)
    WHEN 'SupplierReturned' THEN public.ledger_rule_supplier_returned(e.tenant_id, (p ->> 'return_id')::uuid, e.id)
    WHEN 'SupplierCreditApplied' THEN public.ledger_rule_supplier_credit(e.tenant_id, (p ->> 'credit_note_id')::uuid, (p ->> 'invoice_id')::uuid, e.id)
    WHEN 'InvoiceVoided' THEN public.ledger_rule_reversal(e.tenant_id, 'InvoiceVoided', (p ->> 'invoice_id')::uuid, e.id)
    WHEN 'SupplierInvoiceReversed' THEN public.ledger_rule_reversal(e.tenant_id, 'SupplierInvoiceReversed', (p ->> 'invoice_id')::uuid, e.id)
    WHEN 'SupplierCreditReversed' THEN public.ledger_rule_reversal(e.tenant_id, 'SupplierCreditReversed', (p ->> 'credit_note_id')::uuid, e.id)
    WHEN 'InvoiceIssued' THEN public.ledger_wake_visit(e.tenant_id,
      (SELECT i.visit_id FROM public.invoices i WHERE i.tenant_id = e.tenant_id AND i.id = (p ->> 'invoice_id')::uuid))
    WHEN 'ApprovalDecided' THEN CASE WHEN p ->> 'approval_type' = 'manual_discount' AND p ->> 'subject_kind' = 'invoice_line' THEN
      public.ledger_wake_visit(e.tenant_id, (SELECT i.visit_id FROM public.invoice_lines l JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
                                              WHERE l.tenant_id = e.tenant_id AND l.id = (p ->> 'subject_id')::uuid)) END
    ELSE NULL END;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_post_event(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_post_event(uuid) TO clinic_app;--> statement-breakpoint

-- The consumer: the matrix events the rules handle (TD-50 names) plus the two wake-ups (InvoiceIssued, ApprovalDecided: no entry of their
-- own); the fan-out opens one receipt per event; consume() binds the tenant.
INSERT INTO public.event_consumers (name, event_types, max_attempts) VALUES ('ledger.posting', ARRAY[
  'PaymentAllocated','TreatmentFinished','SessionRedeemed','ConsultationFeeCharged','ProductHandedOver','BalanceToppedUp','BalanceMoved',
  'ReceivableCreated','ReceivableCollected','ReceivableWrittenOff','BookingDepositReceived','BookingDepositApplied','BookingDepositForfeited',
  'BookingDepositRefunded','RefundPaid','ProductReturned','StockConsumed','StockWasted','CommissionAccrued','CommissionAdjusted','CommissionPaid',
  'StockTransferred','GoodsReceived','SupplierInvoiceRecorded','ExpenseRecorded','ExpenseReversed','SupplierPaymentAllocated','SupplierPaymentReversed',
  'SupplierReturned','SupplierCreditApplied','InvoiceVoided','SupplierInvoiceReversed','SupplierCreditReversed','InvoiceIssued','ApprovalDecided'], 10);--> statement-breakpoint

REVOKE ALL ON FUNCTION public.ledger_tender(text), public.ledger_revenue(uuid, uuid, boolean),
  public.ledger_rule_payment_allocated(uuid, uuid, uuid), public.ledger_rule_treatment_finished(uuid, uuid, uuid),
  public.ledger_rule_treatment_line(uuid, uuid, uuid, uuid),
  public.ledger_rule_session_redeemed(uuid, uuid, uuid), public.ledger_rule_consultation_charged(uuid, uuid, uuid),
  public.ledger_rule_product_handed(uuid, uuid, uuid), public.ledger_rule_balance_topped_up(uuid, uuid, uuid),
  public.ledger_rule_receivable_created(uuid, uuid, uuid), public.ledger_rule_receivable_collected(uuid, uuid, uuid),
  public.ledger_rule_receivable_written_off(uuid, uuid, uuid), public.ledger_rule_deposit(uuid, uuid, text, uuid),
  public.ledger_rule_balance_moved(uuid, uuid, uuid), public.ledger_rule_refund_paid(uuid, uuid, uuid), public.ledger_rule_product_returned(uuid, uuid, uuid),
  public.ledger_rule_stock(uuid, text, uuid, text, uuid), public.ledger_rule_commission(uuid, text, uuid, uuid),
  public.ledger_rule_gateway_settlement(uuid, uuid, uuid, date, bigint, bigint, uuid) FROM PUBLIC;--> statement-breakpoint

-- ── T-105 manual journals, period lock, statements, journal export (PR-26; 07 :61; UX-22 ▸ Buku Besar; Panel 2 G2–G4, E1/E2) ──
-- The ledger actor: the actor lock first (staff_access), then the role.
CREATE FUNCTION public.ledger_actor(p_roles text[]) RETURNS record
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.tenant_actor_lock();
  IF NOT a.role = ANY (p_roles) THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: role may not use the ledger' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_actor(text[]) FROM PUBLIC;--> statement-breakpoint

-- Jurnal manual (finance): balanced lines on the tenant's accounts, a business date in an open period (a locked month is refused, not
-- moved: a manual journal names its month), a reason (10–500), idempotent on the key. A manual journal is never official either (G-ACT).
-- p: {date, memo, lines: [{account, branch_id?, debit, credit}]} (2–20 lines).
CREATE FUNCTION public.ledger_manual_post(p_key text, p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['finance']);
  v_date date;
  v_id uuid;
  x jsonb;
BEGIN
  IF p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - 'date' - 'memo' - 'lines' <> '{}'::jsonb
     OR jsonb_typeof(p -> 'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'lines') NOT BETWEEN 2 AND 20
     OR coalesce(p ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR length(btrim(coalesce(p ->> 'memo', ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: manual journal' USING ERRCODE = '22023';
  END IF;
  SELECT e.id INTO v_id FROM public.journal_entries e WHERE e.tenant_id = a.tenant_id AND e.posting_key = 'manual:' || p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id; -- replay
  END IF;
  BEGIN
    v_date := (p ->> 'date')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: date' USING ERRCODE = '22023';
  END;
  IF EXISTS (SELECT 1 FROM public.ledger_periods x WHERE x.tenant_id = a.tenant_id AND x.period = to_char(v_date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'ERR_PERIOD_LOCKED: %', to_char(v_date, 'YYYY-MM') USING ERRCODE = '55000';
  END IF;
  FOR x IN SELECT l FROM jsonb_array_elements(p -> 'lines') l LOOP
    IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR x - 'account' - 'branch_id' - 'debit' - 'credit' <> '{}'::jsonb
       OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts c WHERE c.tenant_id = a.tenant_id AND c.key = x ->> 'account')
       OR coalesce(x ->> 'debit', '0') !~ '^[0-9]{1,13}$' OR coalesce(x ->> 'credit', '0') !~ '^[0-9]{1,13}$'
       OR ((coalesce(x ->> 'debit', '0'))::bigint = 0) = ((coalesce(x ->> 'credit', '0'))::bigint = 0)
       OR x ? 'branch_id' AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id::text = x ->> 'branch_id') THEN
      RAISE EXCEPTION 'ERR_INVALID_INPUT: line' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT sum((coalesce(l ->> 'debit', '0'))::bigint) <> sum((coalesce(l ->> 'credit', '0'))::bigint) FROM jsonb_array_elements(p -> 'lines') l) THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: unbalanced' USING ERRCODE = '22023';
  END IF;
  v_id := public.ledger_post(a.tenant_id, 'manual', 'manual:' || p_key, 'ManualJournalPosted', 'manual_journal', public.uuid_generate_v7(), NULL, v_date,
    (SELECT jsonb_agg(public.jl(l ->> 'account', NULLIF(l ->> 'branch_id', '')::uuid, (coalesce(l ->> 'debit', '0'))::bigint, (coalesce(l ->> 'credit', '0'))::bigint))
       FROM jsonb_array_elements(p -> 'lines') l), btrim(p ->> 'memo'), a.staff_id, NULL);
  PERFORM public.audit_append('money_correction', 'journal_entry', v_id, 'success', 'manual_journal_posted');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_manual_post(text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_manual_post(text, jsonb) TO clinic_app;--> statement-breakpoint

-- Kunci Periode (finance): a past month only (not the current or a future one), once; idempotent on the key; audited.
CREATE FUNCTION public.ledger_period_lock(p_key text, p_period text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['finance']);
  v_id uuid;
BEGIN
  IF p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' OR coalesce(p_period, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO v_id FROM public.ledger_periods x WHERE x.tenant_id = a.tenant_id AND x.command_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF p_period >= to_char(public.tax_local_date(a.tenant_id, clock_timestamp(), NULL), 'YYYY-MM') THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: period_open' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_periods x WHERE x.tenant_id = a.tenant_id AND x.period = p_period) THEN
    RAISE EXCEPTION 'ERR_VERSION_CONFLICT: period_locked' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ledger_periods (tenant_id, period, locked_by, command_key) VALUES (a.tenant_id, p_period, a.staff_id, p_key) RETURNING id INTO v_id;
  PERFORM public.audit_append('settings_change', 'ledger_period', v_id, 'success', 'period_locked');
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_period_lock(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_period_lock(text, text) TO clinic_app;--> statement-breakpoint

-- The books' status (G4 / E1–E2): never official in T-105. 'preview' always (no activation writer exists); the reasons say why.
CREATE FUNCTION public.ledger_status_json(p_tenant uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('state', CASE WHEN EXISTS (SELECT 1 FROM public.ledger_activations x WHERE x.tenant_id = p_tenant AND x.map_version = public.ledger_map_version())
                                          THEN 'active' ELSE 'preview' END,
    'map_version', public.ledger_map_version(),
    'map_signed', public.feature_gate_open('journal_export'),
    'activated', EXISTS (SELECT 1 FROM public.ledger_activations x WHERE x.tenant_id = p_tenant AND x.map_version = public.ledger_map_version()),
    'locked_periods', coalesce((SELECT jsonb_agg(x.period ORDER BY x.period) FROM public.ledger_periods x WHERE x.tenant_id = p_tenant), '[]'::jsonb))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_status_json(uuid) FROM PUBLIC;--> statement-breakpoint

-- Laporan (owner, finance, auditor): trial balance by account, P&L by account (per branch or consolidated), balance sheet (assets, liabilities,
-- equity incl. the period's net income) per branch through inter-branch clearing or consolidated, cash-flow summary (cash / bank / petty cash /
-- gateway movements by the counter-account class of their entries). Generic by class, NOT SAK-labelled (G2); always the preview status (G4).
-- The booked date of an entry (r9, review 94a7a512 #2): its business date when it posted in its own month; otherwise (a late fact moved past
-- a locked month, PR-26) the first day of the period it was booked in. Readers place an entry by its booked date; business_date and
-- original_period stay as provenance. So a locked month's statements never change and the late entry is activity of its booked period.
CREATE FUNCTION public.ledger_booked_date(p_business date, p_period text, p_original text) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_period = p_original THEN p_business ELSE to_date(p_period || '-01', 'YYYY-MM-DD') END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_booked_date(date, text, text) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.ledger_report(p_from date, p_to date, p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['owner','finance','auditor']);
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch' USING ERRCODE = 'P0002';
  END IF;
  RETURN (
    WITH ln AS (
      SELECT l.*, c.key, c.label, c.class, public.ledger_booked_date(e.business_date, e.period, e.original_period) d
        FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id = l.tenant_id AND e.id = l.entry_id
        JOIN public.ledger_accounts c ON c.tenant_id = l.tenant_id AND c.id = l.account_id
       WHERE l.tenant_id = a.tenant_id AND public.ledger_booked_date(e.business_date, e.period, e.original_period) <= p_to
         AND (p_branch IS NULL OR l.branch_id = p_branch)),
    tb AS (
      SELECT key, label, class,
             sum(CASE WHEN d < p_from THEN debit - credit ELSE 0 END)::bigint opening,
             sum(CASE WHEN d >= p_from THEN debit ELSE 0 END)::bigint debit,
             sum(CASE WHEN d >= p_from THEN credit ELSE 0 END)::bigint credit,
             sum(debit - credit)::bigint closing
        FROM ln GROUP BY key, label, class),
    -- Cash flow by counter class (r9, review 94a7a512 #1): value-preserving, per entry. The entry's net cash movement (cash, petty cash, bank,
    -- clearing lines in scope) is attributed to the classes of its non-cash lines on the opposite side (credit side for an inflow, debit side
    -- for an outflow): one class gets all; mixed classes share it exactly by their opposite-side amounts, integer, largest remainder (ties by
    -- class name). So the class amounts sum to the net cash movement. A cash-to-cash transfer (no non-cash line) attributes nothing.
    cash_e AS (
      SELECT x.entry_id, sum(x.debit - x.credit)::bigint net FROM ln x
       WHERE x.d >= p_from AND x.key IN ('cash_shift','petty_cash','bank','gateway_clearing') GROUP BY x.entry_id HAVING sum(x.debit - x.credit) <> 0),
    cnt AS (
      SELECT ce.entry_id, ce.net, c2.class, sum(CASE WHEN ce.net > 0 THEN l2.credit ELSE l2.debit END)::bigint w
        FROM cash_e ce JOIN public.journal_lines l2 ON l2.tenant_id = a.tenant_id AND l2.entry_id = ce.entry_id
        JOIN public.ledger_accounts c2 ON c2.tenant_id = l2.tenant_id AND c2.id = l2.account_id
       WHERE c2.key NOT IN ('cash_shift','petty_cash','bank','gateway_clearing')
       GROUP BY ce.entry_id, ce.net, c2.class HAVING sum(CASE WHEN ce.net > 0 THEN l2.credit ELSE l2.debit END) > 0),
    -- Exact integer arithmetic (r10, review dbe45699): a line may be up to Rp1,000,000,000,000, so |net| × weight can exceed bigint — the
    -- product is numeric and split with integer div / mod (no floating point, no fractional division); only the bounded results (a share
    -- ≤ |net|, a remainder < the total weight) are cast back to bigint.
    shares AS (
      SELECT entry_id, net, class, w, sum(w::numeric) OVER (PARTITION BY entry_id) tw FROM cnt),
    parts AS (
      SELECT entry_id, net, class, div(abs(net)::numeric * w::numeric, tw)::bigint base, mod(abs(net)::numeric * w::numeric, tw) rem FROM shares),
    ranked AS (
      SELECT p.*, row_number() OVER (PARTITION BY entry_id ORDER BY rem DESC, class) rk,
             abs(net) - (sum(base::numeric) OVER (PARTITION BY entry_id))::bigint left_over
        FROM parts p),
    cash AS (
      SELECT class, sum(sign(net) * (base + CASE WHEN rk <= left_over THEN 1 ELSE 0 END))::bigint amount FROM ranked GROUP BY class)
    SELECT jsonb_build_object(
      'status', public.ledger_status_json(a.tenant_id), 'from', p_from, 'to', p_to, 'branch_id', p_branch,
      'trial_balance', coalesce((SELECT jsonb_agg(jsonb_build_object('key', key, 'label', label, 'class', class, 'opening', opening, 'debit', debit, 'credit', credit,
                                                                     'closing', closing) ORDER BY class, key) FROM tb), '[]'::jsonb),
      'income', coalesce((SELECT jsonb_agg(jsonb_build_object('key', key, 'label', label, 'class', class, 'amount', CASE WHEN class = 'revenue' THEN credit - debit ELSE debit - credit END)
                                           ORDER BY class DESC, key) FROM tb WHERE class IN ('revenue','expense') AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
      'net_income', coalesce((SELECT sum(CASE WHEN class = 'revenue' THEN credit - debit ELSE debit - credit END * CASE WHEN class = 'revenue' THEN 1 ELSE -1 END)
                                FROM tb WHERE class IN ('revenue','expense')), 0),
      'balance_sheet', coalesce((SELECT jsonb_agg(jsonb_build_object('key', key, 'label', label, 'class', class,
                                                                     'amount', CASE WHEN class = 'asset' THEN closing ELSE -closing END) ORDER BY class, key)
                                   FROM tb WHERE class IN ('asset','liability','equity') AND closing <> 0), '[]'::jsonb),
      'retained', coalesce((SELECT -sum(closing) FROM tb WHERE class IN ('revenue','expense')), 0),
      'cash_flow', coalesce((SELECT jsonb_object_agg(class, amount) FROM cash), '{}'::jsonb),
      'balanced', coalesce((SELECT sum(closing) = 0 FROM tb), true)));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_report(date, date, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_report(date, date, uuid) TO clinic_app;--> statement-breakpoint

-- Jurnal (reader): the entries of a period (newest first, 200 per page) with their lines and status; branch filter by line.
CREATE FUNCTION public.ledger_journal(p_from date, p_to date, p_branch uuid, p_before timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['owner','finance','auditor']);
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('status', public.ledger_status_json(a.tenant_id), 'entries', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'event', e.event, 'business_date', e.business_date, 'period', e.period,
                                        'original_period', e.original_period, 'map_version', e.map_version, 'memo', e.memo, 'posted_at', e.posted_at,
                                        'reverses_entry_id', e.reverses_entry_id,
                                        'lines', (SELECT jsonb_agg(jsonb_build_object('account', c.key, 'label', c.label, 'branch_id', l.branch_id, 'debit', l.debit, 'credit', l.credit) ORDER BY l.id)
                                                    FROM public.journal_lines l JOIN public.ledger_accounts c ON c.tenant_id = l.tenant_id AND c.id = l.account_id
                                                   WHERE l.tenant_id = e.tenant_id AND l.entry_id = e.id)) ORDER BY e.posted_at DESC, e.id DESC)
      FROM (SELECT x.* FROM public.journal_entries x WHERE x.tenant_id = a.tenant_id
              AND public.ledger_booked_date(x.business_date, x.period, x.original_period) BETWEEN p_from AND p_to
              AND (p_before IS NULL OR x.posted_at < p_before)
              AND (p_branch IS NULL OR EXISTS (SELECT 1 FROM public.journal_lines l WHERE l.tenant_id = x.tenant_id AND l.entry_id = x.id AND l.branch_id = p_branch))
            ORDER BY x.posted_at DESC, x.id DESC LIMIT 200) e), '[]'::jsonb),
    'accounts', (SELECT jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'class', c.class) ORDER BY c.class, c.key) FROM public.ledger_accounts c WHERE c.tenant_id = a.tenant_id));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_journal(date, date, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_journal(date, date, uuid, timestamptz) TO clinic_app;--> statement-breakpoint

-- Ekspor jurnal (finance): refused unless the posting map version is signed (feature gate journal_export, locked first) AND the books are
-- activated for that version (no activation writer exists in T-105 — open gate G-ACT): fail-closed, with the reason. Audited either way.
CREATE FUNCTION public.ledger_journal_export(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record := public.ledger_actor(ARRAY['finance']);
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'ERR_INVALID_INPUT: period' USING ERRCODE = '22023';
  END IF;
  -- a refusal RETURNS its reason (no raise) so the denied audit row commits with it
  PERFORM public.feature_gate_lock('journal_export');
  IF NOT public.feature_gate_open('journal_export') THEN
    PERFORM public.audit_append('export', 'journal', NULL, 'denied', 'posting_map_unsigned');
    RETURN jsonb_build_object('refused', 'posting_map_unsigned');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_activations x WHERE x.tenant_id = a.tenant_id AND x.map_version = public.ledger_map_version()) THEN
    PERFORM public.audit_append('export', 'journal', NULL, 'denied', 'ledger_not_activated');
    RETURN jsonb_build_object('refused', 'ledger_not_activated');
  END IF;
  PERFORM public.audit_append('export', 'journal', NULL, 'success', 'journal_exported');
  RETURN jsonb_build_object('rows', coalesce((SELECT jsonb_agg(jsonb_build_object('date', e.business_date, 'branch', b.code, 'account', c.key, 'debit', l.debit, 'credit', l.credit, 'reference', e.posting_key)
                                    ORDER BY e.business_date, e.id, l.id)
                     FROM public.journal_entries e JOIN public.journal_lines l ON l.tenant_id = e.tenant_id AND l.entry_id = e.id
                     JOIN public.ledger_accounts c ON c.tenant_id = l.tenant_id AND c.id = l.account_id
                     LEFT JOIN public.branches b ON b.tenant_id = l.tenant_id AND b.id = l.branch_id
                    WHERE e.tenant_id = a.tenant_id AND e.business_date BETWEEN p_from AND p_to AND e.map_version IS NOT DISTINCT FROM public.ledger_map_version()
                      OR e.tenant_id = a.tenant_id AND e.business_date BETWEEN p_from AND p_to AND e.kind <> 'auto'), '[]'::jsonb));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ledger_journal_export(date, date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ledger_journal_export(date, date) TO clinic_app;
