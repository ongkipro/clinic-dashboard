// Jurnal & Buku Besar (UX-22 ▸ Buku Besar, 17 :187, 19 :183, PR-26; T-105): chart of accounts, automatic journals from the domain events
// (the draft posting map), manual journals, Kunci Periode, trial balance, P&L, balance sheet and cash-flow summary per branch or consolidated.
// Every view says the books are a PREVIEW until an activation decision exists (Panel 2 G4, E1/E2: open gates G-ACT / G-RETRO); statements
// are generic by account class and not SAK-labelled (G2). Journal export is refused unless the map is signed AND the books are activated.
// Readers: owner, finance, auditor; finance writes.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { ACCOUNT_CLASSES, type Report } from "../../../../modules/accounting/ledger/ledger";
import { filters, type Filters, loadBukuBesar, today } from "./data";
import { LockPeriodForm, ManualJournalForm } from "./forms";
import { CLASS, day, eventLabel, KIND, rp, statusText } from "./labels";

export const metadata: Metadata = { title: "Jurnal & Buku Besar — Clinic Dashboard" };
const TITLE = "Jurnal & Buku Besar";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const panel = "grid min-w-0 content-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const row = "flex min-w-0 flex-wrap justify-between gap-x-3";

const qs = (f: Filters) => {
  const p = new URLSearchParams({ dari: f.from, sampai: f.to });
  if (f.branch) p.set("cabang", f.branch);
  return p.toString();
};
const prevMonth = (t: string) => { const d = new Date(`${t.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

function Statement({ title, rows, total, totalLabel }: { title: string; rows: { key: string; label: string; amount: number }[]; total: number; totalLabel: string }) {
  return (
    <section aria-label={title} className={panel}>
      <h3 className="m-0 text-[1.1rem] font-semibold">{title}</h3>
      {rows.length === 0 ? <p className={muted}>Belum ada saldo.</p> : (
        <dl className="m-0 grid min-w-0 gap-1">
          {rows.map((r) => <div key={r.key} className={row}><dt className="min-w-0 [overflow-wrap:anywhere]">{r.label}</dt><dd className="m-0 tabular-nums">{rp(r.amount)}</dd></div>)}
          <div className={`${row} border-t border-[var(--separator)] pt-1 font-semibold`}><dt>{totalLabel}</dt><dd className="m-0 tabular-nums">{rp(total)}</dd></div>
        </dl>
      )}
    </section>
  );
}

function Statements({ r }: { r: Report }) {
  const rev = r.income.filter((x) => x.class === "revenue");
  const exp = r.income.filter((x) => x.class === "expense");
  const by = (c: string) => r.balance_sheet.filter((x) => x.class === c);
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
      <Statement title="Laba rugi — pendapatan" rows={rev} total={sum(rev)} totalLabel="Total pendapatan" />
      <Statement title="Laba rugi — beban" rows={exp} total={sum(exp)} totalLabel="Total beban" />
      <Statement title="Posisi keuangan — aset" rows={by("asset")} total={sum(by("asset"))} totalLabel="Total aset" />
      <Statement title="Posisi keuangan — kewajiban dan ekuitas" rows={[...by("liability"), ...by("equity"), { key: "retained", label: "Laba (rugi) berjalan", amount: r.retained }]}
        total={sum(by("liability")) + sum(by("equity")) + r.retained} totalLabel="Total kewajiban dan ekuitas" />
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const f = filters(await searchParams);
  const x = await loadBukuBesar(f);
  if (x.kind === "redirect") redirect(x.to);
  if (x.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "jurnal dan buku besar" }} />;
  if (x.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "filtered-empty", message: "Filter tidak dapat dipakai.", clearHref: "/keuangan/buku-besar" }} />;
  const { r, j } = x;
  const st = statusText(r.status);
  const t = today();
  const finance = x.role === "finance";
  const cash = Object.entries(r.cash_flow) as [keyof typeof CLASS, number][];
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <section aria-label="Status buku" className={`${panel} border border-[var(--warning)]`} role="status">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><StatusBadge tone="warning">{st.title}</StatusBadge></div>
        <p className="m-0 [overflow-wrap:anywhere]">{st.detail}</p>
        <p className={muted}>Laporan di halaman ini adalah ringkasan internal per kelas akun, belum disusun sebagai laporan keuangan standar akuntansi.</p>
        {r.status.locked_periods.length > 0 && <p className={muted}>{`Periode terkunci: ${r.status.locked_periods.join(", ")}`}</p>}
      </section>
      <form method="get" action="/keuangan/buku-besar" aria-label="Filter periode" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-[repeat(3,minmax(0,1fr))_auto] min-[700px]:items-end">
        <label className="grid min-w-0 gap-1">Dari<input name="dari" type="date" defaultValue={f.from} max={t} className={input} /></label>
        <label className="grid min-w-0 gap-1">Sampai<input name="sampai" type="date" defaultValue={f.to} max={t} className={input} /></label>
        <label className="grid min-w-0 gap-1">Cabang
          <select name="cabang" defaultValue={f.branch ?? ""} className={input}>
            <option value="">Semua Cabang</option>
            {x.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)]">Terapkan</button>
      </form>
      <KpiRow items={[
        { label: "Laba (rugi) periode", value: rp(r.net_income), basis: `${day(f.from)} – ${day(f.to)} · pratinjau` },
        { label: "Jurnal pada periode", value: String(j.entries.length), basis: j.entries.length >= 200 ? "200 terbaru ditampilkan" : "Otomatis, manual dan pembalik" },
        { label: "Neraca saldo", value: r.balanced ? "Seimbang" : "Tidak seimbang", basis: f.branch ? "Debit = kredit untuk baris cabang ini saja" : "Debit = kredit" },
      ]} />

      {/* T-105 G-Q4 U1–U4 (Panel 2): an accounting exception, visible — not a fix: no journal is posted for these hand-overs */}
      <section aria-label="Selisih penyerahan produk" className={`${panel} ${x.hx.fractional + x.hx.unlinked > 0 ? "border border-[var(--warning)]" : ""}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="m-0 text-[1.1rem] font-semibold">Selisih penyerahan produk</h2>
          {x.hx.fractional + x.hx.unlinked > 0 && <StatusBadge tone="warning">Belum tercatat di buku</StatusBadge>}
        </div>
        {x.hx.fractional + x.hx.unlinked === 0 ? (
          <p className={muted}>Tidak ada produk pilihan pasien yang diserahkan tanpa tautan ke baris tagihan pada periode ini.</p>
        ) : (
          <dl className="m-0 grid min-w-0 gap-1">
            <div className={row}><dt>Belum tertaut ke tagihan</dt><dd className="m-0 tabular-nums">{x.hx.unlinked}</dd></div>
            <div className={row}><dt>Kuantitas pecahan</dt><dd className="m-0 tabular-nums">{x.hx.fractional}</dd></div>
          </dl>
        )}
        <p className={muted}>{`Produk pilihan pasien yang sudah diserahkan (${day(f.from)} – ${day(f.to)}, menurut tanggal serah) tetapi belum punya baris tagihan tertaut. Penyerahan ini belum menghasilkan jurnal; status tautan dihitung per saat ini. Penjualan di kasir tanpa kunjungan dan resep tidak termasuk.`}</p>
      </section>

      <h2 className="m-0 text-[1.35rem] font-semibold">Laporan</h2>
      <Statements r={r} />
      <section aria-label="Arus kas" className={panel}>
        <h3 className="m-0 text-[1.1rem] font-semibold">Ringkasan arus kas</h3>
        {cash.length === 0 ? <p className={muted}>Belum ada mutasi kas, bank atau kliring.</p> : (
          <dl className="m-0 grid min-w-0 gap-1">
            {cash.map(([k, a]) => <div key={k} className={row}><dt>{`Lawan akun ${CLASS[k] ?? k}`}</dt><dd className="m-0 tabular-nums">{rp(a)}</dd></div>)}
          </dl>
        )}
      </section>

      <h2 className="m-0 text-[1.35rem] font-semibold">Neraca saldo</h2>
      {/* a list of account cards (no horizontal table: compact widths and 200 % text keep every figure in view) */}
      <ul aria-label="Neraca saldo per akun" className="m-0 grid min-w-0 list-none grid-cols-[minmax(0,1fr)] gap-2 p-0 min-[900px]:grid-cols-2">
        {[...r.trial_balance].sort((a, b) => ACCOUNT_CLASSES.indexOf(a.class) - ACCOUNT_CLASSES.indexOf(b.class) || a.label.localeCompare(b.label)).map((a) => (
          <li key={a.key} className={panel}>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <p className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{a.label}</p>
              <StatusBadge tone="neutral">{CLASS[a.class]}</StatusBadge>
            </div>
            <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 min-[520px]:grid-cols-2">
              <div className={row}><dt className="text-[var(--label-2)]">Saldo awal</dt><dd className="m-0 tabular-nums">{rp(a.opening)}</dd></div>
              <div className={row}><dt className="text-[var(--label-2)]">Debit</dt><dd className="m-0 tabular-nums">{rp(a.debit)}</dd></div>
              <div className={row}><dt className="text-[var(--label-2)]">Kredit</dt><dd className="m-0 tabular-nums">{rp(a.credit)}</dd></div>
              <div className={`${row} font-semibold`}><dt>Saldo akhir</dt><dd className="m-0 tabular-nums">{rp(a.closing)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>

      <h2 className="m-0 text-[1.35rem] font-semibold">Jurnal</h2>
      {finance && (
        <div className="grid min-w-0 gap-3">
          <ManualJournalForm ctx={x.ctx} accounts={j.accounts} branches={x.branches} today={t} />
          <section aria-label="Kunci Periode" className={panel}>
            <h3 className="m-0 text-[1.1rem] font-semibold">Kunci Periode</h3>
            <p className={muted}>Bulan yang dikunci tidak menerima jurnal lagi; transaksi yang terlambat masuk ke periode terbuka berikutnya dengan rujukan ke bulan aslinya.</p>
            <LockPeriodForm ctx={x.ctx} maxPeriod={prevMonth(t)} />
          </section>
        </div>
      )}
      {j.entries.length === 0 ? (
        <div className={panel} role="status"><p className="m-0 text-[var(--label-2)]">Belum ada jurnal pada periode ini.</p></div>
      ) : (
        <ul aria-label="Daftar jurnal" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {j.entries.map((e) => (
            <li key={e.id} className={panel}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <p className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{eventLabel(e.event)}</p>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge tone="neutral">{KIND[e.kind]}</StatusBadge>
                  {e.kind !== "manual" && <StatusBadge tone="warning">Pratinjau</StatusBadge>}
                </div>
              </div>
              <p className={muted}>{`${day(e.business_date)} · periode ${e.period}${e.original_period !== e.period ? ` (asal ${e.original_period})` : ""}${e.memo ? ` · ${e.memo}` : ""}`}</p>
              <dl className="m-0 grid min-w-0 gap-1">
                {e.lines.map((l, i) => (
                  <div key={i} className={row}><dt className="min-w-0 [overflow-wrap:anywhere]">{l.label}</dt>
                    <dd className="m-0 tabular-nums">{l.debit ? `Debit ${rp(l.debit)}` : `Kredit ${rp(l.credit)}`}</dd></div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}

      <h2 className="m-0 text-[1.35rem] font-semibold">Ekspor jurnal</h2>
      {finance ? (
        <section aria-label="Ekspor jurnal" className={panel}>
          {r.status.state === "active"
            ? <a href={`/keuangan/buku-besar/ekspor?${qs(f)}`} download className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Ekspor Jurnal (CSV)</a>
            : <p className="m-0" role="status">{r.status.map_signed ? "Ekspor jurnal belum tersedia: buku belum diaktifkan." : "Ekspor jurnal belum tersedia: posting map belum ditandatangani akuntan."}</p>}
          <p className={muted}>CSV jurnal berisi tanggal, kode cabang, akun, debit, kredit dan referensi; tanpa nama atau data klinis pasien.</p>
        </section>
      ) : (
        <p className={muted}>Mode baca: pemilik dan auditor melihat buku besar tanpa mengubah atau mengekspor.</p>
      )}
    </ListPage>
  );
}

export default function BukuBesarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={6} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
