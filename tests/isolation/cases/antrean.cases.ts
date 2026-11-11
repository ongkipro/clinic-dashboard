// Antrean and the paired display (PR-71, NAV-8, T-048). The board reads a branch's tickets (queue_board);
// the actions search patients, open a walk-in visit, call, skip, pair and revoke a display; the display
// page reads the feed by its token. Each run seeds in B a fresh secret patient with a waiting ticket, and
// a display. As A's owner: B's board is not found and shows nothing of B; B's patient is never found by
// the search; the walk-in on B's patient, the call and skip on B's ticket and the revoke of B's display are
// refused. As B's owner (positive control) every attempt succeeds. The display page with B's token shows
// B's numbers only to that token: with any other token (A's own display) nothing of B. Synthetic data.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { upsertRoom } from "../../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { callTicket, displayFeed, pairDisplay, queueBoard, revokeDisplay, searchPatients, skipTicket, walkIn } from "../../../src/modules/visits/queue/queue";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const people = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = people.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`owner.ant48.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "owner antrean" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  people.set(tenantId, acc);
  return acc;
}
// Owner acting on its own branch (active branch set: the queue acts on it, plan r1 P1-3).
async function as<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const branch = env.victim.tenantId === tenantId ? env.victim.branchId : env.actor.branchId;
  const ctx = await resolveContext(env.app, await ownerOf(env, tenantId), { tenantId, actingRole: "owner", activeBranchId: branch });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
void assignBranch;

const rooms = new Map<string, string>();
const roomName = (tenantId: string) => `Loket Antrean ${tenantId.slice(0, 8)}`;
async function roomOf(env: IsolationEnv, tenantId: string, branchId: string) {
  const k = `${tenantId}:${branchId}`;
  if (rooms.has(k)) return rooms.get(k)!;
  await as(env, tenantId, (db) => upsertRoom(db, branchId, { name: roomName(tenantId), kind: "consultation" }));
  const id = (await env.owner.query(`select id from rooms where tenant_id = $1 and branch_id = $2 and name = $3`, [tenantId, branchId, roomName(tenantId)])).rows[0].id as string;
  rooms.set(k, id);
  return id;
}

let runs = 0;
const latest = new Map<string, { name: string; patient: string; patient2: string; ticket: string; display: string; token: string; room: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const room = await roomOf(env, t, b);
  const name = `Pasien Rahasia Antrean ${t.slice(0, 8)} ${++runs}`;
  const pt = async (n: string) => (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $3,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, n, b],
  )).rows[0].id as string;
  await ownerOf(env, t);
  const patient = await pt(name);
  const patient2 = await pt(`${name} B`);
  const w = await as(env, t, (db) => walkIn(db, crypto.randomUUID(), patient, null));
  const ticket = (await env.owner.query(`select id from queue_tickets where visit_id = $1`, [w.visitId])).rows[0].id as string;
  // A second ticket, called at seeding: the display shows it (the first stays waiting for the actions).
  const patient3 = await pt(`${name} C`);
  const shown = await as(env, t, (db) => walkIn(db, crypto.randomUUID(), patient3, null));
  const shownTicket = (await env.owner.query(`select id from queue_tickets where visit_id = $1`, [shown.visitId])).rows[0].id as string;
  await as(env, t, (db) => callTicket(db, crypto.randomUUID(), shownTicket, room));
  const d = await as(env, t, (db) => pairDisplay(db, crypto.randomUUID(), null, `TV Iso ${runs}`));
  // Ticket numbers are not secrets (every tenant has A-001); the room name is B's own.
  for (const s of [name, patient, patient2, patient3, ticket, d.displayId, w.visitId, shown.visitId, roomName(t)]) env.victimSecret(s);
  const r = { name, patient, patient2, ticket, display: d.displayId, token: d.token!, room };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";

export default defineCases(
  {
    kind: "route",
    id: "/antrean",
    expect: "not-found",
    marker,
    async run(env) {
      await victim(env);
      return as(env, env.actor.tenantId, (db) => queueBoard(db as never, env.victim.branchId).then(
        (x) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) }),
        (e) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e)),
      ));
    },
  },
  {
    // The display page reads the feed by the token in its path, outside any tenant context. As B (the
    // positive control) B's own token shows B's called number and room; A holds only its own display's
    // token: the page answers with A's branch and nothing of B ("filtered").
    kind: "route",
    id: "/layar-antrean/[token]",
    expect: "filtered",
    marker: (env) => (latest.has(env.victim.tenantId) ? roomName(env.victim.tenantId) : ""),
    async run(env) {
      const v = await victim(env);
      const token = env.actor.tenantId === env.victim.tenantId
        ? v.token
        : (await as(env, env.actor.tenantId, (db) => pairDisplay(db, crypto.randomUUID(), null, `TV Aktor ${runs}`))).token!;
      const feed = await displayFeed(env.app, token);
      return { status: 200, body: (feed ?? null) as never };
    },
  },
  {
    kind: "action",
    id: "app/(app)/antrean/actions",
    // Only the positive control finds B's patient by name, so the search result carries the marker.
    marker: (env) => latest.get(env.victim.tenantId)?.patient2 ?? "",
    async run(env) {
      const v = await victim(env);
      const me = env.actor.tenantId;
      const found = await as(env, me, (db) => searchPatients(db, `${v.name} B`));
      const walk = await outcome(as(env, me, (db) => walkIn(db, crypto.randomUUID(), v.patient2, null)));
      const call = await outcome(as(env, me, (db) => callTicket(db, crypto.randomUUID(), v.ticket, v.room)));
      const skip = await outcome(as(env, me, (db) => skipTicket(db, crypto.randomUUID(), v.ticket)));
      const revoke = await outcome(as(env, me, (db) => revokeDisplay(db, crypto.randomUUID(), v.display)));
      return { attempts: { walk, call, skip, revoke }, body: { found: found.map((f) => f.id), walk, call, skip, revoke } };
    },
  },
);
