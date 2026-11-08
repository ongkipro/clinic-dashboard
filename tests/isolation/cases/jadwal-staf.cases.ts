// Jadwal Staf (UX-33, PR-48, T-043): the page renders a branch's week (shifts, leave, hours) and the
// actions save the week, add and cancel leave. Each case seeds in B a doctor with a shift and a leave
// (secret reason), then runs as A's owner: none of B's rows appear; B's branch is not found; every write
// onto B's branch or leave is refused; availability on B's branch is false.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { setHours } from "../../../src/modules/org/branches/branches";
import { addLeave, branchLeave, cancelLeave, isStaffAvailable, rosterWindow, setWeek, weekShifts } from "../../../src/modules/scheduling/rosters/rosters";
import { defineCases, type IsolationEnv } from "../case";

const owners = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`owner.jdw.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "owner jadwal" });
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
const day = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jayapura" }).format(new Date(Date.now() + n * 86_400_000));
const monday = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

const plusDay = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

const seeded = new Map<string, { doctor: string; leave: string; reason: string; week: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`doc.jdw.${t}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId: t, accountId: acc, displayName: `Dokter Rahasia ${t.slice(0, 8)}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId: t, staffId, role: "doctor" });
    await assignBranch(c, { tenantId: t, staffRoleId: rid, branchId: env.victim.branchId });
  } finally {
    c.release();
  }
  const week = monday(day(14));
  const reason = `Cuti rahasia ${t.slice(0, 8)}`;
  // Open every day, so availability on B's branch answers true for B itself (the positive control).
  await as(env, t, (db) => setHours(db, env.victim.branchId, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "07:00", closes: "22:00" }))));
  await as(env, t, (db) => setWeek(db, env.victim.branchId, week, [staffId], [{ staffId, date: week, starts: "09:00", ends: "17:00", kind: "work" }, { staffId, date: plusDay(week), starts: "09:00", ends: "17:00", kind: "work" }]));
  const leave = await as(env, t, (db) => addLeave(db, { branchId: env.victim.branchId, staffId, kind: "sick", from: week, to: week, reason }));
  for (const s of [staffId, leave, reason]) env.victimSecret(s);
  const v = { doctor: staffId, leave, reason, week };
  seeded.set(t, v);
  return v;
}
const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/jadwal-staf",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.reason ?? "",
    async run(env) {
      const v = await victim(env);
      const b = env.victim.branchId;
      const body = await as(env, env.actor.tenantId, async (db) => ({
        shifts: await weekShifts(db as never, b, v.week),
        leave: await branchLeave(db as never, b, v.week, v.week),
        all: (await (db as { query: (q: string) => Promise<{ rows: unknown[] }> }).query(`select * from staff_leave`)).rows,
      }));
      return { status: 200, body: JSON.parse(JSON.stringify(body)) };
    },
  },
  {
    kind: "action",
    id: "app/(app)/jadwal-staf/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.leave ?? "",
    async run(env) {
      const v = await victim(env);
      const b = env.victim.branchId;
      const me = env.actor.tenantId;
      // Availability first: the week attempt below replaces B's shifts in the positive control.
      const avail = await as(env, me, (db) => isStaffAvailable(db, { staffId: v.doctor, branchId: b, from: new Date(`${plusDay(v.week)}T10:00:00+07:00`), until: new Date(`${plusDay(v.week)}T11:00:00+07:00`) }));
      const week = await refused(as(env, me, (db) => setWeek(db, b, v.week, [v.doctor], [])));
      const add = await refused(as(env, me, (db) => addLeave(db, { branchId: b, staffId: v.doctor, kind: "leave", from: v.week, to: v.week, reason: "Uji isolasi" })));
      const cancel = await refused(as(env, me, (db) => cancelLeave(db, v.leave, "Uji isolasi")));
      const window = await refused(as(env, me, (db) => rosterWindow(db, b, v.week, v.week)));
      const attempts = { week, add, cancel, window, avail: avail ? "done" : "ERR_NOT_FOUND" };
      return { attempts, body: { ...attempts, leave: cancel === "done" ? v.leave : null } };
    },
  },
);
