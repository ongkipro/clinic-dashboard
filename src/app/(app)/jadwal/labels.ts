// Jadwal labels (T-045). A plain module: server pages import values from here, never from the client
// forms module (T-036 lesson).
import type { StatusTone } from "../../../components/ui/status-badge";

export const STATE: Record<string, { label: string; tone: StatusTone }> = {
  held: { label: "Menunggu DP", tone: "warning" },
  booked: { label: "Terjadwal", tone: "neutral" },
  confirmed: { label: "Dikonfirmasi", tone: "success" },
  arrived: { label: "Datang", tone: "success" },
  no_show: { label: "Tidak Datang", tone: "danger" },
  cancelled: { label: "Dibatalkan", tone: "locked" },
  rescheduled: { label: "Dijadwal Ulang", tone: "locked" },
};
export const ZONE: Record<string, string> = { "Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };
export const CHANNEL: Record<string, string> = { walk_in: "Datang langsung", phone: "Telepon", whatsapp: "WhatsApp", staff: "Staf" };
export const time = (d: Date, tz: string) => new Intl.DateTimeFormat("id-ID", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
export const dayLabel = (d: string) => new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
export const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
