// T-096 drift check: migration 0111 adds aftercare_notices and aftercare_otp_sends with their helpers, guards, the visit-close trigger and
// the public definers. It re-creates exactly one function — outbound_params, now VOLATILE (it mints the aftercare link token at claim time,
// plan r1 P1-1), pinned by hash, its other attributes kept; adds one trigger on an existing table (visits_aftercare on visits); changes no
// existing policy or check. A database is migrated to exactly 0110, then to exactly 0111.
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

type Fn = { def: string; volatile: string; secdef: boolean; config: string | null; acl: string | null };
let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
let policiesBefore: Map<string, string>;
let policiesAfter: Map<string, string>;
let checksBefore: Map<string, string>;
let checksAfter: Map<string, string>;
let triggersBefore: Map<string, string>;
let triggersAfter: Map<string, string>;
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
async function triggers(db: pg.ClientBase): Promise<Map<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || t.tgname as k, pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text as v from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`,
  );
  return new Map(r.rows.map((x) => [x.k, x.v]));
}

beforeAll(async () => {
  const toBefore = migrationsUpTo("0110_reminders");
  const toAfter = migrationsUpTo("0111_aftercare");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  policiesBefore = await policies(h.admin);
  checksBefore = await checks(h.admin);
  triggersBefore = await triggers(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policiesAfter = await policies(h.admin);
  checksAfter = await checks(h.admin);
  triggersAfter = await triggers(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sha = (s: string) => createHash("sha256").update(s.trimEnd()).digest("hex");
const P = "outbound_params(outbound_messages)";
const GRANTED = ["aftercare_link_lookup(text,text,timestamp with time zone)", "aftercare_notices_readable(uuid,uuid)",
  "aftercare_otp_send(text,text,text,timestamp with time zone)", "aftercare_otp_verify(text,text,text,timestamp with time zone)"];
const DEFINERS = ["aftercare_link_lookup(text,text,timestamp with time zone)", "aftercare_otp_send(text,text,text,timestamp with time zone)",
  "aftercare_otp_verify(text,text,text,timestamp with time zone)", "visit_aftercare()"];

describe("T-096: the aftercare migration re-creates only outbound_params (now volatile)", () => {
  it("no function dropped; outbound_params is the only changed one, from its reviewed 0110 to its reviewed 0111 definition; volatile s → v, the rest kept", () => {
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "aftercare-drift.expected.json"), "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      if (k === P) continue;
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual([P]);
    const b = before.get(P)!; const a = after.get(P)!;
    expect([b.volatile, a.volatile]).toEqual(["s", "v"]);
    expect({ secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ secdef: b.secdef, config: b.config, acl: b.acl });
    expect(sha(b.def)).toBe(expected.before[P]);
    expect(sha(a.def)).toBe(expected.after[P]);
    // the aftercare link: minted at claim, only its hash kept; the WhatsApp params carry no catalog name
    expect(a.def).toContain("gen_random_bytes(32)");
    expect(a.def).toContain("aftercare_hash(v_token)");
    expect(a.def).toContain("'/aftercare/' || v_token");
    expect(a.def).not.toMatch(/catalog_(items|versions)/);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the granted functions are the public definers and the RLS predicate; definers pin the path; the helpers are not granted", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const granted = added.filter((k) => /clinic_app=X\//.test(after.get(k)!.acl ?? "")).sort();
    expect(granted).toEqual(GRANTED);
    for (const k of added) expect(after.get(k)!.acl ?? "", k).not.toMatch(/clinic_(vendor|executor|operator)=X\//);
    for (const k of DEFINERS) {
      expect(after.get(k)!.secdef, k).toBe(true);
      expect(after.get(k)!.config, k).toBe("search_path=pg_catalog, pg_temp");
    }
    expect(added.filter((k) => after.get(k)!.secdef).sort()).toEqual(DEFINERS);
  });

  it("no existing policy or check changed; the only trigger added on an existing table is visits_aftercare", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of triggersBefore) expect(triggersAfter.get(k), k).toBe(v);
    expect([...triggersAfter.keys()].filter((k) => !triggersBefore.has(k) && !/^aftercare_(notices|otp_sends)\./.test(k))).toEqual(["visits.visits_aftercare"]);
    expect(triggersAfter.get("visits.visits_aftercare")).toMatch(/AFTER UPDATE OF closed_at ON public\.visits FOR EACH ROW EXECUTE FUNCTION visit_aftercare\(\) A$/);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
    expect([...checksAfter.keys()].filter((k) => !checksBefore.has(k) && !/^aftercare_(notices|otp_sends)\./.test(k))).toEqual([]);
  });
});
