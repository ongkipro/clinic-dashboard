// Aftercare (PR-70, T-096): the public /aftercare/[token] page and its two actions (send the OTP, verify it). The page has no staff
// session: the link token is the credential. Each run seeds in B a closed visit with an aftercare text, the notice sent through the mock
// port (its token taken from the sent params), the OTP verified to a session; the treatment name and the aftercare text are B's secrets.
// As B (positive control) B's token and session show B's texts and B's OTP actions succeed; as A, A holds only its own link and session —
// A's page and actions answer about A's own notice, never B's (a token is not a tenant-scoped id, so "another tenant" means: the caller
// does not have B's token; the cases prove the lookup by A's token can never reach B's notice, and A's session never opens B's link).
// Synthetic data (MIG-2); the mock port only (DEC-082).
import { withTenantContext } from "../../../src/db/rls/context";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { publish } from "../../../src/modules/catalog/catalog";
import { NextRequest } from "next/server";
import { handleAftercarePost } from "../../../src/app/api/v1/public/aftercare/handler";
import { aftercarePage, sendAftercareOtp, verifyAftercareOtp } from "../../../src/modules/crm/aftercare/aftercare";
import { RECORDED_TEMPLATES } from "../../../src/modules/messaging/inbox/fixtures";
import { syncTemplates } from "../../../src/modules/messaging/inbox/inbox";
import { mockInboxPort } from "../../../src/modules/messaging/inbox/mock";
import { runOutboundDispatch } from "../../../src/modules/messaging/outbound/outbound";
import { mockWabaGraphPort } from "../../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });

type Role = "owner" | "fo_cashier" | "doctor";
const accOf = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: Role) {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.ac96.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Aftercare ${role} ${tenantId}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, { acc, staffId });
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: Role, fn: (db: never) => Promise<T>): Promise<T> {
  const m = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, m.acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const TEMPLATES = [...RECORDED_TEMPLATES,
  { name: "perawatan_anda", language: "id", category: "utility" as const, status: "approved" as const, body: "Halo {{1}}, panduan perawatan Anda setelah kunjungan di {{2}} tersedia di {{3}}.", paramCount: 3 },
  { name: "kode_otp", language: "id", category: "authentication" as const, status: "approved" as const, body: "{{1}} adalah kode verifikasi Anda.", paramCount: 1 }];

// The tenant's live WABA: reuse another case file's (pesan.cases.ts seeds one per tenant and keeps state on it — revoking it here would
// break those cases); only when none is live, connect one. This task's two templates are upserted (a sync never removes templates).
let seq = 0;
async function waba(env: IsolationEnv, tenantId: string, branchId: string) {
  // the fixtures start as provisioning; a WABA and care messages need a live tenant (as payments.cases.ts)
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const live = (await env.owner.query(`select w.id from waba_accounts w where w.tenant_id = $1 and w.state <> 'revoked'
      and exists (select 1 from waba_routes r where r.tenant_id = w.tenant_id and r.waba_id = w.id and r.active)`, [tenantId])).rows[0];
  if (!live) {
    const g = mockWabaGraphPort();
    const { wabaId } = await as(env, tenantId, branchId, "owner", (db) => startWabaSignup(db, crypto.randomUUID(), { onboardingChannel: "cloud_api" }));
    const taken = new Set((await env.owner.query(`select meta_waba_id from waba_accounts where state <> 'revoked' and meta_waba_id is not null`)).rows.map((r) => r.meta_waba_id as string));
    const code = (["code-unverified", "code-unverified-2", "code-verified", "code-verified-2"] as const)
      .find((c) => !taken.has({ "code-unverified": "100000000000001", "code-unverified-2": "100000000000005", "code-verified": "100000000000002", "code-verified-2": "100000000000004" }[c]))!;
    await as(env, tenantId, branchId, "owner", (db) => completeWabaSignup(db, wabaId, code, { port: g }));
    await as(env, tenantId, branchId, "owner", (db) => addWaNumber(db, crypto.randomUUID(), wabaId, { branchId, phoneNumber: `+62815${String(1000000 + ++seq)}`,
      phoneNumberId: `3${String(Date.now()).slice(-9)}${seq}` }, { port: g }));
  }
  await as(env, tenantId, branchId, "owner", (db) => syncTemplates(db, { port: { ...mockInboxPort(), fetchTemplates: async () => TEMPLATES.map((x) => ({ ...x })) } }));
}

// A fresh sent aftercare link for a tenant: a closed visit with one counted treatment whose aftercare text is the marker.
type Link = { token: string; secret: string; name: string };
let runs = 0;
async function link(env: IsolationEnv, tenantId: string, branchId: string): Promise<Link> {
  await waba(env, tenantId, branchId);
  const tag = `${tenantId.slice(0, 8)}-${++runs}`;
  const name = `Perawatan Rahasia ${tag}`;
  const secret = `Panduan rahasia ${tag}`;
  const fo = await member(env, tenantId, branchId, "fo_cashier");
  const doc = await member(env, tenantId, branchId, "doctor");
  const ver = (await as(env, tenantId, branchId, "owner", (db) => publish(db as never, { kind: "service", code: `AF-${tag}` }, { name, tax_category: "exempt_medical",
    tax_basis: "Jasa medis", normal_price: 1, category: "facial", prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat.",
    delegation: "Dokter", aftercare_text: secret, eligibility: [{ role: "doctor", mode: "performs" }] } as never, "Layanan uji isolasi aftercare"))).versionId;
  const pt = (await env.owner.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Aftercare Isolasi', '1990-01-01', 'female', 'newborn_via_guardian',
       'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`, [tenantId, branchId, fo.staffId])).rows[0].id as string;
  await env.owner.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [tenantId, pt, `+62859${String(10000000 + ++seq)}`]);
  const v = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [tenantId, branchId, pt, fo.staffId])).rows[0].id as string;
  const exam = (await env.owner.query(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id) values ($1, $2, $3, $4, $5) returning id`,
    [tenantId, branchId, v, pt, doc.staffId])).rows[0].id as string;
  const plan = (await env.owner.query(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id, created_by)
      values ($1, $2, $3, 'Rencana', 'Kondisi', $4, $5) returning id`, [tenantId, branchId, pt, exam, doc.staffId])).rows[0].id as string;
  const pi = (await env.owner.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty) values ($1, $2, $3, $4, 1, $5, 1)
      returning id`, [tenantId, branchId, plan, exam, ver])).rows[0].id as string;
  // the execution guard admits a started execution on an open visit, then started → finished
  const ex = (await env.owner.query(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id, performer_staff_id, identity_confirmed, started_by,
      started_as, start_command_key) values ($1, $2, $3, $4, $5, true, $5, 'doctor', $6) returning id`, [tenantId, branchId, v, pi, doc.staffId, `k-${crypto.randomUUID()}`])).rows[0].id as string;
  await env.owner.query(`update treatment_executions set state = 'finished', finished_at = now(), finished_by = $2, finished_as = 'doctor', finish_command_key = $3,
      outcome = 'completed' where id = $1`, [ex, doc.staffId, `k-${crypto.randomUUID()}`]);
  await env.owner.query(`update visits set closed_at = clock_timestamp(), closed_by = $2 where id = $1`, [v, fo.staffId]);
  const params: string[][] = [];
  const port = mockInboxPort();
  await runOutboundDispatch(env.app, { now: new Date(Date.now() + 60_000), port: { ...port, sendMessage: async (i) => {
    if (i.kind === "template" && i.templateName === "perawatan_anda") params.push(i.params);
    return port.sendMessage(i);
  } } });
  const token = params.at(-1)![2].replace("/aftercare/", "");
  await expectLive(env, "the tenant's sent aftercare link", `exists (select 1 from aftercare_notices where tenant_id = $1 and token_hash is not null and visit_id = $2)`, [tenantId, v]);
  return { token, secret, name };
}
// The OTP of a link, read from the mock port's send.
async function verified(env: IsolationEnv, l: Link) {
  const codes: string[] = [];
  const port = mockInboxPort();
  const r = await sendAftercareOtp(env.app, l.token, `192.0.2.${++seq % 250}`, { port: { ...port, sendMessage: async (i) => {
    if (i.kind === "template") codes.push(i.params[0]);
    return port.sendMessage(i);
  } } });
  if (!r.ok) return { send: r.reason, verify: "not_sent", session: null as string | null };
  const v = await verifyAftercareOtp(env.app, l.token, codes[0]);
  return { send: "done", verify: v.ok ? "done" : v.reason, session: v.ok ? v.sessionToken : null };
}

const links = new Map<string, Link>();
async function victim(env: IsolationEnv) {
  const l = await link(env, env.victim.tenantId, env.victim.branchId);
  links.set(env.victim.tenantId, l);
  env.victimSecret(l.secret);
  env.victimSecret(l.name);
  return l;
}
const own = (env: IsolationEnv) => env.actor.tenantId === env.victim.tenantId;

export default defineCases(
  // The page: B's token and B's verified session show B's texts (positive control); A only ever holds A's own link and session: A's page
  // shows A's texts, and A's session cannot open B's link even if A had it (the session is bound to its notice).
  { kind: "route", id: "/aftercare/[token]", expect: "filtered", marker: (env) => links.get(env.victim.tenantId)?.secret ?? "",
    async run(env) {
      const b = await victim(env);
      const l = own(env) ? b : await link(env, env.actor.tenantId, env.actor.branchId);
      const s = await verified(env, l);
      const page = await aftercarePage(env.app, l.token, s.session);
      if (!own(env)) {
        // A's session on B's link: B's page stays locked (neutral metadata only, never B's texts)
        const cross = await aftercarePage(env.app, b.token, s.session);
        if (cross.state === "verified") throw new Error("aftercare isolation: another notice's session opened B's link");
      }
      return { status: 200, body: page as never };
    } },
  // The OTP API route handler (DEC-117 Rows 1/7: exercises real handleAftercarePost handler,
  // origin policy, JSON parsing, HttpOnly cookie issuance, and cross-tenant refusal):
  { kind: "route", id: "/api/v1/public/aftercare#route", expect: "filtered", marker: (env) => links.get(env.victim.tenantId)?.secret ?? "",
    async run(env) {
      const b = await victim(env);
      const localEnv = { DEPLOY_ENV: "local", BOOKING_HOST: "booking.localhost:3000" };
      const prodEnv = { DEPLOY_ENV: "production", BOOKING_HOST: "booking.klinik.example" };
      // Origin check: HTTP origin on production BOOKING_HOST is refused with 403
      const badOriginReq = new NextRequest("https://booking.klinik.example/api/v1/public/aftercare", {
        method: "POST",
        headers: { host: "booking.klinik.example", origin: "http://booking.klinik.example", "content-type": "application/json" },
        body: JSON.stringify({ action: "send", token: b.token }),
      });
      const badOriginRes = await handleAftercarePost(badOriginReq, env.app, { env: prodEnv });
      if (badOriginRes.status !== 403) throw new Error(`aftercare route allowed insecure origin in production: ${badOriginRes.status}`);

      const postJson = async (payload: Record<string, unknown>, port?: ReturnType<typeof mockInboxPort>) => {
        const req = new NextRequest("http://booking.localhost:3000/api/v1/public/aftercare", {
          method: "POST",
          headers: {
            host: "booking.localhost:3000",
            origin: "http://booking.localhost:3000",
            "content-type": "application/json",
            "x-real-ip": `192.0.2.${++seq % 250}`,
          },
          body: JSON.stringify(payload),
        });
        return handleAftercarePost(req, env.app, { env: localEnv, port });
      };

      if (own(env)) {
        const codes: string[] = [];
        const basePort = mockInboxPort();
        const sendRes = await postJson(
          { action: "send", token: b.token },
          {
            ...basePort,
            sendMessage: async (i) => {
              if (i.kind === "template") codes.push(i.params[0]);
              return basePort.sendMessage(i);
            },
          },
        );
        if (sendRes.status !== 200 || codes.length === 0) throw new Error(`aftercare route send failed: ${sendRes.status}`);
        const verifyRes = await postJson({ action: "verify", token: b.token, code: codes[0] });
        const cookie = verifyRes.cookies.get("aftercare_session")?.value ?? null;
        if (verifyRes.status !== 200 || !cookie) throw new Error("aftercare route verify did not issue session cookie");
        const page = await aftercarePage(env.app, b.token, cookie);
        return { status: 200, body: page as never };
      }
      // Attacker A: guessing OTP against B's link via the real POST handler fails and sets no cookie
      const guessRes = await postJson({ action: "verify", token: b.token, code: "000000" });
      const guessBody = (await guessRes.json()) as Record<string, unknown>;
      if (guessBody.step === "done" || guessRes.cookies.get("aftercare_session")) {
        throw new Error("aftercare route isolation: guessed OTP succeeded on victim link");
      }
      const a = await link(env, env.actor.tenantId, env.actor.branchId);
      const as_ = await verified(env, a);
      const crossed = await aftercarePage(env.app, b.token, as_.session);
      if (crossed.state === "verified") throw new Error("aftercare isolation: attacker session opened victim link");
      return { status: guessRes.status, body: { verify: guessBody.step, state: crossed.state } as never };
    } },
);
