// Booking Online Masuk (19 §2.3, UX-5 ▸ Online; HYG-NAV-2): online bookings of one branch for the next 30 days still waiting — for the DP
// (Menunggu DP) or for the desk's confirmation (Terjadwal) — soonest first. Reads appointments_window; Konfirmasi lives on the Kalender day
// view. Public online booking itself arrives with T-126; until then the list is honestly empty.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { WRITERS } from "../data";
import { loadAppointments, WAITLIST_READERS } from "../daftar/data";
import { onlineQueue } from "../daftar/model";
import { AppointmentRow, Chips, Empty, Main, muted, Segments } from "../daftar/view";

export const metadata: Metadata = { title: "Booking Online Masuk — Clinic Dashboard" };
type Q = { cabang?: string };

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadAppointments({ cabang: q.cabang, hari: "30" });
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Main><PageTitle title="Booking Online Masuk" /><PermissionState object="booking online" /></Main>;
  if (p.kind === "no-branch") return <Main><PageTitle title="Booking Online Masuk" /><BlockedState reason="Belum ada cabang aktif" unblock="Pilih cabang di Saya › Ganti Cabang" /></Main>;
  const rows = onlineQueue(p.cal.appointments);
  return (
    <Main>
      <PageTitle title="Booking Online Masuk" />
      <Segments active="online" cabang={p.branch.id} waitlist={WAITLIST_READERS.includes(p.role)} />
      {p.branches.length > 1 && <Chips label="Cabang" items={p.branches.map((b) => ({ label: b.name, href: `/jadwal/online?cabang=${b.id}`, active: b.id === p.branch.id }))} />}
      <p className={muted}>{p.branch.name} · 30 hari ke depan · menunggu DP atau konfirmasi</p>
      {rows.length === 0
        ? <Empty message="Belum ada booking online yang menunggu." />
        : <ul aria-label="Booking online menunggu" className="m-0 grid min-w-0 list-none gap-2 p-0">{rows.map((a) => <AppointmentRow key={a.id} a={a} tz={p.branch.timezone} branchId={p.branch.id} write={WRITERS.includes(p.role)} />)}</ul>}
    </Main>
  );
}

export default function BookingOnlinePage({ searchParams }: { searchParams: Promise<Q> }) {
  return <Suspense fallback={<Main><LoadingList rows={4} label="Memuat booking online" /></Main>}><Body searchParams={searchParams} /></Suspense>;
}
