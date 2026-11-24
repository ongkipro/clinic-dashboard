// DEL-2 tenant isolation cases for UX-30 ▸ Permintaan (PR-50; T-121, migration 0134).
// Verifies cross-tenant refusal on /privasi/permintaan, /privasi/permintaan/[id], and all write actions.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { closeDsr, getDsr, listDsrs, logDsr, verifyDsrIdentity } from "../../../src/modules/privacy/requests";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const owners = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`owner.dsr121.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "owner dsr" });
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
const latest = new Map<string, { dsrId: string; mrn: string }>();

async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const branch = (await env.owner.query<{ id: string }>(`select id from branches where tenant_id = $1 limit 1`, [t])).rows[0].id;
  const staff = (await env.owner.query<{ id: string }>(`select id from staff where tenant_id = $1 limit 1`, [t])).rows[0].id;
  const mrn = `RM-${String(800000 + ++runs).padStart(6, "0")}`;
  const patientId = (
    await env.owner.query<{ id: string }>(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, $2, 'Pasien Isolasi DSR', '1990-01-01', 'female', 'newborn_via_guardian', 'Sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
      [t, mrn, branch, staff],
    )
  ).rows[0].id;
  const { id: dsrId } = await as(env, t, (db) =>
    logDsr(db, crypto.randomUUID(), {
      patientId,
      requester: "patient",
      right: "access",
      channel: "in_person",
      receivedAt: new Date(Date.now() - 60_000),
    }),
  );
  for (const s of [dsrId, mrn]) env.victimSecret(s);
  const r = { dsrId, mrn };
  latest.set(t, r);
  return r;
}

const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/privasi/permintaan",
    expect: "filtered",
    marker: (env) => latest.get(env.victim.tenantId)?.mrn ?? "",
    async run(env) {
      await victim(env);
      return { status: 200, body: JSON.parse(JSON.stringify(await as(env, env.actor.tenantId, (db) => listDsrs(db, { state: "all" })))) };
    },
  },
  {
    kind: "route",
    id: "/privasi/permintaan/[id]",
    expect: "not-found",
    marker: (env) => latest.get(env.victim.tenantId)?.dsrId ?? "",
    async run(env) {
      const v = await victim(env);
      return as(env, env.actor.tenantId, (db) =>
        getDsr(db, v.dsrId).then(
          (d) => ({ status: 200, body: JSON.parse(JSON.stringify(d)) }),
          (e) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e)),
        ),
      );
    },
  },
  {
    kind: "action",
    id: "app/(app)/privasi/permintaan/actions",
    marker: (env) => latest.get(env.victim.tenantId)?.dsrId ?? "",
    async run(env) {
      const v = await victim(env);
      const me = env.actor.tenantId;
      const verify = await outcome(as(env, me, (db) => verifyDsrIdentity(db, v.dsrId, "ktp_in_person")));
      const close = await outcome(
        as(env, me, (db) =>
          closeDsr(db, v.dsrId, {
            outcome: "withdrawn",
            basisCode: "withdrawn_by_requester",
            withdrawalSource: "in_person",
            withdrawalAttestation: "Pembatalan isolasi lintas tenant",
          }),
        ),
      );
      return { attempts: { verify, close }, body: { verify, close, dsrId: verify === "done" ? v.dsrId : null } };
    },
  },
);
