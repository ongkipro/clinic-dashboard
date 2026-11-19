// Coretax XML export for PKP tenants (PR-98, A-08, A-15; T-106, migration 0125, DEC-120). The documents are built in the database from frozen
// facts only (invoice line snapshots of PKP-at-issue invoices, paid refunds' reversed VAT) and never read a patient's identity: the buyer is
// the generic end consumer. Gated by the coretax_export feature gate (approved tax-advice evidence, PR-97); every refusal and every download
// is audited, and a downloaded document is logged with the SHA-256 of its exact bytes. Owner and finance export; the auditor reads status.
import type pg from "pg";
import { call, isCalendarDate, LedgerError } from "../ledger/ledger";

export const DOC_KINDS = ["retail", "faktur", "retur", "pembatalan"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
// bounds_exceeded (r2): a document beyond the supported ceiling (10^6 rows, Rp10^15 DPP / PPN — every total stays an exact JavaScript number).
export type Refusal = "bad_period" | "future_period" | "npwp_missing" | "not_pkp" | "gate_closed" | "discount_pending" | "bounds_exceeded" | "empty";
type Totals = { n: number; base: number; vat: number; bounds_exceeded: boolean };
export type CoretaxStatus = {
  period: string; role: string; is_pkp: boolean; pkp_effective_from: string | null; npwp_set: boolean; gate_open: boolean; missing: string[];
  block: Exclude<Refusal, "discount_pending" | "bounds_exceeded" | "empty"> | null;
  docs: { retail: Totals & { pending: number; mismatch: number }; faktur: Totals; retur: Totals; pembatalan: Totals };
  history: { period: string; kind: DocKind; sha256: string; rows: number; base: number; vat: number; by: string; at: string }[];
};

export const isPeriod = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && isCalendarDate(`${s}-01`);
const num = (t: Totals) => ({ n: Number(t.n), base: Number(t.base), vat: Number(t.vat), bounds_exceeded: t.bounds_exceeded === true });

export async function coretaxStatus(db: pg.ClientBase, period: string): Promise<CoretaxStatus> {
  if (!isPeriod(period)) throw new LedgerError("ERR_INVALID_INPUT", "period");
  const s = (await call(() => db.query<{ r: CoretaxStatus }>(`select coretax_status($1) as r`, [period]))).rows[0].r;
  return {
    ...s,
    docs: {
      retail: { ...num(s.docs.retail), pending: Number(s.docs.retail.pending), mismatch: Number(s.docs.retail.mismatch) },
      faktur: num(s.docs.faktur), retur: num(s.docs.retur), pembatalan: num(s.docs.pembatalan),
    },
    history: s.history.map((h) => ({ ...h, rows: Number(h.rows), base: Number(h.base), vat: Number(h.vat) })),
  };
}

// One document of one month. A refusal is RETURNED (the caller's transaction then commits the denied audit row with it).
export type ExportResult =
  | { ok: true; xml: string; sha256: string; rows: number; base: number; vat: number }
  | { ok: false; refused: Refusal; missing?: string[]; count?: number };
export async function exportCoretax(db: pg.ClientBase, o: { period: string; kind: DocKind }): Promise<ExportResult> {
  if (!DOC_KINDS.includes(o.kind)) throw new LedgerError("ERR_INVALID_INPUT", "kind");
  type R = { refused?: Refusal; missing?: string[] | null; count?: number; doc?: string; sha256?: string; rows?: number; base?: number; vat?: number };
  const r = (await call(() => db.query<{ r: R }>(`select coretax_export($1, $2) as r`, [o.period, o.kind]))).rows[0].r;
  if (r.refused) return { ok: false, refused: r.refused, ...(r.missing ? { missing: r.missing } : {}), ...(r.count !== undefined ? { count: Number(r.count) } : {}) };
  return { ok: true, xml: r.doc as string, sha256: r.sha256 as string, rows: Number(r.rows), base: Number(r.base), vat: Number(r.vat) };
}
