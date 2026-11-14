// Biaya Operasional & Kas Kecil (UX-22 ▸ Biaya, PR-79, T-084): the list, one expense, the receipt route and the actions. Each run
// seeds in B a category, a petty-cash expense with its receipt and an unpaid expense (its supplier invoice), through B's own finance;
// then runs as the caller's own owner and manager: B's rows are absent from the list, B's expense and receipt are not found, and every
// write on B's rows is refused. As B's staff (positive control) everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { expenseBranchTotals, expenseReceipt, listExpenses, recordExpense, reverseExpense, saveExpenseCategory } from "../../../src/modules/expenses/expenses";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { saveSupplier } from "../../../src/modules/purchasing/suppliers/suppliers";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "owner" | "finance" | "manager" | "purchasing";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.bya84.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Biaya ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "manager") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "manager" ? branchId : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
function png(seed: number): Buffer {
  const b = Buffer.alloc(96);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(480, 20);
  b.writeUInt32BE(seed, 40);
  return b;
}
let runs = 0;
type Seed = { description: string; category: string; expense: string; unpaid: string };
const latest = new Map<string, Seed>();
const cats = new Map<string, { category: string; supplier: string }>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let c = cats.get(t);
  if (!c) {
    const category = (await as(env, t, b, "finance", (db) => saveExpenseCategory(db, k(), null, { name: `Biaya Rahasia ${t.slice(0, 8)}` }))).categoryId;
    const supplier = (await as(env, t, b, "purchasing", (db) => saveSupplier(db, k(), null, { name: `Pemasok Rahasia Biaya ${t.slice(0, 8)}`, paymentTermsDays: 14 }))).supplierId;
    c = { category, supplier };
    cats.set(t, c);
  }
  const description = `Biaya rahasia B ${t.slice(0, 8)} ${n}`;
  const expense = (await as(env, t, b, "finance", (db) => recordExpense(db, k(), b, { categoryId: c!.category, businessDate: today(), amount: 77_000 + n,
    funding: "petty_cash", description, receipt: { fileName: "nota-b.png", content: png(n) } }))).expenseId;
  const unpaid = (await as(env, t, b, "finance", (db) => recordExpense(db, k(), b, { categoryId: c!.category, businessDate: today(), amount: 88_000 + n,
    funding: "unpaid", description: `${description} utang`, supplierId: c!.supplier }))).expenseId;
  for (const x of [description, expense, unpaid]) env.victimSecret(x);
  const r = { description, category: c.category, expense, unpaid };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.description ?? "";
const idMarker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.expense ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const notFound = (e: unknown) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e));
const route = (id: string, expect: "filtered" | "not-found", m: (env: IsolationEnv) => string, run: (env: IsolationEnv, v: Seed) => Promise<{ status: number; body: unknown }>) =>
  ({ kind: "route" as const, id, expect, marker: m, async run(env: IsolationEnv) { const v = await victim(env); return run(env, v) as never; } });
const period = () => ({ from: today(), to: today() });

export default defineCases(
  // The list of the caller's owner (tenant-wide) and branch totals; the manager's list at the active branch.
  route("/keuangan/biaya", "filtered", marker, async (env) => {
    const owner = await asMine(env, "owner", async (db) => ({ list: await listExpenses(db as never, period()), totals: await expenseBranchTotals(db as never, today(), today()) }));
    const manager = await asMine(env, "manager", (db) => listExpenses(db as never, period()));
    return ok({ ...owner, manager });
  }),
  // One expense reads through the list of its date; the caller's list never holds B's row (a missing row is a 404).
  route("/keuangan/biaya/[id]", "not-found", marker, (env, v) => asMine(env, "owner", (db) => listExpenses(db as never, period())
    .then((d) => (d.rows.find((x) => x.id === v.expense) ? ok(d.rows.find((x) => x.id === v.expense)) : { status: 404, body: null })))),
  route("/keuangan/biaya/bukti/[id]#route", "not-found", idMarker, (env, v) => asMine(env, "owner", (db) => expenseReceipt(db as never, v.expense)
    .then((f) => (f ? { status: 200, body: { expense: v.expense, size: f.content.length } } : { status: 404, body: null }), notFound))),
  {
    kind: "action",
    id: "app/(app)/keuangan/biaya/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      await expectLive(env, "B's petty-cash expense", `exists (select 1 from expenses where id = $1 and state = 'recorded')`, [v.expense]);
      await expectLive(env, "B's unpaid expense", `exists (select 1 from expenses where id = $1 and state = 'recorded')`, [v.unpaid]);
      const attempts = {
        // B's category in the caller's own branch: refused (not found), never an expense of A in B's category.
        record: await outcome(asMine(env, "owner", (db) => recordExpense(db as never, k(), env.actor.branchId, { categoryId: v.category, businessDate: today(),
          amount: 1_000, funding: "bank", description: "Coba lintas kategori" }))),
        // The caller's owner naming B's branch.
        recordBranch: await outcome(asMine(env, "owner", (db) => recordExpense(db as never, k(), env.victim.branchId, { categoryId: v.category, businessDate: today(),
          amount: 1_000, funding: "bank", description: "Coba lintas cabang" }))),
        reverse: await outcome(asMine(env, "owner", (db) => reverseExpense(db as never, k(), v.expense, "Coba lintas"))),
        reverseUnpaid: await outcome(asMine(env, "owner", (db) => reverseExpense(db as never, k(), v.unpaid, "Coba lintas utang"))),
        category: await outcome(asMine(env, "owner", (db) => saveExpenseCategory(db as never, k(), v.category, { name: "Coba Lintas" }))),
      };
      const read = await asMine(env, "owner", (db) => listExpenses(db as never, period()).then((d) => d.rows.find((x) => x.id === v.expense)?.description ?? null, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
