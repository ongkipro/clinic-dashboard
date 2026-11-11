// Ruang Tindakan (UX-9, PR-14, T-064): the room list (treatment_room_list), one visit (treatment_get) and the
// actions (start, timer, finish, Bahan Tambahan). Each run seeds in B a fresh patient with a visit, a signed
// examination and a plan with one item by B's doctor, and a started execution of a second item; then runs as a
// nurse of the caller's own branch: B's visit is absent from the list and not found; every write on B's visit or
// execution is refused. As B's staff (positive control) everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { publish } from "../../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../../src/modules/clinical/exam/exam";
import { signRecord } from "../../../src/modules/clinical/records/records";
import { createDepot } from "../../../src/modules/inventory/depots/depots";
import { saveItem } from "../../../src/modules/inventory/stock";
import { requestMaterials } from "../../../src/modules/inventory/materials/materials";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { finishTreatment, getTreatment, pauseTreatment, roomList, startTreatment } from "../../../src/modules/treatment/treatment";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "doctor" | "nurse" | "owner" | "pharmacist" | "facility_head";
const accOf = new Map<string, string>();
const staffOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.rng64.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Ruang ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  staffOf.set(k, staffId);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, "nurse", fn);

// A verified STR + SIP for B's doctor so the start gate passes for the positive control.
async function credential(env: IsolationEnv, t: string, b: string, staff: string, by: string, verifier: string) {
  for (const [kind, br] of [["str", null], ["sip", b]] as const) {
    const id = (await env.owner.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t, staff, kind, `RG-${crypto.randomUUID().slice(0, 8)}`, br, br ? "2099-12-31" : null, by])).rows[0].id as string;
    await env.owner.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, verifier]);
  }
}

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
const setup = new Map<string, { version: string; depot: string; stock: string }>();
const latest = new Map<string, { name: string; visit: string; item: string; item2: string; execution: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const doc = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, "doctor", fn);
  await member(env, t, b, "doctor");
  const docStaff = staffOf.get(`${t}:doctor`)!;
  let s = setup.get(t);
  if (!s) {
    await member(env, t, b, "owner");
    const ownStaff = staffOf.get(`${t}:owner`)!;
    await member(env, t, b, "facility_head");
    await credential(env, t, b, docStaff, ownStaff, staffOf.get(`${t}:facility_head`)!);
    const version = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `RG-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Ruang", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 100_000 }, "Produk uji isolasi"))).versionId;
    const mat = (await as(env, t, b, "owner", (db) => publish(db, { kind: "material", code: `RGM-${t.slice(0, 6).toUpperCase()}` },
      { name: "Bahan Rahasia Ruang", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan uji isolasi"))).itemId;
    const stock = (await as(env, t, b, "pharmacist", (db) => saveItem(db, crypto.randomUUID(), null, { catalogItemId: mat, unit: "ml", storage: "ruang", highValue: false, active: true }))).itemId;
    const depot = (await as(env, t, b, "pharmacist", (db) => createDepot(db, crypto.randomUUID(), { branchId: null, name: "Depot Ruang Rahasia", kind: "ruang" }))).depotId;
    s = { version, depot, stock };
    setup.set(t, s);
  }
  const name = `Pasien Rahasia Ruang ${t.slice(0, 8)} ${++runs}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status,
                           registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', $5, $6, 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, docStaff, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, docStaff])).rows[0].id as string;
  const { examId } = await doc((db) => openExam(db, crypto.randomUUID(), visit));
  const { planId } = await doc((db) => createPlan(db, crypto.randomUUID(), examId, "Program Rahasia", "Kondisi rahasia"));
  const { itemId: item } = await doc((db) => addPlanItem(db, crypto.randomUUID(), examId, planId, { stage: 1, catalog_version_id: s!.version, qty: 1 }));
  const { itemId: item2 } = await doc((db) => addPlanItem(db, crypto.randomUUID(), examId, planId, { stage: 1, catalog_version_id: s!.version, qty: 2 }));
  await doc((db) => signRecord(db, crypto.randomUUID(), examId, { verified: true }));
  const text = await doc((db) => consentText(db, visit, planId));
  await doc((db) => captureConsent(db, crypto.randomUUID(), { visitId: visit, planId, signer: "patient", expectedHash: text.content_hash, signature: png() }));
  const { executionId: execution } = await doc((db) => startTreatment(db, crypto.randomUUID(), visit, { planItemId: item2, performerId: docStaff, identityConfirmed: true }));
  for (const x of [name, patient, visit, item, item2, execution]) env.victimSecret(x);
  const r = { name, visit, item, item2, execution };
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
    id: "/ruang",
    expect: "filtered",
    marker,
    async run(env) {
      await victim(env);
      return asMine(env, (db) => roomList(db as never).then(ok));
    },
  },
  {
    kind: "route",
    id: "/ruang/[visitId]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asMine(env, (db) => getTreatment(db as never, v.visit).then(ok, notFound));
    },
  },
  {
    kind: "action",
    id: "app/(app)/ruang/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const s = setup.get(env.victim.tenantId)!;
      const me = env.actor.tenantId === env.victim.tenantId ? staffOf.get(`${env.victim.tenantId}:doctor`)! : (await member(env, env.actor.tenantId, env.actor.branchId, "nurse"), staffOf.get(`${env.actor.tenantId}:nurse`)!);
      const k = () => crypto.randomUUID();
      const attempts = {
        start: await outcome(as(env, env.actor.tenantId, env.actor.branchId, env.actor.tenantId === env.victim.tenantId ? "doctor" : "nurse",
          (db) => startTreatment(db as never, k(), v.visit, { planItemId: v.item, performerId: me, identityConfirmed: true }))),
        timer: await outcome(asMine(env, (db) => pauseTreatment(db as never, k(), v.execution))),
        // on the other item: an open request of the running item would rightly block its finish (P1-1)
        extra: await outcome(asMine(env, (db) => requestMaterials(db as never, k(), { visitId: v.visit, roomDepotId: s.depot, planItemId: v.item, lines: [{ itemId: s.stock, quantity: "1" }] }))),
        finish: await outcome(asMine(env, (db) => finishTreatment(db as never, k(), v.execution, { outcome: "medical_stop", reason: "Coba lintas" }))),
      };
      const read = await asMine(env, (db) => getTreatment(db as never, v.visit).then((x) => x.patient.name, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
