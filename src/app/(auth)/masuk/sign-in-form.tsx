"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callAuth } from "../client";
import s from "../auth.module.css";

export function SignInForm() {
  const router = useRouter();
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
    });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    router.replace(r.data.twoFactorRedirect ? "/verifikasi" : "/");
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
