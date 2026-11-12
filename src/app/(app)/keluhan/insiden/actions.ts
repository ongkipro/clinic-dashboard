"use server";
// Insiden actions (UX-28 ▸ Insiden, PR-82; T-068): Catat Insiden (reporters) and the facility head's steps (Tangani,
// Investigasi, Keputusan Pelaporan, Bukti Kirim, Tutup). Each refuses a form rendered in another context first (HYG-009
// B2-1), carries the form's idempotency key (rotated after every answer: n), and lets the database decide authority.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { handleIncident, reportIncident, type IncidentClass, type IncidentStep } from "../../../../modules/safety/safety";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";
import { CLASS_LABEL } from "./labels";

export type IncidentFormState = { error?: string; ok?: string; n?: number; id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan langkah ini pada insiden.",
  ERR_NOT_FOUND: "Insiden, pasien, atau kunjungan tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Insiden sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mencatat insiden.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  investigation_unfinished: "Investigasi belum selesai.",
  report_not_submitted: "Keputusan pelaporan atau bukti kirim belum dicatat.",
  not_taken: "Tangani insiden ini lebih dulu.",
  no_report_required: "Insiden ini diputuskan tidak perlu dilaporkan.",
  "already taken": "Insiden sudah ditangani.",
  "already investigated": "Investigasi sudah dicatat.",
  "already determined": "Keputusan pelaporan sudah dicatat.",
  "already submitted": "Bukti kirim sudah dicatat.",
  "incident closed": "Insiden sudah ditutup.",
  occurred_at: "Waktu kejadian tidak boleh di masa depan atau lebih dari setahun lalu.",
  patient_id: "Kondisi Potensial Cedera tidak menyebut pasien.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: IncidentFormState, s: IncidentFormState): IncidentFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("insiden: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: IncidentFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<R>, id?: (r: R) => string): Promise<IncidentFormState> {
  const key = str(f, "key");
  if (!UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  let r: R;
  try {
    r = await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/keluhan/insiden", "layout");
  return next(p, { ok, ...(id ? { id: id(r) } : {}) });
}

// occurred: a local wall time (Asia/Jakarta of the form) "YYYY-MM-DDTHH:MM" with the browser's offset in minutes.
export async function reportAction(p: IncidentFormState, f: FormData): Promise<IncidentFormState> {
  const branch = str(f, "branch");
  const cls = str(f, "classification");
  const occurred = str(f, "occurred_at");
  const offset = Number(str(f, "tz_offset") || "-420");
  if (!UUID.test(branch)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!(cls in CLASS_LABEL)) return next(p, { error: "Pilih jenis insiden." });
  if (!LOCAL.test(occurred) || !Number.isInteger(offset) || Math.abs(offset) > 840) return next(p, { error: "Isi waktu kejadian." });
  const at = new Date(Date.parse(`${occurred}:00Z`) + offset * 60_000).toISOString();
  if (str(f, "summary").length < 3) return next(p, { error: "Tulis ringkasan kejadian." });
  if (str(f, "immediate_response").length < 3) return next(p, { error: "Tulis tindakan segera yang sudah dilakukan." });
  const pv = str(f, "patient_visit");
  const [patientId, visitId] = pv.includes(":") ? pv.split(":") : [undefined, undefined];
  if (pv && (!UUID.test(patientId ?? "") || !UUID.test(visitId ?? ""))) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, "Insiden dicatat.", (db, key) => reportIncident(db, key, branch, {
    classification: cls as IncidentClass, occurredAt: at, summary: str(f, "summary"), immediateResponse: str(f, "immediate_response"),
    ...(patientId ? { patientId, visitId } : {}),
  }), (r) => r.incidentId);
}

export async function stepAction(p: IncidentFormState, f: FormData): Promise<IncidentFormState> {
  const incident = str(f, "incident");
  const step = str(f, "step");
  if (!UUID.test(incident)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  let s: IncidentStep;
  if (step === "take") s = { step };
  else if (step === "investigate") {
    if (str(f, "investigation").length < 3 || str(f, "root_cause").length < 3) return next(p, { error: "Tulis hasil investigasi dan akar masalah." });
    s = { step, investigation: str(f, "investigation"), rootCause: str(f, "root_cause") };
  } else if (step === "determine") {
    const req = str(f, "report_required");
    if (req === "no") s = { step, reportRequired: false };
    else if (req === "yes") {
      if (str(f, "recipient").length < 2) return next(p, { error: "Tulis penerima laporan." });
      if (!DATE.test(str(f, "due_on"))) return next(p, { error: "Pilih batas waktu pelaporan." });
      s = { step, reportRequired: true, recipient: str(f, "recipient"), dueOn: str(f, "due_on") };
    } else return next(p, { error: "Pilih apakah insiden perlu dilaporkan." });
  } else if (step === "submit") {
    if (!str(f, "reference")) return next(p, { error: "Tulis nomor atau bukti pengiriman laporan." });
    s = { step, reference: str(f, "reference") };
  } else if (step === "close") {
    if (str(f, "corrective_action").length < 3) return next(p, { error: "Tulis tindakan korektif." });
    s = { step, correctiveAction: str(f, "corrective_action") };
  } else return next(p, { error: COPY.ERR_INVALID_INPUT });
  const ok = { take: "Insiden mulai ditangani.", investigate: "Investigasi dicatat.", determine: "Keputusan pelaporan dicatat.", submit: "Bukti kirim dicatat.", close: "Insiden ditutup." }[s.step];
  return run(p, f, ok, (db, key) => handleIncident(db, key, incident, s));
}
