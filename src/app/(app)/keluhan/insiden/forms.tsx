"use client";
// Insiden forms (UX-28 ▸ Insiden; T-068): Catat Insiden and the facility head's steps. Every write form posts its
// rendered context (HYG-009 B2-1) and a fresh idempotency key (remounted after every answer: n).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import type { PatientOption } from "../../../../modules/safety/safety";
import { type IncidentFormState, reportAction, stepAction } from "./actions";
import { CLASS_LABEL } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const area = "min-h-[96px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3 py-2";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";
const grid2 = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2";

function Notice({ s }: { s: IncidentFormState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Sheet({ label, prominent, children }: { label: string; prominent?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" variant={prominent ? "default" : "secondary"} onClick={() => setOpen(true)} className="justify-self-start">{label}</Button>;
  return (
    <section aria-label={label} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="m-0 text-[1.25rem] font-semibold">{label}</h2>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
      {children}
    </section>
  );
}
function F({ id, label, children, help }: { id: string; label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <p className={hint}>{help}</p>}
    </div>
  );
}
const nowLocal = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export function ReportForm({ ctx, branch, patients }: { ctx: RenderedContext; branch: string; patients: PatientOption[] }) {
  const [s, act, pending] = useActionState<IncidentFormState, FormData>(reportAction, {});
  const id = useId();
  const [now] = useState(nowLocal);
  const [offset] = useState(() => String(new Date().getTimezoneOffset()));
  return (
    <Sheet label="Catat Insiden" prominent>
      <form action={act} key={`r${s.n ?? 0}`} aria-label="Catat insiden" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="branch" value={branch} /><input type="hidden" name="tz_offset" value={offset} />
        <div className={grid2}>
          <F id={`${id}-c`} label="Jenis insiden">
            <select id={`${id}-c`} name="classification" required defaultValue="" className={input}>
              <option value="" disabled>Pilih jenis</option>
              {Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{`${v.short} — ${v.long}`}</option>)}
            </select>
          </F>
          <F id={`${id}-t`} label="Waktu kejadian"><input id={`${id}-t`} name="occurred_at" type="datetime-local" required defaultValue={now} max={now} className={input} /></F>
        </div>
        {patients.length > 0 && (
          <F id={`${id}-p`} label="Pasien (opsional)" help="Kunjungan 7 hari terakhir di cabang ini. Kosongkan untuk KPC.">
            <select id={`${id}-p`} name="patient_visit" defaultValue="" className={input}>
              <option value="">Tanpa pasien</option>
              {patients.map((x) => <option key={x.visit_id} value={`${x.patient_id}:${x.visit_id}`}>{`${x.name} · ${x.mrn}`}</option>)}
            </select>
          </F>
        )}
        <F id={`${id}-s`} label="Ringkasan kejadian"><textarea id={`${id}-s`} name="summary" required minLength={3} maxLength={1000} className={area} /></F>
        <F id={`${id}-r`} label="Tindakan segera"><textarea id={`${id}-r`} name="immediate_response" required minLength={3} maxLength={1000} className={area} /></F>
        <Notice s={s} />
        <Button type="submit" disabled={pending} className="justify-self-start">Simpan Laporan</Button>
      </form>
    </Sheet>
  );
}

function Step({ ctx, incident, step, label, prominent, children }: { ctx: RenderedContext; incident: string; step: string; label: string; prominent?: boolean; children?: React.ReactNode }) {
  const [s, act, pending] = useActionState<IncidentFormState, FormData>(stepAction, {});
  const body = (
    <form action={act} key={`${step}${s.n ?? 0}`} aria-label={label} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="incident" value={incident} /><input type="hidden" name="step" value={step} />
      {children}
      <Notice s={s} />
      <Button type="submit" disabled={pending} variant={prominent || children ? "default" : "secondary"} className="justify-self-start">{children ? "Simpan" : label}</Button>
    </form>
  );
  return children ? <Sheet label={label} prominent={prominent}>{body}</Sheet> : body;
}

export function TakeForm({ ctx, incident }: { ctx: RenderedContext; incident: string }) {
  return <Step ctx={ctx} incident={incident} step="take" label="Tangani" prominent />;
}
export function InvestigateForm({ ctx, incident }: { ctx: RenderedContext; incident: string }) {
  const id = useId();
  return (
    <Step ctx={ctx} incident={incident} step="investigate" label="Catat Investigasi" prominent>
      <F id={`${id}-i`} label="Hasil investigasi"><textarea id={`${id}-i`} name="investigation" required minLength={3} maxLength={2000} className={area} /></F>
      <F id={`${id}-r`} label="Akar masalah"><textarea id={`${id}-r`} name="root_cause" required minLength={3} maxLength={1000} className={area} /></F>
    </Step>
  );
}
export function DetermineForm({ ctx, incident }: { ctx: RenderedContext; incident: string }) {
  const id = useId();
  return (
    <Step ctx={ctx} incident={incident} step="determine" label="Keputusan Pelaporan">
      <F id={`${id}-q`} label="Perlu dilaporkan ke pihak luar?" help="Penerima dan batas waktu diisi sesuai ketentuan yang sudah diverifikasi klinik.">
        <select id={`${id}-q`} name="report_required" required defaultValue="" className={input}>
          <option value="" disabled>Pilih</option>
          <option value="yes">Ya</option>
          <option value="no">Tidak</option>
        </select>
      </F>
      <div className={grid2}>
        <F id={`${id}-r`} label="Penerima laporan (jika ya)"><input id={`${id}-r`} name="recipient" maxLength={200} className={input} /></F>
        <F id={`${id}-d`} label="Batas waktu (jika ya)"><input id={`${id}-d`} name="due_on" type="date" className={input} /></F>
      </div>
    </Step>
  );
}
export function SubmitForm({ ctx, incident }: { ctx: RenderedContext; incident: string }) {
  const id = useId();
  return (
    <Step ctx={ctx} incident={incident} step="submit" label="Catat Bukti Kirim">
      <F id={`${id}-r`} label="Nomor atau bukti pengiriman"><input id={`${id}-r`} name="reference" required maxLength={120} className={input} /></F>
    </Step>
  );
}
export function CloseForm({ ctx, incident }: { ctx: RenderedContext; incident: string }) {
  const id = useId();
  return (
    <Step ctx={ctx} incident={incident} step="close" label="Tutup Insiden">
      <F id={`${id}-c`} label="Tindakan korektif"><textarea id={`${id}-c`} name="corrective_action" required minLength={3} maxLength={1000} className={area} /></F>
    </Step>
  );
}
