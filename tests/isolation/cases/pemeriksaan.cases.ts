// Pemeriksaan (UX-8, PR-10, T-052): the doctor's queue of a branch (pemeriksaan_visits), one visit's sheet
// (exam_sheet), the plan projection (plan_options) and the actions (open, save, verify, mark, plan, item,
// close). Each run seeds in B a fresh patient with a visit, a sent intake, an examination and a plan by B's
// staff, then runs as a doctor of the caller's own branch: B's branch queue, B's sheet and B's plan
// projection are not found; every write on B's visit, examination or plan is refused. As B's doctor (positive
// control) everything succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import {
  addPlanItem, closePlan, createPlan, examQueue, examSheet, openExam, planOptions, removeMark, removePlanItem, saveExam, setMark, verifyFact,
} from "../../../src/modules/clinical/exam/exam";
import { publish } from "../../../src/modules/catalog/catalog";
import { openIntake, saveIntake, sendIntake } from "../../../src/modules/clinical/intake/intake";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const staffOf = new Map<string, string>();
// A staff member of the tenant's case branch in a role (one per tenant and role).
type CaseRole = "doctor" | "bc" | "owner";
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = staffOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.pmr52.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: role === "doctor" ? "Dokter Pemeriksa" : role === "bc" ? "BC Pemeriksaan" : "Pemilik Klinik" });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  staffOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asDoctor = <T>(env: IsolationEnv, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, "doctor", fn);

let runs = 0;
const latest = new Map<string, { name: string; visit: string; exam: string; plan: string; fact: string; version: string; mark: string; item: string }>();
const versions = new Map<string, string>();
// A fresh secret patient in B: a visit, a sent intake with one fact, an examination with a mark, and a plan with
// an item by B's staff (a product version published once per tenant by its owner).
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const bc = (fn: (db: never) => Promise<unknown>) => as(env, t, b, "bc", fn);
  const doc = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, "doctor", fn);
  const by = (await env.owner.query(`select s.id from staff s join memberships m on m.id = s.membership_id where m.account_id = $1 and s.tenant_id = $2`, [await member(env, t, b, "bc"), t])).rows[0].id as string;
  const name = `Pasien Rahasia Pemeriksaan ${t.slice(0, 8)} ${++runs}`;
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || lpad((floor(random() * 900000) + 100000)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, by],
  )).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, by])).rows[0].id as string;
  const { intakeId } = (await bc((db) => openIntake(db, crypto.randomUUID(), visit))) as { intakeId: string };
  await bc((db) => saveIntake(db, crypto.randomUUID(), intakeId, { complaint: "Keluhan rahasia", facts: [{ kind: "note", value: "Fakta rahasia" }] }));
  await bc((db) => sendIntake(db, crypto.randomUUID(), intakeId));
  const fact = (await env.owner.query(`select id from intake_facts where intake_id = $1`, [intakeId])).rows[0].id as string;
  const { examId: exam } = await doc((db) => openExam(db, crypto.randomUUID(), visit));
  const { planId: plan } = await doc((db) => createPlan(db, crypto.randomUUID(), exam, "Program Rahasia", "Kondisi rahasia"));
  let version = versions.get(t);
  if (!version) {
    version = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `PMR-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 100_000 }, "Produk uji isolasi"))).versionId;
    versions.set(t, version);
  }
  const { markId: mark } = await doc((db) => setMark(db, crypto.randomUUID(), exam, { template: "body", layer: "keluhan", x: 5, y: 5, label: "Titik rahasia" }));
  const { itemId: item } = await doc((db) => addPlanItem(db, crypto.randomUUID(), exam, plan, { stage: 1, catalog_version_id: version!, qty: 1 }));
  for (const s of [name, patient, visit, intakeId, exam, plan, mark, item]) env.victimSecret(s);
  const r = { name, visit, exam, plan, fact, version, mark, item };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases(
  {
    kind: "route",
    id: "/pemeriksaan",
    expect: "not-found",
    marker,
    async run(env) {
      await victim(env);
      return asDoctor(env, (db) => examQueue(db as never, env.victim.branchId).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/pemeriksaan/[visitId]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asDoctor(env, (db) => examSheet(db as never, v.visit).then(ok, notFound));
    },
  },
  {
    kind: "action",
    id: "app/(app)/pemeriksaan/actions",
    // The plan title reaches the body only through a successful projection or sheet read (positive control).
    marker: (env) => latest.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const attempts = {
        open: await outcome(asDoctor(env, (db) => openExam(db as never, k(), v.visit))),
        save: await outcome(asDoctor(env, (db) => saveExam(db as never, k(), v.exam, { assessment: "Uji isolasi" }))),
        verify: await outcome(asDoctor(env, (db) => verifyFact(db as never, k(), v.exam, v.fact, "confirmed"))),
        mark: await outcome(asDoctor(env, (db) => setMark(db as never, k(), v.exam, { template: "face_front", layer: "keluhan", x: 1, y: 1, label: "Uji" }))),
        unmark: await outcome(asDoctor(env, (db) => removeMark(db as never, k(), v.exam, v.mark))),
        plan: await outcome(asDoctor(env, (db) => createPlan(db as never, k(), v.exam, "Program Uji", "Kondisi uji"))),
        item: await outcome(asDoctor(env, (db) => addPlanItem(db as never, k(), v.exam, v.plan, { stage: 2, catalog_version_id: v.version, qty: 1 }))),
        unitem: await outcome(asDoctor(env, (db) => removePlanItem(db as never, k(), v.exam, v.item))),
        close: await outcome(asDoctor(env, (db) => closePlan(db as never, k(), v.exam, v.plan, "stopped"))),
      };
      const read = await asDoctor(env, (db) => examSheet(db as never, v.visit).then((x) => x.patient.name, () => null));
      const options = await asDoctor(env, (db) => planOptions(db as never, v.visit).then((x) => x.plans.map((p) => p.title), () => null));
      return { attempts, body: { ...attempts, read, options } };
    },
  },
);
