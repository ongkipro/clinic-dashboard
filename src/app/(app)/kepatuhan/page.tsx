// Kepatuhan & Pendapat Ahli (UX-58, PR-97): every obligation with its status chip,
// validity and the features it unlocks; vendor obligations show status only.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { AREA_LABEL, GATE_LABEL, STATUS_LABEL as STATUS } from "../../../modules/compliance/compliance";
import { loadRegister } from "./data";

export const metadata: Metadata = { title: "Kepatuhan — Clinic Dashboard" };

const fmt = (d: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(`${d}T00:00:00+07:00`));

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const p = await loadRegister(typeof q.status === "string" ? q.status : undefined);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <ListPage as="section" title="Kepatuhan & Pendapat Ahli" state={{ kind: "permission", object: "register kepatuhan" }} />;
  const filters = [
    { label: "Semua", href: "/kepatuhan", active: p.filter === null },
    ...(["missing", "submitted", "approved", "expired"] as const).map((s) => ({ label: STATUS[s].label, href: `/kepatuhan?status=${s}`, active: p.filter === s })),
  ];
  const state = p.rows.length ? { kind: "rows" as const } : { kind: "filtered-empty" as const, message: "Tidak ada kewajiban dengan status ini.", clearHref: "/kepatuhan" };
  const groups = [
    { label: "Kewajiban klinik", rows: p.rows.filter((r) => r.scope === "tenant") },
    { label: "Kewajiban vendor (status saja)", rows: p.rows.filter((r) => r.scope === "vendor") },
  ].filter((g) => g.rows.length);
  return (
    <ListPage as="section" title="Kepatuhan & Pendapat Ahli" filters={filters} state={state}>
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="grid min-w-0 gap-2">
          <h2 className="m-0 text-[1.18rem] font-semibold">{g.label}</h2>
          <RowList label={g.label}>
            {g.rows.map((r) => (
              <Row
                key={r.obligationKey}
                href={`/kepatuhan/${r.obligationKey}`}
                title={r.label}
                subtitle={[AREA_LABEL[r.area], r.validUntil ? `berlaku sampai ${fmt(r.validUntil)}` : null].filter(Boolean).join(" · ")}
              >
                <div className="grid min-w-0 justify-items-start gap-1">
                  <StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusBadge>
                  {r.gates.length > 0 && (
                    <p className="m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">Membuka: {r.gates.map((x) => GATE_LABEL[x] ?? x).join(", ")}</p>
                  )}
                </div>
              </Row>
            ))}
          </RowList>
        </section>
      ))}
    </ListPage>
  );
}

export default function KepatuhanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
