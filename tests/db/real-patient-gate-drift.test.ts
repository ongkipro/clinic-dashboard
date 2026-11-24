// T-120 drift check (PR-36, ARCH-10, HYG-024 fold-in; R4):
// Migration 0133_real_patient_gate re-creates exactly five existing functions — vendor_go_live_blockers,
// patient_register, booking_create, booking_confirm, deposit_receive — each gaining ONE marked block
// (`-- T-120 ARCH-10 >> ... <<`), preserving signature, volatility, SECURITY DEFINER, search_path, and ACL.
// Stripping the marked block restores the exact 0132 definition line-for-line. Every other existing function
// and RLS policy remains byte-identical; the only existing constraint changed is vendor_profile_residency_check
// (adds 'inconclusive'). Only real_patient_gate_status() is granted to clinic_app; residency_attest and internal
// helpers have zero runtime grants.
import { rmSync } from "node:fs";
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

const CHANGED = [
  "booking_confirm(uuid)",
  "booking_create(uuid,uuid,uuid,timestamp with time zone,uuid,text,text,text,text,boolean)",
  "deposit_receive(text,uuid,jsonb)",
  "patient_register(jsonb,text,text,text)",
  "vendor_go_live_blockers()",
];

const ADDED = [
  "real_patient_gate(uuid)",
  "real_patient_gate_assert(uuid)",
  "real_patient_gate_status()",
  "residency_attest(jsonb,text,text)",
  "residency_config_digest()",
  "residency_is_production()",
  "residency_release_digest()",
];

const strip = (def: string) => def.replace(/^ {2}-- T-120 ARCH-10 >>\n[\s\S]*?^ {2}-- T-120 ARCH-10 <<\n/m, "");

beforeAll(async () => {
  const toBefore = migrationsUpTo("0132_digest_support_class");
  const toAfter = migrationsUpTo("0133_real_patient_gate");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); }, platformEnv: null });
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

describe("T-120: migration 0133_real_patient_gate bounded drift", () => {
  it("re-creates exactly the 5 functions (attributes and ACL kept), adds only the 7 residency functions, drops nothing", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({
        k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl,
      });
    }
    expect(changed.sort()).toEqual(CHANGED);
    expect([...after.keys()].filter((k) => !before.has(k)).sort()).toEqual(ADDED);
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);

    for (const k of CHANGED) {
      expect(strip(after.get(k)!.def), `${k} stripped`).toBe(before.get(k)!.def);
    }

    // Grants on added functions: ONLY real_patient_gate_status() granted to clinic_app; zero grants on all others.
    for (const k of ADDED) {
      const acl = after.get(k)!.acl ?? "";
      if (k === "real_patient_gate_status()") {
        expect(acl).toContain("clinic_app=X");
        expect(acl).not.toContain("clinic_vendor=X");
        expect(acl).not.toContain("clinic_operator=X");
      } else {
        expect(acl, `${k} must have no runtime execute grant`).not.toContain("clinic_app=X");
        expect(acl, `${k} must have no vendor execute grant`).not.toContain("clinic_vendor=X");
        expect(acl, `${k} must have no operator execute grant`).not.toContain("clinic_operator=X");
      }
    }
  });

  it("changes no existing RLS policy and changes only vendor_profile_residency_check among existing constraints", () => {
    expect([...policiesAfter.entries()].sort()).toEqual([...policiesBefore.entries()].sort());

    const changedChecks: string[] = [];
    for (const [k, v] of checksAfter) {
      const prev = checksBefore.get(k);
      if (prev && prev !== v) changedChecks.push(k);
    }
    expect(changedChecks).toEqual(["vendor_profile.vendor_profile_residency_check"]);
    expect(checksAfter.get("vendor_profile.vendor_profile_residency_check")).toContain("'inconclusive'::text");
  });
});
