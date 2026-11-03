"use client";
// Setujui / Tolak in the Persetujuan detail (UX-26): Setujui is the one prominent action;
// Tolak opens a reason field first (a rejection needs a reason).
import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/button";
import { decideAction, type DecideState } from "./actions";

export function DecideForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<DecideState, FormData>(decideAction, {});
  const [rejecting, setRejecting] = useState(Boolean(state.reason));
  // The decision buttons are disabled while one is in flight: a second click would only
  // come back as "sudah diputuskan" over the real result.

  if (state.ok) {
    return <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{state.ok}</p>;
  }
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      {rejecting && (
        <label className="grid min-w-0 gap-1.5">
          <span className="font-semibold">Alasan penolakan</span>
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={3}
            defaultValue={state.reason}
            className="w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3 py-2"
          />
        </label>
      )}
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <Button type="submit" name="decision" value="reject" variant="destructive" disabled={pending}>
              {pending ? "Menyimpan…" : "Tolak"}
            </Button>
            <Button type="button" variant="plain" onClick={() => setRejecting(false)}>Batal</Button>
          </>
        ) : (
          <>
            <Button type="submit" name="decision" value="approve" size="lg" disabled={pending}>
              {pending ? "Menyimpan…" : "Setujui"}
            </Button>
            <Button type="button" variant="plain" onClick={() => setRejecting(true)}>Tolak</Button>
          </>
        )}
      </div>
    </form>
  );
}
