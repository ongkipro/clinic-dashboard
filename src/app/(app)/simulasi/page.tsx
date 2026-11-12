// Simulasi Pembayaran (UX-56, 19:119; T-073): only where the payment port is the mock and the deployment is not
// production (BILL-29). A SIMULASI banner; the tenant's simulated charges (pending first) with Lunas · Kedaluwarsa ·
// Gagal · Kirim Ulang Webhook; Aktifkan Port Simulasi for owner and manager before the port exists. Amounts never
// enter K1.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { simulasiList, type SimulasiList } from "../../../modules/payments/payments";
import { deployEnv } from "../../../modules/vendor/profile/profile";
import { EnableForm, SimActions } from "./forms";

export const metadata: Metadata = { title: "Simulasi Pembayaran — Clinic Dashboard" };
const READERS = new Set(["owner", "manager", "fo_cashier", "finance"]);
const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rp = (n: number) => idr.format(Number(n)).replace(/\s/g, "");
const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const CH = { qris: "QRIS", va: "VA", payment_link: "Link Bayar" } as const;
const STATE: Record<string, { label: string; tone: "success" | "warning" | "locked" | "danger" }> = {
  pending: { label: "Menunggu", tone: "warning" }, paid: { label: "Lunas", tone: "success" }, expired: { label: "Kedaluwarsa", tone: "locked" },
  failed: { label: "Gagal", tone: "danger" }, cancelled: { label: "Dibatalkan", tone: "locked" },
};
const card = "grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

async function Body() {
  if (deployEnv() === "production") notFound();
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return <PermissionState object="simulasi pembayaran" />;
  let d: SimulasiList;
  try {
    d = await withTenantContext(await appPool(), c, (db) => simulasiList(db));
  } catch (e) {
    if (e instanceof CommandError) return <PermissionState object="simulasi pembayaran" />;
    throw e;
  }
  const ctx = renderedContext(c);
  return (
    <>
      <p role="note" className="m-0 rounded-[var(--radius-field)] bg-[var(--warning-soft)] px-4 py-3 font-semibold text-[var(--warning)]">
        SIMULASI — gateway tiruan. Tidak ada uang sungguhan dan tidak masuk laporan pendapatan.
      </p>
      <ListPage as="section" title="Simulasi Pembayaran"
        state={!d.port ? { kind: "empty", message: d.can_enable ? "Port simulasi belum aktif." : "Port simulasi belum aktif. Owner atau manajer dapat mengaktifkannya di sini." }
          : d.charges.length === 0 ? { kind: "empty", message: "Belum ada tagihan QRIS, VA, atau Link. Buat dari Kasir." } : { kind: "rows" }}>
        <ul aria-label="Tagihan simulasi" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {d.charges.map((x) => {
            const st = STATE[x.state] ?? STATE.pending;
            return (
              <li key={x.id} className={card}>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold">{`${CH[x.channel]} ${rp(x.amount)}`}</span>
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  {x.review_flag && <StatusBadge tone="danger">Perlu ditinjau</StatusBadge>}
                </div>
                <p className={muted}>{`dibuat ${when(x.created_at)} · gateway: ${x.mock_state ?? "-"}${x.balance_pending ? ` · ${rp(x.balance_pending)} menunggu saldo` : ""}`}</p>
                <Link href={`/kasir/${x.invoice_id}`} className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">
                  {`Buka ${x.invoice_number ?? "tagihan"}`}
                </Link>
                <SimActions ctx={ctx} charge={x.id} label={`${CH[x.channel]} ${rp(x.amount)}`} open={x.mock_state === "pending"} sent={!!x.mock_event} />
              </li>
            );
          })}
        </ul>
      </ListPage>
      {!d.port && d.can_enable && <EnableForm ctx={ctx} />}
    </>
  );
}

export default function SimulasiPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={3} />}><Body /></Suspense>
    </main>
  );
}
