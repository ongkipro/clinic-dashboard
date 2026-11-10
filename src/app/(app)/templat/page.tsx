// /templat: sends the acting role to its document page (template roles → Templat Dokumen, letter readers → Surat).
import { redirect } from "next/navigation";
import { PermissionState } from "../../../components/ui/states";
import { homeFor } from "./data";

export default async function TemplatIndex() {
  const to = await homeFor();
  if (to) redirect(to);
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Dokumen</h1>
      <PermissionState object="dokumen" />
    </main>
  );
}
