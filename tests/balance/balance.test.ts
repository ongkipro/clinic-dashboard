// T-075 Done-when: the balance ledger — scenario PR-21 (a balance last used two years ago pays a product in full;
// nothing expires) and entries never negative. Plus the plan reviews: the balance tender at the Kasir (one per Terima,
// split with cash, VAT at payment on a PKP line, "Saldo" on the receipt, refused without a patient, with SET-14 off, or
// above the balance; offered only when there is a balance), concurrency (two uses above the balance: one wins),
// balance_post (each credit kind, idempotent, a conflicting replay refused, the event per kind with ids only), the
// guards (insert-only entries, the running balance, the account only by its newest entry, the sign per kind, no
// vat_settled, a use names its real balance payment, a balance payment has a patient), patient merge (refused while
// the duplicate has a balance; after a zero-balance merge the survivor's account is used), a credit at one branch spent
// at another, readers per role and tenant (the auditor sees amounts, not the patient or reasons). Credits arrive with
// packages, deposits, refunds and the import; here they are posted through the internal writer on the admin connection.
// Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { patientBalance } from "../../src/modules/balance/balance";
import { issueKasirInvoice, kasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { mergePatients, unmergePatients } from "../../src/modules/patients/merge/merge";
import { changeSetting } from "../../src/modules/settings/settings";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const NPWP = "012345678901234";

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Saldo Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("SB1"), b2: await br("SB2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`sal${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Saldo ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
async function patient(t: T, branch: string, name = "Pasien Saldo"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
// A credit through the internal writer (its real callers arrive with packages, deposits, refunds and the import).
const credit = async (t: T, patientId: string, amount: number, by: P, kind = "from_refund", branch = t.b1, k = `cr-${key()}`) =>
  (await h.admin.query(`select balance_post($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) as id`,
    [t.tenantId, patientId, branch, kind, amount, JSON.stringify({ source_kind: "uji", source_id: key() }), k, by.staffId, by.role])).rows[0].id as string;
const balance = async (patientId: string) =>
  Number((await h.admin.query(`select coalesce((select balance from balance_accounts where patient_id = $1), 0) b`, [patientId])).rows[0].b);
// A patient's counter tagihan at branch b of the products, issued.
async function bill(fo: P, patientId: string, lines: { itemId: string; quantity: number }[]) {
  const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId }));
  await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, lines));
  return invoiceId;
}

let A: T; let B: T;
let OWN: P; let FIN: P; let AU: P; let MGR: P; let FO: P; let FOB2: P; let MGR12: P; let DOC: P; let RO: P; let BFO: P; let BOWN: P;
let serum: string; let toner: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1); FOB2 = await person(A, "fo_cashier", A.b2);
  MGR12 = await person(A, "manager", A.b2, A.b1); DOC = await person(A, "doctor", A.b1); RO = await person(A, "records_officer", A.b1);
  BFO = await person(B, "fo_cashier", B.b1); BOWN = await person(B, "owner");
  const product = async (c: string, name: string, price: number) =>
    (await as(OWN, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: price } as never, "Produk"))).itemId;
  serum = await product("SL-SRM", "Serum Saldo", 333_000);
  toner = await product("SL-TON", "Toner Saldo", 400_000);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-21: the balance never expires", () => {
  it("a balance of Rp400,000 last used two years ago pays a product in full", async () => {
    const p = await patient(A, A.b1, "Pasien Saldo Lama");
    const e = await credit(A, p, 400_000, FO);
    // Last used two years ago (back-dated on the admin connection; the guard refuses updates).
    await h.admin.query(`alter table balance_entries disable trigger balance_entries_guard`);
    await h.admin.query(`update balance_entries set created_at = now() - interval '2 years' where id = $1`, [e]);
    await h.admin.query(`alter table balance_entries enable always trigger balance_entries_guard`);
    await h.admin.query(`alter table balance_accounts disable trigger balance_accounts_guard`);
    await h.admin.query(`update balance_accounts set created_at = now() - interval '2 years', updated_at = now() - interval '2 years' where patient_id = $1`, [p]);
    await h.admin.query(`alter table balance_accounts enable always trigger balance_accounts_guard`);
    const inv = await bill(FO, p, [{ itemId: toner, quantity: 1 }]);
    const got = await as(FO, (db) => kasirInvoice(db, inv));
    expect(got.patient_balance).toBe(400_000);
    expect(got.tenders.find((t) => t.method === "balance")).toEqual({ method: "balance", available: true, blocked: null });
    const r = await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 400_000 }]));
    expect([r.outstanding, r.change]).toEqual([0, 0]);
    expect(await balance(p)).toBe(0);
    const ent = (await h.admin.query(`select kind, amount::int, balance_after::int, payment_id is not null pay from balance_entries where account_id = (select id from balance_accounts where patient_id = $1) order by seq`, [p])).rows;
    expect(ent).toEqual([{ kind: "from_refund", amount: 400_000, balance_after: 400_000, pay: false }, { kind: "use", amount: -400_000, balance_after: 0, pay: true }]);
    // Nothing in the schema can expire a balance: no expiry column, no job.
    const cols = (await h.admin.query(`select column_name from information_schema.columns where table_name in ('balance_accounts','balance_entries') and column_name ~ 'expir|valid'`)).rows;
    expect(cols).toEqual([]);
    // The receipt reads Saldo.
    const body = (await h.admin.query(`select body from receipts where invoice_id = $1`, [inv])).rows[0].body as string;
    expect(body).toMatch(/Saldo Rp400\.000/);
    // Once spent, it is no longer offered.
    const inv2 = await bill(FO, p, [{ itemId: serum, quantity: 1 }]);
    expect((await as(FO, (db) => kasirInvoice(db, inv2))).tenders.find((t) => t.method === "balance")).toEqual({ method: "balance", available: false, blocked: "balance" });
  });
});

describe("entries never negative", () => {
  it("a use above the balance is refused and nothing is written; a split with cash pays the rest", async () => {
    const p = await patient(A, A.b1);
    await credit(A, p, 100_000, FO);
    const inv = await bill(FO, p, [{ itemId: serum, quantity: 1 }]);
    expect(await why(as(FO, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 100_001 }])))).toBe("ERR_BALANCE_INSUFFICIENT:insufficient");
    expect(await balance(p)).toBe(100_000);
    expect(Number((await h.admin.query(`select count(*) c from payments where invoice_id = $1`, [inv])).rows[0].c)).toBe(0);
    expect(await why(as(FO, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 50_000 }, { method: "balance", amount: 50_000 }])))).toBe("ERR_INVALID_INPUT:tenders");
    const r = await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 100_000 }, { method: "cash", amount: 233_000, cashTendered: 250_000 }]));
    expect([r.outstanding, r.change]).toEqual([0, 17_000]);
    expect(await balance(p)).toBe(0);
    expect(Number((await h.admin.query(`select count(*) c from domain_events where type = 'BalanceUsed' and payload ->> 'patient_id' = $1`, [p])).rows[0].c)).toBe(1);
  });

  it("two concurrent uses that together exceed the balance: exactly one succeeds", async () => {
    const p = await patient(A, A.b1);
    await credit(A, p, 400_000, FO);
    const i1 = await bill(FO, p, [{ itemId: serum, quantity: 1 }]);
    const i2 = await bill(FO, p, [{ itemId: serum, quantity: 1 }]);
    const res = await Promise.all([
      code(as(FO, (db) => receivePayment(db, key(), i1, [{ method: "balance", amount: 333_000 }]))),
      code(as(FO, (db) => receivePayment(db, key(), i2, [{ method: "balance", amount: 333_000 }]))),
    ]);
    expect(res.sort()).toEqual(["ERR_BALANCE_INSUFFICIENT", "ok"]);
    expect(await balance(p)).toBe(67_000);
    const sum = Number((await h.admin.query(`select sum(amount) s from balance_entries where account_id = (select id from balance_accounts where patient_id = $1)`, [p])).rows[0].s);
    expect(sum).toBe(67_000);
  });

  it("the guards: insert-only, the running balance, the account only by its newest entry, the sign per kind, no vat_settled", async () => {
    const p = await patient(A, A.b1);
    const e = await credit(A, p, 50_000, FO);
    const acc = (await h.admin.query(`select id from balance_accounts where patient_id = $1`, [p])).rows[0].id;
    const ins = (kind: string, amount: number, after: number, extra = "") => code(h.admin.query(
      `insert into balance_entries (tenant_id, account_id, branch_id, kind, amount, balance_after, source_kind, source_id, command_key, created_by, created_as${extra ? ", vat_settled" : ""})
       values ($1, $2, $3, $4, $5, $6, 'uji', gen_random_uuid(), $7, $8, 'fo_cashier'${extra ? ", true" : ""})`, [A.tenantId, acc, A.b1, kind, amount, after, `g-${key()}`, FO.staffId]));
    expect(await h.admin.query(`insert into balance_entries (tenant_id, account_id, branch_id, kind, amount, balance_after, source_kind, source_id, command_key, created_by, created_as)
       values ($1, $2, $3, 'from_refund', 10000, 70000, 'uji', gen_random_uuid(), $4, $5, 'fo_cashier')`, [A.tenantId, acc, A.b1, `g-${key()}`, FO.staffId])
      .then(() => "ok", (e) => e.message)).toBe("an entry continues its account balance and never goes below 0"); // wrong running balance (the entry guard, before the account's)
    expect(await ins("cash_refund", -60_000, -10_000)).toMatch(/raw:(23514|42501)/); // below 0
    expect(await ins("from_refund", -10_000, 40_000)).toBe("raw:23514"); // a credit kind with a negative amount
    expect(await ins("cash_refund", 10_000, 60_000)).toBe("raw:23514"); // a debit kind with a positive amount
    expect(await ins("from_refund", 10_000, 60_000, "vat")).toBe("raw:23514"); // vat_settled stays off (Q-05)
    expect(await ins("use", -10_000, 40_000)).toBe("raw:23514"); // a use names its payment
    expect(await code(h.admin.query(`update balance_entries set amount = 60_000 where id = $1`, [e]))).toBe("raw:42501");
    expect(await code(h.admin.query(`delete from balance_entries where id = $1`, [e]))).toBe("raw:42501");
    expect(await code(h.admin.query(`update balance_accounts set balance = 999, version = version + 1 where id = $1`, [acc]))).toBe("raw:42501");
    expect(await code(h.admin.query(`delete from balance_accounts where id = $1`, [acc]))).toBe("raw:42501");
    expect(await code(h.admin.query(`insert into balance_accounts (tenant_id, patient_id, balance) values ($1, $2, 10)`, [A.tenantId, await patient(A, A.b1)]))).toBe("raw:42501");
    // A direct entry that continues the balance is applied to the account (the trigger pair).
    expect(await ins("from_refund", 10_000, 60_000)).toBe("ok");
    expect(await balance(p)).toBe(60_000);
    // A use entry must name a real balance payment of the same patient, branch and amount.
    const other = await patient(A, A.b1);
    await credit(A, other, 10_000, FO);
    const inv = await bill(FO, other, [{ itemId: serum, quantity: 1 }]);
    await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 10_000 }]));
    const pay = (await h.admin.query(`select id from payments where invoice_id = $1 and method = 'balance'`, [inv])).rows[0].id;
    expect(await code(h.admin.query(
      `insert into balance_entries (tenant_id, account_id, branch_id, kind, amount, balance_after, payment_id, command_key, created_by, created_as)
       values ($1, $2, $3, 'use', -10000, 50000, $4, $5, $6, 'fo_cashier')`, [A.tenantId, acc, A.b1, pay, `g-${key()}`, FO.staffId]))).toBe("raw:42501");
  });
});

describe("balance_post (the internal writer)", () => {
  it("each credit kind with its event; idempotent by key; a conflicting replay refused; ids only in the payload", async () => {
    const p = await patient(A, A.b1);
    const kinds: [string, string | null][] = [["top_up", "BalanceToppedUp"], ["from_expiry", "BalanceMoved"], ["from_cancel", "BalanceMoved"],
      ["from_interrupted_treatment", "BalanceMoved"], ["from_substitution", "BalanceMoved"], ["from_refund", "BalanceMoved"], ["dp_transfer", "BalanceMoved"],
      ["opening_balance", null]];
    for (const [kind, type] of kinds) {
      const e = await credit(A, p, 1_000, FO, kind);
      const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1`, [e])).rows;
      expect(ev.map((x) => x.type), kind).toEqual(type ? [type] : []);
      if (type) expect(Object.keys(ev[0].payload).sort()).toEqual(["account_id", "entry_id", "kind", "patient_id", "source_id", "source_kind"]);
    }
    expect(await balance(p)).toBe(8_000);
    // cash_refund: a debit, no event here (RefundPaid is T-078's).
    const cr = await credit(A, p, -3_000, FO, "cash_refund");
    expect((await h.admin.query(`select count(*)::int c from domain_events where aggregate_id = $1`, [cr])).rows[0].c).toBe(0);
    expect(await balance(p)).toBe(5_000);
    // Idempotent: the same key and arguments return the same entry; different ones are refused.
    const k = `cr-${key()}`;
    const src = key();
    const post = (amount: number, who = p) => h.admin.query(`select balance_post($1, $2, $3, 'from_refund', $4, $5::jsonb, $6, $7, 'fo_cashier') as id`,
      [A.tenantId, who, A.b1, amount, JSON.stringify({ source_kind: "uji", source_id: src }), k, FO.staffId]).then((r) => r.rows[0].id as string);
    const e1 = await post(2_000);
    expect(await post(2_000)).toBe(e1);
    expect(await balance(p)).toBe(7_000);
    expect(await code(post(2_001))).toBe("raw:23505");
    expect(await code(post(2_000, await patient(A, A.b1)))).toBe("raw:23505");
    // A debit above the balance: refused.
    expect(await code(credit(A, p, -7_001, FO, "cash_refund"))).toBe("raw:55000");
  });
});

describe("patient merge (DEC-061: redirect, never move money)", () => {
  it("refused while the duplicate has a balance; after a zero-balance merge the survivor's account is used; unmerge restores", async () => {
    const surv = await patient(A, A.b1, "Pasien Utama Saldo");
    const dup = await patient(A, A.b1, "Pasien Ganda Saldo");
    await credit(A, surv, 100_000, FO);
    const d = await credit(A, dup, 20_000, FO);
    expect(await why(as(RO, (db) => mergePatients(db, key(), surv, dup, "Rekam ganda pasien yang sama")))).toBe("ERR_VERSION_CONFLICT:patient_has_balance");
    // Spent to zero, the merge goes through; the duplicate's (empty) account stays, the survivor's is used.
    const inv = await bill(FO, dup, [{ itemId: serum, quantity: 1 }]);
    await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 20_000 }]));
    void d;
    const { mergeId } = await as(RO, (db) => mergePatients(db, key(), surv, dup, "Rekam ganda pasien yang sama"));
    const got = await as(FO, (db) => patientBalance(db, dup));
    expect([got.patient?.id, got.balance]).toEqual([surv, 100_000]);
    await credit(A, dup, 5_000, FO); // a credit to the merged id lands on the survivor
    expect(await balance(surv)).toBe(105_000);
    expect(await balance(dup)).toBe(0);
    // The survivor's tagihan spends the merged balance.
    const inv2 = await bill(FO, surv, [{ itemId: serum, quantity: 1 }]);
    await as(FO, (db) => receivePayment(db, key(), inv2, [{ method: "balance", amount: 5_000 }]));
    expect(await balance(surv)).toBe(100_000);
    // Unmerge: both patients as they were (the duplicate's account at 0).
    await as(RO, (db) => unmergePatients(db, key(), mergeId, "Ternyata dua pasien berbeda"));
    expect((await as(FO, (db) => patientBalance(db, dup))).balance).toBe(0);
    expect((await as(FO, (db) => patientBalance(db, surv))).balance).toBe(100_000);
  });
});

describe("the tender at the Kasir", () => {
  it("credited at branch 1, spent at branch 2; readable by FO of both; SET-14 off and a counter sale without a patient refused", async () => {
    const p = await patient(A, A.b1);
    await credit(A, p, 300_000, FO, "from_refund", A.b1);
    const inv = await bill(FOB2, p, [{ itemId: serum, quantity: 1 }]);
    await as(FOB2, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 300_000 }, { method: "cash", amount: 33_000, cashTendered: 33_000 }]));
    const seen1 = await as(FO, (db) => patientBalance(db, p));
    const seen2 = await as(FOB2, (db) => patientBalance(db, p));
    expect([seen1.balance, seen2.balance]).toEqual([0, 0]);
    expect(seen2.entries.map((e) => [e.kind, e.branch?.id])).toEqual([["use", A.b2], ["from_refund", A.b1]]);
    // A counter sale without a patient: the balance is not offered and refused.
    const { invoiceId: anon } = await as(FO, (db) => openKasirInvoice(db, key(), {}));
    await as(FO, (db) => issueKasirInvoice(db, key(), anon, [{ itemId: serum, quantity: 1 }]));
    expect((await as(FO, (db) => kasirInvoice(db, anon))).tenders.find((t) => t.method === "balance")?.available).toBe(false);
    expect(await why(as(FO, (db) => receivePayment(db, key(), anon, [{ method: "balance", amount: 1_000 }])))).toBe("ERR_NOT_AVAILABLE:balance");
    // SET-14 without saldo: refused and shown as switched off.
    const q = await patient(A, A.b1);
    await credit(A, q, 10_000, FO);
    const iq = await bill(FO, q, [{ itemId: serum, quantity: 1 }]);
    await as(OWN, (db) => changeSetting(db, { key: "SET-14", branchId: null, value: { metode: ["tunai", "edc", "transfer"], provider: "mock", link_jam: 24 }, reason: "Uji tanpa saldo" }));
    expect((await as(FO, (db) => kasirInvoice(db, iq))).tenders.find((t) => t.method === "balance")).toEqual({ method: "balance", available: false, blocked: "method_disabled" });
    expect(await why(as(FO, (db) => receivePayment(db, key(), iq, [{ method: "balance", amount: 1_000 }])))).toBe("ERR_NOT_AVAILABLE:method_disabled");
    await as(OWN, (db) => changeSetting(db, { key: "SET-14", branchId: null, restore: true, reason: "Kembali ke default" }));
    // Replay by key: the same receipt; the balance spent once.
    const k = key();
    const r1 = await as(FO, (db) => receivePayment(db, k, iq, [{ method: "balance", amount: 10_000 }]));
    const r2 = await as(FO, (db) => receivePayment(db, k, iq, [{ method: "balance", amount: 10_000 }]));
    expect(r2.receipt_id).toBe(r1.receipt_id);
    expect(await balance(q)).toBe(0);
    // A balance payment row needs a patient and is never simulated (the guard below the writer).
    const pay = (await h.admin.query(`select * from payments where invoice_id = $1 and method = 'balance'`, [iq])).rows[0];
    expect(await code(h.admin.query(`update payments set is_simulated = true where id = $1`, [pay.id]))).toMatch(/raw:42501/);
    const insPay = (sim: boolean, patientId: string | null) => h.admin.query(
      `insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, is_simulated, received_by, received_as, received_at)
       values ($1, $2, $3, 2, $4, $5, 'balance', 1000, 'local', $6, $7, 'fo_cashier', now())`, [A.tenantId, pay.branch_id, pay.receipt_id, iq, patientId, sim, FO.staffId])
      .then(() => "ok", (e) => e.message);
    expect(await insPay(true, q)).toBe("a balance payment has a patient and is never simulated");
    expect(await insPay(false, null)).toBe("a balance payment has a patient and is never simulated");
  });

  it("PKP: VAT recognised at payment on a line paid by balance (once)", async () => {
    const C = await tenant();
    const cown = await person(C, "owner");
    const cfin = await person(C, "finance");
    const cfo = await person(C, "fo_cashier", C.b1);
    const s = (await as(cown, (db) => publish(db, { kind: "product", code: "SP-SRM" }, { name: "Serum PKP Saldo", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"))).itemId;
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak ${++n}\n%%EOF\n`);
    const { fileId } = await as(cfin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(cown, (db) => decideEvidence(db, item, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: day(1), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 1, changed_at = now() - interval '2 days' where tenant_id = $1`, [C.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 1 where id = $1`, [C.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    const p = await patient(C, C.b1);
    await credit(C, p, 333_000, cfo);
    const inv = await bill(cfo, p, [{ itemId: s, quantity: 1 }]);
    await as(cfo, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 333_000 }]));
    const l = (await h.admin.query(`select l.vat_amount::int v, l.vat_recognised_amount::int r, sum(a.vat_portion)::int pv, bool_and(a.method = 'balance') b
                                     from invoice_lines l join payment_allocations a on a.invoice_line_id = l.id where l.invoice_id = $1 group by l.id`, [inv])).rows[0];
    expect(l).toEqual({ v: 33_000, r: 33_000, pv: 33_000, b: true });
  });
});

describe("readers, roles and tenants", () => {
  it("cashier readers see the balance; the auditor sees amounts without the patient or reasons; other roles and tenants refused", async () => {
    const p = await patient(A, A.b1, "Pasien Saldo Rahasia");
    await h.admin.query(`select balance_post($1, $2, $3, 'from_refund', 25000, $4::jsonb, $5, $6, 'fo_cashier')`,
      [A.tenantId, p, A.b1, JSON.stringify({ source_kind: "uji", source_id: key(), reason: "Retur serum utuh" }), `cr-${key()}`, FO.staffId]);
    for (const r of [FO, FOB2, MGR, MGR12, OWN, FIN]) {
      const g = await as(r, (db) => patientBalance(db, p));
      expect([g.balance, g.patient?.name, g.entries[0].reason], r.role).toEqual([25_000, "Pasien Saldo Rahasia", "Retur serum utuh"]);
    }
    const au = await as(AU, (db) => patientBalance(db, p));
    expect([au.balance, au.patient?.name ?? null, au.entries[0].amount, au.entries[0].reason]).toEqual([25_000, null, 25_000, null]);
    const inv = await bill(FO, p, [{ itemId: serum, quantity: 1 }]);
    expect((await as(AU, (db) => kasirInvoice(db, inv))).patient_balance).toBeNull();
    expect((await as(FO, (db) => kasirInvoice(db, inv))).patient_balance).toBe(25_000);
    for (const r of [DOC, RO]) expect(await code(as(r, (db) => patientBalance(db, p))), r.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(BFO, (db) => patientBalance(db, p)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => patientBalance(db, p)))).toBe("ERR_NOT_FOUND");
    // RLS: the tables read by the cashier roles of the tenant; never the reason column directly; never another tenant.
    const entryId = (await h.admin.query(`select e.id from balance_entries e join balance_accounts a on a.id = e.account_id where a.patient_id = $1`, [p])).rows[0].id;
    const sees = async (r: P) => (await as(r, (db) => db.query(`select id from balance_entries where id = $1`, [entryId]))).rowCount;
    expect([await sees(FO), await sees(FOB2), await sees(OWN), await sees(AU)]).toEqual([1, 1, 1, 1]);
    expect([await sees(DOC), await sees(BFO)]).toEqual([0, 0]);
    expect(await code(as(FO, (db) => db.query(`select reason from balance_entries limit 1`)))).toBe("raw:42501");
    // The active branch revoked mid-transaction (FO of two branches acting at branch 1): the rows are gone at once.
    const fo12 = await person(A, "fo_cashier", A.b1, A.b2);
    const left = await as(fo12, async (db) => {
      const before = (await db.query(`select id from balance_entries where id = $1`, [entryId])).rowCount;
      await h.admin.query(`delete from staff_branches where staff_id = $1 and branch_id = $2`, [fo12.staffId, A.b1]);
      return [before, (await db.query(`select id from balance_entries where id = $1`, [entryId])).rowCount];
    });
    expect(left).toEqual([1, 0]);
    expect(await code(as(FO, (db) => db.query(`select balance_post($1, $2, $3, 'top_up', 1, '{}'::jsonb, 'k-000000001', $4, 'fo_cashier')`, [A.tenantId, p, A.b1, FO.staffId])))).toBe("raw:42501");
  });
});
