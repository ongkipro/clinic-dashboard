"use server";
// Logbook actions (UX-9 ▸ Logbook, PR-82; T-068): Catat (sterilization, calibration / maintenance, B3 waste) and the
// manager's Jadwal (interval and next due date). Each refuses a form rendered in another context first (HYG-009 B2-1),
// carries the form's idempotency key (rotated after every answer: n), and lets the database decide authority.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { recordEntry, setSchedule, type DeviceResult, type EntryInput, type SterilizationMethod, type WasteCategory } from "../../../modules/safety/safety";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { METHOD, RESULT, WASTE } from "./labels";

export type LogFormState = { error?: string; ok?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat mencatat di logbook cabang ini.",
  ERR_NOT_FOUND: "Alat atau ruang tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mencatat logbook.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  performed_on: "Tanggal tidak boleh di masa depan atau lebih dari setahun lalu.",
  interval_days: "Interval 1–1825 hari.",
  quantity_grams: "Jumlah dalam gram, 1 sampai 100.000.000.",
  items: "Tulis alat atau set yang disterilkan.",
  performer_name: "Tulis nama teknisi atau vendor.",
  handler_name: "Tulis nama pengangkut berizin.",
  handover_ref: "Tulis nomor bukti serah (manifes).",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: LogFormState, s: LogFormState): LogFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("logbook: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run(p: LogFormState, f: FormData, ok: string, fn: (db: Db, key: string, branch: string) => Promise<unknown>): Promise<LogFormState> {
  const key = str(f, "key");
  const branch = str(f, "branch");
  if (!UUID.test(key) || !UUID.test(branch)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key, branch));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/logbook");
  return next(p, { ok });
}
const opt = (f: FormData, k: string) => str(f, k) || undefined;

export async function entryAction(p: LogFormState, f: FormData): Promise<LogFormState> {
  const kind = str(f, "kind");
  const performedOn = str(f, "performed_on");
  if (!DATE.test(performedOn)) return next(p, { error: "Pilih tanggal." });
  let e: EntryInput;
  if (kind === "sterilization") {
    const method = str(f, "method");
    const passed = str(f, "passed");
    if (!(method in METHOD)) return next(p, { error: "Pilih metode sterilisasi." });
    if (passed !== "yes" && passed !== "no") return next(p, { error: "Pilih hasil indikator." });
    if (str(f, "items").length < 2) return next(p, { error: REASON.items });
    const dev = str(f, "device");
    const room = str(f, "room");
    e = { kind, performedOn, method: method as SterilizationMethod, items: str(f, "items"), passed: passed === "yes", cycleNo: opt(f, "cycle_no"),
      deviceId: UUID.test(dev) ? dev : undefined, roomId: UUID.test(room) ? room : undefined, note: opt(f, "note") };
  } else if (kind === "calibration" || kind === "maintenance") {
    const dev = str(f, "device");
    const result = str(f, "result");
    if (!UUID.test(dev)) return next(p, { error: "Pilih alat." });
    if (!(result in RESULT)) return next(p, { error: "Pilih hasil." });
    if (str(f, "performer_name").length < 2) return next(p, { error: REASON.performer_name });
    e = { kind, performedOn, deviceId: dev, result: result as DeviceResult, performerName: str(f, "performer_name"), certificateNo: opt(f, "certificate_no"), note: opt(f, "note") };
  } else if (kind === "b3_waste") {
    const cat = str(f, "waste_category");
    const g = str(f, "quantity_grams").replace(/[.\s]/g, "");
    if (!(cat in WASTE)) return next(p, { error: "Pilih kategori limbah." });
    if (!/^\d{1,9}$/.test(g) || Number(g) < 1) return next(p, { error: REASON.quantity_grams });
    if (str(f, "handler_name").length < 2) return next(p, { error: REASON.handler_name });
    if (!str(f, "handover_ref")) return next(p, { error: REASON.handover_ref });
    e = { kind, performedOn, wasteCategory: cat as WasteCategory, quantityGrams: Number(g), handlerName: str(f, "handler_name"), handoverRef: str(f, "handover_ref"), note: opt(f, "note") };
  } else return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, "Catatan disimpan.", (db, key, branch) => recordEntry(db, key, branch, e));
}

export async function scheduleAction(p: LogFormState, f: FormData): Promise<LogFormState> {
  const dev = str(f, "device");
  const kind = str(f, "kind");
  const days = str(f, "interval_days");
  const due = str(f, "next_due_on");
  if (!UUID.test(dev) || (kind !== "calibration" && kind !== "maintenance")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!/^\d{1,4}$/.test(days) || Number(days) < 1 || Number(days) > 1825) return next(p, { error: REASON.interval_days });
  if (!DATE.test(due)) return next(p, { error: "Pilih tanggal jatuh tempo berikutnya." });
  return run(p, f, "Jadwal disimpan.", (db, key, branch) =>
    setSchedule(db, key, branch, { deviceId: dev, kind, intervalDays: Number(days), nextDueOn: due, active: str(f, "active") !== "off" }));
}
