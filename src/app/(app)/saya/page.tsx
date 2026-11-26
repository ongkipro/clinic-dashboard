// Saya hub (PR-84, PR-86, 19 §2.16): landing destination after switching clinic, role or
// branch (switchAction redirects here). Shows the active context, a direct link to the
// acting role's landing page, and the role-filtered Saya links.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { loadShell } from "../../../components/shell/data";
import { landingFor, sayaFor } from "../../../components/shell/nav";
import { BlockedState, LoadingList } from "../../../components/ui/states";

export const metadata: Metadata = { title: "Saya — Clinic Dashboard" };

async function SayaBody() {
  const data = await loadShell();
  if (data.kind === "redirect") redirect(data.to);
  if (data.kind === "blocked") {
    return (
      <BlockedState
        reason="Akun Anda belum punya peran atau cabang aktif"
        unblock="Owner atau Admin Pusat klinik Anda dapat menambahkannya"
      />
    );
  }
  const c = data.context;
  const landing = landingFor(c.role);
  const branchName = c.activeBranchId
    ? c.branches.find((b) => b.id === c.activeBranchId)?.name ?? "Cabang"
    : "Semua Cabang";
  const items = sayaFor(c.role, {
    roles: c.canSwitchRole,
    branches: c.branches.length > 1,
    clinics: c.canSwitchClinic,
  });

  return (
    <div className="grid gap-4">
      <p className="m-0 text-[var(--label-2)]" data-slot="active-context">
        Aktif: {c.clinic} · {branchName} · Sebagai {c.roleLabel}
      </p>
      <div>
        <Link
          href={landing.href}
          prefetch={false}
          className="inline-flex min-h-[50px] items-center justify-center rounded-full bg-[var(--tint)] px-6 font-semibold text-[var(--on-tint)] no-underline"
        >
          Buka {landing.label}
        </Link>
      </div>
      <ul className="m-0 grid list-none overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
        {items.map((p) => (
          <li
            key={p.id}
            className="border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px]"
          >
            <Link
              href={p.href}
              prefetch={false}
              className="flex min-h-[var(--target)] items-center justify-between px-4 py-[11px] text-[var(--label)] no-underline hover:bg-[var(--surface-2)]"
            >
              <span>{p.label}</span>
              <span aria-hidden="true" className="text-[var(--label-2)]">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SayaPage() {
  return (
    <main className="mx-auto grid w-full max-w-[640px] min-w-0 gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Saya</h1>
      <Suspense fallback={<LoadingList rows={5} label="Memuat" />}>
        <SayaBody />
      </Suspense>
    </main>
  );
}
