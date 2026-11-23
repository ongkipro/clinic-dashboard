// Notifikasi (Saya › Notifikasi, 19:229, PR-54; HYG-NAV-1): what the acting staff member may see (notifications_read RLS: addressed to
// them, or to their acting role at an allowed branch), newest first, segments Belum Selesai · Semua; Tandai Selesai acknowledges for
// everyone. Labels and subject links only: no clinical content is stored on a notification.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { withTenantContext } from "../../../../db/rls/context";
import { list } from "../../../../modules/notifications/notifications";
import { renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { AckForm } from "./forms";
import { subjectHref } from "./links";

export const metadata: Metadata = { title: "Notifikasi — Clinic Dashboard" };
const TITLE = "Notifikasi";
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const all = sp.tampilan === "semua";
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "notifikasi" }} />;
  const rows = await withTenantContext(await appPool(), rc.active.context, (db) => list(db, { open: !all, limit: 100 }));
  const filters = [{ label: "Belum Selesai", href: "/saya/notifikasi", active: !all }, { label: "Semua", href: "/saya/notifikasi?tampilan=semua", active: all }];
  const state = rows.length > 0 ? { kind: "rows" as const }
    : all ? { kind: "empty" as const, message: "Belum ada notifikasi." }
    : { kind: "filtered-empty" as const, message: "Tidak ada notifikasi yang belum selesai.", clearHref: "/saya/notifikasi?tampilan=semua" };
  const ctx = renderedContext(rc.active.context);
  return (
    <ListPage as="section" title={TITLE} filters={filters} state={state}>
      <ul aria-label="Notifikasi" className="m-0 grid min-w-0 list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
        {rows.map((n) => {
          const href = subjectHref(n.subjectKind, n.subjectId);
          return (
            <li key={n.id} className="grid min-w-0 gap-1 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                {href ? <Link href={href} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--label)] no-underline [overflow-wrap:anywhere]">{n.label}</Link>
                  : <span className="font-semibold [overflow-wrap:anywhere]">{n.label}</span>}
                {n.acknowledged ? <StatusBadge tone="success">Selesai</StatusBadge> : <StatusBadge tone="warning">Belum selesai</StatusBadge>}
              </div>
              <p className={muted}>{fmt.format(n.createdAt)}{n.acknowledged ? ` · ditandai ${n.acknowledged.name || "staf"} ${fmt.format(n.acknowledged.at)}` : ""}</p>
              {!n.acknowledged && <AckForm ctx={ctx} id={n.id} label={n.label} />}
            </li>
          );
        })}
      </ul>
    </ListPage>
  );
}

export default function NotifikasiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat notifikasi" />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
