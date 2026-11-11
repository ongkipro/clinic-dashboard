// Persetujuan Tindakan (UX-39, PR-11, T-054): the consent list of a branch (consent_visits), one visit's page
// (consent_visit), the start gate, the signature, and the actions (capture, withdraw, contraindication review).
// Each run seeds in B a fresh patient with a visit, an examination, a plan with an item and an active consent by
// B's doctor, then runs as a doctor of the caller's own branch: B's list, page, gate and signature are not found;
// every write on B's visit, consent or examination is refused. As B's doctor (positive control) everything
// succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { publish } from "../../../src/modules/catalog/catalog";
import {
  captureConsent, checkTreatmentStart, consentPage, consentQueue, consentSignature, consentText, reviewContraindication, withdrawConsent,
} from "../../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../../src/modules/clinical/exam/exam";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "doctor" | "owner";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.csn54.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: role === "doctor" ? "Dokter Persetujuan" : "Pemilik Klinik" });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asDoctor = <T>(env: IsolationEnv, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, "doctor", fn);
const staffIdOf = async (env: IsolationEnv, tenantId: string, branchId: string) =>
  (await env.owner.query(`select s.id from staff s join memberships m on m.id = s.membership_id where m.account_id = $1 and s.tenant_id = $2`,
    [await member(env, tenantId, branchId, "doctor"), tenantId])).rows[0].id as string;

// A PNG header large enough for the pad's minimum (the database checks the signature bytes and IHDR).
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}

let runs = 0;
const versions = new Map<string, string>();
const latest = new Map<string, { name: string; visit: string; exam: string; plan: string; item: string; consent: string; staff: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const doc = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, "doctor", fn);
  const staff = await staffIdOf(env, t, b);
  const name = `Pasien Rahasia Persetujuan ${t.slice(0, 8)} ${++runs}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status,
                           registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', $5, $6, 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, staff, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)],
  )).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, staff])).rows[0].id as string;
  let version = versions.get(t);
  if (!version) {
    version = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `CSN-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 100_000 }, "Produk uji isolasi"))).versionId;
    versions.set(t, version);
  }
  const { examId: exam } = await doc((db) => openExam(db, crypto.randomUUID(), visit));
  const { planId: plan } = await doc((db) => createPlan(db, crypto.randomUUID(), exam, "Program Rahasia", "Kondisi rahasia"));
  const { itemId: item } = await doc((db) => addPlanItem(db, crypto.randomUUID(), exam, plan, { stage: 1, catalog_version_id: version!, qty: 1 }));
  const text = await doc((db) => consentText(db, visit, plan));
  const { consentId: consent } = await doc((db) => captureConsent(db, crypto.randomUUID(), { visitId: visit, planId: plan, signer: "patient", expectedHash: text.content_hash, signature: png() }));
  for (const s of [name, patient, visit, exam, plan, item, consent]) env.victimSecret(s);
  const r = { name, visit, exam, plan, item, consent, staff };
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
    id: "/persetujuan-tindakan",
    expect: "not-found",
    marker,
    async run(env) {
      await victim(env);
      return asDoctor(env, (db) => consentQueue(db as never, env.victim.branchId).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/persetujuan-tindakan/[visitId]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asDoctor(env, (db) => consentPage(db as never, v.visit).then(ok, notFound));
    },
  },
  {
    kind: "action",
    id: "app/(app)/persetujuan-tindakan/actions",
    marker: (env) => latest.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      // The text (hash) of B's plan is read as B to make the capture attempt real; A then tries to sign with it.
      const hash = (await as(env, env.victim.tenantId, env.victim.branchId, "doctor", (db) => consentText(db as never, v.visit, v.plan))).content_hash;
      // Withdraw first (B's active consent), then capture a new one (allowed again once the previous is withdrawn).
      const attempts = {
        review: await outcome(asDoctor(env, (db) => reviewContraindication(db as never, k(), v.exam, v.item, "cleared"))),
        withdraw: await outcome(asDoctor(env, (db) => withdrawConsent(db as never, k(), v.consent, "Uji isolasi"))),
        capture: await outcome(asDoctor(env, (db) => captureConsent(db as never, k(), { visitId: v.visit, planId: v.plan, signer: "patient", expectedHash: hash, signature: png() }))),
      };
      const read = await asDoctor(env, (db) => consentPage(db as never, v.visit).then((x) => x.patient.name, () => null));
      const gate = await asDoctor(env, (db) => checkTreatmentStart(db as never, v.visit, [v.item], v.staff).then((x) => x.blockers, () => null));
      const signature = await asDoctor(env, (db) => consentSignature(db as never, v.consent).then((x) => x.length, () => null));
      return { attempts, body: { ...attempts, read, gate, signature } };
    },
  },
);
