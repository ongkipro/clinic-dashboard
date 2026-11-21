// Ringkasan Shift (UX-6 shift summary, PR-33c; T-111): the page, PARKED until the DEL-2 case below is approved (a new page.tsx is a route surface
// the isolation gate counts). Target path: src/app/(app)/hari-ini/ringkasan/page.tsx. Everything the page needs is already in the focus:
// data.ts (role gate before the tenant transaction), load.ts (the core the isolation case runs), view.tsx (presentational). The shell and the branch
// chips are the Kasir's own (read-only import): the owner picks a branch with ?cabang=, also when the branch has no open shift (the empty state).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { BranchChips, Main } from "../../kasir/frame";
import { loadShiftSummary } from "./data";
import { PATH } from "./load";
import { ShiftSummary } from "./view";

export const metadata: Metadata = { title: "Ringkasan Shift — Hari Ini — Clinic Dashboard" };
type Q = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const TITLE = "Ringkasan Shift";

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const sp = await searchParams;
  const r = await loadShiftSummary({ cabang: one(sp.cabang), shift: one(sp.shift) });
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "ringkasan shift" }} />;
  if (r.kind === "no-branch") return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  if (r.kind === "not-found") return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Shift tidak ditemukan di cabang ini.", action: "Kembali ke Hari Ini", actionHref: "/hari-ini" }} />;
  return (
    <>
      <ShiftSummary as="section" {...r.props} />
      <BranchChips path={PATH} branches={r.branches} active={r.branchId} />
    </>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Q> }) {
  return (
    <Main>
      <Suspense fallback={<ListPage as="section" title={TITLE} state={{ kind: "loading" }} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Main>
  );
}
