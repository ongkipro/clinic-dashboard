// Pengaturan (PR-38): the group pages render groupRows in the caller's active context; the
// actions call changeSetting / cancelDraft. Each case seeds a changed value and a waiting
// draft in B (with a secret reason), then runs as A's owner: B's values, history and draft
// never appear, and changing a B branch's value is not found.
// T-089 (Integrasi › WhatsApp lives under Pengaturan, 19:223): B also has a WABA with a number (mock Graph port, recorded fixtures); A's owner
// reading the WABA status sees none of it, and every WABA command on B's ids is refused.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { cancelDraft, changeSetting, groupRows } from "../../../src/modules/settings/settings";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { mockWabaGraphPort } from "../../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, migrateWabaToCloudApi, revokeWaba, startWabaSignup, syncWabaStatus, wabaStatus } from "../../../src/modules/messaging/waba/waba";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 6)]]) });

type Member = { acc: string };
const members = new Map<string, Member>(); // `${tenantId}:${role}`
const seeded = new Map<string, { reason: string; draftReason: string; approvalId: string }>();

async function member(env: IsolationEnv, tenantId: string, role: "owner" | "admin_pusat"): Promise<Member> {
  const k = `${tenantId}:${role}`;
  const known = members.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.set.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `${role} set` });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role });
  } finally {
    c.release();
  }
  const m = { acc };
  members.set(k, m);
  return m;
}

async function as<T>(env: IsolationEnv, tenantId: string, role: "owner" | "admin_pusat", fn: (db: never) => Promise<T>): Promise<T> {
  const m = await member(env, tenantId, role);
  const ctx = await resolveContext(env.app, m.acc, { tenantId, actingRole: role });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

async function victimSettings(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const reason = `Alasan rahasia ${t.slice(0, 8)}`;
  const draftReason = `Usulan rahasia ${t.slice(0, 8)}`;
  await as(env, t, "owner", (db) => changeSetting(db, { key: "SET-13", branchId: env.victim.branchId, value: 77_000, reason }));
  const d = await as(env, t, "admin_pusat", (db) => changeSetting(db, { key: "SET-8", branchId: null, value: 400, reason: draftReason }));
  const v = { reason, draftReason, approvalId: d.approvalId! };
  seeded.set(t, v);
  env.victimSecret(reason);
  env.victimSecret(draftReason);
  env.victimSecret(v.approvalId);
  return v;
}

// B's WABA (a BSP fallback so the migration attempt has a valid target) with one branch number; ids registered as secrets.
const wabas = new Map<string, { wabaId: string; numberId: string; phone: string }>();
let wabaSeq = 0;
// `fresh`: the action case consumes B's WABA (a migration, a revocation), so each run revokes the last one and seeds a new one (HYG-010 N-1).
async function victimWaba(env: IsolationEnv, fresh = false) {
  const t = env.victim.tenantId;
  const known = wabas.get(t);
  if (known && !fresh) return known;
  if (known) await as(env, t, "owner", (db) => revokeWaba(db as never, known.wabaId, "manual"));
  // another case file's live WABA for this tenant (T-090 pesan cases; one live WABA per tenant): revoke it first
  const live = (await env.owner.query(`select id from waba_accounts where tenant_id = $1 and state <> 'revoked'`, [t])).rows[0];
  if (live) await as(env, t, "owner", (db) => revokeWaba(db as never, live.id, "manual"));
  const port = mockWabaGraphPort();
  const { wabaId } = await as(env, t, "owner", (db) => startWabaSignup(db as never, crypto.randomUUID(), { onboardingChannel: "bsp_fallback", bspProvider: "bsp_sintetis" }));
  await as(env, t, "owner", (db) => completeWabaSignup(db as never, wabaId, "code-bsp", { port, onboardingChannel: "bsp_fallback" }));
  wabaSeq += 1;
  const phone = `+62812${String(7000000 + wabaSeq)}${String(Date.now()).slice(-2)}`;
  const added = await as(env, t, "owner", (db) => addWaNumber(db as never, crypto.randomUUID(), wabaId,
    { branchId: env.victim.branchId, phoneNumber: phone, phoneNumberId: `4${String(Date.now()).slice(-9)}${wabaSeq}` }, { port }));
  await expectLive(env, "B's WABA", `exists (select 1 from waba_accounts where id = $1 and state <> 'revoked' and onboarding_channel = 'bsp_fallback')`, [wabaId]);
  if (!added.ok) throw new Error("isolation seed: B's number was not added");
  const v = { wabaId, numberId: added.waNumberId, phone };
  wabas.set(t, v);
  env.victimSecret(wabaId);
  env.victimSecret(added.waNumberId);
  env.victimSecret(phone);
  return v;
}

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const flat = (rows: Awaited<ReturnType<typeof groupRows>>) =>
  rows.map((r) => ({ key: r.def.key, current: JSON.stringify(r.current), history: r.history.map((v) => v.reason), draft: r.draft?.reason ?? null }));

export default defineCases(
  {
    kind: "route",
    id: "/pengaturan",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.draftReason ?? "",
    async run(env) {
      await victimSettings(env);
      // The index lists groups (no tenant data); the money group page is what it opens.
      const w = await victimWaba(env);
      const body = await as(env, env.actor.tenantId, "owner", async (db) => ({
        rows: flat(await groupRows(db as never, "owner", "uang", null)),
        // T-089: the WABA status (Integrasi › WhatsApp) shows the caller's own WABA only
        waba: (await wabaStatus(db as never)) as never,
      }));
      void w;
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/pengaturan/[grup]",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.reason ?? "",
    async run(env) {
      await victimSettings(env);
      // Asking for B's branch (the ?cabang= of a tenant-wide role) shows nothing of B: the
      // page only accepts branches of the caller's own context; groupRows itself filters
      // by the bound tenant.
      const body = await as(env, env.actor.tenantId, "owner", async (db) => flat(await groupRows(db as never, "owner", "uang", env.victim.branchId)));
      return { status: 200, body };
    },
  },
  {
    kind: "action",
    id: "app/(app)/pengaturan/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.approvalId ?? "",
    async run(env) {
      const v = await victimSettings(env);
      // A fresh waiting draft in B for each run (the positive control withdraws its draft), so
      // the negative run tries to withdraw a draft B itself still could (HYG-010 N-1).
      const t = env.victim.tenantId;
      const draftReason = `Usulan rahasia ulang ${crypto.randomUUID().slice(0, 8)}`;
      const fresh = await as(env, t, "admin_pusat", (db) => changeSetting(db, { key: "SET-49", branchId: null, value: 30, reason: draftReason }));
      env.victimSecret(draftReason);
      env.victimSecret(fresh.approvalId!);
      seeded.set(t, { ...v, approvalId: fresh.approvalId! });
      await expectLive(env, "B's settings draft", `exists (select 1 from approvals where id = $1 and state = 'pending')`, [fresh.approvalId]);
      const w = await victimWaba(env, true);
      const port = mockWabaGraphPort();
      const wabaTry = (fn: (db: never) => Promise<unknown>) => refused(as(env, env.actor.tenantId, "owner", fn));
      const attempts = {
        // T-089: A's owner commanding B's WABA by id: every command refused (not found); as B itself each one succeeds.
        wabaAdd: await wabaTry((db) => addWaNumber(db, crypto.randomUUID(), w.wabaId,
          { branchId: null, phoneNumber: `+62813${String(Date.now()).slice(-7)}`, phoneNumberId: `5${String(Date.now()).slice(-10)}` }, { port })),
        wabaSync: await wabaTry((db) => syncWabaStatus(db, w.wabaId, { port })),
        wabaMigrate: await wabaTry((db) => migrateWabaToCloudApi(db, w.wabaId, "code-cloud-after-bsp", { port })),
        wabaRevoke: await wabaTry((db) => revokeWaba(db, w.wabaId, "manual")),
        // A's owner changing B's branch value (B's branch id is not A's): refused.
        change: await refused(as(env, env.actor.tenantId, "owner", (db) => changeSetting(db, { key: "SET-13", branchId: env.victim.branchId, value: 1_000, reason: "Ubah cabang lain" }))),
        // B's own admin withdrawing its draft is the positive control (names the approval).
        withdraw: await refused(as(env, env.actor.tenantId, "admin_pusat", (db) => cancelDraft(db, fresh.approvalId!))),
      };
      return { attempts, body: attempts.withdraw === "done" ? { withdrew: fresh.approvalId! } : attempts };
    },
  },
);
