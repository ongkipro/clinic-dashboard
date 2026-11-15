// Pesan › Percakapan (UX-17, 17:56, 19:163, PR-28; T-090): the shared WhatsApp inbox — filters (Semua, Belum Ditugaskan, Milikku, label,
// Selesai), the 24 h window and the reply-pending marker per conversation. CS, FO/cashier, BC and manager work it; the owner reads it.
// Message bodies never show in the list (W-10: only the thread opens them).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadInbox } from "./data";
import { FILTERS, phone, SEGMENTS, when } from "./labels";

export const metadata: Metadata = { title: "Pesan — Clinic Dashboard" };
const TITLE = "Pesan";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const FILTER = /^(all|unassigned|mine|closed|label:[a-z][a-z0-9_]{1,30})$/;

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filter = typeof sp.filter === "string" && FILTER.test(sp.filter) ? sp.filter : "all";
  const d = await loadInbox(filter);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") {
    if (d.role && SEGMENTS(d.role, "templat").length) redirect(SEGMENTS(d.role, "templat")[0].href);
    return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "percakapan WhatsApp" }} />;
  }
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "error", message: "Percakapan belum bisa dimuat.", retryHref: "/pesan" }} />;
  const l = d.d;
  const segs = SEGMENTS(d.role, "percakapan");
  const chips = [...FILTERS.map(([k, label]) => ({ label, href: k === "all" ? "/pesan" : `/pesan?filter=${k}`, active: filter === k })),
    ...(filter.startsWith("label:") ? [{ label: `Label ${filter.slice(6)}`, href: `/pesan?filter=${filter}`, active: true }] : [])];
  const rows = l.conversations;
  const state = rows.length > 0 ? { kind: "rows" as const }
    : filter !== "all" ? { kind: "filtered-empty" as const, message: "Tidak ada percakapan untuk filter ini.", clearHref: "/pesan" }
    : { kind: "empty" as const, message: "Belum ada percakapan. Pesan WhatsApp yang masuk muncul di sini." };
  // the segment bar stays visible in the empty and filtered-empty states (review r1 P2-1)
  const nav = segs.length > 1 && (
    <nav aria-label="Bagian Pesan" className="flex min-w-0 flex-wrap gap-2">
      {segs.map((s) => <a key={s.href} href={s.href} aria-current={s.active ? "page" : undefined}
        className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 font-semibold ${s.active ? "bg-[var(--tint)] text-white" : "bg-[var(--surface)] text-[var(--label)]"}`}>{s.label}</a>)}
    </nav>
  );
  return (
    <div className="grid min-w-0 gap-4">
    <ListPage as="section" title={TITLE} filters={chips} state={state}>
      {!l.can_write && <p className={muted}>Mode baca: Owner melihat percakapan tanpa membalas.</p>}
      <RowList label="Percakapan">
        {rows.map((c) => (
          <Row key={c.id} href={`/pesan/${c.id}`} title={c.patient_name ?? c.contact_name ?? phone(c.contact_wa_id)}
            subtitle={[c.branch_name ?? "Belum diarahkan ke cabang", c.assignee_name ? `Ditangani ${c.assignee_name}` : "Belum ditugaskan",
              `Terakhir ${when(c.last_activity_at)}`].join(" · ")}>
            <div className="flex min-w-0 flex-wrap gap-2">
              {c.awaiting_reply && <StatusBadge tone="warning">Menunggu balasan</StatusBadge>}
              <StatusBadge tone={c.window_open ? "success" : "neutral"}>{c.window_open ? "Jendela 24 jam terbuka" : "Hanya template"}</StatusBadge>
              {c.labels.map((x) => <StatusBadge key={x} tone="neutral">{x}</StatusBadge>)}
            </div>
          </Row>
        ))}
      </RowList>
      <p className={muted}>{`Target respons pertama ${l.sla_minutes} menit (Pengaturan › Komunikasi).`}</p>
    </ListPage>
    {nav}
    </div>
  );
}

export default function PesanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} label="Memuat percakapan" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
