// Clinic app layout (PR-86, NAV-3): every clinic page renders inside the shell, and the
// shell's server data runs the session gates and context resolution on each request
// (STATUS carried-forward: checkSession + resolveContext on every clinic page).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BlockedState, LoadingList } from "../../components/ui/states";
import { loadShell } from "../../components/shell/data";
import { Shell, SignOut } from "../../components/shell/shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

async function Gated({ children }: { children: React.ReactNode }) {
  const data = await loadShell();
  if (data.kind === "redirect") redirect(data.to);
  if (data.kind === "blocked") {
    return (
      <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
        <BlockedState reason="Akun Anda belum punya peran atau cabang aktif" unblock="Owner atau Admin Pusat klinik Anda dapat menambahkannya" />
        <SignOut className="mt-3 inline-flex min-h-[var(--target)] items-center rounded-full px-5 font-semibold text-[var(--danger)]" />
      </main>
    );
  }
  return <Shell {...data.context}>{children}</Shell>;
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    // The fallback is static: nothing request-specific renders before the gate passes.
    <Suspense
      fallback={
        <div style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
          <LoadingList rows={4} label="Memuat" />
        </div>
      }
    >
      <Gated>{children}</Gated>
    </Suspense>
  );
}
