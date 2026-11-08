// Tambah item katalog (UX-25): Owner, Admin Pusat and Manager. With clinical fields the first
// version waits for clinical review before the item can be sold (PR-41, DEC-046).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { loadCatalog } from "../data";
import { VersionForm } from "../forms";

export const metadata: Metadata = { title: "Tambah Item Katalog — Clinic Dashboard" };
const EMPTY = { indications: "", contraindications: "", consent_template: "", delegation: "" };

async function Body() {
  const p = await loadCatalog();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden" || !p.canEdit) return <PermissionState object="perubahan katalog" />;
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-4">
      <PageTitle title="Tambah item katalog" />
      <VersionForm ctx={p.ctx} itemId={null} canSeeClinical={p.seesClinical} clinicalActive={EMPTY}
        initial={{ name: "", tax_category: "", tax_basis: "", normal_price: "", control_count: "0", control_validity_days: "", booking_dp_enabled: false,
          booking_dp_amount: "", min_dp_pct: "", installments_allowed: false, validity_days: "", commission_scope: [], ...EMPTY }} />
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingList label="Memuat" />}>
      <Body />
    </Suspense>
  );
}
