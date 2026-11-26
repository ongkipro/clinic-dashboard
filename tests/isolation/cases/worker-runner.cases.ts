// DEL-2 cross-tenant negative case for job:workers/runner (DEL-4, TEN-2, TEN-5).
// Proves:
// - Negative control (actor tenant A != victim tenant B): invoking runWorkerCycle on a
//   tenant-A-bound connection is refused (fastOk=false) and never consumes tenant B's
//   pending outbox event or reveals tenant B's marker.
// - Positive control (unbound worker pool for victim tenant B): runWorkerCycle executes all
//   fast/maintenance/daily jobs cleanly and marks victim's outbox event done under ledger.posting.
import type pg from "pg";
import { withTenantContext } from "../../../src/db/rls/context";
import { emit } from "../../../src/modules/events/events";
import { parseWorkerConfig, runWorkerCycle } from "../../../src/workers/runner";
import { defineCases } from "../case";

let marker = "";

async function runBoundWorkerCycle(
  app: pg.Pool,
  tenantId: string,
  cfg: ReturnType<typeof parseWorkerConfig>,
) {
  const client = await app.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true),
              set_config('app.allowed_branch_ids', '*', true),
              set_config('app.active_branch_id', '', true),
              set_config('app.staff_id', '', true),
              set_config('app.roles', '', true)`,
      [tenantId],
    );
    let spSeq = 0;
    const boundQuery = async (text: unknown, values?: unknown[]) => {
      const sp = `iso_wr_${++spSeq}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const res = await client.query(text as string, values);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        return res;
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
        throw err;
      }
    };
    const boundClient = {
      query: boundQuery,
      release: () => {},
      on: () => boundClient,
      removeListener: () => boundClient,
    };
    const boundPool = {
      connect: async () => boundClient,
      query: boundQuery,
    } as unknown as pg.Pool;

    return await runWorkerCycle(boundPool, cfg, {
      tick: 0,
      lastMaintenanceAt: 0,
      lastDailyAt: 0,
      forceAll: true,
    });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

export default defineCases({
  kind: "job",
  id: "workers/runner",
  marker: () => marker,
  async run(env) {
    const svc = (tenantId: string) => ({ tenantId, allowedBranchIds: "*" as const, roles: [] });
    const id = crypto.randomUUID();
    marker ||= id;

    const eventId = await withTenantContext(env.app, svc(env.victim.tenantId), (db) =>
      emit(db, {
        type: "InvoiceIssued",
        aggregateKind: "invoice",
        aggregateId: id,
        branchId: env.victim.branchId,
        payload: { invoice_id: id },
      }),
    );
    env.victimSecret(id);

    const cfg = parseWorkerConfig({
      WORKER_ID: "iso-runner",
      WORKER_HEARTBEAT_FILE: "",
      WORKER_OUTBOX_LIMIT: "500",
    });

    if (env.actor.tenantId !== env.victim.tenantId) {
      const summary = await runBoundWorkerCycle(env.app, env.actor.tenantId, cfg);
      const consumed =
        (
          await env.owner.query<{ ok: boolean }>(
            `SELECT exists(
               SELECT 1 FROM public.event_receipts
                WHERE tenant_id = $1 AND event_id = $2 AND consumer = 'ledger.posting' AND done_at IS NOT NULL
             ) AS ok`,
            [env.victim.tenantId, eventId],
          )
        ).rows[0]?.ok === true;
      const refused = !summary.fastOk && !consumed;
      return {
        attempts: { cycle: refused ? "ERR_FORBIDDEN" : "done" },
        body: { fastOk: summary.fastOk, consumed, processed: null, errors: summary.errors.map((e) => e.job) },
      };
    }

    const summary = await runWorkerCycle(env.app, cfg, {
      tick: 0,
      lastMaintenanceAt: 0,
      lastDailyAt: 0,
      forceAll: true,
    });
    const consumed =
      (
        await env.owner.query<{ ok: boolean }>(
          `SELECT exists(
             SELECT 1 FROM public.event_receipts
              WHERE tenant_id = $1 AND event_id = $2 AND consumer = 'ledger.posting' AND done_at IS NOT NULL
           ) AS ok`,
          [env.victim.tenantId, eventId],
        )
      ).rows[0]?.ok === true;
    const ok = summary.fastOk && summary.errors.length === 0 && consumed;
    return {
      attempts: { cycle: ok ? "done" : "ERR_NOT_RUN" },
      body: { fastOk: summary.fastOk, consumed, processed: ok ? id : null, errors: summary.errors.map((e) => e.job) },
    };
  },
});
