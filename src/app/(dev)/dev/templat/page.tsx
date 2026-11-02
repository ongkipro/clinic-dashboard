// Page-template gallery (T-014): VisitTrack in every segment state and the list, detail
// and report templates in each state, with static synthetic sample data. Development
// only: the host proxy refuses /dev in production, and this page returns not-found too.
// ?keadaan=loading|empty|filtered-empty|error|blocked|permission|rows selects the list
// state.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DetailPage, ListPage, type ListState, ReportTable, Row, RowList } from "@/components/templates/templates";
import { VisitTrack } from "@/components/visit-track/visit-track";

export const metadata: Metadata = { title: "Galeri Templat", robots: { index: false, follow: false } };

const STATES: Record<string, ListState> = {
  loading: { kind: "loading" },
  empty: { kind: "empty", message: "Belum ada pasien.", action: "Daftarkan Pasien", actionHref: "/dev/templat" },
  "filtered-empty": { kind: "filtered-empty", message: "Tidak ada janji untuk filter ini.", clearHref: "/dev/templat" },
  error: { kind: "error", message: "Koneksi terputus.", retryHref: "/dev/templat" },
  blocked: { kind: "blocked", reason: "Belum dibayar", unblock: "Kasir dapat menerima pembayaran" },
  permission: { kind: "permission", object: "daftar pasien" },
  rows: { kind: "rows" },
};

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

async function Lists({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const key = typeof q.keadaan === "string" && q.keadaan in STATES ? q.keadaan : "rows";
  return (
    <ListPage
      as="section"
      title="Hari Ini"
      primaryAction={{ label: "Pasien Datang", href: "/dev/templat" }}
      search={{ name: "q", label: "Cari pasien, No. RM atau HP", action: "/dev/templat", keep: key === "rows" ? {} : { keadaan: key } }}
      filters={[
        { label: "Semua", href: "/dev/templat", active: key === "rows" },
        { label: "Menunggu", href: "/dev/templat?keadaan=filtered-empty", active: key === "filtered-empty" },
        { label: "Belum Bayar", href: "/dev/templat?keadaan=blocked", active: key === "blocked" },
      ]}
      sort={[{ label: "Jam", href: "/dev/templat", active: true }, { label: "Nama", href: "/dev/templat" }]}
      columns={[{ id: "jam", label: "Jam", visible: true }, { id: "bc", label: "BC", visible: false }]}
      bulkActions={[{ label: "Kirim Pengingat", href: "/dev/templat" }]}
      selectedCount={2}
      exportHref="/dev/templat"
      state={STATES[key]}
    >
      <RowList label="Kunjungan hari ini">
        <Row href="/dev/templat" title="10.30 · Rina Sintetis" subtitle="Peeling Wajah · Dr. Maya">
          <VisitTrack
            summary
            states={{ Daftar: "selesai", Pendampingan: "selesai", Dokter: "selesai", Pilihan: "selesai", Persetujuan: "selesai", Bayar: "terblokir" }}
            blocker={`Menunggu pembayaran tambahan ${rupiah.format(350_000)}`}
          />
        </Row>
        <Row href="/dev/templat" title="11.00 · Dewi Contoh" subtitle="Kontrol · Dr. Maya">
          <VisitTrack summary states={{ Daftar: "selesai", Pendampingan: "tidak_perlu", Dokter: "berjalan" }} />
        </Row>
      </RowList>
    </ListPage>
  );
}

export default function TemplatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="grid min-h-dvh gap-12 bg-[var(--bg-grouped)] px-4 pb-8 pt-[max(env(safe-area-inset-top),24px)] md:px-5">
      <section aria-labelledby="vt" className="mx-auto grid w-full max-w-[1100px] gap-4">
        <h2 id="vt" className="m-0 text-[1.18rem] font-semibold">Jalur Kunjungan</h2>
        <div className="grid gap-5 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <VisitTrack states={{}} />
          <VisitTrack states={{ Daftar: "selesai", Pendampingan: "selesai", Dokter: "berjalan" }} />
          <VisitTrack
            states={{ Daftar: "selesai", Pendampingan: "tidak_perlu", Dokter: "selesai", Pilihan: "selesai", Persetujuan: "selesai", Bayar: "terblokir" }}
            blocker={`Menunggu pembayaran tambahan ${rupiah.format(350_000)}`}
          />
          <VisitTrack
            states={{ Daftar: "selesai", Pendampingan: "selesai", Dokter: "selesai", Pilihan: "selesai", Persetujuan: "selesai", Bayar: "selesai", Persiapan: "selesai", Tindakan: "selesai", Serahkan: "selesai", Selesai: "selesai" }}
          />
        </div>
      </section>
      <Suspense>
        <Lists searchParams={searchParams} />
      </Suspense>
      <DetailPage
        as="section"
        title="Rina Sintetis"
        subtitle="No. RM KMG-2026-000123 · 32 tahun · Cabang Kemang"
        status={{ tone: "warning", label: "Belum dibayar" }}
        primaryAction={{ label: "Tagih", href: "/dev/templat" }}
        sections={[
          { id: "kunjungan", label: "Kunjungan", content: <p className="m-0">Peeling Wajah, sesi 2 dari 6.</p> },
          { id: "paket", label: "Paket & Saldo", content: <p className="m-0">Saldo {rupiah.format(1_250_000)}.</p> },
        ]}
        timeline={[
          { at: "2026-11-02T03:30:00Z", label: "Pasien datang", detail: "Antrean A-012" },
          { at: "2026-11-02T03:45:00Z", label: "Dokter selesai memeriksa" },
        ]}
        related={[{ label: "Tagihan INV-KMG-2611-0042", href: "/dev/templat" }]}
        auditHref="/dev/templat"
      >
        <VisitTrack
          states={{ Daftar: "selesai", Pendampingan: "selesai", Dokter: "selesai", Pilihan: "selesai", Persetujuan: "selesai", Bayar: "terblokir" }}
          blocker={`Menunggu pembayaran tambahan ${rupiah.format(350_000)}`}
        />
      </DetailPage>
      <section className="mx-auto grid w-full max-w-[1100px] gap-4" aria-label="Contoh laporan">
        <h2 className="m-0 text-[1.18rem] font-semibold">Laporan Penjualan & Uang</h2>
        <ReportTable
          caption="Uang masuk per cabang"
          kpis={[
            { label: "Uang Masuk", value: rupiah.format(48_250_000), delta: { direction: "naik", text: "12% dibanding minggu lalu" }, basis: "1–7 Nov 2026, tanggal bayar" },
            { label: "Layanan Selesai", value: "214", delta: { direction: "turun", text: "3% dibanding minggu lalu" }, basis: "1–7 Nov 2026, tanggal tindakan" },
          ]}
          columns={[
            { id: "cabang", label: "Cabang" },
            { id: "uang", label: "Uang masuk", numeric: true },
            { id: "layanan", label: "Layanan selesai", numeric: true },
          ]}
          rows={[
            { cabang: "Cabang Kemang", uang: rupiah.format(30_100_000), layanan: "131" },
            { cabang: "Cabang Senopati", uang: rupiah.format(18_150_000), layanan: "83" },
          ]}
        />
      </section>
    </main>
  );
}
