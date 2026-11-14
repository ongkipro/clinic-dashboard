// Labels of Biaya Operasional & Kas Kecil (UX-22 ▸ Biaya; T-084).
export const FUNDING: Record<string, string> = { petty_cash: "Kas Kecil", cash: "Tunai", bank: "Bank", unpaid: "Belum Dibayar" };
export const PAYABLE: Record<string, [string, "warning" | "success" | "neutral"]> = {
  open: ["Utang terbuka", "warning"], paid: ["Utang lunas", "success"], reversed: ["Utang dibatalkan", "neutral"],
};
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const day = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const ROLE: Record<string, string> = { owner: "Owner", finance: "Keuangan", manager: "Manajer Cabang" };
