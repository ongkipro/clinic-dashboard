// T-085 Done-when: shift close tests — a non-zero variance always waits for approval; above SET-13 it escalates (only the owner decides).
// Plus the plan and its reviews: payments stamped with the receiver's open shift (a counter payment auto-opens one at Rp0, a simulated or
// port payment never does, a supplied shift refused), Buka Kasir with a float, the per-tender expectation (cash = float + received − paid
// out; non-cash expected only), a cash refund paid in cash stamped as paid out, payments after close in a new shift, the routing (a
// manager decides within SET-13, never an escalated count; the requester never), rejection → Hitung Ulang, the manager closing a departed
// cashier's shift, readers (FO own only, manager branch, auditor masked), the guards, tenants, replay. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { inboxDetail, listInbox } from "../../src/modules/approvals/inbox";
import { topUpBalance } from "../../src/modules/packages/packages";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { payRefund, requestRefund } from "../../src/modules/cashier/receivables/receivables";
import { getShift, listShifts, myShift, openShift, submitShiftCount } from "../../src/modules/cashier/shifts/shifts";
import { publish } from "../../src/modules/catalog/catalog";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { changeSetting } from "../../src/modules/settings/settings";
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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Kasir Shift Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("SH1"), b2: await br("SH2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`shf${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Shift ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);

let A: T; let B: T;
let OWN: P; let FIN: P; let MGR: P; let MGR2: P; let FO: P; let FO2: P; let FO3: P; let AU: P; let BOWN: P; let PH: P;
let serum: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b1);
  FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b1); FO3 = await person(A, "fo_cashier", A.b2);
  BOWN = await person(B, "owner"); PH = await person(A, "pharmacist", A.b1, A.b2);
  serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "SH-SRM" }, { name: "Serum Shift", tax_category: "non_object", tax_basis: "Barang", normal_price: 100_000 } as never, "Produk"))).itemId;
  await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

// A counter sale of `qty` serums paid by `by` with the given tender; returns the payment id.
async function sell(by: P, qty: number, method: "cash" | "edc" | "transfer" = "cash", patientId?: string) {
  const { invoiceId } = await as(by, (db) => openKasirInvoice(db, key(), { counter: true, branchId: by.branch ? undefined : A.b1, patientId }));
  await as(by, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: qty }]));
  const amount = qty * 100_000;
  const tender = method === "cash" ? { method, amount, cashTendered: amount } : method === "edc"
    ? { method, amount, details: { card_type: "debit", bank: "BCA", trace: `T${++n}`, approval_code: "A1B2C3" } } : { method, amount, details: { bank: "BCA", reference: `R${++n}` } };
  await as(by, (db) => receivePayment(db, key(), invoiceId, [tender as never]));
  return (await h.admin.query(`select id, shift_id from payments where invoice_id = $1`, [invoiceId])).rows[0] as { id: string; shift_id: string | null };
}
async function patient(branch: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Shift', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             $5, 'fo_cashier') returning id`,
    [A.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), FO.staffId])).rows[0].id as string;
}
const shift = async (id: string) => (await h.admin.query(`select * from cash_shifts where id = $1`, [id])).rows[0];
// Closes a cashier's open shift (if any) with an exact count, so a test starts from no open shift.
async function closeOpen(p: P) {
  const open = (await h.admin.query(`select id from cash_shifts where cashier_id = $1 and state = 'open'`, [p.staffId])).rows[0]?.id as string | undefined;
  if (!open) return;
  const exp = (await as(p, (db) => getShift(db, open))).expected.find((e) => e.method === "cash")!.expected;
  await as(p, (db) => submitShiftCount(db, key(), open, { countedCash: exp }));
}
const approvalOf = async (countId: string) => (await h.admin.query(`select approval_id from cash_shift_counts where id = $1`, [countId])).rows[0].approval_id as string;

describe("Done-when: a non-zero variance always waits; above SET-13 it escalates to the owner", () => {
  it("zero variance closes at once; a short count within SET-13 waits for a manager (not the requester); above SET-13 only the owner", async () => {
    // Buka Kasir with a float, two cash sales: expected cash = 200,000 + 300,000.
    const { shiftId } = await as(FO, (db) => openShift(db, key(), { openingFloat: 200_000 }));
    expect((await sell(FO, 1)).shift_id).toBe(shiftId);
    expect((await sell(FO, 2)).shift_id).toBe(shiftId);
    const live = await as(FO, (db) => getShift(db, shiftId));
    expect(live.expected.find((e) => e.method === "cash")).toMatchObject({ payments: 2, received: 300_000, paid_out: 0, expected: 500_000 });
    // Zero variance: closed, no approval.
    const c0 = await as(FO, (db) => submitShiftCount(db, key(), shiftId, { countedCash: 500_000 }));
    expect([(await shift(shiftId)).state, await approvalOf(c0.countId)]).toEqual(["closed", null]);
    // Within SET-13 (default 50,000): a short count of 15,000 waits; the reason is required.
    const s2 = (await as(FO2, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO2, 1);
    expect(await why(as(FO2, (db) => submitShiftCount(db, key(), s2, { countedCash: 85_000 })))).toBe("ERR_INVALID_INPUT:reason");
    const c1 = await as(FO2, (db) => submitShiftCount(db, key(), s2, { countedCash: 85_000, reason: "Kembalian salah hitung" }));
    expect((await shift(s2)).state).toBe("pending_approval");
    const ap1 = await approvalOf(c1.countId);
    expect((await h.admin.query(`select type, amount_rupiah::int a, requested_by from approvals where id = $1`, [ap1])).rows[0]).toEqual({ type: "cash_shift_variance", a: 15_000, requested_by: FO2.staffId });
    await as(MGR, (db) => decideApproval(db, ap1, true));
    expect((await shift(s2)).state).toBe("closed");
    // Above SET-13: 60,000 over → escalated; the manager may not decide (approve or reject), the owner does.
    const s3 = (await as(FO, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO, 1);
    const c2 = await as(FO, (db) => submitShiftCount(db, key(), s3, { countedCash: 160_000, reason: "Uang lebih belum jelas" }));
    const ap2 = await approvalOf(c2.countId);
    expect(await why(as(MGR, (db) => decideApproval(db, ap2, true)))).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(as(MGR, (db) => decideApproval(db, ap2, false, "Hitung ulang")))).toMatch(/^ERR_FORBIDDEN/);
    expect((await shift(s3)).state).toBe("pending_approval");
    expect((await as(MGR, (db) => getShift(db, s3))).manager_decides).toBe(false);
    await as(OWN, (db) => decideApproval(db, ap2, true));
    expect((await shift(s3)).state).toBe("closed");
    // Exactly at the threshold stays with the manager.
    const s4 = (await as(FO2, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO2, 1);
    const c3 = await as(FO2, (db) => submitShiftCount(db, key(), s4, { countedCash: 50_000, reason: "Selisih tepat ambang" }));
    const ap3 = await approvalOf(c3.countId);
    await as(MGR, (db) => decideApproval(db, ap3, true));
    expect((await shift(s4)).state).toBe("closed");
  });

  it("SET-13 is read at submit and frozen on the count: a later change does not reroute; rejection → recount → a new approval", async () => {
    const s = (await as(FO, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO, 1);
    await as(OWN, (db) => changeSetting(db, { key: "SET-13", branchId: A.b1, value: 10_000, reason: "Ambang uji turun" }));
    const c1 = await as(FO, (db) => submitShiftCount(db, key(), s, { countedCash: 80_000, reason: "Kurang dua puluh ribu" }));
    expect((await h.admin.query(`select threshold::int t from cash_shift_counts where id = $1`, [c1.countId])).rows[0].t).toBe(10_000);
    await as(OWN, (db) => changeSetting(db, { key: "SET-13", branchId: A.b1, value: 50_000, reason: "Ambang uji kembali" }));
    // escalated at submit (20,000 > 10,000): still owner-only after the change
    const ap1 = await approvalOf(c1.countId);
    expect(await why(as(MGR, (db) => decideApproval(db, ap1, false, "Coba tolak")))).toMatch(/^ERR_FORBIDDEN/);
    await as(OWN, (db) => decideApproval(db, ap1, false, "Hitung ulang laci"));
    expect((await shift(s)).state).toBe("recount");
    // Hitung Ulang: count 2 with a new approval; now within the threshold (50,000) a manager decides.
    const c2 = await as(FO, (db) => submitShiftCount(db, key(), s, { countedCash: 95_000, reason: "Ditemukan lima belas ribu" }));
    expect((await h.admin.query(`select seq from cash_shift_counts where id = $1`, [c2.countId])).rows[0].seq).toBe(2);
    const ap2 = await approvalOf(c2.countId);
    await as(MGR, (db) => decideApproval(db, ap2, true));
    expect((await shift(s)).state).toBe("closed");
    // cancelling one's own pending request also returns to recount
    const s2 = (await as(FO2, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO2, 1);
    const c3 = await as(FO2, (db) => submitShiftCount(db, key(), s2, { countedCash: 99_000, reason: "Kurang seribu" }));
    const ap3 = await approvalOf(c3.countId);
    await as(FO2, (db) => cancelApproval(db, ap3));
    expect((await shift(s2)).state).toBe("recount");
    await as(FO2, (db) => submitShiftCount(db, key(), s2, { countedCash: 100_000 }));
    expect((await shift(s2)).state).toBe("closed");
  });
});

describe("stamping and the expectation", () => {
  it("a counter payment with no open shift auto-opens one at Rp0; after close the next payment opens a new shift; a pending or closed shift takes no payment", async () => {
    const p1 = await sell(FO3, 1);
    const s1 = await shift(p1.shift_id!);
    expect([s1.auto_opened, Number(s1.opening_float), s1.cashier_id, s1.branch_id, s1.state]).toEqual([true, 0, FO3.staffId, A.b2, "open"]);
    expect((await sell(FO3, 1)).shift_id).toBe(s1.id);
    await as(FO3, (db) => submitShiftCount(db, key(), s1.id, { countedCash: 150_000, reason: "Kurang lima puluh ribu" }));
    const p3 = await sell(FO3, 1);
    expect(p3.shift_id).not.toBe(s1.id);
    expect((await shift(p3.shift_id!)).auto_opened).toBe(true);
    // Buka Kasir while one is open: refused
    expect(await why(as(FO3, (db) => openShift(db, key(), { openingFloat: 0 })))).toBe("ERR_VERSION_CONFLICT:shift_open");
    // a supplied shift id is refused by the trigger; the guard refuses moving a shift back to open
    expect(await raw(`update cash_shifts set state = 'open', closed_at = null where id = $1`, [s1.id])).toBe("raw:42501");
    const pay = (await h.admin.query(`select * from payments where id = $1`, [p3.id])).rows[0];
    expect(await raw(`update payments set shift_id = $2 where id = $1`, [p3.id, s1.id])).toMatch(/^raw:/);
    expect(pay.shift_id).toBe(p3.shift_id);
  });

  it("non-cash tenders are expected, not counted; a cash refund paid in cash is cash paid out of the payer's shift", async () => {
    const s = (await as(FO2, (db) => openShift(db, key(), { openingFloat: 100_000 }))).shiftId;
    await sell(FO2, 1, "edc");
    await sell(FO2, 2, "transfer");
    const p = await sell(FO2, 3, "cash", await patient(A.b1));
    // a cash refund (requested by FO2, approved by the owner — SET-11 default, paid in cash by FO2): 50,000 out of the drawer
    const line = (await h.admin.query(`select l.id from invoice_lines l join payments y on y.invoice_id = l.invoice_id where y.id = $1`, [p.id])).rows[0].id as string;
    const r = await as(FO2, (db) => requestRefund(db, key(), line, { amount: 50_000, destination: "cash", reason: "Barang rusak" }));
    await as(OWN, (db) => decideApproval(db, r.approval_id!, true));
    await as(FO2, (db) => payRefund(db, key(), r.refund_id, "cash"));
    expect((await h.admin.query(`select shift_id from refunds where id = $1`, [r.refund_id])).rows[0].shift_id).toBe(s);
    const d = await as(FO2, (db) => getShift(db, s));
    const by = Object.fromEntries(d.expected.map((e) => [e.method, e]));
    expect(by.cash).toMatchObject({ received: 300_000, paid_out: 50_000, expected: 350_000 });
    expect(by.edc).toMatchObject({ payments: 1, expected: 100_000 });
    expect(by.transfer).toMatchObject({ payments: 1, expected: 200_000 });
    expect(d.k23).toEqual({ received: 550_000, sales: 600_000 });
    const c = await as(FO2, (db) => submitShiftCount(db, key(), s, { countedCash: 350_000 }));
    const lines = (await h.admin.query(`select method, expected::int e, counted::int c from cash_shift_count_lines where count_id = $1 order by method`, [c.countId])).rows;
    expect(lines).toEqual([{ method: "cash", e: 350_000, c: 350_000 }, { method: "edc", e: 100_000, c: null }, { method: "transfer", e: 200_000, c: null }]);
    expect((await shift(s)).state).toBe("closed");
  });
});

describe("database invariants behind the writers (mutation-proven)", () => {
  it("a waiting shift refuses another count; the definer's own replay; a closed shift never moves back; a stale decision conflicts; the inbox helper; a supplied shift refused at insert", async () => {
    const s = (await as(FO, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO, 1);
    // (1) the definer's own replay by key (below runCommand): the same count id, one row
    const k = key();
    const call = () => as(FO, (db) => db.query(`select cash_shift_submit($1, $2, $3::jsonb) as r`, [k, s, JSON.stringify({ counted_cash: 90_000, reason: "Kurang sepuluh ribu" })]).then((r) => r.rows[0].r as string));
    const first = await call();
    expect(await call()).toBe(first);
    expect((await h.admin.query(`select count(*)::int c from cash_shift_counts where shift_id = $1`, [s])).rows[0].c).toBe(1);
    // (2) a waiting shift refuses another count
    expect(await why(as(FO, (db) => submitShiftCount(db, key(), s, { countedCash: 100_000 })))).toBe("ERR_VERSION_CONFLICT:shift_pending");
    // (3) the inbox helper: within SET-13 the manager decides; an escalated count not
    const ap = await approvalOf(first);
    expect((await as(MGR, (db) => db.query(`select approval_manager_decides_shift($1) as ok`, [ap]))).rows[0].ok).toBe(true);
    const s2 = (await as(FO2, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO2, 1);
    const c2 = await as(FO2, (db) => submitShiftCount(db, key(), s2, { countedCash: 200_000, reason: "Lebih seratus ribu" }));
    const ap2 = await approvalOf(c2.countId);
    expect((await as(MGR, (db) => db.query(`select approval_manager_decides_shift($1) as ok`, [ap2]))).rows[0].ok).toBe(false);
    // (4) a stale decision: the shift closed by another path while the approval waits → the decision conflicts
    await h.admin.query(`update cash_shifts set state = 'closed', settled_at = now() where id = $1`, [s]);
    // (decideApproval keeps only the code; the definer's message names the reason)
    expect(await as(MGR, (db) => db.query(`select approval_decide($1, true, null)`, [ap])).then(() => "ok", (e) => e.message)).toMatch(/ERR_VERSION_CONFLICT: shift_not_waiting/);
    // (5) a closed shift never moves back (recount keeps closed_at, so only the transition rule refuses it)
    expect(await raw(`update cash_shifts set state = 'recount', settled_at = null where id = $1`, [s])).toBe("raw:42501");
    // (6) a supplied shift id is refused at insert (payments_guard disabled for the probe; a copy of a real payment, rolled back)
    const pay = (await h.admin.query(`select id from payments where shift_id = $1 limit 1`, [s2])).rows[0].id as string;
    const probe = async (shift: string | null) => {
      const c = await owner.connect();
      try {
        await c.query("begin");
        await c.query("alter table payments disable trigger payments_guard");
        await c.query(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                         environment, is_simulated, received_by, received_as, received_at, shift_id)
                       select tenant_id, branch_id, receipt_id, 6, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                         environment, is_simulated, received_by, received_as, received_at, $2 from payments where id = $1`, [pay, shift]);
        return "ok";
      } catch (e) {
        return `raw:${(e as { code?: string }).code}`;
      } finally {
        await c.query("rollback").catch(() => undefined);
        c.release();
      }
    };
    expect(await probe(null)).toBe("ok");
    expect(await probe(s2)).toBe("raw:42501");
  });
});

// Impl review r1 (b6b9c6c8) P2-2: the approved plan's cases that were missing.
describe("review r1: simulated and port payments, cash-out stamping, the inbox, K23, events, audit, change and balance, the race", () => {
  // A copy of a real payment of the shift's cashier inserted by the owner connection with payments_guard off (rolled back): only the
  // stamping trigger decides the shift. Returns the stamped shift_id or the error code.
  const insertCopy = async (from: string, over: { is_simulated?: boolean; charge?: boolean }) => {
    const c = await owner.connect();
    try {
      await c.query("begin");
      await c.query("alter table payments disable trigger payments_guard");
      await c.query("set local session_replication_role = replica"); // the synthetic charge id has no row: FK checks off; ENABLE ALWAYS triggers still fire
      const r = await c.query(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                                environment, is_simulated, charge_id, received_by, received_as, received_at)
                              select tenant_id, branch_id, receipt_id, 6, invoice_id, patient_id, method, amount, cash_tendered, change_given, details,
                                environment, $2, case when $3 then gen_random_uuid() end, received_by, received_as, clock_timestamp() from payments where id = $1
                              returning shift_id, tenant_id`,
        [from, over.is_simulated ?? false, over.charge ?? false]);
      // counted after the statement (a RETURNING subquery reads the statement's snapshot, before the trigger's auto-open)
      const n = (await c.query(`select count(*)::int n from cash_shifts where tenant_id = $1`, [r.rows[0].tenant_id])).rows[0].n as number;
      return { shift_id: r.rows[0].shift_id as string | null, n };
    } finally {
      await c.query("rollback").catch(() => undefined);
      c.release();
    }
  };
  it("a simulated payment gets no shift and opens none; a port payment takes the receiver's open shift or none, never auto-opening", async () => {
    await closeOpen(FO3);
    const s = (await as(FO3, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    const p = await sell(FO3, 1);
    expect(p.shift_id).toBe(s);
    // with the shift open: a port payment is stamped with it; a simulated one gets none
    expect((await insertCopy(p.id, { charge: true })).shift_id).toBe(s);
    expect((await insertCopy(p.id, { is_simulated: true, charge: true })).shift_id).toBeNull();
    await as(FO3, (db) => submitShiftCount(db, key(), s, { countedCash: 100_000 }));
    // no open shift: a port payment stays without a shift and opens none; a counter payment auto-opens one (n + 1)
    const n0 = (await h.admin.query(`select count(*)::int c from cash_shifts where tenant_id = $1`, [A.tenantId])).rows[0].c as number;
    const port = await insertCopy(p.id, { charge: true });
    expect([port.shift_id, port.n]).toEqual([null, n0]);
    const sim = await insertCopy(p.id, { is_simulated: true });
    expect([sim.shift_id, sim.n]).toEqual([null, n0]);
    const counter = await insertCopy(p.id, {});
    expect([counter.shift_id !== null, counter.n]).toEqual([true, n0 + 1]);
  });

  it("change is net (amount, not tendered); the balance is not drawer money; a clinic DP refund in cash is paid out; cash-out shifts never change", async () => {
    await closeOpen(FO);
    const s = (await as(FO, (db) => openShift(db, key(), { openingFloat: 10_000 }))).shiftId;
    const pid = await patient(A.b1);
    // cash 100,000 tendered 150,000 (change 50,000); Isi Saldo cash 200,000; the balance pays 100,000
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 100_000, cashTendered: 150_000 }]));
    await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 200_000, cashTendered: 200_000 }));
    const inv2 = (await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }))).invoiceId;
    await as(FO, (db) => issueKasirInvoice(db, key(), inv2, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), inv2, [{ method: "balance", amount: 100_000 }]));
    const d = await as(FO, (db) => getShift(db, s));
    const by = Object.fromEntries(d.expected.map((e) => [e.method, e]));
    expect(by.cash).toMatchObject({ payments: 2, received: 300_000, expected: 310_000 });
    expect(by.balance).toMatchObject({ payments: 1, expected: 100_000 });
    expect(d.k23.received).toBe(300_000); // the balance is not money received
    // a clinic DP refund in cash: the deposit row's transition to refunded/cash (stamping trigger only; guard off, rolled back)
    const c = await owner.connect();
    try {
      await c.query("begin");
      await c.query("alter table booking_deposits disable trigger booking_deposits_guard");
      await c.query("set local session_replication_role = replica"); // skips the FK checks only; ENABLE ALWAYS triggers (the stamping) still fire
      const dep = (await c.query(`insert into booking_deposits (tenant_id, branch_id, appointment_id, patient_id, catalog_version_id, receipt_id, method, amount, tax_category,
                                   is_pkp_at_receipt, vat_base, vat_amount, cutoff_hours, command_key, received_by, received_as)
                                 select $1, $2, gen_random_uuid(), $3, (select id from catalog_versions where tenant_id = $1 limit 1),
                                   (select receipt_id from payments where invoice_id = $4 limit 1), 'cash', 40000, 'non_object', false, 40000, 0, 24, 'k-dep-' || gen_random_uuid(), $5, 'fo_cashier'
                                 returning id`, [A.tenantId, A.b1, pid, invoiceId, FO.staffId]).catch((e) => ({ rows: [{ id: `fk:${e.code}` }] }))).rows[0].id as string;
      if (!dep.startsWith("fk:")) {
        await c.query(`update booking_deposits set state = 'refunded', refund_method = 'cash', decision_code = 'clinic_refund', decided_by = $2, decided_as = 'fo_cashier', decided_at = clock_timestamp() where id = $1`, [dep, FO.staffId]);
        expect((await c.query(`select shift_id from booking_deposits where id = $1`, [dep])).rows[0].shift_id).toBe(s);
        expect((await c.query(`select paid_out::int p from cash_shift_expected($1, $2) where method = 'cash'`, [A.tenantId, s])).rows[0].p).toBe(40_000);
        expect(await c.query(`update booking_deposits set shift_id = null where id = $1`, [dep]).then(() => "ok", (e) => e.code)).toBe("42501");
      } else {
        throw new Error(`deposit fixture refused: ${dep}`);
      }
    } finally {
      await c.query("rollback").catch(() => undefined);
      c.release();
    }
    // a paid cash refund's shift never changes (refunds_shift)
    const r = (await h.admin.query(`select id from refunds where shift_id is not null limit 1`)).rows[0];
    if (r) expect(await raw(`update refunds set shift_id = null where id = $1`, [r.id])).toBe("raw:42501");
    await as(FO, (db) => submitShiftCount(db, key(), s, { countedCash: 310_000 }));
  });

  it("the inbox: an escalated variance is not listed for the manager and its detail is not-approver; within SET-13 it is decidable", async () => {
    await closeOpen(FO2);
    const s = (await as(FO2, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO2, 1);
    const c1 = await as(FO2, (db) => submitShiftCount(db, key(), s, { countedCash: 40_000, reason: "Kurang enam puluh ribu" }));
    const esc = await approvalOf(c1.countId);
    const rows = (await as(MGR, (db) => listInbox(db, "manager", { type: "cash_shift_variance" }))).rows.map((r) => r.id);
    expect(rows).not.toContain(esc);
    expect((await as(MGR, (db) => inboxDetail(db, { staffId: MGR.staffId, role: "manager" }, esc)))?.blocked).toBe("not-approver");
    expect((await as(OWN, (db) => listInbox(db, "owner", { type: "cash_shift_variance" }))).rows.map((r) => r.id)).toContain(esc);
    await as(OWN, (db) => decideApproval(db, esc, false, "Hitung ulang laci"));
    const c2 = await as(FO2, (db) => submitShiftCount(db, key(), s, { countedCash: 90_000, reason: "Kurang sepuluh ribu" }));
    const ok = await approvalOf(c2.countId);
    expect((await as(MGR, (db) => listInbox(db, "manager", { type: "cash_shift_variance" }))).rows.map((r) => r.id)).toContain(ok);
    expect((await as(MGR, (db) => inboxDetail(db, { staffId: MGR.staffId, role: "manager" }, ok)))?.blocked).toBeNull();
    await as(MGR, (db) => decideApproval(db, ok, true));
    // the auditor: the decision reason masked
    const au = await as(AU, (db) => getShift(db, s));
    expect(au.counts.map((c) => c.approval?.decision_reason ?? null)).toEqual([null, null]);
    expect((await as(OWN, (db) => getShift(db, s))).counts[0].approval?.decision_reason).toBe("Hitung ulang laci");
  });

  it("K23 sales of an auto-opened shift count the invoice that opened it; ShiftClosed once (first submit), ids and booleans; audit opened only for Buka Kasir", async () => {
    await closeOpen(FO3);
    const p = await sell(FO3, 2);
    const s = p.shift_id!;
    expect((await shift(s)).auto_opened).toBe(true);
    // received = the shift's own payments; sales = the invoices it took payment for (issued after FO3's previous close) — the auto-open
    // invoice of 200,000 included (before the fix it was dropped: issued just before the payment that opened the shift)
    const k23 = (await as(FO3, (db) => getShift(db, s))).k23;
    expect(k23.received).toBe(200_000);
    expect(k23.sales).toBe(k23.received);
    const c1 = await as(FO3, (db) => submitShiftCount(db, key(), s, { countedCash: 190_000, reason: "Kurang sepuluh ribu" }));
    const ap1 = await approvalOf(c1.countId);
    await as(OWN, (db) => decideApproval(db, ap1, false, "Hitung ulang"));
    await as(FO3, (db) => submitShiftCount(db, key(), s, { countedCash: 200_000 }));
    const ev = (await h.admin.query(`select payload from domain_events where type = 'ShiftClosed' and aggregate_id = $1`, [s])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ shift_id: s, count_id: c1.countId, variance: true, escalated: false });
    const opened = (await h.admin.query(`select count(*)::int c from audit_events where object_id = $1 and reason_code = 'cash_shift_opened'`, [s])).rows[0].c;
    const counted = (await h.admin.query(`select count(*)::int c from audit_events where object_id = $1 and reason_code = 'cash_shift_counted'`, [s])).rows[0].c;
    expect([opened, counted]).toEqual([0, 2]);
    const s2 = (await as(FO3, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    expect((await h.admin.query(`select count(*)::int c from audit_events where object_id = $1 and reason_code = 'cash_shift_opened'`, [s2])).rows[0].c).toBe(1);
    await as(FO3, (db) => submitShiftCount(db, key(), s2, { countedCash: 0 }));
  });

  it("a count insert without its own pending approval is refused; Buka Kasir at another branch is not found", async () => {
    await closeOpen(FO);
    const s = (await as(FO, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    expect(await raw(`insert into cash_shift_counts (id, tenant_id, branch_id, shift_id, seq, counted_cash, expected_cash, reason, threshold, approval_id, command_key, counted_by, counted_as)
                      values (gen_random_uuid(), $1, $2, $3, 1, 10, 0, 'Tanpa persetujuan', 50000, null, 'k-noap-0001', $4, 'fo_cashier')`, [A.tenantId, A.b1, s, FO.staffId])).toBe("raw:42501");
    expect(await why(as(FO, (db) => openShift(db, key(), { branchId: A.b2, openingFloat: 0 })))).toBe("ERR_NOT_FOUND:branch not found");
    await as(FO, (db) => submitShiftCount(db, key(), s, { countedCash: 0 }));
  });

  it("race: a payment and the close of the same cashier serialize; the payment is in the closing shift or the next one, never lost", async () => {
    await closeOpen(FO2);
    const s = (await as(FO2, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO2, 1);
    const [paid] = await Promise.all([sell(FO2, 1), as(FO2, (db) => submitShiftCount(db, key(), s, { countedCash: 100_000 })).catch(() => null)]);
    const st = await shift(s);
    const stamped = paid.shift_id!;
    const inClosing = stamped === s;
    // either way the money is in exactly one shift; if it is in the closing one the count saw it (expected 200,000 → a variance) or it came before the close
    const total = (await h.admin.query(`select coalesce(sum(amount), 0)::int t from payments where shift_id in ($1, $2)`, [s, stamped])).rows[0].t as number;
    expect(total).toBe(inClosing ? 200_000 : 100_000 + 100_000);
    // a payment stamped in the closing shift after the count would change a frozen expectation: if stamped there, the count includes it
    if (inClosing && st.state !== "open") {
      const exp = (await h.admin.query(`select expected_cash::int e from cash_shift_counts where shift_id = $1 order by seq desc limit 1`, [s])).rows[0].e as number;
      expect(exp).toBe(200_000);
    }
    expect(["closed", "pending_approval", "open"]).toContain(st.state);
    if (!inClosing) expect((await shift(stamped)).auto_opened).toBe(true);
  });
});

describe("who counts, who reads, tenants", () => {
  it("a manager of the branch closes a departed cashier's shift and may not approve its own request; owner/finance may not count another's shift", async () => {
    await closeOpen(FO); await closeOpen(FO2);
    const s = (await as(FO, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO, 1);
    expect(await why(as(OWN, (db) => submitShiftCount(db, key(), s, { countedCash: 100_000 })))).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(as(FIN, (db) => submitShiftCount(db, key(), s, { countedCash: 100_000 })))).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(as(FO2, (db) => submitShiftCount(db, key(), s, { countedCash: 100_000 })))).toBe("ERR_NOT_FOUND:shift not found");
    const c = await as(MGR, (db) => submitShiftCount(db, key(), s, { countedCash: 90_000, reason: "Kasir pulang, dihitung manajer" }));
    const ap = await approvalOf(c.countId);
    expect(await why(as(MGR, (db) => decideApproval(db, ap, true)))).toMatch(/^ERR_/);
    await as(MGR2, (db) => decideApproval(db, ap, true));
    expect((await h.admin.query(`select counted_by from cash_shift_counts where id = $1`, [c.countId])).rows[0].counted_by).toBe(MGR.staffId);
  });

  it("readers: an FO sees only its own shifts; a manager its branch; the auditor all, reasons masked; another tenant nothing; replay returns the same count", async () => {
    await closeOpen(FO); await closeOpen(FO2);
    const s = (await as(FO2, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    await sell(FO2, 1);
    const k = key();
    const c1 = await as(FO2, (db) => submitShiftCount(db, k, s, { countedCash: 70_000, reason: "Alasan rahasia selisih" }));
    expect((await as(FO2, (db) => submitShiftCount(db, k, s, { countedCash: 70_000, reason: "Alasan rahasia selisih" }))).countId).toBe(c1.countId);
    const foList = (await as(FO, (db) => listShifts(db))).rows;
    expect(foList.every((r) => r.cashier.id === FO.staffId)).toBe(true);
    expect(await why(as(FO, (db) => getShift(db, s)))).toBe("ERR_NOT_FOUND:shift not found");
    expect((await as(MGR, (db) => listShifts(db))).rows.some((r) => r.id === s)).toBe(true);
    expect((await as(MGR, (db) => listShifts(db))).rows.every((r) => r.branch.id === A.b1)).toBe(true);
    const au = await as(AU, (db) => getShift(db, s));
    expect([au.counts[0].reason, au.counts[0].variance]).toEqual([null, -30_000]);
    expect((await as(FIN, (db) => getShift(db, s))).counts[0].reason).toBe("Alasan rahasia selisih");
    expect(await why(as(BOWN, (db) => getShift(db, s)))).toBe("ERR_NOT_FOUND:shift not found");
    expect((await as(BOWN, (db) => listShifts(db))).rows).toEqual([]);
    expect((await as(FO2, (db) => myShift(db)))?.id).toBe(s);
    // direct reads through RLS: FO2 sees its own shift row, FO not; the reason column is never granted
    const seen = async (p: P) => (await as(p, (db) => db.query(`select count(*)::int c from cash_shifts where id = $1`, [s]))).rows[0].c;
    expect([await seen(FO2), await seen(FO), await seen(MGR), await seen(AU), await seen(BOWN)]).toEqual([1, 0, 1, 1, 0]);
    expect(await as(FIN, (db) => db.query(`select reason from cash_shift_counts limit 1`)).then(() => "ok", (e) => e.code)).toBe("42501");
    // the guards: counts insert-only, shifts never deleted
    expect(await raw(`delete from cash_shifts where id = $1`, [s])).toBe("raw:42501");
    expect(await raw(`update cash_shift_counts set counted_cash = 1 where id = $1`, [c1.countId])).toBe("raw:42501");
  });
});
