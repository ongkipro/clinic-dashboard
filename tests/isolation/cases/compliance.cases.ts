// Kepatuhan (UX-58, PR-97): the register and detail render compliance_register and
// itemDetail in the caller's active context; the download route reads one file through
// evidence_file_content; the actions upload and decide. Each case seeds evidence in B
// (secret expert name, file name and file id), then runs as A's owner: nothing of B
// comes back, B's file is not found, and deciding B's item is not found.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { decideEvidence, downloadEvidence, itemDetail, register, uploadEvidence } from "../../../src/modules/compliance/compliance";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

const owners = new Map<string, string>(); // tenantId -> owner account
const finances = new Map<string, string>(); // tenantId -> finance account
const seeded = new Map<string, { itemId: string; fileId: string; expert: string }>();

async function member(env: IsolationEnv, tenantId: string, role: "owner" | "finance", cache: Map<string, string>): Promise<string> {
  const known = cache.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.kep.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `${role} kep` });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role });
  } finally {
    c.release();
  }
  cache.set(tenantId, acc);
  return acc;
}

async function as<T>(env: IsolationEnv, tenantId: string, role: "owner" | "finance", fn: (db: never) => Promise<T>): Promise<T> {
  const acc = await member(env, tenantId, role, role === "owner" ? owners : finances);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

async function victimEvidence(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const expert = `Konsultan Rahasia ${t.slice(0, 8)}`;
  const fileId = await as(env, t, "finance", async (db) =>
    (await uploadEvidence(db, { obligationKey: "tax_advice", fileName: `rahasia-${t.slice(0, 8)}.pdf`, content: Buffer.from(`%PDF-1.7 rahasia ${t}`), expertName: expert, documentDate: "2026-10-01" })).fileId,
  );
  const itemId = (await as(env, t, "owner", async (db) => (await register(db)).find((r) => r.obligationKey === "tax_advice")!.itemId!)) as string;
  // A decision with a secret reason, read back through evidence_decisions() (HYG-008a, 9c).
  const decisionReason = `Ditolak rahasia ${t.slice(0, 8)}`;
  await as(env, t, "owner", (db) => decideEvidence(db, itemId, fileId, "rejected", decisionReason));
  env.victimSecret(decisionReason);
  const v = { itemId, fileId, expert };
  seeded.set(t, v);
  env.victimSecret(expert);
  env.victimSecret(itemId);
  env.victimSecret(fileId);
  return v;
}

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/kepatuhan",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.itemId ?? "",
    async run(env) {
      await victimEvidence(env);
      const rows = await as(env, env.actor.tenantId, "owner", async (db) => (await register(db)).map((r) => [r.obligationKey, r.itemId ?? "", r.status]));
      return { status: 200, body: rows };
    },
  },
  {
    kind: "route",
    id: "/kepatuhan/[kewajiban]",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.expert ?? "",
    async run(env) {
      const v = await victimEvidence(env);
      // The page loads by obligation key in the caller's tenant; asking for B's item id
      // directly returns nothing either.
      const body = await as(env, env.actor.tenantId, "owner", async (db) => {
        const own = (await register(db)).find((r) => r.obligationKey === "tax_advice");
        const mine = own?.itemId ? await itemDetail(db, own.itemId) : { files: [], decisions: [] };
        const theirs = await itemDetail(db, v.itemId);
        // HYG-008a: decisions come from evidence_decisions(); B's decision reason must not appear.
        return {
          mine: mine.files.map((f) => f.expertName),
          theirs: theirs.files.map((f) => f.expertName),
          theirDecisions: theirs.decisions.map((d) => d.reason ?? ""),
        };
      });
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/kepatuhan/berkas/[id]#route",
    expect: "not-found",
    marker: (env) => seeded.get(env.victim.tenantId)?.fileId ?? "",
    async run(env) {
      const v = await victimEvidence(env);
      const r = await as(env, env.actor.tenantId, "owner", (db) => downloadEvidence(db, v.fileId)).then(
        (f) => ({ status: 200, body: { file: v.fileId, sha: f.sha256 } }),
        (e) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e)),
      );
      return r;
    },
  },
  {
    kind: "action",
    id: "app/(app)/kepatuhan/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.itemId ?? "",
    async run(env) {
      const v = await victimEvidence(env);
      // A fresh file version for each run (a decided version cannot be decided again), so the
      // negative run attempts a decision B itself could still make (HYG-010 N-1).
      const t = env.victim.tenantId;
      const fileId = await as(env, t, "finance", async (db) =>
        (await uploadEvidence(db, { obligationKey: "tax_advice", fileName: `ulang-${crypto.randomUUID()}.pdf`, content: Buffer.from(`%PDF-1.7 ${crypto.randomUUID()}`), expertName: v.expert, documentDate: "2026-10-02" })).fileId,
      );
      env.victimSecret(fileId);
      await expectLive(env, "B's new evidence version", `exists (select 1 from evidence_items where id = $1 and state = 'submitted')`, [v.itemId]);
      // As B's owner the decision succeeds (positive control names B's item); as A it is not found.
      const decide = await refused(as(env, env.actor.tenantId, "owner", (db) => decideEvidence(db, v.itemId, fileId, "rejected", "Uji lintas klinik")));
      const body: Record<string, string> = decide === "done" ? { decided: v.itemId } : { refused: decide };
      return { attempts: { decide }, body };
    },
  },
);
