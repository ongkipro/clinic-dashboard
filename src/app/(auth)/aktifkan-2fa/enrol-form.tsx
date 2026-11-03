"use client";
import { useState } from "react";
import { callAuth } from "../client";
import s from "../auth.module.css";

type Setup = { uri: string; secret: string; backupCodes: string[] };

// IAM-1 / PR-3: enrol an authenticator app. Step 1 re-checks the password and returns
// the otpauth URI and backup codes; step 2 confirms one code, which marks the factor
// verified. Lazy: no QR image (no extra dependency); the otpauth link opens the
// authenticator on phones and the secret can be typed on other devices.
export function EnrolForm({ base, home = "/" }: { base?: string; home?: string }) {
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const r = await callAuth("/two-factor/enable", {
      password: String(new FormData(event.currentTarget).get("password") ?? ""),
    }, base);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    const uri = String(r.data.totpURI ?? "");
    setSetup({
      uri,
      secret: new URL(uri).searchParams.get("secret") ?? "",
      backupCodes: (r.data.backupCodes as string[]) ?? [],
    });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const r = await callAuth("/two-factor/verify-totp", { code }, base);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    // The session just changed: a full load, so no page cached by the client router under
    // the previous session (e.g. a redirect to enrolment) is reused.
    window.location.replace(home);
  }

  const alert = error && (
    <p className={s.error} role="alert">
      {error}
    </p>
  );

  if (!setup) {
    return (
      <form className={s.group} onSubmit={start}>
        {alert}
        <div className={s.field}>
          <label className={s.label} htmlFor="password">
            Kata sandi
          </label>
          <input className={s.input} id="password" name="password" type="password" autoComplete="current-password" required />
          <p className={s.help}>Masukkan ulang kata sandi untuk memulai.</p>
        </div>
        <button className={s.primary} type="submit" aria-disabled={busy}>
          {busy ? "Memeriksa…" : "Lanjut"}
        </button>
      </form>
    );
  }

  return (
    <form className={s.group} onSubmit={confirm}>
      {alert}
      <div className={s.field}>
        <span className={s.label}>1. Tambahkan ke aplikasi autentikator</span>
        <a className={s.secondary} href={setup.uri}>
          Buka aplikasi autentikator
        </a>
        <p className={s.help}>Atau ketik kunci ini secara manual:</p>
        <p className={s.secret} aria-label="Kunci autentikator">
          {setup.secret}
        </p>
      </div>
      <div className={s.field}>
        <span className={s.label}>2. Simpan kode cadangan</span>
        <ul className={s.codes} aria-label="Kode cadangan">
          {setup.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className={s.help}>Simpan di tempat aman. Setiap kode hanya bisa dipakai sekali.</p>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="code">
          3. Masukkan kode 6 digit
        </label>
        <input className={`${s.input} ${s.code}`} id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required />
      </div>
      <button className={s.primary} type="submit" aria-disabled={busy}>
        {busy ? "Memeriksa…" : "Aktifkan"}
      </button>
    </form>
  );
}
