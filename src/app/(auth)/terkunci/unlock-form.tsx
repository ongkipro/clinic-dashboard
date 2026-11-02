"use client";
import { useActionState } from "react";
import { unlockAction, type UnlockState } from "./actions";
import s from "../auth.module.css";

export function UnlockForm() {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockAction, {});
  return (
    <form className={s.group} action={action}>
      {state.error && (
        <p className={s.error} role="alert">
          {state.error}
        </p>
      )}
      <div className={s.field}>
        <label className={s.label} htmlFor="password">
          Kata sandi
        </label>
        <input className={s.input} id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      </div>
      <button className={s.primary} type="submit" aria-disabled={pending}>
        {pending ? "Memeriksa…" : "Buka Kunci"}
      </button>
    </form>
  );
}
