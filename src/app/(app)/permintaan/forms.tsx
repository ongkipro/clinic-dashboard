"use client";
// Permintaan Klinis forms (UX-27; T-056). Every write form posts its rendered context (HYG-009 B2-1) and a fresh
// idempotency key (remounted after every answer: n); forms stay mounted after success so the result shows. The
// list uses plain Setujui / Tolak; the detail has the one prominent Setujui.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { cancelRequestAction, createRequestAction, decideRequestAction, type RequestFormState } from "./actions";
import { formatDose, KIND_LABEL, UNIT_LABEL } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: RequestFormState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
      {s.consentOpened && <Link href={`/persetujuan-tindakan/${s.consentOpened}`} className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)]">Buka Persetujuan Tindakan</Link>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}

// Setujui / Tolak. `prominent`: the detail's tinted Setujui; in the list both are plain. Kept mounted once decided.
export function DecideForm({ ctx, request, visit, prominent, open, label }: {
  ctx: RenderedContext; request: string; visit: string; prominent: boolean; open: boolean; label: string;
}) {
  const [s, act, pending] = useActionState<RequestFormState, FormData>(decideRequestAction, {});
  const [declining, setDeclining] = useState(false);
  const id = useId();
  if (!open) return <Notice s={{ ok: s.ok, consentOpened: s.consentOpened }} />;
  return (
    <form action={act} key={`d${s.n ?? 0}`} aria-label={`Putuskan ${label}`} className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="request" value={request} /><input type="hidden" name="visit" value={visit} />
      {declining && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-r`}>Alasan penolakan</label>
          <input id={`${id}-r`} name="reason" required minLength={3} maxLength={500} className={input} />
        </div>
      )}
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        {!declining && <Button type="submit" name="decision" value="approve" size={prominent ? "lg" : "default"} variant={prominent ? "default" : "plain"} aria-disabled={pending}>Setujui</Button>}
        {declining
          ? <Button type="submit" name="decision" value="decline" variant="destructive" aria-disabled={pending}>Tolak Permintaan</Button>
          : <Button type="button" variant={prominent ? "secondary" : "plain"} onClick={() => setDeclining(true)}>Tolak</Button>}
      </div>
    </form>
  );
}

export function CancelForm({ ctx, request, open }: { ctx: RenderedContext; request: string; open: boolean }) {
  const [s, act, pending] = useActionState<RequestFormState, FormData>(cancelRequestAction, {});
  if (!open) return <Notice s={{ ok: s.ok }} />;
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label="Batalkan permintaan" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="request" value={request} />
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending}>Batalkan Permintaan</Button>
    </form>
  );
}

type Item = { item_id: string; stage: number; qty: number; catalog_version_id: string; name: string; dose_micro?: number | null; dose_unit?: string | null };
export type PlanChoice = { visit_id: string; plan_id: string; label: string; items: Item[] };
export function NewRequestForm({ ctx, plans, catalog, preset, canDose }: {
  ctx: RenderedContext; plans: PlanChoice[]; catalog: { catalog_version_id: string; name: string }[]; preset: string | null; canDose: boolean;
}) {
  const [s, act, pending] = useActionState<RequestFormState, FormData>(createRequestAction, {});
  const [pick, setPick] = useState(preset ?? plans[0]?.plan_id ?? "");
  const [kind, setKind] = useState<"addition" | "plan_change" | "substitution">("addition");
  const [target, setTarget] = useState("");
  const id = useId();
  const plan = plans.find((x) => x.plan_id === pick);
  const t = plan?.items.find((x) => x.item_id === target);
  return (
    <form action={act} key={`n${s.n ?? 0}`} aria-label="Usul permintaan klinis" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key />
      <input type="hidden" name="visit" value={plan?.visit_id ?? ""} />
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-p`} className="font-semibold">Pasien dan rencana</label>
        <select id={`${id}-p`} name="plan" value={pick} onChange={(e) => { setPick(e.target.value); setTarget(""); }} className={input}>
          {plans.map((x) => <option key={x.plan_id} value={x.plan_id}>{x.label}</option>)}
        </select>
      </div>
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className="mb-1 font-semibold">Jenis</legend>
        {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
          <label key={k} className="flex min-h-[52px] items-center gap-3">
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k as typeof kind)} className="size-5 shrink-0" />
            {KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      {kind !== "addition" && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-t`} className="font-semibold">Item rencana</label>
          <select id={`${id}-t`} name="target" value={target} onChange={(e) => setTarget(e.target.value)} required className={input}>
            <option value="" disabled>Pilih item</option>
            {plan?.items.map((x) => <option key={x.item_id} value={x.item_id}>{`Tahap ${x.stage} · ${x.name} × ${x.qty}`}</option>)}
          </select>
        </div>
      )}
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-v`} className="font-semibold">{kind === "substitution" ? "Item pengganti" : "Item"}</label>
        {kind === "plan_change" ? (
          <><input type="hidden" name="version" value={t?.catalog_version_id ?? ""} /><p id={`${id}-v`} className="m-0">{t?.name ?? "Pilih item rencana"}</p></>
        ) : (
          <select id={`${id}-v`} name="version" required defaultValue="" className={input}>
            <option value="" disabled>Pilih item</option>
            {catalog.map((c) => <option key={c.catalog_version_id} value={c.catalog_version_id}>{c.name}</option>)}
          </select>
        )}
      </div>
      <div key={`${kind}:${target}`} className="grid min-w-0 grid-cols-2 gap-2">
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-s`} className="font-semibold">Tahap</label>
          <input id={`${id}-s`} name="stage" inputMode="numeric" required defaultValue={t?.stage ?? 1} className={input} />
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-q`} className="font-semibold">Jumlah</label>
          <input id={`${id}-q`} name="qty" inputMode="numeric" required defaultValue={t?.qty ?? 1} className={input} />
        </div>
      </div>
      {canDose && (
        <div key={`d:${kind}:${target}`} className="grid min-w-0 grid-cols-2 gap-2">
          <div className="grid min-w-0 gap-1">
            <label htmlFor={`${id}-d`} className="font-semibold">Dosis (opsional)</label>
            <input id={`${id}-d`} name="dose" inputMode="decimal" defaultValue={kind === "plan_change" && t?.dose_micro ? formatDose(t.dose_micro).replace(",", ".") : ""} className={input} />
          </div>
          <div className="grid min-w-0 gap-1">
            <label htmlFor={`${id}-u`} className="font-semibold">Satuan</label>
            <select id={`${id}-u`} name="dose_unit" defaultValue={kind === "plan_change" ? t?.dose_unit ?? "" : ""} className={input}>
              <option value="">Tanpa dosis</option>
              {Object.entries(UNIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
      )}
      {!canDose && <p className={hint}>Dosis ditentukan oleh dokter.</p>}
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-r`} className="font-semibold">Alasan</label>
        <input id={`${id}-r`} name="reason" required minLength={3} maxLength={500} className={input} />
      </div>
      <Notice s={s} />
      {s.id && <Link href={`/permintaan/${s.id}`} className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)]">Lihat permintaan</Link>}
      <Button type="submit" size="lg" aria-disabled={pending || plans.length === 0}>{pending ? "Mengirim…" : "Kirim Permintaan"}</Button>
    </form>
  );
}
