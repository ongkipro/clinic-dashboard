// T-034 Done-when: Master Layanan saved and versioned with resources and staff eligibility (PR-88,
// DATA-62). Plus DEC-047: the clinical gate covers aftercare and eligibility; the BHP recipe needs the
// pharmacist's materials review (facility head or owner only as fallback); a version needing both
// waits for both and dies with either; the fixed legal delegation floor; data per role (the booking
// projection, the pharmacist's recipe-only view); immutable child rows; vendor support classes;
// cross-tenant isolation.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { inboxDetail, listInbox } from "../../src/modules/approvals/inbox";
import { CatalogError, type CatalogFields, commercialCatalog, itemVersions, publish, reviewTarget, serviceRequirements, serviceRows } from "../../src/modules/catalog/catalog";
import { ELIGIBLE_PROFESSIONS, SERVICE_CATEGORIES } from "../../src/modules/catalog/schema";
import { CATEGORIES, FLOOR, PROFESSIONS } from "../../src/modules/catalog/service/floor";
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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Layanan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("L1"), b2: await br("L2") };
}
async function person(t: T, role: Role, branch?: string, extra: Role[] = []): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`lay${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Layanan ${n}` });
  for (const r of [role, ...extra]) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role: r });
    const b = TENANT_WIDE.includes(r) ? undefined : branch ?? t.b1;
    if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  }
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CatalogError && e.reason ? `${e.code}:${e.reason}` : e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const versionsAs = (p: P, itemId: string) => as(p, (db) => itemVersions(db, itemId));
const active = async (p: P, itemId: string) => (await versionsAs(p, itemId)).find((v) => v.state === "active");
const state = async (id: string) => (await h.admin.query(`select state, decided_by, decided_as from approvals where id = $1`, [id])).rows[0];

// A service with operational fields only (no clinical text, no recipe): active at once.
const LASER: CatalogFields = {
  name: "Laser Toning Wajah", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 1_200_000,
  category: "laser_non_ablative", prep_min: 15, treatment_min: 45, buffer_min: 15, online_bookable: true,
  resources: [{ kind: "room", code: "treatment" }, { kind: "device", code: "laser_non_ablative" }],
};
const RECIPE = [{ material: "Gel pendingin", qty: 5, unit: "ml" }, { material: "Kasa steril", qty: 2, unit: "pcs" }];

let A: T;
let B: T;
let OWN: P; let MGR: P; let FH1: P; let FH2: P; let PH: P; let FO: P; let CS: P; let DOC: P; let NUR: P; let THR: P; let FIN: P; let MK: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner");
  MGR = await person(A, "manager", A.b1);
  FH1 = await person(A, "facility_head", A.b1);
  FH2 = await person(A, "facility_head", A.b2);
  PH = await person(A, "pharmacist", A.b2); // another branch: still reviews the tenant catalog
  FO = await person(A, "fo_cashier", A.b1);
  CS = await person(A, "central_cs");
  DOC = await person(A, "doctor", A.b1);
  NUR = await person(A, "nurse", A.b1);
  THR = await person(A, "therapist", A.b1);
  FIN = await person(A, "finance");
  MK = await person(A, "marketing");
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("T-034 Done-when: Master Layanan saved and versioned with resources and staff eligibility", () => {
  it("a service with durations and resources is active at once; eligibility is clinical and waits for the facility head; every version keeps its own rows", async () => {
    const v1 = await as(MGR, (db) => publish(db, { kind: "service", code: "LSR-T1" }, LASER, "Layanan baru"));
    expect(v1).toMatchObject({ state: "active", version: 1, approvalId: null, materialsApprovalId: null });
    expect(await as(MGR, (db) => serviceRows(db, v1.versionId))).toEqual({
      resources: [{ kind: "device", code: "laser_non_ablative", required: true }, { kind: "room", code: "treatment", required: true }],
      eligibility: [],
    });
    expect((await as(FO, commercialCatalog)).find((r) => r.itemId === v1.itemId)).toMatchObject({
      version: 1, category: "laser_non_ablative", prepMin: 15, treatmentMin: 45, bufferMin: 15, onlineBookable: true,
    });
    // Eligibility (who may perform it) is clinical content: a new version waits for review.
    const v2 = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { ...LASER, eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "supervised" }] }, "Staf yang boleh"));
    expect(v2).toMatchObject({ state: "pending_review", version: 2, materialsApprovalId: null });
    expect(v2.approvalId).not.toBeNull();
    await as(FH2, (db) => decideApproval(db, v2.approvalId!, true));
    // An operational change (durations, resources) is active at once and carries the eligibility forward.
    const v3 = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { ...LASER, treatment_min: 60, resources: [{ kind: "room", code: "treatment" }] }, "Durasi"));
    expect(v3.state).toBe("active");
    expect(await as(MGR, (db) => serviceRows(db, v3.versionId))).toEqual({
      resources: [{ kind: "room", code: "treatment", required: true }],
      eligibility: [{ role: "doctor", staffId: null, mode: "performs" }, { role: "nurse", staffId: null, mode: "supervised" }],
    });
    // Version 1 keeps what it had (the snapshot a booking stores).
    expect((await as(MGR, (db) => serviceRows(db, v1.versionId))).resources).toHaveLength(2);
    expect((await versionsAs(MGR, v1.itemId)).map((v) => [v.version, v.state, v.treatmentMin])).toEqual([[3, "active", 60], [2, "superseded", 45], [1, "superseded", 45]]);
  });

  it("omitted service fields carry forward; a new service starts at 10/30/10 minutes; aftercare is clinical", async () => {
    const v1 = await as(MGR, (db) => publish(db, { kind: "service", code: "FCL-T1" }, { name: "Facial Dasar", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 300_000, category: "facial" }, "Layanan baru"));
    expect(await active(MGR, v1.itemId)).toMatchObject({ prepMin: 10, treatmentMin: 30, bufferMin: 10, onlineBookable: false, category: "facial" });
    const v2 = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { name: "Facial Dasar", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 325_000 }, "Harga"));
    expect(v2.state).toBe("active");
    expect(await active(MGR, v1.itemId)).toMatchObject({ version: 2, normalPrice: 325_000, category: "facial", treatmentMin: 30 });
    // Omitted resources carry forward too (mutation run: resources-no-carry); an explicit [] clears them.
    const withRoom = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { name: "Facial Dasar", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 325_000, resources: [{ kind: "room", code: "treatment" }] }, "Ruang"));
    const carried = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { name: "Facial Dasar", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 330_000 }, "Harga"));
    expect((await as(MGR, (db) => serviceRows(db, carried.versionId))).resources).toEqual([{ kind: "room", code: "treatment", required: true }]);
    const cleared = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { name: "Facial Dasar", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 330_000, resources: [] }, "Tanpa ruang"));
    expect((await as(MGR, (db) => serviceRows(db, cleared.versionId))).resources).toEqual([]);
    expect(withRoom.state).toBe("active");
    const v3 = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { name: "Facial Dasar", tax_category: "exempt_medical", tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 325_000, aftercare_text: "Hindari matahari 24 jam." }, "Aftercare"));
    expect(v3.state).toBe("pending_review");
    expect(v3.approvalId).not.toBeNull();
    await as(MGR, (db) => cancelApproval(db, v3.approvalId!));
  });

  it("service fields are refused on other kinds; bad codes and ranges are refused", async () => {
    const prod = { name: "Sunscreen", tax_category: "taxable_goods" as const, tax_basis: "Barang kena pajak", normal_price: 150_000 };
    expect(await code(as(MGR, (db) => publish(db, { kind: "product", code: "SUN-T1" }, { ...prod, category: "facial" }, "Uji")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(MGR, (db) => publish(db, { kind: "product", code: "SUN-T2" }, { ...prod, resources: [] }, "Uji")))).toBe("ERR_INVALID_INPUT");
    const bad: [string, Partial<CatalogFields>][] = [
      ["category", { category: "massage_spa" }],
      ["device", { resources: [{ kind: "device", code: "xray" }] }],
      ["room kind", { resources: [{ kind: "room", code: "laser" }] }],
      ["treatment 4", { treatment_min: 4 }],
      ["treatment 481", { treatment_min: 481 }],
      ["prep 121", { prep_min: 121 }],
      ["buffer -1", { buffer_min: -1 }],
      ["duplicate resource", { resources: [{ kind: "room", code: "treatment" }, { kind: "room", code: "treatment" }] }],
      ["mode", { eligibility: [{ role: "doctor", mode: "leads" }] }],
      ["role", { eligibility: [{ role: "pharmacist", mode: "assists" }] }],
      ["both", { eligibility: [{ role: "doctor", staff_id: DOC.staffId, mode: "performs" }] }],
      ["recipe shape", { material_formula: [{ material: "Gel", qty: 0, unit: "ml" }] }],
      ["recipe unit", { material_formula: [{ material: "Gel", qty: 1 }] }],
    ];
    for (const [label, f] of bad) {
      expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: `BAD-${++n}` }, { ...LASER, ...f } as CatalogFields, "Uji"))), label).toBe("ERR_INVALID_INPUT");
    }
  });
});

describe("DEC-047 (3): the legal delegation floor", () => {
  it("the database floor equals the code mirror (12 categories × 3 professions)", async () => {
    const db = (await h.admin.query(`select category, profession, max_mode from delegation_floor order by 1, 2`)).rows.map((r) => `${r.category}/${r.profession}/${r.max_mode}`);
    expect(db).toEqual(FLOOR.map((r) => `${r.category}/${r.profession}/${r.maxMode}`).sort());
    expect(db).toHaveLength(36);
    expect([CATEGORIES, PROFESSIONS]).toEqual([SERVICE_CATEGORIES, ELIGIBLE_PROFESSIONS]);
  });

  it("a role may not be widened beyond the floor: nurse never performs filler, therapist never injects; narrower is allowed", async () => {
    const fill = { ...LASER, name: "Filler Bibir", category: "filler", resources: [{ kind: "room" as const, code: "treatment" }] };
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "FIL-T1" }, { ...fill, eligibility: [{ role: "nurse", mode: "performs" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:delegation_floor");
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "FIL-T2" }, { ...fill, eligibility: [{ role: "nurse", mode: "supervised" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:delegation_floor");
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "INJ-T1" }, { ...fill, category: "injection", eligibility: [{ role: "therapist", mode: "assists" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:delegation_floor");
    const ok = await as(MGR, (db) => publish(db, { kind: "service", code: "FIL-T3" }, { ...fill, eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "assists" }] }, "Uji"));
    expect(ok.state).toBe("pending_review");
    await as(MGR, (db) => cancelApproval(db, ok.approvalId!));
    // A category is required once eligibility is set.
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "CAT-T1" }, { ...fill, category: null, eligibility: [{ role: "doctor", mode: "performs" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:category_required");
  });

  it("a named staff member is held to the highest floor of their active clinical roles; none, or an ended membership, is refused", async () => {
    const tox = { ...LASER, name: "Botox Dahi", category: "toxin", resources: [{ kind: "room" as const, code: "treatment" }] };
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "TOX-T1" }, { ...tox, eligibility: [{ staff_id: THR.staffId, mode: "assists" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:delegation_floor");
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "TOX-T2" }, { ...tox, eligibility: [{ staff_id: NUR.staffId, mode: "supervised" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:delegation_floor");
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "TOX-T3" }, { ...tox, eligibility: [{ staff_id: FO.staffId, mode: "assists" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:delegation_floor");
    // A nurse who is also a doctor (two clinical roles): the doctor floor applies.
    const both = await person(A, "nurse", A.b1, ["doctor"]);
    const r = await as(MGR, (db) => publish(db, { kind: "service", code: "TOX-T4" }, { ...tox, eligibility: [{ staff_id: both.staffId, mode: "performs" }, { staff_id: NUR.staffId, mode: "assists" }] }, "Uji"));
    expect(r.state).toBe("pending_review");
    await as(MGR, (db) => cancelApproval(db, r.approvalId!));
    // A doctor whose membership has ended is not eligible any more.
    const gone = await person(A, "doctor", A.b1);
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [gone.staffId]);
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "TOX-T5" }, { ...tox, eligibility: [{ staff_id: gone.staffId, mode: "performs" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:delegation_floor");
    // Another tenant's staff id is not a staff member here.
    const bDoc = await person(B, "doctor", B.b1);
    expect(await code(as(MGR, (db) => publish(db, { kind: "service", code: "TOX-T6" }, { ...tox, eligibility: [{ staff_id: bDoc.staffId, mode: "performs" }] }, "Uji")))).toBe("ERR_INVALID_INPUT:delegation_floor");
  });

  it("a carried-forward eligibility is checked against a changed category", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "CAR-T1" }, { ...LASER, name: "Facial Plus", category: "facial", resources: [], eligibility: [{ role: "therapist", mode: "performs" }] }, "Uji"));
    await as(FH1, (db) => decideApproval(db, v.approvalId!, true));
    expect(await code(as(MGR, (db) => publish(db, { itemId: v.itemId }, { ...LASER, name: "Facial Plus", category: "microneedling", resources: [] }, "Kategori")))).toBe("ERR_INVALID_INPUT:delegation_floor");
  });
});

describe("DEC-047 (2): the materials review", () => {
  it("a recipe change waits for a pharmacist; the facility head and the owner may not decide while one could; the version then becomes active", async () => {
    const v1 = await as(MGR, (db) => publish(db, { kind: "service", code: "MAT-T1" }, LASER, "Layanan baru"));
    const v2 = await as(MGR, (db) => publish(db, { itemId: v1.itemId }, { ...LASER, material_formula: RECIPE }, "Resep BHP"));
    expect(v2).toMatchObject({ state: "pending_review", approvalId: null });
    expect(v2.materialsApprovalId).not.toBeNull();
    // The pharmacist's inbox lists it; the facility head's and the owner's do not (a pharmacist exists).
    expect((await as(PH, (db) => listInbox(db, "pharmacist"))).rows.map((r) => r.id)).toContain(v2.materialsApprovalId);
    expect((await as(FH1, (db) => listInbox(db, "facility_head"))).rows.map((r) => r.id)).not.toContain(v2.materialsApprovalId);
    expect((await as(OWN, (db) => listInbox(db, "owner"))).rows.map((r) => r.id)).not.toContain(v2.materialsApprovalId);
    expect((await as(FH1, (db) => inboxDetail(db, { staffId: FH1.staffId, role: "facility_head" }, v2.materialsApprovalId!)))?.blocked).toBe("not-approver");
    expect(await code(as(FH1, (db) => decideApproval(db, v2.materialsApprovalId!, true)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(OWN, (db) => decideApproval(db, v2.materialsApprovalId!, true)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOC, (db) => decideApproval(db, v2.materialsApprovalId!, true)))).toBe("ERR_NOT_FOUND");
    expect((await as(PH, (db) => inboxDetail(db, { staffId: PH.staffId, role: "pharmacist" }, v2.materialsApprovalId!)))?.blocked).toBeNull();
    await as(PH, (db) => decideApproval(db, v2.materialsApprovalId!, true));
    expect(await active(MGR, v1.itemId)).toMatchObject({ version: 2, materialFormula: RECIPE });
  });

  it("without a pharmacist other than the requester, the facility head or the owner decides; never the requester", async () => {
    const t = await tenant();
    const own = await person(t, "owner");
    const mgr = await person(t, "manager", t.b1);
    const v = await as(mgr, (db) => publish(db, { kind: "service", code: "MAT-T2" }, { ...LASER, material_formula: RECIPE }, "Layanan baru"));
    expect((await as(own, (db) => listInbox(db, "owner"))).rows.map((r) => r.id)).toContain(v.materialsApprovalId);
    expect(await code(as(mgr, (db) => decideApproval(db, v.materialsApprovalId!, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    // A pharmacist joins: the owner steps back.
    const ph = await person(t, "pharmacist", t.b1);
    expect(await code(as(own, (db) => decideApproval(db, v.materialsApprovalId!, true)))).toBe("ERR_FORBIDDEN");
    // The pharmacist leaves again: a facility head may decide.
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [ph.staffId]);
    const fh = await person(t, "facility_head", t.b2);
    expect((await as(fh, (db) => listInbox(db, "facility_head"))).rows.map((r) => r.id)).toContain(v.materialsApprovalId);
    expect(await code(as(fh, (db) => decideApproval(db, v.materialsApprovalId!, true)))).toBe("ok");
    // A pharmacist who requests their own... cannot: only editors request.
    expect(await code(as(await person(t, "pharmacist", t.b1), (db) => publish(db, { itemId: v.itemId }, LASER, "Uji")))).toBe("ERR_FORBIDDEN");
  });
});

describe("DEC-047 (2): a version needing both reviews", () => {
  const BOTH = { ...LASER, name: "Infus Glutation", category: "infusion", resources: [{ kind: "room" as const, code: "treatment" }], material_formula: RECIPE, aftercare_text: "Minum air putih yang cukup." };

  it("becomes active only when both are approved, in either order", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "DUO-T1" }, BOTH, "Layanan baru"));
    expect(v.approvalId).not.toBeNull();
    expect(v.materialsApprovalId).not.toBeNull();
    await as(PH, (db) => decideApproval(db, v.materialsApprovalId!, true));
    expect((await versionsAs(MGR, v.itemId)).map((x) => x.state)).toEqual(["pending_review"]);
    // Still locked while one review is open.
    expect(await code(as(MGR, (db) => publish(db, { itemId: v.itemId }, BOTH, "Uji")))).toBe("ERR_VERSION_CONFLICT:catalog_review_pending");
    await as(FH1, (db) => decideApproval(db, v.approvalId!, true));
    expect((await versionsAs(MGR, v.itemId)).map((x) => x.state)).toEqual(["active"]);
    const events = (await h.admin.query(`select count(*)::int as n from domain_events where type = 'CatalogVersionPublished' and aggregate_id = $1`, [v.versionId])).rows[0].n;
    expect(events).toBe(1);
  });

  it("one rejection kills the version and cancels the other open review, with decider, audit and event", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "DUO-T2" }, BOTH, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, v.approvalId!, false, "Aftercare belum lengkap"));
    expect((await versionsAs(MGR, v.itemId)).map((x) => x.state)).toEqual(["rejected"]);
    expect(await state(v.materialsApprovalId!)).toEqual({ state: "cancelled", decided_by: FH1.staffId, decided_as: "facility_head" });
    const audit = (await h.admin.query(`select reason_code from audit_events where object_kind = 'approval' and object_id = $1 order by seq`, [v.materialsApprovalId])).rows.map((r) => r.reason_code);
    expect(audit).toEqual(["approval_requested", "approval_cancelled"]);
    const ev = (await h.admin.query(`select payload from domain_events where type = 'ApprovalDecided' and aggregate_id = $1`, [v.materialsApprovalId])).rows.map((r) => r.payload.outcome);
    expect(ev).toEqual(["cancelled"]);
    // The pharmacist's rejection works the same way the other round.
    const w = await as(MGR, (db) => publish(db, { itemId: v.itemId }, BOTH, "Ajukan lagi"));
    await as(PH, (db) => decideApproval(db, w.materialsApprovalId!, false, "Satuan gel salah"));
    expect((await state(w.approvalId!)).state).toBe("cancelled");
    expect((await versionsAs(MGR, v.itemId)).map((x) => [x.version, x.state])).toEqual([[2, "rejected"], [1, "rejected"]]);
  });

  it("withdrawing one open review, even after the other was approved, withdraws the version; the item opens again", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "DUO-T3" }, BOTH, "Layanan baru"));
    await as(FH1, (db) => decideApproval(db, v.approvalId!, true));
    await as(MGR, (db) => cancelApproval(db, v.materialsApprovalId!));
    expect((await versionsAs(MGR, v.itemId)).map((x) => x.state)).toEqual(["cancelled"]);
    expect((await state(v.approvalId!)).state).toBe("approved"); // a decided approval stays as decided
    const w = await as(MGR, (db) => publish(db, { itemId: v.itemId }, BOTH, "Ajukan lagi"));
    await as(MGR, (db) => cancelApproval(db, w.approvalId!));
    expect(await state(w.materialsApprovalId!)).toEqual({ state: "cancelled", decided_by: MGR.staffId, decided_as: "manager" });
    expect((await versionsAs(MGR, v.itemId)).map((x) => x.state)).toEqual(["cancelled", "cancelled"]);
  });
});

describe("DEC-047 (2), (4): data per role", () => {
  it("the pharmacist never reads unpublished clinical text: no pending versions or rows; the materials review shows the recipe only", async () => {
    const t1 = { ...LASER, name: "Peeling Rahasia", category: "peeling_chemical", resources: [], indications: "Indikasi rahasia", eligibility: [{ role: "doctor", mode: "performs" }] };
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "PRV-T1" }, { ...t1, material_formula: RECIPE }, "Layanan baru"));
    expect(await versionsAs(PH, v.itemId)).toEqual([]);
    expect(await as(PH, (db) => db.query(`select indications from catalog_versions where id = $1`, [v.versionId]))).toMatchObject({ rows: [] });
    expect((await as(PH, (db) => db.query(`select 1 from service_staff_eligibility where version_id = $1`, [v.versionId]))).rows).toEqual([]);
    const m = await as(PH, (db) => reviewTarget(db, v.materialsApprovalId!));
    expect(m).toMatchObject({ reviewType: "catalog_materials_review", kind: "service", code: "PRV-T1", proposed: null, active: null, formula: RECIPE });
    expect(JSON.stringify(m)).not.toContain("rahasia");
    // The definer itself returns no clinical column for a materials review (mutation run: the module's
    // mapping alone would hide a leak from the SQL function, which the app role can call directly).
    const raw = (await as(PH, (db) => db.query(`select * from catalog_review_target($1)`, [v.materialsApprovalId]))).rows[0];
    for (const k of ["indications", "contraindications", "consent_template", "delegation", "aftercare_text", "eligibility", "active_indications", "active_contraindications", "active_consent_template", "active_delegation", "active_aftercare_text", "active_eligibility"]) {
      expect(raw[k], k).toBeNull();
    }
    expect(raw.material_formula).toEqual(RECIPE);
    // The clinical review target is not the pharmacist's; the facility head sees text and names, no recipe.
    expect(await as(PH, (db) => reviewTarget(db, v.approvalId!))).toBeNull();
    const c = await as(FH1, (db) => reviewTarget(db, v.approvalId!));
    expect(c).toMatchObject({ reviewType: "catalog_clinical_review", proposed: { indications: "Indikasi rahasia", eligibility: [{ role: "doctor", mode: "performs" }] }, formula: null });
    // Once published, the pharmacist reads the active version as a clinical-content role (DEC-046 (2)).
    await as(FH1, (db) => decideApproval(db, v.approvalId!, true));
    await as(PH, (db) => decideApproval(db, v.materialsApprovalId!, true));
    expect((await versionsAs(PH, v.itemId)).map((x) => [x.state, x.materialFormula])).toEqual([["active", RECIPE]]);
  });

  it("booking roles read an active version's resources and eligibility; finance and marketing do not; nothing for a pending version", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "BKG-T1" }, { ...LASER, eligibility: [{ role: "doctor", mode: "performs" }] }, "Layanan baru"));
    expect(await as(FO, (db) => serviceRequirements(db, v.versionId))).toBeNull(); // pending
    await as(FH1, (db) => decideApproval(db, v.approvalId!, true));
    const want = { resources: [{ kind: "device", code: "laser_non_ablative", required: true }, { kind: "room", code: "treatment", required: true }], eligibility: [{ role: "doctor", staffId: null, mode: "performs" }] };
    for (const p of [FO, CS, DOC, NUR, THR, PH, FH1, MGR, OWN]) expect(await as(p, (db) => serviceRequirements(db, v.versionId)), p.role).toEqual(want);
    for (const p of [FIN, MK]) expect(await as(p, (db) => serviceRequirements(db, v.versionId)), p.role).toBeNull();
    // The cashier reads no rows directly (versions and their rows are for clinical-content roles).
    expect((await as(FO, (db) => db.query(`select 1 from service_resources where version_id = $1`, [v.versionId]))).rows).toEqual([]);
  });
});

describe("child rows are immutable; the app cannot write them", () => {
  it("no update, delete or truncate on resources or eligibility; no insert from the app role", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "IMM-T1" }, { ...LASER, eligibility: [{ role: "doctor", mode: "performs" }] }, "Layanan baru"));
    for (const t of ["service_resources", "service_staff_eligibility"]) {
      await expect(h.admin.query(`update ${t} set tenant_id = tenant_id where version_id = $1`, [v.versionId])).rejects.toThrow(/written once/);
      await expect(h.admin.query(`delete from ${t} where version_id = $1`, [v.versionId])).rejects.toThrow(/written once/);
      await expect(h.admin.query(`truncate ${t}`)).rejects.toThrow();
    }
    await expect(as(OWN, (db) => db.query(`insert into service_resources (tenant_id, version_id, kind, code) values ($1, $2, 'room', 'treatment')`, [A.tenantId, v.versionId]))).rejects.toThrow(/permission denied/);
    await expect(as(OWN, (db) => db.query(`select * from delegation_floor`))).rejects.toThrow(/permission denied/);
    await as(MGR, (db) => cancelApproval(db, v.approvalId!));
  });
});

describe("vendor support access (TEN-14, TEN-19)", () => {
  it("resources are configuration, eligibility personal; each has its operator policy; the floor is platform", async () => {
    const classes = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name like 'public.service_%' order by 1`)).rows;
    expect(classes).toEqual([{ table_name: "public.service_resources", support_class: "config" }, { table_name: "public.service_staff_eligibility", support_class: "personal" }]);
    const policies = (await h.admin.query(`select tablename from pg_policies where 'clinic_operator' = any (roles) and tablename like 'service_%' order by 1`)).rows.map((r) => r.tablename);
    expect(policies).toEqual(["service_resources", "service_staff_eligibility"]);
    expect((await h.admin.query(`select policy_kind from scope_map where table_name = 'public.delegation_floor'`)).rows).toEqual([{ policy_kind: "platform" }]);
  });
});

describe("cross-tenant", () => {
  it("tenant B neither reads A's service rows or requirements nor decides A's materials review", async () => {
    const v = await as(MGR, (db) => publish(db, { kind: "service", code: "XTS-T1" }, { ...LASER, material_formula: RECIPE }, "Layanan baru"));
    const bPh = await person(B, "pharmacist", B.b1);
    const bOwn = await person(B, "owner");
    expect(await code(as(bPh, (db) => decideApproval(db, v.materialsApprovalId!, true)))).toBe("ERR_NOT_FOUND");
    expect((await as(bPh, (db) => listInbox(db, "pharmacist"))).rows.map((r) => r.id)).not.toContain(v.materialsApprovalId);
    expect(await as(bPh, (db) => reviewTarget(db, v.materialsApprovalId!))).toBeNull();
    await as(PH, (db) => decideApproval(db, v.materialsApprovalId!, true));
    expect(await as(bOwn, (db) => serviceRequirements(db, v.versionId))).toBeNull();
    expect(await as(bOwn, (db) => serviceRows(db, v.versionId))).toEqual({ resources: [], eligibility: [] });
  });
});
