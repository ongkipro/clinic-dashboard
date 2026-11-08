"use client";
// Harga Cabang forms (UX-25, PR-42, T-035): the Owner's price form (branch, a price or "kembali ke
// harga normal", the date it applies from in the branch's timezone, reason) and Batalkan for a
// scheduled change. The database decides; the form only collects the input.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { cancelPriceAction, type HargaState, setPriceAction } from "./actions";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hintCls = "text-[0.88rem] text-[var(--label-2)]";

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string, hintId?: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      {children(id, hint ? `${id}-h` : undefined)}
      {hint && <span id={`${id}-h`} className={hintCls}>{hint}</span>}
    </div>
  );
}

type Props = { ctx: RenderedContext; itemId: string; branches: { id: string; name: string; timezone: string }[]; today: Record<string, string> };

// React resets a form after its action runs, which put a controlled <select> back to its first option
// in the DOM while the component state kept the chosen branch (the next submit posted the wrong branch;
// T-035 browser run 2). The fields therefore live in a child remounted after every submission, from the
// values the action returned, so what is shown is what is posted.
export function PriceForm(props: Props) {
  const [state, action, pending] = useActionState<HargaState & { n: number }, FormData>(
    async (prev, f) => ({ ...(await setPriceAction(prev, f)), n: prev.n + 1 }),
    { n: 0 },
  );
  return <PriceFields key={state.n} {...props} state={state} action={action} pending={pending} />;
}

function PriceFields({ ctx, itemId, branches, today, state, action, pending }: Props & { state: HargaState; action: (f: FormData) => void; pending: boolean }) {
  const v = state.values ?? {};
  const [branch, setBranch] = useState(v.branch ?? branches[0]?.id ?? "");
  const [mode, setMode] = useState(v.mode ?? "price");
  return (
    <form action={action} className="grid min-w-0 gap-3" aria-label="Atur harga cabang">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="item" value={itemId} />
      <Field label="Cabang">
        {(id) => (
          <select id={id} className={input} name="branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </Field>
      <fieldset className="grid min-w-0 gap-1 border-0 p-0">
        <legend className="font-semibold">Harga</legend>
        <label className="flex min-h-[var(--target)] items-center gap-3">
          <input type="radio" name="mode" value="price" className="size-5" checked={mode === "price"} onChange={() => setMode("price")} />
          Harga khusus cabang
        </label>
        <label className="flex min-h-[var(--target)] items-center gap-3">
          <input type="radio" name="mode" value="normal" className="size-5" checked={mode === "normal"} onChange={() => setMode("normal")} />
          Kembali ke harga normal
        </label>
      </fieldset>
      {mode === "price" && (
        <Field label="Harga cabang (Rp)" hint="Minimal Rp1. Harga gratis hanya lewat diskon atau pembebasan.">
          {(id, h) => <input id={id} aria-describedby={h} className={input} name="price" inputMode="numeric" defaultValue={v.price ?? ""} />}
        </Field>
      )}
      <Field label="Berlaku mulai" hint={`Tanggal di zona waktu cabang (${branches.find((b) => b.id === branch)?.timezone.replace("Asia/", "") ?? ""}). Hari ini berarti langsung berlaku.`}>
        {(id, h) => <input id={id} aria-describedby={h} className={input} type="date" name="from" min={today[branch]} defaultValue={v.from ?? today[branch] ?? ""} key={branch} />}
      </Field>
      <Field label="Alasan">
        {(id) => <input id={id} className={input} name="reason" defaultValue={v.reason ?? ""} />}
      </Field>
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      {state.ok && <p role="status" className="m-0 text-[var(--success)]">{state.ok}</p>}
      <div><Button type="submit" aria-disabled={pending}>Simpan Harga</Button></div>
    </form>
  );
}

export function CancelScheduled({ ctx, itemId, id, label }: { ctx: RenderedContext; itemId: string; id: string; label: string }) {
  const [state, action, pending] = useActionState<HargaState, FormData>(cancelPriceAction, {});
  return (
    <form action={action} className="grid gap-1" aria-label={`Batalkan jadwal ${label}`}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="item" value={itemId} />
      <div><Button type="submit" variant="plain" aria-disabled={pending} aria-label={`Batalkan jadwal ${label}`}>Batalkan</Button></div>
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      {state.ok && <p role="status" className="m-0 text-[var(--success)]">{state.ok}</p>}
    </form>
  );
}
