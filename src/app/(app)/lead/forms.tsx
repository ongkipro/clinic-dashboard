"use client";
// Lead forms (UX-18; T-092). Every write form posts its rendered context (HYG-009 B2-1) and, where the command is keyed, a fresh idempotency
// key (remounted after every answer: n). The database decides authority and the facts behind each step (DEC-104).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { campaignAction, createLeadAction, type LeadState, leadUpdateAction, stageAction } from "./actions";
import { CHANNEL, LOST, SOURCE } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
type Opt = { id: string; name: string };

function Notice({ s }: { s: LeadState }) {
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
function F({ id, label, children, help }: { id: string; label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <p id={`${id}-h`} className={hint}>{help}</p>}
    </div>
  );
}
function Sheet({ label, open: initial, children }: { label: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!initial);
  if (!open) return <Button type="button" onClick={() => setOpen(true)} className="justify-self-start">{label}</Button>;
  return (
    <section aria-label={label} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 min-w-0 text-[1.25rem] font-semibold">{label}</h2>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
      {children}
    </section>
  );
}

export function CreateLeadForm({ ctx, campaigns }: { ctx: RenderedContext; campaigns: Opt[] }) {
  const [s, act, pending] = useActionState<LeadState, FormData>(createLeadAction, {});
  const v = s.values ?? {};
  const id = useId();
  return (
    <Sheet label="Tambah Lead" open={!!s.error}>
      <form action={act} key={`c${s.n ?? 0}`} aria-label="Tambah lead" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <F id={`${id}-n`} label="Nama kontak"><input id={`${id}-n`} name="contact_name" required maxLength={120} defaultValue={v.contact_name ?? ""} className={input} /></F>
        <F id={`${id}-p`} label="Telepon (opsional)" help="Diawali +62, contoh +6281234567890.">
          <input id={`${id}-p`} name="contact_phone" inputMode="tel" defaultValue={v.contact_phone ?? ""} aria-describedby={`${id}-p-h`} className={input} />
        </F>
        <F id={`${id}-s`} label="Sumber">
          <select id={`${id}-s`} name="source" defaultValue={v.source ?? "walk_in"} className={input}>
            {Object.entries(SOURCE).filter(([k]) => k !== "whatsapp").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </F>
        {campaigns.length > 0 && (
          <F id={`${id}-k`} label="Kampanye (opsional)">
            <select id={`${id}-k`} name="campaign" defaultValue={v.campaign ?? ""} className={input}>
              <option value="">Tanpa kampanye</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </F>
        )}
        <p className={hint}>Lead dari WhatsApp dibuat dari percakapan di Pesan.</p>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Lead</Button>
      </form>
    </Sheet>
  );
}

// Ubah Status: the next step (the database checks its fact), Tandai Hilang, Buka Kembali.
export function StageForms({ ctx, lead, stage, next, ready, blocker }: {
  ctx: RenderedContext; lead: string; stage: string; next?: { to: string; label: string }; ready: boolean; blocker: string | null;
}) {
  const [s, act, pending] = useActionState<LeadState, FormData>(stageAction, {});
  const [ls, lact, lpending] = useActionState<LeadState, FormData>(stageAction, {});
  const [reason, setReason] = useState("");
  const id = useId();
  if (stage === "lost") {
    return (
      <form action={act} key={`r${s.n ?? 0}`} aria-label="Buka kembali lead" className="grid min-w-0 gap-2">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="lead" value={lead} /><input type="hidden" name="to" value="new" />
        <Notice s={s} />
        <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Buka Kembali</Button>
      </form>
    );
  }
  if (stage === "converted") return null;
  return (
    <div className="grid min-w-0 gap-3">
      {next && (
        <form action={act} key={`n${s.n ?? 0}`} aria-label="Tahap berikutnya" className="grid min-w-0 gap-2">
          <ContextFields ctx={ctx} /><Key /><input type="hidden" name="lead" value={lead} /><input type="hidden" name="to" value={next.to} />
          {!ready && blocker && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--warning-soft)] px-3 py-2">{blocker}</p>}
          <Notice s={s} />
          <Button type="submit" aria-disabled={pending} className="justify-self-start">{next.label}</Button>
        </form>
      )}
      <form action={lact} key={`l${ls.n ?? 0}`} aria-label="Tandai hilang" className="grid min-w-0 gap-2">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="lead" value={lead} /><input type="hidden" name="to" value="lost" />
        <F id={`${id}-r`} label="Alasan hilang">
          <select id={`${id}-r`} name="reason" value={reason} onChange={(e) => setReason(e.target.value)} className={input}>
            <option value="">Pilih alasan</option>
            {Object.entries(LOST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </F>
        {reason === "lainnya" && (
          <F id={`${id}-t`} label="Catatan"><textarea id={`${id}-t`} name="note" rows={2} maxLength={500} required className={`${input} py-2`} /></F>
        )}
        <Notice s={ls} />
        <Button type="submit" variant="secondary" aria-disabled={lpending || !reason} className="justify-self-start">Tandai Hilang</Button>
      </form>
    </div>
  );
}

// Penanganan: Ambil / Lepas, Arahkan ke Cabang, Pilih Kampanye.
export function HandlingForms({ ctx, lead, me, assignee, branchId, branches, campaigns, campaignId }: {
  ctx: RenderedContext; lead: string; me: string; assignee: string | null; branchId: string | null; branches: Opt[]; campaigns: Opt[]; campaignId: string | null;
}) {
  const [s, act, pending] = useActionState<LeadState, FormData>(leadUpdateAction, {});
  const id = useId();
  return (
    <div className="grid min-w-0 gap-3">
      <form action={act} key={`a${s.n ?? 0}`} aria-label="Penanganan lead" className="grid min-w-0 gap-2">
        <ContextFields ctx={ctx} /><input type="hidden" name="lead" value={lead} />
        <input type="hidden" name="action" value={assignee ? "unassign" : "assign"} /><input type="hidden" name="target" value={me} />
        <Notice s={s} />
        {(!assignee || assignee === me) && (
          <Button type="submit" variant={assignee ? "secondary" : "default"} aria-disabled={pending} className="justify-self-start">{assignee ? "Lepas" : "Ambil"}</Button>
        )}
      </form>
      {!branchId && branches.length > 0 && (
        <form action={act} key={`b${s.n ?? 0}`} aria-label="Arahkan ke cabang" className="grid min-w-0 gap-2">
          <ContextFields ctx={ctx} /><input type="hidden" name="lead" value={lead} /><input type="hidden" name="action" value="route" />
          <F id={`${id}-b`} label="Arahkan ke cabang">
            <select id={`${id}-b`} name="target" defaultValue="" className={input}>
              <option value="">Pilih cabang</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </F>
          <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Arahkan</Button>
        </form>
      )}
      {campaigns.length > 0 && (
        <form action={act} key={`k${s.n ?? 0}`} aria-label="Pilih kampanye" className="grid min-w-0 gap-2">
          <ContextFields ctx={ctx} /><input type="hidden" name="lead" value={lead} /><input type="hidden" name="action" value="campaign" />
          <F id={`${id}-k`} label="Kampanye">
            <select id={`${id}-k`} name="target" defaultValue={campaignId ?? ""} className={input}>
              <option value="">Tanpa kampanye</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </F>
          <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Simpan Kampanye</Button>
        </form>
      )}
    </div>
  );
}

// Cocokkan Pasien: Pilih on one search result (lead_update match; the database refuses a cluster that already has an open lead).
export function MatchForm({ ctx, lead, patient, name }: { ctx: RenderedContext; lead: string; patient: string; name: string }) {
  const [s, act, pending] = useActionState<LeadState, FormData>(leadUpdateAction, {});
  return (
    <form action={act} key={`p${s.n ?? 0}`} aria-label={`Cocokkan dengan ${name}`} className="grid min-w-0 gap-1">
      <ContextFields ctx={ctx} /><input type="hidden" name="lead" value={lead} /><input type="hidden" name="action" value="match" />
      <input type="hidden" name="target" value={patient} />
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Pilih</Button>
    </form>
  );
}

export function CampaignForm({ ctx }: { ctx: RenderedContext }) {
  const [s, act, pending] = useActionState<LeadState, FormData>(campaignAction, {});
  const v = s.values ?? {};
  const id = useId();
  return (
    <Sheet label="Tambah Kampanye" open={!!s.error}>
      <form action={act} key={`m${s.n ?? 0}`} aria-label="Tambah kampanye" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <F id={`${id}-n`} label="Nama"><input id={`${id}-n`} name="name" required maxLength={120} defaultValue={v.name ?? ""} className={input} /></F>
        <F id={`${id}-c`} label="Kode" help="Huruf kecil, angka, garis bawah atau tanda hubung, contoh promo-akhir-tahun.">
          <input id={`${id}-c`} name="code" required maxLength={41} defaultValue={v.code ?? ""} aria-describedby={`${id}-c-h`} className={input} />
        </F>
        <F id={`${id}-h`} label="Kanal">
          <select id={`${id}-h`} name="channel" defaultValue={v.channel ?? "instagram"} className={input}>
            {Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </F>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan</Button>
      </form>
    </Sheet>
  );
}
