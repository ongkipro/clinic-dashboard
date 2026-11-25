// Kirim Laporan Terjadwal page (19 §2.13, UX-38 ▸ Jadwal, PR-80 / SET-37; Owner only).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { loadTerjadwalIn } from "./data";

export const metadata: Metadata = { title: "Kirim Laporan Terjadwal — Clinic Dashboard" };
const TITLE = "Kirim Laporan Terjadwal";

const panel = "grid min-w-0 content-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

const RECIPIENT_LABELS: Record<string, string> = {
  owner: "Owner",
  admin_pusat: "Admin Pusat",
  finance: "Keuangan",
  manager: "Manajer Cabang",
};

async function Body() {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  const ctx = rc.kind === "ok" ? rc.active.context : null;
  if (!ctx || ctx.actingRole !== "owner") {
    return (
      <ListPage
        as="section"
        title={TITLE}
        state={{ kind: "permission", object: "kirim laporan terjadwal" }}
      />
    );
  }

  let data;
  try {
    data = await withTenantContext(await appPool(), ctx, (db) => loadTerjadwalIn(db));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") {
      return (
        <ListPage
          as="section"
          title={TITLE}
          state={{ kind: "permission", object: "kirim laporan terjadwal" }}
        />
      );
    }
    throw e;
  }

  const activeOpt = data.optIn.kind === "in" ? data.optIn : null;
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <KpiRow
        items={[
          {
            label: "Status jadwal (SET-37)",
            value: activeOpt ? "Aktif" : "Nonaktif",
            basis: activeOpt ? `Tutup hari pukul ${activeOpt.at} (${data.zone})` : "Default opt-in nonaktif",
          },
          {
            label: "Saluran aktif",
            value: "Email (agregat)",
            basis: "Tanpa nama pasien atau isi klinis",
          },
          {
            label: "Cakupan cabang",
            value: String(data.branchCount),
            basis: `Zona utama ${data.zone}`,
          },
        ]}
      />

      <section aria-labelledby="h-jadwal-set37" className={panel}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 id="h-jadwal-set37" className="m-0 text-[1.15rem] font-semibold">
            Konfigurasi ringkasan harian (SET-37)
          </h2>
          <StatusBadge tone={activeOpt ? "success" : "neutral"}>
            {activeOpt ? `Aktif · ${activeOpt.at}` : "Nonaktif"}
          </StatusBadge>
        </div>
        {data.optIn.kind === "in" ? (
          <dl className="m-0 grid min-w-0 gap-1.5">
            <div className="flex min-w-0 flex-wrap justify-between gap-x-3">
              <dt className="text-[var(--label-2)]">Jam pengiriman</dt>
              <dd className="m-0 font-medium tabular-nums">{`${data.optIn.at} (${data.zone})`}</dd>
            </div>
            <div className="flex min-w-0 flex-wrap justify-between gap-x-3">
              <dt className="text-[var(--label-2)]">Peran penerima</dt>
              <dd className="m-0 font-medium">
                {data.optIn.recipients.map((r) => RECIPIENT_LABELS[r] ?? r).join(", ")}
              </dd>
            </div>
          </dl>
        ) : (
          <p className={muted}>
            Ringkasan harian saat ini nonaktif. Aktifkan dan pilih jam (17:00–23:00) serta peran penerima di Pengaturan Laporan.
          </p>
        )}
        <Link
          href="/pengaturan/laporan"
          className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]"
        >
          Ubah jadwal SET-37 di Pengaturan Laporan
        </Link>
      </section>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
        <section aria-labelledby="h-isi-ringkasan" className={panel}>
          <h2 id="h-isi-ringkasan" className="m-0 text-[1.15rem] font-semibold">
            Isi ringkasan agregat
          </h2>
          <p className={muted}>
            Memuat angka agregat K1 (Uang masuk), K2 (Layanan selesai) per cabang, dan 6 hitungan pengecualian berikut tanpa identitas pasien:
          </p>
          <ul className="m-0 grid list-disc gap-1 pl-5 text-[0.9rem]">
            {data.exceptionLabels.map((lbl) => (
              <li key={lbl}>{lbl}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-saluran-riwayat" className={panel}>
          <h2 id="h-saluran-riwayat" className="m-0 text-[1.15rem] font-semibold">
            Saluran & riwayat pengiriman
          </h2>
          <p className={muted}>
            <strong>Email:</strong> saluran utama ringkasan harian (PR-80).{" "}
            <strong>WhatsApp staf:</strong> masih terkunci menunggu templat WABA dan keputusan owner.
          </p>
          <p role="status" className={muted}>
            Belum tersedia — riwayat eksekusi pengiriman harian belum ditampilkan pada halaman web karena diproses oleh antrean worker terpisah.
          </p>
        </section>
      </div>
    </ListPage>
  );
}

export default function LaporanTerjadwalPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
