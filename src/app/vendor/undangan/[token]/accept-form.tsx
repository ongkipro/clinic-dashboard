"use client";
import { useState } from "react";
import s from "../../_lib/console.module.css";

const COPY: Record<string, string> = {
  ACCOUNT_EXISTS: "Email ini sudah punya akun. Minta Pemilik Platform mengundang email lain.",
  ERR_NOT_FOUND: "Undangan sudah tidak berlaku. Minta undangan baru ke Pemilik Platform.",
};

export function MemberAcceptForm({ token, email }: { token: string; email: string }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const f = new FormData(event.currentTarget);
    const password = String(f.get("password") ?? "");
    if (password !== String(f.get("confirm") ?? "")) return setError("Kedua kata sandi tidak sama.");
    setBusy(true);
    setError(undefined);
    const res = await fetch("/vendor/api/console/staff-invite-accept", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Koneksi terputus. Coba Lagi.");
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; message?: string };
    if (res.ok && data.ok) return window.location.replace("/vendor/masuk");
    setError(data.code === "PASSWORD_POLICY" && data.message ? data.message : (COPY[String(data.code)] ?? "Permintaan tidak dapat diproses. Coba Lagi."));
  }

  return (
    <form className={s.form} onSubmit={submit}>
      {error && (
        <p className={s.alert} role="alert">
          {error}
        </p>
      )}
      <div className={s.field}>
        <label className={s.label} htmlFor="email">
          Email
        </label>
        <input className={s.input} id="email" type="email" value={email} readOnly autoComplete="username" />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="password">
          Kata sandi baru
        </label>
        <input className={s.input} id="password" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required />
        <p className={s.help}>Minimal 15 karakter. Boleh berupa beberapa kata.</p>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="confirm">
          Ulangi kata sandi
        </label>
        <input className={s.input} id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={15} maxLength={128} required />
      </div>
      <button className={s.primary} type="submit" aria-disabled={busy}>
        {busy ? "Menyimpan…" : "Terima Undangan"}
      </button>
    </form>
  );
}
