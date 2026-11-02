"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callAuth } from "../client";
import s from "../auth.module.css";

export function VerifyForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true);
    setError(undefined);
    const r = await callAuth(backup ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp", { code });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    router.replace("/");
  }

  return (
    <form className={s.group} onSubmit={onSubmit}>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.field}>
        <label className={s.label} htmlFor="code">
          {backup ? "Kode cadangan" : "Kode 6 digit"}
        </label>
        <input
          className={`${s.input} ${backup ? "" : s.code}`}
          id="code"
          name="code"
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          pattern={backup ? undefined : "[0-9 ]{6,7}"}
          required
          key={backup ? "backup" : "totp"}
        />
        <p className={s.help}>
          {backup ? "Setiap kode cadangan hanya bisa dipakai sekali." : "Buka aplikasi autentikator di ponsel Anda."}
        </p>
      </div>
      <button className={s.primary} type="submit" aria-disabled={busy}>
        {busy ? "Memeriksa…" : "Verifikasi"}
      </button>
      <button className={s.secondary} type="button" onClick={() => setBackup(!backup)}>
        {backup ? "Pakai kode autentikator" : "Pakai kode cadangan"}
      </button>
    </form>
  );
}
