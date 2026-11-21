// Rekonsiliasi (UX-22 ▸ Rekon, PR-34; T-108) view model: copy and props for the presentational view (view.tsx). The report comes from
// the pure engine (src/modules/accounting/recon); references and drill-down hrefs are supplied by the caller (page.tsx at wiring).
// Amounts are integer rupiah; a cell the engine could not compute is "Belum tersedia", never Rp0. No clinical content: document
// references, branch names, days and amounts only.
import type { ListState } from "../../../../components/templates/templates";
import type { CellStatus, Item, ItemKind, Metric, ReconReport, Ref, Verdict } from "../../../../modules/accounting/recon/recon";

export type ScreenState<D> = Exclude<ListState, { kind: "rows" }> | { kind: "ready"; data: D };
export type Scope = { branches: { id: string; name: string }[]; branch: string | null; from: string; to: string; action: string; period: string };
export type RekonProps = {
  scope: Scope;
  hrefFor: (ref: Ref) => string | undefined; // drill-down to the source document; undefined = no page yet (no link rendered)
  ledgerHref: string; // Buku Besar for the period
  state: ScreenState<ReconReport>;
  as?: "main" | "section";
};

export const UNAVAILABLE = "Belum tersedia";
export const STATUS: Record<CellStatus, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  cocok: { label: "Cocok", tone: "success" },
  selisih: { label: "Selisih", tone: "danger" },
  menunggu: { label: "Menunggu posting", tone: "warning" },
  waktu: { label: "Beda periode buku", tone: "neutral" },
  tidak_tersedia: { label: UNAVAILABLE, tone: "neutral" },
};
export const KIND: Record<ItemKind, string> = {
  missing: "Belum diposting ke buku besar",
  queued: "Menunggu posting (antrean)",
  orphan: "Ada di buku besar, tidak ada di operasional",
  amount: "Jumlah berbeda",
  placement: "Tanggal atau cabang berbeda",
  timing: "Dibukukan di periode lain",
};
export const VERDICT: Record<Verdict, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  bersih: { label: "Semua cocok", tone: "success" },
  ada_selisih: { label: "Ada selisih", tone: "danger" },
  menunggu_posting: { label: "Menunggu posting", tone: "warning" },
  ada_pengecualian: { label: "Ada pengecualian", tone: "warning" },
  tidak_lengkap: { label: "Belum lengkap", tone: "neutral" },
};
export type { Metric };

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
export const rp = (n: number) => idr.format(n).replace(/\s/g, "");
export const signed = (n: number) => (n === 0 ? "Rp0" : `${n < 0 ? "−" : "+"}${rp(Math.abs(n))}`);
export const amount = (n: number | null) => (n === null ? "—" : rp(n));
export const day = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
export const period = (p: string) => new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${p}-01T00:00:00Z`));

// One line of explanation per item, the reference first (Scenario PR-34: "the difference is listed with the payment reference").
export function explain(i: Item): string {
  if (i.kind === "timing") return `${i.ref.label} · ${KIND.timing}: ${period(i.bookedPeriod ?? "")} (bulan asal dikunci)`;
  return `${i.ref.label} · ${KIND[i.kind]} · ${signed(i.difference)}`;
}

// Filter links keep the period and set or clear the branch.
export function scopeHref(s: Scope, branch: string | null) {
  const p = new URLSearchParams({ dari: s.from, sampai: s.to });
  if (branch) p.set("cabang", branch);
  return `${s.action}?${p}`;
}
