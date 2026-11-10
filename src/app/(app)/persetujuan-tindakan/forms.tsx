"use client";
// Persetujuan Tindakan forms (UX-39; T-054). Every write form posts its rendered context (HYG-009 B2-1) and a
// fresh idempotency key (remounted after every answer: n). The signature pad is a canvas of at least 320 × 160
// CSS px (exported at twice that), with Ulangi; one prominent "Tanda Tangani" for the patient or guardian.
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { captureAction, type ConsentFormState, reviewAction, withdrawAction } from "./actions";
import { RELATION_LABEL } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: ConsentFormState }) {
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

// The pad: pointer drawing on a canvas that keeps at least 320 × 160 CSS px (wider when room allows).
function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const stroked = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    c.width = 640;
    c.height = 320;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1d1d1f";
  }, []);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height] as const;
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    stroked.current = false;
    setEmpty(true);
    onChange("");
  };
  return (
    <div className="grid min-w-0 gap-2">
      <canvas
        ref={ref}
        aria-label="Kotak tanda tangan pasien atau wali"
        role="img"
        className="h-[160px] w-full min-w-[320px] max-w-[640px] touch-none rounded-[var(--radius-field)] border-2 border-dashed border-[var(--control-border)] bg-white"
        onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const ctx = e.currentTarget.getContext("2d")!; const [x, y] = at(e); ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = e.currentTarget.getContext("2d")!; const [x, y] = at(e); ctx.lineTo(x, y); ctx.stroke(); stroked.current = true; setEmpty(false); }}
        onPointerUp={(e) => { drawing.current = false; if (stroked.current) onChange(e.currentTarget.toDataURL("image/png")); }}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="button" variant="plain" onClick={clear}>Ulangi</Button>
        <span className={hint}>{empty ? "Belum ada tanda tangan." : "Tanda tangan siap disimpan."}</span>
      </div>
    </div>
  );
}

export function CaptureForm({ ctx, visit, plan, hash, guardianRequired, consented }: {
  ctx: RenderedContext; visit: string; plan: string; hash: string; guardianRequired: boolean; consented: boolean;
}) {
  const [s, act, pending] = useActionState<ConsentFormState, FormData>(captureAction, {});
  if (consented) {
    return (
      <div className="grid min-w-0 gap-2">
        <Notice s={{ ok: s.ok }} />
        <p className={hint}>Persetujuan sudah sesuai rencana. Persetujuan baru hanya perlu bila rencana berubah.</p>
      </div>
    );
  }
  return <CaptureFields s={s} act={act} pending={pending} ctx={ctx} visit={visit} plan={plan} hash={hash} guardianRequired={guardianRequired} />;
}

function CaptureFields({ s, act, pending, ctx, visit, plan, hash, guardianRequired }: {
  s: ConsentFormState; act: (f: FormData) => void; pending: boolean; ctx: RenderedContext; visit: string; plan: string; hash: string; guardianRequired: boolean;
}) {
  const [signer, setSigner] = useState(guardianRequired ? "guardian" : "patient");
  const [sig, setSig] = useState("");
  const id = useId();
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label="Tanda tangan persetujuan" className="grid min-w-0 gap-4">
      <ContextFields ctx={ctx} /><Key />
      <input type="hidden" name="visit" value={visit} /><input type="hidden" name="plan" value={plan} /><input type="hidden" name="hash" value={hash} />
      <input type="hidden" name="signature" value={sig} />
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className="mb-1 font-semibold">Yang menandatangani</legend>
        {guardianRequired && <p className={hint}>Pasien di bawah 18 tahun atau bayi: wali yang menandatangani.</p>}
        <div className="flex min-w-0 flex-wrap gap-2">
          {(guardianRequired ? ["guardian"] : ["patient", "guardian"]).map((v) => (
            <label key={v} className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-[var(--control-border)] bg-white px-4 has-[:checked]:border-[var(--tint)] has-[:checked]:bg-[var(--accent)]">
              <input type="radio" name="signer" value={v} checked={signer === v} onChange={() => setSigner(v)} className="size-5" />
              {v === "patient" ? "Pasien" : "Wali"}
            </label>
          ))}
        </div>
      </fieldset>
      {signer === "guardian" && (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-g`}>Nama wali</label>
            <input id={`${id}-g`} name="guardian_name" required minLength={2} maxLength={120} className={input} /></div>
          <div className="grid min-w-0 gap-1"><label htmlFor={`${id}-r`}>Hubungan</label>
            <select id={`${id}-r`} name="guardian_relation" required defaultValue="" className={input}>
              <option value="" disabled>Pilih hubungan</option>
              {Object.entries(RELATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        </div>
      )}
      <SignaturePad onChange={setSig} />
      <Notice s={s} />
      <Button type="submit" size="lg" aria-disabled={pending || !sig}>{pending ? "Menyimpan…" : "Tanda Tangani"}</Button>
    </form>
  );
}

// Stays mounted when the consent is gone so the result of a withdrawal shows (no active consent: only the notice).
export function WithdrawForm({ ctx, visit, consent }: { ctx: RenderedContext; visit: string; consent: string | null }) {
  const [s, act, pending] = useActionState<ConsentFormState, FormData>(withdrawAction, {});
  const id = useId();
  if (!consent) return <Notice s={{ ok: s.ok }} />;
  return (
    <details className="min-w-0">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-[var(--danger)]">Tarik Persetujuan</summary>
      <form action={act} key={`w${s.n ?? 0}`} aria-label="Tarik persetujuan" className="grid min-w-0 gap-2 pt-2">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="visit" value={visit} /><input type="hidden" name="consent" value={consent} />
        <label htmlFor={`${id}-r`}>Alasan penarikan</label>
        <input id={`${id}-r`} name="reason" required minLength={3} maxLength={500} className={input} />
        <Notice s={s} />
        <Button type="submit" variant="destructive" aria-disabled={pending}>Tarik Persetujuan</Button>
      </form>
    </details>
  );
}

export function ReviewForm({ ctx, visit, exam, item, name }: { ctx: RenderedContext; visit: string; exam: string; item: string; name: string }) {
  const [s, act, pending] = useActionState<ConsentFormState, FormData>(reviewAction, {});
  const id = useId();
  return (
    <form action={act} key={`r${s.n ?? 0}`} aria-label={`Kontraindikasi ${name}`} className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="visit" value={visit} />
      <input type="hidden" name="exam" value={exam} /><input type="hidden" name="item" value={item} />
      <label htmlFor={`${id}-r`} className={hint}>Catatan (wajib bila ditahan)</label>
      <input id={`${id}-r`} name="reason" maxLength={500} className={input} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" name="decision" value="cleared" variant="secondary" aria-disabled={pending}>Aman Dilakukan</Button>
        <Button type="submit" name="decision" value="blocked" variant="destructive" aria-disabled={pending}>Tahan</Button>
      </div>
      <Notice s={s} />
    </form>
  );
}
