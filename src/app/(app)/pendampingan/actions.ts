"use server";
// Pendampingan actions (UX-7, PR-9, CLIN-001–003; T-051): Mulai Pendampingan (open the intake), Simpan Draf,
// Kirim ke Dokter. Each refuses a form rendered in another context first (HYG-009 B2-1), carries the form's
// idempotency key (rotated after every answer: n), and lets the database decide authority. A refused score,
// diagnosis or signing field comes back as a value (audited, nothing written), shown in words.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type FactInput, openIntake, saveIntake, sendIntake } from "../../../modules/clinical/intake/intake";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { CHIP_ORDER, FACT_ORDER, REFUSAL } from "./labels";

export type IntakeState = { error?: string; ok?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya BC cabang ini yang membuka pendampingan, dan hanya BC pembimbingnya yang mengubah.",
  ERR_NOT_FOUND: "Kunjungan tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Intake sudah terkirim atau kunjungan sudah selesai. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian. Keluhan wajib diisi (3–1000 huruf) sebelum dikirim.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: IntakeState, s: IntakeState): IntakeState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("pendampingan: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};

async function inContext<T>(f: FormData, fn: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0], key: string) => Promise<T>): Promise<{ value?: T; error?: string }> {
  const key = str(f, "key");
  if (!UUID.test(key)) return { error: COPY.ERR_INVALID_INPUT };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    return { value: await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key)) };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function openAction(p: IntakeState, f: FormData): Promise<IntakeState> {
  const visit = str(f, "visit");
  if (!UUID.test(visit)) return next(p, { error: COPY.ERR_NOT_FOUND });
  const r = await inContext(f, (db, key) => openIntake(db, key, visit));
  if (r.error) return next(p, { error: r.error });
  redirect(`/pendampingan/${visit}`);
}

// The form's fields: complaint; per fact kind `fact_<kind>` (a new value) or `same_<kind>` (the history fact id
// confirmed unchanged); chips `chip` (repeated); `note`. Sent as given; the database decides.
function payload(f: FormData) {
  const facts: FactInput[] = [];
  for (const kind of FACT_ORDER) {
    const same = str(f, `same_${kind}`);
    const value = str(f, `fact_${kind}`);
    if (UUID.test(same) && !value) facts.push({ kind, same_as: same });
    else if (value) facts.push({ kind, value });
  }
  const chips = f.getAll("chip").filter((c): c is string => typeof c === "string" && CHIP_ORDER.includes(c));
  return { complaint: str(f, "complaint") || null, facts, observation: { chips: chips as never, note: str(f, "note") || null } };
}

export async function saveAction(p: IntakeState, f: FormData): Promise<IntakeState> {
  const intake = str(f, "intake");
  const visit = str(f, "visit");
  if (!UUID.test(intake) || !UUID.test(visit)) return next(p, { error: COPY.ERR_NOT_FOUND });
  const send = str(f, "intent") === "send";
  // Saving and sending are two commands with their own keys (both rendered with the form; a retry replays both).
  const sendKey = str(f, "send_key");
  if (send && !UUID.test(sendKey)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const body = payload(f);
  if (send && (!body.complaint || body.complaint.length < 3)) return next(p, { error: "Isi keluhan utama pasien sebelum dikirim ke dokter." });
  const r = await inContext(f, async (db, key) => {
    const saved = await saveIntake(db, key, intake, body);
    if (!saved.ok) return saved;
    if (send) await sendIntake(db, sendKey, intake);
    return saved;
  });
  if (r.error) return next(p, { error: r.error });
  if (r.value && !r.value.ok) return next(p, { error: REFUSAL[r.value.code] ?? COPY.ERR_INVALID_INPUT });
  revalidatePath(`/pendampingan/${visit}`);
  revalidatePath("/pendampingan");
  return next(p, { ok: send ? "Terkirim ke dokter. Dokter melihat intake ini di pemeriksaan." : "Draf tersimpan." });
}
