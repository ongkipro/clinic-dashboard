// T-071 Done-when: scenario PR-24 (PKP switch: VAT computed and snapshotted from the date; invoices before it
// unchanged), VAT switch refused without approved tax-advice evidence (PR-97), plus the plan reviews: owner-only
// profile changes, the effective date strictly after the latest issued invoice and frozen once a PKP-era invoice
// exists, history, a PKP taxable line refused while the gate is closed, the frozen price and tax snapshot (PR-42),
// the 12-month turnover monitor, roles, branches, tenants, replays and guards. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { publish } from "../../src/modules/catalog/catalog";
import { setBranchPrice } from "../../src/modules/catalog/prices/prices";
import { getInvoice, issueInvoice, openInvoice } from "../../src/modules/cashier/invoice/invoice";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { getTaxProfile, setTaxProfile, TaxError } from "../../src/modules/tax/tax";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Pajak Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, $3) returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("P1", "Asia/Jakarta"), b2: await br("P2", "Asia/Makassar") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`pjk${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Pajak ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof TaxError ? `${e.code}:${e.reason}` : e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const today = (tz = "Asia/Jakarta") => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const plus = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const NPWP = "012345678901234";
const pdf = () => Buffer.from(`%PDF-1.7\nsaran pajak ${++n}\n%%EOF\n`);
async function approveTaxAdvice(t: T) {
  const fin = await person(t, "finance");
  const own = await person(t, "owner");
  const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf(), expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
  const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
  await as(own, (db) => decideEvidence(db, item, fileId, "approved"));
  return item as string;
}
// Move an issued invoice's issue time back a day on the owner connection: the documented stand-in for "issued
// yesterday" (plan r2: no backdating input on the money writer). The guard is off only for this one update.
async function issuedYesterday(invoiceId: string) {
  await h.admin.query("begin");
  await h.admin.query("alter table invoices disable trigger invoices_guard");
  await h.admin.query(`update invoices set issued_at = issued_at - interval '1 day' where id = $1`, [invoiceId]);
  await h.admin.query("alter table invoices enable always trigger invoices_guard");
  await h.admin.query("commit");
}
const lines = async (invoiceId: string) =>
  (await h.admin.query(`select unit_price::bigint p, quantity q, discount::bigint d, line_total::bigint t, tax_category c, vat_base::bigint b, vat_amount::bigint v
                          from invoice_lines where invoice_id = $1 order by created_at, id`, [invoiceId])).rows.map((r) => ({ p: Number(r.p), q: r.q, d: Number(r.d), t: Number(r.t), c: r.c, b: Number(r.b), v: Number(r.v) }));

let A: T; let B: T;
let OWN: P; let FIN: P; let MGR: P; let FO: P; let AP: P; let AU: P; let PH: P; let BOWN: P;
let facial: string; let serum: string; let consult: string; let gift: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AP = await person(A, "admin_pusat"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1); PH = await person(A, "pharmacist", A.b1);
  BOWN = await person(B, "owner");
  // Products publish active at once (a new service waits for the clinical review, DEC-046); the tax category is what
  // the snapshot reads, so a product per category covers every case.
  const item = async (c: string, name: string, tax: string, price: number) =>
    (await as(OWN, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: tax, tax_basis: "Dasar uji", normal_price: price } as never, "Baru"))).itemId;
  facial = await item("PJ-FAC", "Masker Wajah (jasa non-medis)", "taxable_service", 333_000);
  serum = await item("PJ-SRM", "Serum Pajak", "taxable_goods", 222_000);
  consult = await item("PJ-KON", "Obat Resep", "exempt_medical", 150_000);
  gift = await item("PJ-VCH", "Voucher Hadiah", "non_object", 100_000);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-24: VAT gated by tax advice (PR-97)", () => {
  it("a PKP switch without approved tax advice is refused until the advice is recorded; then accepted", async () => {
    const C = await tenant();
    const cown = await person(C, "owner");
    expect(await why(as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: plus(today(), 1), npwp: NPWP, reason: "Terdaftar PKP" })))).toBe("ERR_GATE_CLOSED:vat_on_invoices");
    expect((await h.admin.query(`select is_pkp from tenants where id = $1`, [C.tenantId])).rows[0].is_pkp).toBe(false);
    expect((await h.admin.query(`select count(*)::int n from tax_profile_changes where tenant_id = $1`, [C.tenantId])).rows[0].n).toBe(0);
    await approveTaxAdvice(C);
    const { changeId } = await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: plus(today(), 1), npwp: NPWP, reason: "Terdaftar PKP" }));
    expect((await h.admin.query(`select is_pkp, pkp_effective_from::text f, npwp from tenants where id = $1`, [C.tenantId])).rows[0]).toEqual({ is_pkp: true, f: plus(today(), 1), npwp: NPWP });
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 and type = 'TaxProfileChanged'`, [C.tenantId])).rows;
    expect(ev).toEqual([{ type: "TaxProfileChanged", payload: { tenant_id: C.tenantId, change_id: changeId } }]);
    expect((await h.admin.query(`select reason_code from audit_events where object_id = $1`, [changeId])).rows.map((r) => r.reason_code)).toEqual(["tax_profile_changed"]);
  });
});

describe("scenario PR-24: PKP switch", () => {
  it("an invoice before the PKP date has no VAT and stays unchanged; an invoice on the date computes and snapshots VAT", async () => {
    await approveTaxAdvice(A);
    // Invoice 1 while non-PKP (issued "yesterday" via the documented stand-in).
    const { invoiceId: i1 } = await as(FO, (db) => openInvoice(db, key(), null));
    const r1 = await as(FO, (db) => issueInvoice(db, key(), i1, [{ itemId: facial, quantity: 1 }, { itemId: serum, quantity: 2 }, { itemId: consult, quantity: 1 }]));
    expect(r1.is_pkp_at_issue).toBe(false);
    await issuedYesterday(i1);
    const before = await lines(i1);
    expect(before).toEqual([
      { p: 333_000, q: 1, d: 0, t: 333_000, c: "taxable_service", b: 333_000, v: 0 },
      { p: 222_000, q: 2, d: 0, t: 444_000, c: "taxable_goods", b: 444_000, v: 0 },
      { p: 150_000, q: 1, d: 0, t: 150_000, c: "exempt_medical", b: 150_000, v: 0 },
    ]);
    // The tenant becomes PKP from today.
    await as(OWN, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: today(), npwp: NPWP, reason: "Terdaftar PKP sejak hari ini" }));
    // A branch override in effect before invoice 2 (PR-42): the line takes the branch price, not the normal price.
    await as(OWN, (db) => setBranchPrice(db, { itemId: gift, branchId: A.b1, price: 90_000, effectiveFrom: null, reason: "Harga cabang" }));
    // Invoice 2 on the date: VAT computed and snapshotted per line (VAT-inclusive prices; exempt / non-object none).
    const { invoiceId: i2 } = await as(FO, (db) => openInvoice(db, key(), null));
    const r2 = await as(FO, (db) => issueInvoice(db, key(), i2, [{ itemId: facial, quantity: 1 }, { itemId: serum, quantity: 2, discount: 111_000 }, { itemId: consult, quantity: 1 }, { itemId: gift, quantity: 1 }]));
    expect(r2.is_pkp_at_issue).toBe(true);
    expect(await lines(i2)).toEqual([
      { p: 333_000, q: 1, d: 0, t: 333_000, c: "taxable_service", b: 300_000, v: 33_000 },
      { p: 222_000, q: 2, d: 111_000, t: 333_000, c: "taxable_goods", b: 300_000, v: 33_000 }, // VAT after discount (BILL-28)
      { p: 150_000, q: 1, d: 0, t: 150_000, c: "exempt_medical", b: 150_000, v: 0 },
      { p: 90_000, q: 1, d: 0, t: 90_000, c: "non_object", b: 90_000, v: 0 },
    ]);
    // A price that is not a multiple of 111 rounds half up in the database exactly as policy.ts does: 100,001 →
    // 90,091 + 9,910 (100,001 × 100 / 111 = 90,090.99…).
    const { invoiceId: i3 } = await as(FO, (db) => openInvoice(db, key(), null));
    await as(FO, (db) => issueInvoice(db, key(), i3, [{ itemId: facial, quantity: 1, discount: 232_999 }]));
    expect(await lines(i3)).toEqual([{ p: 333_000, q: 1, d: 232_999, t: 100_001, c: "taxable_service", b: 90_091, v: 9_910 }]);
    // Invoice 1 is unchanged.
    expect(await lines(i1)).toEqual(before);
    expect((await h.admin.query(`select is_pkp_at_issue from invoices where id = $1`, [i1])).rows[0].is_pkp_at_issue).toBe(false);
    // The snapshot survives a later price change and a catalog edit (PR-42 "keeps it after later price changes").
    await as(OWN, (db) => setBranchPrice(db, { itemId: serum, branchId: A.b1, price: 999_000, effectiveFrom: null, reason: "Harga baru cabang" }));
    expect((await as(FIN, (db) => getInvoice(db, i2))).lines[1]).toMatchObject({ unit_price: 222_000, vat_amount: 33_000 });
  });

  it("the effective date: strictly after the latest issued invoice, at most 366 days ahead; frozen once a PKP-era invoice exists", async () => {
    // A is PKP from today with an invoice issued today: moving or ending PKP is refused.
    expect(await why(as(OWN, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: plus(today(), 5), npwp: NPWP, reason: "Geser tanggal" })))).toBe("ERR_VERSION_CONFLICT:pkp_era_has_invoices");
    expect(await why(as(OWN, (db) => setTaxProfile(db, key(), { isPkp: false, reason: "Salah input" })))).toBe("ERR_VERSION_CONFLICT:pkp_era_has_invoices");
    // NPWP only: always allowed.
    await as(OWN, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: today(), npwp: "0123456789012345", reason: "NPWP 16 digit" }));
    expect((await h.admin.query(`select npwp from tenants where id = $1`, [A.tenantId])).rows[0].npwp).toBe("0123456789012345");
    // A fresh tenant with a non-PKP invoice issued today: PKP from today is refused (not strictly after), tomorrow
    // is accepted; more than 366 days ahead is refused; before any PKP-era invoice, ending PKP is a correction.
    const C = await tenant();
    const cown = await person(C, "owner");
    const cfo = await person(C, "fo_cashier", C.b1);
    await approveTaxAdvice(C);
    const cfacial = (await as(cown, (db) => publish(db, { kind: "product", code: "PJ-C1" }, { name: "Krim C", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 111_000 } as never, "Baru"))).itemId;
    const { invoiceId } = await as(cfo, (db) => openInvoice(db, key(), null));
    await as(cfo, (db) => issueInvoice(db, key(), invoiceId, [{ itemId: cfacial, quantity: 1 }]));
    expect(await why(as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: today(), npwp: NPWP, reason: "PKP" })))).toBe("ERR_VERSION_CONFLICT:pkp_effective_from");
    expect(await why(as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: plus(today(), 400), npwp: NPWP, reason: "PKP" })))).toBe("ERR_VERSION_CONFLICT:pkp_effective_from");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: plus(today(), 1), npwp: NPWP, reason: "PKP besok" }));
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: false, reason: "Koreksi: belum PKP" })); // no PKP-era invoice yet
    expect((await h.admin.query(`select is_pkp, pkp_effective_from from tenants where id = $1`, [C.tenantId])).rows[0]).toEqual({ is_pkp: false, pkp_effective_from: null });
    // Input checks.
    for (const bad of [{ isPkp: true, reason: "PKP" }, { isPkp: true, pkpEffectiveFrom: "2026-02-30", npwp: NPWP, reason: "PKP" }, { isPkp: false, pkpEffectiveFrom: today(), reason: "x y z" },
      { isPkp: false, npwp: "12345", reason: "NPWP" }, { isPkp: false, reason: "x" }])
      expect(await code(as(cown, (db) => setTaxProfile(db, key(), bad as never))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    const D = await tenant();
    const down = await person(D, "owner");
    await approveTaxAdvice(D);
    expect(await why(as(down, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: today(), reason: "PKP tanpa NPWP" })))).toBe("ERR_INVALID_INPUT:npwp_required");
  });

  it("history decides: tax_pkp_at follows the change in force at an instant, per branch timezone", async () => {
    const C = await tenant();
    const cown = await person(C, "owner");
    await approveTaxAdvice(C);
    const t0 = new Date();
    // Two days ahead, not one: every instant probed below must come after the change was recorded. With "tomorrow"
    // the 23:01 WIB probe is still today, and between 23:01 and 24:00 WIB it precedes the change, so the history
    // rightly says nothing was in force yet (close run 1 failed this way at 23:01 WIB).
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: plus(today(), 2), npwp: NPWP, reason: "PKP lusa" }));
    const at = async (when: Date, branch: string) => (await h.admin.query(`select tax_pkp_at($1, $2, $3) r`, [C.tenantId, when, branch])).rows[0].r as boolean;
    expect(await at(t0, C.b1)).toBe(false); // before the change existed
    expect(await at(new Date(), C.b1)).toBe(false); // today is before the date
    const dayWib = new Date(`${plus(today(), 2)}T00:00:00+07:00`);
    expect(await at(new Date(dayWib.getTime() + 60_000), C.b1)).toBe(true);
    expect(await at(new Date(dayWib.getTime() - 3_600_000 + 60_000), C.b2)).toBe(true); // 00:01 WITA = 23:01 WIB the day before
    expect(await at(new Date(dayWib.getTime() - 3_600_000 + 60_000), C.b1)).toBe(false);
    // A PKP change scheduled ahead does not make today's invoice PKP (the date decides, not today's flag).
    const cfo = await person(C, "fo_cashier", C.b1);
    const p = (await as(cown, (db) => publish(db, { kind: "product", code: "PJ-H1" }, { name: "Krim H", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 111_000 } as never, "Baru"))).itemId;
    const { invoiceId } = await as(cfo, (db) => openInvoice(db, key(), null));
    const r = await as(cfo, (db) => issueInvoice(db, key(), invoiceId, [{ itemId: p, quantity: 1 }]));
    expect(r.is_pkp_at_issue).toBe(false);
    expect(await lines(invoiceId)).toEqual([{ p: 111_000, q: 1, d: 0, t: 111_000, c: "taxable_goods", b: 111_000, v: 0 }]);
    const hist = (await as(cown, getTaxProfile)).history;
    expect(hist.map((x) => [x.is_pkp, x.reason])).toEqual([[true, "PKP lusa"]]);
    // tax_pkp_at reads the change in force at the instant: a moment before the change was made, even a change
    // effective in the past would not apply (seeded on the owner connection: a past effective date and a change time).
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 30 where tenant_id = $1`, [C.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    expect(await at(new Date(t0.getTime() - 60_000), C.b1)).toBe(false); // before the change was recorded
    expect(await at(new Date(), C.b1)).toBe(true);
  });
});

describe("the VAT gate on lines (open point 3)", () => {
  it("while PKP, a taxable line is refused when the tax advice is revoked; exempt lines still issue", async () => {
    const C = await tenant();
    const cown = await person(C, "owner");
    const cfo = await person(C, "fo_cashier", C.b1);
    const advice = await approveTaxAdvice(C);
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: today(), npwp: NPWP, reason: "PKP" }));
    const p = (await as(cown, (db) => publish(db, { kind: "product", code: "PJ-G1" }, { name: "Krim G", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 111_000 } as never, "Baru"))).itemId;
    const e = (await as(cown, (db) => publish(db, { kind: "product", code: "PJ-G2" }, { name: "Obat G", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 50_000 } as never, "Baru"))).itemId;
    const file = (await h.admin.query(`select id from evidence_files where item_id = $1 order by version desc limit 1`, [advice])).rows[0].id;
    await as(cown, (db) => decideEvidence(db, advice, file, "revoked", "Saran ditarik"));
    const { invoiceId } = await as(cfo, (db) => openInvoice(db, key(), null));
    expect(await why(as(cfo, (db) => issueInvoice(db, key(), invoiceId, [{ itemId: e, quantity: 1 }, { itemId: p, quantity: 1 }])))).toBe("ERR_GATE_CLOSED:vat_on_invoices");
    expect((await h.admin.query(`select count(*)::int n from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].n).toBe(0); // all or nothing
    const r = await as(cfo, (db) => issueInvoice(db, key(), invoiceId, [{ itemId: e, quantity: 1 }]));
    expect(r.is_pkp_at_issue).toBe(true);
    expect(await lines(invoiceId)).toEqual([{ p: 50_000, q: 1, d: 0, t: 50_000, c: "exempt_medical", b: 50_000, v: 0 }]);
  });
});

describe("turnover monitor (PR-24, A-07)", () => {
  it("12-month issued turnover; warning only for a non-PKP tenant: none, near from 4.0 billion, over from 4.8 billion", async () => {
    const C = await tenant();
    const cown = await person(C, "owner");
    const cfo = await person(C, "fo_cashier", C.b1);
    const big = (await as(cown, (db) => publish(db, { kind: "product", code: "PJ-B1" }, { name: "Paket Alat", tax_category: "non_object", tax_basis: "Uji", normal_price: 1_000_000_000 } as never, "Baru"))).itemId;
    const issue = async (q: number) => {
      const { invoiceId } = await as(cfo, (db) => openInvoice(db, key(), null));
      await as(cfo, (db) => issueInvoice(db, key(), invoiceId, [{ itemId: big, quantity: q }]));
      return invoiceId;
    };
    expect((await as(cown, getTaxProfile))).toMatchObject({ turnover_12m: 0, warning: "none", is_pkp: false });
    const old = await issue(3);
    await h.admin.query("alter table invoices disable trigger invoices_guard");
    await h.admin.query(`update invoices set issued_at = now() - interval '12 months' where id = $1`, [old]); // exactly 12 months ago: outside
    await h.admin.query("alter table invoices enable always trigger invoices_guard");
    expect((await as(cown, getTaxProfile)).turnover_12m).toBe(0);
    await issue(4);
    expect((await as(cown, getTaxProfile))).toMatchObject({ turnover_12m: 4_000_000_000, warning: "near" });
    const draft = (await as(cfo, (db) => openInvoice(db, key(), null))).invoiceId; // drafts do not count
    void draft;
    await issue(1);
    expect((await as(cown, getTaxProfile))).toMatchObject({ turnover_12m: 5_000_000_000, warning: "over" });
    await approveTaxAdvice(C);
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: plus(today(), 1), npwp: NPWP, reason: "PKP" }));
    expect((await as(cown, getTaxProfile)).warning).toBe("none"); // already PKP
  });
});

describe("authority, tenants, guards", () => {
  it("the owner changes the profile; owner, finance, admin pusat and auditor read; others refused", async () => {
    for (const p of [FIN, AP, AU, MGR, FO, PH]) expect(await code(as(p, (db) => setTaxProfile(db, key(), { isPkp: false, npwp: NPWP, reason: "Coba" }))), p.role).toBe("ERR_FORBIDDEN");
    for (const p of [OWN, FIN, AP, AU]) expect((await as(p, getTaxProfile)).can_change, p.role).toBe(p === OWN);
    for (const p of [MGR, FO, PH]) expect(await code(as(p, getTaxProfile)), p.role).toBe("ERR_FORBIDDEN");
    expect((await as(BOWN, getTaxProfile)).npwp).toBeNull(); // B sees only B
  });

  it("invoices: owner, manager, FO and finance issue; a branch role at its active branch; another branch's or tenant's invoice is not found", async () => {
    for (const p of [AP, AU, PH]) expect(await code(as(p, (db) => openInvoice(db, key(), A.b1))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => openInvoice(db, key(), A.b2)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(OWN, (db) => openInvoice(db, key(), null)))).toBe("ERR_NOT_FOUND"); // a tenant-wide role names a branch
    expect(await code(as(OWN, (db) => openInvoice(db, key(), B.b1)))).toBe("ERR_NOT_FOUND");
    const { invoiceId: other } = await as(OWN, (db) => openInvoice(db, key(), A.b2));
    expect(await code(as(FO, (db) => issueInvoice(db, key(), other, [{ itemId: consult, quantity: 1 }])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => issueInvoice(db, key(), other, [{ itemId: consult, quantity: 1 }])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => getInvoice(db, other)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => getInvoice(db, other)))).toBe("ERR_FORBIDDEN");
    // Lines: an unknown item, a material, a bad quantity or discount are refused; a replay returns the same result.
    const { invoiceId } = await as(FO, (db) => openInvoice(db, key(), null));
    expect(await code(as(FO, (db) => issueInvoice(db, key(), invoiceId, [{ itemId: crypto.randomUUID(), quantity: 1 }])))).toBe("ERR_NOT_FOUND");
    for (const l of [{ itemId: consult, quantity: 0 }, { itemId: consult, quantity: 10001 }, { itemId: consult, quantity: 1.5 }])
      expect(await code(as(FO, (db) => issueInvoice(db, key(), invoiceId, [l]))), JSON.stringify(l)).toBe("ERR_INVALID_INPUT");
    expect(await why(as(FO, (db) => issueInvoice(db, key(), invoiceId, [{ itemId: consult, quantity: 2, discount: 300_001 }])))).toBe("ERR_INVALID_INPUT:discount");
    expect(await code(as(FO, (db) => issueInvoice(db, key(), invoiceId, [])))).toBe("ERR_INVALID_INPUT");
    const k = key();
    const r1 = await as(FO, (db) => issueInvoice(db, k, invoiceId, [{ itemId: consult, quantity: 1 }]));
    const r2 = await as(FO, (db) => issueInvoice(db, k, invoiceId, [{ itemId: consult, quantity: 1 }]));
    expect([r2.invoice_id, r2.replayed]).toEqual([r1.invoice_id, true]);
    expect(await code(as(FO, (db) => issueInvoice(db, key(), invoiceId, [{ itemId: consult, quantity: 1 }])))).toBe("ERR_VERSION_CONFLICT");
  });

  it("a visit's invoice is the visit's patient's; a merged patient is refused", async () => {
    const pid = async () => {
      const id = crypto.randomUUID().replace(/-/g, "");
      return (await h.admin.query(
        `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                               marital_status, registered_branch_id, created_by, created_as)
         values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Pajak', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2, $5, 'fo_cashier') returning id`,
        [A.tenantId, A.b1, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), FO.staffId])).rows[0].id as string;
    };
    const p1 = await pid();
    const p2 = await pid();
    const v1 = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [A.tenantId, A.b1, p1, FO.staffId])).rows[0].id;
    expect(await code(as(FO, (db) => openInvoice(db, key(), null, { patientId: p2, visitId: v1 })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => openInvoice(db, key(), null, { visitId: v1 })))).toBe("ERR_INVALID_INPUT");
    const { invoiceId } = await as(FO, (db) => openInvoice(db, key(), null, { patientId: p1, visitId: v1 }));
    expect(invoiceId).toBeTruthy();
    // A merge row as the records writer leaves it (seeded on the owner connection with the guard off: the merge
    // writer's preconditions are T-040's, not this task's).
    await h.admin.query("alter table patient_merges disable trigger patient_merges_guard");
    await h.admin.query(`insert into patient_merges (tenant_id, survivor_id, merged_id, reason, merged_by, merged_as) values ($1, $2, $3, 'Duplikat uji', $4, 'records_officer')`,
      [A.tenantId, p1, p2, FO.staffId]);
    await h.admin.query("alter table patient_merges enable always trigger patient_merges_guard");
    expect(await why(as(FO, (db) => openInvoice(db, key(), null, { patientId: p2 })))).toBe("ERR_VERSION_CONFLICT:patient_merged");
  });

  it("guards on the owner connection: tax history insert-only; tenant tax fields only through the writer; issued invoices and lines frozen; nothing deleted", async () => {
    const ch = (await h.admin.query(`select id from tax_profile_changes limit 1`)).rows[0].id;
    expect(await raw(`update tax_profile_changes set reason = 'x y z' where id = $1`, [ch])).toBe("raw:42501");
    expect(await raw(`delete from tax_profile_changes where id = $1`, [ch])).toBe("raw:42501");
    expect(await raw(`update tenants set is_pkp = false, pkp_effective_from = null where id = $1`, [A.tenantId])).toBe("raw:42501");
    expect(await raw(`update tenants set npwp = '999999999999999' where id = $1`, [A.tenantId])).toBe("raw:42501");
    expect(await raw(`update tenants set legal_name = 'PT Pajak Sintetis Baru' where id = $1`, [A.tenantId])).toBe("ok");
    const inv = (await h.admin.query(`select id from invoices where tenant_id = $1 and state = 'issued' limit 1`, [A.tenantId])).rows[0].id;
    expect(await raw(`update invoices set is_pkp_at_issue = not is_pkp_at_issue where id = $1`, [inv])).toBe("raw:42501");
    expect(await raw(`update invoices set state = 'draft', issued_at = null, issued_by = null, issued_as = null, is_pkp_at_issue = null where id = $1`, [inv])).toBe("raw:42501");
    expect(await raw(`delete from invoices where id = $1`, [inv])).toBe("raw:42501");
    expect(await raw(`update invoice_lines set unit_price = unit_price + 1, line_total = line_total + 1, vat_base = vat_base + 1 where invoice_id = $1`, [inv])).toBe("raw:42501");
    expect(await raw(`update invoice_lines set tax_category = 'exempt_medical' where invoice_id = $1 and tax_category = 'exempt_medical'`, [inv])).toBe("ok");
    expect(await raw(`update invoice_lines set tax_basis = 'Diubah' where invoice_id = $1`, [inv])).toBe("raw:42501");
    // the frozen unit price alone, with everything else kept consistent: quantity 2 at half the price, same total
    const evenLine = (await h.admin.query(`select l.id from invoice_lines l where l.invoice_id = $1 and l.quantity = 1 and l.unit_price % 2 = 0 and l.discount = 0 limit 1`, [inv])).rows[0]?.id;
    expect(evenLine, "an even-priced single line in the issued invoice").toBeTruthy();
    expect(await raw(`update invoice_lines set quantity = 2, unit_price = unit_price / 2 where id = $1`, [evenLine])).toBe("raw:42501");
    expect(await raw(`delete from invoice_lines where invoice_id = $1`, [inv])).toBe("raw:42501");
    expect(await raw(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
                      select tenant_id, branch_id, invoice_id, item_id, catalog_version_id, 1, 1, 1, tax_category, tax_basis, 1, 0 from invoice_lines where invoice_id = $1 limit 1`, [inv])).toBe("raw:42501");
    const draft = (await as(FO, (db) => openInvoice(db, key(), null))).invoiceId;
    expect(await raw(`update invoices set state = 'issued', issued_at = now(), issued_by = created_by, issued_as = 'owner', is_pkp_at_issue = false where id = $1`, [draft])).toBe("raw:42501"); // no line
    // Refused either way: by the no-truncate trigger, or first by the foreign keys that reference the lines (the Kasir's
    // allocations and counter dispensings, T-072).
    expect(await raw(`truncate invoice_lines`, [])).toMatch(/^raw:(42501|0A000)$/);
    // RLS: the cashier roles read invoices through T-072's readers; here owner, finance and auditor only.
    expect((await as(FO, (db) => db.query(`select id from invoices`))).rows).toEqual([]);
    expect((await as(FIN, (db) => db.query(`select id from invoices where id = $1`, [inv]))).rows).toHaveLength(1);
    expect((await as(BOWN, (db) => db.query(`select id from invoices where id = $1`, [inv]))).rows).toEqual([]);
  });
});
