// T-060 Done-when: items, batches and FEFO of PR-17 and CLIN-019; the stock-adjustment approval attaches to the
// inbox (scenario PR-44, 02:524: a stock adjustment requested by a pharmacist is listed in Persetujuan with
// requester and reason, and the pharmacist cannot approve it). Plus the plan review: receive (expiry required,
// merge), two-tier FEFO, fitness on an injected instant (WIB vs WITA), vials, levels and low stock, counts
// (threshold, approval, moved-since-snapshot, cancel, blind), the batch ↔ movement invariant, unit freeze,
// bounded numerics, idempotency, roles, readers, events content-free, cross-tenant. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { inboxDetail, listInbox } from "../../src/modules/approvals/inbox";
import { publish } from "../../src/modules/catalog/catalog";
import {
  batchWatch, cancelCount, getCount, getItem, holdBatch, itemOptions, listCounts, listItems, openVial, receiveStock, recordCount, saveItem, setLevel,
  startCount, stockCard, stockContext, submitCount,
} from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live", tz2 = "Asia/Makassar"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Stok Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, $3) returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("S1", "Asia/Jakarta"), b2: await br("S2", tz2) };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`stk${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Stok ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e as { reason?: string }).reason ?? (e as Error).message);
const key = () => crypto.randomUUID();
// A date relative to today (branch-agnostic for days ≥ 2 away).
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const qtyOf = async (batch: string) => Number((await h.admin.query(`select quantity from stock_batches where id = $1`, [batch])).rows[0].quantity);

let A: T; let B: T;
let OWN: P; let AP: P; let FIN: P; let PU: P; let AU: P; let MGR: P; let PH: P; let PH2: P; let PHB2: P; let DOC: P; let FO: P; let NUR: P; let BPH: P;
let toxinCat: string; let gauzeCat: string; let serumCat: string;
let toxin: string; let gauze: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); FIN = await person(A, "finance"); PU = await person(A, "purchasing");
  AU = await person(A, "auditor"); MGR = await person(A, "manager", A.b1); PH = await person(A, "pharmacist", A.b1); PH2 = await person(A, "pharmacist", A.b1);
  PHB2 = await person(A, "pharmacist", A.b2); DOC = await person(A, "doctor", A.b1); FO = await person(A, "fo_cashier", A.b1); NUR = await person(A, "nurse", A.b1);
  BPH = await person(B, "pharmacist", B.b1);
  const pub = async (kind: "material" | "product", c: string, name: string) =>
    (await as(OWN, (db) => publish(db, { kind, code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Barang baru"))).itemId;
  toxinCat = await pub("product", "STK-TOX", "Toksin Botulinum 100U");
  gauzeCat = await pub("material", "STK-KAS", "Kasa Steril");
  serumCat = await pub("product", "STK-SRM", "Serum Vitamin C");
  toxin = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: toxinCat, unit: "U", vialSize: "100", openedUseHours: 24, storage: "dingin", highValue: true, active: true }))).itemId;
  gauze = (await as(PU, (db) => saveItem(db, key(), null, { catalogItemId: gauzeCat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("Master Item (open point 1)", () => {
  it("one stock item per catalog material or product; writers pharmacist, purchasing, admin pusat; catalog name through the definer", async () => {
    expect(await code(as(PH, (db) => saveItem(db, key(), null, { catalogItemId: toxinCat, unit: "U", storage: "dingin", highValue: true, active: true })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    for (const p of [MGR, OWN, FIN, AU, DOC, FO, NUR]) expect(await code(as(p, (db) => saveItem(db, key(), null, { catalogItemId: serumCat, unit: "ml", storage: "ruang", highValue: false, active: true })))).toBe("ERR_FORBIDDEN");
    const svc = (await as(OWN, (db) => publish(db, { kind: "service", code: "STK-SVC" }, { name: "Facial", tax_category: "exempt_medical", tax_basis: "Jasa", normal_price: 1_000 } as never, "Layanan"))).itemId;
    expect(await code(as(AP, (db) => saveItem(db, key(), null, { catalogItemId: svc, unit: "x", storage: "ruang", highValue: false, active: true })))).toBe("ERR_NOT_FOUND");
    expect((await as(AP, (db) => itemOptions(db))).map((o) => o.code)).toEqual(["STK-SRM"]);
    // purchasing cannot read catalog_versions but sees the name through the reader
    const list = await as(PU, (db) => listItems(db, A.b1));
    expect(list.map((i) => [i.code, i.name, i.unit])).toEqual([["STK-KAS", "Kasa Steril", "pcs"], ["STK-TOX", "Toksin Botulinum 100U", "U"]]);
    expect((await as(PU, (db) => db.query(`select name from catalog_versions`))).rowCount).toBe(0);
  });

  it("vial fields together; unit and vial size frozen once used (DATA-4); bounded numerics refuse NaN and Infinity", async () => {
    expect(await code(as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serumCat, unit: "ml", vialSize: "10", storage: "ruang", highValue: false, active: true })))).toBe("ERR_INVALID_INPUT");
    const serum = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serumCat, unit: "ml", storage: "ruang", highValue: false, active: true }))).itemId;
    await as(PH, (db) => saveItem(db, key(), serum, { unit: "botol", storage: "sejuk", highValue: false, active: true })); // unused: free
    await as(PH, (db) => receiveStock(db, key(), null, { itemId: serum, batchNo: "SRM-1", expiry: day(200), quantity: "5", reason: "stok_awal" }));
    expect(await code(as(PH, (db) => saveItem(db, key(), serum, { unit: "ml", storage: "sejuk", highValue: false, active: true })))).toBe("ERR_VERSION_CONFLICT");
    await as(PH, (db) => saveItem(db, key(), serum, { unit: "botol", storage: "dingin", highValue: true, active: true })); // other fields still change
    for (const bad of ["NaN", "Infinity", "-Infinity", "0.00001"]) {
      expect(await code(h.admin.query(`insert into stock_levels (tenant_id, branch_id, item_id, min_qty, target_qty, updated_by, updated_as)
                                       values ($1, $2, $3, $4::numeric, 1, $5, 'pharmacist')`, [A.tenantId, A.b2, serum, bad, PH.staffId]))).toBe("raw:23514");
    }
    expect(await code(as(PH, (db) => setLevel(db, key(), null, serum, "1", "NaN")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => setLevel(db, key(), null, serum, "1", "1e3")))).toBe("ERR_INVALID_INPUT"); // the database would read 1000
  });
});

describe("Terima Stok (open point 2)", () => {
  it("expiry required and after the branch-local today; merge into the same batch; a recalled batch is not refilled; pharmacist at its branch, purchasing names one", async () => {
    const r = (exp: string, q = "10", b = "TOX-A") => ({ itemId: toxin, batchNo: b, expiry: exp, quantity: q, reason: "penerimaan" as const });
    expect(await code(as(PH, (db) => receiveStock(db, key(), null, r(""))))).toBe("ERR_INVALID_INPUT");
    expect(await reason(as(PH, (db) => receiveStock(db, key(), null, r(day(0)))))).toBe("expired");
    expect(await code(as(PH, (db) => receiveStock(db, key(), null, r(day(-3)))))).toBe("ERR_STOCK_UNFIT");
    expect(await code(as(PH, (db) => receiveStock(db, key(), null, r(day(90), "0"))))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => receiveStock(db, key(), A.b2, r(day(90)))))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PU, (db) => receiveStock(db, key(), null, r(day(90)))))).toBe("ERR_INVALID_INPUT"); // purchasing must name a branch
    for (const p of [MGR, OWN, AP, AU, DOC]) expect(await code(as(p, (db) => receiveStock(db, key(), A.b1, r(day(90)))))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PU, (db) => receiveStock(db, key(), B.b1, r(day(90)))))).toBe("ERR_NOT_FOUND"); // another tenant's branch
    expect(await code(as(PU, (db) => setLevel(db, key(), B.b1, gauze, "1", "2")))).toBe("ERR_NOT_FOUND");
    const b1 = (await as(PH, (db) => receiveStock(db, key(), null, r(day(90), "300")))).batchId;
    const again = (await as(PU, (db) => receiveStock(db, key(), A.b1, r(day(90), "100")))).batchId;
    expect(again).toBe(b1);
    expect(await qtyOf(b1)).toBe(400);
    const card = await as(PH, (db) => stockCard(db, toxin, null));
    expect(card.map((m) => [m.kind, m.quantity, m.balance_after])).toEqual([["receive", 100, 400], ["receive", 300, 300]]);
  });

  it("idempotent: the same key replays without a second movement; another body with the key is a conflict", async () => {
    const k = key();
    const body = { itemId: gauze, batchNo: "KAS-1", expiry: day(400), quantity: "50", reason: "stok_awal" as const };
    const one = await as(PH, (db) => receiveStock(db, k, null, body));
    const two = await as(PH, (db) => receiveStock(db, k, null, body));
    expect([one.replayed, two.replayed, two.batchId]).toEqual([false, true, one.batchId]);
    expect(await qtyOf(one.batchId)).toBe(50);
    expect(await code(as(PH, (db) => receiveStock(db, k, null, { ...body, quantity: "51" })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
  });
});

describe("CLIN-019 fitness and FEFO (open point 5)", () => {
  it("FEFO takes the fit open vial first, then sealed stock by expiry; never an expired, recalled, quarantined batch or a lapsed vial", async () => {
    const cat = (await as(OWN, (db) => publish(db, { kind: "product", code: "STK-FEF" }, { name: "Toksin FEFO", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Baru"))).itemId;
    const it2 = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "U", vialSize: "100", openedUseHours: 6, storage: "dingin", highValue: true, active: true }))).itemId;
    const late = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: it2, batchNo: "LATE", expiry: day(300), quantity: "300", reason: "penerimaan" }))).batchId;
    const early = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: it2, batchNo: "EARLY", expiry: day(60), quantity: "100", reason: "penerimaan" }))).batchId;
    const hold = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: it2, batchNo: "HOLD", expiry: day(30), quantity: "100", reason: "penerimaan" }))).batchId;
    await as(PH, (db) => openVial(db, key(), late));
    await h.admin.query(`update opened_vials set remaining = 40 where batch_id = $1`, [late]); // 60 U used (T-062 writes this; the guard allows only down)
    expect(Number((await h.admin.query(`select remaining from opened_vials where batch_id = $1`, [late])).rows[0].remaining)).toBe(40);
    await as(PH, (db) => holdBatch(db, key(), hold, "quarantined", "Suhu kulkas tidak tercatat"));
    const fefo = async (q: number, at = "now()") =>
      (await h.admin.query(`select batch_id, vial_id is not null as vial, take from stock_fefo($1, $2, $3, $4, ${at})`, [A.tenantId, A.b1, it2, q])).rows.map((r) => [r.batch_id, r.vial, Number(r.take)]);
    expect(await fefo(100)).toEqual([[late, true, 40], [early, false, 60]]);
    expect(await fefo(400)).toEqual([[late, true, 40], [early, false, 100], [late, false, 260]]);
    expect(await code(h.admin.query(`select * from stock_fefo($1, $2, $3, 401)`, [A.tenantId, A.b1, it2]))).toMatch(/raw:P0422/);
    // the vial lapses after 6 h: its 40 U are unfit; FEFO skips them, the batch's sealed part stays fit
    const later = `now() + interval '7 hours'`;
    expect(await fefo(100, later)).toEqual([[early, false, 100]]);
    expect(await fefo(360, later)).toEqual([[early, false, 100], [late, false, 260]]);
    // assert_fit: quarantined, recalled, expired, lapsed vial, insufficient
    const fit = (b: string, q: number, at = "now()") =>
      h.admin.query(`select stock_assert_fit($1, $2, $3, ${at})`, [A.tenantId, b, q]).then(() => "ok", (e) => (e as Error).message);
    expect(await fit(hold, 1)).toBe("ERR_STOCK_UNFIT: quarantined");
    expect(await fit(early, 1, `now() + interval '61 days'`)).toBe("ERR_STOCK_UNFIT: expired");
    expect(await fit(late, 290, later)).toBe("ERR_STOCK_UNFIT: vial_lapsed");
    expect(await fit(late, 301)).toBe("ERR_STOCK_INSUFFICIENT: not enough stock in the batch");
    expect(await fit(late, 300)).toBe("ok");
    await as(PH, (db) => holdBatch(db, key(), hold, "recalled", "Recall BPOM"));
    expect(await fit(hold, 1)).toBe("ERR_STOCK_UNFIT: recalled");
    expect(await code(as(PH, (db) => holdBatch(db, key(), hold, "active", null)))).toBe("ERR_VERSION_CONFLICT"); // recalled is final
    expect(await code(h.admin.query(`update stock_batches set state = 'active', hold_reason = null, held_by = null, held_at = null where id = $1`, [hold]))).toBe("raw:42501");
    expect(await code(as(PHB2, (db) => holdBatch(db, key(), early, "quarantined", "Cabang lain")))).toBe("ERR_NOT_FOUND");
    expect(await reason(as(PH, (db) => receiveStock(db, key(), null, { itemId: it2, batchNo: "HOLD", expiry: day(30), quantity: "1", reason: "penerimaan" })))).toBe("recalled");
    // the item page shows the next FEFO pick and fitness
    const d = await as(PH, (db) => getItem(db, it2, null));
    expect([d.next_batch_id, d.batches.map((b) => [b.batch_no, b.unfit])]).toEqual([late, [["HOLD", "recalled"], ["EARLY", null], ["LATE", null]]]);
  });

  it("the expiry day is judged in the branch's time zone: 16:30 UTC is the next day in WITA but not in WIB", async () => {
    const cat = (await as(OWN, (db) => publish(db, { kind: "material", code: "STK-TZ" }, { name: "Alkohol Swab", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Baru"))).itemId;
    const it3 = (await as(PU, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    const at = new Date(Date.now() + 10 * 86_400_000);
    const utc = `${at.toISOString().slice(0, 10)}T16:30:00Z`;
    const expiry = new Date(Date.parse(utc) + 86_400_000).toISOString().slice(0, 10); // the next UTC date
    const w = (await as(PU, (db) => receiveStock(db, key(), A.b1, { itemId: it3, batchNo: "TZ-WIB", expiry, quantity: "5", reason: "penerimaan" }))).batchId;
    const m = (await as(PU, (db) => receiveStock(db, key(), A.b2, { itemId: it3, batchNo: "TZ-WITA", expiry, quantity: "5", reason: "penerimaan" }))).batchId;
    const unfit = async (b: string) => (await h.admin.query(`select stock_unfit_reason(x, $2::timestamptz) as r from stock_batches x where id = $1`, [b, utc])).rows[0].r;
    expect([await unfit(w), await unfit(m)]).toEqual([null, "expired"]); // 23:30 WIB (still the day before) vs 00:30 WITA (expiry day)
  });
});

describe("opened vials (open point 4)", () => {
  it("vial items only; one open vial per batch; remaining is least(vial size, batch quantity); use-by from the item's hours; pharmacist only", async () => {
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: toxin, batchNo: "TOX-V", expiry: day(120), quantity: "30", reason: "penerimaan" }))).batchId;
    for (const p of [MGR, PU, DOC, NUR]) expect(await code(as(p, (db) => openVial(db, key(), b)))).toBe("ERR_FORBIDDEN");
    const { vialId } = await as(PH, (db) => openVial(db, key(), b));
    // HYG-016: one clock read — use-by is exactly 24 h after opening (two reads made it 24 h + 1 us).
    const v = (await h.admin.query(`select remaining, use_by - opened_at = interval '24 hours' as exact from opened_vials where id = $1`, [vialId])).rows[0];
    expect([Number(v.remaining), v.exact]).toEqual([30, true]);
    expect(await code(as(PH2, (db) => openVial(db, key(), b)))).toBe("ERR_VERSION_CONFLICT");
    const g = (await h.admin.query(`select id from stock_batches where item_id = $1 limit 1`, [gauze])).rows[0].id;
    expect(await code(as(PH, (db) => openVial(db, key(), g)))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PHB2, (db) => openVial(db, key(), b)))).toBe("ERR_NOT_FOUND");
    // a lapsed open vial is closed as lapsed when the next one opens
    await h.admin.query(`alter table opened_vials disable trigger opened_vials_guard`);
    await h.admin.query(`update opened_vials set opened_at = now() - interval '30 hours', use_by = now() - interval '6 hours' where id = $1`, [vialId]);
    await h.admin.query(`alter table opened_vials enable always trigger opened_vials_guard`);
    const { vialId: v2 } = await as(PH, (db) => openVial(db, key(), b));
    expect((await h.admin.query(`select id, state from opened_vials where batch_id = $1 order by opened_at`, [b])).rows.map((r) => r.state)).toEqual(["lapsed", "open"]);
    expect(v2).not.toBe(vialId);
    // The reopened vial: exact use-by; the lapsed one closed at the reopening's clock read (HYG-016).
    expect((await h.admin.query(`select n.use_by - n.opened_at = interval '24 hours' as exact, o.closed_at = n.opened_at as same
      from opened_vials n, opened_vials o where n.id = $1 and o.id = $2`, [v2, vialId])).rows[0]).toEqual({ exact: true, same: true });
  });
});

describe("min/target and low stock (open point 6)", () => {
  it("pharmacist at its branch, purchasing names one; target ≥ min; the list flags fit quantity below min", async () => {
    expect(await code(as(PH, (db) => setLevel(db, key(), null, gauze, "100", "50")))).toBe("ERR_INVALID_INPUT");
    await as(PH, (db) => setLevel(db, key(), null, gauze, "60", "200"));
    await as(PU, (db) => setLevel(db, key(), A.b2, gauze, "1", "2"));
    for (const p of [MGR, OWN, AP, AU]) expect(await code(as(p, (db) => setLevel(db, key(), A.b1, gauze, "1", "2")))).toBe("ERR_FORBIDDEN");
    const row = (await as(MGR, (db) => listItems(db, null))).find((i) => i.id === gauze)!;
    expect([row.fit_quantity, row.min_qty, row.low]).toEqual([50, 60, true]);
    expect((await as(PU, (db) => listItems(db, A.b2))).find((i) => i.id === gauze)!.min_qty).toBe(1);
  });
});

describe("counts and the stock_adjustment approval (open point 7; scenario PR-44)", () => {
  let gb: string;
  beforeAll(async () => {
    gb = (await h.admin.query(`select id from stock_batches where item_id = $1 and branch_id = $2 and batch_no = 'KAS-1'`, [gauze, A.b1])).rows[0].id;
  });

  it("within SET-43's 2 %: the adjustment applies at once with one adjust movement", async () => {
    const { countId } = await as(PH, (db) => startCount(db, key(), false, [gauze]));
    const c = await as(PH, (db) => getCount(db, countId));
    expect(c.lines.map((l) => [l.batch_no, l.system_qty])).toEqual([["KAS-1", 50]]);
    expect(await code(as(PH, (db) => submitCount(db, key(), countId, "Opname mingguan")))).toBe("ERR_INVALID_INPUT"); // uncounted
    await as(PH, (db) => recordCount(db, key(), countId, c.lines[0].id, "49"));
    expect((await as(PH, (db) => submitCount(db, key(), countId, "Opname mingguan"))).state).toBe("applied");
    expect(await qtyOf(gb)).toBe(49);
    const m = (await as(PH, (db) => stockCard(db, gauze, null)))[0];
    expect([m.kind, m.quantity, m.balance_after, m.source_kind, m.reason]).toEqual(["adjust", -1, 49, "stock_count", "Opname mingguan"]);
    expect(Number((await h.admin.query(`select threshold_pct from stock_counts where id = $1`, [countId])).rows[0].threshold_pct)).toBe(2);
  });

  it("PR-44: above the threshold the pharmacist's count waits in Persetujuan with requester and reason; the pharmacist cannot approve; the owner approves and the adjustment applies", async () => {
    const { countId } = await as(PH, (db) => startCount(db, key(), true, [gauze]));
    const c = await as(PH, (db) => getCount(db, countId));
    expect(c.lines[0].system_qty).toBeNull(); // blind
    expect(await code(as(PH, (db) => db.query(`select system_qty from stock_count_lines`)))).toBe("raw:42501"); // not granted
    await as(PH, (db) => recordCount(db, key(), countId, c.lines[0].id, "40"));
    expect((await as(PH, (db) => submitCount(db, key(), countId, "Selisih kasa gudang"))).state).toBe("pending_approval");
    expect(await qtyOf(gb)).toBe(49);
    const { rows } = await as(OWN, (db) => listInbox(db, "owner"));
    const row = rows.find((r) => r.type === "stock_adjustment")!;
    const phName = (await h.admin.query(`select display_name from staff where id = $1`, [PH.staffId])).rows[0].display_name;
    expect([row.typeLabel, row.requestedAs, row.reason, row.subjectKind, row.requesterName]).toEqual(["Penyesuaian stok", "pharmacist", "Selisih kasa gudang", "stock_count", phName]);
    expect(await code(as(PH, (db) => decideApproval(db, row.id, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await code(as(PH2, (db) => decideApproval(db, row.id, true)))).toBe("ERR_NOT_FOUND"); // a pharmacist neither reads nor decides it
    const det = await as(OWN, (db) => inboxDetail(db, { staffId: OWN.staffId, role: "owner" }, row.id));
    expect(det?.blocked).toBeNull();
    expect(await as(OWN, (db) => decideApproval(db, row.id, true))).toBe("approved");
    expect(await qtyOf(gb)).toBe(40);
    expect((await as(PH, (db) => getCount(db, countId))).lines[0]).toMatchObject({ system_qty: 49, counted_qty: 40, difference: -9 });
    const m = (await as(MGR, (db) => stockCard(db, gauze, null)))[0];
    expect([m.kind, m.quantity, m.created_as]).toEqual(["adjust", -9, "owner"]);
  });

  it("rejected: nothing changes; a batch that moved since the count started fails the approval closed (ERR_VERSION_CONFLICT)", async () => {
    const one = await as(PH, (db) => startCount(db, key(), false, [gauze]));
    const l1 = (await as(PH, (db) => getCount(db, one.countId))).lines[0].id;
    await as(PH, (db) => recordCount(db, key(), one.countId, l1, "10"));
    await as(PH, (db) => submitCount(db, key(), one.countId, "Banyak hilang"));
    const ap1 = (await h.admin.query(`select approval_id from stock_counts where id = $1`, [one.countId])).rows[0].approval_id;
    expect(await as(MGR, (db) => decideApproval(db, ap1, false, "Hitung ulang"))).toBe("rejected");
    expect([await qtyOf(gb), (await as(PH, (db) => getCount(db, one.countId))).state]).toEqual([40, "rejected"]);
    // moved after submit: the approval fails, nothing applied, the count stays pending
    const two = await as(PH, (db) => startCount(db, key(), false, [gauze]));
    const l2 = (await as(PH, (db) => getCount(db, two.countId))).lines[0].id;
    expect(await code(as(PH2, (db) => startCount(db, key(), false, [gauze])))).toBe("ERR_VERSION_CONFLICT"); // overlapping open count
    await as(PH, (db) => recordCount(db, key(), two.countId, l2, "20"));
    await as(PH, (db) => submitCount(db, key(), two.countId, "Kasa rusak"));
    await as(PH, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "KAS-1", expiry: day(400), quantity: "5", reason: "penerimaan" }));
    const ap2 = (await h.admin.query(`select approval_id from stock_counts where id = $1`, [two.countId])).rows[0].approval_id;
    expect(await code(as(OWN, (db) => decideApproval(db, ap2, true)))).toBe("ERR_VERSION_CONFLICT");
    expect([await qtyOf(gb), (await as(PH, (db) => getCount(db, two.countId))).state]).toEqual([45, "pending_approval"]);
    // the requester cancels: the approval and the count cancel together
    expect(await code(as(PH2, (db) => cancelCount(db, key(), two.countId)))).toBe("ERR_NOT_FOUND"); // not the requester
    await as(PH, (db) => cancelCount(db, key(), two.countId));
    expect((await h.admin.query(`select c.state, a.state as a from stock_counts c join approvals a on a.id = c.approval_id where c.id = $1`, [two.countId])).rows[0]).toEqual({ state: "cancelled", a: "cancelled" });
    // moved while still a draft: submit refuses
    const three = await as(MGR, (db) => startCount(db, key(), false, [gauze]));
    const l3 = (await as(MGR, (db) => getCount(db, three.countId))).lines[0].id;
    await as(MGR, (db) => recordCount(db, key(), three.countId, l3, "45"));
    await as(PH, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "KAS-1", expiry: day(400), quantity: "1", reason: "penerimaan" }));
    expect(await code(as(MGR, (db) => submitCount(db, key(), three.countId, "Opname")))).toBe("ERR_VERSION_CONFLICT");
    await as(MGR, (db) => cancelCount(db, key(), three.countId));
    expect((await as(MGR, (db) => listCounts(db, null))).find((c) => c.id === three.countId)!.state).toBe("cancelled");
  });

  it("who counts: pharmacist and manager at their branch; a count of another branch is not found", async () => {
    for (const p of [OWN, AP, PU, AU, FIN, DOC, NUR, FO]) expect(await code(as(p, (db) => startCount(db, key(), false, [])))).toBe("ERR_FORBIDDEN");
    const { countId } = await as(PH, (db) => startCount(db, key(), false, [toxin]));
    expect(await code(as(PHB2, (db) => getCount(db, countId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(PHB2, (db) => cancelCount(db, key(), countId)))).toBe("ERR_NOT_FOUND");
    const line = (await h.admin.query(`select id from stock_count_lines where count_id = $1 limit 1`, [countId])).rows[0].id;
    expect(await code(as(PHB2, (db) => recordCount(db, key(), countId, line, "1")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(PHB2, (db) => submitCount(db, key(), countId, "Cabang lain")))).toBe("ERR_NOT_FOUND");
    await as(PH, (db) => cancelCount(db, key(), countId));
  });
});

describe("the batch ↔ movement invariant and the guards (plan P1-2)", () => {
  it("a quantity changes only by a movement; a movement continues the balance; movements are never changed or deleted; nothing goes negative", async () => {
    const b = (await h.admin.query(`select * from stock_batches where item_id = $1 and batch_no = 'KAS-1'`, [gauze])).rows[0];
    expect(await code(h.admin.query(`update stock_batches set quantity = quantity + 1 where id = $1`, [b.id]))).toBe("raw:42501");
    expect(await code(h.admin.query(`update stock_batches set quantity = (select balance_after from stock_movements where batch_id = $1 order by seq limit 1) where id = $1`, [b.id]))).toBe("raw:42501");
    expect(await code(h.admin.query(
      `insert into stock_movements (tenant_id, branch_id, item_id, batch_id, kind, quantity, balance_after, source_kind, source_id, created_by, created_as)
       values ($1, $2, $3, $4, 'adjust', 1, 999, 'test', gen_random_uuid(), $5, 'pharmacist')`, [b.tenant_id, b.branch_id, b.item_id, b.id, PH.staffId]))).toBe("raw:42501");
    // a movement that does not continue the balance (it would leave the batch unchanged: no batch change to check)
    expect(await code(h.admin.query(
      `insert into stock_movements (tenant_id, branch_id, item_id, batch_id, kind, quantity, balance_after, source_kind, source_id, created_by, created_as)
       values ($1, $2, $3, $4, 'adjust', 1, $5, 'test', gen_random_uuid(), $6, 'pharmacist')`, [b.tenant_id, b.branch_id, b.item_id, b.id, b.quantity, PH.staffId]))).toBe("raw:42501");
    expect(await code(h.admin.query(`update stock_movements set reason = 'x' where batch_id = $1`, [b.id]))).toBe("raw:42501");
    expect(await code(h.admin.query(`delete from stock_movements where batch_id = $1`, [b.id]))).toBe("raw:42501");
    // even an update that keeps the arithmetic consistent (the newest movement's balance moved by its own quantity)
    expect(await code(h.admin.query(`update stock_movements set balance_after = balance_after + quantity where id = (select id from stock_movements where batch_id = $1 order by seq desc limit 1)`, [b.id]))).toBe("raw:42501");
    // the guards fire with replication triggers off too (ENABLE ALWAYS)
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      expect(await code(h.admin.query(`delete from stock_movements where batch_id = $1`, [b.id]))).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
    expect(await code(h.admin.query(`delete from stock_batches where id = $1`, [b.id]))).toBe("raw:42501");
    // refused: by the truncate trigger, or (since T-063's stock_movement_values references movements) by the FK first
    expect(await code(h.admin.query(`truncate stock_movements`))).toMatch(/^raw:(42501|0A000)$/);
    expect(await code(h.admin.query(`truncate stock_movements cascade`))).toBe("raw:42501");
    expect(await code(h.admin.query(`insert into stock_batches (tenant_id, branch_id, item_id, batch_no, expiry, quantity) values ($1, $2, $3, 'X-1', $4, 5)`, [b.tenant_id, b.branch_id, b.item_id, day(90)]))).toBe("raw:42501");
    expect(await code(h.admin.query(`select stock_move($1, $2, 'adjust', -100000, null, 'test', gen_random_uuid(), $3, 'pharmacist')`, [b.tenant_id, b.id, PH.staffId]))).toBe("raw:P0422");
    // every batch equals the sum of its movements, and the newest balance_after
    const bad = await h.admin.query(`select b.id from stock_batches b left join lateral (select sum(m.quantity) s, (array_agg(m.balance_after order by m.seq desc))[1] last from stock_movements m where m.batch_id = b.id) m on true
                                      where b.quantity <> coalesce(m.s, 0) or b.quantity <> coalesce(m.last, 0)`);
    expect(bad.rows).toEqual([]);
  });

  it("a cross-branch or cross-item batch reference is refused by the composite keys", async () => {
    const b = (await h.admin.query(`select * from stock_batches where item_id = $1 and batch_no = 'KAS-1'`, [gauze])).rows[0];
    expect(await code(h.admin.query(
      `insert into stock_movements (tenant_id, branch_id, item_id, batch_id, kind, quantity, balance_after, source_kind, source_id, created_by, created_as)
       values ($1, $2, $3, $4, 'adjust', 1, 1, 'test', gen_random_uuid(), $5, 'pharmacist')`, [b.tenant_id, A.b2, b.item_id, b.id, PH.staffId]))).toMatch(/raw:(23503|42501)/);
    expect(await code(h.admin.query(
      `insert into stock_movements (tenant_id, branch_id, item_id, batch_id, kind, quantity, balance_after, source_kind, source_id, created_by, created_as)
       values ($1, $2, $3, $4, 'adjust', 1, 1, 'test', gen_random_uuid(), $5, 'pharmacist')`, [b.tenant_id, b.branch_id, toxin, b.id, PH.staffId]))).toMatch(/raw:(23503|42501)/);
  });
});

describe("readers and roles (open point 8)", () => {
  it("tenant-wide readers name a branch; branch readers see their branch only; others are refused; RLS on the wall clock", async () => {
    expect((await as(AU, (db) => listItems(db, A.b1))).length).toBeGreaterThan(1);
    expect((await as(FIN, (db) => batchWatch(db, A.b1))).near_expiry_days).toBe(30);
    expect(await code(as(AU, (db) => listItems(db, null)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(PH, (db) => listItems(db, A.b2)))).toBe("ERR_NOT_FOUND");
    for (const p of [DOC, NUR, FO]) expect(await code(as(p, (db) => stockContext(db)))).toBe("ERR_FORBIDDEN");
    expect((await as(PHB2, (db) => db.query(`select count(*)::int as n from stock_batches where branch_id = $1`, [A.b1]))).rows[0].n).toBe(0);
    expect((await as(PU, (db) => db.query(`select count(*)::int as n from stock_batches where branch_id = $1`, [A.b1]))).rows[0].n).toBeGreaterThan(0);
    expect((await as(DOC, (db) => db.query(`select count(*)::int as n from stock_items`))).rows[0].n).toBe(0);
    // wall clock: a pharmacist whose branch role is removed reads nothing at once, though the session still allows it
    // (held at another branch too: only the assignment to the row's branch counts)
    const tmp = await person(A, "pharmacist", A.b2, A.b1);
    const ctxTmp = await resolveContext(app, tmp.acc, { tenantId: A.tenantId, actingRole: "pharmacist", activeBranchId: A.b1 });
    const seen = () => withTenantContext(app, ctxTmp, async (db) => (await db.query(`select count(*)::int as n from stock_batches where branch_id = $1`, [A.b1])).rows[0].n as number);
    expect(await seen()).toBeGreaterThan(0);
    await h.admin.query(`delete from staff_branches where staff_id = $1 and branch_id = $2`, [tmp.staffId, A.b1]);
    expect(await seen()).toBe(0);
    const ctx = await as(PU, (db) => stockContext(db));
    expect([ctx.can_receive, ctx.can_count, ctx.can_hold, ctx.branches.length]).toEqual([true, false, false, 2]);
  });

  it("the watch lists unfit, held and near-expiry batches and open vials", async () => {
    const w = await as(PH, (db) => batchWatch(db, null));
    expect(w.batches.some((b) => b.batch_no === "HOLD" && b.unfit === "recalled")).toBe(true);
    expect(w.batches.some((b) => b.batch_no === "KAS-1")).toBe(false); // 400 days away
    expect(w.vials.length).toBeGreaterThan(0);
  });
});

describe("Kartu Stok masking for patient-linked movements (IAM-12; ready for T-062/T-065)", () => {
  it("purchasing and auditor see a consume movement without reason or source; the pharmacist sees both", async () => {
    const b = (await h.admin.query(`select * from stock_batches where item_id = $1 and batch_no = 'KAS-1'`, [gauze])).rows[0];
    const src = crypto.randomUUID();
    await h.admin.query(`select stock_move($1, $2, 'consume', -1, 'Pasien Rahasia Kartu', 'treatment', $3, $4, 'pharmacist')`, [b.tenant_id, b.id, src, PH.staffId]);
    const top = async (p: P) => (await as(p, (db) => stockCard(db, gauze, A.b1)))[0];
    for (const p of [PU, AU]) expect(await top(p)).toMatchObject({ kind: "consume", reason: null, source_id: null });
    expect(await top(PH)).toMatchObject({ kind: "consume", reason: "Pasien Rahasia Kartu", source_id: src });
  });
});

describe("audit, events and exit", () => {
  it("events carry ids and codes only; audit rows have no reason text", async () => {
    const ev = (await h.admin.query(`select type, payload::text p from domain_events where tenant_id = $1 and type like 'Stock%'`, [A.tenantId])).rows;
    expect(new Set(ev.map((e) => e.type))).toEqual(new Set(["StockReceived", "StockBatchHeld", "StockCountSubmitted", "StockAdjusted"]));
    expect(ev.map((e) => e.p).join(" ")).not.toMatch(/kasa|selisih|suhu|toksin|opname|\d+\.\d|"quantity"|"name"/i);
    expect((await h.admin.query(`select count(*)::int n from audit_events where tenant_id = $1 and object_kind like 'stock%' and reason is not null`, [A.tenantId])).rows[0].n).toBe(0);
  });

  it("an exited tenant cannot change stock; an onboarding tenant can (configuration)", async () => {
    const E = await tenant("exit");
    const EPH = await person(E, "pharmacist", E.b1);
    expect(await code(as(EPH, (db) => startCount(db, key(), false, [])))).toBe("ERR_TENANT_SUSPENDED");
    const O = await tenant("onboarding");
    const OPU = await person(O, "purchasing");
    const OOWN = await person(O, "owner");
    const cat = (await as(OOWN, (db) => publish(db, { kind: "material", code: "ONB-1" }, { name: "Kapas", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Baru"))).itemId;
    const it = (await as(OPU, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    expect(await code(as(OPU, (db) => receiveStock(db, key(), O.b1, { itemId: it, batchNo: "O-1", expiry: day(100), quantity: "3", reason: "stok_awal" })))).toBe("ok");
  });
});

describe("cross-tenant", () => {
  it("B's pharmacist neither reads nor writes A's items, batches or counts", async () => {
    const b = (await h.admin.query(`select id from stock_batches where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].id;
    expect(await code(as(BPH, (db) => getItem(db, toxin, null)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => openVial(db, key(), b)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => holdBatch(db, key(), b, "quarantined", "Coba tahan")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => receiveStock(db, key(), null, { itemId: toxin, batchNo: "B-1", expiry: day(90), quantity: "1", reason: "stok_awal" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => setLevel(db, key(), null, toxin, "1", "2")))).toBe("ERR_NOT_FOUND");
    expect((await as(BPH, (db) => listItems(db, null))).length).toBe(0);
    expect((await as(BPH, (db) => db.query(`select count(*)::int n from stock_movements`))).rows[0].n).toBe(0);
  });
});
