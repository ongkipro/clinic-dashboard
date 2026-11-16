// T-100 drift check (plan r3 §5c, review r2 P2): migration 0115 adds campaign_segments and the campaign helpers / commands / readers, and
// re-creates exactly: outbound_enqueue (one inserted block: the 'campaign' source refusal), outbound_claim (three inserted blocks: the
// declarations, the campaign-gate skip, the dispatch-time cap check) and campaigns_guard (the send-state rules). Every other existing
// function, policy, trigger and check is unchanged, except outbound_messages_check (two skip reasons and one deferred reason added) and the
// campaigns table grants (column grants of the legacy tag columns). A database is migrated to exactly 0114, then to exactly 0115.
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

const INSERTED = {
 "enqueue": [
  "\n  -- T-100 (review r1 P1-2 c): a campaign enters the queue only through campaign_send (the Q-15 gate); the generic writer refuses it\n  IF p ->> 'source_kind' = 'campaign' THEN\n    RAISE EXCEPTION 'ERR_INVALID_INPUT: campaign_source' USING ERRCODE = '22023';\n  END IF;"
 ],
 "claim": [
  "\n  v_tz text;\n  v_cap integer;\n  v_defer date;",
  "\n      -- T-100 (review r1 P1-2 d): a campaign message whose Q-15 evidence is no longer approved (revoked, expired) is not sent\n      IF o.purpose = 'promo' AND o.source_kind = 'campaign' AND NOT public.campaign_gate_open(o.tenant_id) THEN\n        UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'campaign_locked', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;\n        INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)\n        VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,\n                jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'campaign_locked'));\n        CONTINUE;\n      END IF;",
  "\n      -- T-100 (plan r3 \u00a75b): the per-patient daily cap at dispatch (every promo): under the patient's cap lock (after staff_access), today's\n      -- count without this row = automation_cap_count(today, today) \u2212 1 (sending/sent today plus due/overdue queued rows, care included).\n      -- At the cap \u2192 deferred to the first day with room in today+1 \u2026 today+7 (cap_reached), else skipped cap_horizon_exceeded.\n      IF o.category = 'marketing' THEN\n        PERFORM public.automation_cap_lock(o.tenant_id, o.patient_id);\n        v_tz := coalesce((SELECT b.timezone FROM public.branches b WHERE b.tenant_id = o.tenant_id AND b.id = o.branch_id), 'Asia/Jakarta');\n        v_cap := (public.followup_setting(o.tenant_id, 'SET-19', v_now) ->> 'batas_harian')::integer;\n        IF public.automation_cap_count(o.tenant_id, o.patient_id, v_today, v_today, v_tz) - 1 >= v_cap THEN\n          v_defer := public.outbound_cap_defer_day(o.tenant_id, o.patient_id, v_today, v_cap, v_tz);\n          IF v_defer IS NULL THEN\n            UPDATE public.outbound_messages SET state = 'skipped', skip_reason = 'cap_horizon_exceeded', decided_at = v_now WHERE tenant_id = o.tenant_id AND id = o.id;\n            INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, occurred_at, payload)\n            VALUES (o.tenant_id, o.branch_id, 'OutboundMessageSkipped', 'outbound_message', o.id, NULL, NULL, v_now,\n                    jsonb_build_object('outbound_id', o.id, 'patient_id', o.patient_id, 'purpose', o.purpose, 'skip_reason', 'cap_horizon_exceeded'));\n          ELSE\n            UPDATE public.outbound_messages SET planned_for = v_defer, rescheduled_count = rescheduled_count + 1, deferred_reason = 'cap_reached'\n             WHERE tenant_id = o.tenant_id AND id = o.id;\n          END IF;\n          CONTINUE;\n        END IF;\n      END IF;"
 ]
} as const;

beforeAll(async () => {
  const toBefore = migrationsUpTo("0114_waitlist");
  const toAfter = migrationsUpTo("0115_campaigns");
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

const RECREATED = ["campaigns_guard()", "outbound_claim(timestamp with time zone)", "outbound_enqueue(text,jsonb)"];
const GRANTED = ["campaign_actor_check(text)", "campaign_schedule(uuid,jsonb)", "campaign_segment_preview(jsonb)", "campaign_segment_save(text,jsonb)",
  "campaign_send(uuid)", "campaign_unschedule(uuid,text)", "campaign_workspace_list()", "campaign_workspace_readable(uuid)"];
const DEFINERS = ["campaign_actor_check(text)", "campaign_schedule(uuid,jsonb)", "campaign_segment_preview(jsonb)", "campaign_segment_save(text,jsonb)",
  "campaign_send(uuid)", "campaign_unschedule(uuid,text)", "campaign_workspace_list()"];
// pg_get_functiondef renders the body as written between the dollar quotes; normalise trailing whitespace only
const norm = (s: string) => s.replace(/[ \t]+$/gm, "").trim();
const without = (def: string, blocks: readonly string[]) => blocks.reduce((d, b) => {
  expect(d.split(b).length - 1, b.slice(0, 60)).toBe(1);
  return d.replace(b, "");
}, def);

describe("T-100: the campaigns migration changes only the allowlist", () => {
  it("re-created bodies equal their reviewed 0109 / 0107 bodies plus exactly the allowlisted blocks; attributes and grants unchanged", () => {
    const enq = "outbound_enqueue(text,jsonb)", clm = "outbound_claim(timestamp with time zone)";
    expect(norm(without(after.get(enq)!.def, INSERTED.enqueue))).toBe(norm(before.get(enq)!.def));
    expect(norm(without(after.get(clm)!.def, INSERTED.claim))).toBe(norm(before.get(clm)!.def));
    for (const k of RECREATED) {
      const [a, b] = [after.get(k)!, before.get(k)!];
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    // campaigns_guard keeps its identity freeze verbatim and gains the send-state rules
    const g = after.get("campaigns_guard()")!.def;
    expect(g).toContain("IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.code, NEW.command_key, NEW.created_by, NEW.created_as, NEW.created_at)");
    expect(g).toContain("a campaign moves only along its send states");
  });

  it("no other existing function re-created or dropped; the new granted functions and definers are exactly the plan's", () => {
    const changed = [...after].filter(([k, a]) => before.has(k) && before.get(k)!.def !== a.def).map(([k]) => k).sort();
    expect(changed).toEqual([...RECREATED].sort());
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    expect(added.filter((k) => /clinic_app=X\//.test(after.get(k)!.acl ?? "")).sort()).toEqual(GRANTED);
    for (const k of added) expect(after.get(k)!.acl ?? "", k).not.toMatch(/clinic_(vendor|executor|operator)=X\//);
    expect(added.filter((k) => after.get(k)!.secdef).sort()).toEqual(DEFINERS);
    for (const k of DEFINERS) expect(after.get(k)!.config, k).toBe("search_path=pg_catalog, pg_temp");
  });

  it("outbound_messages_check widened by exactly campaign_locked, cap_horizon_exceeded and cap_reached; no other existing check, policy or trigger changed", () => {
    const k = "outbound_messages.outbound_messages_check";
    const narrowed = checksAfter.get(k)!.replace(", 'campaign_locked'::text, 'cap_horizon_exceeded'::text", "").replace(", 'cap_reached'::text", "");
    expect(narrowed).toBe(checksBefore.get(k));
    expect(checksAfter.get(k)).toContain("'campaign_locked'::text, 'cap_horizon_exceeded'::text");
    expect(checksAfter.get(k)).toContain("'cap_reached'::text");
    expect([...checksBefore.keys()].filter((x) => x !== k && checksAfter.get(x) !== checksBefore.get(x))).toEqual([]);
    for (const [x, v] of policiesBefore) expect(policiesAfter.get(x), x).toBe(v);
    for (const [x, v] of triggersBefore) expect(triggersAfter.get(x), x).toBe(v);
    expect([...triggersAfter.keys()].filter((x) => !triggersBefore.has(x)).sort()).toEqual(["campaign_segments.campaign_segments_guard", "campaign_segments.campaign_segments_no_truncate"]);
  });

  it("campaigns: the app and the operator read only the legacy tag columns (no table-wide SELECT)", async () => {
    const r = (await h.admin.query(`select grantee, privilege_type, column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'campaigns' and grantee in ('clinic_app','clinic_operator') and privilege_type = 'SELECT' order by 1, 3`)).rows;
    const cols = ["active", "channel", "code", "command_key", "created_as", "created_at", "created_by", "id", "name", "tenant_id", "updated_at"];
    for (const g of ["clinic_app", "clinic_operator"]) expect(r.filter((x) => x.grantee === g).map((x) => x.column_name).sort()).toEqual(cols);
    expect((await h.admin.query(`select count(*)::int n from information_schema.table_privileges where table_schema = 'public' and table_name = 'campaigns'
      and grantee in ('clinic_app','clinic_operator') and privilege_type = 'SELECT'`)).rows[0].n).toBe(0);
  });
});
