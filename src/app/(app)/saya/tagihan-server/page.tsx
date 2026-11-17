// Saya › Tagihan Server (UX-49, 17 :88, 19 :185, 07 :67; T-103 increment 2): the vendor's monthly server-fee invoices of this clinic, what is
// still payable, credits applied, and Bayar (owner, finance) — QRIS / VA through the vendor's AutoLaris account. Admin Pusat and the auditor
// read. Payment is available only where the port exists (local mock; no live adapter yet) and the vendor decided the channel-fee bearer
// (Q-16); otherwise the page says "Pembayaran belum tersedia". An invoice is marked paid only from a confirmed AutoLaris settlement (Q-13).
// States: loading, empty, error, success (?ok=), blocked, permission.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { channels } from "../../../../modules/vendor/billing/billing";
import { billingPort } from "../../../../modules/vendor/billing/server-port";
import { loadTagihanServer } from "./data";
import { BayarForm } from "./forms";
import { ATTEMPT, CHANNEL, CREDIT, day, INVOICE, period, rupiah, when } from "./labels";
import { QrisCode } from "./qris";

export const metadata: Metadata = { title: "Tagihan Server — Clinic Dashboard" };
const TITLE = "Tagihan Server";
const panel = "grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const card = "grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
type SP = Record<string, string | string[] | undefined>;
const DONE: Record<string, string> = {
  dibuat: "Instruksi pembayaran dibuat. Selesaikan pembayaran sebelum batas waktu.",
  menunggu: "Pembayaran sedang menunggu kepastian dari AutoLaris. Statusnya diperbarui otomatis.",
  gagal: "AutoLaris menolak pembuatan pembayaran. Coba metode lain.",
};

async function Content({ sp }: { sp: SP }) {
  const r = await loadTagihanServer();
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "tagihan server" }} />;
  const d = r.d;
  const done = typeof sp.ok === "string" && Object.hasOwn(DONE, sp.ok) ? DONE[sp.ok] : undefined;
  if (d.invoices.length === 0) {
    return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Belum ada tagihan server. Tagihan pertama terbit pada hari klinik mulai beroperasi." }} />;
  }
  const payable = d.can_pay && d.portAvailable && d.payment_available;
  const port = payable ? billingPort() : null;
  const offered = port ? (await channels(port)).map((c) => ({ code: c.channel_code, fee: c.tipe_admin === "persen" ? `${c.admin}%` : rupiah(Number(c.admin) || 0) })) : [];
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      {done && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{done}</p>}
      {d.can_pay && !(d.portAvailable && d.payment_available) && (
        <div role="status" className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--warning-soft)] p-3 text-[var(--warning)]">
          <p className="m-0 font-semibold">Pembayaran belum tersedia.</p>
          <p className="m-0 [overflow-wrap:anywhere]">Tagihan tetap tercatat. Vendor akan memberi tahu bila pembayaran QRIS/VA sudah bisa dipakai.</p>
        </div>
      )}
      <p className={muted}>Tagihan dianggap lunas setelah AutoLaris mengonfirmasi pembayaran. Nomor tagihan bukan faktur pajak.</p>
      {d.credit_balance > 0 && <p className="m-0">{`Saldo kredit dari vendor: ${rupiah(d.credit_balance)} (dipotong otomatis pada tagihan berikutnya).`}</p>}
      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Daftar tagihan server">
        {d.invoices.map((i) => {
          const st = INVOICE[i.state] ?? INVOICE.issued;
          const open = i.attempts.find((a) => ["creating", "pending", "unknown"].includes(a.state));
          return (
            <li key={i.id} className={panel}>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 text-[1.25rem] font-semibold [overflow-wrap:anywhere]">{`${period(i.period)} · ${i.number}`}</h2>
                <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
              </div>
              <dl className="m-0 grid min-w-0 gap-x-4 gap-y-1 min-[1180px]:grid-cols-2">
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>Terbit</dt><dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{day(i.issue_date)}</dd></div>
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>Jatuh tempo</dt><dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{day(i.due_date)}</dd></div>
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>Masa layanan</dt><dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{`${day(i.service_from)} – ${day(i.service_to)}`}</dd></div>
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>Biaya bulanan</dt><dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{rupiah(i.fee_amount)}</dd></div>
                {i.kind === "first" && (
                  <div className="flex min-w-0 flex-wrap justify-between gap-x-3 min-[700px]:col-span-2"><dt>Prorata bulan pertama</dt>
                    <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{`${i.proration.days} dari ${i.proration.days_in_month} hari`}</dd></div>
                )}
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>Jumlah</dt><dd className="m-0 min-w-0 tabular-nums [overflow-wrap:anywhere]">{rupiah(i.amount)}</dd></div>
                {i.vat > 0 && <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>PPN</dt><dd className="m-0 min-w-0 tabular-nums [overflow-wrap:anywhere]">{rupiah(i.vat)}</dd></div>}
                {i.credits.map((cr, k) => (
                  <div key={k} className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>{CREDIT[cr.kind] ?? cr.kind}</dt><dd className="m-0 min-w-0 tabular-nums [overflow-wrap:anywhere]">{`− ${rupiah(cr.amount)}`}</dd></div>
                ))}
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3 font-semibold"><dt>Sisa tagihan</dt><dd className="m-0 min-w-0 tabular-nums [overflow-wrap:anywhere]">{rupiah(i.outstanding)}</dd></div>
              </dl>
              {i.attempts.length > 0 && (
                <ul className="m-0 grid list-none gap-2 p-0" aria-label={`Pembayaran ${i.number}`}>
                  {i.attempts.map((a) => (
                    <li key={a.id} className={card}>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{`${CHANNEL[a.channel] ?? a.channel} · ${a.reff_id}`}</span>
                        <span className={muted}>{ATTEMPT[a.state] ?? a.state}</span>
                      </div>
                      {a.state === "pending" && a.instruction && (
                        <div className="grid min-w-0 gap-1">
                          {a.instruction.virtual_account && <p className="m-0 [overflow-wrap:anywhere]">{`Nomor VA: ${a.instruction.virtual_account}`}</p>}
                          {a.instruction.payment_code && <p className="m-0 [overflow-wrap:anywhere]">{`Kode bayar: ${a.instruction.payment_code}`}</p>}
                          {a.instruction.qr && <QrisCode payload={a.instruction.qr} label={`Kode QRIS untuk ${i.number}`} />}
                          {a.instruction.url && /^https:\/\//.test(a.instruction.url) && <a href={a.instruction.url} rel="noopener noreferrer" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Buka halaman pembayaran</a>}
                          <p className={muted}>{`Total dibayar ${rupiah(a.total ?? a.amount)} (termasuk biaya channel ${rupiah(a.admin ?? 0)}) · bayar sebelum ${when(a.expires_at)}`}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {i.payments.length > 0 && (
                <section aria-label={`Bukti pembayaran ${i.number}`} className={card}>
                  <p className="m-0 font-semibold">Bukti Pembayaran</p>
                  {i.payments.map((p, k) => (
                    <p key={k} className="m-0 [overflow-wrap:anywhere]">{`${when(p.settled_at)} · ${rupiah(p.amount)} · ${CHANNEL[p.channel] ?? p.channel} · ${p.reff_id}`}</p>
                  ))}
                  <p className={muted}>Dikonfirmasi oleh AutoLaris. Bukti ini bukan faktur pajak.</p>
                </section>
              )}
              {i.state === "issued" && i.outstanding > 0 && payable && !open && (
                <BayarForm ctx={d.ctx} invoice={i.id} number={i.number} channels={offered} />
              )}
              {i.state === "issued" && open && open.state === "unknown" && <p className={muted}>Pembayaran sebelumnya menunggu kepastian dari AutoLaris; pembayaran baru belum bisa dibuat.</p>}
            </li>
          );
        })}
      </ul>
    </ListPage>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<ListPage as="section" title={TITLE} state={{ kind: "loading" }}><LoadingList /></ListPage>}>
        <Content sp={sp} />
      </Suspense>
    </main>
  );
}
