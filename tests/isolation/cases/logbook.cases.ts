// Logbook and Insiden (UX-9 ▸ Logbook, UX-28 ▸ Insiden, PR-82, T-068): every route (/logbook, /keluhan/insiden and its
// detail) and both action modules. Each run seeds in B a fresh device with a schedule, a logbook entry and an incident;
// then runs as the caller's own manager / nurse / facility head: B's rows are absent or not found; every write on B's
// rows is refused. As B's staff (positive control) everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { handleIncident, incidentGet, incidentList, logbookOverview, recordEntry, reportIncident, setSchedule } from "../../../src/modules/safety/safety";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "manager" | "nurse" | "facility_head";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${branchId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
    [`${role}.lgb68.${tenantId}.${branchId.slice(0, 8)}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Logbook ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

let runs = 0;
type Seed = { label: string; device: string; schedule: string; entry: string; incident: string; summary: string };
const latest = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  const label = `Laser Rahasia ${t.slice(0, 8)} ${n}`;
  const device = (await env.owner.query(`insert into branch_devices (tenant_id, branch_id, device_type, label) values ($1, $2, 'laser', $3) returning id`, [t, b, label])).rows[0].id as string;
  const { scheduleId: schedule } = await as(env, t, b, "manager", (db) => setSchedule(db, k(), b, { deviceId: device, kind: "calibration", intervalDays: 180, nextDueOn: today() }));
  const { entryId: entry } = await as(env, t, b, "nurse", (db) => recordEntry(db, k(), b, { kind: "maintenance", performedOn: today(), deviceId: device, result: "ok", performerName: `Teknisi Rahasia ${n}` }));
  const summary = `Insiden rahasia ${t.slice(0, 8)} ${n}`;
  const { incidentId: incident } = await as(env, t, b, "nurse", (db) => reportIncident(db, k(), b, { classification: "knc", occurredAt: new Date().toISOString(), summary, immediateResponse: "Ditangani" }));
  for (const x of [label, device, schedule, entry, incident, summary]) env.victimSecret(x);
  const r = { label, device, schedule, entry, incident, summary };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const idMarker = (k: keyof Seed) => (env: IsolationEnv) => String(latest.get(env.victim.tenantId)?.[k] ?? "");
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const route = (id: string, expect: "filtered" | "not-found", m: (env: IsolationEnv) => string, run: (env: IsolationEnv, v: Seed) => Promise<{ status: number; body: unknown }>) =>
  ({ kind: "route" as const, id, expect, marker: m, async run(env: IsolationEnv) { const v = await victim(env); return run(env, v) as never; } });

export default defineCases(
  route("/logbook", "filtered", idMarker("label"), (env) => asMine(env, "manager", (db) => logbookOverview(db as never, env.actor.branchId, null).then(ok))),
  route("/keluhan/insiden", "filtered", idMarker("summary"), (env) => asMine(env, "facility_head", (db) => incidentList(db as never, env.actor.branchId).then(ok))),
  route("/keluhan/insiden/[id]", "not-found", idMarker("summary"), (env, v) => asMine(env, "facility_head", (db) => incidentGet(db as never, v.incident).then(ok, notFound))),
  {
    kind: "action",
    id: "app/(app)/logbook/actions",
    marker: idMarker("label"),
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const attempts = {
        schedule: await outcome(asMine(env, "manager", (db) => setSchedule(db as never, k(), env.actor.branchId, { deviceId: v.device, kind: "maintenance", intervalDays: 30, nextDueOn: today() }))),
        entry: await outcome(asMine(env, "nurse", (db) => recordEntry(db as never, k(), env.actor.branchId, { kind: "calibration", performedOn: today(), deviceId: v.device, result: "ok", performerName: "Teknisi Lintas" }))),
        correct: await outcome(asMine(env, "nurse", (db) => recordEntry(db as never, k(), env.actor.branchId, { kind: "maintenance", performedOn: today(), deviceId: v.device, result: "ok", performerName: "Teknisi Lintas", corrects: v.entry }))),
      };
      const read = await asMine(env, "manager", (db) => logbookOverview(db as never, env.actor.branchId, null).then((x) => x.devices.find((d) => d.id === v.device)?.label ?? null));
      return { attempts, body: { ...attempts, read } };
    },
  },
  {
    kind: "action",
    id: "app/(app)/keluhan/insiden/actions",
    marker: idMarker("summary"),
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      await expectLive(env, "the victim incident", `select state = 'reported' from clinical_incidents where id = $1`, [v.incident]);
      const attempts = {
        take: await outcome(asMine(env, "facility_head", (db) => handleIncident(db as never, k(), v.incident, { step: "take" }))),
        // reporting at another tenant's branch
        report: await outcome(as(env, env.actor.tenantId, env.actor.branchId, "nurse", (db) => reportIncident(db as never, k(), env.victim.branchId,
          { classification: "kpc", occurredAt: new Date().toISOString(), summary: "Coba lintas", immediateResponse: "Coba lintas" }))),
      };
      const read = await asMine(env, "facility_head", (db) => incidentGet(db as never, v.incident).then((x) => x.summary, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
