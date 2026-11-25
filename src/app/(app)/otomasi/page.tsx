// Otomasi, Pengingat & Aftercare (UX-55, 17:94 / 17:183, 19:166, PR-94; T-097): four sections — Skenario Otomasi (SET-19: Admin Pusat and
// the owner change it, marketing proposes a draft for them), Aturan Pengingat Cabang (SET-18 per branch), Teks Aftercare Layanan (each
// service's aftercare state, edited in the catalog) and Log Pengiriman (the automation occurrences, by role and consent). States: loading,
// empty, filtered-empty, error, success (the forms), blocked (a pending draft blocks a second; "Batas pesan per pasien tercapai").
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadOtomasi } from "./data";
import { DraftDecision, ReminderForm, ScenarioForm } from "./forms";
import { AFTERCARE_PENDING, CAPPED, day, DELIVERY, SCENARIO_LABEL, SCENARIOS, SKIP, STATE_FILTERS } from "./labels";

export const metadata: Metadata = { title: "Otomasi, Pengingat & Aftercare — Clinic Dashboard" };
const TITLE = "Otomasi, Pengingat & Aftercare";
const panel = "grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const h2 = "m-0 text-[1.25rem] font-semibold";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const SC = new Set(["pengingat", "aftercare", "kepuasan", "rencana", "belum_jadwal", "isi_ulang", "ulang_tahun"]);
const ST = new Set(STATE_FILTERS.map(([k]) => k));
type SP = Record<string, string | string[] | undefined>;
// the draft decision's outcome after its redirect (actions.ts go): a fixed map; any other value shows nothing. Presentation only.
const DONE: Record<string, string> = { disetujui: "Usulan disetujui.", ditolak: "Usulan ditolak.", ditarik: "Usulan ditarik." };

async function Content({ sp }: { sp: SP }) {
  const scenario = typeof sp.skenario === "string" && SC.has(sp.skenario) ? sp.skenario : null;
  const state = typeof sp.status === "string" && ST.has(sp.status) ? sp.status : "all";
  const r = await loadOtomasi(scenario, state as never);
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "otomasi" }} />;
  const d = r.d;
  const done = typeof sp.ok === "string" && Object.hasOwn(DONE, sp.ok) ? DONE[sp.ok] : undefined;
  const q = (k: string, v: string | null) => {
    const o = new URLSearchParams();
    const s2 = k === "skenario" ? v : scenario;
    const st = k === "status" ? v : state;
    if (s2) o.set("skenario", s2);
    if (st && st !== "all") o.set("status", st);
    const t = o.toString();
    return `/otomasi${t ? `?${t}` : ""}#log`;
  };
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <section aria-labelledby="skenario" className={panel}>
        <h2 id="skenario" className={h2}>Skenario Otomasi</h2>
        <p className={muted}>Pesan perawatan netral (tanpa nama tindakan); isi ulang dan ulang tahun hanya untuk pasien dengan persetujuan pemasaran.</p>
        {done && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{done}</p>}
        {d.draft && (
          <div role="status" className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--warning-soft)] p-3 text-[var(--warning)]">
            <p className="m-0 font-semibold">Usulan dari {d.draft.proposer} menunggu keputusan Admin Pusat</p>
            <p className="m-0 [overflow-wrap:anywhere]">Alasan: {d.draft.reason}</p>
            {d.canChange && !d.draft.proposed_by_me && <DraftDecision ctx={d.ctx} draft={d.draft.id} mode="decide" />}
            {d.canPropose && d.draft.proposed_by_me && <DraftDecision ctx={d.ctx} draft={d.draft.id} mode="cancel" />}
          </div>
        )}
        <ScenarioForm ctx={d.ctx} value={d.set19} mode={d.canChange ? "change" : d.canPropose && !d.draft ? "propose" : "read"} />
      </section>

      <section aria-labelledby="pengingat" className={panel}>
        <h2 id="pengingat" className={h2}>Aturan Pengingat Cabang</h2>
        <p className={muted}>Pengingat H-1 dan hari H; tidak dikirim pukul 21:00–07:00 waktu cabang.</p>
        <div className="grid min-w-0 gap-3 min-[1180px]:grid-cols-2">
          {d.set18.map((b) => <ReminderForm key={b.branch_id} ctx={d.ctx} branch={b.branch_id} branchName={b.branch} value={b.value} canChange={d.canChange} />)}
        </div>
      </section>

      <section aria-labelledby="aftercare" className={panel}>
        <h2 id="aftercare" className={h2}>Teks Aftercare Layanan</h2>
        {d.services.length === 0 ? <p className="m-0">Belum ada layanan. Tambahkan layanan di Katalog.</p> : (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Layanan">
            {d.services.map((s) => (
              <li key={s.item_id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3">
                <Link href={`/layanan/${s.item_id}`} className="inline-flex min-h-[var(--target)] min-w-0 items-center font-semibold text-[var(--tint)] [overflow-wrap:anywhere]">{s.name}</Link>
                {s.pending ? <StatusBadge tone="warning">{AFTERCARE_PENDING}</StatusBadge>
                  : s.has_text === false ? <StatusBadge tone="neutral">Belum ada teks aftercare</StatusBadge>
                  : s.has_text ? <StatusBadge tone="success">Teks aftercare aktif</StatusBadge> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.log && (
        <section id="log" aria-labelledby="log-h" className={panel}>
          <h2 id="log-h" className={h2}>Log Pengiriman</h2>
          <nav aria-label="Saring skenario" className="flex min-w-0 flex-wrap gap-2">
            <a href={q("skenario", null)} aria-current={!scenario ? "page" : undefined} className={chip(!scenario)}>Semua skenario</a>
            {[...SCENARIOS.map(([k]) => k), "ulang_tahun"].map((k) => <a key={k} href={q("skenario", k)} aria-current={scenario === k ? "page" : undefined} className={chip(scenario === k)}>{SCENARIO_LABEL[k]}</a>)}
          </nav>
          <nav aria-label="Saring status" className="flex min-w-0 flex-wrap gap-2">
            {STATE_FILTERS.map(([k, l]) => <a key={k} href={q("status", k)} aria-current={state === k ? "page" : undefined} className={chip(state === k)}>{l}</a>)}
          </nav>
          {d.log.length === 0 ? (scenario || state !== "all" ? (
            <div className="grid gap-2 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3">
              <p className="m-0">Tidak ada pengiriman untuk saringan ini.</p>
              <Link href="/otomasi#log" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Hapus Filter</Link>
            </div>
          ) : <p className="m-0">Belum ada pesan otomatis.</p>) : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Pengiriman">
              {d.log.map((x) => (
                <li key={x.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{SCENARIO_LABEL[x.scenario]} · {x.consent_masked ? "Kontak tersembunyi" : (x.patient_name ?? x.patient_mrn ?? "—")}</span>
                    <StatusBadge tone={DELIVERY[x.state]?.tone ?? "neutral"}>{DELIVERY[x.state]?.label ?? x.state}</StatusBadge>
                  </div>
                  <p className={muted}>{x.branch_name} · rencana {day(x.original_planned_for)}{x.planned_for && x.planned_for !== x.original_planned_for ? ` → ${day(x.planned_for)}` : ""}</p>
                  {x.capped && <p className="m-0 text-[0.88rem] font-semibold text-[var(--warning)]">{CAPPED}</p>}
                  {x.skip_reason && x.skip_reason !== "cap_horizon_exceeded" && <p className={muted}>{SKIP[x.skip_reason]}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </ListPage>
  );
}
const chip = (on: boolean) => `inline-flex min-h-[var(--target)] items-center rounded-full px-4 font-semibold ${on ? "bg-[var(--tint)] text-white" : "bg-[var(--surface-2)] text-[var(--label)]"}`;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  // the page owns the one main landmark (shell.tsx:177; as lead/page.tsx): content, permission and loading all render inside it
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<ListPage as="section" title={TITLE} state={{ kind: "loading" }}><LoadingList /></ListPage>}>
        <Content sp={sp} />
      </Suspense>
    </main>
  );
}
