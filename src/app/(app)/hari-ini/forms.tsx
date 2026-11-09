"use client";
// Hari Ini forms (UX-6, PR-7, T-047): Pasien Datang (enabled from two hours before the appointment) and
// Tutup Kunjungan (disabled with the blocker named). Every write form posts its rendered context
// (HYG-009 B2-1) and a per-mount idempotency key (a retry replays; a remount after an answer gets a new key).
import { useActionState, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { checkInAction, closeVisitAction, type VisitState } from "./actions";

const hintCls = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: VisitState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}

export function CheckIn({ ctx, id, label, ready, from }: { ctx: RenderedContext; id: string; label: string; ready: boolean; from: string }) {
  const [s, act, pending] = useActionState<VisitState, FormData>(checkInAction, {});
  return (
    <div className="grid min-w-0 gap-1">
      <form action={act} key={`d${s.n ?? 0}`} aria-label={`Pasien datang ${label}`}>
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="id" value={id} />
        <Button type="submit" variant="secondary" disabled={!ready} aria-disabled={pending || !ready}>Pasien Datang</Button>
      </form>
      {!ready && <p className={hintCls}>Tersedia mulai {from}.</p>}
      <Notice s={s} />
    </div>
  );
}

export function CloseVisit({ ctx, id, label, blocker }: { ctx: RenderedContext; id: string; label: string; blocker: string | null }) {
  const [s, act, pending] = useActionState<VisitState, FormData>(closeVisitAction, {});
  return (
    <div className="grid min-w-0 gap-1">
      <form action={act} key={`t${s.n ?? 0}`} aria-label={`Tutup kunjungan ${label}`}>
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="id" value={id} />
        <Button type="submit" variant="plain" disabled={blocker !== null} aria-disabled={pending || blocker !== null}
          aria-label={blocker ? `Tutup Kunjungan (belum bisa: ${blocker.toLowerCase()})` : undefined}>Tutup Kunjungan</Button>
      </form>
      <Notice s={s} />
    </div>
  );
}
