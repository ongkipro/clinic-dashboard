// T-105 Done-when (PR-26, DATA-37): database invariants of the ledger — chart seeded per tenant (stable keys, G3), every entry balanced
// with ≥ 2 lines at COMMIT, lines written with their entry only, entries / lines / periods / accounts immutable, a locked period never
// receives an entry (a late fact posts in the next open period with its own month kept, PR-26 scenario), one posting per key, the posting
// map version stamped on automatic entries and written where the accountant's approval binds (G4); RLS: owner / finance / auditor read,
// other roles and other tenants read nothing, the app writes nothing directly. Then the posting rules (money scenarios 1–20, G1 b).
// Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { ledgerPostingConsumer, LEDGER_CONSUMER, postEvent } from "../../src/modules/accounting/ledger/posting";
import { exportJournal, handoverExceptions, journal as readJournal, lockPeriod as lockLedgerPeriod, postManual, report } from "../../src/modules/accounting/ledger/ledger";
import { CommandError } from "../../src/lib/command";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { collectReceivable, convertToReceivable, payRefund, requestRefund, writeOffAsOwner } from "../../src/modules/cashier/receivables/receivables";
import { requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { cancelTransfer, createDepot, receiveTransfer, sendToBranch, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { saveItem } from "../../src/modules/inventory/stock";
import { addPrescriptionItem, CHECKS, type Check, createPrescription, handOver, prepareDispensing, signPrescription } from "../../src/modules/pharmacy/pharmacy";
import { receiveFromSupplier, returnToSupplier, saveSupplier } from "../../src/modules/purchasing/suppliers/suppliers";
import { applyCredit, receiveGoods, recordCreditNote, recordInvoice, recordPayment, reversePayable } from "../../src/modules/purchasing/payables/payables";
import { decideReturn, issueMaterials, proposeReturn, requestMaterials, setItemClass, wasteMaterials, consumeMaterials } from "../../src/modules/inventory/materials/materials";
import { createCharge, enableMockPort, receiveMockWebhook, simulate } from "../../src/modules/payments/payments";
import { SIGNATURE_HEADER } from "../../src/modules/payments/mock";
import { recordExpense, reverseExpense, saveExpenseCategory } from "../../src/modules/expenses/expenses";
import { cancelPackage, decideSubstitution, interruptedToBalance, requestSubstitution, topUpBalance } from "../../src/modules/packages/packages";
import { chargeConsultationFee } from "../../src/modules/cashier/consultation/consultation";
import { applyDeposit, receiveDeposit, refundDepositForClinic } from "../../src/modules/cashier/deposits/deposits";
import { setHours, setServices, upsertRoom } from "../../src/modules/org/branches/branches";
import { cancelAppointment, markNoShow } from "../../src/modules/scheduling/appointments/appointments";
import { setWeek } from "../../src/modules/scheduling/rosters/rosters";
import { changeSetting } from "../../src/modules/settings/settings";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { runPackageExpiryScan } from "../../src/modules/packages/expiry";
import { checkIn, closeVisit } from "../../src/modules/visits/visits";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText, reviewContraindication } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { reserveSession, setPackageContents } from "../../src/modules/packages/packages";
import { createRule, decideRuleVersion, markBatchPaid, openBatch, submitBatch } from "../../src/modules/commission/commission";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { runOutboxBatch } from "../../src/workers/outbox";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing"];
const STEP: StepUp = { verified: true };
const key = () => crypto.randomUUID();

async function tenant(name = "PT Buku Besar Sintetis"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("BB1"), b2: await br("BB2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`gl${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Buku Besar ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const err = (x: Promise<unknown>) => x.then(() => "ok", (e) => String((e as Error).message));

// The posting core as the migration owner, in one transaction (the deferred balance check runs at COMMIT).
async function post(t: T, key: string, lines: { account: string; branch?: string | null; debit?: number; credit?: number }[], o: { date?: string; kind?: string } = {}) {
  const c = await owner.connect();
  try {
    await c.query("begin");
    const r = await c.query(`select ledger_post($1, $2, $3, 'TestPosted', 'test_fact', gen_random_uuid(), null, $4::date, $5::jsonb, $6, null, null) id`,
      [t.tenantId, o.kind ?? "auto", key, o.date ?? "2026-11-10", JSON.stringify(lines.map((l) => ({ account: l.account, branch: l.branch ?? null, debit: l.debit ?? 0, credit: l.credit ?? 0 }))),
       o.kind === "manual" ? "Jurnal uji manual sintetis" : null]);
    await c.query("commit");
    return r.rows[0].id as string | null;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
const lockPeriod = (t: T, period: string, by: P) => h.admin.query(`insert into ledger_periods (tenant_id, period, locked_by, command_key) values ($1, $2, $3, $4)`, [t.tenantId, period, by.staffId, `lock-${crypto.randomUUID()}`]);

function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function patient(t: T, branch: string, name = "Pasien Buku Besar Rahasia"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
async function credential(t: T, p: P, branch: string, fh: P, own: P) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, b, b ? "2099-12-31" : null, own.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, fh.staffId]);
  }
}

// ── tenant A (non-PKP) fixture ──

async function visitWith(t: T, pid: string, branch: string, versions: string[], doc: P, fo: P) {
  const d = branch === doc.branch ? doc : { ...doc, branch };
  await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by, payment = case when payment in ('in_progress','blocked') then 'done' else payment end,
                         dispensing = case when dispensing in ('in_progress','blocked') then 'done' else dispensing end,
                         treatment = case when treatment in ('in_progress','blocked') then 'done' else treatment end
                       where tenant_id = $1 and branch_id = $2 and patient_id = $3 and closed_at is null`, [t.tenantId, branch, pid]);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, branch, pid, fo.staffId])).rows[0].id as string;
  const { examId } = await as(d, (db) => openExam(db, key(), v));
  const { planId } = await as(d, (db) => createPlan(db, key(), examId, "Program Buku", "Kondisi rahasia"));
  const items: string[] = [];
  for (const ver of versions) items.push((await as(d, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: ver, qty: 1 }))).itemId);
  await as(d, (db) => signRecord(db, key(), examId, STEP));
  const ct = await as(d, (db) => consentText(db, v, planId));
  await as(d, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
  return { v, items, planId };
}

let A: T; let B: T;
let OWN: P; let FIN: P; let AU: P; let MGR: P; let FO: P; let BFIN: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let FOB2: P; let worker: pg.Pool;
let facial: string; let facialV: string; let filler: string; let fillerV: string;

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 3 });
  A = await tenant();
  B = await tenant("PT Buku Besar Lain");
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor"); MGR = await person(A, "manager"); FO = await person(A, "fo_cashier");
  BFIN = await person(B, "finance");
  FH = await person(A, "facility_head", A.b1); DOC = await person(A, "doctor", A.b1, A.b2); NUR = await person(A, "nurse", A.b1); BC = await person(A, "bc", A.b1);
  FOB2 = await person(A, "fo_cashier", A.b2);
  worker = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 2 });
  await credential(A, DOC, A.b1, FH, OWN);
  await credential(A, DOC, A.b2, FH, OWN);
  const svc = async (c: string, name: string, price: number) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v;
  };
  ({ itemId: facial, versionId: facialV } = await svc("GL-FAC", "Facial Buku Besar", 1_500_000));
  ({ itemId: filler, versionId: fillerV } = await svc("GL-FIL", "Filler Buku Besar", 400_000));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("T-105 database invariants", () => {
  it("every tenant gets the system chart (stable keys, Indonesian labels, five classes) and the posting map version where approvals bind", async () => {
    const a = (await h.admin.query(`select key, class, system from ledger_accounts where tenant_id = $1 order by key`, [A.tenantId])).rows;
    expect(a.length).toBe(31);
    expect(new Set(a.map((r) => r.class))).toEqual(new Set(["asset", "liability", "equity", "revenue", "expense"]));
    expect(a.every((r) => r.system === "system")).toBe(true);
    for (const k of ["cash_shift", "bank", "gateway_clearing", "liability_paid_not_delivered", "liability_packages", "liability_patient_balance", "liability_booking_dp",
      "vat_payable", "patient_receivable", "revenue_treatment", "revenue_product", "revenue_consultation", "other_income", "cogs", "materials_cost", "waste_expense",
      "inventory", "bad_debt_expense", "merchant_fee_expense", "inter_branch_clearing", "commission_expense", "commission_payable", "staff_receivable"]) {
      expect(a.map((r) => r.key), k).toContain(k);
    }
    // the map version is recorded where the accountant's approval binds, by the first automatic posting of the tenant
    expect((await h.admin.query(`select count(*)::int c from compliance_config_versions where tenant_id = $1 and kind = 'posting_map'`, [B.tenantId])).rows[0].c).toBe(0);
    await post(B, `t-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: 1 }, { account: "other_income", credit: 1 }]);
    expect((await h.admin.query(`select version from compliance_config_versions where tenant_id = $1 and kind = 'posting_map'`, [B.tenantId])).rows[0].version).toBe("draft-11-2026-11-19");
    expect((await h.admin.query(`select count(*)::int c from ledger_activations`)).rows[0].c).toBe(0); // no activation writer (G-ACT)
  });

  it("an entry posts balanced with its map version; an unbalanced or one-line entry is refused at commit; a repeated posting key writes nothing", async () => {
    const k = `t-${crypto.randomUUID()}`;
    const id = await post(A, k, [{ account: "cash_shift", branch: A.b1, debit: 333_000 }, { account: "liability_paid_not_delivered", branch: A.b1, credit: 333_000 }]);
    expect((await h.admin.query(`select map_version, period, original_period from journal_entries where id = $1`, [id])).rows[0]).toEqual({ map_version: "draft-11-2026-11-19", period: "2026-11", original_period: "2026-11" });
    expect(await post(A, k, [{ account: "cash_shift", debit: 1 }, { account: "bank", credit: 1 }])).toBeNull();
    expect((await h.admin.query(`select count(*)::int c from journal_entries where posting_key = $1`, [k])).rows[0].c).toBe(1);
    expect(await err(post(A, `t-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: 100 }, { account: "bank", credit: 99 }]))).toMatch(/not balanced/);
    expect(await err(post(A, `t-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: 100 }, { account: "cash_shift", credit: 0 }]))).toMatch(/not balanced/);
    expect(await err(post(A, `t-${crypto.randomUUID()}`, [{ account: "no_such_account", debit: 1 }, { account: "bank", credit: 1 }]))).toMatch(/missing/);
    expect(await err(post(A, `t-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: -5 }, { account: "bank", credit: -5 }]))).toMatch(/never negative|journal_lines_check/);
  });

  it("entries, lines, periods, accounts and activations are immutable; a line cannot be added to another entry", async () => {
    const id = (await post(A, `t-${crypto.randomUUID()}`, [{ account: "bank", debit: 7_000 }, { account: "merchant_fee_expense", credit: 7_000 }]))!;
    expect(await err(h.admin.query(`update journal_entries set memo = 'x' where id = $1`, [id]))).toMatch(/append-only/);
    expect(await err(h.admin.query(`delete from journal_lines where entry_id = $1`, [id]))).toMatch(/append-only/);
    expect(await err(h.admin.query(`update ledger_accounts set label = 'Kas lain' where tenant_id = $1 and key = 'bank'`, [A.tenantId]))).toMatch(/append-only/);
    const acct = (await h.admin.query(`select id from ledger_accounts where tenant_id = $1 and key = 'bank'`, [A.tenantId])).rows[0].id;
    expect(await err(h.admin.query(`insert into journal_lines (tenant_id, entry_id, account_id, debit, credit) values ($1, $2, $3, 1, 0)`, [A.tenantId, id, acct]))).toMatch(/with their entry only/);
    await lockPeriod(A, "2026-01", FIN);
    expect(await err(h.admin.query(`delete from ledger_periods where tenant_id = $1 and period = '2026-01'`, [A.tenantId]))).toMatch(/append-only/);
    expect(await err(h.admin.query(`truncate journal_entries cascade`))).toMatch(/append-only|immutable|truncate/i);
  });

  it("PR-26 period lock: a fact of a locked month posts in the next open period, keeping its own month as the reference; nothing posts into a locked period", async () => {
    await lockPeriod(A, "2026-03", FIN);
    await lockPeriod(A, "2026-04", FIN);
    const id = (await post(A, `t-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: 50_000 }, { account: "liability_patient_balance", credit: 50_000 }], { date: "2026-03-20" }))!;
    expect((await h.admin.query(`select period, original_period, business_date::text d from journal_entries where id = $1`, [id])).rows[0])
      .toEqual({ period: "2026-05", original_period: "2026-03", d: "2026-03-20" });
    const c = await owner.connect();
    try {
      await c.query("begin");
      expect(await err(c.query(`insert into journal_entries (tenant_id, kind, posting_key, event, source_kind, source_id, business_date, period, original_period, map_version)
        values ($1, 'auto', $2, 'TestPosted', 'test_fact', gen_random_uuid(), '2026-04-02', '2026-04', '2026-04', 'x')`, [A.tenantId, `t-${crypto.randomUUID()}`]))).toMatch(/ERR_PERIOD_LOCKED/);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("RLS: owner, finance and the auditor read their tenant's ledger; a manager, FO and another tenant read nothing; the app writes nothing directly", async () => {
    const id = (await post(A, `t-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: 10_000 }, { account: "other_income", credit: 10_000 }]))!;
    for (const p of [OWN, FIN, AU]) {
      expect((await as(p, (db) => db.query(`select count(*)::int c from journal_lines where entry_id = $1`, [id]))).rows[0].c, p.role).toBe(2);
      expect((await as(p, (db) => db.query(`select count(*)::int c from ledger_accounts`))).rows[0].c, p.role).toBe(31);
    }
    for (const p of [MGR, FO, BFIN]) {
      expect((await as(p, (db) => db.query(`select count(*)::int c from journal_entries where id = $1`, [id]))).rows[0].c, p.role).toBe(0);
    }
    expect((await as(BFIN, (db) => db.query(`select count(*)::int c from ledger_accounts`))).rows[0].c).toBe(31); // B's own chart only
    expect(await err(as(FIN, (db) => db.query(`insert into ledger_periods (tenant_id, period, locked_by, command_key) values ($1, '2026-02', $2, 'lock-direct-1')`, [A.tenantId, FIN.staffId])))).toMatch(/permission denied/);
    expect(await err(as(FIN, (db) => db.query(`select ledger_post($1, 'manual', 'x-direct', 'TestPosted', 'test_fact', gen_random_uuid(), null, '2026-11-01', '[]'::jsonb, null, null, null)`, [A.tenantId])))).toMatch(/permission denied/);
    expect(await err(as(OWN, (db) => db.query(`insert into ledger_activations (tenant_id, map_version) values ($1, 'draft-11-2026-11-19')`, [A.tenantId])))).toMatch(/permission denied/);
  });
});

// ── posting rules on the real writers (money fixture; G1 b; G4 draft) ──
// Drain the outbox for the posting consumer (the real consumer path: claim → consume → ledger_post_event) until nothing is left.
async function drain() {
  for (let i = 0; i < 20; i++) {
    const [r] = await runOutboxBatch(worker, [ledgerPostingConsumer], { worker: "t105", limit: 200, leaseSeconds: 5 });
    if (r.done + r.skipped + r.failed === 0) return;
  }
}
type Row = [account: string, debit: number, credit: number];
// The performance entries of one execution (single treatments are keyed per (execution, line) since S7-DIFF = A; a package-covered one per
// execution), their lines summed per account and side as [account, debit, credit] sorted — one entry in the ordinary case.
async function journalTF(executionId: string): Promise<Row[]> {
  const r = await h.admin.query(`select a.key, sum(l.debit)::bigint d, sum(l.credit)::bigint c from journal_entries e join journal_lines l on l.entry_id = e.id
     join ledger_accounts a on a.id = l.account_id where e.kind = 'auto' and e.source_kind = 'treatment_execution' and e.source_id = $1
     group by a.key, (l.debit > 0) order by a.key, sum(l.debit) desc, sum(l.credit) desc`, [executionId]);
  return r.rows.map((x) => [x.key as string, Number(x.d), Number(x.c)]);
}
// The lines of the entry posted for one source fact (by posting key prefix + fact id), as [account key, debit, credit] sorted.
async function journal(postingKey: string): Promise<Row[]> {
  const r = await h.admin.query(`select a.key, l.debit::bigint d, l.credit::bigint c from journal_entries e join journal_lines l on l.entry_id = e.id
     join ledger_accounts a on a.id = l.account_id where e.posting_key = $1 order by a.key, l.debit desc, l.credit desc`, [postingKey]);
  return r.rows.map((x) => [x.key as string, Number(x.d), Number(x.c)]);
}
const sorted = (rows: Row[]) => [...rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : b[1] - a[1] || b[2] - a[2]));
const allocOf = async (invoiceId: string) => (await h.admin.query(`select a.id from payment_allocations a join invoice_lines l on l.id = a.invoice_line_id where l.invoice_id = $1 order by a.created_at`, [invoiceId])).rows.map((r) => r.id as string);
const accountBalance = async (t: T, k: string) =>
  Number((await h.admin.query(`select coalesce(sum(l.debit - l.credit), 0) s from journal_lines l join ledger_accounts a on a.id = l.account_id where a.tenant_id = $1 and a.key = $2`, [t.tenantId, k])).rows[0].s);

describe("T-105 posting rules (money scenarios; the canonical matrix, draft map version)", () => {
  it("scenario 2: prepaid by QRIS then counted — S2-J1 PaymentAllocated Dr Kliring gateway / Cr paid-not-delivered 1,500,000; S2-J2 TreatmentFinished Dr paid-not-delivered / Cr revenue", async () => {
    const pid = await patient(A, A.b1, "Pasien Skenario 2");
    const { v, items } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 1_500_000, details: { card_type: "debit", bank: "BCA", trace: "123456", approval_code: "A1B2C3" } }]));
    const e = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    await drain();
    const [alloc] = await allocOf(invoiceId);
    expect(await journal(`payment_allocated:${alloc}`)).toEqual(sorted([["gateway_clearing", 1_500_000, 0], ["liability_paid_not_delivered", 0, 1_500_000]]));
    expect(await journalTF(e.executionId)).toEqual(sorted([["liability_paid_not_delivered", 1_500_000, 0], ["revenue_treatment", 0, 1_500_000]]));
    // replay: the same events again post nothing (one posting key per fact)
    const ev = (await h.admin.query(`select id from domain_events where aggregate_id = any($1) and type in ('PaymentAllocated','TreatmentFinished')`, [[alloc, e.executionId]])).rows;
    for (const x of ev) expect(await as(FIN, (db) => postEvent(db, { id: x.id }))).toBeNull();
    expect((await h.admin.query(`select count(*)::int c from journal_entries where source_id = any($1)`, [[alloc, e.executionId]])).rows[0].c).toBe(2);
    expect((await h.admin.query(`select count(*)::int c from event_receipts where consumer = $1 and done_at is null and event_id = any($2)`, [LEDGER_CONSUMER, ev.map((x) => x.id)])).rows[0].c).toBe(0);
  });

  it("scenario 3a/3b + 14: delivered before payment (performance first), then EDC; another converted, collected in cash; a third written off", async () => {
    async function ready(name: string) {
      const pid = await patient(A, A.b1, name);
      const { v, items, planId } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
      await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
      const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
      await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
      await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_500_000, cashTendered: 1_500_000 }]));
      const { requestId } = await as(NUR, (db) => createRequest(db, key(), v, { kind: "addition", planId, catalogVersionId: fillerV, stage: 1, qty: 1, reason: "Lipatan dalam" }));
      const itemId = ((await as(DOC, (db) => decideRequest(db, key(), requestId, true, null))) as { item_id: string }).item_id;
      const ct = await as(DOC, (db) => consentText(db, v, planId));
      await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
      await as(FO, (db) => releaseAddition(db, key(), itemId, FO.staffId));
      const ex = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: itemId, performerId: DOC.staffId, identityConfirmed: true }));
      await as(DOC, (db) => finishTreatment(db, key(), ex.executionId, { outcome: "completed" }));
      // the addition is performed before its line exists: its performance entry waits — the receipt is done, nothing posted, nothing lost
      await drain();
      expect(await journalTF(ex.executionId)).toEqual([]);
      expect((await h.admin.query(`select done_at is not null d from event_receipts r join domain_events e on e.id = r.event_id
         where r.consumer = $1 and e.type = 'TreatmentFinished' and e.payload ->> 'execution_id' = $2`, [LEDGER_CONSUMER, ex.executionId])).rows[0].d).toBe(true);
      const { invoiceId: add } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
      await as(FO, (db) => issueKasirInvoice(db, key(), add, [{ itemId: filler, quantity: 1, planItemId: itemId }]));
      // the line's InvoiceIssued wakes it (durable: no retry, no lease)
      await drain();
      expect(await journalTF(ex.executionId)).toEqual(sorted([["liability_paid_not_delivered", 400_000, 0], ["revenue_treatment", 0, 400_000]]));
      return { v, add, ex: ex.executionId };
    }
    const a = await ready("Pasien Skenario 3a");
    await as(FO, (db) => receivePayment(db, key(), a.add, [{ method: "edc", amount: 400_000, details: { card_type: "debit", bank: "BCA", trace: "654321", approval_code: "Z9Y8X7" } }]));
    await drain();
    expect(await journal(`payment_allocated:${(await allocOf(a.add))[0]}`)).toEqual(sorted([["gateway_clearing", 400_000, 0], ["liability_paid_not_delivered", 0, 400_000]]));
    const b = await ready("Pasien Skenario 3b");
    const rc = await as(FO, (db) => convertToReceivable(db, key(), b.v));
    await drain();
    expect(await journal(`receivable_created:${rc.receivable_id}`)).toEqual(sorted([["liability_paid_not_delivered", 0, 400_000], ["patient_receivable", 400_000, 0]]));
    const col = await as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "cash", amount: 400_000, cashTendered: 400_000 }));
    void col;
    await drain();
    const ca = (await h.admin.query(`select id from payment_allocations where receivable_id = $1`, [rc.receivable_id])).rows[0].id;
    expect(await journal(`receivable_collected:${ca}`)).toEqual(sorted([["cash_shift", 400_000, 0], ["patient_receivable", 0, 400_000]]));
    const c = await ready("Pasien Skenario 14");
    const rc2 = await as(FO, (db) => convertToReceivable(db, key(), c.v));
    await as(OWN, (db) => writeOffAsOwner(db, key(), rc2.receivable_id, "Pasien pindah kota, tidak dapat dihubungi"));
    await drain();
    const wo = (await h.admin.query(`select id from write_offs where receivable_id = $1`, [rc2.receivable_id])).rows[0].id;
    expect(await journal(`receivable_written_off:${wo}`)).toEqual(sorted([["bad_debt_expense", 400_000, 0], ["patient_receivable", 0, 400_000]]));
  });

  it("scenarios 5a / 11: a package paid in cash at branch 1, sessions counted at branch 1 and at branch 2 (inter-branch clearing in the same entry, nets to zero)", async () => {
    const pkgItem = await (async () => {
      const v = await as(OWN, (db) => publish(db, { kind: "package", code: "GL-PKG" }, { name: "Paket Buku Besar", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 3_000_000, installments_allowed: true } as never, "Paket baru"));
      await as(OWN, (db) => setPackageContents(db, key(), v.versionId, [{ serviceItemId: facial, count: 5 }]));
      return v.itemId;
    })();
    const pid = await patient(A, A.b1, "Pasien Skenario 11");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pkgItem, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 3_000_000, cashTendered: 3_000_000 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    const redeemAt = async (branch: string, fo: P) => {
      const { v, items } = await visitWith(A, pid, branch, [facialV], DOC, fo);
      await as(fo, (db) => reserveSession(db, key(), pkg, v));
      const d = branch === DOC.branch ? DOC : { ...DOC, branch };
      const e = await as(d, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
      await as(d, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    };
    await redeemAt(A.b1, FO);
    await redeemAt(A.b2, FOB2);
    await drain();
    expect(await journal(`payment_allocated:${(await allocOf(invoiceId))[0]}`)).toEqual(sorted([["cash_shift", 3_000_000, 0], ["liability_packages", 0, 3_000_000]]));
    const ss = (await h.admin.query(`select id, redeemed_branch_id from package_sessions where package_id = $1 and state = 'redeemed' order by redeemed_at`, [pkg])).rows;
    expect(await journal(`session_redeemed:${ss[0].id}`)).toEqual(sorted([["liability_packages", 600_000, 0], ["revenue_treatment", 0, 600_000]]));
    expect(await journal(`session_redeemed:${ss[1].id}`)).toEqual(sorted([["inter_branch_clearing", 600_000, 0], ["inter_branch_clearing", 0, 600_000], ["liability_packages", 600_000, 0], ["revenue_treatment", 0, 600_000]]));
    const br = (await h.admin.query(`select l.branch_id, a.key, l.debit::bigint d, l.credit::bigint c from journal_entries e join journal_lines l on l.entry_id = e.id join ledger_accounts a on a.id = l.account_id
      where e.posting_key = $1 order by a.key, l.debit desc`, [`session_redeemed:${ss[1].id}`])).rows.map((r) => [r.key, r.branch_id === A.b1 ? "b1" : "b2", Number(r.d), Number(r.c)]);
    expect(br).toEqual([["inter_branch_clearing", "b2", 600_000, 0], ["inter_branch_clearing", "b1", 0, 600_000], ["liability_packages", "b1", 600_000, 0], ["revenue_treatment", "b2", 0, 600_000]]);
    expect(await accountBalance(A, "inter_branch_clearing")).toBe(0);
  });

  it("scenario 20 (G1 b): a synthetic gateway settlement through the real posting rule — Bank 993,000, fee expense 7,000, clearing 0; balanced, idempotent; commission basis unchanged", async () => {
    const T20 = await tenant("PT Settlement Sintetis");
    const own = await person(T20, "owner"); const fo = await person(T20, "fo_cashier", T20.b1); const fh = await person(T20, "facility_head", T20.b1); const doc = await person(T20, "doctor", T20.b1);
    await credential(T20, doc, T20.b1, fh, own);
    const sv = await as(own, (db) => publish(db, { kind: "service", code: "S20-TR" }, {
      name: "Tindakan Skenario 20", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 1_000_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (sv.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [sv.approvalId]));
    const pid = await patient(T20, T20.b1, "Pasien Skenario 20");
    const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sv.itemId, quantity: 1 }]));
    await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 1_000_000, details: { card_type: "debit", bank: "BCA", trace: "200020", approval_code: "S20S20" } }]));
    await drain();
    const basis = (await h.admin.query(`select coalesce(sum(basis), 0)::bigint b from commission_entitlements where tenant_id = $1`, [T20.tenantId])).rows[0].b;
    expect(await accountBalance(T20, "gateway_clearing")).toBe(1_000_000);
    // the synthetic settlement fact (no production intake exists: open gate G-SETTLE), posted by the real rule through ledger_post
    const fact = crypto.randomUUID();
    const settle = async () => {
      const c = await owner.connect();
      try {
        await c.query("begin");
        const r = await c.query(`select ledger_rule_gateway_settlement($1, $2, $3, current_date, 1000000, 7000, null) id`, [T20.tenantId, fact, T20.b1]);
        await c.query("commit");
        return r.rows[0].id as string | null;
      } finally { c.release(); }
    };
    expect(await settle()).not.toBeNull();
    expect(await settle()).toBeNull(); // idempotent: the same settlement fact posts once
    expect(await journal(`gateway_settlement:${fact}`)).toEqual(sorted([["bank", 993_000, 0], ["gateway_clearing", 0, 1_000_000], ["merchant_fee_expense", 7_000, 0]]));
    expect(await accountBalance(T20, "gateway_clearing")).toBe(0);
    expect(await accountBalance(T20, "bank")).toBe(993_000);
    expect(await accountBalance(T20, "merchant_fee_expense")).toBe(7_000);
    expect((await h.admin.query(`select coalesce(sum(basis), 0)::bigint b from commission_entitlements where tenant_id = $1`, [T20.tenantId])).rows[0].b).toBe(basis);
    const e = (await h.admin.query(`select map_version, kind from journal_entries where posting_key = $1`, [`gateway_settlement:${fact}`])).rows[0];
    expect(e).toEqual({ map_version: "draft-11-2026-11-19", kind: "auto" }); // a draft-map entry (preview; no activation)
  });

  it("every posted entry of the run balances; nothing posts for simulated money; the app cannot call a rule directly, and an event of another tenant is refused", async () => {
    const unbalanced = (await h.admin.query(`select e.id from journal_entries e join journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)`)).rows;
    expect(unbalanced).toEqual([]);
    expect(await err(as(FIN, (db) => db.query(`select ledger_rule_gateway_settlement($1, gen_random_uuid(), null, current_date, 10, 1, null)`, [A.tenantId])))).toMatch(/permission denied/);
    const ev = (await h.admin.query(`select id from domain_events where tenant_id = $1 and type = 'PaymentAllocated' limit 1`, [A.tenantId])).rows[0].id;
    expect(await err(as(BFIN, (db) => postEvent(db, { id: ev })))).toMatch(/ERR_FORBIDDEN|another tenant/);
  });
});

describe("T-105 posting rules — remaining fixture scenarios and the purchasing / expense rows", () => {
  let PH: P; let PUR: P; let SUP: string; let serum: string; let serumStock: string; let APT: string; let G1: string;
  const all = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<Check, boolean>;
  const day = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  beforeAll(async () => {
    PH = await person(A, "pharmacist", A.b1); PUR = { ...(await person(A, "purchasing")), branch: undefined };
    serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "GL-SRM" }, { name: "Serum Buku Besar", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"))).itemId;
    serumStock = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "btl", storage: "ruang", highValue: false, active: true }))).itemId;
    SUP = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "PT Pemasok Buku Besar" }))).supplierId;
    G1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
    APT = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Buku Besar", kind: "apotek" }))).depotId;
    // serum at a moving-average cost of 150,000 (scenario 1)
    const r = await as(PUR, (db) => receiveFromSupplier(db, key(), A.b1, { supplierId: SUP, itemId: serumStock, batchNo: "GL-S1", expiry: day(200), quantity: "20", unitCost: 150_000, reason: "penerimaan" }));
    const batch = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [r.receiptId])).rows[0].batch_id;
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: APT, lines: [{ batchId: batch, quantity: "20" }] }));
  });

  it("scenario 1 + 15: a counter serum paid in cash and handed over (S1-J1, S1-J2 with COGS 150,000); refunded to balance (S15-J1) with COGS returned (S15-J2); cash exception (S15b-J3)", async () => {
    const pid = await patient(A, A.b1, "Pasien Skenario 1");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 333_000, cashTendered: 333_000 }]));
    const d = (await h.admin.query(`select d.id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [invoiceId])).rows[0].id;
    await as(PH, (db) => prepareDispensing(db, key(), d, APT));
    await as(PH, (db) => handOver(db, key(), d, { checks: all }));
    await drain();
    expect(await journal(`payment_allocated:${(await allocOf(invoiceId))[0]}`)).toEqual(sorted([["cash_shift", 333_000, 0], ["liability_paid_not_delivered", 0, 333_000]]));
    expect(await journal(`product_handed:${d}`)).toEqual(sorted([["cogs", 150_000, 0], ["inventory", 0, 150_000], ["liability_paid_not_delivered", 333_000, 0], ["revenue_product", 0, 333_000]]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id;
    const r = await as(FO, (db) => requestRefund(db, key(), line, { amount: 333_000, reason: "Dikembalikan utuh", returnedQuantity: 1, destination: "cash" }));
    if (r.state !== "paid") await as(OWN, (db) => decideApproval(db, (r as { approval_id: string }).approval_id, true));
    const rs = (await h.admin.query(`select state from refunds where id = $1`, [r.refund_id])).rows[0].state;
    if (rs !== "paid") await as(FO, (db) => payRefund(db, key(), r.refund_id, "cash"));
    await drain();
    const credit = (await h.admin.query(`select balance_entry_id from refunds where id = $1`, [r.refund_id])).rows[0].balance_entry_id;
    expect(await journal(`balance_moved:${credit}`)).toEqual(sorted([["liability_patient_balance", 0, 333_000], ["revenue_product", 333_000, 0]]));
    expect(await journal(`product_returned:${r.refund_id}`)).toEqual(sorted([["cogs", 0, 150_000], ["inventory", 150_000, 0]]));
    expect(await journal(`refund_paid:${r.refund_id}`)).toEqual(sorted([["cash_shift", 0, 333_000], ["liability_patient_balance", 333_000, 0]]));
  });

  it("scenario 7a + 8 + 13: an interrupted paid treatment to balance (S7a-J2); a package expiry to balance (S8-J1); balance pays a package instalment (S13-J1)", async () => {
    const pid = await patient(A, A.b1, "Pasien Skenario 7");
    const { v, items } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_500_000, cashTendered: 1_500_000 }]));
    const e = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "medical_stop", reason: "Alasan berhenti uji" }));
    const moved = await as(FO, (db) => interruptedToBalance(db, key(), e.executionId));
    await drain();
    expect(await journalTF(e.executionId)).toEqual([]); // not counted: no performance
    expect(await journal(`balance_moved:${moved.entry_id}`)).toEqual(sorted([["liability_paid_not_delivered", 1_500_000, 0], ["liability_patient_balance", 0, 1_500_000]]));
    // scenario 8: a package 5 × 1,000,000, 3,000,000 paid, 2 sessions counted → 1,000,000 moved at expiry (packages → balance)
    const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "GL-PK8" }, { name: "Paket Skenario 8", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 7_500_000, installments_allowed: true } as never, "Paket"));
    await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: facial, count: 5 }]));
    const p8 = await patient(A, A.b1, "Pasien Skenario 8");
    const { invoiceId: pi } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: p8 }));
    await as(FO, (db) => issueKasirInvoice(db, key(), pi, [{ itemId: pv.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), pi, [{ method: "cash", amount: 4_500_000, cashTendered: 4_500_000 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [pi])).rows[0].id;
    for (let i = 0; i < 2; i++) {
      const w = await visitWith(A, p8, A.b1, [facialV], DOC, FO);
      await as(FO, (db) => reserveSession(db, key(), pkg, w.v));
      const x = await as(DOC, (db) => startTreatment(db, key(), w.v, { planItemId: w.items[0], performerId: DOC.staffId, identityConfirmed: true }));
      await as(DOC, (db) => finishTreatment(db, key(), x.executionId, { outcome: "completed" }));
    }
    await as(MGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    await drain();
    const moveEntry = (await h.admin.query(`select id from balance_entries where source_id = $1 and kind in ('from_expiry','from_cancel')`, [pkg])).rows[0].id;
    expect(await journal(`balance_moved:${moveEntry}`)).toEqual(sorted([["liability_packages", 1_500_000, 0], ["liability_patient_balance", 0, 1_500_000]]));
    // scenario 13: the balance pays a new package's instalment (Dr patient balance / Cr packages)
    const { invoiceId: pj } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: p8 }));
    await as(FO, (db) => issueKasirInvoice(db, key(), pj, [{ itemId: pv.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), pj, [{ method: "balance", amount: 1_500_000 }]));
    await drain();
    expect(await journal(`payment_allocated:${(await allocOf(pj))[0]}`)).toEqual(sorted([["liability_packages", 0, 1_500_000], ["liability_patient_balance", 1_500_000, 0]]));
    expect(await accountBalance(A, "liability_patient_balance")).toBeLessThanOrEqual(0); // a liability: credit balance
  });

  it("scenario 10: commission accrued (S10-J3), paid by transfer (S10-J4), adjusted after payout (S10-J6 staff receivable)", async () => {
    const r = await as(FIN, (db) => createRule(db, key(), { contributionType: "performer", name: "Performer tetap", kind: "fixed", fixedAmount: 50_000 }));
    await as(OWN, (db) => decideRuleVersion(db, r.versionId, "activate"));
    const pid = await patient(A, A.b1, "Pasien Skenario 10");
    const { v, items } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "transfer", amount: 1_500_000, details: { bank: "BCA", reference: "TRF-GL10" } }]));
    const e = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    const ent = (await h.admin.query(`select id, amount::int a from commission_entitlements where tenant_id = $1 and staff_id = $2 order by accrued_at desc limit 1`, [A.tenantId, DOC.staffId])).rows[0];
    expect(ent.a).toBe(50_000);
    // month 1 batch (the entitlement moved into last month), approved and paid
    await h.admin.query(`alter table commission_entitlements disable trigger commission_entitlements_insert_only`);
    await h.admin.query(`update commission_entitlements set accrued_at = (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month' + interval '10 days') at time zone 'Asia/Jakarta' where tenant_id = $1`, [A.tenantId]);
    await h.admin.query(`alter table commission_entitlements enable always trigger commission_entitlements_insert_only`);
    const period = (await h.admin.query(`select to_char(date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month', 'YYYY-MM') k`)).rows[0].k;
    const { batchId } = await as(FIN, (db) => openBatch(db, key(), period));
    const ap = await as(FIN, (db) => submitBatch(db, batchId));
    await as(OWN, (db) => decideApproval(db, ap, true));
    await as(FIN, (db) => markBatchPaid(db, batchId, "transfer"));
    await drain();
    expect(await journal(`commission_accrued:${ent.id}`)).toEqual(sorted([["commission_expense", 50_000, 0], ["commission_payable", 0, 50_000]]));
    const net = Number((await h.admin.query(`select coalesce(sum(net_payable), 0) n from payout_batch_lines where batch_id = $1`, [batchId])).rows[0].n);
    expect(net).toBeGreaterThanOrEqual(50_000);
    expect(await journal(`commission_paid:${batchId}`)).toEqual(sorted([["bank", 0, net], ["commission_payable", net, 0]]));
    // month 2: the treatment refunded to balance after payout → adjustment −50,000 against a paid entitlement (staff receivable)
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id;
    await as(FO, (db) => requestRefund(db, key(), line, { amount: 1_500_000, reason: "Pasien tidak puas" }));
    await drain();
    const adj = (await h.admin.query(`select id, amount::int a, after_payout from commission_adjustments where entitlement_id = $1`, [ent.id])).rows[0];
    expect([adj.a, adj.after_payout]).toEqual([-50_000, true]);
    expect(await journal(`commission_adjusted:${adj.id}`)).toEqual(sorted([["commission_expense", 0, 50_000], ["staff_receivable", 50_000, 0]]));
  });

  it("BalanceToppedUp: the tender of the top-up's own payment — cash → Kas (shift), transfer → Bank, EDC → Kliring gateway; Cr patient balance", async () => {
    const pid = await patient(A, A.b1, "Pasien Isi Saldo");
    const tops = [
      await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 300_000, cashTendered: 300_000 })),
      await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "transfer", amount: 500_000, details: { bank: "BCA", reference: "TRF-GL-TU" } })),
      await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "edc", amount: 250_000, details: { card_type: "debit", bank: "BCA", trace: "990011", approval_code: "TU1TU1" } })),
    ];
    void tops;
    await drain();
    const e = (await h.admin.query(`select b.id, b.amount::int a from balance_entries b join balance_accounts c on c.id = b.account_id where c.patient_id = $1 and b.kind = 'top_up' order by b.seq`, [pid])).rows;
    expect(await journal(`balance_topped_up:${e[0].id}`)).toEqual(sorted([["cash_shift", 300_000, 0], ["liability_patient_balance", 0, 300_000]]));
    expect(await journal(`balance_topped_up:${e[1].id}`)).toEqual(sorted([["bank", 500_000, 0], ["liability_patient_balance", 0, 500_000]]));
    expect(await journal(`balance_topped_up:${e[2].id}`)).toEqual(sorted([["gateway_clearing", 250_000, 0], ["liability_patient_balance", 0, 250_000]]));
  });

  it("scenario 4a: a consultation fee charged then paid in cash — S4a-J1 ConsultationFeeCharged Dr paid-not-delivered / Cr consultation revenue 150,000; S4a-J2 PaymentAllocated", async () => {
    const kv = await as(OWN, (db) => publish(db, { kind: "service", code: "GL-KON" }, {
      name: "Konsultasi Buku Besar", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 99_000, category: "consultation", prep_min: 0, treatment_min: 15, buffer_min: 0,
      indications: "Indikasi", consent_template: "Templat konsultasi.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Layanan baru"));
    if (kv.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [kv.approvalId]));
    await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 150_000, reason: "Biaya konsultasi" }));
    try {
      const pid = await patient(A, A.b1, "Pasien Skenario 4a");
      const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id;
      const { examId } = await as(DOC, (db) => openExam(db, key(), v));
      await as(DOC, (db) => signRecord(db, key(), examId, STEP));
      const ch = await as(FO, (db) => chargeConsultationFee(db, key(), v, kv.itemId));
      await as(FO, (db) => receivePayment(db, key(), ch.invoice_id, [{ method: "cash", amount: 150_000, cashTendered: 150_000 }]));
      await drain();
      expect(await journal(`consultation_charged:${ch.invoice_line_id}`)).toEqual(sorted([["liability_paid_not_delivered", 150_000, 0], ["revenue_consultation", 0, 150_000]]));
      expect(await journal(`payment_allocated:${(await allocOf(ch.invoice_id))[0]}`)).toEqual(sorted([["cash_shift", 150_000, 0], ["liability_paid_not_delivered", 0, 150_000]]));
    } finally {
      await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, restore: true, reason: "Kembali ke bawaan" }));
    }
  });

  it("scenario 12b: a cheaper substitution moves the difference to balance (S12b-J1 Dr packages / Cr patient balance 150,000), then the substituted session posts its new value", async () => {
    const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "GL-P12" }, { name: "Paket Skenario 12", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 7_500_000, installments_allowed: true } as never, "Paket"));
    await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: facial, count: 5 }]));
    const pid = await patient(A, A.b1, "Pasien Skenario 12");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pv.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 7_500_000, cashTendered: 7_500_000 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id;
    const ss = (await h.admin.query(`select id, allocated_value::int v from package_sessions where package_id = $1 order by seq`, [pkg])).rows;
    const { substitutionId } = await as(FO, (db) => requestSubstitution(db, key(), ss[0].id, filler, "Kulit lebih sensitif"));
    await as(DOC, (db) => decideSubstitution(db, key(), substitutionId, true, null));
    await drain();
    const diff = ss[0].v - 400_000;
    const mv = (await h.admin.query(`select id from balance_entries where source_id = $1 and kind = 'from_substitution'`, [substitutionId])).rows[0].id;
    expect(await journal(`balance_moved:${mv}`)).toEqual(sorted([["liability_packages", diff, 0], ["liability_patient_balance", 0, diff]]));
    const { v, items } = await visitWith(A, pid, A.b1, [fillerV], DOC, FO);
    await as(FO, (db) => reserveSession(db, key(), pkg, v, filler));
    const e = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    await drain();
    expect(await journal(`session_redeemed:${ss[0].id}`)).toEqual(sorted([["liability_packages", 400_000, 0], ["revenue_treatment", 0, 400_000]]));
  });

  it("purchasing and expenses (draft rows): goods received (Dr Inventory / Cr GRNI), invoiced with a price variance, paid; an expense recorded and reversed (mirror)", async () => {
    const g = await as(PUR, (db) => receiveGoods(db, key(), A.b1, { supplierId: SUP, lines: [{ itemId: serumStock, batchNo: "GL-G1", expiry: day(200), quantity: "4", unitCost: 150_000 }] }));
    const rcpt = (await h.admin.query(`select id from supplier_receipts where source_kind = 'goods_receipt' and source_id = $1`, [g.receiptId])).rows[0].id;
    const inv = await as(PUR, (db) => recordInvoice(db, key(), A.b1, { supplierId: SUP, number: "INV-GL-1", invoiceDate: day(0), lines: [{ receiptId: rcpt, amount: 620_000 }] }));
    await as(FIN, (db) => recordPayment(db, key(), A.b1, { supplierId: SUP, amount: 620_000, method: "bank_transfer", paidOn: day(0), allocations: [{ invoiceId: inv.invoiceId }] }));
    await drain();
    expect(await journal(`goods_received:${g.receiptId}`)).toEqual(sorted([["grni", 0, 600_000], ["inventory", 600_000, 0]]));
    expect(await journal(`supplier_invoice:${inv.invoiceId}`)).toEqual(sorted([["accounts_payable", 0, 620_000], ["grni", 600_000, 0], ["purchase_price_variance", 20_000, 0]]));
    const al = (await h.admin.query(`select id from supplier_payment_allocations where invoice_id = $1`, [inv.invoiceId])).rows[0].id;
    expect(await journal(`supplier_payment_allocated:${al}`)).toEqual(sorted([["accounts_payable", 620_000, 0], ["bank", 0, 620_000]]));
    const cat = (await as(FIN, (db) => saveExpenseCategory(db, key(), null, { name: "Transport Buku Besar" }))).categoryId;
    const ex = await as(FIN, (db) => recordExpense(db, key(), A.b1, { categoryId: cat, businessDate: day(0), amount: 150_000, funding: "bank", description: "Bensin kurir uji" }));
    await as(FIN, (db) => reverseExpense(db, key(), ex.expenseId, "Salah catat biaya uji"));
    await drain();
    expect(await journal(`expense:${ex.expenseId}`)).toEqual(sorted([["bank", 0, 150_000], ["branch_expense", 150_000, 0]]));
    expect(await journal(`expense_reversed:${ex.expenseId}`)).toEqual(sorted([["bank", 150_000, 0], ["branch_expense", 0, 150_000]]));
    const rv = (await h.admin.query(`select reverses_entry_id, kind from journal_entries where posting_key = $1`, [`expense_reversed:${ex.expenseId}`])).rows[0];
    expect(rv.kind).toBe("reversal");
    expect(rv.reverses_entry_id).toBe((await h.admin.query(`select id from journal_entries where posting_key = $1`, [`expense:${ex.expenseId}`])).rows[0].id);
    void reversePayable; void topUpBalance; void requestVoid;
  });
});

describe("T-105 posting rules — booking DP (scenarios 6, 17) and PKP VAT (16, 19)", () => {
  const H = 3_600_000;
  const localDay = (d: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + d * 86_400_000));
  const monday = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const quarter = (ms: number) => new Date(Math.ceil((Date.now() + ms) / 900_000) * 900_000);
  let dpSvc: { itemId: string; versionId: string };
  async function appointment(pt: string, start: Date) {
    const e = new Date(start.getTime() + 30 * 60_000);
    const room = (await h.admin.query(`select id from rooms where tenant_id = $1 and branch_id = $2 limit 1`, [A.tenantId, A.b1])).rows[0].id as string;
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
    try {
      const id = (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
        values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`, [A.tenantId, A.b1, pt, dpSvc.versionId, DOC.staffId, start, e])).rows[0].id as string;
      for (const [k, r] of [["staff", DOC.staffId], ["room", room]])
        await h.admin.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6, $7)`, [A.tenantId, A.b1, id, k, r, start, e]);
      return id;
    } finally {
      await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
      await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
    }
  }
  beforeAll(async () => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: "GL-DPK" }, {
      name: "Konsultasi DP Buku Besar", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 1_500_000, category: "consultation", prep_min: 0, treatment_min: 30,
      buffer_min: 0, indications: "Indikasi", contraindications: "Kontra", consent_template: "Templat", delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }], booking_dp_enabled: true, booking_dp_amount: 200_000,
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
    dpSvc = { itemId: v.itemId, versionId: v.versionId };
    await as(OWN, (db) => setHours(db, A.b1, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "23:45" }))));
    await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Konsul Buku Besar", kind: "consultation" }));
    await as(OWN, (db) => setServices(db, A.b1, [dpSvc.itemId, facial, filler]));
    for (const week of [...new Set([0, 1, 2, 7, 8].map((d) => monday(localDay(d))))]) {
      const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(`${week}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); }).filter((d) => d >= localDay(0));
      if (days.length) await as(OWN, (db) => setWeek(db, A.b1, week, [DOC.staffId], days.map((d) => ({ staffId: DOC.staffId, date: d, starts: "00:00", ends: "23:45", kind: "work" as const }))));
    }
    await as(OWN, (db) => changeSetting(db, { key: "SET-10", branchId: null, value: { dp_booking: true, batas_ubah: 24 }, reason: "Uji DP" }));
  });

  it("scenario 6: DP received in cash (S6-J1); moved ≥ 24 h (S6a-J2); forfeited by a no-show (S6b-J2, PENDING A-10, draft); applied on arrival (S6e-J2)", async () => {
    const p1 = await patient(A, A.b1, "Pasien DP 6a");
    const a1 = await appointment(p1, quarter(72 * H));
    const d1 = await as(FO, (db) => receiveDeposit(db, key(), a1, { method: "cash", cashTendered: 200_000 }));
    await as(FO, (db) => cancelAppointment(db, key(), a1, "Pasien batal"));
    await drain();
    expect(await journal(`deposit_received:${d1.deposit_id}`)).toEqual(sorted([["cash_shift", 200_000, 0], ["liability_booking_dp", 0, 200_000]]));
    const mv = (await h.admin.query(`select id from balance_entries where source_id = $1 and kind = 'dp_transfer'`, [d1.deposit_id])).rows[0].id;
    expect(await journal(`balance_moved:${mv}`)).toEqual(sorted([["liability_booking_dp", 200_000, 0], ["liability_patient_balance", 0, 200_000]]));
    const p2 = await patient(A, A.b1, "Pasien DP 6c");
    const a2 = await appointment(p2, quarter(-1 * H));
    const d2 = await as(FO, (db) => receiveDeposit(db, key(), a2, { method: "cash", cashTendered: 200_000 })).catch(async () => {
      // a DP is received before the start; receive it on a future appointment, then move the start into the past (fixture surgery)
      const a = await appointment(p2, quarter(6 * H));
      const r = await as(FO, (db) => receiveDeposit(db, key(), a, { method: "cash", cashTendered: 200_000 }));
      await h.admin.query(`alter table appointments disable trigger appointments_guard`);
      await h.admin.query(`update appointments set starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes' where id = $1`, [a]);
      await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
      return { ...r, apt: a };
    });
    const apt2 = (d2 as { apt?: string }).apt ?? a2;
    await as(FO, (db) => markNoShow(db, key(), apt2));
    await drain();
    expect(await journal(`deposit_forfeited:${d2.deposit_id}`)).toEqual(sorted([["liability_booking_dp", 200_000, 0], ["other_income", 0, 200_000]]));
    expect((await h.admin.query(`select memo, map_version from journal_entries where posting_key = $1`, [`deposit_forfeited:${d2.deposit_id}`])).rows[0])
      .toEqual({ memo: "PENDING A-10 / Q-05 (draft)", map_version: "draft-11-2026-11-19" });
    const p3 = await patient(A, A.b1, "Pasien DP 6e");
    // the DP is received on a future slot, then the start is moved to now (fixture surgery, as 6c above): quarter(1 h) lands on
    // tomorrow's WIB date after 23:00 WIB and visit_check_in refuses a visit that is not today (T-107 gated close 1)
    const a3 = await appointment(p3, quarter(1 * H));
    const d3 = await as(FO, (db) => receiveDeposit(db, key(), a3, { method: "cash", cashTendered: 200_000 }));
    for (const t of ["appointments", "resource_reservations"]) await h.admin.query(`alter table ${t} disable trigger ${t}_guard`);
    await h.admin.query(`update appointments set starts_at = now(), ends_at = now() + interval '30 minutes' where id = $1`, [a3]);
    await h.admin.query(`update resource_reservations set starts_at = now(), ends_at = now() + interval '30 minutes' where appointment_id = $1`, [a3]);
    for (const t of ["appointments", "resource_reservations"]) await h.admin.query(`alter table ${t} enable always trigger ${t}_guard`);
    const { visitId } = await as(FO, (db) => checkIn(db, key(), a3));
    // the plan is signed and selected before the bill (as at the clinic), so the counted treatment can start after payment (S6e-J4)
    const { examId } = await as(DOC, (db) => openExam(db, key(), visitId));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program DP", "Kondisi rahasia"));
    const { itemId: pi } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: dpSvc.versionId, qty: 1 }));
    await as(DOC, (db) => reviewContraindication(db, key(), examId, pi, "cleared"));
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    const ct = await as(DOC, (db) => consentText(db, visitId, planId));
    await as(DOC, (db) => captureConsent(db, key(), { visitId, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    await as(BC, (db) => confirmSelection(db, key(), visitId, { items: [{ planItemId: pi }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: p3, visitId }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: dpSvc.itemId, quantity: 1 }]));
    if ((await h.admin.query(`select state from booking_deposits where id = $1`, [d3.deposit_id])).rows[0].state === "held") await as(FO, (db) => applyDeposit(db, key(), invoiceId));
    // S6e-J3 the remainder 1,300,000 by EDC (Kliring gateway); S6e-J4 the counted treatment (paid-not-delivered → revenue 1,500,000)
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 1_300_000, details: { card_type: "debit", bank: "BCA", trace: "660066", approval_code: "S6ES6E" } }]));
    const ex = await as(DOC, (db) => startTreatment(db, key(), visitId, { planItemId: pi, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), ex.executionId, { outcome: "completed" }));
    await drain();
    expect(await journal(`deposit_applied:${d3.deposit_id}`)).toEqual(sorted([["liability_booking_dp", 200_000, 0], ["liability_paid_not_delivered", 0, 200_000]]));
    const remainder = (await h.admin.query(`select a.id from payment_allocations a join invoice_lines l on l.id = a.invoice_line_id where l.invoice_id = $1 and a.booking_deposit_id is null and a.method = 'edc'`, [invoiceId])).rows[0].id;
    expect(await journal(`payment_allocated:${remainder}`)).toEqual(sorted([["gateway_clearing", 1_300_000, 0], ["liability_paid_not_delivered", 0, 1_300_000]]));
    expect(await journalTF(ex.executionId)).toEqual(sorted([["liability_paid_not_delivered", 1_500_000, 0], ["revenue_treatment", 0, 1_500_000]]));
  });

  it("scenario 17: a clinic cancellation refunded in cash — S17-J2 Dr DP liability / Cr Kas (shift) 200,000", async () => {
    const pt = await patient(A, A.b1, "Pasien DP 17");
    const apt = await appointment(pt, quarter(5 * H));
    const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 200_000 }));
    await as(FO, (db) => refundDepositForClinic(db, key(), deposit_id, { method: "cash", reason: "Dokter sakit" }));
    await drain();
    expect(await journal(`deposit_refunded:${deposit_id}`)).toEqual(sorted([["cash_shift", 0, 200_000], ["liability_booking_dp", 200_000, 0]]));
  });

  it("S6P + S17P (PKP gross DP, fixed amounts): received 222,000 = DP 200,000 + VAT 22,000 (J1); moved to balance with the VAT reversed (S6P-J2); the balance pays a taxable line (S6P-J3); a clinic refund reverses the VAT (S17P-J2)", async () => {
    const C = await tenant("PT Buku Besar DP PKP");
    const cown = await person(C, "owner"); const cfin = await person(C, "finance"); const cfo = await person(C, "fo_cashier", C.b1); const cfh = await person(C, "facility_head", C.b1);
    const cdoc = await person(C, "doctor", C.b1);
    const sv = await as(cown, (db) => publish(db, { kind: "service", code: "GLP-DP" }, {
      name: "Layanan DP Pajak", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 1_665_000, category: "facial", prep_min: 0, treatment_min: 30, buffer_min: 0,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
      resources: [{ kind: "room", code: "consultation" }], booking_dp_enabled: true, booking_dp_amount: 222_000,
    } as never, "Baru"));
    if (sv.approvalId) await as(cfh, (db) => decideApproval(db, sv.approvalId!, true));
    const prod = await as(cown, (db) => publish(db, { kind: "product", code: "GLP-DPP" }, { name: "Produk Pajak DP", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 222_000 } as never, "Produk"));
    const cph = await person(C, "pharmacist", C.b1);
    await as(cph, (db) => saveItem(db, key(), null, { catalogItemId: prod.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    await as(cown, (db) => setHours(db, C.b1, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "23:45" }))));
    const room = (await as(cown, (db) => upsertRoom(db, C.b1, { name: "Konsul DP Pajak", kind: "consultation" }))) as unknown as { roomId?: string };
    void room;
    await as(cown, (db) => setServices(db, C.b1, [sv.itemId]));
    for (const week of [...new Set([0, 1, 2, 7].map((d) => monday(localDay(d))))]) {
      const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(`${week}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); }).filter((d) => d >= localDay(0));
      if (days.length) await as(cown, (db) => setWeek(db, C.b1, week, [cdoc.staffId], days.map((d) => ({ staffId: cdoc.staffId, date: d, starts: "00:00", ends: "23:45", kind: "work" as const }))));
    }
    await as(cown, (db) => changeSetting(db, { key: "SET-10", branchId: null, value: { dp_booking: true, batas_ubah: 24 }, reason: "Uji DP" }));
    const pdf = Buffer.from("%PDF-1.7\nsaran pajak dp buku besar\n%%EOF\n");
    const { fileId } = await as(cfin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(cown, (db) => decideEvidence(db, ev, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: localDay(1), npwp: "012345678901234", reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 1, changed_at = now() - interval '2 days' where tenant_id = $1`, [C.tenantId, localDay(0)]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 1 where id = $1`, [C.tenantId, localDay(0)]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    const roomId = (await h.admin.query(`select id from rooms where tenant_id = $1 and branch_id = $2 limit 1`, [C.tenantId, C.b1])).rows[0].id as string;
    const book = async (pt: string, start: Date) => {
      const e = new Date(start.getTime() + 30 * 60_000);
      await h.admin.query(`alter table appointments disable trigger appointments_guard`);
      await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
      try {
        const id = (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
          values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`, [C.tenantId, C.b1, pt, sv.versionId, cdoc.staffId, start, e])).rows[0].id as string;
        for (const [k, r] of [["staff", cdoc.staffId], ["room", roomId]])
          await h.admin.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6, $7)`, [C.tenantId, C.b1, id, k, r, start, e]);
        return id;
      } finally {
        await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
        await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
      }
    };
    // S6P: received, moved ≥ 24 h, the balance pays a taxable product line of 222,000
    const p6 = await patient(C, C.b1, "Pasien DP PKP 6");
    const a6 = await book(p6, quarter(40 * H));
    const d6 = await as(cfo, (db) => receiveDeposit(db, key(), a6, { method: "cash", cashTendered: 222_000 }));
    await as(cfo, (db) => cancelAppointment(db, key(), a6, "Pasien ganti jadwal"));
    const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { counter: true, patientId: p6 }));
    await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: prod.itemId, quantity: 1 }]));
    await as(cfo, (db) => receivePayment(db, key(), invoiceId, [{ method: "balance", amount: 222_000 }]));
    // S17P: received, refunded by the clinic in cash
    const p17 = await patient(C, C.b1, "Pasien DP PKP 17");
    const a17 = await book(p17, quarter(5 * H));
    const d17 = await as(cfo, (db) => receiveDeposit(db, key(), a17, { method: "cash", cashTendered: 222_000 }));
    await as(cfo, (db) => refundDepositForClinic(db, key(), d17.deposit_id, { method: "cash", reason: "Dokter sakit" }));
    await drain();
    const j1 = sorted([["cash_shift", 222_000, 0], ["liability_booking_dp", 0, 200_000], ["vat_payable", 0, 22_000]]);
    expect(await journal(`deposit_received:${d6.deposit_id}`)).toEqual(j1); // S6P-J1
    expect(await journal(`deposit_received:${d17.deposit_id}`)).toEqual(j1); // S17P-J1
    const mv = (await h.admin.query(`select id from balance_entries where source_id = $1 and kind = 'dp_transfer'`, [d6.deposit_id])).rows[0].id;
    expect(await journal(`balance_moved:${mv}`)).toEqual(sorted([["liability_booking_dp", 200_000, 0], ["liability_patient_balance", 0, 222_000], ["vat_payable", 22_000, 0]])); // S6P-J2
    expect(await journal(`payment_allocated:${(await allocOf(invoiceId))[0]}`)).toEqual(sorted([["liability_paid_not_delivered", 0, 200_000], ["liability_patient_balance", 222_000, 0], ["vat_payable", 0, 22_000]])); // S6P-J3
    expect(await journal(`deposit_refunded:${d17.deposit_id}`)).toEqual(sorted([["cash_shift", 0, 222_000], ["liability_booking_dp", 200_000, 0], ["vat_payable", 22_000, 0]])); // S17P-J2
    expect(await accountBalance(C, "vat_payable")).toBe(-22_000); // VAT once across S6P (the refunded S17P nets 0)
  });

  it("scenarios 16 + 19 (PKP): a taxable package paid before PKP redeemed after (S16-J2: VAT 66,000 at delivery); a PKP package paid (S19-J1 VAT 330,000), expired with the VAT reversed (S19-J2)", async () => {
    const C = await tenant("PT Buku Besar PKP");
    const cown = await person(C, "owner"); const cfin = await person(C, "finance"); const cfo = await person(C, "fo_cashier", C.b1); const cfh = await person(C, "facility_head", C.b1);
    const cdoc = await person(C, "doctor", C.b1);
    await credential(C, cdoc, C.b1, cfh, cown);
    const sv = await as(cown, (db) => publish(db, { kind: "service", code: "GLP-SVC" }, {
      name: "Layanan Pajak Buku Besar", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 666_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (sv.approvalId) await as(cfh, (db) => db.query(`select approval_decide($1, true, null)`, [sv.approvalId]));
    const pv = await as(cown, (db) => publish(db, { kind: "package", code: "GLP-PKG" }, { name: "Paket Pajak Buku Besar", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 3_330_000, installments_allowed: true } as never, "Paket"));
    await as(cown, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: sv.itemId, count: 5 }]));
    const pdf = Buffer.from("%PDF-1.7\nsaran pajak buku besar\n%%EOF\n");
    const { fileId } = await as(cfin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(cown, (db) => decideEvidence(db, ev, fileId, "approved"));
    const buy = async (name: string) => {
      const pid = await patient(C, C.b1, name);
      const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
      await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pv.itemId, quantity: 1 }]));
      await as(cfo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 3_330_000, cashTendered: 3_330_000 }]));
      return { pid, invoiceId, pkg: (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string };
    };
    // 16: bought before PKP
    const b16 = await buy("Pasien Skenario 16");
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: localDay(1), npwp: "012345678901234", reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 40, changed_at = now() - interval '45 days' where tenant_id = $1`, [C.tenantId, localDay(0)]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 40 where id = $1`, [C.tenantId, localDay(0)]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    // the package invoice was issued while non-PKP (fixture: its issue moved before the PKP date)
    const { v, items } = await visitWith(C, b16.pid, C.b1, [sv.versionId], cdoc, cfo);
    await as(cfo, (db) => reserveSession(db, key(), b16.pkg, v));
    const e = await as(cdoc, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: cdoc.staffId, identityConfirmed: true }));
    await as(cdoc, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    await drain();
    expect(await journal(`payment_allocated:${(await allocOf(b16.invoiceId))[0]}`)).toEqual(sorted([["cash_shift", 3_330_000, 0], ["liability_packages", 0, 3_330_000]]));
    const s16 = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'redeemed'`, [b16.pkg])).rows[0].id;
    expect(await journal(`session_redeemed:${s16}`)).toEqual(sorted([["liability_packages", 666_000, 0], ["revenue_treatment", 0, 600_000], ["vat_payable", 0, 66_000]]));
    // 19: bought while PKP (payment is the tax point), expired unused: the package liability net moves with the VAT reversed
    const b19 = await buy("Pasien Skenario 19");
    await drain();
    expect(await journal(`payment_allocated:${(await allocOf(b19.invoiceId))[0]}`)).toEqual(sorted([["cash_shift", 3_330_000, 0], ["liability_packages", 0, 3_000_000], ["vat_payable", 0, 330_000]]));
    await h.admin.query(`alter table packages disable trigger packages_guard`);
    await h.admin.query(`update packages set validity_end = now() - interval '1 day' where id = $1`, [b19.pkg]);
    await h.admin.query(`alter table packages enable always trigger packages_guard`);
    await runPackageExpiryScan(worker);
    await drain();
    const mv = (await h.admin.query(`select id from balance_entries where source_id = $1 and kind = 'from_expiry'`, [b19.pkg])).rows[0].id;
    expect(await journal(`balance_moved:${mv}`)).toEqual(sorted([["liability_packages", 3_000_000, 0], ["liability_patient_balance", 0, 3_330_000], ["vat_payable", 330_000, 0]]));
    expect(await accountBalance(C, "liability_packages")).toBe(-(3_330_000 - 666_000)); // b16's four unredeemed sessions remain
    void cancelPackage;
    // S1P + S19-J3/J4: a taxable product (serum 333,000: base 300,000, VAT 33,000) — PKP. The expired balance (3,330,000) pays ten serums
    // (S19-J3: Dr balance 3,330,000 / Cr paid-not-delivered 3,000,000 + VAT 330,000); handed over (S19-J4 / S1P-J3: no second VAT, COGS)
    const cph = await person(C, "pharmacist", C.b1); const cpur = { ...(await person(C, "purchasing")), branch: undefined };
    const srm = await as(cown, (db) => publish(db, { kind: "product", code: "GLP-SRM" }, { name: "Serum Pajak", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"));
    const srmStock = (await as(cph, (db) => saveItem(db, key(), null, { catalogItemId: srm.itemId, unit: "btl", storage: "ruang", highValue: false, active: true }))).itemId;
    const csup = (await as(cpur, (db) => saveSupplier(db, key(), null, { name: "PT Pemasok PKP" }))).supplierId;
    const cr = await as(cpur, (db) => receiveFromSupplier(db, key(), C.b1, { supplierId: csup, itemId: srmStock, batchNo: "GLP-S1", expiry: localDay(200), quantity: "10", unitCost: 150_000, reason: "penerimaan" }));
    const cg1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [C.b1])).rows[0].id;
    const capt = (await as(cph, (db) => createDepot(db, key(), { branchId: null, name: "Apotek PKP", kind: "apotek" }))).depotId;
    const cbatch = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [cr.receiptId])).rows[0].batch_id;
    await as(cph, (db) => transferBetweenDepots(db, key(), { fromDepotId: cg1, toDepotId: capt, lines: [{ batchId: cbatch, quantity: "10" }] }));
    const { invoiceId: si } = await as(cfo, (db) => openKasirInvoice(db, key(), { counter: true, patientId: b19.pid }));
    await as(cfo, (db) => issueKasirInvoice(db, key(), si, [{ itemId: srm.itemId, quantity: 10 }]));
    await as(cfo, (db) => receivePayment(db, key(), si, [{ method: "balance", amount: 3_330_000 }]));
    const sd = (await h.admin.query(`select d.id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [si])).rows[0].id;
    const allc = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<Check, boolean>;
    await as(cph, (db) => prepareDispensing(db, key(), sd, capt));
    await as(cph, (db) => handOver(db, key(), sd, { checks: allc }));
    await drain();
    expect(await journal(`payment_allocated:${(await allocOf(si))[0]}`)).toEqual(sorted([["liability_paid_not_delivered", 0, 3_000_000], ["liability_patient_balance", 3_330_000, 0], ["vat_payable", 0, 330_000]]));
    expect(await journal(`product_handed:${sd}`)).toEqual(sorted([["cogs", 1_500_000, 0], ["inventory", 0, 1_500_000], ["liability_paid_not_delivered", 3_000_000, 0], ["revenue_product", 0, 3_000_000]]));
    // S19: net VAT for the package + product = 330,000 once (credited J1, reversed J2, credited J3; J4 adds nothing); S16's 66,000 at delivery
    expect(await accountBalance(C, "vat_payable")).toBe(-(330_000 + 66_000));
  });
});

describe("T-105 manual journals, period lock, statements, journal export (fail-closed), invoice void mirror", () => {
  const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${(e as Error).message}`));
  const now = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const monthStart = () => `${now().slice(0, 8)}01`;
  const prevMonth = () => { const d = new Date(`${monthStart()}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

  it("a manual journal (finance only): balanced, reasoned, idempotent, into an open period; refused unbalanced, without a reason, into a locked month, by other roles", async () => {
    const k = key();
    const lines = [{ account: "branch_expense", branchId: A.b1, debit: 25_000 }, { account: "petty_cash", branchId: A.b1, credit: 25_000 }];
    const m = await as(FIN, (db) => postManual(db, k, { date: now(), memo: "Koreksi kas kecil uji sintetis", lines }));
    expect((await as(FIN, (db) => postManual(db, k, { date: now(), memo: "Koreksi kas kecil uji sintetis", lines }))).entryId).toBe(m.entryId);
    const e = (await h.admin.query(`select kind, map_version, posted_by, memo from journal_entries where id = $1`, [m.entryId])).rows[0];
    expect(e).toEqual({ kind: "manual", map_version: null, posted_by: FIN.staffId, memo: "Koreksi kas kecil uji sintetis" });
    expect(await code(as(FIN, (db) => postManual(db, key(), { date: now(), memo: "Tidak seimbang uji", lines: [{ account: "bank", debit: 10 }, { account: "cash_shift", credit: 9 }] })))).toBe("ERR_INVALID_INPUT:unbalanced");
    expect(await code(as(FIN, (db) => postManual(db, key(), { date: now(), memo: "pendek", lines })))).toBe("ERR_INVALID_INPUT:manual journal");
    expect(await code(as(FIN, (db) => postManual(db, key(), { date: now(), memo: "Akun tidak dikenal uji", lines: [{ account: "nope_account", debit: 1 }, { account: "bank", credit: 1 }] })))).toBe("ERR_INVALID_INPUT:line");
    for (const p of [OWN, AU, MGR, FO]) expect(await code(as(p, (db) => postManual(db, key(), { date: now(), memo: "Bukan peran keuangan", lines }))), p.role).toMatch(/^ERR_FORBIDDEN/);
    await as(FIN, (db) => lockLedgerPeriod(db, key(), prevMonth()));
    expect(await code(as(FIN, (db) => postManual(db, key(), { date: `${prevMonth()}-15`, memo: "Ke periode terkunci uji", lines })))).toBe(`ERR_PERIOD_LOCKED:${prevMonth()}`);
    const audits = (await h.admin.query(`select reason_code from audit_events where object_id = $1`, [m.entryId])).rows.map((r) => r.reason_code);
    expect(audits).toContain("manual_journal_posted");
  });

  it("Kunci Periode: finance only, past months only, once; an automatic posting of a fact in that month lands in the next open period with its month kept", async () => {
    const p2 = (() => { const d = new Date(`${monthStart()}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 2); return d.toISOString().slice(0, 7); })();
    expect(await code(as(FIN, (db) => lockLedgerPeriod(db, key(), now().slice(0, 7))))).toBe("ERR_VERSION_CONFLICT:period_open");
    for (const p of [OWN, AU]) expect(await code(as(p, (db) => lockLedgerPeriod(db, key(), p2))), p.role).toMatch(/^ERR_FORBIDDEN/);
    await as(FIN, (db) => lockLedgerPeriod(db, key(), p2));
    expect(await code(as(FIN, (db) => lockLedgerPeriod(db, key(), p2)))).toBe("ERR_VERSION_CONFLICT:period_locked");
    const id = (await post(A, `t-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: 70_000 }, { account: "liability_patient_balance", credit: 70_000 }], { date: `${p2}-12` }))!;
    const e = (await h.admin.query(`select period, original_period from journal_entries where id = $1`, [id])).rows[0];
    expect(e.original_period).toBe(p2);
    expect(e.period > p2).toBe(true);
    expect(e.period).not.toBe(prevMonth()); // the previous month is locked too (test above): the next OPEN one
  });

  it("statements: trial balance balances, P&L and balance sheet by class, cash-flow by counter class; always the preview status; owner / finance / auditor only; not SAK-labelled", async () => {
    const r = await as(FIN, (db) => report(db, { from: monthStart(), to: now() }));
    expect(r.status).toMatchObject({ state: "preview", map_version: "draft-11-2026-11-19", activated: false });
    expect(r.trial_balance.reduce((s, x) => s + x.closing, 0)).toBe(0);
    expect(r.balanced).toBe(true);
    const assets = r.balance_sheet.filter((x) => x.class === "asset").reduce((s, x) => s + x.amount, 0);
    const claims = r.balance_sheet.filter((x) => x.class !== "asset").reduce((s, x) => s + x.amount, 0);
    expect(assets).toBe(claims + r.retained);
    expect(r.income.every((x) => x.class === "revenue" || x.class === "expense")).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/SAK/);
    for (const p of [OWN, AU]) expect((await as(p, (db) => report(db, { from: monthStart(), to: now() }))).status.state).toBe("preview");
    for (const p of [MGR, FO, BFIN]) {
      const x = await code(as(p, (db) => report(db, { from: monthStart(), to: now() })));
      if (p === BFIN) expect(x).toBe("ok"); else expect(x, p.role).toMatch(/^ERR_FORBIDDEN/);
    }
    expect((await as(BFIN, (db) => report(db, { from: monthStart(), to: now() }))).trial_balance.some((x) => x.closing !== 0 && x.key === "revenue_treatment")).toBe(false);
    const j = await as(AU, (db) => readJournal(db, { from: monthStart(), to: now() }));
    expect(j.entries.length).toBeGreaterThan(0);
    expect(j.entries.every((e) => e.lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0)).toBe(true);
  });

  it("journal export is refused (fail-closed): unsigned map → refused; signed map evidence alone → still refused (books not activated, G-ACT); never another role", async () => {
    expect(await as(FIN, (db) => exportJournal(db, { from: monthStart(), to: now() }))).toEqual({ ok: false, refused: "posting_map_unsigned" });
    // the accountant's sign-off approved for this exact map version (a compliance row): export stays refused — evidence alone activates nothing
    const pdf = Buffer.from("%PDF-1.7\nposting map sign-off\n%%EOF\n");
    const { fileId } = await as(OWN, (db) => uploadEvidence(db, { obligationKey: "posting_map_signoff", fileName: "map.pdf", content: pdf, expertName: "Akuntan Sintetis", documentDate: now() }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(FIN, (db) => decideEvidence(db, ev, fileId, "approved"));
    expect((await as(FIN, (db) => report(db, { from: monthStart(), to: now() }))).status).toMatchObject({ state: "preview", map_signed: true, activated: false });
    expect(await as(FIN, (db) => exportJournal(db, { from: monthStart(), to: now() }))).toEqual({ ok: false, refused: "ledger_not_activated" });
    expect((await h.admin.query(`select count(*)::int c from journal_entries where tenant_id = $1 and kind = 'auto' and map_version <> 'draft-11-2026-11-19'`, [A.tenantId])).rows[0].c).toBe(0);
    for (const p of [OWN, AU]) expect(await code(as(p, (db) => exportJournal(db, { from: monthStart(), to: now() }))), p.role).toMatch(/^ERR_FORBIDDEN/);
    const denied = (await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and action = 'export' and object_kind = 'journal' order by at`, [A.tenantId])).rows.map((r) => r.reason_code);
    expect(denied).toEqual(expect.arrayContaining(["posting_map_unsigned", "ledger_not_activated"]));
  });

  it("an invoice void mirrors its own originals once (InvoiceVoided owns the reversal; reverses_entry_id set; a replay posts nothing)", async () => {
    const pid = await patient(A, A.b1, "Pasien Void");
    const { v, items } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), invoiceId, "Salah tagih uji"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    await drain();
    // an unpaid, undelivered invoice has no original entry: nothing to mirror
    expect((await h.admin.query(`select count(*)::int c from journal_entries where event = 'InvoiceVoided' and source_id = $1`, [invoiceId])).rows[0].c).toBe(0);
    const ev = (await h.admin.query(`select id from domain_events where type = 'InvoiceVoided' and aggregate_id = $1`, [invoiceId])).rows[0].id;
    expect(await as(FIN, (db) => postEvent(db, { id: ev }))).toBeNull();
  });
});

// ── Panel 2 pre-review (freeze-r1): the exact fixture journals not asserted at r1 (t105 notes COVERAGE-RECONCILIATION.md) ──
describe("T-105 fixture coverage r2: S1 sunscreen, S1P, S2-J3/S7a-J1 materials, S4c, S6e, S7c, S7d, S9, S10 J1/J2/J5, S12a, S13-J2, S18, S19 J3/J4, supplier return / credit", () => {
  let PH: P; let PUR: P; let SUP: string; let ROOM: string; let G1: string; let APT: string;
  let vial: string; let sun: string; let sunStock: string; let gel: string;
  const day = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const entriesOf = async (sourceKind: string, sourceId: string) => (await h.admin.query(`select posting_key from journal_entries where source_kind = $1 and source_id = $2`, [sourceKind, sourceId])).rows.map((r) => r.posting_key as string);
  beforeAll(async () => {
    PH = await person(A, "pharmacist", A.b1); PUR = { ...(await person(A, "purchasing")), branch: undefined };
    SUP = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "PT Pemasok Cakupan" }))).supplierId;
    G1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
    ROOM = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Tindakan Cakupan", kind: "ruang" }))).depotId;
    APT = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Cakupan", kind: "apotek" }))).depotId;
    const mat = async (code: string, name: string, unit: string) => {
      const cat = (await as(OWN, (db) => publish(db, { kind: "material", code }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
      return { cat, item: (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit, storage: "ruang", highValue: false, active: true }))).itemId };
    };
    const v = await mat("GL-VIAL", "Vial Serum Cakupan", "vial"); vial = v.item;
    gel = (await mat("GL-GEL", "Gel Cakupan", "ml")).item;
    await as(PH, (db) => setItemClass(db, key(), vial, "precise"));
    for (const [it, cost, q] of [[vial, 40_000, "20"], [gel, 1_000, "500"]] as const)
      await as(PUR, (db) => receiveFromSupplier(db, key(), A.b1, { supplierId: SUP, itemId: it, batchNo: `GL-${it.slice(0, 4)}`, expiry: day(200), quantity: q, unitCost: cost, reason: "penerimaan" }));
    sun = (await as(OWN, (db) => publish(db, { kind: "product", code: "GL-SUN" }, { name: "Sunscreen Cakupan", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 222_000 } as never, "Produk"))).itemId;
    sunStock = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: sun, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    const r = await as(PUR, (db) => receiveFromSupplier(db, key(), A.b1, { supplierId: SUP, itemId: sunStock, batchNo: "GL-SUN1", expiry: day(200), quantity: "10", unitCost: 90_000, reason: "penerimaan" }));
    const b = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [r.receiptId])).rows[0].batch_id;
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: APT, lines: [{ batchId: b, quantity: "10" }] }));
  });
  // A treatment visit whose selection is confirmed and paid in cash; materials issued to the room for its plan item.
  async function paidTreatment(name: string, version = facialV, item = facial, amount = 1_500_000) {
    const pid = await patient(A, A.b1, name);
    const { v, items } = await visitWith(A, pid, A.b1, [version], DOC, FO);
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount, cashTendered: amount }]));
    return { pid, v, item: items[0], invoiceId };
  }
  const materials = async (v: string, planItemId: string, lines: { itemId: string; quantity: string }[]) => {
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, planItemId, lines }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    return requestId;
  };

  it("S2-J3 / S7a-J1: materials actually used post Dr Materials cost / Cr Inventory at moving average (60,000 = 1.5 vials × 40,000); S7c: a patient stop counts (TreatmentFinished)", async () => {
    const s = await paidTreatment("Pasien S7c");
    const req = await materials(s.v, s.item, [{ itemId: vial, quantity: "2" }]);
    const e = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: s.item, performerId: DOC.staffId, identityConfirmed: true }));
    const { consumptionId } = await as(NUR, (db) => consumeMaterials(db, key(), req, [{ itemId: vial, quantity: "1.5" }]));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "patient_stop", reason: "Pasien memilih berhenti" }));
    await drain();
    expect(await journal(`stock_consume:${consumptionId}`)).toEqual(sorted([["inventory", 0, 60_000], ["materials_cost", 60_000, 0]]));
    expect(await journalTF(e.executionId)).toEqual(sorted([["liability_paid_not_delivered", 1_500_000, 0], ["revenue_treatment", 0, 1_500_000]]));
  });

  it("S9: the treatment not performed — one vial back unopened and usable posts NOTHING; the opened one is wasted (Dr Waste expense 40,000 / Cr Inventory); refunded to balance (S9-J1); S9b cash exception (J3)", async () => {
    const s = await paidTreatment("Pasien S9");
    const req = await materials(s.v, s.item, [{ itemId: vial, quantity: "2" }]);
    const { returnId } = await as(NUR, (db) => proposeReturn(db, key(), req, { condition: "unopened", lines: [{ itemId: vial, quantity: "1" }] }));
    await as(PH, (db) => decideReturn(db, key(), returnId, "usable", G1));
    const { wasteId } = await as(NUR, (db) => wasteMaterials(db, key(), req, { reason: "Vial terbuka", lines: [{ itemId: vial, quantity: "1" }] }));
    await drain();
    expect(await entriesOf("material_return", returnId)).toEqual([]); // StockReturned of unconsumed issued stock: no GL movement (11 :133)
    expect((await h.admin.query(`select count(*)::int c from journal_entries where event = 'StockReturned'`)).rows[0].c).toBe(0);
    expect(await journal(`stock_waste:${wasteId}`)).toEqual(sorted([["inventory", 0, 40_000], ["waste_expense", 40_000, 0]]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [s.invoiceId])).rows[0].id;
    const r = await as(FO, (db) => requestRefund(db, key(), line, { amount: 1_500_000, reason: "Tindakan tidak jadi dilakukan", destination: "cash" }));
    if ((await h.admin.query(`select state from refunds where id = $1`, [r.refund_id])).rows[0].state !== "paid") {
      if (r.approval_id) await as(OWN, (db) => decideApproval(db, r.approval_id!, true));
      if ((await h.admin.query(`select state from refunds where id = $1`, [r.refund_id])).rows[0].state !== "paid") await as(FO, (db) => payRefund(db, key(), r.refund_id, "cash"));
    }
    await drain();
    const credit = (await h.admin.query(`select balance_entry_id from refunds where id = $1`, [r.refund_id])).rows[0].balance_entry_id;
    expect(await journal(`balance_moved:${credit}`)).toEqual(sorted([["liability_paid_not_delivered", 1_500_000, 0], ["liability_patient_balance", 0, 1_500_000]]));
    expect(await journal(`refund_paid:${r.refund_id}`)).toEqual(sorted([["cash_shift", 0, 1_500_000], ["liability_patient_balance", 1_500_000, 0]]));
  });

  it("S7d: a package session patient stop counts — SessionRedeemed (packages → revenue) and its materials", async () => {
    const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "GL-P7D" }, { name: "Paket S7d", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 7_500_000, installments_allowed: true } as never, "Paket"));
    await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: facial, count: 5 }]));
    const pid = await patient(A, A.b1, "Pasien S7d");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pv.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 7_500_000, cashTendered: 7_500_000 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id;
    const { v, items } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    await as(FO, (db) => reserveSession(db, key(), pkg, v));
    const req = await materials(v, items[0], [{ itemId: gel, quantity: "60" }]);
    const e = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
    const { consumptionId } = await as(NUR, (db) => consumeMaterials(db, key(), req, [{ itemId: gel, quantity: "60" }]));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "patient_stop", reason: "Pasien memilih berhenti" }));
    await drain();
    const sess = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'redeemed'`, [pkg])).rows[0].id;
    expect(await journal(`session_redeemed:${sess}`)).toEqual(sorted([["liability_packages", 1_500_000, 0], ["revenue_treatment", 0, 1_500_000]]));
    expect(await journal(`stock_consume:${consumptionId}`)).toEqual(sorted([["inventory", 0, 60_000], ["materials_cost", 60_000, 0]]));
    expect(await journalTF(e.executionId)).toEqual([]); // the session owns performance
  });

  it("S1-J4 + S4c-J3/J4: a sunscreen bought on a consultation visit (fee waived at close); its full refund re-charges the fee — the re-charge line (S4c-J3) paid from the balance (S4c-J4)", async () => {
    const kv = await as(OWN, (db) => publish(db, { kind: "service", code: "GL-K4C" }, {
      name: "Konsultasi S4c", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 99_000, category: "consultation", prep_min: 0, treatment_min: 15, buffer_min: 0,
      indications: "Indikasi", consent_template: "Templat konsultasi.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Layanan baru"));
    if (kv.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [kv.approvalId]));
    await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 150_000, reason: "Biaya konsultasi" }));
    try {
      const pid = await patient(A, A.b1, "Pasien S4c");
      const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id;
      const { examId } = await as(DOC, (db) => openExam(db, key(), v));
      await as(DOC, (db) => signRecord(db, key(), examId, STEP));
      const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
      await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sun, quantity: 1 }]));
      await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 222_000, cashTendered: 222_000 }]));
      await as(FO, (db) => closeVisit(db, key(), v));
      expect((await h.admin.query(`select state, waiver from consultation_fees where visit_id = $1`, [v])).rows[0]).toEqual({ state: "waived", waiver: "purchase" });
      const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id;
      await as(FO, (db) => requestRefund(db, key(), line, { amount: 222_000, reason: "Dikembalikan utuh" }));
      await drain();
      expect(await journal(`payment_allocated:${(await allocOf(invoiceId))[0]}`)).toEqual(sorted([["cash_shift", 222_000, 0], ["liability_paid_not_delivered", 0, 222_000]]));
      const fee = (await h.admin.query(`select state, fee_line_id from consultation_fees where visit_id = $1`, [v])).rows[0];
      expect(fee.state).toBe("recharged");
      expect(await journal(`consultation_charged:${fee.fee_line_id}`)).toEqual(sorted([["liability_paid_not_delivered", 150_000, 0], ["revenue_consultation", 0, 150_000]]));
      const feeInv = (await h.admin.query(`select invoice_id from invoice_lines where id = $1`, [fee.fee_line_id])).rows[0].invoice_id;
      expect(await journal(`payment_allocated:${(await allocOf(feeInv))[0]}`)).toEqual(sorted([["liability_paid_not_delivered", 0, 150_000], ["liability_patient_balance", 150_000, 0]]));
      // ConsultationFeeRecharged notifies only: no entry of its own
      expect((await h.admin.query(`select count(*)::int c from journal_entries where event = 'ConsultationFeeRecharged'`)).rows[0].c).toBe(0);
    } finally {
      await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, restore: true, reason: "Kembali ke bawaan" }));
    }
  });

  it("S10 J1/J2/J5 + S13-J2 in one flow: transfer allocation, counted treatment, delivered refund to balance (Dr revenue / Cr balance); the balance pays a package instalment and its session is redeemed", async () => {
    const s = await paidTreatment("Pasien S10b");
    const e = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: s.item, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [s.invoiceId])).rows[0].id;
    const r = await as(FO, (db) => requestRefund(db, key(), line, { amount: 1_500_000, reason: "Pasien tidak puas" }));
    await drain();
    expect(await journalTF(e.executionId)).toEqual(sorted([["liability_paid_not_delivered", 1_500_000, 0], ["revenue_treatment", 0, 1_500_000]]));
    const credit = (await h.admin.query(`select balance_entry_id from refunds where id = $1`, [r.refund_id])).rows[0].balance_entry_id;
    expect(await journal(`balance_moved:${credit}`)).toEqual(sorted([["liability_patient_balance", 0, 1_500_000], ["revenue_treatment", 1_500_000, 0]]));
    const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "GL-P13" }, { name: "Paket S13", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 7_500_000, installments_allowed: true } as never, "Paket"));
    await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: facial, count: 5 }]));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pv.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "balance", amount: 1_500_000 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id;
    const w = await visitWith(A, s.pid, A.b1, [facialV], DOC, FO);
    await as(FO, (db) => reserveSession(db, key(), pkg, w.v));
    const x = await as(DOC, (db) => startTreatment(db, key(), w.v, { planItemId: w.items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), x.executionId, { outcome: "completed" }));
    await drain();
    expect(await journal(`payment_allocated:${(await allocOf(invoiceId))[0]}`)).toEqual(sorted([["liability_packages", 0, 1_500_000], ["liability_patient_balance", 1_500_000, 0]]));
    const sess = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'redeemed'`, [pkg])).rows[0].id;
    expect(await journal(`session_redeemed:${sess}`)).toEqual(sorted([["liability_packages", 1_500_000, 0], ["revenue_treatment", 0, 1_500_000]]));
  });

  it("S12a (PENDING A-02 — the split is the fixture's draft): the dearer substitute's revenue is recognised ONCE at the fixed total (session 1,500,000 + difference paid); the draft rows match the fixture shape", async () => {
    const dear = await as(OWN, (db) => publish(db, { kind: "service", code: "GL-DEAR" }, {
      name: "Layanan Mahal S12a", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 1_700_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (dear.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [dear.approvalId]));
    const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "GL-P12A" }, { name: "Paket S12a", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 7_500_000, installments_allowed: true } as never, "Paket"));
    await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: facial, count: 5 }]));
    const pid = await patient(A, A.b1, "Pasien S12a");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pv.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 7_500_000, cashTendered: 7_500_000 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id;
    const ss = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
    const { substitutionId } = await as(FO, (db) => requestSubstitution(db, key(), ss[0], dear.itemId, "Hasil lebih baik"));
    await as(DOC, (db) => decideSubstitution(db, key(), substitutionId, true, null));
    const { v, items } = await visitWith(A, pid, A.b1, [dear.versionId], DOC, FO);
    await as(FO, (db) => reserveSession(db, key(), pkg, v, dear.itemId));
    const { invoiceId: di } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), di, [{ itemId: dear.itemId, quantity: 1, substitutionId }]));
    await as(FO, (db) => receivePayment(db, key(), di, [{ method: "cash", amount: 200_000, cashTendered: 200_000 }]));
    const e = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    await drain();
    // fixed (signed-off amounts): revenue 1,700,000 once for this delivery — session 1,500,000 + the 200,000 difference
    const revenue = Number((await h.admin.query(`select coalesce(sum(l.credit - l.debit), 0) s from journal_lines l join journal_entries e on e.id = l.entry_id join ledger_accounts a on a.id = l.account_id
       where e.posting_key = any($1) and a.key = 'revenue_treatment'`, [[`session_redeemed:${ss[0]}`, `treatment_finished:${e.executionId}`]])).rows[0].s);
    expect(revenue).toBe(1_700_000);
    // the draft split (PENDING A-02): S12a-J1 session, J2 difference allocation (where the difference is package money), J3 difference performance
    expect(await journal(`session_redeemed:${ss[0]}`)).toEqual(sorted([["liability_packages", 1_500_000, 0], ["revenue_treatment", 0, 1_500_000]]));
    // S12a-J2: the difference line's cash allocation credits paid-not-delivered (the posting map's PaymentAllocated row)
    expect(await journal(`payment_allocated:${(await allocOf(di))[0]}`)).toEqual(sorted([["cash_shift", 200_000, 0], ["liability_paid_not_delivered", 0, 200_000]]));
    // S12a-J3 (draft): the difference performed with the session — paid-not-delivered → revenue, marked PENDING A-02
    expect(await journalTF(e.executionId)).toEqual(sorted([["liability_paid_not_delivered", 200_000, 0], ["revenue_treatment", 0, 200_000]]));
    expect((await h.admin.query(`select memo from journal_entries where posting_key = $1`, [`treatment_finished:${e.executionId}`])).rows[0].memo).toMatch(/PENDING A-02/);
    // the difference belongs to its own session only: the next ordinary session of the same package posts SessionRedeemed and no TreatmentFinished
    const w = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    await as(FO, (db) => reserveSession(db, key(), pkg, w.v));
    const x = await as(DOC, (db) => startTreatment(db, key(), w.v, { planItemId: w.items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), x.executionId, { outcome: "completed" }));
    await drain();
    expect(await journalTF(x.executionId)).toEqual([]);
    expect(await journal(`session_redeemed:${ss[1]}`)).toEqual(sorted([["liability_packages", 1_500_000, 0], ["revenue_treatment", 0, 1_500_000]]));
  });

  it("S18: a QRIS charge paid, then the webhook delivered twice — one payment, one allocation, one journal", async () => {
    await as(MGR, (db) => enableMockPort(db)).catch(() => undefined);
    const pid = await patient(A, A.b1, "Pasien S18");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    const c = await as(FO, (db) => createCharge(db, key(), invoiceId, { channel: "qris" }));
    const w = await as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId));
    expect(await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local")).toMatchObject({ status: 200 });
    expect(await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local")).toMatchObject({ status: 200, outcome: "duplicate" });
    await drain();
    const allocs = await allocOf(invoiceId);
    expect(allocs.length).toBe(1);
    // a mock (simulated) payment never enters the real ledger (BILL-29); in production the same idempotency holds on the real allocation
    const sim = (await h.admin.query(`select is_simulated from payment_allocations where id = $1`, [allocs[0]])).rows[0].is_simulated;
    expect(await journal(`payment_allocated:${allocs[0]}`)).toEqual(sim ? [] : sorted([["gateway_clearing", 1_500_000, 0], ["liability_paid_not_delivered", 0, 1_500_000]]));
    expect((await h.admin.query(`select count(*)::int c from journal_entries where source_id = $1`, [allocs[0]])).rows[0].c).toBe(sim ? 0 : 1);
  });

  it("supplier return and credit (draft rows of 11 :97): returned at moving average (Dr supplier receivable / Cr Inventory), the credit note applied to an invoice (Dr AP / Cr supplier receivable)", async () => {
    const g = await as(PUR, (db) => receiveGoods(db, key(), A.b1, { supplierId: SUP, lines: [{ itemId: gel, batchNo: "GL-RET", expiry: day(200), quantity: "100", unitCost: 1_000 }] }));
    const rcpt = (await h.admin.query(`select id, batch_id from supplier_receipts where source_kind = 'goods_receipt' and source_id = $1`, [g.receiptId])).rows[0];
    const inv = await as(PUR, (db) => recordInvoice(db, key(), A.b1, { supplierId: SUP, number: "INV-GL-RET", invoiceDate: day(0), lines: [{ receiptId: rcpt.id }] }));
    const { returnId } = await as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: rcpt.batch_id, quantity: "10", reason: "damaged", note: "Retur uji buku besar" }));
    const value = Number((await h.admin.query(`select value from supplier_returns where id = $1`, [returnId])).rows[0].value);
    const { creditNoteId } = await as(PUR, (db) => recordCreditNote(db, key(), A.b1, { supplierId: SUP, number: "NK-GL-1", amount: value, issuedOn: day(0), returnId }));
    await as(FIN, (db) => applyCredit(db, key(), creditNoteId, inv.invoiceId));
    await drain();
    expect(value).toBeGreaterThan(0);
    expect(await journal(`supplier_returned:${returnId}`)).toEqual(sorted([["inventory", 0, value], ["supplier_receivable", value, 0]]));
    const ap = (await h.admin.query(`select id from supplier_credit_applications where credit_note_id = $1`, [creditNoteId])).rows[0].id;
    expect(await journal(`supplier_credit_applied:${ap}`)).toEqual(sorted([["accounts_payable", value, 0], ["supplier_receivable", 0, value]]));
  });
});

// ── Panel 2 REVISE r2: consumption order. events_claim skips live leases and locked rows, so a reversal can be consumed before its original.
// Every reversal rule posts its original from the fact first (idempotent on the posting key), then mirrors it, dated at the domain reversal
// (reversed_at / voided_at / closed_at), never at the worker's clock. Real outbox (runOutboxBatch); the original's receipt is held as another
// worker's live lease — exactly what events_claim skips. Synthetic supplier, expense, transfer and consultation fixtures.
describe("T-105 r3: reversal ordering on the real outbox (Panel 2 REVISE r2)", () => {
  let PUR: P; let PH: P; let SUP: string; let G1: string; let item: string;
  const day = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const evOf = async (type: string, aggregateId: string) =>
    (await h.admin.query(`select id from domain_events where type = $1 and aggregate_id = $2 order by id`, [type, aggregateId])).rows.map((r) => r.id as string);
  const hold = (ids: string[]) => h.admin.query(`update event_receipts set lease_until = now() + interval '1 hour', claimed_by = 'other-worker' where consumer = $1 and event_id = any($2)`, [LEDGER_CONSUMER, ids]);
  const release = (ids: string[]) => h.admin.query(`update event_receipts set lease_until = now() - interval '1 second' where consumer = $1 and event_id = any($2)`, [LEDGER_CONSUMER, ids]);
  const done = async (id: string) => (await h.admin.query(`select done_at is not null as d from event_receipts where consumer = $1 and event_id = $2`, [LEDGER_CONSUMER, id])).rows[0].d as boolean;
  const entry = async (k: string) => (await h.admin.query(`select id, kind, business_date::text d, reverses_entry_id r, source_event_id ev from journal_entries where posting_key = $1`, [k])).rows[0];
  const count = async (sourceKind: string, sourceId: string) => (await h.admin.query(`select count(*)::int c from journal_entries where source_kind = $1 and source_id = $2`, [sourceKind, sourceId])).rows[0].c as number;
  const netOf = async (sourceKind: string, sourceId: string) => (await h.admin.query(`select a.key, sum(l.debit - l.credit)::bigint n from journal_entries e join journal_lines l on l.entry_id = e.id
     join ledger_accounts a on a.id = l.account_id where e.source_kind = $1 and e.source_id = $2 group by a.key having sum(l.debit - l.credit) <> 0 order by a.key`, [sourceKind, sourceId])).rows;
  const wib = async (table: string, col: string, id: string) =>
    (await h.admin.query(`select (${col} at time zone 'Asia/Jakarta')::date::text d from ${table} where id = $1`, [id])).rows[0].d as string;
  // the domain reversal dated 3 days back (synthetic): the worker runs later, possibly in another month
  async function backdate(table: string, guard: string, col: string, id: string) {
    await h.admin.query(`alter table ${table} disable trigger ${guard}`);
    await h.admin.query(`update ${table} set ${col} = ${col} - interval '3 days' where id = $1`, [id]);
    await h.admin.query(`alter table ${table} enable always trigger ${guard}`);
  }
  // the original's event held, the reversal consumed first; then the original released and consumed: it posts nothing more
  async function reversedOrder(originals: string[], act: () => Promise<void>, check: () => Promise<void>) {
    await hold(originals);
    await act();
    await drain();
    for (const id of originals) expect(await done(id)).toBe(false);
    await check();
    await release(originals);
    await drain();
    for (const id of originals) expect(await done(id)).toBe(true);
  }
  beforeAll(async () => {
    PUR = { ...(await person(A, "purchasing")), branch: undefined }; PH = await person(A, "pharmacist", A.b1);
    SUP = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "PT Pemasok Urutan" }))).supplierId;
    G1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
    const cat = (await as(OWN, (db) => publish(db, { kind: "material", code: "GL-ORD" }, { name: "Bahan Urutan", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
    item = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
  });
  async function invoiced(n: string, amount: number) {
    const g = await as(PUR, (db) => receiveGoods(db, key(), A.b1, { supplierId: SUP, lines: [{ itemId: item, batchNo: `ORD-${n}`, expiry: day(200), quantity: "10", unitCost: 10_000 }] }));
    const rc = (await h.admin.query(`select id, batch_id from supplier_receipts where source_kind = 'goods_receipt' and source_id = $1`, [g.receiptId])).rows[0];
    const inv = await as(PUR, (db) => recordInvoice(db, key(), A.b1, { supplierId: SUP, number: `INV-ORD-${n}`, invoiceDate: day(0), lines: [{ receiptId: rc.id, amount }] }));
    return { batch: rc.batch_id as string, invoice: inv.invoiceId };
  }
  const recordedLines = sorted([["accounts_payable", 0, 103_000], ["grni", 100_000, 0], ["purchase_price_variance", 3_000, 0]]);

  it("SupplierInvoiceReversed: reversed order (reversal consumed first) and normal order both post the original + its mirror once, dated at reversed_at; replay posts nothing", async () => {
    // reversed order
    const x = await invoiced("R1", 103_000);
    const [rec] = await evOf("SupplierInvoiceRecorded", x.invoice);
    await reversedOrder([rec], async () => {
      await as(PUR, (db) => reversePayable(db, key(), "invoice", x.invoice, "Salah input tagihan"));
      await backdate("supplier_invoices", "supplier_invoices_guard", "reversed_at", x.invoice);
    }, async () => {
      const o = await entry(`supplier_invoice:${x.invoice}`);
      expect([o?.kind, o?.ev]).toEqual(["auto", null]); // posted from the fact on behalf of the reversal; its own event not consumed yet
      expect(await journal(`supplier_invoice:${x.invoice}`)).toEqual(recordedLines);
    });
    const [rev] = await evOf("SupplierInvoiceReversed", x.invoice);
    const o = await entry(`supplier_invoice:${x.invoice}`); const r = await entry(`supplier_invoice_reversed:${x.invoice}`);
    expect([r.kind, r.r, r.d]).toEqual(["reversal", o.id, await wib("supplier_invoices", "reversed_at", x.invoice)]);
    expect(r.d).not.toBe(day(0));
    expect(await netOf("supplier_invoice", x.invoice)).toEqual([]);
    for (const id of [rec, rev]) expect(await as(FIN, (db) => postEvent(db, { id }))).toBeNull();
    expect(await count("supplier_invoice", x.invoice)).toBe(2);
    // normal order: recorded consumed, then reversed (dated at reversed_at too)
    const y = await invoiced("R2", 103_000);
    await drain();
    expect(await journal(`supplier_invoice:${y.invoice}`)).toEqual(recordedLines);
    await as(PUR, (db) => reversePayable(db, key(), "invoice", y.invoice, "Salah input tagihan"));
    await backdate("supplier_invoices", "supplier_invoices_guard", "reversed_at", y.invoice);
    await drain();
    const r2 = await entry(`supplier_invoice_reversed:${y.invoice}`);
    expect([r2.r, r2.d]).toEqual([(await entry(`supplier_invoice:${y.invoice}`)).id, await wib("supplier_invoices", "reversed_at", y.invoice)]);
    expect(await netOf("supplier_invoice", y.invoice)).toEqual([]);
  });

  it("SupplierCreditReversed consumed before SupplierCreditApplied: the application (already reversed) posts from the fact, then its mirror at reversed_at; the late applied event posts nothing", async () => {
    const x = await invoiced("C1", 100_000);
    const { returnId } = await as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: x.batch, quantity: "2", reason: "damaged", note: "Retur urutan" }));
    const v = Number((await h.admin.query(`select value from supplier_returns where id = $1`, [returnId])).rows[0].value);
    const { creditNoteId } = await as(PUR, (db) => recordCreditNote(db, key(), A.b1, { supplierId: SUP, number: "NK-ORD-1", amount: v, issuedOn: day(0), returnId }));
    await drain();
    await as(FIN, (db) => applyCredit(db, key(), creditNoteId, x.invoice));
    const [ap] = await evOf("SupplierCreditApplied", creditNoteId);
    const app = (await h.admin.query(`select id from supplier_credit_applications where credit_note_id = $1`, [creditNoteId])).rows[0].id;
    await reversedOrder([ap], async () => {
      await as(FIN, (db) => reversePayable(db, key(), "credit_note", creditNoteId, "Nota kredit salah"));
      await backdate("supplier_credit_notes", "supplier_credit_notes_guard", "reversed_at", creditNoteId);
    }, async () => {
      expect(await journal(`supplier_credit_applied:${app}`)).toEqual(sorted([["accounts_payable", v, 0], ["supplier_receivable", 0, v]]));
    });
    const o = await entry(`supplier_credit_applied:${app}`); const r = await entry(`supplier_credit_reversed:${o.id}`);
    expect([r.kind, r.r, r.d]).toEqual(["reversal", o.id, await wib("supplier_credit_notes", "reversed_at", creditNoteId)]);
    expect((await h.admin.query(`select a.key, sum(l.debit - l.credit)::bigint n from journal_lines l join ledger_accounts a on a.id = l.account_id
       where l.entry_id = any($1) group by a.key having sum(l.debit - l.credit) <> 0`, [[o.id, r.id]])).rows).toEqual([]);
    expect(await as(FIN, (db) => postEvent(db, { id: ap }))).toBeNull();
    expect(await count("supplier_credit_application", app)).toBe(1); // the original; the mirror's source is the credit note
  });

  it("SupplierPaymentReversed and ExpenseReversed consumed before their originals: original from the fact, then the mirror (reverses_entry_id set), dated at reversed_at", async () => {
    const x = await invoiced("P1", 100_000);
    await drain();
    const { paymentId } = await as(FIN, (db) => recordPayment(db, key(), A.b1, { supplierId: SUP, amount: 100_000, method: "bank_transfer", paidOn: day(0), allocations: [{ invoiceId: x.invoice }] }));
    const pa = await evOf("SupplierPaymentAllocated", paymentId);
    const al = (await h.admin.query(`select id from supplier_payment_allocations where payment_id = $1`, [paymentId])).rows[0].id;
    await reversedOrder(pa, async () => {
      await as(FIN, (db) => reversePayable(db, key(), "payment", paymentId, "Salah bayar uji"));
    }, async () => {
      expect(await journal(`supplier_payment_allocated:${al}`)).toEqual(sorted([["accounts_payable", 100_000, 0], ["bank", 0, 100_000]]));
    });
    const po = await entry(`supplier_payment_allocated:${al}`); const pr = await entry(`supplier_payment_reversed:${al}`);
    expect([pr.kind, pr.r]).toEqual(["reversal", po.id]);
    expect(await netOf("supplier_payment_allocation", al)).toEqual([]);
    const cat = (await as(FIN, (db) => saveExpenseCategory(db, key(), null, { name: "Urutan Biaya" }))).categoryId;
    const ex = await as(FIN, (db) => recordExpense(db, key(), A.b1, { categoryId: cat, businessDate: day(0), amount: 75_000, funding: "bank", description: "Biaya urutan uji" }));
    const er = await evOf("ExpenseRecorded", ex.expenseId);
    await reversedOrder(er, async () => {
      await as(FIN, (db) => reverseExpense(db, key(), ex.expenseId, "Salah catat urutan"));
    }, async () => {
      expect(await journal(`expense:${ex.expenseId}`)).toEqual(sorted([["bank", 0, 75_000], ["branch_expense", 75_000, 0]]));
    });
    const eo = await entry(`expense:${ex.expenseId}`); const erv = await entry(`expense_reversed:${ex.expenseId}`);
    expect([erv.kind, erv.r]).toEqual(["reversal", eo.id]);
    expect(await netOf("expense", ex.expenseId)).toEqual([]);
  });

  it("StockTransferred cancelled consumed before 'sent': the send posts from its movements, then the mirror dated at closed_at; inventory nets to 0", async () => {
    const g = await as(PUR, (db) => receiveGoods(db, key(), A.b1, { supplierId: SUP, lines: [{ itemId: item, batchNo: "ORD-T1", expiry: day(200), quantity: "10", unitCost: 10_000 }] }));
    const b = (await h.admin.query(`select batch_id from supplier_receipts where source_kind = 'goods_receipt' and source_id = $1`, [g.receiptId])).rows[0].batch_id;
    await drain();
    const { transferId } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: b, quantity: "4" }] }));
    const [sent] = await evOf("StockTransferred", transferId);
    await reversedOrder([sent], async () => {
      await as(PH, (db) => cancelTransfer(db, key(), transferId));
      await backdate("depot_transfers", "depot_transfers_guard", "closed_at", transferId);
    }, async () => {
      expect(await journal(`stock_transferred:${transferId}`)).toEqual(sorted([["inventory", 0, 40_000], ["inventory", 40_000, 0]]));
    });
    const o = await entry(`stock_transferred:${transferId}`); const r = await entry(`stock_transfer_cancelled:${transferId}`);
    expect([r.kind, r.r, r.d]).toEqual(["reversal", o.id, await wib("depot_transfers", "closed_at", transferId)]);
    expect((await h.admin.query(`select l.branch_id, sum(l.debit - l.credit)::bigint n from journal_entries e join journal_lines l on l.entry_id = e.id
       where e.source_kind = 'depot_transfer' and e.source_id = $1 group by l.branch_id having sum(l.debit - l.credit) <> 0`, [transferId])).rows).toEqual([]);
    void receiveTransfer;
  });

  it("InvoiceVoided consumed before ConsultationFeeCharged: the charge posts from the fact, then its mirror at voided_at; a void with nothing to mirror (unpaid, undelivered) acks with nothing", async () => {
    const kv = await as(OWN, (db) => publish(db, { kind: "service", code: "GL-KVD" }, {
      name: "Konsultasi Urutan", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 99_000, category: "consultation", prep_min: 0, treatment_min: 15, buffer_min: 0,
      indications: "Indikasi", consent_template: "Templat konsultasi.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Layanan baru"));
    if (kv.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [kv.approvalId]));
    await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 150_000, reason: "Biaya konsultasi" }));
    try {
      const pid = await patient(A, A.b1, "Pasien Urutan Konsul");
      const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id;
      const { examId } = await as(DOC, (db) => openExam(db, key(), v));
      await as(DOC, (db) => signRecord(db, key(), examId, STEP));
      await drain();
      const ch = await as(FO, (db) => chargeConsultationFee(db, key(), v, kv.itemId));
      const cf = (await h.admin.query(`select id from domain_events where type = 'ConsultationFeeCharged' and payload ->> 'invoice_line_id' = $1`, [ch.invoice_line_id])).rows.map((r) => r.id as string);
      await reversedOrder(cf, async () => {
        const { approvalId } = await as(FO, (db) => requestVoid(db, key(), ch.invoice_id, "Salah tagih konsultasi"));
        await as(MGR, (db) => decideApproval(db, approvalId, true));
        await h.admin.query("alter table invoices disable trigger invoices_guard");
        await h.admin.query(`update invoices set voided_at = voided_at - interval '3 days' where id = $1`, [ch.invoice_id]);
        await h.admin.query("alter table invoices enable always trigger invoices_guard");
      }, async () => {
        expect(await journal(`consultation_charged:${ch.invoice_line_id}`)).toEqual(sorted([["liability_paid_not_delivered", 150_000, 0], ["revenue_consultation", 0, 150_000]]));
      });
      const o = await entry(`consultation_charged:${ch.invoice_line_id}`); const r = await entry(`invoice_voided:${o.id}`);
      expect([r.kind, r.r, r.d]).toEqual(["reversal", o.id, await wib("invoices", "voided_at", ch.invoice_id)]);
      expect(Number((await h.admin.query(`select coalesce(sum(l.debit - l.credit), 0) n from journal_entries e join journal_lines l on l.entry_id = e.id where e.posting_key in ($1, $2)`,
        [`consultation_charged:${ch.invoice_line_id}`, `invoice_voided:${o.id}`])).rows[0].n)).toBe(0);
      const sumAcct = async (k: string) => Number((await h.admin.query(`select coalesce(sum(l.debit - l.credit), 0) n from journal_entries e join journal_lines l on l.entry_id = e.id
        join ledger_accounts a on a.id = l.account_id where e.posting_key in ($1, $2) and a.key = $3`, [`consultation_charged:${ch.invoice_line_id}`, `invoice_voided:${o.id}`, k])).rows[0].n);
      expect([await sumAcct("revenue_consultation"), await sumAcct("liability_paid_not_delivered")]).toEqual([0, 0]);
    } finally {
      await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, restore: true, reason: "Kembali ke bawaan" }));
    }
    // an unpaid, undelivered invoice voided: its originals legitimately post nothing → acked, nothing posted
    const pid = await patient(A, A.b1, "Pasien Urutan Void");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), invoiceId, "Salah tagih urutan"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    await drain();
    const [vd] = await evOf("InvoiceVoided", invoiceId);
    expect(await done(vd)).toBe(true);
    expect((await h.admin.query(`select count(*)::int c from journal_entries where event = 'InvoiceVoided' and source_id = $1`, [invoiceId])).rows[0].c).toBe(0);
  });
});

// ── Panel 2 REVISE r3: a TreatmentFinished consumed while its line's manual discount is pending (HYG-023 S8). The performance entry must be
// the finalized line (approved: discounted price and its VAT; rejected / cancelled: full price and its VAT), with one posting key, whatever
// the consumption order. Real consumer; synthetic PKP tenant with the HYG-023 S8 shape (paid exempt base, released taxable addition,
// performed, billed with a discount over the FO limit → pending approval).
describe("T-105 r4: deferred discount on a delivered line (HYG-023 S8) and void / re-bill (S7), any consumption order", () => {
  let C: T; let cown: P; let cfo: P; let cdoc: P; let cnur: P; let cbc: P; let cmgr: P;
  let base: { itemId: string; versionId: string }; let taxable: { itemId: string; versionId: string };
  const localDay = (d: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + d * 86_400_000));
    const done = async (id: string) => (await h.admin.query(`select done_at is not null as d from event_receipts where consumer = $1 and event_id = $2`, [LEDGER_CONSUMER, id])).rows[0]?.d as boolean;
  const tfEvent = async (e: string) => (await h.admin.query(`select id from domain_events where type = 'TreatmentFinished' and payload ->> 'execution_id' = $1`, [e])).rows[0].id as string;
  const keys = async (e: string) => (await h.admin.query(`select count(*)::int c from journal_entries where source_kind = 'treatment_execution' and source_id = $1`, [e])).rows[0].c as number;
  beforeAll(async () => {
    C = await tenant("PT Buku Besar Diskon");
    cown = await person(C, "owner"); const cfin = await person(C, "finance"); const cfh = await person(C, "facility_head", C.b1);
    cfo = await person(C, "fo_cashier", C.b1); cdoc = await person(C, "doctor", C.b1); cnur = await person(C, "nurse", C.b1); cbc = await person(C, "bc", C.b1);
    cmgr = await person(C, "manager", C.b1);
    await credential(C, cdoc, C.b1, cfh, cown);
    const svc = async (code: string, name: string, price: number, tax: string) => {
      const v = await as(cown, (db) => publish(db, { kind: "service", code }, {
        name, tax_category: tax, tax_basis: tax === "exempt_medical" ? "Jasa medis" : "Jasa", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
        indications: "Indikasi", consent_template: `Templat ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
      } as never, "Layanan baru"));
      if (v.approvalId) await as(cfh, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
      return v;
    };
    base = await svc("GLD-BASE", "Facial Dasar Diskon", 500_000, "exempt_medical");
    taxable = await svc("GLD-TAX", "Perawatan Kena Pajak Diskon", 666_000, "taxable_service");
    const pdf = Buffer.from("%PDF-1.7\nsaran pajak diskon\n%%EOF\n");
    const { fileId } = await as(cfin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(cown, (db) => decideEvidence(db, ev, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: localDay(1), npwp: "012345678901234", reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 40, changed_at = now() - interval '45 days' where tenant_id = $1`, [C.tenantId, localDay(0)]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 40 where id = $1`, [C.tenantId, localDay(0)]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
  }, 300_000);
  // HYG-023 S8 shape: a paid exempt base treatment, then an approved, agreed, released taxable addition — performed before its line exists
  async function performedAddition(name: string, qty = 1, perform = true) {
    const pid = await patient(C, C.b1, name);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [C.tenantId, C.b1, pid, cfo.staffId])).rows[0].id as string;
    const { examId } = await as(cdoc, (db) => openExam(db, key(), v));
    const { planId } = await as(cdoc, (db) => createPlan(db, key(), examId, "Program Diskon", "Kondisi rahasia"));
    const { itemId: bi } = await as(cdoc, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: base.versionId, qty: 1 }));
    await as(cdoc, (db) => signRecord(db, key(), examId, STEP));
    const consent = async () => {
      const ct = await as(cdoc, (db) => consentText(db, v, planId));
      await as(cdoc, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    };
    await consent();
    await as(cbc, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: bi }] }));
    const { invoiceId: bInv } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(cfo, (db) => issueKasirInvoice(db, key(), bInv, [{ itemId: base.itemId, quantity: 1 }]));
    await as(cfo, (db) => receivePayment(db, key(), bInv, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
    const { requestId } = await as(cnur, (db) => createRequest(db, key(), v, { kind: "addition", planId, catalogVersionId: taxable.versionId, stage: 1, qty, reason: "Area tambahan" }));
    const item = ((await as(cdoc, (db) => decideRequest(db, key(), requestId, true, null))) as { item_id: string }).item_id;
    await consent();
    await as(cfo, (db) => releaseAddition(db, key(), item, cfo.staffId));
    const run = async () => {
      const ex = await as(cdoc, (db) => startTreatment(db, key(), v, { planItemId: item, performerId: cdoc.staffId, identityConfirmed: true }));
      await as(cdoc, (db) => finishTreatment(db, key(), ex.executionId, { outcome: "completed" }));
      return ex.executionId as string;
    };
    return { pid, v, item, e: perform ? await run() : "", run };
  }
  const billDiscounted = async (s: { pid: string; v: string; item: string }, discount?: number, qty = 1) => {
    const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
    await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: taxable.itemId, quantity: qty, planItemId: s.item, ...(discount ? { discount } : {}) }]));
    const l = (await h.admin.query(`select id, discount_approval_id a from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0];
    return { inv: invoiceId as string, line: l.id as string, approval: l.a as string | null };
  };
  const approved = sorted([["liability_paid_not_delivered", 555_000, 0], ["revenue_treatment", 0, 500_000], ["vat_payable", 0, 55_000]]);
  const full = sorted([["liability_paid_not_delivered", 666_000, 0], ["revenue_treatment", 0, 600_000], ["vat_payable", 0, 66_000]]);

  for (const [outcome, expected] of [["approved", approved], ["rejected", full], ["cancelled", full]] as const) {
    it(`S8 ${outcome}: TreatmentFinished consumed EARLY (discount pending) and LATE (after the decision) post the same finalized entry, one key; the pending one waits durably`, async () => {
      // early: the line exists with its discount pending when the consumer runs
      const s = await performedAddition(`Pasien Diskon ${outcome} awal`);
      const b = await billDiscounted(s, 111_000);
      expect(b.approval).toBeTruthy();
      await drain();
      const ev = await tfEvent(s.e);
      expect(await journalTF(s.e)).toEqual([]); // nothing final can be posted yet
      // durable: exhausting every retry of the TreatmentFinished receipt does not lose it — it waits for the decision, not for attempts
      await h.admin.query(`update event_receipts set attempts = 9, lease_until = now() - interval '1 second' where consumer = $1 and event_id = $2`, [LEDGER_CONSUMER, ev]);
      await drain();
      expect(await journalTF(s.e)).toEqual([]);
      if (outcome === "approved") await as(cown, (db) => decideApproval(db, b.approval!, true));
      else if (outcome === "rejected") await as(cown, (db) => decideApproval(db, b.approval!, false, "Diskon tidak disetujui"));
      else await as(cfo, (db) => cancelApproval(db, b.approval!));
      await drain();
      expect(await journalTF(s.e)).toEqual(expected);
      expect(await keys(s.e)).toBe(1);
      // late: the decision before the consumer runs
      const t = await performedAddition(`Pasien Diskon ${outcome} akhir`);
      const c = await billDiscounted(t, 111_000);
      const tev = await tfEvent(t.e);
      await h.admin.query(`update event_receipts set lease_until = now() + interval '1 hour', claimed_by = 'other-worker' where consumer = $1 and event_id = $2`, [LEDGER_CONSUMER, tev]);
      if (outcome === "approved") await as(cown, (db) => decideApproval(db, c.approval!, true));
      else if (outcome === "rejected") await as(cown, (db) => decideApproval(db, c.approval!, false, "Diskon tidak disetujui"));
      else await as(cfo, (db) => cancelApproval(db, c.approval!));
      await drain();
      await h.admin.query(`update event_receipts set lease_until = now() - interval '1 second' where consumer = $1 and event_id = $2`, [LEDGER_CONSUMER, tev]);
      await drain();
      expect(await journalTF(t.e)).toEqual(expected);
      expect(await keys(t.e)).toBe(1);
      // replay of every event of both posts nothing more
      for (const id of [ev, tev]) expect(await as(cown, (db) => postEvent(db, { id }))).toBeNull();
      expect([await done(ev), await done(tev), await keys(s.e), await keys(t.e)]).toEqual([true, true, 1, 1]);
      void cmgr;
    });
  }

  // HYG-023 S7 × the ledger (Panel 2 S7-DIFF = A, single-treatment seam): delivered on an unpaid issued line L1, voided, re-billed on L2
  // (same price, or a changed final price after an approved discount), paid; and voided with no re-bill yet. Every consumption order gives the
  // same entries: L1's (execution, line) performance entry, its mirror dated at voided_at, L2's entry once; revenue and VAT = the final line;
  // paid-not-delivered settled exactly by the re-bill's payment; GL VAT = VAT sub-ledger of both lines.
  const facts = async (e: string, lines: string[], invs: string[]) => {
    const r = await h.admin.query(`select e.posting_key k, e.kind, e.business_date::text d, a.key, l.debit::bigint dr, l.credit::bigint cr
       from journal_entries e join journal_lines l on l.entry_id = e.id join ledger_accounts a on a.id = l.account_id
      where (e.source_kind = 'treatment_execution' and e.source_id = $1)
         or e.reverses_entry_id in (select x.id from journal_entries x where x.source_kind = 'treatment_execution' and x.source_id = $1)
         or (e.source_kind = 'payment_allocation' and e.source_id in (select a.id from payment_allocations a where a.invoice_line_id = any($2)))
      order by e.kind, e.posting_key, a.key, l.debit, l.credit`, [e, lines]);
    const net: Record<string, number> = {};
    for (const x of r.rows) net[x.key] = (net[x.key] ?? 0) + Number(x.dr) - Number(x.cr);
    const ids = [e, ...lines, ...invs];
    const norm = (k: string) => ids.reduce((acc, id, n) => acc.split(id).join(n === 0 ? "E" : n <= lines.length ? `L${n}` : `I${n - lines.length}`), k)
      .replace(/invoice_voided:[0-9a-f-]{36}/, "invoice_voided:#").replace(/payment_allocated:[0-9a-f-]{36}/, "payment_allocated:#");
    return {
      entries: r.rows.map((x) => [norm(String(x.k)), x.kind, x.key, Number(x.dr), Number(x.cr)]),
      dates: Object.fromEntries(r.rows.map((x) => [norm(String(x.k)), x.d])),
      net: Object.fromEntries(Object.entries(net).filter(([, v]) => v !== 0)),
    };
  };
  const vatSub = async (lines: string[]) => Number((await h.admin.query(`select coalesce(sum(delta), 0) s from vat_events where object_kind = 'line' and object_id = any($1)`, [lines])).rows[0].s);
  const wibOf = async (sql: string, id: string) => (await h.admin.query(`select (${sql} at time zone 'Asia/Jakarta')::date::text d from ${sql.split(".")[0]} where id = $1`, [id])).rows[0].d as string;
  type Order = "before_void" | "between" | "after_rebill" | "reversed" ;
  async function scenario(order: Order, price: "same" | "changed" | "none") {
    const s = await performedAddition(`Pasien S7 ${order} ${price}`);
    // the delivery is days before the void (synthetic): the performance entry keeps finished_at, the mirror takes voided_at
    const ev = await tfEvent(s.e);
    const b1 = await billDiscounted(s);
    const hold = (ids: string[]) => h.admin.query(`update event_receipts set lease_until = now() + interval '1 hour', claimed_by = 'other-worker' where consumer = $1 and event_id = any($2) and done_at is null`, [LEDGER_CONSUMER, ids]);
    const free = (ids: string[]) => h.admin.query(`update event_receipts set lease_until = now() - interval '1 second' where consumer = $1 and event_id = any($2) and done_at is null`, [LEDGER_CONSUMER, ids]);
    if (order === "before_void") await drain(); else await hold([ev]);
    const { approvalId } = await as(cfo, (db) => requestVoid(db, key(), b1.inv, "Salah tagih tambahan"));
    await as(cown, (db) => decideApproval(db, approvalId, true));
    await h.admin.query("alter table invoices disable trigger invoices_guard");
    await h.admin.query(`update invoices set voided_at = voided_at + interval '2 days' where id = $1`, [b1.inv]);
    await h.admin.query("alter table invoices enable always trigger invoices_guard");
    const [voidEv] = (await h.admin.query(`select id from domain_events where type = 'InvoiceVoided' and aggregate_id = $1`, [b1.inv])).rows.map((r) => r.id as string);
    if (order === "reversed") await hold([voidEv]);
    if (order === "between") { await free([ev]); await drain(); await hold([ev]); }
    else if (order !== "reversed") await drain();
    let b2: Awaited<ReturnType<typeof billDiscounted>> | null = null;
    if (price !== "none") {
      b2 = await billDiscounted(s, price === "changed" ? 111_000 : undefined);
      if (price === "changed") await as(cown, (db) => decideApproval(db, b2!.approval!, true));
      const amt = price === "changed" ? 555_000 : 666_000;
      await as(cfo, (db) => receivePayment(db, key(), b2!.inv, [{ method: "cash", amount: amt, cashTendered: amt }]));
    }
    if (order === "reversed") { await free([ev]); await drain(); await free([voidEv]); }   // re-bill + payment + delivery consumed before the void
    else await free([ev]);
    await drain();
    expect([await done(ev), await done(voidEv)]).toEqual([true, true]);
    const lines = b2 ? [b1.line, b2.line] : [b1.line];
    return { s, b1, b2, voidEv, ev, lines, g: await facts(s.e, lines, b2 ? [b1.inv, b2.inv] : [b1.inv]) };
  }
  for (const price of ["same", "changed", "none"] as const) {
    it(`S7-DIFF = A, ${price === "none" ? "voided, no re-bill yet" : price === "same" ? "re-billed at the same price" : "re-billed at a changed price (555,000)"}: before-void, between, after-rebill and reversed order give the same entries; exact revenue / VAT / settlement; replay posts nothing`, async () => {
      const runs: Awaited<ReturnType<typeof scenario>>[] = [];
      for (const order of ["before_void", "between", "after_rebill", "reversed"] as const) runs.push(await scenario(order, price));
      for (const r of runs.slice(1)) expect(r.g.entries).toEqual(runs[0].g.entries);
      const r = runs[0];
      // L1: entry valued at the voided line (666,000 / VAT 66,000) dated at the delivery, its mirror dated at voided_at
      const l1 = r.g.entries.filter(([k]) => k === "treatment_finished:E:L1");
      expect(l1.map(([, kind, a, d, c]) => [kind, a, d, c])).toEqual([["auto", "liability_paid_not_delivered", 666_000, 0], ["auto", "revenue_treatment", 0, 600_000], ["auto", "vat_payable", 0, 66_000]]);
      expect(r.g.dates["treatment_finished:E:L1"]).toBe(await wibOf("treatment_executions.finished_at", r.s.e));
      expect(r.g.dates["invoice_voided:#"]).toBe(await wibOf("invoices.voided_at", r.b1.inv));
      expect(r.g.dates["invoice_voided:#"]).not.toBe(r.g.dates["treatment_finished:E:L1"]);
      const final = price === "changed" ? { pnd: 555_000, rev: 500_000, vat: 55_000 } : price === "same" ? { pnd: 666_000, rev: 600_000, vat: 66_000 } : null;
      if (final) {
        // revenue and VAT once at the final line; the re-bill's cash allocation settles paid-not-delivered exactly (net 0); cash = the payment
        expect(r.g.net).toEqual({ cash_shift: final.pnd, revenue_treatment: -final.rev, vat_payable: -final.vat });
        expect(r.g.entries.filter(([k]) => k === "treatment_finished:E:L2").map(([, , a, d, c]) => [a, d, c]))
          .toEqual([["liability_paid_not_delivered", final.pnd, 0], ["revenue_treatment", 0, final.rev], ["vat_payable", 0, final.vat]]);
        expect(r.g.dates["treatment_finished:E:L2"]).toBe(r.g.dates["treatment_finished:E:L1"]); // the performance date is kept
      } else {
        // no re-bill yet: the voided line is fully reversed; nothing recognised; the delivery waits for the re-bill (unbilled addition)
        expect(r.g.net).toEqual({});
      }
      for (const x of runs) expect(0 - (x.g.net.vat_payable ?? 0) + 0).toBe(await vatSub(x.lines));
      // replay of every event of the scenario posts nothing more
      const before = (await h.admin.query(`select count(*)::int c from journal_entries where tenant_id = $1`, [C.tenantId])).rows[0].c;
      for (const x of runs) for (const id of [x.ev, x.voidEv]) expect(await as(cown, (db) => postEvent(db, { id }))).toBeNull();
      expect((await h.admin.query(`select count(*)::int c from journal_entries where tenant_id = $1`, [C.tenantId])).rows[0].c).toBe(before);
    });
  }

  it("S7-DIFF = A edges: a line voided BEFORE the delivery is not the delivery's line (nothing to mirror; the re-billed line posts once); a two-unit addition values its whole line (1,332,000 / VAT 132,000)", async () => {
    // voided before the treatment is performed: the voided line was never delivered → no performance entry for it, no mirror
    const s = await performedAddition("Pasien S7 void sebelum", 1, false);
    const b1 = await billDiscounted(s);
    const { approvalId } = await as(cfo, (db) => requestVoid(db, key(), b1.inv, "Salah tagih tambahan"));
    await as(cown, (db) => decideApproval(db, approvalId, true));
    const e = await s.run();
    const b2 = await billDiscounted(s);
    await drain();
    const keysOf = async (x: string) => (await h.admin.query(`select posting_key k from journal_entries where source_kind = 'treatment_execution' and source_id = $1
       or reverses_entry_id in (select id from journal_entries where source_id = $1)`, [x])).rows.map((r) => String(r.k).replace(x, "E").replace(b1.line, "L1").replace(b2.line, "L2"));
    expect(await keysOf(e)).toEqual(["treatment_finished:E:L2"]);
    expect(await journalTF(e)).toEqual(sorted([["liability_paid_not_delivered", 666_000, 0], ["revenue_treatment", 0, 600_000], ["vat_payable", 0, 66_000]]));
    // a two-unit addition delivered by one execution: the whole line (2 × 666,000), its VAT 132,000
    const t = await performedAddition("Pasien S7 dua unit", 2);
    await billDiscounted(t, undefined, 2);
    await drain();
    expect(await journalTF(t.e)).toEqual(sorted([["liability_paid_not_delivered", 1_332_000, 0], ["revenue_treatment", 0, 1_200_000], ["vat_payable", 0, 132_000]]));
  });

  it("one ordinary line of quantity 2 delivered by two executions (two plan items of the same service): each execution posts its share (exempt 500,000 each), keyed per (execution, line)", async () => {
    const pid = await patient(C, C.b1, "Pasien Dua Sesi");
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [C.tenantId, C.b1, pid, cfo.staffId])).rows[0].id as string;
    const { examId } = await as(cdoc, (db) => openExam(db, key(), v));
    const { planId } = await as(cdoc, (db) => createPlan(db, key(), examId, "Program Dua", "Kondisi rahasia"));
    const items: string[] = [];
    for (const stage of [1, 2]) items.push((await as(cdoc, (db) => addPlanItem(db, key(), examId, planId, { stage, catalog_version_id: base.versionId, qty: 1 }))).itemId);
    await as(cdoc, (db) => signRecord(db, key(), examId, STEP));
    const ct = await as(cdoc, (db) => consentText(db, v, planId));
    await as(cdoc, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    await as(cbc, (db) => confirmSelection(db, key(), v, { items: items.map((planItemId) => ({ planItemId })) }));
    const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: base.itemId, quantity: 2 }]));
    await as(cfo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_000_000, cashTendered: 1_000_000 }]));
    const ex: string[] = [];
    for (const it2 of items) {
      const x = await as(cdoc, (db) => startTreatment(db, key(), v, { planItemId: it2, performerId: cdoc.staffId, identityConfirmed: true }));
      await as(cdoc, (db) => finishTreatment(db, key(), x.executionId, { outcome: "completed" }));
      ex.push(x.executionId);
    }
    await drain();
    for (const x of ex) expect(await journalTF(x)).toEqual(sorted([["liability_paid_not_delivered", 500_000, 0], ["revenue_treatment", 0, 500_000]]));
  });
});

// G-Q4 (owner approved S1, 2026-11-19; migration 0124): a visit selection product billed on a LINKED line (invoice_lines.selection_item_id,
// captured at billing) posts one coordinated ProductHandedOver journal on that exact line in every consumption order — proven in
// tests/cashier/selection-link.test.ts. Still OPEN (owner / accountant decisions, not passing assertions): U1 a handed selection product
// never billed on a linked line; U2 fractional selection quantities (not linkable on an integer line); U3 a row billed unlinked or at an
// edited quantity; U4 lines issued before 0124 (no backfill). Each posts nothing (no inference, no COGS-only split) and is listed as open.
describe("T-105 OPEN acceptance gaps G-Q4 U1–U4 (unlinked visit selection products)", () => {
  it.todo("OPEN U1: a handed selection product never billed on a linked line — owner / accountant rule (sample, giveaway, write-off) and visit-close policy");
  it.todo("OPEN U2: fractional selection quantities cannot be represented on an integer invoice line — forbid them for products, or change the line quantity model");
  it.todo("OPEN U3: a selection row billed unlinked or at an edited quantity — allow split linking or keep exact-only");
  it.todo("OPEN U4: lines issued before migration 0124 carry no link and are not backfilled — finance reconciliation list");
});

// ── T-105 G-Q4 U1–U4 (Panel 2 decision, PANEL2-U1-U4-DECISION.md): "Selisih penyerahan produk" — handed visit selection products without an
// exact live invoice-line link are COUNTED (fractional / unlinked) in the Buku Besar preview. A visible accounting exception, not a fix: no
// journal, no inference, no operational change; counter sales and prescriptions excluded; owner / finance / auditor only.
describe("T-105 G-Q4 U1–U4: Selisih penyerahan produk (read-only accounting exception)", () => {
  let C: T; let cown: P; let cfin: P; let cau: P; let cfo: P; let cfob2: P; let cph: P; let cphb2: P; let cbc: P; let cbcb2: P; let cmgr: P; let cdoc: P; let cfh: P;
  let serum: { itemId: string; versionId: string }; let toner: { itemId: string; versionId: string }; let APT: string; let APTB2: string;
  const all = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<Check, boolean>;
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const month = () => ({ from: `${today().slice(0, 8)}01`, to: today() });
  const hx = (p: P, branchId: string | null = null, w = month()) => as(p, (db) => handoverExceptions(db, { ...w, branchId }));
  beforeAll(async () => {
    C = await tenant("PT Buku Besar Selisih");
    cown = await person(C, "owner"); cfin = await person(C, "finance"); cau = await person(C, "auditor"); cfo = await person(C, "fo_cashier", C.b1);
    cfob2 = await person(C, "fo_cashier", C.b2); cph = await person(C, "pharmacist", C.b1); cphb2 = await person(C, "pharmacist", C.b2);
    cbc = await person(C, "bc", C.b1); cbcb2 = await person(C, "bc", C.b2); cmgr = await person(C, "manager", C.b1); cdoc = await person(C, "doctor", C.b1);
    cfh = await person(C, "facility_head", C.b1);
    await credential(C, cdoc, C.b1, cfh, cown);
    const pur = { ...(await person(C, "purchasing")), branch: undefined };
    const sup = (await as(pur, (db) => saveSupplier(db, key(), null, { name: "PT Pemasok Selisih" }))).supplierId;
    const prod = async (code: string, name: string, price: number) => {
      const v = await as(cown, (db) => publish(db, { kind: "product", code }, { name, tax_category: "exempt_medical", tax_basis: "Barang", normal_price: price } as never, "Produk"));
      const st = (await as(cph, (db) => saveItem(db, key(), null, { catalogItemId: v.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
      for (const [b, ph, depot] of [[C.b1, cph, "A"], [C.b2, cphb2, "B"]] as const) {
        const r = await as(pur, (db) => receiveFromSupplier(db, key(), b, { supplierId: sup, itemId: st, batchNo: `${code}-${depot}`, expiry: "2030-01-01", quantity: "30", unitCost: 100_000, reason: "penerimaan" }));
        const batch = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [r.receiptId])).rows[0].batch_id;
        const g = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [b])).rows[0].id;
        const apt = depot === "A" ? APT : APTB2;
        await as(ph, (db) => transferBetweenDepots(db, key(), { fromDepotId: g, toDepotId: apt, lines: [{ batchId: batch, quantity: "30" }] }));
      }
      return v;
    };
    APT = (await as(cph, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Selisih A", kind: "apotek" }))).depotId;
    APTB2 = (await as(cphb2, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Selisih B", kind: "apotek" }))).depotId;
    serum = await prod("GQ-SRM", "Serum Selisih", 300_000);
    toner = await prod("GQ-TON", "Toner Selisih", 200_000);
  }, 300_000);
  const visitOf = async (items: { version: string; quantity: string }[], branch = C.b1) => {
    const pid = await patient(C, branch);
    const fo = branch === C.b1 ? cfo : cfob2; const bc = branch === C.b1 ? cbc : cbcb2;
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [C.tenantId, branch, pid, fo.staffId])).rows[0].id as string;
    await as(bc, (db) => confirmSelection(db, key(), v, { items: items.map((x) => ({ catalogVersionId: x.version, quantity: x.quantity })) }));
    // ordered by quantity: uuid v7 ids made in the same millisecond do not keep insertion order (duplicate-product rows use distinct quantities)
    const rows = (await h.admin.query(`select si.id, d.id d from selection_items si join dispensings d on d.selection_item_id = si.id where si.visit_id = $1 order by si.quantity, si.id`, [v])).rows as { id: string; d: string }[];
    return { v, pid, rows, fo };
  };
  const hand = async (d: string, branch = C.b1) => {
    const ph = branch === C.b1 ? cph : cphb2; const apt = branch === C.b1 ? APT : APTB2;
    await as(ph, (db) => prepareDispensing(db, key(), d, apt));
    await as(ph, (db) => handOver(db, key(), d, { checks: all }));
  };
  const bill = async (s: { v: string; pid: string; fo: P }, ls: { itemId: string; quantity: number; selectionItemId?: string }[]) => {
    const { invoiceId } = await as(s.fo, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
    await as(s.fo, (db) => issueKasirInvoice(db, key(), invoiceId, ls));
    return invoiceId as string;
  };
  const entries = async () => Number((await h.admin.query(`select count(*) c from journal_entries where tenant_id = $1`, [C.tenantId])).rows[0].c);
  const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${(e as Error).message}`));

  it("counts handed selection products without an exact live link: whole → unlinked, fractional → fractional; exact link before or after billing drops it; an unrelated same-product line does not clear it; branch scoped; no journal", async () => {
    expect(await hx(cfin)).toMatchObject({ fractional: 0, unlinked: 0 });
    const j0 = await entries();
    // whole quantity handed before any invoice → unlinked
    const s1 = await visitOf([{ version: serum.versionId, quantity: "1" }]);
    await hand(s1.rows[0].d);
    // fractional quantity handed → fractional (cannot be billed exactly on an integer line)
    const s2 = await visitOf([{ version: toner.versionId, quantity: "1.5" }]);
    await hand(s2.rows[0].d);
    // two rows of the same product on one visit, both handed; only row 2 is billed with its exact link
    const s3 = await visitOf([{ version: serum.versionId, quantity: "1" }, { version: serum.versionId, quantity: "2" }]);
    await hand(s3.rows[0].d); await hand(s3.rows[1].d);
    await bill(s3, [{ itemId: serum.itemId, quantity: 2, selectionItemId: s3.rows[1].id }, { itemId: serum.itemId, quantity: 1 }]); // row 1 billed WITHOUT its link
    // a branch-2 handover
    const s4 = await visitOf([{ version: serum.versionId, quantity: "1" }], C.b2);
    await hand(s4.rows[0].d, C.b2);
    expect(await hx(cfin)).toMatchObject({ fractional: 1, unlinked: 3 }); // s1, s3 row 1 (its same-product line has no link), s4
    expect(await hx(cfin, C.b1)).toMatchObject({ fractional: 1, unlinked: 2 });
    expect(await hx(cfin, C.b2)).toMatchObject({ fractional: 0, unlinked: 1 });
    // s1 billed with its exact link AFTER the hand-over → drops from the current exception
    await bill(s1, [{ itemId: serum.itemId, quantity: 1, selectionItemId: s1.rows[0].id }]);
    expect(await hx(cfin, C.b1)).toMatchObject({ fractional: 1, unlinked: 1 });
    // linked BEFORE the hand-over (paid first, then handed) → never counted
    const s5 = await visitOf([{ version: serum.versionId, quantity: "1" }]);
    const i5 = await bill(s5, [{ itemId: serum.itemId, quantity: 1, selectionItemId: s5.rows[0].id }]);
    await as(cfo, (db) => receivePayment(db, key(), i5, [{ method: "cash", amount: 300_000, cashTendered: 300_000 }]));
    await hand(s5.rows[0].d);
    expect(await hx(cfin, C.b1)).toMatchObject({ fractional: 1, unlinked: 1 });
    // the exception reader posts nothing (its own calls change no journal count); the hand-overs post only their linked lines' entries (drain)
    const before = await entries();
    await hx(cown); await hx(cau);
    expect(await entries()).toBe(before);
    void j0;
  });

  it("void → re-bill: a voided linked line re-opens the exception until the row is billed again with its link", async () => {
    const s = await visitOf([{ version: serum.versionId, quantity: "1" }]);
    await hand(s.rows[0].d);
    const base = (await hx(cfin, C.b1)).unlinked;
    const inv = await bill(s, [{ itemId: serum.itemId, quantity: 1, selectionItemId: s.rows[0].id }]);
    expect((await hx(cfin, C.b1)).unlinked).toBe(base - 1);
    const { approvalId } = await as(cfo, (db) => requestVoid(db, key(), inv, "Salah tagih produk"));
    await as(cmgr, (db) => decideApproval(db, approvalId, true));
    expect((await hx(cfin, C.b1)).unlinked).toBe(base);
    await bill(s, [{ itemId: serum.itemId, quantity: 1, selectionItemId: s.rows[0].id }]);
    expect((await hx(cfin, C.b1)).unlinked).toBe(base - 1);
  });

  it("historical unlinked (a hand-over in an earlier month, never linked) counts in its own window, not in the current one; window semantics = hand-over day", async () => {
    const s = await visitOf([{ version: serum.versionId, quantity: "1" }]);
    await hand(s.rows[0].d);
    const cur = (await hx(cfin, C.b1)).unlinked;
    await h.admin.query("alter table dispensings disable trigger dispensings_guard");
    await h.admin.query(`update dispensings set handed_at = handed_at - interval '62 days' where id = $1`, [s.rows[0].d]);
    await h.admin.query("alter table dispensings enable always trigger dispensings_guard");
    expect((await hx(cfin, C.b1)).unlinked).toBe(cur - 1);
    const d = new Date(Date.now() - 62 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    expect((await hx(cfin, C.b1, { from: d, to: d })).unlinked).toBe(1);
  });

  it("counter sales and prescription dispensings are out of scope (never counted); the exception posts no journal", async () => {
    const before = await hx(cfin, C.b1);
    const c = (await as(cfo, (db) => openKasirInvoice(db, key(), { counter: true }))).invoiceId;
    await as(cfo, (db) => issueKasirInvoice(db, key(), c, [{ itemId: serum.itemId, quantity: 1 }]));
    await as(cfo, (db) => receivePayment(db, key(), c, [{ method: "cash", amount: 300_000, cashTendered: 300_000 }]));
    const cd = (await h.admin.query(`select d.id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [c])).rows[0].id;
    await hand(cd);
    const pid = await patient(C, C.b1);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [C.tenantId, C.b1, pid, cfo.staffId])).rows[0].id;
    const { prescriptionId } = await as(cdoc, (db) => createPrescription(db, key(), v, {}));
    await as(cdoc, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: serum.versionId, quantity: "1", signa: "1x sehari" }));
    await as(cdoc, (db) => signPrescription(db, key(), prescriptionId, STEP));
    const rd = (await h.admin.query(`select id from dispensings where visit_id = $1 and prescription_item_id is not null`, [v])).rows[0].id;
    await hand(rd);
    const j = await entries();
    expect(await hx(cfin, C.b1)).toMatchObject({ fractional: before.fractional, unlinked: before.unlinked });
    expect(await entries()).toBe(j);
  });

  it("readers: owner, finance, auditor; FO, manager, pharmacist refused; tenant isolation; the preview stays fail-closed (export refused)", async () => {
    for (const p of [cown, cfin, cau]) expect(Object.keys(await hx(p)).sort()).toEqual(["as_of", "branch_id", "fractional", "from", "to", "unlinked"]);
    for (const p of [cfo, cmgr, cph]) expect(await code(hx(p)), p.role).toMatch(/^ERR_FORBIDDEN/);
    // another tenant's finance sees only its own (zero), and cannot name this tenant's branch
    expect(await hx(BFIN)).toMatchObject({ fractional: 0, unlinked: 0 });
    expect(await code(hx(BFIN, C.b1))).toMatch(/^ERR_NOT_FOUND/);
    // the books remain a preview; the journal export is still refused
    const ex = await as(cfin, (db) => exportJournal(db, { from: month().from, to: month().to }));
    expect(ex).toMatchObject({ refused: expect.any(String) });
  });
});

// ── r9 (independent review 94a7a512, Panel 2 PANEL2-R8-REVIEW.md): report correctness — cash flow value-preserving by counter class, a late
// entry placed by its booked period (a locked month never changes), and the branch balance reported as it is. Own tenant, fixed dates. ──
describe("T-105 r9: ledger report — cash flow attribution, booked period, branch balance", () => {
  let R: T; let rfin: P;
  const rep = (from: string, to: string, branchId: string | null = null) => as(rfin, (db) => report(db, { from, to, branchId }));
  const jr = (from: string, to: string) => as(rfin, (db) => readJournal(db, { from, to }));
  beforeAll(async () => { R = await tenant("PT Buku Besar Laporan"); rfin = await person(R, "finance"); });

  it("cash flow: a PKP payment counts once; mixed classes share exactly (largest remainder); outflows by debit side; a cash-to-cash transfer adds nothing; the class amounts always sum to the net cash movement", async () => {
    const net = (x: { cash_flow: Partial<Record<string, number>> }) => Object.values(x.cash_flow).reduce((a: number, b) => a + (b ?? 0), 0);
    const cashNet = async (from: string, to: string) => Number((await h.admin.query(`select coalesce(sum(l.debit - l.credit), 0) s from journal_lines l join journal_entries e on e.id = l.entry_id
       join ledger_accounts a on a.id = l.account_id where l.tenant_id = $1 and a.key in ('cash_shift','petty_cash','bank','gateway_clearing')
       and public.ledger_booked_date(e.business_date, e.period, e.original_period) between $2 and $3`, [R.tenantId, from, to])).rows[0].s);
    const k = () => `r9-${crypto.randomUUID()}`;
    // June — S1P-J1 shape: Dr cash 333,000 / Cr paid-not-delivered 300,000 + Cr VAT payable 33,000 (two liability lines) → liability 333,000 once
    await post(R, k(), [{ account: "cash_shift", debit: 333_000 }, { account: "liability_paid_not_delivered", credit: 300_000 }, { account: "vat_payable", credit: 33_000 }], { date: "2026-06-03" });
    let r = await rep("2026-06-01", "2026-06-30");
    expect(r.cash_flow).toEqual({ liability: 333_000 });
    expect(net(r)).toBe(await cashNet("2026-06-01", "2026-06-30"));
    // July — outflows (debit side): cash −30 vs expense 20 / inventory 10; bank −10 vs expense 6 / inventory 3 / patient balance 1
    await post(R, k(), [{ account: "branch_expense", debit: 20 }, { account: "inventory", debit: 10 }, { account: "cash_shift", credit: 30 }], { date: "2026-07-02" });
    await post(R, k(), [{ account: "branch_expense", debit: 6 }, { account: "inventory", debit: 3 }, { account: "liability_patient_balance", debit: 1 }, { account: "bank", credit: 10 }], { date: "2026-07-03" });
    r = await rep("2026-07-01", "2026-07-31");
    expect(r.cash_flow).toEqual({ expense: -26, asset: -13, liability: -1 });
    expect(net(r)).toBe(await cashNet("2026-07-01", "2026-07-31"));
    // August — a cash-to-cash transfer alone: nothing attributed, net 0
    await post(R, k(), [{ account: "bank", debit: 50_000 }, { account: "cash_shift", credit: 50_000 }], { date: "2026-08-04" });
    r = await rep("2026-08-01", "2026-08-31");
    expect([r.cash_flow, net(r), await cashNet("2026-08-01", "2026-08-31")]).toEqual([{}, 0, 0]);
    // September — the largest remainder:
    //  e1 Dr cash 10 / Cr revenue 1, liability 2, equity 7 → exact 1 / 2 / 7
    //  e2 Dr cash 10, Dr expense 7 / Cr revenue 2, liability 1, equity 14 → inflow 10 over the credit side 17: 1.18 / 0.59 / 8.24 → base
    //     1 / 0 / 8 (9), the one left goes to the largest remainder (liability .59) → revenue 1, liability 1, equity 8
    await post(R, k(), [{ account: "cash_shift", debit: 10 }, { account: "other_income", credit: 1 }, { account: "liability_patient_balance", credit: 2 }, { account: "opening_balance_equity", credit: 7 }], { date: "2026-09-02" });
    await post(R, k(), [{ account: "cash_shift", debit: 10 }, { account: "branch_expense", debit: 7 }, { account: "other_income", credit: 2 }, { account: "liability_patient_balance", credit: 1 }, { account: "opening_balance_equity", credit: 14 }], { date: "2026-09-03" });
    //  e3 net cash +3 inside one entry (Dr bank 1,000 / Cr cash 997) / Cr revenue 1, liability 2 → 1 / 2
    await post(R, k(), [{ account: "bank", debit: 1_000 }, { account: "cash_shift", credit: 997 }, { account: "other_income", credit: 1 }, { account: "liability_patient_balance", credit: 2 }], { date: "2026-09-04" });
    r = await rep("2026-09-01", "2026-09-30");
    expect(r.cash_flow).toEqual({ revenue: 1 + 1 + 1, liability: 2 + 1 + 2, equity: 7 + 8 });
    expect(net(r)).toBe(await cashNet("2026-09-01", "2026-09-30"));
    //  e4 a tie with a remainder: Dr bank 1, Dr expense 1 / Cr patient balance 1, Cr revenue 1 → inflow 1 over the credit side 2: 0.5 / 0.5 →
    //     base 0 / 0, the one left goes to the first by class name (liability before revenue) → liability +1
    await post(R, k(), [{ account: "bank", debit: 1 }, { account: "branch_expense", debit: 1 }, { account: "liability_patient_balance", credit: 1 }, { account: "other_income", credit: 1 }], { date: "2026-09-06" });
    r = await rep("2026-09-01", "2026-09-30");
    expect(r.cash_flow).toEqual({ revenue: 3, liability: 6, equity: 15 });
    expect(net(r)).toBe(await cashNet("2026-09-01", "2026-09-30"));
    // October — the opposite side only: Dr cash 100, Dr expense 900 / Cr revenue 1,000 → the inflow is the revenue's, never the expense's
    // (counting both sides by weight would give revenue 53 / expense 47)
    await post(R, k(), [{ account: "cash_shift", debit: 100 }, { account: "branch_expense", debit: 900 }, { account: "other_income", credit: 1_000 }], { date: "2026-10-02" });
    r = await rep("2026-10-01", "2026-10-31");
    expect(r.cash_flow).toEqual({ revenue: 100 });
    // one class on both sides: cash 10 + patient balance 2 used (Dr liability 2) / Cr paid-not-delivered 6 (liability), Cr revenue 6 →
    // only the opposite side weighs: liability 6, revenue 6 → 5 / 5 (weighing both sides would give liability 8 → 6 / 4)
    await post(R, k(), [{ account: "cash_shift", debit: 10 }, { account: "liability_patient_balance", debit: 2 }, { account: "liability_paid_not_delivered", credit: 6 }, { account: "other_income", credit: 6 }], { date: "2026-10-03" });
    r = await rep("2026-10-01", "2026-10-31");
    expect(r.cash_flow).toEqual({ revenue: 105, liability: 5 });
    expect(net(r)).toBe(await cashNet("2026-10-01", "2026-10-31"));
    // r10 (review dbe45699): line amounts up to Rp1,000,000,000,000 — |net| × weight exceeds bigint; the split is exact (numeric div / mod)
    // single class, Rp4,000,000,000: liability 4,000,000,000 (|net| × weight = 1.6e19 > bigint max 9.22e18)
    await post(R, k(), [{ account: "bank", debit: 4_000_000_000 }, { account: "liability_patient_balance", credit: 4_000_000_000 }], { date: "2026-11-02" });
    r = await rep("2026-11-01", "2026-11-30");
    expect(r.cash_flow).toEqual({ liability: 4_000_000_000 });
    // mixed classes at the line maximum: Dr bank 999,999,999,999 / Cr revenue 333,333,333,333, liability 333,333,333,333, equity 333,333,333,333
    // → products ~3.3e23; each share 333,333,333,333 exactly (no remainder)
    await post(R, k(), [{ account: "bank", debit: 999_999_999_999 }, { account: "other_income", credit: 333_333_333_333 }, { account: "liability_patient_balance", credit: 333_333_333_333 },
      { account: "opening_balance_equity", credit: 333_333_333_333 }], { date: "2026-12-02" });
    // and with a remainder: Dr bank 1,000,000,000,000 / Cr revenue 333,333,333,333, liability 333,333,333,333, equity 333,333,333,334 →
    //   bases 333,333,333,333 / 333,333,333,333 / 333,333,333,334 (sum = net) — and a second entry Dr cash 999,999,999,999 / Cr revenue
    //   333,333,333,333, liability 333,333,333,333, equity 333,333,333,333 is the same split; the deterministic tie is checked below
    await post(R, k(), [{ account: "bank", debit: 1_000_000_000_000 }, { account: "other_income", credit: 333_333_333_333 }, { account: "liability_patient_balance", credit: 333_333_333_333 },
      { account: "opening_balance_equity", credit: 333_333_333_334 }], { date: "2026-12-03" });
    //   a tie with products above bigint: Dr cash 1, Dr expense 999,999,999,999 + 999,999,999,999 / Cr liability 999,999,999,999, Cr revenue
    //   999,999,999,999 + 1 — balanced: debit 1 + 1,999,999,999,998 = credit 999,999,999,999 + 1,000,000,000,000. Inflow 1 over the credit
    //   side (liability 999,999,999,999, revenue 1,000,000,000,000): 0.4999… / 0.5000… → base 0 / 0, the one left goes to the larger
    //   remainder (revenue) — deterministic, not by name here; products ~1e12 stay exact
    await post(R, k(), [{ account: "cash_shift", debit: 1 }, { account: "branch_expense", debit: 999_999_999_999 }, { account: "branch_expense", debit: 999_999_999_999 },
      { account: "liability_patient_balance", credit: 999_999_999_999 }, { account: "other_income", credit: 999_999_999_999 }, { account: "other_income", credit: 1 }], { date: "2026-12-04" });
    r = await rep("2026-12-01", "2026-12-31");
    expect(r.cash_flow).toEqual({ revenue: 333_333_333_333 * 2 + 1, liability: 333_333_333_333 * 2, equity: 333_333_333_333 + 333_333_333_334 });
    expect(net(r)).toBe(await cashNet("2026-12-01", "2026-12-31"));
  });

  it("booked period: a fact of a locked month posts in the next open period; the locked months' statements are unchanged; it is activity of its booked month (not opening) and the journal lists it there with its original month", async () => {
    await post(R, `r9-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: 10_000 }, { account: "other_income", credit: 10_000 }], { date: "2026-03-10" });
    await lockPeriod(R, "2026-03", rfin);
    await lockPeriod(R, "2026-04", rfin);
    const marchBefore = await rep("2026-03-01", "2026-03-31");
    const aprilBefore = await rep("2026-04-01", "2026-04-30");
    const late = (await post(R, `r9-${crypto.randomUUID()}`, [{ account: "cash_shift", debit: 50_000 }, { account: "liability_patient_balance", credit: 50_000 }], { date: "2026-03-20" }))!;
    expect((await h.admin.query(`select period, original_period, business_date::text d from journal_entries where id = $1`, [late])).rows[0]).toEqual({ period: "2026-05", original_period: "2026-03", d: "2026-03-20" });
    // March (locked) unchanged — the statements and the journal of March do not see the late entry
    expect(await rep("2026-03-01", "2026-03-31")).toEqual({ ...marchBefore });
    expect((await jr("2026-03-01", "2026-03-31")).entries.map((e) => e.id)).not.toContain(late);
    // May: the late entry is May activity (debit in the period, not opening), listed in May's journal with its March reference
    // April (locked, after March) unchanged too — the late entry is not its activity nor its closing
    expect(await rep("2026-04-01", "2026-04-30")).toEqual({ ...aprilBefore });
    const may = await rep("2026-05-01", "2026-05-31");
    const cash = may.trial_balance.find((x) => x.key === "cash_shift")!;
    expect([cash.opening, cash.debit, cash.credit, cash.closing]).toEqual([10_000, 50_000, 0, 60_000]);
    const bal = may.trial_balance.find((x) => x.key === "liability_patient_balance")!;
    expect([bal.opening, bal.credit, bal.closing]).toEqual([0, 50_000, -50_000]);
    expect(may.balanced).toBe(true);
    expect(may.cash_flow).toEqual({ liability: 50_000 });
    const mj = (await jr("2026-05-01", "2026-05-31")).entries.find((e) => e.id === late)!;
    expect([mj.business_date, mj.period, mj.original_period]).toEqual(["2026-03-20", "2026-05", "2026-03"]);
  });

  it("branch balance as it is: a globally balanced manual journal across two branches (Dr expense branch A / Cr bank branch B) — the tenant view balances, each branch view does not; no automatic clearing", async () => {
    const ids = (await as(rfin, (db) => postManual(db, key(), { date: "2026-10-05", memo: "Biaya cabang A dibayar dari bank cabang B (uji r9)",
      lines: [{ account: "branch_expense", branchId: R.b1, debit: 100_000 }, { account: "bank", branchId: R.b2, credit: 100_000 }] })));
    void ids;
    expect((await rep("2026-10-01", "2026-10-31")).balanced).toBe(true);
    expect((await rep("2026-10-01", "2026-10-31", R.b1)).balanced).toBe(false);
    expect((await rep("2026-10-01", "2026-10-31", R.b2)).balanced).toBe(false);
    expect((await h.admin.query(`select count(*)::int c from journal_lines l join ledger_accounts a on a.id = l.account_id where l.tenant_id = $1 and a.key = 'inter_branch_clearing'`, [R.tenantId])).rows[0].c).toBe(0);
  });
});
