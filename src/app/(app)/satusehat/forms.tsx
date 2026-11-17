"use client";
// SATUSEHAT forms (UX-23; T-102 increment 3). Every write form posts its rendered context (HYG-009 B2-1), the page's branch (cabang, for the
// redirect only — the database checks the branch of the object) and, for keyed commands, a fresh idempotency key (remounted after every
// answer: n). The client secret field is a password input that is never prefilled; the server seals it and never returns it.
import { useActionState, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { codeMapAction, credentialAction, practitionerAction, resendAction, resolveAction, revokeAction, roomAction, type SatusehatState } from "./actions";
import { RESEND } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
type Base = { ctx: RenderedContext; cabang: string };

function Notice({ s }: { s: SatusehatState }) {
  return s.error ? <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p> : null;
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Hidden({ ctx, cabang }: Base) {
  return <><ContextFields ctx={ctx} /><input type="hidden" name="cabang" value={cabang} /></>;
}

// Kirim Ulang: one closed reason (DEC-113 (7)); the database re-queues only items a person may re-send.
export function ResendForm({ ctx, cabang, visit, label }: Base & { visit: string; label: string }) {
  const [s, act, pending] = useActionState<SatusehatState, FormData>(resendAction, {});
  return (
    <form action={act} key={`r${visit}${s.n ?? 0}`} aria-label={`Kirim ulang ${label}`} className="grid min-w-0 gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-end">
      <Hidden ctx={ctx} cabang={cabang} /><input type="hidden" name="visit" value={visit} />
      <label className="grid gap-1">Alasan kirim ulang
        <select name="reason" required defaultValue="" className={input}>
          <option value="" disabled>Pilih alasan</option>
          {Object.entries(RESEND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <Button type="submit" variant="secondary" aria-disabled={pending}>Kirim Ulang</Button>
      <div className="min-[700px]:col-span-2"><Notice s={s} /></div>
    </form>
  );
}

// Identity review (records officer / facility head): the IHS number found by hand, or "cannot be resolved"; the evidence is required.
export function IdentityForm({ ctx, cabang, patient, name }: Base & { patient: string; name: string }) {
  const [s, act, pending] = useActionState<SatusehatState, FormData>(resolveAction, {});
  const [mode, setMode] = useState("resolve");
  return (
    <form action={act} key={`i${patient}${s.n ?? 0}`} aria-label={`Tinjau identitas ${name}`} className="grid min-w-0 gap-3">
      <Hidden ctx={ctx} cabang={cabang} /><input type="hidden" name="patient" value={patient} />
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-x-4 gap-y-1 border-0 p-0">
        <legend className="mb-1 p-0">Keputusan</legend>
        <label className="inline-flex min-h-[var(--target)] items-center gap-2"><input type="radio" name="mode" value="resolve" checked={mode === "resolve"} onChange={() => setMode("resolve")} />Nomor IHS ditemukan</label>
        <label className="inline-flex min-h-[var(--target)] items-center gap-2"><input type="radio" name="mode" value="unresolvable" checked={mode === "unresolvable"} onChange={() => setMode("unresolvable")} />Tidak dapat diselesaikan</label>
      </fieldset>
      {mode === "resolve" && <label className="grid gap-1">Nomor IHS pasien<input name="ihs" required pattern="[A-Za-z0-9\-]{3,64}" autoComplete="off" className={input} /></label>}
      <label className="grid gap-1">Dasar keputusan<input name="evidence" required minLength={3} maxLength={200} className={input} /></label>
      <p className={hint}>Tulis sumbernya, misalnya hasil cek di portal SATUSEHAT. Jangan tulis NIK atau isi rekam medis.</p>
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Simpan Keputusan</Button>
    </form>
  );
}

export function RoomForm({ ctx, cabang, visit, rooms }: Base & { visit: string; rooms: { id: string; name: string }[] }) {
  const [s, act, pending] = useActionState<SatusehatState, FormData>(roomAction, {});
  return (
    <form action={act} key={`m${visit}${s.n ?? 0}`} aria-label="Pilih ruang periksa" className="grid min-w-0 gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-end">
      <Hidden ctx={ctx} cabang={cabang} /><input type="hidden" name="visit" value={visit} />
      <label className="grid gap-1">Ruang periksa
        <select name="room" required defaultValue="" className={input}>
          <option value="" disabled>Pilih ruang</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <Button type="submit" variant="secondary" aria-disabled={pending}>Simpan Ruang</Button>
      <div className="min-[700px]:col-span-2"><Notice s={s} /></div>
    </form>
  );
}

// The practitioner's IHS number, entered by hand (DEC-113 (8)); a NIK lookup is not built.
export function PractitionerForm({ ctx, cabang, staff, name, ihs }: Base & { staff: string; name: string; ihs: string | null }) {
  const [s, act, pending] = useActionState<SatusehatState, FormData>(practitionerAction, {});
  return (
    <form action={act} key={`p${staff}${s.n ?? 0}`} aria-label={`Nomor IHS ${name}`} className="grid min-w-0 gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-end">
      <Hidden ctx={ctx} cabang={cabang} /><Key /><input type="hidden" name="staff" value={staff} />
      <label className="grid gap-1">Nomor IHS tenaga kesehatan
        <input name="ihs" required pattern="[A-Za-z0-9\-]{3,64}" defaultValue={ihs ?? ""} autoComplete="off" className={input} />
      </label>
      <Button type="submit" variant="secondary" aria-disabled={pending}>{ihs ? "Ganti Nomor" : "Simpan Nomor"}</Button>
      <div className="min-[700px]:col-span-2"><Notice s={s} /></div>
    </form>
  );
}

export function CodeMapForm({ ctx, cabang, item, name, map }: Base & { item: string; name: string; map: { code: string; display: string } | null }) {
  const [s, act, pending] = useActionState<SatusehatState, FormData>(codeMapAction, {});
  return (
    <form action={act} key={`c${item}${s.n ?? 0}`} aria-label={`Pemetaan ICD-9 CM untuk ${name}`} className="grid min-w-0 gap-2 min-[1180px]:grid-cols-[10rem_minmax(0,1fr)_auto] min-[1180px]:items-end">
      <Hidden ctx={ctx} cabang={cabang} /><Key /><input type="hidden" name="item" value={item} />
      <label className="grid gap-1">Kode ICD-9 CM<input name="code" required pattern="[0-9]{2}(\.[0-9]{1,2})?" defaultValue={map?.code ?? ""} inputMode="decimal" className={input} /></label>
      <label className="grid gap-1">Nama tindakan ICD-9 CM<input name="display" required minLength={2} maxLength={200} defaultValue={map?.display ?? ""} className={input} /></label>
      <Button type="submit" variant="secondary" aria-disabled={pending}>Simpan Kode</Button>
      <div className="min-[1180px]:col-span-3"><Notice s={s} /></div>
    </form>
  );
}

// Branch credentials (owner / Admin Pusat). The secret is typed, sent once, sealed on the server and never shown again.
export function CredentialForm({ ctx, cabang, environment }: Base & { environment: string }) {
  const [s, act, pending] = useActionState<SatusehatState, FormData>(credentialAction, {});
  return (
    <form action={act} key={`k${s.n ?? 0}`} aria-label="Kredensial cabang" className="grid min-w-0 gap-3" autoComplete="off">
      <Hidden ctx={ctx} cabang={cabang} /><Key /><input type="hidden" name="environment" value={environment} />
      <div className="grid min-w-0 gap-3 min-[820px]:grid-cols-3">
        <label className="grid gap-1">ID organisasi<input name="organization" required pattern="[A-Za-z0-9\-]{3,64}" className={input} /></label>
        <label className="grid gap-1">Client ID<input name="client" required minLength={3} maxLength={200} className={input} /></label>
        <label className="grid gap-1">Client secret<input name="secret" type="password" required minLength={8} maxLength={500} autoComplete="new-password" className={input} /></label>
      </div>
      <p className={hint}>Client secret disimpan terenkripsi dan tidak pernah ditampilkan lagi. Kredensial lama otomatis diganti.</p>
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Kredensial</Button>
    </form>
  );
}

export function RevokeForm({ ctx, cabang, credential }: Base & { credential: string }) {
  const [s, act, pending] = useActionState<SatusehatState, FormData>(revokeAction, {});
  const [sure, setSure] = useState(false);
  return (
    <form action={act} key={`v${credential}${s.n ?? 0}`} aria-label="Cabut kredensial" className="grid min-w-0 gap-2">
      <Hidden ctx={ctx} cabang={cabang} /><input type="hidden" name="credential" value={credential} />
      <label className="inline-flex min-h-[var(--target)] items-center gap-2"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />Saya paham pengiriman cabang ini berhenti sampai kredensial baru disimpan</label>
      <Notice s={s} />
      <Button type="submit" variant="destructive" aria-disabled={pending || !sure} disabled={!sure} className="justify-self-start">Cabut Kredensial</Button>
    </form>
  );
}
