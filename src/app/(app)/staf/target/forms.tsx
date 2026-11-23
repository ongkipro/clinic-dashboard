"use client";
// Tetapkan Target (owner only; HYG-NAV-1). Posts the rendered context (HYG-009 B2-1) and a fresh idempotency key (remounted after
// every answer: n). The database decides authority (staff_target_set: owner only).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { setTargetAction, type TargetState } from "./actions";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";

function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}

export function SetTargetForm({ ctx, staffId, staffName, period, current }: { ctx: RenderedContext; staffId: string; staffName: string; period: string; current: { closing: number; plans: number | null } | null }) {
  const [s, act, pending] = useActionState<TargetState, FormData>(setTargetAction, {});
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!open && !s.error) {
    return (
      <div className="grid gap-1">
        {s.ok && <p role="status" className="m-0 text-[0.88rem] text-[var(--success)]">{s.ok}</p>}
        <Button type="button" variant="plain" onClick={() => setOpen(true)} className="justify-self-start">{current ? "Ubah Target" : "Tetapkan Target"}<span className="sr-only">{` untuk ${staffName}`}</span></Button>
      </div>
    );
  }
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label={`Target ${staffName}`} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key />
      <input type="hidden" name="staff" value={staffId} />
      <input type="hidden" name="period" value={period} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2">
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-c`}>Target nilai closing (Rp)</label>
          <input id={`${id}-c`} name="closing" inputMode="numeric" required defaultValue={current?.closing ?? ""} className={input} />
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-p`}>Target rencana terpilih (opsional)</label>
          <input id={`${id}-p`} name="plans" inputMode="numeric" defaultValue={current?.plans ?? ""} className={input} />
        </div>
      </div>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>Simpan Target</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Batal</Button>
      </div>
    </form>
  );
}
