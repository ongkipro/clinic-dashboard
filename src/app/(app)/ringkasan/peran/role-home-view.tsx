// Ringkasan per peran (UX-60, 19 §2.1; T-107 slice 4): the Klinis, Marketing, Apotek, Pembelian and Audit homes. Presentational and
// server-compatible: renders the dashboard_home payload it is given (counts, money, staff names, dates — no clinical text). Each widget
// links only to a page that exists on disk; a widget whose source page is not built yet has no link.
import Link from "next/link";
import { KpiRow, PageTitle, Row, RowList } from "../../../../components/templates/templates";
import type { ApotekHome, AuditHome, KlinisHome, MarketingHome, PembelianHome, RoleHome } from "../../../../modules/reporting/dashboards/dashboards";
import { SOURCE } from "../../lead/labels";

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
const count = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const date = (d: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));
const dayLong = (d: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const muted = "m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]";
const sub = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

// "Keluhan klinis terbuka" → "keluhan klinis terbuka" inside a sentence; an acronym ("SATUSEHAT ditolak") keeps its case.
const sentence = (label: string) => (/^[A-Z0-9]{2,}\b/.test(label) ? label : label[0].toLowerCase() + label.slice(1));
// One count tile with its basis and, when the source page exists, a link to it.
type Tile = { label: string; value: string; basis: string; href?: string };
function Tiles({ items }: { items: Tile[] }) {
  return (
    <div className="grid min-w-0 gap-2">
      <KpiRow items={items.map(({ label, value, basis }) => ({ label, value, basis }))} />
      {items.some((i) => i.href) && (
        <nav aria-label="Buka halaman sumber" className="flex min-w-0 flex-wrap gap-x-4">
          {items.filter((i) => i.href).map((i) => (
            <Link key={i.label} href={i.href!} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">
              {`Lihat ${sentence(i.label)}`}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-2">
      <h2 id={id} className="m-0 text-[1.18rem] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <PageTitle title={title} />
      <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">{sub}</p>
    </div>
  );
}

function Klinis({ d }: { d: KlinisHome }) {
  return (
    <>
      <Header title="Ringkasan Klinis" sub={dayLong(d.today)} />
      <Section id="rk-perlu" title="Perlu ditangani">
        <Tiles items={[
          { label: "Keluhan klinis terbuka", value: count(d.complaints_open), basis: "Belum selesai", href: "/keluhan" },
          { label: "Insiden terbuka", value: count(d.incidents_open), basis: "Belum ditutup", href: "/keluhan/insiden" },
          { label: "SATUSEHAT ditolak", value: count(d.satusehat_rejected), basis: "Gagal atau pengecualian", href: "/satusehat" },
        ]} />
      </Section>
      <Section id="rk-koreksi" title="Koreksi menunggu">
        {d.corrections_pending.length === 0 ? <p role="status" className={muted}>Tidak ada koreksi yang menunggu.</p> : (
          <RowList label="Koreksi menunggu">
            {d.corrections_pending.map((c) => <Row key={c.id} href="/persetujuan" title={c.requested_by} subtitle={`Diajukan ${date(c.requested_at)}`} />)}
          </RowList>
        )}
      </Section>
      <Section id="rk-str" title="STR/SIP hampir habis">
        {d.credentials_expiring.length === 0 ? <p role="status" className={muted}>Tidak ada STR/SIP yang habis dalam 60 hari.</p> : (
          <RowList label="STR/SIP hampir habis">
            {d.credentials_expiring.map((c) => <Row key={c.id} href="/staf" title={c.staff} subtitle={`${c.kind.toUpperCase()} · habis ${date(c.expires_on)}`} />)}
          </RowList>
        )}
      </Section>
    </>
  );
}

const STAGE: Record<string, string> = { new: "Baru", contacted: "Dihubungi", booked: "Buat janji", arrived: "Datang", converted: "Bayar", lost: "Batal" };
function Marketing({ d }: { d: MarketingHome }) {
  const stages = Object.keys(STAGE).map((k) => ({ label: STAGE[k], value: count(d.leads_by_stage[k] ?? 0), basis: "Lead saat ini" }));
  return (
    <>
      <Header title="Ringkasan Marketing" sub={dayLong(d.today)} />
      <Section id="rm-lead" title="Lead per tahap">
        <KpiRow items={stages} />
        <Link href="/lead" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Lihat lead</Link>
      </Section>
      {/* r3 (19 :40, UX-60): source (K13) and response (K14) for the stated window; empty states written, the source list links to /lead */}
      <Section id="rm-sumber" title="Sumber lead (K13)">
        <p className={sub}>{`${date(d.window.from)} – ${date(d.window.to)} · lead dibuat pada periode ini`}</p>
        {d.k13.lead === 0 ? <p role="status" className={muted}>Belum ada lead pada periode ini.</p> : (
          <ul aria-label="Sumber lead" className="m-0 grid list-none overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
            {Object.entries(d.k13.by_source).sort(([a], [b]) => a.localeCompare(b)).map(([src, c]) => (
              <li key={src} className="flex min-h-[var(--target)] min-w-0 flex-wrap items-center justify-between gap-x-3 border-b border-[var(--separator)] px-4 py-[11px] last:border-b-0 [border-bottom-width:0.5px]">
                <span className="font-semibold [overflow-wrap:anywhere]">{SOURCE[src] ?? src}</span>
                <span className="tabular text-[var(--label-2)]">{`${count(c.lead ?? 0)} lead · ${count(c.booked ?? 0)} buat janji · ${count(c.arrived ?? 0)} datang · ${count(c.paid ?? 0)} bayar`}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="rm-respons" title="Respons lead (K14)">
        <p className={sub}>{`${date(d.window.from)} – ${date(d.window.to)} · lead pada jam buka cabang`}</p>
        {d.k14.leads === 0 ? <p role="status" className={muted}>Belum ada lead pada jam buka di periode ini.</p> : (
          <KpiRow items={[
            { label: "Median respons", value: d.k14.median_minutes === null ? "—" : `${d.k14.median_minutes} menit`, basis: `${count(d.k14.answered)} dari ${count(d.k14.leads)} lead dijawab` },
            { label: "Dijawab ≤ 15 menit", value: count(d.k14.within_15m), basis: `dari ${count(d.k14.leads)} lead` },
            // r4 (re-review 3dcdb005 #3): each lead is judged by the SLA in effect when it entered; the label names those thresholds,
            // never today's setting
            { label: "Dijawab sesuai SLA saat lead masuk", value: count(d.k14.within_sla),
              basis: d.k14.sla_mix.map((m) => `SLA ${m.minutes} menit: ${count(m.within)} dari ${count(m.leads)}`).join(" · ") },
          ]} />
        )}
      </Section>
      <Section id="rm-promo" title="Kode promo bulan ini">
        {d.promo_this_month.length === 0 ? <p role="status" className={muted}>Belum ada kode promo terpakai bulan ini.</p> : (
          <ul aria-label="Kode promo bulan ini" className="m-0 grid list-none overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
            {d.promo_this_month.map((p) => (
              <li key={p.code} className="flex min-h-[var(--target)] min-w-0 flex-wrap items-center justify-between gap-x-3 border-b border-[var(--separator)] px-4 py-[11px] last:border-b-0 [border-bottom-width:0.5px]">
                <span className="font-semibold [overflow-wrap:anywhere]">{p.code}</span>
                <span className="tabular text-[var(--label-2)]">{`${count(p.uses)} kali · diskon ${rp(p.discount)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="rm-pasien" title="Pasien dan survei">
        <KpiRow items={[
          { label: "Pasien lama tidak datang", value: count(d.dormant_patients), basis: "Kunjungan terakhir lewat batas SET-22, dalam 12 bulan" },
          { label: "Survei bulan ini", value: count(d.surveys_this_month.count), basis: d.surveys_this_month.average === null ? "Belum ada skor" : `Rata-rata ${d.surveys_this_month.average} · skor ≤ 2: ${count(d.surveys_this_month.low)}` },
        ]} />
      </Section>
    </>
  );
}

function Apotek({ d }: { d: ApotekHome }) {
  return (
    <>
      <Header title="Ringkasan Apotek" sub={dayLong(d.today)} />
      <Section id="ra-antrean" title="Menunggu">
        <Tiles items={[
          { label: "Siapkan", value: count(d.to_prepare), basis: "Menunggu disiapkan", href: "/apotek/siapkan" },
          { label: "Serahkan", value: count(d.to_hand_over), basis: "Siap diserahkan", href: "/apotek/serahkan" },
        ]} />
      </Section>
      <Section id="ra-stok" title="Stok">
        <Tiles items={[
          { label: "Hampir kedaluwarsa", value: count(d.near_expiry), basis: "Batch dalam batas SET-27", href: "/stok" },
          { label: "Vial terbuka lewat batas pakai", value: count(d.vials_lapsed), basis: "Masih tercatat terbuka" },
          { label: "Vial habis batas dalam 24 jam", value: count(d.vials_due_24h), basis: "Batas pakai dalam 24 jam" },
          { label: "Karantina", value: count(d.batches_held.quarantined), basis: "Karantina atau suhu menyimpang" },
          { label: "Recall", value: count(d.batches_held.recalled), basis: "Batch ditarik" },
          { label: "Penerimaan hari ini", value: count(d.po_received_today), basis: "Barang diterima hari ini", href: "/pembelian/po" },
        ]} />
      </Section>
    </>
  );
}

function Pembelian({ d }: { d: PembelianHome }) {
  const below = Object.values(d.below_min_by_branch).reduce((a, b) => a + b, 0);
  return (
    <>
      <Header title="Ringkasan Pembelian" sub={dayLong(d.today)} />
      <Tiles items={[
        { label: "Di bawah minimum", value: count(below), basis: `${count(Object.keys(d.below_min_by_branch).length)} cabang`, href: "/stok" },
        { label: "PO terbuka", value: count(d.po_open), basis: "Terkirim atau diterima sebagian", href: "/pembelian/po" },
        { label: "Utang jatuh tempo", value: rp(d.payables_due.outstanding), basis: `${count(d.payables_due.count)} faktur, jatuh tempo ≤ 7 hari`, href: "/pembelian/utang" },
      ]} />
    </>
  );
}

function Audit({ d }: { d: AuditHome }) {
  return (
    <>
      <Header title="Ringkasan Audit" sub={`Bulan ini sejak ${date(d.month_from)}`} />
      <KpiRow items={[
        { label: "Diskon manual", value: rp(d.manual_discounts.discount), basis: `${count(d.manual_discounts.count)} baris tagihan` },
        { label: "Void", value: count(d.voids.count), basis: "Tagihan dibatalkan" },
        { label: "Selisih kas", value: rp(d.cash_variance.absolute), basis: `${count(d.cash_variance.count)} shift berselisih` },
        { label: "Selisih stok", value: count(d.stock_variance.lines), basis: `${count(d.stock_variance.counts)} hitung stok` },
        { label: "Hapus buku", value: rp(d.write_offs.amount), basis: `${count(d.write_offs.count)} piutang` },
      ]} />
    </>
  );
}

export function RoleHomeView({ data }: { data: RoleHome }) {
  return (
    <div className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      {data.home === "klinis" ? <Klinis d={data} /> : data.home === "marketing" ? <Marketing d={data} /> : data.home === "apotek" ? <Apotek d={data} />
        : data.home === "pembelian" ? <Pembelian d={data} /> : <Audit d={data} />}
    </div>
  );
}
