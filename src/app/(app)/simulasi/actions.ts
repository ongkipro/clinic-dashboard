"use server";
// Simulasi Pembayaran actions (UX-56; T-073): Aktifkan Port Simulasi (owner, manager), and per simulated charge Lunas,
// Kedaluwarsa, Gagal, Kirim Ulang Webhook. Each refuses a stale context (HYG-009 B2-1); the simulator changes only the
// mock gateway's state and the signed webhook is delivered after the transaction commits, through the same handler as
// the webhook route (r1 P1-3). Non-production only (the database refuses otherwise).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { MockUnavailableError, SIGNATURE_HEADER } from "../../../modules/payments/mock";
import { enableMockPort, receiveMockWebhook, simulate, type SimAction } from "../../../modules/payments/payments";
import { workerPool } from "../../../modules/payments/worker-pool";

export type SimFormState = { error?: string; ok?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: SimAction[] = ["paid", "expired", "failed", "resend"];
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat memakai simulasi.",
  ERR_NOT_FOUND: "Tagihan simulasi tidak ditemukan di cabang ini.",
  ERR_VERSION_CONFLICT: "Status simulasi sudah berubah. Muat ulang halaman.",
  ERR_NOT_AVAILABLE: "Simulasi tidak tersedia di produksi.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
};
const OUTCOME: Record<string, string> = {
  applied: "Webhook diterima dan diterapkan.", flagged: "Webhook diterima; pembayaran ditandai untuk ditinjau.", duplicate: "Webhook ganda diabaikan (tidak ada pembayaran kedua).",
  rejected_amount: "Jumlah tidak cocok: ditolak.", dropped_tenant_mismatch: "Port tidak cocok: diabaikan.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: SimFormState, s: SimFormState): SimFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof MockUnavailableError) return "Kunci server belum terpasang: port simulasi tidak dapat dipakai.";
  if (e instanceof CommandError) return COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("simulasi: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};

export async function enableAction(p: SimFormState, f: FormData): Promise<SimFormState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => enableMockPort(db));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/simulasi");
  return next(p, { ok: "Port simulasi aktif. QRIS, VA, dan Link tersedia di Kasir (SIMULASI)." });
}

export async function simulateAction(p: SimFormState, f: FormData): Promise<SimFormState> {
  const charge = str(f, "charge");
  const action = str(f, "action") as SimAction;
  if (!UUID.test(charge) || !ACTIONS.includes(action)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  let outcome: string;
  try {
    const ctx = rc.active.context;
    const w = await withTenantContext(await appPool(), ctx, (db) => simulate(db, charge, action, ctx.tenantId));
    // After the commit: the same handler as the webhook route, on the unbound pool.
    outcome = (await receiveMockWebhook(await workerPool(), w.rawBody, w.headers[SIGNATURE_HEADER])).outcome;
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/simulasi");
  revalidatePath("/kasir", "layout");
  return next(p, { ok: OUTCOME[outcome] ?? `Webhook: ${outcome}.` });
}
