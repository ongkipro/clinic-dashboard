// T-097 Done-when: Scenario PR-94 frequency cap (02-PRD:875): a patient already received two automated messages today → a third scenario
// triggers → it is queued for the next day; concurrent workers respect the cap. Plus the plan (r1, review r2): each SET-19 scenario's
// trigger, idempotency per (scenario, source, offset), the quiet window, the 7-day horizon, consent for the promo scenarios, a scenario off,
// marketing's drafts (propose, another person decides through setting_set, reject, cancel, one pending), the log's role and consent
// projection, guards, the unbound scan, tenants. The Meta port is never called (the queue only; DEC-082). Synthetic data (MIG-2); clocks are
// fixed WIB instants passed to the scan.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import type { KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { publish } from "../../src/modules/catalog/catalog";
import { saveItem } from "../../src/modules/inventory/stock";
import { issueKasirInvoice, openKasirInvoice } from "../../src/modules/cashier/kasir/kasir";
import { automationDraft, automationLog, cancelScenarioDraft, decideScenarioDraft, proposeScenarioDraft, runAutomationScan } from "../../src/modules/crm/automation/automation";
import { RECORDED_TEMPLATES } from "../../src/modules/messaging/inbox/fixtures";
import { syncTemplates } from "../../src/modules/messaging/inbox/inbox";
import { mockInboxPort } from "../../src/modules/messaging/inbox/mock";
import type { RemoteTemplate } from "../../src/modules/messaging/inbox/port";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { grantConsent, publishConsentText } from "../../src/modules/patients/consents/consents";
import { changeSetting, settingValue } from "../../src/modules/settings/settings";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 3)]]) };
const TEMPLATES: RemoteTemplate[] = [...RECORDED_TEMPLATES,
  { name: "tindak_lanjut_perawatan", language: "id", category: "utility", status: "approved", body: "Halo {{1}}, kami ingin tahu kabar Anda setelah kunjungan di {{2}}.", paramCount: 2 },
  { name: "isi_ulang_produk", language: "id", category: "marketing", status: "approved", body: "Halo {{1}}, saatnya isi ulang produk Anda di {{2}}.", paramCount: 2 },
  { name: "sapaan_ulang_tahun", language: "id", category: "marketing", status: "approved", body: "Selamat ulang tahun, {{1}}! Salam dari {{2}}.", paramCount: 2 }];

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
let seq = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];
const H = 3_600_000;
const BASE = Date.UTC(2032, 2, 1); // 1 March 2032 00:00 UTC (a leap year: 29 Feb exists)
const wib = (d: number, hh: number, mm = 0) => new Date(BASE + d * 86_400_000 + (hh - 7) * H + mm * 60_000);
const dayOf = (d: number) => new Date(BASE + d * 86_400_000).toISOString().slice(0, 10);

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("AU1", "Kemang"), b2: await br("AU2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`au${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf AU ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
async function paused<R>(tables: string[], fn: () => Promise<R>) {
  for (const t of tables) await h.admin.query(`alter table ${t} disable trigger ${t}_guard`);
  try {
    return await fn();
  } finally {
    for (const t of tables) await h.admin.query(`alter table ${t} enable always trigger ${t}_guard`);
  }
}
async function patient(t: T, name: string, birth = "1990-06-15") {
  const id = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, $3, 'female', 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $4, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, name, birth, t.b1])).rows[0].id as string;
  await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, id, `+62856${String(10000000 + ++seq)}`]);
  return id;
}
async function appointment(t: T, pt: string, start: Date, by: P, versionId: string) {
  return paused(["appointments"], async () => (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id,
      performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as) values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
    [t.tenantId, t.b1, pt, versionId, by.staffId, start, new Date(start.getTime() + 30 * 60_000)])).rows[0].id as string);
}
// A visit closed at a WIB instant with one counted execution of `versionId`.
async function closedVisit(t: T, pt: string, closed: Date, doc: P, fo: P, versionId: string) {
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, $5) returning id`,
    [t.tenantId, t.b1, pt, fo.staffId, new Date(closed.getTime() - H)])).rows[0].id as string;
  const exam = await paused(["examinations"], async () => (await h.admin.query(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id)
      values ($1, $2, $3, $4, $5) returning id`, [t.tenantId, t.b1, v, pt, doc.staffId])).rows[0].id as string);
  const plan = await paused(["care_plans"], async () => (await h.admin.query(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id,
      created_by) values ($1, $2, $3, 'Rencana', 'Kondisi', $4, $5) returning id`, [t.tenantId, t.b1, pt, exam, doc.staffId])).rows[0].id as string);
  const pi = await paused(["plan_items"], async () => (await h.admin.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty)
      values ($1, $2, $3, $4, 1, $5, 1) returning id`, [t.tenantId, t.b1, plan, exam, versionId])).rows[0].id as string);
  await paused(["treatment_executions"], () => h.admin.query(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id, performer_staff_id,
      identity_confirmed, state, started_by, started_as, start_command_key, started_at, finished_at, finished_by, finished_as, finish_command_key, outcome)
      values ($1, $2, $3, $4, $5, true, 'finished', $5, 'doctor', $6, $8, $8, $5, 'doctor', $7, 'completed')`,
    [t.tenantId, t.b1, v, pi, doc.staffId, `k-${key()}`, `k-${key()}`, new Date(closed.getTime() - 30 * 60_000)]));
  await paused(["visits"], () => h.admin.query(`update visits set closed_at = $2, closed_by = $3 where id = $1`, [v, closed, fo.staffId]));
  return v;
}
const occ = async (pt: string) => (await h.admin.query(`select x.*, x.planned_for::text planned, x.original_planned_for::text original, o.planned_for::text o_planned
  from automation_occurrences x left join outbound_messages o on o.id = x.outbound_id where x.patient_id = $1 order by x.created_at, x.id`, [pt])).rows;
// a queued automated (or other care) message for `pt` on `day` (the cap counts them all)
async function queuedFor(t: T, pt: string, day: string) {
  const tpl = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'pengingat_janji'`, [t.tenantId])).rows[0].id as string;
  return (await h.admin.query(`select public.outbound_enqueue_do($1, $2, 'care_reminder', $3, $4, $5, 'appointment', gen_random_uuid(), $6::date, null, null, now()) id`,
    [t.tenantId, `k-${key()}`, pt, t.b1, tpl, day])).rows[0].id as string;
}

let A: T; let B: T;
let OWN: P; let AP: P; let AP2: P; let MKT: P; let CS: P; let FO: P; let DOC: P; let FH: P; let AU: P; let MGR2: P; let BOWN: P;
let svc: string; let serum: string; let PH: P; let marketingText: string;
// repair 1: a second marketing user; one person with marketing and admin_pusat (two acting roles); a manager of both branches
let MKT2: P; let DUAL_MK: P; let DUAL_AP: P; let MGR12_B1: P; let MGR12_B2: P;

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 4 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Otomasi Sintetis");
  B = await tenant("PT Klinik Lain Otomasi");
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); AP2 = await person(A, "admin_pusat"); MKT = await person(A, "marketing");
  CS = await person(A, "central_cs"); FO = await person(A, "fo_cashier", A.b1); DOC = await person(A, "doctor", A.b1); FH = await person(A, "facility_head", A.b1);
  AU = await person(A, "auditor"); MGR2 = await person(A, "manager", A.b2); BOWN = await person(B, "owner");
  MKT2 = await person(A, "marketing");
  DUAL_MK = await person(A, "marketing");
  await assignRole(h.admin, { tenantId: A.tenantId, staffId: DUAL_MK.staffId, role: "admin_pusat" });
  DUAL_AP = { ...DUAL_MK, role: "admin_pusat" };
  MGR12_B1 = await person(A, "manager", A.b1, A.b2);
  MGR12_B2 = { ...MGR12_B1, branch: A.b2 };
  PH = await person(A, "pharmacist", A.b1);
  svc = (await as(OWN, (db) => publish(db, { kind: "service", code: "AU-FG" }, { name: "Facial Glow", tax_category: "exempt_medical", tax_basis: "Jasa medis",
    normal_price: 300_000, category: "facial", prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat.",
    delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }] } as never, "Layanan baru"))).versionId;
  const g = mockWabaGraphPort();
  const { wabaId } = await as(OWN, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(OWN, (db) => completeWabaSignup(db, wabaId, "code-verified" as never, { port: g }));
  await as(OWN, (db) => addWaNumber(db, key(), wabaId, { branchId: A.b1, phoneNumber: "+6281299900001", phoneNumberId: "990000000001" }, { port: g }));
  await as(OWN, (db) => syncTemplates(db, { port: { ...mockInboxPort(), fetchTemplates: async () => TEMPLATES.map((x) => ({ ...x })) } }));
  serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "AU-SRM" }, { name: "Serum Glow", tax_category: "non_object", tax_basis: "Barang", normal_price: 250_000 } as never, "Produk"))).itemId;
  await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  marketingText = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi klinik." }))).id;
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("T-097 Scenario PR-94 (frequency cap)", () => {
  it("two automated messages today → a third scenario is queued for the next day, shown as capped", async () => {
    const pt = await patient(A, "Pasien Batas Harian");
    await queuedFor(A, pt, dayOf(10));
    await queuedFor(A, pt, dayOf(10));
    // a visit closed 7 days before day 10 → kepuasan (H+7) triggers on day 10 at 09:00
    await closedVisit(A, pt, wib(3, 15), DOC, FO, svc);
    await runAutomationScan(worker, wib(10, 9));
    const rows = (await occ(pt)).filter((x) => x.scenario === "kepuasan");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "queued", original: dayOf(10), planned: dayOf(11), cap_deferred_days: 1, o_planned: dayOf(11) });
    const log = await as(CS, (db) => automationLog(db, "kepuasan", "capped"));
    expect(log.rows.map((r) => r.id)).toContain(rows[0].id);
    expect(log.rows.find((r) => r.id === rows[0].id)).toMatchObject({ capped: true, patient_name: "Pasien Batas Harian" });
    // a rescan is idempotent (one occurrence per scenario, source and offset)
    await runAutomationScan(worker, wib(10, 10));
    expect((await occ(pt)).filter((x) => x.scenario === "kepuasan")).toHaveLength(1);
    // repair 1 (log-capped-filter, ts-log-filter-dropped): a kepuasan row with room is queued, not capped; the filters exclude it
    const free = await patient(A, "Pasien Tanpa Batas");
    await closedVisit(A, free, wib(3, 15), DOC, FO, svc);
    await runAutomationScan(worker, wib(10, 11));
    const freeRow = (await occ(free)).find((x) => x.scenario === "kepuasan");
    expect(freeRow).toMatchObject({ state: "queued", cap_deferred_days: 0, planned: dayOf(10) });
    const ids = async (sc: "kepuasan" | "aftercare", st: "capped" | "queued" | "all") => (await as(CS, (db) => automationLog(db, sc, st))).rows.map((r) => r.id);
    expect(await ids("kepuasan", "capped")).not.toContain(freeRow.id);
    expect(await ids("kepuasan", "queued")).toContain(freeRow.id);
    expect(await ids("aftercare", "all")).not.toContain(freeRow.id);
    expect(await ids("aftercare", "all")).not.toContain(rows[0].id);
  });

  it("concurrent workers respect the cap: two occurrences at once for one patient with one slot left → one today, one tomorrow", async () => {
    const pt = await patient(A, "Pasien Pekerja Bersamaan");
    await queuedFor(A, pt, dayOf(20));
    const tpl = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'tindak_lanjut_perawatan'`, [A.tenantId])).rows[0].id as string;
    for (let round = 0; round < 3; round++) {
      const sources = [crypto.randomUUID(), crypto.randomUUID()];
      let arrived = 0;
      let open!: () => void;
      const barrier = new Promise<void>((r) => (open = r));
      const meet = async () => { if (++arrived === 2) open(); await barrier; };
      const one = async (src: string) => {
        // the internal helper is not granted to clinic_app (only automation_scan calls it): run it as the owner, the scan's definer
        const c = await owner.connect();
        try {
          await c.query("begin");
          // both transactions are open before either takes a lock; then the scan's order: staff_access, then the cap lock (inside)
          await meet();
          await c.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [A.tenantId]);
          await c.query(`select public.automation_occur($1, $2, 'kepuasan', 'visit', $3, $4, 7, $5::date, 2, null, 'Asia/Jakarta', 'care_reminder', 'followup', $3, $6, $7)`,
            [A.tenantId, A.b1, src, pt, dayOf(20 + round * 3), tpl, wib(20 + round * 3, 9)]);
          await c.query("commit");
        } catch (e) {
          await c.query("rollback").catch(() => undefined);
          throw e;
        } finally {
          c.release();
        }
      };
      // both reach the barrier inside an open transaction; the locks serialize them (the second sees the first's committed row)
      await Promise.all(sources.map((s) => one(s)));
      const day = dayOf(20 + round * 3);
      const counts = (await h.admin.query(`select planned_for::text d, count(*)::int c from outbound_messages where patient_id = $1 and state = 'queued'
          group by planned_for order by planned_for`, [pt])).rows;
      const today = counts.find((r) => r.d === day)?.c ?? 0;
      expect(today, `round ${round}`).toBeLessThanOrEqual(2);
    }
    // never more than the cap on any day
    const perDay = (await h.admin.query(`select planned_for, count(*)::int c from outbound_messages where patient_id = $1 group by planned_for`, [pt])).rows;
    for (const r of perDay) expect(r.c).toBeLessThanOrEqual(2);
  });

  it("two automation scans at once (no lock held by the test) for one patient with one slot left: the cap holds", async () => {
    const pt = await patient(A, "Pasien Dua Scan");
    // day 40: one message already queued; two visits closed 7 days before → two kepuasan occurrences in the same scan window
    await queuedFor(A, pt, dayOf(40));
    await closedVisit(A, pt, wib(33, 14), DOC, FO, svc);
    await closedVisit(A, pt, wib(33, 16), DOC, FO, svc);
    const [r1, r2] = await Promise.all([runAutomationScan(worker, wib(40, 9)), runAutomationScan(worker, wib(40, 9))]);
    expect(r1.considered + r2.considered).toBeGreaterThanOrEqual(2);
    const rows = (await occ(pt)).filter((x) => x.scenario === "kepuasan");
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.planned).sort()).toEqual([dayOf(40), dayOf(41)]);
    const perDay = (await h.admin.query(`select planned_for::text d, count(*)::int c from outbound_messages where patient_id = $1 group by planned_for`, [pt])).rows;
    for (const r of perDay) expect(r.c, r.d).toBeLessThanOrEqual(2);
  });
});

// A handed product dispensing at `handed` from a patient's counter invoice line (no visit → the line is required, 0087:104-105; no
// prescription: SET-48's masa, default 30 days).
async function handedProduct(t: T, pt: string, handed: Date) {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pt }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
  const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1 limit 1`, [invoiceId])).rows[0].id as string;
  const si = (await h.admin.query(`select id from stock_items where tenant_id = $1 and catalog_item_id = $2`, [t.tenantId, serum])).rows[0].id as string;
  const depot = (await h.admin.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [t.tenantId, t.b1])).rows[0].id as string;
  return paused(["dispensings"], async () => (await h.admin.query(`insert into dispensings (tenant_id, branch_id, visit_id, patient_id, invoice_line_id, stock_item_id,
      quantity, state, prepared_at, prepared_by, prepare_key, depot_id, handed_at, handed_by, hand_key, checks)
      values ($1, $2, null, $3, $10, $4, 1, 'handed', $5, $6, $7, $8, $5, $6, $9, '{}'::jsonb) returning id`,
    [t.tenantId, t.b1, pt, si, handed, PH.staffId, `pk-${key()}`, depot, `hk-${key()}`, line])).rows[0].id as string);
}
const consent = async (pt: string) => as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: marketingText, channel: "in_person" }));

describe("T-097 scenarios", () => {
  it("pengingat H-3, rencana H+14 (an unselected item), belum_jadwal H+21 (no next booking), aftercare H+1; off and quiet hours", async () => {
    const pt = await patient(A, "Pasien Skenario");
    const apt = await appointment(A, pt, wib(63, 14), DOC, svc);
    // H-3 at 09:00: the reminder through ('care_reminder', 'appointment')
    await runAutomationScan(worker, wib(60, 9));
    const p = (await occ(pt)).find((x) => x.scenario === "pengingat");
    expect(p).toMatchObject({ source_kind: "appointment", source_id: apt, offset_days: 3, state: "queued", planned: dayOf(60) });
    const ob = (await h.admin.query(`select purpose, source_kind from outbound_messages where id = $1`, [p.outbound_id])).rows[0];
    expect(ob).toEqual({ purpose: "care_reminder", source_kind: "appointment" });
    // quiet hours: a scan at 22:00 adds nothing for a visit due that day
    const pt2 = await patient(A, "Pasien Jam Diam");
    await closedVisit(A, pt2, wib(69, 15), DOC, FO, svc);
    await runAutomationScan(worker, wib(70, 22));
    expect(await occ(pt2)).toEqual([]);
    await runAutomationScan(worker, wib(70, 9));
    expect((await occ(pt2)).map((x) => x.scenario)).toEqual(["aftercare"]);
    // rencana H+14 needs an unselected item (the fixture's plan item is unselected and unbilled) → yes
    await runAutomationScan(worker, wib(83, 9));
    expect((await occ(pt2)).map((x) => x.scenario)).toContain("rencana");
    // repair 1 (rencana-always): a visit whose only plan item was removed gets no rencana on H+14
    const pt5 = await patient(A, "Pasien Rencana Dihapus");
    const v5 = await closedVisit(A, pt5, wib(140, 15), DOC, FO, svc);
    await paused(["plan_items"], () => h.admin.query(`update plan_items set removed_at = now() where plan_id in
      (select cp.id from care_plans cp join examinations e on e.id = cp.created_exam_id where e.visit_id = $1)`, [v5]));
    await runAutomationScan(worker, wib(154, 9));
    expect(await occ(pt5)).toEqual([]);
    // belum_jadwal H+21: no open visit, no live appointment, the latest visit → yes; a newer visit → no
    await runAutomationScan(worker, wib(90, 9));
    expect((await occ(pt2)).map((x) => x.scenario)).toContain("belum_jadwal");
    const pt3 = await patient(A, "Pasien Sudah Kembali");
    await closedVisit(A, pt3, wib(100, 15), DOC, FO, svc);
    await closedVisit(A, pt3, wib(110, 15), DOC, FO, svc);
    // day 121 = the older visit + 21: a newer visit exists → nothing; day 131 = the latest visit + 21 → one
    await runAutomationScan(worker, wib(121, 9));
    expect((await occ(pt3)).filter((x) => x.scenario === "belum_jadwal")).toHaveLength(0);
    await runAutomationScan(worker, wib(131, 9));
    expect((await occ(pt3)).filter((x) => x.scenario === "belum_jadwal")).toHaveLength(1);
    // a scenario switched off (kepuasan → Nonaktif, null in the opt spec) adds nothing
    await as(OWN, (db) => changeSetting(db, { key: "SET-19", branchId: null, reason: "Matikan kepuasan uji", value: { aftercare: 1, kepuasan: null, rencana: 14,
      belum_jadwal: 21, pengingat: 3, isi_ulang: 5, ulang_tahun: false, batas_harian: 2 } }));
    const pt4 = await patient(A, "Pasien Kepuasan Mati");
    await closedVisit(A, pt4, wib(130, 15), DOC, FO, svc);
    await runAutomationScan(worker, wib(137, 9));
    expect((await occ(pt4)).filter((x) => x.scenario === "kepuasan")).toEqual([]);
    await as(OWN, (db) => changeSetting(db, { key: "SET-19", branchId: null, restore: true, reason: "Kembali default uji" }));
  });

  it("isi_ulang H-5 before run-out (30 days) with consent; without consent skipped; ulang_tahun when on, 29 Feb on 28 Feb", async () => {
    const withC = await patient(A, "Pasien Isi Ulang");
    await consent(withC);
    const noC = await patient(A, "Pasien Tanpa Persetujuan");
    await handedProduct(A, withC, wib(150, 10));
    await handedProduct(A, noC, wib(150, 10));
    await runAutomationScan(worker, wib(175, 9)); // 150 + 30 - 5
    expect((await occ(withC)).find((x) => x.scenario === "isi_ulang")).toMatchObject({ state: "queued", source_kind: "dispensing" });
    expect((await occ(noC)).find((x) => x.scenario === "isi_ulang")).toMatchObject({ state: "skipped", skip_reason: "no_consent", outbound_id: null });
    // ulang_tahun: off by default → nothing; on → the birthday; 29 Feb → 28 Feb in a non-leap year (2033)
    const leap = await patient(A, "Pasien Kabisat", "2000-02-29");
    await consent(leap);
    const feb28 = Math.round((Date.UTC(2033, 1, 28) - BASE) / 86_400_000);
    await runAutomationScan(worker, wib(feb28, 9));
    expect((await occ(leap)).filter((x) => x.scenario === "ulang_tahun")).toEqual([]);
    await as(OWN, (db) => changeSetting(db, { key: "SET-19", branchId: null, reason: "Nyalakan ulang tahun uji", value: { aftercare: 1, kepuasan: 7, rencana: 14,
      belum_jadwal: 21, pengingat: 3, isi_ulang: 5, ulang_tahun: true, batas_harian: 2 } }));
    await runAutomationScan(worker, wib(feb28, 9));
    expect((await occ(leap)).find((x) => x.scenario === "ulang_tahun")).toMatchObject({ offset_days: 2033, state: "queued" });
    await as(OWN, (db) => changeSetting(db, { key: "SET-19", branchId: null, restore: true, reason: "Kembali default uji" }));
  });

  it("the 7-day horizon: a full week ahead → skipped cap_horizon_exceeded", async () => {
    const pt = await patient(A, "Pasien Penuh Seminggu");
    for (let d = 200; d <= 207; d++) { await queuedFor(A, pt, dayOf(d)); await queuedFor(A, pt, dayOf(d)); }
    await closedVisit(A, pt, wib(193, 15), DOC, FO, svc);
    await runAutomationScan(worker, wib(200, 9));
    expect((await occ(pt)).find((x) => x.scenario === "kepuasan")).toMatchObject({ state: "skipped", skip_reason: "cap_horizon_exceeded" });
  });
});

describe("T-097 the cap lock, deterministically (repair 1: locks-all-layers, cap-lock-removed)", () => {
  it("a second occurrence for the same patient waits on the first one's cap lock and then counts it (no lock held by the test)", async () => {
    const pt = await patient(A, "Pasien Kunci Batas");
    const day = dayOf(300);
    await queuedFor(A, pt, day); // one slot left (cap 2)
    const tpl = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'tindak_lanjut_perawatan'`, [A.tenantId])).rows[0].id as string;
    const occur = (c: pg.PoolClient, src: string) => c.query(`select public.automation_occur($1, $2, 'kepuasan', 'visit', $3, $4, 7, $5::date, 2, null,
      'Asia/Jakarta', 'care_reminder', 'followup', $3, $6, $7)`, [A.tenantId, A.b1, src, pt, day, tpl, wib(300, 9)]);
    const t1 = await owner.connect();
    const t2 = await owner.connect();
    let t2Open = false;
    try {
      const pid1 = (await t1.query(`select pg_backend_pid() p`)).rows[0].p as number;
      const [s1, s2] = [crypto.randomUUID(), crypto.randomUUID()];
      await t1.query("begin");
      await occur(t1, s1); // takes the cap lock (and the outbound guard's staff_access lock) and holds them
      await t2.query("begin");
      t2Open = true;
      let done = false;
      const p2 = occur(t2, s2).then(() => (done = true));
      // bounded wait (≤ 5 s): T2 blocked by T1
      let blocked = false;
      for (let i = 0; i < 100 && !blocked && !done; i++) {
        blocked = (await h.admin.query(`select count(*)::int c from pg_stat_activity a where a.wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(a.pid))`,
          [pid1])).rows[0].c > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 50));
      }
      expect([done, blocked]).toEqual([false, true]);
      await t1.query("commit");
      await p2;
      await t2.query("commit");
      t2Open = false;
      const rows = (await occ(pt)).filter((x) => x.scenario === "kepuasan");
      expect(Object.fromEntries(rows.map((x) => [x.source_id, x.planned]))).toEqual({ [s1]: day, [s2]: dayOf(301) });
    } finally {
      await t1.query("rollback").catch(() => undefined);
      if (t2Open) await t2.query("rollback").catch(() => undefined);
      t1.release();
      t2.release();
    }
  });
});

describe("T-097 marketing drafts of SET-19", () => {
  it("marketing proposes; another approver decides through setting_set; one pending; reject needs a reason; the proposer cancels", async () => {
    const value = { aftercare: 2, kepuasan: 7, rencana: 14, belum_jadwal: 21, pengingat: 3, isi_ulang: 5, ulang_tahun: false, batas_harian: 3 };
    // repair 1 (draft-value-unchecked): with no draft pending, an out-of-bounds value is refused by the value check itself
    expect(await code(as(MKT, (db) => proposeScenarioDraft(db, key(), { ...value, batas_harian: 9 }, "Di luar batas")))).toBe("ERR_INVALID_INPUT");
    const { draftId } = await as(MKT, (db) => proposeScenarioDraft(db, key(), value, "Naikkan batas harian"));
    expect(await code(as(MKT, (db) => proposeScenarioDraft(db, key(), value, "Usulan kedua")))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect(await code(as(MKT, (db) => proposeScenarioDraft(db, key(), { ...value, batas_harian: 9 }, "Di luar batas")))).not.toBe("ok");
    expect(await code(as(OWN, (db) => proposeScenarioDraft(db, key(), value, "Owner tidak mengusulkan")))).toBe("ERR_FORBIDDEN");
    expect((await as(AP, (db) => automationDraft(db)))?.id).toBe(draftId);
    expect(await code(as(MKT, (db) => decideScenarioDraft(db, draftId, true)))).toBe("ERR_FORBIDDEN");
    // repair 1 (draft-marketing-decides): marketing never decides, not only the proposer
    expect(await code(as(MKT2, (db) => decideScenarioDraft(db, draftId, true)))).toBe("ERR_FORBIDDEN");
    // the reject path never reaches setting_set (whose own changers would refuse an approve): only the role check guards it
    expect(await code(as(MKT2, (db) => decideScenarioDraft(db, draftId, false, "Tolak oleh marketing")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(AP, (db) => decideScenarioDraft(db, draftId, false, "")))).toBe("ERR_INVALID_INPUT");
    expect(await as(AP, (db) => decideScenarioDraft(db, draftId, true, "Disetujui"))).toBe("approved");
    expect(await as(OWN, (db) => settingValue(db, "SET-19"))).toEqual(value);
    const v = (await h.admin.query(`select changed_by, changed_as from setting_versions where id = (select setting_version_id from automation_scenario_drafts where id = $1)`, [draftId])).rows[0];
    expect(v).toEqual({ changed_by: AP.staffId, changed_as: "admin_pusat" });
    expect(await code(as(AP2, (db) => decideScenarioDraft(db, draftId, true)))).toBe("ERR_VERSION_CONFLICT");
    // reject and cancel
    const r = await as(MKT, (db) => proposeScenarioDraft(db, key(), value, "Usulan ditolak"));
    expect(await as(OWN, (db) => decideScenarioDraft(db, r.draftId, false, "Belum perlu"))).toBe("rejected");
    const c = await as(MKT, (db) => proposeScenarioDraft(db, key(), value, "Usulan ditarik"));
    expect(await code(as(AP, (db) => cancelScenarioDraft(db, c.draftId)))).toBe("ERR_FORBIDDEN");
    await as(MKT, (db) => cancelScenarioDraft(db, c.draftId));
    expect(await as(MKT, (db) => automationDraft(db))).toBeNull();
    // repair 1 (draft-self-decide): a person with marketing and admin_pusat proposes, then cannot decide it as admin_pusat
    const self = await as(DUAL_MK, (db) => proposeScenarioDraft(db, key(), value, "Usulan peran ganda"));
    expect(await code(as(DUAL_AP, (db) => decideScenarioDraft(db, self.draftId, true)))).toBe("ERR_FORBIDDEN");
    await as(DUAL_MK, (db) => cancelScenarioDraft(db, self.draftId));
    expect(await as(MKT, (db) => automationDraft(db))).toBeNull();
    await as(OWN, (db) => changeSetting(db, { key: "SET-19", branchId: null, restore: true, reason: "Kembali default uji" }));
  });
});

describe("T-097 log projection, guards, the unbound scan and tenants", () => {
  it("the log masks by role and consent; the scan refuses a bound connection; occurrences and drafts are guarded; tenants stay apart", async () => {
    const pt = await patient(A, "Pasien Rahasia Log");
    await closedVisit(A, pt, wib(253, 15), DOC, FO, svc);
    await runAutomationScan(worker, wib(260, 9));
    const id = (await occ(pt)).find((x) => x.scenario === "kepuasan").id;
    const find = async (p: P) => (await as(p, (db) => automationLog(db, "kepuasan", "all"))).rows.find((r) => r.id === id);
    expect(await find(CS)).toMatchObject({ patient_name: "Pasien Rahasia Log", consent_masked: false });
    expect(await find(MKT)).toMatchObject({ patient_name: null, patient_mrn: null, consent_masked: true });
    expect((await find(AU))?.patient_mrn).toMatch(/^\*\*\*\d{3}$/);
    expect(await find(MGR2)).toBeUndefined(); // another branch
    // repair 1 (log-other-branch): a manager of both branches sees the b1 row acting at b1, not acting at b2
    expect(await find(MGR12_B1)).toMatchObject({ patient_name: "Pasien Rahasia Log" });
    expect(await find(MGR12_B2)).toBeUndefined();
    expect(await find(FH)).toMatchObject({ patient_name: "Pasien Rahasia Log" });
    expect(await code(as(FO, (db) => automationLog(db)))).toBe("ERR_FORBIDDEN");
    expect(JSON.stringify(await as(CS, (db) => automationLog(db)))).not.toMatch(/Facial|Glow|kabar Anda/);
    await consent(pt);
    expect(await find(MKT)).toMatchObject({ patient_name: "Pasien Rahasia Log", consent_masked: false });
    // the scan is unbound only
    expect(await as(OWN, (db) => db.query(`select automation_scan(null)`)).then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:42501");
    // guards
    expect(await raw(`update automation_occurrences set cap_deferred_days = 0 where id = $1`, [id])).toBe("raw:42501");
    expect(await raw(`delete from automation_occurrences where id = $1`, [id])).toBe("raw:42501");
    expect(await raw(`truncate automation_occurrences cascade`)).toBe("raw:42501");
    expect(await raw(`delete from automation_scenario_drafts`)).toBe("raw:42501");
    // tenants: B's owner reads none of A's occurrences or drafts
    expect((await as(BOWN, (db) => db.query(`select id from automation_occurrences where id = $1`, [id]))).rowCount).toBe(0);
    expect((await as(BOWN, (db) => automationLog(db))).rows).toEqual([]);
    expect(await as(BOWN, (db) => automationDraft(db))).toBeNull();
  });
});

