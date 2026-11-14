// Tutup Kasir (UX-15, 19 row, PR-19; T-085): the actor's current shift (open, waiting or in recount) with Buka Kasir when none, and the
// shifts the role reads — an FO/cashier its own, a manager its branch, owner/finance/auditor any branch — by state.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadShifts } from "./data";
import { OpenForm } from "./forms";
import { rp, SEGMENTS, SHIFT_STATE, when } from "./labels";

export const metadata: Metadata = { title: "Tutup Kasir — Clinic Dashboard" };
const TITLE = "Tutup Kasir";
const panel = "grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const d = await loadShifts({ branch: s("cabang"), state: s("status") });
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "tutup kasir" }} />;
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const l = d.l;
  const wide = !["manager", "fo_cashier"].includes(l.role);
  const q = (st: string) => `/kasir/tutup?${new URLSearchParams({ ...(d.branch ? { cabang: d.branch } : {}), ...(st ? { status: st } : {}) })}`;
  const filters = SEGMENTS.map(([k, label]) => ({ label, href: q(k), active: (d.state ?? "") === k }));
  // The current shift (or Buka Kasir) stays above every list state, so a cashier can open a shift from the empty state.
  return (
    <ListPage as="section" title={TITLE} filters={filters} state={{ kind: "rows" }}>
      {wide && l.branches.length > 1 && (
        <div role="group" aria-label="Cabang" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
          {[{ id: "", name: "Semua Cabang" }, ...l.branches].map((b) => (
            <Link key={b.id || "all"} href={`/kasir/tutup?${new URLSearchParams({ ...(b.id ? { cabang: b.id } : {}), ...(d.state ? { status: d.state } : {}) })}`}
              aria-current={(d.branch ?? "") === b.id ? "true" : undefined}
              className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline ${(d.branch ?? "") === b.id ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : ""}`}>
              {b.name}
            </Link>
          ))}
        </div>
      )}
      {d.mine ? (
        <section aria-label="Shift saya" className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
          <h2 className="m-0 text-[1.25rem] font-semibold">Shift saya</h2>
          <p className="m-0 [overflow-wrap:anywhere]">{`Dibuka ${when(d.mine.opened_at)} · Modal awal ${rp(d.mine.opening_float)}${d.mine.auto_opened ? " (dibuka otomatis)" : ""}`}</p>
          <StatusBadge tone={SHIFT_STATE[d.mine.state].tone} className="justify-self-start">{SHIFT_STATE[d.mine.state].label}</StatusBadge>
          <Link href={`/kasir/tutup/${d.mine.id}`} className="inline-flex min-h-[var(--target)] items-center self-start rounded-full bg-[var(--tint)] px-5 font-semibold text-[var(--on-tint)] no-underline">
            {d.mine.state === "open" ? "Tutup Kasir" : d.mine.state === "recount" ? "Hitung Ulang" : "Lihat Shift"}
          </Link>
        </section>
      ) : l.can_open ? (
        <OpenForm ctx={d.ctx} branches={wide ? l.branches : null} />
      ) : (
        <p className={muted}>Mode baca: peran ini melihat shift tanpa membuka kasir.</p>
      )}
      {l.rows.length === 0 ? (
        <div className={panel} role="status">
          <p className="m-0 text-[var(--label-2)]">{d.state ? "Tidak ada shift untuk filter ini." : "Belum ada shift kasir."}</p>
          {d.state && <Link href={q("")} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Hapus Filter</Link>}
        </div>
      ) : (
        <RowList label="Shift kasir">
          {l.rows.map((r) => (
            <Row key={r.id} href={`/kasir/tutup/${r.id}`} title={`${r.cashier.name} · ${when(r.opened_at)}`}
              subtitle={[wide && r.branch.name, `Modal awal ${rp(r.opening_float)}`, r.auto_opened && "dibuka otomatis", r.closed_at && `ditutup ${when(r.closed_at)}`].filter(Boolean).join(" · ")}>
              <span className="flex min-w-0 flex-wrap gap-1">
                <StatusBadge tone={SHIFT_STATE[r.state].tone}>{SHIFT_STATE[r.state].label}</StatusBadge>
                {r.state === "pending_approval" && r.escalated && <StatusBadge tone="warning">Ke Owner</StatusBadge>}
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </ListPage>
  );
}

export default function TutupKasirPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
