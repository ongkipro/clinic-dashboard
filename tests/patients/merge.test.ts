// T-042 Done-when: merge then unmerge restores both patients with all linked rows; the audit shows actor and
// reason. Plus the plan review: the readers resolve the duplicate to the survivor while merged (profile,
// guardians, consents, search, registration matches, the walk-in search, Hari Ini, Antrean, marketing) and
// separate them again after the unmerge; the writers refuse the duplicate and check overlaps over the
// cluster; no chains or cycles (also under concurrency); authority (records officer), lifecycle, the
// guard, ids-only events, tenancy.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { setServices, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { consentActive, grantConsent, marketingContacts, patientConsents, publishConsentText } from "../../src/modules/patients/consents/consents";
import { canonicalPatient, mergePatients, mergesOf, unmergePatients } from "../../src/modules/patients/merge/merge";
import { findMatches, getPatient } from "../../src/modules/patients/patients";
import { searchPatients } from "../../src/modules/patients/search/search";
import { book } from "../../src/modules/scheduling/booking/booking";
import { walkIn } from "../../src/modules/visits/queue/queue";
import { checkIn, today } from "../../src/modules/visits/visits";
import { createHarness, type Harness } from "../rls/harness";

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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Gabung Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`mrg${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Gabung ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();


let A: T;
let B: T;
let OWN: P; let FH: P; let RO: P; let RO2: P; let FO: P; let CS: P; let MGR: P; let MK: P; let BRO: P;
let consult: { itemId: string; versionId: string };
let waText: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 3 });
  owner.on("error", () => {});
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); RO = await person(A, "records_officer", A.b1); RO2 = await person(A, "records_officer", A.b2);
  FO = await person(A, "fo_cashier", A.b1); CS = await person(A, "central_cs"); MGR = await person(A, "manager", A.b1); MK = await person(A, "marketing");
  BRO = await person(B, "records_officer", B.b1);
  await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Konsul Gabung", kind: "consultation" }));
  const v = await as(OWN, (db) => publish(db, { kind: "service", code: "KONSUL" }, {
    name: "Konsultasi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 150_000, category: "consultation",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "I", contraindications: "K", consent_template: "T", delegation: "Dokter",
    aftercare_text: "A", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }],
  } as never, "Layanan baru"));
  if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
  await as(OWN, (db) => setServices(db, A.b1, [v.itemId]));
  consult = { itemId: v.itemId, versionId: v.versionId };
  waText = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Teks promo WA" }))).id;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

const slotNow = () => new Date(Math.floor(Date.now() / 900_000) * 900_000);
async function phoned(t: T, name: string, phone: string, branch = t.b1) {
  const id = (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, branch],
  )).rows[0].id as string;
  await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, id, phone]);
  return id;
}
async function apptAt(pt: string, start = slotNow()) {
  const d = await person(A, "doctor", A.b1);
  await h.admin.query(`alter table appointments disable trigger appointments_guard`);
  try {
    return (await h.admin.query(
      `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
       values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
      [A.tenantId, A.b1, pt, consult.versionId, d.staffId, start, new Date(start.getTime() + 30 * 60_000)],
    )).rows[0].id as string;
  } finally {
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
  }
}
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const pageIds = async (p: P, q: string) => {
  const r = await as(p, (db) => searchPatients(db, q));
  if (!r.ok) throw new CommandError("ERR_RATE_LIMITED");
  return r.rows.map((x) => x.id);
};
// Everything a patient shows through the readers: profile, consents, search hits, today's board rows.
async function seen(pt: string) {
  const profile = await as(FO, (db) => getPatient(db, pt));
  const consents = (await as(FO, (db) => patientConsents(db, pt))).map((c) => c.id).sort();
  // The database marks a redirect (merged_into); the profile module returns the survivor's id.
  const raw = (await as(FO, (db) => db.query(`select patient_get($1) as r`, [pt]))).rows[0].r as { merged_into?: string | null } | null;
  return { id: profile?.id, mergedInto: raw?.merged_into ?? null, guardians: profile?.guardians.map((g) => g.name).sort(), consents };
}

describe("Done-when: merge then unmerge restores both patients with all linked rows; the audit shows actor and reason", () => {
  it("while merged the duplicate resolves to the survivor everywhere; after the unmerge both are exactly as before", async () => {
    const surv = await phoned(A, "Siti Asli Gabung", "+6281211110001");
    const dup = await phoned(A, "Siti Ganda Gabung", "+6281211110002");
    const dupMrn = (await h.admin.query(`select mrn from patients where id = $1`, [dup])).rows[0].mrn as string;
    await h.admin.query(`insert into guardians (tenant_id, patient_id, guardian_name, relation) values ($1, $2, 'Wali Asli', 'ibu'), ($1, $3, 'Wali Ganda', 'ayah')`, [A.tenantId, surv, dup]);
    const cDup = await as(FO, (db) => grantConsent(db, key(), { patientId: dup, purpose: "marketing_wa", textId: waText, channel: "whatsapp" }));
    if (!cDup.ok) throw new Error("grant");
    const apDup = await apptAt(dup);
    const visit = (await as(FO, (db) => checkIn(db, key(), apDup))).visitId;
    const before = { surv: await seen(surv), dup: await seen(dup), rows: await rowsOf([surv, dup]) };

    const { mergeId } = await as(RO, (db) => mergePatients(db, key(), surv, dup, "Data ganda: nama dan HP berbeda satu digit"));
    // Profile of either id is the survivor, with the duplicate's guardians and consents.
    const viaDup = await as(FO, (db) => getPatient(db, dup));
    expect(viaDup?.id).toBe(surv);
    expect((await seen(dup)).mergedInto).toBe(surv);
    expect(viaDup?.guardians.map((g) => g.name).sort()).toEqual(["Wali Asli", "Wali Ganda"]);
    expect((await as(FO, (db) => patientConsents(db, surv))).map((c) => c.id)).toEqual([cDup.consentId]);
    expect(await as(FO, (db) => consentActive(db, surv, "marketing_wa"))).toBe(true);
    // Search hides the duplicate and finds the survivor by the duplicate's name, MRN and phone.
    expect(await pageIds(FO, "Gabung")).toEqual([surv]);
    expect(await pageIds(FO, dupMrn)).toEqual([surv]);
    expect(await pageIds(FO, "11110002")).toEqual([surv]);
    expect((await as(FO, (db) => findMatches(db, { phone: "081211110002" }))).map((m) => m.id)).toEqual([surv]);
    // Hari Ini shows the duplicate's visit under the survivor; marketing sees one contact.
    expect((await as(FO, (db) => today(db, A.b1))).visits.find((x) => x.id === visit)?.patientId).toBe(surv);
    expect((await as(MK, (db) => marketingContacts(db))).filter((c) => c.fullName.includes("Gabung")).map((c) => c.patientId)).toEqual([surv]);
    expect(await as(FO, (db) => canonicalPatient(db, dup))).toBe(surv);
    // No linked row moved.
    expect(await rowsOf([surv, dup])).toEqual(before.rows);

    await as(RO2, (db) => unmergePatients(db, key(), mergeId, "Ternyata dua orang berbeda (kembar)"));
    expect({ surv: await seen(surv), dup: await seen(dup), rows: await rowsOf([surv, dup]) }).toEqual(before);
    expect((await pageIds(FO, "Gabung")).sort()).toEqual([surv, dup].sort());

    // The audit shows actor (staff, role, branch) and the reason codes; the reasons are on the merge row.
    const au = (await h.admin.query(
      `select e.object_id, e.staff_id, e.acting_role, e.branch_id, e.reason_code, e.reason, m.reason as merge_reason, m.undo_reason
         from audit_events e join patient_merges m on m.id = e.correlation_id where m.id = $1 order by e.seq`, [mergeId])).rows;
    expect(au.map((r) => [r.object_id, r.reason_code, r.staff_id, r.acting_role])).toEqual([
      [surv, "patient_merged", RO.staffId, "records_officer"], [dup, "patient_merged", RO.staffId, "records_officer"],
      [surv, "patient_unmerged", RO2.staffId, "records_officer"], [dup, "patient_unmerged", RO2.staffId, "records_officer"],
    ]);
    expect(au[0]).toMatchObject({ branch_id: A.b1, reason: null, merge_reason: "Data ganda: nama dan HP berbeda satu digit" });
    expect(au[2]).toMatchObject({ branch_id: A.b2, undo_reason: "Ternyata dua orang berbeda (kembar)" });
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at`, [mergeId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["PatientMerged", "PatientUnmerged"]);
    for (const e of ev) expect(Object.keys(e.payload).sort()).toEqual(["merge_id", "merged_id", "survivor_id"]);
    expect((await as(FO, (db) => mergesOf(db, dup))).map((m) => m.id)).toEqual([mergeId]);
  });
});

// The raw rows of the patients (to prove nothing moved): contact points, guardians, consents, appointments, visits.
async function rowsOf(ids: string[]) {
  const q = async (t: string, col = "patient_id") => (await h.admin.query(`select id, ${col} as p from ${t} where ${col} = any($1) order by id`, [ids])).rows;
  return { contacts: await q("contact_points"), guardians: await q("guardians"), consents: await q("consents"), appointments: await q("appointments"), visits: await q("visits") };
}

describe("writers while merged", () => {
  it("the duplicate is refused by consent, booking and walk-in; overlaps are checked over the cluster", async () => {
    const surv = await phoned(A, "Budi Tulis Asli", "+6281222220001");
    const dup = await phoned(A, "Budi Tulis Ganda", "+6281222220002");
    const cs = await as(FO, (db) => grantConsent(db, key(), { patientId: surv, purpose: "marketing_wa", textId: waText, channel: "whatsapp" }));
    if (!cs.ok) throw new Error("grant");
    const apSurv = await apptAt(surv);
    await as(FO, (db) => checkIn(db, key(), apSurv)); // the survivor has an open visit at B1
    const apDup = await apptAt(dup);
    await as(RO, (db) => mergePatients(db, key(), surv, dup, "Data ganda: pasien sama"));
    expect(await reason(as(FO, (db) => grantConsent(db, key(), { patientId: dup, purpose: "marketing_wa", textId: waText, channel: "whatsapp" })))).toBe("ERR_NOT_FOUND:patient not found");
    expect(await reason(as(FO, (db) => walkIn(db, key(), dup, null)))).toBe("ERR_NOT_FOUND:patient not found");
    // The duplicate's own booked appointment cannot open a second visit for the same person.
    expect(await reason(as(FO, (db) => checkIn(db, key(), apDup)))).toBe("ERR_VERSION_CONFLICT:already_open");
    // A consent of the survivor's cluster already exists (here the survivor's own).
    expect(await as(FO, (db) => grantConsent(db, key(), { patientId: surv, purpose: "marketing_wa", textId: waText, channel: "whatsapp" }))).toMatchObject({ ok: false, code: "already_granted" });
    // And when only the duplicate had granted it: the survivor cannot grant it a second time either.
    const s2 = await phoned(A, "Dewi Tulis Asli", "+6281222220003");
    const d2 = await phoned(A, "Dewi Tulis Ganda", "+6281222220004");
    const g2 = await as(FO, (db) => grantConsent(db, key(), { patientId: d2, purpose: "marketing_wa", textId: waText, channel: "whatsapp" }));
    if (!g2.ok) throw new Error("grant");
    await as(RO, (db) => mergePatients(db, key(), s2, d2, "Data ganda: pasien sama"));
    expect(await as(FO, (db) => grantConsent(db, key(), { patientId: s2, purpose: "marketing_wa", textId: waText, channel: "whatsapp" }))).toMatchObject({ ok: false, code: "already_granted" });
    // Booking the duplicate is refused; booking the survivor overlapping the duplicate's appointment is refused.
    const tomorrow = new Date(slotNow().getTime() + 26 * 3_600_000);
    expect(await code(as(CS, (db) => book(db, key(), { branchId: A.b1, patientId: dup, versionId: consult.versionId, startsAt: tomorrow, channel: "phone" } as never)))).toBe("ERR_NOT_FOUND");
  });
});

describe("chains, authority and tenancy", () => {
  it("no chains or cycles (also concurrently); only the records officer; reasons; undo once; another tenant", async () => {
    const [a, b, c] = [await phoned(A, "Rantai A", "+6281233330001"), await phoned(A, "Rantai B", "+6281233330002"), await phoned(A, "Rantai C", "+6281233330003")];
    for (const p of [OWN, FO, MGR, FH]) expect(await code(as(p, (db) => mergePatients(db, key(), a, b, "Alasan cukup panjang"))), p.role).toBe("ERR_FORBIDDEN");
    expect(await reason(as(RO, (db) => mergePatients(db, key(), a, a, "Alasan cukup panjang")))).toBe("ERR_INVALID_INPUT:merge");
    expect(await reason(as(RO, (db) => mergePatients(db, key(), a, b, "pendek")))).toBe("ERR_INVALID_INPUT:merge");
    // Concurrent A←B and B←C (a chain): exactly one wins.
    const r = await Promise.all([reason(as(RO, (db) => mergePatients(db, key(), a, b, "Alasan cukup panjang"))), reason(as(RO2, (db) => mergePatients(db, key(), b, c, "Alasan cukup panjang")))]);
    expect(r.filter((x) => x === "ok").length).toBe(1);
    expect(r.filter((x) => x === "ERR_VERSION_CONFLICT:already_merged").length).toBe(1);
    const active = (await h.admin.query(`select survivor_id, merged_id from patient_merges where tenant_id = $1 and undone_at is null and survivor_id = any($2)`, [A.tenantId, [a, b, c]])).rows;
    expect(active.length).toBe(1);
    // A cycle is refused, and so is merging the merged one again.
    const { survivor_id: s1, merged_id: m1 } = active[0];
    expect(await reason(as(RO, (db) => mergePatients(db, key(), m1, s1, "Alasan cukup panjang")))).toBe("ERR_VERSION_CONFLICT:already_merged");
    expect(await reason(as(RO, (db) => mergePatients(db, key(), c === m1 ? a : c, m1, "Alasan cukup panjang")))).toBe("ERR_VERSION_CONFLICT:already_merged");
    // The guard refuses a chain even without the writer.
    const err = (q: Promise<unknown>) => q.then(() => "ok", (e) => e.message as string);
    expect(await err(h.admin.query(`insert into patient_merges (tenant_id, survivor_id, merged_id, reason, merged_by, merged_as) values ($1, $2, $3, 'Alasan cukup panjang', $4, 'records_officer')`,
      [A.tenantId, m1, (await phoned(A, "Rantai D", "+6281233330004")), RO.staffId]))).toMatch(/never chains/);
    const mg = (await h.admin.query(`select id from patient_merges where merged_id = $1 and undone_at is null`, [m1])).rows[0].id as string;
    await as(RO, (db) => unmergePatients(db, key(), mg, "Dibatalkan untuk uji"));
    expect(await reason(as(RO, (db) => unmergePatients(db, key(), mg, "Dibatalkan untuk uji")))).toBe("ERR_VERSION_CONFLICT:already_undone");
    expect(await err(h.admin.query(`delete from patient_merges where id = $1`, [mg]))).toMatch(/never deleted/);
    expect(await err(h.admin.query(`update patient_merges set reason = 'Alasan baru yang panjang' where id = $1`, [mg]))).toMatch(/undone once/);
    expect(await code(as(BRO, (db) => mergePatients(db, key(), a, b, "Alasan cukup panjang")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BRO, (db) => unmergePatients(db, key(), mg, "Alasan cukup panjang")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => db.query(`insert into patient_merges (tenant_id, survivor_id, merged_id, reason, merged_by, merged_as) values ($1, $2, $3, 'x', $4, 'records_officer')`, [A.tenantId, a, b, FO.staffId])))).toBe("raw:42501");
  });

  it("a suspended tenant still corrects records; an exiting one does not", async () => {
    const t = await tenant();
    const ro = await person(t, "records_officer");
    const x = await phoned(t, "Pasien Lifecycle Satu", "+6281244440001");
    const y = await phoned(t, "Pasien Lifecycle Dua", "+6281244440002");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [t.tenantId]);
    expect(await reason(as(ro, (db) => mergePatients(db, key(), x, y, "Alasan cukup panjang")))).toBe("ok");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [t.tenantId]);
    const m = (await h.admin.query(`select id from patient_merges where merged_id = $1`, [y])).rows[0].id as string;
    expect(await code(as(ro, (db) => unmergePatients(db, key(), m, "Alasan cukup panjang")))).toBe("ERR_TENANT_SUSPENDED");
  });
});
