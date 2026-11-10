"use client";
// Pemeriksaan forms (UX-8, PR-10; T-052). Every write form posts its rendered context (HYG-009 B2-1) and fresh
// idempotency keys (remounted after every answer: n). The face map: an in-house SVG per template (no third-party
// art); a tap places the point in integer permille of the drawing; the same form has numeric X/Y fields as the
// keyboard path, and the points are listed in a table.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { Mark, Plan, SheetFact } from "../../../modules/clinical/exam/exam";
import type { RenderedContext } from "../../../modules/org/context/context";
import {
  closePlanAction, type ExamState, itemAction, markAction, openAction, planAction, removeItemAction, removeMarkAction, saveAction, verifyAction,
} from "./actions";
import type { CatalogOption } from "./data";
import {
  formatDose, ICD10, LAYER_COLOR, LAYER_LABEL, MAP_LABEL, rupiah, SECTION_LABEL, TEMPLATE_FIELDS, TEMPLATE_LABEL, UNIT_LABEL, VITALS,
} from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hintCls = "m-0 text-[0.88rem] text-[var(--label-2)]";
type Ids = { ctx: RenderedContext; visit: string; exam: string };

function Notice({ s }: { s: ExamState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Hidden({ ctx, visit, exam }: Ids) {
  return (<><ContextFields ctx={ctx} /><input type="hidden" name="visit" value={visit} /><input type="hidden" name="exam" value={exam} /></>);
}

export function OpenExam({ ctx, visit, label }: { ctx: RenderedContext; visit: string; label: string }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(openAction, {});
  return (
    <form action={act} key={`o${s.n ?? 0}`} aria-label={`Mulai pemeriksaan ${label}`} className="grid gap-1">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="visit" value={visit} />
      <Button type="submit" size="lg" aria-disabled={pending}>{pending ? "Membuka…" : "Mulai Pemeriksaan"}</Button>
      <Notice s={s} />
    </form>
  );
}

// ── Intake verification (CLIN-004): Benar / Koreksi per fact ────────────────────────────────────────
export function VerifyFact({ ids, fact, label }: { ids: Ids; fact: SheetFact; label: string }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(verifyAction, {});
  const [fixing, setFixing] = useState(false);
  const id = useId();
  return (
    <form action={act} key={`v${s.n ?? 0}`} aria-label={`Verifikasi ${label}`} className="grid min-w-0 gap-2">
      <Hidden {...ids} /><Key /><input type="hidden" name="fact" value={fact.id} />
      {!fixing ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button type="submit" name="decision" value="confirmed" variant="secondary" aria-disabled={pending}>Benar</Button>
          <Button type="button" variant="plain" onClick={() => setFixing(true)}>Koreksi</Button>
        </div>
      ) : (
        <div className="grid min-w-0 gap-2">
          <label htmlFor={`${id}-v`} className="font-semibold">Koreksi {label.toLowerCase()}</label>
          <input id={`${id}-v`} name="value" maxLength={500} defaultValue={fact.verification?.corrected_value ?? fact.value} className={input} />
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button type="submit" name="decision" value="corrected" variant="secondary" aria-disabled={pending}>Simpan Koreksi</Button>
            <Button type="button" variant="plain" onClick={() => setFixing(false)}>Batal</Button>
          </div>
        </div>
      )}
      <Notice s={s} />
    </form>
  );
}

// ── SOAP with a template picker, vitals and ICD-10 ────────────────────────────────────────────────
type Exam = { subjective: string | null; objective: string | null; assessment: string | null; plan_note: string | null; template_key: string | null;
  template_values: Record<string, string>; vitals: Record<string, number>; icd10_codes: string[] };
export function SoapForm({ ids, exam }: { ids: Ids; exam: Exam }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(saveAction, {});
  const [tpl, setTpl] = useState(exam.template_key ?? "");
  const id = useId();
  return (
    <form action={act} aria-label="Pemeriksaan SOAP" className="grid min-w-0 gap-4">
      <Hidden {...ids} /><Key key={`k${s.n ?? 0}`} />
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-t`} className="font-semibold">Templat pemeriksaan</label>
        <select id={`${id}-t`} name="template_key" value={tpl} onChange={(e) => setTpl(e.target.value)} className={input}>
          <option value="">Tanpa templat</option>
          {Object.entries(TEMPLATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {tpl && (
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-1 font-semibold">Penilaian {TEMPLATE_LABEL[tpl]}</legend>
          {TEMPLATE_FIELDS[tpl].map((f) => (
            <div key={f.key} className="grid min-w-0 gap-1">
              <label htmlFor={`${id}-${f.key}`}>{f.label}</label>
              {f.options ? (
                <select id={`${id}-${f.key}`} name={`tv_${f.key}`} defaultValue={exam.template_key === tpl ? exam.template_values[f.key] ?? "" : ""} className={input}>
                  <option value="">—</option>
                  {f.options.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                </select>
              ) : (
                <input id={`${id}-${f.key}`} name={`tv_${f.key}`} inputMode="numeric" pattern="\d{1,3}" defaultValue={exam.template_key === tpl ? exam.template_values[f.key] ?? "" : ""} className={input} />
              )}
            </div>
          ))}
        </fieldset>
      )}
      {(Object.keys(SECTION_LABEL) as (keyof typeof SECTION_LABEL)[]).map((k) => (
        <div key={k} className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-${k}`} className="font-semibold">{SECTION_LABEL[k]}</label>
          <textarea id={`${id}-${k}`} name={k} rows={3} maxLength={4000} defaultValue={exam[k] ?? ""} className={`${input} py-3`} />
        </div>
      ))}
      <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-1 font-semibold">Tanda vital</legend>
        {VITALS.map((v) => (
          <div key={v.key} className="grid min-w-0 gap-1">
            <label htmlFor={`${id}-${v.key}`}>{v.label} <span className={hintCls}>({v.unit})</span></label>
            <input id={`${id}-${v.key}`} name={`vital_${v.key}`} inputMode="numeric" pattern="\d{1,4}" defaultValue={exam.vitals[v.key] ?? ""} className={input} />
          </div>
        ))}
      </fieldset>
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className="mb-1 font-semibold">Diagnosis (ICD-10)</legend>
        <p className={hintCls}>Daftar singkat; kode lengkap tersedia bersama integrasi SATUSEHAT.</p>
        <div className="flex min-w-0 flex-wrap gap-2">
          {ICD10.map(([c, name]) => (
            <label key={c} className="inline-flex min-h-[44px] max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-4 py-1 has-[:checked]:border-[var(--tint)] has-[:checked]:bg-[var(--accent)]">
              <input type="checkbox" name="icd" value={c} defaultChecked={exam.icd10_codes.includes(c)} className="size-5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-semibold">{c}</span> {name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Notice s={s} />
      <Button type="submit" size="lg" aria-disabled={pending}>{pending ? "Menyimpan…" : "Simpan Pemeriksaan"}</Button>
    </form>
  );
}

// ── Face & body map ────────────────────────────────────────────────────────────────────────────────
// In-house outline drawings on a 1000 × 1000 viewBox (no third-party art).
const OUTLINE: Record<string, string> = {
  face_front: "M500 80 C300 80 220 240 230 420 C240 600 330 800 500 900 C670 800 760 600 770 420 C780 240 700 80 500 80 Z M380 420 h70 M550 420 h70 M500 470 v110 M430 690 Q500 730 570 690",
  face_left: "M560 80 C380 80 280 240 290 420 C300 520 250 560 220 600 L300 640 C320 760 420 860 560 900 C700 820 760 600 740 400 C730 220 680 80 560 80 Z M330 430 h60 M260 600 L300 600 M360 710 Q400 730 440 700",
  face_right: "M440 80 C620 80 720 240 710 420 C700 520 750 560 780 600 L700 640 C680 760 580 860 440 900 C300 820 240 600 260 400 C270 220 320 80 440 80 Z M610 430 h60 M740 600 L700 600 M640 710 Q600 730 560 700",
  body: "M500 40 a70 70 0 1 0 0.1 0 Z M420 190 h160 l60 300 h-50 l-30 -180 v280 l30 360 h-70 l-40 -330 l-40 330 h-70 l30 -360 v-280 l-30 180 h-50 Z",
};

export function FaceMap({ ids, marks, catalog, editable }: { ids: Ids; marks: Mark[]; catalog: { versionId: string; name: string; kind: string }[]; editable: boolean }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(markAction, {});
  const [tpl, setTpl] = useState<string>("face_front");
  const [layer, setLayer] = useState<string>("keluhan");
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  const id = useId();
  const shown = marks.filter((m) => m.template === tpl);
  const place = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!editable) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPt({ x: Math.round(((e.clientX - r.left) / r.width) * 1000), y: Math.round(((e.clientY - r.top) / r.height) * 1000) });
  };
  return (
    <div className="grid min-w-0 gap-3">
      <div role="tablist" aria-label="Templat peta" className="flex min-w-0 flex-wrap gap-2">
        {Object.entries(MAP_LABEL).map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={tpl === k} onClick={() => { setTpl(k); setPt(null); }}
            className={`min-h-[44px] rounded-full px-4 ${tpl === k ? "bg-[var(--tint)] text-white" : "bg-[var(--surface-2)]"}`}>{v}</button>
        ))}
      </div>
      <div className="grid min-w-0 gap-4">
        <svg viewBox="0 0 1000 1000" role="img" aria-label={`Peta ${MAP_LABEL[tpl]}: ${shown.length} titik`} onClick={place}
          className={`aspect-square w-full max-w-[320px] rounded-[var(--radius-field)] bg-[var(--surface-2)] ${editable ? "cursor-crosshair" : ""}`}>
          <path d={OUTLINE[tpl]} fill="none" stroke="var(--label-3)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          {shown.map((m, i) => (
            <g key={m.id}>
              <circle cx={m.x} cy={m.y} r="26" fill={LAYER_COLOR[m.layer]} />
              <text x={m.x} y={m.y + 11} textAnchor="middle" fontSize="32" fontWeight="700" fill="white">{i + 1}</text>
            </g>
          ))}
          {pt && <circle cx={pt.x} cy={pt.y} r="26" fill="none" stroke="var(--tint)" strokeWidth="8" />}
        </svg>
        <div className="grid min-w-0 content-start gap-3">
          {shown.length > 0 ? (
            <table className="w-full min-w-0 border-collapse text-left">
              <caption className="sr-only">Titik pada {MAP_LABEL[tpl]}</caption>
              <thead><tr className="text-[0.88rem] text-[var(--label-2)]"><th className="py-1 pr-2 font-normal">No</th><th className="py-1 pr-2 font-normal">Lapisan</th><th className="py-1 pr-2 font-normal">Keterangan</th><th className="py-1 font-normal">Dosis</th>{editable && <th className="py-1"><span className="sr-only">Aksi</span></th>}</tr></thead>
              <tbody>
                {shown.map((m, i) => (
                  <tr key={m.id} className="border-t border-[var(--separator)] align-middle">
                    <td className="py-2 pr-2">{i + 1}</td>
                    <td className="py-2 pr-2">{LAYER_LABEL[m.layer]}</td>
                    <td className="py-2 pr-2 [overflow-wrap:anywhere]">{m.label}{m.catalog_version_id ? ` · ${catalog.find((c) => c.versionId === m.catalog_version_id)?.name ?? "Produk"}` : ""}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">{m.dose_micro != null ? `${formatDose(m.dose_micro)} ${UNIT_LABEL[m.dose_unit!]}` : "—"}</td>
                    {editable && <td className="py-2"><RemoveMark ids={ids} mark={m.id} n={i + 1} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className={hintCls}>Belum ada titik pada {MAP_LABEL[tpl].toLowerCase()}.</p>}
          {editable && (
            <form action={act} key={`m${s.n ?? 0}`} aria-label="Tambah titik" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-3"
              onSubmit={() => setPt(null)}>
              <Hidden {...ids} /><Key /><input type="hidden" name="template" value={tpl} />
              <p className={hintCls}>Ketuk gambar untuk memilih titik, atau isi posisi X/Y (0–1000).</p>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-x`}>Posisi X</label>
                  <input id={`${id}-x`} name="x" inputMode="numeric" required pattern="\d{1,4}" value={pt?.x ?? ""} onChange={(e) => setPt({ x: Number(e.target.value) || 0, y: pt?.y ?? 0 })} className={input} /></div>
                <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-y`}>Posisi Y</label>
                  <input id={`${id}-y`} name="y" inputMode="numeric" required pattern="\d{1,4}" value={pt?.y ?? ""} onChange={(e) => setPt({ x: pt?.x ?? 0, y: Number(e.target.value) || 0 })} className={input} /></div>
              </div>
              <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-l`}>Lapisan</label>
                <select id={`${id}-l`} name="layer" value={layer} onChange={(e) => setLayer(e.target.value)} className={input}>
                  {Object.entries(LAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-k`}>Keterangan titik</label>
                <input id={`${id}-k`} name="label" required maxLength={120} className={input} /></div>
              {layer === "tindakan" && (
                <>
                  <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-p`}>Produk / layanan (opsional)</label>
                    <select id={`${id}-p`} name="version" defaultValue="" className={input}>
                      <option value="">—</option>
                      {catalog.filter((c) => c.kind !== "package").map((c) => <option key={c.versionId} value={c.versionId}>{c.name}</option>)}
                    </select></div>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_120px] gap-2">
                    <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-d`}>Dosis titik</label>
                      <input id={`${id}-d`} name="dose" inputMode="decimal" required className={input} placeholder="mis. 4 atau 0,5" /></div>
                    <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-u`}>Satuan</label>
                      <select id={`${id}-u`} name="dose_unit" defaultValue="unit" className={input}>
                        {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select></div>
                  </div>
                </>
              )}
              <Notice s={s} />
              <Button type="submit" variant="secondary" aria-disabled={pending}>Tambah Titik</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
function RemoveMark({ ids, mark, n }: { ids: Ids; mark: string; n: number }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(removeMarkAction, {});
  return (
    <form action={act} key={`r${s.n ?? 0}`}>
      <Hidden {...ids} /><Key /><input type="hidden" name="mark" value={mark} />
      <Button type="submit" variant="plain" aria-disabled={pending} aria-label={`Hapus titik ${n}`}>Hapus</Button>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
    </form>
  );
}

// ── Care plans (CLIN-012): several in parallel; items by stage; live prices ───────────────────────────
export function NewPlan({ ids }: { ids: Ids }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(planAction, {});
  const id = useId();
  return (
    <form action={act} key={`p${s.n ?? 0}`} aria-label="Rencana baru" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-3">
      <Hidden {...ids} /><Key />
      <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-t`} className="font-semibold">Nama rencana</label>
        <input id={`${id}-t`} name="title" required minLength={3} maxLength={160} className={input} placeholder="mis. Program Jerawat" /></div>
      <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-c`} className="font-semibold">Kondisi</label>
        <input id={`${id}-c`} name="condition" required minLength={3} maxLength={200} className={input} /></div>
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending}>Buat Rencana</Button>
    </form>
  );
}

export function PlanCard({ ids, plan, catalog, editable }: { ids: Ids; plan: Plan; catalog: CatalogOption[]; editable: boolean }) {
  const total = plan.items.reduce((a, i) => a + (i.line_total ?? 0), 0);
  const stages = [...new Set(plan.items.map((i) => i.stage))].sort((a, b) => a - b);
  return (
    <section aria-label={plan.title} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
      <div className="grid min-w-0 gap-0.5">
        <h3 className="m-0 text-[1.06rem] font-semibold [overflow-wrap:anywhere]">{plan.title}</h3>
        {plan.condition && <p className={hintCls}>Kondisi: {plan.condition}</p>}
      </div>
      {plan.items.length === 0 ? <p className={hintCls}>Belum ada item.</p> : stages.map((st) => (
        <div key={st} className="grid min-w-0 gap-1">
          <p className="m-0 font-semibold">Tahap {st}</p>
          <ul className="m-0 grid min-w-0 list-none gap-1 p-0">
            {plan.items.filter((i) => i.stage === st).map((i) => (
              <li key={i.id} className="flex min-h-[52px] min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--separator)] py-1">
                <span className="min-w-0 grow basis-[12rem] [overflow-wrap:anywhere]">{i.name} × {i.qty}{i.dose_micro != null ? ` · ${formatDose(i.dose_micro)} ${UNIT_LABEL[i.dose_unit!]}` : ""}{i.note ? ` · ${i.note}` : ""}</span>
                <span className="whitespace-nowrap tabular-nums">{rupiah(i.line_total)}</span>
                {editable && <RemoveItem ids={ids} item={i.id} name={i.name} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="m-0 flex justify-between font-semibold"><span>Perkiraan total</span><span className="tabular-nums">{rupiah(total)}</span></p>
      <p className={hintCls}>Harga mengikuti harga cabang saat ini; harga dikunci saat tagihan dibuat.</p>
      {editable && <AddItem ids={ids} plan={plan.id} catalog={catalog} next={(stages.at(-1) ?? 1)} />}
      {editable && <ClosePlan ids={ids} plan={plan.id} title={plan.title} />}
    </section>
  );
}
function AddItem({ ids, plan, catalog, next }: { ids: Ids; plan: string; catalog: CatalogOption[]; next: number }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(itemAction, {});
  const id = useId();
  return (
    <details className="min-w-0">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-[var(--tint)]">Tambah item</summary>
      <form action={act} key={`i${s.n ?? 0}`} aria-label="Tambah item rencana" className="grid min-w-0 gap-3 pt-2">
        <Hidden {...ids} /><Key /><input type="hidden" name="plan" value={plan} />
        <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-v`}>Item katalog</label>
          <select id={`${id}-v`} name="version" required defaultValue="" className={input}>
            <option value="" disabled>Pilih layanan, produk atau paket</option>
            {catalog.filter((c) => c.kind !== "material").map((c) => <option key={c.versionId} value={c.versionId}>{c.name}</option>)}
          </select></div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-s`}>Tahap</label>
            <input id={`${id}-s`} name="stage" inputMode="numeric" required pattern="\d{1,2}" defaultValue={next} className={input} /></div>
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-q`}>Jumlah</label>
            <input id={`${id}-q`} name="qty" inputMode="numeric" required pattern="\d{1,4}" defaultValue={1} className={input} /></div>
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_120px] gap-2">
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-d`}>Dosis (opsional)</label>
            <input id={`${id}-d`} name="dose" inputMode="decimal" className={input} /></div>
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-u`}>Satuan</label>
            <select id={`${id}-u`} name="dose_unit" defaultValue="ml" className={input}>
              {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        </div>
        <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-n`}>Catatan (opsional)</label>
          <input id={`${id}-n`} name="note" maxLength={500} className={input} /></div>
        <Notice s={s} />
        <Button type="submit" variant="secondary" aria-disabled={pending}>Tambah ke Rencana</Button>
      </form>
    </details>
  );
}
function RemoveItem({ ids, item, name }: { ids: Ids; item: string; name: string }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(removeItemAction, {});
  return (
    <form action={act} key={`x${s.n ?? 0}`}>
      <Hidden {...ids} /><Key /><input type="hidden" name="item" value={item} />
      <Button type="submit" variant="plain" aria-disabled={pending} aria-label={`Hapus ${name} dari rencana`}>Hapus</Button>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
    </form>
  );
}
function ClosePlan({ ids, plan, title }: { ids: Ids; plan: string; title: string }) {
  const [s, act, pending] = useActionState<ExamState, FormData>(closePlanAction, {});
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label={`Tutup ${title}`} className="flex min-w-0 flex-wrap gap-2">
      <Hidden {...ids} /><Key /><input type="hidden" name="plan" value={plan} />
      <Button type="submit" name="state" value="completed" variant="plain" aria-disabled={pending}>Tandai Selesai</Button>
      <Button type="submit" name="state" value="stopped" variant="destructive" aria-disabled={pending}>Hentikan Rencana</Button>
      <Notice s={s} />
    </form>
  );
}
