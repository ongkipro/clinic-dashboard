"use client";
// Saya › Tagihan Server forms (UX-49; T-103): Bayar posts its rendered context and a fresh idempotency key (remounted after every answer).
// The channel list comes from the server (the provider's list at render); the database re-validates it against the runtime list.
import { useActionState, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { type BayarState, bayarAction } from "./actions";
import { CHANNEL } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";

function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}

export function BayarForm({ ctx, invoice, number, channels }: { ctx: RenderedContext; invoice: string; number: string; channels: { code: string; fee: string }[] }) {
  const [s, act, pending] = useActionState<BayarState, FormData>(bayarAction, {});
  return (
    <form action={act} key={`b${invoice}${s.n ?? 0}`} aria-label={`Bayar tagihan ${number}`} className="grid min-w-0 gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-end">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="invoice" value={invoice} />
      <label className="grid gap-1">Metode bayar
        <select name="channel" required defaultValue="" className={input}>
          <option value="" disabled>Pilih metode</option>
          {channels.map((c) => <option key={c.code} value={c.code}>{`${CHANNEL[c.code] ?? c.code} · biaya ${c.fee}`}</option>)}
        </select>
      </label>
      <Button type="submit" aria-disabled={pending}>Bayar</Button>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] min-[700px]:col-span-2 [overflow-wrap:anywhere]">{s.error}</p>}
    </form>
  );
}
