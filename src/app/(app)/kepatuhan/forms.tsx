"use client";
// Unggah Bukti and the decision on the newest file (UX-58). Tandai Disetujui is the one
// prominent action; Tolak and Cabut ask for a reason first.
import { ContextFields } from "../../../components/context-fields";
import type { RenderedContext } from "../../../modules/org/context/context";
import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/button";
import { decideAction, type EvidenceState, uploadAction } from "./actions";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";

function Message({ state }: { state: EvidenceState }) {
  if (state.error) return <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>;
  if (state.ok) return <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{state.ok}</p>;
  return null;
}

export function UploadForm({ obligationKey, ctx }: { obligationKey: string; ctx: RenderedContext }) {
  const [state, action, pending] = useActionState<EvidenceState, FormData>(uploadAction, {});
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Unggah Bukti</Button>;
  return (
    <form action={action} className="grid min-w-0 gap-4">
      <input type="hidden" name="key" value={obligationKey} />
      <ContextFields ctx={ctx} />
      <label className="grid min-w-0 gap-1">
        <span className="font-semibold">Berkas (PDF, PNG atau JPEG, maks. 5 MB)</span>
        <input className={`${input} py-2`} type="file" name="file" accept="application/pdf,image/png,image/jpeg" required />
      </label>
      <label className="grid min-w-0 gap-1">
        <span className="font-semibold">Disusun oleh</span>
        <input className={input} name="expert" required minLength={2} maxLength={120} placeholder="Nama konsultan, akuntan atau penasihat" />
      </label>
      <label className="grid min-w-0 gap-1">
        <span className="font-semibold">Tanggal dokumen</span>
        <input className={input} type="date" name="date" required />
      </label>
      <Message state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Mengunggah…" : "Unggah"}</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Batal</Button>
      </div>
    </form>
  );
}

export function DecideForm({ obligationKey, itemId, fileId, approved, ctx }: { obligationKey: string; itemId: string; fileId: string; approved: boolean; ctx: RenderedContext }) {
  const [state, action, pending] = useActionState<EvidenceState, FormData>(decideAction, {});
  const [mode, setMode] = useState<"none" | "rejected" | "revoked">("none");
  return (
    <form action={action} className="grid min-w-0 gap-3">
      <input type="hidden" name="key" value={obligationKey} />
      <ContextFields ctx={ctx} />
      <input type="hidden" name="item" value={itemId} />
      <input type="hidden" name="file" value={fileId} />
      {mode !== "none" && (
        <label className="grid min-w-0 gap-1">
          <span className="font-semibold">{mode === "rejected" ? "Alasan penolakan" : "Alasan pencabutan"}</span>
          <textarea name="reason" required minLength={3} maxLength={500} rows={3} className="w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3 py-2" />
        </label>
      )}
      {mode === "none" && !approved && (
        <label className="grid min-w-0 gap-1">
          <span className="font-semibold">Berlaku sampai (opsional)</span>
          <input className={input} type="date" name="valid" aria-describedby={`${itemId}-valid`} />
          <span id={`${itemId}-valid`} className="text-[0.88rem] text-[var(--label-2)]">Kosongkan untuk masa berlaku bawaan kewajiban ini.</span>
        </label>
      )}
      <Message state={state} />
      <div className="flex flex-wrap gap-2">
        {mode === "none" ? (
          approved ? (
            <Button type="button" variant="destructive" onClick={() => setMode("revoked")}>Cabut Persetujuan</Button>
          ) : (
            <>
              <Button type="submit" name="decision" value="approved" disabled={pending}>{pending ? "Menyimpan…" : "Tandai Disetujui"}</Button>
              <Button type="button" variant="plain" onClick={() => setMode("rejected")}>Tolak</Button>
            </>
          )
        ) : (
          <>
            <Button type="submit" name="decision" value={mode} variant="destructive" disabled={pending}>{mode === "rejected" ? "Tolak" : "Cabut"}</Button>
            <Button type="button" variant="plain" onClick={() => setMode("none")}>Batal</Button>
          </>
        )}
      </div>
    </form>
  );
}
