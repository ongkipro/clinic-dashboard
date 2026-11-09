// Hari Ini labels (T-047). A plain module: the server page imports values from here, never from the
// client forms module (T-036 lesson).
export const ZONE: Record<string, string> = { "Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };
export const time = (d: Date, tz: string) => new Intl.DateTimeFormat("id-ID", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
export const dayLabel = (d: string) => new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
export const VIEWS = { semua: "Semua", menunggu: "Menunggu", "belum-bayar": "Belum Bayar" } as const;
export type View = keyof typeof VIEWS;
