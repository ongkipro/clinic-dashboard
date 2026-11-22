// Pasienku (UX-35 BC home, PR-33d; T-112): the page, PARKED until the DEL-2 case below is approved (a new page.tsx is a route surface the isolation gate counts).
// Target path: src/app/(app)/pasienku/page.tsx. Everything the page needs is already in the focus: data.ts (the BC-only gate before the tenant transaction), load.ts (the core
// the isolation case and the PostgreSQL tests run), view.tsx (presentational). `/pasienku` is already in nav.ts (BC tab 1), so no nav change.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../components/templates/templates";
import { loadPasienku } from "./data";
import { Pasienku } from "./view";

export const metadata: Metadata = { title: "Pasienku — Clinic Dashboard" };
const TITLE = "Pasienku";

async function Body() {
  const r = await loadPasienku();
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage title={TITLE} state={{ kind: "permission", object: "Pasienku" }} />;
  if (r.kind === "no-branch") return <ListPage title={TITLE} state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  return <Pasienku {...r.props} />;
}

export default function Page() {
  return (
    <Suspense fallback={<ListPage title={TITLE} state={{ kind: "loading" }} />}>
      <Body />
    </Suspense>
  );
}
