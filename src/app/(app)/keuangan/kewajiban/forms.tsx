"use client";
// PPN facts (owner D-A1; T-104): Catat PPN Masukan and Catat Setoran PPN, finance only. Each posts its rendered context (HYG-009 B2-1) and a
// fresh idempotency key (remounted after every answer: n). A negative amount is a correction and needs a reason.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { inputCreditAction, vatPaidAction, type VatState } from "./actions";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}

export function VatFactForm({ ctx, kind, period, today }: { ctx: RenderedContext; kind: "input" | "paid"; period: string; today: string }) {
  const [s, act, pending] = useActionState<VatState, FormData>(kind === "input" ? inputCreditAction : vatPaidAction, {});
  const [open, setOpen] = useState(false);
  const v = s.values ?? {};
  const [amount, setAmount] = useState(v.amount ?? "");
  const id = useId();
  const label = kind === "input" ? "Catat PPN Masukan" : "Catat Setoran PPN";
  if (!open && !s.error) {
    return (
      <div className="grid min-w-0 gap-1">
        {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
        <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="justify-self-start">{label}</Button>
      </div>
    );
  }
  const negative = /^\s*-/.test(amount);
  return (
    <section aria-label={label} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 min-w-0 text-[1.1rem] font-semibold">{label}</h3>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
      <form action={act} key={`f${s.n ?? 0}`} aria-label={label} className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2">
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-p`}>Masa pajak</label>
            <input id={`${id}-p`} name="period" type="month" defaultValue={v.period ?? period} max={today.slice(0, 7)} required className={input} /></div>
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-d`}>{kind === "input" ? "Tanggal dikreditkan" : "Tanggal setor"}</label>
            <input id={`${id}-d`} name="date" type="date" defaultValue={v.date ?? today} max={today} required className={input} /></div>
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-a`}>Jumlah (Rp)</label>
            <input id={`${id}-a`} name="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} required aria-describedby={`${id}-a-h`} className={input} />
            <p id={`${id}-a-h`} className={hint}>Isi angka negatif untuk mengoreksi catatan sebelumnya.</p></div>
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-r`}>{kind === "input" ? "Referensi faktur masukan / SPT" : "NTPN"}</label>
            <input id={`${id}-r`} name="reference" maxLength={kind === "input" ? 80 : 40} defaultValue={v.reference ?? ""} required className={input} /></div>
        </div>
        {negative && (
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-x`}>Alasan koreksi</label>
            <textarea id={`${id}-x`} name="reason" rows={2} minLength={10} maxLength={500} defaultValue={v.reason ?? ""} required className={`${input} py-2`} /></div>
        )}
        {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
        {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan</Button>
      </form>
    </section>
  );
}
