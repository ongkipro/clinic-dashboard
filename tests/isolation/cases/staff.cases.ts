// UX-3 Staf & Undangan, staff detail and Pengguna & Akses (PR-91), and their actions. The
// pages render listStaff / listInvitations / staffSessions / accessLog in the caller's
// active context; actions call the staff access functions. Each case seeds B's staff and
// invitation, then runs as A's owner: nothing of B comes back and every action on B's
// staff is not found.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { accessLog, endMembership, removeRole, revokeSession, setBranch, setDuty, staffSessions } from "../../../src/modules/org/access/access";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { answerOwnerGrant, assignRole as grantRole, myOwnerGrants } from "../../../src/modules/org/roles/roles";
import { cancelInvite, invite, listInvitations, listStaff } from "../../../src/modules/org/staff/staff";
import { decideCredential, endCredential, listCredentials, recordCredential } from "../../../src/modules/org/licences/licences";
import { defineCases, expectLive, type IsolationEnv } from "../case";

const owners = new Map<string, string>();
// A separate B staff member (finance) for the Owner-grant case: the staff action case ends
// the other victim's membership in its positive control.
const grantees = new Map<string, { acc: string; staffId: string }>();
async function grantee(env: IsolationEnv): Promise<{ acc: string; staffId: string }> {
  const t = env.victim.tenantId;
  const known = grantees.get(t);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('G', $1) returning id`, [`grantee.${t}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId: t, accountId: acc, displayName: `Calon Owner ${t.slice(0, 8)}` });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId: t, staffId, role: "finance" });
  } finally {
    c.release();
  }
  const g = { acc, staffId };
  grantees.set(t, g);
  return g;
}
type Victim = { staffId: string; name: string; email: string; invitationId: string; branchId: string };
const victims = new Map<string, Victim>();

async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Owner', $1) returning id`, [`staff.owner.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  owners.set(tenantId, acc);
  return acc;
}

// `fresh`: a new victim for each run. The staff action case consumes its victim (the positive
// control ends the membership and cancels the invitation), so its negative run needs one B
// itself could still act on (HYG-010 N-1).
async function victimStaff(env: IsolationEnv, fresh = false): Promise<Victim> {
  const t = env.victim.tenantId;
  const known = victims.get(t);
  if (known && !fresh) return known;
  const tag = fresh ? crypto.randomUUID().slice(0, 8) : t.slice(0, 8);
  const name = `Staf Rahasia ${tag}`;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('V', $1) returning id`, [`victim.${tag}.${t}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId: t, accountId: acc, displayName: name });
  const c = await env.owner.connect();
  try {
    // fo_cashier for the branch and role attempts; admin_pusat so B's owner may assign it a
    // duty (staff_duty_set targets Owner or Admin Pusat only; review P1).
    await assignRole(c, { tenantId: t, staffId, role: "fo_cashier" });
    await assignRole(c, { tenantId: t, staffId, role: "admin_pusat" });
  } finally {
    c.release();
  }
  const ctx = await resolveContext(env.app, await ownerOf(env, t), { tenantId: t, actingRole: "owner" });
  const email = `undangan.${tag}@klinik-sintetis.test`;
  const { invitationId } = await withTenantContext(env.app, ctx, (db) => invite(db, { email, name: "Calon Rahasia", roles: ["finance"], branchIds: [] }));
  const branchId = (await env.owner.query(`select id from branches where tenant_id = $1 limit 1`, [t])).rows[0]?.id as string;
  const v = { staffId, name, email, invitationId, branchId };
  if (!fresh || !known) victims.set(t, v);
  env.victimSecret(name);
  env.victimSecret(email);
  env.victimSecret(staffId);
  return v;
}

// B's owner grants Owner to the victim staff (waiting for confirmation); id registered secret.
const grants = new Map<string, string>();
// A fresh grant for every run: the positive control declines its grant (HYG-010 N-1).
async function victimGrant(env: IsolationEnv, staffId: string): Promise<string> {
  const t = env.victim.tenantId;
  const ctx = await resolveContext(env.app, await ownerOf(env, t), { tenantId: t, actingRole: "owner" });
  const r = await withTenantContext(env.app, ctx, (db) => grantRole(db, staffId, "owner"));
  const id = (r as { requestId: string }).requestId;
  grants.set(t, id);
  env.victimSecret(id);
  return id;
}

async function asOwner<T>(env: IsolationEnv, fn: Parameters<typeof withTenantContext>[2] & ((db: never) => Promise<T>)) {
  const ctx = await resolveContext(env.app, await ownerOf(env, env.actor.tenantId), { tenantId: env.actor.tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, fn as never) as Promise<T>;
}

// T-050: a fresh B doctor with a pending STR recorded by B's Admin Pusat for each run. The doctor works at
// a branch of B's own with no facility head (other cases may add one at the shared branch), so B's Owner
// verifies as the fallback in the positive control.
const credentialBranches = new Map<string, string>();
async function credentialBranch(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId;
  const known = credentialBranches.get(t);
  if (known) return known;
  const id = (await env.owner.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'KRDISO', 'Cabang Kredensial Isolasi', 'Asia/Jakarta') returning id`, [t])).rows[0].id as string;
  credentialBranches.set(t, id);
  return id;
}
async function victimCredential(env: IsolationEnv): Promise<{ staffId: string; credentialId: string; number: string }> {
  const t = env.victim.tenantId;
  const tag = crypto.randomUUID().slice(0, 8);
  const mk = async (role: "doctor" | "admin_pusat", name: string) => {
    const acc = (await env.owner.query(`insert into auth_user (name, email) values ('K', $1) returning id`, [`kred.${role}.${tag}.${t}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(env.owner, { tenantId: t, accountId: acc, displayName: name });
    const c = await env.owner.connect();
    try {
      const rid = await assignRole(c, { tenantId: t, staffId, role });
      if (role === "doctor") await c.query(`insert into staff_branches (tenant_id, staff_role_id, staff_id, role, branch_id) values ($1, $2, $3, 'doctor', $4)`, [t, rid, staffId, await credentialBranch(env)]);
    } finally {
      c.release();
    }
    return { acc, staffId };
  };
  const doctor = await mk("doctor", `Dokter Rahasia ${tag}`);
  const ap = await mk("admin_pusat", `Admin Rahasia ${tag}`);
  const number = `STR-RAHASIA-${tag}`;
  const ctx = await resolveContext(env.app, ap.acc, { tenantId: t, actingRole: "admin_pusat" });
  const { credentialId } = await withTenantContext(env.app, ctx, (db) =>
    recordCredential(db, crypto.randomUUID(), doctor.staffId, { kind: "str", number, issuer: "Konsil Kesehatan", profession: "dokter", validFrom: "2024-01-01" }));
  env.victimSecret(number);
  env.victimSecret(credentialId);
  return { staffId: doctor.staffId, credentialId, number };
}
const credentialMarks = new Map<string, string>();

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/staf",
    expect: "filtered",
    marker: (env) => victims.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      await victimStaff(env);
      const body = await asOwner(env, async (db) => ({
        staff: (await listStaff(db)).map((s) => [s.staffId, s.name]),
        invitations: (await listInvitations(db)).map((i) => [i.email, i.name]),
      }));
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/staf/[id]",
    // By-id route (TEN-1): another tenant's staff member is not found (HYG-010 N-3). The page
    // loader (loadStaffDetail) answers not-found when listStaff has no such id.
    expect: "not-found",
    marker: (env) => victims.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimStaff(env);
      return asOwner(env, async (db) => {
        const staff = (await listStaff(db)).find((s) => s.staffId === v.staffId);
        if (!staff) return { status: 404, body: null };
        return { status: 200, body: { name: staff.name, sessions: await refused(staffSessions(db, v.staffId)) } as never };
      });
    },
  },
  {
    kind: "route",
    id: "/pengguna-akses",
    expect: "filtered",
    marker: (env) => victims.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      await victimStaff(env);
      const body = await asOwner(env, async (db) => ({
        staff: (await listStaff(db)).map((s) => s.name),
        log: (await accessLog(db)).map((l) => [l.reason, l.objectId]),
      }));
      return { status: 200, body: body as never };
    },
  },
  {
    kind: "action",
    id: "modules/org/staff/actions",
    marker: (env) => victims.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimStaff(env, true);
      await expectLive(env, "B's staff member and invitation",
        `exists (select 1 from staff s join memberships m on m.tenant_id = s.tenant_id and m.id = s.membership_id where s.id = $1 and (m.effective_to is null or m.effective_to > now()))
         and exists (select 1 from staff_invitations where id = $2 and state = 'pending')
         and exists (select 1 from staff_roles where staff_id = $1 and role = 'admin_pusat')
         and exists (select 1 from staff_roles where staff_id = $1 and role = 'fo_cashier')`, [v.staffId, v.invitationId]);
      // Each action in its own transaction, as a Server Action request would run it. Order:
      // reversible changes first, ending the membership last (it revokes everything after it).
      const attempts = {
        duty: await refused(asOwner(env, (db) => setDuty(db, v.staffId, "it_admin", true))),
        branch: await refused(asOwner(env, (db) => setBranch(db, v.staffId, "fo_cashier", v.branchId, true))),
        role: await refused(asOwner(env, (db) => removeRole(db, v.staffId, "fo_cashier"))),
        revoke: await refused(asOwner(env, (db) => revokeSession(db, v.staffId, null))),
        cancel: await refused(asOwner(env, (db) => cancelInvite(db, v.invitationId))),
        end: await refused(asOwner(env, (db) => endMembership(db, v.staffId))),
      };
      // The caller's own staff list contains the victim only for B (positive control marker).
      const staff = await asOwner(env, async (db) => (await listStaff(db)).map((s) => s.name));
      return { attempts, body: { attempts, staff } };
    },
  },
  {
    // T-050 Kredensial actions (record, decide, end) and the credential reads of /staf and /staf/[id]:
    // A's Owner cannot verify, end, renew or list B's credential; B's Owner (positive control) can.
    kind: "action",
    id: "app/(app)/staf/kredensial-actions",
    marker: (env) => credentialMarks.get(env.victim.tenantId) ?? "",
    async run(env) {
      const v = await victimCredential(env);
      credentialMarks.set(env.victim.tenantId, v.number);
      await expectLive(env, "B's pending credential", `exists (select 1 from staff_credentials where id = $1 and state = 'pending')`, [v.credentialId]);
      const attempts = {
        decide: await refused(asOwner(env, (db) => decideCredential(db, crypto.randomUUID(), v.credentialId, true))),
        end: await refused(asOwner(env, (db) => endCredential(db, crypto.randomUUID(), v.credentialId, "suspended", "Uji isolasi"))),
        renew: await refused(asOwner(env, (db) =>
          recordCredential(db, crypto.randomUUID(), v.staffId, { kind: "str", number: `STR-BARU-${v.number.slice(-8)}`, issuer: "Konsil Kesehatan", profession: "dokter", validFrom: "2025-01-01", replaces: v.credentialId }))),
      };
      const listed = await asOwner(env, async (db) => (await listCredentials(db, [v.staffId])).map((c) => c.number));
      return { attempts, body: { attempts, listed } };
    },
  },
  {
    // Saya › Ganti Peran Owner-grant answer (DEC-031 D7): B's Owner grant to B's staff can be
    // neither answered nor listed by A; the positive control lists it as the victim itself.
    kind: "action",
    id: "modules/org/roles/actions",
    marker: (env) => grants.get(env.victim.tenantId) ?? "",
    async run(env) {
      const g = await grantee(env);
      const id = await victimGrant(env, g.staffId);
      await expectLive(env, "B's Owner grant", `exists (select 1 from role_requests where id = $1 and state = 'awaiting_confirmation')`, [id]);
      // The answering party: in B, the grantee itself (positive control: its decline succeeds and
      // it lists the grant); in A, A's owner (refused: no grant waits for A). A decline creates
      // no Owner, so the grantee stays a plain member for later runs.
      const asGrantee = env.actor.tenantId === env.victim.tenantId;
      const answerAs = <T>(fn: (db: never) => Promise<T>) =>
        asGrantee
          ? resolveContext(env.app, g.acc, { tenantId: env.victim.tenantId, actingRole: "finance" }).then((ctx) => withTenantContext(env.app, ctx, fn as never) as Promise<T>)
          : asOwner<T>(env, fn as never);
      const mine = await answerAs(async (db) => (await myOwnerGrants(db)).map((x) => x.requestId));
      const answer = await answerAs((db) => answerOwnerGrant(db, id, false)).then(
        () => "done",
        (e) => ((e as { code?: string }).code === "P0002" ? "ERR_NOT_FOUND" : Promise.reject(e)),
      );
      return { attempts: { answer }, body: { answer, mine } };
    },
  },
);
