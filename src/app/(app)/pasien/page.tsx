// Daftar Pasien (PR-76, 19:75, T-041): search and filters for the 13 identity readers (the query posted,
// never in a URL); marketing sees only its consented contacts (masked phone, no profile link); purchasing
// and auditor get the permission state. Results carry no clinical content.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../components/templates/templates";
import { EmptyState, LoadingList, PermissionState } from "../../../components/ui/states";
import { loadDaftar } from "./_components/data";
import { PatientList } from "./_components/list";

export const metadata: Metadata = { title: "Daftar Pasien — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}

async function Body() {
  const d = await loadDaftar();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <Shell><PageTitle title="Daftar Pasien" /><PermissionState object="daftar pasien" /></Shell>;
  if (d.kind === "marketing") {
    return (
      <Shell>
        <PageTitle title="Daftar Pasien" />
        <p className={muted}>Hanya kontak yang menyetujui pesan promo WhatsApp.</p>
        {d.contacts.length === 0 ? <EmptyState message="Belum ada kontak yang menyetujui promosi." /> : (
          <ul className="m-0 grid min-w-0 list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
            {d.contacts.map((c) => (
              <li key={c.id} className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
                <span className="font-semibold [overflow-wrap:anywhere]">{c.fullName}</span>
                <span className={muted}>{c.phone ?? "Tanpa nomor HP"}</span>
              </li>
            ))}
          </ul>
        )}
      </Shell>
    );
  }
  return (
    <Shell>
      <PageTitle title="Daftar Pasien" />
      {["fo_cashier", "central_cs"].includes(d.role) && <div><Link className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]" href="/pasien/baru">Daftarkan Pasien Baru</Link></div>}
      <PatientList ctx={d.ctx} branches={d.branches.map((b) => ({ id: b.id, name: b.name }))} segments={d.segments} />
    </Shell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Shell><PageTitle title="Daftar Pasien" /><LoadingList label="Memuat daftar pasien" /></Shell>}>
      <Body />
    </Suspense>
  );
}
