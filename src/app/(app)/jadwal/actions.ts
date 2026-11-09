"use server";
// Jadwal actions (UX-5, PR-83, T-045): find a patient (FO/CS, POST only, minimal projection), Buat Janji,
// load slots for Ubah Jadwal / Buat Janji, and the row actions. Each refuses a form rendered in another
// context first (HYG-009 B2-1); the database decides authority and validation. Every write carries the
// form's per-mount idempotency key.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { findMatches, type Match } from "../../../modules/patients/patients";
import { cancelAppointment, confirmAttendance, markNoShow, reschedule } from "../../../modules/scheduling/appointments/appointments";
import { book, type BookingChannel, slots } from "../../../modules/scheduling/booking/booking";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type JadwalState = { error?: string; ok?: string; values?: Record<string, string>; n?: number };
export type FindState = { error?: string; matches?: Match[]; q?: string; n?: number };
export type SlotState = { error?: string; slots?: { start: string; label: string; staffId: string }[]; date?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mengubah janji ini.",
  ERR_NOT_FOUND: "Janji, pasien atau layanan tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak menerima perubahan ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  slot_taken: "Slot itu baru saja terisi. Pilih slot lain.",
  patient_overlap: "Pasien sudah punya janji di jam yang sama.",
  before_no_show_time: "Belum bisa ditandai tidak datang: tunggu sampai lewat jam janji.",
  not_scheduled: "Janji ini sudah tidak terjadwal.",
  not_booked: "Janji ini sudah dikonfirmasi atau tidak terjadwal.",
  reason: "Tulis alasan pembatalan (minimal 3 huruf).",
  start: "Pilih slot yang valid.",
  channel: "Pilih saluran pemesanan.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const done = <S extends { n?: number }>(prev: S, s: S): S => ({ ...s, n: (prev.n ?? 0) + 1 });
const message = (e: unknown) => {
  // Production before the vendor go-live gate is clear (ARCH-10): a known refusal, not an unknown failure.
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("jadwal: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};

async function ctxOr<S extends { n?: number; error?: string }>(prev: S, f: FormData) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { stop: done(prev, { error: COPY.ERR_FORBIDDEN } as S) };
  if (staleContext(f, rc.active.context)) return { stop: done(prev, { error: STALE_CONTEXT } as S) };
  return { ctx: rc.active.context };
}

async function write(prev: JadwalState, f: FormData, work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0], key: string) => Promise<unknown>, ok: string): Promise<JadwalState> {
  const c = await ctxOr(prev, f);
  if ("stop" in c) return c.stop!;
  const key = str(f, "key");
  if (!UUID.test(key)) return done(prev, { error: COPY.ERR_VERSION_CONFLICT, values: keep(f) });
  try {
    await withTenantContext(await appPool(), c.ctx, (db) => work(db, key));
  } catch (e) {
    return done(prev, { error: message(e), values: keep(f) });
  }
  revalidatePath("/jadwal");
  return done(prev, { ok });
}

// Cari pasien (FO and Central CS): the query is in the POST body only, never in a URL or a log.
export async function findPatientAction(prev: FindState, f: FormData): Promise<FindState> {
  const c = await ctxOr(prev, f);
  if ("stop" in c) return c.stop!;
  const q = str(f, "q");
  if (q.length < 2) return done(prev, { error: "Tulis minimal 2 huruf atau angka.", q: "" });
  const kind = /^RM-?\d+$/i.test(q) ? "mrn" : /^[+0-9][0-9 ()-]{6,}$/.test(q) ? "phone" : "name";
  try {
    const m = await withTenantContext(await appPool(), c.ctx, (db) =>
      findMatches(db, kind === "mrn" ? { mrn: q.replace(/^RM(?!-)/i, "RM-") } : kind === "phone" ? { phone: q } : { name: q }));
    return done(prev, { matches: m.slice(0, 20), q: "" });
  } catch (e) {
    return done(prev, { error: message(e), q: "" });
  }
}

// Valid slots of a service (Buat Janji) or of an appointment's service (Ubah Jadwal) on a date.
export async function slotsAction(prev: SlotState, f: FormData): Promise<SlotState> {
  const c = await ctxOr(prev, f);
  if ("stop" in c) return c.stop!;
  const branch = str(f, "branch"), version = str(f, "version"), date = str(f, "date"), staff = str(f, "staff");
  if (!UUID.test(branch) || !UUID.test(version) || !DATE.test(date) || (staff && !UUID.test(staff))) return done(prev, { error: "Pilih layanan dan tanggal." });
  try {
    const s = await withTenantContext(await appPool(), c.ctx, (db) => slots(db, { branchId: branch, versionId: version, date, staffId: staff || null }));
    const tz = str(f, "tz") || "Asia/Jakarta";
    const fmt = new Intl.DateTimeFormat("id-ID", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    return done(prev, { date, slots: s.map((x) => ({ start: x.startsAt.toISOString(), label: fmt.format(x.startsAt), staffId: x.staffId })) });
  } catch (e) {
    return done(prev, { error: message(e) });
  }
}

export async function createAction(prev: JadwalState, f: FormData): Promise<JadwalState> {
  const branch = str(f, "branch"), patient = str(f, "patient"), version = str(f, "version"), start = str(f, "start");
  if (!UUID.test(patient)) return done(prev, { error: "Pilih pasien.", values: keep(f) });
  if (!UUID.test(branch) || !UUID.test(version)) return done(prev, { error: "Pilih layanan.", values: keep(f) });
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return done(prev, { error: COPY.start, values: keep(f) });
  return write(prev, f, (db, key) => book(db, key, {
    branchId: branch, patientId: patient, versionId: version, startsAt: at, staffId: UUID.test(str(f, "staff")) ? str(f, "staff") : null,
    channel: str(f, "channel") as BookingChannel, note: str(f, "note") || null,
  }), "Janji tersimpan.");
}

export async function confirmAction(prev: JadwalState, f: FormData): Promise<JadwalState> {
  const id = str(f, "id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, (db, key) => confirmAttendance(db, key, id), "Kedatangan dikonfirmasi.");
}
export async function cancelAction(prev: JadwalState, f: FormData): Promise<JadwalState> {
  const id = str(f, "id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, (db, key) => cancelAppointment(db, key, id, str(f, "reason")), "Janji dibatalkan.");
}
export async function noShowAction(prev: JadwalState, f: FormData): Promise<JadwalState> {
  const id = str(f, "id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, (db, key) => markNoShow(db, key, id), "Ditandai tidak datang.");
}
export async function rescheduleAction(prev: JadwalState, f: FormData): Promise<JadwalState> {
  const id = str(f, "id");
  const at = new Date(str(f, "start"));
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (Number.isNaN(at.getTime())) return done(prev, { error: COPY.start, values: keep(f) });
  return write(prev, f, (db, key) => reschedule(db, key, id, at, UUID.test(str(f, "staff")) ? str(f, "staff") : null), "Jadwal diubah.");
}
