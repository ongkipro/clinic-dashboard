// T-003 Done-when: startup refuses a BYPASSRLS role; a table missing from scope_map or
// classified twice fails; a cross-tenant read of a fixture row returns not-found.
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_GROUP_ROLE,
  AUTH_GROUP_ROLE,
  assertAppRole,
  type TenantContext,
  UnsafeDatabaseRoleError,
  withTenantContext,
} from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { scopeMapViolations } from "../../src/db/scope-map";
import { createHarness, type Harness } from "./harness";

let h: Harness;
let app: pg.Pool;
let tenantA: string;
let tenantB: string;
let branchA: string;
let branchB: string;

async function newTenant(name: string): Promise<{ tenant: string; branch: string }> {
  const t = (await h.admin.query(`insert into tenants_registry default values returning id`))
    .rows[0].id as string;
  await h.admin.query(
    `insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`,
    [t, name],
  );
  const b = (
    await h.admin.query(
      `insert into branches (tenant_id, code, name, timezone)
       values ($1, 'CAB01', 'Cabang Sintetis', 'Asia/Jakarta') returning id`,
      [t],
    )
  ).rows[0].id as string;
  return { tenant: t, branch: b };
}

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  allowedBranchIds: "*",
  roles: ["owner"],
});

beforeAll(async () => {
  h = await createHarness();
  ({ tenant: tenantA, branch: branchA } = await newTenant("PT Sintetis A"));
  ({ tenant: tenantB, branch: branchB } = await newTenant("PT Sintetis B"));
  app = await openAppPool({
    connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])),
    max: 4,
  });
});

afterAll(async () => {
  await app?.end();
  await h?.close();
});

describe("startup role check (TEN-2)", () => {
  async function check(attrs: string, memberOf: string[]): Promise<unknown> {
    const c = await h.connectAs(await h.createLoginRole(attrs, memberOf));
    return assertAppRole(c).then(
      () => "accepted",
      (e: unknown) => e,
    );
  }

  it("application startup refuses a BYPASSRLS role and opens for a safe one", async () => {
    const unsafe = await h.createLoginRole("BYPASSRLS", [APP_GROUP_ROLE]);
    await expect(openAppPool({ connectionString: h.urlAs(unsafe) })).rejects.toBeInstanceOf(
      UnsafeDatabaseRoleError,
    );
    const safe = await h.createLoginRole("", [APP_GROUP_ROLE]);
    const pool = await openAppPool({ connectionString: h.urlAs(safe) });
    await pool.end();
  });

  it("the auth pool applies the same rules to clinic_auth, and the two groups are not interchangeable", async () => {
    const authLogin = await h.createLoginRole("", [AUTH_GROUP_ROLE]);
    await (await openAppPool({ connectionString: h.urlAs(authLogin) }, AUTH_GROUP_ROLE)).end();
    await expect(openAppPool({ connectionString: h.urlAs(authLogin) })).rejects.toThrow(
      `not a member of ${APP_GROUP_ROLE}`,
    );
    const both = await h.createLoginRole("", [AUTH_GROUP_ROLE, APP_GROUP_ROLE]);
    await expect(openAppPool({ connectionString: h.urlAs(both) }, AUTH_GROUP_ROLE)).rejects.toThrow(
      "member of unexpected role clinic_app",
    );
    const unsafe = await h.createLoginRole("BYPASSRLS", [AUTH_GROUP_ROLE]);
    await expect(openAppPool({ connectionString: h.urlAs(unsafe) }, AUTH_GROUP_ROLE)).rejects.toThrow(
      "bypassrls",
    );
  });

  it("accepts a plain member of clinic_app", async () => {
    expect(await check("", [APP_GROUP_ROLE])).toBe("accepted");
  });

  it("refuses a BYPASSRLS role", async () => {
    expect(String(await check("BYPASSRLS", [APP_GROUP_ROLE]))).toContain("bypassrls");
  });

  it("refuses a role that inherits BYPASSRLS through membership", async () => {
    const group = await h.createGroupRole("BYPASSRLS");
    expect(String(await check("", [APP_GROUP_ROLE, group]))).toContain("bypassrls");
  });

  it("refuses a superuser", async () => {
    expect(String(await assertAppRole(h.admin).catch((e) => e))).toContain("superuser");
  });

  it("checks the login, not the current role: a superuser that SET ROLE clinic_app is refused", async () => {
    await h.admin.query(`set role ${APP_GROUP_ROLE}`);
    try {
      expect(String(await assertAppRole(h.admin).catch((e) => e))).toContain("superuser");
    } finally {
      await h.admin.query(`reset role`);
    }
  });

  it("refuses membership in any role other than clinic_app (allow-list)", async () => {
    expect(String(await check("", [APP_GROUP_ROLE, "pg_read_all_data"]))).toContain(
      "member of unexpected role pg_read_all_data",
    );
  });

  it("refuses a REPLICATION login", async () => {
    expect(String(await check("REPLICATION", [APP_GROUP_ROLE]))).toContain("replication");
  });

  it("refuses direct table or column grants to the login", async () => {
    const direct = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`grant select on tenants_registry to ${direct}`);
    const c = await h.connectAs(direct);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("has direct privileges");
    await h.admin.query(`revoke select on tenants_registry from ${direct}`);
    await h.admin.query(`grant select (lifecycle_state) on tenants_registry to ${direct}`);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("has direct privileges");
    await h.admin.query(`revoke select (lifecycle_state) on tenants_registry from ${direct}`);
    await h.admin.query(
      `create function definer_direct() returns int language sql security definer as 'select 1'`,
    );
    await h.admin.query(`grant execute on function definer_direct() to ${direct}`);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("has direct privileges");
    await h.admin.query(`drop function definer_direct()`);
    await h.admin.query(`grant usage on schema public to ${direct}`);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("has direct privileges");
    await h.admin.query(`revoke usage on schema public from ${direct}`);
    expect(await assertAppRole(c)).toBeUndefined();
  });

  it("refuses a session default for app.* settings (policies must fail closed)", async () => {
    const preset = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`alter role ${preset} set app.tenant_id = '${tenantA}'`);
    const c = await h.connectAs(preset);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("app.* has a session default");
    const viaOptions = await h.createLoginRole("", [APP_GROUP_ROLE]);
    for (const option of [`-c app.tenant_id=${tenantA}`, "-c app.roles=owner", "-c app.allowed_branch_ids=*"]) {
      await expect(
        openAppPool({ connectionString: h.urlAs(viaOptions), options: option }),
      ).rejects.toThrow("app.* has a session default");
    }
  });

  it("refuses CREATEROLE and CREATEDB logins", async () => {
    expect(String(await check("CREATEROLE", [APP_GROUP_ROLE]))).toContain("createrole/createdb");
    expect(String(await check("CREATEDB", [APP_GROUP_ROLE]))).toContain("createrole/createdb");
  });

  it("refuses a member of a role that owns tables (owners skip RLS)", async () => {
    const owner = await h.createGroupRole("");
    await h.admin.query(`create table owned_probe (id int)`);
    await h.admin.query(`alter table owned_probe owner to ${owner}`);
    try {
      expect(String(await check("", [APP_GROUP_ROLE, owner]))).toContain("owns relations");
    } finally {
      await h.admin.query(`drop table owned_probe`);
    }
  });

  it("refuses the database owner and a schema owner", async () => {
    const dbOwner = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`alter database ${h.dbName} owner to ${dbOwner}`);
    try {
      const c = await h.connectAs(dbOwner);
      expect(String(await assertAppRole(c).catch((e) => e))).toContain("owns the database");
    } finally {
      await h.admin.query(`alter database ${h.dbName} owner to current_user`);
    }
    const schemaOwner = await h.createGroupRole("");
    await h.admin.query(`create schema probe authorization ${schemaOwner}`);
    try {
      expect(String(await check("", [APP_GROUP_ROLE, schemaOwner]))).toContain("owns a schema");
    } finally {
      await h.admin.query(`drop schema probe`);
    }
  });

  it("refuses a login that can create objects", async () => {
    const creator = await h.createGroupRole("");
    await h.admin.query(`grant create on schema public to ${creator}`);
    try {
      expect(String(await check("", [APP_GROUP_ROLE, creator]))).toContain("can create objects");
    } finally {
      await h.admin.query(`revoke create on schema public from ${creator}`);
    }
  });

  it("refuses a login granted TEMPORARY on the database (temp tables shadow names)", async () => {
    const temp = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`grant temporary on database ${h.dbName} to ${temp}`);
    const c = await h.connectAs(temp);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("can create objects");
  });

  it("refuses TEMPORARY granted to PUBLIC (the migration revokes it; drift must not pass)", async () => {
    const plain = await h.createLoginRole("", [APP_GROUP_ROLE]);
    const c = await h.connectAs(plain);
    expect(await assertAppRole(c)).toBeUndefined();
    await h.admin.query(`grant temporary on database ${h.dbName} to public`);
    try {
      expect(String(await assertAppRole(c).catch((e) => e))).toContain("can create objects");
    } finally {
      await h.admin.query(`revoke temporary on database ${h.dbName} from public`);
    }
  });

  it("refuses a NOINHERIT member (it would not receive clinic_app grants)", async () => {
    expect(String(await check("NOINHERIT", [APP_GROUP_ROLE]))).toContain(
      `not a member of ${APP_GROUP_ROLE}`,
    );
  });

  it("refuses a role that is not a member of clinic_app", async () => {
    expect(String(await check("", []))).toContain(`not a member of ${APP_GROUP_ROLE}`);
  });

  it("a login without an explicit CONNECT grant cannot reach the database", async () => {
    const outsider = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`revoke connect on database ${h.dbName} from ${outsider}`);
    await expect(h.connectAs(outsider)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("scope map (TEN-3, TEN-19)", () => {
  // Every relation kind that can expose rows: table, partitioned table, view,
  // materialized view, foreign table.
  async function relations(c: pg.ClientBase): Promise<string[]> {
    const { rows } = await c.query<{ t: string }>(
      `select n.nspname || '.' || c.relname as t from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r','p','v','m','f')
         and n.nspname not in ('pg_catalog','information_schema','drizzle')
         and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'`,
    );
    return rows.map((r) => r.t);
  }
  async function entries(c: pg.ClientBase) {
    const { rows } = await c.query<{ tableName: string; policyKind: string }>(
      `select table_name as "tableName", policy_kind as "policyKind" from scope_map`,
    );
    return rows;
  }
  async function inRolledBack<T>(ddl: string, fn: () => Promise<T>): Promise<T> {
    await h.admin.query("begin");
    try {
      await h.admin.query(ddl);
      return await fn();
    } finally {
      await h.admin.query("rollback");
    }
  }

  it("classifies every relation exactly once", async () => {
    expect(scopeMapViolations(await relations(h.admin), await entries(h.admin))).toEqual([]);
  });

  it("fails on a table missing from scope_map", async () => {
    // A table no migration owns (invoices arrived with T-071, so the probe uses its own name).
    const v = await inRolledBack(`create table fixture_invoices (id uuid primary key)`, async () =>
      scopeMapViolations(await relations(h.admin), await entries(h.admin)),
    );
    expect(v).toEqual(["public.fixture_invoices: missing from scope_map"]);
  });

  it("fails on a view or materialized view missing from scope_map", async () => {
    const v = await inRolledBack(
      `create view branch_names as select name from branches;
       create materialized view branch_count as select count(*) from branches`,
      async () => scopeMapViolations(await relations(h.admin), await entries(h.admin)),
    );
    expect(v).toEqual([
      "public.branch_count: missing from scope_map",
      "public.branch_names: missing from scope_map",
    ]);
  });

  it("fails on a table classified twice", () => {
    expect(
      scopeMapViolations(
        ["public.branches"],
        [
          { tableName: "public.branches", policyKind: "tenant-shared" },
          { tableName: "public.branches", policyKind: "branch-scoped" },
        ],
      ),
    ).toEqual(["public.branches: classified 2 times"]);
  });

  it("fails on a stale row and an unknown policy kind", () => {
    expect(scopeMapViolations([], [{ tableName: "public.ghosts", policyKind: "public" }])).toEqual(
      [
        "public.ghosts: scope_map row for a table that does not exist",
        "public.ghosts: unknown policy kind public",
      ],
    );
  });

  it("has RLS enabled on every table", async () => {
    const { rows } = await h.admin.query<{ t: string }>(
      `select n.nspname || '.' || c.relname as t from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r','p') and not c.relrowsecurity
         and n.nspname not in ('pg_catalog','information_schema','drizzle')
         and n.nspname not like 'pg_toast%'`,
    );
    expect(rows).toEqual([]);
  });

  // Views run with the owner's rights unless security_invoker is set, and materialized
  // and foreign tables have no RLS; none may be readable by the app without it.
  it("the app cannot read a view without security_invoker, a matview or a foreign table", async () => {
    const { rows } = await h.admin.query<{ t: string }>(
      `select n.nspname || '.' || c.relname as t from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('v','m','f')
         and n.nspname not in ('pg_catalog','information_schema')
         and (has_table_privilege($1, c.oid, 'SELECT')
              or has_any_column_privilege($1, c.oid, 'SELECT'))
         and not (c.relkind = 'v' and coalesce(c.reloptions, '{}') @> '{security_invoker=true}')`,
      [APP_GROUP_ROLE],
    );
    expect(rows).toEqual([]);
  });

  it("the app has no privilege on platform tables", async () => {
    const { rows } = await h.admin.query<{ t: string }>(
      `select s.table_name as t from scope_map s
       join pg_class c on c.oid = to_regclass(s.table_name)
       where s.policy_kind = 'platform'
         and (has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              or has_any_column_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))`,
      [APP_GROUP_ROLE],
    );
    expect(rows).toEqual([]);
  });
});

describe("functions (TEN-16)", () => {
  // Security-definer functions run as their owner and skip RLS; the app may execute
  // only those on this allow-list; each entry has its own tests (tests/org).
  const ALLOWED_DEFINER_FUNCTIONS: string[] = [
    "account_memberships(uuid)",
    "approval_cancel(uuid)",
    "approval_decide(uuid,boolean,text)",
    "approval_is_tenant_setting_draft(uuid,uuid)",
    "approval_owner_decides_fh(uuid)",
    "approval_ph_available(uuid)", // T-034: the inbox offers a materials review only where approval_decide accepts it
    "approval_owner_self(text,text,uuid,text,uuid,bigint)",
    "approval_request(text,text,uuid,text,uuid,bigint)",
    "audit_append(text,text,uuid,text,text,text,uuid)",
    "branch_closure_add(uuid,date,time without time zone,time without time zone,text)", // T-036 branch master (PR-2)
    "branch_closure_remove(uuid)",
    "branch_create(text,text,text)",
    "branch_is_open(uuid,timestamp with time zone,timestamp with time zone)",
    "branch_price_cancel(uuid)", // T-035: Owner-only branch price writers and reader (PR-42)
    "branch_price_set(uuid,uuid,bigint,timestamp with time zone,text)",
    "feature_flag_on(text)", // T-129 + HYG-024 (ADR-7): tenant-scoped read-only feature flag check
    "catalog_branch_price(uuid,uuid,timestamp with time zone)",
    "branch_set_hours(uuid,jsonb)",
    "branch_set_services(uuid,uuid[])",
    "branch_update_profile(uuid,jsonb)",
    "catalog_commercial()",
    "device_set_active(uuid,boolean)",
    "device_upsert(uuid,uuid,text,text)",
    "consent_active(uuid,text)", // T-038: consent ledger, marketing contacts (PR-4, TEN-18, DEC-052)
    "consent_grant(uuid,text,uuid,text)",
    "consent_text_publish(text,text,timestamp with time zone)",
    "consent_withdraw(uuid,text,text)",
    "marketing_contacts()",
    "patient_consents(uuid)",
    "appointment_cancel(uuid,text)", // T-045: appointment states and the calendar (PR-83, DEC-055)
    "appointment_confirm(uuid)",
    "appointment_no_show(uuid)",
    "appointment_reschedule(uuid,timestamp with time zone,uuid)",
    "appointments_window(uuid,date,date)",
    "patient_merge(uuid,uuid,text)", // T-042: duplicate merge (PR-85, DEC-061)
    "patient_unmerge(uuid,text)",
    "intake_open(uuid)", // T-051: BC Pendampingan intake (PR-9, CLIN-001–003)
    "intake_save(uuid,jsonb)",
    "intake_send(uuid)",
    "pendampingan_visits(uuid)",
    "pendampingan_visit(uuid)",
    "patient_cautions(uuid)",
    "exam_open(uuid)", // T-052: Lembar Pemeriksaan (PR-10, CLIN-004, CLIN-012)
    "exam_save(uuid,jsonb)",
    "intake_verify(uuid,uuid,text,text)",
    "mark_set(uuid,jsonb)",
    "mark_remove(uuid,uuid)",
    "plan_create(uuid,text,text)",
    "plan_item_add(uuid,uuid,jsonb)",
    "plan_item_remove(uuid,uuid)",
    "plan_close(uuid,uuid,text)",
    "pemeriksaan_visits(uuid)",
    "exam_sheet(uuid)",
    "plan_options(uuid)",
    "record_sign(uuid)", // T-053: signing, corrections, patient copy, retention (PR-13, PR-49)
    "record_correct(uuid,jsonb,text)",
    "record_get(uuid)",
    "record_copy_request(uuid,text)",
    "record_copy_data(uuid)",
    "retention_until(uuid)",
    "media_blob_put(text,text,bytea)", // T-055: private clinical media and tokens (PR-32)
    "media_blob_get(text)",
    "media_add(uuid,jsonb)",
    "media_remove(uuid,text)",
    "media_token_issue(uuid,text,text,integer)",
    "media_token_redeem(text)",
    "media_list(uuid,uuid)",
    "media_compare(uuid,uuid)",
    "procedure_consent_text(uuid,uuid)", // T-054: procedure consent and the treatment start gate (PR-11)
    "procedure_consent_capture(uuid,uuid,jsonb,bytea)",
    "procedure_consent_withdraw(uuid,text)",
    "contraindication_review(uuid,uuid,text,text)",
    "treatment_start_check(uuid,uuid[],uuid,uuid)",
    "consent_visits(uuid)",
    "consent_visit(uuid)",
    "consent_signature(uuid)",
    "complaint_readable(uuid,uuid,text)", // T-057: Keluhan Klinis and Layanan (PR-43)
    "complaint_flag(uuid,jsonb)",
    "complaint_take(uuid)",
    "complaint_triage(uuid,text)",
    "complaint_note(uuid,text)",
    "complaint_resolve(uuid,text,text)",
    "complaint_reopen(uuid,text)",
    "complaint_list(uuid,text)",
    "complaint_get(uuid)",
    "complaint_flag_options(uuid)",
    "template_readable(uuid,text)", // T-058: document templates and signed medical letters (PR-74)
    "template_save(uuid,jsonb)",
    "template_retire(uuid)",
    "template_list(text)",
    "template_get(uuid)",
    "letter_create(uuid,uuid)",
    "letter_save(uuid,text)",
    "letter_sign(uuid)",
    "letter_correct(uuid,text,text)",
    "letter_list(uuid,uuid)",
    "letter_get(uuid)",
    "letter_options(uuid)",
    "request_readable(uuid,uuid)", // T-056: Permintaan Klinis (PR-45)
    "clinical_request_create(uuid,jsonb)",
    "clinical_request_decide(uuid,boolean,text)",
    "clinical_request_cancel(uuid)",
    "clinical_request_list(text)",
    "clinical_request_get(uuid)",
    // T-060 (PR-17): stock definers; each takes the actor lock and checks role and branch.
    "stock_context()",
    "stock_item_list(uuid)",
    "stock_item_get(uuid,uuid)",
    "stock_card(uuid,uuid,integer)",
    "stock_batch_watch(uuid)",
    "stock_count_list(uuid)",
    "stock_count_get(uuid)",
    "stock_item_options()",
    "stock_item_save(uuid,jsonb)",
    "stock_receive(uuid,jsonb)",
    "stock_batch_hold(uuid,text,text)",
    "stock_vial_open(uuid)",
    "stock_level_set(uuid,uuid,numeric,numeric)",
    "stock_count_start(boolean,uuid[])",
    "stock_count_record(uuid,uuid,numeric)",
    "stock_count_submit(uuid,text)",
    "stock_count_cancel(uuid)",
    // T-061 (PR-89): depot and transfer definers.
    "depot_save(uuid,jsonb)",
    "depot_transfer(text,jsonb)",
    "branch_transfer_send(text,jsonb)",
    "branch_transfer_receive(uuid,uuid)",
    "branch_transfer_cancel(uuid)",
    "stock_vial_open_in(uuid,uuid)",
    "stock_count_start_in(boolean,uuid[],uuid)",
    "depot_list(uuid)",
    "depot_get(uuid)",
    "transfer_list(uuid,text)",
    "transfer_get(uuid)",
    // T-062 (PR-16, CLIN-008): material lifecycle definers.
    "stock_item_class_set(uuid,text)",
    "material_request_create(text,jsonb)",
    "material_request_cancel(uuid)",
    "material_issue(text,uuid,jsonb)",
    "material_consume(text,uuid,jsonb)",
    "material_return_propose(text,uuid,jsonb)",
    "material_return_decide(uuid,text,uuid)",
    "material_waste(text,uuid,jsonb)",
    "material_request_get(uuid)",
    "material_requests_for_visit(uuid)",
    "material_issue_queue()",
    // T-063 (PR-46): costed receipt and inventory value readers.
    "stock_receive_costed(uuid,jsonb)",
    "stock_cost_list(uuid)",
    "stock_movement_value_list(uuid,uuid,integer)",
    // T-064 (PR-14): treatment room definers.
    "treatment_start(text,uuid,jsonb)",
    "treatment_timer(text,uuid,text,text)",
    "treatment_finish(text,uuid,jsonb)",
    "treatment_room_list()",
    "treatment_get(uuid)",
    // T-065 (PR-18): Siapkan & Serahkan definers and the batch-hold writer re-created.
    "selection_confirm(text,uuid,jsonb)",
    "recipe_map_set(uuid,integer,jsonb)",
    "special_item_add(uuid,text)",
    "selection_prepare_materials(text,uuid,uuid)",
    "prescription_create(text,uuid,jsonb)",
    "prescription_item_add(text,uuid,jsonb)",
    "prescription_item_remove(uuid,uuid)",
    "prescription_sign(uuid)",
    "dispense_prepare(text,uuid,uuid)",
    "dispense_hand_over(text,uuid,jsonb)",
    "dispense_cancel(uuid,text)",
    "label_print(uuid)",
    "pharmacy_prep_list()",
    "pharmacy_handover_list()",
    "pharmacy_dispensing_get(uuid)",
    "prescription_get(uuid)",
    "pharmacy_recall_trace(uuid)",
    // T-066 (PR-75): suppliers and supplier returns.
    "supplier_save(uuid,jsonb)",
    "supplier_receive(text,uuid,jsonb)",
    "supplier_return_record(text,uuid,jsonb)",
    "supplier_list()",
    "supplier_get(uuid)",
    "supplier_return_list(uuid)",
    "supplier_batches(uuid,uuid)",
    // T-076 (PR-20): the package writers, readers and the unbound expiry scan.
    "package_reserve(text,uuid,uuid,jsonb)",
    "package_release(uuid)",
    "package_cancel(uuid,text)",
    "package_expiry_scan(date)",
    "interrupted_to_balance(text,uuid)",
    "package_substitution_request(text,uuid,jsonb)",
    "package_substitution_decide(uuid,boolean,text)",
    "balance_top_up(text,uuid,uuid,jsonb)",
    "package_contents_set(uuid,jsonb)",
    "package_patient_get(uuid)",
    "package_patient_search(text)",
    "package_contents_get(uuid)",
    // T-077 (PR-22): the booking deposit writers (each takes the actor lock first).
    "deposit_receive(text,uuid,jsonb)",
    "deposit_apply(uuid)",
    "appointment_cancel_clinic(uuid,text)",
    "deposit_refund_clinic(text,uuid,jsonb)",
    // T-080 (PR-72): the inbox helper (whether a manager may decide a manual discount; a reader without the actor lock, as
    // approval_manager_decides_void).
    "approval_manager_decides_discount(uuid)",
    // T-080 (PR-72, SEC-19): the manual-discount report (owner, auditor; takes the actor lock first).
    "discount_manual_list(uuid)",
    // T-081 (PR-77, BILL-36): the promo code managers (owner, Admin Pusat, Marketing), the statistics list and the Kasir hint
    // (each takes the actor lock first).
    "promo_code_create(text,jsonb)",
    "promo_code_version(text,uuid,jsonb)",
    "promo_code_set(uuid,boolean,integer)",
    "promo_codes_list()",
    "promo_code_check(text,uuid,uuid,integer,uuid)",
    // T-082 (PR-93): the family sharing switch (owner), its reader, and the beneficiary writers (each takes the actor lock first).
    "package_sharing_set(uuid,boolean,text)",
    "package_sharing_get(uuid)",
    "package_beneficiary_add(text,uuid,uuid,text)",
    "package_beneficiary_remove(uuid,text)",
    // T-083 (PR-96): the instalment schedule writers and reader (each takes the actor lock first) and the unbound reminder scan.
    "instalment_schedule_set(text,jsonb)",
    "instalment_schedule_cancel(uuid)",
    "instalment_schedule_get(uuid,uuid)",
    "instalment_reminder_scan(date)",
    // T-085 (PR-19): the shift writers and readers (each takes the actor lock first) and the inbox helper (a reader without the
    // actor lock, as approval_manager_decides_void).
    "cash_shift_open(text,uuid,jsonb)",
    "cash_shift_submit(text,uuid,jsonb)",
    "cash_shift_list(uuid,text)",
    "cash_shift_get(uuid)",
    "cash_shift_mine(uuid)",
    "approval_manager_decides_shift(uuid)",
    // T-100 (PR-94): the bound campaign writers and readers (the actor lock first).
    "campaign_actor_check(text)",
    "campaign_segment_save(text,jsonb)",
    "campaign_schedule(uuid,jsonb)",
    "campaign_unschedule(uuid,text)",
    "campaign_send(uuid)",
    "campaign_workspace_list()",
    "campaign_segment_preview(jsonb)",
    // T-102 (PR-35): the unbound SATUSEHAT worker functions (refuse a bound connection) and the bound commands / readers (the actor lock first).
    "satusehat_claim(timestamp with time zone,integer)",
    "satusehat_prepare(uuid,integer,timestamp with time zone)",
    "satusehat_identity_record(uuid,integer,jsonb,timestamp with time zone)",
    "satusehat_begin(uuid,integer,uuid,text,timestamp with time zone,text)",
    "satusehat_finish(uuid,jsonb,timestamp with time zone)",
    "satusehat_refs_check(uuid,integer,timestamp with time zone)",
    "satusehat_release(uuid,integer,timestamp with time zone)",
    "satusehat_credential_set(text,jsonb)",
    "satusehat_credential_revoke(uuid)",
    "satusehat_credential_status()",
    "satusehat_practitioner_link_set(text,uuid,text,text)",
    "satusehat_identity_resolve(uuid,text,text)",
    "satusehat_context_room_set(uuid,uuid)",
    "satusehat_resend(uuid,text)",
    "satusehat_monitor(uuid)",
    // T-102 increment 2: the unbound no-search step for Medication; the bound code-map writer.
    "satusehat_no_search(uuid,integer,uuid,timestamp with time zone)",
    "satusehat_code_map_set(text,uuid,text,text)",
    // T-102 increment 3: the UX-23 page reader and the facility head's error-body reader (the actor lock first).
    "satusehat_page(uuid)",
    "satusehat_error_body(uuid)",
    // T-102 increment 4 (TD-31): the NIK lookup — the bound request and status reader (the actor lock first) and the unbound worker claim / record
    // (refuse a bound connection). The table itself is never granted.
    "satusehat_practitioner_lookup_request(uuid,text,uuid,uuid,text)",
    "satusehat_practitioner_lookup_status(uuid)",
    "satusehat_practitioner_lookup_claim(timestamp with time zone,integer)",
    "satusehat_practitioner_lookup_record(uuid,integer,jsonb,timestamp with time zone)",
    // T-104 (PR-25): the sub-ledger readers and export (the actor lock first), the RLS predicate, and the finance VAT facts (owner D-A1).
    "subledger_rollforward(date,date,uuid)",
    // T-105 (PR-26): the posting entry point (one domain event → its matrix rule; refuses an event of another tenant; the consumer
    // ledger.posting calls it in the event's tenant context).
    "ledger_post_event(uuid)",
    // T-105: the finance commands (manual journal, Kunci Periode) and the readers / export (owner, finance, auditor; the actor lock first;
    // the export refuses unless the map is signed AND the books are activated).
    "ledger_manual_post(text,jsonb)",
    "ledger_period_lock(text,text)",
    "ledger_report(date,date,uuid)",
    "ledger_journal(date,date,uuid,timestamp with time zone)",
    "ledger_journal_export(date,date)",
    // T-105 G-Q4 U1–U4 (Panel 2): the read-only "Selisih penyerahan produk" counts (owner, finance, auditor; the actor lock first).
    "ledger_handover_exceptions(date,date,uuid)",
    // T-106 (PR-98): the Coretax status reader (owner, finance, auditor) and the gated export (owner, finance; feature_gate_lock first, refusals
    // returned and audited, the served document logged with its SHA-256). The document builders are internal (never granted).
    "coretax_status(text)",
    "coretax_export(text,text)",
    "subledger_export(text,date,date,uuid,uuid)",
    "vat_input_credit_record(text,jsonb)",
    "vat_payment_record(text,jsonb)",
    // T-107 (PR-33, UX-60): the dashboard readers (the actor lock first; on read, no table).
    "dashboard_kpi(text,date,date,uuid,boolean)",
    "dashboard_home(uuid)",
    "recon_report(date,date,uuid)", // T-108 (PR-34): the Rekon reader (owner, finance, auditor; the actor lock first; read only, no table)
    // T-116 (PR-95, 0130): the K20–K27 report readers (dashboard_actor guard: the actor lock first; facts only, no table).
    "report_k20(date,date,uuid)",
    "report_k21(date,uuid)",
    "report_k22(date,uuid,integer)",
    "report_k23(date,date,uuid)",
    "report_k24(date,date,uuid)",
    "report_k25(date,date,uuid)",
    "report_k26(date,date,uuid)",
    "report_k27(date,date,uuid)",
    // T-117 (PR-80, 0131): the owner digest job — claim / dispatch / delivered / complete on a fully unbound worker connection only; the facts
    // only for the claimed run's tenant bound with no staff and no role, with the claimed generation, while the lease holds (TEN-5). Aggregates only.
    "digest_claim(timestamp with time zone,integer)",
    "digest_dispatch(uuid,integer,text)",
    "digest_delivered(uuid,integer,text)",
    "digest_complete(uuid,integer,text)",
    "digest_facts(uuid,integer)",
    // T-103 (PR-61): vendor server-fee billing — the clinic's Bayar and reader (the actor lock first) and the executor workers (issuer, fenced finish, recovery, Advice, approved requests, reminders).
    "vendor_billing_bayar_begin(text,uuid,text,text[],timestamp with time zone)",
    "vendor_billing_tenant_view()",
    "vendor_billing_issue(timestamp with time zone,text)",
    "vendor_billing_bayar_finish(uuid,text,integer,text,jsonb,timestamp with time zone,text)", // 0120: token-fenced, unbound, also clinic_app
    "vendor_billing_recover(timestamp with time zone,text)",
    "vendor_billing_advice_due(timestamp with time zone,integer)",
    "vendor_billing_advice_record(uuid,integer,jsonb,timestamp with time zone,text)",
    "vendor_billing_apply_fee_change(uuid,uuid,text)",
    "vendor_billing_apply_waiver(uuid,uuid,text)",
    "vendor_billing_reminders(timestamp with time zone,text)",
    // T-099 (PR-81): the bound waitlist writers and reader (the actor lock first).
    "waitlist_add(text,jsonb)",
    "waitlist_remove(uuid)",
    "waitlist_offer_outcome(uuid,uuid,uuid)",
    "waitlist_entry_authorized(uuid)",
    "waitlist_list(uuid,uuid)",
    // T-098 (PR-78): the bound survey writer and readers (the actor lock first).
    "survey_record(text,jsonb)",
    "survey_list(uuid,date,date)",
    "survey_summary(uuid,date,date)",
    // T-097 (PR-94): the unbound automation scan; the bound draft writers and the log / draft readers (the actor lock first).
    "automation_scan(timestamp with time zone)",
    "automation_draft_propose(text,jsonb,text)",
    "automation_draft_decide(uuid,boolean,text)",
    "automation_draft_cancel(uuid)",
    "automation_log_list(text,text)",
    "automation_draft_get()",
    // T-096 (PR-70): the public aftercare page's definers (unbound: no staff session; each refuses a bound connection).
    "aftercare_link_lookup(text,text,timestamp with time zone)",
    "aftercare_otp_send(text,text,text,timestamp with time zone)",
    "aftercare_otp_verify(text,text,text,timestamp with time zone)",
    // T-095 (PR-69): the unbound reminder scan and the webhook's reminder reply handler (both refuse a bound connection).
    "reminder_scan(timestamp with time zone)",
    "reminder_reply_handle(jsonb)",
    // T-094 (PR-31): the outbound writers and reader (the actor lock first), the RLS predicate, and the unbound two-step dispatch.
    "outbound_enqueue(text,jsonb)",
    "outbound_bill(text,uuid)",
    "outbound_backlog(uuid)",
    "outbound_claim(timestamp with time zone)",
    "outbound_complete(uuid,text,text,timestamp with time zone)",
    // T-093 (PR-30): the follow-up writer and readers (the actor lock first) and the unbound daily scan (refuses a bound connection).
    "followup_update(uuid,jsonb)",
    "followup_list(text,text,text)",
    "followup_get(uuid)",
    "followup_scan(date)",
    // T-092 (PR-29): the lead writers and readers and the campaign writer and reader (each takes the actor lock first).
    "lead_create(text,jsonb)",
    "lead_update(uuid,jsonb)",
    "lead_stage_set(uuid,jsonb)",
    "lead_list(text,text)",
    "lead_get(uuid)",
    "campaign_save(text,jsonb)",
    "campaigns_list()",
    // T-091 (PR-43): the complaint flag from an inbound message (takes the actor lock first through complaint_actor).
    "complaint_flag_from_message(uuid,jsonb)",
    // T-090 (PR-28): the inbox writers and readers, the template writers and reader, the tenant key and sealed token for senders (each takes
    // the actor lock first), and the unbound webhook intake (keys, drop, ingest — which refuse a bound connection).
    "inbox_data_key_ensure(text)",
    "inbox_sealed_token(uuid)",
    "inbox_send_queue(text,uuid,jsonb)",
    "inbox_send_record(uuid,text)",
    "inbox_conversation_update(uuid,jsonb)",
    "inbox_list(text,uuid)",
    "inbox_thread_get(uuid)",
    "wa_template_save(text,jsonb)",
    "wa_template_sync(jsonb)",
    "wa_templates_list()",
    "inbox_webhook_keys(uuid,text)",
    "meta_webhook_drop(jsonb)",
    "meta_webhook_ingest(jsonb)",
    // T-089 (PR-27): the WABA onboarding writers and reader, the tenant key for its secrets, the server-only sealed token / PIN readers (each
    // takes the actor lock first), and the unbound webhook account update and route resolver (which refuse a bound connection).
    "waba_data_key_ensure(text)",
    "waba_signup_start(text,jsonb)",
    "waba_complete_signup(uuid,jsonb)",
    "waba_add_number(text,uuid,jsonb)",
    "waba_register_number(uuid,jsonb)",
    "waba_sync_status(uuid,jsonb)",
    "waba_migrate_to_cloud_api(uuid,jsonb)",
    "waba_revoke(uuid,text)",
    "waba_status()",
    "waba_sealed_token(uuid)",
    "waba_sealed_pin(uuid)",
    "waba_webhook_account_update(text,text,jsonb)",
    "waba_route_resolve(text)",
    // T-088 (PR-47): the target writer and the two readers (each takes the actor lock first).
    "staff_target_set(text,uuid,text,jsonb)",
    "target_mine(text)",
    "target_list(text,uuid)",
    // T-087 (PR-23): the commission rule, attribution and batch writers and the readers (each takes the actor lock first).
    "commission_rule_create(text,jsonb)",
    "commission_rule_version(text,uuid,jsonb)",
    "commission_rule_decide(uuid,text)",
    "commission_attribute_sale(text,uuid,jsonb)",
    "guiding_bc_assign(text,uuid,uuid,text)",
    "commission_batch_open(text,text)",
    "commission_batch_submit(uuid)",
    "commission_batch_mark_paid(uuid,text)",
    "staff_commission_receivable_decide(uuid,text,text)",
    "commission_batches_list()",
    "commission_batch_get(uuid)",
    "commission_batch_export(uuid)",
    "commission_mine(text)",
    "commission_rules_list()",
    "commission_rule_simulate(jsonb)",
    // T-084 (PR-79): the expense writers and readers (each takes the actor lock first).
    "expense_category_save(uuid,jsonb)",
    "expense_record(text,uuid,jsonb,bytea)",
    "expense_reverse(uuid,text)",
    "expenses_list(uuid,date,date,uuid,text)",
    "expense_receipt(uuid)",
    "expense_branch_totals(date,date)",
    // T-079 (PR-12, BILL-4/5): the consultation fee and control writers and readers (each takes the actor lock first).
    "consultation_fee_charge(text,uuid,jsonb)",
    "consultation_fee_exempt(text,uuid,jsonb)",
    "control_schedule(text,uuid,jsonb)",
    "consultation_fee_get(uuid)",
    "control_list(uuid)",
    // T-078 (PR-21, PR-37, PR-15): the refund, receivable and write-off writers and readers (each takes the actor lock first).
    "refund_request(text,uuid,jsonb)",
    "refund_pay(text,uuid,jsonb)",
    "receivable_convert(text,uuid)",
    "receivable_collect(text,uuid,jsonb)",
    "receivable_write_off_request(uuid,text)",
    "receivable_write_off_owner(text,uuid,text)",
    "piutang_get(uuid)",
    "refund_line_options(uuid)",
    "refund_invoice_picks()",
    "approval_manager_decides_refund(uuid)",
    // T-075 (PR-21): the patient balance reader.
    "balance_get(uuid)",
    // T-074 (PR-15): the addition release and the cashier's additions reader.
    "addition_release(text,uuid,jsonb)",
    "addition_visit_list(uuid)",
    // T-073 (PR-68): the payment port (charges, poll, cancel, refund, the mock's status and simulator, the unbound
    // webhook route and ingest, which refuse a bound connection).
    "payment_port_enable(integer)",
    "payment_charge_create(text,uuid,jsonb)",
    "payment_charge_poll(uuid,jsonb)",
    "payment_charge_cancel(uuid)",
    "payment_refund(text,uuid,bigint)",
    "payment_webhook_route(text)",
    "payment_webhook_ingest(jsonb,boolean,boolean,text)",
    "payment_mock_status(uuid)",
    "simulasi_set(uuid,text)",
    "simulasi_list(uuid)",
    // T-072 (PR-19): the Kasir writers and readers, and the inbox's SET-43 void rule.
    "payment_receive(text,uuid,jsonb)",
    "invoice_void_request(uuid,text)",
    "kasir_queue(uuid)",
    "kasir_invoice_get(uuid)",
    "kasir_visit_lines(uuid)",
    "kasir_counter_items(uuid,text)",
    "receipt_get(uuid)",
    "approval_manager_decides_void(uuid)",
    // T-071 (PR-24): tax profile and the invoice foundation.
    "tax_profile_set(text,jsonb)",
    "tax_profile_get()",
    "invoice_open(text,uuid,jsonb)",
    "invoice_issue(text,uuid,jsonb)",
    "invoice_get(uuid)",
    // T-068 (PR-82): logbooks and the incident register.
    "device_schedule_set(uuid,jsonb)",
    "logbook_record(text,uuid,jsonb)",
    "logbook_due_scan(date)",
    "incident_report(text,uuid,jsonb)",
    "incident_handle(uuid,text,jsonb)",
    "logbook_overview(uuid,text)",
    "incident_list(uuid)",
    "incident_get(uuid)",
    "incident_patient_options(uuid)",
    // T-067 (PR-90): purchase orders, goods receipts, supplier payables.
    "po_save(text,uuid,jsonb)",
    "po_transition(uuid,text,text)",
    "goods_receipt_record(text,uuid,jsonb)",
    "supplier_invoice_record(text,uuid,jsonb)",
    "supplier_payment_record(text,uuid,jsonb)",
    "supplier_payment_allocate(text,uuid,jsonb)",
    "supplier_credit_note_record(text,uuid,jsonb)",
    "supplier_credit_apply(text,uuid,uuid,bigint)",
    "supplier_credit_expectation_write_off(uuid,text)",
    "supplier_payable_reverse(text,uuid,text)",
    "purchasing_context()",
    "po_list(uuid,text)",
    "po_get(uuid)",
    "goods_receipt_list(uuid,integer)",
    "payable_overview(uuid)",
    "clinical_request_options(uuid)",
    "credential_record(uuid,jsonb)", // T-050: clinical credentials and expiry alerts (PR-73, IAM-4)
    "credential_decide(uuid,boolean,text)",
    "credential_end(uuid,text,text)",
    "credential_valid(uuid,uuid,timestamp with time zone)",
    "credential_decidable(uuid[])",
    "credential_alert_scan(date)",
    "patient_search(text,jsonb,uuid)", // T-041: Daftar Pasien search and segments (PR-76, DEC-060)
    "segment_delete(uuid)",
    "segment_save(text,jsonb)",
    "breach_assess(uuid)", // T-039: privacy workspace (PR-92, DEC-059)
    "breach_close(uuid)",
    "breach_conclude(uuid,boolean,text)",
    "breach_notice_add(uuid,jsonb,text,text,bytea,text)",
    "breach_notice_file(uuid)",
    "breach_record(timestamp with time zone,text,integer,text)",
    "privacy_overview()",
    "dsr_assign(uuid,uuid)", // T-121: data-subject requests (PR-50, UX-30)
    "dsr_bind_subject(uuid,uuid)",
    "dsr_close(uuid,text,text,text,text,timestamp with time zone,text,text,text)",
    "dsr_confirm_copy_handoff(uuid,uuid,text,text,timestamp with time zone,text)",
    "dsr_get(uuid)",
    "dsr_link(uuid,text,uuid,text,boolean)",
    "dsr_link_options(uuid)",
    "dsr_list(text,text)",
    "dsr_log(text,uuid,text,text,text,timestamp with time zone,text,text[])",
    "dsr_verify(uuid,text)",
    // T-122 (PR-52, UX-32, 0135): tenant export — owner-only request/list/release/audit definers (actor lock + exit/live/suspended capability)
    // and unbound/staffless worker definers (claim, REPEATABLE READ snapshot read, fenced put/finish/fail, expire).
    "export_audit_denial(uuid,text)",
    "export_claim(integer)",
    "export_expire(integer)",
    "export_fail(uuid,integer,text)",
    "export_finish(uuid,integer,timestamp with time zone,text,text)",
    "export_list()",
    "export_put_file(uuid,integer,text,text,text,bytea)",
    "export_release_commit(uuid)",
    "export_release_load(uuid)",
    "export_request(text)",
    "export_snapshot_read(uuid,integer)",
    // T-125 (PR-66, UX-50, UX-51, DEC-130; migration 0138): doctor listing consent & immediate purge
    // (bound grant/withdraw/list behind tenant_actor_lock / approval_actor + unbound public_doctors_by_slug / public_doctor_detail / public_doctor_photo).
    "doctor_listing_grant(uuid,text,text,text,text,text[],boolean,bytea,text,boolean,text)",
    "doctor_listing_list()",
    "doctor_listing_withdraw(uuid,text)",
    "public_doctor_detail(text,text)",
    "public_doctor_photo(text,text,text)",
    "public_doctors_by_slug(text)",
    // T-126 (PR-67, UX-24, DATA-56, OD-1 Option B; migration 0137): narrow unbound public booking seam
    // (server resolves live published counsel-valid tenant from slug; enforces real_patient_gate_assert + scheduled purge).
    "public_booking_catalog(text)",
    "public_booking_otp_abort(text,text)",
    "public_booking_otp_request(text,text,text,timestamp with time zone,text,text,text,text,text,date,text,text,text,text)",
    "public_booking_otp_resend_commit(text,text,text)",
    "public_booking_otp_resend_prepare(text,text)",
    "public_booking_otp_verify_and_book(text,text,text,text)",
    "public_booking_purge_expired(integer)",
    "public_booking_slots(text,text,text,date,text)",
    // T-123 (PR-64, PR-65, UX-50, UX-51, DEC-128; migration 0136): public site generator & Situs Klinik admin definers
    // (bound admin/review/publish definers behind _site_actor + unbound public_site_by_slug).
    "public_site_by_slug(text)",
    "site_admin_view()",
    "site_approve_web_review(uuid,integer,text)",
    "site_commit_publish(jsonb,text)",
    "site_publish_facts()",
    "site_save_settings(text,text,text,text,text,boolean,boolean,boolean,boolean,boolean)",
    "site_save_web_field(uuid,text,boolean,boolean,text,text,text,integer,integer,text,text,text,text)",
    "site_unpublish()",
    "site_web_review_source(uuid)",
    "processor_set_active(uuid,boolean)",
    "processor_upsert(uuid,jsonb)",
    "queue_board(uuid)", // T-048: queue numbers, walk-in, paired displays (PR-71, DEC-058)
    "queue_call(uuid,uuid)",
    "queue_display_feed(text)",
    "queue_display_pair(uuid,text,text)",
    "queue_display_revoke(uuid)",
    "queue_patient_search(text)",
    "queue_skip(uuid)",
    "visit_walk_in(uuid,uuid)",
    "visit_check_in(uuid)", // T-047: visits and Hari Ini (PR-7, DEC-057)
    "visit_close(uuid)",
    "visits_today(uuid)",
    "booking_confirm(uuid)", // T-044: booking engine (PR-6, DEC-054)
    "booking_create(uuid,uuid,uuid,timestamp with time zone,uuid,text,text,text,text,boolean)",
    "booking_slots(uuid,uuid,date,uuid)",
    "leave_add(uuid,uuid,text,date,date,text)", // T-043: staff schedules (PR-48, DEC-053)
    "leave_cancel(uuid,text)",
    "roster_set_week(uuid,date,uuid[],jsonb)",
    "roster_window(uuid,date,date)",
    "staff_available(uuid,uuid,timestamp with time zone,timestamp with time zone)",
    "patient_get(uuid)", // T-037: patient registration and scenario PR-1 (PR-5, DATA-8)
    "patient_matches(text,text,date,text,text)",
    "patient_register(jsonb,text,text,text)",
    "room_set_active(uuid,boolean)",
    "room_upsert(uuid,uuid,text,text,text)",
    "tenant_data_key_ensure(text)",
    "tenant_data_keys_for()",
    "catalog_publish(uuid,text,text,jsonb,text)",
    "catalog_review_target(uuid)",
    "catalog_service_requirements(uuid)", // T-034: active resources and eligibility for booking roles (DEC-047 (4))
    "catalog_unpublished()",
    "catalog_version_reference(uuid)",
    "audit_verify(uuid)",
    "compliance_may_read(text)",
    "compliance_register()",
    "events_claim(text,text,integer,integer)",
    "evidence_decide(uuid,uuid,text,text,date)",
    "evidence_decisions(uuid)", // HYG-008a: decisions newest first without seq (B-03, 9c)
    "evidence_file_content(uuid)",
    "evidence_upload(text,text,text,bytea,text,text,date)",
    "feature_gate_lock(text)",
    "feature_gate_missing(text)",
    "feature_gate_open(text)",
    "notification_ack(uuid)",
    "notification_labels()",
    "notification_raise(text,text,uuid,uuid,text,uuid,uuid)",
    "onboarding_draft_confirm(uuid,text)",
    "onboarding_draft_decline(uuid)",
    "onboarding_grant_renew()",
    "onboarding_grant_status()",
    "role_assign(uuid,text)",
    "role_request_decide(uuid,boolean)",
    "role_owner_confirm(uuid,boolean)",
    "role_owner_grants_mine()",
    "role_owner_grant_withdraw(uuid)",
    "setting_default(text)",
    "setting_draft_cancel(uuid)",
    "setting_draft_decide(uuid,boolean,text)",
    "setting_role_sees(text)",
    "setting_set(text,uuid,jsonb,timestamp with time zone,text,boolean)",
    "staff_branch_set(uuid,text,uuid,boolean)",
    "staff_duty_set(uuid,text,boolean)",
    "staff_end_membership(uuid)",
    "staff_invite(text,text,text[],uuid[],text,integer)",
    "staff_invite_accept(text,uuid)",
    "staff_invite_cancel(uuid)",
    "staff_invite_lookup(text)",
    "staff_role_remove(uuid,text)",
    "staff_session_revoke(uuid,uuid)",
    "staff_session_revoked(uuid,uuid)",
    "staff_sessions(uuid)",
    "support_session_end_by_owner(uuid)",
    "support_session_owner_decide(uuid,boolean)",
    "support_session_reads_for_owner(uuid,integer,integer)",
    "support_sessions_for_owner()",
    "tenant_capability(text)",
    "tenant_lifecycle_status()",
    "tenant_owner_invite_accept(text,uuid)",
    "tenant_owner_invite_lookup(text)",
    "vendor_dual_identities()",
    "vendor_dual_identity_clinic_decide(uuid,boolean)",
    "vendor_dual_identity_clinic_revoke(uuid)",
    "vendor_go_live_allowed()",
    "vendor_identity()",
    "real_patient_gate_status()", // T-120 (PR-36, ARCH-10): Owner / Admin Pusat Kepatuhan status reader
  ];

  it("the app executes no SECURITY DEFINER function outside the allow-list", async () => {
    const { rows } = await h.admin.query<{ f: string }>(
      `select p.oid::regprocedure::text as f from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
         and has_function_privilege($1, p.oid, 'EXECUTE')`,
      [APP_GROUP_ROLE],
    );
    expect(rows.map((r) => r.f).filter((f) => !ALLOWED_DEFINER_FUNCTIONS.includes(f))).toEqual([]);
  });

  it("a new function is not executable by PUBLIC by default", async () => {
    await h.admin.query("begin");
    try {
      await h.admin.query(
        `create function definer_probe() returns int language sql security definer as 'select 1'`,
      );
      const { rows } = await h.admin.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'definer_probe()', 'EXECUTE') as ok`,
        [APP_GROUP_ROLE],
      );
      expect(rows[0].ok).toBe(false);
    } finally {
      await h.admin.query("rollback");
    }
  });
});

describe("tenant isolation under clinic_app (PR-1, TEN-1, TEN-2)", () => {
  it("reads its own tenant and branch", async () => {
    const r = await withTenantContext(app, ctx(tenantA), async (c) => ({
      tenants: (await c.query(`select id from tenants`)).rows.map((x) => x.id),
      branches: (await c.query(`select id from branches`)).rows.map((x) => x.id),
    }));
    expect(r).toEqual({ tenants: [tenantA], branches: [branchA] });
  });

  it("gets not-found for another tenant's branch by id", async () => {
    const rows = await withTenantContext(app, ctx(tenantA), async (c) =>
      (await c.query(`select * from branches where id = $1`, [branchB])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("gets not-found for another tenant's row by id", async () => {
    const rows = await withTenantContext(app, ctx(tenantA), async (c) =>
      (await c.query(`select * from tenants where id = $1`, [tenantB])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("sees nothing without tenant context (fails closed)", async () => {
    expect((await app.query(`select * from branches`)).rows).toEqual([]);
    expect((await app.query(`select * from tenants`)).rows).toEqual([]);
  });

  it("does not carry context past the transaction on a pooled connection", async () => {
    const one = await openAppPool({ connectionString: app.options.connectionString, max: 1 });
    try {
      await withTenantContext(one, ctx(tenantA), async () => undefined);
      const { rows } = await one.query(`select current_setting('app.tenant_id', true) as t`);
      expect(rows[0].t ?? "").toBe("");
      expect((await one.query(`select * from branches`)).rows).toEqual([]);
    } finally {
      await one.end();
    }
  });

  it("clears a session-level SET made inside the callback", async () => {
    const one = await openAppPool({ connectionString: app.options.connectionString, max: 1 });
    try {
      await withTenantContext(one, ctx(tenantA), async (c) => {
        await c.query(`select set_config('app.tenant_id', $1, false)`, [tenantA]);
      });
      expect((await one.query(`select * from branches`)).rows).toEqual([]);
    } finally {
      await one.end();
    }
  });

  it("rolls back and clears context when the callback throws (same connection)", async () => {
    const one = await openAppPool({ connectionString: app.options.connectionString, max: 1 });
    try {
      await expect(
        withTenantContext(one, ctx(tenantA), async (c) => {
          await c.query(`select 1`);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect((await one.query(`select * from branches`)).rows).toEqual([]);
      expect((await one.query(`select txid_current_if_assigned() as t`)).rows[0].t).toBeNull();
    } finally {
      await one.end();
    }
  });

  it("destroys a connection that dies mid-transaction instead of reusing it", async () => {
    const one = await openAppPool({ connectionString: app.options.connectionString, max: 1 });
    try {
      const pid = await withTenantContext(one, ctx(tenantA), async (c) =>
        (await c.query(`select pg_backend_pid() as p`)).rows[0].p as number,
      );
      await expect(
        withTenantContext(one, ctx(tenantA), async (c) => {
          const died = new Promise((resolve) => c.once("error", resolve));
          await h.admin.query(`select pg_terminate_backend($1)`, [pid]);
          await died;
          throw new Error("connection lost");
        }),
      ).rejects.toThrow("connection lost");
      const next = (await one.query(`select pg_backend_pid() as p`)).rows[0].p as number;
      expect(next).not.toBe(pid);
      expect((await one.query(`select * from branches`)).rows).toEqual([]);
    } finally {
      await one.end().catch(() => {});
    }
  });

  it("refuses nesting", async () => {
    await expect(
      withTenantContext(app, ctx(tenantA), () =>
        withTenantContext(app, ctx(tenantB), async () => "inner"),
      ),
    ).rejects.toThrow("cannot be nested");
  });

  it("keeps concurrent calls isolated (each holds its own connection)", async () => {
    const read = (t: string) =>
      withTenantContext(app, ctx(t), async (c) => {
        await c.query(`select pg_sleep(0.05)`);
        return (await c.query(`select tenant_id from branches`)).rows.map((x) => x.tenant_id);
      });
    const results = await Promise.all([read(tenantA), read(tenantB), read(tenantA), read(tenantB)]);
    expect(results).toEqual([[tenantA], [tenantB], [tenantA], [tenantB]]);
  });

  it("cannot write branches or touch platform tables", async () => {
    await withTenantContext(app, ctx(tenantA), async (c) => {
      await c.query("savepoint s");
      await expect(
        c.query(
          `insert into branches (tenant_id, code, name, timezone)
           values ($1, 'X', 'X', 'Asia/Jakarta')`,
          [tenantA],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint s");
      await expect(c.query(`select * from tenants_registry`)).rejects.toMatchObject({
        code: "42501",
      });
      await c.query("rollback to savepoint s");
      await expect(c.query(`select * from scope_map`)).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint s");
      await expect(c.query(`create table mine (id int)`)).rejects.toMatchObject({
        code: "42501",
      });
      await c.query("rollback to savepoint s");
    });
  });

  it("rejects malformed context values before touching the database", async () => {
    await expect(
      withTenantContext(app, { ...ctx(tenantA), tenantId: "' or true --" }, async () => undefined),
    ).rejects.toThrow("tenantId is not a UUID");
    await expect(
      withTenantContext(app, { ...ctx(tenantA), roles: ["owner,finance"] }, async () => undefined),
    ).rejects.toThrow("roles must match");
  });

  it("a forged non-UUID setting errors instead of widening access", async () => {
    const c = await app.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.tenant_id', 'x'' or true', true)`);
      await expect(c.query(`select * from branches`)).rejects.toMatchObject({ code: "22P02" });
      await c.query("rollback");
    } finally {
      c.release();
    }
  });
});
