"use client";
// An Owner grant waiting for this person (DEC-031 D7): who granted it and when, with
// Terima (prominent) and Tolak. The role exists only after Terima.
import { useActionState } from "react";
import { Button } from "../../../components/ui/button";
import { answerOwnerGrantAction, type OwnerGrantState } from "../../../modules/org/roles/actions";

export function OwnerGrant({ id, grantedBy, at }: { id: string; grantedBy: string; at: string }) {
  const [state, action, pending] = useActionState<OwnerGrantState, FormData>(answerOwnerGrantAction, {});
  if (state.ok) {
    return (
      <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
        {state.ok}
      </p>
    );
  }
  return (
    <form action={action} className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4" aria-label="Penunjukan Owner">
      <input type="hidden" name="id" value={id} />
      <p className="m-0">
        <span className="font-semibold [overflow-wrap:anywhere]">{grantedBy}</span> menunjuk Anda sebagai <span className="font-semibold">Owner</span> pada {at}.
      </p>
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">Owner bisa melihat dan mengatur seluruh klinik. Peran ini aktif setelah Anda menerimanya.</p>
      {state.error && (
        <p role="alert" className="m-0 text-[var(--danger)]">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="answer" value="terima" aria-disabled={pending}>
          Terima Peran Owner
        </Button>
        <Button type="submit" name="answer" value="tolak" variant="plain" aria-disabled={pending}>
          Tolak
        </Button>
      </div>
    </form>
  );
}
