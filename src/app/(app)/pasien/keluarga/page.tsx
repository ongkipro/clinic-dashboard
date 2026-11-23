// Keluarga / Wali (19 §2.4, UX-29 ▸ Keluarga; HYG-NAV-2): guardian–child links recorded at registration, grouped per guardian, with an
// in-browser name / MRN filter (the text never leaves the page). FO only; read-only (guardians are recorded in Pendaftaran Pasien and
// never edited). Masked phones, no clinical content; each child links to its profile.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { loadKeluarga } from "./data";
import { Households } from "./list";
import { households } from "./model";

export const metadata: Metadata = { title: "Keluarga / Wali — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const Main = ({ children }: { children: React.ReactNode }) => <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</main>;

async function Body() {
  const p = await loadKeluarga();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Main><PageTitle title="Keluarga / Wali" /><PermissionState object="data keluarga dan wali" /></Main>;
  const all = households(p.links);
  return (
    <Main>
      <PageTitle title="Keluarga / Wali" />
      <p className={muted}>Wali dicatat saat Pendaftaran Pasien. Satu wali dapat mendampingi beberapa pasien; data klinis tiap pasien tetap terpisah.</p>
      {all.length === 0 ? (
        <div role="status" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--label-2)]">Belum ada wali tercatat.</p>
          <Link href="/pasien/baru" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Daftarkan Pasien</Link>
        </div>
      ) : <Households all={all} />}
      {/* lazy: the 200 newest links are loaded; a server-side guardian search (POST) arrives if a clinic outgrows it. */}
    </Main>
  );
}

export default function KeluargaPage() {
  return <Suspense fallback={<Main><LoadingList rows={4} label="Memuat data keluarga" /></Main>}><Body /></Suspense>;
}
