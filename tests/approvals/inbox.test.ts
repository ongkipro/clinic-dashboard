// T-015 Done-when: scenario PR-44 passes with a fixture approval type — a stock adjustment
// requested by a pharmacist is listed for the owner with requester and reason, and the
// pharmacist cannot approve it. Plus the inbox rules: type filter, readers, branch scope,
// detail blocking states, and no cross-tenant view.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval, ownerSelfApprove, requestApproval } from "../../src/modules/approvals/approvals";
import { APPROVAL_TYPES, decidableTypes, INBOX_LIMIT, inboxDetail, listInbox, rupiah } from "../../src/modules/approvals/inbox";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string; name: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`, [tenantId, c, `Cabang ${c}`])).rows[0].id as string;
  return { tenantId, b1: await br("B1"), b2: await br("B2") };
}

async function person(t: T, roles: Role[], branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`i${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const name = `Staf Inbox ${n}`;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: name });
  for (const role of roles) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (branch && !TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch });
  }
  return { acc, staffId, tenantId: t.tenantId, role: roles[0], branch, name };
}

const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: TENANT_WIDE.includes(p.role) ? undefined : p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const subject = () => crypto.randomUUID();
const actor = (p: P) => ({ staffId: p.staffId, role: p.role });

let A: T;
let B: T;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-44 approvals inbox", () => {
  it("a pharmacist's stock adjustment is listed for the owner with requester and reason; the pharmacist cannot approve it", async () => {
    const ph = await person(A, ["pharmacist"], A.b1);
    const own = await person(A, ["owner"]);
    const id = await as(ph, (db) => requestApproval(db, { type: "stock_adjustment", subjectKind: "stock_count", subjectId: subject(), reason: "Selisih opname 3 botol", amountRupiah: 450_000 }));
    const { rows } = await as(own, (db) => listInbox(db, own.role));
    expect(rows.find((r) => r.id === id)).toMatchObject({
      typeLabel: "Penyesuaian stok", requesterName: ph.name, requestedAs: "pharmacist", reason: "Selisih opname 3 botol", amountRupiah: 450_000, branchName: "Cabang B1",
    });
    // The pharmacist sees it as their own request: blocked, and the database refuses.
    expect((await as(ph, (db) => inboxDetail(db, actor(ph), id)))!.blocked).toBe("own-request");
    expect(await code(as(ph, (db) => decideApproval(db, id, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    // The owner may decide; afterwards it leaves the inbox and the detail says decided.
    expect((await as(own, (db) => inboxDetail(db, actor(own), id)))!.blocked).toBeNull();
    await as(own, (db) => decideApproval(db, id, true));
    expect((await as(own, (db) => listInbox(db, own.role))).rows.map((r) => r.id)).not.toContain(id);
    expect(await as(own, (db) => inboxDetail(db, actor(own), id))).toMatchObject({ state: "approved", deciderName: own.name, decidedAs: "owner", blocked: "decided" });
  });
});

describe("Persetujuan inbox rules (UX-26)", () => {
  it("filters by type; an unknown type lists nothing", async () => {
    const ph = await person(A, ["pharmacist"], A.b1);
    const fo = await person(A, ["fo_cashier"], A.b1);
    const own = await person(A, ["owner"]);
    const s = await as(ph, (db) => requestApproval(db, { type: "disposal", subjectKind: "batch", subjectId: subject() }));
    const r = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    const { rows: disposals } = await as(own, (db) => listInbox(db, own.role, { type: "disposal" }));
    expect(disposals.map((x) => x.id)).toContain(s);
    expect(disposals.every((x) => x.type === "disposal")).toBe(true);
    expect((await as(own, (db) => listInbox(db, own.role, { type: "refund_exception" }))).rows.map((x) => x.id)).toContain(r);
    expect((await as(own, (db) => listInbox(db, own.role, { type: "tidak_ada" }))).rows).toEqual([]);
  });

  it("a manager sees its branch only, and only the types it decides (no cash refunds)", async () => {
    const ph1 = await person(A, ["pharmacist"], A.b1);
    const ph2 = await person(A, ["pharmacist"], A.b2);
    const mgr = await person(A, ["manager"], A.b1);
    const in1 = await as(ph1, (db) => requestApproval(db, { type: "stock_adjustment", subjectKind: "stock_count", subjectId: subject() }));
    const in2 = await as(ph2, (db) => requestApproval(db, { type: "stock_adjustment", subjectKind: "stock_count", subjectId: subject() }));
    const ids = (await as(mgr, (db) => listInbox(db, mgr.role))).rows.map((r) => r.id);
    expect(ids).toContain(in1);
    expect(ids).not.toContain(in2);
    expect(await as(mgr, (db) => inboxDetail(db, actor(mgr), in2))).toBeNull(); // another branch: not found
    const fo = await person(A, ["fo_cashier"], A.b1);
    const refund = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    expect((await as(mgr, (db) => listInbox(db, mgr.role))).rows.map((r) => r.id)).not.toContain(refund);
    expect((await as(mgr, (db) => listInbox(db, mgr.role, { type: "refund_exception" }))).rows).toEqual([]);
    // Opened by link it still shows why there is no Setujui.
    expect(await as(mgr, (db) => inboxDetail(db, actor(mgr), refund))).toMatchObject({ blocked: "not-approver", approverRoles: ["owner", "manager"] }); // SET-11 default owner (T-078)
    expect(await code(as(mgr, (db) => decideApproval(db, refund, true)))).toBe("ERR_FORBIDDEN");
  });

  it("another tenant's approval is not listed and not found; a malformed id is not found", async () => {
    const ph = await person(B, ["pharmacist"], B.b1);
    const id = await as(ph, (db) => requestApproval(db, { type: "stock_adjustment", subjectKind: "stock_count", subjectId: subject(), reason: "Rahasia B" }));
    const ownA = await person(A, ["owner"]);
    expect((await as(ownA, (db) => listInbox(db, ownA.role))).rows.map((r) => r.id)).not.toContain(id);
    expect(await as(ownA, (db) => inboxDetail(db, actor(ownA), id))).toBeNull();
    expect(await as(ownA, (db) => inboxDetail(db, actor(ownA), "bukan-uuid"))).toBeNull();
    expect(await code(as(ownA, (db) => decideApproval(db, id, true)))).toBe("ERR_NOT_FOUND");
  });

  it("roles with no waiting request of their types have an empty inbox (facility head, records officer, others)", async () => {
    const ph = await person(A, ["pharmacist"], A.b1);
    await as(ph, (db) => requestApproval(db, { type: "stock_adjustment", subjectKind: "stock_count", subjectId: subject() }));
    for (const role of ["facility_head", "records_officer", "nurse", "pharmacist"] as const) {
      const p = await person(A, [role], A.b1);
      expect((await as(p, (db) => listInbox(db, p.role))).rows, role).toEqual([]);
    }
    // A requester still reads its own request's detail (blocked as its own).
    const own = (await as(ph, (db) => db.query(`select id from approvals where requested_by = $1`, [ph.staffId]))).rows[0].id;
    expect((await as(ph, (db) => inboxDetail(db, actor(ph), own)))!.blocked).toBe("own-request");
  });

  it("an owner's own write-off is recorded decided (B-14) and never waits in the inbox; any other own request is blocked", async () => {
    const own = await person(A, ["owner"]);
    const id = await as(own, (db) => ownerSelfApprove(db, { type: "write_off", subjectKind: "receivable", subjectId: subject(), reason: "Pasien pindah kota, piutang kecil" }));
    expect((await as(own, (db) => listInbox(db, own.role))).rows.map((r) => r.id)).not.toContain(id);
    expect(await as(own, (db) => inboxDetail(db, actor(own), id))).toMatchObject({ state: "approved", ownerSelf: true, blocked: "decided" });
  });

  it("the inbox is a queue: oldest first, and it says when it stops at the limit", async () => {
    const ph = await person(A, ["pharmacist"], A.b2);
    const own = await person(A, ["owner"]);
    const first = await as(ph, (db) => requestApproval(db, { type: "disposal", subjectKind: "batch", subjectId: subject() }));
    const second = await as(ph, (db) => requestApproval(db, { type: "disposal", subjectKind: "batch", subjectId: subject() }));
    // requested_at is immutable (approvals_guard); the second request is simply later.
    const ids = (await as(own, (db) => listInbox(db, own.role, { type: "disposal" }))).rows.map((r) => r.id);
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
    // At the limit: exactly `limit` rows (the oldest) and `more`; below it, no `more`.
    const capped = await as(own, (db) => listInbox(db, own.role, { type: "disposal", limit: 1 }));
    expect(capped).toMatchObject({ more: true });
    expect(capped.rows.map((r) => r.id)).toEqual([ids[0]]);
    expect((await as(own, (db) => listInbox(db, own.role, { type: "disposal", limit: ids.length }))).more).toBe(false);
    expect(INBOX_LIMIT).toBe(200);
  });

  it("requester names follow the readers: a manager sees them at its branch", async () => {
    const ph = await person(A, ["pharmacist"], A.b1);
    const mgr = await person(A, ["manager"], A.b1);
    const id = await as(ph, (db) => requestApproval(db, { type: "stock_adjustment", subjectKind: "stock_count", subjectId: subject() }));
    expect((await as(mgr, (db) => listInbox(db, mgr.role))).rows.find((r) => r.id === id)!.requesterName).toBe(ph.name);
  });

  it("the type labels and approver roles mirror the approval_types registry", async () => {
    const { rows } = await h.admin.query(`select key, label, approver_roles from approval_types order by key`);
    expect(Object.fromEntries(rows.map((r) => [r.key, { label: r.label, approverRoles: r.approver_roles }]))).toEqual(
      Object.fromEntries(Object.entries(APPROVAL_TYPES).sort().map(([k, v]) => [k, { label: v.label, approverRoles: [...v.approverRoles] }])),
    );
    expect(rupiah(1_250_000)).toBe("Rp1.250.000");
    expect(decidableTypes("manager").sort()).toEqual(["attribution_correction", "disposal", "invoice_void", "manual_discount", "refund_exception", "stock_adjustment"]); // invoice void: T-072; refund under SET-11: T-078; manual discount within the manager limit: T-080
    expect(decidableTypes("facility_head")).toEqual(["setting_change_fh", "catalog_clinical_review", "catalog_materials_review", "record_late_correction"]); // SET-48 drafts (T-017), catalog review (T-033), materials fallback (T-034), late record correction (T-053)
    expect(decidableTypes("pharmacist")).toEqual(["catalog_materials_review"]); // T-034 (DEC-047 (2))
    expect(decidableTypes("records_officer")).toEqual(["record_late_correction"]); // T-053 (PR-13)
  });
});
