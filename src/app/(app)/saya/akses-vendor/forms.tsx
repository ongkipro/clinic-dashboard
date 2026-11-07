"use client";
// Akses Vendor decisions (UX-48): each form posts the rendered context and shows the database's
// answer. Buttons are rendered for the Owner only; the database decides again.
import { useActionState, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { type AksesState, decideDualIdentityAction, decideScopeAction, endSessionAction } from "./actions";

function Message({ state }: { state: AksesState }) {
  if (state.error) return <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>;
  if (state.ok) return <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{state.ok}</p>;
  return null;
}

export function ScopeDecision({ sessionId, ctx, label }: { sessionId: string; ctx: RenderedContext; label: string }) {
  const [state, action, pending] = useActionState<AksesState, FormData>(decideScopeAction, {});
  return (
    <form action={action} className="grid gap-2" aria-label={`Keputusan akses ${label}`}>
      <input type="hidden" name="session" value={sessionId} />
      <ContextFields ctx={ctx} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" aria-disabled={pending}>Setujui Akses Klinis</Button>
        <Button type="submit" name="decision" value="reject" variant="plain" aria-disabled={pending}>Tolak</Button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function EndSession({ sessionId, ctx, label }: { sessionId: string; ctx: RenderedContext; label: string }) {
  const [state, action, pending] = useActionState<AksesState, FormData>(endSessionAction, {});
  const [confirm, setConfirm] = useState(false);
  return (
    <form action={action} className="grid gap-2" aria-label={`Akhiri sesi ${label}`}>
      <input type="hidden" name="session" value={sessionId} />
      <ContextFields ctx={ctx} />
      {confirm ? (
        <>
          <p className="m-0">Akhiri sesi ini sekarang? Vendor tidak bisa membaca data lagi lewat sesi ini.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="plain" onClick={() => setConfirm(false)}>Batal</Button>
            <Button type="submit" variant="destructive" aria-disabled={pending}>Akhiri Sesi</Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="destructive" onClick={() => setConfirm(true)}>Akhiri Sesi</Button>
      )}
      <Message state={state} />
    </form>
  );
}

export function DualIdentityDecision({ requestId, ctx, label }: { requestId: string; ctx: RenderedContext; label: string }) {
  const [state, action, pending] = useActionState<AksesState, FormData>(decideDualIdentityAction, {});
  return (
    <form action={action} className="grid gap-2" aria-label={`Keputusan identitas ganda ${label}`}>
      <input type="hidden" name="request" value={requestId} />
      <ContextFields ctx={ctx} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" variant="secondary" aria-disabled={pending}>Setujui</Button>
        <Button type="submit" name="decision" value="reject" variant="plain" aria-disabled={pending}>Tolak</Button>
      </div>
      <Message state={state} />
    </form>
  );
}
