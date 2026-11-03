"use client";
import { useActionState } from "react";
import { type AcceptState, acceptAction } from "./actions";
import s from "../../auth.module.css";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptAction, {});
  return (
    <form className={s.group} action={action}>
      {state.error && (
        <p className={s.error} role="alert">
          {state.error}
        </p>
      )}
      <input type="hidden" name="token" value={token} />
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
        <input className={s.input} id="password" name="password" type="password" autoComplete="new-password" minLength={15} required />
        <p className={s.help}>Minimal 15 karakter. Boleh berupa beberapa kata.</p>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="confirm">
          Ulangi kata sandi
        </label>
        <input className={s.input} id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={15} required />
      </div>
      <button className={s.primary} type="submit" aria-disabled={pending}>
        {pending ? "Menyimpan…" : "Terima Undangan"}
      </button>
    </form>
  );
}
