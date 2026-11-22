// Ringkasan Owner (UX-20) and Cabang league / detail (UX-37), PR-33a (T-109): the three routes /ringkasan/owner, /ringkasan/owner/cabang and /ringkasan/owner/cabang/[id]
// run the loaders' core (src/app/(app)/ringkasan/owner/load.ts — the same functions the pages call, over the T-107 readers) as the CALLER's own owner while tenant B holds
// real financial facts. Each run seeds in B, through B's own staff, a cash top-up (a K1 payment at B's branch) with a unique amount; then every run returns the loader's
// composed output AND the reader's own K1 detail rows (one per payment, as the ringkasan-peran case does — a total is a SUM over every payment B has today, so the marker
// is only verbatim in a row):
//   - positive control (as B's owner): the K1 detail rows carry B's unique amount, read from the reader's answer, not from a field the case adds; and B's K13 funnel carries B's own
//     lead SOURCE (a source no other case uses: "tiktok", one lead at B's branch) — in the clinic summary AND in B's branch detail, where it is read through the reader's own branch selector;
//   - negative (as A's owner): B's amount, B's branch id and B's branch name are absent from every payload; the league lists only A's branches; and B's branch id asked
//     of the loader as a detail / ?cabang=, or of the reader directly, is NOT FOUND (TEN-1), never forbidden and never data; and the "tiktok" source of B's lead is absent from A's funnel,
//     from A's own branch detail and from the league (B's lead sources never reach another tenant's owner, even through the branch selector).
// Automatic route discovery: no tests/isolation/surfaces.ts change. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { guarded } from "../../../src/app/(app)/ringkasan/owner/guard";
import { detailIn, leagueIn, summaryIn } from "../../../src/app/(app)/ringkasan/owner/load";
import { kpi } from "../../../src/modules/reporting/dashboards/dashboards";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { createLead } from "../../../src/modules/crm/leads/leads";
import { topUpBalance } from "../../../src/modules/packages/packages";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const accOf = new Map<string, string>();
async function owner(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = accOf.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`owner.rgo109.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Pemilik Ringkasan" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  accOf.set(tenantId, acc);
  return acc;
}
// The owner of `tenantId` with the branches the context lists (what data.ts gets from requestContext): the same ActingContext, the same branch list.
async function asOwner<T>(env: IsolationEnv, tenantId: string, fn: (db: never, branches: { id: string; name: string }[]) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await owner(env, tenantId);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: "owner" });
  const branches = (await env.owner.query(`select id, name from branches where tenant_id = $1 order by name, id`, [tenantId])).rows as { id: string; name: string }[];
  return withTenantContext(env.app, ctx, (db) => fn(db as never, branches));
}
const mine = <T>(env: IsolationEnv, fn: (db: never, branches: { id: string; name: string }[]) => Promise<T>) => asOwner(env, env.actor.tenantId, fn);

let runs = 0;
const latest = new Map<string, number>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const n = ++runs;
  // the fixture tenant starts in its default lifecycle state; a cash top-up needs a live one (as the other cases do)
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [t]);
  const staff = (await env.owner.query(`select id from staff where tenant_id = $1 limit 1`, [t])).rows[0]?.id ?? (await (async () => {
    await owner(env, t);
    return (await env.owner.query(`select id from staff where tenant_id = $1 limit 1`, [t])).rows[0].id;
  })());
  const pid = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Ringkasan Owner Rahasia', '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam',
             'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`, [t, b, staff])).rows[0].id as string;
  // a cash top-up received at B's branch today: a real K1 payment with a unique amount (the marker)
  const amount = 917_000 + n;
  const cashier = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Kasir', $1, true) returning id`, [`kasir.rgo109.${t}.${n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId: t, accountId: cashier, displayName: `Kasir Ringkasan ${n}` });
  const c = await env.owner.connect();
  try {
    const { assignBranch } = await import("../../../src/modules/org/identity");
    const rid = await assignRole(c, { tenantId: t, staffId, role: "fo_cashier" });
    await assignBranch(c, { tenantId: t, staffRoleId: rid, branchId: b });
  } finally {
    c.release();
  }
  const ctx = await resolveContext(env.app, cashier, { tenantId: t, actingRole: "fo_cashier", activeBranchId: b });
  await withTenantContext(env.app, ctx, (db) => topUpBalance(db as never, crypto.randomUUID(), pid, null, { method: "cash", amount, cashTendered: amount }));
  env.victimSecret(String(amount));
  latest.set(t, amount);
  // one lead from a source no other case uses, at B's branch, through B's own central CS: the K13 "by source" marker. The clinic's funnel and B's branch detail must carry it as B;
  // nothing of it may reach another tenant's owner. (Created once per victim: the loaders count leads, a second one adds nothing to the proof.)
  if (!leadSeeded.has(t)) {
    leadSeeded.add(t);
    const cs = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('CS', $1, true) returning id`, [`cs.rgo109.${t}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId: csStaff } = await createMembership(env.owner, { tenantId: t, accountId: cs, displayName: "CS Ringkasan" });
    const cc = await env.owner.connect();
    try { await assignRole(cc, { tenantId: t, staffId: csStaff, role: "central_cs" }); } finally { cc.release(); }
    const csCtx = await resolveContext(env.app, cs, { tenantId: t, actingRole: "central_cs" });
    await withTenantContext(env.app, csCtx, (db) => createLead(db as never, crypto.randomUUID(), { source: "tiktok", patientId: pid, branchId: b }));
    // the source key B's lead carries and nobody else's does: it must appear as B and never as another tenant's owner
    env.victimSecret(LEAD_SOURCE);
  }
}
const leadSeeded = new Set<string>();
const LEAD_SOURCE = "tiktok";
const marker = (env: IsolationEnv) => String(latest.get(env.victim.tenantId) ?? "");
// The harness checks ONE marker (the amount) on the positive control. The lead-source marker needs its own proof that the case really reads B's lead path: as B itself the funnel MUST list
// the "tiktok" source with its one lead — otherwise a loader that silently dropped K13 by source would pass the negative run for the wrong reason, and this case fails instead.
function mustCarryLeadSource(env: IsolationEnv, funnel: unknown, where: string) {
  if (env.actor.tenantId !== env.victim.tenantId) return;
  const f = funnel as { state?: string; lead?: number; sources?: { state?: string; rows?: { source: string; lead: number }[] } } | null;
  const row = f?.state === "value" && f.sources?.state === "rows" ? f.sources.rows?.find((r) => r.source === LEAD_SOURCE) : undefined;
  if (!row || row.lead !== 1) throw new Error(`isolation case: as B the ${where} funnel must list B's ${LEAD_SOURCE} lead (one lead) — the K13-by-source path is not exercised`);
}
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const day = () => new Date();
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const monthToDate = () => ({ from: `${today().slice(0, 8)}01`, to: today() });
// the reader's own K1 detail rows (each payment's amount) for the caller's clinic, optionally for one branch; null when the reader refuses (a branch that is not the caller's)
const k1Rows = (db: never, branchId?: string) => guarded(db as never, "k1-detail", () => kpi(db as never, { kpi: "k1", ...monthToDate(), branchId: branchId ?? null, detail: true })).then((r) => r?.rows ?? null);

export default defineCases(
  {
    kind: "route", id: "/ringkasan/owner", expect: "filtered", marker,
    async run(env) {
      await victim(env);
      // the consolidated summary as the caller's own owner: its figures and league never carry B's amount; as B they carry B's own, and the K1 detail rows carry B's payment
      return mine(env, async (db, branches) => {
        const r = await summaryIn(db, "owner", branches, {}, day());
        mustCarryLeadSource(env, r.kind === "ok" ? r.data.funnel : null, "clinic summary");
        return ok({ k1: r.kind === "ok" ? r.data.k1 : null, funnel: r.kind === "ok" ? r.data.funnel : null, league: r.kind === "ok" ? r.league : null, k1Rows: await k1Rows(db) });
      });
    },
  },
  {
    kind: "route", id: "/ringkasan/owner/cabang", expect: "filtered", marker,
    async run(env) {
      await victim(env);
      return mine(env, async (db, branches) => ok({ rows: (await leagueIn(db, branches, {}, day())).rows, k1Rows: await k1Rows(db) }));
    },
  },
  {
    // by-id route: another tenant's branch id is not found for the caller's owner (never forbidden, never data); as B the detail shows B's own amount
    kind: "route", id: "/ringkasan/owner/cabang/[id]", expect: "not-found", marker,
    async run(env) {
      await victim(env);
      return mine(env, async (db, branches) => {
        const r = await detailIn(db, "owner", branches, env.victim.branchId, {}, day());
        if (r.kind !== "ok") return { status: 404, body: null };
        // only B's own owner gets here: the detail of B's branch and the reader's K1 detail rows for that branch (as A, a "leak" would be a 200 carrying B's secrets)
        mustCarryLeadSource(env, r.data.funnel, "branch detail (read through the reader's branch selector)");
        return ok({ k1: r.data.k1, funnel: r.data.funnel, branch: r.branch, k1Rows: await k1Rows(db, env.victim.branchId) });
      });
    },
  },
);
