// Siapkan (UX-10, 19:134; T-065): today's preparation list at the active branch, from confirmed selections (PR-18):
// per patient the selected treatments' materials (recipe map × quantity, FEFO issue into the room depot) and the
// products to dispense (FEFO batch suggestion); draft prescriptions as blocked rows ("Resep belum ditandatangani").
// Pharmacist only; blocked rows stay listed with their blocker.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { DispensingRow, TreatmentPrep } from "../../../../modules/pharmacy/pharmacy";
import { loadPrep } from "../data";
import { MapForm, PrepareForm, PrepareMaterialsForm } from "../forms";
import { BLOCKER_LABEL, SEGMENTS } from "../labels";

export const metadata: Metadata = { title: "Siapkan — Clinic Dashboard" };

const card = "grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const date = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

type Patient = { visit_id: string; name: string; mrn: string; checked_in_at: string; treatments: TreatmentPrep[]; products: DispensingRow[]; unsigned: number };

async function Body() {
  const d = await loadPrep();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="apotek" />;
  if (d.kind === "no-branch") return <ListPage as="section" title="Siapkan" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const l = d.list;
  const byVisit = new Map<string, Patient>();
  const at = (p: { visit_id: string; name: string; mrn: string; checked_in_at: string }) => {
    const x = byVisit.get(p.visit_id) ?? { ...p, treatments: [], products: [], unsigned: 0 };
    byVisit.set(p.visit_id, x);
    return x;
  };
  for (const t of l.treatments) at(t.patient).treatments.push(t);
  for (const p of l.products) at(p.patient).products.push(p);
  for (const u of l.unsigned) at(u.patient).unsigned += u.items;
  const rows = [...byVisit.values()].sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at));
  return (
    <ListPage as="section" title="Siapkan" filters={SEGMENTS("siapkan")}
      state={rows.length === 0 ? { kind: "empty", message: `Belum ada yang perlu disiapkan di ${l.branch_name}.` } : { kind: "rows" }}>
      <ul aria-label="Pasien" className="m-0 grid min-w-0 list-none gap-4 p-0">
        {rows.map((p) => (
          <li key={p.visit_id} className={card}>
            <h2 className="m-0 flex min-w-0 flex-wrap items-baseline gap-2 text-[1.25rem] font-semibold">
              <span className="[overflow-wrap:anywhere]">{p.name}</span>
              <span className="text-[0.88rem] font-normal text-[var(--label-2)]">{`${p.mrn} · datang ${time(p.checked_in_at)}`}</span>
            </h2>
            {p.unsigned > 0 && <BlockedState reason={`${BLOCKER_LABEL.prescription_unsigned} (${p.unsigned} obat)`} unblock="Dokter menandatangani resep di Pemeriksaan" />}
            {p.treatments.map((t) => (
              <section key={t.selection_item_id} aria-label={`Bahan ${t.name}`} className="grid min-w-0 gap-2 border-t border-[var(--separator)] pt-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="m-0 text-[1.06rem] font-semibold [overflow-wrap:anywhere]">{`${t.name}${Number(t.quantity) !== 1 ? ` × ${Number(t.quantity)}` : ""}`}</h3>
                  {t.request ? <StatusBadge tone="warning">Menunggu dikeluarkan</StatusBadge>
                    : t.blocker ? <StatusBadge tone="blocked">Belum dapat disiapkan</StatusBadge> : <StatusBadge tone="neutral">Siap disiapkan</StatusBadge>}
                </div>
                {t.lines.length > 0 && (
                  <ul className="m-0 grid min-w-0 gap-1 pl-5">
                    {t.lines.map((x) => (
                      <li key={x.row_index} className="[overflow-wrap:anywhere]">
                        {x.item ? `${x.item.name}: ${Number(x.quantity)} ${x.item.unit}` : `${x.material} (${x.recipe_qty} ${x.recipe_unit}) — belum dipetakan`}
                      </li>
                    ))}
                  </ul>
                )}
                {t.room_depot && <p className={muted}>{`Ke ${t.room_depot.name}`}</p>}
                {t.blocker && <p className={muted}>{BLOCKER_LABEL[t.blocker]}</p>}
                {!t.request && t.blocker === "recipe_unmapped" && t.lines.filter((x) => !x.item).map((x) => (
                  <MapForm key={x.row_index} ctx={d.ctx} version={t.catalog_version_id} row={x.row_index} material={x.material} items={l.stock_items} />
                ))}
                {!t.request && !t.blocker && <PrepareMaterialsForm ctx={d.ctx} item={t.selection_item_id} name={t.name} depots={l.depots} />}
                {t.request && <p className={muted}>Permintaan bahan dibuat; keluarkan dari Stok bila belum.</p>}
              </section>
            ))}
            {p.products.map((x) => (
              <section key={x.id} aria-label={`Produk ${x.item.name}`} className="grid min-w-0 gap-2 border-t border-[var(--separator)] pt-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="m-0 text-[1.06rem] font-semibold [overflow-wrap:anywhere]">{`${x.item.name} · ${Number(x.quantity)} ${x.item.unit}`}</h3>
                  {x.source === "prescription" && <StatusBadge tone="neutral">Resep</StatusBadge>}
                  {x.external_use && <StatusBadge tone="warning">Obat luar</StatusBadge>}
                  {x.blocker && <StatusBadge tone="blocked">{BLOCKER_LABEL[x.blocker]}</StatusBadge>}
                </div>
                {x.suggestion && (
                  <p className={muted}>{`Batch disarankan: ${x.suggestion.map((b) => `${b.batch_no} (kedaluwarsa ${date(b.expiry)}) × ${Number(b.quantity)}`).join("; ")}`}</p>
                )}
                {(x.blocker === null || x.blocker === "stock_unavailable") && <PrepareForm ctx={d.ctx} dispensing={x.id} name={x.item.name} depots={l.depots} depot={x.depot?.id ?? null} />}
                <Link href={`/apotek/serahkan/${x.id}`} className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">Lihat rincian</Link>
              </section>
            ))}
          </li>
        ))}
      </ul>
    </ListPage>
  );
}

export default function SiapkanPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
