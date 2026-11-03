import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";
import s from "../auth.module.css";

// After accepting an invitation (UX-3) the person lands here with a confirmation.
async function Accepted({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return q.undangan === "diterima" ? (
    <p className={s.success} role="status">
      Undangan diterima. Masuk dengan email dan kata sandi baru Anda.
    </p>
  ) : null;
}

export default function MasukPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <h1 className={s.title}>Masuk</h1>
        <p className={s.lead}>Gunakan akun staf dari undangan klinik Anda.</p>
        <Suspense>
          <Accepted searchParams={searchParams} />
        </Suspense>
        <SignInForm />
      </div>
    </main>
  );
}
