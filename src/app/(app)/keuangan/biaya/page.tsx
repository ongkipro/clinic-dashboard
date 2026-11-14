// Biaya Operasional & Kas Kecil (UX-22 ▸ Biaya, 17:187, PR-79; T-084): expenses of a period with their receipt and, for Belum Dibayar,
// the supplier payable; totals per branch for the period; Catat Biaya (owner, finance, a manager at the active branch); Kategori Biaya
// (owner, finance). Readers: owner, finance, auditor tenant-wide, a manager at the active branch (DEC-097).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { BlockedState, LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { filters, type Filters, loadBiaya, today } from "./data";
import { CategoriesSheet, RecordForm } from "./forms";
import { day, FUNDING, PAYABLE, rp } from "./labels";

export const metadata: Metadata = { title: "Biaya Operasional & Kas Kecil — Clinic Dashboard" };
const TITLE = "Biaya Operasional & Kas Kecil";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";

const q = (f: Filters, over: Partial<Filters> = {}) => {
  const m = { ...f, ...over };
  const p = new URLSearchParams({ dari: m.from, sampai: m.to });
  if (m.branch) p.set("cabang", m.branch);
  if (m.category) p.set("kategori", m.category);
  if (m.funding) p.set("dana", m.funding);
  return `/keuangan/biaya?${p}`;
};

const panel = "grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = filters(await searchParams);
  const d = await loadBiaya(f);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "biaya operasional" }} />;
  if (d.kind === "no-branch") return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "filtered-empty", message: "Filter tidak dapat dipakai.", clearHref: "/keuangan/biaya" }} />;
  const l = d.d;
  const wide = l.role !== "manager";
  const active = l.categories.filter((c) => c.active);
  const filtered = !!(f.category || f.funding || (wide && f.branch));
  const recorded = l.rows.filter((r) => r.state === "recorded");
  const total = recorded.reduce((s, r) => s + Number(r.amount), 0);
  const per = new Map<string, { name: string; amount: number }>();
  for (const r of recorded) per.set(r.branch.id, { name: r.branch.name, amount: (per.get(r.branch.id)?.amount ?? 0) + Number(r.amount) });
  const fundingChips = [{ label: "Semua", href: q(f, { funding: null }), active: !f.funding },
    ...Object.entries(FUNDING).map(([k, label]) => ({ label, href: q(f, { funding: k as Filters["funding"] }), active: f.funding === k }))];
  // The toolbar, totals and writer sheets stay above every list state, so a filtered-empty or blocked list can still be refiltered,
  // and a recorder can add the first category or expense.
  return (
    <ListPage as="section" title={TITLE} filters={fundingChips} state={{ kind: "rows" }}>
      <form method="get" action="/keuangan/biaya" aria-label="Filter biaya" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-[repeat(4,minmax(0,1fr))_auto] min-[700px]:items-end">
        <label className="grid min-w-0 gap-1">Dari<input name="dari" type="date" defaultValue={f.from} max={today()} className={input} /></label>
        <label className="grid min-w-0 gap-1">Sampai<input name="sampai" type="date" defaultValue={f.to} max={today()} className={input} /></label>
        {wide ? (
          <label className="grid min-w-0 gap-1">Cabang
            <select name="cabang" defaultValue={f.branch ?? ""} className={input}>
              <option value="">Semua Cabang</option>
              {l.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        ) : <span className="hidden min-[700px]:block" />}
        <label className="grid min-w-0 gap-1">Kategori
          <select name="kategori" defaultValue={f.category ?? ""} className={input}>
            <option value="">Semua Kategori</option>
            {l.categories.map((c) => <option key={c.id} value={c.id}>{c.active ? c.name : `${c.name} (nonaktif)`}</option>)}
          </select>
        </label>
        {f.funding && <input type="hidden" name="dana" value={f.funding} />}
        <button type="submit" className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)]">Terapkan</button>
      </form>
      <section aria-label="Total biaya periode" className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{`Total ${day(f.from)} – ${day(f.to)}`}</p>
        <p className="m-0 text-[1.5rem] font-semibold tabular-nums">{rp(total)}</p>
        {wide && per.size > 1 && (
          <ul className="m-0 grid min-w-0 list-none gap-1 p-0">
            {[...per.entries()].map(([id, b]) => <li key={id} className={`${muted} tabular-nums`}>{`${b.name} ${rp(b.amount)}`}</li>)}
          </ul>
        )}
        <p className={muted}>Biaya yang dibatalkan tidak dihitung. Posting ke jurnal menyusul bersama modul akuntansi.</p>
      </section>
      {(l.can_record || l.can_categories) && (
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {l.can_record && active.length > 0 && (
            <RecordForm ctx={d.ctx} branches={l.branches} fixedBranch={wide ? null : l.branch_id} categories={active} suppliers={d.suppliers} today={today()} />
          )}
          {l.can_categories && <CategoriesSheet ctx={d.ctx} categories={l.categories} open={l.categories.length === 0} />}
        </div>
      )}
      {!l.can_record && <p className={muted}>Mode baca: peran ini melihat biaya tanpa mencatat.</p>}
      {l.rows.length > 0 ? (
        <RowList label="Biaya">
          {l.rows.map((r) => (
            <Row key={r.id} href={`/keuangan/biaya/${r.id}?tanggal=${r.business_date.slice(0, 10)}`} title={`${r.category.name} · ${rp(Number(r.amount))}`}
              subtitle={[day(r.business_date), wide && r.branch.name, FUNDING[r.funding], r.has_receipt ? "Ada bukti" : "Tanpa bukti", r.description].filter(Boolean).join(" · ")}>
              {(r.state === "reversed" || r.payable) && (
                <span className="flex min-w-0 flex-wrap gap-1">
                  {r.state === "reversed" ? <StatusBadge tone="neutral">Dibatalkan</StatusBadge>
                    : r.payable && <StatusBadge tone={PAYABLE[r.payable.state][1]}>{PAYABLE[r.payable.state][0]}</StatusBadge>}
                </span>
              )}
            </Row>
          ))}
        </RowList>
      ) : filtered ? (
        <div className={panel} role="status">
          <p className="m-0 text-[var(--label-2)]">Tidak ada biaya yang cocok dengan filter.</p>
          <Link href={q(f, { branch: null, category: null, funding: null })} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Hapus Filter</Link>
        </div>
      ) : l.can_record && active.length === 0 ? (
        <BlockedState reason="Belum ada kategori biaya" unblock="Keuangan atau Owner dapat menambahkan kategori" />
      ) : (
        <div className={panel} role="status"><p className="m-0 text-[var(--label-2)]">Belum ada biaya di periode ini.</p></div>
      )}
      {l.role !== "auditor" && (
        <div className="grid min-w-0 gap-1">
          <p className={muted}>Biaya Belum Dibayar dibayar dari Pembelian › Utang.</p>
          <Link href="/pembelian/utang" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka Utang Pemasok</Link>
        </div>
      )}
    </ListPage>
  );
}

export default function BiayaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
