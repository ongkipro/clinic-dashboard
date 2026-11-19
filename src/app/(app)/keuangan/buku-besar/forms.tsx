"use client";
// Jurnal Manual and Kunci Periode (UX-22 ▸ Buku Besar; T-105), finance only. Each posts its rendered context (HYG-009 B2-1) and a fresh
// idempotency key (remounted after every answer: n).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { type FormState, lockAction, manualAction } from "./actions";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";

function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Result({ s }: { s: FormState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}

export function ManualJournalForm({ ctx, accounts, branches, today }: {
  ctx: RenderedContext; accounts: { key: string; label: string }[]; branches: { id: string; name: string }[]; today: string;
}) {
  const [s, act, pending] = useActionState<FormState, FormData>(manualAction, {});
  const [open, setOpen] = useState(false);
  const id = useId();
  const v = s.values ?? {};
  if (!open && !s.error) {
    return (
      <div className="grid min-w-0 gap-1">
        {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
        <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="justify-self-start">Jurnal Manual</Button>
      </div>
    );
  }
  return (
    <section aria-label="Jurnal Manual" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 min-w-0 text-[1.1rem] font-semibold">Jurnal Manual</h3>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
      <form action={act} key={`m${s.n ?? 0}`} aria-label="Jurnal Manual" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2">
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-d`}>Tanggal</label>
            <input id={`${id}-d`} name="date" type="date" defaultValue={v.date ?? today} max={today} required className={input} /></div>
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-m`}>Keterangan</label>
            <input id={`${id}-m`} name="memo" minLength={10} maxLength={500} defaultValue={v.memo ?? ""} required className={input} /></div>
        </div>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
          <legend className="mb-1 font-semibold">Baris jurnal (debit = kredit)</legend>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-a${i}`}>{`Akun baris ${i + 1}`}</label>
                <select id={`${id}-a${i}`} name={`account${i}`} defaultValue={v[`account${i}`] ?? ""} required={i < 2} className={input}>
                  <option value="">Pilih akun</option>
                  {accounts.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select></div>
              <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-b${i}`}>{`Cabang baris ${i + 1}`}</label>
                <select id={`${id}-b${i}`} name={`branch${i}`} defaultValue={v[`branch${i}`] ?? ""} className={input}>
                  <option value="">Tanpa cabang</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
              <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-dr${i}`}>{`Debit baris ${i + 1}`}</label>
                <input id={`${id}-dr${i}`} name={`debit${i}`} inputMode="numeric" defaultValue={v[`debit${i}`] ?? ""} className={input} /></div>
              <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-cr${i}`}>{`Kredit baris ${i + 1}`}</label>
                <input id={`${id}-cr${i}`} name={`credit${i}`} inputMode="numeric" defaultValue={v[`credit${i}`] ?? ""} className={input} /></div>
            </div>
          ))}
        </fieldset>
        <Result s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Jurnal</Button>
      </form>
    </section>
  );
}

export function LockPeriodForm({ ctx, maxPeriod }: { ctx: RenderedContext; maxPeriod: string }) {
  const [s, act, pending] = useActionState<FormState, FormData>(lockAction, {});
  const id = useId();
  return (
    <form action={act} key={`l${s.n ?? 0}`} aria-label="Kunci Periode" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key />
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-p`}>Bulan yang dikunci</label>
          <input id={`${id}-p`} name="period" type="month" max={maxPeriod} defaultValue={maxPeriod} required className={input} /></div>
        <Button type="submit" variant="secondary" aria-disabled={pending}>Kunci Periode</Button>
      </div>
      <Result s={s} />
    </form>
  );
}
