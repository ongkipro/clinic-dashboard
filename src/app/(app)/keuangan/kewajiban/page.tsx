// Piutang & Kewajiban Layanan (UX-22 ▸ Kewajiban, 17:187, 19:179, PR-25; T-104): accounting step 1 roll-forwards of every sub-ledger for a
// period — opening, each movement, closing, and how each closing is checked — with the K5 prepaid liabilities first, receivable aging, the
// PPN section (cutover, PPN masukan / setoran recorded by finance) and Ekspor (CSV per ledger and transaction set; no journal, A-14).
// Readers: owner, finance, auditor (read only: no export, no form).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { LEDGERS, type Ledger, type Rollforward, TRANSACTION_SETS } from "../../../../modules/accounting/subledgers/subledgers";
import { filters, type Filters, loadKewajiban, today } from "./data";
import { VatFactForm } from "./forms";
import { CHECK, day, DIM, instant, LEDGER, rp, termLabel } from "./labels";

export const metadata: Metadata = { title: "Piutang & Kewajiban Layanan — Clinic Dashboard" };
const TITLE = "Piutang & Kewajiban Layanan";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const panel = "grid min-w-0 content-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const PREPAID: Ledger[] = ["paid_not_delivered", "package_liability", "patient_balance", "booking_dp"];
const SET: Record<string, string> = { payments: "Transaksi pembayaran", invoice_lines: "Baris invoice", commissions: "Komisi per penerima", stock: "Mutasi stok" };

const qs = (f: Filters, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ dari: f.from, sampai: f.to, ...extra });
  if (f.branch) p.set("cabang", f.branch);
  return p.toString();
};

function verdict(l: Ledger, d: Rollforward): { tone: "success" | "danger" | "neutral" | "warning"; text: string } {
  const c = d.checks[l];
  const r = d.ledgers[l];
  if (!r.closing_complete || !r.opening_complete) return { tone: "warning", text: "Riwayat belum lengkap" };
  if (l === "inter_branch") {
    if (d.branch_id) return { tone: "neutral", text: "Tanpa saldo pembanding" };
    return r.closing === 0 ? { tone: "success", text: "Seimbang antarcabang" } : { tone: "danger", text: `Tidak seimbang ${rp(r.closing)}` };
  }
  if (l === "cash_bank" || l === "gateway_clearing") {
    const x = d.checks.receipts;
    if (x && (x.mismatches > 0 || x.ledger_mismatch)) return { tone: "danger", text: "Penerimaan tidak cocok dengan alokasi" };
    return { tone: "neutral", text: "Tanpa saldo pembanding" };
  }
  if (c.level === "identity") return { tone: "neutral", text: "Tanpa saldo pembanding" };
  const bad = (c.mismatches ?? 0) + (c.carry_forward_mismatches ?? 0) + (c.stored_mismatches ?? 0);
  if (bad > 0) return { tone: "danger", text: `Tidak cocok (${bad} objek)` };
  // a comparator that did not run (a branch view, a report ending before today) or skipped objects never shows as a match (Sol r2 #3)
  if (c.ran === false) return { tone: "neutral", text: c.reason === "branch_view" ? "Belum dicocokkan (tampilan cabang)" : "Belum dicocokkan (tanggal lampau)" };
  if ((c.incomplete ?? 0) > 0) return { tone: "warning", text: `Sebagian dicocokkan (${c.incomplete} paket belum lengkap)` };
  if (c.expected !== undefined && c.expected !== r.closing) return { tone: "danger", text: `Tidak cocok (selisih ${rp(r.closing - c.expected)})` };
  return { tone: "success", text: c.level === "object" ? "Cocok per objek" : "Cocok" };
}

const UNAVAILABLE = "Tidak dapat direkonstruksi";
function LedgerCard({ l, d }: { l: Ledger; d: Rollforward }) {
  const r = d.ledgers[l];
  const v = verdict(l, d);
  const terms = Object.entries(r.terms).filter(([, a]) => a !== 0);
  const dims = Object.entries(r.by_dim).filter(([, a]) => a !== 0);
  const dimLabel = (k: string) => (l === "commission_payable" ? d.staff[k] ?? "Staf" : DIM[k] ?? k);
  return (
    <section aria-labelledby={`h-${l}`} className={panel}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <h3 id={`h-${l}`} className="m-0 min-w-0 text-[1.1rem] font-semibold [overflow-wrap:anywhere]">{LEDGER[l]}</h3>
        <StatusBadge tone={v.tone}>{v.text}</StatusBadge>
      </div>
      <dl className="m-0 grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt className="text-[var(--label-2)]">Saldo awal</dt>
          <dd className="m-0 tabular-nums">{r.opening_complete ? rp(r.opening) : UNAVAILABLE}</dd></div>
        {terms.map(([t, a]) => (
          <div key={t} className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt className="min-w-0 [overflow-wrap:anywhere]">{termLabel(t)}</dt><dd className="m-0 tabular-nums">{rp(a)}</dd></div>
        ))}
        <div className="flex min-w-0 flex-wrap justify-between gap-x-3 border-t border-[var(--separator)] pt-1 font-semibold"><dt>Saldo akhir</dt>
          <dd className="m-0 tabular-nums">{r.closing_complete ? rp(r.closing) : UNAVAILABLE}</dd></div>
        {r.known_before_cutover !== null && (
          <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt className="text-[var(--label-2)]">Total gerakan yang diketahui (bukan saldo)</dt>
            <dd className="m-0 tabular-nums text-[var(--label-2)]">{rp(r.known_before_cutover)}</dd></div>
        )}
      </dl>
      {dims.length > 0 && (
        <ul aria-label={`${LEDGER[l]} per rincian`} className="m-0 grid min-w-0 list-none gap-1 p-0">
          {dims.map(([k, a]) => <li key={k} className={`${muted} tabular-nums`}>{`${dimLabel(k)} ${rp(a)}`}</li>)}
        </ul>
      )}
      <p className={muted}>{`Pemeriksaan: ${CHECK[d.checks[l].level]}`}{l === "patient_balance" && " · per cabang asal saldo (FIFO)"}
        {l === "commission_payable" && " · per penerima dan carry-forward batch"}{(l === "cash_bank" || l === "gateway_clearing") && " · penerimaan = alokasi + belum dialokasikan"}</p>
    </section>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const f = filters(await searchParams);
  const r = await loadKewajiban(f);
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "kewajiban dan piutang" }} />;
  if (r.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "filtered-empty", message: "Filter tidak dapat dipakai.", clearHref: "/keuangan/kewajiban" }} />;
  const d = r.d;
  const k5 = PREPAID.reduce((s, l) => s + d.ledgers[l].closing, 0);
  const k5Complete = PREPAID.every((l) => d.ledgers[l].closing_complete);
  const any = LEDGERS.some((l) => d.ledgers[l].closing !== 0 || d.ledgers[l].opening !== 0 || Object.keys(d.ledgers[l].terms).length > 0);
  const t = today();
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <form method="get" action="/keuangan/kewajiban" aria-label="Filter periode" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-[repeat(3,minmax(0,1fr))_auto] min-[700px]:items-end">
        <label className="grid min-w-0 gap-1">Dari<input name="dari" type="date" defaultValue={f.from} max={t} className={input} /></label>
        <label className="grid min-w-0 gap-1">Sampai<input name="sampai" type="date" defaultValue={f.to} max={t} className={input} /></label>
        <label className="grid min-w-0 gap-1">Cabang
          <select name="cabang" defaultValue={f.branch ?? ""} className={input}>
            <option value="">Semua Cabang</option>
            {d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)]">Terapkan</button>
      </form>
      <KpiRow items={[
        { label: "Kewajiban prabayar (K5)", value: k5Complete ? rp(k5) : UNAVAILABLE, basis: k5Complete ? `Per ${day(f.to)} · layanan, paket, saldo, DP` : "Riwayat sebelum cutover PPN belum lengkap" },
        { label: "Piutang pasien", value: rp(d.ledgers.receivables.closing), basis: `Per ${day(f.to)}` },
        { label: "Komisi terutang", value: rp(d.ledgers.commission_payable.closing), basis: `Per ${day(f.to)}` },
      ]} />
      {f.branch && <p className={muted}>Tampilan per cabang: komisi dibayar dan PPN masukan / setoran tidak berlabel cabang sehingga hanya tampil pada Semua Cabang.</p>}
      {!any && <div className={panel} role="status"><p className="m-0 text-[var(--label-2)]">Belum ada transaksi pada periode ini.</p></div>}
      {d.vat.cutover_at && (["paid_not_delivered", "package_liability"] as Ledger[]).some((l) => !d.ledgers[l].closing_complete || !d.ledgers[l].opening_complete) && (
        <p role="status" className={muted}>{`Komponen PPN kewajiban layanan dan paket sebelum cutover ${instant(d.vat.cutover_at)} tidak dapat direkonstruksi untuk sebagian transaksi: saldo yang memuatnya tidak diklaim.`}</p>
      )}

      <h2 className="m-0 text-[1.35rem] font-semibold">Kewajiban prabayar</h2>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">{PREPAID.map((l) => <LedgerCard key={l} l={l} d={d} />)}</div>

      <h2 className="m-0 text-[1.35rem] font-semibold">Piutang dan komisi</h2>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
        <div className="grid min-w-0 content-start gap-3">
          <LedgerCard l="receivables" d={d} />
          {d.aging && (
            <section aria-label="Umur piutang" className={panel}>
              <h3 className="m-0 text-[1.1rem] font-semibold">Umur piutang terbuka</h3>
              <dl className="m-0 grid min-w-0 gap-1">
                {[["0–30 hari", d.aging.d0_30], ["31–60 hari", d.aging.d31_60], ["61–90 hari", d.aging.d61_90], ["Lebih dari 90 hari", d.aging.d90]].map(([k, a]) => (
                  <div key={k as string} className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>{k}</dt><dd className="m-0 tabular-nums">{rp(a as number)}</dd></div>
                ))}
              </dl>
            </section>
          )}
        </div>
        <LedgerCard l="commission_payable" d={d} />
      </div>

      <h2 className="m-0 text-[1.35rem] font-semibold">Pajak (PPN)</h2>
      {!d.vat.pkp_ever ? (
        <div className={panel} role="status"><p className="m-0 text-[var(--label-2)]">Klinik bukan PKP pada periode ini.</p></div>
      ) : (
        <div className="grid min-w-0 gap-3">
          {d.vat.cutover_at && !d.vat.closing_complete && (
            <p role="status" className={muted}>{`Riwayat PPN sebelum ${instant(d.vat.cutover_at)} tidak dapat direkonstruksi: saldo akhir tidak diklaim, gerakan yang tercatat tetap tampil.`}</p>
          )}
          {d.vat.cutover_at && d.vat.closing_complete && !d.vat.opening_complete && (
            <p role="status" className={muted}>{`Pembukaan tidak lengkap (sebelum cutover ${instant(d.vat.cutover_at)}); selisih sebelum cutover tampil sebagai pos tersendiri.`}</p>
          )}
          <LedgerCard l="vat" d={d} />
          <ul aria-label="Status pencatatan PPN per masa" className="m-0 grid min-w-0 list-none gap-1 p-0">
            {d.vat.periods.filter((p) => p.pkp).map((p) => (
              <li key={p.period} className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="tabular-nums">{p.period}</span>
                {p.input_recorded ? <StatusBadge tone="success">PPN masukan tercatat</StatusBadge> : <StatusBadge tone="warning">PPN masukan belum dicatat</StatusBadge>}
                {p.paid_recorded ? <StatusBadge tone="success">Setoran tercatat</StatusBadge> : <StatusBadge tone="warning">Setoran PPN belum dicatat</StatusBadge>}
              </li>
            ))}
          </ul>
          {(d.vat.input_credits.length > 0 || d.vat.payments.length > 0) && (
            <ul aria-label="Catatan PPN masukan dan setoran" className="m-0 grid min-w-0 list-none gap-1 p-0">
              {d.vat.input_credits.map((c) => <li key={c.id} className={muted}>{`PPN masukan ${c.period} · ${day(c.effective_on)} · ${rp(c.amount)} · ${c.evidence_ref}${c.reason ? ` · ${c.reason}` : ""}`}</li>)}
              {d.vat.payments.map((c) => <li key={c.id} className={muted}>{`Setoran ${c.period} · ${day(c.paid_on)} · ${rp(c.amount)} · NTPN ${c.ntpn}${c.reason ? ` · ${c.reason}` : ""}`}</li>)}
            </ul>
          )}
          {d.can_record_vat && (
            <div className="flex min-w-0 flex-wrap items-start gap-2">
              <VatFactForm ctx={r.ctx} kind="input" period={f.to.slice(0, 7)} today={t} />
              <VatFactForm ctx={r.ctx} kind="paid" period={f.to.slice(0, 7)} today={t} />
            </div>
          )}
        </div>
      )}

      <h2 className="m-0 text-[1.35rem] font-semibold">Kas, bank dan kliring</h2>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
        {(["cash_bank", "gateway_clearing", "inter_branch"] as Ledger[]).map((l) => <LedgerCard key={l} l={l} d={d} />)}
      </div>
      <p className={muted}>Kliring gateway menunggu settlement (dicatat di modul Buku Besar). Utang pemasok ada di Pembelian › Utang.</p>
      <Link href="/pembelian/utang" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka Utang Pemasok</Link>

      <h2 className="m-0 text-[1.35rem] font-semibold">Ekspor</h2>
      {d.can_export ? (
        <section aria-label="Ekspor CSV" className={panel}>
          <p className={muted}>CSV berisi tanggal, kode cabang, jumlah, nomor dokumen dan ID; tanpa nama atau data klinis pasien. Jurnal tersedia setelah peta posting ditandatangani.</p>
          <ul className="m-0 grid min-w-0 list-none grid-cols-[minmax(0,1fr)] gap-1 p-0 min-[700px]:grid-cols-2">
            {[...LEDGERS.map((l) => [l, LEDGER[l]] as const), ...TRANSACTION_SETS.map((s) => [s, SET[s]] as const)].map(([k, label]) => (
              <li key={k}><a href={`/keuangan/kewajiban/ekspor?${qs(f, { jenis: k })}`} download className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)] [overflow-wrap:anywhere]">{`Ekspor ${label}`}</a></li>
            ))}
          </ul>
        </section>
      ) : (
        <p className={muted}>Mode baca: auditor melihat kewajiban tanpa ekspor.</p>
      )}
    </ListPage>
  );
}

export default function KewajibanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={6} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
