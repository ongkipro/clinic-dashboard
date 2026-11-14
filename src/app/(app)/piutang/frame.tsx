// Shared frame of Piutang & Refund (UX-14): the not-ok states, the page shell, money and labels.
import { redirect } from "next/navigation";
import { ListPage } from "../../../components/templates/templates";
import { PermissionState } from "../../../components/ui/states";
import type { NotOk } from "./data";

export function NotOkState({ d, title }: { d: NotOk; title: string }) {
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="piutang dan refund" />;
  if (d.kind === "not-found") return <ListPage as="section" title={title} state={{ kind: "empty", message: "Data tidak ditemukan di cabang ini." }} />;
  return <ListPage as="section" title={title} state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
}
export const Main = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</main>
);
export const card = "grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
export const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const date = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(iso));
export const RECEIVABLE_STATE: Record<string, [string, "warning" | "success" | "neutral"]> = {
  open: ["Terbuka", "warning"], collected: ["Lunas", "success"], written_off: ["Dihapus buku", "neutral"],
};
export const REFUND_STATE: Record<string, [string, "warning" | "success" | "neutral" | "danger"]> = {
  requested: ["Diajukan", "warning"], approved: ["Disetujui", "warning"], paid: ["Dibayar", "success"], failed: ["Ditolak", "danger"],
};
export const METHOD: Record<string, string> = { cash: "Tunai", edc: "EDC", transfer: "Transfer", balance: "Saldo pasien" };
export const who = (p: { name: string | null; mrn: string } | null) => (p ? `${p.name ?? "Pasien"} · ${p.mrn}` : "Pasien");
