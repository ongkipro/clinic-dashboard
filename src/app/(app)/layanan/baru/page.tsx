// Tambah layanan (UX-25, PR-88, T-034): Owner, Admin Pusat and Manager. Durations start at 10/30/10
// minutes. With clinical fields or staff the first version waits for the facility head; with a recipe
// for the pharmacist (DEC-047).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { loadNew } from "../data";
import { ServiceForm } from "../forms";

export const metadata: Metadata = { title: "Tambah Layanan — Clinic Dashboard" };
const EMPTY = { indications: "", contraindications: "", consent_template: "", delegation: "", aftercare_text: "" };

async function Body() {
  const p = await loadNew();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="perubahan Master Layanan" />;
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-4">
      <PageTitle title="Tambah layanan" />
      <ServiceForm ctx={p.ctx} itemId={null} staff={p.staff} baseline={{ clinical: EMPTY, eligibility: [], recipe: [] }}
        initial={{ name: "", tax_category: "exempt_medical", tax_basis: "", normal_price: "", control_count: "0", control_validity_days: "", booking_dp_enabled: false,
          booking_dp_amount: "", min_dp_pct: "", installments_allowed: false, validity_days: "", commission_scope: [], ...EMPTY,
          category: "", prep_min: "10", treatment_min: "30", buffer_min: "10", online_bookable: false, resources: [], eligibility: [], recipe: [] }} />
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
