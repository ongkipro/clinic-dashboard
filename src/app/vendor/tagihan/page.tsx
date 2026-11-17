// Konsol Vendor › Tagihan Server (UX-43, 17 :82 / :271, 19 :266; T-103 increment 2): every billed tenant with its open invoices, outstanding,
// review items and pending billing requests, plus the owner-decision gates (Q-13 settlement mapping, Q-16 fee bearer, BILL-33 tax status).
// Vendor finance, platform owner and vendor auditor (IAM-10). No patient data (PR-60); tenant names are React text only.
import Link from "next/link";
import { redirect } from "next/navigation";
import { billingList } from "../../../modules/vendor/billing/console";
import { consoleGate, vendorPool } from "../_lib/server";
import { ConsoleShell, RefusedScreen } from "../_lib/shell";
import s from "../_lib/console.module.css";
import { rupiah } from "./labels";

export default async function TagihanPage() {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const r = await billingList(await vendorPool(), gate.caller);
  if (!r.ok) return <RefusedScreen reason={r.reason ?? "role_not_held"} />;
  const { tenants, gates } = r.data;
  return (
    <ConsoleShell user={gate.user} current="/vendor/tagihan">
      <div className={s.page}>
        <h1 className={s.title}>Tagihan Server</h1>
        <p className={s.lead}>Biaya server bulanan per klinik, tagihan, pembayaran AutoLaris dan pengajuan perubahan atau pembebasan.</p>
        <section className={s.section} aria-labelledby="keputusan">
          <h2 id="keputusan" className={s.sectionTitle}>Menunggu Keputusan Pemilik</h2>
          <ul className={`${s.cards} ${s.cardsAlways}`}>
            <li className={s.card}>
              <p className={s.cardTitle}>{gates.settlement_confirmed ? "Pemetaan status lunas AutoLaris sudah dikonfirmasi" : "Pemetaan status lunas AutoLaris belum dikonfirmasi (Q-13)"}</p>
              {!gates.settlement_confirmed && <p className={s.boxMuted}>Tidak ada tagihan yang ditandai lunas otomatis. Jawaban Advice yang tampak lunas masuk daftar tinjauan.</p>}
            </li>
            <li className={s.card}>
              <p className={s.cardTitle}>{gates.fee_bearer ? `Penanggung biaya channel: ${gates.fee_bearer === "tenant" ? "klinik" : "vendor"}` : "Penanggung biaya channel belum diputuskan (Q-16)"}</p>
              {!gates.fee_bearer && <p className={s.boxMuted}>Klinik belum bisa membayar lewat QRIS/VA.</p>}
            </li>
            <li className={s.card}>
              <p className={s.cardTitle}>{gates.tax_treatment_set ? "Perlakuan pajak tagihan sudah dikonfirmasi" : "Perlakuan pajak tagihan belum dikonfirmasi (BILL-33)"}</p>
              {!gates.tax_treatment_set && <p className={s.boxMuted}>Tagihan baru tertahan sampai perlakuan pajak dikonfirmasi.</p>}
            </li>
            <li className={s.card}>
              <p className={s.cardTitle}>{gates.vendor_tax_status_set ? "Status pajak vendor sudah dikonfirmasi" : "Status pajak vendor belum dikonfirmasi (BILL-33)"}</p>
              {!gates.vendor_tax_status_set && <p className={s.boxMuted}>Tagihan baru tertahan sampai status PKP / non-PKP vendor dan buktinya lengkap.</p>}
            </li>
          </ul>
        </section>
        {tenants.length === 0 ? (
          <div className={s.box} role="status"><p className={s.boxMuted}>Belum ada klinik yang ditagih.</p></div>
        ) : (
          <section className={s.section} aria-labelledby="klinik">
            <h2 id="klinik" className={s.sectionTitle}>Klinik</h2>
            <div className={s.tableWrap} role="region" aria-label="Tagihan per klinik" tabIndex={0}>
              <table className={s.table}>
                <caption className="sr-only">Tagihan per klinik</caption>
                <thead>
                  <tr>
                    <th scope="col">Klinik</th>
                    <th scope="col" className={s.num}>Tagihan terbuka</th>
                    <th scope="col" className={s.num}>Sisa tagihan</th>
                    <th scope="col" className={s.num}>Tinjauan</th>
                    <th scope="col" className={s.num}>Pengajuan</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id}>
                      <th scope="row"><Link prefetch={false} className={s.cardLink} href={`/vendor/tagihan/${t.id}`}>{t.name ?? "Belum ada nama badan usaha"}</Link></th>
                      <td className={s.num}>{t.issued}</td>
                      <td className={s.num}>{rupiah(t.outstanding)}</td>
                      <td className={s.num}>{t.reviews}</td>
                      <td className={s.num}>{t.pending_requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className={s.cards} aria-label="Tagihan per klinik">
              {tenants.map((t) => (
                <li key={t.id} className={s.card}>
                  <Link prefetch={false} className={s.cardLink} href={`/vendor/tagihan/${t.id}`}>{t.name ?? "Belum ada nama badan usaha"}</Link>
                  <dl className={s.cardMeta}>
                    <dt>Terbuka</dt><dd>{t.issued}</dd><dt>Sisa</dt><dd>{rupiah(t.outstanding)}</dd><dt>Tinjauan</dt><dd>{t.reviews}</dd><dt>Pengajuan</dt><dd>{t.pending_requests}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ConsoleShell>
  );
}
