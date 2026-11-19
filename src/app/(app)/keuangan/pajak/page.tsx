// Pajak ▸ Coretax (UX-22 ▸ Pajak, 17 :187, 19 :181, PR-98; T-106): the tenant's PKP status and, per tax month, the Coretax XML documents built
// from frozen facts — digunggung end-consumer faktur, named-buyer faktur (no rows: no buyer tax identity is recorded), returns, and the
// clinic's cancellation register. Blocked with "Bukti saran pajak belum disetujui" until the coretax_export gate opens (PR-97). Readers: owner,
// finance, auditor; owner and finance download (audited, logged with the SHA-256 of the bytes).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { DOC_KINDS, type CoretaxStatus } from "../../../../modules/accounting/coretax/coretax";
import { loadPajak, period, thisMonth } from "./data";
import { DOC, masa, REFUSED, rp, when } from "./labels";

export const metadata: Metadata = { title: "Pajak — Clinic Dashboard" };
const TITLE = "Pajak";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const panel = "grid min-w-0 content-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const row = "flex min-w-0 flex-wrap justify-between gap-x-3";

function Blocked({ s }: { s: CoretaxStatus }) {
  if (!s.block) return null;
  return (
    <section aria-label="Ekspor Coretax terkunci" className={`${panel} border border-[var(--warning)]`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2"><StatusBadge tone="locked">Terkunci</StatusBadge></div>
      <p className="m-0 font-semibold [overflow-wrap:anywhere]" role="status">{REFUSED[s.block]}</p>
      {s.block === "gate_closed" && (
        <>
          <p className="m-0 [overflow-wrap:anywhere]">{`Ekspor Coretax terbuka setelah bukti berikut disetujui: ${s.missing.join(", ") || "saran konsultan pajak"}.`}</p>
          <Link href="/kepatuhan" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka Kepatuhan &amp; Pendapat Ahli</Link>
        </>
      )}
      {s.block === "npwp_missing" && <p className={muted}>Pemilik mengisi NPWP klinik di Pengaturan ▸ Pajak.</p>}
      {s.block === "not_pkp" && <p className={muted}>Tidak ada tagihan yang terbit sebagai PKP pada masa ini, dan klinik tidak berstatus PKP.</p>}
    </section>
  );
}

function Docs({ s, canExport }: { s: CoretaxStatus; canExport: boolean }) {
  const r = s.docs.retail;
  return (
    <ul aria-label="Dokumen Coretax" className="m-0 grid min-w-0 list-none grid-cols-[minmax(0,1fr)] gap-2 p-0 min-[900px]:grid-cols-2">
      {DOC_KINDS.map((k) => {
        const d = s.docs[k];
        const pending = k === "retail" && r.pending > 0;
        // the named-buyer faktur is downloadable with zero rows: its empty ListOfTaxInvoice is the structural document (r2 P1)
        const ready = canExport && !s.block && (d.n > 0 || k === "faktur") && !pending && !d.bounds_exceeded;
        return (
          <li key={k} className={panel}>
            <h3 className="m-0 text-[1.1rem] font-semibold [overflow-wrap:anywhere]">{DOC[k].title}</h3>
            <p className={muted}>{DOC[k].detail}</p>
            {!d.bounds_exceeded && <dl className="m-0 grid min-w-0 gap-1">
              <div className={row}><dt>Baris</dt><dd className="m-0 tabular-nums">{d.n}</dd></div>
              <div className={row}><dt>{k === "retur" ? "DPP retur" : "DPP"}</dt><dd className="m-0 tabular-nums">{rp(d.base)}</dd></div>
              <div className={row}><dt>{k === "retur" ? "PPN retur" : "PPN"}</dt><dd className="m-0 tabular-nums">{rp(d.vat)}</dd></div>
            </dl>}
            {d.bounds_exceeded && <p className="m-0 rounded-[var(--radius-field)] bg-warning-soft px-3 py-2 text-warning [overflow-wrap:anywhere]" role="status">{`${REFUSED.bounds_exceeded}. Ekspor tidak tersedia; hubungi tim platform.`}</p>}
            {pending && <p className="m-0 rounded-[var(--radius-field)] bg-warning-soft px-3 py-2 text-warning" role="status">{`${REFUSED.discount_pending} (${r.pending} item). Ekspor menunggu keputusannya.`}</p>}
            {k === "retail" && r.mismatch > 0 && (
              <p className={muted} role="status">{`${r.mismatch} baris punya PPN beku yang berbeda Rp1 dari rumus DJP (12% × DPP Nilai Lain). Nilai di dokumen tetap PPN yang tercatat di tagihan; periksa dengan konsultan pajak sebelum unggah.`}</p>
            )}
            {ready
              ? <a href={`/keuangan/pajak/ekspor?masa=${s.period}&dokumen=${k}`} download className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Ekspor XML</a>
              : d.n === 0 && !d.bounds_exceeded && <p className={muted}>Tidak ada baris pada masa ini.</p>}
          </li>
        );
      })}
    </ul>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = period(await searchParams);
  const x = await loadPajak(p);
  if (x.kind === "redirect") redirect(x.to);
  if (x.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "pajak" }} />;
  if (x.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "filtered-empty", message: "Masa pajak tidak dapat dipakai.", clearHref: "/keuangan/pajak" }} />;
  const { s } = x;
  const canExport = x.role === "owner" || x.role === "finance";
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <KpiRow items={[
        { label: "Status PKP", value: s.is_pkp ? "PKP" : "Bukan PKP", basis: s.is_pkp && s.pkp_effective_from ? `Sejak ${s.pkp_effective_from}` : "Profil pajak klinik" },
        { label: "Ekspor Coretax", value: s.gate_open ? "Terbuka" : "Terkunci", basis: s.gate_open ? "Saran pajak disetujui" : "Menunggu bukti saran pajak" },
        // r3 (review b26b1ff0): beyond the supported ceiling the status carries no totals — never show them as Rp0
        s.docs.retail.bounds_exceeded
          ? { label: "PPN keluaran masa ini", value: "Melebihi batas", basis: `${masa(s.period)} · total tidak ditampilkan (di atas batas yang didukung)` }
          : { label: "PPN keluaran masa ini", value: rp(s.docs.retail.vat), basis: `${masa(s.period)} · digunggung` },
      ]} />
      <form method="get" action="/keuangan/pajak" aria-label="Pilih masa pajak" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-end">
        <label className="grid min-w-0 gap-1">Masa pajak<input name="masa" type="month" defaultValue={s.period} max={thisMonth()} className={input} /></label>
        <button type="submit" className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)]">Tampilkan</button>
      </form>
      <Blocked s={s} />

      <h2 className="m-0 text-[1.35rem] font-semibold">{`Dokumen Coretax — ${masa(s.period)}`}</h2>
      <Docs s={s} canExport={canExport} />
      <p className={muted}>Dokumen dibangun dari snapshot pajak tagihan saat terbit (DPP dan PPN beku), bukan dari harga atau pengaturan hari ini. Nomor faktur (NSFP) diberikan DJP setelah unggah; ekspor tidak mengubah tagihan.</p>
      {!canExport && <p className={muted}>Mode baca: auditor melihat status dan riwayat ekspor tanpa mengunduh.</p>}

      <h2 className="m-0 text-[1.35rem] font-semibold">Riwayat ekspor</h2>
      {s.history.length === 0 ? (
        <div className={panel} role="status"><p className="m-0 text-[var(--label-2)]">Belum ada ekspor Coretax.</p></div>
      ) : (
        <ul aria-label="Riwayat ekspor Coretax" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {s.history.map((h) => (
            <li key={`${h.at}-${h.sha256}`} className={panel}>
              <p className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{`${DOC[h.kind].title} · ${masa(h.period)}`}</p>
              <p className={muted}>{`${when(h.at)} · ${h.by} · ${h.rows} baris · DPP ${rp(h.base)} · PPN ${rp(h.vat)}`}</p>
              <p className={`${muted} font-mono text-[0.78rem]`}>{`SHA-256 ${h.sha256}`}</p>
            </li>
          ))}
        </ul>
      )}
    </ListPage>
  );
}

export default function PajakPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={6} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
