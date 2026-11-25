// Kirim Laporan Terjadwal reader (19 §2.13, UX-38 ▸ Jadwal, PR-80, SET-37; Owner only).
// Reads SET-37 through existing setting_value_at() and tenant primary timezone; zero migration, zero PII.
import type pg from "pg";
import { EXCEPTIONS, optIn, primaryZone, type OptIn, type Zone } from "../../../../modules/reporting/digest/digest";
import { settingValue } from "../../../../modules/settings/settings";

export type TerjadwalData = {
  optIn: OptIn;
  zone: Zone;
  branchCount: number;
  exceptionLabels: readonly string[];
};

export async function loadTerjadwalIn(db: pg.ClientBase): Promise<TerjadwalData> {
  const raw = await settingValue(db, "SET-37", null);
  const branches = (
    await db.query<{ id: string; timezone: string; created_at: Date }>(
      `select id, timezone, created_at from branches order by created_at asc, id asc`,
    )
  ).rows;
  const zone = primaryZone(
    branches.map((b) => ({
      id: b.id,
      timezone: b.timezone,
      createdAt: b.created_at.toISOString(),
    })),
  );
  return {
    optIn: optIn(raw),
    zone,
    branchCount: branches.length,
    exceptionLabels: EXCEPTIONS.map((e) => e.label),
  };
}
