// Lead & Pipeline (UX-18, 17:171, 19:164, PR-29; T-092): segments Lead · Tindak Lanjut (T-093) · Kampanye; the leads by stage (Terbuka,
// Baru … Hilang) and scope (Semua, Milikku, Belum Ditugaskan) with source, campaign, branch, assignee and the first-response SLA. Central CS,
// BC (own), manager work it; owner reads; marketing and the auditor read masked (DEC-104).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadCampaigns, loadLeads } from "./data";
import { CampaignForm, CreateLeadForm } from "./forms";
import { CHANNEL, SCOPE_FILTERS, SEGMENTS, SOURCE, STAGE, STAGE_FILTERS, when } from "./labels";

export const metadata: Metadata = { title: "Lead & Pipeline — Clinic Dashboard" };
const TITLE = "Lead & Pipeline";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const panel = "grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const STAGES = new Set(STAGE_FILTERS.map(([k]) => k as string));
const SCOPES = new Set(SCOPE_FILTERS.map(([k]) => k as string));
type SP = Record<string, string | string[] | undefined>;

function SegmentBar({ segment }: { segment: string }) {
  return (
    <nav aria-label="Bagian Lead" className="flex min-w-0 flex-wrap gap-2">
      {SEGMENTS(segment).map((s) => <a key={s.href} href={s.href} aria-current={s.active ? "page" : undefined}
        className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 font-semibold ${s.active ? "bg-[var(--tint)] text-white" : "bg-[var(--surface)] text-[var(--label)]"}`}>{s.label}</a>)}
    </nav>
  );
}

async function Leads({ sp }: { sp: SP }) {
  const stage = typeof sp.tahap === "string" && STAGES.has(sp.tahap) ? sp.tahap : "open";
  const scope = typeof sp.lingkup === "string" && SCOPES.has(sp.lingkup) ? sp.lingkup : "all";
  const d = await loadLeads(stage, scope);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "lead" }} />;
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "error", message: "Lead belum bisa dimuat.", retryHref: "/lead" }} />;
  const l = d.d;
  const q = (k: string, v: string) => { const o = new URLSearchParams({ tahap: stage, lingkup: scope, [k]: v }); return `/lead?${o.toString()}`; };
  const chips = STAGE_FILTERS.map(([k, label]) => ({ label: `${label}${k !== "all" && k !== "open" && l.counts[k as keyof typeof l.counts] ? ` (${l.counts[k as keyof typeof l.counts]})` : ""}`, href: q("tahap", k), active: stage === k }));
  const filtered = stage !== "open" || scope !== "all";
  const state = l.leads.length ? { kind: "rows" as const }
    : filtered ? { kind: "filtered-empty" as const, message: "Tidak ada lead untuk filter ini.", clearHref: "/lead" }
    : { kind: "empty" as const, message: l.can_write ? "Belum ada lead. Tambahkan lead dari Pesan atau dengan Tambah Lead." : "Belum ada lead." };
  const campaigns = (d.campaigns?.campaigns ?? []).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));
  return (
    <ListPage as="section" title={TITLE} filters={chips} state={l.can_write ? { kind: "rows" } : state}>
      <nav aria-label="Lingkup" className="flex min-w-0 flex-wrap gap-2">
        {SCOPE_FILTERS.map(([k, label]) => <a key={k} href={q("lingkup", k)} aria-current={scope === k ? "page" : undefined}
          className={`inline-flex min-h-[var(--target)] items-center rounded-full px-3 text-[0.94rem] ${scope === k ? "bg-[var(--tint-soft)] font-semibold" : "text-[var(--label-2)]"}`}>{label}</a>)}
      </nav>
      {l.can_write && <CreateLeadForm ctx={d.ctx} campaigns={campaigns} />}
      {(l.role === "marketing" || l.role === "auditor") && <p className={muted}>Mode baca: identitas tampil hanya bila diizinkan (persetujuan promosi untuk Marketing).</p>}
      {l.role === "owner" && <p className={muted}>Mode baca: Owner melihat pipeline tanpa mengubahnya.</p>}
      {l.leads.length === 0 && l.can_write && <p role="status" className={muted}>{filtered ? "Tidak ada lead untuk filter ini." : "Belum ada lead. Tambahkan lead dari Pesan atau dengan Tambah Lead."}
        {filtered && <> <Link href="/lead" className="font-semibold text-[var(--tint)]">Hapus Filter</Link></>}</p>}
      {l.leads.length > 0 && (
        <RowList label="Lead">
          {l.leads.map((x) => (
            <Row key={x.id} href={`/lead/${x.id}`} title={x.patient_name ?? x.contact_name ?? (x.consent_masked ? "Kontak tersembunyi" : "Tanpa nama")}
              subtitle={[SOURCE[x.source] ?? x.source, x.campaign_name, x.branch_name ?? "Belum diarahkan ke cabang", x.assignee_name ? `Ditangani ${x.assignee_name}` : "Belum ditugaskan",
                `Dibuat ${when(x.created_at)}`].filter(Boolean).join(" · ")}>
              <div className="flex min-w-0 flex-wrap gap-2">
                <StatusBadge tone={(STAGE[x.stage] ?? STAGE.new)[1]}>{(STAGE[x.stage] ?? STAGE.new)[0]}</StatusBadge>
                {x.sla_overdue && <StatusBadge tone="danger">{`Lewat ${x.sla_minutes} menit tanpa respons`}</StatusBadge>}
                {x.response_minutes != null && <StatusBadge tone="neutral">{`Respons ${x.response_minutes} menit`}</StatusBadge>}
              </div>
            </Row>
          ))}
        </RowList>
      )}
    </ListPage>
  );
}

async function Campaigns() {
  const d = await loadCampaigns();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "kampanye" }} />;
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "error", message: "Kampanye belum bisa dimuat.", retryHref: "/lead?segmen=kampanye" }} />;
  const l = d.d;
  return (
    <ListPage as="section" title={TITLE} state={l.campaigns.length || l.can_manage ? { kind: "rows" } : { kind: "empty", message: "Belum ada kampanye." }}>
      {l.can_manage && <CampaignForm ctx={d.ctx} />}
      {!l.can_manage && <p className={muted}>Mode baca: kampanye dikelola Owner, Admin Pusat dan Marketing.</p>}
      {l.campaigns.length === 0 && l.can_manage && <p role="status" className={muted}>Belum ada kampanye.</p>}
      {l.campaigns.length > 0 && (
        <ul aria-label="Kampanye" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {l.campaigns.map((c) => (
            <li key={c.id} className={panel}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{c.name}</p>
                <StatusBadge tone={c.active ? "success" : "locked"}>{c.active ? "Aktif" : "Nonaktif"}</StatusBadge>
              </div>
              <p className={muted}>{[c.code, CHANNEL[c.channel] ?? c.channel, `${c.leads} lead`].join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
    </ListPage>
  );
}

async function Body({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const segment = sp.segmen === "kampanye" ? "kampanye" : sp.segmen === "tindak-lanjut" ? "tindak-lanjut" : "lead";
  return (
    <div className="grid min-w-0 gap-4">
      {segment === "kampanye" ? <Campaigns /> : segment === "tindak-lanjut" ? <FollowUps /> : <Leads sp={sp} />}
      <SegmentBar segment={segment} />
    </div>
  );
}

// Tindak Lanjut (PR-30) arrives with T-093: the reader still runs (auth, role, tenant), then an honest state (DEC-056).
async function FollowUps() {
  const d = await loadLeads("open", "all");
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "tindak lanjut" }} />;
  return <ListPage as="section" title={TITLE} state={{ kind: "blocked", reason: "Tugas tindak lanjut otomatis belum tersedia.", unblock: "Tindak lanjut dari aturan (kontrol, paket, piutang, tidak datang) hadir bersama modul Tindak Lanjut." }} />;
}

export default function LeadPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} label="Memuat lead" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
