// Pembelian ▸ Utang (UX-52 ▸ Utang, 17:186, 19:142): money readers at a branch — open invoices with due date,
// outstanding and overdue; Catat Faktur from uninvoiced receipts (purchasing, finance); Bayar (finance); expected
// credits from returns → Catat Nota Kredit; credit notes with their available amount → Terapkan (finance); per
// supplier the balance (open payable and net of unallocated payments).
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadPayables } from "../data";
import { ApplyCreditForm, CreditNoteForm, InvoiceForm, PayForm } from "../forms";
import { BranchChips, card, Main, muted, NotOkState, branchQ, wideRole } from "../frame";
import { canSee, date, INVOICE_STATE, METHOD, qty, rp, SEGMENTS } from "../labels";

export const metadata: Metadata = { title: "Utang Pemasok — Pembelian — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadPayables(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Utang Pemasok" />;
  if (!canSee(d.p.role, "utang") || !d.ov) return <NotOkState d={{ kind: "forbidden" }} title="Utang Pemasok" />;
  const o = d.ov;
  const branch = wideRole(d.p.role) ? d.branch.id : null;
  const open = o.invoices.filter((i) => i.state === "open");
  const totalOpen = open.reduce((s, i) => s + Number(i.outstanding), 0);
  return (
    <>
      <ListPage as="section" title={`Utang Pemasok · ${d.branch.name}`} filters={SEGMENTS(d.p.role, "utang", branchQ(d.p.role, d.branch.id))}
        state={o.invoices.length === 0 && o.uninvoiced.length === 0 && o.expected_credits.length === 0 ? { kind: "empty", message: "Belum ada faktur, penerimaan, atau retur yang perlu dicatat." } : { kind: "rows" }}>
        <div className="grid min-w-0 gap-4">
          <p className="m-0 text-[1.06rem]">{`Belum dibayar: ${rp(totalOpen)} dari ${open.length} faktur`}</p>
          {o.invoices.length > 0 && (
            <section aria-label="Faktur pemasok" className="grid min-w-0 gap-2">
              <h2 className="m-0 text-[1.25rem] font-semibold">Faktur</h2>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {o.invoices.map((i) => (
                  <li key={i.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-semibold [overflow-wrap:anywhere]">{`${i.supplier_name} · ${i.number}`}</span>
                      <StatusBadge tone={i.overdue ? "danger" : INVOICE_STATE[i.state].tone}>{i.overdue ? "Lewat jatuh tempo" : INVOICE_STATE[i.state].label}</StatusBadge>
                    </span>
                    <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                      {[`jatuh tempo ${date(i.due_date)}`, `total ${rp(i.total)}`, Number(i.paid) > 0 && `dibayar ${rp(i.paid)}`, Number(i.credited) > 0 && `kredit ${rp(i.credited)}`,
                        i.state === "open" && `sisa ${rp(i.outstanding)}`].filter(Boolean).join(" · ")}
                    </span>
                    {d.p.can_pay && i.state === "open" && <PayForm ctx={d.ctx} branch={branch} invoice={i.id} supplier={i.supplier_id} outstanding={Number(i.outstanding)} today={o.today} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {o.uninvoiced.length > 0 && (
            <section aria-label="Penerimaan belum difakturkan" className={card}>
              <h2 className="m-0 text-[1.25rem] font-semibold">Belum difakturkan</h2>
              <ul className="m-0 grid gap-1 pl-5">
                {o.uninvoiced.map((u) => <li key={u.receipt_id} className="[overflow-wrap:anywhere]">{`${u.supplier_name} · ${u.item} · ${qty(u.quantity)} ${u.unit} · ${rp(u.grni)}`}</li>)}
              </ul>
            </section>
          )}
          {o.expected_credits.length > 0 && (
            <section aria-label="Nota kredit ditunggu" className={card}>
              <h2 className="m-0 text-[1.25rem] font-semibold">Nota kredit ditunggu</h2>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {o.expected_credits.map((e) => (
                  <li key={e.return_id} className="grid min-w-0 gap-2">
                    <span className="[overflow-wrap:anywhere]">{`${e.supplier_name} · retur ${date(e.created_at)} · ${rp(e.amount)}${e.uncosted ? " (tanpa nilai pokok)" : ""}`}</span>
                    {d.p.can_invoice && <CreditNoteForm ctx={d.ctx} branch={branch} ret={e.return_id} supplier={e.supplier_id} amount={Number(e.amount)} today={o.today} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {o.credit_notes.length > 0 && (
            <section aria-label="Nota kredit" className={card}>
              <h2 className="m-0 text-[1.25rem] font-semibold">Nota kredit</h2>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {o.credit_notes.map((c) => (
                  <li key={c.id} className="grid min-w-0 gap-2">
                    <span className="[overflow-wrap:anywhere]">{`${c.supplier_name} · ${c.number} · ${rp(c.amount)} · tersedia ${rp(c.available)}${c.state === "reversed" ? " · dibatalkan" : ""}`}</span>
                    {d.p.can_pay && c.state === "live" && Number(c.available) > 0 && (
                      <ApplyCreditForm ctx={d.ctx} credit={c.id} invoices={open.filter((i) => i.supplier_id === c.supplier_id).map((i) => ({ id: i.id, label: `${i.number} · sisa ${rp(i.outstanding)}` }))} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {o.payments.length > 0 && (
            <section aria-label="Pembayaran" className={card}>
              <h2 className="m-0 text-[1.25rem] font-semibold">Pembayaran</h2>
              <ul className="m-0 grid gap-1 pl-5">
                {o.payments.map((p) => <li key={p.id} className="[overflow-wrap:anywhere]">{`${date(p.paid_on)} · ${p.supplier_name} · ${METHOD[p.method]} · ${rp(p.amount)}${Number(p.unallocated) > 0 ? ` · belum dialokasikan ${rp(p.unallocated)}` : ""}${p.state === "reversed" ? " · dibatalkan" : ""}`}</li>)}
              </ul>
            </section>
          )}
          {o.balances.length > 0 && (
            <section aria-label="Saldo pemasok" className={card}>
              <h2 className="m-0 text-[1.25rem] font-semibold">Saldo per pemasok</h2>
              <ul className="m-0 grid gap-1 pl-5">
                {o.balances.map((b) => <li key={b.supplier_id} className="[overflow-wrap:anywhere]">{`${b.supplier_name}: utang ${rp(b.open_payable)}${Number(b.unallocated_payments) > 0 ? ` · uang muka ${rp(b.unallocated_payments)}` : ""}${Number(b.available_credits) > 0 ? ` · kredit tersedia ${rp(b.available_credits)}` : ""}`}</li>)}
              </ul>
            </section>
          )}
          <p className={muted}>Faktur, pembayaran, dan nota kredit dibatalkan dengan pembalikan, tidak pernah dihapus.</p>
        </div>
      </ListPage>
      {d.p.can_invoice && o.uninvoiced.length > 0 && (
        <InvoiceForm ctx={d.ctx} branch={branch} suppliers={d.p.suppliers}
          uninvoiced={o.uninvoiced.map((u) => ({ receipt_id: u.receipt_id, supplier_id: u.supplier_id, label: `${date(u.received_at)} · ${u.item} · ${qty(u.quantity)} ${u.unit}`, grni: Number(u.grni) }))}
          today={o.today} />
      )}
      <BranchChips path="/pembelian/utang" branches={d.p.branches} active={d.branch.id} />
    </>
  );
}

export default function UtangPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
