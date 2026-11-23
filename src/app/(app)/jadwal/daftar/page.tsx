// Daftar Reservasi (19 §2.3, UX-5 ▸ Daftar; HYG-NAV-2): the appointments of one branch for the next 7 or 30 days as a list, filtered by
// status (dibuat, dikonfirmasi, datang, tidak datang, batal, dijadwal ulang). Reads appointments_window (T-044/T-045); the row actions
// stay on the Kalender day view ("Kelola di Kalender"). Names and MRNs only.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { WRITERS } from "../data";
import { addDays, loadAppointments, WAITLIST_READERS } from "./data";
import { countByStatus, filterReservations, listState, parseStatus, STATUS_FILTERS } from "./model";
import { AppointmentRow, Chips, Empty, Main, muted, Segments } from "./view";

export const metadata: Metadata = { title: "Daftar Reservasi — Clinic Dashboard" };
type Q = { cabang?: string; dari?: string; hari?: string; status?: string };

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadAppointments(q);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Main><PageTitle title="Daftar Reservasi" /><PermissionState object="daftar reservasi" /></Main>;
  if (p.kind === "no-branch") return <Main><PageTitle title="Daftar Reservasi" /><BlockedState reason="Belum ada cabang aktif" unblock="Pilih cabang di Saya › Ganti Cabang" /></Main>;
  const status = parseStatus(q.status);
  const counts = countByStatus(p.cal.appointments);
  const rows = filterReservations(p.cal.appointments, status);
  const href = (o: Partial<Q>) => `/jadwal/daftar?${new URLSearchParams({ cabang: p.branch.id, dari: p.from, hari: String(p.days), ...(status === "semua" ? {} : { status }), ...o } as Record<string, string>)}`;
  const state = listState(p.cal.appointments.length, rows.length);
  const write = WRITERS.includes(p.role);
  return (
    <Main>
      <PageTitle title="Daftar Reservasi" />
      <Segments active="daftar" cabang={p.branch.id} waitlist={WAITLIST_READERS.includes(p.role)} />
      {p.branches.length > 1 && <Chips label="Cabang" items={p.branches.map((b) => ({ label: b.name, href: `/jadwal/daftar?cabang=${b.id}`, active: b.id === p.branch.id }))} />}
      <Chips label="Rentang" items={[
        { label: "7 hari", href: href({ hari: "7" }), active: p.days === 7 },
        { label: "30 hari", href: href({ hari: "30" }), active: p.days === 30 },
        { label: "‹ Sebelumnya", href: href({ dari: addDays(p.from, -p.days) }) },
        { label: "Berikutnya ›", href: href({ dari: addDays(p.from, p.days) }) },
      ]} />
      <p className={muted}>{p.branch.name} · {p.from} s.d. {p.to}</p>
      <Chips label="Status" items={STATUS_FILTERS.map((f) => ({ label: `${f.label} (${counts[f.id]})`, href: href({ status: f.id === "semua" ? undefined : f.id }), active: f.id === status }))} />
      {state === "empty" && <Empty message="Belum ada reservasi pada rentang ini." action={write ? { label: "Buat Janji", href: `/jadwal?cabang=${p.branch.id}&aksi=baru` } : undefined} />}
      {state === "filtered-empty" && <Empty message="Tidak ada reservasi untuk filter ini." action={{ label: "Hapus Filter", href: href({ status: undefined }) }} />}
      {state === "rows" && <ul aria-label="Reservasi" className="m-0 grid min-w-0 list-none gap-2 p-0">{rows.map((a) => <AppointmentRow key={a.id} a={a} tz={p.branch.timezone} branchId={p.branch.id} write={write} />)}</ul>}
    </Main>
  );
}

export default function DaftarReservasiPage({ searchParams }: { searchParams: Promise<Q> }) {
  return <Suspense fallback={<Main><LoadingList rows={5} label="Memuat daftar reservasi" /></Main>}><Body searchParams={searchParams} /></Suspense>;
}
