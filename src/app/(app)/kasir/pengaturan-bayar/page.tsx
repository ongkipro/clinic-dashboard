// Pembayaran (port) (19 §2.7, UX-12 ▸ Pengaturan Bayar, PR-68, T-073; HYG-NAV-2): the owner's view of the payment port — provider,
// environment, active channels, order prefix. Only the simulated gateway exists on main: where it is active every QRIS / VA / Link payment
// is marked SIMULASI and never enters revenue reports (BILL-29); a real provider is not available yet (said, never offered as a button).
// The simulated port is switched on in Simulasi Pembayaran (owner, manager; never in production). Fees per method arrive with a real
// provider. No secret or key version is shown.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadPorts } from "./data";
import { CHANNEL_LABEL, ENV_LABEL, portStatus, PROVIDER_LABEL } from "./model";

export const metadata: Metadata = { title: "Pembayaran — Kasir — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const at = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const Main = ({ children }: { children: React.ReactNode }) => <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</main>;

async function Body() {
  const p = await loadPorts();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Main><PageTitle title="Pembayaran" /><PermissionState object="pengaturan pembayaran" /></Main>;
  const st = portStatus(p.ports, p.env);
  return (
    <Main>
      <PageTitle title="Pembayaran" />
      <p className={muted}>Lingkungan: {ENV_LABEL[p.env] ?? p.env}. Tunai, EDC dan transfer manual selalu tersedia di Kasir; bagian ini untuk QRIS, Virtual Account dan Link Bayar.</p>
      <BlockedState reason="Penyedia pembayaran sungguhan belum tersedia" unblock="Tim pengembang menambahkannya setelah penyedia dan biaya per metode diputuskan" />
      {st.kind === "none" && (
        <div role="status" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--label-2)]">Belum ada port pembayaran.</p>
          {st.canEnableMock
            ? <Link href="/simulasi" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Aktifkan port simulasi di Simulasi Pembayaran</Link>
            : <p className={muted}>Port simulasi tidak tersedia di lingkungan produksi.</p>}
        </div>
      )}
      {p.ports.length > 0 && (
        <ul aria-label="Port pembayaran" className="m-0 grid min-w-0 list-none gap-3 p-0">
          {p.ports.map((x) => (
            <li key={x.id} className="grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="m-0 text-[1.18rem] font-semibold">{PROVIDER_LABEL[x.provider] ?? x.provider}</h2>
                <StatusBadge tone={x.active ? "success" : "locked"}>{x.active ? "Aktif" : "Nonaktif"}</StatusBadge>
                {x.provider === "mock" && <StatusBadge tone="warning">SIMULASI</StatusBadge>}
              </div>
              <dl className="m-0 grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className={muted}>Lingkungan</dt><dd className="m-0">{ENV_LABEL[x.environment] ?? x.environment}</dd>
                <dt className={muted}>Kanal aktif</dt><dd className="m-0">{x.channels.map((ch) => CHANNEL_LABEL[ch] ?? ch).join(", ")}</dd>
                <dt className={muted}>Prefiks pesanan</dt><dd className="m-0 tabular">{x.orderPrefix}</dd>
                <dt className={muted}>Dibuat</dt><dd className="m-0">{at(x.createdAt)}</dd>
                <dt className={muted}>Biaya per metode</dt><dd className="m-0">Belum tersedia (penyedia simulasi)</dd>
              </dl>
              {x.provider === "mock" && <p className={muted}>Pembayaran lewat port ini ditandai SIMULASI dan tidak masuk laporan uang masuk.</p>}
            </li>
          ))}
        </ul>
      )}
    </Main>
  );
}

export default function PengaturanBayarPage() {
  return <Suspense fallback={<Main><LoadingList rows={2} label="Memuat pengaturan pembayaran" /></Main>}><Body /></Suspense>;
}
