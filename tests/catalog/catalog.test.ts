// T-033 Done-when: scenario PR-41 passes ("a manager edits a treatment's contraindications; the
// manager publishes; the change waits for clinical-lead review and the previous version stays
// active"); catalog versions are immutable once referenced (CLIN-011). Plus DEC-046: tenant-wide
// facility-head review with owner fallback, every approval path moves the version, the item lock
// while a review is pending, clinical content readers, and cross-tenant isolation.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { listInbox } from "../../src/modules/approvals/inbox";
import { CatalogError, type CatalogFields, catalogItem, commercialCatalog, itemVersions, publish, referenceVersion, reviewTarget, unpublishedItems } from "../../src/modules/catalog/catalog";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Katalog Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`kat${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Katalog ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const b = TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1;
  if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: b };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CatalogError && e.reason ? `${e.code}:${e.reason}` : e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));

const FACIAL: CatalogFields = {
  name: "Facial Brightening", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 500_000,
  control_count: 1, control_validity_days: 14, commission_scope: ["performer", "closing_bc"],
  indications: "Kulit kusam", contraindications: "Kulit luka terbuka", consent_template: "Saya menyetujui tindakan facial.", delegation: "Perawat terlatih",
};
const versionsAs = (p: P, itemId: string) => as(p, (db) => itemVersions(db, itemId));
const active = async (p: P, itemId: string) => (await versionsAs(p, itemId)).find((v) => v.state === "active");

let A: T;
let B: T;
let OWN: P; let AP: P; let MGR: P; let FH1: P; let FH2: P; let FO: P; let DOC: P; let FIN: P; let PH: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner");
  AP = await person(A, "admin_pusat");
  MGR = await person(A, "manager", A.b1);
  FH1 = await person(A, "facility_head", A.b1);
  FH2 = await person(A, "facility_head", A.b2); // another branch: still reviews the tenant catalog
  FO = await person(A, "fo_cashier", A.b1);
  DOC = await person(A, "doctor", A.b1);
  FIN = await person(A, "finance");
  PH = await person(A, "pharmacist", A.b1);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-41 clinical review before publish", () => {
  it("a manager edits a treatment's contraindications and publishes: the change waits for clinical-lead review and the previous version stays active", async () => {
    const v1 = await as(MGR, (db) => publish(db, { kind: "service", code: "FAC-01" }, FACIAL, "Layanan baru"));
    // A new item with clinical fields waits for review too (no active version yet).
    expect(v1.state).toBe("pending_review");
    expect(await active(MGR, v1.itemId)).toBeUndefined();
    await as(FH1, (db) => decideApproval(db, v1.approvalId!, true));
    expect((await active(MGR, v1.itemId))!.version).toBe(1);

    const v2 = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { ...FACIAL, contraindications: "Kulit luka terbuka; hamil trimester pertama" }, "Tambah kontraindikasi"));
    expect(v2).toMatchObject({ state: "pending_review", version: 2 });
    expect(v2.approvalId).not.toBeNull();
    const now = await active(MGR, v1.itemId);
    expect(now).toMatchObject({ version: 1, contraindications: "Kulit luka terbuka" });
    // The cashier's projection still shows version 1 and flags the waiting review.
    const row = (await as(FO, commercialCatalog)).find((r) => r.itemId === v1.itemId)!;
    expect(row).toMatchObject({ version: 1, normalPrice: 500_000, pendingReview: true });
    // The review waits in the facility head's inbox (any facility head: tenant-wide).
    expect((await as(FH2, (db) => listInbox(db, "facility_head"))).rows.map((r) => r.id)).toContain(v2.approvalId);
    // The clinical lead approves: version 2 becomes active, version 1 is superseded.
    await as(FH2, (db) => decideApproval(db, v2.approvalId!, true));
    const after = await versionsAs(MGR, v1.itemId);
    expect(after.map((v) => [v.version, v.state])).toEqual([[2, "active"], [1, "superseded"]]);
    const audit = (await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and object_kind = 'catalog_version' and object_id = $2 order by seq`, [A.tenantId, v2.versionId])).rows.map((r) => r.reason_code);
    expect(audit).toEqual(["catalog_review_requested", "catalog_review_approved"]);
  });

  it("a commercial-only change (price) is active at once; clearing a clinical field is a clinical change", async () => {
    const v1 = await as(AP, (db) => publish(db, { kind: "product", code: "SRM-01" }, { name: "Serum Vitamin C", tax_category: "taxable_goods", tax_basis: "Barang kena pajak", normal_price: 250_000 }, "Produk baru"));
    expect(v1.state).toBe("active"); // no clinical fields: nothing to review
    const v2 = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { name: "Serum Vitamin C", tax_category: "taxable_goods", tax_basis: "Barang kena pajak", normal_price: 275_000 }, "Harga naik"));
    expect(v2.state).toBe("active");
    expect((await versionsAs(MGR, v1.itemId)).map((v) => [v.version, v.state, v.normalPrice])).toEqual([[2, "active", 275_000], [1, "superseded", 250_000]]);
    // Whitespace-only differences are not clinical changes; clearing a field is.
    const fac = await as(MGR, (db) => publish(db, { kind: "service", code: "FAC-02" }, FACIAL, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, fac.approvalId!, true));
    expect((await as(MGR, (db) => publish(db, { itemId: fac.itemId }, { ...FACIAL, indications: "  Kulit kusam  ", normal_price: 550_000 }, "Harga naik"))).state).toBe("active");
    const cleared = await as(MGR, (db) => publish(db, { itemId: fac.itemId }, { ...FACIAL, normal_price: 550_000, delegation: "  " }, "Hapus delegasi"));
    expect(cleared.state).toBe("pending_review");
  });

  it("rejection and withdrawal through the generic approval functions keep the active version; the item is open again afterwards", async () => {
    const it1 = await as(MGR, (db) => publish(db, { kind: "service", code: "PEEL-01" }, { ...FACIAL, name: "Chemical Peeling" }, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, it1.approvalId!, true));
    const r = await as(MGR, (db) => publish(db, { itemId: it1.itemId }, { ...FACIAL, name: "Chemical Peeling", indications: "Jerawat ringan" }, "Indikasi baru"));
    expect(await code(as(FH1, (db) => decideApproval(db, r.approvalId!, false)))).toBe("ERR_FORBIDDEN"); // a rejection needs a reason
    await as(FH1, (db) => decideApproval(db, r.approvalId!, false, "Indikasi belum sesuai panduan"));
    const c = await as(MGR, (db) => publish(db, { itemId: it1.itemId }, { ...FACIAL, name: "Chemical Peeling", indications: "Jerawat ringan sampai sedang" }, "Indikasi diperbaiki"));
    await as(MGR, (db) => cancelApproval(db, c.approvalId!)); // the requester withdraws
    expect((await versionsAs(MGR, it1.itemId)).map((v) => [v.version, v.state])).toEqual([[3, "cancelled"], [2, "rejected"], [1, "active"]]);
    const reasons = (await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and object_kind = 'catalog_version' and object_id = any($2) order by seq`, [A.tenantId, [r.versionId, c.versionId]])).rows.map((x) => x.reason_code);
    expect(reasons).toEqual(["catalog_review_requested", "catalog_review_rejected", "catalog_review_requested", "catalog_review_cancelled"]);
    // A decided approval cannot be decided again; the version stays as it is.
    expect(await code(as(FH2, (db) => decideApproval(db, r.approvalId!, true)))).toBe("ERR_VERSION_CONFLICT");
    expect((await active(MGR, it1.itemId))!.version).toBe(1);
  });
});

describe("review round 1 (T-033 implementation review)", () => {
  it("P1: a rejected or withdrawn first version can be corrected and resubmitted on the same item and code", async () => {
    const r = await as(MGR, (db) => publish(db, { kind: "service", code: "FIRST-01" }, { ...FACIAL, name: "Microneedling" }, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, r.approvalId!, false, "Kontraindikasi belum lengkap"));
    // Listed for editors and facility heads as not active (P2), never in the commercial projection.
    expect((await as(MGR, unpublishedItems)).find((x) => x.itemId === r.itemId)).toMatchObject({ code: "FIRST-01", state: "rejected" });
    expect((await as(FO, commercialCatalog)).map((x) => x.itemId)).not.toContain(r.itemId);
    expect(await as(FO, unpublishedItems)).toEqual([]);
    const r2 = await as(MGR, (db) => publish(db, { itemId: r.itemId }, { ...FACIAL, name: "Microneedling", contraindications: "Kulit luka terbuka; keloid" }, "Kontraindikasi dilengkapi"));
    expect(r2).toMatchObject({ state: "pending_review", version: 2 });
    await as(MGR, (db) => cancelApproval(db, r2.approvalId!)); // withdrawn too
    const r3 = await as(MGR, (db) => publish(db, { itemId: r.itemId }, { ...FACIAL, name: "Microneedling", contraindications: "Kulit luka terbuka; keloid; isotretinoin" }, "Ajukan lagi"));
    await as(FH2, (db) => decideApproval(db, r3.approvalId!, true));
    expect((await active(MGR, r.itemId))!.version).toBe(3);
    expect((await as(MGR, unpublishedItems)).map((x) => x.itemId)).not.toContain(r.itemId);
  });

  it("P1: a price-only edit keeps the material formula; an explicit empty formula clears it", async () => {
    const formula = [{ material: "Serum pembawa", qty: 2, unit: "ml" }];
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "FORM-01" }, { name: "Infus Vitamin", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 400_000, material_formula: formula }, "Layanan baru"));
    // T-034 (DEC-047 (2)): a recipe passes the pharmacist's materials review first.
    expect(v).toMatchObject({ state: "pending_review", approvalId: null });
    await as(PH, (db) => decideApproval(db, v.materialsApprovalId!, true));
    // An edit that sends no material_formula key keeps the formula.
    const noFormula: CatalogFields = { name: "Infus Vitamin", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 450_000 };
    expect((await as(MGR, (db) => publish(db, { itemId: v.itemId }, noFormula, "Harga naik"))).state).toBe("active");
    expect((await active(MGR, v.itemId))).toMatchObject({ version: 2, normalPrice: 450_000, materialFormula: formula });
    const cleared = await as(MGR, (db) => publish(db, { itemId: v.itemId }, { ...noFormula, material_formula: [] }, "Resep dihapus"));
    await as(PH, (db) => decideApproval(db, cleared.materialsApprovalId!, true)); // clearing the recipe is a recipe change
    expect((await active(MGR, v.itemId))!.materialFormula).toEqual([]);
  });

  it("P1 (round 2): correcting a rejected or withdrawn first version keeps its material formula; the clinical baseline stays empty", async () => {
    const formula = [{ material: "Jarum steril", qty: 1, unit: "pcs" }];
    const base = { ...FACIAL, name: "Dermapen" };
    const r = await as(MGR, (db) => publish(db, { kind: "service", code: "FORM-02" }, { ...base, material_formula: formula }, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, r.approvalId!, false, "Kontraindikasi belum lengkap"));
    // The edit form sends no material_formula key.
    const r2 = await as(MGR, (db) => publish(db, { itemId: r.itemId }, { ...base, contraindications: "Kulit luka terbuka; keloid" }, "Diperbaiki"));
    expect(r2.state).toBe("pending_review"); // nothing clinical was approved: still a clinical change
    await as(MGR, (db) => cancelApproval(db, r2.approvalId!));
    const r3 = await as(MGR, (db) => publish(db, { itemId: r.itemId }, { ...base, contraindications: "Kulit luka terbuka; keloid; isotretinoin" }, "Ajukan lagi"));
    await as(FH1, (db) => decideApproval(db, r3.approvalId!, true));
    // T-034: the carried recipe is new against the (empty) active baseline, so the pharmacist reviews it too.
    expect((await active(MGR, r.itemId))).toBeUndefined();
    await as(PH, (db) => decideApproval(db, r3.materialsApprovalId!, true));
    expect((await versionsAs(MGR, r.itemId)).map((v) => [v.version, v.state, v.materialFormula])).toEqual([[3, "active", formula], [2, "cancelled", formula], [1, "rejected", formula]]);
  });

  it("P1: the review target names the item and shows proposed and active clinical fields, for each of two reviews", async () => {
    const a1 = await as(MGR, (db) => publish(db, { kind: "service", code: "TGT-01" }, { ...FACIAL, name: "Facial Target Satu" }, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, a1.approvalId!, true));
    const p1 = await as(MGR, (db) => publish(db, { itemId: a1.itemId }, { ...FACIAL, name: "Facial Target Satu", contraindications: "Kulit luka terbuka; rosacea aktif" }, "Kontraindikasi"));
    const p2 = await as(MGR, (db) => publish(db, { kind: "service", code: "TGT-02" }, { ...FACIAL, name: "Facial Target Dua" }, "Layanan baru"));
    const t1 = await as(FH2, (db) => reviewTarget(db, p1.approvalId!));
    const t2 = await as(FH2, (db) => reviewTarget(db, p2.approvalId!));
    expect(t1).toMatchObject({ reviewType: "catalog_clinical_review", itemId: a1.itemId, kind: "service", code: "TGT-01", name: "Facial Target Satu", version: 2, proposed: { contraindications: "Kulit luka terbuka; rosacea aktif" }, active: { contraindications: "Kulit luka terbuka" }, formula: null });
    expect(t2).toMatchObject({ itemId: p2.itemId, code: "TGT-02", version: 1, active: null });
    // Not for commercial roles, nor for another tenant, nor for another approval type.
    expect(await as(FO, (db) => reviewTarget(db, p1.approvalId!))).toBeNull();
    expect(await as(await person(B, "owner"), (db) => reviewTarget(db, p1.approvalId!))).toBeNull();
    await as(MGR, (db) => cancelApproval(db, p1.approvalId!));
    await as(MGR, (db) => cancelApproval(db, p2.approvalId!));
  });
});

describe("DEC-046 (3): the item is locked while a clinical change waits", () => {
  it("a price change during a pending review is refused, so approving the review cannot restore a stale price; after the decision it goes through", async () => {
    const v1 = await as(MGR, (db) => publish(db, { kind: "service", code: "LSR-01" }, { ...FACIAL, name: "Laser Toning", normal_price: 100_000 }, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, v1.approvalId!, true));
    const v2 = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { ...FACIAL, name: "Laser Toning", normal_price: 100_000, contraindications: "Kulit terbakar matahari" }, "Kontraindikasi"));
    expect(await code(as(OWN, (db) => publish(db, { itemId: v1.itemId }, { ...FACIAL, name: "Laser Toning", normal_price: 120_000 }, "Harga naik")))).toBe("ERR_VERSION_CONFLICT:catalog_review_pending");
    await as(FH1, (db) => decideApproval(db, v2.approvalId!, true));
    expect((await active(MGR, v1.itemId))!.normalPrice).toBe(100_000);
    const v3 = await as(OWN, (db) => publish(db, { itemId: v1.itemId }, { ...FACIAL, name: "Laser Toning", normal_price: 120_000, contraindications: "Kulit terbakar matahari" }, "Harga naik"));
    expect(v3.state).toBe("active");
    expect((await active(MGR, v1.itemId))).toMatchObject({ version: 3, normalPrice: 120_000, contraindications: "Kulit terbakar matahari" });
  });
});

describe("DEC-046 (1): who reviews", () => {
  it("the requester never approves their own change; the owner decides only while no facility head other than the requester could", async () => {
    const t = await tenant();
    const own = await person(t, "owner");
    const mgr = await person(t, "manager", t.b1);
    const v = await as(own, (db) => publish(db, { kind: "service", code: "BOT-01" }, { ...FACIAL, name: "Botox" }, "Layanan baru"));
    // No facility head in this tenant: the owner is the fallback, but not for their own request.
    expect(await code(as(own, (db) => decideApproval(db, v.approvalId!, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await code(as(own, (db) => cancelApproval(db, v.approvalId!)))).toBe("ok");
    const w = await as(mgr, (db) => publish(db, { kind: "service", code: "BOT-02" }, { ...FACIAL, name: "Botox Dahi" }, "Layanan baru"));
    expect((await as(own, (db) => listInbox(db, "owner"))).rows.map((r) => r.id)).toContain(w.approvalId);
    // A facility head appears (another branch): the owner may no longer decide; the facility head does.
    const fh = await person(t, "facility_head", t.b2);
    expect((await as(own, (db) => listInbox(db, "owner"))).rows.map((r) => r.id)).not.toContain(w.approvalId);
    expect(await code(as(own, (db) => decideApproval(db, w.approvalId!, true)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(fh, (db) => decideApproval(db, w.approvalId!, true)))).toBe("ok");
  });

  it("only the owner, Admin Pusat and Manager publish; other roles are refused", async () => {
    for (const p of [FH1, PH, FO, DOC, FIN]) {
      expect(await code(as(p, (db) => publish(db, { kind: "product", code: `X-${p.role.toUpperCase().slice(0, 6)}` }, { name: "Barang", tax_category: "taxable_goods", tax_basis: "Barang kena pajak", normal_price: 1 }, "Coba terbit"))), p.role).toBe("ERR_FORBIDDEN");
    }
  });

  it("invalid input is refused naming nothing clinical: bad tax category, negative price, duplicate code", async () => {
    const base = { name: "Barang Uji", tax_category: "taxable_goods" as const, tax_basis: "Barang kena pajak", normal_price: 10_000 };
    expect(await code(as(MGR, (db) => publish(db, { kind: "product", code: "INV-01" }, { ...base, tax_category: "luxury" as never }, "Uji")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(MGR, (db) => publish(db, { kind: "product", code: "INV-02" }, { ...base, normal_price: -1 }, "Uji")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(MGR, (db) => publish(db, { kind: "product", code: "INV-03" }, base, "Uji")))).toBe("ok");
    expect(await code(as(MGR, (db) => publish(db, { kind: "product", code: "INV-03" }, base, "Uji")))).toBe("ERR_VERSION_CONFLICT");
  });
});

describe("DEC-046 (2): readers", () => {
  it("clinical roles read clinical content; commercial roles read the commercial projection only; unpublished versions only editors and facility heads", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "RDR-01" }, { ...FACIAL, name: "Facial Pembaca" }, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, v.approvalId!, true));
    const p = await as(MGR, (db) => publish(db, { itemId: v.itemId }, { ...FACIAL, name: "Facial Pembaca", indications: "Kulit berminyak" }, "Indikasi"));
    for (const who of [OWN, AP, MGR, FH1]) expect((await versionsAs(who, v.itemId)).map((x) => x.state).sort(), who.role).toEqual(["active", "pending_review"]);
    for (const who of [DOC, PH]) expect(await versionsAs(who, v.itemId), who.role).toEqual([expect.objectContaining({ state: "active", contraindications: "Kulit luka terbuka" })]);
    for (const who of [FO, FIN]) {
      expect(await versionsAs(who, v.itemId), who.role).toEqual([]);
      const row = (await as(who, commercialCatalog)).find((r) => r.itemId === v.itemId)!;
      expect(row).toMatchObject({ name: "Facial Pembaca", normalPrice: 500_000 });
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["contraindications"]));
      expect(await as(who, (db) => catalogItem(db, v.itemId))).toMatchObject({ code: "RDR-01" });
    }
    await as(MGR, (db) => cancelApproval(db, p.approvalId!));
  });
});

describe("CLIN-011: versions are immutable; referenced once; never deleted", () => {
  it("content cannot change before or after reference; referenced_at is set once; no delete or truncate; the app cannot write the tables", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "product", code: "IMM-01" }, { name: "Masker Wajah", tax_category: "taxable_goods", tax_basis: "Barang kena pajak", normal_price: 50_000 }, "Produk baru"));
    await expect(h.admin.query(`update catalog_versions set normal_price = 1 where id = $1`, [v.versionId])).rejects.toThrow(/immutable/);
    await as(FO, (db) => referenceVersion(db, v.versionId));
    const at = (await h.admin.query(`select referenced_at from catalog_versions where id = $1`, [v.versionId])).rows[0].referenced_at;
    expect(at).not.toBeNull();
    await as(FO, (db) => referenceVersion(db, v.versionId)); // idempotent: still the first time
    expect((await h.admin.query(`select referenced_at from catalog_versions where id = $1`, [v.versionId])).rows[0].referenced_at).toEqual(at);
    await expect(h.admin.query(`update catalog_versions set referenced_at = now() + interval '1 day' where id = $1`, [v.versionId])).rejects.toThrow(/referenced once/);
    await expect(h.admin.query(`update catalog_versions set name = 'Masker Lain' where id = $1`, [v.versionId])).rejects.toThrow(/immutable/);
    await expect(h.admin.query(`delete from catalog_versions where id = $1`, [v.versionId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`delete from catalog_items where id = $1`, [v.itemId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update catalog_items set code = 'IMM-99' where id = $1`, [v.itemId])).rejects.toThrow(/kind and code/);
    await expect(h.admin.query(`truncate catalog_versions cascade`)).rejects.toThrow();
    await expect(h.admin.query(`update catalog_versions set state = 'active' where id = (select id from catalog_versions where state = 'superseded' limit 1)`)).rejects.toThrow(/cannot become/);
    // The application role has no write privilege on either table.
    await expect(as(OWN, (db) => db.query(`update catalog_versions set normal_price = 1 where id = $1`, [v.versionId]))).rejects.toThrow(/permission denied/);
    await expect(as(OWN, (db) => db.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'product', 'HACK-1', $2)`, [A.tenantId, OWN.staffId]))).rejects.toThrow(/permission denied/);
  });
});

describe("vendor support access (TEN-14, TEN-19)", () => {
  it("catalog versions are clinical (a support session needs the Owner's approval); items are configuration; each has its operator policy", async () => {
    const classes = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name like 'public.catalog_%' order by 1`)).rows;
    expect(classes).toEqual([{ table_name: "public.catalog_items", support_class: "config" }, { table_name: "public.catalog_versions", support_class: "clinical" }]);
    const policies = (await h.admin.query(`select tablename from pg_policies where 'clinic_operator' = any (roles) and tablename like 'catalog_%' order by 1`)).rows.map((r) => r.tablename);
    expect(policies).toEqual(["catalog_items", "catalog_versions"]);
  });
});

describe("cross-tenant", () => {
  it("tenant B neither reads, publishes onto, references nor reviews tenant A's catalog", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "XT-01" }, { ...FACIAL, name: "Rahasia A" }, "Layanan baru"));
    const bOwn = await person(B, "owner");
    const bFh = await person(B, "facility_head", B.b1);
    expect(await as(bOwn, (db) => catalogItem(db, v.itemId))).toBeNull();
    expect(await versionsAs(bOwn, v.itemId)).toEqual([]);
    expect((await as(bOwn, commercialCatalog)).map((r) => r.name)).not.toContain("Rahasia A");
    expect(await code(as(bOwn, (db) => publish(db, { itemId: v.itemId }, FACIAL, "Coba")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => referenceVersion(db, v.versionId)))).toBe("ERR_NOT_FOUND");
    // An active version of A (mutation run: a pending one is refused by state alone, so the tenant
    // predicate needs an active one): B cannot mark it referenced either, and nothing changes.
    const act = await as(MGR, (db) => publish(db, { kind: "product", code: "XT-02" }, { name: "Rahasia A Produk", tax_category: "taxable_goods", tax_basis: "Barang kena pajak", normal_price: 1_000 }, "Produk baru"));
    expect(act.state).toBe("active");
    expect(await code(as(bOwn, (db) => referenceVersion(db, act.versionId)))).toBe("ERR_NOT_FOUND");
    expect((await h.admin.query(`select referenced_at from catalog_versions where id = $1`, [act.versionId])).rows[0].referenced_at).toBeNull();
    expect(await code(as(bFh, (db) => decideApproval(db, v.approvalId!, true)))).toBe("ERR_NOT_FOUND");
    expect((await as(bFh, (db) => listInbox(db, "facility_head"))).rows.map((r) => r.id)).not.toContain(v.approvalId);
    expect((await active(MGR, v.itemId))).toBeUndefined(); // still pending in A
    await as(MGR, (db) => cancelApproval(db, v.approvalId!));
  });
});
