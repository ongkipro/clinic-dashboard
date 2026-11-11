// Stok (UX-11): /stok lands on the acting role's first useful segment (plan P3-1).
import { redirect } from "next/navigation";
import { PermissionState } from "../../../components/ui/states";
import { homeRole } from "./data";
import { HOME } from "./labels";

export default async function StokPage() {
  const r = await homeRole();
  if (r.kind === "redirect") redirect(r.to);
  const to = r.role ? HOME[r.role] : undefined;
  if (to) redirect(to);
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 gap-4">
      <PermissionState object="stok" />
    </main>
  );
}
