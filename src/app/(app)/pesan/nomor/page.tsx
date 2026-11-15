// Pesan › Nomor (UX-17, 19:223; T-090 over T-089's module): the WABA's onboarding state, Meta business verification, the portfolio limit
// and the daily outbound budget (SET-21), and each number with its branch, display name and quality. Read-only here for every reader;
// onboarding commands stay in the WABA module (Embedded Signup needs the live adapter, DEC-082). No token or PIN is ever shown.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadNumbers } from "../data";
import { NUMBER_STATE, SEGMENTS, WABA_STATE } from "../labels";

export const metadata: Metadata = { title: "Nomor WhatsApp — Clinic Dashboard" };
const TITLE = "Nomor WhatsApp";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const panel = "grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const VERIFY: Record<string, string> = { unverified: "Belum diverifikasi", pending: "Sedang diverifikasi", verified: "Terverifikasi" };

async function Body() {
  const d = await loadNumbers();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "nomor WhatsApp" }} />;
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "error", message: "Nomor WhatsApp belum bisa dimuat.", retryHref: "/pesan/nomor" }} />;
  const w = d.d.waba;
  const segs = SEGMENTS(d.role, "nomor");
  if (!w) {
    return <ListPage as="section" title={TITLE} filters={segs.length > 1 ? segs : undefined}
      state={{ kind: "blocked", reason: "WhatsApp Business belum terhubung.", unblock: "Owner atau Admin Pusat menghubungkan WhatsApp Business melalui pendaftaran Meta." }} />;
  }
  return (
    <ListPage as="section" title={TITLE} filters={segs.length > 1 ? segs : undefined} state={{ kind: "rows" }}>
      <section aria-label="Akun WhatsApp Business" className={panel}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="m-0 text-[1.1rem] font-semibold">Akun WhatsApp Business</h2>
          <StatusBadge tone={w.state === "active" ? "success" : w.state === "revoked" ? "locked" : "warning"}>{WABA_STATE[w.state] ?? w.state}</StatusBadge>
        </div>
        <p className={muted}>{`Verifikasi bisnis Meta: ${VERIFY[w.business_verification_status] ?? w.business_verification_status}`}</p>
        <p className={muted}>{`Batas pesan Meta ${w.portfolio_messaging_limit.toLocaleString("id-ID")} kontak per 24 jam · Batas kirim harian klinik ${w.daily_outbound_budget.toLocaleString("id-ID")}`}</p>
        {w.state === "verification_required" && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--warning-soft)] px-3 py-2">Selesaikan verifikasi bisnis Meta untuk menambah lebih dari 2 nomor WhatsApp.</p>}
        {w.onboarding_channel === "bsp_fallback" && <p className={muted}>Terhubung melalui mitra BSP; akan dipindahkan ke Cloud API.</p>}
      </section>
      <ul aria-label="Nomor" className="m-0 grid min-w-0 list-none gap-2 p-0">
        {d.d.numbers.map((n) => (
          <li key={n.id} className={panel}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{n.display_name}</p>
              <StatusBadge tone={(NUMBER_STATE[n.state] ?? NUMBER_STATE.number_registered)[1]}>{(NUMBER_STATE[n.state] ?? NUMBER_STATE.number_registered)[0]}</StatusBadge>
            </div>
            <p className={muted}>{[n.phone_number, n.branch_id ? "Nomor cabang" : "Nomor brand (semua cabang)", n.is_coexistence ? "Tetap dipakai di aplikasi WhatsApp Business" : null,
              `Kualitas ${n.quality_rating === "green" ? "baik" : n.quality_rating === "yellow" ? "sedang" : n.quality_rating === "red" ? "rendah" : "belum dinilai"}`].filter(Boolean).join(" · ")}</p>
          </li>
        ))}
      </ul>
      {d.d.numbers.length === 0 && <p className={muted}>Belum ada nomor terdaftar.</p>}
    </ListPage>
  );
}

export default function NomorPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={3} label="Memuat nomor" />}>
        <Body />
      </Suspense>
    </main>
  );
}
