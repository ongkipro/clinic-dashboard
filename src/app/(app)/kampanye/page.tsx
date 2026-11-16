// Kampanye & Segmen (UX-19, 17:58, 19:168, PR-94; T-100): segments (non-clinical rules, consented members counted, never listed) and
// campaigns (segment, promotional template, date). Sending stays locked until the Q-15 counsel evidence is approved (PR-97): the blocked
// banner names who can unblock — owner / Admin Pusat see the missing evidence and the Kepatuhan link, marketing is told to ask the Owner
// (marketing cannot open Kepatuhan). States: loading, empty, error, success (the forms), blocked (the gate), permission.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { SEND_LOCKED } from "../../../modules/crm/campaigns/campaigns";
import { loadKampanye } from "./data";
import { ScheduleForm, SegmentForm, StateButtons } from "./forms";
import { day, rulesText, sentNotice, SKIP, STATE } from "./labels";

export const metadata: Metadata = { title: "Kampanye & Segmen — Clinic Dashboard" };
const TITLE = "Kampanye & Segmen";
const panel = "grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const h2 = "m-0 text-[1.25rem] font-semibold";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
type SP = Record<string, string | string[] | undefined>;
// the outcome after an action's redirect (actions.ts go): a fixed map; any other value shows nothing. Presentation only.
const DONE: Record<string, string> = { dijadwalkan: "Kampanye dijadwalkan.", draf: "Kampanye dikembalikan ke draf.", dibatalkan: "Kampanye dibatalkan." };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

async function Content({ sp }: { sp: SP }) {
  const r = await loadKampanye();
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "kampanye" }} />;
  const d = r.d;
  const done = sp.ok === "terkirim" ? sentNotice(sp.q, sp.x) : typeof sp.ok === "string" && Object.hasOwn(DONE, sp.ok) ? DONE[sp.ok] : undefined;
  const locked = !d.gate.open;
  const canEvidence = d.role === "owner" || d.role === "admin_pusat";
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      {done && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{done}</p>}
      {locked && (
        <div id="terkunci" role="status" className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--warning-soft)] p-3 text-[var(--warning)]">
          <p className="m-0 font-semibold">{SEND_LOCKED}.</p>
          {canEvidence ? (
            <>
              <p className="m-0 [overflow-wrap:anywhere]">Bukti yang ditunggu: {d.gate.missing.join(", ") || "pendapat hukum situs klinik"}.</p>
              <Link href="/kepatuhan" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka Kepatuhan</Link>
            </>
          ) : <p className="m-0">{`Minta Owner menyetujui bukti di menu Kepatuhan.${d.can_manage ? " Segmen dan jadwal tetap bisa disiapkan." : ""}`}</p>}
        </div>
      )}

      <section aria-labelledby="segmen" className={panel}>
        <h2 id="segmen" className={h2}>Segmen</h2>
        <p className={muted}>Jumlah pasien dihitung dari kriteria dan persetujuan promosi saat ini; nama pasien tidak ditampilkan.</p>
        {d.segments.length === 0 ? <p className="m-0">Belum ada segmen.{d.can_manage ? " Buat segmen pertama di bawah." : ""}</p> : (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Daftar segmen">
            {d.segments.map((s) => (
              <li key={s.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{s.name}</span>
                  <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-[0.82rem] font-semibold leading-5">{`${s.members} pasien`}</span>
                </div>
                <p className={muted}>{rulesText(s.rules, d.branches)}</p>
                {d.can_manage && (
                  <details className="min-w-0">
                    <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center font-semibold text-[var(--tint)]">Ubah segmen</summary>
                    <SegmentForm ctx={d.ctx} branches={d.branches} segment={s} />
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {d.can_manage && (
          <details className="min-w-0" open={d.segments.length === 0}>
            <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center font-semibold text-[var(--tint)]">Segmen baru</summary>
            <SegmentForm ctx={d.ctx} branches={d.branches} />
          </details>
        )}
      </section>

      <section aria-labelledby="kampanye" className={panel}>
        <h2 id="kampanye" className={h2}>Kampanye</h2>
        <p className={muted}>Buat kampanye baru di Lead & Pipeline › Kampanye; di sini kampanye dijadwalkan ke segmen.</p>
        {d.campaigns.length === 0 ? <p className="m-0">Belum ada kampanye.</p> : (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Daftar kampanye">
            {d.campaigns.map((c) => {
              const st = STATE[c.send_state] ?? STATE.draft;
              const o = c.outcomes;
              return (
                <li key={c.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{c.name}</span>
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </div>
                  <p className={muted}>
                    {c.segment_id ? `Segmen ${d.segments.find((s) => s.id === c.segment_id)?.name ?? "—"} · ` : ""}
                    {c.template_name ? `Templat ${c.template_name} · ` : ""}{c.scheduled_for ? `kirim ${day(c.scheduled_for)}` : "belum dijadwalkan"}
                  </p>
                  {c.send_state === "queued" && (
                    <p className={muted}>{`Antrean pengiriman: ${o.queued + o.sending} menunggu · ${o.sent} terkirim · ${o.skipped} dilewati · ${o.failed} gagal`}</p>
                  )}
                  {d.can_manage && (c.send_state === "draft" || c.send_state === "scheduled") && (
                    <>
                      <ScheduleForm ctx={d.ctx} campaign={c.id} segments={d.segments} templates={d.templates} value={c} min={today()} />
                      <StateButtons ctx={d.ctx} campaign={c.id} state={c.send_state} locked={locked} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className={muted}>Angka antrean dihitung dari pesan yang masuk antrean. Pasien yang dikecualikan saat pengiriman (misalnya {SKIP.cap_horizon_exceeded}) tidak masuk antrean dan ditampilkan sekali di pemberitahuan setelah Kirim.</p>
    </ListPage>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  // the page owns the one main landmark (as lead/page.tsx): content, permission and loading all render inside it
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<ListPage as="section" title={TITLE} state={{ kind: "loading" }}><LoadingList /></ListPage>}>
        <Content sp={sp} />
      </Suspense>
    </main>
  );
}
