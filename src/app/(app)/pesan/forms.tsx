"use client";
// Pesan forms (UX-17; T-090). Every write form posts its rendered context (HYG-009 B2-1) and, where the command is keyed, a fresh idempotency
// key (remounted after every answer: n). The database decides authority, the 24 h window and consent (DEC-102).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { conversationAction, type PesanState, replyAction, saveTemplateAction, syncTemplatesAction, templateSendAction } from "./actions";
import { CATEGORY } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function Notice({ s }: { s: PesanState }) {
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

// The composer: free-form inside the window; otherwise the template picker only (PR-28).
export type Tpl = { id: string; name: string; category: string; param_count: number; body: string };
// In-window shortcuts (DEC-102 (6): no table, no setting): they fill the reply; staff still read and send it.
export type Shortcut = { label: string; text: string };
export function Composer({ ctx, conversation, windowOpen, windowText, templates, marketingBlocked, shortcuts }: {
  ctx: RenderedContext; conversation: string; windowOpen: boolean; windowText: string | null; templates: Tpl[]; marketingBlocked: boolean; shortcuts: Shortcut[];
}) {
  const [s, act, pending] = useActionState<PesanState, FormData>(replyAction, {});
  const [ts, tact, tpending] = useActionState<PesanState, FormData>(templateSendAction, {});
  const [pick, setPick] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const chosen = templates.find((t) => t.id === pick);
  return (
    <section aria-label="Balas" className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      {windowOpen ? (
        <form action={act} key={`r${s.n ?? 0}`} aria-label="Balas pesan" className="grid min-w-0 gap-2">
          <ContextFields ctx={ctx} /><Key /><input type="hidden" name="conversation" value={conversation} />
          {shortcuts.length > 0 && (
            <div role="group" aria-label="Balasan cepat" className="flex min-w-0 flex-wrap gap-2">
              {shortcuts.map((q) => <Button key={q.label} type="button" variant="secondary" onClick={() => setDraft(q.text)}>{q.label}</Button>)}
            </div>
          )}
          <label htmlFor={`${id}-b`}>Balasan</label>
          <textarea id={`${id}-b`} key={draft ?? "none"} name="body" rows={3} maxLength={4096} required defaultValue={draft ?? s.values?.body ?? ""} aria-describedby={`${id}-w`} className={`${input} py-2`} />
          <p id={`${id}-w`} className={hint}>{windowText ? `Jendela layanan 24 jam: sisa ${windowText}.` : "Jendela layanan 24 jam terbuka."}</p>
          <Notice s={s} />
          <Button type="submit" aria-disabled={pending} className="justify-self-start">Kirim</Button>
        </form>
      ) : (
        <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--warning-soft)] px-3 py-2 text-[var(--label)]">Jendela 24 jam habis — pilih template.</p>
      )}
      <form action={tact} key={`t${ts.n ?? 0}`} aria-label="Kirim template" className="grid min-w-0 gap-2">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="conversation" value={conversation} />
        <label htmlFor={`${id}-t`}>Pilih Template</label>
        <select id={`${id}-t`} name="template" value={pick} onChange={(e) => setPick(e.target.value)} className={input}>
          <option value="">Pilih template yang disetujui</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id} disabled={t.category === "marketing" && marketingBlocked}>
              {`${t.name} · ${CATEGORY[t.category] ?? t.category}${t.category === "marketing" && marketingBlocked ? " (pasien tidak setuju promosi)" : ""}`}
            </option>
          ))}
        </select>
        {chosen && <p className={hint}>{chosen.body}</p>}
        {chosen && Array.from({ length: chosen.param_count }, (_, i) => (
          <div key={i} className="grid min-w-0 gap-1">
            <label htmlFor={`${id}-p${i}`}>{`Isian {{${i + 1}}}`}</label>
            <input id={`${id}-p${i}`} name="param" required maxLength={200} className={input} />
          </div>
        ))}
        <Notice s={ts} />
        <Button type="submit" variant={windowOpen ? "secondary" : "default"} aria-disabled={tpending || !pick} className="justify-self-start">Kirim Template</Button>
      </form>
    </section>
  );
}

// Tugaskan / Ambil / Lepas / Arahkan / Selesai / Buka Lagi.
export function ConversationActions({ ctx, conversation, assigned, state, branchOptions, unrouted }: {
  ctx: RenderedContext; conversation: string; assigned: boolean; state: string; branchOptions: { id: string; name: string }[]; unrouted: boolean;
}) {
  const [s, act, pending] = useActionState<PesanState, FormData>(conversationAction, {});
  const id = useId();
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label="Kelola percakapan" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><input type="hidden" name="conversation" value={conversation} />
      {unrouted && branchOptions.length > 0 && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-b`}>Arahkan ke cabang</label>
          <select id={`${id}-b`} name="target" defaultValue="" className={input}>
            <option value="">Pilih cabang</option>
            {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        {unrouted && branchOptions.length > 0 && <Button type="submit" name="action" value="route" variant="secondary" aria-disabled={pending}>Arahkan</Button>}
        {assigned && <Button type="submit" name="action" value="unassign" variant="secondary" aria-disabled={pending}>Lepas</Button>}
        {state === "open"
          ? <Button type="submit" name="action" value="close" variant="secondary" aria-disabled={pending}>Tandai Selesai</Button>
          : <Button type="submit" name="action" value="reopen" variant="secondary" aria-disabled={pending}>Buka Lagi</Button>}
      </div>
    </form>
  );
}

// Ambil: assign the conversation to oneself.
export function TakeForm({ ctx, conversation, me }: { ctx: RenderedContext; conversation: string; me: string }) {
  const [s, act, pending] = useActionState<PesanState, FormData>(conversationAction, {});
  return (
    <form action={act} key={`a${s.n ?? 0}`} aria-label="Ambil percakapan" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><input type="hidden" name="conversation" value={conversation} />
      <input type="hidden" name="action" value="assign" /><input type="hidden" name="target" value={me} />
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Ambil</Button>
    </form>
  );
}

// Templat: a neutral draft (W-05) and the sync.
export function TemplateForms({ ctx }: { ctx: RenderedContext }) {
  const [s, act, pending] = useActionState<PesanState, FormData>(saveTemplateAction, {});
  const [ss, sact, spending] = useActionState<PesanState, FormData>(syncTemplatesAction, {});
  const id = useId();
  const v = s.values ?? {};
  return (
    <div className="grid min-w-0 gap-3">
      <form action={sact} key={`s${ss.n ?? 0}`} aria-label="Sinkronkan template" className="grid min-w-0 gap-2">
        <ContextFields ctx={ctx} />
        <Notice s={ss} />
        <Button type="submit" variant="secondary" aria-disabled={spending} className="justify-self-start">Sinkronkan dari Meta</Button>
      </form>
      <form action={act} key={`d${s.n ?? 0}`} aria-label="Draf template" className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
        <ContextFields ctx={ctx} /><Key />
        <h2 className="m-0 text-[1.25rem] font-semibold">Draf Template</h2>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-n`}>Nama</label>
          <input id={`${id}-n`} name="name" required maxLength={128} defaultValue={v.name ?? ""} aria-describedby={`${id}-n-h`} className={input} />
          <p id={`${id}-n-h`} className={hint}>Huruf kecil, angka dan garis bawah, contoh pengingat_janji.</p>
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-c`}>Kategori</label>
          <select id={`${id}-c`} name="category" defaultValue={v.category ?? "utility"} className={input}>
            {Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-b`}>Isi</label>
          <textarea id={`${id}-b`} name="body" rows={3} maxLength={1024} required defaultValue={v.body ?? ""} aria-describedby={`${id}-b-h`} className={`${input} py-2`} />
          <p id={`${id}-b-h`} className={hint}>Tanpa diagnosis, tindakan, obat atau foto. Isian ditulis {"{{1}}"}, {"{{2}}"}, dan seterusnya.</p>
        </div>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Draf</Button>
      </form>
    </div>
  );
}
