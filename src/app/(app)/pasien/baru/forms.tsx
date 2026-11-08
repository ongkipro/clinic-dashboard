"use client";
// Pendaftaran Pasien forms (UX-4, PR-5, T-037): "Cari dulu" (phone, name, No. RM, NIK), the new-patient
// form (Permenkes identity and social data, guardian for minors), the duplicate step (Pilih / Buat Baru)
// and the result. The identity number field is never refilled from the server (plan r1 P1-2): after a
// pause the form carries only the sealed pair and shows the masked number. Fields remount from the
// returned values after every submit (the T-035 lesson), so what is shown is what is posted.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { Match } from "../../../../modules/patients/patients";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { registerAction, type RegisterState, searchAction, type SearchState } from "./actions";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hintCls = "text-[0.88rem] text-[var(--label-2)]";

export const RELIGION = { islam: "Islam", kristen: "Kristen", katolik: "Katolik", hindu: "Hindu", buddha: "Buddha", konghucu: "Konghucu", lainnya: "Lainnya" };
export const EDUCATION = { tidak_sekolah: "Tidak sekolah", sd: "SD", smp: "SMP", sma: "SMA/SMK", diploma: "Diploma", s1: "S1", s2: "S2", s3: "S3", lainnya: "Lainnya" };
export const MARITAL = { belum_kawin: "Belum kawin", kawin: "Kawin", cerai_hidup: "Cerai hidup", cerai_mati: "Cerai mati" };
const IDENTITY = { nik: "NIK (KTP/KK)", passport: "Paspor", kitas: "KITAS/KITAP", newborn_via_guardian: "Bayi baru lahir (lewat wali)" };
const RELATION = { ayah: "Ayah", ibu: "Ibu", wali: "Wali", lainnya: "Lainnya" };

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string, hintId?: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      {children(id, hint ? `${id}-h` : undefined)}
      {hint && <span id={`${id}-h`} className={hintCls}>{hint}</span>}
    </div>
  );
}
function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-3 rounded-[var(--radius-group)] border-0 bg-[var(--surface)] p-4">
      <legend className="float-left mb-1 w-full text-[1.1rem] font-semibold">{title}</legend>
      {note && <p className={`m-0 ${hintCls}`}>{note}</p>}
      {children}
    </fieldset>
  );
}
function MatchList({ label, matches }: { label: string; matches: Match[] }) {
  return (
    <ul aria-label={label} className="m-0 grid list-none gap-2 p-0">
      {matches.map((m) => (
        <li key={m.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
          <span className="font-semibold [overflow-wrap:anywhere]">{m.fullName}</span>
          <span className={`${hintCls} [overflow-wrap:anywhere]`}>{m.mrn} · lahir {m.birthYear}{m.maskedPhone ? ` · ${m.maskedPhone}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export function SearchFirst({ ctx }: { ctx: RenderedContext }) {
  const [state, action, pending] = useActionState<SearchState, FormData>(searchAction, {});
  return (
    <form action={action} className="@container grid min-w-0 gap-3" aria-label="Cari pasien dulu">
      <ContextFields ctx={ctx} />
      <div className="grid min-w-0 gap-3 @[32rem]:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <Field label="Cari berdasarkan">
          {(id) => (
            <select id={id} className={input} name="by" defaultValue={state.values?.by ?? "phone"} key={`by-${state.values?.by ?? ""}`}>
              <option value="phone">Nomor HP</option>
              <option value="name">Nama</option>
              <option value="mrn">No. RM</option>
              <option value="nik">NIK</option>
            </select>
          )}
        </Field>
        <Field label="Kata pencarian">
          {(id) => <input id={id} className={input} name="q" autoComplete="off" />}
        </Field>
      </div>
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      {state.searched && (state.matches?.length
        ? <MatchList label="Hasil pencarian" matches={state.matches} />
        : <p role="status" className="m-0">Belum ada pasien yang cocok. Daftarkan sebagai pasien baru di bawah.</p>)}
      <div><Button type="submit" variant="plain" aria-disabled={pending}>Cari Dulu</Button></div>
    </form>
  );
}

type Branch = { id: string; name: string };

export function RegisterForm({ ctx, branches, needsBranch }: { ctx: RenderedContext; branches: Branch[]; needsBranch: boolean }) {
  const [state, action, pending] = useActionState<RegisterState & { n: number }, FormData>(
    async (prev, f) => ({ ...(await registerAction(prev, f)), n: prev.n + 1 }),
    { n: 0 },
  );
  if (state.done) {
    return (
      <div role="status" className="grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
        <p className="m-0 text-[1.1rem] font-semibold">Pasien terdaftar</p>
        <p className="m-0">{state.done.name} · <span className="font-semibold">{state.done.mrn}</span></p>
        <p className={`m-0 ${hintCls}`}>Persetujuan pasien dicatat pada langkah berikutnya (segera tersedia).</p>
        <Link href="/pasien/baru" className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">Daftarkan pasien lain</Link>
      </div>
    );
  }
  return <RegisterFields key={state.n} ctx={ctx} branches={branches} needsBranch={needsBranch} state={state} action={action} pending={pending} />;
}

function RegisterFields({ ctx, branches, needsBranch, state, action, pending }: {
  ctx: RenderedContext; branches: Branch[]; needsBranch: boolean; state: RegisterState; action: (f: FormData) => void; pending: boolean;
}) {
  const v = state.values ?? {};
  const [type, setType] = useState(v.identity_type ?? "nik");
  const [birth, setBirth] = useState(v.birth_date ?? "");
  const minor = (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return false;
    const [y, m, d] = birth.split("-").map(Number);
    const now = new Date();
    const eighteen = new Date(y + 18, m - 1, d);
    return eighteen > now;
  })();
  const pause = state.pause;
  const sealed = pause?.sealed ?? null;
  const showGuardian = minor || type === "newborn_via_guardian" || !!v.g_name;
  return (
    <form action={action} className="grid min-w-0 gap-4" aria-label="Pasien baru">
      <ContextFields ctx={ctx} />
      {pause && (
        <div role="alert" className="grid min-w-0 gap-3 rounded-[var(--radius-group)] border border-[var(--warning)] bg-[var(--surface)] p-4">
          {pause.code === "duplicate_identity" ? (
            <>
              <p className="m-0 font-semibold">Nomor identitas ini sudah terdaftar. Gunakan data pasien yang ada.</p>
              <MatchList label="Pasien dengan identitas yang sama" matches={pause.matches} />
            </>
          ) : (
            <>
              <p className="m-0 font-semibold">Nomor HP dipakai pasien lain — pilih atau buat baru</p>
              <MatchList label="Pasien yang mirip" matches={pause.matches} />
              <p className={`m-0 ${hintCls}`}>Bila orang yang sama, gunakan data pasien di atas. Bila orang berbeda, tekan Buat Baru.</p>
              {sealed && (
                <>
                  <input type="hidden" name="sealed_enc" value={sealed.enc} />
                  <input type="hidden" name="sealed_bidx" value={sealed.bidx} />
                </>
              )}
              <input type="hidden" name="decision" value="new" />
            </>
          )}
        </div>
      )}
      <Group title="Identitas" note="Data minimum rekam medis (Permenkes 24/2022 Pasal 14).">
        {needsBranch && (
          <Field label="Cabang pendaftaran">
            {(id) => (
              <select id={id} className={input} name="branch_id" defaultValue={v.branch_id ?? branches[0]?.id ?? ""}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </Field>
        )}
        <Field label="Nama lengkap">{(id) => <input id={id} className={input} name="full_name" defaultValue={v.full_name ?? ""} autoComplete="off" />}</Field>
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <Field label="Tanggal lahir">{(id) => <input id={id} className={input} type="date" name="birth_date" value={birth} onChange={(e) => setBirth(e.target.value)} />}</Field>
          <Field label="Jenis kelamin">
            {(id) => (
              <select id={id} className={input} name="sex" defaultValue={v.sex ?? ""}>
                <option value="">Pilih</option>
                <option value="female">Perempuan</option>
                <option value="male">Laki-laki</option>
              </select>
            )}
          </Field>
        </div>
        <Field label="Nomor HP (WhatsApp)" hint="Satu nomor boleh dipakai beberapa pasien (misalnya keluarga).">
          {(id, h) => <input id={id} aria-describedby={h} className={input} name="phone" inputMode="tel" defaultValue={v.phone ?? ""} autoComplete="off" />}
        </Field>
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <Field label="Jenis identitas">
            {(id) => (
              <select id={id} className={input} name="identity_type" value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(IDENTITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </Field>
          {type !== "newborn_via_guardian" && (sealed ? (
            <Field label="Nomor identitas" hint="Tersimpan terenkripsi; tidak ditampilkan ulang.">
              {(id, h) => <input id={id} aria-describedby={h} className={input} value={sealed.masked} readOnly />}
            </Field>
          ) : (
            <Field label={type === "nik" ? "NIK (16 digit)" : "Nomor identitas"} hint="Disimpan terenkripsi.">
              {(id, h) => <input id={id} aria-describedby={h} className={input} name="identity_number" inputMode={type === "nik" ? "numeric" : "text"} autoComplete="off" />}
            </Field>
          ))}
        </div>
        {type !== "nik" && (
          <Field label="Alasan tanpa NIK">{(id) => <input id={id} className={input} name="no_identity_reason" defaultValue={v.no_identity_reason ?? ""} />}</Field>
        )}
        <Field label="Alamat">{(id) => <input id={id} className={input} name="address" defaultValue={v.address ?? ""} autoComplete="off" />}</Field>
      </Group>
      <Group title="Data sosial" note="Wajib menurut Permenkes 24/2022 Pasal 14 ayat (4).">
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <Field label="Agama">
            {(id) => (
              <select id={id} className={input} name="religion" defaultValue={v.religion ?? ""}>
                <option value="">Pilih</option>
                {Object.entries(RELIGION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </Field>
          <Field label="Pekerjaan">{(id) => <input id={id} className={input} name="occupation" defaultValue={v.occupation ?? ""} />}</Field>
          <Field label="Pendidikan">
            {(id) => (
              <select id={id} className={input} name="education" defaultValue={v.education ?? ""}>
                <option value="">Pilih</option>
                {Object.entries(EDUCATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </Field>
          <Field label="Status perkawinan">
            {(id) => (
              <select id={id} className={input} name="marital_status" defaultValue={v.marital_status ?? ""}>
                <option value="">Pilih</option>
                {Object.entries(MARITAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </Field>
        </div>
      </Group>
      {showGuardian && (
        <Group title="Wali" note={minor || type === "newborn_via_guardian" ? "Wajib untuk pasien di bawah 18 tahun dan bayi baru lahir." : "Opsional."}>
          <Field label="Nama wali">{(id) => <input id={id} className={input} name="g_name" defaultValue={v.g_name ?? ""} autoComplete="off" />}</Field>
          <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
            <Field label="Hubungan">
              {(id) => (
                <select id={id} className={input} name="g_relation" defaultValue={v.g_relation ?? "ibu"}>
                  {Object.entries(RELATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              )}
            </Field>
            <Field label="HP wali (opsional)">{(id) => <input id={id} className={input} name="g_phone" inputMode="tel" defaultValue={v.g_phone ?? ""} autoComplete="off" />}</Field>
          </div>
        </Group>
      )}
      <Group title="Persetujuan">
        <p className="m-0">Persetujuan pasien (layanan & rekam medis, foto klinis, pesan WhatsApp) dicatat setelah pendaftaran. Fitur ini segera tersedia.</p>
      </Group>
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        {pause?.code === "duplicate_decision_required"
          ? <Button type="submit" aria-disabled={pending}>Buat Baru</Button>
          : pause?.code === "duplicate_identity" ? null : <Button type="submit" aria-disabled={pending}>Daftarkan</Button>}
        {pause && <Link href="/pasien/baru" className="inline-flex min-h-[var(--target)] items-center px-3 font-semibold text-[var(--tint)]">Batal</Link>}
      </div>
    </form>
  );
}
