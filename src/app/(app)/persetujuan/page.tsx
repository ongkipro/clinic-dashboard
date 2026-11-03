// Persetujuan (UX-26, PR-44): one inbox of every waiting approval the acting role may
// read, filtered by type. Rows only open the detail; Setujui lives in the detail.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../components/shell/nav";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { INBOX_LIMIT, rupiah } from "../../../modules/approvals/inbox";
import { loadInbox } from "./data";

export const metadata: Metadata = { title: "Persetujuan — Clinic Dashboard" };

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const p = await loadInbox(typeof q.jenis === "string" ? q.jenis : undefined);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <ListPage as="section" title="Persetujuan" state={{ kind: "permission", object: "persetujuan" }} />;
  const filters = p.types.length < 2 ? [] : [
    { label: "Semua", href: "/persetujuan", active: p.type === null },
    ...p.types.map((t) => ({ label: t.label, href: `/persetujuan?jenis=${t.key}`, active: p.type === t.key })),
  ];
  const state =
    p.rows.length > 0 ? { kind: "rows" as const }
    : p.type ? { kind: "filtered-empty" as const, message: "Tidak ada permintaan jenis ini yang menunggu.", clearHref: "/persetujuan" }
    : { kind: "empty" as const, message: "Tidak ada permintaan yang menunggu persetujuan." };
  return (
    <ListPage as="section" title="Persetujuan" filters={filters} state={state}>
      {p.more && <p role="status" className="m-0 text-[0.94rem] text-[var(--label-2)]">{`Menampilkan ${INBOX_LIMIT} permintaan yang paling lama menunggu.`}</p>}
      <RowList label="Permintaan menunggu">
        {p.rows.map((r) => (
          <Row
            key={r.id}
            href={`/persetujuan/${r.id}`}
            title={r.typeLabel}
            subtitle={[
              `${r.requesterName ?? "Staf"} · ${ROLE_LABEL[r.requestedAs] ?? r.requestedAs}`,
              r.branchName,
              r.amountRupiah !== null ? rupiah(r.amountRupiah) : null,
              fmt.format(r.requestedAt),
            ].filter(Boolean).join(" · ")}
          >
            {r.reason && <p className="m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{r.reason}</p>}
          </Row>
        ))}
      </RowList>
    </ListPage>
  );
}

export default function PersetujuanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
