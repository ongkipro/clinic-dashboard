"use client";
// Otomasi forms (UX-55; T-097). Every write form posts its rendered context (HYG-009 B2-1); marketing's proposal carries a fresh
// idempotency key (remounted after every answer: n). The database and the settings writer decide authority and bounds (DEC-109).
import { useActionState, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { cancelDraftAction, decideDraftAction, type OtomasiState, proposeScenarioAction, saveReminderAction, saveScenarioAction } from "./actions";
import { SCENARIOS } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function Notice({ s }: { s: OtomasiState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)] [overflow-wrap:anywhere]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}

// The scenario table: an on/off and the days per scenario, the birthday on/off and the daily cap per patient.
function ScenarioFields({ value, disabled }: { value: Record<string, unknown>; disabled: boolean }) {
  return (
    <>
      <ul className="m-0 grid list-none gap-2 p-0" aria-label="Skenario">
        {SCENARIOS.map(([k, label, unit]) => (
          <li key={k} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3 min-[700px]:grid-cols-[minmax(0,1fr)_auto_8rem] min-[700px]:items-center">
            <span className="font-semibold">{label}</span>
            <label className="flex min-h-[var(--target)] items-center gap-2">
              <input type="checkbox" name={`${k}_on`} aria-label={`${label} aktif`} defaultChecked={value[k] !== null && value[k] !== undefined} disabled={disabled} className="size-5" />
              Aktif
            </label>
            <label className="grid gap-1">
              <span className="sr-only">{`${label}: ${unit}`}</span>
              <input type="number" name={k} min={0} max={60} defaultValue={typeof value[k] === "number" ? String(value[k]) : "1"} disabled={disabled} className={input}
                aria-describedby={`${k}-u`} />
              <span id={`${k}-u`} className={hint}>{unit}</span>
            </label>
          </li>
        ))}
      </ul>
      <label className="flex min-h-[var(--target)] items-center gap-2">
        <input type="checkbox" name="ulang_tahun" defaultChecked={value.ulang_tahun === true} disabled={disabled} className="size-5" />
        Ucapan ulang tahun (perlu persetujuan pemasaran pasien)
      </label>
      <label className="grid max-w-xs gap-1">
        Batas pesan otomatis per pasien per hari
        <input type="number" name="batas_harian" min={1} max={5} defaultValue={String(value.batas_harian ?? 2)} disabled={disabled} className={input} />
      </label>
    </>
  );
}

export function ScenarioForm({ ctx, value, mode }: { ctx: RenderedContext; value: Record<string, unknown>; mode: "change" | "propose" | "read" }) {
  const [s, act, pending] = useActionState<OtomasiState, FormData>(mode === "propose" ? proposeScenarioAction : saveScenarioAction, {});
  if (mode === "read") return <form aria-label="Skenario otomasi" className="grid min-w-0 gap-3"><ScenarioFields value={value} disabled /></form>;
  return (
    <form action={act} key={`s${s.n ?? 0}`} aria-label="Skenario otomasi" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} />{mode === "propose" && <Key />}
      <ScenarioFields value={value} disabled={false} />
      <label className="grid gap-1">
        {mode === "propose" ? "Alasan usulan" : "Alasan perubahan"}
        <input name="reason" required minLength={3} maxLength={500} className={input} />
      </label>
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" aria-disabled={pending}>{mode === "propose" ? "Ajukan" : "Simpan"}</Button>
        {mode === "change" && <Button type="submit" name="restore" value="1" variant="plain" aria-disabled={pending}>Kembalikan ke default</Button>}
      </div>
    </form>
  );
}

export function DraftDecision({ ctx, draft, mode }: { ctx: RenderedContext; draft: string; mode: "decide" | "cancel" }) {
  const [s, act, pending] = useActionState<OtomasiState, FormData>(mode === "decide" ? decideDraftAction : cancelDraftAction, {});
  return (
    <form action={act} key={`d${s.n ?? 0}`} aria-label={mode === "decide" ? "Keputusan usulan" : "Tarik usulan"} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><input type="hidden" name="draft" value={draft} />
      {mode === "decide" && (
        <label className="grid gap-1">
          Alasan (wajib untuk menolak)
          <input name="reason" maxLength={500} className={input} />
        </label>
      )}
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        {mode === "decide" ? (
          <>
            <Button type="submit" name="approve" value="1" aria-disabled={pending}>Setujui</Button>
            <Button type="submit" name="approve" value="0" variant="plain" aria-disabled={pending}>Tolak</Button>
          </>
        ) : <Button type="submit" variant="plain" aria-disabled={pending}>Tarik Usulan</Button>}
      </div>
    </form>
  );
}

export function ReminderForm({ ctx, branch, branchName, value, canChange }: { ctx: RenderedContext; branch: string; branchName: string;
  value: { h1: string; sebelum: number }; canChange: boolean }) {
  const [s, act, pending] = useActionState<OtomasiState, FormData>(saveReminderAction, {});
  return (
    <form action={act} key={`r${branch}${s.n ?? 0}`} aria-label={`Pengingat ${branchName}`} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3">
      <ContextFields ctx={ctx} /><input type="hidden" name="branch" value={branch} />
      <h3 className="m-0 text-[1.06rem] font-semibold">{branchName}</h3>
      <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
        <label className="grid gap-1">H-1 pukul<input type="time" name="h1" min="07:00" max="21:00" defaultValue={value.h1} disabled={!canChange} className={input} /></label>
        <label className="grid gap-1">Hari H, jam sebelum janji<input type="number" name="sebelum" min={1} max={12} defaultValue={String(value.sebelum)} disabled={!canChange} className={input} /></label>
      </div>
      {canChange && (
        <>
          <label className="grid gap-1">Alasan perubahan<input name="reason" required minLength={3} maxLength={500} className={input} /></label>
          <Notice s={s} />
          <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan</Button>
        </>
      )}
    </form>
  );
}
