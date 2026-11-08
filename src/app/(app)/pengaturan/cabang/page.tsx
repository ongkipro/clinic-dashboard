// Cabang (UX-2, PR-2, T-036): the branches the role may open, with a badge while the licence data
// (SET-46) is incomplete; Owner and Admin Pusat add a branch here.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { licenceComplete } from "../../../../modules/org/branches/branches";
import { loadBranches } from "./data";
import { NewBranchForm } from "./forms";
import { TZ_LABEL } from "./labels";

export const metadata: Metadata = { title: "Cabang — Clinic Dashboard" };

async function Body() {
  const p = await loadBranches();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="data cabang" />;
  return (
    <ListPage title="Cabang" state={p.branches.length ? { kind: "rows" } : { kind: "empty", message: "Belum ada cabang yang dapat Anda buka." }}>
      <RowList label="Daftar cabang">
        {p.branches.map((b) => (
          <Row key={b.id} href={`/pengaturan/cabang/${b.id}`} title={b.name} subtitle={`${b.code} · ${TZ_LABEL[b.timezone]}${b.address ? ` · ${b.address}` : ""}`}>
            {!licenceComplete(b) && <StatusBadge tone="warning">Data izin belum lengkap</StatusBadge>}
          </Row>
        ))}
      </RowList>
      {p.full && (
        <section aria-labelledby="tambah-cabang" className="grid min-w-0 gap-2">
          <h2 id="tambah-cabang" className="m-0 text-[1.18rem] font-semibold">Tambah cabang</h2>
          <div className="rounded-[var(--radius-group)] bg-[var(--surface)] p-4"><NewBranchForm ctx={p.ctx} /></div>
        </section>
      )}
    </ListPage>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingList label="Memuat cabang" />}>
      <Body />
    </Suspense>
  );
}
