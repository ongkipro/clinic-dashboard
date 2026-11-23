// Ekspor (Keuangan) hub, pure (19 §2.12 "Sub-ledger CSV, komisi per penerima, jurnal (setelah posting map ditandatangani)", UX-22 ▸ Ekspor;
// HYG-NAV-2). The exports exist as route handlers; this module names them with their gate status. The database is the gate (each route
// refuses and audits); the hub only explains what is open.
import { EXPORT_KINDS, type ExportKind, LEDGERS } from "../../../../modules/accounting/subledgers/subledgers";
import { LEDGER } from "../kewajiban/labels";

export const SET_LABEL: Record<string, string> = {
  payments: "Pembayaran", invoice_lines: "Baris tagihan", commissions: "Komisi", stock: "Mutasi stok",
};
export const exportLabel = (k: ExportKind) => ((LEDGERS as readonly string[]).includes(k) ? LEDGER[k as (typeof LEDGERS)[number]] : SET_LABEL[k] ?? k);

export type Period = { from: string; to: string };
// The current calendar month up to today (local day given by the caller).
export function monthToDate(today: string): Period {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new RangeError("date");
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
export const subledgerHref = (k: ExportKind, p: Period) => `/keuangan/kewajiban/ekspor?${new URLSearchParams({ jenis: k, dari: p.from, sampai: p.to })}`;
export const journalHref = (p: Period) => `/keuangan/buku-besar/ekspor?${new URLSearchParams({ dari: p.from, sampai: p.to })}`;
export const batchHref = (id: string) => `/komisi/batch/${id}/ekspor`;

export type JournalGate = { kind: "open" } | { kind: "blocked"; reason: string; unblock: string } | { kind: "unknown" };
export function journalGate(s: { map_signed: boolean; activated: boolean } | null): JournalGate {
  if (!s) return { kind: "unknown" };
  if (!s.map_signed) return { kind: "blocked", reason: "Ekspor jurnal belum tersedia: posting map belum ditandatangani akuntan", unblock: "Owner mengunggah tanda tangan akuntan di Kepatuhan" };
  if (!s.activated) return { kind: "blocked", reason: "Ekspor jurnal belum tersedia: buku besar belum diaktifkan", unblock: "Keuangan mengaktifkan buku di Buku Besar" };
  return { kind: "open" };
}
// Commission batches export per recipient once submitted (pending approval, approved or paid; 0102).
export const exportableBatch = (state: string) => state !== "draft";
export const ALL_KINDS = EXPORT_KINDS;
