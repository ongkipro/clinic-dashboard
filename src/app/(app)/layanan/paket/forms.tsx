"use client";
// Templat Paket form (HYG-NAV-2): the owner's family-sharing switch with a required reason; the context and a per-mount key are posted.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { sharingAction, type SharingState } from "./actions";

// The idempotency key is per mount of the keyed form: a completed attempt (n changes) remounts it with a fresh key, a retry of the same
// attempt keeps it (review r1 P1: one outer key made the second change an ERR_IDEMPOTENCY_CONFLICT).
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
export function SharingForm({ ctx, item, enabled, name }: { ctx: RenderedContext; item: string; enabled: boolean; name: string }) {
  const [s, act, pending] = useActionState<SharingState, FormData>(sharingAction, {});
  // open since attempt n; a completed successful attempt after that closes the form (its notice stays), so the button always offers the
  // next change and the next open is a fresh form (derived, no effect)
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const open = openedAt !== null && !(s.ok && (s.n ?? 0) > openedAt);
  const setOpen = (on: boolean) => setOpenedAt(on ? (s.n ?? 0) : null);
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <Button type="button" variant="plain" aria-expanded={open} onClick={() => setOpen(!open)} className="justify-self-start">
        {enabled ? "Matikan Berbagi Keluarga" : "Izinkan Berbagi Keluarga"}
      </Button>
      {open && (
        <form action={act} key={`s${s.n ?? 0}`} aria-label={`Berbagi keluarga ${name}`} className="grid min-w-0 gap-2">
          <ContextFields ctx={ctx} /><Key /><input type="hidden" name="item" value={item} />
          <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
          <label htmlFor={id} className="grid gap-1"><span>Alasan</span><input id={id} name="reason" required minLength={3} maxLength={500} className={input} /></label>
          <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Simpan</Button>
        </form>
      )}
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </div>
  );
}
