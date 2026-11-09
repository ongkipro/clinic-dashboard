"use client";
// Profil Pasien forms (UX-29, PR-49, T-040): Catat Persetujuan (the current text is shown before it is
// recorded) and Tarik Persetujuan (channel and reason). Every write form posts its rendered context
// (HYG-009 B2-1) and a per-mount idempotency key (a retry replays; a remount after an answer gets a new key).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { type ConsentState, grantAction, withdrawAction } from "./actions";
import type { Texts } from "./data";
import { CHANNEL, PURPOSE } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hintCls = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: ConsentState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      {children(id)}
    </div>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Channel({ value }: { value?: string }) {
  return (
    <Field label="Saluran">
      {(id) => (
        <select id={id} className={input} name="channel" defaultValue={value ?? "in_person"}>
          {Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
    </Field>
  );
}

// Catat Persetujuan: the purposes not active now; the text in force is shown and posted with the grant.
export function GrantConsent({ ctx, patient, texts, active }: { ctx: RenderedContext; patient: string; texts: Texts; active: string[] }) {
  const [s, act, pending] = useActionState<ConsentState, FormData>(grantAction, {});
  const open = Object.keys(PURPOSE).filter((p) => !active.includes(p));
  const [picked, setPurpose] = useState(s.values?.purpose ?? open[0] ?? "");
  if (open.length === 0) return <><p className={hintCls}>Semua jenis persetujuan sudah aktif.</p><Notice s={s} /></>;
  // A purpose just recorded leaves the list: fall back to the first open one, so the text shown is
  // always the selected purpose's (found in the browser check).
  const purpose = open.includes(picked) ? picked : open[0];
  const text = texts[purpose] ?? null;
  return (
    <form action={act} key={`g${s.n ?? 0}`} aria-label="Catat persetujuan" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
      <ContextFields ctx={ctx} /><Key />
      <input type="hidden" name="patient" value={patient} />
      <input type="hidden" name="text" value={text?.id ?? ""} />
      <Field label="Jenis persetujuan">
        {(id) => (
          <select id={id} className={input} name="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {open.map((p) => <option key={p} value={p}>{PURPOSE[p]}</option>)}
          </select>
        )}
      </Field>
      {text ? (
        <figure className="m-0 grid min-w-0 gap-1">
          <figcaption className={hintCls}>Teks yang ditunjukkan ke pasien (versi {text.version})</figcaption>
          <blockquote className="m-0 whitespace-pre-wrap rounded-[var(--radius-field)] bg-[var(--surface-2)] p-3 [overflow-wrap:anywhere]">{text.body}</blockquote>
        </figure>
      ) : (
        <p className={hintCls}>Teks persetujuan ini belum diterbitkan. Owner menerbitkannya di Privasi.</p>
      )}
      <Channel value={s.values?.channel} />
      <Notice s={s} />
      <div><Button type="submit" aria-disabled={pending || !text} disabled={!text}>Catat Persetujuan</Button></div>
    </form>
  );
}

// Tarik Persetujuan for one active row (never the care notice; the database refuses it too).
export function WithdrawConsent({ ctx, patient, consent, label }: { ctx: RenderedContext; patient: string; consent: string; label: string }) {
  const [s, act, pending] = useActionState<ConsentState, FormData>(withdrawAction, {});
  const [open, setOpen] = useState(false);
  return (
    <div className="grid min-w-0 gap-2">
      {!open && <div><Button type="button" variant="plain" aria-expanded={false} onClick={() => setOpen(true)}>Tarik Persetujuan</Button></div>}
      {!open && <Notice s={s} />}
      {open && (
        <form action={act} key={`w${s.n ?? 0}`} aria-label={`Tarik persetujuan ${label}`} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
          <ContextFields ctx={ctx} /><Key />
          <input type="hidden" name="patient" value={patient} />
          <input type="hidden" name="consent" value={consent} />
          <Channel value={s.values?.channel} />
          <Field label="Alasan penarikan">{(id) => <input id={id} className={input} name="reason" defaultValue={s.values?.reason ?? ""} />}</Field>
          <Notice s={s} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" aria-disabled={pending}>Tarik Persetujuan</Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Batal</Button>
          </div>
        </form>
      )}
    </div>
  );
}
