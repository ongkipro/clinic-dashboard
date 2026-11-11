// T-038 Done-when: the consent-ledger half of scenario PR-4 passes (withdrawal recorded, text versions
// immutable). Plus the plan review: texts insert-only and gap-free, never backdated; what was shown is
// what is recorded; one active consent per purpose; withdrawal once; care notice not withdrawable;
// procedure refused; authority (publish with the data-protection duty; recorder roles); readers
// (identity roles, marketing only through marketing_contacts, the service context); idempotent replay;
// lifecycle; events and audit ids only; vendor classes; cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import {
  consentActive, currentText, grantConsent, marketingContacts, patientConsents, publishConsentText, withdrawConsent,
} from "../../src/modules/patients/consents/consents";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2); the production gate is T-037's, reused here

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Persetujuan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("C1"), b2: await br("C2") };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`cns${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Persetujuan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const b = TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1;
  if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: b };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
// A tenant-bound service context (the outbox worker): tenant only, no staff, no roles.
const service = <R>(t: T, fn: (db: pg.PoolClient) => Promise<R>) => withTenantContext(app, { tenantId: t.tenantId, allowedBranchIds: [], roles: [] }, fn);
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
const PURPOSES = ["care_notice", "clinical_photo", "marketing_wa", "publication"] as const;

let A: T;
let B: T;
let OWN: P; let AP: P; let APD: P; let FO: P; let CS: P; let BC: P; let DOC: P; let RO: P; let MGR: P; let NUR: P; let FIN: P; let MK: P; let PU: P; let AU: P;
let BOWN: P; let BFO: P;
const text: Record<string, string> = {};

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); APD = await person(A, "admin_pusat");
  FO = await person(A, "fo_cashier"); CS = await person(A, "central_cs"); BC = await person(A, "bc"); DOC = await person(A, "doctor");
  RO = await person(A, "records_officer"); MGR = await person(A, "manager"); NUR = await person(A, "nurse"); FIN = await person(A, "finance");
  MK = await person(A, "marketing"); PU = await person(A, "purchasing"); AU = await person(A, "auditor");
  BOWN = await person(B, "owner"); BFO = await person(B, "fo_cashier");
  await h.admin.query(`insert into staff_duties (tenant_id, staff_id, duty, assigned_by) values ($1, $2, 'data_protection', $3)`, [A.tenantId, APD.staffId, OWN.staffId]);
  for (const p of PURPOSES) text[p] = (await as(OWN, (db) => publishConsentText(db, { purpose: p, body: `Teks ${p} versi 1` }))).id;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-4, ledger half", () => {
  it("marketing consent is withdrawn and recorded; care notice stays active; the history keeps every row", async () => {
    const pt = await patient(A);
    for (const p of ["care_notice", "marketing_wa"] as const) {
      expect(await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: p, textId: text[p], channel: "in_person" }))).toMatchObject({ ok: true });
    }
    expect(await as(FO, (db) => consentActive(db, pt, "marketing_wa"))).toBe(true);
    const mk = (await as(FO, (db) => patientConsents(db, pt))).find((r) => r.purpose === "marketing_wa")!;
    expect(await as(CS, (db) => withdrawConsent(db, key(), { consentId: mk.id, channel: "whatsapp", reason: "Tidak mau promo lagi" }))).toMatchObject({ ok: true });
    expect(await as(FO, (db) => consentActive(db, pt, "marketing_wa"))).toBe(false);
    expect(await as(FO, (db) => consentActive(db, pt, "care_notice"))).toBe(true);
    // The outbound worker sees the same answer in its service context.
    expect(await service(A, (db) => consentActive(db, pt, "marketing_wa"))).toBe(false);
    expect(await service(A, (db) => consentActive(db, pt, "care_notice"))).toBe(true);
    const rows = await as(RO, (db) => patientConsents(db, pt));
    const w = rows.find((r) => r.id === mk.id)!;
    expect(w).toMatchObject({ withdrawnAs: "central_cs", withdrawChannel: "whatsapp", withdrawReason: "Tidak mau promo lagi", grantedAs: "fo_cashier", textVersion: 1 });
    expect(w.withdrawnBy).toBe(CS.staffId);
    // A new grant after a withdrawal is a new row; the old one stays.
    expect(await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: text.marketing_wa, channel: "paper" }))).toMatchObject({ ok: true });
    const after = await as(FO, (db) => patientConsents(db, pt));
    expect(after.filter((r) => r.purpose === "marketing_wa")).toHaveLength(2);
    expect(after.filter((r) => r.purpose === "marketing_wa" && !r.withdrawnAt)).toHaveLength(1);
  });

  it("text versions are gap-free and immutable; a change is a new version; never backdated", async () => {
    const v2 = await as(OWN, (db) => publishConsentText(db, { purpose: "publication", body: "Teks publikasi versi 2" }));
    const v3 = await as(APD, (db) => publishConsentText(db, { purpose: "publication", body: "Teks publikasi versi 3" }));
    expect([v2.version, v3.version]).toEqual([2, 3]);
    expect((await as(FO, (db) => currentText(db, "publication")))?.id).toBe(v3.id);
    await expect(h.admin.query(`update consent_texts set body = 'diubah' where id = $1`, [v2.id])).rejects.toThrow(/never changed or deleted/);
    await expect(h.admin.query(`delete from consent_texts where id = $1`, [v2.id])).rejects.toThrow(/never changed or deleted/);
    await expect(h.admin.query(`truncate consent_texts cascade`)).rejects.toThrow();
    const past = new Date(Date.now() - 3_600_000);
    expect(await code(as(OWN, (db) => publishConsentText(db, { purpose: "publication", body: "Mundur", effectiveFrom: past })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => publishConsentText(db, { purpose: "publication", body: "Jauh", effectiveFrom: new Date(Date.now() + 400 * 86_400_000) })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => publishConsentText(db, { purpose: "publication", body: "   " })))).toBe("ERR_INVALID_INPUT");
    // A future version is not in force yet; the current one still is.
    const fut = await as(OWN, (db) => publishConsentText(db, { purpose: "publication", body: "Teks mendatang", effectiveFrom: new Date(Date.now() + 86_400_000) }));
    expect(fut.version).toBe(4);
    expect((await as(FO, (db) => currentText(db, "publication")))?.id).toBe(v3.id);
    // Procedure texts may be published (SET-45); procedure consent is UX-39's (T-054).
    expect((await as(OWN, (db) => publishConsentText(db, { purpose: "procedure", body: "Teks tindakan" }))).version).toBe(1);
  });
});

describe("grant rules", () => {
  it("what was shown is what is recorded: a superseded text is refused; one active consent per purpose", async () => {
    const pt = await patient(A);
    const old = text.clinical_photo;
    const nw = await as(OWN, (db) => publishConsentText(db, { purpose: "clinical_photo", body: "Foto klinis versi 2" }));
    expect(await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "clinical_photo", textId: old, channel: "in_person" }))).toMatchObject({ ok: false, code: "consent_text_changed" });
    text.clinical_photo = nw.id;
    expect(await as(DOC, (db) => grantConsent(db, key(), { patientId: pt, purpose: "clinical_photo", textId: nw.id, channel: "in_person" }))).toMatchObject({ ok: true });
    expect(await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "clinical_photo", textId: nw.id, channel: "in_person" }))).toMatchObject({ ok: false, code: "already_granted" });
    // Two concurrent grants for one patient and purpose: exactly one row.
    // Two grants for one patient and purpose, the second while the first is uncommitted: the second
    // waits on the tenant's staff_access lock and then answers already_granted (not a raw unique violation).
    const p2 = await patient(A);
    const cur = (await as(FO, (db) => currentText(db, "publication")))!.id;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let granted!: () => void;
    const first = new Promise<void>((r) => (granted = r));
    const t1 = as(FO, async (db) => {
      const r = await grantConsent(db, key(), { patientId: p2, purpose: "publication", textId: cur, channel: "phone" });
      granted();
      await gate;
      return r;
    });
    await first;
    const t2 = as(CS, (db) => grantConsent(db, key(), { patientId: p2, purpose: "publication", textId: cur, channel: "phone" })).catch((e) => e);
    for (let i = 0; i < 100 && Number((await h.admin.query(`select count(*) from pg_locks where not granted`)).rows[0].count) === 0; i++) await new Promise((r) => setTimeout(r, 50));
    release();
    expect(await t1).toMatchObject({ ok: true });
    expect(await t2).toMatchObject({ ok: false, code: "already_granted" });
  });

  it("procedure is refused by the writer and by the table; a text of another purpose or tenant is not found", async () => {
    const pt = await patient(A);
    const proc = (await as(FO, (db) => currentText(db, "procedure")))!.id;
    expect(await code(as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "procedure" as never, textId: proc, channel: "in_person" })))).toBe("ERR_INVALID_INPUT");
    await expect(h.admin.query(
      `insert into consents (tenant_id, patient_id, purpose, consent_text_id, granted_by, granted_as, grant_channel) values ($1, $2, 'procedure', $3, $4, 'fo_cashier', 'paper')`,
      [A.tenantId, pt, proc, FO.staffId],
    )).rejects.toThrow(/consents_purpose_check/);
    // marketing text for a clinical_photo grant: not found (purpose binding), not "text changed".
    expect(await code(as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "clinical_photo", textId: text.marketing_wa, channel: "in_person" })))).toBe("ERR_NOT_FOUND");
    const bText = (await as(BOWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Teks B" }))).id;
    expect(await code(as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: bText, channel: "in_person" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => grantConsent(db, key(), { patientId: crypto.randomUUID(), purpose: "marketing_wa", textId: text.marketing_wa, channel: "in_person" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: text.marketing_wa, channel: "sms" as never })))).toBe("ERR_INVALID_INPUT");
    // The table binds the text's purpose too (composite FK), not only the writer.
    await expect(h.admin.query(
      `insert into consents (tenant_id, patient_id, purpose, consent_text_id, granted_by, granted_as, grant_channel) values ($1, $2, 'clinical_photo', $3, $4, 'fo_cashier', 'paper')`,
      [A.tenantId, pt, text.marketing_wa, FO.staffId],
    )).rejects.toThrow(/consents_text_purpose_fk/);
  });

  it("a consent text must exist before a grant (no seeded texts)", async () => {
    const C = await tenant();
    const cfo = await person(C, "fo_cashier");
    const pt = await patient(C);
    expect(await as(cfo, (db) => currentText(db, "marketing_wa"))).toBeNull();
    expect(await code(as(cfo, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: crypto.randomUUID(), channel: "in_person" })))).toBe("ERR_NOT_FOUND");
  });
});

describe("withdrawal rules", () => {
  it("care notice is not withdrawable; a withdrawal is recorded once; the reason is required; guards hold directly", async () => {
    const pt = await patient(A);
    for (const p of ["care_notice", "marketing_wa"] as const) await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: p, textId: text[p], channel: "in_person" }));
    const rows = await as(FO, (db) => patientConsents(db, pt));
    const care = rows.find((r) => r.purpose === "care_notice")!;
    const mk = rows.find((r) => r.purpose === "marketing_wa")!;
    expect(await as(FO, (db) => withdrawConsent(db, key(), { consentId: care.id, channel: "in_person", reason: "Minta berhenti" }))).toMatchObject({ ok: false, code: "not_withdrawable" });
    expect(await code(as(FO, (db) => withdrawConsent(db, key(), { consentId: mk.id, channel: "in_person", reason: "x" })))).toBe("ERR_INVALID_INPUT");
    expect(await as(FO, (db) => withdrawConsent(db, key(), { consentId: mk.id, channel: "in_person", reason: "Berhenti promo" }))).toMatchObject({ ok: true });
    expect(await as(FO, (db) => withdrawConsent(db, key(), { consentId: mk.id, channel: "in_person", reason: "Lagi" }))).toMatchObject({ ok: false, code: "already_withdrawn" });
    // Directly on the table: no delete, no grant change, withdrawal once, never on care notice.
    await expect(h.admin.query(`delete from consents where id = $1`, [mk.id])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update consents set withdraw_reason = 'ganti' where id = $1`, [mk.id])).rejects.toThrow(/recorded once/);
    await expect(h.admin.query(`update consents set grant_channel = 'paper' where id = $1`, [care.id])).rejects.toThrow(/never changed/);
    await expect(h.admin.query(
      `update consents set withdrawn_at = now(), withdrawn_by = $2, withdrawn_as = 'fo_cashier', withdraw_channel = 'paper', withdraw_reason = 'langsung' where id = $1`,
      [care.id, FO.staffId],
    )).rejects.toThrow(/legal basis/);
    await expect(h.admin.query(
      `insert into consents (tenant_id, patient_id, purpose, consent_text_id, granted_by, granted_as, grant_channel, withdrawn_at, withdrawn_by, withdrawn_as, withdraw_channel, withdraw_reason)
       values ($1, $2, 'publication', $3, $4, 'fo_cashier', 'paper', now(), $4, 'fo_cashier', 'paper', 'langsung')`,
      [A.tenantId, pt, text.publication, FO.staffId],
    )).rejects.toThrow(/recorded granted/);
    await expect(h.admin.query(`truncate consents`)).rejects.toThrow();
  });

  it("withdrawal is accepted while the tenant is suspended; grants and publishing are not, and not in exit", async () => {
    const S = await tenant();
    const sOwn = await person(S, "owner");
    const sFo = await person(S, "fo_cashier");
    const t = (await as(sOwn, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Teks S" }))).id;
    const pt = await patient(S);
    await as(sFo, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: t, channel: "in_person" }));
    const id = (await as(sFo, (db) => patientConsents(db, pt)))[0].id;
    for (const state of ["suspended", "exit"]) {
      await h.admin.query(`update tenants_registry set lifecycle_state = $2 where id = $1`, [S.tenantId, state]);
      const p2 = await patient(S);
      if (state === "suspended") {
        expect(await as(sFo, (db) => grantConsent(db, key(), { patientId: p2, purpose: "marketing_wa", textId: t, channel: "in_person" }))).toMatchObject({ ok: true });
        expect(await as(sOwn, (db) => publishConsentText(db, { purpose: "publication", body: "Teks saat suspended" }))).toMatchObject({ version: 1 });
      } else {
        expect(await code(as(sFo, (db) => grantConsent(db, key(), { patientId: p2, purpose: "marketing_wa", textId: t, channel: "in_person" })))).toBe("ERR_TENANT_SUSPENDED");
        expect(await code(as(sOwn, (db) => publishConsentText(db, { purpose: "clinical_photo", body: "Teks saat exit" })))).toBe("ERR_TENANT_SUSPENDED");
        expect(await as(sFo, (db) => withdrawConsent(db, key(), { consentId: id, channel: "phone", reason: "Keluar dari klinik" }))).toMatchObject({ ok: true });
      }
    }
  });
});

describe("authority and readers", () => {
  it("publish: the Owner, or Admin Pusat with the data-protection duty; nobody else", async () => {
    expect(await code(as(AP, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Tanpa tugas" })))).toBe("ERR_FORBIDDEN");
    for (const p of [MGR, FO, CS, BC, DOC, RO, NUR, FIN, MK, PU, AU]) {
      expect(await code(as(p, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Coba" }))), p.role).toBe("ERR_FORBIDDEN");
    }
    // An ended duty no longer counts.
    const ap2 = await person(A, "admin_pusat");
    await h.admin.query(`insert into staff_duties (tenant_id, staff_id, duty, assigned_by, ended_at, ended_by) values ($1, $2, 'data_protection', $3, now(), $3)`, [A.tenantId, ap2.staffId, OWN.staffId]);
    expect(await code(as(ap2, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Tugas berakhir" })))).toBe("ERR_FORBIDDEN");
    // The it_admin duty is not the data-protection duty.
    const ap3 = await person(A, "admin_pusat");
    await h.admin.query(`insert into staff_duties (tenant_id, staff_id, duty, assigned_by) values ($1, $2, 'it_admin', $3)`, [A.tenantId, ap3.staffId, OWN.staffId]);
    expect(await code(as(ap3, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Tugas IT" })))).toBe("ERR_FORBIDDEN");
  });

  it("grant and withdraw: the six recorder roles only", async () => {
    const pt = await patient(A);
    for (const p of [FO, CS, BC, DOC, RO, MGR]) {
      const r = await as(p, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: text.marketing_wa, channel: "in_person" }));
      if (r.ok) await as(p, (db) => withdrawConsent(db, key(), { consentId: r.consentId, channel: "in_person", reason: `Uji ${p.role}` }));
      expect(r.ok, p.role).toBe(true);
    }
    const id = (await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: text.marketing_wa, channel: "in_person" })) as { consentId: string }).consentId;
    for (const p of [OWN, AP, APD, NUR, FIN, MK, PU, AU]) {
      expect(await code(as(p, (db) => grantConsent(db, key(), { patientId: pt, purpose: "publication", textId: text.publication, channel: "in_person" }))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => withdrawConsent(db, key(), { consentId: id, channel: "in_person", reason: "Bukan pencatat" }))), p.role).toBe("ERR_FORBIDDEN");
    }
  });

  it("readers: identity roles read the ledger; marketing sees only consented contacts; purchasing and auditor nothing", async () => {
    const yes = await patient(A, "Mira Setuju", "+6281211110001");
    const no = await patient(A, "Nina Tidak", "+6281211110002");
    const gone = await patient(A, "Ola Tarik", "+6281211110003");
    const g = await as(FO, (db) => grantConsent(db, key(), { patientId: gone, purpose: "marketing_wa", textId: text.marketing_wa, channel: "in_person" }));
    await as(FO, (db) => withdrawConsent(db, key(), { consentId: (g as { consentId: string }).consentId, channel: "phone", reason: "Berhenti promo" }));
    await as(FO, (db) => grantConsent(db, key(), { patientId: yes, purpose: "marketing_wa", textId: text.marketing_wa, channel: "in_person" }));
    await as(FO, (db) => grantConsent(db, key(), { patientId: no, purpose: "care_notice", textId: text.care_notice, channel: "in_person" }));
    for (const p of [OWN, AP, MGR, RO, FO, CS, BC, DOC, NUR, FIN]) {
      expect((await as(p, (db) => patientConsents(db, yes))).length, p.role).toBeGreaterThan(0);
      expect(Number((await as(p, (db) => db.query(`select count(*) from consents where patient_id = $1`, [yes]))).rows[0].count), p.role).toBeGreaterThan(0);
    }
    for (const p of [MK, PU, AU]) {
      expect(Number((await as(p, (db) => db.query(`select count(*) from consents`))).rows[0].count), p.role).toBe(0);
      expect(await code(as(p, (db) => patientConsents(db, yes))), p.role).toBe("ERR_FORBIDDEN");
    }
    const contacts = await as(MK, (db) => marketingContacts(db));
    expect(contacts.find((c) => c.patientId === yes)).toEqual({ patientId: yes, fullName: "Mira Setuju", phone: "+6281211110001" });
    expect(contacts.find((c) => c.patientId === no)).toBeUndefined();
    expect(contacts.find((c) => c.patientId === gone)).toBeUndefined();
    expect(Object.keys(contacts[0]).sort()).toEqual(["fullName", "patientId", "phone"]);
    expect(await as(MK, (db) => consentActive(db, yes, "marketing_wa"))).toBe(true);
    for (const p of [FO, OWN, PU, AU]) expect(await code(as(p, (db) => marketingContacts(db))), p.role).toBe("ERR_FORBIDDEN");
    for (const p of [PU, AU]) expect(await code(as(p, (db) => consentActive(db, yes, "marketing_wa"))), p.role).toBe("ERR_FORBIDDEN");
    // Unknown purpose or patient: false, never null.
    expect(await as(FO, (db) => consentActive(db, crypto.randomUUID(), "marketing_wa"))).toBe(false);
    expect(await as(FO, (db) => consentActive(db, yes, "nope" as never))).toBe(false);
    expect(await code(as(FO, (db) => patientConsents(db, crypto.randomUUID())))).toBe("ERR_NOT_FOUND");
    // A context with roles but no staff is not a service context.
    expect(await code(withTenantContext(app, { tenantId: A.tenantId, allowedBranchIds: "*", roles: ["owner"] }, (db) => consentActive(db, yes, "marketing_wa")))).toBe("ERR_FORBIDDEN");
  });
});

describe("idempotency, events, audit, vendor class, cross-tenant", () => {
  it("the same key replays the stored outcome; a different body with the same key conflicts", async () => {
    const pt = await patient(A);
    const k = key();
    const cur = (await as(FO, (d) => currentText(d, "publication")))!.id;
    const first = await as(FO, (db) => grantConsent(db, k, { patientId: pt, purpose: "publication", textId: cur, channel: "in_person" }));
    const again = await as(FO, (db) => grantConsent(db, k, { patientId: pt, purpose: "publication", textId: cur, channel: "in_person" }));
    expect(first.ok && again.ok && again.consentId === first.consentId && again.replayed).toBe(true);
    expect(await code(as(FO, (db) => grantConsent(db, k, { patientId: pt, purpose: "publication", textId: cur, channel: "paper" })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    // A refusal is replayed too.
    const k2 = key();
    const r1 = await as(FO, (db) => grantConsent(db, k2, { patientId: pt, purpose: "publication", textId: cur, channel: "phone" }));
    const r2 = await as(FO, (db) => grantConsent(db, k2, { patientId: pt, purpose: "publication", textId: cur, channel: "phone" }));
    expect(r1).toMatchObject({ ok: false, code: "already_granted", replayed: false });
    expect(r2).toMatchObject({ ok: false, code: "already_granted", replayed: true });
    // A raised error leaves no record even when the caller catches it and commits (impl review r1 P2):
    // the same key then works for a valid grant.
    const k3 = key();
    const p3 = await patient(A);
    expect(await as(FO, (db) => code(grantConsent(db, k3, { patientId: crypto.randomUUID(), purpose: "publication", textId: cur, channel: "phone" })))).toBe("ERR_NOT_FOUND");
    expect(await as(FO, (db) => code(grantConsent(db, k3, { patientId: p3, purpose: "publication", textId: cur, channel: "sms" as never })))).toBe("ERR_INVALID_INPUT");
    expect(Number((await h.admin.query(`select count(*) from idempotency_records where key = $1`, [k3])).rows[0].count)).toBe(0);
    expect(await as(FO, (db) => grantConsent(db, k3, { patientId: p3, purpose: "publication", textId: cur, channel: "phone" }))).toMatchObject({ ok: true, replayed: false });
  });

  it("events and audit carry ids and codes only: no reason, no text, no version", async () => {
    const pt = await patient(A);
    const r = await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: text.marketing_wa, channel: "in_person" }));
    const id = (r as { consentId: string }).consentId;
    await as(FO, (db) => withdrawConsent(db, key(), { consentId: id, channel: "phone", reason: "Alasan rahasia pasien" }));
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at`, [id])).rows;
    expect(ev.map((e) => [e.type, e.payload.change])).toEqual([["ConsentRecorded", "granted"], ["ConsentRecorded", "withdrawn"]]);
    expect(Object.keys(ev[1].payload).sort()).toEqual(["change", "consent_id", "consent_text_id", "patient_id", "purpose"]);
    const au = (await h.admin.query(`select reason_code, reason, object_kind from audit_events where object_id = $1 order by seq`, [id])).rows;
    expect(au).toEqual([{ reason_code: "consent_granted", reason: null, object_kind: "consent" }, { reason_code: "consent_withdrawn", reason: null, object_kind: "consent" }]);
    const all = JSON.stringify((await h.admin.query(`select payload from domain_events where tenant_id = $1`, [A.tenantId])).rows)
      + JSON.stringify((await h.admin.query(`select reason from audit_events where tenant_id = $1`, [A.tenantId])).rows);
    expect(all).not.toContain("Alasan rahasia");
    expect(all).not.toContain("versi 1");
    const t = (await h.admin.query(`select payload from domain_events where type = 'ConsentTextPublished' and tenant_id = $1 limit 1`, [A.tenantId])).rows[0];
    expect(Object.keys(t.payload).sort()).toEqual(["consent_text_id", "purpose"]);
  });

  it("both tables carry an always-enabled truncate guard (a cascade from either side is refused)", async () => {
    const r = (await h.admin.query(
      `select c.relname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relname in ('consents','consent_texts') and t.tgname like '%no_truncate'`,
    )).rows.sort((x, y) => (x.relname < y.relname ? -1 : 1));
    expect(r).toEqual([{ relname: "consent_texts", tgenabled: "A" }, { relname: "consents", tgenabled: "A" }]);
  });

  it("vendor classes: consents personal, texts config, one operator policy each", async () => {
    // Sorted in JS: "C" and the database collation disagree on consent_texts vs consents (T-035 lesson).
    const k = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name in ('public.consents','public.consent_texts')`)).rows
      .sort((x, y) => (x.table_name < y.table_name ? -1 : 1));
    expect(k).toEqual([{ table_name: "public.consent_texts", support_class: "config" }, { table_name: "public.consents", support_class: "personal" }]);
    const pol = (await h.admin.query(`select tablename, count(*)::int n from pg_policies where tablename in ('consents','consent_texts') and 'clinic_operator' = any(roles) group by 1`)).rows.sort((x, y) => (x.tablename < y.tablename ? -1 : 1));
    expect(pol).toEqual([{ tablename: "consent_texts", n: 1 }, { tablename: "consents", n: 1 }]);
  });

  it("tenant B neither reads nor changes A's consents, texts or patients", async () => {
    const pt = await patient(A, "Rahasia A");
    const id = ((await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: text.marketing_wa, channel: "in_person" }))) as { consentId: string }).consentId;
    expect(Number((await as(BFO, (db) => db.query(`select count(*) from consents where tenant_id = $1`, [A.tenantId]))).rows[0].count)).toBe(0);
    expect(Number((await as(BFO, (db) => db.query(`select count(*) from consent_texts where tenant_id = $1`, [A.tenantId]))).rows[0].count)).toBe(0);
    expect(await code(as(BFO, (db) => patientConsents(db, pt)))).toBe("ERR_NOT_FOUND");
    expect(await as(BFO, (db) => consentActive(db, pt, "marketing_wa"))).toBe(false);
    expect(await service(B, (db) => consentActive(db, pt, "marketing_wa"))).toBe(false);
    expect(await code(as(BFO, (db) => withdrawConsent(db, key(), { consentId: id, channel: "phone", reason: "Dari tenant lain" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: text.marketing_wa, channel: "phone" })))).toBe("ERR_NOT_FOUND");
    // With B's own text in force, A's patient is still not found (the patient lookup is tenant-bound).
    const bCare = (await as(BOWN, (db) => publishConsentText(db, { purpose: "care_notice", body: "Teks perawatan B" }))).id;
    expect(await code(as(BFO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "care_notice", textId: bCare, channel: "phone" })))).toBe("ERR_NOT_FOUND");
    const bmk = await person(B, "marketing");
    expect((await as(bmk, (db) => marketingContacts(db))).find((c) => c.patientId === pt)).toBeUndefined();
    expect(await service(A, (db) => consentActive(db, pt, "marketing_wa"))).toBe(true);
  });
});
