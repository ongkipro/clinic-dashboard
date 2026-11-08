"use server";
// Jadwal Staf actions (UX-33, PR-48, T-043): save the week, add or cancel leave. Each refuses a form
// rendered in another context first (HYG-009 B2-1); the database decides authority and validation. The
// grid posts the staff it shows (staff=<id>, repeated) and one cell per staff and day:
// s_<staffId>_<date>_starts / _ends and optional _bstart / _bend.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { addLeave, cancelLeave, type LeaveKind, type ShiftRow, setWeek } from "../../../modules/scheduling/rosters/rosters";

export type JadwalState = { error?: string; ok?: string; values?: Record<string, string>; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mengubah jadwal ini.",
  ERR_NOT_FOUND: "Cabang atau data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  appointment_conflict: "Jadwal bentrok dengan janji temu yang sudah dipesan.",
  shift_overlap: "Staf ini sudah terjadwal di jam yang sama (di cabang ini atau cabang lain).",
  break_outside_shift: "Istirahat harus berada di dalam jam kerja hari itu.",
  break_overlap: "Jam istirahat saling bertumpuk.",
  staff_shifts_range_check: "Jam selesai harus setelah jam mulai.",
  shift_past: "Hari yang sudah lewat tidak dapat diubah.",
  outside_week: "Tanggal di luar minggu yang dibuka.",
  staff_not_at_branch: "Staf tidak ditugaskan di cabang ini.",
  staff_not_listed: "Data jadwal tidak cocok dengan daftar staf. Muat ulang halaman.",
  staff: "Daftar staf tidak valid. Muat ulang halaman.",
  rows: "Tulis jam dengan format JJ:MM, misalnya 09:00.",
  week: "Minggu tidak valid. Muat ulang halaman.",
  leave_past: "Cuti tidak boleh dimulai sebelum hari ini (zona waktu cabang).",
  leave_cancelled: "Cuti ini sudah dibatalkan.",
  dates: "Tanggal selesai harus sama atau setelah tanggal mulai.",
  kind: "Pilih jenis ketidakhadiran.",
  reason: "Tulis alasan (minimal 3 huruf).",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$"))) as Record<string, string>;
const done = (prev: JadwalState, s: JadwalState): JadwalState => ({ ...s, n: (prev.n ?? 0) + 1 });

async function run(prev: JadwalState, f: FormData, work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0]) => Promise<unknown>, ok: string): Promise<JadwalState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return done(prev, { error: COPY.ERR_FORBIDDEN, values: keep(f) });
  if (staleContext(f, rc.active.context)) return done(prev, { error: STALE_CONTEXT, values: keep(f) });
  try {
    await withTenantContext(await appPool(), rc.active.context, work);
  } catch (e) {
    if (e instanceof CommandError) {
      const r = (e as { reason?: string }).reason ?? "";
      return done(prev, { error: COPY[r] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN, values: keep(f) });
    }
    console.error("jadwal-staf: save failed", { error: e instanceof Error ? e.name : "unknown" });
    return done(prev, { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", values: keep(f) });
  }
  revalidatePath("/jadwal-staf");
  // Success: the page reloads from the database; no values are carried (the fields remount from data).
  return done(prev, { ok });
}

const CELL = /^s_([0-9a-f-]{36})_(\d{4}-\d{2}-\d{2})_(starts|ends|bstart|bend)$/i;
// The grid's cells as roster rows: a work shift when both times are set, a break when both break times are.
function weekRows(f: FormData): ShiftRow[] {
  const cells = new Map<string, Record<string, string>>();
  for (const [k, v] of f.entries()) {
    const m = CELL.exec(k);
    if (!m || typeof v !== "string" || !v.trim()) continue;
    const key = `${m[1]}|${m[2]}`;
    cells.set(key, { ...(cells.get(key) ?? {}), [m[3]]: v.trim() });
  }
  const rows: ShiftRow[] = [];
  for (const [key, c] of cells) {
    const [staffId, date] = key.split("|");
    if (c.starts || c.ends) rows.push({ staffId, date, starts: c.starts ?? "", ends: c.ends ?? "", kind: "work" });
    if (c.bstart || c.bend) rows.push({ staffId, date, starts: c.bstart ?? "", ends: c.bend ?? "", kind: "break" });
  }
  return rows;
}

export async function saveWeekAction(prev: JadwalState, f: FormData): Promise<JadwalState> {
  const branch = str(f, "branch");
  const week = str(f, "week");
  if (!UUID.test(branch) || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return done(prev, { error: COPY.week, values: keep(f) });
  // The staff the form showed (a role-filtered grid replaces only those; impl review r1 P1).
  const staff = f.getAll("staff").filter((x): x is string => typeof x === "string" && UUID.test(x));
  const rows = weekRows(f);
  return run(prev, f, (db) => setWeek(db, branch, week, staff, rows), "Jadwal minggu ini tersimpan.");
}

export async function addLeaveAction(prev: JadwalState, f: FormData): Promise<JadwalState> {
  const branch = str(f, "branch");
  const staff = str(f, "staff");
  const from = str(f, "from");
  const to = str(f, "to") || from;
  if (!UUID.test(branch)) return done(prev, { error: COPY.week, values: keep(f) });
  if (!UUID.test(staff)) return done(prev, { error: "Pilih staf.", values: keep(f) });
  // Validated here: a blank date would fail the ::date cast before the function runs (impl review r1 P2).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return done(prev, { error: "Isi tanggal mulai (dan selesai, bila lebih dari sehari).", values: keep(f) });
  return run(prev, f, (db) => addLeave(db, { branchId: branch, staffId: staff, kind: str(f, "kind") as LeaveKind, from, to, reason: str(f, "reason") }), "Ketidakhadiran dicatat.");
}

export async function cancelLeaveAction(prev: JadwalState, f: FormData): Promise<JadwalState> {
  const id = str(f, "id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return run(prev, f, (db) => cancelLeave(db, id, str(f, "reason")), "Ketidakhadiran dibatalkan.");
}
