// T-082 Done-when: scenarios PR-93 — sharing disabled by default (no beneficiary can be added; the action is not offered), and two
// beneficiaries reserving the last paid session at the same time (exactly one succeeds). Plus the plan and its reviews: the owner-only
// switch (versioned, snapshot at the sale instant), beneficiaries (canonical patients, merges, removal while reserved), the treated
// patient recorded and frozen, redemption by a beneficiary with the owner keeping the balance, the beneficiary's projection without the
// owner's billing data, the auditor masked, the package row lock, tenants and replay. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { cancelPackage, patientPackages, releaseSession, reserveSession, setPackageContents } from "../../src/modules/packages/packages";
import { addBeneficiary, packageSharing, removeBeneficiary, setPackageSharing } from "../../src/modules/packages/sharing/sharing";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const STEP: StepUp = { verified: true };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Berbagi Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("BG1"), b2: await br("BG2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`bgi${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Berbagi ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function patient(t: T, branch: string, name = "Pasien Berbagi"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
async function credential(t: T, p: P, branch: string) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, b, b ? "2099-12-31" : null, OWN.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, FH.staffId]);
  }
}

let A: T; let B: T;
let OWN: P; let AP: P; let FIN: P; let AU: P; let FH: P; let DOC: P; let FO: P; let FO2: P; let MGR: P; let RO: P; let BOWN: P;
let facial: string; let facialV: string;

async function packageItem(c: string, price: number, count: number) {
  const v = await as(OWN, (db) => publish(db, { kind: "package", code: c }, { name: `Paket ${c}`, tax_category: "exempt_medical", tax_basis: "Jasa medis",
    normal_price: price, installments_allowed: true } as never, "Paket baru"));
  await as(OWN, (db) => setPackageContents(db, key(), v.versionId, [{ serviceItemId: facial, count }]));
  return v.itemId;
}
async function sell(pid: string, item: string, pay?: number) {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
  if (pay) await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: pay, cashTendered: pay }]));
  return (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string;
}
// An open visit of the patient at branch 1 with a signed exam, a plan of one facial and the consent (one open visit per patient).
async function visitFor(pid: string) {
  await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by, payment = case when payment in ('in_progress','blocked') then 'done' else payment end,
                         dispensing = case when dispensing in ('in_progress','blocked') then 'done' else dispensing end,
                         treatment = case when treatment in ('in_progress','blocked') then 'done' else treatment end
                       where tenant_id = $1 and patient_id = $2 and closed_at is null`, [A.tenantId, pid]);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Berbagi", "Kondisi rahasia"));
  const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: facialV, qty: 1 }));
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  const t = await as(DOC, (db) => consentText(db, v, planId));
  await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
  return { v, item: itemId };
}
const share = (item: string, on = true) => as(OWN, (db) => setPackageSharing(db, key(), item, on, on ? "Paket keluarga" : "Tidak lagi dibagi"));
const add = (pkg: string, pid: string, by = FO) => as(by, (db) => addBeneficiary(db, key(), pkg, pid, "Anak pemilik paket"));
const session = async (id: string) => (await h.admin.query(`select * from package_sessions where id = $1`, [id])).rows[0];
const balance = async (pid: string) =>
  Number((await h.admin.query(`select coalesce((select balance from balance_accounts where patient_id = $1), 0) b`, [pid])).rows[0].b);

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); FIN = await person(A, "finance"); AU = await person(A, "auditor");
  FH = await person(A, "facility_head", A.b1); DOC = await person(A, "doctor", A.b1); FO = await person(A, "fo_cashier", A.b1);
  FO2 = await person(A, "fo_cashier", A.b1); MGR = await person(A, "manager", A.b1); RO = await person(A, "records_officer", A.b1);
  BOWN = await person(B, "owner");
  await credential(A, DOC, A.b1);
  const v = await as(OWN, (db) => publish(db, { kind: "service", code: "BG-FAC" }, {
    name: "Facial Berbagi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 500_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
    indications: "Indikasi", consent_template: "Templat facial berbagi.", delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan baru"));
  if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
  facial = v.itemId; facialV = v.versionId;
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-93 sharing disabled by default", () => {
  it("a template without sharing: the sold package is not shared, the action is not offered, adding a beneficiary is refused, nothing written", async () => {
    const item = await packageItem("BG-OFF", 1_000_000, 2);
    expect((await as(AP, (db) => packageSharing(db, item))).enabled).toBe(false);
    const ownerPid = await patient(A, A.b1, "Pemilik Paket");
    const pkg = await sell(ownerPid, item, 1_000_000);
    expect((await h.admin.query(`select sharing_allowed from packages where id = $1`, [pkg])).rows[0].sharing_allowed).toBe(false);
    const row = (await as(FO, (db) => patientPackages(db, ownerPid))).packages[0];
    expect([row.sharing_allowed, row.can_share, row.beneficiaries]).toEqual([false, false, []]);
    const child = await patient(A, A.b1, "Anak");
    expect(await why(add(pkg, child))).toBe("ERR_VERSION_CONFLICT:sharing_disabled");
    expect((await h.admin.query(`select count(*)::int c from package_beneficiaries where package_id = $1`, [pkg])).rows[0].c).toBe(0);
    // a non-beneficiary still cannot reserve the owner's package on their own visit
    const w = await visitFor(child);
    expect(await why(as(FO, (db) => reserveSession(db, key(), pkg, w.v)))).toBe("ERR_NOT_FOUND:package not found");
  });
});

describe("scenario PR-93 beneficiaries cannot exceed paid value", () => {
  it("one paid session left and two beneficiaries reserving it at the same time: exactly one reservation succeeds (5 rounds)", async () => {
    const item = await packageItem("BG-CON", 1_000_000, 2);
    await share(item);
    for (let round = 0; round < 5; round++) {
      const ownerPid = await patient(A, A.b1, `Pemilik ${round}`);
      const pkg = await sell(ownerPid, item, 500_000); // one session (500,000) paid
      const [c1, c2] = [await patient(A, A.b1, `Anak A ${round}`), await patient(A, A.b1, `Anak B ${round}`)];
      await add(pkg, c1); await add(pkg, c2);
      const [w1, w2] = [await visitFor(c1), await visitFor(c2)];
      const out = await Promise.all([why(as(FO, (db) => reserveSession(db, key(), pkg, w1.v))), why(as(FO2, (db) => reserveSession(db, key(), pkg, w2.v)))]);
      expect(out.filter((x) => x === "ok"), `round ${round}`).toHaveLength(1);
      expect(out.filter((x) => x.startsWith("ERR_SESSION_NOT_UNLOCKED")), `round ${round}`).toHaveLength(1);
      expect((await h.admin.query(`select count(*)::int c from package_sessions where package_id = $1 and state = 'reserved'`, [pkg])).rows[0].c).toBe(1);
    }
  });

  it("the package row lock decides it: a held package row blocks reserve, add and remove (no staff_access involved)", async () => {
    const item = await packageItem("BG-LCK", 1_000_000, 2);
    await share(item);
    const ownerPid = await patient(A, A.b1, "Pemilik Kunci");
    const pkg = await sell(ownerPid, item, 1_000_000);
    const child = await patient(A, A.b1, "Anak Kunci");
    const { beneficiaryId } = await add(pkg, child);
    const w = await visitFor(child);
    const other = await patient(A, A.b1, "Anak Lain");
    const holder = await owner.connect();
    try {
      const holderPid = (await holder.query(`select pg_backend_pid() p`)).rows[0].p as number;
      for (const [label, op] of [
        ["reserve", () => as(FO, (db) => reserveSession(db, key(), pkg, w.v))],
        ["add", () => add(pkg, other)],
        ["remove", () => as(FO, (db) => removeBeneficiary(db, key(), beneficiaryId, "Tidak lagi"))],
      ] as const) {
        await holder.query("begin");
        await holder.query(`select 1 from packages where id = $1 for update`, [pkg]);
        let done = false;
        const p = (op as () => Promise<unknown>)().then(() => (done = true), () => (done = true));
        await new Promise((r) => setTimeout(r, 400));
        // a row lock wait shows as the holder's transaction id being awaited by a session blocked by the holder's pid
        const waiting = (await h.admin.query(`select count(*)::int c from pg_stat_activity a
                                               where a.wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(a.pid))`, [holderPid])).rows[0].c;
        expect([label, done, waiting > 0]).toEqual([label, false, true]);
        await holder.query("rollback");
        await p;
        if (label === "reserve") {
          const sid = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'reserved'`, [pkg])).rows[0].id as string;
          await as(FO, (db) => releaseSession(db, key(), sid));
        }
      }
    } finally {
      holder.release();
    }
  });
});

describe("the switch, the snapshot, beneficiaries, redemption", () => {
  it("owner only; versioned; the same value is a no-op; enabling after a sale does not share it; disabling after a sale keeps it shared", async () => {
    const item = await packageItem("BG-SNP", 1_000_000, 2);
    for (const p of [AP, MGR, FO, FIN]) expect(await why(as(p, (db) => setPackageSharing(db, key(), item, true, "Coba bagi"))), p.role).toMatch(/^ERR_FORBIDDEN/);
    const before = await sell(await patient(A, A.b1), item);
    expect((await share(item)).changed).toBe(true);
    expect((await share(item)).changed).toBe(false);
    const shared = await sell(await patient(A, A.b1), item);
    await share(item, false);
    const after = await sell(await patient(A, A.b1), item);
    const flags = (await h.admin.query(`select id, sharing_allowed from packages where id = any($1)`, [[before, shared, after]])).rows;
    const f = Object.fromEntries(flags.map((r) => [r.id, r.sharing_allowed]));
    expect([f[before], f[shared], f[after]]).toEqual([false, true, false]);
    const st = await as(AP, (db) => packageSharing(db, item));
    expect([st.enabled, st.can_change, st.history.map((x) => [x.version, x.enabled])]).toEqual([false, false, [[2, false], [1, true]]]);
    expect(await raw(`update packages set sharing_allowed = false where id = $1`, [shared])).toBe("raw:42501");
    expect(await raw(`update package_sharing set enabled = true where item_id = $1`, [item])).toBe("raw:42501");
  });

  it("a package opened later at a manual-discount decision (T-080) takes the switch as of the issue instant, not the decision", async () => {
    const item = await packageItem("BG-DEF", 1_000_000, 2);
    const ownerPid = await patient(A, A.b1, "Pemilik Tunda");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: ownerPid }));
    // the default SET-12 (FO 0 %) sends any FO discount to approval: the package opens at the decision
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1, discount: 100_000 }]));
    expect((await h.admin.query(`select count(*)::int c from packages where invoice_id = $1`, [invoiceId])).rows[0].c).toBe(0);
    await share(item); // switched on after the issue
    const ap = (await h.admin.query(`select discount_approval_id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].discount_approval_id as string;
    await as(OWN, (db) => decideApproval(db, ap, true));
    const pk = (await h.admin.query(`select sharing_allowed, price::bigint p from packages where invoice_id = $1`, [invoiceId])).rows[0];
    expect([pk.sharing_allowed, Number(pk.p)]).toEqual([false, 900_000]);
  });

  it("a beneficiary redeems a session on their own visit (recorded as the treated patient); cancel moves the paid-unused value to the owner's balance", async () => {
    const item = await packageItem("BG-RED", 1_000_000, 2);
    await share(item);
    const ownerPid = await patient(A, A.b1, "Pemilik Tebus");
    const pkg = await sell(ownerPid, item, 1_000_000);
    const child = await patient(A, A.b1, "Anak Tebus");
    await add(pkg, child);
    const w = await visitFor(child);
    const { sessionId } = await as(FO, (db) => reserveSession(db, key(), pkg, w.v));
    expect((await session(sessionId)).beneficiary_patient_id).toBe(child);
    // while reserved, neither the visit nor the treated patient may change
    expect(await raw(`update package_sessions set beneficiary_patient_id = $2, version = version + 1 where id = $1`, [sessionId, ownerPid])).toBe("raw:42501");
    // a direct reservation of another session on a non-beneficiary's visit is refused by the session guard (plan §8)
    const stranger = await patient(A, A.b1, "Bukan Penerima");
    const ws = await visitFor(stranger);
    const free = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'available' order by seq limit 1`, [pkg])).rows[0].id as string;
    expect(await raw(`update package_sessions set state = 'reserved', reserved_visit_id = $2, beneficiary_patient_id = $3, version = version + 1 where id = $1`,
      [free, ws.v, stranger])).toBe("raw:42501");
    const e = await as(DOC, (db) => startTreatment(db, key(), w.v, { planItemId: w.item, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    const s = await session(sessionId);
    expect([s.state, s.beneficiary_patient_id]).toEqual(["redeemed", child]);
    const ownerView = (await as(FO, (db) => patientPackages(db, ownerPid))).packages[0];
    expect(ownerView.sessions.find((x) => x.id === sessionId)?.patient?.id).toBe(child);
    expect(ownerView.beneficiaries.map((b) => b.patient.id)).toEqual([child]);
    await as(OWN, (db) => cancelPackage(db, key(), pkg, "Keluarga membatalkan"));
    expect([await balance(ownerPid), await balance(child)]).toEqual([500_000, 0]);
  });

  it("the beneficiary's view: shared_packages without billing fields or other beneficiaries; the auditor sees names masked", async () => {
    const item = await packageItem("BG-VIEW", 1_000_000, 2);
    await share(item);
    const ownerPid = await patient(A, A.b1, "Pemilik Lihat");
    const pkg = await sell(ownerPid, item, 500_000);
    const [c1, c2] = [await patient(A, A.b1, "Anak Satu"), await patient(A, A.b1, "Anak Dua")];
    await add(pkg, c1); await add(pkg, c2);
    const v1 = await as(FO, (db) => patientPackages(db, c1));
    expect(v1.packages).toEqual([]);
    expect(v1.shared_packages).toHaveLength(1);
    const sp = v1.shared_packages[0] as Record<string, unknown>;
    expect(sp.shared_from).toMatchObject({ id: ownerPid, name: "Pemilik Lihat" });
    for (const k of ["invoice_id", "invoice_number", "outstanding", "price", "paid", "min_dp", "beneficiaries"]) expect(sp, k).not.toHaveProperty(k);
    expect([sp.can_cancel, sp.can_share]).toEqual([false, false]);
    const auditor = await as(AU, (db) => patientPackages(db, ownerPid));
    expect(auditor.packages[0].beneficiaries.every((b) => b.patient.name === null)).toBe(true);
  });

  it("beneficiaries: owner's cluster refused; replay and the survivor of a merged duplicate return the active row; removal refused while reserved", async () => {
    const item = await packageItem("BG-BEN", 1_000_000, 2);
    await share(item);
    const ownerPid = await patient(A, A.b1, "Pemilik Ben");
    const pkg = await sell(ownerPid, item, 1_000_000);
    expect(await why(add(pkg, ownerPid))).toBe("ERR_INVALID_INPUT:beneficiary_owner");
    const dup = await patient(A, A.b1, "Anak Ganda");
    const surv = await patient(A, A.b1, "Anak Utama");
    const { beneficiaryId } = await add(pkg, dup);
    await as(RO, (db) => mergePatients(db, key(), surv, dup, "Data ganda: anak yang sama"));
    expect((await add(pkg, surv)).beneficiaryId).toBe(beneficiaryId);
    const w = await visitFor(surv);
    const { sessionId } = await as(FO, (db) => reserveSession(db, key(), pkg, w.v));
    expect(await why(as(FO, (db) => removeBeneficiary(db, key(), beneficiaryId, "Tidak lagi")))).toBe("ERR_VERSION_CONFLICT:beneficiary_reserved");
    await as(FO, (db) => releaseSession(db, key(), sessionId));
    await as(FO, (db) => removeBeneficiary(db, key(), beneficiaryId, "Tidak lagi"));
    const w2 = await visitFor(surv);
    expect(await why(as(FO, (db) => reserveSession(db, key(), pkg, w2.v)))).toBe("ERR_NOT_FOUND:package not found");
    expect(await raw(`delete from package_beneficiaries where id = $1`, [beneficiaryId])).toBe("raw:42501");
    // a merged-into-owner beneficiary: the owner's cluster, so not a beneficiary any more
    const c3 = await patient(A, A.b1, "Anak Tiga");
    await add(pkg, c3);
    await as(RO, (db) => mergePatients(db, key(), ownerPid, c3, "Data ganda: pemilik"));
    const merged = await as(FO, (db) => patientPackages(db, ownerPid));
    expect(merged.packages[0].beneficiaries).toEqual([]);
    expect(merged.shared_packages).toEqual([]); // the owner's own package is never "shared with" the owner
  });

  it("roles and tenants: doctor and auditor cannot add; tenant B cannot read or add; the switch reader needs a package template", async () => {
    const item = await packageItem("BG-ROL", 1_000_000, 2);
    await share(item);
    const pkg = await sell(await patient(A, A.b1), item, 1_000_000);
    const child = await patient(A, A.b1, "Anak Peran");
    for (const p of [DOC, AU, FIN]) expect(await why(add(pkg, child, p)), p.role).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(add(pkg, child, BOWN))).toMatch(/^ERR_(NOT_FOUND|FORBIDDEN)/);
    expect(await why(as(BOWN, (db) => packageSharing(db, item)))).toBe("ERR_NOT_FOUND:package template not found");
    expect((await as(BOWN, (db) => db.query(`select count(*)::int c from package_beneficiaries`))).rows[0].c).toBe(0);
    expect(await why(as(OWN, (db) => packageSharing(db, facial)))).toBe("ERR_NOT_FOUND:package template not found");
  });
});
