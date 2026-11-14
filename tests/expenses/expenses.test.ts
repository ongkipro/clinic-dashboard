// T-084 Done-when: scenario PR-79 (a petty-cash expense with a receipt photo recorded for branch B1 is in B1's expenses for that period)
// and "an unpaid expense creates one payable document". Plus the plan and its reviews: the expense invoice paired with its expense at
// commit (both ways), paid through the supplier payment flow and then not reversible, the reversal of both together, the receipt checked
// by its bytes, the recorders (owner, finance, a manager at the active branch) and readers (no Admin Pusat or purchasing; the receipt bytes
// never granted), the purchase invoices untouched, the branch totals, categories, tenants and replay. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { expenseBranchTotals, expenseReceipt, listExpenses, recordExpense, reverseExpense, saveExpenseCategory } from "../../src/modules/expenses/expenses";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { recordPayment, reversePayable } from "../../src/modules/purchasing/payables/payables";
import { saveSupplier } from "../../src/modules/purchasing/suppliers/suppliers";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Biaya Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("BY1"), b2: await br("BY2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`bya${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Biaya ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const wib = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
function png(seed = 0): Buffer {
  const b = Buffer.alloc(96);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(480, 20);
  b.writeUInt32BE(seed, 40);
  return b;
}
const receipt = (seed = 0) => ({ fileName: `nota-${seed}.png`, content: png(seed) });

let A: T; let B: T;
let OWN: P; let FIN: P; let MGR: P; let MGR2: P; let AU: P; let AP: P; let PUR: P; let FO: P; let BOWN: P;
let catTransport: string; let catOff: string; let SUP: string; let SUP_OFF: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor"); AP = await person(A, "admin_pusat");
  PUR = await person(A, "purchasing"); MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2); FO = await person(A, "fo_cashier", A.b1);
  BOWN = await person(B, "owner");
  catTransport = (await as(FIN, (db) => saveExpenseCategory(db, key(), null, { name: "Transportasi" }))).categoryId;
  catOff = (await as(OWN, (db) => saveExpenseCategory(db, key(), null, { name: "Kategori Lama" }))).categoryId;
  await as(OWN, (db) => saveExpenseCategory(db, key(), catOff, { name: "Kategori Lama", active: false }));
  SUP = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "CV Servis AC", paymentTermsDays: 14 }))).supplierId;
  SUP_OFF = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "CV Tutup", paymentTermsDays: 7 }))).supplierId;
  await h.admin.query(`update suppliers set active = false where id = $1`, [SUP_OFF]);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

const rec = (by: P, e: Partial<Parameters<typeof recordExpense>[3]> & { funding: "petty_cash" | "cash" | "bank" | "unpaid" }, branch: string | null = A.b1) =>
  as(by, (db) => recordExpense(db, key(), by.role === "manager" ? null : branch, { categoryId: catTransport, businessDate: today(), amount: 150_000, description: "Bensin kurir", ...e }));
const exp = async (id: string) => (await h.admin.query(`select * from expenses where id = $1`, [id])).rows[0];
const invOf = async (id: string) => (await h.admin.query(`select * from supplier_invoices where expense_id = $1`, [id])).rows;

describe("scenario PR-79 expense", () => {
  it("a petty-cash expense with a receipt photo recorded for B1 is in B1's expenses for that period (and not in B2's, nor once reversed)", async () => {
    const { expenseId } = await rec(MGR, { funding: "petty_cash", amount: 85_000, receipt: receipt(1) });
    const e = await exp(expenseId);
    expect([e.branch_id, e.funding, e.receipt_media_type, Number(e.receipt_size)]).toEqual([A.b1, "petty_cash", "image/png", 96]);
    const totals = await as(FIN, (db) => expenseBranchTotals(db, today(), today()));
    const b1 = totals.filter((t) => t.branch_id === A.b1).reduce((s, t) => s + Number(t.amount), 0);
    expect(b1).toBeGreaterThanOrEqual(85_000);
    expect(totals.find((t) => t.branch_id === A.b2)).toBeUndefined();
    // outside the period
    expect((await as(FIN, (db) => expenseBranchTotals(db, wib(-10), wib(-5))))).toEqual([]);
    // the receipt reads back for the readers; the bytes are never granted directly
    const r = await as(FIN, (db) => expenseReceipt(db, expenseId));
    expect([r.media_type, Buffer.compare(r.content, png(1))]).toEqual(["image/png", 0]);
    expect(await as(FIN, (db) => db.query(`select receipt_content from expenses where id = $1`, [expenseId])).then(() => "ok", (x) => x.code)).toBe("42501");
    // a reversed expense leaves the totals
    const before = b1;
    await as(OWN, (db) => reverseExpense(db, key(), expenseId, "Salah catat"));
    const after = (await as(FIN, (db) => expenseBranchTotals(db, today(), today()))).filter((t) => t.branch_id === A.b1).reduce((s, t) => s + Number(t.amount), 0);
    expect(before - after).toBe(85_000);
  });
});

describe("an unpaid expense creates one payable document", () => {
  it("unpaid → exactly one expense invoice (supplier, total, due date by terms); replay creates none more; the pairing holds both ways", async () => {
    const k = key();
    const r1 = await as(FIN, (db) => recordExpense(db, k, A.b1, { categoryId: catTransport, businessDate: today(), amount: 750_000, funding: "unpaid", description: "Servis AC ruang tindakan", supplierId: SUP }));
    await as(FIN, (db) => recordExpense(db, k, A.b1, { categoryId: catTransport, businessDate: today(), amount: 750_000, funding: "unpaid", description: "Servis AC ruang tindakan", supplierId: SUP }));
    const inv = await invOf(r1.expenseId);
    expect(inv).toHaveLength(1);
    expect([inv[0].kind, inv[0].supplier_id, Number(inv[0].total), inv[0].state, inv[0].due_date, inv[0].recorded_as]).toEqual(["expense", SUP, 750_000, "open", wib(14), "finance"]);
    expect(inv[0].number).toBe(`EXP-${r1.expenseId.replace(/-/g, "").toUpperCase()}`);
    // a second invoice for the same expense: the unique index
    expect(await raw(`insert into supplier_invoices (tenant_id, branch_id, supplier_id, kind, expense_id, number, invoice_date, due_date, total, command_key, recorded_by, recorded_as)
       values ($1, $2, $3, 'expense', $4, 'X-2', $5, $5, 750000, 'k-dup-exp-1', $6, 'finance')`, [A.tenantId, A.b1, SUP, r1.expenseId, today(), FIN.staffId])).toBe("raw:23505");
    // an unpaid expense without its invoice is refused at commit (the deferred check)
    expect(await raw(`insert into expenses (tenant_id, branch_id, category_id, business_date, amount, funding, description, supplier_id, command_key, recorded_by, recorded_as)
       values ($1, $2, $3, $4, 1000, 'unpaid', 'Tanpa faktur', $5, 'k-noinv-01', $6, 'finance')`, [A.tenantId, A.b1, catTransport, today(), SUP, FIN.staffId])).toBe("raw:42501");
    // a manager and the owner record unpaid expenses too (r1 P1-1)
    const rm = await rec(MGR, { funding: "unpaid", supplierId: SUP, amount: 120_000 });
    const ro = await rec(OWN, { funding: "unpaid", supplierId: SUP, amount: 130_000, supplierInvoiceNumber: "INV/AC/77" });
    expect([(await invOf(rm.expenseId))[0].recorded_as, (await invOf(ro.expenseId))[0].number]).toEqual(["manager", "INV/AC/77"]);
  });

  it("paid through the supplier payment flow (never a second expense); a paid expense cannot be reversed; an unpaid one reverses with its invoice", async () => {
    const r1 = await rec(FIN, { funding: "unpaid", supplierId: SUP, amount: 400_000 });
    const invId = (await invOf(r1.expenseId))[0].id as string;
    expect(await why(as(FIN, (db) => reversePayable(db, key(), "invoice", invId, "Coba balik langsung")))).toBe("ERR_VERSION_CONFLICT:expense_invoice");
    await as(FIN, (db) => recordPayment(db, key(), A.b1, { supplierId: SUP, amount: 400_000, method: "bank_transfer", paidOn: today(), allocations: [{ invoiceId: invId }] }));
    expect((await invOf(r1.expenseId))[0].state).toBe("paid");
    expect((await h.admin.query(`select count(*)::int c from expenses where description = 'Bensin kurir' and amount = 400000 and tenant_id = $1`, [A.tenantId])).rows[0].c).toBe(1);
    expect(await why(as(FIN, (db) => reverseExpense(db, key(), r1.expenseId, "Batal")))).toBe("ERR_VERSION_CONFLICT:expense_paid");
    const r2 = await rec(FIN, { funding: "unpaid", supplierId: SUP, amount: 90_000 });
    await as(FIN, (db) => reverseExpense(db, key(), r2.expenseId, "Salah pemasok"));
    expect([(await exp(r2.expenseId)).state, (await invOf(r2.expenseId))[0].state]).toEqual(["reversed", "reversed"]);
    expect(await why(as(FIN, (db) => reverseExpense(db, key(), r2.expenseId, "Lagi")))).toBe("ERR_VERSION_CONFLICT:expense_reversed");
    const ev = (await h.admin.query(`select type from domain_events where aggregate_id = $1 order by occurred_at, id`, [r2.expenseId])).rows.map((x) => x.type).sort();
    expect(ev).toEqual(["ExpenseRecorded", "ExpenseReversed"]);
  });
});

describe("database invariants behind the writers (mutation-proven)", () => {
  it("an expense invoice must equal its expense at commit; a direct replay by key returns the same expense; a reversal cannot change the content", async () => {
    // (1) the pairing check compares the amount: a matching direct pair commits, a total off by one is refused at commit.
    const pair = async (total: number) => {
      const c = await owner.connect();
      try {
        await c.query("begin");
        const e = (await c.query(`insert into expenses (tenant_id, branch_id, category_id, business_date, amount, funding, description, supplier_id, command_key, recorded_by, recorded_as)
           values ($1, $2, $3, $4, 5000, 'unpaid', 'Pasangan langsung', $5, $6, $7, 'finance') returning id`, [A.tenantId, A.b1, catTransport, today(), SUP, `k-pair-${key()}`, FIN.staffId])).rows[0].id;
        await c.query(`insert into supplier_invoices (tenant_id, branch_id, supplier_id, kind, expense_id, number, invoice_date, due_date, total, command_key, recorded_by, recorded_as)
           values ($1, $2, $3, 'expense', $4, $5, $6, $6, $7, $8, $9, 'finance')`, [A.tenantId, A.b1, SUP, e, `P-${key()}`, today(), total, `k-pinv-${key()}`, FIN.staffId]);
        await c.query("commit");
        return "ok";
      } catch (x) {
        await c.query("rollback").catch(() => undefined);
        return `raw:${(x as { code?: string }).code}`;
      } finally {
        c.release();
      }
    };
    expect(await pair(5000)).toBe("ok");
    expect(await pair(5001)).toBe("raw:42501");
    // (2) the definer's own replay (below runCommand): the same key twice returns the same expense, nothing new.
    const k = key();
    const call = () => as(FIN, (db) => db.query(`select expense_record($1, $2, $3::jsonb, null) as r`, [k, A.b1,
      JSON.stringify({ category_id: catTransport, business_date: today(), amount: 4321, funding: "bank", description: "Ulang kunci" })]).then((r) => r.rows[0].r as string));
    const first = await call();
    expect(await call()).toBe(first);
    expect((await h.admin.query(`select count(*)::int c from expenses where tenant_id = $1 and command_key = $2`, [A.tenantId, k])).rows[0].c).toBe(1);
    // (3) the guard: a reversal that also changes the amount is refused; the plain reversal shape passes.
    const rev = (extra: string) => raw(`update expenses set state = 'reversed', reversed_at = now(), reversed_by = $2, reversed_as = 'finance', reverse_reason = 'Uji'${extra} where id = $1`, [first, FIN.staffId]);
    expect(await rev(", amount = 1")).toBe("raw:42501");
    expect(await rev("")).toBe("ok");
  });
});

describe("validation, roles, readers, tenants", () => {
  it("refusals: receipt required for petty cash and cash; a receipt whose bytes are not an image/PDF; supplier needed for unpaid; inactive category or supplier; future date", async () => {
    expect(await why(rec(FIN, { funding: "cash" }))).toBe("ERR_INVALID_INPUT:receipt_required");
    expect(await why(rec(FIN, { funding: "bank" }))).toBe("ok");
    expect(await why(rec(FIN, { funding: "unpaid" }))).toBe("ERR_INVALID_INPUT:supplier_required");
    expect(await why(rec(FIN, { funding: "unpaid", supplierId: SUP_OFF }))).toBe("ERR_NOT_FOUND:supplier not found");
    expect(await why(rec(FIN, { funding: "bank", categoryId: catOff }))).toBe("ERR_NOT_FOUND:category not found");
    expect(await why(rec(FIN, { funding: "bank", businessDate: wib(2) }))).toBe("ERR_INVALID_INPUT:business_date");
    // the TS layer refuses non-image bytes; the database refuses them too (a direct call with a lying media type)
    expect(await why(rec(FIN, { funding: "cash", receipt: { fileName: "x.txt", content: Buffer.from("bukan gambar") } }))).toBe("ERR_INVALID_INPUT:receipt");
    const fake = Buffer.from("bukan gambar sama sekali");
    const sha = (await import("node:crypto")).createHash("sha256").update(fake).digest("hex");
    expect(await as(FIN, (db) => db.query(`select expense_record($1, $2, $3::jsonb, $4)`, [key(), A.b1, JSON.stringify({ category_id: catTransport,
      business_date: today(), amount: 1000, funding: "cash", description: "Nota palsu", receipt_file_name: "x.png", receipt_media_type: "image/png",
      receipt_size: String(fake.length), receipt_sha256: sha }), fake]).then(() => "ok", (e) => e.message))).toMatch(/ERR_INVALID_INPUT: receipt/);
  });

  it("recorders: owner, finance, a manager at the active branch only; readers: owner, finance, auditor, the manager's branch; not Admin Pusat, purchasing or FO", async () => {
    for (const p of [AU, AP, PUR, FO]) expect(await why(rec(p, { funding: "bank" })), p.role).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(as(MGR, (db) => recordExpense(db, key(), A.b2, { categoryId: catTransport, businessDate: today(), amount: 1, funding: "bank", description: "Cabang lain" }))))
      .toMatch(/^ERR_FORBIDDEN/);
    const r2 = await rec(MGR2, { funding: "bank", amount: 333_000 });
    expect((await exp(r2.expenseId)).branch_id).toBe(A.b2);
    const l1 = await as(MGR, (db) => listExpenses(db, { from: today(), to: today() }));
    expect(l1.rows.some((x) => x.id === r2.expenseId)).toBe(false);
    expect((await as(AU, (db) => listExpenses(db, { from: today(), to: today() }))).rows.some((x) => x.id === r2.expenseId)).toBe(true);
    for (const p of [AP, PUR, FO]) expect(await why(as(p, (db) => listExpenses(db, { from: today(), to: today() }))), p.role).toMatch(/^ERR_FORBIDDEN/);
    const seen = async (p: P) => (await as(p, (db) => db.query(`select count(*)::int c from expenses where id = $1`, [r2.expenseId]))).rows[0].c;
    expect([await seen(OWN), await seen(FIN), await seen(AU), await seen(MGR2), await seen(MGR), await seen(AP), await seen(PUR)]).toEqual([1, 1, 1, 1, 0, 0, 0]);
    expect(await why(as(MGR, (db) => reverseExpense(db, key(), r2.expenseId, "Coba")))).toMatch(/^ERR_FORBIDDEN/);
  });

  it("categories: owner and finance only; unique names; never deleted; tenants: B sees nothing of A and cannot reverse A's expense", async () => {
    expect(await why(as(MGR, (db) => saveExpenseCategory(db, key(), null, { name: "Listrik" })))).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(as(FIN, (db) => saveExpenseCategory(db, key(), null, { name: "transportasi" })))).toBe("ERR_VERSION_CONFLICT:category_name_taken");
    expect(await raw(`delete from expense_categories where id = $1`, [catTransport])).toBe("raw:42501");
    const r = await rec(FIN, { funding: "bank", amount: 10_000 });
    expect(await raw(`delete from expenses where id = $1`, [r.expenseId])).toBe("raw:42501");
    expect(await raw(`update expenses set amount = 1 where id = $1`, [r.expenseId])).toBe("raw:42501");
    expect(await why(as(BOWN, (db) => reverseExpense(db, key(), r.expenseId, "Lintas")))).toBe("ERR_NOT_FOUND:expense not found");
    expect((await as(BOWN, (db) => listExpenses(db, { from: today(), to: today() }))).rows).toEqual([]);
    expect(await why(as(BOWN, (db) => expenseReceipt(db, r.expenseId)))).toBe("ERR_NOT_FOUND:receipt not found");
  });
});
