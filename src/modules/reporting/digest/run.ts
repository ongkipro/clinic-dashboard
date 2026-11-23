// T-117 (PR-80) slice D: the owner digest job — the first and only consumer of the C1 delivery port. Test-invoked only: no scheduler process,
// no live provider (owner decision 2026-11-23). Per run (r4, DESIGN-r4.md), each database step its own short transaction, no connection held
// across the port call:
//   1. digest_claim on the UNBOUND pool → {run, generation} (it also closes expired runs: recovery never needs facts or a live tenant);
//   2. bind the run's tenant with no staff, no role, every branch → digest_facts(run, generation) (a stale generation is refused);
//   3. composeDigest (email) → emailDelivery (pure; a composition problem goes to dispatch as p_refusal, under the fence);
//   4. digest_dispatch(run, generation) — authorizes at most ONE send for this generation (generation, lease and the CURRENT opt-in /
//      recipients / lifecycle, on a clock read after its locks):
//        recover → a receipt is already recorded: complete 'sent', never call the port;
//        closed  → dispatch finished the run (refused:* if never dispatched, unconfirmed:* if an earlier generation was);
//        send    → port.sendEmail with the roles dispatch returned, keyed by digestKey (the provider dedups a re-send of the same key);
//   5. an acceptance is recorded at once: digest_delivered(run, generation, providerRef) — the receipt;
//   6. digest_complete(run, generation, outcome) — the database turns a port refusal after an earlier dispatch into unconfirmed:*.
// POLICY (confirmed by the owner, 2026-11-23): a DEFINITIVE refusal is final for that day; a technical ERROR (database, port throw, a lost
// lease) is not recorded — the lease runs out and a later claim retries, up to digest_max_attempts() (0131).
import type pg from "pg";
import { withTenantContext } from "../../../db/rls/context";
import { bindDeployEnv } from "../../payments/payments";
import { composeDigest, digestKey } from "./digest";
import { type DigestDeliveryPort, emailDelivery } from "./delivery";

type Claimed = { id: string; tenant_id: string; business_date: string; gen: number };
type Dispatch = { mode: "send"; recipients: string[] } | { mode: "recover" } | { mode: "closed"; outcome: string };
export type RunResult = { runId: string; tenantId: string; businessDate: string; outcome: string | null }; // null: error, left to retry

export async function runDigest(pool: pg.Pool, o: { now?: Date; port: DigestDeliveryPort }): Promise<RunResult[]> {
  const claimed = (await pool.query<{ r: Claimed[] }>(`select digest_claim($1) r`, [o.now ?? null])).rows[0].r;
  const out: RunResult[] = [];
  for (const c of claimed) out.push({ runId: c.id, tenantId: c.tenant_id, businessDate: c.business_date, outcome: await runOne(pool, c, o.port) });
  return out;
}

const complete = async (pool: pg.Pool, c: Claimed, outcome: string) =>
  (await pool.query<{ s: string }>(`select digest_complete($1, $2, $3) s`, [c.id, c.gen, outcome])).rows[0].s;

// Exported for the worker-interleaving tests (a stalled worker resumes with an old claim); runDigest is the only production entry.
export async function runOne(pool: pg.Pool, c: Claimed, port: DigestDeliveryPort, hooks: { beforeSend?: () => Promise<void> } = {}): Promise<string | null> {
  try {
    const facts = await withTenantContext(pool, { tenantId: c.tenant_id, allowedBranchIds: "*", roles: [] }, async (db) => {
      await bindDeployEnv(db); // satusehat_env(): the same environment the owner screen's SATUSEHAT reader counts in
      return (await db.query<{ f: unknown }>(`select digest_facts($1, $2) f`, [c.id, c.gen])).rows[0].f;
    });
    const key = digestKey(c.tenant_id, c.business_date, "email");
    const composed = composeDigest({ channel: "email", businessDate: c.business_date }, facts);
    const probe = emailDelivery(key, composed, ["owner"]); // the body and channel, before any role is known
    const refusal = probe.ok ? null : composed.kind === "refused" ? composed.reason : probe.reason;
    const d = (await pool.query<{ r: Dispatch }>(`select digest_dispatch($1, $2, $3) r`, [c.id, c.gen, refusal])).rows[0].r;
    if (d.mode === "recover") return await complete(pool, c, "sent");
    if (d.mode === "closed") return d.outcome;
    const del = emailDelivery(key, composed, d.recipients);
    if (!del.ok) throw new Error("delivery_unbuildable"); // unreachable: the body passed the probe and dispatch returned known roles
    await hooks.beforeSend?.();
    const sent = await port.sendEmail(del.digest);
    if (sent.kind !== "sent") return await complete(pool, c, `refused:${sent.reason}`);
    await pool.query(`select digest_delivered($1, $2, $3)`, [c.id, c.gen, sent.providerRef]);
    return await complete(pool, c, "sent");
  } catch (e) {
    // ids and the error class only: never the facts or the text
    console.error("digest: run failed", { run: c.id, error: e instanceof Error ? e.name : "unknown" });
    return null;
  }
}
