"use server";
// Piutang & Kewajiban Layanan actions (UX-22 ▸ Kewajiban; T-104, owner D-A1): Catat PPN Masukan and Catat Setoran PPN. Each refuses a form
// rendered in another context first (HYG-009 B2-1), carries the form's idempotency key (rotated after every answer: n) and lets the database
// decide authority (finance), PKP status and the period total.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { isCalendarDate, recordVatInputCredit, recordVatPayment } from "../../../../modules/accounting/subledgers/subledgers";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";

export type VatState = { error?: string; ok?: string; n?: number; values?: Record<string, string> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya Keuangan yang dapat mencatat PPN.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_NOT_AVAILABLE: "Klinik tidak berstatus PKP pada masa pajak ini.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mencatat PPN.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  below_zero: "Koreksi ini membuat total masa pajak di bawah nol.",
  period: "Masa pajak tidak boleh setelah bulan ini, dan tanggal harus di dalam atau setelah masa pajak tanpa melewati hari ini.",
  reason: "Koreksi (jumlah negatif) wajib diberi alasan 10–500 karakter.",
  amount: "Isi jumlah selain nol.",
  not_pkp: COPY.ERR_NOT_AVAILABLE,
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const money = (s: string) => Number(s.replace(/[.\s]/g, "").replace(/^Rp/i, ""));
const next = (p: VatState, s: VatState): VatState => ({ ...s, n: (p.n ?? 0) + 1 });
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    return REASON[r] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("kewajiban: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};

async function save(p: VatState, f: FormData, kind: "input" | "paid"): Promise<VatState> {
  const period = str(f, "period");
  const amount = money(str(f, "amount"));
  const date = str(f, "date");
  const reference = str(f, "reference");
  const reason = str(f, "reason");
  const bad = (error: string) => next(p, { error, values: keep(f) });
  if (!PERIOD.test(period)) return bad("Pilih masa pajak.");
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000_000_000) return bad(REASON.amount);
  if (!isCalendarDate(date)) return bad("Isi tanggal yang benar.");
  if (reference.length < 1 || reference.length > (kind === "input" ? 80 : 40)) return bad(kind === "input" ? "Isi referensi faktur masukan (maksimal 80 karakter)." : "Isi NTPN (maksimal 40 karakter).");
  if (amount < 0 && (reason.length < 10 || reason.length > 500)) return bad(REASON.reason);
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  const key = str(f, "key");
  if (!UUID.test(key)) return bad(COPY.ERR_INVALID_INPUT);
  const fact = { taxPeriod: period, amount, date, reference, reason: amount < 0 ? reason : null };
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => (kind === "input" ? recordVatInputCredit(db, key, fact) : recordVatPayment(db, key, fact)));
  } catch (e) {
    return bad(message(e));
  }
  revalidatePath("/keuangan/kewajiban");
  return next(p, { ok: kind === "input" ? "PPN masukan dicatat." : "Setoran PPN dicatat." });
}
export async function inputCreditAction(p: VatState, f: FormData): Promise<VatState> {
  return save(p, f, "input");
}
export async function vatPaidAction(p: VatState, f: FormData): Promise<VatState> {
  return save(p, f, "paid");
}
