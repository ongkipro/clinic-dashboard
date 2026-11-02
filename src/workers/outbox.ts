// Outbox worker (DATA-59, TEN-5): claims events across tenants for each registered
// consumer and applies each one in its own tenant-bound transaction. Consumers register
// with their tasks (posting, stock, sessions, commission, SATUSEHAT, WhatsApp). One
// event failing does not stop the batch; it is retried after its lease expires.
import type pg from "pg";
import { claim, consume, type Handler } from "../modules/events/events";

export type Consumer = { name: string; handle: Handler };

export type BatchResult = { consumer: string; done: number; skipped: number; failed: number };

export async function runOutboxBatch(
  pool: pg.Pool,
  consumers: readonly Consumer[],
  opts: { worker: string; limit?: number; leaseSeconds?: number },
): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  for (const c of consumers) {
    const result: BatchResult = { consumer: c.name, done: 0, skipped: 0, failed: 0 };
    for (const item of await claim(pool, { consumer: c.name, ...opts })) {
      try {
        result[await consume(pool, c.name, item, c.handle)]++;
      } catch (error) {
        result.failed++;
        // ids and codes only (no payload, no clinical content in logs)
        console.error("outbox: consumer failed", { consumer: c.name, event: item.eventId, code: (error as { code?: string }).code });
      }
    }
    out.push(result);
  }
  return out;
}
