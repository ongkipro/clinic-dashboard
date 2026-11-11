// Permintaan Klinis (UX-27, PR-45, T-056): the inbox (clinical_request_list), one request (clinical_request_get),
// the proposal form (clinical_request_options), and the actions (create, decide, cancel). Each run seeds in B a
// fresh patient with a visit, a signed examination and a plan with one item by B's doctor, and a pending request
// by B's nurse; then runs as a doctor or nurse of the caller's own branch: B's inbox, request and form are not
// found or empty; every write on B's visit, plan or request is refused. As B's staff (positive control) everything
// succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { publish } from "../../../src/modules/catalog/catalog";
import { addPlanItem, createPlan, openExam } from "../../../src/modules/clinical/exam/exam";
import { cancelRequest, createRequest, decideRequest, getRequest, listRequests, requestOptions } from "../../../src/modules/clinical/requests/requests";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "doctor" | "nurse" | "owner";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.prm56.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: role === "doctor" ? "Dokter Permintaan" : role === "nurse" ? "Perawat Permintaan" : "Pemilik" });
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
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

let runs = 0;
const versions = new Map<string, string>();
const latest = new Map<string, { name: string; visit: string; plan: string; item: string; version: string; pending: string; cancel: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const doc = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, "doctor", fn);
  const nur = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, "nurse", fn);
  await member(env, t, b, "doctor");
  const staff = (await env.owner.query(`select s.id from staff s join memberships m on m.id = s.membership_id where m.account_id = $1`, [accOf.get(`${t}:doctor`)])).rows[0].id as string;
  let version = versions.get(t);
  if (!version) {
    version = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `PRM-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 100_000 }, "Produk uji isolasi"))).versionId;
    versions.set(t, version);
  }
  const name = `Pasien Rahasia Permintaan ${t.slice(0, 8)} ${++runs}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status,
                           registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', $5, $6, 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, staff, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)],
  )).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, staff])).rows[0].id as string;
  const { examId } = await doc((db) => openExam(db, crypto.randomUUID(), visit));
  const { planId: plan } = await doc((db) => createPlan(db, crypto.randomUUID(), examId, "Program Rahasia", "Kondisi rahasia"));
  const { itemId: item } = await doc((db) => addPlanItem(db, crypto.randomUUID(), examId, plan, { stage: 1, catalog_version_id: version!, qty: 1 }));
  const { requestId: pending } = await nur((db) => createRequest(db, crypto.randomUUID(), visit, { kind: "addition", planId: plan, catalogVersionId: version!, stage: 2, qty: 1, reason: "Alasan rahasia" }));
  const { requestId: cancel } = await nur((db) => createRequest(db, crypto.randomUUID(), visit, { kind: "addition", planId: plan, catalogVersionId: version!, stage: 3, qty: 1, reason: "Alasan rahasia dua" }));
  for (const s of [name, patient, visit, plan, item, pending, cancel]) env.victimSecret(s);
  const r = { name, visit, plan, item, version: version!, pending, cancel };
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
    id: "/permintaan",
    expect: "filtered",
    marker,
    async run(env) {
      await victim(env);
      return asMine(env, "doctor", (db) => listRequests(db as never, null).then(ok));
    },
  },
  {
    kind: "route",
    id: "/permintaan/[id]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asMine(env, "doctor", (db) => getRequest(db as never, v.pending).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/permintaan/baru",
    expect: "filtered",
    marker,
    async run(env) {
      const v = await victim(env);
      return asMine(env, "nurse", (db) => requestOptions(db as never, v.visit).then(ok));
    },
  },
  {
    kind: "action",
    id: "app/(app)/permintaan/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const attempts = {
        create: await outcome(asMine(env, "nurse", (db) => createRequest(db as never, k(), v.visit, { kind: "addition", planId: v.plan, catalogVersionId: v.version, stage: 4, qty: 1, reason: "Coba lintas" }))),
        decide: await outcome(asMine(env, "doctor", (db) => decideRequest(db as never, k(), v.pending, true, null))),
        cancel: await outcome(asMine(env, "nurse", (db) => cancelRequest(db as never, k(), v.cancel))),
      };
      const read = await asMine(env, "doctor", (db) => getRequest(db as never, v.pending).then((x) => x.patient_name, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
