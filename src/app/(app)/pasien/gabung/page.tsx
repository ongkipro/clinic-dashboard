// Gabung Data Ganda (19 §2.4 "Pilih dua pasien, bandingkan, gabung dengan alasan; dapat dibatalkan", PR-85, T-042; HYG-NAV-2). Records
// officer only. Side A and B are picked by search; the comparison shows identity fields only (MRN, name, birth date, masked phone — no
// clinical content); the merge redirects the duplicate to the survivor (no row moves) and stays undoable from the history.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState, SuccessNotice } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadGabung, type Side } from "./data";
import { Find, MergeForm, Unmerge } from "./forms";

export const metadata: Metadata = { title: "Gabung Data Ganda — Clinic Dashboard" };
type Q = { a?: string; b?: string; ok?: string };
// The notice after a committed merge / unmerge (the action redirects with ?ok=<code>); only the two literal codes are read — never an
// inherited key such as __proto__ (review r1 P2); anything else, including a repeated parameter, shows nothing.
const OK: Record<"merged" | "unmerged", string> = { merged: "Data pasien digabung. Penggabungan dapat dibatalkan dari riwayat di bawah.", unmerged: "Penggabungan dibatalkan." };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const at = (d: Date) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(d));
const Main = ({ children }: { children: React.ReactNode }) => <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</main>;

function Card({ title, side }: { title: string; side: Side | null }) {
  return (
    <section aria-label={title} className="@container grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      <h2 className="m-0 text-[1.18rem] font-semibold">{title}</h2>
      {!side ? <p className={muted}>Belum dipilih.</p> : (
        // label beside value only when the card holds 22 em of its own text; enlarged text or a narrow card stacks them (WCAG 1.4.10)
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1 @min-[22em]:grid-cols-[8em_minmax(0,1fr)]">
          <dt className={muted}>No. RM</dt><dd className="m-0">{side.mrn}</dd>
          <dt className={muted}>Nama</dt><dd className="m-0 [overflow-wrap:anywhere]">{side.fullName}</dd>
          <dt className={muted}>Tanggal lahir</dt><dd className="m-0">{side.birthDate}</dd>
          <dt className={muted}>HP</dt><dd className="m-0">{side.phone ?? "—"}</dd>
        </dl>
      )}
      {side?.mergedInto && <StatusBadge tone="locked">Sudah digabung ke data lain</StatusBadge>}
    </section>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadGabung(q);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Main><PageTitle title="Gabung Data Ganda" /><PermissionState object="penggabungan data pasien" /></Main>;
  const history = [...new Map([...(p.a?.merges ?? []), ...(p.b?.merges ?? [])].map((m) => [m.id, m])).values()];
  const label = (s: Side) => `${s.fullName} (${s.mrn})`;
  const same = p.a && p.b && p.a.id === p.b.id;
  return (
    <Main>
      <PageTitle title="Gabung Data Ganda" />
      {(q.ok === "merged" || q.ok === "unmerged") && <SuccessNotice message={OK[q.ok]} />}
      <p className={muted}>Data yang digabung diarahkan ke data yang dipertahankan; tidak ada riwayat yang dipindah atau dihapus, dan penggabungan dapat dibatalkan.</p>
      <div className="grid min-w-0 gap-4 min-[820px]:grid-cols-2">
        <div className="grid min-w-0 content-start gap-2"><Card title="Pasien A" side={p.a} /><Find ctx={p.ctx} side="a" other={p.b?.id ?? null} /></div>
        <div className="grid min-w-0 content-start gap-2"><Card title="Pasien B" side={p.b} /><Find ctx={p.ctx} side="b" other={p.a?.id ?? null} /></div>
      </div>
      {same && <p role="alert" className="m-0 text-[var(--danger)]">Pasien A dan B sama. Pilih dua data yang berbeda.</p>}
      {p.a && p.b && !same && (p.a.mergedInto || p.b.mergedInto) && <p role="status" className={muted}>Salah satu data sudah digabung. Batalkan penggabungannya dulu bila perlu.</p>}
      {p.a && p.b && !same && !p.a.mergedInto && !p.b.mergedInto && <MergeForm ctx={p.ctx} a={{ id: p.a.id, label: label(p.a) }} b={{ id: p.b.id, label: label(p.b) }} />}
      {(p.a || p.b) && (
        <section aria-labelledby="riwayat" className="grid min-w-0 gap-2">
          <h2 id="riwayat" className="m-0 text-[1.18rem] font-semibold">Riwayat penggabungan</h2>
          {history.length === 0 ? <p className={muted}>Belum ada penggabungan untuk pasien ini.</p> : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {history.map((m) => (
                <li key={m.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Digabung {at(m.mergedAt)}</span>
                    <StatusBadge tone={m.undoneAt ? "locked" : "success"}>{m.undoneAt ? "Dibatalkan" : "Aktif"}</StatusBadge>
                  </div>
                  <span className={`${muted} [overflow-wrap:anywhere]`}>Alasan: {m.reason}</span>
                  {!m.undoneAt && <Unmerge ctx={p.ctx} mergeId={m.id} label={at(m.mergedAt)} pair={{ a: p.a?.id ?? null, b: p.b?.id ?? null }} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {(p.a || p.b) && <Link href="/pasien/gabung" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Mulai dari awal</Link>}
    </Main>
  );
}

export default function GabungPage({ searchParams }: { searchParams: Promise<Q> }) {
  return <Suspense fallback={<Main><LoadingList rows={3} label="Memuat" /></Main>}><Body searchParams={searchParams} /></Suspense>;
}
