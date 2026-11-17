"use server";
// Saya › Tagihan Server action (UX-49; T-103 increment 2): Bayar. Refuses a form rendered in another context first (HYG-009 B2-1); the
// database decides the role, the invoice, the gates (fee bearer, one open attempt) and the amount. The provider call runs between begin and
// the token-fenced finish (addendum a2-1); the finish token never leaves this server process. No live AutoLaris: the port is the local mock or
// absent (then the page never offers Bayar and this action refuses).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { workerPool } from "../../../../modules/payments/worker-pool";
import { bayar } from "../../../../modules/vendor/billing/billing";
import { billingPort } from "../../../../modules/vendor/billing/server-port";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export type BayarState = { error?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  fee_policy_pending: "Pembayaran belum tersedia. Vendor belum menetapkan biaya channel.",
  fee_policy_unsupported: "Pembayaran belum tersedia.",
  attempt_open: "Masih ada pembayaran yang menunggu kepastian. Gunakan instruksi yang sudah ada atau tunggu statusnya.",
  invoice_closed: "Tagihan ini sudah selesai. Muat ulang halaman.",
  nothing_payable: "Tidak ada sisa yang perlu dibayar.",
  channel_unavailable: "Metode bayar ini sedang tidak tersedia. Pilih metode lain.",
};
const CODE: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat membayar tagihan server.",
  ERR_NOT_FOUND: "Tagihan tidak ditemukan. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali pilihan metode bayar.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: BayarState, s: BayarState): BayarState => ({ ...s, n: (p.n ?? 0) + 1 });

export async function bayarAction(p: BayarState, f: FormData): Promise<BayarState> {
  const key = str(f, "key");
  const invoice = str(f, "invoice");
  const channel = str(f, "channel");
  if (!UUID.test(key) || !UUID.test(invoice) || !/^[A-Z0-9_]{2,20}$/.test(channel)) return next(p, { error: "Pilih metode bayar." });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: CODE.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  const port = billingPort();
  if (!port) return next(p, { error: "Pembayaran belum tersedia." });
  let state: string;
  try {
    // the provider's customer is the tenant (legal entity) — from the bound context, never from the form; no patient data
    const payer = await withTenantContext(await appPool(), rc.active.context, async (db) => {
      const t = (await db.query<{ n: string }>(`select legal_name n from tenants`)).rows[0]?.n ?? "Klinik";
      return { id: rc.active.context.tenantId.replace(/-/g, "").slice(0, 20), name: t.slice(0, 80), phone: "", email: "" };
    });
    const r = await bayar(await appPool(), await workerPool(), rc.active.context, port, { key, invoiceId: invoice, channel, payer });
    state = r.state;
  } catch (e) {
    if (e instanceof CommandError) {
      const reason = (e as { reason?: string }).reason;
      return next(p, { error: (reason && COPY[reason]) || CODE[e.code] || CODE.ERR_FORBIDDEN });
    }
    console.error("tagihan-server: bayar failed", { error: e instanceof Error ? e.name : "unknown" });
    return next(p, { error: "Pembayaran belum pasti dibuat. Muat ulang untuk melihat statusnya." });
  }
  revalidatePath("/saya/tagihan-server");
  redirect(`/saya/tagihan-server?ok=${state === "pending" ? "dibuat" : state === "failed" ? "gagal" : "menunggu"}`);
}
