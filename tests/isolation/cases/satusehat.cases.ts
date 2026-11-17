// SATUSEHAT (UX-23, PR-35, T-102 increment 3): the /satusehat page reader (satusehat_page), the error-answer page (satusehat_error_body)
// and the actions (Kirim Ulang, identity resolve, reporting room, practitioner IHS, ICD-9 CM map, credentials set / revoke). Each run seeds
// in B a signed visit of a secret-named patient without NIK (the trigger queues it; the visit has no room, so it is held no_room and the
// patient is in identity review), a rejected link with a provider answer, a doctor, a service and a credential. As A's roles: B's branch
// reads not-found, B's error answer not-found, and every action on B's objects is refused. As B (positive control) every read shows B's
// marker and every action succeeds. Synthetic data (MIG-2); the mock port is never called here; no network (DEC-082).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { openExam, saveExam } from "../../../src/modules/clinical/exam/exam";
import { signRecord } from "../../../src/modules/clinical/records/records";
import { errorBody, linkPractitioner, resend, resolveIdentity, revokeCredentials, satusehatPage, setCodeMap, setContextRoom, setCredentials }
  from "../../../src/modules/integrations/satusehat/satusehat";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });

type Role = "owner" | "facility_head" | "records_officer" | "doctor";
const staffOf = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: Role) {
  const k = `${tenantId}:${role}`;
  const known = staffOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
    [`${role}.ss102.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf SATUSEHAT ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  staffOf.set(k, { acc, staffId });
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: Role, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const m = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, m.acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const mine = <T>(env: IsolationEnv, role: Role, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const k = () => crypto.randomUUID();

let runs = 0;
const setup = new Map<string, { org: string; room: string; service: string; doctor: string }>();
const latest = new Map<string, { name: string; visit: string; patient: string; attempt: string; credential: string }>();
// Per tenant once: the branch's organization id, a room, a service, a doctor. Per run: a signed visit of a fresh secret patient without NIK
// (identity review, no room → held), a rejected Encounter link with its attempt and provider answer (worker stand-ins: owner inserts), and a
// fresh credential.
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const n = ++runs;
  let s = setup.get(t);
  if (!s) {
    const org = `7${t.replace(/-/g, "").slice(0, 9)}`;
    await env.owner.query(`update branches set satusehat_org_id = $2 where id = $1 and satusehat_org_id is null`, [b, org]);
    const room = (await env.owner.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Ruang Isolasi SS', 'consultation') returning id`, [t, b])).rows[0].id as string;
    const own = await member(env, t, b, "owner");
    const service = (await env.owner.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`,
      [t, `SSI-${t.slice(0, 6).toUpperCase()}`, own.staffId])).rows[0].id as string;
    const doctor = (await member(env, t, b, "doctor")).staffId;
    s = { org: (await env.owner.query(`select satusehat_org_id o from branches where id = $1`, [b])).rows[0].o as string, room, service, doctor };
    setup.set(t, s);
  }
  const doc = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, "doctor", fn);
  const name = `Pasien Rahasia SATUSEHAT ${t.slice(0, 8)} ${n}`;
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status,
       registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '2024-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan',
       's1', 'kawin', $3, $4, 'fo_cashier') returning id`, [t, name, b, s.doctor])).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, now() - interval '1 hour') returning id`,
    [t, b, patient, s.doctor])).rows[0].id as string;
  const { examId } = await doc((db) => openExam(db, k(), visit));
  await doc((db) => saveExam(db, k(), examId, { assessment: "Catatan rahasia", icd10_codes: ["L70.0"] }));
  await doc((db) => signRecord(db, k(), examId, { verified: true }));
  // worker stand-ins (the owner inserts what the worker would): identity review, and a rejected Encounter with the provider's answer
  await env.owner.query(`insert into satusehat_patient_identity (tenant_id, patient_id, state, reason) values ($1, $2, 'review', 'no_nik')`, [t, patient]);
  const link = (await env.owner.query(`insert into satusehat_links (tenant_id, branch_id, environment, visit_id, fhir_type, local_key, organization_id, current_revision)
      values ($1, $2, 'sandbox', $3, 'Encounter', $5, $4, 1) returning id`, [t, b, visit, s.org, visit])).rows[0].id as string;
  const ob = (await env.owner.query(`select id from satusehat_outbox where tenant_id = $1 and visit_id = $2`, [t, visit])).rows[0].id as string;
  const attempt = (await env.owner.query(`insert into satusehat_attempts (tenant_id, link_id, outbox_id, revision, lease_gen, verb, body_fingerprint)
      values ($1, $2, $3, 1, 1, 'create', $4) returning id`, [t, link, ob, "b".repeat(64)])).rows[0].id as string;
  await env.owner.query(`update satusehat_attempts set outcome = 'http_4xx', http_status = 400, error_code = 'invalid', error_path = 'Encounter.period', finished_at = now() where id = $1`, [attempt]);
  await env.owner.query(`update satusehat_links set status = 'sending' where id = $1`, [link]);
  await env.owner.query(`update satusehat_links set status = 'failed', status_reason = 'http_4xx' where id = $1`, [link]);
  await env.owner.query(`insert into satusehat_errors (tenant_id, branch_id, attempt_id, body) values ($1, $2, $3, $4::jsonb)`,
    [t, b, attempt, JSON.stringify({ resourceType: "OperationOutcome", issue: [{ diagnostics: `Jawaban rahasia ${name}` }] })]);
  const credential = await as(env, t, b, "owner", (db) => setCredentials(db as never, k(), { branchId: b, environment: "sandbox", organizationId: s!.org,
    clientId: `client-${n}`, clientSecret: "rahasia-sintetis-iso" })).then((r) => r.credentialId);
  for (const x of [name, patient, visit, attempt, credential]) env.victimSecret(x);
  const r = { name, visit, patient, attempt, credential };
  latest.set(t, r);
  return { ...r, ...s };
}
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const notFound = (e: unknown) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const actionMarker = new Map<string, string>();

export default defineCases(
  // The page: B's branch through every projecting role of the actor (a records officer sees the identity queue with names).
  { kind: "route", id: "/satusehat", expect: "not-found", marker,
    async run(env) {
      const v = await victim(env);
      void v;
      return mine(env, "records_officer", (db) => satusehatPage(db, env.victim.branchId)).then(ok, notFound);
    } },
  // The error answer: B's attempt through the actor's facility head.
  { kind: "route", id: "/satusehat/galat/[attempt]", expect: "not-found", marker: (env) => latest.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victim(env);
      return mine(env, "facility_head", (db) => errorBody(db, v.attempt)).then(ok, notFound);
    } },
  {
    kind: "action",
    id: "app/(app)/satusehat/actions",
    marker: (env) => actionMarker.get(env.victim.tenantId) ?? "",
    async run(env) {
      const own = env.actor.tenantId === env.victim.tenantId;
      const v = await victim(env);
      actionMarker.set(env.victim.tenantId, v.name);
      await expectLive(env, "B's rejected link", `exists (select 1 from satusehat_links where visit_id = $1 and status = 'failed')`, [v.visit]);
      await expectLive(env, "B's identity review", `exists (select 1 from satusehat_patient_identity where patient_id = $1 and is_current and state = 'review')`, [v.patient]);
      await expectLive(env, "B's room-less visit", `exists (select 1 from satusehat_visit_context where visit_id = $1 and room_id is null)`, [v.visit]);
      await expectLive(env, "B's live credential", `exists (select 1 from satusehat_credentials where id = $1 and revoked_at is null)`, [v.credential]);
      const resent = await outcome(mine(env, "records_officer", (db) => resend(db, v.visit, "data_corrected")));
      const identity = await outcome(mine(env, "records_officer", (db) => resolveIdentity(db, v.patient, null, "Dicek di portal")));
      const room = await outcome(mine(env, "facility_head", (db) => setContextRoom(db, v.visit, v.room)));
      const practitioner = await outcome(mine(env, "owner", (db) => linkPractitioner(db, k(), { staffId: v.doctor, ihs: `N7${String(runs).padStart(7, "0")}` })));
      const map = await outcome(mine(env, "owner", (db) => setCodeMap(db, k(), { itemId: v.service, code: "99.29", display: "Injeksi terapi lain" })));
      // revoke B's live credential first (a later set would revoke it itself and the revoke would prove nothing)
      const revoke = await outcome(mine(env, "owner", (db) => revokeCredentials(db, v.credential)));
      const credential = await outcome(mine(env, "owner", (db) => setCredentials(db, k(), { branchId: env.victim.branchId, environment: "sandbox",
        organizationId: v.org, clientId: "client-asing", clientSecret: "rahasia-asing-iso" })));
      const attempts = { resent, identity, room, practitioner, map, revoke, credential };
      return { attempts, body: { ...attempts, patient: own && identity === "done" ? v.name : null } };
    },
  },
);
