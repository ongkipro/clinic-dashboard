// T-106 Done-when: Scenario PR-98 (a PKP tenant without approved tax-advice evidence: the Coretax export is unavailable and names the
// missing evidence) and the generated XML checked against the vendored DJP fixtures (tests/accounting/fixtures/coretax, PROVENANCE.md):
// RetailInvoiceBulk (digunggung) element order per the DJP XSD, OutputSpecialDocReturn per its XSD, TaxInvoiceBulk per DJP's sample. Plus
// Panel 2 decisions 2–5: no patient identity in any document; frozen snapshot values only (VAT = the line's frozen VAT, DPP Nilai Lain =
// ROUND(11/12 × DPP)); a void inside the month leaves the digunggung document and enters the cancellation register, a void of an earlier
// month's invoice is listed as reported in that month; a paid refund that reversed VAT is a return row; the export log (SHA-256 of the
// exact bytes, append-only), audit of every refusal and download, no write of tax_document_ref; roles; cross-tenant. Synthetic data (MIG-2).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { coretaxStatus, exportCoretax } from "../../src/modules/accounting/coretax/coretax";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { issueKasirInvoice, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { requestRefund } from "../../src/modules/cashier/receivables/receivables";
import { publish } from "../../src/modules/catalog/catalog";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { changeSetting } from "../../src/modules/settings/settings";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

const FIX = join(import.meta.dirname, "fixtures", "coretax");
const fixture = (f: string) => readFileSync(join(FIX, f), "utf8");

// ── A dependency-free XML reader (enough for these flat documents: elements, text, self-closing, comments, declaration) ─────────────────
type El = { name: string; attrs: Record<string, string>; children: El[]; text: string };
function parseXml(src: string): El {
  const s = src.replace(/^\uFEFF/, "").replace(/<\?xml[^?]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const root: El = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: El[] = [root];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s))) {
    if (m.index !== consumed) throw new Error(`unparsed at ${consumed}: ${s.slice(consumed, consumed + 40)}`);
    consumed = re.lastIndex;
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.text += m[5].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
      continue;
    }
    if (m[1]) {
      if (top.name !== m[2]) throw new Error(`mismatched </${m[2]}> in <${top.name}>`);
      stack.pop();
      continue;
    }
    const attrs = Object.fromEntries([...m[3].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const el: El = { name: m[2], attrs, children: [], text: "" };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  if (consumed !== s.length || stack.length !== 1) throw new Error("unbalanced document");
  const els = root.children;
  if (els.length !== 1 || root.text.trim() !== "") throw new Error("one root element expected");
  return els[0];
}
const kids = (e: El) => e.children.map((c) => c.name);
const one = (e: El, n: string) => {
  const xs = e.children.filter((c) => c.name === n);
  if (xs.length !== 1) throw new Error(`${e.name}/${n}: ${xs.length}`);
  return xs[0];
};
const txt = (e: El, n: string) => one(e, n).text;
// The element sequence of a complexType in an Excel-exported xs:schema: name → its children in order (nested sequences only).
function xsdSequences(xsd: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const root = parseXml(xsd);
  const walk = (el: El) => {
    if (el.name === "xs:element" && el.attrs.name) {
      const seq = el.children.find((c) => c.name === "xs:complexType")?.children.find((c) => c.name === "xs:sequence");
      if (seq) out.set(el.attrs.name, seq.children.filter((c) => c.name === "xs:element").map((c) => c.attrs.name));
    }
    el.children.forEach(walk);
  };
  walk(root);
  return out;
}
// Structural validation against a DJP schema: every element with a sequence has exactly that sequence (each element once, in order);
// a list element (the one maxOccurs="unbounded") may repeat. Returns the violations.
function validate(doc: El, seqs: Map<string, string[]>, repeated: string): string[] {
  const bad: string[] = [];
  const walk = (e: El) => {
    const seq = seqs.get(e.name);
    if (!seq) {
      if (e.children.length) bad.push(`${e.name}: unexpected children ${kids(e).join(",")}`);
      return;
    }
    const k = kids(e);
    const want = seq.length === 1 && seq[0] === repeated ? k.map(() => repeated) : seq;
    if (k.length === 0 || JSON.stringify(k) !== JSON.stringify(want)) bad.push(`${e.name}: ${k.join(",")} ≠ ${want.join(",")}`);
    e.children.forEach(walk);
  };
  walk(doc);
  return bad;
}
const INT = /^(0|[1-9]\d*)$/;

// ── fixture people and facts ────────────────────────────────────────────────────────────────────────────────────────────────────────────
let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor"];
const NPWP = "012345678901234";
const PATIENT = "Pasien Coretax Rahasia";
const NIK = "3171012345678901";

let codes = 0;
async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const b1 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $2, 'Asia/Jakarta', 'Jl. Uji 1') returning id`, [tenantId, `CT${++codes}`])).rows[0].id as string;
  return { tenantId, b1 };
}
async function person(t: T, role: Role): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ctx${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Pajak ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: t.b1 });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.message}`));
const wib = (ms = 0) => new Date(Date.now() + ms).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const today = () => wib();
const month = () => today().slice(0, 7);
const prevMonth = (m = month()) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
async function patient(t: T): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $4, '1990-01-01', 'female', 'nik', $2, $3, 'islam', 'Karyawan', 's1', 'kawin', $5,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, `v1.1.${id}.${NIK}.${id}`, (id + id).slice(0, 43), PATIENT, t.b1])).rows[0].id as string;
}
// Move an invoice's facts into the previous month (the writers stamp clock_timestamp()): guards bypassed only for this fixture surgery.
async function backdate(table: string, set: string, where: string, args: unknown[]) {
  const tg = (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [table])).rows.map((r) => r.tgname as string);
  for (const g of tg) await h.admin.query(`alter table ${table} disable trigger ${g}`);
  try { await h.admin.query(`update ${table} set ${set} where ${where}`, args); } finally { for (const g of tg) await h.admin.query(`alter table ${table} enable always trigger ${g}`); }
}
async function evidence(fin: P, own: P, label: string) {
  const pdf = Buffer.from(`%PDF-1.7\nsaran ${label}\n%%EOF\n`);
  const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
  const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id as string;
  await as(own, (db) => decideEvidence(db, item, fileId, "approved"));
  return { item, fileId };
}
// PKP for 40 days (the history decides tax_pkp_at); the profile writer itself needs the vat_on_invoices gate (the same tax-advice evidence).
async function makePkp(t: T, own: P) {
  await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
  await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
  try {
    await as(own, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: wib(86_400_000), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 70, changed_at = now() - interval '75 days' where tenant_id = $1`, [t.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 70 where id = $1`, [t.tenantId, today()]);
  } finally {
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
  }
}
async function product(own: P, code: string, name: string, price: number, tax: string) {
  return (await as(own, (db) => publish(db, { kind: "product", code }, { name, tax_category: tax, tax_basis: "Barang", normal_price: price } as never, "Produk"))).itemId;
}
async function sell(fo: P, t: T, lines: { itemId: string; quantity: number; discount?: number }[], pay = true) {
  const pid = await patient(t);
  const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
  await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, lines));
  const total = Number((await h.admin.query(`select coalesce(sum(line_total), 0) s from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].s);
  if (pay && total > 0) await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: total, cashTendered: total }]));
  const ls = (await h.admin.query(`select id, vat_base::bigint base, vat_amount::bigint vat, tax_category from invoice_lines where invoice_id = $1 order by created_at, id`, [invoiceId])).rows
    .map((r) => ({ id: r.id as string, base: Number(r.base), vat: Number(r.vat), cat: r.tax_category as string }));
  const number = (await h.admin.query(`select number from invoices where id = $1`, [invoiceId])).rows[0].number as string;
  return { invoiceId, pid, lines: ls, number };
}
const exp = (p: P, period: string, kind: "retail" | "faktur" | "retur" | "pembatalan") => as(p, (db) => exportCoretax(db, { period, kind }));
const audits = async (t: T, code: string) => Number((await h.admin.query(`select count(*) c from audit_events where tenant_id = $1 and object_kind = 'coretax' and reason_code = $2`, [t.tenantId, code])).rows[0].c);

let A: T; let B: T; let C: T;
let OWN: P; let FIN: P; let AU: P; let FO: P; let MGR: P; let BFIN: P; let CFIN: P; let COWN: P; let NFIN: P;
let bSale: { number: string; base: number }; let serum: string; let jasa: string; let exempt: string; let nonobj: string; let tiny: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Coretax Sintetis");
  B = await tenant("PT Coretax Lain");
  C = await tenant("PT Tanpa Saran Pajak");
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor"); FO = await person(A, "fo_cashier"); MGR = await person(A, "manager");
  const BOWN = await person(B, "owner"); BFIN = await person(B, "finance"); const BFO = await person(B, "fo_cashier");
  COWN = await person(C, "owner"); CFIN = await person(C, "finance");
  NFIN = await person(A, "fo_cashier");
  await evidence(FIN, OWN, "A");
  await makePkp(A, OWN);
  await evidence(BFIN, BOWN, "B");
  await makePkp(B, BOWN);
  serum = await product(OWN, "CT-SRM", "Serum <Kena> & \"Pajak\"", 333_000, "taxable_goods");
  jasa = await product(OWN, "CT-JSA", "Krim Racikan", 666_000, "taxable_service");
  exempt = await product(OWN, "CT-OBT", "Obat Bebas", 111_000, "exempt_medical");
  nonobj = await product(OWN, "CT-NOB", "Voucher Bukan Objek", 50_000, "non_object");
  tiny = await product(OWN, "CT-TNY", "Kapas", 15, "taxable_goods");
  // B: one PKP sale whose amount and invoice number must never appear in A's documents
  const bItem = await product(BOWN, "CT-BRH", "Produk Rahasia B", 987_654, "taxable_goods");
  const bs = await sell(BFO, B, [{ itemId: bItem, quantity: 1 }]);
  bSale = { number: bs.number, base: bs.lines[0].base };
  // FO discount limit 0 % so a manual discount waits for approval (SET-12)
  await as(OWN, (db) => changeSetting(db, { key: "SET-12", branchId: null, value: { fo_persen: 0, manajer_persen: 10, manajer_rupiah: 500_000 }, reason: "Batas diskon uji" }));
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("Scenario PR-98: Coretax export gated", () => {
  it("a PKP tenant without approved tax-advice evidence: the export is unavailable and names the missing evidence (status and download), audited denied", async () => {
    // C: NPWP and PKP set directly (no evidence → the profile writer itself would refuse), no tax-advice evidence
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    try {
      await h.admin.query(`update tenants set npwp = $2, is_pkp = true, pkp_effective_from = $3::date - 30 where id = $1`, [C.tenantId, NPWP, today()]);
    } finally {
      await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    }
    const s = await as(CFIN, (db) => coretaxStatus(db, month()));
    expect([s.is_pkp, s.gate_open, s.block, s.missing]).toEqual([true, false, "gate_closed", ["Saran pajak (PPN per jenis layanan)"]]);
    for (const k of ["retail", "faktur", "retur", "pembatalan"] as const) {
      expect(await exp(CFIN, month(), k)).toEqual({ ok: false, refused: "gate_closed", missing: ["Saran pajak (PPN per jenis layanan)"] });
    }
    expect(await exp(COWN, month(), "retail")).toMatchObject({ ok: false, refused: "gate_closed" });
    expect(await audits(C, "coretax_gate_closed")).toBe(5);
    expect(Number((await h.admin.query(`select count(*) c from coretax_exports where tenant_id = $1`, [C.tenantId])).rows[0].c)).toBe(0);
  });

  it("the gate is its own (coretax_export → tax_advice); a revoked approval closes it again; a non-PKP tenant and a missing NPWP are refused first", async () => {
    expect((await h.admin.query(`select obligation_key from feature_gates where key = 'coretax_export'`)).rows).toEqual([{ obligation_key: "tax_advice" }]);
    // a non-PKP tenant with no PKP facts: not_pkp (the NPWP is set) — the gate is not even reached
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    try {
      await h.admin.query(`update tenants set is_pkp = false, pkp_effective_from = null where id = $1`, [C.tenantId]);
      expect(await exp(CFIN, month(), "retail")).toEqual({ ok: false, refused: "not_pkp" });
      await h.admin.query(`update tenants set npwp = null where id = $1`, [C.tenantId]);
      expect(await exp(CFIN, month(), "retail")).toEqual({ ok: false, refused: "npwp_missing" });
    } finally {
      await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    }
    expect([await audits(C, "coretax_not_pkp"), await audits(C, "coretax_npwp_missing")]).toEqual([1, 1]);
    // A (approved) is open; revoking its tax-advice approval closes the Coretax gate as well
    expect((await as(FIN, (db) => coretaxStatus(db, month()))).gate_open).toBe(true);
    const ev = (await h.admin.query(`select i.id item, f.id file from evidence_items i join evidence_files f on f.item_id = i.id where i.tenant_id = $1 and i.obligation_key = 'tax_advice' order by f.uploaded_at desc limit 1`, [A.tenantId])).rows[0];
    await as(OWN, (db) => decideEvidence(db, ev.item, ev.file, "revoked", "Dicabut untuk uji"));
    try {
      expect(await exp(FIN, month(), "retail")).toMatchObject({ ok: false, refused: "gate_closed" });
    } finally {
      await evidence(FIN, OWN, "A lagi");
    }
    expect((await as(FIN, (db) => coretaxStatus(db, month()))).gate_open).toBe(true);
  });

  it("bad and future months are refused; the kind is validated", async () => {
    expect(await exp(FIN, "2021-12", "retail")).toEqual({ ok: false, refused: "bad_period" });
    const next = new Date(`${month()}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    expect(await exp(FIN, next.toISOString().slice(0, 7), "retail")).toEqual({ ok: false, refused: "future_period" });
    expect(await exp(FIN, "2026-13", "retail")).toEqual({ ok: false, refused: "bad_period" });
    expect(await why(as(FIN, (db) => exportCoretax(db, { period: month(), kind: "spt" as never })))).toBe("ERR_INVALID_INPUT:kind");
    expect(await why(as(FIN, (db) => db.query(`select coretax_export($1, 'spt')`, [month()])))).toBe("raw:ERR_INVALID_INPUT: kind");
  });
});

describe("digunggung (RetailInvoiceBulk) from frozen snapshots, validated against the DJP XSD", () => {
  let sale: Awaited<ReturnType<typeof sell>>;
  let voided: Awaited<ReturnType<typeof sell>>;
  it("one RetailInvoice per PKP line of the month; TrxCode Normal / 08 / NoVAT; A / B; DPP, DPP Nilai Lain = ROUND(11/12 × DPP), VAT = frozen VAT; no patient identity; escaped", async () => {
    sale = await sell(FO, A, [{ itemId: serum, quantity: 2 }, { itemId: jasa, quantity: 1 }, { itemId: exempt, quantity: 1 }, { itemId: nonobj, quantity: 1 }]);
    // a same-month void: out of the digunggung document, into the cancellation register (unpaid → void directly approved by a manager)
    voided = await sell(FO, A, [{ itemId: serum, quantity: 1 }], false);
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), voided.invoiceId, "Salah input kasir"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    const r = await exp(FIN, month(), "retail");
    if (!r.ok) throw new Error(JSON.stringify(r));
    const doc = parseXml(r.xml);
    // the DJP XSD's sequences, element by element
    const seqs = xsdSequences(fixture("retail-invoice-bulk.xsd"));
    expect(seqs.get("RetailInvoiceBulk")).toEqual(["TIN", "TaxPeriodMonth", "TaxPeriodYear", "ListOfRetailInvoice"]);
    expect(validate(doc, seqs, "RetailInvoice")).toEqual([]);
    // the DJP sample has the same shape (the fixture itself validates)
    expect(validate(parseXml(fixture("retail-digunggung-sample.xml")), seqs, "RetailInvoice")).toEqual([]);
    expect(doc.attrs).toEqual({ "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance", "xsi:noNamespaceSchemaLocation": "schema.xsd" });
    expect([txt(doc, "TIN"), txt(doc, "TaxPeriodMonth"), txt(doc, "TaxPeriodYear")]).toEqual(["0" + NPWP, String(Number(month().slice(5))), month().slice(0, 4)]);
    const rows = one(doc, "ListOfRetailInvoice").children;
    const mine = rows.filter((x) => txt(x, "Info").startsWith(`${sale.number}/`));
    expect(mine.map((x) => [txt(x, "TrxCode"), txt(x, "GoodServiceOpt"), txt(x, "Info")])).toEqual([
      ["Normal", "A", `${sale.number}/1`], ["Normal", "A", `${sale.number}/2`], ["08", "A", `${sale.number}/3`], ["NoVAT", "A", `${sale.number}/4`],
    ]);
    for (const [i, x] of mine.entries()) {
      const l = sale.lines[i];
      const base = Number(txt(x, "TaxBaseSellingPrice"));
      const other = Number(txt(x, "OtherTaxBaseSellingPrice"));
      expect([base, Number(txt(x, "VAT"))]).toEqual([l.base, l.vat]); // frozen snapshot, not recomputed
      expect(other).toBe(l.vat > 0 ? Math.round((11 * base) / 12) : base);
      expect([txt(x, "BuyerName"), txt(x, "BuyerIdOpt"), txt(x, "BuyerIdNumber"), txt(x, "STLG")]).toEqual(["Konsumen Akhir", "NIK", "0000000000000000", "0"]);
      expect(txt(x, "TransactionDate")).toBe(today());
      for (const f of ["SerialNo", "TaxBaseSellingPrice", "OtherTaxBaseSellingPrice", "VAT", "STLG"]) expect(txt(x, f)).toMatch(INT);
    }
    // serials: stable, unique, YYYYMM × 10^6 + ordinal
    const serials = rows.map((x) => Number(txt(x, "SerialNo")));
    expect(new Set(serials).size).toBe(serials.length);
    expect(serials.every((s) => Math.floor(s / 1e6) === Number(month().replace("-", "")))).toBe(true);
    // the void of this month is not in the document; the totals equal its rows
    expect(rows.some((x) => txt(x, "Info").startsWith(`${voided.number}/`))).toBe(false);
    expect([r.rows, r.base, r.vat]).toEqual([rows.length, rows.reduce((s, x) => s + Number(txt(x, "TaxBaseSellingPrice")), 0), rows.reduce((s, x) => s + Number(txt(x, "VAT")), 0)]);
    // no patient identity anywhere (name, NIK, MRN), no other tenant's facts
    const mrn = (await h.admin.query(`select mrn from patients where id = $1`, [sale.pid])).rows[0].mrn as string;
    for (const secret of [PATIENT, NIK, mrn, sale.pid, bSale.number, "Produk Rahasia B"]) expect(r.xml).not.toContain(secret);
    // escaping: the item name is not in the document at all (Info is the invoice reference) — the TIN, Info and every value are plain
    expect(r.xml).not.toMatch(/<(?!\/?[A-Za-z]|\?xml)/);
    // the exact bytes are logged
    expect(r.sha256).toBe(createHash("sha256").update(r.xml, "utf8").digest("hex"));
    const log = (await h.admin.query(`select period, doc_kind, sha256, row_count::int, tax_base_total::bigint b, vat_total::bigint v, exported_as from coretax_exports where tenant_id = $1 order by exported_at desc limit 1`, [A.tenantId])).rows[0];
    expect([log.period, log.doc_kind, log.sha256, log.row_count, Number(log.b), Number(log.v), log.exported_as]).toEqual([month(), "retail", r.sha256, r.rows, r.base, r.vat, "finance"]);
    expect(await audits(A, "coretax_retail")).toBe(1);
    // no tax_document_ref was written
    expect(Number((await h.admin.query(`select count(*) c from invoice_lines where tenant_id = $1 and tax_document_ref is not null`, [A.tenantId])).rows[0].c)).toBe(0);
  });

  it("the same month exported twice gives the same bytes (deterministic) and a second log row; the log is append-only", async () => {
    const a = await exp(FIN, month(), "retail");
    const b = await exp(OWN, month(), "retail");
    if (!a.ok || !b.ok) throw new Error("refused");
    expect(b.xml).toBe(a.xml);
    expect(b.sha256).toBe(a.sha256);
    const rows = (await h.admin.query(`select id, exported_as from coretax_exports where tenant_id = $1 and sha256 = $2 order by exported_at`, [A.tenantId, a.sha256])).rows;
    expect(rows.map((r) => r.exported_as).slice(-2)).toEqual(["finance", "owner"]);
    await expect(h.admin.query(`update coretax_exports set row_count = row_count + 1 where id = $1`, [rows[0].id])).rejects.toThrow();
    await expect(h.admin.query(`delete from coretax_exports where id = $1`, [rows[0].id])).rejects.toThrow();
    await expect(h.admin.query(`truncate coretax_exports`)).rejects.toThrow();
  });

  it("a frozen VAT that differs from DJP's 12 % × DPP Nilai Lain is kept as frozen and counted (Kapas Rp15: base 14, VAT 1; DJP formula 2)", async () => {
    const s = await sell(FO, A, [{ itemId: tiny, quantity: 1 }]);
    expect(s.lines[0]).toMatchObject({ base: 14, vat: 1 });
    const st = await as(FIN, (db) => coretaxStatus(db, month()));
    expect(st.docs.retail.mismatch).toBeGreaterThanOrEqual(1);
    const r = await exp(FIN, month(), "retail");
    if (!r.ok) throw new Error("refused");
    const x = one(parseXml(r.xml), "ListOfRetailInvoice").children.find((e) => txt(e, "Info") === `${s.number}/1`)!;
    expect([txt(x, "TaxBaseSellingPrice"), txt(x, "OtherTaxBaseSellingPrice"), txt(x, "VAT")]).toEqual(["14", "13", "1"]);
    // with several invoices in the month every SerialNo is still unique (a month-wide ordinal, not per invoice)
    const serials = one(parseXml(r.xml), "ListOfRetailInvoice").children.map((e) => txt(e, "SerialNo"));
    expect(new Set(serials).size).toBe(serials.length);
    expect(serials.length).toBeGreaterThan(4);
  });

  it("a line of an invoice issued while the tenant was not PKP (is_pkp_at_issue false) is not in any Coretax document", async () => {
    const s = await sell(FO, A, [{ itemId: serum, quantity: 1 }]);
    await backdate("invoices", "is_pkp_at_issue = false", "id = $1", [s.invoiceId]);
    const r = await exp(FIN, month(), "retail");
    if (!r.ok) throw new Error("refused");
    expect(one(parseXml(r.xml), "ListOfRetailInvoice").children.some((e) => txt(e, "Info").startsWith(`${s.number}/`))).toBe(false);
  });

  it("a manual discount awaiting approval refuses the digunggung export (its snapshot is not final), named and audited; decided → exported at the final values", async () => {
    const s = await sell(FO, A, [{ itemId: serum, quantity: 1, discount: 33_000 }], false);
    const ap = (await h.admin.query(`select discount_approval_id a from invoice_lines where invoice_id = $1`, [s.invoiceId])).rows[0].a as string;
    expect(await exp(FIN, month(), "retail")).toEqual({ ok: false, refused: "discount_pending", count: 1 });
    expect(await audits(A, "coretax_discount_pending")).toBe(1);
    expect((await as(FIN, (db) => coretaxStatus(db, month()))).docs.retail.pending).toBe(1);
    await as(OWN, (db) => decideApproval(db, ap, true));
    const r = await exp(FIN, month(), "retail");
    if (!r.ok) throw new Error("refused");
    const l = (await h.admin.query(`select vat_base::bigint b, vat_amount::bigint v from invoice_lines where invoice_id = $1`, [s.invoiceId])).rows[0];
    const x = one(parseXml(r.xml), "ListOfRetailInvoice").children.find((e) => txt(e, "Info") === `${s.number}/1`)!;
    expect([Number(txt(x, "TaxBaseSellingPrice")), Number(txt(x, "VAT"))]).toEqual([Number(l.b), Number(l.v)]);
    expect(Number(l.b) + Number(l.v)).toBe(300_000);
  });

  it("cancellation register: this month's void listed as not reported; a void now of last month's invoice listed as reported in that month (its serial unchanged)", async () => {
    // an invoice of LAST month (backdated issue), voided now
    const old = await sell(FO, A, [{ itemId: jasa, quantity: 1 }], false);
    const back = `${prevMonth()}-15 10:00:00+07`;
    await backdate("invoices", "issued_at = $2::timestamptz", "id = $1", [old.invoiceId, back]);
    const before = await exp(FIN, prevMonth(), "retail");
    if (!before.ok) throw new Error(JSON.stringify(before));
    const oldRow = one(parseXml(before.xml), "ListOfRetailInvoice").children.find((e) => txt(e, "Info") === `${old.number}/1`)!;
    const serial = txt(oldRow, "SerialNo");
    expect(Math.floor(Number(serial) / 1e6)).toBe(Number(prevMonth().replace("-", "")));
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), old.invoiceId, "Batal setelah lapor"));
    await as(OWN, (db) => decideApproval(db, approvalId, true)); // not the same day: the owner decides (SET-43)
    // last month's digunggung document is unchanged (voided in a later month: still reported there)
    const again = await exp(FIN, prevMonth(), "retail");
    if (!again.ok) throw new Error("refused");
    expect(again.xml).toBe(before.xml);
    const r = await exp(FIN, month(), "pembatalan");
    if (!r.ok) throw new Error(JSON.stringify(r));
    const doc = parseXml(r.xml);
    expect(kids(doc)).toEqual(["TIN", "TaxPeriodMonth", "TaxPeriodYear", "ListOfCancellation"]);
    const rows = one(doc, "ListOfCancellation").children;
    const of = (num: string) => rows.find((e) => txt(e, "Info") === `${num}/1`)!;
    expect([txt(of(voided.number), "TaxPeriodReported"), txt(of(voided.number), "VoidDate")]).toEqual(["none", today()]);
    expect([txt(of(old.number), "TaxPeriodReported"), txt(of(old.number), "SerialNo"), txt(of(old.number), "TransactionDate")]).toEqual([prevMonth(), serial, `${prevMonth()}-15`]);
    expect(Number(txt(of(old.number), "VAT"))).toBe(old.lines[0].vat);
    for (const e of rows) expect(kids(e)).toEqual(["SerialNo", "Info", "TransactionDate", "VoidDate", "TaxPeriodReported", "TaxBaseSellingPrice", "VAT"]);
    expect(r.xml).not.toContain(PATIENT);
  });
});

describe("retur (OutputSpecialDocReturn) from paid refunds, validated against the DJP XSD", () => {
  it("a paid refund that reversed VAT is one row: invoice number, own return number, DD-MM-YYYY, end consumer, base + VAT = refund, VAT = vat_reversed", async () => {
    const s = await sell(FO, A, [{ itemId: serum, quantity: 1 }]);
    const r = await as(FO, (db) => requestRefund(db, key(), s.lines[0].id, { amount: 111_000, reason: "Produk rusak dikembalikan", destination: "balance" }));
    const f = (await h.admin.query(`select vat_reversed::bigint v, paid_at from refunds where id = $1`, [r.refund_id])).rows[0];
    expect(Number(f.v)).toBeGreaterThan(0);
    const out = await exp(FIN, month(), "retur");
    if (!out.ok) throw new Error(JSON.stringify(out));
    const doc = parseXml(out.xml);
    const seqs = xsdSequences(fixture("output-special-doc-return.xsd"));
    expect(validate(doc, seqs, "OutputReturnData")).toEqual([]);
    expect(validate(parseXml(fixture("retur-dok-lain-keluaran-sample.xml")), seqs, "OutputReturnData")).toEqual([]);
    expect(txt(doc, "TIN")).toBe("0" + NPWP);
    const row = one(doc, "OutputReturnDataList").children.find((e) => txt(e, "ReturnDocumentNumber") === `RTR-${r.refund_id}`)!;
    const [d, m, y] = [today().slice(8), today().slice(5, 7), today().slice(0, 4)];
    expect(["DocumentNumber", "TransactionType", "DocumentType", "TransactionDetail", "TransactionDocument", "DocumentDate", "BuyerTIN", "BuyerTaxpayerName", "BuyerAddress", "ReturnSTLG"]
      .map((k) => txt(row, k))).toEqual([s.number, "01", "1", "01", "01", `${d}-${m}-${y}`, "0000000000000000", "Konsumen Akhir", "-", "0"]);
    expect([Number(txt(row, "ReturnTaxBase")) + Number(txt(row, "ReturnVAT")), Number(txt(row, "ReturnVAT"))]).toEqual([111_000, Number(f.v)]);
    expect(out.xml).not.toContain(PATIENT);
    expect(out.xml).not.toContain("Produk rusak");
    expect(await audits(A, "coretax_retur")).toBe(1);
  });

  it("a refund paid in another month is in that month's retur document, not this month's", async () => {
    const s = await sell(FO, A, [{ itemId: serum, quantity: 1 }]);
    const r = await as(FO, (db) => requestRefund(db, key(), s.lines[0].id, { amount: 50_000, reason: "Retur bulan lalu", destination: "balance" }));
    await backdate("refunds", "paid_at = $2::timestamptz", "id = $1", [r.refund_id, `${prevMonth()}-20 10:00:00+07`]);
    const now = await exp(FIN, month(), "retur");
    if (!now.ok) throw new Error(JSON.stringify(now));
    expect(now.xml).not.toContain(`RTR-${r.refund_id}`);
    const before = await exp(FIN, prevMonth(), "retur");
    if (!before.ok) throw new Error(JSON.stringify(before));
    const row = one(parseXml(before.xml), "OutputReturnDataList").children.find((e) => txt(e, "ReturnDocumentNumber") === `RTR-${r.refund_id}`)!;
    expect(txt(row, "DocumentDate")).toBe(`20-${prevMonth().slice(5)}-${prevMonth().slice(0, 4)}`);
  });
});

describe("faktur with a named buyer (TaxInvoiceBulk)", () => {
  it("no buyer tax identity is recorded: the month's faktur is the structural TaxInvoiceBulk (TIN + empty ListOfTaxInvoice), downloadable, exact SHA-256 logged as a zero-row row (r2 P1); the serializer's shape equals DJP's sample", async () => {
    const st = await as(FIN, (db) => coretaxStatus(db, month()));
    expect(st.docs.faktur).toEqual({ n: 0, base: 0, vat: 0, bounds_exceeded: false });
    const e = await exp(FIN, month(), "faktur");
    if (!e.ok) throw new Error(JSON.stringify(e));
    expect([e.rows, e.base, e.vat]).toEqual([0, 0, 0]);
    const env = parseXml(e.xml);
    expect([env.name, kids(env), txt(env, "TIN"), one(env, "ListOfTaxInvoice").children]).toEqual(["TaxInvoiceBulk", ["TIN", "ListOfTaxInvoice"], "0" + NPWP, []]);
    expect(env.attrs).toEqual(parseXml(fixture("faktur-pk-sample-v1.4.xml")).attrs);
    expect(e.xml).toContain("<ListOfTaxInvoice/>");
    expect(e.sha256).toBe(createHash("sha256").update(e.xml, "utf8").digest("hex"));
    const log = (await h.admin.query(`select doc_kind, sha256, row_count::int r, tax_base_total::int b, vat_total::int v from coretax_exports where tenant_id = $1 and sha256 = $2`, [A.tenantId, e.sha256])).rows;
    expect(log).toEqual([{ doc_kind: "faktur", sha256: e.sha256, r: 0, b: 0, v: 0 }]);
    expect(await audits(A, "coretax_faktur")).toBe(1);
    // the zero-row history row is allowed ONLY for the faktur: any other kind with 0 rows is refused by the table
    await expect(h.admin.query(`insert into coretax_exports (tenant_id, period, doc_kind, sha256, row_count, tax_base_total, vat_total, exported_by, exported_as)
      values ($1, $2, 'retail', repeat('b', 64), 0, 0, 0, $3, 'finance')`, [A.tenantId, month(), FIN.staffId])).rejects.toThrow(/coretax_exports_check/);
    await expect(h.admin.query(`insert into coretax_exports (tenant_id, period, doc_kind, sha256, row_count, tax_base_total, vat_total, exported_by, exported_as)
      values ($1, $2, 'faktur', repeat('b', 64), 0, 1, 0, $3, 'finance')`, [A.tenantId, month(), FIN.staffId])).rejects.toThrow(/coretax_exports_check/);
    // the other empty documents are still refused (an empty month's retur)
    expect(await exp(FIN, "2026-01", "retur")).toEqual({ ok: false, refused: "empty" });
    expect(await audits(A, "coretax_empty")).toBeGreaterThanOrEqual(1);
    // the serializer (internal, owner connection) on a synthetic row in DJP terms: TrxCode 04, DPP Nilai Lain, VATRate 12, Unit UM.0021
    const row = { date: "2026-11-19", trx_code: "04", buyer_tin: "0000000000000000", buyer_document: "National ID", buyer_document_number: "-", buyer_name: "Pembeli & <Uji>",
      buyer_address: "Jl. Uji 1", buyer_email: "", buyer_idtku: "000000", ref: "INV-CT1-202611-0001",
      lines: [{ opt: "A", code: "000000", name: "Serum", unit: "UM.0021", price: 300_000, qty: 1, discount: 0, tax_base: 300_000, other_tax_base: 275_000, vat_rate: 12, vat: 33_000 }] };
    const r = (await h.admin.query(`select * from coretax_doc_faktur($1, $2::jsonb)`, ["0" + NPWP, JSON.stringify([row])])).rows[0];
    expect([Number(r.n), Number(r.base), Number(r.vat)]).toEqual([1, 300_000, 33_000]);
    const doc = parseXml(r.doc);
    const sample = parseXml(fixture("faktur-pk-sample-v1.4.xml"));
    const shape = (e: El): unknown => [e.name, e.children.map(shape)];
    expect(shape(doc)).toEqual(shape(sample));
    expect(doc.attrs).toEqual(sample.attrs);
    const ti = one(one(doc, "ListOfTaxInvoice"), "TaxInvoice");
    expect([txt(ti, "TrxCode"), txt(ti, "SellerIDTKU"), txt(ti, "BuyerName")]).toEqual(["04", `0${NPWP}000000`, "Pembeli & <Uji>"]);
    expect(r.doc).toContain("Pembeli &amp; &lt;Uji&gt;");
    const g = one(one(ti, "ListOfGoodService"), "GoodService");
    expect(["Unit", "TaxBase", "OtherTaxBase", "VATRate", "VAT"].map((k) => txt(g, k))).toEqual(["UM.0021", "300000", "275000", "12", "33000"]);
    // no rows → the structural envelope, never NULL
    const empty = (await h.admin.query(`select n, doc from coretax_doc_faktur($1, '[]'::jsonb)`, ["0" + NPWP])).rows[0];
    expect([empty.n, empty.doc]).toEqual(["0", e.xml]);
  });
});

describe("supported ceiling (r2 P2): refused by name before any total is returned or logged", () => {
  it("a non-object line of Rp1,000,000,000,000 × 2,000 (DPP Rp2 × 10^15, within the catalog and line limits): status marks the digunggung document bounds_exceeded with no totals; the export refuses bounds_exceeded, audited, nothing logged", async () => {
    const T2 = await tenant("PT Batas Coretax");
    const own = await person(T2, "owner"); const fin = await person(T2, "finance"); const fo = await person(T2, "fo_cashier");
    await evidence(fin, own, "T2");
    await makePkp(T2, own);
    const big = await product(own, "CT-BIG", "Hak Guna Uji", 1_000_000_000_000, "non_object");
    const s = await sell(fo, T2, [{ itemId: big, quantity: 2_000 }], false);
    expect(s.lines[0]).toMatchObject({ base: 2_000_000_000_000_000, vat: 0 });
    const st = await as(fin, (db) => coretaxStatus(db, month()));
    expect(st.docs.retail).toEqual({ n: 0, base: 0, vat: 0, pending: 0, mismatch: 0, bounds_exceeded: true });
    expect(await exp(fin, month(), "retail")).toEqual({ ok: false, refused: "bounds_exceeded" });
    expect(await audits(T2, "coretax_bounds_exceeded")).toBe(1);
    expect(Number((await h.admin.query(`select count(*) c from coretax_exports where tenant_id = $1`, [T2.tenantId])).rows[0].c)).toBe(0);
  });

  it("at the ceiling exactly (DPP Rp10^15) the document is exported and logged; the totals are exact JavaScript numbers", async () => {
    const T3 = await tenant("PT Tepat Batas");
    const own = await person(T3, "owner"); const fin = await person(T3, "finance"); const fo = await person(T3, "fo_cashier");
    await evidence(fin, own, "T3");
    await makePkp(T3, own);
    const big = await product(own, "CT-EDG", "Hak Guna Batas", 1_000_000_000_000, "non_object");
    await sell(fo, T3, [{ itemId: big, quantity: 1_000 }], false);
    const st = await as(fin, (db) => coretaxStatus(db, month()));
    expect(st.docs.retail).toMatchObject({ n: 1, base: 1_000_000_000_000_000, vat: 0, bounds_exceeded: false });
    const r = await exp(fin, month(), "retail");
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect([r.rows, r.base, Number.isSafeInteger(r.base)]).toEqual([1, 1_000_000_000_000_000, true]);
    expect(txt(one(one(parseXml(r.xml), "ListOfRetailInvoice"), "RetailInvoice"), "TaxBaseSellingPrice")).toBe("1000000000000000");
  });
});

describe("roles, status, isolation", () => {
  it("auditor reads the status (counts, totals, history) but may not export; FO and others are refused; status names no patient", async () => {
    const s = await as(AU, (db) => coretaxStatus(db, month()));
    expect(s.docs.retail.n).toBeGreaterThan(0);
    expect(s.history.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toContain(PATIENT);
    expect(await why(exp(AU, month(), "retail"))).toBe("ERR_FORBIDDEN:role may not use the ledger");
    expect(await why(as(NFIN, (db) => coretaxStatus(db, month())))).toBe("ERR_FORBIDDEN:role may not use the ledger");
    expect(await why(exp(MGR, month(), "retail"))).toBe("ERR_FORBIDDEN:role may not use the ledger");
    // the log table: readers only (RLS); never writable by the app
    expect(await why(as(FO, (db) => db.query(`select count(*) from coretax_exports`).then((r) => { if (Number(r.rows[0].count) > 0) throw new Error("visible"); })))).toBe("ok");
    expect(await why(as(FIN, (db) => db.query(`insert into coretax_exports (tenant_id, period, doc_kind, sha256, row_count, tax_base_total, vat_total, exported_by, exported_as)
      values ($1, '2026-01', 'retail', repeat('a', 64), 1, 0, 0, $2, 'finance')`, [A.tenantId, FIN.staffId])))).toMatch(/^raw:permission denied/);
  });

  it("cross-tenant: B's documents carry only B's facts; A's log rows are invisible to B", async () => {
    const r = await exp(BFIN, month(), "retail");
    if (!r.ok) throw new Error(JSON.stringify(r));
    const rows = one(parseXml(r.xml), "ListOfRetailInvoice").children;
    expect(rows.map((x) => [txt(x, "Info"), Number(txt(x, "TaxBaseSellingPrice"))])).toEqual([[`${bSale.number}/1`, bSale.base]]);
    const bHist = await as(BFIN, (db) => coretaxStatus(db, month()));
    expect(bHist.history.every((x) => x.kind === "retail")).toBe(true);
    const seen = await as(BFIN, (db) => db.query(`select count(*)::int c from coretax_exports where tenant_id = $1`, [A.tenantId]));
    expect(seen.rows[0].c).toBe(0);
    expect(await why(as(BFIN, (db) => db.query(`select * from coretax_lines($1, $2)`, [A.tenantId, month()])))).toMatch(/^raw:permission denied/);
  });
});
