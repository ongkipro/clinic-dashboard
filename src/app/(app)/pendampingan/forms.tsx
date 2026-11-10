"use client";
// Pendampingan forms (UX-7 step 1, PR-9; T-051). Every write form posts its rendered context (HYG-009 B2-1) and
// fresh idempotency keys (remounted after every answer: n). The intake form keeps its edits across the
// "Riwayat Singkat" disclosure (one form, not unmounted); one prominent action, "Kirim ke Dokter".
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { Fact } from "../../../modules/clinical/intake/intake";
import type { RenderedContext } from "../../../modules/org/context/context";
import { type IntakeState, openAction, saveAction } from "./actions";
import { CHIP_LABEL, CHIP_ORDER, FACT_LABEL, FACT_ORDER } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hintCls = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: IntakeState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key({ name = "key" }: { name?: string }) {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name={name} value={k} />;
}

export function OpenIntake({ ctx, visit, label }: { ctx: RenderedContext; visit: string; label: string }) {
  const [s, act, pending] = useActionState<IntakeState, FormData>(openAction, {});
  return (
    <form action={act} key={`o${s.n ?? 0}`} aria-label={`Mulai pendampingan ${label}`} className="grid gap-1">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="visit" value={visit} />
      <Button type="submit" aria-disabled={pending}>{pending ? "Membuka…" : "Mulai Pendampingan"}</Button>
      <Notice s={s} />
    </form>
  );
}

type Draft = { complaint: string | null; facts: Fact[]; reviewedPrior: string[]; chips: string[]; note: string | null };

export function IntakeForm({ ctx, visit, intake, draft, history }: { ctx: RenderedContext; visit: string; intake: string; draft: Draft; history: Fact[] }) {
  const [s, act, pending] = useActionState<IntakeState, FormData>(saveAction, {});
  const id = useId();
  const prior = new Map(history.map((h) => [h.kind, h]));
  const current = new Map(draft.facts.map((f) => [f.kind, f]));
  // A history fact starts as "same" when it was reviewed so in the draft, else when nothing new was entered.
  const [same, setSame] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FACT_ORDER.map((k) => [k, prior.has(k) && !current.has(k) && (draft.reviewedPrior.includes(prior.get(k)!.id) || draft.facts.length === 0)])));
  return (
    <form action={act} aria-label="Intake pasien" className="grid min-w-0 gap-5">
      <ContextFields ctx={ctx} />
      <Key key={`k${s.n ?? 0}`} /><Key key={`s${s.n ?? 0}`} name="send_key" />
      <input type="hidden" name="visit" value={visit} />
      <input type="hidden" name="intake" value={intake} />
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-c`} className="font-semibold">Keluhan utama</label>
        <textarea id={`${id}-c`} name="complaint" rows={3} maxLength={1000} defaultValue={draft.complaint ?? ""} className={`${input} py-3`} />
        <p className={hintCls}>Tulis dengan kata-kata pasien. Bukan diagnosis.</p>
      </div>
      <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
        <legend className="mb-1 text-[1.06rem] font-semibold">Riwayat dan kondisi</legend>
        {FACT_ORDER.map((kind) => {
          const h = prior.get(kind);
          const isSame = !!same[kind];
          return (
            <div key={kind} role="group" aria-label={FACT_LABEL[kind]} className={`grid min-w-0 gap-1.5 rounded-[var(--radius-field)] p-3 ${kind === "allergy" ? "bg-[var(--warning-soft)]" : "bg-[var(--surface-2)]"}`}>
              <label htmlFor={`${id}-${kind}`} className="font-semibold">{FACT_LABEL[kind]}</label>
              {h && (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]"><span className={hintCls}>Kunjungan lalu:</span> {h.value}</span>
                  <label className="flex min-h-[44px] items-center gap-2">
                    <input type="checkbox" className="size-5" checked={isSame} onChange={(e) => setSame((x) => ({ ...x, [kind]: e.target.checked }))} />
                    Sama seperti kunjungan lalu
                  </label>
                  {isSame && <input type="hidden" name={`same_${kind}`} value={h.id} />}
                </div>
              )}
              {!isSame && (
                <input id={`${id}-${kind}`} name={`fact_${kind}`} maxLength={500} defaultValue={current.get(kind)?.value ?? ""} className={input}
                  placeholder={h ? "Tulis yang berubah" : "Kosongkan bila tidak ada"} />
              )}
            </div>
          );
        })}
      </fieldset>
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className="mb-1 text-[1.06rem] font-semibold">Observasi Kulit</legend>
        <p className={hintCls}>Pilih yang terlihat. Tanpa nilai, skor atau tipe kulit; dokter yang menilai.</p>
        <div className="flex min-w-0 flex-wrap gap-2">
          {CHIP_ORDER.map((c) => (
            <label key={c} className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-[var(--control-border)] bg-white px-4 has-[:checked]:border-[var(--tint)] has-[:checked]:bg-[var(--accent)]">
              <input type="checkbox" name="chip" value={c} defaultChecked={draft.chips.includes(c)} className="size-5" />
              {CHIP_LABEL[c]}
            </label>
          ))}
        </div>
        <label htmlFor={`${id}-n`} className="font-semibold">Catatan observasi</label>
        <textarea id={`${id}-n`} name="note" rows={2} maxLength={1000} defaultValue={draft.note ?? ""} className={`${input} py-3`} />
      </fieldset>
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" name="intent" value="send" size="lg" aria-disabled={pending}>{pending ? "Mengirim…" : "Kirim ke Dokter"}</Button>
        <Button type="submit" name="intent" value="save" variant="secondary" aria-disabled={pending}>Simpan Draf</Button>
      </div>
    </form>
  );
}
