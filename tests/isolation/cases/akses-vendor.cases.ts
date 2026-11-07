// Saya › Akses Vendor (UX-48, PR-60): the page reads support_sessions_for_owner,
// support_session_reads_for_owner and vendor_dual_identities in the caller's active context; the
// actions decide a session's scope, end a session and decide a dual identity. Each case seeds a
// support session in B (pending approval, with a secret purpose) and a read of it, then runs as A's
// owner: none of B's sessions or reads come back, B's session log is not found, and every decision on
// B's session is refused (attempts, HYG-010). HYG-013 adds the revoke of B's effective dual identity.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { decideScope, sessionLog, sessionsForOwner } from "../../../src/modules/vendor/support/scope";
import { endSessionAsOwner } from "../../../src/modules/vendor/support/support";
import { vendorDualIdentities, vendorDualIdentityClinicDecide, vendorDualIdentityClinicRevoke } from "../../../src/modules/vendor/staff/staff";
import { defineCases, expectLive, type IsolationEnv } from "../case";

const owners = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('O', $1) returning id`, [`owner.av.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner AV" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  owners.set(tenantId, acc);
  return acc;
}
async function asOwner<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  const ctx = await resolveContext(env.app, await ownerOf(env, tenantId), { tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

// A vendor operator (platform table) seeded once; sessions are platform rows seeded by the owner pool.
let operator: string | null = null;
async function vendorOperator(env: IsolationEnv): Promise<string> {
  if (operator) return operator;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Petugas', 'petugas.av@vendor-sintetis.test', true) returning id`)).rows[0].id as string;
  operator = (await env.owner.query(`insert into vendor_staff (account_id, display_name, state) values ($1, 'Petugas Rahasia AV', 'active') returning id`, [acc])).rows[0].id as string;
  return operator;
}

// A fresh pending session in B for every run (the positive control decides it) plus one recorded read.
const seeded = new Map<string, { id: string; purpose: string }>();
async function victimSession(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const op = await vendorOperator(env);
  const purpose = `Tujuan rahasia ${crypto.randomUUID().slice(0, 8)}`;
  const id = (await env.owner.query(
    `insert into support_sessions (tenant_id, opened_by, purpose, scope, minutes, state, requested_at)
     values ($1, $2, $3, array['public.staff'], 30, 'pending_approval', now()) returning id`, [t, op, purpose])).rows[0].id as string;
  await env.owner.query(`insert into support_session_reads (session_id, table_name, row_id, first_read_at) values ($1, 'public.staff', $2, now())`, [id, crypto.randomUUID()]);
  env.victimSecret(purpose);
  env.victimSecret(id);
  const v = { id, purpose };
  seeded.set(t, v);
  return v;
}

// A fresh dual-identity request in B for every run (the positive control decides its clinic half): a
// vendor account that is also to be B's staff, requested by the operator, waiting for B's Owner.
const duals = new Map<string, string>();
async function victimDual(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId;
  const op = await vendorOperator(env);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Ganda', $1) returning id`, [`ganda.${crypto.randomUUID().slice(0, 8)}@vendor-sintetis.test`])).rows[0].id as string;
  const id = (await env.owner.query(
    `insert into vendor_requests (kind, tenant_id, payload, reason, requested_by, requested_as)
     values ('dual_identity', $1, jsonb_build_object('account_id', $2::text), 'Identitas ganda rahasia untuk uji', $3, 'support') returning id`, [t, acc, op])).rows[0].id as string;
  env.victimSecret(id);
  env.victimSecret(acc);
  duals.set(t, id);
  return id;
}

// HYG-013: a fresh effective dual identity in B for every run (approved by a platform owner and B's
// Owner, the subject a member of B), so B's own run can revoke it and A's attempt meets a live one.
let platformOwner: string | null = null;
async function victimEffectiveDual(env: IsolationEnv): Promise<{ id: string; subject: string }> {
  const t = env.victim.tenantId;
  const op = await vendorOperator(env);
  if (!platformOwner) {
    const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('PP', 'pp.av@vendor-sintetis.test', true) returning id`)).rows[0].id as string;
    platformOwner = (await env.owner.query(`insert into vendor_staff (account_id, display_name, state) values ($1, 'Pemilik Platform AV', 'active') returning id`, [acc])).rows[0].id as string;
  }
  const ownerAcc = await ownerOf(env, t);
  const ownerStaff = (await env.owner.query(`select s.id from staff s join memberships m on m.tenant_id = s.tenant_id and m.id = s.membership_id where m.tenant_id = $1 and m.account_id = $2`, [t, ownerAcc])).rows[0].id as string;
  const subject = (await env.owner.query(`insert into auth_user (name, email) values ('Ganda Aktif', $1) returning id`, [`aktif.${crypto.randomUUID().slice(0, 8)}@vendor-sintetis.test`])).rows[0].id as string;
  const id = (await env.owner.query(
    `insert into vendor_requests (kind, tenant_id, payload, reason, requested_by, requested_as, state, decided_by, decided_at,
                                  clinic_approved_by, clinic_approved_account, clinic_approved_at)
     values ('dual_identity', $1, jsonb_build_object('account_id', $2::text), 'Identitas ganda aktif untuk uji', $3, 'support', 'approved', $4, now(), $5, $6, now())
     returning id`, [t, subject, op, platformOwner, ownerStaff, ownerAcc])).rows[0].id as string;
  await createMembership(env.owner, { tenantId: t, accountId: subject, displayName: "Staf Ganda Rahasia" });
  env.victimSecret(id);
  env.victimSecret(subject);
  return { id, subject };
}

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : (e as { code?: string }).code === "P0002" ? "ERR_NOT_FOUND" : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/saya/akses-vendor",
    expect: "filtered",
    // Both B's session purpose and B's dual-identity request must be listed for B (positive control).
    marker: (env) => `${seeded.get(env.victim.tenantId)?.purpose ?? ""}`,
    async run(env) {
      const v = await victimSession(env);
      const dualId = await victimDual(env);
      const body = await asOwner(env, env.actor.tenantId, async (db) => ({
        sessions: (await sessionsForOwner(db)).map((s) => [s.id, s.purpose, s.operator]),
        dual: (await vendorDualIdentities(db)).map((d) => [d.requestId, d.accountId]),
      }));
      // Positive control for the dual list: B itself lists its request.
      if (env.actor.tenantId === env.victim.tenantId && !body.dual.some((d) => d[0] === dualId)) throw new Error("B's own dual identity was not listed for B");
      // B's session log by its id, in its own transaction (a refusal aborts it): not found for A; for B
      // itself it is listed (the page opens only a session of its own list).
      const log = await asOwner(env, env.actor.tenantId, (db) => sessionLog(db, v.id)).then(
        (l) => l.events.map((e) => (e.kind === "read" ? e.id : e.kind)),
        (e) => ((e as { code?: string }).code === "P0002" || e instanceof CommandError ? "ERR_NOT_FOUND" : Promise.reject(e)),
      );
      if (env.actor.tenantId !== env.victim.tenantId && log !== "ERR_NOT_FOUND") throw new Error("B's session log was readable as A");
      return { status: 200, body: { ...body, log } as never };
    },
  },
  {
    kind: "action",
    id: "app/(app)/saya/akses-vendor/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.id ?? "",
    async run(env) {
      const v = await victimSession(env);
      await expectLive(env, "B's pending support session", `exists (select 1 from support_sessions where id = $1 and state = 'pending_approval')`, [v.id]);
      // decide (approve) as the tenant's own Owner succeeds; as A it is not found.
      const decide = await asOwner(env, env.actor.tenantId, (db) => decideScope(db, v.id, true)).then(
        (r) => (r.ok ? "done" : r.code),
        (e) => (e instanceof CommandError ? e.code : (e as { code?: string }).code === "P0002" ? "ERR_NOT_FOUND" : Promise.reject(e)),
      );
      // end: the session is active now in B's own run; in A's run B's session is still pending and not A's.
      const end = await refused(asOwner(env, env.actor.tenantId, (db) => endSessionAsOwner(db, v.id)));
      // The clinic half of B's dual identity: B's Owner decides it; A's is refused and B's request is unchanged.
      const dualId = await victimDual(env);
      await expectLive(env, "B's dual identity waiting for the clinic", `exists (select 1 from vendor_requests where id = $1 and state = 'pending' and clinic_approved_at is null)`, [dualId]);
      const dual = await asOwner(env, env.actor.tenantId, (db) => vendorDualIdentityClinicDecide(db, dualId, true)).then(
        (r) => (typeof r === "string" ? "done" : r.refused),
        (e) => (e instanceof CommandError ? e.code : (e as { code?: string }).code === "P0002" ? "ERR_NOT_FOUND" : Promise.reject(e)),
      );
      if (env.actor.tenantId !== env.victim.tenantId) {
        const after = (await env.owner.query(`select state, clinic_approved_at from vendor_requests where id = $1`, [dualId])).rows[0];
        if (after.state !== "pending" || after.clinic_approved_at !== null) throw new Error("B's dual identity changed under A");
      }
      // Cabut (HYG-013): B's Owner revokes B's effective dual identity; A's attempt is refused and B's
      // identity and the subject's membership in B are unchanged.
      const eff = await victimEffectiveDual(env);
      await expectLive(env, "B's effective dual identity", `exists (select 1 from vendor_requests where id = $1 and state = 'approved' and clinic_approved_at is not null and clinic_revoked_at is null)`, [eff.id]);
      const revoke = await asOwner(env, env.actor.tenantId, (db) => vendorDualIdentityClinicRevoke(db, eff.id)).then(
        (r) => (typeof r === "string" ? "done" : r.refused),
        (e) => (e instanceof CommandError ? e.code : Promise.reject(e)),
      );
      if (env.actor.tenantId !== env.victim.tenantId) {
        const q = (await env.owner.query(`select clinic_revoked_at from vendor_requests where id = $1`, [eff.id])).rows[0];
        const m = (await env.owner.query(`select effective_to from memberships where tenant_id = $1 and account_id = $2`, [env.victim.tenantId, eff.subject])).rows[0];
        if (q.clinic_revoked_at !== null || m.effective_to !== null) throw new Error("B's dual identity or membership changed under A");
      }
      return { attempts: { decide, end, dual, revoke }, body: { decide, end, dual, revoke, id: decide === "done" ? v.id : null } };
    },
  },
);
