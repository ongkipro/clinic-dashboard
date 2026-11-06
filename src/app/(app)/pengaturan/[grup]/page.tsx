// Pengaturan › {group} (19 §2.17, PR-38): only the SET rows the acting role may change or
// draft. Each row: current value, default and its source, bounds, effective date, history,
// Ubah, Kembalikan ke default; drafts show "Menunggu persetujuan {peran}". Rows whose data
// is owned by another page link there.
import type { RenderedContext } from "../../../../modules/org/context/context";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../../components/shell/nav";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { Row } from "../../../../modules/settings/settings";
import { boundsText, formatValue, type Spec, type Value } from "../../../../modules/settings/spec";
import { loadGroup } from "../data";
import { SettingEditor, WithdrawDraft } from "../editor";

export const metadata: Metadata = { title: "Pengaturan — Clinic Dashboard" };

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const SOURCE = { research: "riset", decision: "keputusan", tenant: "isian klinik" } as const;
const APPROVER = { owner: "Owner", facility_head: "Penanggung Jawab Klinik" } as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[0.82rem] text-[var(--label-2)]">{label}</dt>
      <dd className="m-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

// An object value reads as one line per field (label: value), others as one line.
function ValueLines({ spec, value, strong }: { spec: Spec; value: Value; strong?: boolean }) {
  if (spec.t === "obj" && value && typeof value === "object" && !Array.isArray(value)) {
    return (
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {spec.f.map((f) => (
          <li key={f.k} className="[overflow-wrap:anywhere]">
            <span className="text-[var(--label-2)]">{f.l}: </span>
            <span className={strong ? "font-semibold" : undefined}>{formatValue(f.s, (value as Record<string, Value>)[f.k] ?? null)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <span className={strong ? "font-semibold" : undefined}>{formatValue(spec, value)}</span>;
}

function SettingCard({ row, branchId, group, ctx }: { row: Row; branchId: string | null; group: string; ctx: RenderedContext }) {
  const d = row.def;
  const id = d.key.replace(".", "-");
  return (
    <section aria-labelledby={`${id}-t`} className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      <header className="grid min-w-0 gap-1">
        <h2 id={`${id}-t`} className="m-0 text-[1.06rem] font-semibold [overflow-wrap:anywhere]">{d.label}</h2>
        <p className="m-0 text-[0.82rem] text-[var(--label-2)]">{d.key.replace(".layanan", " (layanan)")} · {d.scope === "branch" ? "per cabang" : "seluruh klinik"}</p>
      </header>
      {d.kind === "ref" ? (
        <>
          <dl className="m-0 grid min-w-0 gap-2 min-[700px]:grid-cols-2">
            <Fact label="Default">{d.defaultText}</Fact>
            <Fact label="Batas">{d.boundsText}</Fact>
          </dl>
          {d.note && <p className="m-0 text-[0.88rem] text-[var(--label-2)]">{d.note}</p>}
          <Link href={d.href} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka {d.owner}</Link>
        </>
      ) : (
        <>
          <dl className="m-0 grid min-w-0 gap-2 min-[700px]:grid-cols-2">
            <Fact label={row.isDefault ? "Nilai sekarang · default" : "Nilai sekarang"}>
              <ValueLines spec={d.spec} value={row.current} strong />
            </Fact>
            {!row.isDefault && (
              <Fact label={`Default (${SOURCE[d.source.kind]} ${d.source.ref})`}>
                <ValueLines spec={d.spec} value={d.default} />
              </Fact>
            )}
            {row.isDefault && <Fact label="Sumber default">{`${SOURCE[d.source.kind]} ${d.source.ref}`}</Fact>}
            <Fact label="Batas">
              {d.spec.t === "obj" ? (
                <ul className="m-0 grid list-none gap-0.5 p-0">
                  {d.spec.f.map((f) => <li key={f.k}><span className="text-[var(--label-2)]">{f.l}: </span>{boundsText(f.s)}</li>)}
                </ul>
              ) : boundsText(d.spec)}
            </Fact>
            <Fact label="Berlaku sejak">{row.inForce ? fmt.format(row.inForce.effectiveFrom) : "Default sejak awal"}</Fact>
          </dl>
          {d.note && <p className="m-0 text-[0.88rem] text-[var(--label-2)]">{d.note}</p>}
          {row.scheduled && (
            <p className="m-0"><StatusBadge tone="neutral">Terjadwal</StatusBadge> {formatValue(d.spec, row.scheduled.value)} mulai {fmt.format(row.scheduled.effectiveFrom)}</p>
          )}
          {row.draft ? (
            <div className="grid gap-2">
              <p className="m-0">
                <StatusBadge tone="warning">{`Menunggu persetujuan ${APPROVER[(d.drafts.find((x) => x.by === row.draft!.changedAs)?.approver ?? "owner")]}`}</StatusBadge>{" "}
                {formatValue(d.spec, row.draft.value)} · diusulkan {row.draft.changedName}, berlaku {row.draft.effectiveFrom > new Date() ? `mulai ${fmt.format(row.draft.effectiveFrom)}` : "saat disetujui"}
              </p>
              {row.access.mode === "draft" && row.draft.approvalId && <WithdrawDraft approvalId={row.draft.approvalId} group={group} ctx={ctx} />}
              {d.drafts.some((x) => x.approver === row.role) && row.draft.approvalId && (
                <Link href={`/persetujuan/${row.draft.approvalId}`} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka di Persetujuan</Link>
              )}
            </div>
          ) : (
            <SettingEditor
              key={row.history[0]?.id ?? "default"}
              settingKey={d.key}
              label={d.label}
              spec={d.spec}
              value={row.current}
              branchId={d.scope === "branch" ? branchId : null}
              draftMode={row.access.mode === "draft" ? APPROVER[row.access.approver] : null}
              isDefault={row.isDefault}
              ctx={ctx}
            />
          )}
          {row.history.length > 0 && (
            <details className="min-w-0">
              <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center font-semibold text-[var(--tint)]">Riwayat ({row.history.length})</summary>
              <ol className="m-0 mt-1 grid list-none gap-0 p-0">
                {row.history.map((v) => (
                  <li key={v.id} className="grid gap-0.5 border-b border-[var(--separator)] py-2 last:border-b-0 [border-bottom-width:0.5px]">
                    <span className="[overflow-wrap:anywhere]">
                      {v.previous !== undefined && <span className="text-[var(--label-2)]">{formatValue(d.spec, v.previous)} → </span>}
                      <span className="font-semibold">{formatValue(d.spec, v.value)}</span>
                      {v.restoredDefault && " · kembali ke default"}
                      {v.state !== "active" && ` · ${{ draft: "usulan", rejected: "ditolak", cancelled: "ditarik", superseded: "digantikan sebelum berlaku" }[v.state]}`}
                    </span>
                    <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                      {v.state === "active" ? `berlaku ${fmt.format(v.effectiveFrom)}` : `diajukan ${fmt.format(v.createdAt)}`} · {v.changedName} sebagai {ROLE_LABEL[v.changedAs] ?? v.changedAs} · {v.reason}
                      {v.decidedAt && v.state !== "superseded" && v.approvalId ? ` · diputuskan ${fmt.format(v.decidedAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}

async function Body({ params, searchParams }: { params: Promise<{ grup: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { grup } = await params;
  const q = await searchParams;
  const p = await loadGroup(grup, typeof q.cabang === "string" ? q.cabang : undefined);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "not-found") notFound();
  if (p.kind === "forbidden") return <PermissionState object="pengaturan ini" />;
  const hasBranchRows = p.rows.some((r) => r.def.scope === "branch");
  return (
    <>
      <PageTitle title={p.group.label} />
      {hasBranchRows && (
        p.tenantWide ? (
          <nav aria-label="Nilai cabang" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
            {[{ id: "", name: "Semua cabang" }, ...p.branches].map((b) => {
              const active = (p.branch?.id ?? "") === b.id;
              return (
                <Link
                  key={b.id || "all"}
                  href={b.id ? `/pengaturan/${p.group.slug}?cabang=${b.id}` : `/pengaturan/${p.group.slug}`}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline ${active ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : ""}`}
                >
                  {b.name}
                </Link>
              );
            })}
          </nav>
        ) : (
          <p className="m-0 text-[var(--label-2)]">Pengaturan per cabang untuk {p.branch?.name ?? "cabang aktif"}.</p>
        )
      )}
      {hasBranchRows && p.tenantWide && !p.branch && (
        <p className="m-0 text-[0.94rem] text-[var(--label-2)]">Nilai &quot;Semua cabang&quot; berlaku untuk cabang yang belum punya nilai sendiri.</p>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        {p.rows.map((r) => <SettingCard key={r.def.key} row={r} branchId={p.branch?.id ?? null} group={p.group.slug} ctx={p.ctx} />)}
      </div>
    </>
  );
}

export default function PengaturanGroupPage(props: { params: Promise<{ grup: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[880px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body {...props} />
      </Suspense>
    </main>
  );
}
