// App host root ("/", PR-84 / PR-86 / 19 §2.18): resolves the active session & role
// context and sends staff straight to their role's landing page (or to /masuk,
// /aktifkan-2fa, /terkunci when a session gate applies). Keeps a static Suspense shell
// so cacheComponents builds cleanly and renders no tenant data.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadShell } from "../components/shell/data";
import { landingFor } from "../components/shell/nav";
import { SignOut } from "../components/shell/shell";
import { BlockedState, LoadingList } from "../components/ui/states";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false } };

async function HomeGate() {
  await connection();
  if (!process.env.AUTH_DATABASE_URL || !process.env.APP_DATABASE_URL) {
    return (
      <main className="mx-auto grid w-full max-w-[560px] gap-4 p-4">
        <p>KlinikMu</p>
      </main>
    );
  }
  const data = await loadShell();
  if (data.kind === "redirect") redirect(data.to);
  if (data.kind === "blocked") {
    return (
      <main className="mx-auto grid w-full max-w-[560px] gap-4 p-4">
        <BlockedState
          reason="Akun Anda belum punya peran atau cabang aktif"
          unblock="Owner atau Admin Pusat klinik Anda dapat menambahkannya"
        />
        <SignOut className="mt-3 inline-flex min-h-[var(--target)] items-center rounded-full px-5 font-semibold text-[var(--danger)]" />
      </main>
    );
  }
  redirect(landingFor(data.context.role).href);
}

export default async function Home() {
  await connection();
  return (
    <Suspense
      fallback={
        <main className="mx-auto grid w-full max-w-[560px] gap-4 p-4">
          <LoadingList rows={4} label="Memuat" />
        </main>
      }
    >
      <HomeGate />
    </Suspense>
  );
}
