// T-035 Done-when: a branch price override is stored owner-only and effective-dated; Admin Pusat
// cannot override (PR-42, IAM-11, SET-5). Plus the plan review: the cashier reads the effective price
// (definer); another tenant's or an unknown branch never falls back to the normal price; a write "now"
// follows the row in force; branch timezones; an Owner with another branch selected; scheduled changes;
// cancellation only before the effective time; immutability; materials excluded; audit and events;
// vendor support class; cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { cancelBranchPrice, effectiveFromDate, effectivePrice, priceRows, setBranchPrice, summarise } from "../../src/modules/catalog/prices/prices";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string; mks: string; jyp: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Harga Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz = "Asia/Jakarta") =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, $3) returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("H1"), b2: await br("H2"), mks: await br("MKS", "Asia/Makassar"), jyp: await br("JYP", "Asia/Jayapura") };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`hrg${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Harga ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const b = TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1;
  if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: b };
}
// `branch` selects an active branch for a tenant-wide role too (HYG-009 N2).
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const later = (days: number) => new Date(Date.now() + days * 86_400_000);

let A: T;
let B: T;
let OWN: P; let AP: P; let MGR: P; let FO: P; let FIN: P; let DOC: P;
let facial: string; // service at Rp500,000
let serum: string; // product at Rp250,000
let bahan: string; // material
const FACIAL = { name: "Facial Brightening", tax_category: "exempt_medical" as const, tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 500_000 };

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner");
  AP = await person(A, "admin_pusat");
  MGR = await person(A, "manager", A.b1);
  FO = await person(A, "fo_cashier", A.b2);
  FIN = await person(A, "finance");
  DOC = await person(A, "doctor", A.b1);
  facial = (await as(MGR, (db) => publish(db, { kind: "service", code: "FAC-H1" }, FACIAL, "Layanan baru"))).itemId;
  serum = (await as(MGR, (db) => publish(db, { kind: "product", code: "SRM-H1" }, { name: "Serum", tax_category: "taxable_goods", tax_basis: "Barang kena pajak", normal_price: 250_000 }, "Produk baru"))).itemId;
  bahan = (await as(MGR, (db) => publish(db, { kind: "material", code: "BHP-H1" }, { name: "Kasa", tax_category: "non_object", tax_basis: "Bahan habis pakai", normal_price: 1_000 }, "Bahan baru"))).itemId;
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("T-035 Done-when: owner-only, effective-dated override", () => {
  it("scenario PR-42 (price half): a facial at Rp500,000 and an override of Rp450,000 at branch B; branch B reads Rp450,000, branch A the normal price", async () => {
    const r = await as(OWN, (db) => setBranchPrice(db, { itemId: facial, branchId: A.b2, price: 450_000, effectiveFrom: null, reason: "Harga khusus cabang H2" }));
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    // Later in the same transaction too (the reader defaults to the wall clock).
    expect(await as(OWN, async (db) => {
      await setBranchPrice(db, { itemId: serum, branchId: A.b2, price: 240_000, effectiveFrom: null, reason: "Harga khusus" });
      return effectivePrice(db, serum, A.b2);
    })).toBe(240_000);
    expect(await as(FO, (db) => effectivePrice(db, facial, A.b2))).toBe(450_000);
    expect(await as(FO, (db) => effectivePrice(db, facial, A.b1))).toBe(500_000);
  });

  it("Admin Pusat, Manager, finance, the cashier and the doctor cannot set or cancel a branch price", async () => {
    const scheduled = await as(OWN, (db) => setBranchPrice(db, { itemId: serum, branchId: A.b1, price: 230_000, effectiveFrom: later(10), reason: "Promo bulan depan" }));
    for (const p of [AP, MGR, FIN, FO, DOC]) {
      expect(await code(as(p, (db) => setBranchPrice(db, { itemId: facial, branchId: A.b1, price: 1, effectiveFrom: null, reason: "Coba ubah" }))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => cancelBranchPrice(db, scheduled.id))), p.role).toBe("ERR_FORBIDDEN");
    }
    expect((await h.admin.query(`select state from branch_prices where id = $1`, [scheduled.id])).rows[0].state).toBe("active");
    // The application role writes the table only through the functions.
    await expect(as(OWN, (db) => db.query(`insert into branch_prices (tenant_id, branch_id, item_id, price, effective_from, reason, created_by, created_as) values ($1, $2, $3, 1, now(), 'langsung', $4, 'owner')`, [A.tenantId, A.b1, facial, OWN.staffId]))).rejects.toThrow(/permission denied/);
  });

  it("an Owner with branch H1 selected sets and cancels branch H2's price (HYG-009 N2)", async () => {
    const r = await as(OWN, (db) => setBranchPrice(db, { itemId: facial, branchId: A.b2, price: 440_000, effectiveFrom: later(5), reason: "Dari cabang lain" }), A.b1);
    expect(await code(as(OWN, (db) => cancelBranchPrice(db, r.id), A.b1))).toBe("ok");
  });
});

describe("effective dating", () => {
  it("before, at and after a scheduled change; back to normal; two scheduled changes; the next change is the earliest", async () => {
    const item = (await as(MGR, (db) => publish(db, { kind: "service", code: "FAC-H2" }, FACIAL, "Layanan baru"))).itemId;
    const t1 = later(3);
    const t2 = later(6);
    await as(OWN, (db) => setBranchPrice(db, { itemId: item, branchId: A.b1, price: 400_000, effectiveFrom: t1, reason: "Promo" }));
    await as(OWN, (db) => setBranchPrice(db, { itemId: item, branchId: A.b1, price: null, effectiveFrom: t2, reason: "Promo selesai" }));
    const at = (d: Date) => as(FO, (db) => effectivePrice(db, item, A.b1, d));
    expect(await at(new Date())).toBe(500_000);
    expect(await at(new Date(+t1 - 1000))).toBe(500_000);
    expect(await at(t1)).toBe(400_000);
    expect(await at(new Date(+t2 - 1000))).toBe(400_000);
    expect(await at(t2)).toBe(500_000); // "back to normal" masks the earlier override
    const rows = await as(FO, (db) => priceRows(db, item));
    const [s] = summarise(rows, [A.b1], 500_000);
    expect(s).toMatchObject({ now: 500_000, overridden: false, next: { price: 400_000, effectiveFrom: t1 } });
    expect(summarise(rows, [A.b1], 500_000, new Date(+t2 + 1000))[0]).toMatchObject({ now: 500_000, overridden: false, next: null });
    expect(summarise(rows, [A.b1], 500_000, new Date(+t1 + 1000))[0]).toMatchObject({ now: 400_000, overridden: true, next: { price: null } });
  });

  it("a write 'now' always follows the row in force, even with a requested time inside the one-minute lag", async () => {
    const item = (await as(MGR, (db) => publish(db, { kind: "product", code: "SRM-H2" }, { name: "Toner", tax_category: "taxable_goods", tax_basis: "Barang kena pajak", normal_price: 100_000 }, "Produk baru"))).itemId;
    const first = await as(OWN, (db) => setBranchPrice(db, { itemId: item, branchId: A.b1, price: 90_000, effectiveFrom: null, reason: "Pertama" }));
    const second = await as(OWN, (db) => setBranchPrice(db, { itemId: item, branchId: A.b1, price: 80_000, effectiveFrom: new Date(Date.now() - 30_000), reason: "Kedua" }));
    expect(+second.effectiveFrom).toBeGreaterThan(+first.effectiveFrom);
    expect(await as(FO, (db) => effectivePrice(db, item, A.b1))).toBe(80_000);
  });

  it("refuses backdating beyond a minute, more than 366 days ahead, the same future time twice, price < 1, a short reason, a material, an item without an active version", async () => {
    const base = { itemId: facial, branchId: A.b1, price: 300_000, reason: "Harga uji" };
    expect(await code(as(OWN, (db) => setBranchPrice(db, { ...base, effectiveFrom: new Date(Date.now() - 5 * 60_000) })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => setBranchPrice(db, { ...base, effectiveFrom: later(367) })))).toBe("ERR_INVALID_INPUT");
    const t = later(20);
    expect(await code(as(OWN, (db) => setBranchPrice(db, { ...base, effectiveFrom: t })))).toBe("ok");
    expect(await code(as(OWN, (db) => setBranchPrice(db, { ...base, effectiveFrom: t })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(OWN, (db) => setBranchPrice(db, { ...base, price: 0, effectiveFrom: later(21) })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => setBranchPrice(db, { ...base, reason: "  x ", effectiveFrom: later(22) })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => setBranchPrice(db, { ...base, itemId: bahan, effectiveFrom: null })))).toBe("ERR_INVALID_INPUT");
    // A first version waiting for clinical review: no active version yet.
    const pending = await as(MGR, (db) => publish(db, { kind: "service", code: "FAC-H3" }, { ...FACIAL, indications: "Kulit kusam" }, "Layanan baru"));
    expect(pending.state).toBe("pending_review");
    expect(await code(as(OWN, (db) => setBranchPrice(db, { ...base, itemId: pending.itemId, effectiveFrom: null })))).toBe("ERR_INVALID_INPUT");
    expect(await as(FO, (db) => effectivePrice(db, pending.itemId, A.b1))).toBeNull();
    expect(await as(FO, (db) => effectivePrice(db, bahan, A.b1))).toBeNull();
  });

  it("the form date is read in the branch's timezone: today there is now; a later date is 00:00 there; an earlier date is backdated", async () => {
    for (const [branch, tz] of [[A.mks, "Asia/Makassar"], [A.jyp, "Asia/Jayapura"], [A.b1, "Asia/Jakarta"]] as const) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(later(1));
      const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(later(-1));
      expect(await as(OWN, (db) => effectiveFromDate(db, branch, today)), tz).toBeNull();
      const at = await as(OWN, (db) => effectiveFromDate(db, branch, tomorrow));
      expect(at instanceof Date, tz).toBe(true);
      // 00:00 in that zone, written back in the zone: the same calendar day at midnight.
      expect(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at as Date), tz)
        .toBe(`${tomorrow}, 00:00`);
      expect(await as(OWN, (db) => effectiveFromDate(db, branch, yesterday)), tz).toBe("backdated");
    }
    expect(await as(OWN, (db) => effectiveFromDate(db, A.b1, "2026-02-31"))).toBe("invalid");
    expect(await as(OWN, (db) => effectiveFromDate(db, B.b1, "2030-01-01"))).toBe("no-branch");
  });
});

describe("cancellation and immutability", () => {
  it("cancel only a scheduled row; a row in effect is refused; rows never change otherwise and are never deleted", async () => {
    const scheduled = await as(OWN, (db) => setBranchPrice(db, { itemId: serum, branchId: A.mks, price: 200_000, effectiveFrom: later(4), reason: "Promo" }));
    const inForce = await as(OWN, (db) => setBranchPrice(db, { itemId: serum, branchId: A.jyp, price: 260_000, effectiveFrom: null, reason: "Ongkos kirim" }));
    expect(await code(as(OWN, (db) => cancelBranchPrice(db, scheduled.id)))).toBe("ok");
    expect(await code(as(OWN, (db) => cancelBranchPrice(db, scheduled.id)))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(OWN, (db) => cancelBranchPrice(db, inForce.id)))).toBe("ERR_VERSION_CONFLICT");
    expect((await h.admin.query(`select state, cancelled_by from branch_prices where id = $1`, [scheduled.id])).rows[0]).toEqual({ state: "cancelled", cancelled_by: OWN.staffId });
    // A cancelled row never applies, even after its time (mutation run: reader-cancelled-counts).
    expect(await as(FO, (db) => effectivePrice(db, serum, A.mks, later(5)))).toBe(250_000);
    // Cancelling may not also change the content (mutation run: guard-allows-edit).
    const other = await as(OWN, (db) => setBranchPrice(db, { itemId: serum, branchId: A.mks, price: 210_000, effectiveFrom: later(6), reason: "Promo lain" }));
    await expect(h.admin.query(`update branch_prices set price = 1, state = 'cancelled', cancelled_at = now(), cancelled_by = $2 where id = $1`, [other.id, OWN.staffId])).rejects.toThrow(/only cancelled/);
    await expect(h.admin.query(`update branch_prices set effective_from = effective_from + interval '1 day', state = 'cancelled', cancelled_at = now(), cancelled_by = $2 where id = $1`, [other.id, OWN.staffId])).rejects.toThrow(/only cancelled/);
    // The guard holds for the owner role too (ENABLE ALWAYS).
    await expect(h.admin.query(`update branch_prices set price = 1 where id = $1`, [scheduled.id])).rejects.toThrow(/only cancelled/);
    await expect(h.admin.query(`update branch_prices set state = 'cancelled', cancelled_at = now(), cancelled_by = $2 where id = $1`, [inForce.id, OWN.staffId])).rejects.toThrow(/only cancelled/);
    await expect(h.admin.query(`delete from branch_prices where id = $1`, [inForce.id])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`truncate branch_prices`)).rejects.toThrow();
    await expect(h.admin.query(`insert into branch_prices (tenant_id, branch_id, item_id, price, effective_from, reason, created_by, created_as, state, cancelled_at, cancelled_by)
      values ($1, $2, $3, 1, now(), 'langsung', $4, 'owner', 'cancelled', now(), $4)`, [A.tenantId, A.b1, facial, OWN.staffId])).rejects.toThrow(/starts active/);
    await expect(h.admin.query(`insert into branch_prices (tenant_id, branch_id, item_id, price, effective_from, reason, created_by, created_as)
      values ($1, $2, $3, 1, now(), 'langsung', $4, 'admin_pusat')`, [A.tenantId, A.b1, facial, AP.staffId])).rejects.toThrow(/branch_prices_owner_check/);
  });

  it("audit and event: ids and codes only, never the price or the time", async () => {
    const r = await as(OWN, (db) => setBranchPrice(db, { itemId: facial, branchId: A.jyp, price: 470_000, effectiveFrom: later(8), reason: "Audit uji" }));
    await as(OWN, (db) => cancelBranchPrice(db, r.id));
    const audit = (await h.admin.query(`select reason_code from audit_events where object_kind = 'branch_price' and object_id = $1 order by seq`, [r.id])).rows.map((x) => x.reason_code);
    expect(audit).toEqual(["branch_price_set", "branch_price_cancelled"]);
    const ev = (await h.admin.query(`select branch_id, payload from domain_events where type = 'BranchPriceChanged' and aggregate_id = $1 order by occurred_at, id`, [r.id])).rows;
    expect(ev).toEqual([
      { branch_id: A.jyp, payload: { item_id: facial, branch_id: A.jyp, change: "set" } },
      { branch_id: A.jyp, payload: { item_id: facial, branch_id: A.jyp, change: "cancelled" } },
    ]);
  });
});

describe("readers", () => {
  it("every member reads the rows and the effective price; another tenant's or an unknown branch never falls back to the normal price", async () => {
    for (const p of [AP, MGR, FO, FIN, DOC]) {
      expect((await as(p, (db) => priceRows(db, facial))).length, p.role).toBeGreaterThan(0);
      expect(await as(p, (db) => effectivePrice(db, facial, A.b2)), p.role).toBe(450_000);
    }
    expect(await as(FO, (db) => effectivePrice(db, facial, B.b1))).toBeNull();
    expect(await as(FO, (db) => effectivePrice(db, facial, "00000000-0000-7000-8000-000000000000"))).toBeNull();
  });

  it("vendor support: branch prices are configuration with one operator policy", async () => {
    expect((await h.admin.query(`select support_class from support_object_kinds where table_name = 'public.branch_prices'`)).rows).toEqual([{ support_class: "config" }]);
    expect((await h.admin.query(`select count(*)::int as n from pg_policies where tablename = 'branch_prices' and 'clinic_operator' = any (roles)`)).rows[0].n).toBe(1);
  });
});

describe("cross-tenant", () => {
  it("tenant B neither reads, sets onto, nor cancels A's prices; A's Owner cannot use B's branch", async () => {
    const bOwn = await person(B, "owner");
    const scheduled = await as(OWN, (db) => setBranchPrice(db, { itemId: facial, branchId: A.b1, price: 410_000, effectiveFrom: later(9), reason: "Rahasia A" }));
    expect(await as(bOwn, (db) => priceRows(db))).toEqual([]);
    expect(await as(bOwn, (db) => effectivePrice(db, facial, A.b2))).toBeNull();
    expect(await code(as(bOwn, (db) => setBranchPrice(db, { itemId: facial, branchId: B.b1, price: 1, effectiveFrom: null, reason: "Coba" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => cancelBranchPrice(db, scheduled.id)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => setBranchPrice(db, { itemId: facial, branchId: B.b1, price: 1, effectiveFrom: null, reason: "Coba" })))).toBe("ERR_NOT_FOUND");
    expect((await h.admin.query(`select state from branch_prices where id = $1`, [scheduled.id])).rows[0].state).toBe("active");
  });
});
