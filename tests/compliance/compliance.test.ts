// T-019 Done-when: scenarios PR-97 pass with a test gate; a new evidence file version
// reopens the gate; expiry closes it; vendor-level items invisible to tenants except a
// status view. Plus roles (07), uploader ≠ approver, configuration versions, the audited
// download, append-only evidence and tenant isolation.
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import {
  assertFeatureGate, decideEvidence, downloadEvidence, EvidenceFileError, GateClosedError, gateOpen, itemDetail, register, sniffType, uploadEvidence,
} from "../../src/modules/compliance/compliance";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [tenantId]);
  const b1 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'B1', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  return { tenantId, b1 };
}
async function person(t: T, role: Role): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`c${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf C${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: t.b1 });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : e instanceof GateClosedError ? `gate:${e.message}` : e instanceof EvidenceFileError ? `file:${e.message}` : `raw:${e.code ?? e.message}`));
const plusDays = (d: number) => new Date(Date.now() + d * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const pdf = (text: string) => Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`);
const up = (p: P, obligationKey: string, content = pdf(`dokumen ${++n}`), documentDate = "2026-10-01") =>
  as(p, async (db) => (await uploadEvidence(db, { obligationKey, fileName: `${obligationKey}.pdf`, content, expertName: "Konsultan Pajak Sintetis", documentDate })).fileId);
const itemOf = async (p: P, key: string) => (await as(p, register)).find((r) => r.obligationKey === key)!;
// Decide on the newest file (as the page sends it); itemId may be another tenant's in the
// isolation tests, so the file id is read as the database owner.
const newest = async (itemId: string) => ((await h.admin.query(`select id from evidence_files where item_id = $1 order by version desc limit 1`, [itemId])).rows[0]?.id ?? crypto.randomUUID()) as string;
const decide = async (p: P, itemId: string, decision: "approved" | "rejected" | "revoked", reason?: string, valid?: string) => {
  const file = await newest(itemId);
  return as(p, (db) => decideEvidence(db, itemId, file, decision, reason, valid));
};

let A: T;
let B: T;
beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
});
afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenarios PR-97", () => {
  it("gated feature: without approved tax advice, switching on VAT is refused naming the missing evidence", async () => {
    const own = await person(A, "owner");
    expect(await code(as(own, (db) => assertFeatureGate(db, "vat_on_invoices")))).toBe("gate:Fitur PPN pada invoice terkunci sampai bukti Saran pajak (PPN per jenis layanan) disetujui.");
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(false);
  });

  it("evidence unlocks: the accountant's posting-map sign-off approved by finance opens journal export, audited", async () => {
    const own = await person(A, "owner");
    const fin = await person(A, "finance");
    await h.admin.query(`insert into compliance_config_versions (tenant_id, kind, version) values ($1, 'posting_map', 'pm-1')`, [A.tenantId]);
    await up(own, "posting_map_signoff");
    expect(await as(fin, (db) => gateOpen(db, "journal_export"))).toBe(false);
    const item = await itemOf(fin, "posting_map_signoff");
    await decide(fin, item.itemId!, "approved");
    expect(await as(fin, (db) => gateOpen(db, "journal_export"))).toBe(true);
    await as(fin, (db) => assertFeatureGate(db, "journal_export"));
    const audit = (await h.admin.query(`select reason_code, acting_role from audit_events where object_id = $1`, [item.itemId])).rows;
    expect(audit).toEqual([{ reason_code: "evidence_approved", acting_role: "finance" }]);
    expect((await as(fin, (db) => itemDetail(db, item.itemId!))).decisions[0]).toMatchObject({ decision: "approved", decidedAs: "finance", configVersion: "pm-1" });
  });
});

describe("test gate lifecycle (Done-when)", () => {
  it("approval opens the test gate; a new file version reopens it until approved again", async () => {
    const own = await person(A, "owner");
    const fin = await person(A, "finance");
    await up(fin, "tax_advice");
    const item = await itemOf(own, "tax_advice");
    expect(item.status).toBe("submitted");
    await decide(own, item.itemId!, "approved");
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(true);
    expect(await as(own, (db) => gateOpen(db, "vat_on_invoices"))).toBe(true);
    await up(fin, "tax_advice"); // version 2
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(false);
    expect((await itemOf(own, "tax_advice")).status).toBe("submitted");
    await decide(own, item.itemId!, "approved");
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(true);
    // Even if a newer file reached the item without its state moving (any future write
    // path), the approval covers a named file version only: the gate stays closed.
    await h.admin.query(`insert into evidence_files (item_id, tenant_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
      values ($1, $2, 3, 'v3.pdf', 'application/pdf', 7, encode(sha256('%PDF-v3'::bytea), 'hex'), '%PDF-v3'::bytea, 'Ahli', '2026-10-02', $3, 'finance', 'X')`, [item.itemId, A.tenantId, fin.staffId]);
    expect((await itemOf(own, "tax_advice")).status).toBe("submitted");
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(false);
    await decide(own, item.itemId!, "approved");
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(true);
    const d = await as(own, (db) => itemDetail(db, item.itemId!));
    expect(d.files.map((f) => f.version)).toEqual([3, 2, 1]);
    expect(d.decisions[0].fileId).toBe(d.files[0].id); // the approval names the newest version
  });

  it("expiry closes the gate; revocation closes it too", async () => {
    const own = await person(B, "owner");
    const fin = await person(B, "finance");
    await up(fin, "tax_advice");
    const item = await itemOf(own, "tax_advice");
    await decide(own, item.itemId!, "approved", undefined, plusDays(30));
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(true);
    // The validity passes (simulated: the approved validity moves into the past).
    await h.admin.query(`alter table evidence_items disable trigger evidence_items_guard`);
    await h.admin.query(`update evidence_items set valid_until = current_date - 1 where id = $1`, [item.itemId]);
    await h.admin.query(`alter table evidence_items enable trigger evidence_items_guard`);
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(false);
    expect((await itemOf(own, "tax_advice")).status).toBe("expired");
    // Re-approval needs a validity in the future; then revocation closes it again.
    await decide(own, item.itemId!, "approved");
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(true);
    expect(await code(decide(own, item.itemId!, "revoked"))).toBe("ERR_INVALID_INPUT"); // needs a reason
    await decide(own, item.itemId!, "revoked", "Konsultan menarik sarannya");
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(false);
    expect((await itemOf(own, "tax_advice")).status).toBe("revoked");
  });

  it("a configuration change reopens a gate bound to it (posting map version)", async () => {
    const fin = await person(A, "finance");
    expect(await as(fin, (db) => gateOpen(db, "journal_export"))).toBe(true); // approved for pm-1 above
    await h.admin.query(`update compliance_config_versions set version = 'pm-2', changed_at = now() where tenant_id = $1 and kind = 'posting_map'`, [A.tenantId]);
    expect(await as(fin, (db) => gateOpen(db, "journal_export"))).toBe(false);
    expect((await itemOf(fin, "posting_map_signoff")).status).toBe("submitted");
  });

  it("a gated action holds the evidence it checked: a revocation waits until the action commits", async () => {
    const own = await person(B, "owner");
    const fin = await person(B, "finance");
    const item = await itemOf(own, "tax_advice");
    if (item.status !== "approved") {
      await up(fin, "tax_advice");
      await decide(own, item.itemId!, "approved");
    }
    expect(await as(own, (db) => gateOpen(db, "test_gate"))).toBe(true);
    const order: string[] = [];
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let checked!: () => void;
    const isChecked = new Promise<void>((r) => (checked = r));
    const owner2 = await person(B, "owner");
    const action = as(own, async (db) => {
      await assertFeatureGate(db, "test_gate");
      order.push("checked");
      checked();
      await hold;
      order.push("action committed");
    });
    await isChecked;
    const revoke = decide(owner2, item.itemId!, "revoked", "Ditarik saat aksi berjalan").then(() => order.push("revoked"));
    await new Promise((r) => setTimeout(r, 300));
    release();
    await Promise.all([action, revoke]);
    expect(order).toEqual(["checked", "action committed", "revoked"]);
  });

  it("an unknown gate is closed", async () => {
    const own = await person(A, "owner");
    expect(await as(own, (db) => gateOpen(db, "tidak_ada"))).toBe(false);
  });
});

describe("vendor items", () => {
  it("vendor-level items are invisible to tenants except their status; a tenant cannot touch them", async () => {
    const own = await person(A, "owner");
    // The platform operator records a vendor item (vendor console, T-020+).
    await h.admin.query(`insert into vendor_evidence_items (obligation_key, state, file_sha256, decided_by) values ('vendor_pse', 'submitted', $1, 'Vendor Rahasia')`, ["a".repeat(64)]);
    const row = (await as(own, register)).find((r) => r.obligationKey === "vendor_pse")!;
    expect(row).toMatchObject({ scope: "vendor", status: "submitted", itemId: null, latestVersion: null, mayAct: false, mayRead: false, latestFileId: null });
    expect(JSON.stringify(row)).not.toContain("Vendor Rahasia");
    await expect(as(own, (db) => db.query(`select * from vendor_evidence_items`))).rejects.toMatchObject({ code: "42501" });
    expect(await code(up(own, "vendor_pse"))).toBe("ERR_NOT_FOUND");
    // A vendor obligation can never become a tenant item.
    await expect(h.admin.query(`insert into evidence_items (tenant_id, obligation_key) values ($1, 'vendor_pse')`, [A.tenantId])).rejects.toMatchObject({ code: "42501" });
    // A gate needing a vendor obligation stays closed until the vendor item is approved,
    // then the tenant sees it approved (status only) and the vendor half of the gate opens.
    const pre = await as(own, (db) => db.query(`select label from feature_gate_missing('real_patient_go_live')`));
    expect(pre.rows.map((r) => r.label)).toContain("Pendapat hukum lokasi data");
    const residency = (await h.admin.query(`select encode(sha256(convert_to(storage_locations::text, 'UTF8')), 'hex') as v from vendor_profile where id = 1`)).rows[0]?.v ?? null;
    await h.admin.query(`insert into vendor_evidence_items (obligation_key, state, valid_until, config_version) values ('vendor_residency_opinion', 'approved', null, $1)`, [residency]);
    expect((await as(own, register)).find((r) => r.obligationKey === "vendor_residency_opinion")!.status).toBe("approved");
    const post = await as(own, (db) => db.query(`select label from feature_gate_missing('real_patient_go_live')`));
    expect(post.rows.map((r) => r.label)).not.toContain("Pendapat hukum lokasi data");
    expect(await as(own, (db) => gateOpen(db, "real_patient_go_live"))).toBe(false); // tenant items still missing
  });
});

describe("who handles what (07)", () => {
  it("owner handles every tenant item; facility head clinical; finance tax and accounting; Admin Pusat and auditor read only", async () => {
    const fh = await person(A, "facility_head");
    const fin = await person(A, "finance");
    const ap = await person(A, "admin_pusat");
    const au = await person(A, "auditor");
    expect(await code(up(fh, "sop_waste"))).toBe("ok");
    expect(await code(up(fh, "tax_advice"))).toBe("ERR_FORBIDDEN");
    expect(await code(up(fin, "dpia"))).toBe("ERR_FORBIDDEN");
    expect(await code(up(ap, "dpia"))).toBe("ERR_FORBIDDEN");
    expect(await code(up(au, "dpia"))).toBe("ERR_FORBIDDEN");
    expect((await as(ap, register)).length).toBeGreaterThan(10);
    expect((await as(au, register)).every((r) => !r.mayAct)).toBe(true);
    expect((await as(fh, register)).filter((r) => r.mayAct).every((r) => r.area === "clinical")).toBe(true);
    for (const role of ["manager", "fo_cashier", "nurse", "marketing"] as const) {
      const p = await person(A, role);
      expect(await code(as(p, register)), role).toBe("ERR_FORBIDDEN");
      expect((await as(p, (db) => db.query(`select id from evidence_items`))).rows, role).toEqual([]);
    }
  });

  it("a decision covers the file the decider reviewed: a newer upload since then is a conflict", async () => {
    const own = await person(A, "owner");
    const fh = await person(A, "facility_head");
    await up(fh, "appointment_pharmacist");
    const reviewed = (await itemOf(own, "appointment_pharmacist"));
    await up(fh, "appointment_pharmacist"); // v2 lands while the owner looks at v1
    expect(await code(as(own, (db) => decideEvidence(db, reviewed.itemId!, reviewed.latestFileId!, "approved")))).toBe("ERR_VERSION_CONFLICT");
    // A double submit of the same bytes adds no version.
    const before = (await itemOf(own, "appointment_pharmacist")).latestVersion;
    const same = pdf("sama persis");
    const r1 = await as(fh, (db) => uploadEvidence(db, { obligationKey: "appointment_pharmacist", fileName: "a.pdf", content: same, expertName: "Ahli", documentDate: "2026-10-01" }));
    const r2 = await as(fh, (db) => uploadEvidence(db, { obligationKey: "appointment_pharmacist", fileName: "a.pdf", content: same, expertName: "Ahli", documentDate: "2026-10-01" }));
    expect(r1.created).toBe(true);
    expect(r2).toEqual({ fileId: r1.fileId, created: false }); // the page says "tidak ada versi baru"
    // A real calendar date only (no unmapped database error).
    expect(await code(up(fh, "appointment_pharmacist", pdf("tanggal"), "2026-02-30"))).toMatch(/^file:Tanggal dokumen tidak valid/);
    expect((await itemOf(own, "appointment_pharmacist")).latestVersion).toBe((before ?? 0) + 1);
  });

  it("files and decisions are readable per area (07): finance never sees clinical files, the facility head never tax files", async () => {
    const own = await person(A, "owner");
    const fh = await person(A, "facility_head");
    const fin = await person(A, "finance");
    const clinical = await up(fh, "sop_waste", pdf("limbah area"));
    const tax = (await h.admin.query(`select f.id from evidence_files f join evidence_items i on i.id = f.item_id where i.tenant_id = $1 and i.obligation_key = 'tax_advice' limit 1`, [A.tenantId])).rows[0]?.id
      ?? (await up(fin, "tax_advice"));
    expect(await code(as(fin, (db) => downloadEvidence(db, clinical)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(fh, (db) => downloadEvidence(db, tax)))).toBe("ERR_NOT_FOUND");
    expect((await as(fin, (db) => db.query(`select id from evidence_files where id = $1`, [clinical]))).rows).toEqual([]);
    const finRow = (await itemOf(fin, "sop_waste"));
    expect(finRow).toMatchObject({ mayRead: false, itemId: null, latestFileId: null }); // status only
    expect(await code(as(own, (db) => downloadEvidence(db, clinical)))).toBe("ok");
    const au = await person(A, "auditor");
    expect(await code(as(au, (db) => downloadEvidence(db, clinical)))).toBe("ok");
    const mgr = await person(A, "manager");
    expect(await code(as(mgr, (db) => downloadEvidence(db, clinical)))).toBe("ERR_NOT_FOUND");
  });

  it("the uploader of a file never approves it, also after it expires", async () => {
    const own = await person(A, "owner");
    const fh = await person(A, "facility_head");
    await up(fh, "sop_waste"); // a new version of sop_waste by the facility head
    const item = await itemOf(own, "sop_waste");
    expect(await code(decide(fh, item.itemId!, "approved"))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await code(decide(own, item.itemId!, "approved"))).toBe("ok");
    expect(await code(decide(own, item.itemId!, "approved"))).toBe("ERR_VERSION_CONFLICT");
    expect((await itemOf(fh, "sop_waste")).mayDecide).toBe(false); // the page offers no Setujui to the uploader
    // After expiry the uploader still cannot re-approve its own file.
    await h.admin.query(`alter table evidence_items disable trigger evidence_items_guard`);
    await h.admin.query(`update evidence_items set valid_until = current_date - 1 where id = $1`, [item.itemId]);
    await h.admin.query(`alter table evidence_items enable trigger evidence_items_guard`);
    expect((await itemOf(fh, "sop_waste")).status).toBe("expired");
    expect(await code(decide(fh, item.itemId!, "approved"))).toBe("ERR_APPROVER_IS_REQUESTER");
  });
});

describe("files", () => {
  it("only PDF, PNG or JPEG up to 5 MB by content; the checksum is the database's", async () => {
    const own = await person(A, "owner");
    expect(sniffType(pdf("x"))).toBe("application/pdf");
    expect(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffType(Buffer.from("<html>"))).toBeNull();
    expect(await code(up(own, "dpia", Buffer.from("<script>alert(1)</script>")))).toMatch(/^file:Berkas harus PDF/);
    expect(await code(up(own, "dpia", Buffer.alloc(5 * 1024 * 1024 + 1, 0x25)))).toMatch(/^file:.*5 MB/);
    expect(await code(up(own, "dpia", pdf("x"), "2099-01-01"))).toBe("ERR_INVALID_INPUT");
    // The database decides the type from the bytes too (a caller naming HTML a PDF is refused).
    const html = Buffer.from("<html>bukan pdf</html>");
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    expect(await code(as(own, (db) => db.query(`select evidence_upload('dpia', 'a.pdf', 'application/pdf', $1, $2, 'Ahli', '2026-10-01')`, [html, sha(html)])))).toBe("raw:22023");
    // Even the database owner cannot store a checksum that does not match the bytes.
    const item = (await h.admin.query(`select id from evidence_items where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].id;
    await expect(h.admin.query(`insert into evidence_files (item_id, tenant_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
      values ($1, $2, 99, 'x.pdf', 'application/pdf', 6, $3, '%PDF-x'::bytea, 'Ahli', '2026-10-01', $4, 'owner', 'X')`, [item, A.tenantId, "0".repeat(64), own.staffId])).rejects.toMatchObject({ code: "23514" });
    // A file cannot claim another tenant for a tenant item (composite tenant key, 05 §3.1).
    await expect(h.admin.query(`insert into evidence_files (item_id, tenant_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
      values ($1, $2, 98, 'x.pdf', 'application/pdf', 6, encode(sha256('%PDF-x'::bytea), 'hex'), '%PDF-x'::bytea, 'Ahli', '2026-10-01', $3, 'owner', 'X')`, [item, B.tenantId, own.staffId])).rejects.toMatchObject({ code: "23503" });
    // A forged checksum is refused by the database.
    expect(await code(as(own, (db) => db.query(`select evidence_upload('dpia', 'a.pdf', 'application/pdf', $1, $2, 'Ahli', '2026-10-01')`, [pdf("y"), "0".repeat(64)])))).toBe("raw:22023");
    const id = await up(own, "dpia", pdf("isi dpia"));
    const f = await as(own, (db) => downloadEvidence(db, id));
    expect(f.content.toString()).toContain("isi dpia");
    expect((await h.admin.query(`select reason_code from audit_events where object_id = $1 order by seq`, [id])).rows.map((r) => r.reason_code)).toEqual(["evidence_uploaded", "evidence_downloaded"]);
    await expect(as(own, (db) => db.query(`select content from evidence_files where id = $1`, [id]))).rejects.toMatchObject({ code: "42501" });
  });

  it("evidence is append-only; clinic_app writes nothing directly", async () => {
    const own = await person(A, "owner");
    const id = await up(own, "appointment_dpo");
    for (const sql of [`update evidence_files set file_name = 'x.pdf' where id = '${id}'`, `delete from evidence_files where id = '${id}'`, `delete from evidence_approvals`]) {
      await expect(h.admin.query(sql)).rejects.toMatchObject({ code: "42501" });
    }
    for (const sql of [
      `insert into evidence_items (tenant_id, obligation_key, state) values ('${A.tenantId}', 'dpia', 'approved')`,
      `update evidence_items set state = 'approved'`,
      `insert into feature_gates (key, obligation_key) values ('x_gate', 'dpia')`,
      `select * from compliance_obligations`,
      `insert into compliance_config_versions (tenant_id, kind, version) values ('${A.tenantId}', 'posting_map', 'x')`,
    ]) {
      await expect(as(own, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("tenant isolation", () => {
  it("another tenant's evidence is invisible and undecidable; gates are per tenant", async () => {
    const ownA = await person(A, "owner");
    const ownB = await person(B, "owner");
    const idB = (await itemOf(ownB, "tax_advice")).itemId!;
    expect((await as(ownA, (db) => db.query(`select id from evidence_items where id = $1`, [idB]))).rows).toEqual([]);
    expect(await code(decide(ownA, idB, "revoked", "lintas tenant"))).toBe("ERR_NOT_FOUND");
    const fileB = (await h.admin.query(`select id from evidence_files where item_id = $1 limit 1`, [idB])).rows[0].id;
    expect(await code(as(ownA, (db) => downloadEvidence(db, fileB)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(ownA, (db) => itemDetail(db, idB)))).toBe("ok");
    expect(await as(ownA, (db) => itemDetail(db, idB))).toEqual({ files: [], decisions: [] });
  });
});
