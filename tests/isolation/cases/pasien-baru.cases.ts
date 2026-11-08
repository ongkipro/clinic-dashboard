// Pendaftaran Pasien (UX-4, PR-5, T-037): the page renders no tenant data until the actions run; the
// actions search (patient_matches, identity index) and register (patient_register). Each case seeds in
// B a patient (secret name, phone and NIK) registered by B's FO, then runs as A's FO: searching by B's
// phone, name, MRN or NIK finds nothing; registering into B's branch is refused; reading B's patient
// by id is not found (scenario PR-1). The fixture tenants are set live (registration is new business,
// tenant_capability 'new_booking'). Synthetic data on a local database (MIG-2).
import { randomBytes } from "node:crypto";
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { findMatches, getPatient, identityIndexForSearch, registerPatient, sealIdentity } from "../../../src/modules/patients/patients";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, randomBytes(32)]]) });

const fos = new Map<string, string>();
async function foOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = fos.get(tenantId);
  if (known) return known;
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`fo.psn.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "fo pasien" });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role: "fo_cashier" });
    await assignBranch(c, { tenantId, staffRoleId: rid, branchId: env.victim.tenantId === tenantId ? env.victim.branchId : env.actor.branchId });
  } finally {
    c.release();
  }
  fos.set(tenantId, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  const branch = env.victim.tenantId === tenantId ? env.victim.branchId : env.actor.branchId;
  const ctx = await resolveContext(env.app, await foOf(env, tenantId), { tenantId, actingRole: "fo_cashier", activeBranchId: branch });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

const seeded = new Map<string, { id: string; mrn: string; name: string; phone: string; nik: string }>();
async function victimPatient(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const suffix = t.replace(/[^0-9]/g, "").padEnd(8, "7").slice(0, 8);
  const name = `Pasien Rahasia ${t.slice(0, 8)}`;
  const phone = `+62812${suffix}`;
  const nik = `31710${suffix}123`;
  const r = await as(env, t, async (db) => registerPatient(db as never, {
    full_name: name, birth_date: "1991-02-03", sex: "female", phone, identity_type: "nik", religion: "islam", occupation: "Karyawan", education: "s1", marital_status: "kawin",
  }, await sealIdentity(db as never, t, "nik", nik), "new"));
  if (!r.ok) throw new Error("victim patient not registered");
  env.victimSecret(name);
  env.victimSecret(r.patientId);
  env.victimSecret(r.mrn);
  const v = { id: r.patientId, mrn: r.mrn, name, phone, nik };
  seeded.set(t, v);
  return v;
}
const refused = (p: Promise<unknown>) => p.then((r) => ((r as { ok?: boolean })?.ok === false ? "refused" : "done"), (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/pasien/baru",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      // The page itself reads no patient; its search is the data path: every mode, as the caller.
      const v = await victimPatient(env);
      const body = await as(env, env.actor.tenantId, async (db) => {
        const bidx = await identityIndexForSearch(db as never, env.actor.tenantId, "nik", v.nik);
        return {
          phone: await findMatches(db as never, { phone: v.phone }),
          name: await findMatches(db as never, { name: v.name }),
          mrn: await findMatches(db as never, { mrn: v.mrn }),
          nik: bidx ? await findMatches(db as never, { identityBidx: bidx }) : [],
        };
      });
      return { status: 200, body: body as never };
    },
  },
  {
    kind: "action",
    id: "app/(app)/pasien/baru/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.id ?? "",
    async run(env) {
      const v = await victimPatient(env);
      // Register into B's branch (refused for A: another branch), and read B's patient (scenario PR-1).
      const nik = `3171${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`;
      const register = await refused(as(env, env.actor.tenantId, async (db) => registerPatient(db as never, {
        full_name: `Baru ${nik.slice(-6)}`, birth_date: "1992-03-04", sex: "male", phone: `+62813${nik.slice(-8)}`, identity_type: "nik", religion: "islam",
        occupation: "Karyawan", education: "s1", marital_status: "kawin", branch_id: env.victim.branchId,
      }, await sealIdentity(db as never, env.actor.tenantId, "nik", nik), "new")));
      const read = await as(env, env.actor.tenantId, async (db) => getPatient(db as never, v.id));
      return {
        attempts: { register, read: read ? "done" : "not_seen" },
        body: { register, read: read ? { id: read.id, name: read.fullName } : null },
      };
    },
  },
);
