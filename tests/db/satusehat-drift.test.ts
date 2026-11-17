// T-102 drift check (plan r4 §Migration): migration 0116 adds the satusehat_* tables, their guards, the definers and one trigger on an existing
// table (record_versions.satusehat_on_record_version, insert-only). No existing function, policy, check or trigger is re-created or changed.
// A database is migrated to exactly 0115, then to exactly 0116.
import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

type Fn = { def: string; secdef: boolean; config: string | null; acl: string | null };
let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
const snap: Record<"before" | "after", { policies: Map<string, string>; checks: Map<string, string>; triggers: Map<string, string> }> = {} as never;
let dirs: string[] = [];

async function capture(db: pg.ClientBase): Promise<Map<string, Fn>> {
  const r = await db.query<{ k: string; def: string; secdef: boolean; config: string[] | null; acl: string | null }>(
    `select p.oid::regprocedure::text as k, pg_get_functiondef(p.oid) as def, p.prosecdef as secdef, p.proconfig as config, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`);
  return new Map(r.rows.map((x) => [x.k, { def: x.def, secdef: x.secdef, config: x.config?.join(";") ?? null, acl: x.acl }]));
}
const kv = async (db: pg.ClientBase, sql: string) => new Map((await db.query<{ k: string; v: string }>(sql)).rows.map((x) => [x.k, x.v]));
const policies = (db: pg.ClientBase) => kv(db, `select c.relname || '.' || p.polname as k, p.polcmd::text || ' ' || p.polroles::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as v
  from pg_policy p join pg_class c on c.oid = p.polrelid`);
const checks = (db: pg.ClientBase) => kv(db, `select c.relname || '.' || k.conname as k, pg_get_constraintdef(k.oid) as v from pg_constraint k join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`);
const triggers = (db: pg.ClientBase) => kv(db, `select c.relname || '.' || t.tgname as k, pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text as v from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`);

beforeAll(async () => {
  const toBefore = migrationsUpTo("0115_campaigns");
  const toAfter = migrationsUpTo("0116_satusehat");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  snap.before = { policies: await policies(h.admin), checks: await checks(h.admin), triggers: await triggers(h.admin) };
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  snap.after = { policies: await policies(h.admin), checks: await checks(h.admin), triggers: await triggers(h.admin) };
}, 300_000);
afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GRANTED = ["satusehat_begin(uuid,integer,uuid,text,timestamp with time zone,text)", "satusehat_claim(timestamp with time zone,integer)",
  "satusehat_context_room_set(uuid,uuid)", "satusehat_credential_revoke(uuid)", "satusehat_credential_set(text,jsonb)", "satusehat_credential_status()",
  "satusehat_finish(uuid,jsonb,timestamp with time zone)", "satusehat_identity_record(uuid,integer,jsonb,timestamp with time zone)",
  "satusehat_identity_resolve(uuid,text,text)", "satusehat_monitor(uuid)", "satusehat_practitioner_link_set(text,uuid,text,text)",
  "satusehat_prepare(uuid,integer,timestamp with time zone)", "satusehat_refs_check(uuid,integer,timestamp with time zone)",
  "satusehat_release(uuid,integer,timestamp with time zone)", "satusehat_resend(uuid,text)"];

describe("T-102: the SATUSEHAT migration adds and changes nothing else", () => {
  it("no existing function re-created or dropped; the granted functions are exactly the plan's, all definers with a pinned search_path", () => {
    expect([...after].filter(([k, a]) => before.has(k) && before.get(k)!.def !== a.def).map(([k]) => k)).toEqual([]);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    expect(added.every((k) => k.startsWith("satusehat_"))).toBe(true);
    expect(added.filter((k) => /clinic_app=X\//.test(after.get(k)!.acl ?? "")).sort()).toEqual(GRANTED);
    for (const k of added) expect(after.get(k)!.acl ?? "", k).not.toMatch(/clinic_(vendor|executor|operator)=X\/|=X\/.*PUBLIC|^\{=X/);
    for (const k of GRANTED) expect({ k, secdef: after.get(k)!.secdef, config: after.get(k)!.config }).toEqual({ k, secdef: true, config: "search_path=pg_catalog, pg_temp" });
  });

  it("no existing check, policy or trigger changed; the only new trigger on an existing table is the insert-only enqueue on record_versions", () => {
    for (const x of ["policies", "checks", "triggers"] as const) for (const [k, v] of snap.before[x]) expect(snap.after[x].get(k), `${x} ${k}`).toBe(v);
    const added = [...snap.after.triggers.keys()].filter((k) => !snap.before.triggers.has(k));
    expect(added.filter((k) => !k.startsWith("satusehat_"))).toEqual(["record_versions.satusehat_on_record_version"]);
    expect(snap.after.triggers.get("record_versions.satusehat_on_record_version")).toMatch(/AFTER INSERT ON public\.record_versions FOR EACH ROW .* A$/);
    expect(after.get("satusehat_on_record_version()")!.secdef).toBe(false);
    expect([...snap.after.policies.keys()].filter((k) => k.startsWith("satusehat_"))).toEqual([]); // deny by default, readers only
  });
});

// Increment 2: 0116 → 0117 re-creates exactly satusehat_materialize, satusehat_release and satusehat_practitioner_link_set and adds
// satusehat_ihs, satusehat_no_search, satusehat_requeue_links and satusehat_code_map_set; no other function, check, policy or trigger changes.
describe("T-102 increment 2: 0116 → 0117 changes only the allowlist", () => {
  let h2: Harness; let b: Map<string, Fn>; let a: Map<string, Fn>; let dirs2: string[] = [];
  const s2: Record<"b" | "a", { policies: Map<string, string>; checks: Map<string, string>; triggers: Map<string, string> }> = {} as never;
  beforeAll(async () => {
    const toB = migrationsUpTo("0116_satusehat"); const toA = migrationsUpTo("0117_satusehat_resources");
    dirs2 = [toB, toA];
    let url = "";
    h2 = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toB }); } });
    b = await capture(h2.admin);
    s2.b = { policies: await policies(h2.admin), checks: await checks(h2.admin), triggers: await triggers(h2.admin) };
    await runMigrations(url, { folder: toA });
    a = await capture(h2.admin);
    s2.a = { policies: await policies(h2.admin), checks: await checks(h2.admin), triggers: await triggers(h2.admin) };
  }, 300_000);
  afterAll(async () => {
    await h2?.close();
    for (const d of dirs2) rmSync(d, { recursive: true, force: true });
  });
  it("re-created and added functions are exactly the allowlist; every other function, its ACL and definer settings unchanged; helper grants exact", () => {
    const RECREATED = ["satusehat_materialize(satusehat_outbox,text,text,jsonb)", "satusehat_practitioner_link_set(text,uuid,text,text)",
      "satusehat_release(uuid,integer,timestamp with time zone)"];
    for (const [k, f] of b) {
      if (RECREATED.includes(k)) continue;
      expect({ k, def: a.get(k)?.def, acl: a.get(k)?.acl, secdef: a.get(k)?.secdef, config: a.get(k)?.config }).toEqual({ k, def: f.def, acl: f.acl, secdef: f.secdef, config: f.config });
    }
    // a re-created function keeps its ACL, definer flag and search_path
    for (const k of RECREATED) expect({ k, acl: a.get(k)!.acl, secdef: a.get(k)!.secdef, config: a.get(k)!.config }).toEqual({ k, acl: b.get(k)!.acl, secdef: b.get(k)!.secdef, config: b.get(k)!.config });
    expect([...a].filter(([k, f]) => b.has(k) && b.get(k)!.def !== f.def).map(([k]) => k).sort()).toEqual([
      "satusehat_materialize(satusehat_outbox,text,text,jsonb)", "satusehat_practitioner_link_set(text,uuid,text,text)",
      "satusehat_release(uuid,integer,timestamp with time zone)"]);
    expect([...b.keys()].filter((k) => !a.has(k))).toEqual([]);
    const added = [...a.keys()].filter((k) => !b.has(k)).sort();
    expect(added).toEqual(["satusehat_code_map_set(text,uuid,text,text)", "satusehat_ihs(uuid,uuid)", "satusehat_no_search(uuid,integer,uuid,timestamp with time zone)",
      "satusehat_requeue_links(uuid,text,uuid[])"]);
    expect(added.filter((k) => /clinic_app=X\//.test(a.get(k)!.acl ?? "")).sort()).toEqual(["satusehat_code_map_set(text,uuid,text,text)",
      "satusehat_no_search(uuid,integer,uuid,timestamp with time zone)"]);
    // the internal helpers: revoked from PUBLIC, granted to no role (only the table owner's definers call them)
    for (const k of ["satusehat_ihs(uuid,uuid)", "satusehat_requeue_links(uuid,text,uuid[])"]) {
      expect({ k, acl: a.get(k)!.acl, secdef: a.get(k)!.secdef }).toEqual({ k, acl: expect.not.stringMatching(/(^|[{,])=X|clinic_/), secdef: false });
      expect(a.get(k)!.acl, k).not.toBeNull();
    }
    for (const k of added) expect(a.get(k)!.acl ?? "", k).not.toMatch(/clinic_(vendor|executor|operator)=X\//);
    for (const k of ["satusehat_code_map_set(text,uuid,text,text)", "satusehat_no_search(uuid,integer,uuid,timestamp with time zone)"]) {
      expect({ k, secdef: a.get(k)!.secdef, config: a.get(k)!.config }).toEqual({ k, secdef: true, config: "search_path=pg_catalog, pg_temp" });
    }
  });
  it("no check, policy or trigger changed or added", () => {
    for (const x of ["policies", "checks", "triggers"] as const) {
      for (const [k, v] of s2.b[x]) expect(s2.a[x].get(k), `${x} ${k}`).toBe(v);
      expect([...s2.a[x].keys()].filter((k) => !s2.b[x].has(k)), x).toEqual([]);
    }
  });
});

// Increment 3: 0117 → 0118 adds exactly satusehat_page and satusehat_error_body (bound definers, granted to clinic_app only); nothing else
// changes — no function re-created, no check, policy or trigger.
describe("T-102 increment 3: 0117 → 0118 adds only the page readers", () => {
  let h3: Harness; let b: Map<string, Fn>; let a: Map<string, Fn>; let dirs3: string[] = [];
  const s3: Record<"b" | "a", { policies: Map<string, string>; checks: Map<string, string>; triggers: Map<string, string> }> = {} as never;
  beforeAll(async () => {
    const toB = migrationsUpTo("0117_satusehat_resources"); const toA = migrationsUpTo("0118_satusehat_page");
    dirs3 = [toB, toA];
    let url = "";
    h3 = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toB }); } });
    b = await capture(h3.admin);
    s3.b = { policies: await policies(h3.admin), checks: await checks(h3.admin), triggers: await triggers(h3.admin) };
    await runMigrations(url, { folder: toA });
    a = await capture(h3.admin);
    s3.a = { policies: await policies(h3.admin), checks: await checks(h3.admin), triggers: await triggers(h3.admin) };
  }, 300_000);
  afterAll(async () => {
    await h3?.close();
    for (const d of dirs3) rmSync(d, { recursive: true, force: true });
  });
  it("every existing function unchanged; the two added readers are bound definers granted to clinic_app only", () => {
    for (const [k, f] of b) {
      expect({ k, def: a.get(k)?.def, acl: a.get(k)?.acl, secdef: a.get(k)?.secdef, config: a.get(k)?.config }).toEqual({ k, def: f.def, acl: f.acl, secdef: f.secdef, config: f.config });
    }
    const added = [...a.keys()].filter((k) => !b.has(k)).sort();
    expect(added).toEqual(["satusehat_error_body(uuid)", "satusehat_page(uuid)"]);
    for (const k of added) {
      expect({ k, secdef: a.get(k)!.secdef, config: a.get(k)!.config }).toEqual({ k, secdef: true, config: "search_path=pg_catalog, pg_temp" });
      expect(a.get(k)!.acl ?? "", k).toMatch(/clinic_app=X\//);
      expect(a.get(k)!.acl ?? "", k).not.toMatch(/(^|[{,])=X|clinic_(vendor|executor|operator|worker)=X\//);
    }
  });
  it("no check, policy or trigger changed or added", () => {
    for (const x of ["policies", "checks", "triggers"] as const) {
      for (const [k, v] of s3.b[x]) expect(s3.a[x].get(k), `${x} ${k}`).toBe(v);
      expect([...s3.a[x].keys()].filter((k) => !s3.b[x].has(k)), x).toEqual([]);
    }
  });
});
