// Jurnal & Buku Besar (UX-22 ▸ Buku Besar, PR-26, T-105): the page reader (statements + journal), the journal export route and the finance
// actions (manual journal, Kunci Periode). Each run seeds in B a manual journal with a unique memo and amount through B's own finance; then runs
// as the caller's own owner and finance: B's memo, amount and entries are absent from the report and the journal, a filter on B's branch is
// not found, the export never contains B's rows (and is refused fail-closed anyway), and a manual journal or period lock written by the
// caller lands only in the caller's tenant. As B's staff (positive control) everything shows B's data and succeeds. Synthetic data.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { exportJournal, journal, lockPeriod, postManual, report } from "../../../src/modules/accounting/ledger/ledger";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "owner" | "finance";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.gl105.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Buku Besar ${role}` });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, role, fn);

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const period = () => ({ from: `${today().slice(0, 8)}01`, to: today() });
let runs = 0;
type Seed = { memo: string; amount: number; entry: string };
const latest = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const n = ++runs;
  const amount = 917_000 + n;
  const memo = `Jurnal rahasia ${t.slice(0, 8)} ${n}`;
  const { entryId } = await as(env, t, "finance", (db) => postManual(db, crypto.randomUUID(), { date: today(), memo,
    lines: [{ account: "branch_expense", debit: amount }, { account: "bank", credit: amount }] }));
  for (const x of [memo, entryId, String(amount)]) env.victimSecret(x);
  const r = { memo, amount, entry: entryId };
  latest.set(t, r);
  return r;
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.memo ?? "";
const amountMarker = (env: IsolationEnv) => String(latest.get(env.victim.tenantId)?.amount ?? "");
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route", id: "/keuangan/buku-besar", expect: "filtered", marker,
    async run(env) {
      await victim(env);
      const owner = await asMine(env, "owner", (db) => journal(db as never, period()));
      const finance = await asMine(env, "finance", (db) => journal(db as never, period()));
      const statements = await asMine(env, "finance", (db) => report(db as never, period()));
      const other = await asMine(env, "finance", (db) => report(db as never, { ...period(), branchId: env.victim.branchId }).then((x) => x, () => null));
      return ok({ owner, finance, statements, other: env.actor.tenantId === env.victim.tenantId ? null : other });
    },
  },
  {
    kind: "route", id: "/keuangan/buku-besar/ekspor#route", expect: "filtered", marker: amountMarker,
    async run(env) {
      await victim(env);
      // fail-closed in T-105 (no activation): the export is refused for every tenant; the trial balance carries the amounts instead
      const exported = await asMine(env, "finance", (db) => exportJournal(db as never, period()));
      // the rows an export would carry (date, account, debit, credit) come from the journal lines; their amounts are the marker
      const lines = await asMine(env, "finance", (db) => journal(db as never, period()).then((j) => j.entries.flatMap((e) => e.lines.map((l) => [e.business_date, l.account, l.debit, l.credit]))));
      return ok({ exported, lines });
    },
  },
  {
    kind: "action",
    id: "app/(app)/keuangan/buku-besar/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = crypto.randomUUID();
      const mine = env.actor.tenantId === env.victim.tenantId;
      const attempts = {
        manual: await outcome(asMine(env, "finance", (db) => postManual(db as never, k, { date: today(), memo: "Jurnal lintas tenant uji",
          lines: [{ account: "branch_expense", debit: 1_000 }, { account: "bank", credit: 1_000 }] }))),
        lock: await outcome(asMine(env, "finance", (db) => lockPeriod(db as never, crypto.randomUUID(), "2025-01"))),
      };
      const inB = (await env.owner.query(`select count(*)::int c from journal_entries where tenant_id = $1 and posting_key = $2`, [env.victim.tenantId, `manual:${k}`])).rows[0].c;
      const read = await asMine(env, "finance", (db) => journal(db as never, period()).then((j) => j.entries.map((e) => e.memo)));
      return {
        attempts: mine ? { ...attempts, lock: attempts.lock === "ERR_VERSION_CONFLICT" ? "done" : attempts.lock } : { manual: inB === 0 ? "not_seen" : "done", lock: "not_seen" },
        body: { read, seen: read.includes(v.memo) ? v.memo : null },
      };
    },
  },
);
