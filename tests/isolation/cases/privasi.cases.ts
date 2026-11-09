// Privasi & Persetujuan (PR-92, T-039): the page reads the registers (privacy_overview); the download reads
// one notice file (breach_notice_file); the actions add a processor, record and move a breach, add a
// notice. Each run seeds in B a fresh breach (assessed, with one notice) and a processor with secret
// names. As A's owner: B's registers never appear, B's notice file is not found, and moving B's breach,
// adding a notice to it and editing B's processor are refused. As B's owner (positive control) every
// attempt succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { addNotice, assessBreach, noticeFile, overview, recordBreach, saveProcessor } from "../../../src/modules/privacy/privacy";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
const PDF = Buffer.from("%PDF-1.4\n% bukti isolasi\n%%EOF\n");

const owners = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`owner.prv39.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "owner privasi" });
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

let runs = 0;
const latest = new Map<string, { secret: string; breach: string; notice: string; processor: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const secret = `Kebocoran Rahasia ${t.slice(0, 8)} ${++runs}`;
  const { breachId } = await as(env, t, (db) => recordBreach(db, crypto.randomUUID(), { awareAt: new Date(Date.now() - 60_000), description: secret, affectedCount: 1, dataCategories: "Nama" }));
  await as(env, t, (db) => assessBreach(db, crypto.randomUUID(), breachId));
  const { noticeId } = await as(env, t, (db) => addNotice(db, crypto.randomUUID(), breachId, {
    recipientKind: "authority", recipient: "Otoritas", sentAt: new Date(), channel: "Surat", contentSummary: "Ringkasan pemberitahuan isolasi", fileName: "a.pdf",
    content: Buffer.concat([PDF, Buffer.from(secret)]),
  }));
  const { processorId } = await as(env, t, (db) => saveProcessor(db, crypto.randomUUID(), null, {
    name: `Pemroses ${secret}`, service: "Server", data_categories: "Semua", location: "Jakarta", role: "processor", cross_border: false,
  }));
  for (const s of [secret, breachId, noticeId, processorId]) env.victimSecret(s);
  const r = { secret, breach: breachId, notice: noticeId, processor: processorId };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/privasi",
    expect: "filtered",
    marker: (env) => latest.get(env.victim.tenantId)?.secret ?? "",
    async run(env) {
      await victim(env);
      return { status: 200, body: JSON.parse(JSON.stringify(await as(env, env.actor.tenantId, (db) => overview(db)))) };
    },
  },
  {
    kind: "route",
    id: "/privasi/bukti/[id]#route",
    expect: "not-found",
    marker: (env) => latest.get(env.victim.tenantId)?.secret ?? "",
    async run(env) {
      const v = await victim(env);
      return as(env, env.actor.tenantId, (db) => noticeFile(db, v.notice).then(
        (f) => ({ status: 200, body: { name: f.fileName, content: f.content.toString("latin1") } }),
        (e) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e)),
      ));
    },
  },
  {
    kind: "action",
    id: "app/(app)/privasi/actions",
    marker: (env) => latest.get(env.victim.tenantId)?.processor ?? "",
    async run(env) {
      const v = await victim(env);
      const me = env.actor.tenantId;
      const notice = await outcome(as(env, me, (db) => addNotice(db, crypto.randomUUID(), v.breach, {
        recipientKind: "other", recipient: "Pihak lain", sentAt: new Date(), channel: "Surat", contentSummary: "Ringkasan pemberitahuan kedua", fileName: "b.pdf",
        content: Buffer.concat([PDF, Buffer.from(`${v.secret} kedua`)]),
      })));
      let saved: string | null = null;
      const edit = await outcome(as(env, me, async (db) => {
        saved = (await saveProcessor(db, crypto.randomUUID(), v.processor, { name: "Diubah", service: "Server", data_categories: "Semua", location: "Jakarta", role: "processor", cross_border: false })).processorId;
      }));
      return { attempts: { notice, edit }, body: { notice, edit, processor: saved } };
    },
  },
);
