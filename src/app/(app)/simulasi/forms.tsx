"use client";
// Simulasi Pembayaran forms (UX-56; T-073): Aktifkan Port Simulasi; per charge Lunas (prominent) · Kedaluwarsa · Gagal ·
// Kirim Ulang Webhook. Every form posts its rendered context and remounts after each answer.
import { useActionState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { enableAction, simulateAction, type SimFormState } from "./actions";

function Notice({ s }: { s: SimFormState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)] [overflow-wrap:anywhere]">{s.ok}</p>}
    </>
  );
}
export function EnableForm({ ctx }: { ctx: RenderedContext }) {
  const [s, act, pending] = useActionState<SimFormState, FormData>(enableAction, {});
  return (
    <form action={act} key={`e${s.n ?? 0}`} aria-label="Aktifkan port simulasi" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} />
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Aktifkan Port Simulasi</Button>
    </form>
  );
}
const LABEL = { paid: "Lunas", expired: "Kedaluwarsa", failed: "Gagal", resend: "Kirim Ulang Webhook" } as const;
export function SimActions({ ctx, charge, open, sent, label }: { ctx: RenderedContext; charge: string; open: boolean; sent: boolean; label: string }) {
  const [s, act, pending] = useActionState<SimFormState, FormData>(simulateAction, {});
  const actions = [...(open ? (["paid", "expired", "failed"] as const) : []), ...(sent ? (["resend"] as const) : [])];
  if (!actions.length) return <Notice s={s} />;
  return (
    <div className="grid min-w-0 gap-2">
      <div role="group" aria-label={`Simulasi ${label}`} className="flex min-w-0 flex-wrap gap-2">
        {actions.map((a) => (
          <form key={`${a}${s.n ?? 0}`} action={act}>
            <ContextFields ctx={ctx} /><input type="hidden" name="charge" value={charge} /><input type="hidden" name="action" value={a} />
            <Button type="submit" variant={a === "paid" ? "default" : "secondary"} aria-disabled={pending}>{LABEL[a]}</Button>
          </form>
        ))}
      </div>
      <Notice s={s} />
    </div>
  );
}
