"use server";
// Ruang Tindakan actions (UX-9, PR-14; T-064): Mulai, stage / Jeda / Lanjut, Selesai Tindakan, Bahan Tambahan. Each
// refuses a form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key (rotated after
// every answer: n) and lets the database decide authority and validity.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { requestMaterials } from "../../../modules/inventory/materials/materials";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import {
  advanceStage, blockersOf, finishTreatment, type MaterialLine, type Outcome, pauseTreatment, resumeTreatment, type Stage, STAGES, startTreatment,
} from "../../../modules/treatment/treatment";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { BLOCKER_LABEL, OUTCOME_LABEL } from "./labels";

export type RoomFormState = { error?: string; ok?: string; n?: number; blockers?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini di ruang tindakan.",
  ERR_NOT_FOUND: "Kunjungan atau tindakan tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Tindakan sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Aksi ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_START_BLOCKED: "Tindakan belum dapat dimulai.",
  ERR_STOCK_INSUFFICIENT: "Jumlah bahan melebihi yang dikeluarkan untuk tindakan ini.",
  ERR_STOCK_UNFIT: "Ada bahan yang kedaluwarsa, ditarik, atau melewati batas pakai.",
};
const REASON: Record<string, string> = {
  material_request_open: "Masih ada permintaan bahan yang belum dikeluarkan apoteker. Minta apoteker mengeluarkannya atau batalkan permintaannya.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: RoomFormState, s: RoomFormState): RoomFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("ruang: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run(p: RoomFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<unknown>): Promise<RoomFormState> {
  const key = str(f, "key");
  if (!UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    const b = blockersOf(e);
    if (b.length) return next(p, { error: COPY.ERR_START_BLOCKED, blockers: b.map((x) => BLOCKER_LABEL[x] ?? x) });
    return next(p, { error: message(e) });
  }
  revalidatePath("/ruang", "layout");
  return next(p, { ok });
}
const opt = (f: FormData, k: string) => (UUID.test(str(f, k)) ? str(f, k) : null);

// Mulai: the "Sebelum mulai" checklist posts the item, performer (and assistant / supervisor / room / material request)
// and the identity tick.
export async function startAction(p: RoomFormState, f: FormData): Promise<RoomFormState> {
  const visit = str(f, "visit");
  const item = str(f, "item");
  const performer = str(f, "performer");
  if (!UUID.test(visit) || !UUID.test(item)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!UUID.test(performer)) return next(p, { error: "Pilih pelaksana." });
  if (str(f, "identity") !== "on") return next(p, { error: "Konfirmasi identitas pasien terlebih dahulu." });
  return run(p, f, "Tindakan dimulai.", (db, key) => startTreatment(db, key, visit, {
    planItemId: item, performerId: performer, assistantId: opt(f, "assistant"), supervisorId: opt(f, "supervisor"), roomId: opt(f, "room"),
    materialRequestId: opt(f, "request"), identityConfirmed: true,
  }));
}

// Stage forward, Jeda, Lanjut (times only; the timer end never changes anything).
export async function timerAction(p: RoomFormState, f: FormData): Promise<RoomFormState> {
  const execution = str(f, "execution");
  const choice = str(f, "next");
  if (!UUID.test(execution)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (choice === "pause") return run(p, f, "Tindakan dijeda.", (db, key) => pauseTreatment(db, key, execution));
  if (choice === "resume") return run(p, f, "Tindakan dilanjutkan.", (db, key) => resumeTreatment(db, key, execution));
  const stage = choice.replace(/^stage:/, "") as Stage;
  if (!choice.startsWith("stage:") || !STAGES.includes(stage)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, "Tahap berpindah.", (db, key) => advanceStage(db, key, execution, stage));
}

// Selesai Tindakan: one of four outcomes, a reason for a stop, material deviations only (fields m:<request>:<item>).
export async function finishAction(p: RoomFormState, f: FormData): Promise<RoomFormState> {
  const execution = str(f, "execution");
  const outcome = str(f, "outcome") as Outcome;
  const reason = str(f, "reason");
  if (!UUID.test(execution)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!(outcome in OUTCOME_LABEL)) return next(p, { error: "Pilih hasil tindakan." });
  if (outcome !== "completed" && reason.length < 3) return next(p, { error: "Tulis alasan penghentian (minimal 3 huruf)." });
  const materials: Record<string, MaterialLine[]> = {};
  for (const [k, v] of f.entries()) {
    const m = /^m:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(k);
    if (!m || typeof v !== "string" || v.trim() === "") continue;
    const q = v.trim().replace(",", ".");
    if (!QTY.test(q)) return next(p, { error: "Jumlah bahan tidak valid." });
    (materials[m[1]] ??= []).push({ itemId: m[2], quantity: q });
  }
  return run(p, f, `Tindakan dicatat: ${OUTCOME_LABEL[outcome].toLowerCase()}.`, (db, key) =>
    finishTreatment(db, key, execution, { outcome, reason: outcome === "completed" ? null : reason, ...(Object.keys(materials).length ? { materials } : {}) }));
}

// Bahan Tambahan: a new material request of the visit for this item into a ruang depot (the pharmacist issues it).
export async function extraMaterialAction(p: RoomFormState, f: FormData): Promise<RoomFormState> {
  const visit = str(f, "visit");
  const item = str(f, "item");
  const depot = str(f, "depot");
  const stock = str(f, "stock");
  const qty = str(f, "qty").replace(",", ".");
  if (!UUID.test(visit) || !UUID.test(item)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!UUID.test(depot) || !UUID.test(stock)) return next(p, { error: "Pilih depot ruang dan bahan." });
  if (!QTY.test(qty) || Number(qty) <= 0) return next(p, { error: "Tulis jumlah bahan." });
  return run(p, f, "Permintaan bahan tambahan dikirim ke apoteker.", (db, key) =>
    requestMaterials(db, key, { visitId: visit, roomDepotId: depot, planItemId: item, lines: [{ itemId: stock, quantity: qty }] }));
}
