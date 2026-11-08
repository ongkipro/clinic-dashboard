// Ruang, Bed & Alat (19:69): the branch master's Ruang & Alat section of the active branch, or of
// the first allowed branch on Semua Cabang (T-036 plan r1 P2-2).
import { redirect } from "next/navigation";
import { PageTitle } from "../../../../../components/templates/templates";
import { PermissionState } from "../../../../../components/ui/states";
import { defaultBranch } from "../data";

export default async function Page() {
  const d = await defaultBranch();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden" || !d.id) {
    return (
      <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-4">
        <PageTitle title="Ruang, Bed & Alat" />
        <PermissionState object="ruang dan alat" />
      </main>
    );
  }
  redirect(`/pengaturan/cabang/${d.id}#ruang`);
}
