// Status Backup (UX-32 ▸ Backup; DR-1 RPO <= 15 min / RTO <= 2 h; T-122 D7).
// Honest by construction: reads "not_measured" ("Belum terpantau") until a vendor-recorded
// pgBackRest backup or restore drill with evidence reference exists (T-131).
export const ROUTE = "/ekspor/backup";
export const BACKUP_STALE_HOURS = 26;
export const DRILL_STALE_DAYS = 92;
export const TARGETS = { rpoMinutes: 15, rtoHours: 2 } as const;

export type Signal =
  | { kind: "not_measured"; why: string }
  | { kind: "value"; at: string; evidence: string; stale: boolean };

export type BackupModel =
  | { kind: "blocked"; reason: string; unblock: string }
  | { kind: "ok"; backup: Signal; drill: Signal; now: string };

const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,79}$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const WHY = {
  backup: "Catatan backup dari vendor belum tersedia",
  drill: "Catatan uji restore dari vendor belum tersedia",
} as const;

export function signal(v: unknown, now: Date, staleMs: number, why: string): Signal {
  const o = obj(v);
  const at = iso(o.at);
  const evidence = typeof o.evidence === "string" && REF.test(o.evidence) ? o.evidence : null;
  if (!at || !evidence || Date.parse(at) > now.getTime()) return { kind: "not_measured", why };
  return { kind: "value", at, evidence, stale: now.getTime() - Date.parse(at) > staleMs };
}

export function projectBackup(o: { actingRole: string; source: unknown; now: Date }): BackupModel {
  if (o.actingRole !== "owner") {
    return { kind: "blocked", reason: "Status backup hanya untuk Owner", unblock: "Owner dapat melihat status backup" };
  }
  const s = obj(o.source);
  return {
    kind: "ok",
    backup: signal(s.last_backup, o.now, BACKUP_STALE_HOURS * 3_600_000, WHY.backup),
    drill: signal(s.last_restore_drill, o.now, DRILL_STALE_DAYS * 86_400_000, WHY.drill),
    now: o.now.toISOString(),
  };
}

export const instant = (v: string): string =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(v));
