// T-105 G-Q4 S1 (owner 2026-11-19; migration 0124): the explicit visit selection row → invoice line identity captured at billing, and the
// ONE coordinated ProductHandedOver journal (docs/spec/11 :118) on that exact line through the real ledger consumer. Proves: server-side
// tenant / branch / visit / product / exact-quantity checks; one live line per selection row (serialized under the visit lock); duplicate
// products of one visit each on their own line; hand-over before and after billing; void → re-bill in the permitted (pre-handover) order
// and the existing refusal of a void once handed; replay; unlinked billing semantics unchanged and left explicit (G-Q4 U1–U4 OPEN, not
// reconciled). Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { ledgerPostingConsumer, LEDGER_CONSUMER, postEvent } from "../../src/modules/accounting/ledger/posting";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { issueKasirInvoice, kasirVisitLines, KasirError, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { createDepot, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { saveItem } from "../../src/modules/inventory/stock";
import { receiveFromSupplier, saveSupplier } from "../../src/modules/purchasing/suppliers/suppliers";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { confirmSelection, handOver, prepareDispensing } from "../../src/modules/pharmacy/pharmacy";
import { changeSetting } from "../../src/modules/settings/settings";
import { runOutboxBatch } from "../../src/workers/outbox";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { wibDay } from "../support/dates";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let worker: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing"];
const CHECKS = { identity: true, validity: true, dose: true, allergy: true, clarification: true, label: true, counselling: true };
const key = () => crypto.randomUUID();

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $2, 'Asia/Jakarta', 'Jl. Uji 1') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br(`SL1${++n}`), b2: await br(`SL2${++n}`) };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`sel${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Tautan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch ?? t.b1 });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof KasirError ? `${e.code}:${e.reason}` : e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
async function patient(t: T, branch: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Tautan', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
}
async function visit(t: T, by: P, branch = t.b1) {
  const patientId = await patient(t, branch);
  const visitId = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, branch, patientId, by.staffId])).rows[0].id as string;
  return { visitId, patientId };
}
async function drain() {
  for (let i = 0; i < 20; i++) {
    const [r] = await runOutboxBatch(worker, [ledgerPostingConsumer], { worker: "s1", limit: 200, leaseSeconds: 5 });
    if (r.done + r.skipped + r.failed === 0) return;
  }
}
type Row = [string, number, number];
const sorted = (r: Row[]) => [...r].sort((a, b) => a[0].localeCompare(b[0]) || b[1] - a[1] || b[2] - a[2]);
async function entries(dispensing: string) {
  const r = await h.admin.query(`select e.posting_key k, e.kind, a.key, l.debit::bigint d, l.credit::bigint c, e.business_date::text bd
      from journal_entries e join journal_lines l on l.entry_id = e.id join ledger_accounts a on a.id = l.account_id
     where (e.source_kind = 'dispensing' and e.source_id = $1)
        or e.reverses_entry_id in (select x.id from journal_entries x where x.source_kind = 'dispensing' and x.source_id = $1)
     order by e.kind, e.posting_key, a.key, l.debit desc, l.credit desc`, [dispensing]);
  return r.rows.map((x) => ({ k: String(x.k), kind: String(x.kind), row: [String(x.key), Number(x.d), Number(x.c)] as Row, bd: String(x.bd) }));
}
const lines = async (k: string, rows: Awaited<ReturnType<typeof entries>>) => sorted(rows.filter((x) => x.k === k).map((x) => x.row));

let A: T; let B: T;
let OWN: P; let MGR: P; let FO: P; let FOB2: P; let PH: P; let BC: P; let BCB2: P; let BOWN: P; let BFO: P; let BBC: P;
let serum: { item: string; version: string }; let toner: { item: string; version: string }; let bSerum: { item: string; version: string };
let APT: string; let PUR: P; let SUP: string;

async function product(t: T, own: P, ph: P, c: string, name: string, price: number, cost: number, depot: string | null) {
  const v = await as(own, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: "exempt_medical", tax_basis: "Barang", normal_price: price } as never, "Produk"));
  const stock = (await as(ph, (db) => saveItem(db, key(), null, { catalogItemId: v.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
  if (depot) {
    const g1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [t.b1])).rows[0].id;
    const r = await as(PUR, (db) => receiveFromSupplier(db, key(), t.b1, { supplierId: SUP, itemId: stock, batchNo: `${c}-B`, expiry: wibDay(300), quantity: "40", unitCost: cost, reason: "penerimaan" }));
    const batch = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [r.receiptId])).rows[0].batch_id as string;
    await as(ph, (db) => transferBetweenDepots(db, key(), { fromDepotId: g1, toDepotId: depot, lines: [{ batchId: batch, quantity: "40" }] }));
  }
  return { item: v.itemId, version: v.versionId };
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  worker = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 2 });
  A = await tenant("PT Tautan Pilihan");
  B = await tenant("PT Tautan Lain");
  OWN = await person(A, "owner"); MGR = await person(A, "manager"); FO = await person(A, "fo_cashier"); FOB2 = await person(A, "fo_cashier", A.b2);
  PH = await person(A, "pharmacist"); BC = await person(A, "bc"); BCB2 = await person(A, "bc", A.b2);
  BOWN = await person(B, "owner"); BFO = await person(B, "fo_cashier"); BBC = await person(B, "bc"); const BPH = await person(B, "pharmacist");
  APT = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Tautan", kind: "apotek" }))).depotId;
  PUR = await person(A, "purchasing");
  SUP = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "PT Pemasok Tautan" }))).supplierId;
  serum = await product(A, OWN, PH, "SL-SRM", "Serum Tautan", 300_000, 120_000, APT);
  toner = await product(A, OWN, PH, "SL-TON", "Toner Tautan", 200_000, 80_000, APT);
  bSerum = await product(B, BOWN, BPH, "SL-BSRM", "Serum Tenant Lain", 300_000, 120_000, null);
  await as(OWN, (db) => changeSetting(db, { key: "SET-12", branchId: null, value: { fo_persen: 0, manajer_persen: 10, manajer_rupiah: 500_000 }, reason: "Diskon lewat persetujuan" }));
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await worker?.end();
  await h?.close();
});

// A visit whose confirmed selection holds the given product rows; returns its rows (id, item, quantity) and dispensings ordered by quantity
// (uuid v7 ids made in the same millisecond do not keep insertion order — the duplicate-product cases use distinct quantities).
async function selected(items: { version: string; quantity: string }[], by = BC, fo = FO, t = A, branch = t.b1) {
  const v = await visit(t, fo, branch);
  await as(by, (db) => confirmSelection(db, key(), v.visitId, { items: items.map((x) => ({ catalogVersionId: x.version, quantity: x.quantity })) }));
  const rows = (await h.admin.query(`select si.id, cv.item_id, si.quantity::text q, d.id d from selection_items si join catalog_versions cv on cv.id = si.catalog_version_id
     join dispensings d on d.selection_item_id = si.id where si.visit_id = $1 order by si.quantity, si.id`, [v.visitId])).rows as { id: string; item_id: string; q: string; d: string }[];
  return { ...v, rows };
}
const bill = async (s: { visitId: string; patientId: string }, ls: { itemId: string; quantity: number; selectionItemId?: string; discount?: number }[], fo = FO) => {
  const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: s.patientId, visitId: s.visitId }));
  await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, ls));
  return invoiceId as string;
};
const lineOf = async (inv: string, item: string) => (await h.admin.query(`select id, selection_item_id s from invoice_lines where invoice_id = $1 and item_id = $2 order by created_at, id`, [inv, item])).rows;
const hand = async (d: string) => {
  await as(PH, (db) => prepareDispensing(db, key(), d, APT));
  await as(PH, (db) => handOver(db, key(), d, { checks: CHECKS }));
};
const pay = (inv: string, amount: number) => as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount, cashTendered: amount }]));

describe("T-105 G-Q4 S1: the selection link at billing (server-side checks)", () => {
  it("the Kasir visit lines carry the row id of a linkable product and whether a live line bills it", async () => {
    const s = await selected([{ version: serum.version, quantity: "1" }, { version: toner.version, quantity: "1.5" }]);
    const vl = await as(FO, (db) => kasirVisitLines(db, s.visitId));
    const bySerum = vl.lines.find((l) => l.item_id === serum.item)!; const byToner = vl.lines.find((l) => l.item_id === toner.item)!;
    expect([bySerum.selection_item_id, bySerum.billed]).toEqual([s.rows.find((r) => r.item_id === serum.item)!.id, false]);
    // a fractional selection quantity cannot be billed exactly on an integer line: no link offered (U2 OPEN), shown rounded up as before
    expect([byToner.selection_item_id, byToner.quantity]).toEqual([null, 2]);
    await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: bySerum.selection_item_id! }]);
    expect((await as(FO, (db) => kasirVisitLines(db, s.visitId))).lines.find((l) => l.item_id === serum.item)!.billed).toBe(true);
  });

  it("refuses: another tenant's row, another visit's row, another branch, a service row, another product, a different or fractional quantity, a repeated or already billed row, a counter invoice", async () => {
    const s = await selected([{ version: serum.version, quantity: "2" }]);
    const row = s.rows[0];
    const other = await selected([{ version: serum.version, quantity: "2" }]);
    const bRow = (await selected([{ version: bSerum.version, quantity: "1" }], BBC, BFO, B)).rows[0];
    const frac = await selected([{ version: serum.version, quantity: "1.5" }]);
    const tryBill = async (ls: { itemId: string; quantity: number; selectionItemId?: string }[], v = s, fo = FO) => {
      const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: v.patientId, visitId: v.visitId }));
      return why(as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, ls)));
    };
    expect(await tryBill([{ itemId: serum.item, quantity: 2, selectionItemId: bRow.id }])).toBe("ERR_NOT_FOUND:selection item not found");
    expect(await tryBill([{ itemId: serum.item, quantity: 2, selectionItemId: other.rows[0].id }])).toBe("ERR_NOT_FOUND:selection item not found");
    expect(await tryBill([{ itemId: toner.item, quantity: 2, selectionItemId: row.id }])).toBe("ERR_INVALID_INPUT:selection_item_or_quantity");
    expect(await tryBill([{ itemId: serum.item, quantity: 1, selectionItemId: row.id }])).toBe("ERR_INVALID_INPUT:selection_item_or_quantity");
    expect(await tryBill([{ itemId: serum.item, quantity: 2, selectionItemId: frac.rows[0].id }], frac)).toBe("ERR_INVALID_INPUT:selection_item_or_quantity");
    expect(await tryBill([{ itemId: serum.item, quantity: 1, selectionItemId: row.id }, { itemId: serum.item, quantity: 1, selectionItemId: row.id }])).toBe("ERR_INVALID_INPUT:selection_link_repeated");
    const counter = (await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }))).invoiceId;
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), counter, [{ itemId: serum.item, quantity: 2, selectionItemId: row.id }])))).toBe("ERR_INVALID_INPUT:selection_link");
    // a row of a branch-2 visit cannot be named on a branch-1 visit's invoice (tenant, branch and visit are all part of the row scope)
    const b2 = await selected([{ version: serum.version, quantity: "1" }], BCB2, FOB2, A, A.b2);
    expect(await tryBill([{ itemId: serum.item, quantity: 1, selectionItemId: b2.rows[0].id }])).toBe("ERR_NOT_FOUND:selection item not found");
    expect((await h.admin.query(`select count(*)::int c from invoice_lines where selection_item_id = any($1)`, [[row.id, bRow.id, other.rows[0].id, frac.rows[0].id]])).rows[0].c).toBe(0);
    // the first valid link succeeds; the same row again on a second ordinary invoice is refused while the first is live (the one-live-line
    // check runs under the visit lock; today the visit's one-ordinary-invoice rule refuses first — defence in depth)
    await bill(s, [{ itemId: serum.item, quantity: 2, selectionItemId: row.id }]);
    const s2inv = (await as(MGR, (db) => openKasirInvoice(db, key(), { patientId: s.patientId, visitId: s.visitId }))).invoiceId;
    expect(await why(as(MGR, (db) => issueKasirInvoice(db, key(), s2inv, [{ itemId: serum.item, quantity: 2, selectionItemId: row.id }])))).toBe("ERR_VERSION_CONFLICT:visit_already_invoiced");
  });

  it("the link is written by invoice_issue only and is immutable (database guard)", async () => {
    const s = await selected([{ version: serum.version, quantity: "1" }]);
    const inv = await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: s.rows[0].id }]);
    const [l] = await lineOf(inv, serum.item);
    const other = await selected([{ version: serum.version, quantity: "1" }]);
    const err = (q: Promise<unknown>) => q.then(() => "ok", (e) => e.code);
    expect(await err(h.admin.query(`update invoice_lines set selection_item_id = $2 where id = $1`, [l.id, other.rows[0].id]))).toBe("42501");
    expect(await err(h.admin.query(`update invoice_lines set selection_item_id = null where id = $1`, [l.id]))).toBe("42501");
    expect(await as(FO, (db) => db.query(`update invoice_lines set selection_item_id = null where id = $1`, [l.id]).then(() => "ok", (e) => e.code))).toBe("42501");
  });
});

describe("T-105 G-Q4 S1: one coordinated ProductHandedOver journal on the linked line (real consumer)", () => {
  it("duplicate products on one visit: two selection rows of the same serum → two linked lines, each hand-over on its own line; handed BEFORE billing waits, then posts at handed_at; replay posts nothing", async () => {
    const s = await selected([{ version: serum.version, quantity: "1" }, { version: serum.version, quantity: "2" }]);
    const [r1, r2] = s.rows;
    // hand-over before any invoice is allowed (payment not started): nothing posts yet — no COGS-only split
    await hand(r1.d);
    await drain();
    expect(await entries(r1.d)).toEqual([]);
    const ev1 = (await h.admin.query(`select id from domain_events where type = 'ProductHandedOver' and aggregate_id = $1`, [r1.d])).rows[0].id;
    expect((await h.admin.query(`select done_at is not null d from event_receipts where consumer = $1 and event_id = $2`, [LEDGER_CONSUMER, ev1])).rows[0].d).toBe(true);
    const inv = await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: r1.id }, { itemId: serum.item, quantity: 2, selectionItemId: r2.id }]);
    const ls = await lineOf(inv, serum.item);
    const l1 = ls.find((x) => x.s === r1.id)!.id; const l2 = ls.find((x) => x.s === r2.id)!.id;
    await drain(); // InvoiceIssued wakes the visit: r1's hand-over posts on l1, dated at its hand-over
    const e1 = await entries(r1.d);
    expect(await lines(`product_handed:${r1.d}:${l1}`, e1)).toEqual(sorted([["cogs", 120_000, 0], ["inventory", 0, 120_000], ["liability_paid_not_delivered", 300_000, 0], ["revenue_product", 0, 300_000]]));
    expect(e1[0].bd).toBe((await h.admin.query(`select (handed_at at time zone 'Asia/Jakarta')::date::text d from dispensings where id = $1`, [r1.d])).rows[0].d);
    // handed AFTER billing (paid first, as the hand-over blocker requires): posts at once on l2 (2 × 300,000; COGS 2 × 120,000)
    await pay(inv, 900_000);
    await hand(r2.d);
    await drain();
    expect(await lines(`product_handed:${r2.d}:${l2}`, await entries(r2.d))).toEqual(sorted([["cogs", 240_000, 0], ["inventory", 0, 240_000], ["liability_paid_not_delivered", 600_000, 0], ["revenue_product", 0, 600_000]]));
    // replay of every event posts nothing more
    const evs = (await h.admin.query(`select id from domain_events where tenant_id = $1 and (aggregate_id = any($2) or (type = 'InvoiceIssued' and aggregate_id = $3))`, [A.tenantId, [r1.d, r2.d], inv])).rows;
    const before = (await h.admin.query(`select count(*)::int c from journal_entries where tenant_id = $1`, [A.tenantId])).rows[0].c;
    for (const x of evs) expect(await as(OWN, (db) => postEvent(db, { id: x.id }))).toBeNull();
    expect((await h.admin.query(`select count(*)::int c from journal_entries where tenant_id = $1`, [A.tenantId])).rows[0].c).toBe(before);
  });

  it("void → re-bill, permitted pre-handover order (billed, voided unpaid, re-billed, paid, handed): one entry on the re-billed line only; the voided line has none", async () => {
    const s = await selected([{ version: serum.version, quantity: "1" }]);
    const r = s.rows[0];
    const inv1 = await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: r.id }]);
    const [l1] = await lineOf(inv1, serum.item);
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), inv1, "Salah tagih produk"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    // the void freed the row: the visit lines offer it again, unbilled
    expect((await as(FO, (db) => kasirVisitLines(db, s.visitId))).lines[0].billed).toBe(false);
    const inv2 = await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: r.id }]);
    const [l2] = await lineOf(inv2, serum.item);
    await pay(inv2, 300_000);
    await hand(r.d);
    await drain();
    const e = await entries(r.d);
    expect([...new Set(e.map((x) => x.k))]).toEqual([`product_handed:${r.d}:${l2.id}`]);
    expect(e.some((x) => x.k.includes(l1.id))).toBe(false);
  });

  it("existing void guard, not relaxed: a paid linked line cannot be voided (invoice_paid); a handed-but-unpaid visit product's invoice CAN be voided today (the void guard checks counter dispensings only) — its entry is mirrored at voided_at and the re-billed line posts once, in every consumption order", async () => {
    // paid → void refused by the existing request guard
    const p = await selected([{ version: serum.version, quantity: "1" }]);
    const pinv = await bill(p, [{ itemId: serum.item, quantity: 1, selectionItemId: p.rows[0].id }]);
    await pay(pinv, 300_000);
    expect(await why(as(FO, (db) => requestVoid(db, key(), pinv, "Salah tagih produk")))).toBe("ERR_VERSION_CONFLICT:invoice_paid");
    // handed before billing, billed unpaid, voided, re-billed, paid — every consumption order gives the same entries
    const shapes: string[][] = [];
    for (const order of ["each_step", "at_end", "void_last"] as const) {
      const s = await selected([{ version: serum.version, quantity: "1" }]);
      const r = s.rows[0];
      await hand(r.d);
      const ev = (await h.admin.query(`select id from domain_events where type = 'ProductHandedOver' and aggregate_id = $1`, [r.d])).rows[0].id;
      const holdIds = async (ids: string[]) => h.admin.query(`update event_receipts set lease_until = now() + interval '1 hour', claimed_by = 'other-worker' where consumer = $1 and event_id = any($2) and done_at is null`, [LEDGER_CONSUMER, ids]);
      const freeIds = async (ids: string[]) => h.admin.query(`update event_receipts set lease_until = now() - interval '1 second' where consumer = $1 and event_id = any($2) and done_at is null`, [LEDGER_CONSUMER, ids]);
      if (order === "each_step") await drain(); else await holdIds([ev]);
      const inv1 = await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: r.id }]);
      const [l1] = await lineOf(inv1, serum.item);
      if (order === "each_step") await drain();
      const { approvalId } = await as(FO, (db) => requestVoid(db, key(), inv1, "Salah tagih produk"));
      await as(MGR, (db) => decideApproval(db, approvalId, true));
      await h.admin.query("alter table invoices disable trigger invoices_guard");
      await h.admin.query(`update invoices set voided_at = voided_at + interval '2 days' where id = $1`, [inv1]);
      await h.admin.query("alter table invoices enable always trigger invoices_guard");
      const vEv = (await h.admin.query(`select id from domain_events where type = 'InvoiceVoided' and aggregate_id = $1`, [inv1])).rows[0].id;
      if (order === "void_last") await holdIds([vEv]);
      if (order === "each_step") await drain();
      const inv2 = await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: r.id }]);
      const [l2] = await lineOf(inv2, serum.item);
      await pay(inv2, 300_000);
      if (order === "void_last") { await freeIds([ev]); await drain(); await freeIds([vEv]); } else await freeIds([ev]);
      await drain();
      const e = await entries(r.d);
      const k1 = `product_handed:${r.d}:${l1.id}`; const k2 = `product_handed:${r.d}:${l2.id}`;
      const full = sorted([["cogs", 120_000, 0], ["inventory", 0, 120_000], ["liability_paid_not_delivered", 300_000, 0], ["revenue_product", 0, 300_000]]);
      expect([await lines(k1, e), await lines(k2, e)]).toEqual([full, full]);
      const mirror = e.filter((x) => x.kind === "reversal");
      expect(sorted(mirror.map((x) => x.row))).toEqual(sorted(full.map(([a, d, c]) => [a, c, d] as Row)));
      expect(mirror[0].bd).toBe((await h.admin.query(`select (voided_at at time zone 'Asia/Jakarta')::date::text d from invoices where id = $1`, [inv1])).rows[0].d);
      expect(mirror[0].bd).not.toBe(e.find((x) => x.k === k1)!.bd);
      shapes.push(e.map((x) => `${x.kind}|${x.k.replace(r.d, "D").replace(l1.id, "L1").replace(l2.id, "L2").replace(/invoice_voided:[0-9a-f-]{36}/, "V")}|${x.row.join(",")}`));
    }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("unlinked billing semantics unchanged and explicit (G-Q4 U1–U4 OPEN): a selection product billed without its link, at an edited quantity, or never billed posts NOTHING (no inference, no COGS-only split); counter sales unchanged", async () => {
    // billed without the link (the form omits sel when the quantity was edited): accepted as before, the dispensing posts nothing
    const s = await selected([{ version: serum.version, quantity: "1" }]);
    const inv = await bill(s, [{ itemId: serum.item, quantity: 2 }]);
    expect((await lineOf(inv, serum.item))[0].s).toBeNull();
    await pay(inv, 600_000);
    await hand(s.rows[0].d);
    await drain();
    expect(await entries(s.rows[0].d)).toEqual([]);
    // never billed: handed, nothing posts (U1 OPEN — the visit-close / accounting rule is the owner's)
    const nb = await selected([{ version: toner.version, quantity: "1" }]);
    await hand(nb.rows[0].d);
    await drain();
    expect(await entries(nb.rows[0].d)).toEqual([]);
    // the explicit OPEN list: handed selection dispensings with no live linked line (what finance must see; not reconciled)
    const open = (await h.admin.query(`select d.id from dispensings d where d.tenant_id = $1 and d.state = 'handed' and d.selection_item_id is not null
        and not exists (select 1 from invoice_lines l join invoices i on i.id = l.invoice_id where l.selection_item_id = d.selection_item_id and i.state = 'issued')`, [A.tenantId])).rows.map((x) => x.id);
    expect(open).toEqual(expect.arrayContaining([s.rows[0].d, nb.rows[0].d]));
    // counter sale: exact invoice_line_id, key product_handed:<dispensing> (unchanged)
    const c = (await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }))).invoiceId;
    await as(FO, (db) => issueKasirInvoice(db, key(), c, [{ itemId: serum.item, quantity: 1 }]));
    await pay(c, 300_000);
    const cd = (await h.admin.query(`select d.id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [c])).rows[0].id;
    await hand(cd);
    await drain();
    expect([...new Set((await entries(cd)).map((x) => x.k))]).toEqual([`product_handed:${cd}`]);
  });

  it("a selection product handed before billing, then billed with a manual discount pending: waits; the decision posts the final price once", async () => {
    const s = await selected([{ version: serum.version, quantity: "1" }]);
    await hand(s.rows[0].d); // before any invoice (payment not started); a pending discount blocks a later hand-over (existing guard)
    const inv = await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: s.rows[0].id, discount: 50_000 }]);
    await drain();
    expect(await entries(s.rows[0].d)).toEqual([]);
    const ap = (await h.admin.query(`select discount_approval_id a from invoice_lines where invoice_id = $1`, [inv])).rows[0].a;
    await as(OWN, (db) => decideApproval(db, ap, true));
    await drain();
    const [l] = await lineOf(inv, serum.item);
    expect(await lines(`product_handed:${s.rows[0].d}:${l.id}`, await entries(s.rows[0].d))).toEqual(sorted([["cogs", 120_000, 0], ["inventory", 0, 120_000], ["liability_paid_not_delivered", 250_000, 0], ["revenue_product", 0, 250_000]]));
  });

  it("cross-tenant: tenant B cannot read tenant A's links or post A's events", async () => {
    const s = await selected([{ version: serum.version, quantity: "1" }]);
    await bill(s, [{ itemId: serum.item, quantity: 1, selectionItemId: s.rows[0].id }]);
    expect((await as(BFO, (db) => db.query(`select count(*)::int c from invoice_lines where selection_item_id = $1`, [s.rows[0].id]))).rows[0].c).toBe(0);
    const ev = (await h.admin.query(`select id from domain_events where tenant_id = $1 and type = 'InvoiceIssued' order by id desc limit 1`, [A.tenantId])).rows[0].id;
    expect(await as(BOWN, (db) => postEvent(db, { id: ev })).then(() => "ok", (e) => String(e.message))).toMatch(/ERR_FORBIDDEN/);
  });
});

// ── T-105 r8 G-VAT-S1 (Panel 2 r7 REVISE): a linked TAXABLE visit product handed over before payment recognises its VAT at the hand-over
// (BILL-6 earlier of payment or delivery) through the existing HYG-023 mechanism (vat_line_deliver → line_delivery); the coordinated
// ProductHandedOver entry credits that VAT; the payment carries only the remainder (none) — VAT once. PKP tenant; serum Rp333,000 =
// base 300,000 + VAT 33,000 (BILL-6 fixture arithmetic); cost 150,000.
describe("T-105 r8 G-VAT-S1: delivery VAT for linked taxable visit products", () => {
  let C: T; let cown: P; let cfin: P; let cfo: P; let cph: P; let cbc: P; let cmgr: P; let capt: string; let tx: { item: string; version: string };
  const vatOf = async (line: string) => (await h.admin.query(`select cause, delta::int d, (effective_at at time zone 'Asia/Jakarta')::date::text eday, source_id from vat_events where object_id = $1 order by created_at, id`, [line])).rows;
  const glVat = async () => Number((await h.admin.query(`select coalesce(sum(l.credit - l.debit), 0) s from journal_lines l join ledger_accounts a on a.id = l.account_id
       where l.tenant_id = $1 and a.key = 'vat_payable'`, [C.tenantId])).rows[0].s);
  const subVat = async () => Number((await h.admin.query(`select coalesce(sum(amount), 0) s from subledger_movements($1) where ledger = 'vat'`, [C.tenantId])).rows[0].s);
  const lineOfInv = async (inv: string) => (await h.admin.query(`select id, vat_amount::int vat, vat_recognised_amount::int rec, line_total::int total from invoice_lines where invoice_id = $1 order by created_at, id`, [inv])).rows;
  const portions = async (line: string) => (await h.admin.query(`select vat_portion::int p from payment_allocations where invoice_line_id = $1 order by created_at`, [line])).rows.map((r) => r.p);
  const handC = async (d: string) => { await as(cph, (db) => prepareDispensing(db, key(), d, capt)); await as(cph, (db) => handOver(db, key(), d, { checks: CHECKS })); };
  const billC = async (s: { visitId: string; patientId: string }, ls: { itemId: string; quantity: number; selectionItemId?: string; discount?: number }[]) => {
    const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: s.patientId, visitId: s.visitId }));
    await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, ls));
    return invoiceId as string;
  };
  const payC = (inv: string, amount: number) => as(cfo, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount, cashTendered: amount }]));
  const shift = async (table: string, col: string, id: string, interval: string) => {
    await h.admin.query(`alter table ${table} disable trigger ${table}_guard`);
    await h.admin.query(`update ${table} set ${col} = ${col} - interval '${interval}' where id = $1`, [id]);
    await h.admin.query(`alter table ${table} enable always trigger ${table}_guard`);
  };
  beforeAll(async () => {
    C = await tenant("PT Tautan PKP");
    cown = await person(C, "owner"); cfin = await person(C, "finance"); cfo = await person(C, "fo_cashier"); cph = await person(C, "pharmacist");
    cbc = await person(C, "bc"); cmgr = await person(C, "manager"); const cpur = await person(C, "purchasing");
    const { decideEvidence, uploadEvidence } = await import("../../src/modules/compliance/compliance");
    const { setTaxProfile } = await import("../../src/modules/tax/tax");
    const pdf = Buffer.from("%PDF-1.7\nsaran pajak tautan\n%%EOF\n");
    const { fileId } = await as(cfin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(cown, (db) => decideEvidence(db, ev, fileId, "approved"));
    const day0 = wibDay(0);
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: wibDay(1), npwp: "012345678901234", reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 80, changed_at = now() - interval '85 days' where tenant_id = $1`, [C.tenantId, day0]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 80 where id = $1`, [C.tenantId, day0]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    await as(cown, (db) => changeSetting(db, { key: "SET-12", branchId: null, value: { fo_persen: 0, manajer_persen: 10, manajer_rupiah: 500_000 }, reason: "Diskon lewat persetujuan" }));
    const sup = (await as(cpur, (db) => saveSupplier(db, key(), null, { name: "PT Pemasok PKP" }))).supplierId;
    const v = await as(cown, (db) => publish(db, { kind: "product", code: "PKP-SRM" }, { name: "Serum Pajak", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"));
    const st = (await as(cph, (db) => saveItem(db, key(), null, { catalogItemId: v.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    const r = await as(cpur, (db) => receiveFromSupplier(db, key(), C.b1, { supplierId: sup, itemId: st, batchNo: "PKP-B", expiry: wibDay(300), quantity: "40", unitCost: 150_000, reason: "penerimaan" }));
    const b = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [r.receiptId])).rows[0].batch_id;
    const g1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [C.b1])).rows[0].id;
    capt = (await as(cph, (db) => createDepot(db, key(), { branchId: null, name: "Apotek PKP", kind: "apotek" }))).depotId;
    await as(cph, (db) => transferBetweenDepots(db, key(), { fromDepotId: g1, toDepotId: capt, lines: [{ batchId: b, quantity: "40" }] }));
    tx = { item: v.itemId, version: v.versionId };
  }, 300_000);

  it("hand-over → invoice across a month boundary: line_delivery 33,000 effective in the hand-over month; the ProductHandedOver entry credits it (dated hand-over); the payment adds 0; GL VAT = VAT sub-ledger; replay posts nothing", async () => {
    const s = await selected([{ version: tx.version, quantity: "1" }], cbc, cfo, C);
    const r = s.rows[0];
    await handC(r.d);
    // the hand-over happened in the previous month (synthetic): the tax point is the hand-over, not the later issue / payment
    await shift("dispensings", "handed_at", r.d, "35 days");
    const handedDay = (await h.admin.query(`select (handed_at at time zone 'Asia/Jakarta')::date::text d from dispensings where id = $1`, [r.d])).rows[0].d;
    const inv = await billC(s, [{ itemId: tx.item, quantity: 1, selectionItemId: r.id }]);
    const [l] = await lineOfInv(inv);
    expect([l.vat, l.rec]).toEqual([33_000, 33_000]);
    expect(await vatOf(l.id)).toEqual([{ cause: "line_delivery", d: 33_000, eday: handedDay, source_id: r.d }]);
    await drain();
    const e = await entries(r.d);
    expect(await lines(`product_handed:${r.d}:${l.id}`, e)).toEqual(sorted([["cogs", 150_000, 0], ["inventory", 0, 150_000], ["liability_paid_not_delivered", 333_000, 0],
      ["revenue_product", 0, 300_000], ["vat_payable", 0, 33_000]]));
    expect(e[0].bd).toBe(handedDay);
    await payC(inv, 333_000);
    expect(await portions(l.id)).toEqual([0]);
    await drain();
    expect(await glVat()).toBe(await subVat());
    // replay of the hand-over, issue and payment events posts nothing more
    const before = (await h.admin.query(`select count(*)::int c from journal_entries where tenant_id = $1`, [C.tenantId])).rows[0].c;
    const evs = (await h.admin.query(`select id from domain_events where tenant_id = $1 and (aggregate_id = any($2) or (type = 'InvoiceIssued' and aggregate_id = $3))`, [C.tenantId, [r.d], inv])).rows;
    for (const x of evs) expect(await as(cown, (db) => postEvent(db, { id: x.id }))).toBeNull();
    expect((await h.admin.query(`select count(*)::int c from journal_entries where tenant_id = $1`, [C.tenantId])).rows[0].c).toBe(before);
  });

  it("paid before the hand-over (invoice → payment → hand-over): VAT at payment once; the hand-over adds no line_delivery; the entry carries no VAT", async () => {
    const s = await selected([{ version: tx.version, quantity: "1" }], cbc, cfo, C);
    const inv = await billC(s, [{ itemId: tx.item, quantity: 1, selectionItemId: s.rows[0].id }]);
    const [l] = await lineOfInv(inv);
    await payC(inv, 333_000);
    await handC(s.rows[0].d);
    await drain();
    expect(await portions(l.id)).toEqual([33_000]);
    expect((await vatOf(l.id)).map((x) => x.cause)).toEqual([]);
    expect(await lines(`product_handed:${s.rows[0].d}:${l.id}`, await entries(s.rows[0].d))).toEqual(sorted([["cogs", 150_000, 0], ["inventory", 0, 150_000],
      ["liability_paid_not_delivered", 300_000, 0], ["revenue_product", 0, 300_000]]));
    expect(await glVat()).toBe(await subVat());
  });

  it("two linked rows of one product (quantities 1 and 2), both handed before billing: each line recognises its own VAT at its hand-over (33,000 and 66,000), each entry carries it; payment adds 0", async () => {
    const s = await selected([{ version: tx.version, quantity: "1" }, { version: tx.version, quantity: "2" }], cbc, cfo, C);
    const [r1, r2] = s.rows;
    await handC(r1.d); await handC(r2.d);
    const inv = await billC(s, [{ itemId: tx.item, quantity: 1, selectionItemId: r1.id }, { itemId: tx.item, quantity: 2, selectionItemId: r2.id }]);
    const ls = (await h.admin.query(`select id, selection_item_id s, vat_recognised_amount::int rec from invoice_lines where invoice_id = $1`, [inv])).rows;
    const l1 = ls.find((x) => x.s === r1.id)!; const l2 = ls.find((x) => x.s === r2.id)!;
    expect([l1.rec, l2.rec]).toEqual([33_000, 66_000]);
    expect((await vatOf(l1.id)).map((x) => [x.cause, x.d, x.source_id])).toEqual([["line_delivery", 33_000, r1.d]]);
    expect((await vatOf(l2.id)).map((x) => [x.cause, x.d, x.source_id])).toEqual([["line_delivery", 66_000, r2.d]]);
    await drain();
    expect((await lines(`product_handed:${r2.d}:${l2.id}`, await entries(r2.d))).find((x) => x[0] === "vat_payable")).toEqual(["vat_payable", 0, 66_000]);
    await payC(inv, 999_000);
    expect([...(await portions(l1.id)), ...(await portions(l2.id))]).toEqual([0, 0]);
    expect(await glVat()).toBe(await subVat());
  });

  it("void after the hand-over → line_void reverses the delivered VAT; the re-bill recognises it again at the hand-over; the voided line's entry is mirrored; VAT once net", async () => {
    const s = await selected([{ version: tx.version, quantity: "1" }], cbc, cfo, C);
    const r = s.rows[0];
    await handC(r.d);
    const inv1 = await billC(s, [{ itemId: tx.item, quantity: 1, selectionItemId: r.id }]);
    const [l1] = await lineOfInv(inv1);
    await drain();
    const { approvalId } = await as(cfo, (db) => requestVoid(db, key(), inv1, "Salah tagih produk"));
    await as(cmgr, (db) => decideApproval(db, approvalId, true));
    expect((await vatOf(l1.id)).map((x) => [x.cause, x.d])).toEqual([["line_delivery", 33_000], ["line_void", -33_000]]);
    const inv2 = await billC(s, [{ itemId: tx.item, quantity: 1, selectionItemId: r.id }]);
    const [l2] = await lineOfInv(inv2);
    expect((await vatOf(l2.id)).map((x) => [x.cause, x.d, x.source_id])).toEqual([["line_delivery", 33_000, r.d]]);
    await payC(inv2, 333_000);
    await drain();
    const e = await entries(r.d);
    expect((await lines(`product_handed:${r.d}:${l1.id}`, e)).find((x) => x[0] === "vat_payable")).toEqual(["vat_payable", 0, 33_000]);
    expect((await lines(`product_handed:${r.d}:${l2.id}`, e)).find((x) => x[0] === "vat_payable")).toEqual(["vat_payable", 0, 33_000]);
    expect(e.filter((x) => x.kind === "reversal").find((x) => x.row[0] === "vat_payable")?.row).toEqual(["vat_payable", 33_000, 0]);
    expect(await glVat()).toBe(await subVat());
  });

  it("discount pending at issue: no VAT until the decision; the approval recognises the final line VAT (22,000 on 222,000) at the hand-over; rejection the full VAT", async () => {
    for (const approve of [true, false]) {
      const s = await selected([{ version: tx.version, quantity: "1" }], cbc, cfo, C);
      const r = s.rows[0];
      await handC(r.d);
      const inv = await billC(s, [{ itemId: tx.item, quantity: 1, selectionItemId: r.id, discount: 111_000 }]);
      const [l0] = await lineOfInv(inv);
      expect([l0.rec, await vatOf(l0.id)]).toEqual([0, []]);
      const ap = (await h.admin.query(`select discount_approval_id a from invoice_lines where id = $1`, [l0.id])).rows[0].a;
      if (approve) await as(cown, (db) => decideApproval(db, ap, true)); else await as(cown, (db) => decideApproval(db, ap, false, "Diskon tidak disetujui"));
      const [l] = await lineOfInv(inv);
      const expected = approve ? 22_000 : 33_000; // 222,000 = 200,000 + 22,000; 333,000 = 300,000 + 33,000
      expect([l.total, l.vat, l.rec]).toEqual([approve ? 222_000 : 333_000, expected, expected]);
      expect((await vatOf(l.id)).map((x) => [x.cause, x.d, x.source_id])).toEqual([["line_delivery", expected, r.d]]);
      await drain();
      expect((await lines(`product_handed:${r.d}:${l.id}`, await entries(r.d))).find((x) => x[0] === "vat_payable")).toEqual(["vat_payable", 0, expected]);
    }
    expect(await glVat()).toBe(await subVat());
  });

  it("unlinked, fractional and counter paths unchanged: no line_delivery; cross-tenant: another tenant cannot read the VAT facts or post this tenant's events", async () => {
    // billed without the link: no delivery VAT (VAT at payment as before)
    const s = await selected([{ version: tx.version, quantity: "1" }], cbc, cfo, C);
    await handC(s.rows[0].d);
    const inv = await billC(s, [{ itemId: tx.item, quantity: 1 }]);
    const [l] = await lineOfInv(inv);
    expect([l.rec, await vatOf(l.id)]).toEqual([0, []]);
    // counter sale: paid before hand-over, VAT at payment, no line_delivery
    const c = (await as(cfo, (db) => openKasirInvoice(db, key(), { counter: true }))).invoiceId;
    await as(cfo, (db) => issueKasirInvoice(db, key(), c, [{ itemId: tx.item, quantity: 1 }]));
    await payC(c, 333_000);
    const cd = (await h.admin.query(`select d.id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [c])).rows[0].id;
    await handC(cd);
    const [cl] = await lineOfInv(c);
    expect((await vatOf(cl.id)).map((x) => x.cause)).toEqual([]);
    expect(await portions(cl.id)).toEqual([33_000]);
    // cross-tenant
    expect((await as(BFO, (db) => db.query(`select count(*)::int c from vat_events where object_id = $1`, [l.id]).then((r) => r.rows[0].c, () => 0)))).toBe(0);
    const ev = (await h.admin.query(`select id from domain_events where tenant_id = $1 and type = 'ProductHandedOver' order by id desc limit 1`, [C.tenantId])).rows[0].id;
    expect(await as(BOWN, (db) => postEvent(db, { id: ev })).then(() => "ok", (e) => String(e.message))).toMatch(/ERR_FORBIDDEN/);
  });
});
