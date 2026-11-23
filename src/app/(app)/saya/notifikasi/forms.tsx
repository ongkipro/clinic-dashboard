"use client";
// Tandai Selesai (HYG-NAV-1): one plain button per row (the prominent action stays reserved). Posts the rendered context.
import { useActionState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { type AckState, ackAction } from "./actions";

export function AckForm({ ctx, id, label }: { ctx: RenderedContext; id: string; label: string }) {
  const [s, act, pending] = useActionState<AckState, FormData>(ackAction, {});
  return (
    <form action={act} key={`a${s.n ?? 0}`} className="grid gap-1">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="plain" disabled={pending} className="justify-self-start">Tandai Selesai<span className="sr-only">{`: ${label}`}</span></Button>
      {s.error && <p role="alert" className="m-0 text-[0.88rem] text-[var(--danger)]">{s.error}</p>}
    </form>
  );
}
