// Serahkan (UX-10, 19:135; T-065): prepared items at the active branch, each → its detail (seven checks, label,
// counselling, hand over); today's handed items below. Pharmacist only.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadHandover } from "../data";
import { BLOCKER_LABEL, SEGMENTS, STATE_LABEL } from "../labels";

export const metadata: Metadata = { title: "Serahkan — Clinic Dashboard" };

const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

async function Body() {
  const d = await loadHandover();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="apotek" />;
  if (d.kind === "no-branch") return <ListPage as="section" title="Serahkan" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const l = d.list;
  const empty = l.prepared.length === 0 && l.handed_today.length === 0;
  return (
    <ListPage as="section" title="Serahkan" filters={SEGMENTS("serahkan")}
      state={empty ? { kind: "empty", message: `Belum ada yang siap diserahkan di ${l.branch_name}.`, action: "Buka Siapkan", actionHref: "/apotek/siapkan" } : { kind: "rows" }}>
      <div className="grid min-w-0 gap-6">
        <section aria-label="Siap diserahkan" className="grid min-w-0 gap-2">
          <h2 className="m-0 text-[1.25rem] font-semibold">Siap diserahkan</h2>
          {l.prepared.length === 0 ? <p role="status" className="m-0 text-[var(--label-2)]">Tidak ada yang menunggu diserahkan.</p> : (
            <RowList label="Siap diserahkan">
              {l.prepared.map((x) => (
                <Row key={x.id} href={`/apotek/serahkan/${x.id}`} title={x.patient.name}
                  subtitle={`${x.item.name} · ${Number(x.quantity)} ${x.item.unit} · ${x.patient.mrn ?? "Penjualan langsung"}`}
>
                  {/* the status under the title: a trailing badge squeezes the title at 390 px and 200 % text */}
                  {x.blocker ? <StatusBadge tone="blocked">{BLOCKER_LABEL[x.blocker]}</StatusBadge> : <StatusBadge tone="warning">{STATE_LABEL.prepared}</StatusBadge>}
                </Row>
              ))}
            </RowList>
          )}
        </section>
        {l.handed_today.length > 0 && (
          <section aria-label="Diserahkan hari ini" className="grid min-w-0 gap-2">
            <h2 className="m-0 text-[1.25rem] font-semibold">Diserahkan hari ini</h2>
            <RowList label="Diserahkan hari ini">
              {l.handed_today.map((x) => (
                <Row key={x.id} href={`/apotek/serahkan/${x.id}`} title={x.patient.name}
                  subtitle={`${x.item.name} · ${Number(x.quantity)} ${x.item.unit} · ${time(x.handed_at!)}`}
>
                  <StatusBadge tone="success">{STATE_LABEL.handed}</StatusBadge>
                </Row>
              ))}
            </RowList>
          </section>
        )}
      </div>
    </ListPage>
  );
}

export default function SerahkanPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
