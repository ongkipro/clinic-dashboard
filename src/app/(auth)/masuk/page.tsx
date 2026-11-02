import { SignInForm } from "./sign-in-form";
import s from "../auth.module.css";

export default function MasukPage() {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <h1 className={s.title}>Masuk</h1>
        <p className={s.lead}>Gunakan akun staf dari undangan klinik Anda.</p>
        <SignInForm />
      </div>
    </main>
  );
}
