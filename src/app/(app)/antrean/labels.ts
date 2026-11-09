// Antrean labels (T-048). A plain module: the server page imports values from here, never from the client
// forms module (T-036 lesson).
import type { StatusTone } from "../../../components/ui/status-badge";

export const ZONE: Record<string, string> = { "Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };
export const time = (d: Date, tz: string) => new Intl.DateTimeFormat("id-ID", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
export const STATE: Record<string, { label: string; tone: StatusTone }> = {
  waiting: { label: "Menunggu", tone: "neutral" },
  called: { label: "Dipanggil", tone: "success" },
  skipped: { label: "Dilewati", tone: "warning" },
  done: { label: "Selesai", tone: "locked" },
};
