"use client";
import { useState } from "react";
import { callAuth } from "../client";
import s from "../auth.module.css";

// Destinations and API base are props so the vendor console (SEC-21) reuses the form.
export function SignInForm({ base, home = "/", verify = "/verifikasi" }: { base?: string; home?: string; verify?: string }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    const r = await callAuth("/sign-in/email", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    }, base);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    // The session just changed: a full load, so no page cached by the client router under
    // the previous session (e.g. a redirect to enrolment) is reused.
    window.location.replace(r.data.twoFactorRedirect ? verify : home);
  }

  return (
    <form className={s.group} onSubmit={onSubmit} noValidate={false}>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.field}>
        <label className={s.label} htmlFor="email">
          Email
        </label>
        <input className={s.input} id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="password">
          Kata sandi
        </label>
        <input
          className={s.input}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={15}
          required
        />
      </div>
      <button className={s.primary} type="submit" aria-disabled={busy}>
        {busy ? "Memeriksa…" : "Masuk"}
      </button>
    </form>
  );
}
