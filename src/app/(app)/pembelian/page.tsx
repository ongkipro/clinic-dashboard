// Pembelian (UX-52): /pembelian lands on the acting role's segment (finance: Utang; others: PO).
import { redirect } from "next/navigation";
import { PermissionState } from "../../../components/ui/states";
import { homeRole } from "./data";
import { HOME, READERS } from "./labels";

export default async function PembelianPage() {
  const r = await homeRole();
  if (r.kind === "redirect") redirect(r.to);
  if (r.role && READERS.has(r.role)) redirect(HOME(r.role));
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 gap-4">
      <PermissionState object="pembelian" />
    </main>
  );
}
