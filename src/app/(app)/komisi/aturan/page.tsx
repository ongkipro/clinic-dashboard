// Aturan Komisi (UX-16, 19:155, PR-23; T-087): rules by contribution type with their versions (draft, in force, replaced); finance or the
// owner prepares a draft, only the owner puts it in force (the previous version ends; sales before keep it); a read-only simulator.
// Readers: owner, finance, manager, auditor (DEC-099). The value of a sale is the version in force at the invoice's issue.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, SuccessNotice } from "../../../../components/ui/states";
import { StatusBadge, type StatusTone } from "../../../../components/ui/status-badge";
import type { RuleVersion } from "../../../../modules/commission/commission";
import { loadRules } from "../data";
import { CreateRuleForm, DecideVersionForm, NewVersionForm, SimulatorForm } from "../forms";
import { day, ROLE, TYPE, value, VERSION } from "../labels";

export const metadata: Metadata = { title: "Aturan Komisi — Clinic Dashboard" };
const TITLE = "Aturan Komisi";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const panel = "grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const d = await loadRules();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "aturan komisi" }} />;
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "error", message: "Aturan komisi belum bisa dimuat.", retryHref: "/komisi/aturan" }} />;
  const l = d.d;
  const type = typeof sp.jenis === "string" && sp.jenis in TYPE ? sp.jenis : null;
  const rules = type ? l.rules.filter((r) => r.contribution_type === type) : l.rules;
  const chips = [{ label: "Semua", href: "/komisi/aturan", active: !type }, ...Object.entries(TYPE).map(([k, label]) => ({ label, href: `/komisi/aturan?jenis=${k}`, active: type === k }))];
  const drafts = l.rules.flatMap((r) => r.versions.filter((v) => v.state === "draft")).length;
  // the version in force today (the database clock); one put in force for a later date is scheduled
  const badge = (v: RuleVersion): [string, StatusTone] =>
    v.in_force ? ["Berlaku", "success"] : v.state === "active" ? ["Terjadwal", "neutral"] : VERSION[v.state];
  return (
    <ListPage as="section" title={TITLE} filters={chips} state={{ kind: "rows" }}>
      <p className={muted}>Nilai komisi sebuah penjualan memakai versi aturan yang berlaku saat tagihan terbit. Aturan khusus staf menggantikan aturan peran; aturan item lebih kuat dari aturan kategori.</p>
      {(l.can_prepare || d.items.length > 0) && (
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {l.can_prepare && <CreateRuleForm ctx={d.ctx} staff={l.staff} items={d.items} open={l.rules.length === 0} />}
          {d.items.length > 0 && <SimulatorForm ctx={d.ctx} items={d.items} staff={l.staff} />}
        </div>
      )}
      {!l.can_prepare && <p className={muted}>Mode baca: peran ini melihat aturan tanpa mengubahnya.</p>}
      {sp.diberlakukan === "1" && <SuccessNotice message="Versi diberlakukan. Penjualan sebelum tanggal mulainya tetap memakai versi lama." />}
      {sp.dibatalkan === "1" && <SuccessNotice message="Draf dibatalkan." />}
      {l.can_activate && drafts > 0 && <p role="status" className="m-0 text-[var(--warning)]">{`${drafts} draf menunggu Anda berlakukan.`}</p>}
      {rules.length > 0 ? (
        <ul aria-label="Aturan komisi" className="m-0 grid min-w-0 list-none gap-3 p-0">
          {rules.map((r) => {
            const live = r.versions.find((v) => v.in_force);
            const scope = [r.staff ? `Khusus ${r.staff.name}` : r.role ? `Peran ${ROLE[r.role] ?? r.role}` : "Semua peran",
              r.item ? `Item ${r.item.code}` : r.category ? `Kategori ${r.category}` : "Semua item", r.priority !== 0 && `Prioritas ${r.priority}`].filter(Boolean).join(" · ");
            return (
              <li key={r.id} className={panel}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <h2 className="m-0 min-w-0 text-[1.1rem] font-semibold [overflow-wrap:anywhere]">{`${r.name} · ${TYPE[r.contribution_type]}`}</h2>
                  <p className="m-0 font-semibold tabular-nums">{live ? value(live) : "Belum berlaku"}</p>
                </div>
                <p className={muted}>{scope}</p>
                <ol aria-label={`Versi ${r.name}`} className="m-0 grid min-w-0 list-none gap-2 p-0">
                  {r.versions.map((v) => (
                    <li key={v.id} className="grid min-w-0 gap-1 border-t border-[var(--separator)] pt-2 [border-top-width:0.5px]">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="tabular-nums">{`Versi ${v.version} · ${value(v)} · mulai ${day(v.effective_from)}`}</span>
                        <StatusBadge tone={badge(v)[1]}>{badge(v)[0]}</StatusBadge>
                      </div>
                      {v.prepared_by && <p className={muted}>{`Disiapkan ${v.prepared_by}${v.ended_at && v.state === "superseded" ? ` · ${v.ended ? "berakhir" : "berlaku sampai"} ${day(v.ended_at)}` : ""}`}</p>}
                      {v.state === "draft" && (l.can_activate
                        ? <DecideVersionForm ctx={d.ctx} version={v.id} label={`${r.name} versi ${v.version}`} />
                        : <p className={muted}>Menunggu Owner memberlakukan.</p>)}
                    </li>
                  ))}
                </ol>
                {l.can_prepare && <NewVersionForm ctx={d.ctx} rule={r.id} name={r.name} />}
              </li>
            );
          })}
        </ul>
      ) : type ? (
        <div className={panel} role="status">
          <p className="m-0 text-[var(--label-2)]">Belum ada aturan untuk jenis ini.</p>
          <Link href="/komisi/aturan" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Hapus Filter</Link>
        </div>
      ) : (
        <BlockedState reason="Belum ada aturan komisi, jadi belum ada komisi yang dihitung" unblock={l.can_prepare ? "Siapkan aturan, lalu Owner memberlakukannya" : "Keuangan atau Owner menyiapkan aturan"} />
      )}
      {l.role !== "manager" && <Link href="/komisi" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka Rekap Komisi & Batch</Link>}
    </ListPage>
  );
}

export default function AturanKomisiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
