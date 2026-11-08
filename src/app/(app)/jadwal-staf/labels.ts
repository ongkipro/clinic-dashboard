// Jadwal Staf labels (T-043). A plain module: server pages import values from here, never from the client
// forms module (the T-036 lesson: a value imported from "use client" is a client reference).
export const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
export const ROLE_LABEL: Record<string, string> = { doctor: "Dokter", nurse: "Perawat", therapist: "Terapis", bc: "Beauty consultant", fo_cashier: "FO/Kasir" };
export const LEAVE_LABEL: Record<string, string> = { leave: "Cuti", sick: "Sakit", absent: "Izin" };
export const dayLabel = (d: string) => new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
