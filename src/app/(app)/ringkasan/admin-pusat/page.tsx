// Ringkasan Admin Pusat (UX-57, PR-33g; T-115): the Admin Pusat home (nav "ringkasan-ap"). Configuration facts only (PR-63).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { loadAdminHome } from "./data";
import { AdminHome } from "./view";

export const metadata: Metadata = { title: "Ringkasan Admin Pusat — Clinic Dashboard" };

async function Body() {
  const r = await loadAdminHome();
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <AdminHome state={{ kind: "permission", object: "ringkasan Admin Pusat" }} />;
  return <AdminHome state={{ kind: "ready", data: r.data }} />;
}

export default function Page() {
  return (
    <Suspense fallback={<AdminHome state={{ kind: "loading" }} />}>
      <Body />
    </Suspense>
  );
}
