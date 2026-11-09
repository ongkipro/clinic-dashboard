// T-048 Done-when: scenario PR-71 (a patient without a booking: a walk-in visit with the next number of
// the day); the TV payload contains no patient name; scenario PR-84 (switching the active branch shows that
// branch's queue and actions record it). Plus the plan review: numbering per branch per day under
// concurrency, every check-in numbered, done at close, call/skip/re-call with an active room, the active
// branch rule, the search for the four board roles, pairing (token never stored), the feed outside any
// context (SET-40, revoked, lifecycle, other branches), guards, grants, tenancy, and the drift of the two
// re-created visit functions.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { setRoomActive, setServices, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { changeSetting } from "../../src/modules/settings/settings";
import { callTicket, displayFeed, pairDisplay, queueBoard, revokeDisplay, searchPatients, skipTicket, walkIn } from "../../src/modules/visits/queue/queue";
import { checkIn, closeVisit } from "../../src/modules/visits/visits";
import { createHarness, type Harness } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Antrean Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> { // the first branch is active
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`que${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Antrean ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();

async function patient(t: T, name = "Pasien Antrean"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}

let A: T;
let B: T;
let OWN: P; let FH: P; let MGR: P; let MGR12: P; let FO: P; let FO2: P; let CS: P; let DOC: P; let FIN: P; let BFO: P;
let consult: { itemId: string; versionId: string };
let room1: string;
let room2: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); MGR = await person(A, "manager", A.b1); MGR12 = await person(A, "manager", A.b1, A.b2);
  FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2); CS = await person(A, "central_cs");
  DOC = await person(A, "doctor", A.b1); FIN = await person(A, "finance"); BFO = await person(B, "fo_cashier", B.b1);
  await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Konsul 1", kind: "consultation" }));
  await as(OWN, (db) => upsertRoom(db, A.b2, { name: "Konsul B2", kind: "consultation" }));
  room1 = (await h.admin.query(`select id from rooms where branch_id = $1 and name = 'Konsul 1'`, [A.b1])).rows[0].id;
  room2 = (await h.admin.query(`select id from rooms where branch_id = $1 and name = 'Konsul B2'`, [A.b2])).rows[0].id;
  const v = await as(OWN, (db) => publish(db, { kind: "service", code: "KONSUL" }, {
    name: "Konsultasi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 150_000, category: "consultation",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "I", contraindications: "K", consent_template: "T", delegation: "Dokter",
    aftercare_text: "A", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }],
  } as never, "Layanan baru"));
  if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
  await as(OWN, (db) => setServices(db, A.b1, [v.itemId]));
  consult = { itemId: v.itemId, versionId: v.versionId };
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

const slotNow = () => new Date(Math.floor(Date.now() / 900_000) * 900_000);
// A booked appointment of now with a fresh performer (a fixture; booking refuses the past).
async function appt(t: T, pt: string, branch = t.b1): Promise<string> {
  const d = await person(t, "doctor", branch);
  const s = slotNow();
  await h.admin.query(`alter table appointments disable trigger appointments_guard`);
  try {
    return (await h.admin.query(
      `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
       values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
      [t.tenantId, branch, pt, consult.versionId, d.staffId, s, new Date(s.getTime() + 30 * 60_000)],
    )).rows[0].id as string;
  } finally {
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
  }
}
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const ticketOf = async (visit: string) => (await h.admin.query(`select * from queue_tickets where visit_id = $1`, [visit])).rows[0];
// A fresh branch with its own queue (numbers start at one).
async function branch(t: T, code: string) {
  return (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [t.tenantId, code])).rows[0].id as string;
}

describe("scenario PR-71: walk-in with the next number of the day", () => {
  it("a patient without a booking gets a walk-in visit numbered A-001, the next A-002; booked check-ins are numbered too", async () => {
    const b = await branch(A, "WALK1");
    const fo = await person(A, "fo_cashier", b);
    const first = await patient(A, "Pasien Jalan Satu");
    const one = await as(fo, (db) => walkIn(db, key(), first, null));
    expect(one.number).toBe("A-001");
    const v = (await h.admin.query(`select kind, appointment_id, branch_id from visits where id = $1`, [one.visitId])).rows[0];
    expect(v).toMatchObject({ kind: "walk_in", appointment_id: null, branch_id: b });
    const two = await as(fo, async (db) => walkIn(db, key(), await patient(A, "Pasien Jalan Dua"), null));
    expect(two.number).toBe("A-002");
    const pt = await patient(A, "Pasien Janji");
    const ap = await appt(A, pt, b);
    const booked = await as(fo, (db) => checkIn(db, key(), ap));
    expect((await ticketOf(booked.visitId)).seq).toBe(3);
    const board = await as(fo, (db) => queueBoard(db, null));
    expect(board.tickets.map((t) => t.number)).toEqual(["A-001", "A-002", "A-003"]);
    expect(board.tickets.map((t) => t.kind)).toEqual(["walk_in", "walk_in", "booked"]);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1`, [one.visitId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["VisitCheckedIn"]);
    expect(Object.keys(ev[0].payload).sort()).toEqual(["branch_id", "patient_id", "visit_id"]);
  });

  it("numbers are per branch, unique under concurrent issue, and use the branch prefix (SET-40)", async () => {
    const b = await branch(A, "WALK2");
    const mgr = await person(A, "manager", b);
    await as(mgr, (db) => changeSetting(db, { key: "SET-40", branchId: b, value: { prefiks_loket: "K", prefiks_ruang: "R", suara: true, orientasi: "portrait" }, reason: "Prefiks cabang" }));
    const fo = await person(A, "fo_cashier", b);
    const pts = await Promise.all([1, 2, 3, 4, 5].map((i) => patient(A, `Pasien Serentak ${i}`)));
    const got = await Promise.all(pts.map((p) => as(fo, (db) => walkIn(db, key(), p, null))));
    expect(got.map((g) => g.number).sort()).toEqual(["K-001", "K-002", "K-003", "K-004", "K-005"]);
    // Another branch starts its own day at one.
    const other = await branch(A, "WALK3");
    const fo3 = await person(A, "fo_cashier", other);
    expect((await as(fo3, async (db) => walkIn(db, key(), await patient(A), null))).number).toBe("A-001");
  });

  it("one open visit per patient; replay returns the same visit and number; refusals", async () => {
    const b = await branch(A, "WALK4");
    const fo = await person(A, "fo_cashier", b);
    const pt = await patient(A);
    const k = key();
    const one = await as(fo, (db) => walkIn(db, k, pt, null));
    expect(await as(fo, (db) => walkIn(db, k, pt, null))).toEqual({ ...one, replayed: true });
    expect(await reason(as(fo, (db) => walkIn(db, key(), pt, null)))).toBe("ERR_VERSION_CONFLICT:already_open");
    expect(await reason(as(fo, (db) => walkIn(db, key(), crypto.randomUUID(), null)))).toBe("ERR_NOT_FOUND:patient not found");
    for (const p of [CS, DOC, FIN]) {
      expect(await code(as(p, async (db) => walkIn(db, key(), await patient(A), A.b1))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => queueBoard(db, A.b1))), `${p.role} board`).toBe("ERR_FORBIDDEN");
    }
    // Owner on "Semua Cabang" must name the branch.
    expect(await reason(as(OWN, async (db) => walkIn(db, key(), await patient(A), null)))).toBe("ERR_NOT_FOUND:branch not found");
    expect((await as(OWN, async (db) => walkIn(db, key(), await patient(A), b))).number).toBe("A-002");
  });
});

describe("calling the queue", () => {
  it("call to an active room, re-call to another room (Pindah), skip, call after skip; done at close; a done ticket is final", async () => {
    const pt = await patient(A);
    const w = await as(FO, (db) => walkIn(db, key(), pt, null));
    const t = await ticketOf(w.visitId);
    await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Konsul 2", kind: "consultation" }));
    const roomB = (await h.admin.query(`select id from rooms where branch_id = $1 and name = 'Konsul 2'`, [A.b1])).rows[0].id;
    await as(FO, (db) => callTicket(db, key(), t.id, room1));
    expect(await ticketOf(w.visitId)).toMatchObject({ state: "called", room_id: room1, called_by: FO.staffId });
    await as(FO, (db) => callTicket(db, key(), t.id, roomB));
    expect((await ticketOf(w.visitId)).room_id).toBe(roomB);
    await as(FO, (db) => skipTicket(db, key(), t.id));
    expect((await ticketOf(w.visitId)).state).toBe("skipped");
    expect(await reason(as(FO, (db) => skipTicket(db, key(), t.id)))).toBe("ERR_VERSION_CONFLICT:already_skipped");
    await as(FO, (db) => callTicket(db, key(), t.id, room1));
    expect(await reason(as(FO, (db) => callTicket(db, key(), t.id, room2)))).toBe("ERR_NOT_FOUND:room not found"); // another branch's room
    await as(OWN, (db) => setRoomActive(db, roomB, false));
    expect(await reason(as(FO, (db) => callTicket(db, key(), t.id, roomB)))).toBe("ERR_NOT_FOUND:room not found"); // an inactive room
    await as(FO, (db) => closeVisit(db, key(), w.visitId));
    expect((await ticketOf(w.visitId)).state).toBe("done");
    expect(await reason(as(FO, (db) => callTicket(db, key(), t.id, room1)))).toBe("ERR_VERSION_CONFLICT:ticket_done");
    const au = (await h.admin.query(`select reason_code from audit_events where object_id = $1 order by seq`, [t.id])).rows.map((r) => r.reason_code);
    expect(au).toEqual(["queue_called", "queue_called", "queue_skipped", "queue_called"]);
  });

  it("scenario PR-84: a manager of B1 and B2 switching to B2 sees B2's queue and acts on B2 only", async () => {
    const p1 = await patient(A, "Pasien Cabang Satu");
    const p2 = await patient(A, "Pasien Cabang Dua");
    const w1 = await as(MGR12, (db) => walkIn(db, key(), p1, null), A.b1);
    const w2 = await as(MGR12, (db) => walkIn(db, key(), p2, null), A.b2);
    expect((await h.admin.query(`select branch_id from visits where id = $1`, [w2.visitId])).rows[0].branch_id).toBe(A.b2);
    expect((await ticketOf(w2.visitId)).branch_id).toBe(A.b2);
    const au = (await h.admin.query(`select branch_id from audit_events where object_id = $1`, [w2.visitId])).rows;
    expect(au.map((r) => r.branch_id)).toEqual([A.b2]);
    const onB2 = await as(MGR12, (db) => queueBoard(db, null), A.b2);
    expect(onB2.branchId).toBe(A.b2);
    expect(onB2.tickets.map((t) => t.patientName)).toContain("Pasien Cabang Dua");
    expect(onB2.tickets.map((t) => t.patientName)).not.toContain("Pasien Cabang Satu");
    // With B2 active, B1 is not found: neither its board nor its tickets.
    expect(await code(as(MGR12, (db) => queueBoard(db, A.b1), A.b2))).toBe("ERR_NOT_FOUND");
    const t1 = await ticketOf(w1.visitId);
    expect(await code(as(MGR12, (db) => callTicket(db, key(), t1.id, room1), A.b2))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR12, (db) => walkIn(db, key(), p2, A.b1), A.b2))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO2, (db) => queueBoard(db, A.b1)))).toBe("ERR_NOT_FOUND");
  });
});

describe("the walk-in search", () => {
  it("the four board roles search by name, MRN or phone digits; at most 20; masked phone; others refused", async () => {
    const pt = await patient(A, "Zaskia Unik Cari");
    await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', '+6281299887766')`, [A.tenantId, pt]);
    const mrn = (await h.admin.query(`select mrn from patients where id = $1`, [pt])).rows[0].mrn;
    for (const p of [FO, MGR, OWN]) {
      const byName = await as(p, (db) => searchPatients(db, "zaskia unik"));
      expect(byName.map((x) => x.id), p.role).toEqual([pt]);
      expect(byName[0].maskedPhone, p.role).toBe("+62•••••••7766");
      expect(Object.keys(byName[0]).sort()).toEqual(["birthYear", "fullName", "id", "maskedPhone", "mrn"]);
    }
    expect((await as(FO, (db) => searchPatients(db, mrn.toLowerCase()))).map((x) => x.id)).toEqual([pt]);
    expect((await as(FO, (db) => searchPatients(db, "0812-9988-7766"))).map((x) => x.id)).toEqual([pt]);
    expect((await as(FO, (db) => searchPatients(db, "%%"))).length).toBe(0); // a wildcard is literal
    expect(await code(as(FO, (db) => searchPatients(db, "z")))).toBe("ERR_INVALID_INPUT"); // two characters at least
    for (let i = 0; i < 22; i++) await patient(A, `Banyak Sekali ${i}`);
    expect((await as(FO, (db) => searchPatients(db, "banyak sekali"))).length).toBe(20);
    for (const p of [CS, DOC, FIN]) expect(await code(as(p, (db) => searchPatients(db, "zaskia"))), p.role).toBe("ERR_FORBIDDEN");
    expect(await as(BFO, (db) => searchPatients(db, "zaskia"))).toEqual([]);
  });
});

describe("the paired TV display: no patient name, ever", () => {
  it("pairing stores only the hash; the feed has numbers and rooms only; SET-40 applies; revoked and unknown get null", async () => {
    const b = await branch(A, "TV1");
    await as(OWN, (db) => upsertRoom(db, b, { name: "Ruang TV", kind: "consultation" }));
    const room = (await h.admin.query(`select id from rooms where branch_id = $1`, [b])).rows[0].id;
    const mgr = await person(A, "manager", b);
    const fo = await person(A, "fo_cashier", b);
    const k = key();
    const paired = await as(mgr, (db) => pairDisplay(db, k, null, "TV Lobi"));
    expect(paired.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const replay = await as(mgr, (db) => pairDisplay(db, k, null, "TV Lobi"));
    expect(replay).toMatchObject({ displayId: paired.displayId, token: null, replayed: true });
    const stored = JSON.stringify((await h.admin.query(`select * from queue_displays where id = $1`, [paired.displayId])).rows)
      + JSON.stringify((await h.admin.query(`select result from idempotency_records where key = $1`, [k])).rows);
    expect(stored).not.toContain(paired.token!);
    const names = ["Pasien Layar Rahasia Satu", "Pasien Layar Rahasia Dua", "Pasien Layar Rahasia Tiga"];
    const ws = [];
    for (const n of names) ws.push(await as(fo, async (db) => walkIn(db, key(), await patient(A, n), null)));
    const t1 = await ticketOf(ws[0].visitId);
    await as(fo, (db) => callTicket(db, key(), t1.id, room));
    // Another branch's queue never appears.
    await as(FO, async (db) => walkIn(db, key(), await patient(A, "Pasien Cabang Lain"), null));
    const feed = await displayFeed(app, paired.token!);
    expect(feed).toMatchObject({ orientation: "landscape", voice: false, current: [{ number: "A-001", room: "Ruang TV" }], next: ["A-002", "A-003"] });
    const text = JSON.stringify(feed);
    for (const n of [...names, "Pasien Cabang Lain"]) expect(text).not.toContain(n);
    const ids = (await h.admin.query(`select v.patient_id, p.mrn from visits v join patients p on p.id = v.patient_id where v.branch_id = $1`, [b])).rows;
    for (const r of ids) {
      expect(text).not.toContain(r.patient_id);
      expect(text).not.toContain(r.mrn);
    }
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no id of any kind
    // SET-40 of the display's branch, read outside any tenant context.
    await as(mgr, (db) => changeSetting(db, { key: "SET-40", branchId: b, value: { prefiks_loket: "A", prefiks_ruang: "B", suara: true, orientasi: "portrait" }, reason: "Layar tegak" }));
    expect(await displayFeed(app, paired.token!)).toMatchObject({ orientation: "portrait", voice: true });
    // A suspended tenant keeps its display; an exiting one does not.
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [A.tenantId]);
    try {
      expect(await displayFeed(app, paired.token!)).not.toBeNull();
      await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [A.tenantId]);
      expect(await displayFeed(app, paired.token!)).toBeNull();
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
    await as(mgr, (db) => revokeDisplay(db, key(), paired.displayId));
    expect(await displayFeed(app, paired.token!)).toBeNull();
    expect(await reason(as(mgr, (db) => revokeDisplay(db, key(), paired.displayId)))).toBe("ERR_VERSION_CONFLICT:already_revoked");
    expect(await displayFeed(app, "x".repeat(43))).toBeNull();
    expect(await displayFeed(app, "bukan token")).toBeNull();
  });

  it("pairing and revoking: manager, Owner and Admin Pusat only; another branch not found; the hash is not readable", async () => {
    expect(await code(as(FO, (db) => pairDisplay(db, key(), null, "TV FO")))).toBe("ERR_FORBIDDEN");
    const d = await as(MGR, (db) => pairDisplay(db, key(), null, "TV Satu"));
    expect(await code(as(FO2, (db) => revokeDisplay(db, key(), d.displayId)))).toBe("ERR_FORBIDDEN");
    const mgr2 = await person(A, "manager", A.b2);
    expect(await code(as(mgr2, (db) => revokeDisplay(db, key(), d.displayId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => revokeDisplay(db, key(), d.displayId)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => db.query(`select token_hash from queue_displays where id = $1`, [d.displayId])))).toBe("raw:42501");
    expect((await as(MGR, (db) => db.query(`select label from queue_displays where id = $1`, [d.displayId]))).rows).toEqual([{ label: "TV Satu" }]);
  });
});

describe("guards, grants, tenancy and drift", () => {
  it("clinic_app cannot write tickets or displays; guards keep numbers, finality and no delete", async () => {
    const w = await as(FO, async (db) => walkIn(db, key(), await patient(A), null));
    const t = await ticketOf(w.visitId);
    expect(await code(as(FO, (db) => db.query(`update queue_tickets set seq = 99 where id = $1`, [t.id])))).toBe("raw:42501");
    const err = (q: Promise<unknown>) => q.then(() => "ok", (e) => e.message as string);
    expect(await err(h.admin.query(`delete from queue_tickets where id = $1`, [t.id]))).toMatch(/never deleted/);
    expect(await err(h.admin.query(`update queue_tickets set seq = 99 where id = $1`, [t.id]))).toMatch(/keeps its number/);
    expect(await err(h.admin.query(`update queue_tickets set state = 'done' where id = $1`, [t.id]))).toBe("ok");
    expect(await err(h.admin.query(`update queue_tickets set state = 'waiting' where id = $1`, [t.id]))).toMatch(/done ticket is final/);
    expect(await err(h.admin.query(`insert into queue_tickets (tenant_id, branch_id, queue_date, seq, prefix, visit_id, state) values ($1, $2, current_date, 900, 'A', $3, 'called')`,
      [A.tenantId, A.b1, w.visitId]))).not.toBe("ok");
    const d = await as(MGR, (db) => pairDisplay(db, key(), null, "TV Guard"));
    expect(await err(h.admin.query(`delete from queue_displays where id = $1`, [d.displayId]))).toMatch(/never deleted/);
    expect(await err(h.admin.query(`update queue_displays set token_hash = repeat('a', 64) where id = $1`, [d.displayId]))).toMatch(/keeps its branch/);
    expect(await err(h.admin.query(`truncate queue_tickets cascade`))).not.toBe("ok");
  });

  it("tenant B neither reads A's queue nor calls A's tickets; A's board shows nothing of B", async () => {
    const w = await as(FO, async (db) => walkIn(db, key(), await patient(A, "Pasien Rahasia A"), null));
    const t = await ticketOf(w.visitId);
    expect(await code(as(BFO, (db) => queueBoard(db, A.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => callTicket(db, key(), t.id, room1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => skipTicket(db, key(), t.id)))).toBe("ERR_NOT_FOUND");
    const aPatient = (await h.admin.query(`select patient_id from visits where id = $1`, [w.visitId])).rows[0].patient_id as string;
    expect(await code(as(BFO, (db) => walkIn(db, key(), aPatient, null)))).toBe("ERR_NOT_FOUND");
    expect((await as(BFO, (db) => db.query(`select id from queue_tickets where id = $1`, [t.id]))).rows).toEqual([]);
    const bBoard = await as(BFO, (db) => queueBoard(db, null));
    expect(JSON.stringify(bBoard)).not.toContain("Pasien Rahasia A");
  });

  it("drift: in 0064, visit_check_in and visit_close are their 0063 definitions plus one line each", async () => {
    // Migration text to migration text: later migrations may patch these functions again (T-042 did), so
    // the live definition is not 0064's.
    const text = (f: string) => readFileSync(join(import.meta.dirname, `../../drizzle/${f}`), "utf8");
    const body = (mig: string, name: string) => {
      const m = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$\\n([\\s\\S]*?)\\n\\$\\$;`).exec(mig);
      return m![1].split("\n");
    };
    const before = (name: string) => body(text("0063_visits.sql"), name);
    const after = (name: string) => body(text("0064_queue.sql"), name);
    // Removing the one added line from the new body must give the 0063 body exactly (order kept).
    const added = (before: string[], after: string[]) => {
      const extra = after.filter((l) => !before.includes(l));
      return { removed: before.filter((l) => !after.includes(l)), extra, same: after.filter((l) => !extra.includes(l)).join("\n") === before.join("\n") };
    };
    const ci = added(before("visit_check_in"), after("visit_check_in"));
    expect(ci.removed).toEqual([]);
    expect(ci.extra).toEqual(["  PERFORM public.queue_issue(v); -- T-048: every check-in gets the next number of the day"]);
    expect(ci.same).toBe(true);
    const cl = added(before("visit_close"), after("visit_close"));
    expect(cl.removed).toEqual([]);
    expect(cl.extra).toEqual(["  UPDATE public.queue_tickets SET state = 'done' WHERE tenant_id = v.tenant_id AND visit_id = v.id AND state <> 'done'; -- T-048"]);
    expect(cl.same).toBe(true);
  });

  it("production with go-live blockers refuses walk-in, call, skip and pairing before anything changes (ARCH-10)", async () => {
    const pt = await patient(A);
    const w = await as(FO, (db) => walkIn(db, key(), pt, null));
    const t = await ticketOf(w.visitId);
    const other = await patient(A);
    process.env.DEPLOY_ENV = "production";
    try {
      await expect(as(FO, (db) => walkIn(db, key(), other, null))).rejects.toThrow(/go-live blocked/);
      await expect(as(FO, (db) => callTicket(db, key(), t.id, room1))).rejects.toThrow(/go-live blocked/);
      await expect(as(FO, (db) => skipTicket(db, key(), t.id))).rejects.toThrow(/go-live blocked/);
      await expect(as(MGR, (db) => pairDisplay(db, key(), null, "TV Prod"))).rejects.toThrow(/go-live blocked/);
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
    expect((await ticketOf(w.visitId)).state).toBe("waiting");
    expect(Number((await h.admin.query(`select count(*) from visits where patient_id = $1`, [other])).rows[0].count)).toBe(0);
  });
});

