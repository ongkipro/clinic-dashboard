"use client";
// Konsol Vendor › Templat Global save & activate form (UX-54 vendor scope; T-129 + HYG-024).
// Platform owner only; posts JSON to /vendor/api/console/template-save with 10-minute step-up & refusal states.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "../_lib/post";
import s from "../_lib/console.module.css";

const KINDS = [
  { value: "kebijakan-privasi", label: "Kebijakan Privasi" },
  { value: "syarat-ketentuan", label: "Syarat & Ketentuan" },
  { value: "kebijakan-pembatalan", label: "Kebijakan Pembatalan" },
] as const;

export function TemplateSaveForm() {
  const router = useRouter();
  const [kind, setKind] = useState<string>(KINDS[0].value);
  const [body, setBody] = useState("");
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await post("template-save", { kind, body, activate });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setBody("");
      const ver = typeof res.data.version === "number" ? `v${res.data.version}` : "versi baru";
      setNotice(`Templat ${ver} berhasil disimpan${res.data.isActive ? " dan diaktifkan" : ""}.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={onSubmit} aria-label="Simpan versi templat legal global">
      <div className={s.field}>
        <label className={s.label} htmlFor="tpl-kind">Jenis dokumen</label>
        <select id="tpl-kind" className={s.input} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="tpl-body">Isi templat (teks polos)</label>
        <textarea
          id="tpl-body"
          className={s.input}
          rows={5}
          required
          minLength={20}
          maxLength={50000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Tulis teks polos minimal 20 karakter. Token yang diizinkan: {{klinik.nama}}, {{klinik.alamat}}, {{klinik.kontak}}, {{klinik.email}}, {{vendor.nama}}."
        />
        <p className={s.help}>
          Token yang diizinkan: {"{{klinik.nama}}"}, {"{{klinik.alamat}}"}, {"{{klinik.kontak}}"}, {"{{klinik.email}}"}, {"{{vendor.nama}}"}. Tag HTML ditolak. Memerlukan verifikasi dua langkah ≤ 10 menit.
        </p>
      </div>
      <label className={s.check}>
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        <span>Aktifkan versi ini untuk situs publik</span>
      </label>
      {error ? <p className={s.alert} role="alert">{error}</p> : null}
      {notice ? <p className={s.notice} role="status">{notice}</p> : null}
      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={busy} aria-disabled={busy}>
          {busy ? "Menyimpan..." : "Simpan Versi Templat"}
        </button>
      </div>
    </form>
  );
}
