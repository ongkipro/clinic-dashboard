// Paket & Saldo of a patient (UX-13; T-076): active packages (paid, Terpakai, Dipesan, available, expiry) with Pesan Sesi
// ("Perlu bayar RpX lagi" when the paid value does not cover the next session), Bayar Cicilan (the package tagihan),
// Batalkan Paket (owner/manager); the balance with its entries and Isi Saldo. Closed packages below. No clinical content.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DetailPage } from "../../../../../components/templates/templates";
import { LoadingList } from "../../../../../components/ui/states";
import { StatusBadge, type StatusTone } from "../../../../../components/ui/status-badge";
import { card, Main, muted, NotOkState } from "../../frame";
import { rp, when } from "../../labels";
import { loadPatient } from "../data";
import { CancelForm, ReleaseForm, ReserveForm, TopUpForm } from "../forms";

export const metadata: Metadata = { title: "Paket & Saldo — Kasir — Clinic Dashboard" };

const PKG: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Aktif", tone: "success" }, expired: { label: "Kedaluwarsa", tone: "locked" }, cancelled: { label: "Dibatalkan", tone: "neutral" },
};
const SESSION: Record<string, string> = { available: "Tersedia", reserved: "Dipesan", redeemed: "Terpakai", closed: "Ditutup" };
const KIND: Record<string, string> = {
  top_up: "Isi saldo", use: "Dipakai bayar", from_expiry: "Paket kedaluwarsa", from_cancel: "Paket dibatalkan", from_interrupted_treatment: "Tindakan dihentikan",
  from_substitution: "Selisih tukar sesi", from_refund: "Refund", dp_transfer: "Pindahan DP", cash_refund: "Refund tunai", opening_balance: "Saldo awal",
};

async function Body({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const d = await loadPatient(patientId);
  if (d.kind !== "ok") return <NotOkState d={d.kind === "not-found" ? { kind: "not-found" } : d} title="Paket & Saldo" />;
  const { p, b } = d;
  const active = p.packages.filter((x) => x.state === "active");
  const closed = p.packages.filter((x) => x.state !== "active");
  const label = p.patient ? `${p.patient.name ?? "Pasien"} · ${p.patient.mrn}` : "Pasien";
  const packages = (
    <div className="grid min-w-0 gap-4">
      {active.length === 0 && <p className={muted}>Belum ada paket aktif. Paket dibeli lewat tagihan paket di Kasir.</p>}
      {active.map((x) => {
        const available = x.sessions.filter((s) => s.state === "available");
        const services = [...new Map(available.map((s) => [s.service_item_id, { id: s.service_item_id, name: s.service ?? "Layanan" }])).values()];
        const blocked = x.next_need === null ? "Semua sesi sudah dipesan atau terpakai." : x.next_need > 0 ? `Perlu bayar ${rp(x.next_need)} lagi untuk sesi berikutnya.` : null;
        return (
          <article key={x.id} aria-label={x.name} className={card}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[1.12rem] font-semibold [overflow-wrap:anywhere]">{x.name}</h3>
              <StatusBadge tone={PKG[x.state].tone}>{PKG[x.state].label}</StatusBadge>
            </div>
            <dl className="m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-x-3 gap-y-2">
              <div><dt className={muted}>Dibayar</dt><dd className="m-0 font-semibold">{`${rp(x.paid)} / ${rp(x.price)}`}</dd></div>
              <div><dt className={muted}>Terpakai</dt><dd className="m-0 font-semibold">{x.redeemed}</dd></div>
              <div><dt className={muted}>Dipesan</dt><dd className="m-0 font-semibold">{x.reserved}</dd></div>
              <div><dt className={muted}>Berlaku sampai</dt><dd className="m-0 font-semibold">{when(x.validity_end)}</dd></div>
            </dl>
            <p className={muted}>{`Dijual di ${x.sold_branch.name}. Sesi terbuka sesuai nilai yang sudah dibayar.`}</p>
            <ol aria-label={`Sesi ${x.name}`} className="m-0 grid min-w-0 list-none gap-1 p-0">
              {x.sessions.map((s) => (
                <li key={s.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--separator)] py-1">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{`${s.seq}. ${s.service ?? "Layanan"} · ${rp(s.value)}`}</span>
                  <span className={muted}>{SESSION[s.state]}{s.redeemed_branch ? ` · ${s.redeemed_branch}` : ""}{s.pending_substitution ? " · tukar menunggu" : ""}</span>
                  {s.state === "reserved" && p.can_reserve && <ReleaseForm ctx={d.ctx} session={s.id} />}
                </li>
              ))}
            </ol>
            {p.can_reserve && <ReserveForm ctx={d.ctx} pkg={x.id} visits={p.visits} services={services} blocked={blocked} />}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {x.outstanding > 0 && (
                <Link href={`/kasir/${x.invoice_id}`} className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)] no-underline">
                  {`Bayar Cicilan · sisa ${rp(x.outstanding)}`}
                </Link>
              )}
            </div>
            {p.can_cancel && <CancelForm ctx={d.ctx} pkg={x.id} />}
          </article>
        );
      })}
      {closed.length > 0 && (
        <section aria-label="Paket selesai" className="grid min-w-0 gap-2">
          <h3 className="m-0 text-[1.06rem] font-semibold">Paket selesai</h3>
          <ul className="m-0 grid min-w-0 list-none gap-1 p-0">
            {closed.map((x) => (
              <li key={x.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--separator)] py-1">
                <span className="min-w-0 [overflow-wrap:anywhere]">{x.name}</span>
                <span className={muted}>{`${PKG[x.state].label} · ke saldo ${rp(x.paid_unused_moved)} · sisa dibatalkan ${rp(x.remainder_cancelled)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
  const balance = (
    <div className="grid min-w-0 gap-3">
      <p className="m-0 text-[1.75rem] font-bold leading-tight">{rp(b.balance)}</p>
      <p className={muted}>Saldo tidak kedaluwarsa dan bisa dipakai bayar apa pun di Kasir.</p>
      {b.entries.length === 0 ? <p className={muted}>Belum ada mutasi saldo.</p> : (
        <ul aria-label="Mutasi saldo" className="m-0 grid min-w-0 list-none gap-1 p-0">
          {b.entries.slice(0, 20).map((e) => (
            <li key={e.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b border-[var(--separator)] py-1">
              <span className="min-w-0 [overflow-wrap:anywhere]">{KIND[e.kind] ?? e.kind}</span>
              <span className={`text-right font-semibold ${e.amount < 0 ? "text-[var(--label)]" : "text-[var(--success)]"}`}>{`${e.amount < 0 ? "−" : "+"}${rp(Math.abs(e.amount))}`}</span>
              <span className={`${muted} col-span-2`}>{`${when(e.created_at)}${e.branch ? ` · ${e.branch.name}` : ""}`}</span>
            </li>
          ))}
        </ul>
      )}
      {p.can_top_up && <TopUpForm ctx={d.ctx} patient={patientId} branch={d.ctx.b || null} />}
    </div>
  );
  return (
    <DetailPage as="section" title={label} subtitle="Paket & Saldo"
      sections={[{ id: "paket", label: "Paket", content: packages }, { id: "saldo", label: "Saldo", content: balance },
        { id: "dp", label: "DP Booking", content: <p className={muted}>DP booking tampil di sini setelah fitur DP aktif.</p> }]} />
  );
}

export default function PatientPaketPage({ params }: { params: Promise<{ patientId: string }> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body params={params} /></Suspense></Main>;
}
