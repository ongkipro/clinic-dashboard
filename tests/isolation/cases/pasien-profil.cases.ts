// Profil Pasien (UX-29, PR-49, T-040): the page loads B's patient by id (patient_get) with its consents;
// the actions grant and withdraw a consent on it. As A's FO: B's patient is not found; granting on B's
// patient and withdrawing B's consent are refused. As B's FO (positive control) both succeed; each run
// seeds a fresh patient so the attempts never consume earlier state. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { currentText, grantConsent, publishConsentText } from "../../../src/modules/patients/consents/consents";
import { loadProfile, withdrawFromProfile } from "../../../src/modules/patients/profile";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const accounts = new Map<string, string>();
async function accountOf(env: IsolationEnv, tenantId: string, role: "fo_cashier" | "owner"): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accounts.get(k);
  if (known) return known;
  // Consent grants are new business (tenant_capability): the fixture tenants are set live.
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.prf.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `${role} profil` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "fo_cashier") await assignBranch(c, { tenantId, staffRoleId: rid, branchId: env.victim.tenantId === tenantId ? env.victim.branchId : env.actor.branchId });
  } finally {
    c.release();
  }
  accounts.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>, role: "fo_cashier" | "owner" = "fo_cashier"): Promise<T> {
  const branch = role === "owner" ? undefined : env.victim.tenantId === tenantId ? env.victim.branchId : env.actor.branchId;
  const ctx = await resolveContext(env.app, await accountOf(env, tenantId, role), { tenantId, actingRole: role, activeBranchId: branch });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
// A fresh B patient with an active WhatsApp consent; the texts are published once per tenant.
const texts = new Map<string, { care: string; wa: string }>();
const latest = new Map<string, { id: string; consent: string; name: string }>();
async function victimPatient(env: IsolationEnv) {
  const t = env.victim.tenantId;
  let tx = texts.get(t);
  if (!tx) {
    const care = (await as(env, t, (db) => currentText(db, "care_notice"), "owner")) ?? (await as(env, t, (db) => publishConsentText(db, { purpose: "care_notice", body: "Teks layanan iso" }), "owner"));
    const wa = (await as(env, t, (db) => currentText(db, "marketing_wa"), "owner")) ?? (await as(env, t, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Teks WA iso" }), "owner"));
    tx = { care: care.id, wa: wa.id };
    texts.set(t, tx);
  }
  const name = `Pasien Rahasia Profil ${t.slice(0, 8)} ${latest.size}`;
  const id = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $3,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, name, env.victim.branchId],
  )).rows[0].id as string;
  const g = await as(env, t, (db) => grantConsent(db, crypto.randomUUID(), { patientId: id, purpose: "marketing_wa", textId: tx!.wa, channel: "in_person" }));
  if (!g.ok) throw new Error("victim consent not granted");
  env.victimSecret(name);
  env.victimSecret(id);
  env.victimSecret(g.consentId);
  const v = { id, consent: g.consentId, name, care: tx.care };
  latest.set(t, v);
  return v;
}
const outcome = (p: Promise<unknown>) => p.then((r) => ((r as { ok?: boolean })?.ok === false ? `refused:${(r as { code?: string }).code}` : "done"), (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/pasien/[id]",
    expect: "not-found",
    marker: (env) => latest.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimPatient(env);
      const p = await as(env, env.actor.tenantId, (db) => loadProfile(db, "fo_cashier", v.id));
      return p ? { status: 200, body: { name: p.patient.fullName, consents: p.consents.map((c) => c.id) } } : { status: 404, body: null };
    },
  },
  {
    kind: "action",
    id: "app/(app)/pasien/[id]/actions",
    // The withdrawn consent's id comes back only from a successful withdrawal (the positive control).
    marker: (env) => latest.get(env.victim.tenantId)?.consent ?? "",
    async run(env) {
      const v = await victimPatient(env);
      const g = as(env, env.actor.tenantId, (db) => grantConsent(db, crypto.randomUUID(), { patientId: v.id, purpose: "care_notice", textId: v.care, channel: "in_person" }));
      const grant = await outcome(g);
      const w = as(env, env.actor.tenantId, (db) => withdrawFromProfile(db, crypto.randomUUID(), { patientId: v.id, consentId: v.consent, channel: "whatsapp", reason: "Uji isolasi" }));
      const withdraw = await outcome(w);
      const returned = await w.then((r) => (r.ok ? r.consentId : null), () => null);
      return { attempts: { grant, withdraw }, body: { grant, withdraw, returned } };
    },
  },
);
