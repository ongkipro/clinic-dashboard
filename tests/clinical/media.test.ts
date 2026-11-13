// T-055 Done-when: scenario PR-32 (a clinical photo link older than its lifetime is refused), CLIN-015
// (non-comparable photos warn, no score), CLIN-021 (non-clinical roles cannot read photos), CLIN-026 (lost
// assignment removes access), tokens ≤ 10 minutes. Plus the plan review: bytes only through definers, type
// and size from the bytes, BC photos only, token hash only and bound to staff and role, removal hides and
// never while signed, guards, audit and events content-free, merge cluster, cross-tenant.
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { openExam } from "../../src/modules/clinical/exam/exam";
import { sniff } from "../../src/modules/clinical/media/image";
import { addMedia, compareMedia, issueToken, listMedia, redeemToken, removeMedia } from "../../src/modules/clinical/media/media";
import { signRecord } from "../../src/modules/clinical/records/records";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const TABLES = ["clinical_media", "clinical_media_blobs", "media_tokens"];

// Synthetic files: a PNG and a JPEG header of a given size (enough for the sniffers), and a PDF.
function png(w: number, hgt: number, salt = 0): Buffer {
  const b = Buffer.alloc(40 + salt);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(hgt, 20);
  return b;
}
function jpeg(w: number, hgt: number): Buffer {
  // SOI, APP0 (len 16), SOF0 (len 17: precision, height, width, ...), EOI
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt8(0xff, 0); sof.writeUInt8(0xc0, 1); sof.writeUInt16BE(17, 2); sof.writeUInt8(8, 4); sof.writeUInt16BE(hgt, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
const pdf = (s = "x") => Buffer.from(`%PDF-1.4\n% dokumen sintetis ${s}\n%%EOF\n`, "latin1");

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Media Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("M1"), b2: await br("M2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`mdi${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Media ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e as { reason?: string }).reason ?? (e as Error).message);
const key = () => crypto.randomUUID();

async function patient(t: T, name = "Pasien Media"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}
async function visit(t: T, patientId: string, branch = t.b1, ago = 0): Promise<string> {
  return (await h.admin.query(
    `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at)
     values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1), now() - make_interval(days => $4)) returning id`,
    [t.tenantId, branch, patientId, ago],
  )).rows[0].id as string;
}
const close = (v: string) => h.admin.query(`update visits set closed_at = checked_in_at + interval '1 hour', closed_by = checked_in_by where id = $1`, [v]);
const photo = (v: string, angle: "depan" | "serong_45" | "samping" | "atas" = "depan", bytes = png(1200, 1600), takenAt?: Date) =>
  ({ visitId: v, kind: "photo" as const, angle, fileName: "wajah.png", bytes, takenAt });
const audits = async (id: string) => (await h.admin.query(`select action, outcome, reason_code, reason from audit_events where object_id = $1 order by seq`, [id])).rows;

let A: T;
let B: T;
let OWN: P; let DOC: P; let NUR: P; let TH: P; let FH: P; let RO: P; let BC: P; let PH: P; let FO: P; let FIN: P; let MK: P; let MGR: P; let DOCB2: P;
let BDOC: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner");
  DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); TH = await person(A, "therapist", A.b1);
  FH = await person(A, "facility_head", A.b1); RO = await person(A, "records_officer", A.b1); BC = await person(A, "bc", A.b1);
  PH = await person(A, "pharmacist", A.b1); FO = await person(A, "fo_cashier", A.b1); FIN = await person(A, "finance"); MK = await person(A, "marketing");
  MGR = await person(A, "manager", A.b1); DOCB2 = await person(A, "doctor", A.b2);
  BDOC = await person(B, "doctor", B.b1);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("type and size from the bytes", () => {
  it("sniffs PNG, JPEG and PDF and refuses corrupt headers", () => {
    expect(sniff(png(1200, 1600))).toEqual({ contentType: "image/png", width: 1200, height: 1600 });
    expect(sniff(jpeg(640, 480))).toEqual({ contentType: "image/jpeg", width: 640, height: 480 });
    expect(sniff(pdf())).toEqual({ contentType: "application/pdf" });
    expect(sniff(Buffer.from("GIF89a"))).toBeNull();
    expect(sniff(png(1, 1).subarray(0, 20))).toBeNull();
    expect(sniff(png(0, 10))).toBeNull();
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull();
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 0x00]))).toBeNull(); // segment past the end
    const noIhdr = png(10, 10);
    noIhdr.write("XXXX", 12, "latin1");
    expect(sniff(noIhdr)).toBeNull(); // PNG signature without the IHDR chunk
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00]))).toBeNull(); // a frame header cut short
  });
});

describe("upload", () => {
  it("BC, doctor and nurse add media to an open visit of their branch; the same bytes are stored once", async () => {
    const p = await patient(A);
    const v = await visit(A, p);
    const a = await as(BC, (db) => addMedia(db, key(), photo(v)));
    expect(a.objectKey).toBe(`tenants/${A.tenantId}/clinical-media/${createHash("sha256").update(png(1200, 1600)).digest("hex")}`);
    await as(DOC, (db) => addMedia(db, key(), photo(v, "serong_45")));
    await as(NUR, (db) => addMedia(db, key(), { visitId: v, kind: "document", fileName: "rujukan.pdf", bytes: pdf("rujukan") }));
    const rows = (await h.admin.query(`select kind, angle, content_type, width, height, uploaded_as from clinical_media where visit_id = $1 order by created_at`, [v])).rows;
    expect(rows).toEqual([
      { kind: "photo", angle: "depan", content_type: "image/png", width: 1200, height: 1600, uploaded_as: "bc" },
      { kind: "photo", angle: "serong_45", content_type: "image/png", width: 1200, height: 1600, uploaded_as: "doctor" },
      { kind: "document", angle: null, content_type: "application/pdf", width: null, height: null, uploaded_as: "nurse" },
    ]);
    expect((await h.admin.query(`select count(*)::int as n from clinical_media_blobs where tenant_id = $1 and sha256 = encode(sha256($2), 'hex')`, [A.tenantId, png(1200, 1600)])).rows[0].n).toBe(1);
    // An idempotent replay adds nothing; the stored result holds no bytes.
    const k = key();
    const r1 = await as(DOC, (db) => addMedia(db, k, photo(v, "samping", jpeg(800, 600))));
    expect(await as(DOC, (db) => addMedia(db, k, photo(v, "samping", jpeg(800, 600))))).toEqual({ ...r1, replayed: true });
    const idem = (await h.admin.query(`select result::text as t from idempotency_records where key = $1`, [k])).rows[0].t as string;
    expect(Object.keys(JSON.parse(idem)).sort()).toEqual(["media_id", "object_key", "sha256"]);
  });

  it("refuses: wrong role, BC documents, a closed visit, another branch, bad type, too large, a non-draft examination", async () => {
    const p = await patient(A);
    const v = await visit(A, p);
    for (const who of [FO, PH, TH, FH, RO, MGR, OWN]) expect(await code(as(who, (db) => addMedia(db, key(), photo(v)))), who.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(BC, (db) => addMedia(db, key(), { visitId: v, kind: "document", fileName: "x.pdf", bytes: pdf() })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOCB2, (db) => addMedia(db, key(), photo(v))))).toBe("ERR_NOT_FOUND");
    expect(await reason(as(DOC, (db) => addMedia(db, key(), { ...photo(v), bytes: pdf() })))).toBe("type");
    expect(await reason(as(DOC, (db) => addMedia(db, key(), { ...photo(v), bytes: Buffer.from("GIF89a....") })))).toBe("type");
    expect(await reason(as(DOC, (db) => addMedia(db, key(), { ...photo(v), bytes: Buffer.concat([png(10, 10), Buffer.alloc(5_242_881)]) })))).toBe("size");
    expect(await reason(as(DOC, (db) => addMedia(db, key(), { ...photo(v), bytes: Buffer.alloc(0) })))).toBe("size");
    expect(await code(as(DOC, (db) => addMedia(db, key(), { ...photo(v), angle: "miring" as never })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(DOC, (db) => addMedia(db, key(), { ...photo(v), fileName: "../x.png" })))).toBe("ERR_INVALID_INPUT");
    // The database also refuses a forged type or checksum given straight to the store.
    expect(await code(as(DOC, (db) => db.query(`select media_blob_put($1, 'image/png', $2)`, [createHash("sha256").update(pdf()).digest("hex"), pdf()])))).toMatch(/raw:22023/);
    expect(await code(as(DOC, (db) => db.query(`select media_blob_put($1, 'application/pdf', $2)`, ["0".repeat(64), pdf()])))).toMatch(/raw:22023/);
    expect(await code(as(DOC, (db) => db.query(`select media_add($1, $2::jsonb)`, [v, JSON.stringify({ kind: "photo", angle: "depan", width: 1, height: 1, sha256: "a".repeat(64), content_type: "image/png", size_bytes: 10, file_name: "x.png" })])))).toMatch(/raw:22023/);
    // An examination link must be this visit's draft.
    const { examId } = await as(DOC, (db) => openExam(db, key(), v));
    await as(DOC, (db) => addMedia(db, key(), { ...photo(v, "atas"), examinationId: examId }));
    await as(DOC, (db) => signRecord(db, key(), examId, { verified: true }));
    expect(await code(as(DOC, (db) => addMedia(db, key(), { ...photo(v, "samping"), examinationId: examId })))).toBe("ERR_VERSION_CONFLICT");
    await close(v);
    expect(await code(as(DOC, (db) => addMedia(db, key(), photo(v))))).toBe("ERR_VERSION_CONFLICT");
    const X = await tenant("exit");
    const xd = await person(X, "doctor", X.b1);
    expect(await code(as(xd, (db) => addMedia(db, key(), photo(crypto.randomUUID()))))).toBe("ERR_TENANT_SUSPENDED");
  });
});

describe("scenario PR-32: private, short-lived links", () => {
  it("a token opens the bytes within its lifetime; a link older than its lifetime is refused; ≤ 10 minutes", async () => {
    const p = await patient(A);
    const v = await visit(A, p);
    const bytes = png(1000, 1000, 7);
    const { mediaId } = await as(DOC, (db) => addMedia(db, key(), photo(v, "depan", bytes)));
    const t = await as(DOC, (db) => issueToken(db, key(), mediaId, "view"));
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    const served = await as(DOC, (db) => redeemToken(db, t.token));
    expect(served).toMatchObject({ mediaId, purpose: "view", contentType: "image/png", fileName: "wajah.png" });
    expect(served.bytes.equals(bytes)).toBe(true);
    // Multi-use within the lifetime; each use audited.
    await as(DOC, (db) => redeemToken(db, t.token));
    expect((await h.admin.query(`select used_count from media_tokens where id = $1`, [t.tokenId])).rows[0].used_count).toBe(2);
    expect((await audits(mediaId)).filter((r) => r.action === "media_view").map((r) => r.reason_code)).toEqual(["media_viewed", "media_viewed"]);
    // Only the hash is stored.
    const stored = (await h.admin.query(`select token_hash from media_tokens where id = $1`, [t.tokenId])).rows[0].token_hash as string;
    expect(stored).toBe(createHash("sha256").update(t.token).digest("hex"));
    expect(JSON.stringify((await h.admin.query(`select * from media_tokens`)).rows)).not.toContain(t.token);
    // Expired: the link older than its lifetime is refused (the owner moves the clock of this token).
    await h.admin.query(`alter table media_tokens disable trigger media_tokens_guard`);
    await h.admin.query(`update media_tokens set issued_at = issued_at - interval '301 seconds', expires_at = expires_at - interval '301 seconds' where id = $1`, [t.tokenId]);
    await h.admin.query(`alter table media_tokens enable always trigger media_tokens_guard`);
    expect(await reason(as(DOC, (db) => redeemToken(db, t.token)))).toBe("link_expired");
    // The bytes are not readable through the store without a live redeemed token.
    expect(await code(as(DOC, (db) => db.query(`select media_blob_get($1)`, [stored])))).toBe("raw:P0002");
    // Lifetime: ≤ 600 s; 0 or 601 refused; the table refuses longer too.
    const t10 = await as(DOC, (db) => issueToken(db, key(), mediaId, "download", 600));
    expect(t10.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600_000);
    // HYG-016: one clock read — a 600 s token lasts exactly 600 s (two reads a microsecond apart broke media_tokens_check).
    expect((await h.admin.query(`select expires_at - issued_at = interval '600 seconds' as ok from media_tokens where id = $1`, [t10.tokenId])).rows[0].ok).toBe(true);
    for (const ttl of [0, 601, 3600]) expect(await code(as(DOC, (db) => issueToken(db, key(), mediaId, "view", ttl))), String(ttl)).toBe("ERR_INVALID_INPUT");
    await h.admin.query(`alter table media_tokens disable trigger media_tokens_guard`);
    try {
      await expect(h.admin.query(`update media_tokens set expires_at = issued_at + interval '11 minutes' where id = $1`, [t10.tokenId])).rejects.toThrow(/media_tokens_check/);
    } finally {
      await h.admin.query(`alter table media_tokens enable always trigger media_tokens_guard`);
    }
    // A download is audited as one.
    await as(DOC, (db) => redeemToken(db, t10.token));
    expect((await audits(mediaId)).some((r) => r.action === "media_download" && r.reason_code === "media_downloaded")).toBe(true);
    // A replayed issue cannot show the token again.
    const k = key();
    await as(DOC, (db) => issueToken(db, k, mediaId, "view"));
    expect(await code(as(DOC, (db) => issueToken(db, k, mediaId, "view")))).toBe("ERR_IDEMPOTENCY_CONFLICT");
  });

  it("a token is the issuer's only: another staff or another acting role cannot open it; malformed links are not found", async () => {
    const v = await visit(A, await patient(A));
    const { mediaId } = await as(DOC, (db) => addMedia(db, key(), photo(v)));
    const t = await as(DOC, (db) => issueToken(db, key(), mediaId, "view"));
    for (const who of [NUR, FH, RO]) expect(await code(as(who, (db) => redeemToken(db, t.token))), who.role).toBe("ERR_NOT_FOUND");
    const hash = createHash("sha256").update(t.token).digest("hex");
    // The database refuses on its own: another staff, before any redemption, or the bytes for another staff.
    expect(await code(as(NUR, (db) => db.query(`select media_token_redeem($1)`, [hash])))).toBe("raw:P0002");
    expect(await code(as(DOC, (db) => db.query(`select media_blob_get($1)`, [hash])))).toBe("raw:P0002"); // not redeemed yet
    await as(DOC, (db) => redeemToken(db, t.token));
    expect(await code(as(NUR, (db) => db.query(`select media_blob_get($1)`, [hash])))).toBe("raw:P0002");
    expect((await h.admin.query(`select used_count from media_tokens where id = $1`, [t.tokenId])).rows[0].used_count).toBe(1);
    // The same person acting in another role cannot open it.
    const dn = await person(A, "doctor", A.b1);
    const rid = await assignRole(h.admin, { tenantId: A.tenantId, staffId: dn.staffId, role: "nurse" });
    await assignBranch(h.admin, { tenantId: A.tenantId, staffRoleId: rid, branchId: A.b1 });
    const td = await as(dn, (db) => issueToken(db, key(), mediaId, "view"));
    const asNurse = { ...dn, role: "nurse" as Role };
    expect(await code(as(asNurse, (db) => db.query(`select media_token_redeem($1)`, [createHash("sha256").update(td.token).digest("hex")])))).toBe("raw:P0002");
    // A store returning other bytes is refused (integrity).
    const t2 = await as(DOC, (db) => issueToken(db, key(), mediaId, "view"));
    const liar = { put: async () => ({ objectKey: "x" }), get: async () => Buffer.from("bukan berkas ini") };
    expect(await reason(as(DOC, (db) => redeemToken(db, t2.token, liar)))).toBe("integrity");
    // A malformed link never reaches the database.
    expect(await reason(as(DOC, (db) => redeemToken(db, "x")))).toBe("link");
    expect(await code(as(DOC, (db) => redeemToken(db, "x")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(DOC, (db) => redeemToken(db, "A".repeat(43))))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => redeemToken(db, t.token)))).toBe("ERR_NOT_FOUND");
  });
});

describe("CLIN-021: non-clinical roles read no photos", () => {
  it("clinical readers list and open; BC photos only; pharmacist and non-clinical roles are forbidden; tables unreadable", async () => {
    const p = await patient(A, "Pasien Rahasia Foto");
    const v = await visit(A, p);
    const { mediaId: ph } = await as(DOC, (db) => addMedia(db, key(), photo(v)));
    const { mediaId: dc } = await as(DOC, (db) => addMedia(db, key(), { visitId: v, kind: "document", fileName: "hasil-lab.pdf", bytes: pdf("lab") }));
    for (const who of [DOC, NUR, TH, FH, RO]) {
      expect((await as(who, (db) => listMedia(db, p))).map((m) => m.id).sort(), who.role).toEqual([ph, dc].sort());
      const t = await as(who, (db) => issueToken(db, key(), dc, "view"));
      expect((await as(who, (db) => redeemToken(db, t.token))).contentType).toBe("application/pdf");
    }
    expect((await as(BC, (db) => listMedia(db, p))).map((m) => m.id)).toEqual([ph]);
    expect(await code(as(BC, (db) => issueToken(db, key(), dc, "view")))).toBe("ERR_NOT_FOUND");
    for (const who of [PH, FO, FIN, MK, MGR, OWN]) {
      expect(await code(as(who, (db) => listMedia(db, p))), who.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(who, (db) => issueToken(db, key(), ph, "view"))), who.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(who, (db) => compareMedia(db, ph, dc))), who.role).toBe("ERR_FORBIDDEN");
      expect(await as(who, async (db) => (await db.query(`select count(*)::int as n from clinical_media where id = $1`, [ph])).rows[0].n), who.role).toBe(0);
    }
    // Bytes, tokens and hidden columns: no app or operator access at all.
    for (const r of ["clinic_app", "clinic_operator", "clinic_vendor"]) {
      for (const t of ["clinical_media_blobs", "media_tokens"]) {
        expect((await h.admin.query(`select has_table_privilege($1, $2, 'select') as ok`, [r, `public.${t}`])).rows[0].ok, `${r} ${t}`).toBe(false);
      }
      for (const c of ["sha256", "object_key", "file_name", "removed_reason"]) {
        expect((await h.admin.query(`select has_column_privilege($1, 'public.clinical_media', $2, 'select') as ok`, [r, c])).rows[0].ok, `${r} ${c}`).toBe(false);
      }
    }
    await expect(as(DOC, (db) => db.query(`select content from clinical_media_blobs limit 1`))).rejects.toThrow(/permission denied/);
  });
});

describe("CLIN-026: lost assignment removes access", () => {
  it("removing the branch role empties the list and refuses an issued token at once; another branch never reads", async () => {
    const p = await patient(A);
    const v = await visit(A, p);
    const d = await person(A, "doctor", A.b1);
    const { mediaId } = await as(DOC, (db) => addMedia(db, key(), photo(v)));
    const ctx = await resolveContext(app, d.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b1 });
    const t = await withTenantContext(app, ctx, (db) => issueToken(db, key(), mediaId, "view"));
    expect(await withTenantContext(app, ctx, (db) => listMedia(db, p))).toHaveLength(1);
    await h.admin.query(`delete from staff_branches where staff_id = $1`, [d.staffId]);
    expect(await withTenantContext(app, ctx, (db) => listMedia(db, p))).toEqual([]);
    // The issued link is refused at once: the session's branch role is gone, so the actor lock refuses the
    // bound context before the token is looked up (fail closed).
    expect(await reason(withTenantContext(app, ctx, (db) => redeemToken(db, t.token)))).toMatch(/bound context is not an active membership/);
    expect(await reason(withTenantContext(app, ctx, (db) => issueToken(db, key(), mediaId, "view")))).toMatch(/bound context is not an active membership/);
    expect((await h.admin.query(`select used_count from media_tokens where id = $1`, [t.tokenId])).rows[0].used_count).toBe(0);
    // The same staff keeping the role at the other branch only: the token is refused as access revoked.
    const d2 = await person(A, "doctor", A.b1, A.b2);
    const ctx2 = await resolveContext(app, d2.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b1 });
    const t2 = await withTenantContext(app, ctx2, (db) => issueToken(db, key(), mediaId, "view"));
    await h.admin.query(`delete from staff_branches where staff_id = $1 and branch_id = $2`, [d2.staffId, A.b1]);
    const atB2 = await resolveContext(app, d2.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    expect(await code(withTenantContext(app, atB2, (db) => redeemToken(db, t2.token)))).not.toBe("ok");
    expect(await withTenantContext(app, { ...atB2, allowedBranchIds: [A.b2, A.b1] }, (db) => listMedia(db, p))).toEqual([]);
    expect(await reason(withTenantContext(app, { ...atB2, allowedBranchIds: [A.b2, A.b1] }, (db) => redeemToken(db, t2.token)))).toBe("access_revoked");
    expect(await as(DOCB2, (db) => listMedia(db, p))).toEqual([]);
    expect(await code(as(DOCB2, (db) => issueToken(db, key(), mediaId, "view")))).toBe("ERR_NOT_FOUND");
    // A doctor of both branches acting at b2 with only b2 in the session does not read b1's media.
    const both = await person(A, "doctor", A.b2, A.b1);
    const bothB2 = await resolveContext(app, both.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    expect(await withTenantContext(app, { ...bothB2, allowedBranchIds: [A.b2] }, (db) => listMedia(db, p))).toEqual([]);
    expect(await withTenantContext(app, { ...bothB2, allowedBranchIds: [A.b2, A.b1] }, (db) => listMedia(db, p))).toHaveLength(1);
    // Comparing needs both photos readable now.
    const v3 = await visit(A, await patient(A));
    const { mediaId: x1 } = await as(DOC, (db) => addMedia(db, key(), photo(v3, "depan", png(500, 500, 41))));
    const { mediaId: x2 } = await as(DOC, (db) => addMedia(db, key(), photo(v3, "depan", png(500, 500, 42))));
    expect(await code(as(DOCB2, (db) => compareMedia(db, x1, x2)))).toBe("ERR_NOT_FOUND");
  });
});

describe("CLIN-015: non-comparable photos warn, no score", () => {
  it("same angle, aspect and a day apart are comparable; otherwise reasons; never a score or percentage", async () => {
    const p = await patient(A);
    const v1 = await visit(A, p, A.b1, 30);
    const day = 86_400_000;
    const { mediaId: a } = await as(DOC, (db) => addMedia(db, key(), photo(v1, "depan", png(1200, 1600, 1), new Date(Date.now() - 30 * day))));
    await close(v1);
    const v2 = await visit(A, p);
    const { mediaId: b } = await as(DOC, (db) => addMedia(db, key(), photo(v2, "depan", png(1500, 2000, 2))));
    const { mediaId: c } = await as(DOC, (db) => addMedia(db, key(), photo(v2, "serong_45", png(1600, 1200, 3))));
    const { mediaId: d } = await as(DOC, (db) => addMedia(db, key(), photo(v2, "atas", png(1500, 2000, 4))));
    const ok = await as(DOC, (db) => compareMedia(db, b, a));
    expect(ok).toMatchObject({ status: "comparable", comparable: true, reasons: [], earlier: { id: a }, later: { id: b } });
    const w = await as(DOC, (db) => compareMedia(db, a, c));
    expect(w).toMatchObject({ status: "warning", comparable: false });
    expect(w.reasons.sort()).toEqual(["angle_differs", "aspect_differs"]);
    expect((await as(DOC, (db) => compareMedia(db, b, c))).reasons.sort()).toEqual(["angle_differs", "aspect_differs", "time_too_close"]);
    expect((await as(DOC, (db) => compareMedia(db, a, d))).reasons.sort()).toEqual(["angle_differs", "angle_not_in_protocol"]);
    // Aspect tolerance 5 %: 1200x1600 vs 1230x1600 (2.4 %) is fine; vs 1300x1600 (7.7 %) warns.
    const { mediaId: e } = await as(DOC, (db) => addMedia(db, key(), photo(v2, "depan", png(1230, 1600, 5))));
    const { mediaId: f } = await as(DOC, (db) => addMedia(db, key(), photo(v2, "depan", png(1300, 1600, 6))));
    expect((await as(DOC, (db) => compareMedia(db, a, e))).reasons).toEqual([]);
    expect((await as(DOC, (db) => compareMedia(db, a, f))).reasons).toEqual(["aspect_differs"]);
    for (const r of [ok, w]) expect(JSON.stringify(r)).not.toMatch(/score|percent|improve|grade|"\d+%"/i);
    // Not comparable at all: the same photo, a document, another patient.
    expect(await code(as(DOC, (db) => compareMedia(db, a, a)))).toBe("ERR_INVALID_INPUT");
    const { mediaId: doc } = await as(DOC, (db) => addMedia(db, key(), { visitId: v2, kind: "document", fileName: "x.pdf", bytes: pdf("cmp") }));
    expect(await code(as(DOC, (db) => compareMedia(db, a, doc)))).toBe("ERR_INVALID_INPUT");
    const other = await visit(A, await patient(A));
    const { mediaId: o } = await as(DOC, (db) => addMedia(db, key(), photo(other, "depan", png(1200, 1600, 9))));
    expect(await code(as(DOC, (db) => compareMedia(db, a, o)))).toBe("ERR_INVALID_INPUT");
    expect((await audits(a)).some((r) => r.reason_code === "media_compared")).toBe(true);
  });

  it("the merge cluster: photos of a merged duplicate list and compare with the survivor's", async () => {
    const dup = await patient(A, "Duplikat Foto");
    const p = await patient(A, "Penyintas Foto");
    const v1 = await visit(A, dup, A.b1, 10);
    const { mediaId: a } = await as(DOC, (db) => addMedia(db, key(), photo(v1, "depan", png(1200, 1600, 11), new Date(Date.now() - 10 * 86_400_000))));
    await close(v1);
    await as(RO, (db) => mergePatients(db, key(), p, dup, "Data ganda pasien yang sama"));
    const v2 = await visit(A, p);
    const { mediaId: b } = await as(DOC, (db) => addMedia(db, key(), photo(v2, "depan", png(1200, 1600, 12))));
    expect((await as(DOC, (db) => listMedia(db, p))).map((m) => m.id).sort()).toEqual([a, b].sort());
    // A visit recorded on the duplicate's id after the merge: the media name the surviving patient.
    await close(v2);
    const v3 = await visit(A, dup);
    const { mediaId: c } = await as(DOC, (db) => addMedia(db, key(), photo(v3, "samping", png(1200, 1600, 13))));
    expect((await h.admin.query(`select patient_id from clinical_media where id = $1`, [c])).rows[0].patient_id).toBe(p);
    expect((await as(DOC, (db) => compareMedia(db, a, b))).status).toBe("comparable");
  });
});

describe("removal, guards, audit, events, cross-tenant", () => {
  it("the uploader or a facility head hides media with a reason; never while signed; never deleted", async () => {
    const pr = await patient(A);
    const v = await visit(A, pr);
    const { mediaId: m1 } = await as(NUR, (db) => addMedia(db, key(), photo(v, "depan", png(900, 900, 21))));
    const { mediaId: m2 } = await as(DOC, (db) => addMedia(db, key(), photo(v, "samping", png(900, 900, 22))));
    expect(await code(as(DOC, (db) => removeMedia(db, key(), m1, "Salah pasien")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(NUR, (db) => removeMedia(db, key(), m1, "ab")))).toBe("ERR_INVALID_INPUT");
    await as(NUR, (db) => removeMedia(db, key(), m1, "Salah unggah"));
    await as(FH, (db) => removeMedia(db, key(), m2, "Foto buram"));
    expect(await code(as(NUR, (db) => removeMedia(db, key(), m1, "Salah unggah")))).toBe("ERR_NOT_FOUND");
    expect((await h.admin.query(`select count(*)::int as n from clinical_media where id = any($1) and removed_at is not null`, [[m1, m2]])).rows[0].n).toBe(2);
    expect(await as(DOC, async (db) => (await db.query(`select count(*)::int as n from clinical_media where id = any($1)`, [[m1, m2]])).rows[0].n)).toBe(0);
    expect(await as(DOC, (db) => listMedia(db, pr))).toEqual([]);
    // Linked to a signed examination: final.
    const v2 = await visit(A, await patient(A));
    const { examId } = await as(DOC, (db) => openExam(db, key(), v2));
    const { mediaId: m3 } = await as(DOC, (db) => addMedia(db, key(), { ...photo(v2, "depan", png(900, 900, 23)), examinationId: examId }));
    await as(DOC, (db) => signRecord(db, key(), examId, { verified: true }));
    expect(await code(as(DOC, (db) => removeMedia(db, key(), m3, "Salah unggah")))).toBe("ERR_VERSION_CONFLICT");
    await expect(h.admin.query(`update clinical_media set removed_at = now(), removed_by = uploaded_by, removed_as = 'doctor', removed_reason = 'x x x' where id = $1`, [m3])).rejects.toThrow(/signed examination are final/);
    // Guards.
    await expect(h.admin.query(`delete from clinical_media where id = $1`, [m3])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update clinical_media set angle = 'atas' where id = $1`, [m3])).rejects.toThrow(/only by removal/);
    await expect(h.admin.query(`update clinical_media set removed_reason = 'lain lagi' where id = $1`, [m1])).rejects.toThrow(/only by removal/);
    await expect(h.admin.query(`update clinical_media_blobs set content = '\\x00' where tenant_id = $1`, [A.tenantId])).rejects.toThrow(/never change/);
    await expect(h.admin.query(`delete from clinical_media_blobs where tenant_id = $1`, [A.tenantId])).rejects.toThrow(/never deleted/);
    const t = await as(DOC, (db) => issueToken(db, key(), m3, "view"));
    await expect(h.admin.query(`update media_tokens set purpose = 'download' where id = $1`, [t.tokenId])).rejects.toThrow(/only by use/);
    await expect(h.admin.query(`update media_tokens set used_count = 5, last_used_at = now() where id = $1`, [t.tokenId])).rejects.toThrow(/only by use/);
    await expect(h.admin.query(`delete from media_tokens where id = $1`, [t.tokenId])).rejects.toThrow(/never deleted/);
    for (const tb of TABLES) await expect(h.admin.query(`truncate ${tb} cascade`)).rejects.toThrow();
    const trig = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = any($1::regclass[]) and not tgisinternal order by 1`, [TABLES])).rows;
    expect(trig.map((r) => `${r.tgname}:${r.tgenabled}`)).toEqual([
      "clinical_media_blobs_guard:A", "clinical_media_blobs_no_truncate:A", "clinical_media_guard:A", "clinical_media_no_truncate:A",
      "media_tokens_guard:A", "media_tokens_no_truncate:A"]);
  });

  it("audit and events carry ids and codes only; support classes; cross-tenant reads and writes nothing", async () => {
    const p = await patient(A, "Rahasia Wajah");
    const v = await visit(A, p);
    const { mediaId } = await as(DOC, (db) => addMedia(db, key(), { ...photo(v, "depan", png(700, 700, 31)), fileName: "rahasia-wajah.png" }));
    await as(DOC, (db) => removeMedia(db, key(), mediaId, "Rahasia alasan"));
    const au = await audits(mediaId);
    expect(au.map((r) => r.reason_code)).toEqual(["media_uploaded", "media_removed"]);
    expect(au.every((r) => r.reason === null)).toBe(true);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at, id`, [mediaId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["ClinicalMediaAdded", "ClinicalMediaRemoved"]);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia|wajah\.png|[0-9a-f]{64}/i);
    const kinds = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name = any($1::text[]) order by 1`, [TABLES.map((t) => `public.${t}`)])).rows;
    expect(kinds.map((k) => `${k.table_name}:${k.support_class}`)).toEqual(["public.clinical_media:clinical", "public.clinical_media_blobs:never", "public.media_tokens:never"]);
    for (const f of ["media_guard()", "media_sniff(bytea)", "media_reader()", "media_uploader()"]) {
      for (const r of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, `public.${f}`])).rows[0].ok, `${r} ${f}`).toBe(false);
      }
    }
    const v2 = await visit(A, await patient(A));
    const { mediaId: m } = await as(DOC, (db) => addMedia(db, key(), photo(v2, "depan", png(700, 700, 32))));
    const t = await as(DOC, (db) => issueToken(db, key(), m, "view"));
    expect(await as(BDOC, async (db) => (await db.query(`select count(*)::int as n from clinical_media`)).rows[0].n)).toBe(0);
    expect(await code(as(BDOC, (db) => addMedia(db, key(), photo(v2))))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => issueToken(db, key(), m, "view")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => redeemToken(db, t.token)))).toBe("ERR_NOT_FOUND");
    expect(await as(BDOC, (db) => listMedia(db, p))).toEqual([]);
    expect(await code(as(BDOC, (db) => removeMedia(db, key(), m, "Coba hapus")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => compareMedia(db, m, mediaId)))).toBe("ERR_NOT_FOUND");
  });
});
