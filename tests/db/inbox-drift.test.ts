// T-090 drift check: the inbox migration (0105) adds meta_webhook_receipts, conversations, messages and wa_templates with their guards,
// RLS predicates, the webhook intake, the inbox and template commands and readers, and re-creates NO existing function (CHANGED = []; neither
// tenant_data_key_ensure (0057) nor waba_data_key_ensure / waba_sealed_token (0104) nor setting_value_at (0028)). Every existing function stays
// byte-identical with its attributes; no existing policy or check changes; the new triggers are ENABLE ALWAYS; the receipts are platform with
// no grant; the sealed body and contact name are not granted; messages and conversations are personal for vendor support.
import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "../db/migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

type Fn = { def: string; volatile: string; secdef: boolean; config: string | null; acl: string | null };
let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
let policiesBefore: Map<string, string>;
let policiesAfter: Map<string, string>;
let checksBefore: Map<string, string>;
let checksAfter: Map<string, string>;
let dirs: string[] = [];

async function capture(db: pg.ClientBase): Promise<Map<string, Fn>> {
  const r = await db.query<{ k: string; def: string; volatile: string; secdef: boolean; config: string[] | null; acl: string | null }>(
    `select p.oid::regprocedure::text as k, pg_get_functiondef(p.oid) as def, p.provolatile as volatile, p.prosecdef as secdef,
            p.proconfig as config, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`,
  );
  return new Map(r.rows.map((x) => [x.k, { def: x.def, volatile: x.volatile, secdef: x.secdef, config: x.config?.join(";") ?? null, acl: x.acl }]));
}
async function policies(db: pg.ClientBase): Promise<Map<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || p.polname as k, p.polcmd::text || ' ' || p.polroles::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as v
       from pg_policy p join pg_class c on c.oid = p.polrelid`,
  );
  return new Map(r.rows.map((x) => [x.k, x.v]));
}
async function checks(db: pg.ClientBase): Promise<Map<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || k.conname as k, pg_get_constraintdef(k.oid) as v from pg_constraint k join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`,
  );
  return new Map(r.rows.map((x) => [x.k, x.v]));
}

beforeAll(async () => {
  const toBefore = migrationsUpTo("0104_waba");
  const toAfter = migrationsUpTo("0105_inbox");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  policiesBefore = await policies(h.admin);
  checksBefore = await checks(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policiesAfter = await policies(h.admin);
  checksAfter = await checks(h.admin);
}, 300_000);
afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const APP = ["inbox_readable(uuid,uuid)", "wa_templates_readable(uuid)", "inbox_webhook_keys(uuid,text)", "inbox_data_key_ensure(text)",
  "inbox_sealed_token(uuid)", "meta_webhook_drop(jsonb)", "meta_webhook_ingest(jsonb)", "inbox_send_queue(text,uuid,jsonb)", "inbox_send_record(uuid,text)",
  "inbox_conversation_update(uuid,jsonb)", "wa_template_save(text,jsonb)", "wa_template_sync(jsonb)", "inbox_list(text,uuid)", "inbox_thread_get(uuid)",
  "wa_templates_list()"];
const INTERNAL = ["inbox_can_send(uuid,uuid,uuid)", "inbox_assignment_mode(uuid,uuid,timestamp with time zone)", "message_status_rank(text)",
  "meta_webhook_receipts_guard()", "conversations_guard()", "messages_guard()", "wa_templates_guard()", "wa_template_body_ok(text)",
  "message_apply_status(uuid,uuid,text,timestamp with time zone)", "message_apply_held(uuid,uuid,text)",
  "inbox_next_assignee(uuid,uuid,timestamp with time zone)", "inbox_actor()", "inbox_conversation_for(uuid,uuid)"];
const TABLES = ["meta_webhook_receipts", "conversations", "messages", "wa_templates"];

describe("T-090: the inbox migration re-creates no existing function", () => {
  it("every existing function is byte-identical with its attributes; nothing dropped", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual([]);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });
  it("the added functions are exactly the inbox ones; only the app-facing ones and the RLS predicates are granted; definers pin the path", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    expect(added).toEqual([...APP, ...INTERNAL].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (APP.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
      if (after.get(k)!.secdef) expect(after.get(k)!.config, k).toBe("search_path=pg_catalog, pg_temp");
    }
    expect(added.filter((k) => after.get(k)!.secdef).sort()).toEqual(APP.filter((k) => !k.includes("_readable(")).sort());
  });
  it("no existing policy or check changed", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
  });
  it("the tables are RLS-protected, not writable by the app, guarded and never truncated", async () => {
    for (const t of TABLES) {
      expect((await h.admin.query(`select relrowsecurity r from pg_class where relname = $1`, [t])).rows[0].r, t).toBe(true);
      for (const role of ["clinic_app", "clinic_operator", "clinic_vendor"]) {
        const p = (await h.admin.query(`select has_table_privilege($1, $2, 'INSERT') i, has_table_privilege($1, $2, 'UPDATE') u, has_table_privilege($1, $2, 'DELETE') d`,
          [role, `public.${t}`])).rows[0];
        expect([t, role, p.i, p.u, p.d]).toEqual([t, role, false, false, false]);
      }
      const trg = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = $1::regclass and not tgisinternal order by 1`, [`public.${t}`])).rows;
      expect(trg.map((x) => [x.tgname, x.tgenabled])).toEqual([[`${t}_guard`, "A"], [`${t}_no_truncate`, "A"]]);
    }
  });
  it("receipts have no grant; sealed columns are not granted; the scope map and support classes", async () => {
    for (const role of ["clinic_app", "clinic_operator", "clinic_vendor"]) {
      expect((await h.admin.query(`select has_any_column_privilege($1, 'public.meta_webhook_receipts', 'SELECT') c`, [role])).rows[0].c, role).toBe(false);
      for (const [t, c] of [["messages", "body_enc"], ["messages", "body_dek_ref"], ["conversations", "contact_name_enc"], ["conversations", "contact_name_dek_ref"]]) {
        expect((await h.admin.query(`select has_column_privilege($1, $2, $3, 'SELECT') s`, [role, `public.${t}`, c])).rows[0].s, `${role} ${t}.${c}`).toBe(false);
      }
    }
    for (const role of ["clinic_app", "clinic_operator"]) {
      expect((await h.admin.query(`select has_column_privilege($1, 'public.messages', 'status', 'SELECT') s`, [role])).rows[0].s).toBe(true);
      expect((await h.admin.query(`select has_table_privilege($1, 'public.wa_templates', 'SELECT') s`, [role])).rows[0].s).toBe(true);
    }
    const byName = (a: { table_name: string }, b: { table_name: string }) => (a.table_name < b.table_name ? -1 : 1);
    expect((await h.admin.query(`select table_name, policy_kind, owning_module from scope_map where table_name = any($1)`, [TABLES.map((t) => `public.${t}`)])).rows.sort(byName)).toEqual([
      { table_name: "public.conversations", policy_kind: "tenant-shared", owning_module: "messaging" },
      { table_name: "public.messages", policy_kind: "tenant-shared", owning_module: "messaging" },
      { table_name: "public.meta_webhook_receipts", policy_kind: "platform", owning_module: "messaging" },
      { table_name: "public.wa_templates", policy_kind: "tenant-shared", owning_module: "messaging" },
    ]);
    expect((await h.admin.query(`select table_name, support_class from support_object_kinds where table_name = any($1)`, [TABLES.map((t) => `public.${t}`)])).rows.sort(byName)).toEqual([
      { table_name: "public.conversations", support_class: "personal" },
      { table_name: "public.messages", support_class: "personal" },
      { table_name: "public.wa_templates", support_class: "config" },
    ]);
  });
});
