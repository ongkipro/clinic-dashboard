// T-119 M8 exit (PLAN §1 M8: "Ledger reconciles to sub-ledgers on the §3 fixtures; KPI values equal fixture expectations for K1–K19 and
// PR-95 metrics"; TASKS T-119: "Phase 1 demo walkthrough J1–J8, J10"). One tenant with two branches on a real database, through the real
// writers and the real ledger posting consumer (the outbox worker, as production): a money month of the §3 fixture scenarios on main
// (T-104 sub-ledgers, T-105 ledger), then the reconciliation every M8 exit check rests on — for each sub-ledger with a ledger account, the
// sub-ledger movement total of the period equals the ledger account's movement of the period, per tenant and per branch; inter-branch
// clearing nets to zero; every entry balances; the trial balance sums to zero; journal export stays fail-closed (G-ACT).
// Final run on base aa8603bb (f2): every M8 hook (T-106..T-118), every settled KPI and the final journey parts are assertions on this month;
// the G-Q4 unlinked case and the draft KPIs are owner-amended exceptions (scenarios.json `owner_amended`); the only `it.todo` is the T-102
// TD-31 owner gate (scenarios.json `deferred_items`). Documented stand-ins only, of
// earlier milestones (the open visits a new treatment visit closes, the examination flow, credentials): the M2/M4 seeding patterns of
// tests/accounting/ledger.test.ts; never a guard paused around an M8 writer. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { exportJournal, handoverExceptions, report } from "../../../src/modules/accounting/ledger/ledger";
import { ledgerPostingConsumer } from "../../../src/modules/accounting/ledger/posting";
import { type Ledger, rollforward } from "../../../src/modules/accounting/subledgers/subledgers";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { collectReceivable, convertToReceivable } from "../../../src/modules/cashier/receivables/receivables";
import { publish } from "../../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../../src/modules/clinical/records/records";
import { stepUpForTests } from "../../../tests/support/step-up";
import { createRequest, decideRequest } from "../../../src/modules/clinical/requests/requests";
import { releaseAddition } from "../../../src/modules/cashier/additions/additions";
import { recordExpense, saveExpenseCategory } from "../../../src/modules/expenses/expenses";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { reserveSession, setPackageContents, topUpBalance } from "../../../src/modules/packages/packages";
import { confirmSelection } from "../../../src/modules/pharmacy/pharmacy";
import { finishTreatment, startTreatment } from "../../../src/modules/treatment/treatment";
import { runOutboxBatch } from "../../../src/workers/outbox";
import { readRecon, toReconInput } from "../../../src/modules/accounting/recon/report";
import { detailIn } from "../../../src/app/(app)/ringkasan/owner/load";
import { renderToStaticMarkup } from "react-dom/server";
import { readBranchSummary } from "../../../src/app/(app)/ringkasan/cabang/reader";
import { resolveView } from "../../../src/app/(app)/ringkasan/cabang/model";
import { BranchSummaryView } from "../../../src/app/(app)/ringkasan/cabang/view";
import { saveItem, setLevel, receiveStock } from "../../../src/modules/inventory/stock";
import { exportCoretax } from "../../../src/modules/accounting/coretax/coretax";
import { decideEvidence, uploadEvidence } from "../../../src/modules/compliance/compliance";
import { setTaxProfile } from "../../../src/modules/tax/tax";
import { slots } from "../../../src/modules/scheduling/booking/booking";
import { addToWaitlist, waitlistList } from "../../../src/modules/scheduling/waitlist/waitlist";
import { cancelAppointment } from "../../../src/modules/scheduling/appointments/appointments";
import { receiveDeposit } from "../../../src/modules/cashier/deposits/deposits";
import { kasirInvoice } from "../../../src/modules/cashier/kasir/kasir";
import { changeSetting } from "../../../src/modules/settings/settings";
import { setServices, upsertRoom } from "../../../src/modules/org/branches/branches";
import { createDepot, transferBetweenDepots } from "../../../src/modules/inventory/depots/depots";
import { decideReturn, getRequest, issueMaterials, proposeReturn, requestMaterials } from "../../../src/modules/inventory/materials/materials";
import { CHECKS, handOver, prepareDispensing } from "../../../src/modules/pharmacy/pharmacy";
import { closeVisit } from "../../../src/modules/visits/visits";
import { runPackageExpiryScan } from "../../../src/modules/packages/expiry";
import { runFollowupScan } from "../../../src/modules/crm/followups/scan";
import { chargeConsultationFee } from "../../../src/modules/cashier/consultation/consultation";
import { createLead, setLeadStage } from "../../../src/modules/crm/leads/leads";
import { recordSurvey } from "../../../src/modules/crm/surveys/surveys";
import { createPromoCode } from "../../../src/modules/promo/promo";
import { receiveCosted } from "../../../src/modules/inventory/costing/costing";
import { read } from "../../../src/modules/reporting/reports/readers";
import { digestKey } from "../../../src/modules/reporting/digest/digest";
import { readFinanceSummary } from "../../../src/app/(app)/keuangan/ringkasan/reader";
import { rollCheck } from "../../../src/app/(app)/keuangan/ringkasan/model";
import { readAdminHome } from "../../../src/app/(app)/ringkasan/admin-pusat/load";
import { readCsSummary } from "../../../src/app/(app)/ringkasan/cs/reader";
import { inbox } from "../../../src/app/(app)/ringkasan/cs/model";
import { summaryIn as shiftSummaryIn } from "../../../src/app/(app)/hari-ini/ringkasan/load";
import { summaryIn as pasienkuIn } from "../../../src/app/(app)/pasienku/load";
import { kpi } from "../../../src/modules/reporting/dashboards/dashboards";
import { loadReport } from "../../../src/modules/reporting/reports/live";
import { definitionHref, REPORTS } from "../../../src/modules/reporting/reports/dictionary";
import { runDigest } from "../../../src/modules/reporting/digest/run";
import { mockDigestDeliveryPort, mockDigestStore } from "../../../src/modules/reporting/digest/delivery";
import { lockPeriod } from "../../../src/modules/accounting/ledger/ledger";
import { exportRows, toCsv } from "../../../src/modules/accounting/subledgers/subledgers";
import { setStaffTarget } from "../../../src/modules/commission/targets/targets";
import { setHours } from "../../../src/modules/org/branches/branches";
import { bootstrapVendor } from "../../../src/modules/vendor/staff/staff";
import { VENDOR_GROUP_ROLE } from "../../../src/db/rls/context";
import { createHarness, type Harness, testPool } from "../../../tests/rls/harness";
import { dbWibDay, type WibAnchor, wibAnchor } from "./wib-anchor";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)
const STEP: StepUp = stepUpForTests(); // the auth factory mints the real proof (HYG-026), as the M2 / M3 flows
const key = () => crypto.randomUUID();
// The fixture month: ONE PostgreSQL reading of the WIB day (wib-anchor.ts), taken in beforeAll; afterAll fails the run if the database's
// WIB day has moved on (the writers stamp the database clock, so a rollover would split the month's facts).
let anchor: WibAnchor;
// fixture ids the final-run KPI / reconciliation derivations name (FINAL-DERIVATION.md)
const F: Record<string, string> = {};
let PHJ: P; let APTJ = ""; let KRIM = ""; let KRIMV = "";
const today = () => anchor.day;
const monthStart = () => anchor.monthStart;
const plusDay = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const lastDay = (d: string) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type P = { acc: string; staffId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "central_cs", "marketing"];
let tenantId: string; let b1: string; let b2: string;
let OWN: P; let FIN: P; let AU: P; let FO: P; let FO2: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let BC2: P; let AP: P; let CS: P;
let facial: string; let facialV: string; let filler: string; let fillerV: string;

async function person(role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`m8.${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf M8 ${n}` });
  const rid = await assignRole(h.admin, { tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [b1]) await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const drain = async () => {
  for (let i = 0; i < 20; i++) {
    const [r] = await runOutboxBatch(worker, [ledgerPostingConsumer], { worker: "t119", limit: 200, leaseSeconds: 5 });
    if (r.done + r.skipped + r.failed === 0) return;
  }
};
async function credential(p: P, branch: string) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [tenantId, p.staffId, kind, `M8-${++n}`, b, b ? "2099-12-31" : null, OWN.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, FH.staffId]);
  }
}
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function patient(branch: string, name: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
// A treatment visit with a signed examination, a plan item per version and the patient's consent (the M2 writers; stand-in: earlier open
// visits of the patient at that branch are closed first, as tests/accounting/ledger.test.ts).
// checkedInMinutesAgo: the K27 controlled check-in instant (distinct per signed-exam visit, FINAL-DERIVATION.md §K27); the stand-in insert
// sets it once at insert (visits_guard keeps check-in immutable afterwards); the signature is the real record_sign clock.
async function visitWith(pid: string, branch: string, versions: string[], fo: P, checkedInMinutesAgo = 0) {
  const d = branch === DOC.branch ? DOC : { ...DOC, branch };
  await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by, payment = case when payment in ('in_progress','blocked') then 'done' else payment end,
                         dispensing = case when dispensing in ('in_progress','blocked') then 'done' else dispensing end,
                         treatment = case when treatment in ('in_progress','blocked') then 'done' else treatment end
                       where tenant_id = $1 and branch_id = $2 and patient_id = $3 and closed_at is null`, [tenantId, branch, pid]);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at)
    values ($1, $2, $3, 'walk_in', $4, clock_timestamp() - make_interval(mins => $5)) returning id`, [tenantId, branch, pid, fo.staffId, checkedInMinutesAgo])).rows[0].id as string;
  const { examId } = await as(d, (db) => openExam(db, key(), v));
  const { planId } = await as(d, (db) => createPlan(db, key(), examId, "Program M8", "Kondisi sintetis"));
  const items: string[] = [];
  for (const ver of versions) items.push((await as(d, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: ver, qty: 1 }))).itemId);
  await as(d, (db) => signRecord(db, key(), examId, STEP));
  const ct = await as(d, (db) => consentText(db, v, planId));
  await as(d, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
  return { v, items, planId, d };
}

// ── reconciliation: sub-ledger ↔ ledger account (the PLAN M8 exit check) ──
// Sub-ledgers with ledger accounts (11 §Roll-forwards; 0123 chart). The ledger places an entry by business_date (as the sub-ledgers place a
// movement by its day); the M8 fixture month has no locked period, so booked date = business date (a late fact is T-108's timing case). cash_bank = Kas (shift) + Kas kecil + Bank; signs: assets
// debit − credit, liabilities credit − debit (the sub-ledgers carry the liability as a positive balance).
const PAIRS: { sub: Ledger; accounts: string[]; side: "debit" | "credit" }[] = [
  { sub: "cash_bank", accounts: ["cash_shift", "petty_cash", "bank"], side: "debit" },
  { sub: "gateway_clearing", accounts: ["gateway_clearing"], side: "debit" },
  { sub: "receivables", accounts: ["patient_receivable"], side: "debit" },
  { sub: "paid_not_delivered", accounts: ["liability_paid_not_delivered"], side: "credit" },
  { sub: "package_liability", accounts: ["liability_packages"], side: "credit" },
  { sub: "patient_balance", accounts: ["liability_patient_balance"], side: "credit" },
  { sub: "booking_dp", accounts: ["liability_booking_dp"], side: "credit" }, // no deposit on this month: 0 = 0 here (final_required in scenarios.json)
];
// The month's exact sub-ledger movements per (ledger, term, branch) at the M8 exit check after the final journeys (FINAL-DERIVATION.md §Movements)
const MOVEMENTS: string[] = [
  "booking_dp/moved@b1=-200000", "booking_dp/received@b1=200000",                       // J4 DP 200,000 received, then moved to balance
  "cash_bank/expense@b1=-125000",                                                       // J8 bank-funded expense
  "cash_bank/receipt@b1=7500000",   // cash/transfer: S3b 1,500,000 + collected 400,000 + J7 package 3,000,000 + top-up 500,000 + DP 200,000
                                    //   + DP patient 300,000 + 1,000,000 + package DP 600,000
  "gateway_clearing/receipt@b1=3150000",                                                // EDC: S2 1,500,000 + J5/J6 visit 1,650,000
  "inter_branch/redemption@b1=600000", "inter_branch/redemption@b2=-600000",            // the b2 package session
  "package_liability/close@b1=-1800000",                                                // J7 expiry: paid 3,000,000 − 2 × 600,000
  "package_liability/redemption@b1=-1200000",                                           // two J7 sessions of 600,000
  "package_liability/settlement@b1=3600000",                                            // J7 3,000,000 + DP patient's package DP 600,000
  "paid_not_delivered/performance@b1=-3550000",   // S2 1,500,000 + filler 400,000 + J5 facial 1,500,000 + J6 product 150,000 (the DP facial is paid, not performed)
  "paid_not_delivered/receivable_convert@b1=400000",                                    // the S3b filler
  "paid_not_delivered/settlement@b1=6150000",     // S2 1,500,000 + S3b facial 1,500,000 + DP facial 1,500,000 (balance 200,000 + cash 1,300,000) + J5/J6 1,650,000
  "patient_balance/dp_transfer@b1=200000", "patient_balance/from_expiry@b1=1800000", "patient_balance/top_up@b1=500000",
  "patient_balance/use@b1=-200000",                                                     // the DP balance used at the cashier
  "receivables/collected@b1=-400000", "receivables/created@b1=400000",                  // S3b
];
async function ledgerMovement(accounts: string[], side: "debit" | "credit", from: string, to: string, branch?: string): Promise<number> {
  const r = await h.admin.query(
    `select coalesce(sum(case when $5 = 'debit' then l.debit - l.credit else l.credit - l.debit end), 0)::bigint s
       from journal_lines l join journal_entries e on e.id = l.entry_id join ledger_accounts a on a.id = l.account_id
      where a.tenant_id = $1 and a.key = any($2) and e.business_date between $3::date and $4::date and ($6::uuid is null or l.branch_id = $6)`,
    [tenantId, accounts, from, to, side, branch ?? null]);
  return safe(r.rows[0].s);
}
// Gross debit and credit separately (a net of 0 never hides a missing posting pair).
async function ledgerSides(accounts: string[], from: string, to: string, branch?: string): Promise<{ dr: number; cr: number }> {
  const r = await h.admin.query(
    `select coalesce(sum(l.debit), 0)::bigint dr, coalesce(sum(l.credit), 0)::bigint cr
       from journal_lines l join journal_entries e on e.id = l.entry_id join ledger_accounts a on a.id = l.account_id
      where a.tenant_id = $1 and a.key = any($2) and e.business_date between $3::date and $4::date and ($5::uuid is null or l.branch_id = $5)`,
    [tenantId, accounts, from, to, branch ?? null]);
  return { dr: safe(r.rows[0].dr), cr: safe(r.rows[0].cr) };
}
// bigint text → number, refused beyond the exact JS integer range (no silent rounding)
function safe(s: string): number {
  const n = Number(s);
  if (!Number.isSafeInteger(n) || String(n) !== String(BigInt(s))) throw new Error(`amount outside the exact integer range: ${s}`);
  return n;
}

// The M8 exit check as a function (run at J8 and again after the final-run journeys): per sub-ledger with ledger accounts, net and gross
// (increasing / decreasing terms vs the ledger's two sides) tenant-wide, closing per branch, and GROSS PER BRANCH (the sub-ledger's
// increasing / decreasing movements at each branch vs the ledger's two sides at that branch, every exercised term included).
async function reconcile() {
  const r = await as(FIN, (db) => rollforward(db, { from: monthStart(), to: today() }));
  const mism: string[] = [];
  for (const p of PAIRS) {
    const sub = r.ledgers[p.sub];
    expect(sub.opening_complete && sub.closing_complete, `${p.sub} complete`).toBe(true);
    const gl = await ledgerMovement(p.accounts, p.side, monthStart(), today());
    if (sub.closing - sub.opening !== gl) mism.push(`${p.sub}: sub-ledger ${sub.closing - sub.opening} ≠ ledger ${gl}`);
    const terms = Object.values(sub.terms);
    const [up, down] = [terms.filter((t) => t > 0).reduce((s, t) => s + t, 0), -terms.filter((t) => t < 0).reduce((s, t) => s + t, 0)];
    const g = await ledgerSides(p.accounts, monthStart(), today());
    const [gUp, gDown] = p.side === "debit" ? [g.dr, g.cr] : [g.cr, g.dr];
    if (up !== gUp || down !== gDown) mism.push(`${p.sub}: sub-ledger +${up}/−${down} ≠ ledger +${gUp}/−${gDown}`);
    for (const b of [b1, b2]) {
      const subB = sub.by_branch[b] ?? 0;
      const glB = await ledgerMovement(p.accounts, p.side, "2000-01-01", today(), b);
      if (subB !== glB) mism.push(`${p.sub} @${b === b1 ? "b1" : "b2"}: sub-ledger closing ${subB} ≠ ledger balance ${glB}`);
      // gross per branch: every term of this ledger at this branch, by sign, vs the ledger's sides at this branch
      const t = (await h.admin.query(
        `select coalesce(sum(m.amount) filter (where m.amount > 0), 0)::text up, coalesce(-sum(m.amount) filter (where m.amount < 0), 0)::text down
           from subledger_movements($1) m where m.ledger = $2 and m.branch_id = $3 and m.day between $4::date and $5::date`, [tenantId, p.sub, b, monthStart(), today()])).rows[0];
      const gb = await ledgerSides(p.accounts, monthStart(), today(), b);
      const [bUp, bDown] = p.side === "debit" ? [gb.dr, gb.cr] : [gb.cr, gb.dr];
      if (safe(t.up) !== bUp || safe(t.down) !== bDown) mism.push(`${p.sub} @${b === b1 ? "b1" : "b2"} gross: sub-ledger +${t.up}/−${t.down} ≠ ledger +${bUp}/−${bDown}`);
    }
  }
  return { r, mism };
}

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 8)]]) });
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  worker = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 3 });
  anchor = wibAnchor(await dbWibDay(h.admin));
  tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik M8 Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  b1 = await br("M8-KMG"); b2 = await br("M8-BSD");
  OWN = await person("owner"); FIN = await person("finance"); AU = await person("auditor");
  FO = await person("fo_cashier", b1); FO2 = await person("fo_cashier", b2); FH = await person("facility_head", b1);
  DOC = await person("doctor", b1, b2); NUR = await person("nurse", b1); BC = await person("bc", b1); BC2 = await person("bc", b1);
  AP = await person("admin_pusat"); CS = await person("central_cs");
  await credential(DOC, b1);
  await credential(DOC, b2);
  const svc = async (c: string, name: string, price: number) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v;
  };
  ({ itemId: facial, versionId: facialV } = await svc("M8-FAC", "Facial M8", 1_500_000));
  ({ itemId: filler, versionId: fillerV } = await svc("M8-FIL", "Filler M8", 400_000));
}, 300_000);
afterAll(async () => {
  const end = anchor && h ? await dbWibDay(h.admin) : null;
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
  if (end !== null) anchor.assertSameDay(end); // after cleanup: the throwaway database is gone either way
});

describe("M8 exit: one month on the §3 fixtures, ledger ↔ sub-ledgers", () => {
  it("J4–J6 (S2): selected, paid by EDC before the treatment, treated — clearing and paid-not-delivered in both books", async () => {
    const pid = await patient(b1, "Pasien M8 Skenario 2");
    const { v, items, d } = await visitWith(pid, b1, [facialV], FO, 90);
    F.pS2 = pid; F.vS2 = v;
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 1_500_000, details: { card_type: "debit", bank: "BCA", trace: "811001", approval_code: "M8S2A1" } }]));
    await drain();
    // checkpoint after payment, before performance: the consideration is HELD in paid-not-delivered (credit), nothing released yet
    expect(await ledgerSides(["liability_paid_not_delivered"], monthStart(), today())).toEqual({ dr: 0, cr: 1_500_000 });
    expect(await ledgerMovement(["revenue_treatment"], "credit", monthStart(), today())).toBe(0);
    const e = await as(d, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(d, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    await drain();
    expect(await ledgerMovement(["gateway_clearing"], "debit", monthStart(), today())).toBe(1_500_000);
    expect(await ledgerMovement(["revenue_treatment"], "credit", monthStart(), today())).toBe(1_500_000);
    // ... and released at performance: debited 1,500,000 against the treatment revenue (net 0 alone would not prove either step)
    expect(await ledgerSides(["liability_paid_not_delivered"], monthStart(), today())).toEqual({ dr: 1_500_000, cr: 1_500_000 });
  });

  it("J5 addition + J6 receivable fallback (S3b, S14 pattern): performed before billed, converted, collected in cash", async () => {
    const pid = await patient(b1, "Pasien M8 Skenario 3b");
    const { v, items, planId, d } = await visitWith(pid, b1, [facialV], FO, 70);
    F.pS3b = pid; F.vS3b = v;
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_500_000, cashTendered: 1_500_000 }]));
    const { requestId } = await as(NUR, (db) => createRequest(db, key(), v, { kind: "addition", planId, catalogVersionId: fillerV, stage: 1, qty: 1, reason: "Lipatan dalam" }));
    const itemId = ((await as(d, (db) => decideRequest(db, key(), requestId, true, null))) as { item_id: string }).item_id;
    const ct = await as(d, (db) => consentText(db, v, planId));
    await as(d, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    await as(FO, (db) => releaseAddition(db, key(), itemId, FO.staffId));
    const ex = await as(d, (db) => startTreatment(db, key(), v, { planItemId: itemId, performerId: DOC.staffId, identityConfirmed: true }));
    await as(d, (db) => finishTreatment(db, key(), ex.executionId, { outcome: "completed" }));
    const { invoiceId: add } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), add, [{ itemId: filler, quantity: 1, planItemId: itemId }]));
    const rc = await as(FO, (db) => convertToReceivable(db, key(), v));
    await as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "cash", amount: 400_000, cashTendered: 400_000 }));
    await drain();
    // converted (Dr 400,000) and collected (Cr 400,000): each posting proven, not only the zero net
    expect(await ledgerSides(["patient_receivable"], monthStart(), today())).toEqual({ dr: 400_000, cr: 400_000 });
  });

  it("J7 (S5a / S11): a package paid in cash at branch 1, sessions counted at branch 1 and branch 2 — inter-branch clearing nets to zero", async () => {
    const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "M8-PKG" }, { name: "Paket M8", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 3_000_000, installments_allowed: true } as never, "Paket baru"));
    await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: facial, count: 5 }]));
    const pid = await patient(b1, "Pasien M8 Skenario 11");
    F.pS11 = pid;
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pv.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 3_000_000, cashTendered: 3_000_000 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    for (const [branch, fo] of [[b1, FO], [b2, FO2]] as const) {
      const { v, items, d } = await visitWith(pid, branch, [facialV], fo, branch === b1 ? 50 : 30);
      F[branch === b1 ? "vS11b1" : "vS11b2"] = v;
      await as(fo, (db) => reserveSession(db, key(), pkg, v));
      const e = await as(d, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
      await as(d, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    }
    await drain();
    expect(await ledgerMovement(["inter_branch_clearing"], "debit", monthStart(), today())).toBe(0);
    expect(await ledgerMovement(["inter_branch_clearing"], "debit", monthStart(), today(), b2)).toBe(600_000);
  });

  it("J7 balance + J8 expense (S13 top-up pattern; PR-79): a top-up by transfer and a bank-funded expense in both books", async () => {
    const pid = await patient(b1, "Pasien M8 Isi Saldo");
    F.pTU = pid;
    await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "transfer", amount: 500_000, details: { bank: "BCA", reference: "TRF-M8-TU" } }));
    const cat = (await as(FIN, (db) => saveExpenseCategory(db, key(), null, { name: "Transport M8" }))).categoryId;
    const { expenseId } = await as(FIN, (db) => recordExpense(db, key(), b1, { categoryId: cat, businessDate: today(), amount: 125_000, funding: "bank", description: "Bensin kurir M8" }));
    await drain();
    expect(await ledgerMovement(["liability_patient_balance"], "credit", monthStart(), today())).toBe(500_000);
    // the expense posted: Dr branch expense, Cr bank (its own funding tender, not another cash account), at b1
    expect(await ledgerSides(["branch_expense"], monthStart(), today(), b1)).toEqual({ dr: 125_000, cr: 0 });
    expect(await ledgerSides(["bank"], monthStart(), today(), b1)).toEqual({ dr: 500_000, cr: 125_000 }); // the transfer top-up in, the expense out
    expect(await ledgerSides(["petty_cash"], monthStart(), today())).toEqual({ dr: 0, cr: 0 });
    // the expense's OWN entry (source = the returned expense id): one entry, on the anchored business date, exactly Dr branch expense /
    // Cr bank 125,000 at b1 (0123 ledger_rule_expense: both lines on the source expense's business date)
    const own = (await h.admin.query(
      `select e.business_date::text d, a.key k, l.branch_id b, l.debit::text dr, l.credit::text cr
         from journal_entries e join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id join ledger_accounts a on a.id = l.account_id
        where e.tenant_id = $1 and e.source_kind = 'expense' and e.source_id = $2 order by a.key`, [tenantId, expenseId])).rows;
    expect(own).toEqual([
      { d: today(), k: "bank", b: b1, dr: "0", cr: "125000" },
      { d: today(), k: "branch_expense", b: b1, dr: "125000", cr: "0" },
    ]);
  });

  it("J8 month end — the M8 exit check: every sub-ledger's period movement equals its ledger accounts' movement, tenant-wide and per branch", async () => {
    await drain();
    const { r, mism } = await reconcile();
    expect(mism).toEqual([]);
    // named terms and per-branch movement of the exercised paths (the totals above cannot see a term relabelled or a branch swapped)
    const mv = (await h.admin.query(
      `select m.ledger, m.term, m.branch_id b, sum(m.amount)::text amount from subledger_movements($1) m
        where m.day between $2::date and $3::date group by 1, 2, 3 order by 1, 2, 3`, [tenantId, monthStart(), today()])).rows
      .map((x: { ledger: string; term: string; b: string | null; amount: string }) => `${x.ledger}/${x.term}@${x.b === b1 ? "b1" : x.b === b2 ? "b2" : x.b}=${x.amount}`);
    expect(mv).toEqual(expect.arrayContaining([
      "receivables/created@b1=400000", "receivables/collected@b1=-400000",                    // S3b at b1, both arms, never at b2
      "paid_not_delivered/settlement@b1=3000000",                                             // S2 1,500,000 + S3b facial 1,500,000 paid
      "paid_not_delivered/receivable_convert@b1=400000",                                      // the S3b filler converted
      "package_liability/settlement@b1=3000000", "package_liability/redemption@b1=-1200000",  // sold at b1; both sessions take value at the selling branch
      "inter_branch/redemption@b1=600000", "inter_branch/redemption@b2=-600000",              // the b2 session moves its value b1 → b2 (sub-ledger sign)
      "cash_bank/expense@b1=-125000",
    ]));
    expect(mv.filter((x) => x.startsWith("receivables/") || x.startsWith("inter_branch/"))).toHaveLength(4); // nothing else on these two ledgers
    // the fixture actually moved money (a vacuous 0 = 0 never passes)
    // cash 1,500,000 (S3b) + 400,000 (collected) + 3,000,000 (package) + transfer 500,000 (top-up) − 125,000 (expense); EDC is clearing
    expect(r.ledgers.cash_bank.closing - r.ledgers.cash_bank.opening).toBe(5_275_000);
    expect(r.ledgers.package_liability.closing - r.ledgers.package_liability.opening).toBe(1_800_000);
    // inter-branch clearing nets to zero across branches (11 §Roll-forwards)
    expect(r.ledgers.inter_branch.closing).toBe(0);
    // T-104 comparators: each one RAN and reported nothing (a skipped or absent comparator never reads as 0)
    const ck = r.checks as unknown as Record<string, Record<string, unknown>>;
    expect(ck.package_liability).toMatchObject({ level: "object", ran: true, mismatches: 0 });
    expect(ck.package_liability.checked).toBeGreaterThan(0);
    for (const l of ["patient_balance", "booking_dp"]) expect(ck[l], l).toMatchObject({ level: "stored_stock", mismatches: 0 });
    expect(ck.receivables).toMatchObject({ level: "object", mismatches: 0, stored_mismatches: 0 });
    expect(ck.receipts).toMatchObject({ level: "identity", mismatches: 0, ledger_mismatch: false });
    expect(ck.paid_not_delivered).toEqual({ level: "identity" }); // identity only: proven by the gross comparison above and the S2 sides
  });

  it("J8 statements and the books' gates: every entry balances, trial balance sums to zero, preview status, journal export refused (G-ACT)", async () => {
    // left join: an entry header with no lines is counted (0 lines < 2), not dropped by the join
    const unbalanced = (await h.admin.query(`select e.id from journal_entries e left join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
       where e.tenant_id = $1 group by e.id having coalesce(sum(l.debit), 0) <> coalesce(sum(l.credit), 0) or count(l.entry_id) < 2`, [tenantId])).rows;
    expect(unbalanced).toEqual([]);
    const rep = await as(FIN, (db) => report(db, { from: monthStart(), to: today() }));
    expect(rep.trial_balance.reduce((s, x) => s + x.closing, 0)).toBe(0);
    expect(rep.balanced).toBe(true);
    expect(rep.status.state).toBe("preview");
    expect(await as(FIN, (db) => exportJournal(db, { from: monthStart(), to: today() }))).toEqual({ ok: false, refused: "posting_map_unsigned" });
    const hx = await as(AU, (db) => handoverExceptions(db, { from: monthStart(), to: today() }));
    expect(hx.unlinked + hx.fractional).toBe(0);
    // the auditor reads, a cashier does not
    expect(await as(FO, (db) => report(db, { from: monthStart(), to: today() })).then(() => "ok", (e) => (e instanceof CommandError ? e.code : String(e)))).toMatch(/^ERR_FORBIDDEN/);
  });
});

// ── integrated tasks on this fixture month (base 353387aa): each hook is now a real assertion on the SAME month the exit check reconciled ──
describe("M8 exit hooks on the fixture month — integrated tasks", () => {
  it("T-108 PR-34: recon_report on this month lists no difference, nothing pending and nothing unavailable — every fact is posted (bersih)", async () => {
    await drain();
    const r = await as(FIN, (db) => readRecon(db, { from: monthStart(), to: today() }));
    expect(r.items).toEqual([]); // no item of any kind: this month has no locked period, so even a timing item is a defect here
    expect(r.unavailable).toEqual([]);
    expect(r.clearing.every((c) => c.net === 0)).toBe(true); // the J7 cross-branch session nets to zero tenant-wide
    // ... and the J7 legs are present (an empty clearing list never passes): the b2 session's 600,000 debit, mirrored at b1
    // every fixture action happens today (the WIB anchor day): the legs and totals are checked on that day, not summed over the month
    const day = today();
    expect(r.clearing.map((c) => c.day)).toEqual([day]);
    const leg = (b: string) => r.clearing.filter((c) => c.day === day).flatMap((c) => c.byBranch).filter((l) => l.branchId === b).reduce((s, l) => s + l.amount, 0);
    expect([leg(b2), leg(b1)]).toEqual([600_000, -600_000]);
    expect(r.verdict).toBe("bersih");
    // the month moved money at both branches (a vacuous empty report never passes); rows are one per day × branch (recon.ts)
    expect([...new Set(r.rows.map((x) => x.branchId))].sort()).toEqual([b1, b2].sort());
    for (const b of [b1, b2]) expect(r.rows.filter((x) => x.branchId === b).flatMap((x) => x.cells).some((c) => (c.fact ?? 0) > 0)).toBe(true);
    // exact month totals per branch on both sides (a payment missing from facts AND postings changes the total and fails):
    // K1 at b1 = EDC 1,500,000 (S2) + cash 1,500,000 (S3b) + collected 400,000 + package 3,000,000 + top-up transfer 500,000; b2 received nothing.
    // K2 at b1 = S2 facial 1,500,000 + S3b filler 400,000 (the S3b facial is paid, never performed: paid-not-delivered) + the b1 package session
    // 600,000; at b2 = the b2 package session 600,000.
    const cell = (b: string, m: string, d: string) => r.rows.find((x) => x.branchId === b && x.day === d)!.cells.find((c) => c.metric === m)!;
    const tot = (b: string, m: string, side: "fact" | "ledger") =>
      r.rows.filter((x) => x.branchId === b).flatMap((x) => x.cells).filter((c) => c.metric === m).reduce((s, c) => s + (c[side] ?? 0), 0);
    for (const side of ["fact", "ledger"] as const) {
      // on the anchor day exactly, and nothing on any other day of the month (a fact AND its posting moved to another day fail here)
      expect([cell(b1, "k1", day)[side], cell(b2, "k1", day)[side]], `K1 ${side} today`).toEqual([6_900_000, 0]);
      expect([cell(b1, "k2", day)[side], cell(b2, "k2", day)[side]], `K2 ${side} today`).toEqual([2_500_000, 600_000]);
      expect([tot(b1, "k1", side), tot(b2, "k1", side), tot(b1, "k2", side), tot(b2, "k2", side)], `K1/K2 ${side} month`).toEqual([6_900_000, 0, 2_500_000, 600_000]);
    }
    // receivables (S3b): the 400,000 receivable created (+) and collected (−) the same day — both arms present on BOTH sides of the
    // reader's input, not only a zero net cell (a reader dropping the receivables arms from facts and postings fails here)
    expect(cell(b1, "receivables", day)).toMatchObject({ fact: 0, ledger: 0, status: "cocok" });
    const input = toReconInput((await as(FIN, (db) => db.query(`select recon_report($1::date, $2::date, null) as r`, [monthStart(), today()]))).rows[0].r);
    const arms = (xs: { metric: string; day: string; branchId: string; amount: number }[]) =>
      xs.filter((x) => x.metric === "receivables" && x.day === day && x.branchId === b1).map((x) => x.amount).sort((m, n) => m - n);
    expect(arms(input.facts)).toEqual([-400_000, 400_000]);
    expect(arms(input.postings.map((x) => ({ ...x, day: x.businessDay })))).toEqual([-400_000, 400_000]);
  });
  it("T-109 PR-33a: Ringkasan Owner on this month — K3 at the selling branch (b1: the package, the S2 facial and the S3b treatment), K2 at the executing branch (b2: the one package session counted there)", async () => {
    await drain();
    const branches = [{ id: b1, name: "M8-KMG" }, { id: b2, name: "M8-BSD" }];
    const at = async (id: string) => {
      const d = await as(OWN, (db) => detailIn(db, "owner", branches, id, { periode: "bulan" }, anchor.noon));
      if (d.kind !== "ok") throw new Error(`owner detail ${d.kind}`);
      return d.data;
    };
    const [d1, d2] = [await at(b1), await at(b2)];
    // b2 sold nothing this month (the package was sold at b1): K3 at b2 is a real Rp0; its one counted session (600,000) is K2 at b2
    expect(d2.k3.amount).toEqual({ state: "value", rp: 0 });
    expect(d2.k2.amount).toEqual({ state: "value", rp: 600_000 });
    // b1 holds every sale of the month (S2 facial 1,500,000 + S3b facial 1,500,000 + filler 400,000 + package 3,000,000)
    expect(d1.k3.amount).toEqual({ state: "value", rp: 6_400_000 });
    // K2 at b1 = the S2 facial, the S3b filler (its facial is paid, not performed) and only the b1 package session (the b2 session is never
    // credited to b1)
    expect(d1.k2.amount).toEqual({ state: "value", rp: 2_500_000 });
  });
});

// ── final run on aa8603bb: the read-side hooks on the SAME fixture month (no new money fact before the Coretax case, which runs last) ──
describe("M8 exit hooks on the fixture month — final run (aa8603bb)", () => {
  it("T-114 PR-33f: Ringkasan Keuangan on this month — every roll-forward opening + movements = closing; the package and balance movements of the month", async () => {
    const d = await as(FIN, (db) => readFinanceSummary(db, { from: monthStart(), to: today() }));
    expect(d.rolls.map((r) => r.ledger)).toEqual(["paid_not_delivered", "package_liability", "patient_balance", "booking_dp", "receivables", "commission_payable"]);
    for (const r of d.rolls) expect(rollCheck(r), r.ledger).toEqual({ state: "balanced" });
    const mv = (l: string) => Object.fromEntries(d.rolls.find((r) => r.ledger === l)!.movements.filter((m) => m.rp !== 0).map((m) => [m.term, m.rp]));
    // package: sold 3,000,000 at b1, two sessions of 600,000 redeemed (5 x 600,000 = 3,000,000 package; S5a/S11)
    expect(mv("package_liability")).toEqual({ settlement: 3_000_000, redemption: -1_200_000 });
    // balance: the transfer top-up 500,000 (J7 balance), nothing used
    expect(mv("patient_balance")).toEqual({ top_up: 500_000 });
    // closing = opening (0, a new tenant) + movements: package 1,800,000; balance 500,000; paid-not-delivered = 3,000,000 settled + 400,000
    // converted − 1,500,000 (S2 performed) − 400,000 (filler performed) = 1,500,000 (the S3b facial paid, not performed)
    const close = (l: string) => d.rolls.find((r) => r.ledger === l)!.closing;
    expect([close("package_liability"), close("patient_balance"), close("paid_not_delivered"), close("receivables")])
      .toEqual([{ state: "value", rp: 1_800_000 }, { state: "value", rp: 500_000 }, { state: "value", rp: 1_500_000 }, { state: "value", rp: 0 }]);
  });

  it("T-115 PR-33g: Ringkasan Admin Pusat — a branch without opening hours is listed 'Jam buka belum diisi'; once its hours are set it is not", async () => {
    const d = await as(AP, (db) => readAdminHome(db, anchor.noon));
    const jam = (x: typeof d, b: string) => x.branches.find((r) => r.id === b)!.issues.map((i) => i.text).includes("Jam buka belum diisi");
    expect([jam(d, b1), jam(d, b2)]).toEqual([true, true]); // neither fixture branch has hours yet
    // Admin Pusat sets b2's hours (open around the clock; the T-113 lead below enters during them); b1 stays without hours
    await as(AP, (db) => setHours(db, b2, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "24:00" }))));
    const d2 = await as(AP, (db) => readAdminHome(db, anchor.noon));
    expect([jam(d2, b1), jam(d2, b2)]).toEqual([true, false]);
  });

  it("T-113 PR-33e: Ringkasan CS — a lead created while its branch is open and unanswered for 20 elapsed minutes counts overdue against the 15-minute target; a 10-minute one does not", async () => {
    // b2 is open around the clock (T-115), so this fixture cannot tell wall-clock time from time counted only in opening hours: it proves the
    // CURRENT T-113 semantics (open at entry, elapsed time since entry), not an opening-hours-only clock
    // leads need a creation time in the past: the T-113 test's stand-in (direct rows, guards off for the seed only); SET-20 is its default 15
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const tg = (await h.admin.query(`select tgname from pg_trigger where tgrelid = 'leads'::regclass and not tgisinternal and tgenabled <> 'D'`)).rows.map((r) => r.tgname as string);
    const ids: Record<string, string> = {};
    for (const g of tg) await h.admin.query(`alter table leads disable trigger ${g}`);
    try {
      for (const [k, min] of [["late", 20], ["fresh", 10]] as const) ids[k] = (await h.admin.query(
        `insert into leads (tenant_id, branch_id, source, stage, created_by, created_as, command_key, created_at) values ($1, $2, 'whatsapp', 'new', $3, 'central_cs', $4, $5) returning id`,
        [tenantId, b2, CS.staffId, `ld-${crypto.randomUUID()}`, ago(min)])).rows[0].id as string;
    } finally {
      for (const g of tg) await h.admin.query(`alter table leads enable always trigger ${g}`);
    }
    const d = await as(CS, (db) => readCsSummary(db, { from: monthStart(), to: today(), today: today(), label: "Bulan ini" }));
    expect(d.slaMinutes).toBe(15);
    expect(d.waiting.map((l) => l.id).sort()).toEqual([ids.late, ids.fresh].sort());
    const { overdue } = inbox(d);
    expect(overdue.map((l) => l.id)).toEqual([ids.late]);
    expect(overdue[0].waitingMinutes).toBeGreaterThanOrEqual(20);
  });

  it("T-111 PR-33c: Hari Ini shift summary — the b1 cashier's shift of this month, totals per tender", async () => {
    const r = await as(FO, (db) => shiftSummaryIn(db, "fo_cashier", b1, {}, anchor.noon));
    if (r.kind !== "ok" || r.props.state.kind !== "ready") throw new Error(`shift summary ${r.kind}`);
    const data = r.props.state.data;
    if (data.tenders.state !== "value") throw new Error("tenders unavailable");
    const t = Object.fromEntries(data.tenders.rows.map((x) => [x.method, [x.payments, x.received, x.paidOut]]));
    // every b1 receipt of the month is FO's, on the shift its first counter payment opened (float 0):
    // cash = S3b facial 1,500,000 + receivable collected 400,000 + package 3,000,000 (3 payments); EDC = S2 1,500,000; transfer = top-up 500,000
    const v = (rp: number) => ({ state: "value", rp });
    expect(t).toEqual({ cash: [3, v(4_900_000), v(0)], edc: [1, v(1_500_000), v(0)], transfer: [1, v(500_000), v(0)] });
    expect(data.moneyIn).toMatchObject({ state: "value", rp: 6_900_000 }); // = K1 at b1 (T-108 above)
  });

  it("T-112 PR-33d: Pasienku — each BC sees only her own target, closing value and commission", async () => {
    const month = today().slice(0, 7);
    await as(OWN, (db) => setStaffTarget(db, key(), BC.staffId, month, { closingValueTarget: 6_000_000 }));
    await as(OWN, (db) => setStaffTarget(db, key(), BC2.staffId, month, { closingValueTarget: 4_000_000 }));
    const load = async (p: P) => {
      const r = await as(p, (db) => pasienkuIn(db, "bc", b1, p.staffId, "BC", anchor.noon));
      if (r.kind !== "ok" || r.props.state.kind !== "ready") throw new Error(`pasienku ${r.kind}`);
      return r.props.state.data;
    };
    const [a, b] = [await load(BC), await load(BC2)];
    // BC confirmed the S2 and S3b selections (selection_confirm by a BC closes as herself): closing value = payments net of VAT (exempt: 0) on
    // her lines this month = S2 facial 1,500,000 + S3b facial 1,500,000 + the S3b filler's collected receivable 400,000 = 3,400,000
    expect(a.target.closing).toEqual({ state: "value", rp: 3_400_000 });
    expect(a.target.target).toEqual({ state: "value", rp: 6_000_000 });
    expect(b.target.closing).toEqual({ state: "value", rp: 0 });
    expect(b.target.target).toEqual({ state: "value", rp: 4_000_000 });
    // no commission rule is active on this tenant: each BC's own commission is a real Rp0, never the other's figure
    expect([a.commission.amount, b.commission.amount]).toEqual([{ state: "value", rp: 0 }, { state: "value", rp: 0 }]);
    expect(JSON.stringify(b)).not.toContain("3400000");
  });

  it("T-110 PR-33b: Ringkasan Cabang — an item below its minimum at the manager's branch is listed under stock risk with the reorder link", async () => {
    const PH = await person("pharmacist", b1); const MGR = await person("manager", b1);
    const cat = (await as(OWN, (db) => publish(db, { kind: "material", code: "M8-KASA" }, { name: "Kasa Steril M8", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
    const item = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pak", storage: "ruang", highValue: false, active: true }))).itemId as string;
    await as(PH, (db) => receiveStock(db, key(), null, { itemId: item, batchNo: "M8-K1", expiry: "2099-12-31", quantity: "3", reason: "stok_awal" }));
    await as(PH, (db) => setLevel(db, key(), null, item, "5", "10"));
    const raw = await as(MGR, (db) => readBranchSummary(db, b1)) as { branch_id: string; stock: { below_min: unknown } };
    expect(raw.branch_id).toBe(b1);
    expect(raw.stock.below_min).toEqual([{ item_id: item, name: "Kasa Steril M8", on_hand: 3, min_qty: 5, unit: "pak" }]);
    const v = resolveView({ viewer: { role: "manager", activeBranchId: b1, branches: [{ id: b1, name: "M8-KMG" }] }, filter: "semua", read: { ok: true, raw } });
    expect(v.kind).toBe("ok");
    const out = renderToStaticMarkup(BranchSummaryView({ state: v }));
    expect(out).toMatch(/<a[^>]*href="\/pembelian\/po"[^>]*aria-label="Buat PO untuk Kasa Steril M8"|aria-label="Buat PO untuk Kasa Steril M8"[^>]*href="\/pembelian\/po"/);
  });

  it("T-107: K1–K19 readers on this month equal the fixture expectations (the settled KPIs this month exercises)", async () => {
    const k = (id: Parameters<typeof kpi>[1]["kpi"]) => as(OWN, (db) => kpi(db, { kpi: id, from: monthStart(), to: today() }));
    // K1 = payments (not balance, not simulated) by method, branch where paid: all at b1 (T-111 tenders); b2 received nothing
    const k1 = await k("k1");
    expect([k1.total, k1.by_dim, Object.keys(k1.by_branch)]).toEqual([6_900_000, { cash: 4_900_000, edc: 1_500_000, transfer: 500_000 }, [b1]]);
    // K2 = delivered value at the executing branch: b1 S2 1,500,000 + filler 400,000 + package session 600,000; b2 its session 600,000
    const k2 = await k("k2");
    expect([k2.total, k2.by_branch[b1], k2.by_branch[b2]]).toEqual([3_100_000, { treatment: 1_900_000, session: 600_000 }, { session: 600_000 }]);
    // K3 = issued lines excl. VAT at the selling branch: S2 1,500,000 + S3b 1,500,000 + filler 400,000 (line) + package 3,000,000
    const k3 = await k("k3");
    expect([k3.total, k3.by_dim]).toEqual([6_400_000, { line: 3_400_000, package: 3_000_000 }]);
    // K5 = prepaid at `to`: paid-not-delivered 1,500,000 + package 1,800,000 + balance 500,000 + DP 0 (T-114 closings)
    const k5 = await as(FIN, (db) => kpi(db, { kpi: "k5", from: monthStart(), to: today() }));
    expect([k5.total, k5.by_dim.paid_not_delivered, k5.by_dim.package_liability, k5.by_dim.patient_balance]).toEqual([3_800_000, 1_500_000, 1_800_000, 500_000]);
    // K18 = one item below minimum at b1 (T-110's Kasa Steril M8, 3 < 5)
    expect((await k("k18")).by_branch).toEqual({ [b1]: { below_min: 1 } });
    // K19 = the BCs' closing value vs target this month (T-112): 3,400,000 of 10,000,000
    const r = await as(OWN, (db) => loadReport(db, "staf", { from: monthStart(), to: lastDay(today()) }));
    const k19 = r.kpis.filter((x) => x.id === "K19");
    expect(k19.map((x) => x.metric)).toEqual([{ kind: "ratio", num: 3_400_000, den: 10_000_000 }, { kind: "money", rupiah: 3_400_000 }]);
  });

  it("T-116 PR-95: each report links every KPI to its dictionary entry; K20 on this month", async () => {
    for (const [id, rep] of Object.entries(REPORTS)) for (const kid of rep.kpis) expect(definitionHref(kid), `${id} ${kid}`).toBe(`/laporan/kamus-kpi#${kid.toLowerCase()}`);
    expect(REPORTS.pasien.kpis).toContain("K21");
    const r = await as(OWN, (db) => loadReport(db, "operasional", { from: monthStart(), to: today() }));
    // K20 (Laporan Operasional) = K3 6,400,000 ÷ the 4 issued invoices with a sale value (S2, S3b, the filler, the package) = 1,600,000
    expect(r.kpis.find((x) => x.id === "K20")!.metric).toEqual({ kind: "money", rupiah: 1_600_000 });
  });

  it("T-117 PR-80: the owner digest of the anchor day carries K1, K2 and exception counts only — no patient name or record number", async () => {
    await h.admin.query(`insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
      values ($1, 'SET-37', $2::jsonb, $3::date, 'active', $4, 'owner', 'Pemilik', 'Ringkasan harian M8')`,
      [tenantId, JSON.stringify({ ringkasan: "17:00", penerima: ["owner", "finance"] }), monthStart(), OWN.staffId]);
    const store = mockDigestStore();
    const res = (await runDigest(app, { now: new Date(`${today()}T21:00:00+07:00`), port: mockDigestDeliveryPort(store) })).filter((x) => x.tenantId === tenantId);
    expect(res).toEqual([{ runId: expect.any(String), tenantId, businessDate: today(), outcome: "sent" }]);
    // exactly ONE delivery for this tenant and day (the provider key digestKey(tenant, day, email)); one outbox entry in all
    expect(store.outbox.map((m) => m.key)).toEqual([digestKey(tenantId, today(), "email")]);
    const mail = store.outbox[0];
    expect(mail.recipients).toEqual(["owner", "finance"]);
    const lines = mail.text.split("\n");
    // K1 / K2 of the anchor day = the T-108 cells: b1 6,900,000 / 2,500,000; b2 0 / 600,000
    expect(lines).toEqual(expect.arrayContaining(["Uang masuk (K1): Rp6.900.000", "Layanan selesai (K2): Rp3.100.000",
      "• M8-KMG: uang masuk Rp6.900.000, layanan selesai Rp2.500.000", "• M8-BSD: uang masuk Rp0, layanan selesai Rp600.000",
      "• Stok klinis menipis: 1", "• Lead melewati batas respons: 1"]));
    for (const s of ["Pasien M8", "RM-", "Lipatan", "Kondisi sintetis"]) expect(JSON.stringify(store.outbox), s).not.toContain(s);
  });

  it("T-118 PR-62: vendor platform health lists this tenant with counts and ages only — no clinic content", async () => {
    const vendor = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 1 }, VENDOR_GROUP_ROLE);
    const op = await owner.connect();
    try {
      const po = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, true) returning id`, [`m8.vendor.${++n}@vendor-sintetis.test`])).rows[0].id as string;
      await bootstrapVendor(op, po, "Pemilik Platform M8", "203.0.113.0/24", "Kantor vendor");
      const tok = `tok${crypto.randomUUID().replace(/-/g, "")}`;
      await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`, [po, tok]);
      const r = (await vendor.query(`select vendor_console_health($1, $2) r`, [tok, "203.0.113.10"])).rows[0].r as { ok: boolean; tenants: { id: string; name: string; state: string; providers: Record<string, unknown> }[] };
      expect(r.ok).toBe(true);
      const row = r.tenants.find((t) => t.id === tenantId)!;
      expect([row.name, row.state]).toEqual(["PT Klinik M8 Sintetis", "live"]);
      expect(Object.keys(row.providers).sort()).toEqual(["meta_webhook", "outbox", "payment_webhook", "satusehat", "whatsapp"]);
      for (const s of ["Pasien M8", "RM-", "Lipatan", "Kondisi sintetis", "Facial M8"]) expect(JSON.stringify(r), s).not.toContain(s);
    } finally {
      op.release();
      await vendor.end();
    }
  });

  it("J8 month end: finance locks a closed month (the open fixture month is refused) and exports the month's payments", async () => {
    const prev = (() => { const d = new Date(`${monthStart()}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
    const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : String(e)));
    expect(await why(as(FIN, (db) => lockPeriod(db, key(), today().slice(0, 7))))).toBe("ERR_VERSION_CONFLICT:period_open");
    await as(FIN, (db) => lockPeriod(db, key(), prev));
    expect((await as(FIN, (db) => report(db, { from: monthStart(), to: today() }))).status.locked_periods).toEqual([prev]);
    const rows = await as(FIN, (db) => exportRows(db, { kind: "payments", from: monthStart(), to: today() }));
    expect(rows[0].slice(0, 4)).toEqual(["tanggal", "cabang", "metode", "jumlah"]);
    // the five receipts of the month (T-111): 1,500,000 EDC + 1,500,000 + 400,000 + 3,000,000 cash + 500,000 transfer
    expect(rows.slice(1).map((x) => Number(x[3])).sort((a, b) => a - b)).toEqual([400_000, 500_000, 1_500_000, 1_500_000, 3_000_000]);
    const csv = toCsv(rows);
    for (const s of ["Pasien M8", "RM-"]) expect(csv).not.toContain(s);
  });

  it("T-106 PR-98: Coretax export of this month refused while the PKP tenant has no approved tax advice; with it, a PKP sale exports from its frozen snapshot", async () => {
    const NPWP = "012345678901234";
    // PKP without tax advice: the T-106 test's stand-in (the profile writer itself needs the advice), guard off for the seed only
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    try { await h.admin.query(`update tenants set npwp = $2, is_pkp = true, pkp_effective_from = $3::date - 30 where id = $1`, [tenantId, NPWP, today()]); }
    finally { await h.admin.query("alter table tenants enable always trigger tenants_tax_guard"); }
    const period = today().slice(0, 7);
    expect(await as(FIN, (db) => exportCoretax(db, { period, kind: "retail" }))).toEqual({ ok: false, refused: "gate_closed", missing: ["Saran pajak (PPN per jenis layanan)"] });
    // the owner approves the tax advice (PR-97), the profile history says PKP since 70 days (as tests/accounting/coretax.test.ts makePkp)
    const pdf = Buffer.from("%PDF-1.7\nsaran M8\n%%EOF\n");
    const { fileId } = await as(FIN, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: monthStart() }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id as string;
    await as(OWN, (db) => decideEvidence(db, ev, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    try {
      // undo the gate-closed stand-in first: the real profile writer judges the change against the tenant's current (non-PKP) facts
      await h.admin.query(`update tenants set is_pkp = false, pkp_effective_from = null where id = $1`, [tenantId]);
      const tomorrow = new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      await as(OWN, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: tomorrow, npwp: NPWP, reason: "PKP" }));
      await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 70, changed_at = now() - interval '75 days' where tenant_id = $1`, [tenantId, today()]);
      await h.admin.query(`update tenants set pkp_effective_from = $2::date - 70 where id = $1`, [tenantId, today()]);
    } finally {
      await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
      await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    }
    // a taxable product sold now at b1 to a patient (the T-106 test's sale): 333,000 VAT-inclusive → base (333,000 × 100 + 55) div 111 = 300,000, VAT 33,000, frozen at issue
    const prod = (await as(OWN, (db) => publish(db, { kind: "product", code: "M8-SRM" }, { name: "Serum M8", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"))).itemId;
    const taxPid = await patient(b1, "Pasien M8 Pajak");
    F.pTAX = taxPid;
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: taxPid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: prod, quantity: 1 }]));
    const frozen = (await h.admin.query(`select vat_base::text b, vat_amount::text v from invoice_lines where invoice_id = $1`, [invoiceId])).rows;
    expect(frozen).toEqual([{ b: "300000", v: "33000" }]);
    const x = await as(FIN, (db) => exportCoretax(db, { period, kind: "retail" }));
    if (!x.ok) throw new Error(`coretax refused ${x.refused}`);
    expect([x.rows, x.base, x.vat]).toEqual([1, 300_000, 33_000]); // the earlier exempt sales were issued before PKP: not in the document
    expect(x.xml).toContain("<TaxBaseSellingPrice>300000</TaxBaseSellingPrice>");
    expect(x.xml).toContain("<VAT>33000</VAT>");
    expect(x.xml).toContain(`<TIN>0${NPWP}</TIN>`);
    for (const s of ["Pasien M8", "RM-"]) expect(x.xml).not.toContain(s);
  });

});

// ── final-run journey parts on the same month (after every read-side hook above, which they would otherwise move) ──
describe("M8 journeys on the fixture month — final run (aa8603bb)", () => {
  let dpPid = ""; let dpVersion = "";
  it("J1: no slot for the service at the branch → the patient goes on the waitlist (the waitlist entry is the note)", async () => {
    const pid = await patient(b2, "Pasien M8 Tunggu");
    await as(OWN, (db) => setServices(db, b2, [facial]));
    // b2 has hours (T-115) and offers the facial, but no room and no rostered performer: no slot on the anchor day
    expect(await as(FO2, (db) => slots(db, { branchId: b2, versionId: facialV, date: today() }))).toEqual([]);
    const { entryId } = await as(FO2, (db) => addToWaitlist(db, key(), { branchId: b2, patientId: pid, itemId: facial }));
    const rows = await as(FO2, (db) => waitlistList(db, b2, facial));
    expect(rows.map((x) => [x.id, x.state, x.patient_id])).toEqual([[entryId, "waiting", pid]]);
  });

  it("J4 alternative tenders + booking DP: a deposit received and then decided (moved to balance), the balance shown and used, a partial payment, a package DP", async () => {
    // booking DP (the T-105 DP fixture's pattern): a DP service, SET-10 on, a booked appointment 3 days ahead (direct row, guards off for the seed)
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: "M8-DPK" }, {
      name: "Konsultasi DP M8", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 1_000_000, category: "consultation", prep_min: 0, treatment_min: 30,
      buffer_min: 0, indications: "Indikasi", consent_template: "Templat DP M8.", delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }], booking_dp_enabled: true, booking_dp_amount: 200_000,
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    dpVersion = v.versionId;
    await as(OWN, (db) => changeSetting(db, { key: "SET-10", branchId: null, value: { dp_booking: true, batas_ubah: 24 } as never, reason: "DP M8" }));
    dpPid = await patient(b1, "Pasien M8 DP");
    const start = new Date(Math.ceil((Date.now() + 72 * 3_600_000) / 900_000) * 900_000);
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    let apt = "";
    try {
      apt = (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
        values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $8, 'fo_cashier') returning id`, [tenantId, b1, dpPid, dpVersion, DOC.staffId, start, new Date(start.getTime() + 30 * 60_000), FO.staffId])).rows[0].id as string;
    } finally { await h.admin.query(`alter table appointments enable always trigger appointments_guard`); }
    const d = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 200_000 }));
    expect(d.amount).toBe(200_000);
    // decided: the patient cancels ≥ 24 h ahead → the DP moves to the patient balance (dp_transfer)
    await as(FO, (db) => cancelAppointment(db, key(), apt, "Pasien batal"));
    expect((await h.admin.query(`select state from booking_deposits where id = $1`, [d.deposit_id])).rows[0].state).toBe("moved_to_balance");
    // balance shown at the cashier, then used for part of a facial; the rest paid in two partial cash payments (a partial payment)
    const { v: visit, items } = await visitWith(dpPid, b1, [facialV], FO, 20);
    F.pDP = dpPid; F.vDP = visit;
    await as(BC, (db) => confirmSelection(db, key(), visit, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: dpPid, visitId: visit }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    const shown = await as(FO, (db) => kasirInvoice(db, invoiceId));
    expect([shown.patient_balance, shown.tenders.find((t) => t.method === "balance")?.available]).toEqual([200_000, true]);
    const p1 = await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "balance", amount: 200_000 }, { method: "cash", amount: 300_000, cashTendered: 300_000 }]));
    expect([p1.paid, p1.outstanding]).toEqual([500_000, 1_000_000]);
    const p2 = await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_000_000, cashTendered: 1_000_000 }]));
    expect(p2.outstanding).toBe(0);
    // a package DP: the 5-session package of J7 (min DP = one session 600,000); 599,999 refused, 600,000 accepted, one session unlocked
    const pkgItem = (await h.admin.query(`select item_id from catalog_versions where tenant_id = $1 and name = 'Paket M8' and state = 'active'`, [tenantId])).rows[0].item_id as string;
    const { invoiceId: pinv } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: dpPid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), pinv, [{ itemId: pkgItem, quantity: 1 }]));
    const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : String(e)));
    expect(await why(as(FO, (db) => receivePayment(db, key(), pinv, [{ method: "cash", amount: 599_999, cashTendered: 599_999 }])))).toBe("ERR_MIN_DP_NOT_MET");
    const p3 = await as(FO, (db) => receivePayment(db, key(), pinv, [{ method: "cash", amount: 600_000, cashTendered: 600_000 }]));
    expect(p3.outstanding).toBe(2_400_000);
    await drain();
    // booking_dp in both books: received 200,000 (net; exempt) and moved −200,000 at b1
    const dpm = (await h.admin.query(`select term, sum(amount)::text a from subledger_movements($1) where ledger = 'booking_dp' and branch_id = $2 group by 1 order by 1`, [tenantId, b1])).rows;
    expect(dpm).toEqual([{ term: "moved", a: "-200000" }, { term: "received", a: "200000" }]);
    expect(await ledgerSides(["liability_booking_dp"], monthStart(), today(), b1)).toEqual({ dr: 200_000, cr: 200_000 });
  });

  it("J5 materials + J6 hand-over and the real visit close: materials issued and reconciled in the room; the pharmacist hands over the paid product; visit_close closes the visit", async () => {
    const PH = await person("pharmacist", b1); PHJ = PH;
    const gud = (await h.admin.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [tenantId, b1])).rows[0].id as string;
    const room = await as(OWN, (db) => upsertRoom(db, b1, { name: "Ruang M8", kind: "treatment" }));
    const roomDep = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Depot Ruang M8", kind: "ruang", roomId: room }))).depotId;
    const apt = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek M8", kind: "apotek" }))).depotId;
    const matCat = (await as(OWN, (db) => publish(db, { kind: "material", code: "M8-GEL" }, { name: "Gel M8", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
    const gel = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: matCat, unit: "ml", storage: "ruang", highValue: false, active: true }))).itemId as string;
    // costed (K7): 100 ml at Rp1,000; the batch expires in 10 days (K18 expiring)
    await as(PH, (db) => receiveCosted(db, key(), null, { itemId: gel, batchNo: "M8-G1", expiry: plusDay(today(), 10), quantity: "100", reason: "penerimaan", unitCost: 1_000 }));
    const prodV = await as(OWN, (db) => publish(db, { kind: "product", code: "M8-KRM" }, { name: "Krim M8", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 150_000 } as never, "Produk"));
    const krim = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: prodV.itemId, unit: "tube", storage: "ruang", highValue: false, active: true }))).itemId as string;
    const kb = (await as(PH, (db) => receiveCosted(db, key(), null, { itemId: krim, batchNo: "M8-K", expiry: "2099-12-31", quantity: "5", reason: "penerimaan", unitCost: 60_000 }))).batchId;
    APTJ = apt; KRIM = prodV.itemId; KRIMV = prodV.versionId;
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: gud, toDepotId: apt, lines: [{ batchId: kb, quantity: "5" }] }));
    // a facial with materials and a product on the same visit, paid in full by EDC before the treatment
    const pid = await patient(b1, "Pasien M8 Serah");
    const { v, items, d } = await visitWith(pid, b1, [facialV], FO, 10);
    F.pSERAH = pid; F.vSERAH = v;
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }, { catalogVersionId: prodV.versionId, quantity: "1" }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    // the product line billed from its selection row (invoice_lines.selection_item_id, 0124 G-Q4 S1): the ledger posts the hand-over only on
    // the linked line; an unlinked line posts nothing and is a "Selisih penyerahan produk" exception (open G-Q4 U1–U4), never inferred
    const selItem = (await h.admin.query(`select id from selection_items where tenant_id = $1 and visit_id = $2 and catalog_version_id = $3`, [tenantId, v, prodV.versionId])).rows[0].id as string;
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }, { itemId: prodV.itemId, quantity: 1, selectionItemId: selItem }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 1_650_000, details: { card_type: "debit", bank: "BCA", trace: "811002", approval_code: "M8J6A1" } }]));
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: roomDep, planItemId: items[0], lines: [{ itemId: gel, quantity: "10" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: gud }));
    const e = await as(d, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true, materialRequestId: requestId }));
    await as(d, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed", materials: { [requestId]: [{ itemId: gel, quantity: "7" }] } }));
    const { returnId } = await as(NUR, (db) => proposeReturn(db, key(), requestId, { condition: "unopened", lines: [{ itemId: gel, quantity: "3" }] }));
    await as(PH, (db) => decideReturn(db, key(), returnId, "usable", gud));
    const req = await as(PH, (db) => getRequest(db, requestId));
    expect(req.state).toBe("reconciled");
    expect(req.lines[0].batches[0]).toMatchObject({ issued: 10, consumed: 7, returned: 3, wasted: 0, pending: 0, free: 0 });
    const disp = (await h.admin.query(`select id from dispensings where tenant_id = $1 and visit_id = $2`, [tenantId, v])).rows[0].id as string;
    const why = (x: Promise<unknown>) => x.then(() => "ok", (er) => (er instanceof CommandError ? `${er.code}:${(er as { reason?: string }).reason ?? ""}` : String(er)));
    F.dSERAH = disp;
    // visit_close checks, in order: unbilled addition, unpaid bill, pending dispensing (0095:785–806): paid, treated, the product not handed
    expect(await why(as(FO, (db) => closeVisit(db, key(), v)))).toBe("ERR_VERSION_CONFLICT:pending_dispensing");
    await as(PH, (db) => prepareDispensing(db, key(), disp, apt));
    await as(PH, (db) => handOver(db, key(), disp, { checks: Object.fromEntries(CHECKS.map((c) => [c, true])) as never }));
    expect(await why(as(FO, (db) => closeVisit(db, key(), v)))).toBe("ok");
    expect((await h.admin.query(`select closed_at is not null c from visits where id = $1`, [v])).rows[0].c).toBe(true);
    // what the close itself creates (0111 visit_aftercare): one aftercare notice for the counted facial (aftercare text "Perawatan"); no WA
    // template is approved on this tenant, so nothing is queued (outbound_id null). The PR-30 follow-ups come from the daily scan (below).
    expect((await h.admin.query(`select branch_id b, patient_id p, catalog_version_ids::text[] vs, outbound_id o from aftercare_notices where tenant_id = $1 and visit_id = $2`, [tenantId, v])).rows)
      .toEqual([{ b: b1, p: pid, vs: [facialV], o: null }]);
    await drain();
    // the product delivered: paid-not-delivered performance −150,000 (exempt) at b1
    const perf = (await h.admin.query(`select sum(amount)::text a from subledger_movements($1) where ledger = 'paid_not_delivered' and term = 'performance' and source_kind = 'dispensing'`, [tenantId])).rows[0].a;
    expect(perf).toBe("-150000");
    // ... and the ledger posted the same hand-over on the linked line: Dr paid-not-delivered 150,000 / Cr product revenue 150,000 (exempt: no VAT)
    const je = (await h.admin.query(`select a.key k, l.debit::text dr, l.credit::text cr from journal_entries e join journal_lines l on l.entry_id = e.id join ledger_accounts a on a.id = l.account_id
                                     where e.tenant_id = $1 and e.source_kind = 'dispensing' and e.source_id = $2 and a.key in ('liability_paid_not_delivered', 'revenue_product') order by a.key`, [tenantId, disp])).rows;
    expect(je).toEqual([{ k: "liability_paid_not_delivered", dr: "150000", cr: "0" }, { k: "revenue_product", dr: "0", cr: "150000" }]);
    // after the linked hand-over: no "Selisih penyerahan produk" exception (0124 ledger_handover_exceptions), tenant-wide and at b1
    for (const branchId of [null, b1]) expect(await as(AU, (db) => handoverExceptions(db, { from: monthStart(), to: today(), branchId })), String(branchId)).toMatchObject({ unlinked: 0, fractional: 0 });
  });

  it("J7 expiry → balance: the J7 package's validity ends; the expiry scan moves the paid-unused value to the patient balance", async () => {
    const pkg = (await h.admin.query(`select p.id, p.patient_id from packages p join invoices i on i.id = p.invoice_id where p.tenant_id = $1 and p.state = 'active'
                                      and exists (select 1 from package_sessions s where s.package_id = p.id and s.state = 'redeemed')`, [tenantId])).rows[0];
    await h.admin.query(`alter table packages disable trigger packages_guard`);
    try { await h.admin.query(`update packages set validity_end = now() - interval '1 minute' where id = $1`, [pkg.id]); }
    finally { await h.admin.query(`alter table packages enable always trigger packages_guard`); }
    expect(await runPackageExpiryScan(worker)).toBeGreaterThanOrEqual(1);
    await drain();
    // paid 3,000,000, two sessions of 600,000 redeemed → 1,800,000 paid-unused moves to the balance (package close −1,800,000, from_expiry +1,800,000)
    const m = (await h.admin.query(`select ledger, term, sum(amount)::text a from subledger_movements($1) where object_id = $2 or (ledger = 'patient_balance' and term = 'from_expiry')
                                    group by 1, 2 order by 1, 2`, [tenantId, pkg.id])).rows.filter((x: { term: string }) => ["close", "from_expiry"].includes(x.term));
    expect(m).toEqual([{ ledger: "package_liability", term: "close", a: "-1800000" }, { ledger: "patient_balance", term: "from_expiry", a: "1800000" }]);
  });

  it("J6 follow-up (PR-30) + the M8 exit check again: the scan creates the J6 patient's own follow-up (rule, source, due date); every sub-ledger equals its ledger accounts, and every (ledger, term, branch) movement equals its derived amount", async () => {
    // PR-30 is rule-driven by the daily scan (0108); visit_close itself makes the aftercare notice (asserted in the J5/J6 case). For the J6
    // patient (SERAH: one visit, closed today, no open visit, no live appointment) the rule that applies is `dormant` (SET-22 tidak_datang
    // default 90): created when the scan day > check-in day + 90, due check-in day + 91, step visit_<visit id>, CS queue, source = the patient.
    const checkin = (await h.admin.query(`select (checked_in_at at time zone 'Asia/Jakarta')::date::text d from visits where id = $1`, [F.vSERAH])).rows[0].d as string;
    expect(checkin).toBe(today());
    const fuOf = async () => (await h.admin.query(`select rule_code r, source_kind sk, source_id s, step, role_queue q, branch_id b, original_due_on::text due, state
                                                    from followups where tenant_id = $1 and patient_id = $2 order by created_at`, [tenantId, F.pSERAH])).rows;
    await runFollowupScan(worker, plusDay(today(), 90)); // day + 90: not yet (strictly after day + 90)
    expect(await fuOf()).toEqual([]);
    await runFollowupScan(worker, plusDay(today(), 91));
    expect(await fuOf()).toEqual([{ r: "dormant", sk: "patient", s: F.pSERAH, step: `visit_${F.vSERAH.replace(/-/g, "")}`, q: "cs", b: b1, due: plusDay(today(), 91), state: "open" }]);
    const { r, mism } = await reconcile();
    expect(mism).toEqual([]);
    expect(r.ledgers.inter_branch.closing).toBe(0);
    const ck = r.checks as unknown as Record<string, Record<string, unknown>>;
    expect(ck.booking_dp).toMatchObject({ level: "stored_stock", mismatches: 0, expected: 0 });
    expect(Number((await h.admin.query(`select count(*) c from booking_deposits where tenant_id = $1`, [tenantId])).rows[0].c)).toBe(1);
    // EXACT per (ledger, term, branch): the sign-folded gross check above cannot see two same-sign terms swap; this list can. Every amount is
    // derived from the fixture facts in FINAL-DERIVATION.md §Movements (the T-108 / T-114 / J-case assertions name the same facts).
    const mv = (await h.admin.query(
      `select m.ledger, m.term, m.branch_id b, sum(m.amount)::text amount from subledger_movements($1) m
        where m.day between $2::date and $3::date group by 1, 2, 3 having sum(m.amount) <> 0 order by 1, 2, 3`, [tenantId, monthStart(), today()])).rows
      .map((x: { ledger: string; term: string; b: string | null; amount: string }) => `${x.ledger}/${x.term}@${x.b === b1 ? "b1" : x.b === b2 ? "b2" : x.b}=${x.amount}`);
    expect([...mv].sort()).toEqual([...MOVEMENTS].sort());
  });

  it("G-Q4 U1–U4 (owner-amended tracked exception): a visit product billed WITHOUT its selection link — the sub-ledger infers the hand-over, the journal posts nothing; exact exception and reconciliation difference", async () => {
    // a second product on a new b1 visit, billed on a line with NO selection_item_id (U3: billed without the link) and handed over
    const pid = await patient(b1, "Pasien M8 Tanpa Tautan");
    // a plain walk-in visit (no examination, no plan): a product-only selection, as tests/pharmacy/pharmacy.test.ts CLIN-025
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [tenantId, b1, pid, FO.staffId])).rows[0].id as string;
    F.pGQ4 = pid; F.vGQ4 = v;
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ catalogVersionId: KRIMV, quantity: "1" }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: KRIM, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 150_000, cashTendered: 150_000 }]));
    const disp = (await h.admin.query(`select id from dispensings where tenant_id = $1 and visit_id = $2`, [tenantId, v])).rows[0].id as string;
    F.dGQ4 = disp;
    await as(PHJ, (db) => prepareDispensing(db, key(), disp, APTJ));
    await as(PHJ, (db) => handOver(db, key(), disp, { checks: Object.fromEntries(CHECKS.map((c) => [c, true])) as never }));
    await drain();
    // the exception: exactly one unlinked hand-over, at b1, none fractional; b2 none
    expect(await as(AU, (db) => handoverExceptions(db, { from: monthStart(), to: today() }))).toMatchObject({ unlinked: 1, fractional: 0 });
    expect(await as(AU, (db) => handoverExceptions(db, { from: monthStart(), to: today(), branchId: b1 }))).toMatchObject({ unlinked: 1, fractional: 0 });
    expect(await as(AU, (db) => handoverExceptions(db, { from: monthStart(), to: today(), branchId: b2 }))).toMatchObject({ unlinked: 0, fractional: 0 });
    // the sub-ledger counted the delivery (0121 disp infers the visit line: −150,000 exempt), the journal posted no hand-over pair
    expect((await h.admin.query(`select amount::text a, branch_id b from subledger_movements($1) where ledger = 'paid_not_delivered' and term = 'performance' and source_kind = 'dispensing' and source_id = $2`, [tenantId, disp])).rows)
      .toEqual([{ a: "-150000", b: b1 }]);
    expect((await h.admin.query(`select count(*)::int c from journal_entries where tenant_id = $1 and source_kind = 'dispensing' and source_id = $2`, [tenantId, disp])).rows[0].c).toBe(0);
    // the exact reconciliation difference this exception makes: paid_not_delivered only, at b1, sub-ledger 150,000 below the ledger (net and
    // closing), the ledger's debit side 150,000 short (gross); every other sub-ledger and b2 still reconcile
    const { mism } = await reconcile();
    const sub = (await as(FIN, (db) => rollforward(db, { from: monthStart(), to: today() }))).ledgers.paid_not_delivered;
    const gl = await ledgerMovement(["liability_paid_not_delivered"], "credit", monthStart(), today());
    expect(gl - (sub.closing - sub.opening)).toBe(150_000);
    // exact: PND sub-ledger movement 3,000,000 (J6 check) + 150,000 settled − 150,000 performed = 3,000,000; ledger 3,000,000 + 150,000 credit
    // with no debit = 3,150,000. Gross: sub-ledger up 6,550,000 + 150,000 = 6,700,000 / down 3,550,000 + 150,000 = 3,700,000; ledger credit
    // 6,700,000 / debit 3,550,000. Everything is at b1; b2 and every other sub-ledger reconcile (no other line)
    expect(mism).toEqual([
      "paid_not_delivered: sub-ledger 3000000 ≠ ledger 3150000",
      "paid_not_delivered: sub-ledger +6700000/−3700000 ≠ ledger +6700000/−3550000",
      "paid_not_delivered @b1: sub-ledger closing 3000000 ≠ ledger balance 3150000",
      "paid_not_delivered @b1 gross: sub-ledger +6700000/−3700000 ≠ ledger +6700000/−3550000",
    ]);
  });

  it("T-107 / T-116: every SETTLED KPI exactly on this month — K1–K3, K5–K11, K13, K16, K18 (dashboard_kpi) and K19–K27 (targets, report readers) — from the fixture facts; K4 / K12 / K14 / K15 / K17 are owner-amended (pending Finance)", async () => {
    // KPI-only facts, added on the same month through the real writers (FINAL-DERIVATION.md §KPI):
    // K8: one consultation visit at b1 with a charged fee (SET-6 Rp200,000) — a consultation without a purchase (no waiver)
    await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 200_000 as never, reason: "Biaya konsultasi M8" }));
    const kon = await as(OWN, (db) => publish(db, { kind: "service", code: "M8-KON" }, {
      name: "Konsultasi M8", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 200_000, category: "consultation", prep_min: 0, treatment_min: 15, buffer_min: 0,
      indications: "Indikasi", consent_template: "Templat konsultasi M8.", delegation: "Dokter", aftercare_text: "", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Layanan baru"));
    if (kon.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [kon.approvalId]));
    const pK = await patient(b1, "Pasien M8 Konsultasi");
    F.pKON = pK;
    const vK = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [tenantId, b1, pK, FO.staffId])).rows[0].id as string;
    F.vKON = vK;
    await as(DOC, (db) => openExam(db, key(), vK));
    const fee = await as(FO, (db) => chargeConsultationFee(db, key(), vK, kon.itemId));
    expect(fee.amount).toBe(200_000);
    await as(FO, (db) => receivePayment(db, key(), fee.invoice_id, [{ method: "cash", amount: 200_000, cashTendered: 200_000 }]));
    await as(FO, (db) => closeVisit(db, key(), vK));
    // K13: one b1 lead converted end to end through lead_stage_set: matched to the consultation patient, booked on an appointment of the
    // cluster (a seeded appointment row, guards off: the booking writer is J1 / tests/scheduling's), arrived at its visit, converted on the paid fee
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    let apK = "";
    try {
      const st = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 900_000) * 900_000);
      apK = (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
        values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'whatsapp', $8, 'central_cs') returning id`, [tenantId, b1, pK, kon.versionId, DOC.staffId, st, new Date(st.getTime() + 15 * 60_000), CS.staffId])).rows[0].id as string;
    } finally { await h.admin.query(`alter table appointments enable always trigger appointments_guard`); }
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "instagram", branchId: b1, patientId: pK }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "contacted" }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked", appointmentId: apK }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "arrived", visitId: vK }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted", invoiceId: fee.invoice_id }));
    // K25: a promo code (marketing) on a 100,000 product sold at b1 at 10 % off, paid in full (usage consumed)
    const MK = await person("marketing");
    const pr = await as(OWN, (db) => publish(db, { kind: "product", code: "M8-PRM" }, { name: "Sabun M8", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 100_000 } as never, "Produk"));
    await as(PHJ, (db) => saveItem(db, key(), null, { catalogItemId: pr.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    await as(MK, (db) => createPromoCode(db, key(), "M8-HEMAT", 10, { validFrom: plusDay(today(), -1), validTo: plusDay(today(), 30), discountKind: "percent", discountValue: 10, itemIds: [pr.itemId] }));
    const pP = await patient(b1, "Pasien M8 Promo");
    F.pPROMO = pP;
    const { invoiceId: invP } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pP }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invP, [{ itemId: pr.itemId, quantity: 1, promoCode: "M8-HEMAT" }]));
    await as(FO, (db) => receivePayment(db, key(), invP, [{ method: "cash", amount: 90_000, cashTendered: 90_000 }]));
    // K26: two surveys (central CS) on the two visits closed by visit_close: the J5/J6 visit 5, the consultation visit 2
    await as(CS, (db) => recordSurvey(db, key(), { visitId: F.vSERAH, score: 5 }));
    await as(CS, (db) => recordSurvey(db, key(), { visitId: vK, score: 2 }));
    await drain();

    const D = { from: monthStart(), to: today() };
    const k = async (id: Parameters<typeof kpi>[1]["kpi"], who: P = OWN) => as(who, (db) => kpi(db, { kpi: id, ...D }));
    // ── K1 Uang masuk (payments, not balance; − cash refunds) by method, branch where paid — all at b1 ──
    //   cash: S3b 1,500,000 + collected 400,000 + package 3,000,000 + DP 200,000 + DP-patient 300,000 + 1,000,000 + package DP 600,000
    //         + G-Q4 product 150,000 + consultation fee 200,000 + promo 90,000 = 7,440,000
    //   edc: S2 1,500,000 + J5/J6 visit 1,650,000 = 3,150,000; transfer: top-up 500,000. Total 11,090,000
    const k1 = await k("k1");
    expect([k1.total, k1.by_dim, Object.keys(k1.by_branch)]).toEqual([11_090_000, { cash: 7_440_000, edc: 3_150_000, transfer: 500_000 }, [b1]]);
    // ── K2 Layanan selesai: delivered net at the executing branch ──
    //   b1 treatment: S2 1,500,000 + filler 400,000 + J5 facial 1,500,000 = 3,400,000 (the S3b and DP facials are paid, not performed)
    //   b1 product: J6 linked 150,000 + G-Q4 unlinked 150,000 (0121 infers the line) = 300,000; b1 consultation: the fee 200,000 (charged at close)
    //   b1 session 600,000; b2 session 600,000. Total 5,100,000
    const k2 = await k("k2");
    expect([k2.total, k2.by_branch[b1], k2.by_branch[b2]]).toEqual([5_100_000,
      { treatment: 3_400_000, product: 300_000, consultation: 200_000, session: 600_000 }, { session: 600_000 }]);
    // ── K3 Penjualan: issued lines excl. VAT at the selling branch ──
    //   line: S2 1,500,000 + S3b 1,500,000 + filler 400,000 + DP-patient 1,500,000 + J5 facial 1,500,000 + J6 product 150,000 + G-Q4 150,000
    //         + PKP serum 300,000 (333,000 − VAT 33,000) + consultation 200,000 + promo 90,000 = 7,290,000; package: J7 3,000,000 + DP-patient 3,000,000
    const k3 = await k("k3");
    expect([k3.total, k3.by_dim]).toEqual([13_290_000, { line: 7_290_000, package: 6_000_000 }]);
    // ── K5 Kewajiban prabayar at `to` (finance): paid-not-delivered + packages + balance + DP ──
    //   PND: settled S2 1,500,000 + S3b facial 1,500,000 + DP facial 1,500,000 + J5/J6 1,650,000 + G-Q4 150,000 + fee 200,000 + promo 90,000
    //        (= 6,590,000) + converted 400,000 − performed (1,500,000 + 400,000 + 1,500,000 + 150,000 + 150,000 + 200,000 = 3,900,000) = 3,090,000
    //        (left: the S3b facial 1,500,000, the DP facial 1,500,000, the promo product 90,000 never handed; the PKP serum is unpaid)
    //   packages: J7 closed at expiry (0) + the DP patient's package DP 600,000; balance: top-up 500,000 + DP 200,000 − used 200,000 + from
    //   expiry 1,800,000 = 2,300,000; DP 200,000 − 200,000 = 0. Total 5,990,000
    const k5 = await k("k5", FIN);
    expect([k5.by_dim.paid_not_delivered, k5.by_dim.package_liability, k5.by_dim.patient_balance, k5.by_dim.booking_dp ?? 0, k5.total])
      .toEqual([3_090_000, 600_000, 2_300_000, 0, 5_990_000]);
    // ── K6 Paket kedaluwarsa ke saldo: the J7 package at b1, paid-unused 1,800,000 ──
    const k6 = await k("k6");
    expect([k6.total, k6.by_branch]).toEqual([1_800_000, { [b1]: { expired_to_balance: 1_800_000 } }]);
    // ── K7 Kontribusi = K2 − material cost − product cost − performer commission (no rule: 0) at the executing branch ──
    //   material: 7 ml gel × Rp1,000 = 7,000 (the 3 ml returned are not consumed); product cost: 2 tubes × Rp60,000 = 120,000
    //   K7 = K2 5,100,000 − 7,000 − 120,000 = 4,973,000 (b1 4,500,000 − 127,000 = 4,373,000; b2 600,000). No uncosted movement, no bulk estimate
    const k7 = await k("k7");
    expect([k7.total, k7.by_dim.material_cost, k7.by_dim.product_cost, k7.by_dim.uncosted ?? 0, k7.by_dim.estimasi ?? 0]).toEqual([4_973_000, -7_000, -120_000, 0, 0]);
    expect([k7.by_branch[b1].material_cost, k7.by_branch[b1].product_cost]).toEqual([-7_000, -120_000]);
    // ── K8 Konsultasi jadi pembelian: consultation-fee decisions — one (charged, no purchase) at b1 ──
    expect((await k("k8")).by_branch).toEqual({ [b1]: { consultation: 1 } });
    // ── K9 Rencana dipilih: plan items recommended this month (not removed), valued at the version's normal price × qty ──
    //   b1: S2 facial, S3b facial, S3b filler (the approved addition's plan item), S11 b1 facial, DP facial, J5 facial = 6; value 5 × 1,500,000
    //   + 400,000 = 7,900,000. b2: the S11 b2 facial 1,500,000. Selected (a confirmed selection row) within 30 / 60 / 90 days: the S2, S3b, DP
    //   and J5 facials (BC selections) = 4, 6,000,000; the filler (an addition) and the package sessions (reserved) are not selections
    const k9 = await k("k9");
    expect([k9.by_branch[b1], k9.by_branch[b2]]).toEqual([
      { recommended_count: 6, recommended_value: 7_900_000, selected_30_count: 4, selected_30_value: 6_000_000, selected_60_count: 4, selected_60_value: 6_000_000,
        selected_90_count: 4, selected_90_value: 6_000_000 },
      { recommended_count: 1, recommended_value: 1_500_000 }]);
    // ── K10 Pasien baru vs kembali: visits of the month; the first visit of a canonical patient = new ──
    //   the S11 patient: b1 visit new, b2 visit returning; S2, S3b, DP, J5/J6, G-Q4, consultation: one visit each → 7 new at b1
    expect((await k("k10")).by_branch).toEqual({ [b1]: { new: 7 }, [b2]: { returning: 1 } });
    // ── K11 Kunjungan kedua: new patients of the month with a CLOSED later visit within 60 days: none (the S11 b2 visit stays open) ──
    expect((await k("k11")).by_dim).toEqual({ new: 7 });
    // ── K13 Konversi lead by source: the 2 T-113 leads (whatsapp, b2, new) + the converted instagram lead at b1 ──
    const k13 = await k("k13");
    expect(k13.by_grp1).toEqual({ whatsapp: { lead: 2 }, instagram: { lead: 1, booked: 1, arrived: 1, paid: 1 } });
    // ── K16 Lampiran produk: visits with a finished counted treatment, and those with a product line on an issued visit invoice ──
    //   treatment visits: S2, S3b (the filler), S11 b1, J5/J6 at b1 (4; the DP visit has no treatment); S11 b2 at b2 (1); with product: the
    //   J5/J6 visit (the G-Q4 visit has a product but no treatment: not in the population)
    expect((await k("k16")).by_branch).toEqual({ [b1]: { treatment_visit: 4, with_product: 1 }, [b2]: { treatment_visit: 1 } });
    // ── K18 Risiko stok: below minimum = the T-110 kasa (3 < 5) at b1; fit batches expiring within SET-27 30 days (default) = the gel batch
    //   (expiry today + 10, 93 ml left); the kasa and krim batches expire 2099 ──
    expect((await k("k18")).by_branch).toEqual({ [b1]: { below_min: 1, expiring: 1 } });
    // ── K19 Target BC (target_list, this calendar month; 0103 target_closing_value): payments net of VAT on lines whose visit selection the BC
    //   confirmed: S2 1,500,000 + S3b facial 1,500,000 + filler (collected share) 400,000 + DP facial 1,500,000 (balance and cash allocations)
    //   + J5/J6 1,650,000 + G-Q4 150,000 = 6,700,000 (exempt: VAT 0); BC2 0; targets 6,000,000 + 4,000,000 = 10,000,000 ──
    const staf = await as(OWN, (db) => loadReport(db, "staf", { from: monthStart(), to: lastDay(today()) }));
    expect(staf.kpis.filter((x) => x.id === "K19").map((x) => x.metric)).toEqual([{ kind: "ratio", num: 6_700_000, den: 10_000_000 }, { kind: "money", rupiah: 6_700_000 }]);
    // ── K20 Rata-rata transaksi: K3 13,290,000 ÷ issued invoices with sale value > 0 this month: S2, S3b facial, filler, J7 package, PKP serum,
    //   DP facial, DP package, J5/J6, G-Q4, consultation, promo = 11 → 1,208,181.8 → 1,208,182 (half away from zero) ──
    expect(await as(OWN, (db) => read.k20(db, D))).toEqual({ k3: { kind: "money", rupiah: 13_290_000 }, invoices: { kind: "count", value: 11 }, average: { kind: "money", rupiah: 1_208_182 } });
    // ── K21 Churn at `to`: patients with a visit in the 12 months = S2, S3b, S11, DP, J5/J6, G-Q4, consultation (7); every last visit is
    //   today → none dormant (SET-22 tidak_datang 90) ──
    const k21 = await as(OWN, (db) => read.k21(db, { asOf: today() }));
    expect([k21.active, k21.churned, k21.churn, k21.dormantDays]).toEqual([{ kind: "count", value: 7 }, { kind: "count", value: 0 }, { kind: "ratio", num: 0, den: 7 }, 90]);
    // ── K22 LTV top patients (cumulative K3 per patient to `to`): DP-patient 1,500,000 + 3,000,000 = 4,500,000; S11 3,000,000; S3b 1,900,000;
    //   J5/J6 1,650,000; S2 1,500,000; PKP 300,000; consultation 200,000; G-Q4 150,000; promo 90,000 (top-up patient: no sale) ──
    const k22 = await as(OWN, (db) => read.k22(db, { asOf: today() }));
    expect(k22.map((x) => [x.patient, x.ltv])).toEqual([[F.pDP, 4_500_000], [F.pS11, 3_000_000], [F.pS3b, 1_900_000], [F.pSERAH, 1_650_000], [F.pS2, 1_500_000],
      [F.pTAX, 300_000], [F.pKON, 200_000], [F.pGQ4, 150_000], [F.pPROMO, 90_000]]);
    // ── K23 per shift (0130: an invoice belongs to the shift of its issuing cashier open at its issue instant): the FO shift at b1 auto-opened at
    //   the FIRST counter payment (S2's EDC, 0101 payments_shift), so the S2 invoice (issued just before) has no shift ("Tanpa shift"); every
    //   later b1 invoice (all FO's) is in the shift. Shift: K3 13,290,000 − 1,500,000 = 11,790,000; K1 = every payment (all stamped) 11,090,000.
    //   Tanpa shift at b1: K3 1,500,000, K1 0 ──
    const k23 = await as(OWN, (db) => read.k23(db, D));
    expect(k23.rows.map((x) => [x.shift !== null, x.branch, x.k3, x.k1])).toEqual([
      [true, b1, { kind: "money", rupiah: 11_790_000 }, { kind: "money", rupiah: 11_090_000 }], [false, b1, { kind: "money", rupiah: 1_500_000 }, { kind: "money", rupiah: 0 }]]);
    // ── K24 Waktu tunggu apotek: the two handed dispensings (J6 linked, G-Q4); median of the two waits = their mean, half away from zero; the
    //   waits are wall-clock facts of this run, read back from the rows (seconds, rounded as calculators.secs) ──
    const waits = (await h.admin.query(`select round(extract(epoch from handed_at - queued_at))::int s from dispensings where tenant_id = $1 and state = 'handed' order by 1`, [tenantId])).rows.map((x: { s: number }) => x.s);
    expect(waits).toHaveLength(2);
    expect(await as(OWN, (db) => read.k24(db, D))).toEqual({ kind: "duration", seconds: Math.sign(waits[0] + waits[1]) * Math.round(Math.abs(waits[0] + waits[1]) / 2) });
    // ── K25 promo: M8-HEMAT v1 — 1 use, discount 10,000, K3 of the line 90,000 ──
    const k25 = await as(OWN, (db) => read.k25(db, D));
    expect(k25.rows.map((x) => [k25.labels.get(x.version), x.uses, x.discount, x.k3])).toEqual([["M8-HEMAT v1", { kind: "count", value: 1 }, { kind: "money", rupiah: 10_000 }, { kind: "money", rupiah: 90_000 }]]);
    // ── K26 Kepuasan: scores 5 and 2 → average 3.50 (350 hundredths), ≤ 2 share 1 of 2 ──
    expect(await as(OWN, (db) => read.k26(db, D))).toEqual({ average: { kind: "score", hundredths: 350 }, low: { kind: "ratio", num: 1, den: 2 }, responses: { kind: "count", value: 2 } });
    // ── K27 Aktivitas dokter: DOC signed the examinations of S2, S3b, S11 b1, S11 b2, DP and J5/J6 (6, signed in visitWith); the consultation
    //   exam is a draft younger than 24 h (not counted); one clinical request decided by DOC as doctor (the S3b addition) ──
    const k27 = await as(OWN, (db) => read.k27(db, D));
    expect(k27.rows.map((x) => [x.doctor, x.signed, x.unsignedOver24h, x.requestsDecided])).toEqual([[DOC.staffId, { kind: "count", value: 6 }, { kind: "count", value: 0 }, { kind: "count", value: 1 }]]);
    // median check-in → signature, EXACT: computed here from the six (visit check-in, examination signature) pairs read from their own rows,
    // independently of report_k27 / calculators.k27 (seconds = round(ms / 1000) per pair; even count → mean of the two middle values, half away
    // from zero). The check-ins were set 90 / 70 / 50 / 30 / 20 / 10 minutes before their signing step (S2, S3b, S11 b1, S11 b2, DP, J5/J6),
    // so the middle pair is ≈ 50 and ≈ 30 min: the median is ≈ 40 min — never 0 (a constant), never the mean ≈ 45 min, never the first / last.
    const pairs = (await h.admin.query(`select v.id, round(extract(epoch from (e.signed_at - v.checked_in_at)) * 1000)::bigint::text ms
        from examinations e join visits v on v.tenant_id = e.tenant_id and v.id = e.visit_id
       where e.tenant_id = $1 and e.state = 'signed' order by 2`, [tenantId])).rows as { id: string; ms: string }[];
    expect(pairs.map((x) => x.id).sort()).toEqual([F.vS2, F.vS3b, F.vS11b1, F.vS11b2, F.vDP, F.vSERAH].sort());
    const secs = pairs.map((x) => Math.round(Number(x.ms) / 1000)).sort((a, b) => a - b);
    const mid = (secs[2] + secs[3]) / 2;
    const median = Math.sign(mid) * Math.round(Math.abs(mid));
    const mean = secs.reduce((a, b) => a + b, 0) / secs.length;
    expect(median).toBeGreaterThan(39 * 60); expect(median).toBeLessThan(42 * 60); // ≈ 40 min (+ the seconds the run takes)
    expect(Math.abs(mean - median)).toBeGreaterThan(4 * 60); // the fixture separates the median from the mean (≈ 45 min)
    expect(k27.rows[0].checkInToSignature).toEqual({ kind: "duration", seconds: median });
    // ── owner-amended (pending Finance; OWNER-AMENDMENT-M8-EXIT-20261123.md §1): K4, K12, K14, K15, K17 are read here but NOT asserted as
    //    acceptance values; their reader correctness stays in tests/reporting/dashboards.test.ts (DRAFT fixture rows) ──
    for (const id of ["k4", "k12", "k14", "k15", "k17"] as const) expect((await k(id)).kpi).toBe(id);
  });

  it.todo("T-102 TD-31 (owner gate): SATUSEHAT practitioner path decided — the J3/J6 SATUSEHAT steps of the walkthrough run on recorded fixtures");
});
