// Daftar Tunggu (19 §2.3, UX-5 ▸ Tunggu, PR-81; HYG-NAV-2): patients waiting for a slot per service at one branch (waitlist_list, T-099),
// offered first. Adding an entry and recording an offer's outcome stay where the desk books (Kalender); this page is the read view.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadWaitlist } from "../daftar/data";
import { waitlistGroups } from "../daftar/model";
import { Chips, Empty, Main, muted, Segments } from "../daftar/view";

export const metadata: Metadata = { title: "Daftar Tunggu — Clinic Dashboard" };
type Q = { cabang?: string };
const at = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadWaitlist(q);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Main><PageTitle title="Daftar Tunggu" /><PermissionState object="daftar tunggu" /></Main>;
  if (p.kind === "no-branch") return <Main><PageTitle title="Daftar Tunggu" /><BlockedState reason="Belum ada cabang aktif" unblock="Pilih cabang di Saya › Ganti Cabang" /></Main>;
  const groups = waitlistGroups(p.rows);
  return (
    <Main>
      <PageTitle title="Daftar Tunggu" />
      <Segments active="tunggu" cabang={p.branch.id} waitlist />
      {p.branches.length > 1 && <Chips label="Cabang" items={p.branches.map((b) => ({ label: b.name, href: `/jadwal/tunggu?cabang=${b.id}`, active: b.id === p.branch.id }))} />}
      {groups.length === 0 ? <Empty message="Belum ada pasien di daftar tunggu cabang ini." /> : groups.map((g, i) => (
        <section key={g.itemId} aria-labelledby={`layanan-${i}`} className="grid min-w-0 gap-2">
          <h2 id={`layanan-${i}`} className="m-0 text-[1.18rem] font-semibold">{p.services[g.itemId] ?? "Layanan tidak aktif"} <span className="font-normal text-[var(--label-2)]">({g.rows.length})</span></h2>
          <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
            {g.rows.map((r) => (
              <li key={r.id} data-entry={r.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--surface)] p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <strong className="[overflow-wrap:anywhere]">{r.patient_name}</strong><span className={muted}>· {r.patient_mrn}</span>
                  <StatusBadge tone={r.state === "offered" ? "warning" : "neutral"}>{r.state === "offered" ? "Ditawari slot" : "Menunggu"}</StatusBadge>
                </div>
                <span className={muted}>Masuk daftar {at(r.created_at)}{r.offered_starts_at ? ` · slot ditawarkan ${at(r.offered_starts_at)}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Main>
  );
}

export default function DaftarTungguPage({ searchParams }: { searchParams: Promise<Q> }) {
  return <Suspense fallback={<Main><LoadingList rows={4} label="Memuat daftar tunggu" /></Main>}><Body searchParams={searchParams} /></Suspense>;
}
