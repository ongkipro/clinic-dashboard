// Permintaan Klinis (UX-27, 17:153, 19:93, PR-45; T-056): the inbox of cards at the active branch. Segments
// Menunggu · Diputuskan. Each card: type, patient, requester, reason, item and price impact; plain Setujui / Tolak
// for an eligible decider (doctor or facility head, not the requester) outside the card link. A BC sees its own
// requests without doses. "Usul Permintaan" is the one prominent action.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadList } from "./data";
import { DecideForm } from "./forms";
import { KIND_LABEL, PROPOSERS, ROLE_LABEL, rupiah, STATE } from "./labels";

export const metadata: Metadata = { title: "Permintaan Klinis — Clinic Dashboard" };

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const tab = q.status === "diputuskan" ? "decided" : "pending";
  const d = await loadList(tab);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="permintaan klinis" />;
  if (d.kind === "no-branch") return <ListPage as="section" title="Permintaan Klinis" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const propose = PROPOSERS.has(d.role) ? { label: "Usul Permintaan", href: "/permintaan/baru" } : undefined;
  return (
    <ListPage as="section" title="Permintaan Klinis" primaryAction={propose}
      filters={[{ label: "Menunggu", href: "/permintaan", active: tab === "pending" }, { label: "Diputuskan", href: "/permintaan?status=diputuskan", active: tab === "decided" }]}
      state={d.requests.length === 0 ? { kind: "empty", message: tab === "pending" ? "Tidak ada permintaan yang menunggu keputusan." : "Belum ada permintaan yang diputuskan dalam 7 hari terakhir." } : { kind: "rows" }}>
      <ul aria-label="Permintaan" className="m-0 grid min-w-0 list-none gap-3 p-0">
        {d.requests.map((r) => {
          const st = STATE[r.state];
          return (
            <li key={r.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
              <Link href={`/permintaan/${r.id}`} className="grid min-h-[52px] min-w-0 gap-1 text-[var(--label)] no-underline">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold">{KIND_LABEL[r.kind]}</span>
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                </span>
                <span className="font-semibold [overflow-wrap:anywhere]">{`${r.patient_name} · ${r.patient_mrn}`}</span>
                <span className="text-[0.94rem] [overflow-wrap:anywhere]">
                  {r.target_name ? `${r.target_name} × ${r.target_qty} → ` : ""}{`${r.item_name} × ${r.qty}`}
                  <span className="tabular-nums">{` · ${rupiah(r.price_impact)}`}</span>
                </span>
                <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                  {`${r.requester_name} (${ROLE_LABEL[r.requested_as] ?? r.requested_as}) · ${when(r.requested_at)}${r.full && r.reason ? ` · ${r.reason}` : ""}`}
                </span>
              </Link>
              {r.can_decide && r.visit_open && <DecideForm ctx={d.ctx} request={r.id} visit={r.visit_id} prominent={false} open label={`${KIND_LABEL[r.kind]} ${r.patient_name}`} />}
            </li>
          );
        })}
      </ul>
    </ListPage>
  );
}

export default function PermintaanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
