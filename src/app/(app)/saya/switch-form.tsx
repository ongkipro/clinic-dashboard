"use client";
// One choice list for Ganti Cabang / Ganti Peran / Ganti Klinik (PR-84): each option is
// a full-width 44 px row submitting the switch action; the current one is marked.
import { ContextFields } from "../../../components/context-fields";
import type { RenderedContext } from "../../../modules/org/context/context";
import { Check } from "lucide-react";
import { useActionState } from "react";
import { type SwitchState, switchAction } from "../../../modules/org/context/actions";

export type SwitchOption = { value: string; label: string; detail?: string; current: boolean };

export function SwitchForm({ kind, label, options, ctx }: { kind: "clinic" | "role" | "branch"; label: string; options: SwitchOption[]; ctx: RenderedContext }) {
  const [state, action, pending] = useActionState<SwitchState, FormData>(switchAction, {});
  return (
    <form action={action} aria-label={label} className="grid gap-3">
      <input type="hidden" name="kind" value={kind} />
      <ContextFields ctx={ctx} />
      <ul className="m-0 grid list-none overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
        {options.map((o) => (
          <li key={o.value} className="border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px]">
            <button
              type="submit"
              name="value"
              value={o.value}
              disabled={pending || o.current}
              aria-current={o.current ? "true" : undefined}
              className="flex min-h-[var(--target)] w-full items-center gap-3 border-0 bg-transparent px-4 py-[11px] text-left text-[var(--label)] hover:bg-[var(--surface-2)] disabled:hover:bg-transparent"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className={o.current ? "font-semibold [overflow-wrap:anywhere]" : "[overflow-wrap:anywhere]"}>{o.label}</span>
                {o.detail && <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{o.detail}</span>}
              </span>
              {o.current && (
                <>
                  <Check aria-hidden="true" className="size-5 shrink-0 text-[var(--tint)]" />
                  <span className="sr-only">(aktif)</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      {state.error && (
        <p role="alert" className="m-0 text-[var(--danger)]">
          {state.error}
        </p>
      )}
    </form>
  );
}
