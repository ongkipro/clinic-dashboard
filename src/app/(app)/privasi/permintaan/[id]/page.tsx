// UX-30 ▸ Permintaan detail page (PR-50; T-121).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { EmptyState, LoadingList, PermissionState } from "../../../../../components/ui/states";
import { loadDsrDetail } from "../data";
import { AssignDsrForm, BindSubjectForm, CloseDsrForm, ConfirmCopyHandoffForm, LinkEvidenceForm, VerifyIdentityForm } from "../forms";
import { RequestDetailView } from "../view";

export const metadata: Metadata = { title: "Detail Permintaan Data — Clinic Dashboard" };

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadDsrDetail(id);
  if (loaded.kind === "redirect") redirect(loaded.to);
  if (loaded.kind === "forbidden") {
    return (
      <Shell>
        <PageTitle title="Detail Permintaan Data" />
        <PermissionState object="permintaan data pasien" />
      </Shell>
    );
  }
  if (loaded.kind === "not_found") {
    return (
      <Shell>
        <PageTitle title="Detail Permintaan Data" />
        <EmptyState message="Permintaan data tidak ditemukan." />
        <p className="m-0">
          <Link href="/privasi/permintaan" className="inline-flex min-h-[var(--target)] items-center">
            Kembali ke daftar permintaan
          </Link>
        </p>
      </Shell>
    );
  }
  return (
    <Shell>
      <p className="m-0">
        <Link href="/privasi/permintaan" className="inline-flex min-h-[var(--target)] items-center">
          ← Kembali ke daftar permintaan
        </Link>
      </p>
      <PageTitle title="Detail Permintaan Data" />
      <RequestDetailView detail={loaded.detail} />
      <BindSubjectForm ctx={loaded.ctx} detail={loaded.detail} />
      <VerifyIdentityForm ctx={loaded.ctx} detail={loaded.detail} />
      <AssignDsrForm ctx={loaded.ctx} detail={loaded.detail} />
      <ConfirmCopyHandoffForm ctx={loaded.ctx} detail={loaded.detail} options={loaded.linkOptions} />
      <LinkEvidenceForm ctx={loaded.ctx} detail={loaded.detail} options={loaded.linkOptions} />
      <CloseDsrForm ctx={loaded.ctx} detail={loaded.detail} />
    </Shell>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <Shell>
          <PageTitle title="Detail Permintaan Data" />
          <LoadingList label="Memuat detail permintaan data" />
        </Shell>
      }
    >
      <Body params={params} />
    </Suspense>
  );
}
