// Pesan › Templat (UX-17, 19:167; T-090): the tenant's WhatsApp templates with their Meta status and category. Owner, Admin Pusat and
// marketing save neutral drafts (W-05: no diagnosis, treatment, medicine or photo) and sync from Meta (the mock adapter, DEC-082); the
// inbox roles and the auditor read.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadTemplates } from "../data";
import { TemplateForms } from "../forms";
import { CATEGORY, SEGMENTS, TEMPLATE_STATUS, when } from "../labels";

export const metadata: Metadata = { title: "Templat WhatsApp — Clinic Dashboard" };
const TITLE = "Templat WhatsApp";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

async function Body() {
  const d = await loadTemplates();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "templat WhatsApp" }} />;
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "error", message: "Templat belum bisa dimuat.", retryHref: "/pesan/templat" }} />;
  const l = d.d;
  const segs = SEGMENTS(d.role, "templat");
  // a manager always gets the forms (the first template comes from them); the empty state then shows inside the page (review r1 P2-1)
  const state = l.templates.length || l.can_manage ? { kind: "rows" as const } : { kind: "empty" as const, message: "Belum ada templat." };
  return (
    <ListPage as="section" title={TITLE} filters={segs.length > 1 ? segs : undefined} state={state}>
      {l.can_manage && <TemplateForms ctx={d.ctx} />}
      {!l.can_manage && <p className={muted}>Mode baca: templat dikelola Owner, Admin Pusat dan Marketing.</p>}
      {l.templates.length === 0 && <p role="status" className={muted}>Belum ada templat. Sinkronkan dari Meta atau simpan draf.</p>}
      {l.templates.length > 0 && <RowList label="Templat">
        {l.templates.map((t) => (
          <Row key={t.id} href={`/pesan/templat#${t.id}`} title={`${t.name} · ${t.language}`}
            subtitle={[CATEGORY[t.category] ?? t.category, `Diperbarui ${when(t.updated_at)}`, t.body].join(" · ")}>
            <StatusBadge tone={(TEMPLATE_STATUS[t.status] ?? TEMPLATE_STATUS.draft)[1]}>{(TEMPLATE_STATUS[t.status] ?? TEMPLATE_STATUS.draft)[0]}</StatusBadge>
          </Row>
        ))}
      </RowList>}
    </ListPage>
  );
}

export default function TemplatPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat templat" />}>
        <Body />
      </Suspense>
    </main>
  );
}
