// Shared page frame of Stok: the not-ok states and the segment/branch chips (UX-11 segments Item · Kartu · Batch ·
// Hitung; a tenant-wide reader picks the branch).
import Link from "next/link";
import { redirect } from "next/navigation";
import { ListPage } from "../../../components/templates/templates";
import { PermissionState } from "../../../components/ui/states";
import { SEGMENTS } from "./labels";

type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" } | { kind: "not-found" };
export function NotOkState({ d, title }: { d: NotOk; title: string }) {
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="stok" />;
  if (d.kind === "not-found") return <ListPage as="section" title={title} state={{ kind: "empty", message: "Data tidak ditemukan di cabang ini." }} />;
  return <ListPage as="section" title={title} state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
}

export function BranchChips({ path, branches, active, extra = "" }: { path: string; branches: { id: string; name: string }[]; active: string; extra?: string }) {
  if (branches.length < 2) return null;
  return (
    <div role="group" aria-label="Cabang" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
      {branches.map((b) => (
        <Link key={b.id} href={`${path}?cabang=${b.id}${extra}`} aria-current={b.id === active ? "true" : undefined}
          className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline ${b.id === active ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : ""}`}>
          {b.name}
        </Link>
      ))}
    </div>
  );
}

export const segments = (active: string, branch: string, tenantWide: boolean) => SEGMENTS(active, tenantWide ? `?cabang=${branch}` : "");
