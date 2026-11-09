// Daftar Pasien (PR-76, T-041): the page searches patients (patient_search) and lists the staff member's
// saved segments; the actions search, save and delete a segment. Each run seeds in B a fresh patient with
// a secret name and phone and a segment of B's owner. As A's owner: searching by B's name or phone finds
// nothing; B's segment is not listed and cannot be deleted. As B's owner (positive control) the search
// finds the patient and the delete succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { deleteSegment, mySegments, saveSegment, searchPatients } from "../../../src/modules/patients/search/search";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const owners = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`owner.cari41.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "owner cari" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  owners.set(tenantId, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  const ctx = await resolveContext(env.app, await ownerOf(env, tenantId), { tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
const latest = new Map<string, { name: string; phone: string; patient: string; segment: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  await ownerOf(env, t);
  runs += 1;
  const name = `Pasien Rahasia Daftar ${t.slice(0, 8)} ${runs}`;
  const digits = `${t.replace(/[^0-9]/g, "").padEnd(6, "3").slice(0, 6)}${String(runs).padStart(2, "0")}`;
  const phone = `+62819${digits}`;
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || lpad((floor(random() * 900000) + 100000)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $3,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, name, env.victim.branchId],
  )).rows[0].id as string;
  await env.owner.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t, patient, phone]);
  const { segmentId } = await as(env, t, (db) => saveSegment(db, crypto.randomUUID(), `Segmen Rahasia ${runs}`, { visiting_now: true }));
  for (const s of [name, phone, patient, segmentId]) env.victimSecret(s);
  const r = { name, phone, patient, segment: segmentId };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/pasien",
    expect: "filtered",
    marker: (env) => latest.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victim(env);
      const body = await as(env, env.actor.tenantId, async (db) => ({
        byName: await searchPatients(db, v.name),
        byPhone: await searchPatients(db, v.phone.slice(-8)),
        segments: await mySegments(db),
      }));
      return { status: 200, body: JSON.parse(JSON.stringify(body)) };
    },
  },
  {
    kind: "action",
    id: "app/(app)/pasien/_components/actions",
    marker: (env) => latest.get(env.victim.tenantId)?.patient ?? "",
    async run(env) {
      const v = await victim(env);
      const found = await as(env, env.actor.tenantId, (db) => searchPatients(db, v.name));
      const remove = await outcome(as(env, env.actor.tenantId, (db) => deleteSegment(db, crypto.randomUUID(), v.segment)));
      return { attempts: { remove }, body: { remove, found: JSON.parse(JSON.stringify(found)) } };
    },
  },
);
