// TEN-5 outbox worker (job workers/outbox): a consumer running for tenant A's events
// never sees tenant B's event payload or writes into B, even though the claim crosses
// tenants. The case seeds an event in B, runs one batch and returns what the consumer
// observed while bound to the caller's tenant only.
import { withTenantContext } from "../../../src/db/rls/context";
import { emit } from "../../../src/modules/events/events";
import { runOutboxBatch } from "../../../src/workers/outbox";
import { defineCases } from "../case";

let marker = "";

export default defineCases({
  kind: "job",
  id: "workers/outbox",
  marker: () => marker,
  async run(env) {
    const svc = (tenantId: string) => ({ tenantId, allowedBranchIds: "*" as const, roles: [] });
    await env.owner.query(`insert into event_consumers (name, event_types) values ('iso.outbox', '{PaymentReceived}') on conflict do nothing`);
    // A fresh B event for every run (HYG-010 C-02): the positive control consumes the first one,
    // so a seed-once event would leave the negative run with nothing to claim.
    const id = crypto.randomUUID();
    marker ||= id;
    await withTenantContext(env.app, svc(env.victim.tenantId), (db) =>
      emit(db, { type: "PaymentReceived", aggregateKind: "invoice", aggregateId: id, branchId: env.victim.branchId }),
    );
    env.victimSecret(id);
    // The consumer reports only events of the tenant the caller acts for; the worker
    // binds each event's own tenant, so a consumer for A observing B's event would leak.
    const seen: { aggregateId: string; tenantId: string }[] = [];
    let handled = false;
    const consumer = "iso.outbox";
    await runOutboxBatch(
      env.app,
      [{
        name: consumer,
        handle: async (db, e) => {
          if (e.aggregateId === id) handled = true;
          const visible = (await db.query(`select id from tenants`)).rows.map((r) => r.id as string);
          if (visible.includes(env.actor.tenantId)) seen.push({ aggregateId: e.aggregateId, tenantId: e.tenantId });
        },
      }],
      { worker: "iso", limit: 500, leaseSeconds: 5 },
    );
    // The handler must have run on this run's event, or the negative proves nothing.
    if (!handled) throw new Error("outbox case: the handler never ran on the seeded event");
    const observe = seen.some((x) => x.aggregateId === id) ? "done" : "not_seen";
    return { attempts: { observe }, body: { seen: seen.map((x) => [x.aggregateId, x.tenantId]) } };
  },
});
