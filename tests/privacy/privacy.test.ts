// T-039 Done-when: scenario PR-92 (a suspected breach recorded; the owner opens the register: awareness
// time, the 3×24 h deadline and the notice evidence fields) passes; breach state transitions audited.
// Plus the plan review: both paths to closed, notice before notified, the guards, insert-only notices with
// the checksum recomputed and the type from the bytes, processors (cross-border basis), the officers
// (Owner; Admin Pusat only with the data-protection duty, ended duty refused), lifecycle capabilities,
// the consent overview (texts, counts, recent events with names, no clinical content), grants, tenancy.
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { grantConsent, publishConsentText, withdrawConsent } from "../../src/modules/patients/consents/consents";
import {
  addNotice, assessBreach, closeBreach, concludeBreach, minutesLeft, NoticeFileError, noticeFile, overview, recordBreach, saveProcessor, setProcessorActive,
} from "../../src/modules/privacy/privacy";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Privasi Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("C1"), b2: await br("C2") };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`prv${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Privasi ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const b = TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1;
  if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: b };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();

async function patient(t: T, name = "Pasien Persetujuan", phone = "+6281200000000"): Promise<string> {
  const id = (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
  await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, id, phone]);
  return id;
}
const PDF = Buffer.from("%PDF-1.4\n% bukti pemberitahuan sintetis\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const notice = (over: Partial<Parameters<typeof addNotice>[3]> = {}) => ({
  recipientKind: "data_subjects" as const, recipient: "Pasien terdampak (12 orang)", sentAt: new Date(Date.now() - 60_000), channel: "Surat tertulis",
  contentSummary: "Pemberitahuan tertulis sesuai UU PDP Pasal 46", fileName: "pemberitahuan.pdf", content: PDF, ...over,
});
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : e instanceof NoticeFileError ? `file:${e.message}` : `raw:${e.code ?? e.message}`));
const audits = async (id: string) => (await h.admin.query(`select reason_code from audit_events where object_id = $1 order by seq`, [id])).rows.map((r) => r.reason_code);

let A: T;
let B: T;
let OWN: P; let APD: P; let AP: P; let MGR: P; let FIN: P; let FO: P; let BOWN: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); APD = await person(A, "admin_pusat"); AP = await person(A, "admin_pusat");
  MGR = await person(A, "manager"); FIN = await person(A, "finance"); FO = await person(A, "fo_cashier");
  BOWN = await person(B, "owner");
  await h.admin.query(`insert into staff_duties (tenant_id, staff_id, duty, assigned_by) values ($1, $2, 'data_protection', $3)`, [A.tenantId, APD.staffId, OWN.staffId]);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-92: the breach register", () => {
  it("a suspected breach recorded: the register shows the awareness time, the 3×24 h deadline and the notice fields; notified path audited", async () => {
    const aware = new Date(Date.now() - 5 * 3_600_000);
    const { breachId } = await as(OWN, (db) => recordBreach(db, key(), { awareAt: aware, description: "Laptop staf hilang berisi daftar pasien", affectedCount: 12, dataCategories: "Nama, nomor HP" }));
    let o = await as(OWN, (db) => overview(db));
    let b = o.breaches.find((x) => x.id === breachId)!;
    expect(b.awareAt.toISOString()).toBe(aware.toISOString());
    expect(b.deadlineAt.getTime() - b.awareAt.getTime()).toBe(72 * 3_600_000);
    expect(b.state).toBe("open");
    expect(b.notices).toEqual([]);
    expect(minutesLeft(b, o.now)).toBeGreaterThan(66 * 60);
    // A notice needs an assessed breach; notified needs a notice.
    expect(await reason(as(OWN, (db) => addNotice(db, key(), breachId, notice())))).toBe("ERR_VERSION_CONFLICT:not_assessed");
    await as(OWN, (db) => assessBreach(db, key(), breachId));
    expect(await reason(as(OWN, (db) => concludeBreach(db, key(), breachId, true, null)))).toBe("ERR_VERSION_CONFLICT:notice_required");
    const { noticeId } = await as(APD, (db) => addNotice(db, key(), breachId, notice()));
    await as(APD, (db) => addNotice(db, key(), breachId, notice({ recipientKind: "authority", recipient: "Kementerian Komunikasi dan Digital", content: PNG, fileName: "tanda-terima.png" })));
    o = await as(OWN, (db) => overview(db));
    b = o.breaches.find((x) => x.id === breachId)!;
    expect(b.notices.map((n) => [n.recipientKind, n.mediaType])).toEqual([["data_subjects", "application/pdf"], ["authority", "image/png"]]);
    expect(b.notices[0]).toMatchObject({ recipient: "Pasien terdampak (12 orang)", channel: "Surat tertulis", fileName: "pemberitahuan.pdf", sizeBytes: PDF.length,
      sha256: createHash("sha256").update(PDF).digest("hex") });
    expect(Object.keys(b.notices[0]).sort()).toEqual(["channel", "contentSummary", "fileName", "id", "mediaType", "recipient", "recipientKind", "sentAt", "sha256", "sizeBytes"]);
    await as(OWN, (db) => concludeBreach(db, key(), breachId, true, null));
    expect(await reason(as(OWN, (db) => concludeBreach(db, key(), breachId, false, "Tidak berisiko bagi subjek data")))).toBe("ERR_VERSION_CONFLICT:not_assessed");
    await as(OWN, (db) => closeBreach(db, key(), breachId));
    expect(await reason(as(OWN, (db) => closeBreach(db, key(), breachId)))).toBe("ERR_VERSION_CONFLICT:not_concluded");
    expect(await audits(breachId)).toEqual(["breach_recorded", "breach_assessed", "breach_notified", "breach_closed"]);
    expect(await audits(noticeId)).toEqual(["breach_notice_added"]);
    const f = await as(OWN, (db) => noticeFile(db, noticeId));
    expect(f.content.equals(PDF)).toBe(true);
    expect(await audits(noticeId)).toEqual(["breach_notice_added", "breach_notice_downloaded"]);
    const row = (await h.admin.query(`select state, assessed_by, concluded_by, closed_by from breaches where id = $1`, [breachId])).rows[0];
    expect(row).toMatchObject({ state: "closed", assessed_by: OWN.staffId, concluded_by: OWN.staffId, closed_by: OWN.staffId });
  });

  it("the not-notifiable path keeps its reason when closed; transitions out of order are refused", async () => {
    const { breachId } = await as(APD, (db) => recordBreach(db, key(), { awareAt: new Date(Date.now() - 60_000), description: "Email salah kirim tanpa data pasien", affectedCount: null, dataCategories: "Nama staf" }));
    expect(await reason(as(APD, (db) => closeBreach(db, key(), breachId)))).toBe("ERR_VERSION_CONFLICT:not_concluded");
    expect(await reason(as(APD, (db) => concludeBreach(db, key(), breachId, false, "Tidak berisiko")))).toBe("ERR_VERSION_CONFLICT:not_assessed");
    await as(APD, (db) => assessBreach(db, key(), breachId));
    expect(await reason(as(APD, (db) => assessBreach(db, key(), breachId)))).toBe("ERR_VERSION_CONFLICT:not_open");
    expect(await reason(as(APD, (db) => concludeBreach(db, key(), breachId, false, "pendek")))).toBe("ERR_INVALID_INPUT:reason");
    expect(await reason(as(APD, (db) => concludeBreach(db, key(), breachId, true, "Alasan tidak boleh ada")))).toBe("ERR_INVALID_INPUT:reason");
    await as(APD, (db) => concludeBreach(db, key(), breachId, false, "Tidak ada data pribadi pasien yang terdampak"));
    await as(APD, (db) => closeBreach(db, key(), breachId));
    const b = (await as(OWN, (db) => overview(db))).breaches.find((x) => x.id === breachId)!;
    expect(b).toMatchObject({ state: "closed", notNotifiableReason: "Tidak ada data pribadi pasien yang terdampak" });
    expect(await audits(breachId)).toEqual(["breach_recorded", "breach_assessed", "breach_not_notifiable", "breach_closed"]);
    expect(await reason(as(APD, (db) => addNotice(db, key(), breachId, notice())))).toBe("ERR_VERSION_CONFLICT:not_assessed");
  });

  it("input rules: awareness not in the future; notices sent after awareness; files by content, checksum recomputed; same file once", async () => {
    expect(await reason(as(OWN, (db) => recordBreach(db, key(), { awareAt: new Date(Date.now() + 3_600_000), description: "Kebocoran di masa depan", affectedCount: 1, dataCategories: "Nama" })))).toBe("ERR_INVALID_INPUT:breach");
    expect(await reason(as(OWN, (db) => recordBreach(db, key(), { awareAt: new Date(), description: "pendek", affectedCount: 1, dataCategories: "Nama" })))).toBe("ERR_INVALID_INPUT:breach");
    const aware = new Date(Date.now() - 3_600_000);
    const { breachId } = await as(OWN, (db) => recordBreach(db, key(), { awareAt: aware, description: "Akses tidak sah ke akun staf", affectedCount: 3, dataCategories: "Nama, HP" }));
    await as(OWN, (db) => assessBreach(db, key(), breachId));
    expect(await reason(as(OWN, (db) => addNotice(db, key(), breachId, notice({ sentAt: new Date(aware.getTime() - 60_000) }))))).toBe("ERR_INVALID_INPUT:notice");
    expect(await reason(as(OWN, (db) => addNotice(db, key(), breachId, notice({ content: Buffer.from("bukan pdf") }))))).toBe("file:Berkas harus PDF, PNG atau JPEG.");
    // The database checks the bytes too (a caller lying about the type or checksum).
    expect(await code(as(OWN, (db) => db.query(`select breach_notice_add($1, $2::jsonb, 'x.pdf', 'image/png', $3, $4)`,
      [breachId, JSON.stringify({ recipient_kind: "other", recipient: "Uji", sent_at: new Date().toISOString(), channel: "Surat", content_summary: "Ringkasan pemberitahuan" }),
        PDF, createHash("sha256").update(PDF).digest("hex")])))).toBe("raw:22023");
    expect(await code(as(OWN, (db) => db.query(`select breach_notice_add($1, $2::jsonb, 'x.pdf', 'application/pdf', $3, $4)`,
      [breachId, JSON.stringify({ recipient_kind: "other", recipient: "Uji", sent_at: new Date().toISOString(), channel: "Surat", content_summary: "Ringkasan pemberitahuan" }),
        PDF, "0".repeat(64)])))).toBe("raw:22023");
    const one = await as(OWN, (db) => addNotice(db, key(), breachId, notice()));
    const two = await as(OWN, (db) => addNotice(db, key(), breachId, notice()));
    expect(two.noticeId).toBe(one.noticeId);
    // Replay of the same key returns the stored result without the bytes in the record.
    const k = key();
    const same = notice({ content: PNG, fileName: "foto.png" }); // one request, retried as is
    const r1 = await as(OWN, (db) => addNotice(db, k, breachId, same));
    expect(await as(OWN, (db) => addNotice(db, k, breachId, same))).toEqual({ ...r1, replayed: true });
    const rec = JSON.stringify((await h.admin.query(`select * from idempotency_records where key = $1`, [k])).rows);
    expect(rec).not.toContain(PNG.toString("base64"));
  });
});

describe("processors", () => {
  it("add, edit, end; cross-border needs a basis and a domestic one stores none; every change audited", async () => {
    const p = { name: "Vultr", service: "Server aplikasi dan basis data", data_categories: "Seluruh data klinik", location: "Singapura", role: "sub_processor" as const, cross_border: true, transfer_basis: "Perjanjian pemrosesan data dan klausul kontrak standar" };
    expect(await reason(as(OWN, (db) => saveProcessor(db, key(), null, { ...p, transfer_basis: null })))).toBe("ERR_INVALID_INPUT:processor");
    const { processorId } = await as(OWN, (db) => saveProcessor(db, key(), null, p));
    await as(APD, (db) => saveProcessor(db, key(), processorId, { ...p, location: "Jakarta", cross_border: false, transfer_basis: "diabaikan" }));
    let x = (await as(OWN, (db) => overview(db))).processors.find((r) => r.id === processorId)!;
    expect(x).toMatchObject({ location: "Jakarta", crossBorder: false, transferBasis: null, active: true });
    await as(OWN, (db) => setProcessorActive(db, key(), processorId, false));
    await as(OWN, (db) => setProcessorActive(db, key(), processorId, false)); // no change, no audit
    x = (await as(OWN, (db) => overview(db))).processors.find((r) => r.id === processorId)!;
    expect(x.active).toBe(false);
    expect(await audits(processorId)).toEqual(["processor_added", "processor_changed", "processor_ended"]);
    expect(await reason(as(OWN, (db) => saveProcessor(db, key(), crypto.randomUUID(), p)))).toBe("ERR_NOT_FOUND:processor not found");
  });
});

describe("officers, lifecycle and tenancy", () => {
  it("Owner and Admin Pusat with the duty read and write; Admin Pusat without it, manager, finance and FO are refused", async () => {
    for (const p of [AP, MGR, FIN, FO]) {
      expect(await code(as(p, (db) => overview(db))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => recordBreach(db, key(), { awareAt: new Date(), description: "Uji peran tidak berwenang", affectedCount: 1, dataCategories: "Nama" }))), p.role).toBe("ERR_FORBIDDEN");
      expect((await as(p, (db) => db.query(`select count(*)::int as n from breaches`))).rows[0].n, p.role).toBe(0);
    }
    expect((await as(APD, (db) => overview(db))).breaches.length).toBeGreaterThan(0);
  });

  it("an ended duty no longer admits Admin Pusat; the notice bytes are never readable directly", async () => {
    const ap2 = await person(A, "admin_pusat");
    await h.admin.query(`insert into staff_duties (tenant_id, staff_id, duty, assigned_by) values ($1, $2, 'data_protection', $3)`, [A.tenantId, ap2.staffId, OWN.staffId]);
    expect((await as(ap2, (db) => overview(db))).now).toBeInstanceOf(Date);
    await h.admin.query(`update staff_duties set ended_at = now(), ended_by = $2 where staff_id = $1`, [ap2.staffId, OWN.staffId]);
    expect(await code(as(ap2, (db) => overview(db)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(OWN, (db) => db.query(`select content from breach_notices limit 1`)))).toBe("raw:42501");
    expect(await code(as(OWN, (db) => db.query(`update breaches set state = 'closed'`)))).toBe("raw:42501");
  });

  it("a suspended or exiting tenant still records breaches; processors only while onboarding or live", async () => {
    const t = await tenant();
    const own = await person(t, "owner");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [t.tenantId]);
    expect(await reason(as(own, (db) => recordBreach(db, key(), { awareAt: new Date(), description: "Kebocoran setelah keluar", affectedCount: 1, dataCategories: "Nama" })))).toBe("ok");
    expect(await code(as(own, (db) => saveProcessor(db, key(), null, { name: "Penyedia", service: "Layanan", data_categories: "Data", location: "Jakarta", role: "processor", cross_border: false })))).toBe("ERR_TENANT_SUSPENDED");
  });

  it("guards: no delete, identity and deadline fixed, transitions only forward, notices insert-only, truncate refused", async () => {
    const { breachId } = await as(OWN, (db) => recordBreach(db, key(), { awareAt: new Date(Date.now() - 60_000), description: "Uji penjaga register", affectedCount: 1, dataCategories: "Nama" }));
    const err = (q: Promise<unknown>) => q.then(() => "ok", (e) => e.message as string);
    expect(await err(h.admin.query(`delete from breaches where id = $1`, [breachId]))).toMatch(/never deleted/);
    expect(await err(h.admin.query(`update breaches set aware_at = aware_at - interval '1 day', deadline_at = deadline_at - interval '1 day' where id = $1`, [breachId]))).toMatch(/keeps its awareness/);
    expect(await err(h.admin.query(`update breaches set deadline_at = deadline_at + interval '1 day' where id = $1`, [breachId]))).not.toBe("ok");
    expect(await err(h.admin.query(`update breaches set state = 'notified', assessed_at = now(), assessed_by = $2, concluded_at = now(), concluded_by = $2 where id = $1`, [breachId, OWN.staffId]))).toMatch(/moves open/);
    await as(OWN, (db) => assessBreach(db, key(), breachId));
    expect(await err(h.admin.query(`update breaches set state = 'notified', concluded_at = now(), concluded_by = $2 where id = $1`, [breachId, OWN.staffId]))).toMatch(/only with a notice/);
    const { noticeId } = await as(OWN, (db) => addNotice(db, key(), breachId, notice()));
    expect(await err(h.admin.query(`update breach_notices set recipient = 'Diubah' where id = $1`, [noticeId]))).toMatch(/never changed/);
    expect(await err(h.admin.query(`delete from breach_notices where id = $1`, [noticeId]))).toMatch(/never changed/);
    expect(await err(h.admin.query(`truncate breaches cascade`))).not.toBe("ok");
  });

  it("tenant B neither reads nor changes A's registers", async () => {
    const { breachId } = await as(OWN, (db) => recordBreach(db, key(), { awareAt: new Date(Date.now() - 60_000), description: "Rahasia tenant A", affectedCount: 1, dataCategories: "Nama" }));
    const bo = await as(BOWN, (db) => overview(db));
    expect(JSON.stringify(bo)).not.toContain("Rahasia tenant A");
    expect(await code(as(BOWN, (db) => assessBreach(db, key(), breachId)))).toBe("ERR_NOT_FOUND");
    await as(OWN, (db) => assessBreach(db, key(), breachId));
    const { noticeId } = await as(OWN, (db) => addNotice(db, key(), breachId, notice()));
    expect(await code(as(BOWN, (db) => noticeFile(db, noticeId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => addNotice(db, key(), breachId, notice())))).toBe("ERR_NOT_FOUND");
  });
});

describe("the consent overview", () => {
  it("texts and versions, ledger counts per purpose, recent events with names and MRNs, no identity numbers", async () => {
    const t1 = await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Teks WA versi 1" }));
    const t2 = await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Teks WA versi 2" }));
    const fo = await person(A, "fo_cashier");
    const pt = await patient(A, "Pasien Ledger Privasi");
    const g = await as(fo, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: t2.id, channel: "whatsapp" }));
    if (!g.ok) throw new Error("grant");
    await as(fo, (db) => withdrawConsent(db, key(), { consentId: g.consentId, channel: "phone", reason: "Tidak mau promo" }));
    const o = await as(OWN, (db) => overview(db));
    expect(o.texts.filter((x) => x.purpose === "marketing_wa").map((x) => x.version)).toEqual([2, 1]);
    expect(o.texts.map((x) => x.id)).toContain(t1.id);
    expect(o.counts.find((c) => c.purpose === "marketing_wa")).toMatchObject({ active: 0, withdrawn: 1 });
    const ev = o.recent.find((e) => e.id === g.consentId)!;
    expect(ev).toMatchObject({ patientId: pt, patientName: "Pasien Ledger Privasi", purpose: "marketing_wa", textVersion: 2, state: "withdrawn", withdrawChannel: "phone" });
    expect(Object.keys(ev).sort()).toEqual(["grantChannel", "grantedAt", "id", "patientId", "patientMrn", "patientName", "purpose", "state", "textVersion", "withdrawChannel", "withdrawnAt"]);
  });
});
